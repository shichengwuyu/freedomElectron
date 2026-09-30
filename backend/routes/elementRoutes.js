// 元素管理路由模块
import fs from 'fs';
import { loadConfig } from '../config.js';
import {
  loadProject,
  saveProject,
  imageDiskPath,
  saveImage,
  renameImage,
  characterVoiceDiskPaths,
  renameCharacterVoice,
  MAIN_CATEGORIES
} from '../storage.js';
import {
  removePendingImage,
  renamePendingImage
} from '../pendingImages.js';
import {
  buildCharacterPromptFromParts,
  buildCreaturePrompt,
  buildEffectPrompt,
  buildGroupPrompt,
  buildPropPrompt,
  buildScenePrompt,
  makeCharacterPromptParts,
  normalizeCharacterPromptParts,
  normalizeCharacterPartsEdited,
  normalizeImageStyle
} from '../prompts.js';

// 本地辅助函数（从 server.js 移动）
function projectImageStyle(project, cfg) {
  return normalizeImageStyle(project?.imageStyle || cfg?.style || 'realistic');
}

function ensureElementBuckets(project) {
  if (!project.elements || typeof project.elements !== 'object') {
    project.elements = { character: [], group: [], scene: [], prop: [], effect: [], creature: [] };
  }
  for (const c of MAIN_CATEGORIES) {
    if (!Array.isArray(project.elements[c])) project.elements[c] = [];
  }
}


// Helper functions
function localImageUrl(projectId, category, imageName) {
  return `/img/${encodeURIComponent(projectId)}/${category}/${encodeURIComponent(imageName)}.png?t=${Date.now()}`;
}

function variantImageName(charName, variantName) {
  return `${charName}_形态_${variantName}`;
}

function variantClothingReferenceImageName(charName, variantName) {
  return `${variantImageName(charName, variantName)}_服装参考`;
}

function variantLogoReferenceImageName(charName, variantName) {
  return `${variantImageName(charName, variantName)}_Logo参考`;
}

function characterReferenceImageName(charName) {
  return `${charName}_参考图`;
}

function globalReferenceImageName() {
  return '全局参考图';
}

function normalizeReferenceMode(mode, fallback = 'none') {
  return ['none', 'character', 'face'].includes(mode) ? mode : fallback;
}

function cleanImageB64(raw) {
  const source = String(raw || '').trim();
  const match = source.match(/^data:image\/[^;]+;base64,(.*)$/is);
  const payload = String(match ? match[1] : source).replace(/\s+/g, '');
  return payload && /^[a-z0-9+/=]+$/i.test(payload) ? payload : '';
}

async function deleteElementImageFiles(projectId, category, element) {
  const files = [];
  const mainFile = imageDiskPath(projectId, category, element.name);
  if (fs.existsSync(mainFile)) {
    await fs.promises.unlink(mainFile);
    files.push(mainFile);
  }
  if (category === 'character' && Array.isArray(element.outfits)) {
    for (const o of element.outfits) {
      const ofile = imageDiskPath(projectId, 'character', `${element.name}_${o.name}`);
      if (fs.existsSync(ofile)) {
        await fs.promises.unlink(ofile);
        files.push(ofile);
      }
    }
  }
  if (category === 'character' && Array.isArray(element.variants)) {
    for (const v of element.variants) {
      const vfile = imageDiskPath(projectId, 'character', variantImageName(element.name, v.name));
      if (fs.existsSync(vfile)) {
        await fs.promises.unlink(vfile);
        files.push(vfile);
      }
      const referenceFile = imageDiskPath(projectId, 'character', variantClothingReferenceImageName(element.name, v.name));
      if (fs.existsSync(referenceFile)) {
        await fs.promises.unlink(referenceFile);
        files.push(referenceFile);
      }
      removePendingImage(projectId, 'character', variantClothingReferenceImageName(element.name, v.name));
      const logoReferenceFile = imageDiskPath(projectId, 'character', variantLogoReferenceImageName(element.name, v.name));
      if (fs.existsSync(logoReferenceFile)) {
        await fs.promises.unlink(logoReferenceFile);
        files.push(logoReferenceFile);
      }
      removePendingImage(projectId, 'character', variantLogoReferenceImageName(element.name, v.name));
    }
  }
  if (category === 'character') {
    const backupImageName = String(element.primaryLook?.backupImageName || '').trim();
    if (backupImageName) {
      const backupFile = imageDiskPath(projectId, 'character', backupImageName);
      if (fs.existsSync(backupFile)) {
        await fs.promises.unlink(backupFile);
        files.push(backupFile);
      }
      removePendingImage(projectId, 'character', backupImageName);
    }
    const refFile = imageDiskPath(projectId, 'character', characterReferenceImageName(element.name));
    if (fs.existsSync(refFile)) {
      await fs.promises.unlink(refFile);
      files.push(refFile);
    }
    for (const audioFile of characterVoiceDiskPaths(projectId, element.name)) {
      if (fs.existsSync(audioFile)) {
        await fs.promises.unlink(audioFile);
        files.push(audioFile);
      }
    }
  }
  if (category === 'scene' && Array.isArray(element.areas)) {
    for (const area of element.areas) {
      const areaFile = imageDiskPath(projectId, 'scene', `${element.name}_${area.name}`);
      if (fs.existsSync(areaFile)) {
        await fs.promises.unlink(areaFile);
        files.push(areaFile);
      }
    }
  }
  return files;
}

function removeStoryboardElementRefs(project, category, elementName) {
  const storyboards = project?.script?.storyboards;
  if (!Array.isArray(storyboards)) return;
  for (const sb of storyboards) {
    if (sb.manualTags && typeof sb.manualTags === 'object') {
      for (const key of Object.keys(sb.manualTags)) {
        sb.manualTags[key] = (sb.manualTags[key] || []).filter((tag) => !(
          tag?.cat === category
          && (tag?.name === elementName || (['character', 'scene'].includes(category) && (tag?.ownerName === elementName || String(tag?.name || '').startsWith(`${elementName}·`))))
        ));
        if (!sb.manualTags[key].length) delete sb.manualTags[key];
      }
    }
    if (sb.excludedTags && typeof sb.excludedTags === 'object') {
      for (const key of Object.keys(sb.excludedTags)) {
        sb.excludedTags[key] = (sb.excludedTags[key] || []).filter((tag) => !(
          tag?.cat === category
          && (tag?.name === elementName || (['character', 'scene'].includes(category) && (tag?.ownerName === elementName || String(tag?.name || '').startsWith(`${elementName}·`))))
        ));
        if (!sb.excludedTags[key].length) delete sb.excludedTags[key];
      }
    }
    if (category === 'character' && sb.shotMeta && typeof sb.shotMeta === 'object') {
      for (const meta of Object.values(sb.shotMeta)) {
        const bindings = meta?.audioBindings;
        if (!bindings || typeof bindings !== 'object') continue;
        const manual = Array.isArray(bindings.manual) ? bindings.manual.filter((name) => name !== elementName) : [];
        const excluded = Array.isArray(bindings.excluded) ? bindings.excluded.filter((name) => name !== elementName) : [];
        if (manual.length || excluded.length) meta.audioBindings = { manual, excluded };
        else delete meta.audioBindings;
      }
    }
  }
}

function renameStoryboardElementRefs(project, category, previousName, nextName) {
  for (const storyboard of project?.script?.storyboards || []) {
    for (const bucket of ['manualTags', 'excludedTags']) {
      for (const tags of Object.values(storyboard?.[bucket] || {})) {
        if (!Array.isArray(tags)) continue;
        for (const tag of tags) {
          if (tag?.cat !== category) continue;
          if (tag.name === previousName) tag.name = nextName;
          if (category === 'character' || category === 'scene') {
            if (String(tag?.name || '').startsWith(`${previousName}·`)) tag.name = `${nextName}${tag.name.slice(previousName.length)}`;
            if (tag.ownerName === previousName) tag.ownerName = nextName;
          }
        }
      }
    }
    if (category === 'character' && storyboard.shotMeta && typeof storyboard.shotMeta === 'object') {
      for (const meta of Object.values(storyboard.shotMeta)) {
        const bindings = meta?.audioBindings;
        if (!bindings || typeof bindings !== 'object') continue;
        const rename = (name) => name === previousName ? nextName : name;
        const manual = Array.isArray(bindings.manual) ? [...new Set(bindings.manual.map(rename))] : [];
        const excluded = Array.isArray(bindings.excluded) ? [...new Set(bindings.excluded.map(rename))] : [];
        if (manual.length || excluded.length) meta.audioBindings = { manual, excluded };
        else delete meta.audioBindings;
      }
    }
  }
}

function normalizeAliasList(sources, mainName) {
  const raw = Array.isArray(sources) ? sources.flat() : [sources];
  const out = [];
  const seen = new Set([String(mainName || '').trim().toLowerCase()]);
  for (const item of raw) {
    const alias = String(item || '').trim();
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

function createBlankElement(category, name, project, config) {
  const style = projectImageStyle(project, config);
  const stylePrompts = config.stylePrompts;
  if (category === 'character') {
    const source = { name, identity: '', appearance: '', body: '', hair: '', clothing: '', makeupAccessories: '', traits: '', outfits: [], variants: [] };
    const promptParts = makeCharacterPromptParts(source, style, config.promptTemplate, stylePrompts);
    return {
      name,
      userCreated: true,
      source,
      promptParts,
      partsEdited: normalizeCharacterPartsEdited(),
      prompt: buildCharacterPromptFromParts(promptParts, source, style, config.promptTemplate, stylePrompts),
      edited: false,
      outfits: [],
      variants: [],
      referenceImageName: characterReferenceImageName(name),
      referenceMode: 'none',
      useReferenceImage: false,
    };
  }
  if (category === 'group') {
    const source = { name, identity: '', memberCount: '', sharedClothing: '', composition: '', members: [] };
    return {
      name,
      userCreated: true,
      source,
      prompt: buildGroupPrompt(source, style, stylePrompts),
      edited: false,
    };
  }
  const source = { name, description: '' };
  const promptBuilders = {
    scene: buildScenePrompt,
    prop: buildPropPrompt,
    effect: buildEffectPrompt,
    creature: buildCreaturePrompt,
  };
  return {
    name,
    userCreated: true,
    source,
    prompt: promptBuilders[category](source, style, stylePrompts),
    edited: false,
  };
}

function validateAddElementRequest(body) {
  const errors = [];
  if (!body.projectId) errors.push('缺少 projectId');
  if (!body.category) errors.push('缺少 category');
  if (!body.name || !String(body.name).trim()) errors.push('缺少元素名称');
  return { valid: errors.length === 0, errors };
}

function extractProjectId(body) {
  return String(body.projectId || '').trim();
}

function extractElementName(body) {
  return String(body.name || '').trim().slice(0, 80);
}

// 导出主路由处理函数
export async function handleElementRoutes(ctx) {
  const { req, res, url, p, method, readBody, sendJson } = ctx;

if (p === '/api/project/element/add' && method === 'POST') {
  const body = await readBody(req);

  // 输入验证
  const validation = validateAddElementRequest(body);
  if (!validation.valid) {
    return sendJson(res, 400, { error: validation.errors.join('; '), details: validation.errors });
  }

  const projectId = extractProjectId(body);
  const { category } = body;
  const name = extractElementName(body);

  if (!MAIN_CATEGORIES.includes(category)) return sendJson(res, 400, { error: '分类无效' });
  if (!name) return sendJson(res, 400, { error: '请填写元素名称' });
  const proj = loadProject(projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  ensureElementBuckets(proj);
  if (proj.elements[category].some((el) => el.name === name)) {
    return sendJson(res, 400, { error: '已存在同名元素' });
  }
  const cfg = loadConfig();
  const el = createBlankElement(category, name, proj, cfg);
  proj.elements[category].push(el);
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  return sendJson(res, 200, { ok: true, index: proj.elements[category].length - 1, element: el });
}

// 删除单个元素，连带该元素主图、待同步图、标注副本；人物额外删除参考图、声音、形态/服装图。
if (p === '/api/project/element/delete' && method === 'POST') {
  const body = await readBody(req);
  const { projectId, category } = body;
  const index = Number(body.index);
  if (!MAIN_CATEGORIES.includes(category)) return sendJson(res, 400, { error: '分类无效' });
  const proj = loadProject(projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  ensureElementBuckets(proj);
  if (!Number.isInteger(index) || index < 0 || !proj.elements[category][index]) {
    return sendJson(res, 404, { error: '元素不存在' });
  }

  const [removed] = proj.elements[category].splice(index, 1);
  const removedName = String(removed?.name || '').trim();
  const deletedFiles = await deleteElementImageFiles(projectId, category, removed);
  if (removedName) removeStoryboardElementRefs(proj, category, removedName);
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  return sendJson(res, 200, { ok: true, removedName, deletedFiles, project: proj });
}

// 批量删除元素：按原始索引倒序处理，避免前一个删除导致后续索引错位。
if (p === '/api/project/elements/delete-selected' && method === 'POST') {
  const body = await readBody(req);
  const projectId = String(body.projectId || '').trim();
  const proj = loadProject(projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  ensureElementBuckets(proj);
  const uniqueItems = new Map();
  for (const item of Array.isArray(body.items) ? body.items : []) {
    const category = String(item?.category || '').trim();
    const index = Number(item?.index);
    if (!MAIN_CATEGORIES.includes(category) || !Number.isInteger(index) || index < 0) continue;
    const key = `${category}:${index}`;
    if (!uniqueItems.has(key)) uniqueItems.set(key, { category, index });
  }
  const grouped = new Map();
  for (const item of uniqueItems.values()) {
    if (!proj.elements[item.category][item.index]) continue;
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category).push(item.index);
  }
  if (!grouped.size) return sendJson(res, 400, { error: '没有可删除的元素' });

  const removedNames = [];
  const deletedFiles = [];
  let removedCount = 0;
  for (const [category, indexes] of grouped.entries()) {
    indexes.sort((a, b) => b - a);
    for (const index of indexes) {
      const [removed] = proj.elements[category].splice(index, 1);
      if (!removed) continue;
      removedCount++;
      const removedName = String(removed.name || '').trim();
      if (removedName) {
        removedNames.push(removedName);
        removeStoryboardElementRefs(proj, category, removedName);
      }
      deletedFiles.push(...await deleteElementImageFiles(projectId, category, removed));
    }
  }
  proj.updatedAt = new Date().toISOString();
  saveProject(proj);
  return sendJson(res, 200, { ok: true, removedCount, removedNames, deletedFiles, project: proj });
}

if (p === '/api/project/elements/import' && method === 'POST') {
  const body = await readBody(req);
  const projectId = String(body.projectId || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const proj = loadProject(projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  if (!proj.elements) proj.elements = { character: [], group: [], scene: [], prop: [], effect: [] };
  for (const c of MAIN_CATEGORIES) {
    if (!Array.isArray(proj.elements[c])) proj.elements[c] = [];
  }
  const cfg = loadConfig();
  const style = projectImageStyle(proj, cfg);
  const tpl = cfg.promptTemplate;
  let added = 0;
  let skipped = 0;
  const addedByCategory = { character: 0, group: 0, scene: 0, prop: 0, effect: 0, creature: 0 };
  for (const raw of items.slice(0, 300)) {
    const category = String(raw?.category || '').trim();
    if (!MAIN_CATEGORIES.includes(category)) {
      skipped++;
      continue;
    }
    const name = String(raw?.name || '').trim().slice(0, 80);
    const prompt = String(raw?.prompt || raw?.description || '').trim();
    if (!name || !prompt) {
      skipped++;
      continue;
    }
    if (proj.elements[category].some((el) => el.name === name)) {
      skipped++;
      continue;
    }
    let el;
    if (category === 'character') {
      const source = {
        name,
        identity: '',
        appearance: prompt,
        body: '',
        hair: '',
        clothing: '',
        makeupAccessories: '',
        traits: '',
        outfits: [],
        variants: [],
      };
      el = {
        name,
        userCreated: true,
        source,
        prompt,
        edited: true,
        outfits: [],
        variants: [],
        referenceImageName: characterReferenceImageName(name),
        referenceMode: 'none',
        useReferenceImage: false,
      };
    } else {
    const source = category === 'group'
      ? { name, identity: '', memberCount: '', sharedClothing: '', composition: '', members: [], description: prompt }
      : { name, description: prompt };
      el = { name, userCreated: true, source, prompt, edited: true };
    }
    proj.elements[category].push(el);
    added++;
    addedByCategory[category]++;
  }
  if (added) {
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
  }
  return sendJson(res, 200, { ok: true, added, skipped, addedByCategory });
}

if (p === '/api/project/elements/image-import' && method === 'POST') {
  const body = await readBody(req);
  const projectId = String(body.projectId || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const proj = loadProject(projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  ensureElementBuckets(proj);
  const cfg = loadConfig();
  let added = 0;
  let updated = 0;
  let imported = 0;
  let skipped = 0;
  const skippedByReason = { invalidCategory: 0, missingName: 0, invalidImage: 0, duplicate: 0 };
  const addedByCategory = { character: 0, group: 0, scene: 0, prop: 0, effect: 0, creature: 0 };
  const updatedByCategory = { character: 0, group: 0, scene: 0, prop: 0, effect: 0, creature: 0 };
  const seen = new Set();

  for (const raw of items.slice(0, 300)) {
    const category = String(raw?.category || '').trim();
    const name = String(raw?.name || '').trim().slice(0, 80);
    const imageB64 = cleanImageB64(raw?.imageB64);
    const dedupeKey = `${category}\u001f${name}`;
    if (!MAIN_CATEGORIES.includes(category)) {
      skippedByReason.invalidCategory++;
      skipped++;
      continue;
    }
    if (!name) {
      skippedByReason.missingName++;
      skipped++;
      continue;
    }
    if (!imageB64) {
      skippedByReason.invalidImage++;
      skipped++;
      continue;
    }
    if (seen.has(dedupeKey)) {
      skippedByReason.duplicate++;
      skipped++;
      continue;
    }
    seen.add(dedupeKey);
    let el = proj.elements[category].find((item) => item.name === name);
    if (!el) {
      el = createBlankElement(category, name, proj, cfg);
      proj.elements[category].push(el);
      added++;
      addedByCategory[category]++;
    } else {
      updated++;
      updatedByCategory[category]++;
    }
    // An explicit image import is a user-owned asset, even when it updates an
    // element that was originally created by extraction.
    el.userCreated = true;
    await saveImage(projectId, category, name, imageB64);
    removePendingImage(projectId, category, name);
    el.hasImage = true;
    el.hasPendingImage = false;
    imported++;
  }

  if (imported || added) {
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
  }
  return sendJson(res, 200, {
    ok: true,
    added,
    updated,
    imported,
    skipped,
    skippedByReason,
    addedByCategory,
    updatedByCategory,
  });
}

// 更新某元素（改名字/改提示词）
if (p === '/api/project/element' && method === 'POST') {
  const body = await readBody(req);
  const { projectId, category, index, name, prompt } = body;
  const proj = loadProject(projectId);
  if (!proj) return sendJson(res, 404, { error: '项目不存在' });
  const el = proj.elements?.[category]?.[index];
  if (!el) return sendJson(res, 404, { error: '元素不存在' });
  if (typeof name === 'string' && name.trim() && name.trim() !== el.name) {
    const oldName = el.name;
    const newName = name.trim();
    // 改名时让已有图片跟随改名，避免旧名图片变成孤儿
    await renameImage(projectId, category, oldName, newName);
    renamePendingImage(projectId, category, oldName, newName);
    // 人物的换装图命名为「角色名_服装名」，改角色名时一并迁移
    if (category === 'character' && Array.isArray(el.outfits)) {
      for (const o of el.outfits) {
        await renameImage(projectId, 'character', `${oldName}_${o.name}`, `${newName}_${o.name}`);
        renamePendingImage(projectId, 'character', `${oldName}_${o.name}`, `${newName}_${o.name}`);
      }
    }
    if (category === 'character' && Array.isArray(el.variants)) {
      for (const v of el.variants) {
        await renameImage(projectId, 'character', variantImageName(oldName, v.name), variantImageName(newName, v.name));
        renamePendingImage(projectId, 'character', variantImageName(oldName, v.name), variantImageName(newName, v.name));
        const legacyPattern = v.clothingReferenceImageRole === 'pattern';
        const oldOutfitReferenceName = legacyPattern
          ? `${variantClothingReferenceImageName(oldName, v.name)}__missing`
          : variantClothingReferenceImageName(oldName, v.name);
        const oldPatternReferenceName = legacyPattern
          ? variantClothingReferenceImageName(oldName, v.name)
          : variantLogoReferenceImageName(oldName, v.name);
        await renameImage(projectId, 'character', oldOutfitReferenceName, variantClothingReferenceImageName(newName, v.name));
        renamePendingImage(projectId, 'character', oldOutfitReferenceName, variantClothingReferenceImageName(newName, v.name));
        v.clothingReferenceImageName = variantClothingReferenceImageName(newName, v.name);
        await renameImage(projectId, 'character', oldPatternReferenceName, variantLogoReferenceImageName(newName, v.name));
        renamePendingImage(projectId, 'character', oldPatternReferenceName, variantLogoReferenceImageName(newName, v.name));
        v.clothingReferencePatternImageName = variantLogoReferenceImageName(newName, v.name);
        v.logoReferenceImageName = v.clothingReferencePatternImageName;
      }
    }
    if (category === 'character') {
      await renameImage(projectId, 'character', characterReferenceImageName(oldName), characterReferenceImageName(newName));
      await renameCharacterVoice(projectId, oldName, newName);
      el.referenceImageName = characterReferenceImageName(newName);
      el.voiceAudioName = `${newName}_音频`;
    }
    if (category === 'scene' && Array.isArray(el.areas)) {
      for (const area of el.areas) {
        await renameImage(projectId, 'scene', `${oldName}_${area.name}`, `${newName}_${area.name}`);
        renamePendingImage(projectId, 'scene', `${oldName}_${area.name}`, `${newName}_${area.name}`);
      }
    }
    renameStoryboardElementRefs(proj, category, oldName, newName);
    el.name = newName;
  }
  if (el.source && typeof el.source === 'object') {
    el.source.name = el.name;
  }
  if (typeof body.alias === 'string') {
    const alias = body.alias.trim().slice(0, 40);
    if (alias) el.alias = alias;
    else delete el.alias;
  }
  if (category === 'character' && (body.aliases !== undefined || body.characterAliases !== undefined)) {
    const aliases = normalizeAliasList(
      body.aliases !== undefined ? body.aliases : body.characterAliases,
      el.name
    );
    el.aliases = aliases;
    if (el.source && typeof el.source === 'object') {
      el.source.aliases = aliases;
    }
  }
  if (category === 'character' && typeof body.useReferenceImage === 'boolean') {
    el.useReferenceImage = body.useReferenceImage;
    if (!el.referenceImageName) el.referenceImageName = characterReferenceImageName(el.name);
  }
  if (category === 'character' && typeof body.referenceMode === 'string') {
    el.referenceMode = normalizeReferenceMode(body.referenceMode, el.useReferenceImage ? 'character' : 'none');
    el.useReferenceImage = el.referenceMode !== 'none';
    if (!el.referenceImageName) el.referenceImageName = characterReferenceImageName(el.name);
  }
  if (category === 'character' && typeof prompt === 'string') {
    const promptChanged = prompt !== el.prompt;
    if (promptChanged) el.edited = true;
    el.prompt = prompt;
    if (promptChanged) {
      delete el.promptParts;
      delete el.partsEdited;
    }
  } else if (category === 'character' && body.promptParts) {
    el.promptParts = normalizeCharacterPromptParts(body.promptParts);
    el.partsEdited = normalizeCharacterPartsEdited(body.partsEdited);
    const cfg = loadConfig();
    const style = projectImageStyle(proj, cfg);
    el.prompt = buildCharacterPromptFromParts(el.promptParts, el.source || el, style, cfg.promptTemplate, cfg.stylePrompts);
    el.edited = Object.values(el.partsEdited).some(Boolean);
  } else if (typeof prompt === 'string') {
    if (prompt !== el.prompt) el.edited = true; // 标记用户改过，重新提取时不覆盖
    el.prompt = prompt;
  }
  saveProject(proj);
  return sendJson(res, 200, {
    ok: true,
    prompt: el.prompt || '',
    alias: el.alias || '',
    aliases: category === 'character'
      ? normalizeAliasList([el.aliases, el.source?.aliases], el.name)
      : [],
    promptParts: el.promptParts,
    partsEdited: el.partsEdited,
    useReferenceImage: !!el.useReferenceImage,
    referenceMode: el.referenceMode || 'none',
    referenceImageName: el.referenceImageName || '',
    hasReferenceImage: category === 'character' ? fs.existsSync(imageDiskPath(projectId, 'character', el.referenceImageName || characterReferenceImageName(el.name))) : false,
  });
}

  return false;
}
