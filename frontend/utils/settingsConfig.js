import { createDetectJianyingDirRuntime } from './jianyingExport.js';
import { discoveredModelOptions, normalizeDiscoveredModelNames } from './modelDiscovery.js';
import { waitSimpleVideoJobFlow } from './video/cli.js';
import {
  DEFAULT_BUILT_IN_VIDEO_API_MODEL,
  DEFAULT_VIDEO_API_BASE_URL,
  DEFAULT_VIDEO_GATEWAY_API_BASE_URL,
  DEFAULT_VIDEO_GATEWAY_API_MODEL,
  VIDEO_API_PROTOCOL_NEW_API,
  VIDEO_API_PROTOCOL_OPENAI,
  allowedVideoResolution,
  isBuiltInVideoApiChannel,
  isBuiltInVideoApiBaseUrl,
  isSecondBuiltInVideoApiChannel,
  normalizeVideoApiModelNames,
  normalizeVideoApiProtocol,
  normalizeVideoProvider,
  videoApiModelOptionsForChannel,
  videoModelForProvider,
} from './videoConfig.js';

function normalizePositiveInteger(value, fallback = 2) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(1, number) : fallback;
}

// 与后端 isGptImage2Model 保持一致：接受任意「-后缀」（网关有 gpt-image-2-特价 这类命名），
// 但排除点号版本（gpt-image-2.5-*），避免它们错误套用 2.0 的尺寸档位表。
const IMAGE_RESOLUTION_MODEL_PATTERN = /^gpt-image-2(?:-[\w\u4e00-\u9fa5]+)*$/i;

export function imageModelSupportsResolution(model = '') {
  return IMAGE_RESOLUTION_MODEL_PATTERN.test(String(model || '').trim());
}

function isGrsaiImageBaseUrl(baseUrl = '') {
  try {
    const hostname = new URL(String(baseUrl || '')).hostname.toLowerCase();
    return hostname === 'grsaiapi.com'
      || hostname.endsWith('.grsaiapi.com')
      || hostname === 'grsai.dakka.com.cn';
  } catch {
    return /(?:^|\.)grsaiapi\.com|grsai\.dakka\.com\.cn/i.test(String(baseUrl || ''));
  }
}

export function imageChannelSupportsResolution(channel = {}) {
  return isGrsaiImageBaseUrl(channel.baseUrl) || imageModelSupportsResolution(channel.model);
}

export function createConsecutiveClickUnlock({ requiredClicks = 3, maxIntervalMs = 4000, now = () => Date.now() } = {}) {
  let clickCount = 0;
  let lastClickAt = 0;
  return () => {
    const clickedAt = now();
    const withinInterval = clickCount > 0 && clickedAt - lastClickAt <= maxIntervalMs;
    clickCount = withinInterval ? clickCount + 1 : 1;
    lastClickAt = clickedAt;
    if (clickCount < requiredClicks) return false;
    clickCount = 0;
    lastClickAt = 0;
    return true;
  };
}

export function createDefaultVideoProviderPersistence({ saveProvider, onError } = {}) {
  let queue = Promise.resolve();
  return (provider) => {
    const normalized = normalizeVideoProvider(provider);
    queue = queue
      .then(async () => {
        const result = await saveProvider(normalized);
        if (result?.ok === false) throw new Error(result.error || '保存视频渠道失败');
        return true;
      })
      .catch((error) => {
        onError?.(error, normalized);
        return false;
      });
    return queue;
  };
}

export function createSettingsStateRuntime({ reactive, ref, computed } = {}) {
  const cfg = reactive({
    text: { baseUrl: '', apiKey: '', model: '', models: [], temperature: 0.7, maxTokens: 256000, hasKey: false, endpoints: [], rotationStrategy: 'off' },
    modelRouting: { enabled: false, autoFallback: true, retryCount: 1, profiles: [], routes: {}, fallbacks: {} },
    image: {
      provider: 'api',
      baseUrl: '', apiKey: '', model: '', ratio: '16:9', resolution: '1K', concurrency: 10, pricePerImage: 0, hasKey: false,
      channels: [], activeChannelId: '', fallbackChannelIds: [], autoFallback: true, retryCount: 1,
      libtvModel: 'Lib Image', libtvProjectUuid: '', libtvResolution: '2K', libtvQuality: 'medium',
      updreamModel: 'cheap-b-2', updreamResolution: '1K', updreamQuality: '',
      neowowModel: 'gpt-image-2', neowowResolution: '1K', neowowQuality: 'low', neowowAccountId: '',
      dreaminaModel: '5.0', dreaminaResolution: '2k', dreaminaSession: '0',
    },
    style: 'realistic',
    stylePrompts: {
      realistic: '',
      anime: '',
      '3d': '',
      webtoon: '',
      inkwash: '',
      american: '',
      clay: '',
      elements: { character: '', group: '', scene: '', prop: '', effect: '', creature: '' },
    },
    promptTemplate: {
      selectedId: 'custom',
      custom: { name: '自定义模板', extractionAestheticRules: '', characterAestheticGuide: '', partDefaults: {} },
    },
    chunkSize: 10000,
    extractConcurrency: 3,
    video: {
      provider: 'dreamina-cli',
      shotHeaderPrefix: '无字幕无BGM',
      portraitBypass: false,
      xiaoyunqueModel: 'Seedance_2.0_mini_lite',
      xiaoyunqueAccountId: '',
      dreaminaModel: '',
      dreaminaSession: '0',
      dreaminaAgentSessionId: '',
      dreaminaAgentHasSessionId: false,
      dreaminaAgentAccountName: '',
      dreaminaAgentAccounts: [],
      dreaminaAgentAccountId: '',
      dreaminaAgentHeadless: false,
      dreaminaAgentPromptPreset: 'standard',
      dreaminaAgentShotIntervalSeconds: 80,
      libtvModel: 'Seedance 2.0 VIP',
      libtvProjectUuid: '',
      libtvConcurrency: 3,
      updreamBaseUrl: 'https://www.updream.cn/api',
      updreamAccessToken: '',
      updreamRefreshToken: '',
      updreamHasAccessToken: false,
      updreamHasRefreshToken: false,
      updreamModel: 'sed2-fast',
      updreamConcurrency: 2,
      neowowBaseUrl: 'https://neowow.cn',
      neowowToken: '',
      neowowHasToken: false,
      neowowAccounts: [],
      neowowAccountId: '',
      neowowModel: 'neo-video-2-0-fast',
      neowowConcurrency: 15,
      neowowAttachActivityVideo: false,
      comfyuiBaseUrl: '',
      comfyuiWorkflow: 'workflows/U视频-MINIMAX-H3/U09-Minimax-H3二采重绘-秒变清晰-超高一致性-效率起飞wuwukasi.json',
      comfyuiWorkflowPreset: 'u09',
      comfyuiConcurrency: 1,
      // 默认指向网关(api.xiaoyxiao.xyz)：只有它上面注册的模型名是确定的。
      // 原先默认 shafu.it.com + sd-720p，而 sd-720p 在网关上并不存在，
      // 装包后请求网关必然报 No available channel for model sd-720p。
      apiBaseUrl: DEFAULT_VIDEO_GATEWAY_API_BASE_URL,
      apiProtocol: VIDEO_API_PROTOCOL_NEW_API,
      apiKey: '',
      apiHasKey: false,
      apiModel: DEFAULT_VIDEO_GATEWAY_API_MODEL,
      imageUpload: {
        provider: 'free', freeProvider: 'auto', freeExpiry: '24h', endpoint: '', customFileField: 'file', customUrlPath: '',
        imgbbApiKey: '', imgbbHasApiKey: false,
        customAuthHeader: 'Authorization', customAuthScheme: 'Bearer', customToken: '', customHasToken: false,
        bucket: '', region: '', accountId: '', accessKeyId: '', hasAccessKeyId: false,
        secretAccessKey: '', hasSecretAccessKey: false, sessionToken: '', hasSessionToken: false,
        publicBaseUrl: '', pathPrefix: 'video-api', signedUrlTtlHours: 24,
      },
      aspectRatio: '16:9',
      resolution: '720p',
      videoMode: 'mention',
      duration: 15,
      pricePerSecond: 0,
      upstreamAccessToken: '',
      upstreamUserId: '',
      upstreamBaseUrl: 'https://rolldek.com',
      feituoLedgerCookie: '',
      xiaoyunqueAccounts: [],
      apiChannels: [],
      apiActiveChannelId: '',
      apiFallbackChannelIds: [],
      apiAutoFallback: true,
      apiRetryCount: 1,
    },
    jianying: {
      draftDir: '',
    },
    performance: {
      hardwareAcceleration: true,
      reduceMotion: false,
    },
    storage: {
      rootPath: '',
      defaultRootPath: '',
      installDir: '',
      isDefault: true,
      locatorPath: '',
    },
    costTracking: { currency: 'CNY', monthlyBudget: 0 },
    gateway: { baseUrl: '', userToken: '' },
    promptLibrary: {
      scriptPrompts: [],
      storyboardPrompts: [],
    },
    appearance: {
      theme: 'dark',
      uiScale: 1,
    },
    generationSafety: {
      videoGuardEnabled: false,
      videoGuardSeconds: 10,
    },
  });
  const imageRatio = ref('16:9');
  const customImageRatio = ref('1:1');
  return {
    cfg,
    testing: reactive({ text: false, textModels: false, image: false, imageModels: '', imageUpload: false, libtvImageModels: false, updreamImageModels: false, neowowImageModels: false, videoApi: '', updream: false, neowow: false, comfyui: false }),
    testResult: reactive({ text: null, image: null, imageUpload: null, videoApi: null, updream: null, neowow: null, comfyui: null }),
    saving: ref(false),
    neowowAccountName: ref(''),
    neowowAccountAddMode: ref('browser'),
    neowowAccountToken: ref(''),
    neowowTokenAccountId: ref(''),
    storyboardPromptTemplates: ref([
      { id: 'p', name: '金牌分镜导演', description: '严格15秒与帧级承接的电影级短视频分镜' },
    ]),
    storyboardPromptTemplateId: ref('p'),
    imageRatio,
    customImageRatio,
    characterImageMode: ref('double'),
    currentImageRatio: computed(() => imageRatio.value === 'custom' ? customImageRatio.value.trim() : imageRatio.value),
    textBaseUrlChoice: ref('https://api.xiaoyxiao.xyz/v1'),
    textModelChoice: ref('gpt-5.5'),
    imageChannelBaseUrlChoice: reactive({}),
    imageModelChoice: ref('gpt-image-2-特价'),
    styleChoice: ref('realistic'),
  };
}

export function ensurePromptTemplateConfig(cfg, characterPartKeys = []) {
  if (!cfg.promptTemplate) cfg.promptTemplate = {};
  cfg.promptTemplate.selectedId = cfg.promptTemplate.selectedId === 'second' ? 'second' : 'custom';
  if (!cfg.promptTemplate.custom) cfg.promptTemplate.custom = {};
  if (!cfg.promptTemplate.custom.name) cfg.promptTemplate.custom.name = '自定义模板';
  if (cfg.promptTemplate.custom.extractionAestheticRules === undefined) cfg.promptTemplate.custom.extractionAestheticRules = '';
  if (cfg.promptTemplate.custom.characterAestheticGuide === undefined) cfg.promptTemplate.custom.characterAestheticGuide = '';
  if (!cfg.promptTemplate.custom.partDefaults) cfg.promptTemplate.custom.partDefaults = {};
  for (const key of characterPartKeys) {
    if (cfg.promptTemplate.custom.partDefaults[key] === undefined) cfg.promptTemplate.custom.partDefaults[key] = '';
  }
}

export function applyLoadedSettingsConfig(cfg, config) {
  cfg.text = {
    ...config.text,
    apiKey: config.text.hasKey ? config.text.apiKey : '',
    models: normalizeDiscoveredModelNames(config.text?.models),
    endpoints: Array.isArray(config.text?.endpoints)
      ? config.text.endpoints.map((endpoint) => ({
        ...endpoint,
        apiKey: endpoint?.hasKey ? (endpoint.apiKey || '') : '',
      }))
      : [],
    rotationStrategy: config.text?.rotationStrategy === 'failover' ? 'failover' : 'off',
  };
  cfg.modelRouting = config.modelRouting || cfg.modelRouting;
  cfg.image = {
    ...config.image,
    provider: ['libtv-cli', 'dreamina-cli', 'updream', 'neowow'].includes(config.image?.provider) ? config.image.provider : 'api',
    apiKey: config.image.hasKey ? config.image.apiKey : '',
    concurrency: Number(config.image?.concurrency) || 10,
    channels: Array.isArray(config.image?.channels)
      ? config.image.channels.map((item) => ({ ...item, apiKey: item.hasKey ? item.apiKey : '', models: normalizeDiscoveredModelNames(item.models) }))
      : [],
    dreaminaModel: String(config.image?.dreaminaModel || '5.0').trim(),
    dreaminaResolution: String(config.image?.dreaminaResolution || '2k').trim().toLowerCase(),
    dreaminaSession: String(config.image?.dreaminaSession || '0').trim(),
    neowowModel: String(config.image?.neowowModel || 'gpt-image-2').trim(),
    neowowResolution: String(config.image?.neowowResolution || '1K').trim().toUpperCase(),
    neowowQuality: String(config.image?.neowowQuality || 'low').trim().toLowerCase(),
    neowowAccountId: String(config.image?.neowowAccountId || '').trim(),
    fallbackChannelIds: Array.isArray(config.image?.fallbackChannelIds) ? config.image.fallbackChannelIds : [],
  };
  cfg.style = config.style || 'realistic';
  cfg.stylePrompts = {
    realistic: config.stylePrompts?.realistic || '',
    anime: config.stylePrompts?.anime || '',
    '3d': config.stylePrompts?.['3d'] || '',
    webtoon: config.stylePrompts?.webtoon || '',
    inkwash: config.stylePrompts?.inkwash || '',
    american: config.stylePrompts?.american || '',
    clay: config.stylePrompts?.clay || '',
    elements: {
      character: config.stylePrompts?.elements?.character || '',
      group: config.stylePrompts?.elements?.group || '',
      scene: config.stylePrompts?.elements?.scene || '',
      prop: config.stylePrompts?.elements?.prop || '',
      effect: config.stylePrompts?.elements?.effect || '',
      creature: config.stylePrompts?.elements?.creature || '',
    },
  };
  cfg.promptTemplate = config.promptTemplate || cfg.promptTemplate;
  cfg.chunkSize = Number(config.chunkSize) || 10000;
  cfg.extractConcurrency = Math.max(1, Math.min(4, Number(config.extractConcurrency) || 3));
  if (config.video) {
    cfg.video.provider = normalizeVideoProvider(config.video.provider || cfg.video.provider);
    cfg.video.shotHeaderPrefix = String(config.video.shotHeaderPrefix ?? '无字幕无BGM').trim().slice(0, 4000);
    cfg.video.portraitBypass = config.video.portraitBypass === true;
    cfg.video.xiaoyunqueModel = config.video.xiaoyunqueModel || 'Seedance_2.0_mini_lite';
    cfg.video.xiaoyunqueAccountId = config.video.xiaoyunqueAccountId || '';
    cfg.video.dreaminaModel = config.video.dreaminaModel || '';
    cfg.video.dreaminaSession = config.video.dreaminaSession || '0';
    cfg.video.dreaminaAgentHasSessionId = !!config.video.dreaminaAgentHasSessionId;
    cfg.video.dreaminaAgentSessionId = '';
    cfg.video.dreaminaAgentAccountName = '';
    cfg.video.dreaminaAgentAccounts = Array.isArray(config.video.dreaminaAgentAccounts)
      ? config.video.dreaminaAgentAccounts
      : [];
    cfg.video.dreaminaAgentAccountId = config.video.dreaminaAgentAccountId
      || cfg.video.dreaminaAgentAccounts[0]?.id
      || '';
    cfg.video.dreaminaAgentHeadless = config.video.dreaminaAgentHeadless === true;
    cfg.video.dreaminaAgentPromptPreset = config.video.dreaminaAgentPromptPreset === 'fast' ? 'fast' : 'standard';
    cfg.video.dreaminaAgentShotIntervalSeconds = Math.max(10, Math.min(3600, Number(config.video.dreaminaAgentShotIntervalSeconds) || 80));
    cfg.video.libtvModel = !config.video.libtvModel || config.video.libtvModel === 'Seedance 2.0'
      ? 'Seedance 2.0 VIP'
      : config.video.libtvModel;
    cfg.video.libtvProjectUuid = config.video.libtvProjectUuid || '';
    cfg.video.libtvConcurrency = Math.max(1, Math.min(10, Number(config.video.libtvConcurrency) || 3));
    cfg.video.updreamBaseUrl = config.video.updreamBaseUrl || 'https://www.updream.cn/api';
    cfg.video.updreamHasAccessToken = !!config.video.updreamHasAccessToken;
    cfg.video.updreamHasRefreshToken = !!config.video.updreamHasRefreshToken;
    cfg.video.updreamAccessToken = config.video.updreamHasAccessToken ? (config.video.updreamAccessToken || '') : '';
    cfg.video.updreamRefreshToken = config.video.updreamHasRefreshToken ? (config.video.updreamRefreshToken || '') : '';
    cfg.video.updreamModel = config.video.updreamModel || 'sed2-fast';
    cfg.video.updreamConcurrency = normalizePositiveInteger(config.video.updreamConcurrency);
    cfg.video.neowowBaseUrl = config.video.neowowBaseUrl || 'https://neowow.cn';
    cfg.video.neowowHasToken = !!config.video.neowowHasToken;
    cfg.video.neowowToken = config.video.neowowHasToken ? (config.video.neowowToken || '') : '';
    cfg.video.neowowAccounts = Array.isArray(config.video.neowowAccounts) ? config.video.neowowAccounts : [];
    cfg.video.neowowAccountId = config.video.neowowAccountId || cfg.video.neowowAccounts[0]?.id || '';
    if (!cfg.video.neowowAccounts.some((account) => account.id === cfg.image.neowowAccountId)) {
      cfg.image.neowowAccountId = cfg.video.neowowAccountId || cfg.video.neowowAccounts[0]?.id || '';
    }
    cfg.video.neowowModel = config.video.neowowModel || 'neo-video-2-0-fast';
    cfg.video.neowowConcurrency = normalizePositiveInteger(config.video.neowowConcurrency, 15);
    cfg.video.neowowAttachActivityVideo = config.video.neowowAttachActivityVideo === true;
    cfg.video.comfyuiBaseUrl = String(config.video.comfyuiBaseUrl || '').trim();
    cfg.video.comfyuiWorkflow = String(config.video.comfyuiWorkflow || '').trim();
    cfg.video.comfyuiWorkflowPreset = ['u09', 'u07'].includes(String(config.video.comfyuiWorkflowPreset || '').trim())
      ? String(config.video.comfyuiWorkflowPreset).trim()
      : 'u09';
    cfg.video.comfyuiConcurrency = Math.max(1, Math.min(3, Number(config.video.comfyuiConcurrency) || 1));
    cfg.video.apiBaseUrl = config.video.apiBaseUrl || DEFAULT_VIDEO_API_BASE_URL;
    cfg.video.apiProtocol = normalizeVideoApiProtocol(config.video.apiProtocol, cfg.video.apiBaseUrl);
    cfg.video.apiHasKey = !!config.video.apiHasKey;
    cfg.video.apiKey = config.video.apiHasKey ? (config.video.apiKey || '') : '';
    cfg.video.apiModel = config.video.apiModel ?? '';
    const loadedImageUpload = config.video.imageUpload || {};
    cfg.video.imageUpload = {
      ...cfg.video.imageUpload,
      ...loadedImageUpload,
      imgbbApiKey: loadedImageUpload.imgbbHasApiKey ? (loadedImageUpload.imgbbApiKey || '') : '',
      customToken: loadedImageUpload.customHasToken ? (loadedImageUpload.customToken || '') : '',
      accessKeyId: loadedImageUpload.hasAccessKeyId ? (loadedImageUpload.accessKeyId || '') : '',
      secretAccessKey: loadedImageUpload.hasSecretAccessKey ? (loadedImageUpload.secretAccessKey || '') : '',
      sessionToken: loadedImageUpload.hasSessionToken ? (loadedImageUpload.sessionToken || '') : '',
    };
    cfg.video.apiChannels = Array.isArray(config.video.apiChannels)
      ? config.video.apiChannels.map((item) => {
        const channel = {
          ...item,
          builtIn: typeof item.builtIn === 'boolean'
            ? item.builtIn
            : isBuiltInVideoApiBaseUrl(item.apiBaseUrl),
          apiProtocol: normalizeVideoApiProtocol(item.apiProtocol, item.apiBaseUrl),
          apiKey: item.hasKey ? item.apiKey : '',
          apiModels: normalizeVideoApiModelNames(item.apiModels),
        };
        const currentModel = String(channel.apiModel || '').trim();
        const hasCurrentModel = videoApiModelOptionsForChannel(channel)
          .some((option) => option.value === currentModel);
        if (currentModel && !hasCurrentModel) channel.apiModels.push(currentModel);
        return channel;
      })
      : [];
    cfg.video.apiActiveChannelId = config.video.apiActiveChannelId || cfg.video.apiChannels[0]?.id || '';
    cfg.video.apiFallbackChannelIds = Array.isArray(config.video.apiFallbackChannelIds) ? config.video.apiFallbackChannelIds : [];
    cfg.video.apiAutoFallback = config.video.apiAutoFallback !== false;
    cfg.video.apiRetryCount = Number(config.video.apiRetryCount) || 1;
    cfg.video.aspectRatio = config.video.aspectRatio || cfg.video.aspectRatio;
    cfg.video.resolution = allowedVideoResolution(
      cfg.video.provider,
      videoModelForProvider(cfg.video, cfg.video.provider),
      config.video.resolution || cfg.video.resolution,
    );
    cfg.video.videoMode = config.video.videoMode === 'label' ? 'label' : 'mention';
    cfg.video.duration = Math.max(5, Math.min(500, Number(config.video.duration) || 15));
    cfg.video.pricePerSecond = Number(config.video.pricePerSecond) || 0;
    cfg.video.upstreamAccessToken = config.video.upstreamAccessToken !== undefined ? String(config.video.upstreamAccessToken) : (cfg.video.upstreamAccessToken || '');
    cfg.video.upstreamUserId = config.video.upstreamUserId !== undefined ? String(config.video.upstreamUserId).trim() : (cfg.video.upstreamUserId || '');
    cfg.video.upstreamBaseUrl = config.video.upstreamBaseUrl !== undefined ? String(config.video.upstreamBaseUrl).trim() : (cfg.video.upstreamBaseUrl || 'https://rolldek.com');
    cfg.video.feituoLedgerCookie = config.video.feituoLedgerCookie !== undefined ? String(config.video.feituoLedgerCookie) : (cfg.video.feituoLedgerCookie || '');
    const xyqAccounts = Array.isArray(config.video.xiaoyunqueAccounts) ? config.video.xiaoyunqueAccounts : [];
    cfg.video.xiaoyunqueAccounts.splice(0, cfg.video.xiaoyunqueAccounts.length, ...xyqAccounts);
  }
  cfg.gateway = config.gateway || { baseUrl: '', userToken: '' };
  if (config.jianying) {
    cfg.jianying.draftDir = config.jianying.draftDir || '';
  }
  cfg.costTracking = { currency: config.costTracking?.currency || 'CNY', monthlyBudget: Number(config.costTracking?.monthlyBudget) || 0 };
  cfg.performance = {
    hardwareAcceleration: config.performance?.hardwareAcceleration !== false,
    reduceMotion: config.performance?.reduceMotion === true,
  };
  cfg.storage = {
    rootPath: config.storage?.rootPath || '',
    defaultRootPath: config.storage?.defaultRootPath || '',
    installDir: config.storage?.installDir || '',
    isDefault: config.storage?.isDefault !== false,
    locatorPath: config.storage?.locatorPath || '',
  };
  cfg.promptLibrary = {
    scriptPrompts: Array.isArray(config.promptLibrary?.scriptPrompts) ? config.promptLibrary.scriptPrompts : [],
    storyboardPrompts: Array.isArray(config.promptLibrary?.storyboardPrompts) ? config.promptLibrary.storyboardPrompts : [],
  };
  cfg.appearance = {
    theme: config.appearance?.theme || 'dark',
    uiScale: Math.min(1.5, Math.max(.85, Number(config.appearance?.uiScale) || 1)),
  };
  cfg.generationSafety = {
    videoGuardEnabled: (config.generationSafety?.videoGuardEnabled ?? config.generationSafety?.storyboardGuardEnabled) === true,
    videoGuardSeconds: Math.max(1, Math.min(120, Math.floor(Number(config.generationSafety?.videoGuardSeconds ?? config.generationSafety?.storyboardGuardSeconds) || 10))),
  };
  return cfg;
}

export function createLoadSettingsRuntime({ api, refs = {}, helpers = {} } = {}) {
  return async () => {
    const config = await api.get('/api/config');
    applyLoadedSettingsConfig(refs.config, config);
    ensurePromptTemplateConfig(refs.config, helpers.characterPartKeys?.() || []);
    refs.imageRatio.value = refs.config.image.ratio || '16:9';
    helpers.syncSettingsChoices();
    helpers.refreshXiaoyunqueCliStatus();
    helpers.refreshDreaminaCliStatus();
    helpers.refreshDreaminaAgentStatus?.();
    helpers.refreshLibtvCliStatus();
  };
}

function syncChoice(choice, value, options = [], fallback = 'custom') {
  const values = options.map((option) => option.value);
  choice.value = values.includes(value) ? value : fallback;
}

export function createSettingsChoiceController(cfg, choices, options = {}) {
  const syncTextChoices = () => {
    syncChoice(choices.textBaseUrlChoice, cfg.text.baseUrl, options.textBaseUrlOptions);
    syncChoice(choices.textModelChoice, cfg.text.model, options.textModelOptions);
  };
  const syncImageChoices = () => {
    syncChoice(choices.imageModelChoice, cfg.image.model, options.imageModelOptions);
  };
  const syncStyleChoice = () => {
    syncChoice(choices.styleChoice, cfg.style, options.styleOptions, 'realistic');
  };
  return {
    syncTextChoices,
    syncImageChoices,
    syncStyleChoice,
    syncAll() {
      syncTextChoices();
      syncImageChoices();
      syncStyleChoice();
    },
    onTextBaseUrlChoiceChange(value) {
      if (value !== 'custom') cfg.text.baseUrl = value;
    },
    onTextModelChoiceChange(value) {
      if (value !== 'custom') cfg.text.model = value;
    },
    onImageModelChoiceChange(value) {
      if (value !== 'custom') cfg.image.model = value;
    },
    onStyleChoiceChange(value) {
      cfg.style = (options.styleOptions || []).some((option) => option.value === value) ? value : 'realistic';
    },
  };
}

export async function loadStoryboardPromptTemplatesFlow(handlers = {}) {
  try {
    const result = await handlers.fetchTemplates();
    if (Array.isArray(result.templates) && result.templates.length) {
      handlers.setTemplates(result.templates);
      if (!result.templates.some((template) => template.id === handlers.selectedTemplateId())) {
        handlers.setSelectedTemplateId(result.templates[0].id);
      }
    }
  } catch (error) {
    handlers.warn('加载分镜提示词套装失败:', error);
  }
}

export function createLoadStoryboardPromptTemplatesRuntime({ api, refs = {}, helpers = {} } = {}) {
  const context = {
    fetchTemplates: () => api.get('/api/script/storyboard/templates'),
    setTemplates: (templates) => { refs.templates.value = templates; },
    selectedTemplateId: () => refs.selectedTemplateId.value,
    setSelectedTemplateId: (templateId) => { refs.selectedTemplateId.value = templateId; },
    warn: helpers.warn,
  };
  return () => loadStoryboardPromptTemplatesFlow(context);
}

export function buildSettingsPayload(cfg) {
  return {
    text: {
      baseUrl: cfg.text.baseUrl,
      apiKey: cfg.text.apiKey,
      model: cfg.text.model,
      models: normalizeDiscoveredModelNames(cfg.text.models),
      temperature: Number.isFinite(Number(cfg.text.temperature)) ? Number(cfg.text.temperature) : 0.7,
      maxTokens: Number.isFinite(Number(cfg.text.maxTokens)) ? Number(cfg.text.maxTokens) : 256000,
      endpoints: Array.isArray(cfg.text.endpoints)
        ? cfg.text.endpoints.map((endpoint) => ({
          name: String(endpoint?.name || '').trim(),
          baseUrl: String(endpoint?.baseUrl || '').trim(),
          apiKey: String(endpoint?.apiKey || ''),
          model: String(endpoint?.model || '').trim(),
        }))
        : [],
      rotationStrategy: cfg.text.rotationStrategy === 'failover' ? 'failover' : 'off',
    },
    modelRouting: cfg.modelRouting,
    image: {
      provider: ['libtv-cli', 'dreamina-cli', 'updream', 'neowow'].includes(cfg.image.provider) ? cfg.image.provider : 'api',
      baseUrl: cfg.image.baseUrl,
      apiKey: cfg.image.apiKey,
      model: cfg.image.model,
      ratio: cfg.image.ratio,
      resolution: cfg.image.resolution || '1K',
      concurrency: Number(cfg.image.concurrency) || 10,
      pricePerImage: Number(cfg.image.pricePerImage) || 0,
      channels: cfg.image.channels,
      activeChannelId: cfg.image.activeChannelId,
      fallbackChannelIds: cfg.image.fallbackChannelIds,
      autoFallback: cfg.image.autoFallback !== false,
      retryCount: Number(cfg.image.retryCount) || 0,
      libtvModel: String(cfg.image.libtvModel || 'Lib Image').trim(),
      libtvProjectUuid: String(cfg.image.libtvProjectUuid || '').trim(),
      libtvResolution: cfg.image.libtvResolution || '2K',
      libtvQuality: cfg.image.libtvQuality || 'medium',
      updreamModel: String(cfg.image.updreamModel || '').trim(),
      updreamResolution: String(cfg.image.updreamResolution || '').trim(),
      updreamQuality: String(cfg.image.updreamQuality || '').trim(),
      neowowModel: String(cfg.image.neowowModel || 'gpt-image-2').trim(),
      neowowResolution: String(cfg.image.neowowResolution || '1K').trim().toUpperCase(),
      neowowQuality: String(cfg.image.neowowQuality || 'low').trim().toLowerCase(),
      neowowAccountId: String(cfg.image.neowowAccountId || '').trim(),
      dreaminaModel: String(cfg.image.dreaminaModel || '5.0').trim(),
      dreaminaResolution: String(cfg.image.dreaminaResolution || '2k').trim().toLowerCase(),
      dreaminaSession: String(cfg.image.dreaminaSession || '0').trim(),
    },
    style: cfg.style,
    stylePrompts: cfg.stylePrompts,
    promptTemplate: cfg.promptTemplate,
    chunkSize: Number(cfg.chunkSize) || 10000,
    extractConcurrency: Math.max(1, Math.min(4, Number(cfg.extractConcurrency) || 3)),
    video: {
      provider: cfg.video.provider,
      shotHeaderPrefix: String(cfg.video.shotHeaderPrefix ?? '无字幕无BGM').trim().slice(0, 4000),
      portraitBypass: cfg.video.portraitBypass === true,
      xiaoyunqueModel: cfg.video.xiaoyunqueModel,
      xiaoyunqueAccountId: cfg.video.xiaoyunqueAccountId || '',
      dreaminaModel: cfg.video.dreaminaModel,
      dreaminaSession: cfg.video.dreaminaSession || '0',
      dreaminaAgentAccountId: cfg.video.dreaminaAgentAccountId || '',
      dreaminaAgentHeadless: cfg.video.dreaminaAgentHeadless === true,
      dreaminaAgentPromptPreset: cfg.video.dreaminaAgentPromptPreset === 'fast' ? 'fast' : 'standard',
      dreaminaAgentShotIntervalSeconds: Math.max(10, Math.min(3600, Math.floor(Number(cfg.video.dreaminaAgentShotIntervalSeconds) || 80))),
      libtvModel: cfg.video.libtvModel === 'Seedance 2.0' ? 'Seedance 2.0 VIP' : (cfg.video.libtvModel || 'Seedance 2.0 VIP'),
      libtvProjectUuid: String(cfg.video.libtvProjectUuid || '').trim(),
      libtvConcurrency: Math.max(1, Math.min(10, Number(cfg.video.libtvConcurrency) || 3)),
      updreamBaseUrl: cfg.video.updreamBaseUrl || 'https://www.updream.cn/api',
      updreamAccessToken: cfg.video.updreamAccessToken,
      updreamRefreshToken: cfg.video.updreamRefreshToken,
      updreamModel: cfg.video.updreamModel || 'sed2-fast',
      updreamConcurrency: normalizePositiveInteger(cfg.video.updreamConcurrency),
      neowowBaseUrl: cfg.video.neowowBaseUrl || 'https://neowow.cn',
      neowowToken: cfg.video.neowowToken,
      neowowAccountId: cfg.video.neowowAccountId || '',
      neowowModel: cfg.video.neowowModel || 'neo-video-2-0-fast',
      neowowConcurrency: normalizePositiveInteger(cfg.video.neowowConcurrency, 15),
      neowowAttachActivityVideo: cfg.video.neowowAttachActivityVideo === true,
      comfyuiBaseUrl: String(cfg.video.comfyuiBaseUrl || '').trim(),
      comfyuiWorkflow: String(cfg.video.comfyuiWorkflow || '').trim(),
      comfyuiWorkflowPreset: ['u09', 'u07'].includes(String(cfg.video.comfyuiWorkflowPreset || '').trim()) ? cfg.video.comfyuiWorkflowPreset : 'u09',
      comfyuiConcurrency: Math.max(1, Math.min(3, Number(cfg.video.comfyuiConcurrency) || 1)),
      apiBaseUrl: cfg.video.apiBaseUrl || DEFAULT_VIDEO_API_BASE_URL,
      apiProtocol: normalizeVideoApiProtocol(cfg.video.apiProtocol, cfg.video.apiBaseUrl),
      apiKey: cfg.video.apiKey,
      apiModel: String(cfg.video.apiModel ?? '').trim(),
      imageUpload: {
        provider: cfg.video.imageUpload?.provider || 'none',
        freeProvider: cfg.video.imageUpload?.freeProvider || 'auto',
        freeExpiry: cfg.video.imageUpload?.freeExpiry || '24h',
        imgbbApiKey: cfg.video.imageUpload?.imgbbApiKey || '',
        endpoint: String(cfg.video.imageUpload?.endpoint || '').trim(),
        customFileField: String(cfg.video.imageUpload?.customFileField || 'file').trim(),
        customUrlPath: String(cfg.video.imageUpload?.customUrlPath || '').trim(),
        customAuthHeader: String(cfg.video.imageUpload?.customAuthHeader || 'Authorization').trim(),
        customAuthScheme: String(cfg.video.imageUpload?.customAuthScheme ?? 'Bearer').trim(),
        customToken: cfg.video.imageUpload?.customToken || '',
        bucket: String(cfg.video.imageUpload?.bucket || '').trim(),
        region: String(cfg.video.imageUpload?.region || '').trim(),
        accountId: String(cfg.video.imageUpload?.accountId || '').trim(),
        accessKeyId: cfg.video.imageUpload?.accessKeyId || '',
        secretAccessKey: cfg.video.imageUpload?.secretAccessKey || '',
        sessionToken: cfg.video.imageUpload?.sessionToken || '',
        publicBaseUrl: String(cfg.video.imageUpload?.publicBaseUrl || '').trim(),
        pathPrefix: String(cfg.video.imageUpload?.pathPrefix || 'video-api').trim(),
        signedUrlTtlHours: Math.max(1, Math.min(168, Number(cfg.video.imageUpload?.signedUrlTtlHours) || 24)),
      },
      aspectRatio: cfg.video.aspectRatio,
      resolution: allowedVideoResolution(
        cfg.video.provider,
        videoModelForProvider(cfg.video, cfg.video.provider),
        cfg.video.resolution,
      ),
      videoMode: cfg.video.videoMode === 'label' ? 'label' : 'mention',
      duration: Math.max(5, Math.min(500, Number(cfg.video.duration) || 15)),
      pricePerSecond: Number(cfg.video.pricePerSecond) || 0,
      upstreamAccessToken: cfg.video.upstreamAccessToken || '',
      upstreamUserId: cfg.video.upstreamUserId || '',
      upstreamBaseUrl: cfg.video.upstreamBaseUrl || 'https://rolldek.com',
      feituoLedgerCookie: cfg.video.feituoLedgerCookie || '',
      apiChannels: cfg.video.apiChannels,
      apiActiveChannelId: cfg.video.apiActiveChannelId,
      apiFallbackChannelIds: cfg.video.apiFallbackChannelIds,
      apiAutoFallback: cfg.video.apiAutoFallback !== false,
      apiRetryCount: Number(cfg.video.apiRetryCount) || 0,
    },
    jianying: {
      draftDir: cfg.jianying.draftDir || '',
    },
    costTracking: cfg.costTracking,
    appearance: {
      theme: cfg.appearance?.theme || 'dark',
      uiScale: Math.min(1.5, Math.max(.85, Number(cfg.appearance?.uiScale) || 1)),
    },
    generationSafety: {
      videoGuardEnabled: cfg.generationSafety?.videoGuardEnabled === true,
      videoGuardSeconds: Math.max(1, Math.min(120, Math.floor(Number(cfg.generationSafety?.videoGuardSeconds) || 10))),
    },
    performance: {
      hardwareAcceleration: cfg.performance?.hardwareAcceleration !== false,
      reduceMotion: cfg.performance?.reduceMotion === true,
    },
    storage: {
      rootPath: String(cfg.storage?.rootPath || cfg.storage?.defaultRootPath || '').trim(),
    },
    promptLibrary: cfg.promptLibrary,
    gateway: cfg.gateway,
  };
}

export function buildAutosaveSettingsPayload(cfg) {
  const payload = buildSettingsPayload(cfg);
  delete payload.storage;
  return payload;
}

export async function saveSettingsFlow(handlers = {}) {
  if (handlers.isSaving()) return false;
  handlers.setSaving(true);
  try {
    await handlers.nextTick();
    const result = await handlers.saveConfig(buildSettingsPayload(handlers.config()));
    if (!result.ok) {
      handlers.error(result.error || '保存失败');
      return false;
    }
    if (result.storage) Object.assign(handlers.config().storage, result.storage);
    if (result.restartRequired) {
      handlers.success('\u6570\u636e\u5df2\u8fc1\u79fb\uff0c\u6b63\u5728\u91cd\u542f\u5e94\u7528');
      if (handlers.restartApp) window.setTimeout(() => handlers.restartApp(), 500);
      return true;
    }
    handlers.success('\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
    const project = handlers.project();
    if (!project?.id) return true;
    const style = handlers.validStyle(handlers.projectStyle())
      ? handlers.projectStyle()
      : (handlers.config().style || 'realistic');
    const rebuilt = await handlers.rebuildProjectStyle({ projectId: project.id, style });
    if (!rebuilt.ok) return;
    const fresh = await handlers.fetchProject(project.id);
    if (fresh.project) {
      handlers.setProject(fresh.project);
      handlers.syncProjectStyle();
      handlers.syncCharacterImageMode();
    }
    return true;
  } catch (error) {
    handlers.error(`保存失败：${error?.message || error}`);
    return false;
  } finally {
    handlers.setSaving(false);
  }
}

export function createSaveSettingsRuntimeContext({ api, message, refs = {}, helpers = {}, options = {} } = {}) {
  return {
    ...message,
    config: () => refs.config,
    isSaving: () => refs.saving.value,
    setSaving: (value) => { refs.saving.value = value; },
    nextTick: helpers.nextTick,
    saveConfig: (payload) => api.post('/api/config', payload),
    project: () => refs.project.value,
    projectStyle: () => refs.projectStyle.value,
    validStyle: (style) => (options.styleOptions || []).some((option) => option.value === style),
    rebuildProjectStyle: (payload) => api.post('/api/project/style', payload),
    fetchProject: (projectId) => api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    setProject: (value) => { refs.project.value = helpers.hydrateImageState(value); },
    syncProjectStyle: helpers.syncProjectStyle,
    syncCharacterImageMode: helpers.syncCharacterImageMode,
    restartApp: helpers.restartApp,
  };
}

export function createSaveSettingsRuntime({ api, message, refs = {}, helpers = {}, options = {} } = {}) {
  const context = createSaveSettingsRuntimeContext({ api, message, refs, helpers, options });
  return () => saveSettingsFlow(context);
}

export async function changeProjectStyleFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const style = handlers.validStyle(handlers.projectStyle()) ? handlers.projectStyle() : 'realistic';
  const result = await handlers.changeStyle({ projectId: project.id, style });
  if (!result.ok) return handlers.error(result.error || '保存风格失败');
  handlers.setProjectImageStyle(result.imageStyle);
  const fresh = await handlers.fetchProject(project.id);
  if (fresh.project) {
    handlers.setHydratedProject(fresh.project);
    handlers.syncCharacterImageMode();
  }
  handlers.success(`已切换风格，已更新 ${result.rebuilt || 0} 个元素提示词`);
}

export function createChangeProjectStyleRuntimeContext({ api, message, refs = {}, helpers = {}, options = {} } = {}) {
  return {
    ...message,
    project: () => refs.project.value,
    projectStyle: () => refs.projectStyle.value,
    validStyle: (style) => (options.styleOptions || []).some((option) => option.value === style),
    changeStyle: (payload) => api.post('/api/project/style', payload),
    setProjectImageStyle: (imageStyle) => { refs.project.value.imageStyle = imageStyle; },
    fetchProject: (projectId) => api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    setHydratedProject: (value) => {
      const keep = { _globalRefV: refs.project.value._globalRefV };
      refs.project.value = helpers.hydrateImageState(value);
      refs.project.value._globalRefV = keep._globalRefV || refs.project.value._globalRefV;
    },
    syncCharacterImageMode: helpers.syncCharacterImageMode,
  };
}

export function normalizeProjectStyleChoice(project, cfg = {}, options = {}) {
  const value = project?.imageStyle || cfg.style || 'realistic';
  return (options.styleOptions || []).some((option) => option.value === value) ? value : 'realistic';
}

export function normalizeCharacterImageModeChoice(project, options = {}) {
  const value = project?.characterImageMode || 'double';
  return (options.characterImageModeOptions || []).some((option) => option.value === value) ? value : 'double';
}

export async function changeCharacterImageModeFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const imageMode = handlers.validImageMode(handlers.characterImageMode()) ? handlers.characterImageMode() : 'double';
  const result = await handlers.changeImageMode({ projectId: project.id, imageMode });
  if (!result.ok) return handlers.error(result.error || '保存人物出图模式失败');
  handlers.setProjectCharacterImageMode(result.imageMode);
  const label = handlers.imageModeLabel(result.imageMode) || '脸部+全身';
  handlers.success(`人物出图模式已切换为「${label}」，下次生成立即生效`);
}

export function createProjectVisualSettingsRuntime({ api, message, refs = {}, helpers = {}, options = {} } = {}) {
  const syncProjectStyle = () => {
    refs.projectStyle.value = normalizeProjectStyleChoice(refs.project.value, refs.config, {
      styleOptions: options.styleOptions,
    });
  };
  const syncCharacterImageMode = () => {
    refs.characterImageMode.value = normalizeCharacterImageModeChoice(refs.project.value, {
      characterImageModeOptions: options.characterImageModeOptions,
    });
  };
  const onProjectStyleChange = () => changeProjectStyleFlow(createChangeProjectStyleRuntimeContext({
    api,
    message,
    refs: { project: refs.project, projectStyle: refs.projectStyle },
    helpers: { hydrateImageState: helpers.hydrateImageState, syncCharacterImageMode },
    options: { styleOptions: options.styleOptions },
  }));
  const onCharacterImageModeChange = () => changeCharacterImageModeFlow({
    ...message,
    project: () => refs.project.value,
    characterImageMode: () => refs.characterImageMode.value,
    validImageMode: (imageMode) => (options.characterImageModeOptions || []).some((option) => option.value === imageMode),
    changeImageMode: (payload) => api.post('/api/project/character-image-mode', payload),
    setProjectCharacterImageMode: (imageMode) => { refs.project.value.characterImageMode = imageMode; },
    imageModeLabel: (imageMode) => options.characterImageModeLabels?.[imageMode],
  });

  return {
    syncProjectStyle,
    syncCharacterImageMode,
    onProjectStyleChange,
    onCharacterImageModeChange,
  };
}

export async function testSettingsConnectionFlow(kind, handlers) {
  const { cfg, testing, testResult, api, nextTick } = handlers;
  if (testing[kind]) return;
  testing[kind] = true;
  testResult[kind] = null;
  await nextTick();

  const endpoint = kind === 'text' ? '/api/test/text' : '/api/test/image';
  const src = cfg[kind] || {};
  const body = { baseUrl: src.baseUrl, apiKey: src.apiKey, model: src.model };
  try {
    const r = await api.post(endpoint, body);
    if (r.ok) {
      testResult[kind] = {
        ok: true,
        msg: kind === 'image'
          ? `连接成功，已出图 ${(r.bytes / 1024).toFixed(0)} KB`
          : `连接成功，模型回复：${r.sample}`,
      };
    } else {
      testResult[kind] = { ok: false, msg: `失败：${r.error}` };
    }
  } catch (e) {
    testResult[kind] = { ok: false, msg: `请求出错：${e.message}` };
  } finally {
    testing[kind] = false;
  }
}

export function createAppSettingsRuntime({
  api,
  message,
  refs = {},
  helpers = {},
  options = {},
  reactive,
  ref,
  computed,
  watch,
} = {}) {
  const state = createSettingsStateRuntime({ reactive, ref, computed });
  const settingsAutosave = reactive({ ready: false, saving: false, savedAt: 0, error: '' });
  const secondPromptSetUnlocked = ref(false);
  const registerSecondPromptSetSaveClick = createConsecutiveClickUnlock();
  // 渠道「列表 + 抽屉详情」：抽屉只编辑当前选中的那条渠道
  const imageChannelDrawerId = ref('');
  const videoApiChannelDrawerId = ref('');
  const imageChannelDrawerChannel = computed(() => (state.cfg.image.channels || []).find((item) => item.id === imageChannelDrawerId.value) || null);
  const videoApiChannelDrawerChannel = computed(() => (state.cfg.video.apiChannels || []).find((item) => item.id === videoApiChannelDrawerId.value) || null);
  const openImageChannelDrawer = (channel) => { imageChannelDrawerId.value = channel?.id || ''; };
  const closeImageChannelDrawer = () => { imageChannelDrawerId.value = ''; };
  const openVideoApiChannelDrawer = (channel) => { videoApiChannelDrawerId.value = channel?.id || ''; };
  const closeVideoApiChannelDrawer = () => { videoApiChannelDrawerId.value = ''; };
  let autosaveTimer = null;
  let autosaveSnapshot = '';
  const normalizeVideoDurationSettings = () => {
    state.cfg.video.duration = Math.max(5, Math.min(500, Math.round(Number(state.cfg.video.duration) || 15)));
  };
  const textModelChoices = computed(() => discoveredModelOptions(
    options.textModelOptions,
    state.cfg.text.models,
    [state.cfg.text.model],
  ));
  const libtvImageModelOptions = reactive([
    { label: 'Lib Image', value: 'Lib Image', description: '最新图片模型、长文本能力突出' },
    { label: 'Lib Navo Pro', value: 'Lib Navo Pro', description: '图片编辑与一致性能力较强' },
  ]);
  const updreamImageModelOptions = reactive([
    { label: '香蕉 2 (限时低价)', value: 'cheap-b-2', ratios: ['1:1', '16:9', '9:16'], resolutions: ['1K', '2K', '4K'], defaultResolution: '1K', qualities: [], defaultQuality: '' },
    { label: '香蕉 2 Lite', value: 'b-2-lite', ratios: ['1:1', '16:9', '9:16'], resolutions: ['1K'], defaultResolution: '1K', qualities: [], defaultQuality: '' },
    { label: 'Gimage 2', value: 'gpt-image-2', ratios: ['1:1', '16:9', '9:16'], resolutions: ['1K', '2K', '4K'], defaultResolution: '1K', qualities: ['low', 'medium', 'high'], defaultQuality: 'medium' },
  ]);
  const neowowImageModelOptions = reactive([
    { label: 'Neo Image 2', value: 'gpt-image-2', resolutions: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high'], ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1'] },
    { label: 'Neo Image 2 official', value: 'gpt-image-2-official', resolutions: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high'], ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1'] },
    { label: 'Seedream 5.0 Pro', value: 'doubao-seedream-5-0-pro-260628', resolutions: ['1K', '2K'], ratios: ['9:16', '16:9', '4:3', '3:4', '1:1', '3:2', '2:3', '21:9'] },
    { label: 'Qwen-Image 3.0 Pro', value: 'qwen-image-3.0-pro', resolutions: ['1k', '2k'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5'] },
    { label: 'Neo Nano Pro', value: 'gemini-3-pro-image-preview', resolutions: ['2K', '4K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], membershipRequired: true },
    { label: 'Neo Nano 2', value: 'gemini-3.1-flash-image-preview', resolutions: ['1K', '2K', '4K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'] },
    { label: 'Neo Mj-v8.2', value: 'Midjourney-v 8.2', resolutions: ['1K', '2K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], imageCountOptions: ['4', '4'], discountRate: 0.6 },
    { label: 'Neo Mj-v8.1', value: 'Midjourney-v 8.1', resolutions: ['1K', '2K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], imageCountOptions: ['4', '4'], discountRate: 0.6 },
    { label: 'Neo Mj-v7', value: 'Midjourney-v 7', resolutions: ['1K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], imageCountOptions: ['4', '4'], discountRate: 0.6 },
    { label: 'Neo Mj-niji7', value: 'Midjourney-niji 7', resolutions: ['1K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], imageCountOptions: ['4', '4'], discountRate: 0.6 },
    { label: 'Seedream 5.0', value: 'doubao-seedream-5-0-260128', resolutions: ['2K', '3K'], ratios: ['9:16', '16:9', '4:3', '3:4', '1:1'] },
    { label: 'Seedream 4.5', value: 'doubao-seedream-4-5-251128', resolutions: ['2K', '4K'], ratios: ['9:16', '16:9', '4:3', '3:4', '1:1'] },
    { label: 'Seedream 4.0', value: 'doubao-seedream-4-0-250828', resolutions: ['2K', '4K'], ratios: ['9:16', '16:9', '4:3', '3:4', '1:1'] },
    { label: 'Neo Nano 2 Lite', value: 'gemini-3.1-flash-lite-image', resolutions: ['1K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'] },
    { label: 'Neo Nano', value: 'gemini-2.5-flash-image', resolutions: ['1K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'] },
    { label: 'Wan 2.7 Image Pro', value: 'wan2.7-image-pro', resolutions: ['1K', '2K'], ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5'] },
  ]);
  const selectedUpdreamImageModel = computed(() => updreamImageModelOptions
    .find((item) => item.value === state.cfg.image.updreamModel) || null);
  const updreamImageResolutionOptions = computed(() => (selectedUpdreamImageModel.value?.resolutions || [])
    .map((value) => ({ label: value, value })));
  const updreamImageQualityOptions = computed(() => (selectedUpdreamImageModel.value?.qualities || [])
    .map((value) => ({ label: value === 'low' ? '低' : value === 'high' ? '高' : value === 'medium' ? '标准' : value, value })));
  const selectedNeowowImageModel = computed(() => neowowImageModelOptions
    .find((item) => item.value === state.cfg.image.neowowModel) || null);
  const neowowImageResolutionOptions = computed(() => (selectedNeowowImageModel.value?.resolutions || ['1K', '2K', '4K'])
    .map((value) => ({ label: String(value).toUpperCase(), value })));
  const neowowImageQualityOptions = computed(() => (selectedNeowowImageModel.value?.qualities || [])
    .map((value) => ({ label: value === 'low' ? '低' : value === 'high' ? '高' : value === 'medium' ? '标准' : value, value })));
  const neowowImageRatioOptions = computed(() => (selectedNeowowImageModel.value?.ratios || ['1:1', '16:9', '9:16', '4:3', '3:4'])
    .map((value) => ({ label: value, value })));
  const onNeowowImageModelChange = () => {
    const resolutions = neowowImageResolutionOptions.value.map((item) => item.value);
    if (!resolutions.some((value) => String(value).toUpperCase() === String(state.cfg.image.neowowResolution).toUpperCase())) {
      state.cfg.image.neowowResolution = resolutions[0] || '1K';
    }
    const qualities = neowowImageQualityOptions.value.map((item) => item.value);
    state.cfg.image.neowowQuality = qualities.includes(state.cfg.image.neowowQuality) ? state.cfg.image.neowowQuality : (qualities[0] || '');
    const ratios = neowowImageRatioOptions.value.map((item) => item.value);
    if (!ratios.includes(state.cfg.image.ratio)) state.cfg.image.ratio = ratios.includes('16:9') ? '16:9' : ratios[0];
  };
  const onImageProviderChange = (provider) => {
    if (provider !== 'neowow') return;
    state.cfg.image.neowowModel = 'gpt-image-2';
    state.cfg.image.neowowResolution = '1K';
    state.cfg.image.neowowQuality = 'low';
    onNeowowImageModelChange();
  };
  const dreaminaImageModelOptions = reactive([
    { label: '即梦 3.0（仅文生图）', value: '3.0' },
    { label: '即梦 3.1（仅文生图）', value: '3.1' },
    { label: '即梦 4.0', value: '4.0' },
    { label: '即梦 4.1', value: '4.1' },
    { label: '即梦 4.5', value: '4.5' },
    { label: '即梦 4.6', value: '4.6' },
    { label: '即梦 4.7', value: '4.7' },
    { label: '即梦 5.0', value: '5.0' },
    { label: '即梦 5.0 Pro', value: '5.0Pro' },
  ]);
  const selectedDreaminaImageModel = computed(() => dreaminaImageModelOptions
    .find((item) => item.value === state.cfg.image.dreaminaModel) || dreaminaImageModelOptions[7]);
  const dreaminaImageResolutionOptions = computed(() => {
    const model = selectedDreaminaImageModel.value?.value || '5.0';
    const values = model === '5.0Pro' ? ['1k', '2k', '4k'] : (['3.0', '3.1'].includes(model) ? ['1k', '2k'] : ['2k', '4k']);
    return values.map((value) => ({ label: value.toUpperCase(), value }));
  });
  const onDreaminaImageModelChange = () => {
    const values = dreaminaImageResolutionOptions.value.map((item) => item.value);
    if (!values.includes(state.cfg.image.dreaminaResolution)) state.cfg.image.dreaminaResolution = values[0];
  };
  const characterImageModeLabels = Object.fromEntries((options.characterImageModeOptions || []).map((item) => [item.value, item.label]));
  const {
    syncAll: syncSettingsChoices,
    onTextBaseUrlChoiceChange,
    onTextModelChoiceChange,
    onImageModelChoiceChange,
    onStyleChoiceChange,
  } = createSettingsChoiceController(state.cfg, {
    textBaseUrlChoice: state.textBaseUrlChoice,
    textModelChoice: state.textModelChoice,
    imageModelChoice: state.imageModelChoice,
    styleChoice: state.styleChoice,
  }, {
    textBaseUrlOptions: options.textBaseUrlOptions,
    textModelOptions: options.textModelOptions,
    imageBaseUrlOptions: options.imageBaseUrlOptions,
    imageModelOptions: options.imageModelOptions,
    styleOptions: options.styleOptions,
  });

  const loadSettingsBase = createLoadSettingsRuntime({
    api,
    refs: { config: state.cfg, imageRatio: state.imageRatio },
    helpers: {
      characterPartKeys: helpers.characterPartKeys,
      syncSettingsChoices,
      refreshXiaoyunqueCliStatus: helpers.refreshXiaoyunqueCliStatus,
      refreshDreaminaCliStatus: helpers.refreshDreaminaCliStatus,
      refreshDreaminaAgentStatus: helpers.refreshDreaminaAgentStatus,
      refreshLibtvCliStatus: helpers.refreshLibtvCliStatus,
    },
  });
  const loadStoryboardPromptTemplates = createLoadStoryboardPromptTemplatesRuntime({
    api,
    refs: { templates: state.storyboardPromptTemplates, selectedTemplateId: state.storyboardPromptTemplateId },
    helpers: { warn: helpers.warn },
  });
  const settingsSaveContext = createSaveSettingsRuntimeContext({
    api,
    message,
    refs: { config: state.cfg, saving: state.saving, project: refs.project, projectStyle: refs.projectStyle },
    helpers: {
      nextTick: helpers.nextTick,
      hydrateImageState: helpers.hydrateImageState,
      syncProjectStyle: helpers.syncProjectStyle,
      syncCharacterImageMode: helpers.syncCharacterImageMode,
      restartApp: helpers.restartApp,
    },
    options: { styleOptions: options.styleOptions },
  });
  const saveSettingsBase = () => saveSettingsFlow(settingsSaveContext);
  const autosaveSignature = () => JSON.stringify(buildAutosaveSettingsPayload(state.cfg));
  const promptSettingsSignature = () => JSON.stringify({
    stylePrompts: state.cfg.stylePrompts,
    promptTemplate: state.cfg.promptTemplate,
  });
  let appliedPromptSettingsSnapshot = '';
  const refreshCurrentProjectPrompts = async () => {
    const project = settingsSaveContext.project();
    if (!project?.id) return;
    const style = settingsSaveContext.validStyle(settingsSaveContext.projectStyle())
      ? settingsSaveContext.projectStyle()
      : (state.cfg.style || 'realistic');
    const rebuilt = await settingsSaveContext.rebuildProjectStyle({ projectId: project.id, style });
    if (!rebuilt.ok) throw new Error(rebuilt.error || '更新项目提示词失败');
    const fresh = await settingsSaveContext.fetchProject(project.id);
    if (fresh.project && settingsSaveContext.project()?.id === project.id) {
      settingsSaveContext.setProject(fresh.project);
      settingsSaveContext.syncProjectStyle();
      settingsSaveContext.syncCharacterImageMode();
    }
  };
  const scheduleAutosave = () => {
    if (!settingsAutosave.ready) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      autosaveTimer = null;
      const signature = autosaveSignature();
      if (signature === autosaveSnapshot) return;
      if (settingsAutosave.saving || state.saving.value) return scheduleAutosave();
      settingsAutosave.saving = true;
      settingsAutosave.error = '';
      try {
        const nextPromptSettingsSnapshot = promptSettingsSignature();
        const shouldRefreshPrompts = nextPromptSettingsSnapshot !== appliedPromptSettingsSnapshot;
        const result = await api.post('/api/config', buildAutosaveSettingsPayload(state.cfg));
        if (!result.ok) throw new Error(result.error || '保存失败');
        if (shouldRefreshPrompts) await refreshCurrentProjectPrompts();
        autosaveSnapshot = signature;
        appliedPromptSettingsSnapshot = nextPromptSettingsSnapshot;
        settingsAutosave.savedAt = Date.now();
      } catch (error) {
        const detail = error?.message || String(error);
        settingsAutosave.error = detail;
        message.error(`自动保存失败：${detail}`);
      } finally {
        settingsAutosave.saving = false;
      }
    }, 800);
  };
  const persistDefaultVideoProvider = createDefaultVideoProviderPersistence({
    saveProvider: (provider) => api.post('/api/config', { video: { provider } }),
    onError: (error) => message.error(`视频渠道保存失败：${error?.message || error}`),
  });
  let pendingDefaultVideoProviderWrites = 0;
  let neowowBootstrapRefreshStarted = false;
  const refreshInitialNeowowProfiles = () => {
    if (neowowBootstrapRefreshStarted) return;
    const accounts = (state.cfg.video.neowowAccounts || [])
      .filter((account) => account.hasToken && !account.pointsUpdatedAt);
    if (!accounts.length) return;
    neowowBootstrapRefreshStarted = true;
    void (async () => {
      for (const account of accounts) {
        await api.post('/api/neowow/accounts/refresh', { accountId: account.id }).catch(() => null);
      }
      const result = await api.get('/api/neowow/accounts').catch(() => null);
      if (!result) return;
      if (Array.isArray(result.accounts)) state.cfg.video.neowowAccounts = result.accounts;
      if (result.accountId !== undefined) state.cfg.video.neowowAccountId = result.accountId || '';
      state.cfg.video.neowowHasToken = state.cfg.video.neowowAccounts.some((account) => account.hasToken);
      if (!state.cfg.video.neowowAccounts.some((account) => account.id === state.cfg.image.neowowAccountId)) {
        state.cfg.image.neowowAccountId = state.cfg.video.neowowAccountId || state.cfg.video.neowowAccounts[0]?.id || '';
      }
    })();
  };
  const rememberDefaultVideoProvider = (provider) => {
    state.cfg.video.provider = normalizeVideoProvider(provider);
    if (['updream', 'neowow'].includes(state.cfg.video.provider)) {
      state.cfg.video.resolution = allowedVideoResolution(
        state.cfg.video.provider,
        videoModelForProvider(state.cfg.video, state.cfg.video.provider),
        '',
      );
    }
    if (state.cfg.video.provider === 'neowow') state.cfg.video.duration = 15;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    pendingDefaultVideoProviderWrites += 1;
    return persistDefaultVideoProvider(state.cfg.video.provider).finally(() => {
      pendingDefaultVideoProviderWrites -= 1;
      if (pendingDefaultVideoProviderWrites === 0) scheduleAutosave();
    });
  };
  const loadSettings = async () => {
    settingsAutosave.ready = false;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    await loadSettingsBase();
    syncAllImageChannelBaseUrlChoices();
    refreshInitialNeowowProfiles();
    if (state.cfg.image.neowowAccountId || state.cfg.video.neowowAccountId) {
      void fetchNeowowImageModels({ notify: false });
    }
    await helpers.nextTick();
    autosaveSnapshot = autosaveSignature();
    appliedPromptSettingsSnapshot = promptSettingsSignature();
    settingsAutosave.ready = true;
  };
  const saveSettings = async () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    const saved = await saveSettingsBase();
    if (saved) {
      autosaveSnapshot = autosaveSignature();
      appliedPromptSettingsSnapshot = promptSettingsSignature();
      settingsAutosave.savedAt = Date.now();
      settingsAutosave.error = '';
    }
  };
  const onSaveSettingsClick = () => {
    if (!secondPromptSetUnlocked.value && registerSecondPromptSetSaveClick()) {
      secondPromptSetUnlocked.value = true;
    }
    return saveSettings();
  };
  const autosaveStatusText = computed(() => {
    if (settingsAutosave.saving) return '自动保存中...';
    if (settingsAutosave.error) return '自动保存失败';
    if (settingsAutosave.savedAt) return '已自动保存';
    return '自动保存已开启';
  });
  watch?.(autosaveSignature, scheduleAutosave);
  const testConn = (kind) => testSettingsConnectionFlow(kind, {
    cfg: state.cfg,
    testing: state.testing,
    testResult: state.testResult,
    api,
    nextTick: helpers.nextTick,
  });
  const testImageUpload = async () => {
    if (state.testing.imageUpload) return;
    state.testing.imageUpload = true;
    state.testResult.imageUpload = null;
    try {
      const imageUpload = buildSettingsPayload(state.cfg).video.imageUpload;
      const result = await api.post('/api/video/image-host/test', { imageUpload });
      state.testResult.imageUpload = result;
      if (result.ok) message.success(`图床测试成功：${result.host || '图片链接可访问'}`);
      else message.error(`图床测试失败：${result.error || '未知错误'}`);
    } catch (error) {
      state.testResult.imageUpload = { ok: false, error: error.message };
      message.error(`图床测试失败：${error.message}`);
    } finally {
      state.testing.imageUpload = false;
    }
  };
  const detectingJianyingDir = ref(false);
  const detectJianyingDir = createDetectJianyingDirRuntime({
    api,
    message,
    refs: { detecting: detectingJianyingDir, config: state.cfg },
  });
  const choosingStorageDirectory = ref(false);
  const chooseStorageDirectory = async () => {
    if (!helpers.chooseStorageDirectory || choosingStorageDirectory.value) return;
    choosingStorageDirectory.value = true;
    try {
      const selected = await helpers.chooseStorageDirectory(state.cfg.storage.rootPath);
      if (!selected?.canceled && selected?.path) {
        state.cfg.storage.rootPath = selected.path;
        state.cfg.storage.isDefault = String(selected.path).toLowerCase() === String(state.cfg.storage.defaultRootPath).toLowerCase();
      }
    } catch (error) {
      message.error(`Failed to open folder: ${error?.message || error}`);
    } finally {
      choosingStorageDirectory.value = false;
    }
  };
  const resetStorageDirectory = () => {
    state.cfg.storage.rootPath = state.cfg.storage.defaultRootPath || state.cfg.storage.rootPath;
    state.cfg.storage.isDefault = true;
  };
  const openStorageDirectory = async () => {
    try {
      const result = await helpers.openStorageDirectory?.(state.cfg.storage.rootPath);
      if (result && result.ok === false) message.error(result.error || 'Failed to open folder');
    } catch (error) {
      message.error(`Failed to open folder: ${error?.message || error}`);
    }
  };
  const showStorageStatusInfo = () => {
    message.info('“跟随软件位置”仅用于展示当前存储状态；如需修改，请使用“选择目录”或“恢复默认位置”。');
  };

  const apiBaseUrlLink = (value) => {
    const raw = String(value || '').trim();
    const presets = [...(options.textBaseUrlOptions || []), ...(options.imageBaseUrlOptions || [])];
    const preset = presets.find((item) => String(item?.value || '').trim().replace(/\/+$/, '') === raw.replace(/\/+$/, ''));
    try {
      const url = new URL(String(preset?.websiteUrl || raw).trim());
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
  };
  const openApiBaseUrl = async (value, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const targetUrl = apiBaseUrlLink(value);
    if (!targetUrl) return message.warning('请先填写有效的 HTTP 或 HTTPS 地址');
    if (typeof helpers.openExternalUrl !== 'function') return message.warning('当前环境无法打开系统浏览器');
    try {
      const result = await helpers.openExternalUrl(targetUrl);
      if (result?.ok === false) return message.error(result.error || '打开网址失败');
      return result;
    } catch (error) {
      return message.error(`打开网址失败：${error?.message || error}`);
    }
  };

  const uniqueChannelId = (prefix, list) => {
    const used = new Set((list || []).map((item) => item.id));
    let index = (list || []).length + 1;
    let id = `${prefix}-${index}`;
    while (used.has(id)) id = `${prefix}-${++index}`;
    return id;
  };
  const imageResolutionOptions = [
    { label: '1K', value: '1K' },
    { label: '2K', value: '2K' },
    { label: '4K', value: '4K' },
  ];
  const isGeekNowImageChannel = (channel = {}) => {
    try {
      const hostname = new URL(String(channel.baseUrl || '')).hostname.toLowerCase();
      return hostname === 'geeknow.ai'
        || hostname.endsWith('.geeknow.ai')
        || hostname === 'geeknow.top'
        || hostname.endsWith('.geeknow.top');
    } catch {
      return /geeknow\.(?:ai|top)/i.test(String(channel.baseUrl || ''));
    }
  };
  const isGrsaiImageChannel = (channel = {}) => {
    return isGrsaiImageBaseUrl(channel.baseUrl);
  };
  const imageResolutionOptionsForChannel = (channel = {}) => {
    return imageChannelSupportsResolution(channel)
      ? imageResolutionOptions
      : [];
  };
  const onImageChannelBaseUrlChange = (channel) => {
    channel.models = [];
    if (isGrsaiImageChannel(channel)) {
      const models = options.grsaiImageModelOptions || [];
      if (!models.some((item) => item.value === channel.model)) channel.model = models[0]?.value || 'gpt-image-2';
      if (!['1K', '2K', '4K'].includes(String(channel.resolution || '').toUpperCase())) channel.resolution = '1K';
    }
    onImageChannelModelChange(channel);
  };
  // Per-channel base URL selector. Mirrors the text model pattern: pick a preset
  // or "custom" to reveal a free-form input. The choice map is keyed by
  // channel.id so multiple channels can stay on different selections.
  const resolveImageChannelBaseUrlChoice = (channel) => {
    const value = String(channel?.baseUrl || '').trim();
    const presets = options.imageBaseUrlOptions || [];
    return presets.some((item) => item.value === value) ? value : 'custom';
  };
  const onImageChannelBaseUrlChoiceSelect = (channel, value) => {
    const choice = value === 'custom' ? 'custom' : String(value || '').trim();
    state.imageChannelBaseUrlChoice[channel.id] = choice;
    if (choice && choice !== 'custom') {
      channel.baseUrl = choice;
      onImageChannelBaseUrlChange(channel);
    }
  };
  const syncAllImageChannelBaseUrlChoices = () => {
    const channels = state.cfg.image.channels || [];
    const known = new Set(channels.map((item) => item.id));
    for (const key of Object.keys(state.imageChannelBaseUrlChoice)) {
      if (!known.has(key)) delete state.imageChannelBaseUrlChoice[key];
    }
    for (const channel of channels) {
      state.imageChannelBaseUrlChoice[channel.id] = resolveImageChannelBaseUrlChoice(channel);
    }
  };
  // Same pattern for model: preset selector reflects channel.model only when it
  // matches one of the listed options; otherwise the always-visible input below
  // is the real source of truth.
  const imageChannelModelPresetSelection = (channel) => {
    const value = String(channel?.model || '').trim();
    if (!value) return '';
    const opts = imageModelOptionsForChannel(channel) || [];
    return opts.some((item) => item.value === value) ? value : '';
  };
  const onImageChannelModelPresetSelect = (channel, value) => {
    if (value) {
      channel.model = value;
    }
    onImageChannelModelChange(channel);
  };
  const onImageChannelModelChange = (channel) => {
    const model = String(channel.model || '').trim().toLowerCase();
    if (model === 'gpt-image-2') channel.resolution = '1K';
    else if (model === 'gpt-image-2-pro' && !['2K', '4K'].includes(channel.resolution)) channel.resolution = '2K';
    else if (model === 'gpt-image-2-vip' && !['1K', '2K', '4K'].includes(channel.resolution)) channel.resolution = '1K';
  };
  const onImageChannelResolutionChange = (channel) => {
    const resolution = String(channel.resolution || '').trim().toUpperCase();
    channel.resolution = ['1K', '2K', '4K'].includes(resolution) ? resolution : '1K';
    if (!isGeekNowImageChannel(channel)) return;
    const model = String(channel.model || '').trim().toLowerCase();
    if (channel.resolution === '1K' && model === 'gpt-image-2-pro') channel.model = 'gpt-image-2';
    if (channel.resolution !== '1K' && model === 'gpt-image-2') channel.model = 'gpt-image-2-pro';
  };
  const addImageChannel = () => {
    const index = state.cfg.image.channels.length + 1;
    const channel = {
      id: uniqueChannelId('image-channel', state.cfg.image.channels), name: `生图渠道 ${index}`, enabled: true,
      baseUrl: state.cfg.image.baseUrl || options.imageBaseUrlOptions?.[0]?.value || 'https://www.geeknow.top/v1', apiKey: '', model: state.cfg.image.model || 'gpt-image-2', models: [],
      resolution: state.cfg.image.resolution || '1K',
      pricePerImage: Number(state.cfg.image.pricePerImage) || 0,
    };
    state.cfg.image.channels.push(channel);
    state.imageChannelBaseUrlChoice[channel.id] = resolveImageChannelBaseUrlChoice(channel);
    if (!state.cfg.image.activeChannelId) state.cfg.image.activeChannelId = channel.id;
    syncImageChannelFallbacks();
    imageChannelDrawerId.value = channel.id;
  };
  const deleteImageChannel = (channel) => {
    if (state.cfg.image.channels.length <= 1) return message.warning('至少保留一个生图渠道');
    state.cfg.image.channels.splice(state.cfg.image.channels.findIndex((item) => item.id === channel.id), 1);
    delete state.imageChannelBaseUrlChoice[channel.id];
    if (state.cfg.image.activeChannelId === channel.id) state.cfg.image.activeChannelId = state.cfg.image.channels.find((item) => item.enabled)?.id || state.cfg.image.channels[0]?.id || '';
    syncImageChannelFallbacks();
  };
  const syncImageChannelFallbacks = () => {
    let enabled = state.cfg.image.channels.filter((item) => item.enabled);
    if (!enabled.length && state.cfg.image.channels.length) {
      state.cfg.image.channels[0].enabled = true;
      enabled = [state.cfg.image.channels[0]];
      message.warning('????????????');
    }
    if (!enabled.some((item) => item.id === state.cfg.image.activeChannelId)) state.cfg.image.activeChannelId = enabled[0]?.id || '';
    const valid = new Set(enabled.map((item) => item.id));
    const existing = Array.isArray(state.cfg.image.fallbackChannelIds) ? state.cfg.image.fallbackChannelIds : [];
    const ordered = [...existing, ...state.cfg.image.channels.map((item) => item.id)];
    state.cfg.image.fallbackChannelIds = [...new Set(ordered)].filter((id) => valid.has(id) && id !== state.cfg.image.activeChannelId);
  };
  const appendVideoApiChannel = (overrides = {}) => {
    const index = state.cfg.video.apiChannels.length + 1;
    const channel = {
      id: uniqueChannelId('video-api-channel', state.cfg.video.apiChannels), name: `视频 API 渠道 ${index}`, enabled: true,
      builtIn: false,
      apiBaseUrl: '', apiProtocol: VIDEO_API_PROTOCOL_OPENAI, apiKey: '', apiModel: '', apiModels: [],
      pricePerSecond: Number(state.cfg.video.pricePerSecond) || 0,
      ...overrides,
    };
    state.cfg.video.apiChannels.push(channel);
    if (!state.cfg.video.apiActiveChannelId) state.cfg.video.apiActiveChannelId = channel.id;
    syncVideoApiChannelFallbacks();
    return channel;
  };
  const imageModelOptionsForChannel = (channel) => discoveredModelOptions(
    isGrsaiImageChannel(channel) ? options.grsaiImageModelOptions : options.imageModelOptions,
    channel.models,
    [channel.model],
  );
  const fetchTextModels = async () => {
    if (state.testing.textModels) return;
    if (!String(state.cfg.text.baseUrl || '').trim()) return message.warning('请先填写文本模型 Base URL');
    if (!String(state.cfg.text.apiKey || '').trim()) return message.warning('请先填写文本模型 API Key');
    state.testing.textModels = true;
    try {
      const result = await api.post('/api/models/discover', {
        kind: 'text',
        baseUrl: state.cfg.text.baseUrl,
        apiKey: state.cfg.text.apiKey,
      });
      if (!result.ok) return message.error(result.error || '拉取文本模型失败');
      state.cfg.text.models = normalizeDiscoveredModelNames(result.models);
      if (!state.cfg.text.model && state.cfg.text.models.length) state.cfg.text.model = state.cfg.text.models[0];
      message.success(`已拉取 ${state.cfg.text.models.length} 个文本模型`);
    } catch (error) {
      message.error(`拉取文本模型失败：${error.message}`);
    } finally {
      state.testing.textModels = false;
    }
  };
  const fetchImageModels = async (channel, runtimeOptions = {}) => {
    const silent = runtimeOptions?.silent === true;
    const notify = (kind, text) => { if (!silent) message[kind](text); };
    if (state.testing.imageModels) return;
    if (!String(channel.baseUrl || '').trim()) return notify('warning', '请先填写图片模型 Base URL');
    if (isGrsaiImageChannel(channel)) {
      channel.models = (options.grsaiImageModelOptions || []).map((item) => item.value);
      if (!channel.models.includes(channel.model)) channel.model = channel.models[0] || 'gpt-image-2';
      onImageChannelModelChange(channel);
      syncImageChannelFallbacks();
      return notify('success', `${channel.name}：已加载 ${channel.models.length} 个内置图片模型`);
    }
    if (!String(channel.apiKey || '').trim()) return notify('warning', '请先填写图片模型 API Key');
    state.testing.imageModels = channel.id;
    try {
      const result = await api.post('/api/models/discover', {
        kind: 'image',
        channelId: channel.id,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
      });
      if (!result.ok) return notify('error', `${channel.name}：${result.error || '拉取图片模型失败'}`);
      channel.models = normalizeDiscoveredModelNames(result.models);
      if (!channel.model && channel.models.length) channel.model = channel.models[0];
      onImageChannelModelChange(channel);
      syncImageChannelFallbacks();
      notify('success', `${channel.name}：已拉取 ${channel.models.length} 个图片模型`);
    } catch (error) {
      notify('error', `${channel.name}：${error.message}`);
    } finally {
      state.testing.imageModels = '';
    }
  };

  // 自动发现：打开设置页时为「已填 Key 且尚未拉过模型」的图片渠道静默拉一次，
  // 让上游新增或改名的模型自动进入候选（失败静默，手动「拉取模型」按钮仍可用）。
  // 每个渠道在本会话内只自动拉一次，避免反复打开设置页时重复请求。
  const autoDiscoveredChannelIds = new Set();
  const autoDiscoverImageModels = async () => {
    const channels = Array.isArray(state.cfg.image?.channels) ? state.cfg.image.channels : [];
    const pending = channels.filter((channel) => channel
      && channel.enabled !== false
      && String(channel.apiKey || '').trim()
      && !(Array.isArray(channel.models) && channel.models.length)
      && !autoDiscoveredChannelIds.has(channel.id));
    for (const channel of pending) {
      autoDiscoveredChannelIds.add(channel.id);
      await fetchImageModels(channel, { silent: true });
    }
  };
  const fetchLibtvImageModels = async ({ notify = true } = {}) => {
    if (state.testing.libtvImageModels) return;
    state.testing.libtvImageModels = true;
    try {
      const result = await api.get('/api/libtv/image-models');
      const models = (Array.isArray(result.models) ? result.models : [])
        .map((item) => ({
          label: String(item.modelName || item.name || '').trim(),
          value: String(item.modelName || item.name || '').trim(),
          description: String(item.description || '').trim(),
        }))
        .filter((item) => item.value);
      if (!models.length) throw new Error('没有获取到可用图片模型');
      libtvImageModelOptions.splice(0, libtvImageModelOptions.length, ...models);
      if (!models.some((item) => item.value === state.cfg.image.libtvModel)) {
        state.cfg.image.libtvModel = models[0].value;
      }
      if (notify) message.success(`已加载 ${models.length} 个 LibTV 图片模型`);
    } catch (error) {
      if (notify) message.error(`加载 LibTV 图片模型失败：${error.message}`);
    } finally {
      state.testing.libtvImageModels = false;
    }
  };
  const syncUpdreamImageModelSettings = () => {
    const selected = selectedUpdreamImageModel.value;
    if (!selected) return;
    if (!selected.resolutions.includes(state.cfg.image.updreamResolution)) {
      state.cfg.image.updreamResolution = selected.defaultResolution || selected.resolutions[0] || '';
    }
    if (!selected.qualities.includes(state.cfg.image.updreamQuality)) {
      state.cfg.image.updreamQuality = selected.defaultQuality || selected.qualities[0] || '';
    }
  };
  const onUpdreamImageModelChange = () => syncUpdreamImageModelSettings();
  const fetchUpdreamImageModels = async ({ notify = true } = {}) => {
    if (state.testing.updreamImageModels) return;
    state.testing.updreamImageModels = true;
    try {
      const result = await api.get('/api/updream/image-models');
      const models = (Array.isArray(result.models) ? result.models : [])
        .map((item) => ({
          ...item,
          label: String(item.label || item.value || '').trim(),
          value: String(item.value || '').trim(),
          ratios: Array.isArray(item.ratios) ? item.ratios : [],
          resolutions: Array.isArray(item.resolutions) ? item.resolutions : [],
          qualities: Array.isArray(item.qualities) ? item.qualities : [],
        }))
        .filter((item) => item.value);
      if (!models.length) throw new Error('没有获取到可用图片模型');
      updreamImageModelOptions.splice(0, updreamImageModelOptions.length, ...models);
      if (!models.some((item) => item.value === state.cfg.image.updreamModel)) {
        state.cfg.image.updreamModel = models.find((item) => item.value === 'cheap-b-2')?.value || models[0].value;
      }
      syncUpdreamImageModelSettings();
      if (notify) message.success(`已加载 ${models.length} 个 UpDream 图片模型`);
    } catch (error) {
      if (notify) message.error(`加载 UpDream 图片模型失败：${error.message}`);
    } finally {
      state.testing.updreamImageModels = false;
    }
  };
  const fetchNeowowImageModels = async ({ notify = true } = {}) => {
    if (state.testing.neowowImageModels) return;
    const accountId = String(state.cfg.image.neowowAccountId || state.cfg.video.neowowAccountId || '').trim();
    if (!accountId) return message.warning('请先添加并选择 Neo 账号');
    state.testing.neowowImageModels = true;
    try {
      const result = await api.get(`/api/neowow/image-models?accountId=${encodeURIComponent(accountId)}`);
      const models = (Array.isArray(result.models) ? result.models : [])
        .map((item) => ({
          ...item,
          label: String(item.label || item.model_display_name || item.value || item.model_name || '').trim(),
          value: String(item.value || item.model_name || '').trim(),
          resolutions: Array.isArray(item.resolutions || item.supported_sizes)
            ? (item.resolutions || item.supported_sizes).map(String).filter(Boolean)
            : [],
          ratios: Array.isArray(item.ratios || item.supported_aspect_ratios)
            ? (item.ratios || item.supported_aspect_ratios).map(String).filter(Boolean)
            : [],
          qualities: Array.isArray(item.qualities || item.quality)
            ? (item.qualities || item.quality).map(String).filter(Boolean)
            : [],
          imageCountOptions: Array.isArray(item.imageCountOptions || item.image_count_options)
            ? (item.imageCountOptions || item.image_count_options).map(String).filter(Boolean)
            : ['1', '1'],
          maxReferenceImages: Number(item.maxReferenceImages ?? item.max_reference_images) || 0,
          membershipRequired: item.membershipRequired === true || Number(item.membership_required) === 1,
          discountRate: (item.discountRate ?? item.discount_rate) !== null
            && (item.discountRate ?? item.discount_rate) !== ''
            && Number.isFinite(Number(item.discountRate ?? item.discount_rate))
            ? Number(item.discountRate ?? item.discount_rate)
            : null,
          maintenance: item.maintenance === true,
        }))
        .filter((item) => item.value);
      if (!models.length) throw new Error('没有获取到可用的 Neo 图片模型');
      neowowImageModelOptions.splice(0, neowowImageModelOptions.length, ...models);
      if (!models.some((item) => item.value === state.cfg.image.neowowModel)) {
        state.cfg.image.neowowModel = models.find((item) => item.value === 'gpt-image-2')?.value || models[0].value;
      }
      onNeowowImageModelChange();
      if (notify) message.success(`已加载 ${models.length} 个 Neo 图片模型`);
    } catch (error) {
      if (notify) message.error(`加载 Neo 图片模型失败：${error.message}`);
    } finally {
      state.testing.neowowImageModels = false;
    }
  };
  const addVideoApiChannel = () => {
    const channel = appendVideoApiChannel();
    videoApiChannelDrawerId.value = channel.id;
    return channel;
  };
  const videoApiModelsForChannel = (channel) => videoApiModelOptionsForChannel(channel);
  const onVideoApiProtocolChange = (channel) => {
    const builtInProtocol = isSecondBuiltInVideoApiChannel(channel)
      ? VIDEO_API_PROTOCOL_OPENAI
      : VIDEO_API_PROTOCOL_NEW_API;
    if (channel.builtIn === true && channel.apiProtocol !== builtInProtocol) channel.builtIn = false;
    channel.apiProtocol = normalizeVideoApiProtocol(channel.apiProtocol, channel.apiBaseUrl);
    if (channel.apiProtocol === VIDEO_API_PROTOCOL_NEW_API && !String(channel.apiModel || '').trim()) {
      // new-api 协议默认按内置网关处理，用网关真实注册的视频模型名兜底（原先填 sd-720p 会报 No available channel）。
      channel.apiModel = DEFAULT_VIDEO_GATEWAY_API_MODEL;
    }
    onVideoApiModelChange(channel);
  };
  const onVideoApiBaseUrlInput = (channel) => {
    if (channel.builtIn === true) channel.builtIn = false;
    // Base URL 被改为非内置域名后，清除内置渠道标记——否则协议被强制锁死（如强制 OpenAI），
    // 用户选择的其他协议（如飞拓跨界）会在保存时被归一化顶掉，请求打到错误路径返回 HTML。
    if (channel.builtInChannel) channel.builtInChannel = '';
    channel.apiModels = normalizeVideoApiModelNames(channel.apiModels);
    const currentModel = String(channel.apiModel || '').trim();
    const builtInModelNames = new Set(videoApiModelOptionsForChannel({ apiBaseUrl: DEFAULT_VIDEO_API_BASE_URL }).map((item) => item.value));
    if (isBuiltInVideoApiChannel(channel) && (!currentModel || currentModel === 'sd2-c8')) {
      channel.apiModel = DEFAULT_BUILT_IN_VIDEO_API_MODEL;
    } else if (builtInModelNames.has(currentModel) && !channel.apiModels.includes(currentModel)) {
      channel.apiModel = '';
    }
    syncVideoApiChannelFallbacks();
  };
  const onVideoApiModelChange = (channel) => {
    const model = String(channel.apiModel || '').trim();
    channel.apiModel = model;
    channel.apiModels = normalizeVideoApiModelNames(channel.apiModels);
    const builtInModels = new Set(videoApiModelOptionsForChannel(channel).map((item) => item.value));
    if (model && !builtInModels.has(model)) channel.apiModels.push(model);
    channel.apiModels = normalizeVideoApiModelNames(channel.apiModels);
    syncVideoApiChannelFallbacks();
  };
  const onVideoApiModelsChange = (channel) => {
    channel.apiModels = normalizeVideoApiModelNames(channel.apiModels);
    const currentModel = String(channel.apiModel || '').trim();
    if (currentModel && !videoApiModelOptionsForChannel(channel).some((item) => item.value === currentModel)) {
      channel.apiModel = '';
    }
    syncVideoApiChannelFallbacks();
  };
  const fetchVideoApiModels = async (channel) => {
    if (state.testing.videoApi) return;
    if (!String(channel.apiBaseUrl || '').trim()) return message.warning('请先填写视频 API Base URL');
    if (!String(channel.apiKey || '').trim()) return message.warning('请先填写视频 API Key');

    state.testing.videoApi = channel.id;
    try {
      const result = await api.post('/api/video/models', {
        channelId: channel.id,
        apiBaseUrl: channel.apiBaseUrl,
        apiProtocol: normalizeVideoApiProtocol(channel.apiProtocol, channel.apiBaseUrl),
        builtIn: channel.builtIn === true,
        builtInChannel: channel.builtInChannel || '',
        apiKey: channel.apiKey,
      });
      if (!result.ok) return message.error(`${channel.name}：${result.error || '拉取模型失败'}`);

      const models = normalizeVideoApiModelNames(result.models);
      if (!models.length) return message.error(`${channel.name}：没有获取到可用模型`);
      channel.apiModels = models;
      const currentModel = String(channel.apiModel || '').trim();
      if (!currentModel || !videoApiModelOptionsForChannel(channel).some((item) => item.value === currentModel)) {
        channel.apiModel = models[0];
      }
      syncVideoApiChannelFallbacks();
      message.success(`${channel.name}：已拉取 ${models.length} 个模型`);
    } catch (error) {
      message.error(`${channel.name}：${error.message}`);
    } finally {
      state.testing.videoApi = '';
    }
  };
  const deleteVideoApiChannel = (channel) => {
    if (state.cfg.video.apiChannels.length <= 1) return message.warning('至少保留一个视频 API 渠道');
    state.cfg.video.apiChannels.splice(state.cfg.video.apiChannels.findIndex((item) => item.id === channel.id), 1);
    if (state.cfg.video.apiActiveChannelId === channel.id) state.cfg.video.apiActiveChannelId = state.cfg.video.apiChannels.find((item) => item.enabled)?.id || state.cfg.video.apiChannels[0]?.id || '';
    syncVideoApiChannelFallbacks();
  };
  const syncVideoApiChannelFallbacks = () => {
    let enabled = state.cfg.video.apiChannels.filter((item) => item.enabled);
    if (!enabled.length && state.cfg.video.apiChannels.length) {
      state.cfg.video.apiChannels[0].enabled = true;
      enabled = [state.cfg.video.apiChannels[0]];
      message.warning('?????????? API ??');
    }
    if (!enabled.some((item) => item.id === state.cfg.video.apiActiveChannelId)) state.cfg.video.apiActiveChannelId = enabled[0]?.id || '';
    const valid = new Set(enabled.map((item) => item.id));
    const existing = Array.isArray(state.cfg.video.apiFallbackChannelIds) ? state.cfg.video.apiFallbackChannelIds : [];
    const ordered = [...existing, ...state.cfg.video.apiChannels.map((item) => item.id)];
    state.cfg.video.apiFallbackChannelIds = [...new Set(ordered)].filter((id) => valid.has(id) && id !== state.cfg.video.apiActiveChannelId);
    const active = enabled.find((item) => item.id === state.cfg.video.apiActiveChannelId);
    if (active) {
      state.cfg.video.apiBaseUrl = active.apiBaseUrl;
      state.cfg.video.apiProtocol = normalizeVideoApiProtocol(active.apiProtocol, active.apiBaseUrl);
      state.cfg.video.apiKey = active.apiKey;
      state.cfg.video.apiModel = active.apiModel;
      state.cfg.video.pricePerSecond = Number(active.pricePerSecond) || 0;
    }
  };
  const testImageChannel = async (channel) => {
    if (state.testing.image) return;
    state.testing.image = true;
    try {
      const result = await api.post('/api/test/image', { channelId: channel.id, ...channel });
      result.ok ? message.success(`${channel.name} 连接成功`) : message.error(`${channel.name}：${result.error}`);
    } catch (error) { message.error(`${channel.name}：${error.message}`); }
    finally { state.testing.image = false; }
  };
  const testUpdreamConnection = async () => {
    if (state.testing.updream) return;
    if (!String(state.cfg.video.updreamAccessToken || '').trim() && !String(state.cfg.video.updreamRefreshToken || '').trim()) {
      return message.warning('请先填写 UpDream Access Token 或 Refresh Token');
    }
    state.testing.updream = true;
    state.testResult.updream = null;
    try {
      const result = await api.post('/api/updream/test', {
        accessToken: state.cfg.video.updreamAccessToken,
        refreshToken: state.cfg.video.updreamRefreshToken,
      });
      state.testResult.updream = result;
      if (result.ok) {
        message.success(result.accountName ? `UpDream 连接成功：${result.accountName}` : 'UpDream 连接成功');
      } else {
        message.error(`UpDream：${result.error || '连接失败'}`);
      }
    } catch (error) {
      state.testResult.updream = { ok: false, error: error.message };
      message.error(`UpDream：${error.message}`);
    } finally {
      state.testing.updream = false;
    }
  };

  const testComfyUiConnection = async () => {
    if (state.testing.comfyui) return;
    const baseUrl = String(state.cfg.video.comfyuiBaseUrl || '').trim();
    if (!baseUrl) return message.warning('请先填写 ComfyUI 云端地址');
    state.testing.comfyui = true;
    state.testResult.comfyui = null;
    try {
      const result = await api.post('/api/comfyui/test', {
        baseUrl,
        workflowPreset: state.cfg.video.comfyuiWorkflowPreset,
        workflowPath: state.cfg.video.comfyuiWorkflow,
      });
      state.testResult.comfyui = result;
      if (result.ok) {
        const capacity = result.capabilities?.capacity || {};
        message.success(`ComfyUI 连接成功 · 图片 ${capacity.image || 0} / 视频 ${capacity.video || 0} / 音频 ${capacity.audio || 0}`);
      } else {
        message.error(`ComfyUI：${result.error || '连接失败'}`);
      }
    } catch (error) {
      state.testResult.comfyui = { ok: false, error: error.message };
      message.error(`ComfyUI：${error.message}`);
    } finally {
      state.testing.comfyui = false;
    }
  };

  const onComfyUiWorkflowChange = (value) => {
    const id = String(value || '').trim();
    const selected = (options.comfyUiWorkflowOptions || []).find((item) => item.value === id);
    if (selected?.path) state.cfg.video.comfyuiWorkflow = selected.path;
    state.testResult.comfyui = null;
  };

  const applyNeowowAccounts = (result = {}) => {
    if (Array.isArray(result.accounts)) state.cfg.video.neowowAccounts = result.accounts;
    if (result.accountId !== undefined) state.cfg.video.neowowAccountId = result.accountId || '';
    state.cfg.video.neowowHasToken = state.cfg.video.neowowAccounts.some((account) => account.hasToken);
    if (!state.cfg.video.neowowAccounts.some((account) => account.id === state.cfg.image.neowowAccountId)) {
      state.cfg.image.neowowAccountId = state.cfg.video.neowowAccountId || state.cfg.video.neowowAccounts[0]?.id || '';
    }
  };

  const refreshNeowowAccount = async (accountId = '') => {
    if (state.testing.neowow) return;
    const id = String(accountId || state.cfg.video.neowowAccountId || '').trim();
    if (!id) return message.warning('请先添加 Neowow 账号');
    state.testing.neowow = true;
    state.testResult.neowow = null;
    try {
      const result = await api.post('/api/neowow/accounts/refresh', { accountId: id });
      applyNeowowAccounts(result);
      state.testResult.neowow = { ok: true, accountId: id };
      const account = state.cfg.video.neowowAccounts.find((item) => item.id === id);
      message.success(`${account?.name || 'Neowow 账号'} 已刷新`);
    } catch (error) {
      await loadSettings().catch(() => {});
      state.testResult.neowow = { ok: false, error: error.message };
      message.error(`Neowow：${error.message}`);
    } finally {
      state.testing.neowow = false;
    }
  };

  const testNeowowConnection = (accountId = '') => refreshNeowowAccount(accountId);

  const selectNeowowAccount = async (accountId) => {
    const id = String(accountId || '').trim();
    if (!id || state.testing.neowow) return;
    state.testing.neowow = true;
    try {
      const result = await api.post('/api/neowow/accounts/select', { accountId: id });
      applyNeowowAccounts(result);
      message.success('已设为默认 Neowow 账号');
    } catch (error) {
      message.error(`设置默认账号失败：${error.message}`);
    } finally {
      state.testing.neowow = false;
    }
  };

  const toggleNeowowAccount = async (account) => {
    if (!account?.id || state.testing.neowow) return;
    state.testing.neowow = true;
    try {
      const result = await api.post('/api/neowow/accounts/enabled', {
        accountId: account.id,
        enabled: account.enabled !== false,
      });
      applyNeowowAccounts(result);
    } catch (error) {
      account.enabled = !account.enabled;
      message.error(`更新账号状态失败：${error.message}`);
    } finally {
      state.testing.neowow = false;
    }
  };

  const resetNeowowTokenAccountEdit = () => {
    state.neowowAccountToken.value = '';
    state.neowowTokenAccountId.value = '';
  };

  const onNeowowAccountAddModeChange = (mode) => {
    if (mode !== 'token') resetNeowowTokenAccountEdit();
  };

  const editNeowowTokenAccount = (account) => {
    if (!account?.id || state.testing.neowow) return;
    state.neowowAccountAddMode.value = 'token';
    state.neowowTokenAccountId.value = account.id;
    state.neowowAccountName.value = account.name || '';
    state.neowowAccountToken.value = '';
    message.info('请在上方粘贴新的 Neowow Token');
  };

  const saveNeowowTokenAccount = async () => {
    if (state.testing.neowow) return;
    const token = String(state.neowowAccountToken.value || '').trim();
    if (!token) return message.warning('请粘贴完整的 Neowow Token');
    const accountId = String(state.neowowTokenAccountId.value || '').trim();
    state.testing.neowow = true;
    state.testResult.neowow = null;
    try {
      const result = await api.post('/api/neowow/accounts/token', {
        accountId,
        name: String(state.neowowAccountName.value || '').trim(),
        token,
        baseUrl: state.cfg.video.neowowBaseUrl,
      });
      applyNeowowAccounts(result);
      const saved = state.cfg.video.neowowAccounts.find((item) => item.id === result.importedAccountId);
      state.neowowAccountName.value = '';
      resetNeowowTokenAccountEdit();
      state.testResult.neowow = { ok: true, accountId: result.importedAccountId };
      message.success(accountId
        ? `${saved?.name || 'Neowow 账号'} 的 Token 已更新`
        : `Token 账号已添加${saved?.name ? `：${saved.name}` : ''}`);
    } catch (error) {
      await loadSettings().catch(() => {});
      state.testResult.neowow = { ok: false, error: error.message };
      message.error(`Neowow Token 导入失败：${error.message}`);
    } finally {
      state.testing.neowow = false;
    }
  };

  const loginNeowow = async (accountId = '') => {
    if (state.testing.neowow) return;
    state.testing.neowow = true;
    state.testResult.neowow = null;
    try {
      const id = String(accountId || '').trim();
      const started = await api.post('/api/neowow/login', id
        ? { accountId: id }
        : { name: String(state.neowowAccountName.value || '').trim() });
      if (!started.jobId) throw new Error(started.error || 'Neowow 登录启动失败');
      message.info('已用系统 Edge 打开该账号的独立登录窗口；登录成功后关闭该窗口，软件会自动保存账号');
      const status = await waitSimpleVideoJobFlow(started.jobId, '', {
        getStatus: (id) => api.get(`/api/video/status?jobId=${encodeURIComponent(id)}`),
        success: () => {},
      });
      await loadSettings();
      state.neowowAccountName.value = '';
      state.testResult.neowow = { ok: true, ...(status.auth || {}) };
      message.success(status.auth?.accountName
        ? `Neowow 登录成功：${status.auth.accountName}`
        : 'Neowow 登录成功');
    } catch (error) {
      await loadSettings().catch(() => {});
      state.testResult.neowow = { ok: false, error: error.message };
      message.error(`Neowow 登录失败：${error.message}`);
    } finally {
      state.testing.neowow = false;
    }
  };

  const logoutNeowow = async (accountId = '') => {
    if (state.testing.neowow) return;
    const id = String(accountId || state.cfg.video.neowowAccountId || '').trim();
    if (!id) return message.warning('请先选择 Neowow 账号');
    const account = state.cfg.video.neowowAccounts.find((item) => item.id === id);
    const tokenAccount = account?.authMethod === 'token';
    state.testing.neowow = true;
    state.testResult.neowow = null;
    try {
      const started = await api.post('/api/neowow/logout', { accountId: id });
      if (!started.jobId) throw new Error(started.error || 'Neowow 退出启动失败');
      message.info(tokenAccount
        ? '正在停用该账号 Token...'
        : '正在停用该账号 Token 并清理它的独立登录资料...');
      await waitSimpleVideoJobFlow(started.jobId, '', {
        getStatus: (id) => api.get(`/api/video/status?jobId=${encodeURIComponent(id)}`),
        success: () => {},
      });
      await loadSettings();
      state.testResult.neowow = null;
      message.success(tokenAccount ? 'Neowow Token 已停用' : 'Neowow 账号已退出登录');
    } catch (error) {
      await loadSettings().catch(() => {});
      state.testResult.neowow = { ok: false, error: error.message };
      message.error(`Neowow 退出失败：${error.message}`);
    } finally {
      state.testing.neowow = false;
    }
  };

  const deleteNeowowAccount = async (accountId) => {
    const id = String(accountId || '').trim();
    if (!id || state.testing.neowow) return;
    state.testing.neowow = true;
    try {
      const result = await api.post('/api/neowow/accounts/delete', { accountId: id });
      applyNeowowAccounts(result);
      message.success('Neowow 账号已移除，本地浏览器资料已保留');
    } catch (error) {
      message.error(`移除 Neowow 账号失败：${error.message}`);
    } finally {
      state.testing.neowow = false;
    }
  };


  return {
    ...state,
    settingsAutosave,
    autosaveStatusText,
    secondPromptSetUnlocked,
    characterImageModeLabels,
    textModelChoices,
    libtvImageModelOptions,
    updreamImageModelOptions,
    updreamImageResolutionOptions,
    updreamImageQualityOptions,
    neowowImageModelOptions,
    neowowImageResolutionOptions,
    neowowImageQualityOptions,
    neowowImageRatioOptions,
    dreaminaImageModelOptions,
    dreaminaImageResolutionOptions,
    syncSettingsChoices,
    onTextBaseUrlChoiceChange,
    onTextModelChoiceChange,
    onImageModelChoiceChange,
    onImageProviderChange,
    onStyleChoiceChange,
    normalizeVideoDurationSettings,
    rememberDefaultVideoProvider,
    loadSettings,
    loadStoryboardPromptTemplates,
    saveSettings,
    onSaveSettingsClick,
    testConn,
    testImageUpload,
    detectingJianyingDir,
    detectJianyingDir,
    choosingStorageDirectory,
    chooseStorageDirectory,
    resetStorageDirectory,
    openStorageDirectory,
    showStorageStatusInfo,
    apiBaseUrlLink,
    openApiBaseUrl,
    addImageChannel,
    deleteImageChannel,
    syncImageChannelFallbacks,
    imageModelOptionsForChannel,
    imageResolutionOptionsForChannel,
    onImageChannelBaseUrlChange,
    onImageChannelBaseUrlChoiceSelect,
    imageChannelModelPresetSelection,
    onImageChannelModelPresetSelect,
    onImageChannelModelChange,
    onImageChannelResolutionChange,
    imageChannelDrawerId,
    imageChannelDrawerChannel,
    openImageChannelDrawer,
    closeImageChannelDrawer,
    videoApiChannelDrawerId,
    videoApiChannelDrawerChannel,
    openVideoApiChannelDrawer,
    closeVideoApiChannelDrawer,
    fetchTextModels,
    fetchImageModels,
    autoDiscoverImageModels,
    fetchLibtvImageModels,
    fetchUpdreamImageModels,
    fetchNeowowImageModels,
    onUpdreamImageModelChange,
    onNeowowImageModelChange,
    onDreaminaImageModelChange,
    addVideoApiChannel,
    isBuiltInVideoApiBaseUrl,
    isBuiltInVideoApiChannel,
    isSecondBuiltInVideoApiChannel,
    videoApiModelsForChannel,
    onVideoApiBaseUrlInput,
    onVideoApiModelChange,
    onVideoApiModelsChange,
    fetchVideoApiModels,
    onVideoApiProtocolChange,
    deleteVideoApiChannel,
    syncVideoApiChannelFallbacks,
    testImageChannel,
    testUpdreamConnection,
    testComfyUiConnection,
    onComfyUiWorkflowChange,
    saveNeowowTokenAccount,
    editNeowowTokenAccount,
    onNeowowAccountAddModeChange,
    loginNeowow,
    logoutNeowow,
    refreshNeowowAccount,
    selectNeowowAccount,
    toggleNeowowAccount,
    deleteNeowowAccount,
    testNeowowConnection,
  };
}


