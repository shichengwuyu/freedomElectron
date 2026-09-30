// 通用后台任务轮询器。
// 取代散落各处的 setInterval(async () => ...) 反模式：
//   1. 递归 setTimeout —— 等上一次请求返回后再排下一次，请求不会堆叠、旧响应不会盖新响应；
//   2. 可选的进度停滞超时 —— 只要进度在推进就重置计时；stallMs <= 0 时关闭，
//      由后端终态决定任务何时结束，适合单步耗时不稳定的长任务。
//
// 用法：await pollJobUntilDone({ fetchStatus, isDone, isError?, getProgress?, onStatus? })
// 成功/失败/错误分别走 onDone/onError；任一路径都会终止轮询，调用方不会悬空在 running 态。

const DEFAULTS = {
  intervalMs: 1200,
  stallMs: 5 * 60 * 1000, // 进度连续 5 分钟无推进即判卡死
  errorBackoffMs: 3000, // 单次请求异常后的退避间隔（暂时性网络抖动不立即判死）
  maxConsecutiveErrors: 5, // 连续请求异常达到此数才判失败
};

export function pollJobUntilDone(options = {}) {
  const {
    fetchStatus,
    isDone,
    isError = () => false,
    getProgress = null,
    onStatus = null,
    shouldStop = null,
    intervalMs = DEFAULTS.intervalMs,
    stallMs = DEFAULTS.stallMs,
    errorBackoffMs = DEFAULTS.errorBackoffMs,
    maxConsecutiveErrors = DEFAULTS.maxConsecutiveErrors,
  } = options;

  return new Promise((resolve, reject) => {
    let timer = null;
    let stopped = false;
    let lastProgress = null;
    let lastProgressAt = Date.now();
    let consecutiveErrors = 0;
    const normalizedStallMs = Number(stallMs);
    const shouldCheckStall = Number.isFinite(normalizedStallMs) && normalizedStallMs > 0;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = (delay) => {
      if (stopped) return;
      timer = setTimeout(tick, delay);
    };

    async function tick() {
      if (stopped) return;
      if (typeof shouldStop === 'function' && shouldStop()) {
        stop();
        reject(new Error('轮询已取消'));
        return;
      }

      let status;
      try {
        status = await fetchStatus();
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          stop();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        schedule(errorBackoffMs);
        return;
      }

      if (stopped) return;

      if (isError(status)) {
        stop();
        resolve(status); // 业务错误由调用方在 onStatus/返回值里处理
        return;
      }
      if (isDone(status)) {
        stop();
        resolve(status);
        return;
      }

      // 仍在运行：更新进度并检测停滞
      if (typeof getProgress === 'function') {
        const progress = getProgress(status);
        if (progress !== lastProgress) {
          lastProgress = progress;
          lastProgressAt = Date.now();
        } else if (shouldCheckStall && Date.now() - lastProgressAt > normalizedStallMs) {
          stop();
          reject(new Error('任务长时间无进展，可能已卡住，请重试'));
          return;
        }
      }

      if (onStatus) {
        try {
          await onStatus(status);
        } catch {
          /* onStatus 内的 UI 更新失败不应中断轮询 */
        }
      }

      schedule(intervalMs);
    }

    schedule(intervalMs);
  });
}
