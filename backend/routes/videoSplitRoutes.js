import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { ffmpegPath, ffprobePath } from '../config.js';
import { sanitizeFilename } from '../storage.js';

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.ts', '.mts', '.m2ts', '.flv']);

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeInputPath(value) {
  const filePath = path.resolve(String(value || '').trim());
  if (!filePath || !fs.existsSync(filePath)) throw new Error('找不到所选视频文件');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('所选路径不是视频文件');
  if (!VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('暂不支持该视频格式');
  return filePath;
}

function normalizeInputPaths(body = {}) {
  const candidates = Array.isArray(body.sourcePaths) && body.sourcePaths.length
    ? body.sourcePaths
    : [body.sourcePath];
  const paths = [...new Set(candidates.filter((value) => String(value || '').trim()).map((value) => normalizeInputPath(value)))];
  if (!paths.length) throw new Error('请至少选择一个视频文件');
  return paths;
}

function normalizeOutputDirectory(value) {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : '';
}

/**
 * Build a complete, gap-free split plan. A final remainder shorter than the
 * minimum is folded into the preceding segment instead of being discarded.
 */
export function buildVideoSplitPlan(totalDuration, {
  firstDuration = 300,
  secondDuration = 180,
  segmentDuration = 40,
  minimumDuration = 40,
  rules = null,
} = {}) {
  const total = Math.max(0, Number(totalDuration) || 0);
  const minimum = numberInRange(minimumDuration, 40, 1, 24 * 60 * 60);
  const regular = Math.max(minimum, numberInRange(segmentDuration, 40, 1, 24 * 60 * 60));
  const fallbackRules = [
    { startEpisode: 1, endEpisode: 1, duration: firstDuration, unit: 'minute' },
    { startEpisode: 2, endEpisode: 2, duration: secondDuration, unit: 'minute' },
  ];
  const normalizedRules = (Array.isArray(rules) && rules.length ? rules : fallbackRules)
    .map((rule) => {
      const startEpisode = Math.max(1, Math.floor(Number(rule?.startEpisode) || 1));
      const rawEnd = Math.floor(Number(rule?.endEpisode) || 0);
      const endEpisode = rawEnd > 0 ? Math.max(startEpisode, rawEnd) : 0;
      const rawDuration = numberInRange(rule?.duration, 0, 0, 24 * 60 * 60);
      const duration = rawDuration * (String(rule?.unit || 'second') === 'minute' ? 60 : 1);
      return { startEpisode, endEpisode, duration: Math.max(minimum, duration) };
    })
    .filter((rule) => rule.duration > 0)
    .sort((a, b) => a.startEpisode - b.startEpisode);
  const fallbackDuration = regular;
  const durationForEpisode = (episodeIndex) => {
    const rule = normalizedRules.find((candidate) => episodeIndex >= candidate.startEpisode
      && (!candidate.endEpisode || episodeIndex <= candidate.endEpisode));
    return rule?.duration || fallbackDuration;
  };
  const segments = [];
  let cursor = 0;
  let episodeIndex = 1;
  while (cursor < total - 0.01) {
    const remaining = total - cursor;
    const targetDuration = durationForEpisode(episodeIndex);
    let duration = Math.min(targetDuration, remaining);
    // Never leave a short tail behind. Fold it into this segment so every
    // source second is represented in exactly one output file.
    if (remaining > regular && remaining - regular < minimum) duration = remaining;
    if (duration < minimum && segments.length) {
      segments[segments.length - 1].duration += remaining;
      cursor = total;
      break;
    }
    segments.push({ start: cursor, duration });
    cursor += duration;
    episodeIndex += 1;
  }
  return segments.map((segment, index) => ({
    index: index + 1,
    start: segment.start,
    duration: segment.duration,
    end: Math.min(total, segment.start + segment.duration),
  }));
}

async function probeDuration(filePath) {
  const { stdout } = await execFileAsync(ffprobePath(), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const duration = Number.parseFloat(String(stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长');
  return duration;
}

async function detectSilenceIntervals(filePath) {
  let log = '';
  try {
    const result = await execFileAsync(ffmpegPath(), [
      '-hide_banner', '-i', filePath, '-vn',
      '-af', 'silencedetect=noise=-35dB:d=0.25',
      '-f', 'null', '-',
    ], { timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    log = `${result.stderr || ''}\n${result.stdout || ''}`;
  } catch (error) {
    // ffmpeg can return a non-zero status for video-only inputs. Any silence
    // events already emitted before that status are still useful.
    log = `${error.stderr || ''}\n${error.stdout || ''}`;
  }
  const intervals = [];
  let openStart = null;
  for (const line of log.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/i);
    const end = line.match(/silence_end:\s*([0-9.]+)/i);
    if (start) openStart = Number(start[1]);
    if (end && Number.isFinite(Number(end[1]))) {
      const endAt = Number(end[1]);
      intervals.push({ start: Number.isFinite(openStart) ? openStart : Math.max(0, endAt - 0.25), end: endAt });
      openStart = null;
    }
  }
  if (Number.isFinite(openStart)) intervals.push({ start: openStart, end: Number.POSITIVE_INFINITY });
  return intervals.filter((item) => Number.isFinite(item.start));
}

function applyNaturalCutPlan(plan, totalDuration, silenceIntervals, {
  maxExtension = 10,
  minimumDuration = 40,
} = {}) {
  if (!Array.isArray(plan) || plan.length < 2 || !silenceIntervals.length) {
    return { plan, adjusted: 0 };
  }
  const extension = numberInRange(maxExtension, 10, 0, 120);
  const minimum = numberInRange(minimumDuration, 40, 1, 24 * 60 * 60);
  const originalEnds = plan.map((item) => Number(item.end));
  const boundaries = [];
  let previous = 0;
  for (let index = 0; index < plan.length - 1; index += 1) {
    const target = originalEnds[index];
    const nextTarget = originalEnds[index + 1];
    const earliest = previous + minimum;
    const latest = Math.min(totalDuration - minimum * (plan.length - index - 1), target + extension, nextTarget - minimum);
    let boundary = target;
    if (latest >= earliest) {
      const afterTarget = silenceIntervals.find((silence) => silence.start >= target - 0.05 && silence.start <= latest);
      const containingTarget = silenceIntervals.find((silence) => silence.start <= target && silence.end >= target);
      const beforeTarget = [...silenceIntervals].reverse().find((silence) => silence.start >= target - extension && silence.start < target);
      boundary = afterTarget?.start ?? (containingTarget ? target : beforeTarget?.start ?? target);
      boundary = Math.min(latest, Math.max(earliest, boundary));
    }
    boundaries.push(boundary);
    previous = boundary;
  }
  boundaries.push(totalDuration);
  let adjusted = boundaries.slice(0, -1).filter((boundary, index) => Math.abs(boundary - originalEnds[index]) >= 0.25).length;
  const naturalPlan = plan.map((item, index) => {
    const start = index === 0 ? 0 : boundaries[index - 1];
    const end = boundaries[index];
    return { ...item, start, end, duration: Math.max(0, end - start) };
  });
  // A late silence can make the final piece too short. Merge that piece back
  // into its predecessor so natural cutting never creates a skipped tail.
  for (let index = naturalPlan.length - 1; index > 0; index -= 1) {
    if (naturalPlan[index].duration >= minimum) continue;
    naturalPlan[index - 1].end = totalDuration;
    naturalPlan[index - 1].duration = totalDuration - naturalPlan[index - 1].start;
    naturalPlan.splice(index, 1);
    adjusted += 1;
  }
  return {
    plan: naturalPlan.map((item, index) => ({ ...item, index: index + 1 })),
    adjusted,
  };
}

async function createConcatList(inputPaths, directory) {
  const listPath = path.join(directory, 'concat-list.txt');
  const lines = inputPaths.map((filePath) => {
    const normalized = filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
    return `file '${normalized}'`;
  });
  await fs.promises.writeFile(listPath, `${lines.join('\n')}\n`, 'utf8');
  return listPath;
}

async function concatenateVideos(inputPaths, directory) {
  if (inputPaths.length === 1) return inputPaths[0];
  const listPath = await createConcatList(inputPaths, directory);
  const combinedPath = path.join(directory, 'combined.mp4');
  const concatArgs = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', combinedPath];
  try {
    await execFileAsync(ffmpegPath(), concatArgs, { timeout: 60 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return combinedPath;
  } catch (copyError) {
    await fs.promises.rm(combinedPath, { force: true }).catch(() => {});
    try {
      await execFileAsync(ffmpegPath(), [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-movflags', '+faststart', combinedPath,
      ], { timeout: 2 * 60 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      return combinedPath;
    } catch (encodeError) {
      throw new Error(`多个视频合拍失败：${encodeError.message || copyError.message}`);
    }
  }
}

async function runFfmpeg(input, output, segment) {
  const baseArgs = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(segment.start), '-i', input,
    '-t', String(segment.duration), '-map', '0',
    '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-reset_timestamps', '1', output,
  ];
  const encodeArgs = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(segment.start), '-i', input,
    '-t', String(segment.duration), '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-c:a', 'aac', '-movflags', '+faststart', output,
  ];
  const runEncode = async () => {
    await fs.promises.rm(output, { force: true }).catch(() => {});
    await execFileAsync(ffmpegPath(), encodeArgs, {
      timeout: 60 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
  };
  try {
    await execFileAsync(ffmpegPath(), baseArgs, { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    // Stream-copy seeking is fast but can produce a packet range much longer
    // than requested for some codecs/containers. Validate the result before
    // accepting it so natural boundaries remain real file boundaries.
    const actualDuration = await probeDuration(output);
    const tolerance = Math.max(0.75, Number(segment.duration) * 0.1);
    if (Math.abs(actualDuration - Number(segment.duration)) > tolerance) {
      await runEncode();
    }
  } catch (copyError) {
    // Some containers/codecs cannot be stream-copied into MP4. Retry with a
    // compatible encode so the feature still works for ordinary uploads.
    await runEncode().catch((encodeError) => {
      throw new Error(`第 ${segment.index} 集切割失败：${encodeError.message || copyError.message}`);
    });
  }
}

export async function handleVideoSplitRoutes({ req, res, p, method, readBody, sendJson }) {
  if (!p.startsWith('/api/video-split/')) return false;

  if (p === '/api/video-split/probe' && method === 'POST') {
    const body = await readBody(req);
    const inputs = normalizeInputPaths(body || {});
    const durations = await Promise.all(inputs.map((input) => probeDuration(input)));
    return sendJson(res, 200, {
      ok: true,
      sourceName: path.basename(inputs[0]),
      sourceNames: inputs.map((input) => path.basename(input)),
      durations,
      duration: durations.reduce((sum, value) => sum + value, 0),
    });
  }

  if (p === '/api/video-split/start' && method === 'POST') {
    const body = await readBody(req);
    const inputs = normalizeInputPaths(body || {});
    const outputDirectory = normalizeOutputDirectory(body?.outputDirectory);
    if (!outputDirectory) throw new Error('请选择输出文件夹');
    await fs.promises.mkdir(outputDirectory, { recursive: true });
    const outputStat = await fs.promises.stat(outputDirectory);
    if (!outputStat.isDirectory()) throw new Error('输出路径不是文件夹');

    const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yanzhi-video-split-'));
    try {
      const input = await concatenateVideos(inputs, tempDirectory);
      const duration = await probeDuration(input);
      const plan = buildVideoSplitPlan(duration, body || {});
      if (!plan.length) throw new Error('视频时长不足，无法切割');
      const naturalCut = body?.naturalCut !== false;
      const naturalWindowSeconds = numberInRange(body?.naturalWindowSeconds, 10, 0, 120);
      const naturalResult = naturalCut
        ? applyNaturalCutPlan(plan, duration, await detectSilenceIntervals(input), {
          maxExtension: naturalWindowSeconds,
          minimumDuration: Number(body?.minimumDuration) || 40,
        })
        : { plan, adjusted: 0 };
      const prefix = sanitizeFilename(body?.prefix || path.basename(inputs[0], path.extname(inputs[0])), '视频');
      const segments = [];
      for (const item of naturalResult.plan) {
        const fileName = `${prefix}-第${item.index}集.mp4`;
        const output = path.join(outputDirectory, fileName);
        await runFfmpeg(input, output, item);
        segments.push({
          index: item.index,
          name: fileName,
          path: output,
          start: item.start,
          duration: item.duration,
          end: item.end,
        });
      }
      return sendJson(res, 200, {
        ok: true,
        sourceName: path.basename(inputs[0]),
        sourceNames: inputs.map((inputPath) => path.basename(inputPath)),
        sourceCount: inputs.length,
        naturalCut,
        naturalWindowSeconds,
        naturalAdjustments: naturalResult.adjusted,
        outputDirectory,
        duration,
        prefix,
        segments,
      });
    } finally {
      await fs.promises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }

  return sendJson(res, 404, { error: 'Not Found' });
}
