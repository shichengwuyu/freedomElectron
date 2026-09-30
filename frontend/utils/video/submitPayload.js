import {
  allowedVideoDuration,
  allowedVideoResolution,
  effectiveVideoSettings,
  normalizeVideoModeForProvider,
  normalizeVideoProvider,
} from './core.js';

export function videoReferenceImagesFromTags(tags = []) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => tag?.hasImage)
    .map((tag) => ({
      cat: tag.cat,
      imageBase: tag.imageBase || tag.name,
      mentionName: tag.mentionName || tag.name,
    }));
}

export function videoAudioRefsFromTags(tags = []) {
  const seen = new Set();
  const refs = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (tag?.cat !== 'character' || !tag.hasVoiceAudio) continue;
    const characterName = tag.voiceOwnerName || tag.name;
    if (!characterName || seen.has(characterName)) continue;
    seen.add(characterName);
    refs.push({ characterName, mentionName: characterName });
  }
  return refs;
}

export function videoAudioRefsFromAudioTags(audioTags = []) {
  const seen = new Set();
  const refs = [];
  for (const tag of Array.isArray(audioTags) ? audioTags : []) {
    const characterName = String(tag?.name || tag?.voiceOwnerName || '').trim();
    if (!characterName || seen.has(characterName)) continue;
    seen.add(characterName);
    refs.push({ characterName, mentionName: characterName });
  }
  return refs;
}

export function buildShotVideoSubmit({ shot, tags = [], audioTags = null, opener = null, openerFrameName = '', prompt = '', videoBar = {}, shotVideoSettings = {}, duration = 5, videoRefs = [] } = {}) {
  const refs = videoReferenceImagesFromTags(tags);
  const settings = effectiveVideoSettings(videoBar, shotVideoSettings);
  const provider = normalizeVideoProvider(settings.provider);
  const cleanPrompt = provider === 'dreamina-agent'
    ? String(shot?.body ?? '')
    : String(prompt || '').trim();
  if (!cleanPrompt) return null;
  // 每镜的参考视频路径（支持视频参考的模型会把它当 @VideoN 传下去）。
  const refVideoPaths = (Array.isArray(videoRefs) ? videoRefs : [])
    .map((item) => (typeof item === 'string' ? item : (item?.path || item?.filePath || '')))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return {
    shotNo: shot?.no,
    prompt: cleanPrompt,
    refs,
    ...(refVideoPaths.length ? { videoRefs: refVideoPaths } : {}),
    audioRefs: audioTags ? videoAudioRefsFromAudioTags(audioTags) : videoAudioRefsFromTags(tags),
    openerFrameFrom: opener ? opener.fromShotNo : undefined,
    openerFrameName: openerFrameName || undefined,
    provider,
    model: provider === 'dreamina-agent' ? '' : settings.model,
    session: provider === 'dreamina-cli' ? settings.dreaminaSession : undefined,
    accountId: provider === 'xiaoyunque'
      ? settings.xiaoyunqueAccountId
      : (provider === 'dreamina-agent'
        ? settings.dreaminaAgentAccountId
        : (provider === 'neowow' ? settings.neowowAccountId : '')),
    aspectRatio: provider === 'dreamina-agent' ? '16:9' : settings.aspectRatio,
    resolution: provider === 'dreamina-agent' ? '720p' : allowedVideoResolution(provider, settings.model, settings.resolution),
    duration: allowedVideoDuration(provider, settings.model, duration),
    videoMode: provider === 'dreamina-agent' ? 'mention' : normalizeVideoModeForProvider(provider, settings.videoMode),
    ...(provider === 'dreamina-agent'
      ? {
        dreaminaAgentPromptPreset: settings.dreaminaAgentPromptPreset,
        dreaminaAgentShotIntervalSeconds: settings.dreaminaAgentShotIntervalSeconds,
      }
      : {}),
  };
}

export function createBuildShotSubmitRuntime({ refs = {}, helpers = {} } = {}) {
  return (shot, context = {}) => {
    const tags = helpers.shotElementTags(shot);
    const audioTags = helpers.shotAudioTags?.(shot) || null;
    const hasOpenerOverride = Object.prototype.hasOwnProperty.call(context, 'opener');
    const opener = hasOpenerOverride
      ? context.opener
      : helpers.shotOpenerFrame(shot.no, context.episodeId);
    const openerFrameName = opener
      ? (context.openerFrameName || helpers.shotOpenerFrameName(shot.no, context.episodeId))
      : '';
    const prompt = helpers.buildShotPromptBody(shot, openerFrameName);
    const refPath = String(shot?.refVideoPath || '').trim();
    return buildShotVideoSubmit({
      shot,
      tags,
      audioTags,
      opener,
      openerFrameName,
      prompt,
      videoRefs: refPath ? [refPath] : [],
      videoBar: refs.videoBar,
      shotVideoSettings: helpers.shotVideoSettings?.(shot) || shot?.videoSettings || {},
      duration: helpers.resolveShotDuration(shot),
    });
  };
}
