// 小云雀 CLI/API 客户端。
// 2026-06 小云雀官方 CLI 已上线：npx @pippit-dev/cli@latest install
// 本模块不再走 xyq.jianying.com 页面自动化，而是调用 pippit-tool-cli 的
// generate-video / query-result 命令。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir, ffmpegPath, TEMP_DIR, USER_APP_DIR } from './config.js';
import { candidateVideoUrls } from './videoCandidates.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function runtimeCwd() {
  const directory = path.join(USER_APP_DIR, 'integrations', 'xiaoyunque');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

const CLI_PACKAGE = '@pippit-dev/cli@latest';
const CLI_COMMAND = process.platform === 'win32' ? 'pippit-tool-cli.cmd' : 'pippit-tool-cli';
const NPX_COMMAND = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// 捆绑的小云雀 CLI 可执行文件（随安装包发出，绕开 npx/Node/GitHub 下载）：
//   - 打包后：resources/xiaoyunque/pippit-tool-cli(.exe)
//   - 开发态：vendor/xiaoyunque/pippit-tool-cli(.exe)
//   - 都没有则返回空，回退到 PATH 上的 .cmd / npx
let _cachedXyqCliPath = null;
function xiaoyunqueCliPath() {
  if (_cachedXyqCliPath !== null) return _cachedXyqCliPath || '';
  const exe = process.platform === 'win32' ? 'pippit-tool-cli.exe' : 'pippit-tool-cli';
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'xiaoyunque', exe));
  candidates.push(path.join(ROOT, 'vendor', 'xiaoyunque', exe));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { _cachedXyqCliPath = c; return c; } } catch { /* ignore */ }
  }
  _cachedXyqCliPath = '';
  return '';
}
const SUBMIT_TIMEOUT_MS = 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const MODEL_ALIASES = new Map([
  ['即梦 Seedance 2.0 Fast', 'Seedance_2.0_mini_lite'],
  ['即梦 Seedance 2.0', 'Seedance_2.0_mini_lite'],
  ['Seedance 2.0 Fast', 'Seedance_2.0_mini_lite'],
  ['Seedance 2.0', 'Seedance_2.0_mini_lite'],
  ['Seedance 2.0 Mini Lite', 'Seedance_2.0_mini_lite'],
  ['Seedance 2.0 Mini Lite（普通）', 'Seedance_2.0_mini_lite'],
  ['Seedance 2.0 Mini Lite(普通)', 'Seedance_2.0_mini_lite'],
  ['Seedance 2.0 Mini', 'Seedance_2.0_mini'],
  ['Seedance 2.0 Mini（VIP）', 'Seedance_2.0_mini'],
  ['Seedance 2.0 Mini(VIP)', 'Seedance_2.0_mini'],
  ['Seedance 2.0 Direct', 'seedance2.0_direct'],
  ['Seedance 2.0 Direct（VIP）', 'seedance2.0_direct'],
  ['Seedance 2.0 Direct(VIP)', 'seedance2.0_direct'],
  ['Seedance 2.0 Fast Direct', 'seedance2.0_fast_direct'],
  ['Seedance 2.0 Fast Direct（VIP）', 'seedance2.0_fast_direct'],
  ['Seedance 2.0 Fast Direct(VIP)', 'seedance2.0_fast_direct'],
  ['Seedance 2.0 Vision', 'seedance2.0_vision'],
  ['Seedance 2.0 Vision（VIP）', 'seedance2.0_vision'],
  ['Seedance 2.0 Vision(VIP)', 'seedance2.0_vision'],
  ['Seedance 2.0 Fast Vision', 'seedance2.0_fast_vision'],
  ['Seedance 2.0 Fast Vision（VIP）', 'seedance2.0_fast_vision'],
  ['Seedance 2.0 Fast Vision(VIP)', 'seedance2.0_fast_vision'],
  ['Wan 3.0', 'Wan_3.0'],
  ['wan-3.0', 'Wan_3.0'],
  ['wan3.0', 'Wan_3.0'],
  ['wan_3.0', 'Wan_3.0'],
  ['MiniMax H3', 'MiniMax_H3'],
  ['MiniMax-H3', 'MiniMax_H3'],
  ['Minimax H3', 'MiniMax_H3'],
  ['hailuo-h3', 'MiniMax_H3'],
  ['H3', 'MiniMax_H3'],
]);

export class XiaoyunqueError extends Error {
  constructor(message, code = 'XIAOYUNQUE_ERROR') {
    super(message);
    this.name = 'XiaoyunqueError';
    this.code = code;
  }
}

function accessKeyFromAccount(account = {}) {
  return String(
    account.accessKey ||
    account.xyqAccessKey ||
    account.apiKey ||
    account.sessionid ||
    process.env.XYQ_ACCESS_KEY ||
    ''
  ).trim();
}

function ensureAccessKey(account) {
  const accessKey = accessKeyFromAccount(account);
  if (!accessKey) {
    throw new XiaoyunqueError('缺少小云雀 XYQ_ACCESS_KEY，请在视频设置里导入 access key', 'AUTH_MISSING');
  }
  return accessKey;
}

function cliEnv(account) {
  return {
    ...process.env,
    XYQ_ACCESS_KEY: ensureAccessKey(account),
  };
}

function downloadRoot() {
  return path.join(TEMP_DIR, 'hepai_xiaoyunque_results');
}

function downloadDirForSubmit(submitId) {
  return path.join(downloadRoot(), String(submitId).replace(/[\\/:*?"<>|]/g, '_'));
}

function modelForCli(model) {
  const value = String(model || '').trim();
  if (!value) return 'Seedance_2.0_mini_lite';
  return MODEL_ALIASES.get(value) || value;
}

function ratioForCli(aspectRatio) {
  return String(aspectRatio || '').trim() || '16:9';
}

function durationForCli(duration) {
  const n = Number(duration);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n));
}

function cleanJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    JSON.parse(raw);
    return raw;
  } catch {}
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw;
}

function parseJsonOutput(stdout, commandName) {
  const cleaned = cleanJsonText(stdout);
  if (!cleaned) throw new XiaoyunqueError(`${commandName} 未返回 JSON`, 'CLI_OUTPUT_INVALID');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new XiaoyunqueError(`${commandName} 返回 JSON 解析失败：${e.message}`, 'CLI_OUTPUT_INVALID');
  }
}

function normalizeProgressValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    value = Number(match[0]);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const pct = number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function progressFromJson(json) {
  const queue = [json].filter((item) => item && typeof item === 'object');
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const [key, value] of Object.entries(item)) {
      const normalizedKey = String(key || '').toLowerCase();
      if (/^(progress|percentage|percent|pct|progress_percent|progresspercentage)$/.test(normalizedKey)) {
        const progress = normalizeProgressValue(value);
        if (progress != null) return progress;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}

function normalizeExecError(error, commandName) {
  const stderr = String(error?.stderr || '').trim();
  const stdout = String(error?.stdout || '').trim();
  const detail = stderr || stdout || error?.message || '未知错误';
  let message = `${commandName} 执行失败：${detail}`;
  if (/github\.com|release|curl|Recv failure|Connection was reset|Failed to install pippit-tool-cli/i.test(detail)) {
    message = `${message}\n原因：安装器需要从 GitHub release 下载 pippit-tool-cli 压缩包，但当前网络连接被重置。请切换网络/代理后重试，或手动访问 GitHub release 下载对应 Windows 版本。`;
  }
  const code = /access key|authorization|unauthorized|forbidden|鉴权|权限|登录|401|403/i.test(detail)
    ? 'AUTH_EXPIRED'
    : /github\.com|release|curl|Recv failure|Connection was reset|Failed to install pippit-tool-cli/i.test(detail)
      ? 'CLI_DOWNLOAD_FAILED'
    : 'CLI_FAILED';
  return new XiaoyunqueError(message, code);
}

function execCliCommand(args, options = {}) {
  // 优先直接调用捆绑的原生 exe，绕开 npx/Node/PATH（用户无需安装）
  const bundled = xiaoyunqueCliPath();
  if (bundled) {
    return execFileAsync(bundled, args, options);
  }
  if (process.platform === 'win32') {
    return execFileAsync('cmd.exe', ['/c', CLI_COMMAND, ...args], options);
  }
  return execFileAsync(CLI_COMMAND, args, options);
}

async function runCli(args, account, { timeout = SUBMIT_TIMEOUT_MS, commandName = 'pippit-tool-cli' } = {}) {
  try {
    const result = await execCliCommand(args, {
      cwd: runtimeCwd(),
      env: cliEnv(account),
      timeout,
      maxBuffer: 1024 * 1024 * 32,
      windowsHide: true,
    });
    return result;
  } catch (firstError) {
    if (firstError?.code !== 'ENOENT') throw normalizeExecError(firstError, commandName);
    // 用了捆绑 exe 仍 ENOENT 说明 exe 损坏，npx 回退也无意义，直接报错
    if (xiaoyunqueCliPath()) throw normalizeExecError(firstError, commandName);
  }

  try {
    const result = await execFileAsync(NPX_COMMAND, [CLI_PACKAGE, ...args], {
      cwd: runtimeCwd(),
      env: cliEnv(account),
      timeout,
      maxBuffer: 1024 * 1024 * 32,
      windowsHide: true,
    });
    return result;
  } catch (secondError) {
    throw normalizeExecError(secondError, commandName);
  }
}

function submitIdFromThread(threadId, runId) {
  return `xyq:${threadId}:${runId}`;
}

function parseSubmitId(submitId) {
  const text = String(submitId || '').trim();
  const match = text.match(/^xyq:([^:]+):(.+)$/);
  if (!match) return null;
  return { threadId: match[1], runId: match[2] };
}

function validateMediaFiles(paths, label) {
  const valid = [];
  for (const file of paths || []) {
    const value = String(file || '').trim();
    if (!value) continue;
    try {
      if (fs.statSync(value).isFile()) valid.push(value);
    } catch {
      throw new XiaoyunqueError(`${label}不存在：${value}`, 'FILE_NOT_FOUND');
    }
  }
  return valid;
}

async function prepareAudioFilesForCli(paths, log) {
  const prepared = [];
  let tempDir = '';
  for (const file of paths || []) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.mp3' || ext === '.wav') {
      prepared.push(file);
      continue;
    }
    tempDir ||= createTempDir('hepai_xyq_audio_');
    const dest = path.join(tempDir, `${path.basename(file, path.extname(file))}.wav`);
    try {
      await execFileAsync(ffmpegPath(), [
        '-y',
        '-hide_banner',
        '-i', file,
        '-vn',
        '-ac', '1',
        '-ar', '44100',
        '-c:a', 'pcm_s16le',
        dest,
      ], { timeout: 60_000, maxBuffer: 1024 * 1024 * 8, windowsHide: true });
      prepared.push(dest);
    } catch (e) {
      log?.(`音频 ${path.basename(file)} 不是 mp3/wav，且 ffmpeg 转换失败，已跳过`);
    }
  }
  return { prepared, tempDir };
}

export class XiaoyunqueSession {
  constructor(account, { onProgress } = {}) {
    this.account = account;
    this.log = (m) => { try { onProgress?.(m); } catch { /* ignore */ } };
  }

  async open() {
    ensureAccessKey(this.account);
    this.log('小云雀 CLI/API 已就绪');
  }

  async close() {}

  async submitOne({
    refImagePaths = [],
    refVideoPaths = [],
    refAudioPaths = [],
    prompt = '',
    duration = 5,
    aspectRatio = '16:9',
    model = 'Seedance_2.0_mini_lite',
    resolution = '',
    mentions = [],
  } = {}) {
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) throw new XiaoyunqueError('提示词为空', 'VALIDATION_ERROR');

    const images = validateMediaFiles(refImagePaths, '参考图');
    const videos = validateMediaFiles(refVideoPaths, '参考视频');
    const audios = validateMediaFiles(refAudioPaths, '参考音频');
    const audioPrep = await prepareAudioFilesForCli(audios, this.log);
    try {
      // 不再自动生成槽位映射：前端已生成，且小云雀 CLI 会根据 --image/--audio 参数自动处理
      const args = ['generate-video', '--prompt', cleanPrompt];
      for (const image of images.slice(0, 9)) args.push('--image', image);
      for (const video of videos.slice(0, 3)) args.push('--video', video);
      for (const audio of audioPrep.prepared.slice(0, 3)) args.push('--audio', audio);
      const durationSec = durationForCli(duration);
      if (durationSec) args.push('--duration', String(durationSec));
      args.push('--ratio', ratioForCli(aspectRatio));
      args.push('--model', modelForCli(model));
      if (String(resolution || '').trim()) args.push('--resolution', String(resolution).trim());

      this.log(`提交小云雀生成：${images.length} 图/${videos.length} 视频/${audioPrep.prepared.length} 音频`);
      const { stdout } = await runCli(args, this.account, { commandName: 'generate-video' });
      const json = parseJsonOutput(stdout, 'generate-video');
      const threadId = String(json.thread_id || '').trim();
      const runId = String(json.run_id || '').trim();
      if (!threadId || !runId) {
        throw new XiaoyunqueError('generate-video 响应缺少 thread_id/run_id', 'CLI_OUTPUT_INVALID');
      }

      const submitId = submitIdFromThread(threadId, runId);
      this.log(`已提交小云雀 submitId=${submitId}`);
      return {
        submitId,
        historyId: runId,
        threadId,
        runId,
        webThreadLink: json.web_thread_link || '',
      };
    } finally {
      if (audioPrep.tempDir) {
        try { fs.rmSync(audioPrep.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  async fetchResults(submitIds = []) {
    const out = {};
    for (const submitId of submitIds) {
      const ids = parseSubmitId(submitId);
      if (!ids) {
        out[submitId] = { status: 'failed', fail: '无法解析小云雀 submitId' };
        continue;
      }

      const downloadDir = downloadDirForSubmit(submitId);
      fs.mkdirSync(downloadDir, { recursive: true });
      const args = [
        'query-result',
        '--thread-id', ids.threadId,
        '--run-id', ids.runId,
        '--download-dir', downloadDir,
      ];
      try {
        const { stdout } = await runCli(args, this.account, {
          commandName: 'query-result',
          timeout: QUERY_TIMEOUT_MS,
        });
        const json = parseJsonOutput(stdout, 'query-result');
        const progress = progressFromJson(json);
        if (json.error_message) {
          out[submitId] = { status: 'failed', fail: json.error_message, progress: progress ?? 100 };
          continue;
        }
        if (!json.completed) {
          out[submitId] = { status: 'queued', threadId: ids.threadId, runId: ids.runId, progress };
          continue;
        }
        const videos = Array.isArray(json.videos) ? json.videos : [];
        const videoPaths = [...new Set(videos
          .flatMap((video) => [video?.output_path, video?.outputPath, video?.file_path, video?.filePath])
          .filter((filePath) => filePath && fs.existsSync(filePath))
          .map((filePath) => path.resolve(filePath)))];
        const videoUrls = candidateVideoUrls(json, { includeGenericUrl: true });
        if (videoPaths.length || videoUrls.length) {
          out[submitId] = {
            status: 'done',
            videoPath: videoPaths[0] || '',
            videoPaths,
            videoUrl: videoUrls[0] || '',
            videoUrls,
            threadId: ids.threadId,
            runId: ids.runId,
            progress: 100,
          };
        } else {
          out[submitId] = { status: 'done_no_url', threadId: ids.threadId, runId: ids.runId, progress: 100 };
        }
      } catch (e) {
        out[submitId] = { status: 'queued', note: e.message };
      }
    }
    return out;
  }
}

export async function submitVideos({ account, shots = [], onProgress, onSubmitProgress, model, resolution } = {}) {
  ensureAccessKey(account);
  const session = new XiaoyunqueSession(account, { onProgress });
  const results = [];
  const emitSubmitProgress = (message) => {
    try {
      onSubmitProgress?.({
        total: shots.length,
        processed: results.length,
        submitted: results.filter((r) => r.ok && r.submitId).length,
        failed: results.filter((r) => !r.ok).length,
        message,
      });
    } catch { /* ignore */ }
  };
  try {
    await session.open();
    for (const shot of shots) {
      emitSubmitProgress(`正在提交镜头 ${shot.shotNo}…`);
      try {
        const result = await session.submitOne({
          refImagePaths: shot.refImagePaths,
          refVideoPaths: shot.refVideoPaths,
          refAudioPaths: shot.refAudioPaths,
          prompt: shot.prompt,
          duration: shot.duration,
          aspectRatio: shot.aspectRatio,
          model: shot.model || model,
          resolution: shot.resolution || resolution,
          mentions: shot.mentions,
        });
        results.push({ shotNo: shot.shotNo, ok: true, ...result });
        emitSubmitProgress(`镜头 ${shot.shotNo} 已提交`);
      } catch (e) {
        results.push({ shotNo: shot.shotNo, ok: false, error: e.message, code: e.code });
        emitSubmitProgress(`镜头 ${shot.shotNo} 提交失败：${e.message}`);
        if (e.code === 'AUTH_EXPIRED' || e.code === 'AUTH_MISSING') break;
      }
    }
    return results;
  } finally {
    await session.close();
  }
}

export async function fetchVideoResults({ account, submitIds = [], onProgress } = {}) {
  ensureAccessKey(account);
  if (!submitIds.length) return {};
  const session = new XiaoyunqueSession(account, { onProgress });
  await session.open();
  return session.fetchResults(submitIds);
}

export async function fetchAccountCredit() {
  return null;
}

export async function loginAndCaptureSession() {
  throw new XiaoyunqueError(
    '小云雀 CLI/API 使用 XYQ_ACCESS_KEY 鉴权，请在视频设置中粘贴 access key；不再支持浏览器捕获 sessionid。',
    'AUTH_MISSING'
  );
}

export async function installCli({ onProgress } = {}) {
  const log = (m) => { try { onProgress?.(m); } catch { /* ignore */ } };
  // 安装包已捆绑 CLI exe：无需安装，直接就绪
  if (xiaoyunqueCliPath()) {
    log('小云雀 CLI 已随应用内置，无需安装');
    return { ok: true, alreadyInstalled: true, installed: true, command: xiaoyunqueCliPath() };
  }
  const status = await getCliStatus();
  if (status.installed) {
    log(`小云雀 CLI 已安装：${status.version || 'unknown'}`);
    return { ok: true, alreadyInstalled: true, ...status };
  }
  log('安装小云雀 CLI...');
  try {
    await execFileAsync(NPX_COMMAND, [CLI_PACKAGE, 'install'], {
      cwd: runtimeCwd(),
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
      windowsHide: true,
    });
  } catch (e) {
    throw normalizeExecError(e, 'npx @pippit-dev/cli install');
  }
  log('小云雀 CLI 安装完成');
  return { ok: true };
}

export async function getCliStatus() {
  try {
    const { stdout, stderr } = await execCliCommand(['--version'], {
      cwd: runtimeCwd(),
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const version = String(stdout || stderr || '').trim();
    return {
      installed: true,
      command: CLI_COMMAND,
      version,
    };
  } catch (e) {
    const detail = String(e?.stderr || e?.stdout || e?.message || '').trim();
    return {
      installed: false,
      command: CLI_COMMAND,
      error: detail,
    };
  }
}
