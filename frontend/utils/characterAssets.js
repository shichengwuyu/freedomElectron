const CHARACTER_ASSET_TYPES = {
  variant: {
    listKey: 'variants',
    panelName: 'variants',
    label: '造型',
    loadingKey: '_addingVariant',
    deletingKey: '_deleting',
    placeholder: '例如：少年时期、黑化战斗装、宫廷礼服',
  },
  outfit: {
    listKey: 'outfits',
    panelName: 'outfits',
    label: '造型',
    loadingKey: '_addingOutfit',
    deletingKey: '_deleting',
    placeholder: '例如：宫廷礼服、现代休闲装',
  },
};

function cleanAssetName(value) {
  return String(value || '').trim().slice(0, 80);
}

function isSameAssetName(left, right) {
  return cleanAssetName(left).toLocaleLowerCase() === cleanAssetName(right).toLocaleLowerCase();
}

export function hydrateCreatedCharacterAsset(asset = {}) {
  const item = { ...asset };
  item.hasImage = !!item.hasImage;
  item.hasPendingImage = !!item.hasPendingImage;
  item._imageName = item.name || '';
  item._imgBroken = false;
  item._imgReload = 0;
  item._syncing = false;
  item._deleting = false;
  item._v = item.hasImage ? 1 : 0;
  return item;
}

function hasCharacterAssetImage(item) {
  return !!(item?.hasImage || item?.hasPendingImage);
}

export function canSwapCharacterAssetPrimary(character, asset) {
  return hasCharacterAssetImage(character) && hasCharacterAssetImage(asset);
}

export function isCharacterAssetPrimary(character, asset, type = '') {
  const state = character?.primaryLook;
  return !!state && state.type === type && isSameAssetName(state.name, asset?.name);
}

export function characterAssetPrimarySwapHint(character, asset, label = '素材', type = '') {
  if (canSwapCharacterAssetPrimary(character, asset)) {
    return isCharacterAssetPrimary(character, asset, type)
      ? '恢复人物原始主形态，此造型的名称和图片保持不变'
      : `将此${label}设为人物主形态，其他造型的名称和图片保持不变`;
  }
  return `人物主形态和此${label}都需要先有图片或待同步图片`;
}

export function applyCharacterAssetPrimarySwap(character, asset, result = {}) {
  if (!character || !asset || !result.main || !result.asset) return false;
  const updates = [[character, result.main], [asset, result.asset]];
  for (const state of Array.isArray(result.updatedAssets) ? result.updatedAssets : []) {
    const listKey = state?.type === 'variant' ? 'variants' : (state?.type === 'outfit' ? 'outfits' : '');
    const item = listKey
      ? (character[listKey] || []).find((entry) => isSameAssetName(entry?.name, state.assetName))
      : null;
    if (item) updates.push([item, state]);
  }
  const applied = new Set();
  for (const [item, state] of updates) {
    if (!item || !state || applied.has(item)) continue;
    applied.add(item);
    item.hasImage = !!state.hasImage;
    item.hasPendingImage = !!state.hasPendingImage;
    item._imgBroken = false;
    item._imgReload = 0;
    item._v = (item._v || 0) + 1;
  }
  character.primaryLook = result.primaryLook || null;
  return true;
}

export async function swapCharacterAssetPrimaryFlow(character, charIndex, asset, assetIndex, type, handlers = {}) {
  const assetType = CHARACTER_ASSET_TYPES[type];
  const project = handlers.project();
  if (!assetType || !project || !character || !asset || character._switchingPrimary || asset._switchingPrimary) return false;
  if (!canSwapCharacterAssetPrimary(character, asset)) {
    handlers.warning(`人物主形态和该${assetType.label}都需要先有图片或待同步图片`);
    return false;
  }
  if (character._gen || character._uploading || character._syncing || character._deletingAsset
    || asset._gen || asset._uploading || asset._syncing || asset._deleting) {
    handlers.warning('图片正在处理中，请完成后再切换主形态');
    return false;
  }

  character._switchingPrimary = true;
  asset._switchingPrimary = true;
  try {
    const result = await handlers.swapPrimary({
      projectId: project.id,
      charIndex,
      type,
      assetIndex,
      name: asset._imageName || asset.name,
    });
    if (!result.ok) {
      handlers.error(result.error || `切换${assetType.label}失败`);
      return false;
    }
    if (!applyCharacterAssetPrimarySwap(character, asset, result)) {
      handlers.error('切换主形态失败：返回数据无效，请刷新后重试');
      return false;
    }
    handlers.success(result.action === 'restored'
      ? '已恢复人物原始主形态'
      : `已将${assetType.label}「${asset.name || '未命名'}」设为主形态`);
    return true;
  } catch (error) {
    handlers.error(error.message || `切换${assetType.label}失败`);
    return false;
  } finally {
    character._switchingPrimary = false;
    asset._switchingPrimary = false;
  }
}

export function applyCreatedCharacterAsset(character, type, result = {}) {
  const assetType = CHARACTER_ASSET_TYPES[type];
  if (!character || !assetType || !result.asset) return null;
  if (!Array.isArray(character[assetType.listKey])) character[assetType.listKey] = [];
  const item = hydrateCreatedCharacterAsset(result.asset);
  character[assetType.listKey].push(item);
  const openPanels = Array.isArray(character._assetPanels) ? character._assetPanels : [];
  character._assetPanels = [...new Set([...openPanels, assetType.panelName])];
  return item;
}

export async function addCharacterAssetFlow(character, charIndex, type, handlers = {}) {
  const assetType = CHARACTER_ASSET_TYPES[type];
  const project = handlers.project();
  if (!assetType || !project || !character || character[assetType.loadingKey] || character._deletingAsset || character._switchingPrimary) return null;
  const name = await handlers.promptName(character, assetType);
  if (!name) return null;
  character[assetType.loadingKey] = true;
  try {
    const result = await handlers.addAsset({
      projectId: project.id,
      charIndex,
      type,
      name,
    });
    if (!result.ok) {
      handlers.error(result.error || `新增${assetType.label}失败`);
      return null;
    }
    const item = applyCreatedCharacterAsset(character, type, result);
    if (!item) {
      handlers.error(`新增${assetType.label}失败：返回数据无效`);
      return null;
    }
    handlers.success(`已为「${character.name || '人物'}」添加${assetType.label}「${item.name}」`);
    return item;
  } catch (error) {
    handlers.error(error.message || `新增${assetType.label}失败`);
    return null;
  } finally {
    character[assetType.loadingKey] = false;
  }
}

export function applyDeletedCharacterAsset(character, type, assetIndex) {
  const assetType = CHARACTER_ASSET_TYPES[type];
  const list = assetType && Array.isArray(character?.[assetType.listKey])
    ? character[assetType.listKey]
    : null;
  if (!list || !Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex >= list.length) return null;
  const [removed] = list.splice(assetIndex, 1);
  if (!list.length && Array.isArray(character._assetPanels)) {
    character._assetPanels = character._assetPanels.filter((name) => name !== assetType.panelName);
  }
  return removed;
}

export async function deleteCharacterAssetFlow(character, charIndex, asset, assetIndex, type, handlers = {}) {
  const assetType = CHARACTER_ASSET_TYPES[type];
  const project = handlers.project();
  if (!assetType || !project || !character || !asset || asset[assetType.deletingKey] || character._deletingAsset || character._switchingPrimary) return false;
  if (asset._gen || asset._uploading || asset._syncing || character._addingVariant || character._addingOutfit) {
    handlers.warning(`该${assetType.label}正在处理图片，请完成后再删除`);
    return false;
  }
  const confirmed = await handlers.confirmDelete(character, assetType, asset);
  if (!confirmed) return false;

  asset[assetType.deletingKey] = true;
  character._deletingAsset = true;
  try {
    const result = await handlers.deleteAsset({
      projectId: project.id,
      charIndex,
      type,
      assetIndex,
      name: asset._imageName || asset.name,
    });
    if (!result.ok) {
      handlers.error(result.error || `删除${assetType.label}失败`);
      return false;
    }
    const removed = applyDeletedCharacterAsset(character, type, assetIndex);
    if (!removed) {
      handlers.error(`删除${assetType.label}失败：本地状态已变化，请刷新`);
      return false;
    }
    character.primaryLook = result.primaryLook || null;
    handlers.success(`已删除${assetType.label}「${result.removedName || removed.name}」`);
    if (Array.isArray(result.cleanupWarnings) && result.cleanupWarnings.length) {
      handlers.warning(`${assetType.label}已删除，但部分图片文件正在占用，需稍后手动清理`);
    }
    return true;
  } catch (error) {
    handlers.error(error.message || `删除${assetType.label}失败`);
    return false;
  } finally {
    asset[assetType.deletingKey] = false;
    character._deletingAsset = false;
  }
}

export function createCharacterAssetActionsRuntime({ api, message, messageBox, refs = {} } = {}) {
  const promptName = async (character, assetType) => {
    const list = [
      ...(Array.isArray(character.variants) ? character.variants : []),
      ...(Array.isArray(character.outfits) ? character.outfits : []),
    ];
    try {
      const result = await messageBox.prompt(
        `请输入${assetType.label}名称，添加后可继续补充描述、上传图片或直接出图。`,
        `给「${character.name || '人物'}」添加${assetType.label}`,
        {
          customClass: 'character-asset-message-box',
          confirmButtonText: '添加',
          cancelButtonText: '取消',
          inputPlaceholder: assetType.placeholder,
          inputValidator: (value) => {
            const name = cleanAssetName(value);
            if (!name) return `${assetType.label}名称不能为空`;
            if (list.some((item) => isSameAssetName(item?.name, name))) return `已存在同名${assetType.label}`;
            return true;
          },
        }
      );
      return cleanAssetName(result.value);
    } catch {
      return '';
    }
  };
  const handlers = {
    project: () => refs.project.value,
    promptName,
    addAsset: (payload) => api.post('/api/project/character-asset/add', payload),
    deleteAsset: (payload) => api.post('/api/project/character-asset/delete', payload),
    swapPrimary: (payload) => api.post('/api/project/character-asset/swap-primary', payload),
    confirmDelete: async (character, assetType, asset) => {
      try {
        await messageBox.confirm(
          `删除「${character.name || '人物'}」的${assetType.label}「${asset.name || '未命名'}」？已生成或待同步的图片也会一并删除，且不可恢复。`,
          `删除${assetType.label}`,
          {
            customClass: 'character-asset-message-box',
            type: 'warning',
            confirmButtonText: '删除',
            cancelButtonText: '取消',
          }
        );
        return true;
      } catch {
        return false;
      }
    },
    success: message.success,
    warning: message.warning,
    error: message.error,
  };
  return {
    canSwapCharacterAssetPrimary,
    isCharacterAssetPrimary,
    characterAssetPrimarySwapHint,
    addCharacterVariant: (character, charIndex) => addCharacterAssetFlow(character, charIndex, 'variant', handlers),
    addCharacterOutfit: (character, charIndex) => addCharacterAssetFlow(character, charIndex, 'outfit', handlers),
    swapCharacterVariantPrimary: (character, charIndex, asset, assetIndex) => swapCharacterAssetPrimaryFlow(character, charIndex, asset, assetIndex, 'variant', handlers),
    swapCharacterOutfitPrimary: (character, charIndex, asset, assetIndex) => swapCharacterAssetPrimaryFlow(character, charIndex, asset, assetIndex, 'outfit', handlers),
    deleteCharacterVariant: (character, charIndex, asset, assetIndex) => deleteCharacterAssetFlow(character, charIndex, asset, assetIndex, 'variant', handlers),
    deleteCharacterOutfit: (character, charIndex, asset, assetIndex) => deleteCharacterAssetFlow(character, charIndex, asset, assetIndex, 'outfit', handlers),
  };
}
