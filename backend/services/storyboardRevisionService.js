import { randomUUID } from 'node:crypto';
import { reconcileShotVideos } from '../shotVideoUtils.js';

function episodeKey(value) {
  return value == null ? '' : String(value);
}

function revisionOf(storyboard) {
  return String(storyboard?.revision || '').trim();
}

export function createStoryboardRevision() {
  return `sb_${randomUUID()}`;
}

export function ensureStoryboardRevisions(storyboards = []) {
  let changed = false;
  for (const storyboard of Array.isArray(storyboards) ? storyboards : []) {
    if (!storyboard || typeof storyboard !== 'object' || storyboard.episodeId == null) continue;
    if (revisionOf(storyboard)) continue;
    storyboard.revision = createStoryboardRevision();
    changed = true;
  }
  return changed;
}

export function stampGeneratedStoryboard(storyboard = {}) {
  return {
    ...storyboard,
    revision: createStoryboardRevision(),
    updatedAt: new Date().toISOString(),
  };
}

export function mergeStoryboardUpdates(projectId, currentStoryboards = [], incomingStoryboards = [], options = {}) {
  const allowedEpisodeIds = options.allowedEpisodeIds instanceof Set ? options.allowedEpisodeIds : null;
  // 增量保存：客户端已知这些分镜、只是本次没有改动——它们不算冲突。
  // 不在名单里的服务端分镜才是客户端没见过的（如服务端刚生成的），仍按
  // 冲突上报让客户端拉回本地。传 null 表示整包提交（旧行为不变）。
  const clientKnownEpisodeIds = options.clientKnownEpisodeIds instanceof Set ? options.clientKnownEpisodeIds : null;
  const merged = (Array.isArray(currentStoryboards) ? currentStoryboards : [])
    .filter((storyboard) => !allowedEpisodeIds || allowedEpisodeIds.has(episodeKey(storyboard?.episodeId)))
    .map((storyboard) => ({ ...storyboard }));
  ensureStoryboardRevisions(merged);

  const incoming = Array.isArray(incomingStoryboards) ? incomingStoryboards : [];
  const incomingIds = new Set();
  const conflicts = new Set();
  const indexByEpisode = new Map(
    merged.map((storyboard, index) => [episodeKey(storyboard?.episodeId), index]),
  );

  for (const rawStoryboard of incoming) {
    if (!rawStoryboard || typeof rawStoryboard !== 'object' || rawStoryboard.episodeId == null) continue;
    const key = episodeKey(rawStoryboard.episodeId);
    if (allowedEpisodeIds && !allowedEpisodeIds.has(key)) continue;
    incomingIds.add(key);
    const existingIndex = indexByEpisode.get(key);
    if (existingIndex == null) {
      const inserted = reconcileShotVideos(projectId, {
        ...rawStoryboard,
        revision: revisionOf(rawStoryboard) || createStoryboardRevision(),
      });
      indexByEpisode.set(key, merged.length);
      merged.push(inserted);
      continue;
    }

    const existing = merged[existingIndex];
    const currentRevision = revisionOf(existing);
    const incomingRevision = revisionOf(rawStoryboard);
    const wouldEraseContent = String(existing?.content || '').trim()
      && !String(rawStoryboard?.content || '').trim();
    if (incomingRevision !== currentRevision || wouldEraseContent) {
      conflicts.add(key);
      continue;
    }

    merged[existingIndex] = reconcileShotVideos(projectId, {
      ...existing,
      ...rawStoryboard,
      revision: currentRevision,
    });
  }

  for (const storyboard of merged) {
    const key = episodeKey(storyboard?.episodeId);
    if (incomingIds.has(key)) continue;
    if (clientKnownEpisodeIds && clientKnownEpisodeIds.has(key)) continue;
    conflicts.add(key);
  }

  merged.sort((a, b) => Number(a?.episodeId) - Number(b?.episodeId));
  return {
    storyboards: merged,
    conflicts: [...conflicts],
  };
}
