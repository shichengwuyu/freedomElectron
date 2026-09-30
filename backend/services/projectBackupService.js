import fs from 'fs';
import path from 'path';

import { createTempDir, DATA_DIR, USER_APP_DIR } from '../config.js';
import { ensureDir, moveDirectory, writeJsonAtomic } from '../lib/atomicJson.js';
import { extractZipToDirectory } from '../lib/zipReader.js';
import { streamZip } from '../zip.js';

const BACKUP_ROOT = 'Freedom-Backup';
const LEGACY_BACKUP_ROOT = 'GG-Studio-Backup';

function normalizeArchivePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function listFilesRecursive(root, archivePrefix) {
  if (!fs.existsSync(root)) return [];
  const entries = [];
  const walk = (dir, rel = '') => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    if (!items.length && rel) {
      entries.push({ name: `${archivePrefix}/${normalizeArchivePath(rel)}/`, directory: true });
      return;
    }
    for (const item of items) {
      const absolute = path.join(dir, item.name);
      const relative = rel ? path.join(rel, item.name) : item.name;
      const archiveName = `${archivePrefix}/${normalizeArchivePath(relative)}`;
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) walk(absolute, relative);
      else if (item.isFile()) entries.push({ name: archiveName, path: absolute });
    }
  };
  walk(root);
  return entries;
}

export function backupFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `Freedom-Backup-${stamp}.zip`;
}

export async function exportBackup(output) {
  const tempDir = ensureDir(path.join(USER_APP_DIR, 'temp'));
  const manifestFile = path.join(tempDir, `backup-manifest-${process.pid}-${Date.now()}.json`);
  const manifest = {
    format: 'gg-studio-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    includes: ['data'],
    excludes: ['API keys', 'sessions', 'config.json'],
  };
  writeJsonAtomic(manifestFile, manifest);
  try {
    const entries = [
      { name: `${BACKUP_ROOT}/manifest.json`, path: manifestFile },
      ...listFilesRecursive(DATA_DIR, `${BACKUP_ROOT}/data`),
    ];
    await streamZip(entries, output);
    return { entries: entries.length };
  } finally {
    try { fs.rmSync(manifestFile, { force: true }); } catch { /* ignore */ }
  }
}

function mergeDirectoryWithoutOverwrite(source, destination, result, prefix = '') {
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('备份暂存区包含符号链接');
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (fs.existsSync(to)) {
      if (entry.isDirectory() && fs.statSync(to).isDirectory()) {
        mergeDirectoryWithoutOverwrite(from, to, result, label);
      } else {
        result.skipped.push(label);
      }
      continue;
    }
    if (entry.isDirectory()) moveDirectory(from, to);
    else {
      ensureDir(path.dirname(to));
      fs.renameSync(from, to);
    }
    result.restored.push(label);
  }
}

function readBackupManifest(workspace) {
  const manifestFile = path.join(workspace, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('备份缺少 manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
  catch { throw new Error('备份 manifest.json 已损坏'); }
  if (manifest?.format !== 'gg-studio-backup') throw new Error('备份格式不受支持');
  if (Number(manifest.version) !== 1) throw new Error(`备份版本不受支持：${manifest.version ?? '未知'}`);
  return manifest;
}

export async function importBackup(zipFile) {
  const workspace = createTempDir('gg-studio-restore-');
  const result = { restored: [], skipped: [], extracted: 0 };
  try {
    result.extracted = await extractZipToDirectory(zipFile, workspace, { prefix: BACKUP_ROOT });
    if (!result.extracted) {
      result.extracted = await extractZipToDirectory(zipFile, workspace, { prefix: LEGACY_BACKUP_ROOT });
    }
    if (!result.extracted) throw new Error('备份中没有可恢复的文件');
    readBackupManifest(workspace);
    const stagedData = path.join(workspace, 'data');
    if (!fs.existsSync(stagedData) || !fs.statSync(stagedData).isDirectory()) throw new Error('备份中没有 data 目录');
    ensureDir(DATA_DIR);
    mergeDirectoryWithoutOverwrite(stagedData, DATA_DIR, result);
    return result;
  } finally {
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function createBackupUploadPath() {
  const dir = ensureDir(path.join(USER_APP_DIR, 'temp'));
  return path.join(dir, `backup-upload-${process.pid}-${Date.now()}.zip`);
}

