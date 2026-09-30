import {
  createAppProjectExportRuntime,
  createExportShotCardsRuntime,
} from './scriptExport.js';

export function createAppExportRuntime({
  api,
  message,
  messageBox,
  refs = {},
  helpers = {},
  ref,
} = {}) {
  const projectExport = createAppProjectExportRuntime({
    api,
    message,
    messageBox,
    refs: {
      project: refs.project,
      category: refs.category,
      episodeId: refs.episodeId,
    },
    helpers: {
      nextTick: helpers.nextTick,
      navigate: helpers.navigate,
    },
    ref,
  });

  const exportShotCards = createExportShotCardsRuntime({
    api,
    message,
    refs: {
      exporting: projectExport.exportingShots,
      project: refs.project,
      selectedEpisode: refs.selectedEpisode,
      selectedStoryboard: refs.selectedStoryboard,
      episodeId: refs.episodeId,
    },
    helpers: { nextTick: helpers.nextTick },
  });

  return {
    ...projectExport,
    exportShotCards,
  };
}
