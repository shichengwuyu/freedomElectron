// 音频处理：保留上传音频的完整时长，仅转为统一的播放格式。
// Shared audio helpers used by upload routes.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ffmpegPath } from './config.js';

const execFileAsync = promisify(execFile);

// 清洗前端传来的 base64（去掉 data:URL 前缀与空白）
export function cleanFileB64(value) {
  const raw = String(value || '').trim();
  const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
  if (!b64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return '';
  return b64.replace(/\s+/g, '');
}

// 根据文件名/MIME 推断安全的音频扩展名
export function safeAudioExt(name, mime = '') {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm', '.flac', '.mp4', '.mov'].includes(ext)) return ext;
  if (/wav/i.test(mime)) return '.wav';
  if (/mpeg|mp3/i.test(mime)) return '.mp3';
  if (/webm/i.test(mime)) return '.webm';
  if (/ogg/i.test(mime)) return '.ogg';
  if (/flac/i.test(mime)) return '.flac';
  return '.audio';
}

// 不移除静音、不偏移起点、不限制时长，只统一输出单声道 44.1k MP3。
export async function normalizeVoiceAudio(inputPath, outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(ffmpegPath(), [
    '-y',
    '-hide_banner',
    '-i', inputPath,
    '-map', '0:a:0',
    '-vn',
    '-ac', '1',
    '-ar', '44100',
    '-c:a', 'libmp3lame',
    '-b:a', '128k',
    '-f', 'mp3',
    outputPath,
  ], { timeout: 120000, maxBuffer: 1024 * 1024 * 8 });
  return { preservedDuration: true };
}
