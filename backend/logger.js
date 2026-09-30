import fs from 'fs';
import path from 'path';

import { LOG_DIR } from './config.js';
import { ensureDir } from './lib/atomicJson.js';

const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_LOG_FILES = 5;
let handlersInstalled = false;

const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|cookie|session|access[-_]?key|secret|token|password)/i;
const SECRET_TEXT_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /((?:api[-_]?key|access[-_]?key|authorization|cookie|session|token|secret|password)\s*[=:]\s*)[^\s,;"']+/gi,
  /("(?:apiKey|api_key|accessKey|access_key|authorization|cookie|session|token|secret|password)"\s*:\s*")[^"]*(")/gi,
];

function redactString(value) {
  let result = String(value ?? '');
  result = result.replace(SECRET_TEXT_PATTERNS[0], '$1[REDACTED]');
  result = result.replace(SECRET_TEXT_PATTERNS[1], '[REDACTED]');
  result = result.replace(SECRET_TEXT_PATTERNS[2], '$1[REDACTED]');
  result = result.replace(SECRET_TEXT_PATTERNS[3], '$1[REDACTED]$2');
  return result;
}

export function redact(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: redactString(value.stack || '').split('\n').slice(0, 30).join('\n'),
      code: value.code,
      status: value.status,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = SECRET_KEY_PATTERN.test(key) && typeof item !== 'boolean' ? '[REDACTED]' : redact(item, seen);
    }
    seen.delete(value);
    return next;
  }
  return redactString(value);
}

function rotateLogs(incomingBytes = 0) {
  ensureDir(LOG_DIR);
  let size = 0;
  try { size = fs.statSync(LOG_FILE).size; } catch { /* new file */ }
  if (size + incomingBytes <= MAX_LOG_BYTES) return;
  try { fs.rmSync(`${LOG_FILE}.${MAX_LOG_FILES - 1}`, { force: true }); } catch { /* ignore */ }
  for (let index = MAX_LOG_FILES - 2; index >= 1; index--) {
    const source = `${LOG_FILE}.${index}`;
    const destination = `${LOG_FILE}.${index + 1}`;
    if (!fs.existsSync(source)) continue;
    try { fs.renameSync(source, destination); } catch { /* ignore */ }
  }
  if (fs.existsSync(LOG_FILE)) {
    try { fs.renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch { /* ignore */ }
  }
}

function append(level, message, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: redactString(message),
  };
  if (details !== undefined) entry.details = redact(details);
  const line = `${JSON.stringify(entry)}\n`;
  try {
    rotateLogs(Buffer.byteLength(line));
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // Logging must never crash the application.
  }
}

export const logger = {
  info(message, details) { append('info', message, details); },
  warn(message, details) { append('warn', message, details); },
  error(message, details) { append('error', message, details); },
};

export function attachRequestLogger(req, res) {
  const startedAt = Date.now();
  let completed = false;
  let pathname = '/';
  try { pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname; } catch { /* keep fallback */ }
  const finish = (event) => {
    if (completed) return;
    completed = true;
    logger.info('http_request', {
      method: req.method || '',
      path: pathname,
      status: res.statusCode || 0,
      durationMs: Date.now() - startedAt,
      event,
    });
  };
  res.once('finish', () => finish('finish'));
  res.once('close', () => finish('close'));
  return finish;
}

export function installGlobalErrorHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('uncaughtException', (error) => {
    logger.error('uncaught_exception', error);
    console.error('Uncaught exception:', error);
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', reason instanceof Error ? reason : { reason });
    console.error('Unhandled rejection:', reason);
  });
}

export function listLogFiles() {
  const files = [LOG_FILE];
  for (let index = 1; index < MAX_LOG_FILES; index++) files.push(`${LOG_FILE}.${index}`);
  return files.filter((file) => fs.existsSync(file));
}

export function readRecentLog(maxBytes = 1024 * 1024) {
  if (!fs.existsSync(LOG_FILE)) return '';
  const stat = fs.statSync(LOG_FILE);
  const length = Math.min(stat.size, Math.max(1, maxBytes));
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(LOG_FILE, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, stat.size - length);
  } finally {
    fs.closeSync(fd);
  }
  return redactString(buffer.toString('utf8'));
}

export { LOG_FILE, MAX_LOG_BYTES, MAX_LOG_FILES };



