import { elementAliasList } from './aliases.js';
import { imageItemVersion } from './imageState.js';

export const ELEMENT_CATEGORIES = ['character', 'group', 'scene', 'prop', 'effect', 'creature'];
export const ELEMENT_CATEGORY_LABELS = { character: '人物', group: '群像', scene: '场景', prop: '道具', effect: '特效', creature: '妖兽' };
export const CHARACTER_PART_FIELDS = [
  { key: 'identity', label: '身份定位', rows: 2 },
  { key: 'appearance', label: '外貌', rows: 3 },
  { key: 'body', label: '身材体态', rows: 3 },
  { key: 'hair', label: '发型', rows: 2 },
  { key: 'clothing', label: '服装', rows: 3 },
  { key: 'makeupAccessories', label: '妆容配饰', rows: 2 },
  { key: 'atmosphere', label: '氛围风格', rows: 3 },
  { key: 'composition', label: '构图', rows: 3 },
  { key: 'backgroundLight', label: '背景光线', rows: 2 },
  { key: 'negative', label: '负面词/禁忌', rows: 3 },
];
export const CHARACTER_PART_KEYS = CHARACTER_PART_FIELDS.map((field) => field.key);

export function createElementUiStateRuntime({ reactive, ref } = {}) {
  return {
    promptDialog: reactive({
      visible: false,
      saving: false,
      type: '',
      title: '',
      el: null,
      index: -1,
      ch: null,
      charIndex: -1,
      variant: null,
      variantIndex: -1,
      outfit: null,
      outfitIndex: -1,
      draftPrompt: '',
    }),
    lightboxSrc: ref(''),
    elementFilter: reactive({
      hasImage: 'all',
      isEdited: 'all',
      sortBy: 'default',
    }),
  };
}

export function emptyElementCounts() {
  return { character: 0, group: 0, scene: 0, prop: 0, effect: 0, creature: 0 };
}

export function projectElementCounts(project) {
  if (!project) return emptyElementCounts();
  const elements = project.elements || {};
  return {
    character: (elements.character || []).length,
    group: (elements.group || []).length,
    scene: (elements.scene || []).length,
    prop: (elements.prop || []).length,
    effect: (elements.effect || []).length,
    creature: (elements.creature || []).length,
  };
}

export function isDefaultCharacterLookName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^(?:0+|默认(?:形态)?|主形态|default|main)$/i.test(normalized);
}

export function flatProjectElements(project) {
  const out = [];
  const elements = project?.elements || {};
  for (const category of ELEMENT_CATEGORIES) {
    for (const element of elements[category] || []) {
      const name = String(element.name || '').trim();
      if (!name) continue;
      const alias = String(element.alias || '').trim();
      const aliases = elementAliasList(element);
      const isSelectableLookOwner = category === 'character' || category === 'scene';
      const base = {
        name,
        alias,
        displayName: alias || name,
        cat: category,
        ownerName: isSelectableLookOwner ? name : '',
        assetKind: isSelectableLookOwner ? 'main' : '',
        assetLabel: category === 'character' ? '主形态' : (category === 'scene' ? '主场景' : ''),
        lookLabel: category === 'character' ? '主形态' : (category === 'scene' ? '主场景' : ''),
        hasImage: !!element.hasImage,
        generating: !!element._gen,
        imageBase: name,
        imageVersion: imageItemVersion(element),
        hasVoiceAudio: category === 'character' && !!element.hasVoiceAudio,
        voiceName: element.voiceAudioName || `${name}_音频`,
      };
      out.push({ ...base, matchTerms: [name, alias, ...aliases].filter(Boolean) });
      if (category === 'character') {
        for (const variant of element.variants || []) {
          const variantName = String(variant.name || '').trim();
          if (variantName) {
            const isDefaultLook = isDefaultCharacterLookName(variantName);
            out.push({
              name: `${name}·${variantName}`,
              displayName: isDefaultLook ? name : `${name} · ${variantName}`,
              matchName: isDefaultLook ? '' : variantName,
              ownerName: name,
              assetKind: 'variant',
              assetLabel: isDefaultLook ? '默认造型' : '造型',
              lookLabel: isDefaultLook ? '默认形态' : variantName,
              isDefaultLook,
              manualOnly: isDefaultLook,
              cat: category,
              hasImage: !!variant.hasImage,
              generating: !!variant._gen,
              imageBase: `${name}_形态_${variantName}`,
              imageVersion: imageItemVersion(variant),
              hasVoiceAudio: !!element.hasVoiceAudio,
              voiceOwnerName: name,
              voiceName: element.voiceAudioName || `${name}_音频`,
            });
          }
        }
        for (const outfit of element.outfits || []) {
          const outfitName = String(outfit.name || '').trim();
          if (outfitName) {
            out.push({
              name: `${name}·服饰·${outfitName}`,
              displayName: `${name} · ${outfitName}`,
              matchName: outfitName,
              ownerName: name,
              assetKind: 'outfit',
              assetLabel: '造型',
              lookLabel: outfitName,
              manualOnly: true,
              cat: category,
              hasImage: !!outfit.hasImage,
              generating: !!outfit._gen,
              imageBase: `${name}_${outfitName}`,
              imageVersion: imageItemVersion(outfit),
              hasVoiceAudio: !!element.hasVoiceAudio,
              voiceOwnerName: name,
              voiceName: element.voiceAudioName || `${name}_音频`,
            });
          }
        }
      }
      if (category === 'scene') {
        for (const area of element.areas || []) {
          const areaName = String(area.name || '').trim();
          if (!areaName) continue;
          out.push({
            name: `${name}·区域·${areaName}`,
            displayName: `${alias || name} · ${areaName}`,
            matchName: areaName,
            ownerName: name,
            assetKind: 'sceneArea',
            assetLabel: '子区域',
            lookLabel: areaName,
            manualOnly: true,
            cat: category,
            hasImage: !!area.hasImage,
            generating: !!area._gen,
            imageBase: `${name}_${areaName}`,
            imageVersion: imageItemVersion(area),
          });
        }
      }
    }
  }
  return out;
}

export function normalizeElementSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

export function elementSearchText(element, category = '') {
  if (!element) return '';
  const nameParts = [
    element.name,
    element.alias,
    element.aliasesText,
    element.source?.name,
    ...(Array.isArray(element.source?.aliases) ? element.source.aliases : []),
  ];
  if (category === 'character') {
    for (const variant of element.variants || []) nameParts.push(variant.name);
    for (const outfit of element.outfits || []) nameParts.push(outfit.name);
  }
  return nameParts.filter(Boolean).join('\n').toLowerCase();
}

export function filteredElementItems(list = [], filter = {}, searchQuery = '', category = '') {
  const keyword = normalizeElementSearchText(searchQuery);
  let items = list.map((element, index) => ({ el: element, index }));
  if (keyword) {
    items = items.filter(({ el }) => elementSearchText(el, category).includes(keyword));
  }
  if (filter.hasImage === 'yes') {
    items = items.filter(({ el }) => el.hasImage);
  } else if (filter.hasImage === 'no') {
    items = items.filter(({ el }) => !el.hasImage);
  }
  if (filter.isEdited === 'yes') {
    items = items.filter(({ el }) => el.edited || el.partsEdited);
  } else if (filter.isEdited === 'no') {
    items = items.filter(({ el }) => !el.edited && !el.partsEdited);
  }
  if (filter.sortBy === 'name') {
    items.sort((a, b) => (a.el.name || '').localeCompare(b.el.name || '', 'zh-CN'));
  } else if (filter.sortBy === 'recent') {
    items.sort((a, b) => {
      const timeA = a.el.updatedAt || a.el.createdAt || '';
      const timeB = b.el.updatedAt || b.el.createdAt || '';
      return timeB.localeCompare(timeA);
    });
  }
  return items;
}

export function resetElementFilterState(filter = {}) {
  filter.hasImage = 'all';
  filter.isEdited = 'all';
  filter.sortBy = 'default';
}

export function hasActiveElementFilter(filter = {}, searchQuery = '') {
  return filter.hasImage !== 'all' ||
    filter.isEdited !== 'all' ||
    filter.sortBy !== 'default' ||
    String(searchQuery || '').trim() !== '';
}

export function firstFilledElementCategory(project, currentCategory = 'character') {
  const order = [currentCategory, ...ELEMENT_CATEGORIES];
  const uniqueOrder = [...new Set(order)];
  const elements = project?.elements || {};
  return uniqueOrder.find((key) => (elements[key] || []).length) || '';
}

export function elementCountsSummary(counts = {}) {
  return [
    counts.character ? `${counts.character}个人物` : '',
    counts.group ? `${counts.group}个群像` : '',
    counts.scene ? `${counts.scene}个场景` : '',
    counts.prop ? `${counts.prop}个道具` : '',
    counts.effect ? `${counts.effect}个特效` : '',
    counts.creature ? `${counts.creature}个妖兽` : '',
  ].filter(Boolean).join('，');
}

export function assignElementCounts(target, counts = {}) {
  Object.assign(target, {
    character: Number(counts.character) || 0,
    group: Number(counts.group) || 0,
    scene: Number(counts.scene) || 0,
    prop: Number(counts.prop) || 0,
    effect: Number(counts.effect) || 0,
    creature: Number(counts.creature) || 0,
  });
}

export function categoryCountIncreased(counts = {}, previousCounts = {}, category) {
  return (counts[category] || 0) > (previousCounts[category] || 0);
}

export function createElementListUiRuntime({ refs = {}, computed } = {}) {
  const counts = computed(() => projectElementCounts(refs.project.value));
  const curList = computed(() => (
    refs.project.value ? (refs.project.value.elements?.[refs.category.value] || []) : []
  ));
  const filteredCurList = computed(() => (
    filteredElementItems(curList.value, refs.filter, refs.searchQuery.value, refs.category.value)
  ));
  const filteredCount = computed(() => filteredCurList.value.length);
  const hasActiveFilter = computed(() => hasActiveElementFilter(refs.filter, refs.searchQuery.value));
  const selectedElement = computed(() => {
    if (refs.selectedElementIndex.value < 0) return null;
    return curList.value[refs.selectedElementIndex.value] || null;
  });

  const resetElementFilter = () => resetElementFilterState(refs.filter);
  const openInspector = (index) => {
    refs.selectedElementIndex.value = index;
    refs.inspectorVisible.value = true;
  };
  const closeInspector = () => {
    refs.inspectorVisible.value = false;
  };
  const selectCategory = (nextCategory) => {
    refs.category.value = nextCategory;
    refs.selectedElementIndex.value = -1;
    refs.inspectorVisible.value = false;
  };
  const focusFirstFilledCategory = () => {
    const nextCategory = firstFilledElementCategory(refs.project.value, refs.category.value);
    if (nextCategory) selectCategory(nextCategory);
  };
  const extractedCountsSummary = () => elementCountsSummary(counts.value);
  const rememberExtractCounts = () => assignElementCounts(refs.lastExtractCounts, counts.value);
  const categoryJustUpdated = (category) => categoryCountIncreased(counts.value, refs.lastExtractCounts, category);
  const openElementsDrawer = () => {
    refs.elementsDrawer.value = true;
  };

  return {
    counts,
    curList,
    filteredCurList,
    filteredCount,
    hasActiveFilter,
    selectedElement,
    resetElementFilter,
    openInspector,
    closeInspector,
    selectCategory,
    focusFirstFilledCategory,
    extractedCountsSummary,
    rememberExtractCounts,
    categoryJustUpdated,
    openElementsDrawer,
  };
}

export function createElementWorkspaceUiRuntime({ refs = {}, reactive, ref, computed } = {}) {
  const characterPartFields = CHARACTER_PART_FIELDS;
  const characterPartKeys = CHARACTER_PART_KEYS;
  const catLabel = ELEMENT_CATEGORY_LABELS;
  const uiState = createElementUiStateRuntime({ reactive, ref });
  const promptRuntime = refs.createElementPrompt({
    state: { promptDialog: uiState.promptDialog },
    refs: { category: refs.category },
    helpers: {
      partKeys: characterPartKeys,
      categoryLabel: (category) => catLabel[category],
    },
  });
  const listRuntime = createElementListUiRuntime({
    computed,
    refs: {
      project: refs.project,
      category: refs.category,
      filter: uiState.elementFilter,
      searchQuery: refs.searchQuery,
      selectedElementIndex: refs.selectedElementIndex,
      inspectorVisible: refs.inspectorVisible,
      lastExtractCounts: refs.lastExtractCounts,
      elementsDrawer: refs.elementsDrawer,
    },
  });
  return {
    characterPartFields,
    characterPartKeys,
    catLabel,
    ...uiState,
    ...promptRuntime,
    ...listRuntime,
  };
}

export function elementSelectionKey(category, index) {
  return `${category}:${index}`;
}

export function createElementSelectionRuntime({ refs = {}, helpers = {}, computed } = {}) {
  const getElementKey = elementSelectionKey;
  const isElementSelected = (category, index) => refs.selectedElements.has(getElementKey(category, index));
  const toggleElementSelection = (category, index) => {
    const key = getElementKey(category, index);
    if (refs.selectedElements.has(key)) refs.selectedElements.delete(key);
    else refs.selectedElements.set(key, true);
  };
  const selectAllInCategory = (category) => {
    const targetCategory = category || refs.category.value;
    const list = refs.project.value?.elements?.[targetCategory] || [];
    list.forEach((_, index) => {
      refs.selectedElements.set(getElementKey(targetCategory, index), true);
    });
    helpers.success(`已选择 ${list.length} 个${helpers.categoryLabel(targetCategory)}`);
  };
  const deselectAll = () => {
    refs.selectedElements.clear();
    helpers.info('已取消全部选择');
  };
  const toggleSelectionMode = () => {
    refs.selectionMode.value = !refs.selectionMode.value;
    if (!refs.selectionMode.value) refs.selectedElements.clear();
  };
  const selectedCount = computed(() => refs.selectedElements.size);
  const selectedInCurrentCategory = computed(() => {
    if (!refs.project.value) return 0;
    const prefix = `${refs.category.value}:`;
    let count = 0;
    for (const key of refs.selectedElements.keys()) {
      if (key.startsWith(prefix)) count++;
    }
    return count;
  });
  const selectedElementsBusy = computed(() => {
    if (!refs.project.value) return false;
    for (const [key] of refs.selectedElements.entries()) {
      const separator = String(key).indexOf(':');
      const category = separator >= 0 ? String(key).slice(0, separator) : '';
      const index = Number(String(key).slice(separator + 1));
      const element = refs.project.value.elements?.[category]?.[index];
      if (element && (element._gen || element._uploading || element._switchingPrimary || element._syncing || element._refUploading || element._voiceUploading || element._deleting)) return true;
    }
    return false;
  });
  return {
    getElementKey,
    isElementSelected,
    toggleElementSelection,
    selectAllInCategory,
    deselectAll,
    toggleSelectionMode,
    selectedCount,
    selectedInCurrentCategory,
    selectedElementsBusy,
  };
}
