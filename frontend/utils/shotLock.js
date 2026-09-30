export const SHOT_LOCK_SNAPSHOT_VERSION = 1;

function cloneJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function cloneShotLockTags(tags = []) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => tag && typeof tag === 'object' && tag.cat && tag.name)
    .map((tag) => cloneJson(tag, {}));
}

export function createShotLockSnapshot({ shot = {}, tags = [] } = {}) {
  return {
    version: SHOT_LOCK_SNAPSHOT_VERSION,
    shotNo: String(shot?.no ?? ''),
    tags: cloneShotLockTags(tags),
    lockedAt: new Date().toISOString(),
  };
}

export function cloneShotLockSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return cloneJson(snapshot, null);
}

export function isValidShotLockSnapshot(snapshot) {
  return Boolean(
    snapshot
    && typeof snapshot === 'object'
    && Array.isArray(snapshot.tags),
  );
}
