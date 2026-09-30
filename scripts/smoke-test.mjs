#!/usr/bin/env node
/**
 * Freedom 冒烟测试（不需要 Electron）
 *
 * 直接用后端起服务，再用无头浏览器把关键页面点一遍，收集 console 报错与页面异常。
 * 目的是把「改完点一遍」变成可重复的一条命令，给后续所有改动兜回归。
 *
 *   node scripts/smoke-test.mjs                 无头跑一遍
 *   node scripts/smoke-test.mjs --headful       显示浏览器窗口（排查问题时用）
 *   node scripts/smoke-test.mjs --port=19321    指定端口
 *   node scripts/smoke-test.mjs --keep          结束后保留临时数据目录
 *
 * 退出码：0 = 全部通过；1 = 有失败项。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const argValue = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(argValue('port', '19321'));
const HEADFUL = hasFlag('headful');
const KEEP = hasFlag('keep');
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE_ROOT = path.join(os.tmpdir(), `freedom-smoke-${Date.now()}`);

const issues = [];
const notes = [];
let server = null;
let browser = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(scope, detail) {
  issues.push(`[${scope}] ${detail}`);
  console.log(`  \x1b[31m✗\x1b[0m ${scope}：${detail}`);
}
function pass(text) {
  console.log(`  \x1b[32m✓\x1b[0m ${text}`);
}
function info(text) {
  notes.push(text);
  console.log(`  \x1b[33m•\x1b[0m ${text}`);
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { method: 'GET' });
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(300);
  }
  return false;
}

async function startBackend() {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  server = spawn(process.execPath, [path.join(ROOT, 'backend', 'serverProcess.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      GG_SERVER_PORT: String(PORT),
      GG_STORAGE_ROOT: STORAGE_ROOT,
      GG_INSTALL_DIR: ROOT,
      ELECTRON_RUN_AS_NODE: '',
      NODE_OPTIONS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) info(`后端输出：${text.split('\n').slice(-2).join(' ')}`);
  });
  server.once('exit', (code) => {
    if (code !== 0 && code !== null) fail('后端', `提前退出（code ${code}）`);
  });
}

async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: !HEADFUL });
    } catch { /* 换下一个 */ }
  }
  throw new Error('找不到可用的 Chrome / Edge，无法运行冒烟测试');
}

async function acceptLegalGate(page) {
  const gate = page.locator('.legal-gate-screen');
  if (!(await gate.count())) return false;
  await page.locator('.legal-gate-check').click();
  await page.locator('.legal-gate-actions button').last().click();
  await gate.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  return true;
}

async function clickRail(page, label) {
  await page.locator(`.side-rail .rail-item:has-text("${label}")`).first().click();
  await page.waitForTimeout(400);
}

const VIEWS = [
  { label: '项目', expect: '.page--projects' },
  { label: '写小说', expect: '.novel-page' },
  { label: '画布', expect: '.page--canvas-library' },
  { label: '封面生成', expect: '.cover-studio' },
  { label: '一键切割', expect: '.video-split-studio' },
  { label: '任务中心', expect: '.page--tasks' },
  { label: '设置', expect: '.settings-layout' },
  { label: '聊天', expect: '.chat-workspace' },
  { label: '项目', expect: '.page--projects' },
];

async function run() {
  console.log(`\n\x1b[1mFreedom 冒烟测试\x1b[0m  ${BASE}\n`);

  await startBackend();
  if (!(await waitForServer())) throw new Error('后端服务启动超时');
  pass('后端已就绪');

  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (await acceptLegalGate(page)) pass('已通过使用条款页');

  console.log('\n\x1b[1m逐页检查\x1b[0m');
  for (const view of VIEWS) {
    const before = consoleErrors.length;
    try {
      await clickRail(page, view.label);
      await page.locator(view.expect).first().waitFor({ state: 'visible', timeout: 8000 });
      const fresh = consoleErrors.slice(before);
      if (fresh.length) fail(view.label, `渲染时 console 报错：${fresh[0].slice(0, 140)}`);
      else pass(`${view.label} → ${view.expect}`);
    } catch (error) {
      fail(view.label, `未渲染出 ${view.expect}（${error.message.split('\n')[0]}）`);
    }
  }

  // 画布库离开后必须隐藏：曾经因为丢了 .canvas-library-view 类，停靠的库会盖住其它页面。
  console.log('\n\x1b[1m画布专项\x1b[0m');
  try {
    await clickRail(page, '画布');
    await page.locator('.page--canvas-library').waitFor({ state: 'visible', timeout: 8000 });

    // 临时的数据目录是空的，先建一张画布，才能真的走一遍「库 → 编辑器 → 所有画布」。
    let cardCount = await page.locator('.canvas-project-card').count();
    if (!cardCount) {
      const actions = page.locator('.page--canvas-library .page-head-actions');
      await actions.locator('input').fill('冒烟测试画布');
      await actions.locator('button:has-text("新建空白画布")').click();
      await page.locator('.canvas-editor-view').waitFor({ state: 'visible', timeout: 10000 });
      pass('新建画布 → 进入编辑器');
      cardCount = 1;
    } else {
      await page.locator('.canvas-project-card').first().click();
      await page.locator('.canvas-editor-view').waitFor({ state: 'visible', timeout: 8000 });
      pass('进入画布编辑器');
    }
    info(`画布项目 ${cardCount} 个`);

    await page.locator('.canvas-back-text').click();
    await page.locator('.page--canvas-library').waitFor({ state: 'visible', timeout: 8000 });
    pass('「所有画布」回到列表');

    await clickRail(page, '项目');
    await page.waitForTimeout(500);
    const parkedVisible = await page.locator('.page--canvas-library').isVisible().catch(() => false);
    if (parkedVisible) fail('画布', '离开画布后，画布列表仍然可见（park 隐藏失效）');
    else pass('离开画布后列表已正确隐藏');
  } catch (error) {
    fail('画布', error.message.split('\n')[0]);
  }

  // Agent 抽屉：应能打开，并显示能力说明与示例。
  console.log('\n\x1b[1mAgent 抽屉\x1b[0m');
  try {
    await page.locator('.rail-foot .rail-agent').click();
    await page.locator('.agent-drawer').waitFor({ state: 'visible', timeout: 8000 });
    const caps = await page.locator('.agent-cap').count();
    const examples = await page.locator('.agent-example').count();
    if (caps >= 4 && examples >= 3) pass(`能力卡 ${caps} 张 / 示例 ${examples} 条`);
    else fail('Agent', `空状态说明缺失（能力 ${caps} / 示例 ${examples}）`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } catch (error) {
    fail('Agent', error.message.split('\n')[0]);
  }

  if (consoleErrors.length) {
    console.log('\n\x1b[1m全部 console 报错\x1b[0m');
    for (const text of [...new Set(consoleErrors)].slice(0, 20)) console.log(`  - ${text.slice(0, 200)}`);
  }

  await context.close();
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (server && !server.killed) {
    server.kill();
    // 后端要一点时间释放 SQLite 句柄，否则删临时目录会 EBUSY。
    await sleep(900);
  }
  if (KEEP) {
    console.log(`\n临时数据保留在：${STORAGE_ROOT}`);
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(STORAGE_ROOT, { recursive: true, force: true });
      return;
    } catch {
      await sleep(500);
    }
  }
  info(`临时数据目录没删干净（不影响结果）：${STORAGE_ROOT}`);
}

try {
  await run();
} catch (error) {
  fail('运行', error.message);
}
await cleanup();

console.log('');
if (issues.length) {
  console.log(`\x1b[31m冒烟测试失败：${issues.length} 项\x1b[0m`);
  for (const item of issues) console.log(`  - ${item}`);
  process.exit(1);
}
console.log('\x1b[32m冒烟测试通过\x1b[0m');
process.exit(0);
