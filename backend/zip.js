// 极简 ZIP 打包：仅用 Node 内置 zlib，无第三方依赖
// 生成标准 ZIP（每个条目用 deflate 压缩），支持中文文件名(UTF-8 flag)
import fs from 'fs';
import zlib from 'zlib';
import { Buffer } from 'buffer';

// CRC32 表
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function updateCrc32(crc, buf) {
  let next = crc;
  for (let i = 0; i < buf.length; i++) {
    next = CRC_TABLE[(next ^ buf[i]) & 0xff] ^ (next >>> 8);
  }
  return next;
}

function crc32(buf) {
  return (updateCrc32(0xffffffff, buf) ^ 0xffffffff) >>> 0;
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    if (stream.write(chunk)) return resolve();
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

function streamFinished(stream) {
  return new Promise((resolve, reject) => {
    stream.once('end', resolve);
    stream.once('error', reject);
  });
}

// entries: [{ name: string, data: Buffer }]
export function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const data = entry.data;
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);
    central.push(makeCentralEntry(nameBuf, crc, compressed.length, data.length, offset));
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = makeEndRecord(entries.length, centralBuf.length, offset);
  return Buffer.concat([...chunks, centralBuf, end]);
}

function makeCentralEntry(nameBuf, crc, compressedSize, size, offset, flags = 0x0800, method = 8, externalAttrs = 0) {
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(flags, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(0, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(compressedSize, 20);
  cd.writeUInt32LE(size, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(externalAttrs, 38);
  cd.writeUInt32LE(offset, 42);
  return Buffer.concat([cd, nameBuf]);
}

function makeEndRecord(count, centralSize, centralOffset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

export async function streamZip(entries, output) {
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const entryName = entry.directory && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name;
    const nameBuf = Buffer.from(entryName, 'utf-8');

    if (entry.directory) {
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(0, 18);
      local.writeUInt32LE(0, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      await writeChunk(output, local);
      await writeChunk(output, nameBuf);
      central.push(makeCentralEntry(nameBuf, 0, 0, 0, offset, 0x0800, 0, 0x10));
      offset += local.length + nameBuf.length;
      continue;
    }

    const stat = await fs.promises.stat(entry.path);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    await writeChunk(output, local);
    await writeChunk(output, nameBuf);

    let crc = 0xffffffff;
    let compressedSize = 0;
    const deflater = zlib.createDeflateRaw();
    deflater.on('data', (chunk) => {
      compressedSize += chunk.length;
      output.write(chunk);
    });

    const input = fs.createReadStream(entry.path);
    input.on('data', (chunk) => {
      crc = updateCrc32(crc, chunk);
    });
    input.pipe(deflater);
    await streamFinished(deflater);

    const finalCrc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(finalCrc, 4);
    descriptor.writeUInt32LE(compressedSize, 8);
    descriptor.writeUInt32LE(stat.size, 12);
    await writeChunk(output, descriptor);

    central.push(makeCentralEntry(nameBuf, finalCrc, compressedSize, stat.size, offset, 0x0808));
    offset += local.length + nameBuf.length + compressedSize + descriptor.length;
  }

  const centralOffset = offset;
  const centralBuf = Buffer.concat(central);
  await writeChunk(output, centralBuf);
  await writeChunk(output, makeEndRecord(entries.length, centralBuf.length, centralOffset));
  output.end();
}
