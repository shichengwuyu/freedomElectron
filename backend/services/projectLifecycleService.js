import fs from 'fs';
import path from 'path';

import {
  deleteProject,
  listDeletedProjects,
  loadProject,
  projectDir,
  projectExists,
  registerProjectIdAlias,
  restoreDeletedProject,
  sanitizeFilename,
  saveProject,
} from '../storage.js';
import { copyDirectory, moveDirectory, readJsonFile } from '../lib/atomicJson.js';
import { renamePendingProject as renamePendingVideosProject } from '../pendingVideos.js';
import { renamePendingProject as renamePendingImagesProject } from '../pendingImages.js';

const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9_.-]+\.json$/;

function snapshotsDir(projectId) {
  return path.join(projectDir(projectId), '.snapshots');
}

function trashProjectsDir() {
  return path.join(path.dirname(projectDir('__placeholder__')), '.trash', 'projects');
}

function validateProjectName(value) {
  const name = String(value || '').trim();
  if (!name) throw new Error('请填写项目名称');
  const id = sanitizeFilename(name, 'project');
  if (id !== name) throw new Error('项目名称不能包含 \\/:*?"<>| 或以点号结尾');
  return { id, name };
}

export function renameProject(projectId, nextName) {
  const current = loadProject(projectId);
  if (!current) throw new Error('项目不存在');
  const { id: nextId, name } = validateProjectName(nextName);
  if (nextId !== current.id && projectExists(nextId)) throw new Error('已存在同名项目');

  const sourceDir = projectDir(current.id);
  const destinationDir = projectDir(nextId);
  if (sourceDir !== destinationDir) moveDirectory(sourceDir, destinationDir);
  const previousId = current.id;
  current.id = nextId;
  current.name = name;
  if (current.script?.storyboards && Array.isArray(current.script.storyboards)) {
    current.script.storyboards = current.script.storyboards.map((storyboard) => {
      if (!storyboard || typeof storyboard !== 'object') return storyboard;
      if (!storyboard.shotVideos || typeof storyboard.shotVideos !== 'object') return storyboard;
      const shotVideos = Object.fromEntries(Object.entries(storyboard.shotVideos).map(([shotNo, value]) => [
        shotNo,
        value && typeof value === 'object' && String(value.videoUrl || '').startsWith('/video/')
          ? { ...value, videoUrl: `/video/${encodeURIComponent(nextId)}/${encodeURIComponent(String(storyboard.episodeId))}/${encodeURIComponent(String(shotNo))}.mp4?t=${Date.now()}` }
          : value,
      ]));
      return { ...storyboard, shotVideos };
    });
  }
  current.updatedAt = new Date().toISOString();
  saveProject(current);
  // Keep old media URLs/background task references resolvable while all
  // project data is rewritten with the new canonical id.
  registerProjectIdAlias(previousId, nextId);
  renamePendingVideosProject(previousId, nextId);
  renamePendingImagesProject(previousId, nextId);
  return current;
}

export function duplicateProject(projectId, nextName) {
  const source = loadProject(projectId);
  if (!source) throw new Error('项目不存在');
  const { id: nextId, name } = validateProjectName(nextName);
  if (projectExists(nextId)) throw new Error('已存在同名项目');

  const destination = projectDir(nextId);
  copyDirectory(projectDir(source.id), destination, {
    filter: (_from, _to, entry) => entry.name !== '.snapshots',
  });
  const now = new Date().toISOString();
  const copy = {
    ...source,
    id: nextId,
    name,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  saveProject(copy);
  return copy;
}

export function setProjectArchived(projectId, archived = true) {
  const project = loadProject(projectId);
  if (!project) throw new Error('项目不存在');
  project.archivedAt = archived ? new Date().toISOString() : null;
  project.updatedAt = new Date().toISOString();
  saveProject(project);
  return project;
}

export function listProjectSnapshots(projectId) {
  if (!projectExists(projectId)) throw new Error('项目不存在');
  const dir = snapshotsDir(projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SNAPSHOT_ID_PATTERN.test(entry.name))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      const stat = fs.statSync(file);
      const project = readJsonFile(file, {});
      return {
        id: entry.name,
        createdAt: stat.mtime.toISOString(),
        projectName: project?.name || projectId,
        updatedAt: project?.updatedAt || '',
        counts: {
          character: (project?.elements?.character || []).length,
          group: (project?.elements?.group || []).length,
          scene: (project?.elements?.scene || []).length,
          prop: (project?.elements?.prop || []).length,
          effect: (project?.elements?.effect || []).length,
          creature: (project?.elements?.creature || []).length,
          chapters: (project?.script?.chapters || []).length,
          episodes: (project?.script?.episodes || []).length,
          storyboards: (project?.script?.storyboards || []).length,
        },
        bytes: stat.size,
      };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

export function restoreProjectSnapshot(projectId, snapshotId) {
  if (!SNAPSHOT_ID_PATTERN.test(String(snapshotId || ''))) throw new Error('快照 id 无效');
  const current = loadProject(projectId);
  if (!current) throw new Error('项目不存在');
  const file = path.join(snapshotsDir(projectId), snapshotId);
  const snapshot = readJsonFile(file, null);
  if (!snapshot || typeof snapshot !== 'object') throw new Error('快照不存在或已损坏');
  snapshot.id = current.id;
  snapshot.name = current.name;
  snapshot.createdAt = current.createdAt || snapshot.createdAt;
  snapshot.updatedAt = new Date().toISOString();
  // 恢复历史版本前必须留住当前状态的快照，否则恢复操作本身无法回退
  saveProject(snapshot, { forceSnapshot: true });
  return snapshot;
}

export function purgeDeletedProject(trashId) {
  const safeId = path.basename(String(trashId || ''));
  if (!safeId || safeId !== String(trashId || '')) throw new Error('回收站项目 id 无效');
  const dir = path.join(trashProjectsDir(), safeId);
  if (!fs.existsSync(dir)) throw new Error('回收站项目不存在');
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function emptyProjectTrash() {
  const projects = listDeletedProjects();
  for (const item of projects) purgeDeletedProject(item.trashId);
  return projects.length;
}

export { deleteProject, listDeletedProjects, restoreDeletedProject };
