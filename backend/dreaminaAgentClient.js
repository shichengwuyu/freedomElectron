import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, normalizeDreaminaAgentShotIntervalSeconds } from './config.js';
import { candidateVideoUrls } from './videoCandidates.js';
import {
  requireDreaminaAgentAccount,
  updateDreaminaAgentAccountSession,
} from './dreaminaAgentAccounts.js';
import { acquireDreaminaAgentBrowserLease } from './dreaminaAgentBrowserLease.js';

export const DREAMINA_AGENT_PROMPT_PREFIXES = Object.freeze({
  standard: '调用Seedance 2.0非VIP非fast生成一个15秒的视频比例为16比9，以下是我的提示词，以下文案直接发送给视频模型，不要做任何更改：',
  fast: '调用Seedance 2.0fast非VIP非2.0生成一个15秒的视频比例为16比9，以下是我的提示词，以下文案直接发送给视频模型，不要做任何更改：',
});
export const DREAMINA_AGENT_PROMPT_PREFIX = DREAMINA_AGENT_PROMPT_PREFIXES.standard;
export const DREAMINA_AGENT_SHOT_INTERVAL_MS = 80000;

export function normalizeDreaminaAgentPromptPreset(value) {
  return String(value || '').trim().toLowerCase() === 'fast' ? 'fast' : 'standard';
}

export function dreaminaAgentPromptPrefix(preset = 'standard') {
  return DREAMINA_AGENT_PROMPT_PREFIXES[normalizeDreaminaAgentPromptPreset(preset)];
}

const DREAMINA_AGENT_URL = 'https://jimeng.jianying.com/ai-tool/assets-canvas';
const DREAMINA_AGENT_ORIGIN = 'https://jimeng.jianying.com';
const CANVAS_UNAVAILABLE_TEXT = '画布项目无法访问';
const LEGACY_PROFILE_DIR = String(process.env.GG_DREAMINA_AGENT_PROFILE_DIR || '').trim()
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Codex', 'updream-edge-profile');
const ACCOUNTS_PROFILE_DIR = String(process.env.GG_DREAMINA_AGENT_ACCOUNTS_PROFILE_DIR || '').trim()
  || path.join(path.dirname(LEGACY_PROFILE_DIR), 'dreamina-agent-accounts');
const RESULT_REFRESH_MS = 25000;

const browserSessions = new Map();
const browserProfileLeases = new Map();
let operationQueue = Promise.resolve();
const resultCache = new Map();
const scopeProjects = new Map();
const scopeLastSubmittedAt = new Map();

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

function enqueueBrowserOperation(operation) {
  const runOperation = async () => {
    try {
      return await operation();
    } finally {
      await cleanupAllBrowserPages().catch(() => {});
    }
  };
  const run = operationQueue.then(runOperation, runOperation);
  operationQueue = run.catch(() => {});
  return run;
}

function accountCacheKey(accountId, value) {
  return `${String(accountId || '').trim()}:${String(value || '').trim()}`;
}

function clearAccountCaches(accountId) {
  const prefix = `${String(accountId || '').trim()}:`;
  for (const key of scopeProjects.keys()) if (key.startsWith(prefix)) scopeProjects.delete(key);
  for (const key of scopeLastSubmittedAt.keys()) if (key.startsWith(prefix)) scopeLastSubmittedAt.delete(key);
  for (const key of resultCache.keys()) if (key.startsWith(prefix)) resultCache.delete(key);
}

function clearBrowserState(accountId, expectedContext = null) {
  const current = browserSessions.get(accountId);
  if (!current || (expectedContext && current.context !== expectedContext)) return;
  browserSessions.delete(accountId);
}

function releaseBrowserProfileLease(accountId, expectedLease = null) {
  const current = browserProfileLeases.get(accountId);
  if (!current || (expectedLease && current !== expectedLease)) return;
  browserProfileLeases.delete(accountId);
  current.release();
}

function configuredHeadlessMode() {
  return loadConfig().video?.dreaminaAgentHeadless === true;
}

function profileDirectoryForAccount(account) {
  return account.profileKey === 'legacy'
    ? LEGACY_PROFILE_DIR
    : path.join(ACCOUNTS_PROFILE_DIR, account.id);
}

async function cleanupBrowserPages(accountId) {
  const session = browserSessions.get(accountId);
  if (!session?.context) return;
  const pages = session.context.pages().filter((page) => !page.isClosed());
  let activePage = session.activePage && !session.activePage.isClosed()
    ? session.activePage
    : null;
  activePage = activePage
    || pages.find((page) => page.url().startsWith(DREAMINA_AGENT_ORIGIN))
    || pages.find((page) => page.url() !== 'about:blank')
    || pages[0]
    || await session.context.newPage();
  session.activePage = activePage;
  await Promise.allSettled(
    session.context.pages()
      .filter((page) => page !== activePage && !page.isClosed())
      .map((page) => page.close()),
  );
}

async function cleanupAllBrowserPages() {
  for (const accountId of browserSessions.keys()) await cleanupBrowserPages(accountId);
}

function browserPageStats(context) {
  const pages = context?.pages?.().filter((page) => !page.isClosed()) || [];
  return {
    pageCount: pages.length,
    blankPageCount: pages.filter((page) => page.url() === 'about:blank').length,
  };
}

async function ensureBrowserContext({ accountId = '', headless = configuredHeadlessMode() } = {}) {
  const account = requireDreaminaAgentAccount(accountId);
  const resolvedAccountId = account.id;
  const requestedHeadless = headless === true;
  let session = browserSessions.get(resolvedAccountId);
  if (session?.context && session.headless === requestedHeadless) return session.context;
  if (session?.context) {
    const previousContext = session.context;
    clearBrowserState(resolvedAccountId, previousContext);
    await previousContext.close().catch(() => {});
  }
  const executablePath = edgeExecutablePath();
  if (!executablePath) throw new Error('未检测到 Microsoft Edge，无法打开即梦 Agent 登录窗口');
  const profileDirectory = profileDirectoryForAccount(account);
  fs.mkdirSync(profileDirectory, { recursive: true });
  let launchedContext = null;
  let profileLease = null;
  try {
    profileLease = acquireDreaminaAgentBrowserLease({ profileDirectory, accountId: resolvedAccountId });
    browserProfileLeases.set(resolvedAccountId, profileLease);
    const { chromium } = await import('playwright-core');
    const context = await chromium.launchPersistentContext(profileDirectory, {
      executablePath,
      headless: requestedHeadless,
      // Playwright disables Chromium's sandbox by default. Keep the Agent
      // Edge session isolated so the browser does not show a --no-sandbox
      // security warning on every launch.
      chromiumSandbox: true,
      viewport: requestedHeadless ? { width: 1440, height: 1000 } : null,
      acceptDownloads: true,
      args: [
        '--profile-directory=Default',
        '--disable-session-crashed-bubble',
        ...(requestedHeadless ? [] : ['--start-maximized']),
      ],
    });
    launchedContext = context;
    const restoredPages = context.pages();
    const activePage = restoredPages.find((page) => page.url().startsWith(DREAMINA_AGENT_ORIGIN))
      || restoredPages.find((page) => page.url() !== 'about:blank')
      || restoredPages[0]
      || await context.newPage();
    session = { accountId: resolvedAccountId, context, activePage, headless: requestedHeadless, profileLease };
    browserSessions.set(resolvedAccountId, session);
    context.once('close', () => {
      clearBrowserState(resolvedAccountId, context);
      releaseBrowserProfileLease(resolvedAccountId, profileLease);
    });
    await cleanupBrowserPages(resolvedAccountId);
    if (account.sessionId) {
      const cookies = await context.cookies(DREAMINA_AGENT_ORIGIN);
      const currentSessionId = cookies.find((cookie) => cookie.name === 'sessionid_ss')?.value
        || cookies.find((cookie) => cookie.name === 'sessionid')?.value
        || '';
      if (!currentSessionId) {
        await replaceDreaminaAgentSessionCookies(context, account.sessionId, { accountId: resolvedAccountId });
      } else if (currentSessionId !== account.sessionId) {
        // The website can rotate a healthy session cookie after login or use.
        // Trust the persistent browser profile and retain the newer value
        // instead of wiping all QR-login cookies and restoring stale config.
        updateDreaminaAgentAccountSession(resolvedAccountId, currentSessionId);
      }
    }
    return context;
  } catch (error) {
    clearBrowserState(resolvedAccountId);
    if (launchedContext) await launchedContext.close().catch(() => {});
    releaseBrowserProfileLease(resolvedAccountId, profileLease);
    const detail = String(error?.message || error);
    if (error?.code === 'DREAMINA_AGENT_BROWSER_BUSY') throw error;
    if (/profile|singleton|user data directory|正在使用|in use/i.test(detail)) {
      throw new Error('即梦 Agent 专用 Edge 会话正在被其他窗口使用，请关闭该专用窗口后重试；不会影响日常 Edge 窗口');
    }
    throw new Error(`打开即梦 Agent Edge 会话失败：${detail}`);
  }
}

async function ensureAgentPage({ accountId = '', navigate = false, headless = configuredHeadlessMode() } = {}) {
  const account = requireDreaminaAgentAccount(accountId);
  const context = await ensureBrowserContext({ accountId: account.id, headless });
  const session = browserSessions.get(account.id);
  if (!session.activePage || session.activePage.isClosed()) {
    session.activePage = context.pages().find((page) => page.url().startsWith(DREAMINA_AGENT_ORIGIN))
      || await context.newPage();
  }
  if (navigate || !session.activePage.url().startsWith(DREAMINA_AGENT_ORIGIN)) {
    await session.activePage.goto(DREAMINA_AGENT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await session.activePage.bringToFront();
  await cleanupBrowserPages(account.id);
  return session.activePage;
}

function agentEditor(page) {
  return page.locator('div[class^="prompt-editor-"] > [contenteditable="true"].tiptap').first();
}

async function dreaminaAgentLoginPromptVisible(page) {
  return page.getByText('欢迎登录即梦', { exact: true }).first().isVisible().catch(() => false)
    || page.getByText('登录即梦', { exact: true }).first().isVisible().catch(() => false);
}

async function dreaminaAgentPageAuthenticated(page) {
  if (await dreaminaAgentLoginPromptVisible(page)) return false;
  return await page.getByText('新建项目', { exact: true }).first().isVisible().catch(() => false)
    || await agentEditor(page).isVisible().catch(() => false);
}

function agentComposer(editor) {
  return editor.locator('xpath=ancestor::div[contains(@class,"dimension-layout-")][1]');
}

async function waitForAgentEditor(page, timeout = 20000) {
  const editor = agentEditor(page);
  const unavailable = page.getByText(CANVAS_UNAVAILABLE_TEXT, { exact: false }).first();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('即梦 Agent 画布页面已关闭');
    if (await dreaminaAgentLoginPromptVisible(page)) {
      throw new Error('即梦 Agent 登录态已失效，请在打开的 Edge 窗口中重新登录后再检测');
    }
    if (await unavailable.isVisible().catch(() => false)) {
      const error = new Error('当前即梦账号无法访问已绑定的旧画布');
      error.code = 'DREAMINA_AGENT_CANVAS_UNAVAILABLE';
      throw error;
    }
    if (await editor.isVisible().catch(() => false)) return editor;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('即梦 Agent 尚未登录，请在打开的 Edge 窗口中完成抖音登录后再检测');
}

async function inspectStatus({ accountId = '', launch = false } = {}) {
  const account = requireDreaminaAgentAccount(accountId);
  const installed = Boolean(edgeExecutablePath());
  const headless = configuredHeadlessMode();
  const session = browserSessions.get(account.id);
  if (!session?.context && !launch) {
    return {
      ok: true,
      accountId: account.id,
      accountName: account.name,
      installed,
      running: false,
      authenticated: false,
      headless,
      pageCount: 0,
      blankPageCount: 0,
      message: installed ? '网页登录窗口未打开' : '未检测到 Microsoft Edge',
    };
  }
  try {
    const page = await ensureAgentPage({ accountId: account.id, navigate: launch, headless });
    const authenticated = await dreaminaAgentPageAuthenticated(page);
    const pageStats = browserPageStats(browserSessions.get(account.id)?.context);
    return {
      ok: true,
      accountId: account.id,
      accountName: account.name,
      installed,
      running: true,
      authenticated,
      headless: browserSessions.get(account.id)?.headless === true,
      ...pageStats,
      message: authenticated ? `${account.name} 网页登录态可用` : `请在 Edge 中完成 ${account.name} 的抖音登录`,
    };
  } catch (error) {
    return {
      ok: false,
      accountId: account.id,
      accountName: account.name,
      installed,
      running: false,
      authenticated: false,
      pageCount: 0,
      blankPageCount: 0,
      error: error.message,
      message: error.message,
    };
  }
}

export function getDreaminaAgentStatus(options = {}) {
  return enqueueBrowserOperation(() => inspectStatus(options));
}

export function openDreaminaAgentLogin({ accountId = '' } = {}) {
  return enqueueBrowserOperation(async () => {
    const account = requireDreaminaAgentAccount(accountId);
    // Manual password, QR-code and captcha login must always stay visible. The
    // next generation operation switches back to the configured mode.
    const page = await ensureAgentPage({ accountId: account.id, navigate: true, headless: false });
    await page.bringToFront();
    const authenticated = await dreaminaAgentPageAuthenticated(page);
    return {
      ok: true,
      accountId: account.id,
      accountName: account.name,
      installed: true,
      running: true,
      authenticated,
      headless: false,
      opened: true,
      message: authenticated
        ? `${account.name} 已登录，可以直接使用`
        : `已打开即梦官网，请完成 ${account.name} 的抖音登录后点击检测`,
    };
  });
}

export function normalizeDreaminaAgentSessionId(value) {
  const input = String(value || '').trim();
  const cookieMatch = input.match(/(?:^|[;\s])sessionid(?:_ss)?\s*=\s*([^;\s]+)/i);
  const sessionId = String(cookieMatch?.[1] || input).trim().replace(/^['"]|['"]$/g, '');
  if (!sessionId) throw new Error('请先填写即梦官网 Session ID');
  if (sessionId.includes('****')) throw new Error('请填写完整的即梦官网 Session ID');
  if (sessionId.length < 16 || sessionId.length > 1024 || /[\x00-\x20;,]/.test(sessionId)) {
    throw new Error('即梦官网 Session ID 格式不正确');
  }
  return sessionId;
}

export async function replaceDreaminaAgentSessionCookies(context, value, { accountId = '' } = {}) {
  const sessionId = normalizeDreaminaAgentSessionId(value);
  // A manually supplied session owns this dedicated browser from now on.
  // Remove the complete QR-login cookie set so an old account cannot make an
  // invalid replacement session look authenticated.
  clearAccountCaches(accountId);
  await context.clearCookies({ domain: /(?:^|\.)jianying\.com$/i });
  await context.addCookies([
    {
      name: 'sessionid',
      value: sessionId,
      domain: '.jianying.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: 'sessionid_ss',
      value: sessionId,
      domain: '.jianying.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
    },
  ]);
  return sessionId;
}

export function applyDreaminaAgentSessionId(value, { accountId = '' } = {}) {
  return enqueueBrowserOperation(async () => {
    const account = requireDreaminaAgentAccount(accountId);
    const sessionId = normalizeDreaminaAgentSessionId(value);
    const context = await ensureBrowserContext({ accountId: account.id });
    await replaceDreaminaAgentSessionCookies(context, sessionId, { accountId: account.id });
    const page = await ensureAgentPage({ accountId: account.id });
    await page.goto(DREAMINA_AGENT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const authenticated = await dreaminaAgentPageAuthenticated(page);
    if (authenticated) updateDreaminaAgentAccountSession(account.id, sessionId);
    return {
      ok: authenticated,
      accountId: account.id,
      accountName: account.name,
      installed: true,
      running: true,
      authenticated,
      sessionApplied: true,
      message: authenticated
        ? `${account.name} 的 Session ID 已应用，该账号原扫码登录态已退出`
        : `${account.name} 原扫码登录态已退出，但新 Session ID 未被即梦官网识别，请检查 ID 是否过期`,
    };
  });
}

function taskReferences(task = {}) {
  const references = [];
  const seen = new Set();
  const add = (filePath, source = {}, kind = 'image') => {
    const resolved = String(filePath || '').trim();
    if (!resolved || !fs.existsSync(resolved)) return;
    const key = path.resolve(resolved).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    references.push({
      filePath: resolved,
      name: String(source.displayName || source.name || source.mentionName || '').trim(),
      displayName: String(source.displayName || source.name || source.mentionName || '').trim(),
      kind: String(source.kind || kind || 'image').trim().toLowerCase(),
      phrase: String(source.phrase || '').trim(),
      ownerName: String(source.ownerName || source.fallbackText || '').trim(),
    });
  };
  for (const reference of Array.isArray(task.mentions) ? task.mentions : []) {
    add(reference.filePath || reference.path, reference, reference.kind || 'image');
  }
  for (const filePath of Array.isArray(task.refImagePaths) ? task.refImagePaths : []) add(filePath, {}, 'image');
  for (const filePath of Array.isArray(task.refVideoPaths) ? task.refVideoPaths : []) add(filePath, {}, 'video');
  for (const filePath of Array.isArray(task.refAudioPaths) ? task.refAudioPaths : []) add(filePath, {}, 'audio');
  return references;
}

export function dreaminaAgentAudioReferenceOwnerName(name) {
  const raw = String(name || '').trim();
  const owner = raw
    .replace(/[\s_-]*(?:的)?[\s_-]*(?:音频|声音|配音|音色|voice|audio)(?:\s*\d+)?$/i, '')
    .replace(/[\s_-]+$/g, '')
    .trim();
  return owner || raw;
}

function referenceBinding(reference = {}, index = 0) {
  const displayName = reference.displayName
    || reference.name
    || path.basename(reference.filePath || '', path.extname(reference.filePath || ''))
    || `素材${index + 1}`;
  const kind = String(reference.kind || 'image').trim().toLowerCase();
  const phrase = kind === 'audio'
    ? `这是${dreaminaAgentAudioReferenceOwnerName(reference.ownerName || reference.name || displayName)}的参考音频`
    : (String(reference.phrase || '').trim()
      || (kind === 'video' ? `是${displayName}的视频参考` : `是${displayName}的参考图`));
  return { displayName, phrase, kind };
}

const REFERENCE_REMOVE_SELECTOR = [
  '[data-reference-remove-button="true"]',
  '[data-reference-remove="true"]',
  '[data-reference-delete="true"]',
  '[class*="reference-remove-"]',
  '[class*="reference-delete-"]',
  '[class*="reference-item-"] [aria-label*="删除"]',
  '[class*="reference-item-"] [aria-label*="移除"]',
  '[class*="reference-item-"] [title*="删除"]',
  '[class*="reference-item-"] [title*="移除"]',
].join(',');

function referenceAttachmentSnapshot(element) {
  const unique = (nodes) => [...new Set(nodes)];
  const isUploadSlot = (node) => Boolean(
    node.matches?.('[class*="reference-upload-"]')
      || node.querySelector?.('[class*="reference-upload-"], input[type="file"]'),
  );
  const sortable = unique([
    ...element.querySelectorAll('[aria-roledescription="sortable"]'),
    ...element.querySelectorAll('[class*="sortable-item-"]'),
  ]).filter((node) => !node.closest('[class*="reference-upload-"]'));
  let items = sortable;
  if (!items.length) {
    items = unique([
      ...element.querySelectorAll('[data-reference-item="true"]'),
      ...element.querySelectorAll('[class*="reference-item-"]'),
    ]).filter((node) => {
      const classes = [...(node.classList || [])];
      return !node.closest('[class*="reference-upload-"]')
        && !isUploadSlot(node)
        && classes.some((name) => /^reference-item-(?!content-)/.test(name));
    });
  }
  const uploading = items.filter((node) => node.querySelector(
    '[aria-busy="true"], progress, [class*="uploading"], [class*="loading"], [class*="progress"]',
  )).length;
  // The updated site collapses several references into a visual stack and can
  // leave only one sortable item rendered. Its group-level CSS count remains
  // authoritative and includes the trailing upload slot.
  const groups = unique([...element.querySelectorAll('[class*="reference-group-"]')])
    .filter((node) => node.style?.getPropertyValue('--reference-count'));
  const groupedCount = groups.reduce((total, group) => {
    const declared = Number.parseInt(group.style.getPropertyValue('--reference-count'), 10);
    const uploadSlots = group.querySelectorAll('[class*="reference-upload-"]').length;
    return total + (Number.isFinite(declared) ? Math.max(0, declared - uploadSlots) : 0);
  }, 0);
  return { count: Math.max(items.length, groupedCount), uploading };
}

async function readReferenceAttachmentSnapshot(composer) {
  return composer.evaluate(referenceAttachmentSnapshot)
    .catch(() => ({ count: 0, uploading: 0 }));
}

async function expandCollapsedReferenceUploads(page, composer) {
  const collapsedMore = composer.locator('[class*="collapsed-more-entry-"]:visible').first();
  if (!await collapsedMore.count()) return false;
  // The updated site does not expose every attachment node until this explicit
  // "view all" entry is activated. A transparent hover trigger sits above
  // it and intercepts pointer clicks, so dispatch the entry's own click event.
  // This remains scoped to the view-all node and never targets a thumbnail.
  await collapsedMore.evaluate((element) => element.click());
  await collapsedMore.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

async function clearReferenceUploads(page, composer) {
  const removeButtons = composer.locator(REFERENCE_REMOVE_SELECTOR);
  for (let attempt = 0; attempt < 20 && await removeButtons.count(); attempt += 1) {
    const previousCount = await removeButtons.count();
    await removeButtons.last().evaluate((button) => button.click());
    await composer.locator(REFERENCE_REMOVE_SELECTOR).nth(previousCount - 1)
      .waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }

  const remaining = await readReferenceAttachmentSnapshot(composer);
  if (!remaining.count) return;

  // The current site only shows the remove affordance while an item is hovered.
  // A reload is the reliable fallback between submissions and clears transient
  // upload state without clicking an unrelated control.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.bringToFront();
  await waitForAgentEditor(page, 30000);
  const reloaded = await readReferenceAttachmentSnapshot(composer);
  if (reloaded.count) {
    throw new Error(`即梦 Agent 旧参考素材未能清理：仍有 ${reloaded.count} 个附件`);
  }
}

async function uploadReferences(page, composer, references = []) {
  if (!references.length) return [];
  let input = composer.locator('[class*="reference-upload-"] input[type="file"]').last();
  if (!await input.count()) input = composer.locator('input[type="file"]').last();
  try {
    await input.waitFor({ state: 'attached', timeout: 10000 });
    await input.setInputFiles(references.map((reference) => reference.filePath));
    const deadline = Date.now() + 30000;
    let snapshot = await readReferenceAttachmentSnapshot(composer);
    while (Date.now() < deadline) {
      if (snapshot.uploading === 0 && await expandCollapsedReferenceUploads(page, composer)) {
        snapshot = await readReferenceAttachmentSnapshot(composer);
        continue;
      }
      if (snapshot.count === references.length && snapshot.uploading === 0) break;
      await page.waitForTimeout(250);
      snapshot = await readReferenceAttachmentSnapshot(composer);
    }
    if (snapshot.count !== references.length || snapshot.uploading > 0) {
      const error = new Error('官网参考素材数量或上传状态未达到预期');
      error.attachmentSnapshot = snapshot;
      throw error;
    }
  } catch (error) {
    await expandCollapsedReferenceUploads(page, composer);
    const snapshot = await readReferenceAttachmentSnapshot(composer);
    const diagnostics = await composer.evaluate((element) => {
      const fileInput = element.querySelector('input[type="file"]');
      return {
        accept: fileInput?.accept || '',
        multiple: Boolean(fileInput?.multiple),
      };
    }).catch(() => ({ accept: '', multiple: false }));
    diagnostics.attachmentCount = snapshot.count;
    diagnostics.uploadingCount = snapshot.uploading;
    const names = references.map((reference) => path.basename(reference.filePath)).join('、');
    throw new Error(
      `即梦 Agent 官网附件上传未完成：期望 ${references.length} 个，实际 ${diagnostics.attachmentCount} 个；`
      + `上传中 ${diagnostics.uploadingCount || 0} 个；控件类型 ${diagnostics.accept || '未声明'}，多选 ${diagnostics.multiple ? '是' : '否'}；素材：${names}`,
      { cause: error },
    );
  }
  await page.waitForTimeout(1200);
  return references.map(referenceBinding);
}

async function dismissBlockingAgentModal(page) {
  const modal = page.locator('div[class*="lv-modal-wrapper"]:visible').last();
  if (!await modal.count()) return false;
  const text = String(await modal.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 160);
  await page.keyboard.press('Escape').catch(() => {});
  await modal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  if (await modal.isVisible().catch(() => false)) {
    throw new Error(`即梦 Agent 官网弹窗阻止提交${text ? `：${text}` : ''}`);
  }
  return true;
}

async function disableAgentTools(page, composer) {
  await dismissBlockingAgentModal(page);
  for (const name of ['灵感搜索', '创意设计']) {
    const toggle = composer.getByRole('button', { name, exact: true });
    await toggle.waitFor({ state: 'visible', timeout: 10000 });
    const enabled = await toggle.evaluate((button) => /(?:^|\s)checked-/.test(button.className));
    if (enabled) {
      try {
        await toggle.click();
      } catch (error) {
        await dismissBlockingAgentModal(page);
        await toggle.click();
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    if (await toggle.evaluate((button) => /(?:^|\s)checked-/.test(button.className))) {
      throw new Error(`即梦 Agent 的“${name}”未能关闭，已阻止提交`);
    }
  }
}

async function selectUploadedReference(page, editor, binding) {
  const deadline = Date.now() + 45000;
  const option = page.getByRole('option', { name: binding.displayName, exact: true }).first();
  while (Date.now() < deadline) {
    await restoreAgentEditorFocus(page, editor);
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('@');
    const visible = await option.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    if (visible) {
      await option.click();
      const chip = editor.locator('.node-reference-mention-tag').filter({ hasText: binding.displayName }).first();
      await chip.waitFor({ state: 'visible', timeout: 10000 });
      const entityVisuals = binding.kind === 'image'
        ? chip.locator('img')
        : chip.locator('img, svg, [class*="icon"], [class*="audio"], [class*="video"], [class*="file"]');
      if (!await entityVisuals.count().catch(() => 0)) {
        throw new Error(`@${binding.displayName} 未形成带${binding.kind === 'audio' ? '音频图标' : '素材图标'}的官网参考素材标签`);
      }
      await restoreAgentEditorFocus(page, editor);
      return;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.waitForTimeout(1500);
  }
  throw new Error(`官网 @ 列表未返回已上传素材“${binding.displayName}”`);
}

async function restoreAgentEditorFocus(page, editor) {
  // The updated site keeps the reference picker open after an entity is
  // selected. Close it and restore a real editor selection without clicking
  // near the reference thumbnails at the editor's left edge.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(180);
    const restored = await editor.evaluate((element) => {
      if (!(element instanceof HTMLElement) || !element.isContentEditable) return false;
      element.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (!selection) return false;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      return selection.rangeCount === 1
        && element.contains(selection.getRangeAt(0).startContainer);
    }).catch(() => false);
    if (restored) return;
  }
  throw new Error('即梦 Agent 引用参考选择框关闭后，文案输入框未恢复焦点');
}

async function selectedReferenceNames(editor) {
  return (await editor.locator('.node-reference-mention-tag').allTextContents())
    .map((name) => name.trim());
}

async function selectReferenceBindings(page, editor, bindings, reverse = false) {
  const ordered = reverse ? [...bindings].reverse() : bindings;
  for (const binding of ordered) await selectUploadedReference(page, editor, binding);
  return selectedReferenceNames(editor);
}

function referenceOrderMatches(chipNames, bindings) {
  return chipNames.length === bindings.length
    && chipNames.every((name, index) => name === bindings[index].displayName);
}

async function insertTextBesideReference(page, editor, displayName, text, position) {
  const positioned = await editor.evaluate((element, options) => {
    element.focus();
    const chip = Array.from(element.querySelectorAll('.node-reference-mention-tag'))
      .find((candidate) => candidate.textContent?.trim() === options.displayName);
    if (!chip) return false;
    const range = document.createRange();
    if (options.position === 'before') range.setStartBefore(chip);
    else range.setStartAfter(chip);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, { displayName, position });
  if (!positioned) {
    throw new Error(`官网编辑器无法在 @${displayName} ${position === 'before' ? '之前' : '之后'}插入提示词`);
  }
  // Tiptap ignores execCommand next to a non-editable mention node. A real
  // beforeinput event keeps both the mention entity and the adjacent text.
  await page.keyboard.insertText(text);
  const inserted = await editor.evaluate((element, expected) => element.innerText.includes(expected), text);
  if (!inserted) throw new Error(`官网编辑器未保留 @${displayName} 旁的参考说明`);
}

function buildAgentPrompt(prompt, preset = 'standard') {
  return `${dreaminaAgentPromptPrefix(preset)}${String(prompt ?? '')}`;
}

function normalizeEditorText(value) {
  return String(value || '').replace(/\r/g, '').replace(/\n{2,}/g, '\n');
}

export function buildDreaminaAgentPrompt(prompt, preset = 'standard') {
  return buildAgentPrompt(prompt, preset);
}

function projectIdFromPage(page) {
  return page.url().match(/\/ai-tool\/canvas\/(\d+)/)?.[1] || '';
}

function materialInfoForReference(mention = {}, kind = '') {
  const material = mention?.material && typeof mention.material === 'object' ? mention.material : {};
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const preferredKey = normalizedKind === 'audio'
    ? 'audio_info'
    : (normalizedKind === 'video' ? 'video_info' : 'image_info');
  if (material[preferredKey] && typeof material[preferredKey] === 'object') return material[preferredKey];
  if (['image', 'video', 'audio'].includes(normalizedKind)) return null;
  return Object.entries(material)
    .find(([key, value]) => key.endsWith('_info') && value && typeof value === 'object')?.[1] || null;
}

function structuredReferenceNames(file = {}, info = {}) {
  return [
    info.title,
    info.file_name,
    file.file_name,
    file.name,
    file.audio_metadata?.title,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => path.basename(value, path.extname(value)));
}

export function requestHasStructuredReferences(payload = {}, bindings = []) {
  if (!bindings.length) return true;
  const message = Array.isArray(payload.messages) ? payload.messages[payload.messages.length - 1] : null;
  const parts = Array.isArray(message?.content?.content_parts) ? message.content.content_parts : [];
  const files = parts.map((part) => part?.file).filter(Boolean);
  const fileById = new Map(files.map((file) => [String(file.id || file.file_id || ''), file]));
  const mentions = parts.map((part) => part?.mention).filter(Boolean);
  if (files.length !== bindings.length || mentions.length !== bindings.length) return false;
  const matchedMentions = new Set();
  return bindings.every((binding) => {
    const expectedName = String(binding.displayName || '').trim();
    const matchIndex = mentions.findIndex((mention, index) => {
      if (matchedMentions.has(index)) return false;
      const file = fileById.get(String(mention.file_id || ''));
      const info = materialInfoForReference(mention, binding.kind);
      return Boolean(
        file
        && info
        && structuredReferenceNames(file, info).includes(expectedName)
      );
    });
    if (matchIndex < 0) return false;
    matchedMentions.add(matchIndex);
    return true;
  });
}

async function createCanvasProject(accountId) {
  const account = requireDreaminaAgentAccount(accountId);
  const homePage = await ensureAgentPage({ accountId: account.id, navigate: true });
  const context = homePage.context();
  const newProject = homePage.getByText('新建项目', { exact: true }).first();
  try {
    await newProject.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    throw new Error('即梦 Agent 尚未登录，请在打开的 Edge 窗口中完成抖音登录后再检测');
  }

  const existingPages = new Set(context.pages());
  await newProject.click();
  const deadline = Date.now() + 30000;
  let workPage = null;
  while (Date.now() < deadline) {
    const createdPages = context.pages().filter((page) => !existingPages.has(page));
    workPage = [homePage, ...createdPages].find((page) => (
      !page.isClosed() && /\/ai-tool\/canvas\/\d+/.test(page.url())
    )) || null;
    if (workPage) break;
    // 即梦可能在新标签页打开画布并立即关闭来源页，延时不能依赖来源页存活。
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const transientPages = context.pages().filter((page) => !existingPages.has(page) && page !== workPage);
  await Promise.allSettled(transientPages.map((page) => page.close()));
  if (!workPage) throw new Error('即梦 Agent 未能创建画布项目');
  // The website may create the canvas in a new tab. Keep that canvas as the
  // sole worker page and immediately close the home tab created for this flow.
  if (workPage !== homePage && !homePage.isClosed()) await homePage.close().catch(() => {});
  await workPage.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await workPage.bringToFront();
  await waitForAgentEditor(workPage, 30000);
  const projectId = projectIdFromPage(workPage);
  if (!projectId) throw new Error('即梦 Agent 已打开画布，但未返回项目 ID');
  const session = browserSessions.get(account.id);
  if (session) session.activePage = workPage;
  await cleanupBrowserPages(account.id);
  return { page: workPage, projectId };
}

async function openCanvasProject(accountId, projectId) {
  const account = requireDreaminaAgentAccount(accountId);
  const page = await ensureAgentPage({ accountId: account.id });
  const targetUrl = `${DREAMINA_AGENT_ORIGIN}/ai-tool/canvas/${encodeURIComponent(projectId)}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.bringToFront();
  await waitForAgentEditor(page, 30000);
  const resolvedProjectId = projectIdFromPage(page);
  if (!resolvedProjectId) throw new Error('即梦 Agent 未能打开已绑定的画布项目');
  const session = browserSessions.get(account.id);
  if (session) session.activePage = page;
  await cleanupBrowserPages(account.id);
  return { page, projectId: resolvedProjectId };
}

function canvasProjectNameInput(page) {
  return page.getByRole('banner').getByRole('textbox').first();
}

async function readCanvasProjectName(page) {
  const input = canvasProjectNameInput(page);
  await input.waitFor({ state: 'visible', timeout: 30000 });
  return String(await input.inputValue()).trim();
}

async function ensureCanvasProjectName(page, name) {
  const expected = String(name || '').trim();
  if (!expected) return '';
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (await readCanvasProjectName(page) === expected) return expected;
      const input = canvasProjectNameInput(page);
      await input.click();
      await page.waitForFunction((element) => element && element.readOnly === false, await input.elementHandle(), { timeout: 10000 });
      await input.fill(expected);
      await input.press('Enter');
      await page.waitForTimeout(1200);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForAgentEditor(page, 30000);
      const savedName = await readCanvasProjectName(page);
      if (savedName === expected) return expected;
      lastError = new Error(`官网刷新后仍显示“${savedName || '未命名项目'}”`);
    } catch (error) {
      lastError = error;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  throw new Error(`即梦 Agent 画布未能命名为“${expected}”：${lastError?.message || '官网标题未保存'}`);
}

function canvasEndpoint(url) {
  return String(url || '').replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
}

function createCanvasResponseCollector(page) {
  const records = [];
  const pending = new Set();
  const onResponse = (response) => {
    const endpoint = canvasEndpoint(response.url());
    if (![
      '/mweb/v1/infinite_canvas/get_conversation_list',
      '/mweb/v1/infinite_canvas/fetch_conversation',
      '/mweb/v1/infinite_canvas/v1/fetch_snapshot',
      '/mweb/v1/get_history_by_ids',
    ].includes(endpoint)) return;
    const read = (async () => {
      let requestPayload = {};
      let body = {};
      try { requestPayload = response.request().postDataJSON() || {}; } catch { /* non-JSON request */ }
      try { body = await response.json() || {}; } catch { /* non-JSON response */ }
      records.push({ endpoint, requestPayload, body });
    })();
    pending.add(read);
    read.finally(() => pending.delete(read));
  };
  page.on('response', onResponse);
  return {
    records,
    async flush() {
      await Promise.allSettled([...pending]);
    },
    async stop() {
      page.off('response', onResponse);
      await Promise.allSettled([...pending]);
    },
  };
}

function conversationHistoryEntries(responseBody = {}, conversationId = '') {
  const agentSession = responseBody?.agent_conversation_session;
  const session = agentSession?.conversation_session;
  if (conversationId && String(session?.conversation_id || '') !== String(conversationId)) return [];
  return Object.values(agentSession?.submit_id_data_map || {}).filter(Boolean);
}

function historyRecordId(history = {}) {
  return String(history?.history_record_id || history?.task?.history_id || '').trim();
}

function historyTaskSubmitId(history = {}) {
  return String(history?.submit_id || history?.task?.submit_id || '').trim();
}

function historyCreatedAtMs(history = {}) {
  const value = Number(
    history?.created_time
    || history?.create_time
    || history?.task?.created_time
    || history?.task?.create_time
    || 0,
  );
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

export function selectDreaminaAgentHistory(histories = [], {
  historyId = '',
  taskSubmitId = '',
  submittedAt = 0,
} = {}) {
  const candidates = histories.filter((history) => historyRecordId(history));
  const normalizedHistoryId = String(historyId || '').trim();
  if (normalizedHistoryId) {
    return candidates.find((history) => historyRecordId(history) === normalizedHistoryId) || null;
  }

  const normalizedTaskSubmitId = String(taskSubmitId || '').trim();
  if (normalizedTaskSubmitId) {
    const exact = candidates.find((history) => historyTaskSubmitId(history) === normalizedTaskSubmitId);
    if (exact) return exact;
  }

  const normalizedSubmittedAt = Number(submittedAt) || 0;
  if (normalizedSubmittedAt > 0) {
    const nearest = candidates
      .map((history) => ({
        history,
        delta: historyCreatedAtMs(history) - normalizedSubmittedAt,
      }))
      .filter((entry) => historyCreatedAtMs(entry.history) > 0 && entry.delta >= -5_000 && entry.delta <= 120_000)
      .map((entry) => ({ ...entry, distance: Math.abs(entry.delta) }))
      .sort((left, right) => left.distance - right.distance)[0];
    // 历史记录可能延迟几十秒出现，但上一镜一定早于本次点击，不能倒退匹配旧记录。
    if (nearest) return nearest.history;
    return null;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function observedConversationHistories(records = [], conversationId = '') {
  return records
    .filter((record) => record.endpoint === '/mweb/v1/infinite_canvas/fetch_conversation')
    .flatMap((record) => conversationHistoryEntries(record.body, conversationId));
}

function historyFailure(history = {}) {
  const responseError = history.task?.resp_ret && String(history.task.resp_ret.ret ?? '0') !== '0'
    ? (history.task.resp_ret.errmsg || history.task.resp_ret.message || history.task.resp_ret.ret)
    : '';
  return String(
    history.fail_starling_message
    || history.fail_reason
    || history.task?.fail_reason
    || responseError
    || '',
  ).trim();
}

async function waitForConversationTask(page, collector, conversationId, selector = {}, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await collector.flush();
    const histories = observedConversationHistories(collector.records, conversationId);
    const history = selectDreaminaAgentHistory(histories, selector);
    if (history) {
      const failure = historyFailure(history);
      return {
        historyId: historyRecordId(history),
        taskSubmitId: historyTaskSubmitId(history),
        generationFailure: failure,
      };
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/积分不足|请购买积分/.test(bodyText)) {
      throw new Error('即梦 Agent 视频生成积分不足，请更换有足够积分的账号后重试');
    }
    const continueButton = page.getByRole('button', { name: '继续生成', exact: true }).last();
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
    await page.waitForTimeout(750);
  }
  throw new Error('即梦 Agent 已接收提示词，但未返回可跟踪的视频任务');
}

function generatedCanvasCards(page) {
  return page.locator('main div[class*="generate-container-"]');
}

async function renameGeneratedCard(page, previousCount, shotNo) {
  await page.waitForFunction((expected) => (
    document.querySelectorAll('main div[class*="generate-container-"]').length > expected
  ), previousCount, { timeout: 30000 });
  const expected = String(shotNo);
  const autoLayout = page.getByRole('button', { name: '自动布局', exact: true }).last();
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // New canvas cards are appended in DOM order. Using the last card avoids
      // selecting a stale card when the website inserts more than one wrapper.
      const generation = generatedCanvasCards(page).last();
      await generation.scrollIntoViewIfNeeded().catch(() => {});
      const frame = generation.locator('xpath=../../..');
      const title = frame.locator('input:visible').first();
      if (!await title.isVisible().catch(() => false)) {
        if (await autoLayout.isVisible().catch(() => false)) {
          await autoLayout.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
        await generation.scrollIntoViewIfNeeded().catch(() => {});
      }
      await title.waitFor({ state: 'visible', timeout: 10000 });
      await title.dblclick({ delay: 120 });
      await page.waitForFunction((input) => input && input.readOnly === false, await title.elementHandle(), { timeout: 10000 });
      await title.fill(expected);
      await title.press('Enter');
      await page.waitForFunction(({ selector, value }) => {
        const generations = document.querySelectorAll(selector);
        const card = generations[generations.length - 1]?.parentElement?.parentElement?.parentElement;
        return Array.from(card?.querySelectorAll('input') || []).some((input) => input.value === value);
      }, { selector: 'main div[class*="generate-container-"]', value: expected }, { timeout: 10000 });
      return expected;
    } catch (error) {
      lastError = error;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  throw new Error(`即梦 Agent 卡片未能命名为分镜 ${expected}：${lastError?.message || '官网标题未进入编辑状态'}`);
}

async function clearEditor(page, editor) {
  await page.keyboard.press('Escape').catch(() => {});
  const selected = await editor.evaluate((element) => {
    if (!(element instanceof HTMLElement) || !element.isContentEditable) return false;
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.rangeCount === 1;
  }).catch(() => false);
  if (!selected) throw new Error('即梦 Agent 文案输入框无法选中已有内容');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
}

function ensureAgentSubmissionActive(shouldCancel) {
  if (shouldCancel?.()) {
    const error = new Error('即梦 Agent 分镜已取消，未点击官网提交');
    error.code = 'DREAMINA_AGENT_SUBMISSION_CANCELLED';
    throw error;
  }
}

async function submitOneAgentVideo(page, projectId, task = {}, { onSubmissionAccepted, shouldCancel } = {}) {
  ensureAgentSubmissionActive(shouldCancel);
  const editor = await waitForAgentEditor(page);
  const composer = agentComposer(editor);
  await disableAgentTools(page, composer);
  await clearEditor(page, editor);
  await clearReferenceUploads(page, composer);

  const references = taskReferences(task);
  const bindings = await uploadReferences(page, composer, references);
  ensureAgentSubmissionActive(shouldCancel);

  const rawPrompt = String(task.prompt ?? '');
  const promptPrefix = dreaminaAgentPromptPrefix(task.dreaminaAgentPromptPreset);
  if (bindings.length) {
    let chipNames = await selectReferenceBindings(page, editor, bindings);
    if (!referenceOrderMatches(chipNames, bindings)) {
      // 官网不同账号可能把新芯片追加到末尾或插到最前面；按实际结果自适应。
      await clearEditor(page, editor);
      chipNames = await selectReferenceBindings(page, editor, bindings, true);
    }
    if (!referenceOrderMatches(chipNames, bindings)) {
      throw new Error('官网 @ 参考素材标签顺序与软件参考图顺序不一致，已阻止提交');
    }
    await insertTextBesideReference(page, editor, bindings[0].displayName, `${promptPrefix}\n`, 'before');
    for (const binding of bindings) {
      await insertTextBesideReference(page, editor, binding.displayName, `${binding.phrase}；\n`, 'after');
    }
    await restoreAgentEditorFocus(page, editor);
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(rawPrompt);
  } else {
    await editor.fill(`${promptPrefix}${rawPrompt}`);
  }
  const editorText = normalizeEditorText(await editor.innerText());
  const normalizedPrompt = normalizeEditorText(rawPrompt);
  const prefixIndex = editorText.indexOf(promptPrefix);
  const promptIndex = editorText.lastIndexOf(normalizedPrompt);
  if (prefixIndex < 0 || promptIndex < prefixIndex + promptPrefix.length) {
    throw new Error('即梦 Agent 输入框未完整保留固定前缀和分镜文案');
  }
  const attachmentSnapshot = await readReferenceAttachmentSnapshot(composer);
  if (attachmentSnapshot.count !== bindings.length || attachmentSnapshot.uploading > 0) {
    throw new Error('官网结构化参考素材数量与软件参考图数量不一致，已阻止提交');
  }
  const chipNames = await selectedReferenceNames(editor);
  if (!referenceOrderMatches(chipNames, bindings)) {
    throw new Error('官网 @ 参考素材标签顺序与软件参考图顺序不一致，已阻止提交');
  }
  let previousIndex = prefixIndex + promptPrefix.length;
  for (const binding of bindings) {
    const nameIndex = editorText.indexOf(binding.displayName, previousIndex);
    const phraseIndex = editorText.indexOf(`${binding.phrase}；`, previousIndex);
    if (nameIndex < previousIndex || phraseIndex < nameIndex || phraseIndex >= promptIndex) {
      throw new Error(`@${binding.displayName} 及其参考说明未位于固定指令之后、用户分镜之前`);
    }
    previousIndex = phraseIndex + binding.phrase.length + 1;
  }

  const boundNames = bindings.map((binding) => binding.displayName);
  const generatedCardCount = await generatedCanvasCards(page).count();

  await disableAgentTools(page, composer);
  ensureAgentSubmissionActive(shouldCancel);
  const collector = createCanvasResponseCollector(page);
  const requestPromise = page.waitForRequest((request) => (
    request.method() === 'POST' && request.url().includes('/mweb/v1/infinite_canvas/conversation')
  ), { timeout: 30000 });
  const submitButton = composer.locator('button[class*="submit-button"]:visible:not([disabled])').last();
  await submitButton.waitFor({ state: 'visible', timeout: 10000 });
  let acceptedSubmission = null;
  try {
    await submitButton.click();
    const submittedAt = Date.now();
    const request = await requestPromise;
    let payload = {};
    try { payload = request.postDataJSON() || {}; } catch { /* request was still submitted */ }
    if (!requestHasStructuredReferences(payload, bindings)) {
      throw new Error('官网请求未确认上传素材与 @ 芯片的结构化绑定，已阻止将该任务标记为正常提交');
    }

    const response = await request.response();
    if (!response?.ok()) throw new Error(`即梦 Agent 提交接口返回 ${response?.status() || '未知错误'}`);
    let responseBody = {};
    try { responseBody = await response.json() || {}; } catch { /* response can be empty */ }
    if (responseBody.ret != null && String(responseBody.ret) !== '0') {
      throw new Error(`即梦 Agent 提交失败：${responseBody.errmsg || responseBody.message || responseBody.ret}`);
    }

    const resolvedProjectId = projectIdFromPage(page) || String(payload.project_id || projectId || '').trim();
    const conversationId = String(payload.conversation_id || payload.messages?.[0]?.metadata?.conversation_id || '').trim();
    if (!resolvedProjectId) throw new Error('即梦 Agent 已发送请求，但未返回画布项目 ID');
    if (!conversationId) throw new Error('即梦 Agent 已发送请求，但未返回会话 ID');
    acceptedSubmission = {
      shotNo: task.shotNo,
      projectId: resolvedProjectId,
      workspaceId: resolvedProjectId,
      conversationId,
      submittedAt,
      referencesConfirmed: true,
      referencedSubjects: boundNames,
    };
    try {
      await onSubmissionAccepted?.(acceptedSubmission);
    } catch (error) {
      error.submissionAccepted = acceptedSubmission;
      throw error;
    }
    const tracked = await waitForConversationTask(page, collector, conversationId, acceptedSubmission);
    let cardRenameError = '';
    try {
      await renameGeneratedCard(page, generatedCardCount, task.shotNo);
    } catch (error) {
      cardRenameError = error.message || String(error);
    }
    const submitId = `dreamina-agent:${resolvedProjectId}:${conversationId}:${tracked.historyId || 'history'}`;
    return {
      ok: true,
      shotNo: task.shotNo,
      submitId,
      historyId: tracked.historyId,
      taskSubmitId: tracked.taskSubmitId,
      projectId: resolvedProjectId,
      workspaceId: resolvedProjectId,
      conversationId,
      submittedAt,
      referencesConfirmed: true,
      generationFailure: tracked.generationFailure || '',
      cardName: String(task.shotNo),
      cardRenameError,
      referencedSubjects: boundNames,
    };
  } catch (error) {
    if (acceptedSubmission && !error.submissionAccepted) error.submissionAccepted = acceptedSubmission;
    throw error;
  } finally {
    await collector.stop();
  }
}

async function refreshCanvasProject(page, expectedProjectId) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.bringToFront();
  await waitForAgentEditor(page, 30000);
  const projectId = projectIdFromPage(page);
  if (!projectId || (expectedProjectId && projectId !== String(expectedProjectId))) {
    throw new Error('刷新后未能回到原即梦画布项目');
  }
}

export async function submitVideos({
  shots = [],
  accountId = '',
  onProgress,
  onSubmitProgress,
  scopeKey = '',
  canvasProjectId = '',
  canvasProjectName = '',
  lastSubmittedAt = 0,
  shotIntervalSeconds = 80,
  onSubmissionAccepted,
  onShotResult,
  shouldCancel,
} = {}) {
  const tasks = Array.isArray(shots) ? shots : [];
  if (!tasks.length) return [];
  return enqueueBrowserOperation(async () => {
    const account = requireDreaminaAgentAccount(accountId);
    const results = [];
    const normalizedScope = String(scopeKey || '').trim();
    const accountScope = normalizedScope ? accountCacheKey(account.id, normalizedScope) : '';
    const normalizedCanvasProjectName = String(canvasProjectName || '').trim();
    const storedProjectId = String(canvasProjectId || (accountScope ? scopeProjects.get(accountScope) : '') || '').trim();
    let canvas;
    if (storedProjectId) {
      try {
        canvas = await openCanvasProject(account.id, storedProjectId);
      } catch (error) {
        if (error?.code === 'DREAMINA_AGENT_CANVAS_UNAVAILABLE') {
          onProgress?.('当前账号无法访问旧画布，正在创建该账号的新画布...');
        }
        canvas = await createCanvasProject(account.id);
      }
    } else {
      canvas = await createCanvasProject(account.id);
    }
    await ensureCanvasProjectName(canvas.page, normalizedCanvasProjectName);
    if (accountScope) scopeProjects.set(accountScope, canvas.projectId);

    let previousSubmittedAt = Math.max(
      Number(lastSubmittedAt) || 0,
      Number(accountScope ? scopeLastSubmittedAt.get(accountScope) : 0) || 0,
    );
    const normalizedShotIntervalSeconds = normalizeDreaminaAgentShotIntervalSeconds(shotIntervalSeconds);
    const shotIntervalMs = normalizedShotIntervalSeconds * 1000;
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      let submittedResult = null;
      try {
        ensureAgentSubmissionActive(shouldCancel);
        let waitedForInterval = false;
        if (previousSubmittedAt > 0) {
          const waitMs = Math.max(0, shotIntervalMs - (Date.now() - previousSubmittedAt));
          if (waitMs > 0) {
            onProgress?.(`即梦 Agent 分镜发送间隔为 ${normalizedShotIntervalSeconds} 秒，分镜 ${task.shotNo} 将在 ${Math.ceil(waitMs / 1000)} 秒后发送...`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            waitedForInterval = true;
          }
        }
        ensureAgentSubmissionActive(shouldCancel);
        if (index > 0 || waitedForInterval) {
          await refreshCanvasProject(canvas.page, canvas.projectId);
        }
        ensureAgentSubmissionActive(shouldCancel);

        onProgress?.(`即梦 Agent 正在同一画布提交分镜 ${task.shotNo}，并验证官网 @ 实体...`);
        submittedResult = await submitOneAgentVideo(canvas.page, canvas.projectId, task, {
          shouldCancel,
          onSubmissionAccepted: (accepted) => {
            accepted.canvasProjectName = normalizedCanvasProjectName;
            return onSubmissionAccepted?.(accepted, task);
          },
        });
        // A new canvas receives an automatic website title after its first
        // conversation. Rename only after that response so it cannot overwrite
        // the software project/episode name again.
        const savedCanvasProjectName = await ensureCanvasProjectName(canvas.page, normalizedCanvasProjectName);
        const result = { ...submittedResult, canvasProjectName: savedCanvasProjectName };
        results.push(result);
        previousSubmittedAt = Number(result.submittedAt) || Date.now();
        if (accountScope) scopeLastSubmittedAt.set(accountScope, previousSubmittedAt);
      } catch (error) {
        const acceptedResult = submittedResult?.projectId && submittedResult?.conversationId
          ? {
            shotNo: submittedResult.shotNo,
            projectId: submittedResult.projectId,
            workspaceId: submittedResult.workspaceId || submittedResult.projectId,
            conversationId: submittedResult.conversationId,
            submittedAt: submittedResult.submittedAt,
            referencesConfirmed: submittedResult.referencesConfirmed === true,
            referencedSubjects: submittedResult.referencedSubjects || [],
            canvasProjectName: normalizedCanvasProjectName,
          }
          : null;
        results.push({
          ok: false,
          shotNo: task.shotNo,
          projectId: canvas.projectId,
          workspaceId: canvas.projectId,
          error: error.message || String(error),
          submissionAccepted: error.submissionAccepted || acceptedResult,
        });
      }
      await onShotResult?.(results[results.length - 1], task);
      const processed = results.length;
      onSubmitProgress?.({ processed, total: tasks.length, submitted: results.filter((item) => item.ok).length });
    }
    return results;
  });
}

export function renameDreaminaAgentCanvasProject({ accountId = '', projectId, name } = {}) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedName = String(name || '').trim();
  if (!normalizedProjectId) return Promise.reject(new Error('缺少即梦 Agent 画布项目 ID'));
  if (!normalizedName) return Promise.reject(new Error('缺少即梦 Agent 画布项目名称'));
  return enqueueBrowserOperation(async () => {
    const account = requireDreaminaAgentAccount(accountId);
    const canvas = await openCanvasProject(account.id, normalizedProjectId);
    const savedName = await ensureCanvasProjectName(canvas.page, normalizedName);
    return { ok: true, accountId: account.id, projectId: canvas.projectId, name: savedName };
  });
}

export function closeDreaminaAgentBrowser({ accountId = '' } = {}) {
  return enqueueBrowserOperation(async () => {
    const targetId = String(accountId || '').trim();
    const sessions = targetId
      ? [...browserSessions.values()].filter((session) => session.accountId === targetId)
      : [...browserSessions.values()];
    for (const session of sessions) clearBrowserState(session.accountId, session.context);
    await Promise.allSettled(sessions.map((session) => session.context.close()));
    for (const session of sessions) releaseBrowserProfileLease(session.accountId, session.profileLease);
    return { ok: true };
  });
}

process.once('exit', () => {
  for (const [accountId, lease] of browserProfileLeases) releaseBrowserProfileLease(accountId, lease);
});

export function parseDreaminaAgentSubmitId(submitId) {
  const match = String(submitId || '').match(/^dreamina-agent:([^:]+):([^:]+)(?::([^:]+))?$/);
  return match ? {
    projectId: match[1],
    workspaceId: match[1],
    conversationId: match[2],
    historyId: match[3] && match[3] !== 'history' ? match[3] : '',
  } : null;
}

function historyRecordsFromResponses(records = []) {
  const output = new Map();
  for (const record of records) {
    if (record.endpoint === '/mweb/v1/get_history_by_ids') {
      for (const [historyId, history] of Object.entries(record.body?.data || {})) {
        if (history) output.set(String(historyId), history);
      }
    }
    if (record.endpoint === '/mweb/v1/infinite_canvas/fetch_conversation') {
      for (const history of conversationHistoryEntries(record.body)) {
        const historyId = String(history?.history_record_id || history?.task?.history_id || '');
        if (historyId) output.set(historyId, history);
      }
    }
  }
  return output;
}

function conversationHistoryIdsFromResponses(records = [], conversationId = '') {
  return observedConversationHistories(records, conversationId)
    .map((history) => String(history?.history_record_id || history?.task?.history_id || ''))
    .filter(Boolean);
}

export function extractDreaminaAgentHistoryResult(history = {}) {
  const failure = historyFailure(history);
  if (failure) return { status: 'failed', fail: failure, progress: 100 };
  const videoUrls = candidateVideoUrls(history, { includeGenericUrl: true });
  if (videoUrls.length) return { status: 'done', videoUrl: videoUrls[0], videoUrls, progress: 100 };
  return { status: 'queued' };
}

async function readCanvasProjectState(page, projectId) {
  const collector = createCanvasResponseCollector(page);
  try {
    const targetUrl = `${DREAMINA_AGENT_ORIGIN}/ai-tool/canvas/${encodeURIComponent(projectId)}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForAgentEditor(page, 30000);
    await page.waitForTimeout(8000);
    await collector.flush();
    return [...collector.records];
  } finally {
    await collector.stop();
  }
}

export async function confirmVideoSubmission({
  accountId = '',
  projectId = '',
  conversationId = '',
  historyId = '',
  taskSubmitId = '',
  submittedAt = 0,
} = {}) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedConversationId = String(conversationId || '').trim();
  if (!normalizedProjectId || !normalizedConversationId) {
    throw new Error('即梦 Agent 待确认任务缺少画布项目 ID 或会话 ID');
  }
  return enqueueBrowserOperation(async () => {
    const account = requireDreaminaAgentAccount(accountId);
    const page = await ensureAgentPage({ accountId: account.id });
    const records = await readCanvasProjectState(page, normalizedProjectId);
    const histories = historyRecordsFromResponses(records);
    const conversationHistories = observedConversationHistories(records, normalizedConversationId);
    const history = selectDreaminaAgentHistory(conversationHistories, {
      historyId,
      taskSubmitId,
      submittedAt,
    });
    const resolvedHistoryId = historyRecordId(history);
    if (!resolvedHistoryId || !histories.has(resolvedHistoryId)) {
      return {
        ok: false,
        accountId: account.id,
        pending: true,
        projectId: normalizedProjectId,
        conversationId: normalizedConversationId,
        error: '官网已接收该分镜，正在等待返回可跟踪的历史任务 ID',
      };
    }
    const resolvedHistory = histories.get(resolvedHistoryId) || history || {};
    return {
      ok: true,
      accountId: account.id,
      projectId: normalizedProjectId,
      workspaceId: normalizedProjectId,
      conversationId: normalizedConversationId,
      historyId: resolvedHistoryId,
      taskSubmitId: historyTaskSubmitId(resolvedHistory),
      submitId: `dreamina-agent:${normalizedProjectId}:${normalizedConversationId}:${resolvedHistoryId}`,
      generationFailure: historyFailure(resolvedHistory),
    };
  });
}

async function queryOneAgentResult(submitId, accountId) {
  const account = requireDreaminaAgentAccount(accountId);
  const parsed = parseDreaminaAgentSubmitId(submitId);
  if (!parsed) return { status: 'failed', fail: '无效的即梦 Agent 任务 ID' };
  const cacheKey = accountCacheKey(account.id, submitId);
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < RESULT_REFRESH_MS) return cached.result;

  const page = await ensureAgentPage({ accountId: account.id });
  const records = await readCanvasProjectState(page, parsed.projectId);
  const histories = historyRecordsFromResponses(records);
  let history = parsed.historyId ? histories.get(parsed.historyId) : null;
  if (!history) {
    const conversationHistoryIds = conversationHistoryIdsFromResponses(records, parsed.conversationId);
    history = conversationHistoryIds.map((historyId) => histories.get(historyId)).find(Boolean) || null;
  }
  const result = history
    ? extractDreaminaAgentHistoryResult(history)
    : { status: 'queued', fail: '官网画布尚未返回该分镜的历史任务' };
  resultCache.set(cacheKey, { checkedAt: Date.now(), result });
  return result;
}

export async function fetchVideoResults({ accountId = '', submitIds = [] } = {}) {
  const output = {};
  for (const submitId of submitIds) {
    try {
      output[submitId] = await enqueueBrowserOperation(() => queryOneAgentResult(submitId, accountId));
    } catch (error) {
      output[submitId] = { status: 'queued', fail: error.message || String(error) };
    }
  }
  return output;
}
