const SUBTITLE_PRESETS = Object.freeze({
  smart: { range: [76, 96], left: 6, width: 88 },
  single: { range: [82, 96], left: 12, width: 76 },
  double: { range: [70, 97], left: 5, width: 90 },
});

export const subtitlePresetOptions = Object.freeze([
  { label: '智能', value: 'smart' },
  { label: '单行', value: 'single' },
  { label: '双行', value: 'double' },
]);

export const subtitleQualityOptions = Object.freeze([
  { label: '省时', value: 'quick' },
  { label: '高清', value: 'fine' },
  { label: '极致', value: 'cinema' },
]);

export const subtitleMethodOptions = Object.freeze([
  { label: '自然修复', value: 'precision' },
  { label: '快速抹除', value: 'fast' },
]);

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizedRange(value) {
  const incoming = Array.isArray(value) ? value : SUBTITLE_PRESETS.smart.range;
  const top = numberInRange(incoming[0], 76, 1, 96);
  const bottom = numberInRange(incoming[1], 96, top + 3, 99);
  return [top, bottom];
}

function normalizedLeft(value, width) {
  return numberInRange(value, (100 - width) / 2, 1, 99 - width);
}

function roundedPercent(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function createSubtitleRemovalRuntime({ api, message, refs = {}, helpers = {}, globals = {}, reactive } = {}) {
  const states = reactive({});
  const loadingStatus = new Map();
  const stateKey = (no) => `${refs.episodeId.value}:${no}`;

  const subtitleRemovalState = (no) => {
    const key = stateKey(no);
    if (!states[key]) {
      states[key] = {
        open: false,
        preset: 'smart',
        range: [...SUBTITLE_PRESETS.smart.range],
        left: SUBTITLE_PRESETS.smart.left,
        width: SUBTITLE_PRESETS.smart.width,
        method: 'precision',
        quality: 'fine',
        busy: false,
        phase: '',
        progress: 0,
        progressFrame: 0,
        progressTotalFrames: 0,
        dragging: false,
        hasBackup: false,
        statusLoaded: false,
        resultType: '',
        resultText: '',
      };
    }
    return states[key];
  };

  const subtitleMaskStyle = (no) => {
    const state = subtitleRemovalState(no);
    const [top, bottom] = normalizedRange(state.range);
    const width = numberInRange(state.width, 88, 6, 98);
    const left = normalizedLeft(state.left, width);
    return {
      top: `${top}%`,
      height: `${bottom - top}%`,
      left: `${left}%`,
      width: `${width}%`,
    };
  };

  const applySubtitlePreset = (no, preset) => {
    const state = subtitleRemovalState(no);
    const value = SUBTITLE_PRESETS[preset] ? preset : 'smart';
    state.preset = value;
    state.range = [...SUBTITLE_PRESETS[value].range];
    state.left = SUBTITLE_PRESETS[value].left;
    state.width = SUBTITLE_PRESETS[value].width;
  };

  const setSubtitleRange = (no, value) => {
    const state = subtitleRemovalState(no);
    state.range = normalizedRange(value);
    state.preset = '';
  };

  const setSubtitleWidth = (no, value) => {
    const state = subtitleRemovalState(no);
    const previousWidth = numberInRange(state.width, 88, 6, 98);
    const nextWidth = numberInRange(value, 88, 6, 98);
    const center = normalizedLeft(state.left, previousWidth) + (previousWidth / 2);
    state.width = nextWidth;
    state.left = normalizedLeft(center - (nextWidth / 2), nextWidth);
    state.preset = '';
  };

  const setSubtitleMethod = (no, value) => {
    subtitleRemovalState(no).method = ['precision', 'fast'].includes(value) ? value : 'precision';
  };

  const setSubtitleQuality = (no, value) => {
    subtitleRemovalState(no).quality = ['quick', 'fine', 'cinema'].includes(value) ? value : 'fine';
  };

  const clearSubtitleResult = (no) => {
    const state = subtitleRemovalState(no);
    state.resultType = '';
    state.resultText = '';
  };

  const startSubtitleMaskInteraction = (event, no, action = 'move') => {
    const state = subtitleRemovalState(no);
    if (state.busy || (event.button != null && event.button !== 0)) return;
    const canvas = event.currentTarget?.closest?.('.video-canvas');
    const bounds = canvas?.getBoundingClientRect?.();
    const documentTarget = globals.document || globalThis.document;
    if (!bounds?.width || !bounds?.height || !documentTarget) return;

    const [initialTop, initialBottom] = normalizedRange(state.range);
    const initialWidth = numberInRange(state.width, 88, 6, 98);
    const initialLeft = normalizedLeft(state.left, initialWidth);
    const initial = {
      x: event.clientX,
      y: event.clientY,
      top: initialTop,
      bottom: initialBottom,
      left: initialLeft,
      right: initialLeft + initialWidth,
    };
    const pointerId = event.pointerId;
    state.dragging = true;
    state.preset = '';
    event.preventDefault?.();

    const onPointerMove = (moveEvent) => {
      if (pointerId != null && moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault?.();
      const dx = ((moveEvent.clientX - initial.x) / bounds.width) * 100;
      const dy = ((moveEvent.clientY - initial.y) / bounds.height) * 100;
      let { top, bottom, left, right } = initial;
      if (action === 'move') {
        const width = right - left;
        const height = bottom - top;
        left = numberInRange(left + dx, left, 1, 99 - width);
        right = left + width;
        top = numberInRange(top + dy, top, 1, 99 - height);
        bottom = top + height;
      } else {
        if (action.includes('w')) left = numberInRange(left + dx, left, 1, right - 6);
        if (action.includes('e')) right = numberInRange(right + dx, right, left + 6, 99);
        if (action.includes('n')) top = numberInRange(top + dy, top, 1, bottom - 3);
        if (action.includes('s')) bottom = numberInRange(bottom + dy, bottom, top + 3, 99);
      }
      state.left = roundedPercent(left);
      state.width = roundedPercent(right - left);
      state.range = [roundedPercent(top), roundedPercent(bottom)];
    };

    const finish = (finishEvent) => {
      if (pointerId != null && finishEvent?.pointerId != null && finishEvent.pointerId !== pointerId) return;
      state.dragging = false;
      documentTarget.removeEventListener('pointermove', onPointerMove);
      documentTarget.removeEventListener('pointerup', finish);
      documentTarget.removeEventListener('pointercancel', finish);
    };
    documentTarget.addEventListener('pointermove', onPointerMove, { passive: false });
    documentTarget.addEventListener('pointerup', finish);
    documentTarget.addEventListener('pointercancel', finish);
  };

  const applyVideoResult = (no, result, restored = false) => {
    const key = stateKey(no);
    const previousUrl = refs.shotVideos[key];
    if (previousUrl?.startsWith?.('blob:')) helpers.revokeObjectUrl?.(previousUrl);
    refs.shotVideos[key] = result.videoUrl;
    if (refs.shotStatus) delete refs.shotStatus[key];
    if (refs.shotProgress) delete refs.shotProgress[key];

    const storyboard = helpers.findStoryboard?.(refs.episodeId.value);
    if (storyboard) {
      if (!storyboard.shotVideos || typeof storyboard.shotVideos !== 'object') storyboard.shotVideos = {};
      const next = {
        ...(storyboard.shotVideos[String(no)] || {}),
        videoUrl: result.videoUrl,
        updatedAt: new Date().toISOString(),
      };
      if (restored) delete next.subtitleRemoval;
      else if (result.options) next.subtitleRemoval = result.options;
      storyboard.shotVideos[String(no)] = next;
      helpers.saveScript?.();
    }
  };

  const loadSubtitleRemovalStatus = async (no, { force = false } = {}) => {
    const state = subtitleRemovalState(no);
    if (state.statusLoaded && !force) return state;
    const key = stateKey(no);
    if (loadingStatus.has(key)) return loadingStatus.get(key);
    const projectId = refs.project?.value?.id;
    if (!projectId) return state;
    const query = new URLSearchParams({
      projectId: String(projectId),
      episodeId: String(refs.episodeId.value),
      shotNo: String(no),
    });
    const request = api.get(`/api/video/subtitles/status?${query.toString()}`)
      .then((result) => {
        state.hasBackup = Boolean(result?.hasBackup);
        state.statusLoaded = true;
        if (result?.options) {
          state.range = normalizedRange([result.options.topPercent, result.options.bottomPercent]);
          state.width = numberInRange(result.options.widthPercent, 88, 6, 98);
          state.left = normalizedLeft(result.options.leftPercent, state.width);
          state.method = ['precision', 'fast'].includes(result.options.method) ? result.options.method : 'precision';
          state.quality = ['quick', 'fine', 'cinema'].includes(result.options.quality) ? result.options.quality : 'fine';
          state.preset = '';
        }
        return state;
      })
      .catch(() => state)
      .finally(() => loadingStatus.delete(key));
    loadingStatus.set(key, request);
    return request;
  };

  const toggleSubtitleRemoval = (no) => {
    const state = subtitleRemovalState(no);
    state.open = !state.open;
    if (state.open) loadSubtitleRemovalStatus(no, { force: true });
  };

  const startSubtitleProgressPolling = (no, projectId) => {
    const state = subtitleRemovalState(no);
    const setTimeoutFn = globals.setTimeout || globalThis.setTimeout;
    let stopped = false;
    const query = new URLSearchParams({
      projectId: String(projectId),
      episodeId: String(refs.episodeId.value),
      shotNo: String(no),
    });
    const poll = async () => {
      while (!stopped) {
        try {
          const result = await api.get(`/api/video/subtitles/status?${query.toString()}`);
          if (stopped) break;
          const processing = result?.processing;
          if (processing) {
            state.progress = numberInRange(processing.progress, state.progress, 0, 99);
            state.progressFrame = Math.max(0, Number(processing.frame) || 0);
            state.progressTotalFrames = Math.max(0, Number(processing.totalFrames) || 0);
          }
        } catch {
          // The removal request remains authoritative; a transient poll failure is harmless.
        }
        if (!stopped) await new Promise((resolve) => setTimeoutFn(resolve, 700));
      }
    };
    void poll();
    return () => { stopped = true; };
  };

  const removeShotSubtitles = async (no) => {
    const state = subtitleRemovalState(no);
    if (state.busy) return;
    const projectId = refs.project?.value?.id;
    if (!projectId) return message.error('当前项目不可用');
    const [topPercent, bottomPercent] = normalizedRange(state.range);
    clearSubtitleResult(no);
    state.busy = true;
    state.phase = 'remove';
    state.progress = 0;
    state.progressFrame = 0;
    state.progressTotalFrames = 0;
    const stopProgressPolling = startSubtitleProgressPolling(no, projectId);
    try {
      const result = await api.post('/api/video/subtitles/remove', {
        projectId,
        episodeId: refs.episodeId.value,
        shotNo: no,
        topPercent,
        bottomPercent,
        leftPercent: state.left,
        widthPercent: state.width,
        method: state.method,
        quality: state.quality,
      }, { timeoutMs: 60 * 60 * 1000 });
      if (!result?.ok || !result.videoUrl) throw new Error(result?.error || '去字幕处理失败');
      state.hasBackup = true;
      state.statusLoaded = true;
      state.progress = 100;
      applyVideoResult(no, result);
      state.resultType = 'success';
      state.resultText = '去字幕完成，已更新本地视频';
      message.success(`镜头 ${no} 已去字幕并更新本地视频`);
    } catch (error) {
      const errorText = error.message || '去字幕处理失败';
      state.resultType = 'error';
      state.resultText = errorText;
      message.error(errorText);
      await loadSubtitleRemovalStatus(no, { force: true });
    } finally {
      stopProgressPolling();
      state.busy = false;
      state.phase = '';
    }
  };

  const restoreShotBeforeSubtitleRemoval = async (no) => {
    const state = subtitleRemovalState(no);
    if (state.busy || !state.hasBackup) return;
    const projectId = refs.project?.value?.id;
    if (!projectId) return message.error('当前项目不可用');
    clearSubtitleResult(no);
    state.busy = true;
    state.phase = 'restore';
    try {
      const result = await api.post('/api/video/subtitles/restore', {
        projectId,
        episodeId: refs.episodeId.value,
        shotNo: no,
      }, { timeoutMs: 30 * 60 * 1000 });
      if (!result?.ok || !result.videoUrl) throw new Error(result?.error || '原片还原失败');
      state.hasBackup = false;
      state.statusLoaded = true;
      applyVideoResult(no, result, true);
      state.resultType = 'success';
      state.resultText = '原片还原完成，已更新本地视频';
      message.success(`镜头 ${no} 已还原原片`);
    } catch (error) {
      const errorText = error.message || '原片还原失败';
      state.resultType = 'error';
      state.resultText = errorText;
      message.error(errorText);
      await loadSubtitleRemovalStatus(no, { force: true });
    } finally {
      state.busy = false;
      state.phase = '';
    }
  };

  return {
    subtitlePresetOptions,
    subtitleMethodOptions,
    subtitleQualityOptions,
    subtitleRemovalState,
    subtitleMaskStyle,
    applySubtitlePreset,
    setSubtitleRange,
    setSubtitleWidth,
    setSubtitleMethod,
    setSubtitleQuality,
    clearSubtitleResult,
    startSubtitleMaskInteraction,
    toggleSubtitleRemoval,
    removeShotSubtitles,
    restoreShotBeforeSubtitleRemoval,
  };
}
