#!/usr/bin/env node
/**
 * Freedom 授权服务端（只做注册 + 登录 + 续期，无卡密）
 *
 *   node license-server/server.mjs
 *   node license-server/server.mjs --config=license-server/config.json
 *
 * 客户端在 backend/license.js 里调这三个接口，并且强制 HTTPS：
 *   POST /v1/accounts/register   { username, password }
 *   POST /v1/accounts/login      { username, password, machineCode, appVersion, clientSessionId }
 *   POST /v1/licenses/validate   { lease, machineCode, appVersion, clientSessionId }
 *
 * 生产环境建议：本服务监听 127.0.0.1:PORT（明文），前面用 nginx/Caddy 做 HTTPS
 * 终止（xiaoyxiao.xyz 用 Let's Encrypt 免费证书）。也可以直接在本服务里配 tls。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildClaims, createLeaseSigner, licensePublicKeyId, machineCodeHash, normalizeMachineCode } from './lib/lease.mjs';
import { createStore } from './lib/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(HERE, 'config.json');
const CLIENT_PUBLIC_KEY_PATH = path.join(HERE, '..', 'backend', 'license-public-key.pem');
const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function loadConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  return {
    port: Number(config.port) || 8787,
    host: String(config.host || '127.0.0.1'),
    issuer: String(config.issuer || 'gg-license-server'),
    audience: String(config.audience || 'com.gg.studio'),
    leaseTtlDays: Math.max(1, Number(config.leaseTtlDays) || 7),
    autoApproveSignups: config.autoApproveSignups !== false,
    maxDevicesPerAccount: Math.max(1, Number(config.maxDevicesPerAccount) || 2),
    tls: { enabled: false, certPath: '', keyPath: '', ...(config.tls || {}) },
    dataDir: config.dataDir ? path.resolve(HERE, config.dataDir) : path.join(HERE, 'data'),
    keysDir: config.keysDir ? path.resolve(HERE, config.keysDir) : path.join(HERE, 'keys'),
  };
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (code, message = '') => ({ ok: false, error: { code, message } });

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error('BODY_INVALID_JSON')); }
    });
    req.on('aborted', () => reject(new Error('BODY_ABORTED')));
    req.on('error', reject);
  });
}

function validateUsername(value) {
  const username = String(value || '').trim();
  const length = Array.from(username).length;
  if (length < 1 || length > 64) return { ok: false, message: '用户名必须为 1-64 个字符。' };
  return { ok: true, username };
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 5 || value.length > 128) {
    return { ok: false, message: '密码必须为 5-128 个字符。' };
  }
  return { ok: true };
}

function createRateLimiter() {
  const buckets = new Map();
  return {
    // 返回 true 表示已超限
    hit(key) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.startedAt > LOGIN_WINDOW_MS) {
        buckets.set(key, { startedAt: now, count: 1 });
        return false;
      }
      bucket.count += 1;
      return bucket.count > LOGIN_MAX_FAILURES;
    },
    clear(key) { buckets.delete(key); },
  };
}

function createApp({ config, store, signer, publicKeyPath }) {
  const limiter = createRateLimiter();
  const leaseTtlMs = config.leaseTtlDays * 24 * 60 * 60 * 1000;

  function issueLease(account, machineCode, devices) {
    const device = devices.find((item) => item.hash === machineCodeHash(machineCode));
    const claims = buildClaims({
      accountId: account.id,
      machineCode,
      deviceGrant: device?.grant || crypto.randomUUID(),
      issuer: config.issuer,
      audience: config.audience,
      ttlMs: leaseTtlMs,
      plan: account.plan || 'standard',
      features: Array.isArray(account.features) ? account.features : [],
      entitlementExpiresAt: account.entitlementExpiresAt || null,
    });
    return { lease: signer.sign(claims), expiresAt: new Date(claims.exp * 1000).toISOString() };
  }

  async function handleRegister(req, res) {
    const body = await readJsonBody(req);
    const usernameCheck = validateUsername(body.username);
    if (!usernameCheck.ok) return sendJson(res, 400, fail('VALIDATION_ERROR', usernameCheck.message));
    const passwordCheck = validatePassword(body.password);
    if (!passwordCheck.ok) return sendJson(res, 400, fail('VALIDATION_ERROR', passwordCheck.message));
    if (store.findByUsername(usernameCheck.username)) {
      return sendJson(res, 409, fail('USERNAME_TAKEN'));
    }
    const account = store.makeAccount(usernameCheck.username, body.password);
    if (config.autoApproveSignups) {
      account.status = 'active';
      account.approvedAt = new Date().toISOString();
    }
    store.add(account);
    console.log(`[register] ${account.username} → ${account.status}`);
    return sendJson(res, 200, ok({ data: { username: account.username, status: account.status } }));
  }

  async function handleLogin(req, res) {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const machineCode = normalizeMachineCode(body.machineCode);
    const rateKey = `${req.socket.remoteAddress}|${username.toLowerCase()}`;
    if (limiter.hit(rateKey)) return sendJson(res, 429, fail('RATE_LIMITED'));
    if (!username || typeof body.password !== 'string') {
      return sendJson(res, 401, fail('INVALID_CREDENTIALS'));
    }
    if (machineCode.length < 8 || machineCode.length > 256) {
      return sendJson(res, 400, fail('VALIDATION_ERROR', 'machineCode must contain 8-256 characters'));
    }

    const account = store.findByUsername(username);
    if (!account) {
      store.burnPasswordCheck();
      return sendJson(res, 401, fail('INVALID_CREDENTIALS'));
    }
    if (!store.verifyPassword(body.password, account.passwordHash)) {
      return sendJson(res, 401, fail('INVALID_CREDENTIALS'));
    }
    limiter.clear(rateKey);

    if (account.status === 'revoked') return sendJson(res, 403, fail('ACCOUNT_REVOKED'));
    if (account.status !== 'active') return sendJson(res, 403, fail('ACCOUNT_PENDING'));
    if (account.entitlementExpiresAt && Date.parse(account.entitlementExpiresAt) < Date.now()) {
      return sendJson(res, 403, fail('LICENSE_EXPIRED'));
    }

    const resolved = store.resolveDevice(account, machineCodeHash(machineCode), {
      maxDevices: config.maxDevicesPerAccount,
    });
    if (!resolved.ok) return sendJson(res, 403, fail(resolved.reason, '该账号已达到授权设备数量上限。'));

    const updated = store.update(account.username, (current) => ({
      ...current,
      devices: resolved.devices.map((device) => (
        device.hash === resolved.device.hash
          ? { ...device, lastSeenAt: new Date().toISOString(), appVersion: String(body.appVersion || '') }
          : device
      )),
      lastLoginAt: new Date().toISOString(),
    })) || account;

    const { lease, expiresAt } = issueLease(updated, machineCode, resolved.devices);
    console.log(`[login] ${updated.username} ${resolved.reused ? '（已登记设备）' : '（新设备）'} exp=${expiresAt}`);
    return sendJson(res, 200, ok({
      lease,
      account: { username: updated.username, plan: updated.plan || 'standard' },
      serverTime: new Date().toISOString(),
    }));
  }

  async function handleValidate(req, res) {
    const body = await readJsonBody(req);
    const machineCode = normalizeMachineCode(body.machineCode);
    const verified = signer.verify(String(body.lease || ''), { allowExpired: true });
    if (!verified.ok) return sendJson(res, 401, fail(verified.reason));

    const claims = verified.claims;
    if (claims.deviceHash !== machineCodeHash(machineCode)) {
      return sendJson(res, 403, fail('DEVICE_MISMATCH'));
    }
    const account = store.list().find((item) => item.id === claims.sub);
    if (!account) return sendJson(res, 404, fail('LICENSE_NOT_FOUND'));
    if (account.status === 'revoked') return sendJson(res, 403, fail('LICENSE_REVOKED'));
    if (account.status !== 'active') return sendJson(res, 403, fail('ACCOUNT_NOT_APPROVED'));
    if (account.entitlementExpiresAt && Date.parse(account.entitlementExpiresAt) < Date.now()) {
      return sendJson(res, 403, fail('LICENSE_EXPIRED'));
    }

    const resolved = store.resolveDevice(account, claims.deviceHash, {
      maxDevices: config.maxDevicesPerAccount,
    });
    if (!resolved.ok) return sendJson(res, 403, fail(resolved.reason));

    const { lease } = issueLease(account, machineCode, resolved.devices);
    return sendJson(res, 200, ok({ lease, serverTime: new Date().toISOString() }));
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && p === '/health') {
        return sendJson(res, 200, ok({ accounts: store.list().length, kid: signer.kid }));
      }
      if (req.method === 'POST' && p === '/v1/accounts/register') return await handleRegister(req, res);
      if (req.method === 'POST' && p === '/v1/accounts/login') return await handleLogin(req, res);
      if (req.method === 'POST' && p === '/v1/licenses/validate') return await handleValidate(req, res);
      return sendJson(res, 404, fail('NOT_FOUND'));
    } catch (error) {
      const message = String(error?.message || error);
      if (message === 'BODY_TOO_LARGE') return sendJson(res, 413, fail('VALIDATION_ERROR', '请求体过大'));
      if (message === 'BODY_INVALID_JSON') return sendJson(res, 400, fail('VALIDATION_ERROR', '请求体不是合法 JSON'));
      console.error('[error]', message);
      return sendJson(res, 500, fail('SERVER_ERROR'));
    }
  };
}

function start() {
  const configArg = process.argv.find((arg) => arg.startsWith('--config='));
  const configPath = configArg ? path.resolve(configArg.slice('--config='.length)) : DEFAULT_CONFIG_PATH;
  const config = loadConfig(configPath);

  const privateKeyPath = path.join(config.keysDir, 'license-private.pem');
  if (!fs.existsSync(privateKeyPath)) {
    console.error(`找不到私钥：${privateKeyPath}\n请先按 README 生成密钥对。`);
    process.exit(1);
  }
  const signer = createLeaseSigner({ privateKeyPem: fs.readFileSync(privateKeyPath, 'utf8') });

  // 关键自检：客户端内置的公钥必须和这把私钥配对，否则签出来的租约客户端一律拒收。
  if (fs.existsSync(CLIENT_PUBLIC_KEY_PATH)) {
    const clientKid = licensePublicKeyId(fs.readFileSync(CLIENT_PUBLIC_KEY_PATH, 'utf8'));
    if (clientKid !== signer.kid) {
      console.error('[FATAL] 客户端公钥与本服务私钥不配对：');
      console.error(`  客户端 kid = ${clientKid}`);
      console.error(`  服务端 kid = ${signer.kid}`);
      console.error('  请用本服务的公钥覆盖 backend/license-public-key.pem 后重新打包客户端。');
      process.exit(1);
    }
  }

  const store = createStore({ filePath: path.join(config.dataDir, 'accounts.json') });
  const handler = createApp({ config, store, signer, publicKeyPath: CLIENT_PUBLIC_KEY_PATH });
  const server = config.tls.enabled
    ? https.createServer({
      cert: fs.readFileSync(path.resolve(HERE, config.tls.certPath)),
      key: fs.readFileSync(path.resolve(HERE, config.tls.keyPath)),
    }, handler)
    : http.createServer(handler);

  server.listen(config.port, config.host, () => {
    const scheme = config.tls.enabled ? 'https' : 'http';
    console.log('Freedom 授权服务已启动');
    console.log(`  监听      ${scheme}://${config.host}:${config.port}`);
    console.log(`  kid       ${signer.kid}`);
    console.log(`  issuer    ${config.issuer} / audience ${config.audience}`);
    console.log(`  租约有效期 ${config.leaseTtlDays} 天，单账号设备上限 ${config.maxDevicesPerAccount}`);
    console.log(`  注册审核   ${config.autoApproveSignups ? '自动通过' : '需管理员批准（node admin.mjs approve <用户名>）'}`);
    console.log(`  账号数据   ${path.join(config.dataDir, 'accounts.json')}`);
  });
  server.on('error', (error) => {
    console.error('[FATAL] 服务启动失败：', error.message);
    process.exit(1);
  });
}

start();
