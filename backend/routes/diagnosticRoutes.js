import { buildDiagnosticPackage, diagnosticFilename, diagnosticsStatus } from '../diagnostics.js';

export async function handleDiagnosticRoutes({ res, p, method, sendJson }) {
  if (p === '/api/diagnostics/status' && method === 'GET') {
    sendJson(res, 200, diagnosticsStatus());
    return true;
  }

  if (p === '/api/diagnostics/export' && method === 'GET') {
    const archive = buildDiagnosticPackage();
    const filename = diagnosticFilename();
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': archive.length,
      'Content-Disposition': `attachment; filename="YanzhiAI-Diagnostics.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    });
    res.end(archive);
    return true;
  }

  return false;
}
