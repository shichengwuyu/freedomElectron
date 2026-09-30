import { loadConfig } from '../config.js';
﻿import { clearUsageRecords, listUsageRecords, usageSummary } from '../services/costLedgerService.js';

export async function handleUsageRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if (p === '/api/usage/summary' && method === 'GET') {
    const projectId = url.searchParams.get('projectId') || '';
    const days = Number(url.searchParams.get('days')) || 30;
    const currency = loadConfig().costTracking?.currency || 'CNY';
    sendJson(res, 200, { ok: true, summary: usageSummary({ projectId, days, currency }) });
    return true;
  }
  if (p === '/api/usage/records' && method === 'GET') {
    const projectId = url.searchParams.get('projectId') || '';
    const days = Number(url.searchParams.get('days')) || 30;
    const limit = Number(url.searchParams.get('limit')) || 200;
    sendJson(res, 200, { ok: true, records: listUsageRecords({ projectId, days, limit }) });
    return true;
  }
  if (p === '/api/usage/clear' && method === 'POST') {
    const body = await readBody(req);
    const count = clearUsageRecords({ projectId: body.projectId || '' });
    sendJson(res, 200, { ok: true, count });
    return true;
  }
  return false;
}
