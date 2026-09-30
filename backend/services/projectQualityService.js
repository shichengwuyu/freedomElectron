import fs from 'fs';

import { parseStoryboardShotsForRecovery, reconcileShotVideos } from '../shotVideoUtils.js';
import {
  imageDiskPath,
  loadProject,
  normalizeProjectScript,
  projectStorageStatus,
  saveProject,
  videoDiskPath,
} from '../storage.js';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

function issueId(parts) {
  return parts.map((part) => String(part ?? '').replace(/[^a-zA-Z0-9_-]+/g, '-')).join(':');
}

function pushIssue(issues, issue) {
  issues.push({
    id: issue.id || issueId([issue.category, issue.code, issue.episodeId, issue.shotNo, issue.elementName]),
    severity: ['error', 'warning', 'info'].includes(issue.severity) ? issue.severity : 'warning',
    category: issue.category || 'project',
    code: issue.code || 'unknown',
    title: issue.title || issue.code || 'Quality issue',
    message: issue.message || '',
    episodeId: issue.episodeId ?? '',
    shotNo: issue.shotNo ?? '',
    elementCategory: issue.elementCategory || '',
    elementName: issue.elementName || '',
    action: issue.action || '',
  });
}

function normalizeDuration(value, fallback = 0) {
  const raw = String(value ?? '').trim().replace(/s$/i, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function elementPrompt(item = {}) {
  return String(item.prompt || item.imagePrompt || item.fullPrompt || item.description || item.appearance || '').trim();
}

export function analyzeProjectQuality(project, dependencies = {}) {
  const projectId = project?.id || '';
  const exists = dependencies.fileExists || fs.existsSync;
  const storage = dependencies.storageStatus || { consistent: true, storageVersion: project?.storageVersion || 1, schemaVersion: project?.schemaVersion || 1, issues: [] };
  const issues = [];

  if (!storage.consistent) {
    for (const message of storage.issues || ['Storage files are inconsistent']) {
      pushIssue(issues, { severity: 'error', category: 'storage', code: 'storage-inconsistent', title: 'Storage transaction is inconsistent', message, action: 'repair-storage' });
    }
  } else if (storage.legacy || Number(storage.schemaVersion) < 3) {
    pushIssue(issues, { severity: 'warning', category: 'storage', code: 'storage-version-old', title: 'Project storage needs upgrading', message: `Current schema version: ${storage.schemaVersion || 1}`, action: 'upgrade-storage' });
  }

  const script = project?.script || {};
  const chapters = Array.isArray(script.chapters) ? script.chapters : [];
  const episodes = Array.isArray(script.episodes) ? script.episodes : [];
  const storyboards = Array.isArray(script.storyboards) ? script.storyboards : [];

  if (!chapters.length) pushIssue(issues, { severity: 'warning', category: 'script', code: 'no-chapters', title: 'No source chapters', message: 'Import source text before adaptation.' });
  const referencedChapterIds = new Set();
  for (const episode of episodes) {
    if (episode.chapterId != null) referencedChapterIds.add(String(episode.chapterId));
    for (const range of episode.sourceRanges || []) if (range?.chapterId != null) referencedChapterIds.add(String(range.chapterId));
  }
  for (const chapter of chapters) {
    if (!String(chapter.sourceText || '').trim()) {
      pushIssue(issues, { severity: 'warning', category: 'script', code: 'chapter-empty', title: 'Source chapter is empty', message: chapter.title || `Chapter ${chapter.id}` });
    }
    if (episodes.length && !referencedChapterIds.has(String(chapter.id))) {
      pushIssue(issues, { severity: 'warning', category: 'script', code: 'chapter-uncovered', title: 'Chapter is not covered by any episode', message: chapter.title || `Chapter ${chapter.id}` });
    }
  }

  if (!episodes.length) pushIssue(issues, { severity: 'warning', category: 'script', code: 'no-episodes', title: 'No episode plan', message: 'Split chapters or run whole-novel adaptation.' });
  const storyboardByEpisode = new Map(storyboards.map((item) => [String(item.episodeId), item]));
  for (const episode of episodes) {
    const episodeId = episode.id;
    if (!String(episode.content || '').trim()) {
      pushIssue(issues, { severity: 'error', category: 'script', code: 'episode-script-missing', title: 'Episode script is missing', message: episode.title || `Episode ${episodeId}`, episodeId, action: 'open-script' });
    }
    const storyboard = storyboardByEpisode.get(String(episodeId));
    if (!storyboard || !String(storyboard.content || '').trim()) {
      pushIssue(issues, { severity: 'error', category: 'storyboard', code: 'storyboard-missing', title: 'Storyboard is missing', message: episode.title || `Episode ${episodeId}`, episodeId, action: 'open-storyboard' });
      continue;
    }
    const shots = parseStoryboardShotsForRecovery(storyboard.content || '');
    if (!shots.length) {
      pushIssue(issues, { severity: 'error', category: 'storyboard', code: 'shot-parse-empty', title: 'No shots could be parsed', message: 'Check storyboard markers.', episodeId, action: 'open-storyboard' });
      continue;
    }
    for (const shot of shots) {
      const shotNo = String(shot.no);
      const duration = normalizeDuration(storyboard.timelineMeta?.[shotNo]?.duration, 5);
      if (duration < 1 || duration > 30) {
        pushIssue(issues, { severity: 'warning', category: 'storyboard', code: 'shot-duration-abnormal', title: 'Shot duration looks abnormal', message: `${duration}s`, episodeId, shotNo, action: 'open-shot' });
      }
      const videoFile = videoDiskPath(projectId, episodeId, shotNo);
      if (!exists(videoFile)) pushIssue(issues, { severity: 'warning', category: 'video', code: 'shot-video-missing', title: 'Shot video is missing', message: `Episode ${episodeId}, shot ${shotNo}`, episodeId, shotNo, action: 'open-shot' });
      if (storyboard.shotVideos?.[shotNo]?.videoUrl && !exists(videoFile)) {
        pushIssue(issues, { severity: 'error', category: 'video', code: 'video-metadata-stale', title: 'Video metadata points to a missing file', message: 'Run video metadata repair.', episodeId, shotNo, action: 'sync-shot-videos' });
      }
      const body = String(shot.body || '');
      for (const category of ['character', 'group', 'scene', 'prop', 'effect', 'creature']) {
        for (const element of project.elements?.[category] || []) {
          const name = String(element?.name || '').trim();
          if (!name || !body.includes(name)) continue;
          if (!exists(imageDiskPath(projectId, category, name))) {
            pushIssue(issues, { severity: 'warning', category: 'asset', code: 'bound-asset-image-missing', title: 'A referenced asset has no image', message: name, episodeId, shotNo, elementCategory: category, elementName: name, action: 'open-element' });
          }
        }
      }
    }
  }

  for (const category of ['character', 'group', 'scene', 'prop', 'effect', 'creature']) {
    const seen = new Set();
    for (const element of project?.elements?.[category] || []) {
      const name = String(element?.name || '').trim();
      if (!name) {
        pushIssue(issues, { severity: 'error', category: 'asset', code: 'asset-name-empty', title: 'Asset name is empty', elementCategory: category, action: 'open-element' });
        continue;
      }
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) pushIssue(issues, { severity: 'error', category: 'asset', code: 'asset-name-duplicate', title: 'Duplicate asset name', message: name, elementCategory: category, elementName: name, action: 'open-element' });
      seen.add(key);
      if (!elementPrompt(element)) pushIssue(issues, { severity: 'warning', category: 'asset', code: 'asset-prompt-empty', title: 'Asset prompt is empty', message: name, elementCategory: category, elementName: name, action: 'open-element' });
      if (!exists(imageDiskPath(projectId, category, name))) pushIssue(issues, { severity: 'info', category: 'asset', code: 'asset-image-missing', title: 'Asset image has not been generated', message: name, elementCategory: category, elementName: name, action: 'open-element' });
    }
  }

  issues.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.category.localeCompare(b.category));
  const summary = {
    total: issues.length,
    error: issues.filter((issue) => issue.severity === 'error').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
    chapters: chapters.length,
    episodes: episodes.length,
    storyboards: storyboards.length,
    assets: ['character', 'group', 'scene', 'prop', 'effect', 'creature'].reduce((sum, category) => sum + (project?.elements?.[category] || []).length, 0),
  };
  return { projectId, generatedAt: new Date().toISOString(), summary, storage, issues };
}

export function buildProjectQualityReport(projectId) {
  const project = loadProject(projectId);
  if (!project) throw new Error('Project not found');
  normalizeProjectScript(project);
  return analyzeProjectQuality(project, { storageStatus: projectStorageStatus(projectId) });
}

export function fixProjectQualityIssue(projectId, action) {
  const project = loadProject(projectId);
  if (!project) throw new Error('Project not found');
  normalizeProjectScript(project);
  if (action === 'sync-shot-videos') {
    project.script.storyboards = (project.script.storyboards || []).map((storyboard) => reconcileShotVideos(projectId, storyboard));
  } else if (action === 'upgrade-storage' || action === 'repair-storage') {
    // Loading and saving goes through the migration and transaction layer.
  } else {
    throw new Error('Unsupported quality fix action');
  }
  project.updatedAt = new Date().toISOString();
  saveProject(project);
  return buildProjectQualityReport(projectId);
}
