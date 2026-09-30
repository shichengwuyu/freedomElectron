import { buildProjectQualityReport, fixProjectQualityIssue } from '../services/projectQualityService.js';

export async function handleQualityRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if (p === '/api/quality/report' && method === 'GET') {
    const projectId = url.searchParams.get('projectId') || '';
    try {
      sendJson(res, 200, { ok: true, report: buildProjectQualityReport(projectId) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return true;
  }
  if (p === '/api/quality/fix' && method === 'POST') {
    try {
      const body = await readBody(req);
      const report = fixProjectQualityIssue(body.projectId, body.action);
      sendJson(res, 200, { ok: true, report });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return true;
  }
  return false;
}
