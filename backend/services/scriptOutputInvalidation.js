import { clearPendingByProject } from '../pendingVideos.js';
import { deleteEpisodeMediaFiles } from '../videoFunctions.js';

function emptyCleanupSummary(episodeId) {
  return {
    episodeId,
    removedStoryboardCount: 0,
    clearedPendingCount: 0,
    removedMediaFileCount: 0,
    cleanupWarnings: [],
  };
}

function clearGeneratedScript(episode) {
  if (!episode || typeof episode !== 'object') return;
  episode.content = '';
  delete episode.continuityStateBefore;
  delete episode.continuityStateAfter;
  delete episode.finalReview;
  delete episode.sourceSignature;
}

export function invalidateEpisodeOutputs(project, episodeId, options = {}) {
  const summary = emptyCleanupSummary(episodeId);
  const script = project?.script;
  if (!project || !script || typeof script !== 'object') return summary;

  const key = String(episodeId);
  const storyboards = Array.isArray(script.storyboards) ? script.storyboards : [];
  const before = storyboards.length;
  script.storyboards = storyboards.filter((storyboard) => String(storyboard?.episodeId) !== key);
  summary.removedStoryboardCount = before - script.storyboards.length;

  if (options.clearScript === true) {
    const episode = (Array.isArray(script.episodes) ? script.episodes : [])
      .find((item) => String(item?.id) === key);
    clearGeneratedScript(episode);
  }

  const clearPending = options.clearPending || clearPendingByProject;
  try {
    summary.clearedPendingCount = Number(clearPending(project.id, episodeId)) || 0;
  } catch (error) {
    summary.cleanupWarnings.push(`清理第${episodeId}集待处理任务失败：${error?.message || error}`);
  }

  const deleteMedia = options.deleteMedia || deleteEpisodeMediaFiles;
  try {
    const media = deleteMedia(project.id, episodeId) || {};
    summary.removedMediaFileCount = Number(media.removedFiles) || 0;
    if (Array.isArray(media.errors)) summary.cleanupWarnings.push(...media.errors);
  } catch (error) {
    summary.cleanupWarnings.push(`清理第${episodeId}集媒体失败：${error?.message || error}`);
  }
  return summary;
}

export function invalidateEpisodesOutputs(project, episodeIds = [], options = {}) {
  const seen = new Set();
  const summaries = [];
  for (const episodeId of Array.isArray(episodeIds) ? episodeIds : []) {
    const key = String(episodeId);
    if (seen.has(key)) continue;
    seen.add(key);
    summaries.push(invalidateEpisodeOutputs(project, episodeId, options));
  }
  return summaries;
}
