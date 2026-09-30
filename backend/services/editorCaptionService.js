import { parseStoryboardShotsForRecovery } from '../shotVideoUtils.js';

export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const mmm = String(ms % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${mmm}`;
}

export function dialogueFromShotBody(body = '') {
  const values = [];
  const seen = new Set();
  const add = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 240 || seen.has(text)) return;
    seen.add(text);
    values.push(text);
  };
  for (const line of String(body).split(/\r?\n/)) {
    const match = line.match(/(?:台词|对白|旁白|画外音|内心独白|OS)\s*[:：]\s*(.+)$/i);
    if (match) add(match[1]);
  }
  for (const match of String(body).matchAll(/[“"]([^”"\n]{2,160})[”"]/g)) add(match[1]);
  return values.slice(0, 5);
}

export function buildAutoSrt(storyboard, clips, durations = []) {
  const shots = parseStoryboardShotsForRecovery(storyboard?.content || '');
  const byNo = new Map(shots.map((shot) => [String(shot.no), shot]));
  const blocks = [];
  let cursor = 0;
  clips.forEach((clip, index) => {
    const duration = Math.max(0.2, Number(durations[index]) || 5);
    const dialogue = dialogueFromShotBody(byNo.get(String(clip.shotNo))?.body || '');
    if (dialogue.length) {
      blocks.push(`${blocks.length + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + duration)}\n${dialogue.join('\n')}\n`);
    }
    cursor += duration;
  });
  return blocks.join('\n');
}

export function buildTimelineCaptionClips(storyboard, videoClips = [], assets = {}) {
  const shots = parseStoryboardShotsForRecovery(storyboard?.content || '');
  const byNo = new Map(shots.map((shot) => [String(shot.no), shot]));
  return videoClips.map((clip, index) => {
    const asset = assets[clip.assetId];
    const dialogue = dialogueFromShotBody(byNo.get(String(asset?.shotNo || ''))?.body || '');
    if (!dialogue.length) return null;
    return {
      clipId: `caption:${clip.clipId}:${index + 1}`,
      trackId: 'S1',
      type: 'caption',
      assetId: '',
      name: `字幕 ${asset?.shotNo || index + 1}`,
      timelineStart: clip.timelineStart,
      sourceIn: 0,
      duration: clip.duration,
      speed: 1,
      enabled: true,
      locked: false,
      linkedGroupId: clip.linkedGroupId,
      text: dialogue.join('\n'),
      styleId: 'default',
      transitionIn: 0,
      transitionOut: 0,
      keyframes: [],
    };
  }).filter(Boolean);
}

export function buildTimelineSrt(timeline = {}) {
  const captions = (timeline.tracks || [])
    .filter((track) => track.type === 'caption' && track.visible !== false && track.muted !== true)
    .flatMap((track) => track.clips || [])
    .filter((clip) => clip.enabled !== false && String(clip.text || '').trim())
    .sort((a, b) => Number(a.timelineStart || 0) - Number(b.timelineStart || 0));
  return captions.map((clip, index) => {
    const start = Math.max(0, Number(clip.timelineStart) || 0);
    const end = start + Math.max(0.1, Number(clip.duration) || 0.1);
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${String(clip.text).trim()}\n`;
  }).join('\n');
}