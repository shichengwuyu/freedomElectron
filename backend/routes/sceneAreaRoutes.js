import fs from 'fs';

import { loadConfig } from '../config.js';
import { removePendingImage, renamePendingImage } from '../pendingImages.js';
import { buildSceneAreaPrompt, normalizeImageStyle } from '../prompts.js';
import { sameSceneAreaName } from '../sceneAreaNames.js';
import {
  imageDiskPath,
  labeledDiskPath,
  labeledMetadataPath,
  loadProject,
  renameImage,
  saveProject,
} from '../storage.js';

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

function cleanAreaName(value) {
  return String(value || '').trim().slice(0, 80);
}

function sceneAreaImageName(sceneName, areaName) {
  return `${sceneName}_${areaName}`;
}

function sceneAreaBindingName(sceneName, areaName) {
  return `${sceneName}·区域·${areaName}`;
}

function renameStoryboardSceneAreaRefs(project, sceneName, previousName, nextName) {
  const previousBinding = sceneAreaBindingName(sceneName, previousName);
  const nextBinding = sceneAreaBindingName(sceneName, nextName);
  for (const storyboard of project?.script?.storyboards || []) {
    for (const bucket of ['manualTags', 'excludedTags']) {
      for (const tags of Object.values(storyboard?.[bucket] || {})) {
        if (!Array.isArray(tags)) continue;
        for (const tag of tags) {
          if (tag?.cat === 'scene' && tag.name === previousBinding) tag.name = nextBinding;
        }
      }
    }
  }
}

function removeStoryboardSceneAreaRefs(project, sceneName, areaName) {
  const bindingName = sceneAreaBindingName(sceneName, areaName);
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
      if (nextManual.length) storyboard.manualTags[key] = nextManual;
      else if (storyboard.manualTags) delete storyboard.manualTags[key];

      const excluded = Array.isArray(storyboard.excludedTags?.[key]) ? storyboard.excludedTags[key] : [];
      const nextExcluded = excluded.filter((tag) => {
        if (tag?.cat === 'scene' && tag.name === bindingName) return false;
        return !(removedSelectedArea && tag?.cat === 'scene' && tag.source === 'sceneArea' && tag.ownerName === sceneName);
      });
      if (nextExcluded.length) storyboard.excludedTags[key] = nextExcluded;
      else if (storyboard.excludedTags) delete storyboard.excludedTags[key];
    }
  }
}

function sceneImageStyle(project, cfg) {
  return normalizeImageStyle(project?.imageStyle || cfg?.style || 'realistic');
}

function ensureSceneAreaLists(scene) {
  if (!Array.isArray(scene.areas)) scene.areas = [];
  if (!scene.source || typeof scene.source !== 'object') scene.source = { name: scene.name };
  if (!Array.isArray(scene.source.areas)) scene.source.areas = [];
}

// source.areas 是给提取/出图用的精简副本，只存 name/desc
function syncSceneAreaSource(scene, area, previousName = '') {
  ensureSceneAreaLists(scene);
  const lookup = previousName || area.name;
  const found = scene.source.areas.find((item) => sameSceneAreaName(item?.name, lookup));
  if (found) {
    found.name = area.name;
    found.desc = area.desc || '';
    return;
  }
  scene.source.areas.push({ name: area.name, desc: area.desc || '' });
}

function removeSceneAreaSource(scene, areaName) {
  ensureSceneAreaLists(scene);
  scene.source.areas = scene.source.areas.filter((item) => !sameSceneAreaName(item?.name, areaName));
}

async function deleteSceneAreaImage(projectId, imageName) {
  const deletedFiles = [];
  const cleanupWarnings = [];
  for (const file of [
    imageDiskPath(projectId, 'scene', imageName),
    labeledDiskPath(projectId, 'scene', imageName),
    labeledMetadataPath(projectId, 'scene', imageName),
  ]) {
    try {
      if (!fs.existsSync(file)) continue;
      await fs.promises.unlink(file);
      deletedFiles.push(file);
    } catch (error) {
      cleanupWarnings.push(`${file}: ${error.message}`);
    }
  }
  let removedPendingImage = false;
  try {
    removedPendingImage = removePendingImage(projectId, 'scene', imageName);
  } catch (error) {
    cleanupWarnings.push(`pending:${imageName}: ${error.message}`);
  }
  return { deletedFiles, cleanupWarnings, removedPendingImage };
}

function serializeArea(area) {
  return {
    name: area.name,
    desc: area.desc || '',
    prompt: area.prompt || '',
    promptEdited: !!area.promptEdited,
  };
}

export async function handleSceneAreaRoutes({ req, res, p, method, readBody, sendJson }) {
  // ---- 新增场景子区域 ----
  if (p === '/api/project/scene-area/add' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    const sceneIndex = Number(body.sceneIndex);
    const name = cleanAreaName(body.name);
    const desc = String(body.desc || '').trim().slice(0, 4000);
    if (!name) return handled(sendJson, res, 400, { error: '请填写子区域名称' });
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const scene = proj.elements?.scene?.[sceneIndex];
    if (!scene) return handled(sendJson, res, 404, { error: '场景不存在' });
    ensureSceneAreaLists(scene);
    const duplicate = scene.areas.find((item) => sameSceneAreaName(item?.name, name));
    if (duplicate) {
      return handled(sendJson, res, 400, { error: `已存在同一子区域「${duplicate.name}」` });
    }
    const cfg = loadConfig();
    const area = {
      name,
      desc,
      prompt: buildSceneAreaPrompt(scene.source || scene, { name, desc }, sceneImageStyle(proj, cfg), cfg.stylePrompts),
      promptEdited: false,
    };
    scene.areas.push(area);
    syncSceneAreaSource(scene, area);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, { ok: true, index: scene.areas.length - 1, area: serializeArea(area) });
  }

  // ---- 删除场景子区域 ----
  if (p === '/api/project/scene-area/delete' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    const sceneIndex = Number(body.sceneIndex);
    const areaIndex = Number(body.areaIndex);
    if (!Number.isInteger(areaIndex) || areaIndex < 0) {
      return handled(sendJson, res, 400, { error: '子区域索引无效' });
    }
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const scene = proj.elements?.scene?.[sceneIndex];
    if (!scene) return handled(sendJson, res, 404, { error: '场景不存在' });
    ensureSceneAreaLists(scene);
    const area = scene.areas[areaIndex];
    if (!area) return handled(sendJson, res, 404, { error: '子区域不存在' });
    const expectedName = cleanAreaName(body.name);
    if (expectedName && !sameSceneAreaName(area.name, expectedName)) {
      return handled(sendJson, res, 409, { error: '子区域列表已变化，请刷新后重试' });
    }
    const [removed] = scene.areas.splice(areaIndex, 1);
    removeSceneAreaSource(scene, removed.name);
    removeStoryboardSceneAreaRefs(proj, scene.name, removed.name);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    const cleanup = await deleteSceneAreaImage(projectId, sceneAreaImageName(scene.name, removed.name));
    return handled(sendJson, res, 200, {
      ok: true,
      areaIndex,
      removedName: removed.name,
      deletedFiles: cleanup.deletedFiles,
      removedPendingImage: cleanup.removedPendingImage,
      cleanupWarnings: cleanup.cleanupWarnings,
    });
  }

  // ---- 更新场景子区域（改名/改描述/改提示词）----
  if (p === '/api/project/scene-area' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, sceneIndex, areaIndex, name, desc, prompt, promptEdited } = body;
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const scene = proj.elements?.scene?.[sceneIndex];
    if (!scene) return handled(sendJson, res, 404, { error: '场景不存在' });
    ensureSceneAreaLists(scene);
    const area = scene.areas[areaIndex];
    if (!area) return handled(sendJson, res, 404, { error: '子区域不存在' });
    const previousName = area.name;
    if (typeof name === 'string' && cleanAreaName(name) && cleanAreaName(name) !== area.name) {
      const newName = cleanAreaName(name);
      const duplicate = scene.areas.find((item, index) => (
        index !== Number(areaIndex) && sameSceneAreaName(item?.name, newName)
      ));
      if (duplicate) {
        return handled(sendJson, res, 400, { error: `已存在同一子区域「${duplicate.name}」` });
      }
      const oldImageName = sceneAreaImageName(scene.name, area.name);
      const newImageName = sceneAreaImageName(scene.name, newName);
      await renameImage(projectId, 'scene', oldImageName, newImageName);
      renamePendingImage(projectId, 'scene', oldImageName, newImageName);
      area.name = newName;
      renameStoryboardSceneAreaRefs(proj, scene.name, previousName, newName);
    }
    if (typeof promptEdited === 'boolean') area.promptEdited = promptEdited;
    if (typeof desc === 'string') area.desc = desc;
    if (typeof prompt === 'string') area.prompt = prompt;
    if (!area.promptEdited) {
      const cfg = loadConfig();
      area.prompt = buildSceneAreaPrompt(scene.source || scene, area, sceneImageStyle(proj, cfg), cfg.stylePrompts);
    }
    syncSceneAreaSource(scene, area, previousName);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, { ok: true, area: serializeArea(area) });
  }

  return false;
}
