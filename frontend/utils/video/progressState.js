export function isVideoResultHandled(result) {
  if (!result) return false;
  if (result.ok) return true;
  if (result.pending || result.removed) return true;
  return result.retrying !== true;
}

export function normalizeVideoSchedulerSlots(slots = []) {
  return (Array.isArray(slots) ? slots : []).map((slot) => ({
    accountId: slot.accountId || 'video-api',
    accountName: slot.accountName || '',
    model: slot.model || '',
    modelLabel: slot.modelLabel || slot.model || '',
    state: slot.state || 'idle',
    enabled: slot.enabled !== false,
    shotNo: slot.currentShot?.shotNo || null,
    error: slot.error || '',
  }));
}

export function videoProgressStateFromJob(st = {}, shotNos = [], options = {}) {
  const results = Object.values(st.results || {});
  const total = Math.max(
    Number(st.total) || 0,
    shotNos?.length || 0,
    results.length,
    Number(st.queueLength) || 0,
  );
  const submitted = Math.max(0, Number(st.submitted) || 0);
  const failed = Math.max(0, Number(st.failed) || 0);
  const processed = Math.max(0, Number(st.processed) || submitted + failed);
  const handled = results.filter(isVideoResultHandled).length;
  const activeSlots = (Array.isArray(st.slots) ? st.slots : []).filter((slot) => ['submitting', 'waiting'].includes(slot.state)).length;
  const current = Math.min(total || processed || handled, Math.max(processed, handled));
  const progressUnits = current + Math.min(activeSlots * 0.35, Math.max(0, (total || 0) - current));
  const progressByRatio = typeof options.progressByRatio === 'function'
    ? options.progressByRatio
    : ((currentValue, totalValue) => (totalValue ? Math.round((currentValue / totalValue) * 100) : 0));
  const computedPercentage = st.status === 'done'
    ? 100
    : progressByRatio(progressUnits, total, { floor: total ? 6 : 8, ceiling: 96 });
  return {
    progress: {
      active: true,
      percentage: Math.max(Number(options.previousPercentage) || 0, computedPercentage),
      current,
      total,
      label: options.label || '',
      detail: st.message || options.detail || '视频任务运行中…',
      status: '',
      indeterminate: !total,
    },
    schedulerSlots: normalizeVideoSchedulerSlots(st.slots),
  };
}

export function startProgressStateFlow({ total = 0, detail = '', label = '', pulseKey = 'video', ceiling = null, emptyCeiling = 92 } = {}, handlers = {}) {
  handlers.stopProgressPulse(pulseKey);
  const count = Math.max(0, Number(total) || 0);
  handlers.setProgress({
    active: true,
    percentage: count ? 2 : 5,
    current: 0,
    total: count,
    label,
    detail,
    status: '',
    indeterminate: !count,
  });
  handlers.startProgressPulse(pulseKey, { ceiling: count ? (ceiling ?? 72) : emptyCeiling });
}

export function completeProgressStateFlow({ status = 'success', detail = '', pulseKey = 'video', successDelay = 1600, failureDelay = 2600 } = {}, handlers = {}) {
  handlers.stopProgressPulse(pulseKey);
  const progress = handlers.progress();
  handlers.setProgress({
    active: true,
    percentage: status === 'success' ? 100 : progress.percentage,
    current: status === 'success' ? (progress.total || progress.current) : progress.current,
    detail: detail || progress.detail,
    status,
    indeterminate: false,
  });
  handlers.hideProgressAfter(status, status === 'success' ? successDelay : failureDelay);
}

export function createProgressStateRuntimeContext({ refs = {}, helpers = {} } = {}) {
  return {
    stopProgressPulse: helpers.stopProgressPulse,
    progress: () => refs.progress,
    setProgress: (progress) => helpers.setProgressState(refs.progress, progress),
    startProgressPulse: (key, options) => helpers.startProgressPulse(key, refs.progress, options),
    hideProgressAfter: (nextStatus, delay) => helpers.hideProgressAfter(refs.progress, nextStatus, delay),
  };
}

export function createVideoProgressRuntimeContext({ refs = {}, helpers = {} } = {}) {
  const progressContext = createProgressStateRuntimeContext({
    refs: { progress: refs.progress },
    helpers,
  });
  return {
    startVideoProgress(total, detail = '') {
      return startProgressStateFlow({
        total,
        detail,
        label: `${helpers.providerLabel()} video generation`,
        pulseKey: 'video',
      }, progressContext);
    },
    completeVideoProgress(status = 'success', detail = '') {
      return completeProgressStateFlow({ status, detail, pulseKey: 'video' }, progressContext);
    },
    updateVideoProgressFromJob(st = {}, shotNos = []) {
      const next = videoProgressStateFromJob(st, shotNos, {
        progressByRatio: helpers.progressByRatio,
        previousPercentage: refs.progress.percentage,
        label: `${helpers.providerLabel()}视频生成`,
        detail: refs.batchProgress.value,
      });
      refs.schedulerSlots.value = next.schedulerSlots;
      helpers.setProgressState(refs.progress, next.progress);
    },
  };
}
