export const AGENT_ATTACHMENT_MAX_FILES = 12;
export const AGENT_ATTACHMENT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const AGENT_ATTACHMENT_TEXT_LIMIT = 200000;

// 空状态直接告诉用户「它能干什么」和「怎么开口」，否则这个面板等于没有说明书。
export const AGENT_CAPABILITIES = [
  { icon: 'pen-line', title: '改内容', items: '章节 / 分镜镜头 / 元素（人物·场景·道具·特效）的增删改' },
  { icon: 'wand-sparkles', title: '跑生成', items: '单集或全部剧本、分镜、出图、镜头视频，以及整条流水线' },
  { icon: 'image', title: '填素材', items: '把附件图片直接写进元素图 / 参考图 / 角色造型 / 服装 / 角色语音' },
  { icon: 'settings', title: '改配置', items: '直接改写项目与设置里的字段，并调用本地接口' },
];

export const AGENT_EXAMPLES = [
  '把第 5 个分镜改成俯拍，人物站在门口，氛围更压抑；然后保存。',
  '给第 1 集所有还没生成视频的镜头排上生成队列。',
  '把附件这张图设为「林晚」的主参考图。',
  '用我上传的小说原文，从第一章开始分集，并提取人物和场景。',
];

// 计划预览里把动作名翻译成人话。
const AGENT_ACTION_LABELS = {
  add_chapter: '新增章节', split_chapter: '拆分章节', delete_chapter: '删除章节',
  extract_elements_from_source: '从原文提取元素',
  generate_episode: '生成剧本', generate_storyboard: '生成分镜',
  generate_all_episodes: '生成全部剧本', generate_all_storyboards: '生成全部分镜',
  replace_shot: '替换镜头', insert_shot_after: '插入镜头', delete_shot: '删除镜头',
  remove_shot_tag_bindings: '解除镜头标签绑定',
  add_element: '新增元素', delete_element: '删除元素', update_element: '修改元素', clear_elements: '清空元素',
  generate_image: '生成图片', run_batch_images: '批量出图',
  generate_shot_video: '生成镜头视频', generate_all_shot_videos: '生成全部镜头视频',
  clear_shot_video: '清除镜头视频', cancel_shot_queue: '取消排队', clear_pending_videos: '清除待生成视频',
  clear_video_queue: '清空视频队列', run_full_pipeline: '跑完整流水线',
  create_project: '新建项目', delete_project: '删除项目',
  set_view: '切换页面', open_project: '打开项目', set_stage: '切换阶段',
  select_episode: '选择剧集', select_storyboard_episode: '选择分镜集',
  open_elements: '打开元素库', select_category: '切换分类', select_element: '选中元素',
  set_path: '改写配置字段', delete_path: '删除配置字段',
  api_get: '读取本地接口', api_post: '调用本地接口',
  save_project: '保存项目', save_script: '保存剧本', save_settings: '保存设置', show_message: '提示消息',
  upload_attachment_image: '写入附件图片', upload_attachment_element_image: '写入元素图',
  upload_attachment_reference_image: '写入参考图', upload_attachment_variant_image: '写入角色造型',
  upload_attachment_outfit_image: '写入服装', upload_attachment_character_audio: '写入角色语音',
  delete_reference_image: '删除参考图', clear_reference_image: '清空参考图',
  delete_character_audio: '删除角色语音', clear_character_audio: '清空角色语音',
};

// 会真实消耗额度 / 直接改配置 / 删数据的动作，在预览里标红。
const AGENT_RISKY_ACTIONS = new Set([
  'set_path', 'delete_path', 'api_get', 'api_post',
  'run_full_pipeline', 'create_project', 'delete_project', 'clear_elements',
  'generate_all_episodes', 'generate_all_storyboards', 'generate_all_shot_videos',
  'generate_shot_video', 'generate_image', 'run_batch_images',
  'delete_chapter', 'delete_shot', 'delete_element',
  'clear_shot_video', 'clear_pending_videos', 'clear_video_queue',
]);

export function agentActionLabel(type) {
  return AGENT_ACTION_LABELS[type] || String(type || '未知动作');
}

export function isRiskyAgentAction(type) {
  return AGENT_RISKY_ACTIONS.has(String(type || ''));
}

export function createAgentStateRuntime({ reactive } = {}) {
  return reactive({
    open: false,
    running: false,
    input: '',
    messages: [],
    lastPlan: null,
    pendingPlan: null,
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
