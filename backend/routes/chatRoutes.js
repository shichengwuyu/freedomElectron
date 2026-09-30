import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chatComplete, chatCompleteStream } from '../apiClient.js';
import {
  automaticContinuationPrompt,
  buildCompletionAuditMessages,
  findCompletionRequest,
  isObviouslyIncompleteDelivery,
  parseCompletionAudit,
  shouldAuditChatCompletion,
} from '../chatCompletionGuard.js';
import { loadConfig } from '../config.js';
import {
  createChatSkillUploadPath,
  importChatSkillsFromFiles,
  importChatSkillsFromZip,
  listChatSkills,
  publicChatSkill,
  removeChatSkill,
  resolveChatSkillContext,
} from '../chatSkills.js';
import { saveRequestBodyToFile } from '../http.js';
import {
  generateConfiguredImage,
  imageProviderConfigError,
  imageProviderLabel,
  normalizeImageProvider,
} from '../imageProviders.js';
import { createSseSession, sseSend } from '../lib/sse.js';
import { resolveTextModelConfig } from '../modelRouting.js';
import { planWebSearchQuery, searchWeb } from '../webSearch.js';
import {
  CHAT_DB_PATH,
  activateMessageVersion,
  branchChatConversation,
  createAssistantVersion,
  createChatConversation,
  createChatMessage,
  createChatPrompt,
  deleteChatMessage,
  deleteChatPrompt,
  exportChatConversation,
  getChatConversation,
  getChatMessage,
  getChatMessages,
  importChatConversation,
  listChatConversations,
  listChatPrompts,
  listMessageVersions,
  purgeChatConversation,
  removeChatSkillReferences,
  searchChatContent,
  setChatConversationStatus,
  updateChatConversation,
  updateChatMessage,
  updateChatPrompt,
} from '../chatStore.js';

const CHAT_IMAGE_DIR = path.join(path.dirname(CHAT_DB_PATH), 'images');
const MAX_AUTOMATIC_CONTINUATIONS = 12;
const BASE_SYSTEM_PROMPT = `你是Freedom Chat，一个可靠、清晰、有判断力的 AI 助手。
直接回答问题，避免空泛复述。复杂内容使用清晰结构；允许使用 Markdown、表格和代码块。
不要假装调用不存在的工具，不要声称访问了用户未提供的信息。`;
const COMPLETE_EXECUTION_PROMPT = `【完整执行保护｜高优先级】
1. 完整、逐项执行用户当前请求以及仍然有效的上下文要求。回答前在内部核对所有约束、数量、格式、范围、顺序和交付项，不得漏项。
2. 除非用户明确要求简洁、摘要、压缩、限制字数、只给结论，或明确选择了“简洁”回答方式，否则不得以内容太多、篇幅有限、字数过多、避免冗长、时间或工作量较大等理由擅自删减、概述或改发精简版。
3. 不得用模板、示例、提纲、框架、伪代码、部分结果或“其余类似”等占位表达替代用户要求的完整成品，除非用户明确要求这些形式。
4. 如果任务很长，仍按原规格继续完成。接近单次输出技术上限时，应从中断位置无重复地继续，不得改成摘要，也不得要求用户缩短需求。
5. 用户明确指定语言、风格、格式、数量、比例、文件或验收标准时必须遵守。要求确有冲突时，优先执行用户最新且更具体的要求，并只说明无法同时满足的冲突点。
6. “上下文压缩记忆”只用于保存较早对话事实，绝不能成为压缩当前回答、降低交付数量或忽略用户最新要求的理由。`;
const ONE_SHOT_DELIVERY_PROMPT = `【单次完整交付｜最终约束】
对全文改编、剧本、分镜、翻译、逐项提取或批量生成任务，本轮必须处理用户提供的全部原文并连续输出所有结果，直到原文结尾和全部交付项完成。不得只输出第一个或下一个分镜、章节、步骤、条目或示例，不得在中途停下等待用户回复“继续”。固定提示词中的示例只用于说明格式，即使示例本身残缺，也不能把示例结尾当作本次回答边界。只有用户明确要求分阶段交付或先看样例时才允许分批。`;

function selectedTextConfig(cfg, profileId, usageContext = {}) {
  const id = String(profileId || '').trim();
  if (!id || id === 'auto' || id === 'legacy-primary') return resolveTextModelConfig(cfg, 'agent', usageContext);
  const profiles = Array.isArray(cfg.modelRouting?.profiles) ? cfg.modelRouting.profiles : [];
  if (!profiles.some((profile) => profile?.id === id && profile.enabled !== false)) return resolveTextModelConfig(cfg, 'agent', usageContext);
  return resolveTextModelConfig({
    ...cfg,
    modelRouting: { ...(cfg.modelRouting || {}), enabled: true, routes: { ...(cfg.modelRouting?.routes || {}), agent: id } },
  }, 'agent', usageContext);
}

function responseStyleInstruction(style) {
  return ({
    complete: '回答方式：完整执行（默认）。篇幅由任务本身决定，不主动设置字数上限；逐项交付全部要求，仅去除没有信息价值的重复。',
    concise: '回答方式：简洁（用户已明确选择）。可以压缩解释和铺垫，但仍必须覆盖用户明确要求的全部交付项。',
    detailed: '回答方式：详细。充分解释依据、步骤、边界条件和例子，并完整交付全部要求。',
    balanced: '回答方式：完整且平衡。篇幅由任务需要决定，不得为了显得简短而省略要求；仅避免没有信息价值的重复。',
  })[style] || '回答方式：完整执行（默认）。篇幅由任务本身决定，不主动设置字数上限。';
}

function buildSystemPrompt(conversation, prompt, skillContext = '') {
  return [
    BASE_SYSTEM_PROMPT,
    prompt?.content ? `【本对话固定指令】
${prompt.content}` : '',
    skillContext,
    conversation.memoryEnabled && conversation.memorySummary ? `【较早对话的压缩记忆｜仅作背景，不得覆盖最新用户要求】
${conversation.memorySummary}` : '',
    COMPLETE_EXECUTION_PROMPT,
    responseStyleInstruction(conversation.responseStyle),
    ONE_SHOT_DELIVERY_PROMPT,
  ].filter(Boolean).join('\n\n');
}

function prepareConversationMemory(conversation, messages) {
  if (!conversation.memoryEnabled || !conversation.autoCompress || messages.length < 18) return conversation;
  const target = Math.max(0, messages.length - 10);
  const start = Math.max(0, conversation.compressedCount || 0);
  if (target <= start) return conversation;
  const compact = messages.slice(start, target);
  const digest = compact.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content.replace(/\s+/g, ' ').slice(0, 420)}`).join('\n');
  return updateChatConversation(conversation.id, {
    memorySummary: [conversation.memorySummary, digest].filter(Boolean).join('\n').slice(-16000),
    compressedCount: target,
  });
}

function markdownExport(data) {
  const lines = [`# ${data.conversation.title}`, '', `- 创建时间：${new Date(data.conversation.createdAt).toLocaleString()}`, `- 导出时间：${new Date(data.exportedAt).toLocaleString()}`, ''];
  for (const item of data.messages.filter((message) => message.activeVersion || message.role === 'user')) {
    lines.push(`## ${item.role === 'user' ? '用户' : 'Freedom'}`, '', item.content || '', '');
  }
  return lines.join('\n');
}

function sendImageFile(res, fileName) {
  const safe = path.basename(fileName || '');
  const file = path.join(CHAT_IMAGE_DIR, safe);
  if (!safe || !fs.existsSync(file)) return false;
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
  res.end(data);
  return true;
}

function cleanChatImageB64(value) {
  const raw = String(value || '').trim();
  const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
  if (!b64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return '';
  return b64.replace(/\s+/g, '');
}

function chatAttachmentSummary(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).slice(0, 9).map((item) => ({
    name: String(item?.name || 'reference.png').slice(0, 160),
    kind: String(item?.kind || 'image'),
    size: Number(item?.size) || 0,
    type: String(item?.type || ''),
  }));
}

function chatReferenceImages(attachments = []) {
  const list = Array.isArray(attachments) ? attachments : [];
  return list
    .filter((item) => item?.kind === 'image' || /^data:image\//i.test(String(item?.dataUrl || item?.imageB64 || '')))
    .map((item) => cleanChatImageB64(item?.imageB64 || item?.dataUrl || item?.b64))
    .filter(Boolean)
    .slice(0, 9);
}

export async function handleChatRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if (method === 'GET' && p.startsWith('/api/chat/images/')) {
    if (sendImageFile(res, decodeURIComponent(p.slice('/api/chat/images/'.length)))) return true;
    return sendJson(res, 404, { error: '图片不存在' });
  }

  if (p === '/api/chat/conversations' && method === 'GET') {
    return sendJson(res, 200, { conversations: listChatConversations({ status: url.searchParams.get('status') || 'active', q: url.searchParams.get('q') || '', folder: url.searchParams.get('folder') || '' }) });
  }
  if (p === '/api/chat/conversations' && method === 'POST') {
    return sendJson(res, 200, { conversation: createChatConversation(await readBody(req)) });
  }
  if (p === '/api/chat/search' && method === 'GET') {
    return sendJson(res, 200, { results: searchChatContent(url.searchParams.get('q') || '') });
  }
  if (p === '/api/chat/skills' && method === 'GET') {
    return sendJson(res, 200, { skills: listChatSkills().map(publicChatSkill) });
  }
  if (p === '/api/chat/skills/import-folder' && method === 'POST') {
    try {
      const body = await readBody(req, 12 * 1024 * 1024);
      const skills = importChatSkillsFromFiles({ name: body.name, files: body.files });
      return sendJson(res, 200, { ok: true, skills: skills.map(publicChatSkill) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }
  if (p === '/api/chat/skills/import-zip' && method === 'POST') {
    const uploadFile = createChatSkillUploadPath();
    try {
      await saveRequestBodyToFile(req, uploadFile, 32 * 1024 * 1024);
      const skills = await importChatSkillsFromZip(uploadFile, url.searchParams.get('name') || 'Skill.zip');
      return sendJson(res, 200, { ok: true, skills: skills.map(publicChatSkill) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    } finally {
      try { fs.rmSync(uploadFile, { force: true }); } catch { /* ignore */ }
    }
  }
  const skillMatch = p.match(/^\/api\/chat\/skills\/([^/]+)$/);
  if (skillMatch && method === 'DELETE') {
    const skillId = decodeURIComponent(skillMatch[1]);
    const ok = removeChatSkill(skillId);
    if (ok) removeChatSkillReferences(skillId);
    return sendJson(res, 200, { ok });
  }
  if (p === '/api/chat/prompts' && method === 'GET') return sendJson(res, 200, { prompts: listChatPrompts() });
  if (p === '/api/chat/prompts' && method === 'POST') return sendJson(res, 200, { prompt: createChatPrompt(await readBody(req)) });
  if (p === '/api/chat/import' && method === 'POST') return sendJson(res, 200, { conversation: importChatConversation(await readBody(req)) });

  const promptMatch = p.match(/^\/api\/chat\/prompts\/([^/]+)$/);
  if (promptMatch && method === 'PATCH') return sendJson(res, 200, { prompt: updateChatPrompt(decodeURIComponent(promptMatch[1]), await readBody(req)) });
  if (promptMatch && method === 'DELETE') return sendJson(res, 200, { ok: deleteChatPrompt(decodeURIComponent(promptMatch[1])) });

  const conversationMatch = p.match(/^\/api\/chat\/conversations\/([^/]+)$/);
  if (conversationMatch) {
    const conversationId = decodeURIComponent(conversationMatch[1]);
    if (method === 'GET') {
      const conversation = getChatConversation(conversationId);
      if (!conversation) return sendJson(res, 404, { error: '对话不存在' });
      return sendJson(res, 200, { conversation, messages: getChatMessages(conversationId) });
    }
    if (method === 'PATCH') return sendJson(res, 200, { conversation: updateChatConversation(conversationId, await readBody(req)) });
    if (method === 'DELETE') return sendJson(res, 200, { conversation: setChatConversationStatus(conversationId, 'trash') });
  }

  const conversationAction = p.match(/^\/api\/chat\/conversations\/([^/]+)\/(archive|restore|trash|purge|branch|export|messages)$/);
  if (conversationAction) {
    const conversationId = decodeURIComponent(conversationAction[1]);
    const action = conversationAction[2];
    if (action === 'messages' && method === 'GET') return sendJson(res, 200, { messages: getChatMessages(conversationId) });
    if (action === 'archive' && method === 'POST') return sendJson(res, 200, { conversation: setChatConversationStatus(conversationId, 'archived') });
    if (action === 'restore' && method === 'POST') return sendJson(res, 200, { conversation: setChatConversationStatus(conversationId, 'active') });
    if (action === 'trash' && method === 'POST') return sendJson(res, 200, { conversation: setChatConversationStatus(conversationId, 'trash') });
    if (action === 'purge' && method === 'DELETE') return sendJson(res, 200, { ok: purgeChatConversation(conversationId) });
    if (action === 'branch' && method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, { conversation: branchChatConversation(conversationId, body.messageId, body.title) });
    }
    if (action === 'export' && method === 'GET') {
      const data = exportChatConversation(conversationId);
      if (!data) return sendJson(res, 404, { error: '对话不存在' });
      return sendJson(res, 200, { data, markdown: markdownExport(data) });
    }
  }

  const messageMatch = p.match(/^\/api\/chat\/messages\/([^/]+)$/);
  if (messageMatch) {
    const messageId = decodeURIComponent(messageMatch[1]);
    if (method === 'PATCH') {
      const body = await readBody(req);
      const updated = updateChatMessage(messageId, body);
      if (body.truncateAfter) {
        const messages = getChatMessages(updated.conversationId);
        for (const item of messages.filter((item) => item.createdAt > updated.createdAt)) deleteChatMessage(item.id);
      }
      return sendJson(res, 200, { message: updated });
    }
    if (method === 'DELETE') return sendJson(res, 200, { ok: deleteChatMessage(messageId, { truncate: url.searchParams.get('truncate') === '1' }) });
  }
  const versionMatch = p.match(/^\/api\/chat\/messages\/([^/]+)\/(versions|activate)$/);
  if (versionMatch) {
    const messageId = decodeURIComponent(versionMatch[1]);
    if (versionMatch[2] === 'versions' && method === 'GET') return sendJson(res, 200, { versions: listMessageVersions(messageId) });
    if (versionMatch[2] === 'activate' && method === 'POST') return sendJson(res, 200, { message: activateMessageVersion(messageId) });
  }

  if (p === '/api/chat/stream' && method === 'POST') {
    const body = await readBody(req);
    let conversation = getChatConversation(String(body.conversationId || ''));
    if (!conversation) return sendJson(res, 404, { error: '对话不存在' });
    const cfg = loadConfig();
    const profileId = String(body.modelProfileId || conversation.modelProfileId || 'auto');
    const modelCfg = selectedTextConfig(cfg, profileId, { operation: 'chat-center' });
    if (!modelCfg.apiKey) return sendJson(res, 400, { error: '请先在设置中配置文本模型 API Key' });

    let userMessage = null;
    let sourceAssistant = null;
    const content = String(body.content || '').trim();
    if (body.regenerateMessageId) {
      sourceAssistant = getChatMessage(String(body.regenerateMessageId));
      if (!sourceAssistant || sourceAssistant.conversationId !== conversation.id || sourceAssistant.role !== 'assistant') return sendJson(res, 400, { error: '无法重新生成该消息' });
    } else if (body.compareUserMessageId) {
      userMessage = getChatMessage(String(body.compareUserMessageId));
      if (!userMessage || userMessage.conversationId !== conversation.id || userMessage.role !== 'user') return sendJson(res, 400, { error: '无法比较该消息' });
    } else if (body.existingUserMessageId) {
      userMessage = getChatMessage(String(body.existingUserMessageId));
      if (!userMessage || userMessage.conversationId !== conversation.id || userMessage.role !== 'user') return sendJson(res, 400, { error: '无法编辑该消息' });
      if (!content) return sendJson(res, 400, { error: '消息不能为空' });
      userMessage = updateChatMessage(userMessage.id, { content });
      const later = getChatMessages(conversation.id).filter((item) => item.createdAt > userMessage.createdAt || (item.createdAt === userMessage.createdAt && item.role === 'assistant'));
      for (const item of later) deleteChatMessage(item.id);
    } else {
      if (!content) return sendJson(res, 400, { error: '消息不能为空' });
      userMessage = createChatMessage(conversation.id, { role: 'user', content, status: 'complete', metadata: { quotedMessageId: body.quotedMessageId || '', attachments: (Array.isArray(body.attachments) ? body.attachments : []).map((item) => ({ name: item.name, kind: item.kind, size: item.size })) } });
      if (conversation.title === '新对话') conversation = updateChatConversation(conversation.id, { title: content.replace(/\s+/g, ' ').slice(0, 32) });
    }

    const webSearchEnabled = body.webSearch === true;
    const skillContext = resolveChatSkillContext(conversation.skillIds);
    const appliedSkills = skillContext.skills.map((skill) => ({ id: skill.id, name: skill.name, version: skill.version }));
    let assistantMessage;
    if (sourceAssistant) assistantMessage = createAssistantVersion(sourceAssistant.id, {
      content: '', status: 'generating', model: modelCfg.__routing?.profileName || modelCfg.model || '',
      metadata: { comparisonSlot: body.comparisonSlot || '', skills: appliedSkills, webSearch: webSearchEnabled, webSearchStatus: webSearchEnabled ? 'searching' : '' },
    });
    else assistantMessage = createChatMessage(conversation.id, {
      role: 'assistant', content: '', status: 'generating', model: modelCfg.__routing?.profileName || modelCfg.model || '', parentMessageId: userMessage.id,
      metadata: { comparisonSlot: body.comparisonSlot || '', skills: appliedSkills, webSearch: webSearchEnabled, webSearchStatus: webSearchEnabled ? 'searching' : '' },
    });

    let history = getChatMessages(conversation.id).filter((item) => item.id !== assistantMessage.id);
    if (sourceAssistant) history = history.filter((item) => item.createdAt < sourceAssistant.createdAt || item.role === 'user' && item.createdAt === sourceAssistant.createdAt);
    conversation = prepareConversationMemory(conversation, history);
    const prompt = listChatPrompts().find((item) => item.id === conversation.promptId) || listChatPrompts()[0];
    const recentStart = conversation.memoryEnabled ? Math.max(conversation.compressedCount || 0, history.length - 20) : Math.max(0, history.length - 20);
    const modelMessages = [{ role: 'system', content: buildSystemPrompt(conversation, prompt, skillContext.text) }, ...history.slice(recentStart).map((item) => ({ role: item.role, content: item.content }))];
    const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 8);
    if (attachments.length) {
      const lastUserIndex = modelMessages.findLastIndex((item) => item.role === 'user');
      if (lastUserIndex >= 0) {
        const parts = [{ type: 'text', text: String(modelMessages[lastUserIndex].content || '') }];
        for (const file of attachments) {
          if (file?.kind === 'image' && typeof file.dataUrl === 'string' && /^data:image\//i.test(file.dataUrl) && file.dataUrl.length <= 25 * 1024 * 1024) parts.push({ type: 'image_url', image_url: { url: file.dataUrl } });
          else if (file?.kind === 'text' && file.text) parts[0].text += `\n\n【附件：${String(file.name || '文本')}】\n${String(file.text).slice(0, 40000)}`;
        }
        modelMessages[lastUserIndex].content = parts.length > 1 ? parts : parts[0].text;
      }
    }

    const session = createSseSession(req, res);
    sseSend(res, 'meta', { conversation, userMessage, assistantMessage });
    let generated = '';
    let automaticContinuationCount = 0;
    let completionAuditCount = 0;
    let completionVerified = false;
    let activeModelMessages = modelMessages;
    const completionRequest = findCompletionRequest(modelMessages);
    let webResearch = null;
    const startedAt = Date.now();
    try {
      if (webSearchEnabled) {
        const sourceUser = userMessage
          || (sourceAssistant?.parentMessageId ? getChatMessage(sourceAssistant.parentMessageId) : null)
          || [...history].reverse().find((item) => item.role === 'user');
        const searchQuery = String(content || sourceUser?.content || '').trim();
        if (!searchQuery) throw new Error('没有找到可用于联网搜索的问题');
        sseSend(res, 'search', { status: 'searching', query: searchQuery });
        const plannedQuery = await planWebSearchQuery(searchQuery, {
          signal: session.signal,
          complete: (messages, options) => chatComplete(modelCfg, messages, options),
        });
        webResearch = await searchWeb(plannedQuery, { signal: session.signal, limit: 6, fetchPages: 4 });
        modelMessages[0].content = `${modelMessages[0].content}\n\n${webResearch.context}`;
        assistantMessage = updateChatMessage(assistantMessage.id, {
          metadata: {
            ...(assistantMessage.metadata || {}),
            webSearch: true,
            webSearchStatus: 'done',
            webSearchQuery: webResearch.query,
            webSearchProvider: webResearch.provider,
            webSources: webResearch.sources,
          },
        });
        sseSend(res, 'search', {
          status: 'done', query: webResearch.query, provider: webResearch.provider,
          cached: webResearch.cached, sources: webResearch.sources,
        });
      }
      while (true) {
        let continuationReason = '';
        let reachedLengthLimit = false;
        try {
          await chatCompleteStream(modelCfg, activeModelMessages, {
            temperature: Number(body.temperature ?? conversation.temperature ?? 0.65),
            maxTokens: Math.min(Number(modelCfg.maxTokens) || 32000, 64000),
            signal: session.signal,
            onDelta: (text) => { generated += text; sseSend(res, 'delta', { text, messageId: assistantMessage.id }); },
          });
        } catch (error) {
          if (!error?.truncated || session.signal.aborted) throw error;
          reachedLengthLimit = true;
          continuationReason = '模型达到了单次输出长度上限。';
        }

        const auditRequired = !reachedLengthLimit && shouldAuditChatCompletion({
          fixedPrompt: prompt?.content || '',
          userRequest: completionRequest,
          answer: generated,
        });
        if (!reachedLengthLimit && !auditRequired) break;

        if (auditRequired) {
          completionAuditCount += 1;
          try {
            const auditRaw = await chatComplete(modelCfg, buildCompletionAuditMessages({
              fixedPrompt: prompt?.content || '',
              userRequest: completionRequest,
              answer: generated,
            }), { temperature: 0, maxTokens: 500, signal: session.signal });
            const audit = parseCompletionAudit(auditRaw);
            if (audit.complete === true) {
              completionVerified = true;
              break;
            }
            if (audit.complete === false) continuationReason = audit.reason || '回答尚未覆盖全部原文或交付项。';
            else if (!isObviouslyIncompleteDelivery({ fixedPrompt: prompt?.content || '', userRequest: completionRequest, answer: generated })) break;
          } catch (auditError) {
            if (session.signal.aborted) throw auditError;
            if (!isObviouslyIncompleteDelivery({ fixedPrompt: prompt?.content || '', userRequest: completionRequest, answer: generated })) break;
            continuationReason = '当前回答明显只覆盖了原请求的一部分。';
          }
        }

        if (automaticContinuationCount >= MAX_AUTOMATIC_CONTINUATIONS) {
          const limitError = new Error(`系统已自动续写 ${automaticContinuationCount} 次，但完整性核验仍未通过；已保留全部生成内容。`);
          limitError.truncated = true;
          throw limitError;
        }
        automaticContinuationCount += 1;
        sseSend(res, 'continuation', { count: automaticContinuationCount, messageId: assistantMessage.id });
        activeModelMessages = [
          ...modelMessages,
          { role: 'assistant', content: generated },
          { role: 'user', content: automaticContinuationPrompt(continuationReason) },
        ];
      }
      assistantMessage = updateChatMessage(assistantMessage.id, {
        content: generated,
        status: 'complete',
        metadata: {
          ...(assistantMessage.metadata || {}), durationMs: Date.now() - startedAt, profileId,
          model: modelCfg.model || '', comparisonSlot: body.comparisonSlot || '', automaticContinuationCount,
          completionAuditCount, completionVerified,
          webSearch: webSearchEnabled, webSearchStatus: webSearchEnabled ? 'done' : '',
          webSearchQuery: webResearch?.query || '', webSearchProvider: webResearch?.provider || '',
          webSources: webResearch?.sources || [],
        },
      });
      sseSend(res, 'done', { conversation: getChatConversation(conversation.id), message: assistantMessage });
    } catch (error) {
      assistantMessage = updateChatMessage(assistantMessage.id, {
        content: generated,
        status: session.signal.aborted ? 'stopped' : 'error',
        error: session.signal.aborted ? '' : error.message,
        metadata: {
          ...(assistantMessage.metadata || {}), durationMs: Date.now() - startedAt, profileId,
          model: modelCfg.model || '', comparisonSlot: body.comparisonSlot || '', automaticContinuationCount,
          completionAuditCount, completionVerified,
          webSearch: webSearchEnabled, webSearchStatus: webSearchEnabled ? 'error' : '',
          webSearchQuery: webResearch?.query || '', webSearchProvider: webResearch?.provider || '',
          webSources: webResearch?.sources || [],
        },
      });
      if (!session.signal.aborted) sseSend(res, 'error', { message: error.message || '对话生成失败', assistantMessage });
    } finally {
      session.close();
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  if (p === '/api/chat/image' && method === 'POST') {
    const body = await readBody(req);
    const conversation = getChatConversation(String(body.conversationId || ''));
    if (!conversation) return sendJson(res, 404, { error: '对话不存在' });
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const referenceImages = chatReferenceImages(attachments);
    const prompt = String(body.prompt || '').trim() || (referenceImages.length ? '请基于参考图生成一张新图，保持主体特征和画面质感。' : '');
    if (!prompt) return sendJson(res, 400, { error: '图片提示词不能为空' });
    const cfg = loadConfig();
    const configError = imageProviderConfigError(cfg);
    if (configError) return sendJson(res, 400, { error: configError });
    const ratio = String(body.ratio || cfg.image.ratio || '16:9').trim();
    const imageMode = referenceImages.length ? 'image-to-image' : 'text-to-image';
    const referenceMetadata = { mode: 'image', imageMode, ratio, referenceImageCount: referenceImages.length };
    const userMessage = createChatMessage(conversation.id, {
      role: 'user',
      content: prompt,
      metadata: { ...referenceMetadata, attachments: chatAttachmentSummary(attachments) },
    });
    const imageProvider = normalizeImageProvider(cfg.image?.provider);
    const imageModel = imageProvider === 'libtv-cli'
      ? cfg.image?.libtvModel
      : imageProvider === 'dreamina-cli' ? cfg.image?.dreaminaModel
        : imageProvider === 'updream' ? cfg.image?.updreamModel
          : imageProvider === 'neowow' ? cfg.image?.neowowModel : cfg.image?.model;
    const pending = createChatMessage(conversation.id, {
      role: 'assistant',
      content: '',
      status: 'generating',
      model: imageModel || imageProviderLabel(imageProvider),
      parentMessageId: userMessage.id,
      metadata: referenceMetadata,
    });
    try {
      const usageContext = { task: 'chat-image', operation: referenceImages.length ? 'chat-image-edit' : 'chat-image' };
      const result = await generateConfiguredImage(cfg, prompt, {
        ratio,
        referenceImages,
        usageContext,
      });
      fs.mkdirSync(CHAT_IMAGE_DIR, { recursive: true });
      const fileName = `${crypto.randomUUID()}.png`;
      fs.writeFileSync(path.join(CHAT_IMAGE_DIR, fileName), Buffer.from(result.b64, 'base64'));
      const imageUrl = `/api/chat/images/${encodeURIComponent(fileName)}`;
      const message = updateChatMessage(pending.id, {
        content: result.revisedPrompt || (referenceImages.length ? `已基于 ${referenceImages.length} 张参考图生成 ${ratio} 图片。` : `已生成 ${ratio} 图片。`), status: 'complete',
        metadata: {
          ...referenceMetadata, imageUrl, revisedPrompt: result.revisedPrompt || '',
          width: result.width || 0, height: result.height || 0,
          sourceWidth: result.sourceWidth || result.width || 0,
          sourceHeight: result.sourceHeight || result.height || 0,
          ratioAdjusted: result.ratioAdjusted === true,
        },
      });
      if (conversation.title === '新对话') updateChatConversation(conversation.id, { title: prompt.replace(/\s+/g, ' ').slice(0, 32) });
      return sendJson(res, 200, { conversation: getChatConversation(conversation.id), userMessage, message });
    } catch (error) {
      const message = updateChatMessage(pending.id, { status: 'error', error: error.message, content: `图片生成失败：${error.message}` });
      return sendJson(res, 500, { error: error.message || '图片生成失败', userMessage, message });
    }
  }

  return false;
}

