import fs from 'fs';
import path from 'path';

import { TEMP_DIR } from '../config.js';
import { writeImagesWithNameLabels } from '../imageLabeler.js';
import { pathExists } from '../mediaServer.js';
import {
  CATEGORY_DIRS,
  MAIN_CATEGORIES,
  exportImagesFlat,
  imageDiskPath,
  loadProject,
  openFolderPath,
  openProjectFolder,
  pickFolder,
  projectExists,
  sanitizeFilename,
} from '../storage.js';
import { streamZip } from '../zip.js';

function wantsExportNameLabel(value) {
  return value === true || value === '1' || value === 'true';
}

export function buildElementExportImageSpecs(category, element, variantImageName) {
  const specs = [{ imageName: element.name, fileLabel: element.name, label: element.name }];
  if (category !== 'character') return specs;

  for (const outfit of element.outfits || []) {
    const imageName = `${element.name}_${outfit.name}`;
    specs.push({ imageName, fileLabel: imageName, label: imageName });
  }
  for (const variant of element.variants || []) {
    const imageName = variantImageName(element.name, variant.name);
    specs.push({ imageName, fileLabel: imageName, label: imageName });
  }
  return specs;
}

async function collectElementExportEntries(projectId, category, element, variantImageName) {
  const entries = [];
  const used = new Set();
  for (const spec of buildElementExportImageSpecs(category, element, variantImageName)) {
    const filePath = imageDiskPath(projectId, category, spec.imageName);
    if (!await pathExists(filePath)) continue;
    const safeBase = sanitizeFilename(spec.fileLabel, '未命名');
    let fileName = `${safeBase}.png`;
    let suffix = 2;
    while (used.has(fileName.toLowerCase())) {
      fileName = `${safeBase}_${suffix}.png`;
      suffix += 1;
    }
    used.add(fileName.toLowerCase());
    entries.push({ name: fileName, path: filePath, label: spec.label });
  }
  return entries;
}

async function collectZipEntries(projectId, proj, variantImageName, category = '') {
  const entries = [];
  const rootDir = sanitizeFilename(proj?.name || projectId, 'project');
  const usedByCategory = new Map();
  const exportCategories = MAIN_CATEGORIES.includes(category) ? [category] : MAIN_CATEGORIES;

  entries.push({ name: `${rootDir}/`, directory: true });
  for (const cat of exportCategories) {
    const catDir = CATEGORY_DIRS[cat] || cat;
    entries.push({ name: `${rootDir}/${catDir}/`, directory: true });
  }

  const addImageEntry = async (category, fileLabel, filePath, label = fileLabel) => {
    if (!await pathExists(filePath)) return;
    const catDir = CATEGORY_DIRS[category] || category;
    const used = usedByCategory.get(category) || new Set();
    usedByCategory.set(category, used);

    const safeBase = sanitizeFilename(fileLabel, '未命名');
    let fileName = `${safeBase}.png`;
    let suffix = 2;
    while (used.has(fileName.toLowerCase())) {
      fileName = `${safeBase}_${suffix}.png`;
      suffix += 1;
    }
    used.add(fileName.toLowerCase());
    entries.push({
      name: `${rootDir}/${catDir}/${fileName}`,
      path: filePath,
      label,
    });
  };

  for (const cat of exportCategories) {
    for (const el of proj.elements?.[cat] || []) {
      const file = imageDiskPath(projectId, cat, el.name);
      await addImageEntry(cat, el.name, file, el.name);
      if (cat === 'character' && Array.isArray(el.outfits)) {
        for (const outfit of el.outfits) {
          const imageName = `${el.name}_${outfit.name}`;
          const filePath = imageDiskPath(projectId, 'character', imageName);
          await addImageEntry('character', imageName, filePath, imageName);
        }
      }
      if (cat === 'character' && Array.isArray(el.variants)) {
        for (const variant of el.variants) {
          const imageName = variantImageName(el.name, variant.name);
          const filePath = imageDiskPath(projectId, 'character', imageName);
          await addImageEntry('character', imageName, filePath, imageName);
        }
      }
      if (cat === 'scene' && Array.isArray(el.areas)) {
        for (const area of el.areas) {
          const imageName = `${el.name}_${area.name}`;
          const filePath = imageDiskPath(projectId, 'scene', imageName);
          await addImageEntry('scene', imageName, filePath, imageName);
        }
      }
    }
  }
  return entries;
}

async function prepareZipEntries(entries, { addNameLabel = false } = {}) {
  if (!addNameLabel) return { entries, cleanup: null };
  const tempDir = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'novel-export-zip-'));
  const fileEntries = entries.filter((entry) => !entry.directory);
  const labeledItems = fileEntries.map((entry, index) => ({
    src: entry.path,
    dest: path.join(tempDir, `${String(index).padStart(5, '0')}.png`),
    label: entry.label || entry.name.replace(/\.png$/i, ''),
  }));
  await writeImagesWithNameLabels(labeledItems);
  let fileIndex = 0;
  return {
    entries: entries.map((entry) => {
      if (entry.directory) return entry;
      const labeled = labeledItems[fileIndex];
      fileIndex += 1;
      return { ...entry, path: labeled.dest };
    }),
    cleanup: () => fs.promises.rm(tempDir, { recursive: true, force: true }),
  };
}

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

export async function handleExportRoutes(ctx) {
  const { req, res, url, p, method, readBody, sendJson, variantImageName } = ctx;

  if (p === '/api/export/folder' && method === 'POST') {
    const body = await readBody(req);
    if (!body.projectId) return handled(sendJson, res, 400, { error: '缺少 projectId' });
    if (!projectExists(body.projectId)) return handled(sendJson, res, 404, { error: '项目不存在' });
    try {
      const dir = await openProjectFolder(body.projectId);
      return handled(sendJson, res, 200, { ok: true, dir });
    } catch (e) {
      return handled(sendJson, res, 500, { error: e.message });
    }
  }

  if (p === '/api/export/zip' && method === 'GET') {
    const projectId = url.searchParams.get('id');
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const category = String(url.searchParams.get('category') || '').trim();
    const entries = await collectZipEntries(projectId, proj, variantImageName, category);
    if (!entries.some((entry) => !entry.directory)) return handled(sendJson, res, 400, { error: '没有可导出的内容' });
    const prepared = await prepareZipEntries(entries, { addNameLabel: wantsExportNameLabel(url.searchParams.get('addNameLabel')) });
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(proj.name)}.zip"`,
    });
    try {
      await streamZip(prepared.entries, res);
    } finally {
      await prepared.cleanup?.();
    }
    return true;
  }

  if (p === '/api/export/to-folder' && method === 'POST') {
    const body = await readBody(req);
    const proj = loadProject(body.projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const target = pickFolder();
    if (!target) return handled(sendJson, res, 200, { ok: false, canceled: true });
    try {
      const { copied } = await exportImagesFlat(proj, target, {
        addNameLabel: wantsExportNameLabel(body.addNameLabel),
        category: String(body.category || '').trim(),
      });
      if (!copied) return handled(sendJson, res, 200, { ok: false, error: '没有已生成的图片可导出' });
      await openFolderPath(target);
      return handled(sendJson, res, 200, { ok: true, copied, target });
    } catch (e) {
      return handled(sendJson, res, 200, { ok: false, error: e.message });
    }
  }

  if (p === '/api/export/element' && method === 'GET') {
    const projectId = url.searchParams.get('projectId');
    const category = url.searchParams.get('category');
    const index = Number(url.searchParams.get('index'));
    const addNameLabel = wantsExportNameLabel(url.searchParams.get('addNameLabel'));
    const exportAllLooks = category === 'character' && url.searchParams.get('scope') === 'all';

    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });

    const el = proj.elements?.[category]?.[index];
    if (!el) return handled(sendJson, res, 404, { error: '元素不存在' });

    if (exportAllLooks) {
      const entries = await collectElementExportEntries(projectId, category, el, variantImageName);
      if (!entries.length) return handled(sendJson, res, 404, { error: '该人物还没有已生成的图片' });
      const prepared = await prepareZipEntries(entries, { addNameLabel });
      const filename = `${sanitizeFilename(el.name, '人物')}_全部形态.zip`;
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      });
      try {
        await streamZip(prepared.entries, res);
      } finally {
        await prepared.cleanup?.();
      }
      return true;
    }

    const file = imageDiskPath(projectId, category, el.name);
    if (!await pathExists(file)) return handled(sendJson, res, 404, { error: '该元素还没有生成图片' });

    try {
      let imagePath = file;
      let cleanup = null;

      if (addNameLabel) {
        const tempDir = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'novel-export-single-'));
        const labeledPath = path.join(tempDir, `${el.name}.png`);
        await writeImagesWithNameLabels([{
          src: file,
          dest: labeledPath,
          label: el.name,
        }]);
        imagePath = labeledPath;
        cleanup = () => fs.promises.rm(tempDir, { recursive: true, force: true });
      }

      const data = await fs.promises.readFile(imagePath);
      const filename = `${el.name}.png`;

      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': data.length,
      });
      res.end(data);

      if (cleanup) await cleanup();
    } catch (e) {
      return handled(sendJson, res, 500, { error: e.message });
    }
    return true;
  }

  return false;
}
