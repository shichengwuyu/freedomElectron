// Robustly extract JSON from LLM output, including fenced blocks, surrounding prose,
// BOMs, control characters inside strings, trailing commas, and balanced objects/arrays.
function repairJsonCandidate(text) {
  const source = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!source) return source;
  let repaired = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { repaired += char; escaped = false; continue; }
    if (char === '\\') { repaired += char; escaped = true; continue; }
    if (char === '"') { repaired += char; inString = !inString; continue; }
    if (inString) {
      if (char === '\n') { repaired += '\\n'; continue; }
      if (char === '\r') { repaired += '\\r'; continue; }
      if (char === '\t') { repaired += '\\t'; continue; }
      if (char < ' ') {
        repaired += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
    }
    repaired += char;
  }
  return repaired.replace(/,\s*([}\]])/g, '$1');
}

function tryParseJsonCandidate(text) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!cleaned) return undefined;
  const candidates = [cleaned];
  const repaired = repairJsonCandidate(cleaned);
  if (repaired !== cleaned) candidates.push(repaired);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string' && /^[\[{]/.test(parsed.trim())) {
        return tryParseJsonCandidate(parsed);
      }
      return parsed;
    } catch {
      // Try the next repaired candidate.
    }
  }
  return undefined;
}

function isJsonObjectCandidate(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canReturnJsonCandidate(value, options) {
  return !options.preferObject || isJsonObjectCandidate(value);
}

function extractBalancedJsonSliceAt(source, start) {
  const opening = source[start];
  if (opening !== '{' && opening !== '[') return null;
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (!stack.length || stack[stack.length - 1] !== char) return null;
      stack.pop();
      if (!stack.length) return source.slice(start, index + 1);
    }
  }
  return null;
}

function extractBalancedJsonSlice(text, options = {}) {
  const source = String(text || '');
  for (let start = 0; start < source.length; start += 1) {
    const opening = source[start];
    if (opening !== '{' && opening !== '[') continue;
    if (options.preferObject && opening !== '{') continue;
    const balanced = extractBalancedJsonSliceAt(source, start);
    if (balanced) return balanced;
  }
  return null;
}

/**
 * @param {string} text
 * @param {{preferObject?: boolean, emptyMessage?: string, invalidMessage?: string}} [options]
 * @returns {any}
 */
export function extractJsonObject(text, options = {}) {
  const source = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error(options.emptyMessage || 'Model returned no content');

  const candidates = new Set([source]);
  const fencedMatches = source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedMatches) {
    const block = String(match[1] || '').trim();
    if (block) candidates.add(block);
  }

  for (const candidate of candidates) {
    const direct = tryParseJsonCandidate(candidate);
    if (direct !== undefined && canReturnJsonCandidate(direct, options)) return direct;
    const balanced = extractBalancedJsonSlice(candidate, options);
    if (balanced) {
      const parsed = tryParseJsonCandidate(balanced);
      if (parsed !== undefined && canReturnJsonCandidate(parsed, options)) return parsed;
    }
  }

  if (options.invalidMessage) throw new Error(options.invalidMessage);
  const preview = source.replace(/\s+/g, ' ').slice(0, 240);
  throw new Error(`Model response is not parseable JSON: ${preview}${source.length > 240 ? '...' : ''}`);
}
