const progressiveStates = new WeakMap();
let progressiveObserver = null;
const viewportRenderStates = new WeakMap();
let viewportRenderObserver = null;

function scheduleFrame(callback) {
  const schedule = globalThis.requestAnimationFrame || ((fn) => globalThis.setTimeout(fn, 0));
  schedule(callback);
}

function invokeLoadMore(state) {
  if (!state || state.pending || typeof state.loadMore !== 'function') return;
  state.pending = true;
  scheduleFrame(() => {
    if (!state.element?.isConnected) {
      state.pending = false;
      return;
    }
    const loaded = state.loadMore();
    scheduleFrame(() => {
      state.pending = false;
      if (loaded !== true || !state.element?.isConnected || !progressiveObserver) return;
      // Re-observing emits a fresh intersection state after Vue moves the sentinel.
      progressiveObserver.unobserve(state.element);
      progressiveObserver.observe(state.element);
    });
  });
}

function ensureObserver() {
  if (progressiveObserver || typeof IntersectionObserver === 'undefined') return progressiveObserver;
  progressiveObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      invokeLoadMore(progressiveStates.get(entry.target));
    }
  }, { rootMargin: '700px 0px 700px 0px', threshold: 0.01 });
  return progressiveObserver;
}

export function createProgressiveRenderDirective() {
  return {
    mounted(element, binding) {
      const state = {
        element,
        loadMore: binding.value,
        pending: false,
      };
      progressiveStates.set(element, state);
      const observer = ensureObserver();
      if (observer) observer.observe(element);
      else invokeLoadMore(state);
    },
    updated(element, binding) {
      const state = progressiveStates.get(element);
      if (state) state.loadMore = binding.value;
    },
    beforeUnmount(element) {
      progressiveObserver?.unobserve(element);
      progressiveStates.delete(element);
    },
  };
}

function measuredElementHeight(element, entry) {
  const entryHeight = Number(entry?.boundingClientRect?.height) || 0;
  const rectHeight = Number(element?.getBoundingClientRect?.().height) || 0;
  const offsetHeight = Number(element?.offsetHeight) || 0;
  return Math.ceil(Math.max(entryHeight, rectHeight, offsetHeight, 0));
}

function ensureViewportRenderObserver() {
  if (viewportRenderObserver || typeof IntersectionObserver === 'undefined') return viewportRenderObserver;
  viewportRenderObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const state = viewportRenderStates.get(entry.target);
      if (!state) continue;
      state.intersecting = entry.isIntersecting;
      const binding = state.binding || {};
      if (entry.isIntersecting) {
        binding.activate?.();
        scheduleFrame(() => {
          const current = viewportRenderStates.get(state.element)?.binding;
          const height = measuredElementHeight(state.element);
          if (height > 0) current?.rememberHeight?.(height);
        });
        continue;
      }
      if (binding.active !== true || binding.pinned === true) continue;
      // Defer unloading by one frame so a synchronous state change (for example
      // clicking video generation) can pin the card before this stale observer
      // entry removes its contents.
      scheduleFrame(() => {
        const currentState = viewportRenderStates.get(entry.target);
        const current = currentState?.binding;
        if (currentState?.intersecting !== false || current?.active !== true || current?.pinned === true) return;
        current.deactivate?.(measuredElementHeight(state.element, entry));
      });
    }
  }, { rootMargin: '1400px 0px 1400px 0px', threshold: 0 });
  return viewportRenderObserver;
}

// Keeps only near-viewport card contents mounted. The wrapper remains in flow at
// its measured height, so window scrolling and deep shot jumps stay stable.
export function createViewportRenderDirective() {
  return {
    mounted(element, binding) {
      const state = { element, binding: binding.value || {}, intersecting: null };
      viewportRenderStates.set(element, state);
      const observer = ensureViewportRenderObserver();
      if (observer) observer.observe(element);
      else state.binding.activate?.();
    },
    updated(element, binding) {
      const state = viewportRenderStates.get(element);
      if (!state) return;
      const wasPinned = state.binding?.pinned === true;
      state.binding = binding.value || {};
      if (wasPinned && state.binding.pinned !== true && state.intersecting === false && state.binding.active === true) {
        scheduleFrame(() => {
          const current = viewportRenderStates.get(element)?.binding;
          if (current?.pinned !== true && current?.active === true) current.deactivate?.(measuredElementHeight(element));
        });
      }
    },
    beforeUnmount(element) {
      viewportRenderObserver?.unobserve(element);
      viewportRenderStates.delete(element);
    },
  };
}
