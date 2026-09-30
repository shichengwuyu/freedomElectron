import { hydrateProjectImageState } from './imageState.js';

export function createAppBaseStateRuntime({ reactive, ref } = {}) {
  return {
    view: ref('loading'),
    license: reactive({ loading: false, activated: true }),
    project: ref(null),
    cat: ref('character'),
    projectStyle: ref('realistic'),
    selectedElementIndex: ref(-1),
    elementSearchQuery: ref(''),
    // 提取范围：数组形式的多选；空数组代表"全部元素"（与后端约定一致）。
    extractCategory: ref([]),
    lastExtractCounts: reactive({ character: 0, group: 0, scene: 0, prop: 0, effect: 0, creature: 0 }),
    inspectorVisible: ref(false),
    elementsDrawer: ref(false),
    atelierPanel: ref(''),
    settingsSection: ref('text'),
    settingsTextTab: ref('text'),
    settingsPromptKind: ref('script'),
    settingsSelectedPromptId: ref(''),
    sbEpisodeId: ref(0),
  };
}

export function createAppLifecycleRuntime({ watch, onMounted, message, refs = {}, helpers = {} } = {}) {
  watch(refs.view, (view) => {
    if (view === 'projects' && refs.license.activated) helpers.loadProjects();
    if (view === 'tasks' && refs.license.activated) {
      helpers.loadTaskCenter();
      helpers.startTaskAutoRefresh?.();
    } else {
      helpers.stopTaskAutoRefresh?.();
    }
    if (view === 'novel' && refs.license.activated) helpers.loadNovelDrafts?.();
  });

  onMounted(async () => {
    const initialView = helpers.initialView || 'projects';
    try {
      refs.view.value = initialView;
      await helpers.loadSettings();
      await helpers.loadStoryboardPromptTemplates();
      await helpers.loadProjects();
      await helpers.loadNovelDrafts?.();
    } catch (error) {
      console.error('初始化失败:', error);
      message.error(`加载失败：${error.message}`);
      refs.view.value = initialView;
    } finally {
      await helpers.notifyRendererReady?.();
    }
  });
}

function clearObject(object) {
  for (const key of Object.keys(object || {})) delete object[key];
}

export function createWorkspaceProjectContext(handlers = {}) {
  return {
    fetchProject: (projectId) => handlers.api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    error: (message) => handlers.message.error(message),
    notifyCharacterAssetRecovery: (recovery) => {
      const restored = Number(recovery?.restored) || 0;
      if (!restored) return;
      const details = [
        recovery.fromSnapshots ? `${recovery.fromSnapshots} 个来自历史记录` : '',
        recovery.fromImages ? `${recovery.fromImages} 个来自本地图片` : '',
      ].filter(Boolean).join('，');
      handlers.message.success(`已恢复 ${restored} 个人物造型${details ? `（${details}）` : ''}`);
    },
    clearVideoState: () => {
      clearObject(handlers.shotVideos);
      clearObject(handlers.shotStatus);
    },
    setProject: (nextProject) => { handlers.projectRef.value = handlers.hydrateImageState(nextProject); },
    rememberExtractCounts: handlers.rememberExtractCounts,
    selectDefaultElementCategory: () => { handlers.categoryRef.value = 'character'; },
    resetWorkspaceUi: () => resetWorkspaceUi(handlers),
    syncProjectStyle: handlers.syncProjectStyle,
    syncCharacterImageMode: handlers.syncCharacterImageMode,
    hydrateScript: handlers.hydrateScript,
    hydrateShotVideos: handlers.hydrateShotVideos,
    loadVideoBar: handlers.loadVideoBar,
    hydratePending: handlers.hydratePending,
    setScriptStage: (stage) => { handlers.scriptUi.stage = stage; },
    setView: (view) => { handlers.viewRef.value = view; },
  };
}

export function createWorkspaceBaseRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    api,
    message,
    projectRef: refs.project,
    viewRef: refs.view,
    selectedElementIndexRef: refs.selectedElementIndex,
    inspectorVisibleRef: refs.inspectorVisible,
    novelTextRef: refs.novelText,
    hydrateImageState: helpers.hydrateImageState,
    syncProjectStyle: helpers.syncProjectStyle,
    syncCharacterImageMode: helpers.syncCharacterImageMode,
  };
}

export function createOpenWorkspaceProjectRuntimeContext({ api, message, refs = {}, helpers = {}, state = {} } = {}) {
  return createWorkspaceProjectContext({
    ...createWorkspaceBaseRuntime({ api, message, refs, helpers }),
    shotVideos: state.shotVideos,
    shotStatus: state.shotStatus,
    rememberExtractCounts: helpers.rememberExtractCounts,
    categoryRef: refs.category,
    extractErrorsRef: refs.extractErrors,
    hydrateScript: helpers.hydrateScript,
    hydrateShotVideos: helpers.hydrateShotVideos,
    loadVideoBar: helpers.loadVideoBar,
    hydratePending: helpers.hydratePending,
    scriptUi: refs.scriptUi,
  });
}

export function createRefreshElementsContext(handlers = {}) {
  return {
    fetchProject: (projectId) => handlers.api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    error: (message) => handlers.message.error(message),
    setProject: (nextProject) => { handlers.projectRef.value = handlers.hydrateImageState(nextProject); },
    syncProjectStyle: handlers.syncProjectStyle,
    syncCharacterImageMode: handlers.syncCharacterImageMode,
    setExtractedSigs: (sigs) => { handlers.scriptState.extractedSigs = sigs; },
  };
}

export function createRefreshElementsRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return createRefreshElementsContext({
    ...createWorkspaceBaseRuntime({ api, message, refs, helpers }),
    scriptState: refs.scriptState,
  });
}

export function createBackToProjectsContext(handlers = {}) {
  return {
    clearProject: () => {
      handlers.projectRef.value = null;
    },
    resetWorkspaceUi: () => resetWorkspaceUi(handlers),
    loadProjects: handlers.loadProjects,
    setView: (view) => { handlers.viewRef.value = view; },
  };
}

export function createBackToProjectsRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return createBackToProjectsContext({
    ...createWorkspaceBaseRuntime({ api, message, refs, helpers }),
    loadProjects: helpers.loadProjects,
  });
}

function resetWorkspaceUi(handlers = {}) {
  handlers.selectedElementIndexRef.value = -1;
  handlers.inspectorVisibleRef.value = false;
  handlers.novelTextRef.value = '';
  if (handlers.extractErrorsRef) handlers.extractErrorsRef.value = [];
}

export async function openWorkspaceProjectFlow(id, handlers = {}) {
  const result = await handlers.fetchProject(id);
  if (result.error) return handlers.error(result.error);
  handlers.clearVideoState();
  handlers.setProject(result.project);
  handlers.notifyCharacterAssetRecovery?.(result.characterAssetRecovery);
  handlers.rememberExtractCounts();
  handlers.selectDefaultElementCategory();
  handlers.resetWorkspaceUi();
  handlers.syncProjectStyle();
  handlers.syncCharacterImageMode();
  handlers.hydrateScript(result.project);
  handlers.hydrateShotVideos();
  handlers.loadVideoBar();
  handlers.hydratePending();
  handlers.setScriptStage('script');
  handlers.setView('workspace');
}

export async function refreshElementsAfterExtractFlow(id, handlers = {}) {
  const result = await handlers.fetchProject(id);
  if (result.error) return handlers.error(result.error);
  handlers.setProject(result.project);
  handlers.syncProjectStyle();
  handlers.syncCharacterImageMode();
  const fresh = (result.project && result.project.script) || {};
  if (fresh.extractedSigs && typeof fresh.extractedSigs === 'object') {
    handlers.setExtractedSigs({ ...fresh.extractedSigs });
  }
}

export async function backToProjectsFlow(handlers = {}) {
  handlers.rememberWorkspacePosition?.();
  handlers.clearProject();
  handlers.resetWorkspaceUi();
  await handlers.loadProjects();
  handlers.setView('projects');
}

export function openProjectAreaFlow(handlers = {}) {
  const nextView = handlers.hasProject?.() ? 'workspace' : 'projects';
  handlers.setView?.(nextView);
  return nextView;
}

export function captureWorkspaceScrollSnapshot({ windowObject, documentObject } = {}) {
  const scrollTop = Math.max(0, Number(windowObject?.scrollY ?? documentObject?.documentElement?.scrollTop) || 0);
  const cards = Array.from(documentObject?.querySelectorAll?.('.workspace-stage-shell .shot-stack-item[id]') || []);
  const focusLine = Math.min(240, Math.max(80, (Number(windowObject?.innerHeight) || 0) * 0.25));
  const cardRects = cards.map((card) => ({ card, rect: card?.getBoundingClientRect?.() }));
  const anchor = cardRects.find(({ rect }) => Number(rect?.top) <= focusLine && Number(rect?.bottom) > focusLine)?.card
    || cardRects.find(({ rect }) => Number(rect?.top) >= 0)?.card
    || cardRects.find(({ rect }) => Number(rect?.bottom) > 0)?.card;
  if (!anchor) return { scrollTop, anchorId: '', anchorOffset: 0 };
  return {
    scrollTop,
    anchorId: anchor.id || '',
    anchorOffset: Number(anchor.getBoundingClientRect().top) || 0,
  };
}

export function restoreWorkspaceScrollSnapshot(snapshot, { windowObject, documentObject, exactScrollTop = false } = {}) {
  if (!snapshot || !windowObject?.scrollTo) return false;
  let scrollTop = Math.max(0, Number(snapshot.scrollTop) || 0);
  const anchor = !exactScrollTop && snapshot.anchorId ? documentObject?.getElementById?.(snapshot.anchorId) : null;
  if (anchor?.getBoundingClientRect) {
    const currentTop = Number(anchor.getBoundingClientRect().top) || 0;
    const currentScrollTop = Math.max(0, Number(windowObject.scrollY ?? documentObject?.documentElement?.scrollTop) || 0);
    scrollTop = Math.max(0, currentScrollTop + currentTop - (Number(snapshot.anchorOffset) || 0));
  }
  windowObject.scrollTo({ top: scrollTop, left: 0, behavior: 'auto' });
  return true;
}

export function workspaceScrollSnapshotError(snapshot, { documentObject } = {}) {
  if (!snapshot?.anchorId) return 0;
  const anchor = documentObject?.getElementById?.(snapshot.anchorId);
  if (!anchor?.getBoundingClientRect) return Infinity;
  return (Number(anchor.getBoundingClientRect().top) || 0) - (Number(snapshot.anchorOffset) || 0);
}

export function createWorkspaceActionsRuntime({ api, message, refs = {}, helpers = {}, state = {} } = {}) {
  const hydrateImageState = (project) => hydrateProjectImageState(project, {
    isCharacterImageMode: helpers.isCharacterImageMode,
    ensureCharacterParts: helpers.ensureCharacterParts,
    normalizeCharacterAlias: helpers.normalizeCharacterAlias,
  });

  const refreshElementsAfterExtract = (id) => refreshElementsAfterExtractFlow(id, createRefreshElementsRuntimeContext({
    api,
    message,
    refs: {
      project: refs.project,
      view: refs.view,
      selectedElementIndex: refs.selectedElementIndex,
      inspectorVisible: refs.inspectorVisible,
      novelText: refs.novelText,
      scriptState: refs.scriptState,
    },
    helpers: {
      hydrateImageState,
      syncProjectStyle: helpers.syncProjectStyle,
      syncCharacterImageMode: helpers.syncCharacterImageMode,
    },
  }));

  const openProject = (id) => openWorkspaceProjectFlow(id, createOpenWorkspaceProjectRuntimeContext({
    api,
    message,
    refs: {
      project: refs.project,
      view: refs.view,
      selectedElementIndex: refs.selectedElementIndex,
      inspectorVisible: refs.inspectorVisible,
      novelText: refs.novelText,
      category: refs.category,
      extractErrors: refs.extractErrors,
      scriptUi: refs.scriptUi,
    },
    helpers: {
      hydrateImageState,
      syncProjectStyle: helpers.syncProjectStyle,
      syncCharacterImageMode: helpers.syncCharacterImageMode,
      rememberExtractCounts: helpers.rememberExtractCounts,
      hydrateScript: helpers.hydrateScript,
      hydrateShotVideos: helpers.hydrateShotVideos,
      loadVideoBar: helpers.loadVideoBar,
      hydratePending: helpers.hydratePending,
    },
    state,
  }));

  const backToProjects = () => backToProjectsFlow(createBackToProjectsRuntimeContext({
    api,
    message,
    refs: {
      project: refs.project,
      view: refs.view,
      selectedElementIndex: refs.selectedElementIndex,
      inspectorVisible: refs.inspectorVisible,
      novelText: refs.novelText,
    },
    helpers: {
      hydrateImageState,
      syncProjectStyle: helpers.syncProjectStyle,
      syncCharacterImageMode: helpers.syncCharacterImageMode,
      loadProjects: helpers.loadProjects,
    },
  }));

  return {
    hydrateImageState,
    refreshElementsAfterExtract,
    openProject,
    backToProjects,
  };
}
