// 一键全集串行生成（两阶段）：
//   阶段1：按章节顺序并行补全缺失分镜（并发数可配，最大 5）
//   阶段2：逐集出视频——固定串行模式（首尾帧衔接，上一镜尾帧作下一镜开场帧），已有视频的镜头自动跳过；
//          失败按类型分流降级（人像保护→彩绘重画+重绑 / 提示词违规→重写分镜+重绑 / 429·5xx→冷却后重提 / 400·401·402·403·404→拦下提示人工处理）
// 运行进度不锁界面：弹窗只做配置与结果汇总，运行中由分镜页内嵌状态条展示。
import { sortEpisodesByChapterTitle } from '../scriptUtils.js';
import { requireGeneratedStoryboard } from '../pipelineGuards.js';
import { preReconcile, runEpisodeVideoSerial } from './autoBatchShared.js';

export function createBatchAllEpisodesRuntime({ message, reactive, computed, refs = {}, helpers = {} } = {}) {
  const batchAll = reactive({
    visible: false,
    finished: false, // 上一次执行的结果汇总视图
    running: false,
    stopRequested: false,
    withVideo: true,
    concurrency: 2, // 阶段1 分镜并行数（最大 5）
    startEpisodeId: '', // 起始集：只跑这一集（含）之后的集；空 = 从第一集
    useBudget: false, // 产出时长预算：新生成镜头达到上限即停（串行模式生效）
    budgetMinutes: 120,
    total: 0, // 有剧本的集数
    done: 0, // 两阶段累计完成单位数（分镜集数 + 视频集数）
    workTotal: 0, // 进度分母：需补分镜集数 + 总集数（两阶段加权）
    videoDone: 0, // 阶段2 已完成视频的集数
    budgetReached: false, // 产出预算用尽而提前收尾
    stage: '', // storyboard | video
    storyboardTotal: 0,
    storyboardDone: 0,
    videoIndex: 0,
    episodeId: '',
    episodeTitle: '',
    shotsGenerated: 0, // 阶段2 累计新生成镜头数
    activity: '', // 最近一次阶段动作（供状态条/排查）
    failures: [],
  });

  // 单镜时长取 设置→视频生成→单镜时长（cfg.video.duration），换算预算镜头数
  const shotSeconds = computed(() => Math.max(5, Math.round(Number(refs.config?.video?.duration) || 15)));
  const shotBudget = computed(() => (
    batchAll.useBudget && batchAll.budgetMinutes > 0
      ? Math.max(1, Math.ceil((batchAll.budgetMinutes * 60) / shotSeconds.value))
      : 0
  ));

  // 分镜页集数 pills 的显示顺序：按标题章节号升序（只影响显示，不动存储）
  const sbSortedEpisodes = computed(() => sortEpisodesByChapterTitle(refs.scriptState?.episodes || []));

  const hasContent = (ep) => String(ep?.content || '').trim().length > 0;
  const hasStoryboard = (ep) => String(helpers.findStoryboard?.(ep?.id)?.content || '').trim().length > 0;

  const resetRunState = () => {
    batchAll.stopRequested = false;
    batchAll.done = 0;
    batchAll.stage = '';
    batchAll.storyboardTotal = 0;
    batchAll.storyboardDone = 0;
    batchAll.videoIndex = 0;
    batchAll.episodeId = '';
    batchAll.episodeTitle = '';
    batchAll.shotsGenerated = 0;
    batchAll.failures = [];
    batchAll.workTotal = 0;
    batchAll.videoDone = 0;
    batchAll.budgetReached = false;
  };

  const openBatchAllDialog = () => {
    if (batchAll.running) return message.info('全集串行进行中，进度见分镜页顶部状态条');
    if (refs.sequentialRunning?.value || refs.batchVideoRunning?.value) {
      return message.warning('当前有视频生成任务进行中，请完成或停止后再开始全集串行');
    }
    if (helpers.isStoryboardGenerating?.()) return message.warning('当前有分镜正在生成，请稍后再试');
    const total = sbSortedEpisodes.value.filter(hasContent).length;
    if (!total) return message.warning('没有已生成剧本的集数，请先生成剧本');
    batchAll.withVideo = true;
    batchAll.finished = false;
    batchAll.concurrency = Math.max(1, Math.min(5, Number(batchAll.concurrency) || 2));
    // 起始集默认还在可选范围内就保留（方便连续续跑），否则回落到第一集
    const contentEps = sbSortedEpisodes.value.filter(hasContent);
    const stillValid = contentEps.some((ep) => String(ep.id) === String(batchAll.startEpisodeId));
    if (!stillValid) batchAll.startEpisodeId = String(contentEps[0]?.id ?? '');
    batchAll.visible = true;
  };

  const stopBatchAll = () => {
    if (!batchAll.running || batchAll.stopRequested) return;
    batchAll.stopRequested = true;
    if (batchAll.stage === 'video') {
      try { helpers.stopSequentialGeneration?.(); } catch { /* 视频阶段未启动时忽略 */ }
    }
    message.info('正在停止：完成当前任务后不再继续');
  };

  const finishRun = ({ stopped = false, budgetReached = false } = {}) => {
    batchAll.running = false;
    batchAll.stage = '';
    const failCount = batchAll.failures.length;
    const videoSummary = `视频完成 ${batchAll.videoDone}/${batchAll.total} 集`;
    if (failCount) {
      batchAll.finished = true;
      batchAll.visible = true; // 有失败时打开汇总视图
      message.warning(stopped
        ? `全集串行已停止：${videoSummary}，失败 ${failCount} 项，详情见弹窗`
        : budgetReached
          ? `已达到产出预算：${videoSummary}，失败 ${failCount} 项，详情见弹窗`
          : `全集串行完成：失败 ${failCount} 项，详情见弹窗`);
    } else if (stopped) {
      message.info(`全集串行已停止：${videoSummary}`);
    } else if (budgetReached) {
      message.success(`已达到产出预算（${batchAll.shotsGenerated} 镜 ≈ ${batchAll.budgetMinutes} 分钟）：${videoSummary}`);
    } else {
      message.success(`全集串行完成：${batchAll.total} 集全部处理完毕`);
    }
  };

  const confirmBatchAll = async () => {
    const allEps = sbSortedEpisodes.value.filter(hasContent);
    if (!allEps.length) return message.warning('没有已生成剧本的集数');
    // 起始集：只跑选中集（含）之后的集；选不到就从第一集
    const startIndex = allEps.findIndex((ep) => String(ep.id) === String(batchAll.startEpisodeId));
    const eps = startIndex >= 0 ? allEps.slice(startIndex) : allEps;
    batchAll.visible = false; // 配置弹窗关闭，运行进度在分镜页内嵌状态条展示，不锁界面
    resetRunState();
    batchAll.running = true;
    batchAll.withVideo = batchAll.withVideo !== false;
    batchAll.total = eps.length;
    const projectId = refs.project?.value?.id;
    try {
      // ---- 阶段1：并行补全缺失分镜（已有分镜的集自动跳过）；失败的集最后重试一次 ----
      const needStoryboard = eps.filter((ep) => !hasStoryboard(ep));
      // 进度分母 = 需补分镜集数 + 总集数（两阶段各计一次，避免进度提前到 100%）
      batchAll.workTotal = eps.length + needStoryboard.length;
      batchAll.stage = 'storyboard';
      batchAll.storyboardTotal = needStoryboard.length;
      batchAll.storyboardDone = 0;
      const sbFailed = [];
      if (needStoryboard.length) {
        let next = 0;
        const concurrency = Math.max(1, Math.min(5, Number(batchAll.concurrency) || 2));
        const worker = async () => {
          while (!batchAll.stopRequested) {
            const i = next++;
            if (i >= needStoryboard.length) return;
            const ep = needStoryboard[i];
            batchAll.episodeId = ep.id;
            batchAll.episodeTitle = ep.title;
            try {
              await helpers.generateStoryboard(ep.id, 'normal', '', true);
              requireGeneratedStoryboard(helpers.findStoryboard?.(ep.id), ep.id);
            } catch (error) {
              sbFailed.push({ ep, error: error?.message || String(error) });
            }
            batchAll.storyboardDone += 1;
            batchAll.done += 1;
          }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
        if (batchAll.stopRequested) return finishRun({ stopped: true });
        // 分镜失败重试一轮（串行，最多一次）
        if (sbFailed.length && !batchAll.stopRequested) {
          batchAll.episodeId = sbFailed[0].ep.id;
          batchAll.episodeTitle = sbFailed[0].ep.title;
          for (const item of sbFailed) {
            if (batchAll.stopRequested) break;
            if (hasStoryboard(item.ep)) continue; // 重试前再查一次，可能已被补上
            try {
              await helpers.generateStoryboard(item.ep.id, 'normal', '', true);
              requireGeneratedStoryboard(helpers.findStoryboard?.(item.ep.id), item.ep.id);
            } catch (error) {
              batchAll.failures.push({ episodeId: item.ep.id, title: item.ep.title, phase: '分镜', error: `重试仍失败：${error?.message || String(item.error || error)}` });
            }
          }
        }
      }

      // ---- 阶段2：逐集生成视频，固定串行（首尾帧衔接）----
      if (batchAll.stopRequested) return finishRun({ stopped: true }); // 分镜重试期间点了停止就不再进入视频阶段
      if (batchAll.withVideo) {
        batchAll.stage = 'video';
        // A 防重复扣费：开跑前先上游对账，把「本地失败但上游成功」的视频拉回
        await preReconcile({ api: helpers.api, projectId, log: (t) => { batchAll.activity = String(t); } });
        let remainingShots = shotBudget.value > 0 ? shotBudget.value : null; // null = 不限（产出预算开启时受约束）
        const videoFailed = [];
        // 串行模式（首尾帧衔接）+ 失败分类分流降级：人像保护→彩绘重画+重绑；提示词违规→重写分镜+重绑；429/5xx→冷却后重提
        // 已有视频的镜头在串行管线内自动跳过（不占预算）；本集没有分镜时管线自行跳过该集
        const runEpisodeVideo = async (ep) => {
          const result = await runEpisodeVideoSerial({
            api: helpers.api,
            helpers,
            projectId,
            ep,
            maxNewShots: remainingShots,
            isStopped: () => batchAll.stopRequested,
            log: (text) => { batchAll.activity = String(text); },
          });
          const generated = Math.max(0, Math.floor(Number(result?.generated) || 0));
          batchAll.shotsGenerated += generated;
          if (remainingShots != null) remainingShots -= generated;
          if (result?.failedTasks?.length) {
            batchAll.failures.push({
              episodeId: ep.id,
              title: ep.title,
              phase: '视频',
              error: `降级重试后仍 ${result.failedTasks.length} 个镜头失败：${result.failedTasks.map((t) => `镜头${t.shotNo}（${String(t.note || t.error || '').slice(0, 60)}）`).join('、')}`,
            });
          }
        };
        for (let i = 0; i < eps.length; i++) {
          if (batchAll.stopRequested) break;
          if (remainingShots != null && remainingShots <= 0) {
            batchAll.budgetReached = true; // 交给 finishRun 统一提示，避免双重弹窗+误报"全部完成"
            break;
          }
          const ep = eps[i];
          batchAll.videoIndex = i + 1;
          batchAll.episodeId = ep.id;
          batchAll.episodeTitle = ep.title;
          if (!hasStoryboard(ep)) {
            if (!batchAll.failures.some((item) => String(item.episodeId) === String(ep.id) && item.phase === '分镜')) {
              batchAll.failures.push({ episodeId: ep.id, title: ep.title, phase: '分镜', error: '分镜为空，已跳过视频生成' });
            }
            batchAll.done += 1;
            batchAll.videoDone += 1;
            continue;
          }
          try {
            await runEpisodeVideo(ep);
          } catch (error) {
            videoFailed.push({ ep, error: error?.message || String(error) });
          }
          batchAll.done += 1;
          batchAll.videoDone += 1;
        }
        // 视频失败集重试一轮（最多一次）
        if (videoFailed.length && !batchAll.stopRequested) {
          for (const item of videoFailed) {
            if (batchAll.stopRequested) break;
            if (remainingShots != null && remainingShots <= 0) break;
            batchAll.episodeId = item.ep.id;
            batchAll.episodeTitle = item.ep.title;
            try {
              await runEpisodeVideo(item.ep);
            } catch (error) {
              batchAll.failures.push({ episodeId: item.ep.id, title: item.ep.title, phase: '视频', error: `重试仍失败：${error?.message || String(item.error || error)}` });
            }
          }
        }
      }
      finishRun({ stopped: batchAll.stopRequested, budgetReached: batchAll.budgetReached });
    } catch (error) {
      batchAll.failures.push({ episodeId: '', title: '', phase: '编排', error: error?.message || String(error) });
      finishRun({ stopped: true });
    }
  };

  const batchPhaseLabel = computed(() => {
    if (!batchAll.running) return '';
    if (batchAll.stage === 'storyboard') return `并行生成分镜 ${batchAll.storyboardDone}/${batchAll.storyboardTotal} 集`;
    if (batchAll.stage === 'video') return `串行生成视频（首尾帧衔接，第 ${batchAll.videoIndex}/${batchAll.total} 集）`;
    return '准备中';
  });

  const batchAllPercent = computed(() => {
    const denom = batchAll.workTotal || batchAll.total; // 两阶段加权：分镜集数 + 总集数
    if (!denom) return 0;
    return Math.min(100, Math.round((batchAll.done / denom) * 100));
  });

  const pendingStoryboardCount = computed(() => sbSortedEpisodes.value
    .filter((ep) => hasContent(ep) && !hasStoryboard(ep)).length);

  return {
    batchAll,
    sbSortedEpisodes,
    batchPhaseLabel,
    batchAllPercent,
    shotSeconds,
    shotBudget,
    pendingStoryboardCount,
    openBatchAllDialog,
    confirmBatchAll,
    stopBatchAll,
  };
}
