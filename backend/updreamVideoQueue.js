function normalizedConcurrency(value, fallback = 2) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function isProviderWaitingTask(task = {}, provider = '') {
  return task.provider === provider
    && task.status === 'submitting'
    && task.queuePayload
    && typeof task.queuePayload === 'object';
}

export function isProviderDispatchingTask(task = {}, provider = '') {
  return isProviderWaitingTask(task, provider)
    && task.queueState === 'submitting';
}

export function isProviderActiveTask(task = {}, provider = '') {
  return task.provider === provider
    && task.status === 'queued'
    && task.remoteDone !== true
    && !task.videoUrl;
}

export function findActiveProviderTaskForShot(tasks = [], provider = '', projectId, episodeId, shotNo) {
  return (Array.isArray(tasks) ? tasks : []).find((task) => (
    task?.provider === provider
    && (task.status === 'submitting' || task.status === 'queued')
    && task.projectId === projectId
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  )) || null;
}

export function planProviderQueue(tasks = [], provider = '', concurrency = 2) {
  const source = Array.isArray(tasks) ? tasks : [];
  const limit = normalizedConcurrency(concurrency);
  const now = Date.now();
  const active = source.filter((task) => isProviderActiveTask(task, provider));
  const dispatching = source.filter((task) => isProviderDispatchingTask(task, provider));
  const waiting = source
    .filter((task) => isProviderWaitingTask(task, provider)
      && String(task.queueState || 'waiting') === 'waiting'
      && (Number(task.nextAttemptAt) || 0) <= now)
    .sort((left, right) => {
      const orderDelta = (Number(left.queueOrder) || Number(left.createdAt) || 0)
        - (Number(right.queueOrder) || Number(right.createdAt) || 0);
      if (orderDelta) return orderDelta;
      return String(left.submitId || '').localeCompare(String(right.submitId || ''));
    });
  const available = Math.max(0, limit - active.length - dispatching.length);
  return {
    limit,
    active,
    dispatching,
    waiting,
    available,
    selected: waiting.slice(0, available),
  };
}

export function isUpdreamWaitingTask(task = {}) {
  return isProviderWaitingTask(task, 'updream');
}

export function isUpdreamActiveTask(task = {}) {
  return isProviderActiveTask(task, 'updream');
}

export function isUpdreamDispatchingTask(task = {}) {
  return isProviderDispatchingTask(task, 'updream');
}

export function findActiveUpdreamTaskForShot(tasks = [], projectId, episodeId, shotNo) {
  return findActiveProviderTaskForShot(tasks, 'updream', projectId, episodeId, shotNo);
}

export function planUpdreamQueue(tasks = [], concurrency = 2) {
  return planProviderQueue(tasks, 'updream', concurrency);
}

export function isNeowowWaitingTask(task = {}) {
  return isProviderWaitingTask(task, 'neowow');
}

export function isNeowowActiveTask(task = {}) {
  return isProviderActiveTask(task, 'neowow');
}

export function isNeowowDispatchingTask(task = {}) {
  return isProviderDispatchingTask(task, 'neowow');
}

export function findActiveNeowowTaskForShot(tasks = [], projectId, episodeId, shotNo) {
  return findActiveProviderTaskForShot(tasks, 'neowow', projectId, episodeId, shotNo);
}

export function planNeowowQueue(tasks = [], concurrency = 15) {
  return planProviderQueue(tasks, 'neowow', concurrency);
}

export function isComfyUiWaitingTask(task = {}) {
  return isProviderWaitingTask(task, 'comfyui');
}

export function isComfyUiActiveTask(task = {}) {
  return isProviderActiveTask(task, 'comfyui');
}

export function isComfyUiDispatchingTask(task = {}) {
  return isProviderDispatchingTask(task, 'comfyui');
}

export function findActiveComfyUiTaskForShot(tasks = [], projectId, episodeId, shotNo) {
  return findActiveProviderTaskForShot(tasks, 'comfyui', projectId, episodeId, shotNo);
}

export function planComfyUiQueue(tasks = [], concurrency = 1) {
  return planProviderQueue(tasks, 'comfyui', concurrency);
}

export async function mapUpdreamWithConcurrency(items = [], concurrency = 3, worker = async () => {}) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return [];
  const limit = Math.min(normalizedConcurrency(concurrency, 3), source.length);
  const results = new Array(source.length);
  let cursor = 0;

  const run = async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}
