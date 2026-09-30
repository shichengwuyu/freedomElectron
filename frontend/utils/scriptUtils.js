import { detectStoryboardMarker, normalizeShotHeaderPrefix, updateStoryboardShotPrefix } from './shotUtils.js';
import { createStartExtractFromSourceRuntime } from './extractFlow.js';
import { requireGeneratedEpisode } from './pipelineGuards.js';

export function episodeReferencesChapter(episode = {}, chapterId) {
  const targetId = Number(chapterId);
  if (Number(episode?.chapterId) === targetId) return true;
  return Array.isArray(episode?.sourceRanges)
    && episode.sourceRanges.some((range) => Number(range?.chapterId) === targetId);
}

export function invalidateWholeNovelRuntimeState(scriptState = {}) {
  scriptState.wholeNovelBible = null;
  scriptState.wholeNovelStageBibles = [];
  scriptState.wholeNovelEpisodePlan = null;
  scriptState.wholeNovelAdapted = false;
  scriptState.wholeNovelPlanningStale = true;
}

export function clearEpisodeGeneratedState(scriptState = {}, scriptUi = {}, episodeId, { clearScript = true } = {}) {
  const targetId = String(episodeId);
  const previousStoryboards = Array.isArray(scriptState.storyboards) ? scriptState.storyboards : [];
  scriptState.storyboards = previousStoryboards.filter(
    (storyboard) => String(storyboard?.episodeId) !== targetId,
  );
  const episode = (Array.isArray(scriptState.episodes) ? scriptState.episodes : [])
    .find((item) => String(item?.id) === targetId);
  let clearedScript = false;
  if (clearScript && episode) {
    episode.content = '';
    delete episode.continuityStateBefore;
    delete episode.continuityStateAfter;
    delete episode.finalReview;
    delete episode.sourceSignature;
    clearedScript = true;
    if (scriptUi?.episodeSrcSig && Object.prototype.hasOwnProperty.call(scriptUi.episodeSrcSig, targetId)) {
      delete scriptUi.episodeSrcSig[targetId];
    }
  }
  return {
    removedStoryboardCount: previousStoryboards.length - scriptState.storyboards.length,
    clearedScript,
  };
}

export function createScriptUiStateRuntime({ reactive, ref } = {}) {
  const scriptState = reactive({
    chapters: [],
    episodes: [],
    storyboards: [],
    wholeNovelBible: null,
    wholeNovelStageBibles: [],
    wholeNovelEpisodePlan: null,
    wholeNovelAdapted: false,
    wholeNovelPlanningStale: false,
    extractedSigs: {},
    settings: {
      useColdOpen: true,
      useEpisodeHook: true,
      usePurification: true,
      useLongScript: false,
      useContentReview: false,
      useDramaReview: true,
      useEpisodeFinalReview: true,
      adaptationStrength: 'enhanced',
      useQVersion: true,
      hideStoryboardPrompts: false,
      scriptPromptMode: 'builtin',
      storyboardPromptMode: 'builtin',
      selectedScriptPromptId: '',
      selectedStoryboardPromptId: '',
    },
  });
  const scriptUI = reactive({
    stage: 'script',
    selectedId: '',
    focusWriting: false,
    addingChapter: false,
    draftTitle: '',
    draftText: '',
    importingEpisode: false,
    importTitle: '',
    importContent: '',
    importing: false,
    importingNovel: false,
    novelImportProgress: '',
    adaptingWholeNovel: false,
    wholeAdaptProgress: '',
    importingStoryboard: false,
    sbImportMarker: '分镜',
    sbImportTitle: '',
    sbImportContent: '',
    sbMarkerTouched: false,
    sbImportDragOver: false,
    importingSb: false,
    splitting: 0,
    genWhole: 0,
    genEpisode: 0,
    deletingEpisode: 0,
    scriptProgress: null,
    generatingAll: false,
    batchGen: {
      active: false,
      cancel: false,
      total: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      currentEpisodeId: 0,
      currentTitle: '',
      onlyUnfinished: false,
    },
    genStoryboard: 0,
    // 并发生成分镜时记录所有正在生成的集 id；genStoryboard 单值保留兼容旧 UI（指向最近一个）
    genStoryboardSet: [],
    storyboardProgress: null,
    storyboardMode: 'normal',
    sbPanel: '',
    customPromptPanel: false,
    settingsPanel: false,
    saveState: 'idle',
    episodeSrcSig: {},
  });
  return {
    scriptState,
    scriptUI,
    scriptDragOver: ref(false),
  };
}

export function chapterSig(text) {
  const s = String(text || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((Math.imul(h, 33) + s.charCodeAt(i)) >>> 0);
  return `${s.length}_${h.toString(36)}`;
}

export function makePromptId(prefix = 'prompt') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeCustomPromptList(list, legacyPrompt = '', prefix = 'prompt') {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const content = String(item?.content ?? item?.prompt ?? '').trim();
    const id = String(item?.id || makePromptId(prefix)).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(item?.name || `自定义${out.length + 1}`).trim() || `自定义${out.length + 1}`,
      content,
    });
  }
  const legacy = String(legacyPrompt || '').trim();
  if (legacy && !out.some((item) => item.content === legacy)) {
    out.push({ id: makePromptId(prefix), name: `自定义${out.length + 1}`, content: legacy });
  }
  return out;
}

export function promptLibraryList(config = {}, kind) {
  const lib = config.promptLibrary || {};
  return kind === 'script'
    ? (Array.isArray(lib.scriptPrompts) ? lib.scriptPrompts : [])
    : (Array.isArray(lib.storyboardPrompts) ? lib.storyboardPrompts : []);
}

export function selectedCustomPrompt(config = {}, settings = {}, kind) {
  const isScript = kind === 'script';
  const list = promptLibraryList(config, kind);
  const selectedId = isScript ? settings.selectedScriptPromptId : settings.selectedStoryboardPromptId;
  return (list || []).find((item) => item.id === selectedId) || null;
}

export function requireActiveCustomPromptState({ enabled = false, prompt = '', kind = 'script' } = {}, handlers = {}) {
  if (!enabled) return true;
  if (String(prompt || '').trim()) return true;
  const message = kind === 'script'
    ? 'Please select and fill a custom script prompt first'
    : 'Please select and fill a custom storyboard prompt first';
  handlers.warning(message);
  if (handlers.throwOnError) throw new Error(message);
  return false;
}

export function createRequireActiveCustomPromptRuntime({ message, refs = {} } = {}) {
  return (kind, throwOnError = false) => {
    const isScript = kind === 'script';
    return requireActiveCustomPromptState({
      enabled: isScript ? refs.isCustomScriptPromptMode.value : refs.isCustomStoryboardPromptMode.value,
      prompt: isScript ? refs.activeScriptCustomPrompt.value : refs.activeStoryboardCustomPrompt.value,
      kind,
    }, {
      throwOnError,
      warning: (text) => message.warning(text),
    });
  };
}

export function addCustomPromptState(kind, list = []) {
  const item = {
    id: makePromptId(kind === 'script' ? 'script_prompt' : 'storyboard_prompt'),
    name: `Custom ${(list || []).length + 1}`,
    content: '',
  };
  list.push(item);
  return item;
}

export function ensureSelectedPrompt(config = {}, settings = {}, kind) {
  const isScript = kind === 'script';
  const list = promptLibraryList(config, kind);
  const key = isScript ? 'selectedScriptPromptId' : 'selectedStoryboardPromptId';
  if (!(list || []).length) {
    settings[key] = '';
    return;
  }
  if (!list.some((item) => item.id === settings[key])) {
    settings[key] = list[0].id;
  }
}

export function normalizePromptMode(config = {}, settings = {}, kind) {
  const isScript = kind === 'script';
  const modeKey = isScript ? 'scriptPromptMode' : 'storyboardPromptMode';
  const list = promptLibraryList(config, kind);
  if (settings[modeKey] === 'custom' && !(list || []).length) {
    settings[modeKey] = 'builtin';
  }
  ensureSelectedPrompt(config, settings, kind);
}

export async function importCustomPromptFilesFlow(kind, event, handlers = {}) {
  const files = [...(event?.target?.files || [])].filter(Boolean);
  if (event?.target) event.target.value = '';
  if (!files.length) return;
  const list = handlers.promptLibraryList(kind);
  let lastId = '';
  let imported = 0;
  for (const file of files) {
    const content = String(await handlers.readFileAsText(file)).trim();
    if (!content) continue;
    const baseName = String(file.name || '').replace(/\.[^.]+$/, '').trim();
    const item = {
      id: makePromptId(kind === 'script' ? 'script_prompt' : 'storyboard_prompt'),
      name: baseName || `自定义${list.length + 1}`,
      content,
    };
    list.push(item);
    lastId = item.id;
    imported += 1;
  }
  if (lastId) {
    handlers.selectPrompt(kind, lastId);
    await handlers.saveSettings();
    handlers.success(`已导入 ${imported} 个提示词`);
  }
}

export function createImportCustomPromptFilesRuntime({ message, refs = {}, readers = {}, helpers = {} } = {}) {
  return (kind, event) => importCustomPromptFilesFlow(kind, event, {
    promptLibraryList: (promptKind) => promptLibraryList(refs.config, promptKind),
    readFileAsText: readers.readFileAsText,
    selectPrompt: (promptKind, promptId) => {
      refs.promptKind.value = promptKind;
      refs.selectedPromptId.value = promptId;
    },
    saveSettings: helpers.saveSettings,
    success: (text) => message.success(text),
  });
}

export function createScriptPromptUiRuntime({ config = {}, settings = {}, refs = {}, readers = {}, helpers = {}, debounceMs = 600 } = {}) {
  const currentSettings = () => (refs.scriptState?.settings || (typeof settings === 'function' ? settings() : settings));
  const listForKind = (kind) => promptLibraryList(config, kind);
  const selectedForKind = (kind) => selectedCustomPrompt(config, currentSettings(), kind);
  const ensureForKind = (kind) => ensureSelectedPrompt(config, currentSettings(), kind);
  const normalizeForKind = (kind) => normalizePromptMode(config, currentSettings(), kind);
  let settingsPromptSaveTimer = null;
  const saveSettingsDebounced = () => {
    clearTimeout(settingsPromptSaveTimer);
    settingsPromptSaveTimer = setTimeout(() => { helpers.saveSettings?.(); }, debounceMs);
  };

  return {
    promptLibraryList: listForKind,
    selectedCustomPrompt: selectedForKind,
    ensureSelectedPrompt: ensureForKind,
    normalizePromptMode: normalizeForKind,
    onPromptModeChange: (kind) => {
      normalizeForKind(kind);
      helpers.saveScript?.();
    },
    activateCustomPrompt: (kind, id = '') => {
      const current = currentSettings();
      const isScript = kind === 'script';
      const key = isScript ? 'selectedScriptPromptId' : 'selectedStoryboardPromptId';
      const target = (listForKind(kind) || []).find((item) => item.id === id)
        || (listForKind(kind) || []).find((item) => item.id === current[key])
        || (listForKind(kind) || [])[0];
      if (!target) return;
      current[isScript ? 'scriptPromptMode' : 'storyboardPromptMode'] = 'custom';
      current[key] = target.id;
      normalizeForKind(kind);
      helpers.saveSettings?.();
      helpers.saveScript?.();
    },
    useBuiltinPrompt: (kind) => {
      const current = currentSettings();
      const isScript = kind === 'script';
      current[isScript ? 'scriptPromptMode' : 'storyboardPromptMode'] = 'builtin';
      normalizeForKind(kind);
      helpers.saveScript?.();
    },
    addCustomPrompt: (kind) => {
      const item = addCustomPromptState(kind, listForKind(kind));
      refs.promptKind.value = kind;
      refs.selectedPromptId.value = item.id;
      helpers.saveSettings?.();
    },
    deleteCustomPrompt: (kind) => {
      const list = listForKind(kind);
      const index = (list || []).findIndex((item) => item.id === refs.selectedPromptId.value);
      if (index < 0) return;
      list.splice(index, 1);
      refs.selectedPromptId.value = list[0]?.id || '';
      normalizeForKind(kind);
      helpers.saveSettings?.();
    },
    importCustomPromptFiles: (kind, event) => importCustomPromptFilesFlow(kind, event, {
      promptLibraryList: listForKind,
      readFileAsText: readers.readFileAsText,
      selectPrompt: (promptKind, promptId) => {
        refs.promptKind.value = promptKind;
        refs.selectedPromptId.value = promptId;
      },
      saveSettings: helpers.saveSettings,
      success: (text) => helpers.success?.(text),
    }),
    selectSettingsPrompt: (id) => { refs.selectedPromptId.value = id; },
    onSettingsPromptKindChange: () => {
      const list = listForKind(refs.promptKind.value);
      if (!list.some((item) => item.id === refs.selectedPromptId.value)) {
        refs.selectedPromptId.value = list[0]?.id || '';
      }
    },
    onSettingsPromptEdit: saveSettingsDebounced,
    saveSettingsDebounced,
  };
}

export function createScriptPromptStateRuntime({ refs = {}, helpers = {}, computed } = {}) {
  const selectedScriptCustomPrompt = computed(() => helpers.selectedCustomPrompt('script'));
  const selectedStoryboardCustomPrompt = computed(() => helpers.selectedCustomPrompt('storyboard'));
  const activeScriptCustomPrompt = computed(() => (
    refs.scriptState.settings.scriptPromptMode === 'custom' ? (selectedScriptCustomPrompt.value?.content || '') : ''
  ));
  const activeStoryboardCustomPrompt = computed(() => (
    refs.scriptState.settings.storyboardPromptMode === 'custom' ? (selectedStoryboardCustomPrompt.value?.content || '') : ''
  ));
  const isCustomScriptPromptMode = computed(() => refs.scriptState.settings.scriptPromptMode === 'custom');
  const isCustomStoryboardPromptMode = computed(() => refs.scriptState.settings.storyboardPromptMode === 'custom');
  const settingsPromptList = computed(() => helpers.promptLibraryList(refs.promptKind.value));
  const settingsSelectedPrompt = computed(() => (
    settingsPromptList.value.find((item) => item.id === refs.selectedPromptId.value) || null
  ));
  const promptStatusText = (kind) => {
    const isScript = kind === 'script';
    const mode = isScript ? refs.scriptState.settings.scriptPromptMode : refs.scriptState.settings.storyboardPromptMode;
    if (mode !== 'custom') return '内置';
    const item = isScript ? selectedScriptCustomPrompt.value : selectedStoryboardCustomPrompt.value;
    if (!item) return '自定义未选择';
    if (!String(item.content || '').trim()) return `自定义未填写 · ${item.name || '未命名'}`;
    return `自定义 · ${item.name || '未命名'}`;
  };
  const scriptPromptStatusText = computed(() => promptStatusText('script'));
  const storyboardPromptStatusText = computed(() => promptStatusText('storyboard'));
  const settingsSelectedPromptActive = computed(() => {
    const id = refs.selectedPromptId.value;
    if (!id) return false;
    const isScript = refs.promptKind.value === 'script';
    const current = refs.scriptState.settings;
    return current[isScript ? 'scriptPromptMode' : 'storyboardPromptMode'] === 'custom'
      && current[isScript ? 'selectedScriptPromptId' : 'selectedStoryboardPromptId'] === id;
  });
  const settingsPromptUsageText = computed(() => {
    const kindLabel = refs.promptKind.value === 'script' ? '剧本' : '分镜';
    if (settingsSelectedPromptActive.value && !String(settingsSelectedPrompt.value?.content || '').trim()) {
      return `当前项目已切到这条自定义${kindLabel}提示词，但内容为空`;
    }
    return settingsSelectedPromptActive.value
      ? `当前项目生成${kindLabel}时会使用这条自定义提示词`
      : `这条提示词只保存在库里，当前项目生成${kindLabel}时不会使用它`;
  });
  const adaptationStrengthHint = computed(() => {
    const value = refs.scriptState.settings.adaptationStrength || 'enhanced';
    if (value === 'faithful') return '忠实改编：适合高保真原文转写，保留事件顺序、人物关系和因果，只做剧本化与必要压缩。';
    if (value === 'rewrite') return '二创重构：适合原文节奏弱时重做短剧结构，只保留核心设定和人物逻辑，可能明显偏离原文表达。';
    return '短剧强化：默认推荐，保留主线和人物关系，允许前置钩子、强化情绪、合并弱节拍。';
  });
  const scriptSettingComboHint = computed(() => {
    const settings = refs.scriptState.settings || {};
    const strength = settings.adaptationStrength || 'enhanced';
    const useColdOpen = settings.useColdOpen !== false;
    const usePurification = settings.usePurification !== false;
    const useEpisodeHook = settings.useEpisodeHook !== false;
    if (strength === 'enhanced' && useColdOpen && usePurification) {
      return `当前组合：短剧强化 + 冷开场 + 精准提纯。仅全书第一集使用冷开场；${useEpisodeHook ? '每集独立保留追看动力' : '单集结尾允许自然收束'}。`;
    }
    if (usePurification && settings.useLongScript) {
      return '提示：精准提纯 + 长剧本会拉扯，系统会优先保留因果和情绪递进，再做不注水扩写。';
    }
    if (strength === 'faithful' && useColdOpen) {
      return '提示：忠实改编 + 冷开场只作用于全书第一集，会调整开头顺序但不会虚构新事实。';
    }
    if (strength === 'rewrite' && settings.useContentReview) {
      return '提示：二创重构 + 内容审核会限制高风险刺激内容，优先保证合规表达。';
    }
    return '';
  });
  const onScriptSettingChange = () => helpers.saveScriptDebounced();
  const onScriptContentChange = () => {
    const selectedId = String(refs.scriptUi?.selectedId || '');
    const episodeMatch = selectedId.match(/^ep:(.+)$/);
    if (episodeMatch) helpers.clearEpisodeOutputs?.(episodeMatch[1]);
    helpers.saveScriptDebounced();
  };

  return {
    selectedScriptCustomPrompt,
    selectedStoryboardCustomPrompt,
    activeScriptCustomPrompt,
    activeStoryboardCustomPrompt,
    isCustomScriptPromptMode,
    isCustomStoryboardPromptMode,
    settingsPromptList,
    settingsSelectedPrompt,
    scriptPromptStatusText,
    storyboardPromptStatusText,
    settingsSelectedPromptActive,
    settingsPromptUsageText,
    adaptationStrengthHint,
    scriptSettingComboHint,
    onScriptSettingChange,
    onScriptContentChange,
  };
}

export function createScriptPromptActionsRuntime({
  api,
  message,
  config = {},
  refs = {},
  readers = {},
  helpers = {},
  computed,
  } = {}) {
  let saveScriptDebounced = () => {};
  const clearEpisodeOutputs = (episodeId) => {
    clearEpisodeGeneratedState(refs.scriptState, refs.scriptUi, episodeId, { clearScript: false });
    helpers.clearEpisodeVideoState?.(episodeId);
  };
  const promptActions = createScriptPromptUiRuntime({
    config,
    refs,
    readers,
    helpers: {
      saveSettings: helpers.saveSettings,
      saveScript: () => saveScriptDebounced(),
      success: message.success,
    },
  });
  const { saveNow: saveScriptNow, saveDebounced } = createScriptSaveRuntime({
    api,
    refs: { project: refs.project, scriptState: refs.scriptState, scriptUi: refs.scriptUi },
  });
  saveScriptDebounced = saveDebounced;
  const promptState = createScriptPromptStateRuntime({
    computed,
    refs,
    helpers: {
      promptLibraryList: promptActions.promptLibraryList,
      selectedCustomPrompt: promptActions.selectedCustomPrompt,
      saveScriptDebounced,
      clearEpisodeOutputs,
    },
  });
  const requireActiveCustomPrompt = createRequireActiveCustomPromptRuntime({
    message,
    refs: {
      isCustomScriptPromptMode: promptState.isCustomScriptPromptMode,
      isCustomStoryboardPromptMode: promptState.isCustomStoryboardPromptMode,
      activeScriptCustomPrompt: promptState.activeScriptCustomPrompt,
      activeStoryboardCustomPrompt: promptState.activeStoryboardCustomPrompt,
    },
  });

  return {
    ...promptActions,
    ...promptState,
    saveScriptNow,
    saveScriptDebounced,
    requireActiveCustomPrompt,
  };
}

export function migrateLegacyProjectPrompts(scriptData = {}, config = {}) {
  let changed = false;
  const merge = (kind, legacyList, legacyPrompt, prefix) => {
    const incoming = normalizeCustomPromptList(legacyList, legacyPrompt, prefix);
    if (!incoming.length) return;
    const target = promptLibraryList(config, kind);
    const ids = new Set(target.map((item) => item.id));
    const contents = new Set(target.map((item) => item.content.trim()));
    for (const item of incoming) {
      if (ids.has(item.id) || contents.has(item.content.trim())) continue;
      target.push(item);
      ids.add(item.id);
      contents.add(item.content.trim());
      changed = true;
    }
  };
  merge('script', scriptData.settings?.customScriptPrompts, scriptData.settings?.customScriptPrompt, 'script_prompt');
  merge('storyboard', scriptData.settings?.customStoryboardPrompts, scriptData.settings?.customStoryboardPrompt, 'storyboard_prompt');
  return changed;
}

export function createScriptSaveRuntime({ api, refs = {}, debounceMs = 800 } = {}) {
  let saveTimer = null;
  let savedTimer = null;
  // 增量保存基线：上次成功保存时每个集/分镜的序列化快照。只有和基线不同的
  // 条目才进请求体，服务端用 id 名单还原完整结构；换项目自动清空（首拍全量）。
  let baseline = { projectId: '', episodes: new Map(), storyboards: new Map(), extras: new Map() };
  const snapshotOf = (value) => {
    try { return JSON.stringify(value) ?? ''; } catch { return ''; }
  };
  const setSaveState = (value) => {
    const ui = refs.scriptUi;
    if (ui) ui.saveState = value;
  };
  const saveNow = async (extra = {}) => {
    if (!refs.project.value) return null;
    const projectId = refs.project.value.id;
    clearTimeout(saveTimer);
    setSaveState('saving');
    try {
      if (baseline.projectId !== String(projectId)) {
        baseline = { projectId: String(projectId), episodes: new Map(), storyboards: new Map(), extras: new Map() };
      }
      const episodes = Array.isArray(refs.scriptState.episodes) ? refs.scriptState.episodes : [];
      const storyboards = Array.isArray(refs.scriptState.storyboards) ? refs.scriptState.storyboards : [];
      const sentEpisodeSnaps = new Map();
      const changedEpisodes = [];
      for (const episode of episodes) {
        if (!episode || episode.id == null) continue;
        const key = String(episode.id);
        const snap = snapshotOf(episode);
        sentEpisodeSnaps.set(key, snap);
        if (baseline.episodes.get(key) !== snap) changedEpisodes.push(episode);
      }
      const sentStoryboardSnaps = new Map();
      const changedStoryboards = [];
      for (const storyboard of storyboards) {
        if (!storyboard || storyboard.episodeId == null) continue;
        const key = String(storyboard.episodeId);
        const snap = snapshotOf(storyboard);
        sentStoryboardSnaps.set(key, snap);
        if (baseline.storyboards.get(key) !== snap) changedStoryboards.push(storyboard);
      }
      const payload = {
        projectId,
        settings: refs.scriptState.settings,
        episodeIds: episodes.filter((episode) => episode && episode.id != null).map((episode) => episode.id),
        changedEpisodes,
        storyboardEpisodeIds: storyboards.filter((storyboard) => storyboard && storyboard.episodeId != null).map((storyboard) => storyboard.episodeId),
        changedStoryboards,
        wholeNovelAdapted: refs.scriptState.wholeNovelAdapted,
      };
      const pendingExtras = new Map();
      pendingExtras.set('settings', snapshotOf(refs.scriptState.settings));
      for (const field of ['wholeNovelBible', 'wholeNovelStageBibles', 'wholeNovelEpisodePlan']) {
        const snap = snapshotOf(refs.scriptState[field]);
        if (baseline.extras.get(field) !== snap) {
          payload[field] = refs.scriptState[field];
          pendingExtras.set(field, snap);
        }
      }
      // 结构（含顺序）、内容、设置都和基线一致且没有附加字段时，这一拍没有东西要存
      const structureUnchanged = [...baseline.episodes.keys()].join('') === [...sentEpisodeSnaps.keys()].join('')
        && [...baseline.storyboards.keys()].join('') === [...sentStoryboardSnaps.keys()].join('');
      const nothingChanged = structureUnchanged
        && !changedEpisodes.length
        && !changedStoryboards.length
        && !pendingExtras.has('wholeNovelBible') && !pendingExtras.has('wholeNovelStageBibles') && !pendingExtras.has('wholeNovelEpisodePlan')
        && baseline.extras.get('settings') === pendingExtras.get('settings')
        && baseline.extras.get('wholeNovelAdapted') === snapshotOf(refs.scriptState.wholeNovelAdapted)
        && Object.keys(extra).length === 0;
      if (nothingChanged) {
        setSaveState('saved');
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => setSaveState('idle'), 2000);
        return null;
      }
      const result = await api.post('/api/script/source', { ...payload, ...extra });
      if (String(refs.project.value?.id || '') === String(projectId)) {
        reconcilePersistedStoryboards(
          refs.scriptState.storyboards,
          result?.script?.storyboards,
          result?.storyboardConflicts,
        );
        // 成功后以"本次发出去的内容"推进基线；请求期间产生的新编辑
        // 与基线不同，会在下一拍被正常发现并保存。
        baseline.episodes = sentEpisodeSnaps;
        baseline.storyboards = sentStoryboardSnaps;
        for (const [field, snap] of pendingExtras) baseline.extras.set(field, snap);
        baseline.extras.set('wholeNovelAdapted', snapshotOf(refs.scriptState.wholeNovelAdapted));
        // 冲突分镜已被 reconcile 换成服务端版本；服务端新增的分镜也刚拉进本地。
        // 基线同步为当前本地值，避免下一拍把它们误判为改动再回传。
        const reconciledKeys = new Set([
          ...(result?.storyboardConflicts || []).map((key) => String(key)),
          ...(result?.script?.storyboards || [])
            .map((storyboard) => String(storyboard?.episodeId))
            .filter((key) => !sentStoryboardSnaps.has(key)),
        ]);
        for (const key of reconciledKeys) {
          const local = refs.scriptState.storyboards.find((storyboard) => String(storyboard?.episodeId) === key);
          if (local) baseline.storyboards.set(key, snapshotOf(local));
          else baseline.storyboards.delete(key);
        }
      }
      setSaveState('saved');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => setSaveState('idle'), 2000);
      return result;
    } catch (error) {
      setSaveState('idle');
      throw error;
    }
  };
  const saveDebounced = (extra = {}) => {
    if (!refs.project.value) return;
    clearTimeout(saveTimer);
    setSaveState('saving');
    saveTimer = setTimeout(() => {
      saveNow(extra);
    }, debounceMs);
  };
  return { saveNow, saveDebounced };
}

export function reconcilePersistedStoryboards(localStoryboards = [], persistedStoryboards = [], conflictEpisodeIds = []) {
  if (!Array.isArray(localStoryboards) || !Array.isArray(persistedStoryboards)) return localStoryboards;
  const conflicts = new Set((Array.isArray(conflictEpisodeIds) ? conflictEpisodeIds : []).map(String));
  for (const persisted of persistedStoryboards) {
    if (!persisted || persisted.episodeId == null) continue;
    const index = localStoryboards.findIndex((item) => String(item?.episodeId) === String(persisted.episodeId));
    if (index < 0) {
      localStoryboards.push(normalizeRuntimeStoryboard(persisted));
      continue;
    }
    if (conflicts.has(String(persisted.episodeId))) {
      localStoryboards.splice(index, 1, normalizeRuntimeStoryboard(persisted));
      continue;
    }
    if (persisted.revision) localStoryboards[index].revision = persisted.revision;
    if (persisted.updatedAt) localStoryboards[index].updatedAt = persisted.updatedAt;
  }
  sortStoryboards(localStoryboards);
  return localStoryboards;
}

export function chaptersSorted(chapters = []) {
  return chapters.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function episodesOfChapter(episodes = [], chapterId) {
  return episodes.filter((e) => e.chapterId === chapterId && e.sourceMode !== 'wholeNovel').sort((a, b) => a.id - b.id);
}

export function episodesSorted(episodes = []) {
  return episodes.slice().sort((a, b) => a.id - b.id);
}

export function findEpisode(episodes = [], id) {
  return episodes.find((e) => e.id === id);
}

export function findChapter(chapters = [], id) {
  return chapters.find((c) => c.id === id);
}

export function findStoryboard(storyboards = [], episodeId) {
  return storyboards.find((s) => s.episodeId === episodeId);
}

const activeStoryboardDrafts = new Map();

function storyboardDraftKey(projectId, episodeId) {
  return `${String(projectId || '')}:${String(episodeId || '')}`;
}

function sortStoryboards(storyboards = []) {
  storyboards.sort((a, b) => Number(a.episodeId) - Number(b.episodeId));
}

function normalizeRuntimeStoryboard(storyboard = {}) {
  const { active: _active, projectId: _projectId, ...publicStoryboard } = storyboard;
  return {
    ...publicStoryboard,
    manualTags: (storyboard.manualTags && typeof storyboard.manualTags === 'object') ? storyboard.manualTags : {},
    excludedTags: (storyboard.excludedTags && typeof storyboard.excludedTags === 'object') ? storyboard.excludedTags : {},
  };
}

function upsertStoryboard(storyboards = [], storyboard = {}) {
  const normalized = normalizeRuntimeStoryboard(storyboard);
  const index = storyboards.findIndex((item) => String(item.episodeId) === String(normalized.episodeId));
  if (index >= 0) storyboards.splice(index, 1, normalizeRuntimeStoryboard({ ...storyboards[index], ...normalized }));
  else storyboards.push(normalized);
  sortStoryboards(storyboards);
  return storyboards.find((item) => String(item.episodeId) === String(normalized.episodeId));
}

function setActiveStoryboardDraft(projectId, episodeId, draft) {
  activeStoryboardDrafts.set(storyboardDraftKey(projectId, episodeId), {
    ...normalizeRuntimeStoryboard(draft),
    projectId,
    episodeId,
    active: true,
  });
}

function updateActiveStoryboardDraft(projectId, episodeId, patch = {}) {
  const key = storyboardDraftKey(projectId, episodeId);
  const current = activeStoryboardDrafts.get(key);
  if (!current?.active) return null;
  Object.assign(current, patch);
  return current;
}

function clearActiveStoryboardDraft(projectId, episodeId) {
  activeStoryboardDrafts.delete(storyboardDraftKey(projectId, episodeId));
}

function mergeActiveStoryboardDrafts(projectId, storyboards = []) {
  for (const draft of activeStoryboardDrafts.values()) {
    if (!draft?.active || String(draft.projectId || '') !== String(projectId || '')) continue;
    upsertStoryboard(storyboards, draft);
  }
}

export function sourceLength(chapters = []) {
  return chapters.reduce((n, c) => n + (c.sourceText || '').length, 0);
}

export function segmentProgressPercentage(index, total, status, previous = 0, clampProgress = (value) => value) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeIndex = Math.min(safeTotal - 1, Math.max(0, Number(index) || 0));
  const start = (safeIndex / safeTotal) * 100;
  const end = ((safeIndex + 1) / safeTotal) * 100;
  if (status === 'done') return clampProgress(Math.min(99, end));
  const floor = start + Math.max(3, Math.min(10, (end - start) * 0.12));
  return clampProgress(Math.max(previous || 0, floor));
}

export function nudgeSegmentProgress(progress, clampProgress = (value) => value) {
  if (!progress || progress.status === 'done') return;
  const total = Math.max(1, Number(progress.total) || 1);
  const index = Math.min(total - 1, Math.max(0, Number(progress.index) || 0));
  const start = (index / total) * 100;
  const end = ((index + 1) / total) * 100;
  const cap = Math.min(99, end - Math.max(1, Math.min(6, (end - start) * 0.08)));
  const current = Number(progress.percentage) || 0;
  if (current >= cap) return;
  progress.percentage = clampProgress(Math.min(cap, current + Math.max(1, (cap - current) * 0.025)));
}

export function scriptProgressStateForEpisode(episodeId, progress = {}, previousProgress = null, segmentProgressPercentage) {
  if (progress.phase === 'script_coverage' || progress.phase === 'script_coverage_final' || progress.phase === 'script_drama_quality') {
    const total = Math.max(1, Number(progress.total) || 1);
    const index = Math.min(total - 1, Math.max(0, Number(progress.index) || 0));
    const previous = previousProgress?.episodeId === episodeId ? previousProgress.percentage : 0;
    const percentage = segmentProgressPercentage(index, total, progress.status, previous);
    const label = progress.phase === 'script_drama_quality'
      ? '短剧质量审稿'
      : (progress.phase === 'script_coverage_final' ? '覆盖复检' : '覆盖校验');
    const statusText = progress.status === 'repairing'
      ? `正在修复第 ${index + 1}/${total} 段`
      : (progress.status === 'repair_done'
        ? `已修复第 ${index + 1}/${total} 段`
        : (progress.status === 'review_done'
          ? `已完成第 ${index + 1}/${total} 段`
          : `正在处理第 ${index + 1}/${total} 段`));
    return {
      episodeId,
      total,
      index,
      status: progress.status || 'running',
      percentage,
      text: `${label}：${statusText}`,
    };
  }
  if (progress.phase === 'script_episode_final_review') {
    const status = progress.status || 'reviewing';
    const textMap = {
      reviewing: '正在进行完整单集终审',
      repairing: '终审发现跨段问题，正在修复',
      repair_done: '完整单集修复完成',
      rechecking: '正在复核完整单集',
      review_done: '完整单集终审完成',
      review_failed: '完整单集终审失败，保留当前剧本',
      repair_failed: '完整单集修复失败，保留当前剧本',
      recheck_failed: '终审复核失败，使用已修订剧本',
    };
    return {
      episodeId,
      total: 1,
      index: 0,
      status,
      percentage: ['review_done', 'review_failed', 'repair_failed', 'recheck_failed'].includes(status) ? 99 : 96,
      text: textMap[status] || '正在处理完整单集终审',
    };
  }
  if (progress.phase !== 'script_segment') return null;
  const total = Math.max(1, Number(progress.total) || 1);
  const index = Math.min(total - 1, Math.max(0, Number(progress.index) || 0));
  const previous = previousProgress?.episodeId === episodeId ? previousProgress.percentage : 0;
  const percentage = segmentProgressPercentage(index, total, progress.status, previous);
  const retryText = progress.status === 'retry'
    ? `，第 ${progress.attempt || 2}/${progress.attempts || 3} 次尝试`
    : '';
  return {
    episodeId,
    total,
    index,
    status: progress.status || 'running',
    percentage,
    text: progress.status === 'done'
      ? `已完成第 ${index + 1}/${total} 段`
      : `正在生成第 ${index + 1}/${total} 段${retryText}`,
    };
}

export function storyboardProgressStateForEpisode(episodeId, progress = {}, previousProgress = null, percentageForSegment) {
  if (progress.phase !== 'storyboard_segment') return null;
  const total = Math.max(1, Number(progress.total) || 1);
  const index = Math.min(total - 1, Math.max(0, Number(progress.index) || 0));
  const previous = previousProgress?.episodeId === episodeId ? previousProgress.percentage : 0;
  const percentage = percentageForSegment(index, total, progress.status, previous);
  const status = progress.status || 'running';
  let text = `正在生成分镜第 ${index + 1}/${total} 段`;
  if (status === 'done') {
    text = `已完成分镜第 ${index + 1}/${total} 段`;
  } else if (status === 'retry') {
    text = `正在重新生成分镜第 ${index + 1}/${total} 段（第 ${progress.attempt || 2}/${progress.attempts || 3} 次）`;
  } else if (status === 'split') {
    text = String(progress.message || '').trim() || `分镜第 ${index + 1} 段内容过长，已自动拆段继续生成`;
  }
  return {
    episodeId,
    total,
    index,
    status,
    percentage,
    text,
  };
}

export function createScriptProgressActionsRuntime({ refs = {}, helpers = {} } = {}) {
  let generateEpisodeHandler = helpers.generateEpisode;
  const progressPercentForSegment = (index, total, status, previous = 0) => (
    segmentProgressPercentage(index, total, status, previous, helpers.clampProgress)
  );
  const updateScriptProgress = (episodeId, progress = {}) => {
    const nextProgress = scriptProgressStateForEpisode(
      episodeId,
      progress,
      refs.scriptUi.scriptProgress,
      progressPercentForSegment
    );
    if (nextProgress) refs.scriptUi.scriptProgress = nextProgress;
  };
  const updateStoryboardProgress = (episodeId, progress = {}) => {
    const nextProgress = storyboardProgressStateForEpisode(
      episodeId,
      progress,
      refs.scriptUi.storyboardProgress,
      progressPercentForSegment
    );
    if (nextProgress) refs.scriptUi.storyboardProgress = nextProgress;
  };
  const batch = () => refs.scriptUi.batchGen;
  const generateAllEpisodes = (options = {}) => generateAllEpisodesFlow({
    isGeneratingAll: () => !!refs.scriptUi.generatingAll,
    onlyUnfinished: options.onlyUnfinished === true,
    throwOnError: options.throwOnError === true,
    episodes: () => refs.scriptState.episodes,
    requireActiveCustomPrompt: () => helpers.requireActiveCustomPrompt('script'),
    setGeneratingAll: (value) => { refs.scriptUi.generatingAll = value; },
    batch: batch(),
    isCancelled: () => batch().cancel === true,
    generateEpisode: generateEpisodeHandler,
    warning: helpers.warning,
    success: helpers.success,
    error: helpers.error,
    info: helpers.info,
    silentSummary: options.silentSummary === true,
    onEpisodeStart: typeof options.onEpisodeStart === 'function' ? options.onEpisodeStart : null,
    onEpisodeDone: typeof options.onEpisodeDone === 'function' ? options.onEpisodeDone : null,
    onEpisodeFailed: typeof options.onEpisodeFailed === 'function' ? options.onEpisodeFailed : null,
  });
  const cancelBatchGeneration = () => {
    if (batch().active) batch().cancel = true;
  };
  return {
    setGenerateEpisode: (nextGenerateEpisode) => { generateEpisodeHandler = nextGenerateEpisode; },
    nudgeProgress: (progress) => nudgeSegmentProgress(progress, helpers.clampProgress),
    updateScriptProgress,
    updateStoryboardProgress,
    generateAllEpisodes,
    cancelBatchGeneration,
  };
}

export function selectedSliceForEpisode(episode, chapters = []) {
  if (!episode) return '';
  if (Array.isArray(episode.sourceRanges) && episode.sourceRanges.length) {
    return episode.sourceRanges.map((range) => {
      const chapter = findChapter(chapters, range.chapterId);
      if (!chapter) return '';
      const source = String(chapter.sourceText || '');
      const start = Math.max(0, Math.min(source.length, Number(range.startOffset) || 0));
      const end = Math.max(start, Math.min(source.length, Number(range.endOffset) || 0));
      const text = source.slice(start, end).trim();
      if (!text) return '';
      const note = [range.treatment, range.reason].filter(Boolean).join('；');
      return `【${chapter.title || '原文片段'}${note ? `｜${note}` : ''}】\n${text}`;
    }).filter(Boolean).join('\n\n');
  }
  const chapter = findChapter(chapters, episode.chapterId);
  if (!chapter) return '';
  return (chapter.sourceText || '').slice(episode.startOffset, episode.endOffset);
}

export function createScriptSelectionRuntime({ refs = {}, helpers = {}, globals = {}, computed } = {}) {
  const exportScript = (kind, format, opts = {}) => {
    const project = refs.project.value;
    if (!project) return;
    const params = new URLSearchParams({ id: project.id, kind, format });
    if (opts.episodeId) params.set('episodeId', opts.episodeId);
    else if (opts.chapterId) params.set('chapterId', opts.chapterId);
    else {
      const from = Number(opts.fromEpisodeId);
      const to = Number(opts.toEpisodeId);
      if (Number.isFinite(from) && from > 0) params.set('fromEpisodeId', String(from));
      if (Number.isFinite(to) && to > 0) params.set('toEpisodeId', String(to));
    }
    // merged 要和范围/章节同时生效，所以不放进上面的 else 链：
    // 带 merged 时后端把所选内容合并成一个文件，否则每集一个文件打成 ZIP。
    if (opts.merged) params.set('merged', '1');
    globals.window.location.href = `/api/script/export?${params.toString()}`;
  };

  const selectedEpisode = computed(() => {
    if (!refs.scriptUi.selectedId.startsWith('ep:')) return null;
    return helpers.findEpisode(Number(refs.scriptUi.selectedId.slice(3)));
  });
  const selectedChapter = computed(() => {
    if (refs.scriptUi.selectedId.startsWith('ch:')) return helpers.findChapter(Number(refs.scriptUi.selectedId.slice(3)));
    const episode = selectedEpisode.value;
    return episode ? helpers.findChapter(episode.chapterId) : null;
  });
  const selectedStoryboard = computed(() => {
    const episode = selectedEpisode.value;
    return episode ? helpers.findStoryboard(episode.id) : null;
  });
  const selectedSlice = computed(() => selectedSliceForEpisode(selectedEpisode.value, refs.scriptState.chapters));
  const sourceLen = computed(() => sourceLength(refs.scriptState.chapters));
  const pendingExtractChapters = computed(() => (
    helpers.chaptersSorted().filter((chapter) => (
      (chapter.sourceText || '').trim() &&
      refs.scriptState.extractedSigs[chapter.id] !== helpers.chapterSig(chapter.sourceText)
    ))
  ));
  const chapterSigFn = helpers.chapterSig || chapterSig;
  const isEpisodeStale = (episode) => {
    if (!episode || !(episode.content || '').trim()) return false;
    const stored = refs.scriptUi.episodeSrcSig?.[episode.id];
    if (!stored) return false;
    const slice = selectedSliceForEpisode(episode, refs.scriptState.chapters);
    return stored !== chapterSigFn(slice);
  };

  return {
    exportScript,
    isEpisodeStale,
    selectedEpisode,
    selectedChapter,
    selectedStoryboard,
    selectedSlice,
    sourceLen,
    pendingExtractChapters,
  };
}

export function hydrateScriptState(project, scriptState, scriptUi, config = {}, handlers = {}) {
  const scriptData = (project && project.script) || {};
  scriptState.chapters = Array.isArray(scriptData.chapters) ? scriptData.chapters : [];
  scriptState.episodes = Array.isArray(scriptData.episodes) ? scriptData.episodes : [];
  scriptState.storyboards = Array.isArray(scriptData.storyboards)
    ? scriptData.storyboards.map((storyboard) => normalizeRuntimeStoryboard(storyboard))
    : [];
  scriptState.wholeNovelBible = scriptData.wholeNovelBible || null;
  scriptState.wholeNovelStageBibles = Array.isArray(scriptData.wholeNovelStageBibles) ? scriptData.wholeNovelStageBibles : [];
  scriptState.wholeNovelEpisodePlan = scriptData.wholeNovelEpisodePlan || null;
  scriptState.wholeNovelAdapted = scriptData.wholeNovelAdapted === true;
  scriptState.wholeNovelPlanningStale = scriptData.wholeNovelPlanningStale === true;
  mergeActiveStoryboardDrafts(project?.id, scriptState.storyboards);
  scriptState.extractedSigs = (scriptData.extractedSigs && typeof scriptData.extractedSigs === 'object') ? { ...scriptData.extractedSigs } : {};
  const migrated = migrateLegacyProjectPrompts(scriptData, config);
  scriptState.settings = {
    useColdOpen: scriptData.settings?.useColdOpen === true || scriptData.settings?.useColdOpen === undefined,
    useEpisodeHook: scriptData.settings?.useEpisodeHook === true || scriptData.settings?.useEpisodeHook === undefined,
    usePurification: scriptData.settings?.usePurification === true || scriptData.settings?.usePurification === undefined,
    useLongScript: scriptData.settings?.useLongScript === true,
    useContentReview: scriptData.settings?.useContentReview === true,
    useDramaReview: scriptData.settings?.useDramaReview === true || scriptData.settings?.useDramaReview === undefined,
    useEpisodeFinalReview: scriptData.settings?.useEpisodeFinalReview === true || scriptData.settings?.useEpisodeFinalReview === undefined,
    adaptationStrength: ['faithful', 'enhanced', 'rewrite'].includes(scriptData.settings?.adaptationStrength)
      ? scriptData.settings.adaptationStrength
      : (scriptData.settings?.useOriginalMode ? 'faithful' : 'enhanced'),
    useQVersion: scriptData.settings?.useQVersion === true || scriptData.settings?.useQVersion === undefined,
    hideStoryboardPrompts: scriptData.settings?.hideStoryboardPrompts === true,
    scriptPromptMode: scriptData.settings?.scriptPromptMode === 'custom' ? 'custom' : 'builtin',
    storyboardPromptMode: scriptData.settings?.storyboardPromptMode === 'custom' ? 'custom' : 'builtin',
    selectedScriptPromptId: typeof scriptData.settings?.selectedScriptPromptId === 'string' ? scriptData.settings.selectedScriptPromptId : '',
    selectedStoryboardPromptId: typeof scriptData.settings?.selectedStoryboardPromptId === 'string' ? scriptData.settings.selectedStoryboardPromptId : '',
  };
  if (migrated) handlers.saveSettings();
  normalizePromptMode(config, scriptState.settings, 'script');
  normalizePromptMode(config, scriptState.settings, 'storyboard');
  // 同项目重复水合（批量运行中的 openProject 刷新 / Agent 保存等）不应把用户从分镜页
  // 拽回剧本页（2026-09-10 用户实测：点分镜老是退回剧本）。只有切换项目或首次水合，
  // 或当前选中集已不存在时，才重置舞台与选中项。
  const selectedStillExists = scriptState.episodes.some(
    (episode) => `ep:${episode.id}` === String(scriptUi.selectedId || ''),
  );
  const sameProject = scriptUi.hydratedProjectId != null
    && String(scriptUi.hydratedProjectId) === String(project?.id ?? '')
    && selectedStillExists;
  scriptUi.hydratedProjectId = String(project?.id ?? '');
  scriptUi.episodeSrcSig = {};
  for (const episode of scriptState.episodes) {
    if ((episode.content || '').trim()) {
      scriptUi.episodeSrcSig[episode.id] = chapterSig(selectedSliceForEpisode(episode, scriptState.chapters));
    }
  }
  if (!sameProject) {
    scriptUi.stage = 'script';
    scriptUi.selectedId = scriptState.episodes[0] ? `ep:${scriptState.episodes[0].id}` : (scriptState.chapters[0] ? `ch:${scriptState.chapters[0].id}` : '');
    const firstStoryboardEpisode = scriptState.episodes.find((episode) => scriptState.storyboards.some((storyboard) => storyboard.episodeId === episode.id)) || scriptState.episodes[0];
    handlers.setStoryboardEpisodeId(firstStoryboardEpisode ? firstStoryboardEpisode.id : 0);
  }
}

export function createScriptStateAccessRuntime({ config = {}, refs = {}, helpers = {} } = {}) {
  return {
    hydrateScript: (project) => hydrateScriptState(project, refs.scriptState, refs.scriptUi, config, {
      saveSettings: helpers.saveSettings,
      setStoryboardEpisodeId: (episodeId) => { refs.storyboardEpisodeId.value = episodeId; },
    }),
    chaptersSorted: () => chaptersSorted(refs.scriptState.chapters),
    episodesOfChapter: (chapterId) => episodesOfChapter(refs.scriptState.episodes, chapterId),
    findEpisode: (id) => findEpisode(refs.scriptState.episodes, id),
    findChapter: (id) => findChapter(refs.scriptState.chapters, id),
    findStoryboard: (episodeId) => findStoryboard(refs.scriptState.storyboards, episodeId),
  };
}

export function createScriptTimelineActionsRuntime({
  api,
  message,
  config = {},
  refs = {},
  readers = {},
  helpers = {},
  ui = {},
  globals = {},
  computed,
} = {}) {
  const access = createScriptStateAccessRuntime({
    config,
    refs: {
      scriptState: refs.scriptState,
      scriptUi: refs.scriptUi,
      storyboardEpisodeId: refs.storyboardEpisodeId,
    },
    helpers: {
      saveSettings: helpers.saveSettings,
    },
  });
  const scriptImport = createScriptImportRuntime({
    api,
    message,
    refs: {
      scriptUi: refs.scriptUi,
      scriptState: refs.scriptState,
      project: refs.project,
      episodeId: refs.storyboardEpisodeId,
      dragOver: refs.dragOver,
    },
    readers,
    helpers: {
      findStoryboard: access.findStoryboard,
      clearEpisodeVideoState: helpers.clearEpisodeVideoState,
    },
  });
  const timeline = createScriptTimelineRuntime({
    api,
    message,
    refs: {
      scriptUi: refs.scriptUi,
      scriptState: refs.scriptState,
      project: refs.project,
      storyboardEpisodeId: refs.storyboardEpisodeId,
    },
    helpers: {
      nextTick: helpers.nextTick,
      clearEpisodeVideoState: helpers.clearEpisodeVideoState,
    },
    ui,
  });

  return {
    ...access,
    ...scriptImport,
    ...timeline,
  };
}

export function createAppScriptWorkspaceRuntime({
  api,
  message,
  config = {},
  refs = {},
  readers = {},
  helpers = {},
  ui = {},
  reactive,
  ref,
  computed,
} = {}) {
  const state = createScriptUiStateRuntime({ reactive, ref });
  const promptActions = createScriptPromptActionsRuntime({
    api,
    message,
    config,
    refs: {
      project: refs.project,
      scriptState: state.scriptState,
      scriptUi: state.scriptUI,
      promptKind: refs.promptKind,
      selectedPromptId: refs.selectedPromptId,
    },
    readers: { readFileAsText: readers.readFileAsText },
    helpers: {
      saveSettings: helpers.saveSettings,
      clearEpisodeVideoState: helpers.clearEpisodeVideoState,
    },
    computed,
  });
  const timelineActions = createScriptTimelineActionsRuntime({
    api,
    message,
    config,
    refs: {
      project: refs.project,
      scriptState: state.scriptState,
      scriptUi: state.scriptUI,
      storyboardEpisodeId: refs.storyboardEpisodeId,
      dragOver: state.scriptDragOver,
    },
    readers: { readPlainTxtFiles: readers.readPlainTxtFiles },
    helpers: {
      saveSettings: helpers.saveSettings,
      nextTick: helpers.nextTick,
      clearEpisodeVideoState: helpers.clearEpisodeVideoState,
    },
    ui,
  });

  return {
    ...state,
    ...promptActions,
    ...timelineActions,
  };
}

export function createScriptGenerationActionsRuntime({
  api,
  message,
  refs = {},
  helpers = {},
  globals = {},
  computed,
} = {}) {
  const scriptProgressActions = createScriptProgressActionsRuntime({
    refs: { scriptUi: refs.scriptUi, scriptState: refs.scriptState },
    helpers: {
      clampProgress: helpers.clampProgress,
      requireActiveCustomPrompt: helpers.requireActiveCustomPrompt,
      warning: message.warning,
      success: message.success,
      error: message.error,
      info: message.info,
    },
  });
  const {
    nudgeProgress: nudgeScriptProgress,
    updateScriptProgress,
    updateStoryboardProgress,
    cancelBatchGeneration,
  } = scriptProgressActions;
  const generation = createScriptGenerationRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      scriptUi: refs.scriptUi,
      scriptState: refs.scriptState,
      activeScriptCustomPrompt: refs.activeScriptCustomPrompt,
      activeStoryboardCustomPrompt: refs.activeStoryboardCustomPrompt,
      shotHeaderPrefix: refs.shotHeaderPrefix,
      storyboardPromptTemplateId: refs.storyboardPromptTemplateId,
    },
    helpers: {
      nextTick: helpers.nextTick,
      nudgeProgress: nudgeScriptProgress,
      findEpisode: helpers.findEpisode,
      findStoryboard: helpers.findStoryboard,
      requireActiveCustomPrompt: helpers.requireActiveCustomPrompt,
      updateScriptProgress,
      updateStoryboardProgress,
      clearEpisodeVideoState: helpers.clearEpisodeVideoState,
    },
  });
  scriptProgressActions.setGenerateEpisode(generation.generateEpisode);
  const selection = createScriptSelectionRuntime({
    computed,
    globals,
    refs: { project: refs.project, scriptUi: refs.scriptUi, scriptState: refs.scriptState },
    helpers: {
      findEpisode: helpers.findEpisode,
      findChapter: helpers.findChapter,
      findStoryboard: helpers.findStoryboard,
      chaptersSorted: helpers.chaptersSorted,
      chapterSig: helpers.chapterSig || chapterSig,
    },
  });
  const startExtractFromSource = createStartExtractFromSourceRuntime({
    api,
    message,
    refs: {
      extracting: refs.extracting,
      project: refs.project,
      pendingChapters: selection.pendingExtractChapters,
      scriptState: refs.scriptState,
      extractErrors: refs.extractErrors,
      extractProgress: refs.extractProgress,
      extractCategory: refs.extractCategory,
    },
    helpers: {
      chaptersSorted: helpers.chaptersSorted,
      chapterSig: helpers.chapterSig || chapterSig,
      rememberExtractCounts: helpers.rememberExtractCounts,
      startProgress: helpers.startExtractProgress,
      nextTick: helpers.nextTick,
      pollExtract: helpers.pollExtract,
      failProgress: helpers.failExtractProgress,
    },
  });
  const adaptWholeNovel = async () => {
    const ui = refs.scriptUi;
    const state = refs.scriptState;
    if (ui.adaptingWholeNovel || ui.generatingAll || ui.genEpisode) return;
    if (!refs.project.value) return message.warning('请先打开项目');
    if (!state.chapters.length) return message.warning('请先导入整本小说 TXT 或添加章节原文');
    if (!helpers.requireActiveCustomPrompt()) return;
    ui.adaptingWholeNovel = true;
    ui.wholeAdaptProgress = '准备整本改编…';
    const previousEpisodeIds = state.episodes.map((episode) => episode.id);
    try {
      let planned = null;
      await api.postStream('/api/script/novel/adapt-plan/stream', {
        projectId: refs.project.value.id,
      }, {
        timeoutMs: 0,
        onProgress: (progress = {}) => {
          ui.wholeAdaptProgress = progress.text || progress.message || '整本改编规划中…';
        },
        onDone: (result = {}) => {
          if (Array.isArray(result.episodes)) {
            for (const episodeId of previousEpisodeIds) {
              clearEpisodeGeneratedState(state, ui, episodeId, { clearScript: true });
              helpers.clearEpisodeVideoState?.(episodeId);
            }
          }
          planned = result;
          if (Array.isArray(result.chapters)) {
            state.chapters = result.chapters;
            state.chapters.sort((a, b) => (a.order || 0) - (b.order || 0));
          }
          if (Array.isArray(result.episodes)) {
            state.episodes = result.episodes;
            state.episodes.sort((a, b) => a.id - b.id);
          }
          if (Array.isArray(result.storyboards)) {
            state.storyboards = result.storyboards;
          } else {
            state.storyboards = [];
          }
          state.wholeNovelBible = result.wholeNovelBible || null;
          state.wholeNovelStageBibles = Array.isArray(result.wholeNovelStageBibles) ? result.wholeNovelStageBibles : [];
          state.wholeNovelEpisodePlan = result.wholeNovelEpisodePlan || null;
          state.wholeNovelAdapted = result.wholeNovelAdapted === true;
          state.wholeNovelPlanningStale = result.wholeNovelPlanningStale === true;
          if (state.episodes[0]) ui.selectedId = `ep:${state.episodes[0].id}`;
        },
      });
      if (!planned?.episodes?.length && !state.episodes.length) {
        message.warning('整本规划完成，但没有分出剧集');
        return;
      }
      const pendingCount = state.episodes.filter((episode) => !(episode.content || '').trim()).length;
      if (!pendingCount) {
        message.success(`整本规划已完成，共 ${state.episodes.length} 集，剧本均已生成`);
        return;
      }
      ui.wholeAdaptProgress = `规划已保存，开始补齐 ${pendingCount} 集剧本…`;
      const batchResult = await scriptProgressActions.generateAllEpisodes({
        onlyUnfinished: true,
        throwOnError: false,
        silentSummary: true,
        onEpisodeStart: ({ episode, index, total }) => {
          ui.wholeAdaptProgress = `正在生成剧本 ${index + 1}/${total} · ${episode.title || `第${episode.id}集`}`;
        },
        onEpisodeDone: ({ processed, total }) => {
          ui.wholeAdaptProgress = `剧本生成进度 ${processed}/${total}`;
        },
        onEpisodeFailed: ({ processed, failed, total, episode }) => {
          ui.wholeAdaptProgress = `已处理 ${processed}/${total}，失败 ${failed} 集，继续下一集 · ${episode.title || `第${episode.id}集`}`;
        },
      });
      if (batchResult?.cancelled) {
        message.warning(`整本规划已保存；已停止生成，成功 ${batchResult.completed}/${batchResult.total} 集`);
      } else if (batchResult?.failed) {
        message.warning(`整本规划已保存；剧本成功 ${batchResult.completed} 集、失败 ${batchResult.failed} 集，可勾选“只生成未完成”继续补齐`);
      } else {
        message.success(`整本改编完成，共生成 ${batchResult?.completed || pendingCount} 集剧本`);
      }
    } catch (error) {
      message.error(`整本规划中断：${error.message}`);
    } finally {
      ui.adaptingWholeNovel = false;
      setTimeout(() => {
        if (!ui.adaptingWholeNovel) ui.wholeAdaptProgress = '';
      }, 1600);
    }
  };

  // 并发批量：把每个章节各自当作一集，跳过 AI 分集直接跑剧本。
  // 复用 scriptUI.batchGen 进度，不写 scriptUi.genEpisode / genWhole /
  // scriptProgress（避免和单集版互相覆盖）。
  // 直接走底层 /api/script/episode/stream，绕过 runGenerateEpisodeFlow 的
  // 单值 isGenerating() 守卫。
  const generateAllWholeChapters = async (options = {}) => {
    const ui = refs.scriptUi;
    const state = refs.scriptState;
    if (ui.adaptingWholeNovel || ui.generatingAll || ui.genEpisode || ui.genWhole) {
      return message.warning('当前已有生成任务在进行中');
    }
    if (!refs.project.value) return message.warning('请先打开项目');
    const chapters = (state.chapters || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!chapters.length) return message.warning('请先导入整本小说 TXT 或添加章节原文');
    if (!helpers.requireActiveCustomPrompt('script')) return;

    const onlyUnfinished = options.onlyUnfinished !== false; // 默认跳过已生成的
    const targets = onlyUnfinished
      ? chapters.filter((ch) => !state.episodes.some((ep) => ep.chapterId === ch.id && (ep.content || '').trim()))
      : chapters;
    if (!targets.length) return message.success('所有章节都已生成整章剧本，没有需要补的');

    const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 2));
    const batch = ui.batchGen;
    batch.active = true;
    batch.cancel = false;
    batch.total = targets.length;
    batch.done = 0;
    batch.failed = 0;
    batch.skipped = chapters.length - targets.length;
    batch.onlyUnfinished = onlyUnfinished;
    batch.currentTitle = '';
    ui.generatingAll = true;

    let completed = 0;
    let failed = 0;
    let nextIndex = 0;
    let stopped = false;
    const failures = [];

    // 直接走 /api/script/chapter/whole + /api/script/episode/stream，绕开单值 guard
    const runOne = async (chapter) => {
      const chapterTitle = chapter.title || `第${chapter.order || ''}章`;
      batch.currentTitle = `整章生成 · ${chapterTitle}`;
      try {
        // 第 1 步：建集（如果还没有整章对应的集）
        const createResult = await api.post('/api/script/chapter/whole', {
          projectId: refs.project.value.id,
          chapterId: chapter.id,
        });
        if (!createResult?.ok || !createResult.episode) {
          failed += 1;
          batch.failed = failed;
          batch.done = completed + failed;
          failures.push({ chapterId: chapter.id, title: chapterTitle, message: createResult?.error || '建集失败' });
          return;
        }
        const episode = createResult.episode;
        if (!state.episodes.find((e) => e.id === episode.id)) {
          state.episodes.push(episode);
          state.episodes.sort((a, b) => a.id - b.id);
        }
        // 第 2 步：直接走 SSE 端点生成剧本，不通过 runGenerateEpisodeFlow
        const streamResult = await new Promise((resolve) => {
          let lastText = '';
          let wasCancelled = false;
          // 用户点了停止时，让 fetch 取消
          const onCancelCheck = () => {
            if (batch.cancel && !wasCancelled) {
              wasCancelled = true;
              resolve({ ok: false, error: '已停止', cancelled: true });
              return true;
            }
            return false;
          };
          const cancelInterval = setInterval(() => {
            if (onCancelCheck()) clearInterval(cancelInterval);
          }, 500);
          api.postStream('/api/script/episode/stream', {
            projectId: refs.project.value.id,
            episodeId: episode.id,
            requirement: '',
            throwOnError: false,
            customScriptPrompt: refs.activeScriptCustomPrompt?.value || '',
            scriptPromptMode: state.settings.scriptPromptMode,
            adaptationStrength: state.settings.adaptationStrength || 'enhanced',
          }, {
            timeoutMs: 0,
            onProgress: () => { /* 进度由 batch 统一管，不写 scriptProgress */ },
            onDelta: (text) => {
              if (typeof text === 'string') lastText += text;
            },
            onDone: (result = {}) => {
              clearInterval(cancelInterval);
              if (wasCancelled) return; // 已经在 onCancelCheck 里 resolve 了
              if (result?.error) {
                resolve({ ok: false, error: result.error?.message || String(result.error) });
                return;
              }
              const generatedEpisode = {
                ...(result?.episode || {}),
                id: episode.id,
                content: String(result?.episode?.content || '').trim() ? result.episode.content : lastText,
              };
              try {
                requireGeneratedEpisode({ episode: generatedEpisode }, episode.id);
              } catch (error) {
                resolve({ ok: false, error });
                return;
              }
              episode.content = generatedEpisode.content;
              resolve({ ok: true });
            },
            onError: (error) => {
              clearInterval(cancelInterval);
              if (wasCancelled) return;
              resolve({ ok: false, error: error?.message || String(error) });
            },
          }).catch((err) => {
            clearInterval(cancelInterval);
            if (wasCancelled) return;
            resolve({ ok: false, error: err?.message || String(err) });
          });
        });
        if (streamResult.cancelled) {
          stopped = true;
          return;
        }
        if (!streamResult.ok) {
          failed += 1;
          batch.failed = failed;
          batch.done = completed + failed;
          failures.push({ chapterId: chapter.id, title: chapterTitle, message: streamResult.error });
          return;
        }
        // 服务端在 SSE 完成时已经清掉旧分镜/视频；这里同步清理本地响应式缓存，
        // 避免“整章重生成”成功后页面还显示旧下游产物。
        clearEpisodeGeneratedState(state, ui, episode.id, { clearScript: false });
        helpers.clearEpisodeVideoState?.(episode.id);
        completed += 1;
        batch.done = completed + failed;
      } catch (err) {
        failed += 1;
        batch.failed = failed;
        batch.done = completed + failed;
        failures.push({ chapterId: chapter.id, title: chapterTitle, message: err?.message || '生成失败' });
      }
    };

    const worker = async () => {
      while (!stopped && !batch.cancel) {
        const myIndex = nextIndex;
        nextIndex += 1;
        if (myIndex >= targets.length) break;
        await runOne(targets[myIndex]);
        if (batch.cancel) { stopped = true; }
      }
    };

    try {
      const workers = Array.from({ length: Math.min(concurrency, targets.length) }, () => worker());
      await Promise.all(workers);
      if (stopped || batch.cancel) {
        message.warning(`已停止整章批量生成，成功 ${completed} 章、失败 ${failed} 章`);
      } else if (failed) {
        message.warning(`整章批量生成结束：成功 ${completed} 章、失败 ${failed} 章，可重试补齐`);
      } else {
        message.success(`全部章节整章生成完成，共 ${completed} 章`);
      }
      return { total: targets.length, completed, failed, cancelled: stopped, failures };
    } finally {
      batch.active = false;
      batch.cancel = false;
      batch.currentTitle = '';
      ui.generatingAll = false;
    }
  };

  return {
    ...generation,
    generateAllEpisodes: (options = {}) => scriptProgressActions.generateAllEpisodes(options),
    generateAllWholeChapters,
    adaptWholeNovel,
    cancelBatchGeneration,
    ...selection,
    startExtractFromSource,
  };
}

export function startAddChapterUi(scriptUi, chapterCount = 0) {
  scriptUi.addingChapter = true;
  scriptUi.draftTitle = `第${chapterCount + 1}章`;
  scriptUi.draftText = '';
}

export function cancelAddChapterUi(scriptUi) {
  scriptUi.addingChapter = false;
  scriptUi.draftTitle = '';
  scriptUi.draftText = '';
}

export function startImportEpisodeUi(scriptUi, episodeCount = 0) {
  scriptUi.importingEpisode = true;
  scriptUi.importTitle = `第${episodeCount + 1}集`;
  scriptUi.importContent = '';
}

export function cancelImportEpisodeUi(scriptUi) {
  scriptUi.importingEpisode = false;
  scriptUi.importTitle = '';
  scriptUi.importContent = '';
}

export function startImportStoryboardUi(scriptUi) {
  scriptUi.importingStoryboard = true;
  scriptUi.sbImportMarker = '分镜';
  scriptUi.sbImportTitle = '';
  scriptUi.sbImportContent = '';
  scriptUi.sbMarkerTouched = false;
  scriptUi.sbImportDragOver = false;
}

export function cancelImportStoryboardUi(scriptUi) {
  scriptUi.importingStoryboard = false;
  scriptUi.sbImportContent = '';
  scriptUi.sbImportTitle = '';
}

export async function applyTxtToDraftFlow(scriptUi, fileList, handlers = {}) {
  try {
    const result = await handlers.readPlainTxtFiles(fileList);
    if (!result) return handlers.warning('请拖入 .txt 文本文件');
    scriptUi.draftText = scriptUi.draftText ? `${scriptUi.draftText}\n\n${result.text}` : result.text;
    handlers.success(`已读入 ${result.okCount} 个文件`);
  } catch (error) {
    handlers.error(error.message || '读取 TXT 失败');
  }
}

function novelImportTitleFromFiles(fileList) {
  const first = [...(fileList || [])][0];
  return String(first?.name || '整本小说')
    .replace(/\.[^.]+$/, '')
    .trim() || '整本小说';
}

export async function importWholeNovelTxtFlow(scriptUi, scriptState, fileList, handlers = {}) {
  if (!handlers.hasProject()) return;
  if (scriptUi.importingNovel) return;
  scriptUi.importingNovel = true;
  scriptUi.novelImportProgress = '读取 TXT';
  try {
    const files = [...(fileList || [])];
    const result = await handlers.readPlainTxtFiles(files);
    if (!result) return handlers.warning('请选择 .txt 文本文件');
    scriptUi.novelImportProgress = '自动拆章';
    const imported = await handlers.importNovel({
      projectId: handlers.projectId(),
      title: novelImportTitleFromFiles(files),
      text: result.text,
      mode: 'append',
    });
    if (!imported.ok) return handlers.error(imported.error || '整本导入失败');
    invalidateWholeNovelRuntimeState(scriptState);
    const chapters = Array.isArray(imported.chapters) ? imported.chapters : [];
    scriptState.chapters.push(...chapters);
    scriptState.chapters.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (chapters[0]) scriptUi.selectedId = `ch:${chapters[0].id}`;
    const methodText = imported.method === 'heading' ? '按章节标题拆章' : '按长度自动拆章';
    handlers.success(imported.message || `已导入 ${chapters.length} 章（${methodText}）`);
  } catch (error) {
    handlers.error(error.message || '整本导入失败');
  } finally {
    scriptUi.importingNovel = false;
    scriptUi.novelImportProgress = '';
  }
}

export async function applyTxtToStoryboardImportFlow(scriptUi, fileList, handlers = {}) {
  try {
    const result = await handlers.readPlainTxtFiles(fileList);
    if (!result) return handlers.warning('请拖入 .txt 文本文件');
    scriptUi.sbImportContent = scriptUi.sbImportContent
      ? `${scriptUi.sbImportContent}\n\n${result.text}`
      : result.text;
    const marker = detectStoryboardMarker(scriptUi.sbImportContent);
    if (marker) {
      scriptUi.sbImportMarker = marker;
      handlers.success(`已读入 ${result.okCount} 个文件，自动识别切割标记「${marker}」`);
    } else {
      handlers.success(`已读入 ${result.okCount} 个文件，未识别到标记，请手动确认切割标记`);
    }
  } catch (error) {
    handlers.error(error.message || '读取 TXT 失败');
  }
}

export function syncStoryboardImportMarker(scriptUi) {
  const marker = detectStoryboardMarker(scriptUi.sbImportContent);
  if (marker && !scriptUi.sbMarkerTouched) scriptUi.sbImportMarker = marker;
}

export async function createEmptyEpisodeFlow(scriptUi, scriptState, handlers = {}) {
  if (!handlers.hasProject()) return;
  if (scriptUi.creatingEpisode) return;
  scriptUi.creatingEpisode = true;
  try {
    const result = await handlers.createEpisode({ projectId: handlers.projectId() });
    if (!result.ok) return handlers.error(result.error || '新增集数失败');
    invalidateWholeNovelRuntimeState(scriptState);
    scriptState.episodes.push(result.episode);
    scriptState.episodes.sort((a, b) => a.id - b.id);
    scriptUi.selectedId = `ep:${result.episode.id}`;
    if (handlers.setEpisodeId) handlers.setEpisodeId(result.episode.id);
    handlers.success(`已新增「${result.episode.title}」`);
  } catch (error) {
    handlers.error(`新增集数失败：${error.message}`);
  } finally {
    scriptUi.creatingEpisode = false;
  }
}

export async function confirmImportEpisodeFlow(scriptUi, scriptState, handlers = {}) {
  if (!handlers.hasProject()) return;
  if (!scriptUi.importTitle.trim()) return handlers.warning('请输入剧本标题');
  if (!scriptUi.importContent.trim()) return handlers.warning('请输入剧本内容');

  scriptUi.importing = true;
  try {
    const result = await handlers.importEpisode({
      projectId: handlers.projectId(),
      title: scriptUi.importTitle,
      content: scriptUi.importContent,
    });
    if (!result.ok) return handlers.error(result.error || '导入失败');

    invalidateWholeNovelRuntimeState(scriptState);

    if (result.episodes && Array.isArray(result.episodes)) {
      scriptState.episodes.push(...result.episodes);
      scriptState.episodes.sort((a, b) => a.id - b.id);
      scriptUi.selectedId = `ep:${result.episodes[0].id}`;
      cancelImportEpisodeUi(scriptUi);
      handlers.success(result.message || `已导入 ${result.episodes.length} 集剧本`);
    } else if (result.episode) {
      scriptState.episodes.push(result.episode);
      scriptState.episodes.sort((a, b) => a.id - b.id);
      scriptUi.selectedId = `ep:${result.episode.id}`;
      cancelImportEpisodeUi(scriptUi);
      handlers.success('剧本已导入，可以生成分镜');
    }
  } catch (error) {
    handlers.error(`导入失败：${error.message}`);
  } finally {
    scriptUi.importing = false;
  }
}

export async function confirmImportStoryboardFlow(scriptUi, scriptState, handlers = {}) {
  if (!handlers.hasProject()) return;
  if (!scriptUi.sbImportContent.trim()) return handlers.warning('请粘贴分镜内容');
  const marker = (scriptUi.sbImportMarker || '分镜').trim() || '分镜';
  scriptUi.importingSb = true;
  try {
    const result = await handlers.importStoryboard({
      projectId: handlers.projectId(),
      marker,
      content: scriptUi.sbImportContent,
      episodeId: handlers.episodeId() || undefined,
      title: scriptUi.sbImportTitle,
    });
    if (!result.ok) return handlers.error(result.error || '导入失败');
    if (result.episode) {
      scriptState.episodes.push(result.episode);
      scriptState.episodes.sort((a, b) => a.id - b.id);
    }
    const episodeId = result.storyboard.episodeId;
    handlers.clearEpisodeOutputs?.(episodeId);
    const existing = handlers.findStoryboard(episodeId);
    if (existing) Object.assign(existing, result.storyboard);
    else {
      scriptState.storyboards.push({ ...result.storyboard, manualTags: {} });
      scriptState.storyboards.sort((a, b) => a.episodeId - b.episodeId);
    }
    handlers.setEpisodeId(episodeId);
    cancelImportStoryboardUi(scriptUi);
    handlers.success(result.message || `已导入 ${result.shots} 个分镜`);
  } catch (error) {
    handlers.error(`导入失败：${error.message}`);
  } finally {
    scriptUi.importingSb = false;
  }
}

export function createImportStoryboardRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    hasProject: () => !!refs.project.value,
    projectId: () => refs.project.value.id,
    episodeId: () => refs.episodeId.value,
    findStoryboard: helpers.findStoryboard,
    clearEpisodeOutputs: (episodeId) => {
      clearEpisodeGeneratedState(refs.scriptState, refs.scriptUi, episodeId, { clearScript: false });
      helpers.clearEpisodeVideoState?.(episodeId);
    },
    setEpisodeId: (episodeId) => { refs.episodeId.value = episodeId; },
    importStoryboard: (payload) => api.post('/api/script/storyboard/import', payload),
  };
}

export function createScriptImportRuntime({ api, message, refs = {}, readers = {}, helpers = {} } = {}) {
  const readHandlers = {
    readPlainTxtFiles: readers.readPlainTxtFiles,
    ...message,
  };
  return {
    importWholeNovelTxt: (fileList) => importWholeNovelTxtFlow(refs.scriptUi, refs.scriptState, fileList, {
      ...readHandlers,
      hasProject: () => !!refs.project.value,
      projectId: () => refs.project.value.id,
      importNovel: (payload) => api.post('/api/script/novel/import', payload),
    }),
    onPickWholeNovelFile: (event) => {
      if (event.target.files?.length) {
        importWholeNovelTxtFlow(refs.scriptUi, refs.scriptState, event.target.files, {
          ...readHandlers,
          hasProject: () => !!refs.project.value,
          projectId: () => refs.project.value.id,
          importNovel: (payload) => api.post('/api/script/novel/import', payload),
        });
      }
      event.target.value = '';
    },
    applyTxtToDraft: (fileList) => applyTxtToDraftFlow(refs.scriptUi, fileList, readHandlers),
    onSourceDrop: (event) => {
      event.preventDefault();
      refs.dragOver.value = false;
      if (event.dataTransfer?.files?.length) {
        applyTxtToDraftFlow(refs.scriptUi, event.dataTransfer.files, readHandlers);
      }
    },
    onPickSourceFile: (event) => {
      if (event.target.files?.length) applyTxtToDraftFlow(refs.scriptUi, event.target.files, readHandlers);
      event.target.value = '';
    },
    startAddChapter: () => startAddChapterUi(refs.scriptUi, refs.scriptState.chapters.length),
    cancelAddChapter: () => cancelAddChapterUi(refs.scriptUi),
    startImportEpisode: () => startImportEpisodeUi(refs.scriptUi, refs.scriptState.episodes.length),
    cancelImportEpisode: () => cancelImportEpisodeUi(refs.scriptUi),
    confirmImportEpisode: () => confirmImportEpisodeFlow(refs.scriptUi, refs.scriptState, {
      ...message,
      hasProject: () => !!refs.project.value,
      projectId: () => refs.project.value.id,
      importEpisode: (payload) => api.post('/api/script/episode/import', payload),
    }),
    createEpisodeDirect: () => createEmptyEpisodeFlow(refs.scriptUi, refs.scriptState, {
      ...message,
      hasProject: () => !!refs.project.value,
      projectId: () => refs.project.value.id,
      setEpisodeId: refs.storyboardEpisodeId ? (id) => { refs.storyboardEpisodeId.value = id; } : null,
      createEpisode: (payload) => api.post('/api/script/episode/create', payload),
    }),
    startImportStoryboard: () => startImportStoryboardUi(refs.scriptUi),
    cancelImportStoryboard: () => cancelImportStoryboardUi(refs.scriptUi),
    confirmImportStoryboard: () => confirmImportStoryboardFlow(
      refs.scriptUi,
      refs.scriptState,
      createImportStoryboardRuntimeContext({
        api,
        message,
        refs: {
          project: refs.project,
          episodeId: refs.episodeId,
          scriptState: refs.scriptState,
          scriptUi: refs.scriptUi,
        },
        helpers: {
          findStoryboard: helpers.findStoryboard,
          clearEpisodeVideoState: helpers.clearEpisodeVideoState,
        },
      })
    ),
    applyTxtToStoryboardImport: (fileList) => applyTxtToStoryboardImportFlow(refs.scriptUi, fileList, readHandlers),
    onStoryboardImportDrop: (event) => {
      event.preventDefault();
      refs.scriptUi.sbImportDragOver = false;
      if (event.dataTransfer?.files?.length) {
        applyTxtToStoryboardImportFlow(refs.scriptUi, event.dataTransfer.files, readHandlers);
      }
    },
    onPickStoryboardImportFile: (event) => {
      if (event.target.files?.length) applyTxtToStoryboardImportFlow(refs.scriptUi, event.target.files, readHandlers);
      event.target.value = '';
    },
    onStoryboardImportInput: () => syncStoryboardImportMarker(refs.scriptUi),
  };
}

export async function confirmAddChapterFlow(scriptUi, scriptState, handlers = {}) {
  if (!handlers.hasProject()) return;
  if (!scriptUi.draftText.trim()) return handlers.warning('请先粘贴或导入本章原文');
  const result = await handlers.saveChapter({
    projectId: handlers.projectId(),
    action: 'add',
    title: scriptUi.draftTitle,
    sourceText: scriptUi.draftText,
  });
  if (!result.ok) return handlers.error(result.error || '追加失败');
  invalidateWholeNovelRuntimeState(scriptState);
  scriptState.chapters.push(result.chapter);
  scriptUi.selectedId = `ch:${result.chapter.id}`;
  cancelAddChapterUi(scriptUi);
  handlers.success('已追加章节，可对它分集');
}

export function createChapterEditRuntimeContext({ api, message, refs = {}, helpers = {}, ui = {} } = {}) {
  return {
    ...message,
    hasProject: () => !!refs.project.value,
    projectId: () => refs.project.value.id,
    saveChapter: (payload) => api.post('/api/script/chapter', payload),
    clearEpisodeOutputs: (episodeId) => {
      clearEpisodeGeneratedState(refs.scriptState, refs.scriptUi, episodeId, { clearScript: true });
      helpers.clearEpisodeVideoState?.(episodeId);
    },
    confirmDelete: async (chapter) => {
      try {
        await ui.confirm(
          `删除「${chapter.title}」？该章节下已生成的集和分镜也会一并删除。`,
          '删除章节',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}

export async function updateChapterFlow(chapter, scriptState, handlers = {}) {
  const result = await handlers.saveChapter({
    projectId: handlers.projectId(),
    action: 'update',
    chapterId: chapter.id,
    title: chapter.title,
    sourceText: chapter.sourceText,
  });
  if (result.ok) {
    for (const episodeId of Array.isArray(result.invalidatedEpisodeIds) ? result.invalidatedEpisodeIds : []) {
      handlers.clearEpisodeOutputs?.(episodeId);
    }
    invalidateWholeNovelRuntimeState(scriptState);
    handlers.success('章节已保存');
  } else handlers.error(result.error || '保存失败');
}

export async function deleteChapterFlow(chapter, scriptState, handlers = {}) {
  const confirmed = await handlers.confirmDelete(chapter);
  if (!confirmed) return;
  const result = await handlers.saveChapter({ projectId: handlers.projectId(), action: 'delete', chapterId: chapter.id });
  if (!result.ok) return handlers.error(result.error || '删除失败');
  const removedEpisodes = scriptState.episodes.filter((episode) => episodeReferencesChapter(episode, chapter.id)).map((episode) => episode.id);
  for (const episodeId of removedEpisodes) handlers.clearEpisodeOutputs?.(episodeId);
  invalidateWholeNovelRuntimeState(scriptState);
  scriptState.chapters = scriptState.chapters.filter((item) => item.id !== chapter.id);
  scriptState.episodes = scriptState.episodes.filter((episode) => !episodeReferencesChapter(episode, chapter.id));
  scriptState.storyboards = scriptState.storyboards.filter(
    (storyboard) => !removedEpisodes.some((id) => String(id) === String(storyboard.episodeId)),
  );
  handlers.success('已删除');
}

export function createEpisodeDeleteRuntimeContext({ api, message, refs = {}, ui = {} } = {}) {
  return {
    ...message,
    projectId: () => refs.project.value.id,
    isBusy: (episodeId) => {
      const state = refs.scriptUi;
      return Boolean(
        state.deletingEpisode
        || state.genEpisode === episodeId
        || (state.genStoryboardSet || []).some((id) => String(id) === String(episodeId))
        || state.batchGen?.active
        || state.adaptingWholeNovel
        || state.splitting
        || state.genWhole
      );
    },
    setDeleting: (episodeId) => { refs.scriptUi.deletingEpisode = episodeId; },
    confirmDelete: async (episode) => {
      const label = episode.title || `第${episode.id}集`;
      try {
        await ui.confirm(
          `确定删除「${label}」？关联分镜、已生成视频、尾帧和本集待处理任务也会一并删除，且不可恢复。`,
          '删除本集',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
        );
        return true;
      } catch {
        return false;
      }
    },
    deleteEpisode: (payload) => api.post('/api/script/episode/delete', payload),
    storyboardEpisodeId: () => refs.storyboardEpisodeId?.value,
    setStoryboardEpisodeId: (episodeId) => {
      if (refs.storyboardEpisodeId) refs.storyboardEpisodeId.value = episodeId;
    },
    syncProject: (episodeId) => {
      const project = refs.project.value;
      if (!project) return;
      project.script = project.script && typeof project.script === 'object' ? project.script : {};
      project.script.episodes = refs.scriptState.episodes;
      project.script.storyboards = refs.scriptState.storyboards;
      project.updatedAt = new Date().toISOString();
    },
  };
}

export async function deleteEpisodeFlow(episode, scriptState, scriptUi, handlers = {}) {
  if (!episode) return false;
  const episodeId = Number(episode.id);
  if (handlers.isBusy(episodeId)) {
    handlers.warning('当前有剧本、分镜或批量任务正在运行，请完成后再删除');
    return false;
  }
  const confirmed = await handlers.confirmDelete(episode);
  if (!confirmed) return false;

  handlers.setDeleting(episodeId);
  try {
    const orderedBeforeDelete = episodesSorted(scriptState.episodes);
    const removedIndex = orderedBeforeDelete.findIndex((item) => Number(item.id) === episodeId);
    const adjacentEpisode = removedIndex >= 0
      ? (orderedBeforeDelete[removedIndex + 1] || orderedBeforeDelete[removedIndex - 1] || null)
      : null;
    const result = await handlers.deleteEpisode({ projectId: handlers.projectId(), episodeId });
    if (!result.ok) {
      handlers.error(result.error || '删除失败');
      return false;
    }

    scriptState.episodes = scriptState.episodes.filter((item) => Number(item.id) !== episodeId);
    scriptState.storyboards = scriptState.storyboards.filter((storyboard) => Number(storyboard.episodeId) !== episodeId);
    if (scriptUi.episodeSrcSig && typeof scriptUi.episodeSrcSig === 'object') delete scriptUi.episodeSrcSig[episodeId];
    if (scriptUi.scriptProgress?.episodeId === episodeId) scriptUi.scriptProgress = null;
    if (scriptUi.storyboardProgress?.episodeId === episodeId) scriptUi.storyboardProgress = null;

    const fallbackEpisode = adjacentEpisode
      ? scriptState.episodes.find((item) => Number(item.id) === Number(adjacentEpisode.id)) || null
      : null;
    const firstRemainingEpisode = episodesSorted(scriptState.episodes)[0] || null;
    const nextEpisode = fallbackEpisode || firstRemainingEpisode;
    if (scriptUi.selectedId === `ep:${episodeId}`) {
      if (nextEpisode) scriptUi.selectedId = `ep:${nextEpisode.id}`;
      else {
        const chapter = scriptState.chapters.find((item) => Number(item.id) === Number(episode.chapterId))
          || chaptersSorted(scriptState.chapters)[0]
          || null;
        scriptUi.selectedId = chapter ? `ch:${chapter.id}` : '';
        scriptUi.focusWriting = false;
      }
    }
    if (String(handlers.storyboardEpisodeId()) === String(episodeId)) {
      handlers.setStoryboardEpisodeId(nextEpisode ? nextEpisode.id : 0);
    }
    handlers.syncProject(episodeId);
    handlers.success('本集及关联内容已删除');
    if (Array.isArray(result.cleanupWarnings) && result.cleanupWarnings.length) {
      handlers.warning('本集已删除，但部分正在占用的媒体文件需要稍后手动清理');
    }
    return true;
  } catch (error) {
    handlers.error(error?.message || '删除失败');
    return false;
  } finally {
    handlers.setDeleting(0);
  }
}

export async function recutEpisodeFlow(episode, startOffset, endOffset, handlers = {}) {
  const result = await handlers.recutEpisode({
    projectId: handlers.projectId(),
    episodeId: episode.id,
    startOffset,
    endOffset,
  });
  if (result.ok && result.episode) {
    if (result.invalidated) handlers.clearEpisodeOutputs?.(episode.id);
    episode.startOffset = result.episode.startOffset;
    episode.endOffset = result.episode.endOffset;
    handlers.success('切点已调整');
  } else {
    handlers.error(result.error || '调整失败');
  }
}

export function createGenerateEpisodeContext(handlers = {}) {
  return {
    ...handlers.message,
    isGenerating: () => handlers.ui.genEpisode,
    hasProject: () => !!handlers.project(),
    projectId: () => handlers.project().id,
    findEpisode: handlers.findEpisode,
    requireActiveCustomPrompt: handlers.requireActiveCustomPrompt,
    setGenerating: (episodeId) => { handlers.ui.genEpisode = episodeId; },
    setScriptProgress: (progress) => { handlers.ui.scriptProgress = progress; },
    getScriptProgress: () => handlers.ui.scriptProgress,
    setSelectedId: (selectedId) => { handlers.ui.selectedId = selectedId; },
    nextTick: handlers.nextTick,
    postStream: (payload, callbacks) => handlers.api.postStream('/api/script/episode/stream', payload, callbacks),
    nudgeProgress: () => handlers.nudgeProgress(handlers.ui.scriptProgress),
    updateProgress: handlers.updateProgress,
    clearEpisodeOutputs: (episodeId) => {
      clearEpisodeGeneratedState(handlers.scriptState, handlers.ui, episodeId, { clearScript: false });
      handlers.clearEpisodeVideoState?.(episodeId);
    },
    stampSourceSig: (episodeId) => {
      const scriptState = handlers.scriptState;
      if (!scriptState || !handlers.ui.episodeSrcSig) return;
      const episode = handlers.findEpisode(episodeId);
      if (!episode) return;
      const slice = selectedSliceForEpisode(episode, scriptState.chapters);
      handlers.ui.episodeSrcSig[episodeId] = chapterSig(slice);
    },
  };
}

export function generateEpisodeOptions(params = {}) {
  return {
    requirement: params.requirement || '',
    throwOnError: !!params.throwOnError,
    customScriptPrompt: params.activeScriptCustomPrompt?.value || '',
    scriptPromptMode: params.scriptState.settings.scriptPromptMode,
    adaptationStrength: params.scriptState.settings.adaptationStrength || 'enhanced',
  };
}

export async function runGenerateEpisodeFlow(episodeId, options = {}, handlers = {}) {
  const {
    requirement = '',
    throwOnError = false,
    customScriptPrompt = '',
    scriptPromptMode = 'builtin',
    adaptationStrength = 'enhanced',
  } = options;
  if (handlers.isGenerating()) return;
  if (!handlers.hasProject()) return;
  const episode = handlers.findEpisode(episodeId);
  if (!episode) return handlers.warning('该集不存在');
  if (!handlers.requireActiveCustomPrompt()) return;
  handlers.setGenerating(episodeId);
  handlers.setScriptProgress({ episodeId, total: 1, index: 0, status: 'running', percentage: 3, text: '正在准备生成…' });
  const previousContent = episode.content || '';
  episode.content = '';
  handlers.setSelectedId(`ep:${episodeId}`);
  await handlers.nextTick();
  let outcome = { ok: false, episodeId, error: null };
  try {
    await handlers.postStream(
      {
        projectId: handlers.projectId(),
        episodeId,
        requirement,
        customScriptPrompt,
        scriptPromptMode,
        adaptationStrength,
      },
      {
        onDelta: (text) => {
          episode.content += text;
          handlers.nudgeProgress();
        },
        onProgress: (progress) => handlers.updateProgress(progress),
        onDone: (result) => {
          if (result?.episode) {
            Object.assign(episode, result.episode);
          }
          handlers.stampSourceSig?.(episodeId);
          handlers.setScriptProgress({ ...(handlers.getScriptProgress() || {}), episodeId, status: 'done', percentage: 100, text: '生成完成' });
        },
      },
    );
    outcome = {
      ok: !!(episode.content || '').trim(),
      episodeId,
      error: (episode.content || '').trim() ? null : new Error(`第${episodeId}集生成结束但内容为空`),
    };
    if (!outcome.ok) episode.content = previousContent;
    else handlers.clearEpisodeOutputs?.(episodeId);
  } catch (error) {
    episode.content = previousContent;
    handlers.error(`第${episodeId}集生成失败：${error.message}`);
    if (throwOnError) throw error;
    outcome = { ok: false, episodeId, error };
  } finally {
    handlers.setGenerating(0);
    setTimeout(() => {
      if (!handlers.isGenerating() && handlers.getScriptProgress()?.episodeId === episodeId) {
        handlers.setScriptProgress(null);
      }
    }, 1200);
  }
  return outcome;
}

export async function splitChapterFlow(chapter, handlers = {}) {
  if (handlers.isSplitting()) return;
  handlers.setSplitting(chapter.id);
  await handlers.nextTick();
  try {
    const result = await handlers.splitChapter({ projectId: handlers.projectId(), chapterId: chapter.id });
    if (!result.ok) return handlers.error(`分集失败：${result.error}`);
    handlers.replaceChapterEpisodes(chapter.id, result.episodes || []);
    handlers.success(`「${chapter.title}」分出 ${(result.episodes || []).length} 集`);
  } catch (error) {
    handlers.error(`分集失败：${error.message}`);
  } finally {
    handlers.setSplitting(0);
  }
}

export function createSplitChapterRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    isSplitting: () => !!refs.scriptUi.splitting,
    setSplitting: (chapterId) => { refs.scriptUi.splitting = chapterId; },
    nextTick: helpers.nextTick,
    projectId: () => refs.project.value.id,
    splitChapter: (payload) => api.post('/api/script/chapter/split', payload),
    replaceChapterEpisodes: (chapterId, episodes = []) => {
      const removedIds = refs.scriptState.episodes
        .filter((episode) => episode.chapterId === chapterId)
        .map((episode) => episode.id);
      for (const episodeId of removedIds) {
        clearEpisodeGeneratedState(refs.scriptState, refs.scriptUi, episodeId, { clearScript: true });
        helpers.clearEpisodeVideoState?.(episodeId);
      }
      refs.scriptState.episodes = refs.scriptState.episodes.filter((episode) => episode.chapterId !== chapterId);
      refs.scriptState.episodes.push(...episodes);
      refs.scriptState.episodes.sort((a, b) => a.id - b.id);
    },
  };
}

export function createScriptTimelineRuntime({ api, message, refs = {}, helpers = {}, ui = {} } = {}) {
  const chapterContext = () => createChapterEditRuntimeContext({
    api,
    message,
    refs: {
      project: refs.project,
      scriptState: refs.scriptState,
      scriptUi: refs.scriptUi,
    },
    helpers: { clearEpisodeVideoState: helpers.clearEpisodeVideoState },
    ui,
  });
  const episodeDeleteContext = () => createEpisodeDeleteRuntimeContext({
    api,
    message,
    refs: {
      project: refs.project,
      scriptState: refs.scriptState,
      scriptUi: refs.scriptUi,
      storyboardEpisodeId: refs.storyboardEpisodeId,
    },
    ui,
  });
  return {
    chaptersSorted: () => chaptersSorted(refs.scriptState.chapters),
    episodesSorted: () => episodesSorted(refs.scriptState.episodes),
    prevEpisodeOf: (id) => {
      const list = episodesSorted(refs.scriptState.episodes);
      const at = list.findIndex((episode) => episode.id === id);
      return at > 0 ? list[at - 1].id : null;
    },
    nextEpisodeOf: (id) => {
      const list = episodesSorted(refs.scriptState.episodes);
      const at = list.findIndex((episode) => episode.id === id);
      return at >= 0 && at < list.length - 1 ? list[at + 1].id : null;
    },
    gotoEpisodeId: (id) => {
      if (id == null) return;
      refs.scriptUi.selectedId = `ep:${id}`;
    },
    isWholeNovelTimeline: () => refs.scriptState.wholeNovelAdapted === true || refs.scriptState.episodes.some((episode) => episode.sourceMode === 'wholeNovel'),
    episodesOfChapter: (chapterId) => episodesOfChapter(refs.scriptState.episodes, chapterId),
    findEpisode: (id) => findEpisode(refs.scriptState.episodes, id),
    findChapter: (id) => findChapter(refs.scriptState.chapters, id),
    findStoryboard: (episodeId) => findStoryboard(refs.scriptState.storyboards, episodeId),
    confirmAddChapter: () => confirmAddChapterFlow(refs.scriptUi, refs.scriptState, chapterContext()),
    updateChapter: (chapter) => updateChapterFlow(chapter, refs.scriptState, chapterContext()),
    deleteChapter: (chapter) => deleteChapterFlow(chapter, refs.scriptState, chapterContext()),
    deleteEpisode: (episode) => deleteEpisodeFlow(episode, refs.scriptState, refs.scriptUi, episodeDeleteContext()),
    splitChapter: (chapter) => splitChapterFlow(chapter, createSplitChapterRuntimeContext({
      api,
      message,
      refs: {
        scriptUi: refs.scriptUi,
        scriptState: refs.scriptState,
        project: refs.project,
      },
      helpers: {
        nextTick: helpers.nextTick,
        clearEpisodeVideoState: helpers.clearEpisodeVideoState,
      },
    })),
    recutEpisode: (episode, startOffset, endOffset) => recutEpisodeFlow(episode, startOffset, endOffset, {
      ...message,
      projectId: () => refs.project.value.id,
      recutEpisode: (payload) => api.post('/api/script/episode/recut', payload),
      clearEpisodeOutputs: (episodeId) => {
        clearEpisodeGeneratedState(refs.scriptState, refs.scriptUi, episodeId, { clearScript: true });
        helpers.clearEpisodeVideoState?.(episodeId);
      },
    }),
  };
}

export function createGenerateWholeChapterContext(handlers = {}) {
  return {
    ...handlers.message,
    isGeneratingWhole: () => !!handlers.ui.genWhole,
    isGeneratingEpisode: () => !!handlers.ui.genEpisode,
    hasProject: () => !!handlers.project(),
    requireActiveCustomPrompt: handlers.requireActiveCustomPrompt,
    setGeneratingWhole: (chapterId) => { handlers.ui.genWhole = chapterId; },
    projectId: () => handlers.project().id,
    createWholeEpisode: (payload) => handlers.api.post('/api/script/chapter/whole', payload),
    upsertEpisode: (episode) => {
      if (!handlers.scriptState.episodes.find((item) => item.id === episode.id)) {
        handlers.scriptState.episodes.push(episode);
        handlers.scriptState.episodes.sort((a, b) => a.id - b.id);
      }
    },
    setSelectedId: (selectedId) => { handlers.ui.selectedId = selectedId; },
    generateEpisode: handlers.generateEpisode,
  };
}

export async function generateWholeChapterFlow(chapter, handlers = {}) {
  if (handlers.isGeneratingWhole() || handlers.isGeneratingEpisode()) return;
  if (!handlers.hasProject()) return;
  if (!(chapter.sourceText || '').trim()) return handlers.warning('该章节还没有原文');
  if (!handlers.requireActiveCustomPrompt()) return;
  handlers.setGeneratingWhole(chapter.id);
  try {
    const result = await handlers.createWholeEpisode({ projectId: handlers.projectId(), chapterId: chapter.id });
    if (!result.ok || !result.episode) return handlers.error(result.error || '生成失败');
    handlers.upsertEpisode(result.episode);
    handlers.setSelectedId(`ep:${result.episode.id}`);
    await handlers.generateEpisode(result.episode.id);
  } catch (error) {
    handlers.error(`生成失败：${error.message}`);
  } finally {
    handlers.setGeneratingWhole(0);
  }
}

export async function generateAllEpisodesFlow(handlers = {}) {
  if (handlers.isGeneratingAll()) return;
  const all = handlers.episodes();
  if (!all.length) return handlers.warning('请先对章节分集');
  const onlyUnfinished = handlers.onlyUnfinished === true;
  const targets = (onlyUnfinished ? all.filter((ep) => !(ep.content || '').trim()) : all)
    .slice()
    .sort((a, b) => a.id - b.id);
  if (!targets.length) {
    return (handlers.info || handlers.success)('所有剧集都已生成，没有需要补的集');
  }
  if (!handlers.requireActiveCustomPrompt()) return;
  const batch = handlers.batch || {};
  const isCancelled = handlers.isCancelled || (() => false);
  batch.active = true;
  batch.cancel = false;
  batch.total = targets.length;
  batch.done = 0;
  batch.failed = 0;
  batch.skipped = all.length - targets.length;
  batch.onlyUnfinished = onlyUnfinished;
  batch.currentEpisodeId = 0;
  batch.currentTitle = '';
  handlers.setGeneratingAll(true);
  let completed = 0;
  let processed = 0;
  let failed = 0;
  let stopped = false;
  const failures = [];
  try {
    for (const episode of targets) {
      if (isCancelled()) { stopped = true; break; }
      batch.currentEpisodeId = episode.id;
      batch.currentTitle = episode.title || `第${episode.id}集`;
      handlers.onEpisodeStart?.({ episode, index: processed, total: targets.length });
      let result;
      try {
        result = await handlers.generateEpisode(episode.id, '', handlers.throwOnError === true);
      } catch (error) {
        if (handlers.throwOnError === true) throw error;
        result = { ok: false, error };
      }
      processed += 1;
      batch.done = processed;
      if (result?.ok === false || !(episode.content || '').trim()) {
        failed += 1;
        batch.failed = failed;
        const error = result?.error || new Error(`第${episode.id}集生成结束但内容为空`);
        failures.push({ episodeId: episode.id, title: episode.title || '', message: error.message });
        handlers.onEpisodeFailed?.({ episode, processed, failed, completed, total: targets.length, error });
        continue;
      }
      completed += 1;
      handlers.onEpisodeDone?.({ episode, processed, completed, failed, total: targets.length });
    }
    if (!handlers.silentSummary) {
      if (stopped) {
        handlers.warning(`已停止批量生成，成功 ${completed} 集、失败 ${failed} 集`);
      } else if (failed) {
        handlers.warning(`批量生成结束：成功 ${completed} 集、失败 ${failed} 集，可继续补齐未完成剧集`);
      } else {
        handlers.success(onlyUnfinished ? `已补齐 ${completed} 集剧本` : '全部剧本已生成');
      }
    }
    return {
      total: targets.length,
      processed,
      completed,
      failed,
      cancelled: stopped,
      failures,
    };
  } finally {
    batch.active = false;
    batch.cancel = false;
    batch.currentEpisodeId = 0;
    batch.currentTitle = '';
    handlers.setGeneratingAll(false);
  }
}

export function createGenerateStoryboardContext(handlers = {}) {
  return {
    ...handlers.message,
    // 传 episodeId：仅该集正在生成时阻塞（支持跨集并发）；不传：任一分镜生成中即阻塞（兼容旧语义）
    isGenerating: (episodeId) => {
      const set = handlers.ui.genStoryboardSet || [];
      if (episodeId != null && episodeId !== '') return set.some((id) => String(id) === String(episodeId));
      return set.length > 0;
    },
    hasProject: () => !!handlers.project(),
    projectId: () => handlers.project().id,
    findEpisode: handlers.findEpisode,
    findStoryboard: handlers.findStoryboard,
    requireActiveCustomPrompt: handlers.requireActiveCustomPrompt,
    storyboards: handlers.scriptState.storyboards,
    setGenerating: (episodeId, running = true) => {
      const set = handlers.ui.genStoryboardSet || (handlers.ui.genStoryboardSet = []);
      const index = set.findIndex((id) => String(id) === String(episodeId));
      if (running && index < 0) set.push(episodeId);
      if (!running && index >= 0) set.splice(index, 1);
      handlers.ui.genStoryboard = set.length ? set[set.length - 1] : 0;
    },
    setStoryboardProgress: (progress) => { handlers.ui.storyboardProgress = progress; },
    getStoryboardProgress: () => handlers.ui.storyboardProgress,
    nextTick: handlers.nextTick,
    postStream: (payload, callbacks) => handlers.api.postStream('/api/script/storyboard/stream', payload, callbacks),
    nudgeProgress: () => handlers.nudgeProgress(handlers.ui.storyboardProgress),
    updateProgress: handlers.updateProgress,
  };
}

// ---- 集数按标题章节号排序 ----
// 解析标题里的章节序号：支持「第12章」「第三卷」「第12话」等；解析失败返回 null
const CN_DIGIT_MAP = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT_MAP = { 十: 10, 百: 100, 千: 1000 };

function parseChineseNumeral(text) {
  const chars = [...String(text || '')];
  if (!chars.length) return null;
  if (chars.every((ch) => CN_DIGIT_MAP[ch] !== undefined)) {
    let n = 0;
    for (const ch of chars) n = n * 10 + CN_DIGIT_MAP[ch];
    return n > 0 ? n : null;
  }
  let total = 0;
  let current = 0;
  for (const ch of chars) {
    if (CN_DIGIT_MAP[ch] !== undefined) {
      current = current * 10 + CN_DIGIT_MAP[ch];
    } else if (CN_UNIT_MAP[ch] !== undefined) {
      total += (current || 1) * CN_UNIT_MAP[ch];
      current = 0;
    } else {
      return null;
    }
  }
  const result = total + current;
  return result > 0 ? result : null;
}

export function parseEpisodeChapterNumber(title) {
  const match = String(title || '').match(/第\s*([0-9０-９]+|[零一二三四五六七八九十百千两]+)\s*(?:章|卷|话|話|节|回|集)/);
  if (!match) return null;
  const raw = match[1];
  if (/^[0-9０-９]+$/.test(raw)) {
    const n = Number(raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return parseChineseNumeral(raw);
}

// 章节号升序；没有章节号的按集号数字兜底，再按原顺序稳定排列。只用于显示排序，不改动数组本身。
export function sortEpisodesByChapterTitle(episodes = []) {
  const list = (Array.isArray(episodes) ? episodes : []).filter(Boolean);
  return list
    .map((ep, index) => ({
      ep,
      index,
      no: parseEpisodeChapterNumber(ep?.title) ?? (Number.isFinite(Number(ep?.id)) ? Number(ep.id) : null),
    }))
    .sort((a, b) => {
      if (a.no != null && b.no != null && a.no !== b.no) return a.no - b.no;
      if (a.no != null && b.no == null) return -1;
      if (a.no == null && b.no != null) return 1;
      return a.index - b.index;
    })
    .map((item) => item.ep);
}

export function generateStoryboardOptions(params = {}) {
  return {
    mode: params.mode || 'normal',
    requirement: params.requirement || '',
    throwOnError: !!params.throwOnError,
    customStoryboardPrompt: params.activeStoryboardCustomPrompt?.value || '',
    storyboardPromptMode: params.scriptState.settings.storyboardPromptMode,
    shotHeaderPrefix: params.shotHeaderPrefix.value,
    storyboardPromptTemplateId: params.storyboardPromptTemplateId.value,
    useQVersion: params.scriptState.settings.useQVersion !== false,
  };
}

export function createGenerateStoryboardOptions(params = {}) {
  return generateStoryboardOptions({
    mode: params.mode,
    requirement: params.requirement,
    throwOnError: params.throwOnError,
    activeStoryboardCustomPrompt: params.activeStoryboardCustomPrompt,
    scriptState: params.scriptState,
    shotHeaderPrefix: params.shotHeaderPrefix,
    storyboardPromptTemplateId: params.storyboardPromptTemplateId,
  });
}

export function createGenerateStoryboardRuntimeContext({ base = {}, refs = {}, helpers = {} } = {}) {
  return {
    ...base,
    activeStoryboardCustomPrompt: refs.activeStoryboardCustomPrompt,
    scriptState: refs.scriptState,
    shotHeaderPrefix: refs.shotHeaderPrefix,
    storyboardPromptTemplateId: refs.storyboardPromptTemplateId,
    findEpisode: helpers.findEpisode,
    findStoryboard: helpers.findStoryboard,
    requireActiveCustomPrompt: helpers.requireActiveCustomPrompt,
    clearEpisodeVideoState: helpers.clearEpisodeVideoState,
    updateProgress: helpers.updateProgress,
  };
}

export function generateStoryboardWithContextFlow(episodeId, params = {}, handlers = {}) {
  return runGenerateStoryboardFlow(
    episodeId,
    createGenerateStoryboardOptions({
      ...params,
      activeStoryboardCustomPrompt: handlers.activeStoryboardCustomPrompt,
      scriptState: handlers.scriptState,
      shotHeaderPrefix: handlers.shotHeaderPrefix,
      storyboardPromptTemplateId: handlers.storyboardPromptTemplateId,
    }),
    createGenerateStoryboardContext({
      ...handlers,
      requireActiveCustomPrompt: () => handlers.requireActiveCustomPrompt('storyboard', params.throwOnError),
      updateProgress: (progress) => handlers.updateProgress(episodeId, progress),
    })
  );
}

export function createScriptGenerationRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const base = {
    api,
    message,
    ui: refs.scriptUi,
    project: () => refs.project.value,
    nextTick: helpers.nextTick,
    nudgeProgress: helpers.nudgeProgress,
  };
  const generateEpisode = (episodeId, requirement = '', throwOnError = false) => (
    runGenerateEpisodeFlow(episodeId, generateEpisodeOptions({
      requirement,
      throwOnError,
      activeScriptCustomPrompt: refs.activeScriptCustomPrompt,
      scriptState: refs.scriptState,
    }), createGenerateEpisodeContext({
      ...base,
      scriptState: refs.scriptState,
      findEpisode: helpers.findEpisode,
      requireActiveCustomPrompt: () => helpers.requireActiveCustomPrompt('script', throwOnError),
      updateProgress: (progress) => helpers.updateScriptProgress(episodeId, progress),
      clearEpisodeVideoState: helpers.clearEpisodeVideoState,
    }))
  );
  return {
    generateWholeChapter: (chapter) => generateWholeChapterFlow(chapter, createGenerateWholeChapterContext({
      ...base,
      scriptState: refs.scriptState,
      requireActiveCustomPrompt: () => helpers.requireActiveCustomPrompt('script'),
      generateEpisode,
    })),
    generateEpisode,
    generateStoryboard: (episodeId, mode = 'normal', requirement = '', throwOnError = false) => (
      generateStoryboardWithContextFlow(episodeId, {
        mode,
        requirement,
        throwOnError,
      }, createGenerateStoryboardRuntimeContext({
        base,
        refs: {
          activeStoryboardCustomPrompt: refs.activeStoryboardCustomPrompt,
          scriptState: refs.scriptState,
          shotHeaderPrefix: refs.shotHeaderPrefix,
          storyboardPromptTemplateId: refs.storyboardPromptTemplateId,
        },
        helpers: {
          findEpisode: helpers.findEpisode,
          findStoryboard: helpers.findStoryboard,
          requireActiveCustomPrompt: helpers.requireActiveCustomPrompt,
          clearEpisodeVideoState: helpers.clearEpisodeVideoState,
          updateProgress: helpers.updateStoryboardProgress,
        },
      }))
    ),
  };
}

export async function runGenerateStoryboardFlow(episodeId, options = {}, handlers = {}) {
  const {
    requirement = '',
    throwOnError = false,
    customStoryboardPrompt = '',
    storyboardPromptMode = 'builtin',
    shotHeaderPrefix,
    storyboardPromptTemplateId,
    useQVersion = true,
  } = options;
  if (handlers.isGenerating(episodeId)) return;
  if (!handlers.hasProject()) return;
  const episode = handlers.findEpisode(episodeId);
  if (!episode || !episode.content) return handlers.warning('请先生成该集剧本');
  if (!handlers.requireActiveCustomPrompt()) return;
  const storyboardMode = 'normal';
  const projectId = handlers.projectId();
  handlers.setGenerating(episodeId, true);
  let storyboard = handlers.findStoryboard(episodeId);
  const previousStoryboard = storyboard ? {
    content: storyboard.content || '',
    mode: storyboard.mode || storyboardMode,
    existed: true,
  } : { content: '', mode: storyboardMode, existed: false };
  const initialStoryboard = {
    ...(storyboard || {}),
    episodeId,
    episodeTitle: episode.title,
    content: '',
    mode: storyboardMode,
  };
  storyboard = upsertStoryboard(handlers.storyboards, initialStoryboard);
  setActiveStoryboardDraft(projectId, episodeId, storyboard);
  const isCurrentProject = () => {
    try {
      return handlers.hasProject() && String(handlers.projectId()) === String(projectId);
    } catch {
      return false;
    }
  };
  const storyboardTarget = () => {
    const draft = updateActiveStoryboardDraft(projectId, episodeId) || {
      episodeId,
      episodeTitle: episode.title,
      content: '',
      mode: storyboardMode,
    };
    if (!isCurrentProject()) return draft;
    let target = handlers.findStoryboard(episodeId);
    if (!target) {
      target = upsertStoryboard(handlers.storyboards, draft);
    }
    storyboard = target;
    return target;
  };
  handlers.setStoryboardProgress({ episodeId, total: 1, index: 0, status: 'running', percentage: 3, text: '正在准备生成分镜…' });
  await handlers.nextTick();
  try {
    await handlers.postStream(
      {
        projectId: handlers.projectId(),
        episodeId,
        requirement,
        customStoryboardPrompt,
        storyboardPromptMode,
        shotHeaderPrefix,
        storyboardPromptTemplateId,
        useQVersion,
      },
      {
        onDelta: (text) => {
          const target = storyboardTarget();
          target.content = `${target.content || ''}${text}`;
          updateActiveStoryboardDraft(projectId, episodeId, { ...target });
          handlers.nudgeProgress();
        },
        onProgress: (progress) => handlers.updateProgress(progress),
        onDone: (result) => {
          if (result?.storyboard) {
            const target = storyboardTarget();
            const appliedPrefix = normalizeShotHeaderPrefix(target.videoPromptPrefix);
            Object.assign(target, {
              ...result.storyboard,
              manualTags: (result.storyboard.manualTags && typeof result.storyboard.manualTags === 'object') ? result.storyboard.manualTags : {},
              excludedTags: (result.storyboard.excludedTags && typeof result.storyboard.excludedTags === 'object') ? result.storyboard.excludedTags : {},
            });
            target.shotVideos = {};
            target.openerFrames = {};
            handlers.clearEpisodeVideoState?.(episodeId);
            if (appliedPrefix) {
              target.videoPromptPrefix = appliedPrefix;
              target.content = updateStoryboardShotPrefix(target.content, { nextPrefix: appliedPrefix });
            }
            if (isCurrentProject() && !handlers.findStoryboard(episodeId)) {
              upsertStoryboard(handlers.storyboards, target);
            }
            clearActiveStoryboardDraft(projectId, episodeId);
          }
          handlers.setStoryboardProgress({ ...(handlers.getStoryboardProgress() || {}), episodeId, status: 'done', percentage: 100, text: '分镜生成完成' });
        },
      },
    );
  } catch (error) {
    if (previousStoryboard.existed) {
      const target = storyboardTarget();
      target.content = previousStoryboard.content;
      target.mode = previousStoryboard.mode;
      updateActiveStoryboardDraft(projectId, episodeId, { ...target });
    } else {
      if (isCurrentProject()) {
        const index = handlers.storyboards.findIndex((item) => item.episodeId === episodeId);
        if (index >= 0) handlers.storyboards.splice(index, 1);
      }
    }
    clearActiveStoryboardDraft(projectId, episodeId);
    const progress = handlers.getStoryboardProgress();
    handlers.setStoryboardProgress({ ...(progress || {}), episodeId, status: 'exception', percentage: progress?.percentage || 0, text: '分镜生成失败，已恢复生成前内容' });
    handlers.error(`第${episodeId}集分镜生成失败：${error.message}`);
    if (throwOnError) throw error;
  } finally {
    handlers.setGenerating(episodeId, false);
    setTimeout(() => {
      if (!handlers.isGenerating() && handlers.getStoryboardProgress()?.episodeId === episodeId) {
        handlers.setStoryboardProgress(null);
      }
    }, 1200);
  }
}
