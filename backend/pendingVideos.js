// 待生成视频任务的持久化：提交即走后，把任务记下来，后台轮询拉回。
// Persistent queue now follows the unified storage root; config.js migrates old data.
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { isVideoProvider, normalizeVideoProvider } from './videoProviders.js';
import { writeJsonAtomic } from './lib/atomicJson.js';

const STORE = path.join(path.dirname(DATA_DIR), 'pendingVideos.json');
function read() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf-8')); } catch { return { tasks: [] }; }
}
function write(data) {
  writeJsonAtomic(STORE, data);
}

function sameShot(task, projectId, episodeId, shotNo) {
  return task?.projectId === projectId
    && String(task?.episodeId) === String(episodeId)
    && String(task?.shotNo) === String(shotNo);
}

function trackingStops(data = {}) {
  return Array.isArray(data.trackingStops) ? data.trackingStops : [];
}

export function isPendingTrackingStopped(projectId, episodeId, shotNo) {
  return trackingStops(read()).some((item) => sameShot(item, projectId, episodeId, shotNo));
}

export function stopPendingTrackingByShot(projectId, episodeId, shotNo) {
  const data = read();
  const before = (data.tasks || []).length;
  data.tasks = (data.tasks || []).filter((task) => !sameShot(task, projectId, episodeId, shotNo));
  data.trackingStops = trackingStops(data).filter((item) => !sameShot(item, projectId, episodeId, shotNo));
  data.trackingStops.push({ projectId, episodeId, shotNo, stoppedAt: new Date().toISOString() });
  write(data);
  return before - data.tasks.length;
}

export function stopPendingTrackingByEpisode(projectId, episodeId, shotNos = []) {
  const data = read();
  const matchesEpisode = (task) => task?.projectId === projectId
    && String(task?.episodeId) === String(episodeId);
  const matchingTasks = (data.tasks || []).filter(matchesEpisode);
  const stoppedShotNos = new Set([
    ...matchingTasks.map((task) => String(task.shotNo)),
    ...(Array.isArray(shotNos) ? shotNos : [shotNos]).map((no) => String(no ?? '').trim()).filter(Boolean),
  ]);
  const beforeTasks = (data.tasks || []).length;
  const beforeStops = trackingStops(data).length;
  data.tasks = (data.tasks || []).filter((task) => !matchesEpisode(task));
  data.trackingStops = trackingStops(data).filter((item) => !matchesEpisode(item));
  for (const shotNo of stoppedShotNos) {
    data.trackingStops.push({ projectId, episodeId, shotNo, stoppedAt: new Date().toISOString() });
  }
  if (data.tasks.length !== beforeTasks || data.trackingStops.length !== beforeStops) write(data);
  return {
    cleared: beforeTasks - data.tasks.length,
    stoppedShotNos: [...stoppedShotNos],
  };
}

export function resumePendingTrackingByShot(projectId, episodeId, shotNo) {
  const data = read();
  const before = trackingStops(data).length;
  data.trackingStops = trackingStops(data).filter((item) => !sameShot(item, projectId, episodeId, shotNo));
  if (data.trackingStops.length !== before) write(data);
  return data.trackingStops.length !== before;
}

// 新增一条待生成任务
export function addPending({
  projectId,
  episodeId,
  shotNo,
  submitId,
  historyId,
  accountId,
  provider = 'dreamina-cli',
  videoUrl = '',
  videoUrls = [],
  status = 'queued',
  lastError = '',
  queuePayload = null,
  queueState = '',
  queueOrder = 0,
  canCancel = null,
  jobId = '',
  jobIds = [],
  progress = null,
  sessionId = '',
  remoteProjectId = '',
}) {
  const data = read();
  if (trackingStops(data).some((item) => sameShot(item, projectId, episodeId, shotNo))) return null;
  // 同一 (project,ep,shot) 只保留最新一条
  data.tasks = data.tasks.filter((t) => !(t.projectId === projectId && String(t.episodeId) === String(episodeId) && String(t.shotNo) === String(shotNo)));
  const task = {
    projectId, episodeId, shotNo, submitId, historyId: historyId || null, accountId,
    provider: normalizeVideoProvider(provider),
    status: status === 'submitting' ? 'submitting' : 'queued',
    createdAt: Date.now(),
    videoRel: null,
    videoUrl: videoUrl || '',
    videoUrls: [...new Set([
      ...(Array.isArray(videoUrls) ? videoUrls : [videoUrls]),
      videoUrl,
    ].map((value) => String(value || '').trim()).filter(Boolean))],
    lastError: String(lastError || ''),
  };
  if (queuePayload && typeof queuePayload === 'object') task.queuePayload = queuePayload;
  if (queueState) task.queueState = String(queueState);
  if (queueOrder != null && Number.isFinite(Number(queueOrder))) task.queueOrder = Number(queueOrder);
  if (typeof canCancel === 'boolean') task.canCancel = canCancel;
  const relatedJobIds = [...new Set([
    ...(Array.isArray(jobIds) ? jobIds : []),
    jobId,
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  if (relatedJobIds.length) {
    task.jobId = relatedJobIds[0];
    task.jobIds = relatedJobIds;
  }
  if (progress != null && Number.isFinite(Number(progress))) task.progress = Number(progress);
  if (sessionId) task.sessionId = String(sessionId);
  if (remoteProjectId) task.remoteProjectId = String(remoteProjectId);
  data.tasks.push(task);
  write(data);
  return task;
}

export function listPending() {
  return read().tasks || [];
}

// Project ids are also persisted in the background queue. Rename them in one
// atomic write so a task finishing after a project rename still writes back to
// the project that owns its media.
export function renamePendingProject(previousProjectId, nextProjectId) {
  const previous = String(previousProjectId || '');
  const next = String(nextProjectId || '');
  if (!previous || !next || previous === next) return 0;
  const data = read();
  let changed = 0;
  for (const task of [...(data.tasks || []), ...trackingStops(data)]) {
    if (task.projectId !== previous) continue;
    task.projectId = next;
    changed += 1;
  }
  if (changed) write(data);
  return changed;
}

// Polling is asynchronous. A result from an older generation of the same shot
// must not be allowed to overwrite the task that replaced it.
export function isCurrentPendingTask(task = {}) {
  const submitId = String(task.submitId || '').trim();
  if (!submitId || !task.projectId || task.episodeId == null || task.shotNo == null) return false;
  const current = (read().tasks || []).find((item) => (
    item.projectId === task.projectId &&
    String(item.episodeId) === String(task.episodeId) &&
    String(item.shotNo) === String(task.shotNo)
  ));
  if (!current || String(current.submitId || '').trim() !== submitId) return false;
  return normalizeVideoProvider(current.provider) === normalizeVideoProvider(task.provider);
}

export function findUnfinishedByShot(projectId, episodeId, shotNo, provider = null) {
  const providerFilter = provider ? normalizeVideoProvider(provider, '') : null;
  return listUnfinished().find((t) => {
    if (providerFilter && t.provider !== providerFilter) return false;
    return t.projectId === projectId &&
      String(t.episodeId) === String(episodeId) &&
      String(t.shotNo) === String(shotNo);
  }) || null;
}

// 还没完成的任务（queued）
export function listUnfinished() {
  return (read().tasks || []).filter((t) => (
    t.status === 'queued' &&
    isVideoProvider(t.provider) &&
    (!t.projectType || t.projectType === 'project')
  ));
}

export function updatePending(submitId, changes) {
  const data = read();
  const t = data.tasks.find((x) => x.submitId === submitId);
  if (t) { Object.assign(t, changes); write(data); }
  return t;
}

// Re-queue a task that was marked failed after a transient provider/query
// error. Keeping the task record means the UI can retry the original submit id
// instead of forcing the user to submit a duplicate generation job.
export function retryPendingByShot(projectId, episodeId, shotNo) {
  const data = read();
  let retried = 0;
  for (const task of data.tasks) {
    if (task.projectId !== projectId || String(task.episodeId) !== String(episodeId) || String(task.shotNo) !== String(shotNo)) continue;
    if (task.status === 'submitting' && task.queuePayload) {
      task.lastAttemptAt = new Date().toISOString();
      retried += 1;
      continue;
    }
    task.status = 'queued';
    task.lastError = '';
    task.lastAttemptAt = new Date().toISOString();
    retried += 1;
  }
  if (retried) write(data);
  return retried;
}

export function removePending(submitId) {
  if (submitId == null) return;
  const data = read();
  data.tasks = data.tasks.filter((t) => t.submitId !== submitId);
  write(data);
}

// 清除指定项目(可选指定集)的所有待办任务。返回清除数量。
export function clearPendingByProject(projectId, episodeId = null) {
  const data = read();
  const before = data.tasks.length;
  data.tasks = data.tasks.filter((t) => {
    if (t.projectId !== projectId) return true;
    if (episodeId != null && String(t.episodeId) !== String(episodeId)) return true;
    return false; // 匹配的删掉
  });
  write(data);
  return before - data.tasks.length;
}

// 清除指定项目+镜号的单个待办任务。返回是否清除。
export function clearPendingByShot(projectId, episodeId, shotNo) {
  const data = read();
  const before = data.tasks.length;
  data.tasks = data.tasks.filter((t) =>
    !(t.projectId === projectId && String(t.episodeId) === String(episodeId) && String(t.shotNo) === String(shotNo))
  );
  write(data);
  return before > data.tasks.length;
}

// 按账号分组未完成任务，便于一个会话查一批
export function unfinishedByAccount(provider = null) {
  const map = {};
  const providerFilter = provider ? normalizeVideoProvider(provider, '') : null;
  if (provider && !providerFilter) return map;
  for (const t of listUnfinished()) {
    if (providerFilter && t.provider !== providerFilter) continue;
    (map[t.accountId] = map[t.accountId] || []).push(t);
  }
  return map;
}
