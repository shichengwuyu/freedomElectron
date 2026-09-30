// Dreamina (Jimeng) official CLI client.
// Dreamina CLI integration. Browser automation for the old domestic web flow
// has been removed; this module owns the Dreamina video provider path.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir, TEMP_DIR, USER_APP_DIR } from './config.js';
import { writeJsonAtomic } from './lib/atomicJson.js';
import { candidateVideoUrls } from './videoCandidates.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function runtimeCwd() {
  const directory = path.join(USER_APP_DIR, 'integrations', 'dreamina');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

const INSTALL_URL = 'https://jimeng.jianying.com/cli';
// 安装脚本对 Windows 只是下载这一个 exe 到 ~/bin 并写 PATH，纯 Node 即可完成，无需 bash。
const DREAMINA_DOWNLOAD_BASE = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/dreamina_cli_beta';
const DREAMINA_RELEASE_BASE = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp';
const DREAMINA_WIN_BINARY_URL = `${DREAMINA_DOWNLOAD_BASE}/dreamina_cli_windows_amd64.exe`;
const DREAMINA_SKILL_URL = `${DREAMINA_DOWNLOAD_BASE}/SKILL.md`;
const DREAMINA_VERSION_URL = `${DREAMINA_RELEASE_BASE}/version.json`;
const SUBMIT_TIMEOUT_MS = 60 * 60 * 1000;
// Keep status probes short so one stuck CLI process cannot block all pending
// video tasks for an hour. Downloads use a separate, longer timeout below.
const QUERY_TIMEOUT_MS = 30 * 1000;
const QUERY_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const TASK_LOOKUP_TIMEOUT_MS = 15 * 1000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const STATUS_TIMEOUT_MS = 8 * 1000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const CLI_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CLI_UPDATE_TIMEOUT_MS = 2 * 60 * 1000;
const LOCAL_ACCOUNT_ID = 'dreamina-local';
const AUTH_RECENT_MS = 12 * 60 * 60 * 1000;
let lastKnownAuthenticatedAt = 0;
let lastCliUpdateCheckAt = 0;
let cliUpdatePromise = null;

const MODEL_ALIASES = new Map([
  ['即梦 Seedance 2.5', 'seedance2.5'],
  ['Seedance 2.5', 'seedance2.5'],
  ['即梦 Seedance 2.0 mini', 'seedance2.0mini'],
  ['即梦 Seedance 2.0 Fast', 'seedance2.0fast'],
  ['即梦 Seedance 2.0 Fast VIP', 'seedance2.0fast_vip'],
  ['即梦 Seedance 2.0 VIP', 'seedance2.0_vip'],
  ['即梦 Seedance 2.0', 'seedance2.0'],
  ['Seedance 2.0 mini', 'seedance2.0mini'],
  ['Seedance 2.0 Fast', 'seedance2.0fast'],
  ['Seedance 2.0 Fast VIP', 'seedance2.0fast_vip'],
  ['Seedance 2.0 VIP', 'seedance2.0_vip'],
  ['Seedance 2.0', 'seedance2.0'],
  ['seedance2.0_mini', 'seedance2.0mini'],
  ['seedance2.0_fast', 'seedance2.0fast'],
  ['seedance2.0_fast_vip', 'seedance2.0fast_vip'],
]);

export class DreaminaError extends Error {
  constructor(message, code = 'DREAMINA_ERROR') {
    super(message);
    this.name = 'DreaminaError';
    this.code = code;
  }
}

export function localAccountId() {
  return LOCAL_ACCOUNT_ID;
}

function bundledCliPath() {
  const exe = process.platform === 'win32' ? 'dreamina.exe' : 'dreamina';
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'dreamina', exe));
  }
  candidates.push(path.join(ROOT, 'vendor', 'dreamina', exe));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return '';
}

function userCliPaths() {
  const home = os.homedir();
  return process.platform === 'win32'
    ? [
        path.join(home, 'bin', 'dreamina.exe'),
        path.join(home, '.local', 'bin', 'dreamina.exe'),
      ]
    : [
        path.join(home, '.local', 'bin', 'dreamina'),
        path.join(home, 'bin', 'dreamina'),
      ];
}

function findUserInstalledCliPath() {
  for (const c of userCliPaths()) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return '';
}

function dreaminaVersionMetadataPath() {
  return path.join(os.homedir(), '.dreamina_cli', 'version.json');
}

function dreaminaUpdateTargetPath() {
  const installed = findUserInstalledCliPath();
  if (installed) return installed;
  return process.platform === 'win32'
    ? path.join(os.homedir(), 'bin', 'dreamina.exe')
    : path.join(os.homedir(), '.local', 'bin', 'dreamina');
}

function dreaminaBinaryUrl() {
  if (process.platform === 'win32' && process.arch === 'x64') return DREAMINA_WIN_BINARY_URL;
  if (process.platform === 'darwin' && process.arch === 'arm64') return `${DREAMINA_DOWNLOAD_BASE}/dreamina_cli_darwin_arm64`;
  if (process.platform === 'darwin' && process.arch === 'x64') return `${DREAMINA_DOWNLOAD_BASE}/dreamina_cli_darwin_amd64`;
  if (process.platform === 'linux' && (process.arch === 'arm64' || process.arch === 'aarch64')) return `${DREAMINA_DOWNLOAD_BASE}/dreamina_cli_linux_arm64`;
  if (process.platform === 'linux' && process.arch === 'x64') return `${DREAMINA_DOWNLOAD_BASE}/dreamina_cli_linux_amd64`;
  return '';
}

function releaseVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? match.slice(1).map((part) => Number(part || 0)) : null;
}

function compareReleaseVersions(left, right) {
  const a = releaseVersion(left);
  const b = releaseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function readInstalledReleaseMetadata() {
  try {
    return JSON.parse(fs.readFileSync(dreaminaVersionMetadataPath(), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

async function fetchLatestReleaseMetadata() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLI_UPDATE_TIMEOUT_MS);
  try {
    const response = await fetch(DREAMINA_VERSION_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    if (!String(release?.version || '').trim()) throw new Error('官网版本信息缺少 version');
    return release;
  } finally {
    clearTimeout(timer);
  }
}

async function replaceFileAtomically(sourcePath, targetPath) {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const backupPath = `${targetPath}.backup`;
  let backedUp = false;
  try {
    await fs.promises.rm(backupPath, { force: true });
    if (fs.existsSync(targetPath)) {
      await fs.promises.rename(targetPath, backupPath);
      backedUp = true;
    }
    await fs.promises.rename(sourcePath, targetPath);
    if (process.platform !== 'win32') await fs.promises.chmod(targetPath, 0o755);
    await fs.promises.rm(backupPath, { force: true });
  } catch (error) {
    if (backedUp && !fs.existsSync(targetPath) && fs.existsSync(backupPath)) {
      try { await fs.promises.rename(backupPath, targetPath); } catch { /* best effort */ }
    }
    throw error;
  }
}

async function maybeUpdateCli({ installedPath = findInstalledCliPath(), onProgress } = {}) {
  if (!installedPath || !dreaminaBinaryUrl()) return { updated: false, skipped: true };
  const now = Date.now();
  if (now - lastCliUpdateCheckAt < CLI_UPDATE_CHECK_INTERVAL_MS) return { updated: false, skipped: true };
  if (cliUpdatePromise) return cliUpdatePromise;
  lastCliUpdateCheckAt = now;
  cliUpdatePromise = (async () => {
    let release;
    try {
      release = await fetchLatestReleaseMetadata();
    } catch (error) {
      return { updated: false, skipped: true, error };
    }

    const current = readInstalledReleaseMetadata();
    const comparison = compareReleaseVersions(release.version, current?.version);
    if (comparison != null && comparison <= 0) return { updated: false, skipped: true, release };

    const targetPath = dreaminaUpdateTargetPath();
    const tempPath = `${targetPath}.update-${process.pid}-${Date.now()}`;
    try {
      onProgress?.(`正在更新 Dreamina CLI 到 ${release.version}...`);
      const size = await downloadToFile(dreaminaBinaryUrl(), tempPath, { timeoutMs: CLI_UPDATE_TIMEOUT_MS });
      if (size < 1024 * 1024) throw new Error(`CLI 文件过小(${size}B)`);
      await replaceFileAtomically(tempPath, targetPath);
      writeJsonAtomic(dreaminaVersionMetadataPath(), { ...release, installedAt: new Date().toISOString() });
      onProgress?.(`Dreamina CLI 已更新到 ${release.version}`);
      return { updated: true, release, targetPath };
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      return { updated: false, skipped: true, error };
    }
  })().finally(() => {
    cliUpdatePromise = null;
  });
  return cliUpdatePromise;
}

function cliCandidates() {
  const names = process.platform === 'win32'
    ? ['dreamina.exe', 'dreamina.cmd', 'dreamina']
    : ['dreamina'];
  const bundled = bundledCliPath();
  return [...new Set([...userCliPaths(), ...(bundled ? [bundled] : []), ...names])];
}

// 返回已落盘的 dreamina 可执行文件绝对路径（找不到返回空）。
// 用文件存在性判断"已安装"，比 spawn version 更可靠——electron 打包环境里
// spawn 可能因环境差异/超时/杀软拦截失败，但文件其实就在 ~/bin。
function findInstalledCliPath() {
  const candidates = cliCandidates().filter((c) => path.isAbsolute(c));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return '';
}

function isCommandMissing(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.stderr || ''} ${error?.stdout || ''}`;
  return /ENOENT|EINVAL|not recognized|not found|command not found|cannot find/i.test(text);
}

function normalizeExecError(error, commandName) {
  const stderr = String(error?.stderr || '').trim();
  const stdout = String(error?.stdout || '').trim();
  const rawMessage = String(error?.message || '').trim();
  const detail = stderr || stdout || (
    rawMessage && !/^Command failed:/i.test(rawMessage)
      ? rawMessage
      : 'CLI 未返回错误详情。请先确认 Dreamina CLI 已真正登录，并在终端运行 dreamina user_credit 验证账号态。'
  );
  if (isCommandMissing(error)) {
    return new DreaminaError('未检测到 dreamina CLI，请先安装即梦 CLI 并重新打开应用', 'CLI_NOT_FOUND');
  }
  let code = 'CLI_FAILED';
  if (/AigcComplianceConfirmationRequired/i.test(detail)) code = 'COMPLIANCE_REQUIRED';
  else if (/login|oauth|auth|credential|unauthorized|forbidden|401|403|登录|授权/i.test(detail)) code = 'AUTH_EXPIRED';
  else if (/credit|quota|insufficient|积分|余额|额度/i.test(detail)) code = 'PAID_REQUIRED';
  return new DreaminaError(`${commandName} 执行失败：${detail}`, code);
}

async function execDreamina(args, options = {}) {
  let missingError = null;
  // Prefer the user's CLI so OAuth state survives app reinstalls and restarts.
  // The bundled CLI remains a fallback and is copied to the user bin on login.
  const installed = findInstalledCliPath();
  const ordered = installed ? [installed, ...cliCandidates().filter((c) => c !== installed)] : cliCandidates();
  for (const candidate of ordered) {
    try {
      return await execFileAsync(candidate, args, options);
    } catch (e) {
      if (isCommandMissing(e)) {
        missingError = missingError || e;
        continue;
      }
      throw e;
    }
  }

  if (process.platform === 'win32') {
    try {
      return await execFileAsync('cmd.exe', ['/c', 'dreamina', ...args], options);
    } catch (e) {
      if (!missingError && !isCommandMissing(e)) throw e;
      missingError = missingError || e;
    }
  }
  throw missingError || new DreaminaError('未检测到 dreamina CLI', 'CLI_NOT_FOUND');
}

async function runCli(args, { timeout = SUBMIT_TIMEOUT_MS, commandName = 'dreamina', allowLoginMaterial = false } = {}) {
  try {
    return await execDreamina(args, {
      cwd: runtimeCwd(),
      env: process.env,
      timeout,
      maxBuffer: 1024 * 1024 * 32,
      windowsHide: true,
    });
  } catch (e) {
    if (e instanceof DreaminaError) throw e;
    if (allowLoginMaterial) {
      const stdout = String(e?.stdout || '');
      const stderr = String(e?.stderr || '');
      if (parseLoginMaterial(stdout, stderr).deviceCode || looksLikeLoginSuccess(stdout, stderr)) {
        return { stdout, stderr };
      }
    }
    throw normalizeExecError(e, commandName);
  }
}

function parseLoginMaterial(stdout, stderr = '') {
  const raw = `${stdout || ''}\n${stderr || ''}`.trim();
  let json = null;
  try { json = parseJsonOutput(raw, 'dreamina login --headless'); } catch { /* CLI may print key/value text */ }
  const data = unwrapData(json);
  const verificationUri =
    data.verification_uri_complete ||
    data.verificationUriComplete ||
    data.verification_url ||
    data.verificationUrl ||
    data.verification_uri ||
    data.verificationUri ||
    (raw.match(/verification_uri_complete\s*[:=]\s*(https?:\/\/\S+)/i)?.[1]) ||
    (raw.match(/verification_(?:uri|url)\s*[:=]\s*(https?:\/\/\S+)/i)?.[1]) ||
    (raw.match(/https?:\/\/\S+/i)?.[0]) ||
    '';
  const userCode =
    data.user_code ||
    data.userCode ||
    (raw.match(/user_code\s*[:=]\s*([A-Za-z0-9_-]+)/i)?.[1]) ||
    '';
  const deviceCode =
    data.device_code ||
    data.deviceCode ||
    (raw.match(/device_code\s*[:=]\s*([A-Za-z0-9._~+/-]+)/i)?.[1]) ||
    '';
  return {
    verificationUri: String(verificationUri || '').trim(),
    userCode: String(userCode || '').trim(),
    deviceCode: String(deviceCode || '').trim(),
    raw,
  };
}

function cliText(stdout, stderr = '') {
  return `${stdout || ''}\n${stderr || ''}`.trim();
}

function looksLikeLoginSuccess(stdout, stderr = '') {
  const raw = cliText(stdout, stderr);
  if (!raw) return false;
  return /\[DREAMINA:LOGIN_(?:SUCCESS|REUSED)\]|\blogin success\b|\blogin succeeded\b|already\s+(?:logged|authenticated)|oauth.*(?:success|reused)|\u767b\u5f55\u6210\u529f|\u5df2\u767b\u5f55|\u6388\u6743\u6210\u529f|\u590d\u7528/i.test(raw);
}

function rememberAuthenticated() {
  lastKnownAuthenticatedAt = Date.now();
}

function forgetAuthenticated() {
  lastKnownAuthenticatedAt = 0;
}

function recentlyAuthenticated() {
  return lastKnownAuthenticatedAt > 0 && Date.now() - lastKnownAuthenticatedAt < AUTH_RECENT_MS;
}

async function openExternalUrl(url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    if (process.platform === 'win32') {
      await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', target], { timeout: 10_000, windowsHide: true });
    } else if (process.platform === 'darwin') {
      await execFileAsync('open', [target], { timeout: 10_000 });
    } else {
      await execFileAsync('xdg-open', [target], { timeout: 10_000 });
    }
    return true;
  } catch {
    return false;
  }
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
  if (!cleaned) throw new DreaminaError(`${commandName} 未返回 JSON`, 'CLI_OUTPUT_INVALID');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new DreaminaError(`${commandName} 返回 JSON 解析失败：${e.message}`, 'CLI_OUTPUT_INVALID');
  }
}

function unwrapData(json) {
  if (json?.data && typeof json.data === 'object') return json.data;
  return json || {};
}

function validateMediaFiles(paths, label) {
  const valid = [];
  for (const file of paths || []) {
    const value = String(file || '').trim();
    if (!value) continue;
    try {
      if (fs.statSync(value).isFile()) valid.push(value);
    } catch {
      throw new DreaminaError(`${label}不存在：${value}`, 'FILE_NOT_FOUND');
    }
  }
  return valid;
}

function safeCliExt(filePath, fallbackExt) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : fallbackExt;
}

function stageMediaFilesForCli(files, prefix, fallbackExt) {
  if (!files.length) return { paths: files, cleanup: () => {} };
  const dir = createTempDir('hepai_dreamina_cli_');
  const paths = files.map((file, index) => {
    const ext = safeCliExt(file, fallbackExt);
    const staged = path.join(dir, `${prefix}_${String(index + 1).padStart(2, '0')}${ext}`);
    fs.copyFileSync(file, staged);
    return staged;
  });
  return {
    paths,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

function durationForCli(duration, model) {
  const n = Number(duration);
  if (!Number.isFinite(n) || n <= 0) return null;
  const capabilities = dreaminaVideoCapabilities(model);
  return Math.min(capabilities.duration.max, Math.max(capabilities.duration.min, Math.round(n)));
}

function ratioForCli(aspectRatio) {
  return String(aspectRatio || '').trim() || '16:9';
}

const DREAMINA_IMAGE_MODELS = Object.freeze(['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro']);
const DREAMINA_IMAGE_RATIOS = Object.freeze(['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']);

export function dreaminaImageCapabilities(model = '') {
  const modelVersion = String(model || '5.0').trim() || '5.0';
  const resolutions = modelVersion === '5.0Pro'
    ? ['1k', '2k', '4k']
    : (['3.0', '3.1'].includes(modelVersion) ? ['1k', '2k'] : ['2k', '4k']);
  return {
    model: modelVersion,
    models: [...DREAMINA_IMAGE_MODELS],
    ratios: [...DREAMINA_IMAGE_RATIOS],
    resolutions,
    maxReferenceImages: ['3.0', '3.1'].includes(modelVersion) ? 0 : 10,
  };
}

function imageModelForCli(model) {
  const value = String(model || '5.0').trim() || '5.0';
  if (!DREAMINA_IMAGE_MODELS.includes(value)) {
    throw new DreaminaError(`即梦图片模型不支持：${value}`, 'VALIDATION_ERROR');
  }
  return value;
}

function imageResolutionForCli(resolution, model) {
  const capabilities = dreaminaImageCapabilities(model);
  const value = String(resolution || '').trim().toLowerCase();
  if (value && !capabilities.resolutions.includes(value)) {
    throw new DreaminaError(`即梦图片模型 ${model} 不支持 ${value.toUpperCase()} 清晰度`, 'VALIDATION_ERROR');
  }
  return value || capabilities.resolutions[0];
}

export function buildDreaminaImageSubmitCommand({ referencePaths = [], prompt, ratio = '16:9', resolution, model, session } = {}) {
  const modelVersion = imageModelForCli(model);
  const cleanRatio = ratioForCli(ratio);
  if (!DREAMINA_IMAGE_RATIOS.includes(cleanRatio)) {
    throw new DreaminaError(`即梦图片比例不支持：${cleanRatio}`, 'VALIDATION_ERROR');
  }
  const refs = (Array.isArray(referencePaths) ? referencePaths : [referencePaths])
    .map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10);
  if (refs.length && !dreaminaImageCapabilities(modelVersion).maxReferenceImages) {
    throw new DreaminaError(`即梦图片模型 ${modelVersion} 不支持参考图`, 'VALIDATION_ERROR');
  }
  const args = [refs.length ? 'image2image' : 'text2image'];
  if (refs.length) args.push('--images', refs.join(','));
  args.push('--prompt', String(prompt || '').trim(), '--ratio', cleanRatio);
  args.push('--resolution_type', imageResolutionForCli(resolution, modelVersion));
  args.push('--model_version', modelVersion, '--generate_num', '1', '--poll=0');
  const sessionId = sessionForCli(session);
  if (sessionId) args.push('--session', sessionId);
  return args;
}

function modelForCli(model) {
  const value = String(model || '').trim();
  if (!value) return '';
  return MODEL_ALIASES.get(value) || value;
}

export function dreaminaVideoCapabilities(model) {
  const modelVersion = modelForCli(model);
  if (modelVersion === 'seedance2.5') {
    return {
      modelVersion,
      duration: { min: 4, max: 30 },
      resolutions: ['480p', '720p'],
      multimodal: { image: 30, video: 10, audio: 10, total: 50, audioOnly: true },
    };
  }
  return {
    modelVersion,
    duration: { min: 4, max: 15 },
    resolutions: modelVersion === 'seedance2.0_vip' ? ['720p', '1080p', '4k'] : ['720p'],
    multimodal: { image: 9, video: 3, audio: 3, total: 12, audioOnly: false },
  };
}

function videoResolutionForCli(resolution, model) {
  const value = String(resolution || '').trim();
  const normalized = value.toLowerCase();
  const allowed = new Set(dreaminaVideoCapabilities(model).resolutions);
  return allowed.has(normalized) ? normalized : '720p';
}

function sessionForCli(session) {
  const value = String(session ?? '').trim();
  if (!value) return '';
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 999) return String(numeric);
  }
  return '0';
}

function addOptional(args, flag, value) {
  const text = String(value || '').trim();
  if (text) args.push(flag, text);
}

function multimodalLimitsForCli(model) {
  return dreaminaVideoCapabilities(model).multimodal;
}

function limitMultimodalMedia(media, model) {
  const limits = multimodalLimitsForCli(model);
  const selected = {
    images: (media.images || []).slice(0, limits.image),
    videos: (media.videos || []).slice(0, limits.video),
    audios: (media.audios || []).slice(0, limits.audio),
  };
  const groups = [selected.images, selected.videos, selected.audios];
  while (groups.reduce((sum, group) => sum + group.length, 0) > limits.total) {
    const largest = groups.reduce((current, group) => (group.length > current.length ? group : current), groups[0]);
    largest.pop();
  }
  return selected;
}

function normalizeMentionKind(value, name) {
  const kind = String(value || '').trim().toLowerCase();
  if (kind) return kind;
  return /音频|声音|配音|voice|audio/i.test(String(name || '')) ? 'audio' : 'image';
}

function oneLineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function audioReferenceDescription(label) {
  const name = oneLineText(label).replace(/(?:的)?(?:音频|声音|配音|音色|voice|audio)$/i, '').trim();
  return `${name || '该音频'}的配音/音色参考`;
}

function referenceSlotDescription(label, kind) {
  const name = oneLineText(label);
  if (!name) return '';
  if (kind === 'audio') return audioReferenceDescription(name);
  if (kind === 'video') return `${name}视频参考`;
  return /参考图$/u.test(name) ? name : `${name}参考图`;
}

function mediaLabelFromPath(filePath, kind, index) {
  const base = path.basename(String(filePath || ''), path.extname(String(filePath || ''))).trim();
  if (base) return base;
  if (kind === 'audio') return `音频${index}`;
  if (kind === 'video') return `视频${index}`;
  return `图片${index}`;
}

function groupedMentionsByKind(mentions = []) {
  const out = { image: [], video: [], audio: [] };
  for (const raw of mentions || []) {
    const name = String(raw?.name || '').trim();
    const label = String(raw?.displayName || raw?.label || raw?.fallbackText || name).trim();
    if (!name && !label) continue;
    const kind = normalizeMentionKind(raw?.kind || raw?.type, name || label);
    if (kind === 'audio') out.audio.push(raw);
    else if (kind === 'video') out.video.push(raw);
    else out.image.push(raw);
  }
  return out;
}

function referenceLabel(item, filePath, kind, index) {
  const label = item
    ? String(item.displayName || item.label || item.fallbackText || item.name || '').trim()
    : '';
  return label || mediaLabelFromPath(filePath, kind, index);
}

function buildReferencePromptPrefix(mentions = [], media = {}, model = '') {
  const lines = [];
  const grouped = groupedMentionsByKind(mentions);
  const limits = multimodalLimitsForCli(model);
  const images = Array.isArray(media.images) ? media.images : [];
  const videos = Array.isArray(media.videos) ? media.videos : [];
  const audios = Array.isArray(media.audios) ? media.audios : [];

  const imageTotal = Math.min(images.length || grouped.image.length, limits.image);
  let hasStoryboardInstruction = false;
  for (let i = 0; i < imageTotal; i += 1) {
    const mention = grouped.image[i];
    const label = referenceLabel(mention, images[i], 'image', i + 1);
    const instruction = oneLineText(mention?.referenceInstruction);
    if (instruction) hasStoryboardInstruction = true;
    const voice = oneLineText(mention?.voice);
    const voiceSuffix = voice
      ? `，${label ? `${label}的` : ''}音色为「${voice}」，角色说话/低语时按此声音表演`
      : '';
    lines.push((instruction
      ? `@Image${i + 1} 是${instruction}`
      : `@Image${i + 1} 是${referenceSlotDescription(label, 'image')}`) + voiceSuffix);
  }

  const videoTotal = Math.min(videos.length || grouped.video.length, limits.video);
  for (let i = 0; i < videoTotal; i += 1) {
    const label = referenceLabel(grouped.video[i], videos[i], 'video', i + 1);
    lines.push(`@Video${i + 1} 是${referenceSlotDescription(label, 'video')}`);
  }

  const audioTotal = Math.min(audios.length || grouped.audio.length, limits.audio);
  for (let i = 0; i < audioTotal; i += 1) {
    const label = referenceLabel(grouped.audio[i], audios[i], 'audio', i + 1);
    lines.push(`@Audio${i + 1} 这个是${referenceSlotDescription(label, 'audio')}`);
  }

  if (lines.length) {
    if (!hasStoryboardInstruction) lines.push('请同时参考以上素材保持人物形象、人物音色、场景、道具和画面连续性。');
  }
  return lines.join('；');
}

function withReferencePrompt(prompt, referencePromptPrefix = '') {
  const cleanPrompt = String(prompt || '').trim();
  const prefix = String(referencePromptPrefix || '').trim();
  const separatedPrefix = prefix && !/[；。;.]$/.test(prefix) ? `${prefix}；` : prefix;
  return separatedPrefix ? `${separatedPrefix}\n\n${cleanPrompt}`.trim() : cleanPrompt;
}

export function buildDreaminaSubmitCommand({ images = [], videos = [], audios = [], prompt, duration, aspectRatio, model, resolution, session }) {
  const modelVersion = modelForCli(model);
  const durationSec = durationForCli(duration, modelVersion);
  const videoResolution = videoResolutionForCli(resolution, modelVersion);
  const sessionId = sessionForCli(session);

  if (images.length || videos.length || audios.length) {
    if (!images.length && !videos.length && audios.length && !dreaminaVideoCapabilities(modelVersion).multimodal.audioOnly) {
      throw new DreaminaError('即梦 CLI 纯音频全能参考需要选择 Seedance 2.5', 'VALIDATION_ERROR');
    }
    const args = ['multimodal2video'];
    for (const image of images) args.push(`--image=${image}`);
    for (const video of videos) args.push(`--video=${video}`);
    for (const audio of audios) args.push(`--audio=${audio}`);
    addOptional(args, '--prompt', prompt);
    if (durationSec) args.push('--duration', String(durationSec));
    args.push('--ratio', ratioForCli(aspectRatio));
    addOptional(args, '--video_resolution', videoResolution);
    addOptional(args, '--model_version', modelVersion);
    addOptional(args, '--session', sessionId);
    args.push('--poll=0');
    return args;
  }

  const args = ['text2video', '--prompt', prompt];
  if (durationSec) args.push('--duration', String(durationSec));
  args.push('--ratio', ratioForCli(aspectRatio));
  addOptional(args, '--video_resolution', videoResolution);
  addOptional(args, '--model_version', modelVersion);
  addOptional(args, '--session', sessionId);
  return args;
}

function submitIdFromJson(json) {
  const data = unwrapData(json);
  return String(data.submit_id || data.submitId || json.submit_id || json.submitId || '').trim();
}

function genStatusFromJson(json) {
  const data = unwrapData(json);
  return String(data.gen_status || data.genStatus || data.status || json.gen_status || json.status || '').trim().toLowerCase();
}

function isSuccessfulStatus(status) {
  return /^(success|succeed|succeeded|done|completed|complete|finish|finished)$/.test(String(status || '').trim().toLowerCase());
}

function isFailedStatus(status) {
  return /^(fail|failed|failure|error|cancel|canceled|cancelled|aborted)$/.test(String(status || '').trim().toLowerCase());
}

function failReasonFromJson(json) {
  const data = unwrapData(json);
  return String(data.fail_reason || data.failReason || data.error_message || data.error || json.error_message || json.error || '').trim();
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
  const data = unwrapData(json);
  const queue = [data, json].filter((item) => item && typeof item === 'object');
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

function downloadRoot() {
  return path.join(TEMP_DIR, 'hepai_dreamina_results');
}

function downloadDirForSubmit(submitId) {
  return path.join(downloadRoot(), String(submitId).replace(/[\\/:*?"<>|]/g, '_'));
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

function findDownloadedVideos(downloadDir) {
  const videos = [];
  try {
    const stack = [downloadDir];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.(mp4|mov|m4v|webm)$/i.test(entry.name)) videos.push(full);
      }
    }
  } catch {}
  return videos;
}

function findDownloadedImages(downloadDir) {
  const images = [];
  try {
    const stack = [downloadDir];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(entry.name)) images.push(full);
      }
    }
  } catch {}
  return images;
}

function collectImageUrls(value, out = [], key = '') {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^https?:\/\//i.test(raw) && (/(?:image|img|photo|picture|url|uri)/i.test(key) || /\.(?:png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i.test(raw))) out.push(raw);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, out, key));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([entryKey, item]) => collectImageUrls(item, out, entryKey));
  }
  return out;
}

function extractImageResult(json, downloadDir) {
  const strings = collectStrings(json);
  const localFromResult = strings
    .filter((item) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(item) && fs.existsSync(item))
    .map((item) => path.resolve(item));
  const imagePaths = [...new Set([...localFromResult, ...findDownloadedImages(downloadDir)])];
  const imageUrls = [...new Set(collectImageUrls(json))];
  const result = {};
  if (imagePaths.length) Object.assign(result, { imagePath: imagePaths[0], imagePaths });
  if (imageUrls.length) Object.assign(result, { imageUrl: imageUrls[0], imageUrls });
  return result;
}

function extractVideoResult(json, downloadDir) {
  const strings = collectStrings(json);
  const localFromResult = strings
    .filter((item) => /\.(mp4|mov|m4v|webm)$/i.test(item) && fs.existsSync(item))
    .map((item) => path.resolve(item));
  const videoPaths = [...new Set([...localFromResult, ...findDownloadedVideos(downloadDir)])];
  const videoUrls = candidateVideoUrls(json, { includeGenericUrl: true });
  const result = {};
  if (videoPaths.length) Object.assign(result, { videoPath: videoPaths[0], videoPaths });
  if (videoUrls.length) Object.assign(result, { videoUrl: videoUrls[0], videoUrls });
  return result;
}

async function lookupTaskBySubmitId(submitId) {
  try {
    const { stdout } = await runCli(['list_task', '--submit_id', submitId], {
      commandName: 'list_task',
      timeout: TASK_LOOKUP_TIMEOUT_MS,
    });
    const tasks = normalizeTaskList(parseJsonOutput(stdout, 'list_task'));
    // Strict match only: falling back to tasks[0] could attach a different
    // task's status (or video) to this submit id when the filter is ignored.
    return tasks.find((task) => String(task?.submit_id || task?.submitId || '').trim() === submitId) || null;
  } catch {
    return null;
  }
}

// One batched list_task call for the whole poll cycle. Each CLI spawn costs
// seconds (measured ~4s), and the previous per-task `list_task --submit_id`
// probes kept the poll loop busy for minutes while finished videos sat on the
// site waiting to be fetched.
async function lookupTasksBySubmitIds(submitIds = []) {
  const wanted = new Set(submitIds);
  const found = new Map();
  let batchOk = false;
  try {
    const { stdout } = await runCli(['list_task', '--limit', String(Math.max(20, wanted.size * 3))], {
      commandName: 'list_task',
      timeout: QUERY_TIMEOUT_MS,
    });
    for (const task of normalizeTaskList(parseJsonOutput(stdout, 'list_task'))) {
      const sid = String(task?.submit_id || task?.submitId || '').trim();
      if (wanted.has(sid) && !found.has(sid)) found.set(sid, task);
    }
    batchOk = true;
  } catch { /* history is best-effort; query_result still runs per task */ }
  if (batchOk) {
    // Only very old tasks fall outside the batch window; look those up
    // individually. Skip when the batch itself failed (auth/CLI problem) so
    // we do not stack N more doomed spawns onto a broken environment.
    for (const id of wanted) {
      if (found.has(id)) continue;
      const task = await lookupTaskBySubmitId(id);
      if (task) found.set(id, task);
    }
  }
  return found;
}

function terminalFailureFromError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['PAID_REQUIRED', 'COMPLIANCE_REQUIRED', 'CLI_SUBMIT_FAILED'].includes(code)) {
    return error?.message || 'Dreamina CLI task failed';
  }
  const text = String(error?.message || error || '');
  if (/CreditPreDeductNotEnough|generation failed|gen_status\s*[:=]\s*(?:fail|failed)|task\s+(?:failed|error)|invalid\s+(?:task|submit)/i.test(text)) {
    return text;
  }
  return '';
}

export class DreaminaSession {
  constructor({ onProgress } = {}) {
    this.log = (m) => { try { onProgress?.(m); } catch { /* ignore */ } };
  }

  async open() {
    // Auth was verified recently (login/status/probe). Skip the `version` +
    // `login --headless` spawns that otherwise run on every poll cycle —
    // each spawn costs seconds and the background poll ticks every 5s.
    if (recentlyAuthenticated()) {
      this.log('Dreamina CLI ready');
      return;
    }
    const status = await getCliStatus({ checkAuth: false });
    if (!status.installed) {
      throw new DreaminaError(status.error || '未检测到 dreamina CLI', 'CLI_NOT_FOUND');
    }
    await probeAuthenticatedViaLoginReuse();
    this.log('Dreamina CLI ready');
  }

  async close() {}

  async submitOne({
    refImagePaths = [],
    refVideoPaths = [],
    refAudioPaths = [],
    prompt = '',
    duration = 5,
    aspectRatio = '16:9',
    model = '',
    resolution = '',
    session = '',
    mentions = [],
  } = {}) {
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) throw new DreaminaError('提示词为空', 'VALIDATION_ERROR');

    const media = limitMultimodalMedia({
      images: validateMediaFiles(refImagePaths, '参考图'),
      videos: validateMediaFiles(refVideoPaths, '参考视频'),
      audios: validateMediaFiles(refAudioPaths, '参考音频'),
    }, model);
    const { images, videos, audios } = media;
    const referencePromptPrefix = buildReferencePromptPrefix(mentions, media, model);
    const promptWithReferences = withReferencePrompt(cleanPrompt, referencePromptPrefix);
    const stagedImages = stageMediaFilesForCli(images, 'image', '.png');
    const stagedVideos = stageMediaFilesForCli(videos, 'video', '.mp4');
    const stagedAudios = stageMediaFilesForCli(audios, 'audio', '.m4a');
    try {
      const args = buildDreaminaSubmitCommand({
        images: stagedImages.paths,
        videos: stagedVideos.paths,
        audios: stagedAudios.paths,
        prompt: promptWithReferences,
        duration,
        aspectRatio,
        model,
        resolution,
        session,
      });

      if (referencePromptPrefix) {
        this.log(`Dreamina CLI 槽位映射：${referencePromptPrefix.slice(0, 240)}`);
      }
      this.log(`提交 Dreamina CLI 任务：${args[0]}，${images.length} 图/${videos.length} 视频/${audios.length} 音频`);
      const { stdout } = await runCliWithAuthRetry(args, { commandName: args[0] });
      const json = parseJsonOutput(stdout, args[0]);
      const submitId = submitIdFromJson(json);
      const genStatus = genStatusFromJson(json);
      if (!submitId) throw new DreaminaError(`${args[0]} 响应缺少 submit_id`, 'CLI_OUTPUT_INVALID');
      if (isFailedStatus(genStatus) || failReasonFromJson(json)) {
        throw new DreaminaError(failReasonFromJson(json) || 'Dreamina CLI 提交失败', 'CLI_SUBMIT_FAILED');
      }
      this.log(`已提交 Dreamina CLI submitId=${submitId}`);
      return {
        submitId,
        historyId: submitId,
        genStatus,
        command: args[0],
      };
    } finally {
      stagedAudios.cleanup();
      stagedVideos.cleanup();
      stagedImages.cleanup();
    }
  }

  async fetchResults(submitIds = []) {
    const out = {};
    const ids = [...new Set(submitIds.map((value) => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) return out;
    // Read the task history before query_result. The CLI may refresh a
    // terminal failure back to `querying` when the status endpoint is
    // called, so querying first loses the only reliable failure signal.
    const history = await lookupTasksBySubmitIds(ids);
    for (const id of ids) {
      if (out[id]) continue;
      const downloadDir = downloadDirForSubmit(id);
      fs.mkdirSync(downloadDir, { recursive: true });
      const historicalTask = history.get(id) || null;
      const historicalStatus = genStatusFromJson(historicalTask || {});
      const historicalFailure = failReasonFromJson(historicalTask || {});
      if (isFailedStatus(historicalStatus) || historicalFailure) {
        out[id] = { status: 'failed', fail: historicalFailure || 'Dreamina CLI task failed', progress: 100 };
        continue;
      }
      const historicalMedia = extractVideoResult(historicalTask || {}, downloadDir);
      if (historicalMedia.videoPath || historicalMedia.videoUrl) {
        out[id] = { status: 'done', ...historicalMedia, progress: 100 };
        continue;
      }
      try {
        const { stdout } = await runCli([
          'query_result',
          '--submit_id', id,
        ], {
          commandName: 'query_result',
          timeout: QUERY_TIMEOUT_MS,
        });
        const json = parseJsonOutput(stdout, 'query_result');
        let status = genStatusFromJson(json);
        let failReason = failReasonFromJson(json);
        const progress = progressFromJson(json);
        if (isFailedStatus(status) || failReason) {
          out[id] = { status: 'failed', fail: failReason || 'Dreamina CLI task failed', progress: progress ?? 100 };
          continue;
        }
        const media = extractVideoResult(json, downloadDir);
        if (media.videoPath || media.videoUrl) {
          out[id] = { status: 'done', ...media, progress: 100 };
          continue;
        }

        // query_result can briefly report `querying` after the task has
        // reached a terminal state. The task history resolves that race and
        // also exposes failures that query_result sometimes masks.
        if (!isSuccessfulStatus(status) && !isFailedStatus(status) && isSuccessfulStatus(historicalStatus)) {
          status = historicalStatus;
          failReason = historicalFailure;
        }

        if (isSuccessfulStatus(status)) {
          try {
            const { stdout: downloadStdout } = await runCli([
              'query_result',
              '--submit_id', id,
              '--download_dir', downloadDir,
            ], {
              commandName: 'query_result',
              timeout: QUERY_DOWNLOAD_TIMEOUT_MS,
            });
            const downloadedJson = parseJsonOutput(downloadStdout, 'query_result');
            const downloadedMedia = extractVideoResult(downloadedJson, downloadDir);
            if (downloadedMedia.videoPath || downloadedMedia.videoUrl) {
              out[id] = { status: 'done', ...downloadedMedia, progress: 100 };
              continue;
            }
          } catch {
            // The official CLI can fail on CDN mirror downloads even when the
            // result JSON already contains a usable video_url.
          }
          const videoPaths = findDownloadedVideos(downloadDir);
          out[id] = videoPaths.length
            ? { status: 'done', videoPath: videoPaths[0], videoPaths, progress: 100 }
            : { status: 'done_no_url', progress: 100 };
        } else {
          out[id] = { status: 'queued', progress };
        }
      } catch (e) {
        if (e?.code === 'AUTH_EXPIRED' || e?.code === 'CLI_NOT_FOUND') {
          // Environment problem, not a task failure: the remote task is
          // likely still running. Keep every remaining task queued and stop
          // the batch so the next cycle re-probes the login state.
          forgetAuthenticated();
          for (const rest of ids) {
            if (!out[rest]) out[rest] = { status: 'queued', note: e.message };
          }
          break;
        }
        const terminalFailure = terminalFailureFromError(e);
        out[id] = terminalFailure
          ? { status: 'failed', fail: terminalFailure, progress: 100 }
          : { status: 'queued', note: e.message };
      }
    }
    return out;
  }
}

export async function submitVideos({ shots = [], onProgress, onSubmitProgress, model, resolution, session } = {}) {
  const sessionClient = new DreaminaSession({ onProgress });
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
    await sessionClient.open();
    for (const shot of shots) {
      emitSubmitProgress(`正在提交镜头 ${shot.shotNo}...`);
      try {
        const result = await sessionClient.submitOne({
          refImagePaths: shot.refImagePaths,
          refVideoPaths: shot.refVideoPaths,
          refAudioPaths: shot.refAudioPaths,
          prompt: shot.prompt,
          duration: shot.duration,
          aspectRatio: shot.aspectRatio,
          model: shot.model || model,
          resolution: shot.resolution || resolution,
          session: shot.session || session,
          mentions: shot.mentions,
        });
        results.push({ shotNo: shot.shotNo, ok: true, ...result });
        emitSubmitProgress(`镜头 ${shot.shotNo} 已提交`);
      } catch (e) {
        results.push({ shotNo: shot.shotNo, ok: false, error: e.message, code: e.code });
        emitSubmitProgress(`镜头 ${shot.shotNo} 提交失败：${e.message}`);
        if (e.code === 'AUTH_EXPIRED' || e.code === 'CLI_NOT_FOUND' || e.code === 'COMPLIANCE_REQUIRED') break;
      }
    }
    return results;
  } finally {
    await sessionClient.close();
  }
}

export async function fetchVideoResults({ submitIds = [], onProgress } = {}) {
  if (!submitIds.length) return {};
  const sessionClient = new DreaminaSession({ onProgress });
  await sessionClient.open();
  return sessionClient.fetchResults(submitIds);
}

export async function generateImage({
  prompt = '',
  referencePaths = [],
  ratio = '16:9',
  model = '5.0',
  resolution = '',
  session = '',
  onProgress,
  timeoutMs = 60 * 60 * 1000,
} = {}) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new DreaminaError('提示词为空', 'VALIDATION_ERROR');
  const refs = (Array.isArray(referencePaths) ? referencePaths : [referencePaths])
    .map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10);
  const args = buildDreaminaImageSubmitCommand({
    referencePaths: refs,
    prompt: cleanPrompt,
    ratio,
    resolution,
    model,
    session,
  });
  const sessionClient = new DreaminaSession({ onProgress });
  await sessionClient.open();
  onProgress?.(`正在提交即梦图片任务：${args[0]}`);
  const { stdout } = await runCliWithAuthRetry(args, { commandName: args[0] });
  const submitted = parseJsonOutput(stdout, args[0]);
  const submitId = submitIdFromJson(submitted);
  const submittedStatus = genStatusFromJson(submitted);
  if (!submitId) throw new DreaminaError(`${args[0]} 响应缺少 submit_id`, 'CLI_OUTPUT_INVALID');
  if (isFailedStatus(submittedStatus) || failReasonFromJson(submitted)) {
    throw new DreaminaError(failReasonFromJson(submitted) || '即梦图片提交失败', 'CLI_SUBMIT_FAILED');
  }

  const downloadDir = downloadDirForSubmit(`${submitId}_image`);
  await fs.promises.mkdir(downloadDir, { recursive: true });
  const startedAt = Date.now();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastProgress = null;
  let preserveDownloadDir = false;
  try {
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const { stdout: queryStdout } = await runCliWithAuthRetry([
          'query_result', '--submit_id', submitId,
        ], { commandName: 'query_result', timeout: QUERY_TIMEOUT_MS });
        const queried = parseJsonOutput(queryStdout, 'query_result');
        const status = genStatusFromJson(queried);
        const failReason = failReasonFromJson(queried);
        const progress = progressFromJson(queried);
        if (progress != null && progress !== lastProgress) {
          lastProgress = progress;
          onProgress?.(`即梦图片生成中 ${progress}%`);
        }
        if (isFailedStatus(status) || failReason) {
          throw new DreaminaError(failReason || '即梦图片生成失败', 'CLI_SUBMIT_FAILED');
        }
        let media = extractImageResult(queried, downloadDir);
        if (!media.imagePath && !media.imageUrl && isSuccessfulStatus(status)) {
          try {
            const { stdout: downloadStdout } = await runCliWithAuthRetry([
              'query_result', '--submit_id', submitId, '--download_dir', downloadDir,
            ], { commandName: 'query_result', timeout: QUERY_DOWNLOAD_TIMEOUT_MS });
            media = { ...media, ...extractImageResult(parseJsonOutput(downloadStdout, 'query_result'), downloadDir) };
          } catch {
            media = { ...media, imagePaths: findDownloadedImages(downloadDir) };
            if (!media.imagePath && media.imagePaths?.length) media.imagePath = media.imagePaths[0];
          }
        }
        if (media.imagePath || media.imageUrl) {
          onProgress?.('即梦图片生成完成');
          preserveDownloadDir = true;
          return {
            ...media,
            submitId,
            model: imageModelForCli(model),
            provider: 'dreamina-cli',
            cleanup: () => fs.promises.rm(downloadDir, { recursive: true, force: true }).catch(() => {}),
          };
        }
      } catch (error) {
        if (error?.code === 'AUTH_EXPIRED' || error?.code === 'CLI_NOT_FOUND') throw error;
        if (error?.code === 'CLI_SUBMIT_FAILED') throw error;
        onProgress?.(`即梦图片查询重试：${error.message}`);
      }
      await wait(2000);
    }
    throw new DreaminaError('即梦图片生成超时，请在即梦 CLI 任务历史中查看结果', 'QUERY_TIMEOUT');
  } finally {
    if (!preserveDownloadDir) await fs.promises.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function fetchAccountCredit() {
  const { stdout } = await runCli(['user_credit'], {
    commandName: 'user_credit',
    timeout: STATUS_TIMEOUT_MS,
  });
  return parseJsonOutput(stdout, 'user_credit');
}

async function probeAuthenticatedViaTaskList() {
  await runCli(['list_task', '--limit=1'], {
    commandName: 'list_task',
    timeout: STATUS_TIMEOUT_MS,
  });
  return true;
}

async function probeAuthenticatedViaLoginReuse() {
  const { stdout, stderr } = await runCli(['login', '--headless'], {
    commandName: 'dreamina login --headless',
    timeout: STATUS_TIMEOUT_MS,
    allowLoginMaterial: true,
  });
  if (looksLikeLoginSuccess(stdout, stderr)) {
    rememberAuthenticated();
    return true;
  }
  const material = parseLoginMaterial(stdout, stderr);
  if (material.deviceCode) {
    throw new DreaminaError('Dreamina CLI 未登录，请先点击“登录 CLI”完成授权', 'AUTH_EXPIRED');
  }
  throw new DreaminaError(cliText(stdout, stderr) || 'Dreamina CLI 未登录', 'AUTH_EXPIRED');
}

async function runCliWithAuthRetry(args, options = {}) {
  try {
    return await runCli(args, options);
  } catch (e) {
    if (e?.code !== 'AUTH_EXPIRED') throw e;
    await probeAuthenticatedViaLoginReuse();
    return runCli(args, options);
  }
}

function normalizeTaskList(json) {
  if (Array.isArray(json)) return json;
  const data = unwrapData(json);
  for (const key of ['tasks', 'list', 'items', 'task_list', 'taskList']) {
    if (Array.isArray(data?.[key])) return data[key];
    if (Array.isArray(json?.[key])) return json[key];
  }
  return [];
}

export async function listTasks() {
  const { stdout } = await runCli(['list_task'], {
    commandName: 'list_task',
    timeout: QUERY_TIMEOUT_MS,
  });
  return normalizeTaskList(parseJsonOutput(stdout, 'list_task'));
}

function loginInstructionMessage(opened, material) {
  const url = String(material?.verificationUri || '').trim();
  return opened ? '已打开浏览器，请在网页中完成登录授权' : '请打开 ' + url + ' 完成登录授权';
}

function normalizeLoginProgressMessage(message) {
  const text = String(message || '');
  return /\u9a8c\u8bc1\u7801|\u6960\u5c83\u7629\u9401|user_code/i.test(text)
    ? '正在获取 Dreamina CLI 登录授权链接...'
    : text;
}
export async function loginCli({ onProgress, force = false } = {}) {
  const log = (m) => { try { onProgress?.(normalizeLoginProgressMessage(m)); } catch { /* ignore */ } };
  await installBundledCliToUserBin(log);
  const status = await getCliStatus({ checkAuth: true, allowRecentAuthFallback: false, onProgress: log });
  if (status.authenticated && !force) {
    log('Dreamina CLI 已登录');
    rememberAuthenticated();
    return { ok: true, alreadyAuthenticated: true, ...status };
  }

  log('正在获取 Dreamina CLI 登录授权链接...');
  const loginCommand = force ? 'relogin' : 'login';
  const { stdout, stderr } = await runCli([loginCommand, '--headless'], {
    commandName: `dreamina ${loginCommand} --headless`,
    timeout: STATUS_TIMEOUT_MS,
    allowLoginMaterial: true,
  });
  const material = parseLoginMaterial(stdout, stderr);
  if (!material.deviceCode) {
    const current = await getCliStatus({ checkAuth: true, allowRecentAuthFallback: false, onProgress: log });
    if (current.authenticated) {
      log('Dreamina CLI 已登录');
      rememberAuthenticated();
      return { ok: true, alreadyAuthenticated: true, ...current };
    }
    if (looksLikeLoginSuccess(stdout, stderr)) {
      rememberAuthenticated();
      return {
        ok: true,
        alreadyAuthenticated: true,
        ...current,
        authenticated: true,
        authWarning: current.authError || current.creditError || current.authWarning || 'Dreamina CLI 已复用本地登录态',
      };
      throw new DreaminaError(
        current.authError || current.creditError || current.authWarning || 'Dreamina CLI 登录态未通过提交前校验',
        'AUTH_EXPIRED'
      );
    }
    throw new DreaminaError(
      `Dreamina CLI 未返回 device_code，无法启动网页登录：${material.raw || '空输出'}`,
      'LOGIN_OUTPUT_INVALID'
    );
  }

  const opened = await openExternalUrl(material.verificationUri);
  log(loginInstructionMessage(opened, material));

  await runCli([
    'login',
    'checklogin',
    `--device_code=${material.deviceCode}`,
    '--poll=300',
  ], {
    commandName: 'dreamina login checklogin',
    timeout: LOGIN_TIMEOUT_MS,
  });
  const finalStatus = await getCliStatus({ checkAuth: true, allowRecentAuthFallback: false, onProgress: log });
  if (!finalStatus.authenticated) {
    throw new DreaminaError(finalStatus.authError || 'Dreamina CLI 登录未完成', 'AUTH_EXPIRED');
  }
  log('Dreamina CLI 登录完成');
  rememberAuthenticated();
  return {
    ok: true,
    opened,
    verificationUri: material.verificationUri,
    userCode: material.userCode,
    ...finalStatus,
    authenticated: true,
    authWarning: finalStatus.authWarning,
  };
}

export async function logoutCli({ onProgress } = {}) {
  const log = (m) => { try { onProgress?.(m); } catch { /* ignore */ } };
  log('正在退出 Dreamina CLI 登录...');
  await runCli(['logout'], {
    commandName: 'dreamina logout',
    timeout: STATUS_TIMEOUT_MS,
  });
  forgetAuthenticated();
  const status = await getCliStatus({ checkAuth: true, allowRecentAuthFallback: false, onProgress: log });
  log('Dreamina CLI 已退出登录');
  return { ok: true, ...status };
}

async function installBundledCliToUserBin(log) {
  const bundled = bundledCliPath();
  if (!bundled || findUserInstalledCliPath()) return null;

  const target = process.platform === 'win32'
    ? path.join(os.homedir(), 'bin', 'dreamina.exe')
    : path.join(os.homedir(), '.local', 'bin', 'dreamina');
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(bundled, target);

  if (process.platform === 'win32') {
    try {
      await ensureWindowsUserPath(path.dirname(target));
      log(`已将内置 Dreamina CLI 安装到 ${target} 并写入用户 PATH`);
    } catch {
      log(`已将内置 Dreamina CLI 安装到 ${target}，但未能自动写入用户 PATH`);
    }
  } else {
    try { await fs.promises.chmod(target, 0o755); } catch { /* ignore */ }
    log(`已将内置 Dreamina CLI 安装到 ${target}`);
  }

  return { ok: true, installed: true, command: target, bundled: true };
}

export async function installCli({ onProgress } = {}) {
  const log = (m) => { try { onProgress?.(m); } catch { /* ignore */ } };
  const bundledInstall = await installBundledCliToUserBin(log);
  if (bundledInstall) return bundledInstall;

  const status = await getCliStatus({ checkAuth: false, onProgress: log });
  if (status.installed) {
    log(`Dreamina CLI 已安装：${status.version || status.command}`);
    return { ok: true, alreadyInstalled: true, ...status };
  }
  log('开始安装 Dreamina CLI...');

  // Windows：官方脚本只是下载一个 exe 到 ~/bin 并写 PATH，用纯 Node 完成，避免依赖 Git Bash。
  if (process.platform === 'win32') {
    try {
      await installCliWindows(log);
    } catch (e) {
      throw new DreaminaError(
        `安装 Dreamina CLI 失败：${e.message || e}`,
        'CLI_INSTALL_FAILED'
      );
    }
    log('Dreamina CLI 安装完成');
    return { ok: true };
  }

  // macOS / Linux：复用官方安装脚本（这些平台默认有 bash）
  try {
    await execFileAsync('bash', ['-lc', `curl -fsSL ${INSTALL_URL} | bash`], {
      cwd: runtimeCwd(),
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
      windowsHide: true,
    });
  } catch (e) {
    const detail = String(e?.stderr || e?.stdout || e?.message || '').trim();
    throw new DreaminaError(
      `安装 Dreamina CLI 失败：${detail || '请确认已安装 bash/curl，或手动执行 curl -fsSL https://jimeng.jianying.com/cli | bash'}`,
      'CLI_INSTALL_FAILED'
    );
  }
  log('Dreamina CLI 安装完成');
  return { ok: true };
}

// 用 Node 下载一个 URL 到本地文件（跟随重定向，由 fetch 处理）。
async function downloadToFile(url, destPath, { timeoutMs = INSTALL_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tempPath = `${destPath}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YanzhiAI-Dreamina-Updater/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error(`下载内容为空：${url}`);
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(tempPath, buf);
    await fs.promises.rename(tempPath, destPath);
    return buf.length;
  } finally {
    clearTimeout(timer);
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
  }
}

// Windows 原生安装：下载 exe + SKILL.md + version.json 到 ~/.dreamina_cli 与 ~/bin，并把 ~/bin 写入用户 PATH。
async function installCliWindows(log) {
  const home = os.homedir();
  const binDir = path.join(home, 'bin');
  const targetExe = path.join(binDir, 'dreamina.exe');
  const skillDir = path.join(home, '.dreamina_cli', 'dreamina');

  log(`下载 ${DREAMINA_WIN_BINARY_URL}`);
  const size = await downloadToFile(DREAMINA_WIN_BINARY_URL, targetExe);
  if (size < 1024 * 1024) throw new Error(`下载的 dreamina.exe 过小(${size}B)，疑似失败`);

  // SKILL.md / version.json 是辅助文件，失败不阻断安装
  try { log(`下载 ${DREAMINA_SKILL_URL}`); await downloadToFile(DREAMINA_SKILL_URL, path.join(skillDir, 'SKILL.md')); } catch { /* 可选 */ }
  try { log(`下载 ${DREAMINA_VERSION_URL}`); await downloadToFile(DREAMINA_VERSION_URL, path.join(home, '.dreamina_cli', 'version.json')); } catch { /* 可选 */ }

  // 把 ~/bin 加入用户 PATH（持久化），让重开应用/终端后能直接调 dreamina
  try {
    await ensureWindowsUserPath(binDir);
    log(`已将 ${binDir} 加入用户 PATH`);
  } catch {
    log(`提示：未能自动写入 PATH，CLI 已装到 ${targetExe}，应用内仍可直接调用`);
  }
}

// 通过 PowerShell 把目录追加进当前用户 PATH（已存在则跳过）。
async function ensureWindowsUserPath(dir) {
  const psScript =
    `$t='${dir.replace(/'/g, "''")}';` +
    `$c=[Environment]::GetEnvironmentVariable('Path','User');` +
    `if([string]::IsNullOrWhiteSpace($c)){[Environment]::SetEnvironmentVariable('Path',$t,'User')}` +
    `elseif(-not ($c.Split(';') -contains $t)){[Environment]::SetEnvironmentVariable('Path',$c+';'+$t,'User')}`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    timeout: 20000,
    windowsHide: true,
  });
}

export async function getCliStatus({ checkAuth = true, allowRecentAuthFallback = true, onProgress } = {}) {
  let version = '';
  let command = 'dreamina';
  let installedPath = findInstalledCliPath();
  if (installedPath) {
    const update = await maybeUpdateCli({ installedPath, onProgress });
    if (update?.error) console.warn(`[dreamina] auto update skipped: ${update.error.message || update.error}`);
    if (update?.updated) installedPath = findInstalledCliPath() || installedPath;
  }
  try {
    const { stdout, stderr } = await runCli(['version'], {
      commandName: 'dreamina version',
      timeout: STATUS_TIMEOUT_MS,
    });
    version = String(stdout || stderr || '').trim();
  } catch (e) {
    try {
      const { stdout, stderr } = await runCli(['-h'], {
        commandName: 'dreamina -h',
        timeout: STATUS_TIMEOUT_MS,
      });
      version = String(stdout || stderr || '').split(/\r?\n/)[0]?.trim() || '';
    } catch (helpError) {
      // 跑不通 version/-h，但文件确实在 → 仍算已安装（spawn 在打包环境可能失败）
      if (installedPath) {
        return { installed: true, authenticated: false, command: installedPath, version: '', probeError: helpError.message };
      }
      return {
        installed: false,
        authenticated: false,
        command,
        error: helpError.message,
      };
    }
  }

  const status = { installed: true, authenticated: false, command: installedPath || command, version };
  if (!checkAuth) return status;
  try {
    status.credit = await fetchAccountCredit();
    status.authenticated = true;
    rememberAuthenticated();
  } catch (e) {
    status.creditError = e.message;
    try {
      await probeAuthenticatedViaTaskList();
      status.authenticated = true;
      rememberAuthenticated();
      status.authWarning = `user_credit 查询失败，但 list_task 可用，已继续使用当前登录态：${e.message}`;
    } catch (probeError) {
      try {
        await probeAuthenticatedViaLoginReuse();
        status.authenticated = true;
        rememberAuthenticated();
        status.authWarning = `Dreamina CLI 已复用本地登录态，但状态探测不可用：${probeError.message || e.message}`;
      } catch (reuseError) {
        if (allowRecentAuthFallback && recentlyAuthenticated()) {
          status.authenticated = true;
          status.authWarning = `Dreamina login just completed; optional status probes are unavailable: ${reuseError.message || probeError.message || e.message}`;
          status.authProbeError = reuseError.message || probeError.message || e.message;
        } else {
          status.authenticated = false;
          status.authError = reuseError.message || probeError.message || e.message;
        }
      }
    }
  }
  return status;
}
