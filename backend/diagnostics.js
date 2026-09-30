import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

import { loadConfig, LOG_DIR } from './config.js';
import { listJobs } from './jobs.js';
import { listLogFiles, logger, redact } from './logger.js';
import { buildZip } from './zip.js';

const require = createRequire(import.meta.url);
let appVersion = '';
try { appVersion = require('../package.json').version || ''; } catch { /* ignore */ }

function configSummary() {
  const cfg = loadConfig();
  return {
    text: {
      baseUrl: cfg.text?.baseUrl || '',
      model: cfg.text?.model || '',
      hasApiKey: Boolean(cfg.text?.apiKey),
      maxTokens: cfg.text?.maxTokens || 0,
    },
    image: {
      baseUrl: cfg.image?.baseUrl || '',
      model: cfg.image?.model || '',
      hasApiKey: Boolean(cfg.image?.apiKey),
      ratio: cfg.image?.ratio || '',
    },
    video: {
      provider: cfg.video?.provider || '',
      updreamBaseUrl: cfg.video?.updreamBaseUrl || '',
      updreamModel: cfg.video?.updreamModel || '',
      hasUpdreamAccessToken: Boolean(cfg.video?.updreamAccessToken),
      hasUpdreamRefreshToken: Boolean(cfg.video?.updreamRefreshToken),
      apiBaseUrl: cfg.video?.apiBaseUrl || '',
      apiModel: cfg.video?.apiModel || '',
      hasApiKey: Boolean(cfg.video?.apiKey),
      accountCount: Array.isArray(cfg.video?.xiaoyunqueAccounts) ? cfg.video.xiaoyunqueAccounts.length : 0,
    },
    performance: {
      hardwareAcceleration: cfg.performance?.hardwareAcceleration !== false,
      reduceMotion: cfg.performance?.reduceMotion === true,
    },
    chunkSize: cfg.chunkSize || 0,
  };
}

function taskSummary() {
  return listJobs().map((task) => ({
    id: task.id,
    type: task.type || task.kind || '',
    status: task.status || '',
    progress: task.progress ?? task.processed ?? '',
    total: task.total ?? '',
    createdAt: task.createdAt || '',
    updatedAt: task.updatedAt || '',
    error: task.error ? String(task.error).slice(0, 500) : '',
    interruptedAt: task.interruptedAt || '',
  }));
}

export function diagnosticsStatus() {
  const tasks = taskSummary();
  return redact({
    ok: true,
    app: {
      name: 'Freedom',
      version: appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      safeMode: process.argv.includes('--safe-mode') || process.env.GG_SAFE_MODE === '1',
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpuCount: os.cpus()?.length || 0,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      node: process.versions.node,
      electron: process.versions.electron || '',
    },
    config: configSummary(),
    tasks: {
      total: tasks.length,
      running: tasks.filter((task) => ['running', 'retrying'].includes(task.status)).length,
      queued: tasks.filter((task) => task.status === 'queued').length,
      paused: tasks.filter((task) => task.status === 'paused').length,
      failed: tasks.filter((task) => ['error', 'failed'].includes(task.status)).length,
    },
    logs: {
      directory: LOG_DIR,
      files: listLogFiles().map((file) => ({ name: path.basename(file), size: fs.statSync(file).size })),
    },
  });
}

function readLogTail(file, maxBytes = 1024 * 1024) {
  const stat = fs.statSync(file);
  const length = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buffer, 0, length, stat.size - length); }
  finally { fs.closeSync(fd); }
  return redact(buffer.toString('utf8'));
}

export function diagnosticFilename() {
  return `Freedom-Diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
}

export function buildDiagnosticPackage() {
  logger.info('diagnostic_export_requested');
  const root = 'Freedom-Diagnostics';
  const status = diagnosticsStatus();
  const tasks = taskSummary();
  const entries = [
    { name: `${root}/system.json`, data: Buffer.from(JSON.stringify(status, null, 2), 'utf8') },
    { name: `${root}/config-summary.json`, data: Buffer.from(JSON.stringify(redact(configSummary()), null, 2), 'utf8') },
    { name: `${root}/tasks.json`, data: Buffer.from(JSON.stringify(redact(tasks), null, 2), 'utf8') },
  ];
  for (const file of listLogFiles()) {
    entries.push({
      name: `${root}/logs/${path.basename(file)}.txt`,
      data: Buffer.from(String(readLogTail(file)), 'utf8'),
    });
  }
  return buildZip(entries);
}
