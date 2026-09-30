import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import { acquireProcessFileLock } from './processFileLock.js';

export const NEOWOW_LOGIN_URL = 'https://neowow.cn/workflows';
const NEOWOW_STORAGE_ORIGINS = [
  'https://neowow.cn',
  'https://www.neowow.cn',
  'https://hub.neowow.cn',
];
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 750;
const TOKEN_CAPTURE_TIMEOUT_MS = 30 * 1000;

function authError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function edgeExecutablePath() {
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
    : [];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function waitForProcessExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.('error', onError);
      child.off?.('exit', onExit);
      action();
    };
    const onError = (error) => finish(() => reject(error));
    const onExit = (code, signal) => finish(() => resolve({ code, signal }));
    const timer = setTimeout(() => finish(() => reject(authError(
      'Neowow 登录等待超时；请关闭软件打开的登录窗口后重新登录该账号',
      'NEOWOW_LOGIN_TIMEOUT',
    ))), timeoutMs);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function launchNormalEdgeLogin({ executablePath, profileDir, spawnImpl = spawn }) {
  return spawnImpl(executablePath, [
    `--user-data-dir=${profileDir}`,
    '--profile-directory=Default',
    '--new-window',
    '--start-maximized',
    '--disable-background-mode',
    NEOWOW_LOGIN_URL,
  ], {
    windowsHide: false,
    stdio: 'ignore',
  });
}

export function neowowLoginProfileDirectory(accountId = '') {
  const configured = String(process.env.GG_NEOWOW_LOGIN_PROFILE_DIR || '').trim();
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const root = configured
    ? path.resolve(configured)
    : path.join(localAppData, 'Freedom', 'browser-profiles', 'neowow');
  const key = String(accountId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return key ? path.join(root, 'accounts', key) : root;
}

export function normalizeCapturedNeowowToken(value) {
  let token = String(value || '').trim();
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    try { token = JSON.parse(token); } catch { token = token.slice(1, -1); }
    token = String(token || '').trim();
  }
  if (!token || token.includes('****') || token.length < 32 || /[\x00-\x20]/.test(token)) return '';
  return token.slice(0, 8192);
}

async function capturedTokenFromPage(page) {
  const value = await page.evaluate(() => {
    const stores = [window.localStorage, window.sessionStorage];
    const preferredKeys = ['token', 'authorization', 'accessToken', 'access_token'];
    for (const store of stores) {
      for (const key of preferredKeys) {
        const direct = store.getItem(key);
        if (direct) return direct;
      }
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index) || '';
        if (!/(?:^|[_-])(token|authorization|accessToken)(?:$|[_-])/i.test(key) || /refresh/i.test(key)) continue;
        const candidate = store.getItem(key);
        if (candidate) return candidate;
      }
    }
    return '';
  }).catch(() => '');
  return normalizeCapturedNeowowToken(value);
}

function isNeowowPage(page) {
  try {
    const hostname = new URL(page.url()).hostname.toLowerCase();
    return hostname === 'neowow.cn' || hostname.endsWith('.neowow.cn');
  } catch {
    return false;
  }
}

function neowowPageOrigin(page) {
  try {
    const url = new URL(page.url());
    return (url.hostname === 'neowow.cn' || url.hostname.endsWith('.neowow.cn')) ? url.origin : '';
  } catch {
    return '';
  }
}

async function clearNeowowPageStorage(page) {
  await page.evaluate(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  }).catch(() => {});
}

export async function clearNeowowLoginSession({
  onProgress,
  chromiumImpl = null,
  executablePath = edgeExecutablePath(),
  profileDirectory = neowowLoginProfileDirectory(),
} = {}) {
  if (!executablePath) throw authError('未检测到 Microsoft Edge，无法清理 Neowow 登录状态', 'EDGE_NOT_FOUND');
  const profileDir = path.resolve(profileDirectory);
  fs.mkdirSync(profileDir, { recursive: true });
  const releaseLock = acquireProcessFileLock(`${profileDir}.hepai-browser.lock`);
  if (!releaseLock) {
    throw authError('Neowow 登录窗口正在使用，请关闭该专用窗口后再退出账号', 'NEOWOW_LOGIN_BUSY');
  }

  let context = null;
  let contextClosed = false;
  try {
    const chromium = chromiumImpl || (await import('playwright-core')).chromium;
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath,
      headless: true,
      acceptDownloads: false,
      args: [
        '--profile-directory=Default',
        '--disable-session-crashed-bubble',
      ],
    });
    context.once('close', () => { contextClosed = true; });
    let page = context.pages().find(isNeowowPage) || context.pages()[0] || await context.newPage();
    if (!isNeowowPage(page)) {
      await page.goto(NEOWOW_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    onProgress?.('正在清除软件独立登录资料中的 Neowow 账号状态...');

    const pages = context.pages().filter((item) => !item.isClosed() && isNeowowPage(item));
    const origins = new Set(NEOWOW_STORAGE_ORIGINS);
    for (const candidate of pages) {
      const origin = neowowPageOrigin(candidate);
      if (origin) origins.add(origin);
      await clearNeowowPageStorage(candidate);
    }

    const devtoolsPage = pages[0] || page;
    const devtools = await context.newCDPSession(devtoolsPage);
    for (const origin of origins) {
      await devtools.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    }
    await context.clearCookies();
    await devtools.send('Network.clearBrowserCache');

    for (const candidate of pages) {
      if (await capturedTokenFromPage(candidate)) {
        throw authError('Neowow 登录状态清理后仍检测到 Token', 'NEOWOW_LOGOUT_VERIFY_FAILED');
      }
    }
    onProgress?.('Neowow 登录状态已清除');
    return { ok: true };
  } catch (error) {
    if (error?.code) throw error;
    const detail = String(error?.message || error);
    if (/profile|singleton|user data directory|正在使用|in use/i.test(detail)) {
      throw authError('软件的 Neowow 独立登录资料正在使用，请关闭软件打开的登录窗口后重试', 'NEOWOW_LOGIN_BUSY');
    }
    throw authError(`清理 Neowow 登录状态失败：${detail}`, 'NEOWOW_LOGOUT_FAILED');
  } finally {
    if (context && !contextClosed) await context.close().catch(() => {});
    releaseLock();
  }
}

export async function captureNeowowTokenWithLogin({
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onProgress,
  chromiumImpl = null,
  spawnImpl = spawn,
  executablePath = edgeExecutablePath(),
  profileDirectory = neowowLoginProfileDirectory(),
} = {}) {
  if (!executablePath) throw authError('未检测到 Microsoft Edge，无法打开 Neowow 登录窗口', 'EDGE_NOT_FOUND');
  const profileDir = path.resolve(profileDirectory);
  fs.mkdirSync(profileDir, { recursive: true });
  const releaseLock = acquireProcessFileLock(`${profileDir}.hepai-browser.lock`);
  if (!releaseLock) {
    throw authError('Neowow 登录窗口正在由另一个Freedom服务使用，请完成或关闭该窗口后重试', 'NEOWOW_LOGIN_BUSY');
  }

  let context = null;
  let contextClosed = false;
  let loginProcess = null;
  let releaseLockOnProcessExit = false;
  try {
    loginProcess = launchNormalEdgeLogin({ executablePath, profileDir, spawnImpl });
    onProgress?.('已用系统 Edge 打开 Neowow；请完成登录，然后关闭软件打开的窗口，软件会自动获取 Token');
    await waitForProcessExit(
      loginProcess,
      Math.max(30_000, Number(timeoutMs) || DEFAULT_LOGIN_TIMEOUT_MS),
    );

    onProgress?.('登录窗口已关闭，正在读取并验证 Neowow 登录状态...');
    const chromium = chromiumImpl || (await import('playwright-core')).chromium;
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath,
      headless: true,
      acceptDownloads: false,
      args: [
        '--profile-directory=Default',
        '--disable-session-crashed-bubble',
      ],
    });
    context.once('close', () => { contextClosed = true; });
    let page = context.pages().find(isNeowowPage)
      || context.pages().find((item) => item.url() !== 'about:blank')
      || context.pages()[0]
      || await context.newPage();
    if (!isNeowowPage(page)) {
      await page.goto(NEOWOW_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }

    const deadline = Date.now() + TOKEN_CAPTURE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (contextClosed) throw authError('读取 Neowow 登录状态的浏览器已关闭', 'NEOWOW_LOGIN_CANCELLED');
      const pages = context.pages().filter((item) => !item.isClosed() && isNeowowPage(item));
      for (const candidate of pages) {
        const token = await capturedTokenFromPage(candidate);
        if (token) {
          onProgress?.('已检测到 Neowow 登录态，正在验证账号...');
          return { token };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS)));
    }
    throw authError('没有读取到 Neowow 登录状态；请确认登录成功后再关闭软件打开的 Edge 窗口', 'NEOWOW_TOKEN_NOT_FOUND');
  } catch (error) {
    if (error?.code === 'NEOWOW_LOGIN_TIMEOUT' && loginProcess?.exitCode === null) {
      releaseLockOnProcessExit = true;
      loginProcess.once('exit', releaseLock);
    }
    if (error?.code) throw error;
    const detail = String(error?.message || error);
    if (/profile|singleton|user data directory|正在使用|in use/i.test(detail)) {
      throw authError('软件的 Neowow 独立登录资料正在使用，请关闭软件打开的登录窗口后重试', 'NEOWOW_LOGIN_BUSY');
    }
    throw authError(`打开 Neowow 登录窗口失败：${detail}`, 'NEOWOW_LOGIN_FAILED');
  } finally {
    if (context && !contextClosed) await context.close().catch(() => {});
    if (!releaseLockOnProcessExit) releaseLock();
  }
}
