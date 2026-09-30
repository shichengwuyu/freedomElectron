// 把下游播放不了的视频编码转成 H.264。
// 背景：部分视频模型（例如 dola-2.5-30）返回 HEVC，而 Electron/Chromium 内置解码器解不了 HEVC，
// 结果就是 app 内预览一片黑、但声音和时间轴正常。剪映能开 HEVC，所以只影响应用内预览。
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ffmpegPath, ffprobePath } from './config.js';

const execFileAsync = promisify(execFile);

// Chromium 能直接播的编码；不在这里面的就转成 h264。
const PLAYABLE_CODECS = new Set(['h264', 'avc1', 'vp8', 'vp9', 'av1', 'theora']);
const TRANSCODE_TIMEOUT_MS = 10 * 60 * 1000;

export async function probeVideoCodecName(filePath) {
  const { stdout } = await execFileAsync(ffprobePath(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  return String(stdout || '').trim().toLowerCase();
}

async function runFfmpegToFile(args, file) {
  await execFileAsync(ffmpegPath(), args, { windowsHide: true, timeout: TRANSCODE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size < 10 * 1024) throw new Error('转码产物为空');
  return stat.size;
}

// 需要时把 filePath 原地转成 H.264。返回 { transcoded, codec, error }。
// 任何一步失败都保留原文件 —— 宁可预览黑，也不能把用户的视频弄丢。
export async function ensurePlayableCodec(filePath) {
  let codec = '';
  try {
    codec = await probeVideoCodecName(filePath);
  } catch {
    return { transcoded: false, codec: '', error: '' };
  }
  if (!codec || PLAYABLE_CODECS.has(codec)) return { transcoded: false, codec, error: '' };

  const out = `${filePath}.h264.${Date.now()}.part.mp4`;
  const common = [
    '-y', '-v', 'error',
    '-i', filePath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-tag:v', 'avc1', '-movflags', '+faststart',
  ];
  try {
    // 音轨优先直接复制（无损）；个别容器复制不了就退回重编 aac。
    try {
      await runFfmpegToFile([...common, '-c:a', 'copy', out], out);
    } catch {
      await fs.promises.rm(out, { force: true }).catch(() => {});
      await runFfmpegToFile([...common, '-c:a', 'aac', '-b:a', '128k', out], out);
    }
    // 原子替换：同目录 rename，Windows 上也会覆盖已存在文件。
    await fs.promises.rename(out, filePath);
    // 落盘前是在 .part 临时文件上转的，日志里去掉临时后缀，免得看起来像残留文件。
    const shown = path.basename(filePath).replace(/\.[\d]+\.\w+\.part$/, '');
    console.log(`[video] 已把 ${codec} 转成 h264 以便应用内预览：${shown}`);
    return { transcoded: true, codec, error: '' };
  } catch (error) {
    await fs.promises.rm(out, { force: true }).catch(() => {});
    console.warn(`[video] ${codec} 转 h264 失败，保留原文件（应用内可能无法预览）：${error?.message || error}`);
    return { transcoded: false, codec, error: error?.message || String(error) };
  }
}
