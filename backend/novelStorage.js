import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { readJsonFile, writeJsonAtomic, writeFileAtomic } from './lib/atomicJson.js';

// ===== 小说存储 v2：每部作品独立文件 + 索引，支撑 5万-200万字长篇 =====
const NOVEL_DIR = path.join(DATA_DIR, 'novels');
const COVER_DIR = path.join(NOVEL_DIR, 'covers');
const WORKS_DIR = path.join(NOVEL_DIR, 'works');
const INDEX_FILE = path.join(NOVEL_DIR, 'index.json');
const LEGACY_FILE = path.join(DATA_DIR, 'novel-drafts.json');
const WORKSPACE_EPOCH_FILE = path.join(NOVEL_DIR, '.workspace-epoch.json');
const WORKSPACE_EPOCH = 5;

export const VOLUME_SIZE = 20; // 每卷章数（滚动规划）
export const NOVEL_COVER_RATIOS = ['1:1', '2:3', '3:4', '4:5', '9:16', '4:3', '3:2', '16:9', '21:9'];

export function normalizeNovelCoverRatio(value, fallback = '3:4') {
  const ratio = String(value || '').trim();
  return NOVEL_COVER_RATIOS.includes(ratio) ? ratio : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 判断当前格式的工作目录里是否已经有作品。用于区分「首次迁移」和「标记文件丢了」。
function hasExistingWorks() {
  try {
    if (!fs.existsSync(WORKS_DIR)) return false;
    return fs.readdirSync(WORKS_DIR).some((name) => fs.existsSync(path.join(WORKS_DIR, name, 'meta.json')));
  } catch {
    return true; // 探测失败也当作「有数据」，宁可少迁移一次，也不能删用户的小说
  }
}

function resetLegacyNovelWorkspaceOnce() {
  if (fs.existsSync(WORKSPACE_EPOCH_FILE)) {
    const marker = readJsonFile(WORKSPACE_EPOCH_FILE, null);
    // 标记存在却读不出来（被占用 / 损坏）时直接放弃：这一步是 rmSync，读失败不能当成「需要迁移」。
    if (marker == null) return;
    if (Number(marker.epoch) === WORKSPACE_EPOCH) return;
  } else if (hasExistingWorks()) {
    // 标记文件不在了，但 works/ 里还有作品 —— 只是标记丢了，绝不能当成首次迁移把数据删掉。
    return;
  }
  ensureDir(NOVEL_DIR);
  fs.rmSync(WORKS_DIR, { recursive: true, force: true });
  fs.rmSync(COVER_DIR, { recursive: true, force: true });
  fs.rmSync(INDEX_FILE, { force: true });
  fs.rmSync(LEGACY_FILE, { force: true });
  for (const name of fs.readdirSync(NOVEL_DIR)) {
    if (name.endsWith('.json') && name !== path.basename(WORKSPACE_EPOCH_FILE)) {
      fs.rmSync(path.join(NOVEL_DIR, name), { force: true });
    }
  }
  ensureDir(WORKS_DIR);
  ensureDir(COVER_DIR);
  writeJsonAtomic(WORKSPACE_EPOCH_FILE, { epoch: WORKSPACE_EPOCH, resetAt: nowIso() });
}

function makeId(prefix = 'novel') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

resetLegacyNovelWorkspaceOnce();

function safeFileId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function draftFilePath(id) {
  return path.join(NOVEL_DIR, `${safeFileId(id)}.json`);
}

function workDirPath(id) {
  return path.join(WORKS_DIR, safeFileId(id));
}

function workMetaPath(id) {
  return path.join(workDirPath(id), 'meta.json');
}

function workChaptersDir(id) {
  return path.join(workDirPath(id), 'chapters');
}

function workRevisionsDir(id) {
  return path.join(workDirPath(id), 'revisions');
}

function chapterFileName(chapter) {
  const order = String(Math.max(0, Number(chapter?.order) || 0)).padStart(4, '0');
  return `${order}-${safeFileId(chapter?.id || `chapter_${order}`)}.json`;
}

export function coverFilePath(id) {
  return path.join(COVER_DIR, `${safeFileId(id)}.png`);
}

export function coverUrlFor(draft) {
  if (!draft?.cover) return '';
  const t = encodeURIComponent(draft.coverUpdatedAt || draft.updatedAt || '');
  return `/api/novel/cover/${safeFileId(draft.id)}.png?t=${t}`;
}

function normalizeChannel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['female', '女频', 'nv', 'woman'].includes(raw)) return 'female';
  return 'male';
}

function normalizeMode(value, wan = 0) {
  const raw = String(value || '').trim();
  if (raw === 'short' || raw === 'long') return raw;
  return wan > 0 && wan <= 15 ? 'short' : 'long';
}

// 字数目标统一为「万字」数字；兼容旧版字符串
export function normalizeWordTargetWan(value, fallback = 30) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.max(5, Math.min(200, Math.round(n)));
  const raw = String(value || '').trim();
  if (raw === '短篇 3-8万字') return 8;
  if (raw === '长篇 10-20万字') return 20;
  if (raw === '长篇 20万字以上') return 30;
  const m = raw.match(/(\d{1,3})\s*万/);
  if (m) return Math.max(5, Math.min(200, Number(m[1])));
  return fallback;
}

// 章数规划：约 2500 字/章 → 每万字 4 章
export function totalChaptersForWan(wan) {
  const n = normalizeWordTargetWan(wan);
  return Math.max(8, Math.min(1000, Math.round(n * 4)));
}

export function channelLabel(value) {
  return normalizeChannel(value) === 'female' ? '女频' : '男频';
}

export function modeLabel(value) {
  return String(value) === 'short' ? '短篇' : '长篇';
}

export function wordTargetLabel(wan) {
  return `${normalizeWordTargetWan(wan)}万字`;
}

export function countWords(text) {
  return String(text || '').replace(/\s/g, '').length;
}

export function normalizeContinuityState(state = {}) {
  if (typeof state === 'string') {
    return { summary: state.trim(), tailAction: '', tailDialogue: '', emotion: '', location: '', unresolvedHook: '' };
  }
  return {
    summary: String(state.summary || '').trim(),
    tailAction: String(state.tailAction || '').trim(),
    tailDialogue: String(state.tailDialogue || '').trim(),
    emotion: String(state.emotion || '').trim(),
    location: String(state.location || '').trim(),
    unresolvedHook: String(state.unresolvedHook || '').trim(),
  };
}

export function normalizeLedgerEntry(entry = {}, index = 0) {
  const status = ['open', 'resolved'].includes(entry.status) ? entry.status : 'open';
  return {
    id: String(entry.id || `f${index + 1}`).trim() || `f${index + 1}`,
    content: String(entry.content || '').trim(),
    plantedChapter: Number(entry.plantedChapter) || 0,
    dueChapter: Number(entry.dueChapter) || 0,
    status,
    resolvedChapter: Number(entry.resolvedChapter) || 0,
    notes: Array.isArray(entry.notes)
      ? entry.notes.map((n) => String(n || '').trim()).filter(Boolean).slice(-6)
      : [],
  };
}

export function normalizeCharacterState(state = {}) {
  return {
    name: String(state.name || '').trim(),
    status: String(state.status || '').trim(),
    location: String(state.location || '').trim(),
    goal: String(state.goal || '').trim(),
    note: String(state.note || '').trim(),
  };
}

export function normalizeVolume(volume = {}, index = 0) {
  const idx = Number(volume.index) || index + 1;
  return {
    index: idx,
    title: String(volume.title || `第${idx}卷`).trim() || `第${idx}卷`,
    goal: String(volume.goal || volume.theme || '').trim(),
    startOrder: Number(volume.startOrder) || 0,
    endOrder: Number(volume.endOrder) || 0,
    summary: String(volume.summary || '').trim(),
  };
}

export function normalizeNovelFeatures(features = {}) {
  const multiWriter = features?.multiWriter && typeof features.multiWriter === 'object'
    ? features.multiWriter
    : {};
  return {
    multiWriter: {
      enabled: multiWriter.enabled === true,
      variants: Math.max(2, Math.min(5, Math.floor(Number(multiWriter.variants) || 3))),
      reviewMode: 'score-and-merge',
    },
  };
}

function normalizeWritingPurpose(value) {
  return ['serial', 'adaptation'].includes(value) ? value : 'serial';
}

function normalizeSubplotPolicy(value) {
  return ['auto', 'none', 'light', 'multi', 'manual'].includes(value) ? value : 'auto';
}

const NOVEL_SETUP_KEYS = ['genre', 'idea', 'worldSetting', 'protagonist', 'chapterTargetWords', 'totalTargetWords', 'title'];

function normalizeSetupInsight(insight = {}) {
  const confidence = Math.max(0, Math.min(1, Number(insight.confidence) || 0));
  const status = ['weak', 'usable', 'strong'].includes(insight.status)
    ? insight.status
    : (confidence >= 0.82 ? 'strong' : confidence >= 0.55 ? 'usable' : 'weak');
  return {
    status,
    confidence,
    summary: String(insight.summary || '').trim().slice(0, 500),
    gaps: (Array.isArray(insight.gaps) ? insight.gaps : [])
      .map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6),
    updatedAt: insight.updatedAt || '',
  };
}

export function normalizeNovelSetupInsights(insights = {}) {
  return Object.fromEntries(NOVEL_SETUP_KEYS
    .filter((key) => insights?.[key] && typeof insights[key] === 'object')
    .map((key) => [key, normalizeSetupInsight(insights[key])]));
}

export function normalizeCreationBrief(brief = null) {
  if (!brief || typeof brief !== 'object') return null;
  return {
    corePromise: String(brief.corePromise || '').trim().slice(0, 1200),
    centralConflict: String(brief.centralConflict || '').trim().slice(0, 1200),
    audiencePromise: String(brief.audiencePromise || '').trim().slice(0, 1200),
    tone: String(brief.tone || '').trim().slice(0, 500),
    visualStrategy: String(brief.visualStrategy || '').trim().slice(0, 1200),
    differentiator: String(brief.differentiator || '').trim().slice(0, 1200),
    risks: (Array.isArray(brief.risks) ? brief.risks : [])
      .map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8),
    updatedAt: brief.updatedAt || '',
  };
}

function normalizeMarketReference(item = {}) {
  return {
    id: String(item.id || '').trim().slice(0, 100),
    source: String(item.source || 'fanqie').trim().slice(0, 40) || 'fanqie',
    rank: Math.max(0, Number(item.rank) || 0),
    title: String(item.title || '').trim().slice(0, 160),
    intro: String(item.intro || '').trim().slice(0, 1200),
    tags: (Array.isArray(item.tags) ? item.tags : []).map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 12),
    metric: String(item.metric || '').trim().slice(0, 120),
    detailUrl: String(item.detailUrl || '').trim().slice(0, 2000),
  };
}

export function normalizeNovelMarketContext(context = {}) {
  return {
    studyIds: [...new Set((Array.isArray(context.studyIds) ? context.studyIds : []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 20),
    references: (Array.isArray(context.references) ? context.references : []).map(normalizeMarketReference).filter((item) => item.id && item.title).slice(0, 20),
    promptDigest: String(context.promptDigest || '').trim().slice(0, 12000),
    updatedAt: context.updatedAt || '',
  };
}

function normalizePackagingTitle(item = {}, index = 0) {
  const title = String(item.title || item.value || '').replace(/^《|》$/g, '').trim().slice(0, 80);
  if (!title) return null;
  return {
    id: String(item.id || `title_${index + 1}`).trim(),
    title,
    strategy: String(item.strategy || '').trim().slice(0, 120),
    reason: String(item.reason || '').trim().slice(0, 500),
    score: Math.max(0, Math.min(100, Number(item.score) || 0)),
    aiRisk: Math.max(0, Math.min(100, Number(item.aiRisk) || 0)),
  };
}

function normalizePackagingIntro(item = {}, index = 0) {
  const text = String(item.text || item.intro || '').trim().slice(0, 1200);
  if (!text) return null;
  return {
    id: String(item.id || `intro_${index + 1}`).trim(),
    text,
    strategy: String(item.strategy || '').trim().slice(0, 120),
    reason: String(item.reason || '').trim().slice(0, 500),
    score: Math.max(0, Math.min(100, Number(item.score) || 0)),
  };
}

const GENERIC_AI_TITLE_PHRASES = [
  '逆光时刻',
  '命运齿轮',
  '长夜尽头',
  '涅槃归来',
  '王者归来',
];

function uniquePackagingItems(items, valueOf, idPrefix, limit) {
  const values = new Set();
  const ids = new Set();
  const unique = [];
  for (const item of items) {
    const value = valueOf(item).replace(/[\s《》「」『』，。！？、：；,.!?:;'"“”‘’]/g, '').toLowerCase();
    if (!value || values.has(value)) continue;
    values.add(value);
    let id = String(item.id || '').trim();
    if (!id || ids.has(id)) id = `${idPrefix}_${unique.length + 1}`;
    ids.add(id);
    unique.push({ ...item, id });
    if (unique.length >= limit) break;
  }
  return unique;
}

export function normalizeNovelPackagingLab(lab = null) {
  if (!lab || typeof lab !== 'object') return null;
  const titles = uniquePackagingItems(
    (Array.isArray(lab.titles) ? lab.titles : [])
      .map(normalizePackagingTitle)
      .filter(Boolean)
      .filter((item) => !GENERIC_AI_TITLE_PHRASES.some((phrase) => item.title.includes(phrase))),
    (item) => item.title,
    'title',
    5,
  );
  const intros = uniquePackagingItems(
    (Array.isArray(lab.intros) ? lab.intros : []).map(normalizePackagingIntro).filter(Boolean),
    (item) => item.text,
    'intro',
    3,
  );
  const requestedTitleId = String(lab.recommendedTitleId || '').trim();
  const requestedIntroId = String(lab.recommendedIntroId || '').trim();
  return {
    titles,
    intros,
    recommendedTitleId: titles.some((item) => item.id === requestedTitleId) ? requestedTitleId : (titles[0]?.id || ''),
    recommendedIntroId: intros.some((item) => item.id === requestedIntroId) ? requestedIntroId : (intros[0]?.id || ''),
    auditSummary: String(lab.auditSummary || '').trim().slice(0, 2000),
    generatedAt: lab.generatedAt || '',
  };
}

export function novelSetupState(draft = {}) {
  const title = String(draft.title || '').trim();
  const insights = normalizeNovelSetupInsights(draft.setupInsights || {});
  const slots = [
    { key: 'genre', label: '题材', filled: Boolean(String(draft.genre || '').trim()), value: String(draft.genre || '').trim() },
    { key: 'idea', label: '梗概', filled: Boolean(String(draft.idea || '').trim()), value: String(draft.idea || '').trim() },
    { key: 'worldSetting', label: '世界观', filled: Boolean(String(draft.worldSetting || '').trim()), value: String(draft.worldSetting || '').trim() },
    { key: 'protagonist', label: '主角', filled: Boolean(String(draft.protagonist || '').trim()), value: String(draft.protagonist || '').trim() },
    {
      key: 'chapterTargetWords',
      label: '单章字数',
      filled: draft.chapterTargetWordsConfirmed === true,
      value: draft.chapterTargetWordsConfirmed === true ? `${Math.max(800, Number(draft.chapterTargetWords) || 2500)}字` : '',
    },
    {
      key: 'totalTargetWords',
      label: '全书字数',
      filled: Math.max(0, Number(draft.totalTargetWords) || 0) > 0,
      value: Math.max(0, Number(draft.totalTargetWords) || 0) > 0 ? `${Math.round(Number(draft.totalTargetWords) / 10000)}万字` : '',
    },
    {
      key: 'title',
      label: '书名',
      filled: Boolean(title && !/^未命名(?:作品|小说)?$/.test(title)),
      value: title && !/^未命名(?:作品|小说)?$/.test(title) ? title : '',
    },
  ].map((slot) => {
    const insight = insights[slot.key];
    const confidence = insight ? insight.confidence : (slot.filled ? 0.65 : 0);
    const quality = insight?.status || (slot.filled ? 'usable' : 'empty');
    return {
      ...slot,
      quality,
      confidence,
      insight: insight?.summary || '',
      gaps: insight?.gaps || [],
    };
  });
  const completed = slots.filter((slot) => slot.filled).length;
  const coreComplete = completed === slots.length;
  const confirmed = draft.setupConfirmed === true
    || Boolean(draft.blueprint)
    || (Array.isArray(draft.chapters) && draft.chapters.some((chapter) => chapter?.content));
  const nextSlot = slots.find((slot) => !slot.filled);
  return {
    slots,
    completed,
    total: slots.length,
    strongCount: slots.filter((slot) => slot.quality === 'strong').length,
    reviewCount: slots.filter((slot) => slot.quality === 'weak').length,
    coreComplete,
    confirmed,
    complete: coreComplete && confirmed,
    nextKey: nextSlot?.key || (coreComplete && !confirmed ? 'confirmation' : ''),
    nextLabel: nextSlot?.label || (coreComplete && !confirmed ? '创作简报' : ''),
  };
}

export function normalizeNovelSkillConfig(config = {}) {
  return {
    enabled: config.enabled !== false,
    autoRoute: config.autoRoute !== false,
    skillIds: [...new Set((Array.isArray(config.skillIds) ? config.skillIds : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean))].slice(0, 50),
  };
}

function normalizeGenerationTrace(trace = null) {
  if (!trace || typeof trace !== 'object') return null;
  return {
    mode: trace.mode === 'multi-writer' ? 'multi-writer' : 'single-writer',
    variantCount: Math.max(1, Math.min(5, Number(trace.variantCount) || 1)),
    scores: Array.isArray(trace.scores)
      ? trace.scores.slice(0, 5).map((score, index) => ({
        variant: Math.max(1, Number(score?.variant) || index + 1),
        total: Math.max(0, Math.min(100, Number(score?.total) || 0)),
        structure: Math.max(0, Math.min(100, Number(score?.structure) || 0)),
        character: Math.max(0, Math.min(100, Number(score?.character) || 0)),
        prose: Math.max(0, Math.min(100, Number(score?.prose) || 0)),
        market: Math.max(0, Math.min(100, Number(score?.market) || 0)),
        note: String(score?.note || '').trim().slice(0, 240),
      }))
      : [],
    selectedVariant: Math.max(0, Math.min(5, Number(trace.selectedVariant) || 0)),
    appliedSkills: Array.isArray(trace.appliedSkills)
      ? trace.appliedSkills.slice(0, 20).map((item) => ({
        id: String(item?.id || '').trim(),
        name: String(item?.name || '').trim(),
        version: String(item?.version || '').trim(),
        commit: String(item?.source?.commit || item?.commit || '').trim().slice(0, 40),
      })).filter((item) => item.id || item.name)
      : [],
    generatedAt: trace.generatedAt || '',
  };
}

function normalizeChapterPipeline(pipeline = null, { hasContent = false, memoryStale = false } = {}) {
  const allowed = new Set(['planned', 'composed', 'architected', 'drafted', 'normalized', 'audited', 'revised', 'memorized', 'done', 'error']);
  const fallbackStatus = hasContent ? (memoryStale ? 'drafted' : 'memorized') : 'planned';
  if (!pipeline || typeof pipeline !== 'object') {
    return { status: fallbackStatus, runId: '', intent: null, context: null, architecture: null, audit: null, postAudit: null, draftContent: '', normalizedContent: '', error: '', updatedAt: '' };
  }
  return {
    status: allowed.has(pipeline.status) ? pipeline.status : fallbackStatus,
    runId: String(pipeline.runId || '').trim().slice(0, 100),
    intent: pipeline.intent && typeof pipeline.intent === 'object' ? pipeline.intent : null,
    context: pipeline.context && typeof pipeline.context === 'object' ? pipeline.context : null,
    architecture: pipeline.architecture && typeof pipeline.architecture === 'object' ? pipeline.architecture : null,
    audit: pipeline.audit && typeof pipeline.audit === 'object' ? pipeline.audit : null,
    postAudit: pipeline.postAudit && typeof pipeline.postAudit === 'object' ? pipeline.postAudit : null,
    draftContent: String(pipeline.draftContent || '').slice(0, 50000),
    normalizedContent: String(pipeline.normalizedContent || '').slice(0, 50000),
    error: String(pipeline.error || '').trim().slice(0, 1000),
    updatedAt: pipeline.updatedAt || '',
  };
}

export function normalizeNovelChapter(chapter = {}, index = 0) {
  const order = Number(chapter.order || chapter.chapterNo || chapter.index || index + 1);
  const safeOrder = Number.isFinite(order) && order > 0 ? Math.floor(order) : index + 1;
  const content = String(chapter.content || '').trim();
  const contentVersion = Math.max(content ? 1 : 0, Number(chapter.contentVersion) || 0);
  const memoryVersion = Math.max(0, Number(chapter.memoryVersion) || (content ? contentVersion : 0));
  const memoryStale = chapter.memoryStale === true || memoryVersion < contentVersion;
  return {
    id: String(chapter.id || chapter.chapterId || `chapter_${safeOrder}`).trim() || `chapter_${safeOrder}`,
    order: safeOrder,
    volumeIndex: Number(chapter.volumeIndex) || Math.ceil(safeOrder / VOLUME_SIZE),
    title: String(chapter.title || `第${safeOrder}章`).trim() || `第${safeOrder}章`,
    summary: String(chapter.summary || chapter.synopsis || '').trim(),
    hook: String(chapter.hook || chapter.openingHook || '').trim(),
    endingHook: String(chapter.endingHook || chapter.cliffhanger || '').trim(),
    plant: Array.isArray(chapter.plant) ? chapter.plant.map((x) => String(x || '').trim()).filter(Boolean) : [],
    resolve: Array.isArray(chapter.resolve) ? chapter.resolve.map((x) => String(x || '').trim()).filter(Boolean) : [],
    content,
    wordCount: content ? countWords(content) : 0,
    contentVersion,
    memoryVersion,
    memoryStale,
    memoryRecord: chapter.memoryRecord && typeof chapter.memoryRecord === 'object'
      ? chapter.memoryRecord
      : null,
    continuityState: normalizeContinuityState(chapter.continuityState || {}),
    generationTrace: normalizeGenerationTrace(chapter.generationTrace),
    pipeline: normalizeChapterPipeline(chapter.pipeline, { hasContent: Boolean(content), memoryStale }),
    updatedAt: chapter.updatedAt || '',
  };
}

function legacyBlueprint(outline) {
  if (!outline) return null;
  if (typeof outline === 'string') return { premise: outline.slice(0, 2000), legacy: true };
  return {
    premise: String(outline.logline || outline.coreConflict || '').trim(),
    endingAnchor: String(outline.storyArc?.finalPayoff || '').trim(),
    openingAnchor: String(outline.storyArc?.openingHook || '').trim(),
    mainCharacters: Array.isArray(outline.mainCharacters) ? outline.mainCharacters : [],
    worldRules: Array.isArray(outline.worldRules) ? outline.worldRules : [],
    acts: [],
    goldenChapters: [],
    foreshadowPlan: [],
    pacingNotes: '',
    emotionCurve: '',
    legacy: true,
  };
}

export function normalizeBlueprint(blueprint = null) {
  if (!blueprint || typeof blueprint !== 'object') return null;
  return {
    premise: String(blueprint.premise || '').trim(),
    openingAnchor: String(blueprint.openingAnchor || '').trim(),
    endingAnchor: String(blueprint.endingAnchor || '').trim(),
    goldenChapters: Array.isArray(blueprint.goldenChapters) ? blueprint.goldenChapters.slice(0, 3) : [],
    mainCharacters: Array.isArray(blueprint.mainCharacters) ? blueprint.mainCharacters.slice(0, 12) : [],
    worldRules: Array.isArray(blueprint.worldRules) ? blueprint.worldRules.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 16) : [],
    acts: Array.isArray(blueprint.acts) ? blueprint.acts.slice(0, 8) : [],
    foreshadowPlan: Array.isArray(blueprint.foreshadowPlan) ? blueprint.foreshadowPlan.slice(0, 24) : [],
    pacingNotes: String(blueprint.pacingNotes || '').trim(),
    emotionCurve: String(blueprint.emotionCurve || '').trim(),
    legacy: blueprint.legacy === true,
  };
}

export function normalizeNovelDraft(draft = {}) {
  const createdAt = draft.createdAt || nowIso();
  const explicitTotalTargetWords = Math.max(0, Math.min(20_000_000, Math.floor(Number(draft.totalTargetWords) || 0)));
  const wordTargetWan = normalizeWordTargetWan(
    explicitTotalTargetWords > 0 ? explicitTotalTargetWords / 10000 : (draft.wordTargetWan ?? draft.wordTarget),
    30,
  );
  const mode = normalizeMode(draft.mode, wordTargetWan);
  let chapters = Array.isArray(draft.chapters)
    ? draft.chapters.map((chapter, index) => normalizeNovelChapter(chapter, index)).sort((a, b) => a.order - b.order)
    : [];
  // 旧版短篇：正文塞在 content 字段，没有章节 → 迁移为第 1 章
  if (!chapters.length && String(draft.content || '').trim()) {
    chapters = [normalizeNovelChapter({ order: 1, title: '第1章', content: draft.content }, 0)];
  }
  let volumes = Array.isArray(draft.volumes)
    ? draft.volumes.map((volume, index) => normalizeVolume(volume, index)).sort((a, b) => a.index - b.index)
    : [];
  if (!volumes.length && chapters.length) {
    volumes = [normalizeVolume({ index: 1, startOrder: 1, endOrder: chapters.length }, 0)];
  }
  const declaredTotal = Number(draft.chaptersTotal) || 0;
  const chaptersTotal = Math.max(
    declaredTotal > 0 ? declaredTotal : totalChaptersForWan(wordTargetWan),
    chapters.length,
  );
  const blueprint = normalizeBlueprint(draft.blueprint) || legacyBlueprint(draft.outline);
  const setupConfirmed = draft.setupConfirmed === true
    || Boolean(blueprint)
    || chapters.some((chapter) => chapter.content);
  return {
    id: String(draft.id || makeId()).trim(),
    title: String(draft.title || '未命名小说').trim() || '未命名小说',
    intro: String(draft.intro || draft.description || draft.synopsis || '').trim(),
    sellingPoints: Array.isArray(draft.sellingPoints)
      ? draft.sellingPoints.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    channel: normalizeChannel(draft.channel),
    mode,
    genre: String(draft.genre || '').trim(),
    writingPurpose: normalizeWritingPurpose(draft.writingPurpose),
    subplotPolicy: normalizeSubplotPolicy(draft.subplotPolicy),
    targetPlatforms: Array.isArray(draft.targetPlatforms)
      ? draft.targetPlatforms.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
    chapterTargetWords: Math.max(800, Math.min(8000, Math.floor(Number(draft.chapterTargetWords) || 2500))),
    chapterTargetWordsConfirmed: draft.chapterTargetWordsConfirmed === true,
    totalTargetWords: explicitTotalTargetWords,
    wordTargetWan,
    chaptersTotal: Math.max(chapters.length, Math.min(1000, chaptersTotal)),
    idea: String(draft.idea || '').trim(),
    worldSetting: String(draft.worldSetting || '').trim(),
    protagonist: String(draft.protagonist || '').trim(),
    setupInsights: normalizeNovelSetupInsights(draft.setupInsights || {}),
    creationBrief: normalizeCreationBrief(draft.creationBrief),
    setupConfirmed,
    marketContext: normalizeNovelMarketContext(draft.marketContext || {}),
    packagingLab: normalizeNovelPackagingLab(draft.packagingLab),
    opening: String(draft.opening || '').trim(),
    ending: String(draft.ending || '').trim(),
    requirement: String(draft.requirement || '').trim(),
    coverPrompt: String(draft.coverPrompt || '').trim(),
    coverRatio: normalizeNovelCoverRatio(draft.coverRatio),
    cover: draft.cover === true,
    coverUpdatedAt: draft.coverUpdatedAt || '',
    blueprint,
    volumes,
    chapters,
    ledger: Array.isArray(draft.ledger)
      ? draft.ledger.map((entry, index) => normalizeLedgerEntry(entry, index))
      : [],
    rollingSummary: String(draft.rollingSummary || '').trim(),
    characterStates: Array.isArray(draft.characterStates)
      ? draft.characterStates.map((state) => normalizeCharacterState(state)).filter((s) => s.name).slice(0, 24)
      : [],
    continuityState: normalizeContinuityState(draft.continuityState || {}),
    memoryDirtyFrom: Math.max(0, Number(draft.memoryDirtyFrom) || 0),
    features: normalizeNovelFeatures(draft.features || {}),
    skillConfig: normalizeNovelSkillConfig(draft.skillConfig || {}),
    radarReports: Array.isArray(draft.radarReports)
      ? draft.radarReports.filter((item) => item && typeof item === 'object').slice(-30)
      : [],
    storageVersion: 5,
    createdAt,
    updatedAt: draft.updatedAt || createdAt,
  };
}

export function chapterMeta(chapter) {
  const { content, pipeline, ...meta } = normalizeNovelChapter(chapter);
  return {
    ...meta,
    hasContent: Boolean(content),
    pipeline: {
      status: pipeline.status,
      runId: pipeline.runId,
      audit: pipeline.audit ? { passed: pipeline.audit.passed, score: pipeline.audit.score, summary: pipeline.audit.summary, violations: pipeline.audit.violations || [] } : null,
      postAudit: pipeline.postAudit ? { passed: pipeline.postAudit.passed, score: pipeline.postAudit.score, summary: pipeline.postAudit.summary, violations: pipeline.postAudit.violations || [] } : null,
      error: pipeline.error,
      updatedAt: pipeline.updatedAt,
    },
  };
}

// 精简版草稿：不带章节正文（200万字正文不进列表/常规响应）
export function draftShell(draft) {
  const full = normalizeNovelDraft(draft);
  return {
    ...full,
    setup: novelSetupState(full),
    chapters: full.chapters.map((chapter) => chapterMeta(chapter)),
  };
}

export function summarizeNovelDraft(draft) {
  const full = normalizeNovelDraft(draft);
  const chaptersDone = full.chapters.filter((c) => c.content).length;
  const wordsWritten = full.chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  let phase = 'draft';
  if (full.blueprint && !full.blueprint.legacy) phase = 'writing';
  else if (chaptersDone > 0) phase = 'writing';
  if (chaptersDone >= full.chaptersTotal && chaptersDone > 0) phase = 'finished';
  return {
    id: full.id,
    title: full.title,
    intro: full.intro,
    sellingPoints: full.sellingPoints.slice(0, 3),
    channel: full.channel,
    mode: full.mode,
    genre: full.genre,
    wordTargetWan: full.wordTargetWan,
    writingPurpose: full.writingPurpose,
    subplotPolicy: full.subplotPolicy,
    setup: novelSetupState(full),
    chaptersTotal: full.chaptersTotal,
    chaptersDone,
    wordsWritten,
    phase,
    cover: full.cover,
    coverUpdatedAt: full.coverUpdatedAt,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
  };
}

// ---------- 索引与文件读写 ----------

function splitMetaFromDraft(draft) {
  const chapterFiles = {};
  const chapters = draft.chapters.map((chapter) => {
    chapterFiles[chapter.id] = chapterFileName(chapter);
    return chapterMeta(chapter);
  });
  return { ...draft, storageVersion: 5, chapters, chapterFiles };
}

function readSplitDraft(id) {
  const meta = readJsonFile(workMetaPath(id), null);
  if (!meta || !Array.isArray(meta.chapters)) return null;
  const chapters = meta.chapters.map((chapter) => {
    const filename = meta.chapterFiles?.[chapter.id] || chapterFileName(chapter);
    const stored = readJsonFile(path.join(workChaptersDir(id), filename), null);
    return stored ? { ...chapter, ...stored } : chapter;
  });
  return normalizeNovelDraft({ ...meta, chapters });
}

function archiveChapterRevision(draftId, chapter) {
  if (!chapter?.content) return;
  const dir = path.join(workRevisionsDir(draftId), safeFileId(chapter.id));
  ensureDir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeJsonAtomic(path.join(dir, `${stamp}-v${chapter.contentVersion || 1}.json`), chapter);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().reverse();
  for (const stale of files.slice(10)) fs.rmSync(path.join(dir, stale), { force: true });
}

function writeSplitDraft(draft, existing = null) {
  const chaptersDir = workChaptersDir(draft.id);
  ensureDir(chaptersDir);
  const wantedFiles = new Set();
  const existingById = new Map((existing?.chapters || []).map((chapter) => [chapter.id, chapter]));
  for (const chapter of draft.chapters) {
    const filename = chapterFileName(chapter);
    wantedFiles.add(filename);
    const previous = existingById.get(chapter.id);
    const changed = !previous
      || previous.content !== chapter.content
      || JSON.stringify(previous) !== JSON.stringify(chapter);
    if (!changed) continue;
    if (previous?.content && previous.content !== chapter.content) archiveChapterRevision(draft.id, previous);
    writeJsonAtomic(path.join(chaptersDir, filename), chapter);
  }
  for (const name of fs.readdirSync(chaptersDir)) {
    if (name.endsWith('.json') && !wantedFiles.has(name)) fs.rmSync(path.join(chaptersDir, name), { force: true });
  }
  writeJsonAtomic(workMetaPath(draft.id), splitMetaFromDraft(draft));
  const legacyFile = draftFilePath(draft.id);
  if (fs.existsSync(legacyFile)) {
    try { fs.renameSync(legacyFile, `${legacyFile}.migrated-v3.bak`); } catch { /* keep legacy backup in place */ }
  }
}

function migrateLegacyStore() {
  if (!fs.existsSync(LEGACY_FILE)) return;
  ensureDir(NOVEL_DIR);
  const legacy = readJsonFile(LEGACY_FILE, []);
  if (Array.isArray(legacy)) {
    for (const item of legacy) {
      const draft = normalizeNovelDraft(item);
      const file = draftFilePath(draft.id);
      if (!fs.existsSync(file)) writeJsonAtomic(file, draft);
    }
  }
  try {
    fs.renameSync(LEGACY_FILE, `${LEGACY_FILE}.migrated.bak`);
  } catch { /* 保底：迁移失败不阻塞 */ }
  rebuildIndex();
}

function rebuildIndex() {
  ensureDir(NOVEL_DIR);
  const items = [];
  const seen = new Set();
  if (fs.existsSync(WORKS_DIR)) {
    for (const entry of fs.readdirSync(WORKS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const draft = readSplitDraft(entry.name);
      if (draft?.id) {
        items.push(summarizeNovelDraft(draft));
        seen.add(draft.id);
      }
    }
  }
  for (const name of fs.readdirSync(NOVEL_DIR)) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    const draft = readJsonFile(path.join(NOVEL_DIR, name), null);
    if (draft?.id && !seen.has(draft.id)) items.push(summarizeNovelDraft(draft));
  }
  writeJsonAtomic(INDEX_FILE, { version: 2, items });
  return items;
}

function readIndex() {
  migrateLegacyStore();
  if (!fs.existsSync(INDEX_FILE)) return rebuildIndex();
  const parsed = readJsonFile(INDEX_FILE, null);
  if (!parsed || !Array.isArray(parsed.items)) return rebuildIndex();
  return parsed.items;
}

function upsertIndex(summary) {
  const items = readIndex().filter((item) => item.id !== summary.id);
  items.push(summary);
  writeJsonAtomic(INDEX_FILE, { version: 2, items });
}

function removeFromIndex(id) {
  const items = readIndex().filter((item) => item.id !== id);
  writeJsonAtomic(INDEX_FILE, { version: 2, items });
}

// ---------- 对外 API ----------
export function listNovelDrafts() {
  return readIndex()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function getNovelDraft(id) {
  const draftId = String(id || '').trim();
  if (!draftId) return null;
  migrateLegacyStore();
  const split = readSplitDraft(draftId);
  if (split) return split;
  const raw = readJsonFile(draftFilePath(draftId), null);
  return raw ? normalizeNovelDraft(raw) : null;
}

export function saveNovelDraft(input = {}) {
  migrateLegacyStore();
  const incomingId = String(input.id || '').trim();
  const existing = incomingId ? getNovelDraft(incomingId) : null;
  const next = normalizeNovelDraft({
    ...(existing || {}),
    ...input,
    id: incomingId || existing?.id || makeId(),
    createdAt: existing?.createdAt || input.createdAt || nowIso(),
    updatedAt: nowIso(),
  });
  writeSplitDraft(next, existing);
  upsertIndex(summarizeNovelDraft(next));
  return next;
}

export function deleteNovelDraft(id) {
  const draftId = String(id || '').trim();
  if (!draftId) return false;
  migrateLegacyStore();
  const file = draftFilePath(draftId);
  const splitDir = workDirPath(draftId);
  const existed = fs.existsSync(file) || fs.existsSync(splitDir);
  if (existed) fs.rmSync(file, { force: true });
  fs.rmSync(splitDir, { recursive: true, force: true });
  fs.rmSync(coverFilePath(draftId), { force: true });
  removeFromIndex(draftId);
  return existed;
}

export function saveCoverImage(id, buffer) {
  ensureDir(COVER_DIR);
  // 原子写：并发/中断不会留下损坏的图片文件
  writeFileAtomic(coverFilePath(id), buffer);
}

export function fullNovelText(draft) {
  const full = normalizeNovelDraft(draft);
  return full.chapters
    .filter((chapter) => chapter.content)
    .sort((a, b) => a.order - b.order)
    .map((chapter) => `${chapter.title}\n\n${chapter.content}`)
    .join('\n\n');
}
