// 视频存储函数 - 临时独立文件
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { projectDir, sanitizeFilename } from './storage.js';

// 集 ID 会被直接拼进磁盘路径（videos/<集>/…），而它来自请求体，必须防路径穿越。
// 合法值形如 1 / 12 / ep:1 / ch:2，所以只拦「穿越形态」，不做通用转义 ——
// sanitizeFilename('ep:1') 会得到 'ep_1'，那会让已有视频目录全部对不上。
export function episodeKeyForPath(episodeId) {
  const raw = String(episodeId ?? '').trim();
  if (!raw) throw new Error('缺少集 ID');
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..') || raw.includes('\u0000')) {
    throw new Error(`非法的集 ID：${raw}`);
  }
  return raw;
}

// 视频存储路径：data/<projectId>/videos/<episodeId>/<shotNo>.mp4
export function videoDiskPaths(projectId, episodeId, shotNo) {
  const videoRoot = path.join(projectDir(projectId), 'videos');
  const episodeKey = episodeKeyForPath(episodeId);
  const safeShotNo = sanitizeFilename(String(shotNo));
  return [
    path.join(videoRoot, episodeKey, `${safeShotNo}.mp4`),
    path.join(videoRoot, `${episodeKey}_${safeShotNo}.mp4`),
  ];
}

// 片头：项目级共用的开场片段，data/<projectId>/intro/intro.mp4。
// 刻意不放 videos/ 下 —— /api/video/export-shots 会把 videos/ 的子目录当成集数目录扫描并导出。
export function introDir(projectId) {
  return path.join(projectDir(projectId), 'intro');
}

export function introDiskPath(projectId) {
  return path.join(introDir(projectId), 'intro.mp4');
}

// 每镜的"参考视频"：直接喂给支持视频参考的模型（即梦 / Seedance / LibTV 等）做视频→视频。
// 文件名刻意不带镜号 —— 参考视频记录挂在 shotMeta[镜头号] 上，插入/删除镜头时由现有的
// shotMeta 平移逻辑带着走；磁盘文件按令牌命名，就不需要跟着改名。
export function shotRefVideoDir(projectId, episodeId) {
  return path.join(projectDir(projectId), 'shotrefs', episodeKeyForPath(episodeId));
}

export function shotRefVideoDiskPath(projectId, episodeId, token) {
  return path.join(shotRefVideoDir(projectId, episodeId), `${sanitizeFilename(String(token), 'ref')}.mp4`);
}

const VIDEO_VERSION_MARKER = '.version-';
let lastVideoWriteVersion = 0;

export function videoFileEntryExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    try {
      return fs.readdirSync(path.dirname(filePath)).includes(path.basename(filePath));
    } catch {
      return false;
    }
  }
}

function versionFilesIn(dir, prefix) {
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.toLowerCase().endsWith('.mp4'))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function versionedVideoPaths(projectId, episodeId, shotNo) {
  const [canonicalPath, legacyPath] = videoDiskPaths(projectId, episodeId, shotNo);
  // 版本文件在两种命名下都可能存在：videos/<ep>/<no>.version-*.mp4 和遗留的
  // videos/<ep>_<no>.version-*.mp4。diskShotNos 两处都会扫，删除也必须两处都覆盖，
  // 否则漏掉的那个文件会让"以磁盘为准"的对账把已清除的镜头一直复活。
  return [
    ...versionFilesIn(path.dirname(canonicalPath), `${path.basename(canonicalPath, '.mp4')}${VIDEO_VERSION_MARKER}`),
    ...versionFilesIn(path.dirname(legacyPath), `${path.basename(legacyPath, '.mp4')}${VIDEO_VERSION_MARKER}`),
  ];
}

export function videoVersionDiskPath(projectId, episodeId, shotNo, token = '') {
  const [canonicalPath] = videoDiskPaths(projectId, episodeId, shotNo);
  const version = String(token || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return `${canonicalPath.slice(0, -4)}${VIDEO_VERSION_MARKER}${sanitizeFilename(version)}.mp4`;
}

export function videoDiskCandidates(projectId, episodeId, shotNo) {
  const [canonicalPath, legacyPath] = videoDiskPaths(projectId, episodeId, shotNo);
  return [...versionedVideoPaths(projectId, episodeId, shotNo), canonicalPath, legacyPath];
}

export function nextVideoWritePath(projectId, episodeId, shotNo) {
  // Never overwrite the file currently served to a Chromium <video>. On
  // Windows an open range request keeps the old file locked until the player
  // releases it, which made regeneration fail until the whole app restarted.
  // A fresh version path lets the completed result become active immediately;
  // superseded files are removed separately on a best-effort basis.
  lastVideoWriteVersion = Math.max(Date.now(), lastVideoWriteVersion + 1);
  return videoVersionDiskPath(projectId, episodeId, shotNo, String(lastVideoWriteVersion));
}

export function videoDiskPath(projectId, episodeId, shotNo) {
  const [canonicalPath, legacyPath] = videoDiskPaths(projectId, episodeId, shotNo);
  const versionPath = versionedVideoPaths(projectId, episodeId, shotNo).find(videoFileEntryExists);
  if (versionPath) return versionPath;
  if (videoFileEntryExists(canonicalPath)) return canonicalPath;
  if (videoFileEntryExists(legacyPath)) return legacyPath;
  return canonicalPath;
}

const PENDING_DELETE_SUFFIX = '.pending-delete';

// 清理之前没删掉的 .pending-delete 残留（占用释放后即可删除）。
function sweepPendingDeletes(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(PENDING_DELETE_SUFFIX)) continue;
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* 仍被占用，下次再扫 */ }
    }
  } catch { /* 目录不存在 */ }
}

// 彻底清除某个镜头的视频文件。播放器/杀软占用时 unlink 会失败，但改名在
// Windows 上依然可行；改名后文件不再以 .mp4 结尾，磁盘对账(diskShotNos)就
// 看不到它，因此"清除"对用户始终是终态，不会被残留文件复活。
export async function purgeShotVideoFiles(projectId, episodeId, shotNo) {
  const [canonicalPath, legacyPath] = videoDiskPaths(projectId, episodeId, shotNo);
  for (const dir of new Set([path.dirname(canonicalPath), path.dirname(legacyPath)])) sweepPendingDeletes(dir);

  const stubborn = [];
  for (const file of videoDiskCandidates(projectId, episodeId, shotNo)) {
    if (!videoFileEntryExists(file)) continue;
    try {
      fs.rmSync(file, { force: true });
      if (!videoFileEntryExists(file)) continue;
    } catch { /* 被占用，走改名兜底 */ }
    const parked = `${file}.${Date.now()}-${Math.random().toString(36).slice(2)}${PENDING_DELETE_SUFFIX}`;
    try {
      fs.renameSync(file, parked);
      try { fs.rmSync(parked, { force: true }); } catch { /* 留给下次 sweep */ }
    } catch {
      stubborn.push(file);
    }
  }
  return stubborn;
}

export async function cleanupSupersededVideoFiles(projectId, episodeId, shotNo, {
  attempts = 6,
  keepPath = '',
} = {}) {
  const [canonicalPath] = videoDiskPaths(projectId, episodeId, shotNo);
  const activePath = path.resolve(keepPath || canonicalPath);
  const stalePaths = videoDiskCandidates(projectId, episodeId, shotNo)
    .filter((filePath) => path.resolve(filePath) !== activePath);
  const totalAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    for (const stalePath of stalePaths) {
      try { await fs.promises.rm(stalePath, { force: true }); } catch { /* retry below */ }
    }
    const remaining = stalePaths.filter(videoFileEntryExists);
    if (!remaining.length) return [];
    if (attempt < totalAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return stalePaths.filter(videoFileEntryExists);
}

// 检查视频是否存在
export function videoExists(projectId, episodeId, shotNo) {
  return videoFileEntryExists(videoDiskPath(projectId, episodeId, shotNo));
}

// 插入/删除分镜时同步移动已落盘的视频文件名，保持镜头号和磁盘文件一致。
export function shiftVideoFiles(projectId, episodeId, { fromNo, delta, removeNo = null } = {}) {
  const root = path.join(projectDir(projectId), 'videos');
  const dir = path.join(root, episodeKeyForPath(episodeId));
  if (!fs.existsSync(root)) return { shifted: 0, removed: 0 };

  let removed = 0;
  if (removeNo != null) {
    const removePaths = videoDiskCandidates(projectId, episodeId, removeNo);
    for (const removePath of removePaths) {
      if (!videoFileEntryExists(removePath)) continue;
      // Windows 上播放中的文件可能被 Chromium range-request 锁住，直接删会失败。
      // 先尝试删除，失败就 rename 成 .pending-delete 让文件脱离 .mp4 命名，
      // 使磁盘对账(diskShotNos)看不到它，再由 sweepPendingDeletes 在占用释放后清理。
      try {
        fs.rmSync(removePath, { force: true });
      } catch {
        const parked = `${removePath}.${Date.now()}-${Math.random().toString(36).slice(2)}${PENDING_DELETE_SUFFIX}`;
        try {
          fs.renameSync(removePath, parked);
          try { fs.rmSync(parked, { force: true }); } catch { /* 留给下次 sweep */ }
        } catch { /* rename 也失败则放弃，保持原样，不影响 JSON 侧已经删除 */ }
      }
      removed = 1;
    }
  }

  const start = Number(fromNo);
  const step = Number(delta);
  if (!Number.isFinite(start) || !Number.isFinite(step) || step === 0) {
    return { shifted: 0, removed };
  }

  const files = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.toLowerCase().endsWith('.mp4')) continue;
      const stem = path.basename(file, '.mp4');
      const markerAt = stem.indexOf(VIDEO_VERSION_MARKER);
      const numberText = markerAt >= 0 ? stem.slice(0, markerAt) : stem;
      const suffix = markerAt >= 0 ? stem.slice(markerAt) : '';
      const no = Number(numberText);
      if (Number.isFinite(no) && no >= start) {
        files.push({ src: path.join(dir, file), dir, prefix: '', no, suffix });
      }
    }
  }
  for (const file of fs.readdirSync(root)) {
    if (!file.toLowerCase().endsWith('.mp4')) continue;
    const legacyPrefix = `${episodeId}_`;
    if (!file.startsWith(legacyPrefix)) continue;
    const stem = path.basename(file.slice(legacyPrefix.length), '.mp4');
    const markerAt = stem.indexOf(VIDEO_VERSION_MARKER);
    const numberText = markerAt >= 0 ? stem.slice(0, markerAt) : stem;
    const suffix = markerAt >= 0 ? stem.slice(markerAt) : '';
    const no = Number(numberText);
    if (Number.isFinite(no) && no >= start) {
      files.push({ src: path.join(root, file), dir: root, prefix: legacyPrefix, no, suffix });
    }
  }

  files.sort((a, b) => step > 0 ? b.no - a.no : a.no - b.no);
  const token = `.renumber-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const staged = [];
  for (const item of files) {
    if (!fs.existsSync(item.src)) continue;
    const tmp = path.join(item.dir, `${item.prefix}${sanitizeFilename(String(item.no))}${item.suffix || ''}${token}.mp4`);
    fs.renameSync(item.src, tmp);
    staged.push({ tmp, dir: item.dir, prefix: item.prefix, suffix: item.suffix || '', toNo: item.no + step });
  }

  for (const item of staged) {
    const dest = path.join(item.dir, `${item.prefix}${sanitizeFilename(String(item.toNo))}${item.suffix || ''}.mp4`);
    fs.renameSync(item.tmp, dest);
  }

  return { shifted: staged.length, removed };
}

function normalizeShotNumberMapping(mapping = {}) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Invalid shot number mapping');
  const normalized = {};
  const destinations = new Set();
  for (const [rawFrom, rawTo] of Object.entries(mapping)) {
    const from = Number(rawFrom);
    const to = Number(rawTo);
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < 1) {
      throw new Error('Shot number mapping must contain positive integers');
    }
    if (destinations.has(to)) throw new Error(`Duplicate shot mapping destination: ${to}`);
    destinations.add(to);
    normalized[String(from)] = String(to);
  }
  const size = Object.keys(normalized).length;
  if (!size) throw new Error('Shot number mapping cannot be empty');
  if (size > 5000) throw new Error('Too many shot number mappings');
  return normalized;
}

function numberedMediaFiles(dir, { prefix = '', extension } = {}) {
  if (!fs.existsSync(dir)) return [];
  const lowerExt = String(extension || '').toLowerCase();
  const files = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.toLowerCase().endsWith(lowerExt) || (prefix && !file.startsWith(prefix))) continue;
    const withoutPrefix = prefix ? file.slice(prefix.length) : file;
    const stem = withoutPrefix.slice(0, -lowerExt.length);
    const markerAt = stem.indexOf(VIDEO_VERSION_MARKER);
    const numberText = markerAt >= 0 ? stem.slice(0, markerAt) : stem;
    const suffix = markerAt >= 0 ? stem.slice(markerAt) : '';
    const no = Number(numberText);
    if (!Number.isInteger(no) || no < 1) continue;
    files.push({ no: String(no), src: path.join(dir, file), suffix });
  }
  return files;
}

function remapNumberedMediaFiles(dir, mapping, { prefix = '', extension, removeUnmapped = true } = {}) {
  const files = numberedMediaFiles(dir, { prefix, extension });
  if (!files.length) return { moved: 0, removed: 0 };
  const token = `.timeline-remap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const staged = [];
  const stagedRemovals = [];
  const committed = [];
  try {
    for (const file of files) {
      const nextNo = mapping[file.no];
      if (!nextNo) {
        if (removeUnmapped) {
          const tmp = `${file.src}${token}.remove`;
          fs.renameSync(file.src, tmp);
          stagedRemovals.push({ src: file.src, tmp });
        }
        continue;
      }
      if (nextNo === file.no) continue;
      const tmp = `${file.src}${token}`;
      fs.renameSync(file.src, tmp);
      staged.push({ src: file.src, tmp, nextNo, suffix: file.suffix || '', dest: '' });
    }

    for (const item of staged) {
      item.dest = path.join(dir, `${prefix}${sanitizeFilename(item.nextNo)}${item.suffix || ''}${extension}`);
      if (fs.existsSync(item.dest)) throw new Error(`Shot remap destination already exists: ${item.nextNo}`);
      fs.renameSync(item.tmp, item.dest);
      committed.push(item);
    }
    for (const item of stagedRemovals) fs.rmSync(item.tmp, { force: true });
  } catch (error) {
    for (let index = committed.length - 1; index >= 0; index -= 1) {
      const item = committed[index];
      if (fs.existsSync(item.dest) && !fs.existsSync(item.tmp)) {
        try { fs.renameSync(item.dest, item.tmp); } catch { /* best effort rollback */ }
      }
    }
    for (const item of staged) {
      if (fs.existsSync(item.tmp) && !fs.existsSync(item.src)) {
        try { fs.renameSync(item.tmp, item.src); } catch { /* best effort rollback */ }
      }
    }
    for (const item of stagedRemovals) {
      if (fs.existsSync(item.tmp) && !fs.existsSync(item.src)) {
        try { fs.renameSync(item.tmp, item.src); } catch { /* best effort rollback */ }
      }
    }
    throw error;
  }
  return { moved: staged.length, removed: stagedRemovals.length };
}

// Keep generated video and tail-frame filenames aligned with timeline shot numbers.
export function remapShotFiles(projectId, episodeId, { mapping = {}, removeUnmapped = true } = {}) {
  const normalized = normalizeShotNumberMapping(mapping);
  const projectRoot = projectDir(projectId);
  const videoRoot = path.join(projectRoot, 'videos');
  const episodeKey = episodeKeyForPath(episodeId);
  const videoDir = path.join(videoRoot, episodeKey);
  const tailFrameDir = path.join(projectRoot, 'tailframes', episodeKey);
  const modernVideos = remapNumberedMediaFiles(videoDir, normalized, {
    extension: '.mp4',
    removeUnmapped,
  });
  const legacyVideos = remapNumberedMediaFiles(videoRoot, normalized, {
    prefix: `${episodeKey}_`,
    extension: '.mp4',
    removeUnmapped,
  });
  const tailFrames = remapNumberedMediaFiles(tailFrameDir, normalized, {
    extension: '.png',
    removeUnmapped,
  });
  return {
    moved: modernVideos.moved + legacyVideos.moved + tailFrames.moved,
    removed: modernVideos.removed + legacyVideos.removed + tailFrames.removed,
    videos: {
      moved: modernVideos.moved + legacyVideos.moved,
      removed: modernVideos.removed + legacyVideos.removed,
    },
    tailFrames,
  };
}

function countFilesRecursive(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return 1;
  let count = 0;
  for (const entry of fs.readdirSync(target)) {
    count += countFilesRecursive(path.join(target, entry));
  }
  return count;
}

// 删除指定剧集的全部媒体文件，返回删除统计和错误列表。
export function deleteEpisodeMediaFiles(projectId, episodeId) {
  const projectRoot = projectDir(projectId);
  const episodeKey = episodeKeyForPath(episodeId);
  const safeEpisodeKey = sanitizeFilename(episodeKey, 'ep');
  const videoRoot = path.join(projectRoot, 'videos');
  const targets = [
    path.join(videoRoot, episodeKey),
    path.join(projectRoot, 'tailframes', episodeKey),
    path.join(projectRoot, 'final', episodeKey),
  ];
  const errors = [];
  let removedFiles = 0;

  const removeTarget = (target) => {
    try {
      removedFiles += countFilesRecursive(target);
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      errors.push(`${target}: ${error.message}`);
    }
  };

  for (const target of targets) removeTarget(target);

  // 兼容清理旧格式 videos/<episodeId>_<shotNo>.mp4 文件。
  try {
    if (fs.existsSync(videoRoot)) {
      const legacyPrefix = `${safeEpisodeKey}_`;
      for (const file of fs.readdirSync(videoRoot)) {
        if (!file.startsWith(legacyPrefix)) continue;
        const target = path.join(videoRoot, file);
        if (!fs.statSync(target).isFile()) continue;
        removeTarget(target);
      }
    }
  } catch (error) {
    errors.push(`${videoRoot}: ${error.message}`);
  }

  return { removedFiles, errors };
}

// 从 URL 下载视频并保存（使用新的分层结构）
// 加超时 + 退避重试 + 体积校验 + 原子落盘，避免 CDN 偶发抖动导致一次性永久失败。
const MIN_VIDEO_BYTES = 10 * 1024; // 小于 10KB 视为下载到错误页/截断，按失败处理
const DEFAULT_VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://jimeng.jianying.com/',
};

function mergeVideoHeaders(headers = {}, attempt = 1) {
  const merged = { ...DEFAULT_VIDEO_HEADERS };
  for (const [key, value] of Object.entries(headers || {})) {
    if (value != null && String(value).trim()) merged[key] = value;
  }
  if (attempt % 2 === 0 && !Object.keys(merged).some((key) => key.toLowerCase() === 'range')) {
    merged.Range = 'bytes=0-';
  }
  return merged;
}

async function videoResponseError(response) {
  let detail = '';
  try {
    detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
  } catch { /* ignore */ }
  return `HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`;
}

async function responseToBuffer(response) {
  if (!response.body?.getReader) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    total += chunk.length;
  }
  return Buffer.concat(chunks, total);
}

function looksLikeVideoBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return true;
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return true;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'AVI ') return true;
  if (buffer[0] === 0x47 && buffer.length >= 188 && buffer[188] === 0x47) return true;
  return false;
}

export async function saveVideoUrlToFile(filePath, videoUrl, headers = {}, { retries = 5, timeoutMs = 180000 } = {}) {
  const requestedPath = String(filePath || '');
  if (!requestedPath || !path.isAbsolute(requestedPath)) throw new Error('视频保存路径无效');
  const targetPath = path.resolve(requestedPath);
  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
  const url = String(videoUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('视频下载地址无效');

  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: mergeVideoHeaders(headers, attempt),
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(await videoResponseError(response));

      const buf = await responseToBuffer(response);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (/text\/html|application\/json|text\/plain/.test(contentType) || !looksLikeVideoBuffer(buf)) {
        throw new Error('涓嬭浇鍐呭涓嶆槸鍙瑙嗛');
      }
      if (buf.length < MIN_VIDEO_BYTES) throw new Error(`下载内容过小(${buf.length}B)，疑似截断/错误页`);

      await fs.promises.writeFile(tmpPath, buf);
      await fs.promises.rename(tmpPath, targetPath); // 原子替换，避免半截文件被当成有效视频
      return targetPath;
    } catch (e) {
      lastErr = e;
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
      const aborted = e.name === 'AbortError';
      const reason = aborted ? `下载超时(${Math.round(timeoutMs / 1000)}s)` : e.message;
      if (attempt < retries) {
        const waitMs = Math.min(15000, 2000 * attempt);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`视频下载失败(重试${retries}次): ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('视频下载失败');
}

export async function saveVideoFromUrl(projectId, episodeId, shotNo, videoUrl, headers = {}, options = {}) {
  const filePath = path.join(projectDir(projectId), 'videos', String(episodeId), `${sanitizeFilename(String(shotNo))}.mp4`);
  return saveVideoUrlToFile(filePath, videoUrl, headers, options);
}

// 打开项目的视频文件夹
export function openVideoFolder(projectId) {
  const dir = path.join(projectDir(projectId), 'videos');
  fs.mkdirSync(dir, { recursive: true });
  exec(`explorer "${dir}"`);
  return dir;
}
