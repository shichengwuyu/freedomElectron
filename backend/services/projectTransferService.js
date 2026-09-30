import fs from 'fs';
import path from 'path';

import { createTempDir, USER_APP_DIR } from '../config.js';
import { ensureDir, moveDirectory, writeJsonAtomic } from '../lib/atomicJson.js';
import { extractZipToDirectory } from '../lib/zipReader.js';
import {
  loadProject,
  projectDir,
  projectExists,
  sanitizeFilename,
  saveProject,
} from '../storage.js';
import { streamZip } from '../zip.js';

const PACKAGE_ROOT = 'Freedom-Projects';
const PACKAGE_FORMAT = 'yanzhi-ai-project-package';
const PACKAGE_VERSION = 1;
const MAX_PACKAGE_PROJECTS = 1000;
const MAX_ZIP_ENTRIES = 0xffff;
const MAX_ZIP_SOURCE_BYTES = 3.8 * 1024 * 1024 * 1024;
const TRANSIENT_PROJECT_FILES = new Set([
  'list-summary.json',
  'storage-transaction.json',
]);

function normalizeArchivePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function listProjectFiles(root, archivePrefix) {
  const files = [];
  const walk = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (!relative && TRANSIENT_PROJECT_FILES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) walk(absolute, nextRelative);
      else if (entry.isFile()) {
        files.push({
          name: `${archivePrefix}/${normalizeArchivePath(nextRelative)}`,
          path: absolute,
          bytes: fs.statSync(absolute).size,
        });
      }
    }
  };
  walk(root);
  return files;
}

function uniqueProjectIds(projectIds) {
  const ids = [...new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new Error('请至少选择一个项目');
  if (ids.length > MAX_PACKAGE_PROJECTS) throw new Error(`一次最多导出 ${MAX_PACKAGE_PROJECTS} 个项目`);
  return ids;
}

function projectPackageFilename(projects) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (projects.length === 1) {
    return `${sanitizeFilename(projects[0].name || projects[0].id, '项目')}-${stamp}.yanzhi-project.zip`;
  }
  return `Freedom-${projects.length}个项目-${stamp}.yanzhi-projects.zip`;
}

function validateZipPlan(entries) {
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('所选项目包含的文件过多，无法放入一个项目包');
  const sourceBytes = entries.reduce((total, entry) => total + (Number(entry.bytes) || 0), 0);
  const oversized = entries.find((entry) => Number(entry.bytes) > 0xffffffff);
  if (oversized) throw new Error(`项目包含超过 4 GB 的单个文件：${path.basename(oversized.path)}`);
  if (sourceBytes > MAX_ZIP_SOURCE_BYTES) throw new Error('所选项目总大小超过 3.8 GB，请减少选择后分批导出');
}

export function prepareProjectPackageExport(projectIds) {
  const ids = uniqueProjectIds(projectIds);
  const tempDir = ensureDir(path.join(USER_APP_DIR, 'temp'));
  const manifestFile = path.join(tempDir, `project-package-manifest-${process.pid}-${Date.now()}.json`);
  const projects = ids.map((id, index) => {
    const project = loadProject(id);
    if (!project || !projectExists(id)) throw new Error(`项目不存在：${id}`);
    return {
      id: project.id,
      name: project.name || project.id,
      folder: `projects/project-${String(index + 1).padStart(4, '0')}`,
      createdAt: project.createdAt || null,
      updatedAt: project.updatedAt || null,
    };
  });
  const manifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    projects,
    includes: ['project data', 'images', 'audio', 'video', 'history'],
    excludes: ['API keys', 'account sessions', 'global application settings'],
  };
  writeJsonAtomic(manifestFile, manifest);

  try {
    const entries = [{ name: `${PACKAGE_ROOT}/manifest.json`, path: manifestFile, bytes: fs.statSync(manifestFile).size }];
    for (const project of projects) {
      entries.push(...listProjectFiles(
        projectDir(project.id),
        `${PACKAGE_ROOT}/${project.folder}`,
      ));
    }
    validateZipPlan(entries);
    return {
      filename: projectPackageFilename(projects),
      projects,
      entries,
      cleanup() {
        try { fs.rmSync(manifestFile, { force: true }); } catch { /* ignore */ }
      },
    };
  } catch (error) {
    try { fs.rmSync(manifestFile, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

export async function exportProjectPackage(plan, output) {
  await streamZip(plan.entries, output);
  return { projects: plan.projects.length, entries: plan.entries.length };
}

function readPackageManifest(workspace) {
  const manifestFile = path.join(workspace, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('项目包缺少 manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
  catch { throw new Error('项目包清单已损坏'); }
  if (manifest?.format !== PACKAGE_FORMAT) throw new Error('文件不是Freedom项目包');
  if (Number(manifest.version) !== PACKAGE_VERSION) {
    throw new Error(`项目包版本不受支持：${manifest.version ?? '未知'}`);
  }
  if (!Array.isArray(manifest.projects) || !manifest.projects.length) throw new Error('项目包中没有项目');
  if (manifest.projects.length > MAX_PACKAGE_PROJECTS) throw new Error('项目包中的项目数量过多');
  return manifest;
}

function readStagedProject(stagedDirectory, descriptor) {
  if (!fs.existsSync(stagedDirectory) || !fs.statSync(stagedDirectory).isDirectory()) {
    throw new Error(`项目包缺少项目目录：${descriptor.name || descriptor.id || '未知项目'}`);
  }
  const metaFile = path.join(stagedDirectory, 'meta.json');
  const legacyFile = path.join(stagedDirectory, 'project.json');
  let project;
  let metadataFile;
  try {
    metadataFile = fs.existsSync(metaFile) ? metaFile : legacyFile;
    project = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  } catch {
    throw new Error(`项目数据已损坏：${descriptor.name || descriptor.id || '未知项目'}`);
  }
  const descriptorId = String(descriptor.id || '').trim();
  if (!project?.id || !descriptorId || String(project.id) !== descriptorId) {
    throw new Error(`项目清单与项目数据不一致：${descriptor.name || descriptorId || '未知项目'}`);
  }
  return { project, metadataFile };
}

function validatedStagedProjects(workspace, manifest) {
  const folders = new Set();
  return manifest.projects.map((descriptor) => {
    const folder = normalizeArchivePath(descriptor?.folder);
    if (!/^projects\/project-\d{4}$/.test(folder) || folders.has(folder)) {
      throw new Error('项目包包含无效或重复的项目目录');
    }
    folders.add(folder);
    const stagedDirectory = path.resolve(workspace, ...folder.split('/'));
    const workspacePrefix = `${path.resolve(workspace)}${path.sep}`;
    if (!stagedDirectory.startsWith(workspacePrefix)) throw new Error('项目包目录越界');
    const { project, metadataFile } = readStagedProject(stagedDirectory, descriptor);
    return { descriptor, project, metadataFile, stagedDirectory };
  });
}

function rewriteStagedProjectIdentity(item, projectId) {
  const updatedAt = new Date().toISOString();
  writeJsonAtomic(item.metadataFile, {
    ...item.project,
    id: projectId,
    name: projectId,
    archivedAt: null,
    updatedAt,
  });
  const legacyFile = path.join(item.stagedDirectory, 'project.json');
  if (item.metadataFile !== legacyFile && fs.existsSync(legacyFile)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      writeJsonAtomic(legacyFile, { ...legacy, id: projectId, name: projectId, archivedAt: null, updatedAt });
    } catch { /* split storage remains authoritative */ }
  }
}

function rebindImportedProjectReferences(value, { sourceId, sourceName, targetId }, key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => rebindImportedProjectReferences(item, { sourceId, sourceName, targetId }));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      rebindImportedProjectReferences(childValue, { sourceId, sourceName, targetId }, childKey),
    ]));
  }
  if (typeof value !== 'string' || sourceId === targetId) return value;
  if (/projectId$/i.test(key) && value === sourceId) return targetId;
  if (/projectName$/i.test(key) && value === sourceName) return targetId;
  const sourceSegments = [...new Set([sourceId, encodeURIComponent(sourceId)])];
  let result = value;
  for (const sourceSegment of sourceSegments) {
    const targetSegment = sourceSegment === sourceId ? targetId : encodeURIComponent(targetId);
    result = result.split(`/${sourceSegment}/`).join(`/${targetSegment}/`);
  }
  return result;
}

function importedProjectId(sourceProject, reservedIds) {
  const base = sanitizeFilename(sourceProject.name || sourceProject.id, '导入项目');
  const isAvailable = (id) => !reservedIds.has(id) && !projectExists(id);
  if (isAvailable(base)) return base;
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? '（导入）' : `（导入 ${index}）`;
    const prefix = base.slice(0, Math.max(1, 80 - suffix.length));
    const candidate = `${prefix}${suffix}`;
    if (isAvailable(candidate)) return candidate;
  }
  throw new Error(`无法为导入项目生成可用名称：${base}`);
}

export async function importProjectPackage(zipFile) {
  const workspace = createTempDir('yanzhi-project-import-');
  const importedDirectories = [];
  try {
    const extracted = await extractZipToDirectory(zipFile, workspace, { prefix: PACKAGE_ROOT });
    if (!extracted) throw new Error('项目包中没有可导入的文件');
    const manifest = readPackageManifest(workspace);
    const stagedProjects = validatedStagedProjects(workspace, manifest);
    const reservedIds = new Set();
    const imports = stagedProjects.map((item) => {
      const projectId = importedProjectId(item.project, reservedIds);
      reservedIds.add(projectId);
      return { ...item, projectId };
    });

    const imported = [];
    for (const item of imports) {
      const destination = projectDir(item.projectId);
      if (fs.existsSync(destination)) throw new Error(`导入目标已存在：${item.projectId}`);
      rewriteStagedProjectIdentity(item, item.projectId);
      moveDirectory(item.stagedDirectory, destination);
      importedDirectories.push(destination);

      const project = loadProject(item.projectId);
      if (!project) throw new Error(`无法读取导入项目：${item.projectId}`);
      const sourceId = String(item.project.id);
      const sourceName = String(item.project.name || sourceId);
      const now = new Date().toISOString();
      const reboundProject = rebindImportedProjectReferences(project, {
        sourceId,
        sourceName,
        targetId: item.projectId,
      });
      reboundProject.id = item.projectId;
      reboundProject.name = item.projectId;
      reboundProject.archivedAt = null;
      reboundProject.importedAt = now;
      reboundProject.importSourceId = sourceId;
      reboundProject.updatedAt = now;
      saveProject(reboundProject);
      imported.push({
        sourceId,
        sourceName,
        projectId: reboundProject.id,
        name: reboundProject.name,
        renamed: reboundProject.id !== sourceId || reboundProject.name !== sourceName,
      });
    }
    return { imported, extracted };
  } catch (error) {
    for (const directory of importedDirectories.reverse()) {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* rollback best effort */ }
    }
    throw error;
  } finally {
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function createProjectPackageUploadPath() {
  const directory = ensureDir(path.join(USER_APP_DIR, 'temp'));
  return path.join(directory, `project-package-upload-${process.pid}-${Date.now()}.zip`);
}
