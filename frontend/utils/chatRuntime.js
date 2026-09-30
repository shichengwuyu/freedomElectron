import { renderChatMarkdown } from './chatMarkdown.js';

function uid(prefix = 'tmp') { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function storedBoolean(key, fallback = false) {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value === null || value === undefined ? fallback : value === '1';
  } catch { return fallback; }
}
function timeLabel(timestamp) {
  const delta = Date.now() - Number(timestamp || 0);
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString();
}
function downloadText(name, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createChatRuntime({ api, reactive, refs = {}, readers = {}, message = {}, messageBox, helpers = {} } = {}) {
  const chat = reactive({
    conversations: [], messages: [], prompts: [], skills: [], activeId: '', status: 'active', loading: true,
    input: '', sending: false, imageGeneratingCount: 0, mode: 'chat', files: [], dragOver: false,
    skillImporting: false,
    webSearchEnabled: storedBoolean('gg.chat.web-search', false),
    sidebarOpen: !globalThis.matchMedia?.('(max-width: 900px)')?.matches, settingsOpen: false, searchOpen: false, searchQuery: '', searchResults: [],
    conversationSearch: '', searchMatchIndex: 0, quotedMessage: null,
    editingMessageId: '', editingText: '', regeneratingMessageId: '',
    versions: {}, versionPickerMessageId: '',
    folderFilter: '', renameId: '', renameText: '',
    promptEditorOpen: false, promptEditingId: '', promptName: '', promptContent: '',
    abortController: null, atBottom: true, unreadCount: 0, compareRunning: false,
    sentHistory: [], historyIndex: -1,
  });
  let draftTimer = null;
  const imageReferencesByConversation = new Map();

  const currentChatImageRatio = () => {
    const selected = String(refs.imageRatio?.value || refs.config?.image?.ratio || '16:9').trim();
    return selected === 'custom' ? String(refs.customImageRatio?.value || '').trim() : selected;
  };
  const chatImageConcurrencyLimit = () => {
    const provider = String(refs.config?.image?.provider || 'api');
    const providerLimit = provider === 'updream' ? 3 : provider === 'neowow' ? 15 : ['libtv-cli', 'dreamina-cli'].includes(provider) ? 10 : 50;
    const configured = Math.floor(Number(refs.config?.image?.concurrency) || 3);
    return Math.max(1, Math.min(providerLimit, configured));
  };
  const chatImageReferenceFiles = (source = chat.files) => (Array.isArray(source) ? source : []).filter((item) => item?.kind === 'image' && item?.dataUrl);
  const chatAttachmentSummary = (source = chat.files) => (Array.isArray(source) ? source : []).map((item) => ({
    name: item.name,
    kind: item.kind,
    size: item.size,
    type: item.type,
  }));
  const chatImageReferencePayload = (source = chat.files) => chatImageReferenceFiles(source).map((item) => ({
    name: item.name,
    kind: item.kind,
    size: item.size,
    type: item.type,
    imageB64: item.imageB64 || String(item.dataUrl || '').split(',').pop() || '',
  }));
  function rememberChatImageReferences(conversationId = chat.activeId, source = chat.files) {
    if (!conversationId) return;
    const references = chatImageReferenceFiles(source).map((item) => ({ ...item }));
    if (references.length) imageReferencesByConversation.set(conversationId, references);
    else imageReferencesByConversation.delete(conversationId);
  }
  function restoreChatImageReferences(conversationId = chat.activeId) {
    const references = imageReferencesByConversation.get(conversationId) || [];
    chat.files.splice(0, chat.files.length, ...references.map((item) => ({ ...item })));
  }
  function canSendChatMessage() {
    if (chat.sending) return false;
    if (chat.mode === 'image' && chat.imageGeneratingCount >= chatImageConcurrencyLimit()) return false;
    if (String(chat.input || '').trim()) return true;
    return chat.mode === 'image' && chatImageReferenceFiles().length > 0;
  }

  const currentChatConversation = () => chat.conversations.find((item) => item.id === chat.activeId) || null;
  const currentPrompt = () => chat.prompts.find((item) => item.id === currentChatConversation()?.promptId) || chat.prompts[0] || null;
  const activeChatSkills = () => {
    const selected = new Set(currentChatConversation()?.skillIds || []);
    return chat.skills.filter((skill) => selected.has(skill.id));
  };
  const filteredChatConversations = () => {
    const q = String(chat.searchQuery || '').trim().toLowerCase();
    return chat.conversations.filter((item) => (!q || item.title.toLowerCase().includes(q)) && (!chat.folderFilter || item.folder === chat.folderFilter));
  };
  const chatFolders = () => [...new Set(chat.conversations.map((item) => item.folder).filter(Boolean))].sort();
  const chatModelOptions = () => {
    const cfg = refs.config;
    const routingEnabled = cfg?.modelRouting?.enabled === true;
    const defaultModel = String(cfg?.text?.model || '').trim();
    const result = [{
      label: routingEnabled ? '自动选择模型' : (defaultModel ? `默认 · ${defaultModel}` : '默认模型'),
      value: 'auto',
      model: routingEnabled ? '根据任务智能选择' : (defaultModel || '默认文本模型'),
    }];
    if (routingEnabled) {
      const profiles = Array.isArray(cfg?.modelRouting?.profiles) ? cfg.modelRouting.profiles : [];
      profiles.filter((item) => item?.enabled !== false).forEach((item) => result.push({ label: item.name || item.model || '文本模型', value: item.id, model: item.model || '' }));
    }
    return result;
  };
  const currentChatModelLabel = () => chatModelOptions().find((item) => item.value === currentChatConversation()?.modelProfileId)?.label || chatModelOptions()[0]?.label || '默认模型';

  async function loadChatPrompts() {
    const result = await api.get('/api/chat/prompts'); chat.prompts.splice(0, chat.prompts.length, ...(result.prompts || []));
  }
  async function loadChatSkills() {
    const result = await api.get('/api/chat/skills'); chat.skills.splice(0, chat.skills.length, ...(result.skills || []));
  }
  async function loadChatConversations({ preserveActive = true } = {}) {
    const previous = preserveActive ? chat.activeId : '';
    const result = await api.get(`/api/chat/conversations?status=${encodeURIComponent(chat.status)}`);
    chat.conversations.splice(0, chat.conversations.length, ...(result.conversations || []));
    if (previous && chat.conversations.some((item) => item.id === previous)) chat.activeId = previous;
    else chat.activeId = chat.conversations[0]?.id || '';
  }
  async function loadCurrentChat() {
    if (!chat.activeId) { chat.messages.splice(0); chat.files.splice(0); return; }
    const result = await api.get(`/api/chat/conversations/${encodeURIComponent(chat.activeId)}`);
    const index = chat.conversations.findIndex((item) => item.id === chat.activeId);
    if (index >= 0) chat.conversations.splice(index, 1, result.conversation);
    chat.messages.splice(0, chat.messages.length, ...(result.messages || []));
    chat.input = result.conversation?.draft || '';
    restoreChatImageReferences(chat.activeId);
    chat.quotedMessage = null; chat.editingMessageId = ''; chat.regeneratingMessageId = '';
    helpers.nextTick?.(() => scrollChatToBottom(false));
  }
  async function migrateLegacyChatsIfNeeded() {
    try {
      if (localStorage.getItem('gg.chat.sqlite-migrated.v1')) return;
      const legacy = JSON.parse(localStorage.getItem('gg.chat.center.v1') || '[]');
      if (!chat.conversations.length && Array.isArray(legacy) && legacy.some((item) => item.messages?.length)) {
        for (const item of legacy.slice(0, 30)) {
          await api.post('/api/chat/import', {
            conversation: { title: item.title || '导入的对话', memorySummary: item.memorySummary || '', compressedCount: item.compressedCount || 0 },
            messages: (item.messages || []).filter((msg) => msg.content).map((msg) => ({ role: msg.role, content: msg.content, model: msg.model || '' })),
          });
        }
      }
      localStorage.setItem('gg.chat.sqlite-migrated.v1', '1');
    } catch (_) {}
  }
  async function initializeChat() {
    chat.loading = true;
    try {
      await Promise.all([loadChatPrompts(), loadChatSkills(), loadChatConversations({ preserveActive: false })]);
      await migrateLegacyChatsIfNeeded();
      await loadChatConversations({ preserveActive: false });
      const staleTemps = chat.conversations.filter((item) => item.temporary);
      for (const item of staleTemps) await api.delete?.(`/api/chat/conversations/${encodeURIComponent(item.id)}/purge`);
      if (!chat.conversations.length && chat.status === 'active') await createChatConversation();
      else await loadCurrentChat();
    } catch (error) { message.error?.(`聊天数据库载入失败：${error.message}`); }
    finally { chat.loading = false; }
  }

  async function createChatConversation(options = {}) {
    if (chat.sending || chat.imageGeneratingCount) return;
    rememberChatImageReferences();
    const result = await api.post('/api/chat/conversations', {
      title: options.title || '新对话', temporary: !!options.temporary,
      promptId: chat.prompts.find((item) => item.isDefault)?.id || 'prompt_default',
      modelProfileId: 'auto', responseStyle: 'complete', memoryEnabled: true, autoCompress: true,
    });
    chat.status = 'active';
    await loadChatConversations({ preserveActive: false });
    chat.activeId = result.conversation.id; await loadCurrentChat();
  }
  async function selectChatConversation(id) {
    if (chat.sending || chat.imageGeneratingCount || id === chat.activeId) return;
    rememberChatImageReferences();
    await saveChatDraft(); chat.activeId = id; await loadCurrentChat();
  }
  async function setChatStatus(status) {
    if (chat.sending || chat.imageGeneratingCount) return;
    rememberChatImageReferences();
    await saveChatDraft(); chat.status = status; chat.activeId = ''; await loadChatConversations({ preserveActive: false }); await loadCurrentChat();
  }
  async function patchCurrentConversation(patch, { reload = false } = {}) {
    const conversation = currentChatConversation(); if (!conversation) return null;
    const result = await api.patch(`/api/chat/conversations/${encodeURIComponent(conversation.id)}`, patch);
    Object.assign(conversation, result.conversation || {});
    if (reload) await loadChatConversations();
    return result.conversation;
  }
  function scheduleDraftSave() { clearTimeout(draftTimer); draftTimer = setTimeout(saveChatDraft, 500); }
  async function saveChatDraft() {
    clearTimeout(draftTimer);
    const conversation = currentChatConversation(); if (!conversation || conversation.draft === chat.input) return;
    conversation.draft = chat.input;
    try { await api.patch(`/api/chat/conversations/${encodeURIComponent(conversation.id)}`, { draft: chat.input }); } catch (_) {}
  }

  async function archiveChatConversation(item = currentChatConversation()) {
    if (!item) return; await api.post(`/api/chat/conversations/${encodeURIComponent(item.id)}/archive`, {}); await loadChatConversations({ preserveActive: false }); await loadCurrentChat();
  }
  async function trashChatConversation(item = currentChatConversation()) {
    if (!item) return; await api.post(`/api/chat/conversations/${encodeURIComponent(item.id)}/trash`, {}); await loadChatConversations({ preserveActive: false }); await loadCurrentChat();
  }
  async function restoreChatConversation(item) {
    await api.post(`/api/chat/conversations/${encodeURIComponent(item.id)}/restore`, {}); await loadChatConversations({ preserveActive: false }); await loadCurrentChat();
  }
  async function purgeChatConversation(item) {
    if (!item) return;
    try { await messageBox?.confirm?.(`永久删除“${item.title}”？此操作无法撤销。`, '永久删除', { type: 'warning' }); } catch { return; }
    await api.delete(`/api/chat/conversations/${encodeURIComponent(item.id)}/purge`);
    imageReferencesByConversation.delete(item.id);
    await loadChatConversations({ preserveActive: false }); await loadCurrentChat();
  }
  async function toggleChatPin(item) { await api.patch(`/api/chat/conversations/${encodeURIComponent(item.id)}`, { pinned: !item.pinned }); await loadChatConversations(); }
  function beginRenameChat(item) { chat.renameId = item.id; chat.renameText = item.title; helpers.nextTick?.(() => document.querySelector('.chat-rename-input')?.focus()); }
  async function commitRenameChat() {
    if (!chat.renameId) return; await api.patch(`/api/chat/conversations/${encodeURIComponent(chat.renameId)}`, { title: chat.renameText.trim() || '新对话' }); chat.renameId = ''; await loadChatConversations();
  }

  function optimisticMessage(role, content, extra = {}) { return { id: uid('tmp'), role, content, status: extra.status || 'complete', createdAt: Date.now(), updatedAt: Date.now(), metadata: {}, ...extra }; }
  async function runTextStream({ content = '', regenerateMessageId = '', existingUserMessageId = '', compareUserMessageId = '', modelProfileId = '', comparisonSlot = '' } = {}) {
    const conversation = currentChatConversation(); if (!conversation) return null;
    let localUser = null;
    if (!regenerateMessageId && !existingUserMessageId && !compareUserMessageId) {
      localUser = optimisticMessage('user', content, { metadata: { quotedMessageId: chat.quotedMessage?.id || '', attachments: chat.files.map((item) => ({ name: item.name, kind: item.kind })) } });
      chat.messages.push(localUser);
    } else if (existingUserMessageId) {
      const index = chat.messages.findIndex((item) => item.id === existingUserMessageId);
      if (index >= 0) { chat.messages[index].content = content; chat.messages.splice(index + 1); }
    }
    const webSearch = chat.mode === 'chat' && chat.webSearchEnabled;
    const localAssistant = optimisticMessage('assistant', '', {
      status: 'generating', model: chatModelOptions().find((item) => item.value === modelProfileId)?.label || currentChatModelLabel(),
      metadata: { comparisonSlot, webSearch, webSearchStatus: webSearch ? 'searching' : '' },
    });
    chat.messages.push(localAssistant); helpers.nextTick?.(() => scrollChatToBottom());
    let serverUserId = compareUserMessageId || existingUserMessageId || '';
    const controller = new AbortController(); chat.abortController = controller;
    try {
      const result = await api.postStream('/api/chat/stream', {
        conversationId: conversation.id, content, regenerateMessageId, existingUserMessageId, compareUserMessageId,
        modelProfileId: modelProfileId || conversation.modelProfileId, comparisonSlot,
        webSearch,
        quotedMessageId: chat.quotedMessage?.id || '', attachments: chat.files.map((item) => ({ ...item })),
      }, {
        signal: controller.signal,
        onEvent: (type, data) => {
          if (type === 'continuation') {
            localAssistant.metadata = { ...(localAssistant.metadata || {}), automaticContinuationCount: Number(data.count) || 0 };
            return;
          }
          if (type === 'search') {
            localAssistant.metadata = {
              ...(localAssistant.metadata || {}), webSearch: true, webSearchStatus: data.status || '',
              webSearchQuery: data.query || '', webSearchProvider: data.provider || '', webSources: data.sources || [],
            };
            return;
          }
          if (type !== 'meta') return;
          if (data.userMessage) {
            serverUserId = data.userMessage.id;
            if (localUser) Object.assign(localUser, data.userMessage);
          }
          if (data.assistantMessage) Object.assign(localAssistant, data.assistantMessage, { content: '' });
          if (data.conversation) Object.assign(conversation, data.conversation);
        },
        onDelta: (delta) => { localAssistant.content += delta; if (chat.atBottom) helpers.nextTick?.(() => scrollChatToBottom(false)); else chat.unreadCount++; },
        onDone: (data) => { if (data.message) Object.assign(localAssistant, data.message); if (data.conversation) Object.assign(conversation, data.conversation); },
      });
      return { result, userMessageId: serverUserId, assistant: localAssistant };
    } catch (error) {
      localAssistant.status = error.name === 'AbortError' ? 'stopped' : 'error'; localAssistant.error = error.name === 'AbortError' ? '' : error.message;
      if (!localAssistant.content) localAssistant.content = error.name === 'AbortError' ? '已停止生成。' : `生成失败：${error.message}`;
      return { error, userMessageId: serverUserId, assistant: localAssistant };
    }
  }

  async function sendChatMessage(options = {}) {
    const conversation = currentChatConversation();
    const isImageRequest = chat.mode === 'image' && !options.regenerateMessageId && !options.existingUserMessageId;
    if (!conversation || chat.sending) return;
    if (isImageRequest && chat.imageGeneratingCount >= chatImageConcurrencyLimit()) {
      message.warning?.(`图片并发已达上限（${chatImageConcurrencyLimit()} 张）`);
      return;
    }
    let content = String(options.content ?? chat.input).trim();
    const files = chat.files.map((item) => ({ ...item }));
    const imageReferenceFiles = chatImageReferencePayload(files);
    if (!options.regenerateMessageId) {
      const command = content.match(/^\/(完整|简洁|详细|平衡|总结|翻译|改写|解释)\s*/);
      if (command) {
        const kind = command[1]; content = content.slice(command[0].length).trim();
        if (kind === '完整' || kind === '简洁' || kind === '详细' || kind === '平衡') await patchCurrentConversation({ responseStyle: ({ 完整:'complete', 简洁:'concise', 详细:'detailed', 平衡:'balanced' })[kind] });
        else content = ({ 总结:'请总结以下内容：', 翻译:'请准确翻译以下内容：', 改写:'请改写并优化以下内容：', 解释:'请用通俗易懂的方式解释：' })[kind] + content;
      }
    }
    if (!content && !options.regenerateMessageId) {
      if (chat.mode === 'image' && !options.existingUserMessageId && imageReferenceFiles.length) content = '请基于参考图生成一张新图，保持主体特征和画面质感。';
      else return;
    }
    if (chat.mode === 'image' && !options.regenerateMessageId && !options.existingUserMessageId && !currentChatImageRatio()) {
      message.warning?.('请填写自定义图片比例');
      return;
    }
    if (content && !options.regenerateMessageId) { chat.sentHistory.unshift(content); chat.sentHistory = chat.sentHistory.slice(0, 50); chat.historyIndex = -1; }
    if (isImageRequest) chat.imageGeneratingCount += 1;
    else chat.sending = true;
    chat.unreadCount = 0;
    if (!options.keepInput) chat.input = '';
    if (isImageRequest) {
      chat.files.splice(0, chat.files.length, ...chatImageReferenceFiles(files));
      rememberChatImageReferences(conversation.id);
      chat.quotedMessage = null;
      conversation.draft = '';
      void api.patch(`/api/chat/conversations/${encodeURIComponent(conversation.id)}`, { draft: '' }).catch(() => {});
    }
    try {
      if (isImageRequest) {
        const imageRatio = currentChatImageRatio();
        const imageMode = imageReferenceFiles.length ? 'image-to-image' : 'text-to-image';
        const referenceMetadata = { mode: 'image', imageMode, ratio: imageRatio, referenceImageCount: imageReferenceFiles.length };
        const pendingUser = optimisticMessage('user', content, { metadata: { ...referenceMetadata, attachments: chatAttachmentSummary(imageReferenceFiles) } });
        const pendingAssistant = optimisticMessage('assistant', '', { status: 'generating', model: refs.config?.image?.model || '图片模型', metadata: referenceMetadata });
        chat.messages.push(pendingUser, pendingAssistant); helpers.nextTick?.(() => scrollChatToBottom());
        try {
          const result = await api.post('/api/chat/image', { conversationId: conversation.id, prompt: content, ratio: imageRatio, attachments: imageReferenceFiles }, { timeoutMs: 30 * 60 * 1000 });
          Object.assign(pendingUser, result.userMessage); Object.assign(pendingAssistant, result.message); Object.assign(conversation, result.conversation || {});
        } catch (error) { pendingAssistant.status = 'error'; pendingAssistant.content = `图片生成失败：${error.message}`; pendingAssistant.error = error.message; }
      } else {
        const primary = await runTextStream({ content, regenerateMessageId: options.regenerateMessageId, existingUserMessageId: options.existingUserMessageId, modelProfileId: conversation.modelProfileId, comparisonSlot: conversation.compareEnabled ? 'A' : '' });
        if (conversation.compareEnabled && conversation.compareModelProfileId && primary?.userMessageId && !options.regenerateMessageId) {
          chat.compareRunning = true;
          await runTextStream({ compareUserMessageId: primary.userMessageId, modelProfileId: conversation.compareModelProfileId, comparisonSlot: 'B' });
        }
      }
    } finally {
      if (isImageRequest) {
        chat.imageGeneratingCount = Math.max(0, chat.imageGeneratingCount - 1);
      } else {
        chat.files.splice(0);
        rememberChatImageReferences(conversation.id);
        chat.quotedMessage = null; chat.editingMessageId = ''; chat.editingText = ''; chat.regeneratingMessageId = '';
        chat.sending = false; chat.compareRunning = false; chat.abortController = null;
        await api.patch(`/api/chat/conversations/${encodeURIComponent(conversation.id)}`, { draft: '' }).catch(() => {});
      }
      await loadChatConversations();
      helpers.nextTick?.(() => scrollChatToBottom());
    }
  }
  function toggleChatWebSearch() {
    chat.webSearchEnabled = !chat.webSearchEnabled;
    try { globalThis.localStorage?.setItem('gg.chat.web-search', chat.webSearchEnabled ? '1' : '0'); } catch { /* ignore */ }
  }
  function stopChatGeneration() { chat.abortController?.abort(); }
  function handleChatInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendChatMessage(); }
    if (event.key === 'Escape') { chat.quotedMessage = null; cancelEditChatMessage(); }
    if (event.key === 'ArrowUp' && !chat.input && chat.sentHistory.length) { event.preventDefault(); chat.historyIndex = Math.min(chat.sentHistory.length - 1, chat.historyIndex + 1); chat.input = chat.sentHistory[chat.historyIndex] || ''; }
    if (event.key === 'ArrowDown' && chat.historyIndex >= 0) { event.preventDefault(); chat.historyIndex = Math.max(-1, chat.historyIndex - 1); chat.input = chat.historyIndex >= 0 ? chat.sentHistory[chat.historyIndex] : ''; }
  }

  function startEditChatMessage(item) { chat.editingMessageId = item.id; chat.editingText = item.content; helpers.nextTick?.(() => document.querySelector(`[data-edit-message="${item.id}"]`)?.focus()); }
  function cancelEditChatMessage() { chat.editingMessageId = ''; chat.editingText = ''; }
  async function submitEditChatMessage(item) { const content = chat.editingText.trim(); if (!content) return; await sendChatMessage({ content, existingUserMessageId: item.id }); }
  async function deleteChatMessage(item) {
    await api.delete(`/api/chat/messages/${encodeURIComponent(item.id)}`); const index = chat.messages.findIndex((msg) => msg.id === item.id); if (index >= 0) chat.messages.splice(index, 1);
  }
  async function regenerateChatMessage(item) { chat.regeneratingMessageId = item.id; await sendChatMessage({ regenerateMessageId: item.id }); await loadCurrentChat(); }
  async function branchFromChatMessage(item) {
    const result = await api.post(`/api/chat/conversations/${encodeURIComponent(chat.activeId)}/branch`, { messageId: item.id });
    chat.status = 'active'; await loadChatConversations({ preserveActive: false }); chat.activeId = result.conversation.id; await loadCurrentChat(); message.success?.('已创建对话分支');
  }
  async function toggleStarChatMessage(item) { const result = await api.patch(`/api/chat/messages/${encodeURIComponent(item.id)}`, { starred: !item.starred }); Object.assign(item, result.message); }
  async function rateChatMessage(item, rating) { const result = await api.patch(`/api/chat/messages/${encodeURIComponent(item.id)}`, { metadata: { ...(item.metadata || {}), rating } }); Object.assign(item, result.message); }
  function quoteChatMessage(item) { chat.quotedMessage = item; document.querySelector('.chat-composer textarea')?.focus(); }
  function continueChatMessage(item) { chat.input = `请从上一条回答中断的位置继续，不要重复已经输出的内容。\n\n上一条回答：${item.content.slice(-1200)}`; document.querySelector('.chat-composer textarea')?.focus(); }
  async function loadChatMessageVersions(item) { const result = await api.get(`/api/chat/messages/${encodeURIComponent(item.id)}/versions`); chat.versions[item.id] = result.versions || []; chat.versionPickerMessageId = item.id; }
  async function activateChatMessageVersion(item, version) { await api.post(`/api/chat/messages/${encodeURIComponent(version.id)}/activate`, {}); chat.versionPickerMessageId = ''; await loadCurrentChat(); }

  function isChatSkillArchive(file) {
    return /(?:\.skill)?\.zip$/i.test(String(file?.name || '')) || /\.skill$/i.test(String(file?.name || ''));
  }
  function isChatSkillTextPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const base = normalized.split('/').pop()?.toLowerCase() || '';
    return base === 'skill.md'
      || /\.(md|txt|json|ya?ml|toml|ini|cfg|csv|js|mjs|cjs|jsx|ts|tsx|py|ps1|sh|html|css|xml|sql)$/i.test(base)
      || ['license', 'notice', 'readme'].includes(base);
  }
  async function enableImportedChatSkills(skills = []) {
    await loadChatSkills();
    const conversation = currentChatConversation();
    if (!conversation || !skills.length) return;
    const skillIds = [...new Set([...(conversation.skillIds || []), ...skills.map((skill) => skill.id).filter(Boolean)])];
    await patchCurrentConversation({ skillIds });
  }
  async function importChatSkillArchive(file) {
    if (!file) return;
    chat.skillImporting = true;
    try {
      const result = await api.upload(`/api/chat/skills/import-zip?name=${encodeURIComponent(file.name || 'Skill.zip')}`, file, { contentType: 'application/zip' });
      await enableImportedChatSkills(result.skills || []);
      message.success?.(`已导入并启用 ${result.skills?.length || 0} 个 Skill`);
    } catch (error) {
      message.error?.(`Skill 导入失败：${error.message}`);
    } finally {
      chat.skillImporting = false;
    }
  }
  async function importChatSkillFolderFiles(files = [], name = 'Skill 文件夹') {
    chat.skillImporting = true;
    try {
      const input = [...files].filter((item) => {
        const file = item?.file || item;
        const filePath = String(item?.path || file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
        return file && isChatSkillTextPath(filePath);
      });
      if (input.length > 500) throw new Error('Skill 文件过多，最多支持 500 个文本文件');
      const records = [];
      let totalBytes = 0;
      for (const item of input) {
        const file = item?.file || item;
        const filePath = String(item?.path || file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!file || !isChatSkillTextPath(filePath)) continue;
        if (file.size > 512 * 1024) throw new Error(`${filePath} 超过 512KB`);
        totalBytes += file.size;
        if (totalBytes > 8 * 1024 * 1024) throw new Error('Skill 文本总大小超过 8MB');
        records.push({ path: filePath, content: await readers.readFileAsText(file) });
      }
      const result = await api.post('/api/chat/skills/import-folder', { name, files: records }, { timeoutMs: 5 * 60 * 1000 });
      await enableImportedChatSkills(result.skills || []);
      message.success?.(`已导入并启用 ${result.skills?.length || 0} 个 Skill`);
    } catch (error) {
      message.error?.(`Skill 导入失败：${error.message}`);
    } finally {
      chat.skillImporting = false;
    }
  }
  function readDroppedFileEntry(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }
  function readDroppedDirectoryBatch(reader) {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  }
  async function collectDroppedDirectoryFiles(directoryEntry) {
    const result = [];
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const filePath = `${prefix}${entry.name}`;
        if (!isChatSkillTextPath(filePath)) return;
        if (result.length >= 500) throw new Error('Skill 文件过多，最多支持 500 个文本文件');
        const file = await readDroppedFileEntry(entry);
        result.push({ file, path: filePath });
        return;
      }
      if (!entry.isDirectory) return;
      if (['.git', 'node_modules', '__pycache__'].includes(entry.name.toLowerCase())) return;
      const reader = entry.createReader();
      while (true) {
        const batch = await readDroppedDirectoryBatch(reader);
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    };
    await walk(directoryEntry, '');
    return result;
  }
  async function setChatSkillEnabled(skill, enabled) {
    const conversation = currentChatConversation(); if (!conversation || !skill?.id) return;
    const selected = new Set(conversation.skillIds || []);
    if (enabled) selected.add(skill.id); else selected.delete(skill.id);
    await patchCurrentConversation({ skillIds: [...selected] });
  }
  async function deleteChatSkill(skill) {
    if (!skill?.id) return;
    try { await messageBox?.confirm?.(`删除本地 Skill“${skill.name}”？`, '删除 Skill', { type: 'warning' }); } catch { return; }
    await api.delete(`/api/chat/skills/${encodeURIComponent(skill.id)}`);
    await loadChatSkills();
    const conversation = currentChatConversation();
    if (conversation?.skillIds?.includes(skill.id)) await patchCurrentConversation({ skillIds: conversation.skillIds.filter((id) => id !== skill.id) });
    message.success?.('Skill 已删除');
  }
  async function addChatFiles(fileList) {
    let remainingSlots = Math.max(0, 8 - chat.files.length);
    for (const file of [...(fileList || [])].slice(0, 24)) {
      try {
        if (isChatSkillArchive(file)) { await importChatSkillArchive(file); continue; }
        if (remainingSlots <= 0) continue;
        const image = String(file.type || '').startsWith('image/');
        const text = String(file.type || '').startsWith('text/') || /\.(txt|md|json|csv|srt|js|ts)$/i.test(file.name || '');
        if (!image && !text) { message.warning?.(`${file.name} 暂不支持`); continue; }
        const item = { id: uid('file'), name: file.name, type: file.type, size: file.size, kind: image ? 'image' : 'text' };
        if (image) {
          item.dataUrl = await readers.readFileAsDataUrl(file);
          item.imageB64 = typeof readers.readImageAsPngB64 === 'function'
            ? await readers.readImageAsPngB64(file)
            : (String(item.dataUrl || '').split(',').pop() || '');
        } else item.text = String(await readers.readFileAsText(file)).slice(0, 120000);
        chat.files.push(item);
        if (image) rememberChatImageReferences();
        remainingSlots -= 1;
      } catch (error) { message.error?.(`${file.name} 读取失败：${error.message}`); }
    }
    chat.dragOver = false;
  }
  function onChatPickFile(event) { if (event.target.files?.length) addChatFiles(event.target.files); event.target.value = ''; }
  function onChatPickSkillFolder(event) {
    const files = [...(event.target.files || [])]; event.target.value = ''; if (!files.length) return;
    const rootName = String(files[0]?.webkitRelativePath || '').split('/')[0] || 'Skill 文件夹';
    importChatSkillFolderFiles(files, rootName);
  }
  async function onChatDrop(event) {
    event.preventDefault(); chat.dragOver = false;
    const entries = [...(event.dataTransfer?.items || [])]
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);
    if (!entries.length) {
      if (event.dataTransfer?.files?.length) await addChatFiles(event.dataTransfer.files);
      return;
    }
    const looseFiles = [];
    for (const entry of entries) {
      try {
        if (entry.isDirectory) {
          const files = await collectDroppedDirectoryFiles(entry);
          await importChatSkillFolderFiles(files, entry.name || 'Skill 文件夹');
        } else if (entry.isFile) {
          looseFiles.push(await readDroppedFileEntry(entry));
        }
      } catch (error) { message.error?.(`拖拽读取失败：${error.message}`); }
    }
    if (looseFiles.length) await addChatFiles(looseFiles);
  }
  function removeChatFile(id) {
    const index = chat.files.findIndex((item) => item.id === id);
    if (index < 0) return;
    chat.files.splice(index, 1);
    rememberChatImageReferences();
  }

  async function performGlobalChatSearch() {
    const q = chat.searchQuery.trim(); if (!q) { chat.searchResults.splice(0); return; }
    const result = await api.get(`/api/chat/search?q=${encodeURIComponent(q)}`); chat.searchResults.splice(0, chat.searchResults.length, ...(result.results || [])); chat.searchOpen = true;
  }
  const currentConversationMatches = () => {
    const q = chat.conversationSearch.trim().toLowerCase(); if (!q) return [];
    return chat.messages.filter((item) => item.content.toLowerCase().includes(q));
  };
  function jumpToChatSearchMatch(direction = 1) {
    const matches = currentConversationMatches(); if (!matches.length) return;
    chat.searchMatchIndex = (chat.searchMatchIndex + direction + matches.length) % matches.length;
    document.querySelector(`[data-message-id="${matches[chat.searchMatchIndex].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function openChatSearchResult(result) { chat.status = 'active'; await loadChatConversations({ preserveActive: false }); chat.activeId = result.conversationId; await loadCurrentChat(); chat.searchOpen = false; helpers.nextTick?.(() => document.querySelector(`[data-message-id="${result.messageId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }

  async function exportCurrentChat(format = 'markdown') {
    const conversation = currentChatConversation(); if (!conversation) return;
    const result = await api.get(`/api/chat/conversations/${encodeURIComponent(conversation.id)}/export`);
    if (format === 'json') downloadText(`${conversation.title}.json`, JSON.stringify(result.data, null, 2), 'application/json;charset=utf-8');
    else if (format === 'txt') {
      // 复用后端 markdown 文本，剥掉 # / ## 等标记，便于在记事本/手机里直接阅读
      const txt = String(result.markdown || '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^- /gm, '· ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
      downloadText(`${conversation.title}.txt`, txt, 'text/plain;charset=utf-8');
    }
    else downloadText(`${conversation.title}.md`, result.markdown, 'text/markdown;charset=utf-8');
  }
  function printCurrentChat() { globalThis.print?.(); }
  async function importChatFile(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { const payload = JSON.parse(await readers.readFileAsText(file)); const result = await api.post('/api/chat/import', payload); chat.status = 'active'; await loadChatConversations({ preserveActive: false }); chat.activeId = result.conversation.id; await loadCurrentChat(); message.success?.('对话已导入'); } catch (error) { message.error?.(`导入失败：${error.message}`); }
  }

  function beginCreatePrompt() { chat.promptEditingId = ''; chat.promptName = '新提示词'; chat.promptContent = ''; chat.promptEditorOpen = true; }
  function beginEditPrompt(prompt) { chat.promptEditingId = prompt.id; chat.promptName = prompt.name; chat.promptContent = prompt.content; chat.promptEditorOpen = true; }
  async function saveChatPrompt() {
    if (!chat.promptName.trim()) return;
    if (chat.promptEditingId) await api.patch(`/api/chat/prompts/${encodeURIComponent(chat.promptEditingId)}`, { name: chat.promptName, content: chat.promptContent });
    else await api.post('/api/chat/prompts', { name: chat.promptName, content: chat.promptContent });
    chat.promptEditorOpen = false; await loadChatPrompts();
  }
  async function deleteChatPrompt(prompt) { await api.delete(`/api/chat/prompts/${encodeURIComponent(prompt.id)}`); await loadChatPrompts(); if (currentChatConversation()?.promptId === prompt.id) await patchCurrentConversation({ promptId: 'prompt_default' }); }

  const chatContextTokens = () => Math.ceil(
    (currentChatConversation()?.memorySummary?.length || 0) / 2.2
    + chat.messages.slice(-20).reduce((n,item) => n + item.content.length / 2.2, 0)
    + activeChatSkills().reduce((n, skill) => n + (Number(skill.textBytes) || 0) / 2.2, 0),
  );
  const chatContextPercent = () => Math.min(100, Math.round(chatContextTokens() / 32000 * 100));
  async function compressChatContext() {
    const conversation = currentChatConversation(); if (!conversation || chat.messages.length < 10) return message.info?.('当前上下文很轻，无需压缩');
    const target = Math.max(0, chat.messages.length - 8); const compact = chat.messages.slice(conversation.compressedCount || 0, target);
    const summary = compact.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content.replace(/\s+/g,' ').slice(0,420)}`).join('\n');
    await patchCurrentConversation({ memorySummary: [conversation.memorySummary, summary].filter(Boolean).join('\n').slice(-16000), compressedCount: target }); message.success?.(`已压缩 ${compact.length} 条消息`);
  }
  async function clearChatMemory() { await patchCurrentConversation({ memorySummary: '', compressedCount: 0 }); message.success?.('已清除本对话记忆'); }

  function renderMessageMarkdown(content) { return renderChatMarkdown(content); }
  async function onChatMarkdownClick(event) {
    const button = event.target.closest?.('.chat-code-copy'); if (!button) return;
    const code = button.closest('.chat-code-block')?.querySelector('code')?.textContent || '';
    try { await navigator.clipboard.writeText(code); button.textContent = '已复制'; setTimeout(() => { button.textContent = '复制代码'; }, 1200); } catch (_) {}
  }
  async function copyChatMessage(content) { try { await navigator.clipboard.writeText(String(content || '')); message.success?.('已复制'); } catch { message.warning?.('复制失败'); } }
  function scrollChatToBottom(smooth = true) { const el = document.getElementById('gg-chat-scroll'); if (!el) return; el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); chat.atBottom = true; chat.unreadCount = 0; }
  function onChatScroll(event) { const el = event.currentTarget; chat.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90; if (chat.atBottom) chat.unreadCount = 0; }
  function chatMessageTime(value) { return new Date(value || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function chatThreadTime(value) { return timeLabel(value); }
  function applyChatStarter(text, mode = 'chat') { chat.mode = mode; chat.input = text; scheduleDraftSave(); document.querySelector('.chat-composer textarea')?.focus(); }

  async function handleGlobalChatShortcut(event) {
    if (refs.view?.value !== 'chat') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); createChatConversation(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); chat.searchOpen = true; helpers.nextTick?.(() => document.querySelector('.chat-global-search-input')?.focus()); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector('.chat-composer textarea')?.focus(); }
  }
  globalThis.addEventListener?.('keydown', handleGlobalChatShortcut);

  return {
    chat, initializeChat, currentChatConversation, currentPrompt, activeChatSkills, filteredChatConversations, chatFolders,
    chatModelOptions, currentChatModelLabel, createChatConversation, selectChatConversation, setChatStatus,
    patchCurrentConversation, scheduleDraftSave, saveChatDraft, archiveChatConversation, trashChatConversation,
    restoreChatConversation, purgeChatConversation, toggleChatPin, beginRenameChat, commitRenameChat,
    sendChatMessage, canSendChatMessage, chatImageConcurrencyLimit, toggleChatWebSearch, stopChatGeneration, handleChatInputKeydown, startEditChatMessage, cancelEditChatMessage,
    submitEditChatMessage, deleteChatMessage, regenerateChatMessage, branchFromChatMessage, toggleStarChatMessage,
    rateChatMessage, quoteChatMessage, continueChatMessage, loadChatMessageVersions, activateChatMessageVersion,
    onChatPickFile, onChatPickSkillFolder, onChatDrop, removeChatFile, setChatSkillEnabled, deleteChatSkill,
    performGlobalChatSearch, currentConversationMatches, jumpToChatSearchMatch, openChatSearchResult,
    exportCurrentChat, printCurrentChat, importChatFile, beginCreatePrompt, beginEditPrompt, saveChatPrompt, deleteChatPrompt,
    chatContextTokens, chatContextPercent, compressChatContext, clearChatMemory, renderMessageMarkdown,
    onChatMarkdownClick, copyChatMessage, scrollChatToBottom, onChatScroll, chatMessageTime, chatThreadTime, applyChatStarter,
  };
}
