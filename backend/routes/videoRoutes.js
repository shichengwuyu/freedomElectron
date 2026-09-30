// 视频生成相关路由
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';

import { loadConfig, saveConfig } from '../config.js';
import { videoDurationStats, introLocalUrl } from '../shotVideoUtils.js';
import { loadProject, normalizeProjectScript, projectDir, saveProject } from '../storage.js';
import { normalizeVideoProvider } from '../videoProviders.js';
import {
  openVideoFolder,
  purgeShotVideoFiles,
  remapShotFiles,
  shiftVideoFiles,
  videoDiskPath,
  videoFileEntryExists,
  introDiskPath,
  shotRefVideoDiskPath,
} from '../videoFunctions.js';
import { selectActiveVideoFiles } from '../services/videoExportSelection.js';
import { exportToJianyingDraft, exportAllEpisodesToJianying, detectJianyingDraftDir, getVideoDuration, introClipExportInfo } from '../videoStorage.js';
import { ensurePlayableCodec } from '../videoTranscode.js';
import {
  clearPendingByProject,
  clearPendingByShot,
  listPending,
  listUnfinished,
  retryPendingByShot,
  stopPendingTrackingByEpisode,
  stopPendingTrackingByShot,
} from '../pendingVideos.js';
import { getJob, listJobs, setJob } from '../jobs.js';
import {
  cancelComfyUiQueuedProject,
  cancelComfyUiQueuedShot,
  cancelComfyUiUnsubmittedProject,
  cancelComfyUiUnsubmittedShot,
  cancelDreaminaAgentQueuedProject,
  cancelDreaminaAgentQueuedShot,
  cancelDreaminaAgentUnsubmittedProject,
  cancelDreaminaAgentUnsubmittedShot,
  cancelNeowowQueuedProject,
  cancelNeowowQueuedShot,
  cancelNeowowUnsubmittedProject,
  cancelNeowowUnsubmittedShot,
  cancelUpdreamQueuedProject,
  cancelUpdreamQueuedShot,
  cancelUpdreamUnsubmittedProject,
  cancelUpdreamUnsubmittedShot,
  extractTailFrame,
  reconcileDreaminaAgentQueueJob,
  saveManualTailFrame,
  saveManualVideo,
  tailFrameLocalUrl,
  reconcileVideosFromUpstream,
  syncUpstreamStatusFromRemote,
  fetchFeituoVideoLedger,
  pruneCompletedVideoPendingRecords,
  upstreamElapsedMs,
  upstreamCostUsd,
} from '../videoService.js';
import {
  applyDreaminaAgentSessionId,
  closeDreaminaAgentBrowser,
  getDreaminaAgentStatus,
  openDreaminaAgentLogin,
} from '../dreaminaAgentClient.js';
import {
  addDreaminaAgentAccount,
  deleteDreaminaAgentAccount,
  dreaminaAgentAccountsPublicView,
  selectDreaminaAgentAccount,
  selectedDreaminaAgentAccountId,
} from '../dreaminaAgentAccounts.js';
import { saveRequestBodyToFile } from '../http.js';
import {
  removeVideoSubtitles,
  restoreVideoBeforeSubtitleRemoval,
  subtitleRemovalStatus,
} from '../services/subtitleRemovalService.js';
import {
  listShotVideoHistory,
  compactShotVideoHistory,
  restoreVideoFromHistory,
  deleteHistoryVersion,
  clearShotVideoHistory,
  getHistoryStats,
} from '../videoHistory.js';

// Import video submission handlers from server.js
// These will be set by server.js after initialization
let submitBatchHandler = null;
let pollPendingVideosHandler = null;
let pollPendingUpdreamVideosHandler = null;
let recoverNeowowPendingShotHandler = null;
let recoverLibtvPendingShotHandler = null;

const ACTIVE_VIDEO_JOB_STATUSES = new Set(['queued', 'running', 'retrying', 'paused']);

function stopVideoJobTracking(projectId, episodeId, shotNo, relatedJobIds = []) {
  const related = new Set((relatedJobIds || []).map(String).filter(Boolean));
  const targetShotNo = String(shotNo);
  let updated = 0;
  for (const job of listJobs()) {
    if (String(job.projectId || '') !== String(projectId) || String(job.episodeId) !== String(episodeId)) continue;
    const isRelatedJob = related.has(String(job.id));
    if (!isRelatedJob && !ACTIVE_VIDEO_JOB_STATUSES.has(job.status)) continue;
    const ownsShot = isRelatedJob
      || (Array.isArray(job.shotNos) && job.shotNos.map(String).includes(targetShotNo))
      || (Array.isArray(job.slots) && job.slots.some((slot) => String(slot?.currentShot?.shotNo) === targetShotNo));
    if (!ownsShot) continue;
    setJob(job.id, {
      ignoredShotNos: [...new Set([...(job.ignoredShotNos || []).map(String), targetShotNo])],
    });
    updated += 1;
  }
  return updated;
}

function stopVideoJobTrackingByEpisode(projectId, episodeId, shotNos = []) {
  const stoppedShotNos = new Set((shotNos || []).map((no) => String(no ?? '').trim()).filter(Boolean));
  let updated = 0;
  for (const job of listJobs()) {
    if (String(job.projectId || '') !== String(projectId) || String(job.episodeId) !== String(episodeId)) continue;
    if (!ACTIVE_VIDEO_JOB_STATUSES.has(job.status)) continue;
    const jobShotNos = [
      ...(Array.isArray(job.shotNos) ? job.shotNos : []),
      ...(Array.isArray(job.slots)
        ? job.slots.map((slot) => slot?.currentShot?.shotNo).filter((no) => no != null)
        : []),
    ].map((no) => String(no ?? '').trim()).filter(Boolean);
    if (!jobShotNos.length) continue;
    for (const no of jobShotNos) stoppedShotNos.add(no);
    setJob(job.id, {
      ignoredShotNos: [...new Set([...(job.ignoredShotNos || []).map(String), ...jobShotNos])],
    });
    updated += 1;
  }
  return { updated, stoppedShotNos: [...stoppedShotNos] };
}

async function removeShotVideoFiles(projectId, episodeId, shotNo) {
  // 每轮重新枚举候选文件：版本文件名是运行时生成的，用一份开头的快照会漏掉
  // 期间新落盘的版本文件，而残留任何一个 .mp4 都会让磁盘对账把镜头复活。
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const stubborn = await purgeShotVideoFiles(projectId, episodeId, shotNo);
    if (!stubborn.length) return [];
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return purgeShotVideoFiles(projectId, episodeId, shotNo);
}

function clearShotVideoMetadata(projectId, episodeId, shotNo) {
  const project = loadProject(projectId);
  if (!project) return;
  normalizeProjectScript(project);
  const storyboard = project.script?.storyboards?.find((item) => String(item.episodeId) === String(episodeId));
  if (!storyboard?.shotVideos || !Object.prototype.hasOwnProperty.call(storyboard.shotVideos, String(shotNo))) return;
  delete storyboard.shotVideos[String(shotNo)];
  project.updatedAt = new Date().toISOString();
  saveProject(project);
}

function persistShotOpenerFrame(projectId, episodeId, targetShotNo, fromShotNo, url, name = '') {
  const project = loadProject(projectId);
  if (!project) return false;
  normalizeProjectScript(project);
  const storyboard = project.script?.storyboards?.find((item) => String(item.episodeId) === String(episodeId));
  if (!storyboard) return false;
  if (!storyboard.openerFrames || typeof storyboard.openerFrames !== 'object') storyboard.openerFrames = {};
  const meta = {
    fromShotNo: String(fromShotNo),
    url,
    updatedAt: new Date().toISOString(),
  };
  const frameName = String(name || '').trim();
  if (frameName) meta.name = frameName;
  storyboard.openerFrames[String(targetShotNo)] = meta;
  project.updatedAt = new Date().toISOString();
  saveProject(project);
  return true;
}

export function setVideoHandlers(handlers) {
  submitBatchHandler = handlers.submitBatch;
  pollPendingVideosHandler = handlers.pollPendingVideos;
  pollPendingUpdreamVideosHandler = handlers.pollPendingUpdreamVideos;
  recoverNeowowPendingShotHandler = handlers.recoverNeowowPendingShot;
  recoverLibtvPendingShotHandler = handlers.recoverLibtvPendingShot;
}

function storedShotVideoProvider(projectId, episodeId, shotNo) {
  const project = loadProject(projectId);
  const storyboard = project?.script?.storyboards?.find((item) => String(item.episodeId) === String(episodeId));
  const shotSettings = storyboard?.shotMeta?.[String(shotNo)]?.videoSettings
    || storyboard?.shotMeta?.[shotNo]?.videoSettings
    || {};
  return normalizeVideoProvider(shotSettings.provider || storyboard?.videoSettings?.provider || loadConfig().video?.provider);
}

// Main route handler
export async function handleVideoRoutes(ctx) {
  const { req, res, url, p, method, readBody, sendJson } = ctx;

  // 分镜页的时长统计：每集「分镜数 / 已出片数 / 已出片时长 / 计划时长」，前端按范围自行求和。
  if (p === '/api/video/duration-stats' && method === 'GET') {
    const projectId = String(url.searchParams.get('projectId') || '').trim();
    const project = projectId ? loadProject(projectId) : null;
    if (!project) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    sendJson(res, 200, { ok: true, ...videoDurationStats(project) });
    return true;
  }

  if (p === '/api/dreamina-agent/status' && method === 'GET') {
    const result = await getDreaminaAgentStatus({
      accountId: url.searchParams.get('accountId') || selectedDreaminaAgentAccountId(),
      launch: false,
    });
    sendJson(res, result.ok === false ? 400 : 200, result);
    return true;
  }

  if (p === '/api/dreamina-agent/accounts' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      accountId: selectedDreaminaAgentAccountId(),
      accounts: dreaminaAgentAccountsPublicView(),
    });
    return true;
  }

  if (p === '/api/dreamina-agent/accounts' && method === 'POST') {
    const body = await readBody(req);
    try {
      const account = addDreaminaAgentAccount({ name: body.name });
      let status = null;
      const sessionId = String(body.sessionId || '').trim();
      if (sessionId) status = await applyDreaminaAgentSessionId(sessionId, { accountId: account.id });
      sendJson(res, 200, {
        ok: status ? status.authenticated === true : true,
        accountId: account.id,
        accountName: account.name,
        status,
        accounts: dreaminaAgentAccountsPublicView(),
        message: status?.message || `${account.name} 已添加`,
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message, message: error.message });
    }
    return true;
  }

  if (p === '/api/dreamina-agent/accounts/select' && method === 'POST') {
    const body = await readBody(req);
    try {
      const account = selectDreaminaAgentAccount(body.accountId);
      sendJson(res, 200, {
        ok: true,
        accountId: account.id,
        accountName: account.name,
        accounts: dreaminaAgentAccountsPublicView(),
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (p === '/api/dreamina-agent/accounts/delete' && method === 'POST') {
    const body = await readBody(req);
    const accountId = String(body.accountId || '').trim();
    try {
      const hasPending = listUnfinished().some((task) => task.provider === 'dreamina-agent' && task.accountId === accountId);
      if (hasPending) throw new Error('这个账号还有排队或生成中的视频，请先取消或等待完成');
      await closeDreaminaAgentBrowser({ accountId });
      deleteDreaminaAgentAccount(accountId);
      sendJson(res, 200, {
        ok: true,
        accountId: selectedDreaminaAgentAccountId(),
        accounts: dreaminaAgentAccountsPublicView(),
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (p === '/api/dreamina-agent/login' && method === 'POST') {
    try {
      const body = await readBody(req);
      const accountId = String(body.accountId || '').trim() || selectedDreaminaAgentAccountId();
      selectDreaminaAgentAccount(accountId);
      const result = await openDreaminaAgentLogin({ accountId });
      sendJson(res, result.ok === false ? 400 : 200, result);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (p === '/api/dreamina-agent/session' && method === 'POST') {
    try {
      const body = await readBody(req);
      const accountId = String(body.accountId || '').trim() || selectedDreaminaAgentAccountId();
      const incoming = String(body.sessionId || '').trim();
      if (!incoming || incoming.includes('****')) throw new Error('请填写完整的即梦官网 Session ID');
      selectDreaminaAgentAccount(accountId);
      const result = await applyDreaminaAgentSessionId(incoming, { accountId });
      sendJson(res, result.ok === false ? 400 : 200, result);
    } catch (error) {
      sendJson(res, 400, { ok: false, authenticated: false, error: error.message, message: error.message });
    }
    return true;
  }

  if (p === '/api/video/subtitles/status' && method === 'GET') {
    const projectId = url.searchParams.get('projectId');
    const episodeId = url.searchParams.get('episodeId');
    const shotNo = url.searchParams.get('shotNo');
    if (!projectId || episodeId == null || shotNo == null) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo' });
      return true;
    }
    try {
      sendJson(res, 200, { ok: true, ...subtitleRemovalStatus(projectId, episodeId, shotNo) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (p === '/api/video/subtitles/remove' && method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await removeVideoSubtitles(body);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (p === '/api/video/subtitles/restore' && method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await restoreVideoBeforeSubtitleRemoval(body);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  // ---- 打开视频文件夹 ----
  if (p === '/api/video/open-folder' && method === 'POST') {
    const body = await readBody(req);
    if (!body.projectId) return sendJson(res, 400, { error: '缺少 projectId' });
    try {
      const dir = openVideoFolder(body.projectId);
      sendJson(res, 200, { ok: true, dir });
      return true;
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // ---- 检测剪映草稿目录 ----
  if (p === '/api/video/detect-jianying-dir' && method === 'POST') {
    try {
      const dir = detectJianyingDraftDir();
      if (dir) {
        sendJson(res, 200, { ok: true, dir });
      } else {
        sendJson(res, 200, { ok: false, error: '未找到剪映草稿目录' });
      }
      return true;
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // ---- 导出到剪映草稿 ----
  if (p === '/api/video/export-to-jianying' && method === 'POST') {
    const body = await readBody(req);
    if (!body.projectId) return sendJson(res, 400, { error: '缺少 projectId' });
    if (!body.episodeId) return sendJson(res, 400, { error: '缺少 episodeId' });
    try {
      const result = await exportToJianyingDraft(body.projectId, body.episodeId);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // ---- 批量导出所有集到剪映草稿 ----
  if (p === '/api/video/export-all-to-jianying' && method === 'POST') {
    const body = await readBody(req);
    if (!body.projectId) return sendJson(res, 400, { error: '缺少 projectId' });
    try {
      const results = await exportAllEpisodesToJianying(body.projectId);
      sendJson(res, 200, { ok: true, results });
      return true;
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // ---- 批量提交视频生成（新接口） ----
  if (p === '/api/video/submit-batch' && method === 'POST') {
    const body = await readBody(req);
    if (!submitBatchHandler) {
      sendJson(res, 500, { error: 'Video submit handler not initialized' });
      return true;
    }
    try {
      const result = await submitBatchHandler(body, ctx);
      sendJson(res, 200, result);
      return true;
    } catch (e) {
      sendJson(res, e.status || 400, { error: e.message });
      return true;
    }
  }

  // ---- 清除待办视频记录 ----
  if (p === '/api/video/pending/clear' && method === 'POST') {
    const body = await readBody(req);
    const {
      projectId,
      episodeId,
      shotNo,
      preserveVideo = false,
      stopTracking = false,
      unsubmittedOnly = false,
      shotNos = [],
    } = body;
    if (!projectId) return sendJson(res, 400, { error: '缺少 projectId' });
    if (unsubmittedOnly === true) {
      const inScope = (task) => (
        task.projectId === projectId
        && (episodeId == null || String(task.episodeId) === String(episodeId))
        && (shotNo == null || String(task.shotNo) === String(shotNo))
      );
      const before = listPending().filter(inScope);
      const results = shotNo != null && episodeId != null
        ? [
            cancelDreaminaAgentUnsubmittedShot(projectId, episodeId, shotNo),
            cancelUpdreamUnsubmittedShot(projectId, episodeId, shotNo),
            cancelNeowowUnsubmittedShot(projectId, episodeId, shotNo),
            cancelComfyUiUnsubmittedShot(projectId, episodeId, shotNo),
          ]
        : [
            cancelDreaminaAgentUnsubmittedProject(projectId, episodeId ?? null),
            cancelUpdreamUnsubmittedProject(projectId, episodeId ?? null),
            cancelNeowowUnsubmittedProject(projectId, episodeId ?? null),
            cancelComfyUiUnsubmittedProject(projectId, episodeId ?? null),
          ];
      const cancelledShotNos = [...new Set(results.flatMap((result) => result.cancelledShotNos || []).map(String))];
      const cleared = results.reduce((total, result) => total + (Number(result.cleared) || 0), 0);
      sendJson(res, 200, {
        ok: true,
        cleared,
        cancelledShotNos,
        preserved: Math.max(0, before.length - cleared),
        preservedTracking: true,
      });
      return true;
    }
    let cleared;
    if (stopTracking === true && shotNo == null && episodeId != null) {
      const pendingTasks = listPending().filter((task) => (
        task.projectId === projectId && String(task.episodeId) === String(episodeId)
      ));
      const requestedShotNos = [
        ...(Array.isArray(shotNos) ? shotNos : [shotNos]),
        ...pendingTasks.map((task) => task.shotNo),
      ];
      const jobTracking = stopVideoJobTrackingByEpisode(projectId, episodeId, requestedShotNos);
      const queuedCleared = (
        cancelDreaminaAgentQueuedProject(projectId, episodeId)
        + cancelUpdreamQueuedProject(projectId, episodeId)
        + cancelNeowowQueuedProject(projectId, episodeId)
        + cancelComfyUiQueuedProject(projectId, episodeId)
      );
      const tracking = stopPendingTrackingByEpisode(
        projectId,
        episodeId,
        [...new Set([...requestedShotNos, ...jobTracking.stoppedShotNos])],
      );
      sendJson(res, 200, {
        ok: true,
        cleared: tracking.cleared + queuedCleared,
        stoppedTracking: true,
        stoppedShotNos: [...new Set([...tracking.stoppedShotNos, ...jobTracking.stoppedShotNos])],
        preservedVideo: preserveVideo === true,
      });
      return true;
    }
    if (shotNo != null && episodeId != null) {
      const pendingTasks = listPending().filter((task) => (
        task.projectId === projectId
        && String(task.episodeId) === String(episodeId)
        && String(task.shotNo) === String(shotNo)
      ));
      const relatedJobIds = pendingTasks.flatMap((task) => [task.jobId, ...(task.jobIds || [])]);
      const dreaminaAgentCleared = cancelDreaminaAgentQueuedShot(projectId, episodeId, shotNo);
      const updreamCleared = cancelUpdreamQueuedShot(projectId, episodeId, shotNo);
      const neowowCleared = cancelNeowowQueuedShot(projectId, episodeId, shotNo);
      const comfyUiCleared = cancelComfyUiQueuedShot(projectId, episodeId, shotNo);
      const pendingCleared = stopTracking === true
        ? stopPendingTrackingByShot(projectId, episodeId, shotNo)
        : clearPendingByShot(projectId, episodeId, shotNo);
      const ignoredJobs = stopTracking === true
        ? stopVideoJobTracking(projectId, episodeId, shotNo, relatedJobIds)
        : 0;
      cleared = (pendingCleared || dreaminaAgentCleared || updreamCleared || neowowCleared || comfyUiCleared || ignoredJobs) ? 1 : 0;
      if (preserveVideo === true) {
        sendJson(res, 200, {
          ok: true,
          cleared,
          preservedVideo: true,
          stoppedTracking: stopTracking === true,
        });
        return true;
      }
      const busyFiles = await removeShotVideoFiles(projectId, episodeId, shotNo);
      clearShotVideoMetadata(projectId, episodeId, shotNo);
      sendJson(res, 200, { ok: true, cleared, deferredCleanup: busyFiles.length > 0 });
      return true;
    } else {
      cancelDreaminaAgentQueuedProject(projectId, episodeId ?? null);
      const updreamCleared = cancelUpdreamQueuedProject(projectId, episodeId ?? null);
      const neowowCleared = cancelNeowowQueuedProject(projectId, episodeId ?? null);
      const comfyUiCleared = cancelComfyUiQueuedProject(projectId, episodeId ?? null);
      cleared = clearPendingByProject(projectId, episodeId ?? null) + updreamCleared + neowowCleared + comfyUiCleared;
    }
    sendJson(res, 200, { ok: true, cleared });
    return true;
  }

  // ---- 上传本地视频到指定分镜 ----
  // The body is the raw video bytes. Keeping this endpoint binary avoids
  // base64 expansion and lets the server validate and persist the file.
  if (p === '/api/video/upload' && method === 'POST') {
    const projectId = url.searchParams.get('projectId');
    const episodeId = url.searchParams.get('episodeId');
    const shotNo = url.searchParams.get('shotNo');
    if (!projectId || episodeId == null || shotNo == null) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo' });
      return true;
    }
    if (!loadProject(projectId)) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    const tempPath = path.join(os.tmpdir(), `hepai-video-upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.upload`);
    try {
      await saveRequestBodyToFile(req, tempPath, 2 * 1024 * 1024 * 1024);
      const result = await saveManualVideo(projectId, episodeId, shotNo, tempPath);
      // A manual replacement owns this shot; prevent a late cloud result from
      // overwriting it after the validated upload succeeds.
      cancelDreaminaAgentQueuedShot(projectId, episodeId, shotNo);
      clearPendingByShot(projectId, episodeId, shotNo);
      sendJson(res, 200, { ok: true, videoUrl: result.videoUrl });
    } catch (e) {
      sendJson(res, 400, { error: e.message || '视频上传失败' });
    } finally {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
    }
    return true;
  }

  // ---- 每镜的参考视频：直接把一段视频当"视频参考"喂给支持它的模型（即梦 / Seedance / LibTV 等）----
  // 记录挂在 shotMeta[镜头号] 上，所以插入/删除镜头时会跟着镜头一起平移；磁盘文件名不带镜号。
  if (p === '/api/video/shot-ref-video' && method === 'POST') {
    const projectId = String(url.searchParams.get('projectId') || '').trim();
    const episodeId = String(url.searchParams.get('episodeId') || '').trim();
    const shotNo = String(url.searchParams.get('shotNo') || '').trim();
    const name = String(url.searchParams.get('name') || '参考视频').trim().slice(0, 120) || '参考视频';
    if (!projectId || !episodeId || !shotNo) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo' });
      return true;
    }
    const project = loadProject(projectId);
    if (!project) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    normalizeProjectScript(project);
    const storyboard = (project.script.storyboards || []).find((item) => String(item.episodeId) === episodeId);
    if (!storyboard) {
      sendJson(res, 404, { error: `第 ${episodeId} 集还没有分镜` });
      return true;
    }
    const tempPath = path.join(os.tmpdir(), `freedom-shotref-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.upload`);
    try {
      await saveRequestBodyToFile(req, tempPath, 2 * 1024 * 1024 * 1024);
      const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const target = shotRefVideoDiskPath(projectId, episodeId, token);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(tempPath, target);
      const durationSec = await getVideoDuration(target);
      const durationSeconds = durationSec ? Math.round(durationSec * 10) / 10 : 0;
      if (!storyboard.shotMeta || typeof storyboard.shotMeta !== 'object') storyboard.shotMeta = {};
      const previous = storyboard.shotMeta[shotNo] && typeof storyboard.shotMeta[shotNo] === 'object' ? storyboard.shotMeta[shotNo] : {};
      // 换参考视频时把上一份删掉，避免磁盘留垃圾
      const previousPath = String(previous.refVideoPath || '').trim();
      storyboard.shotMeta[shotNo] = {
        ...previous,
        refVideoPath: target,
        refVideoName: name,
        refVideoDuration: durationSeconds,
        refVideoUpdatedAt: new Date().toISOString(),
      };
      saveProject(project);
      if (previousPath && previousPath !== target) {
        try { fs.rmSync(previousPath, { force: true }); } catch { /* best effort */ }
      }
      sendJson(res, 200, { ok: true, refVideo: { path: target, name, durationSeconds } });
    } catch (e) {
      sendJson(res, 400, { error: e.message || '参考视频导入失败' });
    } finally {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
    }
    return true;
  }

  if (p === '/api/video/shot-ref-video/remove' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    const episodeId = String(body.episodeId || '').trim();
    const shotNo = String(body.shotNo || '').trim();
    if (!projectId || !episodeId || !shotNo) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo' });
      return true;
    }
    const project = loadProject(projectId);
    if (!project) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    normalizeProjectScript(project);
    const storyboard = (project.script.storyboards || []).find((item) => String(item.episodeId) === episodeId);
    if (storyboard?.shotMeta?.[shotNo]) {
      const meta = { ...storyboard.shotMeta[shotNo] };
      const refPath = String(meta.refVideoPath || '').trim();
      delete meta.refVideoPath;
      delete meta.refVideoName;
      delete meta.refVideoDuration;
      delete meta.refVideoUpdatedAt;
      storyboard.shotMeta[shotNo] = meta;
      saveProject(project);
      if (refPath) {
        try { fs.rmSync(refPath, { force: true }); } catch { /* best effort */ }
      }
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ---- 片头：项目级共用的开场片段，data/<projectId>/intro/intro.mp4 ----
  // 刻意不进 storyboard.content：content 会被插入/删除/重排整体重写成「分镜N：」，
  // 片头一旦写进去就会被当垃圾文本删掉。存在项目根的 introClip 里最稳。
  if (p === '/api/video/intro/import' && method === 'POST') {
    const projectId = String(url.searchParams.get('projectId') || '').trim();
    if (!projectId) {
      sendJson(res, 400, { error: '缺少 projectId' });
      return true;
    }
    const project = loadProject(projectId);
    if (!project) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    const tempPath = path.join(os.tmpdir(), `freedom-intro-upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.upload`);
    try {
      await saveRequestBodyToFile(req, tempPath, 2 * 1024 * 1024 * 1024);
      const target = introDiskPath(projectId);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(tempPath, target);
      // 片头也会在应用内用 <video> 预览，所以同样统一成可播编码（HEVC → H.264）。
      await ensurePlayableCodec(target);
      const durationSec = await getVideoDuration(target);
      const introClip = {
        url: introLocalUrl(projectId),
        name: String(url.searchParams.get('name') || '片头').trim().slice(0, 120) || '片头',
        durationSeconds: durationSec ? Math.round(durationSec * 10) / 10 : 0,
        enabled: true,
        updatedAt: new Date().toISOString(),
      };
      project.introClip = introClip;
      saveProject(project);
      sendJson(res, 200, { ok: true, introClip });
    } catch (e) {
      sendJson(res, 400, { error: e.message || '片头导入失败' });
    } finally {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
    }
    return true;
  }

  if (p === '/api/video/intro/update' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    if (!projectId) {
      sendJson(res, 400, { error: '缺少 projectId' });
      return true;
    }
    const project = loadProject(projectId);
    if (!project) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    if (!project.introClip) {
      sendJson(res, 404, { error: '还没有片头' });
      return true;
    }
    project.introClip.enabled = body.enabled !== false;
    project.introClip.updatedAt = new Date().toISOString();
    saveProject(project);
    sendJson(res, 200, { ok: true, introClip: project.introClip });
    return true;
  }

  if (p === '/api/video/intro/remove' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    if (!projectId) {
      sendJson(res, 400, { error: '缺少 projectId' });
      return true;
    }
    const project = loadProject(projectId);
    if (!project) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    try { fs.rmSync(introDiskPath(projectId), { force: true }); } catch { /* best effort */ }
    delete project.introClip;
    saveProject(project);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ---- 截取视频尾帧 ----
  if (p === '/api/video/extract-tail-frame' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, episodeId, shotNo, targetShotNo, frameName } = body;
    if (!projectId || episodeId == null || shotNo == null) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo' });
      return true;
    }
    try {
      await extractTailFrame(projectId, episodeId, shotNo);
      const url = tailFrameLocalUrl(projectId, episodeId, shotNo);
      if (targetShotNo != null && !persistShotOpenerFrame(projectId, episodeId, targetShotNo, shotNo, url, frameName)) {
        throw new Error('尾帧已截取，但目标分镜不存在，无法保存衔接关系');
      }
      sendJson(res, 200, { ok: true, url });
      return true;
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // ---- 手动上传尾帧 ----
  if (p === '/api/video/manual-tail-frame' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, episodeId, shotNo, imageDataUrl } = body;
    if (!projectId || episodeId == null || shotNo == null || !imageDataUrl) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo/imageDataUrl' });
      return true;
    }
    if (!loadProject(projectId)) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    try {
      await saveManualTailFrame(projectId, episodeId, shotNo, imageDataUrl);
      sendJson(res, 200, { ok: true, url: tailFrameLocalUrl(projectId, episodeId, shotNo) });
      return true;
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // ---- 移动视频文件编号 ----
  if (p === '/api/video/shot-files/shift' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, episodeId } = body;
    if (!projectId || episodeId == null) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId' });
      return true;
    }
    const proj = loadProject(projectId);
    if (!proj) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    try {
      const result = shiftVideoFiles(projectId, episodeId, {
        fromNo: Number(body.fromNo),
        delta: Number(body.delta),
        removeNo: body.removeNo == null ? null : Number(body.removeNo),
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    } catch (e) {
      sendJson(res, 200, { ok: false, error: e.message });
      return true;
    }
  }

  // ---- 可视化时间线排序后重映射已生成文件 ----
  if (p === '/api/video/shot-files/remap' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, episodeId } = body;
    if (!projectId || episodeId == null) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId' });
      return true;
    }
    if (!loadProject(projectId)) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    try {
      const result = remapShotFiles(projectId, episodeId, {
        mapping: body.mapping,
        removeUnmapped: body.removeUnmapped !== false,
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    } catch (e) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // ---- 视频生成提交（单镜或批量） ----
  if (p === '/api/video/submit' && method === 'POST') {
    const body = await readBody(req);
    if (!submitBatchHandler) {
      sendJson(res, 500, { error: 'Video submit handler not initialized' });
      return true;
    }
    try {
      const result = await submitBatchHandler(body, ctx);
      sendJson(res, 200, result);
      return true;
    } catch (e) {
      sendJson(res, e.status || 400, { error: e.message });
      return true;
    }
  }

  // ---- 查询提交任务进度 ----
  if (p === '/api/video/status' && method === 'GET') {
    const jobId = url.searchParams.get('jobId');
    const initial = getJob(jobId);
    const st = initial?.provider === 'dreamina-agent'
      ? reconcileDreaminaAgentQueueJob(jobId, initial)
      : initial;
    if (!st) {
      sendJson(res, 404, { error: '任务不存在' });
      return true;
    }
    sendJson(res, 200, st);
    return true;
  }

  // ---- 列出最近任务 ----
  if (p === '/api/video/jobs' && method === 'GET') {
    sendJson(res, 200, { ok: true, jobs: listJobs().slice(-50) });
    return true;
  }

  // ---- 拉取待办视频结果 ----
  if (p === '/api/video/poll' && method === 'POST') {
    const body = await readBody(req);
    if (!pollPendingVideosHandler) {
      sendJson(res, 500, { error: 'Poll handler not initialized' });
      return true;
    }
    try {
      let targetTask = body.projectId && body.episodeId != null && body.shotNo != null
        ? listPending().find((task) => (
            task.projectId === body.projectId
            && String(task.episodeId) === String(body.episodeId)
            && String(task.shotNo) === String(body.shotNo)
          ))
        : null;
      if (body.retry && body.projectId && body.episodeId != null && body.shotNo != null) {
        retryPendingByShot(body.projectId, body.episodeId, body.shotNo);
        const recoveryProvider = targetTask?.provider || storedShotVideoProvider(body.projectId, body.episodeId, body.shotNo);
        if (!targetTask && recoveryProvider === 'libtv-cli' && recoverLibtvPendingShotHandler) {
          await recoverLibtvPendingShotHandler({
            projectId: body.projectId,
            episodeId: body.episodeId,
            shotNo: body.shotNo,
          });
          targetTask = listPending().find((task) => (
            task.projectId === body.projectId
            && String(task.episodeId) === String(body.episodeId)
            && String(task.shotNo) === String(body.shotNo)
          )) || null;
        } else if ((!targetTask || (targetTask.provider === 'neowow' && targetTask.status === 'failed')) && recoveryProvider === 'neowow' && recoverNeowowPendingShotHandler) {
          await recoverNeowowPendingShotHandler({
            projectId: body.projectId,
            episodeId: body.episodeId,
            shotNo: body.shotNo,
            accountId: targetTask?.accountId || '',
            replaceExisting: targetTask?.provider === 'neowow' && targetTask?.status === 'failed',
          });
          targetTask = listPending().find((task) => (
            task.projectId === body.projectId
            && String(task.episodeId) === String(body.episodeId)
            && String(task.shotNo) === String(body.shotNo)
          )) || null;
        }
      }
      const hasUpdreamPending = targetTask?.provider === 'updream' || listUnfinished().some((task) => (
        task.provider === 'updream'
        && (!body.projectId || task.projectId === body.projectId)
      ));
      const statuses = hasUpdreamPending && pollPendingUpdreamVideosHandler
        ? await pollPendingUpdreamVideosHandler(body.projectId || null, targetTask?.provider === 'updream'
          ? { episodeId: body.episodeId, shotNo: body.shotNo }
          : {})
        : await pollPendingVideosHandler(body.projectId || null);
      const queuedSubmissions = listPending().filter((task) => (
        ['dreamina-agent', 'updream', 'neowow', 'comfyui'].includes(task.provider)
        && task.status === 'submitting'
        && (!body.projectId || task.projectId === body.projectId)
      )).length;
      const pending = (body.projectId
        ? listUnfinished().filter((t) => t.projectId === body.projectId).length
        : listUnfinished().length) + queuedSubmissions;
      sendJson(res, 200, { ok: true, statuses, pending });
      return true;
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // ---- 列出待办视频 ----
  if (p === '/api/video/pending' && method === 'GET') {
    // 前端 hydrate/轮询都会走这里：顺手清掉「已完成且视频已落盘」的僵尸记录，
    // 否则 hydrate 会把 done 当成 queued，把镜头 pill 复活成「已提交 100%」。
    pruneCompletedVideoPendingRecords();
    const filterProject = url.searchParams.get('projectId');
    const list = listPending().filter((t) => !filterProject || t.projectId === filterProject);
    // 上游 QUEUED 阶段的 progress 是固定标记值而不是真实进度，不外发，
    // 让前端继续走估算曲线（与 /api/video/poll 的上报口径保持一致）。
    const upstreamStillQueued = (t) => t.upstreamStatus === 'QUEUED' || t.upstreamStatus === 'NOT_START';
    sendJson(res, 200, {
      pending: list.map((t) => ({
        projectId: t.projectId,
        episodeId: t.episodeId,
        shotNo: t.shotNo,
        provider: t.provider,
        accountId: t.accountId || '',
        status: t.status,
        note: t.lastError || '',
        error: t.status === 'failed' ? (t.lastError || '视频生成失败') : '',
        progress: upstreamStillQueued(t) ? undefined : t.progress,
        progressSource: upstreamStillQueued(t) ? undefined : t.progressSource,
        progressUpdatedAt: t.progressUpdatedAt,
        upstreamStatus: t.upstreamStatus || '',
        upstreamModel: t.upstreamModel || '',
        upstreamQuota: t.upstreamQuota,
        upstreamCostUsd: upstreamCostUsd(t) || undefined,
        upstreamElapsedMs: upstreamElapsedMs(t) || undefined,
        canCancel: t.canCancel === true,
        queueState: t.queueState || '',
        createdAt: t.createdAt,
        submittedAt: t.createdAt
      }))
    });
    return true;
  }

  // ---- 一键成片导出：把项目已完成的分镜视频复制到 本地下载目录/Freedom成片/<项目名>/ ----
  if (p === '/api/video/export-shots' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    if (!projectId) {
      sendJson(res, 400, { error: '缺少 projectId' });
      return true;
    }
    const proj = loadProject(projectId);
    if (!proj) {
      sendJson(res, 404, { error: '项目不存在' });
      return true;
    }
    const episodeFilter = body.episodeId != null && body.episodeId !== '' ? String(body.episodeId) : '';
    // 集数范围导出：fromEpisodeId / toEpisodeId 任填一个即为范围（只填起点=从该集到最后一集）。
    const fromEpisode = Number(body.fromEpisodeId);
    const toEpisode = Number(body.toEpisodeId);
    const hasRange = Number.isFinite(fromEpisode) || Number.isFinite(toEpisode);
    const inEpisodeFilter = (episodeId) => {
      if (episodeFilter) return String(episodeId) === episodeFilter;
      if (!hasRange) return true;
      const n = Number(episodeId);
      if (!Number.isFinite(n)) return false;
      if (Number.isFinite(fromEpisode) && n < fromEpisode) return false;
      if (Number.isFinite(toEpisode) && n > toEpisode) return false;
      return true;
    };
    const videosRoot = path.join(projectDir(projectId), 'videos');
    const safeName = String(proj.name || projectId).replace(/[\\/:*?"<>|]/g, '_').trim() || projectId;
    const destDir = path.join(os.homedir(), 'Downloads', 'Freedom成片', safeName);
    const files = [];
    try {
      const entries = fs.existsSync(videosRoot) ? fs.readdirSync(videosRoot, { withFileTypes: true }) : [];
      const episodeFiles = new Map();
      const ensureEpisodeFiles = (episodeId) => {
        const key = String(episodeId);
        if (!episodeFiles.has(key)) episodeFiles.set(key, []);
        return episodeFiles.get(key);
      };
      for (const ent of entries) {
        if (ent.isDirectory()) {
          let epFiles = [];
          try { epFiles = fs.readdirSync(path.join(videosRoot, ent.name)); } catch { epFiles = []; }
          ensureEpisodeFiles(ent.name).push(...epFiles);
          continue;
        }
        if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.mp4')) continue;
        // 兼容旧格式 videos/<episodeId>_<shotNo>[.version-*].mp4。
        const match = ent.name.match(/^(\d+)_(.+\.mp4)$/i);
        if (match) ensureEpisodeFiles(match[1]).push(match[2]);
      }
      const episodeIds = [...episodeFiles.keys()].sort((a, b) => {
        const an = Number(a);
        const bn = Number(b);
        return Number.isFinite(an) && Number.isFinite(bn) ? an - bn : a.localeCompare(b);
      });
      const exportedEpisodes = new Set();
      for (const episodeId of episodeIds) {
        if (!inEpisodeFilter(episodeId)) continue;
        for (const { shotNo } of selectActiveVideoFiles(episodeFiles.get(episodeId))) {
          // 由统一的播放路径选择器决定版本：版本文件优先、目录格式优先于旧根目录格式。
          const sourcePath = videoDiskPath(projectId, episodeId, shotNo);
          if (!videoFileEntryExists(sourcePath)) continue;
          const destName = `第${episodeId}集_镜头${shotNo}.mp4`;
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(sourcePath, path.join(destDir, destName));
          files.push(destName);
          exportedEpisodes.add(episodeId);
        }
      }
      // 片头是项目级的，整个导出只放一份，不按集重复。
      const intro = await introClipExportInfo(projectId);
      if (intro) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(intro.path, path.join(destDir, '片头.mp4'));
        files.push('片头.mp4');
      }
      if (!files.length) {
        sendJson(res, 200, { ok: false, error: hasRange || episodeFilter ? '所选集数里还没有已完成的分镜视频' : '还没有已完成的分镜视频可导出', dir: destDir, count: 0, files: [] });
        return true;
      }
      sendJson(res, 200, { ok: true, dir: destDir, count: files.length, files, episodes: [...exportedEpisodes] });
    } catch (error) {
      sendJson(res, 500, { error: error?.message || '导出失败' });
    }
    return true;
  }
  // 上游真实状态同步：把本地 pending 状态刷新成上游任务的真实状态（轻量，不下载视频）
  if (p === '/api/video/sync-upstream-status' && method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await syncUpstreamStatusFromRemote({ projectId: body.projectId });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.message || '同步失败' });
    }
    return true;
  }

  // 上游视频对账找回：扫描 rolldek 任务列表，把「本地无视频但上游成功」的镜头下载落盘
  if (p === '/api/video/reconcile-upstream' && method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await reconcileVideosFromUpstream({
        projectId: body.projectId,
        startTimestamp: body.startTimestamp,
        endTimestamp: body.endTimestamp,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.message || '对账失败' });
    }
    return true;
  }


  // 飞拓跨界消费账本拉取（网页会话 Cookie 鉴权）：账单对账用，先返回原始结构供字段确认
  if (p === '/api/video/feituo-ledger' && method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await fetchFeituoVideoLedger({
        startTimestamp: body.startTimestamp,
        endTimestamp: body.endTimestamp,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.message || '飞拓账本拉取失败' });
    }
    return true;
  }

  // ---- 打开成片导出目录（只允许打开 Downloads/Freedom成片 下的路径） ----
  if (p === '/api/video/open-export-folder' && method === 'POST') {
    const body = await readBody(req);
    const requested = String(body.dir || '').trim();
    const allowedRoot = path.join(os.homedir(), 'Downloads', 'Freedom成片');
    const resolved = path.resolve(requested);
    if (!resolved.startsWith(allowedRoot)) {
      sendJson(res, 400, { error: '只允许打开成片导出目录' });
      return true;
    }
    if (!fs.existsSync(resolved)) {
      sendJson(res, 404, { error: '目录不存在（可能还没有导出过成片）' });
      return true;
    }
    try {
      exec(`explorer "${resolved}"`);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: error?.message || '打开文件夹失败' });
    }
    return true;
  }

  // ---- 获取视频历史记录列表 ----
  if (p === '/api/video/history/list' && method === 'GET') {
    const projectId = url.searchParams.get('projectId');
    const episodeId = url.searchParams.get('episodeId');
    const shotNo = url.searchParams.get('shotNo');

    if (!projectId || episodeId == null || shotNo == null) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo' });
      return true;
    }

    try {
      await compactShotVideoHistory(projectId, episodeId, shotNo);
      const versions = listShotVideoHistory(projectId, episodeId, shotNo).map(({ path: _path, ...version }) => ({
        ...version,
        videoUrl: `/video-history/${encodeURIComponent(projectId)}/${encodeURIComponent(String(episodeId))}/${encodeURIComponent(String(shotNo))}/${version.timestamp}.mp4?t=${version.timestamp}`,
      }));
      const stats = getHistoryStats(projectId, episodeId, shotNo);
      sendJson(res, 200, { ok: true, versions, stats });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  // ---- 恢复历史版本 ----
  if (p === '/api/video/history/restore' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, episodeId, shotNo, timestamp } = body;

    if (!projectId || episodeId == null || shotNo == null || !timestamp) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo/timestamp' });
      return true;
    }

    try {
      const result = await restoreVideoFromHistory(projectId, episodeId, shotNo, parseInt(timestamp, 10));
      const videoUrl = `/video/${encodeURIComponent(projectId)}/${encodeURIComponent(String(episodeId))}/${encodeURIComponent(String(shotNo))}.mp4?t=${Date.now()}`;

      // 更新项目中的视频URL
      const project = loadProject(projectId);
      if (project) {
        normalizeProjectScript(project);
        const storyboard = project.script?.storyboards?.find((sb) => String(sb.episodeId) === String(episodeId));
        if (storyboard) {
          if (!storyboard.shotVideos) storyboard.shotVideos = {};
          storyboard.shotVideos[String(shotNo)] = {
            videoUrl,
            provider: 'history-restore',
            updatedAt: new Date().toISOString(),
          };
          project.updatedAt = new Date().toISOString();
          saveProject(project);
        }
      }

      sendJson(res, 200, { ok: true, ...result, videoUrl });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  // ---- 删除历史版本 ----
  if (p === '/api/video/history/delete' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, episodeId, shotNo, timestamp } = body;

    if (!projectId || episodeId == null || shotNo == null || !timestamp) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo/timestamp' });
      return true;
    }

    try {
      await deleteHistoryVersion(projectId, episodeId, shotNo, parseInt(timestamp, 10));
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  // ---- 清空分镜所有历史记录 ----
  if (p === '/api/video/history/clear' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, episodeId, shotNo } = body;

    if (!projectId || episodeId == null || shotNo == null) {
      sendJson(res, 400, { error: '缺少 projectId/episodeId/shotNo' });
      return true;
    }

    try {
      const result = await clearShotVideoHistory(projectId, episodeId, shotNo);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  return false;
}
