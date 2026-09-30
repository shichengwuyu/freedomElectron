import fs from 'fs';
import os from 'os';
import path from 'path';
import { Buffer } from 'buffer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import http from 'http';
import https from 'https';
import {
  DEFAULT_BUILT_IN_VIDEO_API_MODEL,
  DEFAULT_VIDEO_API_BASE_URL,
  DEFAULT_VIDEO_GATEWAY_API_MODEL,
  BUILT_IN_VIDEO_CHANNEL_2,
  SECOND_BUILT_IN_VIDEO_API_MODEL,
  VIDEO_API_PROTOCOL_NEW_API,
  VIDEO_API_PROTOCOL_FEITUO,
  isBuiltInGateway,
  isBuiltInVideoApiBaseUrl,
  normalizeVideoApiBaseUrl,
  normalizeVideoApiProtocol,
  normalizeVideoImageUpload,
  resolveVideoApiCandidates,
} from './channelProfiles.js';
import { describeFetchError, imageUploadEnabled, uploadVideoApiMedia } from './videoImageUploader.js';
import { candidateVideoUrls } from './videoCandidates.js';
import { ffmpegPath } from './config.js';

const execFileAsync = promisify(execFile);

const DEFAULT_BASE_URL = DEFAULT_VIDEO_API_BASE_URL;
// 同步型网关（如内置 New API）提交响应可能等到生成完成才返回成品，
// 2 分钟会把正常工作的大窗口请求掐死（上游任务实际已创建并完成）。
const SUBMIT_TIMEOUT_MS = 10 * 60 * 1000;
const QUERY_TIMEOUT_MS = 60 * 1000;
const DEFAULT_SUBMIT_CONCURRENCY = 3;
const MAX_SUBMIT_CONCURRENCY = 8;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
};

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeBaseUrl(baseUrl, builtIn, builtInChannel) {
  const raw = String(baseUrl || DEFAULT_BASE_URL).trim();
  const preserve = builtIn === false || builtInChannel === BUILT_IN_VIDEO_CHANNEL_2;
  return (preserve ? raw : normalizeVideoApiBaseUrl(raw)).replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function isFeituoProtocol(protocol) {
  return String(protocol || '') === VIDEO_API_PROTOCOL_FEITUO;
}

function validateFeituoImageReferences(imageRefs = []) {
  const invalid = (Array.isArray(imageRefs) ? imageRefs : [])
    .filter((value) => !/^https?:\/\/[^\s]+$/i.test(String(value || '').trim()));
  if (!invalid.length) return;
  throw new Error('飞拓跨界视频的参考图需要公网图片链接；当前未启用图床，图片无法绑定到 @Image 槽位。请到“设置 → 图床”启用免费图床或配置自定义图床后重试。');
}

// 内置网关(api.xiaoyxiao.xyz)的上游只收公网 http(s) 素材：base64 data URL 或本地路径会被
// 上游直接用 400 打回（`"image_urls" must be a public http(s) URL` / 同款 video_urls、audio_urls）。
// 本地图片靠图床转成公网 URL，所以这里在提交前拦下并给出可执行的中文提示，
// 免得把上游那句英文原文甩到用户脸上。
function assertPublicMediaReferences(candidate = {}, payload = {}) {
  if (!isBuiltInGateway(candidate.baseUrl)) return;
  const refs = [
    ...(Array.isArray(payload.image_refs) ? payload.image_refs : []),
    ...(Array.isArray(payload.video_refs) ? payload.video_refs : []),
    ...(Array.isArray(payload.audio_refs) ? payload.audio_refs : []),
  ];
  const invalid = refs.filter((value) => !/^https?:\/\//i.test(String(value || '').trim()));
  if (!invalid.length) return;
  throw new Error(`内置网关的上游只接受公网图片/视频/音频链接，但有 ${invalid.length} 个参考素材不是公网 URL（本地图片未走图床）。请到“设置 → 图床”启用「免费图床」或配置自己的图床后重试。`);
}

function feituoExtraHeaders() {
  // 该站有机器人防护：无 User-Agent 的请求会被返回 HTML 挑战页而非 JSON
  return { 'X-Public-Model-Ids': '1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' };
}

function feituoGenerateUrl(baseUrl) {
  const url = new URL(String(baseUrl || '').trim().replace(/\/+$/, ''));
  url.pathname = '/api/open/v1/video/generate';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function feituoStatusUrl(baseUrl, jobId) {
  const url = new URL(String(baseUrl || '').trim().replace(/\/+$/, ''));
  url.pathname = '/api/open/v1/video/status';
  url.search = '';
  url.searchParams.set('jobId', String(jobId || ''));
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

// 飞拓跨界 payload：duration/ratio/resolution + 公网素材 URL 数组（@imageN 引用已在 prompt 内）
function feituoVideoPayload(body = {}) {
  return {
    model: body.model,
    prompt: body.prompt,
    ratio: body.aspect_ratio || '16:9',
    duration: Number(body.duration) || undefined,
    resolution: /^\d+p$/i.test(String(body.size || '')) ? String(body.size).toLowerCase() : undefined,
    imageUrls: Array.isArray(body.image_refs) ? body.image_refs.filter(Boolean) : [],
    videoUrls: Array.isArray(body.video_refs) ? body.video_refs.filter(Boolean) : [],
    audioUrls: Array.isArray(body.audio_refs) ? body.audio_refs.filter(Boolean) : [],
  };
}

export function videoApiVideosUrl(baseUrl, protocol = '', builtIn, builtInChannel = '') {
  const base = normalizeBaseUrl(baseUrl, builtIn, builtInChannel);
  if (normalizeVideoApiProtocol(protocol, base) === VIDEO_API_PROTOCOL_NEW_API) {
    if (builtIn !== false && builtInChannel !== BUILT_IN_VIDEO_CHANNEL_2 && isBuiltInVideoApiBaseUrl(base)) return `${DEFAULT_VIDEO_API_BASE_URL}/videos`;
    const url = new URL(base);
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/video\/generations$/i.test(path)) url.pathname = path;
    else if (/\/videos$/i.test(path)) url.pathname = path.replace(/\/videos$/i, '/video/generations');
    else if (!path) url.pathname = '/v1/video/generations';
    else url.pathname = `${path}/video/generations`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }
  return /\/videos$/i.test(base) ? base : `${base}/videos`;
}

function normalizeModel(model) {
  return String(model || '').trim();
}

function normalizeSubmitConcurrency(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SUBMIT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_SUBMIT_CONCURRENCY, n));
}

// 提交对上游不是幂等的：实测同一 idempotency_key 连发两次会各建一个任务（网关静默忽略该字段）。
// 因此只有「请求确定没有送达上游」的错误才允许重交；「请求已发出、响应没拿全」的错误
// 一旦重交就会在上游重复建单、重复计费，必须当作"提交结果未知"处理，不能重试。
function submitErrorText(error) {
  return `${error?.message || ''} ${error?.cause?.code || ''} ${error?.code || ''}`;
}

// 响应没能完整拿回来（连接被重置/读中断/等待响应超时）：上游可能已经受理并建单。
export function isSubmitResultUnknownError(error) {
  return /ECONNRESET|EPIPE|socket hang up|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|read ECONNRESET|视频 API 请求超时/i.test(submitErrorText(error));
}

// 连接阶段的失败（请求根本没发出去，如域名解析失败/拒绝连接/连不上）：重交是安全的。
export function isSubmitRetryableNetworkError(error) {
  if (isSubmitResultUnknownError(error)) return false;
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|connect ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|CERT_|UNABLE_TO_VERIFY|SELF_SIGNED|ERR_TLS/i.test(submitErrorText(error));
}

// 明确的「请求被拒、肯定没建单」状态码；换渠道重来是安全的。
const SUBMIT_REJECTED_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);
// 有响应、但无法确认上游是否已经建单（5xx / 408 这类）：和"响应被中断"一样必须当作结果未知。
// 之前这类错误既不是 unknown 也不是可重试的网络错误，于是一路走到 attempt >= allowedRetries
// 之后被重发 —— 非幂等的创建请求被重复提交，还会 failover 到别的渠道再建一个，重复计费。
export function isSubmitOutcomeUnknownStatus(error) {
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status <= 0) return false;
  return !SUBMIT_REJECTED_STATUSES.has(status);
}
const NETWORK_RETRY_DELAYS_MS = [800, 2500, 6000];

// 全局画风 → 视频 prompt 前缀：让视频与元素出图风格一致（真人/漫剧/水墨…）。
// key 与 backend/prompts.js 的 STYLE_PRESETS 档位对应；未知档位不注入。
const VIDEO_STYLE_DIRECTIVES = {
  realistic: '真人实拍电影质感：真实演员表演与真实相机拍摄感，自然皮肤纹理，电影级布光与调色，禁止 3D 渲染感与动漫感。',
  anime: '2D 日系动漫风格：厚涂精修插画动态化，清晰线稿与通透色彩，影视级运镜与打光。',
  '3d': '3D 国漫风格：UE5 渲染质感，电影级光影与 PBR 材质，精致国漫审美，人物比例写实、五官立体漂亮。',
  webtoon: '漫剧风格：2D 动态漫画/韩漫条漫质感，清晰描线、干净分色上色，影视级打光与运镜，网感高颜值人物。',
  inkwash: '水墨国风：水墨写意与国风插画融合，留白构图，墨色晕染，传统配色，电影级意境运镜。',
  american: '美式漫画风格：硬朗描线与强对比块面光影，经典美漫分色质感，动态张力十足。',
  clay: '黏土定格动画风格：可见黏土材质肌理与手工捏塑痕迹，微缩影棚布光，定格动画式动作节奏。',
};

function withStylePrefix(prompt, style) {
  const directive = VIDEO_STYLE_DIRECTIVES[String(style || '').trim()];
  const clean = String(prompt || '').trim();
  if (!directive) return clean;
  return `【全局画风】${directive}\n\n${clean}`;
}

// 肖像保护绕过：把图片左右各取一半，将左半镜像后拼接成对称图——
// 人脸变成完全对称，破坏人脸识别的特征匹配（Dreamina「只支持生成包含您自己的视频」审核），
// 肉眼观感基本不变。失败时静默回退原图。
async function perturbPortraitFile(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw || /^https?:/i.test(raw) || /^data:/i.test(raw)) return filePath;
  try {
    await fs.promises.access(raw);
  } catch {
    return filePath;
  }
  const outPath = path.join(os.tmpdir(), `portrait-bypass-${randomUUID()}.png`);
  const half = "trunc(iw/2)";
  const filter = `[0]crop=w='${half}':h=ih:x=0,hflip[l];[0]crop=w='${half}':h=ih:x=0[r];[l][r]hstack`;
  try {
    await execFileAsync(ffmpegPath(), ['-y', '-i', raw, '-filter_complex', filter, '-frames:v', '1', outPath], { timeout: 60000 });
    const stat = await fs.promises.stat(outPath);
    if (!stat.size) throw new Error('空输出');
    return outPath;
  } catch {
    try { fs.rmSync(outPath, { force: true }); } catch { /* 忽略 */ }
    return filePath;
  }
}

function requireApiConfig(config = {}) {
  const baseUrl = String(config.apiBaseUrl ?? config.baseUrl ?? '').trim();
  const apiKey = String(config.apiKey || '').trim();
  const builtIn = typeof config.builtIn === 'boolean' ? config.builtIn : undefined;
  const builtInChannel = String(config.builtInChannel || '').trim();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, builtIn, builtInChannel);
  const model = normalizeModel(config.apiModel ?? config.model)
    || (builtInChannel === BUILT_IN_VIDEO_CHANNEL_2
      ? SECOND_BUILT_IN_VIDEO_API_MODEL
      : ((builtIn !== false && isBuiltInVideoApiBaseUrl(normalizedBaseUrl))
        ? DEFAULT_BUILT_IN_VIDEO_API_MODEL
        : (isBuiltInGateway(normalizedBaseUrl) ? DEFAULT_VIDEO_GATEWAY_API_MODEL : '')));
  if (!baseUrl) {
    const err = new Error('请先在视频设置里填写 Base URL');
    err.code = 'CONFIG_MISSING';
    throw err;
  }
  if (!apiKey) {
    const err = new Error('请先在视频设置里填写 API Key');
    err.code = 'AUTH_MISSING';
    throw err;
  }
  if (!model) {
    const err = new Error('请先在视频设置里选择或填写模型');
    err.code = 'CONFIG_MISSING';
    throw err;
  }
  return {
    baseUrl: normalizedBaseUrl,
    apiProtocol: normalizeVideoApiProtocol(config.apiProtocol, normalizedBaseUrl),
    apiKey,
    model,
    ...(typeof builtIn === 'boolean' ? { builtIn } : {}),
    ...(builtInChannel ? { builtInChannel } : {}),
    imageUpload: config.imageUpload || {},
  };
}

export function videoApiDuration(duration, baseUrl = DEFAULT_BASE_URL, builtIn, builtInChannel = '') {
  const n = Math.round(Number(duration));
  if (builtIn !== false && isBuiltInVideoApiBaseUrl(baseUrl)) {
    if (!Number.isFinite(n)) return builtInChannel === BUILT_IN_VIDEO_CHANNEL_2 ? 8 : 4;
    return builtInChannel === BUILT_IN_VIDEO_CHANNEL_2
      ? Math.max(5, Math.min(15, n))
      : Math.max(4, Math.min(15, n));
  }
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(60, n));
}

function sizeDimensions(size) {
  const match = String(size || '').trim().match(/^(\d+)x(\d+)$/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
}

function aspectRatioFromSize(size) {
  const { width, height } = sizeDimensions(size);
  if (!width || !height) return '16:9';
  const candidates = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
  return candidates.reduce((best, ratio) => {
    const [rw, rh] = ratio.split(':').map(Number);
    return Math.abs((width / height) - (rw / rh)) < Math.abs((width / height) - (best[0] / best[1]))
      ? [rw, rh]
      : best;
  }, [16, 9]).join(':');
}

export function newApiVideoPayload(body = {}, candidate = {}) {
  const images = Array.isArray(body.image_refs) ? body.image_refs.filter(Boolean) : [];
  const audioRefs = Array.isArray(body.audio_refs) ? body.audio_refs.filter(Boolean) : [];
  const videoRefs = Array.isArray(body.video_refs) ? body.video_refs.filter(Boolean) : [];
  // 清晰度：默认 720p 不发（老渠道零影响）；选 480p/1080p 才显式传 resolution，
  // 上游不认时由参数自愈摘掉（resolution 在 DROPPABLE 名单里），退回上游默认档。
  const dims = sizeDimensions(body.size);
  const resolutionField = dims.height === 480 ? { resolution: '480p' }
    : dims.height === 1080 ? { resolution: '1080p' } : {};
  return {
    model: body.model,
    prompt: body.prompt,
    // 只发 duration：seconds 与它是同一个值的重复字段，部分 newapi 上游会直接报
    // "unsupported parameter seconds" 把整个提交打回来。omit 掉不丢信息。
    ...(body.duration != null ? { duration: body.duration } : {}),
    // 这三个字段一律"有什么发什么"，不补兜底值：否则被"参数自愈"摘掉之后仍会出现在请求里，
    // 上游继续报 unsupported parameter，重试就白做了。
    // 注意 aspect_ratio 原来会从 size 兜底重算，而 size 在生产里总是存在 —— 那等于摘了也没摘掉。
    // 调用方（candidatePayload）本来就会传 aspect_ratio，所以这个兜底是死代码，去掉即可。
    ...(body.aspect_ratio ? { aspect_ratio: String(body.aspect_ratio) } : {}),
    ...resolutionField,
    ...(body.generate_audio != null ? { generate_audio: body.generate_audio !== false } : {}),
    ...(body.reference_mode ? { reference_mode: body.reference_mode === 'frame' ? 'frame' : 'image' } : {}),
    ...(images.length ? { images: images.slice(0, 9) } : {}),
    ...(videoRefs.length ? { reference_videos: videoRefs.slice(0, 3) } : {}),
    ...(audioRefs.length ? { reference_audios: audioRefs.slice(0, 3) } : {}),
    ...(body.idempotency_key ? { idempotency_key: body.idempotency_key } : {}),
  };
}

function videoApiSubmitPayload(candidate, body) {
  return candidate.apiProtocol === VIDEO_API_PROTOCOL_NEW_API ? newApiVideoPayload(body, candidate) : body;
}

// 上游对个别参数不认时（例如报 "unsupported parameter seconds"），把这个参数摘掉重试，
// 不用为每个渠道维护能力表。名单只收"省略后会走上游默认值"的字段——model / prompt / images /
// reference_videos 这类删掉会改变语义甚至必然失败，绝不能进这个名单。
// idempotency_key 也在名单里：上游既然不认它，就说明该渠道本来就不做幂等，留着只会让提交整体失败。
const DROPPABLE_SUBMIT_PARAMS = new Set([
  'seconds', 'duration', 'size', 'aspect_ratio', 'generate_audio', 'reference_mode', 'idempotency_key', 'resolution',
]);
// 上限 = 上面名单里可能同时出现的数量（seconds/duration 互斥，其余可同时出现），保证能一路摘完。
const MAX_PARAM_DROPS = 7;

// 渠道已经明确拒绝过的参数，记在内存里：第一次发现要多付一次请求，之后同渠道直接不再发送，
// 避免每个镜头都先失败一次。进程重启后重新发现一次即可。
const rejectedParamsByChannel = new Map();
function rejectedParamsFor(channelId) {
  const key = String(channelId || 'unknown');
  if (!rejectedParamsByChannel.has(key)) rejectedParamsByChannel.set(key, new Set());
  return rejectedParamsByChannel.get(key);
}

// 参考素材字段的“改名自愈”：同一语义在不同网关叫法不同——New API 原生协议发
// images / reference_videos，而部分插件与上游只认 image_urls / video_urls。这类字段
// 删掉会改变语义（丢参考图 = 白花钱重生成），所以不能进 DROPPABLE，只能改名重试。
const MEDIA_FIELD_ALIASES = {
  images: 'image_urls',
  reference_videos: 'video_urls',
  reference_audios: 'audio_urls',
};

// 每个渠道学到的改名（from → to）：学到后该渠道后续提交直接沿用，不必每个镜头先失败一次。
const mediaFieldAliasesByChannel = new Map();
function mediaFieldAliasesFor(channelId) {
  const key = String(channelId || 'unknown');
  if (!mediaFieldAliasesByChannel.has(key)) mediaFieldAliasesByChannel.set(key, new Map());
  return mediaFieldAliasesByChannel.get(key);
}

// 错误里提到的字段名可能是未知/不支持/未识别，也可能套着一层 JSON 转义
// （如 ["error","unknown field \"duration\""]），统一取出来。
function reportedFieldName(error) {
  const text = `${error?.message || ''} ${error?.body || ''} ${error?.responseBody || ''}`.replace(/\\"/g, '"');
  const match = text.match(/unsupported\s+(?:parameter|field|param)[\s:：]*"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i)
    || text.match(/(?:unrecognized|unknown|invalid)\s+(?:parameter|field|param)[\s:：]*"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i)
    || text.match(/不支持(?:的)?参数[\s:：]*"?([a-zA-Z_][a-zA-Z0-9_]*)"?/);
  return (match ? match[1] : '').toLowerCase();
}

export function unsupportedParameterName(error) {
  const name = reportedFieldName(error);
  return DROPPABLE_SUBMIT_PARAMS.has(name) ? name : '';
}

export function renamableMediaField(error) {
  const name = reportedFieldName(error);
  return MEDIA_FIELD_ALIASES[name] ? name : '';
}

function applyMediaFieldAliases(payload, aliases) {
  if (!aliases || !aliases.size || !payload || typeof payload !== 'object') return payload;
  // multipart 体不是普通对象，改名要经过各自的构建函数，这里原样放行。
  if (typeof FormData !== 'undefined' && payload instanceof FormData) return payload;
  const renamed = { ...payload };
  for (const [from, to] of aliases) {
    if (!Object.prototype.hasOwnProperty.call(renamed, from)) continue;
    if (!Object.prototype.hasOwnProperty.call(renamed, to)) renamed[to] = renamed[from];
    delete renamed[from];
  }
  return renamed;
}

export function videoApiSize(aspectRatio = '16:9', resolution = '720p', baseUrl = DEFAULT_BASE_URL, builtIn, builtInChannel = '') {
  const normalizedResolution = String(resolution || '').trim().toLowerCase();
  const high = !(builtIn !== false && isBuiltInVideoApiBaseUrl(baseUrl))
    && normalizedResolution === '1080p';
  const map480 = {
    '16:9': '864x480',
    '9:16': '480x864',
    '4:3': '640x480',
    '3:4': '480x640',
    '1:1': '480x480',
    '21:9': '1120x480',
  };
  const map720 = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '960x720',
    '3:4': '720x960',
    '1:1': '720x720',
    '21:9': '1680x720',
  };
  const map1080 = {
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '4:3': '1440x1080',
    '3:4': '1080x1440',
    '1:1': '1080x1080',
    '21:9': '2560x1080',
  };
  const key = String(aspectRatio || '').trim();
  if (normalizedResolution === '480p') return map480[key] || '864x480';
  return (high ? map1080 : map720)[key] || (high ? '1920x1080' : '1280x720');
}

function mimeForFile(filePath, kind = '') {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (kind === 'audio') return 'audio/wav';
  if (kind === 'video') return 'video/mp4';
  return 'image/png';
}

function messageValue(value) {
  const compact = (text) => String(text || '')
    .replace(/data:[^"'\s]+/gi, '[inline data URL]')
    .slice(0, 800)
    .trim();
  if (!value) return '';
  if (typeof value === 'string') return compact(value);
  if (Array.isArray(value)) {
    // Go 风格网关会把错误序列化成 ["error","unknown field \"duration\""] 这类二元组，
    // 直接 JSON.stringify 会把转义引号原样甩给用户。抽里面的字符串拼回可读文案。
    const parts = value.filter((item) => typeof item === 'string' && item && item !== 'error');
    if (parts.length) return compact(parts.join(' '));
  }
  if (typeof value === 'object') {
    return compact(
      value.message || value.error || value.reason || value.msg || value.detail || ''
    ) || compact(JSON.stringify(value));
  }
  return compact(value);
}

async function mediaRefToUrl(value, kind, imageUpload = {}) {
  const raw = String(value && typeof value === 'object'
    ? (value.filePath || value.path || value.localPath || value.url || '')
    : (value || '')).trim();
  if (!raw) return '';
  if (/^https?:/i.test(raw)) return raw;
  if (imageUploadEnabled(imageUpload)) {
    if (kind === 'image') return uploadVideoApiMedia(value, imageUpload, kind);
    // 参考视频/音频也走图床（上游只收公网 URL）；图床吃不下大文件时回退到原来的内联 base64，
    // 不改变"本来就能用 base64"的渠道的行为。
    try {
      return await uploadVideoApiMedia(value, imageUpload, kind);
    } catch { /* 回退内联 */ }
  }
  if (/^data:/i.test(raw)) return raw;
  const stat = await fs.promises.stat(raw).catch(() => null);
  if (!stat?.isFile()) throw new Error(`${kind || 'media'} reference not found: ${raw}`);
  // 内联不做大小限制：参考图整份读进内存转 base64（约 1.33 倍体积），
  // 上限交给网关自己判（body 太大时它会回明确的 HTTP 错误），不再本地拦。
  const b64 = await fs.promises.readFile(raw, { encoding: 'base64' });
  return `data:${mimeForFile(raw, kind)};base64,${b64}`;
}

function normalizeMentionKind(value, name) {
  const kind = String(value || '').trim().toLowerCase();
  if (kind === 'audio' || kind === 'video' || kind === 'image') return kind;
  return /音频|声音|配音|voice|audio/i.test(String(name || '')) ? 'audio' : 'image';
}

function groupedMentionsByKind(mentions = []) {
  const out = { image: [], video: [], audio: [] };
  for (const raw of mentions || []) {
    const name = cleanText(raw?.name);
    const label = cleanText(raw?.displayName || raw?.label || raw?.fallbackText || name);
    if (!name && !label) continue;
    const kind = normalizeMentionKind(raw?.kind || raw?.type, name || label);
    out[kind === 'audio' ? 'audio' : (kind === 'video' ? 'video' : 'image')].push(raw);
  }
  return out;
}

function mediaLabelFromPath(filePath, kind, index) {
  const base = path.basename(String(filePath || ''), path.extname(String(filePath || ''))).trim();
  if (base) return base;
  if (kind === 'audio') return `音频${index}`;
  if (kind === 'video') return `视频${index}`;
  return `图片${index}`;
}

function referenceLabel(item, filePath, kind, index) {
  const label = item
    ? cleanText(item.displayName || item.label || item.fallbackText || item.name)
    : '';
  return label || mediaLabelFromPath(filePath, kind, index);
}

function referenceSlotDescription(label, kind) {
  const name = cleanText(label);
  if (!name) return '';
  if (kind === 'audio') return `${name.replace(/(?:的)?(?:音频|声音|配音|音色|voice|audio)$/i, '').trim() || name}的配音/音色参考`;
  if (kind === 'video') return `${name}视频参考`;
  return /参考图$/u.test(name) ? name : `${name}参考图`;
}

function buildReferencePromptPrefix(mentions = [], media = {}) {
  const grouped = groupedMentionsByKind(mentions);
  const images = Array.isArray(media.images) ? media.images : [];
  const videos = Array.isArray(media.videos) ? media.videos : [];
  const audios = Array.isArray(media.audios) ? media.audios : [];
  const lines = [];

  const imageTotal = Math.min(images.length || grouped.image.length, 9);
  for (let i = 0; i < imageTotal; i += 1) {
    const mention = grouped.image[i];
    const instruction = cleanText(mention?.referenceInstruction);
    const label = referenceLabel(mention, images[i], 'image', i + 1);
    const voice = cleanText(mention?.voice);
    const voiceSuffix = voice
      ? `，${label ? `${label}的` : ''}音色为「${voice}」，角色说话/低语时按此声音表演`
      : '';
    lines.push((instruction
      ? `@Image${i + 1} 是${instruction}`
      : `@Image${i + 1} 是${referenceSlotDescription(label, 'image')}`) + voiceSuffix);
  }

  const audioTotal = Math.min(audios.length || grouped.audio.length, 3);
  for (let i = 0; i < audioTotal; i += 1) {
    const label = referenceLabel(grouped.audio[i], audios[i], 'audio', i + 1);
    lines.push(`@Audio${i + 1} 这个是${referenceSlotDescription(label, 'audio')}`);
  }

  const videoTotal = Math.min(videos.length || grouped.video.length, 3);
  for (let i = 0; i < videoTotal; i += 1) {
    const label = referenceLabel(grouped.video[i], videos[i], 'video', i + 1);
    lines.push(`@Video${i + 1} 是${referenceSlotDescription(label, 'video')}`);
  }

  return lines.join('。');
}

function withReferencePrompt(prompt, prefix) {
  const cleanPrompt = String(prompt || '').trim();
  const cleanPrefix = String(prefix || '').trim();
  if (!cleanPrefix) return cleanPrompt;
  const separator = /[。！？.!?]$/.test(cleanPrefix) ? '\n\n' : '。\n\n';
  return `${cleanPrefix}${separator}${cleanPrompt}`.trim();
}

// 提交请求不能走内置 fetch：undici 每个请求都带着「5 分钟收不到响应头就 UND_ERR_HEADERS_TIMEOUT」的默认值，
// 而同步型网关是收完请求体、生成完成后才回包头（SUBMIT_TIMEOUT_MS 正为此放宽到 10 分钟），
// 十几 MB 参考图的上传也占掉同一段时间——结果就是还没到自己的超时就先被 undici 掐死。
// 这里直接用 node:http(s) 发请求，不设 socket 空闲超时，只由 AbortController 计时。
async function postJson(url, apiKey, body, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let requestBytes = 0;
  try {
    const serialized = JSON.stringify(body);
    requestBytes = Buffer.byteLength(serialized, 'utf8');
    const target = new URL(url);
    const response = await new Promise((resolve, reject) => {
      const request = (target.protocol === 'http:' ? http : https).request(target, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...extraHeaders,
          // Some gateway deployments mishandle chunked JSON bodies and surface
          // that as "Invalid json: unexpected EOF". Sending an explicit byte
          // length keeps the request framing unambiguous.
          'Content-Length': String(requestBytes),
        },
        signal: controller.signal,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({
          status: Number(res.statusCode) || 0,
          text: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      request.on('error', reject);
      request.end(serialized);
    });
    let json;
    try { json = response.text ? JSON.parse(response.text) : {}; } catch { json = { raw: response.text }; }
    if (response.status < 200 || response.status >= 300) {
      const detail = messageValue(json?.error || json?.message || json?.raw);
      const message = /invalid\s+json.*unexpected\s+eof/i.test(detail)
        ? `视频 API 不接受 JSON 请求体（unexpected EOF，请求体约 ${(requestBytes / 1024 / 1024).toFixed(1)} MB）`
        : (detail || `HTTP ${response.status}`);
      const err = new Error(message);
      err.status = response.status;
      err.requestBytes = requestBytes;
      if (/invalid\s+json.*unexpected\s+eof/i.test(detail)) err.code = 'VIDEO_API_REQUIRES_MULTIPART';
      throw err;
    }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`视频 API 请求超时(${Math.round(timeoutMs / 1000)}s)`);
    // 自己构造的 HTTP 错误带 status/code，必须原样抛出（postVideoRequest 靠 code 决定是否降级 multipart）
    if (e?.status) throw e;
    // node:http 的底层原因挂在 error.code 上（不为 fetch 的 error.cause），转成 cause 让报错文案保持一致
    throw new Error(
      `视频 API 请求失败：${describeFetchError(e.code ? new Error(e.message, { cause: { code: e.code } }) : e)}（请求体约 ${(requestBytes / 1024 / 1024).toFixed(1)} MB）`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function multipartVideoBody(body = {}) {
  const form = new FormData();
  form.append('model', String(body.model || ''));
  form.append('prompt', String(body.prompt || ''));
  // 不补默认值：被"参数自愈"摘掉的字段必须真的不出现在请求里，
  // 否则上游仍会报 unsupported parameter，重试白费。
  if (body.duration != null && body.duration !== '') form.append('duration', String(body.duration));
  if (body.seconds != null) form.append('seconds', String(body.seconds));
  if (body.aspect_ratio) form.append('aspect_ratio', String(body.aspect_ratio));
  if (body.reference_mode) form.append('reference_mode', String(body.reference_mode));
  if (body.generate_audio != null) form.append('generate_audio', String(body.generate_audio));
  if (body.idempotency_key) form.append('idempotency_key', String(body.idempotency_key));
  const sizeMatch = String(body.size || '').match(/^(\d+)x(\d+)$/i);
  if (sizeMatch) {
    form.append('width', sizeMatch[1]);
    form.append('height', sizeMatch[2]);
  }
  const images = Array.isArray(body.images)
    ? body.images.filter(Boolean)
    : (Array.isArray(body.image_refs) ? body.image_refs.filter(Boolean) : []);
  if (Array.isArray(body.images)) images.slice(0, 9).forEach((image) => form.append('image', String(image)));
  else if (images[0]) form.append('image', String(images[0]));
  const referenceVideos = Array.isArray(body.reference_videos) ? body.reference_videos.filter(Boolean) : [];
  const referenceAudios = Array.isArray(body.reference_audios) ? body.reference_audios.filter(Boolean) : [];
  referenceVideos.slice(0, 3).forEach((video) => form.append('reference_videos', String(video)));
  referenceAudios.slice(0, 3).forEach((audio) => form.append('reference_audios', String(audio)));
  const metadata = {};
  if (images.length > 1) metadata.image_refs = images;
  if (Array.isArray(body.audio_refs) && body.audio_refs.length) metadata.audio_refs = body.audio_refs;
  if (Array.isArray(body.video_refs) && body.video_refs.length) metadata.video_refs = body.video_refs;
  if (Object.keys(metadata).length) form.append('metadata', JSON.stringify(metadata));
  return form;
}

async function postMultipartVideo(url, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      body: multipartVideoBody(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!resp.ok) {
      const err = new Error(messageValue(json?.error || json?.message || json?.raw) || `HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`视频 API 请求超时(${Math.round(timeoutMs / 1000)}s)`);
    if (e?.status) throw e;
    throw new Error(`视频 API 请求失败（multipart）：${describeFetchError(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function postVideoRequest(url, apiKey, body, timeoutMs, extraHeaders = {}) {
  try {
    return await postJson(url, apiKey, body, timeoutMs, extraHeaders);
  } catch (error) {
    if (error?.code !== 'VIDEO_API_REQUIRES_MULTIPART') throw error;
    return postMultipartVideo(url, apiKey, body, timeoutMs);
  }
}

async function getJson(url, apiKey, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
      signal: controller.signal,
    });
    const text = await resp.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!resp.ok) {
      const err = new Error(messageValue(json?.error || json?.message || json?.raw) || `HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`视频 API 查询超时(${Math.round(timeoutMs / 1000)}s)`);
    if (e?.status) throw e;
    throw new Error(`视频 API 查询失败：${describeFetchError(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

function unwrapData(json) {
  if (Array.isArray(json?.data) && json.data[0] && typeof json.data[0] === 'object') return json.data[0];
  if (json?.data && !Array.isArray(json.data) && typeof json.data === 'object') return json.data;
  return json || {};
}

function submitIdFromJson(json) {
  const data = unwrapData(json);
  return String(
    data.id || data.video_id || data.videoId || data.jobId || data.job_id || data.taskid || data.task_id || data.taskId ||
    data.request_id || data.requestId || data.submit_id || data.submitId ||
    json?.id || json?.jobId || json?.job_id || json?.taskid || json?.task_id || json?.submit_id || ''
  ).trim();
}

function statusFromJson(json) {
  const data = unwrapData(json);
  return String(data.status || data.state || data.gen_status || data.genStatus || json?.status || '').trim().toLowerCase();
}

function failReasonFromJson(json) {
  const data = unwrapData(json);
  // `message` is commonly used for harmless progress text such as
  // "processing" or "queued". Only explicit error fields belong here; the
  // normalizer below separately recognizes failure wording in a message.
  const explicit = data.fail_reason || data.failReason || data.errorMessage || data.error_message || data.error || json?.errorMessage || json?.error_message || json?.error;
  if (!explicit) return '';
  if (typeof explicit === 'object') {
    const detail = messageValue(explicit);
    return /fail|failed|error|cancel|canceled|cancelled/i.test(detail) ? detail : '';
  }
  const detail = messageValue(explicit);
  // 有的网关成功后仍然把 fail_reason 填成结果预览链接（maxforai 的 dola 就是），
  // 纯链接不是失败原因，不能让它把成功判成失败。
  return /^https?:\/\/\S+$/i.test(detail) ? '' : detail;
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

function normalizeVideoResult(json) {
  const status = statusFromJson(json);
  const data = unwrapData(json);
  const message = messageValue(data.message || json?.message);
  const progress = progressFromJson(json);
  const isDone = /success|succeed|successful|done|complete|completed|finish|finished|ready|available/i.test(status);
  const fail = failReasonFromJson(json);
  // 状态明确是成功时以成功为准：maxforai 的 dola 成功后仍会在 fail_reason 里放结果预览链接，
  // 让这个字段优先会把成功判成失败，链接还会被当成「失败原因」显示出来。
  if (!isDone && (/fail|failed|error|cancel|canceled|cancelled/i.test(status) || fail || (
    !/queued|queue|running|processing|pending/i.test(status)
    && /fail|failed|error|cancel|canceled|cancelled/i.test(message)
  ))) {
    return { status: 'failed', fail: fail || message || '视频 API 任务失败', progress: progress ?? 100 };
  }
  const videoUrls = candidateVideoUrls(json, { includeGenericUrl: isDone });
  if (videoUrls.length) return { status: 'done', videoUrl: videoUrls[0], videoUrls, progress: 100 };
  if (isDone) return { status: 'done_no_url', progress: 100 };
  return { status: 'queued', progress };
}

// 渠道熔断表：渠道连续提交失败达到阈值后临时熔断（跳过该渠道），冷却后半价探测恢复。
// 解决：渠道宕机时每个镜头都要耗完整超时才切换的问题。
const channelBreaker = new Map(); // channelId -> { failures, openUntil }
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

function breakerState(channelId) {
  return channelBreaker.get(String(channelId || '')) || { failures: 0, openUntil: 0 };
}

function breakerRecordFailure(channelId, reason) {
  const id = String(channelId || '');
  if (!id) return;
  const state = breakerState(id);
  const failures = state.failures + 1;
  const openUntil = failures >= BREAKER_THRESHOLD ? Date.now() + BREAKER_COOLDOWN_MS : 0;
  channelBreaker.set(id, { failures, openUntil });
  if (openUntil) console.warn(`[video-api] 渠道「${id}」连续失败 ${failures} 次，熔断 10 分钟（原因：${reason}）`);
}

function breakerRecordSuccess(channelId) {
  const id = String(channelId || '');
  if (id && channelBreaker.has(id)) channelBreaker.delete(id);
}

function breakerIsOpen(channelId) {
  const state = breakerState(channelId);
  return state.openUntil > Date.now();
}

export function channelBreakerSnapshot() {
  return [...channelBreaker.entries()].map(([id, s]) => ({
    channelId: id,
    failures: s.failures,
    open: s.openUntil > Date.now(),
    cooldownRemainingSec: s.openUntil > Date.now() ? Math.round((s.openUntil - Date.now()) / 1000) : 0,
  }));
}

export async function submitVideos({ apiConfig, shots = [], onProgress, onSubmitProgress, model, resolution, concurrency, style } = {}) {
  const channelCandidates = [];
  let configError = null;
  for (const channel of resolveVideoApiCandidates(apiConfig || {})) {
    try {
      channelCandidates.push({
        ...requireApiConfig(channel),
        channelId: channel.channelId || channel.id || '',
        channelName: channel.channelName || channel.name || '视频 API',
        retryCount: Math.max(0, Math.min(3, Number(channel.retryCount) || 0)),
      });
    } catch (error) {
      configError = error;
    }
  }
  if (!channelCandidates.length) throw configError || new Error('请先配置可用的视频 API 渠道');
  const cfg = channelCandidates[0];
  // 渠道强制要公网素材（内置网关 / 飞拓跨界）但图床没开时，自动回退到「免费图床」：
  // 否则本地参考图会被内联成 base64，上游直接 400（"image_urls" must be a public http(s) URL）。
  const requiresPublicMedia = channelCandidates.some((candidate) => (
    isBuiltInGateway(candidate.baseUrl) || isFeituoProtocol(candidate.apiProtocol)
  ));
  const autoFreeHost = requiresPublicMedia && !imageUploadEnabled(cfg.imageUpload);
  const imageUpload = autoFreeHost
    ? { ...normalizeVideoImageUpload(cfg.imageUpload), provider: 'free', freeProvider: 'auto' }
    : cfg.imageUpload;
  if (autoFreeHost) {
    onProgress?.('图床未启用，但当前渠道只接受公网素材，已自动改用「免费图床」上传参考图（可在“设置 → 图床”改成自己的图床）');
  }
  const submitModel = normalizeModel(model || cfg.model);
  // 肖像保护绕过：仅写实风格（真人参考图才触发肖像保护）；风格为空时按需生效
  const portraitBypassActive = apiConfig?.portraitBypass === true
    && (!style || String(style).trim() === 'realistic');
  const limit = Math.min(normalizeSubmitConcurrency(concurrency || apiConfig?.apiConcurrency), Math.max(1, shots.length));
  const results = new Array(shots.length);
  // 并发分流：槽位按 index % 渠道数 轮询绑定渠道（如并发 2 + 2 渠道 = 各走一半请求/费用）；
  // 绑定渠道失败仍会 failover 到其余渠道，不会因分流降低成功率。
  const slots = Array.from({ length: limit }, (_, index) => ({
    accountId: `video-api-${index + 1}`,
    accountName: '视频 API',
    model: submitModel,
    modelLabel: submitModel,
    state: 'idle',
    currentShot: null,
    error: '',
    channelIndex: channelCandidates.length ? index % channelCandidates.length : 0,
  }));
  let cursor = 0;
  let processed = 0;

  const emit = (message) => {
    const settled = results.filter(Boolean);
    try {
      onSubmitProgress?.({
        total: shots.length,
        processed,
        submitted: settled.filter((r) => r.ok && r.submitId).length,
        failed: settled.filter((r) => !r.ok).length,
        message,
        slots: slots.map((slot) => ({ ...slot, currentShot: slot.currentShot ? { ...slot.currentShot } : null })),
      });
    } catch { /* ignore */ }
  };

  async function submitOne(shot, index, slot) {
    slot.state = 'submitting';
    slot.currentShot = { shotNo: shot.shotNo };
    const startIndex = Math.max(0, channelCandidates.findIndex((c) => c.channelId === channelCandidates[slot.channelIndex % channelCandidates.length]?.channelId));
    slot.error = '';
    emit(`正在提交镜头 ${shot.shotNo} 到视频 API...`);
    try {
      const images = (shot.refImagePaths || []).slice(0, 9);
      const audios = (shot.refAudioPaths || []).slice(0, 3);
      const videos = (shot.refVideoPaths || []).slice(0, 3);
      // 肖像保护绕过开启时，先把本地参考图做镜像拼接再走正常上传/内联链路
      const imageSources = portraitBypassActive
        ? await Promise.all(images.map((item) => perturbPortraitFile(item)))
        : images;
      const prefix = buildReferencePromptPrefix(shot.mentions, { images, audios, videos });
      if (images.length && imageUploadEnabled(imageUpload)) {
        emit(`正在上传镜头 ${shot.shotNo} 的本地参考图...`);
      }
      const commonPayload = {
        prompt: withReferencePrompt(withStylePrefix(shot.prompt, style), prefix),
        image_refs: (await Promise.all(imageSources.map((item) => mediaRefToUrl(item, 'image', imageUpload)))).filter(Boolean),
        audio_refs: (await Promise.all(audios.map((item) => mediaRefToUrl(item, 'audio', imageUpload)))).filter(Boolean),
        video_refs: (await Promise.all(videos.map((item) => mediaRefToUrl(item, 'video', imageUpload)))).filter(Boolean),
        idempotency_key: String(shot.idempotencyKey || `yanzhi-${Date.now().toString(36)}-${String(shot.shotNo).replace(/[^a-zA-Z0-9_-]/g, '-')}-${Math.random().toString(36).slice(2, 10)}`),
      };
      if (isFeituoProtocol(cfg.apiProtocol)) validateFeituoImageReferences(commonPayload.image_refs);
      let submitted = null;
      let lastError = null;
      // 提交请求可能已被上游受理、但响应没拿回来（网关不幂等，不能重交）。
      let outcomeUnknown = false;
      // 从本槽位绑定的渠道开始轮转（实现分流），熔断中的渠道排到最后兜底
      const startId = channelCandidates[slot.channelIndex % channelCandidates.length]?.channelId;
      const rotated = [
        ...channelCandidates.slice(startIndex), ...channelCandidates.slice(0, startIndex),
      ];
      const orderedCandidates = [
        ...rotated.filter((c) => !breakerIsOpen(c.channelId)),
        ...rotated.filter((c) => breakerIsOpen(c.channelId)),
      ];
      for (const candidate of orderedCandidates) {
        const builtIn = typeof candidate.builtIn === 'boolean'
          ? candidate.builtIn
          : isBuiltInVideoApiBaseUrl(candidate.baseUrl);
        const builtInChannel = String(candidate.builtInChannel || '').trim();
        const isFirstBuiltInChannel = builtIn && builtInChannel !== BUILT_IN_VIDEO_CHANNEL_2;
        const requestedModel = normalizeModel(shot.model || model || candidate.model);
        const candidatePayload = {
          ...commonPayload,
          model: (isFirstBuiltInChannel && requestedModel === 'sd2-c8' ? DEFAULT_BUILT_IN_VIDEO_API_MODEL : requestedModel)
            || (builtInChannel === BUILT_IN_VIDEO_CHANNEL_2
              ? SECOND_BUILT_IN_VIDEO_API_MODEL
              : (builtIn
                ? DEFAULT_BUILT_IN_VIDEO_API_MODEL
                : (isBuiltInGateway(candidate.baseUrl) ? DEFAULT_VIDEO_GATEWAY_API_MODEL : ''))),
          duration: videoApiDuration(shot.duration, candidate.baseUrl, builtIn, builtInChannel),
          aspect_ratio: shot.aspectRatio || '16:9',
          generate_audio: shot.generateAudio !== false,
          reference_mode: shot.referenceMode === 'frame' ? 'frame' : 'image',
          size: builtIn
            ? videoApiSize(shot.aspectRatio, '720p', candidate.baseUrl, builtIn, builtInChannel)
            : (shot.size || videoApiSize(shot.aspectRatio, shot.resolution || resolution, candidate.baseUrl, builtIn, builtInChannel)),
        };
        onProgress?.(`提交视频 API：${candidate.channelName} / ${candidatePayload.model} ${candidatePayload.size}，${candidatePayload.image_refs.length} 图/${candidatePayload.audio_refs.length} 音频/${candidatePayload.video_refs.length} 视频`);
        if (builtIn && candidatePayload.audio_refs.length && !candidatePayload.image_refs.length && !candidatePayload.video_refs.length) {
          lastError = new Error('内置 New API 的音频参考必须搭配至少一张图片或一条视频参考');
          continue;
        }
        // 内置网关只收公网素材：本地图片没走图床时在这里就给出中文提示，而不是让上游回英文原文。
        try {
          assertPublicMediaReferences(candidate, candidatePayload);
        } catch (error) {
          lastError = error;
          continue;
        }
        let networkRetriesUsed = 0;
        // 允许的额外重试次数（累加，不是每次重算）：渠道自带的 retryCount + 连接类网络错误最多补 3 次。
        let allowedRetries = candidate.retryCount;
        // 本渠道已经被摘掉的参数（每个参数只摘一次，最多 3 个）
        const droppedParams = new Set();
        // 该渠道历史上明确拒绝过的参数：直接不发，省掉"每个镜头先失败一次"的开销。
        const knownRejected = rejectedParamsFor(candidate.channelId);
        if (knownRejected.size && candidatePayload && typeof candidatePayload === 'object') {
          for (const name of knownRejected) delete candidatePayload[name];
        }
        for (let attempt = 0; ; attempt += 1) {
          try {
            const isFeituo = isFeituoProtocol(candidate.apiProtocol);
            const requestPayload = applyMediaFieldAliases(
              isFeituo
                ? feituoVideoPayload(candidatePayload)
                : videoApiSubmitPayload(candidate, candidatePayload),
              mediaFieldAliasesFor(candidate.channelId),
            );
            const submitUrl = isFeituo
              ? feituoGenerateUrl(candidate.baseUrl)
              : videoApiVideosUrl(candidate.baseUrl, candidate.apiProtocol, builtIn, builtInChannel);
            const json = await postVideoRequest(
              submitUrl,
              candidate.apiKey,
              requestPayload,
              SUBMIT_TIMEOUT_MS,
              isFeituo ? feituoExtraHeaders() : {},
            );
            const submitId = submitIdFromJson(json);
            if (!submitId) throw new Error('视频 API 响应缺少任务 id');
            breakerRecordSuccess(candidate.channelId);
            submitted = { candidate, json, submitId, payload: candidatePayload };
            break;
          } catch (error) {
            lastError = error;
            // 参考素材字段只改名、不删除：删掉等于丢参考图（语义变了、钱白花）。
            const mediaField = renamableMediaField(error);
            const mediaAliases = mediaFieldAliasesFor(candidate.channelId);
            if (mediaField && !mediaAliases.has(mediaField)) {
              const target = MEDIA_FIELD_ALIASES[mediaField];
              mediaAliases.set(mediaField, target);
              onProgress?.(`${candidate.channelName} 不认参考素材字段 ${mediaField}，改发 ${target} 重试（该渠道后续沿用）`);
              await new Promise((resolve) => setTimeout(resolve, 300));
              continue;
            }
            // 上游明确说某个参数不认识 → 摘掉它再来一次。这比维护渠道能力表可靠，
            // 也不会把整个提交废掉。摘除动作会计入日志，便于排查。
            const unsupported = unsupportedParameterName(error);
            if (unsupported && !droppedParams.has(unsupported) && droppedParams.size < MAX_PARAM_DROPS
              && candidatePayload && typeof candidatePayload === 'object') {
              droppedParams.add(unsupported);
              knownRejected.add(unsupported);
              delete candidatePayload[unsupported];
              onProgress?.(`${candidate.channelName} 不认参数 ${unsupported}，已摘除后重试（该渠道后续不再发送此参数）`);
              await new Promise((resolve) => setTimeout(resolve, 300));
              continue;
            }
            // 响应没拿回来（连接被重置/读中断/等待响应超时）：上游可能已经建单。
            // 该网关不幂等，重交只会再建一个任务（重复计费），所以停止重交并如实标记为"结果未知"。
            if (isSubmitResultUnknownError(error)) {
              outcomeUnknown = true;
              onProgress?.(`${candidate.channelName} 提交响应被中断，且该网关不幂等，已停止重交（任务可能已在上游创建）`);
              break;
            }
            // 5xx / 408 这类「有响应但结果不明」同样不能重交：上游可能在报错前已经建单。
            if (isSubmitOutcomeUnknownStatus(error)) {
              outcomeUnknown = true;
              onProgress?.(`${candidate.channelName} 提交返回 ${Number(error.status)}，无法确认上游是否已建单；该网关不幂等，已停止重交`);
              break;
            }
            // 只有连接阶段的失败（请求根本没发出去）才安全重交。
            const networkError = isSubmitRetryableNetworkError(error);
            if (networkError && networkRetriesUsed < NETWORK_RETRY_DELAYS_MS.length) {
              networkRetriesUsed += 1;
              allowedRetries += 1;
            }
            if (attempt >= allowedRetries) break;
            const delay = networkError
              ? NETWORK_RETRY_DELAYS_MS[Math.max(0, networkRetriesUsed - 1)]
              : Math.min(4000, 500 * (2 ** attempt));
            if (networkError) onProgress?.(`${candidate.channelName} 连接失败，${delay}ms 后重试（第 ${networkRetriesUsed}/${NETWORK_RETRY_DELAYS_MS.length} 次）`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
        // 结果未知（可能已受理）时不再 failover 到其它渠道，否则会在别的渠道再建一个任务。
        if (outcomeUnknown) break;
        if (submitted) break;
        // 该渠道本轮重试耗尽仍未提交成功 → 记一次失败（连续 3 次触发熔断）
        breakerRecordFailure(candidate.channelId, lastError?.message || '提交失败');
      }
      if (!submitted) {
        const failure = lastError || new Error('视频 API 所有渠道均提交失败');
        if (outcomeUnknown) failure.submitOutcomeUnknown = true;
        throw failure;
      }
      const immediate = normalizeVideoResult(submitted.json);
      results[index] = {
        shotNo: shot.shotNo,
        ok: true,
        submitId: submitted.submitId,
        historyId: submitted.submitId,
        videoUrl: immediate.status === 'done' ? immediate.videoUrl : '',
        videoUrls: immediate.status === 'done' ? immediate.videoUrls : [],
        channelId: submitted.candidate.channelId,
        channelName: submitted.candidate.channelName,
        model: submitted.payload.model,
      };
      processed++;
      slot.state = 'idle';
      slot.currentShot = null;
      emit(`镜头 ${shot.shotNo} 已提交视频 API`);
    } catch (e) {
      const outcomeUnknown = e.submitOutcomeUnknown === true;
      results[index] = {
        shotNo: shot.shotNo,
        ok: false,
        error: e.message,
        code: e.code,
        submitOutcomeUnknown: outcomeUnknown,
      };
      processed++;
      slot.state = 'idle';
      slot.currentShot = null;
      slot.error = e.message;
      emit(outcomeUnknown
        ? `镜头 ${shot.shotNo} 提交结果未知：${e.message}`
        : `镜头 ${shot.shotNo} 提交失败：${e.message}`);
    }
  }

  emit(`开始并发提交视频 API（${limit} 路）...`);
  await Promise.all(slots.map(async (slot) => {
    while (cursor < shots.length) {
      const index = cursor++;
      await submitOne(shots[index], index, slot);
    }
  }));
  emit(`视频 API 提交完成：${results.filter((r) => r?.ok).length}/${shots.length}`);
  return results.filter(Boolean);
}

export async function fetchVideoResults({ apiConfig, submitIds = [] } = {}) {
  if (!submitIds.length) return {};
  const cfg = requireApiConfig(apiConfig || {});
  const out = {};
  const isFeituo = isFeituoProtocol(cfg.apiProtocol);
  const base = videoApiVideosUrl(cfg.baseUrl, cfg.apiProtocol, cfg.builtIn, cfg.builtInChannel);
  const ids = [...new Set(submitIds.map((submitId) => String(submitId || '').trim()).filter(Boolean))];
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          // 飞拓跨界：status 是独立端点且响应里 videoUrl 字段名不同，包装成通用结构
          const json = isFeituo
            ? await getJson(feituoStatusUrl(cfg.baseUrl, id), cfg.apiKey, QUERY_TIMEOUT_MS, feituoExtraHeaders())
            : await getJson(`${base}/${encodeURIComponent(id)}`, cfg.apiKey, QUERY_TIMEOUT_MS);
          const normalized = isFeituo
            ? normalizeVideoResult({ ...json, video_url: json.videoUrl, message: json.errorMessage || json.message })
            : normalizeVideoResult(json);
          out[id] = normalized;
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        }
      }
      if (lastError) out[id] = { status: 'queued', note: lastError.message };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, () => worker()));
  return out;
}

export function normalizeVideoApiModel(model) {
  return normalizeModel(model);
}

export function defaultVideoApiBaseUrl() {
  return DEFAULT_BASE_URL;
}
