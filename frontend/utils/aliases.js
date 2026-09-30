export function splitAliasValues(value) {
  const out = [];
  const push = (item) => {
    if (!item) return;
    if (Array.isArray(item)) {
      for (const part of item) push(part);
      return;
    }
    if (typeof item === 'object') return;
    for (const part of String(item || '').split(/[、,，;；/／|｜\n\r\t]+/)) {
      const alias = part
        .replace(/^(?:别名|代称|称呼|昵称|尊称|称号|aliases?|alias)\s*[：:]/i, '')
        .trim();
      if (alias) out.push(alias.slice(0, 40));
    }
  };
  push(value);
  return out;
}

export function aliasKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’`·•,，.。!！?？:：;；、()[\]{}<>《》【】\\/|｜\-—_+=*#~^$@%&]/g, '');
}

export function normalizeAliasList(values, canonicalName = '', minLength = 1) {
  const out = [];
  const seen = new Set();
  const nameKey = aliasKey(canonicalName);
  for (const raw of splitAliasValues(values)) {
    const alias = String(raw || '').trim();
    const key = aliasKey(alias);
    if (!alias || !key || key === nameKey || alias.length < minLength || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= 80) break;
  }
  return out;
}

export function normalizeCharacterAliasState(element) {
  if (!element) return [];
  const rawAliases = typeof element.aliasesText === 'string'
    ? element.aliasesText
    : [element.aliases, element.source?.aliases];
  const aliases = normalizeAliasList(rawAliases, element.name);
  element.aliases = aliases;
  element.aliasesText = aliases.join(',');
  if (element.source && typeof element.source === 'object') element.source.aliases = aliases;
  return aliases;
}

export function elementAliasList(element) {
  return normalizeAliasList([
    element?.alias,
    element?.aliasesText,
    element?.aliases,
    element?.source?.aliases,
  ], element?.name, 2);
}
