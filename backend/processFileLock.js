import fs from 'fs';
import path from 'path';

function processIsRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function acquireProcessFileLock(lockPath) {
  const rawPath = String(lockPath || '').trim();
  if (!rawPath) throw new Error('Lock path is required');
  const resolvedPath = path.resolve(rawPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(resolvedPath, 'wx');
      try {
        fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      } finally {
        fs.closeSync(handle);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const owner = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
          if (Number(owner.pid) === process.pid && owner.token === token) {
            fs.rmSync(resolvedPath, { force: true });
          }
        } catch { /* already released or replaced */ }
      };
    } catch (error) {
      if (!['EEXIST', 'EACCES', 'EPERM'].includes(error?.code)) throw error;
      let ownerPid = 0;
      try {
        ownerPid = Number(JSON.parse(fs.readFileSync(resolvedPath, 'utf8')).pid) || 0;
      } catch { /* an incomplete lock is treated as stale */ }
      if (processIsRunning(ownerPid)) return null;
      try {
        fs.rmSync(resolvedPath, { force: true });
      } catch {
        return null;
      }
    }
  }
  return null;
}
