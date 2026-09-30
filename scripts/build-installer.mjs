#!/usr/bin/env node
/**
 * Freedom 一键打包脚本（Windows）
 *
 * 平时直接双击项目根目录的 build-installer.bat 即可；也可以手动传参数：
 *   node scripts/build-installer.mjs                    默认 patch 递增：1.1.29 -> 1.1.30
 *   node scripts/build-installer.mjs --bump=minor       次版本递增：1.1.29 -> 1.2.0
 *   node scripts/build-installer.mjs --bump=major       主版本递增：1.1.29 -> 2.0.0
 *   node scripts/build-installer.mjs --bump=none        版本号不变（会覆盖同名安装包）
 *   node scripts/build-installer.mjs --version=2.0.1    直接指定版本号（优先于 --bump）
 *   node scripts/build-installer.mjs --no-checks        跳过打包前的语法自检
 *   node scripts/build-installer.mjs --out=release-2    换一个产物目录（默认 release）
 *   node scripts/build-installer.mjs --check-only       只做自检，不打包
 *   node scripts/build-installer.mjs --open             打包完成后自动打开 release 目录
 *
 * 流程：环境检查 -> 语法自检 -> 版本递增 -> electron-builder --win nsis -> 产出报告
 * 打包失败时会把 package.json 的版本号回滚到改动前的值。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 默认产物目录；可用 --out=<dir> 覆盖（例如旧目录被别的程序占用时换一个）。
const DEFAULT_RELEASE_DIR = path.join(ROOT, 'release');
const PKG_PATH = path.join(ROOT, 'package.json');
const TOTAL_STEPS = 5;

// ---------------------------------------------------------------- 输出工具
const rule = (char = '-') => console.log(char.repeat(64));
const step = (n, title) => { console.log(''); rule('='); console.log(`[${n}/${TOTAL_STEPS}] ${title}`); rule('='); };
const info = (text) => console.log(`  ${text}`);
const ok = (text) => console.log(`  [OK]   ${text}`);
const warn = (text) => console.log(`  [WARN] ${text}`);
const bad = (text) => console.log(`  [FAIL] ${text}`);

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '未知';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDuration(ms) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${(seconds % 60).toFixed(0)} 秒`;
}

// ---------------------------------------------------------------- 参数
function parseArgs(argv) {
  const read = (name, fallback) => {
    const hit = argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) return fallback;
    const eq = hit.indexOf('=');
    return eq >= 0 ? hit.slice(eq + 1) : true;
  };
  return {
    bump: String(read('bump', 'patch')),
    version: String(read('version', '') || '').trim(),
    out: String(read('out', '') || '').trim(),
    noChecks: read('no-checks', false) === true,
    checkOnly: read('check-only', false) === true,
    open: read('open', false) === true,
  };
}

function nextVersion(current, mode) {
  const match = String(current).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`无法解析当前版本号：${current}`);
  let [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  switch (mode) {
    case 'major': major += 1; minor = 0; patch = 0; break;
    case 'minor': minor += 1; patch = 0; break;
    case 'patch': patch += 1; break;
    case 'none': break;
    default: throw new Error(`--bump 只支持 patch / minor / major / none，收到：${mode}`);
  }
  return `${major}.${minor}.${patch}`;
}

// ---------------------------------------------------------------- 环境
// electron-builder 打包时需要下载 winCodeSign / nsis 等构建资源，默认源是 github.com。
// 国内网络经常直连不上（实测 github.com 请求会挂满 600 秒后超时失败），
// 因此默认指向 npmmirror 的二进制镜像；外部若已显式设置同名变量则以外部为准。
const BINARIES_MIRROR = 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/';
const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';

function buildEnv() {
  const env = { ...process.env };
  // 项目约定：NODE_OPTIONS 会干扰 electron-builder 与 electron，打包前必须清掉。
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_OPTIONS') delete env[key];
  }
  if (!env.ELECTRON_BUILDER_BINARIES_MIRROR) env.ELECTRON_BUILDER_BINARIES_MIRROR = BINARIES_MIRROR;
  if (!env.ELECTRON_MIRROR) env.ELECTRON_MIRROR = ELECTRON_MIRROR;
  return env;
}

function checkEnvironment() {
  const required = [
    ['node_modules/electron-builder/out/cli/cli.js', 'electron-builder'],
    ['node_modules/electron/dist/electron.exe', 'electron 运行时'],
    ['vendor/ffmpeg/ffmpeg.exe', 'ffmpeg（随包分发）'],
    ['vendor/ffmpeg/ffprobe.exe', 'ffprobe（随包分发）'],
    ['assets/yanzhi-icon.ico', '应用图标'],
    ['electron/main.js', '主进程入口'],
    ['backend/serverProcess.js', '后端入口'],
  ];
  const missing = [];
  for (const [relative, label] of required) {
    if (!fs.existsSync(path.join(ROOT, relative))) missing.push(`${label} → ${relative}`);
  }
  return missing;
}

// ---------------------------------------------------------------- 语法自检
function collectJavaScriptFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJavaScriptFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

async function checkSyntax(files, concurrency = 8) {
  const failures = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const file = files[cursor];
      cursor += 1;
      try {
        await execFileAsync(process.execPath, ['--check', file], { cwd: ROOT });
      } catch (error) {
        const detail = String(error?.stderr || error?.message || '').trim().split('\n').slice(0, 3).join(' ');
        failures.push({ file: path.relative(ROOT, file), detail });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length || 1)) }, worker));
  return failures;
}

// ---------------------------------------------------------------- 产物
function listInstallers(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^Freedom Setup .*\.exe$/i.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

// electron-builder 的目标目录里，win-unpacked/resources/app.asar 被其他程序持有句柄时
// （资源管理器停在该目录、杀软扫描、网盘同步客户端等），解压阶段会报 EBUSY / EPERM。
// 识别这类错误，好在失败时自动换一个干净目录重试。
function isFileLockError(text) {
  return /EBUSY|EPERM|resource busy or locked|operation not permitted/i.test(String(text || ''));
}

// 运行 electron-builder：输出实时透传到控制台，同时留存一份文本用于错误判断。
function runElectronBuilder(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const forward = (chunk, stream) => {
      const text = chunk.toString();
      output += text;
      stream.write(chunk);
    };
    child.stdout.on('data', (chunk) => forward(chunk, process.stdout));
    child.stderr.on('data', (chunk) => forward(chunk, process.stderr));
    child.on('error', (error) => resolve({ code: -1, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

function openInExplorer(target) {
  try {
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    warn('无法自动打开资源管理器，请手动查看 release 目录。');
  }
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const outputDir = options.out ? path.resolve(ROOT, options.out) : DEFAULT_RELEASE_DIR;

  console.log('');
  rule('=');
  console.log('  Freedom 安装包构建脚本');
  rule('=');
  info(`项目目录：${ROOT}`);
  info(`产物目录：${outputDir}`);
  info(`构建模式：${options.checkOnly ? '仅自检（不打包）' : '完整打包'}`);

  // 1. 环境检查
  step(1, '环境检查');
  const missing = checkEnvironment();
  if (missing.length) {
    bad('缺少必要文件，请先执行 npm install 并确认仓库完整：');
    missing.forEach((item) => info(`- ${item}`));
    throw new Error('环境检查未通过');
  }
  ok('依赖、ffmpeg 资源、图标与入口文件齐全');

  // 2. 语法自检
  step(2, '语法自检');
  if (options.noChecks) {
    warn('已通过 --no-checks 跳过语法自检');
  } else {
    const targets = [
      ...collectJavaScriptFiles(path.join(ROOT, 'electron')),
      ...collectJavaScriptFiles(path.join(ROOT, 'backend')),
      ...collectJavaScriptFiles(path.join(ROOT, 'frontend')),
    ];
    info(`扫描 ${targets.length} 个 .js 文件……`);
    const failures = await checkSyntax(targets);
    if (failures.length) {
      bad(`发现 ${failures.length} 个文件存在语法错误，已中止打包：`);
      failures.slice(0, 20).forEach((item) => {
        info(`- ${item.file}`);
        console.log(`      ${item.detail}`);
      });
      if (failures.length > 20) info(`……另有 ${failures.length - 20} 个未显示`);
      throw new Error('语法自检未通过');
    }
    ok(`${targets.length} 个文件全部通过`);
  }

  if (options.checkOnly) {
    console.log('');
    rule('=');
    ok('仅自检模式结束，未执行打包。');
    return 0;
  }

  // 3. 版本号
  step(3, '版本号');
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const previousVersion = String(pkg.version || '').trim();
  const targetVersion = options.version
    ? options.version.replace(/^v/i, '')
    : nextVersion(previousVersion, options.bump);
  if (!/^\d+\.\d+\.\d+/.test(targetVersion)) {
    throw new Error(`版本号格式不正确：${targetVersion}（应形如 1.1.30）`);
  }
  info(`当前版本：${previousVersion}`);
  info(`目标版本：${targetVersion}${options.version ? '（--version 指定）' : `（--bump=${options.bump}）`}`);
  if (targetVersion !== previousVersion) {
    pkg.version = targetVersion;
    fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    ok('package.json 已更新');
  } else {
    ok('版本号保持不变');
  }

  // 4. 打包
  step(4, '执行打包（electron-builder --win nsis）');
  info('这一步通常需要 2～6 分钟，请勿关闭窗口……');
  console.log('');
  const cliPath = path.join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  const buildEnvVars = buildEnv();
  info(`构建资源镜像：${buildEnvVars.ELECTRON_BUILDER_BINARIES_MIRROR}`);

  const buildInto = (dir) => {
    const args = [cliPath, '--win', 'nsis'];
    const relative = path.relative(ROOT, dir).split(path.sep).join('/') || '.';
    if (dir !== DEFAULT_RELEASE_DIR) args.push(`-c.directories.output=${relative}`);
    return runElectronBuilder(args, buildEnvVars);
  };

  const buildStartedAt = Date.now();
  let usedDir = outputDir;
  let attempt = await buildInto(usedDir);

  // 撞到目录占用（EBUSY/EPERM）时自动换一个干净目录重试一次，不让用户去揪占用进程。
  if (attempt.code !== 0 && !options.out && usedDir === DEFAULT_RELEASE_DIR && isFileLockError(attempt.output)) {
    console.log('');
    warn('默认产物目录被其他程序占用（app.asar 被锁定），自动改用 release-build 目录重试……');
    console.log('');
    usedDir = path.join(ROOT, 'release-build');
    attempt = await buildInto(usedDir);
  }
  console.log('');

  if (attempt.code !== 0) {
    if (targetVersion !== previousVersion) {
      pkg.version = previousVersion;
      fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      warn(`打包失败，版本号已回滚为 ${previousVersion}`);
    }
    throw new Error(`electron-builder 退出码 ${attempt.code}`);
  }
  ok(`打包完成，用时 ${formatDuration(Date.now() - buildStartedAt)}`);
  if (usedDir !== outputDir) info(`实际产物目录：${usedDir}`);

  // 5. 产出报告
  step(5, '产出');
  const installerName = `Freedom Setup ${targetVersion}.exe`;
  let installerPath = path.join(usedDir, installerName);
  if (fs.existsSync(installerPath) && usedDir !== DEFAULT_RELEASE_DIR) {
    // 用了兜底目录时，把安装包复制回惯用的 release 目录，方便直接拿去分发。
    try {
      fs.mkdirSync(DEFAULT_RELEASE_DIR, { recursive: true });
      fs.copyFileSync(installerPath, path.join(DEFAULT_RELEASE_DIR, installerName));
      installerPath = path.join(DEFAULT_RELEASE_DIR, installerName);
      info('安装包已复制回 release 目录。');
    } catch (error) {
      warn(`复制到 release 目录失败（${error.message}），请从上面的实际产物目录取包。`);
    }
  }
  if (fs.existsSync(installerPath)) {
    const stat = fs.statSync(installerPath);
    ok(`安装包：${installerName}`);
    info(`路径：${installerPath}`);
    info(`大小：${formatSize(stat.size)}`);
    info(`时间：${stat.mtime.toLocaleString('zh-CN')}`);
  } else {
    warn(`未找到预期的 ${installerName}，请检查 ${usedDir} 目录。`);
  }
  const portableDir = path.join(usedDir, 'win-unpacked');
  if (fs.existsSync(portableDir)) {
    info(`免安装版：${portableDir}`);
  }

  const installers = listInstallers(options.out ? usedDir : DEFAULT_RELEASE_DIR);
  if (installers.length) {
    const totalBytes = installers.reduce((sum, item) => sum + item.size, 0);
    console.log('');
    info(`产物目录下现有 ${installers.length} 个安装包，合计 ${formatSize(totalBytes)}：`);
    installers.slice(0, 8).forEach((item) => {
      info(`- ${item.name}  ${formatSize(item.size)}  ${item.mtime.toLocaleString('zh-CN')}`);
    });
    if (installers.length > 8) info(`……另有 ${installers.length - 8} 个`);
    if (installers.length > 3) warn('历史安装包会持续占用磁盘，不需要的可以手动删除。');
  }

  console.log('');
  rule('=');
  ok(`全部完成，总用时 ${formatDuration(Date.now() - startedAt)}`);
  rule('=');
  console.log('');

  if (options.open) openInExplorer(outputDir);
  return 0;
}

main()
  .then((code) => { process.exitCode = code ?? 0; })
  .catch((error) => {
    console.log('');
    bad(error?.message || String(error));
    console.log('');
    process.exitCode = 1;
  });
