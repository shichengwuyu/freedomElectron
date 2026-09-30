// 剧本和分镜路由模块
import fs from 'fs';
import path from 'path';
import { loadConfig, TEMP_DIR } from '../config.js';
import { hasTextModelKey, resolveTextModelConfig } from '../modelRouting.js';
import { loadProject, saveProject, saveProjectSplit, normalizeProjectScript, snapToParagraph, MAIN_CATEGORIES } from '../storage.js';
import { chatComplete, chatCompleteStream } from '../apiClient.js';
import { createSseSession, sseSend } from '../lib/sse.js';
import { saveRequestBodyToFile } from '../http.js';
import { buildReversePromptMessages, normalizeReverseResponse, normalizeReverseMode, planFrameCount } from '../promptReverse.js';
import { buildComposeShotMessages, parseComposeResponse } from '../shotCompose.js';
import { probeVideo, extractFrames, normalizeImageFile, videoFileToDataUrl, cleanupFrames, FRAME_LIMITS } from '../videoFrames.js';
import {
  ADAPTATION_STRENGTH_LABELS,
  generateCustomEpisodeScriptPrompt,
  generateEpisodeScriptPrompt,
  generateChapterSplitPrompt,
  generateWholeNovelBiblePrompt,
  generateWholeNovelDigestPrompt,
  generateWholeNovelSeriesPlanPrompt,
  generateArcEpisodeBatchPrompt,
  generateWholeEpisodeReviewPrompt,
  generateWholeEpisodeRepairPrompt,
  generateWholeNovelStageBiblePrompt,
  normalizeAdaptationStrength,
  coldOpenStoryboardGuide,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
} from '../scriptPrompts.js';
import {
  parseStoryboardShotsForRecovery,
} from '../shotVideoUtils.js';
import { clearPendingByProject } from '../pendingVideos.js';
import { deleteEpisodeMediaFiles } from '../videoFunctions.js';
import { invalidateEpisodeOutputs, invalidateEpisodesOutputs } from '../services/scriptOutputInvalidation.js';
import { extractJsonObject as extractJsonObjectShared } from '../jsonParse.js';
import {
  beatsForArc,
  findArcForChapter,
  buildBeatPlanningBatches,
  buildSourceBeatIndex,
  materializeEpisodesFromBeatPlan,
  normalizeEpisodeBatchPlan,
  normalizeSeriesPlan,
  normalizeWholeNovelPlanningCheckpoint,
  normalizeWholeNovelPlanningOptions,
  reconcileWholeNovelPlanningBatches,
  serializeSourceBeatIndex,
  sourceBeatCatalogText,
  validateEpisodeBatchPlan,
  validateSeriesPlan,
  wholeNovelPlanningCheckpointMatches,
  wholeNovelPlanningSourceSignature,
} from '../services/scriptAdaptationPlanning.js';
import {
  buildStoryboardCoverageGuard as storyboardCoverageGuard,
  recommendedStoryboardChunkSize,
  renumberStoryboardShots,
} from '../services/storyboardCoverageService.js';
import {
  stampGeneratedStoryboard,
} from '../services/storyboardRevisionService.js';
import { regenerateShotTextWithModel } from '../shotTextRegeneration.js';

import {
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
  nextAvailableEpisodeId,
} from './scriptRouteSupport.js';

// 长文本生成的超时口径：总时长给足，卡死判定交给 idle（流式下 2 分钟没有任何新增内容才算挂）。
// 之前总超时 4 分钟，模型正常写长段落也会被掐断，错误信息含 timeout 又被判定可重试，
// 于是同一段反复重发、看起来像"一直重试"。
const GENERATION_TOTAL_TIMEOUT_MS = 30 * 60 * 1000;
const GENERATION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const activeStoryboardGenerations = new Map();

// 导出主路由处理函数
export async function handleScriptRoutes(ctx) {
  const { req, res, url, p, method, readBody, sendJson } = ctx;

  if (p === '/api/script/chapter' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;
  const action = body.action || 'add';
  if (action === 'add') {
    invalidateWholeNovelPlanning(s);
    const id = s.nextChapterId++;
    const order = (s.chapters.reduce((m, c) => Math.max(m, c.order || 0), 0) || 0) + 1;
    const ch = {
      id,
      title: (body.title || `第${order}章`).trim(),
      sourceText: body.sourceText || '',
      order,
      createdAt: new Date().toISOString(),
    };
    s.chapters.push(ch);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return sendJson(res, 200, { ok: true, chapter: ch });
  }
  if (action === 'update') {
    const ch = s.chapters.find((c) => c.id === Number(body.chapterId));
    if (!ch) return sendJson(res, 404, { error: '章节不存在' });
    invalidateWholeNovelPlanning(s);
    const sourceChanged = typeof body.sourceText === 'string' && body.sourceText !== ch.sourceText;
    const affectedEpisodeIds = sourceChanged
      ? s.episodes.filter((episode) => episodeReferencesChapter(episode, ch.id)).map((episode) => episode.id)
      : [];
    if (sourceChanged) invalidateEpisodesOutputs(proj, affectedEpisodeIds, { clearScript: true });
    if (typeof body.title === 'string') ch.title = body.title.trim() || ch.title;
    if (typeof body.sourceText === 'string') ch.sourceText = body.sourceText;
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return sendJson(res, 200, {
      ok: true,
      chapter: ch,
      sourceChanged,
      invalidatedEpisodeIds: affectedEpisodeIds,
    });
  }
  if (action === 'delete') {
    invalidateWholeNovelPlanning(s);
    const cid = Number(body.chapterId);
    const removedEpIds = s.episodes.filter((episode) => episodeReferencesChapter(episode, cid)).map((episode) => episode.id);
    invalidateEpisodesOutputs(proj, removedEpIds);
    s.chapters = s.chapters.filter((c) => c.id !== cid);
    // 同时删掉该章节下的集与其分镜
    s.episodes = s.episodes.filter((episode) => !episodeReferencesChapter(episode, cid));
    s.storyboards = s.storyboards.filter((sb) => !removedEpIds.some((id) => String(id) === String(sb.episodeId)));
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return sendJson(res, 200, { ok: true, removedEpisodeIds: removedEpIds });
  }
  return sendJson(res, 400, { error: '未知的章节操作' });
}

// ---- 整本小说 TXT 一键导入：自动按章节标题拆章；无标题时按长文本窗口兜底拆章 ----
  if (p === '/api/script/novel/import' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const text = String(body.text || '').trim();
  if (!text) return sendJson(res, 400, { error: '请提供整本小说 TXT 文本' });
  const s = proj.script;
  const mode = body.mode === 'replace' ? 'replace' : 'append';
  const replacedEpisodeIds = mode === 'replace' ? s.episodes.map((episode) => episode.id) : [];
  invalidateWholeNovelPlanning(s);
  const { chapters: imported, method } = splitWholeNovelIntoChapters(text, {
    fallbackSize: Number(body.fallbackSize) || 60000,
  });
  if (!imported.length) return sendJson(res, 400, { error: '未能从 TXT 中拆出有效章节' });

  if (mode === 'replace') {
    invalidateEpisodesOutputs(proj, replacedEpisodeIds);
    s.chapters = [];
    s.episodes = [];
    s.storyboards = [];
    s.extractedSigs = {};
    s.nextChapterId = 1;
    s.nextEpisodeId = 1;
  }

  const startOrder = s.chapters.reduce((max, chapter) => Math.max(max, Number(chapter.order) || 0), 0) + 1;
  let nextChapterId = Math.max(
    s.nextChapterId || 1,
    s.chapters.reduce((max, chapter) => Math.max(max, chapter.id || 0), 0) + 1
  );
  const created = imported.map((chapter, index) => ({
    id: nextChapterId++,
    title: cleanImportedChapterTitle(chapter.title, `第${index + 1}章`),
    sourceText: String(chapter.sourceText || '').trim(),
    order: startOrder + index,
    createdAt: new Date().toISOString(),
  })).filter((chapter) => chapter.sourceText);

  if (!created.length) return sendJson(res, 400, { error: 'TXT 内容为空，未导入章节' });
  s.chapters.push(...created);
  s.nextChapterId = nextChapterId;
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  return sendJson(res, 200, {
    ok: true,
    chapters: created,
    count: created.length,
    method,
    totalChars: created.reduce((sum, chapter) => sum + (chapter.sourceText || '').length, 0),
    message: method === 'heading'
      ? `已按章节标题导入 ${created.length} 章`
      : `未识别到章节标题，已按长度自动切成 ${created.length} 章`,
  });
}

// ---- 整本改编规划：全书预读 → 故事圣经 → 带全局理解统一拆集（SSE）----
  if (p === '/api/script/novel/adapt-plan/stream' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'adaptation')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  cfg.text = resolveTextModelConfig(cfg, 'adaptation', { projectId: proj.id, operation: 'whole-novel-plan' });
  const s = proj.script;
  const chapters = sortedChapters(s).filter((chapter) => String(chapter.sourceText || '').trim());
  if (!chapters.length) return sendJson(res, 400, { error: '请先导入整本小说 TXT 或添加章节原文' });

  const planningOptions = normalizeWholeNovelPlanningOptions(body);
  const sourceSignature = wholeNovelPlanningSourceSignature(chapters);
  const checkpointMatches = wholeNovelPlanningCheckpointMatches(
    s.wholeNovelPlanningCheckpoint,
    sourceSignature,
    planningOptions,
  );
  let checkpoint = normalizeWholeNovelPlanningCheckpoint(
    s.wholeNovelPlanningCheckpoint,
    sourceSignature,
    planningOptions,
    { forceRestart: body.forceRestart === true },
  );
  const resumed = checkpointMatches && body.forceRestart !== true;
  if (!resumed) {
    s.wholeNovelBible = null;
    s.wholeNovelBibleUpdatedAt = '';
    s.wholeNovelStageBibles = [];
    s.wholeNovelSourceBeatIndex = [];
    s.wholeNovelEpisodePlan = null;
  }

  const session = createSseSession(req, res);
  const persistCheckpoint = ({ phase = checkpoint.phase, status = 'running', message = '', final = false } = {}) => {
    checkpoint.phase = phase;
    checkpoint.status = status;
    checkpoint.lastError = status === 'failed' ? String(message || checkpoint.lastError || '') : '';
    checkpoint.updatedAt = new Date().toISOString();
    s.wholeNovelPlanningCheckpoint = checkpoint;
    s.wholeNovelStageBibles = checkpoint.stageBibles.slice();
    if (checkpoint.wholeNovelBible) {
      s.wholeNovelBible = checkpoint.wholeNovelBible;
      s.wholeNovelBibleUpdatedAt = checkpoint.updatedAt;
    }
    const latest = loadProject(proj.id);
    if (!latest) throw new Error('项目在整本规划期间已被删除');
    normalizeProjectScript(latest);
    const latestChapters = sortedChapters(latest.script)
      .filter((chapter) => String(chapter.sourceText || '').trim());
    if (wholeNovelPlanningSourceSignature(latestChapters) !== sourceSignature) {
      throw new Error('原文章节在整本规划期间发生了变化，本次任务已停止；重新点击将按新原文规划');
    }
    const target = latest.script;
    target.wholeNovelPlanningCheckpoint = checkpoint;
    target.wholeNovelStageBibles = s.wholeNovelStageBibles;
    target.wholeNovelBible = s.wholeNovelBible;
    target.wholeNovelBibleUpdatedAt = s.wholeNovelBibleUpdatedAt;
    target.wholeNovelSourceBeatIndex = s.wholeNovelSourceBeatIndex;
    target.wholeNovelEpisodePlan = s.wholeNovelEpisodePlan;
    target.wholeNovelAdapted = s.wholeNovelAdapted;
    target.wholeNovelPlanningStale = s.wholeNovelPlanningStale;
    if (final) {
      target.episodes = s.episodes;
      target.storyboards = s.storyboards;
      target.nextEpisodeId = s.nextEpisodeId;
    }
    latest.updatedAt = checkpoint.updatedAt;
    if (final) saveProject(latest);
    else saveProjectSplit(latest);
  };
  const donePayload = ({ fromCheckpoint = false } = {}) => ({
    ok: true,
    resumed: fromCheckpoint,
    chapters,
    episodes: s.episodes,
    storyboards: s.storyboards,
    wholeNovelBible: s.wholeNovelBible,
    wholeNovelStageBibles: s.wholeNovelStageBibles,
    wholeNovelEpisodePlan: s.wholeNovelEpisodePlan,
    wholeNovelAdapted: s.wholeNovelAdapted === true,
    wholeNovelPlanningStale: s.wholeNovelPlanningStale === true,
    message: fromCheckpoint
      ? `已恢复整本规划，共 ${s.episodes.length} 集`
      : `整本改编规划完成，共 ${s.episodes.length} 集`,
  });
  const parsePlanningJson = (raw, label) => {
    try {
      return extractJsonObject(raw);
    } catch {
      throw new Error(`${label}未返回有效 JSON，已保存之前的进度`);
    }
  };
  const requestPlanningJson = async (messages, {
    label,
    phase,
    temperature = 0.25,
    maxTokens,
  } = {}) => {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const requestMessages = attempt === 0
          ? messages
          : messages.map((message, index) => (
              index === messages.length - 1
                ? {
                    ...message,
                    content: `${message.content}\n\n上一次返回未形成完整 JSON。请压缩次要描述，确保这次只输出完整、可解析且闭合的 JSON。`,
                  }
                : message
            ));
        const raw = await chatComplete(cfg.text, requestMessages, {
          temperature: attempt === 0 ? temperature : Math.min(temperature, 0.1),
          maxTokens,
          allowTruncated: false,
          signal: session.signal,
        });
        return parsePlanningJson(raw, label);
      } catch (error) {
        if (session.signal.aborted || error?.name === 'AbortError') throw error;
        lastError = error;
        if (attempt === 0) {
          sseSend(res, 'progress', {
            phase: phase || 'novel_retry',
            status: 'retry',
            attempt: 2,
            attempts: 2,
            text: `${label}返回异常，正在自动重试`,
            message: error?.message || '',
          });
        }
      }
    }
    throw lastError || new Error(`${label}生成失败`);
  };
  try {
    if (
      resumed
      && checkpoint.status === 'complete'
      && s.wholeNovelAdapted === true
      && s.wholeNovelEpisodePlan
      && s.episodes.length
    ) {
      sseSend(res, 'progress', {
        phase: 'novel_resume',
        status: 'done',
        resumed: true,
        text: `检测到已完成的整本规划，直接继续生成 ${s.episodes.length} 集剧本`,
      });
      sseSend(res, 'done', donePayload({ fromCheckpoint: true }));
      return true;
    }

    checkpoint.status = 'running';
    checkpoint.lastError = '';
    s.wholeNovelAdapted = false;
    s.wholeNovelPlanningStale = true;
    persistCheckpoint({ phase: checkpoint.phase || 'novel_digest' });
    if (resumed && (
      checkpoint.digests.length
      || checkpoint.stageBibles.length
      || checkpoint.wholeNovelBible
      || checkpoint.completedPlanBatches.length
    )) {
      sseSend(res, 'progress', {
        phase: 'novel_resume',
        status: 'done',
        resumed: true,
        text: '已载入上次整本规划断点，继续未完成步骤',
      });
    }

    const fullText = wholeNovelSourceForReading(chapters);
    const readWindowSize = planningOptions.readWindowSize;
    const windows = splitTextWindows(fullText, readWindowSize);
    if (checkpoint.digests.length > windows.length) {
      checkpoint.digests = [];
      checkpoint.stageBibles = [];
      checkpoint.wholeNovelBible = null;
      checkpoint.seriesPlan = null;
      checkpoint.episodePlan = [];
      checkpoint.completedPlanBatches = [];
      persistCheckpoint({ phase: 'novel_digest' });
    }
    const digests = checkpoint.digests;
    for (let i = digests.length; i < windows.length; i++) {
      const win = windows[i];
      sseSend(res, 'progress', {
        phase: 'novel_digest',
        index: i,
        total: windows.length,
        status: 'running',
        text: `正在阅读全文 ${i + 1}/${windows.length}`,
      });
      const messages = generateWholeNovelDigestPrompt({
        sourceText: win.text,
        chunkIndex: i,
        chunkTotal: windows.length,
        rangeLabel: `整本小说字符 ${win.start}-${win.end}`,
      });
      const digest = await requestPlanningJson(messages, {
        label: `全文第 ${i + 1}/${windows.length} 块阅读结果`,
        phase: 'novel_digest',
        maxTokens: Math.min(generationMaxTokens(cfg, 48000), 10000),
      });
      digests.push(digest);
      checkpoint.digests = digests;
      persistCheckpoint({ phase: 'novel_digest' });
      sseSend(res, 'progress', {
        phase: 'novel_digest',
        index: i,
        total: windows.length,
        status: 'done',
        text: `已阅读 ${i + 1}/${windows.length}`,
      });
    }

    let stageBibles = checkpoint.stageBibles;
    const stageGroupSize = planningOptions.stageGroupSize;
    const stageTotal = Math.max(1, Math.ceil(digests.length / stageGroupSize));
    if (stageBibles.length > stageTotal) {
      stageBibles = [];
      checkpoint.stageBibles = stageBibles;
      checkpoint.wholeNovelBible = null;
      checkpoint.seriesPlan = null;
      checkpoint.episodePlan = [];
      checkpoint.completedPlanBatches = [];
    }
    for (let si = checkpoint.stageBibles.length; si < stageTotal; si++) {
      const start = si * stageGroupSize;
      const group = digests.slice(start, start + stageGroupSize);
      sseSend(res, 'progress', {
        phase: 'novel_stage_bible',
        index: si,
        total: stageTotal,
        status: 'running',
        text: `正在合并阶段圣经 ${si + 1}/${stageTotal}`,
      });
      const stageMessages = generateWholeNovelStageBiblePrompt({
        digests: group,
        stageIndex: si,
        stageTotal,
        rangeLabel: `分块 ${start + 1}-${start + group.length} / ${digests.length}`,
      });
      const stageBible = await requestPlanningJson(stageMessages, {
        label: `阶段圣经 ${si + 1}/${stageTotal}`,
        phase: 'novel_stage_bible',
        maxTokens: Math.min(generationMaxTokens(cfg, 48000), 14000),
      });
      stageBibles.push(stageBible);
      checkpoint.stageBibles = stageBibles;
      persistCheckpoint({ phase: 'novel_stage_bible' });
      sseSend(res, 'progress', {
        phase: 'novel_stage_bible',
        index: si,
        total: stageTotal,
        status: 'done',
        text: `阶段圣经 ${si + 1}/${stageTotal} 已生成`,
      });
    }
    s.wholeNovelStageBibles = stageBibles;

    if (!checkpoint.wholeNovelBible) {
      sseSend(res, 'progress', {
        phase: 'novel_bible',
        status: 'running',
        text: '正在合并全书故事圣经与人物/伏笔台账',
      });
      const bibleMessages = generateWholeNovelBiblePrompt({
        digests: stageBibles.length ? stageBibles : digests,
        chapterIndex: chapters.map((chapter) => ({
          order: chapter.order,
          title: chapter.title,
          length: String(chapter.sourceText || '').length,
        })),
      });
      checkpoint.wholeNovelBible = await requestPlanningJson(bibleMessages, {
        label: '全书故事圣经',
        phase: 'novel_bible',
        maxTokens: Math.min(generationMaxTokens(cfg, 48000), 18000),
      });
      s.wholeNovelBible = checkpoint.wholeNovelBible;
      s.wholeNovelBibleUpdatedAt = new Date().toISOString();
      persistCheckpoint({ phase: 'novel_bible' });
      sseSend(res, 'progress', {
        phase: 'novel_bible',
        status: 'done',
        text: '全书故事圣经已生成',
      });
    } else {
      s.wholeNovelBible = checkpoint.wholeNovelBible;
    }

    const sourceBeats = buildSourceBeatIndex(chapters);
    if (!sourceBeats.length) throw new Error('未能建立原文素材索引');
    s.wholeNovelSourceBeatIndex = serializeSourceBeatIndex(sourceBeats);

    let seriesPlan = checkpoint.seriesPlan;
    if (seriesPlan && validateSeriesPlan(seriesPlan, chapters).length) {
      seriesPlan = null;
      checkpoint.seriesPlan = null;
      checkpoint.episodePlan = [];
      checkpoint.completedPlanBatches = [];
    }
    if (!seriesPlan) {
      sseSend(res, 'progress', {
        phase: 'novel_series_plan',
        status: 'running',
        text: '正在生成全剧阶段规划',
      });
      seriesPlan = await generateValidatedSeriesPlan({
        cfg: cfg.text,
        wholeNovelBible: s.wholeNovelBible,
        stageBibles,
        chapters,
        signal: session.signal,
      });
      checkpoint.seriesPlan = seriesPlan;
      persistCheckpoint({ phase: 'novel_series_plan' });
      sseSend(res, 'progress', {
        phase: 'novel_series_plan',
        status: 'done',
        arcs: seriesPlan.arcPlan.length,
        text: `全剧阶段规划已生成，共 ${seriesPlan.arcPlan.length} 个阶段`,
      });
    }

    const maxPlanBatchChars = planningOptions.planBatchChars;
    const arcWork = seriesPlan.arcPlan.map((arc) => {
      const arcBeats = beatsForArc(sourceBeats, arc, chapters);
      if (!arcBeats.length) throw new Error(`阶段「${arc.arcName || arc.arcId}」没有匹配到原文素材`);
      return { arc, batches: buildBeatPlanningBatches(arcBeats, { maxChars: maxPlanBatchChars }) };
    });
    const flatPlanWork = arcWork.flatMap((work) => work.batches.map((batch) => ({
      arc: work.arc,
      batch,
      key: `${work.arc.arcId || work.arc.arcName}:${batch.firstBeatId}:${batch.lastBeatId}`,
    })));
    const reconciliation = reconcileWholeNovelPlanningBatches(
      checkpoint,
      flatPlanWork.map((item) => item.key),
    );
    checkpoint.completedPlanBatches = reconciliation.completedPlanBatches;
    checkpoint.episodePlan = reconciliation.episodePlan;
    const totalPlanBatches = flatPlanWork.length;
    const episodePlan = checkpoint.episodePlan;
    let completedPlanBatches = reconciliation.validCount;
    if (completedPlanBatches) {
      sseSend(res, 'progress', {
        phase: 'novel_episode_plan',
        index: completedPlanBatches,
        total: totalPlanBatches,
        status: 'done',
        resumed: true,
        text: `已恢复分集规划 ${completedPlanBatches}/${totalPlanBatches}，继续剩余批次`,
      });
    }
    for (let workIndex = completedPlanBatches; workIndex < flatPlanWork.length; workIndex++) {
        const work = flatPlanWork[workIndex];
        const { batch, arc } = work;
        sseSend(res, 'progress', {
          phase: 'novel_episode_plan',
          index: completedPlanBatches,
          total: totalPlanBatches,
          status: 'running',
          text: `正在规划「${arc.arcName || arc.arcId}」${batch.index + 1}/${batch.total}`,
        });
        const planned = await generateValidatedEpisodeBatch({
          cfg: cfg.text,
          wholeNovelBible: wholeNovelBibleText(s, 32000),
          seriesPlan,
          arc,
          batch,
          startEpisodeNumber: episodePlan.length + 1,
          previousBatchSummary: episodeBatchTailSummary(episodePlan),
          signal: session.signal,
        });
        episodePlan.push(...planned);
        checkpoint.episodePlan = episodePlan;
        checkpoint.completedPlanBatches.push({ key: work.key, episodeCount: planned.length });
        completedPlanBatches += 1;
        persistCheckpoint({ phase: 'novel_episode_plan' });
        sseSend(res, 'progress', {
          phase: 'novel_episode_plan',
          index: completedPlanBatches,
          total: totalPlanBatches,
          status: 'done',
          episodes: episodePlan.length,
          text: `已完成分集规划 ${completedPlanBatches}/${totalPlanBatches}，当前共 ${episodePlan.length} 集`,
        });
    }
    if (!episodePlan.length) throw new Error('分批规划没有生成任何剧集');
    s.wholeNovelEpisodePlan = {
      ...seriesPlan,
      seriesStrategy: {
        ...(seriesPlan.seriesStrategy || {}),
        totalEpisodes: episodePlan.length,
      },
      sourceBeatVersion: 1,
      generatedAt: new Date().toISOString(),
      episodePlan,
    };

    sseSend(res, 'progress', {
      phase: 'novel_split',
      status: 'running',
      text: '正在校验素材覆盖并生成剧集表',
    });
    const allCreated = materializeEpisodesFromBeatPlan(s.wholeNovelEpisodePlan, sourceBeats);
    if (session.signal.aborted) throw session.signal.reason || Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    invalidateEpisodesOutputs(proj, s.episodes.map((episode) => episode.id));
    s.episodes = allCreated;
    s.storyboards = [];
    s.nextEpisodeId = allCreated.length + 1;
    s.wholeNovelAdapted = true;
    s.wholeNovelPlanningStale = false;
    checkpoint.status = 'complete';
    checkpoint.phase = 'done';
    checkpoint.lastError = '';
    checkpoint.digests = [];
    checkpoint.updatedAt = new Date().toISOString();
    s.wholeNovelPlanningCheckpoint = checkpoint;
    proj.updatedAt = new Date().toISOString();

    sseSend(res, 'progress', {
      phase: 'novel_split',
      status: 'done',
      episodes: allCreated.length,
      beats: sourceBeats.length,
      text: `整本统筹完成，共 ${allCreated.length} 集，已校验 ${sourceBeats.length} 个素材ID`,
    });

    proj.updatedAt = new Date().toISOString();
    if (session.signal.aborted) throw session.signal.reason || Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    persistCheckpoint({ phase: 'done', status: 'complete', final: true });
    sseSend(res, 'done', donePayload());
  } catch (e) {
    const errorMessage = e?.message || '整本改编规划失败';
    try {
      persistCheckpoint({
        phase: checkpoint.phase || 'unknown',
        status: 'failed',
        message: errorMessage,
      });
    } catch { /* 保留原始生成错误 */ }
    const sourceChanged = errorMessage.includes('原文章节在整本规划期间发生了变化');
    sseSend(res, 'error', {
      resumable: !sourceChanged,
      message: sourceChanged
        ? errorMessage
        : `${errorMessage}；已保存完成步骤，重新点击可从断点继续`,
    });
  } finally {
    session.close();
    if (!res.writableEnded) res.end();
  }
  return true;
}

// ---- 就地分集：只针对单个章节原文，集号续排（非流式 JSON，走 text 段）----
  if (p === '/api/script/chapter/split' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;
  const ch = s.chapters.find((c) => c.id === Number(body.chapterId));
  if (!ch) return sendJson(res, 404, { error: '章节不存在' });
  const text = (ch.sourceText || '').trim();
  if (!text) return sendJson(res, 400, { error: '该章节还没有原文' });
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'adaptation')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  cfg.text = resolveTextModelConfig(cfg, 'adaptation', { projectId: proj.id, operation: 'split-chapter' });
  try {
    const removedEpisodeIds = s.episodes
      .filter((e) => e.chapterId === ch.id)
      .map((e) => e.id)
      .sort((a, b) => a - b);
    const startEpisodeNumber = removedEpisodeIds[0] || s.nextEpisodeId;
    const splitWindowSize = 80000;
    const windows = splitTextWindows(ch.sourceText, splitWindowSize);
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
        globalBible: [wholeNovelBibleBlock(s, 30000), wholeNovelEpisodePlanBlock(s, 24000)].filter(Boolean).join('\n\n'),
      });
      const raw = await chatComplete(cfg.text, messages, { temperature: 0.3, maxTokens: 12000, allowTruncated: true });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`第 ${wi + 1}/${windows.length} 段未返回有效的分集 JSON`);
      const parsed = JSON.parse(match[0]);
      const windowEpisodes = Array.isArray(parsed.episodes) ? parsed.episodes : [];
      const anchorErrors = validateChapterSplitAnchorPlan(windowEpisodes, win.text);
      if (anchorErrors.length) throw new Error(`第 ${wi + 1}/${windows.length} 段锚点校验失败：${anchorErrors.join('；')}`);
      for (const ep of windowEpisodes) {
        eps.push({ ...ep, __windowStart: win.start, __windowEnd: win.end });
      }
      planningEpisodeNumber += windowEpisodes.length;
    }
    if (!eps.length) throw new Error('未能从该章节分出任何一集');
    // 用定位文本得到章节内偏移，并强制单调递增，避免后续集被前一集吞掉。
    const full = ch.sourceText;
    const created = [];
    let freshEpisodeId = Math.max(
      s.nextEpisodeId - 1,
      s.episodes.reduce((m, e) => Math.max(m, e.id || 0), 0),
      ...removedEpisodeIds,
    ) + 1;
    let cursor = 0;
    eps.forEach((ep, i) => {
      if (cursor >= full.length) return;
      // startText 定位
      let startOff = cursor;
      const windowStart = Number.isFinite(ep.__windowStart) ? ep.__windowStart : 0;
      const windowEnd = Number.isFinite(ep.__windowEnd) ? ep.__windowEnd : full.length;
      const anchorFrom = Math.max(cursor, windowStart - 80);
      if (!ep.startText) throw new Error(`第${i + 1}个分集缺少 startText`);
      const startIdx = locateSplitAnchor(full, ep.startText, Math.max(0, anchorFrom), 'start');
      if (startIdx < 0) throw new Error(`第${i + 1}个分集 startText 无法定位`);
      startOff = Math.max(cursor, snapSplitBoundary(full, startIdx, cursor));
      // endText 定位
      if (!ep.endText) throw new Error(`第${i + 1}个分集缺少 endText`);
      const endIdx = locateSplitAnchor(full, ep.endText, Math.max(startOff, windowStart), 'end');
      if (endIdx < 0) throw new Error(`第${i + 1}个分集 endText 无法定位`);
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
      const id = removedEpisodeIds[created.length] || freshEpisodeId++;
      const epObj = {
        id,
        title: ep.title || `第${id}集`,
        chapterId: ch.id,
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
      created.push(epObj);
    });
    if (!created.length) throw new Error('分集切点无效，未生成有效集数');
    if (created[created.length - 1].endOffset < full.length) {
      created[created.length - 1].endOffset = full.length;
    }
    // 只有完整切点都校验通过后才清理旧集，避免规划失败时误删原有产物。
    if (removedEpisodeIds.length) {
      invalidateEpisodesOutputs(proj, removedEpisodeIds);
      const removedSet = new Set(removedEpisodeIds.map(Number));
      s.episodes = s.episodes.filter((e) => !removedSet.has(Number(e.id)));
      s.storyboards = s.storyboards.filter((sb) => !removedSet.has(Number(sb.episodeId)));
    }
    s.episodes.push(...created);
    s.episodes.sort((a, b) => a.id - b.id);
    s.nextEpisodeId = Math.max(
      freshEpisodeId,
      s.episodes.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1,
    );
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return sendJson(res, 200, { ok: true, episodes: created, removedEpisodeIds });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: e.message });
  }
}

// ---- 直接把整章当作一集生成（不分集）：没有集就新建一集覆盖整章 ----
  if (p === '/api/script/chapter/whole' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;
  const ch = s.chapters.find((c) => c.id === Number(body.chapterId));
  if (!ch) return sendJson(res, 404, { error: '章节不存在' });
  const text = (ch.sourceText || '').trim();
  if (!text) return sendJson(res, 400, { error: '该章节还没有原文' });
  const full = ch.sourceText;
  let ep = s.episodes.find((e) => e.chapterId === ch.id && e.startOffset === 0 && e.endOffset === full.length);
  if (!ep) {
    const id = s.nextEpisodeId++;
    ep = {
      id,
      title: ch.title || `第${id}集`,
      chapterId: ch.id,
      startOffset: 0,
      endOffset: full.length,
      keyScenes: [],
      cliffhanger: '',
      content: '',
    };
    s.episodes.push(ep);
    s.episodes.sort((a, b) => a.id - b.id);
  }
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  return sendJson(res, 200, { ok: true, episode: ep });
}

// ---- 手动调整某集的切分点（章节内偏移，吸附段落边界）----
  if (p === '/api/script/episode/recut' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;
  const ep = s.episodes.find((e) => e.id === Number(body.episodeId));
  if (!ep) return sendJson(res, 404, { error: '集不存在' });
  const ch = s.chapters.find((c) => c.id === ep.chapterId);
  if (!ch) return sendJson(res, 404, { error: '所属章节不存在' });
  const nextStartOffset = typeof body.startOffset === 'number'
    ? snapToParagraph(ch.sourceText, body.startOffset)
    : ep.startOffset;
  const nextEndOffset = typeof body.endOffset === 'number'
    ? snapToParagraph(ch.sourceText, body.endOffset)
    : ep.endOffset;
  if (nextEndOffset <= nextStartOffset) return sendJson(res, 400, { error: '结束位置必须大于起始位置' });
  const offsetsChanged = nextStartOffset !== ep.startOffset || nextEndOffset !== ep.endOffset;
  ep.startOffset = nextStartOffset;
  ep.endOffset = nextEndOffset;
  if (offsetsChanged) invalidateEpisodeOutputs(proj, ep.id, { clearScript: true });
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  return sendJson(res, 200, { ok: true, episode: ep, invalidated: offsetsChanged });
}

// ---- Delete one episode and all linked local assets. ----
  if (p === '/api/script/episode/delete' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const episodeId = Number(body.episodeId);
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    return sendJson(res, 400, { error: 'episodeId 无效' });
  }
  const s = proj.script;
  const episodeIndex = s.episodes.findIndex((episode) => Number(episode.id) === episodeId);
  if (episodeIndex < 0) return sendJson(res, 404, { error: '集不存在' });

  const [removedEpisode] = s.episodes.splice(episodeIndex, 1);
  const storyboardCountBefore = s.storyboards.length;
  s.storyboards = s.storyboards.filter((storyboard) => Number(storyboard.episodeId) !== episodeId);
  const removedStoryboardCount = storyboardCountBefore - s.storyboards.length;
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);

  const clearedPendingCount = clearPendingByProject(proj.id, episodeId);
  const mediaCleanup = deleteEpisodeMediaFiles(proj.id, episodeId);
  return sendJson(res, 200, {
    ok: true,
    episodeId,
    episodeTitle: removedEpisode.title || `第${episodeId}集`,
    removedStoryboardCount,
    clearedPendingCount,
    removedMediaFileCount: mediaCleanup.removedFiles,
    cleanupWarnings: mediaCleanup.errors,
  });
}

// ---- 直接新建一个空集数（分镜台入口，无需先有剧本内容）----
  if (p === '/api/script/episode/create' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;

  // 复用或创建"手动新增"章节
  let manualChapter = s.chapters.find((c) => c.title === '手动新增');
  if (!manualChapter) {
    const newChapterId = Math.max(
      s.nextChapterId || 1,
      s.chapters.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1
    );
    manualChapter = {
      id: newChapterId,
      title: '手动新增',
      sourceText: '',
      order: s.chapters.length,
      createdAt: new Date().toISOString(),
    };
    s.chapters.push(manualChapter);
    s.nextChapterId = newChapterId + 1;
  }

  const freshEpisodeId = nextAvailableEpisodeId(s.episodes);
  const title = String(body.title || '').trim() || `第${freshEpisodeId}集`;
  const newEpisode = {
    id: freshEpisodeId,
    title,
    chapterId: manualChapter.id,
    startOffset: 0,
    endOffset: 0,
    keyScenes: [],
    cliffhanger: '',
    content: '',
  };
  s.episodes.push(newEpisode);
  s.episodes.sort((a, b) => a.id - b.id);
  s.nextEpisodeId = Math.max(
    s.nextEpisodeId || 1,
    s.episodes.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1,
  );
  invalidateWholeNovelPlanning(s);
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  return sendJson(res, 200, { ok: true, episode: newEpisode });
}

// ---- 导入用户自己的剧本（直接创建 episode，跳过小说生成剧本步骤）----
  if (p === '/api/script/episode/import' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;

  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title) return sendJson(res, 400, { error: '请输入剧本标题' });
  if (!content) return sendJson(res, 400, { error: '请输入剧本内容' });

  // 创建或获取"导入剧本"章节
  invalidateWholeNovelPlanning(s);
  let importChapter = s.chapters.find((c) => c.title === '导入剧本');
  if (!importChapter) {
    const newChapterId = Math.max(
      s.nextChapterId || 1,
      s.chapters.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1
    );
    importChapter = {
      id: newChapterId,
      title: '导入剧本',
      sourceText: '',
      order: s.chapters.length,
      createdAt: new Date().toISOString(),
    };
    s.chapters.push(importChapter);
    s.nextChapterId = newChapterId + 1;
  }

  const importSourceBase = String(importChapter.sourceText || '').trimEnd();
  const importSourcePrefix = importSourceBase ? `${importSourceBase}\n\n` : '';
  const importSourceStartOffset = importSourcePrefix.length;
  const nextImportSourceText = `${importSourcePrefix}${content}`;

  // 智能分集：检测剧本中的"第X集"标记
  const episodePattern = /^第\s*(\d+)\s*集[：:\s]*/gm;
  const matches = [];
  let match;
  while ((match = episodePattern.exec(content)) !== null) {
    matches.push({
      index: match.index,
      episodeNum: parseInt(match[1], 10),
      fullMatch: match[0],
    });
  }

  const created = [];
  let freshEpisodeId = Math.max(
    s.nextEpisodeId || 1,
    s.episodes.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1
  );

  if (matches.length > 1) {
    // 找到多个"第X集"标记，智能分割
    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];

      const startIdx = currentMatch.index + currentMatch.fullMatch.length;
      const endIdx = nextMatch ? nextMatch.index : content.length;
      const rawEpisodeContent = content.slice(startIdx, endIdx);
      const episodeContent = rawEpisodeContent.trim();
      const leadingTrim = rawEpisodeContent.length - rawEpisodeContent.trimStart().length;
      const trailingTrim = rawEpisodeContent.length - rawEpisodeContent.trimEnd().length;

      if (!episodeContent) continue;

      const newEpisode = {
        id: freshEpisodeId++,
        title: `第${currentMatch.episodeNum}集`,
        chapterId: importChapter.id,
        startOffset: importSourceStartOffset + startIdx + leadingTrim,
        endOffset: importSourceStartOffset + endIdx - trailingTrim,
        keyScenes: [],
        cliffhanger: '',
        content: episodeContent,
      };

      s.episodes.push(newEpisode);
      created.push(newEpisode);
    }

    importChapter.sourceText = nextImportSourceText;
    s.episodes.sort((a, b) => a.id - b.id);
    s.nextEpisodeId = freshEpisodeId;
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);

    return sendJson(res, 200, {
      ok: true,
      episodes: created,
      message: `已智能分割为 ${created.length} 集`
    });

  } else {
    // 单集或未检测到分集标记
    // 检查长度，如果超过 15000 字符，建议用户手动分集
    if (content.length > 15000) {
      return sendJson(res, 400, {
        error: `剧本过长（${content.length} 字），建议手动添加"第1集"、"第2集"等标记后重新导入，系统会自动分割`
      });
    }

    importChapter.sourceText = nextImportSourceText;
    const newEpisode = {
      id: freshEpisodeId,
      title,
      chapterId: importChapter.id,
      startOffset: importSourceStartOffset,
      endOffset: importSourceStartOffset + content.length,
      keyScenes: [],
      cliffhanger: '',
      content,
    };

    s.episodes.push(newEpisode);
    s.episodes.sort((a, b) => a.id - b.id);
    s.nextEpisodeId = freshEpisodeId + 1;

    proj.updatedAt = new Date().toISOString();
    saveProject(proj);

    return sendJson(res, 200, { ok: true, episode: newEpisode });
  }
}

// ---- 导入分镜（用户自带分镜文本，按自定义标记切割，无集时自动建集）----
  if (p === '/api/script/storyboard/import' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;

  const content = String(body.content || '').trim();
  if (!content) return sendJson(res, 400, { error: '请输入分镜内容' });
  // 切割标记前缀：默认"分镜"，用户可自定义（如"剧本"、"镜头"等任意词）
  const marker = String(body.marker || '分镜').trim() || '分镜';

  // 按 行首"<marker> N" 切割，规整成 parseShots 认的"分镜N："格式
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^[ \\t]*${escaped}\\s*(\\d+)\\s*[：:、.\\s]?`, 'gm');
  const marks = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    marks.push({ no: m[1], start: m.index, headEnd: re.lastIndex });
  }

  let normalized;
  if (marks.length) {
    const parts = [];
    for (let i = 0; i < marks.length; i++) {
      const cur = marks[i];
      const end = i + 1 < marks.length ? marks[i + 1].start : content.length;
      const bodyText = content.slice(cur.headEnd, end).trim();
      // 导入顺序是唯一可信的顺序；原文编号可能重复、跳号或乱序。
      parts.push(`分镜${i + 1}：\n${bodyText}`);
    }
    normalized = parts.join('\n\n');
  } else {
    // 没找到任何标记，整段当成 1 个镜头
    normalized = `分镜1：\n${content}`;
  }
  const shotCount = marks.length || 1;

  // 确定目标集：指定了 episodeId 就用它；否则自动建一个集
  let episodeId = Number(body.episodeId) || 0;
  let createdEpisode = null;
  let targetEp = episodeId ? s.episodes.find((e) => e.id === episodeId) : null;

  if (!targetEp) {
    // 复用/创建"导入分镜"章节
    let importChapter = s.chapters.find((c) => c.title === '导入分镜');
    if (!importChapter) {
      const newChapterId = Math.max(
        s.nextChapterId || 1,
        s.chapters.reduce((mx, c) => Math.max(mx, c.id || 0), 0) + 1
      );
      importChapter = {
        id: newChapterId,
        title: '导入分镜',
        sourceText: '',
        order: s.chapters.length,
        createdAt: new Date().toISOString(),
      };
      s.chapters.push(importChapter);
      s.nextChapterId = newChapterId + 1;
    }
    const freshEpisodeId = Math.max(
      s.nextEpisodeId || 1,
      s.episodes.reduce((mx, e) => Math.max(mx, e.id || 0), 0) + 1
    );
    targetEp = {
      id: freshEpisodeId,
      title: String(body.title || '').trim() || `导入分镜${freshEpisodeId}`,
      chapterId: importChapter.id,
      startOffset: 0,
      endOffset: 0,
      keyScenes: [],
      cliffhanger: '',
      content: '',
    };
    s.episodes.push(targetEp);
    s.episodes.sort((a, b) => a.id - b.id);
    s.nextEpisodeId = freshEpisodeId + 1;
    episodeId = freshEpisodeId;
    createdEpisode = targetEp;
  }

  // 写入/覆盖该集的分镜
  invalidateEpisodeOutputs(proj, episodeId);
  const sbObj = stampGeneratedStoryboard({ episodeId, episodeTitle: targetEp.title, content: normalized, mode: 'normal' });
  const idx = s.storyboards.findIndex((sb) => sb.episodeId === episodeId);
  if (idx >= 0) s.storyboards[idx] = { ...s.storyboards[idx], ...sbObj };
  else s.storyboards.push(sbObj);
  s.storyboards.sort((a, b) => a.episodeId - b.episodeId);

  proj.updatedAt = new Date().toISOString();
  saveProject(proj);

  return sendJson(res, 200, {
    ok: true,
    episode: createdEpisode,
    storyboard: sbObj,
    shots: shotCount,
    message: createdEpisode ? `已新建「${targetEp.title}」并导入 ${shotCount} 个分镜` : `已导入 ${shotCount} 个分镜到「${targetEp.title}」`,
  });
}

// ---- 生成单集剧本（SSE 流式，章节切片 + 前情衔接）----
  if (p === '/api/script/episode/stream' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'script')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  cfg.text = resolveTextModelConfig(cfg, 'script', { projectId: proj.id, episodeId: body.episodeId, operation: 'generate-episode' });
  const s = proj.script;
  const episodeId = Number(body.episodeId);
  const ep = s.episodes.find((e) => e.id === episodeId);
  if (!ep) return sendJson(res, 404, { error: `未找到第${episodeId}集，请先对章节分集` });
  if (ep.sourceMode === 'wholeNovel' && s.wholeNovelPlanningStale === true) {
    return sendJson(res, 409, { error: '原文章节已变更，旧的整本分集范围已失效，请重新执行整本改编规划' });
  }
  const ch = s.chapters.find((c) => c.id === ep.chapterId);
  if (!ch) return sendJson(res, 404, { error: '该集所属章节不存在' });

  const settings = s.settings || {};
  const scriptPromptMode = body.scriptPromptMode === 'custom'
    ? 'custom'
    : (body.scriptPromptMode === 'builtin' ? 'builtin' : settings.scriptPromptMode);
  const useCustomScriptPrompt = scriptPromptMode === 'custom';
  const bodyCustomScriptPrompt = typeof body.customScriptPrompt === 'string' ? body.customScriptPrompt.trim() : '';
  const storedCustomScriptPrompt = selectedCustomPromptContent(settings, 'script', cfg.promptLibrary) || settings.customScriptPrompt || '';
  const customScriptPrompt = bodyCustomScriptPrompt || String(storedCustomScriptPrompt || '').trim();
  if (useCustomScriptPrompt && !customScriptPrompt) {
    return sendJson(res, 400, { error: '请先选择并填写自定义剧本提示词' });
  }
  const useColdOpen = !useCustomScriptPrompt && settings.useColdOpen !== false;
  const useEpisodeHook = !useCustomScriptPrompt && settings.useEpisodeHook !== false;
  const usePromptPurification = !useCustomScriptPrompt && settings.usePurification !== false;
  const useCoverageReview = !useCustomScriptPrompt && settings.usePurification !== false;
  const useLongScript = !useCustomScriptPrompt && !!settings.useLongScript;
  const useContentReview = !useCustomScriptPrompt && !!settings.useContentReview;
  const adaptationStrength = normalizeAdaptationStrength(
    body.adaptationStrength || settings.adaptationStrength || (settings.useOriginalMode ? 'faithful' : 'enhanced')
  );
  const adaptationStrengthLabel = ADAPTATION_STRENGTH_LABELS[adaptationStrength] || ADAPTATION_STRENGTH_LABELS.enhanced;
  const useDramaReview = !useCustomScriptPrompt && settings.useDramaReview !== false;
  const useEpisodeFinalReview = !useCustomScriptPrompt && settings.useEpisodeFinalReview !== false;
  const scriptRequirement = useCustomScriptPrompt
    ? String(body.requirement || '').trim()
    : buildCustomGenerationRequirement(
        body.requirement || '',
        customScriptPrompt,
        'script'
      );
  // 该集在整个项目中是否第一集（按集 id 排序的首位）
  const sortedIds = s.episodes.map((e) => e.id).sort((a, b) => a - b);
  const isFirst = episodeId === sortedIds[0];
  // 整本统筹模式允许一集跨章节/多片段；旧模式仍使用单章节偏移。
  const novelSlice = episodeSourceText(ep, s.chapters);
  const coldOpenChapterId = Number(ep?.sourceRanges?.[0]?.chapterId || ep.chapterId);
  const coldOpenChapter = s.chapters.find((chapter) => Number(chapter.id) === coldOpenChapterId) || ch;
  const coldOpenSource = (isFirst && useColdOpen)
    ? String(coldOpenChapter?.sourceText || novelSlice)
    : '';

  // 前情脉络摘要：前面所有集的「标题 + 关键场面 + 钩子 + 结尾」串成脉络，用于跨集一致性承接
  const priorEps = s.episodes.filter((e) => e.id < episodeId).sort((a, b) => a.id - b.id);
  const priorArcSummary = priorEps.length
    ? priorEps.map((e) => {
        const tail = (e.content || '').replace(/\s+/g, ' ').slice(-160);
        const keys = Array.isArray(e.keyScenes) && e.keyScenes.length ? `｜关键场面：${e.keyScenes.join('、')}` : '';
        return `第${e.id}集《${e.title}》${keys}${e.cliffhanger ? `｜钩子：${e.cliffhanger}` : ''}${tail ? `（结尾：…${tail}）` : ''}`;
      }).join('\n')
    : '';
  const globalStoryContext = [
    wholeNovelBibleBlock(s, 30000),
    wholeNovelEpisodeContextBlock(s, ep, 20000),
  ].filter(Boolean).join('\n\n');
  // 上一集结尾与结构化状态（强衔接）
  const prevEp = priorEps[priorEps.length - 1];
  const prevSummary = prevEp ? (prevEp.content || '').slice(-500) : '';
  const priorContinuityState = prevEp?.continuityStateAfter && typeof prevEp.continuityStateAfter === 'object'
    ? prevEp.continuityStateAfter
    : {};
  const continuityStateBlock = Object.keys(priorContinuityState).length
    ? `【上一集结束状态账本】\n${JSON.stringify(priorContinuityState, null, 2)}`
    : '';
  const priorArcWithBible = [
    globalStoryContext,
    continuityStateBlock,
    compactReferenceText(priorArcSummary, 18000),
  ].filter(Boolean).join('\n\n');

  // 适配 plan 字段（提示词内部用 startIndex/endIndex/episodeNumber）
  const plan = {
    episodeNumber: ep.id,
    title: ep.title,
    startIndex: ep.startOffset,
    endIndex: ep.endOffset,
    keyScenes: ep.keyScenes || [],
    cliffhanger: ep.cliffhanger || '',
    endingHook: ep.endingHook || { type: '追看动力', content: ep.cliffhanger || '' },
    sourceRanges: ep.sourceRanges || [],
    sourceBeatIds: ep.sourceBeatIds || [],
    plotGoal: ep.plotGoal || '',
    compression: ep.compression || '',
    mustExplain: ep.mustExplain || [],
    causalBridge: ep.causalBridge || [],
    emotionAction: ep.emotionAction || '',
    revealNow: ep.revealNow || [],
    hideUntilLater: ep.hideUntilLater || [],
  };

  const scriptChunkSize = clampGenerationChunkSize(cfg.chunkSize, 8000, 12000);
  const novelChunks = splitTextForGeneration(novelSlice, scriptChunkSize);
  if (!novelChunks.length) return sendJson(res, 400, { error: '该集原文为空，无法生成剧本' });

  const session = createSseSession(req, res);
  let full = '';
  try {
    let nextSceneNo = 1;
    for (let i = 0; i < novelChunks.length; i++) {
      const chunk = novelChunks[i];
      const isLastChunk = i === novelChunks.length - 1;
      const isFirstChunk = i === 0;
      const chunkPriorArc = [
        priorArcWithBible,
        full ? `本集已生成前一分段结尾：${tailSnippet(full, 900)}` : '',
      ].filter(Boolean).join('\n');
      const chunkPlan = {
        ...plan,
        title: novelChunks.length > 1 ? `${plan.title}（第${i + 1}/${novelChunks.length}段）` : plan.title,
        startIndex: ep.startOffset,
        endIndex: ep.endOffset,
      };
      const chunkRequirement = novelChunks.length > 1
        ? segmentedRequirement(scriptRequirement, {
            kind: 'script',
            index: i,
            total: novelChunks.length,
            isLast: isLastChunk,
            previousTail: full ? tailSnippet(full, 700) : '',
          })
        : scriptRequirement;
      const messages = useCustomScriptPrompt
        ? generateCustomEpisodeScriptPrompt({
            novelContent: chunk,
            episodePlan: chunkPlan,
            previousEpisodesSummary: prevSummary,
            priorArcSummary: chunkPriorArc || priorArcWithBible,
            customPrompt: customScriptPrompt,
            requirement: chunkRequirement,
            isFirstEpisode: isFirst && isFirstChunk,
          })
        : generateEpisodeScriptPrompt(
            chunk,
            chunkPlan,
            prevSummary,
            isFirst && isFirstChunk,
            chunkRequirement,
            useColdOpen && isFirstChunk,
            usePromptPurification,
            useLongScript,
            useContentReview,
            chunkPriorArc || priorArcWithBible,
            isFirstChunk ? compactReferenceText(coldOpenSource) : '',
            adaptationStrength,
            useEpisodeHook,
            { index: i, total: novelChunks.length, isLast: isLastChunk }
          );
      sseSend(res, 'progress', { phase: 'script_segment', index: i, total: novelChunks.length, status: 'running' });
      const rawSegment = await streamTextWithRetry(cfg.text, messages, {
        temperature: cfg.text.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: generationMaxTokens(cfg, DEFAULT_MAX_TOKENS),
        attempts: 2,
        timeoutMs: GENERATION_TOTAL_TIMEOUT_MS,
        idleTimeoutMs: GENERATION_IDLE_TIMEOUT_MS,
        signal: session.signal,
        onRetry: ({ attempt, attempts, error }) => {
          sseSend(res, 'progress', {
            phase: 'script_segment',
            index: i,
            total: novelChunks.length,
            status: 'retry',
            attempt: attempt + 1,
            attempts,
            message: error?.message || '分段生成中断，正在重试',
          });
        },
      });
      let segmentText = '';
      if (useCustomScriptPrompt) {
        segmentText = String(rawSegment || '').trim();
      } else {
        const cleaned = stripEpisodeEndMarkers(rawSegment);
        const coverage = await reviewAndRepairScriptSegment(cfg.text, messages, chunk, cleaned, {
          enabled: useCoverageReview,
          signal: session.signal,
          onProgress: (payload) => sseSend(res, 'progress', {
            phase: 'script_coverage',
            index: i,
            total: novelChunks.length,
            ...payload,
          }),
        });
        const coverageSegment = stripEpisodeEndMarkers(coverage.text);
        const dramaQuality = await reviewAndRepairScriptDramaQuality(cfg.text, messages, chunk, coverageSegment, {
          enabled: useDramaReview,
          adaptationStrength: adaptationStrengthLabel,
          signal: session.signal,
          onProgress: (payload) => sseSend(res, 'progress', {
            phase: 'script_drama_quality',
            index: i,
            total: novelChunks.length,
            ...payload,
          }),
        });
        const finalCoverage = dramaQuality.repaired
          ? await reviewAndRepairScriptSegment(cfg.text, messages, chunk, stripEpisodeEndMarkers(dramaQuality.text), {
              enabled: useCoverageReview,
              signal: session.signal,
              onProgress: (payload) => sseSend(res, 'progress', {
                phase: 'script_coverage_final',
                index: i,
                total: novelChunks.length,
                ...payload,
              }),
            })
          : dramaQuality;
        const checkedSegment = stripEpisodeEndMarkers(finalCoverage.text);
        const numbered = renumberScriptScenes(checkedSegment, nextSceneNo);
        nextSceneNo = numbered.nextNo;
        segmentText = numbered.text;
      }
      if (segmentText) {
        const delta = `${full ? '\n\n' : ''}${segmentText}`;
        full += delta;
        sseSend(res, 'delta', { text: delta });
        sseSend(res, 'progress', { phase: 'script_segment', index: i, total: novelChunks.length, status: 'done' });
      }
    }
    let episodeFinalReview = null;
    if (!useCustomScriptPrompt) {
      full = stripEpisodeEndMarkers(full);
      episodeFinalReview = await reviewAndRepairWholeEpisodeQuality(cfg.text, {
        sourceText: novelSlice,
        scriptText: full,
        episodePlan: plan,
          priorState: priorContinuityState,
        globalContext: compactReferenceText(globalStoryContext, 28000),
      }, {
        enabled: useEpisodeFinalReview,
        signal: session.signal,
        onProgress: (payload) => sseSend(res, 'progress', {
          phase: 'script_episode_final_review',
          ...payload,
        }),
      });
      full = stripEpisodeEndMarkers(episodeFinalReview.text || full);
      full = renumberScriptScenes(full, 1).text;
      const endMarker = useEpisodeHook ? '【本集完 - 留悬念】' : '【本集完】';
      const endDelta = `${full ? '\n' : ''}${endMarker}`;
      full += endDelta;
      sseSend(res, 'delta', { text: endDelta });
    }
    if (session.signal.aborted) throw session.signal.reason || Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    const fresh = loadProject(body.projectId);
    normalizeProjectScript(fresh);
    const target = fresh.script.episodes.find((e) => e.id === episodeId);
    if (!target) throw new Error('本集已被删除，剧本结果未保存');
    invalidateEpisodeOutputs(fresh, episodeId, { clearScript: true });
    target.content = full;
    if (!useCustomScriptPrompt) {
      target.continuityStateBefore = priorContinuityState;
      target.continuityStateAfter = episodeFinalReview?.reviewed
        ? episodeFinalReview.stateAfter
        : priorContinuityState;
      target.finalReview = {
        reviewed: episodeFinalReview?.reviewed === true,
        repaired: episodeFinalReview?.repaired === true,
        summary: episodeFinalReview?.summary || '',
        issues: episodeFinalReview?.issues || [],
        reviewedAt: new Date().toISOString(),
      };
    }
    fresh.updatedAt = new Date().toISOString();
    saveProject(fresh);
    sseSend(res, 'done', { episode: target });
  } catch (e) {
    sseSend(res, 'error', { message: e.message });
  } finally {
    session.close();
    if (!res.writableEnded) res.end();
  }
  return true;
}

// ---- 重新生成单个分镜文本（保留镜头结构，改写高风险表达）----
  if (p === '/api/script/storyboard/shot/regenerate' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'storyboard')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  const episodeId = Number(body.episodeId);
  const shotNo = String(body.shotNo ?? '').trim();
  if (!Number.isInteger(episodeId) || !shotNo) return sendJson(res, 400, { error: '缺少有效的集数或镜头编号' });
  const ep = proj.script.episodes.find((item) => Number(item.id) === episodeId);
  if (!ep) return sendJson(res, 404, { error: `未找到第${episodeId}集剧本` });
  const storyboard = proj.script.storyboards.find((item) => Number(item.episodeId) === episodeId);
  if (!storyboard?.content) return sendJson(res, 404, { error: '当前集还没有分镜' });
  const shot = parseStoryboardShotsForRecovery(storyboard.content)
    .find((item) => String(item.no) === shotNo);
  if (!shot) return sendJson(res, 404, { error: `未找到镜头 ${shotNo}` });
  if (storyboard.shotMeta?.[shotNo]?.locked === true) return sendJson(res, 409, { error: '该镜头已锁定，请先解锁' });
  const requestedBody = String(body.shotBody || '').trim();
  if (requestedBody && requestedBody !== String(shot.body || '').trim()) {
    return sendJson(res, 409, { error: '当前镜头内容已发生变化，请刷新后重试' });
  }

  cfg.text = resolveTextModelConfig(cfg, 'storyboard', {
    projectId: proj.id,
    episodeId,
    operation: 'regenerate-shot-text',
  });
  try {
    const text = await regenerateShotTextWithModel({
      episodeTitle: ep.title || storyboard.episodeTitle || '',
      shotNo,
      shotTitle: shot.title || '',
      shotBody: String(shot.body || '').trim(),
      failureReason: body.failureReason || '',
      generate: (messages, options) => chatComplete(cfg.text, messages, {
        ...options,
        timeoutMs: 2 * 60 * 1000,
      }),
    });
    return sendJson(res, 200, { ok: true, episodeId, shotNo, text });
  } catch (error) {
    return sendJson(res, 500, { error: error?.message || '文本重新生成失败' });
  }
}

// ---- 参考反推（视频直读 / 抽帧 / 图片 → 提示词）----
  if (p === '/api/script/reference/reverse' && method === 'POST') {
  const projectId = String(url.searchParams.get('projectId') || '').trim();
  if (!projectId) return sendJson(res, 400, { error: '缺少 projectId' });
  const proj = loadProject(projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  const kind = String(url.searchParams.get('kind') || '').trim().toLowerCase() === 'image' ? 'image' : 'video';
  const hint = String(url.searchParams.get('hint') || '').trim();
  const mode = normalizeReverseMode(url.searchParams.get('mode'));
  // input：video=只走视频直读（失败即报错，不偷偷退回）；frames=只抽帧；auto=先试直读，被拒自动退抽帧。
  const rawInput = String(url.searchParams.get('input') || '').trim().toLowerCase();
  const inputMode = ['video', 'frames', 'auto'].includes(rawInput) ? rawInput : 'auto';
  const cfg = loadConfig();
  // 参考反推要用能读图/读视频的模型，所以走独立任务键 reference（没配置时自动回落到 default）。
  if (!hasTextModelKey(cfg, 'reference')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  cfg.text = resolveTextModelConfig(cfg, 'reference', { projectId: proj.id, operation: 'reverse-reference-prompt' });

  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const tempPath = path.join(TEMP_DIR, `reference-upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bin`);
  const characterNames = (proj.elements?.character || []).map((el) => el.name).filter(Boolean);
  const shotHeaderPrefix = String(cfg.video?.shotHeaderPrefix || '').trim();
  // 拉片模式输出长，给更多 token；两种模式都给足超时。
  const maxTokens = generationMaxTokens(cfg, mode === 'breakdown' ? 20000 : 8000);
  let work = null;
  let videoFallbackReason = '';
  try {
    await saveRequestBodyToFile(req, tempPath, 2 * 1024 * 1024 * 1024);
    const media = kind === 'video' ? await probeVideo(tempPath) : { duration: 0, width: 0, height: 0, fps: 0, codec: 'image' };
    const requested = Number(url.searchParams.get('count'));
    const frameCount = Number.isFinite(requested) && requested > 0
      ? Math.max(FRAME_LIMITS.min, Math.min(FRAME_LIMITS.max, Math.floor(requested)))
      : planFrameCount(mode, media.duration, { fallback: FRAME_LIMITS.default, max: FRAME_LIMITS.max });
    const base = { mediaMeta: media, kind, mode, characterNames, shotHeaderPrefix, extraHint: hint };
    const callModel = (extra) => chatComplete(cfg.text, buildReversePromptMessages({ ...base, ...extra }), {
      temperature: 0.4,
      maxTokens,
      timeoutMs: 5 * 60 * 1000,
    });

    if (kind === 'video' && inputMode !== 'frames') {
      try {
        const videoDataUrl = videoFileToDataUrl(tempPath);
        const raw = await callModel({ videoDataUrl });
        return sendJson(res, 200, {
          ok: true, prompt: normalizeReverseResponse(raw), media, frames: 0, kind, mode, inputUsed: 'video',
        });
      } catch (error) {
        if (inputMode === 'video') throw error;
        videoFallbackReason = error?.message || '视频直读失败';
      }
    }

    work = kind === 'image'
      ? await normalizeImageFile(tempPath, { maxEdge: FRAME_LIMITS.maxEdge })
      : await extractFrames(tempPath, { count: frameCount, maxEdge: FRAME_LIMITS.maxEdge });
    const raw = await callModel({ frames: work.frames });
    return sendJson(res, 200, {
      ok: true,
      prompt: normalizeReverseResponse(raw),
      media: work.meta,
      frames: work.frames.length,
      kind,
      mode,
      inputUsed: kind === 'image' ? 'image' : 'frames',
      videoFallbackReason,
    });
  } catch (error) {
    const message = error?.message || '参考反推失败';
    // 渠道拒绝 content 数组时，最常见的原因是模型不支持这种输入；给一句能直接行动的提示。
    const visionHint = /image_url|video_url|multimodal|image|video|vision|content|unsupported/i.test(message)
      ? '\n（当前路由到的文本模型可能不支持这种输入。请在设置→多模型路由里把「参考反推」任务的模型固定成支持读图/读视频的型号，例如 google/gemini-3.1-pro-preview 或 qwen/qwen3-vl-32b-instruct，再重试）'
      : '';
    // 明确要视频直读却失败时，别让它退化成抽帧版提示词 —— 动作类参考（跳舞/打斗）那样得到的是猜的。
    const actionHint = inputMode === 'video'
      ? '\n（如果是跳舞、打斗这类靠动作与节奏的参考，反推提示词本身价值不大：建议别走反推，直接在镜头卡上用「参考视频」把这段视频挂给生成模型。）'
      : '';
    return sendJson(res, 500, { error: `${message}${visionHint}${actionHint}`, inputUsed: 'none', videoFallbackReason });
  } finally {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
    if (work) cleanupFrames(work.frames, work.dir);
  }
}

// ---- 提示词 → 合成衔接镜头（不落盘，由前端确认后插入）----
  if (p === '/api/script/storyboard/shot/compose' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'storyboard')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  const episodeId = Number(body.episodeId);
  const anchorShotNo = String(body.anchorShotNo ?? '').trim();
  const position = body.position === 'after' ? 'after' : 'before';
  const description = String(body.description || '').trim();
  if (!Number.isInteger(episodeId) || !anchorShotNo) return sendJson(res, 400, { error: '缺少有效的集数或目标镜头编号' });
  if (!description) return sendJson(res, 400, { error: '请先填写要插入的镜头描述或提示词' });
  const ep = proj.script.episodes.find((item) => Number(item.id) === episodeId);
  if (!ep) return sendJson(res, 404, { error: `未找到第${episodeId}集剧本` });
  const storyboard = proj.script.storyboards.find((item) => Number(item.episodeId) === episodeId);
  if (!storyboard?.content) return sendJson(res, 404, { error: '当前集还没有分镜' });
  const shots = parseStoryboardShotsForRecovery(storyboard.content);
  const anchorIndex = shots.findIndex((item) => String(item.no) === anchorShotNo);
  if (anchorIndex < 0) return sendJson(res, 404, { error: `未找到镜头 ${anchorShotNo}` });
  // 新镜头会插在这个 0 基下标上：插到 anchor 之前 = anchorIndex；之后 = anchorIndex + 1。
  const insertIndex = position === 'after' ? anchorIndex + 1 : anchorIndex;
  const prevShot = shots[insertIndex - 1] || null;
  const nextShot = shots[insertIndex] || null;
  const prevAnchor = prevShot ? extractLastStoryboardAnchor(String(prevShot.body || '')) : '';

  cfg.text = resolveTextModelConfig(cfg, 'storyboard', {
    projectId: proj.id,
    episodeId,
    operation: 'compose-continuity-shot',
  });
  try {
    const messages = buildComposeShotMessages({
      episodeTitle: ep.title || storyboard.episodeTitle || '',
      prevAnchor,
      nextShotText: nextShot ? String(nextShot.body || '') : '',
      description,
      layoutHint: String(body.layoutHint || '').trim(),
      shotHeaderPrefix: String(body.shotHeaderPrefix || cfg.video?.shotHeaderPrefix || '').trim(),
    });
    const raw = await chatComplete(cfg.text, messages, {
      temperature: 0.5,
      maxTokens: generationMaxTokens(cfg, 12000),
      timeoutMs: 3 * 60 * 1000,
    });
    const composed = parseComposeResponse(raw);
    return sendJson(res, 200, {
      ok: true,
      episodeId,
      anchorShotNo,
      position,
      insertAtNo: insertIndex + 1,
      prevAnchorUsed: Boolean(prevAnchor),
      ...composed,
    });
  } catch (error) {
    return sendJson(res, 500, { error: error?.message || '衔接镜头合成失败' });
  }
}

// ---- 生成分镜（SSE 流式）----
  if (p === '/api/script/storyboard/stream' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'storyboard')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  cfg.text = resolveTextModelConfig(cfg, 'storyboard', { projectId: proj.id, episodeId: body.episodeId, operation: 'generate-storyboard' });
  const episodeId = Number(body.episodeId);
  const ep = proj.script.episodes.find((e) => e.id === episodeId);
  if (!ep) return sendJson(res, 404, { error: `未找到第${episodeId}集剧本，请先生成剧本` });

  const mode = 'normal';
  const elementNames = {};
  for (const c of MAIN_CATEGORIES) elementNames[c] = (proj.elements?.[c] || []).map((el) => el.name).filter(Boolean);
  const characterVariants = [];
  for (const el of proj.elements?.character || []) {
    const cname = String(el.name || '').trim();
    if (!cname) continue;
    const variants = (el.variants || []).map((v) => String(v?.name || '').trim()).filter(Boolean);
    const voice = String(el.voice || '').trim();
    if (variants.length || voice) characterVariants.push({ name: cname, variants, voice });
  }
  let prevTailFrame = '';
  const prevEp = proj.script.episodes
    .filter((e) => e.id < episodeId)
    .sort((a, b) => b.id - a.id)[0];
  if (prevEp) {
    const prevSb = proj.script.storyboards.find((s) => s.episodeId === prevEp.id);
    const prevContent = prevSb && prevSb.content ? String(prevSb.content) : '';
    if (prevContent) prevTailFrame = extractLastStoryboardAnchor(prevContent);
  }
  const shotHeader = typeof body.shotHeaderPrefix === 'string' ? body.shotHeaderPrefix.trim() : '无字幕无BGM';
  const settings = proj.script.settings || {};
  const storyboardPromptMode = body.storyboardPromptMode === 'custom'
    ? 'custom'
    : (body.storyboardPromptMode === 'builtin' ? 'builtin' : settings.storyboardPromptMode);
  const useCustomStoryboardPrompt = storyboardPromptMode === 'custom';
  const bodyCustomStoryboardPrompt = typeof body.customStoryboardPrompt === 'string' ? body.customStoryboardPrompt.trim() : '';
  const storedCustomStoryboardPrompt = selectedCustomPromptContent(settings, 'storyboard', cfg.promptLibrary) || settings.customStoryboardPrompt || '';
  const customStoryboardPrompt = bodyCustomStoryboardPrompt || String(storedCustomStoryboardPrompt || '').trim();
  if (useCustomStoryboardPrompt && !customStoryboardPrompt) {
    return sendJson(res, 400, { error: '请先选择并填写自定义分镜提示词' });
  }
  const storyboardPromptTemplateId = typeof body.storyboardPromptTemplateId === 'string'
    ? body.storyboardPromptTemplateId.trim()
    : 'p';
  const useQVersion = useCustomStoryboardPrompt
    ? false
    : (body.useQVersion !== undefined ? body.useQVersion !== false : settings.useQVersion !== false);
  const storyboardRequirement = useCustomStoryboardPrompt
    ? String(body.requirement || '').trim()
    : buildCustomGenerationRequirement(body.requirement || '', '', 'storyboard');
  const storyboardMaxDuration = Math.max(5, Math.min(500, Math.floor(Number(cfg.video?.duration) || 15)));
  const storyboardChunkSize = recommendedStoryboardChunkSize(
    cfg.chunkSize,
    useCustomStoryboardPrompt ? 'custom' : storyboardPromptTemplateId
  );
  const scriptText = stripEpisodeEndMarkers(ep.content);
  const scriptChunks = splitTextForGeneration(scriptText, storyboardChunkSize);
  // 冷开场是「独立引子 + 倒叙/前置爆点」：它切回正文起点是一次时空跳转，而分镜铁规要求
  // 「后一镜【承接】必须与前一镜【定格基准】一字不差」。不额外注入覆盖规则，正文首镜就会被
  // 写成冷开场画面的延续（时空断层）。自定义分镜提示词模式下不注入任何内置规则。
  const hasColdOpen = !useCustomStoryboardPrompt && /【\s*冷开场\s*】/.test(scriptText);
  const storyboardKey = `${String(body.projectId)}:${episodeId}`;
  if (activeStoryboardGenerations.has(storyboardKey)) {
    return sendJson(res, 409, { error: '该集分镜正在生成，请等待当前任务完成' });
  }
  if (!scriptChunks.length) return sendJson(res, 400, { error: '该集剧本为空，无法生成分镜' });

  const session = createSseSession(req, res);
  let full = '';
  try {
    let nextShotNo = 1;
    activeStoryboardGenerations.set(storyboardKey, { startedAt: Date.now() });
    let rollingTailFrame = prevTailFrame;
    for (let i = 0; i < scriptChunks.length; i++) {
      const chunk = scriptChunks[i];
      const baseChunkRequirement = scriptChunks.length > 1
        ? segmentedRequirement(storyboardRequirement, {
          kind: 'storyboard',
          index: i,
          total: scriptChunks.length,
          isLast: i === scriptChunks.length - 1,
          previousTail: rollingTailFrame || '',
        })
        : storyboardRequirement;
      const coverage = useCustomStoryboardPrompt
        ? null
        : storyboardCoverageGuard(chunk, i, scriptChunks.length, storyboardMaxDuration);
      // 只要本段含【冷开场】或它的收尾【黑幕字幕】，就要带上冷开场规则：
      // 后者覆盖「边界落在分段接缝上」的情况（上一段停在冷开场里）。
      const chunkText = String(chunk || '');
      const coldOpenRule = hasColdOpen && (/【\s*冷开场\s*】/.test(chunkText) || /【\s*黑幕字幕\s*】/.test(chunkText))
        ? coldOpenStoryboardGuide()
        : '';
      const chunkRequirement = [baseChunkRequirement, coverage?.text, coldOpenRule].filter(Boolean).join('\n\n');
      const messages = buildStoryboardGenerationMessages({
        useCustomPrompt: useCustomStoryboardPrompt, scriptContent: chunk, episodeNumber: ep.id,
        episodeTitle: ep.title, requirement: chunkRequirement, customPrompt: customStoryboardPrompt,
        elementNames, prevTailFrame: rollingTailFrame, characterVariants, shotHeader,
        templateId: storyboardPromptTemplateId, useQVersion,
        maxDuration: storyboardMaxDuration,
      });
      sseSend(res, 'progress', { phase: 'storyboard_segment', index: i, total: scriptChunks.length, status: 'running' });
      const rawSegment = await streamTextWithRetry(cfg.text, messages, {
        temperature: cfg.text.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: generationMaxTokens(cfg, DEFAULT_MAX_TOKENS),
        attempts: 2,
        timeoutMs: GENERATION_TOTAL_TIMEOUT_MS,
        idleTimeoutMs: GENERATION_IDLE_TIMEOUT_MS,
        signal: session.signal,
        onRetry: ({ attempt, attempts, error }) => {
          sseSend(res, 'progress', {
            phase: 'storyboard_segment',
            index: i,
            total: scriptChunks.length,
            status: 'retry',
            attempt: attempt + 1,
            attempts,
            message: error?.message || '分镜生成请求失败，正在重试',
          });
        },
      });
      const numbered = renumberStoryboardShots(rawSegment, nextShotNo);
      nextShotNo = numbered.nextNo;
      if (!numbered.text) {
        throw new Error(`第 ${i + 1}/${scriptChunks.length} 段分镜为空，已停止保存，避免覆盖为不完整分镜`);
      }
      const delta = `${full ? '\n\n' : ''}${numbered.text}`;
      full += delta;
      sseSend(res, 'delta', { text: delta });
      sseSend(res, 'progress', { phase: 'storyboard_segment', index: i, total: scriptChunks.length, status: 'done' });
      rollingTailFrame = extractLastStoryboardAnchor(numbered.text) || rollingTailFrame;
    }
    if (!full.trim()) throw new Error('分镜生成为空，已停止保存，避免覆盖原分镜');
    if (session.signal.aborted) throw session.signal.reason || Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    const fresh = loadProject(body.projectId);
    normalizeProjectScript(fresh);
    const freshEpisode = fresh.script.episodes.find((item) => Number(item.id) === episodeId);
    if (!freshEpisode) throw new Error('本集已被删除，分镜结果未保存');
    invalidateEpisodeOutputs(fresh, episodeId);
    const sbObj = stampGeneratedStoryboard({ episodeId, episodeTitle: freshEpisode.title, content: full, mode });
    const idx = fresh.script.storyboards.findIndex((s) => s.episodeId === episodeId);
    if (idx >= 0) fresh.script.storyboards[idx] = sbObj;
    else fresh.script.storyboards.push(sbObj);
    fresh.script.storyboards.sort((a, b) => a.episodeId - b.episodeId);
    fresh.updatedAt = new Date().toISOString();
    saveProject(fresh);
    sseSend(res, 'done', { storyboard: sbObj });
  } catch (e) {
    sseSend(res, 'error', { message: e.message });
  } finally {
    activeStoryboardGenerations.delete(storyboardKey);
    session.close();
    if (!res.writableEnded) res.end();
  }
  return true;
}

// ---- 保存剧本数据（开关 / 手改剧本与分镜）----
  if (p === '/api/script/source' && method === 'POST') {
  const body = await readBody(req);
  const proj = loadProject(body.projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(proj);
  const s = proj.script;
  const persistedEpisodeIds = new Set(s.episodes.map((episode) => String(episode?.id)));
  if (body.settings && typeof body.settings === 'object') {
    const current = s.settings || {};
    const normalizePromptList = (list) => (Array.isArray(list) ? list : [])
      .map((item) => ({
        id: String(item?.id || '').trim(),
        name: String(item?.name || '').trim(),
        content: String(item?.content || '').trim(),
      }))
      .filter((item) => item.id);
    s.settings = {
      useColdOpen: body.settings.useColdOpen ?? current.useColdOpen,
      useEpisodeHook: body.settings.useEpisodeHook ?? current.useEpisodeHook,
      usePurification: body.settings.usePurification ?? current.usePurification,
      useLongScript: body.settings.useLongScript ?? current.useLongScript,
      useContentReview: body.settings.useContentReview ?? current.useContentReview,
      useDramaReview: body.settings.useDramaReview ?? current.useDramaReview,
      useEpisodeFinalReview: body.settings.useEpisodeFinalReview ?? current.useEpisodeFinalReview,
      adaptationStrength: ['faithful', 'enhanced', 'rewrite'].includes(body.settings.adaptationStrength)
        ? body.settings.adaptationStrength
        : (current.adaptationStrength || 'enhanced'),
      useQVersion: body.settings.useQVersion ?? current.useQVersion,
      hideStoryboardPrompts: body.settings.hideStoryboardPrompts ?? current.hideStoryboardPrompts,
      scriptPromptMode: body.settings.scriptPromptMode === 'custom' ? 'custom' : (current.scriptPromptMode || 'builtin'),
      storyboardPromptMode: body.settings.storyboardPromptMode === 'custom' ? 'custom' : (current.storyboardPromptMode || 'builtin'),
      selectedScriptPromptId: typeof body.settings.selectedScriptPromptId === 'string' ? body.settings.selectedScriptPromptId : (current.selectedScriptPromptId || ''),
      selectedStoryboardPromptId: typeof body.settings.selectedStoryboardPromptId === 'string' ? body.settings.selectedStoryboardPromptId : (current.selectedStoryboardPromptId || ''),
      customScriptPrompts: Array.isArray(body.settings.customScriptPrompts) ? normalizePromptList(body.settings.customScriptPrompts) : (current.customScriptPrompts || []),
      customStoryboardPrompts: Array.isArray(body.settings.customStoryboardPrompts) ? normalizePromptList(body.settings.customStoryboardPrompts) : (current.customStoryboardPrompts || []),
      customScriptPrompt: typeof body.settings.customScriptPrompt === 'string' ? body.settings.customScriptPrompt : (current.customScriptPrompt || ''),
      customStoryboardPrompt: typeof body.settings.customStoryboardPrompt === 'string' ? body.settings.customStoryboardPrompt : (current.customStoryboardPrompt || ''),
    };
  }
  if (Array.isArray(body.chapters)) s.chapters = body.chapters;
  const incomingEpisodes = [
    ...(Array.isArray(body.episodes) ? body.episodes : []),
    ...(Array.isArray(body.changedEpisodes) ? body.changedEpisodes : []),
  ];
  const currentEpisodesById = new Map(s.episodes.map((episode) => [String(episode?.id), episode]));
  const changedEpisodeIds = [];
  const changedEpisodeSet = new Set();
  for (const incoming of incomingEpisodes) {
    if (!incoming || incoming.id == null || typeof incoming.content !== 'string') continue;
    const current = currentEpisodesById.get(String(incoming.id));
    if (!current || incoming.content === current.content) continue;
    const key = String(incoming.id);
    if (changedEpisodeSet.has(key)) continue;
    changedEpisodeSet.add(key);
    changedEpisodeIds.push(current.id);
  }
  if (changedEpisodeIds.length) {
    invalidateEpisodesOutputs(proj, changedEpisodeIds, { clearScript: true });
    for (const incoming of incomingEpisodes) {
      if (!incoming || incoming.id == null || !changedEpisodeSet.has(String(incoming.id))) continue;
      delete incoming.continuityStateBefore;
      delete incoming.continuityStateAfter;
      delete incoming.finalReview;
      delete incoming.sourceSignature;
    }
  }
  // 集/分镜提交（整包或增量）统一在 support 模块应用；增量语义见 applyScriptContentPatch
  const contentPatch = applyScriptContentPatch(body.projectId, s, body, persistedEpisodeIds);
  const storyboardConflicts = contentPatch.storyboardConflicts;
  if (body.wholeNovelBible !== undefined) s.wholeNovelBible = body.wholeNovelBible || null;
  if (Array.isArray(body.wholeNovelStageBibles)) s.wholeNovelStageBibles = body.wholeNovelStageBibles;
  if (Array.isArray(body.wholeNovelSourceBeatIndex)) s.wholeNovelSourceBeatIndex = body.wholeNovelSourceBeatIndex;
  if (body.wholeNovelEpisodePlan !== undefined) s.wholeNovelEpisodePlan = body.wholeNovelEpisodePlan || null;
  if (typeof body.wholeNovelAdapted === 'boolean') s.wholeNovelAdapted = body.wholeNovelAdapted;
  if (Number.isFinite(Number(body.nextChapterId))) s.nextChapterId = Number(body.nextChapterId);
  if (Number.isFinite(Number(body.nextEpisodeId))) s.nextEpisodeId = Number(body.nextEpisodeId);
  if (body.extractedSigs && typeof body.extractedSigs === 'object') s.extractedSigs = body.extractedSigs;
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  if (contentPatch.partial) {
    return sendJson(res, 200, { ok: true, partial: true, script: { storyboards: contentPatch.responseStoryboards }, storyboardConflicts });
  }
  return sendJson(res, 200, { ok: true, script: s, storyboardConflicts });
}

  return false;
}
