// 场景子区域（同一场景内部的正门/后院/大厅等）：与人物换装同构，
// 主场景出基准图，子区域以主场景图作参考图做图生图。

function cleanAreaName(value) {
  return String(value || '').trim().slice(0, 80);
}

function compactAreaName(value) {
  return cleanAreaName(value)
    .toLocaleLowerCase()
    .replace(/[\s"'“”‘’`·•,，.。!！?？:：;；、()[\]{}<>《》【】\\/|｜\-—_+=*#~^$@%&]/g, '');
}

export function sceneAreaNameKey(value) {
  const key = compactAreaName(value);
  if (!key) return '';
  if (/^(?:车内|汽车内|轿车内)?(?:主驾驶|主驾|驾驶员|驾驶|司机)(?:位置|座位|座椅|座|位)$/.test(key)
    || /^(?:车内|汽车内|轿车内)?主驾$/.test(key)) {
    return '驾驶座位';
  }
  if (/^(?:车内|汽车内|轿车内)?(?:副驾驶|副驾)(?:位置|座位|座椅|座|位)?$/.test(key)) {
    return '副驾驶座位';
  }
  if (/^(?:车内|汽车内|轿车内)?(?:后排|后座)(?:区域|位置|座位|座椅|座)?$/.test(key)) {
    return '后排座位';
  }
  return key;
}

function isSameAreaName(left, right) {
  const leftKey = sceneAreaNameKey(left);
  return !!leftKey && leftKey === sceneAreaNameKey(right);
}

export function sceneAreaBindingName(sceneName, areaName) {
  return `${String(sceneName || '').trim()}·区域·${String(areaName || '').trim()}`;
}

export function renameStoryboardSceneAreaRefs(project, sceneName, previousName, nextName) {
  const previousBinding = sceneAreaBindingName(sceneName, previousName);
  const nextBinding = sceneAreaBindingName(sceneName, nextName);
  if (!previousBinding || previousBinding === nextBinding) return false;
  let changed = false;
  for (const storyboard of project?.script?.storyboards || []) {
    for (const bucket of ['manualTags', 'excludedTags']) {
      for (const tags of Object.values(storyboard?.[bucket] || {})) {
        if (!Array.isArray(tags)) continue;
        for (const tag of tags) {
          if (tag?.cat !== 'scene' || tag.name !== previousBinding) continue;
          tag.name = nextBinding;
          changed = true;
        }
      }
    }
  }
  return changed;
}

export function renameStoryboardSceneRefs(project, previousName, nextName) {
  const previous = String(previousName || '').trim();
  const next = String(nextName || '').trim();
  if (!previous || !next || previous === next) return false;
  let changed = false;
  for (const storyboard of project?.script?.storyboards || []) {
    for (const bucket of ['manualTags', 'excludedTags']) {
      for (const tags of Object.values(storyboard?.[bucket] || {})) {
        if (!Array.isArray(tags)) continue;
        for (const tag of tags) {
          if (tag?.cat !== 'scene') continue;
          if (tag.name === previous) {
            tag.name = next;
            changed = true;
          } else if (String(tag.name || '').startsWith(`${previous}·`)) {
            tag.name = `${next}${tag.name.slice(previous.length)}`;
            changed = true;
          }
          if (tag.ownerName === previous) {
            tag.ownerName = next;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

export function removeStoryboardSceneAreaRefs(project, sceneName, areaName) {
  const bindingName = sceneAreaBindingName(sceneName, areaName);
  let changed = false;
  for (const storyboard of project?.script?.storyboards || []) {
    for (const key of new Set([
      ...Object.keys(storyboard?.manualTags || {}),
      ...Object.keys(storyboard?.excludedTags || {}),
    ])) {
      const manual = Array.isArray(storyboard.manualTags?.[key]) ? storyboard.manualTags[key] : [];
      const removedSelectedArea = manual.some(
        (tag) => tag?.cat === 'scene' && tag.name === bindingName && tag.source === 'sceneArea',
      );
      const nextManual = manual.filter((tag) => !(tag?.cat === 'scene' && tag.name === bindingName));
      if (nextManual.length !== manual.length) changed = true;
      if (nextManual.length) storyboard.manualTags[key] = nextManual;
      else if (storyboard.manualTags) delete storyboard.manualTags[key];

      const excluded = Array.isArray(storyboard.excludedTags?.[key]) ? storyboard.excludedTags[key] : [];
      const nextExcluded = excluded.filter((tag) => {
        if (tag?.cat === 'scene' && tag.name === bindingName) return false;
        return !(removedSelectedArea && tag?.cat === 'scene' && tag.source === 'sceneArea' && tag.ownerName === sceneName);
      });
      if (nextExcluded.length !== excluded.length) changed = true;
      if (nextExcluded.length) storyboard.excludedTags[key] = nextExcluded;
      else if (storyboard.excludedTags) delete storyboard.excludedTags[key];
    }
  }
  return changed;
}

export function hydrateCreatedSceneArea(area = {}) {
  const item = { ...area };
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

export function applyCreatedSceneArea(scene, result = {}) {
  if (!scene || !result.area) return null;
  if (!Array.isArray(scene.areas)) scene.areas = [];
  const existing = scene.areas.find((area) => isSameAreaName(area?.name, result.area?.name));
  if (existing) return existing;
  const item = hydrateCreatedSceneArea(result.area);
  scene.areas.push(item);
  const openPanels = Array.isArray(scene._assetPanels) ? scene._assetPanels : [];
  scene._assetPanels = [...new Set([...openPanels, 'areas'])];
  return item;
}

export async function addSceneAreaFlow(scene, sceneIndex, handlers = {}) {
  const project = handlers.project();
  if (!project || !scene || scene._addingArea || scene._deletingAsset) return null;
  const name = await handlers.promptName(scene);
  if (!name) return null;
  scene._addingArea = true;
  try {
    const result = await handlers.addArea({ projectId: project.id, sceneIndex, name });
    if (!result.ok) {
      handlers.error(result.error || '新增子区域失败');
      return null;
    }
    const item = applyCreatedSceneArea(scene, result);
    if (!item) {
      handlers.error('新增子区域失败：返回数据无效');
      return null;
    }
    handlers.success(`已为「${scene.name || '场景'}」添加子区域「${item.name}」`);
    return item;
  } catch (error) {
    handlers.error(error.message || '新增子区域失败');
    return null;
  } finally {
    scene._addingArea = false;
  }
}

export function applyDeletedSceneArea(scene, areaIndex) {
  const list = Array.isArray(scene?.areas) ? scene.areas : null;
  if (!list || !Number.isInteger(areaIndex) || areaIndex < 0 || areaIndex >= list.length) return null;
  const [removed] = list.splice(areaIndex, 1);
  if (!list.length && Array.isArray(scene._assetPanels)) {
    scene._assetPanels = scene._assetPanels.filter((name) => name !== 'areas');
  }
  return removed;
}

export async function deleteSceneAreaFlow(scene, sceneIndex, area, areaIndex, handlers = {}) {
  const project = handlers.project();
  if (!project || !scene || !area || area._deleting || scene._deletingAsset) return false;
  if (area._gen || area._uploading || area._syncing || scene._addingArea) {
    handlers.warning('该子区域正在处理图片，请完成后再删除');
    return false;
  }
  const confirmed = await handlers.confirmDelete(scene, area);
  if (!confirmed) return false;

  area._deleting = true;
  scene._deletingAsset = true;
  try {
    const result = await handlers.deleteArea({
      projectId: project.id,
      sceneIndex,
      areaIndex,
      name: area._imageName || area.name,
    });
    if (!result.ok) {
      handlers.error(result.error || '删除子区域失败');
      return false;
    }
    const removed = applyDeletedSceneArea(scene, areaIndex);
    if (!removed) {
      handlers.error('删除子区域失败：本地状态已变化，请刷新');
      return false;
    }
    handlers.removeAreaRefs(project, scene.name, result.removedName || removed._imageName || removed.name);
    handlers.success(`已删除子区域「${result.removedName || removed.name}」`);
    if (Array.isArray(result.cleanupWarnings) && result.cleanupWarnings.length) {
      handlers.warning('子区域已删除，但部分图片文件正在占用，需稍后手动清理');
    }
    return true;
  } catch (error) {
    handlers.error(error.message || '删除子区域失败');
    return false;
  } finally {
    area._deleting = false;
    scene._deletingAsset = false;
  }
}

export function createSceneAreaActionsRuntime({ api, message, messageBox, refs = {} } = {}) {
  const promptName = async (scene) => {
    const list = Array.isArray(scene.areas) ? scene.areas : [];
    try {
      const result = await messageBox.prompt(
        '请输入子区域名称，添加后可继续补充描述、上传图片或直接出图（会以主场景图为参考保持同一处建筑）。',
        `给「${scene.name || '场景'}」添加子区域`,
        {
          confirmButtonText: '添加',
          cancelButtonText: '取消',
          inputPlaceholder: '例如：正门、后院、二楼回廊',
          inputValidator: (value) => {
            const name = cleanAreaName(value);
            if (!name) return '子区域名称不能为空';
            const duplicate = list.find((item) => isSameAreaName(item?.name, name));
            if (duplicate) return `已存在同一子区域「${duplicate.name}」`;
            return true;
          },
        }
      );
      return cleanAreaName(result.value);
    } catch {
      return '';
    }
  };
  const handlers = {
    project: () => refs.project.value,
    promptName,
    addArea: (payload) => api.post('/api/project/scene-area/add', payload),
    deleteArea: (payload) => api.post('/api/project/scene-area/delete', payload),
    removeAreaRefs: removeStoryboardSceneAreaRefs,
    confirmDelete: async (scene, area) => {
      try {
        await messageBox.confirm(
          `删除「${scene.name || '场景'}」的子区域「${area.name || '未命名'}」？已生成或待同步的图片也会一并删除，且不可恢复。`,
          '删除子区域',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
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
    addSceneArea: (scene, sceneIndex) => addSceneAreaFlow(scene, sceneIndex, handlers),
    deleteSceneArea: (scene, sceneIndex, area, areaIndex) => deleteSceneAreaFlow(scene, sceneIndex, area, areaIndex, handlers),
  };
}
