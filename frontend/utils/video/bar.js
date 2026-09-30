import {
  allowedVideoDuration,
  allowedVideoResolution,
  normalizeVideoModeForProvider,
  normalizeVideoProvider,
  videoBarStateFromSettings,
  videoModelForProvider,
  videoSettingsFromBar,
} from './core.js';

export function isTrueMentionVideoMode(mode) {
  return mode === 'mention' || mode === 'mention_label';
}

export function videoSubmitPayloadFromBar(videoBar = {}, extra = {}) {
  const provider = normalizeVideoProvider(videoBar.provider);
  const model = videoModelForProvider(videoBar, provider);
  return {
    ...extra,
    provider,
    model: provider === 'dreamina-agent' ? '' : model,
    session: provider === 'dreamina-cli' ? videoBar.dreaminaSession : undefined,
    aspectRatio: provider === 'dreamina-agent' ? '16:9' : videoBar.aspectRatio,
    resolution: provider === 'dreamina-agent' ? '720p' : allowedVideoResolution(provider, model, videoBar.resolution),
    duration: allowedVideoDuration(provider, model, extra.duration),
    comfyuiWorkflowPreset: provider === 'comfyui' ? (videoBar.comfyuiWorkflowPreset || 'u09') : undefined,
    accountId: provider === 'xiaoyunque'
      ? videoBar.xiaoyunqueAccountId
      : (provider === 'dreamina-agent'
        ? videoBar.dreaminaAgentAccountId
        : (provider === 'neowow' ? videoBar.neowowAccountId : '')),
    ...(provider === 'dreamina-agent'
      ? {
        dreaminaAgentPromptPreset: videoBar.dreaminaAgentPromptPreset === 'fast' ? 'fast' : 'standard',
        dreaminaAgentShotIntervalSeconds: Math.max(10, Math.min(3600, Math.floor(Number(videoBar.dreaminaAgentShotIntervalSeconds) || 80))),
      }
      : {}),
  };
}

export function resolveShotDurationSeconds(shot, fallbackDuration = 15, maxDuration = fallbackDuration) {
  const match = String(shot?.duration || '').match(/(\d+(?:\.\d+)?)/);
  let seconds = match ? Math.round(parseFloat(match[1])) : Number(fallbackDuration) || 15;
  if (!Number.isFinite(seconds)) seconds = Number(fallbackDuration) || 15;
  const maximum = Math.max(5, Math.min(500, Number(maxDuration) || Number(fallbackDuration) || 15));
  return Math.min(maximum, Math.max(4, seconds));
}

export function createVideoBarRuntime({ message, refs = {}, helpers = {}, watch } = {}) {
  let providerPersistQueue = Promise.resolve();
  let mentionModeTip = null;
  const normalizedSettingsSignature = (settings = {}) => {
    const { neowowAccountId: _episodeAccountId, ...normalized } = videoSettingsFromBar(settings);
    return JSON.stringify(normalized);
  };
  const configDefaultState = () => videoBarStateFromSettings(refs.config.video);
  const closeMentionModeTip = () => {
    mentionModeTip?.close?.();
    mentionModeTip = null;
  };
  const loadVideoBar = () => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const episodeSettings = storyboard?.videoSettings || {};
    const provider = normalizeVideoProvider(refs.config.video.provider || episodeSettings.provider);
    const episodeProvider = episodeSettings.provider
      ? normalizeVideoProvider(episodeSettings.provider)
      : provider;
    const resolution = ['updream', 'neowow'].includes(provider) && episodeProvider !== provider
      ? refs.config.video.resolution
      : episodeSettings.resolution;
    Object.assign(refs.videoBar, videoBarStateFromSettings({
      ...episodeSettings,
      // The engine is a global last-used preference. Episode settings still own
      // model, ratio and account details. A resolution saved for another engine
      // must not override UpDream's 480p default.
      provider,
      resolution,
    }, refs.config.video));
  };
  watch?.(() => normalizedSettingsSignature(configDefaultState()), () => {
    // Workspace edits write the bar back into config. In that direction the two
    // states already match, so reloading would resurrect an older episode override.
    if (normalizedSettingsSignature(configDefaultState()) === normalizedSettingsSignature(refs.videoBar)) return;
    loadVideoBar();
  });
  const rememberVideoSettings = () => {
    const settings = videoSettingsFromBar(refs.videoBar);
    const { neowowAccountId: _episodeNeowowAccountId, ...globalSettings } = settings;
    Object.assign(refs.config.video, globalSettings);
    providerPersistQueue = providerPersistQueue
      .catch(() => {})
      .then(async () => {
        const result = helpers.saveDefaults
          ? await helpers.saveDefaults(settings)
          : await helpers.saveProvider?.(settings.provider);
        if (result && result.ok === false) throw new Error(result.error || '保存视频设置失败');
      })
      .catch((error) => {
        message.warning(`视频设置已切换，但自动保存失败：${error?.message || error}`);
      });
    return providerPersistQueue;
  };
  const rememberVideoProvider = (provider) => {
    const normalized = normalizeVideoProvider(provider);
    closeMentionModeTip();
    refs.videoBar.provider = normalized;
    if (['updream', 'neowow'].includes(normalized)) {
      // Vue updates v-model before @change runs, so the previous provider is no
      // longer available here. Entering UpDream must always start at its 480p default.
      refs.videoBar.resolution = allowedVideoResolution(
        normalized,
        videoModelForProvider(refs.videoBar, normalized),
        '',
      );
    }
    if (normalized === 'neowow') refs.config.video.duration = 15;
    return rememberVideoSettings();
  };
  return {
    resolveShotDuration: (shot) => resolveShotDurationSeconds(
      shot,
      refs.config.video.duration,
      refs.config.video.duration,
    ),
    loadVideoBar,
    rememberVideoProvider,
    rememberVideoSettings,
    saveVideoBar: () => {
      const storyboard = helpers.findStoryboard(refs.episodeId.value);
      if (!storyboard) return;
      storyboard.videoSettings = videoSettingsFromBar(refs.videoBar);
      helpers.saveScript();
      message.success('已应用到本集');
    },
    resetVideoBar: () => {
      const storyboard = helpers.findStoryboard(refs.episodeId.value);
      if (!storyboard) return;
      storyboard.videoSettings = {};
      helpers.saveScript();
      loadVideoBar();
      message.success('已重置本集视频设置为全局默认');
    },
    isTrueMentionVideoMode: (mode = refs.videoBar.videoMode) => isTrueMentionVideoMode(mode),
    ensureVideoSubmitModeSupported: ({ notify = true } = {}) => {
      if (refs.videoBar.provider === 'dreamina-cli' && isTrueMentionVideoMode(refs.videoBar.videoMode)) {
        const text = '即梦 CLI 会通过全能参考上传素材，并在提示词前使用 @Image1/@Audio1 槽位说明。';
        if (notify) {
          closeMentionModeTip();
          mentionModeTip = message.info(text);
        }
      } else if (refs.videoBar.provider === 'dreamina-agent') {
        const text = '即梦 Agent 会先把本地素材保存为官网主体，再通过 @ 选择并验证实体标签后提交。';
        if (notify) {
          closeMentionModeTip();
          mentionModeTip = message.info(text);
        }
      } else if (refs.videoBar.provider === 'libtv-cli' && isTrueMentionVideoMode(refs.videoBar.videoMode)) {
        const text = 'LibTV CLI 会把素材上传为画布节点，并使用 {{Node "节点名"}} 绑定人物和参考素材。';
        if (notify) {
          closeMentionModeTip();
          mentionModeTip = message.info(text);
        }
      } else if (refs.videoBar.provider === 'neowow') {
        const text = 'Neowow 会把图片、视频和 MP3 音频上传到画布，并用 @图片/@视频/@音频结构化绑定后提交。';
        if (notify) {
          closeMentionModeTip();
          mentionModeTip = message.info(text);
        }
      } else {
        closeMentionModeTip();
      }
      return true;
    },
    videoSubmitPayload: (extra = {}) => videoSubmitPayloadFromBar(refs.videoBar, extra),
  };
}
