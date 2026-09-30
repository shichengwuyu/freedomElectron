// 小云雀账号池：账号存在 config.json 的 video.xiaoyunqueAccounts 里。
// 新版小云雀 CLI/API 使用 XYQ_ACCESS_KEY 鉴权；旧 sessionid 字段仅做兼容读取。
import crypto from 'crypto';
import { loadConfig, saveConfig } from './config.js';

// 运行时占用标记（内存级，进程内有效）
const inUse = new Set();

function genId() {
  return 'xyq_' + crypto.randomBytes(5).toString('hex');
}

function normalizeAccessKey(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

// 从一段文本里提取 XYQ_ACCESS_KEY；兼容旧 sessionid 粘贴格式。
function parseAccessKey(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  const m = text.match(/(?:XYQ_ACCESS_KEY|access[_-]?key|api[_-]?key|sessionid)\s*[:=]\s*([^\s;,'"<>]{12,})/i);
  if (m) return normalizeAccessKey(m[1]);
  const bearer = text.match(/Bearer\s+([^\s;,'"<>]{12,})/i);
  if (bearer) return normalizeAccessKey(bearer[1]);
  if (text.includes('----')) {
    for (const part of text.split('----')) {
      const t = part.trim();
      const key = parseAccessKey(t);
      if (key) return key;
    }
    return null;
  }
  if (/^[A-Za-z0-9._~+/=-]{12,}$/.test(text)) return normalizeAccessKey(text);
  return null;
}

function parseName(line, accessKey) {
  const text = String(line || '').trim();
  if (text.includes('----')) {
    const first = text.split('----')[0].trim();
    if (first && !/sessionid|access[_-]?key|api[_-]?key|XYQ_ACCESS_KEY/i.test(first)) return first.slice(0, 40);
  }
  return 'xyq_' + String(accessKey).slice(0, 8);
}

export function parseAccountsText(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const accessKey = parseAccessKey(line);
    if (!accessKey || seen.has(accessKey)) continue;
    seen.add(accessKey);
    out.push({ name: parseName(line, accessKey), accessKey });
  }
  return out;
}

export function listAccounts() {
  const cfg = loadConfig();
  return Array.isArray(cfg.video?.xiaoyunqueAccounts) ? cfg.video.xiaoyunqueAccounts : [];
}

export function findAccountById(id) {
  return listAccounts().find((a) => a.id === id) || null;
}

export function listAccountsMasked() {
  return listAccounts().map((a) => ({
    id: a.id,
    name: a.name,
    status: inUse.has(a.id) ? 'BUSY' : (a.status || 'IDLE'),
    accessKeyMask: maskSecret(a.accessKey || a.sessionid),
    sessionidMask: maskSecret(a.accessKey || a.sessionid),
    addedAt: a.addedAt,
  }));
}

function maskSecret(s) {
  const v = String(s || '');
  if (v.length <= 8) return '****';
  return `${v.slice(0, 4)}****${v.slice(-4)}`;
}

export function addAccounts(drafts) {
  const cfg = loadConfig();
  const accounts = Array.isArray(cfg.video?.xiaoyunqueAccounts) ? cfg.video.xiaoyunqueAccounts.slice() : [];
  const existing = new Set(accounts.map((a) => a.accessKey || a.sessionid).filter(Boolean));
  let added = 0;
  for (const d of drafts) {
    const accessKey = normalizeAccessKey(d?.accessKey || d?.xyqAccessKey || d?.apiKey || d?.sessionid);
    if (!accessKey || existing.has(accessKey)) continue;
    existing.add(accessKey);
    accounts.push({
      id: genId(),
      name: d.name || ('xyq_' + accessKey.slice(0, 8)),
      accessKey,
      sessionid: accessKey,
      status: 'IDLE',
      addedAt: new Date().toISOString(),
    });
    added++;
  }
  saveConfig({ video: { ...cfg.video, xiaoyunqueAccounts: accounts } });
  return added;
}

export function deleteAccount(id) {
  const cfg = loadConfig();
  const accounts = (cfg.video?.xiaoyunqueAccounts || []).filter((a) => a.id !== id);
  inUse.delete(id);
  saveConfig({ video: { ...cfg.video, xiaoyunqueAccounts: accounts } });
  return accounts.length;
}

export function acquireAccount(preferredId = '') {
  const accounts = listAccounts();
  const preferred = String(preferredId || '').trim();
  if (preferred) {
    const account = accounts.find((a) => a.id === preferred);
    if (
      account &&
      !inUse.has(account.id) &&
      account.status !== 'paid_required' &&
      account.status !== 'invalid'
    ) {
      inUse.add(account.id);
      return account;
    }
    return null;
  }
  for (const a of accounts) {
    if (inUse.has(a.id)) continue;
    if (a.status === 'paid_required' || a.status === 'invalid') continue;
    inUse.add(a.id);
    return a;
  }
  return null;
}

export function releaseAccount(id) {
  if (id) inUse.delete(id);
}

export function markAccountStatus(id, status) {
  const cfg = loadConfig();
  const accounts = (cfg.video?.xiaoyunqueAccounts || []).map((a) =>
    a.id === id ? { ...a, status } : a
  );
  saveConfig({ video: { ...cfg.video, xiaoyunqueAccounts: accounts } });
}

export function setAccountCredit(id, credit) {
  const cfg = loadConfig();
  const accounts = (cfg.video?.xiaoyunqueAccounts || []).map((a) =>
    a.id === id ? { ...a, credit, creditUpdatedAt: new Date().toISOString() } : a
  );
  saveConfig({ video: { ...cfg.video, xiaoyunqueAccounts: accounts } });
}
