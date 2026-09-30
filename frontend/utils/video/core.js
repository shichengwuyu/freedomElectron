import { libtvModelNames, videoApiModelOptions, videoResolutionOptions } from '../../constants/options.js';

// 内置视频渠道 1 = shafu.it.com、渠道 2 = llm.chre3.com（下面这组常量只服务这两条渠道）。
export const DEFAULT_VIDEO_API_BASE_URL = 'https://shafu.it.com/v1';
export const DEFAULT_BUILT_IN_VIDEO_API_MODEL = 'sd-720p';
export const SECOND_BUILT_IN_VIDEO_API_BASE_URL = 'https://llm.chre3.com/v1';
export const SECOND_BUILT_IN_VIDEO_API_MODEL = 'sd2-c8';
// 网关(api.xiaoyxiao.xyz)侧真实注册的视频模型名。new-api 按模型名精确匹配渠道，
// 名字用错会报 "No available channel for model <name> under group <group>"。
// ⚠️ sd-720p 属于 shafu.it.com 渠道的命名体系，不能拿去请求网关。
export const DEFAULT_VIDEO_GATEWAY_API_BASE_URL = 'https://api.xiaoyxiao.xyz/v1';
export const GATEWAY_VIDEO_API_MODELS = [
  'seedance-2.0-mini-deal',
  'seedance-2.0-deal',
  'seedance-2.5-deal',
  'seedance-2.5-pro',
  'doubao-seedance-2.5',
  'dreamina-seedance-2.0',
  'dreamina-seedance-2.0-fast',
  'dreamina-seedance-2.0-mini',
  'dreamina-seedance-2.5',
  'jimeng-seedance-2.5',
  'minimax-h3-720p',
  'minimax-h3-max',
  'wan3.0-video',
];
// 默认取列表第一个：seedance 2.0 的 mini 特价版，成本最低且已在本机验证可用。
export const DEFAULT_VIDEO_GATEWAY_API_MODEL = GATEWAY_VIDEO_API_MODELS[0];
export const BUILT_IN_VIDEO_CHANNEL_1 = 'channel1';
export const BUILT_IN_VIDEO_CHANNEL_2 = 'channel2';
export const VIDEO_API_PROTOCOL_OPENAI = 'openai';
export const VIDEO_API_PROTOCOL_NEW_API = 'newapi';
export const VIDEO_API_PROTOCOL_FEITUO = 'feituo';
export const DEFAULT_LIBTV_MODEL = 'Seedance 2.0 VIP';
const LIBTV_MODEL_SET = new Set(libtvModelNames);

export function normalizeLibtvModelName(value, fallback = DEFAULT_LIBTV_MODEL) {
  const model = String(value || '').trim();
  if (model === 'Seedance 2.0') return DEFAULT_LIBTV_MODEL;
  if (LIBTV_MODEL_SET.has(model)) return model;
  const normalizedFallback = String(fallback || '').trim();
  return LIBTV_MODEL_SET.has(normalizedFallback) ? normalizedFallback : DEFAULT_LIBTV_MODEL;
}

export function isBuiltInVideoApiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return ['shafu.it.com', 'llm.chre3.com'].includes(url.hostname.toLowerCase())
      && (path === '' || path === '/v1' || path === '/v1/videos' || path === '/v1/video/generations');
  } catch {
    return false;
  }
}

export function isBuiltInVideoApiChannel(channel = {}) {
  if (typeof channel?.builtInChannel === 'string' && channel.builtInChannel.trim()) return true;
  if (typeof channel?.builtIn === 'boolean') return channel.builtIn;
  return isBuiltInVideoApiBaseUrl(channel?.apiBaseUrl);
}

export function isSecondBuiltInVideoApiChannel(channel = {}) {
  return channel?.builtInChannel === BUILT_IN_VIDEO_CHANNEL_2
    || (channel?.builtIn !== false && /llm\.chre3\.com/i.test(String(channel?.apiBaseUrl || '')));
}

// 是否为内置网关(api.xiaoyxiao.xyz)的视频渠道：它的模型候选与 shafu/chre3 两条内置渠道完全不同。
export function isGatewayVideoApiChannel(channel = {}) {
  try {
    return new URL(String(channel?.apiBaseUrl || '').trim()).hostname.toLowerCase() === 'api.xiaoyxiao.xyz';
  } catch {
    return false;
  }
}

export function normalizeVideoApiProtocol(value, baseUrl = '') {
  const protocol = String(value || '').trim().toLowerCase();
  if (protocol === VIDEO_API_PROTOCOL_NEW_API) return VIDEO_API_PROTOCOL_NEW_API;
  if (protocol === VIDEO_API_PROTOCOL_FEITUO) return VIDEO_API_PROTOCOL_FEITUO;
  if (protocol === VIDEO_API_PROTOCOL_OPENAI) return VIDEO_API_PROTOCOL_OPENAI;
  return isBuiltInVideoApiBaseUrl(baseUrl) ? VIDEO_API_PROTOCOL_NEW_API : VIDEO_API_PROTOCOL_OPENAI;
}

export function normalizeVideoApiModelNames(values = []) {
  const names = Array.isArray(values) ? values : [];
  return [...new Set(names.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function activeVideoApiChannel(video = {}) {
  const channels = Array.isArray(video.apiChannels) ? video.apiChannels : [];
  return channels.find((channel) => channel.id === video.apiActiveChannelId)
    || channels.find((channel) => channel.enabled !== false)
    || channels[0]
    || {
      apiBaseUrl: video.apiBaseUrl || '',
      apiProtocol: normalizeVideoApiProtocol(video.apiProtocol, video.apiBaseUrl),
      apiModel: video.apiModel || '',
      apiModels: [],
    };
}

export function videoApiModelOptionsForChannel(channel = {}, extraModels = []) {
  const builtIn = isBuiltInVideoApiChannel(channel);
  const names = isSecondBuiltInVideoApiChannel(channel)
    ? [SECOND_BUILT_IN_VIDEO_API_MODEL]
    : (isGatewayVideoApiChannel(channel)
      ? [...GATEWAY_VIDEO_API_MODELS]
      : (builtIn ? videoApiModelOptions.map((option) => option.value) : []));
  names.push(...normalizeVideoApiModelNames(channel.apiModels));
  names.push(...normalizeVideoApiModelNames(extraModels));
  return normalizeVideoApiModelNames(names).map((value) => ({ label: value, value }));
}

export function videoApiModelOptionsForConfig(video = {}, extraModels = []) {
  return videoApiModelOptionsForChannel(activeVideoApiChannel(video), extraModels);
}

export function normalizeVideoProvider(provider) {
  if (provider === 'video-api') return 'video-api';
  if (provider === 'neowow') return 'neowow';
  if (provider === 'comfyui') return 'comfyui';
  if (provider === 'updream') return 'updream';
  if (provider === 'libtv-cli') return 'libtv-cli';
  if (provider === 'dreamina-agent') return 'dreamina-agent';
  return provider === 'xiaoyunque' ? 'xiaoyunque' : 'dreamina-cli';
}

export function normalizeVideoResolution(resolution) {
  const value = String(resolution || '').trim().toLowerCase();
  return ['480p', '720p', '768p', '1080p', '2k', '4k'].includes(value) ? value : '720p';
}

function normalizedVideoModelId(model) {
  return String(model || '').trim().toLowerCase();
}

function isSeedance25Model(model) {
  return ['seedance 2.5', 'sed2-5', 'doubao-seedance-2-5-260628'].includes(normalizedVideoModelId(model));
}

function isWan30Model(model) {
  return [
    'wan 3.0',
    'wan 3.0 prime',
    'wan-3.0',
    'wan-3.0-prime',
    'wan_3.0',
    'wan_3.0_prime',
    'wan3.0',
    'wan3.0-video',
    'wan3.0-prime',
    'wanx3.0',
    'wanx3.0-prime',
  ].includes(normalizedVideoModelId(model));
}

function isMinimaxH3Model(model) {
  return ['minimax h3', 'minimax_h3', 'hailuo-h3', 'minimax-h3', 'h3'].includes(normalizedVideoModelId(model));
}

export function videoResolutionOptionsFor(provider, model) {
  const normalizedProvider = normalizeVideoProvider(provider);
  if (normalizedProvider === 'dreamina-agent') {
    return videoResolutionOptions.filter((item) => item.value === '720p');
  }
  if (normalizedProvider === 'updream') {
    const modelId = normalizedVideoModelId(model);
    const allowed = isWan30Model(model)
      ? new Set(['480p', '720p', '1080p'])
      : (modelId === 'hailuo-h3'
      ? new Set(['768p', '2k'])
      : (modelId === 'sed2-5'
        ? new Set(['480p', '720p'])
        : (modelId === 'sed2'
          ? new Set(['480p', '720p', '1080p', '4k'])
          : new Set(['480p', '720p', '1080p', '2k', '4k']))));
    return videoResolutionOptions.filter((item) => allowed.has(item.value));
  }
  if (normalizedProvider === 'neowow') {
    const modelId = normalizedVideoModelId(model);
    const allowed = isWan30Model(model)
      ? new Set(['480p', '720p', '1080p'])
      : (modelId === 'minimax-h3'
      ? new Set(['768p', '2k'])
      : (modelId === 'neo-video-2-0'
        ? new Set(['480p', '720p', '1080p', '4k'])
        : new Set(['480p', '720p'])));
    return videoResolutionOptions.filter((item) => allowed.has(item.value));
  }
  if (normalizedProvider === 'comfyui') {
    return videoResolutionOptions.filter((item) => ['768p', '2k'].includes(item.value));
  }
  if (normalizedProvider === 'xiaoyunque') {
    if (isMinimaxH3Model(model)) {
      return videoResolutionOptions.filter((item) => ['768p', '2k'].includes(item.value));
    }
    if (isWan30Model(model)) {
      return videoResolutionOptions.filter((item) => ['480p', '720p', '1080p'].includes(item.value));
    }
    return videoResolutionOptions.filter((item) => ['480p', '720p', '1080p'].includes(item.value));
  }
  if (normalizedProvider === 'libtv-cli') {
    if (isMinimaxH3Model(model)) {
      return videoResolutionOptions.filter((item) => item.value === '768p' || item.value === '2k');
    }
    if (isWan30Model(model)) {
      return videoResolutionOptions.filter((item) => ['480p', '720p', '1080p'].includes(item.value));
    }
    return videoResolutionOptions.filter((item) => item.value === '480p' || item.value === '720p');
  }
  if (normalizedProvider === 'dreamina-cli') {
    const normalizedModel = String(model || '').trim().toLowerCase();
    if (normalizedModel === 'seedance2.5') {
      return videoResolutionOptions.filter((item) => item.value === '480p' || item.value === '720p');
    }
    if (normalizedModel === 'seedance2.0_vip') {
      return videoResolutionOptions.filter((item) => ['720p', '1080p', '4k'].includes(item.value));
    }
    return videoResolutionOptions.filter((item) => item.value === '720p');
  }
  if (normalizedProvider === 'video-api') {
    // 480p：部分上游（如 seedance deal 系列）720p 只支持 5~12s，480p 才能到 15s
    return videoResolutionOptions.filter((item) => ['480p', '720p'].includes(item.value));
  }
  return videoResolutionOptions.filter((item) => item.value === '720p' || item.value === '1080p');
}

export function allowedVideoResolution(provider, model, resolution) {
  const value = String(resolution || '').trim().toLowerCase();
  const normalized = ['480p', '720p', '768p', '1080p', '2k', '4k'].includes(value) ? value : '';
  const options = videoResolutionOptionsFor(provider, model);
  if (options.some((item) => item.value === normalized)) return normalized;
  const fallback = isMinimaxH3Model(model)
    ? '2k'
    : (['xiaoyunque', 'updream', 'neowow'].includes(normalizeVideoProvider(provider)) ? '480p' : (normalizeVideoProvider(provider) === 'comfyui' ? '2k' : '720p'));
  return options.some((item) => item.value === fallback) ? fallback : (options[0]?.value || fallback);
}

export function videoDurationRangeFor(provider, model) {
  const normalizedProvider = normalizeVideoProvider(provider);
  if (normalizedProvider === 'dreamina-agent') return { min: 15, max: 15 };
  if (normalizedProvider === 'dreamina-cli') {
    return String(model || '').trim().toLowerCase() === 'seedance2.5'
      ? { min: 4, max: 30 }
      : { min: 4, max: 15 };
  }
  if (['xiaoyunque', 'updream', 'neowow', 'libtv-cli'].includes(normalizedProvider)) {
    if (isWan30Model(model)) return { min: 2, max: 30 };
    if (isSeedance25Model(model)) return { min: 4, max: 30 };
    if (isMinimaxH3Model(model)) return { min: 5, max: 15 };
    return { min: 4, max: 15 };
  }
  if (normalizedProvider === 'comfyui') return { min: 5, max: 15 };
  // video-api 渠道的模型时长要求由网关决定（实测有只收 30 秒的模型），这里放开到 30，
  // 具体取值仍由「默认时长」设置和镜头卡片上的时长决定。
  if (normalizedProvider === 'video-api') return { min: 5, max: 30 };
  return { min: 3, max: 15 };
}

export function allowedVideoDuration(provider, model, duration, fallback = 5) {
  const range = videoDurationRangeFor(provider, model);
  const value = Number(duration);
  const fallbackValue = Number(fallback);
  const seconds = Number.isFinite(value)
    ? value
    : (Number.isFinite(fallbackValue) ? fallbackValue : 5);
  return Math.min(range.max, Math.max(range.min, Math.round(seconds)));
}

export function normalizeVideoModeForProvider(provider, mode) {
  const value = String(mode || '').trim();
  if (value === 'label' || value === 'mention_label') return 'label';
  return 'mention';
}

export function videoModelForProvider(settings = {}, provider = settings.provider) {
  const normalized = normalizeVideoProvider(provider);
  if (normalized === 'dreamina-agent') return '';
  if (normalized === 'xiaoyunque') return String(settings.xiaoyunqueModel || settings.model || '').trim();
  if (normalized === 'updream') return String(settings.updreamModel || settings.model || '').trim();
  if (normalized === 'neowow') return String(settings.neowowModel || settings.model || '').trim();
  if (normalized === 'comfyui') return 'MiniMax-H3';
  if (normalized === 'libtv-cli') return normalizeLibtvModelName(settings.libtvModel || settings.model);
  if (normalized === 'video-api') return String(settings.apiModel || settings.model || '').trim();
  return String(settings.dreaminaModel ?? settings.model ?? '').trim();
}

export function normalizeDreaminaAgentPromptPreset(value) {
  return String(value || '').trim().toLowerCase() === 'fast' ? 'fast' : 'standard';
}

export function normalizeDreaminaAgentShotIntervalSeconds(value) {
  const seconds = Math.floor(Number(value) || 80);
  return Math.max(10, Math.min(3600, seconds));
}

export function effectiveVideoSettings(videoBar = {}, shotSettings = {}) {
  const provider = normalizeVideoProvider(shotSettings.provider || videoBar.provider);
  const barProvider = normalizeVideoProvider(videoBar.provider);
  const explicitModel = String(shotSettings.model ?? '').trim();
  const baseModel = videoModelForProvider(videoBar, provider);
  const model = provider === 'dreamina-agent' ? '' : (explicitModel || baseModel);
  const dreaminaModel = provider === 'dreamina-cli' ? model : (videoBar.dreaminaModel ?? '');
  return {
    provider,
    model,
    xiaoyunqueModel: provider === 'xiaoyunque' ? model : videoBar.xiaoyunqueModel,
    updreamModel: provider === 'updream' ? model : videoBar.updreamModel,
    neowowModel: provider === 'neowow' ? model : videoBar.neowowModel,
    comfyuiModel: provider === 'comfyui' ? model : (videoBar.comfyuiModel || 'MiniMax-H3'),
    comfyuiWorkflowPreset: provider === 'comfyui'
      ? (shotSettings.comfyuiWorkflowPreset || videoBar.comfyuiWorkflowPreset || 'u09')
      : (videoBar.comfyuiWorkflowPreset || 'u09'),
    libtvModel: provider === 'libtv-cli' ? model : videoBar.libtvModel,
    dreaminaModel,
    apiModel: provider === 'video-api' ? model : videoBar.apiModel,
    dreaminaSession: provider === 'dreamina-cli'
      ? (shotSettings.session ?? videoBar.dreaminaSession)
      : videoBar.dreaminaSession,
    aspectRatio: provider === 'dreamina-agent' ? '16:9' : (shotSettings.aspectRatio || videoBar.aspectRatio),
    resolution: allowedVideoResolution(
      provider,
      model,
      provider === 'dreamina-agent' ? '720p' : (shotSettings.resolution || (provider === barProvider ? videoBar.resolution : '')),
    ),
    videoMode: normalizeVideoModeForProvider(provider, shotSettings.videoMode || videoBar.videoMode),
    xiaoyunqueAccountId: provider === 'xiaoyunque'
      ? (shotSettings.accountId || videoBar.xiaoyunqueAccountId || '')
      : '',
    dreaminaAgentAccountId: provider === 'dreamina-agent'
      ? (shotSettings.accountId || videoBar.dreaminaAgentAccountId || '')
      : '',
    neowowAccountId: provider === 'neowow'
      ? (shotSettings.accountId || videoBar.neowowAccountId || '')
      : '',
    dreaminaAgentPromptPreset: normalizeDreaminaAgentPromptPreset(
      shotSettings.dreaminaAgentPromptPreset || videoBar.dreaminaAgentPromptPreset,
    ),
    dreaminaAgentShotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(
      shotSettings.dreaminaAgentShotIntervalSeconds || videoBar.dreaminaAgentShotIntervalSeconds,
    ),
  };
}

export function normalizeDreaminaSession(value, fallback = '0') {
  const raw = String(value ?? '');
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 999) return String(numeric);
  }
  const fallbackRaw = String(fallback ?? '');
  if (/^\d+$/.test(fallbackRaw)) {
    const numericFallback = Number(fallbackRaw);
    if (Number.isSafeInteger(numericFallback) && numericFallback >= 0 && numericFallback <= 999) return String(numericFallback);
  }
  return '0';
}

export function videoBarStateFromSettings(settings = {}, defaults = {}) {
  const provider = normalizeVideoProvider(settings.provider || defaults.provider);
  const dreaminaModel = settings.dreaminaModel ?? defaults.dreaminaModel ?? '';
  const xiaoyunqueModel = settings.xiaoyunqueModel || defaults.xiaoyunqueModel || 'Seedance_2.0_mini_lite';
  const updreamModel = settings.updreamModel || defaults.updreamModel || 'sed2-fast';
  const neowowModel = settings.neowowModel || defaults.neowowModel || 'neo-video-2-0-fast';
  const libtvModel = normalizeLibtvModelName(settings.libtvModel || defaults.libtvModel);
  const apiModel = settings.apiModel ?? defaults.apiModel ?? '';
  const providerModel = videoModelForProvider({ xiaoyunqueModel, updreamModel, neowowModel, libtvModel, dreaminaModel, apiModel }, provider);
  return {
    provider,
    xiaoyunqueModel,
    updreamModel,
    neowowModel,
    comfyuiModel: 'MiniMax-H3',
    comfyuiWorkflowPreset: settings.comfyuiWorkflowPreset || defaults.comfyuiWorkflowPreset || 'u09',
    libtvModel,
    dreaminaModel,
    apiModel,
    dreaminaSession: normalizeDreaminaSession(settings.dreaminaSession, defaults.dreaminaSession),
    aspectRatio: provider === 'dreamina-agent' ? '16:9' : (settings.aspectRatio || defaults.aspectRatio || '16:9'),
    resolution: allowedVideoResolution(provider, providerModel, settings.resolution || defaults.resolution),
    videoMode: provider === 'dreamina-agent'
      ? 'mention'
      : normalizeVideoModeForProvider(
        provider,
        settings.videoMode || (settings.useNameLabel === true ? 'label' : defaults.videoMode || 'mention')
      ),
    xiaoyunqueAccountId: settings.xiaoyunqueAccountId || defaults.xiaoyunqueAccountId || '',
    dreaminaAgentAccountId: settings.dreaminaAgentAccountId || defaults.dreaminaAgentAccountId || '',
    // Empty means automatic distribution. The account selected in settings is
    // an administration default and must not silently disable auto assignment.
    neowowAccountId: settings.neowowAccountId || '',
    dreaminaAgentPromptPreset: normalizeDreaminaAgentPromptPreset(
      settings.dreaminaAgentPromptPreset || defaults.dreaminaAgentPromptPreset,
    ),
    dreaminaAgentShotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(
      settings.dreaminaAgentShotIntervalSeconds || defaults.dreaminaAgentShotIntervalSeconds,
    ),
  };
}

export function videoSettingsFromBar(videoBar = {}) {
  const provider = normalizeVideoProvider(videoBar.provider);
  const dreaminaModel = videoBar.dreaminaModel ?? '';
  const providerModel = videoModelForProvider(videoBar, provider);
  return {
    provider,
    xiaoyunqueModel: videoBar.xiaoyunqueModel,
    updreamModel: videoBar.updreamModel,
    neowowModel: videoBar.neowowModel,
    comfyuiModel: videoBar.comfyuiModel || 'MiniMax-H3',
    comfyuiWorkflowPreset: videoBar.comfyuiWorkflowPreset || 'u09',
    libtvModel: videoBar.libtvModel,
    dreaminaModel,
    apiModel: videoBar.apiModel,
    dreaminaSession: videoBar.dreaminaSession,
    aspectRatio: videoBar.aspectRatio,
    resolution: allowedVideoResolution(provider, providerModel, videoBar.resolution),
    videoMode: normalizeVideoModeForProvider(provider, videoBar.videoMode),
    xiaoyunqueAccountId: videoBar.xiaoyunqueAccountId,
    dreaminaAgentAccountId: videoBar.dreaminaAgentAccountId,
    neowowAccountId: videoBar.neowowAccountId || '',
    dreaminaAgentPromptPreset: normalizeDreaminaAgentPromptPreset(videoBar.dreaminaAgentPromptPreset),
    dreaminaAgentShotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(videoBar.dreaminaAgentShotIntervalSeconds),
  };
}

export function videoProviderLabel(provider) {
  const normalized = normalizeVideoProvider(provider);
  if (normalized === 'dreamina-agent') return '即梦 Agent';
  if (normalized === 'xiaoyunque') return '小云雀';
  if (normalized === 'updream') return 'UpDream';
  if (normalized === 'neowow') return 'Neowow';
  if (normalized === 'comfyui') return 'ComfyUI U09/U07';
  if (normalized === 'libtv-cli') return 'LibTV CLI';
  return normalized === 'video-api' ? '视频 API' : '即梦 CLI';
}

export function videoAccountSummary({ provider, accounts = [], selectedAccountId = '', apiHasKey = false, apiKey = '', updreamHasToken = false, updreamAccessToken = '', neowowHasToken = false, neowowToken = '', comfyuiBaseUrl = '', comfyuiWorkflowPreset = 'u09', dreaminaInstalled = false, dreaminaAuthenticated = false, dreaminaCreditBalance = null, dreaminaAgentChecked = false, dreaminaAgentRunning = false, dreaminaAgentAuthenticated = false, libtvInstalled = false, libtvAuthenticated = false, libtvAccountName = '', libtvProjectUuid = '' } = {}) {
  const normalized = normalizeVideoProvider(provider);
  if (normalized === 'dreamina-agent') {
    const item = (Array.isArray(accounts) ? accounts : []).find((account) => account.id === selectedAccountId);
    const name = item?.name || '未选择账号';
    if (dreaminaAgentAuthenticated) return `${name} · 已登录`;
    if (dreaminaAgentRunning) return `${name} · 等待网页登录`;
    return dreaminaAgentChecked ? `${name} · 未登录` : `${name} · 未检测`;
  }
  if (normalized === 'updream') {
    return (updreamHasToken || (updreamAccessToken && !String(updreamAccessToken).includes('****')))
      ? 'UpDream Token 已配置'
      : '未配置 UpDream Token';
  }
  if (normalized === 'neowow') {
    const list = Array.isArray(accounts) ? accounts : [];
    if (selectedAccountId) {
      const account = list.find((item) => item.id === selectedAccountId);
      if (!account) return '选择的 Neowow 账号不存在';
      const points = account.points == null ? '积分未知' : `${Number(account.points).toLocaleString('zh-CN')} 积分`;
      return `${account.name || 'Neowow 账号'} · ${points}`;
    }
    const usable = list.filter((account) => (
      account.enabled !== false
      && account.hasToken
      && !['expired', 'logged_out', 'invalid', 'logging_in'].includes(account.status)
      && (account.points == null || Number(account.points) > 0)
    ));
    if (usable.length) {
      const knownPoints = usable.filter((account) => account.points != null);
      const total = knownPoints.reduce((sum, account) => sum + (Number(account.points) || 0), 0);
      return knownPoints.length === usable.length
        ? `自动分配 ${usable.length} 个账号 · 共 ${total.toLocaleString('zh-CN')} 积分`
        : `自动分配 ${usable.length} 个账号`;
    }
    return (neowowHasToken || (neowowToken && !String(neowowToken).includes('****')))
      ? 'Neowow 账号暂不可用于自动分配'
      : '未登录 Neowow 账号';
  }
  if (normalized === 'video-api') {
    return (apiHasKey || (apiKey && !String(apiKey).includes('****'))) ? 'API Key 已配置' : '未配置 API Key';
  }
  if (normalized === 'comfyui') {
    return String(comfyuiBaseUrl || '').trim()
      ? `ComfyUI 已配置 · ${String(comfyuiWorkflowPreset || 'u09').toUpperCase()}`
      : '未配置 ComfyUI 云端地址';
  }
  if (normalized === 'dreamina-cli') {
    if (!dreaminaInstalled) return '未检测到 dreamina CLI';
    if (!dreaminaAuthenticated) return 'CLI 未登录';
    const balance = Number(dreaminaCreditBalance);
    return dreaminaCreditBalance !== null && dreaminaCreditBalance !== '' && Number.isFinite(balance)
      ? `剩余积分 ${balance.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
      : '本机登录态可用';
  }
  if (normalized === 'libtv-cli') {
    if (!libtvInstalled) return '未检测到 LibTV CLI';
    if (!libtvAuthenticated) return 'LibTV CLI 未登录';
    if (!String(libtvProjectUuid || '').trim()) return '未配置 LibTV 画布';
    return libtvAccountName ? `已登录 ${libtvAccountName}` : '本机登录态可用';
  }
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) return `${videoProviderLabel(normalized)}未配置线路`;
  if (!selectedAccountId) return `${list.length} 条线路`;
  const item = list.find((account) => account.id === selectedAccountId);
  return item ? (item.name || item.id.slice(-6)) : `${list.length} 条线路`;
}

export function createVideoUiStateRuntime({ ref, reactive, computed, watch, refs = {} } = {}) {
  const config = refs.config;
  const settingsVideoResolutionOptions = computed(() => videoResolutionOptionsFor(
    config.video.provider,
    videoModelForProvider(config.video, config.video.provider),
  ));
  const settingsVideoDurationRange = computed(() => ({ min: 5, max: 500 }));
  const videoBar = reactive({
    provider: 'dreamina-cli',
    xiaoyunqueModel: 'Seedance_2.0_mini_lite',
    updreamModel: 'sed2-fast',
    neowowModel: 'neo-video-2-0-fast',
    comfyuiModel: 'MiniMax-H3',
    comfyuiWorkflowPreset: 'u09',
    libtvModel: DEFAULT_LIBTV_MODEL,
    dreaminaModel: '',
    dreaminaSession: '0',
    apiModel: '',
    aspectRatio: '16:9',
    resolution: '720p',
    videoMode: 'mention',
    xiaoyunqueAccountId: '',
    dreaminaAgentAccountId: '',
    neowowAccountId: '',
    dreaminaAgentPromptPreset: 'standard',
    dreaminaAgentShotIntervalSeconds: 80,
  });
  const videoBarResolutionOptions = computed(() => videoResolutionOptionsFor(
    videoBar.provider,
    videoModelForProvider(videoBar, videoBar.provider),
  ));
  const videoBarDurationRange = computed(() => videoDurationRangeFor(
    videoBar.provider,
    videoModelForProvider(videoBar, videoBar.provider),
  ));
  const videoBarApiModelOptions = computed(() => videoApiModelOptionsForConfig(config.video, [videoBar.apiModel]));
  watch(() => [config.video.provider, config.video.dreaminaModel, config.video.libtvModel, config.video.updreamModel, config.video.neowowModel], () => {
    config.video.resolution = allowedVideoResolution(
      config.video.provider,
      videoModelForProvider(config.video, config.video.provider),
      config.video.resolution,
    );
    config.video.duration = Math.max(5, Math.min(500, Math.round(Number(config.video.duration) || 15)));
  });
  watch(() => config.video.dreaminaAgentPromptPreset, (value) => {
    const preset = normalizeDreaminaAgentPromptPreset(value);
    config.video.dreaminaAgentPromptPreset = preset;
    videoBar.dreaminaAgentPromptPreset = preset;
  });
  watch(() => config.video.dreaminaAgentShotIntervalSeconds, (value) => {
    const seconds = normalizeDreaminaAgentShotIntervalSeconds(value);
    config.video.dreaminaAgentShotIntervalSeconds = seconds;
    videoBar.dreaminaAgentShotIntervalSeconds = seconds;
  });
  watch(() => [
    videoBar.provider,
    videoBar.dreaminaModel,
    videoBar.libtvModel,
    videoBar.updreamModel,
    videoBar.neowowModel,
    config.video.apiActiveChannelId,
    activeVideoApiChannel(config.video).apiBaseUrl,
  ], () => {
    if (videoBar.provider === 'dreamina-agent') {
      videoBar.aspectRatio = '16:9';
      videoBar.resolution = '720p';
      videoBar.videoMode = 'mention';
    }
    if (videoBar.provider === 'video-api'
      && isBuiltInVideoApiChannel(activeVideoApiChannel(config.video))
      && !isSecondBuiltInVideoApiChannel(activeVideoApiChannel(config.video))
      && (!String(videoBar.apiModel || '').trim() || videoBar.apiModel === 'sd2-c8')) {
      videoBar.apiModel = DEFAULT_BUILT_IN_VIDEO_API_MODEL;
    }
    videoBar.resolution = allowedVideoResolution(
      videoBar.provider,
      videoModelForProvider(videoBar, videoBar.provider),
      videoBar.resolution,
    );
    videoBar.videoMode = normalizeVideoModeForProvider(videoBar.provider, videoBar.videoMode);
  });

  const xiaoyunqueCliStatus = reactive({ checked: false, installed: false, version: '', message: '' });
  const dreaminaCliStatus = reactive({
    checked: false,
    installed: false,
    authenticated: false,
    version: '',
    credit: null,
    creditBalance: null,
    creditError: '',
    message: '',
  });
  const dreaminaAgentStatus = reactive({
    checked: false,
    installed: true,
    running: false,
    authenticated: false,
    accountId: '',
    accountName: '',
    message: '',
  });
  const libtvCliStatus = reactive({
    checked: false,
    installed: false,
    authenticated: false,
    version: '',
    latestVersion: '',
    updateAvailable: false,
    accountName: '',
    message: '',
  });
  const currentVideoProviderLabel = computed(() => videoProviderLabel(videoBar.provider));
  const currentVideoAccounts = computed(() => {
    if (videoBar.provider === 'xiaoyunque') return config.video.xiaoyunqueAccounts || [];
    if (videoBar.provider === 'dreamina-agent') return config.video.dreaminaAgentAccounts || [];
    if (videoBar.provider === 'neowow') return config.video.neowowAccounts || [];
    return [];
  });
  const currentVideoAccountId = computed(() => {
    if (videoBar.provider === 'xiaoyunque') return videoBar.xiaoyunqueAccountId;
    if (videoBar.provider === 'dreamina-agent') return videoBar.dreaminaAgentAccountId;
    if (videoBar.provider === 'neowow') return videoBar.neowowAccountId;
    return '';
  });
  const currentVideoAccountSummary = computed(() => videoAccountSummary({
    provider: videoBar.provider,
    accounts: currentVideoAccounts.value,
    selectedAccountId: currentVideoAccountId.value,
    apiHasKey: config.video.apiHasKey,
    apiKey: config.video.apiKey,
    updreamHasToken: config.video.updreamHasAccessToken || config.video.updreamHasRefreshToken,
    updreamAccessToken: config.video.updreamAccessToken,
    neowowHasToken: config.video.neowowHasToken,
    neowowToken: config.video.neowowToken,
    comfyuiBaseUrl: config.video.comfyuiBaseUrl,
    comfyuiWorkflowPreset: videoBar.comfyuiWorkflowPreset || config.video.comfyuiWorkflowPreset,
    dreaminaInstalled: dreaminaCliStatus.installed,
    dreaminaAuthenticated: dreaminaCliStatus.authenticated,
    dreaminaCreditBalance: dreaminaCliStatus.creditBalance,
    dreaminaAgentChecked: dreaminaAgentStatus.accountId === currentVideoAccountId.value && dreaminaAgentStatus.checked,
    dreaminaAgentRunning: dreaminaAgentStatus.accountId === currentVideoAccountId.value && dreaminaAgentStatus.running,
    dreaminaAgentAuthenticated: dreaminaAgentStatus.accountId === currentVideoAccountId.value && dreaminaAgentStatus.authenticated,
    libtvInstalled: libtvCliStatus.installed,
    libtvAuthenticated: libtvCliStatus.authenticated,
    libtvAccountName: libtvCliStatus.accountName,
    libtvProjectUuid: config.video.libtvProjectUuid,
  }));

  return {
    settingsVideoResolutionOptions,
    settingsVideoDurationRange,
    videoBar,
    videoBarResolutionOptions,
    videoBarDurationRange,
    videoBarApiModelOptions,
    currentVideoProviderLabel,
    currentVideoAccounts,
    currentVideoAccountId,
    currentVideoAccountSummary,
    submitting: ref(false),
    batchVideoRunning: ref(false),
    batchVideoProgress: ref(''),
    videoProgress: reactive({
      active: false,
      percentage: 0,
      current: 0,
      total: 0,
      label: '',
      detail: '',
      status: '',
      indeterminate: false,
    }),
    schedulerSlots: ref([]),
    sequentialRunning: ref(false),
    sequentialPendingCount: ref(0),
    videoRangeDialog: reactive({
      visible: false,
      fromNo: null,
      toNo: null,
      projectId: '',
      episodeId: null,
    }),
    rangeSeqDialog: reactive({
      visible: false,
      fromNo: null,
      toNo: null,
      projectId: '',
      episodeId: null,
    }),
    xiaoyunqueAccountLoading: ref(false),
    xiaoyunqueManualVisible: ref(false),
    xiaoyunqueManualText: ref(''),
    xiaoyunqueCliStatus,
    dreaminaCliLoading: ref(false),
    dreaminaCliStatus,
    dreaminaAgentLoading: ref(false),
    dreaminaAgentStatus,
    libtvCliLoading: ref(false),
    libtvCliStatus,
  };
}
