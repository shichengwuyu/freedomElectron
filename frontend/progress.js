export function createProgressTools() {
  const progressPulseTimers = new Map();
  const progressTrackers = new Map(); // 跟踪各任务的开始时间和速度

  function clampProgress(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function setProgressState(state, options = {}) {
    if (options.active !== undefined) state.active = !!options.active;
    if (options.percentage !== undefined) state.percentage = clampProgress(options.percentage);
    if (options.current !== undefined) state.current = Math.max(0, Number(options.current) || 0);
    if (options.total !== undefined) state.total = Math.max(0, Number(options.total) || 0);
    if (options.label !== undefined) state.label = String(options.label || '');
    if (options.detail !== undefined) state.detail = String(options.detail || '');
    if (options.status !== undefined) state.status = String(options.status || '');
    if (options.indeterminate !== undefined) state.indeterminate = !!options.indeterminate;
    if (options.estimatedTime !== undefined) state.estimatedTime = options.estimatedTime;
    if (options.cancelable !== undefined) state.cancelable = !!options.cancelable;
  }

  function stopProgressPulse(key) {
    const timer = progressPulseTimers.get(key);
    if (timer) clearInterval(timer);
    progressPulseTimers.delete(key);
  }

  function startProgressPulse(key, state, { ceiling = 95, interval = 850 } = {}) {
    stopProgressPulse(key);
    const timer = setInterval(() => {
      if (!state.active || state.status === 'success' || state.status === 'exception') return;
      const current = Number(state.percentage) || 0;
      if (current >= ceiling) return;
      const step = Math.max(1, Math.ceil((ceiling - current) * 0.06));
      state.percentage = Math.min(ceiling, current + step);
    }, interval);
    progressPulseTimers.set(key, timer);
  }

  function progressByRatio(current, total, { floor = 0, ceiling = 100 } = {}) {
    const safeTotal = Math.max(0, Number(total) || 0);
    if (!safeTotal) return clampProgress(floor);
    const safeCurrent = Math.max(0, Math.min(safeTotal, Number(current) || 0));
    return clampProgress(floor + (safeCurrent / safeTotal) * (ceiling - floor));
  }

  function hideProgressAfter(state, status, delay = 1400) {
    setTimeout(() => {
      if (state.status === status) state.active = false;
    }, delay);
  }

  /**
   * 开始跟踪任务进度（用于预估剩余时间）
   * @param {string} key - 任务标识
   * @param {number} total - 总任务量
   */
  function startProgressTracking(key, total) {
    progressTrackers.set(key, {
      startTime: Date.now(),
      total: total || 0,
      lastUpdate: Date.now(),
      lastCurrent: 0,
    });
  }

  /**
   * 更新进度跟踪并计算预估剩余时间
   * @param {string} key - 任务标识
   * @param {number} current - 当前完成量
   * @returns {Object} {estimatedSeconds, estimatedText}
   */
  function updateProgressTracking(key, current) {
    const tracker = progressTrackers.get(key);
    if (!tracker) return { estimatedSeconds: null, estimatedText: '' };

    const now = Date.now();
    const elapsed = now - tracker.startTime;
    const remaining = tracker.total - current;

    if (current <= 0 || remaining <= 0 || elapsed < 1000) {
      return { estimatedSeconds: null, estimatedText: '' };
    }

    // 计算平均速度（项/秒）
    const speed = current / (elapsed / 1000);
    const estimatedSeconds = Math.ceil(remaining / speed);

    tracker.lastUpdate = now;
    tracker.lastCurrent = current;

    return {
      estimatedSeconds,
      estimatedText: formatEstimatedTime(estimatedSeconds)
    };
  }

  /**
   * 停止进度跟踪
   * @param {string} key - 任务标识
   */
  function stopProgressTracking(key) {
    progressTrackers.delete(key);
  }

  /**
   * 格式化预估时间
   * @param {number} seconds - 秒数
   * @returns {string} 格式化的时间字符串
   */
  function formatEstimatedTime(seconds) {
    if (!seconds || seconds <= 0) return '';
    if (seconds < 60) return `约 ${seconds} 秒`;
    if (seconds < 3600) {
      const minutes = Math.ceil(seconds / 60);
      return `约 ${minutes} 分钟`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.ceil((seconds % 3600) / 60);
    return `约 ${hours} 小时 ${minutes} 分钟`;
  }

  /**
   * 创建可取消的进度状态
   * @param {Object} initialState - 初始状态
   * @param {Function} onCancel - 取消回调
   * @returns {Object} 增强的状态对象
   */
  function createCancelableProgress(initialState = {}, onCancel = null) {
    const state = {
      active: false,
      percentage: 0,
      current: 0,
      total: 0,
      label: '',
      detail: '',
      status: '',
      indeterminate: false,
      estimatedTime: '',
      cancelable: true,
      ...initialState
    };

    state.cancel = () => {
      if (state.cancelable && onCancel) {
        onCancel();
      }
    };

    return state;
  }

  return {
    clampProgress,
    setProgressState,
    stopProgressPulse,
    startProgressPulse,
    progressByRatio,
    hideProgressAfter,
    startProgressTracking,
    updateProgressTracking,
    stopProgressTracking,
    formatEstimatedTime,
    createCancelableProgress,
  };
}
