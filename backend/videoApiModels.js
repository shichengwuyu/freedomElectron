import { apiModelsUrl, discoverApiModels, extractApiModelNames } from './modelDiscovery.js';
import {
  BUILT_IN_VIDEO_CHANNEL_2,
  SECOND_BUILT_IN_VIDEO_API_MODEL,
  normalizeVideoApiBaseUrl,
} from './channelProfiles.js';

const NEW_API_VIDEO_MODEL_PATTERN = /(?:video|seedance|(?:^|[-_.])sdf?(?:$|[-_.\d])|kling|jimeng|sora|veo|wan[-_.]?\d|hailuo|minimax|vidu|runway|luma|pixverse)/i;

export function videoApiModelsUrl(baseUrl, builtIn) {
  const normalized = builtIn === false
    ? String(baseUrl || '').trim()
    : normalizeVideoApiBaseUrl(baseUrl);
  return apiModelsUrl(normalized);
}
export const extractVideoApiModelNames = extractApiModelNames;

export async function fetchVideoApiModels(config, options = {}) {
  const baseUrl = config?.baseUrl ?? config?.apiBaseUrl;
  const result = await discoverApiModels({
    ...config,
    baseUrl: config?.builtIn === false
      ? String(baseUrl || '').trim()
      : normalizeVideoApiBaseUrl(baseUrl),
  }, 'video', options);
  const models = result.models;
  if (String(config?.builtInChannel || '').trim() === BUILT_IN_VIDEO_CHANNEL_2) {
    return [SECOND_BUILT_IN_VIDEO_API_MODEL];
  }
  const protocol = String(config?.apiProtocol || '').trim().toLowerCase();
  if (protocol === 'feituo') {
    // 飞拓跨界：/v1/models（new-api 标准）+ X-Public-Model-Ids 头；按视频模型特征过滤。
    // 该站有间歇性机器人防护（偶发返回 HTML 挑战页而非 JSON），自动重试 4 次。
    const feituoBase = `${String(config?.baseUrl ?? config?.apiBaseUrl ?? '').trim().replace(/\/+$/, '')}/v1`;
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 4000 * attempt));
      try {
        const feituoModels = await discoverApiModels({ ...config, baseUrl: feituoBase }, 'video', { ...options, headers: { 'X-Public-Model-Ids': '1' } });
        const matched = feituoModels.models.filter((model) => NEW_API_VIDEO_MODEL_PATTERN.test(String(model || '')));
        if (!matched.length) throw new Error(`飞拓跨界返回了 ${feituoModels.models.length} 个模型，但没有识别到视频模型；仍可手动填写模型名`);
        return matched;
      } catch (error) {
        lastErr = error;
        if (!/DOCTYPE|html/i.test(String(error?.message || ''))) throw error; // 非防护类错误直接抛
      }
    }
    throw new Error(`飞拓跨界多次重试后仍被拦截，请稍后再试（最后错误：${String(lastErr?.message || '').slice(0, 80)}）`);
  }
  if (protocol !== 'newapi') return models;
  const videoModels = models.filter((model) => NEW_API_VIDEO_MODEL_PATTERN.test(String(model || '')));
  if (!videoModels.length) throw new Error(`New API 返回了 ${models.length} 个模型，但没有识别到视频模型`);
  return videoModels;
}
