import {
  createVideoUiStateRuntime,
  allowedVideoDuration,
  effectiveVideoSettings,
  normalizeVideoProvider,
  videoDurationRangeFor,
  videoProviderLabel,
  videoModelForProvider,
} from './core.js';
import { shotDurationMismatch } from './splitShot.js';
import {
  dreaminaModelOptions,
  libtvModelOptions as libtvFallbackModelOptions,
  neowowModelOptions,
  updreamModelOptions,
  videoProviderOptions,
  xiaoyunqueModelOptions,
} from '../../constants/options.js';
import { createVideoBarRuntime } from './bar.js';
import {
  createAddXiaoyunqueAccountsRuntime,
  createDeleteXiaoyunqueAccountRuntime,
  createDreaminaAgentRuntime,
  createDreaminaCliRuntime,
  createInstallXiaoyunqueCliRuntime,
  createLibtvCliRuntime,
  createVideoCliStatusRuntime,
} from './cli.js';
import { createVideoQueueActionsRuntime } from './queue.js';
import { createVideoSubmitActionsRuntime } from './submit.js';

export function createVideoPipelineRuntime({
  api,
  message,
  refs = {},
  helpers = {},
  globals = {},
  reactive,
  computed,
  watch,
  ref,
} = {}) {
  const videoState = createVideoUiStateRuntime({
    ref,
    reactive,
    computed,
    watch,
    refs: { config: refs.config },
  });
  const {
    settingsVideoResolutionOptions,
    settingsVideoDurationRange,
    videoBar,
    videoBarResolutionOptions,
    videoBarDurationRange,
    videoBarApiModelOptions,
    currentVideoProviderLabel,
    currentVideoAccountSummary,
    submitting,
    batchVideoRunning,
    batchVideoProgress,
    videoProgress,
    schedulerSlots,
    sequentialRunning,
    sequentialPendingCount,
    videoRangeDialog,
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
  } = videoState;
  const videoGuard = reactive({
    active: false,
    episodeId: 0,
    episodeTitle: '',
    shotNos: [],
    remaining: 0,
    total: 0,
  });
  const setTimer = globals.setTimeout || ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = globals.clearTimeout || ((timer) => clearTimeout(timer));
  let videoGuardTimer = null;
  let videoGuardPromise = null;
  let videoGuardResolve = null;
  const finishVideoGuard = (approved) => {
    if (videoGuardTimer) {
      clearTimer(videoGuardTimer);
      videoGuardTimer = null;
    }
    videoGuard.active = false;
    videoGuard.remaining = approved ? 0 : videoGuard.remaining;
    const resolve = videoGuardResolve;
    videoGuardResolve = null;
    resolve?.(approved);
    videoGuardPromise = null;
  };
  const waitForVideoGuard = ({ episodeId = refs.episodeId.value, shotNos = [], skipSafety = false } = {}) => {
    const config = refs.config?.value || refs.config || {};
    const safety = config.generationSafety || {};
    if (skipSafety || safety.videoGuardEnabled !== true) return Promise.resolve(true);
    const seconds = Math.max(1, Math.min(120, Math.floor(Number(safety.videoGuardSeconds) || 10)));
    if (videoGuardPromise) return Promise.resolve(false);
    const episode = helpers.findEpisode?.(episodeId);
    videoGuard.active = true;
    videoGuard.episodeId = episodeId;
    videoGuard.episodeTitle = episode?.title || `Episode ${episodeId}`;
    videoGuard.shotNos = [...new Set((shotNos || []).map((no) => String(no ?? '').trim()).filter(Boolean))];
    videoGuard.total = seconds;
    videoGuard.remaining = seconds;
    videoGuardPromise = new Promise((resolve) => {
      videoGuardResolve = resolve;
      const startedAt = Date.now();
      const tick = () => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        videoGuard.remaining = Math.max(0, seconds - elapsed);
        if (videoGuard.remaining <= 0) {
          finishVideoGuard(true);
          return;
        }
        videoGuardTimer = setTimer(tick, 200);
      };
      videoGuardTimer = setTimer(tick, 200);
    });
    return videoGuardPromise;
  };
  const cancelVideoGuard = () => finishVideoGuard(false);
  const libtvModelOptions = reactive([...libtvFallbackModelOptions]);
  const libtvModelsLoading = ref(false);
  const recentVideoBatch = reactive({
    projectId: '',
    episodeId: null,
    shotNos: [],
    startedAt: 0,
    kind: '',
  });
  const recordGenerationBatch = (shotNos = [], context = {}) => {
    const normalized = [...new Set((shotNos || [])
      .map((no) => String(no ?? '').trim())
      .filter(Boolean))];
    if (!normalized.length) return false;
    recentVideoBatch.projectId = String(context.projectId ?? refs.project.value?.id ?? '');
    recentVideoBatch.episodeId = context.episodeId ?? refs.episodeId.value;
    recentVideoBatch.shotNos = normalized;
    recentVideoBatch.startedAt = Date.now();
    recentVideoBatch.kind = String(context.kind || 'batch');
    return true;
  };

  const shotNoKey = (value) => String(value ?? '').trim();
  const currentStoryboard = () => helpers.findStoryboard(refs.episodeId.value);
  const ensureShotMeta = (storyboard, no) => {
    if (!storyboard.shotMeta || typeof storyboard.shotMeta !== 'object') storyboard.shotMeta = {};
    const key = shotNoKey(no);
    if (!storyboard.shotMeta[key] || typeof storyboard.shotMeta[key] !== 'object') storyboard.shotMeta[key] = {};
    return storyboard.shotMeta[key];
  };
  const cleanShotVideoSettings = (settings = {}) => {
    const out = {};
    const provider = String(settings.provider || '').trim();
    const model = String(settings.model ?? '').trim();
    const session = String(settings.session ?? '').trim();
    const accountId = String(settings.accountId ?? '').trim();
    if (provider) out.provider = normalizeVideoProvider(provider);
    if (model) out.model = model;
    if (session) out.session = session;
    if (accountId) out.accountId = accountId;
    return out;
  };
  const shotVideoSettings = (shot) => {
    const key = shotNoKey(shot?.no);
    const settings = currentStoryboard()?.shotMeta?.[key]?.videoSettings;
    return settings && typeof settings === 'object' ? cleanShotVideoSettings(settings) : {};
  };
  const setShotVideoSettings = (shot, mutator) => {
    const storyboard = currentStoryboard();
    const key = shotNoKey(shot?.no);
    if (!storyboard || !key) return false;
    const meta = ensureShotMeta(storyboard, key);
    const settings = cleanShotVideoSettings(meta.videoSettings);
    mutator(settings);
    const cleaned = cleanShotVideoSettings(settings);
    if (Object.keys(cleaned).length) meta.videoSettings = cleaned;
    else delete meta.videoSettings;
    meta.updatedAt = new Date().toISOString();
    helpers.saveScript();
    return true;
  };
  const effectiveShotVideoSettings = (shot) => effectiveVideoSettings(videoBar, shotVideoSettings(shot));
  const shotVideoProvider = (shot) => shotVideoSettings(shot).provider || '';
  const effectiveShotVideoProvider = (shot) => effectiveShotVideoSettings(shot).provider;
  const shotVideoDurationRange = (shot) => {
    const settings = effectiveShotVideoSettings(shot);
    const range = videoDurationRangeFor(settings.provider, settings.model);
    const configuredMax = Number(refs.config?.video?.duration) || 15;
    return { ...range, max: Math.max(range.min, configuredMax) };
  };
  const modelOptionsForProvider = (provider) => {
    const normalized = normalizeVideoProvider(provider);
    if (normalized === 'xiaoyunque') return xiaoyunqueModelOptions;
    if (normalized === 'updream') return updreamModelOptions;
    if (normalized === 'neowow') return neowowModelOptions;
    if (normalized === 'comfyui') return [{ label: 'MiniMax H3', value: 'MiniMax-H3' }];
    if (normalized === 'libtv-cli') return libtvModelOptions;
    if (normalized === 'video-api') return videoBarApiModelOptions.value;
    return dreaminaModelOptions;
  };
  const modelLabel = (provider, model) => {
    const value = String(model ?? '').trim();
    const option = modelOptionsForProvider(provider).find((item) => String(item.value ?? '') === value);
    if (option?.label) return option.label;
    if (!value && normalizeVideoProvider(provider) === 'dreamina-cli') return 'CLI 默认';
    return value || '默认模型';
  };
  const shotVideoModel = (shot) => shotVideoSettings(shot).model || '';
  const shotVideoAccountId = (shot) => shotVideoSettings(shot).accountId || '';
  const shotVideoModelOptions = (shot) => modelOptionsForProvider(effectiveShotVideoProvider(shot))
    .filter((item) => String(item.value ?? '') !== '');
  const shotVideoDefaultModelLabel = (shot) => {
    const provider = effectiveShotVideoProvider(shot);
    return `跟随默认（${modelLabel(provider, videoModelForProvider(videoBar, provider))}）`;
  };
  const neowowAccountOptionLabel = (account = {}) => {
    const points = account.points == null ? '积分未知' : `${Number(account.points).toLocaleString('zh-CN')} 积分`;
    return `${account.name || account.id || 'Neowow 账号'} · ${points}`;
  };
  const neowowAutoAccountLabel = () => {
    const usable = (refs.config.video.neowowAccounts || [])
      .filter((account) => (
        account.enabled !== false
        && account.hasToken
        && !['expired', 'logged_out', 'invalid', 'logging_in'].includes(account.status)
        && (account.points == null || Number(account.points) > 0)
      ));
    if (!usable.length) return '自动分配（暂无可用账号）';
    const known = usable.filter((account) => account.points != null);
    const total = known.reduce((sum, account) => sum + (Number(account.points) || 0), 0);
    return known.length === usable.length
      ? `自动分配（${usable.length} 个账号 · 共 ${total.toLocaleString('zh-CN')} 积分）`
      : `自动分配（${usable.length} 个账号）`;
  };
  const neowowEpisodeAccountLabel = () => {
    const selected = (refs.config.video.neowowAccounts || [])
      .find((account) => account.id === videoBar.neowowAccountId);
    return selected ? neowowAccountOptionLabel(selected) : neowowAutoAccountLabel();
  };
  const setShotVideoProvider = (shot, provider) => setShotVideoSettings(shot, (settings) => {
    const normalized = String(provider || '').trim();
    if (!normalized) {
      delete settings.provider;
      delete settings.model;
      delete settings.session;
      delete settings.accountId;
      return;
    }
    settings.provider = normalizeVideoProvider(normalized);
    delete settings.model;
    delete settings.session;
    delete settings.accountId;
  });
  const setShotVideoModel = (shot, model) => setShotVideoSettings(shot, (settings) => {
    const value = String(model ?? '').trim();
    if (!value) {
      delete settings.model;
      return;
    }
    if (!settings.provider) settings.provider = effectiveShotVideoProvider(shot);
    settings.model = value;
  });
  const setShotVideoAccountId = (shot, accountId) => setShotVideoSettings(shot, (settings) => {
    const value = String(accountId || '').trim();
    if (!value) {
      delete settings.accountId;
      return;
    }
    if (!settings.provider) settings.provider = effectiveShotVideoProvider(shot);
    settings.accountId = value;
  });
  const hasShotVideoSettings = (shot) => Object.keys(shotVideoSettings(shot)).length > 0;
  const resetShotVideoSettings = (shot) => setShotVideoSettings(shot, (settings) => {
    for (const key of Object.keys(settings)) delete settings[key];
  });
  const shotVideoSettingsSummary = (shot) => {
    const settings = shotVideoSettings(shot);
    const effective = effectiveShotVideoSettings(shot);
    const provider = videoProviderOptions.find((item) => item.value === effective.provider)?.label || effective.provider;
    const prefix = Object.keys(settings).length ? '' : '本集默认 · ';
    const agentAccount = (refs.config.video.dreaminaAgentAccounts || [])
      .find((account) => account.id === effective.dreaminaAgentAccountId);
    const agentPreset = effective.dreaminaAgentPromptPreset === 'fast'
      ? 'Seedance 2.0fast 非VIP非2.0'
      : 'Seedance 2.0 非VIP非fast';
    if (effective.provider === 'neowow') {
      const account = (refs.config.video.neowowAccounts || [])
        .find((item) => item.id === effective.neowowAccountId);
      return `${prefix}${provider} · ${account ? neowowAccountOptionLabel(account) : neowowAutoAccountLabel()} · ${modelLabel(effective.provider, effective.model)}`;
    }
    return effective.provider === 'dreamina-agent'
      ? `${prefix}${provider} · ${agentAccount?.name || '未选择账号'} · ${agentPreset} · 15秒 · 16:9 · 间隔 ${effective.dreaminaAgentShotIntervalSeconds}秒`
      : `${prefix}${provider} · ${modelLabel(effective.provider, effective.model)}`;
  };
  const shotVideoAllowCreateModel = (shot) => effectiveShotVideoProvider(shot) === 'video-api';
  const normalizeShotVideoProgressValue = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.max(0, Math.min(100, Math.round(number)));
  };
  const shotVideoProgressState = (shot) => refs.shotProgress?.[helpers.shotVideoKey(shot?.no ?? shot)] || {};
  const estimatedShotVideoProgress = (state = {}) => {
    const startedAt = Number(state.startedAt) || Date.now();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const curved = Math.round(8 + (87 * (1 - Math.exp(-elapsed / 180000))));
    const stored = normalizeShotVideoProgressValue(state.percentage);
    return Math.min(95, Math.max(stored ?? 1, curved));
  };
  const shotVideoProgress = (shot) => {
    const state = shotVideoProgressState(shot);
    const stored = normalizeShotVideoProgressValue(state.percentage);
    if (state.source === 'remote') return stored ?? 0;
    return estimatedShotVideoProgress(state);
  };
  const shotVideoElapsedText = (ms) => {
    const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
  };
  const shotVideoProgressText = (shot) => {
    const state = shotVideoProgressState(shot);
    const source = state.source === 'remote' ? '真实进度' : '估算进度';
    const note = String(state.note || '').trim();
    // 上游任务日志（rolldek）带回来的模型 / 耗时 / 费用，让「生成到哪了」不只是一个百分比。
    const facts = [];
    if (state.upstreamModel) facts.push(`模型 ${state.upstreamModel}`);
    const elapsedMs = Number(state.upstreamElapsedMs);
    if (elapsedMs > 0) facts.push(`已耗时 ${shotVideoElapsedText(elapsedMs)}`);
    const costUsd = Number(state.upstreamCostUsd);
    if (costUsd > 0) facts.push(`费用 $${costUsd.toFixed(2)}`);
    const suffix = facts.length ? ` · ${facts.join(' · ')}` : '';
    return `${note ? `${note} · ` : ''}${source} ${shotVideoProgress(shot)}%${suffix}`;
  };
  const shotVideoFailureReason = (shot) => {
    const state = shotVideoProgressState(shot);
    return String(state.error || state.note || '服务方未返回具体原因').trim() || '服务方未返回具体原因';
  };

  const {
    resolveShotDuration,
    loadVideoBar,
    rememberVideoProvider,
    rememberVideoSettings,
    saveVideoBar,
    resetVideoBar,
    isTrueMentionVideoMode,
    ensureVideoSubmitModeSupported,
    videoSubmitPayload,
  } = createVideoBarRuntime({
    message,
    refs: { config: refs.config, videoBar, episodeId: refs.episodeId },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
      saveDefaults: (settings) => api.post('/api/config', { video: settings }),
    },
    watch,
  });

  // 「全局默认时长」同时是提交上限：镜头正文的时间码总长超过本次提交秒数时，内容会被静默截断。
  // 这里只负责给出提醒依据，真正的处理是让用户先「拆成两个 15s」。
  const shotDurationWarning = (shot) => {
    const settings = effectiveShotVideoSettings(shot);
    if (normalizeVideoProvider(settings.provider) === 'dreamina-agent') return null;
    const submitSeconds = allowedVideoDuration(settings.provider, settings.model, resolveShotDuration(shot));
    return shotDurationMismatch(String(shot?.body || ''), submitSeconds);
  };

  const {
    removeFromQueue,
    addToVideoQueue,
    pauseVideoQueue,
    clearVideoQueue,
    cancelVideoQueueStartTimer,
    scheduleVideoQueueProcessing,
    setVideoQueueProcessor,
  } = createVideoQueueActionsRuntime({
    message,
    refs: { queue: refs.videoQueue, shotStatus: refs.shotStatus, shotProgress: refs.shotProgress },
    helpers: {
      shotKey: helpers.shotVideoKey,
      resumeTracking: helpers.resumeShotTracking,
    },
    globals,
  });

  const {
    submitOneAndWait,
    buildShotSubmit,
    generateShotVideo,
    processVideoQueue,
    generateAllShotVideos,
    generateAllShotVideosSequential,
    stopSequentialGeneration,
    openRangeSequentialDialog,
    confirmRangeSequential,
    openVideoRangeDialog,
    confirmVideoRange,
  } = createVideoSubmitActionsRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      episodeId: refs.episodeId,
      videoBar,
      shotStatus: refs.shotStatus,
      shotVideos: refs.shotVideos,
      shotProgress: refs.shotProgress,
      queue: refs.videoQueue,
      batchRunning: batchVideoRunning,
      batchProgress: batchVideoProgress,
      progress: videoProgress,
      schedulerSlots,
      submitting,
      sequentialRunning,
      sequentialPendingCount,
      rangeDialog: rangeSeqDialog,
      videoRangeDialog,
      providerLabel: currentVideoProviderLabel,
    },
    helpers: {
      ensureSubmitModeSupported: ensureVideoSubmitModeSupported,
      shotElementTags: helpers.shotElementTags,
      shotOpenerFrame: helpers.shotOpenerFrame,
      shotOpenerFrameName: helpers.shotOpenerFrameName,
      buildShotPromptBody: helpers.buildShotPromptBody,
      resolveShotDuration,
      shotVideoSettings,
      shotVideoKey: helpers.shotVideoKey,
      shotVideoUrl: helpers.shotVideoUrl,
      shotVideoStatus: helpers.shotVideoStatus,
      videoSubmitPayload,
      providerLabelForSubmit: (submit) => videoProviderLabel(submit?.provider || videoBar.provider),
      resetShotVideo: helpers.resetShotVideo,
      cancelStartTimer: cancelVideoQueueStartTimer,
      scheduleQueueProcessing: scheduleVideoQueueProcessing,
      startPendingPoll: () => helpers.startPendingPoll(),
      syncShotVideosFromServer: helpers.syncShotVideosFromServer,
      findStoryboard: helpers.findStoryboard,
      currentShots: helpers.currentShots,
      parseShots: helpers.parseShots,
      progressByRatio: helpers.progressByRatio,
      stopProgressPulse: helpers.stopProgressPulse,
      setProgressState: helpers.setProgressState,
      startProgressPulse: helpers.startProgressPulse,
      hideProgressAfter: helpers.hideProgressAfter,
      setShotOpenerFrame: helpers.setShotOpenerFrame,
      saveScript: helpers.saveScript,
      isShotTrackingStopped: helpers.isShotTrackingStopped,
      resumeShotTracking: helpers.resumeShotTracking,
      recordGenerationBatch,
      beforeVideoSubmit: waitForVideoGuard,
    },
  });
  setVideoQueueProcessor(processVideoQueue);

  const {
    refreshXiaoyunqueAccounts,
    refreshXiaoyunqueCliStatus,
    refreshDreaminaCliStatus,
    refreshDreaminaAgentStatus,
    refreshLibtvCliStatus,
    refreshLibtvModels,
    waitSimpleJob,
  } = createVideoCliStatusRuntime({
    api,
    message,
    refs: {
      config: refs.config,
      xiaoyunqueCliStatus,
      dreaminaCliStatus,
      dreaminaAgentStatus,
      libtvCliStatus,
      libtvModelOptions,
      libtvModelsLoading,
    },
  });
  const addXiaoyunqueAccounts = createAddXiaoyunqueAccountsRuntime({
    api,
    message,
    refs: {
      config: refs.config,
      loading: xiaoyunqueAccountLoading,
      manualText: xiaoyunqueManualText,
      manualVisible: xiaoyunqueManualVisible,
    },
  });
  const deleteXiaoyunqueAccount = createDeleteXiaoyunqueAccountRuntime({
    api,
    message,
    refs: { config: refs.config, videoBar },
  });
  const installXiaoyunqueCli = createInstallXiaoyunqueCliRuntime({
    api,
    message,
    refs: { loading: xiaoyunqueAccountLoading },
    helpers: {
      infoTip: helpers.infoTip,
      waitJob: waitSimpleJob,
      refreshStatus: refreshXiaoyunqueCliStatus,
    },
  });
  const dreaminaCliRuntime = createDreaminaCliRuntime({
    api,
    message,
    refs: { loading: dreaminaCliLoading, status: dreaminaCliStatus },
    helpers: {
      infoTip: helpers.infoTip,
      waitJob: waitSimpleJob,
      refreshStatus: refreshDreaminaCliStatus,
      confirmLogout: helpers.confirmDreaminaLogout,
    },
  });
  const dreaminaAgentRuntime = createDreaminaAgentRuntime({
    api,
    message,
    refs: { config: refs.config, videoBar, loading: dreaminaAgentLoading, status: dreaminaAgentStatus },
  });
  const libtvCliRuntime = createLibtvCliRuntime({
    api,
    message,
    refs: { loading: libtvCliLoading, status: libtvCliStatus },
    helpers: {
      infoTip: helpers.infoTip,
      waitJob: waitSimpleJob,
      refreshStatus: refreshLibtvCliStatus,
      refreshModels: refreshLibtvModels,
      confirmLogout: helpers.confirmLibtvLogout,
    },
  });
  return {
    settingsVideoResolutionOptions,
    settingsVideoDurationRange,
    videoBar,
    videoBarResolutionOptions,
    videoBarDurationRange,
    videoBarApiModelOptions,
    currentVideoProviderLabel,
    currentVideoAccountSummary,
    submitting,
    batchVideoRunning,
    batchVideoProgress,
    videoProgress,
    schedulerSlots,
    recentVideoBatch,
    sequentialRunning,
    sequentialPendingCount,
    videoRangeDialog,
    rangeSeqDialog,
    videoGuard,
    cancelVideoGuard,
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
    resolveShotDuration,
    loadVideoBar,
    rememberVideoProvider,
    rememberVideoSettings,
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
    shotVideoProvider,
    effectiveShotVideoProvider,
    shotVideoDurationRange,
    shotDurationWarning,
    shotVideoModel,
    shotVideoAccountId,
    shotVideoModelOptions,
    shotVideoDefaultModelLabel,
    neowowAccountOptionLabel,
    neowowAutoAccountLabel,
    neowowEpisodeAccountLabel,
    setShotVideoProvider,
    setShotVideoModel,
    setShotVideoAccountId,
    hasShotVideoSettings,
    resetShotVideoSettings,
    shotVideoSettingsSummary,
    shotVideoAllowCreateModel,
    shotVideoProgress,
    shotVideoProgressText,
    shotVideoFailureReason,
    submitOneAndWait,
    buildShotSubmit,
    generateShotVideo,
    processVideoQueue,
    generateAllShotVideos,
    generateAllShotVideosSequential,
    stopSequentialGeneration,
    openRangeSequentialDialog,
    confirmRangeSequential,
    openVideoRangeDialog,
    confirmVideoRange,
    refreshXiaoyunqueAccounts,
    refreshXiaoyunqueCliStatus,
    refreshDreaminaCliStatus,
    refreshDreaminaAgentStatus,
    refreshLibtvCliStatus,
    refreshLibtvModels,
    addXiaoyunqueAccounts,
    deleteXiaoyunqueAccount,
    installXiaoyunqueCli,
    installDreaminaCli: dreaminaCliRuntime.install,
    loginDreaminaCli: dreaminaCliRuntime.login,
    logoutDreaminaCli: dreaminaCliRuntime.logout,
    loginDreaminaAgent: dreaminaAgentRuntime.login,
    applyDreaminaAgentSession: dreaminaAgentRuntime.applySession,
    refreshDreaminaAgentAccounts: dreaminaAgentRuntime.refreshAccounts,
    selectDreaminaAgentAccount: dreaminaAgentRuntime.selectAccount,
    addDreaminaAgentSessionAccount: dreaminaAgentRuntime.addSessionAccount,
    addDreaminaAgentBrowserAccount: dreaminaAgentRuntime.addBrowserAccount,
    deleteDreaminaAgentAccount: dreaminaAgentRuntime.deleteAccount,
    installLibtvCli: libtvCliRuntime.install,
    loginLibtvCli: libtvCliRuntime.login,
    logoutLibtvCli: libtvCliRuntime.logout,
    checkLibtvCliUpdate: libtvCliRuntime.checkUpdate,
  };
}
