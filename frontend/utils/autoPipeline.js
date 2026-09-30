// 一键全自动生成流水线：
//   创建/续跑项目 → 剧本入库(AI智能分集) → 元素提取 → 批量出图 → 逐集剧本/分镜 → 串行视频 → 导出成片
// 复用现有后端端点，前端只做编排；跑批过程不锁界面（可关弹窗后台继续，任务中心可见）。
// 失败策略：镜头/单集失败自动跳过并在结尾重试一轮；环节级致命失败（项目/提取/剧本/分镜）中止并保留断点信息。
import { readTxtFile } from './textFiles.js';
import {
  runParallelPool,
  preReconcile,
  runEpisodeVideoSerial as runEpisodeVideoSerialShared,
} from './video/autoBatchShared.js';
import { styleOptions } from '../constants/options.js';
import {
  requireCompletedImageBatch,
  requireGeneratedEpisode,
  requireGeneratedStoryboard,
  requireOkResponse,
} from './pipelineGuards.js';

const PIPELINE_STAGES = [
  { key: 'project', label: '创建项目' },
  { key: 'chapter', label: '剧本入库' },
  { key: 'extract', label: '元素提取' },
  { key: 'images', label: '批量出图' },
  { key: 'episode', label: '剧本生成' },
  { key: 'storyboard', label: '生成分镜' },
  { key: 'bind', label: '绑定元素' },
  { key: 'video', label: '串行出视频' },
  { key: 'export', label: '导出成片' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeFilename(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

// 消费 POST SSE 流：事件格式 event: <name>\ndata: <json>\n\n（backend/lib/sse.js）
// 在 done 事件时 resolve(data)，error 事件时 reject，进度通过 onProgress 上报。
async function consumeSseStream(path, payload, { label, onProgress } = {}) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    let msg = text;
    try { msg = JSON.parse(text)?.error || text; } catch { /* 保留原文 */ }
    throw new Error(`${label}失败：HTTP ${resp.status} ${String(msg).slice(0, 200)}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  return new Promise((resolve, reject) => {
    const pump = () => {
      reader.read().then(({ done, value }) => {
        if (done) {
          reject(new Error(`${label}连接中断，未收到完成事件`));
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith('data:')) continue;
          let data = null;
          try { data = JSON.parse(line.slice(5).trim()); } catch { data = null; }
          if (eventName === 'done') {
            resolve(data);
            try { reader.cancel(); } catch { /* 忽略 */ }
            return;
          }
          if (eventName === 'error') {
            reject(new Error(data?.error || data?.message || `${label}失败`));
            try { reader.cancel(); } catch { /* 忽略 */ }
            return;
          }
          if (eventName === 'progress' && onProgress) {
            try { onProgress(data); } catch { /* 进度回调异常不中断流水线 */ }
          }
        }
        pump();
      }).catch((error) => reject(new Error(`${label}连接异常：${error?.message || error}`)));
    };
    pump();
  });
}

export function createAutoPipelineRuntime({ api, message, reactive, computed, refs = {}, helpers = {} } = {}) {
  const auto = reactive({
    visible: false,
    running: false,
    stopRequested: false,
    finished: false,
    stageIndex: -1,
    stageLabel: '',
    percent: 0,
    logs: [],
    failures: [],
    creating: false,
    // 新建 / 续跑（已有项目）
    mode: 'new',
    resumeProjectId: '',
    projectOptions: [],
    form: {
      name: '',
      scriptText: '',
      style: 'webtoon',
      episodeMinutes: 2,
      storyboardConcurrency: 2,
      categories: ['character', 'scene'],
    },
    categoryOptions: [
      { key: 'character', label: '人物' },
      { key: 'group', label: '群像' },
      { key: 'scene', label: '场景' },
      { key: 'prop', label: '道具' },
      { key: 'effect', label: '特效' },
      { key: 'creature', label: '生物' },
    ],
    styleOptions: [...styleOptions],
    result: { projectId: '', episodeIds: [], exportDir: '', exported: 0 },
  });

  // config 可能是 ref 或 reactive，两种形态都兼容
  const configValue = () => (refs.config?.value ?? refs.config) || {};
  const shotSeconds = computed(() => Math.max(5, Math.round(Number(configValue().video?.duration) || 15)));
  const targetShots = computed(() => Math.max(1, Math.ceil(
    (Math.max(1, Number(auto.form.episodeMinutes) || 2) * 60) / shotSeconds.value
  )));
  // 成本预估文案：镜头数 × 单镜秒数 × 视频单价（设置→视频生成→单价/秒；0 = 未配置，提示去填）
  const pricePerSecond = computed(() => Number(configValue().video?.pricePerSecond) || 0);
  const costEstimate = computed(() => {
    if (!pricePerSecond.value) return '';
    const total = targetShots.value * shotSeconds.value * pricePerSecond.value;
    return `¥${Math.round(total * 100) / 100}（${targetShots.value} 镜 × ${shotSeconds.value}s × ${pricePerSecond.value}/秒）`;
  });

  const log = (text, kind = 'info') => {
    auto.logs.push({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text, kind });
  };

  const setStage = (index, note = '') => {
    auto.stageIndex = index;
    auto.stageLabel = PIPELINE_STAGES[index]?.label || '';
    auto.percent = Math.min(99, Math.round((index / PIPELINE_STAGES.length) * 100));
    log(`▶ ${auto.stageLabel}${note ? `：${note}` : ''}`);
  };

  // 长请求（如 AI 分集）没有中间事件：定时汇报已耗时，避免「像卡死」
  async function runWithTicker(label, promise, { intervalMs = 30000 } = {}) {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      log(`${label}进行中… 已 ${Math.round((Date.now() - startedAt) / 1000)}s`);
    }, intervalMs);
    try {
      return await promise;
    } finally {
      clearInterval(timer);
    }
  }

  const scriptState = () => (refs.scriptState?.value ?? refs.scriptState) || {};
  const projectState = () => (refs.project?.value ?? refs.project) || {};

  const openDialog = async () => {
    if (auto.running) {
      auto.visible = true;
      return;
    }
    auto.finished = false;
    auto.logs = [];
    auto.failures = [];
    auto.percent = 0;
    auto.stageIndex = -1;
    auto.stageLabel = '';
    auto.result = { projectId: '', episodeIds: [], exportDir: '', exported: 0 };
    auto.visible = true;
    // 拉项目列表供「续跑已有项目」选择
    try {
      const res = await api.get('/api/projects');
      auto.projectOptions = (res?.projects || []).map((p) => ({ id: p.id || p.projectId, name: p.name || p.id }));
    } catch {
      auto.projectOptions = [];
    }
  };

  // 上传小说 .txt（UTF-8 / GB18030 自动识别），读入后回填剧本文本框
  const handleScriptFile = async (fileList) => {
    const file = [...fileList].find((f) => /\.txt$/i.test(f.name) || f.type === 'text/plain');
    if (!file) {
      message?.warning?.('请选择 .txt 文件');
      return;
    }
    try {
      const text = await readTxtFile(file);
      if (!String(text || '').trim()) throw new Error('文件内容为空');
      auto.form.scriptText = String(text).trim();
      message?.success?.(`已导入《${file.name}》：${auto.form.scriptText.length} 字`);
    } catch (error) {
      message?.error?.(error?.message || '文件读取失败');
    }
  };

  const stopPipeline = () => {
    if (!auto.running || auto.stopRequested) return;
    auto.stopRequested = true;
    try { helpers.stopSequentialGeneration?.(); } catch { /* 视频阶段未启动时忽略 */ }
    log('⏸ 已请求停止：完成当前任务后不再继续', 'warn');
  };

  const finish = (aborted) => {
    auto.running = false;
    auto.percent = 100;
    auto.finished = true;
    auto.visible = true;
    const failCount = auto.failures.length;
    if (aborted) {
      log('⏹ 流水线已停止', 'warn');
      message?.info?.('一键生成已停止，已完成阶段的结果保留在项目中（可换「续跑已有项目」模式继续）');
    } else if (failCount) {
      log(`⚠ 流水线完成，但有 ${failCount} 项失败，详见下方清单`, 'warn');
      message?.warning?.(`一键生成完成：${failCount} 项失败，详情见弹窗`);
    } else {
      log('✅ 流水线全部完成', 'ok');
      message?.success?.(`一键生成完成！成片已导出到 ${auto.result.exportDir || '项目目录'}`);
    }
  };

  const failStage = (stageLabel, error, { fatal = false } = {}) => {
    const text = error?.message || String(error);
    auto.failures.push({ stage: stageLabel, error: text });
    log(`✗ ${stageLabel}：${text}`, 'error');
    return fatal;
  };

  // 轮询异步 job 直到 done/失败/超时；extract(job)/image(job) 通用
  async function waitJob({ label, fetchStatus, intervalMs = 3000, timeoutMs = 60 * 60 * 1000 }) {
    const startedAt = Date.now();
    for (;;) {
      if (auto.stopRequested) throw new Error('已停止');
      let payload = null;
      try {
        payload = await fetchStatus();
      } catch { /* 瞬时网络抖动下一轮重试 */ }
      const status = String(payload?.status || '').toLowerCase();
      if (status === 'done' || status === 'completed') return payload;
      if (status === 'error' || status === 'failed' || status === 'cancelled') {
        throw new Error(payload?.error || payload?.message || `${label}失败`);
      }
      if (payload?.total && payload?.done != null) {
        log(`${label}进度 ${payload.done}/${payload.total}${payload.message ? `（${payload.message}）` : ''}`);
      }
      if (Date.now() - startedAt > timeoutMs) throw new Error(`${label}超时（${Math.round(timeoutMs / 60000)} 分钟）`);
      await sleep(intervalMs);
    }
  }

  async function createProjectUnique() {
    const base = sanitizeFilename(auto.form.name) || `一键成片_${new Date().toISOString().slice(0, 10)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const name = attempt === 0 ? base : `${base}_${attempt + 1}`;
      try {
        const res = await api.post('/api/project/create', { name });
        return { projectId: res.projectId || name, name };
      } catch (error) {
        const text = error?.message || String(error);
        if (/重名|已存在|duplicate/i.test(text)) continue;
        throw error;
      }
    }
    throw new Error('项目名重复且自动去重失败，请换一个名字');
  }

  // 项目是否已有元素（续跑时跳过提取）
  const projectHasElements = () => {
    const elements = projectState().elements || {};
    return Object.values(elements).some((list) => Array.isArray(list) && list.length > 0);
  };

  // 提交一批出图任务并等待完成；job 完成后若 failed 清单非空，自动重试一轮
  async function runImageBatchWithRetry({ projectId, category }) {
    const submit = () => api.post('/api/image/batch', { projectId, category, onlyMissing: true });
    let res = await submit();
    if (!res?.jobId) throw new Error(res?.error || `「${category}」出图任务提交失败`);
    let payload = await waitJob({
      label: `出图·${category}`,
      fetchStatus: () => api.get(`/api/image/batch/status?jobId=${encodeURIComponent(res.jobId)}`),
      timeoutMs: 3 * 60 * 60 * 1000,
    });
    const failedFirst = Array.isArray(payload?.failed) ? payload.failed.filter(Boolean) : [];
    if (failedFirst.length) {
      log(`「${category}」有 ${failedFirst.length} 张失败，自动重试一轮…`, 'warn');
      res = await submit();
      if (!res?.jobId) throw new Error(res?.error || `「${category}」出图重试任务提交失败`);
      payload = await waitJob({
        label: `出图·${category}·重试`,
        fetchStatus: () => api.get(`/api/image/batch/status?jobId=${encodeURIComponent(res.jobId)}`),
        timeoutMs: 3 * 60 * 60 * 1000,
      });
    }
    return requireCompletedImageBatch(payload, category);
  }

  const runPipeline = async () => {
    const isResume = auto.mode === 'resume';
    const scriptText = String(auto.form.scriptText || '').trim();
    if (!isResume && scriptText.length < 50) {
      message?.warning?.('请先粘贴剧本文本或上传小说文件（至少 50 字）');
      return;
    }
    if (isResume && !auto.resumeProjectId) {
      message?.warning?.('请选择要续跑的项目');
      return;
    }
    const categories = (auto.form.categories || []).filter(Boolean);
    if (!categories.length) {
      message?.warning?.('请至少勾选一类要出图的元素');
      return;
    }
    auto.visible = false; // 配置弹窗关闭 → 运行状态在工作台状态条/任务中心可见
    auto.logs = [];
    auto.failures = [];
    auto.stopRequested = false;
    auto.running = true;
    auto.finished = false;
    const form = {
      style: auto.form.style || 'webtoon',
      episodeMinutes: Math.max(1, Number(auto.form.episodeMinutes) || 2),
      categories: [...categories],
    };
    let aborted = false;
    let projectId = '';
    let episodeIds = [];

    try {
      // ---- ① 打开/创建项目 ----
      setStage(0, isResume ? `续跑：${auto.resumeProjectId}` : String(auto.form.name || '自动命名'));
      if (isResume) {
        projectId = auto.resumeProjectId;
        await helpers.openProject?.(projectId);
        log(`✓ 已打开项目 ${projectId}（断点续跑：已有产出会自动跳过）`, 'ok');
      } else {
        const created = await createProjectUnique();
        projectId = created.projectId;
        await helpers.openProject?.(projectId);
        log(`✓ 项目已创建：${created.name}（id=${projectId}）`, 'ok');
      }
      auto.result.projectId = projectId;
      await api.post('/api/project/style', { projectId, style: form.style });
      log(`✓ 全局画风已设定：${form.style}`);

      // ---- ② 剧本入库 + AI 智能分集（续跑且已有集时直接复用） ----
      setStage(1, isResume ? '检测已有分集…' : 'AI 智能分集，识别不出切点时自动退回整本一集');
      const existingEpisodes = (scriptState().episodes || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0));
      if (isResume && existingEpisodes.length) {
        episodeIds = existingEpisodes.map((e) => e.id);
        log(`✓ 复用已有 ${episodeIds.length} 集（未生成剧本的分集会在后续阶段补齐）`, 'ok');
      } else {
        if (!isResume && scriptText.length < 50) throw new Error('剧本文本缺失');
        const chapterRes = await api.post('/api/script/chapter', {
          projectId,
          title: '第一章',
          sourceText: scriptText,
        });
        const chapterId = chapterRes?.chapter?.id;
        if (!chapterId) throw new Error('章节创建失败');
        let episodes = [];
        try {
          const splitRes = await runWithTicker('AI 分集', api.post('/api/script/chapter/split', { projectId, chapterId }));
          if (splitRes?.ok && Array.isArray(splitRes.episodes) && splitRes.episodes.length) {
            episodes = splitRes.episodes;
          } else if (splitRes && splitRes.ok === false && splitRes.error) {
            log(`AI 分集未生效（${splitRes.error}），改用整本一集`, 'warn');
          }
        } catch (error) {
          if (auto.stopRequested) throw error;
          log(`AI 分集调用失败（${error?.message || error}），改用整本一集`, 'warn');
        }
        if (!episodes.length) {
          const wholeRes = await api.post('/api/script/chapter/whole', { projectId, chapterId });
          const ep = wholeRes?.episode;
          if (!ep) throw new Error('整章分集失败');
          episodes = [ep];
        }
        episodeIds = episodes.map((e) => e.id);
        log(`✓ 分集完成：共 ${episodes.length} 集 —— ${episodes.map((e) => `第${e.id}集${e.title ? `《${e.title}》` : ''}`).join('、')}`, 'ok');
      }
      auto.result.episodeIds = [...episodeIds];
      if (auto.stopRequested) return finish(true);

      // ---- ③ 元素提取（续跑且已有元素时跳过） ----
      const shouldExtract = !isResume || !projectHasElements();
      if (shouldExtract) {
        if (scriptText.length < 50) throw new Error('续跑项目没有元素，需要剧本文本才能提取（请粘贴原文后重试）');
        setStage(2, '按文本分块自动提取');
        const extractRes = await api.post('/api/extract', { projectId, text: scriptText });
        if (!extractRes?.jobId) throw new Error(extractRes?.error || '提取任务提交失败');
        await waitJob({
          label: '元素提取',
          fetchStatus: () => api.get(`/api/extract/status?jobId=${encodeURIComponent(extractRes.jobId)}`),
          timeoutMs: 90 * 60 * 1000,
        });
        log('✓ 元素提取完成', 'ok');
      } else {
        setStage(2, '检测到已有元素，跳过');
        log('✓ 项目已有元素库，跳过提取', 'ok');
      }
      if (auto.stopRequested) return finish(true);

      // ---- ④ 批量出图（逐类串行，只补缺失；失败自动重试一轮） ----
      setStage(3, form.categories.map((c) => auto.categoryOptions.find((o) => o.key === c)?.label || c).join('、'));
      for (const cat of form.categories) {
        if (auto.stopRequested) return finish(true);
        await runImageBatchWithRetry({ projectId, category: cat });
      }
      log('✓ 参考图批量生成完成（含一轮自动重试）', 'ok');

      // 刷新工作台状态：剧本内容/分集要进入本地 state，后续分镜/视频管线才能读到
      await helpers.openProject?.(projectId);
      const episodeInfos = (scriptState().episodes || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0));

      // ---- ⑤ 剧本生成（逐集 SSE；已有内容的集跳过） ----
      setStage(4, `共 ${episodeIds.length} 集`);
      const needScript = episodeIds.filter((epId) => {
        const info = episodeInfos.find((e) => String(e.id) === String(epId));
        return !info || !String(info.content || '').trim();
      });
      const skippedScript = episodeIds.length - needScript.length;
      if (skippedScript) log(`跳过 ${skippedScript} 个已有剧本的集`, 'info');
      let scriptDone = 0;
      const scriptFailed = [];
      await runParallelPool(needScript, auto.form.storyboardConcurrency, async (epId) => {
        if (auto.stopRequested) return;
        try {
          const result = await consumeSseStream('/api/script/episode/stream', { projectId, episodeId: epId }, {
            label: `剧本生成·第${epId}集`,
            onProgress: (data) => {
              if (data?.phase) log(`第${epId}集剧本：${data.phase}${data.total ? ` ${data.index || 0}/${data.total}` : ''}`);
            },
          });
          requireGeneratedEpisode(result, epId);
          log(`✓ 第${epId}集剧本生成完成`, 'ok');
        } catch (error) {
          scriptFailed.push(epId);
          failStage(`剧本生成·第${epId}集（跳过，继续下一集）`, error);
        }
        scriptDone += 1;
        log(`剧本进度 ${scriptDone}/${needScript.length}`);
      }, { isStopped: () => auto.stopRequested });
      // 剧本失败重试一轮
      if (scriptFailed.length && !auto.stopRequested) {
        log(`对失败的 ${scriptFailed.length} 集剧本自动重试一轮…`, 'warn');
        for (const epId of scriptFailed) {
          if (auto.stopRequested) break;
          try {
            const result = await consumeSseStream('/api/script/episode/stream', { projectId, episodeId: epId }, { label: `剧本生成·第${epId}集` });
            requireGeneratedEpisode(result, epId);
            log(`✓ 第${epId}集剧本重试成功`, 'ok');
          } catch (error) {
            failStage(`剧本生成·第${epId}集（重试仍失败）`, error);
          }
        }
      }

      // SSE 完成事件已落盘，但当前工作台仍可能持有生成前的响应式快照；
      // 先重新打开项目，再决定哪些集需要分镜，避免把空剧本传给后续阶段。
      await helpers.openProject?.(projectId);
      const refreshedEpisodes = (scriptState().episodes || []).slice();
      const missingScripts = episodeIds.filter((epId) => {
        const info = refreshedEpisodes.find((e) => String(e.id) === String(epId));
        return !String(info?.content || '').trim();
      });
      if (missingScripts.length) {
        throw new Error(`剧本阶段未完成：第${missingScripts.join('、')}集内容为空`);
      }

      // ---- ⑥ 分镜生成（复用工作台管线，保持本地状态同步） ----
      setStage(5, `共 ${episodeIds.length} 集 · 单镜 ${shotSeconds.value}s`);
      const hasStoryboard = (epId) => String(helpers.findStoryboard?.(epId)?.content || '').trim().length > 0;
      const needStoryboard = episodeIds.filter((epId) => !hasStoryboard(epId));
      const skippedStoryboard = episodeIds.length - needStoryboard.length;
      if (skippedStoryboard) log(`跳过 ${skippedStoryboard} 个已有分镜的集`, 'info');
      let sbDone = 0;
      const sbFailed = [];
      await runParallelPool(needStoryboard, auto.form.storyboardConcurrency, async (epId) => {
        if (auto.stopRequested) return;
        try {
          await helpers.generateStoryboard?.(epId, 'normal', '', true);
          requireGeneratedStoryboard(helpers.findStoryboard?.(epId), epId);
          log(`✓ 第${epId}集分镜生成完成`, 'ok');
        } catch (error) {
          sbFailed.push(epId);
          failStage(`分镜生成·第${epId}集（跳过，继续下一集）`, error);
        }
        sbDone += 1;
        log(`分镜进度 ${sbDone}/${needStoryboard.length}`);
      }, { isStopped: () => auto.stopRequested });
      // 分镜失败重试一轮
      if (sbFailed.length && !auto.stopRequested) {
        log(`对失败的 ${sbFailed.length} 集分镜自动重试一轮…`, 'warn');
        for (const epId of sbFailed) {
          if (auto.stopRequested) break;
          if (hasStoryboard(epId)) continue;
          try {
            await helpers.generateStoryboard?.(epId, 'normal', '', true);
            requireGeneratedStoryboard(helpers.findStoryboard?.(epId), epId);
            log(`✓ 第${epId}集分镜重试成功`, 'ok');
          } catch (error) {
            failStage(`分镜生成·第${epId}集（重试仍失败）`, error);
          }
        }
      }

      const missingStoryboards = episodeIds.filter((epId) => !hasStoryboard(epId));
      if (missingStoryboards.length) {
        throw new Error(`分镜阶段未完成：第${missingStoryboards.join('、')}集内容为空`);
      }

      // ---- ⑦ AI 绑定元素（逐集；失败不致命） ----
      setStage(6);
      for (const epId of episodeIds) {
        if (auto.stopRequested) return finish(true);
        try {
          const bindRes = requireOkResponse(
            await api.post('/api/project/storyboard/ai-bind-elements', { projectId, episodeId: epId }),
            `第${epId}集元素绑定失败`,
          );
          if (bindRes.partial) log(`⚠ 第${epId}集元素绑定部分完成，失败镜头：${(bindRes.failedShotNos || []).join('、') || '未知'}`, 'warn');
          else log(`✓ 第${epId}集元素绑定完成`, 'ok');
        } catch (error) {
          failStage(`绑定元素·第${epId}集（跳过，不阻塞）`, error);
        }
      }

      // ---- ⑧ 串行生成视频（首尾帧衔接；视频并行模式已停用） ----
      setStage(7, `每集目标 ${auto.form.episodeMinutes} 分钟 ≈ ${targetShots.value} 镜 · 串行`);
      await preReconcile({ api, projectId, log: (t) => log(t, 'info') }); // 防重复扣费：先找回上游已成功视频
      let totalGenerated = 0;
      const videoFailedEpisodes = [];
      // 复用全集串行的单集编排：失败按四分类自动降级（人像保护→彩绘重画+重绑 /
      // 提示词违规→重写分镜+重绑 / 429·5xx→冷却重提 / 400-404→拦下提示人工处理）
      const runEpisodeVideoSerial = async (epId) => {
        const result = await runEpisodeVideoSerialShared({
          api,
          helpers,
          projectId,
          ep: { id: epId },
          ...(targetShots.value != null ? { maxNewShots: targetShots.value } : {}),
          isStopped: () => auto.stopRequested,
          log: (t) => log(t, 'info'),
        });
        if (Array.isArray(result?.failedTasks) && result.failedTasks.length) {
          const detail = result.failedTasks
            .map((task) => `镜头${task.shotNo}（${String(task.note || task.error || '生成失败').slice(0, 80)}）`)
            .join('、');
          throw new Error(`降级重试后仍有 ${result.failedTasks.length} 个镜头失败：${detail}`);
        }
        return Math.max(0, Math.floor(Number(result?.generated) || 0));
      };
      for (const epId of episodeIds) {
        if (auto.stopRequested) return finish(true);
        try {
          totalGenerated += await runEpisodeVideoSerial(epId);
          log(`✓ 第${epId}集串行视频完成`, 'ok');
        } catch (error) {
          failStage(`串行视频·第${epId}集（跳过，继续下一集）`, error);
          videoFailedEpisodes.push(epId);
        }
      }
      if (videoFailedEpisodes.length && !auto.stopRequested) {
        log(`对失败的 ${videoFailedEpisodes.length} 集自动重试一轮…`, 'warn');
        for (const epId of videoFailedEpisodes) {
          if (auto.stopRequested) break;
          try {
            totalGenerated += await runEpisodeVideoSerial(epId);
            log(`✓ 第${epId}集重试完成`, 'ok');
          } catch (error) {
            failStage(`串行视频·第${epId}集（重试仍失败）`, error);
          }
        }
      }
      log(`✓ 视频阶段结束：累计新生成 ${totalGenerated} 镜`, 'ok');

      // ---- ⑨ 导出成片到本地（全部集） ----
      setStage(8);
      try {
        const exportRes = await api.post('/api/video/export-shots', { projectId });
        if (exportRes?.ok) {
          auto.result.exportDir = exportRes.dir || '';
          auto.result.exported = exportRes.count || 0;
          log(`✓ 已导出 ${exportRes.count} 个成片到：${exportRes.dir}`, 'ok');
        } else {
          failStage('导出成片（跳过）', new Error(exportRes?.error || '没有可导出的视频'));
        }
      } catch (error) {
        failStage('导出成片（跳过）', error);
      }
      finish(false);
    } catch (error) {
      if (auto.stopRequested) aborted = true;
      failStage(PIPELINE_STAGES[Math.max(0, auto.stageIndex)]?.label || '流水线', error, { fatal: true });
      finish(aborted || auto.stopRequested);
    }
  };

  // 打开成片导出目录（后端校验只允许 Downloads/Freedom成片）
  const openExportDir = async () => {
    if (!auto.result.exportDir) return;
    try {
      const res = await api.post('/api/video/open-export-folder', { dir: auto.result.exportDir });
      if (!res?.ok) message?.warning?.(res?.error || '打开文件夹失败');
    } catch (error) {
      message?.error?.(error?.message || '打开文件夹失败');
    }
  };

  const stagePercent = computed(() => {
    if (!auto.running && !auto.finished) return 0;
    return auto.percent;
  });

  const phaseLabel = computed(() => {
    if (!auto.running) return '';
    const detail = auto.stageLabel || '准备中';
    const failCount = auto.failures.length;
    return `一键生成：${detail}${failCount ? `（失败 ${failCount} 项）` : ''}`;
  });

  return {
    auto,
    PIPELINE_STAGES,
    targetShots,
    costEstimate,
    stagePercent,
    phaseLabel,
    openAutoPipelineDialog: openDialog,
    runAutoPipeline: runPipeline,
    stopAutoPipeline: stopPipeline,
    handleScriptFile,
    openExportDir,
  };
}
