const VIDEO_EXTENSION_RE = /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i;
const VIDEO_URL_HINT_RE = /(?:mime_type=video|\/video\/|video_|video-|download|media|output|result)/i;
const IMAGE_HINT_RE = /(?:^|[._-])(?:image|images|cover|poster|thumb|thumbnail|avatar|icon)(?:$|[._-])/i;
const AUDIO_HINT_RE = /(?:^|[._-])(?:audio|audios|voice|music|sound)(?:$|[._-])/i;
const INPUT_REFERENCE_RE = /(?:^|[._-])(?:reference|references|ref_image|ref_images|ref_video|ref_videos|image_ref|image_refs|video_ref|video_refs|input_image|input_images|input_video|input_videos|prompt)(?:$|[._-])/i;

function candidateScore(fieldPath, url) {
  let score = 0;
  if (VIDEO_EXTENSION_RE.test(url)) score += 100;
  if (/(?:^|[._-])(?:origin|original|master|source|raw)(?:$|[._-])/.test(fieldPath)) score += 500;
  if (/(?:^|[._-])download(?:$|[._-])/.test(fieldPath)) score += 400;
  if (/(?:^|[._-])(?:high|highest|hd|uhd|full)(?:$|[._-])/.test(fieldPath)) score += 250;
  if (/(?:^|[._-])(?:result|output|generated|item_list)(?:$|[._-])/.test(fieldPath)) score += 100;
  if (/(?:^|[._-])video(?:$|[._-])/.test(fieldPath)) score += 40;
  if (/(?:^|[._-])(?:play|preview|proxy|transcod|low|thumbnail)(?:$|[._-])/.test(fieldPath)) score -= 300;
  if (/(?:origin|original|master|source|download|uhd|4k|2k|1080)/i.test(url)) score += 80;
  if (/(?:preview|proxy|transcod|360p|low)/i.test(url)) score -= 80;
  return score;
}

function isVideoCandidate(url, fieldPath, includeGenericUrl) {
  if (!/^https?:\/\//i.test(url) || /^blob:/i.test(url)) return false;
  if (IMAGE_HINT_RE.test(fieldPath) || AUDIO_HINT_RE.test(fieldPath) || INPUT_REFERENCE_RE.test(fieldPath)) return false;
  if (/(?:mime_type=audio|\.(?:png|jpe?g|webp|gif|mp3|m4a|wav|aac|flac)(?:[?#]|$))/i.test(url)) return false;
  if (VIDEO_EXTENSION_RE.test(url) || VIDEO_URL_HINT_RE.test(url) || /video|download|play|origin|source|transcod/i.test(fieldPath)) return true;
  return includeGenericUrl && /(?:^|[._-])(?:url|uri|link|href)(?:$|[._-])/.test(fieldPath);
}

export function collectVideoCandidates(value, { includeGenericUrl = false, maxCandidates = 24 } = {}) {
  const found = new Map();
  const seen = new Set();
  const visit = (item, pathParts = [], depth = 0) => {
    if (item == null || depth > 14) return;
    if (typeof item === 'string') {
      const url = item.trim();
      const fieldPath = pathParts.join('.').toLowerCase();
      if (!isVideoCandidate(url, fieldPath, includeGenericUrl)) return;
      const candidate = { url, score: candidateScore(fieldPath, url), fieldPath };
      const previous = found.get(url);
      if (!previous || candidate.score > previous.score) found.set(url, candidate);
      return;
    }
    if (typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, [...pathParts, String(index)], depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(item)) visit(child, [...pathParts, key], depth + 1);
  };
  visit(value);
  return [...found.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Number(maxCandidates) || 24));
}

export function candidateVideoUrls(value, options = {}) {
  return collectVideoCandidates(value, options).map((candidate) => candidate.url);
}
