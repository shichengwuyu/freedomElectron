import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { TEMP_DIR, USER_APP_DIR } from './config.js';
import {
  DEFAULT_LIBTV_VIDEO_MODEL,
  LIBTV_VIDEO_MODEL_NAMES,
  normalizeLibtvVideoModelName,
} from './libtvModels.js';
import { candidateVideoUrls } from './videoCandidates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ACTIVITY_URL = 'https://api2.liblib.art/api/www/landing-activities/getById?id=240';
const STATUS_TIMEOUT_MS = 15 * 1000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 12 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const LOCAL_ACCOUNT_ID = 'libtv-local';
const projectConcurrencyStates = new Map();
const modelSchemaCache = new Map();

export class LibtvError extends Error {
  constructor(message, code = 'LIBTV_ERROR') {
    super(message);
    this.name = 'LibtvError';
    this.code = code;
  }
}

export function localAccountId() {
  return LOCAL_ACCOUNT_ID;
}

function runtimeCwd() {
  const directory = path.join(USER_APP_DIR, 'integrations', 'libtv');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function bundledCliPath() {
  const exe = process.platform === 'win32' ? 'libtv.exe' : 'libtv';
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'libtv', exe));
  candidates.push(path.join(ROOT, 'vendor', 'libtv', exe));
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || '';
}

function userCliPaths() {
  const exe = process.platform === 'win32' ? 'libtv.exe' : 'libtv';
  return [
    path.join(os.homedir(), '.libtv', exe),
    path.join(os.homedir(), '.local', 'bin', exe),
    path.join(os.homedir(), 'bin', exe),
  ];
}

function findInstalledCliPath() {
  const bundled = bundledCliPath();
  for (const candidate of [...userCliPaths(), ...(bundled ? [bundled] : [])]) {
    try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch { /* continue */ }
  }
  return '';
}

function cliCandidates() {
  const name = process.platform === 'win32' ? 'libtv.exe' : 'libtv';
  const installed = findInstalledCliPath();
  return [...new Set([...(installed ? [installed] : []), ...userCliPaths(), name])];
}

function isMissingCommandError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  return /ENOENT|EINVAL|not recognized|not found|cannot find/i.test(text);
}

function normalizeCliError(error, commandName = 'libtv') {
  if (error instanceof LibtvError) return error;
  if (isMissingCommandError(error)) {
    return new LibtvError('未检测到 LibTV CLI，请先安装或更新 CLI', 'CLI_NOT_FOUND');
  }
  const detail = String(error?.stderr || error?.stdout || error?.message || 'CLI 未返回错误详情').trim();
  let code = 'CLI_FAILED';
  if (/login|auth|credential|token|unauthorized|forbidden|401|403|登录|凭据|授权/i.test(detail)) code = 'AUTH_EXPIRED';
  else if (/project|画布|projectUuid|UUID/i.test(detail)) code = 'PROJECT_INVALID';
  else if (/model|schema|模型/i.test(detail)) code = 'MODEL_INVALID';
  return new LibtvError(`${commandName} 执行失败：${detail}`, code);
}

function runProcess(command, args = [], {
  cwd = runtimeCwd(),
  env = process.env,
  timeoutMs = STATUS_TIMEOUT_MS,
  onProgress,
  commandName = command,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout = [];
    const stderr = [];
    let progressBuffer = '';
    let settled = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      child.kill();
      const error = new Error(`${commandName} 执行超时`);
      error.code = 'ETIMEDOUT';
      error.stdout = Buffer.concat(stdout).toString('utf8');
      error.stderr = Buffer.concat(stderr).toString('utf8');
      settled = true;
      reject(error);
    }, timeoutMs) : null;

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      stderr.push(buffer);
      progressBuffer += buffer.toString('utf8');
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() || '';
      for (const line of lines) {
        const message = line.trim();
        if (message) onProgress?.(message);
      }
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (progressBuffer.trim()) onProgress?.(progressBuffer.trim());
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolve(result);
      else {
        const error = new Error(`${commandName} exited with code ${code}`);
        error.code = code;
        Object.assign(error, result);
        reject(error);
      }
    });
  });
}

async function runLibtv(args = [], options = {}) {
  let missingError = null;
  for (const candidate of cliCandidates()) {
    try {
      return await runProcess(candidate, args, options);
    } catch (error) {
      if (isMissingCommandError(error)) {
        missingError = missingError || error;
        continue;
      }
      throw normalizeCliError(error, options.commandName || `libtv ${args.join(' ')}`);
    }
  }
  throw normalizeCliError(missingError || new Error('libtv not found'), options.commandName || 'libtv');
}

export function parseLibtvJson(text, commandName = 'libtv') {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new LibtvError(`${commandName} 未返回 JSON`, 'CLI_OUTPUT_INVALID');
  try { return JSON.parse(raw); } catch { /* try NDJSON or trailing JSON */ }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* continue */ }
  }
  throw new LibtvError(`${commandName} 返回了无法解析的数据`, 'CLI_OUTPUT_INVALID');
}

function versionParts(value) {
  const match = String(value || '').trim().match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? match.slice(1).map((part) => Number(part || 0)) : null;
}

export function compareLibtvVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

async function fetchReleaseInfo() {
  const response = await fetch(ACTIVITY_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`LibTV 版本接口 HTTP ${response.status}`);
  const outer = await response.json();
  const linkUrl = String(outer?.data?.linkUrl || '').trim();
  if (!linkUrl) throw new Error('LibTV 版本接口缺少 data.linkUrl');
  const release = JSON.parse(linkUrl);
  if (!String(release?.version || '').trim()) throw new Error('LibTV 版本接口缺少 version');
  return release;
}

function accountNameFromInfo(value = {}) {
  const account = value?.activeAccount || value?.data?.activeAccount || {};
  const user = value?.user || value?.data?.user || {};
  return String(account.accountName || account.name || user.nickname || user.name || '').trim();
}

export async function getCliStatus({ checkUpdate = false } = {}) {
  let version = '';
  let command = findInstalledCliPath() || 'libtv';
  try {
    const result = await runLibtv(['--version'], { commandName: 'libtv --version', timeoutMs: STATUS_TIMEOUT_MS });
    version = String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || '';
  } catch (error) {
    return { installed: false, authenticated: false, command, version: '', error: error.message };
  }

  const status = { installed: true, authenticated: false, command, version };
  try {
    const { stdout } = await runLibtv(['account', 'info'], { commandName: 'libtv account info', timeoutMs: STATUS_TIMEOUT_MS });
    const account = parseLibtvJson(stdout, 'libtv account info');
    status.authenticated = true;
    status.account = account;
    status.accountName = accountNameFromInfo(account);
  } catch (error) {
    status.authError = error.message;
  }

  if (checkUpdate) {
    try {
      const release = await fetchReleaseInfo();
      status.latestVersion = String(release.version || '').trim();
      status.updateAvailable = compareLibtvVersions(status.latestVersion, version) === 1;
    } catch (error) {
      status.updateError = error.message;
    }
  }
  return status;
}

export function normalizeLibtvVideoModels(value = {}) {
  const matches = Array.isArray(value) ? value : (Array.isArray(value?.matches) ? value.matches : []);
  const allowed = new Map();
  for (const item of matches) {
    const modelName = String(item?.modelName || item?.name || item?.label || '').trim();
    if (!LIBTV_VIDEO_MODEL_NAMES.includes(modelName) || allowed.has(modelName)) continue;
    allowed.set(modelName, {
      modelName,
      modelKey: String(item?.modelKey || item?.key || '').trim(),
      aliasName: String(item?.aliasName || '').trim(),
      description: String(item?.description || '').trim(),
      estimatedTime: String(item?.estimatedTime || '').trim(),
      vip: item?.vip === true,
    });
  }
  return LIBTV_VIDEO_MODEL_NAMES.map((modelName) => allowed.get(modelName)).filter(Boolean);
}

export async function listVideoModels() {
  const { stdout } = await runLibtv(['model', 'search', '--type', 'video'], {
    commandName: 'libtv model search --type video',
    timeoutMs: STATUS_TIMEOUT_MS * 2,
  });
  const output = parseLibtvJson(stdout, 'libtv model search --type video');
  const models = normalizeLibtvVideoModels(output);
  if (!models.length) throw new LibtvError('LibTV CLI 未返回可用的视频模型', 'MODEL_LIST_EMPTY');
  return { models, count: models.length };
}

export function normalizeLibtvImageModels(value = {}) {
  const matches = Array.isArray(value) ? value : (Array.isArray(value?.matches) ? value.matches : []);
  const seen = new Set();
  return matches.map((item) => {
    const modelName = String(item?.modelName || item?.name || item?.label || '').trim();
    if (!modelName || seen.has(modelName)) return null;
    seen.add(modelName);
    return {
      modelName,
      modelKey: String(item?.modelKey || item?.key || '').trim(),
      aliasName: String(item?.aliasName || '').trim(),
      description: String(item?.description || '').trim(),
      estimatedTime: String(item?.estimatedTime || '').trim(),
      vip: item?.vip === true,
    };
  }).filter(Boolean);
}

export async function listImageModels() {
  const { stdout } = await runLibtv(['model', 'search', '--type', 'image'], {
    commandName: 'libtv model search --type image',
    timeoutMs: STATUS_TIMEOUT_MS * 2,
  });
  const output = parseLibtvJson(stdout, 'libtv model search --type image');
  const models = normalizeLibtvImageModels(output);
  if (!models.length) throw new LibtvError('LibTV CLI 未返回可用的图片模型', 'MODEL_LIST_EMPTY');
  return { models, count: models.length };
}

async function downloadToFile(url, targetPath, timeoutMs = INSTALL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tempPath = `${targetPath}.${process.pid}-${Date.now()}.part`;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('下载内容为空');
    await fs.promises.writeFile(tempPath, bytes);
    await fs.promises.rename(tempPath, targetPath);
    return bytes.length;
  } finally {
    clearTimeout(timer);
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function installCli({ onProgress, force = false } = {}) {
  const log = (message) => { try { onProgress?.(message); } catch { /* ignore */ } };
  const release = await fetchReleaseInfo();
  const previous = await getCliStatus({ checkUpdate: false });
  const comparison = previous.installed ? compareLibtvVersions(release.version, previous.version) : 1;
  if (!force && previous.installed && comparison !== 1) {
    return { ok: true, alreadyInstalled: true, latestVersion: release.version, ...previous };
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hepai_libtv_install_'));
  try {
    log(`正在安装 LibTV CLI ${release.version}...`);
    const env = { ...process.env, LIBTV_CLI_VERSION: String(release.version || '') };
    if (process.platform === 'win32') {
      const scriptUrl = String(release?.install?.PowerShell || '').trim();
      if (!scriptUrl) throw new Error('LibTV 发布信息缺少 Windows 安装脚本');
      const scriptPath = path.join(tempDir, 'install-libtv-cli.ps1');
      await downloadToFile(scriptUrl, scriptPath);
      await runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        cwd: tempDir,
        env,
        timeoutMs: INSTALL_TIMEOUT_MS,
        onProgress: log,
        commandName: 'LibTV CLI installer',
      });
    } else {
      const scriptUrl = String(release?.install?.shell || '').trim();
      if (!scriptUrl) throw new Error('LibTV 发布信息缺少 shell 安装脚本');
      const scriptPath = path.join(tempDir, 'install-libtv-cli.sh');
      await downloadToFile(scriptUrl, scriptPath);
      await fs.promises.chmod(scriptPath, 0o755);
      await runProcess('bash', [scriptPath], {
        cwd: tempDir,
        env,
        timeoutMs: INSTALL_TIMEOUT_MS,
        onProgress: log,
        commandName: 'LibTV CLI installer',
      });
    }
    modelSchemaCache.clear();
    const status = await getCliStatus({ checkUpdate: true });
    if (!status.installed) throw new Error(status.error || '安装后仍未检测到 LibTV CLI');
    log(`LibTV CLI ${status.version || release.version} 安装完成`);
    return { ok: true, updated: previous.installed, ...status };
  } catch (error) {
    throw normalizeCliError(error, 'LibTV CLI 安装');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function loginCli({ onProgress } = {}) {
  const log = (message) => { try { onProgress?.(message); } catch { /* ignore */ } };
  let status = await getCliStatus({ checkUpdate: false });
  if (!status.installed) {
    await installCli({ onProgress: log });
    status = await getCliStatus({ checkUpdate: false });
  }
  if (status.authenticated) return { ok: true, alreadyAuthenticated: true, ...status };
  log('正在打开 LibTV 登录页面...');
  await runLibtv(['login', 'web', '--open'], {
    commandName: 'libtv login web',
    timeoutMs: LOGIN_TIMEOUT_MS,
    onProgress: log,
  });
  const finalStatus = await getCliStatus({ checkUpdate: false });
  if (!finalStatus.authenticated) {
    throw new LibtvError(finalStatus.authError || 'LibTV CLI 登录未完成', 'AUTH_EXPIRED');
  }
  log('LibTV CLI 登录完成');
  return { ok: true, ...finalStatus };
}

export async function logoutCli({ onProgress } = {}) {
  const log = (message) => { try { onProgress?.(message); } catch { /* ignore */ } };
  log('正在退出 LibTV CLI 登录...');
  await runLibtv(['logout'], { commandName: 'libtv logout', timeoutMs: STATUS_TIMEOUT_MS, onProgress: log });
  const status = await getCliStatus({ checkUpdate: false });
  log('LibTV CLI 已退出登录');
  return { ok: true, ...status, authenticated: false };
}

function schemaObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 7) return null;
  if (value.properties && typeof value.properties === 'object') return value;
  for (const key of ['schema', 'tool_spec', 'toolSpec', 'data', 'result', 'model']) {
    const found = schemaObject(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function modelSchema(modelName) {
  const model = String(modelName || '').trim();
  if (!model) throw new LibtvError('未指定 LibTV 模型', 'MODEL_INVALID');
  if (modelSchemaCache.has(model)) return modelSchemaCache.get(model);
  const schemaPromise = (async () => {
    const { stdout } = await runLibtv(['model', model], {
      commandName: `libtv model ${model}`,
      timeoutMs: STATUS_TIMEOUT_MS * 2,
    });
    const output = parseLibtvJson(stdout, `libtv model ${model}`);
    return schemaObject(output) || {};
  })();
  modelSchemaCache.set(model, schemaPromise);
  try {
    return await schemaPromise;
  } catch (error) {
    if (modelSchemaCache.get(model) === schemaPromise) modelSchemaCache.delete(model);
    throw error;
  }
}

async function videoModelSchema(modelName) {
  return modelSchema(normalizeLibtvVideoModelName(modelName));
}

function availableModeTypes(schema = {}) {
  const items = schema?.properties?.modeType?.items;
  return items && typeof items === 'object' && !Array.isArray(items) ? Object.keys(items) : [];
}

export function chooseLibtvVideoMode({ imageCount = 0, videoCount = 0, audioCount = 0 } = {}, modes = []) {
  const available = new Set((modes || []).map((mode) => String(mode || '').trim()).filter(Boolean));
  const candidates = [];
  if (imageCount || videoCount || audioCount) {
    candidates.push('mixed2video');
    if (audioCount) candidates.push('audio2video');
    if (videoCount) candidates.push('video2video');
    if (imageCount > 1) candidates.push('image2video');
    if (imageCount === 1) candidates.push('singleImage2video', 'image2video', 'frames2video');
  } else {
    candidates.push('text2video');
  }
  if (available.size) return candidates.find((mode) => available.has(mode)) || [...available][0];
  return candidates[0] || 'text2video';
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeNodePart(value, fallback) {
  const clean = oneLine(value).replace(/[\\/:*?"<>|{}]/g, '_').replace(/\s+/g, '_').slice(0, 36);
  return clean || fallback;
}

function mediaLabel(filePath, kind, index) {
  const base = path.basename(String(filePath || ''), path.extname(String(filePath || ''))).trim();
  if (base) return base;
  if (kind === 'audio') return `音频${index}`;
  if (kind === 'video') return `视频${index}`;
  return `图片${index}`;
}

function groupedMentions(mentions = []) {
  const out = { image: [], video: [], audio: [] };
  for (const mention of mentions || []) {
    const kind = String(mention?.kind || mention?.type || 'image').trim().toLowerCase();
    if (kind === 'audio') out.audio.push(mention);
    else if (kind === 'video') out.video.push(mention);
    else out.image.push(mention);
  }
  return out;
}

export function buildLibtvNodeReferencePrompt(prompt, references = []) {
  const lines = [];
  for (const reference of references || []) {
    const nodeName = String(reference?.nodeName || '').trim();
    if (!nodeName) continue;
    const placeholder = `{{Node "${nodeName.replace(/"/g, '')}"}}`;
    const instruction = oneLine(reference?.referenceInstruction);
    const phrase = oneLine(reference?.phrase);
    const label = oneLine(reference?.label || reference?.displayName || reference?.name);
    const kind = String(reference?.kind || 'image').trim().toLowerCase();
    if (instruction) lines.push(`${placeholder} 是${instruction}`);
    else if (phrase) lines.push(`${placeholder} ${phrase}`);
    else if (kind === 'audio') lines.push(`${placeholder} 是${label || '该人物'}的配音/音色参考`);
    else if (kind === 'video') lines.push(`${placeholder} 是${label || '该镜头'}视频参考`);
    else {
      const imageLabel = label || '该人物';
      lines.push(`${placeholder} 是${/参考图$/u.test(imageLabel) ? imageLabel : `${imageLabel}参考图`}`);
    }
  }
  if (!lines.length) return String(prompt || '').trim();
  lines.push('请同时参考以上画布节点，保持人物形象、人物音色、场景、道具和画面连续性。');
  return `${lines.join('；')}\n\n${String(prompt || '').trim()}`.trim();
}

function addSet(args, key, value) {
  if (value === undefined || value === null || String(value).trim() === '') return;
  args.push('--set', `${key}=${value}`);
}

export function buildLibtvWatermarkFreeDownloadArgs({ projectUuid, nodeName, outputDir } = {}) {
  return [
    'download',
    '--project', String(projectUuid || '').trim(),
    '--node', String(nodeName || '').trim(),
    '--out', String(outputDir || '').trim(),
    '--without-ai-watermark',
    '--vip',
  ];
}

export async function fetchVideoResult({ projectUuid, nodeName, onProgress } = {}) {
  const targetProject = String(projectUuid || '').trim();
  const targetNode = String(nodeName || '').trim();
  if (!targetProject) throw new LibtvError('LibTV 待抓取任务缺少画布 UUID', 'PROJECT_REQUIRED');
  if (!targetNode) throw new LibtvError('LibTV 待抓取任务缺少视频节点名', 'RESULT_MISSING');

  const status = await getCliStatus({ checkUpdate: false });
  if (!status.installed) throw new LibtvError(status.error || '未检测到 LibTV CLI', 'CLI_NOT_FOUND');
  if (!status.authenticated) throw new LibtvError(status.authError || 'LibTV CLI 未登录', 'AUTH_EXPIRED');

  const outputDir = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'hepai_libtv_refetch_'));
  const progress = (message) => { try { onProgress?.(message); } catch { /* ignore observer errors */ } };
  try {
    let nodeJson = null;
    try {
      const queried = await runLibtv(['node', targetNode, '--project', targetProject], {
        commandName: 'libtv node',
        timeoutMs: STATUS_TIMEOUT_MS * 2,
        onProgress: progress,
      });
      nodeJson = parseLibtvJson(queried.stdout, 'libtv node');
    } catch { /* the download command can still recover the node */ }

    const videoUrls = candidateVideoUrls(nodeJson, { includeGenericUrl: true });
    let downloadError = null;
    try {
      progress('正在重新下载 LibTV 视频...');
      await runLibtv(buildLibtvWatermarkFreeDownloadArgs({ projectUuid: targetProject, nodeName: targetNode, outputDir }), {
        commandName: 'libtv download --without-ai-watermark --vip',
        timeoutMs: GENERATE_TIMEOUT_MS,
        onProgress: progress,
      });
    } catch (error) {
      downloadError = error;
    }
    const videoPaths = downloadedVideos(outputDir);
    if (!videoPaths.length && !videoUrls.length) {
      throw downloadError || new LibtvError('LibTV 节点里还没有可下载的视频文件', 'RESULT_MISSING');
    }
    return {
      ok: true,
      submitId: targetNode,
      historyId: targetNode,
      remoteProjectId: targetProject,
      videoPath: videoPaths[0] || '',
      videoPaths,
      videoUrl: videoUrls[0] || '',
      videoUrls,
      cleanupDir: outputDir,
    };
  } catch (error) {
    await fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function recursiveFiles(directory, out = []) {
  if (!fs.existsSync(directory)) return out;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) recursiveFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function downloadedVideos(directory) {
  const allowed = new Set(['.mp4', '.mov', '.webm', '.m4v']);
  const files = recursiveFiles(directory).filter((file) => allowed.has(path.extname(file).toLowerCase()));
  return files.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function libtvNodeName(node = {}) {
  return String(node.name || node.label || node.title || node.data?.name || node.data?.label || '').trim();
}

function libtvNodeTimestamp(node = {}, nodeName = '') {
  for (const value of [node.createdAt, node.createTime, node.updatedAt, node.updateTime, node.data?.createdAt, node.data?.updatedAt]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number < 1e12 ? number * 1000 : number;
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  for (const token of String(nodeName || '').split('-')) {
    if (!/^[0-9a-z]{8,10}$/i.test(token)) continue;
    const parsed = Number.parseInt(token, 36);
    if (Number.isFinite(parsed) && parsed > 1_500_000_000_000) return parsed;
  }
  return 0;
}

export function selectLatestLibtvVideoNode(value = {}, { episodeId, shotNo } = {}) {
  const nodes = Array.isArray(value)
    ? value
    : (Array.isArray(value?.nodes) ? value.nodes : (Array.isArray(value?.data?.nodes) ? value.data.nodes : []));
  const shotPart = safeNodePart(shotNo, String(shotNo || ''));
  if (!shotPart) return null;
  const episodePart = episodeId == null ? '' : safeNodePart(episodeId, String(episodeId));
  const episodeMarker = episodePart ? `-第${episodePart}集-` : '';
  const matches = nodes.map((node, index) => {
    const nodeName = libtvNodeName(node);
    const type = String(node.type || node.nodeType || node.data?.type || '').trim().toLowerCase();
    if (type && type !== 'video') return null;
    if (!nodeName.startsWith('Freedom-') || !nodeName.endsWith(`-${shotPart}-视频`)) return null;
    return {
      nodeName,
      nodeKey: String(node.nodeKey || node.id || node.key || '').trim(),
      exactEpisode: !episodeMarker || nodeName.includes(episodeMarker),
      timestamp: libtvNodeTimestamp(node, nodeName),
      index,
    };
  }).filter(Boolean);
  if (!matches.length) return null;
  const exact = matches.filter((item) => item.exactEpisode);
  return (exact.length ? exact : matches)
    .sort((left, right) => right.timestamp - left.timestamp || right.index - left.index)[0];
}

export async function findLatestLibtvVideoNode({ projectUuid, episodeId, shotNo } = {}) {
  const targetProject = String(projectUuid || '').trim();
  if (!targetProject) throw new LibtvError('请先在视频设置中填写 LibTV 画布 UUID', 'PROJECT_REQUIRED');
  const { stdout } = await runLibtv(['node', 'list', '--project', targetProject], {
    commandName: 'libtv node list',
    timeoutMs: STATUS_TIMEOUT_MS * 2,
  });
  return selectLatestLibtvVideoNode(parseLibtvJson(stdout, 'libtv node list'), { episodeId, shotNo });
}

function downloadedImage(directory) {
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
  const files = recursiveFiles(directory).filter((file) => allowed.has(path.extname(file).toLowerCase()));
  return files.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || '';
}

function schemaEnumValues(property = {}) {
  const source = Array.isArray(property?.enum) ? property.enum : [];
  return source.map((item) => String(item && typeof item === 'object' ? item.value : item).trim()).filter(Boolean);
}

function schemaEnumOptions(property = {}) {
  const source = Array.isArray(property?.enum) ? property.enum : [];
  return source.map((item) => {
    const value = String(item && typeof item === 'object' ? item.value : item).trim();
    if (!value) return null;
    return {
      value,
      label: String(item && typeof item === 'object' ? item.displayName || item.label || value : value).trim() || value,
    };
  }).filter(Boolean);
}

export async function getImageModelCapabilities(modelName) {
  const model = String(modelName || '').trim();
  if (!model) throw new LibtvError('未指定 LibTV 图片模型', 'MODEL_INVALID');
  const schema = await modelSchema(model);
  const properties = schema?.properties || {};
  const directResolution = properties.resolution;
  const qualityOptions = schemaEnumOptions(properties.quality);
  const qualityCarriesResolution = !directResolution
    && qualityOptions.length
    && qualityOptions.every((item) => /^\d+k$/i.test(item.value));
  const resolutionProperty = directResolution || (qualityCarriesResolution ? properties.quality : null);
  const resolutions = schemaEnumOptions(resolutionProperty);
  return {
    model,
    maxReferenceImages: imageReferenceLimit(schema),
    resolutions,
    defaultResolution: String(resolutionProperty?.default || '').trim(),
    resolutionField: directResolution ? 'resolution' : qualityCarriesResolution ? 'quality' : '',
    qualities: qualityCarriesResolution ? [] : qualityOptions,
    defaultQuality: qualityCarriesResolution ? '' : String(properties.quality?.default || '').trim(),
  };
}

function schemaSettingValue(property = {}, preferred = []) {
  const allowed = schemaEnumValues(property);
  for (const value of preferred) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    if (!allowed.length) return clean;
    const canonical = allowed.find((item) => item.toLowerCase() === clean.toLowerCase());
    if (canonical) return canonical;
  }
  const fallback = String(property?.default || '').trim();
  if (fallback) {
    if (!allowed.length) return fallback;
    const canonical = allowed.find((item) => item.toLowerCase() === fallback.toLowerCase());
    if (canonical) return canonical;
  }
  return allowed[0] || '';
}

function schemaNumberValue(property = {}, preferred, fallback = 5) {
  const minimum = Number(property?.min);
  const maximum = Number(property?.max);
  const defaultValue = Number(property?.default);
  const requested = preferred === undefined || preferred === null || preferred === ''
    ? Number.NaN
    : Number(preferred);
  let value = Number.isFinite(requested)
    ? requested
    : (Number.isFinite(defaultValue) ? defaultValue : fallback);
  if (Number.isFinite(minimum)) value = Math.max(minimum, value);
  if (Number.isFinite(maximum)) value = Math.min(maximum, value);
  return Math.round(value);
}

function videoReferenceLimits(schema = {}) {
  const config = schema?.properties?.modeType?.mixed2videoConfig || {};
  const limit = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : Number.POSITIVE_INFINITY;
  };
  return {
    image: limit(config.imageMax),
    video: limit(config.videoMax),
    audio: limit(config.audioMax),
  };
}

function imageReferenceLimit(schema = {}, fallback = 10) {
  const modes = schema?.properties?.modeType?.items;
  if (!modes || typeof modes !== 'object') return fallback;
  const limits = Object.values(modes)
    .filter((item) => Array.isArray(item) && Number.isFinite(Number(item[1])))
    .map((item) => Number(item[1]));
  return limits.length ? Math.max(0, Math.min(fallback, Math.max(...limits))) : fallback;
}

export function buildLibtvImageNodeArgs({
  nodeName,
  projectUuid,
  prompt,
  modelName = 'Lib Image',
  schema = {},
  ratio,
  config = {},
  leftNodes = [],
} = {}) {
  const properties = schema?.properties || {};
  const args = [
    'node', 'create', String(nodeName || '').trim(),
    '--project', String(projectUuid || '').trim(),
    '--type', 'image',
    '--prompt', String(prompt || '').trim(),
  ];
  addSet(args, 'model', modelName);
  if (properties.count) addSet(args, 'count', 1);
  if (properties.modeType && leftNodes.length) {
    addSet(args, 'modeType', availableModeTypes(schema)[0] || 'image2image');
  }
  if (properties.ratio) addSet(args, 'ratio', schemaSettingValue(properties.ratio, [ratio, config.ratio]));
  if (properties.quality) {
    addSet(args, 'quality', schemaSettingValue(properties.quality, [config.libtvQuality, config.libtvResolution]));
  }
  if (properties.resolution) {
    addSet(args, 'resolution', schemaSettingValue(properties.resolution, [config.libtvResolution]));
  }
  for (const leftNode of leftNodes) args.push('--left', leftNode);
  args.push('--run');
  return args;
}

export function normalizeLibtvConcurrency(value, fallback = 3) {
  const fallbackNumber = Number(fallback);
  const normalizedFallback = Number.isFinite(fallbackNumber)
    ? Math.max(1, Math.min(10, Math.trunc(fallbackNumber)))
    : 3;
  if (value === undefined || value === null || value === '') return normalizedFallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return normalizedFallback;
  return Math.max(1, Math.min(10, Math.trunc(parsed)));
}

function drainLibtvProjectSlots(key, state) {
  while (state.active < state.limit && state.waiters.length) {
    state.active += 1;
    state.waiters.shift()();
  }
  if (state.active === 0 && state.waiters.length === 0 && projectConcurrencyStates.get(key) === state) {
    projectConcurrencyStates.delete(key);
  }
}

export async function runWithLibtvProjectSlot(projectUuid, concurrency, operation) {
  const key = String(projectUuid || '').trim();
  let state = projectConcurrencyStates.get(key);
  if (!state) {
    state = { active: 0, limit: normalizeLibtvConcurrency(concurrency), waiters: [] };
    projectConcurrencyStates.set(key, state);
  } else {
    state.limit = normalizeLibtvConcurrency(concurrency, state.limit);
  }

  await new Promise((resolve) => {
    state.waiters.push(resolve);
    drainLibtvProjectSlots(key, state);
  });
  try {
    return await operation();
  } finally {
    state.active = Math.max(0, state.active - 1);
    drainLibtvProjectSlots(key, state);
  }
}

export async function runLibtvConcurrentPool(items, worker, {
  concurrency = 3,
  shouldStop = () => false,
} = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const results = new Array(list.length);
  const limit = Math.min(normalizeLibtvConcurrency(concurrency), list.length);
  let nextIndex = 0;
  let stopped = false;

  const runWorker = async (workerIndex) => {
    while (!stopped) {
      const index = nextIndex;
      if (index >= list.length) return;
      nextIndex += 1;
      const result = await worker(list[index], index, workerIndex);
      results[index] = result;
      if (shouldStop(result, index)) stopped = true;
    }
  };

  await Promise.all(Array.from({ length: limit }, (_, workerIndex) => runWorker(workerIndex)));
  return results.filter((result) => result !== undefined);
}

export function libtvSlotProgress(message, previous = 0) {
  const text = String(message || '');
  const matched = text.match(/progress=(\d+(?:\.\d+)?)%/i);
  let progress = Math.max(0, Math.min(99, Number(previous) || 0));
  let note = '正在处理';
  if (/上传/.test(text)) {
    progress = Math.max(progress, 6);
    note = '正在上传参考素材';
  }
  if (/生成视频|正在生成|\[run\]/i.test(text)) {
    progress = Math.max(progress, 12);
    note = '正在生成视频';
  }
  if (matched) progress = Math.max(progress, Math.min(92, Math.round(Number(matched[1]))));
  if (/下载/.test(text)) {
    progress = Math.max(progress, 95);
    note = '正在下载无水印视频';
  }
  return { progress, note };
}

export async function generateImage({
  config = {},
  projectUuid,
  prompt,
  referencePaths = [],
  model,
  ratio,
  resolution,
  quality,
  concurrency,
  onProgress,
} = {}) {
  const targetProject = String(projectUuid || config.libtvProjectUuid || '').trim();
  if (!targetProject) throw new LibtvError('请先在图片设置中填写 LibTV 画布 UUID', 'PROJECT_REQUIRED');
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new LibtvError('图片提示词不能为空', 'PROMPT_REQUIRED');

  const status = await getCliStatus({ checkUpdate: false });
  if (!status.installed) throw new LibtvError(status.error || '未检测到 LibTV CLI', 'CLI_NOT_FOUND');
  if (!status.authenticated) throw new LibtvError(status.authError || 'LibTV CLI 未登录', 'AUTH_EXPIRED');

  return runWithLibtvProjectSlot(targetProject, concurrency ?? config.concurrency ?? 3, async () => {
    const outputDir = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'hepai_libtv_image_'));
    const progress = (message) => { try { onProgress?.(message); } catch { /* ignore observer errors */ } };
    try {
      const modelName = String(model || config.libtvModel || 'Lib Image').trim() || 'Lib Image';
      const schema = await modelSchema(modelName);
      const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const prefix = `Freedom-图片-${runId}`;
      const leftNodes = [];
      const references = [];
      const paths = (Array.isArray(referencePaths) ? referencePaths : [referencePaths])
        .map((item) => String(item || '').trim())
        .filter((item) => item && fs.existsSync(item))
        .slice(0, imageReferenceLimit(schema));

      for (let index = 0; index < paths.length; index += 1) {
        const filePath = paths[index];
        const label = mediaLabel(filePath, 'image', index + 1);
        const nodeName = `${prefix}-参考图${index + 1}-${safeNodePart(label, 'image')}`.slice(0, 100);
        progress(`正在上传参考图 ${index + 1}/${paths.length}...`);
        await runLibtv(['upload', nodeName, '--project', targetProject, '--type', 'image', '--resource', filePath], {
          commandName: 'libtv upload',
          timeoutMs: GENERATE_TIMEOUT_MS,
          onProgress: progress,
        });
        leftNodes.push(nodeName);
        references.push({ nodeName, kind: 'image', label });
      }

      const imageNodeName = `${prefix}-生成图`.slice(0, 100);
      const finalPrompt = buildLibtvNodeReferencePrompt(cleanPrompt, references);
      const args = buildLibtvImageNodeArgs({
        nodeName: imageNodeName,
        projectUuid: targetProject,
        prompt: finalPrompt,
        modelName,
        schema,
        ratio,
        config: {
          ...config,
          libtvResolution: String(resolution || config.libtvResolution || '').trim(),
          libtvQuality: String(quality || config.libtvQuality || '').trim(),
        },
        leftNodes,
      });

      progress('正在生成图片...');
      await runLibtv(args, {
        commandName: 'libtv node create --run',
        timeoutMs: GENERATE_TIMEOUT_MS,
        onProgress: progress,
      });

      progress('正在下载生成图片...');
      await runLibtv(buildLibtvWatermarkFreeDownloadArgs({ projectUuid: targetProject, nodeName: imageNodeName, outputDir }), {
        commandName: 'libtv download --without-ai-watermark --vip',
        timeoutMs: GENERATE_TIMEOUT_MS,
        onProgress: progress,
      });
      const imagePath = downloadedImage(outputDir);
      if (!imagePath) throw new LibtvError('LibTV 已完成生成，但没有下载到图片文件', 'RESULT_MISSING');
      const b64 = await fs.promises.readFile(imagePath, { encoding: 'base64' });
      return { b64, model: modelName, nodeName: imageNodeName, provider: 'libtv-cli' };
    } finally {
      await fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function submitOneVideo({ shot, projectUuid, episodeId, defaultModel, onProgress, runId, index }) {
  const outputDir = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'hepai_libtv_result_'));
  let videoNodeName = '';
  let runJson = null;
  let generationCompleted = false;
  try {
    const progress = (message) => {
      try { onProgress?.(`[LibTV 镜头 ${shot.shotNo}] ${message}`); } catch { /* ignore observer errors */ }
    };
    const modelName = normalizeLibtvVideoModelName(shot.model || defaultModel);
    const schema = await videoModelSchema(modelName);
    const properties = schema?.properties || {};
    const propertyNames = new Set(Object.keys(properties));
    const referenceLimits = videoReferenceLimits(schema);
    const mentions = groupedMentions(shot.mentions);
    const references = [];
    const leftNodes = [];
    const episodePrefix = episodeId == null ? '' : `第${safeNodePart(episodeId, String(episodeId))}集-`;
    const prefix = `Freedom-${episodePrefix}${runId}-${String(index + 1).padStart(3, '0')}-${safeNodePart(shot.shotNo, String(index + 1))}`;

    const uploadKind = async (files, kind, mentionList) => {
      for (let mediaIndex = 0; mediaIndex < files.length; mediaIndex += 1) {
        const filePath = String(files[mediaIndex] || '').trim();
        if (!filePath || !fs.existsSync(filePath)) continue;
        const mention = mentionList[mediaIndex] || {};
        const label = String(mention.displayName || mention.label || mention.fallbackText || mention.name || mediaLabel(filePath, kind, mediaIndex + 1)).trim();
        const nodeName = `${prefix}-${kind}${mediaIndex + 1}-${safeNodePart(label, kind)}`.slice(0, 100);
        progress(`正在上传${kind === 'image' ? '参考图' : kind === 'audio' ? '参考音频' : '参考视频'} ${mediaIndex + 1}/${files.length}...`);
        await runLibtv(['upload', nodeName, '--project', projectUuid, '--type', kind, '--resource', filePath], {
          commandName: 'libtv upload',
          timeoutMs: GENERATE_TIMEOUT_MS,
          onProgress: progress,
        });
        leftNodes.push(nodeName);
        references.push({
          nodeName,
          kind,
          label,
          phrase: mention.phrase,
          referenceInstruction: mention.referenceInstruction,
        });
      }
    };

    await uploadKind((Array.isArray(shot.refImagePaths) ? shot.refImagePaths : []).slice(0, referenceLimits.image), 'image', mentions.image);
    await uploadKind((Array.isArray(shot.refVideoPaths) ? shot.refVideoPaths : []).slice(0, referenceLimits.video), 'video', mentions.video);
    await uploadKind((Array.isArray(shot.refAudioPaths) ? shot.refAudioPaths : []).slice(0, referenceLimits.audio), 'audio', mentions.audio);

    const modeType = chooseLibtvVideoMode({
      imageCount: references.filter((item) => item.kind === 'image').length,
      videoCount: references.filter((item) => item.kind === 'video').length,
      audioCount: references.filter((item) => item.kind === 'audio').length,
    }, availableModeTypes(schema));
    videoNodeName = `${prefix}-视频`.slice(0, 100);
    const prompt = buildLibtvNodeReferencePrompt(shot.prompt, references);
    const args = ['node', 'create', videoNodeName, '--project', projectUuid, '--type', 'video', '--prompt', prompt];
    addSet(args, 'model', modelName);
    if (propertyNames.has('modeType')) addSet(args, 'modeType', modeType);
    if (propertyNames.has('count')) addSet(args, 'count', 1);
    if (propertyNames.has('ratio')) addSet(args, 'ratio', shot.aspectRatio || '16:9');
    if (propertyNames.has('resolution')) {
      addSet(args, 'resolution', schemaSettingValue(properties.resolution, [shot.resolution]));
    }
    if (propertyNames.has('duration')) addSet(args, 'duration', schemaNumberValue(properties.duration, shot.duration));
    if (propertyNames.has('enableSound')) {
      addSet(args, 'enableSound', schemaSettingValue(properties.enableSound, ['on']));
    }
    for (const nodeName of leftNodes) args.push('--left', nodeName);
    args.push('--run');

    progress('正在生成视频...');
    const runResult = await runLibtv(args, {
      commandName: 'libtv node create --run',
      timeoutMs: GENERATE_TIMEOUT_MS,
      onProgress: progress,
    });
    generationCompleted = true;
    try { runJson = parseLibtvJson(runResult.stdout, 'libtv node --run'); } catch { /* download remains authoritative */ }

    progress('正在下载无水印视频...');
    const videoUrls = candidateVideoUrls(runJson, { includeGenericUrl: true });
    try {
      await runLibtv(buildLibtvWatermarkFreeDownloadArgs({ projectUuid, nodeName: videoNodeName, outputDir }), {
        commandName: 'libtv download --without-ai-watermark --vip',
        timeoutMs: GENERATE_TIMEOUT_MS,
        onProgress: progress,
      });
    } catch (error) {
      if (!videoUrls.length) throw error;
      progress('LibTV CLI 下载失败，正在改用生成结果直链...');
    }
    const videoPaths = downloadedVideos(outputDir);
    if (!videoPaths.length && !videoUrls.length) throw new LibtvError('LibTV 已完成生成，但没有下载到视频文件', 'RESULT_MISSING');
    return {
      ok: true,
      shotNo: shot.shotNo,
      submitId: videoNodeName,
      historyId: videoNodeName,
      remoteProjectId: projectUuid,
      videoPath: videoPaths[0] || '',
      videoPaths,
      videoUrl: videoUrls[0] || '',
      videoUrls,
      model: modelName,
      modeType,
      cleanupDir: outputDir,
    };
  } catch (error) {
    await fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    if (generationCompleted && videoNodeName) {
      const normalized = normalizeCliError(error, 'LibTV 视频下载');
      const videoUrls = candidateVideoUrls(runJson, { includeGenericUrl: true });
      return {
        ok: false,
        recoverable: true,
        shotNo: shot.shotNo,
        submitId: videoNodeName,
        historyId: videoNodeName,
        remoteProjectId: projectUuid,
        videoUrl: videoUrls[0] || '',
        videoUrls,
        model: normalizeLibtvVideoModelName(shot.model || defaultModel),
        error: normalized.message,
        code: normalized.code,
      };
    }
    throw error;
  }
}

export async function submitVideos({
  shots = [],
  config = {},
  projectUuid,
  episodeId,
  model,
  concurrency,
  onProgress,
  onSubmitProgress,
} = {}) {
  const targetProject = String(projectUuid || config.libtvProjectUuid || '').trim();
  if (!targetProject) throw new LibtvError('请先在视频设置中填写 LibTV 画布 UUID', 'PROJECT_REQUIRED');
  const status = await getCliStatus({ checkUpdate: false });
  if (!status.installed) throw new LibtvError(status.error || '未检测到 LibTV CLI', 'CLI_NOT_FOUND');
  if (!status.authenticated) throw new LibtvError(status.authError || 'LibTV CLI 未登录', 'AUTH_EXPIRED');

  const limit = normalizeLibtvConcurrency(concurrency ?? config.libtvConcurrency);
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const defaultModel = normalizeLibtvVideoModelName(model || config.libtvModel || DEFAULT_LIBTV_VIDEO_MODEL);
  const slots = Array.from({ length: Math.min(limit, shots.length) }, (_, index) => ({
    accountId: `libtv-slot-${index + 1}`,
    accountName: `LibTV ${index + 1}`,
    model: defaultModel,
    modelLabel: defaultModel,
    state: 'idle',
    enabled: true,
    currentShot: null,
    progress: 0,
    note: '',
    error: '',
  }));
  let processed = 0;
  let submitted = 0;
  let failed = 0;
  let active = 0;
  const report = (message) => {
    try {
      onSubmitProgress?.({
        total: shots.length,
        processed,
        submitted,
        failed,
        active,
        concurrency: limit,
        message,
        slots: slots.map((slot) => ({
          ...slot,
          currentShot: slot.currentShot ? { ...slot.currentShot } : null,
        })),
      });
    } catch { /* ignore observer errors */ }
  };

  report(`开始并发处理 LibTV 视频，当前并发 ${limit}`);
  const results = await runLibtvConcurrentPool(shots, (shot, index, workerIndex) => {
    const slot = slots[workerIndex];
    slot.state = 'waiting';
    slot.currentShot = { shotNo: shot.shotNo };
    slot.progress = 2;
    slot.note = '等待并发空位';
    slot.error = '';
    report(`LibTV 镜头 ${shot.shotNo} 正在等待并发空位`);
    return runWithLibtvProjectSlot(targetProject, limit, async () => {
      active += 1;
      slot.state = 'submitting';
      slot.progress = Math.max(slot.progress, 4);
      slot.note = '准备生成';
      report(`正在处理 LibTV 镜头 ${shot.shotNo}，运行中 ${active}/${limit}`);
      let result;
      try {
        result = await submitOneVideo({
          shot,
          projectUuid: targetProject,
          episodeId,
          defaultModel,
          onProgress: (message) => {
            const progress = libtvSlotProgress(message, slot.progress);
            slot.progress = progress.progress;
            slot.note = progress.note;
            try { onProgress?.(message); } catch { /* ignore observer errors */ }
            report(message);
          },
          runId,
          index,
        });
      } catch (error) {
        const normalized = normalizeCliError(error, 'LibTV 视频生成');
        result = { shotNo: shot.shotNo, ok: false, error: normalized.message, code: normalized.code };
      }
      active -= 1;
      processed += 1;
      if (result.ok) {
        submitted += 1;
        slot.state = 'done';
        slot.progress = 100;
        slot.note = '处理完成';
      } else {
        failed += 1;
        slot.state = 'failed';
        slot.note = '处理失败';
        slot.error = result.error || '';
      }
      report(`LibTV 镜头 ${shot.shotNo} ${result.ok ? '处理完成' : '处理失败'}，运行中 ${active}/${limit}`);
      return result;
    });
  }, {
    concurrency: limit,
    shouldStop: (result) => ['AUTH_EXPIRED', 'CLI_NOT_FOUND', 'PROJECT_INVALID'].includes(result?.code),
  });
  report('LibTV 视频处理完成');
  return results;
}
