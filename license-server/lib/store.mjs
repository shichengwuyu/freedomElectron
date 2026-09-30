// 账号存储：单文件 JSON + scrypt 密码哈希 + 原子写。
// 规模是"自己发授权"的量级（几百到几千个账号），不需要数据库。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function createStore({ filePath }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw && Array.isArray(raw.accounts)) return raw;
    } catch { /* 首次运行或文件损坏 */ }
    return { schemaVersion: SCHEMA_VERSION, accounts: [] };
  }

  function write(data) {
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  function scryptOptions() {
    return { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * 1024 * 1024 };
  }

  function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, SCRYPT.keylen, scryptOptions());
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  function verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    let actual;
    try {
      actual = crypto.scryptSync(password, salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
    } catch {
      return false;
    }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  // 用户名不存在也跑一次 scrypt，避免用响应时间探测账号是否存在。
  function burnPasswordCheck() {
    try { crypto.scryptSync('invalid', 'invalid-salt', SCRYPT.keylen, scryptOptions()); } catch { /* ignore */ }
  }

  function findByUsername(username) {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return null;
    return read().accounts.find((account) => account.usernameLower === key) || null;
  }

  function list() {
    return read().accounts;
  }

  function makeAccount(username, password) {
    return {
      id: crypto.randomUUID(),
      username: String(username).trim(),
      usernameLower: String(username).trim().toLowerCase(),
      passwordHash: hashPassword(password),
      status: 'pending',
      plan: 'standard',
      features: [],
      entitlementExpiresAt: null,
      devices: [],
      createdAt: new Date().toISOString(),
      approvedAt: null,
      lastLoginAt: null,
      note: '',
    };
  }

  function add(account) {
    const data = read();
    data.accounts.push(account);
    write(data);
    return account;
  }

  function update(username, mutator) {
    const data = read();
    const key = String(username || '').trim().toLowerCase();
    const index = data.accounts.findIndex((account) => account.usernameLower === key);
    if (index < 0) return null;
    const next = mutator(data.accounts[index]);
    if (!next) return null;
    data.accounts[index] = next;
    write(data);
    return next;
  }

  // 已经登录过的设备直接复用它的 deviceGrant；新设备在额度内分配一个新的。
  function resolveDevice(account, machineCodeHash, { maxDevices }) {
    const existing = (account.devices || []).find((device) => device.hash === machineCodeHash);
    if (existing) return { ok: true, device: existing, reused: true, devices: account.devices };
    if ((account.devices || []).length >= maxDevices) return { ok: false, reason: 'DEVICE_LIMIT' };
    const device = {
      hash: machineCodeHash,
      grant: crypto.randomUUID(),
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    return { ok: true, device, reused: false, devices: [...(account.devices || []), device] };
  }

  return {
    filePath,
    list,
    findByUsername,
    verifyPassword,
    burnPasswordCheck,
    makeAccount,
    add,
    update,
    resolveDevice,
    hashPassword,
  };
}
