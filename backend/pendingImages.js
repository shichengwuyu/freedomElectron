import { getRecord, listRecords, mutate } from './pendingImagesStore.js';

function pendingImageKey(projectId, category, imageName) {
  return [projectId, category, imageName].map((value) => String(value || '').trim()).join('\u001f');
}

export function getPendingImage(projectId, category, imageName) {
  return getRecord(pendingImageKey(projectId, category, imageName));
}

export function listPendingImages() {
  return listRecords();
}

export function setPendingImage(record) {
  if (!record?.projectId || !record?.category || !record?.imageName || !record?.sourceUrl) return null;
  const key = pendingImageKey(record.projectId, record.category, record.imageName);
  const now = new Date().toISOString();
  let saved = null;
  mutate((records) => {
    records[key] = {
      ...records[key],
      ...record,
      createdAt: records[key]?.createdAt || now,
      updatedAt: now,
    };
    saved = records[key];
    return true;
  });
  return saved;
}

export function removePendingImage(projectId, category, imageName) {
  const key = pendingImageKey(projectId, category, imageName);
  return mutate((records) => {
    if (!records[key]) return false;
    delete records[key];
    return true;
  });
}

export function recordPendingGeneratedImage(projectId, category, imageName, error, extra = {}) {
  if (!error?.sourceUrl) return null;
  return setPendingImage({
    projectId,
    category,
    imageName,
    sourceUrl: error.sourceUrl,
    error: error.message || '',
    ...extra,
  });
}

export function renamePendingImage(projectId, category, oldImageName, newImageName) {
  if (!oldImageName || !newImageName || oldImageName === newImageName) return false;
  const oldKey = pendingImageKey(projectId, category, oldImageName);
  const newKey = pendingImageKey(projectId, category, newImageName);
  return mutate((records) => {
    const record = records[oldKey];
    if (!record) return false;
    delete records[oldKey];
    records[newKey] = {
      ...record,
      imageName: newImageName,
      updatedAt: new Date().toISOString(),
    };
    return true;
  });
}

export function renamePendingProject(previousProjectId, nextProjectId) {
  const previous = String(previousProjectId || '').trim();
  const next = String(nextProjectId || '').trim();
  if (!previous || !next || previous === next) return 0;
  let changed = 0;
  const mutated = mutate((records) => {
    const matching = Object.values(records).filter((record) => record?.projectId === previous);
    if (!matching.length) return false;
    changed = matching.length;
    for (const record of matching) {
      const oldKey = pendingImageKey(previous, record.category, record.imageName);
      const nextKey = pendingImageKey(next, record.category, record.imageName);
      delete records[oldKey];
      records[nextKey] = { ...record, projectId: next, updatedAt: new Date().toISOString() };
    }
    return true;
  });
  return mutated === false ? 0 : changed;
}

export function swapPendingImages(projectId, category, leftImageName, rightImageName) {
  if (!leftImageName || !rightImageName || leftImageName === rightImageName) return false;
  const leftKey = pendingImageKey(projectId, category, leftImageName);
  const rightKey = pendingImageKey(projectId, category, rightImageName);
  return mutate((records) => {
    const left = records[leftKey];
    const right = records[rightKey];
    if (!left && !right) return false;
    const updatedAt = new Date().toISOString();
    if (right) {
      records[leftKey] = { ...right, imageName: leftImageName, updatedAt };
    } else {
      delete records[leftKey];
    }
    if (left) {
      records[rightKey] = { ...left, imageName: rightImageName, updatedAt };
    } else {
      delete records[rightKey];
    }
    return true;
  });
}
