// 参考素材 → 可供 vision 使用的帧。
// 视频：ffprobe 读元数据 + ffmpeg 均匀抽帧；图片：统一压成一张 JPEG。
// 抽帧产物落在 TEMP_DIR 下的临时目录，调用方必须负责 cleanupFrames()。
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { TEMP_DIR, ffmpegPath, ffprobePath } from './config.js';

const execFileAsync = promisify(execFile);

const MIN_FRAMES = 1;
// 上限 24：拉片模式按"每 15 秒节点 4 帧"算，90 秒的视频需要 24 帧。
const MAX_FRAMES = 24;
const DEFAULT_FRAMES = 8;
const DEFAULT_MAX_EDGE = 768;
// 首尾各留一点余量：很多成片的第 0 帧和最后一帧是黑帧/转场帧，抽到没有信息。
const EDGE_MARGIN_SECONDS = 0.3;

function assertBinary(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`找不到 ${label}：请确认已随应用打包（resources/vendor ffmpeg）`);
}

function evenFloor(value) {
  const n = Math.max(2, Math.round(value));
  return n % 2 === 0 ? n : n - 1;
}

async function runFfprobe(args) {
  const bin = ffprobePath();
  assertBinary(bin, 'ffprobe');
  return execFileAsync(bin, args, { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
}

async function runFfmpeg(args) {
  const bin = ffmpegPath();
  assertBinary(bin, 'ffmpeg');
  return execFileAsync(bin, args, { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
}

// execFile 失败时它只会说 "Command failed: <path>"，把 stderr 末尾带出来才有排查价值。
function execErrorTail(error) {
  const stderr = String(error?.stderr || '')
    .split('\n').map((line) => line.trim()).filter(Boolean).slice(-2).join(' / ');
  return stderr ? `（${stderr.slice(0, 160)}）` : '';
}

// ffprobe → { duration, width, height, fps, codec }；读不到就抛可读错误。
export async function probeVideo(videoPath) {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('参考视频文件不存在');
  let stdout;
  try {
    ({ stdout } = await runFfprobe([
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,codec_name:format=duration',
      '-of', 'json',
      videoPath,
    ]));
  } catch (error) {
    throw new Error(`这个文件读不出视频流，可能不是视频或已损坏${execErrorTail(error)}`);
  }
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw new Error('ffprobe 输出无法解析'); }
  const stream = (parsed.streams || [])[0];
  const duration = Number(parsed.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('这个文件读不出视频流，可能不是视频或已损坏');
  }
  const [num, den] = String(stream.r_frame_rate || '').split('/').map(Number);
  const fps = Number.isFinite(num) && Number.isFinite(den) && den > 0 ? Math.round((num / den) * 100) / 100 : 0;
  return {
    duration: Math.round(duration * 1000) / 1000,
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    fps,
    codec: String(stream.codec_name || ''),
  };
}

function scaleArgs(width, height, maxEdge) {
  const longest = Math.max(width || 0, height || 0);
  if (!longest || longest <= maxEdge) return null;
  const ratio = maxEdge / longest;
  return ['-vf', `scale=${evenFloor(width * ratio)}:${evenFloor(height * ratio)}`];
}

function newWorkDir(prefix) {
  const dir = path.join(TEMP_DIR, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function fileToDataUrl(filePath, mime = 'image/jpeg') {
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// 视频直读（把整段视频作为 content part 发给支持视频输入的模型）时的内联上限。
// base64 会让体积涨约 1/3，网关对请求体普遍有上限，所以超限就必须退回抽帧。
export const INLINE_VIDEO_MAX_BYTES = 8 * 1024 * 1024;

export function videoFileToDataUrl(filePath, { maxBytes = INLINE_VIDEO_MAX_BYTES } = {}) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('参考视频文件不存在');
  const size = fs.statSync(filePath).size;
  if (size > maxBytes) {
    const mb = (size / 1024 / 1024).toFixed(1);
    const cap = (maxBytes / 1024 / 1024).toFixed(0);
    throw new Error(`视频 ${mb}MB 超过内联上限 ${cap}MB，请改用抽帧方式分析`);
  }
  return fileToDataUrl(filePath, 'video/mp4');
}

function frameTimestamps(duration, count) {
  if (duration <= EDGE_MARGIN_SECONDS * 2) return [duration / 2];
  const start = EDGE_MARGIN_SECONDS;
  const end = duration - EDGE_MARGIN_SECONDS;
  const total = Math.max(1, Math.min(MAX_FRAMES, Math.floor(count) || DEFAULT_FRAMES));
  if (total === 1) return [start + (end - start) / 2];
  const step = (end - start) / (total - 1);
  return Array.from({ length: total }, (_, i) => Math.round((start + step * i) * 1000) / 1000);
}

// 均匀抽帧并压到最长边 maxEdge 以内，返回 [{ file, t, dataUrl }]。
export async function extractFrames(videoPath, { count = DEFAULT_FRAMES, maxEdge = DEFAULT_MAX_EDGE } = {}) {
  const meta = await probeVideo(videoPath);
  const dir = newWorkDir('ref-frames');
  const scale = scaleArgs(meta.width, meta.height, maxEdge);
  const stamps = frameTimestamps(meta.duration, count);
  const frames = [];
  try {
    for (let i = 0; i < stamps.length; i += 1) {
      const file = path.join(dir, `frame-${String(i).padStart(2, '0')}.jpg`);
      try {
        await runFfmpeg([
          '-y', '-v', 'error',
          '-ss', String(stamps[i]),
          '-i', videoPath,
          '-frames:v', '1',
          ...(scale || []),
          '-q:v', '3',
          file,
        ]);
      } catch (error) {
        throw new Error(`抽取第 ${i + 1}/${stamps.length} 帧失败${execErrorTail(error)}`);
      }
      if (!fs.existsSync(file)) continue;
      frames.push({ file, t: stamps[i], dataUrl: fileToDataUrl(file) });
    }
  } catch (error) {
    cleanupFrames(frames, dir);
    throw error;
  }
  if (!frames.length) {
    cleanupFrames(frames, dir);
    throw new Error('抽帧失败，没有取到任何有效画面');
  }
  return { frames, meta, dir };
}

// 图片：统一压成一张 JPEG（png/webp/超大图都能吃），返回与视频同形的结果。
export async function normalizeImageFile(imagePath, { maxEdge = DEFAULT_MAX_EDGE } = {}) {
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error('参考图片文件不存在');
  const dir = newWorkDir('ref-image');
  const file = path.join(dir, 'image.jpg');
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', imagePath,
  ]).catch(() => ({ stdout: '{}' }));
  let width = 0;
  let height = 0;
  try {
    const stream = (JSON.parse(stdout).streams || [])[0];
    width = Number(stream?.width) || 0;
    height = Number(stream?.height) || 0;
  } catch { /* 读不到尺寸就按原图编码 */ }
  const scale = scaleArgs(width, height, maxEdge);
  try {
    await runFfmpeg(['-y', '-v', 'error', '-i', imagePath, ...(scale || []), '-q:v', '3', '-frames:v', '1', file]);
  } catch (error) {
    cleanupFrames([], dir);
    throw new Error(`参考图片无法解码${execErrorTail(error)}`);
  }
  if (!fs.existsSync(file)) {
    cleanupFrames([], dir);
    throw new Error('参考图片无法解码');
  }
  const frame = { file, t: 0, dataUrl: fileToDataUrl(file) };
  return { frames: [frame], meta: { duration: 0, width, height, fps: 0, codec: 'image' }, dir };
}

// 删除抽帧产物。dir 可省略（会用第一个帧文件的目录兜底）。
export function cleanupFrames(frames = [], dir = '') {
  const target = dir || path.dirname((frames[0] || {}).file || '');
  if (!target) return;
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
}

export const FRAME_LIMITS = Object.freeze({ min: MIN_FRAMES, max: MAX_FRAMES, default: DEFAULT_FRAMES, maxEdge: DEFAULT_MAX_EDGE });
