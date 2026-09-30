import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_U16 = 0xffff;
const ZIP64_U32 = 0xffffffff;
const UNIX_HOST = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;

export const DEFAULT_ZIP_LIMITS = Object.freeze({
  maxEntries: 200000,
  maxCentralDirectoryBytes: 64 * 1024 * 1024,
  maxEntryBytes: 0xffffffff,
  maxUncompressedBytes: 50 * 1024 * 1024 * 1024,
  maxCompressionRatio: 500,
});

function normalizeArchivePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function safeZipRelativePath(value) {
  const raw = String(value || '');
  if (/^[\\/]/.test(raw)) throw new Error('ZIP 包含绝对路径');
  const normalized = normalizeArchivePath(raw);
  if (!normalized || normalized.includes('\0')) return '';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('ZIP 包含不安全路径');
  if (/^[A-Za-z]:/.test(parts[0] || '')) throw new Error('ZIP 包含绝对路径');
  return parts.join('/');
}

function readExactly(fd, length, position, fileSize) {
  if (!Number.isSafeInteger(length) || length < 0 || position < 0 || position + length > fileSize) {
    throw new Error('ZIP 文件结构越界');
  }
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytes = fs.readSync(fd, buffer, offset, length - offset, position + offset);
    if (!bytes) throw new Error('ZIP 文件不完整');
    offset += bytes;
  }
  return buffer;
}

function findEndOfCentralDirectory(fd, fileSize) {
  if (fileSize < 22) throw new Error('不是有效的 ZIP 文件');
  const readSize = Math.min(fileSize, 22 + 0xffff);
  const buffer = readExactly(fd, readSize, fileSize - readSize, fileSize);
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const diskNumber = buffer.readUInt16LE(offset + 4);
    const centralDisk = buffer.readUInt16LE(offset + 6);
    const countOnDisk = buffer.readUInt16LE(offset + 8);
    const count = buffer.readUInt16LE(offset + 10);
    const centralSize = buffer.readUInt32LE(offset + 12);
    const centralOffset = buffer.readUInt32LE(offset + 16);
    if (diskNumber !== 0 || centralDisk !== 0 || countOnDisk !== count) throw new Error('不支持分卷 ZIP');
    if (count === ZIP64_U16 || centralSize === ZIP64_U32 || centralOffset === ZIP64_U32) {
      throw new Error('暂不支持 ZIP64 备份');
    }
    return { count, centralSize, centralOffset };
  }
  throw new Error('不是有效的 ZIP 文件');
}

function isUnixSymlink(versionMadeBy, externalAttributes) {
  const host = (versionMadeBy >>> 8) & 0xff;
  if (host !== UNIX_HOST) return false;
  const mode = (externalAttributes >>> 16) & 0xffff;
  return (mode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE;
}

function checkEntryLimits(entry, totals, limits) {
  if (entry.size > limits.maxEntryBytes) throw new Error(`ZIP 单个条目过大：${entry.name}`);
  totals.uncompressed += entry.size;
  if (totals.uncompressed > limits.maxUncompressedBytes) throw new Error('ZIP 解压后总大小过大');
  if (entry.size > 1024 * 1024) {
    if (entry.compressedSize === 0) throw new Error(`ZIP 条目压缩数据异常：${entry.name}`);
    const ratio = entry.size / entry.compressedSize;
    if (ratio > limits.maxCompressionRatio) throw new Error(`ZIP 条目压缩比异常：${entry.name}`);
  }
}

export function readZipEntries(zipFile, overrides = {}) {
  const limits = { ...DEFAULT_ZIP_LIMITS, ...overrides };
  const fd = fs.openSync(zipFile, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const eocd = findEndOfCentralDirectory(fd, stat.size);
    if (eocd.count > limits.maxEntries) throw new Error('ZIP 文件条目过多');
    if (eocd.centralSize > limits.maxCentralDirectoryBytes) throw new Error('ZIP 中央目录过大');
    if (eocd.centralOffset + eocd.centralSize > stat.size) throw new Error('ZIP 中央目录越界');
    const central = readExactly(fd, eocd.centralSize, eocd.centralOffset, stat.size);
    const entries = [];
    const totals = { uncompressed: 0 };
    let cursor = 0;

    while (entries.length < eocd.count) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
        throw new Error('ZIP 中央目录损坏');
      }
      const versionMadeBy = central.readUInt16LE(cursor + 4);
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const size = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const externalAttributes = central.readUInt32LE(cursor + 38);
      const localOffset = central.readUInt32LE(cursor + 42);
      const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
      if (nextCursor > central.length) throw new Error('ZIP 中央目录条目不完整');
      if (compressedSize === ZIP64_U32 || size === ZIP64_U32 || localOffset === ZIP64_U32) {
        throw new Error('暂不支持 ZIP64 备份');
      }
      if (flags & 0x0001) throw new Error('不支持加密 ZIP');
      if (![0, 8].includes(method)) throw new Error(`不支持的 ZIP 压缩方式：${method}`);
      if (isUnixSymlink(versionMadeBy, externalAttributes)) throw new Error('ZIP 包含符号链接，已拒绝导入');

      const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      const name = safeZipRelativePath(rawName);
      if (!name) throw new Error('ZIP 包含空文件名');
      const entry = {
        name,
        rawName,
        directory: rawName.endsWith('/'),
        method,
        flags,
        compressedSize,
        size,
        localOffset,
      };
      checkEntryLimits(entry, totals, limits);
      entries.push(entry);
      cursor = nextCursor;
    }

    if (cursor !== central.length) {
      const trailing = central.subarray(cursor);
      if (trailing.some((byte) => byte !== 0)) throw new Error('ZIP 中央目录包含异常尾部数据');
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

async function extractEntry(zipFile, fd, fileSize, entry, destination) {
  const local = readExactly(fd, 30, entry.localOffset, fileSize);
  if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error('ZIP 本地文件头损坏');
  const localFlags = local.readUInt16LE(6);
  const localMethod = local.readUInt16LE(8);
  const nameLength = local.readUInt16LE(26);
  const extraLength = local.readUInt16LE(28);
  if (localFlags & 0x0001) throw new Error('不支持加密 ZIP');
  if (localMethod !== entry.method) throw new Error(`ZIP 压缩方式不一致：${entry.name}`);
  const localName = readExactly(fd, nameLength, entry.localOffset + 30, fileSize).toString('utf8');
  if (localName !== entry.rawName) throw new Error(`ZIP 本地文件名不一致：${entry.name}`);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressedSize > fileSize) throw new Error(`ZIP 条目数据越界：${entry.name}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (entry.compressedSize === 0) {
    if (entry.size !== 0) throw new Error(`ZIP 条目压缩数据异常：${entry.name}`);
    fs.writeFileSync(destination, Buffer.alloc(0), { flag: 'wx' });
    return;
  }

  let outputBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      outputBytes += chunk.length;
      if (outputBytes > entry.size) callback(new Error(`ZIP 条目解压大小异常：${entry.name}`));
      else callback(null, chunk);
    },
  });
  const source = fs.createReadStream(zipFile, {
    fd,
    autoClose: false,
    start: dataOffset,
    end: dataOffset + entry.compressedSize - 1,
  });
  const output = fs.createWriteStream(destination, { flags: 'wx' });
  try {
    if (entry.method === 0) await pipeline(source, limiter, output);
    else await pipeline(source, zlib.createInflateRaw(), limiter, output);
    if (outputBytes !== entry.size) throw new Error(`ZIP 条目大小不匹配：${entry.name}`);
  } catch (error) {
    try { fs.rmSync(destination, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

export async function extractZipToDirectory(zipFile, destinationRoot, { prefix = '', limits = {} } = {}) {
  const entries = readZipEntries(zipFile, limits);
  const fd = fs.openSync(zipFile, 'r');
  const fileSize = fs.fstatSync(fd).size;
  const normalizedPrefix = prefix ? `${safeZipRelativePath(prefix).replace(/\/+$/, '')}/` : '';
  const resolvedRoot = path.resolve(destinationRoot);
  let extracted = 0;
  try {
    for (const entry of entries) {
      if (normalizedPrefix && !entry.name.startsWith(normalizedPrefix)) continue;
      const relative = normalizedPrefix ? entry.name.slice(normalizedPrefix.length) : entry.name;
      if (!relative || entry.directory) continue;
      const safe = safeZipRelativePath(relative);
      const destination = path.resolve(resolvedRoot, ...safe.split('/'));
      const rootPrefix = `${resolvedRoot}${path.sep}`;
      if (!destination.startsWith(rootPrefix)) throw new Error('ZIP 解压路径越界');
      await extractEntry(zipFile, fd, fileSize, entry, destination);
      extracted++;
    }
  } finally {
    fs.closeSync(fd);
  }
  return extracted;
}

