import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { normalizeVideoImageUpload } from './channelProfiles.js';
import { ffmpegPath } from './config.js';

const execFileAsync = promisify(execFile);

const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
// 参考视频/音频动辄几十 MB，用图片的 2 分钟超时会必然掐断。
const MEDIA_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// catbox/litterbox 单文件上限 1GB，这里留个 200MB 的保守上界。
const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

// 参考图常见 1920x1088 的 PNG，单张 3~5MB；上行只有 ~0.15MB/s 的线路上一张要传 20~40 秒。
// 上传前先本地缩到长边 1280 并转 JPEG，体积降一个数量级，上传时间同比缩短；失败一律回退原图。
const COMPRESS_MIN_BYTES = 600 * 1024;
const COMPRESS_MAX_EDGE = 1280;
const COMPRESS_JPEG_QUALITY = 3; // ffmpeg -q:v，约等于 JPEG q85

// 参考图上传是提交前的必经步骤，上行抖动（ECONNRESET / 连接超时 / socket hang up）一次就废掉整个镜头太亏，
// 这里对网络类错误退避重试；鉴权、体积、配置这类错误重试没有意义，直接抛。
// 退避给到约 27 秒：实测过走代理时 COS 会出现持续几秒的连接重置，原来只有 1s/3s 两次退避（约 4 秒）跨不过去。
const UPLOAD_RETRY_DELAYS_MS = [1000, 3000, 8000, 15000];

function isRetryableUploadError(error) {
  const text = `${error?.message || ''} ${error?.cause?.code || ''} ${error?.cause?.message || ''}`;
  if (/文件为空|文件不存在|超过 \d+MB|未启用|配置不完整|请填写|不是视频 API 可访问的公网 URL/.test(text)) return false;
  if (/\((?:400|401|403|404|413)\)/.test(text)) return false;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|UND_ERR|socket hang up|fetch failed|无响应|超时/i.test(text);
}

async function withUploadRetry(run) {
  let lastError = null;
  for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= UPLOAD_RETRY_DELAYS_MS.length || !isRetryableUploadError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
};
const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
};

function rawReference(value) {
  return String(value && typeof value === 'object'
    ? (value.filePath || value.path || value.localPath || value.url || value.dataUrl || '')
    : (value || '')).trim();
}

function mediaSizeLimit(contentType = '') {
  return String(contentType).startsWith('image/') ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
}

function ensureMediaSize(length, contentType, label = '素材') {
  const limit = mediaSizeLimit(contentType);
  const mb = Math.round(limit / 1024 / 1024);
  if (!length) throw new Error(`${label}文件为空`);
  if (length > limit) throw new Error(`${label}超过 ${mb}MB，无法通过图床中转上传`);
}

// 图床（catbox/litterbox/自定义/S3）本身都能装视频与音频，所以参考视频/参考音频
// 也走同一条上传链路；是否压缩只对图片生效。kind 只用来组织报错文案。
async function readMediaSource(value, kind = 'image') {
  const label = kind === 'video' ? '参考视频' : (kind === 'audio' ? '参考音频' : '图片');
  const raw = rawReference(value);
  const dataMatch = raw.match(/^data:((?:image|video|audio)\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (dataMatch) {
    const contentType = dataMatch[1].toLowerCase();
    const bytes = Buffer.from(dataMatch[2].replace(/\s+/g, ''), 'base64');
    ensureMediaSize(bytes.length, contentType, label);
    return { bytes, contentType, extension: EXT_BY_MIME[contentType] || '.bin', isImage: contentType.startsWith('image/') };
  }
  const stat = await fs.promises.stat(raw).catch(() => null);
  if (!stat?.isFile()) throw new Error(`${label}文件不存在：${raw}`);
  const extension = path.extname(raw).toLowerCase();
  const contentType = MIME_BY_EXT[extension] || 'application/octet-stream';
  ensureMediaSize(stat.size, contentType, label);
  const bytes = await fs.promises.readFile(raw);
  ensureMediaSize(bytes.length, contentType, label);
  return {
    bytes,
    contentType,
    extension: MIME_BY_EXT[extension] ? extension : '.bin',
    isImage: contentType.startsWith('image/'),
  };
}

function pngHasAlpha(bytes) {
  return bytes.length > 26
    && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a'
    && (bytes[25] === 4 || bytes[25] === 6);
}

// 参考图上传前压小：长边超过 1280 的缩到 1280，不透明图转 JPEG（带透明的 PNG 保持 PNG，避免压成黑底）。
// 任何一步失败都返回原图——压图只是为了省上传时间，不该让提交流程失败。
async function compressImageSource(source) {
  if (!source.isImage) return source;
  if (source.bytes.length <= COMPRESS_MIN_BYTES) return source;
  const keepPng = pngHasAlpha(source.bytes);
  const tag = crypto.randomUUID();
  const inPath = path.join(os.tmpdir(), `video-ref-src-${tag}`);
  const outPath = path.join(os.tmpdir(), `video-ref-small-${tag}${keepPng ? '.png' : '.jpg'}`);
  try {
    await fs.promises.writeFile(inPath, source.bytes);
    const filter = `scale='if(gt(iw,ih),min(${COMPRESS_MAX_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${COMPRESS_MAX_EDGE},ih))'`;
    const args = ['-y', '-i', inPath, '-vf', filter, '-frames:v', '1'];
    if (!keepPng) args.push('-q:v', String(COMPRESS_JPEG_QUALITY));
    await execFileAsync(ffmpegPath(), [...args, outPath], { timeout: 60000 });
    const bytes = await fs.promises.readFile(outPath);
    if (!bytes.length || bytes.length >= source.bytes.length) return source;
    return {
      bytes,
      contentType: keepPng ? 'image/png' : 'image/jpeg',
      extension: keepPng ? '.png' : '.jpg',
      isImage: true,
    };
  } catch {
    return source;
  } finally {
    try { fs.rmSync(inPath, { force: true }); } catch { /* 忽略 */ }
    try { fs.rmSync(outPath, { force: true }); } catch { /* 忽略 */ }
  }
}

function uploadFileName(source) {
  return `video-reference-${crypto.randomUUID()}${source.extension}`;
}

function responseMessage(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return String(parsed?.message || parsed?.error || parsed?.msg || value).slice(0, 500);
  } catch {
    return value.slice(0, 500);
  }
}

// undici 把真正的原因放在 error.cause 里（UND_ERR_SOCKET / ECONNRESET / ENOTFOUND / 证书错误…），
// 只取 error.message 就只剩一句「fetch failed」，用户根本没法判断是网络、DNS 还是图床挂了。
export function describeFetchError(error) {
  if (!error) return '未知错误';
  const cause = error.cause;
  const code = String(cause?.code || cause?.errno || '').trim();
  const causeMessage = String(cause?.message || '').trim();
  const detail = code || causeMessage;
  const message = String(error.message || error).trim() || '未知错误';
  return detail ? `${message}（${detail}）` : message;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = UPLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`图片中转上传超时（${Math.round(timeoutMs / 1000)} 秒无响应）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// 统一补上「哪一步 + 底层原因」，避免失败原因只有一句 "fetch failed"。
async function uploadFetch(label, url, options, timeoutMs = UPLOAD_TIMEOUT_MS) {
  try {
    return await fetchWithTimeout(url, options, timeoutMs);
  } catch (error) {
    throw new Error(`${label}失败：${describeFetchError(error)}`);
  }
}

function valueAtPath(value, configuredPath) {
  const segments = String(configuredPath || '').trim().replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return segments.reduce((current, segment) => current?.[segment], value);
}

function findUrlValue(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string') return /^https?:\/\//i.test(value.trim()) ? value.trim() : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrlValue(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['url', 'imageUrl', 'image_url', 'downloadUrl', 'download_url', 'link', 'src']) {
    const found = findUrlValue(value[key], depth + 1);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = findUrlValue(child, depth + 1);
    if (found) return found;
  }
  return '';
}

function isPrivateIpv4(hostname) {
  const match = String(hostname || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [, a, b] = match.map(Number);
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function ensurePublicImageUrl(value, baseUrl = '') {
  let url;
  try {
    url = new URL(String(value || '').trim(), baseUrl || undefined);
  } catch {
    throw new Error('图片上传成功，但返回结果中没有有效的图片 URL');
  }
  const hostname = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || hostname === 'localhost' || hostname === '::1' || isPrivateIpv4(hostname)) {
    throw new Error('图片上传返回的不是视频 API 可访问的公网 URL');
  }
  return url.toString();
}

function returnedUploadUrl(text, config) {
  const compact = String(text || '').trim();
  if (/^https?:\/\//i.test(compact)) return ensurePublicImageUrl(compact, config.endpoint);
  let json;
  try {
    json = JSON.parse(compact);
  } catch {
    throw new Error('图片上传接口没有返回可识别的 JSON 或 URL');
  }
  const configured = config.customUrlPath ? valueAtPath(json, config.customUrlPath) : '';
  const found = config.customUrlPath
    ? (typeof configured === 'string' ? configured : findUrlValue(configured))
    : findUrlValue(json);
  if (!found && config.customUrlPath) throw new Error(`图片上传响应中找不到 ${config.customUrlPath}`);
  if (!found) throw new Error('图片上传成功，但返回结果中没有图片 URL');
  return ensurePublicImageUrl(found, config.endpoint);
}

async function uploadMultipart(source, config) {
  const form = new FormData();
  const fileName = uploadFileName(source);
  form.append(config.customFileField, new Blob([source.bytes], { type: source.contentType }), fileName);
  const headers = {};
  if (config.customToken) {
    headers[config.customAuthHeader] = [config.customAuthScheme, config.customToken].filter(Boolean).join(' ');
  }
  const endpoint = config.endpoint;
  if (!endpoint) throw new Error('请填写自定义图片上传地址');
  const response = await uploadFetch('图片上传', endpoint, { method: 'POST', headers, body: form }, config.__timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(`图片上传失败 (${response.status})：${responseMessage(text) || '服务无响应'}`);
  return returnedUploadUrl(text, config);
}

async function uploadFreeImageOnce(source, config, provider) {
  const form = new FormData();
  const file = new Blob([source.bytes], { type: source.contentType });
  const fileName = uploadFileName(source);
  let endpoint;
  if (provider === 'imgbb') {
    if (!config.imgbbApiKey) throw new Error('请填写 ImgBB 免费 API Key');
    const url = new URL('https://api.imgbb.com/1/upload');
    url.searchParams.set('key', config.imgbbApiKey);
    endpoint = url.toString();
    form.append('image', file, fileName);
  } else if (provider === 'uguu') {
    endpoint = 'https://uguu.se/upload.php';
    form.append('files[]', file, fileName);
  } else {
    endpoint = 'https://litterbox.catbox.moe/resources/internals/api.php';
    form.append('reqtype', 'fileupload');
    form.append('time', config.freeExpiry);
    form.append('fileToUpload', file, fileName);
  }
  const response = await uploadFetch(`图床（${provider}）`, endpoint, {
    method: 'POST',
    headers: { 'User-Agent': 'YanzhiAI/1.0' },
    body: form,
  }, config.__timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(`免费图床上传失败 (${response.status})：${responseMessage(text) || '服务无响应'}`);
  return returnedUploadUrl(text, { ...config, endpoint });
}

async function uploadFreeImage(source, config) {
  const preferred = config.freeProvider === 'auto'
    ? [...(config.imgbbApiKey ? ['imgbb'] : []), 'litterbox', 'uguu']
    : [config.freeProvider];
  // ImgBB 只收图片，参考视频/音频会被它直接拒掉，所以非图片素材从链路里剔除。
  const providers = source.isImage ? preferred : preferred.filter((provider) => provider !== 'imgbb');
  if (!providers.length) providers.push('litterbox');
  const failures = [];
  let lastError = null;
  for (const provider of providers) {
    try {
      return await uploadFreeImageOnce(source, config, provider);
    } catch (error) {
      lastError = error;
      failures.push(`${provider}: ${error.message}`);
    }
  }
  if (providers.length === 1 && lastError) throw lastError;
  throw new Error(`免费图床均不可用：${failures.join('；')}`);
}

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value).digest(encoding);
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodedObjectPath(key) {
  return `/${String(key).split('/').map(awsEncode).join('/')}`;
}

function normalizedPrefix(value) {
  return String(value || 'video-api').split(/[\\/]+/).map((segment) => (
    segment.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  )).filter(Boolean).join('/') || 'video-api';
}

function objectKey(config, source) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return `${normalizedPrefix(config.pathPrefix)}/${day}/${uploadFileName(source)}`;
}

function requireFields(config, fields) {
  const missing = fields.filter((field) => !String(config[field] || '').trim());
  if (missing.length) throw new Error(`图片中转配置不完整：缺少 ${missing.join('、')}`);
}

function s3Target(config, key) {
  const objectPath = encodedObjectPath(key);
  if (config.provider === 'cloudflare-r2') {
    requireFields(config, ['accountId', 'bucket']);
    return new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${awsEncode(config.bucket)}${objectPath}`);
  }
  if (config.provider === 'tencent-cos') {
    requireFields(config, ['bucket', 'region']);
    return new URL(`https://${config.bucket}.cos.${config.region}.myqcloud.com${objectPath}`);
  }
  requireFields(config, ['bucket', 'region']);
  return new URL(`https://${config.bucket}.s3.${config.region}.amazonaws.com${objectPath}`);
}

function s3Region(config) {
  return config.provider === 'cloudflare-r2' ? 'auto' : config.region;
}

function signingKey(secretAccessKey, dateStamp, region) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function amzTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function s3PutHeaders(config, target, source) {
  const timestamp = amzTimestamp();
  const dateStamp = timestamp.slice(0, 8);
  const region = s3Region(config);
  const payloadHash = sha256(source.bytes);
  const headers = {
    'content-type': source.contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': timestamp,
  };
  if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;
  const signedNames = ['content-type', 'host', 'x-amz-content-sha256', 'x-amz-date', ...(config.sessionToken ? ['x-amz-security-token'] : [])].sort();
  const values = { ...headers, host: target.host };
  const canonicalHeaders = signedNames.map((name) => `${name}:${String(values[name]).trim()}\n`).join('');
  const canonicalRequest = ['PUT', target.pathname, '', canonicalHeaders, signedNames.join(';'), payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp, region), stringToSign, 'hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;
  return headers;
}

function signedS3GetUrl(config, target) {
  const timestamp = amzTimestamp();
  const dateStamp = timestamp.slice(0, 8);
  const region = s3Region(config);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(config.signedUrlTtlHours * 3600),
    'X-Amz-SignedHeaders': 'host',
  };
  if (config.sessionToken) params['X-Amz-Security-Token'] = config.sessionToken;
  const canonicalQuery = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join('&');
  const canonicalRequest = ['GET', target.pathname, canonicalQuery, `host:${target.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp, region), stringToSign, 'hex');
  return `${target.origin}${target.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function publicObjectUrl(config, key, fallback) {
  if (!config.publicBaseUrl) return fallback;
  return ensurePublicImageUrl(`${config.publicBaseUrl}/${key.split('/').map(awsEncode).join('/')}`);
}

async function uploadS3Compatible(source, config) {
  requireFields(config, ['accessKeyId', 'secretAccessKey']);
  const key = objectKey(config, source);
  const target = s3Target(config, key);
  const response = await uploadFetch('云存储上传', target, {
    method: 'PUT',
    headers: s3PutHeaders(config, target, source),
    body: source.bytes,
  }, config.__timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(`云存储上传失败 (${response.status})：${responseMessage(text) || '请检查存储桶和密钥'}`);
  return publicObjectUrl(config, key, signedS3GetUrl(config, target));
}

function ossRegion(value) {
  return String(value || '').trim().replace(/^oss-/i, '');
}

function ossSignature(secret, text) {
  return crypto.createHmac('sha1', secret).update(text).digest('base64');
}

function signedOssGetUrl(config, target, key) {
  const expires = Math.floor(Date.now() / 1000) + (config.signedUrlTtlHours * 3600);
  const tokenQuery = config.sessionToken ? `?security-token=${config.sessionToken}` : '';
  const resource = `/${config.bucket}/${key}${tokenQuery}`;
  const signature = ossSignature(config.secretAccessKey, `GET\n\n\n${expires}\n${resource}`);
  target.searchParams.set('OSSAccessKeyId', config.accessKeyId);
  target.searchParams.set('Expires', String(expires));
  target.searchParams.set('Signature', signature);
  if (config.sessionToken) target.searchParams.set('security-token', config.sessionToken);
  return target.toString();
}

async function uploadAliyunOss(source, config) {
  requireFields(config, ['bucket', 'region', 'accessKeyId', 'secretAccessKey']);
  const key = objectKey(config, source);
  const target = new URL(`https://${config.bucket}.oss-${ossRegion(config.region)}.aliyuncs.com${encodedObjectPath(key)}`);
  const date = new Date().toUTCString();
  const ossHeaders = config.sessionToken ? `x-oss-security-token:${config.sessionToken}\n` : '';
  const resource = `/${config.bucket}/${key}`;
  const stringToSign = `PUT\n\n${source.contentType}\n${date}\n${ossHeaders}${resource}`;
  const headers = {
    'content-type': source.contentType,
    date,
    authorization: `OSS ${config.accessKeyId}:${ossSignature(config.secretAccessKey, stringToSign)}`,
  };
  if (config.sessionToken) headers['x-oss-security-token'] = config.sessionToken;
  const response = await uploadFetch('阿里云 OSS 上传', target, { method: 'PUT', headers, body: source.bytes }, config.__timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(`阿里云 OSS 上传失败 (${response.status})：${responseMessage(text) || '请检查存储桶和密钥'}`);
  return publicObjectUrl(config, key, signedOssGetUrl(config, new URL(target), key));
}

export function imageUploadEnabled(value = {}) {
  return normalizeVideoImageUpload(value).provider !== 'none';
}

// 参考素材上传：图片/视频/音频走同一条链路，只是图片会先压缩、视频音频给更长的超时。
export async function uploadVideoApiMedia(value, settings = {}, kind = 'image') {
  const raw = rawReference(value);
  if (/^https?:\/\//i.test(raw)) return ensurePublicImageUrl(raw);
  const normalized = normalizeVideoImageUpload(settings);
  if (normalized.provider === 'none') throw new Error('图床未启用');
  const source = await readMediaSource(value, kind);
  const config = {
    ...normalized,
    // isImage 决定要不要走 ffmpeg 压图；超时按素材类型放宽。
    __timeoutMs: source.isImage ? UPLOAD_TIMEOUT_MS : MEDIA_UPLOAD_TIMEOUT_MS,
  };
  const prepared = source.isImage ? await compressImageSource(source) : source;
  return withUploadRetry(() => {
    if (config.provider === 'free') return uploadFreeImage(prepared, config);
    if (config.provider === 'custom') return uploadMultipart(prepared, config);
    if (config.provider === 'aliyun-oss') return uploadAliyunOss(prepared, config);
    return uploadS3Compatible(prepared, config);
  });
}

export async function uploadVideoApiImage(value, settings = {}) {
  return uploadVideoApiMedia(value, settings, 'image');
}

export async function verifyVideoApiImageUrl(value) {
  const url = ensurePublicImageUrl(value);
  const response = await uploadFetch('图片公网链接读取', url, {
    method: 'GET',
    headers: { Accept: 'image/*', 'User-Agent': 'YanzhiAI/1.0' },
  });
  if (!response.ok) throw new Error(`图片已上传，但公网链接读取失败 (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('图片已上传，但公网链接返回了空文件');
  return {
    url,
    bytes: bytes.length,
    contentType: String(response.headers.get('content-type') || '').split(';')[0].trim(),
  };
}
