const DEFAULT_BEAT_TARGET_CHARS = 520;
const DEFAULT_BEAT_MAX_CHARS = 920;
const DEFAULT_PLAN_BATCH_CHARS = 28000;

import { createHash } from 'node:crypto';

export const WHOLE_NOVEL_PLANNING_CHECKPOINT_VERSION = 1;

export function normalizeWholeNovelPlanningOptions(options = {}) {
  return {
    readWindowSize: Math.max(20000, Math.min(Number(options.readWindowSize) || 32000, 50000)),
    stageGroupSize: Math.max(2, Math.min(Number(options.stageGroupSize) || 4, 6)),
    planBatchChars: Math.max(12000, Math.min(Number(options.planBatchChars) || 22000, 32000)),
  };
}

export function wholeNovelPlanningSourceSignature(chapters = []) {
  const hash = createHash('sha256');
  const sorted = chapters.slice().sort((a, b) => (
    (Number(a.order) || 0) - (Number(b.order) || 0)
    || (Number(a.id) || 0) - (Number(b.id) || 0)
  ));
  for (const chapter of sorted) {
    const sourceText = String(chapter?.sourceText || '');
    hash.update(JSON.stringify({
      id: Number(chapter?.id) || 0,
      order: Number(chapter?.order) || 0,
      title: String(chapter?.title || ''),
      length: sourceText.length,
    }));
    hash.update('\0');
    hash.update(sourceText);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function wholeNovelPlanningCheckpointMatches(checkpoint, sourceSignature, options = {}) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return false;
  if (Number(checkpoint.version) !== WHOLE_NOVEL_PLANNING_CHECKPOINT_VERSION) return false;
  if (String(checkpoint.sourceSignature || '') !== String(sourceSignature || '')) return false;
  const expected = normalizeWholeNovelPlanningOptions(options);
  const actual = normalizeWholeNovelPlanningOptions(checkpoint.options || {});
  return Object.keys(expected).every((key) => Number(actual[key]) === Number(expected[key]));
}

export function createWholeNovelPlanningCheckpoint(sourceSignature, options = {}) {
  return {
    version: WHOLE_NOVEL_PLANNING_CHECKPOINT_VERSION,
    sourceSignature: String(sourceSignature || ''),
    options: normalizeWholeNovelPlanningOptions(options),
    status: 'running',
    phase: 'novel_digest',
    digests: [],
    stageBibles: [],
    wholeNovelBible: null,
    seriesPlan: null,
    episodePlan: [],
    completedPlanBatches: [],
    lastError: '',
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeWholeNovelPlanningCheckpoint(checkpoint, sourceSignature, options = {}, { forceRestart = false } = {}) {
  if (forceRestart || !wholeNovelPlanningCheckpointMatches(checkpoint, sourceSignature, options)) {
    return createWholeNovelPlanningCheckpoint(sourceSignature, options);
  }
  const normalized = {
    ...createWholeNovelPlanningCheckpoint(sourceSignature, options),
    ...checkpoint,
    version: WHOLE_NOVEL_PLANNING_CHECKPOINT_VERSION,
    sourceSignature: String(sourceSignature || ''),
    options: normalizeWholeNovelPlanningOptions(options),
  };
  normalized.status = ['running', 'failed', 'complete'].includes(normalized.status) ? normalized.status : 'running';
  normalized.digests = Array.isArray(normalized.digests) ? normalized.digests : [];
  normalized.stageBibles = Array.isArray(normalized.stageBibles) ? normalized.stageBibles : [];
  normalized.episodePlan = Array.isArray(normalized.episodePlan) ? normalized.episodePlan : [];
  normalized.completedPlanBatches = Array.isArray(normalized.completedPlanBatches)
    ? normalized.completedPlanBatches
      .map((item) => ({
        key: String(item?.key || ''),
        episodeCount: Math.max(0, Number(item?.episodeCount) || 0),
      }))
      .filter((item) => item.key)
    : [];
  return normalized;
}

export function reconcileWholeNovelPlanningBatches(checkpoint = {}, expectedBatchKeys = []) {
  const completed = Array.isArray(checkpoint.completedPlanBatches) ? checkpoint.completedPlanBatches : [];
  const expected = expectedBatchKeys.map((key) => String(key || ''));
  let validCount = 0;
  let episodeCount = 0;
  while (validCount < completed.length && validCount < expected.length) {
    const item = completed[validCount];
    if (!item || String(item.key || '') !== expected[validCount]) break;
    const count = Math.max(0, Number(item.episodeCount) || 0);
    if (!count) break;
    episodeCount += count;
    validCount += 1;
  }
  return {
    completedPlanBatches: completed.slice(0, validCount),
    episodePlan: (Array.isArray(checkpoint.episodePlan) ? checkpoint.episodePlan : []).slice(0, episodeCount),
    validCount,
  };
}

function cleanText(value) {
  return String(value || '');
}

function trimSpan(source, start, end) {
  let from = Math.max(0, start);
  let to = Math.min(source.length, end);
  while (from < to && /\s/.test(source[from])) from++;
  while (to > from && /\s/.test(source[to - 1])) to--;
  return to > from ? { start: from, end: to } : null;
}

function paragraphSpans(source) {
  const spans = [];
  const re = /\n\s*\n/g;
  let cursor = 0;
  let match;
  while ((match = re.exec(source)) !== null) {
    const span = trimSpan(source, cursor, match.index);
    if (span) spans.push(span);
    cursor = match.index + match[0].length;
  }
  const tail = trimSpan(source, cursor, source.length);
  if (tail) spans.push(tail);
  if (!spans.length && source.trim()) {
    const only = trimSpan(source, 0, source.length);
    if (only) spans.push(only);
  }
  return spans;
}

function splitOversizedSpan(source, span, maxChars) {
  if (span.end - span.start <= maxChars) return [span];
  const out = [];
  let cursor = span.start;
  while (cursor < span.end) {
    let end = Math.min(span.end, cursor + maxChars);
    if (end < span.end) {
      const searchStart = Math.min(end, cursor + Math.floor(maxChars * 0.55));
      const slice = source.slice(searchStart, end);
      const punct = Math.max(
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('。'),
        slice.lastIndexOf('！'),
        slice.lastIndexOf('？'),
        slice.lastIndexOf('；'),
        slice.lastIndexOf(';'),
      );
      if (punct >= 0) end = searchStart + punct + 1;
    }
    const piece = trimSpan(source, cursor, end);
    if (piece) out.push(piece);
    cursor = Math.max(end, cursor + 1);
  }
  return out;
}

function chapterBeatSpans(source, targetChars, maxChars) {
  const atomic = paragraphSpans(source)
    .flatMap((span) => splitOversizedSpan(source, span, maxChars));
  const groups = [];
  let current = null;
  for (const span of atomic) {
    if (!current) {
      current = { ...span };
      continue;
    }
    const mergedLength = span.end - current.start;
    if (mergedLength > maxChars || current.end - current.start >= targetChars) {
      groups.push(current);
      current = { ...span };
      continue;
    }
    current.end = span.end;
  }
  if (current) groups.push(current);
  return groups;
}

export function buildSourceBeatIndex(chapters = [], options = {}) {
  const targetChars = Math.max(240, Number(options.targetChars) || DEFAULT_BEAT_TARGET_CHARS);
  const maxChars = Math.max(targetChars, Number(options.maxChars) || DEFAULT_BEAT_MAX_CHARS);
  const beats = [];
  const sorted = chapters.slice().sort((a, b) => (
    (Number(a.order) || 0) - (Number(b.order) || 0)
    || (Number(a.id) || 0) - (Number(b.id) || 0)
  ));
  sorted.forEach((chapter, chapterSequence) => {
    const source = cleanText(chapter?.sourceText || '');
    if (!source.trim()) return;
    const spans = chapterBeatSpans(source, targetChars, maxChars);
    spans.forEach((span, beatIndex) => {
      const text = source.slice(span.start, span.end).trim();
      if (!text) return;
      beats.push({
        id: `CH${chapter.id}-B${String(beatIndex + 1).padStart(4, '0')}`,
        chapterId: chapter.id,
        chapterOrder: chapter.order,
        chapterSequence: chapterSequence + 1,
        chapterTitle: String(chapter.title || `第${chapterSequence + 1}章`).trim(),
        startOffset: span.start,
        endOffset: span.end,
        anchor: text.replace(/\s+/g, ' ').slice(0, 72),
        text,
      });
    });
  });
  return beats;
}

export function serializeSourceBeatIndex(beats = []) {
  return beats.map((beat) => ({
    id: beat.id,
    chapterId: beat.chapterId,
    chapterOrder: beat.chapterOrder,
    chapterSequence: beat.chapterSequence,
    chapterTitle: beat.chapterTitle,
    startOffset: beat.startOffset,
    endOffset: beat.endOffset,
    anchor: beat.anchor,
  }));
}

export function sourceBeatCatalogText(beats = []) {
  return beats.map((beat) => (
    `【${beat.id}｜章节ID ${beat.chapterId}｜${beat.chapterTitle}｜${beat.startOffset}-${beat.endOffset}】\n${beat.text}`
  )).join('\n\n');
}

function beatPromptChars(beat) {
  return String(beat?.text || '').length + String(beat?.id || '').length + String(beat?.chapterTitle || '').length + 48;
}

function splitBeatGroup(beats, maxChars) {
  const groups = [];
  let current = [];
  let chars = 0;
  for (const beat of beats) {
    const next = beatPromptChars(beat);
    if (current.length && chars + next > maxChars) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(beat);
    chars += next;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function buildBeatPlanningBatches(beats = [], options = {}) {
  const maxChars = Math.max(8000, Number(options.maxChars) || DEFAULT_PLAN_BATCH_CHARS);
  const byChapter = [];
  for (const beat of beats) {
    const last = byChapter[byChapter.length - 1];
    if (last && last.chapterId === beat.chapterId) last.beats.push(beat);
    else byChapter.push({ chapterId: beat.chapterId, beats: [beat] });
  }
  const batches = [];
  let current = [];
  let chars = 0;
  const flush = () => {
    if (!current.length) return;
    batches.push({
      beats: current,
      chapterStartId: current[0].chapterId,
      chapterEndId: current[current.length - 1].chapterId,
      firstBeatId: current[0].id,
      lastBeatId: current[current.length - 1].id,
      chars,
    });
    current = [];
    chars = 0;
  };
  for (const chapter of byChapter) {
    const chapterChars = chapter.beats.reduce((sum, beat) => sum + beatPromptChars(beat), 0);
    if (chapterChars > maxChars) {
      flush();
      for (const group of splitBeatGroup(chapter.beats, maxChars)) {
        const groupChars = group.reduce((sum, beat) => sum + beatPromptChars(beat), 0);
        batches.push({
          beats: group,
          chapterStartId: group[0].chapterId,
          chapterEndId: group[group.length - 1].chapterId,
          firstBeatId: group[0].id,
          lastBeatId: group[group.length - 1].id,
          chars: groupChars,
        });
      }
      continue;
    }
    if (current.length && chars + chapterChars > maxChars) flush();
    current.push(...chapter.beats);
    chars += chapterChars;
  }
  flush();
  return batches.map((batch, index) => ({ ...batch, index, total: batches.length }));
}

function parseChapterId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeSeriesPlan(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const arcs = Array.isArray(source.arcPlan)
    ? source.arcPlan
    : (Array.isArray(source.arcs) ? source.arcs : []);
  return {
    seriesStrategy: source.seriesStrategy && typeof source.seriesStrategy === 'object' ? source.seriesStrategy : {},
    arcPlan: arcs.map((arc, index) => ({
      ...arc,
      arcId: String(arc?.arcId || `ARC-${String(index + 1).padStart(2, '0')}`),
      arcName: String(arc?.arcName || arc?.name || `阶段${index + 1}`).trim(),
      startChapterId: parseChapterId(arc?.startChapterId ?? arc?.startChapter),
      endChapterId: parseChapterId(arc?.endChapterId ?? arc?.endChapter),
      coreConflict: String(arc?.coreConflict || '').trim(),
      dramaticFunction: String(arc?.dramaticFunction || '').trim(),
      emotionDrive: String(arc?.emotionDrive || '').trim(),
      endingTarget: String(arc?.endingTarget || '').trim(),
      doNotReveal: Array.isArray(arc?.doNotReveal) ? arc.doNotReveal : [],
      mustKeep: Array.isArray(arc?.mustKeep) ? arc.mustKeep : [],
    })),
  };
}

export function validateSeriesPlan(plan = {}, chapters = []) {
  const errors = [];
  const sorted = chapters.slice().sort((a, b) => (
    (Number(a.order) || 0) - (Number(b.order) || 0)
    || (Number(a.id) || 0) - (Number(b.id) || 0)
  ));
  const chapterIds = sorted.map((chapter) => Number(chapter.id));
  const position = new Map(chapterIds.map((id, index) => [id, index]));
  const arcs = Array.isArray(plan.arcPlan) ? plan.arcPlan : [];
  if (!arcs.length) return ['arcPlan 不能为空'];
  let expectedStart = 0;
  arcs.forEach((arc, index) => {
    const startPos = position.get(Number(arc.startChapterId));
    const endPos = position.get(Number(arc.endChapterId));
    if (startPos === undefined) errors.push(`第${index + 1}阶段 startChapterId 无效`);
    if (endPos === undefined) errors.push(`第${index + 1}阶段 endChapterId 无效`);
    if (startPos === undefined || endPos === undefined) return;
    if (startPos > endPos) errors.push(`第${index + 1}阶段章节范围倒置`);
    if (startPos !== expectedStart) errors.push(`第${index + 1}阶段未从期望章节位置 ${expectedStart + 1} 开始`);
    expectedStart = endPos + 1;
  });
  if (expectedStart !== chapterIds.length) errors.push('阶段规划没有完整覆盖全部章节');
  return errors;
}

export function findArcForChapter(arcs = [], chapterId, chapters = []) {
  const sorted = chapters.slice().sort((a, b) => (
    (Number(a.order) || 0) - (Number(b.order) || 0)
    || (Number(a.id) || 0) - (Number(b.id) || 0)
  ));
  const position = new Map(sorted.map((chapter, index) => [Number(chapter.id), index]));
  const current = position.get(Number(chapterId));
  if (current === undefined) return null;
  return (Array.isArray(arcs) ? arcs : []).find((arc) => {
    const start = position.get(Number(arc?.startChapterId));
    const end = position.get(Number(arc?.endChapterId));
    return start !== undefined && end !== undefined && current >= start && current <= end;
  }) || null;
}

export function beatsForArc(beats = [], arc = {}, chapters = []) {
  const sorted = chapters.slice().sort((a, b) => (
    (Number(a.order) || 0) - (Number(b.order) || 0)
    || (Number(a.id) || 0) - (Number(b.id) || 0)
  ));
  const position = new Map(sorted.map((chapter, index) => [Number(chapter.id), index]));
  const start = position.get(Number(arc.startChapterId));
  const end = position.get(Number(arc.endChapterId));
  if (start === undefined || end === undefined || start > end) return [];
  const allowed = new Set(sorted.slice(start, end + 1).map((chapter) => Number(chapter.id)));
  return beats.filter((beat) => allowed.has(Number(beat.chapterId)));
}

function endingHookObject(value, fallback = '') {
  if (value && typeof value === 'object') {
    return {
      type: String(value.type || '追看动力').trim(),
      content: String(value.content || value.hook || fallback || '').trim(),
    };
  }
  return { type: '追看动力', content: String(value || fallback || '').trim() };
}

export function normalizeEpisodeBatchPlan(raw = {}, startEpisodeNumber = 1) {
  const episodes = Array.isArray(raw?.episodes)
    ? raw.episodes
    : (Array.isArray(raw?.episodePlan) ? raw.episodePlan : []);
  return episodes.map((episode, index) => {
    const number = startEpisodeNumber + index;
    return {
      ...episode,
      episodeNumber: number,
      title: String(episode?.title || `第${number}集`).trim(),
      sourceBeatIds: Array.isArray(episode?.sourceBeatIds)
        ? episode.sourceBeatIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [],
      plotGoal: String(episode?.plotGoal || '').trim(),
      keyScenes: Array.isArray(episode?.keyScenes) ? episode.keyScenes : [],
      compression: String(episode?.compression || '').trim(),
      mustExplain: Array.isArray(episode?.mustExplain) ? episode.mustExplain : [],
      causalBridge: Array.isArray(episode?.causalBridge)
        ? episode.causalBridge
        : (episode?.causalBridge ? [String(episode.causalBridge)] : []),
      emotionAction: String(episode?.emotionAction || '').trim(),
      revealNow: Array.isArray(episode?.revealNow) ? episode.revealNow : [],
      hideUntilLater: Array.isArray(episode?.hideUntilLater) ? episode.hideUntilLater : [],
      endingHook: endingHookObject(episode?.endingHook, episode?.cliffhanger),
    };
  });
}

export function validateEpisodeBatchPlan(episodes = [], beats = [], startEpisodeNumber = 1) {
  const errors = [];
  const expectedIds = beats.map((beat) => beat.id);
  const valid = new Set(expectedIds);
  const flattened = [];
  episodes.forEach((episode, index) => {
    if (Number(episode.episodeNumber) !== startEpisodeNumber + index) {
      errors.push(`第${index + 1}个规划集号不连续`);
    }
    if (!episode.sourceBeatIds?.length) errors.push(`第${index + 1}集没有 sourceBeatIds`);
    for (const id of episode.sourceBeatIds || []) {
      if (!valid.has(id)) errors.push(`第${index + 1}集引用了无效素材ID ${id}`);
      flattened.push(id);
    }
  });
  const seen = new Set();
  for (const id of flattened) {
    if (seen.has(id)) errors.push(`素材ID重复分配：${id}`);
    seen.add(id);
  }
  if (flattened.length !== expectedIds.length) {
    errors.push(`素材覆盖数量不一致：期望 ${expectedIds.length}，实际 ${flattened.length}`);
  }
  const max = Math.max(flattened.length, expectedIds.length);
  for (let i = 0; i < max; i++) {
    if (flattened[i] !== expectedIds[i]) {
      errors.push(`素材顺序或覆盖断裂：位置${i + 1}期望 ${expectedIds[i] || '无'}，实际 ${flattened[i] || '无'}`);
      break;
    }
  }
  return [...new Set(errors)].slice(0, 20);
}

function rangesFromBeatIds(beatIds, beatMap) {
  const ranges = [];
  for (const id of beatIds) {
    const beat = beatMap.get(id);
    if (!beat) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.chapterId === beat.chapterId) {
      last.endOffset = beat.endOffset;
      last.endBeatId = beat.id;
      continue;
    }
    ranges.push({
      chapterId: beat.chapterId,
      chapterTitle: beat.chapterTitle,
      startOffset: beat.startOffset,
      endOffset: beat.endOffset,
      startBeatId: beat.id,
      endBeatId: beat.id,
      treatment: '',
      reason: '',
    });
  }
  return ranges;
}

export function materializeEpisodesFromBeatPlan(plan = {}, beats = []) {
  const plannedEpisodes = Array.isArray(plan?.episodePlan) ? plan.episodePlan : [];
  if (!plannedEpisodes.length) throw new Error('全剧规划没有 episodePlan');
  const beatMap = new Map(beats.map((beat) => [beat.id, beat]));
  const allExpected = beats.map((beat) => beat.id);
  const allPlanned = plannedEpisodes.flatMap((episode) => episode.sourceBeatIds || []);
  if (allPlanned.length !== allExpected.length || allPlanned.some((id, index) => id !== allExpected[index])) {
    throw new Error('全剧规划的 sourceBeatIds 未按顺序完整覆盖原文，拒绝创建剧集');
  }
  return plannedEpisodes.map((planned, index) => {
    const sourceBeatIds = Array.isArray(planned.sourceBeatIds) ? planned.sourceBeatIds : [];
    const sourceRanges = rangesFromBeatIds(sourceBeatIds, beatMap);
    if (!sourceRanges.length) throw new Error(`第${index + 1}集没有可定位的原文素材`);
    const id = index + 1;
    const endingHook = endingHookObject(planned.endingHook, planned.cliffhanger);
    return {
      id,
      title: planned.title || `第${id}集`,
      chapterId: sourceRanges[0].chapterId,
      startOffset: sourceRanges[0].startOffset,
      endOffset: sourceRanges[0].endOffset,
      sourceMode: 'wholeNovel',
      sourceBeatIds,
      sourceRanges,
      plotGoal: planned.plotGoal || '',
      compression: planned.compression || '',
      mustExplain: Array.isArray(planned.mustExplain) ? planned.mustExplain : [],
      causalBridge: Array.isArray(planned.causalBridge) ? planned.causalBridge : [],
      emotionAction: planned.emotionAction || '',
      revealNow: Array.isArray(planned.revealNow) ? planned.revealNow : [],
      hideUntilLater: Array.isArray(planned.hideUntilLater) ? planned.hideUntilLater : [],
      keyScenes: Array.isArray(planned.keyScenes) ? planned.keyScenes : [],
      endingHook,
      cliffhanger: endingHook.content,
      content: '',
    };
  });
}
