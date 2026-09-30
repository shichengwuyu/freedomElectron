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

export function dreaminaAgentBrowserLeasePath(profileDirectory) {
  return `${path.resolve(String(profileDirectory || ''))}.hepai-browser.lock`;
}

export function acquireDreaminaAgentBrowserLease({ profileDirectory, accountId = '' } = {}) {
  const requestedProfile = String(profileDirectory || '').trim();
  if (!requestedProfile) throw new Error('缺少即梦 Agent 浏览器资料目录');
  const resolvedProfile = path.resolve(requestedProfile);
  const lockPath = dreaminaAgentBrowserLeasePath(resolvedProfile);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const handle = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(handle, JSON.stringify({
          pid: process.pid,
          token,
          accountId: String(accountId || ''),
          profileDirectory: resolvedProfile,
          createdAt: Date.now(),
        }));
      } finally {
        fs.closeSync(handle);
      }
      let released = false;
      return {
        lockPath,
        profileDirectory: resolvedProfile,
        release() {
          if (released) return;
          released = true;
          try {
            const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            if (current.token === token && Number(current.pid) === process.pid) {
              fs.rmSync(lockPath, { force: true });
            }
          } catch { /* already released or replaced */ }
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* malformed lock is stale */ }
      if (processIsRunning(owner?.pid)) {
        const busy = new Error(`即梦 Agent 专用浏览器正在由另一个后台服务使用（PID ${owner.pid}）`);
        busy.code = 'DREAMINA_AGENT_BROWSER_BUSY';
        busy.ownerPid = Number(owner.pid);
        throw busy;
      }
      try { fs.rmSync(lockPath, { force: true }); } catch {
        const busy = new Error('即梦 Agent 专用浏览器资料暂时被占用');
        busy.code = 'DREAMINA_AGENT_BROWSER_BUSY';
        throw busy;
      }
    }
  }
  const busy = new Error('即梦 Agent 专用浏览器资料暂时被占用');
  busy.code = 'DREAMINA_AGENT_BROWSER_BUSY';
  throw busy;
}
