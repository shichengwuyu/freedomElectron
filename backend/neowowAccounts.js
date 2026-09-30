import crypto from 'crypto';

import { loadConfig, saveConfig } from './config.js';
import { testConnection as testNeowowConnection } from './neowowClient.js';

const LEGACY_ACCOUNT_ID = 'neowow-legacy';

function generateAccountId() {
  return `neowow-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizePoints(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeAccount(account = {}, index = 0) {
  const id = String(account.id || '').trim();
  if (!id) return null;
  const token = String(account.token || '').trim();
  const status = String(account.status || (token ? 'ready' : 'logged_out')).trim();
  const authMethod = String(account.authMethod || '').trim() === 'token' ? 'token' : 'browser';
  return {
    id,
    name: String(account.name || `Neowow 账号 ${index + 1}`).trim().slice(0, 60) || `Neowow 账号 ${index + 1}`,
    customName: account.customName === true,
    userId: String(account.userId || '').trim(),
    token,
    authMethod,
    points: normalizePoints(account.points),
    status,
    profileKey: String(account.profileKey || id).trim() || id,
    enabled: account.enabled !== false,
    addedAt: String(account.addedAt || new Date().toISOString()),
    pointsUpdatedAt: String(account.pointsUpdatedAt || ''),
    lastError: String(account.lastError || ''),
  };
}

function rawAccounts(cfg) {
  return (Array.isArray(cfg.video?.neowowAccounts) ? cfg.video.neowowAccounts : [])
    .map(normalizeAccount)
    .filter(Boolean);
}

function legacyAccount(cfg) {
  const token = String(cfg.video?.neowowToken || '').trim();
  if (!token) return null;
  return normalizeAccount({
    id: LEGACY_ACCOUNT_ID,
    name: 'Neowow 账号 1',
    token,
    authMethod: 'token',
    status: 'ready',
    profileKey: LEGACY_ACCOUNT_ID,
    enabled: true,
    addedAt: new Date().toISOString(),
  });
}

function accountsFromConfig(cfg) {
  const accounts = rawAccounts(cfg);
  if (accounts.length) return accounts;
  const legacy = legacyAccount(cfg);
  return legacy ? [legacy] : [];
}

function selectedFrom(cfg, accounts) {
  const requested = String(cfg.video?.neowowAccountId || '').trim();
  return accounts.find((account) => account.id === requested) || accounts[0] || null;
}

function persistAccounts(cfg, accounts, selectedId = '') {
  const normalized = accounts.map(normalizeAccount).filter(Boolean);
  const selected = normalized.find((account) => account.id === String(selectedId || '').trim())
    || selectedFrom(cfg, normalized)
    || normalized[0]
    || null;
  saveConfig({
    video: {
      ...cfg.video,
      neowowAccounts: normalized,
      neowowAccountId: selected?.id || '',
      // Keep the legacy field synchronized while older installations and tools
      // still read it. New application code resolves Tokens from the account.
      neowowToken: selected?.token || '',
    },
  });
  return selected;
}

function migrateLegacyAccount(cfg, accounts) {
  if (rawAccounts(cfg).length || !accounts.length) return;
  persistAccounts(cfg, accounts, accounts[0].id);
}

export function listNeowowAccounts() {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  migrateLegacyAccount(cfg, accounts);
  return accounts.map((account) => ({ ...account }));
}

export function selectedNeowowAccountId() {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  migrateLegacyAccount(cfg, accounts);
  return selectedFrom(cfg, accounts)?.id || '';
}

export function findNeowowAccount(accountId = '') {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  migrateLegacyAccount(cfg, accounts);
  const requested = String(accountId || '').trim();
  if (requested && requested !== 'neowow') {
    return accounts.find((account) => account.id === requested) || null;
  }
  return selectedFrom(cfg, accounts);
}

export function requireNeowowAccount(accountId = '', { requireToken = false } = {}) {
  const account = findNeowowAccount(accountId);
  if (!account) throw new Error('选择的 Neowow 账号不存在，请重新选择账号');
  if (requireToken && !account.token) throw new Error(`${account.name} 未登录，请重新导入 Token 或完成网页登录`);
  return account;
}

export function neowowAccountsPublicView() {
  const selectedId = selectedNeowowAccountId();
  return listNeowowAccounts().map((account) => ({
    id: account.id,
    name: account.name,
    userId: account.userId,
    points: account.points,
    status: account.status,
    enabled: account.enabled !== false,
    selected: account.id === selectedId,
    hasToken: Boolean(account.token),
    authMethod: account.authMethod,
    addedAt: account.addedAt,
    pointsUpdatedAt: account.pointsUpdatedAt,
    lastError: account.lastError,
  }));
}

export function addNeowowAccount({ name = '', authMethod = 'browser' } = {}) {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  const customName = String(name || '').trim().slice(0, 60);
  const account = normalizeAccount({
    id: generateAccountId(),
    name: customName || `Neowow 账号 ${accounts.length + 1}`,
    customName: Boolean(customName),
    authMethod,
    status: 'logged_out',
    enabled: true,
    addedAt: new Date().toISOString(),
  }, accounts.length);
  accounts.push(account);
  persistAccounts(cfg, accounts, account.id);
  return { ...account };
}

export function selectNeowowAccount(accountId) {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  const target = accounts.find((account) => account.id === String(accountId || '').trim());
  if (!target) throw new Error('选择的 Neowow 账号不存在，请重新选择账号');
  persistAccounts(cfg, accounts, target.id);
  return { ...target };
}

function updateAccount(accountId, updater) {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  const target = accounts.find((account) => account.id === String(accountId || '').trim());
  if (!target) throw new Error('选择的 Neowow 账号不存在，请重新选择账号');
  updater(target, accounts);
  persistAccounts(cfg, accounts, cfg.video?.neowowAccountId || target.id);
  return { ...target };
}

export function updateNeowowAccountAuth(accountId, {
  token,
  name,
  accountName,
  userId,
  points,
  authMethod,
} = {}) {
  const normalizedUserId = String(userId || '').trim();
  const customName = String(name || '').trim().slice(0, 60);
  return updateAccount(accountId, (target, accounts) => {
    const duplicate = normalizedUserId && accounts.find((account) => account.id !== target.id && account.userId === normalizedUserId);
    if (duplicate) throw new Error(`这个 Neowow 用户已经添加为“${duplicate.name}”`);
    target.token = String(token || '').trim();
    target.userId = normalizedUserId;
    if (authMethod === 'token' || authMethod === 'browser') target.authMethod = authMethod;
    if (customName) {
      target.name = customName;
      target.customName = true;
    } else if (!target.customName && String(accountName || '').trim()) {
      target.name = String(accountName).trim().slice(0, 60);
    }
    target.points = normalizePoints(points);
    target.pointsUpdatedAt = new Date().toISOString();
    target.status = target.token ? 'ready' : 'logged_out';
    target.enabled = true;
    target.lastError = '';
  });
}

export function importNeowowTokenAccount({
  name = '',
  token = '',
  accountName = '',
  userId = '',
  points,
} = {}) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) throw new Error('请输入有效的 Neowow Token');

  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  const normalizedUserId = String(userId || '').trim();
  const duplicate = normalizedUserId && accounts.find((account) => account.userId === normalizedUserId);
  if (duplicate) throw new Error(`这个 Neowow 用户已经添加为“${duplicate.name}”`);

  const customName = String(name || '').trim().slice(0, 60);
  const verifiedName = String(accountName || '').trim().slice(0, 60);
  const account = normalizeAccount({
    id: generateAccountId(),
    name: customName || verifiedName || `Neowow 账号 ${accounts.length + 1}`,
    customName: Boolean(customName),
    userId: normalizedUserId,
    token: normalizedToken,
    authMethod: 'token',
    points,
    status: 'ready',
    enabled: true,
    addedAt: new Date().toISOString(),
    pointsUpdatedAt: new Date().toISOString(),
  }, accounts.length);
  accounts.push(account);
  persistAccounts(cfg, accounts, account.id);
  return { ...account };
}

export function setNeowowAccountEnabled(accountId, enabled) {
  return updateAccount(accountId, (target) => {
    target.enabled = enabled !== false;
  });
}

export function clearNeowowAccountToken(accountId) {
  return updateAccount(accountId, (target) => {
    target.token = '';
    target.status = 'logged_out';
    target.lastError = '';
  });
}

export function markNeowowAccountStatus(accountId, status, lastError = '') {
  return updateAccount(accountId, (target) => {
    target.status = String(status || target.status || 'error');
    target.lastError = String(lastError || '');
  });
}

export function deleteNeowowAccount(accountId) {
  const cfg = loadConfig();
  const targetId = String(accountId || '').trim();
  const accounts = accountsFromConfig(cfg);
  if (!accounts.some((account) => account.id === targetId)) return false;
  const remaining = accounts.filter((account) => account.id !== targetId);
  const selectedId = cfg.video?.neowowAccountId === targetId ? remaining[0]?.id : cfg.video?.neowowAccountId;
  persistAccounts(cfg, remaining, selectedId || '');
  return true;
}

export function neowowConfigForAccount(accountId = '', cfg = loadConfig()) {
  const account = requireNeowowAccount(accountId, { requireToken: true });
  return {
    ...(cfg.video || {}),
    neowowToken: account.token,
  };
}

export function usableNeowowAccounts() {
  return listNeowowAccounts().filter((account) => (
    account.enabled !== false
    && Boolean(account.token)
    && !['expired', 'logged_out', 'invalid', 'logging_in'].includes(account.status)
    && (account.points == null || account.points > 0)
  ));
}

export async function refreshNeowowAccount(accountId, { cfg = loadConfig(), fetchImpl } = {}) {
  const account = requireNeowowAccount(accountId, { requireToken: true });
  try {
    const profile = await testNeowowConnection({
      config: { ...(cfg.video || {}), neowowToken: account.token },
      fetchImpl,
    });
    return updateNeowowAccountAuth(account.id, { token: account.token, ...profile });
  } catch (error) {
    const expired = error?.code === 'AUTH_EXPIRED' || Number(error?.status) === 401;
    markNeowowAccountStatus(account.id, expired ? 'expired' : 'error', error?.message || String(error));
    throw error;
  }
}
