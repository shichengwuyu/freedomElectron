import fs from 'fs';
import { loadConfig } from '../config.js';
import { downloadImageUrlAsB64 } from '../apiClient.js';
import { generateConfiguredImage, imageProviderConfigError, normalizeImageProvider } from '../imageProviders.js';
import { loadProject, saveProject, saveImage, imageDiskPath, MAIN_CATEGORIES } from '../storage.js';
import {
  buildOutfitPrompt,
  buildVariantPrompt,
  buildSceneAreaPrompt,
  buildCharacterPromptFromParts,
  applyVariantIdentityReference,
  applyCharacterImageMode,
  normalizeCharacterImageMode,
  normalizeImageStyle,
} from '../prompts.js';
import {
  getPendingImage,
  removePendingImage,
  recordPendingGeneratedImage,
  renamePendingImage,
  setPendingImage,
} from '../pendingImages.js';
import { getJob, setJob } from '../jobs.js';
import { sendJson } from '../http.js';

const DEFAULT_IMAGE_BATCH_CONCURRENCY = 10;

// ===================== Helper Functions =====================

function imageState(projectId, category, imageName) {
  const hasImage = fs.existsSync(imageDiskPath(projectId, category, imageName));
  const pending = hasImage ? null : getPendingImage(projectId, category, imageName);
  return {
    hasImage,
    hasPendingImage: !hasImage && !!pending,
  };
}

function localImageUrl(projectId, category, imageName) {
  return `/img/${encodeURIComponent(projectId)}/${category}/${encodeURIComponent(imageName)}.png?t=${Date.now()}`;
}

function resolveImageStatusTarget(body = {}) {
  const projectId = String(body.projectId || '').trim();
  if (!projectId) throw new Error('缺少 projectId');
  const proj = loadProject(projectId);
  if (!proj) {
    const err = new Error('项目不存在');
    err.status = 404;
    throw err;
  }
  const kind = String(body.kind || 'main');
  if (kind === 'variant') {
    const ch = proj.elements?.character?.[Number(body.charIndex)];
    const variant = ch?.variants?.[Number(body.variantIndex)];
    if (!variant) {
      const err = new Error('形态不存在');
      err.status = 404;
      throw err;
    }
    return { projectId, category: 'character', imageName: variantImageName(ch.name, variant.name), kind, proj };
  }
  if (kind === 'outfit') {
    const ch = proj.elements?.character?.[Number(body.charIndex)];
    const outfit = ch?.outfits?.[Number(body.outfitIndex)];
    if (!outfit) {
      const err = new Error('服装不存在');
      err.status = 404;
      throw err;
    }
    return { projectId, category: 'character', imageName: `${ch.name}_${outfit.name}`, kind, proj };
  }
  if (kind === 'sceneArea') {
    const scene = proj.elements?.scene?.[Number(body.sceneIndex)];
    const area = scene?.areas?.[Number(body.areaIndex)];
    if (!area) {
      const err = new Error('子区域不存在');
      err.status = 404;
      throw err;
    }
    return { projectId, category: 'scene', imageName: sceneAreaImageName(scene.name, area.name), kind, proj };
  }
  const category = String(body.category || '').trim();
  const index = Number(body.index);
  if (!MAIN_CATEGORIES.includes(category)) throw new Error('分类无效');
  const el = proj.elements?.[category]?.[index];
  if (!el) {
    const err = new Error('元素不存在');
    err.status = 404;
    throw err;
  }
  return { projectId, category, imageName: el.name, kind: 'main', proj };
}

async function syncPendingImage(projectId, category, imageName) {
  if (fs.existsSync(imageDiskPath(projectId, category, imageName))) {
    removePendingImage(projectId, category, imageName);
    return { ok: true, alreadyLocal: true, ...imageState(projectId, category, imageName), imageUrl: localImageUrl(projectId, category, imageName) };
  }
  const pending = getPendingImage(projectId, category, imageName);
  if (!pending?.sourceUrl) {
    return { ok: false, hasImage: false, hasPendingImage: false, error: '本地没有图片，也没有可同步的中转站记录' };
  }
  try {
    const { b64 } = await downloadImageUrlAsB64(pending.sourceUrl, { context: '待同步图片' });
    await saveImage(projectId, category, imageName, b64);
    removePendingImage(projectId, category, imageName);
    return { ok: true, hasImage: true, hasPendingImage: false, imageUrl: localImageUrl(projectId, category, imageName) };
  } catch (e) {
    setPendingImage({ ...pending, error: e.message, lastAttemptAt: new Date().toISOString() });
    return { ok: false, hasImage: false, hasPendingImage: true, error: e.message };
  }
}

function cleanImageB64(value) {
  const raw = String(value || '').trim();
  const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
  if (!b64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return '';
  return b64.replace(/\s+/g, '');
}

function normalizeImageRatio(ratio) {
  const value = String(ratio || '').trim();
  if (['16:9', '4:3', '3:4', '9:16'].includes(value)) return value;
  const m = value.match(/^(\d{1,2}(?:\.\d+)?):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > 30 || h > 30) return undefined;
  return `${w}:${h}`;
}

function projectImageStyle(project, cfg) {
  return normalizeImageStyle(project?.imageStyle || cfg?.style || 'realistic');
}

function imageUsageContext(cfg, projectId, operation, extra = {}) {
  return {
    projectId: String(projectId || ''),
    operation: String(operation || 'element-image'),
    currency: String(cfg?.costTracking?.currency || 'CNY'),
    ...extra,
  };
}

function outfitPromptForGeneration(outfit, style, stylePromptConfig = null) {
  if (outfit?.promptEdited && typeof outfit.prompt === 'string' && outfit.prompt.trim()) {
    return outfit.prompt;
  }
  if (!outfit?.desc && typeof outfit?.prompt === 'string' && outfit.prompt.trim()) {
    return outfit.prompt;
  }
  return buildOutfitPrompt(outfit || {}, style, stylePromptConfig);
}

function variantPromptForGeneration(character, variant, style, promptTemplateConfig, stylePromptConfig = null) {
  if (variant?.promptEdited && typeof variant.prompt === 'string' && variant.prompt.trim()) {
    return variant.prompt;
  }
  if (!variant?.appearance && !variant?.body && !variant?.hair && !variant?.clothing && !variant?.makeupAccessories && typeof variant?.prompt === 'string' && variant.prompt.trim()) {
    return variant.prompt;
  }
  return buildVariantPrompt(character?.source || character || {}, variant || {}, style, promptTemplateConfig, stylePromptConfig);
}

function variantImageName(characterName, variantName) {
  return `${characterName}_形态_${variantName}`;
}

function variantClothingReferenceImageName(characterName, variantName, referenceType = 'outfit') {
  return `${variantImageName(characterName, variantName)}_${referenceType === 'pattern' ? 'Logo参考' : '服装参考'}`;
}

function variantClothingReferenceImageNames(character, variant) {
  const characterName = character?.name || '';
  const variantName = variant?.name || '';
  const legacyName = `${variantImageName(characterName, variantName)}_服装参考`;
  const legacyRole = variant?.clothingReferenceImageRole === 'pattern' ? 'pattern' : 'outfit';
  return {
    outfit: variant?.clothingReferenceOutfitImageName
      || (legacyRole === 'outfit' ? variant?.clothingReferenceImageName : '')
      || variantClothingReferenceImageName(characterName, variantName, 'outfit'),
    pattern: variant?.clothingReferencePatternImageName
      || variant?.logoReferenceImageName
      || (legacyRole === 'pattern' ? variant?.clothingReferenceImageName : '')
      || variantClothingReferenceImageName(characterName, variantName, 'pattern'),
    legacy: legacyName,
  };
}

function findCharacterOutfit(character, name) {
  const normalized = String(name || '').trim().toLocaleLowerCase();
  if (!normalized) return null;
  return (Array.isArray(character?.outfits) ? character.outfits : []).find(
    (outfit) => String(outfit?.name || '').trim().toLocaleLowerCase() === normalized,
  ) || null;
}

function applyVariantClothingReferencePrompt(prompt, character, variant, references = {}) {
  const outfit = findCharacterOutfit(character, variant?.clothingReferenceOutfitName);
  const instructions = [];
  if (outfit) instructions.push(`服装参考：请让人物穿着“${outfit.name}”，并严格参考该服装的版型、材质、配色与配饰；只替换服装，不改变人物身份、脸部、发型和身体比例。`);
  if (references.outfit) instructions.push('上传的服饰参考图用于整套服装：优先保持其中的版型、材质、配色、纹样与配饰，只替换人物服装，不复制图片背景或人物。');
  if (references.pattern) instructions.push('上传的衣服图案 / Logo 参考图只用于衣服表面：准确应用其中的图案、Logo或印花，不要复制图片背景、人物或版型。');
  if (references.outfit) {
    instructions.push('【上传服饰参考优先级最高】只要存在上传的服饰参考图，最终服装必须以该图为唯一版型、材质、颜色和配饰来源；禁止沿用形态说明或其他服装参考中与上传图冲突的裙装、外套、哥特风、黑红配色或其他设计。上传图是什么款式和颜色，结果就必须保持什么款式和颜色，不能改成其他服装。');
  }
  if (references.pattern) {
    instructions.push('【Logo必须同时出现在左右构图】Logo参考图中的主体图案必须清晰、完整、可辨识地应用在同一件服饰正面；左侧近景必须保留足够的胸口/上衣区域并显示Logo，右侧全身也必须显示同一Logo，左右两块的Logo位置、比例、颜色和轮廓保持一致。不要让Logo只出现在右侧，不要把Logo变成独立物件或背景装饰。将Logo作为一块完整图形印花处理；不要凭空添加中文字符、标签、水印或乱码，Logo中难以准确还原的文字宁可省略，也不要生成错误文字。');
  }
  let basePrompt = String(prompt || '').trim();
  if (references.outfit) {
    const replacement = '服装造型：\n以“上传服饰参考图（整套服装）”为唯一服装来源，严格还原上传图中的版型、材质、颜色、纹样、配饰和覆盖范围。';
    const replaced = basePrompt.replace(
      /服装造型：\n[\s\S]*?(?=\n\n妆容配饰：|\n\n整体风格：|\n\n图片结构：|$)/,
      replacement,
    );
    basePrompt = replaced === basePrompt ? `${basePrompt}\n\n${replacement}` : replaced;
  }
  if (references.pattern) {
    const composition = '图片结构：\n横版人物双构图，同一人物、同一套服饰、同一个Logo。左侧必须是胸像近景而不是只到锁骨的脸部特写，至少清楚露出双肩、胸口和上衣正面，完整显示Logo；右侧必须是正面全身站立图，也完整显示同一Logo。左右两块使用完全相同的服饰版型、Logo位置、比例、颜色和轮廓，不得一边有Logo、一边没有Logo。';
    const replaced = basePrompt.replace(
      /图片结构：\n[\s\S]*?(?=\n\n背景与光线：|\n\n绝对注意事项：|$)/,
      composition,
    );
    basePrompt = replaced === basePrompt ? `${basePrompt}\n\n${composition}` : replaced;
  }
  return [basePrompt, ...instructions].filter(Boolean).join('\n');
}

function variantReferenceLabels({ hasOutfit, hasPattern, selectedOutfit } = {}) {
  const labels = ['人物主图（身份参考）'];
  if (selectedOutfit) labels.push(`${selectedOutfit.name}服装参考`);
  if (hasOutfit) labels.push('上传服饰参考图（整套服装）');
  if (hasPattern) labels.push('上传Logo参考图（衣服印花）');
  return labels;
}

function sceneAreaImageName(sceneName, areaName) {
  return `${sceneName}_${areaName}`;
}

function sceneAreaPromptForGeneration(scene, area, style, stylePromptConfig = null) {
  if (area?.promptEdited && typeof area.prompt === 'string' && area.prompt.trim()) {
    return area.prompt;
  }
  if (!area?.desc && typeof area?.prompt === 'string' && area.prompt.trim()) {
    return area.prompt;
  }
  return buildSceneAreaPrompt(scene?.source || scene || {}, area || {}, style, stylePromptConfig);
}

function characterReferenceImageName(characterName) {
  return `${characterName}_参考图`;
}

function globalReferenceImageName() {
  return '__全局风格参考图';
}

async function generateElementImage(cfg, projectId, category, el, ratio, options = {}) {
  const prompt = category === 'character' ? applyCharacterImageMode(el.prompt, options.imageMode) : el.prompt;
  const usageContext = imageUsageContext(cfg, projectId, options.operation || 'element-image', {
    episodeId: options.episodeId ?? '',
  });
  if (category === 'character') {
    const proj = loadProject(projectId);
    const mode = normalizeReferenceMode(el?.referenceMode, el?.useReferenceImage ? 'character' : 'none');
    let refName = '';
    if (mode === 'character') refName = el.referenceImageName || characterReferenceImageName(el.name);
    if (mode === 'global' && proj?.useGlobalReferenceImage) refName = proj.globalReferenceImageName || globalReferenceImageName();
    if (refName) {
      const refFile = imageDiskPath(projectId, 'character', refName);
      if (fs.existsSync(refFile)) {
        const refB64 = await fs.promises.readFile(refFile, { encoding: 'base64' });
        return generateConfiguredImage(cfg, prompt, { ratio, referenceImages: [refB64], usageContext });
      }
    }
  }
  return generateConfiguredImage(cfg, prompt, { ratio, usageContext });
}

async function runLimited(tasks, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      await worker(task);
    }
  });
  await Promise.all(workers);
}

function batchImageResult(task, ok, extra = {}) {
  const base = {
    ok,
    kind: task.kind,
    cat: task.cat || 'character',
    name: task.name || task.el?.name || task.variant?.name || task.outfit?.name || '',
    imageName: task.imageName || task.el?.name || '',
  };
  if (typeof task.index === 'number') base.index = task.index;
  if (typeof task.charIndex === 'number') base.charIndex = task.charIndex;
  if (typeof task.variantIndex === 'number') base.variantIndex = task.variantIndex;
  if (typeof task.outfitIndex === 'number') base.outfitIndex = task.outfitIndex;
  return { ...base, ...extra, updatedAt: Date.now() };
}

function imageBatchConcurrency(cfg) {
  const n = Number(cfg?.image?.concurrency);
  const provider = normalizeImageProvider(cfg?.image?.provider);
  if (provider === 'updream') {
    const updreamLimit = Number(cfg?.video?.updreamConcurrency);
    return Math.max(1, Math.floor(Number.isFinite(updreamLimit) ? updreamLimit : (Number.isFinite(n) ? n : 2)));
  }
  const max = provider === 'neowow' ? 15 : (['libtv-cli', 'dreamina-cli'].includes(provider) ? 10 : 50);
  if (!Number.isFinite(n)) return Math.min(DEFAULT_IMAGE_BATCH_CONCURRENCY, max);
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function normalizeReferenceMode(value, fallback = 'none') {
  return ['global', 'character', 'none'].includes(value) ? value : fallback;
}

let singleImageJobSeq = 0;

// 单张出图的异步任务壳：立即返回 jobId，前端轮询 /api/image/batch/status 拿结果。
// 出图要等模型几十秒到几分钟；若同步等待，会一直占用浏览器同源连接（HTTP/1.1 上限约 6 个），
// 并发点几张「生成」就把连接占满，画廊里已有图片的 /img/ 请求全部排队，表现为切分类后图片全部加载不出来。
function startSingleImageJob({ projectId, title, provider }, run) {
  singleImageJobSeq = (singleImageJobSeq + 1) % 1000;
  const jobId = `imgjob_${Date.now()}_${singleImageJobSeq}`;
  setJob(jobId, { status: 'running', phase: 'image', title, projectId, provider: normalizeImageProvider(provider), done: 0, total: 1, failed: [], results: [] });
  (async () => {
    let result;
    try {
      result = await run();
    } catch (e) {
      result = { ok: false, error: e.message };
    }
    setJob(jobId, {
      status: 'done',
      done: 1,
      total: 1,
      failed: result?.ok ? [] : [result?.error || '生成失败'],
      results: [],
      result,
    });
  })();
  return { ok: true, async: true, jobId, total: 1 };
}

// ===================== Route Handlers =====================

export async function handleImageRoutes(ctxOrReq, legacyRes, legacyPathname, legacyMethod, legacyReadBody) {
  const ctx = ctxOrReq && typeof ctxOrReq === 'object' && 'req' in ctxOrReq
    ? ctxOrReq
    : {
        req: ctxOrReq,
        res: legacyRes,
        p: legacyPathname,
        method: legacyMethod,
        readBody: legacyReadBody,
      };
  const { req, res, p, method, readBody } = ctx;

  // ---- 出图：单张 ----
  if (p === '/api/image/generate' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, category, index } = body;
    const cfg = loadConfig();
    const imageConfigError = imageProviderConfigError(cfg);
    if (imageConfigError) return sendJson(res, 400, { error: imageConfigError });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const el = proj.elements?.[category]?.[index];
    if (!el) return sendJson(res, 404, { error: '元素不存在' });
    const ratio = normalizeImageRatio(body.ratio);
    const imageMode = normalizeCharacterImageMode(body.imageMode || proj.characterImageMode);
    return sendJson(res, 200, startSingleImageJob({ projectId, title: `生成图片 ${el.name}`, provider: cfg.image?.provider }, async () => {
      try {
        const { b64 } = await generateElementImage(cfg, projectId, category, el, ratio, { imageMode });
        const { relPath } = await saveImage(projectId, category, el.name, b64);
        removePendingImage(projectId, category, el.name);
        return {
          ok: true,
          hasImage: true,
          hasPendingImage: false,
          imageUrl: localImageUrl(projectId, category, el.name),
          relPath,
        };
      } catch (e) {
        const pending = recordPendingGeneratedImage(projectId, category, el.name, e, { kind: 'main' });
        return { ok: false, error: e.message, hasPendingImage: !!pending, pendingSync: !!pending };
      }
    }));
  }

  if (p === '/api/image/status' && method === 'POST') {
    const body = await readBody(req);
    try {
      const target = resolveImageStatusTarget(body);
      if (body.sync === true) {
        const synced = await syncPendingImage(target.projectId, target.category, target.imageName);
        return sendJson(res, 200, { ...synced, kind: target.kind, category: target.category, imageName: target.imageName });
      }
      const st = imageState(target.projectId, target.category, target.imageName);
      return sendJson(res, 200, {
        ok: true,
        ...st,
        kind: target.kind,
        category: target.category,
        imageName: target.imageName,
        imageUrl: st.hasImage ? localImageUrl(target.projectId, target.category, target.imageName) : '',
      });
    } catch (e) {
      return sendJson(res, e.status || 200, { ok: false, error: e.message });
    }
  }

  // ---- 出图：人物换装套装 ----
  if (p === '/api/image/outfit' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, outfitIndex } = body;
    const cfg = loadConfig();
    const imageConfigError = imageProviderConfigError(cfg);
    if (imageConfigError) return sendJson(res, 400, { error: imageConfigError });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const outfit = ch?.outfits?.[outfitIndex];
    if (!outfit) return sendJson(res, 404, { error: '服装不存在' });
    // 换装需要以人物主图作参考图，保持同一张脸和身材；因此必须先生成主人物图
    const mainFile = imageDiskPath(projectId, 'character', ch.name);
    if (!fs.existsSync(mainFile)) {
      return sendJson(res, 200, { ok: false, needMain: true, error: '请先生成该人物的主图，换装会以主图为参考保持同一个人' });
    }
    const imgName = `${ch.name}_${outfit.name}`;
    const ratio = normalizeImageRatio(body.ratio);
    const style = projectImageStyle(proj, cfg);
    return sendJson(res, 200, startSingleImageJob({ projectId, title: `生成换装图 ${imgName}`, provider: cfg.image?.provider }, async () => {
      try {
        const prompt = outfitPromptForGeneration(outfit, style, cfg.stylePrompts);
        const refB64 = await fs.promises.readFile(mainFile, { encoding: 'base64' });
        const { b64 } = await generateConfiguredImage(cfg, prompt, {
          ratio,
          referenceImages: [refB64],
          usageContext: imageUsageContext(cfg, projectId, 'outfit-image'),
        });
        await saveImage(projectId, 'character', imgName, b64);
        removePendingImage(projectId, 'character', imgName);
        return {
          ok: true,
          hasImage: true,
          hasPendingImage: false,
          imageUrl: localImageUrl(projectId, 'character', imgName),
        };
      } catch (e) {
        const pending = recordPendingGeneratedImage(projectId, 'character', imgName, e, { kind: 'outfit', charIndex, outfitIndex });
        return { ok: false, error: e.message, hasPendingImage: !!pending, pendingSync: !!pending };
      }
    }));
  }

  // ---- 出图：场景子区域（以主场景图作参考图，保持同一处建筑）----
  if (p === '/api/image/scene-area' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, sceneIndex, areaIndex } = body;
    const cfg = loadConfig();
    const imageConfigError = imageProviderConfigError(cfg);
    if (imageConfigError) return sendJson(res, 400, { error: imageConfigError });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const scene = proj.elements?.scene?.[sceneIndex];
    const area = scene?.areas?.[areaIndex];
    if (!area) return sendJson(res, 404, { error: '子区域不存在' });
    // 子区域以主场景图作参考图，保持同一处建筑的风格与材质；因此必须先生成主场景图
    const mainFile = imageDiskPath(projectId, 'scene', scene.name);
    if (!fs.existsSync(mainFile)) {
      return sendJson(res, 200, { ok: false, needMain: true, error: '请先生成该场景的主图，子区域会以主图为参考保持同一处建筑' });
    }
    const imgName = sceneAreaImageName(scene.name, area.name);
    const ratio = normalizeImageRatio(body.ratio);
    const style = projectImageStyle(proj, cfg);
    return sendJson(res, 200, startSingleImageJob({ projectId, title: `生成子区域图 ${imgName}`, provider: cfg.image?.provider }, async () => {
      try {
        const prompt = sceneAreaPromptForGeneration(scene, area, style, cfg.stylePrompts);
        const refB64 = await fs.promises.readFile(mainFile, { encoding: 'base64' });
        const { b64 } = await generateConfiguredImage(cfg, prompt, {
          ratio,
          referenceImages: [refB64],
          usageContext: imageUsageContext(cfg, projectId, 'scene-area-image'),
        });
        await saveImage(projectId, 'scene', imgName, b64);
        removePendingImage(projectId, 'scene', imgName);
        return {
          ok: true,
          hasImage: true,
          hasPendingImage: false,
          imageUrl: localImageUrl(projectId, 'scene', imgName),
        };
      } catch (e) {
        const pending = recordPendingGeneratedImage(projectId, 'scene', imgName, e, { kind: 'sceneArea', sceneIndex, areaIndex });
        return { ok: false, error: e.message, hasPendingImage: !!pending, pendingSync: !!pending };
      }
    }));
  }

  // ---- 出图：人物年龄/形态版本 ----
  if (p === '/api/image/variant' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, variantIndex } = body;
    const cfg = loadConfig();
    const imageConfigError = imageProviderConfigError(cfg);
    if (imageConfigError) return sendJson(res, 400, { error: imageConfigError });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const variant = ch?.variants?.[variantIndex];
    if (!variant) return sendJson(res, 404, { error: '形态不存在' });
    const mainFile = imageDiskPath(projectId, 'character', ch.name);
    if (!fs.existsSync(mainFile)) {
      return sendJson(res, 200, { ok: false, needMain: true, error: '请先生成该人物的主图，形态图会以主图为身份参考保持同一个人' });
    }
    const imgName = variantImageName(ch.name, variant.name);
    const ratio = normalizeImageRatio(body.ratio);
    const style = projectImageStyle(proj, cfg);
    const imageMode = normalizeCharacterImageMode(body.imageMode || proj.characterImageMode);
    return sendJson(res, 200, startSingleImageJob({ projectId, title: `生成形态图 ${imgName}`, provider: cfg.image?.provider }, async () => {
      try {
        const clothingReferenceNames = variantClothingReferenceImageNames(ch, variant);
        const clothingReferenceFiles = {
          outfit: imageDiskPath(projectId, 'character', clothingReferenceNames.outfit),
          pattern: imageDiskPath(projectId, 'character', clothingReferenceNames.pattern),
        };
        const clothingReferences = {
          outfit: fs.existsSync(clothingReferenceFiles.outfit),
          pattern: fs.existsSync(clothingReferenceFiles.pattern),
        };
        const prompt = applyVariantClothingReferencePrompt(
          applyCharacterImageMode(
            applyVariantIdentityReference(
              variantPromptForGeneration(ch, variant, style, cfg.promptTemplate, cfg.stylePrompts),
              ch.name,
              variant.name,
            ),
            imageMode,
          ),
          ch,
          variant,
          clothingReferences,
        );
        const refB64 = await fs.promises.readFile(mainFile, { encoding: 'base64' });
        const referenceImages = [refB64];
        const outfit = findCharacterOutfit(ch, variant.clothingReferenceOutfitName);
        let selectedOutfitReference = null;
        const referenceLabels = variantReferenceLabels({
          hasOutfit: clothingReferences.outfit,
          hasPattern: clothingReferences.pattern,
          selectedOutfit: null,
        });
        if (outfit) {
          const outfitFile = imageDiskPath(projectId, 'character', `${ch.name}_${outfit.name}`);
          if (fs.existsSync(outfitFile)) {
            referenceImages.push(await fs.promises.readFile(outfitFile, { encoding: 'base64' }));
            selectedOutfitReference = outfit;
          }
        }
        if (selectedOutfitReference) referenceLabels.splice(1, 0, `${selectedOutfitReference.name}服装参考`);
        if (clothingReferences.outfit) referenceImages.push(await fs.promises.readFile(clothingReferenceFiles.outfit, { encoding: 'base64' }));
        if (clothingReferences.pattern) referenceImages.push(await fs.promises.readFile(clothingReferenceFiles.pattern, { encoding: 'base64' }));
        const { b64 } = await generateConfiguredImage(cfg, prompt, {
          ratio,
          referenceImages,
          referenceLabels,
          usageContext: imageUsageContext(cfg, projectId, 'variant-image'),
        });
        await saveImage(projectId, 'character', imgName, b64);
        removePendingImage(projectId, 'character', imgName);
        return {
          ok: true,
          hasImage: true,
          hasPendingImage: false,
          imageUrl: localImageUrl(projectId, 'character', imgName),
        };
      } catch (e) {
        const pending = recordPendingGeneratedImage(projectId, 'character', imgName, e, { kind: 'variant', charIndex, variantIndex });
        return { ok: false, error: e.message, hasPendingImage: !!pending, pendingSync: !!pending };
      }
    }));
  }

  // ---- 上传图片：主图 ----
  if (p === '/api/image/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, category, index } = body;
    const imageB64 = cleanImageB64(body.imageB64);
    if (!imageB64) return sendJson(res, 400, { error: '图片数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const el = proj.elements?.[category]?.[index];
    if (!el) return sendJson(res, 404, { error: '元素不存在' });
    const { relPath } = await saveImage(projectId, category, el.name, imageB64);
    removePendingImage(projectId, category, el.name);
    return sendJson(res, 200, {
      ok: true,
      hasImage: true,
      hasPendingImage: false,
      imageUrl: localImageUrl(projectId, category, el.name),
      relPath,
    });
  }

  // ---- 上传图片：场景子区域 ----
  if (p === '/api/image/scene-area/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, sceneIndex, areaIndex } = body;
    const imageB64 = cleanImageB64(body.imageB64);
    if (!imageB64) return sendJson(res, 400, { error: '图片数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const scene = proj.elements?.scene?.[sceneIndex];
    const area = scene?.areas?.[areaIndex];
    if (!area) return sendJson(res, 404, { error: '子区域不存在' });
    const imgName = sceneAreaImageName(scene.name, area.name);
    await saveImage(projectId, 'scene', imgName, imageB64);
    removePendingImage(projectId, 'scene', imgName);
    return sendJson(res, 200, {
      ok: true,
      hasImage: true,
      hasPendingImage: false,
      imageUrl: localImageUrl(projectId, 'scene', imgName),
    });
  }

  // ---- 上传图片：人物形态 ----
  if (p === '/api/image/variant/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, variantIndex } = body;
    const imageB64 = cleanImageB64(body.imageB64);
    if (!imageB64) return sendJson(res, 400, { error: '图片数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const variant = ch?.variants?.[variantIndex];
    if (!variant) return sendJson(res, 404, { error: '形态不存在' });
    const imgName = variantImageName(ch.name, variant.name);
    await saveImage(projectId, 'character', imgName, imageB64);
    removePendingImage(projectId, 'character', imgName);
    return sendJson(res, 200, {
      ok: true,
      hasImage: true,
      hasPendingImage: false,
      imageUrl: localImageUrl(projectId, 'character', imgName),
    });
  }

  // ---- 上传图片：人物形态的服装参考 ----
  if (p === '/api/image/variant-clothing-reference/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, variantIndex } = body;
    const referenceType = body.referenceType === 'pattern' ? 'pattern' : 'outfit';
    const legacyPatternReference = body.legacyPatternReference === true;
    const imageB64 = cleanImageB64(body.imageB64);
    if (!imageB64) return sendJson(res, 400, { error: '图片数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const variant = ch?.variants?.[variantIndex];
    if (!variant) return sendJson(res, 404, { error: '形态不存在' });
    let legacyPatternNameToRemove = '';
    if (referenceType === 'pattern' && (legacyPatternReference || variant.clothingReferenceImageRole === 'pattern')
      && !variant.clothingReferencePatternImageName && !variant.logoReferenceImageName) {
      legacyPatternNameToRemove = variant.clothingReferenceImageName || variantClothingReferenceImageName(ch.name, variant.name, 'outfit');
    }
    if (referenceType === 'outfit' && (legacyPatternReference || variant.clothingReferenceImageRole === 'pattern')
      && !variant.clothingReferencePatternImageName && !variant.logoReferenceImageName) {
      const legacyName = variant.clothingReferenceImageName || variantClothingReferenceImageName(ch.name, variant.name, 'outfit');
      const legacyFile = imageDiskPath(projectId, 'character', legacyName);
      const migratedPatternName = variantClothingReferenceImageName(ch.name, variant.name, 'pattern');
      const migratedPatternFile = imageDiskPath(projectId, 'character', migratedPatternName);
      if (fs.existsSync(legacyFile) && !fs.existsSync(migratedPatternFile)) {
        await fs.promises.rename(legacyFile, migratedPatternFile).catch(() => {});
      }
      variant.clothingReferencePatternImageName = migratedPatternName;
      variant.logoReferenceImageName = migratedPatternName;
    }
    const imageName = variantClothingReferenceImageName(ch.name, variant.name, referenceType);
    await saveImage(projectId, 'character', imageName, imageB64);
    removePendingImage(projectId, 'character', imageName);
    if (legacyPatternNameToRemove && legacyPatternNameToRemove !== imageName) {
      await fs.promises.unlink(imageDiskPath(projectId, 'character', legacyPatternNameToRemove)).catch(() => {});
      removePendingImage(projectId, 'character', legacyPatternNameToRemove);
    }
    if (referenceType === 'pattern') {
      variant.clothingReferencePatternImageName = imageName;
      variant.logoReferenceImageName = imageName;
    } else {
      variant.clothingReferenceOutfitImageName = imageName;
      variant.clothingReferenceImageName = imageName;
      variant.clothingReferenceImageRole = 'outfit';
    }
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return sendJson(res, 200, {
      ok: true,
      referenceType,
      clothingReferenceImageName: imageName,
      clothingReferencePatternImageName: variant.clothingReferencePatternImageName || '',
      clothingReferenceOutfitImageName: variant.clothingReferenceOutfitImageName || variant.clothingReferenceImageName || '',
      hasClothingReferenceImage: fs.existsSync(imageDiskPath(projectId, 'character', variantClothingReferenceImageNames(ch, variant).outfit)),
      hasLogoReferenceImage: fs.existsSync(imageDiskPath(projectId, 'character', variantClothingReferenceImageNames(ch, variant).pattern)),
      clothingReferenceImageUrl: localImageUrl(projectId, 'character', imageName),
    });
  }

  // ---- 删除图片：人物形态的服装参考 ----
  if (p === '/api/image/variant-clothing-reference/delete' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, variantIndex } = body;
    const referenceType = body.referenceType === 'pattern' ? 'pattern' : 'outfit';
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const variant = ch?.variants?.[variantIndex];
    if (!variant) return sendJson(res, 404, { error: '形态不存在' });
    const names = variantClothingReferenceImageNames(ch, variant);
    const imageName = referenceType === 'pattern' ? names.pattern : names.outfit;
    const imageFile = imageDiskPath(projectId, 'character', imageName);
    if (fs.existsSync(imageFile)) await fs.promises.unlink(imageFile);
    removePendingImage(projectId, 'character', imageName);
    if (referenceType === 'pattern') {
      delete variant.clothingReferencePatternImageName;
      delete variant.logoReferenceImageName;
    } else {
      delete variant.clothingReferenceOutfitImageName;
      delete variant.clothingReferenceImageName;
    }
    proj.updatedAt = new Date().toISOString();
    saveProject(proj);
    return sendJson(res, 200, {
      ok: true,
      referenceType,
      clothingReferenceImageName: imageName,
      hasClothingReferenceImage: referenceType === 'outfit' ? false : !!fs.existsSync(imageDiskPath(projectId, 'character', names.outfit)),
      hasLogoReferenceImage: referenceType === 'pattern' ? false : !!fs.existsSync(imageDiskPath(projectId, 'character', names.pattern)),
    });
  }

  // ---- 上传图片：人物换装 ----
  if (p === '/api/image/outfit/upload' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, charIndex, outfitIndex } = body;
    const imageB64 = cleanImageB64(body.imageB64);
    if (!imageB64) return sendJson(res, 400, { error: '图片数据无效' });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const ch = proj.elements?.character?.[charIndex];
    const outfit = ch?.outfits?.[outfitIndex];
    if (!outfit) return sendJson(res, 404, { error: '服装不存在' });
    const imgName = `${ch.name}_${outfit.name}`;
    await saveImage(projectId, 'character', imgName, imageB64);
    removePendingImage(projectId, 'character', imgName);
    return sendJson(res, 200, {
      ok: true,
      hasImage: true,
      hasPendingImage: false,
      imageUrl: localImageUrl(projectId, 'character', imgName),
    });
  }

  // ---- 出图：批量（异步 + 进度）----
  if (p === '/api/image/batch' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, category } = body; // category 可为空=全部
    const cfg = loadConfig();
    const ratio = normalizeImageRatio(body.ratio);
    const imageConfigError = imageProviderConfigError(cfg);
    if (imageConfigError) return sendJson(res, 400, { error: imageConfigError });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const style = projectImageStyle(proj, cfg);
    const imageMode = normalizeCharacterImageMode(body.imageMode || proj.characterImageMode);
    const concurrency = imageBatchConcurrency(cfg);

    const cats = category
      ? (MAIN_CATEGORIES.includes(category) ? [category] : null)
      : MAIN_CATEGORIES;
    if (!cats) return sendJson(res, 400, { error: '分类无效' });
    const mainTasks = [];
    const variantTasks = [];
    const outfitTasks = [];
    const sceneAreaTasks = [];
    for (const cat of cats) {
      (proj.elements[cat] || []).forEach((el, index) => {
        if (!body.onlyMissing || !fs.existsSync(imageDiskPath(projectId, cat, el.name))) {
          mainTasks.push({ kind: 'main', cat, index, el, name: el.name, imageName: el.name });
        }
        if (cat === 'character' && Array.isArray(el.variants)) {
          el.variants.forEach((variant, variantIndex) => {
            const imgName = variantImageName(el.name, variant.name);
            if (!body.onlyMissing || !fs.existsSync(imageDiskPath(projectId, 'character', imgName))) {
              variantTasks.push({ kind: 'variant', cat: 'character', char: el, charIndex: index, variant, variantIndex, name: variant.name, imageName: imgName });
            }
          });
        }
        if (cat === 'character' && Array.isArray(el.outfits)) {
          el.outfits.forEach((outfit, outfitIndex) => {
            const imgName = `${el.name}_${outfit.name}`;
            if (!body.onlyMissing || !fs.existsSync(imageDiskPath(projectId, 'character', imgName))) {
              outfitTasks.push({ kind: 'outfit', cat: 'character', char: el, charIndex: index, outfit, outfitIndex, name: outfit.name, imageName: imgName });
            }
          });
        }
        if (cat === 'scene' && Array.isArray(el.areas)) {
          el.areas.forEach((area, areaIndex) => {
            const imgName = sceneAreaImageName(el.name, area.name);
            if (!body.onlyMissing || !fs.existsSync(imageDiskPath(projectId, 'scene', imgName))) {
              sceneAreaTasks.push({ kind: 'sceneArea', cat: 'scene', scene: el, sceneIndex: index, area, areaIndex, name: area.name, imageName: imgName });
            }
          });
        }
      });
    }
    const total = mainTasks.length + variantTasks.length + outfitTasks.length + sceneAreaTasks.length;

    const jobId = `imgjob_${Date.now()}`;
    setJob(jobId, {
      status: 'running',
      phase: 'image',
      kind: 'image',
      provider: normalizeImageProvider(cfg.image?.provider),
      projectId,
      title: `批量出图 · ${proj.name || projectId}`,
      done: 0, total, failed: [], results: [], category: category || null, concurrency,
      message: `共 ${total} 张图待生成`,
    });

    (async () => {
      let done = 0;
      const failed = [];
      const results = [];
      const markDone = (result) => {
        done++;
        if (result) results.push(result);
        setJob(jobId, { status: 'running', done, total, failed, results, category: category || null, concurrency, message: `已出图 ${done}/${total}${failed.length ? `，失败 ${failed.length}` : ''}` });
      };

      await runLimited(mainTasks, concurrency, async (t) => {
        let result;
        try {
          const { b64 } = await generateElementImage(cfg, projectId, t.cat, t.el, ratio, { imageMode });
          await saveImage(projectId, t.cat, t.el.name, b64);
          removePendingImage(projectId, t.cat, t.el.name);
          result = batchImageResult(t, true);
        } catch (e) {
          const pending = recordPendingGeneratedImage(projectId, t.cat, t.el.name, e, { kind: 'main' });
          failed.push(`${t.el.name}：${e.message}`);
          result = batchImageResult(t, false, { error: e.message, hasPendingImage: !!pending, pendingSync: !!pending });
        } finally {
          markDone(result);
        }
      });

      await runLimited(variantTasks, concurrency, async (t) => {
        const imgName = variantImageName(t.char.name, t.variant.name);
        let result;
        try {
          const mainFile = imageDiskPath(projectId, 'character', t.char.name);
          if (!fs.existsSync(mainFile)) {
            throw new Error('缺少人物主图，无法生成同一人物的形态图');
          }
          const clothingReferenceNames = variantClothingReferenceImageNames(t.char, t.variant);
          const clothingReferenceFiles = {
            outfit: imageDiskPath(projectId, 'character', clothingReferenceNames.outfit),
            pattern: imageDiskPath(projectId, 'character', clothingReferenceNames.pattern),
          };
          const clothingReferences = {
            outfit: fs.existsSync(clothingReferenceFiles.outfit),
            pattern: fs.existsSync(clothingReferenceFiles.pattern),
          };
          const prompt = applyVariantClothingReferencePrompt(
            applyCharacterImageMode(
              applyVariantIdentityReference(
                variantPromptForGeneration(t.char, t.variant, style, cfg.promptTemplate, cfg.stylePrompts),
                t.char.name,
                t.variant.name,
              ),
              imageMode,
            ),
            t.char,
            t.variant,
            clothingReferences,
          );
          const refB64 = await fs.promises.readFile(mainFile, { encoding: 'base64' });
          const referenceImages = [refB64];
          const outfit = findCharacterOutfit(t.char, t.variant.clothingReferenceOutfitName);
          let selectedOutfitReference = null;
          const referenceLabels = variantReferenceLabels({
            hasOutfit: clothingReferences.outfit,
            hasPattern: clothingReferences.pattern,
            selectedOutfit: null,
          });
          if (outfit) {
            const outfitFile = imageDiskPath(projectId, 'character', `${t.char.name}_${outfit.name}`);
            if (fs.existsSync(outfitFile)) {
              referenceImages.push(await fs.promises.readFile(outfitFile, { encoding: 'base64' }));
              selectedOutfitReference = outfit;
            }
          }
          if (selectedOutfitReference) referenceLabels.splice(1, 0, `${selectedOutfitReference.name}服装参考`);
          if (clothingReferences.outfit) referenceImages.push(await fs.promises.readFile(clothingReferenceFiles.outfit, { encoding: 'base64' }));
          if (clothingReferences.pattern) referenceImages.push(await fs.promises.readFile(clothingReferenceFiles.pattern, { encoding: 'base64' }));
          const { b64 } = await generateConfiguredImage(cfg, prompt, {
            ratio,
            referenceImages,
            referenceLabels,
            usageContext: imageUsageContext(cfg, projectId, 'variant-image'),
          });
          await saveImage(projectId, 'character', imgName, b64);
          removePendingImage(projectId, 'character', imgName);
          result = batchImageResult(t, true, { imageName: imgName });
        } catch (e) {
          const pending = recordPendingGeneratedImage(projectId, 'character', imgName, e, { kind: 'variant', charIndex: t.charIndex, variantIndex: t.variantIndex });
          failed.push(`${imgName}：${e.message}`);
          result = batchImageResult(t, false, { imageName: imgName, error: e.message, hasPendingImage: !!pending, pendingSync: !!pending });
        } finally {
          markDone(result);
        }
      });

      await runLimited(outfitTasks, concurrency, async (t) => {
        const imgName = `${t.char.name}_${t.outfit.name}`;
        let result;
        try {
          const mainFile = imageDiskPath(projectId, 'character', t.char.name);
          if (!fs.existsSync(mainFile)) {
            throw new Error('缺少人物主图，无法生成换装图');
          }
          const prompt = outfitPromptForGeneration(t.outfit, style, cfg.stylePrompts);
          const refB64 = await fs.promises.readFile(mainFile, { encoding: 'base64' });
          const { b64 } = await generateConfiguredImage(cfg, prompt, {
            ratio,
            referenceImages: [refB64],
            usageContext: imageUsageContext(cfg, projectId, 'outfit-image'),
          });
          await saveImage(projectId, 'character', imgName, b64);
          removePendingImage(projectId, 'character', imgName);
          result = batchImageResult(t, true, { imageName: imgName });
        } catch (e) {
          const pending = recordPendingGeneratedImage(projectId, 'character', imgName, e, { kind: 'outfit', charIndex: t.charIndex, outfitIndex: t.outfitIndex });
          failed.push(`${imgName}：${e.message}`);
          result = batchImageResult(t, false, { imageName: imgName, error: e.message, hasPendingImage: !!pending, pendingSync: !!pending });
        } finally {
          markDone(result);
        }
      });

      // 子区域要拿主场景图当参考图，所以必须排在 mainTasks 之后
      await runLimited(sceneAreaTasks, concurrency, async (t) => {
        const imgName = sceneAreaImageName(t.scene.name, t.area.name);
        let result;
        try {
          const mainFile = imageDiskPath(projectId, 'scene', t.scene.name);
          if (!fs.existsSync(mainFile)) {
            throw new Error('缺少场景主图，无法生成子区域图');
          }
          const prompt = sceneAreaPromptForGeneration(t.scene, t.area, style, cfg.stylePrompts);
          const refB64 = await fs.promises.readFile(mainFile, { encoding: 'base64' });
          const { b64 } = await generateConfiguredImage(cfg, prompt, {
            ratio,
            referenceImages: [refB64],
            usageContext: imageUsageContext(cfg, projectId, 'scene-area-image'),
          });
          await saveImage(projectId, 'scene', imgName, b64);
          removePendingImage(projectId, 'scene', imgName);
          result = batchImageResult(t, true, { imageName: imgName });
        } catch (e) {
          const pending = recordPendingGeneratedImage(projectId, 'scene', imgName, e, { kind: 'sceneArea', sceneIndex: t.sceneIndex, areaIndex: t.areaIndex });
          failed.push(`${imgName}：${e.message}`);
          result = batchImageResult(t, false, { imageName: imgName, error: e.message, hasPendingImage: !!pending, pendingSync: !!pending });
        } finally {
          markDone(result);
        }
      });

      setJob(jobId, { status: 'done', done, total, failed, results, category: category || null, concurrency, message: `出图完成 ${done - failed.length}/${total}${failed.length ? `，失败 ${failed.length}` : ''}` });
    })();

    return sendJson(res, 200, { jobId, total, concurrency });
  }

  // ---- 出图：批量生成选中的元素 ----
  if (p === '/api/image/batch-selected' && method === 'POST') {
    const body = await readBody(req);
    const { projectId, items } = body; // items: [{category, index, name}]
    const cfg = loadConfig();
    const ratio = normalizeImageRatio(body.ratio);
    const imageConfigError = imageProviderConfigError(cfg);
    if (imageConfigError) return sendJson(res, 400, { error: imageConfigError });
    const proj = loadProject(projectId);
    if (!proj) return sendJson(res, 404, { error: '项目不存在' });
    const style = projectImageStyle(proj, cfg);
    const imageMode = normalizeCharacterImageMode(body.imageMode || proj.characterImageMode);
    const concurrency = imageBatchConcurrency(cfg);

    if (!Array.isArray(items) || items.length === 0) {
      return sendJson(res, 400, { error: '请选择要生成的元素' });
    }

    const mainTasks = [];
    for (const item of items) {
      const { category, index } = item;
      if (!MAIN_CATEGORIES.includes(category)) continue;

      const el = proj.elements[category]?.[index];
      if (!el) continue;

      mainTasks.push({
        kind: 'main',
        cat: category,
        index,
        el,
        name: el.name,
        imageName: el.name
      });
    }

    if (mainTasks.length === 0) {
      return sendJson(res, 400, { error: '没有有效的元素可生成' });
    }

    const total = mainTasks.length;
    const jobId = `imgjob_${Date.now()}`;
    setJob(jobId, {
      status: 'running',
      phase: 'image',
      kind: 'image',
      provider: normalizeImageProvider(cfg.image?.provider),
      projectId,
      title: `选中出图 · ${proj.name || projectId}`,
      done: 0, total, failed: [], results: [], category: null, selected: true, concurrency,
      message: `共 ${total} 张图待生成`,
    });

    (async () => {
      let done = 0;
      const failed = [];
      const results = [];
      const markDone = (result) => {
        done++;
        if (result) results.push(result);
        setJob(jobId, { status: 'running', done, total, failed, results, category: null, selected: true, concurrency, message: `已出图 ${done}/${total}${failed.length ? `，失败 ${failed.length}` : ''}` });
      };

      await runLimited(mainTasks, concurrency, async (t) => {
        let result;
        try {
          const { b64 } = await generateElementImage(cfg, projectId, t.cat, t.el, ratio, { imageMode });
          await saveImage(projectId, t.cat, t.el.name, b64);
          removePendingImage(projectId, t.cat, t.el.name);
          result = batchImageResult(t, true);
        } catch (e) {
          const pending = recordPendingGeneratedImage(projectId, t.cat, t.el.name, e, { kind: 'main' });
          failed.push(`${t.el.name}：${e.message}`);
          result = batchImageResult(t, false, { error: e.message, hasPendingImage: !!pending, pendingSync: !!pending });
        } finally {
          markDone(result);
        }
      });

      setJob(jobId, { status: 'done', done, total, failed, results, category: null, selected: true, concurrency, message: `出图完成 ${done - failed.length}/${total}${failed.length ? `，失败 ${failed.length}` : ''}` });
    })();

    return sendJson(res, 200, { jobId, total, concurrency });
  }

  // ---- 批量出图状态查询 ----
  if (p === '/api/image/batch/status' && method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const st = getJob(url.searchParams.get('jobId'));
    if (!st) return sendJson(res, 404, { error: '任务不存在' });
    return sendJson(res, 200, st);
  }

  return false;
}
