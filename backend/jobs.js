import path from 'path';

import { STATE_DIR } from './config.js';
import { readJsonFile, writeJsonAtomic } from './lib/atomicJson.js';
import { acquireProcessFileLock } from './processFileLock.js';

const JOB_STORE = path.join(STATE_DIR, 'jobs.json');
const JOB_STORE_LOCK = path.join(STATE_DIR, '.jobs.lock');
const MAX_PERSISTED_JOBS = 500;
const MAX_DELETED_JOB_TOMBSTONES = 2000;
const TERMINAL_STATUSES = new Set(['done', 'error', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['queued', 'running', 'retrying', 'paused']);

function isRetryableStatus(status) {
  return TERMINAL_STATUSES.has(status) || status === 'paused';
}

export const jobs = new Map();
const jobActions = new Map();
// A second backend process can still have a deleted job in memory. Persisting
// the deletion prevents that stale process from resurrecting the job later.
const deletedJobTombstones = new Map();
let persistTimer = null;

function serializableState(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return {}; }
}

function persistedPayload() {
  const items = Array.from(jobs.entries())
    .sort((a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || '')))
    .slice(0, MAX_PERSISTED_JOBS)
    .map(([id, state]) => ({ id, state: serializableState(state) }));
  const deleted = Array.from(deletedJobTombstones.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_DELETED_JOB_TOMBSTONES)
    .map(([id, deletedAt]) => ({ id, deletedAt: new Date(deletedAt).toISOString() }));
  const payload = { version: 1, updatedAt: new Date().toISOString(), jobs: items };
  if (deleted.length) payload.deleted = deleted;
  return payload;
}

function timestampValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stateTimestamp(state = {}) {
  return timestampValue(state.updatedAt || state.createdAt || '');
}

function loadPersistedDeletionTombstones(payload) {
  const entries = Array.isArray(payload?.deleted) ? payload.deleted : [];
  for (const entry of entries) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (!id) continue;
    const deletedAt = timestampValue(typeof entry === 'string' ? 0 : entry.deletedAt);
    if (!deletedAt) continue;
    const normalizedId = String(id);
    const previous = deletedJobTombstones.get(normalizedId) || 0;
    if (deletedAt > previous) deletedJobTombstones.set(normalizedId, deletedAt);
    jobs.delete(normalizedId);
  }
}

function markJobDeleted(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return;
  deletedJobTombstones.set(id, Math.max(Date.now(), deletedJobTombstones.get(id) || 0));
}

// The desktop app and a development backend can briefly share the same storage.
// Merge newer disk state so progress written by either process stays visible.
function mergePersistedJobs() {
  const payload = readJsonFile(JOB_STORE, { jobs: [] });
  loadPersistedDeletionTombstones(payload);
  const items = Array.isArray(payload?.jobs) ? payload.jobs : [];
  for (const item of items) {
    if (!item?.id || !item.state || typeof item.state !== 'object') continue;
    const id = String(item.id);
    const persistedState = item.state;
    const itemTimestamp = stateTimestamp(persistedState);
    if (deletedJobTombstones.has(id)) {
      jobs.delete(id);
      continue;
    }
    const current = jobs.get(id);
    if (!current || itemTimestamp > stateTimestamp(current)) {
      jobs.set(id, { ...persistedState });
    }
  }
}

export function flushJobs() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const releaseLock = acquireProcessFileLock(JOB_STORE_LOCK);
  if (!releaseLock) {
    schedulePersist();
    return false;
  }
  try {
    mergePersistedJobs();
    writeJsonAtomic(JOB_STORE, persistedPayload());
    return true;
  } finally {
    releaseLock();
  }
}

function schedulePersist(immediate = false) {
  if (immediate) {
    flushJobs();
    return;
  }
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try { flushJobs(); } catch (error) { console.error('保存任务中心失败：', error.message); }
  }, 80);
  persistTimer.unref?.();
}

function loadPersistedJobs() {
  const payload = readJsonFile(JOB_STORE, { jobs: [] });
  loadPersistedDeletionTombstones(payload);
  const items = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const now = new Date().toISOString();
  let changed = false;
  for (const item of items) {
    if (!item?.id || !item.state || typeof item.state !== 'object') continue;
    const state = { ...item.state };
    const id = String(item.id);
    if (deletedJobTombstones.has(id)) continue;
    if (state.status === 'running' || state.status === 'retrying') {
      state.status = 'paused';
      state.error = state.error || '应用重启导致任务中断';
      state.message = '应用重启导致任务中断；如任务支持重试，请重新发起';
      state.interruptedAt = now;
      state.updatedAt = now;
      state.canRetry = false;
      state.canCancel = false;
      changed = true;
    }
    jobs.set(id, state);
  }
  if (changed) schedulePersist(true);
}

loadPersistedJobs();

export function setJob(jobId, state) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('任务 id 不能为空');
  mergePersistedJobs();
  if (deletedJobTombstones.has(id) && !jobs.has(id)) return null;
  const previous = jobs.get(id) || {};
  const now = new Date().toISOString();
  const actions = jobActions.get(id);
  const next = {
    createdAt: previous.createdAt || now,
    ...previous,
    ...state,
    updatedAt: now,
  };
  const ignoredShotNos = [...new Set([
    ...(Array.isArray(previous.ignoredShotNos) ? previous.ignoredShotNos : []),
    ...(Array.isArray(state?.ignoredShotNos) ? state.ignoredShotNos : []),
  ].map(String))];
  if (ignoredShotNos.length) {
    next.ignoredShotNos = ignoredShotNos;
    if (next.submits && typeof next.submits === 'object') {
      next.submits = { ...next.submits };
      for (const shotNo of ignoredShotNos) {
        next.submits[shotNo] = {
          ok: false,
          cancelled: true,
          ignored: true,
          error: '已从视频卡片强制移除排队与追踪',
        };
      }
    }
  }
  if (actions) {
    next.canCancel = typeof actions.cancel === 'function' && ACTIVE_STATUSES.has(next.status);
      next.canRetry = typeof actions.retry === 'function' && isRetryableStatus(next.status);
  }
  if (next.status === 'running' || next.status === 'queued' || next.status === 'retrying') {
    next.cancelRequested = false;
  }
  jobs.set(id, next);
  schedulePersist(TERMINAL_STATUSES.has(next.status) || next.provider === 'dreamina-agent');
  return next;
}

export function getJob(jobId) {
  mergePersistedJobs();
  return jobs.get(String(jobId || '')) || null;
}

export function listJobs() {
  mergePersistedJobs();
  return Array.from(jobs.entries())
    .map(([id, state]) => ({ id, ...state, ...getJobCapabilities(id) }))
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export function registerJobActions(jobId, actions = {}) {
  const id = String(jobId || '').trim();
  if (!id) return () => {};
  jobActions.set(id, {
    cancel: typeof actions.cancel === 'function' ? actions.cancel : null,
    retry: typeof actions.retry === 'function' ? actions.retry : null,
  });
  const current = getJob(id);
  if (current) setJob(id, {});
  return () => {
    if (jobActions.get(id)) jobActions.delete(id);
  };
}

export function getJobCapabilities(jobId) {
  const id = String(jobId || '');
  const state = jobs.get(id) || {};
  const actions = jobActions.get(id) || {};
  return {
    canCancel: typeof actions.cancel === 'function' && ACTIVE_STATUSES.has(state.status),
    canRetry: typeof actions.retry === 'function' && isRetryableStatus(state.status),
    canRemove: !ACTIVE_STATUSES.has(state.status),
  };
}

export function isJobCancellationRequested(jobId) {
  return getJob(jobId)?.cancelRequested === true;
}

export async function requestJobCancellation(jobId) {
  const id = String(jobId || '');
  const state = getJob(id);
  if (!state) throw new Error('任务不存在');
  if (TERMINAL_STATUSES.has(state.status)) return state;
  const action = jobActions.get(id)?.cancel;
  setJob(id, { cancelRequested: true, message: '正在取消任务…' });
  if (action) await action();
  return setJob(id, { status: 'cancelled', cancelRequested: true, message: '任务已取消' });
}

export async function retryJob(jobId) {
  const id = String(jobId || '');
  const state = getJob(id);
  if (!state) throw new Error('任务不存在');
  const action = jobActions.get(id)?.retry;
  if (typeof action !== 'function') throw new Error('该任务无法重试，请重新发起');
  setJob(id, { status: 'retrying', error: '', message: '正在重试…', cancelRequested: false });
  try {
    await action();
  } catch (error) {
    setJob(id, { status: 'error', error: error?.message || String(error), message: error?.message || '重试失败' });
    throw error;
  }
  return getJob(id);
}

export function removeJob(jobId) {
  const id = String(jobId || '');
  const state = getJob(id);
  if (!state) return false;
  if (ACTIVE_STATUSES.has(state.status)) throw new Error('执行中的任务不能移除，请先取消');
  jobActions.delete(id);
  markJobDeleted(id);
  const removed = jobs.delete(id);
  schedulePersist(true);
  return removed;
}

export function clearFinishedJobs() {
  mergePersistedJobs();
  let count = 0;
  for (const [id, state] of jobs) {
    if (!TERMINAL_STATUSES.has(state.status) && state.status !== 'paused') continue;
    jobActions.delete(id);
    markJobDeleted(id);
    jobs.delete(id);
    count++;
  }
  if (count) schedulePersist(true);
  return count;
}

process.once('beforeExit', () => {
  try { flushJobs(); } catch { /* ignore */ }
});

