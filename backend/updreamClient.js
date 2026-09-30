import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { createTempDir, ffmpegPath } from './config.js';
import { candidateVideoUrls } from './videoCandidates.js';

const execFileAsync = promisify(execFile);

export const UPDREAM_DEFAULT_BASE_URL = 'https://www.updream.cn/api';
const UPDREAM_VIDEO_MODEL_CAPABILITIES = Object.freeze({
  'sed2-fast': Object.freeze({
    resolutions: ['480p', '720p', '1080p', '2k', '4k'],
    defaultResolution: '480p',
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    generateAudio: true,
    supportsAudio: true,
  }),
  sed2: Object.freeze({
    resolutions: ['480p', '720p', '1080p', '4k'],
    defaultResolution: '480p',
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    generateAudio: true,
    supportsAudio: true,
  }),
  'sed2-5': Object.freeze({
    resolutions: ['480p', '720p'],
    defaultResolution: '480p',
    minDuration: 4,
    maxDuration: 30,
    defaultDuration: 5,
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    generateAudio: true,
    supportsAudio: true,
  }),
  'hailuo-h3': Object.freeze({
    resolutions: ['768P', '2K'],
    defaultResolution: '2K',
    minDuration: 5,
    maxDuration: 15,
    defaultDuration: 5,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    generateAudio: false,
    supportsAudio: false,
  }),
  'wan-3.0': Object.freeze({
    resolutions: ['480P', '720P', '1080P'],
    defaultResolution: '480P',
    minDuration: 2,
    maxDuration: 30,
    defaultDuration: 5,
    maxImages: 10,
    maxVideos: 5,
    maxAudios: 0,
    generateAudio: true,
    supportsAudio: false,
    supportsBitrateMode: false,
  }),
});
export const UPDREAM_MODELS = Object.freeze(Object.keys(UPDREAM_VIDEO_MODEL_CAPABILITIES));
export const UPDREAM_DEFAULT_IMAGE_MODEL = 'cheap-b-2';

const UPDREAM_IMAGE_SIZE_BY_RATIO = Object.freeze({
  '1:1': { width: 1024, height: 1024 },
  '2:1': { width: 1152, height: 576 },
  '2:3': { width: 768, height: 1152 },
  '3:2': { width: 1152, height: 768 },
  '3:4': { width: 768, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '4:5': { width: 896, height: 1120 },
  '5:4': { width: 1120, height: 896 },
  '9:16': { width: 576, height: 1024 },
  '16:9': { width: 1024, height: 576 },
  '21:9': { width: 1344, height: 576 },
  '9:21': { width: 576, height: 1344 },
});

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const UPDREAM_CANVAS_COLUMNS = 6;
const UPDREAM_CANVAS_COLUMN_GAP = 440;
const UPDREAM_CANVAS_ROW_GAP = 280;
const UPDREAM_EPISODE_GAP = 320;
const UPDREAM_IMAGE_CANVAS_CELL_SIZE = 520;
const updreamProjectEnsurePromises = new Map();
const updreamImageProjectLocks = new Map();
const updreamImageProjectNextIndexes = new Map();
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
};

export class UpDreamError extends Error {
  constructor(message, { status = 0, code = '', detail = null } = {}) {
    super(message);
    this.name = 'UpDreamError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function cleanBaseUrl(value) {
  const raw = String(value || UPDREAM_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return raw || UPDREAM_DEFAULT_BASE_URL;
}

function compactMessage(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 800).trim();
  if (typeof value === 'object') {
    return compactMessage(value.detail || value.message || value.error || value.reason)
      || JSON.stringify(value).slice(0, 800);
  }
  return String(value).slice(0, 800);
}

function normalizeProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.max(0, Math.min(100, Math.round(number <= 1 ? number * 100 : number)));
}

function unwrap(value) {
  if (value?.data && typeof value.data === 'object' && !Array.isArray(value.data)) return value.data;
  return value || {};
}

function firstValue(value, keys = []) {
  const queue = [value];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const key of keys) {
      if (item[key] !== undefined && item[key] !== null && item[key] !== '') return item[key];
    }
    for (const child of Object.values(item)) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return '';
}

export function updreamVideoNodeLayout({ episodeId, shotNo } = {}, index = 0) {
  const shotNumber = Number(shotNo);
  const layoutIndex = Number.isInteger(shotNumber) && shotNumber > 0 ? shotNumber - 1 : Math.max(0, index);
  const episodeNumber = Number(episodeId);
  const episodeIndex = Number.isInteger(episodeNumber) && episodeNumber > 0 ? episodeNumber - 1 : 0;
  const episodeWidth = (UPDREAM_CANVAS_COLUMNS * UPDREAM_CANVAS_COLUMN_GAP) + UPDREAM_EPISODE_GAP;
  return {
    x: 100 + (episodeIndex * episodeWidth) + ((layoutIndex % UPDREAM_CANVAS_COLUMNS) * UPDREAM_CANVAS_COLUMN_GAP),
    y: 100 + (Math.floor(layoutIndex / UPDREAM_CANVAS_COLUMNS) * UPDREAM_CANVAS_ROW_GAP),
  };
}

export function updreamImageNodeLayout(index = 0) {
  const parsedIndex = Math.floor(Number(index));
  const layoutIndex = Number.isFinite(parsedIndex) ? Math.max(0, parsedIndex) : 0;
  return {
    x: 100 + ((layoutIndex % UPDREAM_CANVAS_COLUMNS) * UPDREAM_IMAGE_CANVAS_CELL_SIZE),
    y: 100 + (Math.floor(layoutIndex / UPDREAM_CANVAS_COLUMNS) * UPDREAM_IMAGE_CANVAS_CELL_SIZE),
  };
}

function updreamCanvasNodes(value) {
  const data = unwrap(value);
  const nodes = Array.isArray(data)
    ? data
    : (Array.isArray(data.nodes)
      ? data.nodes
      : (Array.isArray(data.items) ? data.items : []));
  return nodes.filter((node) => node && typeof node === 'object');
}

function updreamImageCanvasNodes(value) {
  return updreamCanvasNodes(value)
    .filter((node) => {
      if (node.is_deleted === true || node.isDeleted === true || node.deleted_at || node.deletedAt) return false;
      const type = String(node.node_type || node.nodeType || node.type || node.node_config?.mode || '').toLowerCase();
      return type === 'image';
    })
    .sort((left, right) => {
      const leftCreated = String(left.created_at || left.createdAt || '');
      const rightCreated = String(right.created_at || right.createdAt || '');
      const createdOrder = leftCreated.localeCompare(rightCreated);
      if (createdOrder) return createdOrder;
      const leftId = String(firstValue(left, ['node_id', 'nodeId', 'id']) || '');
      const rightId = String(firstValue(right, ['node_id', 'nodeId', 'id']) || '');
      return leftId.localeCompare(rightId);
    });
}

function updreamImagePositionUpdates(nodes = []) {
  return nodes.map((node, index) => {
    const id = String(firstValue(node, ['node_id', 'nodeId', 'id']) || '').trim();
    if (!id) return null;
    const position = updreamImageNodeLayout(index);
    return Number(node.x) === position.x && Number(node.y) === position.y
      ? null
      : { id, ...position };
  }).filter(Boolean);
}

async function runWithUpdreamImageProjectLock(projectId, worker) {
  const key = String(projectId || '').trim();
  const previous = updreamImageProjectLocks.get(key) || Promise.resolve();
  const queued = previous.catch(() => {}).then(worker);
  updreamImageProjectLocks.set(key, queued);
  try {
    return await queued;
  } finally {
    if (updreamImageProjectLocks.get(key) === queued) updreamImageProjectLocks.delete(key);
  }
}

function firstImageUrl(value) {
  const queue = [{ value, key: '' }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    const item = current.value;
    if (!item || seen.has(item)) continue;
    if (typeof item === 'string') {
      if (/^https?:\/\//i.test(item) && !/\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(item)) {
        if (/\.(?:png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i.test(item) || /image|img|result|url|download/i.test(current.key)) {
          return item;
        }
      }
      continue;
    }
    if (typeof item !== 'object') continue;
    seen.add(item);
    for (const key of ['image_url', 'imageUrl', 'download_url', 'downloadUrl', 'url']) {
      const candidate = item[key];
      if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate) && !/\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(candidate)) {
        return candidate;
      }
    }
    for (const [key, child] of Object.entries(item)) queue.push({ value: child, key });
  }
  return '';
}

function normalizeModel(value) {
  const model = String(value || '').trim();
  if (['wan3.0-video', 'wan3.0', 'wan_3.0', 'Wan 3.0'].includes(model)) return 'wan-3.0';
  return UPDREAM_MODELS.includes(model) ? model : 'sed2-fast';
}

function updreamVideoCapabilities(value) {
  return UPDREAM_VIDEO_MODEL_CAPABILITIES[normalizeModel(value)];
}

function normalizeAspectRatio(value) {
  const ratio = String(value || '').trim();
  return ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'].includes(ratio) ? ratio : '16:9';
}

function normalizeImageAspectRatio(value) {
  const ratio = String(value || '').trim();
  return UPDREAM_IMAGE_SIZE_BY_RATIO[ratio] ? ratio : '16:9';
}

export function updreamImageDimensions(value) {
  const ratio = normalizeImageAspectRatio(value);
  return { ratio, ...UPDREAM_IMAGE_SIZE_BY_RATIO[ratio] };
}

function updreamImageNodeDimensions(value) {
  const { width, height } = updreamImageDimensions(value);
  const scale = 200 / Math.min(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function normalizeResolution(value, model) {
  const capabilities = updreamVideoCapabilities(model);
  const resolution = String(value || '').trim().toLowerCase();
  return capabilities.resolutions.find((item) => item.toLowerCase() === resolution)
    || capabilities.defaultResolution;
}

function normalizeDuration(value, model) {
  const capabilities = updreamVideoCapabilities(model);
  const duration = Math.round(Number(value));
  return Number.isFinite(duration)
    ? Math.max(capabilities.minDuration, Math.min(capabilities.maxDuration, duration))
    : capabilities.defaultDuration;
}

function cleanStringList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

export function normalizeUpdreamImageModels(value = {}) {
  const data = unwrap(value);
  const source = Array.isArray(data.models) ? data.models : [];
  const seen = new Set();
  const models = source.map((item) => {
    const modelValue = String(item?.value || item?.model_name || item?.modelName || '').trim();
    if (!modelValue || seen.has(modelValue) || item?.supports_image === false) return null;
    seen.add(modelValue);
    return {
      value: modelValue,
      label: String(item?.label || item?.name || modelValue).trim() || modelValue,
      maxReferenceImages: Math.max(0, Number(item?.max_reference_images) || 0),
      minImages: Math.max(1, Number(item?.min_images) || 1),
      maxImages: Math.max(1, Number(item?.max_images) || 1),
      ratios: cleanStringList(item?.ratios),
      defaultRatio: String(item?.default_ratio || '').trim(),
      resolutions: cleanStringList(item?.resolutions),
      defaultResolution: String(item?.default_resolution || '').trim(),
      qualities: cleanStringList(item?.qualities),
      defaultQuality: String(item?.default_quality || '').trim(),
      minTier: String(item?.min_tier || '').trim(),
    };
  }).filter(Boolean);
  return {
    userTier: String(data.user_tier || data.userTier || '').trim(),
    models,
  };
}

function mediaLabel(mentions = [], kind, index, fallback) {
  const grouped = mentions.filter((item) => String(item?.kind || 'image').toLowerCase() === kind);
  return String(grouped[index]?.displayName || grouped[index]?.label || grouped[index]?.name || fallback).trim();
}

function audioReferenceOwnerName(value) {
  const name = String(value || '').trim();
  return name.replace(/(?:的)?(?:音频|声音|配音|音色|voice|audio)$/i, '').trim() || name;
}

function audioReferenceFallback(audioPaths = [], index = 0) {
  const raw = String(audioPaths[index] || '').trim();
  if (!raw) return `未标注角色${index + 1}`;
  try {
    const pathname = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
    return decodeURIComponent(path.basename(pathname, path.extname(pathname))).trim() || `未标注角色${index + 1}`;
  } catch {
    return path.basename(raw, path.extname(raw)).trim() || `未标注角色${index + 1}`;
  }
}

function imageReferenceDescription(value) {
  const name = String(value || '').trim();
  if (!name) return '参考图';
  if (/^(?:参考图|图片)\d*$/u.test(name)) return name;
  return /参考图$/u.test(name) ? name : `${name}参考图`;
}

function videoReferenceDescription(value) {
  const name = String(value || '').trim();
  if (!name) return '参考视频';
  if (/^(?:参考视频|视频)\d*$/u.test(name)) return name;
  return /视频参考$/u.test(name) ? name : `${name}视频参考`;
}

function normalizeUpdreamPromptReferenceTokens(value) {
  return String(value || '').replace(/@Image(\d+)/gi, '[参考图$1]');
}

function updreamEditorReferenceChip(label, url, fallback) {
  const safeLabel = String(label || fallback || '参考图')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\[/g, '【')
    .replace(/\]/g, '】')
    .trim() || fallback || '参考图';
  return `@[${safeLabel}](${String(url || '').trim()})`;
}

export function buildUpdreamEditorPrompt({ prompt, mentions = [], images = [], audios = [], model } = {}) {
  let editorPrompt = String(prompt || '');
  const lines = [];
  const capabilities = updreamVideoCapabilities(model);
  const imageReferences = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, capabilities.maxImages);
  const audioReferences = (Array.isArray(audios) ? audios : [audios]).filter(Boolean).slice(0, capabilities.maxAudios);

  imageReferences.forEach((url, index) => {
    const referenceNumber = index + 1;
    const fallback = `参考图${referenceNumber}`;
    const label = mediaLabel(mentions, 'image', index, fallback);
    const chip = updreamEditorReferenceChip(label, url, fallback);
    const tokenPattern = new RegExp(`@Image${referenceNumber}(?!\\d)|\\[参考图${referenceNumber}\\]`, 'gi');
    let replaced = false;
    editorPrompt = editorPrompt.replace(tokenPattern, () => {
      replaced = true;
      return chip;
    });
    if (!replaced && !editorPrompt.includes(`](${url})`)) {
      lines.push(`${chip} 是${imageReferenceDescription(label)}`);
    }
  });

  audioReferences.forEach((url, index) => {
    const referenceNumber = index + 1;
    const fallback = `参考音频${referenceNumber}`;
    const label = mediaLabel(mentions, 'audio', index, fallback);
    const owner = audioReferenceOwnerName(label);
    const chip = updreamEditorReferenceChip(label, url, fallback);
    const tokenPattern = new RegExp(`@Audio${referenceNumber}(?!\\d)`, 'gi');
    let replaced = false;
    editorPrompt = editorPrompt.replace(tokenPattern, () => {
      replaced = true;
      return chip;
    });
    if (!replaced && !editorPrompt.includes(`](${url})`)) {
      lines.push(`${chip} 这个是${owner}的配音/音色参考`);
    }
  });

  return [...lines, editorPrompt.trim()].filter(Boolean).join('。\n\n');
}

function withReferencePrompt(prompt, mentions, counts, audioPaths = []) {
  const normalizedPrompt = normalizeUpdreamPromptReferenceTokens(prompt);
  const lines = [];
  for (let index = 0; index < counts.images; index += 1) {
    const token = `[参考图${index + 1}]`;
    if (!normalizedPrompt.includes(token)) {
      lines.push(`${token} 是${imageReferenceDescription(mediaLabel(mentions, 'image', index, `参考图${index + 1}`))}`);
    }
  }
  for (let index = 0; index < counts.audios; index += 1) {
    const owner = audioReferenceOwnerName(mediaLabel(
      mentions,
      'audio',
      index,
      audioReferenceFallback(audioPaths, index),
    ));
    lines.push(`@Audio${index + 1} 这个是${owner}的配音/音色参考`);
  }
  for (let index = 0; index < counts.videos; index += 1) {
    lines.push(`@Video${index + 1} 是${videoReferenceDescription(mediaLabel(mentions, 'video', index, `参考视频${index + 1}`))}`);
  }
  return [...lines, normalizedPrompt.trim()].filter(Boolean).join('。\n\n');
}

export function resolveUpdreamGenerationMode(shot = {}, media = {}) {
  const images = Array.isArray(media.images) ? media.images : [];
  const videos = Array.isArray(media.videos) ? media.videos : [];
  const audios = Array.isArray(media.audios) ? media.audios : [];
  const hasOpener = String(shot.openerFrameFrom ?? '').trim() !== '';
  if (hasOpener && images.length === 1 && !videos.length && !audios.length) return 'i2v';
  if (images.length || videos.length || audios.length) return 'ref2v';
  return 't2v';
}

export function buildUpdreamVideoPayload({ shot = {}, projectId, nodeId, model, resolution, media = {} } = {}) {
  const modelName = normalizeModel(shot.model || model);
  const capabilities = updreamVideoCapabilities(modelName);
  const images = (media.images || []).filter(Boolean).slice(0, capabilities.maxImages);
  const videos = (media.videos || []).filter(Boolean).slice(0, capabilities.maxVideos);
  const audios = (media.audios || []).filter(Boolean).slice(0, capabilities.maxAudios);
  const generateType = resolveUpdreamGenerationMode(shot, { images, videos, audios });
  const payload = {
    prompt: withReferencePrompt(shot.prompt, shot.mentions || [], {
      images: images.length,
      videos: videos.length,
      audios: audios.length,
    }, shot.refAudioPaths || []),
    model_name: modelName,
    project_id: projectId,
    node_id: nodeId,
    generate_type: generateType,
    resolution: normalizeResolution(shot.resolution || resolution, modelName),
    aspect_ratio: normalizeAspectRatio(shot.aspectRatio),
    duration: normalizeDuration(shot.duration, modelName),
    audio_urls: audios,
    num_videos: 1,
    // Wan 3.0 uses `mode` for its standard/prime generation variant. The
    // generic `video` value is rejected by UpDream as an invalid parameter.
    mode: modelName === 'wan-3.0' ? 'standard' : 'video',
    use_local: false,
  };
  if (capabilities.supportsBitrateMode !== false) payload.bitrate_mode = 'high';
  if (capabilities.generateAudio) {
    if (capabilities.supportsAudio !== false) payload.supports_audio = true;
    payload.sound = true;
  }
  if (generateType === 'i2v') payload.image = images[0];
  if (generateType === 'ref2v') {
    payload.ref_images = images;
    payload.ref_videos = videos;
    payload.ref_video = videos[0] || undefined;
  }
  return payload;
}

export function buildUpdreamImagePayload({ prompt, projectId, nodeId, model, ratio, resolution, quality, images = [] } = {}) {
  const references = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, 10);
  const imageDimensions = updreamImageDimensions(ratio);
  const payload = {
    prompt: String(prompt || '').trim(),
    project_id: projectId,
    node_id: nodeId,
    ratio: imageDimensions.ratio,
    width: imageDimensions.width,
    height: imageDimensions.height,
    num_images: 1,
    reference_images: references,
    use_local: false,
  };
  const modelName = String(model || '').trim();
  if (modelName) payload.model_name = modelName;
  const resolutionName = String(resolution || '').trim();
  if (resolutionName) payload.image_resolution = resolutionName;
  const qualityName = String(quality || '').trim();
  if (qualityName) payload.image_quality = qualityName;
  return payload;
}

// Image generation needs the same explicit media-to-prompt association as the
// canvas editor. A bare reference_images array gives the model no reliable
// indication which image is the identity reference and which is clothing/logo.
export function buildUpdreamImageReferencePrompt({ prompt, images = [], labels = [] } = {}) {
  const source = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, 10);
  const names = Array.isArray(labels) ? labels : [];
  const lines = [];
  source.forEach((url, index) => {
    const label = String(names[index] || `参考图${index + 1}`).replace(/[\r\n]+/g, ' ').trim() || `参考图${index + 1}`;
    const chip = `@[${label}](${String(url).trim()})`;
    if (!String(prompt || '').includes(`](${String(url).trim()})`)) {
      lines.push(`${chip} 是${label}`);
    }
  });
  return [...lines, String(prompt || '').trim()].filter(Boolean).join('。\n\n');
}

export function normalizeUpdreamTaskResult(value = {}) {
  const data = unwrap(value);
  const status = String(data.status || value.status || '').trim().toLowerCase();
  const progress = normalizeProgress(data.progress ?? value.progress);
  if (['failed', 'failure', 'cancelled', 'canceled', 'error'].includes(status)) {
    return {
      status: 'failed',
      fail: compactMessage(data.error || data.detail || value.error) || 'UpDream video generation failed',
      progress: progress ?? 100,
    };
  }
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(status)) {
    const videoUrls = candidateVideoUrls(data, { includeGenericUrl: true });
    return videoUrls.length
      ? { status: 'done', videoUrl: videoUrls[0], videoUrls, progress: 100 }
      : { status: 'done_no_url', progress: 100 };
  }
  return { status: 'queued', progress };
}

export function normalizeUpdreamImageTaskResult(value = {}) {
  const data = unwrap(value);
  const status = String(data.status || value.status || '').trim().toLowerCase();
  const progress = normalizeProgress(data.progress ?? value.progress);
  if (['failed', 'failure', 'cancelled', 'canceled', 'error'].includes(status)) {
    return {
      status: 'failed',
      fail: compactMessage(data.error || data.detail || value.error) || 'UpDream image generation failed',
      progress: progress ?? 100,
    };
  }
  const imageUrl = firstImageUrl(data.result || data);
  if (imageUrl && (!status || ['completed', 'complete', 'success', 'succeeded', 'done'].includes(status))) {
    return { status: 'done', imageUrl, progress: 100 };
  }
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(status)) {
    return { status: 'done_no_url', progress: 100 };
  }
  return { status: 'queued', progress };
}

export class UpDreamClient {
  constructor(config = {}, { fetchImpl = globalThis.fetch, onTokens } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    this.baseUrl = cleanBaseUrl(config.updreamBaseUrl);
    this.accessToken = String(config.updreamAccessToken || '').trim();
    this.refreshToken = String(config.updreamRefreshToken || '').trim();
    this.fetchImpl = fetchImpl;
    this.onTokens = onTokens;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new UpDreamError('UpDream Refresh Token is not configured', { code: 'AUTH_MISSING' });
    }
    const response = await this.fetchImpl(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Language': 'zh' },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });
    const value = await this.parseResponse(response);
    if (!response.ok) {
      throw new UpDreamError(compactMessage(value) || `UpDream token refresh failed (HTTP ${response.status})`, {
        status: response.status,
        code: 'AUTH_EXPIRED',
        detail: value,
      });
    }
    const accessToken = String(firstValue(value, ['access_token', 'accessToken']) || '').trim();
    const refreshToken = String(firstValue(value, ['refresh_token', 'refreshToken']) || this.refreshToken).trim();
    if (!accessToken) throw new UpDreamError('UpDream token refresh returned no access token', { code: 'AUTH_EXPIRED' });
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    await this.onTokens?.({ accessToken, refreshToken });
    return { accessToken, refreshToken };
  }

  async parseResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { detail: text.slice(0, 1000) }; }
  }

  async request(pathname, { method = 'GET', body, form, timeoutMs = DEFAULT_TIMEOUT_MS, retryAuth = true } = {}) {
    if (!this.accessToken && this.refreshToken && retryAuth) await this.refreshAccessToken();
    if (!this.accessToken) throw new UpDreamError('UpDream Access Token is not configured', { code: 'AUTH_MISSING' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'Accept-Language': 'zh',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: form || (body !== undefined ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });
      const value = await this.parseResponse(response);
      if (response.status === 401 && retryAuth && this.refreshToken) {
        await this.refreshAccessToken();
        return this.request(pathname, { method, body, form, timeoutMs, retryAuth: false });
      }
      if (!response.ok) {
        throw new UpDreamError(compactMessage(value) || `UpDream request failed (HTTP ${response.status})`, {
          status: response.status,
          code: response.status === 401 ? 'AUTH_EXPIRED' : 'UPDREAM_API_ERROR',
          detail: value,
        });
      }
      return value;
    } catch (error) {
      if (error?.name === 'AbortError') throw new UpDreamError('UpDream request timed out', { code: 'TIMEOUT' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  me() {
    return this.request('/auth/me', { timeoutMs: 30 * 1000 });
  }

  imageModels() {
    return this.request('/ai/models?type=image', { timeoutMs: 30 * 1000 });
  }

  listProjects() {
    return this.request('/projects?page=1&size=100', { timeoutMs: 30 * 1000 });
  }

  createProject(name) {
    return this.request('/projects', { method: 'POST', body: { name } });
  }

  async ensureProject(name) {
    const safeName = String(name || 'Freedom').trim().slice(0, 80) || 'Freedom';
    const ensureKey = `${this.baseUrl}\n${this.accessToken || this.refreshToken}\n${safeName}`;
    const active = updreamProjectEnsurePromises.get(ensureKey);
    if (active) return active;
    const pending = (async () => {
      const listed = await this.listProjects();
      const projects = Array.isArray(listed?.projects)
        ? listed.projects
        : (Array.isArray(listed?.data?.projects) ? listed.data.projects : []);
      const existing = projects.find((item) => String(item?.name || '').trim() === safeName);
      const existingId = firstValue(existing, ['project_id', 'projectId', 'id']);
      if (existingId) return existingId;
      const created = await this.createProject(safeName);
      const projectId = firstValue(created, ['project_id', 'projectId', 'id']);
      if (!projectId) throw new UpDreamError('UpDream project creation returned no project id');
      return projectId;
    })();
    updreamProjectEnsurePromises.set(ensureKey, pending);
    try {
      return await pending;
    } finally {
      if (updreamProjectEnsurePromises.get(ensureKey) === pending) updreamProjectEnsurePromises.delete(ensureKey);
    }
  }

  async createVideoNode(projectId, shot = {}, index = 0, media = {}, episodeId = '') {
    const shotLabel = String(shot.shotNo ?? index + 1);
    const episodeLabel = String(episodeId || '').trim();
    const name = episodeLabel ? `Episode ${episodeLabel} - Shot ${shotLabel}` : `Shot ${shotLabel}`;
    const model = normalizeModel(shot.model);
    const capabilities = updreamVideoCapabilities(model);
    const ratio = normalizeAspectRatio(shot.aspectRatio);
    const duration = normalizeDuration(shot.duration, model);
    const resolution = normalizeResolution(shot.resolution, model);
    const { x, y } = updreamVideoNodeLayout({ episodeId, shotNo: shot.shotNo }, index);
    const images = (media.images || []).filter(Boolean).slice(0, capabilities.maxImages);
    const videos = (media.videos || []).filter(Boolean).slice(0, capabilities.maxVideos);
    const audios = (media.audios || []).filter(Boolean).slice(0, capabilities.maxAudios);
    const generateType = resolveUpdreamGenerationMode(shot, { images, videos, audios });
    const prompt = generateType === 'ref2v'
      ? buildUpdreamEditorPrompt({ prompt: shot.prompt, mentions: shot.mentions || [], images, audios, model })
      : String(shot.prompt || '').trim();
    const referenceParams = generateType === 'ref2v'
      ? {
          referenceImages: [],
          videoRefs: images,
          ref_images: images,
          ref_videos: videos,
          ref_audios: audios,
        }
      : (generateType === 'i2v' ? { i2vFirst: images[0] || '' } : {});
    const nodeParams = {
      prompt,
      model,
      ratio,
      resolution,
      duration,
      videoCount: 1,
      generateType,
      ...referenceParams,
    };
    if (capabilities.supportsBitrateMode !== false) nodeParams.bitrate_mode = 'high';
    const value = await this.request(`/canvas-nodes/project/${encodeURIComponent(projectId)}`, {
      method: 'POST',
      body: {
        name,
        node_type: 'video',
        x,
        y,
        width: 384,
        height: 216,
        node_config: {
          mode: 'video',
          params: nodeParams,
        },
      },
    });
    const nodeId = firstValue(value, ['node_id', 'nodeId', 'id']);
    if (!nodeId) throw new UpDreamError('UpDream canvas node creation returned no node id');
    await this.request(`/canvas-nodes/${encodeURIComponent(nodeId)}`, {
      method: 'PUT',
      body: { x, y },
    });
    return nodeId;
  }

  async createImageNode(projectId, { prompt, model, ratio, resolution, quality } = {}) {
    return runWithUpdreamImageProjectLock(projectId, async () => {
      const imageDimensions = updreamImageDimensions(ratio);
      const nodeDimensions = updreamImageNodeDimensions(imageDimensions.ratio);
      const params = {
        prompt: String(prompt || '').trim(),
        ratio: imageDimensions.ratio,
        numImages: 1,
        referenceImages: [],
      };
      const modelName = String(model || '').trim();
      if (modelName) params.model = modelName;
      const resolutionName = String(resolution || '').trim();
      if (resolutionName) params.imageResolution = resolutionName;
      const qualityName = String(quality || '').trim();
      if (qualityName) params.imageQuality = qualityName;

      const projectKey = String(projectId || '').trim();
      let layoutIndex = updreamImageProjectNextIndexes.get(projectKey) || 0;
      try {
        const listed = await this.request(`/canvas-nodes/project/${encodeURIComponent(projectId)}`, {
          timeoutMs: 30 * 1000,
        });
        const existingImageNodes = updreamImageCanvasNodes(listed);
        layoutIndex = existingImageNodes.length;
        const positionUpdates = updreamImagePositionUpdates(existingImageNodes);
        if (positionUpdates.length) {
          await this.request(`/canvas-nodes/project/${encodeURIComponent(projectId)}/batch-update-positions`, {
            method: 'POST',
            body: positionUpdates,
          });
        }
      } catch {
        // Position discovery is best-effort; the in-process index still prevents concurrent overlap.
      }
      const { x, y } = updreamImageNodeLayout(layoutIndex);
      const value = await this.request(`/canvas-nodes/project/${encodeURIComponent(projectId)}`, {
        method: 'POST',
        body: {
          name: `Image ${Date.now().toString(36)}`,
          node_type: 'image',
          x,
          y,
          width: nodeDimensions.width,
          height: nodeDimensions.height,
          node_config: {
            mode: 'image',
            params,
          },
        },
      });
      const nodeId = firstValue(value, ['node_id', 'nodeId', 'id']);
      if (!nodeId) throw new UpDreamError('UpDream image node creation returned no node id');
      await this.request(`/canvas-nodes/${encodeURIComponent(nodeId)}`, {
        method: 'PUT',
        body: { x, y },
      });
      updreamImageProjectNextIndexes.set(projectKey, layoutIndex + 1);
      return nodeId;
    });
  }

  async uploadMedia(value, kind) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    let uploadPath = raw;
    let tempDir = '';
    try {
      const sourceStat = await fs.promises.stat(raw).catch(() => null);
      if (!sourceStat?.isFile()) throw new UpDreamError(`Reference file not found: ${raw}`, { code: 'FILE_NOT_FOUND' });
      if (sourceStat.size > MAX_UPLOAD_BYTES) throw new UpDreamError(`Reference file is larger than 100 MB: ${path.basename(raw)}`);

      if (kind === 'audio' && path.extname(raw).toLowerCase() !== '.mp3') {
        tempDir = createTempDir('hepai_updream_audio_');
        uploadPath = path.join(tempDir, `${path.basename(raw, path.extname(raw)) || 'reference-audio'}.mp3`);
        try {
          await execFileAsync(ffmpegPath(), [
            '-y',
            '-hide_banner',
            '-i', raw,
            '-vn',
            '-ac', '1',
            '-ar', '44100',
            '-c:a', 'libmp3lame',
            '-b:a', '128k',
            uploadPath,
          ], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
        } catch (error) {
          throw new UpDreamError(`UpDream 参考音频转 MP3 失败：${path.basename(raw)}`, {
            code: 'AUDIO_CONVERT_FAILED',
            detail: compactMessage(error?.stderr || error?.message),
          });
        }
      }

      const uploadStat = await fs.promises.stat(uploadPath).catch(() => null);
      if (!uploadStat?.isFile() || uploadStat.size <= 0) {
        throw new UpDreamError(`Reference file not found: ${uploadPath}`, { code: 'FILE_NOT_FOUND' });
      }
      if (uploadStat.size > MAX_UPLOAD_BYTES) throw new UpDreamError(`Reference file is larger than 100 MB: ${path.basename(uploadPath)}`);
      const data = await fs.promises.readFile(uploadPath);
      const ext = path.extname(uploadPath).toLowerCase();
      const mime = MIME_BY_EXT[ext] || (kind === 'audio' ? 'audio/mpeg' : (kind === 'video' ? 'video/mp4' : 'image/png'));
      const form = new FormData();
      form.append('file', new Blob([data], { type: mime }), path.basename(uploadPath));
      const uploaded = await this.request(`/upload/${kind}`, { method: 'POST', form, timeoutMs: DEFAULT_TIMEOUT_MS });
      const url = String(firstValue(uploaded, ['url', 'file_url', 'fileUrl', 'bfs_url', 'bfsUrl']) || '').trim();
      if (!url) throw new UpDreamError(`UpDream ${kind} upload returned no URL`);
      return url;
    } finally {
      if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  createVideoTask(payload) {
    return this.request('/ai/generate-video/async', { method: 'POST', body: payload });
  }

  async createImageTask(payload) {
    try {
      return await this.request('/ai/generate-image/async', { method: 'POST', body: payload });
    } catch (error) {
      if (![404, 405].includes(Number(error?.status))) throw error;
      return this.request('/ai/generate-image', { method: 'POST', body: payload });
    }
  }

  getTaskStatus(taskId) {
    return this.request(`/ai/task/${encodeURIComponent(taskId)}`, { timeoutMs: 60 * 1000 });
  }
}

function createClient(config, options) {
  return new UpDreamClient(config, options);
}

export async function testConnection({ config = {}, fetchImpl, onTokens } = {}) {
  const client = createClient(config, { fetchImpl, onTokens });
  const value = await client.me();
  const accountName = String(firstValue(value, ['nickname', 'username', 'name', 'display_name', 'displayName']) || '').trim();
  return { ok: true, accountName };
}

export async function listImageModels({ config = {}, fetchImpl, onTokens } = {}) {
  const client = createClient(config, { fetchImpl, onTokens });
  return normalizeUpdreamImageModels(await client.imageModels());
}

export async function submitVideos({
  config = {},
  projectName = 'Freedom',
  episodeId = '',
  shots = [],
  model,
  resolution,
  concurrency = 2,
  onProgress,
  onSubmitProgress,
  fetchImpl,
  onTokens,
} = {}) {
  const client = createClient(config, { fetchImpl, onTokens });
  const remoteProjectId = await client.ensureProject(`Freedom - ${projectName}`);
  const results = new Array(shots.length);
  const requestedConcurrency = Math.floor(Number(concurrency));
  const limit = Math.min(
    Number.isFinite(requestedConcurrency) ? Math.max(1, requestedConcurrency) : 2,
    shots.length || 1,
  );
  const state = { processed: 0, submitted: 0, failed: 0, total: shots.length };
  let cursor = 0;

  const emitState = () => onSubmitProgress?.({ ...state });
  const worker = async () => {
    while (cursor < shots.length) {
      const index = cursor;
      cursor += 1;
      const shot = shots[index];
      onProgress?.(`Submitting shot ${shot.shotNo} to UpDream...`);
      try {
        const selectedModel = normalizeModel(shot.model || model || config.updreamModel);
        const capabilities = updreamVideoCapabilities(selectedModel);
        const images = await Promise.all((shot.refImagePaths || []).slice(0, capabilities.maxImages).map((item) => client.uploadMedia(item, 'image')));
        const videos = await Promise.all((shot.refVideoPaths || []).slice(0, capabilities.maxVideos).map((item) => client.uploadMedia(item, 'video')));
        const audios = await Promise.all((shot.refAudioPaths || []).slice(0, capabilities.maxAudios).map((item) => client.uploadMedia(item, 'audio')));
        const media = { images, videos, audios };
        const nodeId = await client.createVideoNode(remoteProjectId, {
          ...shot,
          model: selectedModel,
        }, index, media, episodeId);
        const payload = buildUpdreamVideoPayload({
          shot,
          projectId: remoteProjectId,
          nodeId,
          model: selectedModel,
          resolution,
          media,
        });
        const submitted = await client.createVideoTask(payload);
        const submitId = String(firstValue(submitted, ['task_id', 'taskId', 'id']) || '').trim();
        if (!submitId) throw new UpDreamError('UpDream submission returned no task id');
        const status = String(firstValue(submitted, ['status']) || '').toLowerCase();
        if (status === 'failed') throw new UpDreamError(compactMessage(submitted) || 'UpDream rejected the video task');
        results[index] = {
          ok: true,
          shotNo: shot.shotNo,
          submitId,
          historyId: String(nodeId),
          projectId: String(remoteProjectId),
          model: payload.model_name,
        };
        state.submitted += 1;
      } catch (error) {
        results[index] = {
          ok: false,
          shotNo: shot.shotNo,
          error: error?.message || String(error),
          code: error?.code || 'UPDREAM_SUBMIT_FAILED',
        };
        state.failed += 1;
      } finally {
        state.processed += 1;
        emitState();
      }
    }
  };

  emitState();
  await Promise.all(Array.from({ length: limit }, () => worker()));
  onProgress?.(`UpDream submitted ${state.submitted}/${shots.length} shots`);
  return results;
}

export async function fetchVideoResults({ config = {}, submitIds = [], fetchImpl, onTokens } = {}) {
  const client = createClient(config, { fetchImpl, onTokens });
  const results = {};
  await Promise.all((submitIds || []).map(async (submitId) => {
    try {
      results[submitId] = normalizeUpdreamTaskResult(await client.getTaskStatus(submitId));
    } catch (error) {
      if (error?.code === 'AUTH_EXPIRED' || error?.code === 'AUTH_MISSING') throw error;
      results[submitId] = { status: 'queued', note: error?.message || String(error) };
    }
  }));
  return results;
}

export async function generateImage({
  config = {},
  projectName = 'Freedom',
  prompt,
  referencePaths = [],
  referenceLabels = [],
  model,
  ratio,
  resolution,
  quality,
  onProgress,
  fetchImpl,
  onTokens,
  pollIntervalMs = 2000,
  timeoutMs = 20 * 60 * 1000,
} = {}) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new UpDreamError('图片提示词不能为空', { code: 'PROMPT_REQUIRED' });
  const client = createClient(config, { fetchImpl, onTokens });
  onProgress?.('正在准备 UpDream 图片项目...');
  const projectId = await client.ensureProject(`Freedom - ${String(projectName || '图片生成').trim()}`);
  const modelName = String(model || config.updreamImageModel || UPDREAM_DEFAULT_IMAGE_MODEL).trim();
  if (!modelName) throw new UpDreamError('请选择 UpDream 图片模型', { code: 'MODEL_REQUIRED' });
  const resolutionName = String(resolution ?? config.updreamImageResolution ?? '').trim();
  const qualityName = String(quality ?? config.updreamImageQuality ?? '').trim();
  const nodeId = await client.createImageNode(projectId, {
    prompt: cleanPrompt,
    model: modelName,
    ratio,
    resolution: resolutionName,
    quality: qualityName,
  });
  const paths = (Array.isArray(referencePaths) ? referencePaths : [referencePaths]).filter(Boolean).slice(0, 10);
  const images = [];
  for (let index = 0; index < paths.length; index += 1) {
    onProgress?.(`正在上传参考图 ${index + 1}/${paths.length}...`);
    images.push(await client.uploadMedia(paths[index], 'image'));
  }
  const payload = buildUpdreamImagePayload({
    prompt: buildUpdreamImageReferencePrompt({ prompt: cleanPrompt, images, labels: referenceLabels }),
    projectId,
    nodeId,
    model: modelName,
    ratio,
    resolution: resolutionName,
    quality: qualityName,
    images,
  });
  onProgress?.('正在提交 UpDream 图片任务...');
  const submitted = await client.createImageTask(payload);
  const immediate = normalizeUpdreamImageTaskResult(submitted);
  if (immediate.status === 'done') {
    return { ...immediate, taskId: '', nodeId: String(nodeId), projectId: String(projectId), model: modelName, provider: 'updream' };
  }
  if (immediate.status === 'failed') throw new UpDreamError(immediate.fail, { code: 'UPDREAM_GENERATION_FAILED' });
  const taskId = String(firstValue(submitted, ['task_id', 'taskId', 'id']) || '').trim();
  if (!taskId) throw new UpDreamError('UpDream image submission returned no task id');

  const deadline = Date.now() + Math.max(30_000, Number(timeoutMs) || 20 * 60 * 1000);
  while (Date.now() < deadline) {
    if (pollIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const state = normalizeUpdreamImageTaskResult(await client.getTaskStatus(taskId));
    if (state.progress !== null && state.progress !== undefined) onProgress?.(`UpDream 图片生成中 ${state.progress}%`);
    if (state.status === 'done') {
      return { ...state, taskId, nodeId: String(nodeId), projectId: String(projectId), model: modelName, provider: 'updream' };
    }
    if (state.status === 'done_no_url') throw new UpDreamError('UpDream 图片已生成，但没有返回图片地址', { code: 'RESULT_MISSING' });
    if (state.status === 'failed') throw new UpDreamError(state.fail, { code: 'UPDREAM_GENERATION_FAILED' });
  }
  throw new UpDreamError('UpDream 图片生成等待超时', { code: 'TIMEOUT' });
}
