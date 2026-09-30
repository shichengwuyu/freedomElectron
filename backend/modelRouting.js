const TASK_KEYS = [
  'default',
  'novel',
  'extraction',
  'adaptation',
  'script',
  'storyboard',
  'reference',
  'editing',
  'binding',
  'agent',
  'review',
  'qa',
];

export const MODEL_ROUTING_TASKS = Object.freeze([...TASK_KEYS]);

function clampNumber(value, fallback = 0, min = 0, max = Number.POSITIVE_INFINITY) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeProfileId(value, fallback) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return id || fallback;
}

function normalizeModelNames(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function normalizeModelProfile(profile = {}, index = 0, legacyText = {}) {
  const fallbackId = index === 0 ? 'primary' : `profile-${index + 1}`;
  return {
    id: normalizeProfileId(profile.id, fallbackId),
    name: String(profile.name || (index === 0 ? '主文本模型' : `文本模型 ${index + 1}`)).trim(),
    enabled: profile.enabled !== false,
    baseUrl: String(profile.baseUrl || legacyText.baseUrl || '').trim(),
    apiKey: String(profile.apiKey || (index === 0 ? legacyText.apiKey || '' : '')).trim(),
    model: String(profile.model || (index === 0 ? legacyText.model || '' : '')).trim(),
    models: normalizeModelNames(profile.models || (index === 0 ? legacyText.models : [])),
    temperature: clampNumber(profile.temperature, Number(legacyText.temperature) || 0.7, 0, 2),
    maxTokens: Math.floor(clampNumber(profile.maxTokens, Number(legacyText.maxTokens) || 256000, 1, 1000000)),
    inputPricePerMillion: clampNumber(profile.inputPricePerMillion, 0, 0, 1000000),
    outputPricePerMillion: clampNumber(profile.outputPricePerMillion, 0, 0, 1000000),
  };
}

export function normalizeModelRouting(value = {}, legacyText = {}) {
  const rawProfiles = Array.isArray(value.profiles) ? value.profiles : [];
  const sourceProfiles = rawProfiles.length ? rawProfiles : [{
    id: 'primary',
    name: '主文本模型',
    ...legacyText,
  }];
  const profiles = [];
  const seen = new Set();
  sourceProfiles.forEach((raw, index) => {
    const profile = normalizeModelProfile(raw, index, legacyText);
    let id = profile.id;
    let suffix = 2;
    while (seen.has(id)) id = `${profile.id}-${suffix++}`;
    seen.add(id);
    profiles.push({ ...profile, id });
  });
  if (!profiles.length) profiles.push(normalizeModelProfile({}, 0, legacyText));

  const enabledIds = new Set(profiles.filter((profile) => profile.enabled).map((profile) => profile.id));
  const allIds = new Set(profiles.map((profile) => profile.id));
  const defaultId = enabledIds.has(value.routes?.default)
    ? value.routes.default
    : (profiles.find((profile) => profile.enabled)?.id || profiles[0].id);
  const routes = {};
  const fallbacks = {};
  for (const task of TASK_KEYS) {
    const configured = String(value.routes?.[task] || '').trim();
    routes[task] = enabledIds.has(configured) ? configured : defaultId;
    const list = Array.isArray(value.fallbacks?.[task]) ? value.fallbacks[task] : [];
    fallbacks[task] = [...new Set(list.map((item) => String(item || '').trim()))]
      .filter((id) => allIds.has(id) && id !== routes[task]);
  }

  return {
    enabled: value.enabled === true,
    autoFallback: value.autoFallback !== false,
    retryCount: Math.floor(clampNumber(value.retryCount, 1, 0, 3)),
    profiles,
    routes,
    fallbacks,
  };
}

function profileConfig(profile, legacyText, routingMeta) {
  return {
    // ??????????? Profile ???????????? Key?
    // ? text ???? normalizeModelRouting ????????????? Profile?
    baseUrl: profile.baseUrl || '',
    apiKey: profile.apiKey || '',
    model: profile.model || '',
    temperature: Number.isFinite(Number(profile.temperature)) ? Number(profile.temperature) : (legacyText.temperature ?? 0.7),
    maxTokens: Number.isFinite(Number(profile.maxTokens)) ? Number(profile.maxTokens) : (legacyText.maxTokens ?? 256000),
    __routing: {
      ...routingMeta,
      profileId: profile.id,
      profileName: profile.name,
      pricing: {
        inputPricePerMillion: Number(profile.inputPricePerMillion) || 0,
        outputPricePerMillion: Number(profile.outputPricePerMillion) || 0,
      },
    },
  };
}

export function resolveTextModelConfig(appConfig = {}, task = 'default', usageContext = {}) {
  const legacyText = appConfig.text || {};
  const routing = normalizeModelRouting(appConfig.modelRouting || {}, legacyText);
  const normalizedTask = TASK_KEYS.includes(task) ? task : 'default';
  const baseMeta = {
    task: normalizedTask,
    projectId: String(usageContext.projectId || ''),
    episodeId: usageContext.episodeId ?? '',
    operation: String(usageContext.operation || ''),
    currency: String(usageContext.currency || appConfig.costTracking?.currency || 'CNY'),
    retryCount: routing.retryCount,
    autoFallback: routing.autoFallback,
  };

  if (!routing.enabled) {
    const endpoints = Array.isArray(legacyText.endpoints) ? legacyText.endpoints : [];
    const fallbackConfigs = legacyText.rotationStrategy === 'failover'
      ? endpoints
        .filter((ep) => ep && (ep.baseUrl || ep.apiKey))
        .map((ep, index) => ({
          baseUrl: String(ep.baseUrl || '').trim(),
          apiKey: String(ep.apiKey || '').trim(),
          model: String(ep.model || legacyText.model || '').trim(),
          temperature: Number.isFinite(Number(legacyText.temperature)) ? Number(legacyText.temperature) : (legacyText.temperature ?? 0.7),
          maxTokens: Number.isFinite(Number(legacyText.maxTokens)) ? Number(legacyText.maxTokens) : (legacyText.maxTokens ?? 256000),
          __routing: {
            ...baseMeta,
            profileId: `text-endpoint-${index + 1}`,
            profileName: String(ep.name || '').trim() || `备用端点 ${index + 1}`,
            pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0 },
          },
        }))
      : [];
    return {
      ...legacyText,
      __routing: {
        ...baseMeta,
        profileId: 'legacy-primary',
        profileName: '默认文本模型',
        pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0 },
      },
      __fallbacks: fallbackConfigs,
    };
  }

  const byId = new Map(routing.profiles.map((profile) => [profile.id, profile]));
  const primary = byId.get(routing.routes[normalizedTask])
    || byId.get(routing.routes.default)
    || routing.profiles[0];
  const fallbackIds = routing.autoFallback
    ? [...(routing.fallbacks[normalizedTask] || []), ...(routing.fallbacks.default || [])]
    : [];
  const uniqueFallbacks = [...new Set(fallbackIds)]
    .map((id) => byId.get(id))
    .filter((profile) => profile?.enabled && profile.id !== primary.id);
  const primaryConfig = profileConfig(primary, legacyText, baseMeta);
  primaryConfig.__fallbacks = uniqueFallbacks.map((profile) => profileConfig(profile, legacyText, baseMeta));
  return primaryConfig;
}

export function hasTextModelKey(appConfig = {}, task = 'default') {
  const resolved = resolveTextModelConfig(appConfig, task);
  return [resolved, ...(resolved.__fallbacks || [])].some((candidate) => Boolean(candidate.apiKey));
}

export function modelRoutingPublicView(value = {}, legacyText = {}, maskKey = (key) => key) {
  const routing = normalizeModelRouting(value, legacyText);
  return {
    ...routing,
    profiles: routing.profiles.map((profile) => ({
      ...profile,
      apiKey: maskKey(profile.apiKey),
      hasKey: Boolean(profile.apiKey),
    })),
  };
}

export function mergeModelRoutingSecrets(incoming = {}, current = {}, keepKey = (value, oldValue) => value || oldValue, legacyText = {}) {
  const normalizedCurrent = normalizeModelRouting(current, legacyText);
  const currentById = new Map(normalizedCurrent.profiles.map((profile) => [profile.id, profile]));
  const profiles = (Array.isArray(incoming.profiles) ? incoming.profiles : normalizedCurrent.profiles).map((profile, index) => {
    const old = currentById.get(String(profile?.id || '')) || normalizedCurrent.profiles[index] || {};
    const merged = { ...profile, apiKey: keepKey(profile?.apiKey, old.apiKey || '') };
    if (index !== 0 || incoming.syncPrimaryFromText !== true) return merged;
    return {
      ...merged,
      baseUrl: String(legacyText.baseUrl || ''),
      apiKey: String(legacyText.apiKey || ''),
      model: String(legacyText.model || ''),
      models: normalizeModelNames(legacyText.models),
      temperature: clampNumber(legacyText.temperature, 0.7, 0, 2),
      maxTokens: Math.floor(clampNumber(legacyText.maxTokens, 256000, 1, 1000000)),
    };
  });
  return normalizeModelRouting({ ...current, ...incoming, profiles }, legacyText);
}
