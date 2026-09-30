import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { randomUUID } from 'crypto';

import { cleanFileB64, normalizeVoiceAudio, safeAudioExt } from '../audioTrim.js';
import { loadConfig, TEMP_DIR } from '../config.js';
import {
  getPendingImage,
  removePendingImage,
  renamePendingImage,
  setPendingImage,
} from '../pendingImages.js';
import { buildOutfitPrompt, buildVariantPrompt } from '../prompts.js';
import {
  characterVoiceDiskPath,
  characterVoiceDiskPaths,
  characterVoiceRelPath,
  ensureAudioDir,
  imageDiskPath,
  labeledDiskPath,
  labeledMetadataPath,
  loadProject,
  renameImage,
  saveImage,
  saveProject,
} from '../storage.js';

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

function cleanImageB64(value) {
  const raw = String(value || '').trim();
  const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
  if (!b64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return '';
  return b64.replace(/\s+/g, '');
}

const CHARACTER_ASSET_TYPES = {
  variant: { listKey: 'variants', label: '造型' },
  outfit: { listKey: 'outfits', label: '造型' },
};

function cleanCharacterAssetName(value) {
  return String(value || '').trim().slice(0, 80);
}

function sameCharacterAssetName(left, right) {
  return cleanCharacterAssetName(left).toLocaleLowerCase() === cleanCharacterAssetName(right).toLocaleLowerCase();
}

function characterPrimaryLook(character) {
  const state = character?.primaryLook;
  if (!CHARACTER_ASSET_TYPES[state?.type]) return null;
  const name = cleanCharacterAssetName(state.name);
  const backupImageName = cleanCharacterAssetName(state.backupImageName);
  if (!name || !backupImageName) return null;
  return { type: state.type, name, backupImageName };
}

function isCharacterPrimaryLook(character, type, name) {
  const state = characterPrimaryLook(character);
  return !!state && state.type === type && sameCharacterAssetName(state.name, name);
}

function updateCharacterPrimaryLookName(character, type, previousName, nextName) {
  if (!isCharacterPrimaryLook(character, type, previousName)) return false;
  character.primaryLook.name = cleanCharacterAssetName(nextName);
  return true;
}

function hasCharacterLookName(character, name, excludedType = '', excludedIndex = -1) {
  return ['variant', 'outfit'].some((type) => {
    const list = Array.isArray(character?.[CHARACTER_ASSET_TYPES[type].listKey])
      ? character[CHARACTER_ASSET_TYPES[type].listKey]
      : [];
    return list.some((item, index) => (
      !(type === excludedType && index === excludedIndex) && sameCharacterAssetName(item?.name, name)
    ));
  });
}

function ensureCharacterAssetLists(character) {
  if (!Array.isArray(character.variants)) character.variants = [];
  if (!Array.isArray(character.outfits)) character.outfits = [];
  if (!character.source || typeof character.source !== 'object') {
    character.source = {
      name: character.name,
      identity: character.identity || '',
      appearance: character.appearance || '',
      body: character.body || '',
      hair: character.hair || '',
      clothing: character.clothing || '',
      makeupAccessories: character.makeupAccessories || '',
      traits: character.traits || '',
    };
  }
  if (!Array.isArray(character.source.variants)) character.source.variants = [];
  if (!Array.isArray(character.source.outfits)) character.source.outfits = [];
}

function characterAssetSourceValue(type, asset) {
  if (type === 'outfit') {
    return { name: asset.name, desc: asset.desc || '', userCreated: asset.userCreated === true };
  }
  return {
    name: asset.name,
    desc: asset.desc || '',
    identity: asset.identity || '',
    appearance: asset.appearance || '',
    body: asset.body || '',
    hair: asset.hair || '',
    clothing: asset.clothing || '',
    clothingReferenceOutfitName: asset.clothingReferenceOutfitName || '',
    clothingReferenceImageRole: asset.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit',
    clothingReferenceOutfitImageName: asset.clothingReferenceOutfitImageName || asset.clothingReferenceImageName || '',
    clothingReferencePatternImageName: asset.clothingReferencePatternImageName || asset.logoReferenceImageName || '',
    makeupAccessories: asset.makeupAccessories || '',
    traits: asset.traits || '',
    userCreated: asset.userCreated === true,
  };
}

function syncCharacterAssetSource(character, type, asset, previousName = '') {
  ensureCharacterAssetLists(character);
  const { listKey } = CHARACTER_ASSET_TYPES[type];
  const sourceList = character.source[listKey];
  let sourceAsset = sourceList.find((item) => sameCharacterAssetName(item?.name, previousName || asset.name));
  if (!sourceAsset) sourceAsset = sourceList.find((item) => sameCharacterAssetName(item?.name, asset.name));
  if (!sourceAsset) {
    sourceAsset = {};
    sourceList.push(sourceAsset);
  }
  Object.assign(sourceAsset, characterAssetSourceValue(type, asset));
}

function removeCharacterAssetSource(character, type, assetName) {
  ensureCharacterAssetLists(character);
  const { listKey } = CHARACTER_ASSET_TYPES[type];
  character.source[listKey] = character.source[listKey].filter(
    (item) => !sameCharacterAssetName(item?.name, assetName)
  );
}

async function deleteCharacterAssetImage(projectId, imageName) {
  const deletedFiles = [];
  const cleanupWarnings = [];
  for (const file of [
    imageDiskPath(projectId, 'character', imageName),
    labeledDiskPath(projectId, 'character', imageName),
    labeledMetadataPath(projectId, 'character', imageName),
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
    removedPendingImage = removePendingImage(projectId, 'character', imageName);
  } catch (error) {
    cleanupWarnings.push(`pending:${imageName}: ${error.message}`);
  }
  return { deletedFiles, cleanupWarnings, removedPendingImage };
}

function characterAssetBindingName(characterName, type, assetName) {
  return type === 'variant'
    ? `${characterName}·${assetName}`
    : `${characterName}·服饰·${assetName}`;
}

function renameStoryboardCharacterAssetRefs(project, characterName, type, previousName, nextName) {
  const previousBinding = characterAssetBindingName(characterName, type, previousName);
  const nextBinding = characterAssetBindingName(characterName, type, nextName);
  for (const storyboard of project?.script?.storyboards || []) {
    for (const bucket of ['manualTags', 'excludedTags']) {
      for (const tags of Object.values(storyboard?.[bucket] || {})) {
        if (!Array.isArray(tags)) continue;
        for (const tag of tags) {
          if (tag?.cat === 'character' && tag.name === previousBinding) tag.name = nextBinding;
        }
      }
    }
  }
}

function removeStoryboardCharacterAssetRefs(project, characterName, type, assetName) {
  const bindingName = characterAssetBindingName(characterName, type, assetName);
  for (const storyboard of project?.script?.storyboards || []) {
    for (const key of new Set([
      ...Object.keys(storyboard?.manualTags || {}),
      ...Object.keys(storyboard?.excludedTags || {}),
    ])) {
      const manual = Array.isArray(storyboard.manualTags?.[key]) ? storyboard.manualTags[key] : [];
      const removedSelectedLook = manual.some(
        (tag) => tag?.cat === 'character' && tag.name === bindingName && tag.source === 'look',
      );
      const nextManual = manual.filter((tag) => !(tag?.cat === 'character' && tag.name === bindingName));
      if (nextManual.length) storyboard.manualTags[key] = nextManual;
      else if (storyboard.manualTags) delete storyboard.manualTags[key];

      const excluded = Array.isArray(storyboard.excludedTags?.[key]) ? storyboard.excludedTags[key] : [];
      const nextExcluded = excluded.filter((tag) => {
        if (tag?.cat === 'character' && tag.name === bindingName) return false;
        return !(removedSelectedLook && tag?.cat === 'character' && tag.source === 'look' && tag.ownerName === characterName);
      });
      if (nextExcluded.length) storyboard.excludedTags[key] = nextExcluded;
      else if (storyboard.excludedTags) delete storyboard.excludedTags[key];
    }
  }
}

function characterImageState(projectId, imageName) {
  const hasImage = fs.existsSync(imageDiskPath(projectId, 'character', imageName));
  return {
    hasImage,
    hasPendingImage: !hasImage && !!getPendingImage(projectId, 'character', imageName),
  };
}

async function copyCharacterImage(projectId, sourceImageName, targetImageName) {
  if (!sourceImageName || !targetImageName || sourceImageName === targetImageName) return false;
  const sourceFile = imageDiskPath(projectId, 'character', sourceImageName);
  const targetFile = imageDiskPath(projectId, 'character', targetImageName);
  const sourceExists = fs.existsSync(sourceFile);
  const pending = sourceExists ? null : getPendingImage(projectId, 'character', sourceImageName);
  if (!sourceExists && !pending) return false;

  await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
  if (sourceExists) {
    await fs.promises.copyFile(sourceFile, targetFile);
    removePendingImage(projectId, 'character', targetImageName);
  } else {
    await fs.promises.unlink(targetFile).catch(() => {});
    setPendingImage({
      ...pending,
      projectId,
      category: 'character',
      imageName: targetImageName,
    });
  }
  await fs.promises.unlink(labeledDiskPath(projectId, 'character', targetImageName)).catch(() => {});
  await fs.promises.unlink(labeledMetadataPath(projectId, 'character', targetImageName)).catch(() => {});
  return true;
}

function characterAssetImageName(character, type, assetName, variantImageName) {
  return type === 'variant'
    ? variantImageName(character.name, assetName)
    : `${character.name}_${assetName}`;
}

function variantClothingReferenceImageName(characterName, variantName, referenceType = 'outfit') {
  return `${characterName}_形态_${variantName}_${referenceType === 'pattern' ? 'Logo参考' : '服装参考'}`;
}

function findCharacterAsset(character, type, name) {
  const assetType = CHARACTER_ASSET_TYPES[type];
  if (!assetType) return null;
  const list = Array.isArray(character?.[assetType.listKey]) ? character[assetType.listKey] : [];
  const assetIndex = list.findIndex((item) => sameCharacterAssetName(item?.name, name));
  return assetIndex >= 0 ? { asset: list[assetIndex], assetIndex } : null;
}

async function removeCharacterImageCopy(projectId, imageName) {
  for (const file of [
    imageDiskPath(projectId, 'character', imageName),
    labeledDiskPath(projectId, 'character', imageName),
    labeledMetadataPath(projectId, 'character', imageName),
  ]) {
    await fs.promises.unlink(file).catch(() => {});
  }
  removePendingImage(projectId, 'character', imageName);
}

async function restoreCharacterPrimaryLook(projectId, character, variantImageName) {
  const active = characterPrimaryLook(character);
  if (!active) return false;
  const current = findCharacterAsset(character, active.type, active.name);
  if (!current) throw new Error('当前主造型已不存在，请刷新项目后重试');
  const mainImageName = character.name;
  const assetImageName = characterAssetImageName(character, active.type, current.asset.name, variantImageName);
  const backupAvailable = characterImageState(projectId, active.backupImageName);
  if (!backupAvailable.hasImage && !backupAvailable.hasPendingImage) {
    throw new Error('原始主形态备份已丢失，无法安全恢复');
  }
  await copyCharacterImage(projectId, mainImageName, assetImageName);
  await copyCharacterImage(projectId, active.backupImageName, mainImageName);
  await removeCharacterImageCopy(projectId, active.backupImageName);
  delete character.primaryLook;
  return { ...current, type: active.type, imageName: assetImageName };
}

function createCharacterAsset(type, name, desc, character, style, config) {
  if (type === 'outfit') {
    const outfit = { name, desc, prompt: '', promptEdited: false, userCreated: true };
    outfit.prompt = buildOutfitPrompt(outfit, style, config.stylePrompts);
    return outfit;
  }
  const variant = {
    name,
    desc,
    userCreated: true,
    identity: '',
    appearance: '',
    body: '',
    hair: '',
    clothing: '',
    clothingReferenceOutfitName: '',
    clothingReferenceImageRole: 'outfit',
    clothingReferenceOutfitImageName: '',
    clothingReferencePatternImageName: '',
    makeupAccessories: '',
    traits: '',
    prompt: '',
    promptEdited: false,
  };
  variant.prompt = buildVariantPrompt(character.source || character, variant, style, config.promptTemplate, config.stylePrompts);
  return variant;
}

export async function handleCharacterAssetRoutes(ctx) {
  const {
    req,
    res,
    p,
    method,
    readBody,
    sendJson,
    projectImageStyle,
    globalReferenceImageName,
    characterReferenceImageName,
    variantImageName,
  } = ctx;

  if (p === '/api/project/character-asset/add' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    const charIndex = Number(body.charIndex);
    const type = String(body.type || '').trim();
    const assetType = CHARACTER_ASSET_TYPES[type];
    const name = cleanCharacterAssetName(body.name);
    const desc = String(body.desc || '').trim().slice(0, 4000);
    if (!assetType) return handled(sendJson, res, 400, { error: '素材类型无效' });
    if (!name) return handled(sendJson, res, 400, { error: `请填写${assetType.label}名称` });
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    if (!ch) return handled(sendJson, res, 404, { error: '人物不存在' });
    ensureCharacterAssetLists(ch);
    const list = ch[assetType.listKey];
    if (hasCharacterLookName(ch, name)) {
      return handled(sendJson, res, 400, { error: `已存在同名${assetType.label}` });
    }
    const cfg = loadConfig();
    const asset = createCharacterAsset(type, name, desc, ch, projectImageStyle(proj, cfg), cfg);
    list.push(asset);
    syncCharacterAssetSource(ch, type, asset);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      type,
      index: list.length - 1,
      asset,
    });
  }

  if (p === '/api/project/character-asset/delete' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    const charIndex = Number(body.charIndex);
    const assetIndex = Number(body.assetIndex);
    const type = String(body.type || '').trim();
    const assetType = CHARACTER_ASSET_TYPES[type];
    if (!assetType) return handled(sendJson, res, 400, { error: '素材类型无效' });
    if (!Number.isInteger(assetIndex) || assetIndex < 0) {
      return handled(sendJson, res, 400, { error: `${assetType.label}索引无效` });
    }
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    if (!ch) return handled(sendJson, res, 404, { error: '人物不存在' });
    ensureCharacterAssetLists(ch);
    const list = ch[assetType.listKey];
    const asset = list[assetIndex];
    if (!asset) return handled(sendJson, res, 404, { error: `${assetType.label}不存在` });
    const expectedName = cleanCharacterAssetName(body.name);
    if (expectedName && !sameCharacterAssetName(asset.name, expectedName)) {
      return handled(sendJson, res, 409, { error: `${assetType.label}列表已变化，请刷新后重试` });
    }

    if (isCharacterPrimaryLook(ch, type, asset.name)) {
      try {
        await restoreCharacterPrimaryLook(projectId, ch, variantImageName);
      } catch (error) {
        return handled(sendJson, res, 409, { error: error.message || '无法恢复原始主形态' });
      }
    }
    const [removedAsset] = list.splice(assetIndex, 1);
    removeCharacterAssetSource(ch, type, removedAsset.name);
    removeStoryboardCharacterAssetRefs(proj, ch.name, type, removedAsset.name);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);

    const imageName = type === 'variant'
      ? variantImageName(ch.name, removedAsset.name)
      : `${ch.name}_${removedAsset.name}`;
    const cleanup = await deleteCharacterAssetImage(projectId, imageName);
    const referenceCleanup = type === 'variant'
      ? await Promise.all([
        deleteCharacterAssetImage(projectId, variantClothingReferenceImageName(ch.name, removedAsset.name, 'outfit')),
        deleteCharacterAssetImage(projectId, variantClothingReferenceImageName(ch.name, removedAsset.name, 'pattern')),
      ]).then((items) => ({
        deletedFiles: items.flatMap((item) => item.deletedFiles),
        cleanupWarnings: items.flatMap((item) => item.cleanupWarnings),
        removedPendingImage: items.some((item) => item.removedPendingImage),
      }))
      : { deletedFiles: [], cleanupWarnings: [], removedPendingImage: false };
    return handled(sendJson, res, 200, {
      ok: true,
      type,
      assetIndex,
      removedName: removedAsset.name,
      deletedFiles: [...cleanup.deletedFiles, ...referenceCleanup.deletedFiles],
      removedPendingImage: cleanup.removedPendingImage || referenceCleanup.removedPendingImage,
      cleanupWarnings: [...cleanup.cleanupWarnings, ...referenceCleanup.cleanupWarnings],
      primaryLook: characterPrimaryLook(ch),
    });
  }

  if (p === '/api/project/character-asset/swap-primary' && method === 'POST') {
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    const charIndex = Number(body.charIndex);
    const assetIndex = Number(body.assetIndex);
    const type = String(body.type || '').trim();
    const assetType = CHARACTER_ASSET_TYPES[type];
    if (!assetType) return handled(sendJson, res, 400, { error: '素材类型无效' });
    if (!Number.isInteger(assetIndex) || assetIndex < 0) {
      return handled(sendJson, res, 400, { error: `${assetType.label}索引无效` });
    }
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    if (!ch) return handled(sendJson, res, 404, { error: '人物不存在' });
    ensureCharacterAssetLists(ch);
    const asset = ch[assetType.listKey][assetIndex];
    if (!asset) return handled(sendJson, res, 404, { error: `${assetType.label}不存在` });
    const expectedName = cleanCharacterAssetName(body.name);
    if (expectedName && !sameCharacterAssetName(asset.name, expectedName)) {
      return handled(sendJson, res, 409, { error: `${assetType.label}列表已变化，请刷新后重试` });
    }

    const mainImageName = ch.name;
    const assetImageName = characterAssetImageName(ch, type, asset.name, variantImageName);
    const mainBefore = characterImageState(projectId, mainImageName);
    const assetBefore = characterImageState(projectId, assetImageName);
    const mainAvailable = mainBefore.hasImage || mainBefore.hasPendingImage;
    const assetAvailable = assetBefore.hasImage || assetBefore.hasPendingImage;
    if (!mainAvailable || !assetAvailable) {
      return handled(sendJson, res, 400, { error: '主形态和目标素材都需要先有图片或待同步图片，才能互相切换' });
    }

    const activeBefore = characterPrimaryLook(ch);
    if (ch.primaryLook && !activeBefore) {
      return handled(sendJson, res, 409, { error: '主形态切换状态无效，请刷新项目后重试' });
    }
    const updatedAssets = [];
    let action = 'activated';
    if (activeBefore && isCharacterPrimaryLook(ch, type, asset.name)) {
      const restored = await restoreCharacterPrimaryLook(projectId, ch, variantImageName);
      updatedAssets.push({
        type: restored.type,
        assetIndex: restored.assetIndex,
        assetName: restored.asset.name,
        ...characterImageState(projectId, restored.imageName),
      });
      action = 'restored';
    } else {
      if (activeBefore) {
        const activeAsset = findCharacterAsset(ch, activeBefore.type, activeBefore.name);
        const backupState = characterImageState(projectId, activeBefore.backupImageName);
        if (!activeAsset || (!backupState.hasImage && !backupState.hasPendingImage)) {
          return handled(sendJson, res, 409, { error: '上一个主造型状态不完整，无法安全切换' });
        }
        const activeImageName = characterAssetImageName(ch, activeBefore.type, activeAsset.asset.name, variantImageName);
        await copyCharacterImage(projectId, mainImageName, activeImageName);
        updatedAssets.push({
          type: activeBefore.type,
          assetIndex: activeAsset.assetIndex,
          assetName: activeAsset.asset.name,
          ...characterImageState(projectId, activeImageName),
        });
      } else {
        const backupImageName = `__primary-look-backup-${randomUUID()}`;
        await copyCharacterImage(projectId, mainImageName, backupImageName);
        ch.primaryLook = { type, name: asset.name, backupImageName };
      }
      await copyCharacterImage(projectId, assetImageName, mainImageName);
      ch.primaryLook = {
        ...(ch.primaryLook || {}),
        type,
        name: asset.name,
      };
      updatedAssets.push({
        type,
        assetIndex,
        assetName: asset.name,
        ...characterImageState(projectId, assetImageName),
      });
    }
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      type,
      assetIndex,
      assetName: asset.name,
      action,
      primaryLook: characterPrimaryLook(ch),
      main: characterImageState(projectId, mainImageName),
      asset: characterImageState(projectId, assetImageName),
      updatedAssets,
    });
  }

  if (p === '/api/project/outfit' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, outfitIndex, name, desc, prompt, promptEdited } = body;
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const outfit = ch?.outfits?.[outfitIndex];
    if (!outfit) return handled(sendJson, res, 404, { error: '造型不存在' });
    const previousName = outfit.name;
    if (typeof name === 'string' && cleanCharacterAssetName(name) && cleanCharacterAssetName(name) !== outfit.name) {
      const newName = cleanCharacterAssetName(name);
      if (hasCharacterLookName(ch, newName, 'outfit', outfitIndex)) {
        return handled(sendJson, res, 400, { error: '已存在同名造型' });
      }
      const oldImageName = `${ch.name}_${outfit.name}`;
      const newImageName = `${ch.name}_${newName}`;
      await renameImage(projectId, 'character', oldImageName, newImageName);
      renamePendingImage(projectId, 'character', oldImageName, newImageName);
      outfit.name = newName;
      updateCharacterPrimaryLookName(ch, 'outfit', previousName, newName);
      renameStoryboardCharacterAssetRefs(proj, ch.name, 'outfit', previousName, newName);
    }
    if (typeof promptEdited === 'boolean') outfit.promptEdited = promptEdited;
    if (typeof desc === 'string') outfit.desc = desc;
    if (typeof prompt === 'string') outfit.prompt = prompt;
    if (!outfit.promptEdited) {
      const cfg = loadConfig();
      outfit.prompt = buildOutfitPrompt(outfit, projectImageStyle(proj, cfg), cfg.stylePrompts);
    }
    syncCharacterAssetSource(ch, 'outfit', outfit, previousName);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      primaryLook: characterPrimaryLook(ch),
      outfit: {
        name: outfit.name,
        desc: outfit.desc || '',
        prompt: outfit.prompt || '',
        promptEdited: !!outfit.promptEdited,
      },
    });
  }

  if (p === '/api/project/variant' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, variantIndex, name, desc, identity, appearance, body: bodyDesc, hair, clothing, clothingReferenceOutfitName, clothingReferenceImageRole, makeupAccessories, traits, prompt, promptEdited } = body;
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const variant = ch?.variants?.[variantIndex];
    if (!variant) return handled(sendJson, res, 404, { error: '造型不存在' });
    const previousName = variant.name;
    if (typeof name === 'string' && cleanCharacterAssetName(name) && cleanCharacterAssetName(name) !== variant.name) {
      const newName = cleanCharacterAssetName(name);
      if (hasCharacterLookName(ch, newName, 'variant', variantIndex)) {
        return handled(sendJson, res, 400, { error: '已存在同名造型' });
      }
      const oldImageName = variantImageName(ch.name, variant.name);
      const newImageName = variantImageName(ch.name, newName);
      await renameImage(projectId, 'character', oldImageName, newImageName);
      renamePendingImage(projectId, 'character', oldImageName, newImageName);
      const legacyPatternImageName = variant.clothingReferenceImageRole === 'pattern'
        && !variant.clothingReferencePatternImageName
        && !variant.logoReferenceImageName
        ? variantClothingReferenceImageName(ch.name, variant.name, 'outfit')
        : '';
      for (const referenceType of ['outfit', 'pattern']) {
        const oldClothingReferenceName = referenceType === 'pattern' && legacyPatternImageName
          ? legacyPatternImageName
          : referenceType === 'outfit' && legacyPatternImageName
            ? variantClothingReferenceImageName(ch.name, variant.name, 'outfit') + '__missing'
            : variantClothingReferenceImageName(ch.name, variant.name, referenceType);
        const newClothingReferenceName = variantClothingReferenceImageName(ch.name, newName, referenceType);
        await renameImage(projectId, 'character', oldClothingReferenceName, newClothingReferenceName);
        renamePendingImage(projectId, 'character', oldClothingReferenceName, newClothingReferenceName);
        if (referenceType === 'outfit') {
          variant.clothingReferenceImageName = newClothingReferenceName;
          variant.clothingReferenceOutfitImageName = newClothingReferenceName;
        } else {
          variant.clothingReferencePatternImageName = newClothingReferenceName;
          variant.logoReferenceImageName = newClothingReferenceName;
        }
      }
      variant.name = newName;
      updateCharacterPrimaryLookName(ch, 'variant', previousName, newName);
      renameStoryboardCharacterAssetRefs(proj, ch.name, 'variant', previousName, newName);
    }
    if (typeof promptEdited === 'boolean') variant.promptEdited = promptEdited;
    if (typeof desc === 'string') variant.desc = desc;
    if (typeof identity === 'string') variant.identity = identity;
    if (typeof appearance === 'string') variant.appearance = appearance;
    if (typeof bodyDesc === 'string') variant.body = bodyDesc;
    if (typeof hair === 'string') variant.hair = hair;
    if (typeof clothing === 'string') variant.clothing = clothing;
    if (typeof clothingReferenceOutfitName === 'string') {
      const requestedOutfit = cleanCharacterAssetName(clothingReferenceOutfitName);
      const outfit = (ch.outfits || []).find((item) => sameCharacterAssetName(item?.name, requestedOutfit));
      if (requestedOutfit && !outfit) return handled(sendJson, res, 400, { error: '参考服装不存在，请刷新后重试' });
      variant.clothingReferenceOutfitName = outfit?.name || '';
    }
    if (typeof clothingReferenceImageRole === 'string') {
      variant.clothingReferenceImageRole = clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit';
    }
    if (typeof makeupAccessories === 'string') variant.makeupAccessories = makeupAccessories;
    if (typeof traits === 'string') variant.traits = traits;
    if (typeof prompt === 'string') variant.prompt = prompt;
    if (!variant.promptEdited) {
      const cfg = loadConfig();
      variant.prompt = buildVariantPrompt(ch.source || ch, variant, projectImageStyle(proj, cfg), cfg.promptTemplate, cfg.stylePrompts);
    }
    syncCharacterAssetSource(ch, 'variant', variant, previousName);
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      primaryLook: characterPrimaryLook(ch),
      variant: {
        name: variant.name,
        desc: variant.desc || '',
        identity: variant.identity || '',
        appearance: variant.appearance || '',
        body: variant.body || '',
        hair: variant.hair || '',
        clothing: variant.clothing || '',
        clothingReferenceOutfitName: variant.clothingReferenceOutfitName || '',
        clothingReferenceImageRole: variant.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit',
        clothingReferenceOutfitImageName: variant.clothingReferenceOutfitImageName || variant.clothingReferenceImageName || '',
        clothingReferencePatternImageName: variant.clothingReferencePatternImageName || variant.logoReferenceImageName || '',
        makeupAccessories: variant.makeupAccessories || '',
        traits: variant.traits || '',
        prompt: variant.prompt || '',
        promptEdited: !!variant.promptEdited,
      },
    });
  }

  if (p === '/api/project/reference/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId } = body;
    const imageB64 = cleanImageB64(body.imageB64);
    if (!imageB64) return handled(sendJson, res, 400, { error: '图片数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const refName = globalReferenceImageName();
    await saveImage(projectId, 'character', refName, imageB64);
    proj.globalReferenceImageName = refName;
    proj.useGlobalReferenceImage = true;
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      globalReferenceImageName: refName,
      hasGlobalReferenceImage: true,
      useGlobalReferenceImage: true,
    });
  }

  if (p === '/api/project/reference/delete' && method === 'POST') {
    const body = await readBody(req);
    const { projectId } = body;
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const refName = proj.globalReferenceImageName || globalReferenceImageName();
    const refFile = imageDiskPath(projectId, 'character', refName);
    if (fs.existsSync(refFile)) await fs.promises.unlink(refFile);
    proj.globalReferenceImageName = globalReferenceImageName();
    proj.useGlobalReferenceImage = false;
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      globalReferenceImageName: proj.globalReferenceImageName,
      hasGlobalReferenceImage: false,
      useGlobalReferenceImage: false,
    });
  }

  if (p === '/api/character/reference/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex } = body;
    const imageB64 = cleanImageB64(body.imageB64);
    if (!imageB64) return handled(sendJson, res, 400, { error: '图片数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    if (!ch) return handled(sendJson, res, 404, { error: '人物不存在' });
    const refName = characterReferenceImageName(ch.name);
    await saveImage(projectId, 'character', refName, imageB64);
    ch.referenceImageName = refName;
    ch.useReferenceImage = true;
    ch.referenceMode = 'character';
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      referenceImageName: refName,
      referenceImageUrl: `/img/${encodeURIComponent(projectId)}/character/${encodeURIComponent(refName)}.png?t=${Date.now()}`,
    });
  }

  if (p === '/api/character/reference/delete' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex } = body;
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    if (!ch) return handled(sendJson, res, 404, { error: '人物不存在' });
    const refName = ch.referenceImageName || characterReferenceImageName(ch.name);
    const refFile = imageDiskPath(projectId, 'character', refName);
    if (fs.existsSync(refFile)) await fs.promises.unlink(refFile);
    ch.referenceImageName = characterReferenceImageName(ch.name);
    ch.useReferenceImage = false;
    ch.referenceMode = 'none';
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, {
      ok: true,
      referenceImageName: ch.referenceImageName,
      hasReferenceImage: false,
      referenceMode: 'none',
      useReferenceImage: false,
    });
  }

  if (p === '/api/character/audio/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex } = body;
    const audioB64 = cleanFileB64(body.audioB64);
    if (!audioB64) return handled(sendJson, res, 400, { error: '音频数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    if (!ch) return handled(sendJson, res, 404, { error: '人物不存在' });
    const tempDir = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'novel-character-audio-'));
    const tempInput = path.join(tempDir, `input${safeAudioExt(body.fileName, body.mimeType)}`);
    try {
      await fs.promises.writeFile(tempInput, Buffer.from(audioB64, 'base64'));
      await ensureAudioDir(projectId);
      const dest = characterVoiceDiskPath(projectId, ch.name);
      const audio = await normalizeVoiceAudio(tempInput, dest);
      ch.voiceAudioName = `${ch.name}_音频`;
      ch.hasVoiceAudio = true;
      ch.voiceAudioUpdatedAt = new Date().toISOString();
      proj.updatedAt = new Date().toISOString();
      saveProject(proj);
      return handled(sendJson, res, 200, {
        ok: true,
        hasVoiceAudio: true,
        voiceAudioName: ch.voiceAudioName,
        voiceAudioUrl: `/audio/${encodeURIComponent(projectId)}/character/${encodeURIComponent(ch.name)}.mp3?t=${Date.now()}`,
        relPath: characterVoiceRelPath(projectId, ch.name),
        audio,
      });
    } catch (e) {
      return handled(sendJson, res, 500, { error: `音频处理失败：${e.message}` });
    } finally {
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (p === '/api/character/audio/delete' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex } = body;
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    if (!ch) return handled(sendJson, res, 404, { error: '人物不存在' });
    for (const file of characterVoiceDiskPaths(projectId, ch.name)) {
      try {
        if (fs.existsSync(file)) await fs.promises.unlink(file);
      } catch {
        // best effort cleanup
      }
    }
    ch.hasVoiceAudio = false;
    ch.voiceAudioName = `${ch.name}_音频`;
    ch.voiceAudioUpdatedAt = '';
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return handled(sendJson, res, 200, { ok: true, hasVoiceAudio: false, voiceAudioName: ch.voiceAudioName });
  }

  return false;
}
