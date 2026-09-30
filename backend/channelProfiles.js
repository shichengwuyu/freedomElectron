const ID_PATTERN = /[^a-zA-Z0-9_-]+/g;

export const DEFAULT_VIDEO_API_BASE_URL = 'https://api.xiaoyxiao.xyz';
// 内置视频渠道 1 = shafu.it.com、渠道 2 = llm.chre3.com；下面两个常量只服务于这两条渠道。
export const DEFAULT_BUILT_IN_VIDEO_API_MODEL = 'sd-720p';
export const SECOND_BUILT_IN_VIDEO_API_BASE_URL = 'https://llm.chre3.com/v1';
export const SECOND_BUILT_IN_VIDEO_API_MODEL = 'sd2-c8';
// 网关(api.xiaoyxiao.xyz)实际注册的视频模型名。new-api 按模型名「精确且大小写敏感」匹配渠道，
// 名字写错会直接返回 "No available channel for model <name> under group <group>"。
// ⚠️ 上面的 sd-720p 属于 shafu.it.com 渠道的命名体系，与网关不是一套，不要混用——
// 之前 DEFAULT_CONFIG.video.apiModel 误用了它，导致新装的客户端请求网关必然失败。
export const DEFAULT_VIDEO_GATEWAY_API_MODEL = 'seedance-2.0-mini-deal';
export const BUILT_IN_VIDEO_CHANNEL_1 = 'channel1';
export const BUILT_IN_VIDEO_CHANNEL_2 = 'channel2';
export const VIDEO_API_PROTOCOL_OPENAI = 'openai';
export const VIDEO_API_PROTOCOL_NEW_API = 'newapi';
export const VIDEO_API_PROTOCOL_FEITUO = 'feituo';
export const DEFAULT_IMAGE_API_BASE_URL = 'https://api.xiaoyxiao.xyz/v1';
// 网关(new-api)实际注册的生图模型名。new-api 按模型名「精确且大小写敏感」匹配渠道，
// 名字写错会直接返回 "No available channel for model <name> under group <group>"。
// 网关侧默认分组当前注册：GPT-image-2 / gpt-image-2-特价 / gpt-image-2.5-flare / gpt-image-2.5-sunburs。
export const DEFAULT_IMAGE_API_MODEL = 'gpt-image-2-特价';
// 第三方中转(grsai / rolldek 等，OpenAI 兼容)通用的原生模型名。
export const GENERIC_IMAGE_API_MODEL = 'gpt-image-2';

const DECOMMISSIONED_API_HOSTS = new Set(['yunwu.ai', 'www.yunwu.ai']);
const VIDEO_MODEL_PATTERN = /(?:video|seedance|(?:^|[-_.])sdf?(?:$|[-_.\d])|kling|jimeng|sora|veo|wan[-_.]?\d|hailuo|minimax|vidu|runway|luma|pixverse)/i;

export function normalizeApiBaseUrl(value, fallback = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return String(fallback || '').trim();
  try {
    const url = new URL(raw);
    if (DECOMMISSIONED_API_HOSTS.has(url.hostname.toLowerCase())) return String(fallback || '').trim();
  } catch {
    if (/^https?:\/\/(?:www\.)?yunwu\.ai(?:\/|$)/i.test(raw)) return String(fallback || '').trim();
  }
  return raw;
}

export function normalizeImageApiBaseUrl(value, fallback = DEFAULT_IMAGE_API_BASE_URL) {
  return normalizeApiBaseUrl(value, fallback);
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

// 是否为内置网关(api.xiaoyxiao.xyz)地址。图片与视频走同一个网关，所以这里是通用判断，
// 只看 hostname，带不带 /v1 都算。
export function isBuiltInGateway(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.toLowerCase() === new URL(DEFAULT_IMAGE_API_BASE_URL).hostname.toLowerCase();
  } catch {
    return false;
  }
}

// 兼容旧名：模型发现等模块沿用 isBuiltInImageGateway。
export const isBuiltInImageGateway = isBuiltInGateway;

// 生图模型名的出厂默认值：走内置网关时用网关真实注册的名字，否则退回通用 OpenAI 名字。
function defaultImageModelFor(baseUrl) {
  return isBuiltInGateway(baseUrl) ? DEFAULT_IMAGE_API_MODEL : GENERIC_IMAGE_API_MODEL;
}

// 视频模型名的出厂默认值：只有内置网关才有确定的可用模型名；
// shafu.it.com / llm.chre3.com 两条内置渠道各自走自己的常量。
function defaultVideoModelFor(baseUrl) {
  return isBuiltInGateway(baseUrl) ? DEFAULT_VIDEO_GATEWAY_API_MODEL : '';
}

function builtInVideoChannelFromUrl(value) {
  try {
    const hostname = new URL(String(value || '').trim()).hostname.toLowerCase();
    if (hostname === 'llm.chre3.com') return BUILT_IN_VIDEO_CHANNEL_2;
    if (hostname === 'shafu.it.com') return BUILT_IN_VIDEO_CHANNEL_1;
  } catch { /* ignore malformed custom URLs */ }
  return '';
}

export function builtInVideoApiChannelKey(channel = {}) {
  if (typeof channel?.builtInChannel === 'string' && channel.builtInChannel.trim()) {
    return channel.builtInChannel.trim();
  }
  if (channel?.builtIn === false) return '';
  return builtInVideoChannelFromUrl(channel?.apiBaseUrl);
}

export function isSecondBuiltInVideoApiChannel(channel = {}) {
  return builtInVideoApiChannelKey(channel) === BUILT_IN_VIDEO_CHANNEL_2;
}

export function normalizeVideoApiBaseUrl(value) {
  const raw = String(value || '').trim();
  return isBuiltInVideoApiBaseUrl(raw) ? DEFAULT_VIDEO_API_BASE_URL : raw;
}

export function normalizeVideoApiProtocol(value, baseUrl = '') {
  const protocol = String(value || '').trim().toLowerCase();
  if (protocol === VIDEO_API_PROTOCOL_NEW_API) return VIDEO_API_PROTOCOL_NEW_API;
  if (protocol === VIDEO_API_PROTOCOL_FEITUO) return VIDEO_API_PROTOCOL_FEITUO;
  if (protocol === VIDEO_API_PROTOCOL_OPENAI) return VIDEO_API_PROTOCOL_OPENAI;
  return isBuiltInVideoApiBaseUrl(baseUrl) ? VIDEO_API_PROTOCOL_NEW_API : VIDEO_API_PROTOCOL_OPENAI;
}

function cleanId(value, fallback) {
  return String(value || '').trim().replace(ID_PATTERN, '-').replace(/^-+|-+$/g, '') || fallback;
}

function uniqueId(value, fallback, seen) {
  const base = cleanId(value, fallback);
  let id = base;
  let suffix = 2;
  while (seen.has(id)) id = `${base}-${suffix++}`;
  seen.add(id);
  return id;
}

function clampInteger(value, fallback, min = 0, max = 3) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function clampNumber(value, fallback = 0, min = 0, max = 1000000) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function cleanStringList(values = []) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
}

const VIDEO_IMAGE_UPLOAD_PROVIDERS = new Set([
  'none',
  'free',
  'custom',
  'aliyun-oss',
  'tencent-cos',
  'cloudflare-r2',
  'aws-s3',
]);

export function normalizeVideoImageUpload(value = {}) {
  const provider = String(value?.provider || 'none').trim().toLowerCase();
  const freeProvider = String(value?.freeProvider || 'auto').trim().toLowerCase();
  const freeExpiry = String(value?.freeExpiry || '24h').trim().toLowerCase();
  return {
    provider: VIDEO_IMAGE_UPLOAD_PROVIDERS.has(provider) ? provider : 'none',
    freeProvider: ['auto', 'litterbox', 'uguu', 'imgbb'].includes(freeProvider) ? freeProvider : 'auto',
    freeExpiry: ['1h', '12h', '24h', '72h'].includes(freeExpiry) ? freeExpiry : '24h',
    imgbbApiKey: String(value?.imgbbApiKey || '').trim(),
    endpoint: String(value?.endpoint || '').trim(),
    customFileField: String(value?.customFileField || 'file').trim() || 'file',
    customUrlPath: String(value?.customUrlPath || '').trim(),
    customAuthHeader: String(value?.customAuthHeader || 'Authorization').trim() || 'Authorization',
    customAuthScheme: String(value?.customAuthScheme ?? 'Bearer').trim(),
    customToken: String(value?.customToken || '').trim(),
    bucket: String(value?.bucket || '').trim(),
    region: String(value?.region || '').trim(),
    accountId: String(value?.accountId || '').trim(),
    accessKeyId: String(value?.accessKeyId || '').trim(),
    secretAccessKey: String(value?.secretAccessKey || '').trim(),
    sessionToken: String(value?.sessionToken || '').trim(),
    publicBaseUrl: String(value?.publicBaseUrl || '').trim().replace(/\/+$/, ''),
    pathPrefix: String(value?.pathPrefix || 'video-api').trim().replace(/^\/+|\/+$/g, '') || 'video-api',
    signedUrlTtlHours: clampInteger(value?.signedUrlTtlHours, 24, 1, 168),
  };
}

export function normalizeImageResolution(value, model = '') {
  const resolution = String(value || '').trim().toUpperCase();
  if (['1K', '2K', '4K'].includes(resolution)) return resolution;
  return /(?:^|-)gpt-image-2-pro$/i.test(String(model || '').trim()) ? '2K' : '1K';
}

function orderedEnabledChannels(channels, activeId, fallbackIds = [], preferredId = '') {
  const enabled = channels.filter((item) => item.enabled !== false);
  const byId = new Map(enabled.map((item) => [item.id, item]));
  const configured = Array.isArray(fallbackIds) ? fallbackIds : [];
  const order = [preferredId, activeId, ...configured];
  const seen = new Set();
  return order.map((id) => byId.get(String(id || '').trim())).filter((item) => item && !seen.has(item.id) && seen.add(item.id));
}

export function normalizeImageChannels(image = {}) {
  const legacyBaseUrl = normalizeImageApiBaseUrl(image.baseUrl, DEFAULT_IMAGE_API_BASE_URL);
  const legacy = {
    baseUrl: legacyBaseUrl,
    apiKey: String(image.apiKey || '').trim(),
    model: String(image.model || defaultImageModelFor(legacyBaseUrl)).trim(),
    models: cleanStringList(image.models),
    resolution: normalizeImageResolution(image.resolution, image.model),
    pricePerImage: clampNumber(image.pricePerImage, 0),
  };
  const source = Array.isArray(image.channels) && image.channels.length ? image.channels : [{ id: 'image-primary', name: '生图渠道 1', ...legacy }];
  const seen = new Set();
  const channels = source.map((raw, index) => ({
    id: uniqueId(raw?.id, `image-channel-${index + 1}`, seen),
    name: String(raw?.name || `生图渠道 ${index + 1}`).trim(),
    enabled: raw?.enabled !== false,
    baseUrl: normalizeImageApiBaseUrl(raw?.baseUrl || (index === 0 ? legacy.baseUrl : ''), index === 0 ? legacy.baseUrl : ''),
    apiKey: String(raw?.apiKey || (index === 0 ? legacy.apiKey : '')).trim(),
    model: String(raw?.model || (index === 0 ? legacy.model : '')).trim(),
    models: cleanStringList(raw?.models ?? (index === 0 ? legacy.models : [])),
    resolution: normalizeImageResolution(raw?.resolution, raw?.model || (index === 0 ? legacy.model : '')),
    pricePerImage: clampNumber(raw?.pricePerImage, index === 0 ? legacy.pricePerImage : 0),
  }));
  const activeChannelId = channels.some((item) => item.enabled && item.id === image.activeChannelId)
    ? image.activeChannelId
    : (channels.find((item) => item.enabled)?.id || channels[0].id);
  const validIds = new Set(channels.filter((item) => item.enabled).map((item) => item.id));
  const configuredFallbacks = Array.isArray(image.fallbackChannelIds) ? image.fallbackChannelIds : channels.map((item) => item.id);
  const fallbackChannelIds = [...new Set(configuredFallbacks.map((id) => String(id || '').trim()))]
    .filter((id) => validIds.has(id) && id !== activeChannelId);
  const active = channels.find((item) => item.id === activeChannelId) || channels[0];
  return {
    ...image,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    models: active.models,
    resolution: active.resolution,
    pricePerImage: active.pricePerImage,
    channels,
    activeChannelId,
    fallbackChannelIds,
    autoFallback: image.autoFallback !== false,
    retryCount: clampInteger(image.retryCount, 1),
  };
}

export function imageChannelsPublicView(image = {}, maskKey = (key) => key) {
  const normalized = normalizeImageChannels(image);
  return {
    ...normalized,
    apiKey: maskKey(normalized.apiKey),
    hasKey: Boolean(normalized.apiKey),
    channels: normalized.channels.map((item) => ({ ...item, apiKey: maskKey(item.apiKey), hasKey: Boolean(item.apiKey) })),
  };
}

export function mergeImageChannelSecrets(incoming = {}, current = {}, keepKey = (value, oldValue) => value || oldValue) {
  const currentNormalized = normalizeImageChannels(current);
  const currentById = new Map(currentNormalized.channels.map((item) => [item.id, item]));
  const next = { ...incoming };
  if (Array.isArray(incoming.channels)) {
    next.channels = incoming.channels.map((item) => ({
      ...item,
      apiKey: keepKey(item?.apiKey, currentById.get(item?.id)?.apiKey || ''),
    }));
  }
  next.apiKey = keepKey(incoming.apiKey, currentNormalized.apiKey);
  return normalizeImageChannels(next);
}

export function resolveImageModelConfig(image = {}, preferredId = '') {
  const normalized = normalizeImageChannels(image);
  const ordered = orderedEnabledChannels(
    normalized.channels,
    normalized.activeChannelId,
    normalized.autoFallback ? normalized.fallbackChannelIds : [],
    preferredId,
  );
  const configs = ordered.map((channel) => ({
    ...normalized,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    model: channel.model,
    resolution: channel.resolution,
    pricePerImage: channel.pricePerImage,
    __routing: {
      retryCount: normalized.retryCount,
      channelId: channel.id,
      channelName: channel.name,
    },
  }));
  const primary = configs[0] || { ...normalized };
  return { ...primary, __fallbacks: normalized.autoFallback ? configs.slice(1) : [] };
}

export function hasImageModelKey(image = {}) {
  return resolveImageModelConfig(image) && [resolveImageModelConfig(image), ...(resolveImageModelConfig(image).__fallbacks || [])]
    .some((candidate) => Boolean(candidate.enabled !== false && candidate.baseUrl && candidate.model && candidate.apiKey));
}

export function normalizeVideoApiChannels(video = {}) {
  const legacyRawBaseUrl = String(video.apiBaseUrl ?? DEFAULT_VIDEO_API_BASE_URL).trim();
  const legacyBuiltInChannel = typeof video.builtInChannel === 'string' && video.builtInChannel.trim()
    ? video.builtInChannel.trim()
    : builtInVideoChannelFromUrl(legacyRawBaseUrl);
  const legacyBaseUrl = legacyBuiltInChannel === BUILT_IN_VIDEO_CHANNEL_2
    ? SECOND_BUILT_IN_VIDEO_API_BASE_URL
    : normalizeVideoApiBaseUrl(legacyRawBaseUrl);
  const legacyProtocol = normalizeVideoApiProtocol(
    video.apiProtocol || (legacyBuiltInChannel === BUILT_IN_VIDEO_CHANNEL_2 ? VIDEO_API_PROTOCOL_OPENAI : ''),
    legacyBaseUrl,
  );
  const legacy = {
    builtIn: Boolean(legacyBuiltInChannel),
    builtInChannel: legacyBuiltInChannel,
    apiBaseUrl: legacyBaseUrl,
    apiProtocol: legacyProtocol,
    apiKey: String(video.apiKey || '').trim(),
    apiModel: String(video.apiModel ?? '').trim()
      || (legacyBuiltInChannel === BUILT_IN_VIDEO_CHANNEL_2
        ? SECOND_BUILT_IN_VIDEO_API_MODEL
        : (isBuiltInVideoApiBaseUrl(legacyBaseUrl) ? DEFAULT_BUILT_IN_VIDEO_API_MODEL : defaultVideoModelFor(legacyBaseUrl))),
    pricePerSecond: clampNumber(video.pricePerSecond, 0),
  };
  const source = Array.isArray(video.apiChannels) && video.apiChannels.length
    ? video.apiChannels
    : [{ id: 'video-api-primary', name: '视频 API 渠道 1', ...legacy }];
  const seen = new Set();
  const normalizedChannels = source.map((raw, index) => {
    const rawBaseUrl = String(raw?.apiBaseUrl ?? raw?.baseUrl ?? (index === 0 ? legacy.apiBaseUrl : '')).trim();
    const explicitBuiltIn = typeof raw?.builtIn === 'boolean' ? raw.builtIn : null;
    const channelName = String(raw?.name || '').trim();
    const likelyCustomName = /(?:自定义|视频\s*API\s*渠道)/i.test(channelName);
    const builtInChannel = explicitBuiltIn === false
      ? ''
      : (String(raw?.builtInChannel || '').trim() || (likelyCustomName ? '' : builtInVideoChannelFromUrl(rawBaseUrl)));
    const builtIn = explicitBuiltIn === true || Boolean(builtInChannel);
    // Preserve a deliberately custom URL even when it uses the built-in host.
    const apiBaseUrl = builtInChannel === BUILT_IN_VIDEO_CHANNEL_2
      ? SECOND_BUILT_IN_VIDEO_API_BASE_URL
      : (builtInChannel === BUILT_IN_VIDEO_CHANNEL_1 ? DEFAULT_VIDEO_API_BASE_URL : rawBaseUrl);
    const apiProtocol = normalizeVideoApiProtocol(
      raw?.apiProtocol ?? (index === 0 ? legacy.apiProtocol : (builtInChannel === BUILT_IN_VIDEO_CHANNEL_2 ? VIDEO_API_PROTOCOL_OPENAI : '')),
      apiBaseUrl,
    );
    const rawModel = String(raw?.apiModel ?? raw?.model ?? (index === 0 ? legacy.apiModel : '')).trim();
    return {
      id: uniqueId(raw?.id, `video-api-channel-${index + 1}`, seen),
      name: String(raw?.name || `视频 API 渠道 ${index + 1}`).trim(),
      enabled: raw?.enabled !== false,
      builtIn,
      builtInChannel,
      apiBaseUrl,
      apiProtocol,
      apiKey: String(raw?.apiKey ?? (index === 0 ? legacy.apiKey : '')).trim(),
      apiModel: builtInChannel === BUILT_IN_VIDEO_CHANNEL_2
        ? (rawModel || SECOND_BUILT_IN_VIDEO_API_MODEL)
        : (builtInChannel === BUILT_IN_VIDEO_CHANNEL_1 && (!rawModel || rawModel === 'sd2-c8' || rawModel.startsWith('seedance-2.0-'))
          ? DEFAULT_BUILT_IN_VIDEO_API_MODEL
          : rawModel),
      apiModels: cleanStringList(raw?.apiModels),
      pricePerSecond: clampNumber(raw?.pricePerSecond, index === 0 ? legacy.pricePerSecond : 0),
    };
  });
  const configuredBuiltIns = new Map();
  for (const key of [BUILT_IN_VIDEO_CHANNEL_1, BUILT_IN_VIDEO_CHANNEL_2]) {
    const candidates = normalizedChannels.filter((channel) => channel.builtInChannel === key);
    const selected = candidates.find((channel) => channel.id === video.apiActiveChannelId)
      || candidates.find((channel) => channel.apiKey)
      || candidates[0];
    if (!selected) continue;
    selected.name = key === BUILT_IN_VIDEO_CHANNEL_2 ? '内置视频渠道2' : '内置视频渠道1';
    selected.apiProtocol = key === BUILT_IN_VIDEO_CHANNEL_2 ? VIDEO_API_PROTOCOL_OPENAI : VIDEO_API_PROTOCOL_NEW_API;
    selected.apiKey ||= candidates.find((channel) => channel.apiKey)?.apiKey || '';
    if (key === BUILT_IN_VIDEO_CHANNEL_2) selected.apiModel = SECOND_BUILT_IN_VIDEO_API_MODEL;
    selected.apiModels = key === BUILT_IN_VIDEO_CHANNEL_2
      ? [SECOND_BUILT_IN_VIDEO_API_MODEL]
      : cleanStringList([
        DEFAULT_BUILT_IN_VIDEO_API_MODEL,
        ...selected.apiModels.filter((model) => model !== 'sd2-c8' && VIDEO_MODEL_PATTERN.test(model)),
      ]);
    configuredBuiltIns.set(key, selected);
  }
  if (!configuredBuiltIns.has(BUILT_IN_VIDEO_CHANNEL_2)) {
    const channel = {
      id: uniqueId('video-api-channel-2', 'video-api-channel-2', seen),
      name: '内置视频渠道2',
      enabled: true,
      builtIn: true,
      builtInChannel: BUILT_IN_VIDEO_CHANNEL_2,
      apiBaseUrl: SECOND_BUILT_IN_VIDEO_API_BASE_URL,
      apiProtocol: VIDEO_API_PROTOCOL_OPENAI,
      apiKey: '',
      apiModel: SECOND_BUILT_IN_VIDEO_API_MODEL,
      apiModels: [SECOND_BUILT_IN_VIDEO_API_MODEL],
      pricePerSecond: 0,
    };
    normalizedChannels.push(channel);
    configuredBuiltIns.set(BUILT_IN_VIDEO_CHANNEL_2, channel);
  }
  const configuredBuiltInIds = new Set([...configuredBuiltIns.values()].map((channel) => channel.id));
  const builtInIds = new Set(normalizedChannels.filter((channel) => channel.builtInChannel).map((channel) => channel.id));
  const apiChannels = normalizedChannels.filter((channel) => (
    !channel.builtInChannel || configuredBuiltInIds.has(channel.id)
  ));
  const remapBuiltInId = (id) => (
    builtInIds.has(String(id || '').trim())
      ? ([...configuredBuiltIns.values()].find((channel) => channel.id === id)?.id || String(id || '').trim())
      : String(id || '').trim()
  );
  const requestedActiveId = remapBuiltInId(video.apiActiveChannelId);
  const apiActiveChannelId = apiChannels.some((item) => item.enabled && item.id === requestedActiveId)
    ? requestedActiveId
    : (apiChannels.find((item) => item.enabled)?.id || apiChannels[0].id);
  const validIds = new Set(apiChannels.filter((item) => item.enabled).map((item) => item.id));
  const configuredFallbacks = Array.isArray(video.apiFallbackChannelIds) ? video.apiFallbackChannelIds : apiChannels.map((item) => item.id);
  const apiFallbackChannelIds = [...new Set(configuredFallbacks.map(remapBuiltInId))]
    .filter((id) => validIds.has(id) && id !== apiActiveChannelId);
  const active = apiChannels.find((item) => item.id === apiActiveChannelId) || apiChannels[0];
  return {
    ...video,
    apiBaseUrl: active.apiBaseUrl,
    apiProtocol: active.apiProtocol,
    apiKey: active.apiKey,
    apiModel: active.apiModel,
    pricePerSecond: active.pricePerSecond,
    apiChannels,
    apiActiveChannelId,
    apiFallbackChannelIds,
    apiAutoFallback: video.apiAutoFallback !== false,
    apiRetryCount: clampInteger(video.apiRetryCount, 1),
    imageUpload: normalizeVideoImageUpload(video.imageUpload),
  };
}

export function videoApiChannelsPublicView(video = {}, maskKey = (key) => key) {
  const normalized = normalizeVideoApiChannels(video);
  return {
    ...normalized,
    apiKey: maskKey(normalized.apiKey),
    apiHasKey: Boolean(normalized.apiKey),
    apiChannels: normalized.apiChannels.map((item) => ({ ...item, apiKey: maskKey(item.apiKey), hasKey: Boolean(item.apiKey) })),
    imageUpload: {
      ...normalized.imageUpload,
      imgbbApiKey: maskKey(normalized.imageUpload.imgbbApiKey),
      imgbbHasApiKey: Boolean(normalized.imageUpload.imgbbApiKey),
      customToken: maskKey(normalized.imageUpload.customToken),
      customHasToken: Boolean(normalized.imageUpload.customToken),
      accessKeyId: maskKey(normalized.imageUpload.accessKeyId),
      hasAccessKeyId: Boolean(normalized.imageUpload.accessKeyId),
      secretAccessKey: maskKey(normalized.imageUpload.secretAccessKey),
      hasSecretAccessKey: Boolean(normalized.imageUpload.secretAccessKey),
      sessionToken: maskKey(normalized.imageUpload.sessionToken),
      hasSessionToken: Boolean(normalized.imageUpload.sessionToken),
    },
  };
}

export function mergeVideoApiChannelSecrets(incoming = {}, current = {}, keepKey = (value, oldValue) => value || oldValue) {
  const currentNormalized = normalizeVideoApiChannels(current);
  const currentById = new Map(currentNormalized.apiChannels.map((item) => [item.id, item]));
  const next = { ...incoming };
  if (Array.isArray(incoming.apiChannels)) {
    next.apiChannels = incoming.apiChannels.map((item) => ({
      ...item,
      apiKey: keepKey(item?.apiKey, currentById.get(item?.id)?.apiKey || ''),
    }));
  } else {
    next.apiChannels = currentNormalized.apiChannels;
  }
  next.apiKey = keepKey(incoming.apiKey, currentNormalized.apiKey);
  const incomingUpload = incoming.imageUpload || {};
  const currentUpload = currentNormalized.imageUpload;
  next.imageUpload = normalizeVideoImageUpload({
    ...currentUpload,
    ...incomingUpload,
    imgbbApiKey: keepKey(incomingUpload.imgbbApiKey, currentUpload.imgbbApiKey),
    customToken: keepKey(incomingUpload.customToken, currentUpload.customToken),
    accessKeyId: keepKey(incomingUpload.accessKeyId, currentUpload.accessKeyId),
    secretAccessKey: keepKey(incomingUpload.secretAccessKey, currentUpload.secretAccessKey),
    sessionToken: keepKey(incomingUpload.sessionToken, currentUpload.sessionToken),
  });
  return normalizeVideoApiChannels(next);
}

export function resolveVideoApiCandidates(video = {}, preferredId = '') {
  const normalized = normalizeVideoApiChannels(video);
  return orderedEnabledChannels(
    normalized.apiChannels,
    normalized.apiActiveChannelId,
    normalized.apiAutoFallback ? normalized.apiFallbackChannelIds : [],
    preferredId,
  ).map((channel) => ({
    ...normalized,
    ...channel,
    baseUrl: channel.apiBaseUrl,
    model: channel.apiModel,
    channelId: channel.id,
    channelName: channel.name,
    retryCount: normalized.apiRetryCount,
  }));
}

export function resolveVideoApiChannel(video = {}, channelId = '') {
  return resolveVideoApiCandidates(video, channelId)[0] || null;
}
