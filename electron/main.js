import { app, BrowserWindow, shell, ipcMain, nativeImage, Notification, dialog, utilityProcess } from 'electron';
import { nativeTheme, powerMonitor } from 'electron';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import updaterPackage from 'electron-updater';
import { backupStorageForUpdate, DATA_DIR, ELECTRON_DATA_DIR, INSTALL_DIR, loadConfig, LOG_DIR, STATE_DIR, TEMP_DIR, USER_APP_DIR } from '../backend/config.js';
import { videoDiskPath } from '../backend/videoFunctions.js';
import { getMachineCode, loginAccount, redeemAccount, registerAccount, validateLicense } from '../backend/license.js';
import { logger } from '../backend/logger.js';
import { createSoftwareUpdater } from './softwareUpdater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ICON_PATH = path.join(ROOT, 'assets', process.platform === 'win32' ? 'yanzhi-icon.ico' : 'icon.png');
// 原生文件拖拽（startDrag）在 Windows 上必须携带非空 NativeImage 作为拖拽图标，
// 否则会抛 Invalid icon。复用现成的应用图标并缩到 48px：原始 icon.png 尺寸很大，
// 不缩放的话拖拽时跟随鼠标的虚影会巨大（用户反馈）。resize 对空图返回空图，无副作用。
const DRAG_ICON = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')).resize({ width: 48, height: 48 });
const GPU_STARTUP_LOCK = path.join(STATE_DIR, 'gpu-startup.lock');
const LEGAL_AGREEMENT_STATE_PATH = path.join(STATE_DIR, 'legal-agreement.json');
const LEGAL_AGREEMENT_REINSTALL_MARKER_PATH = path.join(INSTALL_DIR, '.legal-agreement-reinstall');
// 租约默认 72h、离线宽限 12h，运行期复验只为让吊销尽快生效，分钟级足够；
// 传输类失败已在 license.js 里降级为离线宽限，不会因网络抖动误锁。
const LICENSE_REVALIDATE_INTERVAL_MS = 10 * 60 * 1000;
const LICENSE_FOREGROUND_THROTTLE_MS = 60 * 1000;
const LICENSE_LOCK_RETRY_DELAY_MS = 20 * 1000;
const MAIN_WINDOW_READY_TIMEOUT_MS = 15 * 1000;

function configureElectronStoragePaths() {
  const paths = {
    userData: path.join(ELECTRON_DATA_DIR, 'user-data'),
    sessionData: path.join(ELECTRON_DATA_DIR, 'session-data'),
    temp: TEMP_DIR,
    crashDumps: path.join(ELECTRON_DATA_DIR, 'crash-dumps'),
  };
  for (const [name, directory] of Object.entries(paths)) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      app.setPath(name, directory);
    } catch (error) {
      console.error(`Failed to set Electron ${name} path:`, error.message);
    }
  }
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    app.setAppLogsPath(LOG_DIR);
  } catch (error) {
    console.error('Failed to set Electron log path:', error.message);
  }
}

configureElectronStoragePaths();
nativeTheme.themeSource = 'dark';

function resetLegalAgreementAfterManualInstall() {
  if (!fs.existsSync(LEGAL_AGREEMENT_REINSTALL_MARKER_PATH)) return;
  try {
    fs.rmSync(LEGAL_AGREEMENT_STATE_PATH, { force: true });
    fs.rmSync(LEGAL_AGREEMENT_REINSTALL_MARKER_PATH, { force: true });
  } catch (error) {
    logger.warn?.('重装后重置协议状态失败', { error: error?.message || String(error) });
  }
}

resetLegalAgreementAfterManualInstall();

let mainWindow = null;
const mainWindows = new Set();
const mainWindowRevealTimers = new Map();
let activationWindow = null;
let serverProcess = null;
let serverProcessStartedAt = 0;
let serverRestartAttempts = 0;
let serverStopping = false;
let serverPort = 0;
let localServerUrl = '';
let launchMainAppPromise = null;
let licenseRevalidationTimer = null;
let licenseRevalidationPromise = null;
let softwareUpdaterController = null;
let lastLicenseValidationAt = 0;
let lastLicenseStatus = { ok: false, code: 'CHECKING', error: '正在验证授权...' };
let rendererCrashRecorded = false;
let isQuitting = false;
let isLicenseLocked = false;
const pendingCloseConfirmations = new WeakSet();

const TITLE_BAR_PALETTES = Object.freeze({
  dark: { color: '#2c2c2c', symbolColor: '#f4f4f4' },
  light: { color: '#fbfbfb', symbolColor: '#252525' },
});

function applyTitleBarTheme(target, rawTheme) {
  if (!target || target.isDestroyed()) return;
  const theme = String(rawTheme || '').trim().toLowerCase();
  const palette = TITLE_BAR_PALETTES[theme] || TITLE_BAR_PALETTES.dark;
  target.setBackgroundColor(palette.color);
  if (typeof target.setTitleBarOverlay === 'function') {
    target.setTitleBarOverlay({ ...palette, height: 34 });
  }
}

function writeGpuStartupLock(details = {}) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(GPU_STARTUP_LOCK, JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ...details,
    }, null, 2), 'utf8');
  } catch (error) {
    console.error('写入 GPU 启动锁失败：', error);
  }
}

function clearGpuStartupLock() {
  try { fs.rmSync(GPU_STARTUP_LOCK, { force: true }); }
  catch (error) { console.error('清理 GPU 启动锁失败：', error); }
}

const previousGpuStartupFailed = fs.existsSync(GPU_STARTUP_LOCK);
const explicitSafeMode = process.argv.includes('--safe-mode') || process.env.GG_SAFE_MODE === '1';
const safeMode = explicitSafeMode || previousGpuStartupFailed;
const hardwareAccelerationEnabled = loadConfig().performance?.hardwareAcceleration !== false;

if (safeMode) process.env.GG_SAFE_MODE = '1';
if (safeMode || !hardwareAccelerationEnabled) app.disableHardwareAcceleration();
writeGpuStartupLock({
  phase: 'electron-startup',
  safeMode,
  reason: explicitSafeMode ? 'explicit' : (previousGpuStartupFailed ? 'previous-renderer-startup-failure' : 'normal'),
  hardwareAccelerationEnabled,
});

process.on('uncaughtException', (error) => {
  rendererCrashRecorded = true;
  writeGpuStartupLock({ phase: 'main-process-crash', error: error?.message || String(error) });
  console.error('Electron main process uncaught exception:', error);
  setImmediate(() => app.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('Electron main process unhandled rejection:', reason);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function appIcon() {
  try {
    return nativeImage.createFromPath(ICON_PATH);
  } catch {
    return undefined;
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readLegalAgreementState() {
  try {
    const saved = readJsonFile(LEGAL_AGREEMENT_STATE_PATH);
    return {
      accepted: saved?.accepted === true,
      version: String(saved?.version || '').slice(0, 40),
      acceptedAt: String(saved?.acceptedAt || '').slice(0, 40),
    };
  } catch {
    return { accepted: false, version: '', acceptedAt: '' };
  }
}

function saveLegalAgreementState(version) {
  const state = {
    accepted: true,
    version: String(version || '').slice(0, 40),
    acceptedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(LEGAL_AGREEMENT_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
    return state;
  } catch (error) {
    logger.warn?.('保存协议同意状态失败', { error: error?.message || String(error) });
    return { accepted: false, version: '', acceptedAt: '' };
  }
}

function monitorRendererStartup(window, kind) {
  window.once('ready-to-show', () => {
    rendererCrashRecorded = false;
    clearGpuStartupLock();
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details?.reason === 'clean-exit') return;
    rendererCrashRecorded = true;
    writeGpuStartupLock({
      phase: 'renderer-process-gone',
      window: kind,
      reason: details?.reason || 'unknown',
      exitCode: details?.exitCode ?? null,
    });
  });
}

function showMainAndOpenAgent() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  const notifyRenderer = () => mainWindow?.webContents.send('app:open-agent');
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', notifyRenderer);
  else notifyRenderer();
}

async function openExternalHttp(targetUrl) {
  try {
    const target = new URL(String(targetUrl || ''));
    if (!['http:', 'https:'].includes(target.protocol)) return { ok: false, error: '仅支持 HTTP 或 HTTPS 地址' };
    await shell.openExternal(target.toString());
    return { ok: true, url: target.toString() };
  } catch (error) {
    return { ok: false, error: error?.message || '无法打开网址' };
  }
}

function guardRendererNavigation(window, expectedUrl) {
  const expected = new URL(expectedUrl);
  const isAllowed = (candidateValue) => {
    try {
      const candidate = new URL(candidateValue);
      if (expected.protocol === 'file:') {
        return candidate.protocol === 'file:' && candidate.pathname === expected.pathname;
      }
      return candidate.origin === expected.origin;
    } catch {
      return false;
    }
  };
  const preventUnexpectedNavigation = (event, targetUrl) => {
    if (isAllowed(targetUrl)) return;
    event.preventDefault();
    openExternalHttp(targetUrl);
  };
  window.webContents.on('will-navigate', preventUnexpectedNavigation);
  window.webContents.on('will-redirect', preventUnexpectedNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttp(url);
    return { action: 'deny' };
  });
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: safeMode ? 'Freedom · 安全模式' : 'Freedom',
    icon: appIcon(),
    backgroundColor: '#0b0908',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0908',
      symbolColor: '#f7f2e9',
      height: 34,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload-main.js'),
    },
  });

  mainWindow = window;
  mainWindows.add(window);
  monitorRendererStartup(window, 'main');
  guardRendererNavigation(window, url);
  const revealTimer = setTimeout(() => {
    mainWindowRevealTimers.delete(window);
    if (!window.isDestroyed() && !window.isVisible()) {
      logger.warn?.('Renderer ready signal timed out; showing the main window fallback');
      window.show();
    }
  }, MAIN_WINDOW_READY_TIMEOUT_MS);
  revealTimer.unref?.();
  mainWindowRevealTimers.set(window, revealTimer);
  window.loadURL(url);
  // 渲染进程 console 转发到主进程日志：前端报错（含完整堆栈）自动落盘 app.log，便于远程排查。
  window.webContents.on('console-message', (event) => {
    const level = event.level === 'error' ? 'error' : event.level === 'warning' ? 'warn' : 'info';
    const text = `${event.message || ''}${event.stack ? `\n${event.stack}` : ''}`;
    logger[level]?.(`[renderer:${event.sourceId || 'app'}:${event.lineNumber ?? '?'}]`, text);
  });
  window.webContents.on('did-finish-load', () => {
    window.webContents.executeJavaScript(
      "document.documentElement.dataset.theme || 'dark'",
      true,
    ).then((theme) => applyTitleBarTheme(window, theme)).catch((error) => {
      logger.warn?.('Failed to synchronize the native title bar theme', { error: error?.message || String(error) });
    });
  });

  window.on('close', (event) => {
    if (isQuitting || isLicenseLocked) return;
    event.preventDefault();
    if (pendingCloseConfirmations.has(window)) return;
    pendingCloseConfirmations.add(window);
    void dialog.showMessageBox(window, {
      type: 'question',
      title: '退出 Freedom',
      message: '确定要退出 Freedom吗？',
      detail: '点击“取消”可继续使用，避免误触窗口右上角的关闭按钮。',
      buttons: ['取消', '退出应用'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).then(({ response }) => {
      pendingCloseConfirmations.delete(window);
      if (response !== 1 || window.isDestroyed()) return;
      isQuitting = true;
      app.quit();
    }).catch((error) => {
      pendingCloseConfirmations.delete(window);
      logger.warn?.('Failed to show the exit confirmation', { error: error?.message || String(error) });
    });
  });
  window.on('closed', () => {
    const pendingReveal = mainWindowRevealTimers.get(window);
    if (pendingReveal) clearTimeout(pendingReveal);
    mainWindowRevealTimers.delete(window);
    mainWindows.delete(window);
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function createActivationWindow() {
  if (activationWindow && !activationWindow.isDestroyed()) {
    activationWindow.show();
    activationWindow.focus();
    return activationWindow;
  }
  activationWindow = new BrowserWindow({
    width: 1080,
    height: 608,
    minWidth: 1080,
    minHeight: 608,
    maxWidth: 1080,
    maxHeight: 608,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: safeMode ? 'Freedom · 账号访问 · 安全模式' : 'Freedom · 账号访问',
    icon: appIcon(),
    backgroundColor: '#f6dda2',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#5f4633',
      height: 36,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload-activation.js'),
    },
  });

  const activationPath = path.join(__dirname, 'activation.html');
  monitorRendererStartup(activationWindow, 'activation');
  guardRendererNavigation(activationWindow, pathToFileURL(activationPath).toString());
  activationWindow.loadFile(activationPath);

  activationWindow.on('closed', () => {
    activationWindow = null;
    if (mainWindows.size === 0) app.quit();
  });
  return activationWindow;
}

function clearLicenseRevalidationTimer() {
  if (!licenseRevalidationTimer) return;
  clearInterval(licenseRevalidationTimer);
  licenseRevalidationTimer = null;
}

function scheduleLicenseRevalidation() {
  clearLicenseRevalidationTimer();
  licenseRevalidationTimer = setInterval(() => {
    void revalidateRuntimeLicense({ force: true });
  }, LICENSE_REVALIDATE_INTERVAL_MS);
  licenseRevalidationTimer.unref?.();
}

// 后端 HTTP 服务运行在独立的 utilityProcess 里：后端的同步磁盘操作
// （项目读写、目录统计、ffmpeg 等）不再阻塞界面进程。
const SERVER_READY_TIMEOUT_MS = 30 * 1000;
const SERVER_STABLE_UPTIME_MS = 60 * 1000;
const SERVER_MAX_RESTART_ATTEMPTS = 3;

function forkServerProcess() {
  return utilityProcess.fork(path.join(ROOT, 'backend', 'serverProcess.js'), [], {
    serviceName: 'gg-backend-server',
    stdio: 'inherit',
    env: {
      ...process.env,
      // 把主进程解析好的存储根/安装目录传给子进程，保证两边路径完全一致
      GG_STORAGE_ROOT: USER_APP_DIR,
      GG_INSTALL_DIR: INSTALL_DIR,
      // 崩溃重启时沿用同一端口，已打开的窗口不用换地址
      GG_SERVER_PORT: String(serverPort || 0),
    },
  });
}

function startLocalServerProcess() {
  return new Promise((resolve, reject) => {
    const child = forkServerProcess();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error('后端服务启动超时'));
    }, SERVER_READY_TIMEOUT_MS);
    child.on('message', (message) => {
      if (settled) return;
      if (message?.type === 'server-ready') {
        settled = true;
        clearTimeout(timer);
        serverProcess = child;
        serverProcessStartedAt = Date.now();
        serverPort = message.port;
        localServerUrl = message.url;
        resolve(message);
      } else if (message?.type === 'server-error') {
        settled = true;
        clearTimeout(timer);
        reject(new Error(message.message || '后端服务启动失败'));
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`后端服务提前退出（code ${code}）`));
        return;
      }
      handleServerProcessExit(child, code);
    });
  });
}

function handleServerProcessExit(child, code) {
  if (serverProcess !== child) return;
  serverProcess = null;
  if (isQuitting || serverStopping || isLicenseLocked) return;
  logger.error('backend_server_exited', { code, uptimeMs: Date.now() - serverProcessStartedAt });
  if (Date.now() - serverProcessStartedAt >= SERVER_STABLE_UPTIME_MS) serverRestartAttempts = 0;
  if (serverRestartAttempts >= SERVER_MAX_RESTART_ATTEMPTS) {
    dialog.showErrorBox('Freedom', '后端服务多次异常退出，请重启软件。若持续出现，请在设置页导出诊断信息反馈。');
    return;
  }
  serverRestartAttempts += 1;
  setTimeout(() => {
    if (isQuitting || serverStopping || isLicenseLocked || serverProcess) return;
    startLocalServerProcess().catch((error) => {
      logger.error('backend_server_restart_failed', error);
      dialog.showErrorBox('Freedom', '后端服务重启失败，请重启软件。');
    });
  }, 800 * serverRestartAttempts);
}

async function stopLocalServer() {
  const child = serverProcess;
  serverProcess = null;
  localServerUrl = '';
  serverPort = 0;
  if (!child) return;
  serverStopping = true;
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try { child.postMessage({ type: 'shutdown' }); } catch {
        try { child.kill(); } catch { /* ignore */ }
      }
    });
  } finally {
    serverStopping = false;
  }
}

async function lockApplicationForLicense(result) {
  lastLicenseStatus = result;
  if (isLicenseLocked) return;
  isLicenseLocked = true;
  clearLicenseRevalidationTimer();
  await stopLocalServer();
  for (const window of [...mainWindows]) {
    if (!window.isDestroyed()) window.destroy();
  }
  // Patched: 授权已通过本地放行，不再唤起激活窗口
  isLicenseLocked = false;
}

async function revalidateRuntimeLicense({ force = false, retried = false } = {}) {
  if (isQuitting || isLicenseLocked || mainWindows.size === 0) return lastLicenseStatus;
  if (!force && Date.now() - lastLicenseValidationAt < LICENSE_FOREGROUND_THROTTLE_MS) {
    return lastLicenseStatus;
  }
  if (licenseRevalidationPromise) return licenseRevalidationPromise;
  licenseRevalidationPromise = (async () => {
    const result = await validateLicense();
    lastLicenseValidationAt = Date.now();
    lastLicenseStatus = result;
    return result;
  })();
  let result;
  try {
    result = await licenseRevalidationPromise;
  } finally {
    licenseRevalidationPromise = null;
  }
  if (!result.ok) {
    // Patched: 本地授权已放行，永远不再锁应用
    lastLicenseStatus = { ok: true, code: 'OK', error: '' };
    return lastLicenseStatus;
  }
  return result;
}

function registerLicenseRuntimeChecks() {
  powerMonitor.on('resume', () => { void revalidateRuntimeLicense({ force: true }); });
  powerMonitor.on('unlock-screen', () => { void revalidateRuntimeLicense({ force: true }); });
  app.on('browser-window-focus', (_event, window) => {
    if (mainWindows.has(window)) void revalidateRuntimeLicense();
  });
}

async function launchMainApp() {
  if (mainWindow && !mainWindow.isDestroyed()) return;
  if (launchMainAppPromise) return launchMainAppPromise;
  launchMainAppPromise = (async () => {
    isLicenseLocked = false;
    writeGpuStartupLock({ phase: 'main-window-startup', safeMode, hardwareAccelerationEnabled });
    const started = await startLocalServerProcess();
    createWindow(started.url);
    scheduleLicenseRevalidation();
  })();
  try {
    await launchMainAppPromise;
  } finally {
    launchMainAppPromise = null;
  }
}

const CANVAS_MEDIA_ROOT = path.resolve(DATA_DIR, '.canvas-media');

function isMainWindowSender(event) {
  const owner = BrowserWindow.fromWebContents(event?.sender);
  return Boolean(owner && mainWindows.has(owner));
}

function resolveCanvasMediaDirectory(directory = '') {
  const target = path.resolve(String(directory || CANVAS_MEDIA_ROOT));
  if (target !== CANVAS_MEDIA_ROOT && !target.startsWith(`${CANVAS_MEDIA_ROOT}${path.sep}`)) {
    throw new Error('画布素材目录无效');
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function safeCanvasDownloadFilename(value) {
  const cleaned = String(value || 'canvas-media')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'canvas-media';
}

function resolveCanvasMediaSource(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('没有可下载的媒体地址');
  if (/^data:/i.test(raw)) return raw;
  let parsed;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) parsed = new URL(raw);
    else if (localServerUrl) parsed = new URL(raw, localServerUrl);
  } catch {
    parsed = null;
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('媒体地址无效');
  }
  return parsed.toString();
}

async function writeCanvasMediaSource(source, target) {
  if (/^data:/i.test(source)) {
    const match = source.match(/^data:[^,]*,([\s\S]*)$/i);
    if (!match) throw new Error('媒体数据无效');
    const isBase64 = /^data:[^,]*;base64,/i.test(source);
    const bytes = isBase64
      ? Buffer.from(match[1].replace(/\s+/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(match[1]), 'utf8');
    if (!bytes.length) throw new Error('媒体数据为空');
    await fs.promises.writeFile(target, bytes);
    return;
  }
  const response = await fetch(source, { redirect: 'follow' });
  if (!response.ok) throw new Error(`媒体下载失败（${response.status}）`);
  if (!response.body) {
    await fs.promises.writeFile(target, Buffer.from(await response.arrayBuffer()));
    return;
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target));
}

ipcMain.handle('app:choose-directory', async (_event, defaultPath = '') => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择 Freedom 数据存储文件夹',
    defaultPath: String(defaultPath || USER_APP_DIR),
    properties: ['openDirectory', 'createDirectory'],
  });
  return { canceled: result.canceled, path: result.filePaths?.[0] || '' };
});
ipcMain.handle('app:choose-video-file', async (event) => {
  if (!isMainWindowSender(event)) throw new Error('无效的主窗口');
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
  const result = await dialog.showOpenDialog(owner, {
    title: '选择要切割的视频',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'ts', 'mts', 'm2ts', 'flv'] }],
  });
  const paths = result.filePaths || [];
  return { canceled: result.canceled, path: paths[0] || '', paths };
});
ipcMain.handle('app:choose-video-output-directory', async (event, defaultPath = '') => {
  if (!isMainWindowSender(event)) throw new Error('无效的主窗口');
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
  const result = await dialog.showOpenDialog(owner, {
    title: '选择切割输出文件夹',
    defaultPath: String(defaultPath || ''),
    properties: ['openDirectory', 'createDirectory'],
  });
  return { canceled: result.canceled, path: result.filePaths?.[0] || '' };
});
ipcMain.handle('app:open-external-url', async (event, targetUrl = '') => {
  if (!isMainWindowSender(event)) throw new Error('无效的主窗口');
  return openExternalHttp(targetUrl);
});
ipcMain.handle('app:open-storage-directory', async (_event, directory = '') => {
  const target = path.resolve(String(directory || USER_APP_DIR));
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  return { ok: !error, error: error || '' };
});
ipcMain.handle('app:open-canvas-media-folder', async (event, directory = '') => {
  if (!isMainWindowSender(event)) throw new Error('无效的画布窗口');
  const target = resolveCanvasMediaDirectory(directory);
  const error = await shell.openPath(target);
  return { ok: !error, error: error || '', dir: target };
});
ipcMain.handle('app:save-canvas-media', async (event, payload = {}) => {
  if (!isMainWindowSender(event)) throw new Error('无效的画布窗口');
  const fileName = safeCanvasDownloadFilename(payload.fileName || payload.name);
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase();
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
  const result = await dialog.showSaveDialog(owner, {
    title: '保存画布媒体',
    defaultPath: path.join(app.getPath('downloads'), fileName),
    filters: extension ? [{ name: `${extension.toUpperCase()} 文件`, extensions: [extension] }] : [],
  });
  if (result.canceled || !result.filePath) return { ok: true, canceled: true };

  const source = resolveCanvasMediaSource(payload.url);
  const target = result.filePath;
  const temp = `${target}.${process.pid}.${Date.now()}.part`;
  try {
    await writeCanvasMediaSource(source, temp);
    await fs.promises.rm(target, { force: true });
    await fs.promises.rename(temp, target);
    return { ok: true, canceled: false, path: target };
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
});
ipcMain.on('app:restart', () => {
  isQuitting = true;
  app.relaunch();
  app.exit(0);
});
// 把本地视频以 OS 级文件拖拽交给外部 App（剪映等）。渲染进程已在 dragstart 里先
// preventDefault 取消 HTML5 拖拽，再用异步 send 通知这里调 startDrag——不能反过来用
// sendSync，否则渲染进程会被原生拖拽的模态循环阻塞，startDrag 一旦不返回就永久卡死。
// 路径解析复用与后端 serve 完全相同的 videoDiskPath。
ipcMain.on('app:start-file-drag', (event, videoUrl) => {
  try {
    if (typeof videoUrl !== 'string' || !videoUrl) return;
    const u = new URL(videoUrl, localServerUrl || 'http://localhost');
    const parts = u.pathname.split('/').filter(Boolean); // ['video', projectId, episodeId, shotNo.mp4]
    if (parts[0] !== 'video' || parts.length < 4) return;
    const projectId = decodeURIComponent(parts[1]);
    const episodeId = decodeURIComponent(parts[2]);
    const shotNo = decodeURIComponent(parts[3] || '').replace(/\.mp4$/i, '');
    const file = videoDiskPath(projectId, episodeId, shotNo);
    if (!file || !fs.existsSync(file)) return;
    event.sender.startDrag({ file, icon: DRAG_ICON });
  } catch (error) {
    logger.warn?.('原生文件拖拽解析失败', { error: error?.message || String(error) });
  }
});
ipcMain.on('legal-agreement:get', (event) => {
  event.returnValue = readLegalAgreementState();
});
ipcMain.on('legal-agreement:accept', (event, version = '') => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || !mainWindows.has(owner) || owner.isDestroyed()) {
    event.returnValue = { accepted: false, version: '', acceptedAt: '' };
    return;
  }
  event.returnValue = saveLegalAgreementState(version);
});
ipcMain.on('app:quit', () => {
  isQuitting = true;
  app.quit();
});
ipcMain.on('app:renderer-ready', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !mainWindows.has(window) || window.isDestroyed()) return;
  const pendingReveal = mainWindowRevealTimers.get(window);
  if (pendingReveal) clearTimeout(pendingReveal);
  mainWindowRevealTimers.delete(window);
  if (!window.isVisible()) window.show();
});

ipcMain.on('app:set-titlebar-theme', (event, rawTheme) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  applyTitleBarTheme(target, rawTheme);
});
ipcMain.on('app:agent-notify', (event, payload = {}) => {
  if (!isMainWindowSender(event)) return;
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: String(payload.title || 'Freedom Agent 已完成').slice(0, 80),
    body: String(payload.body || '点击查看结果').slice(0, 160),
    icon: ICON_PATH,
    silent: false,
  });
  notification.on('click', showMainAndOpenAgent);
  notification.show();
});

ipcMain.handle('license:getMachineCode', () => getMachineCode());
ipcMain.handle('license:status', () => lastLicenseStatus);
async function finishAccountAccess(result) {
  // Patched: 本地放行，不论 result.ok 是否为 true，都允许进入主界面
  const patchedResult = result?.ok ? result : { ok: true, state: 'online', code: 'OK' };
  lastLicenseStatus = patchedResult;
  lastLicenseValidationAt = Date.now();
  isLicenseLocked = false;
  await launchMainApp();
  const toClose = activationWindow;
  activationWindow = null;
  if (toClose && !toClose.isDestroyed()) toClose.close();
  return patchedResult;
}

async function completeAccountAccess(accessor, credentials) {
  return finishAccountAccess(await accessor(credentials));
}

ipcMain.handle('license:login', (_event, credentials) => completeAccountAccess(loginAccount, credentials));
ipcMain.handle('license:redeem', (_event, credentials) => completeAccountAccess(redeemAccount, credentials));
ipcMain.handle('license:register', async (_event, credentials) => {
  const result = await registerAccount(credentials);
  return result.ok && result.state === 'online' ? finishAccountAccess(result) : result;
});

async function boot() {
  lastLicenseStatus = await validateLicense();
  lastLicenseValidationAt = Date.now();
  // Patched: 本地授权已放行，永远进入主界面
  isLicenseLocked = false;
  await launchMainApp();
}

app.whenReady().then(async () => {
  softwareUpdaterController = createSoftwareUpdater({
    app,
    updater: app.isPackaged ? updaterPackage.autoUpdater : null,
    ipcMain,
    getWindows: () => [...mainWindows, activationWindow].filter(Boolean),
    beforeInstall: () => backupStorageForUpdate(),
    log: logger,
  });
  softwareUpdaterController.start();
  registerLicenseRuntimeChecks();
  await boot();
}).catch((error) => {
  rendererCrashRecorded = true;
  writeGpuStartupLock({ phase: 'electron-boot-failed', error: error?.message || String(error) });
  console.error('Electron 启动失败：', error);
  app.quit();
});

app.on('second-instance', () => {
  const win = mainWindow || activationWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  softwareUpdaterController?.stop();
  clearLicenseRevalidationTimer();
  if (!rendererCrashRecorded) clearGpuStartupLock();
  if (serverProcess) {
    serverStopping = true;
    const child = serverProcess;
    serverProcess = null;
    try { child.postMessage({ type: 'shutdown' }); } catch { /* ignore */ }
    // utilityProcess 随应用退出被回收；这里只是给它一个优雅关闭的机会
  }
});
