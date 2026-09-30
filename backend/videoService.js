import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

import {
  DATA_DIR,
  ffmpegPath,
  loadConfig,
  normalizeDreaminaAgentShotIntervalSeconds,
  saveConfig,
  TEMP_DIR,
} from './config.js';
import { getJob, listJobs, setJob } from './jobs.js';
import { writeImagesWithNameLabels } from './imageLabeler.js';
import {
  addPending,
  findUnfinishedByShot,
  isCurrentPendingTask,
  isPendingTrackingStopped,
  listPending,
  listUnfinished,
  removePending,
  resumePendingTrackingByShot,
  unfinishedByAccount,
  updatePending,
} from './pendingVideos.js';
import {
  characterVoiceReadDiskPath,
  ensureLabeledImage,
  imageDiskPath,
  labeledDiskPath,
  loadProject,
  listProjects,
  normalizeProjectScript,
  projectDir,
  sanitizeFilename,
  saveProject,
} from './storage.js';
import {
  acquireAccount as acquireXiaoyunqueAccount,
  findAccountById as findXiaoyunqueAccountById,
  markAccountStatus as markXiaoyunqueAccountStatus,
  releaseAccount as releaseXiaoyunqueAccount,
} from './xiaoyunqueAccounts.js';
import {
  fetchVideoResults as fetchXiaoyunqueVideoResults,
  submitVideos as submitXiaoyunqueVideos,
} from './xiaoyunqueClient.js';
import {
  fetchVideoResults as fetchDreaminaVideoResults,
  listTasks as listDreaminaTasks,
  localAccountId as dreaminaLocalAccountId,
  submitVideos as submitDreaminaVideos,
} from './dreaminaClient.js';
import {
  confirmVideoSubmission as confirmDreaminaAgentVideoSubmission,
  fetchVideoResults as fetchDreaminaAgentVideoResults,
  normalizeDreaminaAgentPromptPreset,
  renameDreaminaAgentCanvasProject,
  submitVideos as submitDreaminaAgentVideos,
} from './dreaminaAgentClient.js';
import {
  requireDreaminaAgentAccount,
  selectedDreaminaAgentAccountId,
} from './dreaminaAgentAccounts.js';
import {
  fetchVideoResult as fetchLibtvVideoResult,
  findLatestLibtvVideoNode,
  submitVideos as submitLibtvVideos,
} from './libtvClient.js';
import {
  fetchVideoResults as fetchVideoApiResults,
  submitVideos as submitVideoApiVideos,
} from './videoApiClient.js';
import {
  fetchVideoResults as fetchUpdreamVideoResults,
  submitVideos as submitUpdreamVideos,
} from './updreamClient.js';
import {
  fetchVideoResults as fetchNeowowVideoResults,
  recoverVideoTask as recoverNeowowVideoTask,
  submitVideos as submitNeowowVideos,
} from './neowowClient.js';
import {
  comfyUiHistoryStatus,
  comfyUiResultVideoUrls,
  comfyUiWorkflowPreset,
  getComfyUiHistory,
  getComfyUiObjectInfo,
  loadComfyUiWorkflow,
  normalizeComfyUiBaseUrl,
  submitComfyUiPrompt,
} from './comfyuiClient.js';
import {
  findNeowowAccount,
  markNeowowAccountStatus,
  neowowConfigForAccount,
  refreshNeowowAccount,
  requireNeowowAccount,
  selectedNeowowAccountId,
  usableNeowowAccounts,
} from './neowowAccounts.js';
import {
  cleanupSupersededVideoFiles,
  episodeKeyForPath,
  nextVideoWritePath,
  videoDiskPath,
  videoExists,
} from './videoFunctions.js';
import { saveBestVideoSourceToFile } from './videoQuality.js';
import { ensurePlayableCodec } from './videoTranscode.js';
import { archiveCurrentVideoToHistory } from './videoHistory.js';
import { isVideoProvider, normalizeVideoProvider } from './videoProviders.js';
import {
  findActiveComfyUiTaskForShot,
  findActiveNeowowTaskForShot,
  findActiveUpdreamTaskForShot,
  isComfyUiActiveTask,
  isComfyUiWaitingTask,
  isNeowowActiveTask,
  isNeowowWaitingTask,
  isUpdreamActiveTask,
  isUpdreamWaitingTask,
  mapUpdreamWithConcurrency,
  planComfyUiQueue,
  planUpdreamQueue,
} from './updreamVideoQueue.js';
import { recordUsage } from './services/costLedgerService.js';
import { resolveVideoApiChannel } from './channelProfiles.js';
import {
  parseStoryboardShotsForRecovery,
  reconcileShotVideos,
  videoLocalUrl,
} from './shotVideoUtils.js';
import { writeJsonAtomic } from './lib/atomicJson.js';
import { acquireProcessFileLock } from './processFileLock.js';

const execFileAsync = promisify(execFile);
const VIDEO_API_LOG_PATH = path.join(DATA_DIR, '.logs', 'video-api.log');
const VIDEO_API_IDEMPOTENCY_STORE_PATH = path.join(DATA_DIR, 'video-api-idempotency.json');

// 视频 API 幂等键持久化：同一镜头在「提交超时/失败 → 重新生成」时复用同一 key，
// 网关按 key 幂等去重，可找回已在远端创建/完成的任务，避免孤儿任务与重复计费。
// 提交成功后清除，之后的重新生成会拿新 key、走真正的全新生成。
function loadVideoApiIdempotencyStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(VIDEO_API_IDEMPOTENCY_STORE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function saveVideoApiIdempotencyStore(store) {
  try {
    fs.mkdirSync(path.dirname(VIDEO_API_IDEMPOTENCY_STORE_PATH), { recursive: true });
    writeJsonAtomic(VIDEO_API_IDEMPOTENCY_STORE_PATH, store);
  } catch { /* best effort */ }
}

function videoApiIdempotencyKeyFor(store, projectId, episodeId, shotNo) {
  const slot = `${projectId}:${episodeId}:${shotNo}`;
  if (!store[slot] || !store[slot].key) {
    store[slot] = { key: `yanzhi-${randomUUID()}`, createdAt: new Date().toISOString() };
  }
  return store[slot].key;
}

const DREAMINA_AGENT_CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const DREAMINA_AGENT_CHINESE_UNITS = ['', '十', '百', '千', '万', '十万', '百万', '千万', '亿'];

export function formatDreaminaAgentEpisodeNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return '';
  const digits = String(number);
  if (digits.length > DREAMINA_AGENT_CHINESE_UNITS.length) return digits;

  let output = '';
  let pendingZero = false;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const unitIndex = digits.length - index - 1;
    if (digit === 0) {
      if (output && /[1-9]/.test(digits.slice(index + 1))) pendingZero = true;
      continue;
    }
    if (pendingZero) output += DREAMINA_AGENT_CHINESE_DIGITS[0];
    output += `${DREAMINA_AGENT_CHINESE_DIGITS[digit]}${DREAMINA_AGENT_CHINESE_UNITS[unitIndex]}`;
    pendingZero = false;
  }
  return output.replace(/^一十/, '十');
}

export function formatDreaminaAgentCanvasProjectName(projectName, episodeId, episodeIndex = 0) {
  const normalizedProjectName = String(projectName || '').trim() || '未命名项目';
  const episodeMatch = String(episodeId ?? '').trim().match(/^(?:第)?(\d+)(?:集)?$/);
  const ordinal = Number(episodeMatch?.[1]) || Number(episodeIndex) || 1;
  const formattedOrdinal = formatDreaminaAgentEpisodeNumber(ordinal) || String(ordinal);
  return `${normalizedProjectName}第${formattedOrdinal}集`;
}

function dreaminaAgentCanvasProjectName(projectId, episodeId) {
  const project = loadProject(projectId);
  const episodes = Array.isArray(project?.script?.episodes) ? project.script.episodes : [];
  const episodeIndex = episodes.findIndex((episode) => String(episode?.id) === String(episodeId));
  return formatDreaminaAgentCanvasProjectName(
    project?.name || project?.title || projectId,
    episodeId,
    episodeIndex >= 0 ? episodeIndex + 1 : 0,
  );
}

function dreaminaAgentBindingPath(projectId) {
  return path.join(projectDir(projectId), '.dreamina-agent.json');
}

export function dreaminaAgentSessionAccountKey(value) {
  const sessionId = String(value || '').trim();
  if (!sessionId) return '';
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 24);
}

export function dreaminaAgentBindingForSession(episode = {}, sessionId = '') {
  const accountKey = dreaminaAgentSessionAccountKey(sessionId);
  if (!accountKey || episode.accountKey === accountKey) return { ...episode };
  return {
    ...episode,
    accountKey,
    canvasProjectId: '',
    lastSubmittedAt: 0,
  };
}

export function dreaminaAgentBindingForAccount(episode = {}, accountId = '', sessionId = '') {
  const normalizedAccountId = String(accountId || '').trim();
  const bindings = episode.accountBindings && typeof episode.accountBindings === 'object'
    ? episode.accountBindings
    : {};
  const binding = bindings[normalizedAccountId] || {};
  const accountKey = dreaminaAgentSessionAccountKey(sessionId);
  const bindingAccountKey = String(binding.accountKey || '').trim();
  const belongsToCurrentSession = !accountKey || bindingAccountKey === accountKey;
  return {
    accountId: normalizedAccountId,
    accountKey,
    canvasProjectId: belongsToCurrentSession ? String(binding.canvasProjectId || '').trim() : '',
    lastSubmittedAt: belongsToCurrentSession ? (Number(binding.lastSubmittedAt) || 0) : 0,
  };
}

function normalizeDreaminaAgentState(value = {}) {
  const state = value && typeof value === 'object' ? value : {};
  const episodes = state.episodes && typeof state.episodes === 'object' ? state.episodes : {};
  const selectedAccountId = selectedDreaminaAgentAccountId();
  const migrateLegacyBinding = Number(state.version) < 4;
  for (const [episodeId, rawEpisode] of Object.entries(episodes)) {
    const episode = rawEpisode && typeof rawEpisode === 'object' ? rawEpisode : {};
    episode.accountKey = String(episode.accountKey || '').trim();
    episode.canvasProjectId = String(episode.canvasProjectId || '').trim();
    episode.lastSubmittedAt = Number(episode.lastSubmittedAt) || 0;
    episode.accountBindings = episode.accountBindings && typeof episode.accountBindings === 'object'
      ? episode.accountBindings
      : {};
    if (migrateLegacyBinding && episode.canvasProjectId && selectedAccountId && !episode.accountBindings[selectedAccountId]) {
      episode.accountBindings[selectedAccountId] = {
        accountKey: episode.accountKey,
        canvasProjectId: episode.canvasProjectId,
        lastSubmittedAt: episode.lastSubmittedAt,
      };
    }
    for (const [accountId, rawBinding] of Object.entries(episode.accountBindings)) {
      const binding = rawBinding && typeof rawBinding === 'object' ? rawBinding : {};
      episode.accountBindings[accountId] = {
        accountKey: String(binding.accountKey || '').trim(),
        canvasProjectId: String(binding.canvasProjectId || '').trim(),
        lastSubmittedAt: Number(binding.lastSubmittedAt) || 0,
      };
    }
    episode.queue = (Array.isArray(episode.queue) ? episode.queue : [])
      .filter((item) => item?.id && item?.task)
      .map((item) => ({
        ...item,
        accountId: String(item.accountId || item.task?.accountId || selectedAccountId).trim(),
      }));
    episode.failures = episode.failures && typeof episode.failures === 'object' ? episode.failures : {};
    episodes[episodeId] = episode;
  }
  return { ...state, version: 4, episodes };
}

function loadDreaminaAgentState(projectId) {
  try {
    return normalizeDreaminaAgentState(JSON.parse(fs.readFileSync(dreaminaAgentBindingPath(projectId), 'utf8')));
  } catch {
    return normalizeDreaminaAgentState();
  }
}

function saveDreaminaAgentState(projectId, state) {
  const data = normalizeDreaminaAgentState(state);
  data.updatedAt = new Date().toISOString();
  writeJsonAtomic(dreaminaAgentBindingPath(projectId), data);
  return data;
}

function mutateDreaminaAgentEpisode(projectId, episodeId, mutator) {
  const data = loadDreaminaAgentState(projectId);
  const key = String(episodeId);
  const episode = data.episodes[key] || {
    accountKey: '',
    canvasProjectId: '',
    lastSubmittedAt: 0,
    accountBindings: {},
    queue: [],
    failures: {},
  };
  data.episodes[key] = episode;
  const result = mutator(episode, data);
  episode.updatedAt = new Date().toISOString();
  saveDreaminaAgentState(projectId, data);
  return result;
}

function loadDreaminaAgentBinding(projectId, episodeId, accountId) {
  const episode = loadDreaminaAgentState(projectId).episodes[String(episodeId)] || {};
  const account = requireDreaminaAgentAccount(accountId);
  return dreaminaAgentBindingForAccount(episode, account.id, account.sessionId);
}

function saveDreaminaAgentBinding(projectId, episodeId, accountId, binding = {}) {
  const account = requireDreaminaAgentAccount(accountId);
  mutateDreaminaAgentEpisode(projectId, episodeId, (episode) => {
    const normalizedAccountId = account.id;
    if (!episode.accountBindings || typeof episode.accountBindings !== 'object') episode.accountBindings = {};
    const current = episode.accountBindings[normalizedAccountId] || {};
    episode.accountBindings[normalizedAccountId] = {
      accountKey: dreaminaAgentSessionAccountKey(account.sessionId),
      canvasProjectId: String(binding.canvasProjectId || current.canvasProjectId || '').trim(),
      lastSubmittedAt: Math.max(Number(binding.lastSubmittedAt) || 0, Number(current.lastSubmittedAt) || 0),
    };
  });
}

function persistUpdreamTokens({ accessToken, refreshToken } = {}) {
  const current = loadConfig();
  saveConfig({
    video: {
      ...current.video,
      updreamAccessToken: String(accessToken || current.video?.updreamAccessToken || '').trim(),
      updreamRefreshToken: String(refreshToken || current.video?.updreamRefreshToken || '').trim(),
    },
  });
}

function recordVideoSubmission({
  cfg,
  projectId,
  episodeId,
  provider,
  model,
  task,
  fallbackDuration,
  status = 'success',
  error = '',
}) {
  const duration = Number(task?.duration || fallbackDuration || cfg?.video?.duration) || 15;
  const pricePerSecond = Math.max(0, Number(cfg?.video?.pricePerSecond) || 0);
  const succeeded = status === 'success';
  recordUsage({
    kind: 'video',
    task: 'video',
    operation: 'submit',
    projectId,
    episodeId,
    provider,
    model: model || '',
    units: succeeded ? 1 : 0,
    seconds: succeeded ? duration : 0,
    cost: succeeded ? duration * pricePerSecond : 0,
    currency: cfg?.costTracking?.currency || 'CNY',
    estimated: succeeded && pricePerSecond > 0,
    status,
    error: error ? String(error) : '',
  });
}

function appendVideoApiLog(entry = {}) {
  try {
    fs.mkdirSync(path.dirname(VIDEO_API_LOG_PATH), { recursive: true });
    const clean = JSON.parse(JSON.stringify(entry, (key, value) => {
      if (/key|authorization|token|secret/i.test(key)) return value ? '[REDACTED]' : value;
      if (typeof value === 'string' && value.length > 600) return `${value.slice(0, 600)}...`;
      return value;
    }));
    fs.appendFileSync(VIDEO_API_LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...clean })}\n`, 'utf-8');
  } catch {
    // ignore logging errors
  }
}

function persistShotVideo(projectId, episodeId, shotNo, videoUrl) {
  try {
    const proj = loadProject(projectId);
    if (!proj) return false;
    normalizeProjectScript(proj);
    const ep = proj.script.episodes.find((item) => String(item.id) === String(episodeId));
    if (!ep) {
      // A cloud task can finish after its episode was deleted; do not recreate orphan data.
      try { fs.rmSync(videoDiskPath(projectId, episodeId, shotNo), { force: true }); } catch { /* best effort */ }
      return false;
    }
    let sb = proj.script.storyboards.find((item) => String(item.episodeId) === String(episodeId));
    if (!sb) {
      sb = { episodeId, episodeTitle: ep.title || `第${episodeId}集`, content: '', mode: 'normal', manualTags: {}, shotVideos: {} };
      proj.script.storyboards.push(sb);
    }
    if (!sb.shotVideos || typeof sb.shotVideos !== 'object') sb.shotVideos = {};
    sb.shotVideos[String(shotNo)] = { videoUrl, updatedAt: new Date().toISOString() };
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return true;
  } catch (e) {
    console.warn(`[video] 写回视频状态失败：${e.message}`);
    return false;
  }
}

// Windows 上目标文件可能被播放器流/杀软扫描短暂占用，rm/rename 会抛
// EPERM/EBUSY。占用通常亚秒级释放；直接失败会浪费一次完整重下载（慢网络
// 用户就表现成"一直抓不回来"），所以带退避重试，耗尽才报"被占用"。
function assertVideoCommitAllowed(shouldCommit) {
  if (typeof shouldCommit !== 'function' || shouldCommit()) return;
  const error = new Error('Video task was replaced before its result was saved');
  error.code = 'STALE_VIDEO_TASK';
  throw error;
}

async function replaceVideoFileWithRetry(sourcePath, filePath, { shouldCommit } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      assertVideoCommitAllowed(shouldCommit);
      await fs.promises.rm(filePath, { force: true });
      assertVideoCommitAllowed(shouldCommit);
      await fs.promises.rename(sourcePath, filePath);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw new Error(`本地视频文件正被占用，暂时无法覆盖：${filePath}。请关闭正在预览/播放该视频的窗口后重试。`);
}

async function cleanupReplacedVideoFiles(projectId, episodeId, shotNo, keepPath) {
  // The UI cannot release its old source until this save finishes and returns
  // the cache-busted URL, so waiting through multiple delete retries here only
  // delays the successful result.
  const remaining = await cleanupSupersededVideoFiles(projectId, episodeId, shotNo, { keepPath, attempts: 1 });
  if (!remaining.length) return;
  // The freshly downloaded version is already valid and active. A Chromium
  // range request may keep an older file locked on Windows, so cleanup must
  // never turn a successful regeneration back into a failed pending task. The
  // next regeneration (or normal project cleanup) gets another chance.
  console.warn(`[video] 已保存新视频，旧版本暂时被占用，将稍后再次清理：${remaining.map((filePath) => path.basename(filePath)).join('、')}`);
}

async function archiveVideoBeforeReplacement(projectId, episodeId, shotNo, { shouldCommit } = {}) {
  assertVideoCommitAllowed(shouldCommit);
  if (!videoExists(projectId, episodeId, shotNo)) return;
  const result = await archiveCurrentVideoToHistory(projectId, episodeId, shotNo);
  if (!result.archived && result.reason !== 'no_current_video') {
    throw new Error(`旧视频归档失败，已保留当前版本：${result.error || '无法复制视频文件'}`);
  }
  assertVideoCommitAllowed(shouldCommit);
}

async function saveVideoFromLocalPath(projectId, episodeId, shotNo, sourcePath, options = {}) {
  await assertReadableVideoFile(sourcePath);
  await archiveVideoBeforeReplacement(projectId, episodeId, shotNo, options);

  const filePath = nextVideoWritePath(projectId, episodeId, shotNo);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.part`;
  try {
    await fs.promises.copyFile(sourcePath, tmpPath);
    // 落盘前先统一编码：部分视频模型返回 HEVC，Electron/Chromium 解不了 → 应用内预览全黑。
    // 在临时文件上转，转完再替换，所以最终文件一定是可播的；转码失败则保留原文件继续。
    await ensurePlayableCodec(tmpPath);
    await replaceVideoFileWithRetry(tmpPath, filePath, options);
    await cleanupReplacedVideoFiles(projectId, episodeId, shotNo, filePath);
  } catch (e) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
  return filePath;
}

// A successful provider response can still point at a truncated download or an
// HTML error page. Validate one decodable video frame before exposing the file.
async function assertReadableVideoFile(filePath) {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size < 10 * 1024) {
    throw new Error('视频文件为空或下载不完整');
  }
  try {
    await execFileAsync(ffmpegPath(), [
      '-v', 'error',
      '-i', filePath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-f', 'null',
      '-',
    ], { timeout: 60000, maxBuffer: 1024 * 1024 * 4 });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').replace(/\s+/g, ' ').slice(0, 240);
    throw new Error(`视频文件无法解析${detail ? `：${detail}` : ''}`);
  }
}

function providerVideoSources(result = {}) {
  return {
    videoPaths: [result.videoPaths || [], result.videoPath || ''],
    videoUrls: [result.videoUrls || [], result.videoUrl || ''],
  };
}

function providerRemoteVideoUrls(result = {}) {
  return [...new Set([result.videoUrls || [], result.videoUrl || '']
    .flat(Infinity)
    .map((value) => String(typeof value === 'object' ? value?.url : value || '').trim())
    .filter((value) => /^https?:\/\//i.test(value)))];
}

function persistedVideoSourceChanges(result = {}) {
  const videoUrls = providerRemoteVideoUrls(result);
  return { videoUrl: videoUrls[0] || '', videoUrls };
}

function hasProviderVideoSource(result = {}) {
  const sources = providerVideoSources(result);
  return sources.videoPaths.flat(Infinity).some(Boolean) || sources.videoUrls.flat(Infinity).some(Boolean);
}

async function saveVideoFromProviderResult(projectId, episodeId, shotNo, result = {}, options = {}) {
  const filePath = nextVideoWritePath(projectId, episodeId, shotNo);
  const stagingPath = `${filePath}.best-${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
  try {
    const selected = await saveBestVideoSourceToFile(
      stagingPath,
      providerVideoSources(result),
      options.headers || {},
      {
        retries: options.retries ?? 3,
        timeoutMs: options.timeoutMs ?? 120000,
        probeTimeoutMs: options.probeTimeoutMs ?? 20000,
      },
    );
    await assertReadableVideoFile(stagingPath);
    // AI 生成的视频走这条路径（导入本地预览走 saveVideoFromLocalPath）——两条都必须转码，
    // 否则 dola-2.5-30 这类输出 HEVC 的模型会让应用内预览变成黑屏（Chromium 解不了 H.265）。
    await ensurePlayableCodec(stagingPath);
    await archiveVideoBeforeReplacement(projectId, episodeId, shotNo, options);
    await replaceVideoFileWithRetry(stagingPath, filePath, options);
    await cleanupReplacedVideoFiles(projectId, episodeId, shotNo, filePath);
    console.info(`[video] selected ${selected.quality.width}x${selected.quality.height}, ${Math.round(selected.quality.bitRate || 0)} bps from ${selected.candidateCount} candidate(s)`);
    return filePath;
  } catch (error) {
    await fs.promises.rm(stagingPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function saveManualVideo(projectId, episodeId, shotNo, sourcePath) {
  const proj = loadProject(projectId);
  if (!proj) throw new Error('项目不存在');
  normalizeProjectScript(proj);
  const episode = proj.script?.episodes?.find((item) => String(item.id) === String(episodeId));
  if (!episode) throw new Error('集数不存在');

  const filePath = await saveVideoFromLocalPath(projectId, episodeId, shotNo, sourcePath);
  const localUrl = videoLocalUrl(projectId, episodeId, shotNo);
  if (!persistShotVideo(projectId, episodeId, shotNo, localUrl)) {
    try { await fs.promises.rm(filePath, { force: true }); } catch { /* best effort */ }
    throw new Error('视频已上传，但项目记录写入失败');
  }
  return { filePath, videoUrl: localUrl };
}

export function reconcileProjectShotVideos(projectId, project) {
  const storyboards = project?.script?.storyboards;
  if (!Array.isArray(storyboards)) return false;
  let changed = false;
  project.script.storyboards = storyboards.map((sb) => {
    const before = JSON.stringify((sb?.shotVideos && typeof sb.shotVideos === 'object') ? sb.shotVideos : {});
    const next = reconcileShotVideos(projectId, sb);
    const after = JSON.stringify((next?.shotVideos && typeof next.shotVideos === 'object') ? next.shotVideos : {});
    if (before !== after) changed = true;
    return next;
  });
  return changed;
}

export function tailFrameDiskPath(projectId, episodeId, shotNo) {
  return path.join(projectDir(projectId), 'tailframes', episodeKeyForPath(episodeId), `${sanitizeFilename(String(shotNo))}.png`);
}

export function tailFrameLocalUrl(projectId, episodeId, shotNo) {
  return `/tailframe/${encodeURIComponent(projectId)}/${encodeURIComponent(String(episodeId))}/${encodeURIComponent(String(shotNo))}.png?t=${Date.now()}`;
}

export async function extractTailFrame(projectId, episodeId, shotNo) {
  const videoPath = videoDiskPath(projectId, episodeId, shotNo);
  if (!fs.existsSync(videoPath)) {
    throw new Error(`镜头 ${shotNo} 还没有视频，无法截取尾帧`);
  }
  const outPath = tailFrameDiskPath(projectId, episodeId, shotNo);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  try {
    await execFileAsync(ffmpegPath(), [
      '-y', '-hide_banner',
      '-sseof', '-0.5',
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      outPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 16 });
  } catch (e) {
    await execFileAsync(ffmpegPath(), [
      '-y', '-hide_banner',
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      outPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 16 });
  }
  if (!fs.existsSync(outPath) || (await fs.promises.stat(outPath)).size < 100) {
    throw new Error('尾帧截取失败，请确认已安装 ffmpeg');
  }
  return outPath;
}

export async function saveManualTailFrame(projectId, episodeId, shotNo, imageDataUrl) {
  const source = String(imageDataUrl || '');
  const match = source.match(/^data:image\/png;base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error('请上传 PNG 格式的帧图');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length < 100) throw new Error('帧图数据为空');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('帧图过大');
  const outPath = tailFrameDiskPath(projectId, episodeId, shotNo);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, buffer);
  return outPath;
}

function openerFramePath(projectId, episodeId, openerFrameFrom) {
  const from = String(openerFrameFrom ?? '').trim();
  if (!from) return '';
  const framePath = tailFrameDiskPath(projectId, episodeId, from);
  return fs.existsSync(framePath) ? framePath : '';
}

function normalizeOpenerFrameName(value, fallback = '开场参考图') {
  const name = String(value || '').trim().slice(0, 40);
  return name || fallback;
}

function imageReferenceDescription(value, fallback = '参考图') {
  const name = String(value || '').trim();
  if (!name) return fallback;
  return /参考图$/u.test(name) ? name : `${name}参考图`;
}

function openerFramePromptPrefix(openerFrameName, imageSlot = '') {
  const name = normalizeOpenerFrameName(openerFrameName);
  const referenceName = imageReferenceDescription(name);
  const slot = String(imageSlot || '').trim();
  if (slot) {
    return `${slot} 是${referenceName}，作为本段视频的开场画面/起幅状态。生成时必须先从这张图的画面状态开始，保持人物站位、姿态、表情、道具位置、场景、光影和镜头方向连续，再按本段分镜推进。`;
  }
  return `【${name}】第一张参考图是${referenceName}，作为本段视频的开场画面/起幅状态。生成时必须先从这张图的画面状态开始，保持人物站位、姿态、表情、道具位置、场景、光影和镜头方向连续，再按本段分镜推进。`;
}

function withOpenerFramePrompt(prompt, openerFrameName, imageSlot = '') {
  const cleanPrompt = String(prompt || '').trim();
  const rawName = String(openerFrameName ?? '').trim();
  if (!rawName) return cleanPrompt;
  const name = normalizeOpenerFrameName(rawName);
  if (/第一张参考图\s*(?:@Image\d+\s*)?是|@Image\d+\s*是(?:[「“][^」”]+[」”]|[^，]+)，作为本段视频的开场画面\/起幅状态|【本段开场状态】|本段开场状态说明/.test(cleanPrompt)) return cleanPrompt;
  return `${openerFramePromptPrefix(name, imageSlot)}\n\n${cleanPrompt}`.trim();
}

function stageNamedReferenceFile(stageDir, sourcePath, name, ext = '.png') {
  const label = String(name || '').trim();
  if (!label) return sourcePath;
  const baseNoExt = path.basename(sourcePath, path.extname(sourcePath));
  if (baseNoExt === label) return sourcePath;
  fs.mkdirSync(stageDir, { recursive: true });
  const safe = label.replace(/[\\/:*?"<>|]/g, '_');
  const staged = path.join(stageDir, `${safe}${ext}`);
  try {
    fs.copyFileSync(sourcePath, staged);
    return staged;
  } catch {
    return sourcePath;
  }
}

async function stageLabeledReferenceFile(stageDir, sourcePath, name, ext = '.png') {
  const label = String(name || '').trim();
  if (!label) return sourcePath;
  fs.mkdirSync(stageDir, { recursive: true });
  const safe = label.replace(/[\\/:*?"<>|]/g, '_');
  const staged = path.join(stageDir, `${safe}_labeled${ext}`);
  try {
    await writeImagesWithNameLabels([{ src: sourcePath, dest: staged, label }]);
    return staged;
  } catch {
    return sourcePath;
  }
}

function existingLocalReferenceFile(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let filePath = raw;
  if (/^file:\/\//i.test(raw)) {
    try { filePath = fileURLToPath(raw); } catch { filePath = raw; }
  }
  try {
    return fs.statSync(filePath).isFile() ? filePath : '';
  } catch {
    return '';
  }
}

function stripImageExt(name) {
  return String(name || '').trim().replace(/\.(?:png|jpe?g|webp|bmp)$/i, '');
}

function localProjectImageFromUrl(projectId, value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let pathname = '';
  try {
    pathname = new URL(raw, 'http://local').pathname;
  } catch {
    return null;
  }
  const parts = pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const route = parts[0];
  if ((route !== 'img' && route !== 'imglabel') || parts.length < 4) return null;
  if (String(parts[1]) !== String(projectId)) return null;
  const cat = parts[2];
  const imageBase = stripImageExt(parts.slice(3).join('/'));
  const filePath = route === 'imglabel'
    ? labeledDiskPath(projectId, cat, imageBase)
    : imageDiskPath(projectId, cat, imageBase);
  return fs.existsSync(filePath) ? { path: filePath, cat, imageBase } : null;
}

function resolveReferenceImagePath(projectId, ref = {}) {
  for (const key of ['path', 'filePath', 'localPath', 'imagePath', 'absPath', 'absolutePath']) {
    const filePath = existingLocalReferenceFile(ref?.[key]);
    if (filePath) return { path: filePath, cat: '', imageBase: '' };
  }
  for (const key of ['url', 'imageUrl', 'src', 'labeledUrl']) {
    const resolved = localProjectImageFromUrl(projectId, ref?.[key]);
    if (resolved) return resolved;
  }
  const cat = String(ref?.cat || '').trim();
  const imageBase = stripImageExt(ref?.imageBase || ref?.name || '');
  if (!cat || !imageBase) return { path: '', cat: '', imageBase: '' };
  const filePath = imageDiskPath(projectId, cat, imageBase);
  return fs.existsSync(filePath) ? { path: filePath, cat, imageBase } : { path: '', cat, imageBase };
}

function referenceImageMentionName(ref = {}, filePath = '') {
  const fallback = path.basename(String(filePath || ''), path.extname(String(filePath || ''))).trim();
  return String(ref?.mentionName || ref?.displayName || ref?.label || ref?.name || ref?.imageBase || fallback || '').trim();
}

function mentionNameFromUploadPath(filePath, fallback = '') {
  const base = path.basename(String(filePath || ''), path.extname(String(filePath || ''))).trim();
  return base || String(fallback || '').trim();
}

function makeReferenceMention(uploadPath, requestedName, kind, options = {}) {
  const displayName = String(requestedName || '').trim();
  const name = mentionNameFromUploadPath(uploadPath, displayName);
  if (!name) return null;
  const label = displayName || name;
  const normalizedKind = String(kind || '').toLowerCase();
  const isAudio = String(kind || '').toLowerCase() === 'audio';
  const defaultPhrase = normalizedKind === 'audio'
    ? `这个是${label}的配音/音色参考`
    : normalizedKind === 'video'
      ? `是${label}视频参考`
      : `是${imageReferenceDescription(label)}`;
  return {
    name,
    displayName: label,
    kind,
    category: String(options.category || '').trim(),
    phrase: String(options.phrase || defaultPhrase).trim(),
    fallbackText: options.fallbackText !== undefined
      ? String(options.fallbackText || '').trim()
      : (isAudio ? label : ''),
  };
}

async function prepareDreaminaAgentAudioReference(projectId, audioPath) {
  const ext = path.extname(audioPath).toLowerCase();
  if (ext === '.mp3' || ext === '.wav') return audioPath;
  const targetDir = path.join(projectDir(projectId), '.dreamina-agent-references');
  const targetPath = path.join(targetDir, `${path.basename(audioPath, ext)}.mp3`);
  const [sourceStat, targetStat] = await Promise.all([
    fs.promises.stat(audioPath),
    fs.promises.stat(targetPath).catch(() => null),
  ]);
  if (targetStat?.isFile() && targetStat.size > 0 && targetStat.mtimeMs >= sourceStat.mtimeMs) return targetPath;
  await fs.promises.mkdir(targetDir, { recursive: true });
  try {
    await execFileAsync(ffmpegPath(), [
      '-y',
      '-hide_banner',
      '-i', audioPath,
      '-vn',
      '-ac', '1',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      targetPath,
    ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    try { fs.rmSync(targetPath, { force: true }); } catch { /* ignore incomplete conversion */ }
    throw new Error(`即梦 Agent 参考音频转换为 MP3 失败：${path.basename(audioPath)}；${String(error?.stderr || error?.message || error).trim()}`);
  }
  const converted = await fs.promises.stat(targetPath).catch(() => null);
  if (!converted?.isFile() || converted.size <= 0) {
    throw new Error(`即梦 Agent 参考音频转换为 MP3 失败：${path.basename(audioPath)}`);
  }
  return targetPath;
}

function audioReferenceOwnerName(name) {
  const raw = String(name || '').trim();
  return raw
    .replace(/[\s_-]*(?:的)?[\s_-]*(?:音频|声音|配音|音色|voice|audio)(?:\s*\d+)?$/i, '')
    .replace(/[\s_-]+$/g, '')
    .trim() || raw;
}

function buildXiaoyunquePromptPrefix(task = {}) {
  const mentions = Array.isArray(task.mentions) ? task.mentions : [];
  const imageNames = [];
  const audioNames = [];
  const seenImages = new Set();
  const seenAudios = new Set();
  const openerFrameFrom = String(task.openerFrameFrom ?? '').trim();
  if (openerFrameFrom) {
    const openerFrameName = normalizeOpenerFrameName(task.openerFrameName);
    imageNames.push(openerFrameName);
    seenImages.add(openerFrameName);
  }
  for (const item of mentions) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const displayName = String(item?.displayName || item?.label || name).trim() || name;
    const kind = String(item?.kind || item?.type || '').trim().toLowerCase();
    const isAudio = kind === 'audio' || (!kind && /音频|声音|配音|voice|audio/i.test(name));
    const target = isAudio ? audioNames : imageNames;
    const seen = isAudio ? seenAudios : seenImages;
    if (seen.has(name)) continue;
    seen.add(name);
    target.push(displayName);
  }
  const lines = [];
  if (imageNames.length) {
    imageNames.forEach((name, index) => lines.push(`@Image${index + 1} 是${imageReferenceDescription(name)}`));
  }
  if (audioNames.length) {
    audioNames.forEach((name, index) => lines.push(`@Audio${index + 1} 这个是${audioReferenceOwnerName(name)}的配音/音色参考`));
  }
  if (!lines.length) return '';
  lines.push('请同时参考以上素材保持人物形象、人物音色、场景、道具和画面连续性。');
  return lines.join('；');
}

function withXiaoyunqueReferencePrompt(tasks = []) {
  return tasks.map((task) => {
    const prefix = buildXiaoyunquePromptPrefix(task);
    if (!prefix) return task;
    const prompt = String(task.prompt || '').trim();
    return {
      ...task,
      prompt: `${prefix}\n\n${prompt}`,
    };
  });
}

const dreaminaSubmittingShots = new Set();
function dreaminaShotKey(projectId, episodeId, shotNo) {
  return `${projectId}:${episodeId}:${String(shotNo)}`;
}

const xiaoyunqueSubmittingShots = new Set();
function xiaoyunqueShotKey(projectId, episodeId, shotNo) {
  return `${projectId}:${episodeId}:${String(shotNo)}`;
}

async function submitXiaoyunqueBatch({
  projectId,
  episodeId,
  tasks,
  body,
  cfg,
  stageDir,
} = {}) {
  const activeTasks = [];
  const submittingKeys = [];
  const skippedSubmits = {};
  for (const task of tasks) {
    const key = xiaoyunqueShotKey(projectId, episodeId, task.shotNo);
    const pending = findUnfinishedByShot(projectId, episodeId, task.shotNo, 'xiaoyunque');
    if (pending) {
      skippedSubmits[task.shotNo] = {
        ok: true,
        skipped: true,
        submitId: pending.submitId,
        error: '该镜头已在小云雀队列中，已跳过重复提交',
      };
      continue;
    }
    if (xiaoyunqueSubmittingShots.has(key)) {
      skippedSubmits[task.shotNo] = { ok: true, skipped: true, error: '该镜头已在提交中，已跳过重复提交' };
      continue;
    }
    xiaoyunqueSubmittingShots.add(key);
    submittingKeys.push(key);
    activeTasks.push(task);
  }

  const jobId = `xyqsubmit_${Date.now()}`;
  if (!activeTasks.length) {
    setJob(jobId, {
      status: 'done',
      phase: 'submit',
      provider: 'xiaoyunque',
      projectId,
      episodeId,
      title: `视频提交 · 第 ${episodeId} 集`,
      total: 0,
      submitted: 0,
      failed: 0,
      skipped: Object.keys(skippedSubmits).length,
      submits: skippedSubmits,
      message: '这些镜头已在小云雀队列或提交中，已跳过重复提交',
    });
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { jobId, skipped: Object.keys(skippedSubmits).length };
  }

  const accountId = String(body.accountId || body.lineId || '').trim();
  const account = acquireXiaoyunqueAccount(accountId);
  if (!account) {
    for (const key of submittingKeys) xiaoyunqueSubmittingShots.delete(key);
    const msg = accountId
      ? '指定的小云雀线路不可用，请检查 access key 状态'
      : '没有可用的小云雀 access key，请先在设置里添加';
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new Error(msg);
  }

  setJob(jobId, {
    status: 'running',
    phase: 'submit',
    provider: 'xiaoyunque',
    projectId,
    episodeId,
    title: `视频提交 · 第 ${episodeId} 集 · ${activeTasks.length} 镜头`,
    total: activeTasks.length,
    submitted: 0,
    failed: 0,
    shotNos: activeTasks.map((task) => String(task.shotNo)),
    skipped: Object.keys(skippedSubmits).length,
    message: activeTasks.length ? '开始提交小云雀...' : '这些镜头已在提交中，已跳过重复提交',
    submits: { ...skippedSubmits },
  });

  (async () => {
    const usageRecordedShots = new Set();
    try {
      const results = await submitXiaoyunqueVideos({
        account,
        shots: activeTasks,
        model: body.model || cfg.video?.xiaoyunqueModel,
        resolution: body.resolution || cfg.video?.resolution || '720p',
        onProgress: (message) => setJob(jobId, { message }),
        onSubmitProgress: (status) => setJob(jobId, status),
      });
      let submitted = 0;
      let failed = 0;
      const submits = { ...skippedSubmits };
      for (const result of results) {
        if (result.ok && result.submitId) {
          addPending({
            projectId,
            episodeId,
            shotNo: result.shotNo,
            submitId: result.submitId,
            historyId: result.historyId,
            accountId: account.id,
            provider: 'xiaoyunque',
            jobId,
          });
          submits[result.shotNo] = {
            ok: true,
            submitId: result.submitId,
            channelId: result.channelId || cfg.video?.apiActiveChannelId || 'video-api',
            model: result.model || body.model || cfg.video?.apiModel || '',
          };
          submitted++;
          const submittedTask = tasks.find((task) => String(task.shotNo) === String(result.shotNo));
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'xiaoyunque',
            model: submittedTask?.model || body.model || cfg.video?.xiaoyunqueModel || '',
            task: submittedTask,
            fallbackDuration: body.duration,
          });
        } else {
          submits[result.shotNo] = { ok: false, error: result.error };
          const failedTask = activeTasks.find((task) => String(task.shotNo) === String(result.shotNo));
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'xiaoyunque',
            model: failedTask?.model || body.model || cfg.video?.xiaoyunqueModel || '',
            task: failedTask,
            fallbackDuration: body.duration,
            status: 'failed',
            error: result.error || '视频提交失败',
          });
          failed++;
          if (result.code === 'AUTH_EXPIRED' || result.code === 'AUTH_MISSING') markXiaoyunqueAccountStatus(account.id, 'invalid');
        }
        usageRecordedShots.add(String(result.shotNo));
        xiaoyunqueSubmittingShots.delete(xiaoyunqueShotKey(projectId, episodeId, result.shotNo));
      }
      setJob(jobId, {
        status: 'done',
        provider: 'xiaoyunque',
        submitted,
        failed,
        skipped: Object.keys(skippedSubmits).length,
        submits,
        message: `已提交 ${submitted}/${activeTasks.length} 进小云雀队列`,
      });
    } catch (e) {
      for (const task of activeTasks) {
        if (usageRecordedShots.has(String(task.shotNo))) continue;
        recordVideoSubmission({
          cfg,
          projectId,
          episodeId,
          provider: 'xiaoyunque',
          model: task?.model || body.model || cfg.video?.xiaoyunqueModel || '',
          task,
          fallbackDuration: body.duration,
          status: 'failed',
          error: e.message,
        });
      }
      setJob(jobId, { status: 'error', provider: 'xiaoyunque', error: e.message, message: e.message });
    } finally {
      for (const key of submittingKeys) xiaoyunqueSubmittingShots.delete(key);
      releaseXiaoyunqueAccount(account.id);
      const fresh = findXiaoyunqueAccountById(account.id);
      if (fresh && fresh.status !== 'paid_required' && fresh.status !== 'invalid') markXiaoyunqueAccountStatus(account.id, 'IDLE');
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  })();

  return { jobId };
}

async function submitDreaminaBatch({
  projectId,
  episodeId,
  tasks,
  body,
  cfg,
  stageDir,
} = {}) {
  const jobId = `dreamina_submit_${Date.now()}`;
  const accountId = dreaminaLocalAccountId();
  const submittingKeys = tasks.map((task) => dreaminaShotKey(projectId, episodeId, task.shotNo));
  for (const key of submittingKeys) dreaminaSubmittingShots.add(key);
  setJob(jobId, {
    status: 'running',
    phase: 'submit',
    provider: 'dreamina-cli',
    projectId,
    episodeId,
    title: `视频提交 · 第 ${episodeId} 集 · ${tasks.length} 镜头`,
    total: tasks.length,
    submitted: 0,
    failed: 0,
    shotNos: tasks.map((task) => String(task.shotNo)),
    message: '开始提交 Dreamina CLI...',
    submits: {},
  });

  (async () => {
    const usageRecordedShots = new Set();
    try {
      const results = await submitDreaminaVideos({
        shots: tasks,
        model: body.model || cfg.video?.dreaminaModel || '',
        resolution: body.resolution || cfg.video?.resolution || '720p',
        session: body.session ?? cfg.video?.dreaminaSession ?? '0',
        onProgress: (message) => setJob(jobId, { message }),
        onSubmitProgress: (status) => setJob(jobId, status),
      });
      let submitted = 0;
      let failed = 0;
      const submits = {};
      for (const result of results) {
        if (result.ok && result.submitId) {
          addPending({
            projectId,
            episodeId,
            shotNo: result.shotNo,
            submitId: result.submitId,
            historyId: result.historyId,
            accountId,
            provider: 'dreamina-cli',
            jobId,
          });
          submits[result.shotNo] = { ok: true, submitId: result.submitId };
          submitted++;
          const submittedTask = tasks.find((task) => String(task.shotNo) === String(result.shotNo));
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'dreamina-cli',
            model: submittedTask?.model || body.model || cfg.video?.dreaminaModel || '',
            task: submittedTask,
            fallbackDuration: body.duration,
          });
        } else {
          submits[result.shotNo] = { ok: false, error: result.error };
          const failedTask = tasks.find((task) => String(task.shotNo) === String(result.shotNo));
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'dreamina-cli',
            model: failedTask?.model || body.model || cfg.video?.dreaminaModel || '',
            task: failedTask,
            fallbackDuration: body.duration,
            status: 'failed',
            error: result.error || '视频提交失败',
          });
          failed++;
        }
        usageRecordedShots.add(String(result.shotNo));
        dreaminaSubmittingShots.delete(dreaminaShotKey(projectId, episodeId, result.shotNo));
      }
      const firstError = Object.values(submits).find((item) => item && item.ok === false)?.error || '';
      setJob(jobId, {
        status: submitted > 0 ? 'done' : 'error',
        provider: 'dreamina-cli',
        submitted,
        failed,
        submits,
        message: submitted > 0
          ? `已提交 ${submitted}/${tasks.length} 进 Dreamina CLI 队列`
          : `Dreamina CLI 提交失败：${firstError || '没有任务提交成功'}`,
        error: submitted > 0 ? '' : (firstError || '没有任务提交成功'),
      });
    } catch (e) {
      for (const task of tasks) {
        if (usageRecordedShots.has(String(task.shotNo))) continue;
        recordVideoSubmission({
          cfg,
          projectId,
          episodeId,
          provider: 'dreamina-cli',
          model: task?.model || body.model || cfg.video?.dreaminaModel || '',
          task,
          fallbackDuration: body.duration,
          status: 'failed',
          error: e.message,
        });
      }
      setJob(jobId, { status: 'error', provider: 'dreamina-cli', error: e.message, message: e.message });
    } finally {
      for (const key of submittingKeys) dreaminaSubmittingShots.delete(key);
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  })();

  return { jobId };
}

const DREAMINA_AGENT_QUEUE_RETRY_BASE_MS = 15000;
const DREAMINA_AGENT_QUEUE_RETRY_MAX_MS = 5 * 60 * 1000;
const DREAMINA_AGENT_QUEUE_LOCK_PATH = path.join(DATA_DIR, '.dreamina-agent-queue.lock');
let dreaminaAgentQueueRunner = null;
let dreaminaAgentQueueTimer = null;

function acquireDreaminaAgentQueueLock() {
  return acquireProcessFileLock(DREAMINA_AGENT_QUEUE_LOCK_PATH);
}

function dreaminaAgentQueueSubmitId(queueId) {
  return `dreamina-agent-queue:${queueId}`;
}

function newDreaminaAgentQueueId() {
  return `daq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function listDreaminaAgentQueueItems() {
  const output = [];
  for (const project of listProjects({ withSizes: false, withCovers: false })) {
    const state = loadDreaminaAgentState(project.id);
    for (const [episodeId, episode] of Object.entries(state.episodes)) {
      for (const item of episode.queue || []) {
        output.push({ ...item, projectId: project.id, episodeId });
      }
    }
  }
  return output.sort((left, right) => (
    Number(left.createdAt) - Number(right.createdAt)
    || String(left.id).localeCompare(String(right.id))
  ));
}

function mutateDreaminaAgentQueueItem(projectId, episodeId, queueId, mutator) {
  return mutateDreaminaAgentEpisode(projectId, episodeId, (episode) => {
    const item = (episode.queue || []).find((candidate) => candidate.id === queueId);
    if (!item) return null;
    mutator(item, episode);
    item.updatedAt = Date.now();
    return { ...item, projectId, episodeId };
  });
}

function removeDreaminaAgentQueueItem(projectId, episodeId, queueId) {
  return mutateDreaminaAgentEpisode(projectId, episodeId, (episode) => {
    const index = (episode.queue || []).findIndex((candidate) => candidate.id === queueId);
    if (index < 0) return null;
    const [removed] = episode.queue.splice(index, 1);
    return { ...removed, projectId, episodeId };
  });
}

function dreaminaAgentQueueContains(item) {
  const episode = loadDreaminaAgentState(item.projectId).episodes[String(item.episodeId)];
  return (episode?.queue || []).some((candidate) => candidate.id === item.id);
}

function officialDreaminaAgentPendingForShot(item) {
  return listPending().find((task) => (
    task.projectId === item.projectId
    && String(task.episodeId) === String(item.episodeId)
    && String(task.shotNo) === String(item.task?.shotNo)
    && task.provider === 'dreamina-agent'
    && task.accountId === item.accountId
    && String(task.submitId || '').startsWith('dreamina-agent:')
  )) || null;
}

function dreaminaAgentQueueItemsForJob(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return [];
  return listDreaminaAgentQueueItems().filter((item) => (
    Array.isArray(item.jobIds) && item.jobIds.some((candidate) => String(candidate) === id)
  ));
}

export function reconcileDreaminaAgentQueueJob(jobId, inputState = null) {
  const id = String(jobId || '').trim();
  const state = inputState || getJob(id);
  if (!state || state.provider !== 'dreamina-agent' || state.status === 'cancelled') return state;

  const total = Math.max(0, Number(state.total) || 0);
  if (!total) return state;
  const remainingItems = dreaminaAgentQueueItemsForJob(id);
  const remainingShotNos = new Set(remainingItems.map((item) => String(item.task?.shotNo)));
  const configuredShotNos = new Set((Array.isArray(state.shotNos) ? state.shotNos : []).map(String));
  const createdAt = Date.parse(state.createdAt || '') || 0;
  const submits = { ...(state.submits || {}) };

  for (const pending of listPending()) {
    if (pending.provider !== 'dreamina-agent') continue;
    if (pending.projectId !== state.projectId || String(pending.episodeId) !== String(state.episodeId)) continue;
    if (!String(pending.submitId || '').startsWith('dreamina-agent:')) continue;
    const pendingJobIds = new Set([
      ...(Array.isArray(pending.jobIds) ? pending.jobIds : []),
      pending.jobId,
    ].map((value) => String(value || '').trim()).filter(Boolean));
    const shotNo = String(pending.shotNo);
    const explicitlyRelated = pendingJobIds.has(id);
    const legacyRelated = !pendingJobIds.size
      && (configuredShotNos.size ? configuredShotNos.has(shotNo) : Number(pending.createdAt) >= createdAt - 2000);
    if (!explicitlyRelated && !legacyRelated) continue;
    if (remainingShotNos.has(shotNo) || submits[shotNo]) continue;
    submits[shotNo] = { ok: true, submitId: pending.submitId, recovered: true };
  }

  const values = Object.values(submits);
  const recordedSubmitted = values.filter((result) => result?.ok === true).length;
  const failed = Math.max(Number(state.failed) || 0, values.filter((result) => result?.ok === false).length);
  const inferredProcessed = Math.max(0, total - remainingItems.length);
  const processed = Math.min(total, Math.max(Number(state.processed) || 0, recordedSubmitted + failed, inferredProcessed));
  const submitted = Math.min(total - failed, Math.max(Number(state.submitted) || 0, recordedSubmitted, processed - failed));
  if (
    submitted === (Number(state.submitted) || 0)
    && failed === (Number(state.failed) || 0)
    && processed === (Number(state.processed) || 0)
    && Object.keys(submits).length === Object.keys(state.submits || {}).length
  ) return state;

  const terminal = processed >= total;
  return setJob(id, {
    status: terminal ? (submitted > 0 ? 'done' : 'error') : 'running',
    submitted,
    failed,
    processed,
    submits,
    message: terminal
      ? (submitted > 0
        ? `已确认 ${submitted}/${total} 个分镜发送到即梦 Agent，生成完成后自动下载`
        : '即梦 Agent 发送失败：没有分镜发送成功')
      : `即梦 Agent 发送队列：已确认 ${submitted}/${total}，剩余 ${Math.max(0, total - processed)}`,
    error: terminal && submitted === 0 ? (state.error || '没有分镜发送成功') : '',
  });
}

function updateDreaminaAgentQueueJobs(item, submitResult, message = '', { reconcile = true } = {}) {
  for (const jobId of (Array.isArray(item.jobIds) ? item.jobIds : [])) {
    const state = reconcile ? reconcileDreaminaAgentQueueJob(jobId) : getJob(jobId);
    if (!state || state.status === 'cancelled') continue;
    const submits = { ...(state.submits || {}) };
    if (submitResult) submits[item.task.shotNo] = submitResult;
    const values = Object.values(submits);
    const submitted = Math.max(Number(state.submitted) || 0, values.filter((result) => result?.ok === true).length);
    const failed = Math.max(Number(state.failed) || 0, values.filter((result) => result?.ok === false).length);
    const processed = Math.max(Number(state.processed) || 0, submitted + failed);
    const total = Number(state.total) || values.length;
    const terminal = processed >= total;
    const firstError = values.find((result) => result?.ok === false)?.error || '';
    setJob(jobId, {
      status: terminal ? (submitted > 0 ? 'done' : 'error') : 'running',
      submitted,
      failed,
      processed,
      submits,
      message: terminal
        ? (submitted > 0
          ? `已确认 ${submitted}/${total} 个分镜发送到即梦 Agent，生成完成后自动下载`
          : `即梦 Agent 发送失败：${firstError || '没有分镜发送成功'}`)
        : (message || `即梦 Agent 发送队列：已确认 ${submitted}/${total}，剩余 ${Math.max(0, total - processed)}`),
      error: terminal && submitted === 0 ? (firstError || '没有分镜发送成功') : '',
    });
  }
}

function cancelDreaminaAgentQueueJobs(items = []) {
  const jobIds = new Set(items.flatMap((item) => (Array.isArray(item?.jobIds) ? item.jobIds : [])));
  for (const jobId of jobIds) {
    const state = getJob(jobId);
    if (!state || ['done', 'error', 'failed', 'cancelled'].includes(state.status)) continue;
    setJob(jobId, {
      status: 'cancelled',
      cancelRequested: true,
      message: '即梦 Agent 发送队列已取消',
      error: '',
    });
  }
}

function ensureDreaminaAgentQueuePlaceholder(item) {
  if (!dreaminaAgentQueueContains(item)) return;
  if (officialDreaminaAgentPendingForShot(item)) return;
  const submitId = dreaminaAgentQueueSubmitId(item.id);
  const existing = listPending().find((task) => task.submitId === submitId);
  const canCancel = isDreaminaAgentQueueItemSafelyCancelable(item);
  if (existing) {
    updatePending(submitId, {
      queueState: String(item.status || 'queued'),
      canCancel,
      submissionAccepted: hasDreaminaAgentSubmission(item),
    });
    return;
  }
  addPending({
    projectId: item.projectId,
    episodeId: item.episodeId,
    shotNo: item.task.shotNo,
    submitId,
    accountId: item.accountId,
    provider: 'dreamina-agent',
    status: 'submitting',
    lastError: item.lastError || '',
    queueState: String(item.status || 'queued'),
    canCancel,
    jobIds: item.jobIds,
  });
}

export function enqueueDreaminaAgentVideoTasks({ projectId, episodeId, tasks, jobId, accountId = '' }) {
  const queued = mutateDreaminaAgentEpisode(projectId, episodeId, (episode) => {
    const output = [];
    let createdAtCursor = Math.max(
      Date.now(),
      ...(episode.queue || []).map((item) => (Number(item.createdAt) || 0) + 1),
    );
    for (const task of tasks) {
      const shotNo = String(task.shotNo);
      const taskAccountId = String(task.accountId || accountId || selectedDreaminaAgentAccountId()).trim();
      requireDreaminaAgentAccount(taskAccountId);
      let item = (episode.queue || []).find((candidate) => String(candidate.task?.shotNo) === shotNo);
      if (item) {
        item.jobIds = [...new Set([...(item.jobIds || []), jobId])];
        if (!item.submission && item.accountId !== taskAccountId) item.accountId = taskAccountId;
        output.push({ ...item, projectId, episodeId });
        continue;
      }
      const createdAt = createdAtCursor;
      createdAtCursor += 1;
      item = {
        id: newDreaminaAgentQueueId(),
        accountId: taskAccountId,
        task: { ...task, accountId: taskAccountId },
        status: 'queued',
        attempts: 0,
        confirmAttempts: 0,
        nextAttemptAt: 0,
        lastError: '',
        createdAt,
        updatedAt: createdAt,
        jobIds: [jobId],
      };
      episode.queue.push(item);
      delete episode.failures[shotNo];
      output.push({ ...item, projectId, episodeId });
    }
    return output;
  });
  for (const item of queued) ensureDreaminaAgentQueuePlaceholder(item);
  return queued;
}

function retryDelayForDreaminaAgentQueue(attempts) {
  return Math.min(
    DREAMINA_AGENT_QUEUE_RETRY_MAX_MS,
    DREAMINA_AGENT_QUEUE_RETRY_BASE_MS * (2 ** Math.max(0, Math.min(8, Number(attempts) - 1))),
  );
}

function isPermanentDreaminaAgentQueueError(error) {
  return /(?:ENOENT|素材文件不存在|本地参考素材不存在|项目不存在|没有有效的视频提示词|缺少 projectId|缺少 episodeId|Unsupported video provider)/i
    .test(String(error || ''));
}

function markDreaminaAgentQueueRetry(item, error, { confirming = false } = {}) {
  const message = String(error || '即梦 Agent 暂时无法发送，等待自动重试');
  const updated = mutateDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id, (current) => {
    const attempts = confirming ? (Number(current.confirmAttempts) || 0) : (Number(current.attempts) || 0);
    current.status = confirming ? 'confirming' : 'retry_wait';
    current.lastError = message;
    current.nextAttemptAt = Date.now() + retryDelayForDreaminaAgentQueue(Math.max(1, attempts));
  });
  if (!updated) return false;
  updatePending(dreaminaAgentQueueSubmitId(item.id), {
    status: 'submitting',
    queueState: confirming ? 'confirming' : 'retry_wait',
    canCancel: !confirming,
    submissionAccepted: confirming,
    lastError: `${message}；软件会自动重试`,
    lastAttemptAt: new Date().toISOString(),
  });
  updateDreaminaAgentQueueJobs(updated || item, {
    ok: null,
    status: confirming ? 'confirming' : 'retrying',
    error: message,
  }, `分镜 ${item.task.shotNo} 暂未确认发送，稍后自动重试；后续分镜继续排队`);
  return true;
}

function dreaminaAgentHistoryModel(task = {}) {
  return normalizeDreaminaAgentPromptPreset(task.dreaminaAgentPromptPreset) === 'fast'
    ? 'Seedance 2.0fast 非VIP非2.0'
    : 'Seedance 2.0 非VIP非fast';
}

function markDreaminaAgentQueueFailure(item, error, cfg) {
  const message = String(error || '即梦 Agent 视频提交失败');
  let removed = false;
  mutateDreaminaAgentEpisode(item.projectId, item.episodeId, (episode) => {
    const before = (episode.queue || []).length;
    episode.queue = (episode.queue || []).filter((candidate) => candidate.id !== item.id);
    removed = episode.queue.length < before;
    if (!removed) return;
    episode.failures[String(item.task.shotNo)] = {
      queueId: item.id,
      error: message,
      attempts: Number(item.attempts) || 0,
      failedAt: new Date().toISOString(),
    };
  });
  if (!removed) return false;
  updatePending(dreaminaAgentQueueSubmitId(item.id), {
    status: 'failed',
    queueState: 'failed',
    canCancel: false,
    lastError: message,
    lastAttemptAt: new Date().toISOString(),
  });
  updateDreaminaAgentQueueJobs(item, { ok: false, error: message });
  recordVideoSubmission({
    cfg,
    projectId: item.projectId,
    episodeId: item.episodeId,
    provider: 'dreamina-agent',
    model: dreaminaAgentHistoryModel(item.task),
    task: item.task,
    fallbackDuration: 15,
    status: 'failed',
    error: message,
  });
  return true;
}

function completeDreaminaAgentQueueItem(item, result, cfg) {
  if (!dreaminaAgentQueueContains(item)) return false;
  if (!result?.projectId || !result?.conversationId || !result?.historyId || !result?.submitId || result.referencesConfirmed !== true) {
    throw new Error('即梦 Agent 返回信息不完整，尚不能确认该分镜已发送');
  }
  addPending({
    projectId: item.projectId,
    episodeId: item.episodeId,
    shotNo: item.task.shotNo,
    submitId: result.submitId,
    historyId: result.historyId,
    accountId: item.accountId,
    provider: 'dreamina-agent',
    jobIds: item.jobIds,
  });
  if (result.generationFailure) {
    updatePending(result.submitId, {
      status: 'failed',
      lastError: result.generationFailure,
      lastAttemptAt: new Date().toISOString(),
    });
  }
  removeDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id);
  saveDreaminaAgentBinding(item.projectId, item.episodeId, item.accountId, {
    canvasProjectId: result.projectId,
    lastSubmittedAt: result.submittedAt,
  });
  updateDreaminaAgentQueueJobs(item, {
    ok: true,
    submitId: result.submitId,
    projectId: result.projectId,
    workspaceId: result.workspaceId || result.projectId,
    conversationId: result.conversationId,
    historyId: result.historyId,
    cardName: result.cardName,
    cardRenameError: result.cardRenameError,
    canvasProjectName: result.canvasProjectName || dreaminaAgentCanvasProjectName(item.projectId, item.episodeId),
    referencedSubjects: result.referencedSubjects || [],
  });
  recordVideoSubmission({
    cfg,
    projectId: item.projectId,
    episodeId: item.episodeId,
    provider: 'dreamina-agent',
    model: dreaminaAgentHistoryModel(item.task),
    task: item.task,
    fallbackDuration: 15,
  });
  return true;
}

async function processOneDreaminaAgentQueueItem(item, cfg) {
  const alreadyTracked = officialDreaminaAgentPendingForShot(item);
  if (alreadyTracked) {
    const parts = String(alreadyTracked.submitId).split(':');
    const canvasProjectName = dreaminaAgentCanvasProjectName(item.projectId, item.episodeId);
    try {
      await renameDreaminaAgentCanvasProject({ accountId: item.accountId, projectId: parts[1], name: canvasProjectName });
    } catch (error) {
      markDreaminaAgentQueueRetry(item, error.message || error, { confirming: true });
      return;
    }
    if (!removeDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id)) return;
    updateDreaminaAgentQueueJobs(item, {
      ok: true,
      submitId: alreadyTracked.submitId,
      projectId: parts[1],
      conversationId: parts[2],
      historyId: alreadyTracked.historyId || parts[3],
      canvasProjectName,
      recovered: true,
    });
    return;
  }
  ensureDreaminaAgentQueuePlaceholder(item);

  if (item.submission?.projectId && item.submission?.conversationId) {
    const confirming = mutateDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id, (current) => {
      current.status = 'confirming';
      current.confirmAttempts = (Number(current.confirmAttempts) || 0) + 1;
      current.nextAttemptAt = 0;
    }) || item;
    try {
      const confirmed = await confirmDreaminaAgentVideoSubmission({
        ...item.submission,
        accountId: item.accountId,
      });
      if (!confirmed.ok) {
        markDreaminaAgentQueueRetry(confirming, confirmed.error, { confirming: true });
        return;
      }
      const canvasProjectName = dreaminaAgentCanvasProjectName(item.projectId, item.episodeId);
      await renameDreaminaAgentCanvasProject({
        accountId: item.accountId,
        projectId: confirmed.projectId || item.submission.projectId,
        name: canvasProjectName,
      });
      completeDreaminaAgentQueueItem(confirming, {
        ...item.submission,
        ...confirmed,
        canvasProjectName,
        referencesConfirmed: item.submission.referencesConfirmed === true,
      }, cfg);
    } catch (error) {
      markDreaminaAgentQueueRetry(confirming, error.message || error, { confirming: true });
    }
    return;
  }

  const submitting = mutateDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id, (current) => {
    current.status = 'submitting';
    current.attempts = (Number(current.attempts) || 0) + 1;
    current.nextAttemptAt = 0;
    current.lastError = '';
  }) || item;
  updatePending(dreaminaAgentQueueSubmitId(item.id), {
    queueState: 'submitting',
    canCancel: false,
    lastError: '正在发送到即梦 Agent',
    lastAttemptAt: new Date().toISOString(),
  });
  const itemAccountKey = dreaminaAgentSessionAccountKey(requireDreaminaAgentAccount(item.accountId).sessionId);
  const binding = loadDreaminaAgentBinding(item.projectId, item.episodeId, item.accountId);
  const result = (await submitDreaminaAgentVideos({
    accountId: item.accountId,
    shots: [item.task],
    scopeKey: `${item.projectId}:${item.episodeId}`,
    canvasProjectId: binding.canvasProjectId,
    canvasProjectName: dreaminaAgentCanvasProjectName(item.projectId, item.episodeId),
    lastSubmittedAt: binding.lastSubmittedAt,
    shotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(
      item.task.dreaminaAgentShotIntervalSeconds || cfg.video?.dreaminaAgentShotIntervalSeconds,
    ),
    shouldCancel: () => !dreaminaAgentQueueContains(item),
    onProgress: (message) => updateDreaminaAgentQueueJobs(submitting, null, message),
    onSubmissionAccepted: (accepted) => {
      mutateDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id, (current, episode) => {
        current.submission = { ...accepted, accountId: item.accountId };
        current.status = 'confirming';
        current.lastError = '';
        const currentBinding = episode.accountBindings[item.accountId] || {};
        episode.accountBindings[item.accountId] = {
          accountKey: itemAccountKey,
          canvasProjectId: accepted.projectId,
          lastSubmittedAt: Math.max(Number(currentBinding.lastSubmittedAt) || 0, Number(accepted.submittedAt) || 0),
        };
      });
      updatePending(dreaminaAgentQueueSubmitId(item.id), {
        queueState: 'confirming',
        canCancel: false,
        submissionAccepted: true,
        lastError: '官网已接收该分镜，正在等待可跟踪的历史任务 ID',
        lastAttemptAt: new Date().toISOString(),
      });
    },
  }))[0];

  if (result?.ok) {
    try {
      completeDreaminaAgentQueueItem(submitting, result, cfg);
    } catch (error) {
      const latest = mutateDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id, (current) => {
        current.submission = current.submission || result;
      }) || submitting;
      markDreaminaAgentQueueRetry(latest, error.message || error, { confirming: true });
    }
    return;
  }

  const accepted = result?.submissionAccepted;
  if (accepted?.projectId && accepted?.conversationId) {
    const latest = mutateDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id, (current, episode) => {
      current.submission = { ...accepted, accountId: item.accountId };
      const currentBinding = episode.accountBindings[item.accountId] || {};
      episode.accountBindings[item.accountId] = {
        accountKey: itemAccountKey,
        canvasProjectId: accepted.projectId,
        lastSubmittedAt: Math.max(Number(currentBinding.lastSubmittedAt) || 0, Number(accepted.submittedAt) || 0),
      };
    }) || submitting;
    markDreaminaAgentQueueRetry(latest, result.error, { confirming: true });
  } else if (isPermanentDreaminaAgentQueueError(result?.error)) {
    markDreaminaAgentQueueFailure(submitting, result.error, cfg);
  } else {
    markDreaminaAgentQueueRetry(submitting, result?.error);
  }
}

function scheduleDreaminaAgentQueue(delayMs = 0) {
  if (dreaminaAgentQueueTimer) clearTimeout(dreaminaAgentQueueTimer);
  dreaminaAgentQueueTimer = setTimeout(() => {
    dreaminaAgentQueueTimer = null;
    startDreaminaAgentSubmissionQueue();
  }, Math.max(0, delayMs));
  dreaminaAgentQueueTimer.unref?.();
}

async function runDreaminaAgentSubmissionQueue() {
  const cfg = loadConfig();
  while (true) {
    const items = listDreaminaAgentQueueItems();
    if (!items.length) return;
    const now = Date.now();
    const item = items.find((candidate) => Number(candidate.nextAttemptAt) <= now);
    if (!item) {
      const nextAt = Math.min(...items.map((candidate) => Number(candidate.nextAttemptAt) || now));
      scheduleDreaminaAgentQueue(Math.max(1000, nextAt - now));
      return;
    }
    try {
      await processOneDreaminaAgentQueueItem(item, cfg);
    } catch (error) {
      const latest = mutateDreaminaAgentQueueItem(item.projectId, item.episodeId, item.id, () => {});
      if (!latest) continue;
      if (latest.submission?.projectId && latest.submission?.conversationId) {
        markDreaminaAgentQueueRetry(latest, error.message || error, { confirming: true });
      } else if (isPermanentDreaminaAgentQueueError(error.message || error)) {
        markDreaminaAgentQueueFailure(latest, error.message || error, cfg);
      } else {
        markDreaminaAgentQueueRetry(latest, error.message || error);
      }
    }
  }
}

export function startDreaminaAgentSubmissionQueue() {
  if (dreaminaAgentQueueRunner) return dreaminaAgentQueueRunner;
  const releaseQueueLock = acquireDreaminaAgentQueueLock();
  if (!releaseQueueLock) return Promise.resolve();
  dreaminaAgentQueueRunner = runDreaminaAgentSubmissionQueue()
    .catch((error) => console.warn(`[dreamina-agent] queue paused: ${error.message}`))
    .finally(() => {
      releaseQueueLock();
      dreaminaAgentQueueRunner = null;
    });
  return dreaminaAgentQueueRunner;
}

export function cancelDreaminaAgentQueuedShot(projectId, episodeId, shotNo) {
  let removedItems = [];
  mutateDreaminaAgentEpisode(projectId, episodeId, (episode) => {
    removedItems = (episode.queue || []).filter((item) => String(item.task?.shotNo) === String(shotNo));
    episode.queue = (episode.queue || []).filter((item) => String(item.task?.shotNo) !== String(shotNo));
    delete episode.failures[String(shotNo)];
  });
  cancelDreaminaAgentQueueJobs(removedItems);
  return removedItems.length;
}

export function cancelDreaminaAgentQueuedProject(projectId, episodeId = null) {
  const state = loadDreaminaAgentState(projectId);
  const removedItems = [];
  for (const [key, episode] of Object.entries(state.episodes)) {
    if (episodeId != null && String(key) !== String(episodeId)) continue;
    removedItems.push(...(episode.queue || []));
    episode.queue = [];
    episode.failures = {};
    episode.updatedAt = new Date().toISOString();
  }
  if (removedItems.length || episodeId == null || state.episodes[String(episodeId)]) saveDreaminaAgentState(projectId, state);
  cancelDreaminaAgentQueueJobs(removedItems);
  return removedItems.length;
}

function hasDreaminaAgentSubmission(item = {}) {
  return Boolean(item.submission?.projectId && item.submission?.conversationId);
}

function isDreaminaAgentQueueItemSafelyCancelable(item = {}) {
  if (hasDreaminaAgentSubmission(item)) return false;
  return ['queued', 'retry_wait'].includes(String(item.status || 'queued'));
}

function finishCancelledDreaminaAgentQueueItems(items = []) {
  for (const item of items) {
    removePending(dreaminaAgentQueueSubmitId(item.id));
    updateDreaminaAgentQueueJobs(item, {
      ok: false,
      cancelled: true,
      error: '已取消（尚未发送到官网）',
    }, '', { reconcile: false });
  }
}

export function cancelDreaminaAgentUnsubmittedShot(projectId, episodeId, shotNo) {
  const state = loadDreaminaAgentState(projectId);
  const episode = state.episodes[String(episodeId)];
  if (!episode) return { cleared: 0, cancelledShotNos: [], preserved: 0 };
  const matching = (episode.queue || []).filter((item) => String(item.task?.shotNo) === String(shotNo));
  const removedItems = matching.filter(isDreaminaAgentQueueItemSafelyCancelable);
  const removedIds = new Set(removedItems.map((item) => item.id));
  if (removedIds.size) {
    episode.queue = (episode.queue || []).filter((item) => !removedIds.has(item.id));
    delete episode.failures[String(shotNo)];
    episode.updatedAt = new Date().toISOString();
    saveDreaminaAgentState(projectId, state);
  }
  finishCancelledDreaminaAgentQueueItems(removedItems);
  return {
    cleared: removedItems.length,
    cancelledShotNos: removedItems.map((item) => item.task.shotNo),
    preserved: matching.length - removedItems.length,
  };
}

export function cancelDreaminaAgentUnsubmittedProject(projectId, episodeId = null) {
  const state = loadDreaminaAgentState(projectId);
  const removedItems = [];
  let preserved = 0;
  let touched = false;
  for (const [key, episode] of Object.entries(state.episodes)) {
    if (episodeId != null && String(key) !== String(episodeId)) continue;
    const cancellable = (episode.queue || []).filter(isDreaminaAgentQueueItemSafelyCancelable);
    const removedIds = new Set(cancellable.map((item) => item.id));
    removedItems.push(...cancellable);
    preserved += (episode.queue || []).length - cancellable.length;
    if (removedIds.size) {
      episode.queue = episode.queue.filter((item) => !removedIds.has(item.id));
      for (const item of cancellable) delete episode.failures[String(item.task?.shotNo)];
      episode.updatedAt = new Date().toISOString();
      touched = true;
    }
  }
  if (touched) saveDreaminaAgentState(projectId, state);
  finishCancelledDreaminaAgentQueueItems(removedItems);
  return {
    cleared: removedItems.length,
    cancelledShotNos: removedItems.map((item) => item.task.shotNo),
    preserved,
  };
}

export function inspectDreaminaAgentSubmissionQueue(projectId) {
  return loadDreaminaAgentState(projectId);
}

async function submitDreaminaAgentBatch({
  projectId,
  episodeId,
  tasks,
  body,
  cfg,
  stageDir,
} = {}) {
  const defaultAccountId = String(body?.accountId || cfg?.video?.dreaminaAgentAccountId || selectedDreaminaAgentAccountId()).trim();
  requireDreaminaAgentAccount(defaultAccountId);
  const jobId = `dreamina_agent_submit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  setJob(jobId, {
    status: 'running',
    phase: 'submit',
    provider: 'dreamina-agent',
    queueManaged: true,
    projectId,
    episodeId,
    title: `即梦 Agent · 第 ${episodeId} 集 · ${tasks.length} 镜头`,
    total: tasks.length,
    shotNos: tasks.map((task) => String(task.shotNo)),
    submitted: 0,
    failed: 0,
    message: `已保存 ${tasks.length} 个分镜到即梦 Agent 发送队列`,
    submits: {},
  });

  try {
    enqueueDreaminaAgentVideoTasks({ projectId, episodeId, tasks, jobId, accountId: defaultAccountId });
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    startDreaminaAgentSubmissionQueue();
  } catch (error) {
    setJob(jobId, {
      status: 'error',
      provider: 'dreamina-agent',
      failed: tasks.length,
      processed: tasks.length,
      message: `保存即梦 Agent 发送队列失败：${error.message}`,
      error: error.message,
    });
    throw error;
  }

  return { jobId };
}

let updreamSubmissionQueueRunning = false;
const UPDREAM_SUBMISSION_QUEUE_LOCK_PATH = path.join(DATA_DIR, '.updream-video-queue.lock');
const UPDREAM_QUEUE_RETRY_BASE_MS = 15 * 1000;
const UPDREAM_QUEUE_RETRY_MAX_MS = 5 * 60 * 1000;

function isUpdreamQueueFullError(error) {
  const message = String(error?.message || error || '').trim();
  return /(?:视频任务)?排队(?:已)?满|队列已满|queue\s*(?:is\s*)?full|queue\s*capacity|too many\s*(?:queued|pending)|concurrency\s*limit/i.test(message);
}

function updreamQueueRetryDelay(attempts) {
  const count = Math.max(1, Number(attempts) || 1);
  return Math.min(
    UPDREAM_QUEUE_RETRY_MAX_MS,
    UPDREAM_QUEUE_RETRY_BASE_MS * (2 ** Math.max(0, Math.min(5, count - 1))),
  );
}

function markUpdreamQueueRetry(record, error) {
  const current = listPending().find((task) => task.submitId === record.submitId);
  if (!current) return false;
  const attempts = (Number(current.queueRetryCount) || 0) + 1;
  const nextAttemptAt = Date.now() + updreamQueueRetryDelay(attempts);
  const message = String(error?.message || error || 'UpDream 视频队列暂时已满').trim();
  updatePending(record.submitId, {
    status: 'submitting',
    queueState: 'waiting',
    queueRetryCount: attempts,
    nextAttemptAt,
    canCancel: true,
    lastError: `${message}；已有任务完成后自动重试`,
    lastAttemptAt: new Date().toISOString(),
    progress: 1,
  });
  refreshUpdreamQueueJob(record.jobId);
  return true;
}

function acquireUpdreamSubmissionQueueLock() {
  return acquireProcessFileLock(UPDREAM_SUBMISSION_QUEUE_LOCK_PATH);
}

function updreamQueueTasksForJob(jobId) {
  return listPending().filter((task) => task.provider === 'updream' && task.jobId === jobId);
}

function refreshUpdreamQueueJob(jobId, { allowTerminal = false } = {}) {
  const current = getJob(jobId);
  if (!current) return;
  const tasks = updreamQueueTasksForJob(jobId);
  const waiting = tasks.filter(isUpdreamWaitingTask);
  const active = tasks.filter(isUpdreamActiveTask);
  const retryWaiting = waiting.filter((task) => Number(task.nextAttemptAt) > Date.now()).length;
  const submitted = Number(current.submitted) || 0;
  const failed = Number(current.failed) || 0;
  const total = Number(current.total) || (submitted + failed + waiting.length);
  const terminal = allowTerminal && waiting.length === 0;
  const status = terminal ? (submitted > 0 ? 'done' : 'error') : 'running';
  const firstError = String(current.firstError || current.error || '').trim();
  const slots = [
    ...active.map((task) => ({
      state: 'submitting',
      currentShot: { shotNo: task.shotNo },
      progress: Number(task.progress) || 6,
      note: 'UpDream 生成中',
      accountId: task.submitId,
      accountName: 'UpDream',
    })),
    ...waiting.map((task) => ({
      state: task.queueState === 'submitting' ? 'submitting' : 'waiting',
      currentShot: { shotNo: task.shotNo },
      progress: task.queueState === 'submitting' ? 3 : 1,
      note: task.queueState === 'submitting'
        ? '正在提交 UpDream'
        : (task.lastError || '等待并发空位'),
      accountId: task.submitId,
      accountName: 'UpDream',
    })),
  ];
  const message = terminal
    ? (submitted > 0
        ? `已提交 ${submitted}/${total} 到 UpDream，生成完成后自动拉回`
        : `UpDream 提交失败：${firstError || '没有任务提交成功'}`)
    : `UpDream：已提交 ${submitted}/${total}，生成中 ${active.length}，等待 ${waiting.length}`
      + (retryWaiting ? `（${retryWaiting} 个等待平台空位）` : '');
  setJob(jobId, {
    status,
    provider: 'updream',
    processed: submitted + failed,
    slots,
    message,
    error: status === 'error' ? (firstError || '没有任务提交成功') : '',
  });
}

function updateUpdreamQueueJobResult(record, result) {
  const jobId = String(record.jobId || '');
  const current = getJob(jobId);
  if (!current) return;
  const submits = { ...(current.submits || {}) };
  const key = String(record.shotNo);
  if (!submits[key]) {
    submits[key] = result.ok
      ? { ok: true, submitId: result.submitId }
      : { ok: false, error: result.error || 'UpDream 视频提交失败' };
    setJob(jobId, {
      submits,
      submitted: (Number(current.submitted) || 0) + (result.ok ? 1 : 0),
      failed: (Number(current.failed) || 0) + (result.ok ? 0 : 1),
      firstError: current.firstError || (result.ok ? '' : (result.error || 'UpDream 视频提交失败')),
    });
  }
  refreshUpdreamQueueJob(jobId, { allowTerminal: true });
}

function completeUpdreamQueueRecord(record, result, cfg) {
  const current = listPending().find((task) => task.submitId === record.submitId);
  if (result.ok && result.submitId) {
    const changes = {
      submitId: result.submitId,
      historyId: result.historyId || null,
      status: 'queued',
      queuePayload: null,
      queueState: '',
      canCancel: false,
      lastError: '',
      queueRetryCount: 0,
      nextAttemptAt: 0,
      progress: 6,
      remoteDone: false,
      submittedAt: Date.now(),
    };
    // Missing means the user explicitly cancelled this queue record while the
    // provider request was in flight. Do not recreate result tracking after it
    // has been cut from the shot card.
    if (current) updatePending(record.submitId, changes);
    recordVideoSubmission({
      cfg,
      projectId: record.projectId,
      episodeId: record.episodeId,
      provider: 'updream',
      model: result.model || record.queuePayload?.model || cfg.video?.updreamModel || 'sed2-fast',
      task: record.queuePayload?.task,
      fallbackDuration: record.queuePayload?.fallbackDuration,
    });
  } else {
    const error = result.error || 'UpDream 视频提交失败';
    if (isUpdreamQueueFullError(error) && markUpdreamQueueRetry(record, error)) return;
    if (current) {
      updatePending(record.submitId, {
        status: 'failed',
        queuePayload: null,
        queueState: '',
        queueRetryCount: 0,
        nextAttemptAt: 0,
        lastError: error,
        lastAttemptAt: new Date().toISOString(),
      });
    }
    recordVideoSubmission({
      cfg,
      projectId: record.projectId,
      episodeId: record.episodeId,
      provider: 'updream',
      model: record.queuePayload?.task?.model || record.queuePayload?.model || cfg.video?.updreamModel || 'sed2-fast',
      task: record.queuePayload?.task,
      fallbackDuration: record.queuePayload?.fallbackDuration,
      status: 'failed',
      error,
    });
  }
  updateUpdreamQueueJobResult(record, result);
}

function updreamQueueGroupKey(record) {
  const payload = record.queuePayload || {};
  return JSON.stringify([
    record.projectId,
    record.episodeId,
    payload.projectName || '',
    payload.model || '',
    payload.resolution || '',
  ]);
}

async function submitUpdreamQueueGroup(records, cfg) {
  const first = records[0];
  const payload = first.queuePayload || {};
  let results;
  try {
    results = await submitUpdreamVideos({
      config: cfg.video || {},
      projectName: payload.projectName || first.projectId,
      episodeId: first.episodeId,
      shots: records.map((record) => record.queuePayload.task),
      model: payload.model || cfg.video?.updreamModel || 'sed2-fast',
      resolution: payload.resolution || cfg.video?.resolution || '480p',
      concurrency: records.length,
      onProgress: (message) => {
        for (const jobId of new Set(records.map((record) => record.jobId).filter(Boolean))) {
          setJob(jobId, { message });
        }
      },
      onTokens: persistUpdreamTokens,
    });
  } catch (error) {
    results = records.map((record) => ({
      ok: false,
      shotNo: record.shotNo,
      error: error?.message || String(error),
    }));
  }
  records.forEach((record, index) => {
    completeUpdreamQueueRecord(record, results[index] || {
      ok: false,
      shotNo: record.shotNo,
      error: 'UpDream 未返回提交结果',
    }, cfg);
  });
}

function cleanupUpdreamQueueStageDirs(records) {
  const directories = new Set(records.map((record) => record.queuePayload?.stageDir).filter(Boolean));
  const waiting = listPending().filter(isUpdreamWaitingTask);
  for (const directory of directories) {
    if (waiting.some((task) => task.queuePayload?.stageDir === directory)) continue;
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function cancelUpdreamQueuedShot(projectId, episodeId, shotNo) {
  const record = listPending().find((task) => (
    isUpdreamWaitingTask(task)
    && task.projectId === projectId
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  if (!record) return false;
  removePending(record.submitId);
  updateUpdreamQueueJobResult(record, { ok: false, error: '已取消' });
  cleanupUpdreamQueueStageDirs([record]);
  return true;
}

export function cancelUpdreamQueuedProject(projectId, episodeId = null) {
  const records = listPending().filter((task) => (
    isUpdreamWaitingTask(task)
    && task.projectId === projectId
    && (episodeId == null || String(task.episodeId) === String(episodeId))
  ));
  for (const record of records) {
    removePending(record.submitId);
    updateUpdreamQueueJobResult(record, { ok: false, error: '已取消' });
  }
  cleanupUpdreamQueueStageDirs(records);
  return records.length;
}

function isSafelyWaitingProviderTask(task, predicate) {
  return predicate(task) && String(task.queueState || 'waiting') === 'waiting';
}

export function cancelUpdreamUnsubmittedShot(projectId, episodeId, shotNo) {
  const matching = listPending().filter((task) => (
    isUpdreamWaitingTask(task)
    && task.projectId === projectId
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  const records = matching.filter((task) => isSafelyWaitingProviderTask(task, isUpdreamWaitingTask));
  for (const record of records) {
    removePending(record.submitId);
    updateUpdreamQueueJobResult(record, { ok: false, error: '已取消（尚未发送到官网）' });
  }
  cleanupUpdreamQueueStageDirs(records);
  return { cleared: records.length, cancelledShotNos: records.map((record) => record.shotNo), preserved: matching.length - records.length };
}

export function cancelUpdreamUnsubmittedProject(projectId, episodeId = null) {
  const matching = listPending().filter((task) => (
    isUpdreamWaitingTask(task)
    && task.projectId === projectId
    && (episodeId == null || String(task.episodeId) === String(episodeId))
  ));
  const records = matching.filter((task) => isSafelyWaitingProviderTask(task, isUpdreamWaitingTask));
  for (const record of records) {
    removePending(record.submitId);
    updateUpdreamQueueJobResult(record, { ok: false, error: '已取消（尚未发送到官网）' });
  }
  cleanupUpdreamQueueStageDirs(records);
  return { cleared: records.length, cancelledShotNos: records.map((record) => record.shotNo), preserved: matching.length - records.length };
}

export function startUpdreamSubmissionQueue() {
  if (updreamSubmissionQueueRunning) return false;
  const releaseQueueLock = acquireUpdreamSubmissionQueueLock();
  if (!releaseQueueLock) return false;
  const cfg = loadConfig();
  const plan = planUpdreamQueue(listPending(), cfg.video?.updreamConcurrency || 2);
  if (!plan.selected.length) {
    releaseQueueLock();
    for (const jobId of new Set(plan.waiting.map((task) => task.jobId).filter(Boolean))) {
      refreshUpdreamQueueJob(jobId);
    }
    return false;
  }

  updreamSubmissionQueueRunning = true;
  for (const record of plan.selected) {
    updatePending(record.submitId, {
      queueState: 'submitting',
      canCancel: false,
      nextAttemptAt: 0,
      lastError: '正在提交 UpDream',
      lastAttemptAt: new Date().toISOString(),
    });
  }
  for (const jobId of new Set(plan.selected.map((task) => task.jobId).filter(Boolean))) {
    refreshUpdreamQueueJob(jobId);
  }

  const groups = new Map();
  for (const record of plan.selected) {
    const key = updreamQueueGroupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  void Promise.all([...groups.values()].map((records) => submitUpdreamQueueGroup(records, cfg)))
    .finally(() => {
      cleanupUpdreamQueueStageDirs(plan.selected);
      updreamSubmissionQueueRunning = false;
      releaseQueueLock();
      startUpdreamSubmissionQueue();
    });
  return true;
}

async function submitUpdreamBatch({
  projectId,
  episodeId,
  tasks,
  body,
  cfg,
  stageDir,
} = {}) {
  const jobId = `updream_submit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const project = loadProject(projectId);
  const projectName = project?.name || project?.title || projectId;
  const model = body.model || cfg.video?.updreamModel || 'sed2-fast';
  const resolution = body.resolution || cfg.video?.resolution || '480p';
  const pendingTasks = listPending();
  const activeTasks = [];
  const skippedSubmits = {};
  const seenShots = new Set();
  for (const task of tasks) {
    const shotKey = String(task.shotNo);
    const pending = findActiveUpdreamTaskForShot(pendingTasks, projectId, episodeId, task.shotNo);
    if (pending || seenShots.has(shotKey)) {
      skippedSubmits[shotKey] = {
        ok: true,
        skipped: true,
        ...(pending?.submitId ? { submitId: pending.submitId } : {}),
        error: '该镜头已在 UpDream 队列或生成中，已跳过重复提交',
      };
      continue;
    }
    seenShots.add(shotKey);
    activeTasks.push(task);
  }

  if (!activeTasks.length) {
    const skipped = Object.keys(skippedSubmits).length;
    setJob(jobId, {
      status: 'done',
      phase: 'submit',
      provider: 'updream',
      queueManaged: true,
      projectId,
      episodeId,
      title: `视频提交 · 第 ${episodeId} 集`,
      total: skipped,
      processed: skipped,
      submitted: 0,
      failed: 0,
      skipped,
      message: '这些镜头已在 UpDream 队列或生成中，已跳过重复提交',
      submits: skippedSubmits,
    });
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { jobId, skipped };
  }

  setJob(jobId, {
    status: 'running',
    phase: 'submit',
    provider: 'updream',
    queueManaged: true,
    projectId,
    episodeId,
    title: `视频提交 · 第 ${episodeId} 集 · ${activeTasks.length} 镜头`,
    total: activeTasks.length + Object.keys(skippedSubmits).length,
    processed: 0,
    submitted: 0,
    failed: 0,
    shotNos: activeTasks.map((task) => String(task.shotNo)),
    skipped: Object.keys(skippedSubmits).length,
    message: `已加入 UpDream 队列，共 ${activeTasks.length} 个镜头`,
    submits: { ...skippedSubmits },
  });

  const queueBase = Date.now() * 1000;
  activeTasks.forEach((task, index) => {
    addPending({
      projectId,
      episodeId,
      shotNo: task.shotNo,
      submitId: `updream-queue:${jobId}:${String(task.shotNo)}:${index}`,
      accountId: 'updream',
      provider: 'updream',
      status: 'submitting',
      lastError: '等待并发空位',
      queueState: 'waiting',
      canCancel: true,
      queueOrder: queueBase + index,
      jobId,
      progress: 1,
      queuePayload: {
        projectName,
        task,
        model,
        resolution,
        fallbackDuration: body.duration,
        stageDir,
      },
    });
  });
  refreshUpdreamQueueJob(jobId);
  startUpdreamSubmissionQueue();
  return { jobId };
}

function trackLibtvRecovery({ projectId, episodeId, task, result, error = '' } = {}) {
  const submitId = String(result?.submitId || result?.historyId || '').trim();
  const remoteProjectId = String(result?.remoteProjectId || '').trim();
  if (!submitId || !remoteProjectId) return null;
  return addPending({
    projectId,
    episodeId,
    shotNo: task?.shotNo ?? result?.shotNo,
    submitId,
    historyId: result?.historyId || submitId,
    accountId: 'libtv-local',
    provider: 'libtv-cli',
    remoteProjectId,
    videoUrl: result?.videoUrl || '',
    videoUrls: result?.videoUrls || [],
    lastError: String(error || result?.error || 'LibTV 视频下载失败'),
  });
}

async function submitLibtvBatch({
  projectId,
  episodeId,
  tasks,
  body,
  cfg,
  stageDir,
  } = {}) {
  const jobId = `libtv_submit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  setJob(jobId, {
    status: 'running',
    phase: 'generate',
    provider: 'libtv-cli',
    projectId,
    episodeId,
    title: `视频生成 · 第 ${episodeId} 集 · ${tasks.length} 镜头`,
    total: tasks.length,
    submitted: 0,
    failed: 0,
    shotNos: tasks.map((task) => String(task.shotNo)),
    message: '开始调用 LibTV CLI...',
    submits: {},
  });

  (async () => {
    const usageRecordedShots = new Set();
    try {
      const results = await submitLibtvVideos({
        config: cfg.video || {},
        projectUuid: cfg.video?.libtvProjectUuid,
        episodeId,
        shots: tasks,
        model: body.model || cfg.video?.libtvModel || 'Seedance 2.0 VIP',
        concurrency: body.concurrency ?? cfg.video?.libtvConcurrency ?? 3,
        onProgress: (message) => setJob(jobId, { message }),
        onSubmitProgress: (status) => setJob(jobId, status),
      });
      let submitted = 0;
      let failed = 0;
      const submits = {};
      for (const result of results) {
        const task = tasks.find((item) => String(item.shotNo) === String(result.shotNo));
        try {
          if (isPendingTrackingStopped(projectId, episodeId, result.shotNo)) {
            submits[result.shotNo] = {
              ok: false,
              cancelled: true,
              ignored: true,
              error: '已从视频卡片强制移除排队与追踪',
            };
            continue;
          }
          if (result.ok && hasProviderVideoSource(result)) {
            await saveVideoFromProviderResult(projectId, episodeId, result.shotNo, result);
            const localUrl = videoLocalUrl(projectId, episodeId, result.shotNo);
            if (!persistShotVideo(projectId, episodeId, result.shotNo, localUrl)) throw new Error('视频已生成，但项目记录写入失败');
            submits[result.shotNo] = { ok: true, submitId: result.submitId, videoUrl: localUrl };
            submitted += 1;
            recordVideoSubmission({
              cfg,
              projectId,
              episodeId,
              provider: 'libtv-cli',
              model: result.model || task?.model || body.model || cfg.video?.libtvModel || '',
              task,
              fallbackDuration: body.duration,
            });
          } else if (result.recoverable) {
            trackLibtvRecovery({ projectId, episodeId, task, result });
            throw new Error(result.error || 'LibTV 视频已生成，但下载失败，已加入重新抓取队列');
          } else {
            throw new Error(result.error || 'LibTV 视频生成失败');
          }
        } catch (error) {
          if (result?.recoverable === false || result?.ok) {
            trackLibtvRecovery({ projectId, episodeId, task, result, error: error.message });
          }
          submits[result.shotNo] = { ok: false, error: error.message };
          failed += 1;
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'libtv-cli',
            model: task?.model || body.model || cfg.video?.libtvModel || '',
            task,
            fallbackDuration: body.duration,
            status: 'failed',
            error: error.message,
          });
        } finally {
          usageRecordedShots.add(String(result.shotNo));
          if (result.cleanupDir) {
            try { fs.rmSync(result.cleanupDir, { recursive: true, force: true }); } catch { /* best effort */ }
          }
        }
      }
      const firstError = Object.values(submits).find((item) => item && item.ok === false)?.error || '';
      setJob(jobId, {
        status: submitted > 0 ? 'done' : 'error',
        provider: 'libtv-cli',
        submitted,
        failed,
        processed: submitted + failed,
        submits,
        message: submitted > 0
          ? `LibTV 已生成并拉回 ${submitted}/${tasks.length} 个视频`
          : `LibTV 生成失败：${firstError || '没有视频生成成功'}`,
        error: submitted > 0 ? '' : (firstError || '没有视频生成成功'),
      });
    } catch (error) {
      for (const task of tasks) {
        if (usageRecordedShots.has(String(task.shotNo))) continue;
        recordVideoSubmission({
          cfg,
          projectId,
          episodeId,
          provider: 'libtv-cli',
          model: task?.model || body.model || cfg.video?.libtvModel || '',
          task,
          fallbackDuration: body.duration,
          status: 'failed',
          error: error.message,
        });
      }
      setJob(jobId, { status: 'error', provider: 'libtv-cli', error: error.message, message: error.message });
    } finally {
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  })();

  return { jobId };
}

let neowowSubmissionQueueRunning = false;
const NEOWOW_SUBMISSION_QUEUE_LOCK_PATH = path.join(DATA_DIR, '.neowow-video-queue.lock');

function neowowQueueTasksForJob(jobId) {
  return listPending().filter((task) => task.provider === 'neowow' && task.jobId === jobId);
}

function normalizedNeowowAccountId(accountId = '') {
  return findNeowowAccount(accountId)?.id || '';
}

function requireUsableNeowowAccount(accountId = '') {
  const account = requireNeowowAccount(accountId, { requireToken: true });
  if (account.enabled === false) throw new Error(`${account.name} 已停用，请启用或选择其他账号`);
  if (account.status === 'logging_in') throw new Error(`${account.name} 正在登录，请完成登录后再提交`);
  if (['expired', 'invalid', 'logged_out'].includes(account.status)) {
    throw new Error(`${account.name} 登录已失效，请重新登录`);
  }
  if (account.points != null && account.points <= 0) throw new Error(`${account.name} 积分不足`);
  return account;
}

function isNeowowAuthError(error) {
  return ['AUTH_EXPIRED', 'AUTH_MISSING'].includes(error?.code) || Number(error?.status) === 401;
}

function assignNeowowAccounts(tasks = [], preferredAccountId = '', pendingTasks = listPending()) {
  if (!tasks.length) return [];
  const available = usableNeowowAccounts();
  if (!available.length) throw new Error('没有可用的 Neowow 账号，请先登录并确认账号有可用积分');
  const byId = new Map(available.map((account) => [account.id, account]));
  const load = new Map(available.map((account) => [account.id, 0]));
  for (const pending of pendingTasks) {
    if (pending.provider !== 'neowow' || !['queued', 'submitting'].includes(pending.status)) continue;
    const id = normalizedNeowowAccountId(pending.accountId);
    if (load.has(id)) load.set(id, load.get(id) + 1);
  }
  const preferred = String(preferredAccountId || '').trim();
  return tasks.map((task) => {
    const requested = String(task.accountId || preferred).trim();
    let account;
    let accountMode = 'auto';
    if (requested) {
      account = requireUsableNeowowAccount(requested);
      accountMode = 'manual';
    } else {
      account = [...available].sort((left, right) => (
        (load.get(left.id) || 0) - (load.get(right.id) || 0)
        || String(left.addedAt || '').localeCompare(String(right.addedAt || ''))
        || left.id.localeCompare(right.id)
      ))[0];
    }
    if (!byId.has(account.id)) throw new Error(`${account.name} 当前不可用于自动分配`);
    load.set(account.id, (load.get(account.id) || 0) + 1);
    return { ...task, accountId: account.id, neowowAccountMode: accountMode };
  });
}

function planNeowowAccountQueue(tasks = [], concurrency = 15) {
  const limit = Math.max(1, Math.floor(Number(concurrency) || 15));
  const available = usableNeowowAccounts();
  const availableIds = new Set(available.map((account) => account.id));
  const activeByAccount = new Map(available.map((account) => [account.id, 0]));
  const active = tasks.filter(isNeowowActiveTask);
  for (const task of active) {
    const id = normalizedNeowowAccountId(task.accountId);
    if (activeByAccount.has(id)) activeByAccount.set(id, activeByAccount.get(id) + 1);
  }
  const waiting = tasks.filter(isNeowowWaitingTask).sort((left, right) => (
    (Number(left.queueOrder) || Number(left.createdAt) || 0) - (Number(right.queueOrder) || Number(right.createdAt) || 0)
    || String(left.submitId || '').localeCompare(String(right.submitId || ''))
  ));
  const selected = [];
  for (const task of waiting) {
    let id = normalizedNeowowAccountId(task.accountId);
    const automatic = task.queuePayload?.accountMode === 'auto';
    if (automatic && !availableIds.has(id)) {
      const replacement = [...available].sort((left, right) => (
        (activeByAccount.get(left.id) || 0) - (activeByAccount.get(right.id) || 0)
        || left.id.localeCompare(right.id)
      ))[0];
      if (replacement) {
        id = replacement.id;
        updatePending(task.submitId, { accountId: id });
        task.accountId = id;
      }
    }
    if (!availableIds.has(id) || (activeByAccount.get(id) || 0) >= limit) continue;
    selected.push(task);
    activeByAccount.set(id, (activeByAccount.get(id) || 0) + 1);
  }
  return { limit, active, waiting, selected };
}

function refreshNeowowQueueJob(jobId, { allowTerminal = false } = {}) {
  const current = getJob(jobId);
  if (!current) return;
  const tasks = neowowQueueTasksForJob(jobId);
  const waiting = tasks.filter(isNeowowWaitingTask);
  const active = tasks.filter(isNeowowActiveTask);
  const submitted = Number(current.submitted) || 0;
  const failed = Number(current.failed) || 0;
  const total = Number(current.total) || (submitted + failed + waiting.length);
  const terminal = allowTerminal && waiting.length === 0;
  const status = terminal ? (submitted > 0 ? 'done' : 'error') : 'running';
  const firstError = String(current.firstError || current.error || '').trim();
  const slots = [
    ...active.map((task) => ({
      state: 'submitting',
      currentShot: { shotNo: task.shotNo },
      progress: Number(task.progress) || 6,
      note: 'Neowow 生成中',
      accountId: task.accountId,
      accountName: findNeowowAccount(task.accountId)?.name || 'Neowow',
    })),
    ...waiting.map((task) => ({
      state: task.queueState === 'submitting' ? 'submitting' : 'waiting',
      currentShot: { shotNo: task.shotNo },
      progress: task.queueState === 'submitting' ? 3 : 1,
      note: task.queueState === 'submitting' ? '正在提交 Neowow' : '等待并发空位',
      accountId: task.accountId,
      accountName: findNeowowAccount(task.accountId)?.name || 'Neowow',
    })),
  ];
  const message = terminal
    ? (submitted > 0
        ? `已提交 ${submitted}/${total} 到 Neowow，生成完成后自动拉回`
        : `Neowow 提交失败：${firstError || '没有任务提交成功'}`)
    : `Neowow：已提交 ${submitted}/${total}，生成中 ${active.length}，等待 ${waiting.length}`;
  setJob(jobId, {
    status,
    provider: 'neowow',
    processed: submitted + failed,
    slots,
    message,
    error: status === 'error' ? (firstError || '没有任务提交成功') : '',
  });
}

function updateNeowowQueueJobResult(record, result) {
  const jobId = String(record.jobId || '');
  const current = getJob(jobId);
  if (!current) return false;
  const submits = { ...(current.submits || {}) };
  const key = String(record.shotNo);
  if (submits[key]) return false;
  submits[key] = result.ok
    ? { ok: true, submitId: result.submitId, ...(result.error ? { warning: result.error } : {}) }
    : { ok: false, error: result.error || 'Neowow 视频提交失败' };
  setJob(jobId, {
    submits,
    submitted: (Number(current.submitted) || 0) + (result.ok ? 1 : 0),
    failed: (Number(current.failed) || 0) + (result.ok ? 0 : 1),
    firstError: current.firstError || (result.ok ? '' : (result.error || 'Neowow 视频提交失败')),
  });
  refreshNeowowQueueJob(jobId, { allowTerminal: true });
  return true;
}

function completeNeowowQueueRecord(record, result, cfg) {
  const resolved = result?.ok !== false && Boolean(result?.submitId);
  const normalizedResult = resolved
    ? { ...result, ok: true }
    : { ...result, ok: false, error: result?.error || 'Neowow 视频提交失败' };
  const currentJob = getJob(record.jobId);
  if (!currentJob || currentJob.submits?.[String(record.shotNo)]) return;

  const current = listPending().find((task) => task.submitId === record.submitId);
  if (resolved) {
    const changes = {
      submitId: normalizedResult.submitId,
      historyId: normalizedResult.historyId || null,
      sessionId: normalizedResult.sessionId || '',
      remoteProjectId: normalizedResult.sessionId || '',
      status: 'queued',
      queuePayload: null,
      queueState: '',
      canCancel: false,
      lastError: '',
      progress: 6,
      remoteDone: false,
      submittedAt: Date.now(),
    };
    if (current) {
      updatePending(record.submitId, changes);
    } else {
      const replacement = listPending().find((task) => (
        task.provider === 'neowow'
        && task.projectId === record.projectId
        && String(task.episodeId) === String(record.episodeId)
        && String(task.shotNo) === String(record.shotNo)
      ));
      if (!replacement) {
        addPending({
          projectId: record.projectId,
          episodeId: record.episodeId,
          shotNo: record.shotNo,
          submitId: normalizedResult.submitId,
          historyId: normalizedResult.historyId,
          sessionId: normalizedResult.sessionId,
          remoteProjectId: normalizedResult.sessionId,
          accountId: record.accountId,
          provider: 'neowow',
          jobId: record.jobId,
          progress: 6,
        });
      }
    }
  } else if (current) {
    updatePending(record.submitId, {
      status: 'failed',
      queuePayload: null,
      queueState: '',
      lastError: normalizedResult.error,
      lastAttemptAt: new Date().toISOString(),
    });
  }

  recordVideoSubmission({
    cfg,
    projectId: record.projectId,
    episodeId: record.episodeId,
    provider: 'neowow',
    model: normalizedResult.model || record.queuePayload?.model || cfg.video?.neowowModel || 'neo-video-2-0-fast',
    task: record.queuePayload?.task,
    fallbackDuration: record.queuePayload?.fallbackDuration,
    status: resolved ? 'success' : 'failed',
    error: resolved ? '' : normalizedResult.error,
  });
  updateNeowowQueueJobResult(record, normalizedResult);
}

function neowowQueueGroupKey(record) {
  const payload = record.queuePayload || {};
  return JSON.stringify([
    record.accountId || '',
    record.projectId,
    record.episodeId,
    payload.projectName || '',
    payload.model || '',
    payload.resolution || '',
  ]);
}

async function submitNeowowQueueGroup(records, cfg) {
  const first = records[0];
  const payload = first.queuePayload || {};
  let account = null;
  const recordsByShot = new Map(records.map((record) => [String(record.shotNo), record]));
  let results;
  try {
    account = requireUsableNeowowAccount(first.accountId);
    results = await submitNeowowVideos({
      config: neowowConfigForAccount(account.id, cfg),
      projectName: payload.projectName || first.projectId,
      episodeId: first.episodeId,
      shots: records.map((record) => record.queuePayload.task),
      model: payload.model || cfg.video?.neowowModel || 'neo-video-2-0-fast',
      resolution: payload.resolution || cfg.video?.resolution || '480p',
      onProgress: (message) => {
        for (const jobId of new Set(records.map((record) => record.jobId).filter(Boolean))) {
          setJob(jobId, { message });
        }
      },
      onTaskSubmitted: (result) => {
        const record = recordsByShot.get(String(result.shotNo));
        if (record) completeNeowowQueueRecord(record, result, cfg);
      },
    });
  } catch (error) {
    results = records.map((record) => ({
      ok: false,
      shotNo: record.shotNo,
      error: error?.message || String(error),
    }));
  }
  for (const result of results) {
    const record = recordsByShot.get(String(result.shotNo));
    if (record) completeNeowowQueueRecord(record, result, cfg);
  }
  for (const record of records) {
    completeNeowowQueueRecord(record, {
      ok: false,
      shotNo: record.shotNo,
      error: 'Neowow 未返回提交结果',
    }, cfg);
  }
  if (account) void refreshNeowowAccount(account.id).catch(() => {});
}

function cleanupNeowowQueueStageDirs(records) {
  const directories = new Set(records.map((record) => record.queuePayload?.stageDir).filter(Boolean));
  const waiting = listPending().filter(isNeowowWaitingTask);
  for (const directory of directories) {
    if (waiting.some((task) => task.queuePayload?.stageDir === directory)) continue;
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function cancelNeowowQueuedShot(projectId, episodeId, shotNo) {
  const record = listPending().find((task) => (
    isNeowowWaitingTask(task)
    && task.projectId === projectId
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  if (!record) return false;
  removePending(record.submitId);
  updateNeowowQueueJobResult(record, { ok: false, error: '已取消' });
  cleanupNeowowQueueStageDirs([record]);
  return true;
}

export function cancelNeowowQueuedProject(projectId, episodeId = null) {
  const records = listPending().filter((task) => (
    isNeowowWaitingTask(task)
    && task.projectId === projectId
    && (episodeId == null || String(task.episodeId) === String(episodeId))
  ));
  for (const record of records) {
    removePending(record.submitId);
    updateNeowowQueueJobResult(record, { ok: false, error: '已取消' });
  }
  cleanupNeowowQueueStageDirs(records);
  return records.length;
}

export function cancelNeowowUnsubmittedShot(projectId, episodeId, shotNo) {
  const matching = listPending().filter((task) => (
    isNeowowWaitingTask(task)
    && task.projectId === projectId
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  const records = matching.filter((task) => isSafelyWaitingProviderTask(task, isNeowowWaitingTask));
  for (const record of records) {
    removePending(record.submitId);
    updateNeowowQueueJobResult(record, { ok: false, error: '已取消（尚未发送到官网）' });
  }
  cleanupNeowowQueueStageDirs(records);
  return { cleared: records.length, cancelledShotNos: records.map((record) => record.shotNo), preserved: matching.length - records.length };
}

export function cancelNeowowUnsubmittedProject(projectId, episodeId = null) {
  const matching = listPending().filter((task) => (
    isNeowowWaitingTask(task)
    && task.projectId === projectId
    && (episodeId == null || String(task.episodeId) === String(episodeId))
  ));
  const records = matching.filter((task) => isSafelyWaitingProviderTask(task, isNeowowWaitingTask));
  for (const record of records) {
    removePending(record.submitId);
    updateNeowowQueueJobResult(record, { ok: false, error: '已取消（尚未发送到官网）' });
  }
  cleanupNeowowQueueStageDirs(records);
  return { cleared: records.length, cancelledShotNos: records.map((record) => record.shotNo), preserved: matching.length - records.length };
}

export function startNeowowSubmissionQueue() {
  if (neowowSubmissionQueueRunning) return false;
  const releaseQueueLock = acquireProcessFileLock(NEOWOW_SUBMISSION_QUEUE_LOCK_PATH);
  if (!releaseQueueLock) return false;
  const cfg = loadConfig();
  const plan = planNeowowAccountQueue(listPending(), cfg.video?.neowowConcurrency || 15);
  if (!plan.selected.length) {
    releaseQueueLock();
    for (const jobId of new Set(plan.waiting.map((task) => task.jobId).filter(Boolean))) {
      refreshNeowowQueueJob(jobId);
    }
    return false;
  }

  neowowSubmissionQueueRunning = true;
  for (const record of plan.selected) {
    updatePending(record.submitId, {
      queueState: 'submitting',
      canCancel: false,
      lastError: '正在提交 Neowow',
      lastAttemptAt: new Date().toISOString(),
    });
  }
  for (const jobId of new Set(plan.selected.map((task) => task.jobId).filter(Boolean))) {
    refreshNeowowQueueJob(jobId);
  }

  const groups = new Map();
  for (const record of plan.selected) {
    const key = neowowQueueGroupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  void Promise.all([...groups.values()].map((records) => submitNeowowQueueGroup(records, cfg)))
    .finally(() => {
      cleanupNeowowQueueStageDirs(plan.selected);
      neowowSubmissionQueueRunning = false;
      releaseQueueLock();
      startNeowowSubmissionQueue();
    });
  return true;
}

async function submitNeowowBatch({
  projectId,
  episodeId,
  tasks,
  body,
  cfg,
  stageDir,
} = {}) {
  const jobId = `neowow_submit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const project = loadProject(projectId);
  const projectName = project?.name || project?.title || projectId;
  const model = body.model || cfg.video?.neowowModel || 'neo-video-2-0-fast';
  const resolution = body.resolution || cfg.video?.resolution || '480p';
  const pendingTasks = listPending();
  let activeTasks = [];
  const skippedSubmits = {};
  const seenShots = new Set();
  for (const task of tasks) {
    const shotKey = String(task.shotNo);
    const pending = findActiveNeowowTaskForShot(pendingTasks, projectId, episodeId, task.shotNo);
    if (pending || seenShots.has(shotKey)) {
      skippedSubmits[shotKey] = {
        ok: true,
        skipped: true,
        ...(pending?.submitId ? { submitId: pending.submitId } : {}),
        error: '该镜头已在 Neowow 队列或生成中，已跳过重复提交',
      };
      continue;
    }
    seenShots.add(shotKey);
    activeTasks.push(task);
  }

  activeTasks = assignNeowowAccounts(activeTasks, body.accountId, pendingTasks);

  if (!activeTasks.length) {
    const skipped = Object.keys(skippedSubmits).length;
    setJob(jobId, {
      status: 'done',
      phase: 'submit',
      provider: 'neowow',
      queueManaged: true,
      projectId,
      episodeId,
      title: `视频提交 · 第 ${episodeId} 集`,
      total: skipped,
      processed: skipped,
      submitted: 0,
      failed: 0,
      skipped,
      message: '这些镜头已在 Neowow 队列或生成中，已跳过重复提交',
      submits: skippedSubmits,
    });
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { jobId, skipped };
  }

  setJob(jobId, {
    status: 'running',
    phase: 'submit',
    provider: 'neowow',
    queueManaged: true,
    projectId,
    episodeId,
    title: `视频提交 · 第 ${episodeId} 集 · ${activeTasks.length} 镜头`,
    total: activeTasks.length + Object.keys(skippedSubmits).length,
    processed: 0,
    submitted: 0,
    failed: 0,
    shotNos: activeTasks.map((task) => String(task.shotNo)),
    skipped: Object.keys(skippedSubmits).length,
    message: `已加入 Neowow 队列，共 ${activeTasks.length} 个镜头`,
    submits: { ...skippedSubmits },
  });

  const queueBase = Date.now() * 1000;
  activeTasks.forEach((task, index) => {
    addPending({
      projectId,
      episodeId,
      shotNo: task.shotNo,
      submitId: `neowow-queue:${jobId}:${String(task.shotNo)}:${index}`,
      accountId: task.accountId,
      provider: 'neowow',
      status: 'submitting',
      lastError: '等待并发空位',
      queueState: 'waiting',
      canCancel: true,
      queueOrder: queueBase + index,
      jobId,
      progress: 1,
      queuePayload: {
        projectName,
        task,
        model,
        resolution,
        fallbackDuration: body.duration,
        stageDir,
        accountMode: task.neowowAccountMode || 'auto',
      },
    });
  });
  refreshNeowowQueueJob(jobId);
  startNeowowSubmissionQueue();
  return { jobId };
}

export async function recoverNeowowPendingShot({ projectId, episodeId, shotNo, accountId: requestedAccountId = '', replaceExisting = false } = {}) {
  const id = String(projectId || '').trim();
  if (!id || episodeId == null || shotNo == null) return { recovered: false };
  const existing = listPending().find((task) => (
    task.projectId === id
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  if (existing && !replaceExisting && !(existing.provider === 'neowow' && existing.status === 'failed')) {
    return { recovered: false, existing: true, task: existing };
  }
  const accountId = normalizedNeowowAccountId(requestedAccountId || existing?.accountId) || selectedNeowowAccountId();
  const project = loadProject(id);
  if (!project) return { recovered: false };
  const cfg = loadConfig();
  const recovered = await recoverNeowowVideoTask({
    config: neowowConfigForAccount(accountId, cfg),
    projectName: project.name || project.title || id,
    episodeId,
    shotNo,
  });
  if (!recovered?.submitId) return { recovered: false };
  addPending({
    projectId: id,
    episodeId,
    shotNo,
    submitId: recovered.submitId,
    historyId: recovered.historyId,
    sessionId: recovered.sessionId,
    remoteProjectId: recovered.remoteProjectId || recovered.sessionId,
    accountId,
    provider: 'neowow',
    videoUrl: recovered.videoUrl,
    videoUrls: recovered.videoUrls,
    lastError: recovered.error,
  });
  return { recovered: true, task: recovered };
}

export async function recoverLibtvPendingShot({ projectId, episodeId, shotNo } = {}) {
  const id = String(projectId || '').trim();
  if (!id || episodeId == null || shotNo == null) return { recovered: false };
  const existing = listPending().find((task) => (
    task.projectId === id
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  if (existing) return { recovered: false, existing: true, task: existing };
  const cfg = loadConfig();
  const projectUuid = String(cfg.video?.libtvProjectUuid || '').trim();
  if (!projectUuid) throw new Error('请先在视频设置中填写 LibTV 画布 UUID');
  const node = await findLatestLibtvVideoNode({ projectUuid, episodeId, shotNo });
  if (!node?.nodeName) return { recovered: false };
  const task = addPending({
    projectId: id,
    episodeId,
    shotNo,
    submitId: node.nodeName,
    historyId: node.nodeKey || node.nodeName,
    accountId: 'libtv-local',
    provider: 'libtv-cli',
    remoteProjectId: projectUuid,
    lastError: '已找到 LibTV 画布节点，等待重新下载',
  });
  return { recovered: Boolean(task), task: task || node, node };
}

async function submitVideoApiBatch({
  projectId,
  episodeId,
  tasks,
  body,
  cfg,
  stageDir,
} = {}) {
  const jobId = `video_api_submit_${Date.now()}`;
  setJob(jobId, {
    status: 'running',
    phase: 'submit',
    provider: 'video-api',
    projectId,
    episodeId,
    title: `视频提交 · 第 ${episodeId} 集 · ${tasks.length} 镜头`,
    total: tasks.length,
    submitted: 0,
    failed: 0,
    shotNos: tasks.map((task) => String(task.shotNo)),
    message: '开始提交视频 API...',
    submits: {},
  });
  appendVideoApiLog({
    event: 'submit_job_start',
    jobId,
    projectId,
    episodeId,
    total: tasks.length,
    model: body.model || '',
    resolution: body.resolution || cfg.video?.resolution || '720p',
  });

  (async () => {
    const usageRecordedShots = new Set();
    // 幂等键：提交成功即清除（后续重新生成走全新任务）；失败/超时保留，
    // 用户点「重新生成视频」时复用同一 key，由网关幂等找回原任务。
    const idemStore = loadVideoApiIdempotencyStore();
    for (const task of tasks) {
      if (!task.idempotencyKey) {
        task.idempotencyKey = videoApiIdempotencyKeyFor(idemStore, projectId, episodeId, task.shotNo);
      }
    }
    saveVideoApiIdempotencyStore(idemStore);
    try {
      const results = await submitVideoApiVideos({
        apiConfig: cfg.video || {},
        shots: tasks,
        model: body.model || '',
        resolution: body.resolution || cfg.video?.resolution || '720p',
        concurrency: body.concurrency || cfg.video?.apiConcurrency || 3,
        // 优先项目级画风（一键生成弹窗写入 proj.imageStyle），回退全局 cfg.style
        // 彩绘角色图联动：参考图是彩绘（非写实）时，「真人实拍」指令会让模型把彩绘角色
        // 照片化——既崩画风又可能触发肖像审核。自动改用 2D 动漫指令与彩绘参考保持一致。
        style: (() => {
          const proj = loadProject(projectId);
          let st = proj?.imageStyle || cfg.style || '';
          if (proj?.characterImageMode === 'threeViewPainting' && (st === 'realistic' || !st)) st = 'anime';
          return st;
        })(),
        onProgress: (message) => setJob(jobId, { message }),
        onSubmitProgress: (status) => setJob(jobId, status),
      });
      let submitted = 0;
      let failed = 0;
      let outcomeUnknown = 0;
      const submits = {};
      for (const result of results) {
        if (result.ok && result.submitId) {
          delete idemStore[`${projectId}:${episodeId}:${result.shotNo}`];
          addPending({
            projectId,
            episodeId,
            shotNo: result.shotNo,
            submitId: result.submitId,
            historyId: result.historyId,
            accountId: result.channelId || cfg.video?.apiActiveChannelId || 'video-api',
            provider: 'video-api',
            videoUrl: result.videoUrl || '',
            videoUrls: result.videoUrls || [],
            jobId,
          });
          submits[result.shotNo] = { ok: true, submitId: result.submitId };
          submitted++;
          const submittedTask = tasks.find((task) => String(task.shotNo) === String(result.shotNo));
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'video-api',
            model: result.model || body.model || cfg.video?.apiModel || '',
            task: submittedTask,
            fallbackDuration: body.duration,
          });
        } else if (result.submitOutcomeUnknown === true) {
          // 请求已发出但响应没拿回来：上游可能已经建单。网关不幂等，重交会重复计费，
          // 所以如实标记为"结果未知"，交给上游对账找回，而不是当作确定失败。
          outcomeUnknown++;
          submits[result.shotNo] = {
            ok: false,
            error: result.error,
            submitOutcomeUnknown: true,
          };
          const unknownTask = tasks.find((task) => String(task.shotNo) === String(result.shotNo));
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'video-api',
            model: unknownTask?.model || body.model || cfg.video?.apiModel || '',
            task: unknownTask,
            fallbackDuration: body.duration,
            status: 'failed',
            error: result.error || '提交结果未知',
          });
          appendVideoApiLog({
            event: 'submit_shot_outcome_unknown',
            jobId,
            projectId,
            episodeId,
            shotNo: result.shotNo,
            error: result.error,
            code: result.code,
          });
        } else {
          submits[result.shotNo] = { ok: false, error: result.error };
          const failedTask = tasks.find((task) => String(task.shotNo) === String(result.shotNo));
          recordVideoSubmission({
            cfg,
            projectId,
            episodeId,
            provider: 'video-api',
            model: failedTask?.model || body.model || cfg.video?.apiModel || '',
            task: failedTask,
            fallbackDuration: body.duration,
            status: 'failed',
            error: result.error || '视频提交失败',
          });
          appendVideoApiLog({
            event: 'submit_shot_failed',
            jobId,
            projectId,
            episodeId,
            shotNo: result.shotNo,
            error: result.error,
            code: result.code,
          });
          failed++;
        }
        usageRecordedShots.add(String(result.shotNo));
      }
      saveVideoApiIdempotencyStore(idemStore);
      const firstError = Object.values(submits).find((item) => item && item.ok === false)?.error || '';
      const unknownNote = outcomeUnknown > 0
        ? `；另有 ${outcomeUnknown} 个镜头提交结果未知（任务可能已在上游创建，请勿重复提交）`
        : '';
      setJob(jobId, {
        status: submitted > 0 ? 'done' : 'error',
        provider: 'video-api',
        submitted,
        failed,
        outcomeUnknown,
        submits,
        message: submitted > 0
          ? `已提交 ${submitted}/${tasks.length} 到视频 API，生成完成后自动拉回${unknownNote}`
          : `视频 API 提交失败：${firstError || '没有任务提交成功'}${unknownNote}`,
        error: submitted > 0 ? '' : (firstError || '没有任务提交成功'),
      });
      appendVideoApiLog({
        event: submitted > 0 ? 'submit_job_done' : 'submit_job_error',
        jobId,
        projectId,
        episodeId,
        submitted,
        failed,
        outcomeUnknown,
        firstError,
      });
    } catch (e) {
      for (const task of tasks) {
        if (usageRecordedShots.has(String(task.shotNo))) continue;
        recordVideoSubmission({
          cfg,
          projectId,
          episodeId,
          provider: 'video-api',
          model: task?.model || body.model || cfg.video?.apiModel || '',
          task,
          fallbackDuration: body.duration,
          status: 'failed',
          error: e.message,
        });
      }
      setJob(jobId, { status: 'error', provider: 'video-api', error: e.message, message: e.message });
      appendVideoApiLog({ event: 'submit_job_exception', jobId, projectId, episodeId, error: e.message, stack: e.stack });
    } finally {
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  })();

  return { jobId };
}

let comfyUiSubmissionQueueRunning = false;
const COMFYUI_SUBMISSION_QUEUE_LOCK_PATH = path.join(DATA_DIR, '.comfyui-video-queue.lock');

function acquireComfyUiSubmissionQueueLock() {
  return acquireProcessFileLock(COMFYUI_SUBMISSION_QUEUE_LOCK_PATH);
}

function comfyUiQueueTasksForJob(jobId) {
  return listPending().filter((task) => task.provider === 'comfyui' && task.jobId === jobId);
}

function refreshComfyUiQueueJob(jobId, { allowTerminal = false } = {}) {
  const current = getJob(jobId);
  if (!current) return;
  const tasks = comfyUiQueueTasksForJob(jobId);
  const waiting = tasks.filter(isComfyUiWaitingTask);
  const active = tasks.filter(isComfyUiActiveTask);
  const submitted = Number(current.submitted) || 0;
  const failed = Number(current.failed) || 0;
  const total = Number(current.total) || (submitted + failed + waiting.length);
  const terminal = allowTerminal && waiting.length === 0;
  const status = terminal ? (submitted > 0 ? 'done' : 'error') : 'running';
  const firstError = String(current.firstError || current.error || '').trim();
  const slots = [
    ...active.map((task) => ({
      state: 'submitting',
      currentShot: { shotNo: task.shotNo },
      progress: Number(task.progress) || 6,
      note: 'ComfyUI 生成中',
      accountId: task.accountId,
      accountName: 'ComfyUI',
    })),
    ...waiting.map((task) => ({
      state: task.queueState === 'submitting' ? 'submitting' : 'waiting',
      currentShot: { shotNo: task.shotNo },
      progress: task.queueState === 'submitting' ? 3 : 1,
      note: task.queueState === 'submitting' ? '正在提交 ComfyUI' : '在本地等待并发空位',
      accountId: task.accountId,
      accountName: 'ComfyUI',
    })),
  ];
  const message = terminal
    ? (submitted > 0
        ? `已提交 ${submitted}/${total} 到 ComfyUI，完成后自动拉回`
        : `ComfyUI 提交失败：${firstError || '没有任务提交成功'}`)
    : `ComfyUI 本地队列：已提交 ${submitted}/${total}，云端生成中 ${active.length}，本地等待 ${waiting.length}`;
  setJob(jobId, {
    status,
    provider: 'comfyui',
    processed: submitted + failed,
    slots,
    message,
    error: status === 'error' ? (firstError || '没有任务提交成功') : '',
  });
}

function updateComfyUiQueueJobResult(record, result) {
  const jobId = String(record.jobId || '');
  const current = getJob(jobId);
  if (!current) return;
  const submits = { ...(current.submits || {}) };
  const key = String(record.shotNo);
  if (!submits[key]) {
    submits[key] = result.ok
      ? {
        ok: true,
        submitId: result.promptId,
        branch: result.branch,
        binding: result.binding,
      }
      : { ok: false, error: result.error || 'ComfyUI 视频提交失败' };
    setJob(jobId, {
      submits,
      submitted: (Number(current.submitted) || 0) + (result.ok ? 1 : 0),
      failed: (Number(current.failed) || 0) + (result.ok ? 0 : 1),
      firstError: current.firstError || (result.ok ? '' : (result.error || 'ComfyUI 视频提交失败')),
    });
  }
  refreshComfyUiQueueJob(jobId, { allowTerminal: true });
}

function completeComfyUiQueueRecord(record, result, cfg) {
  const current = listPending().find((task) => task.submitId === record.submitId);
  const payload = record.queuePayload || {};
  const task = payload.task;
  if (result.ok && result.promptId) {
    if (current) {
      updatePending(record.submitId, {
        submitId: result.promptId,
        historyId: result.promptId,
        status: 'queued',
        queuePayload: null,
        queueState: '',
        canCancel: false,
        lastError: '',
        progress: 6,
        remoteDone: false,
        remoteProjectId: payload.baseUrl,
        submittedAt: Date.now(),
      });
    }
    recordVideoSubmission({
      cfg,
      projectId: record.projectId,
      episodeId: record.episodeId,
      provider: 'comfyui',
      model: 'MiniMax-H3',
      task,
      fallbackDuration: payload.fallbackDuration,
    });
  } else {
    const error = result.error || 'ComfyUI 视频提交失败';
    if (current) {
      updatePending(record.submitId, {
        status: 'failed',
        queuePayload: null,
        queueState: '',
        canCancel: false,
        lastError: error,
        lastAttemptAt: new Date().toISOString(),
      });
    }
    recordVideoSubmission({
      cfg,
      projectId: record.projectId,
      episodeId: record.episodeId,
      provider: 'comfyui',
      model: 'MiniMax-H3',
      task,
      fallbackDuration: payload.fallbackDuration,
      status: 'failed',
      error,
    });
  }
  updateComfyUiQueueJobResult(record, result);
}

function comfyUiQueueGroupKey(record) {
  const payload = record.queuePayload || {};
  return JSON.stringify([payload.baseUrl || '', payload.workflowPath || '']);
}

async function submitComfyUiQueueGroup(records, cfg) {
  const first = records[0];
  const payload = first.queuePayload || {};
  let workflow;
  let objectInfo;
  try {
    [workflow, objectInfo] = await Promise.all([
      loadComfyUiWorkflow(payload.baseUrl, payload.workflowPath),
      getComfyUiObjectInfo(payload.baseUrl),
    ]);
  } catch (error) {
    for (const record of records) {
      completeComfyUiQueueRecord(record, { ok: false, error: error.message || String(error) }, cfg);
    }
    return;
  }
  await Promise.all(records.map(async (record) => {
    const currentPayload = record.queuePayload || {};
    const task = currentPayload.task || {};
    try {
      const result = await submitComfyUiPrompt({
        baseUrl: currentPayload.baseUrl,
        workflow,
        objectInfo,
        workflowPath: currentPayload.workflowPath,
        prompt: task.prompt,
        duration: task.duration,
        refs: {
          images: task.refImagePaths || [],
          videos: task.refVideoPaths || [],
          audios: task.refAudioPaths || [],
        },
      });
      completeComfyUiQueueRecord(record, { ok: true, ...result }, cfg);
    } catch (error) {
      completeComfyUiQueueRecord(record, { ok: false, error: error.message || String(error) }, cfg);
    }
  }));
}

function cleanupComfyUiQueueStageDirs(records) {
  const directories = new Set(records.map((record) => record.queuePayload?.stageDir).filter(Boolean));
  const waiting = listPending().filter(isComfyUiWaitingTask);
  for (const directory of directories) {
    if (waiting.some((task) => task.queuePayload?.stageDir === directory)) continue;
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function cancelComfyUiQueuedShot(projectId, episodeId, shotNo) {
  const record = listPending().find((task) => (
    isComfyUiWaitingTask(task)
    && task.projectId === projectId
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  if (!record) return false;
  removePending(record.submitId);
  updateComfyUiQueueJobResult(record, { ok: false, error: '已取消' });
  cleanupComfyUiQueueStageDirs([record]);
  return true;
}

export function cancelComfyUiQueuedProject(projectId, episodeId = null) {
  const records = listPending().filter((task) => (
    isComfyUiWaitingTask(task)
    && task.projectId === projectId
    && (episodeId == null || String(task.episodeId) === String(episodeId))
  ));
  for (const record of records) {
    removePending(record.submitId);
    updateComfyUiQueueJobResult(record, { ok: false, error: '已取消' });
  }
  cleanupComfyUiQueueStageDirs(records);
  return records.length;
}

export function cancelComfyUiUnsubmittedShot(projectId, episodeId, shotNo) {
  const matching = listPending().filter((task) => (
    isComfyUiWaitingTask(task)
    && task.projectId === projectId
    && String(task.episodeId) === String(episodeId)
    && String(task.shotNo) === String(shotNo)
  ));
  const records = matching.filter((task) => isSafelyWaitingProviderTask(task, isComfyUiWaitingTask));
  for (const record of records) {
    removePending(record.submitId);
    updateComfyUiQueueJobResult(record, { ok: false, error: '已取消（尚未发送到 ComfyUI）' });
  }
  cleanupComfyUiQueueStageDirs(records);
  return { cleared: records.length, cancelledShotNos: records.map((record) => record.shotNo), preserved: matching.length - records.length };
}

export function cancelComfyUiUnsubmittedProject(projectId, episodeId = null) {
  const matching = listPending().filter((task) => (
    isComfyUiWaitingTask(task)
    && task.projectId === projectId
    && (episodeId == null || String(task.episodeId) === String(episodeId))
  ));
  const records = matching.filter((task) => isSafelyWaitingProviderTask(task, isComfyUiWaitingTask));
  for (const record of records) {
    removePending(record.submitId);
    updateComfyUiQueueJobResult(record, { ok: false, error: '已取消（尚未发送到 ComfyUI）' });
  }
  cleanupComfyUiQueueStageDirs(records);
  return { cleared: records.length, cancelledShotNos: records.map((record) => record.shotNo), preserved: matching.length - records.length };
}

export function startComfyUiSubmissionQueue() {
  if (comfyUiSubmissionQueueRunning) return false;
  const releaseQueueLock = acquireComfyUiSubmissionQueueLock();
  if (!releaseQueueLock) return false;
  const cfg = loadConfig();
  const plan = planComfyUiQueue(listPending(), cfg.video?.comfyuiConcurrency || 1);
  if (!plan.selected.length) {
    releaseQueueLock();
    for (const jobId of new Set(plan.waiting.map((task) => task.jobId).filter(Boolean))) {
      refreshComfyUiQueueJob(jobId);
    }
    return false;
  }

  comfyUiSubmissionQueueRunning = true;
  for (const record of plan.selected) {
    updatePending(record.submitId, {
      queueState: 'submitting',
      canCancel: false,
      lastError: '正在提交 ComfyUI',
      lastAttemptAt: new Date().toISOString(),
    });
  }
  for (const jobId of new Set(plan.selected.map((task) => task.jobId).filter(Boolean))) {
    refreshComfyUiQueueJob(jobId);
  }

  const groups = new Map();
  for (const record of plan.selected) {
    const key = comfyUiQueueGroupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  void Promise.all([...groups.values()].map((records) => submitComfyUiQueueGroup(records, cfg)))
    .finally(() => {
      cleanupComfyUiQueueStageDirs(plan.selected);
      comfyUiSubmissionQueueRunning = false;
      releaseQueueLock();
      startComfyUiSubmissionQueue();
    });
  return true;
}

async function submitComfyUiBatch({ projectId, episodeId, tasks, body, cfg, stageDir } = {}) {
  const baseUrl = normalizeComfyUiBaseUrl(body.comfyuiBaseUrl || cfg.video?.comfyuiBaseUrl, '');
  if (!baseUrl) throw new Error('请先在视频设置中填写并测试 ComfyUI 云端地址');
  const preset = comfyUiWorkflowPreset(body.comfyuiWorkflowPreset || cfg.video?.comfyuiWorkflowPreset);
  const workflowPath = preset.path;
  const jobId = `comfyui_submit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const pendingTasks = listPending();
  const activeTasks = [];
  const skippedSubmits = {};
  const seenShots = new Set();
  for (const task of tasks) {
    const shotKey = String(task.shotNo);
    const pending = findActiveComfyUiTaskForShot(pendingTasks, projectId, episodeId, task.shotNo);
    if (pending || seenShots.has(shotKey)) {
      skippedSubmits[shotKey] = {
        ok: true,
        skipped: true,
        ...(pending?.submitId ? { submitId: pending.submitId } : {}),
        error: '该镜头已在 ComfyUI 本地队列或生成中，已跳过重复提交',
      };
      continue;
    }
    seenShots.add(shotKey);
    activeTasks.push(task);
  }

  if (!activeTasks.length) {
    const skipped = Object.keys(skippedSubmits).length;
    setJob(jobId, {
      status: 'done',
      phase: 'submit',
      provider: 'comfyui',
      queueManaged: true,
      projectId,
      episodeId,
      title: `ComfyUI ${preset.name} · 第 ${episodeId} 集`,
      total: skipped,
      processed: skipped,
      submitted: 0,
      failed: 0,
      skipped,
      message: '这些镜头已在 ComfyUI 本地队列或生成中，已跳过重复提交',
      submits: skippedSubmits,
    });
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { jobId, skipped };
  }

  setJob(jobId, {
    status: 'running',
    phase: 'submit',
    provider: 'comfyui',
    queueManaged: true,
    projectId,
    episodeId,
    title: `ComfyUI ${preset.name} · 第 ${episodeId} 集 · ${activeTasks.length} 镜头`,
    total: activeTasks.length + Object.keys(skippedSubmits).length,
    processed: 0,
    submitted: 0,
    failed: 0,
    shotNos: activeTasks.map((task) => String(task.shotNo)),
    skipped: Object.keys(skippedSubmits).length,
    message: `已加入 ComfyUI 本地队列，共 ${activeTasks.length} 个镜头`,
    submits: { ...skippedSubmits },
  });

  const queueBase = Date.now() * 1000;
  activeTasks.forEach((task, index) => {
    addPending({
      projectId,
      episodeId,
      shotNo: task.shotNo,
      submitId: `comfyui-queue:${jobId}:${String(task.shotNo)}:${index}`,
      accountId: preset.id,
      provider: 'comfyui',
      status: 'submitting',
      lastError: '在本地等待并发空位',
      queueState: 'waiting',
      canCancel: true,
      queueOrder: queueBase + index,
      jobId,
      progress: 1,
      queuePayload: {
        baseUrl,
        workflowPreset: preset.id,
        workflowPath,
        task,
        fallbackDuration: body.duration,
        stageDir,
      },
    });
  });
  refreshComfyUiQueueJob(jobId);
  startComfyUiSubmissionQueue();
  return { jobId };
}

function videoSubmitProviderForShot(shot = {}, body = {}, cfg = {}) {
  return normalizeVideoProvider(shot.provider || body.provider || cfg.video?.provider);
}

// 渠道凭证预检：这些渠道客户端在缺 Token/账号时会抛出英文原文或没头没尾的一句话
// （如 UpDream 的 "UpDream Access Token is not configured"）。提交前统一拦下，
// 一次给出「去哪配」的中文提示，而不是让每个镜头各失败一次。
function videoProviderConfigError(provider, cfg = {}) {
  const normalized = normalizeVideoProvider(provider);
  const video = cfg.video || {};
  if (normalized === 'updream') {
    return (video.updreamAccessToken || video.updreamRefreshToken)
      ? '' : 'UpDream 未配置 Token：请到“设置 → 视频 → UpDream”填写 Access Token（或 Refresh Token）后重试';
  }
  if (normalized === 'neowow') {
    return (video.neowowToken || usableNeowowAccounts().length)
      ? '' : 'Neowow 未配置可用账号：请到“设置 → 视频 → Neowow”添加并登录账号后重试';
  }
  if (normalized === 'xiaoyunque') {
    const accounts = Array.isArray(video.xiaoyunqueAccounts) ? video.xiaoyunqueAccounts : [];
    const usable = accounts.some((account) => account?.enabled !== false && (account?.accessKey || account?.sessionid));
    return usable ? '' : '小云雀未配置 Access Key：请到“设置 → 视频 → 小云雀”导入 access key 后重试';
  }
  if (normalized === 'libtv-cli') {
    return String(video.libtvProjectUuid || '').trim()
      ? '' : 'LibTV 未配置画布 UUID：请到“设置 → 视频 → LibTV”填写画布 UUID 后重试';
  }
  if (normalized === 'comfyui') {
    return String(video.comfyuiBaseUrl || '').trim()
      ? '' : 'ComfyUI 未配置云端地址：请到“设置 → 视频 → ComfyUI”填写服务地址后重试';
  }
  return '';
}

function assertVideoProviderConfigured(provider, cfg = {}) {
  const message = videoProviderConfigError(provider, cfg);
  if (!message) return;
  const error = new Error(message);
  error.code = 'CONFIG_MISSING';
  throw error;
}

function defaultVideoModelForProvider(cfg = {}, provider = '') {
  const normalized = normalizeVideoProvider(provider);
  if (normalized === 'dreamina-agent') return '';
  if (normalized === 'xiaoyunque') return cfg.video?.xiaoyunqueModel || '';
  if (normalized === 'libtv-cli') return cfg.video?.libtvModel || 'Seedance 2.0 VIP';
  if (normalized === 'updream') return cfg.video?.updreamModel || 'sed2-fast';
  if (normalized === 'neowow') return cfg.video?.neowowModel || 'neo-video-2-0-fast';
  if (normalized === 'comfyui') return 'MiniMax-H3';
  if (normalized === 'video-api') return cfg.video?.apiModel || '';
  return cfg.video?.dreaminaModel || '';
}

function defaultVideoResolutionForProvider(provider = '') {
  const normalized = normalizeVideoProvider(provider);
  if (normalized === 'comfyui') return '2k';
  return ['updream', 'neowow'].includes(normalized) ? '480p' : '720p';
}

function bodyForVideoProvider(body = {}, cfg = {}, provider = '') {
  const normalized = normalizeVideoProvider(provider);
  if (normalized === 'dreamina-agent') {
    const bodyProvider = normalizeVideoProvider(body.provider || cfg.video?.provider);
    return {
      ...body,
      provider: normalized,
      model: '',
      resolution: '720p',
      aspectRatio: '16:9',
      duration: 15,
      videoMode: 'mention',
      session: undefined,
      accountId: String(
        (bodyProvider === 'dreamina-agent' ? body.accountId : '')
        || cfg.video?.dreaminaAgentAccountId
        || selectedDreaminaAgentAccountId()
      ).trim(),
      dreaminaAgentPromptPreset: normalizeDreaminaAgentPromptPreset(
        (bodyProvider === 'dreamina-agent' ? body.dreaminaAgentPromptPreset : '')
        || cfg.video?.dreaminaAgentPromptPreset,
      ),
      dreaminaAgentShotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(
        (bodyProvider === 'dreamina-agent' ? body.dreaminaAgentShotIntervalSeconds : '')
        || cfg.video?.dreaminaAgentShotIntervalSeconds,
      ),
      lineId: '',
    };
  }
  const bodyProvider = normalizeVideoProvider(body.provider || cfg.video?.provider);
  const useBodyDefaults = bodyProvider === normalized;
  const resolution = useBodyDefaults
    ? (body.resolution || cfg.video?.resolution)
    : '';
  return {
    ...body,
    provider: normalized,
    model: useBodyDefaults ? (body.model || defaultVideoModelForProvider(cfg, normalized)) : defaultVideoModelForProvider(cfg, normalized),
    resolution: resolution || defaultVideoResolutionForProvider(normalized),
    session: normalized === 'dreamina-cli'
      ? (useBodyDefaults ? (body.session ?? cfg.video?.dreaminaSession ?? '0') : (cfg.video?.dreaminaSession ?? '0'))
      : undefined,
    accountId: ['xiaoyunque', 'neowow'].includes(normalized) && useBodyDefaults
      ? (body.accountId || body.lineId || '')
      : '',
    lineId: normalized === 'xiaoyunque' && useBodyDefaults ? (body.lineId || body.accountId || '') : '',
  };
}

export async function buildVideoSubmitTasks({ projectId, episodeId, shots = [], provider, body = {}, cfg = {}, stageDir } = {}) {
  const tasks = [];
  for (const shot of shots) {
    const refs = Array.isArray(shot.refs) ? shot.refs : [];
    const audioRefs = Array.isArray(shot.audioRefs) ? shot.audioRefs : [];
    const mode = shot.videoMode || (shot.useNameLabel === true ? 'label' : 'mention');
    const wantMention = false;
    const wantLabel = mode === 'label' || mode === 'mention_label';
    const wantReferenceDescription = wantMention || provider === 'dreamina-agent' || provider === 'dreamina-cli' || provider === 'libtv-cli' || provider === 'xiaoyunque' || provider === 'updream' || provider === 'neowow' || provider === 'comfyui' || provider === 'video-api';
    const refImagePaths = [];
    const refAudioPaths = [];
    const refVideoPaths = [];
    const mentions = [];

    for (const ref of refs) {
      const resolvedRef = resolveReferenceImagePath(projectId, ref);
      const originalPath = resolvedRef.path;
      if (!originalPath) continue;
      const mentionName = referenceImageMentionName(ref, originalPath);
      let uploadPath = originalPath;
      if (wantLabel && resolvedRef.cat && resolvedRef.imageBase) {
        const labeledPath = await ensureLabeledImage(projectId, resolvedRef.cat, resolvedRef.imageBase, mentionName || undefined);
        if (labeledPath) uploadPath = labeledPath;
      } else if (wantLabel && mentionName) {
        uploadPath = await stageLabeledReferenceFile(stageDir, uploadPath, mentionName, '.png');
      }
      if (wantReferenceDescription && mentionName) {
        const baseNoExt = path.basename(uploadPath, path.extname(uploadPath));
        if (wantMention && mentionName !== baseNoExt) {
          fs.mkdirSync(stageDir, { recursive: true });
          const safe = mentionName.replace(/[\\/:*?"<>|]/g, '_');
          const staged = path.join(stageDir, `${safe}.png`);
          try { fs.copyFileSync(uploadPath, staged); uploadPath = staged; } catch { /* use original path */ }
        }
        const mention = makeReferenceMention(uploadPath, mentionName, 'image', {
          category: ref?.referenceRole
            || ref?.role
            || (ref?.isFirstFrame === true ? 'first-frame' : '')
            || resolvedRef.cat
            || ref?.cat
            || ref?.category,
        });
        if (mention) mentions.push(mention);
      }
      refImagePaths.push(uploadPath);
    }

    // 角色音色绑定：与参考图同理，把"某某某的音色"挂到对应参考图 mention 上，
    // 由 buildReferencePromptPrefix 拼进提示词前缀（@Image1 是裴清让参考图，裴清让的音色为「低沉少年音」…），
    // 让 Seedance 类视频模型统一角色的声音表演。旧项目人物没有 voice 字段时自动跳过。
    try {
      const voiceProject = loadProject(projectId);
      const voiceByName = new Map();
      for (const el of voiceProject?.elements?.character || []) {
        const elName = String(el?.name || '').trim();
        const elVoice = String(el?.voice || '').trim();
        if (elName && elVoice) voiceByName.set(elName, elVoice);
      }
      if (voiceByName.size) {
        for (const mention of mentions) {
          if (!mention || String(mention.kind || '').toLowerCase() !== 'image') continue;
          const bare = String(mention.displayName || mention.name || '').replace(/参考图$/u, '').trim();
          const elVoice = voiceByName.get(bare);
          if (elVoice) mention.voice = elVoice;
        }
      }
    } catch { /* 音色绑定失败不影响出片 */ }

    for (const audioRef of audioRefs) {
      const characterName = String(audioRef.characterName || '').trim();
      if (!characterName) continue;
      const ownerName = audioReferenceOwnerName(characterName);
      const audioPath = characterVoiceReadDiskPath(projectId, characterName);
      if (!fs.existsSync(audioPath)) continue;
      const requestedMentionName = String(audioRef.mentionName || characterName).trim();
      let uploadAudioPath = provider === 'dreamina-agent'
        ? await prepareDreaminaAgentAudioReference(projectId, audioPath)
        : audioPath;
      const sourceAudioName = path.basename(uploadAudioPath, path.extname(uploadAudioPath));
      const mentionName = provider === 'dreamina-agent'
        ? sourceAudioName
        : requestedMentionName;
      if (mentionName) {
        const baseNoExt = path.basename(uploadAudioPath, path.extname(uploadAudioPath));
        if (mentionName !== baseNoExt) {
          fs.mkdirSync(stageDir, { recursive: true });
          const safe = mentionName.replace(/[\\/:*?"<>|]/g, '_');
          const staged = path.join(stageDir, `${safe}${path.extname(uploadAudioPath) || '.mp3'}`);
          try { fs.copyFileSync(uploadAudioPath, staged); uploadAudioPath = staged; } catch { /* use original path */ }
        }
        const mention = makeReferenceMention(uploadAudioPath, mentionName, 'audio', {
          category: 'character',
          phrase: provider === 'dreamina-agent'
            ? `这是${ownerName}的参考音频`
            : `这个是${characterName}的配音/音色参考`,
          fallbackText: ownerName,
        });
        if (mention) mentions.push(mention);
      }
      refAudioPaths.push(uploadAudioPath);
    }

    const videoRefs = Array.isArray(shot.videoRefs) ? shot.videoRefs : (Array.isArray(shot.refVideoPaths) ? shot.refVideoPaths : []);
    for (const videoRef of videoRefs) {
      const videoPath = typeof videoRef === 'string' ? videoRef : (videoRef?.filePath || videoRef?.path || videoRef?.url || '');
      if (videoPath) refVideoPaths.push(videoPath);
    }

    const opener = openerFramePath(projectId, episodeId, shot.openerFrameFrom);
    const openerFrameFrom = opener ? String(shot.openerFrameFrom ?? '').trim() : '';
    const openerFrameName = opener ? normalizeOpenerFrameName(shot.openerFrameName) : '';
    if (opener) {
      const openerUploadPath = wantLabel
        ? await stageLabeledReferenceFile(stageDir, opener, openerFrameName, '.png')
        : (wantMention ? stageNamedReferenceFile(stageDir, opener, openerFrameName, '.png') : opener);
      refImagePaths.unshift(openerUploadPath);
      const mention = makeReferenceMention(openerUploadPath, openerFrameName, 'image', {
        category: 'continuity-frame',
        phrase: '是本分镜的首帧参考图',
        fallbackText: openerFrameName,
      });
      if (mention) mentions.unshift(mention);
    }

    const prompt = provider === 'dreamina-agent'
      ? String(shot.prompt ?? '')
      : withOpenerFramePrompt(
        shot.prompt,
        openerFrameName,
        (provider === 'dreamina-cli' || provider === 'updream' || provider === 'neowow' || provider === 'video-api') ? '@Image1' : '',
      );
    if (String(prompt || '').trim()) {
      tasks.push({
        shotNo: shot.shotNo,
        prompt,
        refImagePaths,
        refAudioPaths,
        refVideoPaths,
        mentions,
        openerFrameFrom,
        openerFrameName,
        model: provider === 'dreamina-agent' ? '' : String(shot.model || '').trim(),
        session: String(shot.session ?? '').trim(),
        accountId: String(shot.accountId || body.accountId || (provider === 'dreamina-agent' ? cfg.video?.dreaminaAgentAccountId : '') || '').trim(),
        aspectRatio: provider === 'dreamina-agent' ? '16:9' : (shot.aspectRatio || cfg.video?.aspectRatio || '16:9'),
        resolution: provider === 'dreamina-agent' ? '720p' : (shot.resolution || body.resolution || cfg.video?.resolution || '720p'),
        duration: provider === 'dreamina-agent' ? 15 : (Number(shot.duration) || cfg.video?.duration || 15),
        generateAudio: shot.generateAudio !== false,
        referenceMode: shot.referenceMode === 'frame' ? 'frame' : 'image',
        ...(provider === 'dreamina-agent'
          ? {
            dreaminaAgentPromptPreset: normalizeDreaminaAgentPromptPreset(
              shot.dreaminaAgentPromptPreset || body.dreaminaAgentPromptPreset || cfg.video?.dreaminaAgentPromptPreset,
            ),
            dreaminaAgentShotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(
              shot.dreaminaAgentShotIntervalSeconds || body.dreaminaAgentShotIntervalSeconds || cfg.video?.dreaminaAgentShotIntervalSeconds,
            ),
          }
          : {}),
      });
    }
  }
  return tasks;
}

async function submitVideoProviderBatch({ provider, projectId, episodeId, tasks, body, cfg, stageDir } = {}) {
  if (provider === 'xiaoyunque') return submitXiaoyunqueBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  if (provider === 'dreamina-cli') return submitDreaminaBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  if (provider === 'dreamina-agent') return submitDreaminaAgentBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  if (provider === 'libtv-cli') return submitLibtvBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  if (provider === 'updream') return submitUpdreamBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  if (provider === 'neowow') return submitNeowowBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  if (provider === 'comfyui') return submitComfyUiBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  if (provider === 'video-api') return submitVideoApiBatch({ projectId, episodeId, tasks, body, cfg, stageDir });
  throw new Error('Unsupported video provider');
}

const VIDEO_SUBMIT_TERMINAL_STATUSES = new Set(['done', 'error', 'failed', 'cancelled']);

function monitorMixedVideoSubmitJob(parentJobId, childJobIds = [], { initialSubmits = {}, initialFailed = 0 } = {}) {
  const tick = () => {
    const childStates = childJobIds.map((id) => getJob(id)).filter(Boolean);
    const submits = { ...initialSubmits };
    let submitted = 0;
    let failed = initialFailed;
    let skipped = 0;
    let processed = initialFailed;
    let total = 0;
    const slots = [];
    const activeMessages = [];
    let firstError = '';

    for (const state of childStates) {
      submitted += Number(state.submitted) || 0;
      failed += Number(state.failed) || 0;
      skipped += Number(state.skipped) || 0;
      processed += Number(state.processed) || ((Number(state.submitted) || 0) + (Number(state.failed) || 0));
      total += Number(state.total) || 0;
      Object.assign(submits, state.submits || {});
      if (state.error && !firstError) firstError = state.error;
      if (!VIDEO_SUBMIT_TERMINAL_STATUSES.has(state.status)) activeMessages.push(state.message || `${state.provider || '视频'}提交中`);
      for (const slot of Array.isArray(state.slots) ? state.slots : []) {
        slots.push({
          ...slot,
          accountId: `${state.provider || 'video'}:${slot.accountId || slots.length + 1}`,
          accountName: slot.accountName || state.provider || '',
          provider: state.provider || '',
        });
      }
    }

    const allResolved = childStates.length === childJobIds.length
      && childStates.every((state) => VIDEO_SUBMIT_TERMINAL_STATUSES.has(state.status));
    const status = allResolved ? ((submitted > 0 || skipped > 0) ? 'done' : 'error') : 'running';
    const message = status === 'running'
      ? (activeMessages[0] || `正在提交 ${childJobIds.length} 个视频渠道...`)
      : (submitted > 0
        ? `已提交 ${submitted}/${Math.max(total, submitted + failed + skipped)} 个镜头`
        : (firstError || '没有任务提交成功'));
    setJob(parentJobId, {
      status,
      provider: 'mixed',
      submitted,
      failed,
      skipped,
      processed,
      total: Math.max(total, submitted + failed + skipped),
      submits,
      slots,
      message,
      error: status === 'error' ? (firstError || '没有任务提交成功') : '',
    });
    if (!allResolved) {
      const timer = setTimeout(tick, 1000);
      timer.unref?.();
    }
  };
  const timer = setTimeout(tick, 400);
  timer.unref?.();
}

export async function submitVideoBatchRequest(body = {}) {
  const { projectId, episodeId } = body;
  const shots = Array.isArray(body.shots) ? body.shots : [];
  if (!projectId || episodeId == null) throw new Error('缺少 projectId/episodeId');
  if (!shots.length) throw new Error('没有待提交的分镜');
  const proj = loadProject(projectId);
  if (!proj) {
    const err = new Error('项目不存在');
    err.status = 404;
    throw err;
  }
  for (const shot of shots) {
    const shotNo = shot?.shotNo ?? shot?.no;
    if (shotNo != null) resumePendingTrackingByShot(projectId, episodeId, shotNo);
  }

  const cfg = loadConfig();
  const groups = new Map();
  for (const shot of shots) {
    const provider = videoSubmitProviderForShot(shot, body, cfg);
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(shot);
  }

  if (groups.size === 1) {
    const [[provider, providerShots]] = [...groups.entries()];
    const providerBody = bodyForVideoProvider(body, cfg, provider);
    const stageDir = path.join(TEMP_DIR, `hepai_mention_${Date.now()}_${provider}`);
    let handedOffStageDir = false;
    try {
      assertVideoProviderConfigured(provider, cfg);
      const tasks = await buildVideoSubmitTasks({ projectId, episodeId, shots: providerShots, provider, body: providerBody, cfg, stageDir });
      if (!tasks.length) throw new Error('这些分镜都没有有效的视频提示词');
      const result = await submitVideoProviderBatch({ provider, projectId, episodeId, tasks, body: providerBody, cfg, stageDir });
      handedOffStageDir = true;
      return result;
    } finally {
      if (!handedOffStageDir) {
        try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  const parentJobId = `video_mixed_submit_${Date.now()}`;
  setJob(parentJobId, {
    status: 'running',
    phase: 'submit',
    provider: 'mixed',
    projectId,
    episodeId,
    title: `视频提交 · 第 ${episodeId} 集 · ${shots.length} 镜头 · 多渠道`,
    total: shots.length,
    submitted: 0,
    failed: 0,
    skipped: 0,
    processed: 0,
    shotNos: shots.map((shot) => String(shot?.shotNo ?? shot?.no)),
    submits: {},
    message: '正在按单镜渠道拆分提交...',
  });

  const childJobIds = [];
  const initialSubmits = {};
  let initialFailed = 0;
  let sequence = 0;
  for (const [provider, providerShots] of groups.entries()) {
    sequence += 1;
    const providerBody = bodyForVideoProvider(body, cfg, provider);
    const stageDir = path.join(TEMP_DIR, `hepai_mention_${Date.now()}_${sequence}_${provider}`);
    try {
      assertVideoProviderConfigured(provider, cfg);
      const tasks = await buildVideoSubmitTasks({ projectId, episodeId, shots: providerShots, provider, body: providerBody, cfg, stageDir });
      if (!tasks.length) {
        try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
        continue;
      }
      const result = await submitVideoProviderBatch({ provider, projectId, episodeId, tasks, body: providerBody, cfg, stageDir });
      if (result?.jobId) childJobIds.push(result.jobId);
    } catch (error) {
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
      for (const shot of providerShots) {
        const shotNo = shot?.shotNo ?? shot?.no;
        if (shotNo == null) continue;
        initialSubmits[shotNo] = { ok: false, error: error.message || String(error) };
        initialFailed += 1;
      }
    }
  }

  if (!childJobIds.length) {
    const message = Object.values(initialSubmits)[0]?.error || '这些分镜都没有有效的视频提示词';
    setJob(parentJobId, {
      status: 'error',
      provider: 'mixed',
      failed: initialFailed,
      processed: initialFailed,
      submits: initialSubmits,
      message,
      error: message,
    });
    return { jobId: parentJobId };
  }

  monitorMixedVideoSubmitJob(parentJobId, childJobIds, { initialSubmits, initialFailed });
  return { jobId: parentJobId, childJobIds };
}

function dreaminaTaskSubmitId(task = {}) {
  return String(task.submit_id || task.submitId || task.id || '').trim();
}

function dreaminaTaskStatus(task = {}) {
  return String(task.gen_status || task.genStatus || task.status || '').trim().toLowerCase();
}

function dreaminaTaskPrompt(task = {}) {
  return String(task.prompt || task.input?.prompt || task.request?.prompt || '').trim();
}

function isRecoverableDreaminaTask(task = {}) {
  const status = dreaminaTaskStatus(task);
  if (!status) return false;
  if (/fail|failed|cancel|canceled|cancelled|error/i.test(status)) return false;
  return /success|done|complete|finish|query|queue|running|process|generat|init/i.test(status);
}

function compactTaskText(text) {
  return String(text || '').replace(/\s+/g, '');
}

function isLikelyDreaminaVideoUrl(value, key = '') {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  if (/\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(value)) return true;
  if (/mime_type=video|video_mp4|\/video\/|vlabvod|vod|tos-cn/i.test(value)) return true;
  return /video|download|preview|media/i.test(key);
}

function deepFindDreaminaVideoUrl(value, key = '', depth = 0) {
  if (depth > 8 || value == null) return '';
  if (typeof value === 'string') return isLikelyDreaminaVideoUrl(value, key) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindDreaminaVideoUrl(item, key, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      const found = deepFindDreaminaVideoUrl(childValue, childKey, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function scoreDreaminaTaskShot(prompt, shot) {
  const haystack = compactTaskText(prompt);
  const body = compactTaskText(shot.body);
  const title = compactTaskText(shot.title);
  if (!haystack || !body) return 0;
  let score = 0;
  if (title.length >= 6 && haystack.includes(title.slice(0, Math.min(80, title.length)))) score += 2;
  if (body.length >= 80 && haystack.includes(body.slice(0, Math.min(260, body.length)))) score += 5;
  if (body.length >= 420 && haystack.includes(body.slice(-260))) score += 3;
  const segment = shot.body.split(/\r?\n/).map((line) => line.trim()).find((line) => /生成段落\s*\d+/.test(line));
  if (segment && haystack.includes(compactTaskText(segment))) score += 4;
  return score;
}

async function recoverDreaminaPendingForProject(projectId, statuses = {}) {
  const id = String(projectId || '').trim();
  if (!id) return 0;
  const proj = loadProject(id);
  if (!proj) return 0;
  normalizeProjectScript(proj);
  const candidates = [];
  let healed = false;
  // 有在途/失败云端任务的镜头一律不做"落盘即成品"回填。重新生成时旧文件
  // 可能因被播放器流/杀软占用而删除失败残留在磁盘上，这里一回填就会把旧
  // 视频当成新结果报 done，顶掉在途任务的生成中状态（用户看到旧片或坏片）。
  const existing = listPending();
  const trackedShots = new Set(existing
    .filter((task) => task.projectId === id)
    .map((task) => `${task.projectId}:${task.episodeId}:${task.shotNo}`));
  for (const sb of proj.script?.storyboards || []) {
    const recorded = (sb.shotVideos && typeof sb.shotVideos === 'object') ? sb.shotVideos : {};
    for (const shot of parseStoryboardShotsForRecovery(sb.content || '')) {
      if (!shot.no) continue;
      if (dreaminaSubmittingShots.has(dreaminaShotKey(id, sb.episodeId, shot.no))) continue;
      if (trackedShots.has(`${id}:${sb.episodeId}:${shot.no}`)) continue;
      if (videoExists(id, sb.episodeId, shot.no)) {
        if (!recorded[String(shot.no)]?.videoUrl) {
          const localUrl = videoLocalUrl(id, sb.episodeId, shot.no);
          if (!sb.shotVideos || typeof sb.shotVideos !== 'object') sb.shotVideos = {};
          sb.shotVideos[String(shot.no)] = { videoUrl: localUrl, updatedAt: new Date().toISOString() };
          statuses[`${id}:${sb.episodeId}:${shot.no}`] = { status: 'done', provider: 'dreamina-cli', videoUrl: localUrl };
          healed = true;
        }
        continue;
      }
      candidates.push({ projectId: id, episodeId: sb.episodeId, shotNo: shot.no, title: shot.title, body: shot.body });
    }
  }
  if (healed) { proj.updatedAt = new Date().toISOString(); saveProject(proj); }
  if (!candidates.length) return 0;

  const existingSubmitIds = new Set(existing.map((task) => String(task.submitId || '')));
  const occupiedShots = new Set(existing
    .filter((task) => task.projectId === id && task.provider === 'dreamina-cli')
    .map((task) => `${task.projectId}:${task.episodeId}:${task.shotNo}`));
  let recovered = 0;

  const tasks = await listDreaminaTasks();
  for (const task of tasks) {
    const submitId = dreaminaTaskSubmitId(task);
    if (!submitId || existingSubmitIds.has(submitId) || !isRecoverableDreaminaTask(task)) continue;
    const prompt = dreaminaTaskPrompt(task);
    let best = null;
    for (const candidate of candidates) {
      const key = `${candidate.projectId}:${candidate.episodeId}:${candidate.shotNo}`;
      if (occupiedShots.has(key)) continue;
      const score = scoreDreaminaTaskShot(prompt, candidate);
      if (score >= 5 && (!best || score > best.score)) best = { ...candidate, key, score };
    }
    if (!best) continue;
    const recoveredTask = addPending({
      projectId: best.projectId,
      episodeId: best.episodeId,
      shotNo: best.shotNo,
      submitId,
      historyId: submitId,
      accountId: dreaminaLocalAccountId(),
      provider: 'dreamina-cli',
    });
    if (!recoveredTask) continue;
    const videoUrl = deepFindDreaminaVideoUrl(task);
    if (videoUrl) updatePending(submitId, { videoUrl });
    statuses[best.key] = { status: 'queued', provider: 'dreamina-cli', note: '已从 Dreamina CLI 历史恢复追踪' };
    existingSubmitIds.add(submitId);
    occupiedShots.add(best.key);
    recovered++;
  }
  return recovered;
}

const DREAMINA_RECOVERY_INTERVAL_MS = 60 * 1000;
const dreaminaRecoveryAt = new Map();
let pollRunning = false;

function normalizeVideoProgress(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

// 上游任务日志里的模型名。实测（rolldek）放在 data.model，另有 properties.origin_model_name，
// 顶层没有 model/model_name——保留顶层兼容是为了其他 new-api 部署。
function upstreamModelName(upstream = {}) {
  return String(
    upstream.model
    || upstream.model_name
    || upstream.data?.model
    || upstream.properties?.origin_model_name
    || '',
  ).trim();
}

// 上游 progress 实测是字符串（如 "100%"）；data.progress 是对象，data.progress_pct 才是数字。
function upstreamProgressValue(upstream = {}) {
  const raw = String(upstream.progress ?? '').replace('%', '').trim();
  if (raw !== '') {
    const direct = Number(raw);
    if (Number.isFinite(direct)) return direct;
  }
  const pct = Number(upstream.data?.progress_pct);
  return Number.isFinite(pct) ? pct : undefined;
}

// new-api 的 quota 换算：500000 quota = 1 USD（实测 750000 对应网关界面显示的 $1.5）
const NEW_API_QUOTA_PER_USD = 500000;

export function upstreamCostUsd(task = {}) {
  const quota = Number(task.upstreamQuota) || 0;
  return quota > 0 ? quota / NEW_API_QUOTA_PER_USD : null;
}

// 上游 start_time/finish_time 都是 Unix 秒
export function upstreamElapsedMs(task = {}) {
  const startSeconds = Number(task.upstreamStartAt) || 0;
  if (!startSeconds) return null;
  const finishSeconds = Number(task.upstreamFinishAt) || 0;
  const endMs = finishSeconds ? finishSeconds * 1000 : Date.now();
  return Math.max(0, endMs - startSeconds * 1000);
}

// video-api（rolldek/new-api 网关）的上报状态由上游任务日志决定。
// 本地记录的 status 始终是 'queued'——listUnfinished() 只认 queued，写成 'running'
// 会让这条记录从轮询集合里消失，上游真实状态单独放在 upstreamStatus 里。
function videoApiReportStatus(task = {}) {
  return task.upstreamStatus === 'IN_PROGRESS' ? 'running' : 'queued';
}

// 上游 QUEUED 阶段的 progress 是固定标记值而不是真实进度（见 syncUpstreamStatusFromRemote），
// 所以只有 IN_PROGRESS/done 才上报进度，排队阶段交给前端的估算曲线。
function videoApiReportProgress(task = {}, status = '') {
  if (status === 'running') return normalizeVideoProgress(task.progress);
  if (status === 'done') return 100;
  return null;
}

function pendingVideoStatus(task = {}, provider = '', status = 'queued', extra = {}) {
  // omitProgress：显式表示「本轮没有可信进度」，不回退到记录里可能已经过期的 progress。
  const progress = extra.omitProgress ? null : normalizeVideoProgress(extra.progress ?? task.progress);
  const createdAt = Number(task.createdAt) || 0;
  const out = {
    status,
    provider,
    accountId: String(task.accountId || ''),
    createdAt,
    submittedAt: createdAt,
    canCancel: extra.canCancel === true || task.canCancel === true,
  };
  if (extra.videoUrl) out.videoUrl = extra.videoUrl;
  if (extra.note) out.note = extra.note;
  if (extra.error) out.error = extra.error;
  if (progress != null) {
    out.progress = progress;
    out.progressSource = 'remote';
  } else if (status === 'done') {
    out.progress = 100;
    out.progressSource = 'remote';
  }
  if (task.upstreamStatus) out.upstreamStatus = String(task.upstreamStatus);
  if (task.upstreamModel) out.upstreamModel = String(task.upstreamModel);
  if (Number(task.upstreamQuota) > 0) out.upstreamQuota = Number(task.upstreamQuota);
  const costUsd = upstreamCostUsd(task);
  if (costUsd != null) out.upstreamCostUsd = costUsd;
  const elapsedMs = upstreamElapsedMs(task);
  if (elapsedMs != null) out.upstreamElapsedMs = elapsedMs;
  return out;
}

function videoApiPendingStatus(task = {}, status = '', extra = {}) {
  const resolved = status || videoApiReportStatus(task);
  const progress = videoApiReportProgress(task, resolved);
  return pendingVideoStatus(task, 'video-api', resolved, {
    ...extra,
    ...(progress == null ? { omitProgress: true } : { progress }),
  });
}

function persistRemoteProgress(task, result = {}) {
  const progress = normalizeVideoProgress(result.progress);
  if (progress == null) return;
  updatePending(task.submitId, {
    progress,
    progressSource: 'remote',
    progressUpdatedAt: new Date().toISOString(),
  });
}

function currentTaskCommitOptions(task, options = {}) {
  return { ...options, shouldCommit: () => isCurrentPendingTask(task) };
}

// Neowow tasks are removed from the persistent queue only after both sides of
// the local commit have succeeded. A download can be valid while the project
// JSON is temporarily unavailable (for example, during another save), and
// dropping the task in that window makes the result impossible to recover.
async function commitNeowowVideo(task, result, options = {}) {
  const projectId = task.projectId;
  const episodeId = task.episodeId;
  const shotNo = task.shotNo;
  await saveVideoFromProviderResult(
    projectId,
    episodeId,
    shotNo,
    result,
    currentTaskCommitOptions(task, options),
  );
  if (!isCurrentPendingTask(task)) return null;
  if (!videoExists(projectId, episodeId, shotNo)) {
    throw new Error('视频已下载，但本地文件不存在');
  }
  const localUrl = videoLocalUrl(projectId, episodeId, shotNo);
  if (!persistShotVideo(projectId, episodeId, shotNo, localUrl)) {
    throw new Error('视频已下载，但项目记录写入失败');
  }
  return localUrl;
}

function markVideoApiJobShotRetrieved(task = {}) {
  const jobId = String(task.jobId || '').trim();
  if (!jobId) return;
  const job = getJob(jobId);
  if (!job) return;
  setJob(jobId, {
    retrievedShotNos: [...new Set([
      ...(Array.isArray(job.retrievedShotNos) ? job.retrievedShotNos : []),
      String(task.shotNo),
    ])],
  });
}

function restoreRecentVideoApiPendingJobs() {
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const cfg = loadConfig();
  const pendingShots = new Set(listPending().map((task) => `${task.projectId}:${task.episodeId}:${task.shotNo}`));
  for (const job of listJobs()) {
    if (job.provider !== 'video-api' || job.status !== 'done' || !job.projectId || job.episodeId == null) continue;
    const updatedAt = Date.parse(String(job.updatedAt || job.createdAt || ''));
    if (!Number.isFinite(updatedAt) || updatedAt < cutoff) continue;
    const ignored = new Set((Array.isArray(job.ignoredShotNos) ? job.ignoredShotNos : []).map(String));
    const retrieved = new Set((Array.isArray(job.retrievedShotNos) ? job.retrievedShotNos : []).map(String));
    for (const [shotNo, submit] of Object.entries(job.submits || {})) {
      const submitId = String(submit?.submitId || '').trim();
      const key = `${job.projectId}:${job.episodeId}:${shotNo}`;
      if (!submit?.ok || !submitId || ignored.has(String(shotNo)) || retrieved.has(String(shotNo))) continue;
      if (pendingShots.has(key) || videoExists(job.projectId, job.episodeId, shotNo)) continue;
      if (isPendingTrackingStopped(job.projectId, job.episodeId, shotNo)) continue;
      const restored = addPending({
        projectId: job.projectId,
        episodeId: job.episodeId,
        shotNo,
        submitId,
        historyId: submitId,
        accountId: submit.channelId || cfg.video?.apiActiveChannelId || 'video-api',
        provider: 'video-api',
        jobId: job.id,
        lastError: '应用已从提交记录恢复自动拉取',
      });
      if (!restored) continue;
      pendingShots.add(key);
      appendVideoApiLog({
        event: 'pending_restored_from_job',
        jobId: job.id,
        projectId: job.projectId,
        episodeId: job.episodeId,
        shotNo,
        submitId,
      });
    }
  }
}

// Statuses derived from the persisted pending store. Poll requests that land
// while a live provider cycle holds `pollRunning` used to get `{}` back, so
// the UI kept stale "queued" cards for minutes and never saw failures the
// background cycle had already recorded. The store always has the latest
// persisted state (failure + lastError, remote progress), and reading it is
// cheap — no CLI/network calls.
function pendingStoreStatuses(filterProject = null) {
  const statuses = {};
  const zombieSubmitIds = [];
  for (const task of listPending()) {
    if (filterProject && task.projectId !== filterProject) continue;
    if (task.projectType && task.projectType !== 'project') continue;
    if (!isVideoProvider(task.provider)) continue;
    const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
    // done 僵尸记录自愈：视频已在本地（如对账找回成功后未删记录）→ 清掉记录不再上报；
    // 本地还没有 → 上报 done+videoUrl 让前端落定到视频。
    // 绝不能把 done 报成 queued（进度 100% 的「已提交」会每次刷新复活，永远无法收尾）。
    if (task.status === 'done') {
      if (videoExists(task.projectId, task.episodeId, task.shotNo)) {
        zombieSubmitIds.push(task.submitId);
        continue;
      }
      statuses[key] = pendingVideoStatus(task, task.provider, 'done', { videoUrl: task.videoUrl || '' });
      continue;
    }
    statuses[key] = task.status === 'failed'
      ? pendingVideoStatus(task, task.provider, 'failed', { error: task.lastError || '视频生成失败' })
      : pendingVideoStatus(task, task.provider, 'queued', { note: task.lastError || '' });
  }
  for (const submitId of zombieSubmitIds) removePending(submitId);
  return statuses;
}

let updreamPollPromise = null;
let updreamPollScope = null;

function matchesUpdreamPollTarget(task, projectId, episodeId, shotNo) {
  if (projectId && task.projectId !== projectId) return false;
  if (episodeId != null && String(task.episodeId) !== String(episodeId)) return false;
  if (shotNo != null && String(task.shotNo) !== String(shotNo)) return false;
  return true;
}

function mergeFilteredVideoStatuses(statuses, freshStatuses, filterProject = null) {
  for (const [key, status] of Object.entries(freshStatuses || {})) {
    if (!filterProject || key.startsWith(`${filterProject}:`)) statuses[key] = status;
  }
  return statuses;
}

function updreamPollScopeCovers(active = {}, requested = {}) {
  return ['projectId', 'episodeId', 'shotNo'].every((field) => (
    active[field] == null
    || (requested[field] != null && String(active[field]) === String(requested[field]))
  ));
}

async function saveCompletedUpdreamTask(task, result, statuses, { cached = false } = {}) {
  if (!isCurrentPendingTask(task)) return;
  const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
  try {
    await saveVideoFromProviderResult(
      task.projectId,
      task.episodeId,
      task.shotNo,
      result,
      currentTaskCommitOptions(task, cached ? { retries: 1, timeoutMs: 45000 } : {}),
    );
    if (!isCurrentPendingTask(task)) return;
    const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
    persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
    statuses[key] = pendingVideoStatus(task, 'updream', 'done', { videoUrl: localUrl, progress: result.progress });
    removePending(task.submitId);
  } catch (error) {
    if (!isCurrentPendingTask(task)) return;
    updatePending(task.submitId, {
      ...persistedVideoSourceChanges(result),
      lastError: error.message,
      lastAttemptAt: new Date().toISOString(),
    });
    statuses[key] = pendingVideoStatus(task, 'updream', 'queued', {
      note: cached ? `直链下载失败，重新查询：${error.message}` : `下载失败：${error.message}`,
      progress: result.progress,
    });
  }
}

async function runPendingUpdreamVideos({ projectId = null, episodeId = null, shotNo = null } = {}) {
  const statuses = {};
  const cfg = loadConfig();
  const tasks = listUnfinished().filter((task) => (
    task.provider === 'updream'
    && matchesUpdreamPollTarget(task, projectId, episodeId, shotNo)
  ));
  if (!tasks.length) return statuses;

  const needFetch = [];
  await mapUpdreamWithConcurrency(tasks, 3, async (task) => {
    if (!isCurrentPendingTask(task)) return;
    if (providerRemoteVideoUrls(task).length) {
      await saveCompletedUpdreamTask(task, task, statuses, { cached: true });
      if (!isCurrentPendingTask(task)) return;
    }
    needFetch.push(task);
  });
  if (!needFetch.length) return statuses;

  try {
    const results = await fetchUpdreamVideoResults({
      config: cfg.video || {},
      submitIds: needFetch.map((task) => task.submitId),
      onTokens: persistUpdreamTokens,
    });
    const completed = [];
    for (const task of needFetch) {
      if (!isCurrentPendingTask(task)) continue;
      const result = results[task.submitId];
      const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
      if (!result) {
        statuses[key] = pendingVideoStatus(task, 'updream');
        continue;
      }
      persistRemoteProgress(task, result);
      if (result.status === 'done' && hasProviderVideoSource(result)) {
        updatePending(task.submitId, { remoteDone: true, ...persistedVideoSourceChanges(result) });
        completed.push({ task, result });
      } else if (result.status === 'failed') {
        updatePending(task.submitId, { status: 'failed', lastError: result.fail || 'UpDream 视频生成失败', lastAttemptAt: new Date().toISOString() });
        statuses[key] = pendingVideoStatus(task, 'updream', 'failed', { error: result.fail, progress: result.progress });
      } else if (result.status === 'done_no_url') {
        updatePending(task.submitId, { remoteDone: true });
        statuses[key] = pendingVideoStatus(task, 'updream', 'queued', { note: 'UpDream 已完成，正在等待视频文件', progress: result.progress });
      } else {
        statuses[key] = pendingVideoStatus(task, 'updream', 'queued', { note: result.note || '', progress: result.progress });
      }
    }
    await mapUpdreamWithConcurrency(completed, 3, ({ task, result }) => (
      saveCompletedUpdreamTask(task, result, statuses)
    ));
  } catch (error) {
    for (const task of needFetch) {
      if (isCurrentPendingTask(task)) {
        statuses[`${task.projectId}:${task.episodeId}:${task.shotNo}`] = pendingVideoStatus(task, 'updream', 'queued', { note: error.message });
      }
    }
  }
  return statuses;
}

export async function pollPendingUpdreamVideos(filterProject = null, options = {}) {
  const requestedScope = {
    projectId: filterProject,
    episodeId: options.episodeId ?? null,
    shotNo: options.shotNo ?? null,
  };
  if (updreamPollPromise) {
    const current = updreamPollPromise;
    const covered = updreamPollScopeCovers(updreamPollScope, requestedScope);
    const freshStatuses = await current;
    if (covered) return mergeFilteredVideoStatuses(pendingStoreStatuses(filterProject), freshStatuses, filterProject);
    return pollPendingUpdreamVideos(filterProject, options);
  }
  if (!updreamPollPromise) {
    const current = runPendingUpdreamVideos(requestedScope);
    updreamPollPromise = current;
    updreamPollScope = requestedScope;
    current.finally(() => {
      if (updreamPollPromise === current) {
        updreamPollPromise = null;
        updreamPollScope = null;
      }
    }).catch(() => {});
  }
  const freshStatuses = await updreamPollPromise;
  return mergeFilteredVideoStatuses(pendingStoreStatuses(filterProject), freshStatuses, filterProject);
}

let neowowPollPromise = null;

async function runPendingNeowowVideos() {
  const statuses = {};
  const cfg = loadConfig();
  const neowowByAccount = unfinishedByAccount('neowow');
  for (const [storedAccountId, tasks] of Object.entries(neowowByAccount)) {
    if (!tasks.length) continue;
    const accountId = normalizedNeowowAccountId(storedAccountId);
    let refreshPoints = false;

    const needFetch = [];
    for (const task of tasks) {
      if (!isCurrentPendingTask(task)) continue;
      const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
      if (providerRemoteVideoUrls(task).length) {
        try {
          const localUrl = await commitNeowowVideo(task, task, { retries: 1, timeoutMs: 60_000 });
          if (!localUrl) continue;
          statuses[key] = pendingVideoStatus(task, 'neowow', 'done', { videoUrl: localUrl });
          removePending(task.submitId);
          refreshPoints = true;
          continue;
        } catch (error) {
          if (!isCurrentPendingTask(task)) continue;
          statuses[key] = pendingVideoStatus(task, 'neowow', 'queued', { note: `直链下载失败，重新查询：${error.message}` });
        }
      }
      needFetch.push(task);
    }
    if (!needFetch.length) {
      if (refreshPoints && accountId) void refreshNeowowAccount(accountId).catch(() => {});
      continue;
    }

    try {
      const accountConfig = neowowConfigForAccount(accountId, cfg);
      const results = await fetchNeowowVideoResults({
        config: accountConfig,
        submitIds: needFetch.map((task) => task.submitId),
        tasks: needFetch,
      });
      for (const task of needFetch) {
        if (!isCurrentPendingTask(task)) continue;
        const result = results[task.submitId];
        const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
        if (!result) {
          statuses[key] = pendingVideoStatus(task, 'neowow');
          continue;
        }
        persistRemoteProgress(task, result);
        if (result.status === 'done' && hasProviderVideoSource(result)) {
          updatePending(task.submitId, { remoteDone: true, ...persistedVideoSourceChanges(result) });
          try {
            const localUrl = await commitNeowowVideo(task, result);
            if (!localUrl) continue;
            statuses[key] = pendingVideoStatus(task, 'neowow', 'done', { videoUrl: localUrl, progress: result.progress });
            removePending(task.submitId);
            refreshPoints = true;
          } catch (error) {
            if (!isCurrentPendingTask(task)) continue;
            updatePending(task.submitId, { ...persistedVideoSourceChanges(result), lastError: error.message, lastAttemptAt: new Date().toISOString() });
            statuses[key] = pendingVideoStatus(task, 'neowow', 'queued', { note: `下载失败：${error.message}`, progress: result.progress });
          }
        } else if (result.status === 'failed') {
          const failure = result.fail || 'Neowow 视频生成失败';
          updatePending(task.submitId, { status: 'failed', lastError: failure, lastAttemptAt: new Date().toISOString() });
          statuses[key] = pendingVideoStatus(task, 'neowow', 'failed', { error: failure, progress: result.progress });
          refreshPoints = true;
        } else if (result.status === 'done_no_url') {
          updatePending(task.submitId, { remoteDone: true });
          statuses[key] = pendingVideoStatus(task, 'neowow', 'queued', { note: 'Neowow 已完成，正在等待视频文件', progress: result.progress });
        } else {
          statuses[key] = pendingVideoStatus(task, 'neowow', 'queued', { note: result.note || '', progress: result.progress });
        }
      }
    } catch (error) {
      if (accountId && isNeowowAuthError(error)) {
        try { markNeowowAccountStatus(accountId, 'expired', error.message); } catch { /* account may have been removed */ }
      }
      for (const task of needFetch) {
        if (isCurrentPendingTask(task)) {
          const accountName = findNeowowAccount(accountId)?.name || '原提交账号';
          const note = isNeowowAuthError(error)
            ? `${accountName} 登录已失效；重新登录该账号后会继续拉取`
            : error.message;
          statuses[`${task.projectId}:${task.episodeId}:${task.shotNo}`] = pendingVideoStatus(task, 'neowow', 'queued', { note });
        }
      }
    }
    if (refreshPoints && accountId) void refreshNeowowAccount(accountId).catch(() => {});
  }
  return statuses;
}

export async function pollPendingNeowowVideos(filterProject = null) {
  if (!neowowPollPromise) {
    const current = runPendingNeowowVideos();
    neowowPollPromise = current;
    current.finally(() => {
      if (neowowPollPromise === current) neowowPollPromise = null;
    }).catch(() => {});
  }
  const freshStatuses = await neowowPollPromise;
  return mergeFilteredVideoStatuses(pendingStoreStatuses(filterProject), freshStatuses, filterProject);
}

let libtvPollPromise = null;

async function runPendingLibtvVideos(filterProject = null) {
  const statuses = {};
  const cfg = loadConfig();
  const tasks = listUnfinished().filter((task) => (
    task.provider === 'libtv-cli' && (!filterProject || task.projectId === filterProject)
  ));
  for (const task of tasks) {
    if (!isCurrentPendingTask(task)) continue;
    const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
    let result = providerRemoteVideoUrls(task).length ? task : null;
    try {
      if (providerRemoteVideoUrls(task).length) {
        try {
          await saveVideoFromProviderResult(
            task.projectId,
            task.episodeId,
            task.shotNo,
            task,
            currentTaskCommitOptions(task, { retries: 2, timeoutMs: 120_000 }),
          );
        } catch {
          result = null;
        }
      }
      if (!result) {
        const projectUuid = String(task.remoteProjectId || cfg.video?.libtvProjectUuid || '').trim();
        result = await fetchLibtvVideoResult({
          projectUuid,
          nodeName: task.submitId,
        });
        await saveVideoFromProviderResult(
          task.projectId,
          task.episodeId,
          task.shotNo,
          result,
          currentTaskCommitOptions(task, { retries: 2, timeoutMs: 120_000 }),
        );
      }
      if (!isCurrentPendingTask(task)) continue;
      const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
      persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
      statuses[key] = pendingVideoStatus(task, 'libtv-cli', 'done', { videoUrl: localUrl, progress: 100 });
      removePending(task.submitId);
    } catch (error) {
      if (!isCurrentPendingTask(task)) continue;
      updatePending(task.submitId, {
        ...(result && result !== task ? persistedVideoSourceChanges(result) : {}),
        lastError: error.message,
        lastAttemptAt: new Date().toISOString(),
      });
      statuses[key] = pendingVideoStatus(task, 'libtv-cli', 'queued', { note: `下载失败：${error.message}` });
    } finally {
      if (result?.cleanupDir) await fs.promises.rm(result.cleanupDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return statuses;
}

export async function pollPendingLibtvVideos(filterProject = null) {
  if (!libtvPollPromise) {
    const current = runPendingLibtvVideos(filterProject);
    libtvPollPromise = current;
    current.finally(() => {
      if (libtvPollPromise === current) libtvPollPromise = null;
    }).catch(() => {});
  }
  const freshStatuses = await libtvPollPromise;
  return mergeFilteredVideoStatuses(pendingStoreStatuses(filterProject), freshStatuses, filterProject);
}

let comfyUiPollPromise = null;

async function runPendingComfyUiVideos(filterProject = null) {
  const statuses = {};
  const cfg = loadConfig();
  const tasks = listUnfinished().filter((task) => (
    task.provider === 'comfyui' && (!filterProject || task.projectId === filterProject)
  ));
  for (const task of tasks) {
    if (!isCurrentPendingTask(task)) continue;
    const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
    try {
      const baseUrl = normalizeComfyUiBaseUrl(task.remoteProjectId || cfg.video?.comfyuiBaseUrl, '');
      if (!baseUrl) throw new Error('ComfyUI 云端地址缺失');
      const history = await getComfyUiHistory(baseUrl, task.submitId);
      const remote = comfyUiHistoryStatus(history);
      if (remote.failed) {
        const failure = remote.error || 'ComfyUI 视频生成失败';
        updatePending(task.submitId, { status: 'failed', lastError: failure, lastAttemptAt: new Date().toISOString() });
        statuses[key] = pendingVideoStatus(task, 'comfyui', 'failed', { error: failure });
        continue;
      }
      if (!remote.completed) {
        statuses[key] = pendingVideoStatus(task, 'comfyui', 'queued', { note: remote.status ? `ComfyUI：${remote.status}` : 'ComfyUI 队列处理中' });
        continue;
      }
      const videoUrls = comfyUiResultVideoUrls(history, baseUrl);
      if (!videoUrls.length) {
        statuses[key] = pendingVideoStatus(task, 'comfyui', 'queued', { note: 'ComfyUI 已完成，正在等待视频文件' });
        continue;
      }
      updatePending(task.submitId, { remoteDone: true, videoUrl: videoUrls[0], videoUrls });
      await saveVideoFromProviderResult(
        task.projectId,
        task.episodeId,
        task.shotNo,
        { videoUrl: videoUrls[0], videoUrls },
        currentTaskCommitOptions(task, { retries: 2, timeoutMs: 120_000 }),
      );
      if (!isCurrentPendingTask(task)) continue;
      const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
      persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
      statuses[key] = pendingVideoStatus(task, 'comfyui', 'done', { videoUrl: localUrl, progress: 100 });
      removePending(task.submitId);
    } catch (error) {
      if (!isCurrentPendingTask(task)) continue;
      updatePending(task.submitId, { lastError: error.message, lastAttemptAt: new Date().toISOString() });
      statuses[key] = pendingVideoStatus(task, 'comfyui', 'queued', { note: error.message });
    }
  }
  return statuses;
}

export async function pollPendingComfyUiVideos(filterProject = null) {
  if (!comfyUiPollPromise) {
    const current = runPendingComfyUiVideos(filterProject);
    comfyUiPollPromise = current;
    current.finally(() => {
      if (comfyUiPollPromise === current) comfyUiPollPromise = null;
    }).catch(() => {});
  }
  const freshStatuses = await comfyUiPollPromise;
  return mergeFilteredVideoStatuses(pendingStoreStatuses(filterProject), freshStatuses, filterProject);
}

export async function pollPendingVideos(filterProject = null) {
  const statuses = {};
  const updreamStatusesPromise = pollPendingUpdreamVideos(filterProject);
  const neowowStatusesPromise = pollPendingNeowowVideos(filterProject);
  const libtvStatusesPromise = pollPendingLibtvVideos(filterProject);
  const comfyUiStatusesPromise = pollPendingComfyUiVideos(filterProject);
  if (pollRunning) {
    const [updreamStatuses, neowowStatuses, libtvStatuses, comfyUiStatuses] = await Promise.all([
      updreamStatusesPromise,
      neowowStatusesPromise,
      libtvStatusesPromise,
      comfyUiStatusesPromise,
    ]);
    return mergeFilteredVideoStatuses(
      mergeFilteredVideoStatuses(
        mergeFilteredVideoStatuses(updreamStatuses, neowowStatuses, filterProject),
        libtvStatuses,
        filterProject,
      ),
      comfyUiStatuses,
      filterProject,
    );
  }
  pollRunning = true;
  try {
    const cfg = loadConfig();
    if (filterProject) {
      const now = Date.now();
      const lastRecoveryAt = Number(dreaminaRecoveryAt.get(filterProject)) || 0;
      if (now - lastRecoveryAt >= DREAMINA_RECOVERY_INTERVAL_MS) {
        dreaminaRecoveryAt.set(filterProject, now);
        try {
          await recoverDreaminaPendingForProject(filterProject, statuses);
        } catch (e) {
          console.warn(`[dreamina] recover pending failed: ${e.message}`);
        }
      }
    }
    // video-api（rolldek / new-api 网关）渠道：poll 此前没有上游查询分支，进度/状态永不更新。
    // 现在借上游任务列表同步真实状态与进度（未配置令牌时静默跳过）。
    try {
      const videoApiPendings = listPending().filter((t) => (
        t.provider === 'video-api' && (!filterProject || t.projectId === filterProject)
      ));
      if (videoApiPendings.length) {
        await syncUpstreamStatusFromRemote({ projectId: filterProject || undefined });
      }
    } catch (e) {
      console.warn(`[video-api] 上游状态同步失败（忽略）: ${e.message}`);
    }
    const xyqByAccount = unfinishedByAccount('xiaoyunque');
    for (const [accountId, pendings] of Object.entries(xyqByAccount)) {
      const tasks = filterProject ? pendings.filter((task) => task.projectId === filterProject) : pendings;
      if (!tasks.length) continue;

      const account = findXiaoyunqueAccountById(accountId);
      if (!account) {
        for (const task of tasks) {
          if (!isCurrentPendingTask(task)) continue;
          updatePending(task.submitId, { status: 'failed', lastError: '视频账号不可用，请重新抓取或重新生成', lastAttemptAt: new Date().toISOString() });
          statuses[`${task.projectId}:${task.episodeId}:${task.shotNo}`] = pendingVideoStatus(task, 'xiaoyunque', 'failed', { error: '视频账号不可用，请重新抓取或重新生成' });
        }
        continue;
      }
      const submitIds = tasks.map((task) => task.submitId);
      try {
        const results = await fetchXiaoyunqueVideoResults({ account, submitIds });
        for (const task of tasks) {
          if (!isCurrentPendingTask(task)) continue;
          const result = results[task.submitId];
          const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
          if (!result) { statuses[key] = pendingVideoStatus(task, 'xiaoyunque'); continue; }
          if (result.status === 'done' && hasProviderVideoSource(result)) {
            try {
              await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, result, currentTaskCommitOptions(task));
              if (!isCurrentPendingTask(task)) continue;
              const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
              persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
              statuses[key] = pendingVideoStatus(task, 'xiaoyunque', 'done', { videoUrl: localUrl, progress: result.progress });
              removePending(task.submitId);
            } catch (e) {
              if (!isCurrentPendingTask(task)) continue;
              if (providerRemoteVideoUrls(result).length) updatePending(task.submitId, { ...persistedVideoSourceChanges(result), lastError: e.message, lastAttemptAt: new Date().toISOString() });
              statuses[key] = pendingVideoStatus(task, 'xiaoyunque', 'queued', { note: `下载失败: ${e.message}`, progress: result.progress });
            }
          } else if (result.status === 'failed') {
            updatePending(task.submitId, { status: 'failed', lastError: result.fail || '视频生成失败', lastAttemptAt: new Date().toISOString() });
            statuses[key] = pendingVideoStatus(task, 'xiaoyunque', 'failed', { error: result.fail, progress: result.progress });
          } else if (result.status === 'done_no_url') {
            statuses[key] = pendingVideoStatus(task, 'xiaoyunque', 'queued', { note: '小云雀显示已完成，正在等待视频文件', progress: result.progress });
          } else {
            statuses[key] = pendingVideoStatus(task, 'xiaoyunque', 'queued', { progress: result.progress });
          }
        }
      } catch (e) {
        for (const task of tasks) {
          if (isCurrentPendingTask(task)) statuses[`${task.projectId}:${task.episodeId}:${task.shotNo}`] = pendingVideoStatus(task, 'xiaoyunque', 'queued', { note: e.message });
        }
      }
    }

    const dreaminaByAccount = unfinishedByAccount('dreamina-cli');
    for (const [, pendings] of Object.entries(dreaminaByAccount)) {
      const tasks = filterProject ? pendings.filter((task) => task.projectId === filterProject) : pendings;
      if (!tasks.length) continue;

      const needFetch = [];
      for (const task of tasks) {
        if (!isCurrentPendingTask(task)) continue;
        const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
        if (providerRemoteVideoUrls(task).length) {
          try {
            await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, task, currentTaskCommitOptions(task, { retries: 1, timeoutMs: 45000 }));
            if (!isCurrentPendingTask(task)) continue;
            const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
            persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
            statuses[key] = pendingVideoStatus(task, 'dreamina-cli', 'done', { videoUrl: localUrl });
            removePending(task.submitId);
            continue;
          } catch (e) {
            if (!isCurrentPendingTask(task)) continue;
            statuses[key] = pendingVideoStatus(task, 'dreamina-cli', 'queued', { note: `直链下载失败，重新查询: ${e.message}` });
          }
        }
        needFetch.push(task);
      }
      if (!needFetch.length) continue;

      const submitIds = needFetch.map((task) => task.submitId);
      try {
        const results = await fetchDreaminaVideoResults({ submitIds });
        for (const task of needFetch) {
          if (!isCurrentPendingTask(task)) continue;
          const result = results[task.submitId];
          const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
          if (!result) { statuses[key] = pendingVideoStatus(task, 'dreamina-cli'); continue; }
          persistRemoteProgress(task, result);
          if (result.status === 'done' && hasProviderVideoSource(result)) {
            try {
              await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, result, currentTaskCommitOptions(task));
              if (!isCurrentPendingTask(task)) continue;
              const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
              persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
              statuses[key] = pendingVideoStatus(task, 'dreamina-cli', 'done', { videoUrl: localUrl, progress: result.progress });
              removePending(task.submitId);
            } catch (e) {
              if (!isCurrentPendingTask(task)) continue;
              if (providerRemoteVideoUrls(result).length) updatePending(task.submitId, { ...persistedVideoSourceChanges(result), lastError: e.message, lastAttemptAt: new Date().toISOString() });
              statuses[key] = pendingVideoStatus(task, 'dreamina-cli', 'queued', { note: `下载失败: ${e.message}`, progress: result.progress });
            }
          } else if (result.status === 'failed') {
            updatePending(task.submitId, { status: 'failed', lastError: result.fail || '视频生成失败', lastAttemptAt: new Date().toISOString() });
            statuses[key] = pendingVideoStatus(task, 'dreamina-cli', 'failed', { error: result.fail, progress: result.progress });
          } else if (result.status === 'done_no_url') {
            statuses[key] = pendingVideoStatus(task, 'dreamina-cli', 'queued', { note: 'Dreamina CLI 显示已完成，正在等待视频文件', progress: result.progress });
          } else {
            statuses[key] = pendingVideoStatus(task, 'dreamina-cli', 'queued', { progress: result.progress });
          }
        }
      } catch (e) {
        for (const task of needFetch) {
          if (isCurrentPendingTask(task)) statuses[`${task.projectId}:${task.episodeId}:${task.shotNo}`] = pendingVideoStatus(task, 'dreamina-cli', 'queued', { note: e.message });
        }
      }
    }

    const dreaminaAgentByAccount = unfinishedByAccount('dreamina-agent');
    for (const [accountId, pendings] of Object.entries(dreaminaAgentByAccount)) {
      const tasks = filterProject ? pendings.filter((task) => task.projectId === filterProject) : pendings;
      if (!tasks.length) continue;

      const needFetch = [];
      for (const task of tasks) {
        if (!isCurrentPendingTask(task)) continue;
        const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
        const cachedVideoUrls = providerRemoteVideoUrls(task)
          .filter((url) => !/(?:mime_type=audio|\.(?:mp3|m4a|wav|aac|flac)(?:$|\?))/i.test(url));
        if (cachedVideoUrls.length !== providerRemoteVideoUrls(task).length) {
          updatePending(task.submitId, { videoUrl: cachedVideoUrls[0] || '', videoUrls: cachedVideoUrls, lastError: '', lastAttemptAt: new Date().toISOString() });
        }
        if (cachedVideoUrls.length) {
          try {
            await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, { videoUrls: cachedVideoUrls }, currentTaskCommitOptions(task, { retries: 2, timeoutMs: 120000 }));
            if (!isCurrentPendingTask(task)) continue;
            const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
            persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
            statuses[key] = pendingVideoStatus(task, 'dreamina-agent', 'done', { videoUrl: localUrl });
            removePending(task.submitId);
            continue;
          } catch (error) {
            if (!isCurrentPendingTask(task)) continue;
            statuses[key] = pendingVideoStatus(task, 'dreamina-agent', 'queued', { note: `下载失败，准备重新读取官网地址：${error.message}` });
          }
        }
        needFetch.push(task);
      }
      if (!needFetch.length) continue;

      try {
        const results = await fetchDreaminaAgentVideoResults({
          accountId,
          submitIds: needFetch.map((task) => task.submitId),
        });
        for (const task of needFetch) {
          if (!isCurrentPendingTask(task)) continue;
          const result = results[task.submitId];
          const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
          if (!result) {
            statuses[key] = pendingVideoStatus(task, 'dreamina-agent');
            continue;
          }
          persistRemoteProgress(task, result);
          if (result.status === 'done' && hasProviderVideoSource(result)) {
            try {
              await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, result, currentTaskCommitOptions(task));
              if (!isCurrentPendingTask(task)) continue;
              const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
              persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
              statuses[key] = pendingVideoStatus(task, 'dreamina-agent', 'done', { videoUrl: localUrl, progress: 100 });
              removePending(task.submitId);
            } catch (error) {
              if (!isCurrentPendingTask(task)) continue;
              updatePending(task.submitId, { ...persistedVideoSourceChanges(result), lastError: error.message, lastAttemptAt: new Date().toISOString() });
              statuses[key] = pendingVideoStatus(task, 'dreamina-agent', 'queued', { note: `下载失败：${error.message}`, progress: result.progress });
            }
          } else if (result.status === 'failed') {
            const failure = result.fail || '即梦 Agent 视频生成失败';
            updatePending(task.submitId, { status: 'failed', lastError: failure, lastAttemptAt: new Date().toISOString() });
            statuses[key] = pendingVideoStatus(task, 'dreamina-agent', 'failed', { error: failure, progress: result.progress });
          } else {
            statuses[key] = pendingVideoStatus(task, 'dreamina-agent', 'queued', {
              note: result.fail && result.status !== 'failed' ? result.fail : '',
              progress: result.progress,
            });
          }
        }
      } catch (error) {
        for (const task of needFetch) {
          if (isCurrentPendingTask(task)) {
            statuses[`${task.projectId}:${task.episodeId}:${task.shotNo}`] = pendingVideoStatus(task, 'dreamina-agent', 'queued', { note: error.message });
          }
        }
      }
    }

    const videoApiByAccount = unfinishedByAccount('video-api');
    for (const [channelId, pendings] of Object.entries(videoApiByAccount)) {
      const tasks = filterProject ? pendings.filter((task) => task.projectId === filterProject) : pendings;
      if (!tasks.length) continue;

      const needFetch = [];
      for (const task of tasks) {
        if (!isCurrentPendingTask(task)) continue;
        const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
        // 兜底上报：先按上游任务日志发一个状态，再让下面的查询/下载分支覆盖。
        // 少了这一层，任何「分支都没产出」的镜头会在前端的 statuses 里凭空消失，
        // 连续三轮收不到就被 PENDING_MISS_LIMIT 判成「后台没有可拉回任务」→ 误报失败。
        statuses[key] = videoApiPendingStatus(task);
        if (providerRemoteVideoUrls(task).length) {
          try {
            await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, task, currentTaskCommitOptions(task, { retries: 1, timeoutMs: 45000 }));
            if (!isCurrentPendingTask(task)) continue;
            const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
            persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
            statuses[key] = videoApiPendingStatus(task, 'done', { videoUrl: localUrl });
            markVideoApiJobShotRetrieved(task);
            removePending(task.submitId);
            continue;
          } catch (e) {
            if (!isCurrentPendingTask(task)) continue;
            statuses[key] = videoApiPendingStatus(task, '', { note: `直链下载失败，重新查询: ${e.message}` });
          }
        }
        needFetch.push(task);
      }
      if (!needFetch.length) continue;

      try {
        const apiConfig = resolveVideoApiChannel(cfg.video || {}, channelId) || cfg.video || {};
        const results = await fetchVideoApiResults({ apiConfig, submitIds: needFetch.map((task) => task.submitId) });
        for (const task of needFetch) {
          if (!isCurrentPendingTask(task)) continue;
          const result = results[task.submitId];
          const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
          if (!result) { statuses[key] = videoApiPendingStatus(task); continue; }
          if (result.status === 'done' && hasProviderVideoSource(result)) {
            try {
              await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, result, currentTaskCommitOptions(task));
              if (!isCurrentPendingTask(task)) continue;
              const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
              persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
              statuses[key] = videoApiPendingStatus(task, 'done', { videoUrl: localUrl });
              markVideoApiJobShotRetrieved(task);
              removePending(task.submitId);
            } catch (e) {
              if (!isCurrentPendingTask(task)) continue;
              updatePending(task.submitId, { ...persistedVideoSourceChanges(result), lastError: e.message, lastAttemptAt: new Date().toISOString() });
              statuses[key] = videoApiPendingStatus(task, '', { note: `下载失败: ${e.message}` });
            }
          } else if (result.status === 'failed') {
            updatePending(task.submitId, { status: 'failed', lastError: result.fail || '视频生成失败', lastAttemptAt: new Date().toISOString() });
            statuses[key] = videoApiPendingStatus(task, 'failed', { error: result.fail });
          } else if (result.status === 'done_no_url') {
            statuses[key] = videoApiPendingStatus(task, '', { note: '视频 API 显示已完成，正在等待视频文件' });
          } else {
            statuses[key] = videoApiPendingStatus(task, '', { note: result.note || '' });
          }
        }
      } catch (e) {
        for (const task of needFetch) {
          if (isCurrentPendingTask(task)) statuses[`${task.projectId}:${task.episodeId}:${task.shotNo}`] = videoApiPendingStatus(task, '', { note: e.message });
        }
      }
    }

    // done 竞态收尾：syncUpstreamStatusFromRemote 会先于下载把记录标成 done，
    // 而 unfinishedByAccount 不含 done——这些记录永远不会被上面的分支下载落盘。
    // 这里补一次下载（有远程直链才尝试），成功即清记录，杜绝「已提交 100%」僵尸。
    const doneVideoApiTasks = listPending().filter((t) => (
      t.status === 'done'
      && t.provider === 'video-api'
      && (!filterProject || t.projectId === filterProject)
      && !(t.projectType && t.projectType !== 'project')
    ));
    for (const task of doneVideoApiTasks) {
      if (!isCurrentPendingTask(task)) continue;
      if (!providerRemoteVideoUrls(task).length) continue;
      const key = `${task.projectId}:${task.episodeId}:${task.shotNo}`;
      if (statuses[key]) continue; // 活跃分支已处理
      try {
        await saveVideoFromProviderResult(task.projectId, task.episodeId, task.shotNo, task, currentTaskCommitOptions(task, { retries: 1, timeoutMs: 45000 }));
        if (!isCurrentPendingTask(task)) continue;
        const localUrl = videoLocalUrl(task.projectId, task.episodeId, task.shotNo);
        persistShotVideo(task.projectId, task.episodeId, task.shotNo, localUrl);
        statuses[key] = pendingVideoStatus(task, 'video-api', 'done', { videoUrl: localUrl, progress: 100 });
        removePending(task.submitId);
      } catch { /* 下载失败保留记录；snapshot 会按 done+videoUrl 上报，下轮再试 */ }
    }
  } finally {
    pollRunning = false;
  }
  const [updreamStatuses, neowowStatuses, libtvStatuses, comfyUiStatuses] = await Promise.all([
    updreamStatusesPromise,
    neowowStatusesPromise,
    libtvStatusesPromise,
    comfyUiStatusesPromise,
  ]);
  for (const [key, status] of Object.entries(updreamStatuses)) {
    if (status.provider === 'updream') statuses[key] = status;
  }
  for (const [key, status] of Object.entries(neowowStatuses)) {
    if (status.provider === 'neowow') statuses[key] = status;
  }
  for (const [key, status] of Object.entries(libtvStatuses)) {
    if (status.provider === 'libtv-cli') statuses[key] = status;
  }
  for (const [key, status] of Object.entries(comfyUiStatuses)) {
    if (status.provider === 'comfyui') statuses[key] = status;
  }
  startUpdreamSubmissionQueue();
  startNeowowSubmissionQueue();
  startComfyUiSubmissionQueue();
  // Failed tasks leave listUnfinished(), so the live cycle above only reports
  // a failure once — in the very cycle that detected it (usually the background
  // tick, whose statuses nobody reads). Merge the store snapshot so failures
  // and queued progress keep reaching every client poll until cleared/retried.
  const snapshot = pendingStoreStatuses(filterProject);
  for (const [key, status] of Object.entries(snapshot)) {
    if (!statuses[key]) statuses[key] = status;
  }
  return statuses;
}

let pollTimer = null;
export function startBackgroundPoll() {
  if (pollTimer) return;
  restoreRecentVideoApiPendingJobs();
  const tick = () => {
    startDreaminaAgentSubmissionQueue();
    startUpdreamSubmissionQueue();
    startNeowowSubmissionQueue();
    startComfyUiSubmissionQueue();
    if (!listUnfinished().length) return;
    pollPendingVideos(null).catch(() => {});
  };
  tick();
  pollTimer = setInterval(tick, 5 * 1000);
  pollTimer.unref?.();
}


// ---- 上游任务日志（rolldek / new-api 网关）----
// 这是 video-api 渠道状态与进度的唯一真相来源。后端 5s 后台 tick、前端 5s 轮询、
// settle 每 60s 同步都会走到这里，所以同一窗口的抓取结果在 TTL 内复用。
const UPSTREAM_TASK_LIST_TTL_MS = 10 * 1000;
let upstreamTaskListCache = null; // { key, items, fetchedAt }

async function fetchUpstreamTaskList({ base, token, userId, start, end, force = false } = {}) {
  const key = `${base}|${start}|${end}`;
  if (!force && upstreamTaskListCache && upstreamTaskListCache.key === key
    && Date.now() - upstreamTaskListCache.fetchedAt < UPSTREAM_TASK_LIST_TTL_MS) {
    return upstreamTaskListCache.items;
  }
  const items = [];
  for (let p = 1; p <= 50; p++) {
    const url = base + '/api/task/self?p=' + p + '&page_size=100&start_timestamp=' + start + '&end_timestamp=' + end;
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token, 'New-Api-User': userId, Accept: 'application/json' } });
    if (!res.ok) throw new Error('上游任务列表请求失败：HTTP ' + res.status);
    const json = await res.json();
    if (json?.success === false) throw new Error('上游返回错误：' + (json?.message || '未知'));
    const page = json?.data?.items || [];
    items.push(...page);
    if (page.length < 100) break;
  }
  upstreamTaskListCache = { key, items, fetchedAt: Date.now() };
  return items;
}

// ---- 上游视频对账找回（rolldek / new-api 网关）----
// 场景：提交成功但本地没拉回落盘（强杀/断网/下载失败）的视频，从上游任务列表兜底找回。
// 匹配依据：本地 pending 记录的 submitId 就是上游 task_id（submitIdFromJson 存入）。
export async function reconcileVideosFromUpstream({ projectId, startTimestamp, endTimestamp } = {}) {
  if (!projectId) throw new Error('缺少 projectId');
  const cfg = loadConfig();
  const token = String(cfg.video?.upstreamAccessToken || '').trim();
  const userId = String(cfg.video?.upstreamUserId || '').trim();
  if (!token || !userId) throw new Error('请先在设置 → 视频生成里配置上游访问令牌与用户 ID');
  const base = String(cfg.video?.upstreamBaseUrl || 'https://rolldek.com').replace(/\/+$/, '');
  const end = Number(endTimestamp) || Math.floor(Date.now() / 1000);
  const start = Number(startTimestamp) || end - 7 * 24 * 3600; // 默认近 7 天

  // 1. 分页拉取上游任务列表（人工对账入口，强制刷新不吃 TTL）
  const upstreamTasks = await fetchUpstreamTaskList({ base, token, userId, start, end, force: true });
  const byTaskId = new Map(upstreamTasks.map((t) => [String(t.task_id), t]));

  // 2. 遍历本项目 pending 记录，找「本地无视频 + 上游成功」的镜头
  const records = listPending().filter((t) => t.projectId === projectId);
  let scanned = 0;
  let alreadyLocal = 0;
  let noUpstream = 0;
  let upstreamFailed = 0;
  let recovered = 0;
  const failures = [];
  const recoveredShots = [];
  for (const rec of records) {
    scanned += 1;
    const shotNo = rec.shotNo;
    const episodeId = rec.episodeId;
    if (videoExists(projectId, episodeId, shotNo)) {
      alreadyLocal += 1;
      continue;
    }
    const upstream = byTaskId.get(String(rec.submitId || ''));
    if (!upstream) {
      noUpstream += 1;
      continue;
    }
    if (String(upstream.status || '').toUpperCase() !== 'SUCCESS') {
      upstreamFailed += 1;
      continue;
    }
    const videoUrl = String(upstream.result_url || '').trim();
    if (!/^https?:\/\//i.test(videoUrl)) {
      upstreamFailed += 1;
      continue;
    }
    try {
      // 上游文件有防盗链：下载必须带 Referer
      await saveVideoFromProviderResult(
        projectId,
        episodeId,
        shotNo,
        { videoUrl },
        { headers: { Referer: base + '/' }, retries: 2, timeoutMs: 180000, probeTimeoutMs: 30000 },
      );
      const localUrl = videoLocalUrl(projectId, episodeId, shotNo);
      if (!persistShotVideo(projectId, episodeId, shotNo, localUrl)) {
        throw new Error('视频已下载，但项目记录写入失败');
      }
      // 找回成功后清掉对应 pending 记录，否则留下 done 僵尸记录，
      // 会被 pendingStoreStatuses 当成 queued/100% 持续上报（「已提交」僵死复现）
      if (rec.submitId) removePending(rec.submitId);
      recovered += 1;
      recoveredShots.push({ episodeId, shotNo });
    } catch (error) {
      failures.push({ episodeId, shotNo, error: error?.message || String(error) });
    }
  }
  return {
    upstreamScanned: upstreamTasks.length,
    localScanned: scanned,
    alreadyLocal,
    noUpstream,
    upstreamFailed,
    recovered,
    recoveredShots,
    failures,
  };
}


// 清理「已完成且视频已落盘」的僵尸待办记录（对账找回后遗留、或下载竞态残留）。
// 这些记录会被前端 hydrate 当成 queued 复活成「已提交 100%」，必须清掉。
export function pruneCompletedVideoPendingRecords() {
  let removed = 0;
  try {
    const stale = [];
    for (const task of listPending()) {
      if (task.status !== 'done') continue;
      if (task.projectType && task.projectType !== 'project') continue;
      if (!isVideoProvider(task.provider)) continue;
      if (videoExists(task.projectId, task.episodeId, task.shotNo)) stale.push(task.submitId);
    }
    for (const submitId of stale) {
      removePending(submitId);
      removed += 1;
    }
  } catch { /* best effort */ }
  return removed;
}

// ---- 上游真实状态同步：把本地 pending 的状态刷新成上游任务的真实状态 ----
// 用途：本地「假状态」（推断的 queued/failed）以上游为准；settle 判定、失败原因、进度全部真实化。
// 注意：记录的 status 只表示「这条还要不要继续跟踪」（listUnfinished() 只认 queued），
// 上游真实状态单独记在 upstreamStatus 里，上报时再由 videoApiReportStatus 翻译——不要写成 'running'。
export async function syncUpstreamStatusFromRemote({ projectId, startTimestamp, endTimestamp } = {}) {
  const cfg = loadConfig();
  const token = String(cfg.video?.upstreamAccessToken || '').trim();
  const userId = String(cfg.video?.upstreamUserId || '').trim();
  if (!token || !userId) throw new Error('未配置上游访问令牌与用户 ID');
  const base = String(cfg.video?.upstreamBaseUrl || 'https://rolldek.com').replace(/\/+$/, '');
  const end = Number(endTimestamp) || Math.floor(Date.now() / 1000);

  // 无项目过滤（后台 tick）时必须扫全量记录：此前写的是 t.projectId === projectId，
  // 而 projectId 是 undefined，字符串永远不等于它 → records 恒为空，后台轮询的上游同步一直空转。
  const records = projectId ? listPending().filter((t) => t.projectId === projectId) : listPending();
  const activeRecords = records.filter((t) => t.status !== 'done');
  const updated = { done: 0, failed: 0, running: 0, queued: 0 };
  if (!activeRecords.length) {
    return { upstreamScanned: 0, localScanned: records.length, updated, unchanged: 0, noMatch: 0 };
  }

  // 窗口只需覆盖最老的在跟踪记录，不必每次拉满 7 天。
  const oldestCreatedAt = activeRecords.reduce(
    (min, t) => Math.min(min, Number(t.createdAt) || Infinity),
    Infinity,
  );
  const start = Number(startTimestamp) || (Number.isFinite(oldestCreatedAt)
    ? Math.max(end - 7 * 24 * 3600, Math.floor(oldestCreatedAt / 1000) - 3600)
    : end - 24 * 3600);

  const upstreamTasks = await fetchUpstreamTaskList({ base, token, userId, start, end });
  const byTaskId = new Map(upstreamTasks.map((t) => [String(t.task_id), t]));

  let unchanged = 0;
  let noMatch = 0;
  for (const rec of records) {
    if (rec.status === 'done') { unchanged += 1; continue; } // 已拉回的不再动
    const upstream = byTaskId.get(String(rec.submitId || ''));
    if (!upstream) {
      // 归一化：旧版本会把上游生成中的记录写成 status:'running'，这种记录会被
      // listUnfinished() 过滤掉、永远上不了报。上游查不到时退回可跟踪状态，
      // 顺带清掉可能已经过期的 upstreamStatus，避免永远显示「生成中」。
      if (rec.status === 'running' || rec.upstreamStatus) {
        updatePending(rec.submitId, { status: 'queued', upstreamStatus: undefined });
      }
      noMatch += 1;
      continue;
    }
    const st = String(upstream.status || '').toUpperCase();
    // 进度：顶层 progress 优先，其次 data.progress_pct
    const rawProgress = upstreamProgressValue(upstream);
    const progress = Number.isFinite(rawProgress) ? rawProgress : undefined;
    // 真实单笔扣费、时间线与模型名（供成本展示与精确对账）
    const model = upstreamModelName(upstream);
    const meta = {
      upstreamStatus: st || 'UNKNOWN',
      ...(Number(upstream.quota) > 0 ? { upstreamQuota: Number(upstream.quota) } : {}),
      ...(Number(upstream.start_time) > 0 ? { upstreamStartAt: Number(upstream.start_time) } : {}),
      ...(Number(upstream.finish_time) > 0 ? { upstreamFinishAt: Number(upstream.finish_time) } : {}),
      ...(model ? { upstreamModel: model } : {}),
    };
    const progressStamp = { progressSource: 'remote', progressUpdatedAt: new Date().toISOString() };
    if (st === 'SUCCESS') {
      const url = String(upstream.result_url || '').trim();
      updatePending(rec.submitId, { status: 'done', progress: 100, ...progressStamp, ...meta, ...( /^https?:\/\//i.test(url) ? { videoUrl: url } : {}) });
      updated.done += 1;
    } else if (st === 'FAILURE') {
      updatePending(rec.submitId, { status: 'failed', progress: progress || 100, ...progressStamp, ...meta, lastError: String(upstream.fail_reason || '上游失败').slice(0, 300) });
      updated.failed += 1;
    } else if (st === 'IN_PROGRESS') {
      // 关键：这里保持 status:'queued'。写成 'running' 会被 listUnfinished() 过滤掉，
      // 上报层发不出状态 → 前端连续三轮收不到该镜头 → 误判成「后台没有可拉回任务」。
      updatePending(rec.submitId, { status: 'queued', ...(progress != null ? { progress } : {}), ...progressStamp, ...meta });
      updated.running += 1;
    } else if (st === 'QUEUED' || st === 'NOT_START') {
      // ⚠️ 上游 QUEUED 状态的 progress 字段是固定标记值（20%），不是生成进度——强制归 0，避免误导
      // 排队超时判死：上游 QUEUED 超过 2 小时视为死任务（实测有卡 15 小时的），标 failed 让降级链路重提，
      // 否则这些镜头会永远占着「排队中」状态，跑批既不敢重提又拿不到视频。
      const queuedAgeH = (Date.now() / 1000 - Number(upstream.submit_time || 0)) / 3600;
      if (queuedAgeH > 2) {
        updatePending(rec.submitId, { status: 'failed', progress: 0, ...progressStamp, ...meta, lastError: `上游排队超时（${Math.round(queuedAgeH)} 小时未执行），视为失败` });
        updated.failed += 1;
      } else {
        updatePending(rec.submitId, { status: 'queued', progress: 0, ...progressStamp, ...meta });
        updated.queued += 1;
      }
    } else {
      unchanged += 1;
    }
  }
  return { upstreamScanned: upstreamTasks.length, localScanned: records.length, updated, unchanged, noMatch };
}

// 飞拓跨界消费账本（video-ledger）拉取：网页会话鉴权（API Key 会 401），需在设置里配置会话 Cookie。
// 用途：账单对账（计费流水 vs 本地任务），防止同 rolldek 式的重复扣费漏检。
// 注意：账本响应结构以实际返回为准——先用本函数做原始拉取探针，确认字段后再加匹配逻辑。
export async function fetchFeituoVideoLedger({ startTimestamp, endTimestamp } = {}) {
  const cfg = loadConfig();
  const cookie = String(cfg.video?.feituoLedgerCookie || '').trim();
  if (!cookie) throw new Error('请先在设置 → 视频生成里配置飞拓会话 Cookie（浏览器登录后复制）');
  const end = Number(endTimestamp) || Math.floor(Date.now() / 1000);
  const start = Number(startTimestamp) || end - 7 * 24 * 3600; // 默认近 7 天
  const url = 'https://feituokuajing.com/api/account/video-ledger?startTimestamp=' + start + '&endTimestamp=' + end;
  const res = await fetch(url, {
    headers: {
      Cookie: cookie,
      // 该站有机器人防护：无浏览器 UA 的请求会返回 HTML 挑战页
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://feituokuajing.com/',
      Accept: 'application/json, text/plain, */*',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error('飞拓账本请求失败：HTTP ' + res.status + (text.slice(0, 200) ? ' | ' + text.slice(0, 200) : ''));
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('飞拓账本返回非 JSON（多半是会话过期返回了登录页/挑战页），请重新复制 Cookie');
  }
  // 尽力提取列表与计数（实测字段：rows[]{id:"video:<jobId>", taskId, kind, model, taskStatus:"已完成/失败",
  //   billingStatus:"已扣费/已扣费后退款", amountCents, exactCostYuan, requestedDurationSeconds,
  //   generationDurationSeconds, refundedAt, createdAt, source, errorMessage}；quota.creditBalanceCents 等）
  const items = json?.data?.items || json?.data?.list || json?.data?.records || json?.rows || json?.list || json?.items
    || (Array.isArray(json?.data) ? json.data : []);
  const rows = Array.isArray(items) ? items : [];

  // ---- 账本内审计：失败仍扣费未退 / 同一任务多条扣费（重复计费） ----
  const normStatus = (s) => (String(s || '').includes('完') || /success|done|complete/i.test(String(s || '')) ? 'done'
    : String(s || '').includes('失败') || /fail/i.test(String(s || '')) ? 'failed' : 'other');
  const isCharged = (r) => String(r.billingStatus || '') === '已扣费';
  const isRefunded = (r) => String(r.billingStatus || '').includes('退款');
  const videoRows = rows.filter((r) => String(r.kind || '') === 'video' || String(r.id || '').startsWith('video:'));
  const chargedFailures = videoRows.filter((r) => normStatus(r.taskStatus) === 'failed' && isCharged(r) && !r.refundedAt);
  const chargesByTask = new Map();
  for (const r of videoRows) {
    if (!isCharged(r)) continue;
    const key = String(r.taskId || r.id || '');
    chargesByTask.set(key, (chargesByTask.get(key) || 0) + 1);
  }
  const duplicateCharges = [...chargesByTask.entries()]
    .filter(([, n]) => n > 1)
    .map(([taskId, n]) => {
      const sample = videoRows.find((r) => String(r.taskId || r.id || '') === taskId);
      return { taskId, chargeCount: n, model: sample?.model || '', errorMessage: sample?.errorMessage || null };
    });
  const chargedTotalCents = videoRows.filter(isCharged).reduce((s, r) => s + (Number(r.amountCents) || 0), 0);
  const refundedTotalCents = videoRows.filter(isRefunded).reduce((s, r) => s + (Number(r.amountCents) || 0), 0);

  return {
    upstreamEntries: rows.length,
    videoEntries: videoRows.length,
    audit: {
      chargedTotalCents,
      refundedTotalCents,
      chargedFailures: chargedFailures.map((r) => ({
        id: r.id, model: r.model, amountCents: r.amountCents, errorMessage: r.errorMessage || null, createdAt: r.createdAt,
      })),
      duplicateCharges,
      statusCounts: videoRows.reduce((m, r) => { const k = normStatus(r.taskStatus); m[k] = (m[k] || 0) + 1; return m; }, {}),
      sourceCounts: videoRows.reduce((m, r) => { const k = String(r.source || '未知'); m[k] = (m[k] || 0) + 1; return m; }, {}),
    },
    quota: json?.quota || null,
    summary: json?.summary || null,
    range: { start, end },
    raw: json,
  };
}
