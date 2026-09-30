import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { createHash, createHmac, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { createTempDir, ffmpegPath, ffprobePath } from './config.js';
import { candidateVideoUrls } from './videoCandidates.js';

const execFileAsync = promisify(execFile);

export const NEOWOW_DEFAULT_BASE_URL = 'https://neowow.cn';
export const NEOWOW_DEFAULT_MODEL = 'neo-video-2-0-fast';
export const NEOWOW_DEFAULT_IMAGE_MODEL = 'gpt-image-2';
export const NEOWOW_IMAGE_MODELS = Object.freeze([
  {
    value: 'gpt-image-2',
    label: 'Neo Image 2',
    resolutions: ['1K', '2K', '4K'],
    ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1'],
    qualities: ['low', 'medium', 'high'],
    maxReferenceImages: 10,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'gpt-image-2-official',
    label: 'Neo Image 2 official',
    resolutions: ['1K', '2K', '4K'],
    ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1'],
    qualities: ['low', 'medium', 'high'],
    maxReferenceImages: 16,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'doubao-seedream-5-0-pro-260628',
    label: 'Seedream 5.0 Pro',
    resolutions: ['1K', '2K'],
    ratios: ['9:16', '16:9', '4:3', '3:4', '1:1', '3:2', '2:3', '21:9'],
    maxReferenceImages: 10,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'qwen-image-3.0-pro',
    label: 'Qwen-Image 3.0 Pro',
    resolutions: ['1k', '2k'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5'],
    maxReferenceImages: 3,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'gemini-3-pro-image-preview',
    label: 'Neo Nano Pro',
    resolutions: ['2K', '4K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    maxReferenceImages: 10,
    imageCountOptions: ['1', '1'],
    membershipRequired: true,
  },
  {
    value: 'gemini-3.1-flash-image-preview',
    label: 'Neo Nano 2',
    resolutions: ['1K', '2K', '4K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'],
    maxReferenceImages: 10,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'Midjourney-v 8.2',
    label: 'Neo Mj-v8.2',
    resolutions: ['1K', '2K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    maxReferenceImages: 4,
    imageCountOptions: ['4', '4'],
    discountRate: 0.6,
  },
  {
    value: 'Midjourney-v 8.1',
    label: 'Neo Mj-v8.1',
    resolutions: ['1K', '2K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    maxReferenceImages: 4,
    imageCountOptions: ['4', '4'],
    discountRate: 0.6,
  },
  {
    value: 'Midjourney-v 7',
    label: 'Neo Mj-v7',
    resolutions: ['1K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    maxReferenceImages: 2,
    imageCountOptions: ['4', '4'],
    discountRate: 0.6,
  },
  {
    value: 'Midjourney-niji 7',
    label: 'Neo Mj-niji7',
    resolutions: ['1K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    maxReferenceImages: 2,
    imageCountOptions: ['4', '4'],
    discountRate: 0.6,
  },
  {
    value: 'doubao-seedream-5-0-260128',
    label: 'Seedream 5.0',
    resolutions: ['2K', '3K'],
    ratios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    maxReferenceImages: 10,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'doubao-seedream-4-5-251128',
    label: 'Seedream 4.5',
    resolutions: ['2K', '4K'],
    ratios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    maxReferenceImages: 4,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'doubao-seedream-4-0-250828',
    label: 'Seedream 4.0',
    resolutions: ['2K', '4K'],
    ratios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    maxReferenceImages: 4,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'gemini-3.1-flash-lite-image',
    label: 'Neo Nano 2 Lite',
    resolutions: ['1K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
    maxReferenceImages: 14,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'gemini-2.5-flash-image',
    label: 'Neo Nano',
    resolutions: ['1K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
    maxReferenceImages: 4,
    imageCountOptions: ['1', '1'],
  },
  {
    value: 'wan2.7-image-pro',
    label: 'Wan 2.7 Image Pro',
    resolutions: ['1K', '2K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5'],
    maxReferenceImages: 10,
    imageCountOptions: ['1', '4'],
  },
]);
export const NEOWOW_ACTIVITY_VIDEO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'neowow',
  'activity-discount-reference.mp4',
);
export const NEOWOW_MODELS = Object.freeze([
  {
    value: 'neo-video-2-0',
    label: 'Seedance 2.0',
    resolutions: ['480p', '720p', '1080p', '4k'],
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 15,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    generateAudio: true,
  },
  {
    value: 'neo-video-2-0-fast',
    label: 'Seedance 2.0 fast',
    resolutions: ['480p', '720p'],
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 15,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    generateAudio: true,
  },
  {
    value: 'doubao-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
    resolutions: ['480p', '720p'],
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 15,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    generateAudio: true,
  },
  {
    value: 'doubao-seedance-2-5-260628',
    label: 'Seedance 2.5',
    resolutions: ['480p', '720p'],
    minDuration: 4,
    maxDuration: 30,
    defaultDuration: 5,
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    generateAudio: true,
  },
  {
    value: 'MiniMax-H3',
    label: 'MiniMax H3',
    resolutions: ['768P', '2K'],
    defaultResolution: '2K',
    minDuration: 5,
    maxDuration: 15,
    defaultDuration: 5,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    generateAudio: false,
  },
  {
    value: 'wan3.0-video',
    label: 'Wan 3.0',
    resolutions: ['480P', '720P', '1080P'],
    minDuration: 2,
    maxDuration: 30,
    defaultDuration: 5,
    maxImages: 10,
    maxVideos: 5,
    maxAudios: 1,
    generateAudio: true,
  },
]);

const MODEL_BY_ID = new Map(NEOWOW_MODELS.map((item) => [item.value, item]));
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const sessionEnsurePromises = new Map();
const sessionLayoutLocks = new Map();
const sessionLayoutReservations = new Map();
const NEOWOW_NODE_LAYOUT_COLUMNS = 6;
const NEOWOW_NODE_LAYOUT_ORIGIN = Object.freeze({ x: 100, y: 100 });
const NEOWOW_NODE_LAYOUT_GAP = Object.freeze({ x: 540, y: 340 });
const NEOWOW_NODE_LAYOUT_SIZE = Object.freeze({ width: 489, height: 280 });
const NEOWOW_IMAGE_LAYOUT_COLUMNS = 6;
const NEOWOW_IMAGE_LAYOUT_ORIGIN = Object.freeze({ x: 100, y: 100 });
const NEOWOW_IMAGE_LAYOUT_GAP = Object.freeze({ x: 540, y: 540 });
const NEOWOW_IMAGE_LAYOUT_SIZE = Object.freeze({ width: 440, height: 440 });
const NEOWOW_NODE_LAYOUT_CLEARANCE = 40;
const NEOWOW_MEDIA_CDN_HOST = 'neoai-online.neodomain.cn';
const NEOWOW_REVIEW_RETRY_DELAYS_MS = Object.freeze([0, 1000, 2000, 4000, 8000, 12000, 18000]);
const NEOWOW_MEDIA_SOURCE_HOSTS = new Set([
  'wlpaas.oss-cn-shanghai.aliyuncs.com',
  'wlpaas.oss-accelerate.aliyuncs.com',
  'wlpaas.weilitech.cn',
]);
const MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
});
const neowowReviewPromises = new Map();

export class NeowowError extends Error {
  constructor(message, { status = 0, code = '', detail = null } = {}) {
    super(message);
    this.name = 'NeowowError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function cleanBaseUrl(value) {
  return String(value || NEOWOW_DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || NEOWOW_DEFAULT_BASE_URL;
}

function compactMessage(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim().slice(0, 800);
  if (typeof value === 'object') {
    return compactMessage(value.errMessage || value.errorMessage || value.message || value.detail || value.error)
      || JSON.stringify(value).slice(0, 800);
  }
  return String(value).slice(0, 800);
}

function reviewPendingText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return [
    value.message,
    value.errorMessage,
    value.errMessage,
    value.reviewStatusDesc,
    value.detail?.message,
    value.detail?.errorMessage,
    value.detail?.errMessage,
  ].filter(Boolean).map((item) => compactMessage(item)).join(' ');
}

function isNeowowReviewPending(value) {
  const status = String(value?.reviewStatus ?? value?.detail?.reviewStatus ?? value?.status ?? '').trim().toLowerCase();
  if (['0', '1', 'pending', 'processing', 'reviewing', 'under_review'].includes(status)) return true;
  const text = reviewPendingText(value);
  if (!text || /失败|拒绝|不通过|违规|拦截|failed|reject|rejected|blocked|denied/i.test(text)) return false;
  return /审核中|待审核|审核处理中|reviewing|under review|pending review|processing review/i.test(text);
}

function waitMs(delayMs) {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

function apiData(value) {
  return value?.data === undefined ? value : value.data;
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

function cleanStringList(value, limit) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .slice(0, limit);
}

export function buildNeowowVideoAttachments(videos = [], activityVideo = null, maxVideos = 3) {
  const activityUrl = normalizeNeowowMediaUrl(activityVideo?.url);
  const limit = Math.max(0, Math.floor(Number(maxVideos) || 0));
  const seen = new Set();
  const manualVideos = (Array.isArray(videos) ? videos : [videos])
    .filter((item) => item?.url)
    .filter((item) => normalizeNeowowMediaUrl(item.url) !== activityUrl)
    .filter((item) => {
      const url = normalizeNeowowMediaUrl(item.url);
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, Math.max(0, limit - (activityUrl ? 1 : 0)));
  const attachedVideos = activityUrl
    ? [...manualVideos, { ...activityVideo, url: activityUrl, displayName: '活动视频素材', bindPrompt: false }]
    : manualVideos;
  return { attachedVideos, promptVideos: manualVideos };
}

export function normalizeNeowowMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!NEOWOW_MEDIA_SOURCE_HOSTS.has(url.hostname.toLowerCase())) return raw;
    url.protocol = 'https:';
    url.hostname = NEOWOW_MEDIA_CDN_HOST;
    url.port = '';
    return url.toString();
  } catch {
    return raw;
  }
}

export function neowowNodePosition(index = 0) {
  const slot = Math.max(0, Math.floor(Number(index) || 0));
  return {
    x: NEOWOW_NODE_LAYOUT_ORIGIN.x + ((slot % NEOWOW_NODE_LAYOUT_COLUMNS) * NEOWOW_NODE_LAYOUT_GAP.x),
    y: NEOWOW_NODE_LAYOUT_ORIGIN.y + (Math.floor(slot / NEOWOW_NODE_LAYOUT_COLUMNS) * NEOWOW_NODE_LAYOUT_GAP.y),
  };
}

export function neowowImageNodePosition(index = 0) {
  const slot = Math.max(0, Math.floor(Number(index) || 0));
  return {
    x: NEOWOW_IMAGE_LAYOUT_ORIGIN.x + ((slot % NEOWOW_IMAGE_LAYOUT_COLUMNS) * NEOWOW_IMAGE_LAYOUT_GAP.x),
    y: NEOWOW_IMAGE_LAYOUT_ORIGIN.y + (Math.floor(slot / NEOWOW_IMAGE_LAYOUT_COLUMNS) * NEOWOW_IMAGE_LAYOUT_GAP.y),
  };
}

export function neowowImageDimensions(value = '16:9') {
  const [width, height] = String(value || '16:9').trim().split(':').map(Number);
  const ratio = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 16 / 9;
  const longSide = NEOWOW_IMAGE_LAYOUT_SIZE.width;
  return ratio >= 1
    ? { width: longSide, height: Math.max(1, Math.round(longSide / ratio)) }
    : { width: Math.max(1, Math.round(longSide * ratio)), height: longSide };
}

function neowowNodeLayoutIndex(position = {}) {
  const column = Math.round((Number(position.x) - NEOWOW_NODE_LAYOUT_ORIGIN.x) / NEOWOW_NODE_LAYOUT_GAP.x);
  const row = Math.round((Number(position.y) - NEOWOW_NODE_LAYOUT_ORIGIN.y) / NEOWOW_NODE_LAYOUT_GAP.y);
  if (column < 0 || column >= NEOWOW_NODE_LAYOUT_COLUMNS || row < 0) return null;
  const expected = neowowNodePosition((row * NEOWOW_NODE_LAYOUT_COLUMNS) + column);
  if (Math.abs(expected.x - Number(position.x)) > 10 || Math.abs(expected.y - Number(position.y)) > 10) return null;
  return (row * NEOWOW_NODE_LAYOUT_COLUMNS) + column;
}

function neowowImageLayoutIndex(position = {}) {
  const column = Math.round((Number(position.x) - NEOWOW_IMAGE_LAYOUT_ORIGIN.x) / NEOWOW_IMAGE_LAYOUT_GAP.x);
  const row = Math.round((Number(position.y) - NEOWOW_IMAGE_LAYOUT_ORIGIN.y) / NEOWOW_IMAGE_LAYOUT_GAP.y);
  if (column < 0 || column >= NEOWOW_IMAGE_LAYOUT_COLUMNS || row < 0) return null;
  const expected = neowowImageNodePosition((row * NEOWOW_IMAGE_LAYOUT_COLUMNS) + column);
  if (Math.abs(expected.x - Number(position.x)) > 10 || Math.abs(expected.y - Number(position.y)) > 10) return null;
  return (row * NEOWOW_IMAGE_LAYOUT_COLUMNS) + column;
}

function isNeowowManagedImageNode(node = {}) {
  return node?.type === 'image' && node?.data?.yanzhiImage === true;
}

function compareNeowowImageNodes(left, right) {
  return (Number(left?.data?.createdAt) || 0) - (Number(right?.data?.createdAt) || 0)
    || String(left?.id || '').localeCompare(String(right?.id || ''));
}

function withSessionLayoutLock(sessionId, action) {
  const key = String(sessionId || '').trim();
  const previous = sessionLayoutLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  sessionLayoutLocks.set(key, current);
  return current.finally(() => {
    if (sessionLayoutLocks.get(key) === current) sessionLayoutLocks.delete(key);
  });
}

function releaseNodeLayoutReservation(sessionId, index) {
  const key = String(sessionId || '').trim();
  const reserved = sessionLayoutReservations.get(key);
  if (!reserved) return;
  reserved.delete(index);
  if (!reserved.size) sessionLayoutReservations.delete(key);
}

function neowowManagedNodeIdentity(node = {}) {
  const data = node?.data || {};
  const explicitEpisode = String(data.yanzhiEpisodeId ?? '').trim();
  const explicitShot = String(data.yanzhiShotNo ?? '').trim();
  if (explicitEpisode && explicitShot) return { episodeId: explicitEpisode, shotNo: explicitShot };
  const label = String(data.label || '').trim();
  const matched = label.match(/第\s*([^\s·]+)\s*集\s*[·.・]?\s*分镜\s*([^\s]+)/i);
  if (!matched) return null;
  return { episodeId: matched[1], shotNo: matched[2] };
}

function compareNeowowManagedNodes(left, right) {
  const leftIdentity = neowowManagedNodeIdentity(left) || {};
  const rightIdentity = neowowManagedNodeIdentity(right) || {};
  const comparePart = (a, b) => {
    const aNumber = Number(a);
    const bNumber = Number(b);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
    return String(a || '').localeCompare(String(b || ''), 'zh-CN', { numeric: true });
  };
  return comparePart(leftIdentity.episodeId, rightIdentity.episodeId)
    || comparePart(leftIdentity.shotNo, rightIdentity.shotNo)
    || (Number(left?.data?.createdAt) || 0) - (Number(right?.data?.createdAt) || 0)
    || String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function normalizeNeowowModel(value) {
  const model = String(value || '').trim();
  if (model === 'wan-3.0' || model === 'wan3.0' || model === 'wan_3.0') return 'wan3.0-video';
  return MODEL_BY_ID.has(model) ? model : NEOWOW_DEFAULT_MODEL;
}

function neowowVideoCapabilities(model) {
  return MODEL_BY_ID.get(normalizeNeowowModel(model)) || MODEL_BY_ID.get(NEOWOW_DEFAULT_MODEL);
}

export function normalizeNeowowImageModel(value) {
  const model = String(value || '').trim();
  return model || NEOWOW_DEFAULT_IMAGE_MODEL;
}

export function neowowImageModelOptions(value = []) {
  const source = Array.isArray(value) && value.length ? value : NEOWOW_IMAGE_MODELS;
  return source.map((item) => {
    const discountValue = item.discountRate ?? item.discount_rate;
    return {
      ...item,
      value: String(item.value || item.model_name || '').trim(),
      label: String(item.label || item.model_display_name || item.value || item.model_name || '').trim(),
      resolutions: Array.isArray(item.resolutions) ? item.resolutions.map(String).filter(Boolean) : [],
      ratios: Array.isArray(item.ratios || item.supported_aspect_ratios)
        ? (item.ratios || item.supported_aspect_ratios).map(String).filter(Boolean)
        : [],
      qualities: Array.isArray(item.qualities || item.quality)
        ? (item.qualities || item.quality).map(String).filter(Boolean)
        : [],
      imageCountOptions: Array.isArray(item.imageCountOptions || item.image_count_options)
        ? (item.imageCountOptions || item.image_count_options).map(String).filter(Boolean)
        : ['1', '1'],
      maxReferenceImages: Math.max(0, Math.floor(Number(item.maxReferenceImages ?? item.max_reference_images) || 0)),
      membershipRequired: item.membershipRequired === true || Number(item.membership_required) === 1,
      discountRate: discountValue !== null && discountValue !== '' && Number.isFinite(Number(discountValue))
        ? Number(discountValue)
        : null,
      maintenance: item.maintenance === true,
    };
  }).filter((item) => item.value);
}

export function normalizeNeowowImageResolution(value, model, options = []) {
  const selected = neowowImageModelOptions(options).find((item) => item.value === normalizeNeowowImageModel(model));
  const allowed = selected?.resolutions?.length ? selected.resolutions : ['1K', '2K', '4K'];
  const requested = String(value || '').trim().toUpperCase();
  return allowed.find((item) => String(item).toUpperCase() === requested) || allowed[0];
}

export function normalizeNeowowImageQuality(value, model, options = []) {
  const selected = neowowImageModelOptions(options).find((item) => item.value === normalizeNeowowImageModel(model));
  const allowed = selected?.qualities || [];
  if (!allowed.length) return '';
  const requested = String(value || '').trim().toLowerCase();
  return allowed.includes(requested) ? requested : allowed[0];
}

export function neowowImageCount(model, options = []) {
  const selected = neowowImageModelOptions(options).find((item) => item.value === normalizeNeowowImageModel(model));
  const minimum = Math.floor(Number(selected?.imageCountOptions?.[0]));
  return Number.isFinite(minimum) ? Math.max(1, Math.min(4, minimum)) : 1;
}

export function neowowModelResolutions(model) {
  return [...(MODEL_BY_ID.get(normalizeNeowowModel(model))?.resolutions || ['480p'])];
}

export function normalizeNeowowResolution(value, model) {
  const normalized = String(value || '').trim().toLowerCase();
  const capabilities = neowowVideoCapabilities(model);
  return capabilities.resolutions.find((item) => item.toLowerCase() === normalized)
    || capabilities.defaultResolution
    || capabilities.resolutions[0]
    || '480p';
}

function normalizeAspectRatio(value) {
  const ratio = String(value || '').trim();
  return ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'].includes(ratio) ? ratio : '16:9';
}

function normalizeDuration(value, model) {
  const capabilities = neowowVideoCapabilities(model);
  const duration = Math.round(Number(value));
  return Number.isFinite(duration)
    ? Math.max(capabilities.minDuration, Math.min(capabilities.maxDuration, duration))
    : capabilities.defaultDuration;
}

function mediaName(mentions = [], kind, index, fallback) {
  const item = mediaMention(mentions, kind, index);
  return String(item?.displayName || item?.label || item?.name || fallback).trim() || fallback;
}

function mediaMention(mentions = [], kind, index) {
  return mentions.filter((item) => String(item?.kind || 'image').toLowerCase() === kind)[index] || null;
}

function audioOwnerName(value) {
  const name = String(value || '').trim();
  return name
    .replace(/[\s_.-]*(?:的)?[\s_.-]*(?:音频|声音|配音|音色|voice|audio)$/i, '')
    .trim() || name;
}

function mediaMentionToken(url, fallback) {
  try {
    const fileName = decodeURIComponent(new URL(String(url || '')).pathname.split('/').pop() || '');
    const label = fileName.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '').trim();
    return `@[${label || fallback}]`;
  } catch {
    return `@[${fallback}]`;
  }
}

function referenceSubjectName(value, fallback) {
  return String(value || fallback || '')
    .trim()
    .replace(/(?:的)?(?:参考图|音频参考|参考音频|视频参考|参考视频)$/u, '')
    .trim() || fallback;
}

function neowowReferenceLine(token, mentions, kind, index, fallback) {
  const mention = mediaMention(mentions, kind, index);
  const name = referenceSubjectName(
    mention?.displayName || mention?.label || mention?.name,
    fallback,
  );
  if (kind === 'audio') return `${token} 是${audioOwnerName(name)}的音频参考`;
  if (kind === 'video') return `${token} 是${name}的视频参考`;
  const category = String(mention?.category || mention?.sourceCategory || mention?.cat || '').trim().toLowerCase();
  if (['continuity-frame', 'continuity', '首尾帧', '连续首尾帧'].includes(category)) {
    return `${token} 是本分镜的首帧参考图`;
  }
  if (['first-frame', 'firstframe', 'opener', '首帧', '首帧图'].includes(category)) {
    return `${token} 是本分镜的首帧参考图`;
  }
  if (['last-frame', 'lastframe', 'tail-frame', '尾帧', '尾帧图'].includes(category)) {
    return `${token} 是本分镜的尾帧参考图`;
  }
  if (category === 'scene' || category === '场景') {
    return `${token} 是场景${name.replace(/^场景/u, '')}的参考图`;
  }
  return `${token} 是${name}的参考图`;
}

function removeStandaloneReferenceDeclaration(output, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`^${escaped}\\s*(?:是|这个是)\\s*[^，,：:；;。.!！?？\\r\\n]{1,80}[。.]?$`);
  return String(output || '')
    .split(/\r?\n/)
    .filter((line) => !declaration.test(line.trim()))
    .join('\n');
}

function rewriteIndexedMediaMention(output, kind, index, url) {
  const number = index + 1;
  const fallback = `${kind === 'image' ? '图片' : (kind === 'audio' ? '音频' : '视频')}${number}`;
  const token = mediaMentionToken(url, fallback);
  const patterns = kind === 'image'
    ? [new RegExp(`@Image${number}(?!\\d)`, 'gi'), new RegExp(`@图片${number}(?!\\d)`, 'g'), new RegExp(`\\[参考图${number}\\]`, 'g')]
    : (kind === 'audio'
      ? [new RegExp(`@Audio${number}(?!\\d)`, 'gi'), new RegExp(`@音频${number}(?!\\d)`, 'g')]
      : [new RegExp(`@Video${number}(?!\\d)`, 'gi'), new RegExp(`@视频${number}(?!\\d)`, 'g')]);
  let matched = output.includes(token);
  let rewritten = output;
  for (const pattern of patterns) {
    if (pattern.test(rewritten)) matched = true;
    pattern.lastIndex = 0;
    rewritten = rewritten.replace(pattern, token);
  }
  return { output: rewritten, token, matched };
}

export function buildNeowowPrompt({ prompt, mentions = [], images = [], videos = [], audios = [] } = {}) {
  let output = String(prompt || '');
  const lines = [];
  images.forEach((url, index) => {
    const rewritten = rewriteIndexedMediaMention(output, 'image', index, url);
    output = removeStandaloneReferenceDeclaration(rewritten.output, rewritten.token);
    lines.push(neowowReferenceLine(rewritten.token, mentions, 'image', index, `参考图${index + 1}`));
  });
  audios.forEach((url, index) => {
    const rewritten = rewriteIndexedMediaMention(output, 'audio', index, url);
    output = removeStandaloneReferenceDeclaration(rewritten.output, rewritten.token);
    lines.push(neowowReferenceLine(rewritten.token, mentions, 'audio', index, `参考音频${index + 1}`));
  });
  videos.forEach((url, index) => {
    const rewritten = rewriteIndexedMediaMention(output, 'video', index, url);
    output = removeStandaloneReferenceDeclaration(rewritten.output, rewritten.token);
    lines.push(neowowReferenceLine(rewritten.token, mentions, 'video', index, `参考视频${index + 1}`));
  });
  return [...lines, output.trim()].filter(Boolean).join('。\n');
}

export function buildNeowowVideoPayload({ shot = {}, sessionId, nodeId, model, resolution, media = {} } = {}) {
  const modelName = normalizeNeowowModel(shot.model || model);
  const capabilities = neowowVideoCapabilities(modelName);
  const imageUrls = cleanStringList(media.images, capabilities.maxImages).map(normalizeNeowowMediaUrl);
  const referenceVideoUrls = cleanStringList(media.videos, capabilities.maxVideos).map(normalizeNeowowMediaUrl);
  const promptReferenceVideoUrls = cleanStringList(
    Object.prototype.hasOwnProperty.call(media, 'promptVideos') ? media.promptVideos : referenceVideoUrls,
    capabilities.maxVideos,
  ).map(normalizeNeowowMediaUrl);
  const audioUrl = cleanStringList(media.audios, capabilities.maxAudios).map(normalizeNeowowMediaUrl);
  return {
    nodeKey: String(nodeId || ''),
    sessionId: String(sessionId || ''),
    generationType: 'UNIVERSAL_TO_VIDEO',
    videoReferType: 'feature',
    modelName,
    prompt: buildNeowowPrompt({
      prompt: shot.prompt,
      mentions: shot.mentions || [],
      images: imageUrls,
      videos: promptReferenceVideoUrls,
      audios: audioUrl,
    }),
    resolution: normalizeNeowowResolution(shot.resolution || resolution, modelName),
    duration: normalizeDuration(shot.duration, modelName),
    totalDuration: 0,
    aspectRatio: normalizeAspectRatio(shot.aspectRatio),
    generateAudio: capabilities.generateAudio,
    imageUrls,
    referenceVideoUrls,
    audioUrl,
  };
}

export function buildNeowowImagePayload({
  sessionId,
  nodeId,
  prompt,
  model,
  ratio = '16:9',
  resolution,
  quality,
  imageUrls = [],
  models = [],
} = {}) {
  const selectedModel = normalizeNeowowImageModel(model);
  const references = cleanStringList(imageUrls, 16).map(normalizeNeowowMediaUrl);
  const selectedQuality = normalizeNeowowImageQuality(quality, selectedModel, models);
  return {
    nodeKey: String(nodeId || '').trim(),
    sessionId: String(sessionId || '').trim(),
    prompt: String(prompt || '').trim(),
    modelName: selectedModel,
    aspectRatio: String(ratio || '16:9').trim(),
    numImages: String(neowowImageCount(selectedModel, models)),
    size: normalizeNeowowImageResolution(resolution, selectedModel, models),
    ...(selectedQuality ? { quality: selectedQuality } : {}),
    outputFormat: 'jpeg',
    syncMode: false,
    showPrompt: true,
    sourceType: 'USER_DIRECT',
    ...(references.length ? { imageUrls: references } : {}),
  };
}

function normalizeProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.max(0, Math.min(100, Math.round(number <= 1 ? number * 100 : number)));
}

export function normalizeNeowowTaskResult(value = {}) {
  const status = String(value.status || '').trim().toUpperCase();
  const progress = normalizeProgress(value.progress);
  if (['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'ERROR'].includes(status)) {
    return {
      status: 'failed',
      fail: compactMessage(value.errorMessage || value.errMessage || value.error) || 'Neowow 视频生成失败',
      progress: progress ?? 100,
    };
  }
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'DONE'].includes(status)) {
    const videoUrls = candidateVideoUrls(value.resultData || value, { includeGenericUrl: true });
    return videoUrls.length
      ? { status: 'done', videoUrl: videoUrls[0], videoUrls, progress: 100 }
      : { status: 'done_no_url', progress: 100 };
  }
  const aheadCount = Number(value.aheadCount);
  const note = value.queuedByConcurrencyLimit
    ? `Neowow 并发队列前方还有 ${Number.isFinite(aheadCount) ? aheadCount : 0} 个任务`
    : '';
  return { status: 'queued', progress, note };
}

function collectNeowowImageUrls(value, output = [], seen = new Set(), allowAnyUrl = false) {
  if (value == null || output.length >= 9) return output;
  if (typeof value === 'string') {
    const url = normalizeNeowowMediaUrl(value);
    if (/^https?:\/\//i.test(url) && !seen.has(url) && (allowAnyUrl || /[./](?:png|jpe?g|webp)(?:[?#]|$)/i.test(url) || url.includes('/images/'))) {
      seen.add(url);
      output.push(url);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNeowowImageUrls(item, output, seen, allowAnyUrl));
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const key of ['imageUrls', 'image_urls', 'imageUrl', 'image_url', 'url', 'result', 'resultData', 'data']) {
    if (value[key] !== undefined) {
      const imageField = ['imageUrls', 'image_urls', 'imageUrl', 'image_url', 'result', 'resultData'].includes(key);
      collectNeowowImageUrls(value[key], output, seen, allowAnyUrl || imageField);
    }
  }
  return output;
}

export function normalizeNeowowImageTaskResult(value = {}) {
  const status = String(value.status || '').trim().toUpperCase();
  const progress = normalizeProgress(value.progress);
  if (['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'ERROR'].includes(status)) {
    return {
      status: 'failed',
      fail: compactMessage(value.errorMessage || value.errMessage || value.error) || 'Neowow 图片生成失败',
      progress: progress ?? 100,
    };
  }
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'DONE'].includes(status)) {
    const imageUrls = collectNeowowImageUrls(value.resultData || value);
    return imageUrls.length
      ? { status: 'done', imageUrl: imageUrls[0], imageUrls, progress: 100 }
      : { status: 'done_no_url', imageUrls: [], progress: 100 };
  }
  const aheadCount = Number(value.aheadCount);
  const note = value.queuedByConcurrencyLimit
    ? `Neowow 图片队列前方还有 ${Number.isFinite(aheadCount) ? aheadCount : 0} 个任务`
    : '';
  return { status: 'queued', progress, note };
}

function objectPathUrl(endpoint, bucket, objectName) {
  const host = String(endpoint || 'oss-accelerate.aliyuncs.com').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const encodedPath = String(objectName || '').split('/').map(encodeURIComponent).join('/');
  return `https://${bucket}.${host}/${encodedPath}`;
}

function ossAuthorization({ method, contentType, date, bucket, objectName, accessKeyId, accessKeySecret, securityToken }) {
  const canonicalHeaders = `x-oss-date:${date}\nx-oss-security-token:${securityToken}\n`;
  const canonicalResource = `/${bucket}/${objectName}`;
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${canonicalHeaders}${canonicalResource}`;
  const signature = createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64');
  return `OSS ${accessKeyId}:${signature}`;
}

async function probeAudioDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(ffprobePath(), [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    const seconds = Number(String(stdout || '').trim());
    return Number.isFinite(seconds) ? seconds : 0;
  } catch {
    return 0;
  }
}

async function prepareAudioFile(filePath) {
  const duration = await probeAudioDuration(filePath);
  if (duration > 0 && duration < 1.95) {
    throw new NeowowError(`参考音频不足 2 秒：${path.basename(filePath)}`, { code: 'AUDIO_TOO_SHORT' });
  }
  const alreadyMp3 = path.extname(filePath).toLowerCase() === '.mp3';
  if (alreadyMp3 && (!duration || duration <= 15.05)) return { filePath, tempDir: '' };
  const tempDir = createTempDir('hepai_neowow_audio_');
  const target = path.join(tempDir, `${path.basename(filePath, path.extname(filePath)) || 'reference-audio'}.mp3`);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-vn', '-map', '0:a:0',
    '-ac', '1', '-ar', '44100',
    '-c:a', 'libmp3lame', '-b:a', '128k',
  ];
  if (duration > 15.05) args.push('-t', '15');
  args.push(target);
  try {
    await execFileAsync(ffmpegPath(), args, {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new NeowowError(`参考音频转 MP3 失败：${path.basename(filePath)}`, {
      code: 'AUDIO_CONVERT_FAILED',
      detail: compactMessage(error?.stderr || error?.message),
    });
  }
  return { filePath: target, tempDir };
}

export class NeowowClient {
  constructor(config = {}, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    this.baseUrl = cleanBaseUrl(config.neowowBaseUrl);
    this.token = String(config.neowowToken || '').trim();
    this.fetchImpl = fetchImpl;
    this.profile = null;
    this.sts = null;
  }

  async parseResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { errMessage: text.slice(0, 1000) }; }
  }

  async request(pathname, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!this.token) throw new NeowowError('Neowow Token 未配置', { code: 'AUTH_MISSING' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: 'application/json',
        accessToken: this.token,
        timestamp: String(Date.now()),
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const value = await this.parseResponse(response);
      if (!response.ok || value?.success === false) {
        throw new NeowowError(compactMessage(value) || `Neowow 请求失败 (HTTP ${response.status})`, {
          status: response.status,
          code: String(value?.errCode || (response.status === 401 ? 'AUTH_EXPIRED' : 'NEOWOW_API_ERROR')),
          detail: value,
        });
      }
      return value;
    } catch (error) {
      if (error?.name === 'AbortError') throw new NeowowError('Neowow 请求超时', { code: 'TIMEOUT' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getProfile() {
    if (this.profile) return this.profile;
    const profile = apiData(await this.request('/user/profile', { timeoutMs: 30_000 })) || {};
    const userId = String(firstValue(profile, ['userId', 'user_id', 'id']) || '').trim();
    if (!userId) throw new NeowowError('Neowow 账号信息缺少 userId', { code: 'PROFILE_INVALID' });
    this.profile = { ...profile, userId };
    return this.profile;
  }

  async listImageModels() {
    const value = apiData(await this.request('/agent/ai-image-generation/models/by-scenario/byLogin?scenarioType=1', {
      timeoutMs: 30_000,
    }));
    const rows = Array.isArray(value) ? value : [];
    return neowowImageModelOptions(rows.map((item) => ({
      ...item,
      value: item.model_name,
      label: item.model_display_name,
      resolutions: item.supported_sizes,
      ratios: item.supported_aspect_ratios,
      qualities: item.quality,
      imageCountOptions: item.image_count_options,
      maxReferenceImages: item.max_reference_images,
      membershipRequired: Number(item.membership_required) === 1,
      discountRate: item.discount_rate,
      maintenance: item.maintenance === true,
    })));
  }

  async getSts() {
    const expiresAt = Date.parse(this.sts?.expiration || '');
    if (this.sts && Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) return this.sts;
    let lastError = null;
    let lastValue = null;
    for (const pathname of ['/agent/sts/oss/user-token', '/agent/sts/oss/token']) {
      let value;
      try {
        value = apiData(await this.request(pathname, { timeoutMs: 30_000 }));
      } catch (error) {
        lastError = error;
        continue;
      }
      lastValue = value;
      const normalized = {
        ...(value && typeof value === 'object' ? value : {}),
        accessKeyId: String(firstValue(value, ['accessKeyId', 'access_key_id', 'AccessKeyId']) || '').trim(),
        accessKeySecret: String(firstValue(value, ['accessKeySecret', 'access_key_secret', 'AccessKeySecret']) || '').trim(),
        securityToken: String(firstValue(value, ['securityToken', 'security_token', 'stsToken', 'SecurityToken']) || '').trim(),
        bucketName: String(firstValue(value, ['bucketName', 'bucket_name', 'bucket', 'BucketName']) || '').trim(),
        expiration: String(firstValue(value, ['expiration', 'expiresAt', 'expireTime', 'Expiration']) || '').trim(),
        endpoint: String(firstValue(value, ['endpoint', 'ossEndpoint']) || '').trim(),
        objectPrefix: String(firstValue(value, ['objectPrefix', 'object_prefix']) || '').trim(),
      };
      if (['accessKeyId', 'accessKeySecret', 'securityToken', 'bucketName'].every((key) => normalized[key])) {
        this.sts = normalized;
        return normalized;
      }
    }
    if (lastError && lastValue == null) throw lastError;
    throw new NeowowError('Neowow OSS 临时凭证接口未返回有效凭证', { code: 'OSS_STS_INVALID' });
  }

  // Neowow's current web client uses a short-lived presigned upload URL.
  // Keep this separate from getSts() so older integrations and their tests
  // remain compatible while local media uploads follow the live API.
  async getOssUploadUrl(fileName, { bizType = 'uploads', durationMs } = {}) {
    const body = {
      fileName: String(fileName || '').trim(),
      bizType: String(bizType || 'uploads').trim() || 'uploads',
    };
    const duration = Number(durationMs);
    if (Number.isFinite(duration) && duration > 0) body.durationMs = Math.round(duration);
    const value = apiData(await this.request('/agent/oss/upload-url', {
      method: 'POST',
      body,
      timeoutMs: 30_000,
    })) || {};
    const uploadUrl = String(value.uploadUrl || value.upload_url || '').trim();
    if (!uploadUrl) {
      throw new NeowowError('Neowow OSS 上传接口未返回上传地址', {
        code: 'OSS_UPLOAD_URL_INVALID',
        detail: value,
      });
    }
    return {
      ...value,
      uploadUrl,
      method: String(value.method || 'PUT').trim().toUpperCase() || 'PUT',
      fileUrl: String(value.fileUrl || value.file_url || uploadUrl.split('?')[0]).trim(),
      objectKey: String(value.objectKey || value.object_key || '').trim(),
      requiredHeaders: value.requiredHeaders && typeof value.requiredHeaders === 'object'
        ? value.requiredHeaders
        : {},
    };
  }

  async listSessions() {
    return this.request('/agent/story-canvas/session/list/v3?pageNum=1&pageSize=100&sortField=updateTime&sortOrder=desc&projectType=0', {
      timeoutMs: 30_000,
    });
  }

  createSession(title, description = '') {
    return this.request('/agent/story-canvas/session/create', {
      method: 'POST',
      body: { title, description },
    });
  }

  async findSessionIdByTitle(title) {
    const listed = apiData(await this.listSessions());
    const sessions = Array.isArray(listed)
      ? listed
      : ['records', 'list', 'rows', 'content', 'items']
        .map((key) => listed?.[key])
        .find(Array.isArray) || [];
    const existing = sessions.find((item) => String(item?.title || item?.name || '').trim() === title);
    return String(firstValue(existing, ['sessionId', 'session_id', 'id']) || '').trim();
  }

  async ensureSession(title) {
    const safeTitle = String(title || 'Freedom').trim().slice(0, 80) || 'Freedom';
    const key = `${this.baseUrl}\n${this.token}\n${safeTitle}`;
    const active = sessionEnsurePromises.get(key);
    if (active) return active;
    const pending = (async () => {
      const existingId = await this.findSessionIdByTitle(safeTitle);
      if (existingId) return existingId;
      const created = apiData(await this.createSession(safeTitle, 'Freedom 视频生成画布'));
      const sessionId = String(firstValue(created, ['sessionId', 'session_id', 'id']) || '').trim();
      if (sessionId) return sessionId;

      // Neowow currently creates the canvas successfully but may return an
      // empty data field. Resolve the new session from the authoritative list.
      for (const delayMs of [0, 300, 700, 1500]) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const listedId = await this.findSessionIdByTitle(safeTitle);
        if (listedId) return listedId;
      }
      throw new NeowowError('Neowow 画布已创建，但自动回查 sessionId 失败，请稍后重试', {
        code: 'SESSION_ID_LOOKUP_FAILED',
      });
    })();
    sessionEnsurePromises.set(key, pending);
    try {
      return await pending;
    } finally {
      if (sessionEnsurePromises.get(key) === pending) sessionEnsurePromises.delete(key);
    }
  }

  getSession(sessionId) {
    return this.request(`/agent/story-canvas/session/${encodeURIComponent(sessionId)}?token=undefined`, {
      timeoutMs: 30_000,
    });
  }

  async findFreeNodeLayoutIndexes(sessionId, count, { reservedIndexes = [] } = {}) {
    const detail = apiData(await this.getSession(sessionId)) || {};
    const nodes = Array.isArray(detail.nodes) ? detail.nodes : [];
    const used = new Set(nodes
      .map((node) => neowowNodeLayoutIndex(node?.position))
      .filter((index) => index !== null));
    for (const index of reservedIndexes) {
      if (Number.isInteger(index) && index >= 0) used.add(index);
    }
    const occupied = nodes.map((node) => ({
      x: Number(node?.position?.x) || 0,
      y: Number(node?.position?.y) || 0,
      width: Math.max(1, Number(node?.measured?.width || node?.width) || NEOWOW_NODE_LAYOUT_SIZE.width),
      height: Math.max(1, Number(node?.measured?.height || node?.height) || NEOWOW_NODE_LAYOUT_SIZE.height),
    }));
    for (const index of reservedIndexes) {
      if (!Number.isInteger(index) || index < 0) continue;
      occupied.push({ ...neowowNodePosition(index), ...NEOWOW_NODE_LAYOUT_SIZE });
    }
    const indexes = [];
    for (let candidate = 0; indexes.length < Math.max(0, Number(count) || 0); candidate += 1) {
      if (used.has(candidate)) continue;
      const position = neowowNodePosition(candidate);
      const overlaps = occupied.some((node) => (
        position.x < node.x + node.width + NEOWOW_NODE_LAYOUT_CLEARANCE
        && position.x + NEOWOW_NODE_LAYOUT_SIZE.width + NEOWOW_NODE_LAYOUT_CLEARANCE > node.x
        && position.y < node.y + node.height + NEOWOW_NODE_LAYOUT_CLEARANCE
        && position.y + NEOWOW_NODE_LAYOUT_SIZE.height + NEOWOW_NODE_LAYOUT_CLEARANCE > node.y
      ));
      if (overlaps) continue;
      indexes.push(candidate);
      used.add(candidate);
      occupied.push({ ...position, ...NEOWOW_NODE_LAYOUT_SIZE });
    }
    return indexes;
  }

  async findFreeImageLayoutIndexes(sessionId, count, { reservedIndexes = [] } = {}) {
    const detail = apiData(await this.getSession(sessionId)) || {};
    const nodes = Array.isArray(detail.nodes) ? detail.nodes : [];
    const used = new Set(nodes
      .map((node) => neowowImageLayoutIndex(node?.position))
      .filter((index) => index !== null));
    for (const index of reservedIndexes) {
      if (Number.isInteger(index) && index >= 0) used.add(index);
    }
    const occupied = nodes
      .filter((node) => !isNeowowManagedImageNode(node))
      .map((node) => ({
        x: Number(node?.position?.x) || 0,
        y: Number(node?.position?.y) || 0,
        width: Math.max(1, Number(node?.measured?.width || node?.width) || NEOWOW_IMAGE_LAYOUT_SIZE.width),
        height: Math.max(1, Number(node?.measured?.height || node?.height) || NEOWOW_IMAGE_LAYOUT_SIZE.height),
      }));
    for (const index of reservedIndexes) {
      if (!Number.isInteger(index) || index < 0) continue;
      occupied.push({ ...neowowImageNodePosition(index), ...NEOWOW_IMAGE_LAYOUT_SIZE });
    }
    const indexes = [];
    for (let candidate = 0; indexes.length < Math.max(0, Number(count) || 0); candidate += 1) {
      if (used.has(candidate)) continue;
      const position = neowowImageNodePosition(candidate);
      const overlaps = occupied.some((node) => (
        position.x < node.x + node.width + NEOWOW_NODE_LAYOUT_CLEARANCE
        && position.x + NEOWOW_IMAGE_LAYOUT_SIZE.width + NEOWOW_NODE_LAYOUT_CLEARANCE > node.x
        && position.y < node.y + node.height + NEOWOW_NODE_LAYOUT_CLEARANCE
        && position.y + NEOWOW_IMAGE_LAYOUT_SIZE.height + NEOWOW_NODE_LAYOUT_CLEARANCE > node.y
      ));
      if (overlaps) continue;
      indexes.push(candidate);
      used.add(candidate);
      occupied.push({ ...position, ...NEOWOW_IMAGE_LAYOUT_SIZE });
    }
    return indexes;
  }

  reserveNodeLayoutIndexes(sessionId, count) {
    return withSessionLayoutLock(sessionId, async () => {
      const key = String(sessionId || '').trim();
      const reserved = sessionLayoutReservations.get(key) || new Set();
      sessionLayoutReservations.set(key, reserved);
      const indexes = await this.findFreeNodeLayoutIndexes(sessionId, count, { reservedIndexes: reserved });
      for (const index of indexes) reserved.add(index);
      return indexes;
    });
  }

  reserveImageLayoutIndexes(sessionId, count) {
    return withSessionLayoutLock(sessionId, async () => {
      const key = String(sessionId || '').trim();
      const reserved = sessionLayoutReservations.get(key) || new Set();
      sessionLayoutReservations.set(key, reserved);
      const indexes = await this.findFreeImageLayoutIndexes(sessionId, count, { reservedIndexes: reserved });
      for (const index of indexes) reserved.add(index);
      return indexes;
    });
  }

  async reflowVideoNodes(sessionId) {
    return withSessionLayoutLock(sessionId, async () => {
      const detail = apiData(await this.getSession(sessionId)) || {};
      const managedNodes = (Array.isArray(detail.nodes) ? detail.nodes : [])
        .filter((node) => node?.type === 'video' && neowowManagedNodeIdentity(node))
        .sort(compareNeowowManagedNodes);
      const updates = managedNodes.map((node, index) => ({
        ...node,
        position: neowowNodePosition(index),
      })).filter((node, index) => (
        Number(node.position.x) !== Number(managedNodes[index]?.position?.x)
        || Number(node.position.y) !== Number(managedNodes[index]?.position?.y)
      ));
      if (!updates.length) return { updated: 0, total: managedNodes.length };
      const result = apiData(await this.request('/agent/story-canvas/batch-operation', {
        method: 'POST',
        body: { sessionId, actions: [{ action: 'update', nodes: updates }] },
      })) || {};
      const failed = (Array.isArray(result.results) ? result.results : []).find((item) => item?.success === false);
      if (failed || Number(result.failureCount) > 0) {
        throw new NeowowError(compactMessage(failed?.errorMessage) || 'Neowow 画布自动排列失败', {
          code: 'NODE_REFLOW_FAILED',
          detail: result,
        });
      }
      return { updated: updates.length, total: managedNodes.length };
    });
  }

  async reflowImageNodes(sessionId) {
    return withSessionLayoutLock(sessionId, async () => {
      const detail = apiData(await this.getSession(sessionId)) || {};
      const nodes = Array.isArray(detail.nodes) ? detail.nodes : [];
      const managedNodes = nodes.filter(isNeowowManagedImageNode).sort(compareNeowowImageNodes);
      if (!managedNodes.length) return { updated: 0, total: 0 };
      const occupied = nodes.filter((node) => !isNeowowManagedImageNode(node)).map((node) => ({
        x: Number(node?.position?.x) || 0,
        y: Number(node?.position?.y) || 0,
        width: Math.max(1, Number(node?.measured?.width || node?.width) || NEOWOW_IMAGE_LAYOUT_SIZE.width),
        height: Math.max(1, Number(node?.measured?.height || node?.height) || NEOWOW_IMAGE_LAYOUT_SIZE.height),
      }));
      const assigned = [];
      const used = new Set();
      for (const node of managedNodes) {
        for (let candidate = 0; ; candidate += 1) {
          if (used.has(candidate)) continue;
          const position = neowowImageNodePosition(candidate);
          const overlaps = occupied.some((item) => (
            position.x < item.x + item.width + NEOWOW_NODE_LAYOUT_CLEARANCE
            && position.x + NEOWOW_IMAGE_LAYOUT_SIZE.width + NEOWOW_NODE_LAYOUT_CLEARANCE > item.x
            && position.y < item.y + item.height + NEOWOW_NODE_LAYOUT_CLEARANCE
            && position.y + NEOWOW_IMAGE_LAYOUT_SIZE.height + NEOWOW_NODE_LAYOUT_CLEARANCE > item.y
          ));
          if (overlaps) continue;
          used.add(candidate);
          occupied.push({ ...position, ...NEOWOW_IMAGE_LAYOUT_SIZE });
          assigned.push({ ...node, position });
          break;
        }
      }
      const updates = assigned.filter((node, index) => (
        Number(node.position.x) !== Number(managedNodes[index]?.position?.x)
        || Number(node.position.y) !== Number(managedNodes[index]?.position?.y)
      ));
      if (!updates.length) return { updated: 0, total: managedNodes.length };
      const result = apiData(await this.request('/agent/story-canvas/batch-operation', {
        method: 'POST',
        body: { sessionId, actions: [{ action: 'update', nodes: updates }] },
      })) || {};
      const failed = (Array.isArray(result.results) ? result.results : [])
        .find((item) => item?.success === false);
      if (failed || Number(result.failureCount) > 0) {
        throw new NeowowError(compactMessage(failed?.errorMessage) || 'Neowow 图片画布自动排列失败', {
          code: 'IMAGE_NODE_REFLOW_FAILED',
          detail: result,
        });
      }
      return { updated: updates.length, total: managedNodes.length };
    });
  }

  async updateVideoNode(sessionId, nodeId, changes = {}) {
    const detail = apiData(await this.getSession(sessionId)) || {};
    const node = (Array.isArray(detail.nodes) ? detail.nodes : [])
      .find((item) => String(item?.id || '') === String(nodeId || ''));
    if (!node) throw new NeowowError(`Neowow 画布节点不存在：${nodeId}`, { code: 'NODE_NOT_FOUND' });
    const updated = { ...node, data: { ...(node.data || {}), ...changes } };
    const result = apiData(await this.request('/agent/story-canvas/batch-operation', {
      method: 'POST',
      body: { sessionId, actions: [{ action: 'update', nodes: [updated] }] },
    })) || {};
    const failed = (Array.isArray(result.results) ? result.results : [])
      .find((item) => item?.success === false);
    if (failed || Number(result.failureCount) > 0) {
      throw new NeowowError(compactMessage(failed?.errorMessage) || 'Neowow 画布节点更新失败', {
        code: 'NODE_UPDATE_FAILED',
        detail: result,
      });
    }
    return updated;
  }

  async putObject(filePath, objectName, contentType, { durationMs } = {}) {
    const data = await fs.promises.readFile(filePath);
    const upload = await this.getOssUploadUrl(objectName, { durationMs });
    const url = upload.uploadUrl;
    const headers = { ...upload.requiredHeaders };
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = contentType;
    }
    const response = await this.fetchImpl(url, {
      method: upload.method,
      headers,
      body: data,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const ossCode = String(detail.match(/<Code>([^<]+)<\/Code>/i)?.[1] || '').trim();
      throw new NeowowError(`Neowow 素材上传失败 (HTTP ${response.status})`, {
        status: response.status,
        code: 'OSS_UPLOAD_FAILED',
        detail: ossCode ? `OSS ${ossCode}` : `OSS HTTP ${response.status}`,
      });
    }
    return upload.fileUrl || url.split('?')[0];
  }

  async queryMediaRecord(md5) {
    try {
      return apiData(await this.request(`/agent/image-record/query?imageMd5=${encodeURIComponent(md5)}`, {
        timeoutMs: 30_000,
      }));
    } catch {
      return null;
    }
  }

  async saveMediaRecord(md5, url) {
    return apiData(await this.request('/agent/image-record/save', {
      method: 'POST',
      body: { imageMd5: md5, imageUrl: url },
      timeoutMs: 30_000,
    }));
  }

  async reviewImage(url) {
    const key = normalizeNeowowMediaUrl(url);
    const active = neowowReviewPromises.get(key);
    if (active) return active;
    const pending = (async () => {
      let last = null;
      for (const delayMs of NEOWOW_REVIEW_RETRY_DELAYS_MS) {
        await waitMs(delayMs);
        try {
          const reviewed = apiData(await this.request('/agent/ark-asset-review/submit', {
            method: 'POST',
            body: { imageUrl: url },
            timeoutMs: 3 * 60 * 1000,
          })) || {};
          if (Number(reviewed.reviewStatus) === 2 || reviewed.reviewed === true) return true;
          if (isNeowowReviewPending(reviewed)) {
            last = reviewed;
            continue;
          }
          throw new NeowowError(compactMessage(reviewed.errorMessage || reviewed.reviewStatusDesc) || 'Neowow 真人素材校验未通过', {
            code: 'ASSET_REVIEW_FAILED',
            detail: reviewed,
          });
        } catch (error) {
          if (!isNeowowReviewPending(error)) throw error;
          last = error;
        }
      }
      throw new NeowowError('Neowow 素材仍在审核中，软件已自动等待但暂未完成，请稍后重试', {
        code: 'ASSET_REVIEW_PENDING',
        detail: last,
      });
    })();
    neowowReviewPromises.set(key, pending);
    try {
      return await pending;
    } finally {
      if (neowowReviewPromises.get(key) === pending) neowowReviewPromises.delete(key);
    }
  }

  async uploadMedia(value, kind) {
    const raw = String(value || '').trim();
    if (!raw) return { url: '', name: '', reviewed: kind !== 'image' };
    if (/^https?:\/\//i.test(raw)) {
      if (kind === 'image') await this.reviewImage(raw);
      return {
        url: normalizeNeowowMediaUrl(raw),
        name: path.basename(new URL(raw).pathname),
        reviewed: true,
      };
    }
    const source = await fs.promises.stat(raw).catch(() => null);
    if (!source?.isFile()) throw new NeowowError(`参考素材不存在：${raw}`, { code: 'FILE_NOT_FOUND' });
    let uploadPath = raw;
    let tempDir = '';
    try {
      if (kind === 'audio') ({ filePath: uploadPath, tempDir } = await prepareAudioFile(raw));
      const stat = await fs.promises.stat(uploadPath);
      const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : (kind === 'audio' ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES);
      if (stat.size > maxBytes) throw new NeowowError(`参考素材文件过大：${path.basename(uploadPath)}`, { code: 'FILE_TOO_LARGE' });
      const buffer = await fs.promises.readFile(uploadPath);
      const md5 = createHash('md5').update(buffer).digest('hex');
      const ext = path.extname(uploadPath).toLowerCase() || (kind === 'audio' ? '.mp3' : (kind === 'video' ? '.mp4' : '.png'));
      const fileName = `${md5}${ext}`;
      const record = await this.queryMediaRecord(md5);
      let url = String(record?.imageUrl || record?.url || '').trim();
      let reviewed = record?.reviewed === true;
      if (!url) {
        const contentType = MIME_BY_EXT[ext] || (kind === 'audio' ? 'audio/mpeg' : (kind === 'video' ? 'video/mp4' : 'image/png'));
        const durationMs = kind === 'video' ? Math.round((await probeAudioDuration(uploadPath)) * 1000) : undefined;
        url = await this.putObject(uploadPath, fileName, contentType, { durationMs });
        const saved = await this.saveMediaRecord(md5, url);
        reviewed = saved?.reviewed === true;
      }
      if (kind === 'image' && !reviewed) {
        await this.reviewImage(url);
        reviewed = true;
      }
      return { url: normalizeNeowowMediaUrl(url), name: fileName, reviewed };
    } finally {
      if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createVideoNode(sessionId, shot = {}, index = 0, media = {}) {
    const nodeId = randomUUID();
    const model = normalizeNeowowModel(shot.model);
    const modelInfo = MODEL_BY_ID.get(model);
    const resolution = normalizeNeowowResolution(shot.resolution, model);
    const duration = normalizeDuration(shot.duration, model);
    const episodeLabel = String(shot.episodeId ?? '').trim();
    const shotLabel = String(shot.shotNo ?? index + 1).trim();
    const manualReferences = [
      ...(media.images || []).map((item, mediaIndex) => ({
        type: 'image',
        url: normalizeNeowowMediaUrl(item.url),
        name: mediaName(shot.mentions || [], 'image', mediaIndex, `图片${mediaIndex + 1}`),
        reviewed: item.reviewed === true,
        ...(String(mediaMention(shot.mentions || [], 'image', mediaIndex)?.category || '').trim()
          ? { category: String(mediaMention(shot.mentions || [], 'image', mediaIndex).category).trim() }
          : {}),
      })),
      ...(media.videos || []).map((item, mediaIndex) => ({
        type: 'video',
        url: normalizeNeowowMediaUrl(item.url),
        name: String(
          item.displayName
          || mediaName(shot.mentions || [], 'video', mediaIndex, item.name || `视频${mediaIndex + 1}`),
        ).trim(),
      })),
      ...(media.audios || []).map((item, mediaIndex) => ({
        type: 'audio',
        url: normalizeNeowowMediaUrl(item.url),
        name: mediaName(shot.mentions || [], 'audio', mediaIndex, `音频${mediaIndex + 1}`),
        ...(String(mediaMention(shot.mentions || [], 'audio', mediaIndex)?.category || '').trim()
          ? { category: String(mediaMention(shot.mentions || [], 'audio', mediaIndex).category).trim() }
          : {}),
      })),
    ];
    const node = {
      id: nodeId,
      type: 'video',
      position: neowowNodePosition(index),
      data: {
        icon: 'video',
        type: 'generation',
        label: episodeLabel ? `第 ${episodeLabel} 集 · 分镜 ${shotLabel}` : `分镜 ${shotLabel}`,
        model: 'neo-video-2-0',
        result: null,
        status: 'idle',
        duration: '4',
        createdAt: Date.now(),
        modelName: modelInfo?.label || model,
        resolution,
        aspectRatio: normalizeAspectRatio(shot.aspectRatio),
        uploadError: null,
        generationType: 'IMAGE_TO_VIDEO',
        inputVideoUrls: [],
        universalModel: model,
        imageUploadMode: 'universal',
        universalDuration: String(duration),
        universalResolution: resolution,
        universalAspectRatio: normalizeAspectRatio(shot.aspectRatio),
        universalEnableAudio: modelInfo?.generateAudio !== false,
        universalKeepOriginalSound: false,
        yanzhiEpisodeId: episodeLabel,
        yanzhiShotNo: shotLabel,
        manualReferences,
      },
      measured: { ...NEOWOW_NODE_LAYOUT_SIZE },
      expandParent: null,
    };
    const created = apiData(await this.request('/agent/story-canvas/batch-operation', {
      method: 'POST',
      body: { sessionId, actions: [{ action: 'create', nodes: [node] }] },
    })) || {};
    const failed = (Array.isArray(created.results) ? created.results : [])
      .find((item) => item?.success === false);
    if (failed || Number(created.failureCount) > 0) {
      throw new NeowowError(compactMessage(failed?.errorMessage) || 'Neowow 画布节点创建失败', {
        code: 'NODE_CREATE_FAILED',
        detail: created,
      });
    }
    releaseNodeLayoutReservation(sessionId, index);
    return nodeId;
  }

  async createImageNode(sessionId, image = {}, index = 0, media = {}) {
    const nodeId = randomUUID();
    const model = normalizeNeowowImageModel(image.model);
    const modelInfo = neowowImageModelOptions(image.models).find((item) => item.value === model)
      || NEOWOW_IMAGE_MODELS.find((item) => item.value === model)
      || {};
    const ratio = String(image.aspectRatio || '16:9').trim();
    const dimensions = neowowImageDimensions(ratio);
    const resolution = normalizeNeowowImageResolution(image.resolution, model, image.models);
    const quality = normalizeNeowowImageQuality(image.quality, model, image.models);
    const imageCount = neowowImageCount(model, image.models);
    const label = String(image.label || `Freedom 图片 ${index + 1}`).trim();
    const node = {
      id: nodeId,
      type: 'image',
      position: neowowImageNodePosition(index),
      data: {
        icon: 'image',
        type: 'generation',
        label,
        model,
        modelName: modelInfo.label || model,
        status: 'idle',
        taskId: '',
        prompt: String(image.prompt || ''),
        aspectRatio: ratio,
        resolution,
        batchSize: imageCount,
        quality,
        inputImageUrls: [],
        result: null,
        yanzhiImage: true,
        createdAt: Date.now(),
        ...(Array.isArray(media.images) && media.images.length ? {
          manualReferences: media.images.map((item, mediaIndex) => ({
            type: 'image',
            url: normalizeNeowowMediaUrl(item.url || item),
            name: item.name || `参考图${mediaIndex + 1}`,
          })),
        } : {}),
      },
      measured: dimensions,
      style: { width: `${dimensions.width}px`, height: `${dimensions.height}px` },
      expandParent: null,
    };
    const created = apiData(await this.request('/agent/story-canvas/batch-operation', {
      method: 'POST',
      body: { sessionId, actions: [{ action: 'create', nodes: [node] }] },
    })) || {};
    const failed = (Array.isArray(created.results) ? created.results : [])
      .find((item) => item?.success === false);
    if (failed || Number(created.failureCount) > 0) {
      throw new NeowowError(compactMessage(failed?.errorMessage) || 'Neowow 图片节点创建失败', {
        code: 'IMAGE_NODE_CREATE_FAILED',
        detail: created,
      });
    }
    releaseNodeLayoutReservation(sessionId, index);
    return nodeId;
  }

  generateImage(payload) {
    return this.request('/agent/story-canvas/generate-image', { method: 'POST', body: payload });
  }

  queryImageTasks(taskIds) {
    return this.request('/agent/story-canvas/batch-query-status', {
      method: 'POST',
      body: { taskIds },
      timeoutMs: 60_000,
    });
  }

  generateVideo(payload) {
    return this.request('/agent/story-canvas/generate-video', { method: 'POST', body: payload });
  }

  queryVideoTasks(taskIds) {
    return this.request('/agent/story-canvas/batch-query-status', {
      method: 'POST',
      body: { taskIds },
      timeoutMs: 60_000,
    });
  }
}

function createClient(config, options) {
  return new NeowowClient(config, options);
}

async function generateVideoWithReviewRetry(client, payload) {
  let last = null;
  for (const delayMs of NEOWOW_REVIEW_RETRY_DELAYS_MS) {
    await waitMs(delayMs);
    try {
      return await client.generateVideo(payload);
    } catch (error) {
      if (!isNeowowReviewPending(error)) throw error;
      last = error;
    }
  }
  throw new NeowowError('Neowow 素材仍在审核中，软件已自动重试但暂未完成，请稍后重试', {
    code: 'ASSET_REVIEW_PENDING',
    detail: last,
  });
}

export async function testConnection({ config = {}, fetchImpl } = {}) {
  const client = createClient(config, { fetchImpl });
  const profile = await client.getProfile();
  const rawPoints = firstValue(profile, ['points', 'point', 'credits', 'credit']);
  const numericPoints = rawPoints == null || rawPoints === ''
    ? null
    : Number(String(rawPoints).replace(/,/g, '').trim());
  return {
    ok: true,
    accountName: String(profile.nickname || profile.mobile || profile.userId).trim(),
    userId: profile.userId,
    points: Number.isFinite(numericPoints) ? numericPoints : null,
  };
}

async function waitForNeowowImageTask(client, taskId, { sessionId, nodeId, onProgress, timeoutMs = 15 * 60 * 1000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = apiData(await client.queryImageTasks([taskId]));
    const item = (Array.isArray(value) ? value : [])
      .find((candidate) => String(candidate?.taskId || candidate?.task_id || '') === String(taskId));
    const normalized = normalizeNeowowImageTaskResult(item || {});
    if (normalized.status === 'done' || normalized.status === 'done_no_url' || normalized.status === 'failed') {
      await client.updateVideoNode(sessionId, nodeId, normalized.status === 'done'
        ? { status: 'SUCCESS', taskId, result: normalized.imageUrls || [] }
        : { status: 'FAILED', taskId, result: null, errorMessage: normalized.fail || '图片生成失败' }).catch(() => {});
      return normalized;
    }
    onProgress?.(normalized.note || `Neowow 图片生成中${normalized.progress == null ? '' : ` · ${normalized.progress}%`}...`);
    await waitMs(5000);
  }
  const timeout = new NeowowError('Neowow 图片生成超时，请稍后在 Neowow 画布查看任务状态', { code: 'IMAGE_TASK_TIMEOUT' });
  await client.updateVideoNode(sessionId, nodeId, { status: 'FAILED', taskId, result: null, errorMessage: timeout.message }).catch(() => {});
  throw timeout;
}

export async function generateImage({
  config = {},
  projectName = '图片生成',
  prompt = '',
  referencePaths = [],
  model,
  ratio = '16:9',
  resolution,
  quality,
  onProgress,
  fetchImpl,
} = {}) {
  const client = createClient(config, { fetchImpl });
  const selectedModel = normalizeNeowowImageModel(model || config.neowowImageModel || config.neowowModel);
  const modelOptions = await client.listImageModels().catch(() => NEOWOW_IMAGE_MODELS);
  const selectedInfo = neowowImageModelOptions(modelOptions).find((item) => item.value === selectedModel);
  const selectedRatio = selectedInfo?.ratios?.includes(String(ratio || '').trim()) ? String(ratio).trim() : '16:9';
  const selectedResolution = normalizeNeowowImageResolution(resolution || config.neowowImageResolution, selectedModel, modelOptions);
  const selectedQuality = normalizeNeowowImageQuality(quality || config.neowowImageQuality, selectedModel, modelOptions);
  const sessionId = await client.ensureSession(`Freedom - 图片 - ${String(projectName || '图片生成').trim().slice(0, 60)}`);
  await client.reflowImageNodes(sessionId).catch(() => {});
  const indexes = await client.reserveImageLayoutIndexes(sessionId, 1);
  const index = indexes[0] ?? 0;
  let nodeId = '';
  try {
    onProgress?.('正在上传 Neowow 图片参考素材...');
    const maxReferenceImages = selectedInfo?.maxReferenceImages > 0 ? selectedInfo.maxReferenceImages : 9;
    const images = await Promise.all((Array.isArray(referencePaths) ? referencePaths : [referencePaths])
      .filter(Boolean).slice(0, Math.min(16, maxReferenceImages)).map((item) => client.uploadMedia(item, 'image')));
    nodeId = await client.createImageNode(sessionId, {
      prompt,
      model: selectedModel,
      models: modelOptions,
      aspectRatio: selectedRatio,
      resolution: selectedResolution,
      quality: selectedQuality,
      label: String(prompt || '图片生成').replace(/\s+/g, ' ').slice(0, 48),
    }, index, { images });
    const payload = buildNeowowImagePayload({
      nodeId,
      sessionId,
      prompt,
      model: selectedModel,
      models: modelOptions,
      ratio: selectedRatio,
      resolution: selectedResolution,
      quality: selectedQuality,
      imageUrls: images.map((item) => item.url),
    });
    onProgress?.('正在提交 Neowow 图片任务...');
    const submitted = apiData(await client.generateImage(payload)) || {};
    const taskId = String(firstValue(submitted, ['taskId', 'task_id', 'id']) || '').trim();
    if (!taskId) throw new NeowowError('Neowow 图片提交后没有返回 taskId', { code: 'IMAGE_TASK_ID_MISSING' });
    await client.updateVideoNode(sessionId, nodeId, {
      status: 'PENDING', taskId, prompt: payload.prompt, model: selectedModel,
      modelName: selectedInfo?.label || selectedModel, aspectRatio: selectedRatio, resolution: selectedResolution,
    });
    const result = await waitForNeowowImageTask(client, taskId, { sessionId, nodeId, onProgress });
    if (result.status !== 'done' || !result.imageUrl) {
      throw new NeowowError(result.fail || 'Neowow 图片任务完成但没有返回图片地址', { code: 'IMAGE_RESULT_MISSING' });
    }
    await client.reflowImageNodes(sessionId).catch(() => {});
    return {
      imageUrl: result.imageUrl,
      imageUrls: result.imageUrls,
      taskId,
      nodeId,
      sessionId,
      model: selectedModel,
      resolution: selectedResolution,
      quality: selectedQuality,
      ratio: selectedRatio,
    };
  } catch (error) {
    if (nodeId) await client.updateVideoNode(sessionId, nodeId, {
      status: 'FAILED', result: null, errorMessage: error?.message || String(error),
    }).catch(() => {});
    throw error;
  } finally {
    releaseNodeLayoutReservation(sessionId, index);
  }
}

export async function submitVideos({
  config = {},
  projectName = 'Freedom',
  episodeId = '',
  shots = [],
  model,
  resolution,
  onProgress,
  onSubmitProgress,
  onTaskSubmitted,
  fetchImpl,
} = {}) {
  const client = createClient(config, { fetchImpl });
  const sessionId = await client.ensureSession(`Freedom - ${String(projectName || '视频生成').trim()}`);
  await client.reflowVideoNodes(sessionId).catch(() => {});
  const layoutIndexes = await client.reserveNodeLayoutIndexes(sessionId, shots.length);
  let activityVideo = null;
  if (config.neowowAttachActivityVideo === true) {
    if (!fs.existsSync(NEOWOW_ACTIVITY_VIDEO_PATH)) {
      throw new NeowowError('Neowow 内置活动视频素材缺失，请重新安装或更新软件', {
        code: 'ACTIVITY_VIDEO_MISSING',
      });
    }
    onProgress?.('正在上传 Neowow 活动视频素材...');
    try {
      activityVideo = await client.uploadMedia(NEOWOW_ACTIVITY_VIDEO_PATH, 'video');
    } catch (error) {
      for (const index of layoutIndexes) releaseNodeLayoutReservation(sessionId, index);
      throw error;
    }
  }
  const results = new Array(shots.length);
  const state = { processed: 0, submitted: 0, failed: 0, total: shots.length };
  const emitState = () => onSubmitProgress?.({ ...state });
  emitState();
  await Promise.all(shots.map(async (shot, index) => {
    onProgress?.(`正在提交镜头 ${shot.shotNo} 到 Neowow...`);
    let nodeId = '';
    let submitId = '';
    let selectedModel = normalizeNeowowModel(shot.model || model || config.neowowModel);
    try {
      const capabilities = neowowVideoCapabilities(selectedModel);
      const [images, manualVideos, audios] = await Promise.all([
        Promise.all((shot.refImagePaths || []).slice(0, capabilities.maxImages).map((item) => client.uploadMedia(item, 'image'))),
        Promise.all((shot.refVideoPaths || []).slice(0, Math.max(0, capabilities.maxVideos - (activityVideo ? 1 : 0))).map((item) => client.uploadMedia(item, 'video'))),
        Promise.all((shot.refAudioPaths || []).slice(0, capabilities.maxAudios).map((item) => client.uploadMedia(item, 'audio'))),
      ]);
      const { attachedVideos: videos, promptVideos } = buildNeowowVideoAttachments(
        manualVideos,
        activityVideo,
        capabilities.maxVideos,
      );
      const selectedResolution = normalizeNeowowResolution(shot.resolution || resolution, selectedModel);
      nodeId = await client.createVideoNode(sessionId, {
        ...shot,
        episodeId,
        model: selectedModel,
        resolution: selectedResolution,
      }, layoutIndexes[index] ?? index, { images, videos, audios });
      const payload = buildNeowowVideoPayload({
        shot: { ...shot, model: selectedModel, resolution: selectedResolution },
        sessionId,
        nodeId,
        model: selectedModel,
        resolution: selectedResolution,
        media: {
          images: images.map((item) => item.url),
          videos: videos.map((item) => item.url),
          promptVideos: promptVideos.map((item) => item.url),
          audios: audios.map((item) => item.url),
        },
      });
      const submitted = apiData(await generateVideoWithReviewRetry(client, payload)) || {};
      submitId = String(firstValue(submitted, ['taskId', 'task_id', 'id']) || '').trim();
      if (!submitId) throw new NeowowError('Neowow 提交后没有返回 taskId');
      await onTaskSubmitted?.({
        ok: true,
        shotNo: shot.shotNo,
        submitId,
        historyId: nodeId,
        sessionId,
        model: payload.modelName,
      });
      await client.updateVideoNode(sessionId, nodeId, {
        status: 'PENDING',
        taskId: submitId,
        prompt: payload.prompt,
        result: null,
        universalModel: payload.modelName,
        universalDuration: String(payload.duration),
        universalResolution: payload.resolution,
        universalAspectRatio: payload.aspectRatio,
        universalEnableAudio: payload.generateAudio,
      });
      results[index] = {
        ok: true,
        shotNo: shot.shotNo,
        submitId,
        historyId: nodeId,
        sessionId,
        model: payload.modelName,
      };
      state.submitted += 1;
    } catch (error) {
      if (nodeId) {
        await client.updateVideoNode(sessionId, nodeId, {
          status: submitId ? 'PENDING' : 'FAILED',
          ...(submitId ? { taskId: submitId } : {}),
          result: null,
          errorMessage: error?.message || String(error),
        }).catch(() => {});
      }
      results[index] = {
        ok: Boolean(submitId),
        shotNo: shot.shotNo,
        ...(submitId ? {
          submitId,
          historyId: nodeId,
          sessionId,
          model: selectedModel,
        } : {}),
        error: error?.message || String(error),
        code: error?.code || 'NEOWOW_SUBMIT_FAILED',
      };
      if (submitId) state.submitted += 1;
      else state.failed += 1;
    } finally {
      releaseNodeLayoutReservation(sessionId, layoutIndexes[index]);
      state.processed += 1;
      emitState();
    }
  }));
  await client.reflowVideoNodes(sessionId).catch(() => {});
  onProgress?.(`Neowow 已提交 ${state.submitted}/${shots.length} 个镜头`);
  return results;
}

export async function recoverVideoTask({
  config = {},
  projectName = '',
  episodeId = '',
  shotNo = '',
  sessionId = '',
  fetchImpl,
} = {}) {
  const client = createClient(config, { fetchImpl });
  const resolvedSessionId = String(sessionId || '').trim()
    || await client.findSessionIdByTitle(`Freedom - ${String(projectName || '').trim()}`);
  if (!resolvedSessionId) return null;
  const detail = apiData(await client.getSession(resolvedSessionId)) || {};
  const candidates = (Array.isArray(detail.nodes) ? detail.nodes : [])
    .filter((node) => {
      const identity = neowowManagedNodeIdentity(node);
      return identity
        && String(identity.episodeId) === String(episodeId)
        && String(identity.shotNo) === String(shotNo);
    })
    .sort((left, right) => (Number(right?.data?.createdAt) || 0) - (Number(left?.data?.createdAt) || 0));
  for (const node of candidates) {
    const data = node?.data || {};
    const taskId = String(data.taskId || '').trim();
    const normalized = normalizeNeowowTaskResult({
      status: data.status,
      progress: data.progress,
      resultData: data.result,
      errorMessage: data.errorMessage,
    });
    const videoUrls = normalized.videoUrls || (normalized.videoUrl ? [normalized.videoUrl] : []);
    if (!taskId && !videoUrls.length) continue;
    return {
      submitId: taskId || `neowow-node:${node.id}`,
      historyId: String(node.id || ''),
      sessionId: resolvedSessionId,
      remoteProjectId: resolvedSessionId,
      status: normalized.status,
      videoUrl: videoUrls[0] || '',
      videoUrls,
      error: normalized.fail || '',
    };
  }
  return null;
}

export async function fetchVideoResults({ config = {}, submitIds = [], tasks = [], fetchImpl } = {}) {
  const ids = cleanStringList(submitIds, 100);
  if (!ids.length) return {};
  const client = createClient(config, { fetchImpl });
  const value = apiData(await client.queryVideoTasks(ids));
  const items = Array.isArray(value) ? value : [];
  const results = {};
  for (const item of items) {
    const taskId = String(item?.taskId || item?.task_id || '').trim();
    if (!taskId) continue;
    const normalized = normalizeNeowowTaskResult(item);
    results[taskId] = normalized;
    if (normalized.status === 'done' || normalized.status === 'failed') {
      const task = (Array.isArray(tasks) ? tasks : []).find((candidate) => String(candidate?.submitId || '') === taskId);
      const sessionId = String(task?.sessionId || task?.remoteProjectId || '').trim();
      const nodeId = String(task?.historyId || item?.nodeKey || '').trim();
      if (sessionId && nodeId) {
        await client.updateVideoNode(sessionId, nodeId, normalized.status === 'done'
          ? { status: 'SUCCESS', taskId, result: normalized.videoUrl || normalized.videoUrls?.[0] || null }
          : { status: 'FAILED', taskId, result: null, errorMessage: normalized.fail || '视频生成失败' })
          .catch(() => {});
      }
    }
  }
  for (const taskId of ids) {
    if (!results[taskId]) results[taskId] = { status: 'queued', note: 'Neowow 暂未返回任务状态' };
  }
  return results;
}
