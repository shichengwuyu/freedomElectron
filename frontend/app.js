// Vue 3 + Element Plus 应用（全局构建，无需打包）
import { api } from './api.js';
import { template } from './template.js';
import { createProgressTools } from './progress.js';
import { createTaskCenter } from './taskCenter.js';
import { useProject } from './composables/useProject.js';
import {
  batchCategoryOptions,
  characterImageModeOptions,
  dreaminaModelOptions,
  neowowModelOptions,
  updreamModelOptions,
  elementPromptFields,
  elementFilterOptions,
  extractionCategoryOptions,
  imageBaseUrlOptions,
  imageModelOptions,
  grsaiImageModelOptions,
  imageRatioOptions,
  styleOptions,
  stylePromptFields,
  textBaseUrlOptions,
  textModelOptions,
  videoApiModelOptions,
  videoProviderOptions,
  xiaoyunqueModelOptions,
  comfyUiWorkflowOptions,
} from './constants/options.js';
import { readPlainTxtFiles } from './utils/textFiles.js';
import {
  createAppExtractImportRuntime,
} from './utils/extractFlow.js';
import {
  normalizeVideoProvider,
} from './utils/videoConfig.js';
import {
  readFileAsB64,
  readFileAsDataUrl,
  readFileAsText,
  readImageAsPngB64,
} from './utils/fileReaders.js';
import { createAppElementRuntime } from './utils/elementRuntime.js';
import { registerIconComponents } from './utils/iconRuntime.js';
import {
  createAppBaseStateRuntime,
  createAppLifecycleRuntime,
  captureWorkspaceScrollSnapshot,
  openProjectAreaFlow,
  restoreWorkspaceScrollSnapshot,
  workspaceScrollSnapshotError,
  createWorkspaceActionsRuntime,
} from './utils/projectWorkspace.js';
import { createAppScriptRuntime } from './utils/scriptRuntime.js';
import { createAppExportRuntime } from './utils/exportRuntime.js';
import {
  createAppNovelRuntime,
} from './utils/novelRuntime.js';
import { createAppCoverRuntime } from './utils/coverRuntime.js';
import { createAppVideoSplitRuntime } from './utils/videoSplitRuntime.js';
import {
  createAppAgentRuntime,
} from './utils/agentRuntime.js';
import { createVideoRuntimeForApp } from './app/videoRuntimeSetup.js';
import { createBatchAllEpisodesRuntime } from './utils/video/batchAllRuntime.js';
import { createAutoPipelineRuntime } from './utils/autoPipeline.js';
import { createSceneGapRuntime } from './utils/sceneGap.js';
import { createSettingsRuntimeForApp } from './app/settingsRuntimeSetup.js';
import { createCommandPaletteRuntime } from './utils/commandPalette.js';
import { createLazyVideoDirective } from './utils/lazyVideoDirective.js';
import { createProgressiveRenderDirective, createViewportRenderDirective } from './utils/progressiveRenderDirective.js';
import { createModelRoutingRuntime } from './utils/modelRoutingRuntime.js';
import { createQualityRuntime } from './utils/qualityRuntime.js';
import { createTaskNotifyRuntime } from './utils/taskNotifyRuntime.js';
import { createChatRuntime } from './utils/chatRuntime.js';
import { createCanvasRuntime } from './utils/canvasRuntime.js';
import { createCharacterLibraryRuntime } from './utils/characterLibraryRuntime.js';
import { createSoftwareUpdateRuntime } from './utils/softwareUpdateRuntime.js';
import { createVideoHistoryRuntime } from './utils/videoHistory.js';
import { createShotElementImageRegenerator } from './utils/imageBatch.js';
import { applyStoryboardBindingUpdate } from './utils/shotUtils.js';
import { createThemeRuntime } from './utils/themeRuntime.js';
import {
  createBindingOverviewEntry,
  filterBindingOverviewEntries,
  summarizeBindingOverview,
} from './utils/bindingOverview.js';
import {
  LEGAL_AGREEMENT_VERSION,
  hasAcceptedLegalAgreement,
  isLegalAgreementAccepted,
  saveLegalAgreementAcceptance,
} from './templates/legalAgreement.js';

const { createApp, ref, reactive, computed, onMounted, watch, nextTick, h } = window.Vue;

const App = {
  setup() {
    const { ElMessage, ElMessageBox } = window.ElementPlus;
    const agreementStorage = (() => {
      try { return window.localStorage; } catch { return null; }
    })();
    const hostAgreement = (() => {
      try { return window.desktopPetHost?.getLegalAgreement?.() || null; } catch { return null; }
    })();
    const localAgreementAccepted = hasAcceptedLegalAgreement(agreementStorage);
    const hostAgreementAccepted = isLegalAgreementAccepted(hostAgreement);
    if (localAgreementAccepted && !hostAgreementAccepted) {
      try { window.desktopPetHost?.acceptLegalAgreement?.(LEGAL_AGREEMENT_VERSION); } catch { /* migrate best-effort */ }
    }
    const legalAgreement = reactive({
      required: !(hostAgreementAccepted || localAgreementAccepted),
      checked: false,
      version: LEGAL_AGREEMENT_VERSION,
    });
    const acceptLegalAgreement = () => {
      if (!legalAgreement.checked) return;
      const hostAccept = window.desktopPetHost?.acceptLegalAgreement;
      let hostSaved = !hostAccept;
      if (hostAccept) {
        try { hostSaved = isLegalAgreementAccepted(hostAccept(LEGAL_AGREEMENT_VERSION)); } catch { hostSaved = false; }
      }
      const localSaved = saveLegalAgreementAcceptance(agreementStorage, LEGAL_AGREEMENT_VERSION);
      if (!hostSaved || (!hostAccept && !localSaved)) {
        ElMessage.error('协议同意状态保存失败，请检查应用存储权限后重试。');
        return;
      }
      legalAgreement.required = false;
    };
    const declineLegalAgreement = () => {
      if (window.desktopPetHost?.quitApp) {
        window.desktopPetHost.quitApp();
        return;
      }
      window.close();
    };
    const messageHandlers = {
      warning: (message) => ElMessage.warning(message),
      info: (message) => ElMessage.info(message),
      success: (message) => ElMessage.success(message),
      error: (message) => ElMessage.error(message),
    };
    const softwareUpdateRuntime = createSoftwareUpdateRuntime({
      reactive,
      computed,
      onMounted,
      host: window.softwareUpdate,
      message: messageHandlers,
      messageBox: ElMessageBox,
      windowObject: window,
    });
    const {
      view,
      license,
      project,
      cat,
      projectStyle,
      selectedElementIndex,
      elementSearchQuery,
      extractCategory,
      lastExtractCounts,
      inspectorVisible,
      elementsDrawer,
      atelierPanel,
      settingsSection,
      settingsTextTab,
      settingsPromptKind,
      settingsSelectedPromptId,
      sbEpisodeId,
    } = createAppBaseStateRuntime({ reactive, ref });

    const toggleAtelierPanel = (name) => {
      atelierPanel.value = atelierPanel.value === name ? '' : name;
    };
    const {
      taskCenter,
      loadTaskCenter,
      startTaskAutoRefresh,
      stopTaskAutoRefresh,
      startBackgroundTaskMonitor,
      stopBackgroundTaskMonitor,
      setTaskFilter,
      filteredTasks,
      taskStatusType,
      taskStatusLabel,
      formatTaskTime,
      performTaskAction,
      clearFinishedTasks,
      taskActionLoading,
    } = createTaskCenter({ api, reactive, ElMessage });
    const {
      clampProgress,
      setProgressState,
      stopProgressPulse,
      startProgressPulse,
      progressByRatio,
      hideProgressAfter,
      startProgressTracking,
      updateProgressTracking,
      stopProgressTracking,
      formatEstimatedTime,
      createCancelableProgress,
    } = createProgressTools();

    // ---------- 设置 ----------
    const settingsRuntime = createSettingsRuntimeForApp({
      api,
      message: messageHandlers,
      refs: { project, projectStyle },
      helpers: {
        characterPartKeys: () => characterPartKeys,
        refreshXiaoyunqueCliStatus: () => refreshXiaoyunqueCliStatus(),
        refreshDreaminaCliStatus: () => refreshDreaminaCliStatus(),
        refreshDreaminaAgentStatus: () => refreshDreaminaAgentStatus(),
        refreshLibtvCliStatus: () => refreshLibtvCliStatus(),
        hydrateImageState: (...args) => hydrateImageState(...args),
        syncProjectStyle: (...args) => syncProjectStyle(...args),
        syncCharacterImageMode: (...args) => syncCharacterImageMode(...args),
        chooseStorageDirectory: (defaultPath) => window.desktopPetHost?.chooseDirectory?.(defaultPath),
        openExternalUrl: (targetUrl) => {
          if (window.desktopPetHost?.openExternalUrl) return window.desktopPetHost.openExternalUrl(targetUrl);
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
          return Promise.resolve({ ok: true, url: targetUrl });
        },
        openStorageDirectory: (directory) => window.desktopPetHost?.openStorageDirectory?.(directory),
        restartApp: () => window.desktopPetHost?.restartApp?.(),
      },
      options: {
        textBaseUrlOptions,
        textModelOptions,
        imageBaseUrlOptions,
        imageModelOptions,
        grsaiImageModelOptions,
        comfyUiWorkflowOptions,
        styleOptions,
        characterImageModeOptions,
      },
      vue: { reactive, ref, computed, nextTick, watch },
    });
    const {
      cfg,
      testing,
      testResult,
      saving,
      storyboardPromptTemplates,
      storyboardPromptTemplateId,
      imageRatio,
      customImageRatio,
      characterImageMode,
      currentImageRatio,
      textBaseUrlChoice,
      textModelChoice,
      imageChannelBaseUrlChoice,
      imageModelChoice,
      styleChoice,
      characterImageModeLabels,
      syncSettingsChoices,
      onTextBaseUrlChoiceChange,
      onTextModelChoiceChange,
      onImageModelChoiceChange,
      onStyleChoiceChange,
      loadSettings: loadSettingsBase,
      autoDiscoverImageModels,
      loadStoryboardPromptTemplates,
      saveSettings,
      testConn,
      detectingJianyingDir,
      detectJianyingDir,
    } = settingsRuntime;
    const themeRuntime = createThemeRuntime({
      ref,
      computed,
      watch,
      globals: { window, document, storage: window.localStorage },
    });
    let themePersistenceReady = false;
    const loadSettings = async () => {
      await loadSettingsBase();
      themeRuntime.setThemePreference(cfg.appearance?.theme || 'dark');
      themeRuntime.setUiScale(cfg.appearance?.uiScale || 1);
      themePersistenceReady = true;
      // 后台静默补齐图片模型候选，不阻塞设置页渲染、失败也不打扰用户。
      void autoDiscoverImageModels();
    };
    watch(themeRuntime.themePreference, (theme) => {
      if (!cfg.appearance) cfg.appearance = { theme, uiScale: themeRuntime.uiScale.value };
      else cfg.appearance.theme = theme;
      if (!themePersistenceReady) return;
      api.post('/api/config', { appearance: { theme, uiScale: themeRuntime.uiScale.value } }).catch((error) => {
        console.error('Failed to persist appearance theme:', error);
        messageHandlers.error(`主题保存失败：${error.message}`);
      });
    });
    watch(themeRuntime.uiScale, (uiScale) => {
      if (!cfg.appearance) cfg.appearance = { theme: themeRuntime.themePreference.value, uiScale };
      else cfg.appearance.uiScale = uiScale;
      if (!themePersistenceReady) return;
      api.post('/api/config', { appearance: { theme: themeRuntime.themePreference.value, uiScale } }).catch((error) => {
        console.error('Failed to persist interface scale:', error);
        messageHandlers.error(`界面缩放保存失败：${error.message}`);
      });
    });
    const modelRoutingRuntime = createModelRoutingRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      refs: { config: cfg, project },
      reactive,
      ref,
      computed,
      watch,
    });
    const fetchTextModelsAndSync = async () => {
      await settingsRuntime.fetchTextModels();
      modelRoutingRuntime.syncPrimaryModelProfileFromText();
    };

    const diagnostics = reactive({ loading: false, exporting: false, status: null });
    async function loadDiagnostics() {
      diagnostics.loading = true;
      try {
        diagnostics.status = await api.get('/api/diagnostics/status');
      } catch (error) {
        ElMessage.error(`诊断信息加载失败：${error.message}`);
      } finally {
        diagnostics.loading = false;
      }
    }
    function exportDiagnostics() {
      if (diagnostics.exporting) return;
      diagnostics.exporting = true;
      const link = document.createElement('a');
      link.href = `/api/diagnostics/export?t=${Date.now()}`;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => { diagnostics.exporting = false; }, 1200);
    }
    // 低配流畅模式：显式设置优先；没设置过时按机器配置自动判断（弱 CPU / 小内存默认开启）。
    // 开启后关掉毛玻璃、卡片投影、过渡动画等重特效——无独显机器上这些全靠 CPU 软渲染。
    const liteModeAutoDetect = () => {
      const cores = Number(navigator.hardwareConcurrency) || 0;
      const memory = Number(navigator.deviceMemory) || 0;
      return (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4);
    };
    const liteModeEnabled = computed({
      get: () => (typeof cfg.performance?.liteMode === 'boolean' ? cfg.performance.liteMode : liteModeAutoDetect()),
      set: (value) => {
        if (!cfg.performance) cfg.performance = {};
        cfg.performance.liteMode = value === true;
      },
    });
    watch(
      () => [cfg.performance?.reduceMotion, liteModeEnabled.value],
      ([reduceMotion, liteMode]) => {
        document.documentElement.classList.toggle('reduce-motion', reduceMotion === true || liteMode === true);
        document.documentElement.classList.toggle('lite-mode', liteMode === true);
      },
      { immediate: true },
    );
    watch([settingsSection, settingsTextTab], ([section, textTab]) => {
      if (section === 'text' && textTab === 'text') syncSettingsChoices();
      if (section === 'text' && textTab === 'routing') modelRoutingRuntime.syncModelRoutes();
      if (section === 'system' && !diagnostics.status) loadDiagnostics();
      if (section === 'cost') modelRoutingRuntime.loadCostCenter();
    });

    // ---------- 项目 ----------
    const {
      projects,
      deletedProjects,
      overviewProjects,
      projectOverviewStats,
      activeProjectOverviewStats,
      filteredProjects,
      renderedProjects,
      hasMoreRenderedProjects,
      loadingProjects,
      loadingTrash,
      creating,
      backupImporting,
      projectPackageImporting,
      projectSelectionMode,
      selectedProjectIds,
      selectedProjectCount,
      allFilteredProjectsSelected,
      newProjectName,
      projectSearch,
      projectSort,
      projectSection,
      snapshots,
      loadProjects,
      loadMoreProjects,
      loadDeletedProjects,
      selectProjectSection,
      createProject: _createProject,
      delProject,
      renameProject,
      duplicateProject,
      toggleProjectArchive,
      restoreDeletedProject,
      purgeDeletedProject,
      emptyProjectTrash,
      showProjectSnapshots,
      restoreProjectSnapshot,
      exportBackup,
      importBackup,
      isProjectSelected,
      setProjectSelected,
      toggleProjectSelection,
      toggleProjectSelectionMode,
      selectAllFilteredProjects,
      exportProjectPackage,
      exportSelectedProjects,
      importProjectPackages,
      rememberProjectOpened,
      recentAt,
      openProjectFromKeyboard,
      formatProjectTime,
      formatProjectSize,
    } = useProject(api, reactive, ref, computed, ElMessage, ElMessageBox, nextTick, watch);

    async function createProject() {
      const projectId = await _createProject();
      if (projectId) await openProject(projectId);
    }


    // ---------- 导入与提取（在当前项目内） ----------
    const extractImportRuntime = createAppExtractImportRuntime({
      api,
      message: messageHandlers,
      refs: { project, category: cat, extractCategory },
      readers: {
        readPlainTxtFiles,
        readImageAsPngB64,
      },
      helpers: {
        stopProgressPulse,
        setProgressState,
        startProgressPulse,
        progressByRatio,
        hideProgressAfter,
        rememberExtractCounts: () => rememberExtractCounts(),
        nextTick,
        loadProjects,
        refreshElements: (...args) => refreshElementsAfterExtract(...args),
        focusFirstFilledCategory: () => focusFirstFilledCategory(),
        extractedCountsSummary: () => extractedCountsSummary(),
        hydrateImageState: (...args) => hydrateImageState(...args),
        syncCharacterImageMode: (...args) => syncCharacterImageMode(...args),
      },
      reactive,
      ref,
    });
    const {
      sourceExtractText,
      novelText,
      extracting,
      extractProgress,
      extractProgressState,
      extractErrors,
      elementImporting,
      elementImportProgress,
      elementImageImporting,
      elementImageImportProgress,
      sourceExtractDragOver,
      dragOver,
      startExtractProgress,
      readSourceTxtFiles,
      startExtract,
      pollExtract,
      failExtractProgress,
      onSourceExtractDrop,
      onPickSourceExtractFile,
      onDrop,
      onPickFile,
      importElementsFromText,
      importElementImagesFromFolder,
    } = extractImportRuntime;

    const elementRuntime = createAppElementRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      refs: {
        project,
        config: cfg,
        category: cat,
        searchQuery: elementSearchQuery,
        selectedElementIndex,
        inspectorVisible,
        lastExtractCounts,
        elementsDrawer,
        imageRatio: currentImageRatio,
        characterImageMode,
        projectStyle,
      },
      readers: { readFileAsB64, readImageAsPngB64 },
      helpers: {
        nextTick,
        progressByRatio,
        startProgressTracking,
        updateProgressTracking,
        stopProgressTracking,
        formatElapsed: formatEstimatedTime,
        hydrateImageState: (project) => hydrateImageState(project),
      },
      options: { styleOptions, characterImageModeOptions, characterImageModeLabels },
      reactive,
      ref,
      computed,
    });
    const {
      characterPartFields,
      characterPartKeys,
      catLabel,
      promptDialog,
      lightboxSrc,
      elementFilter,
      ensureCharacterParts,
      markPartEdited,
      resetPartEdited,
      closePromptDialog,
      openElementPromptDialog,
      openVariantPromptDialog,
      openOutfitPromptDialog,
      counts,
      curList,
      filteredCurList,
      filteredCount,
      hasActiveFilter,
      selectedElement,
      resetElementFilter,
      openInspector,
      closeInspector,
      selectCategory,
      focusFirstFilledCategory,
      extractedCountsSummary,
      rememberExtractCounts,
      categoryJustUpdated,
      openElementsDrawer,
    } = elementRuntime;
    let workspaceActions = null;
    const requireWorkspaceActions = () => {
      if (!workspaceActions) throw new Error('Workspace actions are not initialized');
      return workspaceActions;
    };
    const hydrateImageState = (p) => requireWorkspaceActions().hydrateImageState(p);
    const refreshElementsAfterExtract = (id) => requireWorkspaceActions().refreshElementsAfterExtract(id);
    const workspaceScrollByProject = new Map();
    let pendingWorkspaceScrollRestore = '';
    let workspaceScrollCapturedForNavigation = '';
    let workspaceRestoreInFlight = '';
    const workspaceScrollKey = () => String(project.value?.id || '');
    const WORKSPACE_SESSION_KEY = 'gg-studio-workspace-session';
    const readWorkspaceSession = () => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(WORKSPACE_SESSION_KEY) || 'null');
        return saved && saved.projectId ? saved : null;
      } catch { return null; }
    };
    const writeWorkspaceSession = (projectId, snapshot) => {
      if (!projectId) return;
      try {
        window.localStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify({
          projectId: String(projectId),
          stage: scriptUI.stage,
          selectedId: scriptUI.selectedId,
          storyboardEpisodeId: sbEpisodeId.value,
          snapshot: snapshot || null,
        }));
      } catch { /* ignore */ }
    };
    const clearWorkspaceSession = () => {
      try { window.localStorage.removeItem(WORKSPACE_SESSION_KEY); } catch { /* ignore */ }
    };
    const captureWorkspacePosition = (projectId) => {
      const snapshot = captureWorkspaceScrollSnapshot({ windowObject: window, documentObject: document });
      workspaceScrollByProject.set(projectId, snapshot);
      writeWorkspaceSession(projectId, snapshot);
      return snapshot;
    };
    const rememberWorkspacePosition = () => {
      const projectId = workspaceScrollKey();
      if (view.value !== 'workspace' || !projectId) return;
      captureWorkspacePosition(projectId);
      workspaceScrollCapturedForNavigation = projectId;
    };
    const leaveWorkspace = (nextView) => {
      rememberWorkspacePosition();
      view.value = nextView;
    };
    const openProject = async (id) => {
      pendingWorkspaceScrollRestore = '';
      workspaceScrollCapturedForNavigation = '';
      workspaceScrollByProject.delete(String(id || ''));
      rememberProjectOpened(id);
      const result = await requireWorkspaceActions().openProject(id);
      if (project.value) writeWorkspaceSession(workspaceScrollKey(), null);
      return result;
    };
    // 内存里已没有打开的项目时（例如重开应用），用上次的工作台现场把位置整体复原
    const resumeWorkspaceSession = async (saved) => {
      const projectId = String(saved.projectId);
      rememberProjectOpened(projectId);
      await requireWorkspaceActions().openProject(projectId);
      if (workspaceScrollKey() !== projectId) return false;
      if (saved.stage) scriptUI.stage = saved.stage === 'final' ? 'storyboard' : saved.stage;
      if (saved.selectedId) scriptUI.selectedId = saved.selectedId;
      if (saved.storyboardEpisodeId) sbEpisodeId.value = saved.storyboardEpisodeId;
      if (!saved.snapshot) return true;
      workspaceScrollByProject.set(projectId, saved.snapshot);
      await nextTick();
      restoreWorkspacePosition(projectId);
      return true;
    };
    const openProjectArea = () => {
      const projectId = workspaceScrollKey();
      pendingWorkspaceScrollRestore = projectId && view.value !== 'workspace' ? projectId : '';
      const nextView = openProjectAreaFlow({
        hasProject: () => Boolean(project.value),
        setView: (next) => { view.value = next; },
      });
      if (nextView === 'workspace') return;
      const saved = readWorkspaceSession();
      if (saved) void resumeWorkspaceSession(saved);
    };
    const backToProjects = () => {
      pendingWorkspaceScrollRestore = '';
      workspaceScrollCapturedForNavigation = '';
      workspaceScrollByProject.delete(workspaceScrollKey());
      clearWorkspaceSession();
      return requireWorkspaceActions().backToProjects();
    };
    function restoreWorkspacePosition(projectId) {
      const snapshot = workspaceScrollByProject.get(projectId);
      if (!snapshot) return;
      // 锚点卡片才是"同一个位置"的真相；快照里的绝对 scrollTop 只在没有锚点时兜底，
      // 因为上方分镜的视频/图片重新加载后整体高度会变，绝对坐标会指到别的镜头。
      const hasAnchor = Boolean(snapshot.anchorId);
      document.documentElement.classList.add('is-restoring-workspace-scroll');
      workspaceRestoreInFlight = projectId;
      nextTick(() => {
        document.querySelector('.studio-shell.is-workspace .content-stage > *')
          ?.classList.add('is-restored-workspace-position');
        const align = () => {
          if (view.value !== 'workspace' || workspaceScrollKey() !== projectId) return false;
          restoreWorkspaceScrollSnapshot(snapshot, {
            windowObject: window,
            documentObject: document,
            exactScrollTop: !hasAnchor,
          });
          return true;
        };
        if (!align() || !hasAnchor) {
          document.documentElement.classList.remove('is-restoring-workspace-scroll');
          window.setTimeout(() => {
            if (workspaceRestoreInFlight === projectId) workspaceRestoreInFlight = '';
          }, 200);
          return;
        }
        // 上方分镜的视频/图片是懒加载的，会在恢复之后才改变高度，把锚点顶走。
        // 所以持续跟随布局变化重新对齐，直到画面安静下来为止。
        const stage = document.querySelector('.workspace-stage-shell') || document.body;
        const hardDeadline = Date.now() + 8000;
        let quietTimer = 0;
        let observer = null;
        const stopRestore = () => {
          window.clearTimeout(quietTimer);
          observer?.disconnect();
          document.documentElement.classList.remove('is-restoring-workspace-scroll');
          window.setTimeout(() => {
            if (workspaceRestoreInFlight === projectId) workspaceRestoreInFlight = '';
          }, 200);
        };
        const scheduleQuietStop = () => {
          window.clearTimeout(quietTimer);
          quietTimer = window.setTimeout(stopRestore, 700);
        };
        const onLayoutChange = () => {
          if (Date.now() >= hardDeadline) { stopRestore(); return; }
          if (!align()) { stopRestore(); return; }
          const error = workspaceScrollSnapshotError(snapshot, { documentObject: document });
          if (Math.abs(error) > 2) window.requestAnimationFrame(() => { align(); });
          scheduleQuietStop();
        };
        observer = new ResizeObserver(onLayoutChange);
        observer.observe(stage);
        scheduleQuietStop();
      });
    }
    // 停在工作台里时也持续记录现场，让重开应用后仍能回到同一位置
    let workspacePersistTimer = 0;
    const persistWorkspacePositionSoon = () => {
      const projectId = workspaceScrollKey();
      if (view.value !== 'workspace' || !projectId) return;
      if (workspaceRestoreInFlight === projectId) return;
      window.clearTimeout(workspacePersistTimer);
      workspacePersistTimer = window.setTimeout(() => captureWorkspacePosition(projectId), 400);
    };
    window.addEventListener('scroll', persistWorkspacePositionSoon, { passive: true });
    window.addEventListener('beforeunload', () => {
      const projectId = workspaceScrollKey();
      if (view.value === 'workspace' && projectId) captureWorkspacePosition(projectId);
    });
    watch(view, (nextView, previousView) => {
      // 画布是「park 不卸载」的：离开画布时必须停掉时间轴的 requestAnimationFrame，
      // 否则它会在后台一直重绘；同时停掉画布上的任务轮询写回。
      if (previousView === 'canvas' && nextView !== 'canvas') canvasRuntime.canvasStopTimelinePlayback?.();
      const projectId = workspaceScrollKey();
      if (previousView === 'workspace' && nextView !== 'workspace' && projectId) {
        if (workspaceScrollCapturedForNavigation !== projectId) captureWorkspacePosition(projectId);
        workspaceScrollCapturedForNavigation = '';
      }

      // 全屏视图（以及普通顶层页面）都从页面顶部开始布局。工作台的滚动位置
      // 已在上面保存，返回工作台时由 restoreWorkspacePosition 按锚点恢复。
      // 如果继续沿用工作台的 window.scrollY，100vh 视图会整体偏离视口，
      // 表现为切换时侧栏和主内容上下乱跳。
      if (nextView !== 'loading') {
        const scrollTop = Math.max(0, Number(window.scrollY) || 0);
        if (scrollTop > 0) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
      if (nextView !== 'workspace' || previousView === 'workspace' || !projectId) return;
      if (pendingWorkspaceScrollRestore !== projectId) return;
      pendingWorkspaceScrollRestore = '';
      restoreWorkspacePosition(projectId);
    }, { flush: 'sync' });

    const {
      imageName,
      imageVersion,
      elementKey,
      imageKey,
      variantImageKey,
      outfitImageKey,
      sceneAreaImageKey,
      markImageLoaded,
      markImageFailed,
      imageStatusBody,
      characterReferenceImgUrl,
      characterVoiceAudioUrl,
      globalReferenceImgUrl,
      imgUrl,
      variantImgUrl,
      variantClothingReferenceImgUrl,
      variantLogoReferenceImgUrl,
      outfitImgUrl,
      sceneAreaImgUrl,
      uploadImageFile,
      imageDropHandler,
      imagePickHandler,
      audioDropHandler,
      audioPickHandler,
      recheckImageSlot,
      syncImageSlot,
      prepareBatchGenerationState,
      clearBatchGenerationState,
      elementSaveBody,
      saveElement,
      genImage,
      saveVariant,
      genVariant,
      saveOutfit,
      genOutfit,
      genSceneArea,
      savePromptDialog,
      onElementImageDrop,
      onPickElementImage,
      onVariantImageDrop,
      onPickVariantImage,
      onOutfitImageDrop,
      onPickOutfitImage,
      onCharacterReferenceDrop,
      onPickCharacterReference,
      deleteCharacterReference,
      onGlobalReferenceDrop,
      onPickGlobalReference,
      deleteGlobalReferenceImage,
      onPickCharacterVoice,
      onCharacterVoiceDrop,
      deleteCharacterVoiceAudio,
      batchCategory,
      batch,
      batchProgressPercentage,
      batchProgressIndeterminate,
      selectedElements,
      selectionMode,
      currentBatchCategory,
      applyBatchResults,
      runBatch,
      isElementSelected,
      toggleElementSelection,
      selectAllInCategory,
      deselectAll,
      toggleSelectionMode,
      selectedCount,
      selectedInCurrentCategory,
      runBatchForSelected,
      normalizeCharacterAlias,
      syncProjectStyle,
      syncCharacterImageMode,
      onProjectStyleChange,
      onCharacterImageModeChange,
      addElement,
      deleteElement,
      clearElements,
    } = elementRuntime;

    const regenerateShotElementImage = createShotElementImageRegenerator({
      project: () => project.value,
      generators: { main: genImage, variant: genVariant, outfit: genOutfit, sceneArea: genSceneArea },
      message: messageHandlers,
    });

    const scriptRuntime = createAppScriptRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      refs: {
        project,
        config: cfg,
        promptKind: settingsPromptKind,
        selectedPromptId: settingsSelectedPromptId,
        episodeId: sbEpisodeId,
        storyboardPromptTemplateId,
        extracting,
        extractErrors,
        extractProgress,
        category: cat,
        extractCategory,
        elementsDrawer,
      },
      readers: { readFileAsText, readPlainTxtFiles },
      helpers: {
        saveSettings,
        nextTick,
        clampProgress,
        rememberExtractCounts,
        startExtractProgress,
        pollExtract,
        failExtractProgress,
        hydratePending: () => hydratePending(),
        cancelVideoQueueStartTimer: () => cancelVideoQueueStartTimer(),
        regenerateShotElementImage,
      },
      globals: { window, navigator, document },
      reactive,
      ref,
      computed,
      watch,
    });
    const {
      scriptState,
      scriptUI,
      scriptDragOver,
      onPromptModeChange,
      addCustomPrompt,
      deleteCustomPrompt,
      importCustomPromptFiles,
      selectSettingsPrompt,
      onSettingsPromptKindChange,
      onSettingsPromptEdit,
      saveSettingsDebounced,
      selectedScriptCustomPrompt,
      selectedStoryboardCustomPrompt,
      activeScriptCustomPrompt,
      activeStoryboardCustomPrompt,
      isCustomScriptPromptMode,
      isCustomStoryboardPromptMode,
      settingsPromptList,
      settingsSelectedPrompt,
      onScriptSettingChange,
      saveScriptNow,
      saveScriptDebounced,
      requireActiveCustomPrompt,
      hydrateScript,
      chaptersSorted,
      episodesOfChapter,
      findEpisode,
      findChapter,
      findStoryboard,
      importWholeNovelTxt,
      onPickWholeNovelFile,
      applyTxtToDraft,
      onSourceDrop,
      onPickSourceFile,
      startAddChapter,
      cancelAddChapter,
      startImportEpisode,
      cancelImportEpisode,
      confirmImportEpisode,
      createEpisodeDirect,
      startImportStoryboard,
      cancelImportStoryboard,
      confirmImportStoryboard,
      applyTxtToStoryboardImport,
      onStoryboardImportDrop,
      onPickStoryboardImportFile,
      onStoryboardImportInput,
      confirmAddChapter,
      updateChapter,
      deleteChapter,
      deleteEpisode,
      splitChapter,
      recutEpisode,
      shotHeaderPrefix,
      addingElement,
      shotEdit,
      shotVideos,
      shotStatus,
      shotProgress,
      videoQueue,
      videoQueueDialog,
      addTagPanel,
      aiBinding,
      aiBindRangeDialog,
      selectedSbEpisode,
      selectedSbStoryboard,
      generateEpisode,
      generateStoryboard,
      generateWholeChapter,
      generateAllEpisodes,
      exportScript,
      selectedEpisode,
      selectedChapter,
      selectedStoryboard,
      selectedSlice,
      sourceLen,
      pendingExtractChapters,
      startExtractFromSource,
      chapterSig,
      defaultShotBody,
      formatTailFrameTime,
    } = scriptRuntime;
    watch(() => [scriptUI.stage, scriptUI.selectedId, sbEpisodeId.value], persistWorkspacePositionSoon);

    const {
      parseShots,
      currentShots,
      shiftShotVideoMeta,
      shiftRuntimeShotVideo,
      remapVideoQueueShotNos,
      removeQueuedShotNo,
      hasActiveShotAtOrAfter,
      shotEditListContext,
      insertShotAfter,
      deleteShot,
      shotElementTags,
      shotAudioTags,
      filteredShotAudioOptions,
      isShotAudioBound,
      addShotAudioTag,
      removeShotAudioTag,
      toggleShotAudio,
      openShotAudioPicker,
      shotManualTags,
      shotExcludedTags,
      isShotLocked,
      isExcluded,
      isManualTagged,
      openAddTag,
      filteredAddTagElements,
      toggleManualTag,
      removeManualTag,
      projectElementTotal,
      aiBindingTargets,
      runAiElementBinding,
      openAiBindRangeDialog,
      confirmAiBindRange,
      shotEditKey,
      isShotEditing,
      startShotEdit,
      cancelShotEdit,
      saveShotEdit,
      focusElement,
      editElementBindingName,
      buildShotPromptBody,
    } = scriptRuntime;

    const currentOverviewAnchorShotNo = () => String(
      scriptRuntime.shotNearestViewportCenter?.()?.no
      ?? currentShots.value[0]?.no
      ?? '',
    );
    const scrollOverviewGridToShot = ({ dialogSelector, gridSelector, shotAttribute, shotNo }) => {
      const key = String(shotNo ?? '');
      if (!key) return false;
      const roots = [...document.querySelectorAll(dialogSelector)];
      const dialog = roots.find((root) => root.getBoundingClientRect?.().height > 0) || roots.at(-1);
      const grid = dialog?.querySelector?.(gridSelector);
      const target = [...(grid?.querySelectorAll?.(`[${shotAttribute}]`) || [])]
        .find((item) => String(item.getAttribute(shotAttribute)) === key);
      if (!grid || !target) return false;
      const gridRect = grid.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const top = Math.max(0, grid.scrollTop + targetRect.top - gridRect.top - 2);
      if (typeof grid.scrollTo === 'function') grid.scrollTo({ top, behavior: 'auto' });
      else grid.scrollTop = top;
      return true;
    };

    const bindingOverviewDialog = reactive({
      visible: false,
      filter: 'all',
      query: '',
      replaceTarget: null,
      anchorShotNo: '',
    });
    const bindingOverviewPickerKey = 'binding-overview-elements';
    const bindingOverviewAudioPickerKey = 'binding-overview-audio';
    const bindingOverviewEntries = computed(() => currentShots.value.map(
      (shot) => createBindingOverviewEntry(shot, shotElementTags(shot), shotAudioTags(shot)),
    ));
    const bindingOverviewSummary = computed(() => summarizeBindingOverview(bindingOverviewEntries.value));
    const bindingOverviewFilteredEntries = computed(() => filterBindingOverviewEntries(
      bindingOverviewEntries.value,
      bindingOverviewDialog,
    ));
    const openBindingOverview = () => {
      if (!currentShots.value.length) return messageHandlers.info('本集还没有可检查的分镜');
      bindingOverviewDialog.filter = 'all';
      bindingOverviewDialog.query = '';
      bindingOverviewDialog.replaceTarget = null;
      bindingOverviewDialog.anchorShotNo = currentOverviewAnchorShotNo();
      addTagPanel.activePicker = '';
      bindingOverviewDialog.visible = true;
    };
    const scrollBindingOverviewToAnchor = () => nextTick(() => scrollOverviewGridToShot({
      dialogSelector: '.storyboard-binding-overview-dialog',
      gridSelector: '.binding-overview-grid',
      shotAttribute: 'data-binding-overview-shot-no',
      shotNo: bindingOverviewDialog.anchorShotNo,
    }));
    const closeBindingOverview = () => {
      bindingOverviewDialog.visible = false;
      bindingOverviewDialog.replaceTarget = null;
      if ([bindingOverviewPickerKey, bindingOverviewAudioPickerKey].includes(addTagPanel.activePicker)) addTagPanel.activePicker = '';
    };
    const bindingOverviewStatusLabel = (entry) => {
      if (entry?.status === 'unbound') return '未绑定元素';
      if (entry?.status === 'missing') return `${entry.missingImageCount} 项未出图`;
      return '绑定素材齐全';
    };
    const bindingOverviewSourceLabel = (tag) => {
      if (tag?.source === 'ai') return 'AI';
      return tag?.manual ? '手动' : '自动';
    };
    const inspectBindingOverviewTag = (tag) => {
      if (tag?.hasImage) {
        lightboxSrc.value = tag.labeledUrl || tag.url;
        return;
      }
      closeBindingOverview();
      focusElement(tag);
    };
    const focusShotFromBindingOverview = async (entry) => {
      closeBindingOverview();
      scriptRuntime.setShotTimelineAttentionFilter?.('all');
      await nextTick();
      return scriptRuntime.focusShotFromTimeline?.(entry?.shot);
    };
    const isBindingOverviewPickerVisible = (entry) => (
      bindingOverviewDialog.visible
      && addTagPanel.activePicker === bindingOverviewPickerKey
      && String(addTagPanel.shotNo) === String(entry?.shot?.no)
    );
    const setBindingOverviewPickerVisible = (entry, visible) => {
      if (visible) {
        addTagPanel.shotNo = String(entry?.shot?.no ?? '');
        addTagPanel.activePicker = bindingOverviewPickerKey;
      } else if (addTagPanel.activePicker === bindingOverviewPickerKey) {
        addTagPanel.activePicker = '';
        bindingOverviewDialog.replaceTarget = null;
      }
    };
    const openBindingOverviewPicker = (entry, tag) => {
      if (!entry?.shot || isShotLocked(entry.shot)) {
        return messageHandlers.warning('该镜头已锁定人物与元素，请先解锁');
      }
      addTagPanel.shotNo = String(entry.shot.no);
      addTagPanel.searchQuery = '';
      addTagPanel.selectedCategory = 'all';
      if (tag !== undefined) {
        bindingOverviewDialog.replaceTarget = tag
          ? { shotNo: String(entry.shot.no), cat: tag.cat, name: tag.name }
          : null;
      }
      addTagPanel.activePicker = bindingOverviewPickerKey;
    };
    const isBindingOverviewTagBound = (entry, cat, name) => (
      entry?.tags?.some((tag) => tag.cat === cat && tag.name === name)
    );
    const isBindingOverviewTagManual = (entry, cat, name) => (
      isManualTagged(entry?.shot?.no, cat, name)
    );
    const addBindingOverviewTag = (entry, cat, name) => {
      if (!entry?.shot || isShotLocked(entry.shot)) {
        return messageHandlers.warning('该镜头已锁定人物与元素，请先解锁');
      }
      const replaceTarget = bindingOverviewDialog.replaceTarget;
      addTagPanel.shotNo = String(entry.shot.no);
      if (replaceTarget && replaceTarget.shotNo === String(entry.shot.no)) {
        if (replaceTarget.cat === cat && replaceTarget.name === name) {
          bindingOverviewDialog.replaceTarget = null;
          addTagPanel.activePicker = '';
          return messageHandlers.info('新素材与当前素材相同');
        }
        removeManualTag(entry.shot.no, replaceTarget.cat, replaceTarget.name);
        if (!isManualTagged(entry.shot.no, cat, name)) toggleManualTag(cat, name);
        bindingOverviewDialog.replaceTarget = null;
        addTagPanel.activePicker = '';
        return messageHandlers.success(`已将镜头 ${entry.shot.no} 的素材替换为${name}`);
      }
      if (!isManualTagged(entry.shot.no, cat, name)) {
        toggleManualTag(cat, name);
        return messageHandlers.success(`已添加${name}到镜头 ${entry.shot.no}`);
      }
      return messageHandlers.info(`${name}已经绑定在镜头 ${entry.shot.no}`);
    };
    const removeBindingOverviewTag = (entry, tag) => {
      if (!entry?.shot || !tag) return;
      if (isShotLocked(entry.shot)) return messageHandlers.warning('该镜头已锁定人物与元素，请先解锁');
      removeManualTag(entry.shot.no, tag.cat, tag.name);
      messageHandlers.success(`已从镜头 ${entry.shot.no} 移除${tag.displayName || tag.name}`);
    };
    const isBindingOverviewAudioPickerVisible = (entry) => (
      bindingOverviewDialog.visible
      && addTagPanel.activePicker === bindingOverviewAudioPickerKey
      && String(addTagPanel.shotNo) === String(entry?.shot?.no)
    );
    const setBindingOverviewAudioPickerVisible = (entry, visible) => {
      if (visible) {
        addTagPanel.shotNo = String(entry?.shot?.no ?? '');
        addTagPanel.activePicker = bindingOverviewAudioPickerKey;
      } else if (addTagPanel.activePicker === bindingOverviewAudioPickerKey) {
        addTagPanel.activePicker = '';
      }
    };
    const openBindingOverviewAudioPicker = (entry) => {
      if (!entry?.shot || isShotLocked(entry.shot)) {
        return messageHandlers.warning('该镜头已锁定，请先解锁');
      }
      addTagPanel.shotNo = String(entry.shot.no);
      addTagPanel.audioSearchQuery = '';
      addTagPanel.activePicker = bindingOverviewAudioPickerKey;
    };
    const toggleBindingOverviewAudio = (entry, name) => {
      if (!entry?.shot) return false;
      return toggleShotAudio(entry.shot.no, name);
    };

    const locatingTaskId = ref('');
    const canLocateTask = (task) => Boolean(String(task?.projectId || '').trim());
    const taskLocationLabel = (task) => {
      if (task?.shotNo !== '' && task?.shotNo != null) return '定位镜头';
      if (task?.episodeId !== '' && task?.episodeId != null) return '定位本集';
      return '打开项目';
    };
    const locateTask = async (task) => {
      if (!canLocateTask(task) || locatingTaskId.value) return false;
      const targetProjectId = String(task.projectId);
      const hasEpisode = task.episodeId !== '' && task.episodeId != null;
      const hasShot = task.shotNo !== '' && task.shotNo != null;
      locatingTaskId.value = String(task.id || targetProjectId);
      try {
        if (String(project.value?.id || '') !== targetProjectId) await openProject(targetProjectId);
        else view.value = 'workspace';
        if (String(project.value?.id || '') !== targetProjectId) throw new Error('项目不存在或已被删除');

        view.value = 'workspace';
        if (!hasEpisode) {
          await nextTick();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return true;
        }

        const episode = (scriptState.episodes || []).find(
          (item) => String(item?.id) === String(task.episodeId),
        );
        if (!episode) {
          messageHandlers.warning(`项目中找不到第 ${task.episodeId} 集，已打开项目首页`);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return false;
        }

        if (!hasShot) {
          const storyboardTask = task.type === 'video' || task.type === 'storyboard';
          if (storyboardTask) {
            scriptUI.stage = 'storyboard';
            sbEpisodeId.value = episode.id;
          } else {
            scriptUI.stage = 'script';
            scriptUI.selectedId = `ep:${episode.id}`;
          }
          await nextTick();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return true;
        }

        scriptUI.stage = 'storyboard';
        sbEpisodeId.value = episode.id;
        scriptRuntime.setShotTimelineAttentionFilter('all');
        await nextTick();
        const shot = currentShots.value.find((item) => String(item?.no) === String(task.shotNo));
        if (!shot) {
          messageHandlers.warning(`第 ${episode.id} 集中找不到镜头 ${task.shotNo}`);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return false;
        }

        scriptRuntime.jumpToShotNo(shot.no);
        await nextTick();
        const card = document.getElementById(scriptRuntime.shotTimelineCardDomId(shot));
        if (card) {
          card.classList.remove('is-task-located');
          void card.offsetWidth;
          card.classList.add('is-task-located');
          window.setTimeout(() => card.classList.remove('is-task-located'), 2600);
        }
        return true;
      } catch (error) {
        messageHandlers.error(`定位失败：${error?.message || error}`);
        return false;
      } finally {
        locatingTaskId.value = '';
      }
    };

    const qualityRuntime = createQualityRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      refs: {
        project,
        scriptState,
        scriptUi: scriptUI,
        storyboardEpisodeId: sbEpisodeId,
        category: cat,
        elementSearchQuery,
      },
      helpers: {
        nextTick,
        findStoryboard,
        parseShots,
        focusShot: scriptRuntime.focusShotFromTimeline,
        openElementsDrawer,
        setTimeout: window.setTimeout.bind(window),
      },
      reactive,
      computed,
      watch,
    });

    const exportRuntime = createAppExportRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      refs: {
        project,
        category: cat,
        episodeId: sbEpisodeId,
        selectedEpisode: selectedSbEpisode,
        selectedStoryboard: selectedSbStoryboard,
      },
      helpers: {
        nextTick,
        navigate: (url) => { window.location.href = url; },
      },
      ref,
    });

    const videoRuntime = createVideoRuntimeForApp({
      api,
      elementPlus: window.ElementPlus,
      message: messageHandlers,
      refs: {
        config: cfg,
        project,
        episodeId: sbEpisodeId,
        shotStatus,
        shotVideos,
        shotProgress,
        videoQueue,
        scriptUi: scriptUI,
        scriptState,
        currentShots,
      },
      helpers: {
        findEpisode,
        findStoryboard,
        cancelShotEdit,
        saveScript: saveScriptDebounced,
        nextTick,
        shotElementTags,
        shotAudioTags,
        buildShotPromptBody,
        parseShots,
        progressByRatio,
        stopProgressPulse,
        setProgressState,
        startProgressPulse,
        hideProgressAfter,
      },
      globals: {
        createObjectURL: (file) => URL.createObjectURL(file),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        document,
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      },
      vue: { reactive, computed, watch, ref },
    });
    const {
      shotVideoKey,
      shotVideoUrl,
      shotVideoStatus,
      onPickShotVideo,
      hydrateShotVideos,
      clearShotVideo,
      startPendingPoll,
      hydratePending,
      refetchShotVideo,
      cancelShotQueue,
      clearAllPending,
      tailFramePickerVideo,
      tailFramePicker,
      shotOpenerFrame,
      shotOpenerFrameName,
      clearShotOpenerFrame,
      editShotOpenerFrameName,
      openTailFramePicker,
      onTailFramePickerLoaded,
      onTailFramePickerTimeUpdate,
      seekTailFramePicker,
      saveTailFramePicker,
      prevShotNo,
      capturePrevTailFrame,
      settingsVideoResolutionOptions,
      videoBar,
      videoBarResolutionOptions,
      currentVideoProviderLabel,
      currentVideoAccountSummary,
      submitting,
      batchVideoRunning,
      batchVideoProgress,
      videoProgress,
      schedulerSlots,
      sequentialRunning,
      rangeSeqDialog,
      xiaoyunqueAccountLoading,
      xiaoyunqueManualVisible,
      xiaoyunqueManualText,
      xiaoyunqueCliStatus,
      dreaminaCliLoading,
      dreaminaCliStatus,
      dreaminaAgentLoading,
      dreaminaAgentStatus,
      libtvCliLoading,
      libtvCliStatus,
      libtvModelOptions,
      libtvModelsLoading,
      recentVideoBatch,
      resolveShotDuration,
      loadVideoBar,
      rememberVideoProvider,
      saveVideoBar,
      resetVideoBar,
      isTrueMentionVideoMode,
      ensureVideoSubmitModeSupported,
      videoSubmitPayload,
      removeFromQueue,
      addToVideoQueue,
      pauseVideoQueue,
      clearVideoQueue,
      cancelVideoQueueStartTimer,
      scheduleVideoQueueProcessing,
      submitOneAndWait,
      buildShotSubmit,
      generateShotVideo,
      processVideoQueue,
      generateAllShotVideos,
      generateAllShotVideosSequential,
      stopSequentialGeneration,
      openRangeSequentialDialog,
      confirmRangeSequential,
      refreshXiaoyunqueAccounts,
      refreshXiaoyunqueCliStatus,
      refreshDreaminaCliStatus,
      refreshDreaminaAgentStatus,
      refreshLibtvCliStatus,
      refreshLibtvModels,
      addXiaoyunqueAccounts,
      deleteXiaoyunqueAccount,
      installXiaoyunqueCli,
      installDreaminaCli,
      loginDreaminaCli,
      logoutDreaminaCli,
      loginDreaminaAgent,
      installLibtvCli,
      loginLibtvCli,
      logoutLibtvCli,
      checkLibtvCliUpdate,
    } = videoRuntime;

    // 一键全集串行：按章节顺序并行补分镜 + 可选逐集首尾帧串行视频
    // 并发安全：分镜生成中判断走 genStoryboardSet（支持多集同时生成）
    const isStoryboardGenerating = (episodeId) => (scriptUI.genStoryboardSet || []).some((id) => String(id) === String(episodeId));

    // 从上游（rolldek）对账找回本地缺失的视频
    const reconcileUpstreamVideos = async () => {
      const projectId = project?.value?.id;
      if (!projectId) return messageHandlers.warning('请先打开项目');
      messageHandlers.info('正在扫描上游任务并拉回缺失视频，可能需要几分钟…');
      try {
        const res = await api.post('/api/video/reconcile-upstream', { projectId });
        if (res?.ok) {
          messageHandlers.success(`对账完成：本地 ${res.localScanned} 镜，已找回 ${res.recovered} 个视频（本地已有 ${res.alreadyLocal}，上游无记录 ${res.noUpstream}，上游失败 ${res.upstreamFailed}${res.failures?.length ? `，下载失败 ${res.failures.length}` : ''}）`);
        } else {
          messageHandlers.error(res?.error || '对账失败');
        }
      } catch (error) {
        messageHandlers.error(`对账失败：${error?.message || error}`);
      }
    };
    // 分镜页集数 pill 的视频状态：none=无分镜 ready=有分镜无视频 partial=部分视频 full=全部有视频
    // 分镜格式兼容：① `【镜头1】`、`[镜头1]` ② `分镜1:` / `镜头1:`（冒号分隔）。优先去重镜头号数最大。
    const sbVideoStatusMap = computed(() => {
      const map = {};
      // 两种格式统一去重后取最大镜头号
      const shotRe = /(?:^|\n)\s*[\[【]\s*镜头\s*(\d+)\s*[\]】]|(?:^|\n)\s*(?:分镜|镜头)\s*(\d+)\s*[:：]/g;
      for (const ep of (sbSortedEpisodes.value || [])) {
        const sb = findStoryboard?.(ep.id);
        if (!sb) {
          map[ep.id] = { total: 0, done: 0, state: 'none' };
          continue;
        }
        const content = String(sb.content || '');
        let maxShotNo = 0;
        let m;
        shotRe.lastIndex = 0;
        while ((m = shotRe.exec(content)) !== null) {
          const no = Number(m[1] || m[2]);
          if (no > maxShotNo) maxShotNo = no;
        }
        const shotVideos = sb.shotVideos && typeof sb.shotVideos === 'object' ? sb.shotVideos : {};
        const doneNos = Object.keys(shotVideos).map((k) => Number(k)).filter((n) => Number.isFinite(n) && n > 0);
        const done = doneNos.length;
        const total = Math.max(maxShotNo, doneNos.length ? Math.max(...doneNos) : 0);
        const state = total > 0 && done >= total ? 'full' : (done > 0 ? 'partial' : 'ready');
        map[ep.id] = { total, done, state };
      }
      return map;
    });
    // 时长统计：知道「总共做了多少分钟」。后端按集聚合（已出片按 shotVideos 去重），
    // 前端只在本地按所选集数范围求和，不额外请求。
    const videoDurationStats = ref(null);
    const durationStatsLoading = ref(false);
    const durationStatRange = reactive({ from: '', to: '' });
    const loadVideoDurationStats = async () => {
      const projectId = project?.value?.id;
      if (!projectId) { videoDurationStats.value = null; return; }
      durationStatsLoading.value = true;
      try {
        const res = await api.get(`/api/video/duration-stats?projectId=${encodeURIComponent(projectId)}`);
        videoDurationStats.value = res?.ok ? res : null;
      } catch {
        videoDurationStats.value = null;
      } finally {
        durationStatsLoading.value = false;
      }
    };
    const formatDurationMinutes = (seconds) => {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const minutes = Math.floor(total / 60);
      const rest = total % 60;
      return minutes ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
    };
    const emptyDurationSum = () => ({ episodes: 0, shots: 0, producedShots: 0, producedSeconds: 0, plannedSeconds: 0 });
    const sumDurationEntries = (entries = []) => entries.reduce((acc, entry) => ({
      episodes: acc.episodes + 1,
      shots: acc.shots + (Number(entry?.shots) || 0),
      producedShots: acc.producedShots + (Number(entry?.producedShots) || 0),
      producedSeconds: acc.producedSeconds + (Number(entry?.producedSeconds) || 0),
      plannedSeconds: acc.plannedSeconds + (Number(entry?.plannedSeconds) || 0),
    }), emptyDurationSum());
    const videoDurationSummary = computed(() => videoDurationStats.value?.totals || null);
    const durationStatsRange = computed(() => {
      const data = videoDurationStats.value?.episodes;
      if (!data) return null;
      const rawFrom = durationStatRange.from;
      const rawTo = durationStatRange.to;
      if (rawFrom === '' && rawTo === '') return null;
      const from = rawFrom === '' ? -Infinity : Number(rawFrom);
      const to = rawTo === '' ? Infinity : Number(rawTo);
      const picked = Object.entries(data)
        .filter(([episodeId]) => {
          const n = Number(episodeId);
          return Number.isFinite(n) && n >= from && n <= to;
        })
        .map(([, entry]) => entry);
      return { ...sumDurationEntries(picked), from: rawFrom, to: rawTo };
    });
    const episodeDurationText = (episodeId) => {
      const entry = videoDurationStats.value?.episodes?.[String(episodeId)];
      if (!entry?.producedShots) return '';
      return `成片 ${formatDurationMinutes(entry.producedSeconds)}`;
    };
    // 导出成片到「下载/Freedom成片/<项目名>/」：可按集数范围导出（两端留空=全部集）。
    const videoExportRange = reactive({ from: '', to: '' });
    const videoExporting = ref(false);
    const openVideoExportFolder = async (dir) => {
      if (!dir) return;
      try {
        const res = await api.post('/api/video/open-export-folder', { dir });
        if (!res?.ok) messageHandlers.warning(res?.error || '打开文件夹失败');
      } catch (error) {
        messageHandlers.error(`打开文件夹失败：${error?.message || error}`);
      }
    };
    const exportVideoRange = async () => {
      const projectId = project?.value?.id;
      if (!projectId) return messageHandlers.warning('请先打开项目');
      if (videoExporting.value) return null;
      videoExporting.value = true;
      try {
        const res = await api.post('/api/video/export-shots', {
          projectId,
          fromEpisodeId: videoExportRange.from === '' ? undefined : Number(videoExportRange.from),
          toEpisodeId: videoExportRange.to === '' ? undefined : Number(videoExportRange.to),
        });
        if (!res?.ok) {
          messageHandlers.warning(res?.error || '没有可导出的成片');
          return null;
        }
        const scope = videoExportRange.from === '' && videoExportRange.to === ''
          ? '全部集'
          : `第 ${videoExportRange.from || '1'}–${videoExportRange.to || '末'} 集`;
        try {
          await ElMessageBox.confirm(`已导出 ${res.count} 个成片（${scope}）到：\n${res.dir}`, '导出完成', {
            confirmButtonText: '打开文件夹',
            cancelButtonText: '知道了',
            type: 'success',
          });
          await openVideoExportFolder(res.dir);
        } catch { /* 用户选择不打开文件夹 */ }
        return res;
      } catch (error) {
        messageHandlers.error(`导出失败：${error?.message || error}`);
        return null;
      } finally {
        videoExporting.value = false;
      }
    };

    const episodeVideoTitle = (episodeId) => {
      const st = sbVideoStatusMap.value?.[episodeId];
      const duration = episodeDurationText(episodeId);
      const suffix = duration ? ` · ${duration}` : '';
      if (!st || st.state === 'none') return '还没有分镜';
      if (st.state === 'ready') return `有分镜（${st.total} 镜），还没有视频`;
      return `分镜 ${st.total} 镜 · 视频 ${st.done}/${st.total}${suffix}`;
    };
    const batchAllRuntime = createBatchAllEpisodesRuntime({
      message: messageHandlers,
      reactive,
      computed,
      refs: {
        project,
        scriptState,
        scriptUI,
        sequentialRunning,
        batchVideoRunning,
        config: cfg,
      },
      helpers: {
        api,
        findStoryboard,
        generateStoryboard,
        generateAllShotVideos,
        generateAllShotVideosSequential,
        stopSequentialGeneration,
        isStoryboardGenerating,
        applyStoryboardBinding: (storyboard) => applyStoryboardBindingUpdate(scriptState.storyboards, storyboard),
        selectEpisode: (id) => { sbEpisodeId.value = id; },
      },
    });
    const { batchAll, sbSortedEpisodes, batchPhaseLabel, batchAllPercent, shotSeconds, shotBudget, pendingStoryboardCount, openBatchAllDialog, confirmBatchAll, stopBatchAll } = batchAllRuntime;

    // 时长统计的刷新时机：切换项目、或出片数量变化时重新拉取。
    // 必须放在 sbSortedEpisodes 初始化之后——watch 的取值函数会立即执行一次，
    // 而 sbVideoStatusMap 依赖 sbSortedEpisodes（提前放会踩 TDZ）。
    watch?.(() => project?.value?.id, loadVideoDurationStats, { immediate: true });
    watch?.(
      () => Object.values(sbVideoStatusMap.value || {}).reduce((sum, item) => sum + (Number(item?.done) || 0), 0),
      loadVideoDurationStats,
    );

    // 一键全自动生成：新建项目 → 提取 → 出图 → 剧本 → 分镜 → 串行视频 → 导出成片
    const autoPipelineRuntime = createAutoPipelineRuntime({
      api,
      message: messageHandlers,
      reactive,
      computed,
      refs: {
        project,
        scriptState,
        config: cfg,
      },
      helpers: {
        api,
        openProject,
        generateStoryboard,
        generateAllShotVideos,
        generateAllShotVideosSequential,
        stopSequentialGeneration,
        findStoryboard,
        applyStoryboardBinding: (storyboard) => applyStoryboardBindingUpdate(scriptState.storyboards, storyboard),
        selectEpisode: (id) => { sbEpisodeId.value = id; },
      },
    });
    const { auto: autoPipeline, PIPELINE_STAGES: autoPipelineStages, targetShots: autoPipelineTargetShots, costEstimate: autoPipelineCostEstimate, stagePercent: autoPipelineStagePercent, phaseLabel: autoPipelinePhaseLabel, openAutoPipelineDialog, runAutoPipeline, stopAutoPipeline, handleScriptFile, openExportDir } = autoPipelineRuntime;

    // 场景补漏：扫描分镜场景标记 → 找出元素库缺失场景 → 一键补建
    const sceneGapRuntime = createSceneGapRuntime({
      api,
      message: messageHandlers,
      reactive,
      computed,
      refs: {
        project,
        scriptState,
        sbEpisodeId,
      },
      helpers: {
        findStoryboard,
      },
    });
    const { sceneGap, missingCount, selectedMissingCount, openSceneGapDialog, onSceneGapScopeChange, toggleSceneGapSelectAll, createMissingScenes } = sceneGapRuntime;

    // The storyboard cards remain the editing surface; this dialog is a fast review surface
    // for checking every generated video without repeatedly scrolling through the long card list.
    const videoOverviewDialog = reactive({
      visible: false,
      filter: 'all',
      anchorShotNo: '',
    });
    // Mount overview cards in small batches so large episodes stay responsive while scrolling.
    const VIDEO_OVERVIEW_RENDER_BATCH_SIZE = 24;
    const videoOverviewRenderLimit = ref(VIDEO_OVERVIEW_RENDER_BATCH_SIZE);
    const videoOverviewRecentShotNos = computed(() => {
      if (String(recentVideoBatch.projectId ?? '') !== String(project.value?.id ?? '')) return [];
      if (String(recentVideoBatch.episodeId ?? '') !== String(sbEpisodeId.value ?? '')) return [];
      return Array.isArray(recentVideoBatch.shotNos) ? recentVideoBatch.shotNos.map((no) => String(no)) : [];
    });
    const videoOverviewRecentCount = computed(() => {
      const recent = new Set(videoOverviewRecentShotNos.value);
      return currentShots.value.filter((shot) => recent.has(String(shot.no))).length;
    });
    const videoOverviewShots = computed(() => {
      const shots = Array.isArray(currentShots.value) ? currentShots.value : [];
      const filter = videoOverviewDialog.filter;
      if (filter === 'recent') {
        const recent = new Set(videoOverviewRecentShotNos.value);
        return shots.filter((shot) => recent.has(String(shot.no)));
      }
      if (filter === 'done') return shots.filter((shot) => Boolean(shotVideoUrl(shot.no)));
      if (filter === 'pending') return shots.filter((shot) => ['queued', 'generating'].includes(shotVideoStatus(shot.no)));
      if (filter === 'missing') return shots.filter((shot) => !shotVideoUrl(shot.no) && !['queued', 'generating'].includes(shotVideoStatus(shot.no)));
      if (filter === 'attention') return shots.filter((shot) => scriptRuntime.isShotAttentionMarked?.(shot));
      return shots;
    });
    const videoOverviewRenderedShots = computed(() => videoOverviewShots.value.slice(0, videoOverviewRenderLimit.value));
    const videoOverviewHasMore = computed(() => videoOverviewRenderedShots.value.length < videoOverviewShots.value.length);
    const loadMoreVideoOverviewShots = () => {
      if (!videoOverviewHasMore.value) return false;
      videoOverviewRenderLimit.value = Math.min(
        videoOverviewShots.value.length,
        videoOverviewRenderLimit.value + VIDEO_OVERVIEW_RENDER_BATCH_SIZE,
      );
      return true;
    };
    const resetVideoOverviewRenderWindow = () => {
      videoOverviewRenderLimit.value = VIDEO_OVERVIEW_RENDER_BATCH_SIZE;
    };
    watch(() => videoOverviewDialog.filter, resetVideoOverviewRenderWindow);
    const videoOverviewDoneCount = computed(() => currentShots.value.filter((shot) => Boolean(shotVideoUrl(shot.no))).length);
    const videoOverviewPendingCount = computed(() => currentShots.value.filter((shot) => ['queued', 'generating'].includes(shotVideoStatus(shot.no))).length);
    const videoOverviewMissingCount = computed(() => Math.max(0, currentShots.value.length - videoOverviewDoneCount.value - videoOverviewPendingCount.value));
    const videoOverviewAttentionCount = computed(() => currentShots.value.filter((shot) => scriptRuntime.isShotAttentionMarked?.(shot)).length);
    const videoOverviewStatusLabel = (shot) => {
      const status = shotVideoStatus(shot?.no);
      if (status === 'queued') return '已提交';
      if (status === 'generating') return '生成中';
      if (shotVideoUrl(shot?.no)) return '已出片';
      if (status === 'failed') return '失败';
      return '未生成';
    };
    const videoOverviewActionLabel = (shot) => {
      const status = shotVideoStatus(shot?.no);
      if (status === 'queued') return '等待出片';
      if (status === 'generating') return '生成中';
      if (shotVideoUrl(shot?.no) || status === 'failed') return '重新生成视频';
      return '生成视频';
    };
    const openVideoOverview = () => {
      if (!currentShots.value.length) return messageHandlers.info('本集还没有可查看的分镜');
      videoOverviewDialog.filter = 'all';
      videoOverviewDialog.anchorShotNo = currentOverviewAnchorShotNo();
      resetVideoOverviewRenderWindow();
      videoOverviewDialog.visible = true;
    };
    const scrollVideoOverviewToAnchor = () => {
      const anchorIndex = videoOverviewShots.value.findIndex(
        (shot) => String(shot?.no) === String(videoOverviewDialog.anchorShotNo),
      );
      if (anchorIndex >= 0) {
        videoOverviewRenderLimit.value = Math.max(
          videoOverviewRenderLimit.value,
          Math.ceil((anchorIndex + 1) / VIDEO_OVERVIEW_RENDER_BATCH_SIZE) * VIDEO_OVERVIEW_RENDER_BATCH_SIZE,
        );
      }
      return nextTick(() => scrollOverviewGridToShot({
        dialogSelector: '.storyboard-video-overview-dialog',
        gridSelector: '.video-overview-grid',
        shotAttribute: 'data-video-overview-shot-no',
        shotNo: videoOverviewDialog.anchorShotNo,
      }));
    };
    const closeVideoOverview = () => { videoOverviewDialog.visible = false; };
    const focusShotFromVideoOverview = async (shot) => {
      closeVideoOverview();
      scriptRuntime.setShotTimelineAttentionFilter?.('all');
      await nextTick();
      return scriptRuntime.focusShotFromTimeline?.(shot);
    };
    workspaceActions = createWorkspaceActionsRuntime({
      api,
      message: messageHandlers,
      refs: {
        project,
        view,
        selectedElementIndex,
        inspectorVisible,
        novelText,
        category: cat,
        extractErrors,
        scriptState,
        scriptUi: scriptUI,
      },
      helpers: {
        isCharacterImageMode: (mode) => characterImageModeOptions.some((option) => option.value === mode),
        ensureCharacterParts,
        normalizeCharacterAlias,
        syncProjectStyle,
        syncCharacterImageMode,
        rememberExtractCounts,
        hydrateScript,
        hydrateShotVideos,
        loadVideoBar,
        hydratePending,
        loadProjects,
      },
      state: { shotVideos, shotStatus },
    });
    const characterLibraryRuntime = createCharacterLibraryRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      refs: { project, category: cat, selectedElementIndex },
      helpers: { hydrateImageState },
      reactive,
      computed,
    });
    const agentRuntime = createAppAgentRuntime({
      api,
      reactive,
      refs: {
        view,
        settingsSection,
        category: cat,
        selectedElementIndex,
        inspectorVisible,
        elementsDrawer,
        scriptUi: scriptUI,
        storyboardEpisodeId: sbEpisodeId,
        project,
        scriptState,
        config: cfg,
        videoBar,
        providerLabel: currentVideoProviderLabel,
        shotStatus,
        currentShots,
        projects,
      },
      readers: { readFileAsDataUrl, readFileAsText },
      message: messageHandlers,
      helpers: {
        loadProjects,
        openProject,
        chapterSig,
        pollExtract,
        generateEpisode,
        generateStoryboard,
        nextTick,
        hydrateShotVideos,
        loadVideoBar,
        findStoryboard,
        parseShots,
        shotVideoUrl,
        buildShotSubmit,
        startPendingPoll,
        runBatch,
        normalizeVideoProvider,
        isTrueMentionVideoMode,
        videoSubmitPayload,
        shotVideoStatus,
        shotElementTags,
        hydrateImageState,
        syncCharacterImageMode,
        hydrateScript,
        clearShotVideo,
        cancelShotQueue,
        clearVideoQueue,
        startShotEdit,
        setShotEditText: (value) => { shotEdit.text = value; },
        saveShotEdit,
        defaultBody: defaultShotBody,
        saveScript: saveScriptDebounced,
        insertAfter: insertShotAfter,
        findChapter,
        generateAllEpisodes,
        genImage,
        generateShotVideo,
        generateAllShotVideos,
        selectCategory,
        categoryLabels: catLabel,
        saveSettings,
        showMessage: (level, message) => {
          ElMessage[level]?.(message) || ElMessage.info(message);
        },
        startProgressPulse,
        stopProgressPulse,
        progressByRatio,
        setTimeout: window.setTimeout.bind(window),
      },
    });

    const chatRuntime = createChatRuntime({
      api,
      reactive,
      refs: { view, config: cfg, imageRatio, customImageRatio },
      readers: { readFileAsDataUrl, readFileAsText, readImageAsPngB64 },
      message: messageHandlers,
      messageBox: ElMessageBox,
      helpers: { nextTick },
    });
    let chatInitialized = false;
    // 工作台首次进入后 DOM 常驻：切走时靠 .is-parked 隐藏而不销毁。
    // 这样分镜里的视频/图片不会重新加载，切回来没有卡顿，滚动位置也天然还在。
    const workspaceMounted = ref(false);
    const novelMounted = ref(false);
    const canvasMounted = ref(false);
    watch(view, (nextView) => {
      if (nextView === 'workspace') workspaceMounted.value = true;
      if (nextView === 'novel') novelMounted.value = true;
      if (nextView === 'canvas') canvasMounted.value = true;
    });
    // 聊天首次进入后 DOM 常驻：切走时靠 .is-parked 隐藏而不销毁，
    // 这样内部滚动容器的 scrollTop 天然保留，切回来还在原来读到的那条消息。
    const chatMounted = ref(false);
    watch(view, (nextView) => {
      if (nextView !== 'chat') return;
      chatMounted.value = true;
      if (chatInitialized) return;
      chatInitialized = true;
      chatRuntime.initializeChat();
    });

    createTaskNotifyRuntime({
      watch,
      onMounted,
      refs: {
        agent: agentRuntime.agent,
        taskCenter,
        project,
      },
      helpers: {
        openAgent: agentRuntime.openAgent,
        startBackgroundTaskMonitor,
        stopBackgroundTaskMonitor,
      },
      globals: { window, document },
    });

    const novelRuntime = createAppNovelRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      reactive,
      ref,
      computed,
      watch,
      readers: { readImageAsPngB64 },
      globals: {
        window,
        document,
        navigator,
      },
    });
    const coverRuntime = createAppCoverRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      reactive,
      readers: { readImageAsPngB64 },
      globals: { window, document },
    });
    const videoSplitRuntime = createAppVideoSplitRuntime({
      api,
      message: messageHandlers,
      reactive,
      globals: { window, document },
    });
    const openCoverStudio = async () => {
      rememberWorkspacePosition();
      view.value = 'cover';
      await coverRuntime.loadCoverHistory();
    };
    const openVideoSplitStudio = () => {
      rememberWorkspacePosition();
      view.value = 'split';
    };
    watch(view, (nextView, previousView) => {
      if (previousView === 'novel' && nextView !== 'novel') void novelRuntime.flushNovelEdits();
    });

    const canvasRuntime = createCanvasRuntime({
      api,
      config: cfg,
      options: {
        imageBaseUrlOptions,
        imageModelOptions,
        grsaiImageModelOptions,
        libtvImageModelOptions: settingsRuntime.libtvImageModelOptions,
        dreaminaImageModelOptions: settingsRuntime.dreaminaImageModelOptions,
        updreamImageModelOptions: settingsRuntime.updreamImageModelOptions,
        neowowImageModelOptions: settingsRuntime.neowowImageModelOptions,
        videoProviderOptions,
        xiaoyunqueModelOptions,
        dreaminaModelOptions,
        libtvModelOptions,
        updreamModelOptions,
        neowowModelOptions,
        videoApiModelOptions,
        getProject: () => project.value,
      },
      desktop: window.desktopPetHost ? {
        openCanvasMediaFolder: window.desktopPetHost.openCanvasMediaFolder,
        saveCanvasMedia: window.desktopPetHost.saveCanvasMedia,
      } : {},
      vue: { reactive, ref, computed, nextTick },
      globals: { window, document },
      message: messageHandlers,
    });

    createAppLifecycleRuntime({
      watch,
      onMounted,
      message: messageHandlers,
      refs: { view, license },
      helpers: {
        initialView: (() => {
          const requested = new URLSearchParams(window.location.search).get('view');
          return ['canvas', 'split'].includes(requested) ? requested : 'projects';
        })(),
        loadProjects,
        loadTaskCenter,
        startTaskAutoRefresh,
        stopTaskAutoRefresh,
        loadNovelDrafts: novelRuntime.loadNovelDrafts,
        loadSettings,
        loadStoryboardPromptTemplates,
        notifyRendererReady: async () => {
          await nextTick();
          await new Promise((resolve) => {
            window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
          });
          window.desktopPetHost?.rendererReady?.();
        },
      },
    });

    // ---------- 全局快速跳转（Ctrl/Cmd+K） ----------
    const commandPaletteRuntime = createCommandPaletteRuntime({
      reactive,
      computed,
      globals: { window, document },
      helpers: {
        nextTick,
        setView: (name) => { view.value = name; },
        hasProject: () => Boolean(project.value),
        openAgent: () => agentRuntime.openAgent(),
        openElementsDrawer,
        openProject,
        getProjects: () => projects.value || [],
        getEpisodes: () => scriptState.episodes || [],
        gotoStage: (stage) => { view.value = 'workspace'; scriptUI.stage = stage; },
        gotoEpisode: (id) => {
          view.value = 'workspace';
          scriptUI.stage = 'script';
          scriptUI.selectedId = 'ep:' + id;
        },
        gotoStoryboard: (id) => {
          view.value = 'workspace';
          scriptUI.stage = 'storyboard';
          sbEpisodeId.value = id;
        },
      },
    });

    const videoHistoryRuntime = createVideoHistoryRuntime({
      api,
      message: messageHandlers,
      messageBox: ElMessageBox,
      reactive,
      onRestored: async (result, { episodeId, shotNo }) => {
        const key = shotVideoKey(shotNo, episodeId);
        const videoUrl = result.videoUrl || `/video/${encodeURIComponent(project.value?.id || '')}/${encodeURIComponent(String(episodeId))}/${encodeURIComponent(String(shotNo))}.mp4?t=${Date.now()}`;
        shotVideos[key] = videoUrl;
        delete shotStatus[key];
        delete shotProgress[key];
        const storyboard = findStoryboard(episodeId);
        if (storyboard) {
          if (!storyboard.shotVideos || typeof storyboard.shotVideos !== 'object') storyboard.shotVideos = {};
          storyboard.shotVideos[String(shotNo)] = {
            videoUrl,
            provider: 'history-restore',
            updatedAt: new Date().toISOString(),
          };
        }
        await nextTick();
      },
    });

    return {
      ...novelRuntime,
      ...coverRuntime,
      ...videoSplitRuntime,
      ...softwareUpdateRuntime,
      legalAgreement,
      acceptLegalAgreement,
      declineLegalAgreement,
      license,
      view,
      ...settingsRuntime,
      ...themeRuntime,
      ...modelRoutingRuntime,
      fetchTextModelsAndSync,
      diagnostics, loadDiagnostics, exportDiagnostics, liteModeEnabled,
      taskCenter, loadTaskCenter, setTaskFilter, filteredTasks, taskStatusType, taskStatusLabel, formatTaskTime, performTaskAction, clearFinishedTasks, taskActionLoading,
      locatingTaskId, canLocateTask, taskLocationLabel, locateTask,
      textBaseUrlOptions, textModelOptions, imageBaseUrlOptions, imageModelOptions, comfyUiWorkflowOptions,
      styleOptions, stylePromptFields, elementPromptFields, imageRatioOptions, characterImageModeOptions, onCharacterImageModeChange,
      newProjectName, creating, projects, deletedProjects, overviewProjects, projectOverviewStats, activeProjectOverviewStats,
      filteredProjects, renderedProjects, hasMoreRenderedProjects,
      loadingProjects, loadingTrash, backupImporting, projectPackageImporting, projectSelectionMode,
      selectedProjectIds, selectedProjectCount, allFilteredProjectsSelected, projectSearch, projectSort, projectSection, snapshots,
      loadProjects, loadMoreProjects, loadDeletedProjects, selectProjectSection, createProject, delProject, renameProject, duplicateProject,
      toggleProjectArchive, restoreDeletedProject, purgeDeletedProject, emptyProjectTrash,
      showProjectSnapshots, restoreProjectSnapshot, exportBackup, importBackup,
      isProjectSelected, setProjectSelected, toggleProjectSelection, toggleProjectSelectionMode,
      selectAllFilteredProjects, exportProjectPackage, exportSelectedProjects, importProjectPackages,
      recentAt, openProjectFromKeyboard, formatProjectTime, formatProjectSize,
      openProject, openProjectArea, backToProjects, rememberWorkspacePosition, leaveWorkspace, openCoverStudio, openVideoSplitStudio,
      project, cat, elementSearchQuery, extractCategory, selectedElementIndex, inspectorVisible, elementsDrawer, settingsSection, settingsTextTab,
      atelierPanel, toggleAtelierPanel,
      elementFilterOptions, batchCategoryOptions, extractionCategoryOptions,
      ...extractImportRuntime,
      ...elementRuntime,
      ...characterLibraryRuntime,
      ...exportRuntime,
      settingsPromptKind, settingsSelectedPromptId, settingsPromptList, settingsSelectedPrompt,
      ...scriptRuntime,
      ...qualityRuntime,
      projectStyle, onProjectStyleChange, clearElements, addElement, deleteElement, addingElement,
      sbEpisodeId, shotEdit, aiBinding, aiBindRangeDialog,
      addTagPanel, selectedSbEpisode, selectedSbStoryboard,
      sbSortedEpisodes, batchAll, batchPhaseLabel, batchAllPercent, shotSeconds, shotBudget, pendingStoryboardCount,
      openBatchAllDialog, confirmBatchAll, stopBatchAll, isStoryboardGenerating,
      sbVideoStatusMap, episodeVideoTitle, reconcileUpstreamVideos,
      videoDurationStats, videoDurationSummary, durationStatRange, durationStatsRange, durationStatsLoading,
      formatDurationMinutes, episodeDurationText, loadVideoDurationStats,
      videoExportRange, videoExporting, exportVideoRange, openVideoExportFolder,
      autoPipeline, autoPipelineStages, autoPipelineTargetShots, autoPipelineCostEstimate, autoPipelineStagePercent, autoPipelinePhaseLabel,
      openAutoPipelineDialog, runAutoPipeline, stopAutoPipeline, handleScriptFile, openExportDir,
      sceneGap, missingCount, selectedMissingCount, openSceneGapDialog, onSceneGapScopeChange, toggleSceneGapSelectAll, createMissingScenes,
      shotVideoUrl, onPickShotVideo, clearShotVideo, refetchShotVideo, cancelShotQueue, clearAllPending,
      shotVideoStatus,
      shotOpenerFrame, shotOpenerFrameName, capturePrevTailFrame, openTailFramePicker, tailFramePicker, tailFramePickerVideo,
      onTailFramePickerLoaded, onTailFramePickerTimeUpdate, seekTailFramePicker, saveTailFramePicker, formatTailFrameTime,
      clearShotOpenerFrame, editShotOpenerFrameName, prevShotNo, generateAllShotVideosSequential,
      videoProviderOptions, xiaoyunqueModelOptions, dreaminaModelOptions, libtvModelOptions, updreamModelOptions, neowowModelOptions, videoApiModelOptions,
      ...videoRuntime,
      videoQueue, videoQueueDialog, shotVideoKey,
      shotProgress,
      bindingOverviewDialog,
      bindingOverviewSummary,
      bindingOverviewFilteredEntries,
      bindingOverviewStatusLabel,
      bindingOverviewSourceLabel,
      openBindingOverview,
      scrollBindingOverviewToAnchor,
      closeBindingOverview,
      inspectBindingOverviewTag,
      focusShotFromBindingOverview,
      isBindingOverviewPickerVisible,
      setBindingOverviewPickerVisible,
      openBindingOverviewPicker,
      isBindingOverviewTagBound,
      isBindingOverviewTagManual,
      addBindingOverviewTag,
      removeBindingOverviewTag,
      isBindingOverviewAudioPickerVisible,
      setBindingOverviewAudioPickerVisible,
      openBindingOverviewAudioPicker,
      toggleBindingOverviewAudio,
      videoOverviewDialog,
      videoOverviewShots,
      videoOverviewRenderedShots,
      videoOverviewHasMore,
      loadMoreVideoOverviewShots,
      videoOverviewDoneCount,
      videoOverviewPendingCount,
      videoOverviewMissingCount,
      videoOverviewAttentionCount,
      videoOverviewRecentCount,
      videoOverviewStatusLabel,
      videoOverviewActionLabel,
      openVideoOverview,
      scrollVideoOverviewToAnchor,
      closeVideoOverview,
      focusShotFromVideoOverview,
      ...agentRuntime,
      ...chatRuntime,
      chatMounted,
      workspaceMounted,
      novelMounted,
      canvasMounted,
      ...canvasRuntime,
      ...commandPaletteRuntime,
      ...videoHistoryRuntime,
    };
  },
};

App.template = template;

// ---- 挂载 ----
const app = createApp(App);
app.config.errorHandler = (err, instance, info) => {
  console.error('Vue错误:', err, info);
  console.error('错误堆栈:', err?.stack);
  const { ElMessage } = window.ElementPlus;
  ElMessage?.error?.(`应用错误: ${err?.message || err}`);
};
app.config.warnHandler = (msg, instance, trace) => {
  console.warn('Vue警告:', msg, trace);
};
app.use(window.ElementPlus);
app.directive('lazy-video', createLazyVideoDirective());
app.directive('progressive-render', createProgressiveRenderDirective());
app.directive('viewport-render', createViewportRenderDirective());
// Lucide 图标（<AppIcon name="..." />）
registerIconComponents(app);
// 兼容窗口：若仍加载了 Element Plus 图标包，一并注册（新代码不应再使用）
for (const [name, comp] of Object.entries(window.ElementPlusIconsVue || {})) {
  app.component(name, comp);
}
app.mount('#app');
