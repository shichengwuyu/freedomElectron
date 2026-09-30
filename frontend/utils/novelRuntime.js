// 写小说 · 前端运行时 v3：聊天控制台 + Skill 中心 + 写作台
// 后端契约：/api/novel/drafts /api/novel/draft /api/novel/chapter /api/novel/full
//          /api/novel/create/stream /api/novel/chapter/stream /api/novel/cover

export const NOVEL_GENRE_PRESETS = {
  male: [
    { name: '都市逆袭', hint: '被看扁的废物一朝翻身，打脸所有人' },
    { name: '战神赘婿', hint: '上门女婿身份曝光，权势滔天' },
    { name: '神豪系统', hint: '开局绑定系统，花钱就变强' },
    { name: '玄幻升级', hint: '废柴觉醒逆天神体，一路碾压' },
    { name: '都市修仙', hint: '仙帝重生都市，横扫一切不服' },
    { name: '规则怪谈', hint: '诡异规则里步步惊心求生' },
    { name: '悬疑灵异', hint: '离奇案件背后藏惊天秘密' },
    { name: '权谋官场', hint: '小人物步步为营登顶权力' },
    { name: '历史争霸', hint: '穿越乱世，运筹帷幄定江山' },
    { name: '末世求生', hint: '天灾降临，囤货杀伏我为王' },
    { name: '重生回归', hint: '带着记忆重来，改写所有遗憾' },
    { name: '高武世界', hint: '全民武道，我有最强天赋' },
  ],
  female: [
    { name: '复仇虐渣', hint: '涅槃归来，渣男贱女一个不放过' },
    { name: '甜宠婚恋', hint: '高冷大佬对她一宠到底' },
    { name: '马甲大佬', hint: '数不清的隐藏身份震惊全场' },
    { name: '豪门恩怨', hint: '真假千金、家族争产、爱恨纠缠' },
    { name: '重生逆袭', hint: '重回被害前夜，手撕命运剧本' },
    { name: '穿越宫斗', hint: '一朝穿越，步步为营斗上位' },
    { name: '闪婚隐婚', hint: '领证的陌生人竟是全城最强' },
    { name: '团宠萌宝', hint: '天才萌宝助攻，全家排队宠她' },
    { name: '替身破镜', hint: '她不当替身了，他疯了' },
    { name: '年代生活', hint: '重回八零，带全家发家致富' },
    { name: '悬疑情感', hint: '枕边人竟有不可告人的秘密' },
    { name: '天降暖婚', hint: '意外开始的婚姻，慢慢生出真心' },
  ],
};

export const NOVEL_COVER_REFERENCE_LIMIT = 10;
export const NOVEL_COVER_REFERENCE_MAX_BYTES = 15 * 1024 * 1024;
export const NOVEL_COVER_REFERENCE_TOTAL_MAX_BYTES = 48 * 1024 * 1024;
export const NOVEL_COVER_LOCAL_REFERENCE_TYPES = [
  { label: '人物', value: 'character' },
  { label: '场景', value: 'scene' },
  { label: '道具', value: 'prop' },
  { label: '画风', value: 'style' },
];
export const NOVEL_COVER_RATIO_OPTIONS = [
  { label: '3:4 竖版（推荐）', value: '3:4' },
  { label: '2:3 竖版', value: '2:3' },
  { label: '4:5 竖版', value: '4:5' },
  { label: '9:16 竖屏', value: '9:16' },
  { label: '1:1 方形', value: '1:1' },
  { label: '4:3 横版', value: '4:3' },
  { label: '3:2 横版', value: '3:2' },
  { label: '16:9 横屏', value: '16:9' },
  { label: '21:9 超宽', value: '21:9' },
];

export function filterNovelCoverLibraryItems(items = [], filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.projectId && item.sourceProjectId !== filters.projectId) return false;
    if (!query) return true;
    return [item.name, item.elementName, item.assetName, item.alias, item.sourceProjectName, ...(item.tags || [])]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query);
  });
}

function normalizeChapter(chapter = {}, index = 0) {
  const order = Number(chapter.order || index + 1);
  const safeOrder = Number.isFinite(order) && order > 0 ? Math.floor(order) : index + 1;
  return {
    id: String(chapter.id || `chapter_${safeOrder}`),
    order: safeOrder,
    volumeIndex: Number(chapter.volumeIndex) || 1,
    title: String(chapter.title || `第${safeOrder}章`),
    summary: String(chapter.summary || ''),
    hook: String(chapter.hook || ''),
    endingHook: String(chapter.endingHook || ''),
    plant: Array.isArray(chapter.plant) ? chapter.plant : [],
    resolve: Array.isArray(chapter.resolve) ? chapter.resolve : [],
    hasContent: chapter.hasContent === true || Boolean(chapter.content),
    wordCount: Number(chapter.wordCount) || 0,
    contentVersion: Number(chapter.contentVersion) || 0,
    memoryVersion: Number(chapter.memoryVersion) || 0,
    memoryStale: chapter.memoryStale === true,
    generationTrace: chapter.generationTrace || null,
    pipeline: chapter.pipeline || { status: chapter.hasContent ? 'memorized' : 'planned' },
    updatedAt: chapter.updatedAt || '',
  };
}

export function normalizeNovelShell(draft = {}) {
  return {
    id: String(draft.id || ''),
    title: String(draft.title || '未命名小说'),
    intro: String(draft.intro || ''),
    sellingPoints: Array.isArray(draft.sellingPoints) ? draft.sellingPoints : [],
    channel: draft.channel === 'female' ? 'female' : 'male',
    mode: draft.mode === 'short' ? 'short' : 'long',
    genre: String(draft.genre || ''),
    writingPurpose: draft.writingPurpose === 'adaptation' ? 'adaptation' : 'serial',
    subplotPolicy: ['auto', 'none', 'light', 'multi', 'manual'].includes(draft.subplotPolicy) ? draft.subplotPolicy : 'auto',
    targetPlatforms: Array.isArray(draft.targetPlatforms) ? draft.targetPlatforms : [],
    chapterTargetWords: Math.max(800, Number(draft.chapterTargetWords) || 2500),
    chapterTargetWordsConfirmed: draft.chapterTargetWordsConfirmed === true,
    totalTargetWords: Math.max(0, Number(draft.totalTargetWords) || 0),
    wordTargetWan: Number(draft.wordTargetWan) || 30,
    chaptersTotal: Number(draft.chaptersTotal) || 0,
    idea: String(draft.idea || ''),
    worldSetting: String(draft.worldSetting || ''),
    protagonist: String(draft.protagonist || ''),
    setupInsights: draft.setupInsights || {},
    creationBrief: draft.creationBrief || null,
    setupConfirmed: draft.setupConfirmed === true,
    marketContext: draft.marketContext || { studyIds: [], references: [], promptDigest: '', updatedAt: '' },
    packagingLab: draft.packagingLab || null,
    opening: String(draft.opening || ''),
    ending: String(draft.ending || ''),
    requirement: String(draft.requirement || ''),
    coverPrompt: String(draft.coverPrompt || ''),
    coverRatio: String(draft.coverRatio || '3:4'),
    coverUrl: String(draft.coverUrl || ''),
    blueprint: draft.blueprint || null,
    volumes: Array.isArray(draft.volumes) ? draft.volumes : [],
    chapters: Array.isArray(draft.chapters)
      ? draft.chapters.map((chapter, index) => normalizeChapter(chapter, index)).sort((a, b) => a.order - b.order)
      : [],
    ledger: Array.isArray(draft.ledger) ? draft.ledger : [],
    rollingSummary: String(draft.rollingSummary || ''),
    characterStates: Array.isArray(draft.characterStates) ? draft.characterStates : [],
    continuityState: draft.continuityState || {},
    memoryDirtyFrom: Number(draft.memoryDirtyFrom) || 0,
    features: {
      multiWriter: {
        enabled: draft.features?.multiWriter?.enabled === true,
        variants: Math.max(2, Math.min(5, Number(draft.features?.multiWriter?.variants) || 3)),
        reviewMode: 'score-and-merge',
      },
    },
    skillConfig: {
      enabled: draft.skillConfig?.enabled !== false,
      autoRoute: draft.skillConfig?.autoRoute !== false,
      skillIds: Array.isArray(draft.skillConfig?.skillIds) ? draft.skillConfig.skillIds : [],
    },
    radarReports: Array.isArray(draft.radarReports) ? draft.radarReports : [],
    setup: draft.setup || { slots: [], completed: 0, total: 7, strongCount: 0, reviewCount: 0, coreComplete: false, confirmed: false, complete: false, nextKey: 'genre', nextLabel: '题材' },
    updatedAt: draft.updatedAt || '',
  };
}

function downloadText(filename, text, globals = {}) {
  const doc = globals.document;
  const win = globals.window;
  if (!doc || !win) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  win.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function copyTextToClipboard(text, globals = {}) {
  if (globals.navigator?.clipboard?.writeText) return globals.navigator.clipboard.writeText(text);
  const doc = globals.document;
  if (!doc) return Promise.reject(new Error('当前环境不支持复制'));
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  doc.body.appendChild(textarea);
  textarea.select();
  doc.execCommand('copy');
  textarea.remove();
  return Promise.resolve();
}

function storedBoolean(storage, key, fallback = false) {
  try {
    const value = storage?.getItem(key);
    return value === null || value === undefined ? fallback : value === '1';
  } catch { return fallback; }
}

export function createAppNovelRuntime({
  api,
  message,
  messageBox,
  reactive,
  ref,
  computed,
  watch,
  readers = {},
  globals = {},
} = {}) {
  // ---------- 状态 ----------
  const novelUi = reactive({
    screen: 'library', // library | desk
    filter: '',
    deskPanel: 'chapters', // chapters | blueprint | characters | memory | ledger | radar | quality | trace
    workspaceMode: 'chat', // chat | editor
    writeCount: 1,
  });

  const novelCreation = reactive({
    visible: false,
    writingPurpose: 'serial',
    subplotPolicy: 'auto',
    targetPlatforms: [],
    bootstrapping: false,
    channel: 'male',
    mode: 'long',
    wordTargetWan: 30,
    genre: '',
    genreCustom: '',
    idea: '',
    opening: '',
    ending: '',
    requirement: '',
    input: '',
    preferencesVisible: false,
    messages: [],
  });

  const novelWorks = ref([]); // 书架索引摘要
  const activeNovel = ref(null); // 打开的作品（章节不含正文）
  const activeChapterId = ref('');
  const novelEditorText = ref('');
  const chapterContentCache = reactive({}); // chapterId -> content
  const novelSaveState = reactive({ dirty: false, status: 'saved', error: '' });
  const novelQuality = reactive({ loading: false, rebuilding: false, report: null });
  const novelBlueprintEdit = reactive({ visible: false, saving: false, data: {} });
  const novelCharactersEdit = reactive({ visible: false, saving: false, items: [] });
  const novelChapterCardEdit = reactive({ visible: false, saving: false, data: {} });
  const novelLedgerEdit = reactive({ visible: false, saving: false, items: [] });
  const novelRewrite = reactive({
    visible: false, generating: false, mode: 'polish', instruction: '', original: '', result: '', start: 0, end: 0,
  });
  const novelCover = reactive({
    visible: false,
    source: 'local',
    novelId: '',
    ratio: '3:4',
    referenceLimit: 9,
    capabilityLoading: false,
    reading: false,
    dragging: false,
    libraryLoading: false,
    libraryLoaded: false,
    libraryVisibleLimit: 60,
    libraryItems: [],
    libraryCategories: [],
    libraryProjects: [],
    selectedLibraryIds: [],
    localImages: [],
    query: '',
    category: '',
    projectId: '',
  });
  const novelChat = reactive({
    loading: false,
    sending: false,
    input: '',
    webSearchEnabled: storedBoolean(globals.window?.localStorage, 'gg.novel.web-search', false),
    messages: [],
    sessions: [],
    activeSessionId: '',
    queue: [],
    quickPrompts: ['继续写下一章', '检查当前伏笔', '看看故事蓝图', '打开 Skill 中心'],
  });
  const novelSkills = reactive({
    visible: false,
    loading: false,
    analyzing: false,
    installingPath: '',
    url: '',
    items: [],
    analysis: null,
  });
  const novelCreationSettings = reactive({
    visible: false,
    saving: false,
    multiWriterEnabled: false,
    multiWriterVariants: 3,
  });
  const novelMarket = reactive({
    visible: false,
    tab: 'ranking',
    source: 'fanqie',
    loading: false,
    refreshing: false,
    ranking: null,
    sources: [],
    selectedIds: [],
    selectedItems: [],
    studies: [],
    studying: false,
    sampleText: '',
    instruction: '',
    activeStudy: null,
    packaging: false,
    selectedTitleId: '',
    selectedIntroId: '',
    applying: false,
  });

  const novelGenerating = reactive({
    creating: false,
    writing: false,
    cover: false,
    saving: false,
    deletingId: '',
    liveOrder: 0, // 正在流式生成的章节序号
    jobId: '',
  });
  const novelProgress = reactive({ active: false, text: '', percentage: 0 });
  let autosaveTimer = null;
  let jobPollTimer = null;
  let savedEditorText = '';

  function chapterCacheKey(novelId, chapterId) {
    return `${novelId}:${chapterId}`;
  }

  function setEditorContent(text, { saved = true } = {}) {
    const next = String(text || '');
    if (saved) savedEditorText = next;
    novelEditorText.value = next;
    if (saved) {
      novelSaveState.dirty = false;
      novelSaveState.status = 'saved';
      novelSaveState.error = '';
    }
  }

  // ---------- 计算属性 ----------
  const filteredNovelWorks = computed(() => {
    const query = novelUi.filter.trim().toLowerCase();
    if (!query) return novelWorks.value;
    return novelWorks.value.filter((work) => (
      [work.title, work.genre, work.intro].join(' ').toLowerCase().includes(query)
    ));
  });

  const novelCreationGenreOptions = computed(() => NOVEL_GENRE_PRESETS[novelCreation.channel] || []);
  const novelCreationEffectiveGenre = computed(() => novelCreation.genreCustom.trim() || novelCreation.genre);
  const novelCreationWordRange = computed(() => (
    novelCreation.mode === 'short'
      ? { min: 5, max: 15, step: 1 }
      : { min: 15, max: 200, step: 5 }
  ));
  const novelCreationEstimatedChapters = computed(() => Math.max(8, Math.round(novelCreation.wordTargetWan * 4)));
  const novelCreationPreferenceSummary = computed(() => [
    novelCreation.channel === 'female' ? '女频' : '男频',
    novelCreation.mode === 'short' ? '短篇' : '长篇',
    `${novelCreation.wordTargetWan}万字`,
    novelCreationEffectiveGenre.value || '题材自动判断',
  ].join(' · '));

  const activeChapter = computed(() => {
    const novel = activeNovel.value;
    if (!novel) return null;
    return novel.chapters.find((chapter) => chapter.id === activeChapterId.value) || null;
  });

  const deskVolumes = computed(() => {
    const novel = activeNovel.value;
    if (!novel) return [];
    const groups = new Map();
    for (const chapter of novel.chapters) {
      const key = chapter.volumeIndex || 1;
      if (!groups.has(key)) {
        const meta = novel.volumes.find((volume) => volume.index === key);
        groups.set(key, { index: key, title: meta?.title || `第${key}卷`, goal: meta?.goal || '', chapters: [] });
      }
      groups.get(key).chapters.push(chapter);
    }
    return [...groups.values()].sort((a, b) => a.index - b.index);
  });

  const deskStats = computed(() => {
    const novel = activeNovel.value;
    if (!novel) return { done: 0, total: 0, words: 0, wan: '0', pct: 0 };
    const done = novel.chapters.filter((chapter) => chapter.hasContent).length;
    const words = novel.chapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0);
    const total = Math.max(novel.chaptersTotal, novel.chapters.length, 1);
    return {
      done,
      total,
      words,
      wan: (words / 10000).toFixed(words >= 100000 ? 0 : 1),
      pct: Math.min(100, Math.round((done / total) * 100)),
    };
  });

  const openLedger = computed(() => (activeNovel.value?.ledger || []).filter((entry) => entry.status === 'open'));
  const resolvedLedger = computed(() => (activeNovel.value?.ledger || []).filter((entry) => entry.status === 'resolved'));

  const editorWordCount = computed(() => novelEditorText.value.replace(/\s/g, '').length);

  const blueprintView = computed(() => {
    const bp = activeNovel.value?.blueprint;
    if (!bp) return null;
    return {
      premise: bp.premise || '',
      openingAnchor: bp.openingAnchor || '',
      endingAnchor: bp.endingAnchor || '',
      characters: bp.mainCharacters || [],
      worldRules: bp.worldRules || [],
      acts: bp.acts || [],
      emotionCurve: bp.emotionCurve || '',
      pacingNotes: bp.pacingNotes || '',
    };
  });

  const selectedNovelSkills = computed(() => {
    const selected = new Set(activeNovel.value?.skillConfig?.skillIds || []);
    return novelSkills.items.filter((skill) => selected.has(skill.id));
  });
  const latestNovelRadar = computed(() => activeNovel.value?.radarReports?.slice(-1)[0] || null);
  const novelSetup = computed(() => activeNovel.value?.setup || { slots: [], completed: 0, total: 7, strongCount: 0, reviewCount: 0, coreComplete: false, confirmed: false, complete: false });
  const latestGenerationTrace = computed(() => activeChapter.value?.generationTrace || null);
  const selectedNovelMarketItems = computed(() => novelMarket.selectedItems);
  const filteredNovelCoverLibraryItems = computed(() => filterNovelCoverLibraryItems(
    novelCover.libraryItems,
    novelCover,
  ));
  const visibleNovelCoverLibraryItems = computed(() => (
    filteredNovelCoverLibraryItems.value.slice(0, novelCover.libraryVisibleLimit)
  ));
  const selectedNovelCoverLibraryItems = computed(() => {
    const selected = new Set(novelCover.selectedLibraryIds);
    return novelCover.libraryItems.filter((item) => selected.has(item.id));
  });
  const novelCoverSelectedCount = computed(() => (
    selectedNovelCoverLibraryItems.value.length + novelCover.localImages.length
  ));
  watch?.(
    () => [novelCover.query, novelCover.category, novelCover.projectId].join('\u001f'),
    () => { novelCover.libraryVisibleLimit = 60; },
  );
  const novelMarketSourceGroups = computed(() => {
    const groups = new Map();
    for (const source of novelMarket.sources) {
      const key = source.group || 'other';
      if (!groups.has(key)) groups.set(key, { id: key, label: source.groupLabel || '其他来源', sources: [] });
      groups.get(key).sources.push(source);
    }
    return [...groups.values()];
  });
  const novelPipelineStages = computed(() => {
    const status = activeChapter.value?.pipeline?.status || 'planned';
    const order = ['planned', 'composed', 'architected', 'drafted', 'normalized', 'audited', 'revised', 'memorized', 'done'];
    const current = Math.max(0, order.indexOf(status));
    const stages = [
      ['规划', 'planned'], ['上下文', 'composed'], ['Beats', 'architected'], ['正文', 'drafted'],
      ['润色', 'normalized'], ['审计', 'audited'], ['修订', 'revised'], ['记忆', 'memorized'],
    ];
    return stages.map(([label, key]) => ({
      label,
      key,
      state: status === 'error' ? 'error' : (order.indexOf(key) <= current ? 'done' : 'pending'),
    }));
  });

  function novelPipelineStatusLabel(status) {
    const labels = {
      planned: '已规划',
      composed: '上下文就绪',
      architected: '架构完成',
      drafted: '初稿完成',
      normalized: '已归一',
      audited: '已审计',
      revised: '已修订',
      memorized: '已记忆',
      done: '已完成',
      error: '流程中断',
    };
    return labels[status] || '待写';
  }

  watch?.(novelEditorText, (text) => {
    if (novelGenerating.writing || text === savedEditorText) return;
    novelSaveState.dirty = true;
    novelSaveState.status = 'dirty';
    novelSaveState.error = '';
    clearTimeout(autosaveTimer);
    autosaveTimer = globals.window?.setTimeout?.(() => {
      void persistActiveChapter({ silent: true });
    }, 1200);
  });

  const beforeUnload = (event) => {
    if (!novelSaveState.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  globals.window?.addEventListener?.('beforeunload', beforeUnload);

  // ---------- 进度 ----------
  function setNovelProgress(text, percentage = 0) {
    novelProgress.active = true;
    novelProgress.text = text;
    novelProgress.percentage = Math.max(0, Math.min(100, Number(percentage) || 0));
  }

  function clearNovelProgressSoon() {
    globals.window?.setTimeout?.(() => {
      novelProgress.active = false;
      novelProgress.text = '';
      novelProgress.percentage = 0;
    }, 1500);
  }

  function scrollNovelChatToBottom() {
    globals.window?.setTimeout?.(() => {
      const container = globals.document?.querySelector?.('.novel-chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 30);
  }

  function applyNovelChatPayload(chat = {}) {
    novelChat.messages = Array.isArray(chat.messages) ? chat.messages : [];
    novelChat.sessions = Array.isArray(chat.sessions) ? chat.sessions : [];
    novelChat.activeSessionId = String(chat.activeSessionId || novelChat.sessions[0]?.id || '');
    novelChat.queue = Array.isArray(chat.queue) ? chat.queue : [];
  }

  function formatNovelChatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  async function loadNovelChat(novelId = activeNovel.value?.id) {
    if (!novelId) return;
    novelChat.loading = true;
    try {
      const result = await api.get(`/api/novel/chat?id=${encodeURIComponent(novelId)}`);
      if (activeNovel.value?.id === novelId) applyNovelChatPayload(result.chat || {});
      scrollNovelChatToBottom();
    } catch (error) {
      message.error(`聊天记录加载失败：${error.message}`);
    } finally {
      novelChat.loading = false;
    }
  }

  async function loadNovelSkills() {
    novelSkills.loading = true;
    try {
      const result = await api.get('/api/novel/skills');
      novelSkills.items = result.skills || [];
    } catch (error) {
      message.error(`Skill 列表加载失败：${error.message}`);
    } finally {
      novelSkills.loading = false;
    }
  }

  function useNovelChatPrompt(prompt) {
    novelChat.input = String(prompt || '');
    return sendNovelChat();
  }

  function useNovelChatChoice(choice) {
    novelChat.input = String(choice?.value ?? choice?.label ?? choice ?? '');
    return sendNovelChat();
  }

  function switchNovelWorkspace(mode) {
    novelUi.workspaceMode = mode === 'editor' ? 'editor' : 'chat';
    if (novelUi.workspaceMode === 'chat') scrollNovelChatToBottom();
  }

  async function openNovelChapterInEditor(chapterId) {
    await selectNovelChapter(chapterId);
    switchNovelWorkspace('editor');
  }

  // ---------- 书架 ----------
  async function loadNovelDrafts() {
    const result = await api.get('/api/novel/drafts');
    novelWorks.value = result.drafts || [];
  }

  function applyShell(shell) {
    const novel = normalizeNovelShell(shell);
    activeNovel.value = novel;
    // 同步书架卡片
    const index = novelWorks.value.findIndex((work) => work.id === novel.id);
    const done = novel.chapters.filter((chapter) => chapter.hasContent).length;
    const summary = {
      ...(index >= 0 ? novelWorks.value[index] : {}),
      id: novel.id,
      title: novel.title,
      intro: novel.intro,
      sellingPoints: novel.sellingPoints.slice(0, 3),
      channel: novel.channel,
      mode: novel.mode,
      genre: novel.genre,
      wordTargetWan: novel.wordTargetWan,
      chaptersTotal: novel.chaptersTotal,
      chaptersDone: done,
      wordsWritten: novel.chapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0),
      coverUrl: novel.coverUrl,
      updatedAt: novel.updatedAt,
    };
    if (index >= 0) novelWorks.value.splice(index, 1, summary);
    else novelWorks.value.unshift(summary);
    return novel;
  }

  async function openNovelWork(id) {
    try {
      const result = await api.get(`/api/novel/draft?id=${encodeURIComponent(id)}`);
      const novel = applyShell(result.draft);
      novelUi.screen = 'desk';
      novelUi.deskPanel = 'chapters';
      novelUi.workspaceMode = 'chat';
      const firstUnwritten = novel.chapters.find((chapter) => !chapter.hasContent);
      const target = novel.chapters.find((chapter) => chapter.hasContent && chapter.order === (firstUnwritten ? firstUnwritten.order - 1 : novel.chapters.length))
        || novel.chapters.filter((chapter) => chapter.hasContent).slice(-1)[0]
        || novel.chapters[0]
        || null;
      if (target) await selectNovelChapter(target.id);
      else {
        activeChapterId.value = '';
        setEditorContent('');
      }
      await Promise.all([loadNovelChat(novel.id), loadNovelSkills()]);
      await resumeNovelJobIfNeeded(novel.id);
    } catch (error) {
      message.error(`打开作品失败：${error.message}`);
    }
  }

  async function backToNovelLibrary() {
    if (novelGenerating.writing) {
      message.warning('正在写作中，请先停止连写');
      return;
    }
    if (novelSaveState.dirty) await persistActiveChapter({ silent: true });
    novelMarket.visible = false;
    novelUi.screen = 'library';
    activeNovel.value = null;
    activeChapterId.value = '';
    novelChat.messages = [];
    novelChat.sessions = [];
    novelChat.activeSessionId = '';
    novelChat.queue = [];
    novelChat.input = '';
    setEditorContent('');
  }

  async function deleteNovelWork(id) {
    const work = novelWorks.value.find((item) => item.id === id);
    if (!work) return;
    try {
      await messageBox.confirm(`删除《${work.title}》？所有章节和封面将一并删除。`, '删除作品', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
    novelGenerating.deletingId = id;
    try {
      await api.post('/api/novel/draft/delete', { id });
      novelWorks.value = novelWorks.value.filter((item) => item.id !== id);
      if (activeNovel.value?.id === id) backToNovelLibrary();
      message.success('作品已删除');
    } catch (error) {
      message.error(`删除失败：${error.message}`);
    } finally {
      novelGenerating.deletingId = '';
    }
  }

  // ---------- 对话式新作创建 ----------
  function creationMessage(role, content) {
    return {
      id: `creation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role,
      content: String(content || '').trim(),
    };
  }

  function openNovelCreationChat() {
    novelCreation.visible = true;
    novelCreation.writingPurpose = 'serial';
    novelCreation.subplotPolicy = 'auto';
    novelCreation.targetPlatforms = [];
    novelCreation.bootstrapping = false;
    novelCreation.channel = 'male';
    novelCreation.mode = 'long';
    novelCreation.wordTargetWan = 30;
    novelCreation.genre = '';
    novelCreation.genreCustom = '';
    novelCreation.idea = '';
    novelCreation.opening = '';
    novelCreation.ending = '';
    novelCreation.requirement = '';
    novelCreation.input = '';
    novelCreation.preferencesVisible = false;
    novelCreation.messages = [];
  }

  function onNovelCreationModeChange(mode = novelCreation.mode) {
    const nextMode = mode === 'short' ? 'short' : 'long';
    novelCreation.mode = nextMode;
    const range = novelCreationWordRange.value;
    const preferred = nextMode === 'short' ? 8 : 30;
    novelCreation.wordTargetWan = Math.min(range.max, Math.max(range.min, preferred));
  }

  function onNovelCreationChannelChange() {
    novelCreation.genre = '';
  }

  function inferNovelCreationPreferences(content) {
    const text = String(content || '');
    if (/女频|女主|大女主|甜宠|古言|现言|虐渣/.test(text)) novelCreation.channel = 'female';
    else if (/男频|男主|系统流|升级流|赘婿|无敌流/.test(text)) novelCreation.channel = 'male';

    const wordTarget = text.match(/(\d+(?:\.\d+)?)\s*万字/);
    if (wordTarget) {
      const wan = Math.max(5, Math.min(200, Number(wordTarget[1]) || 30));
      novelCreation.mode = wan <= 15 ? 'short' : 'long';
      const range = novelCreationWordRange.value;
      novelCreation.wordTargetWan = Math.min(range.max, Math.max(range.min, wan));
    } else if (/短篇|短故事|中短篇/.test(text)) {
      onNovelCreationModeChange('short');
    } else if (/长篇|百万字|大长篇/.test(text)) {
      onNovelCreationModeChange('long');
    }

    const matchedGenre = novelCreationGenreOptions.value.find((item) => text.includes(item.name));
    if (matchedGenre) {
      novelCreation.genre = matchedGenre.name;
      novelCreation.genreCustom = '';
    }
  }

  function submitNovelCreationMessage({ reply = true } = {}) {
    const content = novelCreation.input.trim();
    if (!content || novelGenerating.creating) return false;
    novelCreation.input = '';
    novelCreation.messages.push(creationMessage('user', content));
    inferNovelCreationPreferences(content);

    const isFirstIdea = !novelCreation.idea.trim();
    if (isFirstIdea) novelCreation.idea = content;
    else novelCreation.requirement = [novelCreation.requirement, content].filter(Boolean).join('\n');

    if (!novelCreation.opening && /开头|开局|第一章/.test(content)) novelCreation.opening = content;
    if (!novelCreation.ending && /结局|收尾|大结局/.test(content)) novelCreation.ending = content;
    if (reply) {
      const response = isFirstIdea
        ? `方向已锁定：${novelCreationPreferenceSummary.value}。人物关系、故事蓝图和章节节奏会围绕这个核心展开。`
        : `补充要求已并入创作简报。当前方向：${novelCreationPreferenceSummary.value}。`;
      novelCreation.messages.push(creationMessage('assistant', response));
    }
    return true;
  }

  async function startNovelCreation() {
    if (novelCreation.bootstrapping || novelGenerating.creating) return;
    novelCreation.bootstrapping = true;
    novelGenerating.creating = true;
    setNovelProgress('正在建立空白作品与创作会话…', 12);
    try {
      const result = await api.post('/api/novel/bootstrap', {
        writingPurpose: novelCreation.writingPurpose,
        subplotPolicy: novelCreation.subplotPolicy,
        targetPlatforms: novelCreation.targetPlatforms,
        channel: novelCreation.channel,
      });
      if (result?.draft) {
        const novel = applyShell(result.draft);
        applyNovelChatPayload(result.chat || {});
        novelCreation.visible = false;
        message.success('空白作品已建立，从题材开始聊');
        await openNovelWork(novel.id);
      }
      clearNovelProgressSoon();
    } catch (error) {
      message.error(`创建失败：${error.message}`);
      novelProgress.active = false;
    } finally {
      novelGenerating.creating = false;
      novelCreation.bootstrapping = false;
    }
  }

  // ---------- 章节 ----------
  async function selectNovelChapter(chapterId) {
    const novel = activeNovel.value;
    if (!novel) return;
    const chapter = novel.chapters.find((item) => item.id === chapterId);
    if (!chapter) return;
    if (activeChapterId.value && activeChapterId.value !== chapter.id && novelSaveState.dirty) {
      const saved = await persistActiveChapter({ silent: true });
      if (!saved) return;
    }
    activeChapterId.value = chapter.id;
    if (!chapter.hasContent) {
      setEditorContent('');
      return;
    }
    const cacheKey = chapterCacheKey(novel.id, chapter.id);
    if (chapterContentCache[cacheKey] !== undefined) {
      setEditorContent(chapterContentCache[cacheKey]);
      return;
    }
    try {
      const result = await api.get(`/api/novel/chapter?id=${encodeURIComponent(novel.id)}&chapterId=${encodeURIComponent(chapter.id)}`);
      chapterContentCache[cacheKey] = result.chapter?.content || '';
      if (activeChapterId.value === chapter.id) setEditorContent(chapterContentCache[cacheKey]);
    } catch (error) {
      message.error(`章节加载失败：${error.message}`);
    }
  }

  async function persistActiveChapter({ silent = false } = {}) {
    const novel = activeNovel.value;
    const chapter = activeChapter.value;
    if (!novel || !chapter) return true;
    clearTimeout(autosaveTimer);
    const content = novelEditorText.value;
    if (content === savedEditorText && !novelSaveState.dirty) return true;
    novelGenerating.saving = true;
    novelSaveState.status = 'saving';
    try {
      const result = await api.post('/api/novel/chapter/save', {
        id: novel.id,
        chapterId: chapter.id,
        content,
      });
      chapterContentCache[chapterCacheKey(novel.id, chapter.id)] = content;
      if (result.draft) applyShell(result.draft);
      if (activeNovel.value?.id === novel.id && activeChapterId.value === chapter.id && novelEditorText.value === content) {
        savedEditorText = content;
        novelSaveState.dirty = false;
        novelSaveState.status = 'saved';
      }
      if (!silent) message.success('本章已保存，连续性记忆待重建');
      return true;
    } catch (error) {
      novelSaveState.status = 'error';
      novelSaveState.error = error.message;
      if (!silent) message.error(`保存失败：${error.message}`);
      return false;
    } finally {
      novelGenerating.saving = false;
    }
  }

  async function saveActiveChapter() {
    return persistActiveChapter({ silent: false });
  }

  // ---------- 续写 ----------
  async function writeNovelChapters({ count = 1, chapterOrder = 0 } = {}) {
    const novel = activeNovel.value;
    if (!novel) return;
    if (novelGenerating.writing) {
      message.warning('已经在写了，别催～');
      return;
    }
    if (novel.memoryDirtyFrom) {
      message.warning(`第${novel.memoryDirtyFrom}章起的连续性记忆待重建，请先到质量中心完成重建`);
      return;
    }
    if (novelSaveState.dirty && !(await persistActiveChapter({ silent: true }))) return;
    novelGenerating.writing = true;
    setNovelProgress('准备开写…', 1);
    try {
      const started = await api.post('/api/novel/job/start', {
        id: novel.id,
        count,
        chapterOrder: chapterOrder || undefined,
      });
      novelGenerating.jobId = started.jobId;
      await monitorNovelJob(started.jobId, novel.id);
      clearNovelProgressSoon();
    } catch (error) {
      message.error(`写作中断：${error.message}`);
      clearNovelProgressSoon();
    } finally {
      novelGenerating.writing = false;
      novelGenerating.liveOrder = 0;
      novelGenerating.jobId = '';
      clearTimeout(jobPollTimer);
    }
  }

  async function refreshNovelAfterJob(novelId, currentOrder = 0) {
    const result = await api.get(`/api/novel/draft?id=${encodeURIComponent(novelId)}`);
    const shell = applyShell(result.draft);
    const chapter = shell.chapters.find((item) => item.order === Number(currentOrder))
      || shell.chapters.filter((item) => item.hasContent).slice(-1)[0];
    if (chapter) {
      delete chapterContentCache[chapterCacheKey(novelId, chapter.id)];
      await selectNovelChapter(chapter.id);
    }
  }

  async function monitorNovelJob(jobId, novelId) {
    let lastProcessed = -1;
    for (;;) {
      const response = await api.get(`/api/novel/job?id=${encodeURIComponent(jobId)}`);
      const job = response.job || {};
      novelGenerating.liveOrder = Number(job.currentOrder) || 0;
      setNovelProgress(job.message || '小说连写中…', Number(job.progress) || 0);
      if (job.preview && novelGenerating.liveOrder) setEditorContent(job.preview, { saved: false });
      if (Number(job.processed) > lastProcessed) {
        lastProcessed = Number(job.processed);
        if (lastProcessed > 0) await refreshNovelAfterJob(novelId, job.currentOrder);
      }
      if (['done', 'error', 'failed', 'cancelled', 'paused'].includes(job.status)) {
        await refreshNovelAfterJob(novelId, job.currentOrder);
        if (job.status === 'error' || job.status === 'failed') throw new Error(job.error || job.message || '连写失败');
        if (job.status === 'cancelled') setNovelProgress('已停笔，已完成章节均已保存', 100);
        return job;
      }
      await new Promise((resolve) => {
        jobPollTimer = globals.window?.setTimeout?.(resolve, 1000);
      });
    }
  }

  async function resumeNovelJobIfNeeded(novelId) {
    try {
      const response = await api.get(`/api/tasks?projectId=${encodeURIComponent(novelId)}`);
      const task = (response.tasks || []).find((item) => item.type === 'novel-writing' && ['running', 'queued'].includes(item.status));
      if (!task) return;
      novelGenerating.writing = true;
      novelGenerating.jobId = task.id;
      void monitorNovelJob(task.id, novelId).finally(() => {
        novelGenerating.writing = false;
        novelGenerating.jobId = '';
      });
    } catch { /* 任务恢复失败不阻塞打开作品 */ }
  }

  async function stopNovelWriting() {
    if (novelGenerating.jobId) {
      await api.post('/api/tasks/action', { source: 'job', action: 'cancel', taskId: novelGenerating.jobId });
      return;
    }
  }

  async function writeNextChapters() {
    return writeNovelChapters({ count: Number(novelUi.writeCount) || 1 });
  }

  async function rewriteActiveChapter() {
    const chapter = activeChapter.value;
    if (!chapter) return;
    if (chapter.hasContent) {
      try {
        await messageBox.confirm(`重写第${chapter.order}章《${chapter.title}》？现有正文会被覆盖。`, '重写本章', {
          type: 'warning',
          confirmButtonText: '重写',
          cancelButtonText: '取消',
        });
      } catch {
        return;
      }
    }
    novelEditorText.value = '';
    return writeNovelChapters({ count: 1, chapterOrder: chapter.order });
  }

  // ---------- 小说聊天 / Skill / 创作设置 ----------
  async function saveNovelFeatureConfig({ features, skillConfig, silent = false } = {}) {
    const novel = activeNovel.value;
    if (!novel) return null;
    const result = await api.post('/api/novel/features/save', {
      id: novel.id,
      features: features ?? novel.features,
      skillConfig: skillConfig ?? novel.skillConfig,
    });
    const saved = result.draft ? applyShell(result.draft) : null;
    if (!silent) message.success('创作配置已保存');
    return saved;
  }

  function openNovelCreationSettings() {
    const multiWriter = activeNovel.value?.features?.multiWriter || {};
    novelCreationSettings.multiWriterEnabled = multiWriter.enabled === true;
    novelCreationSettings.multiWriterVariants = Math.max(2, Math.min(5, Number(multiWriter.variants) || 3));
    novelCreationSettings.visible = true;
  }

  async function saveNovelCreationSettings() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelCreationSettings.saving = true;
    try {
      await saveNovelFeatureConfig({
        features: {
          ...novel.features,
          multiWriter: {
            enabled: novelCreationSettings.multiWriterEnabled === true,
            variants: novelCreationSettings.multiWriterVariants,
            reviewMode: 'score-and-merge',
          },
        },
      });
      novelCreationSettings.visible = false;
    } catch (error) {
      message.error(`配置保存失败：${error.message}`);
    } finally {
      novelCreationSettings.saving = false;
    }
  }

  async function openNovelSkillCenter() {
    novelSkills.visible = true;
    await loadNovelSkills();
  }

  function isNovelSkillSelected(skillId) {
    return (activeNovel.value?.skillConfig?.skillIds || []).includes(skillId);
  }

  async function setNovelSkillSelected(skillId, enabled) {
    const novel = activeNovel.value;
    if (!novel) return;
    const selected = new Set(novel.skillConfig?.skillIds || []);
    if (enabled) selected.add(skillId);
    else selected.delete(skillId);
    try {
      await saveNovelFeatureConfig({
        skillConfig: { ...novel.skillConfig, skillIds: [...selected] },
        silent: true,
      });
    } catch (error) {
      message.error(`Skill 配置失败：${error.message}`);
    }
  }

  async function analyzeNovelGitHubSkill() {
    const url = novelSkills.url.trim();
    if (!url) {
      message.warning('请先粘贴 GitHub 仓库地址');
      return;
    }
    novelSkills.analyzing = true;
    novelSkills.analysis = null;
    try {
      const result = await api.post('/api/novel/skills/analyze', { url }, { timeoutMs: 3 * 60 * 1000 });
      novelSkills.analysis = result.analysis || null;
      if (!result.analysis?.candidates?.length) message.info('仓库中没有找到可直接安装的 SKILL.md');
    } catch (error) {
      message.error(`GitHub 分析失败：${error.message}`);
    } finally {
      novelSkills.analyzing = false;
    }
  }

  async function installNovelGitHubSkill(candidate) {
    const novel = activeNovel.value;
    if (!novel || !candidate) return;
    novelSkills.installingPath = candidate.path || candidate.skillFile || 'root';
    try {
      const result = await api.post('/api/novel/skills/install', {
        url: novelSkills.url,
        candidatePath: candidate.path || '',
        novelId: novel.id,
      }, { timeoutMs: 4 * 60 * 1000 });
      if (result.draft) applyShell(result.draft);
      await loadNovelSkills();
      message.success(`Skill「${result.skill?.name || candidate.name}」已安装并用于当前作品`);
    } catch (error) {
      message.error(`Skill 安装失败：${error.message}`);
    } finally {
      novelSkills.installingPath = '';
    }
  }

  async function removeInstalledNovelSkill(skill) {
    try {
      await messageBox.confirm(`移除 Skill「${skill.name}」？已生成的章节不会改变。`, '移除 Skill', {
        type: 'warning',
        confirmButtonText: '移除',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
    try {
      await api.post('/api/novel/skills/delete', { id: skill.id });
      await setNovelSkillSelected(skill.id, false);
      await loadNovelSkills();
      message.success('Skill 已移除');
    } catch (error) {
      message.error(`Skill 移除失败：${error.message}`);
    }
  }

  function novelMarketItemKey(item) {
    return `${item?.source || novelMarket.source}:${item?.id || ''}`;
  }

  function novelMarketSourceLabel(sourceId) {
    const source = novelMarket.sources.find((item) => item.id === sourceId);
    return source?.shortLabel || source?.label || sourceId || '市场';
  }

  function isNovelMarketItemSelected(item) {
    return novelMarket.selectedIds.includes(novelMarketItemKey(item));
  }

  function setNovelMarketItemSelected(item, enabled) {
    const key = novelMarketItemKey(item);
    const keys = new Set(novelMarket.selectedIds);
    if (enabled) keys.add(key);
    else keys.delete(key);
    novelMarket.selectedIds = [...keys];
    const items = new Map(novelMarket.selectedItems.map((entry) => [novelMarketItemKey(entry), entry]));
    if (enabled) items.set(key, item);
    else items.delete(key);
    novelMarket.selectedItems = [...items.values()].slice(0, 20);
  }

  function formatNovelMarketTime(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '尚未同步';
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  async function loadNovelMarketRankings({ refresh = false } = {}) {
    const novel = activeNovel.value;
    if (!novel) return;
    novelMarket.loading = !refresh;
    novelMarket.refreshing = refresh;
    try {
      const result = await api.get(`/api/novel/market/rankings?source=${encodeURIComponent(novelMarket.source)}&refresh=${refresh ? 1 : 0}&limit=12`);
      novelMarket.ranking = result.ranking || null;
      if (result.ranking?.warning) message.warning(result.ranking.warning);
    } catch (error) {
      message.error(error.message);
    } finally {
      novelMarket.loading = false;
      novelMarket.refreshing = false;
    }
  }

  async function loadNovelMarketSources() {
    try {
      const result = await api.get('/api/novel/market/sources');
      novelMarket.sources = Array.isArray(result.sources)
        ? result.sources.filter((source) => source?.syncMode === 'live')
        : [];
      if (!novelMarket.sources.some((source) => source.id === novelMarket.source)) {
        novelMarket.source = novelMarket.sources[0]?.id || '';
      }
    } catch (error) {
      message.error(`市场来源读取失败：${error.message}`);
    }
  }

  async function loadNovelMarketStudies() {
    const novel = activeNovel.value;
    if (!novel) return;
    try {
      const result = await api.get(`/api/novel/market/studies?id=${encodeURIComponent(novel.id)}`);
      novelMarket.studies = result.studies || [];
      if (!novelMarket.activeStudy && novelMarket.studies.length) novelMarket.activeStudy = novelMarket.studies[0];
    } catch { /* 历史报告不阻塞榜单 */ }
  }

  async function openNovelMarket() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelMarket.visible = true;
    novelMarket.selectedItems = [...(novel.marketContext?.references || [])];
    novelMarket.selectedIds = novelMarket.selectedItems.map(novelMarketItemKey);
    const lab = novel.packagingLab;
    novelMarket.selectedTitleId = lab?.recommendedTitleId || lab?.titles?.[0]?.id || '';
    novelMarket.selectedIntroId = lab?.recommendedIntroId || lab?.intros?.[0]?.id || '';
    await loadNovelMarketSources();
    await Promise.all([loadNovelMarketRankings(), loadNovelMarketStudies()]);
  }

  async function onNovelMarketSourceChange(source) {
    novelMarket.source = String(source || 'fanqie');
    novelMarket.ranking = null;
    await loadNovelMarketRankings();
  }

  async function runNovelMarketStudy() {
    const novel = activeNovel.value;
    const items = selectedNovelMarketItems.value;
    if (!novel || (!items.length && !novelMarket.sampleText.trim())) {
      message.warning('请先选择榜单样本或粘贴拆书文本');
      return;
    }
    novelMarket.studying = true;
    try {
      const result = await api.post('/api/novel/market/study', {
        id: novel.id,
        items,
        sampleText: novelMarket.sampleText,
        instruction: novelMarket.instruction,
      }, { timeoutMs: 5 * 60 * 1000 });
      if (result.draft) applyShell(result.draft);
      novelMarket.activeStudy = result.study || null;
      await loadNovelMarketStudies();
      novelMarket.tab = 'study';
      message.success('拆书规律已注入当前作品');
    } catch (error) {
      message.error(error.message);
    } finally {
      novelMarket.studying = false;
    }
  }

  async function generateNovelPackagingLab() {
    const novel = activeNovel.value;
    if (!novel) return;
    if (!novel.idea || !novel.protagonist) {
      message.warning('至少先补充故事梗概和主角，再生成标题简介');
      return;
    }
    novelMarket.packaging = true;
    try {
      const result = await api.post('/api/novel/market/package', { id: novel.id }, { timeoutMs: 6 * 60 * 1000 });
      if (result.draft) applyShell(result.draft);
      const lab = result.packagingLab || result.draft?.packagingLab;
      novelMarket.selectedTitleId = lab?.recommendedTitleId || lab?.titles?.[0]?.id || '';
      novelMarket.selectedIntroId = lab?.recommendedIntroId || lab?.intros?.[0]?.id || '';
      message.success('标题与简介已完成双模型评审');
    } catch (error) {
      message.error(error.message);
    } finally {
      novelMarket.packaging = false;
    }
  }

  async function applyNovelPackagingSelection() {
    const novel = activeNovel.value;
    if (!novel || (!novelMarket.selectedTitleId && !novelMarket.selectedIntroId)) return;
    novelMarket.applying = true;
    try {
      const result = await api.post('/api/novel/market/package/apply', {
        id: novel.id,
        titleId: novelMarket.selectedTitleId,
        introId: novelMarket.selectedIntroId,
      });
      if (result.draft) applyShell(result.draft);
      message.success('标题与简介已应用');
    } catch (error) {
      message.error(error.message);
    } finally {
      novelMarket.applying = false;
    }
  }

  function novelChatActionLabel(action) {
    const labels = {
      write_next: `续写 ${action.count || 1} 章`,
      rewrite_current: '重写当前章',
      select_chapter: `打开第 ${action.order} 章`,
      open_panel: '打开作品面板',
      set_workspace_mode: '切换工作区',
      generate_cover: '生成封面',
      rebuild_memory: '重建记忆',
      toggle_multi_writer: action.enabled ? '开启多写手' : '关闭多写手',
      open_skill_center: '打开 Skill 中心',
      analyze_github_skill: '分析 GitHub Skill',
      update_book_setup: '更新建书资料',
      generate_blueprint: '生成总框架与卷纲',
      generate_title_options: '生成书名候选',
      create_chapter: `创建第 ${action.order || 1} 章`,
      continue_pipeline: '从断点继续流水线',
    };
    return labels[action.type] || action.type;
  }

  async function generateNovelBlueprint() {
    const novel = activeNovel.value;
    if (!novel) throw new Error('作品不存在');
    if (!novel.setup?.complete) throw new Error(`建书资料尚未完成，下一项是${novel.setup?.nextLabel || '创作信息'}`);
    novelGenerating.creating = true;
    setNovelProgress('正在生成故事总框架…', 5);
    try {
      const result = await api.postStream('/api/novel/create/stream', {
        id: novel.id,
        keepChapters: true,
      }, {
        onProgress: (progress) => setNovelProgress(progress.text || '蓝图生成中…', progress.percentage || 0),
        onEvent: (type, data) => {
          if (type === 'meta' && data?.title) setNovelProgress(`《${data.title}》正在构建卷纲地图…`, 24);
        },
      });
      if (result?.draft) {
        applyShell(result.draft);
        novelUi.deskPanel = 'blueprint';
      }
      clearNovelProgressSoon();
      return result?.draft;
    } catch (error) {
      novelProgress.active = false;
      throw error;
    } finally {
      novelGenerating.creating = false;
    }
  }

  async function continueNovelPipeline() {
    const novel = activeNovel.value;
    if (!novel?.blueprint || novel.blueprint?.legacy) return generateNovelBlueprint();
    const interrupted = novel.chapters.find((chapter) => chapter.pipeline?.status === 'error');
    if (interrupted) return writeNovelChapters({ count: 1, chapterOrder: interrupted.order });
    return writeNovelChapters({ count: 1 });
  }

  async function executeNovelChatAction(action) {
    if (action.type === 'write_next') await writeNovelChapters({ count: action.count || 1 });
    else if (action.type === 'rewrite_current') await rewriteActiveChapter();
    else if (action.type === 'select_chapter') {
      const chapter = activeNovel.value?.chapters.find((item) => item.order === Number(action.order));
      if (!chapter) throw new Error(`第 ${action.order} 章不存在`);
      await openNovelChapterInEditor(chapter.id);
    } else if (action.type === 'open_panel') {
      novelUi.deskPanel = action.panel || 'chapters';
      if (action.panel === 'quality') await openNovelQuality();
    } else if (action.type === 'set_workspace_mode') switchNovelWorkspace(action.mode);
    else if (action.type === 'generate_cover') await generateNovelCover();
    else if (action.type === 'rebuild_memory') await rebuildNovelMemory();
    else if (action.type === 'generate_blueprint') await generateNovelBlueprint();
    else if (action.type === 'create_chapter') await writeNovelChapters({ count: 1, chapterOrder: action.order || 1 });
    else if (action.type === 'continue_pipeline') await continueNovelPipeline();
    else if (action.type === 'update_book_setup' && action.key) {
      const result = await api.post('/api/novel/draft', { id: activeNovel.value.id, [action.key]: action.value });
      if (result.draft) applyShell(result.draft);
    }
    else if (action.type === 'toggle_multi_writer') {
      const novel = activeNovel.value;
      await saveNovelFeatureConfig({
        features: {
          ...novel.features,
          multiWriter: { enabled: action.enabled === true, variants: action.variants || 3, reviewMode: 'score-and-merge' },
        },
        silent: true,
      });
    } else if (action.type === 'open_skill_center') await openNovelSkillCenter();
    else if (action.type === 'analyze_github_skill') {
      novelSkills.url = action.url || '';
      await openNovelSkillCenter();
      await analyzeNovelGitHubSkill();
    }
    return { ok: true, type: action.type, label: novelChatActionLabel(action) };
  }

  async function createNovelChatSession() {
    const novel = activeNovel.value;
    if (!novel || novelChat.sending) return;
    const result = await api.post('/api/novel/chat/session', {
      id: novel.id,
      operation: 'create',
      title: `创作会话 ${novelChat.sessions.length + 1}`,
    });
    applyNovelChatPayload(result.chat || {});
    scrollNovelChatToBottom();
  }

  async function switchNovelChatSession(sessionId) {
    const novel = activeNovel.value;
    if (!novel || novelChat.sending || sessionId === novelChat.activeSessionId) return;
    const result = await api.post('/api/novel/chat/session', {
      id: novel.id,
      operation: 'switch',
      sessionId,
    });
    applyNovelChatPayload(result.chat || {});
    scrollNovelChatToBottom();
  }

  async function renameNovelChatSession(session) {
    const novel = activeNovel.value;
    if (!novel || !session || novelChat.sending) return;
    let title = '';
    try {
      const result = await messageBox.prompt('给这个会话一个便于识别的名称', '重命名会话', {
        inputValue: session.title,
        inputPlaceholder: '例如：第二卷支线推演',
        confirmButtonText: '保存',
        cancelButtonText: '取消',
      });
      title = String(result?.value || '').trim();
    } catch {
      return;
    }
    if (!title) return;
    const result = await api.post('/api/novel/chat/session', {
      id: novel.id,
      operation: 'rename',
      sessionId: session.id,
      title,
    });
    applyNovelChatPayload(result.chat || {});
  }

  async function deleteNovelChatSession(session) {
    const novel = activeNovel.value;
    if (!novel || !session || session.kind === 'setup' || novelChat.sessions.length <= 1 || novelChat.sending) return;
    try {
      await messageBox.confirm(`删除会话“${session.title}”？作品正文和资产不会受影响。`, '删除会话', {
        type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      });
    } catch {
      return;
    }
    const result = await api.post('/api/novel/chat/session', {
      id: novel.id,
      operation: 'delete',
      sessionId: session.id,
    });
    applyNovelChatPayload(result.chat || {});
    scrollNovelChatToBottom();
  }

  async function cancelNovelQueuedMessage(item) {
    const novel = activeNovel.value;
    if (!novel || !item || item.status === 'running') return;
    const result = await api.post('/api/novel/chat/queue', {
      id: novel.id,
      operation: 'cancel',
      queueId: item.id,
    });
    applyNovelChatPayload(result.chat || {});
  }

  async function enqueueNovelInstruction(instruction) {
    const novel = activeNovel.value;
    if (!novel || !instruction) return;
    const result = await api.post('/api/novel/chat/queue', {
      id: novel.id,
      operation: 'add',
      sessionId: novelChat.activeSessionId,
      instruction,
      webSearch: novelChat.webSearchEnabled,
    });
    applyNovelChatPayload(result.chat || {});
    message.info('指令已加入队列');
  }

  async function processNextNovelQueueItem() {
    const novel = activeNovel.value;
    if (!novel || novelChat.sending) return;
    const next = novelChat.queue.find((item) => item.status === 'queued');
    if (!next) return;
    try {
      const result = await api.post('/api/novel/chat/queue', {
        id: novel.id,
        operation: 'take',
      });
      applyNovelChatPayload(result.chat || {});
      const running = novelChat.queue.find((item) => item.id === next.id) || next;
      await processNovelInstruction(running.instruction, {
        queueId: running.id, sessionId: running.sessionId, webSearch: running.webSearch === true,
      });
    } catch (error) {
      message.error(`队列执行失败：${error.message}`);
    }
  }

  async function processNovelInstruction(instruction, {
    queueId = '', sessionId = novelChat.activeSessionId, webSearch = novelChat.webSearchEnabled,
  } = {}) {
    const novel = activeNovel.value;
    if (!novel || !instruction || novelChat.sending) return;
    const optimisticId = `local_${Date.now()}`;
    if (sessionId !== novelChat.activeSessionId) await switchNovelChatSession(sessionId);
    novelChat.messages.push({
      id: optimisticId, role: 'user', content: instruction, choices: [], actions: [], actionResults: [],
      webSearch, status: 'done', createdAt: new Date().toISOString(),
    });
    scrollNovelChatToBottom();
    novelChat.sending = true;
    try {
      const result = await api.post('/api/novel/chat/plan', {
        id: novel.id,
        instruction,
        sessionId: novelChat.activeSessionId,
        webSearch,
      }, { timeoutMs: 3 * 60 * 1000 });
      if (result.draft) applyShell(result.draft);
      if (result.chat) applyNovelChatPayload(result.chat);
      else {
        const localIndex = novelChat.messages.findIndex((item) => item.id === optimisticId);
        if (localIndex >= 0 && result.userMessage) novelChat.messages.splice(localIndex, 1, result.userMessage);
      }
      const assistant = result.assistantMessage || { role: 'assistant', content: result.plan?.reply || '', actions: result.plan?.actions || [] };
      if (assistant.status !== 'error') assistant.status = assistant.actions?.length ? 'running' : 'done';
      const assistantIndex = novelChat.messages.findIndex((item) => item.id === assistant.id);
      if (assistantIndex >= 0) novelChat.messages.splice(assistantIndex, 1, assistant);
      else novelChat.messages.push(assistant);
      scrollNovelChatToBottom();
      const actionResults = [];
      for (const action of assistant.actions || []) {
        try {
          actionResults.push(await executeNovelChatAction(action));
        } catch (error) {
          actionResults.push({ ok: false, type: action.type, label: novelChatActionLabel(action), error: error.message });
        }
      }
      assistant.actionResults = actionResults;
      assistant.status = actionResults.some((item) => item.ok === false) ? 'error' : 'done';
      if (assistant.id && assistant.actions?.length) {
        try {
          await api.post('/api/novel/chat/action-results', {
            id: novel.id,
            sessionId: novelChat.activeSessionId,
            messageId: assistant.id,
            actionResults,
          });
        } catch { /* 执行结果落库失败不影响已完成动作 */ }
      }
      scrollNovelChatToBottom();
    } catch (error) {
      novelChat.messages.push({
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `指令处理失败：${error.message}`,
        actions: [],
        actionResults: [],
        status: 'error',
        createdAt: new Date().toISOString(),
      });
      scrollNovelChatToBottom();
    } finally {
      if (queueId) {
        try {
          const result = await api.post('/api/novel/chat/queue', { id: novel.id, operation: 'done', queueId });
          applyNovelChatPayload(result.chat || {});
        } catch { /* 队列清理可在下次加载时恢复 */ }
      }
      novelChat.sending = false;
      globals.window?.setTimeout?.(() => { void processNextNovelQueueItem(); }, 30);
    }
  }

  async function sendNovelChat() {
    const instruction = novelChat.input.trim();
    if (!activeNovel.value || !instruction) return;
    novelChat.input = '';
    if (novelChat.sending) return enqueueNovelInstruction(instruction);
    return processNovelInstruction(instruction);
  }

  function toggleNovelWebSearch() {
    novelChat.webSearchEnabled = !novelChat.webSearchEnabled;
    try { globals.window?.localStorage?.setItem('gg.novel.web-search', novelChat.webSearchEnabled ? '1' : '0'); } catch { /* ignore */ }
  }

  async function clearNovelConversation() {
    const novel = activeNovel.value;
    if (!novel) return;
    const result = await api.post('/api/novel/chat/clear', { id: novel.id, sessionId: novelChat.activeSessionId });
    applyNovelChatPayload(result.chat || {});
  }

  // ---------- 封面 ----------
  async function loadNovelCoverLibrary() {
    novelCover.libraryLoading = true;
    try {
      const result = await api.get('/api/character-library');
      novelCover.libraryItems = result.items || [];
      novelCover.libraryCategories = result.categories || [];
      novelCover.libraryProjects = result.projects || [];
      novelCover.libraryLoaded = true;
      novelCover.libraryVisibleLimit = 60;
      const availableIds = new Set(novelCover.libraryItems.map((item) => item.id));
      novelCover.selectedLibraryIds = novelCover.selectedLibraryIds.filter((id) => availableIds.has(id));
    } catch (error) {
      message.error(`全局素材图库加载失败：${error.message}`);
    } finally {
      novelCover.libraryLoading = false;
    }
  }

  async function loadNovelCoverCapabilities() {
    novelCover.capabilityLoading = true;
    try {
      const result = await api.get('/api/novel/cover-capabilities');
      novelCover.referenceLimit = Math.max(1, Math.min(
        NOVEL_COVER_REFERENCE_LIMIT,
        Number(result.maxReferenceImages) || 9,
      ));
      if (novelCoverSelectedCount.value > novelCover.referenceLimit) {
        novelCover.selectedLibraryIds = novelCover.selectedLibraryIds.slice(0, novelCover.referenceLimit);
        const localSlots = Math.max(0, novelCover.referenceLimit - novelCover.selectedLibraryIds.length);
        novelCover.localImages = novelCover.localImages.slice(0, localSlots);
      }
    } catch {
      novelCover.referenceLimit = 9;
    } finally {
      novelCover.capabilityLoading = false;
    }
  }

  async function openNovelCoverGenerator() {
    const novel = activeNovel.value;
    if (!novel) return;
    if (novelCover.novelId !== novel.id) {
      novelCover.novelId = novel.id;
      novelCover.ratio = novel.coverRatio || '3:4';
      novelCover.selectedLibraryIds = [];
      novelCover.localImages = [];
      novelCover.query = '';
      novelCover.category = '';
      novelCover.projectId = '';
    }
    novelCover.visible = true;
    await Promise.all([
      loadNovelCoverCapabilities(),
      novelCover.source === 'library' && !novelCover.libraryLoaded ? loadNovelCoverLibrary() : Promise.resolve(),
    ]);
  }

  function onNovelCoverSourceChange(source) {
    if (source === 'library' && !novelCover.libraryLoaded && !novelCover.libraryLoading) {
      void loadNovelCoverLibrary();
    }
  }

  function showMoreNovelCoverLibraryItems() {
    novelCover.libraryVisibleLimit += 60;
  }

  function isNovelCoverLibraryItemSelected(item) {
    return novelCover.selectedLibraryIds.includes(item?.id);
  }

  function toggleNovelCoverLibraryItem(item) {
    if (!item?.id || novelGenerating.cover) return;
    if (isNovelCoverLibraryItemSelected(item)) {
      novelCover.selectedLibraryIds = novelCover.selectedLibraryIds.filter((id) => id !== item.id);
      return;
    }
    if (novelCoverSelectedCount.value >= novelCover.referenceLimit) {
      message.warning(`当前生图模型最多选择 ${novelCover.referenceLimit} 张参考图`);
      return;
    }
    novelCover.selectedLibraryIds = [...novelCover.selectedLibraryIds, item.id];
  }

  function localNovelCoverImageKey(file) {
    return [file?.name, file?.size, file?.lastModified].join(':');
  }

  function localNovelCoverImageBytes(image) {
    return Math.floor((String(image?.imageB64 || '').length * 3) / 4);
  }

  async function addNovelCoverReferenceFiles(fileList) {
    if (novelCover.reading || novelGenerating.cover) return;
    const files = [...(fileList || [])];
    if (!files.length) return;
    novelCover.reading = true;
    const existingKeys = new Set(novelCover.localImages.map((item) => item.fileKey));
    let totalBytes = novelCover.localImages.reduce((sum, item) => sum + localNovelCoverImageBytes(item), 0);
    let added = 0;
    const skipped = [];
    try {
      for (const file of files) {
        if (novelCoverSelectedCount.value >= novelCover.referenceLimit) {
          skipped.push(`当前模型最多 ${novelCover.referenceLimit} 张`);
          break;
        }
        if (!String(file?.type || '').startsWith('image/') && !/\.(?:png|jpe?g|jfif|webp|gif|bmp|avif)$/i.test(String(file?.name || ''))) {
          skipped.push(`${file?.name || '文件'}不是图片`);
          continue;
        }
        if (Number(file?.size) > NOVEL_COVER_REFERENCE_MAX_BYTES) {
          skipped.push(`${file.name}超过 15 MB`);
          continue;
        }
        const fileKey = localNovelCoverImageKey(file);
        if (existingKeys.has(fileKey)) continue;
        try {
          const imageB64 = await readers.readImageAsPngB64(file);
          const bytes = Math.floor((String(imageB64 || '').length * 3) / 4);
          if (!imageB64 || bytes > NOVEL_COVER_REFERENCE_MAX_BYTES) {
            skipped.push(`${file.name}转换后超过 15 MB`);
            continue;
          }
          if (totalBytes + bytes > NOVEL_COVER_REFERENCE_TOTAL_MAX_BYTES) {
            skipped.push('图片总大小超过 48 MB');
            break;
          }
          novelCover.localImages.push({
            id: `cover_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            fileKey,
            name: String(file.name || `本地图片${novelCover.localImages.length + 1}`).slice(0, 80),
            size: Number(file.size) || bytes,
            referenceType: 'character',
            imageB64,
            dataUrl: `data:image/png;base64,${imageB64}`,
          });
          existingKeys.add(fileKey);
          totalBytes += bytes;
          added++;
        } catch (error) {
          skipped.push(`${file.name}读取失败：${error.message}`);
        }
      }
      if (!added && skipped.length) message.warning(skipped[0]);
      else if (skipped.length) message.warning(`已添加 ${added} 张，${skipped[0]}`);
    } finally {
      novelCover.reading = false;
      novelCover.dragging = false;
    }
  }

  async function onPickNovelCoverReferences(event) {
    await addNovelCoverReferenceFiles(event?.target?.files);
    if (event?.target) event.target.value = '';
  }

  function onDropNovelCoverReferences(event) {
    novelCover.dragging = false;
    return addNovelCoverReferenceFiles(event?.dataTransfer?.files);
  }

  function removeNovelCoverLocalImage(id) {
    if (novelGenerating.cover) return;
    novelCover.localImages = novelCover.localImages.filter((item) => item.id !== id);
  }

  function clearNovelCoverReferences() {
    if (novelGenerating.cover) return;
    novelCover.selectedLibraryIds = [];
    novelCover.localImages = [];
  }

  async function generateNovelCover({ silent = false, ratio = novelCover.ratio, referenceIds = [], referenceImages = [] } = {}) {
    const novel = activeNovel.value;
    if (!novel || novelGenerating.cover) return false;
    novelGenerating.cover = true;
    try {
      const result = await api.post('/api/novel/cover', {
        id: novel.id,
        ratio,
        referenceIds,
        referenceImages: referenceImages.map((item) => ({
          name: item.name,
          referenceType: item.referenceType,
          imageB64: item.imageB64,
        })),
      }, { timeoutMs: 6 * 60 * 1000 });
      if (result.draft) applyShell(result.draft);
      if (!silent) message.success(result.referencesUsed ? `封面已生成，使用了 ${result.referencesUsed} 张参考图` : '封面已生成');
      return true;
    } catch (error) {
      if (!silent) message.error(`封面生成失败：${error.message}`);
      return false;
    } finally {
      novelGenerating.cover = false;
    }
  }

  async function submitNovelCoverGeneration() {
    const generated = await generateNovelCover({
      ratio: novelCover.ratio,
      referenceIds: novelCover.selectedLibraryIds,
      referenceImages: novelCover.localImages,
    });
    if (generated) novelCover.visible = false;
  }

  // ---------- 结构编辑 ----------
  function openBlueprintEditor() {
    const bp = activeNovel.value?.blueprint || {};
    novelBlueprintEdit.data = {
      ...JSON.parse(JSON.stringify(bp)),
      worldRulesText: (bp.worldRules || []).join('\n'),
    };
    novelBlueprintEdit.visible = true;
  }

  function addBlueprintAct() {
    const acts = Array.isArray(novelBlueprintEdit.data.acts) ? novelBlueprintEdit.data.acts : [];
    acts.push({ index: acts.length + 1, title: '', goal: '', climax: '', startShare: 0, endShare: 100 });
    novelBlueprintEdit.data.acts = acts;
  }

  async function saveBlueprintEditor() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelBlueprintEdit.saving = true;
    try {
      const data = { ...novelBlueprintEdit.data };
      data.worldRules = String(data.worldRulesText || '').split('\n').map((item) => item.trim()).filter(Boolean);
      delete data.worldRulesText;
      const result = await api.post('/api/novel/structure/save', { id: novel.id, blueprint: data });
      applyShell(result.draft);
      novelBlueprintEdit.visible = false;
      message.success('故事蓝图已保存');
    } catch (error) {
      message.error(`蓝图保存失败：${error.message}`);
    } finally {
      novelBlueprintEdit.saving = false;
    }
  }

  function openCharactersEditor() {
    novelCharactersEdit.items = JSON.parse(JSON.stringify(activeNovel.value?.blueprint?.mainCharacters || []));
    novelCharactersEdit.visible = true;
  }

  function addNovelCharacter() {
    novelCharactersEdit.items.push({ name: '', role: '', desire: '', secret: '', arc: '' });
  }

  async function saveCharactersEditor() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelCharactersEdit.saving = true;
    try {
      const blueprint = { ...(novel.blueprint || {}), mainCharacters: novelCharactersEdit.items };
      const result = await api.post('/api/novel/structure/save', { id: novel.id, blueprint });
      applyShell(result.draft);
      novelCharactersEdit.visible = false;
      message.success('人物档案已保存');
    } catch (error) {
      message.error(`人物保存失败：${error.message}`);
    } finally {
      novelCharactersEdit.saving = false;
    }
  }

  function openChapterCardEditor(chapter = activeChapter.value) {
    if (!chapter) return;
    novelChapterCardEdit.data = {
      ...JSON.parse(JSON.stringify(chapter)),
      plantText: (chapter.plant || []).join('\n'),
      resolveText: (chapter.resolve || []).join('\n'),
    };
    novelChapterCardEdit.visible = true;
  }

  async function saveChapterCardEditor() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelChapterCardEdit.saving = true;
    try {
      const card = { ...novelChapterCardEdit.data };
      card.plant = String(card.plantText || '').split('\n').map((item) => item.trim()).filter(Boolean);
      card.resolve = String(card.resolveText || '').split('\n').map((item) => item.trim()).filter(Boolean);
      const result = await api.post('/api/novel/structure/save', { id: novel.id, chapters: [card] });
      applyShell(result.draft);
      novelChapterCardEdit.visible = false;
      message.success('章节卡已保存');
    } catch (error) {
      message.error(`章节卡保存失败：${error.message}`);
    } finally {
      novelChapterCardEdit.saving = false;
    }
  }

  function openLedgerEditor() {
    novelLedgerEdit.items = JSON.parse(JSON.stringify(activeNovel.value?.ledger || []));
    novelLedgerEdit.visible = true;
  }

  function addLedgerEntry() {
    novelLedgerEdit.items.push({ id: `f${Date.now()}`, content: '', plantedChapter: activeChapter.value?.order || 0, dueChapter: 0, status: 'open', resolvedChapter: 0, notes: [] });
  }

  async function saveLedgerEditor() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelLedgerEdit.saving = true;
    try {
      const result = await api.post('/api/novel/structure/save', { id: novel.id, ledger: novelLedgerEdit.items });
      applyShell(result.draft);
      novelLedgerEdit.visible = false;
      message.success('伏笔账本已保存');
    } catch (error) {
      message.error(`伏笔保存失败：${error.message}`);
    } finally {
      novelLedgerEdit.saving = false;
    }
  }

  // ---------- 局部改稿 ----------
  function openPartialRewrite() {
    const textarea = globals.document?.querySelector?.('.novel-editor textarea');
    const start = Number(textarea?.selectionStart) || 0;
    const end = Number(textarea?.selectionEnd) || 0;
    if (end <= start) {
      message.warning('请先在正文中选择要改写的片段');
      return;
    }
    novelRewrite.start = start;
    novelRewrite.end = end;
    novelRewrite.original = novelEditorText.value.slice(start, end);
    novelRewrite.result = '';
    novelRewrite.instruction = '';
    novelRewrite.mode = 'polish';
    novelRewrite.visible = true;
  }

  async function generatePartialRewrite() {
    const novel = activeNovel.value;
    const chapter = activeChapter.value;
    if (!novel || !chapter || !novelRewrite.original) return;
    novelRewrite.generating = true;
    novelRewrite.result = '';
    try {
      const result = await api.postStream('/api/novel/rewrite/stream', {
        id: novel.id,
        chapterId: chapter.id,
        selectedText: novelRewrite.original,
        mode: novelRewrite.mode,
        instruction: novelRewrite.instruction,
      }, {
        onDelta: (text) => { novelRewrite.result += text; },
      });
      if (result?.text) novelRewrite.result = result.text;
    } catch (error) {
      message.error(`局部改稿失败：${error.message}`);
    } finally {
      novelRewrite.generating = false;
    }
  }

  function applyPartialRewrite() {
    if (!novelRewrite.result) return;
    const before = novelEditorText.value.slice(0, novelRewrite.start);
    const after = novelEditorText.value.slice(novelRewrite.end);
    novelEditorText.value = `${before}${novelRewrite.result}${after}`;
    novelRewrite.visible = false;
    message.success('改稿已应用，将自动保存');
  }

  // ---------- 小说质量中心 ----------
  async function loadNovelQuality() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelQuality.loading = true;
    try {
      const result = await api.get(`/api/novel/quality?id=${encodeURIComponent(novel.id)}`);
      novelQuality.report = result.report;
    } catch (error) {
      message.error(`质量检查失败：${error.message}`);
    } finally {
      novelQuality.loading = false;
    }
  }

  function openNovelQuality() {
    novelUi.deskPanel = 'quality';
    void loadNovelQuality();
  }

  async function rebuildNovelMemory() {
    const novel = activeNovel.value;
    if (!novel || novelQuality.rebuilding) return;
    if (novelSaveState.dirty && !(await persistActiveChapter({ silent: true }))) return;
    novelQuality.rebuilding = true;
    setNovelProgress('准备重建连续性记忆…', 1);
    try {
      const result = await api.postStream('/api/novel/memory/rebuild/stream', { id: novel.id }, {
        onProgress: (progress) => setNovelProgress(progress.text || '重建中…', progress.percentage || 0),
      });
      if (result?.draft) applyShell(result.draft);
      await loadNovelQuality();
      message.success('连续性记忆已重建');
      clearNovelProgressSoon();
    } catch (error) {
      message.error(`记忆重建失败：${error.message}`);
      novelProgress.active = false;
    } finally {
      novelQuality.rebuilding = false;
    }
  }

  // ---------- 简报保存 / 导出 ----------
  async function saveNovelBrief() {
    const novel = activeNovel.value;
    if (!novel) return;
    novelGenerating.saving = true;
    try {
      const result = await api.post('/api/novel/draft', {
        id: novel.id,
        title: novel.title,
        intro: novel.intro,
        genre: novel.genre,
        requirement: novel.requirement,
        coverPrompt: novel.coverPrompt,
      });
      if (result.draft) applyShell(result.draft);
      message.success('作品信息已保存');
    } catch (error) {
      message.error(`保存失败：${error.message}`);
    } finally {
      novelGenerating.saving = false;
    }
  }

  async function exportNovelTxt(work = activeNovel.value) {
    if (!work) return;
    try {
      const result = await api.get(`/api/novel/full?id=${encodeURIComponent(work.id)}`);
      if (!result.text) return message.warning('这部作品还没有正文');
      const safeTitle = String(result.title || '小说').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
      const head = `《${result.title}》\n\n${result.intro || ''}\n\n`;
      downloadText(`${safeTitle}.txt`, head + result.text, globals);
    } catch (error) {
      message.error(`导出失败：${error.message}`);
    }
  }

  function downloadNovelCover(work = activeNovel.value) {
    if (!work?.id || !work.coverUrl) return message.warning('这部作品还没有封面');
    const doc = globals.document;
    if (!doc) return message.error('当前环境不支持下载');
    const link = doc.createElement('a');
    link.href = `/api/novel/cover/${encodeURIComponent(work.id)}.png?download=1`;
    link.download = `${String(work.title || '小说').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}-封面.png`;
    doc.body.appendChild(link);
    link.click();
    link.remove();
    message.success('开始下载封面');
  }

  async function copyNovelText(work = activeNovel.value) {
    if (!work) return;
    try {
      const result = await api.get(`/api/novel/full?id=${encodeURIComponent(work.id)}`);
      if (!result.text) return message.warning('这部作品还没有正文');
      await copyTextToClipboard(result.text, globals);
      message.success('全文已复制');
    } catch (error) {
      message.error(`复制失败：${error.message}`);
    }
  }

  async function flushNovelEdits() {
    if (!novelSaveState.dirty) return true;
    return persistActiveChapter({ silent: true });
  }

  return {
    NOVEL_GENRE_PRESETS,
    NOVEL_COVER_LOCAL_REFERENCE_TYPES,
    NOVEL_COVER_RATIO_OPTIONS,
    novelUi,
    novelCreation,
    novelWorks,
    filteredNovelWorks,
    novelCreationGenreOptions,
    novelCreationEffectiveGenre,
    novelCreationWordRange,
    novelCreationEstimatedChapters,
    novelCreationPreferenceSummary,
    activeNovel,
    activeChapterId,
    activeChapter,
    deskVolumes,
    deskStats,
    openLedger,
    resolvedLedger,
    blueprintView,
    novelEditorText,
    editorWordCount,
    novelGenerating,
    novelProgress,
    novelSaveState,
    novelQuality,
    novelBlueprintEdit,
    novelCharactersEdit,
    novelChapterCardEdit,
    novelLedgerEdit,
    novelRewrite,
    novelCover,
    novelChat,
    novelSkills,
    novelMarket,
    selectedNovelMarketItems,
    filteredNovelCoverLibraryItems,
    visibleNovelCoverLibraryItems,
    selectedNovelCoverLibraryItems,
    novelCoverSelectedCount,
    novelMarketSourceGroups,
    selectedNovelSkills,
    latestNovelRadar,
    novelSetup,
    latestGenerationTrace,
    novelPipelineStages,
    novelPipelineStatusLabel,
    novelCreationSettings,
    loadNovelDrafts,
    openNovelWork,
    backToNovelLibrary,
    deleteNovelWork,
    openNovelCreationChat,
    onNovelCreationModeChange,
    onNovelCreationChannelChange,
    submitNovelCreationMessage,
    startNovelCreation,
    selectNovelChapter,
    openNovelChapterInEditor,
    saveActiveChapter,
    writeNovelChapters,
    writeNextChapters,
    stopNovelWriting,
    rewriteActiveChapter,
    switchNovelWorkspace,
    formatNovelChatTime,
    useNovelChatPrompt,
    useNovelChatChoice,
    sendNovelChat,
    toggleNovelWebSearch,
    clearNovelConversation,
    novelChatActionLabel,
    createNovelChatSession,
    switchNovelChatSession,
    renameNovelChatSession,
    deleteNovelChatSession,
    cancelNovelQueuedMessage,
    generateNovelBlueprint,
    continueNovelPipeline,
    openNovelCreationSettings,
    saveNovelCreationSettings,
    openNovelSkillCenter,
    loadNovelSkills,
    isNovelSkillSelected,
    setNovelSkillSelected,
    analyzeNovelGitHubSkill,
    installNovelGitHubSkill,
    removeInstalledNovelSkill,
    openNovelMarket,
    loadNovelMarketRankings,
    onNovelMarketSourceChange,
    novelMarketSourceLabel,
    isNovelMarketItemSelected,
    setNovelMarketItemSelected,
    formatNovelMarketTime,
    runNovelMarketStudy,
    generateNovelPackagingLab,
    applyNovelPackagingSelection,
    openNovelCoverGenerator,
    loadNovelCoverCapabilities,
    loadNovelCoverLibrary,
    onNovelCoverSourceChange,
    showMoreNovelCoverLibraryItems,
    isNovelCoverLibraryItemSelected,
    toggleNovelCoverLibraryItem,
    addNovelCoverReferenceFiles,
    onPickNovelCoverReferences,
    onDropNovelCoverReferences,
    removeNovelCoverLocalImage,
    clearNovelCoverReferences,
    generateNovelCover,
    submitNovelCoverGeneration,
    openBlueprintEditor,
    addBlueprintAct,
    saveBlueprintEditor,
    openCharactersEditor,
    addNovelCharacter,
    saveCharactersEditor,
    openChapterCardEditor,
    saveChapterCardEditor,
    openLedgerEditor,
    addLedgerEntry,
    saveLedgerEditor,
    openPartialRewrite,
    generatePartialRewrite,
    applyPartialRewrite,
    loadNovelQuality,
    openNovelQuality,
    rebuildNovelMemory,
    saveNovelBrief,
    exportNovelTxt,
    downloadNovelCover,
    copyNovelText,
    flushNovelEdits,
  };
}
