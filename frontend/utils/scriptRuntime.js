import {
  chapterSig,
  createAppScriptWorkspaceRuntime,
  createScriptGenerationActionsRuntime,
} from './scriptUtils.js';
import {
  createCopyShotRuntime,
  createShotCardRuntime,
  createShotUiStateRuntime,
  defaultShotBody,
  formatTailFrameTime,
  nameMatchesText,
  shotPresenceText,
} from './shotUtils.js';
import { createShotTextRegenerationRuntime } from './shotTextRegeneration.js';

export function clearEpisodeVideoRuntimeState({
  episodeId,
  shotVideos = {},
  shotStatus = {},
  shotProgress = {},
  shotEdit = {},
  revokeObjectUrl = () => {},
} = {}) {
  const prefix = `${episodeId}:`;
  const clearMap = (map) => {
    for (const key of Object.keys(map || {})) {
      if (!key.startsWith(prefix)) continue;
      const value = map[key];
      if (typeof value === 'string' && value.startsWith('blob:')) {
        try { revokeObjectUrl(value); } catch { /* best effort */ }
      }
      delete map[key];
    }
  };
  clearMap(shotVideos);
  clearMap(shotStatus);
  clearMap(shotProgress);
  if (typeof shotEdit?.key === 'string' && shotEdit.key.startsWith(prefix)) {
    shotEdit.key = '';
    shotEdit.text = '';
  }
}

export function createAppScriptRuntime({
  api,
  message,
  messageBox,
  refs = {},
  readers = {},
  helpers = {},
  globals = {},
  reactive,
  ref,
  computed,
  watch,
} = {}) {
  let clearEpisodeVideoState = () => {};
  const scriptWorkspace = createAppScriptWorkspaceRuntime({
    api,
    message,
    config: refs.config,
    refs: {
      project: refs.project,
      promptKind: refs.promptKind,
      selectedPromptId: refs.selectedPromptId,
      storyboardEpisodeId: refs.episodeId,
    },
    readers: {
      readFileAsText: readers.readFileAsText,
      readPlainTxtFiles: readers.readPlainTxtFiles,
    },
    helpers: {
      saveSettings: helpers.saveSettings,
      nextTick: helpers.nextTick,
      clearEpisodeVideoState: (episodeId) => clearEpisodeVideoState(episodeId),
    },
    ui: { confirm: messageBox.confirm },
    reactive,
    ref,
    computed,
  });

  const {
    scriptState,
    scriptUI,
    activeScriptCustomPrompt,
    activeStoryboardCustomPrompt,
    saveSettingsDebounced,
    saveScriptNow,
    saveScriptDebounced,
    requireActiveCustomPrompt,
    hydrateScript,
    chaptersSorted,
    findEpisode,
    findChapter,
    findStoryboard,
  } = scriptWorkspace;

  const shotUi = createShotUiStateRuntime({
    ref,
    reactive,
    computed,
    refs: { episodeId: refs.episodeId, config: refs.config },
    helpers: { findEpisode, findStoryboard },
  });

  const {
    shotHeaderPrefix,
    shotEdit,
    shotVideos,
    shotStatus,
    shotProgress,
    videoQueue,
    addTagPanel,
    aiBinding,
    aiBindRangeDialog,
    batchCharacterLookDialog,
    shotPromptReveal,
    shotTimeline,
  } = shotUi;

  clearEpisodeVideoState = (episodeId) => clearEpisodeVideoRuntimeState({
    episodeId,
    shotVideos,
    shotStatus,
    shotProgress,
    shotEdit,
    revokeObjectUrl: (url) => globals.window?.URL?.revokeObjectURL(url),
  });

  const scriptGeneration = createScriptGenerationActionsRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      config: refs.config,
      scriptState,
      scriptUi: scriptUI,
      activeScriptCustomPrompt,
      activeStoryboardCustomPrompt,
      shotHeaderPrefix,
      storyboardPromptTemplateId: refs.storyboardPromptTemplateId,
      extracting: refs.extracting,
      extractErrors: refs.extractErrors,
      extractProgress: refs.extractProgress,
    },
    readers: { readPlainTxtFiles: readers.readPlainTxtFiles },
    helpers: {
      saveSettings: helpers.saveSettings,
      nextTick: helpers.nextTick,
      clampProgress: helpers.clampProgress,
      requireActiveCustomPrompt,
      rememberExtractCounts: helpers.rememberExtractCounts,
      startExtractProgress: helpers.startExtractProgress,
      pollExtract: helpers.pollExtract,
      failExtractProgress: helpers.failExtractProgress,
      findEpisode,
      findChapter,
      findStoryboard,
      chaptersSorted,
      chapterSig,
      clearEpisodeVideoState,
    },
    globals: { window: globals.window },
    computed,
  });

  const shotCard = createShotCardRuntime({
    api,
    message,
    messageBox,
    computed,
    ref,
    ui: {
      confirmDelete: (target) => messageBox.confirm(`删除镜头 ${target.no}？后续镜头会自动前移编号。`, '删除分镜', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      }).then(() => true).catch(() => false),
      confirmSplit: (info) => messageBox.confirm(
        info?.byParagraph
          ? `镜头 ${info.shotNo} 没有时间码，无法按时间拆分。\n\n改按正文的段落边界（台词/音效/画面行）均分成两段内容：上半段保留在原镜头，下半段插入为新镜头。两段时长沿用原设置（请各自确认），时间码不会被重标。`
          : `把镜头 ${info.shotNo}（约 ${info.totalSeconds} 秒、${info.blockCount} 个时间码块）拆成两个约 ${info.firstSeconds} 秒的镜头？\n\n上半段保留在原镜头，下半段插入为新镜头，两段时间码各自从 0 秒重新标注，下半段会自动承接上半段结尾状态。`,
        '拆分镜头时长',
        { type: 'warning', confirmButtonText: '拆分', cancelButtonText: '取消' },
      ).then(() => true).catch(() => false),
    },
    refs: {
      aiBinding,
      aiBindRangeDialog,
      shotEdit,
      project: refs.project,
      config: refs.config,
      episodeId: refs.episodeId,
      scriptState,
      category: refs.category,
      elementsDrawer: refs.elementsDrawer,
      shotHeaderPrefix,
      shotVideos,
      shotStatus,
      shotProgress,
      videoQueue,
      addTagPanel,
      batchCharacterLookDialog,
      shotTimeline,
      shotPromptReveal,
    },
    globals: { document: globals.document, window: globals.window },
    helpers: {
      findStoryboard,
      saveScriptNow,
      saveScript: saveScriptDebounced,
      saveSettings: saveSettingsDebounced,
      hydratePending: helpers.hydratePending,
      cancelVideoQueueStartTimer: helpers.cancelVideoQueueStartTimer,
      nextTick: helpers.nextTick,
      regenerateShotElementImage: helpers.regenerateShotElementImage,
    },
  });

  const shotTextRegeneration = createShotTextRegenerationRuntime({
    api,
    message,
    ref,
    refs: {
      project: refs.project,
      episodeId: refs.episodeId,
    },
    helpers: {
      findStoryboard,
      saveScriptNow,
      saveScript: saveScriptDebounced,
      isShotLocked: (shot) => findStoryboard(refs.episodeId.value)?.shotMeta?.[String(shot?.no)]?.locked === true,
      failureReason: (shot) => {
        const key = `${refs.episodeId.value}:${String(shot?.no ?? '')}`;
        const progress = shotProgress[key];
        return progress?.error || progress?.note || '';
      },
    },
  });

  const copyShot = createCopyShotRuntime({
    message,
    globals: {
      navigator: globals.navigator,
      document: globals.document,
    },
  });

  if (typeof watch === 'function') {
    watch(refs.episodeId, () => {
      batchCharacterLookDialog.visible = false;
      addTagPanel.activePicker = '';
      shotCard.clearShotTimelineSelection?.();
      shotCard.resetShotRenderWindow?.();
      shotTimeline.visible = false;
      shotTimeline.jumpNo = '';
      shotTimeline.attentionInput = '';
    });
    watch(() => shotTimeline.attentionFilter, () => shotCard.resetShotRenderWindow?.());
  }

  const deleteEpisodeFromWorkspace = scriptWorkspace.deleteEpisode;
  const episodeActionsBusy = (episode) => {
    const episodeId = Number(episode?.id);
    const state = scriptUI;
    return Boolean(
      state.deletingEpisode
      || state.genEpisode === episodeId
      || state.genStoryboard === episodeId
      || state.batchGen?.active
      || state.adaptingWholeNovel
      || state.splitting
      || state.genWhole
      || (String(refs.episodeId?.value) === String(episodeId)
        && (videoQueue.processing || shotTimeline.busy || aiBinding.running))
    );
  };
  const deleteEpisode = async (episode) => {
    const episodeId = Number(episode?.id);
    const isStoryboardEpisode = String(refs.episodeId?.value) === String(episodeId);
    if (isStoryboardEpisode && (videoQueue.processing || shotTimeline.busy || aiBinding.running)) {
      message.warning('本集的分镜或视频任务正在运行，请完成后再删除');
      return false;
    }
    const removed = await deleteEpisodeFromWorkspace(episode);
    if (!removed) return false;

    clearEpisodeVideoState(episodeId);
    if (isStoryboardEpisode) {
      videoQueue.items.splice(0, videoQueue.items.length);
      helpers.cancelVideoQueueStartTimer?.();
      addTagPanel.visible = false;
      addTagPanel.activePicker = '';
      aiBindRangeDialog.visible = false;
      batchCharacterLookDialog.visible = false;
    }
    if (String(shotTimeline.targetEpisodeId) === String(episodeId) || isStoryboardEpisode) {
      shotTimeline.selectedNos = [];
      shotTimeline.anchorNo = '';
      shotTimeline.dragNo = '';
      shotTimeline.dropNo = '';
      shotTimeline.targetEpisodeId = '';
      shotTimeline.videoPreview.visible = false;
      shotTimeline.videoPreview.url = '';
      shotTimeline.videoPreview.shotNo = '';
    }
    return true;
  };

  return {
    ...scriptWorkspace,
    ...shotUi,
    ...scriptGeneration,
    ...shotCard,
    ...shotTextRegeneration,
    copyShot,
    chapterSig,
    defaultShotBody,
    formatTailFrameTime,
    nameMatchesText,
    shotPresenceText,
    episodeActionsBusy,
    deleteEpisode,
    hydrateScript,
  };
}
