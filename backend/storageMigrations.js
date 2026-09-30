export const CURRENT_PROJECT_SCHEMA_VERSION = 6;

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function migrateV1ToV2(project) {
  project.elements = ensureObject(project.elements, {});
  for (const category of ['character', 'group', 'scene', 'prop', 'effect']) {
    project.elements[category] = ensureArray(project.elements[category]);
  }
  project.script = ensureObject(project.script, {});
  project.script.chapters = ensureArray(project.script.chapters);
  project.script.episodes = ensureArray(project.script.episodes);
  project.script.storyboards = ensureArray(project.script.storyboards);
  project.storageVersion = 2;
  project.schemaVersion = 2;
}

function migrateV2ToV3(project) {
  project.storageVersion = 3;
  project.schemaVersion = 3;
}

function migrateV3ToV4(project) {
  project.storageVersion = 4;
  project.schemaVersion = 4;
}

function migrateV4ToV5(project) {
  project.elements = ensureObject(project.elements, {});
  project.elements.group = ensureArray(project.elements.group);
  project.storageVersion = 5;
  project.schemaVersion = 5;
}

function migrateV5ToV6(project) {
  project.elements = ensureObject(project.elements, {});
  project.elements.creature = ensureArray(project.elements.creature);
  project.storageVersion = 6;
  project.schemaVersion = 6;
}

export function migrateProjectSchema(input = {}) {
  const project = input;
  const fromVersion = Math.max(1, Number(project.schemaVersion || project.storageVersion) || 1);
  let version = fromVersion;
  if (version < 2) {
    migrateV1ToV2(project);
    version = 2;
  }
  if (version < 3) {
    migrateV2ToV3(project);
    version = 3;
  }
  if (version < 4) {
    migrateV3ToV4(project);
    version = 4;
  }
  if (version < 5) {
    migrateV4ToV5(project);
    version = 5;
  }
  if (version < 6) {
    migrateV5ToV6(project);
    version = 6;
  }
  project.storageVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  project.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  return {
    project,
    fromVersion,
    toVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    changed: fromVersion !== CURRENT_PROJECT_SCHEMA_VERSION,
  };
}
