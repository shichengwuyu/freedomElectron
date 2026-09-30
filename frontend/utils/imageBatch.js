import {
  createDeleteCharacterReferenceRuntime,
  createDeleteCharacterVoiceAudioRuntime,
  createDeleteGlobalReferenceImageRuntime,
  createElementAutosaveRuntime,
  createElementFileRuntime,
  createSaveElementRuntime,
  createUploadCharacterReferenceImageRuntime,
  createUploadCharacterVoiceAudioRuntime,
  createUploadGlobalReferenceImageRuntime,
} from './elementCrud.js';
import {
  firstAudioFile as defaultFirstAudioFile,
  firstImageFile as defaultFirstImageFile,
} from './fileReaders.js';
import { createImageStateAccessRuntime } from './imageState.js';
import { pollJobUntilDone } from './pollJob.js';
import { renameStoryboardSceneAreaRefs } from './sceneAreas.js';

export function createImageBatchUiStateRuntime({ reactive, ref, computed, helpers = {} } = {}) {
  const batchCategory = ref('current');
  const batch = reactive({ running: false, done: 0, total: 0, failed: [], category: '', appliedResults: 0 });
  return {
    batchCategory,
    batch,
    batchProgressPercentage: computed(() => {
      if (!batch.total) return 0;
      if (batch.running && batch.done === 0 && batch.total <= 1) return 12;
      return helpers.progressByRatio(batch.done, batch.total);
    }),
    batchProgressIndeterminate: computed(() => batch.running && batch.done === 0 && batch.total <= 1),
    selectedElements: reactive(new Map()),
    selectionMode: ref(false),
  };
}

export function createElementMediaActionsRuntime({ api, message, refs = {}, helpers = {}, readers = {}, fileHandlers = {} } = {}) {
  const elementSaveBody = helpers.createElementSaveBody();
  const persistElement = createSaveElementRuntime({
    api,
    message,
    refs: { project: refs.project, category: refs.category },
    helpers: { elementSaveBody },
  });
  const { saveElement, scheduleElementSave } = createElementAutosaveRuntime({
    saveElement: persistElement,
    refs: { project: refs.project, category: refs.category },
  });
  const genImage = createGenerateElementImageRuntime({
    api,
    message,
    refs: { project: refs.project, category: refs.category, ratio: refs.ratio, imageMode: refs.imageMode },
    helpers: { nextTick: helpers.nextTick, elementSaveBody, applyPending: markImageSlotPending, syncImage: helpers.syncImage },
  });
  const saveVariant = createSaveVariantRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const genVariant = createGenerateVariantImageRuntime({
    api,
    message,
    refs: { project: refs.project, ratio: refs.ratio, imageMode: refs.imageMode },
    helpers: { nextTick: helpers.nextTick, applyPending: markImageSlotPending, syncImage: helpers.syncImage },
  });
  const saveOutfit = createSaveOutfitRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const genOutfit = createGenerateOutfitImageRuntime({
    api,
    message,
    refs: { project: refs.project, ratio: refs.ratio },
    helpers: { nextTick: helpers.nextTick, applyPending: markImageSlotPending, syncImage: helpers.syncImage },
  });
  const genSceneArea = createGenerateSceneAreaImageRuntime({
    api,
    message,
    refs: { project: refs.project, ratio: refs.ratio },
    helpers: { nextTick: helpers.nextTick, applyPending: markImageSlotPending, syncImage: helpers.syncImage },
  });
  const saveSceneArea = createSaveSceneAreaRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const uploadSceneAreaImage = createUploadSceneAreaImageRuntime({
    api,
    message,
    refs: { project: refs.project },
    helpers: { saveSceneArea, uploadImage: fileHandlers.uploadImageFile },
  });
  const uploadElementImage = createUploadElementImageRuntime({
    api,
    message,
    refs: { project: refs.project, category: refs.category },
    helpers: { elementSaveBody, uploadImage: (imageFile, body) => fileHandlers.uploadImageFile(imageFile, '/api/image/upload', body) },
  });
  const uploadVariantImage = createUploadVariantImageRuntime({
    api,
    message,
    refs: { project: refs.project },
    helpers: { saveVariant, uploadImage: fileHandlers.uploadImageFile },
  });
  const uploadVariantClothingReference = createUploadVariantClothingReferenceRuntime({
    api,
    message,
    refs: { project: refs.project },
    helpers: { saveVariant, uploadImage: fileHandlers.uploadImageFile },
  });
  const deleteVariantClothingReference = createDeleteVariantClothingReferenceRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const uploadOutfitImage = createUploadOutfitImageRuntime({
    api,
    message,
    refs: { project: refs.project },
    helpers: { saveOutfit, uploadImage: fileHandlers.uploadImageFile },
  });
  const uploadCharacterReferenceImage = createUploadCharacterReferenceImageRuntime({
    api,
    message,
    refs: { project: refs.project },
    helpers: { elementSaveBody, uploadImage: fileHandlers.uploadImageFile },
  });
  const deleteCharacterReference = createDeleteCharacterReferenceRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const uploadGlobalReferenceImage = createUploadGlobalReferenceImageRuntime({
    message,
    refs: { project: refs.project },
    helpers: { uploadImage: fileHandlers.uploadImageFile },
  });
  const deleteGlobalReferenceImage = createDeleteGlobalReferenceImageRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  const uploadCharacterVoiceAudio = createUploadCharacterVoiceAudioRuntime({
    api,
    message,
    refs: { project: refs.project },
    readers: { readFileAsB64: readers.readFileAsB64 },
    helpers: { elementSaveBody },
  });
  const deleteCharacterVoiceAudio = createDeleteCharacterVoiceAudioRuntime({
    api,
    message,
    refs: { project: refs.project },
  });
  return {
    elementSaveBody,
    saveElement,
    scheduleElementSave,
    genImage,
    saveVariant,
    genVariant,
    saveOutfit,
    genOutfit,
    genSceneArea,
    savePromptDialog: helpers.createSavePromptDialog({ saveElement, saveVariant, saveOutfit }),
    uploadElementImage,
    onElementImageDrop: fileHandlers.imageDropHandler(uploadElementImage),
    onPickElementImage: fileHandlers.imagePickHandler(uploadElementImage),
    uploadVariantImage,
    onVariantImageDrop: fileHandlers.imageDropHandler(uploadVariantImage),
    onPickVariantImage: fileHandlers.imagePickHandler(uploadVariantImage),
    uploadVariantClothingReference,
    onVariantClothingReferenceDrop: fileHandlers.imageDropHandler(uploadVariantClothingReference),
    onPickVariantClothingReference: fileHandlers.imagePickHandler(uploadVariantClothingReference),
    deleteVariantClothingReference,
    uploadOutfitImage,
    onOutfitImageDrop: fileHandlers.imageDropHandler(uploadOutfitImage),
    onPickOutfitImage: fileHandlers.imagePickHandler(uploadOutfitImage),
    saveSceneArea,
    uploadSceneAreaImage,
    onSceneAreaImageDrop: fileHandlers.imageDropHandler(uploadSceneAreaImage),
    onPickSceneAreaImage: fileHandlers.imagePickHandler(uploadSceneAreaImage),
    uploadCharacterReferenceImage,
    onCharacterReferenceDrop: fileHandlers.imageDropHandler(uploadCharacterReferenceImage),
    onPickCharacterReference: fileHandlers.imagePickHandler(uploadCharacterReferenceImage),
    deleteCharacterReference,
    uploadGlobalReferenceImage,
    onGlobalReferenceDrop: fileHandlers.imageDropHandler(uploadGlobalReferenceImage),
    onPickGlobalReference: fileHandlers.imagePickHandler(uploadGlobalReferenceImage),
    deleteGlobalReferenceImage,
    uploadCharacterVoiceAudio,
    onPickCharacterVoice: fileHandlers.audioPickHandler(uploadCharacterVoiceAudio),
    onCharacterVoiceDrop: fileHandlers.audioDropHandler(uploadCharacterVoiceAudio),
    deleteCharacterVoiceAudio,
  };
}

export function createImageBatchActionsRuntime({ api, message, refs = {}, helpers = {}, computed } = {}) {
  const {
    currentCategory: currentBatchCategory,
    applyResults: applyBatchResults,
  } = createBatchResultRuntime({
    refs: { batch: refs.batch, batchCategory: refs.batchCategory, category: refs.category, project: refs.project },
    helpers: { setImageGenerating: helpers.setImageGenerating },
  });
  const runBatch = createRunImageBatchRuntime({
    api,
    message,
    refs: { batch: refs.batch, project: refs.project, imageRatio: refs.imageRatio, characterImageMode: refs.characterImageMode },
    helpers: {
      currentCategory: currentBatchCategory,
      prepareGeneration: helpers.prepareGeneration,
      clearGeneration: helpers.clearGeneration,
      applyResults: applyBatchResults,
      startProgressTracking: helpers.startProgressTracking,
      updateProgressTracking: helpers.updateProgressTracking,
      stopProgressTracking: helpers.stopProgressTracking,
      formatElapsed: helpers.formatElapsed,
      nextTick: helpers.nextTick,
    },
  });
  const selection = helpers.createElementSelection({ computed, refs });
  const runBatchForSelected = createRunSelectedImageBatchRuntime({
    api,
    message,
    refs: {
      batch: refs.batch,
      selectedElements: refs.selectedElements,
      project: refs.project,
      imageRatio: refs.imageRatio,
      characterImageMode: refs.characterImageMode,
      selectionMode: refs.selectionMode,
    },
    helpers: {
      prepareGeneration: helpers.prepareGeneration,
      clearGeneration: helpers.clearGeneration,
      applyResults: applyBatchResults,
      nextTick: helpers.nextTick,
    },
  });
  return {
    currentBatchCategory,
    applyBatchResults,
    runBatch,
    ...selection,
    runBatchForSelected,
  };
}

export function createAppImageWorkspaceRuntime({
  api,
  message,
  refs = {},
  readers = {},
  helpers = {},
  reactive,
  ref,
  computed,
} = {}) {
  const imageState = createImageStateAccessRuntime({
    refs: { project: refs.project, category: refs.category },
  });
  const fileHandlers = createElementFileRuntime({
    api,
    message,
    readers: {
      firstImageFile: readers.firstImageFile || defaultFirstImageFile,
      firstAudioFile: readers.firstAudioFile || defaultFirstAudioFile,
      readImageAsPngB64: readers.readImageAsPngB64,
    },
  });
  const recheckImageSlot = createRecheckImageSlotRuntime({
    api,
    message,
    helpers: { imageStatusBody: imageState.imageStatusBody },
  });
  const syncImageSlot = createSyncImageSlotRuntime({
    api,
    message,
    helpers: { imageStatusBody: imageState.imageStatusBody },
  });
  const markImageFailed = createImageStateAccessRuntime({
    refs: { project: refs.project, category: refs.category },
    helpers: { recheckImageSlot },
  }).markImageFailed;
  const {
    prepareGeneration: prepareBatchGenerationState,
    clearGeneration: clearBatchGenerationState,
  } = createBatchGenerationStateRuntime({
    refs: { project: refs.project },
    helpers: { setImageGenerating: setImageGeneratingState },
  });
  const mediaActions = createElementMediaActionsRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      category: refs.category,
      ratio: refs.ratio,
      imageMode: refs.imageMode,
    },
    readers: { readFileAsB64: readers.readFileAsB64 },
    fileHandlers,
    helpers: {
      nextTick: helpers.nextTick,
      syncImage: syncImageSlot,
      createElementSaveBody: helpers.createElementSaveBody,
      createSavePromptDialog: helpers.createSavePromptDialog,
    },
  });
  const batchState = createImageBatchUiStateRuntime({
    reactive,
    ref,
    computed,
    helpers: { progressByRatio: helpers.progressByRatio },
  });
  const batchActions = createImageBatchActionsRuntime({
    api,
    message,
    refs: {
      batch: batchState.batch,
      batchCategory: batchState.batchCategory,
      selectedElements: batchState.selectedElements,
      project: refs.project,
      category: refs.category,
      imageRatio: refs.ratio,
      characterImageMode: refs.imageMode,
      selectionMode: batchState.selectionMode,
    },
    helpers: {
      setImageGenerating: setImageGeneratingState,
      prepareGeneration: prepareBatchGenerationState,
      clearGeneration: clearBatchGenerationState,
      startProgressTracking: helpers.startProgressTracking,
      updateProgressTracking: helpers.updateProgressTracking,
      stopProgressTracking: helpers.stopProgressTracking,
      formatElapsed: helpers.formatElapsed,
      nextTick: helpers.nextTick,
      createElementSelection: helpers.createElementSelection,
    },
    computed,
  });

  return {
    ...imageState,
    ...fileHandlers,
    recheckImageSlot,
    syncImageSlot,
    markImageFailed,
    prepareBatchGenerationState,
    clearBatchGenerationState,
    ...mediaActions,
    ...batchState,
    ...batchActions,
  };
}

function applySavedElementState(element, saved = {}) {
  if (saved.prompt !== undefined) element.prompt = saved.prompt;
  if (saved.promptParts) element.promptParts = saved.promptParts;
  if (saved.partsEdited) element.partsEdited = saved.partsEdited;
  if (Array.isArray(saved.aliases)) {
    element.aliases = saved.aliases;
    element.aliasesText = saved.aliases.join(',');
    if (element.source && typeof element.source === 'object') element.source.aliases = saved.aliases;
  }
  if (saved.referenceImageName !== undefined) element.referenceImageName = saved.referenceImageName || element.referenceImageName;
  if (saved.useReferenceImage !== undefined) element.useReferenceImage = !!saved.useReferenceImage;
  if (saved.hasReferenceImage !== undefined) element.hasReferenceImage = !!saved.hasReferenceImage;
}

function applySavedVariantState(variant, saved = {}) {
  if (!saved.variant) return;
  variant.name = saved.variant.name;
  variant.desc = saved.variant.desc;
  variant.identity = saved.variant.identity;
  variant.appearance = saved.variant.appearance;
  variant.body = saved.variant.body;
  variant.hair = saved.variant.hair;
  variant.clothing = saved.variant.clothing;
  variant.clothingReferenceOutfitName = saved.variant.clothingReferenceOutfitName || '';
  variant.clothingReferenceImageRole = saved.variant.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit';
  variant.clothingReferenceOutfitImageName = saved.variant.clothingReferenceOutfitImageName || variant.clothingReferenceImageName || '';
  variant.clothingReferencePatternImageName = saved.variant.clothingReferencePatternImageName || variant.logoReferenceImageName || '';
  variant.logoReferenceImageName = variant.clothingReferencePatternImageName;
  variant.makeupAccessories = saved.variant.makeupAccessories;
  variant.traits = saved.variant.traits;
  variant.prompt = saved.variant.prompt;
  variant.promptEdited = !!saved.variant.promptEdited;
}

function variantSavePayload(projectId, charIndex, variant, variantIndex) {
  return {
    projectId,
    charIndex,
    variantIndex,
    name: variant.name.trim(),
    desc: variant.desc,
    identity: variant.identity,
    appearance: variant.appearance,
    body: variant.body,
    hair: variant.hair,
    clothing: variant.clothing,
    clothingReferenceOutfitName: variant.clothingReferenceOutfitName || '',
    clothingReferenceImageRole: variant.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit',
    clothingReferenceOutfitImageName: variant.clothingReferenceOutfitImageName || variant.clothingReferenceImageName || '',
    clothingReferencePatternImageName: variant.clothingReferencePatternImageName || variant.logoReferenceImageName || '',
    makeupAccessories: variant.makeupAccessories,
    traits: variant.traits,
    prompt: variant.prompt,
    promptEdited: !!variant.promptEdited,
  };
}

function applySavedOutfitState(outfit, saved = {}) {
  if (!saved.outfit) return;
  outfit.name = saved.outfit.name;
  outfit.desc = saved.outfit.desc;
  outfit.prompt = saved.outfit.prompt;
  outfit.promptEdited = !!saved.outfit.promptEdited;
}

function outfitSavePayload(projectId, charIndex, outfit, outfitIndex) {
  return {
    projectId,
    charIndex,
    outfitIndex,
    name: outfit.name.trim(),
    desc: outfit.desc,
    prompt: outfit.prompt,
    promptEdited: !!outfit.promptEdited,
  };
}

export function setImageGeneratingState(item, generating) {
  if (item) item._gen = !!generating;
}

export function markImageSlotGenerated(slot) {
  if (!slot) return;
  slot.hasImage = true;
  slot._imageName = slot.name?.trim?.() || slot._imageName || '';
  slot._imgBroken = false;
  slot._imgReload = 0;
  slot.hasPendingImage = false;
  slot._v = (slot._v || 0) + 1;
  slot._gen = false;
}

export function markImageSlotPending(slot) {
  if (!slot) return;
  slot.hasImage = false;
  slot.hasPendingImage = true;
  slot._imgBroken = false;
  slot._imgReload = 0;
  slot._gen = false;
}

function imageSlotName(item) {
  return String(item?._imageName || item?.name || '').trim();
}

function findIndexedImageSlot(list, index, name) {
  const items = Array.isArray(list) ? list : [];
  const expectedName = String(name || '').trim();
  const indexed = Number.isInteger(index) ? items[index] : null;
  if (indexed && (!expectedName || imageSlotName(indexed) === expectedName)) return indexed;
  return expectedName ? items.find((item) => imageSlotName(item) === expectedName) || null : null;
}

export function findLiveImageSlot(project, target = {}) {
  if (!project || (target.projectId && String(project.id) !== String(target.projectId))) return null;
  const elements = project.elements || {};
  if (target.kind === 'variant' || target.kind === 'outfit') {
    const character = findIndexedImageSlot(elements.character, target.charIndex, target.characterName);
    if (!character) return null;
    const list = target.kind === 'variant' ? character.variants : character.outfits;
    const index = target.kind === 'variant' ? target.variantIndex : target.outfitIndex;
    return findIndexedImageSlot(list, index, target.name);
  }
  if (target.kind === 'sceneArea') {
    const scene = findIndexedImageSlot(elements.scene, target.sceneIndex, target.sceneName);
    return scene ? findIndexedImageSlot(scene.areas, target.areaIndex, target.name) : null;
  }
  return findIndexedImageSlot(elements[target.category], target.index, target.name);
}

export function resolveShotElementImageTarget(project, tag) {
  if (!project || !tag) return null;
  const elements = project.elements || {};
  const category = String(tag.cat || '').trim();
  const assetKind = String(tag.assetKind || '').trim() || 'main';
  const tagName = String(tag.name || '').trim();
  const imageBase = String(tag.imageBase || '').trim();
  const findIndex = (list, predicate) => (Array.isArray(list) ? list.findIndex(predicate) : -1);

  if (assetKind === 'variant' || assetKind === 'outfit') {
    const characters = Array.isArray(elements.character) ? elements.character : [];
    const ownerName = String(tag.ownerName || '').trim();
    const charIndex = findIndex(characters, (character) => imageSlotName(character) === ownerName);
    if (charIndex < 0) return null;
    const character = characters[charIndex];
    const list = assetKind === 'variant' ? character.variants : character.outfits;
    const nestedIndex = findIndex(list, (item) => {
      const itemName = imageSlotName(item);
      const qualifiedName = assetKind === 'variant'
        ? `${ownerName}·${itemName}`
        : `${ownerName}·服饰·${itemName}`;
      const expectedImageBase = assetKind === 'variant'
        ? `${ownerName}_形态_${itemName}`
        : `${ownerName}_${itemName}`;
      return itemName === String(tag.matchName || '').trim()
        || qualifiedName === tagName
        || expectedImageBase === imageBase;
    });
    if (nestedIndex < 0) return null;
    return assetKind === 'variant'
      ? { kind: 'variant', character, charIndex, element: list[nestedIndex], variantIndex: nestedIndex }
      : { kind: 'outfit', character, charIndex, element: list[nestedIndex], outfitIndex: nestedIndex };
  }

  if (assetKind === 'sceneArea') {
    const scenes = Array.isArray(elements.scene) ? elements.scene : [];
    const ownerName = String(tag.ownerName || '').trim();
    const sceneIndex = findIndex(scenes, (scene) => imageSlotName(scene) === ownerName);
    if (sceneIndex < 0) return null;
    const scene = scenes[sceneIndex];
    const areaIndex = findIndex(scene.areas, (area) => {
      const areaName = imageSlotName(area);
      return areaName === String(tag.matchName || '').trim()
        || `${ownerName}·区域·${areaName}` === tagName
        || `${ownerName}_${areaName}` === imageBase;
    });
    if (areaIndex < 0) return null;
    return { kind: 'sceneArea', scene, sceneIndex, element: scene.areas[areaIndex], areaIndex };
  }

  const list = elements[category];
  const index = findIndex(list, (item) => imageSlotName(item) === tagName || imageSlotName(item) === imageBase);
  if (index < 0) return null;
  return { kind: 'main', category, element: list[index], index };
}

export function createShotElementImageRegenerator({ project, generators = {}, message = {} } = {}) {
  const getProject = typeof project === 'function' ? project : () => project;
  return (tag) => {
    const target = resolveShotElementImageTarget(getProject(), tag);
    if (!target) {
      message.warning?.('当前元素已不存在，请重新绑定本镜元素');
      return null;
    }
    if (target.element?._gen) return null;
    if (target.kind === 'variant') return generators.variant?.(target.character, target.charIndex, target.element, target.variantIndex);
    if (target.kind === 'outfit') return generators.outfit?.(target.character, target.charIndex, target.element, target.outfitIndex);
    if (target.kind === 'sceneArea') return generators.sceneArea?.(target.scene, target.sceneIndex, target.element, target.areaIndex);
    return generators.main?.(target.element, target.index, { category: target.category });
  };
}

export function applyImageSlotMutation(slot, target, handlers = {}, mutation = () => {}) {
  if (slot) mutation(slot);
  const live = handlers.resolveImageSlot?.(target);
  if (live && live !== slot) mutation(live);
  return live || slot || null;
}

export function applyImageSlotStatus(item, status, options = {}) {
  if (!item || !status) return;
  item.hasPendingImage = !!status.hasPendingImage;
  if (status.hasImage) {
    if (!options.preserveExistingImage) markImageSlotGenerated(item);
    else item.hasImage = true;
  } else if (status.hasPendingImage) {
    markImageSlotPending(item);
  } else {
    item.hasImage = false;
    item._imgBroken = false;
    item._imgReload = 0;
  }
}

export async function syncImageSlotFlow(item, options = {}, handlers = {}) {
  const body = handlers.imageStatusBody(item, options);
  if (!body || item._syncing) return null;
  item._syncing = true;
  try {
    const result = await handlers.syncImageStatus({ ...body, sync: true });
    if (result.ok && result.hasImage) {
      handlers.applyGeneratedImageSlot(item);
      handlers.success('图片已同步到本地');
    } else {
      handlers.applyImageStatus(item, result);
      if (!options.silent) handlers.warning(result.error || '暂时同步不到图片，稍后再试');
    }
    return result;
  } catch (error) {
    if (!options.silent) handlers.error(error.message || '图片同步失败');
    return null;
  } finally {
    item._syncing = false;
  }
}

export function createSyncImageSlotRuntime({ api, message, helpers = {} } = {}) {
  const context = {
    imageStatusBody: helpers.imageStatusBody,
    syncImageStatus: (payload) => api.post('/api/image/status', payload),
    applyGeneratedImageSlot: markImageSlotGenerated,
    applyImageStatus: applyImageSlotStatus,
    success: message.success,
    warning: message.warning,
    error: message.error,
  };
  return (item, options = {}) => syncImageSlotFlow(item, options, context);
}

export async function recheckImageSlotFlow(item, options = {}, handlers = {}) {
  const body = handlers.imageStatusBody(item, options);
  if (!body || item._statusChecking) return null;
  item._statusChecking = true;
  try {
    const result = await handlers.checkImageStatus(body);
    if (result.ok) handlers.applyImageStatus(item, result, options);
    return result;
  } catch (error) {
    if (!options.silent) handlers.error(error.message || '图片状态检查失败');
    return null;
  } finally {
    item._statusChecking = false;
  }
}

export function createRecheckImageSlotRuntime({ api, message, helpers = {} } = {}) {
  const context = {
    imageStatusBody: helpers.imageStatusBody,
    checkImageStatus: (payload) => api.post('/api/image/status', payload),
    applyImageStatus: applyImageSlotStatus,
    error: message.error,
  };
  return (item, options = {}) => recheckImageSlotFlow(item, options, context);
}

// 单张出图接口已改为异步任务（立即返回 jobId），避免长连接占满浏览器并发额度、
// 把画廊里 /img/ 图片请求全部堵住。这里轮询任务直到拿到真正的出图结果。
async function resolveSingleImageJobResult(submitted, handlers = {}) {
  if (!submitted?.async || !submitted.jobId) return submitted; // 兼容旧后端的同步返回
  const status = await pollJobUntilDone({
    fetchStatus: () => handlers.jobStatus(submitted.jobId),
    isDone: (s) => s.status === 'done',
    getProgress: (s) => s.done,
    intervalMs: 1500,
    stallMs: 16 * 60 * 1000, // 单张任务完成前 done 恒为 0，放宽到后端 15 分钟出图超时之上
  });
  return status.result || { ok: false, error: '任务结束但没有返回出图结果' };
}

export async function generateElementImageFlow(element, index, handlers = {}, options = {}) {
  if (element._gen) return;
  const target = {
    kind: 'main',
    projectId: handlers.projectId(),
    category: options.category || handlers.category(),
    index,
    name: imageSlotName(element),
  };
  handlers.setGenerating(element, target, true);
  await handlers.nextTick();
  try {
    const saved = await handlers.saveElement(element, index, target);
    applySavedElementState(element, saved);
    target.name = imageSlotName(element);
    const submitted = await handlers.generateImage({
      projectId: target.projectId,
      category: target.category,
      index,
      ratio: handlers.ratio(),
      imageMode: handlers.imageMode(),
    });
    const result = await resolveSingleImageJobResult(submitted, handlers);
    if (result.ok) {
      handlers.applyGenerated(element, target);
      handlers.success('出图成功');
    } else if (result.hasPendingImage || result.pendingSync) {
      const current = handlers.applyPending(element, target);
      handlers.warning('中转站已出图，正在同步到本地');
      await handlers.syncImage(current, { category: target.category, index, silent: true });
    } else {
      handlers.error(`出图失败：${result.error}`);
    }
  } catch (error) {
    handlers.error(`出图失败：${error.message}`);
  } finally {
    handlers.setGenerating(element, target, false);
  }
}

export function createImageGenerationBaseRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const resolveImageSlot = (target) => findLiveImageSlot(refs.project.value, target);
  const mutate = (slot, target, mutation) => applyImageSlotMutation(slot, target, { resolveImageSlot }, mutation);
  return {
    ...message,
    nextTick: helpers.nextTick,
    projectId: () => refs.project.value.id,
    ratio: () => refs.ratio.value,
    imageMode: () => refs.imageMode?.value,
    resolveImageSlot,
    applyGenerated: (slot, target) => mutate(slot, target, markImageSlotGenerated),
    applyPending: (slot, target) => mutate(slot, target, markImageSlotPending),
    setGenerating: (slot, target, generating) => mutate(slot, target, (item) => setImageGeneratingState(item, generating)),
    syncImage: helpers.syncImage,
    jobStatus: (jobId) => api.get(`/api/image/batch/status?jobId=${jobId}`),
  };
}

export function createGenerateElementImageRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...createImageGenerationBaseRuntime({ api, message, refs, helpers }),
    saveElement: (element, itemIndex, target) => api.post(
      '/api/project/element',
      helpers.elementSaveBody(element, itemIndex, target.category, target.projectId),
    ),
    generateImage: (payload) => api.post('/api/image/generate', payload),
    category: () => refs.category.value,
  };
}

export function createGenerateElementImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = createGenerateElementImageRuntimeContext({ api, message, refs, helpers });
  return (element, index, options = {}) => generateElementImageFlow(element, index, context, options);
}

export async function uploadElementImageFlow(element, index, file, handlers = {}) {
  if (!file || element._uploading) return;
  element._uploading = true;
  try {
    await handlers.saveElement(element, index);
    const result = await handlers.uploadImage(file, {
      projectId: handlers.projectId(),
      category: handlers.category(),
      index,
    });
    if (!result.ok) return handlers.error(result.error || '上传失败');
    markImageSlotGenerated(element);
    handlers.success('图片已上传');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    element._uploading = false;
  }
}

export function createUploadElementImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = {
    ...createImageGenerationBaseRuntime({ api, message, refs, helpers }),
    saveElement: (element, itemIndex) => api.post('/api/project/element', helpers.elementSaveBody(element, itemIndex)),
    uploadImage: helpers.uploadImage,
    category: () => refs.category.value,
  };
  return (element, index, file) => uploadElementImageFlow(element, index, file, context);
}

export async function saveVariantFlow(character, charIndex, variant, variantIndex, handlers = {}) {
  const result = await handlers.saveVariant(variantSavePayload(handlers.projectId(), charIndex, variant, variantIndex));
  if (result.ok) {
    applySavedVariantState(variant, result);
    character.primaryLook = result.primaryLook || null;
    variant._imageName = variant.name.trim();
    variant._imgBroken = false;
    variant._imgReload = 0;
    if (variant.hasImage) variant._v = (variant._v || 0) + 1;
    handlers.success('已保存');
    return true;
  }
  handlers.error(result.error || '保存失败');
  return false;
}

export function createSaveVariantRuntime({ api, message, refs = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    saveVariant: (payload) => api.post('/api/project/variant', payload),
    success: message.success,
    error: message.error,
  };
  return (character, charIndex, variant, variantIndex) => saveVariantFlow(character, charIndex, variant, variantIndex, context);
}

export async function uploadVariantImageFlow(character, charIndex, variant, variantIndex, file, handlers = {}) {
  if (!file || variant._uploading) return;
  variant._uploading = true;
  try {
    await handlers.saveVariant(character, charIndex, variant, variantIndex);
    const result = await handlers.uploadImage(file, {
      projectId: handlers.projectId(),
      charIndex,
      variantIndex,
    });
    if (!result.ok) return handlers.error(result.error || '上传失败');
    markImageSlotGenerated(variant);
    handlers.success('造型图已上传');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    variant._uploading = false;
  }
}

export async function uploadVariantClothingReferenceFlow(character, charIndex, variant, variantIndex, referenceType, file, handlers = {}) {
  const isPattern = referenceType === 'pattern';
  const busyKey = isPattern ? '_logoReferenceUploading' : '_clothingReferenceUploading';
  const legacyPatternReference = !!variant.hasLogoReferenceImage && !variant.hasClothingReferenceImage;
  if (!file || variant[busyKey]) return;
  variant[busyKey] = true;
  try {
    if (handlers.saveVariant) await handlers.saveVariant(character, charIndex, variant, variantIndex);
    const result = await handlers.uploadImage(file, {
      projectId: handlers.projectId(),
      charIndex,
      variantIndex,
      referenceType: isPattern ? 'pattern' : 'outfit',
      legacyPatternReference,
    });
    if (!result.ok) return handlers.error(result.error || '服装参考上传失败');
    if (isPattern) {
      variant.hasLogoReferenceImage = true;
      variant.clothingReferencePatternImageName = result.clothingReferenceImageName || variant.clothingReferencePatternImageName;
      variant.logoReferenceImageName = variant.clothingReferencePatternImageName;
      variant._logoReferenceV = (variant._logoReferenceV || 0) + 1;
      handlers.success('Logo参考图已上传');
    } else {
      variant.hasClothingReferenceImage = true;
      variant.clothingReferenceImageName = result.clothingReferenceImageName || variant.clothingReferenceImageName;
      variant.clothingReferenceOutfitImageName = variant.clothingReferenceImageName;
      variant._clothingReferenceV = (variant._clothingReferenceV || 0) + 1;
      handlers.success('服饰参考图已上传');
    }
  } catch (error) {
    handlers.error(error.message);
  } finally {
    variant[busyKey] = false;
  }
}

export async function deleteVariantClothingReferenceFlow(variant, referenceType, handlers = {}) {
  const isPattern = referenceType === 'pattern';
  const busyKey = isPattern ? '_logoReferenceDeleting' : '_clothingReferenceDeleting';
  if (!variant || variant[busyKey]) return;
  variant[busyKey] = true;
  try {
    const result = await handlers.deleteImage({
      projectId: handlers.projectId(),
      charIndex: handlers.charIndex(),
      variantIndex: handlers.variantIndex(),
      referenceType: isPattern ? 'pattern' : 'outfit',
    });
    if (!result.ok) return handlers.error(result.error || '服装参考删除失败');
    if (isPattern) {
      variant.hasLogoReferenceImage = false;
      variant._logoReferenceV = (variant._logoReferenceV || 0) + 1;
      handlers.success('已移除Logo参考图');
    } else {
      variant.hasClothingReferenceImage = false;
      variant._clothingReferenceV = (variant._clothingReferenceV || 0) + 1;
      handlers.success('已移除服饰参考图');
    }
  } catch (error) {
    handlers.error(error.message);
  } finally {
    variant[busyKey] = false;
  }
}

export function createUploadVariantClothingReferenceRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return (character, charIndex, variant, variantIndex, referenceType, file) => uploadVariantClothingReferenceFlow(character, charIndex, variant, variantIndex, referenceType, file, {
    projectId: () => refs.project.value.id,
    saveVariant: helpers.saveVariant,
    uploadImage: (imageFile, body) => helpers.uploadImage(imageFile, '/api/image/variant-clothing-reference/upload', body),
    success: message.success,
    error: message.error,
  });
}

export function createDeleteVariantClothingReferenceRuntime({ api, message, refs = {} } = {}) {
  return (variant, charIndex, variantIndex, referenceType) => deleteVariantClothingReferenceFlow(variant, referenceType, {
    projectId: () => refs.project.value.id,
    charIndex: () => charIndex,
    variantIndex: () => variantIndex,
    deleteImage: (payload) => api.post('/api/image/variant-clothing-reference/delete', payload),
    success: message.success,
    error: message.error,
  });
}

export function createUploadVariantImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    saveVariant: helpers.saveVariant,
    uploadImage: (imageFile, body) => helpers.uploadImage(imageFile, '/api/image/variant/upload', body),
    success: message.success,
    error: message.error,
  };
  return (character, charIndex, variant, variantIndex, file) => uploadVariantImageFlow(character, charIndex, variant, variantIndex, file, context);
}

export async function saveOutfitFlow(character, charIndex, outfit, outfitIndex, handlers = {}) {
  const result = await handlers.saveOutfit(outfitSavePayload(handlers.projectId(), charIndex, outfit, outfitIndex));
  if (result.ok) {
    applySavedOutfitState(outfit, result);
    character.primaryLook = result.primaryLook || null;
    outfit._imageName = outfit.name.trim();
    outfit._imgBroken = false;
    outfit._imgReload = 0;
    if (outfit.hasImage) outfit._v = (outfit._v || 0) + 1;
    handlers.success('已保存');
    return true;
  }
  handlers.error(result.error || '保存失败');
  return false;
}

export function createSaveOutfitRuntime({ api, message, refs = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    saveOutfit: (payload) => api.post('/api/project/outfit', payload),
    success: message.success,
    error: message.error,
  };
  return (character, charIndex, outfit, outfitIndex) => saveOutfitFlow(character, charIndex, outfit, outfitIndex, context);
}

export async function saveSceneAreaFlow(scene, sceneIndex, area, areaIndex, handlers = {}) {
  const previousName = String(area?._imageName || area?.name || '').trim();
  const result = await handlers.saveSceneArea(sceneAreaSavePayload(handlers.projectId(), sceneIndex, area, areaIndex));
  if (result.ok) {
    applySavedSceneAreaState(area, result);
    const nextName = String(area.name || '').trim();
    if (previousName && nextName && previousName !== nextName) {
      handlers.renameAreaRefs(handlers.project(), scene.name, previousName, nextName);
    }
    area._imageName = area.name.trim();
    area._imgBroken = false;
    area._imgReload = 0;
    if (area.hasImage) area._v = (area._v || 0) + 1;
    handlers.success('已保存');
    return true;
  }
  handlers.error(result.error || '保存失败');
  return false;
}

export function createSaveSceneAreaRuntime({ api, message, refs = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    project: () => refs.project.value,
    saveSceneArea: (payload) => api.post('/api/project/scene-area', payload),
    renameAreaRefs: renameStoryboardSceneAreaRefs,
    success: message.success,
    error: message.error,
  };
  return (scene, sceneIndex, area, areaIndex) => saveSceneAreaFlow(scene, sceneIndex, area, areaIndex, context);
}

export async function uploadOutfitImageFlow(character, charIndex, outfit, outfitIndex, file, handlers = {}) {
  if (!file || outfit._uploading) return;
  outfit._uploading = true;
  try {
    await handlers.saveOutfit(character, charIndex, outfit, outfitIndex);
    const result = await handlers.uploadImage(file, {
      projectId: handlers.projectId(),
      charIndex,
      outfitIndex,
    });
    if (!result.ok) return handlers.error(result.error || '上传失败');
    markImageSlotGenerated(outfit);
    handlers.success('造型图已上传');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    outfit._uploading = false;
  }
}

export function createUploadOutfitImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    saveOutfit: helpers.saveOutfit,
    uploadImage: (imageFile, body) => helpers.uploadImage(imageFile, '/api/image/outfit/upload', body),
    success: message.success,
    error: message.error,
  };
  return (character, charIndex, outfit, outfitIndex, file) => uploadOutfitImageFlow(character, charIndex, outfit, outfitIndex, file, context);
}

export async function uploadSceneAreaImageFlow(scene, sceneIndex, area, areaIndex, file, handlers = {}) {
  if (!file || area._uploading) return;
  area._uploading = true;
  try {
    await handlers.saveSceneArea(scene, sceneIndex, area, areaIndex);
    const result = await handlers.uploadImage(file, {
      projectId: handlers.projectId(),
      sceneIndex,
      areaIndex,
    });
    if (!result.ok) return handlers.error(result.error || '上传失败');
    markImageSlotGenerated(area);
    handlers.success('子区域图已上传');
  } catch (error) {
    handlers.error(error.message);
  } finally {
    area._uploading = false;
  }
}

export function createUploadSceneAreaImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = {
    projectId: () => refs.project.value.id,
    saveSceneArea: helpers.saveSceneArea,
    uploadImage: (imageFile, body) => helpers.uploadImage(imageFile, '/api/image/scene-area/upload', body),
    success: message.success,
    error: message.error,
  };
  return (scene, sceneIndex, area, areaIndex, file) => uploadSceneAreaImageFlow(scene, sceneIndex, area, areaIndex, file, context);
}

export async function savePromptDialogFlow(promptDialog, handlers = {}) {
  if (promptDialog.saving) return;
  promptDialog.saving = true;
  try {
    let ok = false;
    if (promptDialog.type === 'character') {
      promptDialog.el.prompt = promptDialog.draftPrompt;
      ok = await handlers.saveElement(promptDialog.el, promptDialog.index);
    } else if (promptDialog.type === 'element') {
      promptDialog.el.prompt = promptDialog.draftPrompt;
      ok = await handlers.saveElement(promptDialog.el, promptDialog.index);
    } else if (promptDialog.type === 'variant') {
      promptDialog.variant.prompt = promptDialog.draftPrompt;
      promptDialog.variant.promptEdited = true;
      ok = await handlers.saveVariant(promptDialog.ch, promptDialog.charIndex, promptDialog.variant, promptDialog.variantIndex);
    } else if (promptDialog.type === 'outfit') {
      promptDialog.outfit.prompt = promptDialog.draftPrompt;
      promptDialog.outfit.promptEdited = true;
      ok = await handlers.saveOutfit(promptDialog.ch, promptDialog.charIndex, promptDialog.outfit, promptDialog.outfitIndex);
    }
    if (ok) handlers.close();
  } finally {
    promptDialog.saving = false;
  }
}

export function createSavePromptDialogRuntime({ state = {}, helpers = {} } = {}) {
  const context = {
    saveElement: helpers.saveElement,
    saveVariant: helpers.saveVariant,
    saveOutfit: helpers.saveOutfit,
    close: helpers.close,
  };
  return () => savePromptDialogFlow(state.promptDialog, context);
}

export async function generateVariantImageFlow(character, charIndex, variant, variantIndex, handlers = {}) {
  if (variant._gen) return;
  const target = {
    kind: 'variant',
    projectId: handlers.projectId(),
    charIndex,
    characterName: imageSlotName(character),
    variantIndex,
    name: imageSlotName(variant),
  };
  handlers.setGenerating(variant, target, true);
  await handlers.nextTick();
  try {
    const saved = await handlers.saveVariant(variantSavePayload(target.projectId, charIndex, variant, variantIndex));
    applySavedVariantState(variant, saved);
    character.primaryLook = saved.primaryLook || null;
    target.name = imageSlotName(variant);
    const submitted = await handlers.generateVariant({
      projectId: target.projectId,
      charIndex,
      variantIndex,
      ratio: handlers.ratio(),
      imageMode: handlers.imageMode(),
    });
    const result = await resolveSingleImageJobResult(submitted, handlers);
    if (result.ok) {
      handlers.applyGenerated(variant, target);
      handlers.success('造型出图成功');
    } else if (result.hasPendingImage || result.pendingSync) {
      const current = handlers.applyPending(variant, target);
      handlers.warning('中转站已出图，正在同步到本地');
      await handlers.syncImage(current, { kind: 'variant', charIndex, variantIndex, silent: true });
    } else if (result.needMain) {
      handlers.warning(result.error);
    } else {
      handlers.error(`出图失败：${result.error}`);
    }
  } catch (error) {
    handlers.error(`出图失败：${error.message}`);
  } finally {
    handlers.setGenerating(variant, target, false);
  }
}

export function createGenerateVariantImageRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...createImageGenerationBaseRuntime({ api, message, refs, helpers }),
    saveVariant: (payload) => api.post('/api/project/variant', payload),
    generateVariant: (payload) => api.post('/api/image/variant', payload),
  };
}

export function createGenerateVariantImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = createGenerateVariantImageRuntimeContext({ api, message, refs, helpers });
  return (character, charIndex, variant, variantIndex) => generateVariantImageFlow(character, charIndex, variant, variantIndex, context);
}

export async function generateOutfitImageFlow(character, charIndex, outfit, outfitIndex, handlers = {}) {
  if (outfit._gen) return;
  const target = {
    kind: 'outfit',
    projectId: handlers.projectId(),
    charIndex,
    characterName: imageSlotName(character),
    outfitIndex,
    name: imageSlotName(outfit),
  };
  handlers.setGenerating(outfit, target, true);
  await handlers.nextTick();
  try {
    const saved = await handlers.saveOutfit(outfitSavePayload(target.projectId, charIndex, outfit, outfitIndex));
    applySavedOutfitState(outfit, saved);
    character.primaryLook = saved.primaryLook || null;
    target.name = imageSlotName(outfit);
    const submitted = await handlers.generateOutfit({
      projectId: target.projectId,
      charIndex,
      outfitIndex,
      ratio: handlers.ratio(),
    });
    const result = await resolveSingleImageJobResult(submitted, handlers);
    if (result.ok) {
      handlers.applyGenerated(outfit, target);
      handlers.success('造型出图成功');
    } else if (result.hasPendingImage || result.pendingSync) {
      const current = handlers.applyPending(outfit, target);
      handlers.warning('中转站已出图，正在同步到本地');
      await handlers.syncImage(current, { kind: 'outfit', charIndex, outfitIndex, silent: true });
    } else if (result.needMain) {
      handlers.warning(result.error);
    } else {
      handlers.error(`出图失败：${result.error}`);
    }
  } catch (error) {
    handlers.error(`出图失败：${error.message}`);
  } finally {
    handlers.setGenerating(outfit, target, false);
  }
}

export function createGenerateOutfitImageRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...createImageGenerationBaseRuntime({ api, message, refs, helpers }),
    saveOutfit: (payload) => api.post('/api/project/outfit', payload),
    generateOutfit: (payload) => api.post('/api/image/outfit', payload),
  };
}

function applySavedSceneAreaState(area, saved = {}) {
  if (!saved.area) return;
  area.name = saved.area.name;
  area.desc = saved.area.desc;
  area.prompt = saved.area.prompt;
  area.promptEdited = !!saved.area.promptEdited;
}

function sceneAreaSavePayload(projectId, sceneIndex, area, areaIndex) {
  return {
    projectId,
    sceneIndex,
    areaIndex,
    name: area.name.trim(),
    desc: area.desc,
    prompt: area.prompt,
    promptEdited: !!area.promptEdited,
  };
}

// 子区域出图：先存字段，再以主场景图作参考图生成（与换装同一套流程）
export async function generateSceneAreaImageFlow(scene, sceneIndex, area, areaIndex, handlers = {}) {
  if (area._gen) return;
  const target = {
    kind: 'sceneArea',
    projectId: handlers.projectId(),
    sceneIndex,
    sceneName: imageSlotName(scene),
    areaIndex,
    name: imageSlotName(area),
  };
  handlers.setGenerating(area, target, true);
  await handlers.nextTick();
  try {
    const saved = await handlers.saveSceneArea(sceneAreaSavePayload(target.projectId, sceneIndex, area, areaIndex));
    applySavedSceneAreaState(area, saved);
    target.name = imageSlotName(area);
    const submitted = await handlers.generateSceneArea({
      projectId: target.projectId,
      sceneIndex,
      areaIndex,
      ratio: handlers.ratio(),
    });
    const result = await resolveSingleImageJobResult(submitted, handlers);
    if (result.ok) {
      handlers.applyGenerated(area, target);
      handlers.success('子区域出图成功');
    } else if (result.hasPendingImage || result.pendingSync) {
      const current = handlers.applyPending(area, target);
      handlers.warning('中转站已出图，正在同步到本地');
      await handlers.syncImage(current, { kind: 'sceneArea', sceneIndex, areaIndex, silent: true });
    } else if (result.needMain) {
      handlers.warning(result.error);
    } else {
      handlers.error(`出图失败：${result.error}`);
    }
  } catch (error) {
    handlers.error(`出图失败：${error.message}`);
  } finally {
    handlers.setGenerating(area, target, false);
  }
}

export function createGenerateSceneAreaImageRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...createImageGenerationBaseRuntime({ api, message, refs, helpers }),
    saveSceneArea: (payload) => api.post('/api/project/scene-area', payload),
    generateSceneArea: (payload) => api.post('/api/image/scene-area', payload),
  };
}

export function createGenerateSceneAreaImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = createGenerateSceneAreaImageRuntimeContext({ api, message, refs, helpers });
  return (scene, sceneIndex, area, areaIndex) => generateSceneAreaImageFlow(scene, sceneIndex, area, areaIndex, context);
}

export function createGenerateOutfitImageRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = createGenerateOutfitImageRuntimeContext({ api, message, refs, helpers });
  return (character, charIndex, outfit, outfitIndex) => generateOutfitImageFlow(character, charIndex, outfit, outfitIndex, context);
}

export function findImageBatchTarget(project, result) {
  if (!project || !result) return null;
  const elements = project.elements || {};
  if (result.kind === 'main') {
    const list = elements[result.cat] || [];
    return list[result.index] || list.find((item) => item.name === result.name);
  }
  if (result.kind === 'sceneArea') return findSceneAreaBatchTarget(project, result);
  const characters = elements.character || [];
  const character = characters[result.charIndex] || characters.find((item) => item.name && result.imageName?.startsWith(`${item.name}_`));
  if (!character) return null;
  if (result.kind === 'variant') {
    return (character.variants || [])[result.variantIndex] || (character.variants || []).find((item) => item.name === result.name);
  }
  if (result.kind === 'outfit') {
    return (character.outfits || [])[result.outfitIndex] || (character.outfits || []).find((item) => item.name === result.name);
  }
  return null;
}

export function findSceneAreaBatchTarget(project, result) {
  const scenes = project?.elements?.scene || [];
  const scene = scenes[result?.sceneIndex]
    || scenes.find((item) => item.name && result?.imageName?.startsWith(`${item.name}_`));
  if (!scene) return null;
  const areas = scene.areas || [];
  return areas[result.areaIndex] || areas.find((item) => item.name === result.name);
}

export function setImageBatchGenerationState(project, category, onlyMissing, generating, setImageGenerating) {
  if (!project?.elements || typeof setImageGenerating !== 'function') return;
  const categories = category && category !== 'all' ? [category] : ['character', 'group', 'scene', 'prop', 'effect', 'creature'];
  for (const key of categories) {
    for (const element of project.elements[key] || []) {
      if (generating) {
        if (!onlyMissing || !element.hasImage) setImageGenerating(element, true);
      } else {
        setImageGenerating(element, false);
      }
      if (key === 'scene') {
        for (const area of element.areas || []) {
          if (generating) {
            if (!onlyMissing || !area.hasImage) setImageGenerating(area, true);
          } else {
            setImageGenerating(area, false);
          }
        }
      }
      if (key !== 'character') continue;
      for (const variant of element.variants || []) {
        if (generating) {
          if (!onlyMissing || !variant.hasImage) setImageGenerating(variant, true);
        } else {
          setImageGenerating(variant, false);
        }
      }
      for (const outfit of element.outfits || []) {
        if (generating) {
          if (!onlyMissing || !outfit.hasImage) setImageGenerating(outfit, true);
        } else {
          setImageGenerating(outfit, false);
        }
      }
    }
  }
}

export function prepareImageBatchGenerationState(project, category, onlyMissing, setImageGenerating) {
  setImageBatchGenerationState(project, category, onlyMissing, true, setImageGenerating);
}

export function clearImageBatchGenerationState(project, category, setImageGenerating) {
  setImageBatchGenerationState(project, category, false, false, setImageGenerating);
}

export function createBatchGenerationStateRuntime({ refs = {}, helpers = {} } = {}) {
  return {
    prepareGeneration: (category, onlyMissing) => prepareImageBatchGenerationState(
      refs.project.value,
      category,
      onlyMissing,
      helpers.setImageGenerating
    ),
    clearGeneration: (category) => clearImageBatchGenerationState(
      refs.project.value,
      category,
      helpers.setImageGenerating
    ),
  };
}

export function applyImageBatchResults(batch, project, results = [], handlers = {}) {
  for (let index = batch.appliedResults; index < results.length; index++) {
    const result = results[index];
    const target = findImageBatchTarget(project, result);
    if (!target) continue;
    if (result.ok) handlers.applyGenerated(target);
    else if (result.hasPendingImage || result.pendingSync) handlers.applyPending(target);
    else handlers.setGenerating(target, false);
  }
  batch.appliedResults = results.length;
}

export function createBatchResultRuntime({ refs = {}, helpers = {} } = {}) {
  return {
    currentCategory: () => {
      const value = refs.batchCategory.value;
      if (value === 'current') return refs.category.value;
      if (value === 'all') return null;
      return ['character', 'group', 'scene', 'prop', 'effect', 'creature'].includes(value) ? value : refs.category.value;
    },
    applyResults: (results = []) => applyImageBatchResults(refs.batch, refs.project.value, results, {
      applyGenerated: markImageSlotGenerated,
      applyPending: markImageSlotPending,
      setGenerating: helpers.setImageGenerating,
    }),
  };
}

function createImageBatchBaseContext(handlers = {}) {
  return {
    ...handlers.message,
    batch: handlers.batch,
    project: () => handlers.projectRef.value,
    status: (jobId) => handlers.api.get(`/api/image/batch/status?jobId=${jobId}`),
    ratio: () => handlers.imageRatioRef.value,
    imageMode: () => handlers.characterImageModeRef.value,
    prepareGeneration: handlers.prepareGeneration,
    clearGeneration: handlers.clearGeneration,
    applyResults: handlers.applyResults,
    nextTick: handlers.nextTick,
  };
}

export function createRunImageBatchContext(handlers = {}) {
  return {
    ...createImageBatchBaseContext(handlers),
    currentCategory: handlers.currentCategory,
    startBatch: (payload) => handlers.api.post('/api/image/batch', payload),
    startProgress: (total) => handlers.startProgressTracking('batch', total),
    updateProgress: (done) => handlers.updateProgressTracking('batch', done),
    stopProgress: () => handlers.stopProgressTracking('batch'),
    formatElapsed: handlers.formatElapsed,
  };
}

export function createRunImageBatchRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return createRunImageBatchContext({
    api,
    message,
    batch: refs.batch,
    projectRef: refs.project,
    currentCategory: helpers.currentCategory,
    imageRatioRef: refs.imageRatio,
    characterImageModeRef: refs.characterImageMode,
    prepareGeneration: helpers.prepareGeneration,
    clearGeneration: helpers.clearGeneration,
    applyResults: helpers.applyResults,
    startProgressTracking: helpers.startProgressTracking,
    updateProgressTracking: helpers.updateProgressTracking,
    stopProgressTracking: helpers.stopProgressTracking,
    formatElapsed: helpers.formatElapsed,
    nextTick: helpers.nextTick,
  });
}

export function createRunImageBatchRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return (onlyMissing = false) => runImageBatchFlow(
    onlyMissing,
    createRunImageBatchRuntimeContext({ api, message, refs, helpers })
  );
}

export function createRunSelectedImageBatchContext(handlers = {}) {
  return {
    ...createImageBatchBaseContext(handlers),
    selectedElements: handlers.selectedElements,
    startSelectedBatch: (payload) => handlers.api.post('/api/image/batch-selected', payload),
    finishSelection: () => {
      handlers.selectionModeRef.value = false;
      handlers.selectedElements.clear();
    },
  };
}

export function createRunSelectedImageBatchRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return createRunSelectedImageBatchContext({
    api,
    message,
    batch: refs.batch,
    selectedElements: refs.selectedElements,
    projectRef: refs.project,
    imageRatioRef: refs.imageRatio,
    characterImageModeRef: refs.characterImageMode,
    prepareGeneration: helpers.prepareGeneration,
    clearGeneration: helpers.clearGeneration,
    applyResults: helpers.applyResults,
    nextTick: helpers.nextTick,
    selectionModeRef: refs.selectionMode,
  });
}

export function createRunSelectedImageBatchRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return () => runSelectedImageBatchFlow(
    createRunSelectedImageBatchRuntimeContext({ api, message, refs, helpers })
  );
}

export async function runImageBatchFlow(onlyMissing = false, handlers = {}) {
  const { batch } = handlers;
  if (batch.running) return;
  const project = handlers.project();
  if (!project) return;
  const selectedCategory = handlers.currentCategory();
  const result = await handlers.startBatch({
    projectId: project.id,
    category: selectedCategory,
    onlyMissing,
    ratio: handlers.ratio(),
    imageMode: handlers.imageMode(),
  });
  if (result.error) return handlers.error(result.error);
  if (result.total === 0) return handlers.info('没有需要生成的图片');

  batch.running = true;
  batch.done = 0;
  batch.total = result.total;
  batch.failed = [];
  batch.category = selectedCategory || '';
  batch.appliedResults = 0;
  batch.estimatedTime = '';
  batch.startTime = Date.now();

  handlers.prepareGeneration(batch.category, onlyMissing);
  handlers.startProgress(result.total);
  await handlers.nextTick();

  try {
    const status = await pollJobUntilDone({
      fetchStatus: () => handlers.status(result.jobId),
      isDone: (s) => s.status === 'done',
      getProgress: (s) => s.done,
      onStatus: (s) => {
        batch.done = s.done;
        batch.total = s.total;
        batch.failed = s.failed || [];
        const timeInfo = handlers.updateProgress(s.done);
        batch.estimatedTime = timeInfo.estimatedText;
        handlers.applyResults(s.results || []);
      },
      intervalMs: 1000,
      // 群像等复杂图单张可能超过 10 分钟；并发批量时第一张完成前 done 恒为 0，
      // 默认 5 分钟停滞判死会在“站点后台已出图”时提前放弃轮询，画廊便再也收不到结果
      stallMs: 16 * 60 * 1000,
    });
    batch.done = status.done;
    batch.total = status.total;
    batch.failed = status.failed || [];
    handlers.applyResults(status.results || []);
    batch.running = false;
    handlers.stopProgress();
    handlers.clearGeneration(batch.category);
    const ok = status.done - (status.failed?.length || 0);
    const elapsed = Math.round((Date.now() - batch.startTime) / 1000);
    handlers.success(`批量完成：成功 ${ok} / ${status.total}，耗时 ${handlers.formatElapsed(elapsed)}`);
    return status;
  } catch (error) {
    batch.running = false;
    handlers.stopProgress();
    handlers.clearGeneration(batch.category);
    handlers.error(error.message || '批量出图状态获取失败');
    throw error;
  }
}

export async function runSelectedImageBatchFlow(handlers = {}) {
  const selectedElements = handlers.selectedElements;
  const { batch } = handlers;
  if (selectedElements.size === 0) {
    handlers.warning('请先选择要生成的元素');
    return;
  }
  if (batch.running) return;
  const project = handlers.project();
  if (!project) return;

  const selectedItems = [];
  for (const [key] of selectedElements) {
    const [category, indexStr] = key.split(':');
    const index = parseInt(indexStr);
    const element = project.elements?.[category]?.[index];
    if (element) {
      selectedItems.push({ category, index, name: element.name });
    }
  }

  const result = await handlers.startSelectedBatch({
    projectId: project.id,
    items: selectedItems,
    ratio: handlers.ratio(),
    imageMode: handlers.imageMode(),
  });

  if (result.error) return handlers.error(result.error);
  if (result.total === 0) return handlers.info('没有需要生成的图片');

  batch.running = true;
  batch.done = 0;
  batch.total = result.total;
  batch.failed = [];
  batch.category = '';
  batch.appliedResults = 0;

  handlers.prepareGeneration('', false);
  await handlers.nextTick();

  try {
    const status = await pollJobUntilDone({
      fetchStatus: () => handlers.status(result.jobId),
      isDone: (s) => s.status === 'done',
      getProgress: (s) => s.done,
      onStatus: (s) => {
        batch.done = s.done;
        batch.total = s.total;
        batch.failed = s.failed || [];
        handlers.applyResults(s.results || []);
      },
      intervalMs: 1000,
      // 同上：单张复杂图可能超过 10 分钟，放宽停滞判死到后端 15 分钟出图超时之上
      stallMs: 16 * 60 * 1000,
    });
    batch.done = status.done;
    batch.total = status.total;
    batch.failed = status.failed || [];
    handlers.applyResults(status.results || []);
    batch.running = false;
    handlers.clearGeneration('');
    const ok = status.done - (status.failed?.length || 0);
    handlers.success(`批量完成：成功 ${ok} / ${status.total}`);
    handlers.finishSelection();
    return status;
  } catch (error) {
    batch.running = false;
    handlers.clearGeneration('');
    handlers.error(error.message || '批量出图状态获取失败');
    throw error;
  }
}
