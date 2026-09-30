// HTTP 服务器入口：负责启动生命周期；具体 HTTP 分发在 requestRouter.js。
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DATA_DIR } from './config.js';
import { launchDesktop } from './desktopLauncher.js';
import { sendJson } from './http.js';
import { attachRequestLogger, installGlobalErrorHandlers, logger } from './logger.js';
import { getPendingImage } from './pendingImages.js';
import {
  buildCharacterPromptFromParts,
  buildGroupPrompt,
  buildEffectPrompt,
  buildCreaturePrompt,
  buildOutfitPrompt,
  buildPropPrompt,
  buildScenePrompt,
  buildVariantPrompt,
  makeCharacterPromptParts,
  normalizeCharacterPartsEdited,
  normalizeCharacterPromptParts,
  normalizeImageStyle,
} from './prompts.js';
import { createRequestRouter } from './requestRouter.js';
import { startCanvasBackgroundPoll } from './routes/canvasRoutes.js';
import { setVideoHandlers } from './routes/videoRoutes.js';
import {
  characterVoiceReadDiskPath,
  ensureLabeledImage,
  imageDiskPath,
  MAIN_CATEGORIES,
  migrateLegacyCharacterVoiceFilesToMp3,
} from './storage.js';
import { videoDiskPath, introDiskPath } from './videoFunctions.js';
import { videoHistoryDir } from './videoHistory.js';
import {
  pollPendingUpdreamVideos,
  pollPendingVideos,
  pruneCompletedVideoPendingRecords,
  recoverNeowowPendingShot,
  recoverLibtvPendingShot,
  reconcileProjectShotVideos,
  startBackgroundPoll,
  submitVideoBatchRequest,
  tailFrameDiskPath,
} from './videoService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const DEFAULT_PORT = Number(process.env.NEX_PORT || process.env.PORT || 8848);
const HOST = '127.0.0.1';

function imageState(projectId, category, imageName) {
  const hasImage = fs.existsSync(imageDiskPath(projectId, category, imageName));
  const pending = hasImage ? null : getPendingImage(projectId, category, imageName);
  return {
    hasImage,
    hasPendingImage: !hasImage && !!pending,
  };
}

function ensureCharacterPromptLayers(character, style, promptTemplateConfig, stylePromptConfig = null) {
  if (!character) return false;
  let changed = false;
  const source = character.source || character;
  const legacyEditedPrompt = character.edited && !character.promptParts && !character.partsEdited;

  if (legacyEditedPrompt) return false;

  const defaultParts = makeCharacterPromptParts(source, style, promptTemplateConfig, stylePromptConfig);
  const previousParts = normalizeCharacterPromptParts(character.promptParts || {});
  const edited = normalizeCharacterPartsEdited(character.partsEdited || {});
  const nextParts = { ...defaultParts };
  for (const field of Object.keys(edited)) {
    if (edited[field]) nextParts[field] = previousParts[field];
  }

  if (JSON.stringify(nextParts) !== JSON.stringify(character.promptParts || {})) {
    character.promptParts = nextParts;
    changed = true;
  }
  if (JSON.stringify(edited) !== JSON.stringify(character.partsEdited || {})) {
    character.partsEdited = edited;
    changed = true;
  }

  const expectedPrompt = buildCharacterPromptFromParts(character.promptParts, source, style, promptTemplateConfig, stylePromptConfig);
  if (character.prompt !== expectedPrompt) {
    character.prompt = expectedPrompt;
    changed = true;
  }
  const editedByParts = Object.values(character.partsEdited).some(Boolean);
  if (character.edited !== editedByParts) {
    character.edited = editedByParts;
    changed = true;
  }
  return changed;
}

function ensureProjectPromptTemplates(project, style, promptTemplateConfig, stylePromptConfig = null) {
  if (!project?.elements) return false;
  let changed = false;

  for (const ch of project.elements.character || []) {
    if (ensureCharacterPromptLayers(ch, style, promptTemplateConfig, stylePromptConfig)) changed = true;
    const src = ch.source || ch;
    for (const outfit of ch.outfits || []) {
      if (outfit.promptEdited) continue;
      const expected = buildOutfitPrompt(outfit, style, stylePromptConfig);
      if (outfit.prompt !== expected) {
        outfit.prompt = expected;
        changed = true;
      }
    }
    for (const variant of ch.variants || []) {
      if (variant.promptEdited) continue;
      const expected = buildVariantPrompt(src, variant, style, promptTemplateConfig, stylePromptConfig);
      if (variant.prompt !== expected) {
        variant.prompt = expected;
        changed = true;
      }
    }
  }

  const rebuilders = {
    group: buildGroupPrompt,
    scene: buildScenePrompt,
    prop: buildPropPrompt,
    effect: buildEffectPrompt,
    creature: buildCreaturePrompt,
  };
  for (const [category, buildPrompt] of Object.entries(rebuilders)) {
    for (const el of project.elements[category] || []) {
      if (el.edited) continue;
      const src = el.source || el;
      const expected = buildPrompt(src, style, stylePromptConfig);
      if (el.prompt !== expected) {
        el.prompt = expected;
        changed = true;
      }
    }
  }

  return changed;
}

function variantImageName(characterName, variantName) {
  return `${characterName}_形态_${variantName}`;
}

function characterReferenceImageName(characterName) {
  return `${characterName}_参考图`;
}

function globalReferenceImageName() {
  return '__全局风格参考图';
}

function normalizeReferenceMode(value, fallback = 'none') {
  return ['global', 'character', 'none'].includes(value) ? value : fallback;
}

function projectImageStyle(project, cfg) {
  return normalizeImageStyle(project?.imageStyle || cfg?.style || 'realistic');
}

setVideoHandlers({
  submitBatch: submitVideoBatchRequest,
  pollPendingVideos,
  pollPendingUpdreamVideos,
  recoverNeowowPendingShot,
  recoverLibtvPendingShot,
});

const handleRequest = createRequestRouter({
  host: HOST,
  defaultPort: DEFAULT_PORT,
  frontendDir: FRONTEND,
  imageDiskPath,
  videoDiskPath,
  videoIntroDiskPath: introDiskPath,
  videoHistoryDir,
  tailFrameDiskPath,
  characterVoiceDiskPath: characterVoiceReadDiskPath,
  ensureLabeledImage,
  ensureProjectPromptTemplates,
  imageState,
  globalReferenceImageName,
  characterReferenceImageName,
  variantImageName,
  normalizeReferenceMode,
  projectImageStyle,
  reconcileProjectShotVideos,
});

installGlobalErrorHandlers();

function createServer() {
  return http.createServer(async (req, res) => {
    attachRequestLogger(req, res);
    try {
      await handleRequest(req, res);
    } catch (e) {
      logger.error('request_handler_error', e);
      console.error('请求处理出错：', e);
      if (!res.headersSent) {
        sendJson(res, 500, { error: e.message });
      } else if (!res.writableEnded && !res.destroyed) {
        res.destroy(e);
      }
    }
  });
}

export function startServer({ port = DEFAULT_PORT, host = HOST, openDesktop = true } = {}) {
  const voiceMigration = migrateLegacyCharacterVoiceFilesToMp3();
  if (voiceMigration.failed.length) {
    console.warn(`[audio] ${voiceMigration.failed.length} 个人物 M4A 音频转换为 MP3 失败，已保留原文件`);
  }
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const url = `http://${host}:${actualPort}`;
      console.log(`\n  Freedom已启动：${url}\n`);
      // 启动时清掉「已完成但视频已落盘」的僵尸 pending 记录：
      // 后台轮询以 listUnfinished() 为条件（不含 done），只剩余这类记录时永远不会触发轮询自愈，
      // 而前端打开该集时 hydrate 又会把它们当成 queued 复活成「已提交 100%」。
      const pruned = pruneCompletedVideoPendingRecords();
      if (pruned > 0) console.log(`  [视频] 已清理 ${pruned} 条已完成僵尸待办记录`);
      startBackgroundPoll();
      startCanvasBackgroundPoll();
      if (openDesktop) launchDesktop(url, DATA_DIR);
      resolve({ server, url, port: actualPort, host });
    });
  });
}

async function startStandalone() {
  if (process.env.GG_ALLOW_STANDALONE_SERVER !== '1') {
    console.error('Direct backend startup is disabled. Use the development server script instead.');
    process.exitCode = 1;
    return;
  }
  try {
    await startServer({ openDesktop: !process.env.NEX_NO_BROWSER });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${DEFAULT_PORT} 已被占用，请先关闭旧的程序窗口后再启动。`);
    } else {
      console.error('启动失败：', e);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startStandalone();
}
