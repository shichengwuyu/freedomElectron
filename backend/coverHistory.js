import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { DATA_DIR } from './config.js';
import { readJsonFile, writeFileAtomic, writeJsonAtomic } from './lib/atomicJson.js';

const HISTORY_DIR = path.join(DATA_DIR, 'standalone-covers');
const HISTORY_INDEX = path.join(HISTORY_DIR, 'index.json');
const HISTORY_LIMIT = 60;

function ensureDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function imagePath(id) {
  return path.join(HISTORY_DIR, `${safeId(id)}.png`);
}

function readRecords() {
  const stored = readJsonFile(HISTORY_INDEX, { version: 1, records: [] });
  if (!Array.isArray(stored?.records)) return [];
  return stored.records
    .filter((record) => record?.id && fs.existsSync(imagePath(record.id)))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function writeRecords(records) {
  ensureDir();
  writeJsonAtomic(HISTORY_INDEX, { version: 1, records });
}

function publicRecord(record) {
  return {
    id: String(record.id),
    title: String(record.title || ''),
    genre: String(record.genre || ''),
    storyIdea: String(record.storyIdea || ''),
    ratio: String(record.ratio || '3:4'),
    referencesUsed: Math.max(0, Number(record.referencesUsed) || 0),
    prompt: String(record.prompt || ''),
    createdAt: String(record.createdAt || ''),
    imageUrl: `/api/cover/history/${encodeURIComponent(String(record.id))}.png?t=${encodeURIComponent(String(record.createdAt || ''))}`,
  };
}

export function listStandaloneCoverHistory() {
  return readRecords().map(publicRecord);
}

export function standaloneCoverHistoryImagePath(id) {
  const normalized = safeId(id);
  if (!normalized || normalized !== String(id || '')) return '';
  const file = imagePath(normalized);
  return fs.existsSync(file) ? file : '';
}

export function saveStandaloneCoverHistory({ b64, title = '', genre = '', storyIdea = '', ratio = '3:4', referencesUsed = 0, prompt = '' } = {}) {
  if (!b64) throw new Error('没有可保存的封面图片');
  ensureDir();
  const id = `cover_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  writeFileAtomic(imagePath(id), Buffer.from(String(b64), 'base64'));
  const record = {
    id,
    title: String(title || '').trim().slice(0, 80),
    genre: String(genre || '').trim().slice(0, 80),
    storyIdea: String(storyIdea || '').trim().slice(0, 1200),
    ratio: String(ratio || '3:4'),
    referencesUsed: Math.max(0, Number(referencesUsed) || 0),
    prompt: String(prompt || '').trim().slice(0, 12000),
    createdAt,
  };
  const previous = readRecords().filter((item) => item.id !== id);
  const records = [record, ...previous].slice(0, HISTORY_LIMIT);
  const removed = previous.slice(HISTORY_LIMIT - 1);
  writeRecords(records);
  for (const old of removed) {
    try { fs.rmSync(imagePath(old.id), { force: true }); } catch { /* best effort cleanup */ }
  }
  return publicRecord(record);
}

export function deleteStandaloneCoverHistory(id) {
  const normalized = safeId(id);
  if (!normalized || normalized !== String(id || '')) return false;
  const records = readRecords();
  const next = records.filter((record) => record.id !== normalized);
  if (next.length === records.length) return false;
  writeRecords(next);
  try { fs.rmSync(imagePath(normalized), { force: true }); } catch { /* best effort cleanup */ }
  return true;
}

export function clearStandaloneCoverHistory() {
  const records = readRecords();
  writeRecords([]);
  for (const record of records) {
    try { fs.rmSync(imagePath(record.id), { force: true }); } catch { /* best effort cleanup */ }
  }
  return records.length;
}
