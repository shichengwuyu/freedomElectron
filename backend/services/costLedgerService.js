import path from 'path';

import { STATE_DIR } from '../config.js';
import { readJsonFile, writeJsonAtomic } from '../lib/atomicJson.js';

const LEDGER_FILE = path.join(STATE_DIR, 'model-usage.json');
const MAX_RECORDS = 10000;
let loaded = false;
let records = [];
let persistTimer = null;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function loadLedger() {
  if (loaded) return;
  loaded = true;
  const payload = readJsonFile(LEDGER_FILE, { records: [] });
  records = Array.isArray(payload?.records) ? payload.records.slice(-MAX_RECORDS) : [];
}

function flushLedger() {
  loadLedger();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  writeJsonAtomic(LEDGER_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    records: records.slice(-MAX_RECORDS),
  });
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try { flushLedger(); } catch (error) { console.error('保存模型用量账本失败：', error.message); }
  }, 120);
  persistTimer.unref?.();
}

export function estimateTextCost({ inputTokens = 0, outputTokens = 0, inputPricePerMillion = 0, outputPricePerMillion = 0 } = {}) {
  return (finite(inputTokens) / 1_000_000) * finite(inputPricePerMillion)
    + (finite(outputTokens) / 1_000_000) * finite(outputPricePerMillion);
}

export function recordUsage(entry = {}) {
  loadLedger();
  const record = {
    id: entry.id || `usage_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: entry.createdAt || new Date().toISOString(),
    kind: String(entry.kind || 'text'),
    task: String(entry.task || 'default'),
    operation: String(entry.operation || ''),
    projectId: String(entry.projectId || ''),
    episodeId: entry.episodeId ?? '',
    provider: String(entry.provider || ''),
    profileId: String(entry.profileId || ''),
    profileName: String(entry.profileName || ''),
    model: String(entry.model || ''),
    inputTokens: Math.max(0, Math.round(finite(entry.inputTokens))),
    outputTokens: Math.max(0, Math.round(finite(entry.outputTokens))),
    units: Math.max(0, finite(entry.units)),
    seconds: Math.max(0, finite(entry.seconds)),
    cost: Math.max(0, finite(entry.cost)),
    currency: String(entry.currency || 'CNY'),
    estimated: entry.estimated === true,
    status: String(entry.status || 'success'),
    error: String(entry.error || ''),
  };
  records.push(record);
  if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
  schedulePersist();
  return record;
}

export function listUsageRecords({ projectId = '', limit = 200, days = 0 } = {}) {
  loadLedger();
  const cutoff = days > 0 ? Date.now() - Number(days) * 86400000 : 0;
  return records
    .filter((record) => !projectId || record.projectId === String(projectId))
    .filter((record) => !cutoff || Date.parse(record.createdAt) >= cutoff)
    .slice(-Math.max(1, Math.min(Number(limit) || 200, 2000)))
    .reverse();
}

function groupKey(record) {
  return `${record.kind}:${record.task}:${record.model || record.profileName || 'unknown'}`;
}

export function usageSummary({ projectId = '', days = 30, currency = '' } = {}) {
  const source = listUsageRecords({ projectId, days, limit: 2000 }).reverse();
  const total = {
    records: source.length,
    inputTokens: 0,
    outputTokens: 0,
    images: 0,
    videoSeconds: 0,
    cost: 0,
    failed: 0,
  };
  const groups = new Map();
  for (const record of source) {
    total.inputTokens += finite(record.inputTokens);
    total.outputTokens += finite(record.outputTokens);
    if (record.kind === 'image') total.images += finite(record.units);
    if (record.kind === 'video') total.videoSeconds += finite(record.seconds);
    total.cost += finite(record.cost);
    if (record.status !== 'success') total.failed++;
    const key = groupKey(record);
    const group = groups.get(key) || {
      key,
      kind: record.kind,
      task: record.task,
      model: record.model || record.profileName || 'unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      units: 0,
      seconds: 0,
      cost: 0,
      failed: 0,
    };
    group.requests++;
    group.inputTokens += finite(record.inputTokens);
    group.outputTokens += finite(record.outputTokens);
    group.units += finite(record.units);
    group.seconds += finite(record.seconds);
    group.cost += finite(record.cost);
    if (record.status !== 'success') group.failed++;
    groups.set(key, group);
  }
  const summaryCurrency = String(currency || source.at(-1)?.currency || 'CNY');
  return {
    projectId: String(projectId || ''),
    days: Number(days) || 30,
    currency: summaryCurrency,
    total: { ...total, cost: Number(total.cost.toFixed(6)) },
    groups: [...groups.values()]
      .map((group) => ({ ...group, cost: Number(group.cost.toFixed(6)) }))
      .sort((a, b) => b.cost - a.cost || b.requests - a.requests),
  };
}

export function clearUsageRecords({ projectId = '' } = {}) {
  loadLedger();
  const before = records.length;
  records = projectId ? records.filter((record) => record.projectId !== String(projectId)) : [];
  flushLedger();
  return before - records.length;
}

process.once('beforeExit', () => {
  try { if (loaded) flushLedger(); } catch { /* ignore */ }
});
