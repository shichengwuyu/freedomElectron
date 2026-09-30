import fs from 'fs';

import { chatComplete, chatCompleteStream } from '../apiClient.js';
import { hasTextModelKey, resolveTextModelConfig } from '../modelRouting.js';
import { createSseSession, sseSend } from '../lib/sse.js';
import {
  getJob,
  isJobCancellationRequested,
  listJobs,
  registerJobActions,
  setJob,
} from '../jobs.js';
import { loadConfig } from '../config.js';
import { generateConfiguredImage, imageProviderConfigError, normalizeImageProvider } from '../imageProviders.js';
import { getImageModelCapabilities as getLibtvImageModelCapabilities } from '../libtvClient.js';
import { resolveGlobalAssetReferences } from '../services/characterLibraryService.js';
import {
  VOLUME_SIZE,
  coverFilePath,
  coverUrlFor,
  countWords,
  deleteNovelDraft,
  draftShell,
  fullNovelText,
  getNovelDraft,
  listNovelDrafts,
  normalizeCharacterState,
  normalizeContinuityState,
  normalizeLedgerEntry,
  normalizeNovelChapter,
  normalizeNovelDraft,
  normalizeNovelCoverRatio,
  normalizeNovelPackagingLab,
  normalizeVolume,
  novelSetupState,
  saveCoverImage,
  saveNovelDraft,
  totalChaptersForWan,
} from '../novelStorage.js';
import {
  buildBlueprintMessages,
  buildChapterArchitectureMessages,
  buildChapterAuditMessages,
  buildChapterContextMessages,
  buildChapterDraftMessages,
  buildChapterIntentMessages,
  buildChapterNormalizeMessages,
  buildContinuityMessages,
  buildMetadataMessages,
  buildPartialRewriteMessages,
  buildQualityRepairMessages,
  buildVolumePlanMessages,
  extractJsonObject,
  buildCoverImagePrompt,
  buildStandaloneCoverPrompt,
  fallbackCoverPrompt,
  buildMultiWriterReviewMessages,
  buildNovelMarketStudyMessages,
  buildNovelPackagingCandidateMessages,
  buildNovelPackagingReviewMessages,
  buildNovelRadarMessages,
} from '../novelPrompts.js';
import {
  analyzeGitHubNovelSkills,
  buildNovelSkillAnalysisMessages,
  installGitHubNovelSkill,
  listNovelSkills,
  publicNovelSkill,
  removeNovelSkill,
  resolveNovelSkillContext,
  setNovelSkillEnabled,
} from '../novelSkills.js';
import {
  applyNovelSetupCoachPlan,
  appendNovelChatMessage,
  buildNovelChatPlanMessages,
  buildNovelSetupCoachMessages,
  clearNovelChat,
  fallbackNovelChatPlan,
  fallbackNovelSetupCoachPlan,
  loadNovelChat,
  mutateNovelChatQueue,
  mutateNovelChatSession,
  normalizeNovelChatPlan,
  normalizeNovelSetupCoachPlan,
  updateNovelChatActionResults,
} from '../novelChat.js';
import {
  getNovelMarketRanking,
  listNovelMarketSources,
  listNovelMarketStudies,
  saveNovelMarketStudy,
} from '../novelMarket.js';
import { planWebSearchQuery, searchWeb } from '../webSearch.js';
import {
  clearStandaloneCoverHistory,
  deleteStandaloneCoverHistory,
  listStandaloneCoverHistory,
  saveStandaloneCoverHistory,
  standaloneCoverHistoryImagePath,
} from '../coverHistory.js';

const novelJobControllers = new Map();
const activeNovelJobs = new Map();
const NOVEL_COVER_REFERENCE_MAX_LIMIT = 10;
const NOVEL_COVER_REFERENCE_MAX_BYTES = 15 * 1024 * 1024;
const NOVEL_COVER_REFERENCE_TOTAL_MAX_BYTES = 48 * 1024 * 1024;
const NOVEL_COVER_LOCAL_REFERENCE_TYPES = Object.freeze({
  character: '人物参考图',
  scene: '场景参考图',
  prop: '道具参考图',
  style: '画风参考图',
});

export function normalizeNovelCoverReferences(values = [], { limit = NOVEL_COVER_REFERENCE_MAX_LIMIT } = {}) {
  const source = Array.isArray(values) ? values.slice(0, Math.max(0, Number(limit) || 0)) : [];
  const references = [];
  let totalBytes = 0;
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const raw = String(item?.imageB64 || item?.b64 || '').trim();
    const b64 = (raw.includes(',') ? raw.split(',').pop() : raw).replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error(`第 ${index + 1} 张参考图数据无效`);
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > NOVEL_COVER_REFERENCE_MAX_BYTES) throw new Error(`第 ${index + 1} 张参考图不能超过 15 MB`);
    totalBytes += bytes;
    if (totalBytes > NOVEL_COVER_REFERENCE_TOTAL_MAX_BYTES) throw new Error('参考图总大小不能超过 48 MB');
    const name = String(item?.name || `本地图片${index + 1}`)
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 80) || `本地图片${index + 1}`;
    const referenceType = Object.hasOwn(NOVEL_COVER_LOCAL_REFERENCE_TYPES, item?.referenceType)
      ? item.referenceType
      : 'character';
    references.push({
      name,
      sourceCategory: referenceType,
      assetTypeLabel: NOVEL_COVER_LOCAL_REFERENCE_TYPES[referenceType],
      b64,
    });
  }
  return references;
}

export async function novelCoverReferenceCapabilities(cfg = loadConfig()) {
  const provider = normalizeImageProvider(cfg.image?.provider);
  if (provider === 'api') return { provider, maxReferenceImages: 9 };
  if (provider === 'updream') return { provider, maxReferenceImages: 10 };
  if (provider === 'dreamina-cli') return { provider, maxReferenceImages: 10 };
  try {
    const capabilities = await getLibtvImageModelCapabilities(cfg.image?.libtvModel || 'Lib Image');
    return {
      provider,
      maxReferenceImages: Math.max(1, Math.min(NOVEL_COVER_REFERENCE_MAX_LIMIT, Number(capabilities.maxReferenceImages) || 10)),
    };
  } catch {
    return { provider, maxReferenceImages: 10 };
  }
}

function requireTextConfig(task = 'novel', usageContext = {}) {
  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, task)) throw new Error('请先在设置中填写文本模型 API Key');
  return resolveTextModelConfig(cfg, task, usageContext);
}

function requireImageConfig() {
  const cfg = loadConfig();
  const configError = imageProviderConfigError(cfg);
  if (configError) throw new Error(configError);
  return cfg;
}

function maxTokens(cfg, fallback = 32000) {
  const n = Number(cfg?.maxTokens);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(2048, Math.min(Math.floor(n), fallback));
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------- 滚动记忆 ----------
const SUMMARY_COMPRESS_THRESHOLD = 11000;

async function compressRollingSummary(cfg, draft, summary, signal) {
  try {
    const compact = await chatComplete(cfg, [
      { role: 'system', content: '你是长篇小说的剧情档案员。请把冗长的分章摘要压缩成一份连贯的前文概要，只输出概要正文，不要解释。' },
      {
        role: 'user',
        content: `作品：《${draft.title}》（${draft.genre}）
请把以下分章摘要压缩到3500字以内，必须保留：主线进展脉络、各核心人物当前状态与关系变化、所有仍未回收的线索与悬念、关键道具与信息。近期章节（最后10条）保留更多细节。

${summary}`,
      },
    ], { temperature: 0.2, maxTokens: Math.min(maxTokens(cfg, 8000), 8000), allowTruncated: true, signal });
    const text = compact.trim();
    if (text) return `【前文压缩概要】\n${text}`;
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return summary.slice(-8000);
}

async function appendChapterDigest(cfg, draft, chapter, digest, signal) {
  const line = `第${chapter.order}章《${chapter.title}》：${digest || '剧情推进'}`;
  let summary = draft.rollingSummary ? `${draft.rollingSummary}\n${line}` : line;
  if (summary.length > SUMMARY_COMPRESS_THRESHOLD) {
    summary = await compressRollingSummary(cfg, draft, summary, signal);
  }
  return summary;
}

function mergeLedger(draft, chapter, continuity) {
  const ledger = draft.ledger.map((entry) => ({ ...entry }));
  const resolvedIds = new Set((continuity.resolvedForeshadow || []).map((x) => String(x || '').trim()).filter(Boolean));
  for (const entry of ledger) {
    if (entry.status === 'open' && resolvedIds.has(entry.id)) {
      entry.status = 'resolved';
      entry.resolvedChapter = chapter.order;
    }
  }
  let seq = ledger.length;
  for (const item of continuity.newForeshadow || []) {
    const content = String(item?.content || '').trim();
    if (!content) continue;
    // 简单去重：同内容不重复入账
    if (ledger.some((entry) => entry.content === content)) continue;
    seq += 1;
    ledger.push(normalizeLedgerEntry({
      id: `f${seq}`,
      content,
      plantedChapter: chapter.order,
      notes: item?.dueHint ? [String(item.dueHint).trim()] : [],
    }, seq - 1));
  }
  return ledger.slice(-60);
}

function mergeCharacterStates(draft, updates = []) {
  const states = draft.characterStates.map((state) => ({ ...state }));
  for (const raw of updates) {
    const next = normalizeCharacterState(raw);
    if (!next.name) continue;
    const index = states.findIndex((state) => state.name === next.name);
    if (index >= 0) {
      states[index] = {
        ...states[index],
        ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)),
      };
    } else {
      states.push(next);
    }
  }
  return states.slice(-24);
}

// ---------- 滚动卷规划 ----------
function mergePlannedChapters(draft, planned = [], volumeIndex, range) {
  const chapters = draft.chapters.map((chapter) => ({ ...chapter }));
  for (const raw of planned) {
    const card = normalizeNovelChapter({ ...raw, volumeIndex }, 0);
    if (card.order < range.start || card.order > range.end) continue;
    const index = chapters.findIndex((chapter) => chapter.order === card.order);
    if (index >= 0) {
      // 已有正文的章节只补卡片信息，不动内容
      chapters[index] = {
        ...card,
        id: chapters[index].id,
        content: chapters[index].content,
        wordCount: chapters[index].wordCount,
        continuityState: chapters[index].continuityState,
        updatedAt: chapters[index].updatedAt,
      };
    } else {
      chapters.push(card);
    }
  }
  return chapters.sort((a, b) => a.order - b.order);
}

async function ensureChapterCards(cfg, draft, order, { signal, onProgress } = {}) {
  if (draft.chapters.some((chapter) => chapter.order === order)) return draft;
  const volumeIndex = Math.ceil(order / VOLUME_SIZE);
  const start = (volumeIndex - 1) * VOLUME_SIZE + 1;
  const end = Math.min(volumeIndex * VOLUME_SIZE, Math.max(draft.chaptersTotal, order));
  onProgress?.(`正在规划第${volumeIndex}卷（第${start}-${end}章）…`);
  const lastWritten = draft.chapters.filter((c) => c.content).sort((a, b) => b.order - a.order)[0] || null;
  const prevVolumeSummary = lastWritten
    ? `已写到第${lastWritten.order}章《${lastWritten.title}》，结尾状态：${JSON.stringify(lastWritten.continuityState || draft.continuityState)}`
    : '';
  const planningSkills = resolveNovelSkillContext(draft, 'planning');
  const raw = await chatComplete(
    cfg,
    buildVolumePlanMessages({
      draft,
      volumeIndex,
      startOrder: start,
      endOrder: end,
      prevVolumeSummary,
      rollingSummary: draft.rollingSummary,
      openLedger: draft.ledger.filter((entry) => entry.status === 'open'),
      characterStates: draft.characterStates,
      skillContext: planningSkills.text,
    }),
    { temperature: 0.6, maxTokens: maxTokens(cfg, 16000), allowTruncated: true, signal },
  );
  const plan = extractJsonObject(raw);
  const chapters = mergePlannedChapters(draft, plan.chapters || [], volumeIndex, { start, end });
  if (!chapters.some((chapter) => chapter.order === order)) {
    throw new Error(`第${volumeIndex}卷规划缺少第${order}章，请重试`);
  }
  const volumes = draft.volumes.filter((volume) => volume.index !== volumeIndex);
  volumes.push(normalizeVolume({
    index: volumeIndex,
    title: plan.volumeTitle || `第${volumeIndex}卷`,
    goal: plan.volumeGoal || '',
    startOrder: start,
    endOrder: end,
  }, volumeIndex - 1));
  return saveNovelDraft({ ...draft, chapters, volumes: volumes.sort((a, b) => a.index - b.index) });
}

function fallbackMarketStudy(items = []) {
  const titles = items.map((item) => String(item?.title || '').trim()).filter(Boolean);
  const averageLength = titles.length ? Math.round(titles.reduce((sum, title) => sum + title.length, 0) / titles.length) : 0;
  return {
    summary: `已读取 ${titles.length} 个公开样本。当前样本标题平均 ${averageLength} 字，建议同时测试冲突长标题与具备内部意象的短标题。`,
    marketSignals: [],
    titlePatterns: {
      effective: ['人物处境与异常变化同时出现', '标题给出具体关系或身份反差'],
      tired: ['无情节支撑的归来、逆光、涅槃等空壳词'],
      antiAiRules: ['每个标题至少包含一个仅属于本书的事实', '朗读时必须像自然人会说的话'],
    },
    introPatterns: { effective: ['前两句交代人物、困境和异常变化'], avoid: ['先讲世界背景再讲人物', '用口号代替追看问题'] },
    openingPatterns: [], structureRules: [], opportunities: [], risks: [],
    doNotCopy: titles.slice(0, 10).map((title) => `不得复刻《${title}》的专名、人物组合和具体标题句式`),
    promptDigest: '标题必须包含作品独有事实并自然可读；简介前两句给出人物、困境和异常变化；只学习结构，不复制榜单标题、专名或情节组合。',
  };
}

const MULTI_WRITER_STRATEGIES = [
  '以因果链和冲突升级为第一优先，重要转折写足动机、过程与代价。',
  '以人物选择、关系张力和情绪感染力为第一优先，让对白带有潜台词。',
  '以读者追更欲、开篇抓力、爽点兑现和章尾钩子为第一优先，但不得牺牲逻辑。',
  '以画面感、动作设计和有辨识度的语言节奏为第一优先，避免模板化表达。',
  '在严格服从既定事实的前提下寻找更意外但合理的推进方案，减少套路感。',
];

async function generateMultiWriterDraft({ cfg, reviewCfg, draft, chapter, volume, previous, previousContinuity, openLedger, chapterIntent, contextPlan, architecture, signal, skillContext, send, pct }) {
  const variantCount = Math.max(2, Math.min(5, Number(draft.features?.multiWriter?.variants) || 3));
  let completed = 0;
  send('progress', { text: `第${chapter.order}章多写手竞争 · ${variantCount} 个候选并行创作…`, percentage: pct(12) });
  const tasks = Array.from({ length: variantCount }, (_, index) => chatComplete(
    cfg,
    buildChapterDraftMessages({
      draft,
      chapter,
      volume,
      previousChapterTail: previous ? previous.content.slice(-1500) : '',
      previousContinuity,
      rollingSummary: draft.rollingSummary,
      openLedger,
      characterStates: draft.characterStates,
      chapterIntent,
      contextPlan,
      architecture,
      skillContext,
      variantInstruction: MULTI_WRITER_STRATEGIES[index] || MULTI_WRITER_STRATEGIES[0],
    }),
    {
      temperature: Math.min(1, 0.72 + index * 0.04),
      maxTokens: maxTokens(cfg, 16000),
      allowTruncated: false,
      signal,
    },
  ).then((text) => {
    completed += 1;
    send('progress', {
      text: `第${chapter.order}章多写手竞争 · 已完成 ${completed}/${variantCount} 稿`,
      percentage: pct(12 + (completed / variantCount) * 27),
    });
    return String(text || '').trim();
  }));
  const settled = await Promise.allSettled(tasks);
  const candidates = settled.filter((item) => item.status === 'fulfilled' && item.value).map((item) => item.value);
  if (!candidates.length) {
    const firstError = settled.find((item) => item.status === 'rejected');
    throw firstError?.reason || new Error('多写手均未返回正文');
  }
  if (candidates.length === 1) {
    send('reset', { reason: 'competition' });
    send('delta', { text: candidates[0] });
    return {
      content: candidates[0],
      trace: { mode: 'multi-writer', variantCount: 1, scores: [], selectedVariant: 1, generatedAt: new Date().toISOString() },
    };
  }

  send('progress', { text: `第${chapter.order}章总编评审 · 正在评分并合并 ${candidates.length} 稿…`, percentage: pct(42) });
  let review = {};
  try {
    const raw = await chatComplete(
      reviewCfg || cfg,
      buildMultiWriterReviewMessages({ draft, chapter, candidates, skillContext }),
      { temperature: 0.35, maxTokens: maxTokens(reviewCfg || cfg, 20000), allowTruncated: false, signal },
    );
    review = extractJsonObject(raw);
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  const chosen = candidates[Math.max(0, Number(review.selectedVariant || 1) - 1)] || candidates[0];
  const content = String(review.mergedContent || chosen).trim();
  send('reset', { reason: 'competition' });
  send('delta', { text: content });
  return {
    content,
    trace: {
      mode: 'multi-writer',
      variantCount: candidates.length,
      scores: Array.isArray(review.scores) ? review.scores : [],
      selectedVariant: Number(review.selectedVariant) || 1,
      generatedAt: new Date().toISOString(),
    },
  };
}

function nextChapterOrder(draft) {
  const unwritten = draft.chapters.filter((chapter) => !chapter.content).sort((a, b) => a.order - b.order)[0];
  if (unwritten) return unwritten.order;
  const maxWritten = draft.chapters.reduce((max, chapter) => Math.max(max, chapter.content ? chapter.order : 0), 0);
  return maxWritten + 1;
}

// ---------- 单章 Agent 状态机 ----------
function checkpointChapterPipeline(draft, chapterId, pipelinePatch = {}, chapterPatch = {}) {
  const chapters = draft.chapters.map((chapter) => {
    if (chapter.id !== chapterId) return chapter;
    return {
      ...chapter,
      ...chapterPatch,
      pipeline: {
        ...(chapter.pipeline || {}),
        ...pipelinePatch,
        error: '',
        updatedAt: new Date().toISOString(),
      },
    };
  });
  return saveNovelDraft({ ...draft, chapters });
}

async function generateOneChapter({ cfg, draft, order, res, signal, progress, emit }) {
  const send = emit || ((event, data) => sseSend(res, event, data));
  const pct = (share) => clampPct(progress.base + (progress.span * share) / 100);
  let working = await ensureChapterCards(cfg, draft, order, {
    signal,
    onProgress: (text) => send('progress', { text, percentage: pct(3) }),
  });
  const chapter = working.chapters.find((item) => item.order === order);
  const volume = working.volumes.find((item) => item.index === chapter.volumeIndex) || null;
  const previous = working.chapters
    .filter((item) => item.order < order && item.content)
    .sort((a, b) => b.order - a.order)[0] || null;
  const previousTail = previous ? previous.content.slice(-1500) : '';
  const previousContinuity = previous
    ? (previous.continuityState?.summary ? previous.continuityState : working.continuityState)
    : null;
  const openLedger = working.ledger.filter((entry) => entry.status === 'open');
  const planningSkills = resolveNovelSkillContext(working, 'planning');
  const contextSkills = resolveNovelSkillContext(working, 'context');
  const structureSkills = resolveNovelSkillContext(working, 'structure');
  const writingSkills = resolveNovelSkillContext(working, 'writing');
  const reviewSkills = resolveNovelSkillContext(working, 'review');
  const memorySkills = resolveNovelSkillContext(working, 'memory');
  const appConfig = loadConfig();
  const reviewCandidate = resolveTextModelConfig(appConfig, 'review', { projectId: working.id, operation: 'novel-chapter-review' });
  const qaCandidate = resolveTextModelConfig(appConfig, 'qa', { projectId: working.id, operation: 'novel-chapter-memory' });
  const hasUsableKey = (candidate) => [candidate, ...(candidate?.__fallbacks || [])].some((item) => Boolean(item?.apiKey));
  const reviewCfg = hasUsableKey(reviewCandidate) ? reviewCandidate : cfg;
  const qaCfg = hasUsableKey(qaCandidate) ? qaCandidate : cfg;
  const runId = `chapter-${order}-${Date.now()}`;
  let generationTrace = { mode: 'single-writer', variantCount: 1, scores: [], selectedVariant: 1, generatedAt: new Date().toISOString() };

  working = checkpointChapterPipeline(working, chapter.id, {
    status: 'planned', runId, intent: null, context: null, architecture: null,
    audit: null, postAudit: null, draftContent: '', normalizedContent: '', error: '',
  });

  send('progress', { text: `第${order}章规划师 · 生成章节意图书…`, percentage: pct(6) });
  const intentRaw = await chatComplete(cfg, buildChapterIntentMessages({
    draft: working, chapter, previousChapterTail: previousTail, previousContinuity,
    rollingSummary: working.rollingSummary, openLedger, skillContext: planningSkills.text,
  }), { temperature: 0.3, maxTokens: Math.min(maxTokens(cfg, 6000), 6000), allowTruncated: false, signal });
  const chapterIntent = extractJsonObject(intentRaw);
  working = checkpointChapterPipeline(working, chapter.id, { status: 'planned', intent: chapterIntent });

  send('progress', { text: `第${order}章上下文构造师 · 精选人物、伏笔与规则…`, percentage: pct(12) });
  const contextRaw = await chatComplete(qaCfg, buildChapterContextMessages({
    draft: working, chapter, chapterIntent, rollingSummary: working.rollingSummary,
    openLedger, characterStates: working.characterStates, previousContinuity, skillContext: contextSkills.text,
  }), { temperature: 0.15, maxTokens: Math.min(maxTokens(qaCfg, 7000), 7000), allowTruncated: false, signal });
  const contextPlan = extractJsonObject(contextRaw);
  working = checkpointChapterPipeline(working, chapter.id, { status: 'composed', context: contextPlan });

  send('progress', { text: `第${order}章结构师 · 拆解场景 beats…`, percentage: pct(18) });
  const architectureRaw = await chatComplete(cfg, buildChapterArchitectureMessages({
    draft: working, chapter, chapterIntent, contextPlan, previousChapterTail: previousTail, skillContext: structureSkills.text,
  }), { temperature: 0.35, maxTokens: Math.min(maxTokens(cfg, 8000), 8000), allowTruncated: false, signal });
  const architecture = extractJsonObject(architectureRaw);
  working = checkpointChapterPipeline(working, chapter.id, { status: 'architected', architecture });

  send('progress', { text: `第${order}章写作师 · 正在生成正文…`, percentage: pct(24) });
  let initial = '';
  if (working.features?.multiWriter?.enabled) {
    const competition = await generateMultiWriterDraft({
      cfg, reviewCfg, draft: working, chapter, volume, previous, previousContinuity, openLedger,
      chapterIntent, contextPlan, architecture, signal, skillContext: writingSkills.text, send, pct,
    });
    initial = competition.content;
    generationTrace = competition.trace;
  } else {
    await chatCompleteStream(cfg, buildChapterDraftMessages({
      draft: working, chapter, volume, previousChapterTail: previousTail, previousContinuity,
      rollingSummary: working.rollingSummary, openLedger, characterStates: working.characterStates,
      chapterIntent, contextPlan, architecture, skillContext: writingSkills.text,
    }), {
      temperature: 0.75, maxTokens: maxTokens(cfg, 16000), signal,
      onDelta: (text) => {
        initial += text;
        send('delta', { text });
        send('progress', { text: `第${order}章写作师 · 已写 ${countWords(initial)} 字`, percentage: pct(24 + Math.min(25, countWords(initial) / 100)) });
      },
    });
  }
  initial = initial.trim();
  if (!initial) throw new Error('写作师没有返回正文');
  working = checkpointChapterPipeline(working, chapter.id, { status: 'drafted', draftContent: initial }, {
    generationTrace: {
      ...generationTrace,
      appliedSkills: writingSkills.skills,
    },
  });

  let normalizedContent = initial;
  const initialWords = countWords(initial);
  if (initialWords < 2200 || initialWords > 3000) {
    send('progress', { text: `第${order}章润色师 · 字数归一与自然化…`, percentage: pct(54) });
    normalizedContent = String(await chatComplete(reviewCfg, buildChapterNormalizeMessages({
      draft: working, chapter, content: initial, skillContext: reviewSkills.text,
    }), { temperature: 0.35, maxTokens: maxTokens(reviewCfg, 16000), allowTruncated: false, signal }) || '').trim() || initial;
    send('reset', { reason: 'normalize' });
    send('delta', { text: normalizedContent });
  }
  working = checkpointChapterPipeline(working, chapter.id, { status: 'normalized', normalizedContent });

  send('progress', { text: `第${order}章审计师 · 检查连续性与硬约束…`, percentage: pct(64) });
  const auditRaw = await chatComplete(reviewCfg, buildChapterAuditMessages({
    draft: working, chapter, content: normalizedContent, contextPlan,
    previousChapterTail: previousTail, previousContinuity, skillContext: reviewSkills.text,
  }), { temperature: 0.12, maxTokens: Math.min(maxTokens(reviewCfg, 7000), 7000), allowTruncated: false, signal });
  const audit = extractJsonObject(auditRaw);
  working = checkpointChapterPipeline(working, chapter.id, { status: 'audited', audit });

  let finalContent = normalizedContent;
  let postAudit = null;
  const critical = (Array.isArray(audit.violations) ? audit.violations : []).some((item) => item?.severity === 'critical');
  if (critical) {
    send('progress', { text: `第${order}章修订师 · 修复关键问题…`, percentage: pct(72) });
    send('reset', { reason: 'repair' });
    let repaired = '';
    await chatCompleteStream(reviewCfg, buildQualityRepairMessages({
      draft: working, chapter, content: normalizedContent, previousChapterTail: previousTail,
      previousContinuity, auditReport: audit, skillContext: reviewSkills.text,
    }), {
      temperature: 0.4, maxTokens: maxTokens(reviewCfg, 16000), signal,
      onDelta: (text) => { repaired += text; send('delta', { text }); },
    });
    finalContent = repaired.trim() || normalizedContent;
    working = checkpointChapterPipeline(working, chapter.id, { status: 'revised', normalizedContent: finalContent });
    const postAuditRaw = await chatComplete(reviewCfg, buildChapterAuditMessages({
      draft: working, chapter, content: finalContent, contextPlan,
      previousChapterTail: previousTail, previousContinuity, skillContext: reviewSkills.text,
    }), { temperature: 0.1, maxTokens: Math.min(maxTokens(reviewCfg, 7000), 7000), allowTruncated: false, signal });
    postAudit = extractJsonObject(postAuditRaw);
    working = checkpointChapterPipeline(working, chapter.id, { postAudit });
  }

  send('progress', { text: `第${order}章观察师 · 提取事实与伏笔变化…`, percentage: pct(84) });
  let record = {};
  try {
    const raw = await chatComplete(qaCfg, buildContinuityMessages({
      draft: working, chapter, content: finalContent, openLedger, skillContext: memorySkills.text,
    }), { temperature: 0.15, maxTokens: Math.min(maxTokens(qaCfg, 6000), 6000), allowTruncated: true, signal });
    record = extractJsonObject(raw);
  } catch (error) {
    if (signal?.aborted) throw error;
    record = { digest: finalContent.slice(-300), unresolvedHook: finalContent.slice(-200) };
  }
  const continuity = normalizeContinuityState({ ...record, summary: record.digest || record.summary || '' });
  const contentVersion = Math.max(1, Number(chapter.contentVersion) || 0) + (chapter.content === finalContent ? 0 : 1);
  const appliedSkills = [...planningSkills.skills, ...contextSkills.skills, ...structureSkills.skills, ...writingSkills.skills, ...reviewSkills.skills, ...memorySkills.skills]
    .filter((skill, index, list) => list.findIndex((item) => item.id === skill.id) === index);
  const updatedChapter = {
    ...chapter,
    content: finalContent,
    contentVersion,
    memoryVersion: contentVersion,
    memoryStale: false,
    memoryRecord: record,
    continuityState: continuity,
    generationTrace: { ...generationTrace, appliedSkills },
    pipeline: {
      ...(working.chapters.find((item) => item.id === chapter.id)?.pipeline || {}),
      status: 'memorized', intent: chapterIntent, context: contextPlan, architecture,
      audit, postAudit, draftContent: '', normalizedContent: '', error: '', updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  const rewroteExisting = Boolean(chapter.content);
  const chapters = working.chapters.map((item) => {
    if (item.order === order) return updatedChapter;
    if (rewroteExisting && item.content && item.order > order) return { ...item, memoryStale: true };
    return item;
  });
  const rollingSummary = await appendChapterDigest(qaCfg, working, updatedChapter, continuity.summary, signal);
  let saved = saveNovelDraft({
    ...working,
    chapters,
    ledger: mergeLedger(working, updatedChapter, record),
    characterStates: mergeCharacterStates(working, record.characterStates),
    rollingSummary,
    continuityState: continuity,
    memoryDirtyFrom: rewroteExisting
      ? (working.memoryDirtyFrom ? Math.min(working.memoryDirtyFrom, order) : order)
      : working.memoryDirtyFrom,
  });

  if (order % 5 === 0) {
    send('progress', { text: `第${order}章 Radar · 扫描阶段性风险…`, percentage: pct(94) });
    try {
      const radarSkills = resolveNovelSkillContext(saved, 'radar');
      const radarRaw = await chatComplete(reviewCfg, buildNovelRadarMessages({
        draft: saved, currentChapter: order, skillContext: radarSkills.text,
      }), { temperature: 0.15, maxTokens: Math.min(maxTokens(reviewCfg, 6000), 6000), allowTruncated: true, signal });
      const radar = extractJsonObject(radarRaw);
      saved = saveNovelDraft({ ...saved, radarReports: [...(saved.radarReports || []), { ...radar, createdAt: new Date().toISOString() }].slice(-30) });
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  saved = checkpointChapterPipeline(saved, chapter.id, { status: 'done' });
  const completedChapter = saved.chapters.find((item) => item.id === chapter.id) || updatedChapter;
  send('progress', { text: `第${order}章已完成（${countWords(finalContent)} 字）`, percentage: pct(100) });
  return { draft: saved, chapter: normalizeNovelChapter(completedChapter) };
}

function novelQualityReport(draft) {
  const issues = [];
  const push = (severity, category, code, title, message, chapterOrder = 0) => {
    issues.push({ severity, category, code, title, message, chapterOrder });
  };
  const written = draft.chapters.filter((chapter) => chapter.content).sort((a, b) => a.order - b.order);
  if (!draft.blueprint) push('error', 'structure', 'missing-blueprint', '缺少故事蓝图', '后续规划缺少全书锚点。');
  if (!draft.chapters.length) push('warning', 'structure', 'missing-chapters', '尚无章节卡', '需要先规划第一卷章节。');
  if (draft.memoryDirtyFrom) {
    push('error', 'continuity', 'memory-stale', '连续性记忆已失效', `从第${draft.memoryDirtyFrom}章起需要重建人物、伏笔和前文概要。`, draft.memoryDirtyFrom);
  }
  const orders = new Set(draft.chapters.map((chapter) => chapter.order));
  for (let order = 1; order <= Math.max(0, ...orders); order += 1) {
    if (!orders.has(order)) push('error', 'structure', 'chapter-gap', `缺少第${order}章卡片`, '章节序号不连续。', order);
  }
  const titleOrders = new Map();
  for (const chapter of draft.chapters) {
    if (chapter.pipeline?.status === 'error') push('error', 'pipeline', 'chapter-pipeline-error', `第${chapter.order}章流程中断`, chapter.pipeline.error || '请重试本章生成流程。', chapter.order);
    const finalAudit = chapter.pipeline?.postAudit || chapter.pipeline?.audit;
    const criticalViolations = (Array.isArray(finalAudit?.violations) ? finalAudit.violations : []).filter((item) => item?.severity === 'critical');
    if (criticalViolations.length) push('error', 'review', 'chapter-critical-audit', `第${chapter.order}章仍有关键问题`, criticalViolations.map((item) => item.description).filter(Boolean).join('；').slice(0, 320), chapter.order);
    if (chapter.memoryStale) push('error', 'continuity', 'chapter-memory-stale', `第${chapter.order}章记忆待重建`, '正文版本与场记版本不一致。', chapter.order);
    if (chapter.content && chapter.wordCount < 1800) push('warning', 'pacing', 'chapter-short', `第${chapter.order}章篇幅偏短`, `当前 ${chapter.wordCount} 字，建议补足关键过程和情绪。`, chapter.order);
    if (chapter.wordCount > 3600) push('warning', 'pacing', 'chapter-long', `第${chapter.order}章篇幅偏长`, `当前 ${chapter.wordCount} 字，建议检查节奏和重复段落。`, chapter.order);
    if (chapter.content && !chapter.continuityState?.summary) push('warning', 'continuity', 'missing-record', `第${chapter.order}章缺少场记`, '下一章续写可能无法准确承接。', chapter.order);
    const title = String(chapter.title || '').trim();
    if (title && titleOrders.has(title)) push('warning', 'structure', 'duplicate-title', `章节标题重复：${title}`, `与第${titleOrders.get(title)}章标题相同。`, chapter.order);
    else if (title) titleOrders.set(title, chapter.order);
  }
  const lastWritten = written.at(-1)?.order || 0;
  for (const entry of draft.ledger.filter((item) => item.status === 'open')) {
    if (entry.dueChapter > 0 && entry.dueChapter <= lastWritten) {
      push('warning', 'foreshadow', 'overdue-foreshadow', `伏笔已逾期：${entry.content}`, `计划在第${entry.dueChapter}章前回收。`, entry.dueChapter);
    }
  }
  const names = new Set();
  for (const character of draft.blueprint?.mainCharacters || []) {
    const name = String(character?.name || '').trim();
    if (!name) push('warning', 'character', 'unnamed-character', '存在未命名人物', '请补充人物姓名。');
    else if (names.has(name)) push('warning', 'character', 'duplicate-character', `人物重复：${name}`, '请合并重复人物档案。');
    else names.add(name);
  }
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === 'error' ? 12 : 5), 0);
  return {
    generatedAt: new Date().toISOString(),
    score: Math.max(0, 100 - penalty),
    metrics: {
      chaptersPlanned: draft.chapters.length,
      chaptersWritten: written.length,
      wordsWritten: written.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      openForeshadow: draft.ledger.filter((entry) => entry.status === 'open').length,
      staleChapters: draft.chapters.filter((chapter) => chapter.memoryStale).length,
    },
    issues,
  };
}

async function rebuildNovelMemory(cfg, draft, { signal, emit = () => {} } = {}) {
  let working = { ...draft, ledger: [], characterStates: [], rollingSummary: '', continuityState: normalizeContinuityState({}) };
  const chapters = [...draft.chapters];
  const written = chapters.filter((chapter) => chapter.content).sort((a, b) => a.order - b.order);
  for (let index = 0; index < written.length; index += 1) {
    if (signal?.aborted) throw signal.reason || new Error('重建已取消');
    const chapter = written[index];
    emit('progress', { text: `正在重建第${chapter.order}章场记…`, percentage: clampPct((index / Math.max(1, written.length)) * 100) });
    let record = chapter.memoryRecord;
    if (!record || chapter.memoryStale || chapter.memoryVersion !== chapter.contentVersion) {
      const memorySkills = resolveNovelSkillContext(working, 'memory');
      const raw = await chatComplete(cfg, buildContinuityMessages({
        draft: working,
        chapter,
        content: chapter.content,
        openLedger: working.ledger.filter((entry) => entry.status === 'open'),
        skillContext: memorySkills.text,
      }), { temperature: 0.2, maxTokens: Math.min(maxTokens(cfg, 6000), 6000), allowTruncated: true, signal });
      record = extractJsonObject(raw);
    }
    const continuity = normalizeContinuityState({ ...record, summary: record.digest || record.summary || '' });
    const updated = {
      ...chapter,
      memoryRecord: record,
      memoryVersion: chapter.contentVersion,
      memoryStale: false,
      continuityState: continuity,
    };
    const chapterIndex = chapters.findIndex((item) => item.id === chapter.id);
    chapters[chapterIndex] = updated;
    working = {
      ...working,
      chapters,
      ledger: mergeLedger(working, updated, record),
      characterStates: mergeCharacterStates(working, record.characterStates),
      rollingSummary: await appendChapterDigest(cfg, working, updated, continuity.summary, signal),
      continuityState: continuity,
    };
    saveNovelDraft({ ...working, memoryDirtyFrom: chapter.order });
  }
  return saveNovelDraft({ ...working, chapters, memoryDirtyFrom: 0 });
}

function novelJobId() {
  return `novel-write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function registerNovelJob(jobId, request) {
  registerJobActions(jobId, {
    cancel: async () => novelJobControllers.get(jobId)?.abort(new Error('用户停止连写')),
    retry: async () => startNovelJob(request, jobId),
  });
}

async function runNovelJob(jobId, request, controller) {
  const draftId = String(request.id || '');
  try {
    const cfg = requireTextConfig('novel', { projectId: draftId, operation: 'novel-writing' });
    let draft = getNovelDraft(draftId);
    if (!draft) throw new Error('作品不存在，请先创建');
    if (draft.memoryDirtyFrom) throw new Error(`第${draft.memoryDirtyFrom}章起的连续性记忆待重建，请先完成重建`);
    const total = Math.max(1, Math.min(100, Number(request.count) || 1));
    let processed = Math.max(0, Number(getJob(jobId)?.processed) || 0);
    for (let index = processed; index < total; index += 1) {
      if (controller.signal.aborted || isJobCancellationRequested(jobId)) throw controller.signal.reason || new Error('任务已取消');
      const order = index === 0 && Number(request.chapterOrder) > 0 ? Number(request.chapterOrder) : nextChapterOrder(draft);
      if (order > draft.chaptersTotal && !(index === 0 && Number(request.chapterOrder) > 0)) break;
      let preview = '';
      const result = await generateOneChapter({
        cfg,
        draft,
        order,
        signal: controller.signal,
        progress: { base: (index / total) * 100, span: 100 / total },
        emit(event, data) {
          if (event === 'reset') preview = '';
          if (event === 'delta') preview = `${preview}${data.text || ''}`.slice(-16000);
          if (event === 'progress' || event === 'delta') {
            setJob(jobId, {
              status: 'running', currentOrder: order, preview,
              progress: event === 'progress' ? data.percentage : getJob(jobId)?.progress,
              message: event === 'progress' ? data.text : getJob(jobId)?.message,
            });
          }
        },
      });
      draft = result.draft;
      processed = index + 1;
      setJob(jobId, {
        status: 'running', processed, currentOrder: order, preview: result.chapter.content,
        progress: clampPct((processed / total) * 100), message: `第${order}章已保存`,
      });
    }
    setJob(jobId, { status: 'done', processed, progress: 100, message: `连写完成，共完成 ${processed} 章`, preview: '' });
  } catch (error) {
    const cancelled = controller.signal.aborted || isJobCancellationRequested(jobId);
    if (!cancelled) {
      try {
        const failedDraft = getNovelDraft(draftId);
        const failedOrder = Number(getJob(jobId)?.currentOrder) || 0;
        const failedChapter = failedDraft?.chapters.find((chapter) => chapter.order === failedOrder);
        if (failedDraft && failedChapter) {
          const chapters = failedDraft.chapters.map((chapter) => chapter.id === failedChapter.id
            ? { ...chapter, pipeline: { ...(chapter.pipeline || {}), status: 'error', error: error.message, updatedAt: new Date().toISOString() } }
            : chapter);
          saveNovelDraft({ ...failedDraft, chapters });
        }
      } catch { /* 失败状态落盘不覆盖原始异常 */ }
    }
    setJob(jobId, {
      status: cancelled ? 'cancelled' : 'error',
      error: cancelled ? '' : error.message,
      message: cancelled ? '已停笔，已完成章节均已保存' : error.message,
      preview: '',
    });
  } finally {
    novelJobControllers.delete(jobId);
    if (activeNovelJobs.get(draftId) === jobId) activeNovelJobs.delete(draftId);
  }
}

function startNovelJob(request, requestedJobId = '') {
  const draftId = String(request.id || '').trim();
  if (!draftId) throw new Error('作品 id 不能为空');
  const activeId = activeNovelJobs.get(draftId);
  if (activeId && activeId !== requestedJobId) throw new Error('这部作品已有连写任务正在执行');
  const jobId = requestedJobId || novelJobId();
  const controller = new AbortController();
  novelJobControllers.set(jobId, controller);
  activeNovelJobs.set(draftId, jobId);
  setJob(jobId, {
    phase: 'novel-writing', type: 'novel', title: `小说连写 · ${getNovelDraft(draftId)?.title || draftId}`,
    projectId: draftId, status: 'queued', total: Math.max(1, Number(request.count) || 1),
    processed: Math.max(0, Number(getJob(jobId)?.processed) || 0), progress: 0,
    request: { ...request, id: draftId }, message: '准备连写…', error: '',
  });
  registerNovelJob(jobId, { ...request, id: draftId });
  void runNovelJob(jobId, { ...request, id: draftId }, controller);
  return { id: jobId, ...getJob(jobId) };
}

for (const job of listJobs().filter((item) => item.phase === 'novel-writing' && item.request)) {
  registerNovelJob(job.id, job.request);
}

// ---------- 路由 ----------
export async function handleNovelRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if (p === '/api/novel/bootstrap' && method === 'POST') {
    const body = await readBody(req);
    const draft = saveNovelDraft({
      title: '未命名小说',
      writingPurpose: body.writingPurpose,
      subplotPolicy: body.subplotPolicy,
      targetPlatforms: body.targetPlatforms,
      channel: body.channel,
      features: { multiWriter: { enabled: false, variants: 3, reviewMode: 'score-and-merge' } },
      chapterTargetWords: 2500,
      chapterTargetWordsConfirmed: false,
      totalTargetWords: 0,
      chapters: [],
      volumes: [],
      ledger: [],
      radarReports: [],
    });
    const chat = loadNovelChat(draft.id, draft);
    return sendJson(res, 201, {
      ok: true,
      draft: { ...draftShell(draft), coverUrl: coverUrlFor(draft) },
      chat,
    });
  }

  if (p === '/api/novel/drafts' && method === 'GET') {
    return sendJson(res, 200, {
      drafts: listNovelDrafts().map((item) => ({ ...item, coverUrl: coverUrlFor(item) })),
    });
  }

  if (p === '/api/novel/draft' && method === 'GET') {
    const draft = getNovelDraft(url?.searchParams?.get('id'));
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    return sendJson(res, 200, { draft: { ...draftShell(draft), coverUrl: coverUrlFor(draft) } });
  }

  if (p === '/api/novel/market/rankings' && method === 'GET') {
    try {
      const source = String(url?.searchParams?.get('source') || 'fanqie');
      const refresh = url?.searchParams?.get('refresh') === '1';
      const limit = Math.max(5, Math.min(30, Number(url?.searchParams?.get('limit')) || 12));
      const ranking = await getNovelMarketRanking(source, { refresh, limit });
      return sendJson(res, 200, { ok: true, ranking });
    } catch (error) {
      return sendJson(res, 502, { error: `公开榜单读取失败：${error.message}` });
    }
  }

  if (p === '/api/novel/market/sources' && method === 'GET') {
    return sendJson(res, 200, { ok: true, sources: listNovelMarketSources() });
  }

  if (p === '/api/novel/market/studies' && method === 'GET') {
    const novelId = String(url?.searchParams?.get('id') || '');
    return sendJson(res, 200, { ok: true, studies: listNovelMarketStudies(novelId) });
  }

  if (p === '/api/novel/market/study' && method === 'POST') {
    try {
      const body = await readBody(req);
      const draft = getNovelDraft(body.id);
      if (!draft) return sendJson(res, 404, { error: '作品不存在' });
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20);
      const sampleText = String(body.sampleText || '').trim().slice(0, 30000);
      if (!items.length && !sampleText) return sendJson(res, 400, { error: '请至少选择一个榜单样本或粘贴拆书样本' });
      let analysis = fallbackMarketStudy(items);
      const appConfig = loadConfig();
      if (hasTextModelKey(appConfig, 'agent')) {
        const cfg = resolveTextModelConfig(appConfig, 'agent', { projectId: draft.id, operation: 'novel-market-study' });
        const raw = await chatComplete(cfg, buildNovelMarketStudyMessages({
          draft,
          items,
          sampleText,
          instruction: body.instruction,
        }), {
          temperature: 0.2,
          maxTokens: Math.min(maxTokens(cfg, 10000), 10000),
          allowTruncated: true,
        });
        analysis = extractJsonObject(raw);
      }
      const study = saveNovelMarketStudy({ novelId: draft.id, sourceItems: items, analysis });
      const saved = saveNovelDraft({
        ...draft,
        marketContext: {
          ...(draft.marketContext || {}),
          studyIds: [study.id, ...(draft.marketContext?.studyIds || [])],
          references: items,
          promptDigest: String(analysis.promptDigest || analysis.summary || '').trim(),
          updatedAt: new Date().toISOString(),
        },
      });
      return sendJson(res, 200, {
        ok: true,
        study,
        draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) },
      });
    } catch (error) {
      return sendJson(res, 400, { error: `拆书分析失败：${error.message}` });
    }
  }

  if (p === '/api/novel/market/package' && method === 'POST') {
    try {
      const body = await readBody(req);
      const draft = getNovelDraft(body.id);
      if (!draft) return sendJson(res, 404, { error: '作品不存在' });
      const cfg = requireTextConfig('agent', { projectId: draft.id, operation: 'novel-packaging-lab' });
      const marketDigest = String(draft.marketContext?.promptDigest || '').trim();
      const candidateRaw = await chatComplete(cfg, buildNovelPackagingCandidateMessages(draft, marketDigest), {
        temperature: 0.82,
        maxTokens: Math.min(maxTokens(cfg, 12000), 12000),
        allowTruncated: true,
      });
      const candidates = extractJsonObject(candidateRaw);
      const reviewRaw = await chatComplete(cfg, buildNovelPackagingReviewMessages(draft, candidates, marketDigest), {
        temperature: 0.28,
        maxTokens: Math.min(maxTokens(cfg, 10000), 10000),
        allowTruncated: true,
      });
      const reviewed = extractJsonObject(reviewRaw);
      const packagingLab = normalizeNovelPackagingLab({ ...reviewed, generatedAt: new Date().toISOString() });
      if (!packagingLab?.titles.length || !packagingLab?.intros.length) {
        throw new Error('总编评审没有返回可用的标题和简介，请重新生成');
      }
      const saved = saveNovelDraft({ ...draft, packagingLab });
      return sendJson(res, 200, {
        ok: true,
        packagingLab: saved.packagingLab,
        draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) },
      });
    } catch (error) {
      return sendJson(res, 400, { error: `标题简介生成失败：${error.message}` });
    }
  }

  if (p === '/api/novel/market/package/apply' && method === 'POST') {
    const body = await readBody(req);
    const draft = getNovelDraft(body.id);
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    const titles = draft.packagingLab?.titles || [];
    const intros = draft.packagingLab?.intros || [];
    const selectedTitle = titles.find((item) => item.id === body.titleId);
    const selectedIntro = intros.find((item) => item.id === body.introId);
    if (!selectedTitle && !selectedIntro) return sendJson(res, 400, { error: '请选择标题或简介' });
    const saved = saveNovelDraft({
      ...draft,
      title: selectedTitle?.title || draft.title,
      intro: selectedIntro?.text || draft.intro,
      packagingLab: {
        ...draft.packagingLab,
        recommendedTitleId: selectedTitle?.id || draft.packagingLab?.recommendedTitleId,
        recommendedIntroId: selectedIntro?.id || draft.packagingLab?.recommendedIntroId,
      },
    });
    return sendJson(res, 200, { ok: true, draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) } });
  }

  if (p === '/api/novel/skills' && method === 'GET') {
    return sendJson(res, 200, { ok: true, skills: listNovelSkills().map(publicNovelSkill) });
  }

  if (p === '/api/novel/skills/analyze' && method === 'POST') {
    try {
      const body = await readBody(req);
      const snapshot = await analyzeGitHubNovelSkills(body.url);
      let ai = null;
      const appConfig = loadConfig();
      if (hasTextModelKey(appConfig, 'agent')) {
        try {
          const cfg = resolveTextModelConfig(appConfig, 'agent', { operation: 'novel-skill-analysis' });
          const raw = await chatComplete(cfg, buildNovelSkillAnalysisMessages(snapshot), {
            temperature: 0.15,
            maxTokens: Math.min(maxTokens(cfg, 5000), 5000),
            allowTruncated: true,
          });
          ai = extractJsonObject(raw);
        } catch { /* 静态分析结果仍可正常使用 */ }
      }
      const { analysisInput, ...analysis } = snapshot;
      analysis.candidates = analysis.candidates.map(({ excerpt, ...candidate }) => candidate);
      return sendJson(res, 200, { ok: true, analysis: { ...analysis, ai } });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (p === '/api/novel/skills/install' && method === 'POST') {
    try {
      const body = await readBody(req);
      const skill = await installGitHubNovelSkill({
        url: body.url,
        candidatePath: body.candidatePath,
        enabled: true,
      });
      let saved = null;
      const draft = body.novelId ? getNovelDraft(body.novelId) : null;
      if (draft) {
        saved = saveNovelDraft({
          ...draft,
          skillConfig: {
            ...draft.skillConfig,
            skillIds: [...new Set([...(draft.skillConfig?.skillIds || []), skill.id])],
          },
        });
      }
      return sendJson(res, 200, {
        ok: true,
        skill: publicNovelSkill(skill),
        draft: saved ? { ...draftShell(saved), coverUrl: coverUrlFor(saved) } : null,
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (p === '/api/novel/skills/toggle' && method === 'POST') {
    const body = await readBody(req);
    const skill = setNovelSkillEnabled(body.id, body.enabled === true);
    if (!skill) return sendJson(res, 404, { error: 'Skill 不存在' });
    return sendJson(res, 200, { ok: true, skill: publicNovelSkill(skill) });
  }

  if (p === '/api/novel/skills/delete' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { ok: removeNovelSkill(body.id) });
  }

  if (p === '/api/novel/features/save' && method === 'POST') {
    const body = await readBody(req);
    const draft = getNovelDraft(body.id);
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    const saved = saveNovelDraft({
      ...draft,
      features: body.features !== undefined ? body.features : draft.features,
      skillConfig: body.skillConfig !== undefined ? body.skillConfig : draft.skillConfig,
    });
    return sendJson(res, 200, { ok: true, draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) } });
  }

  if (p === '/api/novel/chat' && method === 'GET') {
    const draft = getNovelDraft(url?.searchParams?.get('id'));
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    return sendJson(res, 200, { ok: true, chat: loadNovelChat(draft.id, draft), setup: novelSetupState(draft) });
  }

  if (p === '/api/novel/chat/session' && method === 'POST') {
    try {
      const body = await readBody(req);
      const draft = getNovelDraft(body.id);
      if (!draft) return sendJson(res, 404, { error: '作品不存在' });
      const chat = mutateNovelChatSession(draft.id, String(body.operation || ''), body, draft);
      return sendJson(res, 200, { ok: true, chat });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (p === '/api/novel/chat/queue' && method === 'POST') {
    try {
      const body = await readBody(req);
      const draft = getNovelDraft(body.id);
      if (!draft) return sendJson(res, 404, { error: '作品不存在' });
      const chat = mutateNovelChatQueue(draft.id, String(body.operation || ''), body, draft);
      return sendJson(res, 200, { ok: true, chat });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (p === '/api/novel/chat/plan' && method === 'POST') {
    const body = await readBody(req);
    const draft = getNovelDraft(body.id);
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    const instruction = String(body.instruction || '').trim();
    if (!instruction) return sendJson(res, 400, { error: '请输入创作指令' });
    const before = loadNovelChat(draft.id, draft);
    const sessionId = String(body.sessionId || before.activeSessionId || '');
    const webSearchEnabled = body.webSearch === true;
    const userMessage = appendNovelChatMessage(draft.id, {
      role: 'user', content: instruction, webSearch: webSearchEnabled,
    }, { sessionId, draft });
    let webResearch = null;
    if (webSearchEnabled) {
      try {
        const searchConfig = loadConfig();
        const searchModel = hasTextModelKey(searchConfig, 'agent')
          ? resolveTextModelConfig(searchConfig, 'agent', { projectId: draft.id, operation: 'novel-web-search-plan' })
          : null;
        const plannedQuery = await planWebSearchQuery(instruction, {
          complete: searchModel ? (messages, options) => chatComplete(searchModel, messages, options) : null,
        });
        webResearch = await searchWeb(plannedQuery, { limit: 6, fetchPages: 4 });
      } catch (error) {
        const assistantMessage = appendNovelChatMessage(draft.id, {
          role: 'assistant',
          content: `联网搜索失败：${error.message}`,
          webSearch: true,
          status: 'error',
        }, { sessionId, draft });
        return sendJson(res, 200, {
          ok: false, userMessage, assistantMessage,
          plan: { reply: assistantMessage.content, actions: [] },
          chat: loadNovelChat(draft.id, draft),
        });
      }
    }

    if (!novelSetupState(draft).complete) {
      let setupPlan = fallbackNovelSetupCoachPlan(draft, instruction);
      const appConfig = loadConfig();
      if (hasTextModelKey(appConfig, 'agent')) {
        try {
          const cfg = resolveTextModelConfig(appConfig, 'agent', { projectId: draft.id, operation: 'novel-setup-coach' });
          const raw = await chatComplete(cfg, buildNovelSetupCoachMessages({
            draft,
            instruction,
            history: before.messages,
            webResearch,
          }), {
            temperature: 0.28,
            maxTokens: Math.min(maxTokens(cfg, 7000), 7000),
            allowTruncated: false,
          });
          setupPlan = normalizeNovelSetupCoachPlan(extractJsonObject(raw), draft, instruction);
        } catch {
          setupPlan = fallbackNovelSetupCoachPlan(draft, instruction);
        }
      }
      const setupAnswer = applyNovelSetupCoachPlan(draft, setupPlan);
      const saved = saveNovelDraft({ ...draft, ...setupAnswer.patch });
      Object.assign(setupAnswer.assistantMessage, {
        webSearch: webSearchEnabled,
        webSearchQuery: webResearch?.query || '',
        webSearchProvider: webResearch?.provider || '',
        webSources: webResearch?.sources || [],
      });
      const assistantMessage = appendNovelChatMessage(draft.id, setupAnswer.assistantMessage, { sessionId, draft: saved });
      return sendJson(res, 200, {
        ok: true,
        userMessage,
        assistantMessage,
        plan: { reply: assistantMessage.content, actions: assistantMessage.actions, setup: setupPlan },
        draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) },
        chat: loadNovelChat(draft.id, saved),
      });
    }

    let plan = fallbackNovelChatPlan(instruction);
    const appConfig = loadConfig();
    if (hasTextModelKey(appConfig, 'agent')) {
      try {
        const cfg = resolveTextModelConfig(appConfig, 'agent', { projectId: draft.id, operation: 'novel-chat-plan' });
        const raw = await chatComplete(cfg, buildNovelChatPlanMessages({
          draft,
          instruction,
          history: before.messages,
          skills: listNovelSkills().map(publicNovelSkill),
          webResearch,
        }), {
          temperature: 0.12,
          maxTokens: Math.min(maxTokens(cfg, 5000), 5000),
          allowTruncated: false,
        });
        plan = normalizeNovelChatPlan(extractJsonObject(raw), instruction);
      } catch {
        plan = fallbackNovelChatPlan(instruction);
      }
    }
    const assistantMessage = appendNovelChatMessage(draft.id, {
      role: 'assistant',
      content: plan.reply,
      actions: plan.actions,
      webSearch: webSearchEnabled,
      webSearchQuery: webResearch?.query || '',
      webSearchProvider: webResearch?.provider || '',
      webSources: webResearch?.sources || [],
      status: plan.actions.length ? 'pending' : 'done',
    }, { sessionId, draft });
    return sendJson(res, 200, { ok: true, userMessage, assistantMessage, plan, chat: loadNovelChat(draft.id, draft) });
  }

  if (p === '/api/novel/chat/action-results' && method === 'POST') {
    const body = await readBody(req);
    const draft = getNovelDraft(body.id);
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    const message = updateNovelChatActionResults(draft.id, body.messageId, body.actionResults, {
      sessionId: body.sessionId,
      draft,
    });
    if (!message) return sendJson(res, 404, { error: '聊天消息不存在' });
    return sendJson(res, 200, { ok: true, message });
  }

  if (p === '/api/novel/chat/clear' && method === 'POST') {
    const body = await readBody(req);
    const draft = getNovelDraft(body.id);
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    return sendJson(res, 200, { ok: true, chat: clearNovelChat(draft.id, { sessionId: body.sessionId, draft }) });
  }

  if (p.startsWith('/api/novel/cover/') && method === 'GET') {
    const id = decodeURIComponent(p.slice('/api/novel/cover/'.length)).replace(/\.png$/i, '');
    const file = coverFilePath(id);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const data = await fs.promises.readFile(file);
    const download = url?.searchParams?.get('download') === '1';
    const draft = download ? getNovelDraft(id) : null;
    const title = String(draft?.title || '小说')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80) || '小说';
    const downloadHeaders = download ? {
      'Content-Disposition': `attachment; filename="novel-cover.png"; filename*=UTF-8''${encodeURIComponent(`${title}-封面.png`)}`,
    } : {};
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      ...downloadHeaders,
    });
    return res.end(data);
  }

  if (p === '/api/novel/chapter' && method === 'GET') {
    const draft = getNovelDraft(url?.searchParams?.get('id'));
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    const chapterId = String(url?.searchParams?.get('chapterId') || '').trim();
    const chapter = draft.chapters.find((item) => item.id === chapterId);
    if (!chapter) return sendJson(res, 404, { error: '章节不存在' });
    return sendJson(res, 200, { chapter });
  }

  if (p === '/api/novel/full' && method === 'GET') {
    const draft = getNovelDraft(url?.searchParams?.get('id'));
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    return sendJson(res, 200, { title: draft.title, intro: draft.intro, text: fullNovelText(draft) });
  }

  // 只更新简报字段与蓝图，不接受章节正文（正文走 chapter/save）
  if (p === '/api/novel/draft' && method === 'POST') {
    const body = await readBody(req);
    const existing = body.id ? getNovelDraft(body.id) : null;
    const { chapters, ledger, rollingSummary, characterStates, ...brief } = body;
    const saved = saveNovelDraft({ ...(existing || {}), ...brief, id: existing?.id || body.id });
    return sendJson(res, 200, { ok: true, draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) } });
  }

  if (p === '/api/novel/chapter/save' && method === 'POST') {
    const body = await readBody(req);
    const draft = getNovelDraft(body.id);
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    const chapterId = String(body.chapterId || '').trim();
    const current = draft.chapters.find((chapter) => chapter.id === chapterId);
    if (!current) return sendJson(res, 404, { error: '章节不存在' });
    const content = String(body.content || '').trim();
    const changed = current.content !== content;
    const contentVersion = changed ? Math.max(1, Number(current.contentVersion) || 0) + 1 : current.contentVersion;
    const chapters = draft.chapters.map((chapter) => {
      if (chapter.id === chapterId) {
        return {
          ...chapter,
          content,
          contentVersion,
          memoryStale: changed ? true : chapter.memoryStale,
          updatedAt: new Date().toISOString(),
        };
      }
      if (changed && chapter.content && chapter.order > current.order) return { ...chapter, memoryStale: true };
      return chapter;
    });
    if (!chapters.some((chapter) => chapter.id === chapterId)) return sendJson(res, 404, { error: '章节不存在' });
    const dirtyFrom = changed
      ? (draft.memoryDirtyFrom ? Math.min(draft.memoryDirtyFrom, current.order) : current.order)
      : draft.memoryDirtyFrom;
    const saved = saveNovelDraft({ ...draft, chapters, memoryDirtyFrom: dirtyFrom });
    return sendJson(res, 200, { ok: true, draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) } });
  }

  if (p === '/api/novel/structure/save' && method === 'POST') {
    const body = await readBody(req);
    const draft = getNovelDraft(body.id);
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    let chapters = draft.chapters;
    if (Array.isArray(body.chapters)) {
      const cards = new Map(body.chapters.map((chapter) => [String(chapter.id || ''), chapter]));
      chapters = draft.chapters.map((chapter) => {
        const card = cards.get(chapter.id);
        if (!card) return chapter;
        return {
          ...chapter,
          title: String(card.title || chapter.title).trim() || chapter.title,
          summary: String(card.summary || '').trim(),
          hook: String(card.hook || '').trim(),
          endingHook: String(card.endingHook || '').trim(),
          plant: Array.isArray(card.plant) ? card.plant : chapter.plant,
          resolve: Array.isArray(card.resolve) ? card.resolve : chapter.resolve,
        };
      });
    }
    const next = {
      ...draft,
      chapters,
      blueprint: body.blueprint !== undefined ? body.blueprint : draft.blueprint,
      ledger: Array.isArray(body.ledger)
        ? body.ledger.map((entry, index) => normalizeLedgerEntry(entry, index))
        : draft.ledger,
      characterStates: Array.isArray(body.characterStates)
        ? body.characterStates.map((state) => normalizeCharacterState(state)).filter((state) => state.name)
        : draft.characterStates,
    };
    const saved = saveNovelDraft(next);
    return sendJson(res, 200, { ok: true, draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) } });
  }

  if (p === '/api/novel/quality' && method === 'GET') {
    const draft = getNovelDraft(url?.searchParams?.get('id'));
    if (!draft) return sendJson(res, 404, { error: '作品不存在' });
    return sendJson(res, 200, { ok: true, report: novelQualityReport(draft) });
  }

  if (p === '/api/novel/memory/rebuild/stream' && method === 'POST') {
    const body = await readBody(req);
    const session = createSseSession(req, res);
    try {
      const draft = getNovelDraft(body.id);
      if (!draft) throw new Error('作品不存在');
      const cfg = requireTextConfig('novel', { projectId: draft.id, operation: 'novel-memory-rebuild' });
      const saved = await rebuildNovelMemory(cfg, draft, {
        signal: session.signal,
        emit: (event, data) => sseSend(res, event, data),
      });
      sseSend(res, 'progress', { text: '连续性记忆已重建', percentage: 100 });
      sseSend(res, 'done', { draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) } });
    } catch (error) {
      sseSend(res, 'error', { message: error.message });
    } finally {
      session.close();
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  if (p === '/api/novel/rewrite/stream' && method === 'POST') {
    const body = await readBody(req);
    const session = createSseSession(req, res);
    try {
      const draft = getNovelDraft(body.id);
      if (!draft) throw new Error('作品不存在');
      const chapter = draft.chapters.find((item) => item.id === String(body.chapterId || ''));
      if (!chapter) throw new Error('章节不存在');
      const selectedText = String(body.selectedText || '').trim();
      if (!selectedText) throw new Error('请先选择要改写的正文片段');
      if (selectedText.length > 12000) throw new Error('单次改写片段不能超过 12000 字');
      const cfg = requireTextConfig('novel', { projectId: draft.id, operation: 'novel-partial-rewrite' });
      const reviewSkills = resolveNovelSkillContext(draft, 'review');
      let text = '';
      await chatCompleteStream(cfg, buildPartialRewriteMessages({
        draft, chapter, selectedText, instruction: body.instruction, mode: body.mode, skillContext: reviewSkills.text,
      }), {
        temperature: 0.55,
        maxTokens: maxTokens(cfg, 12000),
        signal: session.signal,
        onDelta: (delta) => { text += delta; sseSend(res, 'delta', { text: delta }); },
      });
      sseSend(res, 'done', { text: text.trim() });
    } catch (error) {
      sseSend(res, 'error', { message: error.message });
    } finally {
      session.close();
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  if (p === '/api/novel/job/start' && method === 'POST') {
    try {
      const body = await readBody(req);
      const job = startNovelJob(body);
      return sendJson(res, 202, { ok: true, jobId: job.id, job });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (p === '/api/novel/job' && method === 'GET') {
    const jobId = String(url?.searchParams?.get('id') || '');
    const job = getJob(jobId);
    if (!job) return sendJson(res, 404, { error: '任务不存在' });
    return sendJson(res, 200, { ok: true, job: { id: jobId, ...job } });
  }

  if (p === '/api/novel/draft/delete' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { ok: deleteNovelDraft(body.id) });
  }

  // 对话式创建：一次完成作品包装 → 故事蓝图 → 第1卷章节卡
  if (p === '/api/novel/create/stream' && method === 'POST') {
    const body = await readBody(req);
    const session = createSseSession(req, res);
    try {
      const cfg = requireTextConfig();
      const existing = body.id ? getNovelDraft(body.id) : null;
      let draft = normalizeNovelDraft({
        ...(existing || {}),
        ...body,
        id: existing?.id || undefined,
        chaptersTotal: totalChaptersForWan(body.wordTargetWan ?? existing?.wordTargetWan),
        // 重新创建时清空写作状态
        blueprint: null,
        chapters: existing && body.keepChapters ? existing.chapters : [],
        volumes: [],
        ledger: [],
        rollingSummary: '',
        characterStates: [],
      });
      if (!draft.idea) throw new Error('请先输入你的故事想法');
      const planningSkills = resolveNovelSkillContext(draft, 'planning');

      sseSend(res, 'progress', { text: '正在打造爆款书名与简介…', percentage: 6 });
      const metaRaw = await chatComplete(cfg, buildMetadataMessages(draft, planningSkills.text), {
        temperature: 0.78,
        maxTokens: Math.min(maxTokens(cfg, 12000), 12000),
        allowTruncated: true,
        signal: session.signal,
      });
      let meta = extractJsonObject(metaRaw);
      let packagingLab = {
        titles: Array.isArray(meta.titles) ? meta.titles : [],
        intros: Array.isArray(meta.intros) ? meta.intros : [],
        recommendedTitleId: '',
        recommendedIntroId: '',
        auditSummary: '',
        generatedAt: new Date().toISOString(),
      };
      if (packagingLab.titles.length || packagingLab.intros.length) {
        try {
          sseSend(res, 'progress', { text: '独立总编正在淘汰机械标题与同质化简介…', percentage: 16 });
          const reviewRaw = await chatComplete(cfg, buildNovelPackagingReviewMessages(
            draft,
            { titles: packagingLab.titles, intros: packagingLab.intros },
            draft.marketContext?.promptDigest || '',
          ), {
            temperature: 0.25,
            maxTokens: Math.min(maxTokens(cfg, 10000), 10000),
            allowTruncated: true,
            signal: session.signal,
          });
          const reviewed = extractJsonObject(reviewRaw);
          packagingLab = { ...packagingLab, ...reviewed, generatedAt: new Date().toISOString() };
          const bestTitle = (reviewed.titles || []).find((item) => item.id === reviewed.recommendedTitleId) || reviewed.titles?.[0];
          const bestIntro = (reviewed.intros || []).find((item) => item.id === reviewed.recommendedIntroId) || reviewed.intros?.[0];
          meta = { ...meta, title: bestTitle?.title || meta.title, intro: bestIntro?.text || meta.intro };
        } catch {
          // 候选仍会保留到标题实验室，评审失败不阻塞全书规划。
        }
      }
      const hasChosenTitle = draft.title && !/^未命名(?:作品|小说)?$/.test(draft.title);
      draft = normalizeNovelDraft({
        ...draft,
        title: hasChosenTitle ? draft.title : (String(meta.title || draft.title || '').trim() || draft.title),
        intro: String(meta.intro || '').trim() || draft.intro,
        sellingPoints: Array.isArray(meta.sellingPoints) ? meta.sellingPoints : draft.sellingPoints,
        genre: draft.genre || String(meta.genre || '').trim(),
        coverPrompt: String(meta.coverPrompt || '').trim() || fallbackCoverPrompt(draft),
        packagingLab,
      });
      sseSend(res, 'meta', { title: draft.title, intro: draft.intro, sellingPoints: draft.sellingPoints, genre: draft.genre });

      sseSend(res, 'progress', { text: `《${draft.title}》正在构建故事蓝图（开局/结局/幕结构/伏笔计划）…`, percentage: 24 });
      let blueprintRaw = '';
      await chatCompleteStream(cfg, buildBlueprintMessages(draft, planningSkills.text), {
        temperature: 0.6,
        maxTokens: maxTokens(cfg, 20000),
        signal: session.signal,
        onDelta: (text) => {
          blueprintRaw += text;
          sseSend(res, 'progress', {
            text: `《${draft.title}》故事蓝图构建中 · ${blueprintRaw.length} 字…`,
            percentage: clampPct(24 + Math.min(46, blueprintRaw.length / 90)),
          });
        },
      });
      const blueprint = extractJsonObject(blueprintRaw);
      draft = saveNovelDraft({ ...draft, blueprint });

      sseSend(res, 'progress', { text: '正在规划第1卷章节…', percentage: 76 });
      try {
        draft = await ensureChapterCards(cfg, draft, 1, {
          signal: session.signal,
          onProgress: (text) => sseSend(res, 'progress', { text, percentage: 82 }),
        });
      } catch (error) {
        if (session.signal.aborted) throw error;
        // 第1卷规划失败不阻塞创建，首次写章时会重试
      }

      sseSend(res, 'progress', { text: `《${draft.title}》创建完成，可以开写了`, percentage: 100 });
      sseSend(res, 'done', { draft: { ...draftShell(draft), coverUrl: coverUrlFor(draft) } });
    } catch (e) {
      sseSend(res, 'error', { message: e.message });
    } finally {
      session.close();
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  // 续写：写 1 章或连写 N 章
  if (p === '/api/novel/chapter/stream' && method === 'POST') {
    const body = await readBody(req);
    const session = createSseSession(req, res);
    try {
      const cfg = requireTextConfig();
      let draft = getNovelDraft(body.id);
      if (!draft) throw new Error('作品不存在，请先创建');
      if (draft.memoryDirtyFrom) throw new Error(`第${draft.memoryDirtyFrom}章起的连续性记忆待重建，请先完成重建`);
      const count = Math.max(1, Math.min(100, Number(body.count) || 1));
      const explicitOrder = Number(body.chapterOrder) || 0;
      let written = 0;
      for (let i = 0; i < count; i += 1) {
        if (session.signal.aborted) break;
        const order = i === 0 && explicitOrder > 0 ? explicitOrder : nextChapterOrder(draft);
        if (order > draft.chaptersTotal && !(i === 0 && explicitOrder > 0)) {
          sseSend(res, 'progress', { text: `已写满目标 ${draft.chaptersTotal} 章，全书完`, percentage: 100 });
          break;
        }
        sseSend(res, 'reset', { reason: 'chapter', order });
        const result = await generateOneChapter({
          cfg,
          draft,
          order,
          res,
          signal: session.signal,
          progress: { base: (i / count) * 100, span: 100 / count },
        });
        draft = result.draft;
        written += 1;
        sseSend(res, 'chapter', {
          chapter: result.chapter,
          draft: { ...draftShell(draft), coverUrl: coverUrlFor(draft) },
          index: written,
          count,
        });
      }
      sseSend(res, 'done', { draft: { ...draftShell(draft), coverUrl: coverUrlFor(draft) }, written });
    } catch (e) {
      sseSend(res, 'error', { message: e.message });
    } finally {
      session.close();
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  if (p === '/api/novel/cover-capabilities' && method === 'GET') {
    return sendJson(res, 200, await novelCoverReferenceCapabilities());
  }

  if (p === '/api/cover/history' && method === 'GET') {
    return sendJson(res, 200, { ok: true, records: listStandaloneCoverHistory() });
  }

  if (p.startsWith('/api/cover/history/') && method === 'GET') {
    const id = decodeURIComponent(p.slice('/api/cover/history/'.length)).replace(/\.png$/i, '');
    const file = standaloneCoverHistoryImagePath(id);
    if (!file) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const data = await fs.promises.readFile(file);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    return res.end(data);
  }

  if (p === '/api/cover/history/delete' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { ok: deleteStandaloneCoverHistory(body.id) });
  }

  if (p === '/api/cover/history/clear' && method === 'POST') {
    return sendJson(res, 200, { ok: true, deleted: clearStandaloneCoverHistory() });
  }

  if (p === '/api/cover/generate' && method === 'POST') {
    const body = await readBody(req);
    try {
      const cfg = requireImageConfig();
      const ratio = normalizeNovelCoverRatio(body.ratio);
      const capabilities = await novelCoverReferenceCapabilities(cfg);
      const references = normalizeNovelCoverReferences(body.referenceImages, { limit: capabilities.maxReferenceImages });
      const prompt = buildStandaloneCoverPrompt({
        title: body.title,
        genre: body.genre,
        storyIdea: body.storyIdea,
        ratio,
        references,
      });
      const { b64 } = await generateConfiguredImage(cfg, prompt, {
        ratio,
        referenceImages: references.map((item) => item.b64),
        usageContext: { operation: 'standalone-cover', currency: cfg.costTracking?.currency || 'CNY' },
      });
      const history = saveStandaloneCoverHistory({
        b64,
        title: body.title,
        genre: body.genre,
        storyIdea: body.storyIdea,
        ratio,
        referencesUsed: references.length,
        prompt,
      });
      return sendJson(res, 200, {
        ok: true,
        ratio,
        referencesUsed: references.length,
        prompt,
        imageDataUrl: `data:image/png;base64,${b64}`,
        history,
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 封面：使用作品封面提示词和用户选择的画面比例
  if (p === '/api/novel/cover' && method === 'POST') {
    const body = await readBody(req);
    try {
      const draft = getNovelDraft(body.id);
      if (!draft) return sendJson(res, 404, { error: '作品不存在' });
      const cfg = requireImageConfig();
      const ratio = normalizeNovelCoverRatio(body.ratio || draft.coverRatio);
      const basePrompt = String(body.prompt || draft.coverPrompt || '').trim() || fallbackCoverPrompt(draft);
      const capabilities = await novelCoverReferenceCapabilities(cfg);
      const referenceLimit = capabilities.maxReferenceImages;
      const libraryReferences = resolveGlobalAssetReferences(body.referenceIds, { limit: referenceLimit });
      const localReferences = normalizeNovelCoverReferences(body.referenceImages, {
        limit: referenceLimit - libraryReferences.length,
      });
      const references = [...libraryReferences, ...localReferences];
      const prompt = buildCoverImagePrompt(draft, basePrompt, references);
      const { b64 } = await generateConfiguredImage(cfg, prompt, {
        ratio,
        referenceImages: references.map((item) => item.diskPath || item.b64),
        usageContext: {
          projectId: draft.id,
          operation: 'novel-cover',
          currency: cfg.costTracking?.currency || 'CNY',
        },
      });
      saveCoverImage(draft.id, Buffer.from(b64, 'base64'));
      const saved = saveNovelDraft({
        ...draft,
        cover: true,
        coverUpdatedAt: new Date().toISOString(),
        coverRatio: ratio,
        coverPrompt: buildCoverImagePrompt(draft, basePrompt),
      });
      return sendJson(res, 200, {
        ok: true,
        referencesUsed: references.length,
        referenceLimit,
        coverUrl: coverUrlFor(saved),
        draft: { ...draftShell(saved), coverUrl: coverUrlFor(saved) },
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  return false;
}
