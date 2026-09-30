// 调用模型 API：文本与 OpenAI Images 兼容接口，以及 GeekNow Gemini 原生生图接口。
// 仅用 Node 内置 fetch（Node 18+），无第三方依赖
import { Buffer } from 'buffer';
import { estimateTextCost, recordUsage } from './services/costLedgerService.js';
import { normalizeImageResolution, resolveImageModelConfig } from './channelProfiles.js';
import { imageDimensions, parseImageRatio } from './imageAspect.js';

const IMAGE_POST_TIMEOUT_MS = 15 * 60 * 1000;
const IMAGE_URL_TIMEOUT_MS = 2 * 60 * 1000;
const IMAGE_URL_RETRIES = 4;

function joinUrl(baseUrl, endpoint) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  return `${base}${endpoint}`;
}

// 统一发请求，支持外部取消与超时。
async function postJson(url, apiKey, body, timeoutOrOptions = 120000) {
  const options = typeof timeoutOrOptions === 'number'
    ? { timeoutMs: timeoutOrOptions }
    : (timeoutOrOptions || {});
  const timeoutMs = Number(options.timeoutMs) || 120000;
  const controller = new AbortController();
  let abortKind = '';
  const onExternalAbort = () => {
    abortKind = 'external';
    controller.abort(options.signal?.reason);
  };
  if (options.signal?.aborted) onExternalAbort();
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    abortKind = 'timeout';
    controller.abort();
  }, timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!resp.ok) {
      const msg = json?.error?.message || json?.message || json?.raw || `HTTP ${resp.status}`;
      const err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    return json;
  } catch (e) {
    if (abortKind === 'timeout') throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    if (abortKind === 'external' || options.signal?.aborted) {
      const error = new Error('请求已取消');
      error.name = 'AbortError';
      throw error;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireModel(cfg, label) {
  const model = String(cfg?.model || '').trim();
  if (!model) throw new Error(`请先填写${label}模型`);
  return model;
}

function downloadHeaders(imageUrl, extraHeaders = {}) {
  let referer = '';
  try {
    const parsed = new URL(imageUrl);
    referer = `${parsed.origin}/`;
  } catch {}
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    ...(referer ? { Referer: referer } : {}),
    ...extraHeaders,
  };
}

// 中转站有时先返回临时 URL，再由本地程序下载落盘。这里做超时、重试和内容校验，
// 避免“中转站已生成，但本地没显示”的常见断点。
export async function downloadImageUrlAsB64(imageUrl, {
  timeoutMs = IMAGE_URL_TIMEOUT_MS,
  retries = IMAGE_URL_RETRIES,
  headers = {},
  context = '图片',
} = {}) {
  const sourceUrl = String(imageUrl || '').trim();
  if (!sourceUrl) throw new Error('图片 URL 为空');
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(sourceUrl, {
        headers: downloadHeaders(sourceUrl, headers),
        signal: controller.signal,
      });
      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (/^(text\/html|application\/json|text\/plain)/i.test(contentType)) {
        throw new Error(`返回内容不是图片（${contentType || 'unknown'}）`);
      }
      const arr = Buffer.from(await resp.arrayBuffer());
      if (arr.length < 64) throw new Error('图片文件为空或不完整');
      return { b64: arr.toString('base64'), sourceUrl };
    } catch (e) {
      lastError = e?.name === 'AbortError'
        ? new Error(`下载超时（${Math.round(timeoutMs / 1000)} 秒）`)
        : e;
      if (attempt < retries) await sleep(Math.min(12000, 1200 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  const err = new Error(`${context}已生成，但下载到本地失败：${lastError?.message || '未知错误'}`);
  err.sourceUrl = sourceUrl;
  err.downloadFailed = true;
  throw err;
}

// 调用文本模型做对话补全，返回纯文本内容
// maxTokens 默认给足，避免长 JSON 被中转默认上限（常见 4096）截断；
// 若被 max_tokens 截断（finish_reason=length），抛出明确错误便于上层提示
function candidateConfigs(cfg = {}) {
  if (Array.isArray(cfg.channels)) {
    const resolved = resolveImageModelConfig(cfg);
    return [resolved, ...(resolved.__fallbacks || [])].filter((candidate) => candidate && typeof candidate === 'object');
  }
  const fallbacks = Array.isArray(cfg.__fallbacks) ? cfg.__fallbacks : [];
  return [cfg, ...fallbacks].filter((candidate) => candidate && typeof candidate === 'object');
}

function imageErrorText(error) {
  return `${error?.message || ''} ${error?.cause?.code || ''} ${error?.code || ''}`;
}

// 与视频提交同一套判断：出图也是付费、非幂等的。
// 「响应没拿回来」（连接重置/读中断/超时）时上游可能已经出图并计费，重发就是重复扣费；
// 只有「请求确定没送出去」的连接阶段失败才允许重发。
function imageResultUnknownError(error) {
  return /ECONNRESET|EPIPE|socket hang up|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|read ECONNRESET|请求超时|timeout/i.test(imageErrorText(error));
}

function imageRetryableNetworkError(error) {
  if (imageResultUnknownError(error)) return false;
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|connect ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|CERT_|UNABLE_TO_VERIFY|SELF_SIGNED|ERR_TLS/i.test(imageErrorText(error));
}

function retryableError(error) {
  if (!error || error.name === 'AbortError' || error.truncated) return false;
  // 有明确 HTTP 状态时按状态判断（408 结果不明，已移出可重试集合，避免重复出图）。
  if (error.status) return [409, 425, 429, 500, 502, 503, 504].includes(Number(error.status));
  return imageRetryableNetworkError(error);
}

function estimateTokensFromText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return Math.max(0, Math.ceil(text.length / 4));
}

function messageContentForTokenEstimate(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content || '');
  return content.map((part) => {
    if (part?.type === 'text') return String(part.text || '');
    if (part?.type === 'image_url') return `[image:${part.image_url?.detail || 'auto'}]`;
    // 视频/文件 part 里可能内联了几 MB 的 data URL，绝不能 stringify 进 token 估算。
    if (part?.type === 'video_url' || part?.type === 'input_video') return '[video]';
    if (part?.type === 'file' || part?.type === 'input_file') return '[file]';
    if (part?.type === 'input_audio') return '[audio]';
    return JSON.stringify(part || '');
  }).join('\n');
}

function messagesTokenEstimate(messages = []) {
  return estimateTokensFromText(messages.map((message) => `${message?.role || ''}:${messageContentForTokenEstimate(message?.content)}`).join('\n'));
}

function usageNumbers(usage, messages, content) {
  const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : messagesTokenEstimate(messages),
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : estimateTokensFromText(content),
    estimated: !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens),
  };
}

function recordTextRequest(candidate, messages, content, usage, status = 'success', error = '') {
  const routing = candidate?.__routing || {};
  const tokens = usageNumbers(usage, messages, content);
  const pricing = routing.pricing || {};
  const cost = status === 'success' ? estimateTextCost({ ...tokens, ...pricing }) : 0;
  let provider = '';
  try { provider = new URL(candidate.baseUrl).hostname; } catch { /* ignore */ }
  recordUsage({
    kind: 'text', task: routing.task || 'default', operation: routing.operation || '',
    projectId: routing.projectId || '', episodeId: routing.episodeId ?? '', provider,
    profileId: routing.profileId || '', profileName: routing.profileName || '', model: candidate.model || '',
    inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens, cost,
    currency: routing.currency || 'CNY', estimated: tokens.estimated, status, error: error ? String(error) : '',
  });
}

function recordImageRequest(cfg, usageContext = {}, status = 'success', error = '') {
  const price = Math.max(0, Number(cfg?.pricePerImage) || 0);
  let provider = '';
  try { provider = new URL(cfg?.baseUrl).hostname; } catch { /* ignore */ }
  recordUsage({
    kind: 'image',
    task: String(usageContext.task || 'image'),
    operation: String(usageContext.operation || ''),
    projectId: String(usageContext.projectId || ''),
    episodeId: usageContext.episodeId ?? '',
    provider,
    model: cfg?.model || '',
    units: status === 'success' ? 1 : 0,
    cost: status === 'success' ? price : 0,
    currency: String(usageContext.currency || 'CNY'),
    estimated: status === 'success' && price > 0,
    status,
    error: error ? String(error) : '',
  });
}

async function resolveImageResponse(item, context) {
  if (!item) throw new Error(`${context}接口未返回 data`);
  let result;
  if (item.b64_json) result = { b64: item.b64_json };
  else if (item.url) result = await downloadImageUrlAsB64(item.url, { context });
  else throw new Error(`${context}接口返回中既无 b64_json 也无 url`);
  return { ...result, revisedPrompt: String(item.revised_prompt || item.revisedPrompt || '') };
}

async function withCandidateRetries(cfg, operation, { signal, canFallback = () => true, retryCount: retryCountOverride } = {}) {
  const candidates = candidateConfigs(cfg);
  const overrideRetries = Number(retryCountOverride);
  const hasOverride = Number.isFinite(overrideRetries);
  let lastError = null;
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const candidate = candidates[candidateIndex];
    // 调用方自己带重试循环时传 retryCount: 0，避免内外两层重试相乘放大等待时间。
    const retryCount = hasOverride
      ? Math.max(0, Math.min(overrideRetries, 3))
      : Math.max(0, Math.min(Number(candidate.__routing?.retryCount) || 0, 3));
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        return await operation(candidate, { attempt, candidateIndex });
      } catch (error) {
        lastError = error;
        if (error?.name === 'AbortError' || signal?.aborted || error?.downloadFailed || error?.imagePostprocessFailed) throw error;
        if (attempt < retryCount && retryableError(error) && canFallback()) {
          await sleep(Math.min(4000, 500 * (2 ** attempt)));
          continue;
        }
        break;
      }
    }
    if (!canFallback()) break;
  }
  throw lastError || new Error('模型请求失败');
}

// 调用文本模型做对话补全，支持按任务配置多模型自动重试和降级。
export async function chatComplete(cfg, messages, options = {}) {
  const { allowTruncated = false, signal, timeoutMs = IMAGE_POST_TIMEOUT_MS } = options;
  return withCandidateRetries(cfg, async (candidate) => {
    const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : (Number(candidate.temperature) || 0.4);
    const maxTokens = Number.isFinite(Number(options.maxTokens)) ? Number(options.maxTokens) : (Number(candidate.maxTokens) || 16000);
    const url = joinUrl(candidate.baseUrl, '/chat/completions');
    const body = { model: requireModel(candidate, '文本'), messages, temperature };
    if (maxTokens) body.max_tokens = maxTokens;
    try {
      const json = await postJson(url, candidate.apiKey, body, { timeoutMs, signal });
      const choice = json?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string') throw new Error('模型返回格式异常，未取到 content');
      recordTextRequest(candidate, messages, content, json?.usage);
      if (choice?.finish_reason === 'length') {
        if (allowTruncated && content.trim()) return content;
        const err = new Error('模型输出被长度上限截断');
        err.truncated = true;
        err.partial = content;
        throw err;
      }
      return content;
    } catch (error) {
      if (!error?.truncated) recordTextRequest(candidate, messages, '', null, 'failed', error?.message || error);
      throw error;
    }
  }, { signal });
}

async function chatCompleteStreamSingle(candidate, messages, options = {}, onEmission = () => {}) {
  const { onDelta, signal, timeoutMs = 30 * 60 * 1000, idleTimeoutMs = 2 * 60 * 1000 } = options;
  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : (Number(candidate.temperature) || 0.7);
  const maxTokens = Number.isFinite(Number(options.maxTokens)) ? Number(options.maxTokens) : (Number(candidate.maxTokens) || 256000);
  const url = joinUrl(candidate.baseUrl, '/chat/completions');
  const body = { model: requireModel(candidate, '文本'), messages, temperature, stream: true };
  if (maxTokens) body.max_tokens = maxTokens;

  const controller = new AbortController();
  let abortKind = '';
  const onExternalAbort = () => { abortKind = 'external'; controller.abort(signal?.reason); };
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener('abort', onExternalAbort, { once: true });
  const totalTimer = setTimeout(() => { abortKind = 'timeout'; controller.abort(); }, timeoutMs);
  let idleTimer = null;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { abortKind = 'idle'; controller.abort(); }, idleTimeoutMs);
  };
  resetIdleTimer();

  let reader = null;
  let full = '';
  let usage = null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      let json;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      const msg = json?.error?.message || json?.message || json?.raw || `HTTP ${resp.status}`;
      const err = new Error(msg); err.status = resp.status; throw err;
    }
    reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason = '';
    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'data: [DONE]') { streamDone = true; break; }
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(trimmed.slice(6));
          if (event?.usage) usage = event.usage;
          const choice = event?.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const content = choice?.delta?.content;
          if (content) { full += content; onEmission(); onDelta?.(content); }
        } catch { /* 忽略不完整的 JSON 片段 */ }
      }
    }
    recordTextRequest(candidate, messages, full, usage);
    if (finishReason === 'length') {
      const err = new Error('模型输出达到 max_tokens 上限被截断，请缩短分段或降低输出长度');
      err.truncated = true; err.partial = full; throw err;
    }
    return full;
  } catch (error) {
    if (!error?.truncated) recordTextRequest(candidate, messages, full, usage, 'failed', error?.message || error);
    if (abortKind === 'timeout') throw new Error(`流式请求超时（${Math.round(timeoutMs / 60000)} 分钟）`);
    if (abortKind === 'idle') throw new Error(`流式请求超过 ${Math.round(idleTimeoutMs / 1000)} 秒没有返回内容`);
    if (abortKind === 'external' || signal?.aborted) { const aborted = new Error('请求已取消'); aborted.name = 'AbortError'; throw aborted; }
    throw error;
  } finally {
    clearTimeout(totalTimer); clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onExternalAbort);
    try { await reader?.cancel(); } catch { /* ignore */ }
  }
}

// 流式请求仅在尚未输出任何内容时重试或切换备用模型，避免重复正文。
export async function chatCompleteStream(cfg, messages, options = {}) {
  let emitted = false;
  return withCandidateRetries(
    cfg,
    (candidate) => chatCompleteStreamSingle(candidate, messages, options, () => { emitted = true; }),
    { signal: options.signal, canFallback: () => !emitted, retryCount: options.retryCount },
  );
}

export async function testTextModel(cfg) {
  const content = await chatComplete(
    cfg,
    [
      { role: 'system', content: '你是连接测试器。只输出“成功”两个字，不要解释，不要标点。' },
      { role: 'user', content: '测试连接' },
    ],
    { temperature: 0, maxTokens: 512, allowTruncated: true }
  );
  return { ok: true, sample: content.trim().slice(0, 50) };
}

// gpt-image-2 的任意尺寸必须是 16 的倍数，并受当前像素预算约束。
const RATIO_TO_SIZE = {
  '1:1': '1024x1024',
  '4:3': '1408x1056',
  '3:4': '1056x1408',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '16:9': '1536x864',
  '9:16': '864x1536',
};
const MAX_GPT_IMAGE_EDGE = 1536;
const MAX_GPT_IMAGE_PIXELS = 1536 * 1024;

const GPT_IMAGE_2_SIZES = {
  '1K': {
    '1:1': '1024x1024',
    '4:3': '1536x1152',
    '3:4': '1152x1536',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1920x1080',
    '9:16': '1080x1920',
  },
  '2K': {
    '1:1': '2048x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '3:2': '2560x1712',
    '2:3': '1712x2560',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
  },
  '4K': {
    '1:1': '2880x2880',
    '4:3': '3840x2880',
    '3:4': '2880x3840',
    '3:2': '3840x2560',
    '2:3': '2560x3840',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
  },
};

const GPT_IMAGE_2_VIP_SIZES = {
  '1K': {
    '1:1': '1024x1024', '4:3': '1024x768', '3:4': '768x1024', '3:2': '1008x672',
    '2:3': '672x1008', '16:9': '1280x720', '9:16': '720x1280', '21:9': '1344x576',
  },
  '2K': {
    '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '3:2': '2496x1664',
    '2:3': '1664x2496', '16:9': '2560x1440', '9:16': '1440x2560', '21:9': '3024x1296',
  },
  '4K': {
    '1:1': '2880x2880', '4:3': '3264x2448', '3:4': '2448x3264', '3:2': '3504x2336',
    '2:3': '2336x3504', '16:9': '3840x2160', '9:16': '2160x3840', '21:9': '3808x1632',
  },
};

const GPT_IMAGE_RESOLUTION_LIMITS = {
  '1K': { maxEdge: 1920, maxPixels: 1920 * 1080 },
  '2K': { maxEdge: 2560, maxPixels: 2560 * 1712 },
  '4K': { maxEdge: 3840, maxPixels: 3840 * 2560 },
};

export function ratioToSize(ratio) {
  if (RATIO_TO_SIZE[ratio]) return RATIO_TO_SIZE[ratio];
  const parsed = parseImageRatio(ratio);
  if (!parsed) throw new Error('图片比例格式无效，请使用“宽:高”，例如 16:9');
  if (parsed.value < (1 / 3) || parsed.value > 3) throw new Error('图片比例仅支持 1:3 到 3:1');
  const scale = Math.min(
    MAX_GPT_IMAGE_EDGE / Math.max(parsed.width, parsed.height),
    Math.sqrt(MAX_GPT_IMAGE_PIXELS / (parsed.width * parsed.height)),
  );
  const width = Math.max(16, Math.floor((parsed.width * scale) / 16) * 16);
  const height = Math.max(16, Math.floor((parsed.height * scale) / 16) * 16);
  return `${width}x${height}`;
}

function isGeekNowConfig(cfg = {}) {
  try {
    const hostname = new URL(cfg.baseUrl).hostname.toLowerCase();
    return hostname === 'geeknow.ai'
      || hostname.endsWith('.geeknow.ai')
      || hostname === 'geeknow.top'
      || hostname.endsWith('.geeknow.top');
  } catch {
    return /(?:^|\.)geeknow\.(?:ai|top)(?:\/|$)/i.test(String(cfg.baseUrl || '').trim());
  }
}

function isGrsaiConfig(cfg = {}) {
  try {
    const hostname = new URL(cfg.baseUrl).hostname.toLowerCase();
    return hostname === 'grsaiapi.com'
      || hostname.endsWith('.grsaiapi.com')
      || hostname === 'grsai.dakka.com.cn';
  } catch {
    return /(?:^|\.)grsaiapi\.com(?:\/|$)|grsai\.dakka\.com\.cn(?:\/|$)/i.test(String(cfg.baseUrl || '').trim());
  }
}

function grsaiImageUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/v1\/api\/generate$/i.test(base)) return base;
  if (/\/v1\/api$/i.test(base)) return `${base}/generate`;
  if (/\/v1$/i.test(base)) return `${base}/api/generate`;
  return `${base}/v1/api/generate`;
}

const GRSAI_IMAGE_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];

function grsaiImageRatio(ratio) {
  const parsed = parseImageRatio(ratio);
  if (!parsed) return 'auto';
  const normalized = `${parsed.unitWidth}:${parsed.unitHeight}`;
  if (GRSAI_IMAGE_RATIOS.includes(normalized)) return normalized;
  return GRSAI_IMAGE_RATIOS.slice(1).reduce((closest, candidate) => {
    const candidateRatio = parseImageRatio(candidate)?.value || 1;
    const closestRatio = parseImageRatio(closest)?.value || 1;
    return Math.abs(Math.log(parsed.value / candidateRatio)) < Math.abs(Math.log(parsed.value / closestRatio))
      ? candidate
      : closest;
  }, '1:1');
}

async function resolveGrsaiImageResponse(json, context) {
  const status = String(json?.status || '').trim().toLowerCase();
  if (status === 'failed' || status === 'violation') {
    throw new Error(String(json?.error || `${context}生成${status === 'violation' ? '违反内容规则' : '失败'}`));
  }
  const item = Array.isArray(json?.results) ? json.results.find((result) => result?.url || result?.b64_json) : null;
  if (!item) {
    if (status === 'running') throw new Error(`${context}接口返回了未完成的异步任务${json?.id ? `（${json.id}）` : ''}`);
    throw new Error(`${context}接口未返回 results 图片`);
  }
  return resolveImageResponse(item, context);
}

async function requestGrsaiImage(candidate, prompt, imageB64List, requestedRatio, requestedResolution, context) {
  const body = {
    model: requireModel(candidate, '图片'),
    prompt,
    images: (imageB64List || []).map((data) => `data:image/png;base64,${data}`),
    aspectRatio: grsaiImageRatio(requestedRatio),
    imageSize: normalizeImageResolution(requestedResolution, candidate.model),
    replyType: 'json',
  };
  const json = await postJson(grsaiImageUrl(candidate.baseUrl), candidate.apiKey, body, IMAGE_POST_TIMEOUT_MS);
  return resolveGrsaiImageResponse(json, context);
}

function isGptImage2Model(model = '') {
  // 网关侧同一模型存在多种命名（gpt-image-2-特价 等），因此接受任意「-后缀」；
  // 但点号版本（gpt-image-2.5-*）排除在外，避免错误套用 2.0 的尺寸档位表。
  return /^gpt-image-2(?:-[\w\u4e00-\u9fa5]+)*$/i.test(String(model).trim());
}

function imageModelForResolution(cfg, resolution) {
  const model = requireModel(cfg, '图片');
  if (!isGeekNowConfig(cfg)) return model;
  const normalizedModel = model.toLowerCase();
  if (!['gpt-image-2', 'gpt-image-2-pro'].includes(normalizedModel)) return model;
  return resolution === '1K' ? 'gpt-image-2' : 'gpt-image-2-pro';
}

const GEEK_NOW_GEMINI_IMAGE_MODELS = new Set([
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image-preview',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite-image',
]);

function isGeekNowGeminiImageConfig(cfg = {}) {
  return isGeekNowConfig(cfg) && GEEK_NOW_GEMINI_IMAGE_MODELS.has(String(cfg.model || '').trim().toLowerCase());
}

function geekNowGeminiImageUrl(baseUrl, model) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/(?:v1|v1beta)$/i, '');
  return `${root}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

const GEMINI_IMAGE_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

function geminiImageRatio(ratio) {
  const parsed = parseImageRatio(ratio) || parseImageRatio('1:1');
  const normalized = `${parsed.unitWidth}:${parsed.unitHeight}`;
  if (GEMINI_IMAGE_RATIOS.includes(normalized)) return normalized;
  return GEMINI_IMAGE_RATIOS.reduce((closest, candidate) => {
    const candidateRatio = parseImageRatio(candidate)?.value || 1;
    const closestRatio = parseImageRatio(closest)?.value || 1;
    return Math.abs(Math.log(parsed.value / candidateRatio)) < Math.abs(Math.log(parsed.value / closestRatio))
      ? candidate
      : closest;
  }, '1:1');
}

async function resolveGeminiImageResponse(json, context) {
  const parts = (Array.isArray(json?.candidates) ? json.candidates : [])
    .flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []);
  const imagePart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data);
  const data = String(imagePart?.inlineData?.data || imagePart?.inline_data?.data || '').trim();
  const revisedPrompt = parts.map((part) => String(part?.text || '').trim()).filter(Boolean).join('\n');
  if (!data) {
    const detail = revisedPrompt ? `：${revisedPrompt.slice(0, 300)}` : '';
    throw new Error(`${context}接口未返回 inlineData 图片${detail}`);
  }
  if (/^https?:\/\//i.test(data)) {
    return { ...await downloadImageUrlAsB64(data, { context }), revisedPrompt };
  }
  return {
    b64: data.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''),
    revisedPrompt,
  };
}

async function requestGeekNowGeminiImage(candidate, prompt, imageB64List, requestedRatio, context) {
  const model = requireModel(candidate, '图片');
  const parts = [{ text: prompt }];
  for (const data of imageB64List || []) {
    parts.push({ inlineData: { mimeType: 'image/png', data } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: geminiImageRatio(requestedRatio),
        imageSize: '1K',
      },
    },
  };
  const json = await postJson(
    geekNowGeminiImageUrl(candidate.baseUrl, model),
    candidate.apiKey,
    body,
    IMAGE_POST_TIMEOUT_MS,
  );
  return resolveGeminiImageResponse(json, context);
}

function scaledImageSize(ratio, resolution) {
  const parsed = parseImageRatio(ratio) || parseImageRatio('1:1');
  const limits = GPT_IMAGE_RESOLUTION_LIMITS[resolution] || GPT_IMAGE_RESOLUTION_LIMITS['1K'];
  const scale = Math.min(
    limits.maxEdge / Math.max(parsed.width, parsed.height),
    Math.sqrt(limits.maxPixels / (parsed.width * parsed.height)),
  );
  const width = Math.max(16, Math.floor((parsed.width * scale) / 16) * 16);
  const height = Math.max(16, Math.floor((parsed.height * scale) / 16) * 16);
  return `${width}x${height}`;
}

function gptImage2Size(model, ratio, resolution) {
  const parsed = parseImageRatio(ratio) || parseImageRatio('1:1');
  const normalizedRatio = `${parsed.unitWidth}:${parsed.unitHeight}`;
  const ratioKey = normalizedRatio === '7:3' ? '21:9' : normalizedRatio;
  const normalizedResolution = normalizeImageResolution(resolution, model);
  const table = String(model || '').trim().toLowerCase() === 'gpt-image-2-vip'
    ? GPT_IMAGE_2_VIP_SIZES
    : GPT_IMAGE_2_SIZES;
  return table[normalizedResolution]?.[ratioKey] || scaledImageSize(ratio, normalizedResolution);
}

export function imageSizeForModel(model, ratio, resolution = '') {
  const parsed = parseImageRatio(ratio) || parseImageRatio('1:1');
  const name = String(model || '').trim().toLowerCase();
  if (isGptImage2Model(name)) return gptImage2Size(name, ratio, resolution);
  if (name === 'dall-e-2') return '1024x1024';
  if (name === 'dall-e-3') return parsed.width === parsed.height ? '1024x1024' : (parsed.width > parsed.height ? '1792x1024' : '1024x1792');
  if (/^(?:gpt-image-1(?:\.5|-mini)?|chatgpt-image-latest)/.test(name)) {
    return parsed.width === parsed.height ? '1024x1024' : (parsed.width > parsed.height ? '1536x1024' : '1024x1536');
  }
  return ratioToSize(ratio);
}

function ratioFromSize(size) {
  const match = String(size || '').trim().match(/^(\d{2,4})x(\d{2,4})$/i);
  return match ? `${match[1]}:${match[2]}` : '';
}

async function finalizeImageResponse(item, candidate, usageContext, context) {
  const result = await resolveImageResponse(item, context);
  return finalizeImageResult(result, candidate, usageContext);
}

async function finalizeImageResult(result, candidate, usageContext) {
  const dimensions = imageDimensions(result.b64);
  recordImageRequest(candidate, usageContext);
  return {
    ...result,
    width: dimensions?.width || 0,
    height: dimensions?.height || 0,
    ratioAdjusted: false,
  };
}

function imageResponseFormat(cfg = {}) {
  return isGeekNowConfig(cfg) && isGptImage2Model(cfg.model) ? 'url' : 'b64_json';
}

// 调用图片模型生成图片，返回 base64（PNG）
// 兼容两种返回：data[].b64_json 或 data[].url
export async function generateImage(cfg, prompt, { size, ratio, resolution, usageContext = {} } = {}) {
  return withCandidateRetries(cfg, async (candidate) => {
    try {
      const url = joinUrl(candidate.baseUrl, '/images/generations');
      const requestedRatio = ratio || ratioFromSize(size) || candidate.ratio || '1:1';
      const requestedResolution = normalizeImageResolution(resolution || candidate.resolution, candidate.model);
      if (isGrsaiConfig(candidate)) {
        const result = await requestGrsaiImage(candidate, prompt, [], requestedRatio, requestedResolution, '图片');
        return await finalizeImageResult(result, candidate, usageContext);
      }
      if (isGeekNowGeminiImageConfig(candidate)) {
        const result = await requestGeekNowGeminiImage(candidate, prompt, [], requestedRatio, '图片');
        return await finalizeImageResult(result, candidate, usageContext);
      }
      const requestModel = imageModelForResolution(candidate, requestedResolution);
      const body = {
        model: requestModel,
        prompt,
        n: 1,
        size: size || imageSizeForModel(requestModel, requestedRatio, requestedResolution),
        response_format: imageResponseFormat(candidate),
      };
      // 与 editImage 一致用 15 分钟超时：群像等多人复杂图经常超过 5 分钟，
      // 之前的 300 秒会在“站点后台已出图”时提前断开，本地拿不到 URL 也无法转入待同步
      const json = await postJson(url, candidate.apiKey, body, IMAGE_POST_TIMEOUT_MS);
      return await finalizeImageResponse(json?.data?.[0], candidate, usageContext, '图片');
    } catch (error) {
      recordImageRequest(candidate, usageContext, 'failed', error?.message || error);
      throw error;
    }
  });
}

// 图生图（换装）：以参考图 + 穿着描述生成新图，保持同一人物只换服装
// GeekNow 的 gpt-image-2 用 /images/generations + JSON image，其他模型走 /images/edits（multipart）。
// imageB64 为参考图的 base64(PNG)
function normalizeImageB64List(imageB64) {
  const rawList = Array.isArray(imageB64) ? imageB64 : [imageB64];
  const list = rawList
    .map((item) => String(item || '').trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''))
    .filter(Boolean);
  if (!list.length) throw new Error('Missing reference image');
  return list.slice(0, 9);
}

async function editImageSingle(candidate, prompt, imageB64, { size, ratio, resolution, usageContext = {} } = {}) {
  const imageB64List = normalizeImageB64List(imageB64);
  const requestedRatio = ratio || ratioFromSize(size) || candidate.ratio || '1:1';
  const requestedResolution = normalizeImageResolution(resolution || candidate.resolution, candidate.model);
  try {
    if (isGrsaiConfig(candidate)) {
      const result = await requestGrsaiImage(candidate, prompt, imageB64List, requestedRatio, requestedResolution, '参考图生成');
      return await finalizeImageResult(result, candidate, usageContext);
    }

    if (isGeekNowGeminiImageConfig(candidate)) {
      const result = await requestGeekNowGeminiImage(candidate, prompt, imageB64List, requestedRatio, '参考图生成');
      return await finalizeImageResult(result, candidate, usageContext);
    }

    if (isGeekNowConfig(candidate) && isGptImage2Model(candidate.model)) {
      const url = joinUrl(candidate.baseUrl, '/images/generations');
      const requestModel = imageModelForResolution(candidate, requestedResolution);
      const body = {
        model: requestModel,
        prompt,
        n: 1,
        size: size || imageSizeForModel(requestModel, requestedRatio, requestedResolution),
        response_format: 'url',
        image: imageB64List,
      };
      const json = await postJson(url, candidate.apiKey, body, IMAGE_POST_TIMEOUT_MS);
      return await finalizeImageResponse(json?.data?.[0], candidate, usageContext, '换装图片');
    }

    const url = joinUrl(candidate.baseUrl, '/images/edits');
    const form = new FormData();
    form.append('model', requireModel(candidate, '图片'));
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', size || imageSizeForModel(candidate.model, requestedRatio, requestedResolution));
    imageB64List.forEach((item, index) => {
      const bytes = Buffer.from(item, 'base64');
      const filename = imageB64List.length === 1 ? 'reference.png' : `reference-${index + 1}.png`;
      form.append('image', new Blob([bytes], { type: 'image/png' }), filename);
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_POST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${candidate.apiKey}` }, // 不要手动设 Content-Type，让 fetch 带 boundary
        body: form,
        signal: controller.signal,
      });
      const text = await resp.text();
      let json;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (!resp.ok) {
        const msg = json?.error?.message || json?.message || json?.raw || `HTTP ${resp.status}`;
        const err = new Error(msg);
        err.status = resp.status;
        throw err;
      }
      return await finalizeImageResponse(json?.data?.[0], candidate, usageContext, '换装图片');
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    recordImageRequest(candidate, usageContext, 'failed', error?.message || error);
    throw error;
  }
}

export async function editImage(cfg, prompt, imageB64, options = {}) {
  return withCandidateRetries(cfg, (candidate) => editImageSingle(candidate, prompt, imageB64, options));
}

// 测试图片模型连通性：用最小尺寸出一张图（会消耗少量额度）
export async function testImageModel(cfg) {
  const resolution = /gpt-image-2-pro$/i.test(String(cfg?.model || '').trim()) ? '2K' : '1K';
  const { b64 } = await generateImage(cfg, 'a single small red apple on white background', {
    ratio: '1:1',
    resolution,
  });
  return { ok: true, bytes: Math.floor((b64.length * 3) / 4) };
}
