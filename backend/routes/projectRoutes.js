import fs from 'fs';
import path from 'path';

import { loadConfig } from '../config.js';
import { normalizeProjectElements } from '../extractor.js';
import {
  normalizeImageStyle,
  normalizeCharacterImageMode,
} from '../prompts.js';
import {
  saveProject,
  clearProjectIdAlias,
  loadProject,
  listProjectsAsync,
  listProjectSizesAsync,
  projectExists,
  deleteProject,
  listDeletedProjects,
  restoreDeletedProject,
  imageDiskPath,
  characterVoiceExists,
  projectDir,
  CATEGORY_DIRS,
  MAIN_CATEGORIES,
  defaultScriptData,
  normalizeProjectScript,
  removeLabeledDir,
} from '../storage.js';
import {
  ensureStoryboardRevisions,
  mergeStoryboardUpdates,
} from '../services/storyboardRevisionService.js';
import {
  preserveCharacterAssetIndexes,
  recoverMissingCharacterAssets,
} from '../services/characterAssetRecoveryService.js';

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

const AGENT_TRANSIENT_PROJECT_KEYS = new Set([
  'hasImage',
  'hasReferenceImage',
  'hasGlobalReferenceImage',
  'hasVoiceAudio',
  'hasClothingReferenceImage',
  'hasLogoReferenceImage',
  'voiceAudioUrl',
]);

function variantClothingReferenceImageName(characterName, variantName, referenceType = 'outfit') {
  return `${characterName}_形态_${variantName}_${referenceType === 'pattern' ? 'Logo参考' : '服装参考'}`;
}

function cleanProjectSnapshot(value) {
  if (Array.isArray(value)) return value.map(cleanProjectSnapshot);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith('_') || AGENT_TRANSIENT_PROJECT_KEYS.has(key)) continue;
    out[key] = cleanProjectSnapshot(val);
  }
  return out;
}

export async function handleProjectRoutes(ctx) {
  const {
    req,
    res,
    url,
    p,
    method,
    readBody,
    sendJson,
    ensureProjectPromptTemplates,
    imageState,
    globalReferenceImageName,
    characterReferenceImageName,
    variantImageName,
    normalizeReferenceMode,
    projectImageStyle,
    reconcileProjectShotVideos,
  } = ctx;

  if (p === '/api/project/create' && method === 'POST') {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return handled(sendJson, res, 400, { error: '请填写项目名称' });
    if (projectExists(name)) return handled(sendJson, res, 400, { error: '已存在同名项目' });

    const project = {
      id: name,
      name,
      createdAt: new Date().toISOString(),
      elements: { character: [], group: [], scene: [], prop: [], effect: [], creature: [] },
      script: defaultScriptData(),
    };
    clearProjectIdAlias(name);
    saveProject(project);
    return handled(sendJson, res, 200, { ok: true, projectId: project.id });
  }

  if (p === '/api/project/delete' && method === 'POST') {
    const body = await readBody(req);
    if (!projectExists(body.projectId)) return handled(sendJson, res, 404, { error: '项目不存在' });
    const deletedPath = deleteProject(body.projectId);
    return handled(sendJson, res, 200, { ok: true, deletedPath });
  }

  if (p === '/api/projects/deleted' && method === 'GET') {
    return handled(sendJson, res, 200, { ok: true, projects: listDeletedProjects() });
  }

  if (p === '/api/project/restore' && method === 'POST') {
    const body = await readBody(req);
    const trashId = String(body.trashId || '').trim();
    if (!trashId) return handled(sendJson, res, 400, { error: 'Missing trashId' });
    try {
      const project = restoreDeletedProject(trashId);
      if (!project) return handled(sendJson, res, 404, { error: '回收区项目不存在' });
      return handled(sendJson, res, 200, { ok: true, projectId: project.id });
    } catch (e) {
      return handled(sendJson, res, 400, { error: e.message });
    }
  }

  if (p === '/api/project/elements/clear' && method === 'POST') {
    const body = await readBody(req);
    const proj = loadProject(body.projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    if (!proj.elements) proj.elements = { character: [], group: [], scene: [], prop: [], effect: [], creature: [] };

    const cats = body.category && MAIN_CATEGORIES.includes(body.category) ? [body.category] : MAIN_CATEGORIES;
    for (const c of cats) {
      const dir = path.join(projectDir(proj.id), 'images', CATEGORY_DIRS[c]);
      try {
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir)) {
            if (c === 'character' && f.startsWith('__')) continue;
            try {
              fs.unlinkSync(path.join(dir, f));
            } catch {}
          }
        }
      } catch {}
      removeLabeledDir(proj.id, c);
      proj.elements[c] = [];
    }
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, { ok: true });
  }

  if (p === '/api/project/style' && method === 'POST') {
    const body = await readBody(req);
    const proj = loadProject(body.projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });

    const style = normalizeImageStyle(body.style || 'realistic');
    proj.imageStyle = style;
    const cfg = loadConfig();
    let rebuilt = 0;
    if (ensureProjectPromptTemplates(proj, style, cfg.promptTemplate, cfg.stylePrompts)) rebuilt++;
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, { ok: true, imageStyle: style, rebuilt });
  }

  if (p === '/api/project/character-image-mode' && method === 'POST') {
    const body = await readBody(req);
    const proj = loadProject(body.projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });

    const imageMode = normalizeCharacterImageMode(body.imageMode);
    proj.characterImageMode = imageMode;
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, { ok: true, imageMode });
  }

  if (p === '/api/projects/sizes' && method === 'GET') {
    const ids = [
      ...url.searchParams.getAll('id'),
      ...String(url.searchParams.get('ids') || '').split(','),
    ]
      .map((id) => id.trim())
      .filter(Boolean);
    return handled(sendJson, res, 200, { projects: await listProjectSizesAsync(ids.length ? ids : null) });
  }

  if (p === '/api/projects' && method === 'GET') {
    return handled(sendJson, res, 200, { projects: await listProjectsAsync({ withSizes: false }) });
  }

  if (p === '/api/project' && method === 'GET') {
    const id = url.searchParams.get('id');
    const proj = loadProject(id);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });

    const recovery = recoverMissingCharacterAssets(id, proj);
    let normalized = recovery.restored > 0;
    if (normalizeProjectElements(proj)) normalized = true;
    if (normalizeProjectScript(proj)) normalized = true;
    if (ensureStoryboardRevisions(proj.script.storyboards)) normalized = true;
    if (reconcileProjectShotVideos(id, proj)) normalized = true;
    const cfg = loadConfig();
    const style = projectImageStyle(proj, cfg);
    if (ensureProjectPromptTemplates(proj, style, cfg.promptTemplate, cfg.stylePrompts)) normalized = true;
    if (normalized) {
      proj.updatedAt = new Date().toISOString();
      saveProject(proj);
    }

    proj.globalReferenceImageName = proj.globalReferenceImageName || globalReferenceImageName();
    proj.hasGlobalReferenceImage = fs.existsSync(imageDiskPath(id, 'character', proj.globalReferenceImageName));
    proj.useGlobalReferenceImage = !!proj.useGlobalReferenceImage;
    for (const cat of Object.keys(proj.elements)) {
      for (const el of proj.elements[cat]) {
        Object.assign(el, imageState(id, cat, el.name));
        if (cat === 'character') {
          const refName = el.referenceImageName || characterReferenceImageName(el.name);
          el.referenceImageName = refName;
          el.hasReferenceImage = fs.existsSync(imageDiskPath(id, 'character', refName));
          el.referenceMode = normalizeReferenceMode(el.referenceMode, el.useReferenceImage ? 'character' : 'none');
          el.useReferenceImage = el.referenceMode !== 'none';
          el.voiceAudioName = el.voiceAudioName || `${el.name}_音频`;
          el.hasVoiceAudio = characterVoiceExists(id, el.name);
          el.voiceAudioUrl = el.hasVoiceAudio ? `/audio/${encodeURIComponent(id)}/character/${encodeURIComponent(el.name)}.mp3?t=${Date.now()}` : '';
        }
        if (cat === 'character' && Array.isArray(el.outfits)) {
          for (const o of el.outfits) {
            Object.assign(o, imageState(id, 'character', `${el.name}_${o.name}`));
          }
        }
        if (cat === 'character' && Array.isArray(el.variants)) {
          for (const v of el.variants) {
            Object.assign(v, imageState(id, 'character', variantImageName(el.name, v.name)));
            const legacyRole = v.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit';
            const legacyName = v.clothingReferenceImageName || variantClothingReferenceImageName(el.name, v.name, 'outfit');
            const outfitName = v.clothingReferenceOutfitImageName
              || (legacyRole === 'outfit' ? legacyName : variantClothingReferenceImageName(el.name, v.name, 'outfit'));
            const patternName = v.clothingReferencePatternImageName
              || v.logoReferenceImageName
              || (legacyRole === 'pattern' ? legacyName : variantClothingReferenceImageName(el.name, v.name, 'pattern'));
            v.clothingReferenceImageName = outfitName;
            v.clothingReferenceOutfitImageName = outfitName;
            v.clothingReferencePatternImageName = patternName;
            v.logoReferenceImageName = patternName;
            v.hasClothingReferenceImage = fs.existsSync(imageDiskPath(id, 'character', outfitName));
            v.hasLogoReferenceImage = fs.existsSync(imageDiskPath(id, 'character', patternName));
            if (legacyRole === 'pattern' && v.hasLogoReferenceImage) v.clothingReferenceImageRole = 'outfit';
          }
        }
        if (cat === 'scene' && Array.isArray(el.areas)) {
          for (const a of el.areas) {
            Object.assign(a, imageState(id, 'scene', `${el.name}_${a.name}`));
          }
        }
      }
    }
    return handled(sendJson, res, 200, { project: proj, characterAssetRecovery: recovery });
  }

  if (p === '/api/project/save' && method === 'POST') {
    const body = await readBody(req);
    const incoming = body.project && typeof body.project === 'object' ? cleanProjectSnapshot(body.project) : null;
    if (!incoming?.id) return handled(sendJson, res, 400, { error: 'Missing project payload' });
    const existing = loadProject(incoming.id);
    if (!existing) return handled(sendJson, res, 404, { error: '项目不存在' });

    const project = {
      ...existing,
      ...incoming,
      id: existing.id,
      createdAt: existing.createdAt || incoming.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    preserveCharacterAssetIndexes(project.elements, existing.elements);
    if (!project.elements || typeof project.elements !== 'object') project.elements = { character: [], group: [], scene: [], prop: [], effect: [], creature: [] };
    for (const c of MAIN_CATEGORIES) {
      if (!Array.isArray(project.elements[c])) project.elements[c] = [];
    }
    normalizeProjectScript(project);
    const allowedEpisodeIds = new Set([
      ...(existing.script?.episodes || []),
      ...(project.script?.episodes || []),
    ].map((episode) => String(episode?.id)));
    const mergedStoryboards = mergeStoryboardUpdates(
      existing.id,
      existing.script?.storyboards,
      project.script?.storyboards,
      { allowedEpisodeIds },
    );
    project.script.storyboards = mergedStoryboards.storyboards;
    normalizeProjectElements(project);
    saveProject(project);
    return handled(sendJson, res, 200, {
      ok: true,
      project,
      storyboardConflicts: mergedStoryboards.conflicts,
    });
  }

  return false;
}
