// 剧本和分镜共享生成与校验支持
import { loadConfig } from '../config.js';
import { hasTextModelKey, resolveTextModelConfig } from '../modelRouting.js';
import { loadProject, saveProject, normalizeProjectScript, snapToParagraph, MAIN_CATEGORIES } from '../storage.js';
import { chatComplete, chatCompleteStream } from '../apiClient.js';
import { createSseSession, sseSend } from '../lib/sse.js';
import {
  ADAPTATION_STRENGTH_LABELS,
  generateCustomEpisodeScriptPrompt,
  generateCustomStoryboardPrompt,
  generateEpisodeScriptPrompt,
  generateStoryboardPrompt,
  generateChapterSplitPrompt,
  generateWholeNovelBiblePrompt,
  generateWholeNovelDigestPrompt,
  generateWholeNovelSeriesPlanPrompt,
  generateArcEpisodeBatchPrompt,
  generateWholeEpisodeReviewPrompt,
  generateWholeEpisodeRepairPrompt,
  generateWholeNovelStageBiblePrompt,
  normalizeAdaptationStrength,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
} from '../scriptPrompts.js';
import {
  parseStoryboardShotsForRecovery,
  reconcileShotVideos,
} from '../shotVideoUtils.js';
import { mergeStoryboardUpdates } from '../services/storyboardRevisionService.js';
import { clearPendingByProject } from '../pendingVideos.js';
import { deleteEpisodeMediaFiles } from '../videoFunctions.js';
import { extractJsonObject as extractJsonObjectShared } from '../jsonParse.js';
import {
  beatsForArc,
  findArcForChapter,
  buildBeatPlanningBatches,
  buildSourceBeatIndex,
  materializeEpisodesFromBeatPlan,
  normalizeEpisodeBatchPlan,
  normalizeSeriesPlan,
  serializeSourceBeatIndex,
  sourceBeatCatalogText,
  validateEpisodeBatchPlan,
  validateSeriesPlan,
} from '../services/scriptAdaptationPlanning.js';
import {
  buildStoryboardCoverageGuard as storyboardCoverageGuard,
  recommendedStoryboardChunkSize,
  renumberStoryboardShots,
} from '../services/storyboardCoverageService.js';

export function nextAvailableEpisodeId(episodes = []) {
  const used = new Set(episodes.map((episode) => Number(episode?.id)).filter((id) => Number.isInteger(id) && id > 0));
  let id = 1;
  while (used.has(id)) id += 1;
  return id;
}

// 本地辅助函数（从 server.js 移动）
function extractJsonObject(text) {
  return extractJsonObjectShared(text, {
    emptyMessage: 'Agent returned an empty response',
    invalidMessage: 'Agent response was not valid JSON',
  });
}

function clampGenerationChunkSize(value, fallback, max, min = 3000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(Math.floor(n), max));
}

function splitLongBlock(block, maxChars) {
  const text = String(block || '');
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + maxChars);
    if (end < text.length) {
      const windowStart = Math.max(cursor + Math.floor(maxChars * 0.55), cursor);
      const slice = text.slice(windowStart, end);
      const punct = Math.max(
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('。'),
        slice.lastIndexOf('！'),
        slice.lastIndexOf('？'),
        slice.lastIndexOf(';'),
        slice.lastIndexOf('；'),
      );
      if (punct >= 0) end = windowStart + punct + 1;
    }
    chunks.push(text.slice(cursor, end).trim());
    cursor = end;
  }
  return chunks.filter(Boolean);
}

function splitTextForGeneration(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];
  const blocks = source.split(/(\n{2,})/);
  const chunks = [];
  let buf = '';
  for (let i = 0; i < blocks.length; i += 2) {
    const block = `${blocks[i] || ''}${blocks[i + 1] || ''}`;
    if (!block.trim()) continue;
    if (block.length > maxChars) {
      if (buf.trim()) chunks.push(buf.trim());
      buf = '';
      chunks.push(...splitLongBlock(block, maxChars));
      continue;
    }
    if (buf && buf.length + block.length > maxChars) {
      chunks.push(buf.trim());
      buf = '';
    }
    buf += block;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function splitTextWindows(text, maxChars, overlapChars = 0) {
  const source = String(text || '');
  const chunks = splitTextForGeneration(source, maxChars);
  const windows = [];
  let searchFrom = 0;
  for (const chunk of chunks) {
    let start = source.indexOf(chunk, searchFrom);
    if (start < 0) start = searchFrom;
    const end = Math.min(source.length, start + chunk.length);
    windows.push({ text: source.slice(start, end), start, end });
    searchFrom = Math.max(end - Math.max(0, overlapChars), end);
  }
  return windows;
}

function cleanImportedChapterTitle(title, fallback) {
  const normalized = String(title || '')
    .replace(/^[\s#>*\-·•]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || fallback || '未命名章节').slice(0, 80);
}

function splitWholeNovelIntoChapters(text, { fallbackSize = 60000 } = {}) {
  const source = String(text || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').trim();
  if (!source) return { chapters: [], method: 'empty' };
  const headingRe = /^[ \t　]*(?:(?:第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇幕]\s*[^\n]{0,80})|(?:卷\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+[^\n]{0,80})|(?:chapter\s*\d+[^\n]{0,80}))[ \t　]*$/gim;
  const marks = [];
  let match;
  while ((match = headingRe.exec(source)) !== null) {
    const title = String(match[0] || '').trim();
    if (title && title.length <= 100) marks.push({ start: match.index, title });
  }
  if (marks.length) {
    const chapters = [];
    const preface = source.slice(0, marks[0].start).trim();
    if (preface) chapters.push({ title: '序章', sourceText: preface });
    for (let i = 0; i < marks.length; i++) {
      const current = marks[i];
      const end = i + 1 < marks.length ? marks[i + 1].start : source.length;
      const sourceText = source.slice(current.start, end).trim();
      if (!sourceText) continue;
      chapters.push({
        title: cleanImportedChapterTitle(current.title, `第${chapters.length + 1}章`),
        sourceText,
      });
    }
    return { chapters, method: 'heading' };
  }
  const size = Math.max(20000, Math.min(Number(fallbackSize) || 60000, 100000));
  const chunks = splitTextWindows(source, size);
  return {
    chapters: chunks.map((chunk, index) => ({
      title: `第${String(index + 1).padStart(2, '0')}章`,
      sourceText: chunk.text,
    })),
    method: 'chunk',
  };
}

function tailSnippet(text, max = 800) {
  return String(text || '').replace(/\s+/g, ' ').slice(-max);
}

function compactReferenceText(text, max = 40000) {
  const source = String(text || '');
  if (source.length <= max) return source;
  const head = Math.floor(max * 0.65);
  const tail = max - head;
  return `${source.slice(0, head)}\n\n...（中间内容已为分段生成压缩，仅供冷开场抓取全章爆点）...\n\n${source.slice(-tail)}`;
}

function wholeNovelBibleText(script = {}, max = 30000) {
  const bible = script?.wholeNovelBible;
  if (!bible) return '';
  const raw = typeof bible === 'string' ? bible : JSON.stringify(bible, null, 2);
  return compactReferenceText(raw, max);
}

function wholeNovelBibleBlock(script = {}, max = 30000) {
  const text = wholeNovelBibleText(script, max);
  return text ? `【全书故事圣经】\n${text}` : '';
}

function wholeNovelEpisodePlanText(script = {}, max = 24000) {
  const plan = script?.wholeNovelEpisodePlan;
  if (!plan) return '';
  const raw = typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2);
  return compactReferenceText(raw, max);
}

function wholeNovelEpisodePlanBlock(script = {}, max = 24000) {
  const text = wholeNovelEpisodePlanText(script, max);
  return text ? `【全剧集总规划】\n${text}` : '';
}

function wholeNovelEpisodeContextBlock(script = {}, episode = {}, max = 20000) {
  const plan = script?.wholeNovelEpisodePlan;
  if (!plan || typeof plan !== 'object') return wholeNovelEpisodePlanBlock(script, max);
  const episodePlan = Array.isArray(plan.episodePlan) ? plan.episodePlan : [];
  const currentIndex = episodePlan.findIndex((item, index) => Number(item?.episodeNumber || index + 1) === Number(episode?.id));
  const current = currentIndex >= 0 ? episodePlan[currentIndex] : null;
  const chapterId = Number(episode?.sourceRanges?.[0]?.chapterId || episode?.chapterId);
  const arc = findArcForChapter(plan.arcPlan, chapterId, sortedChapters(script));
  const payload = {
    seriesStrategy: plan.seriesStrategy || {},
    currentArc: arc || null,
    previousEpisode: currentIndex > 0 ? episodePlan[currentIndex - 1] : null,
    currentEpisode: current,
    nextEpisode: currentIndex >= 0 && currentIndex + 1 < episodePlan.length ? episodePlan[currentIndex + 1] : null,
  };
  return `【当前集全剧规划上下文】
${compactReferenceText(JSON.stringify(payload, null, 2), max)}`;
}

function sortedChapters(script = {}) {
  return (Array.isArray(script.chapters) ? script.chapters : [])
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));
}

function episodeReferencesChapter(episode = {}, chapterId) {
  const targetId = Number(chapterId);
  if (Number(episode?.chapterId) === targetId) return true;
  return Array.isArray(episode?.sourceRanges)
    && episode.sourceRanges.some((range) => Number(range?.chapterId) === targetId);
}

function invalidateWholeNovelPlanning(script = {}) {
  script.wholeNovelBible = null;
  script.wholeNovelBibleUpdatedAt = '';
  script.wholeNovelStageBibles = [];
  script.wholeNovelSourceBeatIndex = [];
  script.wholeNovelEpisodePlan = null;
  script.wholeNovelPlanningCheckpoint = null;
  script.wholeNovelAdapted = false;
  script.wholeNovelPlanningStale = true;
}

function wholeNovelSourceForReading(chapters = []) {
  return chapters
    .map((chapter, index) => {
      const title = String(chapter.title || `第${index + 1}章`).trim();
      const text = String(chapter.sourceText || '').trim();
      return text ? `【${title}】\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function generateValidatedSeriesPlan({
  cfg,
  wholeNovelBible,
  stageBibles,
  chapters,
  signal,
} = {}) {
  const chapterIndex = chapters.map((chapter, index) => ({
    id: chapter.id,
    sequence: index + 1,
    order: chapter.order,
    title: chapter.title,
    length: String(chapter.sourceText || '').length,
  }));
  const messages = generateWholeNovelSeriesPlanPrompt({ wholeNovelBible, stageBibles, chapterIndex });
  let raw = await chatComplete(cfg, messages, {
    temperature: 0.2,
    maxTokens: 12000,
    allowTruncated: true,
    signal,
  });
  let parsed;
  let errors;
  try {
    parsed = normalizeSeriesPlan(extractJsonObject(raw));
    errors = validateSeriesPlan(parsed, chapters);
  } catch (error) {
    parsed = normalizeSeriesPlan({});
    errors = [`返回内容不是有效 JSON：${error?.message || '解析失败'}`];
  }
  if (errors.length) {
    raw = await chatComplete(cfg, [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `上面的阶段规划没有通过程序校验，请修正后重新输出完整 JSON。\n\n【校验错误】\n${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}\n\n必须使用章节索引中的真实 startChapterId/endChapterId，并完整、连续、无重叠覆盖全部章节。不要输出逐集规划。`,
      },
    ], {
      temperature: 0.1,
      maxTokens: 12000,
      allowTruncated: true,
      signal,
    });
    try {
      parsed = normalizeSeriesPlan(extractJsonObject(raw));
      errors = validateSeriesPlan(parsed, chapters);
    } catch (error) {
      parsed = normalizeSeriesPlan({});
      errors = [`修正结果仍不是有效 JSON：${error?.message || '解析失败'}`];
    }
  }
  if (errors.length) throw new Error(`全剧阶段规划校验失败：${errors.join('；')}`);
  return parsed;
}

async function generateValidatedEpisodeBatch({
  cfg,
  wholeNovelBible,
  seriesPlan,
  arc,
  batch,
  startEpisodeNumber,
  previousBatchSummary,
  signal,
} = {}) {
  const messages = generateArcEpisodeBatchPrompt({
    wholeNovelBible,
    seriesPlan,
    arc,
    sourceBeatCatalog: sourceBeatCatalogText(batch.beats),
    batchIndex: batch.index,
    batchTotal: batch.total,
    startEpisodeNumber,
    previousBatchSummary,
  });
  let raw = await chatComplete(cfg, messages, {
    temperature: 0.22,
    maxTokens: 14000,
    allowTruncated: true,
    signal,
  });
  let episodes;
  let errors;
  try {
    episodes = normalizeEpisodeBatchPlan(extractJsonObject(raw), startEpisodeNumber);
    errors = validateEpisodeBatchPlan(episodes, batch.beats, startEpisodeNumber);
  } catch (error) {
    episodes = [];
    errors = [`返回内容不是有效 JSON：${error?.message || '解析失败'}`];
  }
  if (errors.length) {
    raw = await chatComplete(cfg, [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `上面的分集规划没有通过素材覆盖校验，请修正后重新输出完整 JSON。\n\n【校验错误】\n${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}\n\n修正要求：当前素材目录中的每一个ID必须且只能出现一次；flatten 后的 sourceBeatIds 顺序必须与素材目录完全一致；不得新增、遗漏、重复或跳序。`,
      },
    ], {
      temperature: 0.08,
      maxTokens: 14000,
      allowTruncated: true,
      signal,
    });
    try {
      episodes = normalizeEpisodeBatchPlan(extractJsonObject(raw), startEpisodeNumber);
      errors = validateEpisodeBatchPlan(episodes, batch.beats, startEpisodeNumber);
    } catch (error) {
      episodes = [];
      errors = [`修正结果仍不是有效 JSON：${error?.message || '解析失败'}`];
    }
  }
  if (errors.length) {
    throw new Error(`阶段「${arc.arcName || arc.arcId}」批次 ${batch.index + 1}/${batch.total} 分集校验失败：${errors.join('；')}`);
  }
  return episodes;
}

function episodeBatchTailSummary(episodes = []) {
  const last = episodes[episodes.length - 1];
  if (!last) return '';
  return [
    `上一批最后一集：第${last.episodeNumber}集《${last.title}》`,
    last.plotGoal ? `局面变化：${last.plotGoal}` : '',
    last.endingHook?.content ? `结尾追看动力：${last.endingHook.content}` : '',
    last.sourceBeatIds?.length ? `最后素材ID：${last.sourceBeatIds[last.sourceBeatIds.length - 1]}` : '',
  ].filter(Boolean).join('\n');
}

function validateChapterSplitAnchorPlan(episodes = [], text = '') {
  const errors = [];
  episodes.forEach((episode, index) => {
    const startText = String(episode?.startText || '').trim();
    const endText = String(episode?.endText || '').trim();
    if (!startText) errors.push(`第${index + 1}集缺少 startText`);
    else if (locateSplitAnchor(text, startText, 0, 'start') < 0) errors.push(`第${index + 1}集 startText 无法定位`);
    if (!endText) errors.push(`第${index + 1}集缺少 endText`);
    else if (locateSplitAnchor(text, endText, 0, 'end') < 0) errors.push(`第${index + 1}集 endText 无法定位`);
  });
  return errors;
}

async function splitChapterIntoEpisodesWithContext({
  cfg,
  script,
  chapter,
  startEpisodeNumber,
  globalBible = '',
  splitWindowSize = 80000,
} = {}) {
  const text = String(chapter?.sourceText || '').trim();
  if (!text) return [];
  const windows = splitTextWindows(text, splitWindowSize);
  const eps = [];
  let planningEpisodeNumber = startEpisodeNumber;
  for (let wi = 0; wi < windows.length; wi++) {
    const win = windows[wi];
    const messages = generateChapterSplitPrompt(win.text, planningEpisodeNumber, {
      windowIndex: wi,
      windowTotal: windows.length,
      offsetStart: win.start,
      offsetEnd: win.end,
      maxChars: splitWindowSize,
      globalBible,
    });
    const raw = await chatComplete(cfg.text, messages, { temperature: 0.3, maxTokens: 12000, allowTruncated: true });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`「${chapter.title}」第 ${wi + 1}/${windows.length} 段未返回有效的分集 JSON`);
    const parsed = JSON.parse(match[0]);
    const windowEpisodes = Array.isArray(parsed.episodes) ? parsed.episodes : [];
    const anchorErrors = validateChapterSplitAnchorPlan(windowEpisodes, win.text);
    if (anchorErrors.length) throw new Error(`「${chapter.title}」第 ${wi + 1}/${windows.length} 段锚点校验失败：${anchorErrors.join('；')}`);
    for (const ep of windowEpisodes) {
      eps.push({ ...ep, __windowStart: win.start, __windowEnd: win.end });
    }
    planningEpisodeNumber += windowEpisodes.length;
  }
  if (!eps.length) throw new Error(`未能从「${chapter.title}」分出任何一集`);

  const full = chapter.sourceText;
  const created = [];
  let freshEpisodeId = Math.max(
    Number(startEpisodeNumber) || 1,
    script.episodes.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1
  );
  let cursor = 0;
  eps.forEach((ep, i) => {
    if (cursor >= full.length) return;
    let startOff = cursor;
    const windowStart = Number.isFinite(ep.__windowStart) ? ep.__windowStart : 0;
    const windowEnd = Number.isFinite(ep.__windowEnd) ? ep.__windowEnd : full.length;
    const anchorFrom = Math.max(cursor, windowStart - 80);
    if (!ep.startText) throw new Error(`「${chapter.title}」第${i + 1}个分集缺少 startText`);
    const startIdx = locateSplitAnchor(full, ep.startText, Math.max(0, anchorFrom), 'start');
    if (startIdx < 0) throw new Error(`「${chapter.title}」第${i + 1}个分集 startText 无法定位`);
    startOff = Math.max(cursor, snapSplitBoundary(full, startIdx, cursor));
    if (!ep.endText) throw new Error(`「${chapter.title}」第${i + 1}个分集缺少 endText`);
    const endIdx = locateSplitAnchor(full, ep.endText, Math.max(startOff, windowStart), 'end');
    if (endIdx < 0) throw new Error(`「${chapter.title}」第${i + 1}个分集 endText 无法定位`);
    let endOff = snapSplitBoundary(full, endIdx, startOff);
    const futureStart = locateFutureEpisodeStart(full, eps, i, startOff);
    if ((endOff <= startOff || (endOff >= full.length && i < eps.length - 1)) && futureStart > startOff) {
      endOff = futureStart;
    }
    if (endOff <= startOff) {
      const remainingParts = Math.max(1, eps.length - i);
      const remainingInWindow = Math.max(1, eps.slice(i).filter((x) => x.__windowStart === ep.__windowStart).length);
      const fallbackLimit = windowEnd > startOff ? windowEnd : full.length;
      const fallback = startOff + Math.ceil((fallbackLimit - startOff) / remainingInWindow || (full.length - startOff) / remainingParts);
      endOff = snapSplitBoundary(full, fallback, startOff);
    }
    endOff = Math.max(startOff, Math.min(full.length, endOff));
    if (endOff <= startOff) return;
    cursor = endOff;
    const id = freshEpisodeId++;
    const epObj = {
      id,
      title: ep.title || `第${id}集`,
      chapterId: chapter.id,
      startOffset: startOff,
      endOffset: endOff,
      keyScenes: Array.isArray(ep.keyScenes) ? ep.keyScenes : [],
      mustExplain: Array.isArray(ep.continuityMustExplain)
        ? ep.continuityMustExplain
        : (Array.isArray(ep.mustExplain) ? ep.mustExplain : []),
      causalBridge: Array.isArray(ep.causalBridge)
        ? ep.causalBridge
        : (ep.causalBridge ? [String(ep.causalBridge)] : []),
      emotionAction: String(ep.emotionAction || '').trim(),
      plotGoal: String(ep.plotGoal || '').trim(),
      endingHook: { type: '追看动力', content: String(ep.cliffhanger || '').trim() },
      cliffhanger: ep.cliffhanger || '',
      content: '',
    };
    script.episodes.push(epObj);
    created.push(epObj);
  });
  script.episodes.sort((a, b) => a.id - b.id);
  script.nextEpisodeId = Math.max(
    script.nextEpisodeId || 1,
    script.episodes.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1,
  );
  return created;
}

function episodeSourceText(ep = {}, chapters = []) {
  if (Array.isArray(ep.sourceRanges) && ep.sourceRanges.length) {
    const parts = [];
    for (const range of ep.sourceRanges) {
      const chapter = chapters.find((item) => item.id === range.chapterId);
      if (!chapter) continue;
      const start = Math.max(0, Math.min(String(chapter.sourceText || '').length, Number(range.startOffset) || 0));
      const end = Math.max(start, Math.min(String(chapter.sourceText || '').length, Number(range.endOffset) || 0));
      const text = String(chapter.sourceText || '').slice(start, end).trim();
      if (!text) continue;
      const beatLabel = range.startBeatId
        ? (range.startBeatId === range.endBeatId ? range.startBeatId : `${range.startBeatId}-${range.endBeatId}`)
        : '';
      const note = [beatLabel ? `素材${beatLabel}` : '', range.treatment, range.reason].filter(Boolean).join('；');
      parts.push(`【${chapter.title || '原文片段'}${note ? `｜${note}` : ''}】\n${text}`);
    }
    return parts.join('\n\n');
  }
  const chapter = chapters.find((item) => item.id === ep.chapterId);
  return chapter ? String(chapter.sourceText || '').slice(ep.startOffset, ep.endOffset) : '';
}

function stripEpisodeEndMarkers(text) {
  return String(text || '').replace(/\n*\s*【本集完(?:\s*-\s*留悬念)?】\s*/g, '\n').trim();
}

function renumberScriptScenes(text, startNo) {
  let next = startNo;
  const out = String(text || '').replace(/第\s*\d+\s*场/g, () => `第${next++}场`);
  return { text: out.trim(), nextNo: next };
}

const SCRIPT_COVERAGE_FINDING_LIMIT = 8;
const SCRIPT_DRAMA_FINDING_LIMIT = 8;

function normalizeScriptCoverageFindings(review) {
  const buckets = [
    ...(Array.isArray(review?.missing) ? review.missing : []),
    ...(Array.isArray(review?.unsafeCuts) ? review.unsafeCuts : []),
    ...(Array.isArray(review?.confusing) ? review.confusing : []),
  ];
  return buckets
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { source: text, problem: '疑似漏删或改写过度', mustRestore: text } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const source = String(item.source || item.original || item.text || item.quote || '').trim();
      const problem = String(item.problem || item.issue || item.reason || '疑似漏删或改写过度').trim();
      const mustRestore = String(item.mustRestore || item.restore || item.fix || item.required || item.core || '').trim();
      if (!source && !problem && !mustRestore) return null;
      return { source, problem, mustRestore };
    })
    .filter(Boolean)
    .slice(0, SCRIPT_COVERAGE_FINDING_LIMIT);
}

function normalizeScriptCoverageReview(raw) {
  const parsed = extractJsonObject(raw);
  const findings = normalizeScriptCoverageFindings(parsed);
  return {
    ok: parsed?.ok === true && findings.length === 0,
    findings,
    summary: String(parsed?.summary || parsed?.reason || '').trim(),
  };
}

async function reviewScriptCoverage(cfg, sourceText, scriptText, signal) {
  const source = String(sourceText || '').trim();
  const script = String(scriptText || '').trim();
  if (!source || !script) return { ok: true, findings: [], summary: 'empty source or script' };
  const raw = await chatComplete(cfg, [
    {
      role: 'system',
      content: `你是短剧改编覆盖校验员。你的任务不是润色，而是判断"精准提纯"是否误删、错删或删到看不懂。

校验原则：
1. 只核对用户给出的【本段原文】是否在【已生成剧本】中被完整改编；不要要求逐字照搬。
2. 如果原文事实已经用台词、动作、画面、道具、屏幕信息或场次结果表达出来，就视为已覆盖。
3. 必须标出会影响理解的漏项：人物关系、身份设定、因果承接、关键动作、关键对白/OS、误会、证据、道具、承诺、威胁、交易、决定、时间地点变化、冲突升级、结果落地。
4. 不要标出纯重复情绪、无信息量环境描写、同义反复、已经被合理压缩的寒暄。
5. 只输出 JSON，不要 Markdown，不要解释。

JSON 格式：
{
  "ok": true,
  "summary": "一句话说明",
  "missing": [
    {
      "source": "原文中被漏掉或改坏的短摘",
      "problem": "为什么影响理解",
      "mustRestore": "剧本中必须补回的核心意思"
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `请校验下面这段短剧改编是否误删关键信息。

【本段原文】
${source}

【已生成剧本】
${script}`,
    },
  ], { temperature: 0.1, maxTokens: 6000, allowTruncated: true, signal });
  return normalizeScriptCoverageReview(raw);
}

async function repairScriptCoverage(cfg, baseMessages, scriptText, review, signal) {
  const findings = normalizeScriptCoverageFindings(review);
  if (!findings.length) return scriptText;
  const raw = await chatComplete(cfg, [
    ...baseMessages,
    { role: 'assistant', content: scriptText },
    {
      role: 'user',
      content: `覆盖校验发现上面这段剧本存在误删/漏删风险，请基于最初的原文和规则，重写这一整段剧本。

必须补回的漏项（只补这些，不要编造新剧情）：
${JSON.stringify(findings, null, 2)}

重写要求：
- 输出完整修订后的本段剧本，不要输出分析、说明、JSON 或 Markdown。
- 保留原有格式、场次风格、人物称呼和已经正确的内容。
- 只修复漏掉或改坏的事实、因果、关键对白/OS、动作和关系信息。
- 不要添加原文没有的新事件、新人物关系、新结尾。
- 不要输出【本集完】或【本集完 - 留悬念】，结束标记由系统统一追加。`,
    },
  ], {
    temperature: 0.35,
    maxTokens: generationMaxTokens({ text: cfg }, 48000),
    allowTruncated: true,
    signal,
  });
  const repaired = stripEpisodeEndMarkers(raw).trim();
  return repaired || scriptText;
}

async function reviewAndRepairScriptSegment(cfg, baseMessages, sourceText, scriptText, { enabled = true, onProgress = () => {}, signal } = {}) {
  if (!enabled) return { text: scriptText, reviewed: false, repaired: false, findings: [] };
  let review;
  try {
    onProgress({ status: 'reviewing' });
    review = await reviewScriptCoverage(cfg, sourceText, scriptText, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    onProgress({ status: 'review_failed', message: e?.message || '覆盖校验失败，保留原剧本' });
    return { text: scriptText, reviewed: false, repaired: false, findings: [] };
  }
  if (review.ok || !review.findings.length) {
    onProgress({ status: 'review_done', findings: 0 });
    return { text: scriptText, reviewed: true, repaired: false, findings: [] };
  }
  try {
    onProgress({ status: 'repairing', findings: review.findings.length });
    const repaired = await repairScriptCoverage(cfg, baseMessages, scriptText, review, signal);
    onProgress({ status: 'repair_done', findings: review.findings.length });
    return { text: repaired, reviewed: true, repaired: repaired !== scriptText, findings: review.findings };
  } catch (e) {
    if (signal?.aborted) throw e;
    onProgress({ status: 'repair_failed', findings: review.findings.length, message: e?.message || '补漏重写失败，保留原剧本' });
    return { text: scriptText, reviewed: true, repaired: false, findings: review.findings };
  }
}

function normalizeScriptDramaFindings(review) {
  const buckets = [
    ...(Array.isArray(review?.weaknesses) ? review.weaknesses : []),
    ...(Array.isArray(review?.issues) ? review.issues : []),
    ...(Array.isArray(review?.fixes) ? review.fixes : []),
  ];
  return buckets
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { location: '', issue: text, fix: text } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const location = String(item.location || item.scene || item.part || '').trim();
      const issue = String(item.issue || item.problem || item.weakness || '').trim();
      const fix = String(item.fix || item.suggestion || item.rewriteGoal || item.mustImprove || '').trim();
      if (!location && !issue && !fix) return null;
      return { location, issue, fix };
    })
    .filter(Boolean)
    .slice(0, SCRIPT_DRAMA_FINDING_LIMIT);
}

function normalizeScriptDramaReview(raw) {
  const parsed = extractJsonObject(raw);
  const findings = normalizeScriptDramaFindings(parsed);
  return {
    ok: parsed?.ok === true && findings.length === 0,
    findings,
    summary: String(parsed?.summary || parsed?.reason || '').trim(),
  };
}

async function reviewScriptDramaQuality(cfg, sourceText, scriptText, adaptationStrength, signal) {
  const source = String(sourceText || '').trim();
  const script = String(scriptText || '').trim();
  if (!source || !script) return { ok: true, findings: [], summary: 'empty source or script' };
  const raw = await chatComplete(cfg, [
    {
      role: 'system',
      content: `你是竖屏短剧剧本质量审稿人。你的任务不是检查漏项，而是判断剧本是否具备短剧观看价值。

审稿标准：
1. 开头应尽快给出抓人的画面、台词、冲突、反常信息、危险或强情绪入口；但不能为了抓人牺牲前因后果。
2. 每场戏原则上应有存在理由：钩子、压迫、误会、选择、反击、揭示、关系变化、伏笔、余波、转场、情绪沉淀、信息校准或卡点；纯废戏才需要合并或删除。
3. 主角不能长时间被动，应有判断、选择、反应或行动。
4. 对白要服务人物、冲突、情绪或反转，不能像小说摘要。
5. 情绪曲线要有升级和落差，不能全程同一强度。
6. 画面必须可拍、可画、可分镜，有具体动作、表情、道具、空间和镜头重点。
7. 结尾应留下追看动力，但不必机械硬卡；可用悬念、关系变化、情绪余波、新目标、新代价、新机会或真相推进。
8. 冷开场必须匹配题材玩法和原文核心卖点，不能套用无关题材的狗血套路。
9. 心声、屏幕大字、系统提示、黑幕字幕必须分工清楚；不能把长篇旁白伪装成心声或系统提示。
10. 不要要求新增会改变原文事实的新事件；所有修改都必须基于原文和改编规则。
11. 强化改编必须同时满足逻辑清晰、情绪能被剧情带起来、节奏紧凑：冷开场和精准提纯不能牺牲人物动机、因果链、关系变化和情绪递进。
12. 原文覆盖必须分级：A类主线事件/动机/关系/关键对白必须落地；B/D类要压缩或合并；C类注水可删。不要把精准提纯写成逐句搬运。
13. 剧情必须让观众看得懂前因后果：人物为什么这样做、信息从哪里来、关系为什么变化、冲突造成什么后果，不能断裂断层。
14. 每个强情绪点应有明确剧情动作支撑：谁被误解、谁付出代价、谁做出选择、谁掌握信息差、谁的关系发生变化、谁在爆点后承受结果，不能只堆刺激台词。
15. 每次转场、跳时、关系转向、误会升级、真相揭露、反击或冲突结果落地，都要能串起"上一状态 -> 角色动作 -> 原因 -> 新状态"。

只输出 JSON，不要 Markdown，不要解释。
JSON 格式：
{
  "ok": true,
  "summary": "一句话评价",
  "weaknesses": [
    {
      "location": "第X场/开头/中段/结尾",
      "issue": "质量问题",
      "fix": "不改原文事实前提下的修复目标"
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `请审稿这段剧本的短剧质量。

【改编强度】
${adaptationStrength}

【本段原文】
${source}

【已生成剧本】
${script}`,
    },
  ], { temperature: 0.1, maxTokens: 6000, allowTruncated: true, signal });
  return normalizeScriptDramaReview(raw);
}

async function repairScriptDramaQuality(cfg, baseMessages, scriptText, review, adaptationStrength, signal) {
  const findings = normalizeScriptDramaFindings(review);
  if (!findings.length) return scriptText;
  const raw = await chatComplete(cfg, [
    ...baseMessages,
    { role: 'assistant', content: scriptText },
    {
      role: 'user',
      content: `质量审稿发现上面这段剧本短剧感不足。请在不改变原文事实、不新增主线事件、不破坏覆盖完整性的前提下，重写这一整段剧本，让它更像竖屏短剧。

【改编强度】
${adaptationStrength}

【需要修复的质量问题】
${JSON.stringify(findings, null, 2)}

重写要求：
- 输出完整修订后的本段剧本，不要输出分析、说明、JSON 或 Markdown。
- 保留原文已有事实、人物关系、因果、关键对白/OS、动作和结尾位置。
- 优先修清前因后果，再强化开头钩子、场次存在理由、情绪升级、可视化动作、对白张力和结尾追看动力。
- 修复时先补清动机、因果和关系变化，再强化情绪钩子；不要只堆刺激台词或把精准提纯写成删戏。
- 按A/B/C/D分级处理原文：A类必须补齐，B/D类压缩合并，C类注水可删；不要为了覆盖而逐句搬运。
- 场次内部尽量形成"入口问题 -> 角色动作 -> 阻碍/冲突 -> 结果/新问题"；过渡、余波和情绪沉淀可以存在，但必须帮助观众理解前因后果、人物状态或下一步行动。
- 修复所有转场、跳时、关系转向、误会升级、真相揭露和冲突结果的因果桥，让观众能看懂"上一状态 -> 角色动作 -> 原因 -> 新状态"。
- 明确本段主要情绪走向，并让爆点具备铺垫、加压、爆发和余味。
- 若冷开场题材玩法不匹配，改为贴合本书题材和原文核心卖点的钩子。
- 若心声、屏幕大字、系统提示或黑幕字幕混用，按标签功能重写；不要用长篇旁白替代可视化表达。
- 不要添加原文没有的新主线事件、新人物关系、新结局。
- 不要输出【本集完】或【本集完 - 留悬念】，结束标记由系统统一追加。`,
    },
  ], {
    temperature: 0.45,
    maxTokens: generationMaxTokens({ text: cfg }, 48000),
    allowTruncated: true,
    signal,
  });
  const repaired = stripEpisodeEndMarkers(raw).trim();
  return repaired || scriptText;
}

async function reviewAndRepairScriptDramaQuality(cfg, baseMessages, sourceText, scriptText, {
  enabled = true,
  adaptationStrength = '强化改编',
  onProgress = () => {},
  signal,
} = {}) {
  if (!enabled) return { text: scriptText, reviewed: false, repaired: false, findings: [] };
  let review;
  try {
    onProgress({ status: 'reviewing' });
    review = await reviewScriptDramaQuality(cfg, sourceText, scriptText, adaptationStrength, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    onProgress({ status: 'review_failed', message: e?.message || '短剧质量审稿失败，保留当前剧本' });
    return { text: scriptText, reviewed: false, repaired: false, findings: [] };
  }
  if (review.ok || !review.findings.length) {
    onProgress({ status: 'review_done', findings: 0 });
    return { text: scriptText, reviewed: true, repaired: false, findings: [] };
  }
  try {
    onProgress({ status: 'repairing', findings: review.findings.length });
    const repaired = await repairScriptDramaQuality(cfg, baseMessages, scriptText, review, adaptationStrength, signal);
    onProgress({ status: 'repair_done', findings: review.findings.length });
    return { text: repaired, reviewed: true, repaired: repaired !== scriptText, findings: review.findings };
  } catch (e) {
    if (signal?.aborted) throw e;
    onProgress({ status: 'repair_failed', findings: review.findings.length, message: e?.message || '短剧质量修复失败，保留当前剧本' });
    return { text: scriptText, reviewed: true, repaired: false, findings: review.findings };
  }
}

function normalizeEpisodeContinuityState(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const compactList = (value, limit = 24) => (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
  return {
    timeLocation: String(source.timeLocation || '').trim(),
    characters: (Array.isArray(source.characters) ? source.characters : []).slice(0, 24).map((item) => ({
      name: String(item?.name || '').trim(),
      status: String(item?.status || '').trim(),
      goal: String(item?.goal || '').trim(),
      location: String(item?.location || '').trim(),
      knownFacts: compactList(item?.knownFacts, 16),
    })).filter((item) => item.name),
    relationships: (Array.isArray(source.relationships) ? source.relationships : []).slice(0, 24).map((item) => ({
      pair: String(item?.pair || '').trim(),
      status: String(item?.status || '').trim(),
      change: String(item?.change || '').trim(),
    })).filter((item) => item.pair),
    props: (Array.isArray(source.props) ? source.props : []).slice(0, 24).map((item) => ({
      name: String(item?.name || '').trim(),
      holder: String(item?.holder || '').trim(),
      state: String(item?.state || '').trim(),
    })).filter((item) => item.name),
    revealedFacts: compactList(source.revealedFacts, 24),
    unresolvedThreads: compactList(source.unresolvedThreads, 24),
  };
}

function hasEpisodeContinuityState(state = {}) {
  return Boolean(
    String(state?.timeLocation || '').trim()
    || (Array.isArray(state?.characters) && state.characters.length)
    || (Array.isArray(state?.relationships) && state.relationships.length)
    || (Array.isArray(state?.props) && state.props.length)
    || (Array.isArray(state?.revealedFacts) && state.revealedFacts.length)
    || (Array.isArray(state?.unresolvedThreads) && state.unresolvedThreads.length)
  );
}

function normalizeWholeEpisodeReview(raw) {
  const parsed = extractJsonObject(raw);
  const issues = (Array.isArray(parsed?.issues) ? parsed.issues : [])
    .map((item) => ({
      type: String(item?.type || '整集质量').trim(),
      location: String(item?.location || '').trim(),
      issue: String(item?.issue || item?.problem || '').trim(),
      fix: String(item?.fix || item?.suggestion || '').trim(),
    }))
    .filter((item) => item.issue || item.fix)
    .slice(0, 10);
  return {
    ok: parsed?.ok === true && issues.length === 0,
    summary: String(parsed?.summary || '').trim(),
    issues,
    stateAfter: normalizeEpisodeContinuityState(parsed?.stateAfter),
  };
}

async function reviewWholeEpisodeQuality(cfg, payload, signal) {
  const messages = generateWholeEpisodeReviewPrompt(payload);
  const raw = await chatComplete(cfg, messages, {
    temperature: 0.08,
    maxTokens: 9000,
    allowTruncated: true,
    signal,
  });
  return normalizeWholeEpisodeReview(raw);
}

async function repairWholeEpisodeQuality(cfg, payload, issues, signal) {
  const messages = generateWholeEpisodeRepairPrompt({ ...payload, issues });
  const raw = await chatComplete(cfg, messages, {
    temperature: 0.32,
    maxTokens: generationMaxTokens({ text: cfg }, 48000),
    allowTruncated: true,
    signal,
  });
  return stripEpisodeEndMarkers(raw).trim() || String(payload.scriptText || '').trim();
}

async function reviewAndRepairWholeEpisodeQuality(cfg, payload, {
  enabled = true,
  onProgress = () => {},
  signal,
} = {}) {
  const original = String(payload.scriptText || '').trim();
  const priorState = normalizeEpisodeContinuityState(payload.priorState);
  if (!enabled || !original) {
    return { text: original, reviewed: false, repaired: false, issues: [], summary: '', stateAfter: priorState };
  }
  let review;
  try {
    onProgress({ status: 'reviewing' });
    review = await reviewWholeEpisodeQuality(cfg, payload, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    onProgress({ status: 'review_failed', message: error?.message || '完整单集终审失败，保留当前剧本' });
    return { text: original, reviewed: false, repaired: false, issues: [], summary: '', stateAfter: priorState };
  }
  let text = original;
  let repaired = false;
  if (!review.ok && review.issues.length) {
    try {
      onProgress({ status: 'repairing', findings: review.issues.length });
      text = await repairWholeEpisodeQuality(cfg, { ...payload, scriptText: text }, review.issues, signal);
      repaired = text !== original;
      onProgress({ status: 'repair_done', findings: review.issues.length });
    } catch (error) {
      if (signal?.aborted) throw error;
      onProgress({ status: 'repair_failed', findings: review.issues.length, message: error?.message || '完整单集修复失败，保留当前剧本' });
      text = original;
      repaired = false;
    }
  }

  if (repaired) {
    try {
      onProgress({ status: 'rechecking' });
      review = await reviewWholeEpisodeQuality(cfg, { ...payload, scriptText: text }, signal);
      onProgress({ status: 'review_done', findings: review.issues.length });
    } catch (error) {
      if (signal?.aborted) throw error;
      onProgress({ status: 'recheck_failed', message: error?.message || '终审复核失败，使用已修订剧本' });
    }
  } else {
    onProgress({ status: 'review_done', findings: review.issues.length });
  }

  return {
    text,
    reviewed: true,
    repaired,
    issues: review.issues,
    summary: review.summary,
    stateAfter: hasEpisodeContinuityState(review.stateAfter) ? review.stateAfter : priorState,
  };
}

function extractLastStoryboardAnchor(text) {
  const source = String(text || '');
  const baselineMatches = source.match(/【定格基准】[^\n]*/g);
  if (baselineMatches && baselineMatches.length) {
    return baselineMatches[baselineMatches.length - 1].trim();
  }
  // 兼容历史分镜模板：每段结尾可能输出【本段结尾状态台账】整块，优先整块带走作为接帧参考。
  const ledgerMatches = [...source.matchAll(/【本段结尾状态台账】[\s\S]*?(?=\n\s*【(?!本段结尾状态台账)|\n\s*(?:分镜|生成段落)\s*\d+\s*[：:]|$)/g)];
  if (ledgerMatches.length) {
    return ledgerMatches[ledgerMatches.length - 1][0].trim();
  }
  // 历史模板若只剩"下一段起幅必须显式写入"这句整理句，也足以作为接帧参考。
  const nextStartMatches = source.match(/下一段起幅必须显式写入\s*[：:]\s*[^\n]+/g);
  if (nextStartMatches && nextStartMatches.length) {
    return nextStartMatches[nextStartMatches.length - 1].trim();
  }
  // 旧模板：定格画面 / 结尾帧锚定
  const matches = source.match(/【(?:定格画面|结尾帧锚定)】[^\n]*/g);
  return matches && matches.length ? matches[matches.length - 1].trim() : '';
}

function segmentedRequirement(baseRequirement, { kind, index, total, isLast, previousTail }) {
  const base = String(baseRequirement || '').trim();
  const label = kind === 'script' ? '剧本' : '分镜';
  const lines = [
    base,
    `【自动分段生成控制】这是${label}生成的第 ${index + 1}/${total} 段。只处理本段输入内容，不要提前写后续段内容。`,
    `必须承接上一分段的场景、人物状态和未完动作；开头不要重写片头、人物介绍或总标题，直接从本段剧情继续。`,
    isLast
      ? `这是最后一段，收束到本集/本段结尾。`
      : `这不是最后一段，停在本段最后一个自然动作或信息点即可，不要总结全篇，不要输出最终结束说明。`,
    previousTail ? `【上一分段结尾参考】${previousTail}` : '',
  ].filter(Boolean);
  return lines.join('\n\n');
}

function buildCustomGenerationRequirement(requirement = '', customPrompt = '', kind = 'script') {
  const normal = String(requirement || '').trim();
  const custom = String(customPrompt || '').trim();
  const lines = [];
  if (normal) lines.push(normal);
  if (custom) {
    const label = kind === 'storyboard' ? '分镜' : '剧本';
    lines.push(`【用户自定义${label}提示词｜最高优先级】\n${custom}\n\n系统仍需负责规范化输出、补齐必要结构、校验编号与格式；在不破坏输出格式和安全合规的前提下，必须严格按照用户自定义提示词执行。`);
  }
  return lines.join('\n\n');
}

function selectedCustomPromptContent(settings = {}, kind = 'script', promptLibrary = {}) {
  const isScript = kind === 'script';
  const selectedId = String(isScript ? settings.selectedScriptPromptId || '' : settings.selectedStoryboardPromptId || '').trim();
  if (!selectedId) return '';
  const globalList = isScript ? promptLibrary.scriptPrompts : promptLibrary.storyboardPrompts;
  const legacyList = isScript ? settings.customScriptPrompts : settings.customStoryboardPrompts;
  for (const list of [globalList, legacyList]) {
    if (!Array.isArray(list)) continue;
    const selected = list.find((item) => String(item?.id || '').trim() === selectedId);
    const content = String(selected?.content || '').trim();
    if (content) return content;
  }
  return '';
}

function buildStoryboardGenerationMessages({
  useCustomPrompt = false,
  scriptContent = '',
  episodeNumber = '',
  episodeTitle = '',
  requirement = '',
  customPrompt = '',
  elementNames = null,
  prevTailFrame = '',
  characterVariants = null,
  shotHeader = '无字幕无BGM',
  templateId = 'p',
  useQVersion = true,
  maxDuration = 15,
} = {}) {
  if (useCustomPrompt) {
    return generateCustomStoryboardPrompt({
      scriptContent,
      episodeNumber,
      episodeTitle,
      customPrompt,
      requirement,
      elementNames,
      characterVariants,
      prevTailFrame,
      maxDuration,
    });
  }
  return generateStoryboardPrompt(
    scriptContent,
    episodeNumber,
    episodeTitle,
    requirement,
    elementNames,
    prevTailFrame,
    characterVariants,
    shotHeader,
    templateId,
    useQVersion,
    maxDuration,
  );
}

function generationMaxTokens(cfg, fallback = 48000) {
  const n = Number(cfg?.text?.maxTokens);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(8000, Math.min(Math.floor(n), fallback));
}

function isRetryableGenerationError(error) {
  if (error?.retryable) return true;
  // 被 max_tokens 截断是确定性失败，重发同一 prompt 只会再截断一次。
  if (error?.truncated) return false;
  const status = Number(error?.status);
  if ([408, 409, 425, 429].includes(status)) return true;
  if (status >= 500) return true;
  const msg = String(error?.message || '');
  return /timeout|timed out|aborted|abort|ECONNRESET|ETIMEDOUT|EPIPE|network|fetch failed|terminated|\u8d85\u65f6|\u7f51\u7edc|\u53d6\u6d88/i.test(msg);
}

function waitForRetry(ms, signal) {
  if (signal?.aborted) {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const error = new Error('请求已取消');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function streamTextWithRetry(cfg, messages, options = {}) {
  const {
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = generationMaxTokens({ text: cfg }),
    attempts = 2,
    timeoutMs = 180000,
    idleTimeoutMs,
    onRetry = () => {},
    validateText = null,
    retryInstruction = null,
    signal,
  } = options;
  let lastError;
  let retryFeedback = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    let text = '';
    try {
      const requestMessages = retryFeedback
        ? [...messages, { role: 'user', content: retryFeedback }]
        : messages;
      await chatCompleteStream(cfg, requestMessages, {
        temperature,
        maxTokens,
        signal,
        timeoutMs,
        ...(Number.isFinite(Number(idleTimeoutMs)) ? { idleTimeoutMs: Number(idleTimeoutMs) } : {}),
        // 这里已有 attempts 层重试，底层不再叠一层，否则失败一次要等两轮退避。
        retryCount: 0,
        onDelta: (t) => { text += t; },
      });
      if (typeof validateText === 'function') {
        const validation = validateText(text);
        if (validation === false || typeof validation === 'string') {
          const err = new Error(typeof validation === 'string' ? validation : '生成内容未通过完整性校验');
          err.retryable = true;
          err.validationFailed = true;
          throw err;
        }
      }
      return text;
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
      // Do not replay a request after the provider has already emitted part
      // of the answer. Replaying partial streams is the main source of the
      // "keeps retrying" experience and wastes another full generation.
      if (text.trim() && !e?.truncated) {
        e.partialOutput = true;
        e.partial = text;
        throw e;
      }
      if (e?.validationFailed) {
        retryFeedback = typeof retryInstruction === 'function'
          ? String(retryInstruction(e, { attempt, attempts }) || '')
          : `上一版未通过完整性校验：${e.message}。请从头完整重写，不要解释。`;
      }
      if (attempt >= attempts || !isRetryableGenerationError(e)) throw e;
      onRetry({ attempt, attempts, error: e });
      await waitForRetry(800 * attempt, signal);
    }
  }
  throw lastError || new Error('生成失败');
}


function splitAnchorCandidates(value, side = 'start') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const sources = [raw, raw.replace(/\s+/g, '')].filter(Boolean);
  const lengths = [32, 24, 16, 12, 8, 6, 4];
  const out = [];
  for (const source of sources) {
    for (const len of lengths) {
      const part = source.length <= len
        ? source
        : side === 'end'
          ? source.slice(-len)
          : source.slice(0, len);
      if (part.length >= 4 && !out.includes(part)) out.push(part);
    }
  }
  return out;
}

function locateSplitAnchor(fullText, value, from = 0, side = 'start') {
  const start = Math.max(0, Math.min(fullText.length, from));
  for (const needle of splitAnchorCandidates(value, side)) {
    const idx = fullText.indexOf(needle, start);
    if (idx >= 0) return side === 'end' ? idx + needle.length : idx;
  }
  return -1;
}

function snapSplitBoundary(text, offset, minOffset = 0) {
  const raw = Math.max(0, Math.min(text.length, Number(offset) || 0));
  const snapped = snapToParagraph(text, raw);
  // 很多导入原文没有空行段落。若吸附会跳到全文首尾，就保留模型锚点的真实位置。
  if ((snapped <= minOffset && raw > minOffset) || (snapped >= text.length && raw < text.length)) {
    return raw;
  }
  return Math.max(minOffset, Math.min(text.length, snapped));
}

function locateFutureEpisodeStart(fullText, episodes, fromIndex, minOffset) {
  for (let i = fromIndex + 1; i < episodes.length; i++) {
    const windowStart = Number.isFinite(episodes[i]?.__windowStart) ? episodes[i].__windowStart : minOffset;
    const idx = locateSplitAnchor(fullText, episodes[i]?.startText, Math.max(0, windowStart - 80, minOffset - 50), 'start');
    if (idx > minOffset && idx < fullText.length) {
      const snapped = snapSplitBoundary(fullText, idx, minOffset);
      return snapped > minOffset ? snapped : idx;
    }
  }
  return -1;
}

// /api/script/source 的集/分镜提交应用：同时支持整包（episodes/storyboards 数组）
// 与增量（episodeIds/changedEpisodes + storyboardEpisodeIds/changedStoryboards）。
// 增量模式下 id 名单描述客户端认知的完整结构（存在性+顺序），未提交的条目
// 保留服务端现状；partial 响应只回传客户端需要对账的分镜（提交的、冲突的、
// 服务端新增的），省掉整包 script 每拍往返的序列化/解析成本。
function applyScriptContentPatch(projectId, script, body, persistedEpisodeIds) {
  if (Array.isArray(body.episodes)) {
    script.episodes = body.episodes;
  } else if (Array.isArray(body.episodeIds)) {
    const changedById = new Map((Array.isArray(body.changedEpisodes) ? body.changedEpisodes : [])
      .filter((episode) => episode && episode.id != null)
      .map((episode) => [String(episode.id), episode]));
    const existingById = new Map(script.episodes.map((episode) => [String(episode?.id), episode]));
    script.episodes = body.episodeIds
      .map((id) => changedById.get(String(id)) || existingById.get(String(id)))
      .filter(Boolean);
  }

  let partial = false;
  let incomingStoryboards = null;
  let clientKnownEpisodeIds = null;
  if (Array.isArray(body.storyboards)) {
    incomingStoryboards = body.storyboards;
  } else if (Array.isArray(body.storyboardEpisodeIds)) {
    partial = true;
    incomingStoryboards = Array.isArray(body.changedStoryboards) ? body.changedStoryboards : [];
    clientKnownEpisodeIds = new Set(body.storyboardEpisodeIds.map((id) => String(id)));
  }
  let storyboardConflicts = [];
  if (incomingStoryboards) {
    const allowedEpisodeIds = new Set([
      ...persistedEpisodeIds,
      ...script.episodes.map((episode) => String(episode?.id)),
    ]);
    const merged = mergeStoryboardUpdates(projectId, script.storyboards, incomingStoryboards, { allowedEpisodeIds, clientKnownEpisodeIds });
    script.storyboards = merged.storyboards;
    storyboardConflicts = merged.conflicts;
  }

  let responseStoryboards = null;
  if (partial) {
    const incomingKeys = new Set(incomingStoryboards.map((storyboard) => String(storyboard?.episodeId)));
    const conflictKeys = new Set(storyboardConflicts.map((key) => String(key)));
    responseStoryboards = script.storyboards.filter((storyboard) => {
      const key = String(storyboard?.episodeId);
      return incomingKeys.has(key) || conflictKeys.has(key) || !clientKnownEpisodeIds.has(key);
    });
  }
  return { storyboardConflicts, partial, responseStoryboards };
}

export {
  extractJsonObject,
  clampGenerationChunkSize,
  splitLongBlock,
  splitTextForGeneration,
  splitTextWindows,
  cleanImportedChapterTitle,
  splitWholeNovelIntoChapters,
  tailSnippet,
  compactReferenceText,
  wholeNovelBibleText,
  wholeNovelBibleBlock,
  wholeNovelEpisodePlanText,
  wholeNovelEpisodePlanBlock,
  wholeNovelEpisodeContextBlock,
  sortedChapters,
  episodeReferencesChapter,
  invalidateWholeNovelPlanning,
  wholeNovelSourceForReading,
  generateValidatedSeriesPlan,
  generateValidatedEpisodeBatch,
  episodeBatchTailSummary,
  validateChapterSplitAnchorPlan,
  splitChapterIntoEpisodesWithContext,
  episodeSourceText,
  stripEpisodeEndMarkers,
  renumberScriptScenes,
  normalizeScriptCoverageFindings,
  normalizeScriptCoverageReview,
  reviewScriptCoverage,
  repairScriptCoverage,
  reviewAndRepairScriptSegment,
  normalizeScriptDramaFindings,
  normalizeScriptDramaReview,
  reviewScriptDramaQuality,
  repairScriptDramaQuality,
  reviewAndRepairScriptDramaQuality,
  normalizeEpisodeContinuityState,
  hasEpisodeContinuityState,
  normalizeWholeEpisodeReview,
  reviewWholeEpisodeQuality,
  repairWholeEpisodeQuality,
  reviewAndRepairWholeEpisodeQuality,
  extractLastStoryboardAnchor,
  segmentedRequirement,
  buildCustomGenerationRequirement,
  selectedCustomPromptContent,
  buildStoryboardGenerationMessages,
  generationMaxTokens,
  isRetryableGenerationError,
  waitForRetry,
  streamTextWithRetry,
  splitAnchorCandidates,
  locateSplitAnchor,
  snapSplitBoundary,
  locateFutureEpisodeStart,
  applyScriptContentPatch,
};
