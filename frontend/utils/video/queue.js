import { removeShotFromVideoQueue, videoQueueHasShot } from './queueCore.js';
import {
  createPendingPollRuntimeContext,
  createRefetchShotVideoRuntime,
  createSyncShotVideosFromServerRuntime,
} from './submit.js';

export function addShotToVideoQueueFlow(shot, handlers = {}) {
  const key = handlers.shotKey(shot.no);
  if (videoQueueHasShot(handlers.queue.items, shot.no)) return false;
  if (handlers.shotStatus(key) === 'generating' || handlers.shotStatus(key) === 'queued') return false;
  handlers.resumeTracking?.(shot.no);
  handlers.queue.items.push(shot);
  handlers.setShotStatus(key, 'queued');
  handlers.setShotProgress?.(key, {
    percentage: 1,
    source: 'estimate',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    note: '',
  });
  if (!handlers.queue.processing) handlers.scheduleQueueProcessing();
  return true;
}

export function removeVideoQueueItemFlow(index, handlers = {}) {
  const queue = handlers.queue;
  if (index < 0 || index >= queue.items.length) return;
  const shot = queue.items[index];
  const key = handlers.shotKey(shot.no);
  queue.items.splice(index, 1);
  if (!queue.items.length) handlers.cancelStartTimer();
  if (handlers.shotStatus(key) === 'queued') {
    handlers.deleteShotStatus(key);
    handlers.deleteShotProgress?.(key);
  }
  handlers.success(`已从队列中移除镜头 ${shot.no}`);
}

export function createVideoQueueRuntime({ message, refs = {}, helpers = {} } = {}) {
  const context = {
    queue: refs.queue,
    shotKey: helpers.shotKey,
    shotStatus: (key) => refs.shotStatus[key],
    setShotStatus: (key, status) => { refs.shotStatus[key] = status; },
    setShotProgress: (key, progress) => { if (refs.shotProgress) refs.shotProgress[key] = progress; },
    deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
    cancelStartTimer: helpers.cancelStartTimer,
    scheduleQueueProcessing: helpers.scheduleQueueProcessing,
    resumeTracking: helpers.resumeTracking,
    success: message?.success,
    warning: message?.warning,
    info: message?.info,
  };
  return {
    add: (shot) => addShotToVideoQueueFlow(shot, context),
    remove: (index) => removeVideoQueueItemFlow(index, context),
    pause: () => pauseVideoQueueFlow(context),
    clear: () => clearVideoQueueFlow(context),
  };
}

export function createVideoQueueActionsRuntime({ message, refs = {}, helpers = {}, globals = {} } = {}) {
  const startDelayMs = Number(helpers.startDelayMs) || 500;
  let startTimer = null;
  let processor = helpers.processQueue || null;
  const setProcessor = (nextProcessor) => { processor = nextProcessor; };
  const cancelStartTimer = () => {
    if (!startTimer) return;
    globals.clearTimeout(startTimer);
    startTimer = null;
  };
  const scheduleQueueProcessing = (delay = startDelayMs) => {
    if (refs.queue.processing) return;
    cancelStartTimer();
    startTimer = globals.setTimeout(() => {
      startTimer = null;
      processor?.();
    }, delay);
  };
  const runtime = createVideoQueueRuntime({
    message,
    refs: { queue: refs.queue, shotStatus: refs.shotStatus, shotProgress: refs.shotProgress },
    helpers: {
      shotKey: helpers.shotKey,
      cancelStartTimer,
      scheduleQueueProcessing,
      resumeTracking: helpers.resumeTracking,
    },
  });
  return {
    removeFromQueue: runtime.remove,
    addToVideoQueue: runtime.add,
    pauseVideoQueue: runtime.pause,
    clearVideoQueue: runtime.clear,
    cancelVideoQueueStartTimer: cancelStartTimer,
    scheduleVideoQueueProcessing: scheduleQueueProcessing,
    setVideoQueueProcessor: setProcessor,
  };
}

export function pauseVideoQueueFlow(handlers = {}) {
  handlers.warning('视频任务已提交到后端，当前不能暂停；如需取消请等本轮结束后清理追踪状态');
}

export function clearVideoQueueFlow(handlers = {}) {
  const queue = handlers.queue;
  if (queue.processing) {
    handlers.warning('视频任务运行中，不能清空队列');
    return false;
  }
  handlers.cancelStartTimer();
  for (const shot of queue.items) {
    const key = handlers.shotKey(shot.no);
    const status = handlers.shotStatus(key);
    if (status === 'queued' || status === 'generating') {
      handlers.deleteShotStatus(key);
      handlers.deleteShotProgress?.(key);
    }
  }
  queue.items = [];
  handlers.info('已清空待提交镜头');
  return true;
}

export async function clearShotVideoFlow(no, handlers = {}) {
  const key = handlers.shotKey(no);
  const value = handlers.shotVideo(key);
  if (value && value.startsWith('blob:')) handlers.revokeObjectUrl(value);
  handlers.deleteShotVideo(key);
  handlers.deleteShotProgress?.(key);
  const storyboard = handlers.storyboard();
  if (storyboard?.shotVideos?.[String(no)]) {
    delete storyboard.shotVideos[String(no)];
    handlers.saveScript();
  }
  const project = handlers.project();
  if (!project) return true;
  try {
    // Wait for the single backend cleanup before a regenerate request can be submitted.
    // The previous fire-and-forget + awaited duplicate requests could race and clear the new task.
    const result = await handlers.clearPending({
      projectId: project.id,
      episodeId: handlers.episodeId(),
      shotNo: no,
    });
    // 后端还有文件没删掉时，磁盘对账会在下次同步时把这个镜头恢复出来。
    // 静默返回成功会让用户以为清除生效了，所以这里必须报出来。
    if (result?.deferredCleanup) {
      handlers.warning?.(`镜头 ${no} 的视频文件正被占用，未能彻底清除；请关闭正在播放的视频后重试`);
      return 'deferred';
    }
    return true;
  } catch (error) {
    handlers.warning?.(`镜头 ${no} 的视频清除失败：${error?.message || error}`);
    return false;
  }
}

export async function resetShotVideoForRegenerateFlow(no, handlers = {}) {
  const project = handlers.project();
  if (project) {
    const payload = {
      projectId: project.id,
      episodeId: handlers.episodeId(),
      shotNo: no,
      preserveVideo: true,
    };
    // 旧任务清理偶发被文件锁挡住（EPERM/EBUSY：杀软/索引服务扫描高频小 json，
    // 2026-09-10 .dreamina-agent.json 实测）——自动重试一次再放弃，避免用户手点重试。
    for (let attempt = 0; ; attempt += 1) {
      try {
        await handlers.clearPending(payload);
        break;
      } catch (error) {
        if (attempt >= 1) {
          handlers.warning?.(`镜头 ${no} 的旧任务清理失败：${error?.message || error}`);
          throw new Error('旧任务清理失败，请稍后重试');
        }
        handlers.warning?.(`镜头 ${no} 的旧任务清理被文件锁挡住，2.5 秒后自动重试…`);
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    }
  }
  handlers.deleteShotStatus(handlers.shotKey(no));
  handlers.deleteShotProgress?.(handlers.shotKey(no));
}

export function createShotVideoCleanupRuntimeContext({ api, message = {}, refs = {}, helpers = {} } = {}) {
  const pendingHandlers = () => ({
    project: () => refs.project.value,
    episodeId: () => refs.episodeId.value,
    shotKey: helpers.shotVideoKey,
    clearPending: (payload) => api.post('/api/video/pending/clear', payload),
    deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
  });
  const clearShotVideo = (no) => clearShotVideoFlow(no, {
    ...pendingHandlers(),
    shotVideo: (key) => refs.shotVideos[key],
    deleteShotVideo: (key) => { delete refs.shotVideos[key]; },
    revokeObjectUrl: helpers.revokeObjectUrl,
    storyboard: () => helpers.findStoryboard(refs.episodeId.value),
    saveScript: helpers.saveScript,
    warning: message.warning,
  });
  return {
    clearShotVideo,
    resetShotVideoForRegenerate: (no) => resetShotVideoForRegenerateFlow(no, {
      ...pendingHandlers(),
      warning: message.warning,
    }),
  };
}

export async function cancelShotQueueFlow(no, handlers = {}) {
  handlers.markTrackingStopped?.(no);
  try {
    const result = await handlers.clearPending({
      projectId: handlers.project().id,
      episodeId: handlers.episodeId(),
      shotNo: no,
      preserveVideo: true,
      stopTracking: true,
    });
    handlers.removeQueueShot?.(no);
    const key = handlers.shotKey(no);
    handlers.deleteShotStatus(key);
    handlers.deleteShotProgress?.(key);
    handlers.success(`已切断镜头 ${no} 的排队与结果追踪`);
    return true;
  } catch (error) {
    handlers.resumeTracking?.(no);
    handlers.error('取消失败：' + (error.message || error));
    return false;
  }
}

export async function clearAllPendingFlow(handlers = {}) {
  try {
    const result = await handlers.clearPending({
      projectId: handlers.project().id,
      episodeId: handlers.episodeId(),
      unsubmittedOnly: true,
    });
    const cancelled = new Set((result.cancelledShotNos || []).map(String));
    for (const no of cancelled) {
      const key = handlers.shotKey(no);
      handlers.deleteShotStatus(key);
      handlers.deleteShotProgress?.(key);
    }
    if (result.cleared) handlers.success(`已取消本集 ${result.cleared} 个尚未发送的任务`);
    if (result.preserved) handlers.info(`已保留 ${result.preserved} 个已发送或正在发送的任务，继续自动抓取`);
    if (!result.cleared && !result.preserved) handlers.info('当前没有可取消的未发送任务');
    return result;
  } catch (error) {
    handlers.error('取消本集排队失败：' + (error.message || error));
    return null;
  }
}

function episodeShotNumbers(handlers = {}) {
  const episodeId = handlers.episodeId();
  const prefix = `${episodeId}:`;
  const numbers = new Set((handlers.currentShots?.() || []).map((shot) => String(shot?.no ?? '').trim()).filter(Boolean));
  for (const key of handlers.shotStatusKeys?.() || []) {
    if (String(key).startsWith(prefix)) numbers.add(String(key).slice(prefix.length));
  }
  for (const shot of handlers.queue?.items || []) {
    const no = String(shot?.no ?? '').trim();
    if (no) numbers.add(no);
  }
  return numbers;
}

export async function refetchAllShotVideosFlow(handlers = {}) {
  const project = handlers.project?.();
  if (!project) return false;
  if (handlers.episodeVideoAction?.()) return false;
  const episodeId = handlers.episodeId();
  const allowedStatuses = new Set(['queued', 'failed', 'generating']);
  try { await handlers.hydratePending?.(); } catch { /* best effort; the per-shot refetch still validates state */ }
  let pendingTasks = [];
  try {
    const pendingState = await handlers.pendingState();
    pendingTasks = (pendingState?.pending || []).filter((task) => (
      String(task.episodeId) === String(episodeId)
      && task.status !== 'done'
    ));
  } catch (error) {
    return handlers.error?.(`读取本集视频任务失败：${error?.message || error}`) || false;
  }
  const targetNumbers = new Set([
    ...episodeShotNumbers(handlers),
    ...pendingTasks.map((task) => String(task.shotNo ?? '').trim()).filter(Boolean),
  ]);
  const targets = [...targetNumbers].filter((no) => (
    allowedStatuses.has(handlers.shotVideoStatus(no))
    || pendingTasks.some((task) => String(task.shotNo) === String(no))
  ));
  if (!targets.length) {
    handlers.info?.('本集没有可重新抓取的视频任务');
    return false;
  }

  handlers.setEpisodeVideoAction?.('refetch');
  let done = 0;
  let pending = 0;
  let failed = 0;
  try {
    for (const no of targets) {
      if (handlers.isContextCurrent && !handlers.isContextCurrent(project.id, episodeId)) {
        handlers.info?.('项目或集数已切换，已停止本集重新抓取');
        return false;
      }
      if (!allowedStatuses.has(handlers.shotVideoStatus(no))) {
        const pendingTask = pendingTasks.find((task) => String(task.shotNo) === String(no));
        if (pendingTask) {
          handlers.setShotStatus?.(
            handlers.shotKey(no),
            pendingTask.status === 'failed' ? 'failed' : 'queued',
          );
        }
      }
      if (!allowedStatuses.has(handlers.shotVideoStatus(no))) continue;
      await handlers.refetchShotVideo(no, { silent: true, projectId: project.id, episodeId });
      if (handlers.isContextCurrent && !handlers.isContextCurrent(project.id, episodeId)) {
        handlers.info?.('项目或集数已切换，已停止本集重新抓取');
        return false;
      }
      if (handlers.shotVideoUrl(no)) done += 1;
      else if (handlers.shotVideoStatus(no) === 'failed') failed += 1;
      else pending += 1;
    }
    handlers.success?.(`本集重新抓取完成：已拉回 ${done} 个，继续追踪 ${pending} 个${failed ? `，失败 ${failed} 个` : ''}`);
    return { targets: targets.length, done, pending, failed };
  } catch (error) {
    handlers.error?.(`本集重新抓取失败：${error?.message || error}`);
    return false;
  } finally {
    handlers.setEpisodeVideoAction?.('');
  }
}

export async function forceRemoveAllShotTrackingFlow(handlers = {}) {
  const project = handlers.project?.();
  if (!project) return false;
  if (handlers.episodeVideoAction?.()) return false;
  const episodeId = handlers.episodeId();
  const shotNos = episodeShotNumbers(handlers);
  if (!shotNos.size) {
    handlers.info?.('本集没有可移除的视频追踪');
    return false;
  }
  const allNos = [...shotNos];
  allNos.forEach((no) => handlers.markTrackingStopped?.(no, project.id, episodeId));
  handlers.setEpisodeVideoAction?.('remove');
  try {
    const result = await handlers.clearPending({
      projectId: project.id,
      episodeId,
      shotNos: allNos,
      preserveVideo: true,
      stopTracking: true,
    });
    const stopped = new Set([
      ...allNos,
      ...(result?.stoppedShotNos || []).map(String),
    ]);
    for (const no of stopped) {
      handlers.removeQueueShot?.(no);
      const key = handlers.shotKey(no);
      handlers.deleteShotStatus(key);
      handlers.deleteShotProgress?.(key);
    }
    handlers.success?.(`已强制移除本集 ${stopped.size} 个视频的排队与结果追踪`);
    return result;
  } catch (error) {
    allNos.forEach((no) => handlers.resumeTracking?.(no, project.id, episodeId));
    handlers.error?.(`本集强制移除失败：${error?.message || error}`);
    return false;
  } finally {
    handlers.setEpisodeVideoAction?.('');
  }
}

export function createPendingVideoCleanupRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const pendingHandlers = () => ({
    project: () => refs.project.value,
    episodeId: () => refs.episodeId.value,
    shotKey: helpers.shotVideoKey,
    clearPending: (payload) => api.post('/api/video/pending/clear', payload),
    deleteShotStatus: (key) => { delete refs.shotStatus[key]; },
    deleteShotProgress: (key) => { if (refs.shotProgress) delete refs.shotProgress[key]; },
    removeQueueShot: (no) => helpers.removeQueueShot?.(no),
    markTrackingStopped: (...args) => helpers.markTrackingStopped?.(...args),
    resumeTracking: (...args) => helpers.resumeTracking?.(...args),
  });
  return {
    cancelShotQueue: (no) => cancelShotQueueFlow(no, {
      ...pendingHandlers(),
      success: message.success,
      info: message.info,
      error: message.error,
    }),
    clearAllPending: () => clearAllPendingFlow({
      ...pendingHandlers(),
      shotStatusKeys: () => Object.keys(refs.shotStatus),
      shotStatus: (key) => refs.shotStatus[key],
      success: message.success,
      info: message.info,
      error: message.error,
    }),
    forceRemoveAllShotTracking: () => forceRemoveAllShotTrackingFlow({
      ...pendingHandlers(),
      currentShots: () => refs.currentShots?.value || [],
      shotStatusKeys: () => Object.keys(refs.shotStatus || {}),
      shotStatus: (key) => refs.shotStatus[key],
      shotVideoUrl: helpers.shotVideoUrl,
      queue: refs.videoQueue,
      episodeVideoAction: () => refs.episodeVideoAction?.value || '',
      setEpisodeVideoAction: (value) => { if (refs.episodeVideoAction) refs.episodeVideoAction.value = value; },
      success: message.success,
      info: message.info,
      error: message.error,
    }),
  };
}

export function createShotVideoAccessRuntime({ api, message, refs = {}, helpers = {}, globals = {} } = {}) {
  const shotVideoKey = (no, episodeId = refs.episodeId.value) => `${episodeId}:${no}`;
  const shotVideoStatus = (no, episodeId = refs.episodeId.value) => refs.shotStatus[shotVideoKey(no, episodeId)] || '';
  const shotVideoUrl = (no, episodeId = refs.episodeId.value, ignoreTaskState = false) => {
    // A regenerate task owns the player while it is queued/generating/failed. Never let a
    // stale on-disk URL win over the current task state and render a broken old player.
    // ignoreTaskState=true 只给"播放器是否该留在原地"用：模板据此判断这一镜是否已经有视频，
    // 好把进度浮层盖在播放器之上，而不是销毁播放器。否则任务状态每抖一次，
    // <video> 就被销毁重建、视频从头加载 —— 表现就是画面一闪一闪。
    if (!ignoreTaskState && shotVideoStatus(no, episodeId)) return '';
    return refs.shotVideos[shotVideoKey(no, episodeId)] || '';
  };
  // 本地视频在服务端原子替换/杀软扫描/短暂占用的窗口里会瞬时 404/423，
  // 一次 <video> error 就永久标 failed，会把刚拉回的好视频显示成「视频不
  // 可用」。用户机器上杀软扫描新落盘视频可持续数秒，带新时间戳按 1.5s/4s/8s
  // 退避重试（URL 变化触发 v-lazy-video 重新加载），耗尽才认定失败。
  const SHOT_VIDEO_RETRY_DELAYS = [1500, 4000, 8000];
  const shotVideoLoadRetries = new Map();
  const playerFailedShots = new Map();
  const setTimeoutFn = globals.setTimeout || globalThis.setTimeout;
  const clearTimeoutFn = globals.clearTimeout || globalThis.clearTimeout;
  const clearShotVideoLoadRetry = (key) => {
    const entry = shotVideoLoadRetries.get(key);
    if (entry?.timer != null) clearTimeoutFn?.(entry.timer);
    shotVideoLoadRetries.delete(key);
  };
  const markShotVideoLoaded = (no) => {
    const key = shotVideoKey(no);
    clearShotVideoLoadRetry(key);
    const failedUrl = playerFailedShots.get(key);
    playerFailedShots.delete(key);
    if (failedUrl !== refs.shotVideos[key] || refs.shotStatus[key] !== 'failed') return false;
    delete refs.shotStatus[key];
    if (refs.shotProgress) delete refs.shotProgress[key];
    return true;
  };
  const markShotVideoLoadFailed = (no) => {
    const key = shotVideoKey(no);
    const url = refs.shotVideos[key];
    if (!url || shotVideoStatus(no)) return false;
    const now = Date.now();
    let entry = shotVideoLoadRetries.get(key);
    if (entry && (entry.url !== url || now - entry.at >= 60000)) {
      clearShotVideoLoadRetry(key);
      entry = null;
    }
    if (entry?.timer != null) return false;
    const attempts = entry && now - entry.at < 60000 ? entry.count : 0;
    if (attempts < SHOT_VIDEO_RETRY_DELAYS.length && !url.startsWith('blob:')) {
      const retryEntry = { count: attempts + 1, at: now, url, timer: null };
      retryEntry.timer = setTimeoutFn(() => {
        if (shotVideoLoadRetries.get(key) !== retryEntry) return;
        retryEntry.timer = null;
        // 期间 URL 已被替换/清除，或镜头进入了新的生成流程，则不再干预。
        if (refs.shotVideos[key] !== retryEntry.url || shotVideoStatus(no)) {
          shotVideoLoadRetries.delete(key);
          return;
        }
        const retryUrl = `${url.split('?')[0]}?t=${Date.now()}`;
        retryEntry.url = retryUrl;
        retryEntry.at = Date.now();
        refs.shotVideos[key] = retryUrl;
      }, SHOT_VIDEO_RETRY_DELAYS[attempts]);
      shotVideoLoadRetries.set(key, retryEntry);
      return false;
    }
    clearShotVideoLoadRetry(key);
    playerFailedShots.set(key, url);
    refs.shotStatus[key] = 'failed';
    if (refs.shotProgress) {
      refs.shotProgress[key] = {
        percentage: 0,
        source: 'estimate',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        note: '',
        error: '本地视频文件加载失败，请先重新抓取；仍失败再重新生成',
      };
    }
    return true;
  };
  return {
    shotVideoKey,
    shotVideoUrl,
    shotVideoStatus,
    markShotVideoLoaded,
    markShotVideoLoadFailed,
    onPickShotVideo: async (event, no) => {
      const selectedFile = [...(event.target.files || [])].find((item) => item.type?.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi)$/i.test(item.name || ''));
      if (selectedFile) {
        const key = shotVideoKey(no);
        const previewUrl = globals.createObjectURL(selectedFile);
        const previousUrl = refs.shotVideos[key];
        if (previousUrl?.startsWith?.('blob:')) globals.revokeObjectUrl?.(previousUrl);
        refs.shotVideos[key] = previewUrl;
        delete refs.shotStatus[key];
        if (refs.shotProgress) delete refs.shotProgress[key];
        event.target.value = '';
        try {
          const projectId = refs.project?.value?.id;
          if (!projectId || !api?.upload) throw new Error('当前项目不可用');
          const query = new URLSearchParams({ projectId: String(projectId), episodeId: String(refs.episodeId.value), shotNo: String(no) });
          const result = await api.upload(`/api/video/upload?${query.toString()}`, selectedFile, {
            contentType: selectedFile.type || 'application/octet-stream',
            timeoutMs: 30 * 60 * 1000,
          });
          if (!result?.ok || !result.videoUrl) throw new Error(result?.error || '视频上传失败');
          globals.revokeObjectUrl?.(previewUrl);
          refs.shotVideos[key] = result.videoUrl;
          const storyboard = helpers.findStoryboard?.(refs.episodeId.value);
          if (storyboard) {
            if (!storyboard.shotVideos || typeof storyboard.shotVideos !== 'object') storyboard.shotVideos = {};
            storyboard.shotVideos[String(no)] = { videoUrl: result.videoUrl, updatedAt: new Date().toISOString() };
            helpers.saveScript?.();
          }
          message.success(`镜头 ${no} 已读入本地视频`);
        } catch (error) {
          globals.revokeObjectUrl?.(previewUrl);
          if (refs.shotVideos[key] === previewUrl) delete refs.shotVideos[key];
          message.error(error.message || '视频上传失败');
        }
        return;
      }
      const file = [...(event.target.files || [])].find((item) => item.type?.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi)$/i.test(item.name || ''));
      event.target.value = '';
      if (!file) return message.warning('请选择视频文件');
      refs.shotVideos[shotVideoKey(no)] = globals.createObjectURL(file);
      message.success('已载入本地预览');
    },
    hydrateShotVideos: () => {
      const storyboard = helpers.findStoryboard(refs.episodeId.value);
      const map = storyboard?.shotVideos || {};
      for (const [no, meta] of Object.entries(map)) {
        const key = `${refs.episodeId.value}:${no}`;
        if (meta?.videoUrl && !refs.shotVideos[key]) refs.shotVideos[key] = meta.videoUrl;
      }
    },
  };
}

export function createShotVideoPipelineRuntime({ api, message, refs = {}, helpers = {}, globals = {} } = {}) {
  const {
    shotVideoKey,
    shotVideoUrl,
    shotVideoStatus,
    markShotVideoLoaded,
    markShotVideoLoadFailed,
    onPickShotVideo,
    hydrateShotVideos,
  } = createShotVideoAccessRuntime({
    api,
    message,
    refs: { project: refs.project, episodeId: refs.episodeId, shotVideos: refs.shotVideos, shotStatus: refs.shotStatus, shotProgress: refs.shotProgress },
    helpers: { findStoryboard: helpers.findStoryboard, saveScript: helpers.saveScript },
    globals,
  });

  const {
    clearShotVideo,
    resetShotVideoForRegenerate,
  } = createShotVideoCleanupRuntimeContext({
    api,
    message,
    refs: { project: refs.project, episodeId: refs.episodeId, shotVideos: refs.shotVideos, shotStatus: refs.shotStatus, shotProgress: refs.shotProgress },
    helpers: {
      shotVideoKey,
      revokeObjectUrl: helpers.revokeObjectUrl,
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
    },
  });

  const syncShotVideosFromServer = createSyncShotVideosFromServerRuntime({
    api,
    refs: { project: refs.project, episodeId: refs.episodeId, shotVideos: refs.shotVideos, shotStatus: refs.shotStatus, shotProgress: refs.shotProgress },
    helpers: { findStoryboard: helpers.findStoryboard },
  });

  const {
    pollPendingOnce,
    startPendingPoll,
    hydratePending,
  } = createPendingPollRuntimeContext({
    api,
    intervalMs: 5000,
    refs: { project: refs.project, episodeId: refs.episodeId, shotVideos: refs.shotVideos, shotStatus: refs.shotStatus, shotProgress: refs.shotProgress },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
      syncShotVideosFromServer,
      shotVideoUrl,
    },
  });

  const refetchShotVideo = createRefetchShotVideoRuntime({
    api,
    message,
    refs: { project: refs.project, episodeId: refs.episodeId, shotStatus: refs.shotStatus, shotProgress: refs.shotProgress },
    helpers: { shotVideoKey, shotVideoStatus, pollPendingOnce, shotVideoUrl, syncShotVideosFromServer },
  });

  const refetchAllShotVideos = () => refetchAllShotVideosFlow({
    project: () => refs.project.value,
    episodeId: () => refs.episodeId.value,
    currentShots: () => refs.currentShots?.value || [],
    shotStatusKeys: () => Object.keys(refs.shotStatus || {}),
    shotVideoStatus,
    shotKey: shotVideoKey,
    setShotStatus: (key, status) => { refs.shotStatus[key] = status; },
    shotVideoUrl,
    pendingState: () => api.get(`/api/video/pending?projectId=${encodeURIComponent(refs.project.value.id)}`),
    hydratePending,
    refetchShotVideo,
    isContextCurrent: (projectId, episodeId) => (
      String(refs.project.value?.id ?? '') === String(projectId ?? '')
      && String(refs.episodeId.value) === String(episodeId)
    ),
    setEpisodeVideoAction: (value) => { if (refs.episodeVideoAction) refs.episodeVideoAction.value = value; },
    episodeVideoAction: () => refs.episodeVideoAction?.value || '',
    success: message.success,
    info: message.info,
    error: message.error,
  });

  const {
    cancelShotQueue,
    clearAllPending,
    forceRemoveAllShotTracking,
  } = createPendingVideoCleanupRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      episodeId: refs.episodeId,
      shotStatus: refs.shotStatus,
      shotProgress: refs.shotProgress,
      currentShots: refs.currentShots,
      videoQueue: refs.videoQueue,
      episodeVideoAction: refs.episodeVideoAction,
    },
    helpers: {
      shotVideoKey,
      removeQueueShot: (no) => removeShotFromVideoQueue(refs.videoQueue?.items, no),
      markTrackingStopped: helpers.markTrackingStopped,
      resumeTracking: helpers.resumeTracking,
    },
  });

  return {
    shotVideoKey,
    shotVideoUrl,
    shotVideoStatus,
    markShotVideoLoaded,
    markShotVideoLoadFailed,
    onPickShotVideo,
    hydrateShotVideos,
    clearShotVideo,
    resetShotVideoForRegenerate,
    syncShotVideosFromServer,
    pollPendingOnce,
    startPendingPoll,
    hydratePending,
    refetchShotVideo,
    refetchAllShotVideos,
    cancelShotQueue,
    clearAllPending,
    forceRemoveAllShotTracking,
  };
}
