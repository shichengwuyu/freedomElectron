function shotNoFromFileName(fileName) {
  const stem = String(fileName || '').replace(/\.mp4$/i, '');
  return stem.split('.version-', 1)[0].trim();
}

function isVersionFile(fileName) {
  return String(fileName || '').includes('.version-');
}

function shouldReplace(current, candidate) {
  const currentVersion = isVersionFile(current.fileName);
  const candidateVersion = isVersionFile(candidate.fileName);
  if (candidateVersion !== currentVersion) return candidateVersion;
  if (!candidateVersion) return false;
  return candidate.fileName.localeCompare(current.fileName) > 0;
}

// 与 videoDiskPath 的选择规则保持一致：版本文件优先，多个版本取排序靠前的最新版本；
// 每个镜头只返回一个候选，避免导出目录出现多个同名覆盖和旧版本污染。
export function selectActiveVideoFiles(entries = []) {
  const selected = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const fileName = String(entry || '').trim();
    if (!fileName.toLowerCase().endsWith('.mp4')) continue;
    const shotNo = shotNoFromFileName(fileName);
    if (!shotNo) continue;
    const candidate = { shotNo, fileName };
    const current = selected.get(shotNo);
    if (!current || shouldReplace(current, candidate)) selected.set(shotNo, candidate);
  }
  return [...selected.values()].sort((a, b) => {
    const an = Number(a.shotNo);
    const bn = Number(b.shotNo);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    if (Number.isFinite(an) !== Number.isFinite(bn)) return Number.isFinite(an) ? -1 : 1;
    return a.shotNo.localeCompare(b.shotNo);
  });
}
