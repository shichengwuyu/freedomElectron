import { createExportToJianyingRuntime } from './jianyingExport.js';

export function createExportStateRuntime({ ref } = {}) {
  return {
    exporting: ref(false),
    exportingShots: ref(false),
  };
}

export function createProjectExportActionsRuntime({ api, message, messageBox, refs = {}, helpers = {} } = {}) {
  const openFolder = createOpenProjectImagesFolderRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const openVideoFolder = createOpenProjectVideoFolderRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const exportToJianying = helpers.createExportToJianying();
  const askExportNameLabel = createAskExportNameLabelRuntime({
    messageBox,
  });
  const askCharacterExportScope = createAskCharacterExportScopeRuntime({
    messageBox,
  });
  const exportZip = createExportProjectZipRuntime({
    refs: { project: refs.project },
    helpers: { askExportNameLabel, navigate: helpers.navigate },
  });
  const exportToFolder = createExportProjectImagesToFolderRuntime({
    api,
    message,
    refs: { project: refs.project, exporting: refs.exporting },
    helpers: { askExportNameLabel, nextTick: helpers.nextTick },
  });
  const exportElement = createExportProjectElementRuntime({
    message,
    refs: { project: refs.project, category: refs.category },
    helpers: { askCharacterExportScope, askExportNameLabel, navigate: helpers.navigate },
  });
  return {
    openFolder,
    openVideoFolder,
    exportToJianying,
    askExportNameLabel,
    exportZip,
    exportToFolder,
    exportElement,
  };
}

export function createAppProjectExportRuntime({ api, message, messageBox, refs = {}, helpers = {}, ref } = {}) {
  const state = createExportStateRuntime({ ref });
  const actions = createProjectExportActionsRuntime({
    api,
    message,
    messageBox,
    refs: { project: refs.project, category: refs.category, exporting: state.exporting },
    helpers: {
      nextTick: helpers.nextTick,
      navigate: helpers.navigate,
      createExportToJianying: () => createExportToJianyingRuntime({
        api,
        message,
        messageBox,
        refs: { project: refs.project, episodeId: refs.episodeId },
      }),
    },
  });
  return {
    ...state,
    ...actions,
  };
}

export async function askExportNameLabelFlow(handlers = {}) {
  try {
    await handlers.confirmNameLabel();
    return true;
  } catch (action) {
    if (action === 'cancel') return false;
    return null;
  }
}

export function confirmExportNameLabel(messageBox) {
  return messageBox.confirm(
    '是否为导出的图片加入图片名称标注？选择“是”会在图片底部追加白色标注栏，并用红色文字写入图片名称。',
    '导出标注',
    {
      confirmButtonText: '是，加入标注',
      cancelButtonText: '否，直接导出',
      distinguishCancelAndClose: true,
      closeOnClickModal: false,
      type: 'info',
    },
  );
}

export function createAskExportNameLabelRuntime({ messageBox } = {}) {
  return () => askExportNameLabelFlow({
    confirmNameLabel: () => confirmExportNameLabel(messageBox),
  });
}

export async function askCharacterExportScopeFlow(element, handlers = {}) {
  const lookCount = (element?.variants?.length || 0) + (element?.outfits?.length || 0);
  if (!lookCount) return 'main';
  try {
    await handlers.confirmAllLooks(lookCount);
    return 'all';
  } catch (action) {
    if (action === 'cancel') return 'main';
    return null;
  }
}

export function confirmCharacterExportScope(messageBox, element, lookCount) {
  return messageBox.confirm(
    `人物“${element?.name || '未命名'}”有 ${lookCount} 个造型。导出全部形态将下载一个 ZIP，包含主形态和所有已生成的造型图片。`,
    '选择人物导出范围',
    {
      confirmButtonText: '导出全部形态',
      cancelButtonText: '仅导出主形态',
      distinguishCancelAndClose: true,
      closeOnClickModal: false,
      type: 'info',
    },
  );
}

export function createAskCharacterExportScopeRuntime({ messageBox } = {}) {
  return (element) => askCharacterExportScopeFlow(element, {
    confirmAllLooks: (lookCount) => confirmCharacterExportScope(messageBox, element, lookCount),
  });
}

export async function openProjectImagesFolderFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return false;
  try {
    const result = await handlers.openFolder({ projectId: project.id });
    if (result.ok) {
      handlers.success('已打开项目图片文件夹');
      return true;
    }
    handlers.error(result.error || '打开失败');
  } catch (error) {
    handlers.error(error.message || '打开失败');
  }
  return false;
}

export function createOpenProjectImagesFolderRuntime({ api, message, refs = {} } = {}) {
  return () => openProjectImagesFolderFlow({
    project: () => refs.project.value,
    openFolder: (payload) => api.post('/api/export/folder', payload),
    success: (text) => message.success(text),
    error: (text) => message.error(text),
  });
}

export async function openProjectVideoFolderFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const result = await handlers.openFolder({ projectId: project.id });
  if (result.ok) handlers.success('已在资源管理器打开视频文件夹');
  else handlers.error(result.error || '打开失败');
}

export function createOpenProjectVideoFolderRuntime({ api, message, refs = {} } = {}) {
  return () => openProjectVideoFolderFlow({
    project: () => refs.project.value,
    openFolder: (payload) => api.post('/api/video/open-folder', payload),
    success: (text) => message.success(text),
    error: (text) => message.error(text),
  });
}

export async function exportProjectZipFlow(category, handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const addNameLabel = await handlers.askExportNameLabel();
  if (addNameLabel === null) return;
  const categoryQuery = category ? `&category=${encodeURIComponent(category)}` : '';
  handlers.navigate(`/api/export/zip?id=${encodeURIComponent(project.id)}&addNameLabel=${addNameLabel ? '1' : '0'}${categoryQuery}`);
}

export function createExportProjectZipRuntime({ refs = {}, helpers = {} } = {}) {
  // 兼容两种调用：按钮直接点击（事件对象）→ 打包全部；下拉菜单选分类（字符串）→ 只打包该分类
  return (category) => exportProjectZipFlow(typeof category === 'string' ? category : '', {
    project: () => refs.project.value,
    askExportNameLabel: helpers.askExportNameLabel,
    navigate: helpers.navigate,
  });
}

export async function exportProjectImagesToFolderFlow(category, handlers = {}) {
  if (handlers.isExporting()) return;
  const project = handlers.project();
  if (!project) return;
  const addNameLabel = await handlers.askExportNameLabel();
  if (addNameLabel === null) return;
  handlers.setExporting(true);
  await handlers.nextTick();
  try {
    const result = await handlers.exportImages({ projectId: project.id, addNameLabel, category: category || '' });
    if (result.canceled) return;
    if (result.ok) handlers.success(`已导出 ${result.copied} 张图片，并打开目标文件夹`);
    else handlers.error(result.error || '导出失败');
  } finally {
    handlers.setExporting(false);
  }
}

export function createExportProjectImagesToFolderRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  // 兼容两种调用：按钮直接点击（事件对象）→ 导出全部；下拉菜单选分类（字符串）→ 只导出该分类
  return (category) => exportProjectImagesToFolderFlow(typeof category === 'string' ? category : '', {
    project: () => refs.project.value,
    isExporting: () => refs.exporting.value,
    setExporting: (value) => { refs.exporting.value = value; },
    askExportNameLabel: helpers.askExportNameLabel,
    nextTick: helpers.nextTick,
    exportImages: (payload) => api.post('/api/export/to-folder', payload),
    success: (text) => message.success(text),
    error: (text) => message.error(text),
  });
}

export async function exportProjectElementFlow(element, index, handlers = {}) {
  const project = handlers.project();
  if (!project || !element.hasImage) return;
  const category = handlers.category();
  const scope = category === 'character'
    ? await handlers.askCharacterExportScope(element)
    : 'main';
  if (scope === null) return;
  const addNameLabel = await handlers.askExportNameLabel();
  if (addNameLabel === null) return;
  const scopeQuery = scope === 'all' ? '&scope=all' : '';
  handlers.navigate(`/api/export/element?projectId=${encodeURIComponent(project.id)}&category=${encodeURIComponent(category)}&index=${index}&addNameLabel=${addNameLabel ? '1' : '0'}${scopeQuery}`);
  handlers.success('开始下载');
}

export function createExportProjectElementRuntime({ message, refs = {}, helpers = {} } = {}) {
  return (element, index) => exportProjectElementFlow(element, index, {
    project: () => refs.project.value,
    askCharacterExportScope: helpers.askCharacterExportScope,
    askExportNameLabel: helpers.askExportNameLabel,
    category: () => refs.category.value,
    navigate: helpers.navigate,
    success: (text) => message.success(text),
  });
}

export async function exportShotCardsFlow(handlers = {}) {
  if (handlers.isExporting()) return;
  if (!handlers.project()) return;
  const episode = handlers.selectedEpisode();
  const storyboard = handlers.selectedStoryboard();
  if (!episode || !storyboard || !storyboard.content) return handlers.warning('当前集还没有分镜');
  handlers.setExporting(true);
  await handlers.nextTick();
  try {
    const result = await handlers.exportCards({
      projectId: handlers.project().id,
      episodeId: handlers.episodeId(),
    });
    if (result.canceled) return;
    if (result.ok) handlers.success(`已导出 ${result.shots} 个镜头到：${result.target}`);
    else handlers.error(result.error || '导出失败');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    handlers.setExporting(false);
  }
}

export function createExportShotCardsRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    isExporting: () => refs.exporting.value,
    setExporting: (value) => { refs.exporting.value = value; },
    project: () => refs.project.value,
    selectedEpisode: () => refs.selectedEpisode.value,
    selectedStoryboard: () => refs.selectedStoryboard.value,
    episodeId: () => refs.episodeId.value,
    nextTick: helpers.nextTick,
    exportCards: (payload) => api.post('/api/script/storyboard/export-cards', payload),
  };
}

export function createExportShotCardsRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return () => exportShotCardsFlow(createExportShotCardsRuntimeContext({ api, message, refs, helpers }));
}
