import fs from 'fs';
import path from 'path';

import {
  downloadImageUrlAsB64,
  editImage as editApiImage,
  generateImage as generateApiImage,
} from './apiClient.js';
import { hasImageModelKey, resolveImageModelConfig } from './channelProfiles.js';
import { TEMP_DIR, loadConfig, saveConfig } from './config.js';
import { generateImage as generateLibtvImage } from './libtvClient.js';
import { generateImage as generateDreaminaImage } from './dreaminaClient.js';
import { generateImage as generateUpdreamImage } from './updreamClient.js';
import { generateImage as generateNeowowImage } from './neowowClient.js';
import { neowowConfigForAccount } from './neowowAccounts.js';

export function normalizeImageProvider(value) {
  if (value === 'libtv-cli') return 'libtv-cli';
  if (value === 'dreamina-cli') return 'dreamina-cli';
  if (value === 'updream') return 'updream';
  if (value === 'neowow') return 'neowow';
  return 'api';
}

export function imageProviderLabel(value) {
  const provider = normalizeImageProvider(value);
  if (provider === 'libtv-cli') return 'LibTV';
  if (provider === 'dreamina-cli') return '即梦 CLI';
  if (provider === 'updream') return 'UpDream';
  if (provider === 'neowow') return 'Neo';
  return '图片 API';
}

export function imageProviderConfigError(cfg = {}) {
  const provider = normalizeImageProvider(cfg.image?.provider);
  if (provider === 'libtv-cli') {
    const projectUuid = String(cfg.image?.libtvProjectUuid || cfg.video?.libtvProjectUuid || '').trim();
    return projectUuid ? '' : '请先在图片设置中填写 LibTV 画布 UUID';
  }
  if (provider === 'updream') {
    const hasToken = Boolean(cfg.video?.updreamAccessToken || cfg.video?.updreamRefreshToken);
    return hasToken ? '' : '请先在图片设置中配置 UpDream Token';
  }
  if (provider === 'dreamina-cli') return '';
  if (provider === 'neowow') {
    const accounts = Array.isArray(cfg.video?.neowowAccounts) ? cfg.video.neowowAccounts : [];
    const accountId = String(cfg.image?.neowowAccountId || cfg.video?.neowowAccountId || '').trim();
    const requestedAccount = accounts.find((item) => item?.id === accountId);
    if (accountId && !requestedAccount) return '选择的 Neo 生图账号不存在，请重新选择账号';
    const account = requestedAccount
      || accounts.find((item) => item?.selected)
      || accounts[0];
    if (account?.enabled === false) return '选择的 Neo 生图账号已停用，请重新选择账号';
    if (['expired', 'logged_out', 'invalid', 'logging_in'].includes(String(account?.status || ''))) {
      return '选择的 Neo 生图账号当前不可用，请重新登录或选择其他账号';
    }
    return account?.token || cfg.video?.neowowToken
      ? ''
      : '请先在图片设置中添加并选择可用的 Neo 账号';
  }
  return hasImageModelKey(cfg.image) ? '' : '请先在图片设置中配置图片模型 API Key';
}

function cleanBase64(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const stripped = raw.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '');
  return /^[A-Za-z0-9+/]+={0,2}$/.test(stripped) ? stripped : '';
}

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')) return '.gif';
  return '.png';
}

async function referenceAsBase64(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (fs.existsSync(raw) && fs.statSync(raw).isFile()) return fs.promises.readFile(raw, { encoding: 'base64' });
  if (/^https?:\/\//i.test(raw)) return (await downloadImageUrlAsB64(raw, { context: '参考图' })).b64;
  return cleanBase64(raw);
}

async function materializeReferences(values = []) {
  const source = (Array.isArray(values) ? values : [values]).filter(Boolean).slice(0, 10);
  if (!source.length) return { paths: [], cleanup: async () => {} };
  const directory = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'hepai_image_refs_'));
  const paths = [];
  try {
    for (let index = 0; index < source.length; index += 1) {
      const raw = String(source[index] || '').trim();
      if (!raw) continue;
      if (fs.existsSync(raw) && fs.statSync(raw).isFile()) {
        paths.push(raw);
        continue;
      }
      const b64 = await referenceAsBase64(raw);
      if (!b64) throw new Error(`第 ${index + 1} 张参考图数据无效`);
      const bytes = Buffer.from(b64, 'base64');
      const target = path.join(directory, `reference-${index + 1}${imageExtension(bytes)}`);
      await fs.promises.writeFile(target, bytes);
      paths.push(target);
    }
    return {
      paths,
      cleanup: () => fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {}),
    };
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function persistUpdreamTokens({ accessToken, refreshToken } = {}) {
  const current = loadConfig();
  const nextAccess = String(accessToken || current.video?.updreamAccessToken || '').trim();
  const nextRefresh = String(refreshToken || current.video?.updreamRefreshToken || '').trim();
  if (nextAccess === current.video?.updreamAccessToken && nextRefresh === current.video?.updreamRefreshToken) return;
  saveConfig({
    video: {
      ...current.video,
      updreamAccessToken: nextAccess,
      updreamRefreshToken: nextRefresh,
    },
  });
}

export async function generateConfiguredImage(cfg = {}, prompt, {
  ratio,
  resolution,
  quality,
  referenceImages = [],
  referenceLabels = [],
  usageContext = {},
  onProgress,
} = {}) {
  const configError = imageProviderConfigError(cfg);
  if (configError) throw new Error(configError);
  const provider = normalizeImageProvider(cfg.image?.provider);
  const references = (Array.isArray(referenceImages) ? referenceImages : [referenceImages]).filter(Boolean);

  if (provider === 'api') {
    const imageConfig = resolveImageModelConfig(cfg.image);
    if (references.length) {
      const b64References = (await Promise.all(references.slice(0, 9).map(referenceAsBase64))).filter(Boolean);
      return editApiImage(imageConfig, prompt, b64References, { ratio, resolution, usageContext });
    }
    return generateApiImage(imageConfig, prompt, { ratio, resolution, usageContext });
  }

  const materialized = await materializeReferences(references);
  try {
    if (provider === 'dreamina-cli') {
      const result = await generateDreaminaImage({
        prompt,
        referencePaths: materialized.paths,
        ratio: ratio || cfg.image?.ratio,
        model: cfg.image?.dreaminaModel || '5.0',
        resolution: resolution || cfg.image?.dreaminaResolution,
        session: cfg.image?.dreaminaSession,
        onProgress,
      });
      try {
        if (result.imagePath && fs.existsSync(result.imagePath)) {
          const bytes = await fs.promises.readFile(result.imagePath);
          return { ...result, b64: bytes.toString('base64'), mime: `image/${path.extname(result.imagePath).slice(1).toLowerCase() || 'png'}` };
        }
        if (result.imageUrl) {
          const downloaded = await downloadImageUrlAsB64(result.imageUrl, { context: '即梦图片' });
          return { ...result, ...downloaded };
        }
        throw new Error('即梦图片任务完成但没有返回图片文件');
      } finally {
        await result.cleanup?.();
      }
    }
    if (provider === 'libtv-cli') {
      return await generateLibtvImage({
        config: {
          ...cfg.image,
          libtvProjectUuid: cfg.image?.libtvProjectUuid || cfg.video?.libtvProjectUuid,
        },
        prompt,
        referencePaths: materialized.paths,
        ratio: ratio || cfg.image?.ratio,
        resolution: resolution || cfg.image?.libtvResolution,
        quality: quality || cfg.image?.libtvQuality,
        model: cfg.image?.libtvModel,
        concurrency: cfg.image?.concurrency,
        onProgress,
      });
    }

    if (provider === 'neowow') {
      const accountId = String(cfg.image?.neowowAccountId || cfg.video?.neowowAccountId || '').trim();
      const result = await generateNeowowImage({
        config: {
          ...neowowConfigForAccount(accountId, cfg),
          neowowImageModel: cfg.image?.neowowModel,
          neowowImageResolution: cfg.image?.neowowResolution,
          neowowImageQuality: cfg.image?.neowowQuality,
        },
        projectName: usageContext.projectName || usageContext.projectId || '图片生成',
        prompt,
        referencePaths: materialized.paths,
        ratio: ratio || cfg.image?.ratio,
        model: cfg.image?.neowowModel,
        resolution: resolution || cfg.image?.neowowResolution,
        quality: quality || cfg.image?.neowowQuality,
        onProgress,
      });
      const downloaded = await downloadImageUrlAsB64(result.imageUrl, { context: 'Neo 图片' });
      return { ...result, ...downloaded };
    }

    const result = await generateUpdreamImage({
        config: {
          ...cfg.video,
          updreamImageModel: cfg.image?.updreamModel,
          updreamImageResolution: cfg.image?.updreamResolution,
          updreamImageQuality: cfg.image?.updreamQuality,
      },
      projectName: usageContext.projectId || '图片生成',
      prompt,
      referencePaths: materialized.paths,
      referenceLabels,
      ratio: ratio || cfg.image?.ratio,
      model: cfg.image?.updreamModel,
      resolution: resolution || cfg.image?.updreamResolution,
      quality: quality || cfg.image?.updreamQuality,
      onProgress,
      onTokens: persistUpdreamTokens,
    });
    const downloaded = await downloadImageUrlAsB64(result.imageUrl, { context: 'UpDream 图片' });
    return { ...result, ...downloaded };
  } finally {
    await materialized.cleanup();
  }
}
