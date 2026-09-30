const lazyVideoStates = new WeakMap();
let lazyVideoObserver = null;

function playerCanvas(video) {
  return video?.closest?.('.video-canvas') || null;
}

function clearUnloadTimer(state) {
  if (!state?.unloadTimer) return;
  clearTimeout(state.unloadTimer);
  state.unloadTimer = null;
}

function clearLoadTimer(state) {
  if (!state?.loadTimer) return;
  clearTimeout(state.loadTimer);
  state.loadTimer = null;
}

function setCanvasState(state, name) {
  const canvas = playerCanvas(state?.video);
  if (!canvas) return;
  canvas.classList.toggle('is-video-deferred', name === 'deferred');
  canvas.classList.toggle('is-video-loading', name === 'loading');
  canvas.classList.toggle('is-video-ready', name === 'ready');
  canvas.classList.toggle('is-video-error', name === 'error');
}

function unloadLazyVideo(state, { force = false } = {}) {
  const video = state?.video;
  if (!video || !video.getAttribute('src')) return;
  if (!force && (!video.paused || document.fullscreenElement === video || document.pictureInPictureElement === video)) return;
  clearUnloadTimer(state);
  clearLoadTimer(state);
  if (Number.isFinite(video.currentTime) && video.currentTime > 0) state.currentTime = video.currentTime;
  try { video.pause(); } catch {}
  video.removeAttribute('src');
  video.preload = 'none';
  try { video.load(); } catch {}
  state.loadedUrl = '';
  setCanvasState(state, 'deferred');
}

function revealFirstFrame(state) {
  const video = state?.video;
  if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const target = state.currentTime > 0
    ? Math.min(state.currentTime, Math.max(0, video.duration - 0.05))
    : Math.min(0.01, video.duration / 2);
  try {
    if (Math.abs(video.currentTime - target) > 0.005) video.currentTime = target;
  } catch {}
}

function loadVisibleVideo(state, { force = false, preload = 'auto' } = {}) {
  const video = state?.video;
  const url = String(state?.url || '').trim();
  if (!video || !url || (!force && !state.nearViewport)) return false;
  clearLoadTimer(state);
  clearUnloadTimer(state);

  if (state.loadedUrl === url && video.getAttribute('src') === url) {
    if (preload === 'auto' && video.preload !== 'auto') {
      video.preload = 'auto';
      try { video.load(); } catch {}
    }
    return true;
  }
  setCanvasState(state, 'loading');
  video.preload = preload;
  video.src = url;
  state.loadedUrl = url;
  try { video.load(); } catch {}
  if (video.readyState >= 1) revealFirstFrame(state);
  else video.addEventListener('loadedmetadata', () => revealFirstFrame(state), { once: true });
  return true;
}

function scheduleVisibleLoad(state) {
  clearLoadTimer(state);
  state.loadTimer = setTimeout(() => {
    state.loadTimer = null;
    if (state.nearViewport) loadVisibleVideo(state);
  }, 90);
}

function ensureObserver() {
  if (lazyVideoObserver || typeof IntersectionObserver === 'undefined') return lazyVideoObserver;
  // 低配模式收窄预加载范围：少几个同时在载的视频比提前缓冲更重要
  const nearMargin = document.documentElement.classList.contains('lite-mode') ? '160px' : '320px';
  lazyVideoObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const state = lazyVideoStates.get(entry.target);
      if (!state) continue;
      state.nearViewport = entry.isIntersecting;
      if (entry.isIntersecting) {
        clearUnloadTimer(state);
        scheduleVisibleLoad(state);
        continue;
      }
      clearLoadTimer(state);
      const video = state.video;
      const isProtected = document.fullscreenElement === video || document.pictureInPictureElement === video;
      if (!isProtected && !video.paused) {
        try { video.pause(); } catch {}
      }
      // 已加载的视频保留 src，避免滚回卡片时再次初始化播放器。
    }
  }, { rootMargin: `${nearMargin} 0px ${nearMargin} 0px`, threshold: 0.01 });
  return lazyVideoObserver;
}

export function createLazyVideoDirective() {
  return {
    mounted(video, binding) {
      const state = {
        video,
        url: String(binding.value || '').trim(),
        loadedUrl: '',
        currentTime: 0,
        nearViewport: false,
        loadTimer: null,
        unloadTimer: null,
      };
      lazyVideoStates.set(video, state);
      video.dataset.lazyVideo = 'true';
      video.preload = 'metadata';
      video.removeAttribute('src');
      setCanvasState(state, 'deferred');

      state.onLoaded = () => setCanvasState(state, 'ready');
      state.onPlaying = () => setCanvasState(state, 'ready');
      state.onPause = () => {
        if (Number.isFinite(video.currentTime) && video.currentTime > 0) state.currentTime = video.currentTime;
      };
      state.onError = () => setCanvasState(state, 'error');
      video.addEventListener('loadeddata', state.onLoaded);
      video.addEventListener('canplay', state.onLoaded);
      video.addEventListener('playing', state.onPlaying);
      video.addEventListener('pause', state.onPause);
      video.addEventListener('ended', state.onPause);
      video.addEventListener('error', state.onError);
      ensureObserver()?.observe(video);
      // 只有环境不支持 IntersectionObserver 时才立即加载兜底；
      // 正常情况交给观察器在临近视口（±320px）时再加载，
      // 打开大分镜页不再一次性拉起全部视频。
      if (!lazyVideoObserver) loadVisibleVideo(state, { force: true, preload: 'metadata' });
    },
    updated(video, binding) {
      const state = lazyVideoStates.get(video);
      if (!state) return;
      const nextUrl = String(binding.value || '').trim();
      if (nextUrl === state.url) return;
      state.url = nextUrl;
      state.currentTime = 0;
      unloadLazyVideo(state, { force: true });
      setCanvasState(state, 'deferred');
      // 新地址只在卡片就在眼前时立刻加载（比如刚生成完的视频）；
      // 离屏的等滚到附近再说。
      if (state.nearViewport || !lazyVideoObserver) loadVisibleVideo(state, { force: true, preload: 'auto' });
    },
    beforeUnmount(video) {
      const state = lazyVideoStates.get(video);
      if (!state) return;
      clearLoadTimer(state);
      clearUnloadTimer(state);
      lazyVideoObserver?.unobserve(video);
      video.removeEventListener('loadeddata', state.onLoaded);
      video.removeEventListener('canplay', state.onLoaded);
      video.removeEventListener('playing', state.onPlaying);
      video.removeEventListener('pause', state.onPause);
      video.removeEventListener('ended', state.onPause);
      video.removeEventListener('error', state.onError);
      unloadLazyVideo(state, { force: true });
      lazyVideoStates.delete(video);
    },
  };
}
