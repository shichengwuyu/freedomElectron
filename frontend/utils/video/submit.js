import { delay } from './timing.js';
import { removeShotFromVideoQueue } from './queueCore.js';
import { createVideoProgressRuntimeContext } from './progressState.js';
import { createBuildShotSubmitRuntime } from './submitPayload.js';

export {
  isVideoResultHandled,
  normalizeVideoSchedulerSlots,
  videoProgressStateFromJob,
  startProgressStateFlow,
  completeProgressStateFlow,
  createProgressStateRuntimeContext,
  createVideoProgressRuntimeContext,
} from './progressState.js';

export {
  videoReferenceImagesFromTags,
  videoAudioRefsFromTags,
  videoAudioRefsFromAudioTags,
  buildShotVideoSubmit,
  createBuildShotSubmitRuntime,
} from './submitPayload.js';

function normalizeShotProgressValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

// 上游任务日志（rolldek）带来的附加信息：只用于视频区的说明文案（模型 / 耗时 / 费用）。
function upstreamFactsFromStatus(status = {}) {
  return {
    ...(status.upstreamStatus ? { upstreamStatus: String(status.upstreamStatus) } : {}),
    ...(status.upstreamModel ? { upstreamModel: String(status.upstreamModel) } : {}),
    ...(Number(status.upstreamQuota) > 0 ? { upstreamQuota: Number(status.upstreamQuota) } : {}),
    ...(Number(status.upstreamCostUsd) > 0 ? { upstreamCostUsd: Number(status.upstreamCostUsd) } : {}),
    ...(Number(status.upstreamElapsedMs) > 0 ? { upstreamElapsedMs: Number(status.upstreamElapsedMs) } : {}),
  };
}

function shotProgressFromStatus(status = {}, fallback = {}) {
  const remote = normalizeShotProgressValue(status.progress);
  const startedAt = Number(status.submittedAt || status.createdAt || fallback.startedAt || Date.now()) || Date.now();
  const error = String(status.error || status.lastError || '').trim();
  const canCancel = typeof status.canCancel === 'boolean'
    ? status.canCancel
    : (typeof fallback.canCancel === 'boolean' ? fallback.canCancel : null);
  const upstream = upstreamFactsFromStatus(status);
  if (remote != null) {
    return {
      percentage: remote,
      source: status.progressSource || 'remote',
      startedAt,
      updatedAt: Date.now(),
      note: status.note || '',
      ...upstream,
      ...(canCancel != null ? { canCancel } : {}),
      ...(error ? { error } : {}),
    };
  }
  return {
    percentage: normalizeShotProgressValue(fallback.percentage) ?? 0,
    source: 'estimate',
    startedAt,
    updatedAt: Date.now(),
    note: status.note || fallback.note || '',
    ...upstream,
    ...(canCancel != null ? { canCancel } : {}),
    ...(error ? { error } : {}),
  };
}

function currentShotProgress(handlers = {}, key) {
  if (typeof handlers.shotProgress === 'function') return handlers.shotProgress(key) || {};
  return handlers.shotProgress?.[key] || {};
}

function setEstimatedShotProgress(handlers = {}, key, percentage = 1) {
  if (!key || !handlers.setShotProgress) return;
  const fallback = currentShotProgress(handlers, key);
  if (fallback.source === 'remote') return;
  const now = Date.now();
  const nextPercentage = normalizeShotProgressValue(percentage) ?? 1;
  const previousPercentage = normalizeShotProgressValue(fallback.percentage);
  handlers.setShotProgress(key, {
    percentage: Math.max(previousPercentage ?? 0, nextPercentage),
    source: 'estimate',
    startedAt: Number(fallback.startedAt) || now,
    updatedAt: now,
    note: fallback.note || '',
    ...(typeof fallback.canCancel === 'boolean' ? { canCancel: fallback.canCancel } : {}),
  });
}

function setShotProgressFromStatus(handlers = {}, key, status = {}) {
  if (!key || !handlers.setShotProgress) return;
  handlers.setShotProgress(key, shotProgressFromStatus(status, currentShotProgress(handlers, key)));
}

function setShotFailure(handlers = {}, key, reason, fallback = '视频生成失败') {
  const message = String(reason?.message || reason || fallback).trim() || fallback;
  handlers.setShotStatus?.(key, 'failed');
  setShotProgressFromStatus(handlers, key, { error: message });
  return message;
}

export function applyVideoSubmitSlots(status = {}, handlers = {}) {
  const ignoredShotNos = new Set((status.ignoredShotNos || []).map(String));
  for (const slot of (Array.isArray(status.slots) ? status.slots : [])) {
    if (!['submitting', 'waiting'].includes(slot?.state)) continue;
    const no = slot?.currentShot?.shotNo;
    if (no == null) continue;
    if (ignoredShotNos.has(String(no)) || handlers.isShotTrackingStopped?.(no)) continue;
    const key = handlers.shotKey(no);
    handlers.setShotStatus(key, slot.state === 'waiting' ? 'queued' : 'generating');
    setShotProgressFromStatus(handlers, key, {
      progress: slot.progress ?? (slot.state === 'waiting' ? 2 : 4),
      progressSource: slot.progress == null ? 'estimate' : 'remote',
      note: slot.note || (slot.state === 'waiting' ? '等待并发空位' : '正在生成视频'),
      updatedAt: status.updatedAt,
    });
  }
}

function providerLabelForSubmit(handlers = {}, submit = null) {
  return handlers.providerLabelForSubmit?.(submit) || handlers.providerLabel();
}

function providerLabelForSubmits(handlers = {}, submits = []) {
  const labels = [...new Set((submits || [])
    .map((submit) => providerLabelForSubmit(handlers, submit))
    .filter(Boolean))];
  return labels.length ? labels.join(' / ') : handlers.providerLabel();
}

async function waitBeforeVideoSubmit(handlers = {}, options = {}) {
  if (typeof handlers.beforeVideoSubmit !== 'function') return true;
  return (await handlers.beforeVideoSubmit(options)) !== false;
}

export async function processVideoQueueFlow(handlers = {}) {
  handlers.cancelStartTimer();
  const queue = handlers.queue;
  if (queue.processing || queue.items.length === 0) return;
  const project = handlers.project();
  if (!project) return;
  if (!handlers.ensureSubmitModeSupported()) return;

  queue.processing = true;
  handlers.setBatchRunning(true);
  handlers.setBatchProgress('正在提交视频...');
  handlers.startProgress(queue.items.length, handlers.batchProgress());
  console.log('[视频提交] 开始提交，共', queue.items.length, '个镜头');

  const pending = [];
  for (const shot of [...queue.items]) {
    const key = handlers.shotKey(shot.no);
    if (handlers.shotVideoUrl(shot.no)) {
      handlers.deleteShotStatus(key);
      handlers.deleteShotProgress?.(key);
      handlers.removeQueueShot(shot.no);
      continue;
    }
    const submit = handlers.buildShotSubmit(shot);
    if (!submit) {
      handlers.warning(`镜头 ${shot.no} 的视频提示词为空，已跳过`);
      handlers.deleteShotStatus(key);
      handlers.deleteShotProgress?.(key);
      handlers.removeQueueShot(shot.no);
      continue;
    }
    pending.push(submit);
    handlers.setShotStatus(key, 'queued');
    setEstimatedShotProgress(handlers, key, 1);
  }

  if (!pending.length) {
    queue.processing = false;
    handlers.setBatchRunning(false);
    handlers.setBatchProgress('');
    handlers.completeProgress('success', '没有需要提交的视频镜头');
    return;
  }
  const episodeId = handlers.episodeId();
  const uiOperation = handlers.claimUiOperation();
  const batchProviderLabel = providerLabelForSubmits(handlers, pending);
  handlers.setBatchProgress(`正在提交${batchProviderLabel}...`);
  handlers.startProgress(pending.length, handlers.batchProgress());
  handlers.setProgress({
    total: pending.length,
    detail: `准备提交 ${pending.length} 个镜头`,
    indeterminate: false,
  });

  try {
    const approved = await waitBeforeVideoSubmit(handlers, {
      episodeId,
      shotNos: pending.map((submit) => submit.shotNo),
    });
    if (!approved) {
      for (const submit of pending) {
        const key = handlers.shotKey(submit.shotNo);
        handlers.deleteShotStatus(key);
        handlers.deleteShotProgress?.(key);
      }
      handlers.abandonUiOperation?.(uiOperation, { fromQueue: true });
      queue.processing = false;
      handlers.setBatchRunning(false);
      handlers.completeProgress('warning', 'Video submission canceled');
      return;
    }
    const result = await handlers.submitBatch({
      projectId: project.id,
      episodeId,
      shots: pending,
      // 并行提交并发数（服务端 body.concurrency || cfg.video.apiConcurrency || 3）
      ...(Number(options.concurrency) > 0 ? { concurrency: Math.max(1, Math.min(5, Math.floor(Number(options.concurrency)))) } : {}),
    });
    if (result.jobId) {
      handlers.recordGenerationBatch?.(pending.map((submit) => submit.shotNo), {
        projectId: project.id,
        episodeId,
        kind: 'queue',
      });
    }
    if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation, { fromQueue: true });
      return;
    }
    if (!result.jobId) {
      for (const submit of pending) {
        const key = handlers.shotKey(submit.shotNo);
        setShotFailure(handlers, key, result.error, '视频提交失败');
      }
      queue.processing = false;
      handlers.setBatchRunning(false);
      handlers.completeProgress('exception', result.error || '提交失败');
      handlers.error(result.error || '提交失败');
      return;
    }
    handlers.success(`已提交${batchProviderLabel}：${pending.length} 镜`);
    handlers.pollSubmitJob(result.jobId, pending.map((submit) => submit.shotNo), {
      fromQueue: true,
      projectId: project.id,
      episodeId,
      uiOperation,
    });
  } catch (error) {
    if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation, { fromQueue: true });
      return;
    }
    for (const submit of pending) {
      const key = handlers.shotKey(submit.shotNo);
      setShotFailure(handlers, key, error, '视频提交失败');
    }
    queue.processing = false;
    handlers.setBatchRunning(false);
    handlers.completeProgress('exception', error.message || '提交失败');
    handlers.error('提交失败：' + (error.message || error));
  }
}

function videoBatchSubmitter(handlers = {}) {
  return (payload) => handlers.api.post('/api/video/submit-batch', handlers.videoSubmitPayload(payload));
}

export function createVideoGenerationRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    api,
    message,
    project: () => refs.project.value,
    ensureSubmitModeSupported: helpers.ensureSubmitModeSupported,
    buildShotSubmit: helpers.buildShotSubmit,
    shotKey: helpers.shotKey,
    shotStatus: (key) => refs.shotStatus[key],
    shotVideoUrl: helpers.shotVideoUrl,
    shotVideoStatus: helpers.shotVideoStatus,
    setBatchRunning: (running) => { refs.batchRunning.value = running; },
    providerLabel: () => refs.providerLabel.value,
    providerLabelForSubmit: helpers.providerLabelForSubmit,
    setBatchProgress: (message) => { refs.batchProgress.value = message; },
    setShotStatus: (key, status) => { refs.shotStatus[key] = status; },
    shotProgress: (key) => refs.shotProgress?.[key],
    setShotProgress: (key, progress) => { if (refs.shotProgress) refs.shotProgress[key] = progress; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
    startProgress: helpers.startProgress,
    videoSubmitPayload: helpers.videoSubmitPayload,
    episodeId: () => refs.episodeId.value,
    completeProgress: helpers.completeProgress,
    pollSubmitJob: helpers.pollSubmitJob,
    claimUiOperation: helpers.claimUiOperation,
    isUiOperationCurrent: helpers.isUiOperationCurrent,
    abandonUiOperation: helpers.abandonUiOperation,
    isShotTrackingStopped: helpers.isShotTrackingStopped,
    resumeShotTracking: helpers.resumeShotTracking,
    recordGenerationBatch: helpers.recordGenerationBatch,
    beforeVideoSubmit: helpers.beforeVideoSubmit,
  };
}

export function createProcessVideoQueueContext(handlers = {}) {
  return {
    ...handlers.message,
    project: handlers.project,
    episodeId: handlers.episodeId,
    shotKey: handlers.shotKey,
    shotStatus: handlers.shotStatus,
    deleteShotStatus: handlers.deleteShotStatus,
    queue: handlers.queue,
    providerLabel: handlers.providerLabel,
    cancelStartTimer: handlers.cancelStartTimer,
    ensureSubmitModeSupported: handlers.ensureSubmitModeSupported,
    setBatchRunning: handlers.setBatchRunning,
    setBatchProgress: handlers.setBatchProgress,
    batchProgress: handlers.batchProgress,
    startProgress: handlers.startProgress,
    completeProgress: handlers.completeProgress,
    setProgress: handlers.setProgress,
    shotVideoUrl: handlers.shotVideoUrl,
    setShotStatus: handlers.setShotStatus,
    deleteShotStatus: handlers.deleteShotStatus,
    shotProgress: handlers.shotProgress,
    setShotProgress: handlers.setShotProgress,
    deleteShotProgress: handlers.deleteShotProgress,
    isShotTrackingStopped: handlers.isShotTrackingStopped,
    resumeShotTracking: handlers.resumeShotTracking,
    removeQueueShot: handlers.removeQueueShot,
    buildShotSubmit: handlers.buildShotSubmit,
    submitBatch: videoBatchSubmitter(handlers),
    pollSubmitJob: handlers.pollSubmitJob,
    claimUiOperation: handlers.claimUiOperation,
    isUiOperationCurrent: handlers.isUiOperationCurrent,
    abandonUiOperation: handlers.abandonUiOperation,
    recordGenerationBatch: handlers.recordGenerationBatch,
    beforeVideoSubmit: handlers.beforeVideoSubmit,
  };
}

export function createProcessVideoQueueRuntime({ refs = {}, helpers = {} } = {}) {
  return () => processVideoQueueFlow(createProcessVideoQueueContext({
    ...helpers.videoGenerationContext(),
    queue: refs.queue,
    cancelStartTimer: helpers.cancelStartTimer,
    batchProgress: () => refs.batchProgress.value,
    setProgress: helpers.setProgress,
    removeQueueShot: (shotNo) => removeShotFromVideoQueue(refs.queue.items, shotNo),
  }));
}

export function createShotVideoSubmitContext(handlers = {}) {
  return {
    ...handlers.message,
    project: handlers.project,
    ensureSubmitModeSupported: handlers.ensureSubmitModeSupported,
    buildShotSubmit: handlers.buildShotSubmit,
    shotKey: handlers.shotKey,
    shotStatus: handlers.shotStatus,
    shotVideoUrl: handlers.shotVideoUrl,
    shotVideoStatus: handlers.shotVideoStatus,
    resetShotVideo: handlers.resetShotVideo,
    setSubmitting: (running) => { handlers.submittingRef.value = running; },
    setBatchRunning: handlers.setBatchRunning,
    providerLabel: handlers.providerLabel,
    providerLabelForSubmit: handlers.providerLabelForSubmit,
    setBatchProgress: handlers.setBatchProgress,
    setShotStatus: handlers.setShotStatus,
    shotProgress: handlers.shotProgress,
    setShotProgress: handlers.setShotProgress,
    deleteShotProgress: handlers.deleteShotProgress,
    isShotTrackingStopped: handlers.isShotTrackingStopped,
    resumeShotTracking: handlers.resumeShotTracking,
    startProgress: handlers.startProgress,
    submitBatch: videoBatchSubmitter(handlers),
    episodeId: handlers.episodeId,
    completeProgress: handlers.completeProgress,
    pollSubmitJob: handlers.pollSubmitJob,
    claimUiOperation: handlers.claimUiOperation,
    isUiOperationCurrent: handlers.isUiOperationCurrent,
    abandonUiOperation: handlers.abandonUiOperation,
    recordGenerationBatch: handlers.recordGenerationBatch,
    beforeVideoSubmit: handlers.beforeVideoSubmit,
  };
}

export function createAllShotVideosContext(handlers = {}) {
  return {
    ...handlers.message,
    project: handlers.project,
    ensureSubmitModeSupported: handlers.ensureSubmitModeSupported,
    storyboard: handlers.storyboard,
    shots: handlers.shots,
    parseShots: handlers.parseShots,
    shotVideoUrl: handlers.shotVideoUrl,
    shotVideoStatus: handlers.shotVideoStatus,
    buildShotSubmit: handlers.buildShotSubmit,
    setBatchRunning: handlers.setBatchRunning,
    setBatchProgress: handlers.setBatchProgress,
    batchProgress: handlers.batchProgress,
    providerLabel: handlers.providerLabel,
    providerLabelForSubmit: handlers.providerLabelForSubmit,
    startProgress: handlers.startProgress,
    submitBatch: videoBatchSubmitter(handlers),
    episodeId: handlers.episodeId,
    completeProgress: handlers.completeProgress,
    shotKey: handlers.shotKey,
    setShotStatus: handlers.setShotStatus,
    deleteShotStatus: handlers.deleteShotStatus,
    shotProgress: handlers.shotProgress,
    setShotProgress: handlers.setShotProgress,
    deleteShotProgress: handlers.deleteShotProgress,
    isShotTrackingStopped: handlers.isShotTrackingStopped,
    resumeShotTracking: handlers.resumeShotTracking,
    pollSubmitJob: handlers.pollSubmitJob,
    claimUiOperation: handlers.claimUiOperation,
    isUiOperationCurrent: handlers.isUiOperationCurrent,
    abandonUiOperation: handlers.abandonUiOperation,
    recordGenerationBatch: handlers.recordGenerationBatch,
    beforeVideoSubmit: handlers.beforeVideoSubmit,
  };
}

export function createSubmitOneAndWaitContext(handlers = {}) {
  return {
    ensureSubmitModeSupported: handlers.ensureSubmitModeSupported,
    shotKey: handlers.shotKey,
    setShotStatus: handlers.setShotStatus,
    submitBatch: videoBatchSubmitter(handlers),
    submitStatus: (jobId) => handlers.api.get(`/api/video/status?jobId=${encodeURIComponent(jobId)}`),
    projectId: () => handlers.project().id,
    episodeId: handlers.episodeId,
    isAborted: handlers.isAborted,
    pollVideo: (payload) => handlers.api.post('/api/video/poll', payload),
    setShotVideo: handlers.setShotVideo,
    deleteShotStatus: handlers.deleteShotStatus,
    shotProgress: handlers.shotProgress,
    setShotProgress: handlers.setShotProgress,
    deleteShotProgress: handlers.deleteShotProgress,
    isShotTrackingStopped: handlers.isShotTrackingStopped,
    resumeShotTracking: handlers.resumeShotTracking,
    shotVideoUrl: handlers.shotVideoUrl,
    shotVideoStatus: handlers.shotVideoStatus,
    syncShotVideosFromServer: handlers.syncShotVideosFromServer,
    recordGenerationBatch: handlers.recordGenerationBatch,
    beforeVideoSubmit: handlers.beforeVideoSubmit,
  };
}

export function createSequentialGenerationContext(handlers = {}) {
  return {
    ...handlers.message,
    project: handlers.project,
    episodeId: handlers.episodeId,
    ensureSubmitModeSupported: handlers.ensureSubmitModeSupported,
    isSequentialRunning: () => handlers.sequentialRunningRef.value,
    storyboard: handlers.storyboard,
    shots: handlers.shots,
    parseShots: handlers.parseShots,
    setSequentialRunning: (running) => { handlers.sequentialRunningRef.value = running; },
    setAbort: handlers.setAbort,
    setBatchRunning: handlers.setBatchRunning,
    startProgress: handlers.startProgress,
    isAborted: handlers.isAborted,
    shotVideoUrl: handlers.shotVideoUrl,
    setProgress: handlers.setProgress,
    setBatchProgress: handlers.setBatchProgress,
    capturePrevTailFrame: handlers.capturePrevTailFrame,
    buildShotSubmit: handlers.buildShotSubmit,
    submitOneAndWait: handlers.submitOneAndWait,
    completeProgress: handlers.completeProgress,
    saveScript: handlers.saveScript,
    recordGenerationBatch: handlers.recordGenerationBatch,
    beforeVideoSubmit: handlers.beforeVideoSubmit,
  };
}

export async function generateAllShotVideosFlow(handlers = {}, options = {}) {
  const project = handlers.project();
  if (!project) return;
  if (!handlers.ensureSubmitModeSupported()) return;
  const storyboard = handlers.storyboard();
  if (!storyboard) return;
  const currentShots = handlers.shots?.();
  const allShots = Array.isArray(currentShots) ? currentShots : handlers.parseShots(storyboard.content || '');
  const rangeRequested = Object.prototype.hasOwnProperty.call(options, 'fromNo')
    || Object.prototype.hasOwnProperty.call(options, 'toNo');
  const requestedFromNo = Number(options.fromNo);
  const requestedToNo = Number(options.toNo);
  const hasRange = Number.isInteger(requestedFromNo) && requestedFromNo > 0
    && Number.isInteger(requestedToNo) && requestedToNo > 0;
  if (rangeRequested && !hasRange) return handlers.warning('请输入有效的起止镜号');
  const fromNo = hasRange ? Math.min(requestedFromNo, requestedToNo) : null;
  const toNo = hasRange ? Math.max(requestedFromNo, requestedToNo) : null;
  const shots = hasRange
    ? allShots.filter((shot) => {
      const no = Number(shot?.no);
      return Number.isFinite(no) && no >= fromNo && no <= toNo;
    })
    : allShots;

  if (hasRange && !shots.length) {
    return handlers.warning(`指定范围内没有分镜（${fromNo}~${toNo}）`);
  }

  // 跳过判定与串行管线保持一致：内存 map 没记录时回退看分镜数据里的 shotVideos 记录并回填，
  // 避免重启后没点开过的集被当成缺视频整集重烧；在途任务（queued/generating）也算已处理。
  const shotHasVideoOnRecord = (no) => {
    if (handlers.shotVideoUrl(no)) return true;
    const key = handlers.shotKey(no);
    if (['queued', 'generating'].includes(handlers.shotVideoStatus(no))) return true;
    const meta = storyboard?.shotVideos?.[String(no)];
    const url = String(meta?.videoUrl || '').trim();
    if (url) {
      handlers.backfillShotVideo?.(key, url);
      return true;
    }
    return false;
  };

  const pending = [];
  for (const shot of shots) {
    if (shotHasVideoOnRecord(shot.no)) continue;
    const status = handlers.shotVideoStatus(shot.no);
    if (status === 'queued' || status === 'generating') continue;
    const submit = handlers.buildShotSubmit(shot);
    if (submit) pending.push(submit);
  }

  // 产出预算：本次最多提交 maxNewShots 个新镜头（超出部分不提交、不计入）
  const budgetLimit = options.maxNewShots != null ? Math.max(0, Math.floor(Number(options.maxNewShots))) : null;
  const effectivePending = budgetLimit != null ? pending.slice(0, budgetLimit) : pending;
  if (budgetLimit != null && pending.length > effectivePending.length) {
    handlers.info?.(`产出预算限制：本次仅提交 ${effectivePending.length} 镜，超出预算的 ${pending.length - effectivePending.length} 镜未提交`);
  }

  if (!effectivePending.length) {
    // silent（批量跑已完成集）：无可提交镜头属正常路径，不弹警告
    const message = hasRange
      ? `指定范围内没有可提交的分镜（${fromNo}~${toNo}；可能已生成、已提交或缺少视频提示词）`
      : (budgetLimit === 0 ? '已达到产出预算，本次没有提交任何镜头' : '没有可提交的分镜（要么已生成/已提交，要么视频提示词为空）');
    if (!options.silent) handlers.warning(message);
    return { generated: 0 };
  }

  const episodeId = handlers.episodeId();
  for (const submit of effectivePending) handlers.resumeShotTracking?.(submit.shotNo, project.id, episodeId);
  const uiOperation = handlers.claimUiOperation();
  handlers.setBatchRunning(true);
  const batchProviderLabel = providerLabelForSubmits(handlers, pending);
  handlers.setBatchProgress(`正在提交${batchProviderLabel}...`);
  handlers.startProgress(pending.length, handlers.batchProgress());
  try {
    const approved = await waitBeforeVideoSubmit(handlers, {
      episodeId,
      shotNos: effectivePending.map((submit) => submit.shotNo),
    });
    if (!approved) {
      handlers.abandonUiOperation?.(uiOperation);
      handlers.setBatchRunning(false);
      handlers.completeProgress('warning', 'Video submission canceled');
      return;
    }
    const result = await handlers.submitBatch({
      projectId: project.id,
      episodeId,
      shots: effectivePending,
      // 并行提交并发数（服务端 body.concurrency || cfg.video.apiConcurrency || 3）
      ...(Number(options.concurrency) > 0 ? { concurrency: Math.max(1, Math.min(5, Math.floor(Number(options.concurrency)))) } : {}),
    });
    if (result.jobId) {
      handlers.recordGenerationBatch?.(effectivePending.map((submit) => submit.shotNo), {
        projectId: project.id,
        episodeId,
        kind: hasRange ? 'range' : 'batch',
      });
    }
    if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
    if (!result.jobId) {
      for (const submit of effectivePending) {
        if (handlers.isShotTrackingStopped?.(submit.shotNo, project.id, episodeId)) continue;
        setShotFailure(handlers, handlers.shotKey(submit.shotNo), result.error, '视频提交失败');
      }
      handlers.setBatchRunning(false);
      handlers.completeProgress('exception', result.error || '提交失败');
      return handlers.error(result.error || '提交失败');
    }
    for (const submit of effectivePending) {
      const key = handlers.shotKey(submit.shotNo);
      if (handlers.isShotTrackingStopped?.(submit.shotNo, project.id, episodeId)) {
        handlers.deleteShotStatus?.(key);
        handlers.deleteShotProgress?.(key);
        continue;
      }
      handlers.setShotStatus(key, 'queued');
      setEstimatedShotProgress(handlers, key, 1);
    }
    handlers.success(`已提交${batchProviderLabel}：${effectivePending.length} 镜`);
    handlers.pollSubmitJob(result.jobId, effectivePending.map((submit) => submit.shotNo), {
      projectId: project.id,
      episodeId,
      uiOperation,
    });
    handlers.setBatchRunning(false);
    return { generated: effectivePending.length };
  } catch (error) {
    if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
    for (const submit of effectivePending) {
      if (handlers.isShotTrackingStopped?.(submit.shotNo, project.id, episodeId)) continue;
      setShotFailure(handlers, handlers.shotKey(submit.shotNo), error, '视频提交失败');
    }
    handlers.setBatchRunning(false);
    handlers.completeProgress('exception', error.message || '提交失败');
    handlers.error('提交失败：' + (error.message || error));
  }
}

export async function generateShotVideoFlow(shot, handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  if (!handlers.ensureSubmitModeSupported()) return;
  const submit = handlers.buildShotSubmit(shot);
  if (!submit) return handlers.warning('该分镜的视频提示词为空，无法生成视频');
  const key = handlers.shotKey(shot.no);
  const status = handlers.shotStatus(key);
  if (status === 'queued' || status === 'generating') {
    return handlers.warning('该镜头已提交，正在等待生成结果');
  }
  const episodeId = handlers.episodeId();
  const approved = await waitBeforeVideoSubmit(handlers, {
    episodeId,
    shotNos: [submit.shotNo],
  });
  if (!approved) return { ok: false, cancelled: true };
  handlers.resumeShotTracking?.(shot.no, project.id, episodeId);
  const uiOperation = handlers.claimUiOperation();
  const hadVideo = !!handlers.shotVideoUrl(shot.no);
  if (hadVideo || handlers.shotVideoStatus(shot.no) === 'failed') {
    // Lock the shot before awaiting cleanup. A second click can otherwise enter
    // while the first request is clearing the previous task and submit twice.
    handlers.setShotStatus(key, 'generating');
    setEstimatedShotProgress(handlers, key, 1);
    try {
      await handlers.resetShotVideo(shot.no);
    } catch (error) {
      if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
        handlers.abandonUiOperation(uiOperation);
        return;
      }
      setShotFailure(handlers, key, error, '旧任务清理失败');
      return handlers.error(error.message || '旧视频清理失败，请稍后重试');
    }
    if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
    if (handlers.isShotTrackingStopped?.(shot.no, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
  }

  handlers.setSubmitting(true);
  handlers.setBatchRunning(true);
  const submitProviderLabel = providerLabelForSubmit(handlers, submit);
  const progress = `正在提交${submitProviderLabel}镜头 ${shot.no}...`;
  handlers.setBatchProgress(progress);
  handlers.setShotStatus(key, 'generating');
  setEstimatedShotProgress(handlers, key, 2);
  handlers.startProgress(1, progress);
  try {
    const result = await handlers.submitBatch({
      projectId: project.id,
      episodeId,
      shots: [submit],
    });
    if (result.jobId) {
      handlers.recordGenerationBatch?.([submit.shotNo], {
        projectId: project.id,
        episodeId,
        kind: 'single',
      });
    }
    if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
    if (handlers.isShotTrackingStopped?.(shot.no, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
    if (!result.jobId) {
      setShotFailure(handlers, key, result.error, '视频提交失败');
      handlers.setBatchRunning(false);
      handlers.completeProgress('exception', result.error || '提交失败');
      return handlers.error(result.error || '提交失败');
    }
    handlers.success(`镜头 ${shot.no} 已提交${submitProviderLabel}，生成完成后自动拉回`);
    handlers.pollSubmitJob(result.jobId, [submit.shotNo], {
      projectId: project.id,
      episodeId,
      uiOperation,
    });
    handlers.setBatchRunning(false);
  } catch (error) {
    if (!handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
    if (handlers.isShotTrackingStopped?.(shot.no, project.id, episodeId)) {
      handlers.abandonUiOperation(uiOperation);
      return;
    }
    setShotFailure(handlers, key, error, '视频提交失败');
    handlers.setBatchRunning(false);
    handlers.completeProgress('exception', error.message || '提交失败');
    handlers.error('提交失败：' + (error.message || error));
  } finally {
    if (handlers.isUiOperationCurrent(uiOperation, project.id, episodeId)) {
      handlers.setSubmitting(false);
    }
  }
}

export function createPollVideoSubmitJobContext(handlers = {}) {
  return {
    ...handlers.message,
    status: (jobId) => handlers.api.get(`/api/video/status?jobId=${encodeURIComponent(jobId)}`),
    setBatchProgress: (message) => { handlers.batchProgressRef.value = message; },
    batchProgress: () => handlers.batchProgressRef.value,
    updateProgress: handlers.updateProgress,
    shotKey: handlers.shotKey,
    setShotStatus: handlers.setShotStatus,
    deleteShotStatus: handlers.deleteShotStatus,
    isShotTrackingStopped: handlers.isShotTrackingStopped,
    shotProgress: handlers.shotProgress,
    setShotProgress: handlers.setShotProgress,
    deleteShotProgress: handlers.deleteShotProgress,
    setBatchRunning: (running) => { handlers.batchRunningRef.value = running; },
    clearSchedulerSlots: () => { handlers.schedulerSlotsRef.value = []; },
    completeProgress: handlers.completeProgress,
    removeQueueShot: handlers.removeQueueShot,
    startPendingPoll: handlers.startPendingPoll,
    queueLength: () => handlers.queue.items.length,
    setQueueProcessing: (processing) => { handlers.queue.processing = processing; },
    scheduleQueueProcessing: handlers.scheduleQueueProcessing,
    isContextCurrent: handlers.isContextCurrent || (() => true),
    onContextInvalidated: handlers.onContextInvalidated || (() => {}),
    onFinished: handlers.onFinished || (() => {}),
  };
}

export function releaseManagedVideoSubmitJobFlow(status = {}, shotNos = [], { fromQueue = false } = {}, handlers = {}) {
  if (status.queueManaged !== true || ['done', 'error', 'failed', 'cancelled'].includes(status.status)) return false;
  handlers.startPendingPoll();
  handlers.setBatchRunning(false);
  handlers.clearSchedulerSlots();
  handlers.completeProgress('success', status.message || '视频任务已进入后台队列');
  if (fromQueue) {
    for (const no of shotNos) handlers.removeQueueShot(no);
    handlers.setQueueProcessing(false);
  }
  return true;
}

export function createPollVideoSubmitJobRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return createPollVideoSubmitJobContext({
    api,
    message,
    batchProgressRef: refs.batchProgress,
    updateProgress: helpers.updateProgress,
    shotKey: helpers.shotKey,
    setShotStatus: (key, status) => { refs.shotStatus[key] = status; },
    deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
    isShotTrackingStopped: helpers.isShotTrackingStopped,
    shotProgress: (key) => refs.shotProgress?.[key],
    setShotProgress: (key, progress) => { if (refs.shotProgress) refs.shotProgress[key] = progress; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
    batchRunningRef: refs.batchRunning,
    schedulerSlotsRef: refs.schedulerSlots,
    completeProgress: helpers.completeProgress,
    removeQueueShot: helpers.removeQueueShot || ((shotNo) => removeShotFromVideoQueue(refs.queue?.items, shotNo)),
    startPendingPoll: helpers.startPendingPoll,
    queue: refs.queue,
    scheduleQueueProcessing: helpers.scheduleQueueProcessing,
    isContextCurrent: helpers.isContextCurrent,
    onContextInvalidated: helpers.onContextInvalidated,
    onFinished: helpers.onFinished,
  });
}

export function pollVideoSubmitJobFlow(jobId, shotNos = [], { fromQueue = false } = {}, handlers = {}) {
  const tick = async () => {
    if (!handlers.isContextCurrent()) {
      handlers.onContextInvalidated();
      return;
    }
    let status;
    try {
      status = await handlers.status(jobId);
    } catch {
      if (!handlers.isContextCurrent()) {
        handlers.onContextInvalidated();
        return;
      }
      setTimeout(tick, 3000);
      return;
    }
    if (!handlers.isContextCurrent()) {
      handlers.onContextInvalidated();
      return;
    }

    handlers.setBatchProgress(status.message || '');
    handlers.updateProgress(status, shotNos);
    applyVideoSubmitSlots(status, handlers);
    if (releaseManagedVideoSubmitJobFlow(status, shotNos, { fromQueue }, handlers)) {
      handlers.onFinished();
      return;
    }

    if (['done', 'error', 'failed', 'cancelled'].includes(status.status)) {
      handlers.setBatchRunning(false);
      if (fromQueue) handlers.setQueueProcessing(false);
      handlers.clearSchedulerSlots();
      handlers.completeProgress(
        status.status === 'done' ? 'success' : 'exception',
        status.message || status.error || handlers.batchProgress()
      );
      const submits = status.submits || {};
      const ignoredShotNos = new Set((status.ignoredShotNos || []).map(String));
      for (const no of shotNos) {
        const key = handlers.shotKey(no);
        const result = submits[no];
        if (ignoredShotNos.has(String(no)) || result?.ignored || result?.cancelled || handlers.isShotTrackingStopped?.(no)) {
          handlers.deleteShotStatus?.(key);
          handlers.deleteShotProgress?.(key);
          if (fromQueue) handlers.removeQueueShot(no);
          continue;
        }
        if (result?.ok) {
          handlers.setShotStatus(key, 'queued');
          setEstimatedShotProgress(handlers, key, 6);
          if (fromQueue) handlers.removeQueueShot(no);
        } else if (result || ['done', 'error', 'failed', 'cancelled'].includes(status.status)) {
          setShotFailure(handlers, key, result?.error || status.error, '视频提交失败');
          if (fromQueue) handlers.removeQueueShot(no);
        }
      }

      if (status.status === 'done') {
        handlers.success(status.message || `已提交 ${status.submitted || 0} 个分镜，生成完成后自动拉回`);
      } else {
        handlers.error('提交中断：' + (status.error || '未知'));
      }
      handlers.startPendingPoll();
      if (fromQueue && status.status === 'done' && handlers.queueLength() > 0) {
        handlers.setBatchProgress(`继续处理剩余 ${handlers.queueLength()} 个镜头...`);
        handlers.scheduleQueueProcessing(0);
      }
      handlers.onFinished();
      return;
    }

    setTimeout(tick, 2500);
  };
  setTimeout(tick, 1500);
}

export function waitForSubmitJobFlow(jobId, shotNo, handlers = {}) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 30;

    const tick = async () => {
      if (!handlers.isProcessing()) {
        reject(new Error('队列已暂停'));
        return;
      }

      if (attempts >= maxAttempts) {
        reject(new Error('提交超时'));
        return;
      }
      attempts++;

      try {
        const status = await handlers.status(jobId);
        if (status.status === 'done' || status.status === 'error') {
          const submits = status.submits || {};
          const result = submits[shotNo];
          if (result?.ok) {
            handlers.setQueued(shotNo);
            resolve();
          } else {
            reject(new Error(result?.error || '提交失败'));
          }
        } else {
          setTimeout(tick, 2000);
        }
      } catch {
        setTimeout(tick, 3000);
      }
    };
    setTimeout(tick, 1500);
  });
}

export function waitForVideoCompleteFlow(shotNo, handlers = {}) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 120;

    const tick = async () => {
      if (!handlers.isProcessing()) {
        reject(new Error('队列已暂停'));
        return;
      }

      const key = handlers.shotKey(shotNo);
      if (handlers.shotStatus(key) === 'failed') {
        const progress = currentShotProgress(handlers, key);
        reject(new Error(progress.error || progress.note || '视频生成失败'));
        return;
      }

      if (attempts >= maxAttempts) {
        reject(new Error('等待超时'));
        return;
      }
      attempts++;

      try {
        await handlers.pollPendingOnce();

        if (handlers.shotStatus(key) === 'failed') {
          const progress = currentShotProgress(handlers, key);
          reject(new Error(progress.error || progress.note || '视频生成失败'));
          return;
        }

        if (handlers.shotVideoUrl(shotNo)) {
          handlers.deleteShotStatus(key);
          handlers.deleteShotProgress?.(key);
          resolve();
        } else {
          setTimeout(tick, 5000);
        }
      } catch {
        setTimeout(tick, 5000);
      }
    };
    setTimeout(tick, 5000);
  });
}

export function createVideoQueueWaitRuntime({ api, refs = {}, helpers = {} } = {}) {
  const baseContext = {
    project: () => refs.project.value,
    episodeId: () => refs.episodeId.value,
    shotKey: helpers.shotVideoKey,
    shotStatus: (key) => refs.shotStatus[key],
    deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
  };
  return {
    waitForSubmitJob: (jobId, shotNo) => waitForSubmitJobFlow(jobId, shotNo, {
      isProcessing: () => refs.queue.processing,
      status: (statusJobId) => api.get(`/api/video/status?jobId=${encodeURIComponent(statusJobId)}`),
      setQueued: (queuedShotNo) => { refs.shotStatus[helpers.shotVideoKey(queuedShotNo)] = 'queued'; },
    }),
    waitForVideoComplete: (shotNo) => waitForVideoCompleteFlow(shotNo, {
      ...baseContext,
      isProcessing: () => refs.queue.processing,
      pollPendingOnce: helpers.pollPendingOnce,
      shotVideoUrl: helpers.shotVideoUrl,
    }),
  };
}

export async function refetchShotVideoFlow(no, handlers = {}, options = {}) {
  const silent = options.silent === true;
  const notifySuccess = (text) => { if (!silent) handlers.success?.(text); };
  const notifyInfo = (text) => { if (!silent) handlers.info?.(text); };
  const notifyWarning = (text) => handlers.warning?.(text);
  const project = options.projectId != null
    ? { id: options.projectId }
    : handlers.project?.();
  const projectId = options.projectId ?? project?.id;
  const episodeId = options.episodeId ?? handlers.episodeId();
  const requestScope = {
    episodeId,
    ...(projectId != null ? { projectId } : {}),
  };
  const key = handlers.shotVideoKey(no, episodeId);
  const status = handlers.shotVideoStatus(no, episodeId);
  if (status !== 'queued' && status !== 'failed' && status !== 'generating') {
    return notifyWarning('只能重新抓取"已提交"、"提交中"或"生成失败"状态的视频');
  }
  try {
    handlers.setShotStatus(key, status === 'generating' ? 'generating' : 'queued');
    setEstimatedShotProgress(handlers, key, status === 'generating' ? 2 : 1);
    const pollResult = await handlers.pollPendingOnce({ ...requestScope, shotNo: no, retry: true });
    const statusSuffix = `:${episodeId}:${no}`;
    const remoteStatus = Object.entries(pollResult?.statuses || {})
      .find(([statusKey]) => statusKey.endsWith(statusSuffix))?.[1] || null;
    if (handlers.shotVideoUrl(no, episodeId) || await handlers.syncShotVideosFromServer({ ...requestScope, shotNo: no, allowActiveStatus: true })) {
      notifySuccess(`镜头 ${no} 已拉回`);
      return 'done';
    }
    const pendingState = await handlers.pendingState(projectId);
    // Failed tasks stay in the pending store until cleared or retried; they
    // must not read as "still generating" or the refetch hint misleads.
    const pendingTask = (pendingState.pending || []).find((task) =>
      String(task.episodeId) === String(episodeId) &&
      String(task.shotNo) === String(no)
    );
    const stillPending = pendingTask && pendingTask.status !== 'failed';
    const pendingMessage = () => {
      const detail = String(remoteStatus?.note || pendingTask?.note || '').trim();
      if (detail) return `镜头 ${no}：${detail}`;
      const provider = remoteStatus?.provider || pendingTask?.provider;
      return provider === 'updream'
        ? `UpDream 确认镜头 ${no} 仍在生成，已保持自动抓取`
        : `镜头 ${no} 仍在生成中，请稍后再试`;
    };
    if (!stillPending || handlers.shotVideoStatus(no, episodeId) === 'failed') {
      if (await handlers.syncShotVideosFromServer({ ...requestScope, shotNo: no, allowActiveStatus: true })) {
        notifySuccess(`镜头 ${no} 已拉回`);
        return 'done';
      }
      if (status === 'generating') {
        handlers.setShotStatus(key, 'generating');
        setEstimatedShotProgress(handlers, key, 2);
        notifyInfo(pendingMessage());
        return 'pending';
      }
      const reason = `镜头 ${no} 后台没有可拉回任务，请重新生成`;
      setShotFailure(handlers, key, reason);
      notifyWarning(reason);
      return 'failed';
    } else {
      notifyInfo(pendingMessage());
      return 'pending';
    }
  } catch (error) {
    handlers.error?.('拉取失败：' + (error.message || error));
    return 'failed';
  }
}

export function createRefetchShotVideoRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    project: () => refs.project.value,
    shotVideoKey: helpers.shotVideoKey,
    shotVideoStatus: helpers.shotVideoStatus,
    setShotStatus: (key, status) => { refs.shotStatus[key] = status; },
    shotProgress: (key) => refs.shotProgress?.[key],
    setShotProgress: (key, progress) => { if (refs.shotProgress) refs.shotProgress[key] = progress; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
    pollPendingOnce: helpers.pollPendingOnce,
    shotVideoUrl: helpers.shotVideoUrl,
    syncShotVideosFromServer: helpers.syncShotVideosFromServer,
    pendingState: (projectId = refs.project.value.id) => api.get(`/api/video/pending?projectId=${encodeURIComponent(projectId)}`),
    episodeId: () => refs.episodeId.value,
  };
}

export function createRefetchShotVideoRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return (no, options = {}) => refetchShotVideoFlow(no, createRefetchShotVideoRuntimeContext({ api, message, refs, helpers }), options);
}

export async function syncShotVideosFromServerFlow(options = {}, handlers = {}) {
  const {
    shotNo = null,
    allowActiveStatus = false,
    allowActiveStatusForShots = [],
    projectId: requestedProjectId = null,
    episodeId: requestedEpisodeId = null,
  } = options;
  const projectId = requestedProjectId ?? handlers.projectId();
  if (!projectId) return false;
  const allowSet = new Set((allowActiveStatusForShots || []).map((no) => String(no)));
  try {
    const fresh = await handlers.fetchProject(projectId);
    const storyboards = fresh?.project?.script?.storyboards || [];
    const episodeId = requestedEpisodeId ?? handlers.episodeId();
    const freshStoryboard = storyboards.find((item) => String(item.episodeId) === String(episodeId));
    const map = freshStoryboard?.shotVideos || {};
    const localStoryboard = handlers.storyboard(episodeId, projectId);
    let matched = false;
    for (const [no, meta] of Object.entries(map)) {
      if (shotNo != null && String(no) !== String(shotNo)) continue;
      if (!meta?.videoUrl) continue;
      const localKey = `${episodeId}:${no}`;
      if (!allowActiveStatus && handlers.shotStatus?.(localKey) && !allowSet.has(String(no))) continue;
      handlers.setShotVideo(localKey, meta.videoUrl);
      handlers.deleteShotStatus(localKey);
      handlers.deleteShotProgress?.(localKey);
      if (localStoryboard) {
        if (!localStoryboard.shotVideos || typeof localStoryboard.shotVideos !== 'object') localStoryboard.shotVideos = {};
        localStoryboard.shotVideos[String(no)] = meta;
      }
      matched = true;
    }
    return matched;
  } catch {
    return false;
  }
}

export function createSyncShotVideosFromServerRuntimeContext({ api, refs = {}, helpers = {} } = {}) {
  return {
    projectId: () => refs.project.value?.id,
    fetchProject: (projectId) => api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    episodeId: () => refs.episodeId.value,
    storyboard: (episodeId, projectId) => {
      const currentEpisodeId = episodeId ?? refs.episodeId.value;
      const currentProjectId = projectId ?? refs.project.value?.id;
      if (!currentProjectId || !refs.project.value) return null;
      return String(refs.project.value.id) === String(currentProjectId)
        ? helpers.findStoryboard(currentEpisodeId)
        : null;
    },
    setShotVideo: (key, url) => { refs.shotVideos[key] = url; },
    shotStatus: (key) => refs.shotStatus[key] || '',
    deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
  };
}

export function createSyncShotVideosFromServerRuntime({ api, refs = {}, helpers = {} } = {}) {
  return (options = {}) => syncShotVideosFromServerFlow(
    options,
    createSyncShotVideosFromServerRuntimeContext({ api, refs, helpers })
  );
}

// 任务从服务器状态里消失后的连续未命中计数（按轮询上下文隔离）：
// 达到阈值判定为「后台无可拉回任务」收尾为失败，避免镜头 pill 永远僵在「已提交」。
const pendingMissCounts = new WeakMap();
const PENDING_MISS_LIMIT = 3; // 轮询间隔 15s × 3 ≈ 45s 宽限期（等后台下载落盘）
const ACTIVE_SHOT_STATUSES = new Set(['queued', 'generating']);

export async function pollPendingOnceFlow(handlers = {}, options = {}) {
  const project = handlers.project();
  if (!project) return;
  let result;
  try {
    result = await handlers.poll({ projectId: project.id, ...options });
  } catch {
    return;
  }
  const storyboard = handlers.storyboard();
  let changed = false;
  const statusEntries = Object.entries(result.statuses || {});
  const trackedKeys = new Set();
  for (const [key, status] of statusEntries) {
    const parts = key.split(':');
    const no = parts[parts.length - 1];
    const episodeId = parts[parts.length - 2];
    const localKey = `${episodeId}:${no}`;
    trackedKeys.add(localKey);
    if (status.status === 'done' && status.videoUrl) {
      handlers.setShotVideo(localKey, status.videoUrl);
      handlers.deleteShotStatus(localKey);
      handlers.deleteShotProgress?.(localKey);
      if (storyboard && String(storyboard.episodeId) === String(episodeId)) {
        if (!storyboard.shotVideos || typeof storyboard.shotVideos !== 'object') storyboard.shotVideos = {};
        storyboard.shotVideos[String(no)] = { videoUrl: status.videoUrl, updatedAt: new Date().toISOString() };
        changed = true;
      }
    } else if (status.status === 'failed') {
      handlers.setShotStatus(localKey, 'failed');
      setShotProgressFromStatus(handlers, localKey, status);
    } else if (status.status === 'running') {
      // 上游任务日志（rolldek）显示正在生成：视频区显示「生成中」并带上真实进度，
      // 而不是和排队一起塌缩成「已提交 + 估算进度」。
      handlers.setShotStatus(localKey, 'generating');
      setShotProgressFromStatus(handlers, localKey, status);
    } else {
      handlers.setShotStatus(localKey, 'queued');
      setShotProgressFromStatus(handlers, localKey, status);
    }
  }
  if (changed) handlers.saveScript();
  // Shots still marked active (queued/generating) locally but absent from the
  // server statuses either finished (background poll downloaded the video and
  // dropped the pending task before this client saw `done`) or were lost.
  // Without the allow-list, syncShotVideosFromServer skips any shot that has
  // an active local status, so the finished video never appears until a manual
  // refetch. 注意：必须覆盖所有「进行中」状态，只处理 queued 会让
  // generating/其他活跃状态的镜头在任务消失后永远僵在「已提交」。
  const missingByEpisode = new Map(); // episodeId -> [shotNo]
  if (typeof handlers.shotStatusKeys === 'function' && typeof handlers.shotStatus === 'function') {
    const missCounts = pendingMissCounts.get(handlers) || (() => {
      const map = new Map();
      pendingMissCounts.set(handlers, map);
      return map;
    })();
    for (const key of [...missCounts.keys()]) {
      if (!handlers.shotStatus(key) || trackedKeys.has(key) || !ACTIVE_SHOT_STATUSES.has(handlers.shotStatus(key))) missCounts.delete(key);
    }
    for (const localKey of handlers.shotStatusKeys()) {
      if (trackedKeys.has(localKey)) continue;
      if (!ACTIVE_SHOT_STATUSES.has(handlers.shotStatus(localKey) || '')) continue;
      const splitAt = localKey.lastIndexOf(':');
      if (splitAt < 0) continue;
      const episodeId = localKey.slice(0, splitAt);
      if (!missingByEpisode.has(episodeId)) missingByEpisode.set(episodeId, []);
      missingByEpisode.get(episodeId).push(localKey.slice(splitAt + 1));
    }
  }
  // 按集同步（每集一次），拿到视频的镜头会被 sync 自动清状态
  for (const [episodeId, shotNos] of missingByEpisode) {
    await handlers.syncShotVideosFromServer({ requestedEpisodeId: episodeId, allowActiveStatusForShots: shotNos });
  }
  // 同步后仍处于进行中状态的镜头：计入未命中，连续多轮都没有视频则收尾为失败
  if (missingByEpisode.size && typeof handlers.shotStatus === 'function') {
    const missCounts = pendingMissCounts.get(handlers);
    for (const [episodeId, shotNos] of missingByEpisode) {
      for (const no of shotNos) {
        const localKey = `${episodeId}:${no}`;
        if (!handlers.shotStatus(localKey)) {
          missCounts?.delete(localKey); // sync 已清状态 = 视频拿到了
          continue;
        }
        const misses = (missCounts?.get(localKey) || 0) + 1;
        missCounts?.set(localKey, misses);
        if (misses >= PENDING_MISS_LIMIT) {
          missCounts?.delete(localKey);
          setShotFailure(handlers, localKey, `镜头 ${no} 后台没有可拉回任务，请重新生成`);
        }
      }
    }
  }
  // pending 清空但本地还有进行中的镜头：不停止轮询，给丢失/在途的任务留出收尾机会
  const stillActive = typeof handlers.shotStatusKeys === 'function'
    && handlers.shotStatusKeys().some((key) => ACTIVE_SHOT_STATUSES.has(handlers.shotStatus(key) || ''));
  if ((result.pending || 0) === 0 && !stillActive && handlers.hasPendingPollTimer()) handlers.stopPendingPoll();
  return result;
}

export function createPollPendingOnceContext(handlers = {}) {
  return {
    project: () => handlers.projectRef.value,
    poll: (payload) => handlers.api.post('/api/video/poll', payload),
    storyboard: () => handlers.findStoryboard(handlers.episodeIdRef.value),
    episodeId: () => handlers.episodeIdRef.value,
    hasShotVideo: (key) => !!handlers.shotVideos[key],
    setShotVideo: (key, url) => { handlers.shotVideos[key] = url; },
    shotStatus: (key) => handlers.shotStatus[key],
    shotStatusKeys: () => Object.keys(handlers.shotStatus),
    deleteShotStatus: (key) => { delete handlers.shotStatus[key]; },
    setShotStatus: (key, status) => { handlers.shotStatus[key] = status; },
    shotProgress: (key) => handlers.shotProgress?.[key],
    setShotProgress: (key, progress) => { if (handlers.shotProgress) handlers.shotProgress[key] = progress; },
    deleteShotProgress: (key) => { if (handlers.shotProgress) delete handlers.shotProgress[key]; },
    saveScript: handlers.saveScript,
    syncShotVideosFromServer: handlers.syncShotVideosFromServer,
    hasPendingPollTimer: handlers.hasPendingPollTimer,
    stopPendingPoll: handlers.stopPendingPoll,
  };
}

export function createPollPendingOnceRuntimeContext({ api, refs = {}, helpers = {} } = {}) {
  return createPollPendingOnceContext({
    api,
    projectRef: refs.project,
    findStoryboard: helpers.findStoryboard,
    episodeIdRef: refs.episodeId,
    shotVideos: refs.shotVideos,
    shotStatus: refs.shotStatus,
    shotProgress: refs.shotProgress,
    saveScript: helpers.saveScript,
    syncShotVideosFromServer: helpers.syncShotVideosFromServer,
    hasPendingPollTimer: helpers.hasPendingPollTimer,
    stopPendingPoll: helpers.stopPendingPoll,
  });
}

export function createPendingPollController({ intervalMs = 15000, timer = {}, handlers = {}, globals = {} } = {}) {
  const getTimer = timer.get || (() => null);
  const setTimer = timer.set || (() => {});
  const setIntervalFn = globals.setInterval || globalThis.setInterval;
  const clearIntervalFn = globals.clearInterval || globalThis.clearInterval;
  let inFlight = false;
  const poll = () => {
    if (inFlight) return;
    inFlight = true;
    let result;
    try { result = handlers.poll(); } catch { inFlight = false; return; }
    Promise.resolve(result)
      .catch((error) => {
        // 别静默吞掉：否则轮询一旦开始报错，视频状态会永远停在旧值、界面上毫无提示。
        if (typeof handlers.onError === 'function') handlers.onError(error);
        else console.warn('[video] 状态轮询失败：', error?.message || error);
      })
      .finally(() => { inFlight = false; });
  };
  return {
    isRunning: () => !!getTimer(),
    start: () => {
      if (getTimer()) return;
      poll();
      setTimer(setIntervalFn(poll, intervalMs));
    },
    stop: () => {
      const current = getTimer();
      if (current) clearIntervalFn(current);
      setTimer(null);
    },
  };
}

export function createPendingPollRuntimeContext({ api, refs = {}, helpers = {}, intervalMs = 15000 } = {}) {
  let pendingPollTimer = null;
  let controller = null;
  const pollPendingOnce = (options = {}) => pollPendingOnceFlow(createPollPendingOnceRuntimeContext({
    api,
    refs,
    helpers: {
      ...helpers,
      hasPendingPollTimer: () => getController().isRunning(),
      stopPendingPoll: () => getController().stop(),
    },
  }), options);
  const getController = () => {
    if (!controller) {
      controller = createPendingPollController({
        intervalMs,
        timer: {
          get: () => pendingPollTimer,
          set: (timer) => { pendingPollTimer = timer; },
        },
        handlers: { poll: pollPendingOnce },
      });
    }
    return controller;
  };
  return {
    pollPendingOnce,
    startPendingPoll: () => getController().start(),
    stopPendingPoll: () => getController().stop(),
    hydratePending: () => hydratePendingVideosFlow(createHydratePendingVideosRuntimeContext({
      api,
      refs,
      helpers: {
        shotVideoUrl: helpers.shotVideoUrl,
        syncShotVideosFromServer: helpers.syncShotVideosFromServer,
        startPendingPoll: () => getController().start(),
      },
    })),
  };
}

export function createHydratePendingVideosRuntimeContext({ api, refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    pendingState: (projectId) => api.get(`/api/video/pending?projectId=${encodeURIComponent(projectId)}`),
    episodeId: () => refs.episodeId.value,
    shotVideoUrl: helpers.shotVideoUrl,
    shotStatus: (key) => refs.shotStatus[key],
    setShotStatus: (key, status) => { refs.shotStatus[key] = status; },
    deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
    shotProgress: (key) => refs.shotProgress?.[key],
    setShotProgress: (key, progress) => { if (refs.shotProgress) refs.shotProgress[key] = progress; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
    shotStatusKeys: () => Object.keys(refs.shotStatus),
    hasShotVideo: (key) => !!refs.shotVideos[key],
    syncShotVideosFromServer: helpers.syncShotVideosFromServer,
    startPendingPoll: helpers.startPendingPoll,
  };
}

export async function hydratePendingVideosFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  try {
    const result = await handlers.pendingState(project.id);
    let has = false;
    const seen = new Set();
    for (const task of (result.pending || [])) {
      const key = `${task.episodeId}:${task.shotNo}`;
      seen.add(key);
      if (String(task.episodeId) === String(handlers.episodeId())) {
        const localKey = `${handlers.episodeId()}:${task.shotNo}`;
        const taskStatus = task.status === 'failed'
          ? 'failed'
          : (task.upstreamStatus === 'IN_PROGRESS' ? 'generating' : 'queued');
        if (handlers.shotStatus(localKey) === 'failed' && taskStatus !== 'failed') continue;
        handlers.setShotStatus(localKey, taskStatus);
        setShotProgressFromStatus(handlers, localKey, task);
        if (taskStatus !== 'failed') has = true;
      }
    }
    await handlers.syncShotVideosFromServer();
    for (const key of handlers.shotStatusKeys()) {
      if (handlers.shotStatus(key) === 'failed') {
        if (!seen.has(key)) {
          handlers.deleteShotStatus(key);
          handlers.deleteShotProgress?.(key);
        }
        continue;
      }
      if (handlers.shotStatus(key) !== 'queued') continue;
      if (!seen.has(key)) {
        handlers.deleteShotStatus(key);
        handlers.deleteShotProgress?.(key);
      }
    }
    if (has) handlers.startPendingPoll();
  } catch { /* ignore */ }
}

export async function submitOneAndWaitFlow(submit, handlers = {}, options = {}) {
  const {
    timeoutMs = 30 * 60 * 1000,
    intervalMs = 4000,
    projectId: requestedProjectId = null,
    episodeId: requestedEpisodeId = null,
    onSubmitted = null,
  } = options;
  if (!handlers.ensureSubmitModeSupported()) throw new Error('当前视频平台不支持真实 @ 素材标签');
  const projectId = requestedProjectId ?? handlers.projectId();
  const episodeId = requestedEpisodeId ?? handlers.episodeId();
  const approved = await waitBeforeVideoSubmit(handlers, {
    episodeId,
    shotNos: [submit.shotNo],
    skipSafety: options.skipSafety === true,
  });
  if (!approved) return 'aborted';
  const key = handlers.shotKey(submit.shotNo, episodeId);
  handlers.resumeShotTracking?.(submit.shotNo, projectId, episodeId);
  handlers.setShotStatus(key, 'queued');
  setEstimatedShotProgress(handlers, key, 1);
  const result = await handlers.submitBatch({
    projectId,
    episodeId,
    shots: [submit],
  });
  if (result.jobId) onSubmitted?.(submit.shotNo);
  if (handlers.isShotTrackingStopped?.(submit.shotNo, projectId, episodeId)) {
    handlers.deleteShotStatus(key);
    handlers.deleteShotProgress?.(key);
    return 'aborted';
  }
  if (!result.jobId) {
    setShotFailure(handlers, key, result.error, '视频提交失败');
    throw new Error(result.error || '提交失败');
  }
  const startedAt = Date.now();
  let submitReady = typeof handlers.submitStatus !== 'function';
  while (!submitReady && Date.now() - startedAt < timeoutMs) {
    if (handlers.isAborted() || handlers.isShotTrackingStopped?.(submit.shotNo, projectId, episodeId)) {
      handlers.deleteShotStatus(key);
      handlers.deleteShotProgress?.(key);
      return 'aborted';
    }
    let submitStatus;
    try {
      submitStatus = await handlers.submitStatus(result.jobId);
    } catch {
      await delay(Math.min(intervalMs, 2000));
      continue;
    }
    if (submitStatus.status === 'done' || submitStatus.status === 'error') {
      const submitResult = submitStatus.submits?.[submit.shotNo];
      if (submitResult?.ok) {
        submitReady = true;
        break;
      }
      setShotFailure(handlers, key, submitResult?.error || submitStatus.error || submitStatus.message, '视频提交失败');
      return 'failed';
    }
    await delay(Math.min(intervalMs, 2000));
  }
  if (!submitReady) {
    setShotFailure(handlers, key, '等待视频提交结果超时');
    return 'timeout';
  }

  while (Date.now() - startedAt < timeoutMs) {
    if (handlers.isAborted() || handlers.isShotTrackingStopped?.(submit.shotNo, projectId, episodeId)) {
      handlers.deleteShotStatus(key);
      handlers.deleteShotProgress?.(key);
      return 'aborted';
    }
    await delay(intervalMs);
    let poll;
    try {
      poll = await handlers.pollVideo({ projectId });
    } catch {
      continue;
    }

    let targetSeen = false;
    for (const [statusKey, status] of Object.entries(poll.statuses || {})) {
      const parts = statusKey.split(':');
      const no = parts[parts.length - 1];
      const statusEpisodeId = parts[parts.length - 2];
      if (String(statusEpisodeId) !== String(episodeId)) continue;
      if (String(no) !== String(submit.shotNo)) continue;
      targetSeen = true;
      const localKey = `${statusEpisodeId}:${no}`;
      if (status.status === 'done' && status.videoUrl) {
        handlers.setShotVideo(localKey, status.videoUrl);
        handlers.deleteShotStatus(localKey);
        handlers.deleteShotProgress?.(localKey);
      } else if (status.status === 'failed') {
        handlers.setShotStatus(localKey, 'failed');
        setShotProgressFromStatus(handlers, localKey, status);
      } else {
        handlers.setShotStatus(localKey, 'queued');
        setShotProgressFromStatus(handlers, localKey, status);
      }
    }

    if (!targetSeen && handlers.syncShotVideosFromServer) {
      await handlers.syncShotVideosFromServer({
        projectId,
        episodeId,
        shotNo: submit.shotNo,
        allowActiveStatus: true,
      });
    }
    if (handlers.shotVideoUrl(submit.shotNo, episodeId)) return 'done';
    if (handlers.shotVideoStatus(submit.shotNo, episodeId) === 'failed') return 'failed';
  }
  return 'timeout';
}

export async function runSequentialGenerationFlow({
  fromNo = null,
  toNo = null,
  projectId: requestedProjectId = null,
  episodeId: requestedEpisodeId = null,
  maxNewShots = null, // 新生成镜头数上限（用于"产出时长预算"），null = 不限；已有视频跳过的不计数
} = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  if (!handlers.ensureSubmitModeSupported()) return;
  if (handlers.isSequentialRunning()) return handlers.warning('顺序生成已在进行中');
  if (requestedProjectId != null && String(requestedProjectId) !== String(project.id)) {
    return handlers.warning('项目已切换，已跳过原项目中等待的首尾帧任务');
  }
  const projectId = project.id;
  const episodeId = requestedEpisodeId ?? handlers.episodeId();
  const storyboard = handlers.storyboard(episodeId, projectId);
  if (!storyboard) return;
  const currentShots = String(handlers.episodeId()) === String(episodeId) ? handlers.shots?.() : null;
  const shots = Array.isArray(currentShots) ? currentShots : handlers.parseShots(storyboard.content || '');
  if (!shots.length) return handlers.warning('本集没有分镜');

  const lo = fromNo == null ? -Infinity : Number(fromNo);
  const hi = toNo == null ? Infinity : Number(toNo);
  const inRange = (no) => {
    const n = Number(no);
    return n >= lo && n <= hi;
  };
  const activeStatuses = ['queued', 'generating'];
  // 跳过判定（防重复扣费的关键）：
  //   1) 内存 map 有 URL → 已出片，跳过；
  //   2) 内存 map 没有（重启后该集未被水合 / 被失败状态屏蔽）时，回退看分镜数据里的
  //      shotVideos 记录——有记录就按"已有视频"跳过，并回填内存（保证后续镜头能截到它的尾帧）；
  //   3) 只有 queued/generating 在途任务（无成品）→ 视为处理中，同样跳过不重复提交。
  // 之前只看内存 map：应用重启后没点开过的集不会被水合，整集被误判缺视频全部重烧。
  const shotHasVideo = (no) => {
    if (handlers.shotVideoUrl(no, episodeId)) return true;
    const status = String(handlers.shotVideoStatus?.(no, episodeId) || '');
    const meta = storyboard?.shotVideos?.[String(no)] || null;
    const url = String(meta?.videoUrl || '').trim();
    if (url && !activeStatuses.includes(status)) {
      handlers.backfillShotVideo?.(`${episodeId}:${no}`, url);
      return true;
    }
    return activeStatuses.includes(status); // 在途任务处理中，不重复提交
  };
  const targets = shots.filter((shot) => inRange(shot.no));
  if (!targets.length) return handlers.warning('该范围内没有分镜');
  const rangeLabel = (fromNo == null && toNo == null) ? '' : `（第${targets[0].no}~${targets[targets.length - 1].no}镜）`;

  handlers.setSequentialRunning(true);
  handlers.setAbort(false);
  handlers.setBatchRunning(true);
  handlers.startProgress(targets.length, `顺序生成${rangeLabel}：准备中...`);
  let done = 0;
  let generated = 0; // 本次新生成完成的镜头数（跳过的不计）
  let budgetExhausted = false;
  let prevNo = null;
  const submittedShotNos = [];
  try {
    for (const shot of shots) {
      if (handlers.isAborted()) {
        handlers.info('已停止顺序生成');
        break;
      }
      if (maxNewShots != null && generated >= maxNewShots) {
        budgetExhausted = true;
        break;
      }
      if (!inRange(shot.no)) {
        if (shotHasVideo(shot.no)) prevNo = shot.no;
        continue;
      }
      if (shotHasVideo(shot.no)) {
        prevNo = shot.no;
        done++;
        handlers.setProgress({ current: done });
        continue;
      }

      let opener = null;
      if (prevNo != null && handlers.shotVideoUrl(prevNo, episodeId)) {
        const detail = `镜头 ${shot.no}：截取上一镜尾帧...`;
        handlers.setBatchProgress(detail);
        handlers.setProgress({ detail });
        opener = await handlers.capturePrevTailFrame(shot.no, prevNo, { projectId, episodeId });
      }

      const submit = handlers.buildShotSubmit(shot, {
        episodeId,
        ...(opener ? { opener, openerFrameName: opener.name || '' } : {}),
      });
      if (!submit) {
        handlers.warning(`镜头 ${shot.no} 没有元素参考图也没有开场帧，已跳过`);
        prevNo = shot.no;
        continue;
      }
      const detail = `镜头 ${shot.no}：提交并等待出片...`;
      handlers.setBatchProgress(detail);
      handlers.setProgress({ current: done, detail });
      const outcome = await handlers.submitOneAndWait(submit, {
        projectId,
        episodeId,
        skipSafety: submittedShotNos.length > 0,
        onSubmitted: (shotNo) => {
          const key = String(shotNo ?? '').trim();
          if (key && !submittedShotNos.includes(key)) submittedShotNos.push(key);
          handlers.recordGenerationBatch?.(submittedShotNos, {
            projectId,
            episodeId,
            kind: 'sequential',
          });
        },
      });
      if (outcome === 'aborted') {
        handlers.info('已停止顺序生成');
        break;
      }
      if (outcome === 'done') {
        done++;
        generated++;
        handlers.setProgress({ current: done });
        if (maxNewShots != null && generated >= maxNewShots) {
          budgetExhausted = true;
          handlers.info(`已达本次产出预算（新生成 ${generated} 镜），顺序生成到此为止`);
          break;
        }
      } else if (outcome === 'failed') {
        handlers.error(`镜头 ${shot.no} 生成失败，已中断顺序生成`);
        break;
      } else {
        handlers.error(`镜头 ${shot.no} 等待出片超时，已中断顺序生成`);
        break;
      }
      prevNo = shot.no;
    }
    handlers.completeProgress(done === targets.length ? 'success' : 'warning', `顺序生成完成：${done}/${targets.length} 镜`);
  } catch (error) {
    handlers.completeProgress('exception', error.message || '顺序生成失败');
    handlers.error('顺序生成失败：' + (error.message || error));
  } finally {
    handlers.setSequentialRunning(false);
    handlers.setBatchRunning(false);
  }
  return { generated, budgetExhausted };
}

export function createSequentialGenerationRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const submitOneAndWait = (submit, options = {}) => (
    submitOneAndWaitFlow(submit, createSubmitOneAndWaitContext({
      ...helpers.videoGenerationContext(),
      api,
      isAborted: helpers.isAborted,
      setShotVideo: (key, url) => { refs.shotVideos[key] = url; },
      deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
      shotProgress: (key) => refs.shotProgress?.[key],
      setShotProgress: (key, progress) => { if (refs.shotProgress) refs.shotProgress[key] = progress; },
      deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
      syncShotVideosFromServer: helpers.syncShotVideosFromServer,
    }), options)
  );
  return {
    submitOneAndWait,
    runSequentialGeneration: (options = {}) => runSequentialGenerationFlow(options, createSequentialGenerationContext({
      ...helpers.videoGenerationContext(),
      message,
      sequentialRunningRef: refs.sequentialRunning,
      episodeId: () => refs.episodeId.value,
      storyboard: (episodeId = refs.episodeId.value) => helpers.findStoryboard(episodeId),
      shots: helpers.currentShots,
      parseShots: helpers.parseShots,
      setAbort: helpers.setAbort,
      isAborted: helpers.isAborted,
      backfillShotVideo: (key, url) => { refs.shotVideos[key] = url; },
      setProgress: (progress) => helpers.setProgressState(refs.progress, progress),
      capturePrevTailFrame: helpers.capturePrevTailFrame,
      submitOneAndWait,
      saveScript: helpers.saveScript,
    })),
  };
}

export function createVideoSubmitActionsRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const buildShotSubmit = createBuildShotSubmitRuntime({
    refs: { videoBar: refs.videoBar },
    helpers: {
      shotElementTags: helpers.shotElementTags,
      shotOpenerFrame: helpers.shotOpenerFrame,
      shotOpenerFrameName: helpers.shotOpenerFrameName,
      buildShotPromptBody: helpers.buildShotPromptBody,
      resolveShotDuration: helpers.resolveShotDuration,
    },
  });

  const {
    startVideoProgress,
    completeVideoProgress,
    updateVideoProgressFromJob,
  } = createVideoProgressRuntimeContext({
    refs: { progress: refs.progress, batchProgress: refs.batchProgress, schedulerSlots: refs.schedulerSlots },
    helpers: {
      providerLabel: () => refs.providerLabel.value,
      progressByRatio: helpers.progressByRatio,
      stopProgressPulse: helpers.stopProgressPulse,
      setProgressState: helpers.setProgressState,
      startProgressPulse: helpers.startProgressPulse,
      hideProgressAfter: helpers.hideProgressAfter,
    },
  });

  let activeVideoUiOperation = null;
  const claimUiOperation = () => {
    const operation = {};
    activeVideoUiOperation = operation;
    return operation;
  };
  const isUiOperationCurrent = (operation, projectId, episodeId) => (
    activeVideoUiOperation === operation
    && String(refs.project.value?.id ?? '') === String(projectId ?? '')
    && String(refs.episodeId.value) === String(episodeId)
  );
  const abandonUiOperation = (operation, { fromQueue = false } = {}) => {
    if (activeVideoUiOperation !== operation) return false;
    activeVideoUiOperation = null;
    refs.batchRunning.value = false;
    refs.batchProgress.value = '';
    refs.schedulerSlots.value = [];
    if (refs.submitting) refs.submitting.value = false;
    if (fromQueue && refs.queue) refs.queue.processing = false;
    helpers.stopProgressPulse('video');
    helpers.setProgressState(refs.progress, {
      active: false,
      percentage: 0,
      current: 0,
      total: 0,
      label: '',
      detail: '',
      status: '',
      indeterminate: false,
    });
    return true;
  };
  const finishUiOperation = (operation) => {
    if (activeVideoUiOperation === operation) activeVideoUiOperation = null;
  };

  const pollVideoSubmitJob = (jobId, shotNos, options = {}) => {
    const {
      fromQueue = false,
      projectId = refs.project.value?.id,
      episodeId = refs.episodeId.value,
      uiOperation = claimUiOperation(),
    } = options;
    if (!isUiOperationCurrent(uiOperation, projectId, episodeId)) {
      abandonUiOperation(uiOperation, { fromQueue });
      return;
    }
    return pollVideoSubmitJobFlow(jobId, shotNos, { fromQueue }, createPollVideoSubmitJobRuntimeContext({
      api,
      message,
      refs: {
        batchProgress: refs.batchProgress,
        shotStatus: refs.shotStatus,
        batchRunning: refs.batchRunning,
        schedulerSlots: refs.schedulerSlots,
        queue: refs.queue,
        shotProgress: refs.shotProgress,
      },
      helpers: {
        updateProgress: updateVideoProgressFromJob,
        shotKey: (no) => helpers.shotVideoKey(no, episodeId),
        isShotTrackingStopped: (no) => helpers.isShotTrackingStopped?.(no, projectId, episodeId),
        completeProgress: completeVideoProgress,
        startPendingPoll: helpers.startPendingPoll,
        scheduleQueueProcessing: helpers.scheduleQueueProcessing,
        isContextCurrent: () => (
          isUiOperationCurrent(uiOperation, projectId, episodeId)
        ),
        onContextInvalidated: () => abandonUiOperation(uiOperation, { fromQueue }),
        onFinished: () => finishUiOperation(uiOperation),
      },
    }));
  };

  const videoGenerationContext = () => createVideoGenerationRuntimeContext({
    api,
    message,
    refs: {
      project: refs.project,
      shotStatus: refs.shotStatus,
      batchRunning: refs.batchRunning,
      providerLabel: refs.providerLabel,
      batchProgress: refs.batchProgress,
      episodeId: refs.episodeId,
      shotProgress: refs.shotProgress,
    },
    helpers: {
      ensureSubmitModeSupported: helpers.ensureSubmitModeSupported,
      buildShotSubmit,
      shotKey: helpers.shotVideoKey,
      shotVideoUrl: helpers.shotVideoUrl,
      shotVideoStatus: helpers.shotVideoStatus,
      startProgress: startVideoProgress,
      videoSubmitPayload: helpers.videoSubmitPayload,
      providerLabelForSubmit: helpers.providerLabelForSubmit,
      completeProgress: completeVideoProgress,
      pollSubmitJob: pollVideoSubmitJob,
      claimUiOperation,
      isUiOperationCurrent,
      abandonUiOperation,
      isShotTrackingStopped: helpers.isShotTrackingStopped,
      resumeShotTracking: helpers.resumeShotTracking,
      recordGenerationBatch: helpers.recordGenerationBatch,
      beforeVideoSubmit: helpers.beforeVideoSubmit,
    },
  });

  const generateShotVideo = (shot) => generateShotVideoFlow(shot, createShotVideoSubmitContext({
    ...videoGenerationContext(),
    resetShotVideo: helpers.resetShotVideo,
    submittingRef: refs.submitting,
  }));

  const processVideoQueue = createProcessVideoQueueRuntime({
    refs: { queue: refs.queue, batchProgress: refs.batchProgress },
    helpers: {
      videoGenerationContext,
      cancelStartTimer: helpers.cancelStartTimer,
      setProgress: (progress) => helpers.setProgressState(refs.progress, progress),
    },
  });

  const allShotVideosContext = () => createAllShotVideosContext({
    ...videoGenerationContext(),
    backfillShotVideo: (key, url) => { refs.shotVideos[key] = url; },
    storyboard: () => helpers.findStoryboard(refs.episodeId.value),
    shots: helpers.currentShots,
    parseShots: helpers.parseShots,
    batchProgress: () => refs.batchProgress.value,
  });
  const generateAllShotVideos = (options = {}) => generateAllShotVideosFlow(allShotVideosContext(), options);

  let sequentialAbort = false;
  const capturePrevTailFrameForSequential = async (no, fromNo, context = {}) => {
    const projectId = context.projectId ?? refs.project.value.id;
    const episodeId = context.episodeId ?? refs.episodeId.value;
    const frameName = '本段开场状态参考图';
    const result = await api.post('/api/video/extract-tail-frame', {
      projectId,
      episodeId,
      shotNo: fromNo,
      targetShotNo: no,
      frameName,
    });
    if (!result?.ok || !result.url) {
      throw new Error(result?.error || `镜头 ${fromNo} 尾帧截取失败，已中断尾帧衔接生成`);
    }
    return helpers.setShotOpenerFrame(no, fromNo, result.url, frameName, {
      projectId,
      episodeId,
      save: false,
    }) || {
      fromShotNo: String(fromNo),
      url: result.url,
      name: frameName,
      updatedAt: new Date().toISOString(),
    };
  };

  const {
    submitOneAndWait,
    runSequentialGeneration,
  } = createSequentialGenerationRuntime({
    api,
    message,
    refs: {
      sequentialRunning: refs.sequentialRunning,
      episodeId: refs.episodeId,
      progress: refs.progress,
      shotVideos: refs.shotVideos,
      shotStatus: refs.shotStatus,
      shotProgress: refs.shotProgress,
    },
    helpers: {
      videoGenerationContext,
      isAborted: () => sequentialAbort,
      setAbort: (aborted) => { sequentialAbort = aborted; },
      findStoryboard: helpers.findStoryboard,
      currentShots: helpers.currentShots,
      parseShots: helpers.parseShots,
      setProgressState: helpers.setProgressState,
      capturePrevTailFrame: capturePrevTailFrameForSequential,
      syncShotVideosFromServer: helpers.syncShotVideosFromServer,
      saveScript: helpers.saveScript,
    },
  });

  const pendingSequentialRanges = [];
  let sequentialQueueWorker = null;
  const setSequentialPendingCount = () => {
    if (refs.sequentialPendingCount) refs.sequentialPendingCount.value = pendingSequentialRanges.length;
  };
  const rangeJobLabel = ({ fromNo = null, toNo = null } = {}) => (
    fromNo == null && toNo == null ? '本集全部分镜' : `第${fromNo}~${toNo}镜`
  );
  const runOrQueueSequentialGeneration = (options = {}) => {
    const job = {
      ...options,
      projectId: options.projectId ?? refs.project.value?.id,
      episodeId: options.episodeId ?? refs.episodeId.value,
    };
    if (sequentialQueueWorker) {
      pendingSequentialRanges.push(job);
      setSequentialPendingCount();
      message.success(`${rangeJobLabel(job)}首尾帧生成已加入等待队列`);
      return sequentialQueueWorker;
    }

    sequentialQueueWorker = (async () => {
      let currentJob = job;
      let lastResult = null;
      try {
        while (currentJob) {
          lastResult = await runSequentialGeneration(currentJob);
          if (sequentialAbort) {
            pendingSequentialRanges.splice(0);
            setSequentialPendingCount();
            break;
          }
          currentJob = pendingSequentialRanges.shift() || null;
          setSequentialPendingCount();
        }
      } finally {
        sequentialQueueWorker = null;
      }
      return lastResult;
    })();
    return sequentialQueueWorker;
  };

  const openRangeSequentialDialog = (startShotNo = null) => {
    if (refs.batchRunning.value && !refs.sequentialRunning.value) {
      return message.warning('普通批量生成正在进行中，请等待提交完成后再添加首尾帧任务');
    }
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const shots = storyboard ? helpers.parseShots(storyboard.content || '') : [];
    if (!shots.length) return message.warning('本集没有分镜');
    const nos = shots.map((shot) => Number(shot.no)).filter(Number.isFinite);
    if (!nos.length) return message.warning('本集没有有效镜号');
    const requestedNo = Number(startShotNo);
    const selectedNo = Number.isFinite(requestedNo) && nos.includes(requestedNo) ? requestedNo : null;
    refs.rangeDialog.fromNo = selectedNo ?? Math.min(...nos);
    refs.rangeDialog.toNo = selectedNo ?? Math.max(...nos);
    refs.rangeDialog.projectId = refs.project.value?.id || '';
    refs.rangeDialog.episodeId = refs.episodeId.value;
    refs.rangeDialog.visible = true;
  };

  const confirmRangeSequential = () => {
    let { fromNo, toNo } = refs.rangeDialog;
    fromNo = Number(fromNo);
    toNo = Number(toNo);
    if (!Number.isFinite(fromNo) || !Number.isFinite(toNo)) return message.warning('请输入有效的起止镜号');
    if (fromNo > toNo) {
      const previousFromNo = fromNo;
      fromNo = toNo;
      toNo = previousFromNo;
    }
    refs.rangeDialog.visible = false;
    runOrQueueSequentialGeneration({
      fromNo,
      toNo,
      projectId: refs.rangeDialog.projectId,
      episodeId: refs.rangeDialog.episodeId,
    });
  };

  const openVideoRangeDialog = (startShotNo = null) => {
    if (refs.batchRunning.value || refs.sequentialRunning.value) {
      return message.warning('当前已有视频生成任务，请等待提交完成后再选择范围');
    }
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const shots = storyboard ? helpers.parseShots(storyboard.content || '') : [];
    if (!shots.length) return message.warning('本集没有分镜');
    const nos = shots.map((shot) => Number(shot.no)).filter(Number.isFinite);
    if (!nos.length) return message.warning('本集没有有效镜号');
    const requestedNo = Number(startShotNo);
    const selectedNo = Number.isFinite(requestedNo) && nos.includes(requestedNo) ? requestedNo : null;
    refs.videoRangeDialog.fromNo = selectedNo ?? Math.min(...nos);
    refs.videoRangeDialog.toNo = selectedNo ?? Math.max(...nos);
    refs.videoRangeDialog.projectId = refs.project.value?.id || '';
    refs.videoRangeDialog.episodeId = refs.episodeId.value;
    refs.videoRangeDialog.visible = true;
  };

  const confirmVideoRange = () => {
    let { fromNo, toNo } = refs.videoRangeDialog;
    fromNo = fromNo == null || fromNo === '' ? NaN : Number(fromNo);
    toNo = toNo == null || toNo === '' ? NaN : Number(toNo);
    if (!Number.isInteger(fromNo) || fromNo < 1 || !Number.isInteger(toNo) || toNo < 1) {
      return message.warning('请输入有效的起止镜号');
    }
    if (fromNo > toNo) [fromNo, toNo] = [toNo, fromNo];
    const projectId = refs.videoRangeDialog.projectId;
    const episodeId = refs.videoRangeDialog.episodeId;
    if (String(refs.project.value?.id || '') !== String(projectId)
      || String(refs.episodeId.value) !== String(episodeId)) {
      refs.videoRangeDialog.visible = false;
      return message.warning('当前项目或剧集已切换，请重新选择生成范围');
    }
    refs.videoRangeDialog.visible = false;
    return generateAllShotVideosFlow(allShotVideosContext(), { fromNo, toNo });
  };

  const stopSequentialGeneration = () => {
    sequentialAbort = true;
    const clearedCount = pendingSequentialRanges.length;
    pendingSequentialRanges.splice(0);
    setSequentialPendingCount();
    if (clearedCount) message.info(`已停止当前任务并取消 ${clearedCount} 个等待范围`);
  };

  return {
    buildShotSubmit,
    generateShotVideo,
    processVideoQueue,
    generateAllShotVideos,
    submitOneAndWait,
    // 支持透传 { projectId, episodeId }，供"一键全集串行"按集调用；不传参时保持旧行为（当前选中集）
    generateAllShotVideosSequential: (options = {}) => runOrQueueSequentialGeneration(options),
    stopSequentialGeneration,
    openRangeSequentialDialog,
    confirmRangeSequential,
    openVideoRangeDialog,
    confirmVideoRange,
    pollVideoSubmitJob,
  };
}
