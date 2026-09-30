// 提取流程：分块 → 逐块调文本模型抽取 → 按名字去重合并 → 套模板生成最终出图提示词
import crypto from 'crypto';
import { chatComplete } from './apiClient.js';
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  SCENE_EXTRACTION_SYSTEM_PROMPT,
  buildSceneExtractionUserPrompt,
  buildCharacterPrompt,
  makeCharacterPromptParts,
  buildCharacterPromptFromParts,
  normalizeCharacterPromptParts,
  normalizeCharacterPartsEdited,
  buildGroupPrompt,
  buildVariantPrompt,
  buildOutfitPrompt,
  buildScenePrompt,
  buildSceneAreaPrompt,
  buildPropPrompt,
  buildEffectPrompt,
  buildCreaturePrompt,
} from './prompts.js';
import { smartChunk, chunkText as simpleChunkText } from './chunking.js';
import {
  normalizeSceneAreaRecords,
  sameSceneAreaName,
  sceneAreaNameKey,
} from './sceneAreaNames.js';

const extractionResponseCache = new Map();
const EXTRACTION_CACHE_TTL_MS = 10 * 60 * 1000;
const EXTRACTION_CACHE_MAX = 128;
const EXTRACTION_MAX_OUTPUT_TOKENS = 16000;
// A non-streaming extraction request must not hold the whole job forever.
// The batch heartbeat below keeps the UI informed while this timeout runs.
const EXTRACTION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const EXTRACTION_PROGRESS_HEARTBEAT_MS = 10 * 1000;
const EXTRACTION_RETRY_MIN_CHUNK_SIZE = 400;
const EXTRACTION_RETRY_TARGET_CHUNK_SIZE = 1200;
const EXTRACTION_RETRY_MAX_DEPTH = 8;

function extractionCacheKey(textCfg, messages) {
  const identity = {
    baseUrl: textCfg?.baseUrl || '',
    model: textCfg?.model || '',
    messages,
  };
  return crypto.createHash('sha1').update(JSON.stringify(identity)).digest('hex');
}

function cloneExtractionData(data) {
  try { return JSON.parse(JSON.stringify(data)); } catch { return data; }
}

function emptyExtractionData() {
  return { characters: [], groups: [], scenes: [], props: [], effects: [], creatures: [] };
}

function mergeExtractionData(...values) {
  const merged = emptyExtractionData();
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    for (const key of Object.keys(merged)) {
      if (Array.isArray(value[key])) merged[key].push(...value[key]);
    }
  }
  return merged;
}

function extractionDataHasItems(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(emptyExtractionData()).some((key) => Array.isArray(value[key]) && value[key].length > 0);
}

function splitExtractionText(value) {
  const source = String(value || '').trim();
  if (source.length <= EXTRACTION_RETRY_MIN_CHUNK_SIZE) return [];
  const target = source.length > EXTRACTION_RETRY_TARGET_CHUNK_SIZE
    ? EXTRACTION_RETRY_TARGET_CHUNK_SIZE
    : Math.ceil(source.length / 2);
  const overlap = Math.min(120, Math.floor(target * 0.05));
  const step = Math.max(1, target - overlap);
  const pieces = [];
  for (let start = 0; start < source.length; start += step) {
    const end = Math.min(source.length, start + target);
    const piece = source.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= source.length) break;
  }
  return pieces.length > 1 && pieces.some((piece) => piece.length < source.length) ? pieces : [];
}

// 向后兼容的简单分块函数
export function chunkText(text, chunkSize = 6000) {
  return simpleChunkText(text, chunkSize);
}

// 智能分块函数（供新代码使用）
export function smartChunkText(text, options = {}) {
  const chunks = smartChunk(text, {
    chunkSize: options.chunkSize || 10000,
    overlapSize: options.overlapSize || 500,
    useCache: options.useCache !== false,
    strategy: options.strategy || 'paragraph'
  });

  // 返回包含元数据的分块结果
  return chunks;
}

// 从模型返回里稳健地解析 JSON（容忍 ```json 代码块或前后多余文字，以及被截断的尾部）
function parseJsonLoose(content) {
  let s = content.trim();
  // 去掉 markdown 代码块围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  if (first === -1) throw new Error('未找到 JSON');
  const last = s.lastIndexOf('}');
  if (last > first) {
    const candidate = s.slice(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      /* 落到下面的抢救逻辑 */
    }
  }
  // 抢救被截断的 JSON：从三个数组里逐个抠出完整的 {...} 对象
  return salvageTruncated(s);
}

// 从不完整的 JSON 文本里，按数组名抢救出已经写完整的对象
function salvageTruncated(s) {
  const out = { characters: [], groups: [], scenes: [], props: [], effects: [], creatures: [] };
  for (const key of ['characters', 'groups', 'scenes', 'props', 'effects', 'creatures']) {
    const m = s.indexOf(`"${key}"`);
    if (m === -1) continue;
    const bracket = s.indexOf('[', m);
    if (bracket === -1) continue;
    let i = bracket + 1;
    while (i < s.length) {
      // 跳到下一个对象起点
      while (i < s.length && s[i] !== '{' && s[i] !== ']') i++;
      if (i >= s.length || s[i] === ']') break;
      // 用括号配对找出这个对象的结尾（忽略字符串内的括号）
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = i; j < s.length; j++) {
        const ch = s[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end === -1) break; // 这个对象没写完，丢弃
      try { out[key].push(JSON.parse(s.slice(i, end + 1))); } catch { /* 跳过坏对象 */ }
      i = end + 1;
    }
  }
  return out;
}

function normalizeOutfitText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[ \t\r\n"'“”‘’`·,，。.!！?？:：;；、()[\]{}<>《》【】|\\/+=*_#~^$@%&-]/g, '')
    .replace(/(一套|一件|一条|这套|该套|当前|默认|主图|最具代表性|服装造型|服装|衣着|穿着|描述|款式|材质|配色|饰品|鞋履|搭配|整体|风格|设计|剪裁|面料|同色系|精致|简洁|高级|质感|明显|具体)/g, '');
}

function charBigrams(value) {
  const text = normalizeOutfitText(value);
  const grams = new Set();
  if (!text) return grams;
  if (text.length <= 2) {
    for (const ch of text) grams.add(ch);
    return grams;
  }
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
  if (text.length < 6) for (const ch of text) grams.add(ch);
  return grams;
}

function outfitOverlapStats(defaultClothing, outfitText) {
  const main = charBigrams(defaultClothing);
  const candidate = charBigrams(outfitText);
  if (!main.size || !candidate.size) return { jaccard: 0, candidateCoverage: 0 };
  let intersection = 0;
  for (const gram of candidate) if (main.has(gram)) intersection++;
  const union = main.size + candidate.size - intersection;
  return {
    jaccard: union ? intersection / union : 0,
    candidateCoverage: intersection / candidate.size,
  };
}

function outfitMarkers(value) {
  const text = String(value || '').toLowerCase();
  const markers = new Set();
  const patterns = [
    /(?:深|浅|冷|暖)?(?:黑|白|灰|红|蓝|绿|黄|粉|紫|金|银|棕|米|藏青|香槟金|小麦|冷白|乳白|月白|深灰|米白|纯白|银白|浅蓝|深藏青)色?/g,
    /(?:蕾丝|真丝|丝质|缎面|棉质|毛呢|薄纱|羊皮|皮质|金属|珍珠|大理石|暗条纹|珠光|半透明|厚实|轻薄|柔软)/g,
    /(?:连衣裙|小白裙|白裙|睡裙|长裙|短裙|裙摆|裙身|礼服|校服|战袍|睡衣|风衣|西装|正装|制服|外套|衬衫|衬衣|西裤|直筒裤|浴巾|领带|腕表|项链|耳钉|耳环|口袋巾|袖扣|高跟鞋|皮鞋|乐福鞋|玛丽珍鞋|短袜)/g,
    /(?:v领|V领|圆领|低胸|细吊带|七分袖|短袖|长袖|双排扣|戗驳领|平驳领|尖头|高腰|直筒|收腰|及膝|及小腿|及大腿|长及膝|长及小腿|定制|法式)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const token = normalizeOutfitText(match[0]);
      if (token) markers.add(token);
    }
  }

  return markers;
}

const GARMENT_MARKERS = [
  '连衣裙', '小白裙', '白裙', '睡裙', '长裙', '短裙', '裙摆', '礼服', '校服',
  '战袍', '睡衣', '风衣', '西装', '正装', '制服', '外套', '衬衫', '衬衣',
  '西裤', '直筒裤', '浴巾', '高跟鞋', '皮鞋', '乐福鞋', '玛丽珍鞋', '短袜',
];
const WEARABLE_ACCESSORY_MARKERS = [
  '领带', '腕表', '项链', '耳钉', '耳环', '口袋巾', '袖扣', '戒指', '手镯',
  '手链', '发夹', '发饰', '帽子', '腰带', '吊坠',
];

function hasAnyMarker(value, markers) {
  const text = normalizeOutfitText(value);
  return markers.some((marker) => text.includes(normalizeOutfitText(marker)));
}

function outfitMarkerStats(defaultClothing, outfitText) {
  const main = outfitMarkers(defaultClothing);
  const candidate = outfitMarkers(outfitText);
  if (!main.size || !candidate.size) return { coverage: 0, coreOverlap: false, matches: 0 };

  let matches = 0;
  for (const marker of candidate) if (main.has(marker)) matches++;

  const coreOverlap = GARMENT_MARKERS.some((marker) =>
    main.has(normalizeOutfitText(marker)) && candidate.has(normalizeOutfitText(marker))
  );

  return {
    coverage: matches / candidate.size,
    coreOverlap,
    matches,
  };
}

function isDefaultOutfit(character, outfit) {
  const defaultClothing = character?.clothing || '';
  const outfitText = [outfit?.name, outfit?.desc].filter(Boolean).join(' ');
  const candidateText = normalizeOutfitText(outfitText);
  if (!normalizeOutfitText(defaultClothing) || candidateText.length < 6) return false;

  const textStats = outfitOverlapStats(defaultClothing, outfitText);
  const markerStats = outfitMarkerStats(defaultClothing, outfitText);
  const name = normalizeOutfitText(outfit?.name || '');
  const defaultText = normalizeOutfitText(defaultClothing);
  const nameInDefault = name.length >= 2 && (defaultText.includes(name) || name.includes(defaultText));

  return (
    textStats.candidateCoverage >= 0.68 ||
    textStats.jaccard >= 0.5 ||
    (markerStats.coreOverlap && markerStats.coverage >= 0.45 && markerStats.matches >= 2) ||
    (nameInDefault && (textStats.candidateCoverage >= 0.42 || markerStats.matches >= 2))
  );
}

export function filterDistinctOutfits(character) {
  const outfits = Array.isArray(character?.outfits) ? character.outfits : [];
  const kept = [];
  const seen = new Set();
  for (const outfit of outfits) {
    const name = (outfit?.name || '').trim();
    const desc = (outfit?.desc || '').trim();
    if (!name && !desc) continue;
    const key = normalizeOutfitText(name || desc);
    const fullKey = normalizeOutfitText(`${name}${desc}`);
    if ((key && seen.has(key)) || (fullKey && seen.has(fullKey))) continue;
    if (isDefaultOutfit(character, { ...outfit, name, desc })) continue;
    if (key) seen.add(key);
    if (fullKey) seen.add(fullKey);
    kept.push({ ...outfit, name, desc });
  }
  return kept;
}

export function filterDistinctVariants(character) {
  const variants = Array.isArray(character?.variants) ? character.variants : [];
  const kept = [];
  const seen = new Set();
  const baseText = normalizeOutfitText([
    character?.identity,
    character?.appearance,
    character?.body,
    character?.hair,
    character?.clothing,
    character?.makeupAccessories,
    character?.traits,
  ].filter(Boolean).join(' '));

  for (const variant of variants) {
    const name = (variant?.name || '').trim();
    const desc = (variant?.desc || '').trim();
    const identity = (variant?.identity || '').trim();
    const appearance = (variant?.appearance || '').trim();
    const body = (variant?.body || '').trim();
    const hair = (variant?.hair || '').trim();
    const clothing = (variant?.clothing || '').trim();
    const makeupAccessories = (variant?.makeupAccessories || '').trim();
    const traits = (variant?.traits || '').trim();
    if (!name && !desc && !identity && !appearance && !body && !hair && !clothing && !makeupAccessories && !traits) continue;
    const key = normalizeOutfitText(name || desc || `${appearance}${body}${hair}${clothing}${makeupAccessories}`);
    const fullKey = normalizeOutfitText(`${name}${desc}${identity}${appearance}${body}${hair}${clothing}${makeupAccessories}${traits}`);
    if ((key && seen.has(key)) || (fullKey && seen.has(fullKey))) continue;
    if (baseText && fullKey && baseText === fullKey) continue;
    if (key) seen.add(key);
    if (fullKey) seen.add(fullKey);
    kept.push({ name, desc, identity, appearance, body, hair, clothing, makeupAccessories, traits });
  }
  return kept;
}

export function normalizeProjectVariants(project) {
  const characters = project?.elements?.character;
  if (!Array.isArray(characters)) return false;
  let changed = false;

  const sameList = (a, b) =>
    a.length === b.length && a.every((item, index) =>
      item?.name === b[index]?.name &&
      item?.desc === b[index]?.desc &&
      item?.identity === b[index]?.identity &&
      item?.appearance === b[index]?.appearance &&
      item?.body === b[index]?.body &&
      item?.hair === b[index]?.hair &&
      item?.clothing === b[index]?.clothing &&
      item?.makeupAccessories === b[index]?.makeupAccessories &&
      item?.traits === b[index]?.traits
    );

  for (const character of characters) {
    if (Array.isArray(character.variants)) {
      const cleaned = filterDistinctVariants({
        ...(character.source || character),
        variants: character.variants,
      }).map((variant) => {
        const old = character.variants.find((v) => v?.name === variant.name) || {};
        return {
          ...variant,
          prompt: old.prompt || variant.prompt || '',
          promptEdited: !!old.promptEdited,
          hasImage: old.hasImage,
        };
      });
      if (!sameList(character.variants, cleaned)) {
        character.variants = cleaned;
        changed = true;
      }
    }

    if (character.source && Array.isArray(character.source.variants)) {
      const cleanedSource = filterDistinctVariants(character.source);
      if (!sameList(character.source.variants, cleanedSource)) {
        character.source.variants = cleanedSource;
        changed = true;
      }
    }
  }

  return changed;
}

export function normalizeProjectOutfits(project) {
  const characters = project?.elements?.character;
  if (!Array.isArray(characters)) return false;
  let changed = false;

  const sameList = (a, b) =>
    a.length === b.length && a.every((item, index) =>
      item?.name === b[index]?.name && item?.desc === b[index]?.desc
    );

  for (const character of characters) {
    if (Array.isArray(character.outfits)) {
      const cleaned = filterDistinctOutfits({
        ...(character.source || character),
        clothing: character.source?.clothing || character.clothing,
        outfits: character.outfits,
      });
      if (!sameList(character.outfits, cleaned)) {
        character.outfits = cleaned;
        changed = true;
      }
    }

    if (character.source && Array.isArray(character.source.outfits)) {
      const cleanedSource = filterDistinctOutfits(character.source)
        .map((outfit) => ({ name: outfit.name, desc: outfit.desc }));
      if (!sameList(character.source.outfits, cleanedSource)) {
        character.source.outfits = cleanedSource;
        changed = true;
      }
    }
  }

  return changed;
}

function propText(prop) {
  return [
    prop?.name,
    prop?.shape,
    prop?.material,
    prop?.color,
    prop?.size,
    prop?.marks,
  ].filter(Boolean).join(' ');
}

function characterWearTexts(characters) {
  const out = [];
  for (const character of characters || []) {
    const source = character?.source || character;
    if (source?.clothing) out.push(source.clothing);
    for (const outfit of source?.outfits || []) {
      out.push([outfit?.name, outfit?.desc].filter(Boolean).join(' '));
    }
    for (const variant of source?.variants || []) {
      out.push([variant?.name, variant?.clothing].filter(Boolean).join(' '));
    }
    for (const outfit of character?.outfits || []) {
      out.push([outfit?.name, outfit?.desc].filter(Boolean).join(' '));
    }
    for (const variant of character?.variants || []) {
      out.push([variant?.name, variant?.clothing].filter(Boolean).join(' '));
    }
  }
  return out.filter(Boolean);
}

function isCharacterWearProp(prop, characters) {
  const text = propText(prop);
  if (!text) return false;
  // 先判断是否「看起来像穿戴物」；既非衣物也非配饰的，一定是独立道具，保留
  const looksWearable = hasAnyMarker(text, GARMENT_MARKERS) || hasAnyMarker(text, WEARABLE_ACCESSORY_MARKERS);
  if (!looksWearable) return false;

  // 只有当这件穿戴物确实能对应到某个角色身上的穿着时，才判为「人物造型的一部分」并删除；
  // 否则视为独立道具（信物、法器、陈列服饰等）保留，避免误删剧情道具。
  const name = normalizeOutfitText(prop?.name || '');
  for (const wearText of characterWearTexts(characters)) {
    const wearNorm = normalizeOutfitText(wearText);
    if (name.length >= 2 && wearNorm.includes(name)) return true;
    const textStats = outfitOverlapStats(wearText, text);
    const markerStats = outfitMarkerStats(wearText, text);
    if (textStats.candidateCoverage >= 0.5) return true;
    if (markerStats.matches >= 1 && markerStats.coverage >= 0.4) return true;
  }

  return false;
}

export function filterSceneProps(props, characters, preservedNames = null) {
  return (props || []).filter((prop) => (
    preservedNames?.has(String(prop?.name || '').trim())
    || !isCharacterWearProp(prop, characters)
  ));
}

function renameCollapsedSceneAreaRefs(project, sceneName, previousName, nextName) {
  const previousBinding = `${sceneName}·区域·${previousName}`;
  const nextBinding = `${sceneName}·区域·${nextName}`;
  if (!previousName || !nextName || previousBinding === nextBinding) return false;
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

function normalizeProjectScenes(project) {
  const scenes = project?.elements?.scene;
  if (!Array.isArray(scenes)) return false;
  let changed = false;
  project.elements.scene = scenes.map((scene) => {
    const source = scene?.source && typeof scene.source === 'object'
      ? { ...scene.source, name: scene.source.name || scene.name }
      : { name: scene?.name || '' };
    const cleanedSource = cleanSceneState(source);
    // 子区域可能存放在元素顶层或 source 里（旧项目文件），统一收拢到两处一致
    const rawAreas = [
      ...(Array.isArray(scene?.areas) ? scene.areas : []),
      ...(Array.isArray(source.areas) ? source.areas : []),
    ];
    const areaSource = normalizeSceneAreas(rawAreas);
    cleanedSource.areas = areaSource;
    const nextName = cleanedSource.name || scene?.name || '';
    const retainedAreaByKey = new Map(areaSource.map((area) => [sceneAreaNameKey(area.name), area]));
    for (const rawArea of rawAreas) {
      const previousName = String((typeof rawArea === 'string' ? rawArea : rawArea?.name) || '').trim();
      const retained = retainedAreaByKey.get(sceneAreaNameKey(previousName));
      if (retained && renameCollapsedSceneAreaRefs(project, nextName, previousName, retained.name)) changed = true;
    }
    const style = project?.imageStyle || 'realistic';
    const next = {
      ...scene,
      name: nextName,
      source: cleanedSource,
      areas: areaSource.map((area) => {
        const previousAreas = Array.isArray(scene?.areas) ? scene.areas : [];
        const exact = previousAreas.find((item) => item && String(item.name || '').trim() === area.name);
        const editedAlias = previousAreas.find((item) => (
          item && sameSceneAreaName(item.name, area.name) && item.promptEdited && item.prompt
        ));
        const prev = exact?.promptEdited && exact?.prompt ? exact : editedAlias || exact;
        const keepPrompt = prev?.promptEdited && prev?.prompt;
        return {
          ...area,
          prompt: keepPrompt ? prev.prompt : buildSceneAreaPrompt(cleanedSource, area, style),
          promptEdited: !!keepPrompt,
        };
      }),
    };
    if (!scene?.edited) {
      next.prompt = buildScenePrompt(cleanedSource, style);
    }
    if (
      next.name !== scene?.name ||
      JSON.stringify(next.source || {}) !== JSON.stringify(scene?.source || {}) ||
      JSON.stringify(next.areas || []) !== JSON.stringify(scene?.areas || []) ||
      (!scene?.edited && next.prompt !== scene?.prompt)
    ) {
      changed = true;
    }
    return next;
  });
  return changed;
}

export function normalizeProjectElements(project) {
  if (!project.elements) project.elements = {};
  let changed = false;
  if (!Array.isArray(project.elements.character)) {
    project.elements.character = [];
    changed = true;
  }
  if (!Array.isArray(project.elements.scene)) {
    project.elements.scene = [];
    changed = true;
  }
  if (!Array.isArray(project.elements.prop)) {
    project.elements.prop = [];
    changed = true;
  }
  if (!Array.isArray(project.elements.effect)) {
    project.elements.effect = [];
    changed = true;
  }
  if (!Array.isArray(project.elements.creature)) {
    project.elements.creature = [];
    changed = true;
  }

  if (normalizeElementListNames(project)) changed = true;
  // Existing character looks are user assets. Extraction cleanup is applied
  // while composing new model output, never while opening or saving a project.
  if (normalizeProjectScenes(project)) changed = true;
  return changed;
}

const VARIANT_FIELDS = ['desc', 'identity', 'appearance', 'body', 'hair', 'clothing', 'makeupAccessories', 'traits'];
const CHARACTER_ALIAS_FIELDS = ['aliases', 'alias', 'nicknames', 'nickname', 'titles', 'title', 'appellations', 'mentions'];
const CHARACTER_ALIAS_SPLIT_RE = /[、,，;；/／|｜\n\r\t]+/;

const CHARACTER_TRANSIENT_CONTEXT_RE = /(?:当前|此刻|此时|眼下|现场|刚刚|刚|正在|正|临时|暂时|才被|刚被|已被|正在被)/;
const CHARACTER_TRANSIENT_EVENT_RE = /(?:表情|神情|情绪|动作|姿态|站位|手持|拿着|握着|举着|抱着|扶着|靠着|低头|抬头|回头|看向|盯着|微笑|笑着|愤怒|哭泣|哭着|惊讶|狰狞|痛苦|喘息|颤抖|疲惫|憔悴|虚弱|狼狈|受伤|伤口|流血|血迹|血泊|鲜血|脸色苍白|唇色偏淡|黑眼圈|眼下阴影|湿透|淋湿|衣衫凌乱|衣服破损|衣物破损|披头散发|头发凌乱|满身尘土|满身灰尘|昏迷|昏倒|倒地|倒在|躺着|躺在|跪着|跪在|跪地|跌坐|趴着|趴在|奔跑|冲进|逃跑|打斗|战斗|对峙)/;
const CHARACTER_TRANSIENT_DIRECT_RE = /(?:当前状态|临时状态|剧情状态|出场状态|此刻状态|人物状态|动作状态|情绪状态|表情状态|受伤状态|战斗状态|倒地状态|跪地状态|昏迷状态|浑身(?:是)?(?:鲜血|血迹|尘土|灰尘)|满身(?:鲜血|血迹|尘土|灰尘)|沾满(?:鲜血|血迹|尘土|灰尘)|(?:衣衫|衣服|衣物|长裙|礼服|外套|衬衫|头发|发丝|发型).*(?:凌乱|破损|湿透|淋湿|染血|血迹|撕裂)|(?:湿透|淋湿|染血|血迹|衣衫凌乱|头发凌乱|披头散发)|(?:脸色苍白|唇色偏淡|黑眼圈|眼下阴影|憔悴|疲惫|狼狈|虚弱|昏迷|倒地|跪地|跌坐|流血|受伤|伤口|血迹|血泊|鲜血))/;
const CHARACTER_NAME_TRANSIENT_PREFIX_RE = /^(?:当前|此刻|此时|眼下|受伤的|负伤的|流血的|哭泣的|愤怒的|疲惫的|憔悴的|狼狈的|昏迷的|跪地的|倒地的|湿透的|浑身是血的|衣衫凌乱的)/;
const CHARACTER_TRANSIENT_VARIANT_NAME_RE = /^(?:当前|此刻|临时)?(?:受伤|负伤|流血|疲惫|憔悴|狼狈|哭泣|愤怒|昏迷|倒地|跪地|奔跑|战斗|对峙|湿透|衣衫凌乱)(?:状态|姿态|形态)?$/;
const CHARACTER_TRANSIENT_OUTFIT_NAME_RE = /(?:湿透|淋湿|染血|血迹|沾血|破损|凌乱|战损|撕裂)/;
const CHARACTER_HORROR_IDENTITY_RE = /(?:女诡|男诡|诡异|诡怪|规则怪谈|怪谈|女鬼|男鬼|厉鬼|恶鬼|鬼魂|鬼怪|怨灵|亡灵|幽灵|邪祟|妖邪|非人|异化|怪物|尸|僵尸|吸血鬼|恶灵|灵异)/;
const CHARACTER_HORROR_STABLE_TRAIT_RE = /(?:苍白|惨白|冷白|死白|无血色|唇色偏淡|暗红唇|黑眼圈|眼下阴影|青黑|阴冷|冷感|非人|诡异|怪异|压迫感|危险感|病态美|空洞|瞳孔|眼白|血丝|僵硬|裂纹|低温感)/;
const CHARACTER_HORROR_TEMPORARY_STATE_RE = /(?:当前|此刻|此时|眼下|现场|刚刚|刚|正在|正|临时|暂时|才被|刚被|已被|正在被|受伤|伤口|流血|血迹|血泊|鲜血|湿透|淋湿|衣衫凌乱|衣服破损|衣物破损|昏迷|倒地|跪地|奔跑|打斗|战斗|对峙)/;

function isHorrorCharacter(character) {
  const text = [
    character?.name,
    character?.identity,
    character?.appearance,
    character?.body,
    character?.hair,
    character?.clothing,
    character?.makeupAccessories,
    character?.traits,
    character?.originalAppearance,
    ...(Array.isArray(character?.aliases) ? character.aliases : []),
  ].filter(Boolean).join(' ');
  return CHARACTER_HORROR_IDENTITY_RE.test(text);
}

function isStableHorrorTraitClause(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return CHARACTER_HORROR_STABLE_TRAIT_RE.test(text) && !CHARACTER_HORROR_TEMPORARY_STATE_RE.test(text);
}

function isTransientCharacterClause(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (options.allowHorrorTraits && isStableHorrorTraitClause(text)) return false;
  if (CHARACTER_TRANSIENT_DIRECT_RE.test(text)) return true;
  return CHARACTER_TRANSIENT_CONTEXT_RE.test(text) && CHARACTER_TRANSIENT_EVENT_RE.test(text);
}

function cleanCharacterText(value, options = {}) {
  const text = String(value || '')
    .replace(/(?:当前状态|临时状态|剧情状态|出场状态|此刻状态|人物状态|动作状态|情绪状态|表情状态)\s*[：:]\s*[^；;。.\n，,]*/g, '')
    .trim();
  if (!text) return '';

  const clauses = text.split(/[；;。.\n，,]+/).map((part) => part.trim()).filter(Boolean);
  if (!clauses.length) return '';
  if (clauses.length === 1) return isTransientCharacterClause(clauses[0], options) ? '' : clauses[0];
  return clauses.filter((part) => !isTransientCharacterClause(part, options)).join('；');
}

function cleanCharacterName(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  const cleaned = original
    .replace(/(?:当前状态|临时状态|剧情状态|出场状态|此刻状态)\s*[：:].*$/g, '')
    .replace(CHARACTER_NAME_TRANSIENT_PREFIX_RE, '')
    .trim();
  return cleaned || original;
}

function characterAliasKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’`·•,，.。!！?？:：;；、()[\]{}<>《》【】\\/|｜\-—_+=*#~^$@%&]/g, '');
}

function collectRawCharacterAliases(character) {
  const out = [];
  const push = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value === 'object') return;
    const raw = String(value || '').trim();
    if (!raw) return;
    for (const part of raw.split(CHARACTER_ALIAS_SPLIT_RE)) {
      const alias = part
        .replace(/^(?:别名|代称|称呼|昵称|尊称|称号|aliases?|alias)\s*[：:]/i, '')
        .trim();
      if (alias) out.push(alias);
    }
  };
  for (const field of CHARACTER_ALIAS_FIELDS) push(character?.[field]);
  if (character?.source && typeof character.source === 'object') {
    for (const field of CHARACTER_ALIAS_FIELDS) push(character.source[field]);
  }
  return out;
}

function cleanCharacterAliases(values, canonicalName = '') {
  const aliases = [];
  const seen = new Set();
  const canonicalKey = characterAliasKey(canonicalName);
  for (const raw of values || []) {
    const alias = cleanCharacterName(raw);
    const key = characterAliasKey(alias);
    if (!alias || !key || key === canonicalKey || seen.has(key)) continue;
    if (key.length < 1 || alias.length > 40) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases.slice(0, 80);
}

function cleanCharacterOutfit(outfit) {
  if (!outfit || typeof outfit !== 'object') return outfit;
  return {
    ...outfit,
    name: cleanCharacterName(outfit.name),
    desc: cleanCharacterText(outfit.desc),
  };
}

function cleanCharacterVariant(variant) {
  if (!variant || typeof variant !== 'object') return variant;
  const cleaned = { ...variant, name: cleanCharacterName(variant.name) };
  for (const f of VARIANT_FIELDS) {
    cleaned[f] = cleanCharacterText(cleaned[f]);
  }
  cleaned.originalAppearance = cleanCharacterText(cleaned.originalAppearance);
  return cleaned;
}

export function cleanCharacterState(character, { preserveName = false } = {}) {
  if (!character || typeof character !== 'object') return character;
  const cleaned = { ...character };
  if (!preserveName) cleaned.name = cleanCharacterName(cleaned.name);
  cleaned.aliases = cleanCharacterAliases(collectRawCharacterAliases(cleaned), cleaned.name);
  for (const field of CHARACTER_ALIAS_FIELDS) {
    if (field !== 'aliases') delete cleaned[field];
  }
  const textCleanOptions = { allowHorrorTraits: isHorrorCharacter(cleaned) };
  for (const f of [...CHAR_FIELDS, ...CHAR_EXTRA_FIELDS]) {
    cleaned[f] = cleanCharacterText(cleaned[f], textCleanOptions);
  }
  if (Array.isArray(cleaned.outfits)) {
    cleaned.outfits = cleaned.outfits
      .map(cleanCharacterOutfit)
      .filter((o) => {
        const name = (o?.name || '').trim();
        if (name && CHARACTER_TRANSIENT_OUTFIT_NAME_RE.test(name)) return false;
        return name || (o?.desc || '').trim();
      });
  }
  if (Array.isArray(cleaned.variants)) {
    cleaned.variants = cleaned.variants
      .map(cleanCharacterVariant)
      .filter((v) => {
        const name = (v?.name || '').trim();
        if (!name || CHARACTER_TRANSIENT_VARIANT_NAME_RE.test(name)) return false;
        return VARIANT_FIELDS.some((f) => (v?.[f] || '').trim());
      });
  }
  return cleaned;
}

const SCENE_TRANSIENT_CONTEXT_RE = /(?:正在|正有|此刻|当前|眼下|现场|刚刚|刚|突然|临时|暂时|才被|刚被|已被|正在被|转眼|瞬间)/;
const SCENE_TRANSIENT_EVENT_RE = /(?:打斗|战斗|对峙|追逐|围攻|围观|聚集|挤满|冲进|倒地|躺着|站着|坐着|跪着|哭喊|尖叫|燃烧|爆炸|冒烟|坍塌|塌陷|砸碎|撞碎|毁坏|破坏|染红|血迹|血痕|血污|血泊|鲜血|黑狗血|暗红|尸体|残骸|碎片|烟尘|灰烬|污渍|脏污|痕迹|撒落|洒落|散落|大米|糯米|米粒|符纸|香灰|纸钱|驱邪|法事|仪式残留|临时法阵|剑气|灵力|法阵|结界|能量|光波)/;
const SCENE_TRANSIENT_DIRECT_RE = /(?:当前状态|现场状态|剧情状态|人物状态|人物站位|人物动作|人物情绪|人群围观|群众围观|众人围观|尸体倒地|(?:地面|墙面|桌面|桌上|室内|屋内|院中).*(?:血迹|血痕|血污|鲜血|黑狗血|暗红|污渍|脏污|灰烬|碎片|撒落|洒落|散落|大米|糯米|米粒|符纸|香灰|纸钱|驱邪|法事|仪式残留|痕迹)|满地(?:鲜血|血迹|血痕|黑狗血|尸体|碎片|大米|糯米|米粒|符纸|香灰|纸钱)|遍地(?:鲜血|血迹|血痕|尸体|碎片)|一地(?:鲜血|血迹|血痕|尸体|碎片|大米|糯米|米粒|符纸|香灰|纸钱)|(?:血迹|血痕|血污|黑狗血|暗红痕迹|污渍|脏污|灰烬|碎片|撒落物|散落物|驱邪物|仪式残留)|被(?:鲜血|血迹|血痕|黑狗血|火焰|烟尘).*(?:染红|覆盖|吞没|笼罩)|(?:战斗|打斗|对峙|追逐|围攻|混乱)中|(?:燃烧|冒烟|爆炸|坍塌)中|(?:火焰|烟尘|剑气|灵力|法阵|结界|能量|光波)(?:翻涌|弥漫|爆开|扩散|笼罩|覆盖))/;
const SCENE_NAME_TRANSIENT_PREFIX_RE = /^(?:正在|正被|被|刚被|已被|当前|此刻|眼下)?(?:鲜血染红|血迹斑斑|血痕遍布|火焰吞没|烟尘笼罩|人群围观|群众围观|打斗中|战斗中|对峙中|混乱中|燃烧中|冒烟中|爆炸后|破坏后|尸横遍地|满地尸体|满地血迹|满地血痕|满地大米|驱邪仪式后|挤满人群|聚满人群)的?/;

function isTransientSceneClause(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (SCENE_TRANSIENT_DIRECT_RE.test(text)) return true;
  return SCENE_TRANSIENT_CONTEXT_RE.test(text) && SCENE_TRANSIENT_EVENT_RE.test(text);
}

function cleanSceneText(value) {
  const text = String(value || '')
    .replace(/(?:当前状态|现场状态|剧情状态|人物状态|人物站位|人物动作|人物情绪)\s*[：:]\s*[^；;。.\n，,]*/g, '')
    .trim();
  if (!text) return '';

  const clauses = text.split(/[；;。.\n，,]+/).map((part) => part.trim()).filter(Boolean);
  if (!clauses.length) return '';
  if (clauses.length === 1) return isTransientSceneClause(clauses[0]) ? '' : clauses[0];
  return clauses.filter((part) => !isTransientSceneClause(part)).join('；');
}

function cleanSceneName(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  const cleaned = original
    .replace(/(?:当前状态|现场状态|剧情状态)\s*[：:].*$/g, '')
    .replace(SCENE_NAME_TRANSIENT_PREFIX_RE, '')
    .trim();
  return cleaned || original;
}

export function cleanSceneState(scene, { preserveName = false } = {}) {
  if (!scene || typeof scene !== 'object') return scene;
  const cleaned = { ...scene };
  if (!preserveName) cleaned.name = cleanSceneName(cleaned.name);
  for (const f of SCENE_FIELDS) {
    cleaned[f] = cleanSceneText(cleaned[f]);
  }
  return cleaned;
}

export function cleanExtractedSceneState(scene) {
  const cleaned = cleanSceneState(scene);
  if (cleaned && typeof cleaned === 'object') delete cleaned.areas;
  return cleaned;
}

const INVALID_EXTRACTED_NAME_EXACT = new Set([
  '成功', '失败', '完成', '通过', '结果', '状态', '进度', '提示', '警告', '选项',
  '提取', '分析', '生成', '重生成', '保存', '上传', '删除', '导出',
  '人物', '角色', '场景', '地点', '道具', '物品', '特效', '效果', '元素', '素材',
  '提示词', '参考图', '图片', '图像', '镜头', '画面', '分镜', '台词', '对白', '字幕',
  '三围', '三维', '二维', '一维', '三维空间关系', '空间关系',
  '3d', '2d', 'cg', 'vfx', 'ue5', '8k', 'pbr', '写实', '真人', '动漫', '国漫', '插画',
  '风格', '画风', '渲染', '建模', '光影', '材质',
  '成功率', '失败率', '好感度', '危险指数', '愤怒值', '当前好感度', '当前愤怒值',
]);

const INVALID_EXTRACTED_NAME_RE = /^(?:第?[0-9一二三四五六七八九十百千万]+(?:集|章|段|场|镜|镜头|条|秒|分钟)|场景\s*\d+|分镜\s*\d+|镜头\s*\d+|[0-9]+%|[0-9]+(?:点|颗星))$/i;

// 小说原文的排版/结构标签行（如「正文：」「人设是：」「设定：」），会被「姓名：台词」
// 正则误判成具名说话人。即使某个文本模型自行把它们吐成元素，也要在落库前拦掉。
const STRUCTURAL_LABEL_NAME_RE = /^(?:正文|人设|人物设定|角色设定|设定|简介|内容简介|目录|作者|前言|序言|后记|摘要|概要|大纲|梗概|番外|连载|完结|完本|声明|免责声明|注释|附录|本章|上一章|下一章|未完待续|全文|原文|译文|译者|出处|来源|关键词|标签|分类|类型|题材)(?:是|为|如下|介绍)?$/;

function cleanGenericElementName(value) {
  return String(value || '')
    .trim()
    .replace(/^[【\[\(（「“"'`]+|[】\]\)）」”"'`]+$/g, '')
    .replace(/^(?:name|名称|名字|元素名|素材名)\s*[：:]\s*/i, '')
    .replace(/^(?:人物|角色|群像|场景|地点|道具|物品|特效|效果|法术|镜头|画面|分镜)\s*\d*\s*[：:]\s*/, '')
    .trim();
}

function extractedNameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’`·•,，.。!！?？:：;；、()[\]{}<>《》【】\\/|｜\-—_+=*#~^$@%&]/g, '');
}

function elementCategoryFromMergeKey(key) {
  if (key === 'c' || key === 'character') return 'character';
  if (key === 'g' || key === 'group' || key === 'groups') return 'group';
  if (key === 's' || key === 'scene') return 'scene';
  if (key === 'p' || key === 'prop') return 'prop';
  if (key === 'e' || key === 'effect') return 'effect';
  if (key === 'cr' || key === 'creature') return 'creature';
  return '';
}

function cleanElementName(value, category = '') {
  const generic = cleanGenericElementName(value);
  const cleaned = category === 'character'
    ? cleanCharacterName(generic)
    : category === 'scene'
      ? cleanSceneName(generic)
      : generic;
  const name = cleanGenericElementName(cleaned);
  if (isInvalidElementName(name)) return '';
  return name;
}

function isInvalidElementName(value) {
  const name = String(value || '').trim();
  if (!name) return true;
  const key = extractedNameKey(name);
  if (!key) return true;
  if (INVALID_EXTRACTED_NAME_EXACT.has(key)) return true;
  if (INVALID_EXTRACTED_NAME_RE.test(name)) return true;
  if (STRUCTURAL_LABEL_NAME_RE.test(name)) return true;
  if (/^(?:三围|三维|二维|3d|2d)(?:数据|信息|关系|空间关系|画风|风格|渲染|动画|动漫)?$/i.test(name)) return true;
  if (/^(?:三围|三维|二维|3d|2d)(?:数据|信息|关系|空间关系|画风|风格|渲染|动画|动漫)?$/i.test(key)) return true;
  if (/^(?:成功|失败|完成|通过)(?:率|状态|结果|提示|信息)?$/i.test(name)) return true;
  if (/^(?:成功|失败|完成|通过)(?:率|状态|结果|提示|信息)?$/i.test(key)) return true;
  return false;
}

function normalizeElementListNames(project) {
  let changed = false;
  for (const category of ['character', 'group', 'scene', 'prop', 'effect', 'creature']) {
    const list = project?.elements?.[category];
    if (!Array.isArray(list)) continue;
    const nextList = [];
    const seen = new Set();
    for (const el of list) {
      // User-created elements are authoritative. Extraction cleanup must never
      // rename, deduplicate, or drop a material the user explicitly added.
      if (el?.userCreated === true) {
        nextList.push(el);
        continue;
      }
      const source = el?.source && typeof el.source === 'object' ? { ...el.source } : null;
      const rawName = source?.name || el?.name || '';
      const name = cleanElementName(rawName, category);
      if (!name) {
        changed = true;
        continue;
      }
      const key = extractedNameKey(name);
      if (seen.has(key)) {
        changed = true;
        continue;
      }
      seen.add(key);
      const next = { ...el, name };
      if (source) {
        source.name = name;
        next.source = source;
      }
      if (next.name !== el?.name || JSON.stringify(next.source || null) !== JSON.stringify(el?.source || null)) {
        changed = true;
      }
      nextList.push(next);
    }
    if (nextList.length !== list.length) changed = true;
    project.elements[category] = nextList;
  }
  return changed;
}

function mergeTextFields(existing, item, fields) {
  for (const f of fields) {
    const cur = String(existing[f] || '').trim();
    const add = String(item[f] || '').trim();
    if (!add) continue;
    if (!cur) existing[f] = add;
    else if (add.length > cur.length * 1.2) existing[f] = add;
  }
}

function mergeOptionalText(existing, item, fields) {
  for (const f of fields) {
    const cur = String(existing[f] || '').trim();
    const add = String(item[f] || '').trim();
    if (!add) continue;
    if (!cur) existing[f] = add;
    else if (add.length > cur.length * 1.2) existing[f] = add;
  }
}

function mergeCharacterAliases(existing, incoming, canonicalName) {
  existing.aliases = cleanCharacterAliases([
    ...(existing.aliases || []),
    ...(incoming.aliases || []),
    existing.name,
    incoming.name,
  ], canonicalName);
}

function mergeGroupMembers(existing, incoming) {
  if (!Array.isArray(incoming?.members) || !incoming.members.length) return;
  if (!Array.isArray(existing.members)) existing.members = [];
  for (const rawMember of incoming.members) {
    if (!rawMember || typeof rawMember !== 'object') continue;
    const member = {
      label: String(rawMember.label || rawMember.knownName || '').trim(),
      knownName: String(rawMember.knownName || '').trim(),
      appearance: String(rawMember.appearance || '').trim(),
      hair: String(rawMember.hair || '').trim(),
      body: String(rawMember.body || '').trim(),
      clothing: String(rawMember.clothing || '').trim(),
      distinction: String(rawMember.distinction || '').trim(),
    };
    if (!member.label && !member.knownName) continue;
    const key = extractedNameKey(member.knownName || member.label);
    const found = existing.members.find((item) => extractedNameKey(item?.knownName || item?.label) === key);
    if (!found) existing.members.push(member);
    else mergeTextFields(found, member, GROUP_MEMBER_FIELDS);
  }
}

// 收集人物规范名，用于判断群像是否其实是「具名人物的集合」。
// 只取 ≥2 字的名字：单字名做子串匹配假阳性太高。
function namedCharacterEntries(characters = []) {
  const out = [];
  const seen = new Set();
  for (const character of characters) {
    const raw = String(character?.name || character?.source?.name || '').trim();
    const key = extractedNameKey(raw);
    if (!raw || !key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, key });
  }
  return out;
}

// 群像名是否是具名人物组合，例如「萧云一行人」「萧云与苏瑶」。
function groupNameReferencesNamedCharacter(group = {}, entries = []) {
  const nameKey = extractedNameKey(group?.name);
  if (!nameKey) return false;
  return entries.some((entry) => nameKey.includes(entry.key));
}

// 成员的 knownName 命中人物规范名：该成员是特定某个人，不是可复用的无名成员。
function memberIsNamedCharacter(member, entries = []) {
  const key = extractedNameKey(member?.knownName);
  if (!key) return false;
  return entries.some((entry) => entry.key === key);
}

// 群像是否**整条**都该丢弃。
// 只认两个硬信号：群像名本身是具名人物组合，或所有成员都是具名人物（那就不是群像素材）。
// identity/composition 里提到人物名（如「萧云所在门派的外门弟子」）只是在交代所属阵营，
// 属于合法群像，不再据此删除整条——那是之前群像大面积消失的主因。
export function groupReferencesNamedCharacter(group = {}, characters = []) {
  const entries = namedCharacterEntries(characters);
  if (!entries.length) return false;
  if (groupNameReferencesNamedCharacter(group, entries)) return true;
  const members = Array.isArray(group?.members) ? group.members : [];
  if (!members.length) return false;
  const named = members.filter((member) => memberIsNamedCharacter(member, entries));
  return named.length > 0 && named.length === members.length;
}

// 把具名人物的名字从群像的说明性字段里剔掉，避免出图时模型去画那个特定角色。
// 只动 identity/composition/traits/sharedClothing 这类描述字段，不动群像名。
const GROUP_SCRUB_FIELDS = ['identity', 'composition', 'traits', 'sharedClothing'];

function scrubNamedCharactersFromGroup(group, entries) {
  let changed = false;
  for (const field of GROUP_SCRUB_FIELDS) {
    const original = String(group?.[field] || '');
    if (!original) continue;
    let next = original;
    for (const entry of entries) {
      if (!next.includes(entry.raw)) continue;
      next = next.split(entry.raw).join('');
    }
    if (next === original) continue;
    // 剔除人名后可能留下悬空的连接词与标点，收拾干净
    next = next
      .replace(/[，,、；;]{2,}/g, '，')
      .replace(/^[的与和及跟同为在是，,、；;。\s]+/, '')
      .replace(/[的与和及跟同为在是，,、；;\s]+$/, '')
      .trim();
    group[field] = next;
    changed = true;
  }
  return changed;
}

// 过滤群像。preservedNames 里的（用户手工编辑过的）永不动。
// onDrop 用于把被丢弃的群像名回传给调用方，避免「提取不出来」变成无声黑盒。
export function filterGroupsWithNamedCharacters(groups = [], characters = [], preservedNames = new Set(), { onDrop } = {}) {
  const keep = preservedNames instanceof Set ? preservedNames : new Set(preservedNames || []);
  const entries = namedCharacterEntries(characters);
  const out = [];
  for (const group of groups) {
    if (keep.has(group?.name)) {
      out.push(group);
      continue;
    }
    if (groupReferencesNamedCharacter(group, characters)) {
      if (typeof onDrop === 'function') onDrop(group);
      continue;
    }
    if (entries.length) {
      // 保留这条群像，但把混进来的具名成员和描述里的人名清掉
      if (Array.isArray(group?.members)) {
        const cleanMembers = group.members.filter((member) => !memberIsNamedCharacter(member, entries));
        if (cleanMembers.length !== group.members.length) group.members = cleanMembers;
      }
      scrubNamedCharactersFromGroup(group, entries);
    }
    out.push(group);
  }
  return out;
}

function mergeVariants(existing, item) {
  if (!Array.isArray(item.variants) || !item.variants.length) return;
  if (!Array.isArray(existing.variants)) existing.variants = [];
  for (const v of item.variants) {
    const vname = (v?.name || '').trim();
    if (!vname) continue;
    const found = existing.variants.find((x) => x.name === vname);
    const incoming = {
      name: vname,
      desc: (v.desc || '').trim(),
      identity: (v.identity || '').trim(),
      appearance: (v.appearance || '').trim(),
      body: (v.body || '').trim(),
      hair: (v.hair || '').trim(),
      clothing: (v.clothing || '').trim(),
      makeupAccessories: (v.makeupAccessories || '').trim(),
      traits: (v.traits || '').trim(),
      originalAppearance: (v.originalAppearance || '').trim(),
    };
    if (!found) existing.variants.push(incoming);
    else mergeTextFields(found, incoming, VARIANT_FIELDS);
  }
}

// 合并同名元素：后出现的非空字段补充进先有的
function mergeInto(map, key, item, fields, extraFields = []) {
  const category = elementCategoryFromMergeKey(key);
  const incoming = key === 'c'
    ? cleanCharacterState(item)
    : key === 's'
      ? cleanExtractedSceneState(item)
      : item;
  const name = cleanElementName(incoming.name, category);
  if (!name) return;
  incoming.name = name;
  if (!map.has(name)) {
    map.set(name, { ...incoming, name });
    return;
  }
  const existing = map.get(name);
  mergeTextFields(existing, incoming, fields);
  if (extraFields.length) mergeOptionalText(existing, incoming, extraFields);
  if (category === 'character') mergeCharacterAliases(existing, incoming, name);
  if (category === 'group') mergeGroupMembers(existing, incoming);
  // 合并多套服装（按服装名去重，跨块累积）
  if (Array.isArray(incoming.outfits) && incoming.outfits.length) {
    if (!Array.isArray(existing.outfits)) existing.outfits = [];
    for (const o of incoming.outfits) {
      const oname = (o?.name || '').trim();
      if (!oname) continue;
      const found = existing.outfits.find((x) => x.name === oname);
      if (!found) existing.outfits.push({ name: oname, desc: (o.desc || '').trim() });
      else if ((o.desc || '').trim().length > (found.desc || '').length) found.desc = o.desc.trim();
    }
  }
  mergeVariants(existing, incoming);
}

const CHAR_FIELDS = ['identity', 'voice', 'appearance', 'body', 'hair', 'clothing', 'makeupAccessories', 'traits'];
const CHAR_EXTRA_FIELDS = ['originalAppearance'];
const GROUP_FIELDS = ['identity', 'memberCount', 'sharedClothing', 'composition', 'traits'];
const GROUP_MEMBER_FIELDS = ['label', 'knownName', 'appearance', 'hair', 'body', 'clothing', 'distinction'];
const SCENE_FIELDS = ['envType', 'time', 'atmosphere', 'features', 'light', 'color'];
const EFFECT_FIELDS = ['effectType', 'source', 'visualCore', 'motion', 'colorLight', 'scale', 'environmentInteraction', 'closeup'];

// 场景子区域（areas）：同一空间内部的具体区域，后续以主场景图为参考图单独出图。
// 结构与人物的 outfits 对齐：[{ name, desc }]，按名去重、跨块累积。
export function normalizeSceneAreas(value) {
  return normalizeSceneAreaRecords(value);
}

const PROP_FIELDS = ['shape', 'material', 'color', 'size', 'marks'];
const CREATURE_FIELDS = ['archetype', 'species', 'size', 'headFeatures', 'anatomy', 'pose', 'surface', 'featureMarks', 'ornamentArmor', 'aura', 'habitat'];

function mergeEditedPromptParts(defaultParts, oldParts, oldEdited) {
  const parts = normalizeCharacterPromptParts(defaultParts);
  const edited = normalizeCharacterPartsEdited(oldEdited);
  const previous = normalizeCharacterPromptParts(oldParts);
  for (const field of Object.keys(edited)) {
    if (edited[field]) parts[field] = previous[field];
  }
  return { parts, edited };
}

const EXTRACTION_CATEGORIES = ['character', 'group', 'scene', 'prop', 'effect', 'creature'];

function normalizeExtractionCategories(value) {
  if (value === undefined || value === null || value === 'all') return null;
  const raw = Array.isArray(value) ? value : [value];
  const categories = [...new Set(raw.map((item) => String(item || '').trim()).filter((item) => EXTRACTION_CATEGORIES.includes(item)))];
  return categories.length && categories.length < EXTRACTION_CATEGORIES.length ? categories : null;
}

export function buildCharacterExtractionSeed(element, { resetVisuals = false } = {}) {
  if (!element || typeof element !== 'object') return null;
  const rawSource = element.source && typeof element.source === 'object' ? element.source : element;
  const source = cleanCharacterState({
    ...rawSource,
    name: element.source?.name || element.name,
  });
  const name = cleanElementName(source?.name || element.name, 'character');
  if (!name) return null;
  const aliases = cleanCharacterAliases([
    ...collectRawCharacterAliases(source),
    ...collectRawCharacterAliases(element),
  ], name);
  const assets = {
    outfits: cloneExtractionData(Array.isArray(element.outfits) ? element.outfits : rawSource.outfits || []),
    variants: cloneExtractionData(Array.isArray(element.variants) ? element.variants : rawSource.variants || []),
  };
  if (resetVisuals) return { name, aliases, ...assets };
  return { ...source, name, aliases, ...assets };
}

// 主流程。onProgress(state) 用于上报进度
// seed: 可选，已有项目的 elements（{character,group,scene,prop,effect}），用于跨次提取的合并去重
export async function extractElements(text, textCfg, chunkSize, onProgress = () => {}, seed = null, style = 'realistic', promptTemplateConfig = null, stylePromptConfig = null, { signal, categories: requestedCategories, concurrency = 1 } = {}) {
  const selectedCategories = normalizeExtractionCategories(requestedCategories);
  const shouldExtract = (category) => !selectedCategories || selectedCategories.includes(category);
  const resetCharacterVisuals = promptTemplateConfig?.selectedId === 'second';
  // 使用智能分块（带上下文重叠）
  const chunkObjects = smartChunkText(text, {
    chunkSize,
    overlapSize: Math.floor(chunkSize * 0.05), // 5% 重叠
    useCache: true,
    strategy: 'paragraph' // 按段落分块
  });

  const chunks = chunkObjects.map(c => c.text);
  const charMap = new Map();
  const groupMap = new Map();
  const sceneMap = new Map();
  const propMap = new Map();
  const effectMap = new Map();
  const creatureMap = new Map();
  const errors = [];
  const seededElementNames = new Map(EXTRACTION_CATEGORIES.map((category) => [category, new Set()]));
  const userCreatedElementNames = new Set();

  // 记录已有元素的「用户编辑过的提示词」，重新合成时不覆盖
  const keptPrompts = new Map(); // `${cat}:${name}` -> prompt
  const keptCharacterParts = new Map();
  const keptCharacterPartsEdited = new Map();
  if (seed) {
    const seedCat = (list, map, key) => {
      for (const el of list || []) {
        if (el.source) {
          const source = key === 'scene'
            ? cleanSceneState({ ...el.source, name: el.source.name || el.name })
            : key === 'character'
              ? buildCharacterExtractionSeed(el, { resetVisuals: resetCharacterVisuals })
              : { ...el.source, name: el.name };
          if (!source) continue;
          // Existing project assets are authoritative input, including legacy
          // manually-added assets created before userCreated was persisted.
          const name = String(el.name || source.name || '').trim();
          if (name) {
            seededElementNames.get(key)?.add(name);
            if (el.userCreated === true) userCreatedElementNames.add(`${key}:${name}`);
            if (key === 'character') {
              source.aliases = cleanCharacterAliases([
                ...collectRawCharacterAliases(source),
                ...collectRawCharacterAliases(el),
              ], name);
            }
            if (key === 'scene') {
              // 子区域既可能存在 source.areas，也可能存在元素顶层 areas（与 outfits 同构）
              source.areas = normalizeSceneAreas([
                ...normalizeSceneAreas(source.areas),
                ...normalizeSceneAreas(el.areas),
              ]);
            }
            map.set(name, { ...source, name });
          }
        }
        if (el.edited && el.prompt) {
          keptPrompts.set(`${key}:${el.name}`, el.prompt);
          if (el.source) {
            const cleanedName = key === 'scene'
              ? cleanSceneName(el.source.name || el.name)
              : key === 'character'
                ? cleanCharacterName(el.source.name || el.name)
                : el.name;
            if (cleanedName && cleanedName !== el.name) keptPrompts.set(`${key}:${cleanedName}`, el.prompt);
          }
        }
        if (key === 'scene') {
          for (const area of el.areas || []) {
            if (area?.promptEdited && area.prompt) keptPrompts.set(`sceneArea:${el.name}:${area.name}`, area.prompt);
          }
        }
        if (key === 'character') {
          if (el.promptParts) keptCharacterParts.set(el.name, el.promptParts);
          if (el.partsEdited) keptCharacterPartsEdited.set(el.name, el.partsEdited);
          for (const outfit of el.outfits || []) {
            if (outfit?.promptEdited && outfit.prompt) keptPrompts.set(`outfit:${el.name}:${outfit.name}`, outfit.prompt);
          }
          for (const variant of el.variants || []) {
            if (variant?.promptEdited && variant.prompt) keptPrompts.set(`variant:${el.name}:${variant.name}`, variant.prompt);
          }
        }
      }
    };
    seedCat(seed.character, charMap, 'character');
    seedCat(seed.group, groupMap, 'group');
    seedCat(seed.scene, sceneMap, 'scene');
    seedCat(seed.prop, propMap, 'prop');
    seedCat(seed.effect, effectMap, 'effect');
    seedCat(seed.creature, creatureMap, 'creature');
  }

  // 已有资产清单：seed（项目里已存在的素材）+ 前面各块累积出来的结果。
  // 每块调用前重新快照一次，让模型知道哪些名字已经存在、必须沿用，避免同一对象跨块被起成多个名字。
  const buildKnownRoster = () => ({
    character: [...charMap.values()].map((c) => ({
      name: c.name,
      aliases: cleanCharacterAliases(collectRawCharacterAliases(c), c.name),
    })),
    group: [...groupMap.keys()],
    scene: [...sceneMap.keys()],
    prop: [...propMap.keys()],
    effect: [...effectMap.keys()],
    creature: [...creatureMap.keys()],
  });

  const completeExtractionPass = async (messages, chunkIndex, label, maxTokens = EXTRACTION_MAX_OUTPUT_TOKENS) => {
    const cacheKey = `${extractionCacheKey(textCfg, messages)}:${maxTokens}`;
    const cached = extractionResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < EXTRACTION_CACHE_TTL_MS) {
      return { data: cloneExtractionData(cached.data), truncated: false };
    }
    let content;
    try {
      content = await chatComplete(textCfg, messages, {
        temperature: 0.2,
        maxTokens,
        signal,
        timeoutMs: EXTRACTION_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (error?.truncated) {
        // 先把截断交给上层恢复器处理；只有无法继续拆分时才提示用户。
        let partialData = null;
        if (typeof error.partial === 'string' && error.partial.trim()) {
          try {
            const parsed = parseJsonLoose(error.partial);
            if (extractionDataHasItems(parsed)) partialData = parsed;
          } catch {
            // 不完整 JSON 无法解析时，继续走分块重试。
          }
        }
        return { data: partialData, truncated: true, error };
      }
      throw error;
    }
    const data = parseJsonLoose(content);
    extractionResponseCache.set(cacheKey, { createdAt: Date.now(), data: cloneExtractionData(data) });
    while (extractionResponseCache.size > EXTRACTION_CACHE_MAX) {
      extractionResponseCache.delete(extractionResponseCache.keys().next().value);
    }
    return { data, truncated: false };
  };

  const extractionCategories = selectedCategories || EXTRACTION_CATEGORIES;
  const otherCategories = extractionCategories.filter((category) => category !== 'scene');

  const runResilientExtraction = async ({
    sourceText,
    chunkIndex,
    chunkTotal,
    categories,
    roster,
    label,
    sceneOnly = false,
    depth = 0,
  }) => {
    if (signal?.aborted) {
      const error = new Error('request cancelled');
      error.name = 'AbortError';
      throw error;
    }
    const messages = sceneOnly
      ? [
          { role: 'system', content: SCENE_EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: buildSceneExtractionUserPrompt(sourceText, chunkIndex, chunkTotal, roster) },
        ]
      : [
          { role: 'system', content: buildExtractionSystemPrompt(promptTemplateConfig, categories, style) },
          { role: 'user', content: buildExtractionUserPrompt(sourceText, chunkIndex, chunkTotal, categories, roster) },
        ];
    const outcome = await completeExtractionPass(messages, chunkIndex, label, sceneOnly ? 12000 : EXTRACTION_MAX_OUTPUT_TOKENS);
    if (!outcome.truncated) return outcome.data;

    // 多类别输出最容易互相挤占预算，先拆类别再重试同一段文本。
    if (!sceneOnly && categories.length > 1 && depth < EXTRACTION_RETRY_MAX_DEPTH) {
      const splitAt = Math.ceil(categories.length / 2);
      const left = await runResilientExtraction({
        sourceText,
        chunkIndex,
        chunkTotal,
        categories: categories.slice(0, splitAt),
        roster,
        label,
        depth: depth + 1,
      });
      const right = await runResilientExtraction({
        sourceText,
        chunkIndex,
        chunkTotal,
        categories: categories.slice(splitAt),
        roster,
        label,
        depth: depth + 1,
      });
      return mergeExtractionData(left, right);
    }

    // 单类别仍然过长时，把正文二分并保留少量重叠，避免丢失跨句上下文。
    if (depth < EXTRACTION_RETRY_MAX_DEPTH) {
      const pieces = splitExtractionText(sourceText);
      if (pieces.length > 1) {
        const results = [];
        for (const piece of pieces) {
          results.push(await runResilientExtraction({
            sourceText: piece,
            chunkIndex,
            chunkTotal,
            categories,
            roster,
            label,
            sceneOnly,
            depth: depth + 1,
          }));
        }
        return mergeExtractionData(...results);
      }
    }

    if (outcome.data) {
      errors.push(`第 ${chunkIndex + 1} 段${label}输出较长被截断，已尽量抢救；如缺失较多可调小分块大小。`);
      return outcome.data;
    }
    throw outcome.error || new Error('模型输出被长度上限截断');
  };

  // 普通全元素提取每个分块只发一次请求，避免场景审计与其他元素请求叠加后
  // 把同一批模型请求数翻倍。只有用户单独提取场景时才使用场景专用提示词。
  const extractChunk = async (i, roster) => {
    const result = { index: i, scenes: null, others: null };
    try {
      if (otherCategories.length) {
        result.others = await runResilientExtraction({
          sourceText: chunks[i],
          chunkIndex: i,
          chunkTotal: chunks.length,
          categories: extractionCategories,
          roster,
          label: '元素提取',
        });
      } else if (shouldExtract('scene')) {
        result.scenes = await runResilientExtraction({
          sourceText: chunks[i],
          chunkIndex: i,
          chunkTotal: chunks.length,
          categories: ['scene'],
          roster,
          label: '场景提取',
          sceneOnly: true,
        });
      }
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      errors.push(`第 ${i + 1} 段提取失败：${error.message}`);
    }
    return result;
  };

  // 合并必须按分块顺序执行，保证结果与串行版本一致（先出现的名字定基准）。
  const mergeChunkResult = (result) => {
    const data = result.others;
    if (shouldExtract('scene')) {
      for (const scene of result.scenes?.scenes || data?.scenes || []) mergeInto(sceneMap, 's', scene, SCENE_FIELDS);
    }
    if (!data) return;
    if (shouldExtract('character')) {
      for (const character of data.characters || []) mergeInto(charMap, 'c', character, CHAR_FIELDS, CHAR_EXTRA_FIELDS);
    }
    if (shouldExtract('group')) {
      for (const group of data.groups || []) mergeInto(groupMap, 'g', group, GROUP_FIELDS);
    }
    if (shouldExtract('prop')) {
      for (const prop of data.props || []) mergeInto(propMap, 'p', prop, PROP_FIELDS);
    }
    if (shouldExtract('effect')) {
      for (const effect of data.effects || []) mergeInto(effectMap, 'e', effect, EFFECT_FIELDS);
    }
    if (shouldExtract('creature')) {
      for (const creature of data.creatures || []) mergeInto(creatureMap, 'cr', creature, CREATURE_FIELDS);
    }
  };

  // 分块之间按批并行。roster（已有名字清单）是跨块依赖：同一批内的块共享批开始时的快照，
  // 所以批越大、后面的块越可能给同一对象另起一个名字。批内并行 + 批间串行是速度与
  // 命名一致性的折中，兜底仍有 mergeInto 的按名归并和别名合并。
  const batchSize = Math.max(1, Math.min(Math.floor(Number(concurrency) || 1), 4));
  let completed = 0;
  for (let start = 0; start < chunks.length; start += batchSize) {
    if (signal?.aborted) { const error = new Error('request cancelled'); error.name = 'AbortError'; throw error; }
    const roster = buildKnownRoster();
    const batchIndexes = [];
    for (let i = start; i < Math.min(start + batchSize, chunks.length); i++) batchIndexes.push(i);
    const currentBatchSize = batchIndexes.length;
    const batchStartedAt = Date.now();
    let batchCompleted = 0;
    const emitBatchProgress = (progressStatus = 'waiting', chunkIndex = batchIndexes[0]) => {
      onProgress({
        phase: 'extract',
        progressStatus,
        chunkIndex,
        chunkTotal: chunks.length,
        // Count chunks as soon as their requests settle. Waiting for the whole
        // batch made the task center look stuck at the first segment while
        // sibling requests were still running.
        completed: Math.min(chunks.length, completed + batchCompleted),
        active: Math.max(0, currentBatchSize - batchCompleted),
        batchStart: start,
        batchSize: currentBatchSize,
        elapsedMs: Math.max(0, Date.now() - batchStartedAt),
      });
    };
    emitBatchProgress('running');
    const heartbeat = setInterval(() => {
      if (!signal?.aborted) emitBatchProgress('waiting');
    }, EXTRACTION_PROGRESS_HEARTBEAT_MS);
    try {
      const batch = batchIndexes.map((index) => extractChunk(index, roster).then((result) => {
        batchCompleted += 1;
        emitBatchProgress('chunk_done', index);
        return result;
      }));
      const results = await Promise.all(batch);
      for (const result of results) mergeChunkResult(result);
      emitBatchProgress('batch_done', Math.min(completed + batchCompleted - 1, chunks.length - 1));
      completed += batchCompleted;
    } finally {
      clearInterval(heartbeat);
    }
  }

  // 阶段C：生成最终出图提示词（用户编辑过的保留原文）
  onProgress({ phase: 'compose', chunkTotal: chunks.length });
  const characters = [...charMap.values()].map((c) => {
    const kept = keptPrompts.get(`character:${c.name}`);
    const aliases = cleanCharacterAliases(collectRawCharacterAliases(c), c.name);
    const distinctOutfits = filterDistinctOutfits(c);
    const distinctVariants = filterDistinctVariants(c);
    const source = {
      ...c,
      aliases,
      outfits: distinctOutfits.map((o) => ({ name: o.name, desc: o.desc || '' })),
      variants: distinctVariants.map((v) => ({
        name: v.name,
        desc: v.desc || '',
        identity: v.identity || '',
        appearance: v.appearance || '',
        body: v.body || '',
        hair: v.hair || '',
        clothing: v.clothing || '',
        makeupAccessories: v.makeupAccessories || '',
        traits: v.traits || '',
      })),
    };
    const outfits = distinctOutfits.map((o) => {
      const outfitKept = keptPrompts.get(`outfit:${c.name}:${o.name}`);
      return {
        name: o.name,
        desc: o.desc || '',
        prompt: outfitKept || buildOutfitPrompt(o, style, stylePromptConfig),
        promptEdited: !!outfitKept,
      };
    });
    const variants = distinctVariants.map((v) => {
      const variantKept = keptPrompts.get(`variant:${c.name}:${v.name}`);
      return {
        name: v.name,
        desc: v.desc || '',
        identity: v.identity || '',
        appearance: v.appearance || '',
        body: v.body || '',
        hair: v.hair || '',
        clothing: v.clothing || '',
        makeupAccessories: v.makeupAccessories || '',
        traits: v.traits || '',
        prompt: variantKept || buildVariantPrompt(c, v, style, promptTemplateConfig, stylePromptConfig),
        promptEdited: !!variantKept,
      };
    });
    const defaultParts = makeCharacterPromptParts(c, style, promptTemplateConfig, stylePromptConfig);
    const hasLayeredParts = keptCharacterParts.has(c.name) || keptCharacterPartsEdited.has(c.name);
    const { parts: promptParts, edited: partsEdited } = mergeEditedPromptParts(
      defaultParts,
      keptCharacterParts.get(c.name),
      keptCharacterPartsEdited.get(c.name)
    );
    const promptFromParts = buildCharacterPromptFromParts(promptParts, c, style, promptTemplateConfig, stylePromptConfig);
    const legacyEditedPrompt = kept && !hasLayeredParts;
    return {
      name: c.name,
      ...(userCreatedElementNames.has(`character:${c.name}`) ? { userCreated: true } : {}),
      aliases,
      source,
      promptParts,
      partsEdited,
      prompt: legacyEditedPrompt ? kept : promptFromParts,
      edited: legacyEditedPrompt || Object.values(partsEdited).some(Boolean),
      outfits,
      variants,
    };
  });
  const propSources = filterSceneProps([...propMap.values()], characters, seededElementNames.get('prop'));
  const preservedGroupNames = new Set(
    [
      ...seededElementNames.get('group'),
      ...[...keptPrompts.keys()].filter((key) => key.startsWith('group:')).map((key) => key.slice(6)),
    ]
  );
  const droppedGroupNames = [];
  const groupSources = filterGroupsWithNamedCharacters(
    [...groupMap.values()],
    characters,
    preservedGroupNames,
    { onDrop: (group) => { if (group?.name) droppedGroupNames.push(group.name); } },
  );
  // 让「群像提取不出来」可见，而不是静默消失
  if (droppedGroupNames.length) {
    errors.push(`已跳过 ${droppedGroupNames.length} 个由具名人物组成的群像（应由分镜引用单人素材实现）：${droppedGroupNames.join('、')}`);
  }
  const groups = groupSources.map((g) => {
    const kept = keptPrompts.get(`group:${g.name}`);
    const source = {
      ...g,
      members: Array.isArray(g.members) ? g.members.map((member) => ({
        label: member?.label || '',
        knownName: member?.knownName || '',
        appearance: member?.appearance || '',
        hair: member?.hair || '',
        body: member?.body || '',
        clothing: member?.clothing || '',
        distinction: member?.distinction || '',
      })) : [],
    };
    return {
      name: g.name,
      ...(userCreatedElementNames.has(`group:${g.name}`) ? { userCreated: true } : {}),
      source,
      prompt: kept || buildGroupPrompt(source, style, stylePromptConfig),
      edited: !!kept,
    };
  });
  const scenes = [...sceneMap.values()].map((s) => {
    const kept = keptPrompts.get(`scene:${s.name}`);
    const areas = normalizeSceneAreas(s.areas).map((area) => {
      const areaKept = keptPrompts.get(`sceneArea:${s.name}:${area.name}`);
      return {
        name: area.name,
        desc: area.desc || '',
        prompt: areaKept || buildSceneAreaPrompt(s, area, style, stylePromptConfig),
        promptEdited: !!areaKept,
      };
    });
    return {
      name: s.name,
      ...(userCreatedElementNames.has(`scene:${s.name}`) ? { userCreated: true } : {}),
      source: { ...s, areas: normalizeSceneAreas(s.areas) },
      prompt: kept || buildScenePrompt(s, style, stylePromptConfig),
      edited: !!kept,
      areas,
    };
  });
  const props = propSources.map((p) => {
    const kept = keptPrompts.get(`prop:${p.name}`);
    return {
      name: p.name,
      ...(userCreatedElementNames.has(`prop:${p.name}`) ? { userCreated: true } : {}),
      source: p,
      prompt: kept || buildPropPrompt(p, style, stylePromptConfig),
      edited: !!kept,
    };
  });
  const effects = [...effectMap.values()].map((e) => {
    const kept = keptPrompts.get(`effect:${e.name}`);
    return {
      name: e.name,
      ...(userCreatedElementNames.has(`effect:${e.name}`) ? { userCreated: true } : {}),
      source: e,
      prompt: kept || buildEffectPrompt(e, style, stylePromptConfig),
      edited: !!kept,
    };
  });
  const creatures = [...creatureMap.values()].map((c) => {
    const kept = keptPrompts.get(`creature:${c.name}`);
    return {
      name: c.name,
      ...(userCreatedElementNames.has(`creature:${c.name}`) ? { userCreated: true } : {}),
      source: c,
      prompt: kept || buildCreaturePrompt(c, style, stylePromptConfig),
      edited: !!kept,
    };
  });

  const elements = { character: characters, group: groups, scene: scenes, prop: props, effect: effects, creature: creatures };
  if (selectedCategories) {
    for (const category of EXTRACTION_CATEGORIES) {
      if (selectedCategories.includes(category)) continue;
      elements[category] = Array.isArray(seed?.[category]) ? seed[category] : [];
    }
  }

  return {
    chunkTotal: chunks.length,
    elements,
    errors,
  };
}
