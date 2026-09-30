import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import { STATE_DIR } from '../config.js';
import { writeJsonAtomic } from '../lib/atomicJson.js';
import {
  imageDiskPath,
  listProjects,
  loadProject,
  MAIN_CATEGORIES,
  sanitizeFilename,
  saveProject,
} from '../storage.js';

const LIBRARY_DIR = path.join(STATE_DIR, 'character-library');
const INDEX_FILE = path.join(LIBRARY_DIR, 'index.json');
const ASSET_TYPES = Object.freeze({
  main: '人物主图',
  variant: '人物形态',
  outfit: '人物服装',
  group: '群像图片',
  scene: '场景图片',
  prop: '道具图片',
  creature: '妖兽图片',
  effect: '特效图片',
});

function ensureLibraryDir() {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
}

function cleanText(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function readLibraryState() {
  ensureLibraryDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      hiddenIds: Array.isArray(parsed?.hiddenIds) ? parsed.hiddenIds.map((id) => cleanText(id, 160)).filter(Boolean) : [],
    };
  } catch {
    return { items: [], hiddenIds: [] };
  }
}

function readIndex() {
  return readLibraryState().items;
}

function writeIndex(items, hiddenIds = []) {
  ensureLibraryDir();
  writeJsonAtomic(INDEX_FILE, {
    version: 3,
    updatedAt: new Date().toISOString(),
    hiddenIds: [...new Set(hiddenIds)].filter(Boolean),
    items,
  });
}

function libraryId(parts) {
  const digest = createHash('sha256').update(parts.map((part) => String(part || '')).join('\u001f')).digest('hex').slice(0, 24);
  return `generated_${digest}`;
}

function entryDir(id) {
  return path.join(LIBRARY_DIR, sanitizeFilename(id, 'generated-character'));
}

function cachedImagePath(id) {
  return path.join(entryDir(id), 'image.png');
}

function generatedAssetIdentity(item) {
  return [
    item?.sourceProjectId,
    item?.sourceCategory,
    item?.assetType,
    item?.elementName,
    item?.assetName,
  ].map((value) => cleanText(value, 160)).join('\u001f');
}

function isCompleteGeneratedAsset(item) {
  return item?.autoDiscovered === true
    && cleanText(item.id, 160)
    && cleanText(item.sourceProjectId, 160)
    && MAIN_CATEGORIES.includes(cleanText(item.sourceCategory, 40))
    && cleanText(item.assetType, 40)
    && cleanText(item.elementName, 80)
    && cleanText(item.assetName, 80)
    && fs.existsSync(cachedImagePath(item.id));
}

function copyImageToCache(source, id) {
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  const target = cachedImagePath(id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const sourceStat = fs.statSync(source);
  const targetStat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!targetStat || sourceStat.mtimeMs > targetStat.mtimeMs || sourceStat.size !== targetStat.size) fs.copyFileSync(source, target);
  return true;
}

function variantImageName(characterName, variantName) {
  return `${characterName}_形态_${variantName}`;
}

function generatedAssetEntry(project, element, sourceCategory, assetType, assetName, sourceFile, hiddenIds) {
  const elementName = cleanText(element?.name, 80);
  const safeAssetName = cleanText(assetName, 80);
  const id = libraryId([project.id, sourceCategory, assetType, elementName, safeAssetName]);
  if (hiddenIds?.has(id)) return null;
  if (!copyImageToCache(sourceFile, id)) return null;
  const stat = fs.statSync(cachedImagePath(id));
  const typeLabel = ASSET_TYPES[assetType];
  return {
    id,
    name: ['main', 'group', 'scene', 'prop', 'effect', 'creature'].includes(assetType) ? elementName : `${elementName} · ${safeAssetName}`,
    elementName,
    characterName: sourceCategory === 'character' ? elementName : '',
    assetName: safeAssetName,
    assetType,
    assetTypeLabel: typeLabel,
    category: typeLabel,
    tags: [project.name, elementName, cleanText(element?.alias, 80), typeLabel].filter(Boolean),
    alias: cleanText(element?.alias, 80),
    aliasesText: cleanText(element?.aliasesText, 200),
    prompt: cleanText(element?.prompt, 600),
    sourceCategory,
    sourceProjectId: project.id,
    sourceProjectName: project.name,
    assets: { main: 'image.png' },
    autoDiscovered: true,
    createdAt: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
    updatedAt: new Date(stat.mtimeMs).toISOString(),
  };
}

function discoverProjectImages(projectMeta, hiddenIds) {
  const project = loadProject(projectMeta.id);
  if (!project) return [];
  const items = [];
  for (const category of MAIN_CATEGORIES) {
    for (const element of project.elements?.[category] || []) {
      const elementName = cleanText(element?.name, 80);
      if (!elementName) continue;
      const assetType = category === 'character' ? 'main' : category;
      const main = generatedAssetEntry(project, element, category, assetType, elementName, imageDiskPath(project.id, category, elementName), hiddenIds);
      if (main) items.push(main);
      if (category !== 'character') continue;
      for (const variant of element.variants || []) {
        const name = cleanText(variant?.name, 80);
        if (!name) continue;
        const item = generatedAssetEntry(project, element, category, 'variant', name, imageDiskPath(project.id, category, variantImageName(elementName, name)), hiddenIds);
        if (item) items.push(item);
      }
      for (const outfit of element.outfits || []) {
        const name = cleanText(outfit?.name, 80);
        if (!name) continue;
        const item = generatedAssetEntry(project, element, category, 'outfit', name, imageDiskPath(project.id, category, `${elementName}_${name}`), hiddenIds);
        if (item) items.push(item);
      }
    }
  }
  return items;
}

function syncGeneratedCharacterImages() {
  // Older indexes may contain a second, incomplete record for the same image.
  // Deduplicate by source identity so current scans replace those stale entries.
  const state = readLibraryState();
  const hiddenIds = new Set(state.hiddenIds);
  const previous = state.items.filter((item) => !hiddenIds.has(item.id) && isCompleteGeneratedAsset(item));
  const byIdentity = new Map(previous.map((item) => [generatedAssetIdentity(item), item]));
  for (const project of listProjects({ withSizes: false, withCovers: false })) {
    for (const item of discoverProjectImages(project, hiddenIds)) {
      byIdentity.set(generatedAssetIdentity(item), item);
    }
  }
  const items = [...byIdentity.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.name.localeCompare(b.name, 'zh-CN'));
  writeIndex(items, [...hiddenIds]);
  return items;
}

function preferredElementName(item) {
  if (['variant', 'outfit'].includes(item.assetType)) return cleanText(item.name, 80);
  return cleanText(item.elementName || item.name, 80);
}

function uniqueElementName(project, category, preferred) {
  const existing = new Set((project.elements?.[category] || []).map((item) => cleanText(item?.name, 80).toLocaleLowerCase()));
  const base = cleanText(preferred, 80) || '图库素材';
  if (!existing.has(base.toLocaleLowerCase())) return base;
  for (let suffix = 2; suffix < 10000; suffix++) {
    const marker = ` ${suffix}`;
    const candidate = `${base.slice(0, Math.max(1, 80 - marker.length))}${marker}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error(`无法为“${base}”生成不重复的元素名称`);
}

function libraryImageSource(item, importedAt) {
  return {
    id: item.id,
    sourceProjectId: item.sourceProjectId,
    sourceCategory: item.sourceCategory,
    sourceElementName: item.elementName,
    sourceCharacterName: item.characterName,
    assetType: item.assetType,
    assetName: item.assetName,
    importedAt,
  };
}

function createImportedElement(item, name, importedAt) {
  const prompt = cleanText(item.prompt, 600);
  const alias = cleanText(item.alias, 80);
  const provenance = libraryImageSource(item, importedAt);
  if (item.sourceCategory === 'character') {
    return {
      name,
      userCreated: true,
      alias,
      source: {
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
      },
      prompt,
      edited: true,
      outfits: [],
      variants: [],
      referenceImageName: `${name}_参考图`,
      referenceMode: 'none',
      useReferenceImage: false,
      hasImage: true,
      imageUpdatedAt: importedAt,
      libraryImageSource: provenance,
    };
  }
  const source = item.sourceCategory === 'group'
    ? { name, identity: '', memberCount: '', sharedClothing: '', composition: '', members: [], description: prompt }
    : { name, description: prompt };
  return {
    name,
    userCreated: true,
    alias,
    source,
    prompt,
    edited: true,
    hasImage: true,
    imageUpdatedAt: importedAt,
    libraryImageSource: provenance,
  };
}

function ensureProjectElements(project) {
  if (!project.elements || typeof project.elements !== 'object') project.elements = {};
  for (const category of MAIN_CATEGORIES) {
    if (!Array.isArray(project.elements[category])) project.elements[category] = [];
  }
}

function alreadyContainsLibraryItem(project, item) {
  if (Object.values(project.elements || {}).some((elements) => (
    Array.isArray(elements) && elements.some((element) => element?.libraryImageSource?.id === item.id)
  ))) return true;
  if (item.sourceProjectId !== project.id || ['variant', 'outfit'].includes(item.assetType)) return false;
  return (project.elements?.[item.sourceCategory] || []).some((element) => element?.name === item.elementName);
}

function mediaUrl(item) {
  return `/character-library-media/${encodeURIComponent(item.id)}/image.png?v=${encodeURIComponent(item.updatedAt || '')}`;
}

function publicEntry(item) {
  return { ...item, coverUrl: mediaUrl(item) };
}

function normalizedMatchName(value) {
  return cleanText(value, 80).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function primaryAssetType(category) {
  return category === 'character' ? 'main' : category;
}

function elementAlreadyHasImage(project, category, element) {
  if (element?.hasImage || element?.hasPendingImage) return true;
  const file = imageDiskPath(project.id, category, cleanText(element?.name, 80));
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function automaticImageMatchPlan(project, sourceProjectId = '') {
  ensureProjectElements(project);
  const sourceFilter = cleanText(sourceProjectId, 160);
  const candidatesByKey = new Map();
  for (const item of syncGeneratedCharacterImages()) {
    if (item.sourceProjectId === project.id || (sourceFilter && item.sourceProjectId !== sourceFilter)) continue;
    if (item.assetType !== primaryAssetType(item.sourceCategory)) continue;
    const name = normalizedMatchName(item.elementName);
    if (!name) continue;
    const key = `${item.sourceCategory}\u001f${name}`;
    if (!candidatesByKey.has(key)) candidatesByKey.set(key, []);
    candidatesByKey.get(key).push(item);
  }
  for (const candidates of candidatesByKey.values()) {
    candidates.sort((a, b) => (
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      || String(a.sourceProjectName || '').localeCompare(String(b.sourceProjectName || ''), 'zh-CN')
      || String(a.id).localeCompare(String(b.id))
    ));
  }

  const matches = [];
  const unmatched = [];
  const existing = [];
  let totalElements = 0;
  for (const category of MAIN_CATEGORIES) {
    for (const [index, element] of project.elements[category].entries()) {
      const elementName = cleanText(element?.name, 80);
      if (!elementName) continue;
      totalElements++;
      const target = { category, index, elementName };
      if (elementAlreadyHasImage(project, category, element)) {
        existing.push(target);
        continue;
      }
      const candidates = candidatesByKey.get(`${category}\u001f${normalizedMatchName(elementName)}`) || [];
      if (!candidates.length) {
        unmatched.push(target);
        continue;
      }
      matches.push({
        ...target,
        item: candidates[0],
        candidateCount: candidates.length,
      });
    }
  }
  return { totalElements, matches, unmatched, existing };
}

function automaticMatchResult(project, plan) {
  const selectedItems = plan.matches.map((match) => match.item);
  const sourceProjectCounts = new Map();
  for (const item of selectedItems) {
    const entry = sourceProjectCounts.get(item.sourceProjectId) || { id: item.sourceProjectId, name: item.sourceProjectName, matched: 0 };
    entry.matched++;
    sourceProjectCounts.set(item.sourceProjectId, entry);
  }
  const sourceProjects = [...sourceProjectCounts.values()]
    .sort((a, b) => b.matched - a.matched || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  return {
    projectId: project.id,
    totalElements: plan.totalElements,
    matched: plan.matches.length,
    conflicts: plan.matches.filter((match) => match.candidateCount > 1).length,
    skippedExisting: plan.existing.length,
    unmatchedCount: plan.unmatched.length,
    sourceProjects,
    matches: plan.matches.map((match) => ({
      category: match.category,
      index: match.index,
      elementName: match.elementName,
      candidateCount: match.candidateCount,
      item: publicEntry(match.item),
    })),
    unmatched: plan.unmatched,
  };
}

function applyLibraryItemToElement(project, category, element, item, appliedAt) {
  const source = cachedImagePath(item.id);
  const target = imageDiskPath(project.id, category, element.name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  element.hasImage = true;
  element.imageUpdatedAt = appliedAt;
  element.libraryImageSource = {
    id: item.id,
    sourceProjectId: item.sourceProjectId,
    sourceCategory: item.sourceCategory,
    sourceElementName: item.elementName,
    sourceCharacterName: item.characterName,
    assetType: item.assetType,
    assetName: item.assetName,
    appliedAt,
  };
}

export function listGlobalCharacters({ query = '', category = '', projectId = '' } = {}) {
  const q = cleanText(query, 200).toLocaleLowerCase();
  const cat = cleanText(category, 60);
  const project = cleanText(projectId, 120);
  const allItems = syncGeneratedCharacterImages();
  const items = allItems.filter((item) => {
    if (cat && item.category !== cat) return false;
    if (project && item.sourceProjectId !== project) return false;
    if (!q) return true;
    return [item.name, item.elementName, item.characterName, item.assetName, item.alias, item.aliasesText, item.prompt, item.sourceProjectName, ...(item.tags || [])]
      .join(' ').toLocaleLowerCase().includes(q);
  });
  const categories = [...new Set(allItems.map((item) => item.category).filter(Boolean))];
  const projects = [...new Map(allItems.map((item) => [item.sourceProjectId, { id: item.sourceProjectId, name: item.sourceProjectName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { items: items.map(publicEntry), categories, projects };
}

export function resolveGlobalAssetReferences(ids = [], { limit = 10 } = {}) {
  const requestedIds = [...new Set((Array.isArray(ids) ? ids : [ids])
    .map((id) => cleanText(id, 160))
    .filter(Boolean))]
    .slice(0, Math.max(0, Number(limit) || 0));
  if (!requestedIds.length) return [];

  const available = new Map(syncGeneratedCharacterImages().map((item) => [item.id, item]));
  const missingIds = requestedIds.filter((id) => !available.has(id));
  if (missingIds.length) throw new Error('部分图库素材已不存在，请刷新素材列表后重试');

  return requestedIds.map((id) => {
    const item = available.get(id);
    return {
      id: item.id,
      name: item.name,
      assetTypeLabel: item.assetTypeLabel,
      sourceCategory: item.sourceCategory,
      diskPath: cachedImagePath(item.id),
    };
  });
}

export function previewGlobalAssetImageMatches({ projectId = '', sourceProjectId = '' } = {}) {
  const project = loadProject(cleanText(projectId, 160));
  if (!project) throw new Error('项目不存在');
  return automaticMatchResult(project, automaticImageMatchPlan(project, sourceProjectId));
}

export function applyGlobalAssetImageMatches({ projectId = '', sourceProjectId = '' } = {}) {
  const project = loadProject(cleanText(projectId, 160));
  if (!project) throw new Error('项目不存在');
  const plan = automaticImageMatchPlan(project, sourceProjectId);
  const appliedAt = new Date().toISOString();
  const appliedItems = [];
  const failedItems = [];
  for (const match of plan.matches) {
    const element = project.elements[match.category]?.[match.index];
    if (!element || elementAlreadyHasImage(project, match.category, element)) continue;
    try {
      applyLibraryItemToElement(project, match.category, element, match.item, appliedAt);
      appliedItems.push({
        category: match.category,
        index: match.index,
        elementName: element.name,
        id: match.item.id,
        sourceProjectId: match.item.sourceProjectId,
        sourceProjectName: match.item.sourceProjectName,
      });
    } catch {
      const target = imageDiskPath(project.id, match.category, element.name);
      try { fs.rmSync(target, { force: true }); } catch { /* leave the original copy error as the result */ }
      failedItems.push({ category: match.category, index: match.index, elementName: element.name, id: match.item.id });
    }
  }
  if (appliedItems.length) {
    project.updatedAt = appliedAt;
    saveProject(project);
  }
  return {
    ...automaticMatchResult(project, plan),
    project,
    applied: appliedItems.length,
    appliedItems,
    failed: failedItems.length,
    failedItems,
  };
}

export function addGlobalAssetsToProject({ ids = [], projectId = '' } = {}) {
  const requestedIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => cleanText(id, 160)).filter(Boolean))].slice(0, 300);
  if (!requestedIds.length) throw new Error('请至少选择一张图库图片');
  const project = loadProject(cleanText(projectId, 160));
  if (!project) throw new Error('项目不存在');
  ensureProjectElements(project);

  const available = new Map(syncGeneratedCharacterImages().map((item) => [item.id, item]));
  const addedByCategory = Object.fromEntries(MAIN_CATEGORIES.map((category) => [category, 0]));
  const addedItems = [];
  const skippedIds = [];
  const importedAt = new Date().toISOString();
  for (const id of requestedIds) {
    const item = available.get(id);
    if (!item || !MAIN_CATEGORIES.includes(item.sourceCategory) || alreadyContainsLibraryItem(project, item)) {
      skippedIds.push(id);
      continue;
    }
    const name = uniqueElementName(project, item.sourceCategory, preferredElementName(item));
    const target = imageDiskPath(project.id, item.sourceCategory, name);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(cachedImagePath(item.id), target);
    } catch {
      skippedIds.push(id);
      continue;
    }
    const element = createImportedElement(item, name, importedAt);
    project.elements[item.sourceCategory].push(element);
    addedByCategory[item.sourceCategory]++;
    addedItems.push({ id, category: item.sourceCategory, name, index: project.elements[item.sourceCategory].length - 1 });
  }
  if (addedItems.length) {
    project.updatedAt = importedAt;
    saveProject(project);
  }
  return {
    project,
    added: addedItems.length,
    skipped: skippedIds.length,
    addedByCategory,
    addedItems,
    skippedIds,
  };
}

export function removeGlobalAssets({ ids = [] } = {}) {
  const requestedIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => cleanText(id, 160)).filter(Boolean))].slice(0, 300);
  if (!requestedIds.length) throw new Error('请至少选择一张图库图片');
  const availableIds = new Set(syncGeneratedCharacterImages().map((item) => item.id));
  const removedIds = requestedIds.filter((id) => availableIds.has(id));
  const state = readLibraryState();
  const hiddenIds = new Set(state.hiddenIds);
  for (const id of removedIds) {
    hiddenIds.add(id);
    fs.rmSync(entryDir(id), { recursive: true, force: true });
  }
  const items = state.items.filter((item) => !hiddenIds.has(item.id));
  writeIndex(items, [...hiddenIds]);
  return { removed: removedIds.length, skipped: requestedIds.length - removedIds.length, removedIds };
}

export function applyGlobalAssetImage({ id, projectId, category = 'character', index, charIndex } = {}) {
  const item = syncGeneratedCharacterImages().find((entry) => entry.id === id);
  if (!item) throw new Error('图库图片不存在');
  const project = loadProject(projectId);
  if (!project) throw new Error('项目不存在');
  const targetCategory = MAIN_CATEGORIES.includes(category) ? category : 'character';
  if (item.sourceCategory !== targetCategory) throw new Error('只能选择与当前元素相同类型的图片');
  const targetIndex = Number(index ?? charIndex);
  const element = project.elements?.[targetCategory]?.[targetIndex];
  if (!element) throw new Error('当前元素不存在');
  applyLibraryItemToElement(project, targetCategory, element, item, new Date().toISOString());
  project.updatedAt = element.imageUpdatedAt;
  saveProject(project);
  return {
    project,
    element,
    character: targetCategory === 'character' ? element : undefined,
    category: targetCategory,
    index: targetIndex,
    charIndex: targetCategory === 'character' ? targetIndex : undefined,
    imageUrl: `/img/${encodeURIComponent(project.id)}/${targetCategory}/${encodeURIComponent(element.name)}.png?v=${Date.now()}`,
  };
}

export function globalCharacterMediaPath(id, filename) {
  if (filename !== 'image.png') return '';
  const item = readIndex().find((entry) => entry.id === id && entry.autoDiscovered === true);
  if (!item) return '';
  const file = cachedImagePath(id);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : '';
}
