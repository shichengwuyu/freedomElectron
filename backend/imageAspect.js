import { Buffer } from 'buffer';

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function decimalPlaces(value) {
  const text = String(value);
  const index = text.indexOf('.');
  return index < 0 ? 0 : Math.min(4, text.length - index - 1);
}

export function parseImageRatio(ratio) {
  const match = String(ratio || '').trim().match(/^(\d{1,4}(?:\.\d{1,4})?):(\d{1,4}(?:\.\d{1,4})?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = 10 ** Math.max(decimalPlaces(match[1]), decimalPlaces(match[2]));
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);
  const divisor = gcd(scaledWidth, scaledHeight);
  return {
    width,
    height,
    value: width / height,
    unitWidth: scaledWidth / divisor,
    unitHeight: scaledHeight / divisor,
  };
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), format: 'jpeg' };
    }
    offset += length + 2;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3), format: 'webp' };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: 'webp' };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const width = 1 + buffer[21] + ((buffer[22] & 0x3f) << 8);
    const height = 1 + ((buffer[22] & 0xc0) >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10);
    return { width, height, format: 'webp' };
  }
  return null;
}

export function imageDimensions(value) {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(String(value || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''), 'base64');
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), format: 'gif' };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) return jpegDimensions(buffer);
  return webpDimensions(buffer);
}
