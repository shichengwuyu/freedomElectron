// 全集串行 / 一键全自动 两条流水线共享的视频阶段逻辑：
// 失败四分类识别、在途等待、单集串行出片（首尾帧衔接）与自动降级（人像保护→彩绘重画重绑、
// 提示词违规→重写分镜重绑、429/5xx→冷却重提、400-404→拦下提示人工处理）、并行 worker 池。
// batchAllRuntime 与 autoPipeline 都从这里引用，避免改一处漏一处。
import { requireGeneratedStoryboard, requireOkResponse } from '../pipelineGuards.js';

// 审核类报错特征（仅用于日志区分，任何失败现在都会触发降级重试）
export const PORTRAIT_BLOCK_PATTERNS = [
  /我暂时无法生成/i,
  /肖像保护/,
  /人像保护/,
  /只支持生成包含您自己的视频/i,
];

export function isPortraitBlockError(text) {
  return PORTRAIT_BLOCK_PATTERNS.some((re) => re.test(String(text || '')));
}

// 内容审核类：上游判定素材/提示词涉版权或政策风险而拒绝生成（例如即梦 Agent 的
// "it may contain copyrighted or policy-violating content"，且明确未扣点数）。
// 这类必须人工换素材/改提示词，**自动重写分镜解决不了**——参考视频/参考图的问题重写提示词也没用，
// 硬重写只会在"重写→再被拒→再重写"里白烧额度，所以单列一类：不降级、不重提。
// 注意：pattern 要避开已有的「音频版权」「提示词有问题」等 prompt 类文案，别改变原有分流。
export const CONTENT_REVIEW_PATTERNS = [
  /copyrighted/i,
  /policy-violating/i,
  /版权\s*[/／、]\s*违规/,
  /违规内容拒绝/,
  /内容审核/,
  /审核(?:不通过|未通过|拒绝)/,
  /侵犯(?:版权|著作权)/,
];

// 提示词违规类报错：上游认为提示词本身过不了审（暧昧/暴力等违规词、音频版权），
// 这类重画人物图没用，需要重写提示词（重新生成分镜）
export const PROMPT_VIOLATION_PATTERNS = [
  /提示词有问题/,
  /请修改提示词/,
  /修改提示词/,
  /音频版权/,
  /违规/,
  /敏感(?:内容|词)/,
];

// 人物图问题类：换一张参考图就能解决 → 重画人物图（彩绘设定板+三视图）
const IMAGE_ISSUE_PATTERNS = [
  ...PORTRAIT_BLOCK_PATTERNS,
  /参考人物无法生成/,
];

// 参数/账户类错误（常见 HTTP 状态码，重提无意义，需人工处理后重跑）：
//   400 参数错误（prompt 为空 / 模型无效 / 素材数量超限）
//   401 未携带 API Key；403 API Key 无效、已禁用或无权限
//   402 账户余额不足
//   404 任务不存在或不属于当前 API Key 用户
export const FATAL_PATTERNS = [
  /\(400\)/,
  /\(401\)/,
  /\(402\)/,
  /\(403\)/,
  /\(404\)/,
  /参数错误/,
  /提示词为空/,
  /prompt\s*为空/i,
  /模型无效/,
  /素材数量超限/,
  /未携带\s*API\s*Key/i,
  /API\s*Key\s*(无效|已禁用|过期)/i,
  /无权限/,
  /余额不足/,
  /任务不存在/,
];

// 失败四分类：'fatal'（参数/账户类，重提无意义）| 'image'（重画人物图）
//          | 'prompt'（重写分镜提示词，版权/政策类拒审也归这里）| 'other'（429/5xx 渠道类，冷却后重提）
export function classifyFailure(text) {
  const t = String(text || '');
  if (FATAL_PATTERNS.some((re) => re.test(t))) return 'fatal';
  if (PROMPT_VIOLATION_PATTERNS.some((re) => re.test(t))) return 'prompt';
  if (IMAGE_ISSUE_PATTERNS.some((re) => re.test(t))) return 'image';
  return 'other';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 通用并行 worker 池：按顺序消费 items，最多 concurrency 个 worker 同时跑
export async function runParallelPool(items, concurrency, worker, { isStopped } = {}) {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(5, concurrency || 1)) }, async () => {
    while (!isStopped?.()) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

// 轮询异步 job（imgjob 等）直到 done/失败/超时
export async function pollJobUntilDone(fetchStatus, { label = '任务', intervalMs = 4000, timeoutMs = 30 * 60 * 1000, isStopped } = {}) {
  const startedAt = Date.now();
  for (;;) {
    if (isStopped?.()) throw new Error('已停止');
    let payload = null;
    try { payload = await fetchStatus(); } catch { payload = null; }
    const status = String(payload?.status || '').toLowerCase();
    if (status === 'done' || status === 'completed') return payload;
    if (status === 'error' || status === 'failed' || status === 'cancelled') {
      throw new Error(payload?.error || payload?.message || `${label}失败`);
    }
    if (Date.now() - startedAt > timeoutMs) throw new Error(`${label}超时（${Math.round(timeoutMs / 60000)} 分钟）`);
    await sleep(intervalMs);
  }
}

// 轮询某集的在途视频任务直到全部落定（完成/失败），返回全部失败镜头清单（任何失败都会触发降级重试）
export async function waitForEpisodeSettle(api, projectId, episodeId, { intervalMs = 10000, timeoutMs = 120 * 60 * 1000, isStopped, onTimeout } = {}) {
  const startedAt = Date.now();
  let round = 0;
  for (;;) {
    if (isStopped?.()) return [];
    round += 1;
    if (round === 1 || round % 6 === 0) {
      // 首轮立即同步 + 每约 60 秒同步一次上游真实状态（未配置令牌时静默跳过）
      try { await api.post('/api/video/sync-upstream-status', { projectId }); } catch { /* 忽略 */ }
    }
    let tasks = [];
    try {
      const res = await api.get(`/api/video/pending?projectId=${encodeURIComponent(projectId)}`);
      tasks = (res?.pending || []).filter((t) => String(t.episodeId) === String(episodeId));
    } catch { /* 瞬时网络抖动下一轮重试 */ }
    const failed = tasks.filter((t) => t.status === 'failed');
    // done 不算 active：done 记录的视频由后台下载/收尾自会落盘，
    // 若算 active，僵尸 done 记录（对账找回后未删的那种）会让 settle 空等到 120 分钟超时
    const active = tasks.filter((t) => t.status !== 'failed' && t.status !== 'done');
    if (!active.length) return failed;
    if (Date.now() - startedAt > timeoutMs) {
      onTimeout?.(active.length);
      return failed;
    }
    await sleep(intervalMs);
  }
}

// 审核类失败降级：按失败镜头的绑定人物（manualTags / 镜头文本 @ 提及兜底），
// 用「彩绘设定板+三视图」（threeViewPainting，防卡脸·推荐，完整脸非写实）重画人物图 → 重新 AI 绑定该集全部镜头。
// 返回 { regenerated: string[], repaintedFailed: [{name, error}] } —— repaintedFailed 非空时调用方应跳过重提（旧图大概率仍被拦）
export async function regenerateCharactersForFailures({ api, projectId, ep, failedTasks, onNote, isStopped, onBindingUpdated } = {}) {
  const result = { regenerated: [], repaintedFailed: [], shouldResubmit: true };
  let project = null;
  try {
    const res = await api.get(`/api/project?id=${encodeURIComponent(projectId)}`);
    project = res?.project || res || null;
  } catch (error) {
    result.repaintedFailed.push({ name: '', error: `读取项目失败：${error?.message || error}` });
    return result;
  }
  const storyboard = (project?.script?.storyboards || []).find((s) => String(s.episodeId) === String(ep.id));
  const characterList = project?.elements?.character || [];
  const failedNos = failedTasks.map((t) => String(t.shotNo));
  const names = new Set();
  for (const no of failedNos) {
    const tags = Array.isArray(storyboard?.manualTags?.[no]) ? storyboard.manualTags[no] : [];
    for (const tag of tags) {
      if (tag?.cat === 'character' && tag?.name) names.add(tag.name);
    }
  }
  if (!names.size) {
    // 绑定为空时兜底：按镜头文本里的 @名字 / 名字出现匹配元素
    const shotBodies = [];
    for (const no of failedNos) {
      const re = new RegExp(`(?:分镜|镜头)\\s*${no}\\s*[:：][\\s\\S]*?(?=(?:分镜|镜头)\\s*\\d+\\s*[:：]|$)`);
      const match = String(storyboard?.content || '').match(re);
      if (match) shotBodies.push(match[0]);
    }
    for (const name of characterList.map((c) => c.name)) {
      if (shotBodies.some((text) => text.includes(name))) names.add(name);
    }
  }
  if (!names.size) {
    onNote?.(`第${ep.id}集审核失败镜头未绑定人物，没有任何可重画的变更，跳过重提（避免同样失败再烧一次）`);
    result.shouldResubmit = false;
  } else {
    for (const name of names) {
      if (isStopped?.()) return result;
      const idx = characterList.findIndex((c) => c.name === name);
      if (idx < 0) continue;
      try {
        const res = await api.post('/api/image/generate', {
          projectId,
          category: 'character',
          index: idx,
          imageMode: 'threeViewPainting', // 彩绘优先：完整脸+非写实，比切割版更不易被拦且五官信息更全
        });
        if (res?.jobId) {
          await pollJobUntilDone(() => api.get(`/api/image/batch/status?jobId=${encodeURIComponent(res.jobId)}`), {
            label: `重画人物·${name}`,
            isStopped,
          });
          result.regenerated.push(name);
          onNote?.(`已按「彩绘设定板+三视图」重画人物：${name}`);
        }
      } catch (error) {
        result.repaintedFailed.push({ name, error: error?.message || String(error) });
        result.shouldResubmit = false;
      }
    }
  }
  try {
    const bindRes = requireOkResponse(
      await api.post('/api/project/storyboard/ai-bind-elements', { projectId, episodeId: ep.id }),
      `第${ep.id}集重新 AI 绑定失败`,
    );
    if (bindRes.partial) {
      onNote?.(`第${ep.id}集已重新 AI 绑定，但仍有 ${(bindRes.failedShotNos || []).length} 个镜头未确认`);
    } else {
      onNote?.(`第${ep.id}集已重新 AI 绑定全部镜头`);
    }
    // 后端已保存最新绑定；同步回当前工作台，确保紧接着的重提读取到新图片。
    if (bindRes?.storyboard) onBindingUpdated?.(bindRes.storyboard);
  } catch (error) {
    result.repaintedFailed.push({ name: '', error: `重新 AI 绑定失败：${error?.message || error}` });
    result.shouldResubmit = false;
  }
  return result;
}

// 渠道过载类报错：高并发把上游打爆的信号 → 重提时自动降并发
const OVERLOAD_PATTERNS = [
  /Upstream task ID is missing/i,
  /上游任务查询失败/,
  /\(429\)/,
  /\(5\d{2}\)/, // 500/502/503/504 等服务端错误状态码
  /rate limit/i,
  /too many requests/i,
  /Internal Server Error/i,
  /Bad Gateway/i,
  /Service Unavailable/i,
  /Gateway Timeout/i,
];

function isOverloadError(text) {
  return OVERLOAD_PATTERNS.some((re) => re.test(String(text || '')));
}

// 重提前的上游对账：把「本地失败但上游实际成功」的视频先拉回落盘，
// 拉回后这些镜头自动变为「已有视频」→ 重提时跳过 → 避免同镜头二次扣费。
export async function preReconcile({ api, projectId, log } = {}) {
  if (!api || !projectId) return;
  try {
    const res = await api.post('/api/video/reconcile-upstream', { projectId });
    if (res?.ok && res.recovered > 0) {
      log?.(`✓ 上游对账：找回 ${res.recovered} 个已成功视频（避免重复提交扣费）`);
    }
  } catch { /* 未配置令牌或网络问题：静默跳过，不阻塞主流程 */ }
}


// 单集串行模式（首尾帧衔接）+ 失败分类分流降级：
//   串行提交整集缺视频镜头 → 等待落定 → 失败四分类降级 → 重提一次（已出片镜头自动跳过）：
//     fatal（400/401/402/403/404 参数·账户类）→ 不自动重提，⛔ 提示人工处理（修参数/换 Key/充值）后重跑
//     image（人像保护/肖像保护/参考人物无法生成）→ 「彩绘设定板+三视图」重画人物 + 重新绑定
//     prompt（提示词违规）→ 重写该集分镜 + 重新绑定
//     other（429 / 5xx / 网络类）→ 渠道故障冷却 15 秒后直接重提
// 返回 { generated, failedTasks } —— failedTasks 为降级重试后仍失败的镜头。
export async function runEpisodeVideoSerial({ api, helpers, projectId, ep, maxNewShots = null, log, isStopped } = {}) {
  const submit = (remaining) => helpers.generateAllShotVideosSequential?.({
    projectId,
    episodeId: ep.id,
    ...(remaining != null ? { maxNewShots: remaining } : {}),
  });
  const result = await submit(maxNewShots);
  let generated = Math.max(0, Math.floor(Number(result?.generated) || 0));
  // settle 首轮必做一次全量上游同步（数十秒级），整集跳过时逐集放大成空转。
  // 先查本地 pending：本集一条记录都没有且没新产出 → 完全跳过 settle；
  // 只有失败记录（无在途）→ 直接采信本地记录，不再花那次同步。
  const localRecords = async () => {
    try {
      const res = await api.get(`/api/video/pending?projectId=${encodeURIComponent(projectId)}`);
      return (res?.pending || []).filter((t) => String(t.episodeId) === String(ep.id));
    } catch {
      return [];
    }
  };
  const locals = await localRecords();
  const localFailed = locals.filter((t) => t.status === 'failed');
  const localActive = locals.some((t) => t.status !== 'failed' && t.status !== 'done');
  let failedTasks = [];
  if (isStopped?.()) {
    // 已停止：不再采集失败，与 waitForEpisodeSettle 的停止语义保持一致
  } else if (generated > 0 || localActive) {
    // 串行管线逐镜等待、返回即基本落定；兜底短等待（万一有在途任务，最多 10 分钟）
    failedTasks = await waitForEpisodeSettle(api, projectId, ep.id, {
      isStopped,
      timeoutMs: 10 * 60 * 1000,
      onTimeout: (n) => log?.(`⚠️ 第${ep.id}集仍有 ${n} 个在途任务未落定（等待超时），先按当前失败清单降级`),
    });
  } else {
    failedTasks = localFailed;
  }
  if (failedTasks.length && !isStopped?.()) {
    // 失败四分类分流降级：
    //   fatal  → 400/401/402/403/404 参数·账户类：重提无意义，⛔ 提示人工处理后重跑
    //   image  → 人像保护类：必须转彩绘重画人物图 + 重绑（旧图大概率仍被拦，重画失败则跳过重提）
    //   prompt → 重写提示词（重新生成分镜）+ 重绑（重画人物图对提示词违规无效）
    //   other  → 429/5xx 渠道类，重画重写都无意义，冷却后直接重提
    const groups = { fatal: [], image: [], prompt: [], other: [] };
    for (const t of failedTasks) {
      groups[classifyFailure(t.note || t.error || '')].push(t);
    }
    let changed = false;   // 是否产生了有效变更（决定是否重提）
    const blockedNotes = []; // 无法降级的原因
    if (groups.fatal.length) {
      // 参数/账户类：不自动重提（重提必然再失败），明确给出人工处理指引
      for (const t of groups.fatal) {
        log?.(`⛔ 镜头${t.shotNo}：${String(t.note || t.error || '').slice(0, 80)} —— 参数/账户类错误，重提无意义`);
      }
      blockedNotes.push(`参数/账户类错误 ${groups.fatal.length} 个（镜头${groups.fatal.map((t) => t.shotNo).join('、')}）：请检查 API Key 是否有效、账户余额是否充足、提示词/模型参数是否正确，处理后重跑`);
    }
    if (groups.image.length) {
      log?.(`第${ep.id}集有 ${groups.image.length} 个人像保护类失败（镜头${groups.image.map((t) => t.shotNo).join('、')}），转「彩绘设定板+三视图」重画人物并重新绑定…`);
      const downgrade = await regenerateCharactersForFailures({
        api,
        projectId,
        ep,
        failedTasks: groups.image,
        onNote: log,
        isStopped,
        onBindingUpdated: helpers.applyStoryboardBinding,
      });
      for (const item of downgrade.repaintedFailed) {
        log?.(`降级重画失败（${item.name || '重绑'}）：${item.error}`);
      }
      if (downgrade.regenerated.length) changed = true;
      if (!downgrade.shouldResubmit && !groups.other.length && !groups.prompt.length) {
        blockedNotes.push(`人物图降级未产生有效变更（镜头${groups.image.map((t) => t.shotNo).join('、')}）`);
      } else if (downgrade.shouldResubmit) {
        changed = true;
      }
    }
    if (groups.prompt.length && !isStopped?.()) {
      // 版权/政策类拒审（上游常见措辞："copyrighted or policy-violating content"）也走这条：
      // 这一类的首要嫌疑是提示词里的敏感措辞（例如"卖国贼"），所以先重写分镜是对的；
      // 只有当重写后仍被拒，才轮到自己排查参考素材。
      const reviewHits = groups.prompt.filter((t) => CONTENT_REVIEW_PATTERNS.some((re) => re.test(String(t.note || t.error || ''))));
      if (reviewHits.length) {
        log?.(`⚠️ 其中 ${reviewHits.length} 个是「版权/政策」类拒审（镜头${reviewHits.map((t) => t.shotNo).join('、')}）：先按提示词违规重写分镜（改写器已覆盖涉政措辞）。若重写后仍被拒，再排查参考素材——① 该镜是否挂了参考视频且为他人成片/含真人面孔/带平台水印；② 绑定的元素参考图是否含真人面孔。这类拒审上游一般不扣点数`);
      }
      log?.(`检测到提示词违规类失败（镜头${groups.prompt.map((t) => t.shotNo).join('、')}），重新生成分镜以重写提示词…`);
      try {
        await helpers.generateStoryboard?.(ep.id, 'normal', '', true);
        requireGeneratedStoryboard(helpers.findStoryboard?.(ep.id), ep.id);
        const bindRes = requireOkResponse(
          await api.post('/api/project/storyboard/ai-bind-elements', { projectId, episodeId: ep.id }),
          `第${ep.id}集重新 AI 绑定失败`,
        );
        log?.(bindRes.partial
          ? `第${ep.id}集分镜已重写并部分重新绑定，仍有 ${(bindRes.failedShotNos || []).length} 个镜头未确认`
          : `第${ep.id}集分镜已重写并重新绑定`);
        changed = true;
      } catch (error) {
        blockedNotes.push(`分镜重写失败：${error?.message || error}（镜头${groups.prompt.map((t) => t.shotNo).join('、')}）`);
      }
    }
    if (groups.other.length) {
      const overload = groups.other.find((t) => isOverloadError(t.note || t.error || ''));
      // 冷却：429/5xx 瞬间重提大概率再失败再扣一次，等 15 秒错峰
      if (overload && !isStopped?.()) {
        log?.(`⏳ 检测到 429/5xx 渠道类失败（${String(overload.note || overload.error || '').slice(0, 40)}），等待 15 秒冷却后重提…`);
        await sleep(15000);
      }
      log?.(`${groups.other.length} 个渠道/网络类失败（镜头${groups.other.map((t) => t.shotNo).join('、')}），直接重提`);
      changed = true;
    }
    if (changed && !isStopped?.()) {
      for (const note of blockedNotes) log?.(`${note}（随本集重提一并尝试，可能仍失败）`);
      log?.('降级完成，串行重提该集失败镜头（首尾帧衔接，已出片镜头自动跳过）…');
      const retry = await submit(maxNewShots != null ? Math.max(0, maxNewShots - generated) : null);
      const retryGenerated = Math.max(0, Math.floor(Number(retry?.generated) || 0));
      generated += retryGenerated; // 重提消耗的预算也要扣减，避免总产出超出上限
      const stillFailed = await waitForEpisodeSettle(api, projectId, ep.id, { isStopped, timeoutMs: 10 * 60 * 1000 });
      if (stillFailed.length) {
        log?.(`降级重试后仍有 ${stillFailed.length} 个镜头失败（镜头${stillFailed.map((t) => t.shotNo).join('、')}）`);
      }
      failedTasks = stillFailed;
    } else {
      // 串行管线遇失败会中断整集：没有可执行的降级动作时本集剩余镜头本轮不会继续，
      // 必须说清楚，否则汇总里只看到 1 个失败镜头，实际还有整集没跑完。
      log?.(`⏭ 第${ep.id}集串行已中断（镜头${failedTasks.map((t) => t.shotNo).join('、')}失败），且没有可执行的降级动作，本集剩余镜头本轮不继续；下一轮全集串行会自动续跑（已出片镜头跳过、不重复扣费）`);
      for (const note of blockedNotes) log?.(`${note} —— 跳过重提（待人工处理后可再跑）`);
      if (!blockedNotes.length) log?.(`没有可执行的降级动作，跳过重提`);
    }
  }
  return { generated, failedTasks };
}
