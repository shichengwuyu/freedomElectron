// 分镜视频对账工具：此前在 videoService.js 与 routes/scriptRoutes.js 各有一份逐行等价的拷贝，
// 统一抽到这里，两处 import 复用，避免改一处漏一处导致行为分叉。
import fs from 'fs';
import path from 'path';
import { projectDir } from './storage.js';

function shotNoFromVideoFilename(filename, prefix = '') {
  const stem = path.basename(filename, path.extname(filename));
  const withoutPrefix = prefix && stem.startsWith(prefix) ? stem.slice(prefix.length) : stem;
  return withoutPrefix.split('.version-', 1)[0];
}

// 分镜视频的本地播放 URL（带时间戳防缓存）。
export function videoLocalUrl(projectId, episodeId, shotNo) {
  return `/video/${encodeURIComponent(projectId)}/${encodeURIComponent(String(episodeId))}/${encodeURIComponent(String(shotNo))}.mp4?t=${Date.now()}`;
}

// 片头是项目级的，不带集数/镜头号。
export function introLocalUrl(projectId) {
  return `/video-intro/${encodeURIComponent(projectId)}.mp4?t=${Date.now()}`;
}

// 单个镜头的时长（秒）：优先镜头自己的时长设置，没有就用正文时间码的末位。
export function shotDurationSeconds(shot = {}, storyboard = {}) {
  const meta = Number(storyboard?.shotMeta?.[String(shot.no)]?.duration);
  // 时间轴有两种写法：金牌分镜导演模板的 [0.0s-3.0s] 和旧模板的 【0-3s】，两种都要认。
  const textSeconds = [...String(shot.body || '').matchAll(/[【\[]\s*(\d+(?:\.\d+)?)\s*[sS秒]?\s*[-~–—]\s*(\d+(?:\.\d+)?)\s*[sS秒]?\s*[】\]]/g)]
    .map((match) => Number(match[2]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const text = textSeconds.length ? Math.max(...textSeconds) : 0;
  const seconds = Number.isFinite(meta) && meta > 0 ? meta : text;
  return seconds > 0 ? Math.round(seconds) : 0;
}

// 分镜页时长统计：每集给出「分镜数 / 已出片数 / 已出片时长 / 计划时长」（秒）。
// 已出片按 shotVideos 里的记录去重（同一镜头重复生成只算一次），前端可自行按任意范围求和。
export function videoDurationStats(project = {}) {
  const storyboards = project?.script?.storyboards || [];
  const episodes = {};
  const totals = { episodes: 0, shots: 0, producedShots: 0, producedSeconds: 0, plannedSeconds: 0 };
  for (const sb of storyboards) {
    const episodeId = String(sb.episodeId ?? '').trim();
    if (!episodeId) continue;
    const shots = parseStoryboardShotsForRecovery(sb.content);
    const shotVideos = sb.shotVideos && typeof sb.shotVideos === 'object' ? sb.shotVideos : {};
    const entry = { shots: shots.length, producedShots: 0, producedSeconds: 0, plannedSeconds: 0 };
    for (const shot of shots) {
      const seconds = shotDurationSeconds(shot, sb);
      entry.plannedSeconds += seconds;
      const hasVideo = Boolean(shotVideos[String(shot.no)]?.videoUrl || (typeof shotVideos[String(shot.no)] === 'string' && shotVideos[String(shot.no)]));
      if (hasVideo) {
        entry.producedShots += 1;
        entry.producedSeconds += seconds;
      }
    }
    episodes[episodeId] = entry;
    totals.episodes += 1;
    totals.shots += entry.shots;
    totals.producedShots += entry.producedShots;
    totals.producedSeconds += entry.producedSeconds;
    totals.plannedSeconds += entry.plannedSeconds;
  }
  return { totals, episodes };
}

// 扫描磁盘上某集已存在的分镜编号：既看 videos/<episodeId>/ 目录，也看 videos/ 下 <episodeId>_ 前缀文件。
export function diskShotNos(projectId, episodeId) {
  const out = new Set();
  const root = path.join(projectDir(projectId), 'videos');
  const dir = path.join(root, String(episodeId));
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.toLowerCase().endsWith('.mp4')) continue;
      out.add(shotNoFromVideoFilename(file));
    }
  } catch {
    // 目录不存在
  }
  try {
    const prefix = `${episodeId}_`;
    for (const file of fs.readdirSync(root)) {
      if (!file.toLowerCase().endsWith('.mp4') || !file.startsWith(prefix)) continue;
      out.add(shotNoFromVideoFilename(file, prefix));
    }
  } catch {
    // 目录不存在
  }
  return out;
}

// 以磁盘实际文件为准对账某个分镜(storyboard)的 shotVideos 映射：磁盘有的补上本地 URL，
// 已有可用 videoUrl 的保留原记录。
export function reconcileShotVideos(projectId, sb) {
  if (!sb || typeof sb !== 'object' || sb.episodeId == null) return sb;
  const incoming = (sb.shotVideos && typeof sb.shotVideos === 'object') ? sb.shotVideos : {};
  const onDisk = diskShotNos(projectId, sb.episodeId);
  const merged = {};
  for (const no of onDisk) {
    const prev = incoming[no];
    // Always issue the canonical URL for the current project id. This also
    // repairs records saved before a project was renamed (their URL still
    // contains the old display-name id).
    const canonical = videoLocalUrl(projectId, sb.episodeId, no);
    const canonicalPath = canonical.split('?')[0];
    const previousUrl = String(prev?.videoUrl || '');
    merged[no] = prev && typeof prev === 'object'
      ? { ...prev, videoUrl: previousUrl.split('?')[0] === canonicalPath ? previousUrl : canonical }
      : { videoUrl: canonical, updatedAt: new Date().toISOString() };
  }
  return { ...sb, shotVideos: merged };
}

// 从分镜文本里按"分镜N/镜头N/【分镜N】"标记切分出每个镜头，用于恢复丢失的分镜结构。
export function parseStoryboardShotsForRecovery(text) {
  const source = String(text || '');
  const raw = source.trim();
  if (!raw) return [];
  const offset = source.indexOf(raw);
  const re = /^[ \t]*(?:分镜|镜头)\s*(\d+)\s*[:：]|【(?:分镜|镜头)\s*(\d+)】/gm;
  const marks = [];
  let match;
  while ((match = re.exec(raw)) !== null) {
    marks.push({ no: match[1] || match[2], start: offset + match.index, headEnd: offset + re.lastIndex });
  }
  if (!marks.length) return [{ no: '1', title: '', body: raw }];
  return marks.map((cur, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].start : offset + raw.length;
    const body = source.slice(cur.headEnd, end).trim();
    const title = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    return { no: cur.no, title, body };
  });
}
