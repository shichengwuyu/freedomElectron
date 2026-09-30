import { extractJsonObject } from './jsonParse.js';
import { hasTextModelKey, resolveTextModelConfig } from './modelRouting.js';

function normalizeAgentAttachments(rawAttachments = []) {
  return (Array.isArray(rawAttachments) ? rawAttachments.slice(0, 12) : [])
    .map((file) => {
      const kind = String(file?.kind || '').trim() || 'file';
      const name = String(file?.name || '').trim() || 'unnamed';
      const type = String(file?.type || '').trim() || 'application/octet-stream';
      const dataUrl = typeof file?.dataUrl === 'string' && /^data:image\//i.test(file.dataUrl) ? file.dataUrl : '';
      const text = typeof file?.text === 'string' ? file.text.slice(0, 40000) : '';
      return {
        id: String(file?.id || '').trim(),
        name,
        kind,
        type,
        size: Number(file?.size) || 0,
        text,
        rawTextLength: Number(file?.rawTextLength) || text.length,
        truncated: !!file?.truncated || (typeof file?.text === 'string' && file.text.length > 40000),
        dataUrl,
      };
    })
    .filter((file) => file.id || file.name);
}

function buildSafeAgentState(state = {}) {
  return {
    ...state,
    cfg: state.cfg
      ? {
          ...state.cfg,
          text: { ...(state.cfg.text || {}), apiKey: state.cfg.text?.hasKey ? '[configured]' : '' },
          image: {
            ...(state.cfg.image || {}),
            apiKey: state.cfg.image?.hasKey ? '[configured]' : '',
            channels: (state.cfg.image?.channels || []).map(({ apiKey, ...channel }) => ({ ...channel, hasKey: Boolean(apiKey || channel.hasKey) })),
          },
          video: {
            ...(state.cfg.video || {}),
            apiKey: state.cfg.video?.apiHasKey ? '[configured]' : '',
            apiChannels: (state.cfg.video?.apiChannels || []).map(({ apiKey, ...channel }) => ({ ...channel, hasKey: Boolean(apiKey || channel.hasKey) })),
          },
        }
      : undefined,
  };
}

function buildAttachmentContext(attachments = []) {
  return attachments.map((file) => ({
    id: file.id,
    name: file.name,
    kind: file.kind,
    type: file.type,
    size: file.size,
    text: file.kind === 'text' ? file.text : undefined,
    rawTextLength: file.rawTextLength,
    truncated: file.truncated,
    visionIncluded: file.kind === 'image' && !!file.dataUrl && file.dataUrl.length <= 25 * 1024 * 1024,
  }));
}

function buildAgentMessages({ systemPrompt, state, history, instruction, attachments }) {
  const planningPayload = {
    currentState: buildSafeAgentState(state),
    recentConversation: history,
    instruction,
    attachments: buildAttachmentContext(attachments),
  };
  const userTextContent = JSON.stringify(planningPayload);
  const userContent = [{ type: 'text', text: userTextContent }];
  for (const file of attachments) {
    if (file.kind === 'image' && file.dataUrl && file.dataUrl.length <= 25 * 1024 * 1024) {
      userContent.push({ type: 'image_url', image_url: { url: file.dataUrl } });
    }
  }
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent.length > 1 ? userContent : userTextContent },
    ],
    textOnlyMessages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userTextContent },
    ],
    hasVisionInput: userContent.length > 1,
  };
}

export async function handleAgentPlanRoute({
  req,
  res,
  p,
  method,
  readBody,
  sendJson,
  loadConfig,
  chatComplete,
  systemPrompt,
}) {
  if (p !== '/api/agent/plan' || method !== 'POST') return false;

  const body = await readBody(req);
  const instruction = String(body.instruction || '').trim();
  const attachments = normalizeAgentAttachments(body.attachments);
  if (!instruction && !attachments.length) return sendJson(res, 400, { error: 'Missing instruction' });

  const cfg = loadConfig();
  if (!hasTextModelKey(cfg, 'agent')) {
    return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  }

  const state = body.state && typeof body.state === 'object' ? body.state : {};
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const { messages, textOnlyMessages, hasVisionInput } = buildAgentMessages({
    systemPrompt,
    state,
    history,
    instruction,
    attachments,
  });

  try {
    const callOptions = {
      temperature: 0.15,
      maxTokens: Math.min(Number(cfg.text.maxTokens) || 12000, 32000),
      allowTruncated: false,
    };
    let raw;
    try {
      raw = await chatComplete(resolveTextModelConfig(cfg, 'agent', { projectId: state.project?.id || '', operation: 'agent-plan' }), messages, callOptions);
    } catch (e) {
      if (!hasVisionInput) throw e;
      raw = await chatComplete(resolveTextModelConfig(cfg, 'agent', { projectId: state.project?.id || '', operation: 'agent-plan-text-fallback' }), textOnlyMessages, callOptions);
    }
    const plan = extractJsonObject(raw, { preferObject: true });
    if (!plan || typeof plan !== 'object') throw new Error('Agent plan was not an object');
    if (!Array.isArray(plan.actions)) plan.actions = [];
    if (typeof plan.reply !== 'string') plan.reply = '我会按你的要求操作。';
    return sendJson(res, 200, { ok: true, plan });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: e.message });
  }
}
