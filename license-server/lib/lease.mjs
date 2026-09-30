// EdDSA(Ed25519) 租约签名 —— 必须和客户端 backend/license.js 的 verifySignedLease 逐条对齐，
// 任何一处不一致客户端都会拒收（LEASE_SIGNATURE_INVALID / LEASE_CLAIMS_INVALID）。
//
// 租约 = 无依赖的 JWT 变体：header.payload.signature，各段 base64url，签名 64 字节 Ed25519。
// header: { alg: "EdDSA", typ: "JWT", kid: <sha256(SPKI DER) base64url 前 22 位> }
import crypto from 'node:crypto';

// 与客户端 MACHINE_SALT 必须完全一致，否则 deviceHash 对不上（DEVICE_MISMATCH）。
export const MACHINE_SALT = 'GG-MACHINE-SALT-v1';

export function normalizeMachineCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function machineCodeHash(machineCode) {
  return crypto.createHash('sha256').update(normalizeMachineCode(machineCode)).digest('hex');
}

// 客户端传的是 PEM 文本；本服务内部可能直接传 KeyObject，
// 而 createPublicKey() 不接受"已经是公钥的 KeyObject"，所以这里两种情况都要容。
export function licensePublicKeyId(publicKey) {
  const key = publicKey?.type ? publicKey : crypto.createPublicKey(publicKey);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('base64url').slice(0, 22);
}

const b64url = (value) => Buffer.from(value).toString('base64url');

function decodeSegment(segment) {
  try {
    return JSON.parse(Buffer.from(String(segment), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function createLeaseSigner({ privateKeyPem }) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const kid = licensePublicKeyId(publicKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  function sign(claims) {
    const header = { alg: 'EdDSA', typ: 'JWT', kid };
    const encodedHeader = b64url(JSON.stringify(header));
    const encodedPayload = b64url(JSON.stringify(claims));
    const signature = crypto.sign(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      privateKey,
    );
    return `${encodedHeader}.${encodedPayload}.${b64url(signature)}`;
  }

  // 服务端自己也要验：/validate 收上来的租约必须先证明是我们签的，才能续期。
  // allowExpired=true 是有意的：客户端会把已过期的旧租约发上来换取新租约。
  function verify(token, { allowExpired = true, now = Date.now() } = {}) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { ok: false, reason: 'LEASE_MALFORMED' };
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeSegment(encodedHeader);
    const claims = decodeSegment(encodedPayload);
    if (!header || !claims || header.alg !== 'EdDSA' || header.typ !== 'JWT') {
      return { ok: false, reason: 'LEASE_MALFORMED' };
    }
    if (header.kid !== kid) return { ok: false, reason: 'LEASE_SIGNATURE_INVALID' };
    let valid = false;
    try {
      valid = crypto.verify(
        null,
        Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
        publicKey,
        Buffer.from(encodedSignature, 'base64url'),
      );
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, reason: 'LEASE_SIGNATURE_INVALID' };
    if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now - 5 * 60 * 1000) {
      if (!allowExpired) return { ok: false, reason: 'OFFLINE_LEASE_EXPIRED' };
    }
    return { ok: true, claims };
  }

  return { kid, publicKeyPem, sign, verify };
}

export function buildClaims({
  accountId,
  machineCode,
  deviceGrant,
  issuer,
  audience,
  ttlMs,
  plan = 'standard',
  features = [],
  entitlementExpiresAt = null,
  now = Date.now(),
}) {
  const iat = Math.floor(now / 1000);
  return {
    sub: String(accountId),
    iss: issuer,
    aud: audience,
    deviceHash: machineCodeHash(machineCode),
    deviceGrant: String(deviceGrant),
    jti: crypto.randomUUID(),
    iat,
    nbf: iat - 60, // 允许一点时钟漂移，客户端容差是 ±5 分钟
    exp: Math.floor((now + ttlMs) / 1000),
    plan,
    features,
    entitlementExpiresAt,
  };
}
