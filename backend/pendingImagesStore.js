// 待同步图片记录的共享存储层。
// Pending image records share a single atomic JSON store.
// 造成的丢更新与写到一半的 JSON 损坏。同一进程内 JS 单线程，只要所有变更都走这份缓存，
// 就不存在读-改-写竞态；落盘用 tmp+rename 保证崩溃时原文件不被截断。
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const PENDING_IMAGES_PATH = path.join(DATA_DIR, 'pending-images.json');

let cache = null;

function loadFromDisk() {
  try {
    if (!fs.existsSync(PENDING_IMAGES_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(PENDING_IMAGES_PATH, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ensureCache() {
  if (cache === null) cache = loadFromDisk();
  return cache;
}

function flush() {
  fs.mkdirSync(path.dirname(PENDING_IMAGES_PATH), { recursive: true });
  const tmp = `${PENDING_IMAGES_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(cache || {}, null, 2), 'utf-8');
  fs.renameSync(tmp, PENDING_IMAGES_PATH);
}

// 只读快照：返回浅拷贝，防止外部直接改到缓存对象。
export function getRecord(key) {
  return ensureCache()[key] || null;
}

export function listRecords() {
  return Object.values(ensureCache());
}

// 用 mutator 原子地读-改-写：mutator 直接操作缓存对象，返回 true 表示有变更需落盘。
// 返回 mutator 的返回值之外的信息通过闭包传出即可。
export function mutate(mutator) {
  const records = ensureCache();
  const changed = mutator(records);
  if (changed !== false) flush();
  return changed;
}
