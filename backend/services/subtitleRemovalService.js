import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { ffmpegPath } from '../config.js';
import {
  loadProject,
  normalizeProjectScript,
  projectDir,
  sanitizeFilename,
  saveProject,
} from '../storage.js';
import {
  cleanupSupersededVideoFiles,
  nextVideoWritePath,
  videoDiskPath,
  videoFileEntryExists,
} from '../videoFunctions.js';
import { videoLocalUrl } from '../shotVideoUtils.js';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROCESS_TIMEOUT_MS = 60 * 60 * 1000;
const activeSubtitleRemovals = new Map();
const QUALITY_PRESETS = Object.freeze({
  quick: { preset: 'veryfast', crf: 22 },
  fine: { preset: 'medium', crf: 18 },
  cinema: { preset: 'slow', crf: 16 },
});

function clamp(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function backupFiles(projectId, episodeId, shotNo) {
  const dir = path.join(projectDir(projectId), 'video-backups', sanitizeFilename(String(episodeId)));
  const stem = `${sanitizeFilename(String(shotNo))}.subtitle-original`;
  return {
    dir,
    video: path.join(dir, `${stem}.mp4`),
    meta: path.join(dir, `${stem}.json`),
  };
}

function readBackupMeta(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.part`;
  await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.promises.rm(filePath, { force: true }).catch(() => {});
  await fs.promises.rename(tempPath, filePath);
}

async function copyFileAtomic(sourcePath, targetPath) {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.part`;
  try {
    await fs.promises.copyFile(sourcePath, tempPath);
    await fs.promises.rm(targetPath, { force: true }).catch(() => {});
    await fs.promises.rename(tempPath, targetPath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function videoInfo(filePath) {
  let stderr = '';
  try {
    await execFileAsync(ffmpegPath(), ['-hide_banner', '-i', filePath], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    stderr = String(error?.stderr || error?.message || '');
  }
  const videoLine = stderr.split(/\r?\n/).find((line) => line.includes('Video:')) || '';
  const match = videoLine.match(/(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,\[])/);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32) {
    throw new Error('无法读取视频画面尺寸');
  }
  const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s+fps\b/i)
    || videoLine.match(/(\d+(?:\.\d+)?)\s+tbr\b/i);
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const duration = durationMatch
    ? (Number(durationMatch[1]) * 3600) + (Number(durationMatch[2]) * 60) + Number(durationMatch[3])
    : 0;
  const fps = clamp(fpsMatch?.[1], 30, 1, 240);
  return {
    width,
    height,
    fps,
    duration,
    totalFrames: Math.max(1, Math.round(duration * fps)),
  };
}

function subtitleInpaintBundle() {
  const directories = [];
  if (process.resourcesPath) directories.push(path.join(process.resourcesPath, 'subtitle-inpaint'));
  directories.push(path.join(ROOT, 'vendor', 'subtitle-inpaint'));
  for (const directory of directories) {
    const executable = path.join(directory, process.platform === 'win32' ? 'subtitle-inpaint.exe' : 'subtitle-inpaint');
    const model = path.join(directory, 'migan_pipeline.onnx');
    if (fs.existsSync(executable) && fs.existsSync(model)) return { executable, model };
  }
  throw new Error('轻量级字幕修复组件不完整');
}

function progressKey(projectId, episodeId, shotNo) {
  return `${projectId}\u0000${episodeId}\u0000${shotNo}`;
}

function runTrackedProcess(command, args, onStdoutLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdoutBuffer = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('处理超时'));
    }, PROCESS_TIMEOUT_MS);

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const emitLines = (flush = false) => {
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = flush ? '' : (lines.pop() || '');
      for (const line of lines) onStdoutLine?.(line.trim());
      if (flush && stdoutBuffer.trim()) onStdoutLine?.(stdoutBuffer.trim());
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      emitLines();
    });
    child.stdout.on('end', () => emitLines(true));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-16 * 1024 * 1024);
    });
    child.on('error', finish);
    child.on('close', (code, signal) => {
      if (code === 0) return finish();
      const error = new Error(stderr.trim() || `处理程序异常退出${signal ? `（${signal}）` : ''}`);
      error.stderr = stderr;
      return finish(error);
    });
  });
}

async function runNaturalInpaint(sourcePath, stagingPath, options, encoding, info, onProgress) {
  const bundle = subtitleInpaintBundle();
  await runTrackedProcess(bundle.executable, [
    '--input', sourcePath,
    '--output', stagingPath,
    '--ffmpeg', ffmpegPath(),
    '--model', bundle.model,
    '--width', String(options.frameWidth),
    '--height', String(options.frameHeight),
    '--fps', String(info.fps),
    '--total-frames', String(info.totalFrames),
    '--x', String(options.x),
    '--y', String(options.y),
    '--region-width', String(options.width),
    '--region-height', String(options.height),
    '--preset', encoding.preset,
    '--crf', String(encoding.crf),
  ], (line) => {
    const match = line.match(/^PROGRESS:(\d+):(\d+)$/);
    if (match) onProgress(Number(match[1]), Number(match[2]));
  });
}

async function runFastRemoval(sourcePath, stagingPath, options, encoding, info, onProgress) {
  await runTrackedProcess(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', sourcePath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', subtitleRemovalFilter(options),
    '-c:v', 'libx264',
    '-preset', encoding.preset,
    '-crf', String(encoding.crf),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-sn', '-dn',
    '-map_metadata', '0',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    stagingPath,
  ], (line) => {
    const match = line.match(/^frame=(\d+)$/);
    if (match) onProgress(Number(match[1]), info.totalFrames);
  });
}

async function assertReadableVideo(filePath) {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size < 10 * 1024) throw new Error('去字幕结果为空或不完整');
  await execFileAsync(ffmpegPath(), [
    '-v', 'error',
    '-i', filePath,
    '-map', '0:v:0',
    '-frames:v', '1',
    '-f', 'null',
    '-',
  ], {
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function persistVideoUrl(projectId, episodeId, shotNo, videoUrl, subtitleRemoval = null) {
  const project = loadProject(projectId);
  if (!project) throw new Error('项目不存在');
  normalizeProjectScript(project);
  const storyboard = project.script?.storyboards?.find((item) => String(item.episodeId) === String(episodeId));
  if (!storyboard) throw new Error('当前分镜集不存在');
  if (!storyboard.shotVideos || typeof storyboard.shotVideos !== 'object') storyboard.shotVideos = {};
  storyboard.shotVideos[String(shotNo)] = {
    videoUrl,
    updatedAt: new Date().toISOString(),
    ...(subtitleRemoval ? { subtitleRemoval } : {}),
  };
  project.updatedAt = new Date().toISOString();
  saveProject(project);
}

export function normalizeSubtitleRemovalOptions(options = {}, dimensions = {}) {
  const topPercent = clamp(options.topPercent, 76, 1, 96);
  const bottomPercent = clamp(options.bottomPercent, 96, topPercent + 3, 99);
  const widthPercent = clamp(options.widthPercent, 88, 6, 98);
  const leftPercent = clamp(options.leftPercent, (100 - widthPercent) / 2, 1, 99 - widthPercent);
  const method = ['precision', 'fast'].includes(options.method) ? options.method : 'precision';
  const quality = Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, options.quality) ? options.quality : 'fine';
  const width = Math.round(clamp(dimensions.width, 0, 32, 16384));
  const height = Math.round(clamp(dimensions.height, 0, 32, 16384));
  if (!width || !height) return { topPercent, bottomPercent, leftPercent, widthPercent, method, quality };

  const padding = Math.max(2, Math.round(Math.min(width, height) * 0.006));
  let x = Math.round(width * (leftPercent / 100)) - padding;
  let y = Math.round(height * (topPercent / 100)) - padding;
  let regionWidth = Math.round(width * (widthPercent / 100)) + (padding * 2);
  let regionHeight = Math.round(height * ((bottomPercent - topPercent) / 100)) + (padding * 2);
  x = Math.max(1, Math.min(width - 4, x));
  y = Math.max(1, Math.min(height - 4, y));
  regionWidth = Math.max(3, Math.min(width - x - 1, regionWidth));
  regionHeight = Math.max(3, Math.min(height - y - 1, regionHeight));

  return {
    topPercent,
    bottomPercent,
    leftPercent,
    widthPercent,
    method,
    quality,
    frameWidth: width,
    frameHeight: height,
    x,
    y,
    width: regionWidth,
    height: regionHeight,
  };
}

export function subtitleRemovalFilter(options, maskFilename = '') {
  if (options.method === 'precision' && maskFilename) {
    return `removelogo=filename='${maskFilename}'`;
  }
  return `delogo=x=${options.x}:y=${options.y}:w=${options.width}:h=${options.height}`;
}

async function writeRemovalMask(filePath, options) {
  const pixels = Buffer.alloc(options.frameWidth * options.frameHeight);
  const endY = Math.min(options.frameHeight, options.y + options.height);
  const endX = Math.min(options.frameWidth, options.x + options.width);
  for (let y = options.y; y < endY; y += 1) {
    const row = y * options.frameWidth;
    pixels.fill(255, row + options.x, row + endX);
  }
  const header = Buffer.from(`P5\n${options.frameWidth} ${options.frameHeight}\n255\n`, 'ascii');
  await fs.promises.writeFile(filePath, Buffer.concat([header, pixels]));
}

function currentBackupState(projectId, episodeId, shotNo) {
  const files = backupFiles(projectId, episodeId, shotNo);
  const meta = readBackupMeta(files.meta);
  const currentPath = videoDiskPath(projectId, episodeId, shotNo);
  const currentName = videoFileEntryExists(currentPath) ? path.basename(currentPath) : '';
  const hasBackup = Boolean(
    meta?.processedFile
    && currentName === meta.processedFile
    && videoFileEntryExists(files.video)
  );
  return { files, meta, currentPath, currentName, hasBackup };
}

export function subtitleRemovalStatus(projectId, episodeId, shotNo) {
  if (!loadProject(projectId)) throw new Error('项目不存在');
  const state = currentBackupState(projectId, episodeId, shotNo);
  return {
    hasVideo: videoFileEntryExists(state.currentPath),
    hasBackup: state.hasBackup,
    options: state.hasBackup ? (state.meta?.options || null) : null,
    processedAt: state.hasBackup ? (state.meta?.processedAt || '') : '',
    processing: activeSubtitleRemovals.get(progressKey(projectId, episodeId, shotNo)) || null,
  };
}

export async function removeVideoSubtitles({ projectId, episodeId, shotNo, ...rawOptions } = {}) {
  if (!projectId || episodeId == null || shotNo == null) throw new Error('缺少 projectId/episodeId/shotNo');
  if (!loadProject(projectId)) throw new Error('项目不存在');

  const state = currentBackupState(projectId, episodeId, shotNo);
  if (!videoFileEntryExists(state.currentPath)) throw new Error(`镜头 ${shotNo} 还没有可处理的视频`);

  let sourcePath = state.currentPath;
  let meta = state.meta;
  if (state.hasBackup) {
    sourcePath = state.files.video;
  } else {
    await copyFileAtomic(state.currentPath, state.files.video);
    meta = {
      version: 1,
      originalFile: path.basename(state.currentPath),
      backedUpAt: new Date().toISOString(),
      processedFile: '',
    };
    await writeJsonAtomic(state.files.meta, meta);
  }

  const info = await videoInfo(sourcePath);
  const options = normalizeSubtitleRemovalOptions(rawOptions, info);
  const encoding = QUALITY_PRESETS[options.quality];
  const outputPath = nextVideoWritePath(projectId, episodeId, shotNo);
  const stagingPath = `${outputPath}.${process.pid}.${Date.now()}.part.mp4`;
  const activeKey = progressKey(projectId, episodeId, shotNo);
  const progressState = {
    progress: 0,
    frame: 0,
    totalFrames: info.totalFrames,
  };
  const updateProgress = (frame, totalFrames = info.totalFrames, complete = false) => {
    const total = Math.max(1, Number(totalFrames) || info.totalFrames);
    const currentFrame = Math.max(progressState.frame, Math.max(0, Number(frame) || 0));
    progressState.frame = currentFrame;
    progressState.totalFrames = total;
    progressState.progress = complete
      ? 100
      : Math.max(progressState.progress, Math.min(99, Math.floor((currentFrame / total) * 100)));
  };
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  activeSubtitleRemovals.set(activeKey, progressState);

  try {
    if (options.method === 'precision') {
      await runNaturalInpaint(sourcePath, stagingPath, options, encoding, info, updateProgress);
    } else {
      await runFastRemoval(sourcePath, stagingPath, options, encoding, info, updateProgress);
    }
    await assertReadableVideo(stagingPath);
    await fs.promises.rename(stagingPath, outputPath);
    updateProgress(info.totalFrames, info.totalFrames, true);
  } catch (error) {
    await fs.promises.rm(stagingPath, { force: true }).catch(() => {});
    const detail = String(error?.stderr || error?.message || '').replace(/\s+/g, ' ').slice(0, 280);
    throw new Error(`去字幕处理失败${detail ? `：${detail}` : ''}`);
  } finally {
    activeSubtitleRemovals.delete(activeKey);
  }

  const processedAt = new Date().toISOString();
  const nextMeta = {
    ...meta,
    processedFile: path.basename(outputPath),
    processedAt,
    options: {
      topPercent: options.topPercent,
      bottomPercent: options.bottomPercent,
      leftPercent: options.leftPercent,
      widthPercent: options.widthPercent,
      method: options.method,
      quality: options.quality,
    },
  };
  await writeJsonAtomic(state.files.meta, nextMeta);
  const videoUrl = videoLocalUrl(projectId, episodeId, shotNo);
  persistVideoUrl(projectId, episodeId, shotNo, videoUrl, nextMeta.options);
  await cleanupSupersededVideoFiles(projectId, episodeId, shotNo, { keepPath: outputPath, attempts: 1 });

  return { videoUrl, hasBackup: true, options: nextMeta.options, processedAt };
}

export async function restoreVideoBeforeSubtitleRemoval({ projectId, episodeId, shotNo } = {}) {
  if (!projectId || episodeId == null || shotNo == null) throw new Error('缺少 projectId/episodeId/shotNo');
  if (!loadProject(projectId)) throw new Error('项目不存在');
  const state = currentBackupState(projectId, episodeId, shotNo);
  if (!state.hasBackup) throw new Error('没有可还原的去字幕原片');

  const outputPath = nextVideoWritePath(projectId, episodeId, shotNo);
  await copyFileAtomic(state.files.video, outputPath);
  await assertReadableVideo(outputPath);
  const videoUrl = videoLocalUrl(projectId, episodeId, shotNo);
  persistVideoUrl(projectId, episodeId, shotNo, videoUrl);
  await cleanupSupersededVideoFiles(projectId, episodeId, shotNo, { keepPath: outputPath, attempts: 1 });
  await Promise.all([
    fs.promises.rm(state.files.video, { force: true }).catch(() => {}),
    fs.promises.rm(state.files.meta, { force: true }).catch(() => {}),
  ]);
  return { videoUrl, hasBackup: false };
}
