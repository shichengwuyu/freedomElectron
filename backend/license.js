// GG account authorization client. The application contains only an Ed25519 public key;
// account approval state and the signing private key remain on the license server.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { LICENSE_DIR } from './config.js';
import { writeJsonAtomic } from './lib/atomicJson.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'license-config.json');
const PUBLIC_KEY_PATH = path.join(__dirname, 'license-public-key.pem');
const PACKAGE_PATH = path.join(ROOT, 'package.json');

const MACHINE_SALT = 'GG-MACHINE-SALT-v1';
const B32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_OFFLINE_GRACE_MS = 1 * 60 * 60 * 1_000;
const CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 128 * 1_024;

const APP_DIR = LICENSE_DIR;
const LICENSE_PATH = path.join(APP_DIR, 'license.json');
const MACHINE_IDENTITY_PATH = path.join(APP_DIR, 'machine-identity.json');
const MACHINE_IDENTITY_SCHEMA_VERSION = 1;
const WINDOWS_MACHINE_GUID_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography';
const WINDOWS_MACHINE_GUID_VALUE = 'MachineGuid';
const MACHINE_IDENTITY_SOURCES = new Set(['windows-machine-guid', 'windows-hardware', 'installation-id']);

function toBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += B32_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function sha256Hex(value) {
  return sha256(value).toString('hex');
}

function chunk(value, size) {
  const parts = [];
  for (let index = 0; index < value.length; index += size) parts.push(value.slice(index, index + size));
  return parts.join('-');
}

function executableCandidates(relativePath, fallback) {
  const windowsRoot = String(process.env.SystemRoot || process.env.WINDIR || '').trim();
  return [...new Set([
    windowsRoot ? path.join(windowsRoot, relativePath) : '',
    fallback,
  ].filter(Boolean))];
}

function readWindowsMachineGuid() {
  const executables = executableCandidates(path.join('System32', 'reg.exe'), 'reg');
  for (const executable of executables) {
    for (const registryView of [[], ['/reg:64']]) {
      try {
        const output = execFileSync(
          executable,
          ['query', WINDOWS_MACHINE_GUID_KEY, '/v', WINDOWS_MACHINE_GUID_VALUE, ...registryView],
          { encoding: 'utf8', windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 },
        );
        // Preserve the registry value exactly so existing users keep the same machine code.
        const match = output.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
        if (match?.[1]) return String(match[1]);
      } catch {
        // Try the other executable or registry view.
      }
    }
  }
  return '';
}

function readWindowsHardwareIdentity() {
  const script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$result = [ordered]@{ uuid = ""; biosSerial = ""; baseboardSerial = ""; systemDiskSerial = "" }',
    'try { $result.uuid = [string](Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object -First 1 -ExpandProperty UUID) } catch {}',
    'try { $result.biosSerial = [string](Get-CimInstance Win32_BIOS -ErrorAction Stop | Select-Object -First 1 -ExpandProperty SerialNumber) } catch {}',
    'try { $result.baseboardSerial = [string](Get-CimInstance Win32_BaseBoard -ErrorAction Stop | Select-Object -First 1 -ExpandProperty SerialNumber) } catch {}',
    'try {',
    '  $systemDrive = [string](Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 -ExpandProperty SystemDrive)',
    '  $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID=\'" + $systemDrive + "\'") -ErrorAction Stop | Select-Object -First 1',
    '  $partition = Get-CimAssociatedInstance -InputObject $logicalDisk -ResultClassName Win32_DiskPartition -ErrorAction Stop | Select-Object -First 1',
    '  $disk = Get-CimAssociatedInstance -InputObject $partition -ResultClassName Win32_DiskDrive -ErrorAction Stop | Select-Object -First 1',
    '  $result.systemDiskSerial = [string]$disk.SerialNumber',
    '} catch {',
    '  try { $result.systemDiskSerial = [string](Get-CimInstance Win32_DiskDrive -ErrorAction Stop | Sort-Object Index | Select-Object -First 1 -ExpandProperty SerialNumber) } catch {}',
    '}',
    '$result | ConvertTo-Json -Compress',
  ].join('; ');
  const executables = executableCandidates(
    path.join('System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell',
  );
  for (const executable of executables) {
    try {
      const output = execFileSync(
        executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true, timeout: 8_000, maxBuffer: 128 * 1024 },
      );
      const parsed = JSON.parse(String(output || '').trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next PowerShell executable.
    }
  }
  return null;
}

function normalizeHardwareValue(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!normalized || normalized.length > 256) return '';
  const compact = normalized.replace(/[^A-Z0-9]/g, '');
  if (/^(?:0+|F+)$/.test(compact)
    || /^(?:UNKNOWN|NONE|INVALID|NOT SPECIFIED|DEFAULT STRING|SYSTEM SERIAL NUMBER|TO BE FILLED BY O\.E\.M\.)$/.test(normalized)) {
    return '';
  }
  return normalized;
}

export function windowsHardwareFingerprint(identity = {}) {
  const components = [
    ['uuid', normalizeHardwareValue(identity.uuid)],
    ['bios', normalizeHardwareValue(identity.biosSerial)],
    ['baseboard', normalizeHardwareValue(identity.baseboardSerial)],
    ['system-disk', normalizeHardwareValue(identity.systemDiskSerial)],
  ].filter(([, value]) => value);
  if (!components.length) return '';
  const canonical = components.map(([name, value]) => `${name}:${value}`).join('|');
  return `winhw:${sha256Hex(canonical)}`;
}

function machineIdentitySourceForFingerprint(fingerprint) {
  if (/^winguid:[A-Za-z0-9_-]{8,128}$/.test(fingerprint)) return 'windows-machine-guid';
  if (/^winhw:[a-f0-9]{64}$/i.test(fingerprint)) return 'windows-hardware';
  if (/^install:[a-f0-9]{64}$/i.test(fingerprint)) return 'installation-id';
  return '';
}

function normalizedMachineIdentity(value) {
  if (!value || value.schemaVersion !== MACHINE_IDENTITY_SCHEMA_VERSION) return null;
  const fingerprint = String(value.fingerprint || '').trim();
  const source = String(value.source || '').trim();
  if (!MACHINE_IDENTITY_SOURCES.has(source) || machineIdentitySourceForFingerprint(fingerprint) !== source) return null;
  return {
    schemaVersion: MACHINE_IDENTITY_SCHEMA_VERSION,
    source,
    fingerprint,
    createdAt: String(value.createdAt || ''),
    verifiedAt: String(value.verifiedAt || ''),
  };
}

function readMachineIdentity(identityPath) {
  return normalizedMachineIdentity(readJson(identityPath, null));
}

function persistMachineIdentity(identityPath, identity, { verified = false, now = Date.now() } = {}) {
  const current = readMachineIdentity(identityPath);
  const sameIdentity = current?.source === identity.source && current?.fingerprint === identity.fingerprint;
  const timestamp = new Date(typeof now === 'function' ? now() : now).toISOString();
  const record = {
    schemaVersion: MACHINE_IDENTITY_SCHEMA_VERSION,
    source: identity.source,
    fingerprint: identity.fingerprint,
    createdAt: sameIdentity && current.createdAt ? current.createdAt : timestamp,
    verifiedAt: verified ? timestamp : (sameIdentity ? current.verifiedAt : ''),
  };
  if (sameIdentity && current.createdAt === record.createdAt && current.verifiedAt === record.verifiedAt) return current;
  writeJsonAtomic(identityPath, record);
  return record;
}

export function resolveMachineIdentity({
  platform = process.platform,
  identityPath = MACHINE_IDENTITY_PATH,
  machineGuidReader = readWindowsMachineGuid,
  hardwareIdentityReader = readWindowsHardwareIdentity,
  randomBytes = crypto.randomBytes,
  now = Date.now,
} = {}) {
  const cached = readMachineIdentity(identityPath);
  let machineGuid = '';
  if (platform === 'win32') {
    try { machineGuid = String(machineGuidReader() || '').trim(); } catch { machineGuid = ''; }
    if (machineGuid) {
      const current = { source: 'windows-machine-guid', fingerprint: `winguid:${machineGuid}` };
      if (cached?.source === 'installation-id' && cached.verifiedAt) return cached;
      if (cached?.source === 'windows-machine-guid') return current;
      if (cached?.source === 'windows-hardware' && cached.verifiedAt) {
        let currentHardware = '';
        try { currentHardware = windowsHardwareFingerprint(hardwareIdentityReader() || {}); } catch { currentHardware = ''; }
        if (!currentHardware || currentHardware === cached.fingerprint) return cached;
      }
      return current;
    }
  }

  // A previously verified fingerprint is authoritative when system queries fail temporarily.
  if (cached?.verifiedAt) return cached;
  if (cached) return cached;

  if (platform === 'win32') {
    let hardwareFingerprint = '';
    try { hardwareFingerprint = windowsHardwareFingerprint(hardwareIdentityReader() || {}); } catch { hardwareFingerprint = ''; }
    if (hardwareFingerprint) {
      const identity = { source: 'windows-hardware', fingerprint: hardwareFingerprint };
      try { persistMachineIdentity(identityPath, identity, { now }); } catch { /* deterministic hardware identity remains usable */ }
      return identity;
    }
  }

  const identity = {
    source: 'installation-id',
    fingerprint: `install:${randomBytes(32).toString('hex')}`,
  };
  try {
    persistMachineIdentity(identityPath, identity, { now });
  } catch {
    throw new Error('无法读取硬件标识，也无法保存永久设备标识。请检查程序数据目录权限。');
  }
  return identity;
}

// Device identity is resolved once per process; periodic license checks must not spawn system tools.
let cachedMachineIdentity = null;

function currentMachineIdentity() {
  if (!cachedMachineIdentity) cachedMachineIdentity = resolveMachineIdentity();
  return cachedMachineIdentity;
}

export function machineCodeForFingerprint(fingerprint) {
  const digest = sha256(fingerprint + MACHINE_SALT);
  return `GG-${chunk(toBase32(digest).slice(0, 16), 4)}`;
}

export function getMachineCode() {
  return machineCodeForFingerprint(currentMachineIdentity().fingerprint);
}

export function confirmMachineIdentity(identity, machineCode, {
  identityPath = MACHINE_IDENTITY_PATH,
  now = Date.now,
} = {}) {
  const normalized = normalizedMachineIdentity({
    schemaVersion: MACHINE_IDENTITY_SCHEMA_VERSION,
    ...identity,
  });
  if (!normalized) return false;
  if (normalizeMachineCode(machineCodeForFingerprint(normalized.fingerprint)) !== normalizeMachineCode(machineCode)) {
    return false;
  }
  persistMachineIdentity(identityPath, normalized, { verified: true, now });
  return true;
}

function rememberVerifiedMachineIdentity(machineCode) {
  const identity = currentMachineIdentity();
  try { confirmMachineIdentity(identity, machineCode); } catch {
    // A deterministic system fingerprint still works; retry caching after the next successful validation.
  }
}

export function normalizeMachineCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function machineCodeHash(machineCode) {
  return sha256Hex(normalizeMachineCode(machineCode));
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function defaultAppVersion() {
  return String(readJson(PACKAGE_PATH, {})?.version || '0.0.0');
}

function decodeJsonSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(segment || ''))) return null;
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function licensePublicKeyId(publicKey) {
  const key = crypto.createPublicKey(publicKey);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('base64url').slice(0, 22);
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifySignedLease(token, {
  publicKey,
  machineCode,
  audience,
  issuer,
  now = Date.now(),
  allowExpired = false,
} = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, code: 'LEASE_MALFORMED' };

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonSegment(encodedHeader);
  const claims = decodeJsonSegment(encodedPayload);
  if (!header || !claims || header.alg !== 'EdDSA' || header.typ !== 'JWT') {
    return { ok: false, code: 'LEASE_MALFORMED' };
  }

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
      return { ok: false, code: 'LEASE_SIGNATURE_INVALID' };
    }
    const signature = Buffer.from(encodedSignature, 'base64url');
    if (signature.length !== 64 || header.kid !== licensePublicKeyId(publicKey)) {
      return { ok: false, code: 'LEASE_SIGNATURE_INVALID' };
    }
    const valid = crypto.verify(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      publicKey,
      signature,
    );
    if (!valid) return { ok: false, code: 'LEASE_SIGNATURE_INVALID' };
  } catch {
    return { ok: false, code: 'LEASE_SIGNATURE_INVALID' };
  }

  if (!timingSafeStringEqual(claims.aud, audience) || !timingSafeStringEqual(claims.iss, issuer)) {
    return { ok: false, code: 'LEASE_CLAIMS_INVALID' };
  }
  if (!timingSafeStringEqual(claims.deviceHash, machineCodeHash(machineCode))) {
    return { ok: false, code: 'DEVICE_MISMATCH' };
  }

  if (typeof claims.sub !== 'string' || !claims.sub
    || typeof claims.deviceGrant !== 'string' || !claims.deviceGrant
    || typeof claims.jti !== 'string' || !claims.jti
    || !Number.isSafeInteger(claims.iat)
    || !Number.isSafeInteger(claims.nbf)
    || !Number.isSafeInteger(claims.exp)
    || claims.exp <= claims.iat
    || claims.nbf > claims.exp) {
    return { ok: false, code: 'LEASE_CLAIMS_INVALID' };
  }
  const issuedAtMs = claims.iat * 1_000;
  const notBeforeMs = claims.nbf * 1_000;
  const expiresAtMs = claims.exp * 1_000;
  if (now + CLOCK_TOLERANCE_MS < notBeforeMs) return { ok: false, code: 'CLOCK_INVALID' };
  if (!allowExpired && now - CLOCK_TOLERANCE_MS >= expiresAtMs) {
    return { ok: false, code: 'OFFLINE_LEASE_EXPIRED', claims };
  }
  return { ok: true, claims, expiresAt: new Date(expiresAtMs).toISOString() };
}

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('授权服务器地址尚未配置。');
  const url = new URL(raw);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new Error('授权服务器必须使用 HTTPS。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function loadDefaultOptions() {
  const config = readJson(CONFIG_PATH, {});
  return {
    serverUrl: process.env.GG_LICENSE_SERVER_URL || config.serverUrl || '',
    publicKey: readText(PUBLIC_KEY_PATH),
    audience: String(config.audience || 'com.gg.studio'),
    issuer: String(config.issuer || 'gg-license-server'),
    requestTimeoutMs: Math.max(1_000, Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS),
    offlineGraceMs: Math.max(0, Number(config.offlineGraceMs) || DEFAULT_OFFLINE_GRACE_MS),
    appVersion: defaultAppVersion(),
  };
}

const ERROR_MESSAGES = {
  LICENSE_NOT_FOUND: '账号授权记录不存在，请联系管理员。',
  LICENSE_REVOKED: '该授权已被停用，请联系授权方。',
  LICENSE_SUSPENDED: '该授权已被暂停，请联系授权方。',
  LICENSE_EXPIRED: '该授权已到期，请续费后重试。',
  DEVICE_LIMIT: '该账号已达到授权设备数量上限。',
  INVALID_CREDENTIALS: '用户名或密码错误。',
  USERNAME_TAKEN: '该用户名已被注册。',
  ACCOUNT_PENDING: '账号正在等待管理员审核。',
  ACCOUNT_NOT_APPROVED: '账号尚未获得授权。',
  ACCOUNT_REVOKED: '该账号授权已被取消。',
  ACCOUNT_ALREADY_ACTIVE: '该账号授权仍然有效，无需重复激活。',
  ACTIVATION_CODE_INVALID: '试用卡或激活码格式不正确。',
  ACTIVATION_CODE_USED: '该试用卡或激活码已使用或已停用。',
  DEVICE_REVOKED: '当前设备的授权已被移除。',
  RATE_LIMITED: '尝试次数过多，请稍后再试。',
  NETWORK_ERROR: '无法连接授权服务器，请检查网络后重试。',
  SERVER_ERROR: '授权服务器暂时不可用，请稍后重试。',
  INVALID_SERVER_RESPONSE: '授权服务器返回了无效数据。',
  CONFIG_ERROR: '软件尚未配置授权服务器，请联系软件提供方。',
  DEVICE_ID_UNAVAILABLE: '无法读取或保存本机设备标识，请检查程序数据目录权限后重试。',
  OFFLINE_LEASE_EXPIRED: '离线授权已过期，请联网重新验证。',
  OFFLINE_GRACE_EXPIRED: '离线使用时间过长，请联网重新验证授权。',
  CLOCK_INVALID: '系统时间异常，请校准时间并联网验证。',
  DEVICE_MISMATCH: '本机与授权绑定的设备不一致。',
  LEASE_SIGNATURE_INVALID: '本地授权凭证无效，请重新激活。',
  LEASE_MALFORMED: '本地授权文件已损坏，请重新激活。',
  LEASE_CLAIMS_INVALID: '本地授权凭证无效，请重新激活。',
  NO_LICENSE: '请登录已授权账号。',
  LEGACY_LICENSE: '本机存在旧版授权，请使用账号重新登录。',
};

function failure(code, message = '', extra = {}) {
  return {
    ok: false,
    code,
    error: message || ERROR_MESSAGES[code] || '授权验证失败。',
    ...extra,
  };
}

// 这些失败码只说明"这一次没能拿到服务器的结论"（断网、5xx、限流、被劫持/损坏的响应），
// 与吊销、到期、设备越限等确定性拒绝不同，允许在离线宽限期内继续放行。
const TRANSIENT_VALIDATION_CODES = new Set([
  'NETWORK_ERROR',
  'SERVER_ERROR',
  'RATE_LIMITED',
  'INVALID_SERVER_RESPONSE',
]);

function remoteErrorCode(body, status) {
  const code = String(body?.error?.code || body?.code || '').trim().toUpperCase();
  if (code) return code;
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return status === 404 ? 'LICENSE_NOT_FOUND' : 'INVALID_KEY';
}

function resolveClientSessionId(value) {
  const provided = String(value || '').trim();
  if (!provided) return crypto.randomBytes(24).toString('base64url');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(provided)) {
    throw new Error('Client session ID must be a 16-128 character base64url string.');
  }
  return provided;
}

export function createLicenseManager(options = {}) {
  const defaults = loadDefaultOptions();
  const usesDefaultMachineIdentity = typeof options.machineCodeProvider !== 'function';
  const settings = {
    ...defaults,
    ...options,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    machineCodeProvider: options.machineCodeProvider || getMachineCode,
    now: options.now || (() => Date.now()),
    licensePath: options.licensePath || LICENSE_PATH,
    clientSessionId: resolveClientSessionId(options.clientSessionId),
    machineIdentityConfirmer: options.machineIdentityConfirmer
      || (usesDefaultMachineIdentity ? rememberVerifiedMachineIdentity : null),
  };

  function resolveMachineCode() {
    try {
      const machineCode = normalizeMachineCode(settings.machineCodeProvider());
      if (!machineCode) return failure('DEVICE_ID_UNAVAILABLE');
      return { ok: true, machineCode };
    } catch (error) {
      return failure('DEVICE_ID_UNAVAILABLE', error?.message || '');
    }
  }

  async function post(pathname, payload) {
    let baseUrl;
    try {
      baseUrl = normalizeServerUrl(settings.serverUrl);
    } catch (error) {
      return failure('CONFIG_ERROR', error.message);
    }
    if (!settings.publicKey) return failure('CONFIG_ERROR', '软件未内置授权验签公钥。');
    if (typeof settings.fetchImpl !== 'function') return failure('NETWORK_ERROR');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    try {
      const response = await settings.fetchImpl(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-gg-client-version': String(settings.appVersion || '0.0.0'),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return failure('INVALID_SERVER_RESPONSE');
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return failure(response.ok ? 'INVALID_SERVER_RESPONSE' : 'SERVER_ERROR');
      }
      if (!response.ok || body?.ok === false) {
        const code = remoteErrorCode(body, response.status);
        const serverMessage = typeof body?.error?.message === 'string' ? body.error.message : '';
        return failure(code, ERROR_MESSAGES[code] || serverMessage);
      }
      return { ok: true, body };
    } catch (error) {
      return failure('NETWORK_ERROR', '', { cause: error?.name || 'Error' });
    } finally {
      clearTimeout(timer);
    }
  }

  function readLicense() {
    const value = readJson(settings.licensePath, null);
    if (!value) return failure('NO_LICENSE');
    if (value.schemaVersion !== 2 || !value.lease) return failure('LEGACY_LICENSE');
    return { ok: true, value };
  }

  function verifyLease(lease, machineCode, allowExpired = false) {
    return verifySignedLease(lease, {
      publicKey: settings.publicKey,
      machineCode,
      audience: settings.audience,
      issuer: settings.issuer,
      now: settings.now(),
      allowExpired,
    });
  }

  function saveLicense({ lease, machineCode, previous = {}, serverTime = '', accountUsername = '' }) {
    const verified = verifyLease(lease, machineCode, false);
    if (!verified.ok) return failure(verified.code);
    const nowIso = new Date(settings.now()).toISOString();
    const serverTimeMs = Date.parse(serverTime);
    const trustedTimeMs = Math.max(
      settings.now(),
      Number.isFinite(serverTimeMs) ? serverTimeMs : 0,
      Date.parse(previous.lastSeenAt || '') || 0,
    );
    const record = {
      schemaVersion: 2,
      machineCode: normalizeMachineCode(machineCode),
      lease,
      licenseId: String(verified.claims.sub || ''),
      plan: String(verified.claims.plan || 'standard'),
      features: Array.isArray(verified.claims.features) ? verified.claims.features : [],
      activatedAt: previous.activatedAt || nowIso,
      lastValidatedAt: nowIso,
      lastSeenAt: new Date(trustedTimeMs).toISOString(),
      leaseExpiresAt: verified.expiresAt,
      entitlementExpiresAt: verified.claims.entitlementExpiresAt || null,
      accountUsername: accountUsername || previous.accountUsername || '',
    };
    writeJsonAtomic(settings.licensePath, record);
    try { settings.machineIdentityConfirmer?.(machineCode); } catch {
      // The signed lease is already stored; a later online validation can retry the identity cache.
    }
    return { ok: true, record, verified };
  }

  // 只保留账号注册：卡密/激活码那条路已经删除（含 redeem）。
  // 新账号注册后进入待审核列表，由管理员在服务端批准。
  async function register({ username, password } = {}) {
    const normalizedUsername = String(username || '').trim();
    const usernameLength = Array.from(normalizedUsername).length;
    if (usernameLength < 1 || usernameLength > 64) return failure('VALIDATION_ERROR', '用户名必须为 1-64 个字符。');
    if (typeof password !== 'string' || password.length < 5 || password.length > 128) return failure('VALIDATION_ERROR', '密码必须为 5-128 个字符。');
    const response = await post('/v1/accounts/register', {
      username: normalizedUsername,
      password,
    });
    if (!response.ok) return response;
    const account = response.body?.data || response.body;
    if (account?.status === 'active') return login({ username: normalizedUsername, password });
    return {
      ok: true,
      state: 'pending',
      account,
    };
  }

  async function login({ username, password } = {}) {
    const normalizedUsername = String(username || '').trim();
    if (!normalizedUsername || typeof password !== 'string') return failure('INVALID_CREDENTIALS');
    const resolvedMachine = resolveMachineCode();
    if (!resolvedMachine.ok) return resolvedMachine;
    const { machineCode } = resolvedMachine;
    const response = await post('/v1/accounts/login', {
      username: normalizedUsername,
      password,
      machineCode,
      appVersion: String(settings.appVersion || '0.0.0'),
      clientSessionId: settings.clientSessionId,
    });
    if (!response.ok) return response;
    const lease = String(response.body?.lease || response.body?.data?.lease || '');
    const account = response.body?.account || response.body?.data?.account || {};
    const saved = saveLicense({
      lease,
      machineCode,
      serverTime: response.body?.serverTime || response.body?.data?.serverTime,
      accountUsername: String(account.username || normalizedUsername),
    });
    if (!saved.ok) return saved;
    return {
      ok: true,
      state: 'online',
      machineCode,
      expiresAt: saved.verified.expiresAt,
      license: saved.record,
    };
  }

  // 联网验证失败（或被跳过）时的离线判定：租约本身未过期、时钟没有回拨、
  // 距最后一次在线验证成功不超过宽限时长，三者都满足才放行。
  function offlineFallback(record, machineCode, reasonCode) {
    const verified = verifyLease(record.lease, machineCode, false);
    if (!verified.ok) return failure(verified.code);

    const nowMs = settings.now();
    const lastSeenMs = Date.parse(record.lastSeenAt || '') || 0;
    if (nowMs + CLOCK_TOLERANCE_MS < lastSeenMs) return failure('CLOCK_INVALID');

    // 宽限窗口锚定最后一次真正拿到服务器结论的时刻，离线复验不能自我续期。
    const anchorMs = Date.parse(record.lastValidatedAt || '');
    if (!Number.isFinite(anchorMs) || nowMs - anchorMs > settings.offlineGraceMs) {
      return failure('OFFLINE_GRACE_EXPIRED');
    }

    let current = record;
    if (nowMs > lastSeenMs) {
      // 推进 lastSeenAt，离线期间往回调时钟会在下一次校验时暴露。
      current = { ...record, lastSeenAt: new Date(nowMs).toISOString() };
      try {
        writeJsonAtomic(settings.licensePath, current);
      } catch { /* 写盘失败不影响本次离线放行 */ }
    }
    return {
      ok: true,
      state: 'offline',
      offlineReason: reasonCode,
      graceExpiresAt: new Date(anchorMs + settings.offlineGraceMs).toISOString(),
      expiresAt: verified.expiresAt,
      license: current,
    };
  }

  async function validate({ allowNetwork = true } = {}) {
    const stored = readLicense();
    if (!stored.ok) return stored;

    const resolvedMachine = resolveMachineCode();
    if (!resolvedMachine.ok) return resolvedMachine;
    const { machineCode } = resolvedMachine;
    if (!timingSafeStringEqual(stored.value.machineCode, machineCode)) return failure('DEVICE_MISMATCH');

    // Signature and device binding must be valid before the cached token is sent anywhere.
    const signed = verifyLease(stored.value.lease, machineCode, true);
    if (!signed.ok) return failure(signed.code);

    if (!allowNetwork) return offlineFallback(stored.value, machineCode, 'NETWORK_SKIPPED');

    const online = await post('/v1/licenses/validate', {
      lease: stored.value.lease,
      machineCode,
      appVersion: String(settings.appVersion || '0.0.0'),
      clientSessionId: settings.clientSessionId,
    });
    if (online.ok) {
      const lease = String(online.body?.lease || online.body?.data?.lease || '');
      const saved = saveLicense({
        lease,
        machineCode,
        previous: stored.value,
        serverTime: online.body?.serverTime || online.body?.data?.serverTime,
      });
      if (!saved.ok) return saved;
      return {
        ok: true,
        state: 'online',
        expiresAt: saved.verified.expiresAt,
        license: saved.record,
      };
    }
    if (TRANSIENT_VALIDATION_CODES.has(online.code)) {
      return offlineFallback(stored.value, machineCode, online.code);
    }
    return online;
  }

  return { register, login, validate, readLicense };
}

let defaultManager;
function manager() {
  if (!defaultManager) defaultManager = createLicenseManager();
  return defaultManager;
}

export async function registerAccount(credentials) {
  return manager().register(credentials);
}

export async function loginAccount(credentials) {
  return manager().login(credentials);
}

export async function validateLicense(options) {
  return manager().validate(options);
}

export async function isActivated() {
  return (await validateLicense()).ok;
}

export { APP_DIR, CONFIG_PATH, LICENSE_PATH, PUBLIC_KEY_PATH };
