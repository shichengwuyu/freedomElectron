import fs from 'fs';

import { chatComplete } from './apiClient.js';
import { AGENT_SYSTEM_PROMPT } from './agentSystemPrompt.js';
import { handleAgentPlanRoute } from './agentPlan.js';
import { loadConfig } from './config.js';
import { readBody, sendJson } from './http.js';
import { setJob } from './jobs.js';
import {
  serveCharacterAudio,
  serveCharacterLibraryMedia,
  serveProjectImage,
  serveProjectVideo,
  serveProjectIntro,
  serveVideoHistory,
  serveStatic as serveStaticFile,
  serveTailFrame as serveTailFrameFile,
} from './mediaServer.js';
import { globalCharacterMediaPath } from './services/characterLibraryService.js';
import { handleCharacterAssetRoutes } from './routes/characterAssetRoutes.js';
import { handleCharacterLibraryRoutes } from './routes/characterLibraryRoutes.js';
import { handleConfigRoutes } from './routes/configRoutes.js';
import { handleChatRoutes } from './routes/chatRoutes.js';
import { handleCanvasRoutes } from './routes/canvasRoutes.js';
import { handleDiagnosticRoutes } from './routes/diagnosticRoutes.js';
import { handleElementRoutes } from './routes/elementRoutes.js';
import { handleExportRoutes } from './routes/exportRoutes.js';
import { handleExtractRoutes } from './routes/extractRoutes.js';
import { handleImageRoutes } from './routes/imageRoutes.js';
import { handleNovelRoutes } from './routes/novelRoutes.js';
import { handleProjectRoutes } from './routes/projectRoutes.js';
import { handleQualityRoutes } from './routes/qualityRoutes.js';
import { handleProjectMaintenanceRoutes } from './routes/projectMaintenanceRoutes.js';
import { handleProviderRoutes } from './routes/providerRoutes.js';
import { handleSceneAreaRoutes } from './routes/sceneAreaRoutes.js';
import { handleScriptRoutes } from './routes/scriptRoutes.js';
import { handleScriptExportRoutes } from './routes/scriptExportRoutes.js';
import { handleStoryboardBindingRoutes } from './routes/storyboardBindingRoutes.js';
import { handleVideoRoutes } from './routes/videoRoutes.js';
import { handleVideoSplitRoutes } from './routes/videoSplitRoutes.js';
import { handleUsageRoutes } from './routes/usageRoutes.js';
import { handleTaskRoutes } from './taskCenter.js';

function sendNoStorePng(res, data) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': data.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(data);
}

export function createRequestRouter({
  host,
  defaultPort,
  frontendDir,
  imageDiskPath,
  videoDiskPath,
  videoIntroDiskPath,
  videoHistoryDir,
  tailFrameDiskPath,
  characterVoiceDiskPath,
  ensureLabeledImage,
  ensureProjectPromptTemplates,
  imageState,
  globalReferenceImageName,
  characterReferenceImageName,
  variantImageName,
  normalizeReferenceMode,
  projectImageStyle,
  reconcileProjectShotVideos,
}) {
  const serveStatic = (req, res, urlPath) => serveStaticFile({ frontendDir }, req, res, urlPath);
  const serveImage = (req, res, parts) => serveProjectImage({ imageDiskPath }, req, res, parts);
  const serveVideo = (req, res, parts) => serveProjectVideo({ videoDiskPath }, req, res, parts);
  const serveIntro = (req, res, parts) => serveProjectIntro({ introDiskPath: videoIntroDiskPath }, req, res, parts);
  const serveHistory = (req, res, parts) => serveVideoHistory({ videoHistoryDir }, req, res, parts);
  const serveTailFrame = (res, parts) => serveTailFrameFile({ tailFrameDiskPath }, res, parts);
  const serveAudio = (req, res, parts) => serveCharacterAudio({ characterVoiceDiskPath }, req, res, parts);
  const serveLibraryCharacter = (req, res, parts) => serveCharacterLibraryMedia({ globalCharacterMediaPath }, req, res, parts);

  return async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${host}:${defaultPort}`);
    const p = url.pathname;
    const method = req.method;

    if (method === 'GET' && p === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (method === 'GET' && p.startsWith('/img/')) {
      return serveImage(req, res, p.slice('/img/'.length).split('/'));
    }
    if (method === 'GET' && p.startsWith('/video/')) {
      return serveVideo(req, res, p.slice('/video/'.length).split('/'));
    }
    if (method === 'GET' && p.startsWith('/video-intro/')) {
      return serveIntro(req, res, p.slice('/video-intro/'.length).split('/'));
    }
    if (method === 'GET' && p.startsWith('/video-history/')) {
      return serveHistory(req, res, p.slice('/video-history/'.length).split('/'));
    }
    if (method === 'GET' && p.startsWith('/audio/')) {
      return serveAudio(req, res, p.slice('/audio/'.length).split('/'));
    }
    if (method === 'GET' && p.startsWith('/character-library-media/')) {
      return serveLibraryCharacter(req, res, p.slice('/character-library-media/'.length).split('/'));
    }
    if (method === 'GET' && p.startsWith('/tailframe/')) {
      return serveTailFrame(res, p.slice('/tailframe/'.length).split('/'));
    }
    if (method === 'GET' && p.startsWith('/imglabel/')) {
      const parts = p.slice('/imglabel/'.length).split('/');
      const [rawProject, category, rawName] = parts;
      const projectId = decodeURIComponent(rawProject || '');
      const name = decodeURIComponent(rawName || '').replace(/\.png$/i, '');
      const label = String(url.searchParams.get('label') || '').trim();
      try {
        const dest = await ensureLabeledImage(projectId, category, name, label || undefined);
        if (!dest) {
          res.writeHead(404);
          return res.end('Not Found');
        }
        return sendNoStorePng(res, await fs.promises.readFile(dest));
      } catch {
        res.writeHead(500);
        return res.end('Label failed');
      }
    }
    if (method === 'GET' && !p.startsWith('/api/')) {
      return serveStatic(req, res, p);
    }

    if (await handleConfigRoutes({ req, res, p, method, readBody, sendJson })) return;
    if (await handleChatRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleCanvasRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleDiagnosticRoutes({ req, res, p, method, readBody, sendJson })) return;
    if (await handleTaskRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleUsageRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleQualityRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleCharacterLibraryRoutes({ req, res, url, p, method, readBody, sendJson })) return;

    if (await handleAgentPlanRoute({
      req,
      res,
      p,
      method,
      readBody,
      sendJson,
      loadConfig,
      chatComplete,
      systemPrompt: AGENT_SYSTEM_PROMPT,
    })) return;

    if (await handleProjectMaintenanceRoutes({ req, res, url, p, method, readBody, sendJson })) return;

    if (await handleProjectRoutes({
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
    })) return;

    if (await handleElementRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleSceneAreaRoutes({ req, res, p, method, readBody, sendJson })) return;
    if (await handleImageRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleVideoSplitRoutes({ req, res, p, method, readBody, sendJson })) return;
    if (await handleVideoRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleNovelRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleStoryboardBindingRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleScriptExportRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleScriptRoutes({ req, res, url, p, method, readBody, sendJson })) return;
    if (await handleExtractRoutes({ req, res, url, p, method, readBody, sendJson, projectImageStyle })) return;

    if (await handleCharacterAssetRoutes({
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
    })) return;

    if (await handleExportRoutes({ req, res, url, p, method, readBody, sendJson, variantImageName })) return;
    if (await handleProviderRoutes({ req, res, p, method, readBody, sendJson, setJob })) return;

    return sendJson(res, 404, { error: 'Not Found' });
  };
}
