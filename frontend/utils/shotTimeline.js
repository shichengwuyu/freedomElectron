export const SHOT_REVIEW_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'review', label: '待审核' },
  { value: 'approved', label: '已通过' },
];

export const SHOT_CARD_DENSITY_OPTIONS = [
  { value: 'comfortable', label: '标准' },
  { value: 'compact', label: '紧凑' },
  { value: 'wall', label: '看片墙' },
];

export const SHOT_CARD_DENSITY_STORAGE_KEY = 'gg.storyboard.card-density';
export const SHOT_RENDER_BATCH_SIZE = 10;

import { createShotLockSnapshot } from './shotLock.js';

const SHOT_REVIEW_LABELS = Object.fromEntries(SHOT_REVIEW_OPTIONS.map((item) => [item.value, item.label]));

export function normalizeShotCardDensity(value) {
  const density = String(value || '').trim();
  return SHOT_CARD_DENSITY_OPTIONS.some((item) => item.value === density) ? density : 'comfortable';
}

function shotNoKey(value) {
  return String(value ?? '').trim();
}

function cloneRecordValue(value) {
  if (Array.isArray(value)) return value.map((item) => (item && typeof item === 'object' ? { ...item } : item));
  if (value && typeof value === 'object') return { ...value };
  return value;
}

export function normalizeShotReviewStatus(value) {
  const status = String(value || '').trim();
  return SHOT_REVIEW_OPTIONS.some((item) => item.value === status) ? status : 'draft';
}

export function normalizeShotTimelineDuration(value, fallback = 15, maxDuration = 30) {
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  let seconds = match ? Number(match[1]) : Number(fallback);
  if (!Number.isFinite(seconds)) seconds = 5;
  const maximum = Math.max(4, Math.min(500, Math.round(Number(maxDuration) || 30)));
  return Math.min(maximum, Math.max(4, Math.round(seconds)));
}

// Accept the separators users commonly use when copying a list of shot numbers.
// Ranges are supported for convenience (for example, "13,18-21,58").
export function parseShotNumberInput(value, { maxNumbers = 5000 } = {}) {
  const source = String(value ?? '').trim();
  if (!source) return { numbers: [], invalidTokens: [] };
  const tokens = source
    .replace(/[，、；;\n\r\t]+/g, ',')
    .replace(/\s*([-~～])\s*/g, '$1')
    .replace(/\s+/g, ',')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  const numbers = [];
  const invalidTokens = [];
  const addNumber = (valueToAdd) => {
    if (numbers.length >= maxNumbers) return;
    const key = String(valueToAdd);
    if (!numbers.includes(key)) numbers.push(key);
  };
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^(?:分镜|镜头|#)/, '');
    const range = token.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from >= 1 && to >= 1 && Math.abs(to - from) + 1 <= maxNumbers) {
        const step = from <= to ? 1 : -1;
        for (let current = from; current !== to + step; current += step) addNumber(current);
        continue;
      }
    }
    if (/^\d+$/.test(token) && Number(token) >= 1) {
      addNumber(Number(token));
      continue;
    }
    invalidTokens.push(rawToken);
  }
  return { numbers, invalidTokens };
}

export function serializeShotList(shots = []) {
  return (Array.isArray(shots) ? shots : [])
    .map((shot, index) => `分镜${index + 1}：\n${String(shot?.body || '').trim()}`)
    .join('\n\n');
}

export function shotNumberMapping(orderedShots = []) {
  const mapping = {};
  (Array.isArray(orderedShots) ? orderedShots : []).forEach((shot, index) => {
    const oldNo = shotNoKey(shot?.no);
    if (oldNo) mapping[oldNo] = String(index + 1);
  });
  return mapping;
}

export function remapShotRecord(record, mapping = {}, transform = null) {
  if (!record || typeof record !== 'object') return {};
  const next = {};
  for (const [oldNo, value] of Object.entries(record)) {
    const nextNo = mapping[shotNoKey(oldNo)];
    if (!nextNo) continue;
    next[String(nextNo)] = transform
      ? transform(value, String(nextNo), String(oldNo))
      : cloneRecordValue(value);
  }
  return next;
}

export function remapEpisodeRuntimeRecord(record, episodeId, mapping = {}, transform = null) {
  if (!record || typeof record !== 'object') return record;
  const prefix = `${episodeId}:`;
  const preserved = {};
  const remapped = {};
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith(prefix)) {
      preserved[key] = value;
      continue;
    }
    const oldNo = key.slice(prefix.length);
    const nextNo = mapping[shotNoKey(oldNo)];
    if (!nextNo) continue;
    remapped[`${episodeId}:${nextNo}`] = transform
      ? transform(value, String(nextNo), String(oldNo))
      : value;
  }
  for (const key of Object.keys(record)) delete record[key];
  Object.assign(record, preserved, remapped);
  return record;
}

export function reorderShotBlock(shots = [], selectedNos = [], targetNo, after = false) {
  const list = Array.isArray(shots) ? shots.slice() : [];
  const selected = new Set((Array.isArray(selectedNos) ? selectedNos : []).map(shotNoKey));
  const targetKey = shotNoKey(targetNo);
  if (!selected.size || selected.has(targetKey)) return list;
  const moving = list.filter((shot) => selected.has(shotNoKey(shot?.no)));
  const remaining = list.filter((shot) => !selected.has(shotNoKey(shot?.no)));
  const targetIndex = remaining.findIndex((shot) => shotNoKey(shot?.no) === targetKey);
  if (!moving.length || targetIndex < 0) return list;
  const insertIndex = targetIndex + (after ? 1 : 0);
  remaining.splice(insertIndex, 0, ...moving);
  return remaining;
}

export function shiftSelectedShotBlock(shots = [], selectedNos = [], delta = 0) {
  const list = Array.isArray(shots) ? shots.slice() : [];
  const selected = new Set((Array.isArray(selectedNos) ? selectedNos : []).map(shotNoKey));
  const selectedIndexes = list
    .map((shot, index) => (selected.has(shotNoKey(shot?.no)) ? index : -1))
    .filter((index) => index >= 0);
  if (!selectedIndexes.length || !delta) return list;
  if (delta < 0) {
    const first = selectedIndexes[0];
    let targetIndex = first - 1;
    while (targetIndex >= 0 && selected.has(shotNoKey(list[targetIndex]?.no))) targetIndex -= 1;
    if (targetIndex < 0) return list;
    return reorderShotBlock(list, [...selected], list[targetIndex].no, false);
  }
  const last = selectedIndexes[selectedIndexes.length - 1];
  let targetIndex = last + 1;
  while (targetIndex < list.length && selected.has(shotNoKey(list[targetIndex]?.no))) targetIndex += 1;
  if (targetIndex >= list.length) return list;
  return reorderShotBlock(list, [...selected], list[targetIndex].no, true);
}

function normalizedSceneLabel(shot) {
  return String(shot?.title || '').trim() || '未命名场景';
}

export function groupShotsByScene(shots = [], enabled = true) {
  const list = Array.isArray(shots) ? shots : [];
  if (!enabled) return list.length ? [{ key: 'all', label: '全部镜头', shots: list }] : [];
  const groups = [];
  for (const shot of list) {
    const label = normalizedSceneLabel(shot);
    const previous = groups[groups.length - 1];
    if (previous && previous.label === label) previous.shots.push(shot);
    else groups.push({ key: `${groups.length}:${shotNoKey(shot?.no)}`, label, shots: [shot] });
  }
  return groups;
}

export function applyShotTimelineMeta(shots = [], storyboard = {}, fallbackDuration = 15, maxDuration = 30) {
  const metaMap = storyboard?.shotMeta && typeof storyboard.shotMeta === 'object' ? storyboard.shotMeta : {};
  return (Array.isArray(shots) ? shots : []).map((shot) => {
    const meta = metaMap[shotNoKey(shot?.no)] || {};
    const durationSource = meta.duration == null ? shot.duration : meta.duration;
    const duration = `${normalizeShotTimelineDuration(durationSource, fallbackDuration, maxDuration)}s`;
    return {
      ...shot,
      duration,
      // 每镜的参考视频（视频→视频 / 图生视频的参考）。挂在 shotMeta 上，所以镜头插入删除时会跟着平移。
      refVideoPath: String(meta.refVideoPath || ''),
      refVideoName: String(meta.refVideoName || ''),
      refVideoDuration: Number(meta.refVideoDuration) || 0,
      videoSettings: meta.videoSettings && typeof meta.videoSettings === 'object'
        ? { ...meta.videoSettings }
        : {},
      timelineMeta: {
        duration: normalizeShotTimelineDuration(duration, fallbackDuration, maxDuration),
        locked: meta.locked === true,
        needsAttention: meta.needsAttention === true,
        reviewStatus: normalizeShotReviewStatus(meta.reviewStatus),
        updatedAt: meta.updatedAt || '',
      },
    };
  });
}

function ensureShotMeta(storyboard) {
  if (!storyboard.shotMeta || typeof storyboard.shotMeta !== 'object') storyboard.shotMeta = {};
  return storyboard.shotMeta;
}

function ensureStoryboardRecord(storyboard, key) {
  if (!storyboard[key] || typeof storyboard[key] !== 'object') storyboard[key] = {};
  return storyboard[key];
}

function copyTagList(value) {
  return Array.isArray(value)
    ? value.map((item) => (item && typeof item === 'object' ? { ...item } : item))
    : [];
}

function reviewType(status) {
  if (status === 'approved') return 'success';
  if (status === 'review') return 'warning';
  return 'info';
}

export function createShotTimelineRuntime({ api, message, messageBox, refs = {}, helpers = {}, computed, globals = {} } = {}) {
  const timeline = refs.timeline;
  if (!Number.isFinite(Number(timeline.renderLimit))) timeline.renderLimit = SHOT_RENDER_BATCH_SIZE;
  if (!timeline.cardWindow || typeof timeline.cardWindow !== 'object') {
    timeline.cardWindow = { active: {}, heights: {} };
  }
  if (!timeline.cardWindow.active || typeof timeline.cardWindow.active !== 'object') timeline.cardWindow.active = {};
  if (!timeline.cardWindow.heights || typeof timeline.cardWindow.heights !== 'object') timeline.cardWindow.heights = {};
  const clearShotCardWindow = () => {
    for (const key of Object.keys(timeline.cardWindow.active)) delete timeline.cardWindow.active[key];
    for (const key of Object.keys(timeline.cardWindow.heights)) delete timeline.cardWindow.heights[key];
  };
  const currentStoryboard = () => helpers.findStoryboard(refs.episodeId.value);
  const currentShots = () => refs.currentShots.value || [];
  const setSelectedNos = (values = []) => {
    const unique = [...new Set(values.map(shotNoKey).filter(Boolean))];
    timeline.selectedNos.splice(0, timeline.selectedNos.length, ...unique);
  };
  const validSelectedNos = () => {
    const valid = new Set(currentShots().map((shot) => shotNoKey(shot.no)));
    return timeline.selectedNos.filter((no) => valid.has(shotNoKey(no))).map(shotNoKey);
  };
  const selectedShotSet = computed(() => new Set(validSelectedNos()));
  const selectedShots = computed(() => {
    const selected = selectedShotSet.value;
    return currentShots().filter((shot) => selected.has(shotNoKey(shot.no)));
  });
  const selectedCount = computed(() => selectedShots.value.length);
  const targetEpisodes = computed(() => (refs.scriptState.episodes || [])
    .filter((episode) => String(episode.id) !== String(refs.episodeId.value))
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id)));

  const shotMeta = (shot, { create = false } = {}) => {
    const storyboard = currentStoryboard();
    if (!storyboard) return {};
    const map = create ? ensureShotMeta(storyboard) : (storyboard.shotMeta || {});
    const key = shotNoKey(shot?.no);
    if (create && (!map[key] || typeof map[key] !== 'object')) map[key] = {};
    return map[key] || {};
  };

  const isShotLocked = (shot) => shotMeta(shot).locked === true;
  const isShotAttentionMarked = (shot) => shotMeta(shot).needsAttention === true;
  const storage = globals.storage || globals.window?.localStorage || null;
  const readStoredDensity = () => {
    try { return normalizeShotCardDensity(storage?.getItem?.(SHOT_CARD_DENSITY_STORAGE_KEY)); }
    catch { return 'comfortable'; }
  };
  if (timeline.cardDensity === undefined) timeline.cardDensity = readStoredDensity();
  else timeline.cardDensity = normalizeShotCardDensity(timeline.cardDensity);
  const setCardDensity = (value) => {
    const density = normalizeShotCardDensity(value);
    if (density !== normalizeShotCardDensity(timeline.cardDensity)) clearShotCardWindow();
    timeline.cardDensity = density;
    try { storage?.setItem?.(SHOT_CARD_DENSITY_STORAGE_KEY, density); } catch { /* ignore */ }
    return density;
  };
  const shotReviewStatus = (shot) => normalizeShotReviewStatus(shotMeta(shot).reviewStatus);
  const shotReviewLabel = (shot) => SHOT_REVIEW_LABELS[shotReviewStatus(shot)] || '草稿';
  const shotReviewType = (shot) => reviewType(shotReviewStatus(shot));
  const shotVideoKey = (shot) => `${refs.episodeId.value}:${shotNoKey(shot?.no)}`;
  const shotVideoUrl = (shot) => {
    const key = shotVideoKey(shot);
    return refs.shotVideos[key] || currentStoryboard()?.shotVideos?.[shotNoKey(shot?.no)]?.videoUrl || '';
  };
  const attentionShots = computed(() => currentShots().filter(isShotAttentionMarked));
  const missingVideoShots = computed(() => currentShots().filter((shot) => !shotVideoUrl(shot)));
  const visibleShots = computed(() => {
    if (timeline.attentionFilter === 'attention') return attentionShots.value;
    if (timeline.attentionFilter === 'missing-video') return missingVideoShots.value;
    return currentShots();
  });
  const visibleShotIndex = computed(() => new Map(
    visibleShots.value.map((shot, index) => [shotNoKey(shot?.no), index]),
  ));
  const renderedShots = computed(() => visibleShots.value.slice(0, Math.max(SHOT_RENDER_BATCH_SIZE, Number(timeline.renderLimit) || 0)));
  const hasMoreRenderedShots = computed(() => renderedShots.value.length < visibleShots.value.length);
  const shotCardWindowKey = (shot) => [
    refs.project?.value?.id || refs.project?.id || '',
    refs.episodeId.value,
    timeline.attentionFilter || 'all',
    normalizeShotCardDensity(timeline.cardDensity),
    shotNoKey(shot?.no),
  ].join(':');
  const shotCardEditKey = (shot) => `${refs.episodeId.value}:${shot?.no}:${shot?.index || 0}`;
  const isShotCardPinned = (shot) => {
    if (refs.shotEdit?.key === shotCardEditKey(shot)) return true;
    const status = refs.shotStatus[shotVideoKey(shot)] || '';
    return status === 'queued' || status === 'generating';
  };
  const defaultShotCardHeight = () => {
    const density = normalizeShotCardDensity(timeline.cardDensity);
    if (density === 'compact') return 560;
    if (density === 'wall') return 430;
    return 980;
  };
  const isShotCardWindowActive = (shot) => {
    if (isShotCardPinned(shot)) return true;
    const key = shotCardWindowKey(shot);
    const explicit = timeline.cardWindow.active[key];
    if (typeof explicit === 'boolean') return explicit;
    const index = visibleShotIndex.value.get(shotNoKey(shot?.no));
    return index >= 0 && index < SHOT_RENDER_BATCH_SIZE;
  };
  const rememberShotCardWindowHeight = (shot, value) => {
    const height = Math.round(Number(value) || 0);
    if (height < 120 || height > 6000) return false;
    const key = shotCardWindowKey(shot);
    if (Math.abs((Number(timeline.cardWindow.heights[key]) || 0) - height) < 2) return false;
    timeline.cardWindow.heights[key] = height;
    return true;
  };
  const activateShotCardWindow = (shot) => {
    const key = shotCardWindowKey(shot);
    if (timeline.cardWindow.active[key] === true) return false;
    timeline.cardWindow.active[key] = true;
    return true;
  };
  const deactivateShotCardWindow = (shot, height = 0) => {
    rememberShotCardWindowHeight(shot, height);
    const key = shotCardWindowKey(shot);
    if (timeline.cardWindow.active[key] === false) return false;
    timeline.cardWindow.active[key] = false;
    return true;
  };
  const shotCardWindowStyle = (shot) => {
    if (isShotCardWindowActive(shot)) return undefined;
    const height = Number(timeline.cardWindow.heights[shotCardWindowKey(shot)]) || defaultShotCardHeight();
    return { minHeight: `${height}px` };
  };
  const shotCardWindowBinding = (shot) => ({
    active: isShotCardWindowActive(shot),
    pinned: isShotCardPinned(shot),
    activate: () => activateShotCardWindow(shot),
    deactivate: (height) => deactivateShotCardWindow(shot, height),
    rememberHeight: (height) => rememberShotCardWindowHeight(shot, height),
  });
  const loadMoreShotCards = () => {
    if (!hasMoreRenderedShots.value) return false;
    timeline.renderLimit += SHOT_RENDER_BATCH_SIZE;
    return true;
  };
  const resetShotRenderWindow = () => {
    timeline.renderLimit = SHOT_RENDER_BATCH_SIZE;
    clearShotCardWindow();
  };
  const groups = computed(() => groupShotsByScene(visibleShots.value, timeline.groupByScene));
  const maxDuration = () => Math.max(4, Math.min(500, Number(refs.maxDuration?.() || 30) || 30));
  const defaultDuration = () => Number(refs.defaultDuration?.() || 15) || 15;
  const totalDuration = computed(() => visibleShots.value.reduce(
    (sum, shot) => sum + normalizeShotTimelineDuration(shot.duration, defaultDuration(), maxDuration()),
    0,
  ));
  const isShotSelected = (shot) => selectedShotSet.value.has(shotNoKey(shot?.no));
  const shotDuration = (shot) => normalizeShotTimelineDuration(shot?.duration, defaultDuration(), maxDuration());
  const shotStyle = (shot) => {
    const seconds = shotDuration(shot);
    const zoom = Math.min(1.8, Math.max(0.65, Number(timeline.zoom) || 1));
    const width = Math.round(Math.min(360, Math.max(132, seconds * 22 * zoom)));
    return { width: `${width}px` };
  };
  const shotCardDomId = (shot) => `shot-card-${String(refs.episodeId.value).replace(/[^\w-]/g, '-')}-${shotNoKey(shot?.no).replace(/[^\w-]/g, '-')}`;
  const shotVideoStatus = (shot) => {
    const status = refs.shotStatus[shotVideoKey(shot)] || '';
    if (status) return status;
    return shotVideoUrl(shot) ? 'done' : 'idle';
  };
  const shotVideoStatusLabel = (shot) => {
    const status = shotVideoStatus(shot);
    if (status === 'done') return '已出片';
    if (status === 'queued') return '已提交';
    if (status === 'generating') return '生成中';
    if (status === 'failed') return '失败';
    return '未生成';
  };
  const shotElementPreviewCache = new WeakMap();
  const shotElementPreview = (shot) => {
    const tags = helpers.shotElementTags(shot);
    // tags reference is stable as long as cache in shotElementTags hasn't been
    // busted, so keying on the array ref gives us cheap per-shot memoization.
    const cached = shotElementPreviewCache.get(tags);
    if (cached) return cached;
    const preview = tags.filter((tag) => tag.hasImage).slice(0, 4);
    shotElementPreviewCache.set(tags, preview);
    return preview;
  };
  const shotAudioCount = (shot) => helpers.shotAudioTags(shot).length;

  const previewVideoElement = () => globals.document?.querySelector?.(
    '.shot-timeline-video-dialog .shot-timeline-video-player video',
  );
  const openVideoPreview = (shot, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const url = shotVideoUrl(shot);
    if (!url) return message.warning('当前镜头还没有可播放的视频');
    timeline.videoPreview.url = url;
    timeline.videoPreview.shotNo = shotNoKey(shot?.no);
    timeline.videoPreview.title = `镜头 ${shotNoKey(shot?.no)} · ${String(shot?.title || '视频预览').trim()}`;
    timeline.videoPreview.visible = true;
    helpers.nextTick?.(() => {
      const playResult = previewVideoElement()?.play?.();
      playResult?.catch?.(() => {});
    });
    return true;
  };
  const closeVideoPreview = () => {
    previewVideoElement()?.pause?.();
    timeline.videoPreview.visible = false;
    timeline.videoPreview.url = '';
    timeline.videoPreview.title = '';
    timeline.videoPreview.shotNo = '';
  };
  const fullscreenVideoPreview = async () => {
    const video = previewVideoElement();
    if (!video) return message.warning('视频播放器尚未准备好');
    try {
      const playResult = video.play?.();
      await playResult?.catch?.(() => {});
      if (video.requestFullscreen) await video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else if (video.webkitRequestFullscreen) await video.webkitRequestFullscreen();
      else return message.warning('当前环境不支持全屏播放');
      return true;
    } catch (error) {
      message.warning(`无法进入全屏：${error?.message || error}`);
      return false;
    }
  };

  const selectShot = (shot, event = {}) => {
    const no = shotNoKey(shot?.no);
    if (!no) return;
    const current = validSelectedNos();
    const toggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && timeline.anchorNo) {
      const shots = currentShots();
      const fromIndex = shots.findIndex((item) => shotNoKey(item.no) === shotNoKey(timeline.anchorNo));
      const toIndex = shots.findIndex((item) => shotNoKey(item.no) === no);
      if (fromIndex >= 0 && toIndex >= 0) {
        const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
        setSelectedNos(shots.slice(start, end + 1).map((item) => item.no));
      }
    } else if (toggle) {
      const selected = new Set(current.map(shotNoKey));
      if (selected.has(no)) selected.delete(no);
      else selected.add(no);
      setSelectedNos([...selected]);
      timeline.anchorNo = no;
    } else {
      setSelectedNos([no]);
      timeline.anchorNo = no;
    }
  };

  const selectAll = () => {
    setSelectedNos(visibleShots.value.map((shot) => shot.no));
    timeline.anchorNo = visibleShots.value[0]?.no || '';
  };
  const clearSelection = () => {
    setSelectedNos([]);
    timeline.anchorNo = '';
    timeline.activeAttentionNo = '';
  };

  const saveMetaChange = async (successText) => {
    timeline.busy = true;
    try {
      await helpers.saveScriptNow();
      message.success(successText);
      return true;
    } catch (error) {
      message.error(`保存失败：${error?.message || error}`);
      return false;
    } finally {
      timeline.busy = false;
    }
  };

  const setShotDuration = async (shot, value) => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    if (isShotLocked(shot)) return message.warning('镜头已锁定，请先解锁');
    const seconds = normalizeShotTimelineDuration(value, defaultDuration(), maxDuration());
    const meta = shotMeta(shot, { create: true });
    if (Number(meta.duration) === seconds) return true;
    meta.duration = seconds;
    meta.updatedAt = new Date().toISOString();
    return saveMetaChange(`镜头 ${shot.no} 时长已设为 ${seconds} 秒`);
  };

  const setReviewStatus = async () => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    if (!selectedShots.value.length) return message.warning('请先选择镜头');
    const status = normalizeShotReviewStatus(timeline.reviewStatus);
    const storyboard = currentStoryboard();
    const map = ensureShotMeta(storyboard);
    const updatedAt = new Date().toISOString();
    for (const shot of selectedShots.value) {
      const key = shotNoKey(shot.no);
      map[key] = { ...(map[key] || {}), reviewStatus: status, updatedAt };
    }
    await saveMetaChange(`已标记为“${SHOT_REVIEW_LABELS[status]}”`);
  };

  const toggleShotAttention = async (shot) => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    const no = shotNoKey(shot?.no);
    if (!no) return false;
    const meta = shotMeta(shot, { create: true });
    const marked = meta.needsAttention !== true;
    meta.needsAttention = marked;
    meta.updatedAt = new Date().toISOString();
    if (marked) timeline.activeAttentionNo = no;
    else if (shotNoKey(timeline.activeAttentionNo) === no) {
      timeline.activeAttentionNo = attentionShots.value[0]?.no || '';
    }
    return saveMetaChange(marked ? `镜头 ${no} 已加入待处理` : `镜头 ${no} 已移出待处理`);
  };

  const markShotAttentionFromInput = async () => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    const { numbers, invalidTokens } = parseShotNumberInput(timeline.attentionInput);
    if (!numbers.length) {
      if (invalidTokens.length) return message.warning(`无法识别镜号：${invalidTokens.join('、')}，请输入如 13,19,18`);
      return message.warning('请输入要加入待处理的镜号，例如 13,19,18');
    }
    const shots = currentShots();
    const shotMap = new Map(shots.map((shot) => [shotNoKey(shot?.no), shot]));
    const matched = [];
    const missing = [];
    const changed = [];
    const updatedAt = new Date().toISOString();
    for (const no of numbers) {
      const shot = shotMap.get(no);
      if (!shot) {
        missing.push(no);
        continue;
      }
      matched.push(no);
      const meta = shotMeta(shot, { create: true });
      if (meta.needsAttention !== true) {
        meta.needsAttention = true;
        meta.updatedAt = updatedAt;
        changed.push(no);
      }
    }
    if (!matched.length) {
      const suffix = invalidTokens.length ? `；无法识别：${invalidTokens.join('、')}` : '';
      return message.warning(`本集没有找到这些镜号：${numbers.join('、')}${suffix}`);
    }
    timeline.attentionFilter = 'attention';
    timeline.activeAttentionNo = matched[0] || '';
    const details = [];
    if (missing.length) details.push(`未找到 ${missing.join('、')}`);
    if (invalidTokens.length) details.push(`无法识别 ${invalidTokens.join('、')}`);
    const suffix = details.length ? `（${details.join('；')}）` : '';
    if (!changed.length) {
      const saved = await saveMetaChange(`这些镜头已经在待处理列表中${suffix}`);
      if (saved) timeline.attentionInput = '';
      return saved;
    }
    const saved = await saveMetaChange(`已将 ${changed.length} 个镜头加入待处理${suffix}`);
    if (saved) timeline.attentionInput = '';
    return saved;
  };

  const setAttentionFilter = (value) => {
    timeline.attentionFilter = ['attention', 'missing-video'].includes(value) ? value : 'all';
    const visible = new Set(visibleShots.value.map((shot) => shotNoKey(shot.no)));
    setSelectedNos(validSelectedNos().filter((no) => visible.has(no)));
    if (timeline.attentionFilter === 'attention' && !attentionShots.value.length) {
      timeline.activeAttentionNo = '';
    }
  };

  const setLocked = async (locked) => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    if (!selectedShots.value.length) return message.warning('请先选择镜头');
    if (refs.shotEdit.key) return message.warning('请先保存或取消当前正在编辑的镜头');
    const storyboard = currentStoryboard();
    const map = ensureShotMeta(storyboard);
    const updatedAt = new Date().toISOString();
    for (const shot of selectedShots.value) {
      const key = shotNoKey(shot.no);
      const nextMeta = { ...(map[key] || {}), locked: !!locked, updatedAt };
      if (locked) {
        nextMeta.lockSnapshot = createShotLockSnapshot({
          shot,
          tags: helpers.shotElementTags?.(shot) || [],
        });
      } else {
        delete nextMeta.lockSnapshot;
      }
      map[key] = nextMeta;
    }
    await saveMetaChange(locked ? '已锁定所选镜头及当前元素' : '已解锁所选镜头');
  };

  const toggleShotLocked = async (shot) => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    if (refs.shotEdit.key) return message.warning('请先保存或取消当前正在编辑的镜头');
    const no = shotNoKey(shot?.no);
    if (!no) return false;
    const meta = shotMeta(shot, { create: true });
    const locked = meta.locked !== true;
    meta.locked = locked;
    meta.updatedAt = new Date().toISOString();
    if (locked) {
      meta.lockSnapshot = createShotLockSnapshot({
        shot,
        tags: helpers.shotElementTags?.(shot) || [],
      });
    } else {
      delete meta.lockSnapshot;
    }
    return saveMetaChange(locked ? `镜头 ${no} 及当前元素已锁定` : `镜头 ${no} 已解锁`);
  };

  const lockedShotWouldMove = (mapping) => {
    const storyboard = currentStoryboard();
    const meta = storyboard?.shotMeta || {};
    return Object.entries(meta).some(([oldNo, value]) => (
      value?.locked === true && mapping[shotNoKey(oldNo)] && mapping[shotNoKey(oldNo)] !== shotNoKey(oldNo)
    ));
  };

  const remapVideoQueue = (mapping) => {
    for (let index = refs.videoQueue.items.length - 1; index >= 0; index -= 1) {
      const item = refs.videoQueue.items[index];
      if (String(item.episodeId ?? refs.episodeId.value) !== String(refs.episodeId.value)) continue;
      const nextNo = mapping[shotNoKey(item.no)];
      if (!nextNo) refs.videoQueue.items.splice(index, 1);
      else item.no = String(nextNo);
    }
  };

  const applyStoryboardOrderState = (storyboard, orderedShots, mapping) => {
    storyboard.content = serializeShotList(orderedShots);
    storyboard.manualTags = remapShotRecord(storyboard.manualTags, mapping);
    storyboard.excludedTags = remapShotRecord(storyboard.excludedTags, mapping);
    storyboard.shotVideos = remapShotRecord(storyboard.shotVideos, mapping, helpers.shiftShotVideoMeta);
    storyboard.shotMeta = remapShotRecord(storyboard.shotMeta, mapping);
    const hadOpeners = Object.keys(storyboard.openerFrames || {}).length > 0;
    storyboard.openerFrames = {};
    remapEpisodeRuntimeRecord(refs.shotVideos, refs.episodeId.value, mapping, helpers.shiftRuntimeShotVideo);
    remapEpisodeRuntimeRecord(refs.shotStatus, refs.episodeId.value, mapping);
    remapVideoQueue(mapping);
    return hadOpeners;
  };

  const remapLocalFiles = async (mapping) => {
    const result = await api.post('/api/video/shot-files/remap', {
      projectId: refs.project.value?.id,
      episodeId: refs.episodeId.value,
      mapping,
      removeUnmapped: true,
    });
    if (result?.ok === false) throw new Error(result.error || '本地视频编号同步失败');
    return result;
  };

  const applyOrder = async (orderedShots, successText = '镜头顺序已更新') => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    const storyboard = currentStoryboard();
    if (!storyboard || !orderedShots.length) return false;
    if (refs.shotEdit.key) return message.warning('请先保存或取消当前正在编辑的镜头');
    const mapping = shotNumberMapping(orderedShots);
    const changed = Object.entries(mapping).some(([oldNo, nextNo]) => oldNo !== nextNo);
    if (!changed) return false;
    if (lockedShotWouldMove(mapping)) return message.warning('顺序调整会移动已锁定镜头，请先解锁');
    timeline.busy = true;
    try {
      await helpers.hydratePending();
      if (helpers.hasActiveShotAtOrAfter(1)) throw new Error('当前有已提交或生成中的视频，请完成或清除追踪后再排序');
      await remapLocalFiles(mapping);
      const selectedBefore = validSelectedNos();
      const hadOpeners = applyStoryboardOrderState(storyboard, orderedShots, mapping);
      helpers.cancelShotEdit();
      setSelectedNos(selectedBefore.map((no) => mapping[no]).filter(Boolean));
      await helpers.saveScriptNow();
      if (hadOpeners) message.warning('镜头顺序已改变，原有尾帧衔接关系已清空，请重新设置');
      else message.success(successText);
      return true;
    } catch (error) {
      message.error(error?.message || String(error));
      return false;
    } finally {
      timeline.busy = false;
      timeline.dragNo = '';
      timeline.dropNo = '';
      timeline.dropAfter = false;
    }
  };

  const moveSelection = (delta) => {
    if (!selectedShots.value.length) return message.warning('请先选择镜头');
    const ordered = shiftSelectedShotBlock(currentShots(), validSelectedNos(), delta);
    return applyOrder(ordered, delta < 0 ? '所选镜头已前移' : '所选镜头已后移');
  };

  const startDrag = (shot, event) => {
    if (timeline.busy) {
      event?.preventDefault?.();
      return false;
    }
    if (isShotLocked(shot)) {
      event?.preventDefault?.();
      return message.warning('该镜头已锁定，请先解锁');
    }
    if (!isShotSelected(shot)) selectShot(shot, {});
    timeline.dragNo = shotNoKey(shot.no);
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', timeline.dragNo);
    }
    return true;
  };

  const dragOver = (shot, event) => {
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    timeline.dropNo = shotNoKey(shot?.no);
    timeline.dropAfter = !!(rect && event.clientX > rect.left + rect.width / 2);
  };

  const drop = async (shot, event) => {
    event?.preventDefault?.();
    const selected = validSelectedNos();
    if (!timeline.dragNo || !selected.length) return;
    const ordered = reorderShotBlock(currentShots(), selected, shot.no, timeline.dropAfter);
    await applyOrder(ordered);
  };

  const endDrag = () => {
    timeline.dragNo = '';
    timeline.dropNo = '';
    timeline.dropAfter = false;
  };

  const appendShotsToStoryboard = (target, sourceStoryboard, transferredShots) => {
    const targetShots = helpers.parseShots(target.content || '');
    const targetCount = targetShots.length;
    const manualTags = ensureStoryboardRecord(target, 'manualTags');
    const excludedTags = ensureStoryboardRecord(target, 'excludedTags');
    const targetMeta = ensureShotMeta(target);
    const sourceMeta = sourceStoryboard.shotMeta || {};
    const sourceManual = sourceStoryboard.manualTags || {};
    const sourceExcluded = sourceStoryboard.excludedTags || {};
    const appended = transferredShots.map((shot, index) => ({ ...shot, no: String(targetCount + index + 1) }));
    for (let index = 0; index < transferredShots.length; index += 1) {
      const sourceShot = transferredShots[index];
      const nextNo = String(targetCount + index + 1);
      const oldNo = shotNoKey(sourceShot.no);
      if (sourceManual[oldNo]) manualTags[nextNo] = copyTagList(sourceManual[oldNo]);
      if (sourceExcluded[oldNo]) excludedTags[nextNo] = copyTagList(sourceExcluded[oldNo]);
      const meta = sourceMeta[oldNo] || {};
      targetMeta[nextNo] = {
        ...meta,
        locked: false,
        needsAttention: false,
        reviewStatus: 'draft',
        copiedFrom: { episodeId: refs.episodeId.value, shotNo: oldNo },
        updatedAt: new Date().toISOString(),
      };
    }
    target.content = serializeShotList([...targetShots, ...appended]);
    return appended;
  };

  const transferSelection = async (mode = 'copy') => {
    if (timeline.busy) return message.warning('时间线正在处理，请稍候');
    const shots = selectedShots.value.slice();
    if (!shots.length) return message.warning('请先选择镜头');
    if (refs.shotEdit.key) return message.warning('请先保存或取消当前正在编辑的镜头');
    const targetEpisodeId = timeline.targetEpisodeId;
    if (targetEpisodeId === '' || targetEpisodeId == null) return message.warning('请选择目标剧集');
    if (String(targetEpisodeId) === String(refs.episodeId.value)) return message.warning('目标剧集不能是当前剧集');
    const sourceStoryboard = currentStoryboard();
    if (!sourceStoryboard) return message.warning('当前剧集没有可操作的分镜');
    const targetEpisode = (refs.scriptState.episodes || []).find((episode) => String(episode.id) === String(targetEpisodeId));
    if (!targetEpisode) return message.warning('目标剧集不存在');
    if (mode === 'move' && shots.length >= currentShots().length) return message.warning('移动后当前集至少要保留一个镜头');
    if (mode === 'move' && shots.some(isShotLocked)) return message.warning('所选镜头中包含已锁定镜头，请先解锁');

    timeline.busy = true;
    try {
      const confirmed = await messageBox.confirm(
        `${mode === 'move' ? '移动' : '复制'} ${shots.length} 个镜头到第 ${targetEpisode.id} 集？生成的视频不会跨集复制。`,
        mode === 'move' ? '移动镜头' : '复制镜头',
        { type: 'warning', confirmButtonText: mode === 'move' ? '移动' : '复制', cancelButtonText: '取消' },
      ).then(() => true).catch(() => false);
      if (!confirmed) return false;

      let remaining = null;
      let mapping = null;
      if (mode === 'move') {
        await helpers.hydratePending();
        if (helpers.hasActiveShotAtOrAfter(1)) throw new Error('当前有已提交或生成中的视频，请完成或清除追踪后再移动');
        const selected = new Set(shots.map((shot) => shotNoKey(shot.no)));
        remaining = currentShots().filter((shot) => !selected.has(shotNoKey(shot.no)));
        mapping = shotNumberMapping(remaining);
        if (lockedShotWouldMove(mapping)) throw new Error('移动会改变已锁定镜头的位置，请先解锁');
        await remapLocalFiles(mapping);
      }

      let target = helpers.findStoryboard(targetEpisode.id);
      if (!target) {
        target = {
          episodeId: targetEpisode.id,
          episodeTitle: targetEpisode.title || `第${targetEpisode.id}集`,
          content: '',
          mode: 'normal',
          manualTags: {},
          excludedTags: {},
          shotVideos: {},
          openerFrames: {},
          shotMeta: {},
        };
        refs.scriptState.storyboards.push(target);
      }
      appendShotsToStoryboard(target, sourceStoryboard, shots);

      if (mode === 'move') {
        const hadOpeners = applyStoryboardOrderState(sourceStoryboard, remaining, mapping);
        if (hadOpeners) message.warning('移动镜头后当前集的尾帧衔接关系已清空');
      }

      await helpers.saveScriptNow();
      clearSelection();
      message.success(`已${mode === 'move' ? '移动' : '复制'}到第 ${targetEpisode.id} 集`);
      return true;
    } catch (error) {
      message.error(error?.message || String(error));
      return false;
    } finally {
      timeline.busy = false;
    }
  };

  const focusShot = (shot, { block = 'center' } = {}) => {
    const id = shotCardDomId(shot);
    activateShotCardWindow(shot);
    const target = globals.document?.getElementById(id);
    if (target) {
      target.scrollIntoView?.({ behavior: 'smooth', block });
      return;
    }
    const index = visibleShots.value.findIndex((item) => shotNoKey(item?.no) === shotNoKey(shot?.no));
    if (index < 0) return;
    timeline.renderLimit = Math.max(timeline.renderLimit, index + 1);
    helpers.nextTick?.(() => globals.document?.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block }));
  };

  // 分镜卡片跟着窗口整体滚动，所以"回到顶部/底部"是窗口级动作。
  // 顶部就是页面最顶（导演台/时间线那一片），不是第一张卡片——用户想看的是整页开头。
  // 底部要先把懒加载窗口拉满，否则只会滚到当前已挂载的最后一张卡片。
  const jumpToShotListEdge = (edge = 'top') => {
    const win = globals.window || globalThis.window;
    if (edge === 'top') {
      win?.scrollTo?.({ top: 0, behavior: 'smooth' });
      return true;
    }
    if (!visibleShots.value.length) {
      const doc = globals.document;
      const height = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0;
      win?.scrollTo?.({ top: height, behavior: 'smooth' });
      return true;
    }
    const last = visibleShots.value[visibleShots.value.length - 1];
    timeline.renderLimit = Math.max(Number(timeline.renderLimit) || 0, visibleShots.value.length);
    helpers.nextTick?.(() => focusShot(last, { block: 'end' }));
    return true;
  };

  const jumpToShotNo = (value) => {
    const key = shotNoKey(value);
    if (!key) return message.warning('请输入要跳转的镜号');
    const shot = visibleShots.value.find((item) => shotNoKey(item?.no) === key);
    if (!shot) {
      const filterWarning = timeline.attentionFilter === 'attention'
        ? `待处理列表里没有镜头 ${key}，可切到「全部」再跳转`
        : `未生成列表里没有镜头 ${key}，可切到「全部」再跳转`;
      return message.warning(
        timeline.attentionFilter === 'all' ? `本集没有镜头 ${key}` : filterWarning,
      );
    }
    setSelectedNos([key]);
    timeline.anchorNo = key;
    focusShot(shot);
    return true;
  };

  const jumpToShotNoInput = () => {
    const done = jumpToShotNo(timeline.jumpNo);
    if (done === true) timeline.jumpNo = '';
    return done;
  };

  // 舵轮中间的数字既是"共几个镜头"的读数，也是就地跳转入口：
  // 点一下变输入框，省得为了跳号把视线拉回上方工具栏。
  const dockJumpApply = () => {
    const done = jumpToShotNo(timeline.dockJumpNo);
    if (done === true) {
      timeline.dockJumpNo = '';
      timeline.dockJumpOpen = false;
    }
    return done;
  };

  const toggleDockJump = () => {
    if (!visibleShots.value.length) return false;
    timeline.dockJumpOpen = !timeline.dockJumpOpen;
    timeline.dockJumpNo = '';
    return timeline.dockJumpOpen;
  };

  const closeDockJump = () => {
    timeline.dockJumpOpen = false;
    timeline.dockJumpNo = '';
    return true;
  };

  // 相对当前视口中央最近的那张卡片翻页，这样"上一张/下一张"跟着用户眼睛走，
  // 而不是跟着选中态走（选中的卡片可能早就滚出屏幕了）。
  const shotNearestViewportCenter = () => {
    const doc = globals.document;
    const win = globals.window || globalThis.window;
    if (!doc || !win) return null;
    const middle = (Number(win.innerHeight) || 0) / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const shot of visibleShots.value) {
      const rect = doc.getElementById(shotCardDomId(shot))?.getBoundingClientRect?.();
      if (!rect) continue;
      const distance = Math.abs(rect.top + rect.height / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = shot;
      }
    }
    return best;
  };

  const stepShotCard = (delta = 1) => {
    const shots = visibleShots.value;
    if (!shots.length) return false;
    const anchor = shotNearestViewportCenter();
    const anchorIndex = anchor
      ? shots.findIndex((item) => shotNoKey(item?.no) === shotNoKey(anchor.no))
      : -1;
    const nextIndex = Math.min(shots.length - 1, Math.max(0, (anchorIndex < 0 ? 0 : anchorIndex) + (delta < 0 ? -1 : 1)));
    if (anchorIndex === nextIndex) {
      return message.info(delta < 0 ? '已经是第一个镜头' : '已经是最后一个镜头');
    }
    const target = shots[nextIndex];
    setSelectedNos([shotNoKey(target.no)]);
    timeline.anchorNo = shotNoKey(target.no);
    focusShot(target);
    return true;
  };

  const focusAttentionShot = (shot) => {
    if (!shot || !isShotAttentionMarked(shot)) return false;
    const no = shotNoKey(shot.no);
    timeline.activeAttentionNo = no;
    setSelectedNos([no]);
    timeline.anchorNo = no;
    helpers.nextTick?.(() => focusShot(shot));
    return true;
  };

  const moveAttentionFocus = (delta = 1) => {
    const shots = attentionShots.value;
    if (!shots.length) return message.info('当前没有待处理视频');
    const activeNo = shotNoKey(timeline.activeAttentionNo);
    const currentIndex = shots.findIndex((shot) => shotNoKey(shot.no) === activeNo);
    const nextIndex = currentIndex < 0
      ? (delta < 0 ? shots.length - 1 : 0)
      : (currentIndex + (delta < 0 ? -1 : 1) + shots.length) % shots.length;
    return focusAttentionShot(shots[nextIndex]);
  };

  const onTimelineWheel = (event) => {
    const deltaX = Number(event?.deltaX) || 0;
    const deltaY = Number(event?.deltaY) || 0;
    const scroller = event?.currentTarget;
    if (!scroller || (!deltaX && !deltaY)) return;
    if (event.shiftKey && deltaY) {
      event.preventDefault?.();
      scroller.scrollLeft += deltaY;
      return;
    }
    if (Math.abs(deltaX) > Math.abs(deltaY)) return;
    const win = globals.window || globalThis.window;
    if (!win?.scrollBy || !deltaY) return;
    event.preventDefault?.();
    win.scrollBy({ top: deltaY, left: 0, behavior: 'auto' });
  };

  const onKeydown = (event) => {
    const tagName = String(event?.target?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tagName)) return;
    if (timeline.busy && event.key !== 'Escape') return;
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSelection();
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (String(event.key).toLowerCase() === 'l' && selectedShots.value.length) {
      event.preventDefault();
      setLocked(!selectedShots.value.every(isShotLocked));
      return;
    }
    if (event.key === 'Enter' && selectedShots.value[0]) {
      event.preventDefault();
      focusShot(selectedShots.value[0]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      jumpToShotListEdge('top');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      jumpToShotListEdge('bottom');
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      stepShotCard(-1);
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      stepShotCard(1);
    }
  };

  return {
    shotTimelineReviewOptions: SHOT_REVIEW_OPTIONS,
    shotCardDensityOptions: SHOT_CARD_DENSITY_OPTIONS,
    setShotCardDensity: setCardDensity,
    shotCardDensityClass: computed(() => `density-${normalizeShotCardDensity(timeline.cardDensity)}`),
    shotTimelineAttentionShots: attentionShots,
    shotTimelineAttentionCount: computed(() => attentionShots.value.length),
    shotTimelineMissingVideoShots: missingVideoShots,
    shotTimelineMissingVideoCount: computed(() => missingVideoShots.value.length),
    shotTimelineVisibleShots: visibleShots,
    shotTimelineRenderedShots: renderedShots,
    shotTimelineHasMoreRenderedShots: hasMoreRenderedShots,
    isShotCardWindowActive,
    shotCardWindowStyle,
    shotCardWindowBinding,
    loadMoreShotCards,
    resetShotRenderWindow,
    shotTimelineSelectedShots: selectedShots,
    shotTimelineSelectedCount: selectedCount,
    shotTimelineGroups: groups,
    shotTimelineTotalDuration: totalDuration,
    shotTimelineTargetEpisodes: targetEpisodes,
    shotTimelineDuration: shotDuration,
    setShotTimelineDuration: setShotDuration,
    shotTimelineStyle: shotStyle,
    shotTimelineCardDomId: shotCardDomId,
    shotTimelineVideoUrl: shotVideoUrl,
    shotTimelineVideoStatus: shotVideoStatus,
    shotTimelineVideoStatusLabel: shotVideoStatusLabel,
    shotTimelineElementPreview: shotElementPreview,
    shotTimelineAudioCount: shotAudioCount,
    openShotTimelineVideo: openVideoPreview,
    closeShotTimelineVideo: closeVideoPreview,
    fullscreenShotTimelineVideo: fullscreenVideoPreview,
    isShotTimelineSelected: isShotSelected,
    isShotLocked,
    isShotAttentionMarked,
    shotReviewStatus,
    shotReviewLabel,
    shotReviewType,
    selectShotInTimeline: selectShot,
    selectAllShotsInTimeline: selectAll,
    clearShotTimelineSelection: clearSelection,
    applyShotTimelineReviewStatus: setReviewStatus,
    toggleShotAttention,
    markShotAttentionFromInput,
    setShotTimelineAttentionFilter: setAttentionFilter,
    focusShotAttention: focusAttentionShot,
    previousShotAttention: () => moveAttentionFocus(-1),
    nextShotAttention: () => moveAttentionFocus(1),
    lockSelectedTimelineShots: () => setLocked(true),
    unlockSelectedTimelineShots: () => setLocked(false),
    toggleShotLocked,
    moveSelectedTimelineShots: moveSelection,
    startShotTimelineDrag: startDrag,
    dragOverShotTimeline: dragOver,
    dropShotTimeline: drop,
    endShotTimelineDrag: endDrag,
    copySelectedShotsToEpisode: () => transferSelection('copy'),
    moveSelectedShotsToEpisode: () => transferSelection('move'),
    focusShotFromTimeline: focusShot,
    jumpToShotListEdge,
    scrollShotListToTop: () => jumpToShotListEdge('top'),
    scrollShotListToBottom: () => jumpToShotListEdge('bottom'),
    jumpToShotNo,
    jumpToShotNoInput,
    dockJumpApply,
    toggleDockJump,
    closeDockJump,
    previousShotCard: () => stepShotCard(-1),
    nextShotCard: () => stepShotCard(1),
    shotNearestViewportCenter,
    onShotTimelineWheel: onTimelineWheel,
    onShotTimelineKeydown: onKeydown,
  };
}
