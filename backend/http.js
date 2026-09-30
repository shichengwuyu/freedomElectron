import { Buffer } from 'buffer';
import fs from 'fs';

export const DEFAULT_REQUEST_MAX_BYTES = 80 * 1024 * 1024;

export function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
  return true;
}

export function readBody(req, maxBytes = DEFAULT_REQUEST_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}


export function saveRequestBodyToFile(req, file, maxBytes = 2 * 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(file, { flags: 'wx' });
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
      reject(error);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new Error('\u8bf7\u6c42\u4f53\u8fc7\u5927'));
        req.destroy();
      }
    });
    req.on('aborted', () => fail(new Error('\u4e0a\u4f20\u5df2\u4e2d\u65ad')));
    req.on('error', fail);
    output.on('error', fail);
    output.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve({ file, size });
    });
    req.pipe(output);
  });
}

