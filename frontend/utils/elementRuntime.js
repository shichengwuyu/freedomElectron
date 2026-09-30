import { normalizeCharacterAliasState } from './aliases.js';
import { createCharacterAssetActionsRuntime } from './characterAssets.js';
import { createSceneAreaActionsRuntime } from './sceneAreas.js';
import {
  createElementSelectionRuntime,
  createElementWorkspaceUiRuntime,
} from './elementList.js';
import {
  createElementPromptRuntime,
  createElementSaveBodyRuntime,
  createElementWorkspaceActionsRuntime,
} from './elementCrud.js';
import {
  createAppImageWorkspaceRuntime,
  createSavePromptDialogRuntime,
} from './imageBatch.js';

export function characterLookEntries(character) {
  const entries = [];
  for (const [assetIndex, asset] of (Array.isArray(character?.variants) ? character.variants : []).entries()) {
    entries.push({ type: 'variant', asset, assetIndex, index: entries.length });
  }
  for (const [assetIndex, asset] of (Array.isArray(character?.outfits) ? character.outfits : []).entries()) {
    entries.push({ type: 'outfit', asset, assetIndex, index: entries.length });
  }
  return entries;
}

function characterLookSearchText(asset) {
  return [
    asset?.name,
    asset?.desc,
    asset?.identity,
    asset?.appearance,
    asset?.body,
    asset?.hair,
    asset?.clothing,
    asset?.makeupAccessories,
    asset?.traits,
  ].filter(Boolean).join('\n').toLowerCase();
}

export function createAppElementRuntime({
  api,
  message,
  messageBox,
  refs = {},
  readers = {},
  helpers = {},
  options = {},
  reactive,
  ref,
  computed,
} = {}) {
  const addingElement = ref(false);
  const deletingSelectedElements = ref(false);
  const ui = createElementWorkspaceUiRuntime({
    refs: {
      project: refs.project,
      category: refs.category,
      searchQuery: refs.searchQuery,
      selectedElementIndex: refs.selectedElementIndex,
      inspectorVisible: refs.inspectorVisible,
      lastExtractCounts: refs.lastExtractCounts,
      elementsDrawer: refs.elementsDrawer,
      createElementPrompt: createElementPromptRuntime,
    },
    reactive,
    ref,
    computed,
  });

  const imageWorkspace = createAppImageWorkspaceRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      category: refs.category,
      ratio: refs.imageRatio,
      imageMode: refs.characterImageMode,
    },
    readers: {
      readFileAsB64: readers.readFileAsB64,
      readImageAsPngB64: readers.readImageAsPngB64,
    },
    helpers: {
      nextTick: helpers.nextTick,
      progressByRatio: helpers.progressByRatio,
      createElementSaveBody: () => createElementSaveBodyRuntime({
        refs: { project: refs.project, category: refs.category },
        helpers: {
          ensureCharacterParts: ui.ensureCharacterParts,
          normalizeCharacterAlias: normalizeCharacterAliasState,
        },
      }),
      createSavePromptDialog: ({ saveElement, saveVariant, saveOutfit }) => createSavePromptDialogRuntime({
        state: { promptDialog: ui.promptDialog },
        helpers: {
          saveElement,
          saveVariant,
          saveOutfit,
          close: ui.closePromptDialog,
        },
      }),
      startProgressTracking: helpers.startProgressTracking,
      updateProgressTracking: helpers.updateProgressTracking,
      stopProgressTracking: helpers.stopProgressTracking,
      formatElapsed: helpers.formatElapsed,
      createElementSelection: ({ computed: localComputed, refs: selectionRefs }) => createElementSelectionRuntime({
        refs: {
          selectedElements: selectionRefs.selectedElements,
          selectionMode: selectionRefs.selectionMode,
          project: refs.project,
          category: refs.category,
        },
        helpers: {
          categoryLabel: (category) => ui.catLabel[category],
          success: message.success,
          info: message.info,
        },
        computed: localComputed,
      }),
    },
    reactive,
    ref,
    computed,
  });

  const characterAssetActions = createCharacterAssetActionsRuntime({
    api,
    message,
    messageBox,
    refs: { project: refs.project },
  });

  const wardrobeManager = reactive({
    visible: false,
    character: null,
    charIndex: -1,
    selectedIndex: 0,
    query: '',
  });
  const wardrobeCharacter = computed(() => wardrobeManager.character);
  const wardrobeLooks = computed(() => characterLookEntries(wardrobeCharacter.value));
  const wardrobeSelectedLook = computed(() => (
    wardrobeLooks.value[wardrobeManager.selectedIndex] || null
  ));
  const wardrobeSelectedAsset = computed(() => wardrobeSelectedLook.value?.asset || null);
  const wardrobeSelectedIsPrimary = computed(() => (
    !!wardrobeSelectedLook.value && characterAssetActions.isCharacterAssetPrimary(
      wardrobeCharacter.value,
      wardrobeSelectedAsset.value,
      wardrobeSelectedLook.value.type,
    )
  ));
  const wardrobeFilteredLooks = computed(() => {
    const keyword = String(wardrobeManager.query || '').trim().toLowerCase();
    return wardrobeLooks.value.filter(({ asset }) => !keyword || characterLookSearchText(asset).includes(keyword));
  });
  const wardrobeAvailableOutfits = computed(() => (
    Array.isArray(wardrobeCharacter.value?.outfits) ? wardrobeCharacter.value.outfits : []
  ));
  const selectWardrobeLook = (index) => {
    if (!Number.isInteger(index) || !wardrobeLooks.value[index]) return;
    wardrobeManager.selectedIndex = index;
  };
  const openWardrobeManager = (character, charIndex, type = '', assetIndex = 0) => {
    wardrobeManager.character = character;
    wardrobeManager.charIndex = charIndex;
    const looks = characterLookEntries(character);
    const requestedIndex = looks.findIndex((entry) => entry.type === type && entry.assetIndex === assetIndex);
    wardrobeManager.selectedIndex = requestedIndex >= 0 ? requestedIndex : 0;
    wardrobeManager.query = '';
    wardrobeManager.visible = true;
  };
  const resetWardrobeManager = () => {
    wardrobeManager.character = null;
    wardrobeManager.charIndex = -1;
    wardrobeManager.selectedIndex = 0;
    wardrobeManager.query = '';
  };
  const addCharacterLook = async (character = wardrobeCharacter.value, charIndex = wardrobeManager.charIndex) => {
    const asset = await characterAssetActions.addCharacterVariant(character, charIndex);
    if (!asset) return null;
    const assetIndex = character.variants.indexOf(asset);
    openWardrobeManager(character, charIndex, 'variant', assetIndex);
    return asset;
  };
  const addCharacterOutfitLook = async (character = wardrobeCharacter.value, charIndex = wardrobeManager.charIndex) => {
    const asset = await characterAssetActions.addCharacterOutfit(character, charIndex);
    if (!asset) return null;
    const assetIndex = character.outfits.indexOf(asset);
    openWardrobeManager(character, charIndex, 'outfit', assetIndex);
    return asset;
  };
  const characterLookImageKey = (entry) => (entry?.type === 'outfit'
    ? imageWorkspace.outfitImageKey(wardrobeCharacter.value, entry.asset)
    : imageWorkspace.variantImageKey(wardrobeCharacter.value, entry?.asset));
  const characterLookImgUrl = (entry) => (entry?.type === 'outfit'
    ? imageWorkspace.outfitImgUrl(wardrobeCharacter.value, entry.asset)
    : imageWorkspace.variantImgUrl(wardrobeCharacter.value, entry?.asset));
  const characterLookImageSlot = (entry) => (entry?.type === 'outfit'
    ? { kind: 'outfit', charIndex: wardrobeManager.charIndex, outfitIndex: entry.assetIndex }
    : { kind: 'variant', charIndex: wardrobeManager.charIndex, variantIndex: entry?.assetIndex });
  const onCharacterLookImageDrop = (event, entry) => {
    const args = [event, wardrobeCharacter.value, wardrobeManager.charIndex, entry.asset, entry.assetIndex];
    return entry.type === 'outfit'
      ? imageWorkspace.onOutfitImageDrop(...args)
      : imageWorkspace.onVariantImageDrop(...args);
  };
  const onPickCharacterLookImage = (event, entry) => {
    const args = [event, wardrobeCharacter.value, wardrobeManager.charIndex, entry.asset, entry.assetIndex];
    return entry.type === 'outfit'
      ? imageWorkspace.onPickOutfitImage(...args)
      : imageWorkspace.onPickVariantImage(...args);
  };
  const saveCharacterLook = (entry = wardrobeSelectedLook.value) => {
    if (!entry) return false;
    const args = [wardrobeCharacter.value, wardrobeManager.charIndex, entry.asset, entry.assetIndex];
    return entry.type === 'outfit'
      ? imageWorkspace.saveOutfit(...args)
      : imageWorkspace.saveVariant(...args);
  };
  const generateCharacterLook = (entry = wardrobeSelectedLook.value) => {
    if (!entry) return false;
    const args = [wardrobeCharacter.value, wardrobeManager.charIndex, entry.asset, entry.assetIndex];
    return entry.type === 'outfit'
      ? imageWorkspace.genOutfit(...args)
      : imageWorkspace.genVariant(...args);
  };
  const openCharacterLookPrompt = (entry = wardrobeSelectedLook.value) => {
    if (!entry) return;
    const args = [wardrobeCharacter.value, wardrobeManager.charIndex, entry.asset, entry.assetIndex];
    if (entry.type === 'outfit') ui.openOutfitPromptDialog(...args);
    else ui.openVariantPromptDialog(...args);
  };
  const swapCharacterLookPrimary = (entry = wardrobeSelectedLook.value) => {
    if (!entry) return false;
    const args = [wardrobeCharacter.value, wardrobeManager.charIndex, entry.asset, entry.assetIndex];
    return entry.type === 'outfit'
      ? characterAssetActions.swapCharacterOutfitPrimary(...args)
      : characterAssetActions.swapCharacterVariantPrimary(...args);
  };
  const deleteCharacterLook = async (entry = wardrobeSelectedLook.value) => {
    if (!entry) return false;
    const selectedIndex = wardrobeManager.selectedIndex;
    const args = [wardrobeCharacter.value, wardrobeManager.charIndex, entry.asset, entry.assetIndex];
    const deleted = entry.type === 'outfit'
      ? await characterAssetActions.deleteCharacterOutfit(...args)
      : await characterAssetActions.deleteCharacterVariant(...args);
    if (!deleted) return false;
    wardrobeManager.selectedIndex = Math.max(0, Math.min(selectedIndex, wardrobeLooks.value.length - 1));
    return deleted;
  };

  const sceneAreaActions = createSceneAreaActionsRuntime({
    api,
    message,
    messageBox,
    refs: { project: refs.project },
  });

  const actions = createElementWorkspaceActionsRuntime({
    api,
    message,
    messageBox,
    refs: {
      project: refs.project,
      config: refs.config,
      projectStyle: refs.projectStyle,
      characterImageMode: refs.characterImageMode,
      category: refs.category,
      addingElement,
      searchQuery: refs.searchQuery,
      selectedElementIndex: refs.selectedElementIndex,
      currentList: ui.curList,
      selectedElements: imageWorkspace.selectedElements,
      selectionMode: imageWorkspace.selectionMode,
      deletingSelectedElements,
    },
    helpers: {
      categoryLabel: (category) => ui.catLabel[category],
      hydrateImageState: helpers.hydrateImageState,
    },
    options: {
      styleOptions: options.styleOptions,
      characterImageModeOptions: options.characterImageModeOptions,
      characterImageModeLabels: options.characterImageModeLabels,
    },
  });

  return {
    ...ui,
    ...imageWorkspace,
    ...characterAssetActions,
    ...sceneAreaActions,
    ...actions,
    wardrobeManager,
    wardrobeCharacter,
    wardrobeLooks,
    wardrobeSelectedLook,
    wardrobeSelectedAsset,
    wardrobeSelectedIsPrimary,
    wardrobeFilteredLooks,
    wardrobeAvailableOutfits,
    openWardrobeManager,
    resetWardrobeManager,
    selectWardrobeLook,
    addCharacterLook,
    addCharacterOutfitLook,
    characterLookImageKey,
    characterLookImgUrl,
    characterLookImageSlot,
    onCharacterLookImageDrop,
    onPickCharacterLookImage,
    saveCharacterLook,
    generateCharacterLook,
    openCharacterLookPrompt,
    swapCharacterLookPrimary,
    deleteCharacterLook,
    addingElement,
    deletingSelectedElements,
    normalizeCharacterAlias: normalizeCharacterAliasState,
  };
}
