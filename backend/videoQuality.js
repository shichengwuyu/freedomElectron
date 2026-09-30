import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { ffprobePath } from './config.js';
import { saveVideoUrlToFile } from './videoFunctions.js';

const execFileAsync = promisify(execFile);
const REMOTE_URL_RE = /^https?:\/\//i;
const DEFAULT_PROBE_TIMEOUT_MS = 20000;
const MAX_CANDIDATES = 24;
const PROBE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeRemoteCandidates(value) {
  const source = Array.isArray(value) ? value.flat(Infinity) : [value];
  const output = new Map();
  for (const item of source) {
    const url = String(typeof item === 'object' ? item?.url : item || '').trim();
    if (!REMOTE_URL_RE.test(url)) continue;
    const score = finiteNumber(typeof item === 'object' ? item?.score : 0);
    const previous = output.get(url);
    if (!previous || score > previous.score) output.set(url, { type: 'remote', source: url, url, score });
  }
  return [...output.values()].slice(0, MAX_CANDIDATES);
}

function normalizeLocalCandidates(value) {
  const source = Array.isArray(value) ? value.flat(Infinity) : [value];
  const output = new Map();
  for (const item of source) {
    const filePath = String(typeof item === 'object' ? item?.path || item?.filePath : item || '').trim();
    if (!filePath || !path.isAbsolute(filePath)) continue;
    const resolved = path.resolve(filePath);
    if (!output.has(resolved)) output.set(resolved, { type: 'local', source: resolved, filePath: resolved, score: 0 });
  }
  return [...output.values()].slice(0, MAX_CANDIDATES);
}

function parsedQuality(json = {}) {
  const stream = Array.isArray(json.streams) ? json.streams[0] || {} : {};
  const format = json.format && typeof json.format === 'object' ? json.format : {};
  const width = finiteNumber(stream.width);
  const height = finiteNumber(stream.height);
  const duration = finiteNumber(format.duration || stream.duration);
  const size = finiteNumber(format.size);
  const measuredBitRate = Math.max(finiteNumber(stream.bit_rate), finiteNumber(format.bit_rate));
  const derivedBitRate = duration > 0 && size > 0 ? (size * 8) / duration : 0;
  return {
    width,
    height,
    pixels: width * height,
    bitRate: Math.max(measuredBitRate, derivedBitRate),
    size,
    duration,
    codec: String(stream.codec_name || ''),
  };
}

export async function probeVideoQuality(source, { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, headers = {} } = {}) {
  const input = String(source || '').trim();
  if (!input) throw new Error('Video source is empty');
  const remote = REMOTE_URL_RE.test(input);
  if (remote && Object.keys(headers || {}).length) throw new Error('Authenticated remote sources require a local quality probe');
  const args = ['-v', 'error'];
  if (remote) {
    args.push('-user_agent', PROBE_USER_AGENT, '-rw_timeout', String(Math.max(1, timeoutMs) * 1000));
  }
  args.push(
    '-i', input,
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name,bit_rate,duration:format=duration,size,bit_rate',
    '-of', 'json',
  );
  const { stdout } = await execFileAsync(ffprobePath(), args, {
    timeout: Math.max(1000, timeoutMs),
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const quality = parsedQuality(JSON.parse(stdout || '{}'));
  if (!quality.width || !quality.height) throw new Error('Video has no decodable picture stream');
  return quality;
}

export function compareVideoQuality(left = {}, right = {}) {
  const leftQuality = left.quality || left;
  const rightQuality = right.quality || right;
  const fields = ['pixels', 'width', 'height', 'bitRate', 'size'];
  for (const field of fields) {
    const difference = finiteNumber(rightQuality[field]) - finiteNumber(leftQuality[field]);
    if (difference) return difference;
  }
  return finiteNumber(right.score) - finiteNumber(left.score);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, run));
  return results;
}

function candidateTempPath(targetPath, index) {
  return `${targetPath}.quality-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.mp4`;
}

async function copyCandidateToTarget(candidate, targetPath, headers, downloadOptions) {
  if (candidate.preloadedPath) {
    await fs.promises.rename(candidate.preloadedPath, targetPath);
    candidate.preloadedPath = '';
    return;
  }
  if (candidate.type === 'local') {
    await fs.promises.copyFile(candidate.filePath, targetPath);
    return;
  }
  await saveVideoUrlToFile(targetPath, candidate.url, headers, downloadOptions);
}

export async function saveBestVideoSourceToFile(
  targetPath,
  { videoPaths = [], videoUrls = [] } = {},
  headers = {},
  { retries = 3, timeoutMs = 120000, probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {},
) {
  const target = path.resolve(String(targetPath || ''));
  if (!path.isAbsolute(target)) throw new Error('Video target path must be absolute');
  const localCandidates = normalizeLocalCandidates(videoPaths)
    .filter((candidate) => fs.existsSync(candidate.filePath));
  const remoteCandidates = normalizeRemoteCandidates(videoUrls);
  const candidates = [...localCandidates, ...remoteCandidates].slice(0, MAX_CANDIDATES);
  if (!candidates.length) throw new Error('No usable video source was returned by the provider');

  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const failures = [];
  const downloadOptions = { retries, timeoutMs };
  try {
    if (candidates.length === 1) {
      const candidate = candidates[0];
      await copyCandidateToTarget(candidate, target, headers, downloadOptions);
      candidate.quality = await probeVideoQuality(target, { timeoutMs: probeTimeoutMs });
      return { ...candidate, candidateCount: 1 };
    }

    await mapLimit(candidates, 3, async (candidate, index) => {
      try {
        candidate.quality = await probeVideoQuality(candidate.source, { timeoutMs: probeTimeoutMs, headers });
      } catch (error) {
        if (candidate.type !== 'remote') {
          failures.push(`${path.basename(candidate.source)}: ${error.message}`);
          return;
        }
        const preloadPath = candidateTempPath(target, index);
        try {
          await saveVideoUrlToFile(preloadPath, candidate.url, headers, { retries: 1, timeoutMs });
          candidate.quality = await probeVideoQuality(preloadPath, { timeoutMs: probeTimeoutMs });
          candidate.preloadedPath = preloadPath;
        } catch (downloadError) {
          await fs.promises.rm(preloadPath, { force: true }).catch(() => {});
          failures.push(`${candidate.url.slice(0, 160)}: ${downloadError.message}`);
        }
      }
    });

    const ordered = candidates.filter((candidate) => candidate.quality).sort(compareVideoQuality);
    if (!ordered.length) throw new Error(`All returned video versions were unavailable${failures.length ? `: ${failures.join(' | ')}` : ''}`);

    for (const candidate of ordered) {
      try {
        await fs.promises.rm(target, { force: true }).catch(() => {});
        await copyCandidateToTarget(candidate, target, headers, downloadOptions);
        const actualQuality = await probeVideoQuality(target, { timeoutMs: probeTimeoutMs });
        return { ...candidate, quality: actualQuality, candidateCount: candidates.length };
      } catch (error) {
        failures.push(`${candidate.source.slice(0, 160)}: ${error.message}`);
        await fs.promises.rm(target, { force: true }).catch(() => {});
      }
    }
    throw new Error(`Unable to download any valid video version: ${failures.join(' | ')}`);
  } finally {
    for (const candidate of candidates) {
      if (candidate.preloadedPath) await fs.promises.rm(candidate.preloadedPath, { force: true }).catch(() => {});
    }
  }
}
