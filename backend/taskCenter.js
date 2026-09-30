import {
  clearFinishedJobs,
  listJobs,
  removeJob,
  requestJobCancellation,
  retryJob,
} from './jobs.js';
import { listPending, removePending } from './pendingVideos.js';
import { listPendingImages, removePendingImage } from './pendingImages.js';
import { videoProviderLabel } from './videoProviders.js';
import { imageProviderLabel } from './imageProviders.js';
import { loadProjectNameOnly } from './storage.js';
import {
  cancelDreaminaAgentUnsubmittedShot,
  cancelNeowowUnsubmittedShot,
  cancelUpdreamUnsubmittedShot,
} from './videoService.js';

// 项目名跨请求缓存：任务中心每 4 秒轮询一次，之前每拍都全量加载项目元数据
// （含递归目录大小统计），生成任务越多越卡。名字几乎不变，短 TTL 足够。
const PROJECT_NAME_TTL_MS = 5 * 60 * 1000;
const projectNameCache = new Map(); // projectId -> { name, cachedAt }

function createProjectNameResolver() {
  return (projectId) => {
    const id = String(projectId || '');
    if (!id) return '';
    const cached = projectNameCache.get(id);
    if (cached && Date.now() - cached.cachedAt < PROJECT_NAME_TTL_MS) return cached.name;
    let name = id;
    try { name = loadProjectNameOnly(id) || id; } catch { name = id; }
    projectNameCache.set(id, { name, cachedAt: Date.now() });
    return name;
  };
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'error' || value === 'failed') return 'failed';
  if (value === 'done' || value === 'success') return 'done';
  if (value === 'running' || value === 'generating' || value === 'submitting' || value === 'retrying') return 'running';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  if (value === 'paused') return 'paused';
  return value || 'queued';
}

function matchesProject(task, projectId) {
  if (!projectId) return true;
  return String(task.projectId || '') === String(projectId);
}

function taskProgressFields(job = {}) {
  const chunkTotal = Math.max(0, Number(job.chunkTotal) || 0);
  if (chunkTotal) {
    const chunkIndex = Math.max(0, Number(job.chunkIndex) || 0);
    const hasCompleted = Number.isFinite(Number(job.completed));
    const terminal = ['done', 'success'].includes(String(job.status || '').toLowerCase());
    const current = terminal || job.phase === 'compose'
      ? chunkTotal
      : hasCompleted
        ? Math.min(chunkTotal, Math.max(0, Number(job.completed)))
        : Math.min(chunkTotal, chunkIndex + 1);
    return {
      progressCurrent: current,
      progressTotal: chunkTotal,
      progressPercentage: Math.round((current / chunkTotal) * 100),
      progressLabel: '分段进度',
    };
  }

  const total = Math.max(0, Number(job.total) || 0);
  if (!total) {
    return { progressCurrent: '', progressTotal: '', progressPercentage: 0, progressLabel: '' };
  }
  const current = Math.max(0, Math.min(total, Number(job.processed ?? job.done ?? job.submitted) || 0));
  return {
    progressCurrent: current,
    progressTotal: total,
    progressPercentage: Math.round((current / total) * 100),
    progressLabel: '任务进度',
  };
}

function taskShotNo(job = {}) {
  const direct = String(job.shotNo ?? '').trim();
  if (direct) return direct;
  const candidates = [
    ...(Array.isArray(job.shotNos) ? job.shotNos : []),
    ...(Array.isArray(job.slots)
      ? job.slots.map((slot) => slot?.currentShot?.shotNo).filter((shotNo) => shotNo != null)
      : []),
  ].map((shotNo) => String(shotNo ?? '').trim()).filter(Boolean);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : '';
}

export function listTaskCenter({ projectId = '' } = {}) {
  const projectName = createProjectNameResolver();
  const jobs = listJobs()
    .filter((job) => matchesProject(job, projectId))
    .map((job) => ({
      id: job.id,
      source: 'job',
      type: job.phase || job.type || 'job',
      title: job.title || job.message || job.phase || job.id,
      status: normalizeStatus(job.status),
      provider: job.provider || '',
      providerLabel: job.provider
        ? ((job.phase || job.type) === 'image' ? imageProviderLabel(job.provider) : videoProviderLabel(job.provider))
        : '',
      projectId: job.projectId || '',
      projectName: projectName(job.projectId),
      episodeId: job.episodeId ?? '',
      shotNo: taskShotNo(job),
      chunkIndex: job.chunkIndex ?? '',
      chunkTotal: job.chunkTotal ?? '',
      total: job.total ?? '',
      processed: job.processed ?? job.done ?? '',
      submitted: job.submitted ?? '',
      failed: Array.isArray(job.failed) ? job.failed.length : (job.failed ?? ''),
      skipped: job.skipped ?? '',
      message: job.message || job.error || '',
      error: job.error || '',
      canCancel: job.canCancel === true,
      canRetry: job.canRetry === true,
      canRemove: job.canRemove === true,
      createdAt: job.createdAt || '',
      updatedAt: job.updatedAt || '',
      ...taskProgressFields(job),
    }));

  const pendingVideos = listPending()
    .filter((task) => matchesProject(task, projectId))
    .map((task) => {
      const normalizedStatus = normalizeStatus(task.status);
      const waitingForSlot = ['updream', 'neowow'].includes(task.provider)
        && task.status === 'submitting'
        && !!task.queuePayload;
      // 上游任务日志显示正在生成时按「执行中」展示：video-api 的本地 status 恒为 queued
      // （见 syncUpstreamStatusFromRemote），真实状态在 upstreamStatus 上。
      const upstreamRunning = task.upstreamStatus === 'IN_PROGRESS';
      return {
        id: `pending-video:${task.submitId}`,
        source: 'pending-video',
        type: 'video',
        title: `第 ${task.episodeId} 集 · 镜头 ${task.shotNo} 视频生成`,
        status: waitingForSlot ? 'queued' : (upstreamRunning ? 'running' : normalizedStatus),
        provider: task.provider || '',
        providerLabel: videoProviderLabel(task.provider),
        projectId: task.projectId,
        projectName: projectName(task.projectId),
        episodeId: task.episodeId,
        shotNo: task.shotNo,
        submitId: task.submitId,
        total: '',
        message: waitingForSlot
          ? (task.queueState === 'submitting'
              ? `正在提交 ${videoProviderLabel(task.provider)}`
              : `等待 ${videoProviderLabel(task.provider)} 并发空位`)
          : (task.lastError || (normalizedStatus === 'queued' ? '已提交云端排队，出片后自动拉回' : task.videoUrl || '')),
        error: task.lastError || '',
        canCancel: task.canCancel === true,
        canRetry: false,
        canRemove: ['failed', 'done', 'cancelled'].includes(normalizedStatus),
        createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : '',
        updatedAt: task.lastAttemptAt || '',
      };
    });

  const pendingImages = listPendingImages()
    .filter((task) => matchesProject(task, projectId))
    .map((task) => ({
      id: `pending-image:${task.projectId}:${task.category}:${task.imageName}`,
      source: 'pending-image',
      type: 'image-sync',
      title: `${task.imageName || '图片'} 待同步`,
      status: 'queued',
      provider: '',
      providerLabel: '',
      projectId: task.projectId,
      projectName: projectName(task.projectId),
      category: task.category,
      imageName: task.imageName,
      total: '',
      message: task.error || task.sourceUrl || '',
      error: task.error || '',
      canCancel: true,
      canRetry: false,
      canRemove: true,
      createdAt: task.createdAt || '',
      updatedAt: task.updatedAt || '',
    }));

  const tasks = [...jobs, ...pendingVideos, ...pendingImages].sort((a, b) => {
    const ad = a.updatedAt || a.createdAt || '';
    const bd = b.updatedAt || b.createdAt || '';
    return bd.localeCompare(ad);
  });

  const summary = {
    total: tasks.length,
    running: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => task.status === 'queued').length,
    paused: tasks.filter((task) => task.status === 'paused').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    cancelled: tasks.filter((task) => task.status === 'cancelled').length,
    done: tasks.filter((task) => task.status === 'done').length,
  };

  return { tasks, summary };
}

async function performTaskAction(body) {
  const source = String(body.source || 'job');
  const action = String(body.action || '');
  if (!['cancel', 'retry', 'remove'].includes(action)) throw new Error('不支持的任务操作');

  if (source === 'job') {
    if (action === 'cancel') return requestJobCancellation(body.taskId);
    if (action === 'retry') return retryJob(body.taskId);
    return { removed: removeJob(body.taskId) };
  }

  if (source === 'pending-video') {
    if (action === 'retry') throw new Error('该视频待办无法直接重试，请回到镜头重新生成');
    const pending = listPending().find((task) => task.submitId === body.submitId);
    if (action === 'cancel') {
      if (!pending) return { removed: false };
      const cancel = pending.provider === 'dreamina-agent'
        ? cancelDreaminaAgentUnsubmittedShot
        : pending.provider === 'updream'
          ? cancelUpdreamUnsubmittedShot
          : pending.provider === 'neowow'
            ? cancelNeowowUnsubmittedShot
            : null;
      const result = cancel?.(pending.projectId, pending.episodeId, pending.shotNo) || { cleared: 0 };
      if (!result.cleared) throw new Error('该任务已发送或正在发送，已保留结果追踪');
      return { removed: true };
    }
    if (pending && ['queued', 'running'].includes(normalizeStatus(pending.status))) {
      throw new Error('该任务仍在发送或等待出片，不能移除结果追踪');
    }
    removePending(body.submitId);
    return { removed: true };
  }

  if (source === 'pending-image') {
    if (action === 'retry') throw new Error('该图片待同步任务无法直接重试，请回到元素页重新同步');
    return { removed: removePendingImage(body.projectId, body.category, body.imageName) };
  }

  throw new Error('未知任务来源');
}

export async function handleTaskRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if ((p === '/api/tasks' || p === '/api/task-center') && method === 'GET') {
    const projectId = url.searchParams.get('projectId') || '';
    sendJson(res, 200, { ok: true, ...listTaskCenter({ projectId }) });
    return true;
  }
  if ((p === '/api/tasks/summary' || p === '/api/task-center/summary') && method === 'GET') {
    const projectId = url.searchParams.get('projectId') || '';
    const { summary } = listTaskCenter({ projectId });
    sendJson(res, 200, { ok: true, summary });
    return true;
  }
  if (p === '/api/tasks/action' && method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await performTaskAction(body);
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error?.message || String(error) });
    }
    return true;
  }
  if (p === '/api/tasks/clear-finished' && method === 'POST') {
    let count = clearFinishedJobs();
    for (const task of listPending()) {
      if (!['done', 'failed', 'cancelled'].includes(normalizeStatus(task.status))) continue;
      removePending(task.submitId);
      count++;
    }
    sendJson(res, 200, { ok: true, count });
    return true;
  }
  return false;
}
