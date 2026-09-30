import fs from 'fs';

import { saveRequestBodyToFile } from '../http.js';
import {
  duplicateProject,
  emptyProjectTrash,
  listProjectSnapshots,
  purgeDeletedProject,
  renameProject,
  restoreProjectSnapshot,
  setProjectArchived,
} from '../services/projectLifecycleService.js';
import {
  backupFilename,
  createBackupUploadPath,
  exportBackup,
  importBackup,
} from '../services/projectBackupService.js';
import {
  createProjectPackageUploadPath,
  exportProjectPackage,
  importProjectPackage,
  prepareProjectPackageExport,
} from '../services/projectTransferService.js';

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

function routeError(sendJson, res, error) {
  return handled(sendJson, res, 400, { ok: false, error: error?.message || String(error) });
}

export async function handleProjectMaintenanceRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if (p === '/api/projects/export' && method === 'GET') {
    let plan;
    try {
      plan = prepareProjectPackageExport(url.searchParams.getAll('id'));
    } catch (error) {
      return routeError(sendJson, res, error);
    }
    res.writeHead(200, {
      'Content-Type': 'application/vnd.yanzhi.project+zip',
      'Content-Disposition': `attachment; filename="YanzhiAI-Projects.zip"; filename*=UTF-8''${encodeURIComponent(plan.filename)}`,
      'Cache-Control': 'no-store',
    });
    try {
      await exportProjectPackage(plan, res);
    } catch (error) {
      if (!res.destroyed) res.destroy(error);
    } finally {
      plan.cleanup();
    }
    return true;
  }

  if (p === '/api/projects/import' && method === 'POST') {
    const uploadFile = createProjectPackageUploadPath();
    try {
      await saveRequestBodyToFile(req, uploadFile, 0xffffffff);
      const result = await importProjectPackage(uploadFile);
      return handled(sendJson, res, 200, { ok: true, ...result });
    } catch (error) {
      return routeError(sendJson, res, error);
    } finally {
      try { fs.rmSync(uploadFile, { force: true }); } catch { /* ignore */ }
    }
  }

  if (p === '/api/project/rename' && method === 'POST') {
    try {
      const body = await readBody(req);
      const project = renameProject(body.projectId, body.name);
      return handled(sendJson, res, 200, { ok: true, projectId: project.id, project });
    } catch (error) { return routeError(sendJson, res, error); }
  }

  if (p === '/api/project/duplicate' && method === 'POST') {
    try {
      const body = await readBody(req);
      const project = duplicateProject(body.projectId, body.name);
      return handled(sendJson, res, 200, { ok: true, projectId: project.id, project });
    } catch (error) { return routeError(sendJson, res, error); }
  }

  if (p === '/api/project/archive' && method === 'POST') {
    try {
      const body = await readBody(req);
      const project = setProjectArchived(body.projectId, body.archived !== false);
      return handled(sendJson, res, 200, { ok: true, projectId: project.id, archivedAt: project.archivedAt });
    } catch (error) { return routeError(sendJson, res, error); }
  }

  if (p === '/api/project/trash/purge' && method === 'POST') {
    try {
      const body = await readBody(req);
      purgeDeletedProject(body.trashId);
      return handled(sendJson, res, 200, { ok: true });
    } catch (error) { return routeError(sendJson, res, error); }
  }

  if (p === '/api/project/trash/empty' && method === 'POST') {
    try {
      const count = emptyProjectTrash();
      return handled(sendJson, res, 200, { ok: true, count });
    } catch (error) { return routeError(sendJson, res, error); }
  }

  if (p === '/api/project/snapshots' && method === 'GET') {
    try {
      const projectId = url.searchParams.get('projectId') || '';
      return handled(sendJson, res, 200, { ok: true, snapshots: listProjectSnapshots(projectId) });
    } catch (error) { return routeError(sendJson, res, error); }
  }

  if (p === '/api/project/snapshot/restore' && method === 'POST') {
    try {
      const body = await readBody(req);
      const project = restoreProjectSnapshot(body.projectId, body.snapshotId);
      return handled(sendJson, res, 200, { ok: true, projectId: project.id, project });
    } catch (error) { return routeError(sendJson, res, error); }
  }

  if (p === '/api/backups/export' && method === 'GET') {
    const filename = backupFilename();
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="YanzhiAI-Backup.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    });
    try {
      await exportBackup(res);
    } catch (error) {
      if (!res.destroyed) res.destroy(error);
    }
    return true;
  }

  if (p === '/api/backups/import' && method === 'POST') {
    const uploadFile = createBackupUploadPath();
    try {
      await saveRequestBodyToFile(req, uploadFile);
      const result = await importBackup(uploadFile);
      return handled(sendJson, res, 200, { ok: true, ...result });
    } catch (error) {
      return routeError(sendJson, res, error);
    } finally {
      try { fs.rmSync(uploadFile, { force: true }); } catch { /* ignore */ }
    }
  }

  return false;
}

