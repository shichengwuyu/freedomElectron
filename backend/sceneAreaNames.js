function plainAreaName(value) {
  return String(value || '').trim().slice(0, 80);
}

function compactAreaName(value) {
  return plainAreaName(value)
    .toLocaleLowerCase()
    .replace(/[\s"'“”‘’`·•,，.。!！?？:：;；、()[\]{}<>《》【】\\/|｜\-—_+=*#~^$@%&]/g, '');
}

// 常见机位名称容易被模型写成不同同义词。这里仅归一化明确等价的座位称呼，
// 避免把“入口/门口”这类可能代表不同空间的名称过度合并。
export function sceneAreaNameKey(value) {
  const key = compactAreaName(value);
  if (!key) return '';
  if (/^(?:车内|汽车内|轿车内)?(?:主驾驶|主驾|驾驶员|驾驶|司机)(?:位置|座位|座椅|座|位)$/.test(key)
    || /^(?:车内|汽车内|轿车内)?主驾$/.test(key)) {
    return '驾驶座位';
  }
  if (/^(?:车内|汽车内|轿车内)?(?:副驾驶|副驾)(?:位置|座位|座椅|座|位)?$/.test(key)) {
    return '副驾驶座位';
  }
  if (/^(?:车内|汽车内|轿车内)?(?:后排|后座)(?:区域|位置|座位|座椅|座)?$/.test(key)) {
    return '后排座位';
  }
  return key;
}

export function sameSceneAreaName(left, right) {
  const leftKey = sceneAreaNameKey(left);
  return !!leftKey && leftKey === sceneAreaNameKey(right);
}

export function normalizeSceneAreaRecords(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const byKey = new Map();
  for (const raw of value) {
    if (!raw) continue;
    const name = plainAreaName(typeof raw === 'string' ? raw : raw.name);
    const key = sceneAreaNameKey(name);
    if (!name || !key) continue;
    const desc = String((typeof raw === 'string' ? '' : raw.desc) || '').trim();
    const found = byKey.get(key);
    if (found) {
      if (desc.length > found.desc.length) found.desc = desc;
      continue;
    }
    const area = { name, desc };
    byKey.set(key, area);
    out.push(area);
  }
  return out;
}
