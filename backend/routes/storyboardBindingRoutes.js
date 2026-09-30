import { chatComplete } from '../apiClient.js';
import { loadConfig } from '../config.js';
import { extractJsonObject as parseJsonObject } from '../jsonParse.js';
import { hasTextModelKey, resolveTextModelConfig } from '../modelRouting.js';
import { parseStoryboardShotsForRecovery } from '../shotVideoUtils.js';
import { loadProject, MAIN_CATEGORIES, normalizeProjectScript, saveProject } from '../storage.js';

function extractJsonObject(text) {
  return parseJsonObject(text, {
    emptyMessage: 'Agent returned an empty response',
    invalidMessage: 'Agent response was not valid JSON',
  });
}

function ensureElementBuckets(project) {
  if (!project.elements || typeof project.elements !== 'object') project.elements = {};
  for (const category of MAIN_CATEGORIES) {
    if (!Array.isArray(project.elements[category])) project.elements[category] = [];
  }
}

function compact(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function aliasKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s"'“”‘’·.，,、：:；;。()[\]{}<>《》【】\\/|~_\-—+=*#^$@%&]/g, '');
}

function aliasList(element) {
  const values = [element?.alias, element?.aliases, element?.source?.alias, element?.source?.aliases];
  const parts = [];
  const append = (value) => {
    if (Array.isArray(value)) return value.forEach(append);
    if (!value || typeof value === 'object') return;
    for (const part of String(value).split(/[、，,；;|~\n\r\t]+/)) if (part.trim()) parts.push(part.trim());
  };
  values.forEach(append);
  const nameKey = aliasKey(element?.name);
  const seen = new Set();
  return parts.map((value) => value.replace(/^(?:别名|代称|称呼|昵称|尊称|称号|aliases?|alias)\s*[:：]/i, '').trim().slice(0, 40))
    .filter((value) => {
      const key = aliasKey(value);
      if (value.length < 2 || !key || key === nameKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 80);
}

function bindingKey(category, name) {
  return `${category}\u001f${name}`;
}

export function collectElements(project) {
  ensureElementBuckets(project);
  const elements = [];
  for (const category of MAIN_CATEGORIES) {
    for (const element of project.elements[category]) {
      const name = String(element?.name || '').trim();
      if (!name) continue;
      const source = element?.source && typeof element.source === 'object' ? element.source : {};
      elements.push({
        cat: category,
        name,
        alias: String(element?.alias || '').trim(),
        aliases: aliasList(element),
        kind: 'main',
        ownerName: category === 'scene' ? name : undefined,
        description: compact(category === 'character'
          ? [source.identity, source.appearance, source.body, source.hair, source.clothing, source.traits, element.prompt].filter(Boolean).join('；')
          : source.description || element.prompt || '', 220),
      });
      if (category === 'character') {
        for (const variant of element.variants || []) {
          const variantName = String(variant?.name || '').trim();
          if (!variantName) continue;
          elements.push({
            cat: category,
            name: `${name}·${variantName}`,
            alias: '',
            aliases: [],
            kind: 'variant',
            ownerName: name,
            matchName: variantName,
            description: compact([`角色：${name}`, `形态：${variantName}`, variant.prompt, variant.source?.description].filter(Boolean).join('；'), 220),
          });
        }
      }
      if (category === 'scene') {
        for (const area of element.areas || []) {
          const areaName = String(area?.name || '').trim();
          if (!areaName) continue;
          elements.push({
            cat: category,
            name: `${name}·区域·${areaName}`,
            alias: '',
            aliases: [],
            kind: 'sceneArea',
            ownerName: name,
            matchName: areaName,
            description: compact([
              `所属主场景：${name}`,
              `子区域：${areaName}`,
              area.desc,
              area.prompt,
            ].filter(Boolean).join('；'), 220),
          });
        }
      }
    }
  }
  return elements;
}

function elementLookup(elements) {
  const lookup = new Map(elements.map((element) => [bindingKey(element.cat, element.name), element]));
  const loose = new Map();
  const duplicates = new Set();
  for (const element of elements) {
    for (const term of [element.alias, ...(element.aliases || []), element.matchName]) {
      const text = String(term || '').trim();
      const key = bindingKey(element.cat, text);
      if (!text || lookup.has(key) || duplicates.has(key)) continue;
      if (loose.has(key)) {
        loose.delete(key);
        duplicates.add(key);
      } else loose.set(key, element);
    }
  }
  for (const [key, element] of loose) lookup.set(key, element);
  return lookup;
}

function validTag(raw, lookup) {
  const cat = String(raw?.cat || raw?.category || '').trim();
  const name = String(raw?.name || raw?.elementName || '').trim();
  if (!MAIN_CATEGORIES.includes(cat) || !name) return null;
  const element = lookup.get(bindingKey(cat, name));
  return element ? {
    cat,
    name: element.name,
    ...(element.kind && element.kind !== 'main' ? { assetKind: element.kind } : {}),
    ...(element.ownerName ? { ownerName: element.ownerName } : {}),
  } : null;
}

function sceneOwner(item) {
  if (item?.cat !== 'scene') return '';
  return String(item.ownerName || item.name || '').trim();
}

function confidenceScore(item) {
  const value = Number(item?.confidence);
  return Number.isFinite(value) ? value : -1;
}

export function normalizeSelectedBindings(items = []) {
  const deduped = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.cat || !item?.name) continue;
    deduped.set(bindingKey(item.cat, item.name), item);
  }
  const bestAreaByOwner = new Map();
  for (const item of deduped.values()) {
    if (item.cat !== 'scene' || item.assetKind !== 'sceneArea') continue;
    const owner = sceneOwner(item);
    if (!owner) continue;
    const current = bestAreaByOwner.get(owner);
    if (!current || confidenceScore(item) > confidenceScore(current)) bestAreaByOwner.set(owner, item);
  }
  return [...deduped.values()].filter((item) => {
    if (item.cat !== 'scene') return true;
    const owner = sceneOwner(item);
    const selectedArea = bestAreaByOwner.get(owner);
    if (!selectedArea) return true;
    return item === selectedArea;
  });
}

export function mergeAiShotBindings({
  selected = [],
  currentAuto = [],
  manualTags = [],
  excludedTags = [],
  replaceAuto = true,
} = {}) {
  const normalizedSelected = normalizeSelectedBindings(selected);
  const selectedKeys = new Set(normalizedSelected.map((item) => bindingKey(item.cat, item.name)));
  const selectedAreaOwners = new Set(normalizedSelected
    .filter((item) => item.cat === 'scene' && item.assetKind === 'sceneArea')
    .map(sceneOwner)
    .filter(Boolean));
  let removedOldAi = 0;
  let skippedUserExcluded = 0;
  let bound = 0;
  let excluded = 0;
  const manual = (Array.isArray(manualTags) ? manualTags : []).filter((item) => {
    if (item?.source === 'ai') removedOldAi++;
    return item?.source !== 'ai';
  });
  const manualSceneOwners = new Set(manual
    .filter((item) => item?.cat === 'scene' && (item?.source === 'sceneArea' || item?.assetKind === 'sceneArea'))
    .map(sceneOwner)
    .filter(Boolean));
  const previousExcluded = Array.isArray(excludedTags) ? excludedTags : [];
  const isAiReplaceableExclusion = (item) => {
    const source = String(item?.source || '').trim();
    return !source || source === 'ai' || source === 'text-match' || source === 'user';
  };
  const userExcluded = new Set(previousExcluded
    .filter((item) => !isAiReplaceableExclusion(item))
    .map((item) => bindingKey(item?.cat, item?.name)));

  for (const item of normalizedSelected) {
    const itemKey = bindingKey(item.cat, item.name);
    if (item.cat === 'scene' && manualSceneOwners.has(sceneOwner(item))) continue;
    if (userExcluded.has(itemKey)) {
      skippedUserExcluded++;
      continue;
    }
    if (!manual.some((entry) => entry?.cat === item.cat && entry?.name === item.name)) {
      manual.push({ ...item, source: 'ai' });
      bound++;
    }
  }

  const nextExcluded = previousExcluded.filter((item) => {
    if (!isAiReplaceableExclusion(item)) return true;
    if (selectedKeys.has(bindingKey(item?.cat, item?.name))) return false;
    if (item?.source !== 'ai') return true;
    return !(item?.cat === 'scene' && item?.assetKind !== 'sceneArea' && selectedAreaOwners.has(sceneOwner(item)));
  });
  if (replaceAuto) {
    for (const tag of Array.isArray(currentAuto) ? currentAuto : []) {
      const tagKey = bindingKey(tag.cat, tag.name);
      if (selectedKeys.has(tagKey) || manual.some((item) => item?.cat === tag.cat && item?.name === tag.name)) continue;
      if (tag.cat === 'scene' && tag.assetKind !== 'sceneArea' && selectedAreaOwners.has(sceneOwner(tag))) continue;
      if (!nextExcluded.some((item) => item?.cat === tag.cat && item?.name === tag.name)) {
        nextExcluded.push({ ...tag, source: 'ai' });
        excluded++;
      }
    }
  }

  return {
    manual,
    excludedTags: nextExcluded,
    bound,
    excluded,
    removedOldAi,
    skippedUserExcluded,
  };
}

function shotNo(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const number = Number(raw);
  return Number.isFinite(number) ? String(number) : raw;
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === '') return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

export function chunkShots(shots, maxChars = 14000, maxShots = 10) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const shot of shots) {
    const next = JSON.stringify(shot).length;
    if (current.length && (current.length >= maxShots || size + next > maxChars)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(shot);
    size += next;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function bindingShotPayload(shot) {
  return {
    shotNo: String(shot.no),
    title: String(shot.title || '').slice(0, 120),
    body: String(shot.body || '').trim().slice(0, 4200),
  };
}

export function buildBindingElementPayload(elements) {
  return elements.map((element) => ({
    cat: element.cat,
    name: element.name,
    alias: element.alias || undefined,
    aliases: element.aliases?.length ? element.aliases.slice(0, 12) : undefined,
    kind: element.kind,
    ownerName: element.ownerName || undefined,
    matchName: element.matchName || undefined,
    description: element.description ? compact(element.description, 160) : undefined,
  }));
}

export async function inferStoryboardBindings({ textConfig, elements, targets, complete = chatComplete } = {}) {
  const lookup = elementLookup(elements);
  const elementPayload = buildBindingElementPayload(elements);
  const shotPayloads = (Array.isArray(targets) ? targets : []).map(bindingShotPayload);
  const selectedByShot = new Map(shotPayloads.map((shot) => [shotNo(shot.shotNo), new Map()]));
  const confirmedShotNos = new Set();
  const invalidElements = [];
  const requestErrors = [];
  const configuredMaxTokens = Number(textConfig?.maxTokens) || 12000;
  const requestMaxTokens = Math.max(2000, Math.min(configuredMaxTokens, 16000));
  const initialBatchSize = Math.max(2, Math.min(10, Math.floor(requestMaxTokens / 900)));
  let pending = shotPayloads;

  // 首轮小批量推理；模型漏回的镜头再缩批重试，最后逐镜兜底。
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    const maxShots = attempt === 0 ? initialBatchSize : (attempt === 1 ? Math.min(4, initialBatchSize) : 1);
    const maxChars = attempt === 0 ? 14000 : (attempt === 1 ? 8000 : 5000);
    const missing = [];
    for (const chunk of chunkShots(pending, maxChars, maxShots)) {
      const expected = new Set(chunk.map((shot) => shotNo(shot.shotNo)));
      const returned = new Set();
      try {
        const raw = await complete(textConfig, [
          { role: 'system', content: STORYBOARD_BINDING_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ elements: elementPayload, shots: chunk }) },
        ], { temperature: 0.05, maxTokens: requestMaxTokens, allowTruncated: false });
        const bindings = extractJsonObject(raw)?.bindings;
        if (!Array.isArray(bindings)) throw new Error('AI 返回中缺少 bindings 数组');
        for (const binding of bindings) {
          const no = shotNo(binding?.shotNo ?? binding?.no);
          if (!expected.has(no) || !Array.isArray(binding.elements)) continue;
          const selected = [];
          let hasInvalidElement = false;
          for (const rawElement of binding.elements) {
            const confidence = Number(rawElement?.confidence);
            if (Number.isFinite(confidence) && confidence < 0.35) continue;
            const valid = validTag(rawElement, lookup);
            if (!valid) {
              invalidElements.push({ shotNo: no, cat: rawElement?.cat || rawElement?.category, name: rawElement?.name || rawElement?.elementName });
              hasInvalidElement = true;
              continue;
            }
            selected.push({
              ...valid,
              confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
              reason: compact(rawElement?.reason, 40),
            });
          }
          // 非空结果里出现不存在的元素名，说明这一镜回答不可靠，整镜缩批重试。
          if (hasInvalidElement) continue;
          const bucket = selectedByShot.get(no);
          for (const item of selected) bucket.set(bindingKey(item.cat, item.name), item);
          returned.add(no);
          confirmedShotNos.add(no);
        }
      } catch (error) {
        requestErrors.push(error?.message || String(error));
      }
      for (const shot of chunk) {
        const no = shotNo(shot.shotNo);
        if (!returned.has(no)) missing.push(shot);
      }
    }
    pending = missing;
  }

  for (const [no, selected] of selectedByShot) {
    selectedByShot.set(no, new Map(normalizeSelectedBindings([...selected.values()])
      .map((item) => [bindingKey(item.cat, item.name), item])));
  }

  return {
    selectedByShot,
    confirmedShotNos,
    failedShotNos: pending.map((shot) => shotNo(shot.shotNo)),
    invalidElements: [...new Map(invalidElements.map((item) => [bindingKey(item.cat, `${item.shotNo}\u001f${item.name}`), item])).values()],
    requestErrors,
  };
}

export const STORYBOARD_BINDING_SYSTEM_PROMPT = `你是影视分镜的元素绑定助手。判断每个分镜画面应该绑定哪些已有元素库元素作为参考。
只能从元素清单选择，禁止创造或改名；人物必须实际出现在画面；场景必须是主要空间；道具和特效必须可见；不确定时不要绑定。
人物可见性规则：只要人物的视觉形象出现在最终画面的任意区域或任意画面层中，就视为实际出现在画面并必须绑定，无论该人物是否处于当前现实空间。画中画、手机/电视/电脑/监控等屏幕影像、照片、海报、镜像、投影、回忆、闪回、幻想、想象、梦境、内心画面和Q版形象中的可见人物都属于应绑定人物。只有纯台词、声音、旁白、画外音、OS或文字提及，并且画面中完全没有该人物视觉形象时，才不绑定。
场景中 kind=sceneArea 表示 ownerName 主场景内的具体子区域。画面明确发生在某个子区域时，优先选择最具体的 sceneArea；同一 ownerName 只能选择一个场景候选，不能同时选择主场景和子区域，也不能同时选择多个子区域。无法判断具体子区域时才选择 kind=main 的主场景。
alias、aliases 和 matchName 只用于识别，输出必须原样使用元素清单中的完整 name 字段。
输入 shots 中的每个镜头都必须在 bindings 中恰好返回一项，shotNo 必须原样保留；没有任何应绑定元素时也要返回 {"shotNo":"原编号","elements":[]}，绝不能省略镜头。
只返回 JSON：{"bindings":[{"shotNo":"1","elements":[{"cat":"character","name":"元素名","confidence":0.9,"reason":"短原因"}]}]}`;

function bindingCatalogSignature(elements) {
  return elements
    .map((element) => [element.cat, element.name, element.kind, element.ownerName].map((value) => String(value || '')).join('\u001f'))
    .sort()
    .join('\u001e');
}

function bindingShotSignature(shot) {
  return JSON.stringify(bindingShotPayload(shot));
}

export async function handleStoryboardBindingRoutes({ req, res, p, method, readBody, sendJson }) {
  if (p !== '/api/project/storyboard/ai-bind-elements' || method !== 'POST') return false;
  const body = await readBody(req);
  const projectId = String(body.projectId || '').trim();
  const episodeId = body.episodeId;
  const project = loadProject(projectId);
  if (!project) return sendJson(res, 404, { error: '项目不存在' });
  normalizeProjectScript(project);
  ensureElementBuckets(project);
  const storyboard = project.script.storyboards.find((item) => String(item.episodeId) === String(episodeId));
  if (!storyboard || !String(storyboard.content || '').trim()) return sendJson(res, 404, { error: '当前集还没有分镜' });
  const config = loadConfig();
  if (!hasTextModelKey(config, 'binding')) return sendJson(res, 400, { error: '请先在设置里配置文本模型 API Key' });
  config.text = resolveTextModelConfig(config, 'binding', { projectId: project.id, episodeId, operation: 'bind-elements' });

  const elements = collectElements(project);
  if (!elements.length) return sendJson(res, 400, { error: '元素库为空，请先提取或新增元素' });
  const lookup = elementLookup(elements);
  const allShots = parseStoryboardShotsForRecovery(storyboard.content || '');
  const requestedShot = shotNo(body.shotNo);
  const from = optionalNumber(body.fromNo);
  const to = optionalNumber(body.toNo);
  const hasRange = Number.isFinite(from) || Number.isFinite(to);
  const low = Math.min(Number.isFinite(from) ? from : -Infinity, Number.isFinite(to) ? to : Infinity);
  const high = Math.max(Number.isFinite(from) ? from : -Infinity, Number.isFinite(to) ? to : Infinity);
  const targets = allShots.filter((shot) => {
    if (storyboard.shotMeta?.[shotNo(shot.no)]?.locked === true) return false;
    if (requestedShot) return shotNo(shot.no) === requestedShot;
    if (!hasRange) return true;
    const number = Number(shot.no);
    return Number.isFinite(number) && number >= low && number <= high;
  });
  if (!targets.length) return sendJson(res, 400, { error: '没有找到要推理的分镜' });
  if (targets.length > 120) return sendJson(res, 400, { error: '一次最多推理 120 个分镜，请缩小范围' });

  const currentAutoByShot = new Map();
  for (const entry of Array.isArray(body.currentAutoTags) ? body.currentAutoTags : []) {
    const no = shotNo(entry?.shotNo ?? entry?.no);
    if (!no) continue;
    currentAutoByShot.set(no, (entry.tags || []).map((tag) => validTag(tag, lookup)).filter(Boolean));
  }
  const catalogSignature = bindingCatalogSignature(elements);
  let inferred;
  try {
    inferred = await inferStoryboardBindings({ textConfig: config.text, elements, targets });
  } catch (error) {
    return sendJson(res, 200, { ok: false, error: `AI绑定失败：${error.message}` });
  }

  if (!inferred.confirmedShotNos.size) {
    const detail = inferred.requestErrors[0] || '模型连续三次未返回任何可确认的镜头结果';
    return sendJson(res, 200, { ok: false, error: `AI绑定失败：${detail}` });
  }

  // 推理可能持续数分钟。落盘前重新读取项目，只把已确认且期间未被编辑的镜头合并进去。
  const latestProject = loadProject(projectId);
  if (!latestProject) return sendJson(res, 200, { ok: false, error: 'AI绑定完成前项目已被删除，结果未保存' });
  normalizeProjectScript(latestProject);
  ensureElementBuckets(latestProject);
  const latestElements = collectElements(latestProject);
  if (bindingCatalogSignature(latestElements) !== catalogSignature) {
    return sendJson(res, 200, { ok: false, error: 'AI绑定期间元素库发生了变化，为避免错绑，本次结果未保存，请重新绑定' });
  }
  const latestStoryboard = latestProject.script.storyboards.find((item) => String(item.episodeId) === String(episodeId));
  if (!latestStoryboard) return sendJson(res, 200, { ok: false, error: 'AI绑定完成前当前分镜集已被删除，结果未保存' });
  const latestShotsByNo = new Map(parseStoryboardShotsForRecovery(latestStoryboard.content || '')
    .map((shot) => [shotNo(shot.no), shot]));
  const staleShotNos = [];
  const applicableTargets = targets.filter((shot) => {
    const no = shotNo(shot.no);
    if (!inferred.confirmedShotNos.has(no)) return false;
    if (latestStoryboard.shotMeta?.[no]?.locked === true) {
      staleShotNos.push(no);
      return false;
    }
    const latestShot = latestShotsByNo.get(no);
    if (latestShot && bindingShotSignature(latestShot) === bindingShotSignature(shot)) return true;
    staleShotNos.push(no);
    return false;
  });
  if (!applicableTargets.length) {
    return sendJson(res, 200, { ok: false, error: 'AI绑定期间目标镜头发生了变化，为避免覆盖新内容，本次结果未保存，请重新绑定' });
  }

  if (!latestStoryboard.manualTags || typeof latestStoryboard.manualTags !== 'object') latestStoryboard.manualTags = {};
  if (!latestStoryboard.excludedTags || typeof latestStoryboard.excludedTags !== 'object') latestStoryboard.excludedTags = {};
  let bound = 0;
  let excluded = 0;
  let removedOldAi = 0;
  let skippedUserExcluded = 0;
  for (const shot of applicableTargets) {
    const key = String(shot.no);
    const selected = inferred.selectedByShot.get(shotNo(shot.no)) || new Map();
    const merged = mergeAiShotBindings({
      selected: [...selected.values()],
      currentAuto: currentAutoByShot.get(shotNo(shot.no)) || [],
      manualTags: latestStoryboard.manualTags[key] || [],
      excludedTags: latestStoryboard.excludedTags[key] || [],
      replaceAuto: body.replaceAuto !== false,
    });
    bound += merged.bound;
    excluded += merged.excluded;
    removedOldAi += merged.removedOldAi;
    skippedUserExcluded += merged.skippedUserExcluded;
    if (merged.manual.length) latestStoryboard.manualTags[key] = merged.manual;
    else delete latestStoryboard.manualTags[key];
    if (merged.excludedTags.length) latestStoryboard.excludedTags[key] = merged.excludedTags;
    else delete latestStoryboard.excludedTags[key];
  }
  latestStoryboard.aiElementBindingUpdatedAt = new Date().toISOString();
  latestProject.updatedAt = new Date().toISOString();
  saveProject(latestProject);
  const failedShotNos = [...new Set([...inferred.failedShotNos, ...staleShotNos])];
  return sendJson(res, 200, {
    ok: true,
    partial: failedShotNos.length > 0,
    episodeId: latestStoryboard.episodeId,
    totalShots: targets.length,
    processedShots: applicableTargets.length,
    failedShotNos,
    invalidElementCount: inferred.invalidElements.length,
    bound,
    excluded,
    removedOldAi,
    skippedUserExcluded,
    storyboard: latestStoryboard,
  });
}
