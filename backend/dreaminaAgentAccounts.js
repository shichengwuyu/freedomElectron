import crypto from 'crypto';
import { loadConfig, saveConfig } from './config.js';

function generateAccountId() {
  return `dreamina-agent-${crypto.randomBytes(6).toString('hex')}`;
}

function maskSecret(value) {
  const secret = String(value || '');
  if (!secret) return '';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

function accountsFromConfig(cfg = loadConfig()) {
  return Array.isArray(cfg.video?.dreaminaAgentAccounts) ? cfg.video.dreaminaAgentAccounts : [];
}

export function listDreaminaAgentAccounts() {
  return accountsFromConfig().map((account) => ({ ...account }));
}

export function selectedDreaminaAgentAccountId() {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  const selected = accounts.find((account) => account.id === cfg.video?.dreaminaAgentAccountId) || accounts[0];
  return selected?.id || '';
}

export function findDreaminaAgentAccount(accountId = '') {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  const requested = String(accountId || '').trim();
  return accounts.find((account) => account.id === requested)
    || (!requested ? accounts.find((account) => account.id === cfg.video?.dreaminaAgentAccountId) : null)
    || (!requested ? accounts[0] : null)
    || null;
}

export function requireDreaminaAgentAccount(accountId = '') {
  const account = findDreaminaAgentAccount(accountId);
  if (!account) throw new Error('选择的即梦 Agent 账号不存在，请重新选择账号');
  return account;
}

export function dreaminaAgentAccountsPublicView() {
  const selectedId = selectedDreaminaAgentAccountId();
  return listDreaminaAgentAccounts().map((account) => ({
    id: account.id,
    name: account.name,
    selected: account.id === selectedId,
    hasSessionId: Boolean(account.sessionId),
    sessionIdMask: maskSecret(account.sessionId),
    addedAt: account.addedAt,
  }));
}

export function addDreaminaAgentAccount({ name = '' } = {}) {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg).map((account) => ({ ...account }));
  const id = generateAccountId();
  const account = {
    id,
    name: String(name || `即梦账号 ${accounts.length + 1}`).trim().slice(0, 40) || `即梦账号 ${accounts.length + 1}`,
    sessionId: '',
    profileKey: id,
    addedAt: new Date().toISOString(),
  };
  accounts.push(account);
  saveConfig({
    video: {
      ...cfg.video,
      dreaminaAgentAccounts: accounts,
      dreaminaAgentAccountId: account.id,
    },
  });
  return { ...account };
}

export function selectDreaminaAgentAccount(accountId) {
  const cfg = loadConfig();
  const account = requireDreaminaAgentAccount(accountId);
  saveConfig({
    video: {
      ...cfg.video,
      dreaminaAgentAccounts: accountsFromConfig(cfg),
      dreaminaAgentAccountId: account.id,
    },
  });
  return { ...account };
}

export function updateDreaminaAgentAccountSession(accountId, sessionId) {
  const cfg = loadConfig();
  const normalizedSessionId = String(sessionId || '').trim();
  const accounts = accountsFromConfig(cfg).map((account) => ({ ...account }));
  const target = accounts.find((account) => account.id === String(accountId || '').trim());
  if (!target) throw new Error('选择的即梦 Agent 账号不存在，请重新选择账号');
  if (normalizedSessionId && accounts.some((account) => account.id !== target.id && account.sessionId === normalizedSessionId)) {
    throw new Error('这个 Session ID 已经添加到其他即梦账号');
  }
  target.sessionId = normalizedSessionId;
  saveConfig({
    video: {
      ...cfg.video,
      dreaminaAgentAccounts: accounts,
      dreaminaAgentAccountId: target.id,
    },
  });
  return { ...target };
}

export function deleteDreaminaAgentAccount(accountId) {
  const cfg = loadConfig();
  const accounts = accountsFromConfig(cfg);
  const targetId = String(accountId || '').trim();
  if (!accounts.some((account) => account.id === targetId)) return false;
  if (accounts.length <= 1) throw new Error('至少保留一个即梦 Agent 账号');
  const remaining = accounts.filter((account) => account.id !== targetId);
  const selectedId = cfg.video?.dreaminaAgentAccountId === targetId
    ? remaining[0].id
    : cfg.video?.dreaminaAgentAccountId;
  saveConfig({
    video: {
      ...cfg.video,
      dreaminaAgentAccounts: remaining,
      dreaminaAgentAccountId: selectedId,
    },
  });
  return true;
}
