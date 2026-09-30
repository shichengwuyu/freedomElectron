import { isBuiltInImageGateway } from './channelProfiles.js';

const DEFAULT_TIMEOUT_MS = 30 * 1000;

const TEXT_FAMILIES = [
  ['gpt', /(^|[/:])(?:gpt|chatgpt)[-_.]/i, ['codex', 'chat', 'pro', 'mini', 'nano', 'turbo']],
  ['openai-o', /(^|[/:])o[1-9](?:[-_.]|$)/i, ['pro', 'mini', 'deep-research']],
  ['claude', /(^|[/:])claude(?:[-_.]|$)/i, ['opus', 'sonnet', 'haiku']],
  ['gemini', /(^|[/:])gemini(?:[-_.]|$)/i, ['ultra', 'pro', 'flash', 'lite']],
  ['deepseek', /(^|[/:])deepseek(?:[-_.]|$)/i, ['reasoner', 'chat', 'coder', 'pro', 'lite']],
  ['qwen', /(^|[/:])(?:qwen|qwq)(?:[-_.]|\d|$)/i, ['coder', 'reasoner', 'max', 'plus', 'turbo', 'vl', 'omni']],
  ['glm', /(^|[/:])glm(?:[-_.]|\d|$)/i, ['air', 'flash', 'plus']],
  ['grok', /(^|[/:])grok(?:[-_.]|\d|$)/i, ['mini', 'fast']],
  ['kimi', /(^|[/:])(?:kimi|moonshot)(?:[-_.]|$)/i, ['thinking', 'turbo', 'latest']],
  ['mistral', /(^|[/:])(?:mistral|mixtral)(?:[-_.]|$)/i, ['large', 'medium', 'small', 'nemo', 'codestral']],
  ['llama', /(^|[/:])(?:meta-)?llama(?:[-_.]|\d|$)/i, ['instruct', 'chat', 'guard']],
  ['command-r', /(^|[/:])command-r(?:[-_.+]|$)/i, ['plus']],
  ['doubao', /(^|[/:])doubao(?:[-_.]|$)/i, ['pro', 'lite']],
  ['hunyuan', /(^|[/:])hunyuan(?:[-_.]|$)/i, ['turbo', 'standard', 'lite']],
  ['ernie', /(^|[/:])ernie(?:[-_.]|\d|$)/i, ['turbo', 'speed', 'lite']],
  ['yi', /(^|[/:])yi(?:[-_.]|\d|$)/i, ['large', 'medium', 'lightning']],
];

const GENERIC_TEXT_TIERS = [
  'opus', 'sonnet', 'haiku', 'ultra', 'pro', 'flash', 'lite', 'mini', 'nano',
  'reasoner', 'thinking', 'chat', 'coder', 'instruct', 'max', 'plus', 'turbo',
  'large', 'medium', 'small', 'fast',
];

const NON_TEXT_PATTERN = /(?:embedding|rerank|moderation|whisper|transcri|speech|tts|audio|realtime|image|imagen|video|sora|veo|dall[-_.]?e|computer[-_.]?use)/i;
const LEGACY_PATTERN = /(?:^|[-_.])(legacy|deprecated|obsolete|old)(?:[-_.]|$)/i;
const DATE_PATTERN = /(?:^|[-_.])(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)(?:$|[-_.])/;

// 内置网关上「已注册但取不到图」的生图模型。
// 实测：这些名字走 /v1/chat/completions 只返回一个 pending 任务对象（上游是 vidu-image-*），
// 同步与流式都拿不到图片，选它必然空手而归，因此不放进候选列表。
// 网关侧把结果回传链路接通后，从这里删掉对应条目即可自动放开。
// 用英文小写比对：GPT-image-2 与 gpt-image-2 会一并命中。
const GATEWAY_PENDING_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'image-nano-banana',
  'image-nano-banana-2',
  'image-nano-banana-pro',
]);

function withoutGatewayPendingImageModels(models, baseUrl) {
  if (!isBuiltInImageGateway(baseUrl)) return models;
  return models.filter((name) => !GATEWAY_PENDING_IMAGE_MODELS.has(String(name || '').trim().toLowerCase()));
}

export function apiModelsUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new Error('请先填写 API Base URL');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('API Base URL 格式不正确');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API Base URL 仅支持 HTTP 或 HTTPS');

  const path = url.pathname.replace(/\/+$/, '');
  if (/\/models$/i.test(path)) url.pathname = path;
  else if (/\/videos$/i.test(path)) url.pathname = path.replace(/\/videos$/i, '/models');
  else if (/\/video\/generations$/i.test(path)) url.pathname = path.replace(/\/video\/generations$/i, '/models');
  else url.pathname = `${path}/models`.replace(/^\/?/, '/');
  url.search = '';
  url.hash = '';
  return url.toString();
}

function modelName(item) {
  if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
  if (!item || typeof item !== 'object') return '';
  return String(item.id || item.model || item.name || item.value || item.model_id || item.modelId || '').trim();
}

export function extractApiModelNames(payload) {
  const candidates = [
    payload,
    payload?.data,
    payload?.models,
    payload?.data?.models,
    payload?.result,
    payload?.result?.data,
    payload?.result?.models,
  ];
  const names = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      const name = modelName(item);
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

function familyDescriptor(name, kind) {
  const value = String(name || '').trim().toLowerCase().replace(/^models\//, '');
  if (!value || LEGACY_PATTERN.test(value)) return null;
  if (kind === 'image') {
    if (/(^|[/:])gpt[-_.]?image(?:[-_.]|\d|$)/i.test(value)) {
      return { family: 'gpt-image', tiers: ['pro', 'vip', 'mini'] };
    }
    if (/(^|[/:])gemini(?=.*(?:image|nano[-_.]?banana))/i.test(value) || /(^|[-_/:])nano[-_.]?banana/i.test(value)) {
      return { family: 'gemini-image', tiers: ['ultra', 'pro', 'flash', 'lite'] };
    }
    return null;
  }
  if (kind !== 'text' || NON_TEXT_PATTERN.test(value)) return null;
  const matched = TEXT_FAMILIES.find(([, pattern]) => pattern.test(value));
  if (matched) return { family: matched[0], tiers: matched[2] };

  const leaf = value.split('/').pop() || value;
  const versionAt = leaf.search(/(?:^|[-_.])v?\d{1,2}(?:[-_.]|$)/);
  if (versionAt < 0) return { family: `unversioned:${leaf}`, tiers: GENERIC_TEXT_TIERS };
  const prefix = leaf.slice(0, versionAt).replace(/[-_.]+$/, '');
  return { family: prefix || leaf, tiers: GENERIC_TEXT_TIERS };
}

function modelTier(name, tiers) {
  const value = String(name || '').toLowerCase();
  const matched = tiers.filter((tier) => new RegExp(`(?:^|[-_.])${tier.replace(/[+]/g, '\\$&')}(?:$|[-_.])`, 'i').test(value));
  return matched.length ? matched.join('+') : 'base';
}

function versionScore(name, family) {
  const value = String(name || '').toLowerCase();
  if (/(?:^|[-_.])latest(?:$|[-_.])/.test(value)) return Number.POSITIVE_INFINITY;
  if (family === 'openai-o') {
    const match = value.match(/(?:^|[/:])o(\d+)(?:[-_.](\d+))?/);
    return match ? (Number(match[1]) * 1e6) + (Number(match[2] || 0) * 1e3) : 0;
  }
  const familyToken = family.replace(/-image$/, '').replace(/^unversioned:/, '');
  const start = value.indexOf(familyToken);
  const tail = value.slice(start >= 0 ? start + familyToken.length : 0);
  const match = tail.match(/(?:^|[-_.])v?(\d{1,2})(?:[-_.](\d{1,2}))?/);
  if (!match) return 0;
  return (Number(match[1]) * 1e6) + (Number(match[2] || 0) * 1e3);
}

function dateScore(name) {
  const match = String(name || '').match(DATE_PATTERN);
  return match ? Number(`${match[1]}${match[2]}${match[3]}`) : 0;
}

export function filterLatestModels(models, kind) {
  const unique = [...new Set((Array.isArray(models) ? models : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (kind === 'video') return unique;

  const grouped = new Map();
  for (const name of unique) {
    const descriptor = familyDescriptor(name, kind);
    if (!descriptor) continue;
    const tier = modelTier(name, descriptor.tiers);
    const key = `${descriptor.family}:${tier}`;
    const entry = { name, version: versionScore(name, descriptor.family), date: dateScore(name) };
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }

  const selected = [];
  for (const entries of grouped.values()) {
    // 图片系列保留两个版本：特价渠道常见 2.0/2.5 并存（如 gpt-image-2 与 gpt-image-2.5-*），
    // 只留最新版会把便宜的老版本挤没了。
    const versionLimit = 2;
    const versions = [...new Set(entries.map((entry) => entry.version))]
      .sort((a, b) => b - a)
      .slice(0, versionLimit);
    for (const version of versions) {
      const versionMatches = entries.filter((entry) => entry.version === version);
      const stableAliases = versionMatches.filter((entry) => entry.date === 0);
      if (stableAliases.length) selected.push(...stableAliases.map((entry) => entry.name));
      else {
        const latestDate = Math.max(...versionMatches.map((entry) => entry.date));
        selected.push(...versionMatches.filter((entry) => entry.date === latestDate).map((entry) => entry.name));
      }
    }
  }
  return [...new Set(selected)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

function responseError(payload, status) {
  const detail = payload?.error?.message || payload?.error || payload?.message || payload?.detail || payload?.raw || `HTTP ${status}`;
  return String(typeof detail === 'object' ? JSON.stringify(detail) : detail).slice(0, 500);
}

export async function fetchApiModels({ baseUrl, apiKey }, options = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('请先填写 API Key');

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(apiModelsUrl(baseUrl), {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(responseError(payload, response.status));
    const models = extractApiModelNames(payload);
    if (!models.length) throw new Error('接口没有返回可识别的模型列表，请确认该服务支持 /models');
    return models;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`拉取模型超时（${Math.round(timeoutMs / 1000)} 秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverApiModels(config, kind, options = {}) {
  const allModels = await fetchApiModels(config, options);
  const usable = kind === 'image'
    ? withoutGatewayPendingImageModels(allModels, config?.baseUrl)
    : allModels;
  const models = filterLatestModels(usable, kind);
  if (!models.length) {
    const label = kind === 'image' ? 'GPT Image 或 Gemini Image' : '可识别的文本模型';
    throw new Error(`接口返回了 ${allModels.length} 个模型，但没有匹配到${label}；仍可手动填写模型名`);
  }
  return { models, total: allModels.length };
}
