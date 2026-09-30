import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

import { chatComplete } from '../apiClient.js';
import { saveRequestBodyToFile } from '../http.js';
import { extractJsonObject } from '../jsonParse.js';
import { DATA_DIR, ffmpegPath, loadConfig, saveConfig } from '../config.js';
import { readJsonFile, writeJsonAtomic } from '../lib/atomicJson.js';
import { streamRangeFile } from '../mediaServer.js';
import { characterVoiceReadDiskPath, imageDiskPath } from '../storage.js';
import { getJob, listJobs, setJob } from '../jobs.js';
import { hasTextModelKey, resolveTextModelConfig } from '../modelRouting.js';
import { normalizeVideoProvider } from '../videoProviders.js';
import { saveVideoUrlToFile } from '../videoFunctions.js';
import { resolveVideoApiChannel } from '../channelProfiles.js';
import {
  generateConfiguredImage,
  imageProviderConfigError,
  imageProviderLabel,
  normalizeImageProvider,
} from '../imageProviders.js';
import {
  dreaminaVideoCapabilities,
  submitVideos as submitDreaminaVideos,
  fetchVideoResults as fetchDreaminaVideoResults,
} from '../dreaminaClient.js';
import {
  submitVideos as submitLibtvVideos,
} from '../libtvClient.js';
import {
  submitVideos as submitVideoApiVideos,
  fetchVideoResults as fetchVideoApiResults,
} from '../videoApiClient.js';
import {
  submitVideos as submitXiaoyunqueVideos,
  fetchVideoResults as fetchXiaoyunqueVideoResults,
} from '../xiaoyunqueClient.js';
import {
  submitVideos as submitUpdreamVideos,
  fetchVideoResults as fetchUpdreamVideoResults,
} from '../updreamClient.js';
import {
  acquireAccount as acquireXiaoyunqueAccount,
  releaseAccount as releaseXiaoyunqueAccount,
} from '../xiaoyunqueAccounts.js';

const CANVAS_MEDIA_ROOT = path.join(DATA_DIR, '.canvas-media');
const CANVAS_PROJECTS_FILE = path.join(DATA_DIR, '.canvas', 'projects.json');
const MAX_CANVAS_PROJECTS = 500;
const MAX_CANVAS_NODES = 5000;
const POLL_GUARD = new Set();
let canvasPollTimer = null;
const execFileAsync = promisify(execFile);

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

function normalizeStoredCanvasProjects(value) {
  const source = Array.isArray(value) ? value : Array.isArray(value?.projects) ? value.projects : [];
  return source.slice(0, MAX_CANVAS_PROJECTS).map((project) => ({
    ...project,
    id: String(project?.id || ''),
    name: String(project?.name || '').slice(0, 120),
    description: String(project?.description || '').slice(0, 1000),
    nodes: Array.isArray(project?.nodes) ? project.nodes.slice(0, MAX_CANVAS_NODES) : [],
    edges: Array.isArray(project?.edges) ? project.edges.slice(0, MAX_CANVAS_NODES * 4) : [],
  })).filter((project) => project.id);
}

function canvasProjectStats(project) {
  const files = new Set();
  let mediaCount = 0;
  let storageBytes = 0;
  for (const node of Array.isArray(project?.nodes) ? project.nodes : []) {
    const kind = ['image', 'video', 'audio'].includes(node?.type) ? node.type : '';
    const mediaUrl = String(node?.mediaUrl || '').trim();
    if (!kind || !mediaUrl) continue;
    const file = resolveCanvasReferencePath(mediaUrl, kind);
    if (!file || files.has(file)) continue;
    files.add(file);
    mediaCount += 1;
    try {
      storageBytes += fs.statSync(file).size;
    } catch { /* A stale media URL should not make the project list fail. */ }
  }
  return { mediaCount, storageBytes };
}

function readCanvasProjects() {
  return normalizeStoredCanvasProjects(readJsonFile(CANVAS_PROJECTS_FILE, []))
    .map((project) => ({ ...project, ...canvasProjectStats(project) }));
}

function writeCanvasProjects(projects) {
  const normalized = normalizeStoredCanvasProjects(projects);
  writeJsonAtomic(CANVAS_PROJECTS_FILE, normalized);
  return normalized;
}

function safeSegment(value, fallback = 'item') {
  const clean = String(value || '').trim().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(0, 100);
  return clean || fallback;
}

function canvasMediaPath(canvasId, nodeId, extension) {
  return path.join(CANVAS_MEDIA_ROOT, safeSegment(canvasId, 'canvas'), `${safeSegment(nodeId, 'node')}.${extension}`);
}

function canvasMediaUrl(canvasId, nodeId, extension) {
  return `/api/canvas/media/${encodeURIComponent(safeSegment(canvasId, 'canvas'))}/${encodeURIComponent(`${safeSegment(nodeId, 'node')}.${extension}`)}?v=${Date.now()}`;
}

function safeDownloadFilename(value, fallback = 'canvas-media') {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  return clean || fallback;
}

function canvasDownloadHeaders(file, requestedName = '', extensionOverride = '') {
  const physicalExtension = path.extname(file).toLowerCase();
  const extension = String(extensionOverride || physicalExtension).toLowerCase() || '.bin';
  const fallbackBase = path.basename(file, physicalExtension);
  const fallback = `${safeDownloadFilename(fallbackBase)}${extension}`;
  const base = safeDownloadFilename(requestedName, fallbackBase);
  const filename = base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
  return {
    'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}

function openCanvasMediaFolder(canvasId, { open = true } = {}) {
  const directory = path.join(CANVAS_MEDIA_ROOT, safeSegment(canvasId, 'canvas'));
  fs.mkdirSync(directory, { recursive: true });
  if (!open) return directory;
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [directory], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [directory], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn('xdg-open', [directory], { detached: true, stdio: 'ignore' });
    child.unref();
  }
  return directory;
}

function detectImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buffer.subarray(4, 12).toString('ascii').includes('ftypavif')) return 'avif';
  return '';
}

function decodeCanvasImage(base64Value) {
  const raw = String(base64Value || '').trim();
  if (!raw) throw new Error('\u56fe\u7247\u6a21\u578b\u672a\u8fd4\u56de\u53ef\u7528\u6570\u636e');
  const match = raw.match(/^data:image\/([a-z0-9.+-]+);base64,(.*)$/is);
  const payload = String(match ? match[2] : raw).replace(/\s+/g, '');
  const bytes = Buffer.from(payload, 'base64');
  const extension = detectImageExtension(bytes);
  if (!extension) throw new Error('\u56fe\u7247\u6a21\u578b\u8fd4\u56de\u4e86\u65e0\u6cd5\u8bc6\u522b\u7684\u56fe\u7247\u6570\u636e');
  return { bytes, extension };
}

function repairLegacyCanvasImage(data) {
  if (!Buffer.isBuffer(data) || detectImageExtension(data)) return data;
  const encoded = data.toString('base64');
  const prefixes = ['dataimage/pngbase64', 'dataimage/jpegbase64', 'dataimage/jpgbase64', 'dataimage/webpbase64', 'dataimage/gifbase64'];
  const prefix = prefixes.find((item) => encoded.startsWith(item));
  if (!prefix) return data;
  const repaired = Buffer.from(encoded.slice(prefix.length), 'base64');
  return detectImageExtension(repaired) ? repaired : data;
}


function canvasUploadExtension(filename, contentType, kind) {
  const raw = path.extname(String(filename || '')).toLowerCase().replace('.', '');
  const imageAllowed = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
  const videoAllowed = new Set(['mp4', 'webm', 'mov', 'm4v']);
  const audioAllowed = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'weba']);
  if (kind === 'image') {
    if (imageAllowed.has(raw)) return raw === 'jpeg' ? 'jpg' : raw;
    if (/png/i.test(contentType)) return 'png';
    if (/jpe?g/i.test(contentType)) return 'jpg';
    if (/webp/i.test(contentType)) return 'webp';
    throw new Error('不支持的图片格式');
  }
  if (kind === 'video') {
    if (videoAllowed.has(raw)) return raw;
    if (/mp4/i.test(contentType)) return 'mp4';
    if (/webm/i.test(contentType)) return 'webm';
    if (/quicktime/i.test(contentType)) return 'mov';
    throw new Error('不支持的视频格式');
  }
  if (raw === 'webm' || /webm/i.test(contentType)) return 'weba';
  if (audioAllowed.has(raw)) return raw;
  if (/mpeg|mp3/i.test(contentType)) return 'mp3';
  if (/wav/i.test(contentType)) return 'wav';
  if (/mp4|m4a/i.test(contentType)) return 'm4a';
  if (/ogg/i.test(contentType)) return 'ogg';
  if (/webm/i.test(contentType)) return 'webm';
  throw new Error('不支持的音频格式');
}

async function saveCanvasUpload(req, file, maxBytes) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const staged = `${file}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.upload`;
  try {
    const result = await saveRequestBodyToFile(req, staged, maxBytes);
    if (!result?.size) throw new Error('上传的媒体文件为空');
    await fs.promises.copyFile(staged, file);
    return result.size;
  } finally {
    await fs.promises.rm(staged, { force: true }).catch(() => {});
  }
}

async function planCanvasAgent(body) {
  const instruction = String(body.instruction || '').trim();
  if (!instruction) throw new Error('请输入要让Freedom Agent 执行的任务');
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'agent')) throw new Error('请先在设置中配置文本模型 API Key');
  const state = body.state && typeof body.state === 'object' ? body.state : {};
  const system = `你是Freedom创作画布的专属 Agent。你可以读取并操控当前画布，但只能输出严格 JSON，不要 Markdown。
输出格式：{"reply":"给用户的简短说明","actions":[...]}
可用动作：
1. {"type":"add_node","ref":"临时引用名","nodeType":"note|infer|image|video|audio|section","title":"标题","content":"内容","x":数字可选,"y":数字可选}
2. {"type":"connect","from":"节点ID/标题/临时引用名","to":"节点ID/标题/临时引用名"}
3. {"type":"update_node","target":"节点ID/标题/临时引用名","title":"可选","content":"可选","settings":{"ratio":"16:9","duration":5}}
4. {"type":"delete_node","target":"节点ID或标题"}
5. {"type":"run_node","target":"节点ID/标题/临时引用名"}
6. {"type":"arrange","mode":"flow|grid"}
7. {"type":"fit_view"}
规则：
- 需要创建完整工作流时，先 add_node，再用 ref 连线；可多张图片连接一个视频。
- “生角色”通常创建角色设定 note/infer，再连接 image；“剧本”用 note/infer；视频用 video；声音用 audio。
- 用户没有明确要求时不要删除、清空或运行会产生费用的图片/视频节点；可以创建并连线，但 run_node 仅在用户明确说生成/运行时使用。
- 优先复用现有节点，动作数量控制在 24 个以内。
- 所有品牌名称只写Freedom。`;
  const modelCfg = resolveTextModelConfig(cfg, 'agent', { projectId: `canvas:${state.canvasId || 'local'}`, task: 'canvas-agent', operation: 'canvas-agent-plan' });
  const raw = await chatComplete(modelCfg, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ instruction, currentCanvas: state, recentMessages: (body.history || []).slice(-8) }).slice(0, 90000) },
  ], { temperature: .25, maxTokens: Math.min(Number(modelCfg.maxTokens) || 12000, 24000), allowTruncated: false });
  const plan = extractJsonObject(raw, { preferObject: true });
  if (!plan || typeof plan !== 'object') throw new Error('Freedom Agent 未返回有效操作计划');
  return { reply: String(plan.reply || '我已经为当前画布制定了操作计划。'), actions: Array.isArray(plan.actions) ? plan.actions.slice(0, 24) : [] };
}

function startCanvasJob(kind, body, runner) {
  const jobId = `canvas_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  setJob(jobId, {
    status: 'running',
    phase: kind,
    kind: `canvas-${kind}`,
    title: body.title || ({ infer: '画布文本推理', image: '画布图片生成', video: '画布视频生成' }[kind] || '画布生成'),
    canvasId: String(body.canvasId || ''),
    nodeId: String(body.nodeId || ''),
    progress: 3,
    message: '正在连接模型…',
  });
  Promise.resolve().then(() => runner(jobId)).catch((error) => {
    setJob(jobId, { status: 'error', progress: 100, error: error.message, message: error.message || '生成失败' });
  });
  return { ok: true, jobId };
}

async function publishCanvasVideo(canvasId, nodeId, result = {}) {
  const rawUrl = String(result.videoUrl || '').trim();
  const candidate = String(result.videoPath || (rawUrl && fs.existsSync(rawUrl) ? rawUrl : '')).trim();
  const sourceExt = path.extname(candidate || (() => {
    try { return new URL(rawUrl).pathname; } catch { return ''; }
  })()).toLowerCase();
  const extension = ['.mp4', '.webm', '.mov', '.m4v'].includes(sourceExt) ? sourceExt.slice(1) : 'mp4';
  const target = canvasMediaPath(canvasId, nodeId, extension);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });

  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    if (path.resolve(candidate) !== path.resolve(target)) {
      const tmp = `${target}.${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
      try {
        await fs.promises.copyFile(candidate, tmp);
        await fs.promises.rename(tmp, target);
      } catch (error) {
        await fs.promises.rm(tmp, { force: true }).catch(() => {});
        throw error;
      }
    }
  } else if (/^https?:\/\//i.test(rawUrl)) {
    await saveVideoUrlToFile(target, rawUrl);
  } else {
    throw new Error('视频已完成，但未找到可下载的视频文件');
  }
  return canvasMediaUrl(canvasId, nodeId, extension);
}

function decodeCanvasReferenceSegment(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return ''; }
}

function resolveCanvasReferencePath(mediaUrl, kind = 'image') {
  const value = String(mediaUrl || '').trim();
  const extensionPattern = kind === 'video'
    ? /\.(?:mp4|webm|mov|m4v)$/i
    : kind === 'audio'
      ? /\.(?:mp3|wav|m4a|aac|ogg|flac|webm|weba)$/i
      : /\.(?:png|jpe?g|webp|gif|avif)$/i;
  const canvasMatch = value.match(/^\/api\/canvas\/media\/([^/]+)\/([^/?#]+)(?:[?#].*)?$/i);
  if (canvasMatch) {
    const dir = safeSegment(decodeCanvasReferenceSegment(canvasMatch[1]), 'canvas');
    const file = path.basename(decodeCanvasReferenceSegment(canvasMatch[2]));
    const target = path.join(CANVAS_MEDIA_ROOT, dir, file);
    if (extensionPattern.test(file) && fs.existsSync(target) && fs.statSync(target).isFile()) return target;
    if (kind === 'video' && extensionPattern.test(file)) {
      const baseName = path.basename(file, path.extname(file));
      const aliases = ['.mp4', '.webm', '.mov', '.m4v', '.m4a']
        .map((extension) => path.join(CANVAS_MEDIA_ROOT, dir, `${baseName}${extension}`))
        .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (aliases) return aliases;
    }
    return '';
  }
  if (kind === 'image') {
    const imageMatch = value.match(/^\/img\/([^/]+)\/([^/]+)\/([^/?#]+)\.png(?:[?#].*)?$/i);
    if (imageMatch) {
      const target = imageDiskPath(
        decodeCanvasReferenceSegment(imageMatch[1]),
        decodeCanvasReferenceSegment(imageMatch[2]),
        decodeCanvasReferenceSegment(imageMatch[3]),
      );
      return fs.existsSync(target) && fs.statSync(target).isFile() ? target : '';
    }
  }
  if (kind === 'audio') {
    const audioMatch = value.match(/^\/audio\/([^/]+)\/character\/([^/?#]+)\.(?:mp3|m4a)(?:[?#].*)?$/i);
    if (audioMatch) {
      const target = characterVoiceReadDiskPath(
        decodeCanvasReferenceSegment(audioMatch[1]),
        decodeCanvasReferenceSegment(audioMatch[2]),
      );
      return fs.existsSync(target) && fs.statSync(target).isFile() ? target : '';
    }
  }
  return '';
}

function canvasReferenceBundle(body = {}, { provider = '', model = '' } = {}) {
  const paths = { image: [], video: [], audio: [] };
  const mentions = [];
  const seen = { image: new Set(), video: new Set(), audio: new Set() };
  const limits = provider === 'dreamina-cli'
    ? dreaminaVideoCapabilities(model).multimodal
    : { image: 9, video: 3, audio: 3 };

  const add = (raw, fallbackKind = 'image') => {
    const kind = ['image', 'video', 'audio'].includes(raw?.kind) ? raw.kind : fallbackKind;
    if (paths[kind].length >= limits[kind]) return;
    const mediaUrl = String(raw?.mediaUrl || raw?.url || '').trim();
    const file = resolveCanvasReferencePath(mediaUrl, kind);
    if (!file || seen[kind].has(file)) return;
    seen[kind].add(file);
    paths[kind].push(file);
    const label = String(raw?.displayName || raw?.label || raw?.name || `${kind}${paths[kind].length}`).trim().slice(0, 100);
    mentions.push({
      kind,
      name: label,
      label,
      displayName: label,
      referenceInstruction: String(raw?.referenceInstruction || '').trim().slice(0, 500),
    });
  };

  for (const reference of (Array.isArray(body.references) ? body.references : []).slice(0, limits.total || 40)) add(reference);
  const legacy = {
    image: [...(Array.isArray(body.imageUrls) ? body.imageUrls : []), body.imageUrl].filter(Boolean),
    video: Array.isArray(body.videoUrls) ? body.videoUrls : [],
    audio: Array.isArray(body.audioUrls) ? body.audioUrls : [],
  };
  for (const kind of ['image', 'video', 'audio']) {
    for (const [index, mediaUrl] of legacy[kind].entries()) add({ kind, mediaUrl, label: `${kind}${index + 1}` }, kind);
  }
  return { paths, mentions };
}

function resolveCanvasVideoPath(videoUrl) {
  const value = String(videoUrl || '').trim();
  const match = value.match(/^\/api\/canvas\/media\/([^/]+)\/([^/?#]+\.(?:mp4|webm|mov|m4v))(?:[?#].*)?$/i);
  if (!match) return '';
  const dir = safeSegment(decodeURIComponent(match[1]), 'canvas');
  const file = path.basename(decodeURIComponent(match[2]));
  const target = path.join(CANVAS_MEDIA_ROOT, dir, file);
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : '';
}

async function extractCanvasVideoFrame(body = {}) {
  const canvasId = String(body.canvasId || '').trim();
  const videoNodeId = String(body.videoNodeId || '').trim();
  const imageNodeId = String(body.imageNodeId || '').trim();
  const mode = body.mode === 'time' ? 'time' : 'tail';
  if (!canvasId || !videoNodeId || !imageNodeId) throw new Error('缺少画布截帧参数');

  const source = resolveCanvasVideoPath(body.mediaUrl);
  if (!source) throw new Error('画布视频文件不存在，请重新生成视频');
  const target = canvasMediaPath(canvasId, imageNodeId, 'png');
  const tmp = `${target}.${Date.now()}-${Math.random().toString(36).slice(2)}.part.png`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });

  const outputArgs = ['-frames:v', '1', '-q:v', '2', tmp];
  const args = mode === 'time'
    ? ['-y', '-hide_banner', '-i', source, '-ss', Math.max(0, Number(body.time) || 0).toFixed(3), ...outputArgs]
    : ['-y', '-hide_banner', '-sseof', '-0.5', '-i', source, ...outputArgs];
  try {
    await execFileAsync(ffmpegPath(), args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 100) throw new Error('截取结果为空');
    await fs.promises.rename(tmp, target);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw new Error(`视频截帧失败：${error.message}`);
  }
  return {
    mediaUrl: canvasMediaUrl(canvasId, imageNodeId, 'png'),
    mode,
    time: mode === 'time' ? Math.max(0, Number(body.time) || 0) : null,
  };
}

async function runTextInference(jobId, body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('请先填写推理提示词');
  const cfg = loadConfig();
  const modelCfg = resolveTextModelConfig(cfg, 'agent', {
    projectId: `canvas:${body.canvasId || 'local'}`,
    task: 'canvas-inference',
    operation: 'canvas-inference',
  });
  setJob(jobId, { progress: 18, message: `正在调用 ${modelCfg.model || '文本模型'}…`, model: modelCfg.model || '' });
  const content = await chatComplete(modelCfg, [
    { role: 'system', content: '你是画布中的创作推理节点。根据用户输入产出可直接放回画布的清晰内容。保留结构、重点和可执行性，不要解释你的工作过程。' },
    { role: 'user', content: prompt.slice(0, 60000) },
  ], {
    temperature: Number(body.temperature ?? .72),
    maxTokens: Math.min(Number(modelCfg.maxTokens) || 12000, 32000),
  });
  setJob(jobId, { status: 'done', progress: 100, message: '推理完成', result: String(content || '') });
}

async function runImageGeneration(jobId, body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('请先填写生图提示词');
  const cfg = loadConfig();
  const provider = normalizeImageProvider(body.provider || cfg.image?.provider);
  const image = { ...cfg.image, provider };
  if (provider === 'libtv-cli') {
    image.libtvModel = String(body.model || image.libtvModel || 'Lib Image');
    if (body.resolution !== undefined) image.libtvResolution = String(body.resolution || '').trim();
    if (body.quality !== undefined) image.libtvQuality = String(body.quality || '').trim();
  } else if (provider === 'dreamina-cli') {
    image.dreaminaModel = String(body.model || image.dreaminaModel || '5.0').trim();
    if (body.resolution !== undefined) image.dreaminaResolution = String(body.resolution || '').trim().toLowerCase();
    if (body.session !== undefined) image.dreaminaSession = String(body.session || '0').trim();
  } else if (provider === 'updream') {
    image.updreamModel = String(body.model || image.updreamModel || 'cheap-b-2');
    if (body.resolution !== undefined) image.updreamResolution = String(body.resolution || '').trim();
    if (body.quality !== undefined) image.updreamQuality = String(body.quality || '').trim();
  } else if (provider === 'neowow') {
    image.neowowModel = String(body.model || image.neowowModel || 'gpt-image-2').trim();
    image.neowowAccountId = String(body.accountId || image.neowowAccountId || cfg.video?.neowowAccountId || '').trim();
    if (body.resolution !== undefined) image.neowowResolution = String(body.resolution || '').trim().toUpperCase();
    if (body.quality !== undefined) image.neowowQuality = String(body.quality || '').trim().toLowerCase();
  } else {
    const requestedChannelId = String(body.channelId || '').trim();
    const requestedBaseUrl = String(body.baseUrl || '').trim();
    const channels = (Array.isArray(image.channels) ? image.channels : []).map((channel) => ({ ...channel }));
    const selected = channels.find((channel) => requestedChannelId && channel.id === requestedChannelId)
      || channels.find((channel) => requestedBaseUrl && channel.baseUrl === requestedBaseUrl);
    if (selected) {
      image.activeChannelId = selected.id;
      if (body.model) selected.model = String(body.model);
    } else {
      if (requestedBaseUrl) image.baseUrl = requestedBaseUrl;
      if (body.model) image.model = String(body.model);
    }
    image.channels = channels;
  }
  const requestConfig = { ...cfg, image };
  const configError = imageProviderConfigError(requestConfig);
  if (configError) throw new Error(configError);
  const ratio = String(body.ratio || '16:9');
  const resolution = String(body.resolution || '').trim();
  const quality = String(body.quality || '').trim();
  const model = provider === 'libtv-cli'
    ? image.libtvModel
    : provider === 'dreamina-cli' ? image.dreaminaModel
      : provider === 'updream' ? image.updreamModel
        : provider === 'neowow' ? image.neowowModel : (body.model || image.model);
  const references = canvasReferenceBundle(body);
  setJob(jobId, { progress: 16, message: `正在调用 ${imageProviderLabel(provider)}…`, provider, model: model || '', ratio, resolution, referenceImageCount: references.paths.image.length });
  const result = await generateConfiguredImage(requestConfig, prompt, {
    ratio,
    resolution,
    quality,
    referenceImages: references.paths.image,
    usageContext: {
      projectId: `canvas:${body.canvasId || 'local'}`,
      task: 'canvas-image',
      operation: 'canvas-image',
    },
    onProgress: (message) => setJob(jobId, { message, progress: 38 }),
  });
  const decoded = decodeCanvasImage(result.b64);
  const file = canvasMediaPath(body.canvasId, body.nodeId, decoded.extension);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, decoded.bytes);
  setJob(jobId, {
    status: 'done', progress: 100, message: '图片生成完成',
    mediaUrl: canvasMediaUrl(body.canvasId, body.nodeId, decoded.extension),
    revisedPrompt: result.revisedPrompt || '',
  });
}

async function submitCanvasVideo(jobId, body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('请先填写视频提示词');
  const cfg = loadConfig();
  const provider = normalizeVideoProvider(body.provider || cfg.video?.provider);
  const dreaminaModel = provider === 'dreamina-cli'
    ? String(body.model || cfg.video?.dreaminaModel || '')
    : '';
  const configuredResolution = provider === normalizeVideoProvider(cfg.video?.provider)
    ? cfg.video?.resolution
    : '';
  const references = canvasReferenceBundle(body, { provider, model: dreaminaModel });
  const refImagePaths = references.paths.image;
  const refVideoPaths = references.paths.video;
  const mentions = references.mentions;
  const dreaminaDuration = dreaminaVideoCapabilities(dreaminaModel).duration;
  const configuredMaxDuration = Math.max(5, Math.min(500, Math.floor(Number(cfg.video?.duration) || 15)));
  const requestedDuration = Number(body.duration || cfg.video?.duration || 15);
  const task = {
    shotNo: safeSegment(body.nodeId, 'canvas'),
    prompt,
    refImagePaths,
    refAudioPaths: references.paths.audio,
    refVideoPaths,
    mentions,
    aspectRatio: String(body.ratio || cfg.video?.aspectRatio || '16:9'),
    resolution: String(body.resolution || configuredResolution || (provider === 'updream' ? '480p' : '720p')),
    duration: provider === 'dreamina-cli'
      ? Math.max(dreaminaDuration.min, Math.min(dreaminaDuration.max, requestedDuration))
      : Math.max(5, Math.min(configuredMaxDuration, requestedDuration)),
  };
  setJob(jobId, { provider, referenceImageCount: refImagePaths.length, progress: 12, message: `正在提交到 ${provider}…` });

  let results = [];
  let account = null;
  try {
    if (provider === 'video-api') {
      results = await submitVideoApiVideos({
        apiConfig: cfg.video || {}, shots: [task], model: body.model || '',
        resolution: task.resolution, concurrency: 1,
        onProgress: (message) => setJob(jobId, { message, progress: 28 }),
      });
    } else if (provider === 'libtv-cli') {
      results = await submitLibtvVideos({
        config: cfg.video || {},
        projectUuid: cfg.video?.libtvProjectUuid,
        shots: [task],
        model: body.model || cfg.video?.libtvModel || 'Seedance 2.0 VIP',
        concurrency: cfg.video?.libtvConcurrency ?? 3,
        onProgress: (message) => setJob(jobId, { message, progress: 28 }),
      });
    } else if (provider === 'updream') {
      results = await submitUpdreamVideos({
        config: cfg.video || {},
        projectName: `Canvas ${body.canvasId || 'local'}`,
        shots: [task],
        model: body.model || cfg.video?.updreamModel || 'sed2-fast',
        resolution: task.resolution,
        concurrency: 1,
        onProgress: (message) => setJob(jobId, { message, progress: 28 }),
        onTokens: persistUpdreamTokens,
      });
    } else if (provider === 'xiaoyunque') {
      account = acquireXiaoyunqueAccount(body.accountId || '');
      if (!account) throw new Error('没有可用的小云雀 access key，请先在视频设置中添加');
      results = await submitXiaoyunqueVideos({
        account, shots: [task], model: body.model || cfg.video?.xiaoyunqueModel,
        resolution: task.resolution,
        onProgress: (message) => setJob(jobId, { message, progress: 28 }),
      });
    } else {
      results = await submitDreaminaVideos({
        shots: [task], model: dreaminaModel, resolution: task.resolution,
        session: body.session ?? cfg.video?.dreaminaSession ?? '0',
        onProgress: (message) => setJob(jobId, { message, progress: 28 }),
      });
    }
  } finally {
    if (account?.id) releaseXiaoyunqueAccount(account.id);
  }

  const result = results[0];
  if (!result?.ok || !result.submitId) throw new Error(result?.error || '视频任务提交失败');
  if (result.videoUrl || result.videoPath) {
    try {
      const mediaUrl = await publishCanvasVideo(body.canvasId, body.nodeId, result);
      setJob(jobId, { status: 'done', progress: 100, message: '视频已下载到本地', mediaUrl, submitId: result.submitId, provider });
      if (result.cleanupDir) await fs.promises.rm(result.cleanupDir, { recursive: true, force: true }).catch(() => {});
    } catch (error) {
      setJob(jobId, {
        status: 'queued', progress: 88, message: `视频下载失败，后台将继续重试：${error.message}`,
        lastError: error.message, submitId: result.submitId, historyId: result.historyId || result.submitId,
        provider, accountId: result.channelId || account?.id || '',
        videoPath: result.videoPath || '', videoUrl: result.videoUrl || '', cleanupDir: result.cleanupDir || '',
      });
    }
    return;
  }
  setJob(jobId, {
    status: 'queued', progress: 38, message: '视频已提交，等待模型生成…',
    submitId: result.submitId, historyId: result.historyId || result.submitId,
    provider, accountId: result.channelId || account?.id || '',
  });
}

async function pollCanvasVideoJob(jobId, job) {
  if (!job || job.status !== 'queued' || !job.submitId || POLL_GUARD.has(jobId)) return job;
  POLL_GUARD.add(jobId);
  try {
    const cfg = loadConfig();
    let results = {};
    if (job.provider === 'libtv-cli') {
      const available = job.videoPath && fs.existsSync(job.videoPath);
      results = {
        [job.submitId]: available || job.videoUrl
          ? { status: 'done', videoPath: available ? job.videoPath : '', videoUrl: job.videoUrl || '' }
          : { status: 'failed', fail: job.lastError || 'LibTV 本地视频文件不可用' },
      };
    } else if (job.provider === 'video-api') {
      const apiConfig = resolveVideoApiChannel(cfg.video || {}, job.accountId) || cfg.video || {};
      results = await fetchVideoApiResults({ apiConfig, submitIds: [job.submitId] });
    } else if (job.provider === 'updream') {
      results = await fetchUpdreamVideoResults({
        config: cfg.video || {},
        submitIds: [job.submitId],
        onTokens: persistUpdreamTokens,
      });
    } else if (job.provider === 'xiaoyunque') {
      const account = acquireXiaoyunqueAccount(job.accountId) || acquireXiaoyunqueAccount('');
      if (!account) throw new Error('用于查询视频的小云雀账号不可用');
      try { results = await fetchXiaoyunqueVideoResults({ account, submitIds: [job.submitId] }); }
      finally { if (account.id) releaseXiaoyunqueAccount(account.id); }
    } else {
      results = await fetchDreaminaVideoResults({ submitIds: [job.submitId] });
    }
    const result = results?.[job.submitId];
    if (!result) return setJob(jobId, { message: '视频仍在生成中…', progress: Math.min(88, Number(job.progress || 38) + 3) });
    if (result.status === 'done' && (result.videoUrl || result.videoPath)) {
      try {
        const mediaUrl = await publishCanvasVideo(job.canvasId, job.nodeId, result);
        const cleanupDir = result.cleanupDir || job.cleanupDir;
        if (cleanupDir) await fs.promises.rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
        return setJob(jobId, { status: 'done', progress: 100, message: '视频已下载到本地', mediaUrl, error: '', lastError: '' });
      } catch (error) {
        return setJob(jobId, {
          status: 'queued', progress: 92, message: `视频下载失败，后台将继续重试：${error.message}`,
          lastError: error.message,
        });
      }
    }
    if (result.status === 'failed') {
      return setJob(jobId, { status: 'error', progress: 100, message: result.fail || '视频生成失败', error: result.fail || '视频生成失败' });
    }
    return setJob(jobId, { message: result.note || '视频仍在生成中…', progress: Math.min(92, Number(job.progress || 38) + 2) });
  } finally {
    POLL_GUARD.delete(jobId);
  }
}

export function startCanvasBackgroundPoll() {
  if (canvasPollTimer) return;
  const tick = () => {
    const pending = listJobs().filter((job) => job.kind === 'canvas-video' && job.status === 'queued' && job.submitId);
    for (const job of pending) pollCanvasVideoJob(job.id, job).catch((error) => {
      setJob(job.id, { message: `画布视频查询失败，后台将继续重试：${error.message}`, lastError: error.message });
    });
  };
  tick();
  canvasPollTimer = setInterval(tick, 10 * 1000);
  canvasPollTimer.unref?.();
}

function serveCanvasMedia(req, res, p, url) {
  const match = p.match(/^\/api\/canvas\/media\/([^/]+)\/([^/]+)$/);
  if (!match) return false;
  const dir = safeSegment(decodeURIComponent(match[1]), 'canvas');
  const fileName = path.basename(decodeURIComponent(match[2]));
  const requestedExt = path.extname(fileName).toLowerCase();
  const requestedFile = path.join(CANVAS_MEDIA_ROOT, dir, fileName);
  let file = requestedFile;
  let recoveredVideoAlias = false;
  if (!fs.existsSync(file) && ['.mp4', '.webm', '.mov', '.m4v'].includes(requestedExt)) {
    const baseName = path.basename(fileName, requestedExt);
    const legacyVideoExtensions = ['.mp4', '.webm', '.mov', '.m4v', '.m4a'];
    const alias = legacyVideoExtensions
      .map((extension) => path.join(CANVAS_MEDIA_ROOT, dir, `${baseName}${extension}`))
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (alias) {
      file = alias;
      recoveredVideoAlias = path.extname(alias).toLowerCase() !== requestedExt;
    }
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('Not Found'); return true;
  }
  const ext = path.extname(file).toLowerCase();
  const responseExt = recoveredVideoAlias ? requestedExt : ext;
  const download = url?.searchParams?.get('download') === '1';
  const streamContentType = responseExt === '.mp4' || responseExt === '.m4v' ? 'video/mp4'
    : responseExt === '.webm' ? 'video/webm'
      : responseExt === '.mov' ? 'video/quicktime'
        : ext === '.mp3' ? 'audio/mpeg'
          : ext === '.wav' ? 'audio/wav'
            : ext === '.m4a' || ext === '.aac' ? 'audio/mp4'
              : ext === '.ogg' ? 'audio/ogg'
                : ext === '.flac' ? 'audio/flac'
                    : ext === '.weba' ? 'audio/webm'
                              : '';
  const downloadHeaders = download ? canvasDownloadHeaders(file, url.searchParams.get('name') || '', recoveredVideoAlias ? responseExt : '') : {};
  if (streamContentType) {
    streamRangeFile(req, res, file, streamContentType, true, downloadHeaders);
    return true;
  }
  let data = fs.readFileSync(file);
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext) && !detectImageExtension(data)) {
    const repaired = repairLegacyCanvasImage(data);
    if (repaired !== data) {
      data = repaired;
      try { fs.writeFileSync(file, repaired); } catch { /* serving the repaired bytes is still useful */ }
    }
  }
  const detectedImage = detectImageExtension(data);
  const contentType = detectedImage === 'png' ? 'image/png'
    : detectedImage === 'jpg' ? 'image/jpeg'
      : detectedImage === 'webp' ? 'image/webp'
        : detectedImage === 'gif' ? 'image/gif'
          : detectedImage === 'avif' ? 'image/avif'
            : ext === '.mp4' || ext === '.m4v' ? 'video/mp4'
              : ext === '.webm' ? 'video/webm'
                : ext === '.mov' ? 'video/quicktime'
                  : ext === '.mp3' ? 'audio/mpeg'
                    : ext === '.wav' ? 'audio/wav'
                      : ext === '.m4a' || ext === '.aac' ? 'audio/mp4'
                        : ext === '.ogg' ? 'audio/ogg'
                          : ext === '.flac' ? 'audio/flac'
                          : ext === '.weba' ? 'audio/webm'
                              : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length, 'Cache-Control': 'private, no-cache', ...downloadHeaders });
  res.end(data);
  return true;
}

export async function handleCanvasRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if (p === '/api/canvas/projects' && method === 'GET') {
    return sendJson(res, 200, { ok: true, projects: readCanvasProjects() });
  }
  if (p === '/api/canvas/projects' && method === 'POST') {
    try {
      const body = await readBody(req);
      const projects = writeCanvasProjects(body?.projects);
      return sendJson(res, 200, { ok: true, count: projects.length, savedAt: new Date().toISOString() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }
  if (p === '/api/canvas/project-stats' && method === 'GET') {
    const canvasId = String(url.searchParams.get('canvasId') || '').trim();
    if (!canvasId) return sendJson(res, 400, { ok: false, error: '缺少画布 ID' });
    const project = readCanvasProjects().find((item) => item.id === canvasId);
    if (!project) return sendJson(res, 404, { ok: false, error: '画布项目不存在' });
    return sendJson(res, 200, { ok: true, canvasId, ...canvasProjectStats(project) });
  }
  if (p === '/api/canvas/open-folder' && method === 'POST') {
    try {
      const body = await readBody(req);
      const canvasId = String(body?.canvasId || '').trim();
      if (!canvasId) throw new Error('缺少画布 ID');
      const directory = openCanvasMediaFolder(canvasId, { open: body?.open !== false });
      return sendJson(res, 200, { ok: true, dir: directory });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }
  if (method === 'GET' && p.startsWith('/api/canvas/media/')) return serveCanvasMedia(req, res, p, url);

  if (p === '/api/canvas/media/upload' && method === 'POST') {
    try {
      const canvasId = String(url.searchParams.get('canvasId') || '');
      const nodeId = String(url.searchParams.get('nodeId') || '');
      const filename = String(url.searchParams.get('filename') || '');
      const requestedKind = String(url.searchParams.get('kind') || 'audio');
      const kind = ['image', 'video', 'audio'].includes(requestedKind) ? requestedKind : 'audio';
      if (!canvasId || !nodeId || !filename) throw new Error('缺少画布媒体上传参数');
      const extension = canvasUploadExtension(filename, String(req.headers['content-type'] || ''), kind);
      const file = canvasMediaPath(canvasId, nodeId, extension);
      const maxBytes = kind === 'image' ? 64 * 1024 * 1024 : kind === 'video' ? 2 * 1024 * 1024 * 1024 : 512 * 1024 * 1024;
      await saveCanvasUpload(req, file, maxBytes);
      return sendJson(res, 200, { ok: true, mediaUrl: canvasMediaUrl(canvasId, nodeId, extension), kind });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }
  if (p === '/api/canvas/audio/upload' && method === 'POST') {
    try {
      const canvasId = String(url.searchParams.get('canvasId') || '');
      const nodeId = String(url.searchParams.get('nodeId') || '');
      const filename = String(url.searchParams.get('filename') || '');
      if (!canvasId || !nodeId || !filename) throw new Error('缺少音频上传参数');
      const extension = canvasUploadExtension(filename, String(req.headers['content-type'] || ''), 'audio');
      const file = canvasMediaPath(canvasId, nodeId, extension);
      await saveCanvasUpload(req, file, 512 * 1024 * 1024);
      return sendJson(res, 200, { ok: true, mediaUrl: canvasMediaUrl(canvasId, nodeId, extension), kind: 'audio' });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }
  if (p === '/api/canvas/video/frame' && method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJson(res, 200, { ok: true, ...(await extractCanvasVideoFrame(body)) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }
  if (p === '/api/canvas/agent/plan' && method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJson(res, 200, { ok: true, plan: await planCanvasAgent(body) });
    } catch (error) {
      return sendJson(res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/canvas/infer' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, startCanvasJob('infer', body, (jobId) => runTextInference(jobId, body)));
  }
  if (p === '/api/canvas/image' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, startCanvasJob('image', body, (jobId) => runImageGeneration(jobId, body)));
  }
  if (p === '/api/canvas/video' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, startCanvasJob('video', body, (jobId) => submitCanvasVideo(jobId, body)));
  }
  if (p === '/api/canvas/job' && method === 'GET') {
    const jobId = String(url.searchParams.get('jobId') || '');
    let job = getJob(jobId);
    if (!job || !String(job.kind || '').startsWith('canvas-')) return sendJson(res, 404, { error: '画布任务不存在' });
    if (job.kind === 'canvas-video' && job.status === 'queued') job = await pollCanvasVideoJob(jobId, job);
    return sendJson(res, 200, { ok: true, jobId, ...job });
  }
  return false;
}
