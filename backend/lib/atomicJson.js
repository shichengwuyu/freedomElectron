import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJsonFile(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

export function writeFileAtomic(file, content, options = {}) {
  ensureDir(path.dirname(file));
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${suffix}`);
  try {
    fs.writeFileSync(tempFile, content, { mode: 0o600, ...options });
    const tempHandle = fs.openSync(tempFile, 'r+');
    try { fs.fsyncSync(tempHandle); } finally { fs.closeSync(tempHandle); }
    const maxRetries = process.platform === 'win32' ? 120 : 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(tempFile, file);
        break;
      } catch (error) {
        const retryable = ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);
        if (!retryable || attempt >= maxRetries) throw error;
        // Windows 下杀软/索引服务对高频小 json 的扫描锁可能持续数秒，旧实现总窗口约 2 秒会被
        // EPERM 突破（2026-09-10 .dreamina-agent.json 旧任务清理失败）。指数退避 + 上限 100ms，
        // 总窗口约 9 秒。
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(100, 5 * (attempt + 1) + (attempt % 7) * 3));
      }
    }
    if (process.platform !== 'win32') {
      let directoryHandle;
      try {
        directoryHandle = fs.openSync(path.dirname(file), 'r');
        fs.fsyncSync(directoryHandle);
      } catch (error) {
        if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) throw error;
      } finally {
        if (directoryHandle != null) fs.closeSync(directoryHandle);
      }
    }
  } finally {
    try { fs.rmSync(tempFile, { force: true }); } catch { /* ignore */ }
  }
}

export function writeJsonAtomic(file, data) {
  writeFileAtomic(file, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  return data;
}

export function copyDirectory(source, destination, { filter } = {}) {
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (filter && !filter(from, to, entry)) continue;
    if (entry.isDirectory()) copyDirectory(from, to, { filter });
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
  return destination;
}

export function moveDirectory(source, destination) {
  ensureDir(path.dirname(destination));
  try {
    fs.renameSync(source, destination);
  } catch {
    copyDirectory(source, destination);
    fs.rmSync(source, { recursive: true, force: true });
  }
  return destination;
}
