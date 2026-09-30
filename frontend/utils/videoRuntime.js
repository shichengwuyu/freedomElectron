import {
  createShotVideoPipelineRuntime,
  createVideoPipelineRuntime,
} from './videoConfig.js';
import {
  createShotStageWatchersRuntime,
  createTailFrameActionsRuntime,
  createTailFramePickerStateRuntime,
} from './shotUtils.js';
import { createSubtitleRemovalRuntime } from './video/subtitleRemoval.js';

export function createAppVideoRuntime({
  api,
  message,
  messageBox,
  refs = {},
  helpers = {},
  globals = {},
  reactive,
  computed,
  watch,
  ref,
} = {}) {
  const episodeVideoAction = ref('');
  const stoppedVideoTracking = new Set();
  const videoTrackingKey = (
    no,
    projectId = refs.project.value?.id,
    episodeId = refs.episodeId.value,
  ) => `${String(projectId || '')}:${String(episodeId)}:${String(no)}`;
  const markVideoTrackingStopped = (no, projectId, episodeId) => {
    stoppedVideoTracking.add(videoTrackingKey(no, projectId, episodeId));
  };
  const resumeVideoTracking = (no, projectId, episodeId) => {
    stoppedVideoTracking.delete(videoTrackingKey(no, projectId, episodeId));
  };
  const isVideoTrackingStopped = (no, projectId, episodeId) => (
    stoppedVideoTracking.has(videoTrackingKey(no, projectId, episodeId))
  );
  const shotVideoRuntime = createShotVideoPipelineRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      episodeId: refs.episodeId,
      shotVideos: refs.shotVideos,
      shotStatus: refs.shotStatus,
      shotProgress: refs.shotProgress,
      videoQueue: refs.videoQueue,
      currentShots: refs.currentShots,
      episodeVideoAction,
    },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
      revokeObjectUrl: globals.revokeObjectUrl,
      markTrackingStopped: markVideoTrackingStopped,
      resumeTracking: resumeVideoTracking,
    },
    globals: {
      createObjectURL: globals.createObjectURL,
      revokeObjectUrl: globals.revokeObjectUrl,
      setTimeout: globals.setTimeout,
      clearTimeout: globals.clearTimeout,
    },
  });

  const subtitleRemovalRuntime = createSubtitleRemovalRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      episodeId: refs.episodeId,
      shotVideos: refs.shotVideos,
      shotStatus: refs.shotStatus,
      shotProgress: refs.shotProgress,
    },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
      revokeObjectUrl: globals.revokeObjectUrl,
    },
    globals: {
      document: globals.document,
      setTimeout: globals.setTimeout,
    },
    reactive,
  });

  const {
    tailFramePickerVideo,
    tailFramePicker,
  } = createTailFramePickerStateRuntime({ ref, reactive });

  const tailFrameRuntime = createTailFrameActionsRuntime({
    api,
    message,
    messageBox,
    refs: {
      project: refs.project,
      episodeId: refs.episodeId,
      currentShots: refs.currentShots,
      picker: tailFramePicker,
      video: tailFramePickerVideo,
    },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
      shotVideoUrl: shotVideoRuntime.shotVideoUrl,
      nextTick: helpers.nextTick,
      autoTailFrameName: helpers.autoTailFrameName,
    },
    globals: { document: globals.document },
  });

  const videoPipeline = createVideoPipelineRuntime({
    api,
    message,
    refs: {
      config: refs.config,
      project: refs.project,
      episodeId: refs.episodeId,
      shotStatus: refs.shotStatus,
      shotVideos: refs.shotVideos,
      shotProgress: refs.shotProgress,
      videoQueue: refs.videoQueue,
    },
    helpers: {
      shotElementTags: helpers.shotElementTags,
      shotOpenerFrame: tailFrameRuntime.shotOpenerFrame,
      shotOpenerFrameName: tailFrameRuntime.shotOpenerFrameName,
      buildShotPromptBody: helpers.buildShotPromptBody,
      shotVideoKey: shotVideoRuntime.shotVideoKey,
      shotVideoUrl: shotVideoRuntime.shotVideoUrl,
      shotVideoStatus: shotVideoRuntime.shotVideoStatus,
      resetShotVideo: shotVideoRuntime.resetShotVideoForRegenerate,
      startPendingPoll: shotVideoRuntime.startPendingPoll,
      syncShotVideosFromServer: shotVideoRuntime.syncShotVideosFromServer,
      findStoryboard: helpers.findStoryboard,
      currentShots: () => refs.currentShots?.value || [],
      parseShots: helpers.parseShots,
      progressByRatio: helpers.progressByRatio,
      stopProgressPulse: helpers.stopProgressPulse,
      setProgressState: helpers.setProgressState,
      startProgressPulse: helpers.startProgressPulse,
      hideProgressAfter: helpers.hideProgressAfter,
      setShotOpenerFrame: tailFrameRuntime.setShotOpenerFrame,
      saveScript: helpers.saveScript,
      infoTip: helpers.infoTip,
      confirmDreaminaLogout: helpers.confirmDreaminaLogout,
      confirmLibtvLogout: helpers.confirmLibtvLogout,
      isShotTrackingStopped: isVideoTrackingStopped,
      resumeShotTracking: resumeVideoTracking,
    },
    globals: {
      setTimeout: globals.setTimeout,
      clearTimeout: globals.clearTimeout,
    },
    reactive,
    computed,
    watch,
    ref,
  });

  createShotStageWatchersRuntime({
    watch,
    refs: {
      scriptUi: refs.scriptUi,
      scriptState: refs.scriptState,
      episodeId: refs.episodeId,
    },
    helpers: {
      findEpisode: helpers.findEpisode,
      findStoryboard: helpers.findStoryboard,
      cancelShotEdit: helpers.cancelShotEdit,
      hydrateShotVideos: shotVideoRuntime.hydrateShotVideos,
      loadVideoBar: videoPipeline.loadVideoBar,
      hydratePending: shotVideoRuntime.hydratePending,
    },
  });

  // 把视频以 OS 级文件拖拽交给外部 App（剪映等）。dragstart 里必须先 preventDefault
  // 取消浏览器自带的 HTML5 拖拽：<video draggable> 的拖拽会话会和主进程的原生拖拽
  // (startDrag → OLE DoDragDrop) 同时存在、抢同一套 OLE 拖拽状态，拖若干次之后主进程
  // 的 startDrag 就不再返回，渲染进程被 sendSync 永久挂住——表现为拖八九次后整页点不动。
  // 只处理已生成的本地视频，URL 非 /video/ 或文件不存在时主进程会静默不触发。
  const startVideoFileDrag = (event, url) => {
    if (!url || typeof window === 'undefined' || !window.desktopPetHost?.startFileDrag) return;
    if (event?.cancelable) event.preventDefault();
    try {
      window.desktopPetHost.startFileDrag(url);
    } catch (error) {
      console.warn('视频拖拽到外部失败', error);
    }
  };

  return {
    ...shotVideoRuntime,
    ...subtitleRemovalRuntime,
    tailFramePickerVideo,
    tailFramePicker,
    ...tailFrameRuntime,
    ...videoPipeline,
    episodeVideoAction,
    startVideoFileDrag,
  };
}
