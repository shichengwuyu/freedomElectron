import { getStorageInfo, loadConfig, normalizeGateway, prepareStorageRootChange, saveConfig } from '../config.js';
import { testTextModel, testImageModel } from '../apiClient.js';
import { listStoryboardPromptTemplates } from '../scriptPrompts.js';
import { listAccountsMasked as listXiaoyunqueAccountsMasked } from '../xiaoyunqueAccounts.js';
import { mergeModelRoutingSecrets, modelRoutingPublicView } from '../modelRouting.js';
import {
  imageChannelsPublicView,
  mergeImageChannelSecrets,
  mergeVideoApiChannelSecrets,
  videoApiChannelsPublicView,
} from '../channelProfiles.js';
import { discoverApiModels } from '../modelDiscovery.js';
import { fetchVideoApiModels } from '../videoApiModels.js';
import { uploadVideoApiImage, verifyVideoApiImageUrl } from '../videoImageUploader.js';
import { testConnection as testUpdreamConnection } from '../updreamClient.js';
import { testConnection as testNeowowConnection } from '../neowowClient.js';
import {
  COMFYUI_WORKFLOW_PRESETS,
  comfyUiWorkflowPreset,
  listComfyUiWorkflows,
  testComfyUiConnection,
} from '../comfyuiClient.js';
import {
  neowowAccountsPublicView,
  neowowConfigForAccount,
  selectedNeowowAccountId,
} from '../neowowAccounts.js';
import { dreaminaAgentAccountsPublicView } from '../dreaminaAgentAccounts.js';

const IMAGE_HOST_TEST_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function maskKey(key) {
  return key ? `${key.slice(0, 4)}****${key.slice(-4)}` : '';
}

function keepKey(incoming, oldValue) {
  return !incoming || incoming.includes('****') ? oldValue : incoming;
}

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

async function handleTestTextRoute({ req, res, readBody, sendJson }) {
  const body = await readBody(req);
  const cfg = loadConfig();
  const storedProfile = body.profileId
    ? (cfg.modelRouting?.profiles || []).find((profile) => profile.id === body.profileId)
    : null;
  const textConfig = {
    baseUrl: body.baseUrl || storedProfile?.baseUrl || cfg.text.baseUrl,
    model: body.model || storedProfile?.model || cfg.text.model,
    apiKey: body.apiKey && !body.apiKey.includes('****')
      ? body.apiKey
      : (body.profileId ? (storedProfile?.apiKey || '') : cfg.text.apiKey),
  };
  if (!textConfig.apiKey) return handled(sendJson, res, 400, { ok: false, error: '请先填写 API Key' });

  try {
    const result = await testTextModel(textConfig);
    return handled(sendJson, res, 200, result);
  } catch (e) {
    return handled(sendJson, res, 200, { ok: false, error: e.message });
  }
}

export async function handleConfigRoutes(ctx) {
  const { req, res, p, method, readBody, sendJson } = ctx;

  if (p === '/api/script/storyboard/templates' && method === 'GET') {
    sendJson(res, 200, { templates: listStoryboardPromptTemplates() });
    return true;
  }

  // 卡密兑换：把用户输入的卡密提交到 new-api 的 /api/user/topup，充值到网关令牌对应的账号。
  if (p === '/api/redeem' && method === 'POST') {
    const body = await readBody(req);
    const key = String(body?.key || '').trim();
    if (!key) return handled(sendJson, res, 400, { ok: false, error: '请输入卡密' });
    const appConfig = loadConfig();
    const baseUrl = String(appConfig.gateway?.baseUrl || '').trim().replace(/\/+$/, '');
    const token = String(appConfig.gateway?.userToken || '').trim();
    if (!baseUrl) return handled(sendJson, res, 400, { ok: false, error: '请先在「模型网关」设置中填写网关地址' });
    if (!token) return handled(sendJson, res, 400, { ok: false, error: '请先在「模型网关」设置中填写 new-api 用户令牌' });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const resp = await fetch(`${baseUrl}/api/user/topup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ key }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const raw = await resp.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* 忽略非 JSON 响应 */ }
      if (!resp.ok || data?.success === false) {
        return handled(sendJson, res, 200, { ok: false, error: data?.message || '卡密兑换失败，请确认卡密是否正确或是否已使用' });
      }
      return handled(sendJson, res, 200, { ok: true, quota: data?.data ?? null, message: data?.message || '兑换成功' });
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: `连接模型网关失败：${error?.message || error}` });
    }
  }

  if (p === '/api/config' && method === 'GET') {
    const cfg = loadConfig();
    const neowowAccounts = neowowAccountsPublicView();
    const neowowAccountId = selectedNeowowAccountId();
    sendJson(res, 200, {
      text: {
        ...cfg.text,
        apiKey: maskKey(cfg.text.apiKey),
        hasKey: !!cfg.text.apiKey,
        endpoints: Array.isArray(cfg.text.endpoints)
          ? cfg.text.endpoints.map((endpoint) => ({
            ...endpoint,
            apiKey: maskKey(endpoint.apiKey),
            hasKey: !!endpoint.apiKey,
          }))
          : [],
        rotationStrategy: cfg.text.rotationStrategy === 'failover' ? 'failover' : 'off',
      },
      image: imageChannelsPublicView(cfg.image, maskKey),
      modelRouting: modelRoutingPublicView(cfg.modelRouting, cfg.text, maskKey),
      style: cfg.style,
      stylePrompts: cfg.stylePrompts,
      promptTemplate: cfg.promptTemplate,
      chunkSize: cfg.chunkSize,
      extractConcurrency: cfg.extractConcurrency,
      video: {
        ...videoApiChannelsPublicView(cfg.video, maskKey),
        provider: cfg.video?.provider,
        shotHeaderPrefix: cfg.video?.shotHeaderPrefix,
        upstreamAccessToken: cfg.video?.upstreamAccessToken ? '__SET__' : '',
        upstreamUserId: cfg.video?.upstreamUserId || '',
        upstreamBaseUrl: cfg.video?.upstreamBaseUrl,
        feituoLedgerCookie: cfg.video?.feituoLedgerCookie ? '__SET__' : '',
        portraitBypass: cfg.video?.portraitBypass === true,
        xiaoyunqueModel: cfg.video?.xiaoyunqueModel,
        xiaoyunqueAccountId: cfg.video?.xiaoyunqueAccountId,
        dreaminaModel: cfg.video?.dreaminaModel,
        dreaminaSession: cfg.video?.dreaminaSession,
        dreaminaAgentSessionId: maskKey(cfg.video?.dreaminaAgentSessionId),
        dreaminaAgentHasSessionId: Boolean(cfg.video?.dreaminaAgentSessionId),
        dreaminaAgentAccounts: dreaminaAgentAccountsPublicView(),
        dreaminaAgentAccountId: cfg.video?.dreaminaAgentAccountId || '',
        dreaminaAgentHeadless: cfg.video?.dreaminaAgentHeadless === true,
        dreaminaAgentPromptPreset: cfg.video?.dreaminaAgentPromptPreset || 'standard',
        dreaminaAgentShotIntervalSeconds: cfg.video?.dreaminaAgentShotIntervalSeconds || 80,
        libtvModel: cfg.video?.libtvModel,
        libtvProjectUuid: cfg.video?.libtvProjectUuid,
        libtvConcurrency: cfg.video?.libtvConcurrency,
        updreamBaseUrl: cfg.video?.updreamBaseUrl,
        updreamAccessToken: maskKey(cfg.video?.updreamAccessToken),
        updreamRefreshToken: maskKey(cfg.video?.updreamRefreshToken),
        updreamHasAccessToken: Boolean(cfg.video?.updreamAccessToken),
        updreamHasRefreshToken: Boolean(cfg.video?.updreamRefreshToken),
        updreamModel: cfg.video?.updreamModel,
        updreamConcurrency: cfg.video?.updreamConcurrency,
        neowowBaseUrl: cfg.video?.neowowBaseUrl,
        neowowToken: maskKey(cfg.video?.neowowToken),
        neowowHasToken: neowowAccounts.some((account) => account.hasToken),
        neowowAccounts,
        neowowAccountId,
        neowowModel: cfg.video?.neowowModel,
        neowowConcurrency: cfg.video?.neowowConcurrency,
        neowowAttachActivityVideo: cfg.video?.neowowAttachActivityVideo === true,
        comfyuiBaseUrl: cfg.video?.comfyuiBaseUrl || '',
        comfyuiWorkflow: cfg.video?.comfyuiWorkflow || '',
        comfyuiWorkflowPreset: cfg.video?.comfyuiWorkflowPreset || 'u09',
        comfyuiConcurrency: cfg.video?.comfyuiConcurrency || 1,
        aspectRatio: cfg.video?.aspectRatio,
        resolution: cfg.video?.resolution || '720p',
        videoMode: cfg.video?.videoMode || 'mention',
        duration: cfg.video?.duration,
        xiaoyunqueAccounts: listXiaoyunqueAccountsMasked(),
      },
      jianying: {
        draftDir: cfg.jianying?.draftDir || '',
      },
      promptLibrary: cfg.promptLibrary || { scriptPrompts: [], storyboardPrompts: [] },
      appearance: cfg.appearance || { theme: 'dark' },
      generationSafety: cfg.generationSafety || { videoGuardEnabled: false, videoGuardSeconds: 10 },
      costTracking: cfg.costTracking || { currency: 'CNY', monthlyBudget: 0 },
      gateway: cfg.gateway || { baseUrl: 'https://api.xiaoyxiao.xyz', userToken: '' },
      performance: {
        hardwareAcceleration: cfg.performance?.hardwareAcceleration !== false,
        reduceMotion: cfg.performance?.reduceMotion === true,
      },
      storage: getStorageInfo(),
    });
    return true;
  }

  if (p === '/api/config' && method === 'POST') {
    const body = await readBody(req);
    const current = loadConfig();
    const incomingEndpoints = Array.isArray(body.text?.endpoints) ? body.text.endpoints : (current.text.endpoints || []);
    const nextText = {
      ...current.text,
      ...(body.text || {}),
      apiKey: keepKey(body.text?.apiKey, current.text.apiKey),
      // 备用端点：每个端点的 apiKey 都要走 keepKey，避免前端没有原值时把已存密钥覆盖掉
      endpoints: incomingEndpoints.map((endpoint, index) => ({
        name: String(endpoint?.name || current.text.endpoints?.[index]?.name || '').trim(),
        baseUrl: String(endpoint?.baseUrl || current.text.endpoints?.[index]?.baseUrl || '').trim(),
        apiKey: keepKey(endpoint?.apiKey, current.text.endpoints?.[index]?.apiKey || ''),
        model: String(endpoint?.model || current.text.endpoints?.[index]?.model || '').trim(),
      })),
      rotationStrategy: body.text?.rotationStrategy === 'failover' ? 'failover' : 'off',
    };
    saveConfig({
      text: nextText,
      image: mergeImageChannelSecrets(body.image || current.image, current.image, keepKey),
      modelRouting: mergeModelRoutingSecrets(body.modelRouting || current.modelRouting, current.modelRouting, keepKey, nextText),
      style: body.style ?? current.style,
      stylePrompts: body.stylePrompts ?? current.stylePrompts,
      promptTemplate: body.promptTemplate ?? current.promptTemplate,
      chunkSize: body.chunkSize ?? current.chunkSize,
      extractConcurrency: body.extractConcurrency ?? current.extractConcurrency,
      video: {
        ...mergeVideoApiChannelSecrets(body.video || current.video, current.video, keepKey),
        provider: body.video?.provider ?? current.video?.provider,
        shotHeaderPrefix: body.video?.shotHeaderPrefix ?? current.video?.shotHeaderPrefix,
        upstreamAccessToken: (body.video?.upstreamAccessToken && body.video.upstreamAccessToken !== '__SET__') ? String(body.video.upstreamAccessToken).trim() : (current.video?.upstreamAccessToken || ''),
        upstreamUserId: body.video?.upstreamUserId ?? current.video?.upstreamUserId ?? '',
        upstreamBaseUrl: body.video?.upstreamBaseUrl ?? current.video?.upstreamBaseUrl ?? 'https://rolldek.com',
        feituoLedgerCookie: (body.video?.feituoLedgerCookie && body.video.feituoLedgerCookie !== '__SET__') ? String(body.video.feituoLedgerCookie).trim() : (current.video?.feituoLedgerCookie || ''),
        portraitBypass: body.video?.portraitBypass ?? current.video?.portraitBypass === true,
        xiaoyunqueModel: body.video?.xiaoyunqueModel ?? current.video?.xiaoyunqueModel,
        xiaoyunqueAccountId: body.video?.xiaoyunqueAccountId ?? current.video?.xiaoyunqueAccountId,
        dreaminaModel: body.video?.dreaminaModel ?? current.video?.dreaminaModel,
        dreaminaSession: body.video?.dreaminaSession ?? current.video?.dreaminaSession,
        dreaminaAgentSessionId: current.video?.dreaminaAgentSessionId,
        dreaminaAgentAccounts: current.video?.dreaminaAgentAccounts || [],
        dreaminaAgentAccountId: body.video?.dreaminaAgentAccountId ?? current.video?.dreaminaAgentAccountId,
        dreaminaAgentHeadless: body.video?.dreaminaAgentHeadless ?? current.video?.dreaminaAgentHeadless,
        libtvModel: body.video?.libtvModel ?? current.video?.libtvModel,
        libtvProjectUuid: body.video?.libtvProjectUuid ?? current.video?.libtvProjectUuid,
        libtvConcurrency: body.video?.libtvConcurrency ?? current.video?.libtvConcurrency,
        updreamBaseUrl: body.video?.updreamBaseUrl ?? current.video?.updreamBaseUrl,
        updreamAccessToken: keepKey(body.video?.updreamAccessToken, current.video?.updreamAccessToken),
        updreamRefreshToken: keepKey(body.video?.updreamRefreshToken, current.video?.updreamRefreshToken),
        updreamModel: body.video?.updreamModel ?? current.video?.updreamModel,
        updreamConcurrency: body.video?.updreamConcurrency ?? current.video?.updreamConcurrency,
        neowowBaseUrl: body.video?.neowowBaseUrl ?? current.video?.neowowBaseUrl,
        neowowToken: current.video?.neowowToken || '',
        neowowAccounts: current.video?.neowowAccounts || [],
        neowowAccountId: current.video?.neowowAccountId || '',
        neowowModel: body.video?.neowowModel ?? current.video?.neowowModel,
        neowowConcurrency: body.video?.neowowConcurrency ?? current.video?.neowowConcurrency,
        neowowAttachActivityVideo: body.video?.neowowAttachActivityVideo ?? current.video?.neowowAttachActivityVideo,
        comfyuiBaseUrl: body.video?.comfyuiBaseUrl ?? current.video?.comfyuiBaseUrl,
        comfyuiWorkflow: body.video?.comfyuiWorkflow ?? current.video?.comfyuiWorkflow,
        comfyuiWorkflowPreset: body.video?.comfyuiWorkflowPreset ?? current.video?.comfyuiWorkflowPreset,
        comfyuiConcurrency: body.video?.comfyuiConcurrency ?? current.video?.comfyuiConcurrency,
        aspectRatio: body.video?.aspectRatio ?? current.video?.aspectRatio,
        resolution: body.video?.resolution ?? current.video?.resolution,
        videoMode: body.video?.videoMode ?? current.video?.videoMode,
        duration: body.video?.duration ?? current.video?.duration,
        xiaoyunqueAccounts: current.video?.xiaoyunqueAccounts || [],
      },
      jianying: {
        draftDir: body.jianying?.draftDir ?? current.jianying?.draftDir ?? '',
      },
      promptLibrary: body.promptLibrary ?? current.promptLibrary,
      appearance: body.appearance ?? current.appearance,
      generationSafety: body.generationSafety ?? current.generationSafety,
      costTracking: body.costTracking ?? current.costTracking,
      performance: {
        hardwareAcceleration: body.performance?.hardwareAcceleration ?? current.performance?.hardwareAcceleration ?? true,
        reduceMotion: body.performance?.reduceMotion ?? current.performance?.reduceMotion ?? false,
      },
      gateway: normalizeGateway(body.gateway || current.gateway || {}),
    });
    let storage = getStorageInfo();
    try {
      if (body.storage && String(body.storage.rootPath || '').trim()) {
        storage = prepareStorageRootChange(body.storage.rootPath);
      }
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message, storage: getStorageInfo() });
      return true;
    }
    sendJson(res, 200, { ok: true, restartRequired: storage.restartRequired === true, storage });
    return true;
  }

  if ((p === '/api/test/script' || p === '/api/test/text') && method === 'POST') {
    await handleTestTextRoute(ctx);
    return true;
  }

  if (p === '/api/comfyui/test' && method === 'POST') {
    const body = await readBody(req);
    const preset = comfyUiWorkflowPreset(body.workflowPreset || body.comfyuiWorkflowPreset);
    try {
      const result = await testComfyUiConnection({
        baseUrl: body.baseUrl || body.comfyuiBaseUrl,
        workflowPath: body.workflowPath || body.comfyuiWorkflow || preset.path,
      });
      return handled(sendJson, res, 200, { ...result, presets: COMFYUI_WORKFLOW_PRESETS });
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/comfyui/workflows' && method === 'GET') {
    const baseUrl = String(new URL(req.url, 'http://127.0.0.1').searchParams.get('baseUrl') || '').trim();
    if (!baseUrl) return handled(sendJson, res, 400, { ok: false, error: '请先填写 ComfyUI 云端地址' });
    try {
      const workflows = await listComfyUiWorkflows(baseUrl);
      return handled(sendJson, res, 200, { ok: true, workflows, presets: COMFYUI_WORKFLOW_PRESETS });
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/test/image' && method === 'POST') {
    const body = await readBody(req);
    const cfg = loadConfig();
    const storedChannel = body.channelId
      ? (cfg.image?.channels || []).find((channel) => channel.id === body.channelId)
      : null;
    const imageConfig = {
      baseUrl: body.baseUrl || storedChannel?.baseUrl || cfg.image.baseUrl,
      model: body.model || storedChannel?.model || cfg.image.model,
      ratio: body.ratio || cfg.image.ratio,
      resolution: body.resolution || storedChannel?.resolution || cfg.image.resolution,
      pricePerImage: body.pricePerImage ?? storedChannel?.pricePerImage ?? cfg.image.pricePerImage,
      apiKey: body.apiKey && !body.apiKey.includes('****')
        ? body.apiKey
        : (storedChannel?.apiKey || cfg.image.apiKey),
    };
    if (!imageConfig.apiKey) {
      sendJson(res, 400, { ok: false, error: '请先填写 API Key' });
      return true;
    }

    try {
      const result = await testImageModel(imageConfig);
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 200, { ok: false, error: e.message });
    }
    return true;
  }

  if (p === '/api/updream/test' && method === 'POST') {
    const body = await readBody(req);
    const cfg = loadConfig();
    const updreamConfig = {
      ...cfg.video,
      updreamAccessToken: keepKey(body.accessToken || body.updreamAccessToken, cfg.video?.updreamAccessToken),
      updreamRefreshToken: keepKey(body.refreshToken || body.updreamRefreshToken, cfg.video?.updreamRefreshToken),
    };
    if (!updreamConfig.updreamAccessToken && !updreamConfig.updreamRefreshToken) {
      return handled(sendJson, res, 400, { ok: false, error: '请先填写 UpDream Access Token 或 Refresh Token' });
    }
    try {
      const result = await testUpdreamConnection({
        config: updreamConfig,
        onTokens: ({ accessToken, refreshToken }) => {
          const latest = loadConfig();
          saveConfig({
            video: {
              ...latest.video,
              updreamAccessToken: accessToken,
              updreamRefreshToken: refreshToken,
            },
          });
        },
      });
      return handled(sendJson, res, 200, result);
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/neowow/test' && method === 'POST') {
    const body = await readBody(req);
    const cfg = loadConfig();
    try {
      const neowowConfig = {
        ...neowowConfigForAccount(body.accountId || selectedNeowowAccountId(), cfg),
        neowowBaseUrl: body.baseUrl || body.neowowBaseUrl || cfg.video?.neowowBaseUrl,
      };
      return handled(sendJson, res, 200, await testNeowowConnection({ config: neowowConfig }));
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/models/discover' && method === 'POST') {
    const body = await readBody(req);
    const kind = body.kind === 'image' ? 'image' : 'text';
    const cfg = loadConfig();
    const stored = kind === 'image'
      ? ((cfg.image?.channels || []).find((channel) => channel.id === body.channelId) || cfg.image)
      : ((cfg.modelRouting?.profiles || []).find((profile) => profile.id === body.profileId) || cfg.text);
    const modelConfig = {
      baseUrl: body.baseUrl || stored?.baseUrl,
      apiKey: body.apiKey && !body.apiKey.includes('****') ? body.apiKey : stored?.apiKey,
    };
    if (!String(modelConfig.baseUrl || '').trim()) {
      return handled(sendJson, res, 400, { ok: false, error: '请先填写 API Base URL' });
    }
    if (!String(modelConfig.apiKey || '').trim()) {
      return handled(sendJson, res, 400, { ok: false, error: '请先填写 API Key' });
    }

    try {
      const result = await discoverApiModels(modelConfig, kind);
      return handled(sendJson, res, 200, { ok: true, ...result });
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/video/models' && method === 'POST') {
    const body = await readBody(req);
    const cfg = loadConfig();
    const storedChannel = body.channelId
      ? (cfg.video?.apiChannels || []).find((channel) => channel.id === body.channelId)
      : null;
    const videoConfig = {
      baseUrl: body.apiBaseUrl || body.baseUrl || storedChannel?.apiBaseUrl || cfg.video?.apiBaseUrl,
      apiProtocol: body.apiProtocol || storedChannel?.apiProtocol || cfg.video?.apiProtocol,
      builtIn: typeof body.builtIn === 'boolean' ? body.builtIn : storedChannel?.builtIn,
      builtInChannel: body.builtInChannel || storedChannel?.builtInChannel,
      apiKey: body.apiKey && !body.apiKey.includes('****')
        ? body.apiKey
        : (storedChannel?.apiKey || cfg.video?.apiKey),
    };
    if (!String(videoConfig.baseUrl || '').trim()) {
      return handled(sendJson, res, 400, { ok: false, error: '请先填写视频 API Base URL' });
    }
    if (!String(videoConfig.apiKey || '').trim()) {
      return handled(sendJson, res, 400, { ok: false, error: '请先填写视频 API Key' });
    }

    try {
      const models = await fetchVideoApiModels(videoConfig);
      return handled(sendJson, res, 200, { ok: true, models });
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/video/image-host/test' && method === 'POST') {
    const body = await readBody(req);
    const cfg = loadConfig();
    const mergedVideo = mergeVideoApiChannelSecrets(
      { imageUpload: body.imageUpload || {} },
      cfg.video || {},
      keepKey,
    );
    if (mergedVideo.imageUpload?.provider === 'none') {
      return handled(sendJson, res, 400, { ok: false, error: '请先选择一个图床渠道' });
    }
    try {
      const imageUrl = await uploadVideoApiImage(IMAGE_HOST_TEST_DATA_URL, mergedVideo.imageUpload);
      const verified = await verifyVideoApiImageUrl(imageUrl);
      return handled(sendJson, res, 200, { ok: true, ...verified, host: new URL(imageUrl).hostname });
    } catch (error) {
      return handled(sendJson, res, 200, { ok: false, error: error.message });
    }
  }

  return false;
}

