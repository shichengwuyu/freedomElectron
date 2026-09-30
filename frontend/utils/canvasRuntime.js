import { allowedVideoResolution, videoApiModelOptionsForConfig, videoDurationRangeFor, videoResolutionOptionsFor } from './video/core.js';
import { characterVoiceAudioUrl, elementImageUrl, outfitImageUrl, variantImageUrl } from './imageState.js';

const COLORS = ['gold', 'cyan', 'violet', 'rose'];
const NODE_PRESETS = {
  note: { title: '灵感便签', content: '', color: 'gold', width: 224, height: 142 },
  infer: { title: 'AI 推理卡', content: '', color: 'cyan', width: 310, height: 214 },
  image: { title: '图片', content: '', color: 'violet', width: 500, height: 282 },
  video: { title: '视频', content: '', color: 'rose', width: 500, height: 282 },
  audio: { title: '音频', content: '', color: 'gold', width: 500, height: 196 },
  section: { title: '创作分区', content: '为一组相关节点建立视觉边界', color: 'gold', width: 430, height: 270 },
};

const CANVAS_MEDIA_ACCEPT = {
  image: 'image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif',
  video: 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v',
  audio: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/flac,audio/webm,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm',
};
const CANVAS_ELEMENT_LABELS = {
  character: '人物', group: '群像', scene: '场景', prop: '道具', effect: '特效', creature: '妖兽',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeCanvasMediaUrl(value) {
  const url = String(value || '').trim();
  if (!url.startsWith('/api/canvas/media/') || /[?&]v=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
}

export function canvasMediaDirectoryId(item, activeProject = null) {
  const mediaUrl = String(item?.mediaUrl || '').trim();
  if (mediaUrl) {
    try {
      const pathname = new URL(mediaUrl, 'http://canvas.local').pathname;
      const match = pathname.match(/^\/api\/canvas\/media\/([^/]+)\//i);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch { /* Fall back to project ownership for non-canvas media URLs. */ }
  }
  const ownerId = String(item?.projectId || '').trim();
  if (ownerId) return ownerId;
  if (Array.isArray(item?.nodes)) return String(item?.id || '').trim();
  return String(activeProject?.id || '').trim();
}

function projectStamp() {
  return new Date().toISOString();
}

function canvasMediaKind(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const extension = String(file?.name || '').toLowerCase().split('.').pop();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(extension)) return 'image';
  if (['mp4', 'mov', 'm4v'].includes(extension)) return 'video';
  if (extension === 'webm') return mime.startsWith('audio/') ? 'audio' : 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(extension)) return 'audio';
  return '';
}

function canvasFileTitle(file, fallback) {
  return String(file?.name || '').replace(/\.[^.]+$/, '').trim().slice(0, 48) || fallback;
}

function normalizeCanvasMention(value, index = 0) {
  const kind = ['image', 'video', 'audio', 'text'].includes(value?.kind) ? value.kind : 'text';
  const label = String(value?.label || value?.displayName || value?.name || '').trim().slice(0, 80);
  if (!label) return null;
  return {
    id: String(value?.id || `mention:${kind}:${label}:${index}`),
    kind,
    label,
    displayName: label,
    mediaUrl: String(value?.mediaUrl || ''),
    description: String(value?.description || '').trim().slice(0, 3000),
    referenceInstruction: String(value?.referenceInstruction || '').trim().slice(0, 500),
    source: String(value?.source || ''),
    sourceNodeId: String(value?.sourceNodeId || ''),
    projectId: String(value?.projectId || ''),
    category: String(value?.category || ''),
  };
}

function createProjectRecord(name, index = 1) {
  const stamp = projectStamp();
  return {
    id: `canvas:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || '').trim() || `未命名画布 ${index}`,
    description: '一张等待想象力发生的空白画布',
    createdAt: stamp,
    updatedAt: stamp,
    zoom: 0.86,
    panX: 0,
    panY: 20,
    nodes: [],
    edges: [],
  };
}

function normalizeNode(node, index = 0) {
  const brokenText = (value) => { const text = String(value || '').trim(); return text.length >= 2 && /^[?\s]+$/.test(text); };
  const legacyType = node?.type === 'text' ? 'infer' : (node?.type === 'visual' ? 'image' : node?.type);
  const type = NODE_PRESETS[legacyType] ? legacyType : 'note';
  const preset = NODE_PRESETS[type];
  return {
    id: String(node?.id || `node:${Date.now()}:${index}`),
    type,
    title: brokenText(node?.title) ? preset.title : String(node?.title || preset.title),
    content: brokenText(node?.content) ? preset.content : String(node?.content || ''),
    result: String(node?.result || ''),
    mediaUrl: normalizeCanvasMediaUrl(node?.mediaUrl),
    mediaError: false,
    jobId: String(node?.jobId || ''),
    status: ['idle', 'running', 'queued', 'done', 'error'].includes(node?.status) ? node.status : 'idle',
    progress: number(node?.progress),
    message: String(node?.message || ''),
    error: String(node?.error || ''),
    ratio: String(node?.ratio || (type === 'video' || type === 'image' ? '16:9' : '')),
    duration: clamp(Math.round(number(node?.duration, 5)), 5, 15),
    provider: String(node?.provider || ''),
    channelId: String(node?.channelId || ''),
    model: String(node?.model || ''),
    baseUrl: String(node?.baseUrl || ''),
    resolution: String(node?.resolution || ''),
    composerMode: ['text', 'image', 'reference'].includes(node?.composerMode) ? node.composerMode : 'text',
    mentions: (Array.isArray(node?.mentions) ? node.mentions : []).map(normalizeCanvasMention).filter(Boolean).slice(0, 30),
    color: COLORS.includes(node?.color) ? node.color : preset.color,
    x: number(node?.x),
    y: number(node?.y),
    width: ['image', 'video'].includes(type) ? Math.max(420, number(node?.width, preset.width)) : type === 'audio' ? Math.max(420, number(node?.width, preset.width)) : number(node?.width, preset.width),
    height: ['image', 'video'].includes(type) ? Math.max(236, number(node?.height, preset.height)) : type === 'audio' ? Math.max(176, number(node?.height, preset.height)) : number(node?.height, preset.height),
  };
}

function normalizeProject(project, index = 0) {
  const fallback = createProjectRecord(project?.name, index + 1);
  const nodes = Array.isArray(project?.nodes)
    ? project.nodes.filter((node) => node?.type !== 'director').map(normalizeNode)
    : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(project?.edges) ? project.edges
    .filter((edge) => edge?.from && edge?.to && nodeIds.has(String(edge.from)) && nodeIds.has(String(edge.to)))
    .map((edge, edgeIndex) => ({
      id: String(edge.id || `edge:${edgeIndex}`), from: String(edge.from), to: String(edge.to), tone: COLORS.includes(edge.tone) ? edge.tone : 'gold',
    })) : [];
  return {
    ...fallback,
    ...project,
    id: String(project?.id || fallback.id),
    name: String(project?.name || fallback.name),
    description: String(project?.description || fallback.description),
    zoom: clamp(number(project?.zoom, .86), .3, 1.8),
    panX: number(project?.panX),
    panY: number(project?.panY, 20),
    mediaCount: Math.max(0, Math.floor(number(project?.mediaCount))),
    storageBytes: Math.max(0, Math.floor(number(project?.storageBytes))),
    nodes,
    edges,
  };
}

export function createCanvasRuntime({ api, config = {}, options = {}, desktop = {}, vue = {}, globals = {}, message = {} } = {}) {
  const { reactive, ref, computed, nextTick } = vue;
  const win = globals.window || window;
  const doc = globals.document || document;
  const STORAGE_KEY = 'gg-canvas-projects:v1';
  const canvasPollingJobs = new Set();
  let canvasDiskLoaded = false;
  let canvasSaveTimer = null;
  let canvasViewportSaveTimer = null;
  let canvasSaveVersion = 0;
  let canvasSaveChain = Promise.resolve();
  let canvasDragDepth = 0;
  let canvasDownloadBusy = false;
  let canvasOpenFolderBusy = false;

  const canvasViewportRef = ref(null);
  const canvasFramePickerVideo = ref(null);
  const canvasLibrary = reactive({
    screen: 'library',
    projects: [],
    activeId: '',
    newName: '',
    search: '',
  });
  const canvasState = reactive({
    zoom: .86,
    panX: 0,
    panY: 20,
    selectedId: '',
    showMinimap: true,
    showHelp: true,
    interaction: null,
    moved: false,
    connectingFrom: '',
    connectionDraft: null,
    connectionTargetId: '',
    contextMenu: { open: false, x: 0, y: 0, worldX: 0, worldY: 0 },
    nodePaletteOpen: false,
    dropActive: false,
    quickConnectMenu: { open: false, fromId: '', x: 0, y: 0 },
    spacePressed: false,
  });
  const canvasDock = reactive({
    panel: '',
    assetScope: 'current',
    assetFilter: 'all',
    assetSearch: '',
    timelinePlaying: false,
    timelinePlayhead: 0,
  });
  const canvasMention = reactive({
    open: false,
    nodeId: '',
    query: '',
    start: 0,
    end: 0,
    activeIndex: 0,
  });
  const canvasFramePicker = reactive({
    visible: false,
    sourceNodeId: '',
    videoUrl: '',
    currentTime: 0,
    duration: 0,
    saving: false,
  });
  const canvasAgent = reactive({
    open: false,
    input: '',
    running: false,
    messages: [],
    lastActions: [],
    error: '',
  });
  const canvasHistoryByProject = new Map();
  const canvasImageCapabilities = reactive({});
  const canvasImageCapabilityLoads = new Map();
  const requestFrame = typeof win.requestAnimationFrame === 'function'
    ? win.requestAnimationFrame.bind(win)
    : (callback) => win.setTimeout(callback, 16);
  const cancelFrame = typeof win.cancelAnimationFrame === 'function'
    ? win.cancelAnimationFrame.bind(win)
    : win.clearTimeout.bind(win);
  let canvasPointerFrame = 0;
  let canvasPendingPointer = null;
  let canvasWheelFrame = 0;
  let canvasPendingWheel = null;
  let canvasTimelineFrame = 0;
  let canvasTimelineStartedAt = 0;
  let canvasTimelineStartedFrom = 0;

  function canvasProjectsSnapshot() {
    return JSON.parse(JSON.stringify(canvasLibrary.projects));
  }

  function readCanvasProjectsCache() {
    try {
      const saved = JSON.parse(win.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved.map(normalizeProject) : [];
    } catch (error) {
      console.warn('读取画布本地缓存失败', error);
      return [];
    }
  }

  function writeCanvasProjectsCache(projects = canvasLibrary.projects) {
    try {
      win.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      return true;
    } catch (error) {
      console.warn('保存画布本地缓存失败', error);
      message.warning?.('画布内容较多，浏览器缓存空间可能已满');
      return false;
    }
  }

  function mergeCanvasProjectSources(diskProjects, cachedProjects) {
    const merged = new Map();
    for (const project of [...diskProjects, ...cachedProjects]) {
      const normalized = normalizeProject(project);
      const existing = merged.get(normalized.id);
      if (!existing || String(normalized.updatedAt || '') > String(existing.updatedAt || '')) merged.set(normalized.id, normalized);
    }
    return [...merged.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function persistCanvasProjectsToDisk(projects, version) {
    if (!api) return Promise.resolve();
    canvasSaveChain = canvasSaveChain
      .catch(() => {})
      .then(() => api.post('/api/canvas/projects', { projects }))
      .then(() => { if (version === canvasSaveVersion) canvasDiskLoaded = true; })
      .catch((error) => console.warn('保存画布到本地磁盘失败', error));
    return canvasSaveChain;
  }

  function scheduleCanvasDiskSave(projects, version) {
    if (!api) return;
    win.clearTimeout(canvasSaveTimer);
    canvasSaveTimer = win.setTimeout(() => persistCanvasProjectsToDisk(projects, version), 180);
  }

  function saveCanvasProjects({ immediateDisk = false } = {}) {
    const projects = canvasProjectsSnapshot();
    writeCanvasProjectsCache(projects);
    const version = ++canvasSaveVersion;
    if (!api) return;
    if (immediateDisk) {
      win.clearTimeout(canvasSaveTimer);
      void persistCanvasProjectsToDisk(projects, version);
      return;
    }
    scheduleCanvasDiskSave(projects, version);
  }

  async function loadCanvasProjects() {
    const cachedProjects = readCanvasProjectsCache();
    canvasLibrary.projects.splice(0, canvasLibrary.projects.length, ...cachedProjects);
    if (!api) {
      canvasOpenDirectLink();
      return;
    }
    try {
      const response = await api.get('/api/canvas/projects');
      const diskProjects = Array.isArray(response?.projects) ? response.projects.map(normalizeProject) : [];
      const projects = mergeCanvasProjectSources(diskProjects, [...cachedProjects, ...canvasLibrary.projects]);
      canvasLibrary.projects.splice(0, canvasLibrary.projects.length, ...projects);
      canvasDiskLoaded = true;
      writeCanvasProjectsCache(projects);
      if (JSON.stringify(projects) !== JSON.stringify(diskProjects)) saveCanvasProjects({ immediateDisk: true });
    } catch (error) {
      console.warn('读取画布磁盘存储失败，继续使用浏览器缓存', error);
    }
    canvasOpenDirectLink();
  }

  function canvasOpenDirectLink() {
    const params = new URLSearchParams(win.location?.search || '');
    const canvasId = String(params.get('canvas') || '');
    if (!canvasId || !canvasLibrary.projects.some((project) => project.id === canvasId)) return false;
    canvasOpenProject(canvasId);
    const nodeId = String(params.get('node') || '');
    if (nodeId && canvasNodes.value.some((node) => node.id === nodeId)) canvasState.selectedId = nodeId;
    const dockPanel = String(params.get('dock') || '');
    if (['assets', 'timeline', 'history'].includes(dockPanel)) {
      canvasDock.panel = dockPanel;
      if (dockPanel === 'timeline') canvasState.selectedId = '';
    }
    return true;
  }

  function flushCanvasProjectsOnExit() {
    const projects = canvasProjectsSnapshot();
    writeCanvasProjectsCache(projects);
    try {
      const payload = new Blob([JSON.stringify({ projects })], { type: 'application/json' });
      win.navigator?.sendBeacon?.('/api/canvas/projects', payload);
    } catch { /* localStorage cache remains available */ }
  }

  win.addEventListener?.('pagehide', flushCanvasProjectsOnExit);

  const canvasActiveProject = computed(() => canvasLibrary.projects.find((project) => project.id === canvasLibrary.activeId) || null);
  const canvasFilteredProjects = computed(() => {
    const query = canvasLibrary.search.trim().toLowerCase();
    return [...canvasLibrary.projects]
      .filter((project) => !query || `${project.name}\n${project.description}`.toLowerCase().includes(query))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  });
  const canvasNodes = computed(() => canvasActiveProject.value?.nodes || []);
  const canvasEdges = computed(() => canvasActiveProject.value?.edges || []);
  const canvasSelectedNode = computed(() => canvasNodes.value.find((node) => node.id === canvasState.selectedId) || null);
  function canvasElementDescription(element) {
    return [
      element?.description, element?.desc, element?.identity, element?.appearance, element?.body,
      element?.hair, element?.clothing, element?.makeupAccessories, element?.atmosphere,
    ].map((value) => String(value || '').trim()).filter(Boolean).join('；').slice(0, 3000);
  }

  function canvasAllMentionCandidates() {
    const targetId = canvasMention.nodeId;
    const candidates = canvasNodes.value.filter((node) => node.id !== targetId).map((node) => ({
      id: `canvas:${canvasActiveProject.value?.id || ''}:${node.id}`,
      kind: ['image', 'video', 'audio'].includes(node.type) ? node.type : 'text',
      label: node.title,
      displayName: node.title,
      mediaUrl: node.mediaUrl || '',
      description: String(node.type === 'infer' ? (node.result || node.content) : node.content || '').trim(),
      referenceInstruction: `${node.title}${node.type === 'audio' ? '的声音参考' : node.type === 'video' ? '的视频参考' : node.type === 'image' ? '的视觉参考' : '的文字设定'}`,
      source: 'canvas',
      sourceNodeId: node.id,
      category: '画布节点',
    }));

    const project = options.getProject?.();
    const elements = project?.elements || {};
    for (const [category, categoryLabel] of Object.entries(CANVAS_ELEMENT_LABELS)) {
      for (const [index, element] of (elements[category] || []).entries()) {
        const label = String(element.alias || element.name || '').trim();
        if (!label) continue;
        const baseId = `element:${project.id}:${category}:${index}`;
        candidates.push({
          id: baseId,
          kind: element.hasImage ? 'image' : 'text',
          label,
          displayName: label,
          mediaUrl: element.hasImage ? elementImageUrl(project.id, category, element) : '',
          description: canvasElementDescription(element),
          referenceInstruction: `${label}的${categoryLabel}视觉设定参考`,
          source: 'element',
          projectId: project.id,
          category: categoryLabel,
        });
        if (category !== 'character') continue;
        for (const [variantIndex, variant] of (element.variants || []).entries()) {
          const variantName = String(variant.name || '').trim();
          if (!variantName) continue;
          candidates.push({
            id: `${baseId}:variant:${variantIndex}`,
            kind: variant.hasImage ? 'image' : 'text',
            label: `${label}·${variantName}`,
            displayName: `${label}·${variantName}`,
            mediaUrl: variant.hasImage ? variantImageUrl(project.id, element, variant) : '',
            description: canvasElementDescription({ ...element, ...variant }),
            referenceInstruction: `${label}的${variantName}形态视觉参考`,
            source: 'element', projectId: project.id, category: '人物形态',
          });
        }
        for (const [outfitIndex, outfit] of (element.outfits || []).entries()) {
          const outfitName = String(outfit.name || '').trim();
          if (!outfitName) continue;
          candidates.push({
            id: `${baseId}:outfit:${outfitIndex}`,
            kind: outfit.hasImage ? 'image' : 'text',
            label: `${label}·${outfitName}`,
            displayName: `${label}·${outfitName}`,
            mediaUrl: outfit.hasImage ? outfitImageUrl(project.id, element, outfit) : '',
            description: canvasElementDescription({ ...element, ...outfit }),
            referenceInstruction: `${label}的${outfitName}服装视觉参考`,
            source: 'element', projectId: project.id, category: '人物服装',
          });
        }
        if (element.hasVoiceAudio) candidates.push({
          id: `${baseId}:voice`,
          kind: 'audio',
          label: `${label}音色`,
          displayName: `${label}音色`,
          mediaUrl: characterVoiceAudioUrl(project.id, element),
          description: `${label}的配音与音色参考`,
          referenceInstruction: `${label}的配音/音色参考`,
          source: 'element', projectId: project.id, category: '人物音色',
        });
      }
    }
    return candidates;
  }

  const canvasMentionCandidates = computed(() => {
    const target = canvasNodes.value.find((node) => node.id === canvasMention.nodeId);
    const query = canvasMention.query.trim().toLowerCase();
    return canvasAllMentionCandidates()
      .filter((item) => target?.type !== 'image' || item.kind === 'image' || item.kind === 'text')
      .filter((item) => !query || `${item.label}\n${item.category}\n${item.description}`.toLowerCase().includes(query))
      .slice(0, 80);
  });
  const canvasAssetItems = computed(() => {
    const query = canvasDock.assetSearch.trim().toLowerCase();
    const projects = canvasDock.assetScope === 'all'
      ? canvasLibrary.projects
      : canvasLibrary.projects.filter((project) => project.id === canvasLibrary.activeId);
    return projects.flatMap((project) => project.nodes
      .filter((node) => ['image', 'video', 'audio'].includes(node.type) && node.mediaUrl)
      .map((node) => ({
        id: `${project.id}:${node.id}`,
        projectId: project.id,
        projectName: project.name,
        nodeId: node.id,
        type: node.type,
        title: node.title,
        mediaUrl: node.mediaUrl,
        duration: number(node.duration, node.type === 'image' ? 3 : 5),
        updatedAt: project.updatedAt,
      })))
      .filter((item) => canvasDock.assetFilter === 'all' || item.type === canvasDock.assetFilter)
      .filter((item) => !query || `${item.title}\n${item.projectName}`.toLowerCase().includes(query))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  });
  const canvasTimelineItems = computed(() => {
    let start = 0;
    return [...canvasNodes.value]
      .filter((node) => ['image', 'video', 'audio'].includes(node.type))
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((node) => {
        const duration = node.type === 'image' ? 3 : clamp(number(node.duration, 5), 1, 60);
        const item = { ...node, timelineStart: start, timelineDuration: duration };
        start += duration;
        return item;
      });
  });
  const canvasTimelineDuration = computed(() => canvasTimelineItems.value.reduce((total, item) => total + item.timelineDuration, 0));

  function canvasHistorySnapshot(project) {
    if (!project) return null;
    return {
      name: String(project.name || '未命名画布'),
      nodes: project.nodes.map((node) => {
        const stable = JSON.parse(JSON.stringify(node));
        delete stable.mediaError;
        delete stable.jobId;
        delete stable.progress;
        delete stable.message;
        delete stable.error;
        stable.status = stable.mediaUrl ? 'done' : 'idle';
        return stable;
      }),
      edges: JSON.parse(JSON.stringify(project.edges || [])),
    };
  }

  function canvasHistoryFingerprint(snapshot) {
    return JSON.stringify(snapshot || null);
  }

  function canvasHistoryChangeLabel(before, after) {
    if (!before) return '建立画布';
    if (after.nodes.length > before.nodes.length) return '添加节点或素材';
    if (after.nodes.length < before.nodes.length) return '删除节点';
    if (after.edges.length > before.edges.length) return '连接节点';
    if (after.edges.length < before.edges.length) return '移除连线';
    const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
    for (const node of after.nodes) {
      const previous = beforeNodes.get(node.id);
      if (!previous) continue;
      if (node.mediaUrl !== previous.mediaUrl) return '更新素材';
      if (node.x !== previous.x || node.y !== previous.y) return '移动节点';
      if (JSON.stringify(node.mentions || []) !== JSON.stringify(previous.mentions || [])) return '更新引用素材';
      if (node.title !== previous.title || node.content !== previous.content || node.result !== previous.result) return '编辑节点';
    }
    if (after.name !== before.name) return '重命名画布';
    return '更新画布';
  }

  function canvasHistoryStack(project = canvasActiveProject.value) {
    if (!project) return null;
    let stack = canvasHistoryByProject.get(project.id);
    if (!stack) {
      const current = canvasHistorySnapshot(project);
      stack = reactive({ current, undo: [], redo: [], entries: [] });
      canvasHistoryByProject.set(project.id, stack);
    }
    return stack;
  }

  function captureCanvasHistory(project = canvasActiveProject.value) {
    const stack = canvasHistoryStack(project);
    if (!project || !stack) return false;
    const next = canvasHistorySnapshot(project);
    if (canvasHistoryFingerprint(next) === canvasHistoryFingerprint(stack.current)) return false;
    const label = canvasHistoryChangeLabel(stack.current, next);
    stack.undo.push({ snapshot: stack.current, label });
    if (stack.undo.length > 40) stack.undo.shift();
    stack.current = next;
    stack.redo.splice(0);
    stack.entries.unshift({
      id: `history:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      label,
      time: projectStamp(),
      nodeCount: next.nodes.length,
      snapshot: next,
    });
    if (stack.entries.length > 30) stack.entries.length = 30;
    return true;
  }

  function applyCanvasHistorySnapshot(snapshot) {
    const project = canvasActiveProject.value;
    if (!project || !snapshot) return false;
    project.name = snapshot.name;
    project.nodes.splice(0, project.nodes.length, ...snapshot.nodes.map(normalizeNode));
    project.edges = JSON.parse(JSON.stringify(snapshot.edges || []));
    if (!project.nodes.some((node) => node.id === canvasState.selectedId)) canvasState.selectedId = '';
    project.updatedAt = projectStamp();
    saveCanvasProjects({ immediateDisk: true });
    return true;
  }

  const canvasHistoryEntries = computed(() => canvasHistoryStack()?.entries || []);
  const canvasCanUndo = computed(() => Boolean(canvasHistoryStack()?.undo.length));
  const canvasCanRedo = computed(() => Boolean(canvasHistoryStack()?.redo.length));

  function canvasUndo() {
    const stack = canvasHistoryStack();
    if (!stack?.undo.length) return false;
    const target = stack.undo.pop();
    stack.redo.push({ snapshot: stack.current, label: target.label });
    stack.current = target.snapshot;
    applyCanvasHistorySnapshot(target.snapshot);
    message.success?.(`已撤销：${target.label}`);
    return true;
  }

  function canvasRedo() {
    const stack = canvasHistoryStack();
    if (!stack?.redo.length) return false;
    const target = stack.redo.pop();
    stack.undo.push({ snapshot: stack.current, label: target.label });
    stack.current = target.snapshot;
    applyCanvasHistorySnapshot(target.snapshot);
    message.success?.(`已重做：${target.label}`);
    return true;
  }

  function canvasRestoreHistory(entry) {
    const stack = canvasHistoryStack();
    if (!stack || !entry?.snapshot) return false;
    stack.undo.push({ snapshot: stack.current, label: '恢复历史版本' });
    stack.current = JSON.parse(JSON.stringify(entry.snapshot));
    stack.redo.splice(0);
    applyCanvasHistorySnapshot(stack.current);
    message.success?.('历史版本已恢复');
    return true;
  }
  const canvasImageChannelOptions = computed(() => {
    const channels = (Array.isArray(config?.image?.channels) ? config.image.channels : [])
      .filter((item) => item?.enabled !== false && (item?.id || item?.baseUrl))
      .map((item, index) => ({
        label: String(item.name || `图片 API ${index + 1}`),
        value: item.id ? `api:${item.id}` : `api-url:${item.baseUrl}`,
      }));
    if (!channels.length && config?.image?.baseUrl) {
      channels.push({ label: '通用图片 API', value: `api-url:${config.image.baseUrl}` });
    }
    return [
      { label: '即梦 CLI', value: 'dreamina-cli' },
      { label: 'UpDream', value: 'updream' },
      { label: 'Neo', value: 'neowow' },
      { label: 'LibTV CLI', value: 'libtv-cli' },
      ...channels,
    ];
  });
  const canvasVideoProviderOptions = computed(() => (options.videoProviderOptions || [])
    .filter((item) => item.value !== 'dreamina-agent'));

  function canvasImageProvider(node) {
    return ['libtv-cli', 'dreamina-cli', 'updream', 'neowow'].includes(node?.provider) ? node.provider : 'api';
  }

  function canvasImageApiChannel(node) {
    const channels = Array.isArray(config?.image?.channels) ? config.image.channels : [];
    return channels.find((item) => item.id && item.id === node?.channelId)
      || channels.find((item) => item.baseUrl && item.baseUrl === node?.baseUrl)
      || channels.find((item) => item.id === config?.image?.activeChannelId)
      || channels[0]
      || null;
  }

  function isGrsaiImageChannel(channel = {}) {
    try {
      const hostname = new URL(String(channel.baseUrl || '')).hostname.toLowerCase();
      return hostname === 'grsaiapi.com'
        || hostname.endsWith('.grsaiapi.com')
        || hostname === 'grsai.dakka.com.cn';
    } catch {
      return /(?:^|\.)grsaiapi\.com|grsai\.dakka\.com\.cn/i.test(String(channel.baseUrl || ''));
    }
  }

  function canvasImageChannelValue(node) {
    const provider = canvasImageProvider(node);
    if (provider !== 'api') return provider;
    const channel = canvasImageApiChannel(node);
    if (channel?.id) return `api:${channel.id}`;
    return `api-url:${channel?.baseUrl || node?.baseUrl || config?.image?.baseUrl || ''}`;
  }

  function canvasDefaultImageModel(provider, node = null) {
    if (provider === 'libtv-cli') return String(config?.image?.libtvModel || 'Lib Image');
    if (provider === 'dreamina-cli') return String(config?.image?.dreaminaModel || '5.0');
    if (provider === 'updream') return String(config?.image?.updreamModel || 'cheap-b-2');
    if (provider === 'neowow') return String(config?.image?.neowowModel || 'gpt-image-2');
    return String(canvasImageApiChannel(node)?.model || config?.image?.model || options.imageModelOptions?.[0]?.value || '');
  }

  function canvasImageModelOptions(node) {
    const provider = canvasImageProvider(node);
    const source = provider === 'libtv-cli'
      ? (options.libtvImageModelOptions || [])
      : provider === 'dreamina-cli'
        ? (options.dreaminaImageModelOptions || [])
        : provider === 'updream'
          ? (options.updreamImageModelOptions || [])
          : provider === 'neowow'
            ? (options.neowowImageModelOptions || [])
            : (() => {
              const channel = canvasImageApiChannel(node);
              const models = Array.isArray(channel?.models) ? channel.models : [];
              if (models.length) return models.map((value) => ({ label: value, value }));
              return isGrsaiImageChannel(channel) ? (options.grsaiImageModelOptions || []) : (options.imageModelOptions || []);
            })();
    const values = source.map((item) => typeof item === 'string' ? { label: item, value: item } : { ...item });
    const configured = String(node?.model || canvasDefaultImageModel(provider, node)).trim();
    if (configured && !values.some((item) => item.value === configured)) values.push({ label: configured, value: configured });
    return values;
  }

  function canvasImageCapabilityKey(node) {
    return `${canvasImageProvider(node)}:${String(node?.model || '').trim()}`;
  }

  function canvasImageResolutionMeta(node) {
    const provider = canvasImageProvider(node);
    if (provider === 'updream') {
      const model = canvasImageModelOptions(node).find((item) => item.value === node?.model) || {};
      const values = Array.isArray(model.resolutions) ? model.resolutions.map(String).filter(Boolean) : [];
      return {
        values,
        defaultValue: String(model.defaultResolution || config?.image?.updreamResolution || values[0] || '').trim(),
      };
    }
    if (provider === 'neowow') {
      const model = canvasImageModelOptions(node).find((item) => item.value === node?.model) || {};
      const values = Array.isArray(model.resolutions) ? model.resolutions.map(String).filter(Boolean) : [];
      return {
        values: values.length ? values : ['1K', '2K', '4K'],
        defaultValue: String(config?.image?.neowowResolution || values[0] || '1K').trim().toUpperCase(),
      };
    }
    if (provider === 'dreamina-cli') {
      const model = String(node?.model || config?.image?.dreaminaModel || '5.0');
      const values = model === '5.0Pro' ? ['1k', '2k', '4k'] : (['3.0', '3.1'].includes(model) ? ['1k', '2k'] : ['2k', '4k']);
      return { values, defaultValue: String(config?.image?.dreaminaResolution || values[0] || '').toLowerCase() };
    }
    if (provider === 'libtv-cli') {
      const capability = canvasImageCapabilities[canvasImageCapabilityKey(node)] || {};
      const remoteValues = Array.isArray(capability.resolutions)
        ? capability.resolutions.map((item) => String(item?.value || item || '').trim()).filter(Boolean)
        : [];
      const values = remoteValues.length ? remoteValues : ['1K', '2K', '4K'];
      return {
        values,
        defaultValue: String(capability.defaultResolution || config?.image?.libtvResolution || values[0] || '').trim(),
      };
    }
    return { values: [], defaultValue: '' };
  }

  function canvasImageResolutionOptions(node) {
    const { values } = canvasImageResolutionMeta(node);
    return values.length
      ? values.map((value) => ({ label: value, value }))
      : [{ label: '模型默认', value: '' }];
  }

  function canvasImageQualityOptions(node) {
    if (canvasImageProvider(node) !== 'neowow') return [];
    const model = canvasImageModelOptions(node).find((item) => item.value === node?.model) || {};
    return (Array.isArray(model.qualities) ? model.qualities : []).map((value) => ({
      label: value === 'low' ? '低' : value === 'high' ? '高' : value === 'medium' ? '标准' : value,
      value,
    }));
  }

  function canvasImageRatioOptions(node) {
    const model = canvasImageProvider(node) === 'neowow'
      ? canvasImageModelOptions(node).find((item) => item.value === node?.model) || {}
      : {};
    const values = Array.isArray(model.ratios) && model.ratios.length
      ? model.ratios
      : ['16:9', '9:16', '1:1', '4:3', '3:4'];
    return values.map((value) => ({ label: value, value }));
  }

  function canvasSyncImageResolution(node, reset = false) {
    if (!node || !['libtv-cli', 'dreamina-cli', 'updream', 'neowow'].includes(canvasImageProvider(node))) return;
    const { values, defaultValue } = canvasImageResolutionMeta(node);
    const current = String(node.resolution || '').trim();
    if (!reset && (values.includes(current) || (!values.length && !current))) return;
    node.resolution = values.includes(defaultValue) ? defaultValue : (values[0] || '');
  }

  function canvasSyncNeowowImageOptions(node) {
    if (!node || canvasImageProvider(node) !== 'neowow') return;
    const qualities = canvasImageQualityOptions(node).map((item) => item.value);
    node.quality = qualities.includes(node.quality) ? node.quality : (qualities[0] || '');
    const ratios = canvasImageRatioOptions(node).map((item) => item.value);
    if (!ratios.includes(node.ratio)) node.ratio = ratios.includes('16:9') ? '16:9' : ratios[0];
  }

  async function canvasRefreshImageCapabilities(node) {
    if (!api || canvasImageProvider(node) !== 'libtv-cli' || !node?.model) return;
    const key = canvasImageCapabilityKey(node);
    if (canvasImageCapabilities[key]) {
      canvasSyncImageResolution(node);
      return;
    }
    if (!canvasImageCapabilityLoads.has(key)) {
      const request = api.post('/api/libtv/image-model-capabilities', { model: node.model })
        .then((result) => {
          canvasImageCapabilities[key] = result || {};
          return result;
        })
        .finally(() => canvasImageCapabilityLoads.delete(key));
      canvasImageCapabilityLoads.set(key, request);
    }
    try {
      await canvasImageCapabilityLoads.get(key);
      if (key === canvasImageCapabilityKey(node)) {
        canvasSyncImageResolution(node);
        touchActiveProject();
      }
    } catch (error) {
      message.warning?.(`LibTV 清晰度加载失败：${error.message}`);
    }
  }

  function canvasImageModelChanged(node) {
    if (!node) return;
    canvasSyncImageResolution(node, true);
    canvasSyncNeowowImageOptions(node);
    touchActiveProject();
    void canvasRefreshImageCapabilities(node);
  }

  async function canvasRefreshImageModels(provider, node) {
    if (!api || !['libtv-cli', 'updream', 'neowow'].includes(provider)) return;
    const target = provider === 'libtv-cli'
      ? options.libtvImageModelOptions
      : provider === 'neowow' ? options.neowowImageModelOptions : options.updreamImageModelOptions;
    if (!Array.isArray(target)) return;
    try {
      const endpoint = provider === 'libtv-cli'
        ? '/api/libtv/image-models'
        : provider === 'neowow'
          ? `/api/neowow/image-models?accountId=${encodeURIComponent(config?.image?.neowowAccountId || config?.video?.neowowAccountId || '')}`
          : '/api/updream/image-models';
      const result = await api.get(endpoint);
      const models = (Array.isArray(result?.models) ? result.models : []).map((item) => ({
        ...item,
        label: String(item?.label || item?.modelName || item?.name || item?.value || '').trim(),
        value: String(item?.value || item?.modelName || item?.name || '').trim(),
      })).filter((item) => item.value);
      if (!models.length) return;
      target.splice(0, target.length, ...models);
      if (node && !models.some((item) => item.value === node.model)) node.model = models[0].value;
      if (node) {
        canvasSyncImageResolution(node, true);
        canvasSyncNeowowImageOptions(node);
        void canvasRefreshImageCapabilities(node);
      }
    } catch (error) {
      const label = provider === 'libtv-cli' ? 'LibTV' : provider === 'neowow' ? 'Neo' : 'UpDream';
      message.warning?.(`${label} 图片模型加载失败：${error.message}`);
    }
  }

  function canvasImageChannelChanged(node, value) {
    if (!node) return;
    if (value === 'libtv-cli' || value === 'dreamina-cli' || value === 'updream' || value === 'neowow') {
      node.provider = value;
      node.channelId = '';
      node.baseUrl = '';
    } else {
      node.provider = 'api';
      if (String(value).startsWith('api:')) {
        node.channelId = String(value).slice(4);
        const channel = (config?.image?.channels || []).find((item) => item.id === node.channelId);
        node.baseUrl = String(channel?.baseUrl || '');
      } else {
        node.channelId = '';
        node.baseUrl = String(value).replace(/^api-url:/, '');
      }
    }
    node.model = canvasDefaultImageModel(canvasImageProvider(node), node);
    canvasSyncImageResolution(node, true);
    canvasSyncNeowowImageOptions(node);
    touchActiveProject();
    void canvasRefreshImageModels(canvasImageProvider(node), node);
    void canvasRefreshImageCapabilities(node);
  }

  function canvasVideoModelOptions(node) {
    const provider = String(node?.provider || config?.video?.provider || 'xiaoyunque');
    const values = provider === 'video-api'
      ? videoApiModelOptionsForConfig(config?.video, [node?.model])
      : provider === 'updream'
        ? [...(options.updreamModelOptions || [])]
      : provider === 'neowow'
        ? [...(options.neowowModelOptions || [])]
      : provider === 'libtv-cli'
        ? [...(options.libtvModelOptions || [])]
      : provider === 'dreamina-cli'
        ? [...(options.dreaminaModelOptions || [])]
        : [...(options.xiaoyunqueModelOptions || [])];
    const configured = String(node?.model || canvasDefaultVideoModel(provider) || '').trim();
    if (configured && !values.some((item) => item.value === configured)) values.push({ label: configured, value: configured });
    return values;
  }

  function canvasDefaultVideoModel(provider) {
    if (provider === 'video-api') return String(config?.video?.apiModel || '');
    if (provider === 'updream') return String(config?.video?.updreamModel || 'sed2-fast');
    if (provider === 'neowow') return String(config?.video?.neowowModel || 'neo-video-2-0-fast');
    if (provider === 'libtv-cli') return String(config?.video?.libtvModel || 'Seedance 2.0 VIP');
    if (provider === 'dreamina-cli') return String(config?.video?.dreaminaModel || '');
    return String(config?.video?.xiaoyunqueModel || '');
  }

  function canvasVideoResolutionOptions(node) {
    return videoResolutionOptionsFor(node?.provider, node?.model);
  }

  function canvasVideoDurationOptions(node) {
    const range = videoDurationRangeFor(node?.provider, node?.model);
    return Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index);
  }

  function canvasDefaultVideoResolution(provider, model) {
    const configured = String(provider || '') === String(config?.video?.provider || '')
      ? config?.video?.resolution
      : '';
    return allowedVideoResolution(provider, model, configured);
  }

  function canvasEnsureNodeGenerationSettings(node) {
    if (!node) return;
    if (node.type === 'image') {
      const hadProvider = Boolean(node.provider);
      if (!node.provider) node.provider = ['libtv-cli', 'dreamina-cli', 'updream', 'neowow'].includes(config?.image?.provider) ? config.image.provider : 'api';
      if (canvasImageProvider(node) === 'api') {
        const channel = canvasImageApiChannel(node);
        if (!node.channelId) node.channelId = String(channel?.id || '');
        if (!node.baseUrl) node.baseUrl = String(channel?.baseUrl || config?.image?.baseUrl || '');
      }
      if (!node.model || (!hadProvider && canvasImageProvider(node) !== 'api')) {
        node.model = canvasDefaultImageModel(canvasImageProvider(node), node);
      }
      canvasSyncImageResolution(node);
      canvasSyncNeowowImageOptions(node);
    }
    if (node.type === 'video') {
      if (!node.provider) node.provider = String(config?.video?.provider || canvasVideoProviderOptions.value[0]?.value || 'xiaoyunque');
      if (!node.model) node.model = canvasDefaultVideoModel(node.provider);
      if (!node.resolution) node.resolution = canvasDefaultVideoResolution(node.provider, node.model);
      const durationRange = videoDurationRangeFor(node.provider, node.model);
      node.duration = clamp(
        Math.round(number(node.duration, config?.video?.duration || 5)),
        durationRange.min,
        durationRange.max,
      );
    }
  }

  function canvasVideoProviderChanged(node) {
    if (!node) return;
    node.model = canvasDefaultVideoModel(node.provider);
    node.resolution = allowedVideoResolution(node.provider, node.model, '');
    const durationRange = videoDurationRangeFor(node.provider, node.model);
    node.duration = clamp(Math.round(number(node.duration, 5)), durationRange.min, durationRange.max);
    touchActiveProject();
  }

  function canvasVideoModelChanged(node) {
    if (!node) return;
    node.resolution = allowedVideoResolution(node.provider, node.model, node.resolution);
    const durationRange = videoDurationRangeFor(node.provider, node.model);
    node.duration = clamp(Math.round(number(node.duration, 5)), durationRange.min, durationRange.max);
    touchActiveProject();
  }
  const canvasDraftEdgePath = computed(() => {
    const draft = canvasState.connectionDraft;
    const from = draft ? canvasNodes.value.find((node) => node.id === draft.from) : null;
    if (!draft || !from) return '';
    const sx = from.x + from.width;
    const sy = from.y + from.height / 2;
    const tx = draft.x;
    const ty = draft.y;
    const bend = Math.max(80, Math.abs(tx - sx) * .42);
    return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
  });

  const canvasWorldStyle = computed(() => ({
    transform: `translate3d(${canvasState.panX}px, ${canvasState.panY}px, 0) scale(${canvasState.zoom})`,
  }));
  const canvasViewportStyle = computed(() => ({
    '--canvas-grid-size': `${32 * canvasState.zoom}px`,
    '--canvas-grid-major': `${160 * canvasState.zoom}px`,
    '--canvas-grid-x': `${canvasState.panX}px`,
    '--canvas-grid-y': `${canvasState.panY}px`,
  }));
  const canvasMinimapMetrics = computed(() => {
    const viewport = canvasViewportRef.value;
    const viewportWidth = Math.max(1, number(viewport?.clientWidth, 1280));
    const viewportHeight = Math.max(1, number(viewport?.clientHeight, 720));
    const viewportWorldWidth = viewportWidth / canvasState.zoom;
    const viewportWorldHeight = viewportHeight / canvasState.zoom;
    const nodes = canvasNodes.value;
    const minNodeX = nodes.length ? Math.min(...nodes.map((node) => node.x)) : -viewportWorldWidth / 2;
    const minNodeY = nodes.length ? Math.min(...nodes.map((node) => node.y)) : -viewportWorldHeight / 2;
    const maxNodeX = nodes.length ? Math.max(...nodes.map((node) => node.x + node.width)) : viewportWorldWidth / 2;
    const maxNodeY = nodes.length ? Math.max(...nodes.map((node) => node.y + node.height)) : viewportWorldHeight / 2;
    const contentWidth = Math.max(1, maxNodeX - minNodeX);
    const contentHeight = Math.max(1, maxNodeY - minNodeY);
    const width = Math.max(contentWidth + 320, viewportWorldWidth * 2.2, 1200);
    const height = Math.max(contentHeight + 320, viewportWorldHeight * 2.2, 760);
    const centerX = (minNodeX + maxNodeX) / 2;
    const centerY = (minNodeY + maxNodeY) / 2;
    return {
      minX: centerX - width / 2,
      minY: centerY - height / 2,
      width,
      height,
      viewportWorldWidth,
      viewportWorldHeight,
    };
  });
  const canvasMiniViewportStyle = computed(() => {
    const metrics = canvasMinimapMetrics.value;
    const width = clamp(metrics.viewportWorldWidth / metrics.width * 100, 0, 100);
    const height = clamp(metrics.viewportWorldHeight / metrics.height * 100, 0, 100);
    const centerX = -canvasState.panX / canvasState.zoom;
    const centerY = -canvasState.panY / canvasState.zoom;
    const left = clamp((centerX - metrics.viewportWorldWidth / 2 - metrics.minX) / metrics.width * 100, 0, 100 - width);
    const top = clamp((centerY - metrics.viewportWorldHeight / 2 - metrics.minY) / metrics.height * 100, 0, 100 - height);
    return {
      left: `${left}%`,
      top: `${top}%`,
      width: `${width}%`,
      height: `${height}%`,
    };
  });

  function touchActiveProject(save = true) {
    const project = canvasActiveProject.value;
    if (!project) return;
    captureCanvasHistory(project);
    project.updatedAt = projectStamp();
    project.zoom = canvasState.zoom;
    project.panX = canvasState.panX;
    project.panY = canvasState.panY;
    if (save) saveCanvasProjects();
  }

  function scheduleCanvasViewportSave() {
    win.clearTimeout(canvasViewportSaveTimer);
    canvasViewportSaveTimer = win.setTimeout(() => touchActiveProject(), 140);
  }

  function canvasCreateProject() {
    const project = createProjectRecord(canvasLibrary.newName, canvasLibrary.projects.length + 1);
    canvasLibrary.projects.unshift(project);
    canvasLibrary.newName = '';
    saveCanvasProjects({ immediateDisk: true });
    canvasOpenProject(project.id);
    message.success?.('空白画布已创建');
  }

  function canvasOpenProject(id) {
    const project = canvasLibrary.projects.find((item) => item.id === id);
    if (!project) return;
    canvasLibrary.activeId = project.id;
    canvasLibrary.screen = 'editor';
    canvasState.zoom = project.zoom || .86;
    canvasState.panX = number(project.panX);
    canvasState.panY = number(project.panY, 20);
    canvasState.selectedId = '';
    canvasState.showMinimap = true;
    canvasState.connectingFrom = '';
    canvasState.connectionDraft = null;
    canvasState.connectionTargetId = '';
    canvasState.showHelp = project.nodes.length === 0;
    canvasState.contextMenu.open = false;
    for (const node of project.nodes) {
      canvasEnsureNodeGenerationSettings(node);
      if (node.jobId && (node.status === 'running' || node.status === 'queued')) canvasPollNodeJob(node);
    }
    canvasHistoryStack(project);
    canvasDock.panel = '';
    canvasDock.timelinePlayhead = 0;
    canvasStopTimelinePlayback();
    nextTick?.(() => canvasViewportRef.value?.focus());
  }

  function canvasBackToLibrary() {
    canvasStopTimelinePlayback();
    const project = canvasActiveProject.value;
    touchActiveProject();
    saveCanvasProjects({ immediateDisk: true });
    canvasLibrary.screen = 'library';
    canvasLibrary.activeId = '';
    canvasState.selectedId = '';
    canvasDock.panel = '';
    if (project) void canvasRefreshProjectStats(project);
  }

  function canvasDeleteProject(project) {
    if (!project) return;
    if (!win.confirm(`确定删除画布项目“${project.name}”吗？`)) return;
    const index = canvasLibrary.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) canvasLibrary.projects.splice(index, 1);
    canvasHistoryByProject.delete(project.id);
    if (canvasLibrary.activeId === project.id) canvasBackToLibrary();
    saveCanvasProjects();
    message.success?.('画布项目已删除');
  }

  function canvasDuplicateProject(project) {
    if (!project) return;
    const copy = normalizeProject(JSON.parse(JSON.stringify(project)));
    copy.id = `canvas:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    copy.name = `${project.name} · 副本`;
    copy.createdAt = projectStamp();
    copy.updatedAt = copy.createdAt;
    copy.nodes = copy.nodes.map((node, index) => ({ ...node, id: `node:${Date.now()}:${index}:${Math.random().toString(36).slice(2,5)}` }));
    copy.edges = [];
    canvasLibrary.projects.unshift(copy);
    saveCanvasProjects();
    message.success?.('已复制画布项目');
  }

  function canvasRenameProject() {
    const project = canvasActiveProject.value;
    if (!project) return;
    project.name = project.name.trim() || '未命名画布';
    touchActiveProject();
  }

  function canvasNodeStyle(node) {
    const style = { left: '0', top: '0', width: `${node.width}px`, transform: `translate3d(${node.x}px, ${node.y}px, 0)` };
    if (['image', 'video', 'audio'].includes(node.type)) style.height = `${node.height}px`;
    else style.minHeight = `${node.height}px`;
    return style;
  }

  function canvasMiniStyle(node) {
    const metrics = canvasMinimapMetrics.value;
    return {
      left: `${clamp((node.x - metrics.minX) / metrics.width * 100, 0, 100)}%`,
      top: `${clamp((node.y - metrics.minY) / metrics.height * 100, 0, 100)}%`,
      width: `${clamp(node.width / metrics.width * 100, 1.8, 38)}%`,
      height: `${clamp(node.height / metrics.height * 100, 2.4, 38)}%`,
    };
  }

  function canvasEdgePath(edge) {
    const from = canvasNodes.value.find((node) => node.id === edge.from);
    const to = canvasNodes.value.find((node) => node.id === edge.to);
    if (!from || !to) return '';
    const sx = from.x + from.width;
    const sy = from.y + from.height / 2;
    const tx = to.x;
    const ty = to.y + to.height / 2;
    const bend = Math.max(80, Math.abs(tx - sx) * .42);
    return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
  }

  function canvasEdgeMidpoint(edge) {
    const from = canvasNodes.value.find((node) => node.id === edge.from);
    const to = canvasNodes.value.find((node) => node.id === edge.to);
    if (!from || !to) return { x: 0, y: 0 };
    return {
      x: (from.x + from.width + to.x) / 2,
      y: (from.y + from.height / 2 + to.y + to.height / 2) / 2,
    };
  }

  function canvasConnectNodes(fromId, toId, { silent = false } = {}) {
    const project = canvasActiveProject.value;
    if (!project || !fromId || !toId || fromId === toId) return false;
    const exists = project.edges.some((edge) => edge.from === fromId && edge.to === toId);
    if (exists) return false;
    project.edges.push({
      id: `edge:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      from: fromId,
      to: toId,
      tone: canvasNodes.value.find((node) => node.id === fromId)?.color || 'gold',
    });
    touchActiveProject();
    if (!silent) message.success?.('节点已连接');
    return true;
  }

  function canvasSelectNode(node) {
    canvasEnsureNodeGenerationSettings(node);
    void canvasRefreshImageCapabilities(node);
    if (canvasMention.nodeId !== node.id) canvasMention.open = false;
    canvasState.selectedId = node.id;
    canvasState.showHelp = false;
  }

  function canvasAddNode(type = 'note', position = null) {
    const project = canvasActiveProject.value;
    const preset = NODE_PRESETS[type] || NODE_PRESETS.note;
    if (!project) return;
    const nodeIndex = project.nodes.length;
    const starterOffsets = [[0, 0], [650, 20], [-650, 35], [40, 410], [-45, -410], [650, 430], [-650, -430]];
    const starter = starterOffsets[nodeIndex];
    const angle = nodeIndex * 2.18;
    const radius = 640 + Math.floor(nodeIndex / 6) * 140;
    const offsetX = starter ? starter[0] : Math.cos(angle) * radius;
    const offsetY = starter ? starter[1] : Math.sin(angle) * radius * .76;
    const centerX = position?.x ?? (-canvasState.panX / canvasState.zoom - preset.width / 2 + offsetX);
    const centerY = position?.y ?? (-canvasState.panY / canvasState.zoom - preset.height / 2 + offsetY);
    const node = normalizeNode({
      ...preset,
      id: `node:${Date.now()}:${Math.random().toString(36).slice(2,6)}`,
      type,
      color: COLORS[project.nodes.length % COLORS.length] || preset.color,
      x: Math.round(centerX), y: Math.round(centerY),
    });
    canvasEnsureNodeGenerationSettings(node);
    project.nodes.push(node);
    canvasState.selectedId = node.id;
    canvasState.showHelp = false;
    canvasState.nodePaletteOpen = false;
    canvasState.quickConnectMenu.open = false;
    touchActiveProject();
    nextTick?.(() => doc.querySelector(`[data-node-id="${node.id}"] .canvas-node-composer-input`)?.focus());
    return node;
  }

  function canvasFrameNodeId() {
    return `node:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
  }

  function canvasAddExtractedFrameNode(sourceNode, imageNodeId, mediaUrl, label) {
    const project = canvasActiveProject.value;
    if (!project || !sourceNode) return null;
    const preset = NODE_PRESETS.image;
    const position = canvasFindOpenPosition({
      x: sourceNode.x + sourceNode.width + 72,
      y: sourceNode.y + Math.max(0, (sourceNode.height - preset.height) / 2),
    }, preset, [sourceNode.id]);
    const node = normalizeNode({
      ...preset,
      id: imageNodeId,
      type: 'image',
      title: label,
      content: `来自「${sourceNode.title}」`,
      mediaUrl,
      status: 'done',
      progress: 100,
      message: '视频截帧完成',
      color: 'violet',
      x: Math.round(position.x),
      y: Math.round(position.y),
    });
    project.nodes.push(node);
    project.edges.push({
      id: `edge:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      from: sourceNode.id,
      to: node.id,
      tone: sourceNode.color || 'rose',
    });
    canvasState.selectedId = node.id;
    canvasState.showHelp = false;
    touchActiveProject();
    return node;
  }

  async function canvasExtractVideoFrame(node, mode = 'tail', time = 0) {
    if (!node?.mediaUrl || node.status !== 'done') return message.warning?.('请先完成视频生成');
    const project = canvasActiveProject.value;
    if (!project) return;
    const imageNodeId = canvasFrameNodeId();
    const isCustom = mode === 'time';
    try {
      const result = await api.post('/api/canvas/video/frame', {
        canvasId: project.id,
        videoNodeId: node.id,
        imageNodeId,
        mediaUrl: node.mediaUrl,
        mode: isCustom ? 'time' : 'tail',
        time: isCustom ? Math.max(0, number(time)) : undefined,
      });
      if (!result?.ok || !result.mediaUrl) throw new Error(result?.error || '截帧失败');
      const label = isCustom ? `选取帧 ${formatCanvasFrameTime(time)}` : '视频尾帧';
      canvasAddExtractedFrameNode(node, imageNodeId, normalizeCanvasMediaUrl(result.mediaUrl), label);
      message.success?.(`${label}已创建为图片节点`);
      return true;
    } catch (error) {
      message.error?.(error.message || '视频截帧失败');
      return false;
    }
  }

  async function canvasCaptureTailFrame(node) {
    return canvasExtractVideoFrame(node, 'tail');
  }

  function canvasOpenFramePicker(node) {
    if (!node?.mediaUrl || node.status !== 'done') return message.warning?.('请先完成视频生成');
    Object.assign(canvasFramePicker, {
      visible: true,
      sourceNodeId: node.id,
      videoUrl: node.mediaUrl,
      currentTime: 0,
      duration: 0,
      saving: false,
    });
    nextTick?.(() => canvasFramePickerVideo.value?.load?.());
  }

  function canvasFramePickerLoaded() {
    const video = canvasFramePickerVideo.value;
    canvasFramePicker.duration = Number.isFinite(video?.duration) ? video.duration : 0;
    canvasFramePicker.currentTime = Math.min(canvasFramePicker.currentTime, canvasFramePicker.duration || 0);
  }

  function canvasFramePickerTimeUpdate() {
    const video = canvasFramePickerVideo.value;
    if (!video) return;
    canvasFramePicker.currentTime = number(video.currentTime);
  }

  function canvasSeekFramePicker(value) {
    const video = canvasFramePickerVideo.value;
    if (!video) return;
    video.pause?.();
    video.currentTime = clamp(number(value), 0, canvasFramePicker.duration || 0);
    canvasFramePicker.currentTime = video.currentTime;
  }

  async function canvasSaveSelectedFrame() {
    const project = canvasActiveProject.value;
    const node = project?.nodes.find((item) => item.id === canvasFramePicker.sourceNodeId);
    if (!node || canvasFramePicker.saving) return;
    canvasFramePicker.saving = true;
    try {
      const latestFrameTime = Math.max(0, canvasFramePicker.duration - 0.04);
      const selectedTime = Math.min(canvasFramePicker.currentTime, latestFrameTime);
      const saved = await canvasExtractVideoFrame(node, 'time', selectedTime);
      if (saved) canvasFramePicker.visible = false;
    } finally {
      canvasFramePicker.saving = false;
    }
  }

  function formatCanvasFrameTime(value) {
    const seconds = Math.max(0, number(value));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
  }

  function canvasDoubleClick(event) {
    if (event.target.closest?.('.story-canvas-node, .canvas-ui')) return;
    const viewport = canvasViewportRef.value || event.currentTarget;
    const rect = viewport.getBoundingClientRect();
    const preset = NODE_PRESETS.note;
    const x = (event.clientX - rect.left - rect.width / 2 - canvasState.panX) / canvasState.zoom - preset.width / 2;
    const y = (event.clientY - rect.top - rect.height / 2 - canvasState.panY) / canvasState.zoom - preset.height / 2;
    canvasAddNode('note', { x, y });
  }

  function canvasDeleteNode(nodeId) {
    const project = canvasActiveProject.value;
    const id = String(nodeId || '');
    if (!project || !id) return;
    const index = project.nodes.findIndex((node) => node.id === id);
    if (index < 0) return;
    project.nodes[index].jobId = '';
    project.nodes.splice(index, 1);
    project.edges = project.edges.filter((edge) => edge.from !== id && edge.to !== id);
    if (canvasState.selectedId === id) {
      canvasState.selectedId = '';
      }
    if (canvasState.connectingFrom === id) canvasState.connectingFrom = '';
    canvasState.connectionDraft = null;
    canvasState.connectionTargetId = '';
    touchActiveProject();
    message.success?.('卡片已删除');
  }

  function canvasDeleteSelected() {
    canvasDeleteNode(canvasState.selectedId);
  }

  function canvasCycleNodeColor() {
    const node = canvasSelectedNode.value;
    if (!node) return;
    node.color = COLORS[(COLORS.indexOf(node.color) + 1) % COLORS.length];
    touchActiveProject();
  }

  function canvasUpdateNode() {
    touchActiveProject();
  }

  function canvasMentionKindLabel(kind) {
    return ({ image: '图片', video: '视频', audio: '音频', text: '设定' })[kind] || '参考';
  }

  function canvasMentionMatch(value, caret) {
    const prefix = String(value || '').slice(0, Math.max(0, number(caret)));
    const match = prefix.match(/@([^@\s，。；;！？!?()[\]{}]{0,40})$/u);
    if (!match) return null;
    return { query: match[1] || '', start: prefix.length - match[0].length, end: prefix.length };
  }

  function canvasSetMentionState(node, next = {}) {
    Object.assign(canvasMention, {
      open: true,
      nodeId: node.id,
      query: '',
      start: 0,
      end: 0,
      activeIndex: 0,
      ...next,
    });
  }

  function canvasPruneMentions(node) {
    if (!Array.isArray(node?.mentions) || !node.mentions.length) return;
    const content = String(node.content || '');
    node.mentions = node.mentions.filter((mention) => content.includes(`@${mention.label}`));
  }

  function canvasMentionInput(event, node) {
    if (!node) return;
    node.content = String(event?.target?.value || '');
    canvasPruneMentions(node);
    const caret = number(event?.target?.selectionStart, node.content.length);
    const match = canvasMentionMatch(node.content, caret);
    if (match) canvasSetMentionState(node, match);
    else if (canvasMention.nodeId === node.id) canvasMention.open = false;
  }

  function canvasMentionCaretChanged(event, node) {
    if (!node) return;
    const caret = number(event?.target?.selectionStart, String(node.content || '').length);
    const match = canvasMentionMatch(node.content, caret);
    if (match) canvasSetMentionState(node, match);
  }

  function canvasOpenMentionMenu(event, node) {
    if (!node) return;
    const prompt = event?.currentTarget?.closest?.('.canvas-composer-prompt');
    const textarea = prompt?.querySelector?.('textarea');
    const caret = number(textarea?.selectionStart, String(node.content || '').length);
    canvasSetMentionState(node, { start: caret, end: caret });
    textarea?.focus?.();
  }

  function canvasCloseMention(nodeId = '') {
    if (nodeId && canvasMention.nodeId !== nodeId) return;
    canvasMention.open = false;
  }

  function canvasMentionBlur(node) {
    win.setTimeout(() => canvasCloseMention(node?.id), 140);
  }

  function canvasMentionIsSelected(node, candidate) {
    return Boolean(node?.mentions?.some((mention) => mention.id === candidate?.id));
  }

  function canvasSelectMention(node, candidate) {
    if (!node || !candidate) return;
    const mention = normalizeCanvasMention(candidate, node.mentions?.length || 0);
    if (!mention) return;
    if (!Array.isArray(node.mentions)) node.mentions = [];
    if (!node.mentions.some((item) => item.id === mention.id)) node.mentions.push(mention);
    const value = String(node.content || '');
    const start = clamp(number(canvasMention.start, value.length), 0, value.length);
    const end = clamp(number(canvasMention.end, start), start, value.length);
    const token = `@${mention.label}`;
    const needsSpaceBefore = start > 0 && !/[\s，。；;！？!?()[\]{}]/u.test(value[start - 1]);
    const needsSpaceAfter = end < value.length && !/^\s/u.test(value.slice(end));
    const inserted = `${needsSpaceBefore ? ' ' : ''}${token}${needsSpaceAfter ? ' ' : ' '}`;
    node.content = `${value.slice(0, start)}${inserted}${value.slice(end)}`;
    const caret = start + inserted.length;
    canvasMention.open = false;
    canvasMention.query = '';
    touchActiveProject();
    nextTick?.(() => {
      const textarea = [...doc.querySelectorAll('[data-canvas-prompt-id]')]
        .find((item) => item.dataset.canvasPromptId === node.id);
      textarea?.focus?.();
      textarea?.setSelectionRange?.(caret, caret);
    });
  }

  function canvasRemoveMention(node, mentionId) {
    if (!node || !Array.isArray(node.mentions)) return;
    const mention = node.mentions.find((item) => item.id === mentionId);
    node.mentions = node.mentions.filter((item) => item.id !== mentionId);
    if (mention?.label) {
      node.content = String(node.content || '').replaceAll(`@${mention.label}`, '').replace(/[ \t]{2,}/g, ' ').trimStart();
    }
    touchActiveProject();
  }

  function canvasMentionKeydown(event, node) {
    if (!canvasMention.open || canvasMention.nodeId !== node?.id) return;
    const candidates = canvasMentionCandidates.value;
    if (event.key === 'Escape') {
      event.preventDefault();
      canvasMention.open = false;
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!candidates.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      canvasMention.activeIndex = (canvasMention.activeIndex + direction + candidates.length) % candidates.length;
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && candidates.length) {
      event.preventDefault();
      canvasSelectMention(node, candidates[clamp(canvasMention.activeIndex, 0, candidates.length - 1)]);
    }
  }

  function canvasMinimapApplyPointer(clientX, clientY, interaction = canvasState.interaction) {
    if (interaction?.type !== 'minimap') return;
    const { fieldRect, metrics } = interaction;
    if (!fieldRect?.width || !fieldRect?.height || !metrics?.width || !metrics?.height) return;
    const halfViewportX = Math.min(fieldRect.width / 2, metrics.viewportWorldWidth / metrics.width * fieldRect.width / 2);
    const halfViewportY = Math.min(fieldRect.height / 2, metrics.viewportWorldHeight / metrics.height * fieldRect.height / 2);
    const centerPixelX = clamp(clientX - fieldRect.left - interaction.offsetX, halfViewportX, fieldRect.width - halfViewportX);
    const centerPixelY = clamp(clientY - fieldRect.top - interaction.offsetY, halfViewportY, fieldRect.height - halfViewportY);
    const centerWorldX = metrics.minX + centerPixelX / fieldRect.width * metrics.width;
    const centerWorldY = metrics.minY + centerPixelY / fieldRect.height * metrics.height;
    canvasState.panX = Number((-centerWorldX * canvasState.zoom).toFixed(2));
    canvasState.panY = Number((-centerWorldY * canvasState.zoom).toFixed(2));
    canvasState.showHelp = false;
  }

  function canvasMinimapPointerDown(event) {
    if (event.button !== 0) return;
    const field = event.currentTarget;
    const fieldRect = field?.getBoundingClientRect?.();
    if (!fieldRect?.width || !fieldRect?.height) return;
    const viewportElement = event.target.closest?.('.mini-viewport');
    const viewportRect = viewportElement?.getBoundingClientRect?.();
    canvasState.contextMenu.open = false;
    canvasState.interaction = {
      type: 'minimap',
      pointerId: event.pointerId,
      fieldRect: {
        left: fieldRect.left,
        top: fieldRect.top,
        width: fieldRect.width,
        height: fieldRect.height,
      },
      metrics: { ...canvasMinimapMetrics.value },
      offsetX: viewportRect ? event.clientX - viewportRect.left - viewportRect.width / 2 : 0,
      offsetY: viewportRect ? event.clientY - viewportRect.top - viewportRect.height / 2 : 0,
    };
    field.setPointerCapture?.(event.pointerId);
    canvasMinimapApplyPointer(event.clientX, event.clientY);
  }

  function canvasMinimapPointerMove(event) {
    const interaction = canvasState.interaction;
    if (interaction?.type !== 'minimap' || interaction.pointerId !== event.pointerId) return;
    canvasMinimapApplyPointer(event.clientX, event.clientY, interaction);
  }

  function canvasMinimapPointerUp(event) {
    const interaction = canvasState.interaction;
    if (interaction?.type !== 'minimap' || interaction.pointerId !== event.pointerId) return;
    if (event.type !== 'pointercancel') canvasMinimapApplyPointer(event.clientX, event.clientY, interaction);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    canvasState.interaction = null;
    touchActiveProject();
  }


  function canvasStartConnection(event, node) {
    if (event.button !== 0 || !node) return;
    canvasState.contextMenu.open = false;
    canvasState.selectedId = node.id;
    canvasState.connectingFrom = node.id;
    canvasState.connectionTargetId = '';
    canvasState.connectionDraft = {
      from: node.id,
      x: node.x + node.width,
      y: node.y + node.height / 2,
    };
    canvasState.interaction = { type: 'connect', pointerId: event.pointerId, from: node.id };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function canvasStartPan(event) {
    canvasState.selectedId = '';
    canvasState.moved = false;
    canvasState.interaction = {
      type: 'pan', pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      panX: canvasState.panX, panY: canvasState.panY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function canvasNodePointerDown(event, node) {
    if (event.button === 1 || (event.button === 0 && canvasState.spacePressed)) {
      event.preventDefault();
      event.stopPropagation();
      canvasStartPan(event);
      return;
    }
    if (event.button !== 0) return;
    event.stopPropagation();
    canvasSelectNode(node);
    canvasState.moved = false;
    canvasState.interaction = {
      type: 'node', id: node.id, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y,
    };
    const nativeMediaControl = event.target?.closest?.('video[controls], audio[controls]');
    if (!nativeMediaControl) event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function canvasPointerDown(event) {
    canvasState.contextMenu.open = false;
    canvasState.nodePaletteOpen = false;
    canvasState.quickConnectMenu.open = false;
    const isPanButton = event.button === 1 || event.button === 0;
    if (!isPanButton || event.target.closest?.('.canvas-ui')) return;
    if (event.button === 0 && !canvasState.spacePressed && event.target.closest?.('.story-canvas-node')) return;
    event.preventDefault();
    canvasStartPan(event);
  }

  function canvasConnectionTargetAt(clientX, clientY, fromId) {
    const element = doc.elementFromPoint(clientX, clientY);
    const targetNode = element?.closest?.('.story-canvas-node');
    const targetId = String(targetNode?.dataset?.nodeId || '');
    if (!targetId || targetId === fromId) return '';
    return canvasNodes.value.some((node) => node.id === targetId) ? targetId : '';
  }

  function flushCanvasPointerMove() {
    canvasPointerFrame = 0;
    const event = canvasPendingPointer;
    canvasPendingPointer = null;
    if (!event) return;
    const interaction = canvasState.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) canvasState.moved = true;
    if (interaction.type === 'pan') {
      canvasState.panX = interaction.panX + dx;
      canvasState.panY = interaction.panY + dy;
      return;
    }
    if (interaction.type === 'connect') {
      const viewport = canvasViewportRef.value;
      if (!viewport || !canvasState.connectionDraft) return;
      const targetId = canvasConnectionTargetAt(event.clientX, event.clientY, interaction.from);
      canvasState.connectionTargetId = targetId;
      const targetNode = targetId ? canvasNodes.value.find((node) => node.id === targetId) : null;
      if (targetNode) {
        canvasState.connectionDraft.x = targetNode.x;
        canvasState.connectionDraft.y = targetNode.y + targetNode.height / 2;
      } else {
        const rect = viewport.getBoundingClientRect();
        canvasState.connectionDraft.x = (event.clientX - rect.left - rect.width / 2 - canvasState.panX) / canvasState.zoom;
        canvasState.connectionDraft.y = (event.clientY - rect.top - rect.height / 2 - canvasState.panY) / canvasState.zoom;
      }
      return;
    }
    const node = canvasNodes.value.find((item) => item.id === interaction.id);
    if (!node) return;
    node.x = Math.round(interaction.nodeX + dx / canvasState.zoom);
    node.y = Math.round(interaction.nodeY + dy / canvasState.zoom);
  }

  function canvasPointerMove(event) {
    const interaction = canvasState.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    canvasPendingPointer = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    if (!canvasPointerFrame) canvasPointerFrame = requestFrame(flushCanvasPointerMove);
  }

  function canvasPointerUp(event) {
    const interaction = canvasState.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (canvasPointerFrame) cancelFrame(canvasPointerFrame);
    canvasPointerFrame = 0;
    canvasPendingPointer = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    flushCanvasPointerMove();
    if (interaction.type === 'connect') {
      const toId = canvasState.connectionTargetId || canvasConnectionTargetAt(event.clientX, event.clientY, interaction.from);
      canvasConnectNodes(interaction.from, toId);
      canvasState.connectingFrom = '';
      canvasState.connectionDraft = null;
      canvasState.connectionTargetId = '';
      canvasState.interaction = null;
      return;
    }
    canvasState.interaction = null;
    if (canvasState.moved) touchActiveProject();
  }

  function flushCanvasWheel() {
    canvasWheelFrame = 0;
    const wheel = canvasPendingWheel;
    canvasPendingWheel = null;
    if (!wheel) return;
    if (wheel.zooming) {
      const oldZoom = canvasState.zoom;
      const nextZoom = clamp(oldZoom * Math.exp(-wheel.deltaY * .0022), .3, 1.8);
      const worldX = (wheel.cursorX - canvasState.panX) / oldZoom;
      const worldY = (wheel.cursorY - canvasState.panY) / oldZoom;
      canvasState.zoom = Number(nextZoom.toFixed(3));
      canvasState.panX = wheel.cursorX - worldX * canvasState.zoom;
      canvasState.panY = wheel.cursorY - worldY * canvasState.zoom;
    } else {
      canvasState.panX -= wheel.deltaX;
      canvasState.panY -= wheel.deltaY;
    }
    canvasState.showHelp = false;
    scheduleCanvasViewportSave();
  }

  function canvasWheel(event) {
    const viewport = canvasViewportRef.value || event.currentTarget;
    const rect = viewport.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(rect.height, 1) : 1;
    const zooming = Boolean(event.ctrlKey || event.metaKey);
    const deltaX = number(event.deltaX) * unit;
    const deltaY = number(event.deltaY) * unit;
    if (!canvasPendingWheel || canvasPendingWheel.zooming !== zooming) {
      if (canvasWheelFrame) {
        cancelFrame(canvasWheelFrame);
        flushCanvasWheel();
      }
      canvasPendingWheel = {
        zooming,
        deltaX: 0,
        deltaY: 0,
        cursorX: event.clientX - rect.left - rect.width / 2,
        cursorY: event.clientY - rect.top - rect.height / 2,
      };
    }
    if (zooming) canvasPendingWheel.deltaY += deltaY;
    else if (event.shiftKey && !deltaX) canvasPendingWheel.deltaX += deltaY;
    else {
      canvasPendingWheel.deltaX += deltaX;
      canvasPendingWheel.deltaY += deltaY;
    }
    canvasPendingWheel.cursorX = event.clientX - rect.left - rect.width / 2;
    canvasPendingWheel.cursorY = event.clientY - rect.top - rect.height / 2;
    if (!canvasWheelFrame) canvasWheelFrame = requestFrame(flushCanvasWheel);
  }

  function canvasZoomBy(delta) {
    canvasState.zoom = clamp(Number((canvasState.zoom + delta).toFixed(2)), .3, 1.8);
    touchActiveProject();
  }

  function canvasResetView() {
    canvasState.zoom = .86;
    canvasState.panX = 0;
    canvasState.panY = 20;
    touchActiveProject();
  }

  function canvasFitView() {
    const viewport = canvasViewportRef.value;
    if (!viewport || !canvasNodes.value.length) return canvasResetView();
    const minX = Math.min(...canvasNodes.value.map((node) => node.x));
    const minY = Math.min(...canvasNodes.value.map((node) => node.y));
    const maxX = Math.max(...canvasNodes.value.map((node) => node.x + node.width));
    const maxY = Math.max(...canvasNodes.value.map((node) => node.y + node.height));
    const rect = viewport.getBoundingClientRect();
    const zoom = clamp(Math.min((rect.width - 220) / Math.max(1, maxX - minX), (rect.height - 180) / Math.max(1, maxY - minY)), .3, 1.12);
    canvasState.zoom = Number(zoom.toFixed(3));
    canvasState.panX = -((minX + maxX) / 2) * zoom;
    canvasState.panY = -((minY + maxY) / 2) * zoom;
    touchActiveProject();
  }

  function canvasOpenContextMenu(event) {
    if (event.target.closest?.('.story-canvas-node, .canvas-ui')) return;
    canvasState.nodePaletteOpen = false;
    canvasState.quickConnectMenu.open = false;
    const viewport = canvasViewportRef.value || event.currentTarget;
    const rect = viewport.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    canvasState.contextMenu.open = true;
    canvasState.contextMenu.x = clamp(localX, 8, Math.max(8, rect.width - 262));
    canvasState.contextMenu.y = clamp(localY, 8, Math.max(8, rect.height - 354));
    canvasState.contextMenu.worldX = (localX - rect.width / 2 - canvasState.panX) / canvasState.zoom;
    canvasState.contextMenu.worldY = (localY - rect.height / 2 - canvasState.panY) / canvasState.zoom;
    canvasState.showHelp = false;
  }


  function canvasCreateFromMenu(type) {
    const preset = NODE_PRESETS[type] || NODE_PRESETS.note;
    const position = {
      x: canvasState.contextMenu.worldX - preset.width / 2,
      y: canvasState.contextMenu.worldY - preset.height / 2,
    };
    canvasState.contextMenu.open = false;
    return canvasAddNode(type, position);
  }

  function canvasToggleNodePalette() {
    canvasState.contextMenu.open = false;
    canvasState.quickConnectMenu.open = false;
    canvasState.nodePaletteOpen = !canvasState.nodePaletteOpen;
  }

  function canvasOpenQuickConnect(event, node) {
    if (!node) return;
    const viewport = canvasViewportRef.value;
    const rect = viewport?.getBoundingClientRect?.();
    if (!rect) return;
    canvasState.contextMenu.open = false;
    canvasState.nodePaletteOpen = false;
    canvasState.selectedId = node.id;
    canvasState.quickConnectMenu.fromId = node.id;
    canvasState.quickConnectMenu.x = clamp(event.clientX - rect.left + 16, 12, Math.max(12, rect.width - 292));
    canvasState.quickConnectMenu.y = clamp(event.clientY - rect.top - 86, 12, Math.max(12, rect.height - 366));
    canvasState.quickConnectMenu.open = true;
  }

  function canvasFindOpenPosition(preferred, preset, ignoreIds = []) {
    const ignored = new Set(ignoreIds);
    const collides = (candidate) => canvasNodes.value.some((node) => {
      if (ignored.has(node.id)) return false;
      const gap = 42;
      return candidate.x < node.x + node.width + gap
        && candidate.x + preset.width + gap > node.x
        && candidate.y < node.y + node.height + gap
        && candidate.y + preset.height + gap > node.y;
    });
    const candidates = [preferred];
    for (let ring = 1; ring <= 8; ring += 1) {
      const vertical = ring * (preset.height + 72);
      const horizontal = Math.ceil(ring / 2) * (preset.width + 110);
      candidates.push(
        { x: preferred.x, y: preferred.y + vertical },
        { x: preferred.x, y: preferred.y - vertical },
        { x: preferred.x + horizontal, y: preferred.y },
        { x: preferred.x + horizontal, y: preferred.y + vertical / 2 },
        { x: preferred.x + horizontal, y: preferred.y - vertical / 2 },
      );
    }
    return candidates.find((candidate) => !collides(candidate)) || candidates[candidates.length - 1];
  }

  function canvasQuickCreate(type) {
    const from = canvasNodes.value.find((node) => node.id === canvasState.quickConnectMenu.fromId);
    const preset = NODE_PRESETS[type] || NODE_PRESETS.note;
    if (!from) return;
    const preferred = { x: from.x + from.width + 138, y: from.y + from.height / 2 - preset.height / 2 };
    const created = canvasAddNode(type, canvasFindOpenPosition(preferred, preset, [from.id]));
    if (created) canvasConnectNodes(from.id, created.id);
    canvasState.quickConnectMenu.open = false;
  }

  function canvasAudioWaveform(node, count = 34) {
    const seed = String(node?.id || 'audio').split('').reduce((total, char) => total + char.charCodeAt(0), 0);
    return Array.from({ length: count }, (_, index) => {
      const wave = Math.abs(Math.sin((index + 1) * .83 + seed * .013) * .72 + Math.sin((index + 2) * .29) * .28);
      return Math.round(18 + wave * 78);
    });
  }

  function canvasSetComposerMode(node, mode) {
    if (!node || !['text', 'image', 'reference'].includes(mode)) return;
    node.composerMode = mode;
    touchActiveProject();
  }

  function canvasMediaUploadPosition(kind, index, { anchor = null, nearNode = null } = {}) {
    const preset = NODE_PRESETS[kind] || NODE_PRESETS.image;
    let preferred = null;
    if (nearNode) {
      preferred = {
        x: nearNode.x - preset.width - 118,
        y: nearNode.y + index * (preset.height + 58),
      };
    } else if (anchor) {
      preferred = {
        x: anchor.x - preset.width / 2 + index * 46,
        y: anchor.y - preset.height / 2 + index * 46,
      };
    }
    return preferred ? canvasFindOpenPosition(preferred, preset) : null;
  }

  async function canvasUploadMediaFiles(fileList, {
    kind: requestedKind = '', replaceNode = null, nearNode = null, connectTo = null, anchor = null,
  } = {}) {
    if (!api?.upload) return message.error?.('当前版本不支持本地媒体上传');
    const files = Array.from(fileList || []);
    const accepted = files.map((file) => ({ file, kind: canvasMediaKind(file) }))
      .filter((item) => item.kind && (!requestedKind || item.kind === requestedKind));
    if (!accepted.length) return message.warning?.('请选择支持的图片、视频或音频文件');
    if (accepted.length !== files.length) message.warning?.('已跳过不支持或类型不匹配的文件');

    let completed = 0;
    for (let index = 0; index < accepted.length; index += 1) {
      const { file, kind } = accepted[index];
      const node = replaceNode && index === 0
        ? replaceNode
        : canvasAddNode(kind, canvasMediaUploadPosition(kind, index, { anchor, nearNode }));
      if (!node) continue;
      node.title = canvasFileTitle(file, NODE_PRESETS[kind].title);
      node.status = 'running';
      node.progress = 24;
      node.error = '';
      node.mediaError = false;
      node.message = `正在上传${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}…`;
      touchActiveProject();
      try {
        const query = new URLSearchParams({
          canvasId: String(canvasActiveProject.value?.id || ''),
          nodeId: String(node.id),
          filename: file.name || `${kind}.bin`,
          kind,
        });
        const result = await api.upload(`/api/canvas/media/upload?${query}`, file, {
          contentType: file.type || 'application/octet-stream',
          timeoutMs: 30 * 60 * 1000,
        });
        if (!result?.mediaUrl) throw new Error(result?.error || '媒体上传失败');
        node.mediaUrl = normalizeCanvasMediaUrl(result.mediaUrl);
        node.status = 'done';
        node.progress = 100;
        node.message = '本地媒体已上传';
        if (connectTo && connectTo.id !== node.id && kind === 'image') {
          canvasConnectNodes(node.id, connectTo.id, { silent: true });
          connectTo.composerMode = 'reference';
        }
        completed += 1;
        touchActiveProject();
      } catch (error) {
        node.status = 'error';
        node.error = error.message;
        node.message = error.message;
        touchActiveProject();
        message.error?.(`${file.name || '媒体'}：${error.message}`);
      }
    }
    if (completed) message.success?.(`已上传 ${completed} 个媒体文件`);
    if (completed) void canvasRefreshProjectStats(canvasActiveProject.value);
    return completed;
  }

  function canvasPickMedia(kind, options = {}) {
    if (!CANVAS_MEDIA_ACCEPT[kind]) return;
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = CANVAS_MEDIA_ACCEPT[kind];
    input.multiple = !options.replaceNode;
    input.onchange = () => {
      if (input.files?.length) void canvasUploadMediaFiles(input.files, { ...options, kind });
    };
    input.click();
  }

  function canvasOpenMediaUpload(kind) {
    canvasPickMedia(kind);
  }

  function canvasOpenMixedMediaUpload() {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = Object.values(CANVAS_MEDIA_ACCEPT).join(',');
    input.multiple = true;
    input.onchange = () => {
      if (input.files?.length) void canvasUploadMediaFiles(input.files);
    };
    input.click();
  }

  function canvasImportMedia(node, kind = node?.type) {
    if (!node || !['image', 'video', 'audio'].includes(kind)) return;
    canvasPickMedia(kind, { replaceNode: node, nearNode: node });
  }

  function canvasImportReference(node, kind = 'image') {
    if (!node || !['image', 'video', 'audio'].includes(kind)) return;
    canvasPickMedia(kind, { nearNode: node, connectTo: kind === 'image' ? node : null });
  }

  function canvasImportAudio(node) {
    canvasImportMedia(node, 'audio');
  }

  async function canvasRefreshProjectStats(project = canvasActiveProject.value) {
    if (!api?.get || !project?.id) return null;
    try {
      const result = await api.get(`/api/canvas/project-stats?canvasId=${encodeURIComponent(project.id)}`);
      if (result?.ok === false) throw new Error(result.error || '读取画布统计失败');
      project.mediaCount = Math.max(0, Math.floor(number(result?.mediaCount)));
      project.storageBytes = Math.max(0, Math.floor(number(result?.storageBytes)));
      return result;
    } catch (error) {
      console.warn('读取画布媒体统计失败', error);
      return null;
    }
  }

  function canvasProjectMediaCount(project) {
    const reported = Number(project?.mediaCount);
    if (Number.isFinite(reported) && reported > 0) return Math.floor(reported);
    return (project?.nodes || []).filter((node) => ['image', 'video', 'audio'].includes(node.type) && node.mediaUrl).length;
  }

  function formatCanvasBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = bytes;
    let unitIndex = -1;
    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex += 1;
    }
    const decimals = amount >= 10 ? 0 : 1;
    return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
  }

  function canvasMediaExtension(item) {
    try {
      const pathname = new URL(String(item?.mediaUrl || ''), win.location?.href || undefined).pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      if (match?.[1]) return match[1].toLowerCase();
    } catch { /* Fall back to the node type below. */ }
    return item?.type === 'video' ? 'mp4' : item?.type === 'audio' ? 'mp3' : 'png';
  }

  function canvasDownloadFilename(item) {
    const base = String(item?.title || 'canvas-media')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80) || 'canvas-media';
    return `${base}.${canvasMediaExtension(item)}`;
  }

  function canvasMediaDownloadUrl(item) {
    const source = String(item?.mediaUrl || '').trim();
    if (!source) return '';
    if (/^data:/i.test(source)) return source;
    try {
      const url = new URL(source, win.location?.href || undefined);
      url.searchParams.set('download', '1');
      url.searchParams.set('name', String(item?.title || 'canvas-media'));
      return url.toString();
    } catch {
      return source;
    }
  }

  async function canvasDownloadMedia(item) {
    const href = canvasMediaDownloadUrl(item);
    if (!href) return message.warning?.('当前媒体还没有可下载的本地文件');
    if (canvasDownloadBusy) return null;
    if (typeof desktop.saveCanvasMedia === 'function') {
      canvasDownloadBusy = true;
      try {
        let absoluteUrl = href;
        try { absoluteUrl = new URL(href, win.location?.href || undefined).toString(); }
        catch { /* The desktop host can also resolve a local relative URL. */ }
        const result = await desktop.saveCanvasMedia({
          url: absoluteUrl,
          fileName: canvasDownloadFilename(item),
        });
        if (result?.canceled) return result;
        if (!result?.ok) throw new Error(result?.error || '保存媒体失败');
        message.success?.('媒体文件已保存');
        return result;
      } catch (error) {
        message.error?.(`下载媒体失败：${error.message}`);
        return null;
      } finally {
        canvasDownloadBusy = false;
      }
    }
    const link = doc.createElement('a');
    link.href = href;
    link.download = canvasDownloadFilename(item);
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    link.remove();
    message.success?.('已开始下载媒体文件');
    return { ok: true, canceled: false };
  }

  async function canvasOpenMediaFolder(item = canvasActiveProject.value) {
    const canvasId = canvasMediaDirectoryId(item, canvasActiveProject.value);
    if (!canvasId || !api?.post) return message.warning?.('当前没有可定位的画布项目');
    if (canvasOpenFolderBusy) return null;
    canvasOpenFolderBusy = true;
    try {
      const useDesktopHost = typeof desktop.openCanvasMediaFolder === 'function';
      const result = await api.post('/api/canvas/open-folder', { canvasId, open: !useDesktopHost });
      if (!result?.ok) throw new Error(result?.error || '打开画布文件夹失败');
      if (useDesktopHost) {
        const opened = await desktop.openCanvasMediaFolder(result.dir);
        if (!opened?.ok) throw new Error(opened?.error || '系统文件管理器未能打开文件夹');
      }
      message.success?.('已打开画布素材文件夹');
      return result;
    } catch (error) {
      message.error?.(`打开画布文件夹失败：${error.message}`);
      return null;
    } finally {
      canvasOpenFolderBusy = false;
    }
  }

  function canvasEventAnchor(event) {
    const viewport = canvasViewportRef.value || event?.currentTarget;
    const rect = viewport?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      x: (number(event?.clientX, rect.left + rect.width / 2) - rect.left - rect.width / 2 - canvasState.panX) / canvasState.zoom,
      y: (number(event?.clientY, rect.top + rect.height / 2) - rect.top - rect.height / 2 - canvasState.panY) / canvasState.zoom,
    };
  }

  function canvasAddAssetToCanvas(asset, anchor = null) {
    const project = canvasActiveProject.value;
    const sourceProject = canvasLibrary.projects.find((item) => item.id === asset?.projectId);
    const source = sourceProject?.nodes.find((node) => node.id === asset?.nodeId);
    if (!project || !source || !['image', 'video', 'audio'].includes(source.type)) return false;
    const preset = NODE_PRESETS[source.type];
    const preferred = anchor
      ? { x: anchor.x - preset.width / 2, y: anchor.y - preset.height / 2 }
      : { x: -canvasState.panX / canvasState.zoom - preset.width / 2, y: -canvasState.panY / canvasState.zoom - preset.height / 2 };
    const position = canvasFindOpenPosition(preferred, preset);
    const node = normalizeNode({
      ...source,
      id: `node:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      jobId: '',
      status: source.mediaUrl ? 'done' : 'idle',
      progress: source.mediaUrl ? 100 : 0,
      message: source.mediaUrl ? '已从素材库加入' : '',
      error: '',
      x: Math.round(position.x),
      y: Math.round(position.y),
    });
    project.nodes.push(node);
    canvasState.selectedId = node.id;
    canvasState.showHelp = false;
    touchActiveProject();
    message.success?.('素材已加入画布');
    return node;
  }

  function canvasAssetDragStart(event, asset) {
    if (!event?.dataTransfer || !asset) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-yanzhi-canvas-asset', JSON.stringify({
      projectId: asset.projectId,
      nodeId: asset.nodeId,
    }));
    event.dataTransfer.setData('text/plain', asset.title || '画布素材');
  }

  function canvasDragEnter() {
    canvasDragDepth += 1;
    canvasState.dropActive = true;
  }

  function canvasDragOver() {
    canvasState.dropActive = true;
  }

  function canvasDragLeave() {
    canvasDragDepth = Math.max(0, canvasDragDepth - 1);
    if (!canvasDragDepth) canvasState.dropActive = false;
  }

  function canvasDragEnd() {
    canvasDragDepth = 0;
    canvasState.dropActive = false;
  }

  function canvasFocusNode(nodeId) {
    const node = canvasNodes.value.find((item) => item.id === nodeId);
    if (!node) return false;
    canvasState.selectedId = node.id;
    canvasState.panX = -(node.x + node.width / 2) * canvasState.zoom;
    canvasState.panY = -(node.y + node.height / 2) * canvasState.zoom;
    canvasState.showHelp = false;
    touchActiveProject();
    return true;
  }

  function canvasDisconnectEdge(edgeId) {
    const project = canvasActiveProject.value;
    const id = String(edgeId || '');
    if (!project || !id) return false;
    const index = project.edges.findIndex((edge) => edge.id === id);
    if (index < 0) return false;
    project.edges.splice(index, 1);
    touchActiveProject();
    message.success?.('连接已断开');
    return true;
  }

  function canvasToggleDockPanel(panel) {
    const next = canvasDock.panel === panel ? '' : panel;
    if (canvasDock.panel === 'timeline' && next !== 'timeline') canvasStopTimelinePlayback();
    canvasDock.panel = next;
    if (next === 'timeline') canvasState.selectedId = '';
    canvasState.nodePaletteOpen = false;
    canvasState.contextMenu.open = false;
    canvasMention.open = false;
    canvasState.quickConnectMenu.open = false;
  }

  function canvasStopTimelinePlayback() {
    canvasDock.timelinePlaying = false;
    if (canvasTimelineFrame) cancelFrame(canvasTimelineFrame);
    canvasTimelineFrame = 0;
  }

  function canvasTimelineTick(now) {
    if (!canvasDock.timelinePlaying) return;
    const duration = canvasTimelineDuration.value;
    const next = canvasTimelineStartedFrom + (now - canvasTimelineStartedAt) / 1000;
    if (!duration || next >= duration) {
      canvasDock.timelinePlayhead = duration;
      canvasStopTimelinePlayback();
      return;
    }
    canvasDock.timelinePlayhead = next;
    canvasTimelineFrame = requestFrame(canvasTimelineTick);
  }

  function canvasToggleTimelinePlayback() {
    if (canvasDock.timelinePlaying) return canvasStopTimelinePlayback();
    const duration = canvasTimelineDuration.value;
    if (!duration) return message.warning?.('当前画布还没有媒体节点');
    if (canvasDock.timelinePlayhead >= duration) canvasDock.timelinePlayhead = 0;
    canvasDock.timelinePlaying = true;
    canvasTimelineStartedAt = win.performance?.now?.() || Date.now();
    canvasTimelineStartedFrom = canvasDock.timelinePlayhead;
    canvasTimelineFrame = requestFrame(canvasTimelineTick);
  }

  function canvasSeekTimeline(value) {
    canvasDock.timelinePlayhead = clamp(number(value), 0, canvasTimelineDuration.value || 0);
    if (canvasDock.timelinePlaying) {
      canvasTimelineStartedAt = win.performance?.now?.() || Date.now();
      canvasTimelineStartedFrom = canvasDock.timelinePlayhead;
    }
  }

  function canvasFormatTimelineTime(value) {
    const seconds = Math.max(0, Math.round(number(value)));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function canvasDropMedia(event) {
    canvasDragEnd();
    const files = event?.dataTransfer?.files;
    const anchor = canvasEventAnchor(event);
    if (files?.length) {
      void canvasUploadMediaFiles(files, { anchor });
      return;
    }
    const rawAsset = event?.dataTransfer?.getData?.('application/x-yanzhi-canvas-asset');
    if (!rawAsset) return;
    try {
      const asset = JSON.parse(rawAsset);
      canvasAddAssetToCanvas(asset, anchor);
    } catch {
      message.warning?.('无法识别拖入的素材');
    }
  }

  function canvasIncomingNodes(node) {
    const project = canvasActiveProject.value;
    if (!project || !node) return [];
    const nodeMap = new Map(project.nodes.map((item) => [item.id, item]));
    return project.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => nodeMap.get(edge.from))
      .filter(Boolean);
  }

  function canvasReferenceEntries(node) {
    const explicit = (Array.isArray(node?.mentions) ? node.mentions : []).map(normalizeCanvasMention).filter(Boolean).map((mention) => {
      const sourceNode = mention.sourceNodeId ? canvasNodes.value.find((item) => item.id === mention.sourceNodeId) : null;
      return {
        ...mention,
        kind: sourceNode && ['image', 'video', 'audio'].includes(sourceNode.type) ? sourceNode.type : mention.kind,
        mediaUrl: sourceNode?.mediaUrl || mention.mediaUrl,
        description: mention.description || (sourceNode?.type === 'infer' ? sourceNode.result : sourceNode?.content) || '',
      };
    });
    const incoming = canvasIncomingNodes(node).map((source) => normalizeCanvasMention({
      id: `canvas:${canvasActiveProject.value?.id || ''}:${source.id}`,
      kind: ['image', 'video', 'audio'].includes(source.type) ? source.type : 'text',
      label: source.title,
      mediaUrl: source.mediaUrl,
      description: source.type === 'infer' ? (source.result || source.content) : source.content,
      referenceInstruction: `${source.title}${source.type === 'audio' ? '的声音参考' : source.type === 'video' ? '的视频参考' : source.type === 'image' ? '的视觉参考' : '的文字设定'}`,
      source: 'canvas',
      sourceNodeId: source.id,
      category: '上游节点',
    })).filter(Boolean);
    const seen = new Set();
    return [...explicit, ...incoming].filter((item) => {
      const key = `${item.kind}:${item.mediaUrl || item.sourceNodeId || item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function canvasIncomingImages(node) {
    return [...new Set(canvasReferenceEntries(node)
      .filter((reference) => reference.kind === 'image' && reference.mediaUrl)
      .map((reference) => String(reference.mediaUrl))
      .filter(Boolean))];
  }

  function canvasIncomingImage(node) {
    return canvasIncomingImages(node)[0] || '';
  }

  function canvasIncomingVideos(node) {
    return [...new Set(canvasReferenceEntries(node)
      .filter((reference) => reference.kind === 'video' && reference.mediaUrl)
      .map((reference) => String(reference.mediaUrl)).filter(Boolean))];
  }

  function canvasIncomingAudios(node) {
    return [...new Set(canvasReferenceEntries(node)
      .filter((reference) => reference.kind === 'audio' && reference.mediaUrl)
      .map((reference) => String(reference.mediaUrl)).filter(Boolean))];
  }

  function canvasIncomingTextEntries(node) {
    return canvasIncomingNodes(node).map((source) => {
      const text = source.type === 'infer'
        ? (source.result || source.content)
        : (['note', 'section', 'image', 'video', 'audio'].includes(source.type) ? source.content : '');
      return text ? { id: source.id, title: source.title, type: source.type, text: String(text).trim() } : null;
    }).filter((entry) => entry?.text);
  }

  function canvasNodeInputSummary(node) {
    const incoming = canvasIncomingNodes(node);
    const references = canvasReferenceEntries(node);
    const imageNodes = references.filter((source) => source.kind === 'image');
    const videoNodes = references.filter((source) => source.kind === 'video');
    const audioNodes = references.filter((source) => source.kind === 'audio');
    const explicitIds = new Set((node?.mentions || []).map((mention) => mention.sourceNodeId || mention.id));
    const total = incoming.length + [...explicitIds].filter((id) => !incoming.some((source) => source.id === id)).length;
    return {
      total,
      imageCount: imageNodes.length,
      readyImageCount: imageNodes.filter((source) => source.mediaUrl).length,
      videoCount: videoNodes.length,
      readyVideoCount: videoNodes.filter((source) => source.mediaUrl).length,
      audioCount: audioNodes.length,
      readyAudioCount: audioNodes.filter((source) => source.mediaUrl).length,
      textCount: canvasIncomingTextEntries(node).length + references.filter((source) => source.kind === 'text').length,
    };
  }

  function canvasExecutionPrompt(node) {
    const ownPrompt = String(node?.content || '').trim();
    const upstream = canvasIncomingTextEntries(node);
    const explicit = (node?.mentions || []).map(normalizeCanvasMention).filter((mention) => mention?.description);
    const blocks = [ownPrompt];
    if (upstream.length) {
      const context = upstream.map((entry, index) => `[${index + 1}. ${entry.title}]\n${entry.text}`).join('\n\n');
      blocks.push(`[上游节点参考内容]\n${context}`);
    }
    if (explicit.length) {
      const context = explicit.map((mention) => `[@${mention.label} · ${canvasMentionKindLabel(mention.kind)}]\n${mention.description}`).join('\n\n');
      blocks.push(`[引用参考]\n${context}`);
    }
    return blocks.filter(Boolean).join('\n\n').slice(0, 60000);
  }

  function canvasReferencePayload(node) {
    return canvasReferenceEntries(node)
      .filter((reference) => ['image', 'video', 'audio'].includes(reference.kind) && reference.mediaUrl)
      .map((reference) => ({
        id: reference.id,
        kind: reference.kind,
        name: reference.label,
        label: reference.label,
        displayName: reference.label,
        mediaUrl: reference.mediaUrl,
        referenceInstruction: reference.referenceInstruction,
      }));
  }

  function canvasPollNodeJob(node) {
    const jobId = String(node?.jobId || '');
    if (!jobId || !api || canvasPollingJobs.has(jobId)) return;
    canvasPollingJobs.add(jobId);
    const poll = async () => {
      if (node.jobId !== jobId) return canvasPollingJobs.delete(jobId);
      try {
        const job = await api.get(`/api/canvas/job?jobId=${encodeURIComponent(jobId)}`);
        node.status = ['queued', 'running', 'done', 'error'].includes(job?.status) ? job.status : node.status;
        node.progress = number(job?.progress, node.progress);
        node.message = String(job?.message || node.message || '模型正在生成…');
        if (job?.result !== undefined) node.result = String(job.result || '');
        if (job?.mediaUrl) {
          node.mediaUrl = normalizeCanvasMediaUrl(job.mediaUrl);
          node.mediaError = false;
        }
        if (job?.error) node.error = String(job.error);
        touchActiveProject();
        if (node.status === 'done') {
          canvasPollingJobs.delete(jobId);
          if (node.mediaUrl && node.status === 'done') void canvasRefreshProjectStats(canvasActiveProject.value);
          message.success?.(`${node.title} 已完成`);
          return;
        }
        if (node.status === 'error') {
          canvasPollingJobs.delete(jobId);
          message.error?.(node.error || node.message || '生成失败');
          return;
        }
        win.setTimeout(poll, 1800);
      } catch (error) {
        canvasPollingJobs.delete(jobId);
        node.status = 'error';
        node.error = error.message;
        node.message = error.message;
        touchActiveProject();
      }
    };
    poll();
  }

  async function canvasRunNode(node = canvasSelectedNode.value) {
    if (!node || !api || !['infer', 'image', 'video'].includes(node.type)) return;
    const prompt = canvasExecutionPrompt(node);
    if (!prompt) return message.warning?.('请先填写提示词');
    node.status = 'running';
    node.progress = 2;
    node.error = '';
    node.mediaError = false;
    if (node.type === 'infer') node.result = '';
    node.message = '正在创建任务…';
    touchActiveProject();
    try {
      const endpoint = node.type === 'infer' ? '/api/canvas/infer' : node.type === 'image' ? '/api/canvas/image' : '/api/canvas/video';
      const references = canvasReferencePayload(node);
      const result = await api.post(endpoint, {
        canvasId: canvasActiveProject.value?.id,
        nodeId: node.id,
        title: node.title,
        prompt,
        ratio: node.ratio || '16:9',
        duration: clamp(Math.round(number(node.duration, 5)), 5, 15),
        provider: node.provider || '',
        accountId: canvasImageProvider(node) === 'neowow'
          ? String(node.accountId || config?.image?.neowowAccountId || config?.video?.neowowAccountId || '')
          : '',
        channelId: node.channelId || '',
        model: node.model || '',
        baseUrl: node.baseUrl || '',
        resolution: node.resolution || '',
        quality: node.quality || '',
        nodeType: node.type,
        references,
        imageUrl: node.type === 'video' ? canvasIncomingImage(node) : '',
        imageUrls: ['image', 'video'].includes(node.type) ? canvasIncomingImages(node) : [],
        videoUrls: node.type === 'video' ? canvasIncomingVideos(node) : [],
        audioUrls: node.type === 'video' ? canvasIncomingAudios(node) : [],
      });
      if (!result?.jobId) throw new Error(result?.error || '任务创建失败');
      node.jobId = result.jobId;
      node.message = '任务已提交…';
      touchActiveProject();
      canvasPollNodeJob(node);
    } catch (error) {
      node.status = 'error';
      node.error = error.message;
      node.message = error.message;
      touchActiveProject();
      message.error?.(error.message);
    }
  }

  function canvasHandleMediaError(node, kind = 'image') {
    if (!node) return;
    node.mediaError = true;
    node.status = 'error';
    node.error = kind === 'video' ? '视频文件加载失败，请重新上传或生成' : kind === 'audio' ? '音频文件加载失败，请重新导入' : '图片文件加载失败，请重新上传或生成';
    node.message = node.error;
    touchActiveProject();
  }

  function canvasHandleMediaLoad(node) {
    const hadLoadError = Boolean(node?.mediaError || (node?.status === 'error' && /文件加载失败/.test(`${node?.error || ''}${node?.message || ''}`)));
    if (!hadLoadError) return;
    node.mediaError = false;
    if (node.status === 'error' && /文件加载失败/.test(node.error || '')) {
      node.status = 'done';
      node.error = '';
      node.message = '媒体加载完成';
    }
    touchActiveProject();
  }

  function canvasNodeTypeLabel(type) {
    return ({ note: '灵感便签', infer: 'AI 推理', image: '图片生成', video: '视频生成', audio: '音频素材', section: '创作分区' })[type] || '节点';
  }

  function canvasAgentTime() {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  }

  function canvasOpenAgent() {
    canvasAgent.open = true;
    canvasState.nodePaletteOpen = false;
    canvasState.quickConnectMenu.open = false;
    if (!canvasAgent.messages.length) {
      canvasAgent.messages.push({
        role: 'assistant',
        text: '我是Freedom画布 Agent。我可以读取并操作当前画布：创建角色与剧本节点、搭建图片/视频/音频流程、连接节点并整理布局。',
        time: canvasAgentTime(),
      });
    }
  }

  function canvasCloseAgent() {
    canvasAgent.open = false;
  }

  function canvasAgentNodeTarget(target, aliases = new Map()) {
    const value = String(target || '').trim();
    if (!value) return null;
    const aliased = aliases.get(value);
    if (aliased) return aliased;
    return canvasNodes.value.find((node) => node.id === value)
      || canvasNodes.value.find((node) => node.title === value)
      || canvasNodes.value.find((node) => node.title.toLowerCase().includes(value.toLowerCase()))
      || null;
  }

  function canvasArrangeNodes(mode = 'flow') {
    const nodes = canvasNodes.value;
    if (!nodes.length) return;
    if (mode === 'grid') {
      const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
      nodes.forEach((node, index) => {
        node.x = (index % columns) * 620 - ((columns - 1) * 620) / 2;
        node.y = Math.floor(index / columns) * 430 - 210;
      });
      touchActiveProject();
      return;
    }
    const level = new Map(nodes.map((node) => [node.id, 0]));
    for (let pass = 0; pass < nodes.length; pass += 1) {
      let changed = false;
      for (const edge of canvasEdges.value) {
        const next = Math.min(nodes.length - 1, (level.get(edge.from) || 0) + 1);
        if (next > (level.get(edge.to) || 0)) { level.set(edge.to, next); changed = true; }
      }
      if (!changed) break;
    }
    const groups = new Map();
    nodes.forEach((node) => {
      const column = level.get(node.id) || 0;
      if (!groups.has(column)) groups.set(column, []);
      groups.get(column).push(node);
    });
    const columns = [...groups.keys()].sort((a, b) => a - b);
    columns.forEach((column, columnIndex) => {
      const group = groups.get(column);
      group.forEach((node, row) => {
        node.x = columnIndex * 680 - ((columns.length - 1) * 680) / 2;
        node.y = (row - (group.length - 1) / 2) * 430 - node.height / 2;
      });
    });
    touchActiveProject();
  }

  function canvasAgentActionLabel(action) {
    const labels = {
      add_node: '创建节点', connect: '连接节点', update_node: '更新节点', delete_node: '删除节点',
      run_node: '运行节点', arrange: '整理画布', fit_view: '适应视图',
    };
    return labels[action?.type] || '画布操作';
  }

  async function canvasExecuteAgentActions(actions = []) {
    const aliases = new Map();
    const results = [];
    for (const action of actions.slice(0, 24)) {
      try {
        if (action.type === 'add_node') {
          const nodeType = NODE_PRESETS[action.nodeType] ? action.nodeType : 'note';
          const position = Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y)) ? { x: Number(action.x), y: Number(action.y) } : null;
          const node = canvasAddNode(nodeType, position);
          if (action.title) node.title = String(action.title).slice(0, 48);
          if (action.content) node.content = String(action.content).slice(0, 60000);
          if (action.settings && typeof action.settings === 'object') Object.assign(node, action.settings);
          if (action.ref) aliases.set(String(action.ref), node);
          results.push({ ...action, ok: true, nodeId: node.id });
        } else if (action.type === 'connect') {
          const from = canvasAgentNodeTarget(action.from, aliases);
          const to = canvasAgentNodeTarget(action.to, aliases);
          if (!node) throw new Error('找不到要运行的节点');
          canvasConnectNodes(from.id, to.id);
          results.push({ ...action, ok: true });
        } else if (action.type === 'update_node') {
          const node = canvasAgentNodeTarget(action.target, aliases);
          if (!node) throw new Error('找不到要更新的节点');
          if (action.title !== undefined) node.title = String(action.title).slice(0, 48);
          if (action.content !== undefined) node.content = String(action.content).slice(0, 60000);
          const settings = action.settings && typeof action.settings === 'object' ? action.settings : {};
          for (const key of ['ratio', 'duration', 'provider', 'model', 'baseUrl', 'resolution']) if (settings[key] !== undefined) node[key] = settings[key];
          touchActiveProject();
          results.push({ ...action, ok: true });
        } else if (action.type === 'delete_node') {
          const node = canvasAgentNodeTarget(action.target, aliases);
          if (!node) throw new Error('找不到要删除的节点');
          canvasDeleteNode(node.id);
          results.push({ ...action, ok: true });
        } else if (action.type === 'run_node') {
          const node = canvasAgentNodeTarget(action.target, aliases);
          if (!node) throw new Error('找不到要运行的节点');
          await canvasRunNode(node);
          results.push({ ...action, ok: true });
        } else if (action.type === 'arrange') {
          canvasArrangeNodes(action.mode || 'flow');
          results.push({ ...action, ok: true });
        } else if (action.type === 'fit_view') {
          nextTick?.(() => canvasFitView());
          results.push({ ...action, ok: true });
        }
      } catch (error) {
        results.push({ ...action, ok: false, error: error.message });
      }
    }
    touchActiveProject();
    return results;
  }

  function canvasAgentFallbackPlan(instruction) {
    const text = String(instruction || '');
    const actions = [];
    const wanted = [
      ['音频', 'audio'], ['视频', 'video'], ['图片', 'image'], ['生图', 'image'], ['推理', 'infer'], ['剧本', 'infer'], ['便签', 'note'],
    ];
    const matched = wanted.find(([keyword]) => text.includes(keyword));
    if (matched && /(创建|添加|新建|来一个|放一个)/.test(text)) actions.push({ type: 'add_node', nodeType: matched[1], title: matched[0] === '剧本' ? '剧本创作' : undefined });
    if (/(整理|排列|自动布局)/.test(text)) actions.push({ type: 'arrange', mode: 'flow' }, { type: 'fit_view' });
    return { reply: actions.length ? '我先按你的指令执行基础画布操作。配置文本模型后，Freedom Agent 可以理解更复杂的多步工作流。' : '当前无法调用文本模型。你可以先在设置中配置文本模型，或直接说“添加视频节点”“创建剧本卡”“整理画布”。', actions };
  }

  async function canvasAgentSend(prefill = '') {
    const instruction = String(prefill || canvasAgent.input || '').trim();
    if (!instruction || canvasAgent.running) return;
    canvasAgent.input = '';
    canvasAgent.error = '';
    canvasAgent.messages.push({ role: 'user', text: instruction, time: canvasAgentTime() });
    canvasAgent.running = true;
    try {
      const project = canvasActiveProject.value;
      const state = {
        canvasId: project?.id || '',
        canvasName: project?.name || '',
        viewport: { zoom: canvasState.zoom, panX: canvasState.panX, panY: canvasState.panY },
        nodes: canvasNodes.value.map((node) => ({
          id: node.id, type: node.type, title: node.title, content: node.content.slice(0, 3000), result: node.result.slice(0, 3000),
          status: node.status, x: node.x, y: node.y, width: node.width, height: node.height, ratio: node.ratio, duration: node.duration,
          hasMedia: !!node.mediaUrl,
        })),
        edges: canvasEdges.value.map((edge) => ({ from: edge.from, to: edge.to })),
      };
      let plan;
      try {
        const response = await api.post('/api/canvas/agent/plan', {
          instruction,
          state,
          history: canvasAgent.messages.slice(-8).map((item) => ({ role: item.role, content: item.text })),
        });
        if (!response?.ok || !response.plan) throw new Error(response?.error || 'Freedom Agent 规划失败');
        plan = response.plan;
        if (!Array.isArray(plan.actions) || !plan.actions.length) {
          const localPlan = canvasAgentFallbackPlan(instruction);
          if (localPlan.actions.length) plan = { ...plan, reply: plan.reply || localPlan.reply, actions: localPlan.actions };
        }
      } catch (error) {
        plan = canvasAgentFallbackPlan(instruction);
        canvasAgent.error = error.message;
      }
      const actions = Array.isArray(plan.actions) ? plan.actions : [];
      const results = await canvasExecuteAgentActions(actions);
      canvasAgent.lastActions = results;
      const failed = results.filter((item) => !item.ok).length;
      canvasAgent.messages.push({
        role: 'assistant',
        text: `${plan.reply || '已完成。'}${failed ? `\n${failed} 个动作未能完成，请检查对应节点。` : ''}`,
        time: canvasAgentTime(),
        actions: results,
      });
      if (actions.length) nextTick?.(() => canvasFitView());
    } catch (error) {
      canvasAgent.error = error.message;
      canvasAgent.messages.push({ role: 'assistant', text: `执行失败：${error.message}`, time: canvasAgentTime(), error: true });
    } finally {
      canvasAgent.running = false;
    }
  }

  function canvasKeydown(event) {
    if (event.target.matches?.('input, textarea, [contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) canvasRedo();
      else canvasUndo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      canvasRedo();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      canvasState.spacePressed = true;
      return;
    }
    if (event.repeat) return;
    if (event.key === 'Delete' || event.key === 'Backspace') canvasDeleteSelected();
    if (event.key === '0') canvasFitView();
    if (event.key === '+' || event.key === '=') canvasZoomBy(.1);
    if (event.key === '-') canvasZoomBy(-.1);
    if (event.key.toLowerCase() === 'n') canvasAddNode('note');
    if (event.key.toLowerCase() === 't') canvasAddNode('infer');
    if (event.key.toLowerCase() === 'i') canvasAddNode('image');
    if (event.key.toLowerCase() === 'v') canvasAddNode('video');
    if (event.key.toLowerCase() === 'a') canvasAddNode('audio');
  }

  function canvasKeyup(event) {
    if (event.code === 'Space') canvasState.spacePressed = false;
  }

  function canvasBlur() {
    canvasState.spacePressed = false;
  }

  function canvasClearProject() {
    const project = canvasActiveProject.value;
    if (!project || !project.nodes.length) return;
    if (!win.confirm('确定清空这张画布上的所有内容吗？')) return;
    project.nodes.splice(0);
    project.edges.splice(0);
    canvasState.selectedId = '';
    canvasState.showHelp = true;
    touchActiveProject();
  }

  function canvasProjectNodeSummary(project) {
    const nodes = project?.nodes || [];
    return {
      total: nodes.length,
      note: nodes.filter((node) => node.type === 'note').length,
      image: nodes.filter((node) => node.type === 'image').length,
      video: nodes.filter((node) => node.type === 'video').length,
      audio: nodes.filter((node) => node.type === 'audio').length,
    };
  }

  function formatCanvasTime(value) {
    if (!value) return '刚刚';
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return '刚刚';
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
  }

  void loadCanvasProjects();

  return {
    canvasViewportRef,
    canvasFramePickerVideo,
    canvasLibrary,
    canvasState,
    canvasDock,
    canvasMention,
    canvasFramePicker,
    canvasAgent,
    canvasActiveProject,
    canvasFilteredProjects,
    canvasNodes,
    canvasEdges,
    canvasSelectedNode,
    canvasAssetItems,
    canvasTimelineItems,
    canvasTimelineDuration,
    canvasMentionCandidates,
    canvasHistoryEntries,
    canvasCanUndo,
    canvasCanRedo,
    canvasImageChannelOptions,
    canvasImageModelOptions,
    canvasImageResolutionOptions,
    canvasImageQualityOptions,
    canvasImageRatioOptions,
    canvasVideoProviderOptions,
    canvasDraftEdgePath,
    canvasWorldStyle,
    canvasViewportStyle,
    canvasMiniViewportStyle,
    canvasCreateProject,
    canvasOpenProject,
    canvasBackToLibrary,
    canvasDeleteProject,
    canvasDuplicateProject,
    canvasRenameProject,
    canvasNodeStyle,
    canvasMiniStyle,
    canvasMinimapPointerDown,
    canvasMinimapPointerMove,
    canvasMinimapPointerUp,
    canvasEdgePath,
    canvasEdgeMidpoint,
    canvasDisconnectEdge,
    canvasSelectNode,
    canvasAddNode,
    canvasCaptureTailFrame,
    canvasOpenFramePicker,
    canvasFramePickerLoaded,
    canvasFramePickerTimeUpdate,
    canvasSeekFramePicker,
    canvasSaveSelectedFrame,
    formatCanvasFrameTime,
    canvasDoubleClick,
    canvasOpenContextMenu,
    canvasCreateFromMenu,
    canvasToggleNodePalette,
    canvasOpenQuickConnect,
    canvasQuickCreate,
    canvasFindOpenPosition,
    canvasAudioWaveform,
    canvasSetComposerMode,
    canvasOpenMediaUpload,
    canvasOpenMixedMediaUpload,
    canvasImportMedia,
    canvasImportReference,
    canvasImportAudio,
    canvasDownloadMedia,
    canvasOpenMediaFolder,
    canvasRefreshProjectStats,
    canvasProjectMediaCount,
    formatCanvasBytes,
    canvasAddAssetToCanvas,
    canvasAssetDragStart,
    canvasDragEnter,
    canvasDragOver,
    canvasDragLeave,
    canvasDragEnd,
    canvasFocusNode,
    canvasToggleDockPanel,
    canvasToggleTimelinePlayback,
    canvasSeekTimeline,
    canvasFormatTimelineTime,
    canvasUndo,
    canvasRedo,
    canvasRestoreHistory,
    canvasDropMedia,
    canvasOpenAgent,
    canvasCloseAgent,
    canvasAgentSend,
    canvasArrangeNodes,
    canvasAgentActionLabel,
    canvasDeleteNode,
    canvasDeleteSelected,
    canvasCycleNodeColor,
    canvasUpdateNode,
    canvasMentionKindLabel,
    canvasMentionInput,
    canvasMentionCaretChanged,
    canvasOpenMentionMenu,
    canvasCloseMention,
    canvasMentionBlur,
    canvasMentionIsSelected,
    canvasSelectMention,
    canvasRemoveMention,
    canvasMentionKeydown,
    canvasRunNode,
    canvasPollNodeJob,
    canvasIncomingNodes,
    canvasIncomingImages,
    canvasIncomingImage,
    canvasIncomingVideos,
    canvasIncomingAudios,
    canvasNodeInputSummary,
    canvasHandleMediaError,
    canvasHandleMediaLoad,
    canvasNodeTypeLabel,
    canvasVideoModelOptions,
    canvasVideoResolutionOptions,
    canvasVideoDurationOptions,
    canvasVideoProviderChanged,
    canvasVideoModelChanged,
    canvasImageChannelValue,
    canvasImageChannelChanged,
    canvasImageModelChanged,
    canvasStartConnection,
    canvasNodePointerDown,
    canvasPointerDown,
    canvasPointerMove,
    canvasPointerUp,
    canvasWheel,
    canvasZoomBy,
    canvasResetView,
    canvasFitView,
    canvasKeydown,
    canvasKeyup,
    canvasBlur,
    canvasClearProject,
    canvasProjectNodeSummary,
    formatCanvasTime,
  };
}
