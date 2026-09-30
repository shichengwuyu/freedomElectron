function normalizeSearchText(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

const DESCRIPTION_FIELD_LABELS = {
  scene: '场景',
  character: '人物',
  group: '群像',
  prop: '道具',
  effect: '特效',
  creature: '妖兽',
};

const DESCRIPTION_FIELD_KEYS = {
  场景: 'scene',
  场景名称: 'scene',
  环境: 'scene',
  人物: 'character',
  出场人物: 'character',
  角色: 'character',
  群像: 'group',
  群体: 'group',
  道具: 'prop',
  关键道具: 'prop',
  特效: 'effect',
  视觉特效: 'effect',
  妖兽: 'creature',
  怪物: 'creature',
};

function parseDescriptionFieldLine(line) {
  const text = String(line ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(?:[-*]\s*)?(?:【\s*)?([^【】:\uff1a\s]{1,8})(?:\s*】)?\s*[:\uff1a]?\s*(.*?)\s*$/);
  if (!match) return null;
  const key = DESCRIPTION_FIELD_KEYS[match[1]];
  const value = String(match[2] || '').trim();
  if (!key || !value) return null;
  return { key, label: DESCRIPTION_FIELD_LABELS[key], value };
}

export function extractBindingOverviewDescription(shot) {
  const fields = new Map();
  const body = String(shot?.body || '').replace(/\r\n?/g, '\n');
  for (const line of body.split('\n')) {
    const parsed = parseDescriptionFieldLine(line);
    if (!parsed) continue;
    const values = fields.get(parsed.key) || [];
    if (!values.includes(parsed.value)) values.push(parsed.value);
    fields.set(parsed.key, values);
  }
  return ['scene', 'character', 'group', 'prop', 'effect', 'creature']
    .filter((key) => fields.has(key))
    .map((key) => ({
      key,
      label: DESCRIPTION_FIELD_LABELS[key],
      value: fields.get(key).join('；'),
    }));
}

export function createBindingOverviewEntry(shot, tags = [], audios = []) {
  const safeShot = shot && typeof shot === 'object' ? shot : {};
  const safeTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  const missingImageCount = safeTags.filter((tag) => !tag.hasImage).length;
  const status = !safeTags.length
    ? 'unbound'
    : (missingImageCount ? 'missing' : 'ready');
  const aiCount = safeTags.filter((tag) => tag.source === 'ai').length;
  const manualCount = safeTags.filter((tag) => tag.manual && tag.source !== 'ai').length;
  const automaticCount = safeTags.filter((tag) => !tag.manual).length;
  const searchText = normalizeSearchText([
    safeShot.no,
    safeShot.title,
    safeShot.body,
    ...safeTags.flatMap((tag) => [tag.name, tag.displayName, tag.alias, tag.assetLabel]),
  ].join(' '));

  return {
    shot: safeShot,
    tags: safeTags,
    audios: Array.isArray(audios) ? audios.filter(Boolean) : [],
    descriptionFields: extractBindingOverviewDescription(safeShot),
    status,
    missingImageCount,
    aiCount,
    manualCount,
    automaticCount,
    searchText,
  };
}

export function filterBindingOverviewEntries(entries = [], options = {}) {
  const filter = String(options.filter || 'all');
  const query = normalizeSearchText(options.query);
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (filter === 'issues' && entry.status === 'ready') return false;
    if (filter === 'unbound' && entry.status !== 'unbound') return false;
    if (filter === 'missing' && entry.status !== 'missing') return false;
    if (filter === 'ready' && entry.status !== 'ready') return false;
    return !query || entry.searchText.includes(query);
  });
}

export function summarizeBindingOverview(entries = []) {
  const summary = { total: 0, ready: 0, issues: 0, unbound: 0, missing: 0 };
  for (const entry of Array.isArray(entries) ? entries : []) {
    summary.total += 1;
    if (entry.status === 'ready') summary.ready += 1;
    if (entry.status === 'unbound') summary.unbound += 1;
    if (entry.status === 'missing') summary.missing += 1;
  }
  summary.issues = summary.unbound + summary.missing;
  return summary;
}
