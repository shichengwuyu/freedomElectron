import fs from 'fs';
import path from 'path';

import { readJsonFile } from '../lib/atomicJson.js';
import { projectDir, sanitizeFilename } from '../storage.js';

const ASSET_LIST_KEYS = ['variants', 'outfits'];

function cleanName(value) {
  return String(value || '').trim();
}

function nameKey(value) {
  return cleanName(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function cloneRecord(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

function characterMap(elements = {}) {
  return new Map((Array.isArray(elements?.character) ? elements.character : [])
    .map((character) => [nameKey(character?.name || character?.source?.name), character])
    .filter(([key]) => key));
}

function mergeAssetList(target, source, listKey, predicate = () => true) {
  const sourceItems = Array.isArray(source?.[listKey]) ? source[listKey] : [];
  if (!sourceItems.length) return 0;
  if (!Array.isArray(target[listKey])) target[listKey] = [];
  const existing = new Map(target[listKey].map((item) => [nameKey(item?.name), item]).filter(([key]) => key));
  let restored = 0;
  for (const item of sourceItems) {
    const key = nameKey(item?.name);
    if (!key || existing.has(key) || !predicate(item)) continue;
    const copy = cloneRecord(item);
    target[listKey].push(copy);
    existing.set(key, copy);
    restored += 1;
  }
  return restored;
}

function syncCharacterSourceAssets(character) {
  if (!character.source || typeof character.source !== 'object') return 0;
  let restored = 0;
  for (const listKey of ASSET_LIST_KEYS) {
    restored += mergeAssetList(character.source, character, listKey);
  }
  return restored;
}

export function preserveCharacterAssetIndexes(targetElements = {}, preservedElements = {}) {
  const targets = characterMap(targetElements);
  let restored = 0;
  for (const [key, source] of characterMap(preservedElements)) {
    const target = targets.get(key);
    if (!target) continue;
    for (const listKey of ASSET_LIST_KEYS) {
      restored += mergeAssetList(target, source, listKey);
      if (source.source && target.source) {
        restored += mergeAssetList(target.source, source.source, listKey);
      }
    }
    restored += syncCharacterSourceAssets(target);
  }
  return restored;
}

function characterImageDirectory(projectId) {
  return path.join(projectDir(projectId), 'images', '人物');
}

function imageBasenames(projectId) {
  const directory = characterImageDirectory(projectId);
  try {
    return new Set(fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.png')
      .map((entry) => path.basename(entry.name, path.extname(entry.name))));
  } catch {
    return new Set();
  }
}

function assetImageBase(character, listKey, asset) {
  const characterName = cleanName(character?.name);
  const assetName = cleanName(asset?.name);
  if (!characterName || !assetName) return '';
  return sanitizeFilename(listKey === 'variants'
    ? `${characterName}_形态_${assetName}`
    : `${characterName}_${assetName}`);
}

function snapshotFiles(projectId) {
  const directory = path.join(projectDir(projectId), '.snapshots');
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
}

function restoreSnapshotAssets(projectId, project, imageNames) {
  const targets = characterMap(project.elements);
  let restored = 0;
  for (const file of snapshotFiles(projectId)) {
    const snapshot = readJsonFile(file, null);
    if (!snapshot?.elements) continue;
    for (const [key, source] of characterMap(snapshot.elements)) {
      const target = targets.get(key);
      if (!target) continue;
      for (const listKey of ASSET_LIST_KEYS) {
        restored += mergeAssetList(target, source, listKey, (asset) => (
          imageNames.has(assetImageBase(source, listKey, asset))
        ));
      }
    }
  }
  return restored;
}

function restoreAssetsFromImageNames(project, imageNames) {
  const characters = Array.isArray(project?.elements?.character) ? project.elements.character : [];
  const owners = characters
    .map((character) => ({ character, base: sanitizeFilename(character?.name) }))
    .filter((item) => item.base)
    .sort((left, right) => right.base.length - left.base.length);
  const mainImageNames = new Set(owners.map(({ base }) => base));
  let restored = 0;

  for (const imageName of imageNames) {
    if (mainImageNames.has(imageName)) continue;
    const owner = owners.find(({ base }) => imageName.startsWith(`${base}_`));
    if (!owner || imageName === `${owner.base}_参考图`) continue;
    // A clothing reference belongs to its variant and must never become a new asset.
    if (imageName.endsWith('_服装参考') || imageName.endsWith('_Logo参考')) continue;
    const variantPrefix = `${owner.base}_形态_`;
    const listKey = imageName.startsWith(variantPrefix) ? 'variants' : 'outfits';
    const assetName = cleanName(imageName.slice(listKey === 'variants' ? variantPrefix.length : owner.base.length + 1));
    if (!assetName || assetName.startsWith('__')) continue;
    if (!Array.isArray(owner.character[listKey])) owner.character[listKey] = [];
    if (owner.character[listKey].some((item) => nameKey(item?.name) === nameKey(assetName))) continue;
    owner.character[listKey].push({
      name: assetName,
      desc: '',
      prompt: '',
      promptEdited: false,
      userCreated: true,
      recoveredFrom: 'image-file',
    });
    restored += 1;
  }
  return restored;
}

export function recoverCharacterAssetsFromImageNames(project, names) {
  const imageNames = new Set(Array.isArray(names) || names instanceof Set ? names : []);
  return restoreAssetsFromImageNames(project, imageNames);
}

export function recoverMissingCharacterAssets(projectId, project) {
  const imageNames = imageBasenames(projectId);
  if (!imageNames.size || !project?.elements) return { restored: 0, fromSnapshots: 0, fromImages: 0 };
  const fromSnapshots = restoreSnapshotAssets(projectId, project, imageNames);
  const fromImages = restoreAssetsFromImageNames(project, imageNames);
  for (const character of project.elements.character || []) syncCharacterSourceAssets(character);
  return { restored: fromSnapshots + fromImages, fromSnapshots, fromImages };
}
