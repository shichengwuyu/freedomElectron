export const AGENT_ATTACHMENT_MAX_FILES = 12;
export const AGENT_ATTACHMENT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const AGENT_ATTACHMENT_TEXT_LIMIT = 200000;

export function createAgentStateRuntime({ reactive } = {}) {
  return reactive({
    open: false,
    running: false,
    input: '',
    messages: [],
    lastPlan: null,
    logs: [],
    files: [],
    dragOver: false,
    progress: {
      active: false,
      percentage: 0,
      current: 0,
      total: 0,
      label: '',
      detail: '',
      status: '',
    },
    uploadedSourceName: '',
    uploadedSourceText: '',
    pipelineRunning: false,
    pipelineSubmitVideo: false,
    pipelineOnlyMissingImages: true,
  });
}

export function formatAgentFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function setAgentProgressState(progress, options = {}, handlers = {}) {
  const total = Math.max(0, Number(options.total ?? progress.total) || 0);
  const current = Math.max(0, Number(options.current ?? progress.current) || 0);
  const rawPercentage = options.percentage != null
    ? Number(options.percentage)
    : (total ? Math.round((current / total) * 100) : progress.percentage);
  progress.active = options.active !== false;
  progress.total = total;
  progress.current = total ? Math.min(current, total) : current;
  progress.percentage = Math.max(0, Math.min(100, Math.round(Number.isFinite(rawPercentage) ? rawPercentage : 0)));
  if (options.label !== undefined) progress.label = String(options.label || '');
  if (options.detail !== undefined) progress.detail = String(options.detail || '');
  if (options.status !== undefined) progress.status = String(options.status || '');
  if (progress.active && !progress.status && progress.percentage < 100) {
    const ceiling = total ? Math.min(98, handlers.progressByRatio(current + 0.85, total)) : 92;
    handlers.startProgressPulse('agent', progress, { ceiling });
  } else if (progress.status) {
    handlers.stopProgressPulse('agent');
  }
}

export function agentAttachmentKind(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') || /(\.txt|\.md|\.json|\.csv|\.srt|\.xml|\.html|\.css|\.js|\.ts|\.log)$/i.test(name)) return 'text';
  return 'file';
}

export function agentAttachmentLabel(kind) {
  return ({ image: '图片', audio: '音频', video: '视频', text: '文本', file: '文件' })[kind] || '文件';
}

export function agentAttachmentSummary(files = []) {
  return files.map((file) => `${file.name}（${agentAttachmentLabel(file.kind)}，${formatAgentFileSize(file.size)}）`).join('、');
}

export async function makeAgentAttachment(file, readers = {}) {
  const { readFileAsDataUrl, readFileAsText } = readers;
  if (typeof readFileAsDataUrl !== 'function' || typeof readFileAsText !== 'function') {
    throw new Error('Agent attachment readers are not configured');
  }
  const kind = agentAttachmentKind(file);
  const base = {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || '未命名文件',
    type: file.type || 'application/octet-stream',
    size: file.size || 0,
    kind,
  };
  if (kind === 'image') {
    const dataUrl = await readFileAsDataUrl(file);
    return { ...base, dataUrl, previewUrl: dataUrl, b64: dataUrl.includes(',') ? dataUrl.split(',').pop() : dataUrl };
  }
  if (kind === 'text') {
    const text = await readFileAsText(file);
    return {
      ...base,
      text: text.slice(0, AGENT_ATTACHMENT_TEXT_LIMIT),
      rawTextLength: text.length,
      truncated: text.length > AGENT_ATTACHMENT_TEXT_LIMIT,
    };
  }
  const dataUrl = await readFileAsDataUrl(file);
  return { ...base, dataUrl, b64: dataUrl.includes(',') ? dataUrl.split(',').pop() : dataUrl };
}

export async function addAgentFilesFlow(fileList, handlers = {}) {
  const incoming = [...(fileList || [])].filter(Boolean);
  if (!incoming.length) return;
  const files = handlers.files();
  const currentBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  let totalBytes = currentBytes;
  let added = 0;
  for (const file of incoming) {
    if (files.length >= AGENT_ATTACHMENT_MAX_FILES) {
      handlers.warning(`Agent 附件最多 ${AGENT_ATTACHMENT_MAX_FILES} 个`);
      break;
    }
    if (file.size > AGENT_ATTACHMENT_MAX_TOTAL_BYTES) {
      handlers.warning(`${file.name} 超过 50 MB，未添加`);
      continue;
    }
    if (totalBytes + file.size > AGENT_ATTACHMENT_MAX_TOTAL_BYTES) {
      handlers.warning('Agent 附件总大小不能超过 50 MB');
      break;
    }
    const duplicate = files.some((item) => item.name === file.name && item.size === file.size && item.type === file.type);
    if (duplicate) continue;
    try {
      const attachment = await makeAgentAttachment(file, handlers.readers());
      handlers.addFile(attachment);
      totalBytes += file.size;
      added++;
    } catch (error) {
      handlers.error(`${file.name} 读取失败：${error.message}`);
    }
  }
  handlers.setDragOver(false);
  if (added) handlers.log(`已添加附件：${agentAttachmentSummary(files.slice(-added))}`, 'success');
}

export function createAddAgentFilesRuntime({ refs = {}, readers = {}, message = {}, log } = {}) {
  return {
    files: () => refs.agent.files,
    readers: () => readers,
    addFile: (attachment) => refs.agent.files.push(attachment),
    setDragOver: (value) => { refs.agent.dragOver = value; },
    warning: (text) => message.warning(text),
    error: (text) => message.error(text),
    log,
  };
}

export async function loadAgentTxtFilesFlow(fileList, handlers = {}) {
  try {
    const result = await handlers.readTxtFiles(fileList);
    if (!result) return handlers.warning('请上传 .txt 文本文件');
    handlers.setUploadedSource(result.name, result.text);
    handlers.log(`已载入 TXT：${result.name}，${result.text.length} 字`, 'success');
    handlers.success(`已载入 ${result.files.length} 个 TXT`);
  } catch (error) {
    handlers.error(error.message || '读取 TXT 失败');
  }
}

export function createLoadAgentTxtFilesRuntime({ refs = {}, message = {}, helpers = {}, log } = {}) {
  return {
    readTxtFiles: helpers.readTxtFiles,
    setUploadedSource: (name, text) => {
      refs.agent.uploadedSourceName = name;
      refs.agent.uploadedSourceText = text;
    },
    warning: (text) => message.warning(text),
    success: (text) => message.success(text),
    error: (text) => message.error(text),
    log,
  };
}

export function createAgentUiRuntime({ refs = {}, readers = {}, message = {}, helpers = {} } = {}) {
  const agent = refs.agent;
  const agentLog = (message, level = 'info') => {
    const item = { message: String(message || ''), level, time: new Date().toLocaleTimeString() };
    agent.logs.unshift(item);
    if (agent.logs.length > 80) agent.logs.pop();
  };

  const setAgentProgress = (options = {}) => {
    setAgentProgressState(agent.progress, options, {
      startProgressPulse: helpers.startProgressPulse,
      stopProgressPulse: helpers.stopProgressPulse,
      progressByRatio: helpers.progressByRatio,
    });
  };

  const finishAgentProgress = (label = '执行完成') => {
    helpers.stopProgressPulse('agent');
    setAgentProgress({ active: true, percentage: 100, label, detail: '', status: 'success' });
    helpers.setTimeout(() => {
      if (!agent.running && !agent.pipelineRunning && agent.progress.percentage >= 100) {
        agent.progress.active = false;
      }
    }, 1800);
  };

  const failAgentProgress = (message = '执行失败') => {
    helpers.stopProgressPulse('agent');
    setAgentProgress({ active: true, label: message, status: 'exception' });
  };

  const addAgentFiles = (fileList) => addAgentFilesFlow(fileList, createAddAgentFilesRuntime({
    refs: { agent },
    readers,
    message,
    log: agentLog,
  }));

  const loadAgentTxtFiles = (fileList) => loadAgentTxtFilesFlow(fileList, createLoadAgentTxtFilesRuntime({
    refs: { agent },
    message,
    helpers: { readTxtFiles: helpers.readTxtFiles },
    log: agentLog,
  }));

  return {
    agentLog,
    setAgentProgress,
    finishAgentProgress,
    failAgentProgress,
    addAgentFiles,
    onAgentPickFile: (event) => {
      if (event.target.files?.length) addAgentFiles(event.target.files);
      event.target.value = '';
    },
    onAgentDrop: (event) => {
      event.preventDefault();
      agent.dragOver = false;
      if (event.dataTransfer?.files?.length) addAgentFiles(event.dataTransfer.files);
    },
    removeAgentFile: (id) => {
      const index = agent.files.findIndex((file) => file.id === id);
      if (index >= 0) agent.files.splice(index, 1);
    },
    clearAgentFiles: (options = {}) => {
      agent.files.splice(0, agent.files.length);
      agent.dragOver = false;
      if (!options.silent) agentLog('已清空 Agent 附件');
    },
    loadAgentTxtFiles,
    onAgentPickTxt: (event) => {
      if (event.target.files?.length) loadAgentTxtFiles(event.target.files);
      event.target.value = '';
    },
    onAgentTxtDrop: (event) => {
      event.preventDefault();
      if (event.dataTransfer?.files?.length) loadAgentTxtFiles(event.dataTransfer.files);
    },
    clearAgentUploadedSource: () => {
      agent.uploadedSourceName = '';
      agent.uploadedSourceText = '';
      agentLog('已清空 Agent TXT 原文');
    },
    resolveAgentSourceText: (action = {}) => {
      const marker = String(action.sourceText || '').trim();
      if (!marker || marker === '$uploaded' || marker === '$agentUploadedSource') {
        return agent.uploadedSourceText.trim();
      }
      return marker;
    },
  };
}
