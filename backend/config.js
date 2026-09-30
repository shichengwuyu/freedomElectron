// 配置读写：API 设置全部存本地 config.json，不上传任何第三方
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { normalizePromptTemplateConfig, normalizeImageStyle, normalizeStylePrompts } from './prompts.js';
import { writeJsonAtomic } from './lib/atomicJson.js';
import { normalizeModelRouting } from './modelRouting.js';
import {
  DEFAULT_IMAGE_API_BASE_URL,
  DEFAULT_IMAGE_API_MODEL,
  DEFAULT_VIDEO_API_BASE_URL,
  DEFAULT_VIDEO_GATEWAY_API_MODEL,
  VIDEO_API_PROTOCOL_NEW_API,
  normalizeApiBaseUrl,
  normalizeImageChannels,
  normalizeImageApiBaseUrl,
  normalizeVideoApiChannels,
} from './channelProfiles.js';
import { normalizeLibtvVideoModelName } from './libtvModels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APPDATA_ROOT = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const APPDATA_STORAGE_ROOT = path.join(APPDATA_ROOT, 'Freedom');
const OLD_USER_APP_DIR = path.join(APPDATA_ROOT, 'GG Studio');
const LEGACY_USER_APP_DIR = path.join(APPDATA_ROOT, 'NovelElementExtractor');
const LEGACY_LICENSE_DIR = path.join(APPDATA_ROOT, 'GG');
const LEGACY_CONFIG_PATH = path.join(ROOT, 'config.json');
const LEGACY_DATA_DIR = path.join(ROOT, 'data');

function resolveInstallDir() {
  const explicit = String(process.env.GG_INSTALL_DIR || '').trim();
  if (explicit) return path.resolve(explicit);
  const packagedElectron = Boolean(process.versions?.electron && !process.defaultApp);
  return packagedElectron ? path.dirname(process.execPath) : ROOT;
}

export const INSTALL_DIR = resolveInstallDir();
export const INSTALL_STORAGE_ROOT = path.join(INSTALL_DIR, 'Freedom-Data');
const LEGACY_INSTALL_STORAGE_ROOT = path.join(INSTALL_DIR, 'GG-Data');
const PACKAGED_ELECTRON = Boolean(process.versions?.electron && !process.defaultApp);

function resolveDefaultStorageRoot() {
  if (!PACKAGED_ELECTRON) return APPDATA_STORAGE_ROOT;
  const installParent = path.dirname(INSTALL_DIR);
  try {
    // A normal user can write beside a portable/custom install. Program Files
    // is protected, so keep the default in AppData there instead.
    fs.accessSync(installParent, fs.constants.W_OK);
    return path.join(installParent, 'Freedom-Data');
  } catch {
    return APPDATA_STORAGE_ROOT;
  }
}

export const DEFAULT_STORAGE_ROOT = resolveDefaultStorageRoot();
export const STORAGE_LOCATOR_PATH = path.join(APPDATA_STORAGE_ROOT, 'gg-storage.json');
const LEGACY_STORAGE_LOCATOR_PATH = path.join(INSTALL_DIR, 'gg-storage.json');
const LEGACY_APPDATA_STORAGE_LOCATOR_PATH = path.join(OLD_USER_APP_DIR, 'gg-storage.json');

function normalizeStorageRoot(value, fallback = DEFAULT_STORAGE_ROOT) {
  const cleaned = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned) return path.resolve(fallback);
  if (!path.isAbsolute(cleaned)) return path.resolve(INSTALL_DIR, cleaned);
  return path.resolve(cleaned);
}

let STORAGE_LOCATOR = null;
let STORAGE_LOCATOR_SOURCE_PATH = '';
let LOCATED_INSTALL_STORAGE_ROOT = '';

function hasStorageContent(root) {
  try {
    const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
      if (entry.isSymbolicLink()) return false;
      if (entry.isFile()) return entry.name !== '.gg-storage-root.json';
      return entry.isDirectory() && walk(path.join(directory, entry.name));
    });
    return fs.statSync(root).isDirectory() && walk(root);
  } catch {
    return false;
  }
}

function readStorageRoot() {
  const envRoot = String(process.env.GG_STORAGE_ROOT || '').trim();
  if (envRoot) return normalizeStorageRoot(envRoot);
  for (const locatorPath of [STORAGE_LOCATOR_PATH, LEGACY_APPDATA_STORAGE_LOCATOR_PATH, LEGACY_STORAGE_LOCATOR_PATH]) {
    try {
      if (!fs.existsSync(locatorPath)) continue;
      const locator = JSON.parse(fs.readFileSync(locatorPath, 'utf8').replace(/^\uFEFF/, ''));
      if (!locator?.rootPath) continue;
      const resolvedRoot = normalizeStorageRoot(locator.rootPath);
      STORAGE_LOCATOR = locator;
      STORAGE_LOCATOR_SOURCE_PATH = locatorPath;
      if (pathsEqual(resolvedRoot, OLD_USER_APP_DIR)) {
        return path.resolve(DEFAULT_STORAGE_ROOT);
      }
      // Data inside the install directory is removed by an in-place upgrade.
      // Keep the old path for one migration pass, but run the app from the
      // independent AppData root so a new update cannot point at deleted data.
      if (pathContains(INSTALL_DIR, resolvedRoot)) {
        LOCATED_INSTALL_STORAGE_ROOT = resolvedRoot;
        return path.resolve(DEFAULT_STORAGE_ROOT);
      }
      if (!hasStorageContent(resolvedRoot)) {
        // Keep the locator intact for a temporarily unavailable drive, but
        // use the preserved default root instead of creating an empty one.
        return path.resolve(DEFAULT_STORAGE_ROOT);
      }
      return resolvedRoot;
    } catch (error) {
      console.error(`Failed to read storage location (${locatorPath}):`, error.message);
    }
  }
  return path.resolve(DEFAULT_STORAGE_ROOT);
}

// All persistent application data follows this root. Custom changes take effect after restart.
export const USER_APP_DIR = readStorageRoot();
export const CONFIG_PATH = path.join(USER_APP_DIR, 'config.json');
export const DATA_DIR = path.join(USER_APP_DIR, 'data');
export const STATE_DIR = path.join(USER_APP_DIR, 'state');
export const LOG_DIR = path.join(USER_APP_DIR, 'logs');
export const TEMP_DIR = path.join(USER_APP_DIR, 'temp');
export const LICENSE_DIR = path.join(USER_APP_DIR, 'license');
export const ELECTRON_DATA_DIR = path.join(USER_APP_DIR, 'electron');
const UPDATE_BACKUP_DIR = path.join(APPDATA_ROOT, 'Freedom Update Backup');
const UPDATE_BACKUP_META_PATH = path.join(APPDATA_ROOT, 'Freedom Update Backup.json');
const DEFAULT_TEXT_API_BASE_URL = DEFAULT_IMAGE_API_BASE_URL;

const DEFAULT_CONFIG = {
  text: {
    baseUrl: DEFAULT_TEXT_API_BASE_URL,
    apiKey: '',
    models: [],
    temperature: 0.7,
    maxTokens: 256000,
    // 备用文本端点：每个元素 { baseUrl, apiKey, model?, name? }
    // 主端点失败时按数组顺序顺延（仅在 modelRouting 关闭 + rotationStrategy='failover' 时生效）
    endpoints: [],
    rotationStrategy: 'off',
  },
  modelRouting: {
    enabled: false,
    autoFallback: true,
    retryCount: 1,
    profiles: [],
    routes: {},
    fallbacks: {},
  },
  // 旧版配置兼容：剧本/分镜现在复用 text，这里只用于读取老 config 时迁移参数
  script: {
    baseUrl: DEFAULT_TEXT_API_BASE_URL,
    apiKey: '',
    temperature: 0.7,
    maxTokens: 256000,
  },
  // 模型网关(new-api)：XiaoyXiao 的视频/图片/文本模型统一经此网关(OpenAI 兼容)提供。
  // baseUrl 为网关地址（可在「模型网关」设置中修改），userToken 为 new-api 用户令牌（卡密兑换充到该账号）。
  gateway: {
    baseUrl: 'https://api.xiaoyxiao.xyz',
    userToken: '',
  },
  image: {
    provider: 'api',
    baseUrl: DEFAULT_IMAGE_API_BASE_URL,
    apiKey: '',
    model: DEFAULT_IMAGE_API_MODEL,
    models: [],
    ratio: '16:9',
    concurrency: 10,
    pricePerImage: 0,
    libtvModel: 'Lib Image',
    libtvProjectUuid: '',
    libtvResolution: '2K',
    libtvQuality: 'medium',
    updreamModel: 'cheap-b-2',
    updreamResolution: '1K',
    updreamQuality: '',
    neowowModel: 'gpt-image-2',
    neowowResolution: '1K',
    neowowQuality: 'low',
    neowowAccountId: '',
    dreaminaModel: '5.0',
    dreaminaResolution: '2k',
    dreaminaSession: '0',
  },
  // 出图风格：realistic(仿真人) | anime(2D) | 3d(3D)
  style: 'realistic',
  // 每个固定风格档位的用户自定义画风描述；为空时使用内置默认。
  stylePrompts: {
    realistic: '',
    anime: '',
    '3d': '',
    elements: {
      character: '',
      group: '',
      scene: '',
      prop: '',
      effect: '',
      creature: '',
    },
  },
  // 元素提取逻辑：custom 为第一套，second 为高颜值强化第二套
  promptTemplate: {
    selectedId: 'custom',
    custom: {
      name: '自定义模板',
      extractionAestheticRules: '',
      characterAestheticGuide: '',
      partDefaults: {},
    },
  },
  // 单次提交给文本模型的字符块大小（应对长篇分块）
  chunkSize: 10000,
  // 元素提取时同时处理几个分块。分块之间靠"已有名字清单"保持命名一致，
  // 并发越高速度越快、但同一对象跨块起不同名字的概率略增；2 是稳妥的默认。
  extractConcurrency: 3,
  // 视频生成配置：Dreamina CLI + LibTV CLI + 小云雀 + UpDream + 通用 API
  video: {
    provider: 'dreamina-cli',
    shotHeaderPrefix: '无字幕无BGM',
    xiaoyunqueModel: 'Seedance_2.0_mini_lite',
    xiaoyunqueAccountId: '',
    dreaminaModel: '',        // Dreamina CLI 模型，留空走 CLI 默认
    dreaminaSession: '0',     // Dreamina CLI session，0 为默认 session
    dreaminaAgentSessionId: '', // 即梦 Agent 官网 sessionid，仅保存在本机
    dreaminaAgentAccounts: [], // 即梦 Agent 多账号；每个账号使用独立 Edge 资料目录
    dreaminaAgentAccountId: '', // 当前默认即梦 Agent 账号
    dreaminaAgentHeadless: false, // 即梦 Agent 生成时在后台运行；手动登录仍显示窗口
    dreaminaAgentPromptPreset: 'standard', // 即梦 Agent 固定开头：standard / fast
    dreaminaAgentShotIntervalSeconds: 80, // 即梦 Agent 相邻分镜发送间隔
    libtvModel: 'Seedance 2.0 VIP',
    libtvProjectUuid: '',
    libtvConcurrency: 3,
    updreamBaseUrl: 'https://www.updream.cn/api',
    updreamAccessToken: '',
    updreamRefreshToken: '',
    updreamModel: 'sed2-fast',
    updreamConcurrency: 2,
    neowowBaseUrl: 'https://neowow.cn',
    neowowToken: '',
    neowowAccounts: [],
    neowowAccountId: '',
    neowowModel: 'neo-video-2-0-fast',
    neowowConcurrency: 15,
    neowowAttachActivityVideo: false,
    comfyuiBaseUrl: '',
    comfyuiWorkflow: 'workflows/U视频-MINIMAX-H3/U09-Minimax-H3二采重绘-秒变清晰-超高一致性-效率起飞wuwukasi.json',
    comfyuiWorkflowPreset: 'u09',
    comfyuiConcurrency: 1,
    apiBaseUrl: DEFAULT_VIDEO_API_BASE_URL,
    apiProtocol: VIDEO_API_PROTOCOL_NEW_API,
    apiKey: '',
    // ⚠️ 必须用网关(api.xiaoyxiao.xyz)真实注册的视频模型名。
    // 这里曾误用 DEFAULT_BUILT_IN_VIDEO_API_MODEL('sd-720p')，而 sd-720p 属于
    // shafu.it.com 那条内置渠道的命名体系，网关没有 → 新装客户端一律报
    // "No available channel for model sd-720p under group default"。
    apiModel: DEFAULT_VIDEO_GATEWAY_API_MODEL,
    // 出厂默认走「免费图床」。内置网关(api.xiaoyxiao.xyz)的上游只收公网 http(s) 图片，
    // provider='none' 时参考图会被内联成 base64，上游直接 400
    // （{"error":"\"image_urls\" must be a public http(s) URL"}）。
    // 没有 COS/OSS 的用户靠这一档开箱即用；有自己图床的在「设置 → 图床」里切过去即可。
    imageUpload: {
      provider: 'free',
      freeProvider: 'auto',
      freeExpiry: '24h',
      imgbbApiKey: '',
      endpoint: '',
      customFileField: 'file',
      customUrlPath: '',
      customAuthHeader: 'Authorization',
      customAuthScheme: 'Bearer',
      customToken: '',
      bucket: '',
      region: '',
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: '',
      publicBaseUrl: '',
      pathPrefix: 'video-api',
      signedUrlTtlHours: 24,
    },
    aspectRatio: '16:9',
    resolution: '720p',
    videoMode: 'mention',
    // Default shot duration used by storyboard recognition and timeline.
    duration: 15,
    pricePerSecond: 0,
    upstreamAccessToken: '',
    upstreamUserId: '',
    upstreamBaseUrl: 'https://rolldek.com',
    // 飞拓跨界消费账本（video-ledger）的网页会话 Cookie，用于账单对账；任务状态查询走 API Key 不需要它
    feituoLedgerCookie: '',
    // 肖像保护绕过：提交视频前对本地参考图做左右镜像拼接，破坏人脸识别特征匹配
    // （Dreamina Seedance 等「只支持生成包含您自己的视频」审核的绕行方案）
    portraitBypass: false,
    xiaoyunqueAccounts: [],   // 独立小云雀 CLI/API access key
  },
  // 剪映配置
  jianying: {
    draftDir: '',            // 剪映草稿目录，为空时自动检测
  },
  // 全局提示词库：剧本/分镜自定义提示词集中管理，项目内仅选择
  promptLibrary: {
    scriptPrompts: [],       // [{ id, name, content }]
    storyboardPrompts: [],   // [{ id, name, content }]
  },
  appearance: {
    theme: 'dark',
    uiScale: 1,
  },
  generationSafety: {
    videoGuardEnabled: false,
    videoGuardSeconds: 10,
  },
  performance: {
    hardwareAcceleration: true,
    reduceMotion: false,
    // 低配流畅模式：true/false 为用户显式选择；null 表示未设置，由前端按机器配置自动判断
    liteMode: null,
  },
  costTracking: {
    currency: 'CNY',
    monthlyBudget: 0,
  },

};

const UI_THEME_VALUES = new Set(['dark', 'light', 'system']);

function normalizeAppearance(appearance = {}) {
  const theme = String(appearance?.theme || '').trim().toLowerCase();
  return {
    theme: UI_THEME_VALUES.has(theme) ? theme : DEFAULT_CONFIG.appearance.theme,
    uiScale: normalizeNumber(appearance?.uiScale, DEFAULT_CONFIG.appearance.uiScale, .85, 1.5),
  };
}

const TEXT_MAX_TOKENS_MIN = 1;
const TEXT_MAX_TOKENS_MAX = 1000000;
const IMAGE_CONCURRENCY_MIN = 1;
const IMAGE_CONCURRENCY_MAX = 50;
const TRANSIENT_STORAGE_PATHS = new Set([
  'electron',
  'temp',
  'logs',
  'data/.app-window',
  'data/.logs',
]);

function copyPathPreservingNewest(source, destination, shouldCopy = () => true) {
  if (!fs.existsSync(source)) return;
  if (!shouldCopy(source)) return;
  const sourceStat = fs.statSync(source);
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyPathPreservingNewest(path.join(source, entry.name), path.join(destination, entry.name), shouldCopy);
    }
    return;
  }
  if (!sourceStat.isFile()) return;
  const destinationStat = fs.existsSync(destination) ? fs.statSync(destination) : null;
  if (destinationStat?.isDirectory()) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  if (destinationStat?.isFile() && destinationStat.mtimeMs >= sourceStat.mtimeMs) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

// A user-initiated storage move makes the current root authoritative.  The
// legacy migration path above intentionally preserves newer destination files,
// but that rule can leave a stale/empty config in a folder the user just chose.
function copyPathReplacing(source, destination, shouldCopy = () => true) {
  if (!fs.existsSync(source)) return;
  if (!shouldCopy(source)) return;
  const sourceStat = fs.statSync(source);
  if (sourceStat.isDirectory()) {
    if (fs.existsSync(destination) && !fs.statSync(destination).isDirectory()) {
      fs.rmSync(destination, { force: true });
    }
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyPathReplacing(path.join(source, entry.name), path.join(destination, entry.name), shouldCopy);
    }
    return;
  }
  if (!sourceStat.isFile()) return;
  if (fs.existsSync(destination) && fs.statSync(destination).isDirectory()) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function normalizeNumber(value, fallback, min = 0, max = Number.POSITIVE_INFINITY) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeInteger(value, fallback, min = 1, max = Number.POSITIVE_INFINITY) {
  return Math.floor(normalizeNumber(value, fallback, min, max));
}

function normalizeStringList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function normalizeGateway(gateway = {}) {
  return {
    baseUrl: normalizeApiBaseUrl(gateway?.baseUrl, 'https://api.xiaoyxiao.xyz'),
    userToken: String(gateway?.userToken || '').trim(),
  };
}

// 网关用户令牌作为文本/图片/视频三端的统一 API Key 兜底：仅当用户没有单独填写时才注入，
// 只在 loadConfig 内存态生效，不回写 config.json（避免把令牌复制进各个渠道字段）。
function applyGatewayFallback(cfg) {
  const token = String(cfg?.gateway?.userToken || '').trim();
  if (!token) return;
  if (cfg.text && !String(cfg.text.apiKey || '').trim()) cfg.text.apiKey = token;
  const applyToChannelList = (channels) => {
    if (!Array.isArray(channels)) return;
    for (const channel of channels) {
      if (!String(channel?.apiKey || '').trim()) channel.apiKey = token;
    }
  };
  if (cfg.image) {
    applyToChannelList(cfg.image.channels);
    if (!String(cfg.image.apiKey || '').trim()) cfg.image.apiKey = token;
  }
  if (cfg.video) {
    applyToChannelList(cfg.video.apiChannels);
    if (!String(cfg.video.apiKey || '').trim()) cfg.video.apiKey = token;
  }
}

// Dreamina CLI session：应是 0~999 量级的小整数字符串。
// 旧版用 el-input-number 绑定字符串曾把它污染成 9007199254740991(MAX_SAFE_INTEGER)，这里归一化清理。
function normalizeSession(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) return '0';
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 999) return '0';
  return String(n);
}

const DEFAULT_DREAMINA_AGENT_ACCOUNT_ID = 'dreamina-agent-default';

export function normalizeDreaminaAgentAccounts(video = {}) {
  const rawAccounts = Array.isArray(video.dreaminaAgentAccounts) ? video.dreaminaAgentAccounts : [];
  const accounts = [];
  const usedIds = new Set();
  const usedSessions = new Set();
  for (const [index, raw] of rawAccounts.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const fallbackId = `dreamina-agent-${index + 1}`;
    const rawId = String(raw.id || fallbackId).trim();
    const id = /^[A-Za-z0-9_-]{3,80}$/.test(rawId) ? rawId : fallbackId;
    if (usedIds.has(id)) continue;
    const sessionId = String(raw.sessionId || raw.sessionid || '').trim().slice(0, 1024);
    if (sessionId && usedSessions.has(sessionId)) continue;
    usedIds.add(id);
    if (sessionId) usedSessions.add(sessionId);
    accounts.push({
      id,
      name: String(raw.name || `即梦账号 ${accounts.length + 1}`).trim().slice(0, 40) || `即梦账号 ${accounts.length + 1}`,
      sessionId,
      profileKey: raw.profileKey === 'legacy' ? 'legacy' : id,
      addedAt: String(raw.addedAt || '').trim() || new Date(0).toISOString(),
    });
  }

  if (!accounts.length) {
    accounts.push({
      id: DEFAULT_DREAMINA_AGENT_ACCOUNT_ID,
      name: '默认账号',
      sessionId: String(video.dreaminaAgentSessionId || '').trim().slice(0, 1024),
      profileKey: 'legacy',
      addedAt: new Date(0).toISOString(),
    });
  }

  const requestedId = String(video.dreaminaAgentAccountId || '').trim();
  const selected = accounts.find((account) => account.id === requestedId) || accounts[0];
  return {
    dreaminaAgentAccounts: accounts,
    dreaminaAgentAccountId: selected.id,
    // Keep the legacy field synchronized for older builds that may still read it.
    dreaminaAgentSessionId: selected.sessionId,
  };
}

const LEGACY_VIDEO_CONFIG_KEYS = [
  'site',
  'headless',
  'concurrency',
  'model',
  'mode',
  'submitStaggerMs',
  'miniConcurrencyPerAccount',
  'accounts',
  'model2',
  'jimengConcurrentModel',
  'jimengConcurrentSessionid',
  'jimengConcurrentPluginDir',
  'jimengConcurrentPythonPath',
  'jimengConcurrentConcurrency',
];

function stripLegacyVideoConfig(video = {}) {
  for (const key of LEGACY_VIDEO_CONFIG_KEYS) delete video[key];
  return video;
}

function normalizeVideoProvider(provider) {
  if (provider === 'video-api') return 'video-api';
  if (provider === 'neowow') return 'neowow';
  if (provider === 'updream') return 'updream';
  if (provider === 'libtv-cli') return 'libtv-cli';
  if (provider === 'dreamina-agent') return 'dreamina-agent';
  return provider === 'xiaoyunque' ? 'xiaoyunque' : 'dreamina-cli';
}

export function normalizeDreaminaAgentPromptPreset(value) {
  return String(value || '').trim().toLowerCase() === 'fast' ? 'fast' : 'standard';
}

export function normalizeDreaminaAgentShotIntervalSeconds(value) {
  return normalizeInteger(value, 80, 10, 3600);
}

function normalizeImageProvider(provider) {
  if (provider === 'libtv-cli') return 'libtv-cli';
  if (provider === 'dreamina-cli') return 'dreamina-cli';
  if (provider === 'updream') return 'updream';
  if (provider === 'neowow') return 'neowow';
  if (provider === 'comfyui') return 'comfyui';
  return 'api';
}

function normalizeGenerationSafety(safety = {}) {
  return {
    videoGuardEnabled: (safety?.videoGuardEnabled ?? safety?.storyboardGuardEnabled) === true,
    videoGuardSeconds: normalizeInteger(
      safety?.videoGuardSeconds ?? safety?.storyboardGuardSeconds,
      DEFAULT_CONFIG.generationSafety.videoGuardSeconds,
      1,
      120,
    ),
  };
}

function normalizeDreaminaImageModel(model) {
  const value = String(model || '').trim();
  return ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro'].includes(value) ? value : '5.0';
}

function normalizeDreaminaImageResolution(resolution, model = '5.0') {
  const value = String(resolution || '').trim().toLowerCase();
  const allowed = model === '5.0Pro' ? ['1k', '2k', '4k'] : (['3.0', '3.1'].includes(model) ? ['1k', '2k'] : ['2k', '4k']);
  return allowed.includes(value) ? value : allowed[0];
}

function normalizeUpdreamModel(model) {
  const value = String(model || '').trim();
  if (['wan3.0-video', 'wan3.0', 'wan_3.0', 'Wan 3.0'].includes(value)) return 'wan-3.0';
  return ['sed2-fast', 'sed2', 'sed2-5', 'hailuo-h3', 'wan-3.0'].includes(value) ? value : 'sed2-fast';
}

function normalizeNeowowModel(model) {
  const value = String(model || '').trim();
  return [
    'neo-video-2-0',
    'neo-video-2-0-fast',
    'doubao-seedance-2-0-mini-260615',
    'doubao-seedance-2-5-260628',
    'MiniMax-H3',
    'wan3.0-video',
  ].includes(value)
    ? value
    : (['wan-3.0', 'wan3.0', 'wan_3.0'].includes(value) ? 'wan3.0-video' : 'neo-video-2-0-fast');
}

function normalizeLibtvModel(model) {
  return normalizeLibtvVideoModelName(model, DEFAULT_CONFIG.video.libtvModel);
}

function normalizeVideoApiModel(model) {
  return String(model ?? DEFAULT_CONFIG.video.apiModel).trim();
}

function normalizeVideoApiBaseUrl(baseUrl) {
  return String(baseUrl ?? DEFAULT_CONFIG.video.apiBaseUrl).trim();
}

function defaultVideoResolution(provider) {
  return ['updream', 'neowow'].includes(normalizeVideoProvider(provider)) ? '480p' : '720p';
}

function normalizeVideoResolution(resolution, provider) {
  const value = String(resolution || '').trim().toLowerCase();
  return ['480p', '720p', '768p', '1080p', '2k', '4k'].includes(value)
    ? value
    : defaultVideoResolution(provider);
}

function normalizeShotHeaderPrefix(value) {
  return String(value ?? DEFAULT_CONFIG.video.shotHeaderPrefix).trim().slice(0, 4000);
}

function normalizeVideoMode(value) {
  return value === 'label' || value === 'mention_label' ? 'label' : 'mention';
}

const VIDEO_DURATION_MIN = 5;
const VIDEO_DURATION_MAX = 500;

function normalizeVideoDuration(value, fallback = DEFAULT_CONFIG.video.duration) {
  return normalizeInteger(value, fallback, VIDEO_DURATION_MIN, VIDEO_DURATION_MAX);
}

function normalizeTextEndpoints(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const baseUrl = normalizeApiBaseUrl(raw.baseUrl, '');
    const apiKey = String(raw.apiKey || '').trim();
    // 至少要有一个 baseUrl 或 apiKey 才保留；空壳条目直接丢弃避免 UI 留空白行
    if (!baseUrl && !apiKey) return;
    const key = `${baseUrl}::${apiKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name: String(raw.name || '').trim(),
      baseUrl,
      apiKey,
      model: String(raw.model || '').trim(),
    });
  });
  return out;
}

function mergeTextConfig(parsed = {}) {
  const text = parsed.text || {};
  const legacyScript = parsed.script || {};
  return {
    ...DEFAULT_CONFIG.text,
    ...text,
    baseUrl: normalizeApiBaseUrl(text.baseUrl, DEFAULT_CONFIG.text.baseUrl),
    models: normalizeStringList(text.models),
    temperature: normalizeNumber(
      text.temperature ?? legacyScript.temperature,
      DEFAULT_CONFIG.text.temperature,
      0,
      2
    ),
    maxTokens: normalizeInteger(
      text.maxTokens ?? legacyScript.maxTokens,
      DEFAULT_CONFIG.text.maxTokens,
      TEXT_MAX_TOKENS_MIN,
      TEXT_MAX_TOKENS_MAX
    ),
    endpoints: normalizeTextEndpoints(text.endpoints),
    rotationStrategy: text.rotationStrategy === 'failover' ? 'failover' : 'off',
  };
}

function normalizeTextModelRouting(value = {}, legacyText = {}) {
  const profiles = Array.isArray(value.profiles)
    ? value.profiles.map((profile) => ({
      ...profile,
      baseUrl: normalizeApiBaseUrl(profile?.baseUrl, legacyText.baseUrl),
    }))
    : value.profiles;
  return normalizeModelRouting({ ...value, profiles }, legacyText);
}

function normalizePromptList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(item.name || '').trim(),
      content: String(item.content || ''),
    });
  }
  return out;
}

function normalizePromptLibrary(lib = {}) {
  return {
    scriptPrompts: normalizePromptList(lib.scriptPrompts),
    storyboardPrompts: normalizePromptList(lib.storyboardPrompts),
  };
}

function mergeImageConfig(image = {}) {
  return normalizeImageChannels({
    ...DEFAULT_CONFIG.image,
    ...image,
    baseUrl: normalizeImageApiBaseUrl(image.baseUrl, DEFAULT_CONFIG.image.baseUrl),
    provider: normalizeImageProvider(image.provider),
    libtvModel: String(image.libtvModel || DEFAULT_CONFIG.image.libtvModel).trim(),
    libtvProjectUuid: String(image.libtvProjectUuid || '').trim(),
    libtvResolution: ['1K', '2K', '4K'].includes(String(image.libtvResolution || '').trim())
      ? String(image.libtvResolution).trim()
      : DEFAULT_CONFIG.image.libtvResolution,
    libtvQuality: ['low', 'medium', 'high'].includes(String(image.libtvQuality || '').trim())
      ? String(image.libtvQuality).trim()
      : DEFAULT_CONFIG.image.libtvQuality,
    updreamModel: String(image.updreamModel || DEFAULT_CONFIG.image.updreamModel).trim(),
    updreamResolution: String(image.updreamResolution ?? DEFAULT_CONFIG.image.updreamResolution).trim(),
    updreamQuality: String(image.updreamQuality ?? DEFAULT_CONFIG.image.updreamQuality).trim(),
    neowowModel: String(image.neowowModel || DEFAULT_CONFIG.image.neowowModel).trim(),
    neowowResolution: ['1K', '2K', '3K', '4K'].includes(String(image.neowowResolution || '').trim().toUpperCase())
      ? String(image.neowowResolution).trim().toUpperCase()
      : DEFAULT_CONFIG.image.neowowResolution,
    neowowQuality: ['low', 'medium', 'high'].includes(String(image.neowowQuality || '').trim().toLowerCase())
      ? String(image.neowowQuality).trim().toLowerCase()
      : DEFAULT_CONFIG.image.neowowQuality,
    neowowAccountId: String(image.neowowAccountId || '').trim(),
    dreaminaModel: normalizeDreaminaImageModel(image.dreaminaModel ?? DEFAULT_CONFIG.image.dreaminaModel),
    dreaminaResolution: normalizeDreaminaImageResolution(
      image.dreaminaResolution ?? DEFAULT_CONFIG.image.dreaminaResolution,
      normalizeDreaminaImageModel(image.dreaminaModel ?? DEFAULT_CONFIG.image.dreaminaModel),
    ),
    dreaminaSession: String(image.dreaminaSession ?? DEFAULT_CONFIG.image.dreaminaSession).trim().replace(/[^0-9]/g, '').slice(0, 3) || '0',
    concurrency: normalizeInteger(
      image.concurrency,
      DEFAULT_CONFIG.image.concurrency,
      IMAGE_CONCURRENCY_MIN,
      IMAGE_CONCURRENCY_MAX
    ),
    pricePerImage: normalizeNumber(image.pricePerImage, DEFAULT_CONFIG.image.pricePerImage, 0, 1000000),
  });
}

function pathsEqual(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function pathContains(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function copyStorageEntries(sourceRoot, destinationRoot, { overwrite = false } = {}) {
  if (!sourceRoot || !fs.existsSync(sourceRoot) || pathsEqual(sourceRoot, destinationRoot)) return true;
  if (pathContains(sourceRoot, destinationRoot) || pathContains(destinationRoot, sourceRoot)) return false;
  try {
    const copyPath = overwrite ? copyPathReplacing : copyPathPreservingNewest;
    const shouldCopy = (source) => {
      const relative = path.relative(sourceRoot, source).split(path.sep).join('/');
      return ![...TRANSIENT_STORAGE_PATHS].some((transient) => relative === transient || relative.startsWith(`${transient}/`));
    };
    // The storage root is entirely user-owned. Copy every entry so a new
    // release cannot silently drop a directory added by a later feature.
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      copyPath(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name), shouldCopy);
    }
    return true;
  } catch (error) {
    console.error(`Failed to preserve storage from ${sourceRoot}:`, error.message);
    return false;
  }
}

function clearUpdateBackup() {
  try { fs.rmSync(UPDATE_BACKUP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(UPDATE_BACKUP_META_PATH, { force: true }); } catch { /* best effort */ }
}

// Keep a copy outside the application storage root before an installer starts.
// This is an independent recovery path for old uninstallers that remove more
// than the program directory during an in-place update.
export function backupStorageForUpdate() {
  if (String(process.env.GG_STORAGE_ROOT || '').trim()) return { backedUp: false, reason: 'explicit-storage-root' };
  const staging = `${UPDATE_BACKUP_DIR}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!copyStorageEntries(USER_APP_DIR, staging, { overwrite: true })) {
      throw new Error('Failed to copy the current user storage.');
    }
    writeJsonAtomic(UPDATE_BACKUP_META_PATH, {
      format: 'gg-update-storage-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      sourceRoot: USER_APP_DIR,
    });
    fs.rmSync(UPDATE_BACKUP_DIR, { recursive: true, force: true });
    fs.renameSync(staging, UPDATE_BACKUP_DIR);
    return { backedUp: true, path: UPDATE_BACKUP_DIR };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`Failed to protect user data before update: ${error.message}`);
  }
}

function restoreStorageBackup() {
  if (String(process.env.GG_STORAGE_ROOT || '').trim()) return true;
  if (!fs.existsSync(UPDATE_BACKUP_META_PATH) || !fs.existsSync(UPDATE_BACKUP_DIR)) return true;
  try {
    const metadata = JSON.parse(fs.readFileSync(UPDATE_BACKUP_META_PATH, 'utf8').replace(/^\uFEFF/, ''));
    if (metadata?.format !== 'gg-update-storage-backup' || Number(metadata.version) !== 1) return false;
    if (!copyStorageEntries(UPDATE_BACKUP_DIR, USER_APP_DIR)) return false;
    clearUpdateBackup();
    return true;
  } catch (error) {
    console.error('Failed to restore the pre-update user storage backup:', error.message);
    return false;
  }
}

function writeStorageLocator(rootPath) {
  try {
    STORAGE_LOCATOR = {
      rootPath: path.resolve(rootPath),
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(STORAGE_LOCATOR_PATH, STORAGE_LOCATOR);
    STORAGE_LOCATOR_SOURCE_PATH = STORAGE_LOCATOR_PATH;
    return true;
  } catch (error) {
    console.error('Failed to save the stable storage location:', error.message);
    return false;
  }
}

function persistStorageLocator() {
  if (String(process.env.GG_STORAGE_ROOT || '').trim()) return true;
  if (LOCATED_INSTALL_STORAGE_ROOT) return writeStorageLocator(USER_APP_DIR);
  if (STORAGE_LOCATOR_SOURCE_PATH && pathsEqual(STORAGE_LOCATOR_SOURCE_PATH, STORAGE_LOCATOR_PATH)) {
    const locatedRoot = STORAGE_LOCATOR?.rootPath ? normalizeStorageRoot(STORAGE_LOCATOR.rootPath) : null;
    if (locatedRoot && !pathsEqual(locatedRoot, INSTALL_STORAGE_ROOT)) {
      return true;
    }
  }
  return writeStorageLocator(USER_APP_DIR);
}

function migrateLegacyStorage() {
  // An explicit root is authoritative (tests, managed deployments and portable
  // launches rely on isolation from every automatically discovered data source).
  if (String(process.env.GG_STORAGE_ROOT || '').trim()) return;
  // v5 adds the custom desktop-pet directory to the migration set. Keeping a
  // new marker makes existing installs that already completed v4 run this
  // preservation pass once as well.
  const marker = path.join(STATE_DIR, 'storage-migration-v5.json');
  const locatorPersisted = persistStorageLocator();
  if (fs.existsSync(marker) && locatorPersisted && !LOCATED_INSTALL_STORAGE_ROOT) return;
  let complete = locatorPersisted;

  // Version 1.0.1 stored data beside the executable. Copy it out without ever
  // deleting the source so interrupted upgrades still leave a recovery copy.
  complete = copyStorageEntries(LOCATED_INSTALL_STORAGE_ROOT, USER_APP_DIR) && complete;
  complete = copyStorageEntries(INSTALL_STORAGE_ROOT, USER_APP_DIR) && complete;
  complete = copyStorageEntries(LEGACY_INSTALL_STORAGE_ROOT, USER_APP_DIR) && complete;
  complete = copyStorageEntries(OLD_USER_APP_DIR, USER_APP_DIR) && complete;
  complete = copyStorageEntries(LEGACY_USER_APP_DIR, path.join(USER_APP_DIR, 'legacy', 'NovelElementExtractor')) && complete;

  try {
    copyPathPreservingNewest(LEGACY_CONFIG_PATH, CONFIG_PATH);
    copyPathPreservingNewest(LEGACY_DATA_DIR, DATA_DIR);
  } catch (error) {
    complete = false;
    console.error('Failed to preserve legacy data beside the app:', error.message);
  }

  try {
    copyPathPreservingNewest(path.join(LEGACY_LICENSE_DIR, 'license.json'), path.join(LICENSE_DIR, 'license.json'));
    copyPathPreservingNewest(LEGACY_LICENSE_DIR, path.join(ELECTRON_DATA_DIR, 'user-data'));
  } catch (error) {
    complete = false;
    console.error('Failed to preserve the legacy license and Electron profile:', error.message);
  }

  if (!complete) return;
  try {
    writeJsonAtomic(marker, {
      migratedAt: new Date().toISOString(),
      storageRoot: USER_APP_DIR,
      sourceLocator: STORAGE_LOCATOR_SOURCE_PATH || null,
      sourcesPreserved: true,
    });
  } catch (error) {
    console.error('Failed to write the storage migration marker:', error.message);
  }
}


export function ensureUserPaths() {
  for (const directory of [USER_APP_DIR, DATA_DIR, STATE_DIR, LOG_DIR, TEMP_DIR, LICENSE_DIR, ELECTRON_DATA_DIR]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  restoreStorageBackup();
  migrateLegacyStorage();
}

export function getStorageInfo() {
  return {
    rootPath: USER_APP_DIR,
    defaultRootPath: path.resolve(DEFAULT_STORAGE_ROOT),
    installDir: INSTALL_DIR,
    isDefault: pathsEqual(USER_APP_DIR, DEFAULT_STORAGE_ROOT),
    locatorPath: STORAGE_LOCATOR_PATH,
    restartRequired: false,
  };
}

function verifyWritableDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.gg-write-test-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, 'ok', 'utf8');
  fs.rmSync(probe, { force: true });
}

export function prepareStorageRootChange(requestedRoot) {
  const targetRoot = normalizeStorageRoot(requestedRoot || DEFAULT_STORAGE_ROOT);
  if (pathsEqual(targetRoot, USER_APP_DIR)) {
    return { ...getStorageInfo(), rootPath: targetRoot, restartRequired: false };
  }
  if (pathContains(USER_APP_DIR, targetRoot) || pathContains(targetRoot, USER_APP_DIR)) {
    throw new Error('The new storage folder must be independent from the current storage folder.');
  }
  if (pathContains(INSTALL_DIR, targetRoot)) {
    throw new Error('The storage folder cannot be inside the application installation folder.');
  }

  try {
    verifyWritableDirectory(targetRoot);
  } catch (error) {
    throw new Error(`The selected folder is not writable: ${error.message}`);
  }

  // Copy persistent business data. Keep the previous root as a recovery copy.
  // The selected folder may contain leftovers from an earlier failed move or
  // a previous installation.  Copy the active root as the source of truth so
  // switching roots cannot silently select an empty/stale config file.
  if (!copyStorageEntries(USER_APP_DIR, targetRoot, { overwrite: true })) {
    throw new Error('Failed to copy the current storage data to the selected folder.');
  }

  for (const name of ['config.json', 'data']) {
    const source = path.join(USER_APP_DIR, name);
    const destination = path.join(targetRoot, name);
    if (fs.existsSync(source) && !fs.existsSync(destination)) {
      throw new Error(`Storage migration did not copy ${name}.`);
    }
  }
  writeJsonAtomic(path.join(targetRoot, '.gg-storage-root.json'), {
    createdAt: new Date().toISOString(),
    previousRoot: USER_APP_DIR,
    rootPath: targetRoot,
  });

  if (!writeStorageLocator(targetRoot)) {
    throw new Error('Failed to save the storage location in AppData.');
  }

  return {
    ...getStorageInfo(),
    rootPath: targetRoot,
    isDefault: pathsEqual(targetRoot, DEFAULT_STORAGE_ROOT),
    restartRequired: true,
    preservedRootPath: USER_APP_DIR,
  };
}

export function createTempDir(prefix = 'gg-') {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  return fs.mkdtempSync(path.join(TEMP_DIR, prefix));
}

ensureUserPaths();

export function loadConfig() {
  ensureUserPaths();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      const dreaminaAgent = normalizeDreaminaAgentAccounts(parsed.video || {});
      // 与默认值做浅合并，保证新增字段有兜底
      const cfg = {
        ...DEFAULT_CONFIG,
        ...parsed,
        gateway: normalizeGateway(parsed?.gateway),
        text: mergeTextConfig(parsed),
        script: {
          ...DEFAULT_CONFIG.script,
          ...(parsed.script || {}),
          baseUrl: normalizeApiBaseUrl(parsed.script?.baseUrl, DEFAULT_CONFIG.script.baseUrl),
        },
        image: mergeImageConfig(parsed.image || {}),
        modelRouting: normalizeTextModelRouting(parsed.modelRouting || {}, mergeTextConfig(parsed)),
        video: normalizeVideoApiChannels({
          ...DEFAULT_CONFIG.video,
          ...(parsed.video || {}),
          provider: normalizeVideoProvider(parsed.video?.provider),
          shotHeaderPrefix: normalizeShotHeaderPrefix(parsed.video?.shotHeaderPrefix),
          xiaoyunqueAccountId: String(parsed.video?.xiaoyunqueAccountId || '').trim(),
          dreaminaSession: normalizeSession(parsed.video?.dreaminaSession),
          ...dreaminaAgent,
          dreaminaAgentHeadless: parsed.video?.dreaminaAgentHeadless === true,
          dreaminaAgentPromptPreset: normalizeDreaminaAgentPromptPreset(parsed.video?.dreaminaAgentPromptPreset),
          dreaminaAgentShotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(parsed.video?.dreaminaAgentShotIntervalSeconds),
          libtvModel: normalizeLibtvModel(parsed.video?.libtvModel),
          libtvProjectUuid: String(parsed.video?.libtvProjectUuid || '').trim(),
          libtvConcurrency: normalizeNumber(parsed.video?.libtvConcurrency, DEFAULT_CONFIG.video.libtvConcurrency, 1, 10),
          updreamBaseUrl: String(parsed.video?.updreamBaseUrl || DEFAULT_CONFIG.video.updreamBaseUrl).trim(),
          updreamAccessToken: String(parsed.video?.updreamAccessToken || '').trim(),
          updreamRefreshToken: String(parsed.video?.updreamRefreshToken || '').trim(),
          updreamModel: normalizeUpdreamModel(parsed.video?.updreamModel),
          updreamConcurrency: normalizeInteger(parsed.video?.updreamConcurrency, DEFAULT_CONFIG.video.updreamConcurrency),
          neowowBaseUrl: String(parsed.video?.neowowBaseUrl || DEFAULT_CONFIG.video.neowowBaseUrl).trim(),
          neowowToken: String(parsed.video?.neowowToken || '').trim(),
          neowowAccounts: Array.isArray(parsed.video?.neowowAccounts) ? parsed.video.neowowAccounts : [],
          neowowAccountId: String(parsed.video?.neowowAccountId || '').trim(),
          neowowModel: normalizeNeowowModel(parsed.video?.neowowModel),
          neowowConcurrency: normalizeInteger(parsed.video?.neowowConcurrency, DEFAULT_CONFIG.video.neowowConcurrency),
          neowowAttachActivityVideo: parsed.video?.neowowAttachActivityVideo === true,
          comfyuiBaseUrl: String(parsed.video?.comfyuiBaseUrl || '').trim(),
          comfyuiWorkflow: String(parsed.video?.comfyuiWorkflow || DEFAULT_CONFIG.video.comfyuiWorkflow).trim(),
          comfyuiWorkflowPreset: String(parsed.video?.comfyuiWorkflowPreset || DEFAULT_CONFIG.video.comfyuiWorkflowPreset).trim(),
          comfyuiConcurrency: normalizeInteger(parsed.video?.comfyuiConcurrency, DEFAULT_CONFIG.video.comfyuiConcurrency, 1, 3),
          apiBaseUrl: normalizeVideoApiBaseUrl(parsed.video?.apiBaseUrl),
          apiModel: normalizeVideoApiModel(parsed.video?.apiModel),
          resolution: normalizeVideoResolution(parsed.video?.resolution, parsed.video?.provider),
          videoMode: normalizeVideoMode(parsed.video?.videoMode),
          duration: normalizeVideoDuration(parsed.video?.duration),
          pricePerSecond: normalizeNumber(parsed.video?.pricePerSecond, DEFAULT_CONFIG.video.pricePerSecond, 0, 1000000),
          upstreamAccessToken: String(parsed.video?.upstreamAccessToken ?? DEFAULT_CONFIG.video.upstreamAccessToken).trim(),
          upstreamUserId: String(parsed.video?.upstreamUserId ?? DEFAULT_CONFIG.video.upstreamUserId).trim(),
          upstreamBaseUrl: String(parsed.video?.upstreamBaseUrl ?? DEFAULT_CONFIG.video.upstreamBaseUrl).trim(),
          feituoLedgerCookie: String(parsed.video?.feituoLedgerCookie ?? DEFAULT_CONFIG.video.feituoLedgerCookie).trim(),
          portraitBypass: parsed.video?.portraitBypass === true,
          xiaoyunqueAccounts: Array.isArray(parsed.video?.xiaoyunqueAccounts) ? parsed.video.xiaoyunqueAccounts : [],
        }),
        extractConcurrency: normalizeInteger(parsed.extractConcurrency, DEFAULT_CONFIG.extractConcurrency, 1, 4),
        style: normalizeImageStyle(parsed.style || DEFAULT_CONFIG.style),
        stylePrompts: normalizeStylePrompts(parsed.stylePrompts || DEFAULT_CONFIG.stylePrompts),
        promptTemplate: normalizePromptTemplateConfig(parsed.promptTemplate || DEFAULT_CONFIG.promptTemplate),
        promptLibrary: normalizePromptLibrary(parsed.promptLibrary || DEFAULT_CONFIG.promptLibrary),
        appearance: normalizeAppearance(parsed.appearance),
        generationSafety: normalizeGenerationSafety(parsed.generationSafety),
        costTracking: {
          ...DEFAULT_CONFIG.costTracking,
          ...(parsed.costTracking || {}),
          currency: String(parsed.costTracking?.currency || DEFAULT_CONFIG.costTracking.currency),
          monthlyBudget: normalizeNumber(parsed.costTracking?.monthlyBudget, 0, 0, 100000000),
        },
        performance: {
          ...DEFAULT_CONFIG.performance,
          ...(parsed.performance || {}),
          hardwareAcceleration: parsed.performance?.hardwareAcceleration !== false,
          reduceMotion: parsed.performance?.reduceMotion === true,
          liteMode: typeof parsed.performance?.liteMode === 'boolean' ? parsed.performance.liteMode : null,
        },
      };
      applyGatewayFallback(cfg);
      stripLegacyVideoConfig(cfg.video);
      return cfg;
    }
  } catch (e) {
    console.error('读取 config.json 失败，使用默认配置：', e.message);
  }
  return {
    ...DEFAULT_CONFIG,
    text: mergeTextConfig(DEFAULT_CONFIG),
    image: mergeImageConfig(DEFAULT_CONFIG.image),
    modelRouting: normalizeTextModelRouting(DEFAULT_CONFIG.modelRouting, mergeTextConfig(DEFAULT_CONFIG)),
    video: normalizeVideoApiChannels({
      ...DEFAULT_CONFIG.video,
      ...normalizeDreaminaAgentAccounts(DEFAULT_CONFIG.video),
      duration: normalizeVideoDuration(DEFAULT_CONFIG.video.duration),
    }),
  };
}

export function saveConfig(cfg) {
  ensureUserPaths();
  const current = loadConfig();
  const dreaminaAgent = normalizeDreaminaAgentAccounts({
    ...current.video,
    ...(cfg.video || {}),
  });
  const merged = {
    ...current,
    ...cfg,
    text: mergeTextConfig({ text: { ...current.text, ...(cfg.text || {}) } }),
    image: mergeImageConfig({ ...current.image, ...(cfg.image || {}) }),
    modelRouting: normalizeTextModelRouting(cfg.modelRouting || current.modelRouting || {}, mergeTextConfig({ text: { ...current.text, ...(cfg.text || {}) } })),
    video: normalizeVideoApiChannels({
      ...current.video,
      ...(cfg.video || {}),
      provider: normalizeVideoProvider((cfg.video || {}).provider ?? current.video?.provider),
      shotHeaderPrefix: normalizeShotHeaderPrefix((cfg.video || {}).shotHeaderPrefix ?? current.video?.shotHeaderPrefix),
      xiaoyunqueAccountId: String((cfg.video || {}).xiaoyunqueAccountId ?? current.video?.xiaoyunqueAccountId ?? '').trim(),
      dreaminaSession: normalizeSession((cfg.video || {}).dreaminaSession ?? current.video?.dreaminaSession),
      ...dreaminaAgent,
      dreaminaAgentHeadless: ((cfg.video || {}).dreaminaAgentHeadless ?? current.video?.dreaminaAgentHeadless) === true,
      dreaminaAgentPromptPreset: normalizeDreaminaAgentPromptPreset(
        (cfg.video || {}).dreaminaAgentPromptPreset ?? current.video?.dreaminaAgentPromptPreset,
      ),
      dreaminaAgentShotIntervalSeconds: normalizeDreaminaAgentShotIntervalSeconds(
        (cfg.video || {}).dreaminaAgentShotIntervalSeconds ?? current.video?.dreaminaAgentShotIntervalSeconds,
      ),
      libtvModel: normalizeLibtvModel((cfg.video || {}).libtvModel ?? current.video?.libtvModel),
      libtvProjectUuid: String((cfg.video || {}).libtvProjectUuid ?? current.video?.libtvProjectUuid ?? '').trim(),
      libtvConcurrency: normalizeNumber((cfg.video || {}).libtvConcurrency ?? current.video?.libtvConcurrency, DEFAULT_CONFIG.video.libtvConcurrency, 1, 10),
      updreamBaseUrl: String((cfg.video || {}).updreamBaseUrl ?? current.video?.updreamBaseUrl ?? DEFAULT_CONFIG.video.updreamBaseUrl).trim(),
      updreamAccessToken: String((cfg.video || {}).updreamAccessToken ?? current.video?.updreamAccessToken ?? '').trim(),
      updreamRefreshToken: String((cfg.video || {}).updreamRefreshToken ?? current.video?.updreamRefreshToken ?? '').trim(),
      updreamModel: normalizeUpdreamModel((cfg.video || {}).updreamModel ?? current.video?.updreamModel),
      updreamConcurrency: normalizeInteger((cfg.video || {}).updreamConcurrency ?? current.video?.updreamConcurrency, DEFAULT_CONFIG.video.updreamConcurrency),
      neowowBaseUrl: String((cfg.video || {}).neowowBaseUrl ?? current.video?.neowowBaseUrl ?? DEFAULT_CONFIG.video.neowowBaseUrl).trim(),
      neowowToken: String((cfg.video || {}).neowowToken ?? current.video?.neowowToken ?? '').trim(),
      neowowAccounts: Array.isArray((cfg.video || {}).neowowAccounts)
        ? (cfg.video || {}).neowowAccounts
        : (current.video?.neowowAccounts || []),
      neowowAccountId: String((cfg.video || {}).neowowAccountId ?? current.video?.neowowAccountId ?? '').trim(),
      neowowModel: normalizeNeowowModel((cfg.video || {}).neowowModel ?? current.video?.neowowModel),
      neowowConcurrency: normalizeInteger((cfg.video || {}).neowowConcurrency ?? current.video?.neowowConcurrency, DEFAULT_CONFIG.video.neowowConcurrency),
      neowowAttachActivityVideo: ((cfg.video || {}).neowowAttachActivityVideo ?? current.video?.neowowAttachActivityVideo) === true,
      comfyuiBaseUrl: String((cfg.video || {}).comfyuiBaseUrl ?? current.video?.comfyuiBaseUrl ?? '').trim(),
      comfyuiWorkflow: String((cfg.video || {}).comfyuiWorkflow ?? current.video?.comfyuiWorkflow ?? DEFAULT_CONFIG.video.comfyuiWorkflow).trim(),
      comfyuiWorkflowPreset: String((cfg.video || {}).comfyuiWorkflowPreset ?? current.video?.comfyuiWorkflowPreset ?? DEFAULT_CONFIG.video.comfyuiWorkflowPreset).trim(),
      comfyuiConcurrency: normalizeInteger((cfg.video || {}).comfyuiConcurrency ?? current.video?.comfyuiConcurrency, DEFAULT_CONFIG.video.comfyuiConcurrency, 1, 3),
      apiBaseUrl: normalizeVideoApiBaseUrl((cfg.video || {}).apiBaseUrl ?? current.video?.apiBaseUrl),
      apiModel: normalizeVideoApiModel((cfg.video || {}).apiModel ?? current.video?.apiModel),
      resolution: normalizeVideoResolution(
        (cfg.video || {}).resolution ?? current.video?.resolution,
        (cfg.video || {}).provider ?? current.video?.provider,
      ),
      videoMode: normalizeVideoMode((cfg.video || {}).videoMode ?? current.video?.videoMode),
      duration: normalizeVideoDuration(
        (cfg.video || {}).duration ?? current.video?.duration,
        current.video?.duration ?? DEFAULT_CONFIG.video.duration,
      ),
      pricePerSecond: normalizeNumber((cfg.video || {}).pricePerSecond ?? current.video?.pricePerSecond, DEFAULT_CONFIG.video.pricePerSecond, 0, 1000000),
      upstreamAccessToken: String((cfg.video || {}).upstreamAccessToken ?? current.video?.upstreamAccessToken ?? '').trim(),
      upstreamUserId: String((cfg.video || {}).upstreamUserId ?? current.video?.upstreamUserId ?? '').trim(),
      feituoLedgerCookie: String((cfg.video || {}).feituoLedgerCookie ?? current.video?.feituoLedgerCookie ?? '').trim(),
      upstreamBaseUrl: String((cfg.video || {}).upstreamBaseUrl ?? current.video?.upstreamBaseUrl ?? 'https://rolldek.com').trim(),
      xiaoyunqueAccounts: Array.isArray(cfg.video?.xiaoyunqueAccounts)
        ? cfg.video.xiaoyunqueAccounts
        : (current.video?.xiaoyunqueAccounts || []),
    }),
    style: normalizeImageStyle(cfg.style ?? current.style),
    stylePrompts: normalizeStylePrompts(cfg.stylePrompts || current.stylePrompts),
    promptTemplate: normalizePromptTemplateConfig(cfg.promptTemplate || current.promptTemplate),
    promptLibrary: normalizePromptLibrary(cfg.promptLibrary || current.promptLibrary),
    appearance: normalizeAppearance(cfg.appearance || current.appearance),
    generationSafety: normalizeGenerationSafety(cfg.generationSafety || current.generationSafety),
    costTracking: {
      ...DEFAULT_CONFIG.costTracking,
      ...(current.costTracking || {}),
      ...(cfg.costTracking || {}),
      currency: String(cfg.costTracking?.currency ?? current.costTracking?.currency ?? DEFAULT_CONFIG.costTracking.currency),
      monthlyBudget: normalizeNumber(cfg.costTracking?.monthlyBudget ?? current.costTracking?.monthlyBudget, 0, 0, 100000000),
    },
    performance: {
      ...DEFAULT_CONFIG.performance,
      ...(current.performance || {}),
      ...(cfg.performance || {}),
      hardwareAcceleration: (cfg.performance?.hardwareAcceleration ?? current.performance?.hardwareAcceleration) !== false,
      reduceMotion: (cfg.performance?.reduceMotion ?? current.performance?.reduceMotion) === true,
      liteMode: typeof (cfg.performance?.liteMode ?? current.performance?.liteMode) === 'boolean'
        ? (cfg.performance?.liteMode ?? current.performance?.liteMode)
        : null,
    },
  };
  stripLegacyVideoConfig(merged.video);
  delete merged.script;
  writeJsonAtomic(CONFIG_PATH, merged);
  return merged;
}

// 解析 ffmpeg 可执行文件路径：
//   - 打包后(electron asar)：用捆绑在 resources/ffmpeg/ffmpeg.exe 的完整版
//   - 开发态：用 vendor/ffmpeg/ffmpeg.exe（仓库自带）
//   - 都没有则回退系统 PATH 的 'ffmpeg'
let _cachedFfmpegPath = null;
export function ffmpegPath() {
  if (_cachedFfmpegPath) return _cachedFfmpegPath;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [];
  // 打包后 __dirname 形如 .../resources/app.asar/backend，ffmpeg 放在 .../resources/ffmpeg/
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', exe));
  }
  // 开发态：仓库自带
  candidates.push(path.join(ROOT, 'vendor', 'ffmpeg', exe));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { _cachedFfmpegPath = c; return c; } } catch { /* ignore */ }
  }
  _cachedFfmpegPath = 'ffmpeg'; // 回退系统 PATH
  return _cachedFfmpegPath;
}

// Resolve ffprobe from the same bundled media-tool directory as ffmpeg.
let _cachedFfprobePath = null;
export function ffprobePath() {
  if (_cachedFfprobePath) return _cachedFfprobePath;
  const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', exe));
  }
  candidates.push(path.join(ROOT, 'vendor', 'ffmpeg', exe));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        _cachedFfprobePath = candidate;
        return candidate;
      }
    } catch { /* ignore */ }
  }
  _cachedFfprobePath = 'ffprobe';
  return _cachedFfprobePath;
}
