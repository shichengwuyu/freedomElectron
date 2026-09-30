export function hydrateProjectImageState(project, handlers = {}) {
  const p = project;
  if (!p.elements) p.elements = {};
  p.characterImageMode = handlers.isCharacterImageMode(p.characterImageMode) ? p.characterImageMode : 'double';
  for (const key of ['character', 'group', 'scene', 'prop', 'effect', 'creature']) {
    if (!Array.isArray(p.elements[key])) p.elements[key] = [];
  }
  p.globalReferenceImageName = p.globalReferenceImageName || '__全局风格参考图';
  p.useGlobalReferenceImage = !!p.useGlobalReferenceImage;
  p._globalRefBroken = false;
  p._globalRefV = p.hasGlobalReferenceImage ? 1 : 0;
  for (const category of Object.keys(p.elements || {})) {
    for (const element of p.elements[category] || []) {
      hydrateElementImageState(element);
      if (category === 'character') {
        handlers.ensureCharacterParts(element);
        handlers.normalizeCharacterAlias(element);
        element._assetPanels = Array.isArray(element._assetPanels) ? element._assetPanels : [];
        element._deletingAsset = false;
        element._switchingPrimary = false;
        element.referenceImageName = element.referenceImageName || `${element.name}_参考图`;
        element.referenceMode = element.referenceMode || (element.useReferenceImage ? 'character' : 'none');
        element.useReferenceImage = element.referenceMode !== 'none';
        element._refImgBroken = false;
        element._refV = element.hasReferenceImage ? 1 : 0;
        element.voiceAudioName = element.voiceAudioName || `${element.name}_音频`;
        element._voiceV = element.hasVoiceAudio ? 1 : 0;
      }
      for (const variant of Array.isArray(element.variants) ? element.variants : []) {
        hydrateNestedImageState(variant, { promptEdited: true });
        const legacyRole = variant.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit';
        const legacyName = variant.clothingReferenceImageName || `${element.name}_形态_${variant.name}_服装参考`;
        variant.clothingReferenceImageName = variant.clothingReferenceOutfitImageName
          || (legacyRole === 'outfit' ? legacyName : `${element.name}_形态_${variant.name}_服装参考`);
        variant.clothingReferenceOutfitImageName = variant.clothingReferenceImageName;
        variant.clothingReferencePatternImageName = variant.clothingReferencePatternImageName
          || variant.logoReferenceImageName
          || (legacyRole === 'pattern' ? legacyName : `${element.name}_形态_${variant.name}_Logo参考`);
        variant.logoReferenceImageName = variant.clothingReferencePatternImageName;
        variant.clothingReferenceImageRole = variant.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit';
        const hadLegacyReferenceImage = !!variant.hasClothingReferenceImage;
        variant.hasClothingReferenceImage = legacyRole === 'pattern' ? false : !!variant.hasClothingReferenceImage;
        variant.hasLogoReferenceImage = legacyRole === 'pattern'
          ? hadLegacyReferenceImage || !!variant.hasLogoReferenceImage
          : !!variant.hasLogoReferenceImage;
        variant._clothingReferenceV = variant.hasClothingReferenceImage ? 1 : 0;
        variant._logoReferenceV = variant.hasLogoReferenceImage ? 1 : 0;
      }
      for (const outfit of Array.isArray(element.outfits) ? element.outfits : []) {
        hydrateNestedImageState(outfit, { promptEdited: true });
      }
      if (category === 'scene') {
        element._assetPanels = Array.isArray(element._assetPanels) ? element._assetPanels : [];
        element._deletingAsset = false;
        if (!Array.isArray(element.areas)) element.areas = [];
        for (const area of element.areas) {
          hydrateNestedImageState(area, { promptEdited: true });
        }
      }
    }
  }
  return p;
}

export function imageItemName(item) {
  return String(item?._imageName || item?.name || '').trim();
}

export function imageItemVersion(item) {
  return `${item?._v || 0}.${item?._imgReload || 0}`;
}

export function elementImageKey(projectId, category, item, index) {
  return `${projectId || ''}:${category || ''}:${index}:${imageItemName(item)}`;
}

export function imageSlotKey(projectId, category, item) {
  return `${projectId || ''}:${category || ''}:${imageItemName(item)}:${imageItemVersion(item)}`;
}

export function variantImageKey(projectId, character, variant) {
  return `${projectId || ''}:variant:${imageItemName(character)}:${imageItemName(variant)}:${imageItemVersion(variant)}`;
}

export function outfitImageKey(projectId, character, outfit) {
  return `${projectId || ''}:outfit:${imageItemName(character)}:${imageItemName(outfit)}:${imageItemVersion(outfit)}`;
}

export function sceneAreaImageKey(projectId, scene, area) {
  return `${projectId || ''}:sceneArea:${imageItemName(scene)}:${imageItemName(area)}:${imageItemVersion(area)}`;
}

export function elementImageUrl(projectId, category, item) {
  return `/img/${encodeURIComponent(projectId)}/${category}/${encodeURIComponent(imageItemName(item))}.png?v=${imageItemVersion(item)}`;
}

export function variantImageUrl(projectId, character, variant) {
  return `/img/${encodeURIComponent(projectId)}/character/${encodeURIComponent(`${imageItemName(character)}_形态_${imageItemName(variant)}`)}.png?v=${imageItemVersion(variant)}`;
}

export function variantClothingReferenceImageUrl(projectId, character, variant) {
  const name = variant?.clothingReferenceOutfitImageName || variant?.clothingReferenceImageName || `${imageItemName(character)}_形态_${imageItemName(variant)}_服装参考`;
  return `/img/${encodeURIComponent(projectId)}/character/${encodeURIComponent(name)}.png?v=${variant?._clothingReferenceV || 0}`;
}

export function variantLogoReferenceImageUrl(projectId, character, variant) {
  const name = variant?.clothingReferencePatternImageName || variant?.logoReferenceImageName || `${imageItemName(character)}_形态_${imageItemName(variant)}_Logo参考`;
  return `/img/${encodeURIComponent(projectId)}/character/${encodeURIComponent(name)}.png?v=${variant?._logoReferenceV || 0}`;
}

export function outfitImageUrl(projectId, character, outfit) {
  return `/img/${encodeURIComponent(projectId)}/character/${encodeURIComponent(`${imageItemName(character)}_${imageItemName(outfit)}`)}.png?v=${imageItemVersion(outfit)}`;
}

export function sceneAreaImageUrl(projectId, scene, area) {
  return `/img/${encodeURIComponent(projectId)}/scene/${encodeURIComponent(`${imageItemName(scene)}_${imageItemName(area)}`)}.png?v=${imageItemVersion(area)}`;
}

export function imageStatusRequestBody(project, item, options = {}) {
  if (!project || !item) return null;
  if (options.kind === 'variant') {
    return { projectId: project.id, kind: 'variant', charIndex: options.charIndex, variantIndex: options.variantIndex };
  }
  if (options.kind === 'outfit') {
    return { projectId: project.id, kind: 'outfit', charIndex: options.charIndex, outfitIndex: options.outfitIndex };
  }
  if (options.kind === 'sceneArea') {
    return { projectId: project.id, kind: 'sceneArea', sceneIndex: options.sceneIndex, areaIndex: options.areaIndex };
  }
  return { projectId: project.id, kind: 'main', category: options.category, index: options.index };
}

export function characterReferenceImageName(element) {
  return element?.referenceImageName || `${imageItemName(element)}_参考图`;
}

export function characterReferenceImageUrl(projectId, element) {
  return `/img/${encodeURIComponent(projectId)}/character/${encodeURIComponent(characterReferenceImageName(element))}.png?v=${element?._refV || 0}`;
}

export function characterVoiceAudioUrl(projectId, element) {
  return element?.voiceAudioUrl || `/audio/${encodeURIComponent(projectId)}/character/${encodeURIComponent(imageItemName(element))}.mp3?v=${element?._voiceV || 0}`;
}

export function globalReferenceImageUrl(project) {
  return `/img/${encodeURIComponent(project?.id || '')}/character/${encodeURIComponent(project?.globalReferenceImageName || '__全局风格参考图')}.png?v=${project?._globalRefV || 0}`;
}

export function markImageLoaded(item) {
  if (!item) return;
  item._imgBroken = false;
  item._imgReload = 0;
}

export function markImageFailed(item, options = {}, handlers = {}) {
  if (!item) return;
  handlers.recheckImageSlot?.(item, { ...options, silent: true, preserveExistingImage: true });
  const reloads = item._imgReload || 0;
  if (reloads < 3) {
    // 指数退避后换 URL 版本号重试（0.5s/1.5s/4.5s）：瞬时排队/网络抖动导致的
    // 加载失败可自愈，不至于一次失败就永远停在"加载中"占位
    setTimeout(() => {
      item._imgReload = (item._imgReload || 0) + 1;
    }, 500 * 3 ** reloads);
  } else {
    item._imgBroken = true;
  }
}

export function createImageStateAccessRuntime({ refs = {}, helpers = {} } = {}) {
  const projectId = () => refs.project.value?.id || '';
  const category = () => refs.category.value;
  return {
    imageName: imageItemName,
    imageVersion: imageItemVersion,
    elementKey: (element, index) => elementImageKey(projectId(), category(), element, index),
    imageKey: (element) => imageSlotKey(projectId(), category(), element),
    variantImageKey: (character, variant) => variantImageKey(projectId(), character, variant),
    outfitImageKey: (character, outfit) => outfitImageKey(projectId(), character, outfit),
    sceneAreaImageKey: (scene, area) => sceneAreaImageKey(projectId(), scene, area),
    markImageLoaded,
    markImageFailed: (element, options = {}) => markImageFailed(element, options, {
      recheckImageSlot: helpers.recheckImageSlot,
    }),
    imageStatusBody: (item, options = {}) => imageStatusRequestBody(refs.project.value, item, {
      category: category(),
      ...options,
    }),
    characterReferenceImgUrl: (element) => characterReferenceImageUrl(refs.project.value.id, element),
    characterVoiceAudioUrl: (element) => characterVoiceAudioUrl(refs.project.value.id, element),
    globalReferenceImgUrl: () => globalReferenceImageUrl(refs.project.value),
    imgUrl: (element) => elementImageUrl(refs.project.value.id, category(), element),
    variantImgUrl: (character, variant) => variantImageUrl(refs.project.value.id, character, variant),
    variantClothingReferenceImgUrl: (character, variant) => variantClothingReferenceImageUrl(refs.project.value.id, character, variant),
    variantLogoReferenceImgUrl: (character, variant) => variantLogoReferenceImageUrl(refs.project.value.id, character, variant),
    outfitImgUrl: (character, outfit) => outfitImageUrl(refs.project.value.id, character, outfit),
    sceneAreaImgUrl: (scene, area) => sceneAreaImageUrl(refs.project.value.id, scene, area),
  };
}

function hydrateElementImageState(element) {
  element.alias = String(element.alias || '').trim();
  hydrateNestedImageState(element);
}

function hydrateNestedImageState(item, options = {}) {
  item._imageName = item.name;
  item._imgBroken = false;
  item._imgReload = 0;
  item._syncing = false;
  item._deleting = false;
  item._switchingPrimary = false;
  item.hasPendingImage = !!item.hasPendingImage;
  if (options.promptEdited && item.promptEdited === undefined) item.promptEdited = false;
  if (item.hasImage && item._v === undefined) item._v = 1;
}
