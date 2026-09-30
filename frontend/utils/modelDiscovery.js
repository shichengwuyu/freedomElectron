export function normalizeDiscoveredModelNames(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function discoveredModelOptions(...sources) {
  const values = [];
  for (const source of sources) {
    const list = Array.isArray(source) ? source : [];
    for (const item of list) values.push(typeof item === 'object' ? item?.value : item);
  }
  return normalizeDiscoveredModelNames(values).map((value) => ({ label: value, value }));
}
