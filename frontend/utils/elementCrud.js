import { createProjectVisualSettingsRuntime } from './settingsConfig.js';
import { renameStoryboardSceneRefs } from './sceneAreas.js';

export function createAddElementContext(handlers = {}) {
  return {
    project: () => handlers.projectRef.value,
    isAdding: () => handlers.addingElementRef.value,
    promptName: (category = handlers.categoryRef.value) => handlers.messageBox.prompt(`新增${handlers.categoryLabel(category)}的名称`, `新增${handlers.categoryLabel(category)}`, {
      confirmButtonText: '新增', cancelButtonText: '取消',
      inputPattern: /\S/, inputErrorMessage: '名称不能为空',
    }).then((result) => (result.value || '').trim()).catch(() => null),
    setAdding: (value) => { handlers.addingElementRef.value = value; },
    category: () => handlers.categoryRef.value,
    categoryLabel: handlers.categoryLabel,
    addElement: (payload) => handlers.api.post('/api/project/element/add', payload),
    addLocalElement: (project, category, element, index) => applyAddedElement(
      project,
      category,
      element,
      index,
      handlers.hydrateImageState,
    ),
    setSearchQuery: (value) => { handlers.searchQueryRef.value = value; },
    setSelectedElementIndex: (value) => { handlers.selectedElementIndexRef.value = value; },
    success: handlers.message.success,
    error: handlers.message.error,
  };
}

export function createDeleteElementContext(handlers = {}) {
  return {
    project: () => handlers.projectRef.value,
    category: () => handlers.categoryRef.value,
    categoryLabel: handlers.categoryLabel,
    confirmDelete: (name) => handlers.messageBox.confirm(
      `确定删除${handlers.categoryLabel(handlers.categoryRef.value)}「${name}」？已生成的图片、待同步图片、人物参考图/音频也会一并删除，不可恢复。`,
      '删除元素',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    ).then(() => true).catch(() => false),
    deleteElement: (payload) => handlers.api.post('/api/project/element/delete', payload),
    fetchProject: (projectId) => handlers.api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    setProject: (nextProject) => { handlers.projectRef.value = handlers.hydrateImageState(nextProject); },
    syncCharacterImageMode: handlers.syncCharacterImageMode,
    currentList: () => handlers.currentListRef.value,
    selectedElementIndex: () => handlers.selectedElementIndexRef.value,
    setSelectedElementIndex: (value) => { handlers.selectedElementIndexRef.value = value; },
    success: handlers.message.success,
    error: handlers.message.error,
  };
}

export function createDeleteSelectedElementsContext(handlers = {}) {
  return {
    project: () => handlers.projectRef.value,
    categoryLabel: handlers.categoryLabel,
    selectedElements: handlers.selectedElementsRef,
    confirmDelete: (items) => {
      const names = items.slice(0, 8).map((item) => `「${item.name}」`).join('、');
      const suffix = items.length > 8 ? ` 等 ${items.length} 个元素` : ` 共 ${items.length} 个元素`;
      return handlers.messageBox.confirm(
        `确定删除选中的 ${names}${suffix}？已生成的图片、待同步图片及相关分镜绑定也会一并删除，不可恢复。`,
        '批量删除元素',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      ).then(() => true).catch(() => false);
    },
    deleteSelectedElements: (payload) => handlers.api.post('/api/project/elements/delete-selected', payload),
    fetchProject: (projectId) => handlers.api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    setProject: (nextProject) => { handlers.projectRef.value = handlers.hydrateImageState(nextProject); },
    syncCharacterImageMode: handlers.syncCharacterImageMode,
    setSelectedElementIndex: (value) => { handlers.selectedElementIndexRef.value = value; },
    setSelectionMode: (value) => { handlers.selectionModeRef.value = value; },
    setDeleting: (value) => { handlers.deletingSelectedElementsRef.value = value; },
    success: handlers.message.success,
    warning: handlers.message.warning,
    error: handlers.message.error,
  };
}

export function createClearElementsContext(handlers = {}) {
  return {
    project: () => handlers.projectRef.value,
    categoryLabel: handlers.categoryLabel,
    confirmClear: (label) => handlers.messageBox.confirm(
      `确定清空「${label}」元素？已生成的图片也会一并删除，不可恢复。`,
      '清空元素',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
    ).then(() => true).catch(() => false),
    clearElements: (payload) => handlers.api.post('/api/project/elements/clear', payload),
    fetchProject: (projectId) => handlers.api.get(`/api/project?id=${encodeURIComponent(projectId)}`),
    setProject: (nextProject) => { handlers.projectRef.value = handlers.hydrateImageState(nextProject); },
    syncCharacterImageMode: handlers.syncCharacterImageMode,
    setSelectedElementIndex: (value) => { handlers.selectedElementIndexRef.value = value; },
    success: handlers.message.success,
    error: handlers.message.error,
  };
}

export function createElementCrudRuntimeContext({ api, message, messageBox, refs = {}, helpers = {} } = {}) {
  const baseHandlers = () => ({
    api,
    message,
    messageBox,
    projectRef: refs.project,
    categoryRef: refs.category,
    categoryLabel: helpers.categoryLabel,
    hydrateImageState: helpers.hydrateImageState,
    syncCharacterImageMode: helpers.syncCharacterImageMode,
    addingElementRef: refs.addingElement,
    searchQueryRef: refs.searchQuery,
    selectedElementIndexRef: refs.selectedElementIndex,
    currentListRef: refs.currentList,
    selectedElementsRef: refs.selectedElements,
    selectionModeRef: refs.selectionMode,
    deletingSelectedElementsRef: refs.deletingSelectedElements,
  });
  return {
    addElement: () => addElementFlow(createAddElementContext(baseHandlers())),
    deleteElement: (element, index) => deleteElementFlow(element, index, createDeleteElementContext(baseHandlers())),
    deleteSelectedElements: () => deleteSelectedElementsFlow(createDeleteSelectedElementsContext(baseHandlers())),
    clearElements: (category) => clearElementsFlow(category, createClearElementsContext(baseHandlers())),
  };
}

export function createElementWorkspaceActionsRuntime({ api, message, messageBox, refs = {}, helpers = {}, options = {} } = {}) {
  const visualSettings = createProjectVisualSettingsRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      config: refs.config,
      projectStyle: refs.projectStyle,
      characterImageMode: refs.characterImageMode,
    },
    helpers: { hydrateImageState: helpers.hydrateImageState },
    options: {
      styleOptions: options.styleOptions,
      characterImageModeOptions: options.characterImageModeOptions,
      characterImageModeLabels: options.characterImageModeLabels,
    },
  });
  const crudActions = createElementCrudRuntimeContext({
    api,
    message,
    messageBox,
    refs: {
      project: refs.project,
      category: refs.category,
      addingElement: refs.addingElement,
      searchQuery: refs.searchQuery,
      selectedElementIndex: refs.selectedElementIndex,
      currentList: refs.currentList,
      selectedElements: refs.selectedElements,
      selectionMode: refs.selectionMode,
      deletingSelectedElements: refs.deletingSelectedElements,
    },
    helpers: {
      categoryLabel: helpers.categoryLabel,
      hydrateImageState: helpers.hydrateImageState,
      syncCharacterImageMode: visualSettings.syncCharacterImageMode,
    },
  });

  return {
    ...visualSettings,
    ...crudActions,
  };
}

export async function addElementFlow(handlers = {}) {
  const project = handlers.project();
  if (!project || handlers.isAdding()) return;
  const projectId = project.id;
  const category = handlers.category();
  const name = await handlers.promptName(category);
  if (!name) return;
  handlers.setAdding(true);
  try {
    const result = await handlers.addElement({
      projectId,
      category,
      name,
    });
    if (!result.ok) return handlers.error(result.error || '新增失败');
    let addedIndex = -1;
    const currentProject = handlers.project();
    if (currentProject?.id === projectId && result.element) {
      addedIndex = handlers.addLocalElement(currentProject, category, result.element, result.index);
    }
    handlers.setSearchQuery('');
    handlers.setSelectedElementIndex(addedIndex);
    handlers.success(`已新增${handlers.categoryLabel(category)}「${name}」，可填写提示词后出图`);
  } catch (error) {
    handlers.error(error.message);
  } finally {
    handlers.setAdding(false);
  }
}

export function applyAddedElement(project, category, element, index, hydrateImageState = (value) => value) {
  if (!project || !category || !element) return -1;
  if (!project.elements || typeof project.elements !== 'object') project.elements = {};
  if (!Array.isArray(project.elements[category])) project.elements[category] = [];
  const list = project.elements[category];
  const existingIndex = list.findIndex((item) => item === element || (
    String(item?.name || '').trim() && String(item?.name || '').trim() === String(element.name || '').trim()
  ));
  if (existingIndex >= 0) return existingIndex;
  const targetIndex = Number.isInteger(index) && index >= 0
    ? Math.min(index, list.length)
    : list.length;
  list.splice(targetIndex, 0, element);
  hydrateImageState(project);
  return targetIndex;
}

export async function deleteElementFlow(element, index, handlers = {}) {
  if (!handlers.project() || !element) return;
  const name = String(element.name || `${handlers.categoryLabel(handlers.category())} ${index + 1}`).trim();
  const confirmed = await handlers.confirmDelete(name);
  if (!confirmed) return;
  try {
    const projectId = handlers.project().id;
    const result = await handlers.deleteElement({
      projectId,
      category: handlers.category(),
      index,
    });
    if (!result.ok) return handlers.error(result.error || '删除失败');
    const fresh = await handlers.fetchProject(projectId);
    if (fresh.project) {
      handlers.setProject(fresh.project);
      handlers.syncCharacterImageMode();
    } else {
      handlers.currentList().splice(index, 1);
    }
    const nextIndex = Math.min(handlers.selectedElementIndex(), handlers.currentList().length - 1);
    handlers.setSelectedElementIndex(nextIndex < 0 ? -1 : nextIndex);
    handlers.success(`已删除${handlers.categoryLabel(handlers.category())}「${result.removedName || name}」`);
  } catch (error) {
    handlers.error('删除失败：' + (error?.message || error));
  }
}

export async function deleteSelectedElementsFlow(handlers = {}) {
  const project = handlers.project();
  const selectedElements = handlers.selectedElements;
  if (!project || !selectedElements?.size) return;

  const selectedItems = [];
  for (const [key] of selectedElements.entries()) {
    const separator = String(key).indexOf(':');
    const category = separator >= 0 ? String(key).slice(0, separator) : '';
    const index = Number(String(key).slice(separator + 1));
    const element = project.elements?.[category]?.[index];
    if (!element) continue;
    if (element._gen || element._uploading || element._switchingPrimary || element._syncing || element._refUploading || element._voiceUploading || element._deleting) {
      return handlers.warning('选中的元素中有正在生成、上传或切换主形态的项目，请等待完成后再删除');
    }
    selectedItems.push({ category, index, name: String(element.name || `${handlers.categoryLabel(category)} ${index + 1}`).trim() });
  }
  if (!selectedItems.length) {
    selectedElements.clear();
    return handlers.warning('没有可删除的已选元素');
  }
  if (!(await handlers.confirmDelete(selectedItems))) return;

  handlers.setDeleting(true);
  try {
    const result = await handlers.deleteSelectedElements({
      projectId: project.id,
      items: selectedItems.map(({ category, index }) => ({ category, index })),
    });
    if (!result.ok) return handlers.error(result.error || '批量删除失败');
    const fresh = await handlers.fetchProject(project.id);
    if (fresh.project) {
      handlers.setProject(fresh.project);
      handlers.syncCharacterImageMode();
    }
    selectedElements.clear();
    handlers.setSelectionMode(false);
    handlers.setSelectedElementIndex(-1);
    handlers.success(`已删除 ${result.removedCount || selectedItems.length} 个元素`);
  } catch (error) {
    handlers.error('批量删除失败：' + (error?.message || error));
  } finally {
    handlers.setDeleting(false);
  }
}

export async function clearElementsFlow(category, handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const label = category ? handlers.categoryLabel(category) : '全部';
  const confirmed = await handlers.confirmClear(label);
  if (!confirmed) return;
  const result = await handlers.clearElements({ projectId: project.id, category });
  if (!result.ok) return handlers.error(result.error || '清空失败');
  const fresh = await handlers.fetchProject(project.id);
  if (fresh.project) {
    handlers.setProject(fresh.project);
    handlers.syncCharacterImageMode();
  }
  handlers.setSelectedElementIndex(-1);
  handlers.success('已清空');
}

export function elementSavePayload(element, index, handlers = {}) {
  const category = handlers.category();
  const base = {
    projectId: handlers.projectId(),
    category,
    index,
    name: element.name.trim(),
    alias: String(element.alias || '').trim(),
  };
  if (category === 'character') {
    handlers.ensureCharacterParts(element);
    return {
      ...base,
      aliases: handlers.normalizeCharacterAlias(element),
      prompt: element.prompt,
      referenceMode: element.referenceMode || 'none',
    };
  }
  return { ...base, prompt: element.prompt };
}

export function createElementSaveBodyRuntime({ refs = {}, helpers = {} } = {}) {
  return (element, index, category = refs.category.value, projectId = refs.project.value.id) => elementSavePayload(element, index, {
    projectId: () => projectId,
    category: () => category,
    ensureCharacterParts: helpers.ensureCharacterParts,
    normalizeCharacterAlias: helpers.normalizeCharacterAlias,
  });
}

export function openElementPromptDialogState(promptDialog, element, index, options = {}) {
  const category = options.category();
  promptDialog.type = category === 'character' ? 'character' : 'element';
  promptDialog.title = `${element.name || options.categoryLabel(category)} · 修改提示词`;
  promptDialog.el = element;
  promptDialog.index = index;
  promptDialog.ch = null;
  promptDialog.variant = null;
  promptDialog.outfit = null;
  promptDialog.draftPrompt = element.prompt || '';
  promptDialog.visible = true;
}

export function openVariantPromptDialogState(promptDialog, character, charIndex, variant, variantIndex) {
  promptDialog.type = 'variant';
  promptDialog.title = `${character.name || '人物'} / ${variant.name || '形态'} · 修改提示词`;
  promptDialog.ch = character;
  promptDialog.charIndex = charIndex;
  promptDialog.variant = variant;
  promptDialog.variantIndex = variantIndex;
  promptDialog.el = null;
  promptDialog.outfit = null;
  promptDialog.draftPrompt = variant.prompt || '';
  promptDialog.visible = true;
}

export function openOutfitPromptDialogState(promptDialog, character, charIndex, outfit, outfitIndex) {
  promptDialog.type = 'outfit';
  promptDialog.title = `${character.name || '人物'} / ${outfit.name || '服装'} · 修改提示词`;
  promptDialog.ch = character;
  promptDialog.charIndex = charIndex;
  promptDialog.outfit = outfit;
  promptDialog.outfitIndex = outfitIndex;
  promptDialog.el = null;
  promptDialog.variant = null;
  promptDialog.draftPrompt = outfit.prompt || '';
  promptDialog.visible = true;
}

export function ensureCharacterPromptParts(element, partKeys = []) {
  if (element?.edited && !element.promptParts && !element.partsEdited) return;
  if (!element.promptParts) element.promptParts = {};
  if (!element.partsEdited) element.partsEdited = {};
  for (const key of partKeys) {
    if (element.promptParts[key] === undefined) element.promptParts[key] = '';
    if (element.partsEdited[key] === undefined) element.partsEdited[key] = false;
  }
}

export function createElementPromptRuntime({ state = {}, refs = {}, helpers = {} } = {}) {
  const partKeys = helpers.partKeys || [];
  const promptDialog = state.promptDialog;
  const ensureCharacterParts = (element) => ensureCharacterPromptParts(element, partKeys);
  return {
    ensureCharacterParts,
    markPartEdited: (element, key) => {
      ensureCharacterParts(element);
      element.partsEdited[key] = true;
    },
    resetPartEdited: (element, key) => {
      ensureCharacterParts(element);
      element.partsEdited[key] = false;
    },
    closePromptDialog: () => {
      promptDialog.visible = false;
    },
    openElementPromptDialog: (element, index) => openElementPromptDialogState(promptDialog, element, index, {
      category: () => refs.category.value,
      categoryLabel: helpers.categoryLabel,
    }),
    openVariantPromptDialog: (character, charIndex, variant, variantIndex) => (
      openVariantPromptDialogState(promptDialog, character, charIndex, variant, variantIndex)
    ),
    openOutfitPromptDialog: (character, charIndex, outfit, outfitIndex) => (
      openOutfitPromptDialogState(promptDialog, character, charIndex, outfit, outfitIndex)
    ),
  };
}

export function captureElementSaveState(element) {
  return {
    name: element?.name,
    alias: element?.alias,
    aliasesText: element?.aliasesText,
    prompt: element?.prompt,
    referenceMode: element?.referenceMode,
  };
}

export function applyElementSaveResult(element, result, options = {}) {
  if (!element || !result) return;
  const snapshot = options.snapshot;
  const unchanged = (field) => !snapshot || element[field] === snapshot[field];
  if (result.alias !== undefined && unchanged('alias')) element.alias = result.alias || '';
  if (Array.isArray(result.aliases) && unchanged('aliasesText')) {
    element.aliases = result.aliases;
    element.aliasesText = result.aliases.join(',');
    if (element.source && typeof element.source === 'object') element.source.aliases = result.aliases;
  }
  if (result.prompt !== undefined && unchanged('prompt')) element.prompt = result.prompt;
  if (result.promptParts && unchanged('prompt')) element.promptParts = result.promptParts;
  if (result.partsEdited && unchanged('prompt')) element.partsEdited = result.partsEdited;
  if (result.referenceImageName !== undefined) element.referenceImageName = result.referenceImageName || element.referenceImageName;
  if (result.useReferenceImage !== undefined) element.useReferenceImage = !!result.useReferenceImage;
  if (result.referenceMode !== undefined && unchanged('referenceMode')) element.referenceMode = result.referenceMode || 'none';
  if (result.hasReferenceImage !== undefined) element.hasReferenceImage = !!result.hasReferenceImage;
  element._imageName = String(options.savedName ?? element.name ?? '').trim();
  element._imgBroken = false;
  element._imgReload = 0;
  if (element.hasImage) element._v = (element._v || 0) + 1;
}

export async function saveElementFlow(element, index, handlers = {}) {
  const previousName = String(element?._imageName || element?.name || '').trim();
  const savedName = String(element?.name || '').trim();
  const snapshot = captureElementSaveState(element);
  let result;
  try {
    result = await handlers.saveElement(element, index);
  } catch (error) {
    handlers.error(`保存失败：${error?.message || error}`);
    return false;
  }
  if (result.ok) {
    applyElementSaveResult(element, result, { snapshot, savedName });
    if (handlers.category?.() === 'scene' && previousName && previousName !== savedName) {
      handlers.renameSceneRefs?.(handlers.project?.(), previousName, savedName);
    }
    if (!handlers.silent) handlers.success('已保存修改');
    return true;
  }
  handlers.error(result.error || '保存失败');
  return false;
}

export function createSaveElementRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return (element, index, options = {}) => {
    const category = options.category || refs.category?.value;
    const projectId = options.projectId || refs.project?.value?.id;
    const context = {
      saveElement: (item, itemIndex) => api.post(
        '/api/project/element',
        helpers.elementSaveBody(item, itemIndex, category, projectId),
      ),
      project: () => (refs.project?.value?.id === projectId ? refs.project.value : null),
      category: () => category,
      renameSceneRefs: renameStoryboardSceneRefs,
      success: message.success,
      error: message.error,
      silent: !!options.silent,
    };
    return saveElementFlow(element, index, context);
  };
}

export function createElementAutosaveRuntime({ saveElement, refs = {}, options = {} } = {}) {
  const delay = Number.isFinite(options.delay) ? Math.max(0, options.delay) : 800;
  const setTimer = options.setTimeout || globalThis.setTimeout;
  const clearTimer = options.clearTimeout || globalThis.clearTimeout;
  const states = new WeakMap();

  const stateFor = (element) => {
    if (!states.has(element)) {
      states.set(element, {
        timer: null,
        saving: false,
        promise: null,
        pending: false,
        notify: false,
        index: -1,
        category: '',
        projectId: '',
        lastResult: true,
      });
    }
    return states.get(element);
  };

  const rememberTarget = (state, index) => {
    state.index = index;
    state.category = refs.category?.value || '';
    state.projectId = refs.project?.value?.id || '';
  };

  const flushElementSave = async (element) => {
    if (!element) return false;
    const state = stateFor(element);
    if (state.timer !== null) {
      clearTimer(state.timer);
      state.timer = null;
    }
    if (state.saving) {
      const activePromise = state.promise;
      await activePromise;
      if (state.saving && state.promise !== activePromise) return state.promise;
      if (state.pending && state.timer === null) return flushElementSave(element);
      return state.lastResult;
    }
    if (!state.pending) return state.lastResult;

    const notify = state.notify;
    if (!notify && !String(element.name || '').trim()) {
      state.pending = false;
      return false;
    }
    const target = {
      index: state.index,
      category: state.category,
      projectId: state.projectId,
    };
    state.pending = false;
    state.notify = false;
    state.saving = true;
    state.promise = Promise.resolve(saveElement(element, target.index, {
      category: target.category,
      projectId: target.projectId,
      silent: !notify,
    }));
    try {
      state.lastResult = await state.promise;
      return state.lastResult;
    } finally {
      state.saving = false;
      state.promise = null;
    }
  };

  const scheduleElementSave = (element, index) => {
    if (!element) return;
    const state = stateFor(element);
    rememberTarget(state, index);
    state.pending = true;
    if (state.timer !== null) clearTimer(state.timer);
    state.timer = setTimer(() => {
      state.timer = null;
      void flushElementSave(element);
    }, delay);
  };

  const saveElementNow = (element, index) => {
    if (!element) return Promise.resolve(false);
    const state = stateFor(element);
    rememberTarget(state, index);
    state.pending = true;
    state.notify = true;
    return flushElementSave(element);
  };

  return { scheduleElementSave, flushElementSave, saveElement: saveElementNow };
}

export async function uploadElementImageFileFlow(file, endpoint, body, handlers = {}) {
  const imageB64 = await handlers.readImageAsPngB64(file);
  return handlers.post(endpoint, { ...body, imageB64 });
}

export function createElementFileRuntime({ api, message, readers = {} } = {}) {
  const firstImageFile = (fileList) => readers.firstImageFile(fileList, message);
  const firstAudioFile = (fileList) => readers.firstAudioFile(fileList, message);
  const uploadImageFile = (file, endpoint, body) => uploadElementImageFileFlow(file, endpoint, body, {
    readImageAsPngB64: readers.readImageAsPngB64,
    post: (targetEndpoint, payload) => api.post(targetEndpoint, payload),
  });
  const createDropHandler = (fileReader, upload) => (event, ...args) => {
    event.preventDefault();
    const file = fileReader(event.dataTransfer?.files);
    if (file) upload(...args, file);
  };
  const createPickHandler = (fileReader, upload) => (event, ...args) => {
    const file = fileReader(event.target.files);
    event.target.value = '';
    if (file) upload(...args, file);
  };
  return {
    firstImageFile,
    firstAudioFile,
    uploadImageFile,
    imageDropHandler: (upload) => createDropHandler(firstImageFile, upload),
    imagePickHandler: (upload) => createPickHandler(firstImageFile, upload),
    audioDropHandler: (upload) => createDropHandler(firstAudioFile, upload),
    audioPickHandler: (upload) => createPickHandler(firstAudioFile, upload),
  };
}

export function applyCharacterReferenceImageState(element, result = {}, enabled = true) {
  element.referenceImageName = result.referenceImageName || `${element.name.trim()}_参考图`;
  element.hasReferenceImage = !!enabled;
  element.referenceMode = enabled ? element.referenceMode : 'none';
  element.useReferenceImage = !!enabled;
  element._refImgBroken = false;
  element._refV = (element._refV || 0) + 1;
}

export async function uploadCharacterReferenceImageFlow(element, index, file, handlers = {}) {
  if (!file || element._refUploading) return;
  element._refUploading = true;
  try {
    await handlers.saveElement(element, index);
    const result = await handlers.uploadReference(file, {
      projectId: handlers.projectId(),
      charIndex: index,
    });
    if (!result.ok) return handlers.error(result.error || '上传失败');
    applyCharacterReferenceImageState(element, result, true);
    handlers.success('参考图已上传');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    element._refUploading = false;
  }
}

export function createUploadCharacterReferenceImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    saveElement: (element, itemIndex) => api.post('/api/project/element', helpers.elementSaveBody(element, itemIndex)),
    uploadReference: (imageFile, body) => helpers.uploadImage(imageFile, '/api/character/reference/upload', body),
    success: message.success,
    error: message.error,
  };
  return (element, index, file) => uploadCharacterReferenceImageFlow(element, index, file, context);
}

export async function deleteCharacterReferenceFlow(element, index, handlers = {}) {
  if (!element.hasReferenceImage || element._refDeleting) return;
  element._refDeleting = true;
  try {
    const result = await handlers.deleteReference({
      projectId: handlers.projectId(),
      charIndex: index,
    });
    if (!result.ok) return handlers.error(result.error || '删除失败');
    applyCharacterReferenceImageState(element, result, false);
    handlers.success('参考图已删除');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    element._refDeleting = false;
  }
}

export function createDeleteCharacterReferenceRuntime({ api, message, refs = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    deleteReference: (payload) => api.post('/api/character/reference/delete', payload),
    success: message.success,
    error: message.error,
  };
  return (element, index) => deleteCharacterReferenceFlow(element, index, context);
}

export function applyGlobalReferenceImageState(project, result = {}, enabled = true) {
  project.globalReferenceImageName = result.globalReferenceImageName || '__全局风格参考图';
  project.hasGlobalReferenceImage = !!enabled;
  project.useGlobalReferenceImage = !!enabled;
  project._globalRefBroken = false;
  project._globalRefV = (project._globalRefV || 0) + 1;
}

export async function uploadGlobalReferenceImageFlow(file, handlers = {}) {
  const project = handlers.project();
  if (!file || project?._globalRefUploading) return;
  project._globalRefUploading = true;
  try {
    const result = await handlers.uploadReference(file, { projectId: project.id });
    if (!result.ok) return handlers.error(result.error || '上传失败');
    applyGlobalReferenceImageState(project, result, true);
    handlers.success('全局风格图已上传');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    project._globalRefUploading = false;
  }
}

export function createUploadGlobalReferenceImageRuntime({ message, refs = {}, helpers = {} } = {}) {
  const context = {
    project: () => refs.project.value,
    uploadReference: (imageFile, body) => helpers.uploadImage(imageFile, '/api/project/reference/upload', body),
    success: message.success,
    error: message.error,
  };
  return (file) => uploadGlobalReferenceImageFlow(file, context);
}

export async function deleteGlobalReferenceImageFlow(handlers = {}) {
  const project = handlers.project();
  if (!project?.hasGlobalReferenceImage || project._globalRefDeleting) return;
  project._globalRefDeleting = true;
  try {
    const result = await handlers.deleteReference({ projectId: project.id });
    if (!result.ok) return handlers.error(result.error || '删除失败');
    applyGlobalReferenceImageState(project, result, false);
    handlers.success('全局风格图已删除');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    project._globalRefDeleting = false;
  }
}

export function createDeleteGlobalReferenceImageRuntime({ api, message, refs = {} } = {}) {
  const context = {
    project: () => refs.project.value,
    deleteReference: (payload) => api.post('/api/project/reference/delete', payload),
    success: message.success,
    error: message.error,
  };
  return () => deleteGlobalReferenceImageFlow(context);
}

export function applyCharacterVoiceAudioState(element, result = {}, enabled = true) {
  element.hasVoiceAudio = !!enabled;
  element.voiceAudioName = result.voiceAudioName || `${element.name}_音频`;
  element.voiceAudioUrl = enabled ? (result.voiceAudioUrl || '') : '';
  element._voiceV = (element._voiceV || 0) + 1;
}

export async function uploadCharacterVoiceAudioFlow(element, index, file, handlers = {}) {
  if (!file || element._voiceUploading) return;
  element._voiceUploading = true;
  try {
    await handlers.saveElement(element, index);
    const audioB64 = await handlers.readFileAsB64(file);
    const result = await handlers.uploadAudio({
      projectId: handlers.projectId(),
      charIndex: index,
      fileName: file.name,
      mimeType: file.type,
      audioB64,
    });
    if (!result.ok) return handlers.error(result.error || '音频上传失败');
    applyCharacterVoiceAudioState(element, result, true);
    handlers.success('人物音频已按完整时长保存');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    element._voiceUploading = false;
  }
}

export function createUploadCharacterVoiceAudioRuntime({ api, message, refs = {}, readers = {}, helpers = {} } = {}) {
  const context = {
    saveElement: (element, itemIndex) => api.post('/api/project/element', helpers.elementSaveBody(element, itemIndex)),
    readFileAsB64: readers.readFileAsB64,
    projectId: () => refs.project.value.id,
    uploadAudio: (payload) => api.post('/api/character/audio/upload', payload),
    success: message.success,
    error: message.error,
  };
  return (element, index, file) => uploadCharacterVoiceAudioFlow(element, index, file, context);
}

export async function deleteCharacterVoiceAudioFlow(element, index, handlers = {}) {
  if (!element.hasVoiceAudio || element._voiceDeleting) return;
  element._voiceDeleting = true;
  try {
    const result = await handlers.deleteAudio({ projectId: handlers.projectId(), charIndex: index });
    if (!result.ok) return handlers.error(result.error || '删除失败');
    applyCharacterVoiceAudioState(element, result, false);
    handlers.success('人物音频已删除');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    element._voiceDeleting = false;
  }
}

export function createDeleteCharacterVoiceAudioRuntime({ api, message, refs = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    deleteAudio: (payload) => api.post('/api/character/audio/delete', payload),
    success: message.success,
    error: message.error,
  };
  return (element, index) => deleteCharacterVoiceAudioFlow(element, index, context);
}
