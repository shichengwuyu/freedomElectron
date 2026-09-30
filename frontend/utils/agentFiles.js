import {
  agentAttachmentLabel,
  agentAttachmentSummary,
  createAgentUiRuntime,
} from './agentUi.js';

export {
  AGENT_ATTACHMENT_MAX_FILES,
  AGENT_ATTACHMENT_MAX_TOTAL_BYTES,
  AGENT_ATTACHMENT_TEXT_LIMIT,
  createAgentStateRuntime,
  formatAgentFileSize,
  setAgentProgressState,
  agentAttachmentKind,
  agentAttachmentLabel,
  agentAttachmentSummary,
  makeAgentAttachment,
  addAgentFilesFlow,
  createAddAgentFilesRuntime,
  loadAgentTxtFilesFlow,
  createLoadAgentTxtFilesRuntime,
  createAgentUiRuntime,
} from './agentUi.js';

export function agentAttachmentPayload(file) {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    kind: file.kind,
    text: file.text,
    rawTextLength: file.rawTextLength,
    truncated: file.truncated,
    dataUrl: file.kind === 'image' ? file.dataUrl : undefined,
  };
}

export function sanitizeAgentProjectName(value) {
  let name = String(value || '').trim();
  if (!name) name = `小说全流程-${new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[\/:\s]/g, '-')}`;
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || `小说全流程-${Date.now()}`;
}

export function readAgentTxtFiles(fileList) {
  const files = [...(fileList || [])].filter((f) => /\.txt$/i.test(f.name || '') || f.type === 'text/plain');
  if (!files.length) return Promise.resolve(null);
  return Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsText(file, 'utf-8');
  }))).then((parts) => ({
    files,
    name: files.map((f) => f.name).join('、'),
    text: parts.join('\n\n').trim(),
  }));
}

export function agentSplitPath(pathText) {
  return String(pathText || '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function agentResolvePath(pathRoots, pathText, createMissing = false) {
  const parts = agentSplitPath(pathText);
  const rootName = parts.shift();
  const root = pathRoots[rootName];
  if (!root) throw new Error(`Unknown path root: ${rootName || '(empty)'}`);
  let target = root && typeof root === 'object' && 'value' in root ? root.value : root;
  if (target == null) throw new Error(`Path root is empty: ${rootName}`);
  for (let i = 0; i < parts.slice(0, -1).length; i++) {
    const part = parts[i];
    if (target[part] == null) {
      if (!createMissing) throw new Error(`Path not found: ${pathText}`);
      target[part] = /^\d+$/.test(parts[i + 1] || '') ? [] : {};
    }
    target = target[part];
  }
  return { target, key: parts[parts.length - 1], rootName };
}

export function agentSetPath(pathRoots, pathText, value) {
  const { target, key, rootName } = agentResolvePath(pathRoots, pathText, true);
  if (!key) throw new Error('Path must include a field');
  target[key] = value;
  return rootName;
}

export function agentDeletePath(pathRoots, pathText) {
  const { target, key, rootName } = agentResolvePath(pathRoots, pathText, false);
  if (!key) throw new Error('Path must include a field');
  if (Array.isArray(target)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= target.length) throw new Error(`Array index not found: ${pathText}`);
    target.splice(index, 1);
  } else if (Object.prototype.hasOwnProperty.call(target, key)) {
    delete target[key];
  } else {
    throw new Error(`Path not found: ${pathText}`);
  }
  return rootName;
}

export function agentToPlain(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => agentToPlain(item, seen));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    if (typeof val === 'function') continue;
    if (key === 'apiKey' && typeof val === 'string' && val) {
      out[key] = val.includes('****') ? val : '[configured]';
      continue;
    }
    out[key] = agentToPlain(val, seen);
  }
  return out;
}

const AGENT_ELEMENT_DETAIL_FIELDS = [
  'identity', 'appearance', 'body', 'hair', 'clothing', 'makeupAccessories',
  'prompt', 'desc', 'description', 'style', 'negativePrompt',
];

function truncateAgentStateText(value, limit = 1200) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[已省略 ${text.length - limit} 字]`;
}

export function compactAgentStateValue(value, {
  stringLimit = 1200,
  arrayLimit = 40,
  depth = 4,
} = {}, seen = new WeakSet()) {
  if (typeof value === 'string') return truncateAgentStateText(value, stringLimit);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  if (depth <= 0) return Array.isArray(value) ? `[数组 ${value.length} 项]` : '[对象已省略]';
  seen.add(value);
  if (Array.isArray(value)) {
    const list = value.slice(0, arrayLimit)
      .map((item) => compactAgentStateValue(item, { stringLimit, arrayLimit, depth: depth - 1 }, seen));
    if (value.length > arrayLimit) list.push(`[另有 ${value.length - arrayLimit} 项]`);
    return list;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('_') || typeof item === 'function') continue;
    if (key === 'apiKey' && typeof item === 'string' && item) {
      out[key] = item.includes('****') ? item : '[configured]';
      continue;
    }
    out[key] = compactAgentStateValue(item, { stringLimit, arrayLimit, depth: depth - 1 }, seen);
  }
  return out;
}

function agentElementNameMatchesInstruction(element, instruction) {
  const text = String(instruction || '').trim().toLowerCase();
  if (!text) return false;
  return [element?.name, element?.alias, ...(Array.isArray(element?.aliases) ? element.aliases : [])]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .some((name) => text.includes(name));
}

function agentElementSubItems(items = [], expanded = false) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const summary = { index, name: item?.name || '' };
    for (const field of AGENT_ELEMENT_DETAIL_FIELDS) {
      if (item?.[field] == null || item[field] === '') continue;
      summary[field] = typeof item[field] === 'string'
        ? truncateAgentStateText(item[field], expanded ? 1000 : 160)
        : compactAgentStateValue(item[field], { stringLimit: expanded ? 1000 : 160, arrayLimit: 12, depth: 2 });
    }
    return summary;
  });
}

export function buildAgentElementSnapshot(element = {}, index = 0, { expanded = false } = {}) {
  const snapshot = { index, name: element.name || '' };
  for (const field of ['alias', 'aliases', 'hasImage', 'referenceMode', 'imageName', 'audioName']) {
    if (element[field] != null && element[field] !== '') {
      snapshot[field] = compactAgentStateValue(element[field], { stringLimit: 320, arrayLimit: 20, depth: 2 });
    }
  }
  for (const field of AGENT_ELEMENT_DETAIL_FIELDS) {
    if (element[field] == null || element[field] === '') continue;
    snapshot[field] = typeof element[field] === 'string'
      ? truncateAgentStateText(element[field], expanded ? 2400 : 160)
      : compactAgentStateValue(element[field], { stringLimit: expanded ? 1600 : 160, arrayLimit: 20, depth: 3 });
  }
  for (const field of ['variants', 'outfits', 'areas']) {
    if (Array.isArray(element[field]) && element[field].length) {
      snapshot[field] = agentElementSubItems(element[field], expanded);
    }
  }
  if (expanded && element.source && typeof element.source === 'object') {
    snapshot.source = compactAgentStateValue(element.source, { stringLimit: 1200, arrayLimit: 30, depth: 4 });
  }
  return snapshot;
}

export function buildAgentProjectSnapshot(project, {
  currentCategory = '',
  selectedElementIndex = -1,
  instruction = '',
} = {}) {
  if (!project || typeof project !== 'object') return null;
  const snapshot = {};
  for (const [key, value] of Object.entries(project)) {
    if (key === 'elements' || key === 'script') continue;
    snapshot[key] = compactAgentStateValue(value, { stringLimit: 1200, arrayLimit: 40, depth: 4 });
  }
  snapshot.elements = {};
  for (const [category, items] of Object.entries(project.elements || {})) {
    snapshot.elements[category] = (Array.isArray(items) ? items : []).map((element, index) => (
      buildAgentElementSnapshot(element, index, {
        expanded: (category === currentCategory && index === selectedElementIndex)
          || agentElementNameMatchesInstruction(element, instruction),
      })
    ));
  }
  return snapshot;
}

export function buildAgentScriptSnapshot(script = {}, storyboardEpisodeId = null) {
  const snapshot = {};
  for (const [key, value] of Object.entries(script || {})) {
    if (key === 'chapters') {
      snapshot.chapters = (Array.isArray(value) ? value : []).map((chapter) => ({
        ...compactAgentStateValue(chapter, { stringLimit: 600, arrayLimit: 20, depth: 3 }),
        sourceLength: String(chapter?.sourceText || '').length,
      }));
      continue;
    }
    if (key === 'episodes') {
      snapshot.episodes = (Array.isArray(value) ? value : [])
        .map((episode) => compactAgentStateValue(episode, { stringLimit: 2000, arrayLimit: 30, depth: 3 }));
      continue;
    }
    if (key === 'storyboards') {
      snapshot.storyboards = (Array.isArray(value) ? value : []).map((storyboard) => compactAgentStateValue(storyboard, {
        stringLimit: String(storyboard?.episodeId) === String(storyboardEpisodeId) ? 12000 : 1400,
        arrayLimit: 80,
        depth: 4,
      }));
      continue;
    }
    snapshot[key] = compactAgentStateValue(value, { stringLimit: 1200, arrayLimit: 40, depth: 4 });
  }
  return snapshot;
}

export function buildAgentProjectsSnapshot(projects = []) {
  return (Array.isArray(projects) ? projects : []).map((project) => ({
    id: project?.id || '',
    name: project?.name || '',
    description: truncateAgentStateText(project?.description || '', 320),
    updatedAt: project?.updatedAt || '',
    archived: project?.archived === true,
    counts: project?.counts || undefined,
  }));
}

export function agentCapabilitiesSnapshot() {
  return {
    fullControl: true,
    destructiveActionsEnabled: true,
    actions: [
      'run_full_pipeline', 'create_project', 'delete_project', 'open_project',
      'add_chapter', 'delete_chapter', 'split_chapter',
      'generate_episode', 'generate_all_episodes', 'generate_storyboard', 'generate_all_storyboards',
      'replace_shot', 'insert_shot_after', 'delete_shot', 'remove_shot_tag_bindings',
      'add_element', 'update_element', 'delete_element', 'clear_elements',
      'generate_image', 'run_batch_images',
      'upload_attachment_image', 'upload_attachment_reference_image', 'upload_attachment_variant_image', 'upload_attachment_outfit_image', 'upload_attachment_character_audio',
      'delete_reference_image', 'delete_character_audio',
      'generate_shot_video', 'generate_all_shot_videos', 'clear_shot_video', 'cancel_shot_queue', 'clear_pending_videos', 'clear_video_queue',
      'set_path', 'delete_path', 'api_get', 'api_post', 'save_project', 'save_script', 'save_settings',
    ],
    apiRoutes: [
      'GET /api/projects', 'GET /api/project?id=...', 'POST /api/project/create', 'POST /api/project/delete', 'POST /api/project/save',
      'POST /api/project/elements/clear', 'POST /api/project/element/add', 'POST /api/project/element/delete', 'POST /api/project/element', 'POST /api/project/elements/import', 'POST /api/project/elements/image-import',
      'POST /api/config', 'POST /api/extract', 'POST /api/image/generate', 'POST /api/image/batch',
      'POST /api/image/upload', 'POST /api/project/reference/upload', 'POST /api/project/reference/delete',
      'POST /api/character/reference/upload', 'POST /api/character/reference/delete', 'POST /api/character/audio/upload', 'POST /api/character/audio/delete',
      'POST /api/script/chapter', 'POST /api/script/chapter/split', 'POST /api/script/chapter/whole', 'POST /api/script/episode/recut',
      'POST /api/script/episode/import', 'POST /api/script/storyboard/import', 'POST /api/script/source',
      'POST /api/video/submit', 'POST /api/video/submit-batch', 'POST /api/video/pending/clear',
      'POST /api/export/folder', 'POST /api/export/to-folder', 'POST /api/video/open-folder', 'POST /api/video/export-to-jianying',
    ],
  };
}

export function agentShotSnapshot(shot, helpers = {}) {
  const { shotVideoUrl, shotVideoStatus, shotElementTags } = helpers;
  const tags = typeof shotElementTags === 'function' ? shotElementTags(shot) : [];
  return {
    no: shot.no,
    title: shot.title,
    duration: shot.duration,
    body: shot.body,
    hasVideo: typeof shotVideoUrl === 'function' ? !!shotVideoUrl(shot.no) : false,
    status: typeof shotVideoStatus === 'function' ? (shotVideoStatus(shot.no) || '') : '',
    tags: tags.map((tag) => ({
      name: tag.name,
      cat: tag.cat,
      hasImage: tag.hasImage,
      manual: tag.manual,
    })),
  };
}

export function agentAttachmentSnapshot(files = []) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    kind: file.kind,
    rawTextLength: file.rawTextLength,
    truncated: file.truncated,
  }));
}

export function buildAgentStateSnapshot(state = {}) {
  const agent = state.agent || {};
  const shots = (state.currentShots || []).map((shot) => {
    const snapshot = agentShotSnapshot(shot, state.shotHelpers);
    snapshot.body = truncateAgentStateText(snapshot.body, 1800);
    return snapshot;
  });
  return agentToPlain({
    agentCapabilities: agentCapabilitiesSnapshot(),
    view: state.view,
    settingsSection: state.settingsSection,
    currentCategory: state.currentCategory,
    selectedElementIndex: state.selectedElementIndex,
    elementsDrawerOpen: state.elementsDrawerOpen,
    scriptStage: state.scriptStage,
    selectedScriptId: state.selectedScriptId,
    storyboardEpisodeId: state.storyboardEpisodeId,
    agentUpload: {
      hasSourceText: !!String(agent.uploadedSourceText || '').trim(),
      sourceName: agent.uploadedSourceName,
      sourceLength: String(agent.uploadedSourceText || '').length,
    },
    agentAttachments: agentAttachmentSnapshot(agent.files),
    project: buildAgentProjectSnapshot(state.project, {
      currentCategory: state.currentCategory,
      selectedElementIndex: state.selectedElementIndex,
      instruction: state.instruction,
    }),
    script: buildAgentScriptSnapshot(state.script, state.storyboardEpisodeId),
    cfg: compactAgentStateValue(state.cfg, { stringLimit: 800, arrayLimit: 80, depth: 5 }),
    videoBar: compactAgentStateValue(state.videoBar, { stringLimit: 800, arrayLimit: 40, depth: 4 }),
    currentShots: shots,
    currentShotsNote: 'Read-only UI snapshot. Do not use as a set_path/delete_path root; use remove_shot_tag_bindings or storyboard/script actions for persistent changes.',
    projects: buildAgentProjectsSnapshot(state.projects),
  });
}

export function buildAgentRuntimeStateSnapshot(handlers = {}) {
  return buildAgentStateSnapshot({
    view: handlers.viewRef.value,
    settingsSection: handlers.settingsSectionRef.value,
    currentCategory: handlers.categoryRef.value,
    selectedElementIndex: handlers.selectedElementIndexRef.value,
    elementsDrawerOpen: handlers.elementsDrawerRef.value,
    scriptStage: handlers.scriptUi.stage,
    selectedScriptId: handlers.scriptUi.selectedId,
    storyboardEpisodeId: handlers.storyboardEpisodeIdRef.value,
    agent: handlers.agent,
    project: handlers.projectRef.value,
    script: handlers.scriptState,
    cfg: handlers.config,
    videoBar: handlers.videoBar,
    currentShots: handlers.currentShotsRef.value,
    shotHelpers: handlers.shotHelpers,
    projects: handlers.projectsRef.value,
    instruction: handlers.instruction,
  });
}

export function createAgentStateSnapshotRuntime({ refs = {}, helpers = {} } = {}) {
  return buildAgentRuntimeStateSnapshot({
    viewRef: refs.view,
    settingsSectionRef: refs.settingsSection,
    categoryRef: refs.category,
    selectedElementIndexRef: refs.selectedElementIndex,
    elementsDrawerRef: refs.elementsDrawer,
    scriptUi: refs.scriptUi,
    storyboardEpisodeIdRef: refs.storyboardEpisodeId,
    agent: refs.agent,
    projectRef: refs.project,
    scriptState: refs.scriptState,
    config: refs.config,
    videoBar: refs.videoBar,
    currentShotsRef: refs.currentShots,
    shotHelpers: helpers.shotHelpers,
    projectsRef: refs.projects,
  });
}

export function createAgentStatePathActionsRuntime({ refs = {}, helpers = {} } = {}) {
  const agentPathRoots = helpers.pathRoots || {};
  return {
    agentStateSnapshot: (instruction = '') => createAgentStateSnapshotRuntime({ refs, helpers: { ...helpers, instruction } }),
    agentSetPath: (pathText, value) => agentSetPath(agentPathRoots, pathText, value),
    agentDeletePath: (pathText) => agentDeletePath(agentPathRoots, pathText),
    agentFindElement: (category, action = {}) => agentFindElement(refs.project.value, category, action),
    agentFindAttachment: (action = {}, wantedKind = '') => agentFindAttachment(refs.agent.files, action, wantedKind),
  };
}

export async function persistAgentProjectFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const result = await handlers.saveProject({ project: agentToPlain(project) });
  if (!result.ok) throw new Error(result.error || 'Project save failed');
  const snapshot = handlers.captureUiState();
  handlers.setProject(result.project);
  handlers.hydrateScript(result.project);
  handlers.restoreUiState(snapshot);
}

export function createAgentPersistProjectRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    saveProject: (payload) => api.post('/api/project/save', payload),
    captureUiState: () => ({
      stage: refs.scriptUi.stage,
      selectedId: refs.scriptUi.selectedId,
      storyboardId: refs.storyboardEpisodeId.value,
    }),
    setProject: (value) => { refs.project.value = helpers.hydrateImageState(value); },
    hydrateScript: helpers.hydrateScript,
    restoreUiState: (state) => {
      refs.scriptUi.stage = state.stage;
      refs.scriptUi.selectedId = state.selectedId;
      refs.storyboardEpisodeId.value = state.storyboardId;
    },
  };
}

export async function persistAgentScriptFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  await handlers.saveScript(handlers.scriptPayload(project.id));
}

export function createAgentPersistScriptRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    scriptPayload: (projectId) => ({
      projectId,
      chapters: refs.scriptState.chapters,
      nextChapterId: refs.scriptState.nextChapterId,
      episodes: refs.scriptState.episodes,
      nextEpisodeId: refs.scriptState.nextEpisodeId,
      storyboards: refs.scriptState.storyboards,
      extractedSigs: refs.scriptState.extractedSigs,
      settings: refs.scriptState.settings,
    }),
    saveScript: (payload) => api.post('/api/script/source', payload),
  };
}

export function agentFindElement(project, category, action = {}) {
  const list = project?.elements?.[category] || [];
  let index = Number.isInteger(action.index) ? action.index : Number(action.index);
  if (!Number.isInteger(index) || index < 0) {
    const name = String(action.name || action.elementName || '').trim();
    index = list.findIndex((element) => String(element.name || '') === name);
  }
  if (index < 0 || !list[index]) throw new Error(`Element not found: ${category} ${action.name ?? action.index}`);
  return { element: list[index], index };
}

export function agentFindAttachment(files = [], action = {}, wantedKind = '') {
  let file = null;
  const id = String(action.attachmentId || action.fileId || '').trim();
  const name = String(action.attachmentName || action.fileName || '').trim();
  if (id) file = files.find((item) => item.id === id);
  if (!file && name) file = files.find((item) => item.name === name || item.name.includes(name));
  if (!file && wantedKind) file = files.find((item) => item.kind === wantedKind);
  if (!file) file = files[0];
  if (!file) throw new Error('没有可用的 Agent 附件');
  if (wantedKind && file.kind !== wantedKind) throw new Error(`附件不是${agentAttachmentLabel(wantedKind)}：${file.name}`);
  return file;
}

export function agentElementSaveBody(projectId, category, element, index) {
  const body = {
    projectId,
    category,
    index,
    name: String(element?.name || '').trim(),
    prompt: element?.prompt || '',
  };
  if (category === 'character') body.referenceMode = element?.referenceMode || 'none';
  return body;
}

export function applyAgentAddElement(project, currentCategory, action = {}) {
  const category = action.category || currentCategory;
  if (!project.elements[category]) project.elements[category] = [];
  const data = action.data && typeof action.data === 'object' ? action.data : {};
  project.elements[category].push({ name: action.name || data.name || '未命名', ...data });
  return {
    category,
    element: project.elements[category][project.elements[category].length - 1],
    index: project.elements[category].length - 1,
    messageName: action.name || data.name,
  };
}

export function applyAgentUpdateElement(project, currentCategory, action = {}) {
  const category = action.category || currentCategory;
  const found = agentFindElement(project, category, action);
  const updates = action.data || action.changes || action.patch;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates) || !Object.keys(updates).length) {
    throw new Error('Missing element update data');
  }
  Object.assign(found.element, updates);
  return { category, ...found };
}

export async function deleteAgentProjectFlow(action = {}, handlers = {}) {
  const currentProject = handlers.project();
  const projectId = String(action.projectId || action.id || action.name || currentProject?.id || '').trim();
  if (!projectId) throw new Error('Missing projectId');
  const result = await handlers.deleteProject({ projectId });
  if (!result.ok) throw new Error(result.error || `删除项目失败：${projectId}`);
  if (currentProject?.id === projectId) handlers.closeProject();
  await handlers.loadProjects();
  return { ok: true, message: `已删除项目 ${projectId}` };
}

export function createAgentDeleteProjectRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    deleteProject: (payload) => api.post('/api/project/delete', payload),
    closeProject: () => {
      refs.project.value = null;
      refs.view.value = 'projects';
      refs.selectedElementIndex.value = -1;
      refs.inspectorVisible.value = false;
      refs.elementsDrawer.value = false;
    },
    loadProjects: helpers.loadProjects,
  };
}

export async function clearAgentElementsFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const category = action.category && ['character', 'group', 'scene', 'prop', 'effect', 'creature'].includes(action.category) ? action.category : null;
  const result = await handlers.clearElements({ projectId: project.id, category });
  if (!result.ok) throw new Error(result.error || '清空元素失败');
  await handlers.refreshProject(project.id);
  handlers.selectElement(-1);
  return { ok: true, message: category ? `已清空${handlers.categoryLabel(category)}` : '已清空全部元素' };
}

export function createAgentClearElementsRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    clearElements: (payload) => api.post('/api/project/elements/clear', payload),
    refreshProject: async (projectId) => {
      const fresh = await api.get(`/api/project?id=${encodeURIComponent(projectId)}`);
      if (fresh.project) {
        refs.project.value = helpers.hydrateImageState(fresh.project);
        helpers.syncCharacterImageMode();
      }
    },
    selectElement: (index) => { refs.selectedElementIndex.value = index; },
    categoryLabel: (category) => helpers.categoryLabel?.(category) || helpers.categoryLabels?.[category] || category,
  };
}

export function createRunAgentClearElementsRuntime({ api, refs = {}, helpers = {} } = {}) {
  const context = createAgentClearElementsRuntime({ api, refs, helpers });
  return (action = {}) => clearAgentElementsFlow(action, context);
}

export async function deleteAgentElementFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const category = action.category || handlers.currentCategory();
  const found = agentFindElement(project, category, action);
  const removedName = found.element.name || `${category} ${found.index}`;
  const result = await handlers.deleteElement({ projectId: project.id, category, index: found.index });
  if (!result.ok) throw new Error(result.error || '删除元素失败');
  await handlers.refreshProject(project.id);
  handlers.setCategory(category);
  handlers.selectElement(-1);
  return { ok: true, message: `已删除元素 ${removedName}` };
}

export function createAgentDeleteElementRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    currentCategory: () => refs.category.value,
    deleteElement: (payload) => api.post('/api/project/element/delete', payload),
    refreshProject: async (projectId) => {
      const fresh = await api.get(`/api/project?id=${encodeURIComponent(projectId)}`);
      if (fresh.project) {
        refs.project.value = helpers.hydrateImageState(fresh.project);
        helpers.hydrateScript(fresh.project);
      }
    },
    setCategory: (category) => { refs.category.value = category; },
    selectElement: (index) => { refs.selectedElementIndex.value = index; },
  };
}

export async function addAgentChapterFlow(title, sourceText, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('请先创建或打开项目');
  const result = await handlers.addChapter({
    projectId: project.id,
    action: 'add',
    title: handlers.chapterTitle(title),
    sourceText,
  });
  if (!result.ok) throw new Error(result.error || '追加章节失败');
  handlers.appendChapter(result.chapter);
  handlers.selectChapter(result.chapter.id);
  return result.chapter;
}

export function createAgentAddChapterRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    chapterTitle: (title) => String(title || `第${refs.scriptState.chapters.length + 1}章`).trim(),
    addChapter: (payload) => api.post('/api/script/chapter', payload),
    appendChapter: (chapter) => { refs.scriptState.chapters.push(chapter); },
    selectChapter: (chapterId) => { refs.scriptUi.selectedId = `ch:${chapterId}`; },
  };
}

export async function splitAgentChapterFlow(chapterId, handlers = {}) {
  const result = await handlers.splitChapter({ projectId: handlers.project().id, chapterId });
  if (!result.ok) throw new Error(result.error || '分集失败');
  handlers.replaceChapterEpisodes(chapterId, result.episodes || []);
  return result.episodes || [];
}

export function createAgentSplitChapterRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    splitChapter: (payload) => api.post('/api/script/chapter/split', payload),
    replaceChapterEpisodes: (chapterId, episodes = []) => {
      const removedIds = refs.scriptState.episodes
        .filter((episode) => episode.chapterId === chapterId)
        .map((episode) => episode.id);
      refs.scriptState.episodes = refs.scriptState.episodes.filter((episode) => episode.chapterId !== chapterId);
      refs.scriptState.storyboards = refs.scriptState.storyboards.filter((storyboard) => !removedIds.includes(storyboard.episodeId));
      refs.scriptState.episodes.push(...episodes);
      refs.scriptState.episodes.sort((a, b) => a.id - b.id);
    },
  };
}

export async function extractAgentElementsForChapterFlow(chapter, force = true, handlers = {}) {
  const text = String(chapter?.sourceText || '').trim();
  if (!text) throw new Error('章节原文为空，无法提取元素');
  const sigs = { [chapter.id]: handlers.chapterSig(text) };
  const project = handlers.project();
  const result = await handlers.extract({ text, projectId: project.id, chapterSigs: sigs });
  if (result.error) throw new Error(result.error);
  handlers.assignExtractedSigs(sigs);
  const status = await handlers.pollExtract(result.jobId);
  if (status?.status === 'error') throw new Error(status.error || '元素提取失败');
  if (force) await handlers.openProject(project.id);
}

export function createAgentExtractElementsRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    chapterSig: helpers.chapterSig,
    extract: (payload) => api.post('/api/extract', payload),
    assignExtractedSigs: (sigs) => { Object.assign(refs.scriptState.extractedSigs, sigs); },
    pollExtract: helpers.pollExtract,
    openProject: helpers.openProject,
  };
}

export async function deleteAgentChapterFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const chapterId = Number(action.chapterId ?? action.id);
  const chapter = handlers.findChapter(chapterId);
  if (!chapter) throw new Error(`章节不存在：${chapterId}`);
  const result = await handlers.deleteChapter({ projectId: project.id, action: 'delete', chapterId });
  if (!result.ok) throw new Error(result.error || '删除章节失败');
  handlers.removeChapter(chapterId);
  return { ok: true, message: `已删除章节 ${chapter.title || chapterId}` };
}

export function createAgentDeleteChapterRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    findChapter: (chapterId) => refs.scriptState.chapters.find((chapter) => chapter.id === chapterId),
    deleteChapter: (payload) => api.post('/api/script/chapter', payload),
    removeChapter: (chapterId) => {
      const removedEpisodeIds = refs.scriptState.episodes
        .filter((episode) => episode.chapterId === chapterId)
        .map((episode) => episode.id);
      refs.scriptState.chapters = refs.scriptState.chapters.filter((chapter) => chapter.id !== chapterId);
      refs.scriptState.episodes = refs.scriptState.episodes.filter((episode) => episode.chapterId !== chapterId);
      refs.scriptState.storyboards = refs.scriptState.storyboards.filter((storyboard) => !removedEpisodeIds.includes(storyboard.episodeId));
    },
  };
}

export function createAgentDeletePersistActionsRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    agentDeleteProject: (action = {}) => deleteAgentProjectFlow(action, createAgentDeleteProjectRuntime({
      api,
      refs: {
        project: refs.project,
        view: refs.view,
        selectedElementIndex: refs.selectedElementIndex,
        inspectorVisible: refs.inspectorVisible,
        elementsDrawer: refs.elementsDrawer,
      },
      helpers: { loadProjects: helpers.loadProjects },
    })),
    agentDeleteElement: (action = {}) => deleteAgentElementFlow(action, createAgentDeleteElementRuntime({
      api,
      refs: {
        project: refs.project,
        category: refs.category,
        selectedElementIndex: refs.selectedElementIndex,
      },
      helpers: {
        hydrateImageState: helpers.hydrateImageState,
        hydrateScript: helpers.hydrateScript,
      },
    })),
    agentDeleteChapter: (action = {}) => deleteAgentChapterFlow(action, createAgentDeleteChapterRuntime({
      api,
      refs: {
        project: refs.project,
        scriptState: refs.scriptState,
      },
    })),
    agentPersistProject: () => persistAgentProjectFlow(createAgentPersistProjectRuntime({
      api,
      refs: {
        project: refs.project,
        scriptUi: refs.scriptUi,
        storyboardEpisodeId: refs.storyboardEpisodeId,
      },
      helpers: {
        hydrateImageState: helpers.hydrateImageState,
        hydrateScript: helpers.hydrateScript,
      },
    })),
    agentPersistScript: () => persistAgentScriptFlow(createAgentPersistScriptRuntime({
      api,
      refs: {
        project: refs.project,
        scriptState: refs.scriptState,
      },
    })),
  };
}

export function applyAgentGeneratedImageSlot(item) {
  if (!item) return;
  item.hasImage = true;
  item._imageName = item.name?.trim?.() || item._imageName || '';
  item._imgBroken = false;
  item._imgReload = 0;
  item.hasPendingImage = false;
  item._v = (item._v || 0) + 1;
  item._gen = false;
}

export async function uploadAgentElementImageFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const file = handlers.findAttachment(action, 'image');
  const category = action.category || handlers.currentCategory();
  const found = handlers.findElement(category, action);
  await handlers.saveElement(category, found.element, found.index);
  const result = await handlers.uploadImage({
    projectId: project.id,
    category,
    index: found.index,
    imageB64: file.b64,
  });
  if (!result.ok) throw new Error(result.error || '上传附件图片失败');
  applyAgentGeneratedImageSlot(found.element);
  handlers.selectElement(category, found.index);
  return { ok: true, message: `已把 ${file.name} 上传为 ${found.element.name} 的元素图` };
}

export function createAgentElementImageUploadRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    currentCategory: () => refs.category.value,
    findAttachment: (action, wantedKind) => agentFindAttachment(refs.agent.files, action, wantedKind),
    findElement: (category, action) => agentFindElement(refs.project.value, category, action),
    saveElement: (category, element, index) => (
      api.post('/api/project/element', agentElementSaveBody(refs.project.value.id, category, element, index))
    ),
    uploadImage: (payload) => api.post('/api/image/upload', payload),
    selectElement: (category, index) => {
      refs.category.value = category;
      refs.selectedElementIndex.value = index;
      refs.elementsDrawer.value = true;
    },
  };
}

export function applyAgentGlobalReferenceState(project, result = {}, enabled = true) {
  if (!project) return;
  project.globalReferenceImageName = result.globalReferenceImageName || '__全局风格参考图';
  project.hasGlobalReferenceImage = !!enabled;
  project.useGlobalReferenceImage = !!enabled;
  project._globalRefBroken = false;
  project._globalRefV = (project._globalRefV || 0) + 1;
}

export function applyAgentCharacterReferenceState(character, result = {}, enabled = true) {
  if (!character) return;
  character.referenceImageName = result.referenceImageName || `${character.name}_参考图`;
  character.hasReferenceImage = !!enabled;
  character.referenceMode = enabled ? 'character' : 'none';
  character.useReferenceImage = !!enabled;
  character._refImgBroken = false;
  character._refV = (character._refV || 0) + 1;
}

export async function uploadAgentReferenceImageFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const file = handlers.findAttachment(action, 'image');
  if (action.scope === 'global' || action.global === true) {
    const result = await handlers.uploadGlobalReference({ projectId: project.id, imageB64: file.b64 });
    if (!result.ok) throw new Error(result.error || '上传全局参考图失败');
    applyAgentGlobalReferenceState(project, result, true);
    return { ok: true, message: `已把 ${file.name} 设为全局参考图` };
  }

  const found = handlers.findElement('character', {
    index: action.charIndex ?? action.index,
    name: action.characterName || action.name,
  });
  await handlers.saveElement('character', found.element, found.index);
  const result = await handlers.uploadCharacterReference({
    projectId: project.id,
    charIndex: found.index,
    imageB64: file.b64,
  });
  if (!result.ok) throw new Error(result.error || '上传人物参考图失败');
  applyAgentCharacterReferenceState(found.element, result, true);
  handlers.selectElement('character', found.index);
  return { ok: true, message: `已把 ${file.name} 设为 ${found.element.name} 的参考图` };
}

export function createAgentReferenceImageUploadRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    findAttachment: (action, wantedKind) => agentFindAttachment(refs.agent.files, action, wantedKind),
    findElement: (category, action) => agentFindElement(refs.project.value, category, action),
    saveElement: (category, element, index) => (
      api.post('/api/project/element', agentElementSaveBody(refs.project.value.id, category, element, index))
    ),
    uploadGlobalReference: (payload) => api.post('/api/project/reference/upload', payload),
    uploadCharacterReference: (payload) => api.post('/api/character/reference/upload', payload),
    selectElement: (category, index) => {
      refs.category.value = category;
      refs.selectedElementIndex.value = index;
      refs.elementsDrawer.value = true;
    },
  };
}

export async function uploadAgentVariantImageFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const file = handlers.findAttachment(action, 'image');
  const found = agentFindCharacterSubItem(project, action, 'variants');
  const result = await handlers.uploadVariantImage({
    projectId: project.id,
    charIndex: found.charIndex,
    variantIndex: found.index,
    imageB64: file.b64,
  });
  if (!result.ok) throw new Error(result.error || '上传形态图失败');
  applyAgentGeneratedImageSlot(found.item);
  handlers.selectElement('character', found.charIndex);
  return { ok: true, message: `已把 ${file.name} 上传为 ${found.character.name} 的形态图` };
}

export function createAgentVariantImageUploadRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    findAttachment: (action, wantedKind) => agentFindAttachment(refs.agent.files, action, wantedKind),
    uploadVariantImage: (payload) => api.post('/api/image/variant/upload', payload),
    selectElement: (category, index) => {
      refs.category.value = category;
      refs.selectedElementIndex.value = index;
      refs.elementsDrawer.value = true;
    },
  };
}

export async function uploadAgentOutfitImageFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const file = handlers.findAttachment(action, 'image');
  const found = agentFindCharacterSubItem(project, action, 'outfits');
  const result = await handlers.uploadOutfitImage({
    projectId: project.id,
    charIndex: found.charIndex,
    outfitIndex: found.index,
    imageB64: file.b64,
  });
  if (!result.ok) throw new Error(result.error || '上传服装图失败');
  applyAgentGeneratedImageSlot(found.item);
  handlers.selectElement('character', found.charIndex);
  return { ok: true, message: `已把 ${file.name} 上传为 ${found.character.name} 的服装图` };
}

export function createAgentOutfitImageUploadRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    findAttachment: (action, wantedKind) => agentFindAttachment(refs.agent.files, action, wantedKind),
    uploadOutfitImage: (payload) => api.post('/api/image/outfit/upload', payload),
    selectElement: (category, index) => {
      refs.category.value = category;
      refs.selectedElementIndex.value = index;
      refs.elementsDrawer.value = true;
    },
  };
}

export async function clearAgentReferenceImageFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  if (action.scope === 'global' || action.global === true) {
    const result = await handlers.deleteGlobalReference({ projectId: project.id });
    if (!result.ok) throw new Error(result.error || '删除全局参考图失败');
    applyAgentGlobalReferenceState(project, result, false);
    return { ok: true, message: '已删除全局参考图' };
  }
  const found = handlers.findElement('character', {
    index: action.charIndex ?? action.index,
    name: action.characterName || action.name,
  });
  const result = await handlers.deleteCharacterReference({ projectId: project.id, charIndex: found.index });
  if (!result.ok) throw new Error(result.error || '删除人物参考图失败');
  applyAgentCharacterReferenceState(found.element, result, false);
  return { ok: true, message: `已删除 ${found.element.name} 的参考图` };
}

export function applyAgentCharacterVoiceState(character, result = {}, enabled = true) {
  if (!character) return;
  character.hasVoiceAudio = !!enabled;
  character.voiceAudioName = result.voiceAudioName || `${character.name}_音频`;
  character.voiceAudioUrl = enabled ? (result.voiceAudioUrl || '') : '';
  if (!enabled) character.voiceAudioUpdatedAt = '';
  character._voiceV = (character._voiceV || 0) + 1;
}

export async function uploadAgentCharacterAudioFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const file = handlers.findAttachment(action, 'audio');
  const found = handlers.findElement('character', {
    index: action.charIndex ?? action.index,
    name: action.characterName || action.name,
  });
  const result = await handlers.uploadCharacterAudio({
    projectId: project.id,
    charIndex: found.index,
    audioB64: file.b64,
    fileName: file.name,
    mimeType: file.type,
  });
  if (!result.ok) throw new Error(result.error || '上传人物音频失败');
  applyAgentCharacterVoiceState(found.element, result, true);
  handlers.selectElement('character', found.index);
  return { ok: true, message: `已把 ${file.name} 设为 ${found.element.name} 的语音参考` };
}

export function createAgentCharacterAudioUploadRuntime({ api, refs = {} } = {}) {
  return {
    project: () => refs.project.value,
    findAttachment: (action, wantedKind) => agentFindAttachment(refs.agent.files, action, wantedKind),
    findElement: (category, action) => agentFindElement(refs.project.value, category, action),
    uploadCharacterAudio: (payload) => api.post('/api/character/audio/upload', payload),
    selectElement: (category, index) => {
      refs.category.value = category;
      refs.selectedElementIndex.value = index;
      refs.elementsDrawer.value = true;
    },
  };
}

export function createAgentAttachmentActionsRuntime({ api, refs = {} } = {}) {
  return {
    agentUploadAttachmentImage: (action = {}) => uploadAgentElementImageFlow(action, createAgentElementImageUploadRuntime({
      api,
      refs,
    })),
    agentUploadAttachmentReferenceImage: (action = {}) => uploadAgentReferenceImageFlow(action, createAgentReferenceImageUploadRuntime({
      api,
      refs,
    })),
    agentUploadAttachmentVariantImage: (action = {}) => uploadAgentVariantImageFlow(action, createAgentVariantImageUploadRuntime({
      api,
      refs,
    })),
    agentUploadAttachmentOutfitImage: (action = {}) => uploadAgentOutfitImageFlow(action, createAgentOutfitImageUploadRuntime({
      api,
      refs,
    })),
    agentUploadAttachmentCharacterAudio: (action = {}) => uploadAgentCharacterAudioFlow(action, createAgentCharacterAudioUploadRuntime({
      api,
      refs,
    })),
  };
}

export async function clearAgentCharacterAudioFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const found = handlers.findElement('character', {
    index: action.charIndex ?? action.index,
    name: action.characterName || action.name,
  });
  const result = await handlers.deleteCharacterAudio({ projectId: project.id, charIndex: found.index });
  if (!result.ok) throw new Error(result.error || '删除人物音频失败');
  applyAgentCharacterVoiceState(found.element, result, false);
  return { ok: true, message: `已删除 ${found.element.name} 的语音参考` };
}

export async function clearAgentShotVideoFlow(action = {}, handlers = {}) {
  if (!handlers.hasProject()) throw new Error('No project open');
  const no = agentShotNoFromAction(action);
  if (action.episodeId != null) handlers.setEpisode(Number(action.episodeId));
  await handlers.clearShotVideo(no);
  return { ok: true, message: `已清除镜头 ${no} 的视频` };
}

export async function cancelAgentShotQueueFlow(action = {}, handlers = {}) {
  if (!handlers.hasProject()) throw new Error('No project open');
  const no = agentShotNoFromAction(action);
  if (action.episodeId != null) handlers.setEpisode(Number(action.episodeId));
  await handlers.cancelShotQueue(no);
  return { ok: true, message: `已清除镜头 ${no} 的后台追踪` };
}

export async function clearAgentPendingVideosFlow(action = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) throw new Error('No project open');
  const episodeId = agentEpisodeIdFromAction(action, handlers.currentEpisodeId());
  const result = await handlers.clearPendingVideos({ projectId: project.id, episodeId });
  clearAgentQueuedShotStatuses(handlers.shotStatus());
  return { ok: true, message: `已清除 ${result.cleared || 0} 个后台追踪任务` };
}

export function clearAgentVideoQueueFlow(handlers = {}) {
  handlers.clearVideoQueue();
  return { ok: true, message: '已清空本地待提交镜头' };
}

export function createAgentCleanupActionsRuntime({ api, refs = {}, helpers = {} } = {}) {
  return {
    agentClearCharacterReference: (action = {}) => clearAgentReferenceImageFlow(action, {
      project: () => refs.project.value,
      findElement: helpers.findElement,
      deleteGlobalReference: (payload) => api.post('/api/project/reference/delete', payload),
      deleteCharacterReference: (payload) => api.post('/api/character/reference/delete', payload),
    }),
    agentClearCharacterAudio: (action = {}) => clearAgentCharacterAudioFlow(action, {
      project: () => refs.project.value,
      findElement: helpers.findElement,
      deleteCharacterAudio: (payload) => api.post('/api/character/audio/delete', payload),
    }),
    agentClearShotVideo: (action = {}) => clearAgentShotVideoFlow(action, {
      hasProject: () => !!refs.project.value,
      setEpisode: (episodeId) => { refs.episodeId.value = episodeId; },
      clearShotVideo: helpers.clearShotVideo,
    }),
    agentCancelShotQueue: (action = {}) => cancelAgentShotQueueFlow(action, {
      hasProject: () => !!refs.project.value,
      setEpisode: (episodeId) => { refs.episodeId.value = episodeId; },
      cancelShotQueue: helpers.cancelShotQueue,
    }),
    agentClearPendingVideos: (action = {}) => clearAgentPendingVideosFlow(action, {
      project: () => refs.project.value,
      currentEpisodeId: () => refs.episodeId.value,
      clearPendingVideos: (payload) => api.post('/api/video/pending/clear', payload),
      shotStatus: () => refs.shotStatus,
    }),
    agentClearVideoQueue: () => clearAgentVideoQueueFlow({
      clearVideoQueue: helpers.clearVideoQueue,
    }),
  };
}

export function agentShotNoFromAction(action = {}) {
  const no = action.shotNo ?? action.no;
  if (no == null) throw new Error('Missing shotNo');
  return no;
}

export function agentEpisodeIdFromAction(action = {}, fallbackEpisodeId = null) {
  if (action.episodeId === 'all') return null;
  return action.episodeId ?? fallbackEpisodeId;
}

export function clearAgentQueuedShotStatuses(statusMap) {
  if (!statusMap || typeof statusMap !== 'object') return 0;
  let removed = 0;
  for (const key of Object.keys(statusMap)) {
    if (statusMap[key] !== 'queued') continue;
    delete statusMap[key];
    removed++;
  }
  return removed;
}

export async function runAgentActionPipeline(action, runners = []) {
  if (!action || typeof action !== 'object') return { ok: false, message: 'Empty action' };
  for (const runner of runners) {
    if (typeof runner !== 'function') continue;
    const result = await runner(action);
    if (result) return result;
  }
  return { ok: false, message: `Unknown action: ${action.type}` };
}

export async function runAgentFullPipelineFlow(action = {}, handlers = {}) {
  if (handlers.isRunning()) throw new Error('全流程正在运行');
  const sourceText = String(handlers.resolveSourceText(action) || '');
  if (!sourceText.trim()) throw new Error('请先上传 TXT，或在指令里提供小说原文');
  const submitVideo = action.submitVideo === true || action.generateVideo === true || handlers.shouldSubmitVideo() === true;
  const onlyMissingImages = action.onlyMissingImages !== false && handlers.shouldOnlyGenerateMissingImages() !== false;
  const pipelineSteps = 6 + (action.generateImages !== false ? 1 : 0) + (submitVideo ? 1 : 0);
  let pipelineStep = 0;
  const advancePipeline = (label, detail = '') => {
    pipelineStep += 1;
    handlers.setProgress({
      label,
      detail,
      current: pipelineStep,
      total: pipelineSteps,
      status: '',
    });
  };
  handlers.setRunning(true);
  handlers.setProgress({ label: '准备全流程', detail: '检查原文和项目', current: 0, total: pipelineSteps, percentage: 2, status: '' });
  try {
    let projectId = action.projectId || '';
    if (projectId) {
      advancePipeline('打开项目', projectId);
      await handlers.openProject(projectId);
      handlers.log(`打开项目：${projectId}`, 'success');
    } else {
      advancePipeline('创建项目', action.projectName || action.title || '');
      projectId = await handlers.createProject(action.projectName || action.title);
      handlers.log(`创建项目：${projectId}`, 'success');
    }

    advancePipeline('写入原文', `${sourceText.length} 字`);
    const chapter = await handlers.addChapter(action.chapterTitle || '导入原文', sourceText);
    handlers.log(`写入原文：${sourceText.length} 字`, 'success');

    advancePipeline('提取元素', '人物、场景、道具、特效');
    handlers.log('开始提取人物/场景/道具/特效');
    await handlers.extractElementsForChapter(chapter);
    handlers.log('元素提取完成', 'success');

    advancePipeline('按原文分集');
    handlers.log('开始按原文分集');
    const episodes = await handlers.splitChapter(chapter.id);
    if (!episodes.length) throw new Error('未能分出剧集');
    handlers.log(`已分出 ${episodes.length} 集`, 'success');

    advancePipeline('生成剧本和分镜', `${episodes.length} 集`);
    await handlers.generateStoryboardsForEpisodes(episodes, action.requirement || '');
    handlers.log('剧本和分镜生成完成', 'success');

    if (action.generateImages !== false) {
      advancePipeline('批量生成元素图', onlyMissingImages ? '只补缺图' : '全部重生成');
      handlers.log('开始批量生成元素图');
      await handlers.runBatch(onlyMissingImages);
      handlers.log('元素图生成完成', 'success');
    }

    if (submitVideo) {
      advancePipeline('提交视频任务', `${episodes.length} 集`);
      handlers.log('开始提交视频生成任务');
      await handlers.submitVideosForEpisodes(episodes);
      handlers.log('视频任务已提交，生成结果会在后台拉回', 'success');
    } else {
      handlers.log('已跳过视频提交，可稍后指令 Agent 生成视频');
    }

    advancePipeline('刷新项目状态');
    await handlers.openProject(handlers.currentProjectId());
    handlers.showStoryboardEpisode(episodes[0].id);
    handlers.finishProgress('全流程完成');
    return {
      ok: true,
      message: submitVideo
        ? `全流程已跑完并提交视频任务：${episodes.length} 集`
        : `全流程已跑完到分镜和元素图：${episodes.length} 集`,
    };
  } finally {
    handlers.setRunning(false);
  }
}

export function createAgentFullPipelineContext(handlers = {}) {
  return {
    isRunning: () => handlers.agent.pipelineRunning,
    setRunning: (running) => { handlers.agent.pipelineRunning = running; },
    resolveSourceText: handlers.resolveSourceText,
    shouldSubmitVideo: () => handlers.agent.pipelineSubmitVideo === true,
    shouldOnlyGenerateMissingImages: () => handlers.agent.pipelineOnlyMissingImages !== false,
    setProgress: handlers.setProgress,
    openProject: handlers.openProject,
    createProject: handlers.createProject,
    addChapter: handlers.addChapter,
    extractElementsForChapter: handlers.extractElementsForChapter,
    splitChapter: handlers.splitChapter,
    generateStoryboardsForEpisodes: handlers.generateStoryboardsForEpisodes,
    runBatch: handlers.runBatch,
    submitVideosForEpisodes: handlers.submitVideosForEpisodes,
    currentProjectId: () => handlers.projectRef.value.id,
    showStoryboardEpisode: (episodeId) => {
      handlers.scriptUi.stage = 'storyboard';
      handlers.storyboardEpisodeIdRef.value = episodeId;
    },
    finishProgress: handlers.finishProgress,
    log: handlers.log,
  };
}

export function createAgentFullPipelineRuntime({ refs = {}, helpers = {}, log } = {}) {
  return createAgentFullPipelineContext({
    agent: refs.agent,
    resolveSourceText: helpers.resolveSourceText,
    setProgress: helpers.setProgress,
    openProject: helpers.openProject,
    createProject: helpers.createProject,
    addChapter: helpers.addChapter,
    extractElementsForChapter: helpers.extractElementsForChapter,
    splitChapter: helpers.splitChapter,
    generateStoryboardsForEpisodes: helpers.generateStoryboardsForEpisodes,
    runBatch: helpers.runBatch,
    submitVideosForEpisodes: helpers.submitVideosForEpisodes,
    projectRef: refs.project,
    scriptUi: refs.scriptUi,
    storyboardEpisodeIdRef: refs.storyboardEpisodeId,
    finishProgress: helpers.finishProgress,
    log,
  });
}

export function createAgentPipelineActionsRuntime({
  api,
  refs = {},
  helpers = {},
  video = {},
  message = {},
  log,
} = {}) {
  const agentCreateProject = async (name) => {
    const projectName = sanitizeAgentProjectName(name);
    const result = await api.post('/api/project/create', { name: projectName });
    if (result.error) throw new Error(result.error);
    await helpers.loadProjects();
    await helpers.openProject(result.projectId);
    return result.projectId;
  };

  const agentAddChapter = (title, sourceText) => addAgentChapterFlow(title, sourceText, createAgentAddChapterRuntime({
    api,
    refs: { project: refs.project, scriptState: refs.scriptState, scriptUi: refs.scriptUi },
  }));

  const agentSplitChapter = (chapterId) => splitAgentChapterFlow(chapterId, createAgentSplitChapterRuntime({
    api,
    refs: { project: refs.project, scriptState: refs.scriptState },
  }));

  const agentExtractElementsForChapter = (chapter, force = true) => extractAgentElementsForChapterFlow(chapter, force, createAgentExtractElementsRuntime({
    api,
    refs: { project: refs.project, scriptState: refs.scriptState },
    helpers: {
      chapterSig: helpers.chapterSig,
      pollExtract: helpers.pollExtract,
      openProject: helpers.openProject,
    },
  }));

  const agentGenerateStoryboardsForEpisodes = async (episodes, requirement = '') => {
    for (const ep of episodes) {
      log(`生成第 ${ep.id} 集剧本`);
      await helpers.generateEpisode(ep.id, requirement, true);
      log(`生成第 ${ep.id} 集分镜`);
      await helpers.generateStoryboard(ep.id, 'normal', requirement, true, true);
    }
  };

  const agentSubmitVideosForEpisodes = (episodes) => runAgentVideoSubmitFlow(episodes, createAgentVideoSubmitContext(createAgentVideoSubmitRuntime({
    api,
    refs: {
      config: refs.config,
      storyboardEpisodeId: refs.storyboardEpisodeId,
      videoBar: refs.videoBar,
      providerLabel: refs.providerLabel,
      project: refs.project,
      shotStatus: refs.shotStatus,
    },
    helpers: {
      nextTick: helpers.nextTick,
      hydrateShotVideos: helpers.hydrateShotVideos,
      loadVideoBar: helpers.loadVideoBar,
      findStoryboard: helpers.findStoryboard,
      parseShots: helpers.parseShots,
      shotVideoUrl: helpers.shotVideoUrl,
      buildShotSubmit: helpers.buildShotSubmit,
      startPendingPoll: helpers.startPendingPoll,
    },
    video,
    log,
  })));

  const runAgentFullPipeline = (action = {}) => runAgentFullPipelineFlow(action, createAgentFullPipelineRuntime({
    refs: {
      agent: refs.agent,
      project: refs.project,
      scriptUi: refs.scriptUi,
      storyboardEpisodeId: refs.storyboardEpisodeId,
    },
    helpers: {
      resolveSourceText: helpers.resolveSourceText,
      setProgress: helpers.setProgress,
      openProject: helpers.openProject,
      createProject: agentCreateProject,
      addChapter: agentAddChapter,
      extractElementsForChapter: agentExtractElementsForChapter,
      splitChapter: agentSplitChapter,
      generateStoryboardsForEpisodes: agentGenerateStoryboardsForEpisodes,
      runBatch: helpers.runBatch,
      submitVideosForEpisodes: agentSubmitVideosForEpisodes,
      finishProgress: helpers.finishProgress,
    },
    log,
  }));

  const runAgentUploadedPipeline = () => runAgentUploadedPipelineFlow(refs.agent, {
    runFullPipeline: runAgentFullPipeline,
    log,
    failProgress: helpers.failProgress,
    success: (text) => message.success(text),
    error: (text) => message.error(text),
  });

  return {
    agentCreateProject,
    agentAddChapter,
    agentSplitChapter,
    agentExtractElementsForChapter,
    agentGenerateStoryboardsForEpisodes,
    agentSubmitVideosForEpisodes,
    runAgentFullPipeline,
    runAgentUploadedPipeline,
  };
}

export async function runAgentVideoSubmitFlow(episodes = [], handlers = {}) {
  let submittedAny = false;
  for (const ep of episodes) {
    handlers.setCurrentEpisodeId(ep.id);
    await handlers.afterEpisodeChange();
    handlers.hydrateShotVideos();
    handlers.loadVideoBar();
    const provider = handlers.currentProvider();
    const providerLabel = handlers.providerLabel();
    if (provider === 'dreamina-cli' && handlers.isTrueMentionVideoMode()) {
      handlers.log(`即梦 CLI 将通过 @Image1/@Audio1 槽位说明绑定第 ${ep.id} 集的图片/音频`, 'info');
    }
    if (provider === 'libtv-cli' && handlers.isTrueMentionVideoMode()) {
      handlers.log(`LibTV CLI 将把第 ${ep.id} 集的参考素材上传为画布节点，并通过 {{Node "节点名"}} 引用`, 'info');
    }
    const accounts = provider === 'xiaoyunque' ? handlers.xiaoyunqueAccounts() : [];
    if (provider === 'xiaoyunque' && !accounts?.length) {
      handlers.log(`未配置${providerLabel}线路，已跳过第 ${ep.id} 集视频提交`, 'warning');
      continue;
    }
    if (provider === 'video-api' && !handlers.hasVideoApiKey()) {
      handlers.log(`未配置${providerLabel} API Key，已跳过第 ${ep.id} 集视频提交`, 'warning');
      continue;
    }
    if (provider === 'updream' && !handlers.hasUpdreamToken()) {
      handlers.log(`未配置${providerLabel} Token，已跳过第 ${ep.id} 集视频提交`, 'warning');
      continue;
    }
    if (provider === 'neowow' && !handlers.hasNeowowToken()) {
      handlers.log(`未配置${providerLabel} Token，已跳过第 ${ep.id} 集视频提交`, 'warning');
      continue;
    }
    if (provider === 'libtv-cli' && !handlers.hasLibtvProject()) {
      handlers.log(`未配置 LibTV 画布 UUID，已跳过第 ${ep.id} 集视频提交`, 'warning');
      continue;
    }
    const storyboard = handlers.findStoryboard(ep.id);
    const shots = handlers.parseShots(storyboard?.content || '');
    const pending = [];
    for (const shot of shots) {
      if (handlers.shotVideoUrl(shot.no)) continue;
      const submit = handlers.buildShotSubmit(shot);
      if (submit) pending.push(submit);
    }
    if (!pending.length) {
      handlers.log(`第 ${ep.id} 集没有可提交的视频镜头，可能缺少元素图`, 'warning');
      continue;
    }
    const result = await handlers.submitVideoBatch({
      projectId: handlers.currentProjectId(),
      episodeId: ep.id,
      shots: pending,
    });
    if (!result.jobId) {
      handlers.log(`第 ${ep.id} 集视频提交失败：${result.error || '未知错误'}`, 'error');
      continue;
    }
    for (const submit of pending) handlers.markShotQueued(ep.id, submit.shotNo);
    submittedAny = true;
    handlers.log(`第 ${ep.id} 集已提交 ${pending.length} 个视频镜头到${providerLabel}`, 'success');
  }
  if (submittedAny) handlers.startPendingPoll();
}

export function createAgentVideoSubmitContext(handlers = {}) {
  return {
    setCurrentEpisodeId: (episodeId) => { handlers.storyboardEpisodeIdRef.value = episodeId; },
    afterEpisodeChange: handlers.nextTick,
    hydrateShotVideos: handlers.hydrateShotVideos,
    loadVideoBar: handlers.loadVideoBar,
    currentProvider: () => handlers.normalizeVideoProvider(handlers.videoBar.provider),
    providerLabel: () => handlers.providerLabelRef.value,
    isTrueMentionVideoMode: handlers.isTrueMentionVideoMode,
    xiaoyunqueAccounts: () => handlers.config.video?.xiaoyunqueAccounts,
    hasVideoApiKey: () => !!(handlers.config.video.apiHasKey || (handlers.config.video.apiKey && !String(handlers.config.video.apiKey).includes('****'))),
    hasUpdreamToken: () => !!(
      handlers.config.video.updreamHasAccessToken
      || handlers.config.video.updreamHasRefreshToken
      || (handlers.config.video.updreamAccessToken && !String(handlers.config.video.updreamAccessToken).includes('****'))
      || (handlers.config.video.updreamRefreshToken && !String(handlers.config.video.updreamRefreshToken).includes('****'))
    ),
    hasNeowowToken: () => !!(
      handlers.config.video.neowowHasToken
      || (handlers.config.video.neowowToken && !String(handlers.config.video.neowowToken).includes('****'))
    ),
    hasLibtvProject: () => !!String(handlers.config.video.libtvProjectUuid || '').trim(),
    findStoryboard: handlers.findStoryboard,
    parseShots: handlers.parseShots,
    shotVideoUrl: handlers.shotVideoUrl,
    buildShotSubmit: handlers.buildShotSubmit,
    currentProjectId: () => handlers.projectRef.value.id,
    submitVideoBatch: (payload) => handlers.api.post('/api/video/submit-batch', handlers.videoSubmitPayload(payload)),
    markShotQueued: (episodeId, shotNo) => { handlers.shotStatus[`${episodeId}:${shotNo}`] = 'queued'; },
    startPendingPoll: handlers.startPendingPoll,
    log: handlers.log,
  };
}

export function createAgentVideoSubmitRuntime({ api, refs = {}, helpers = {}, video = {}, log } = {}) {
  return {
    api,
    config: refs.config,
    storyboardEpisodeIdRef: refs.storyboardEpisodeId,
    nextTick: helpers.nextTick,
    hydrateShotVideos: helpers.hydrateShotVideos,
    loadVideoBar: helpers.loadVideoBar,
    normalizeVideoProvider: video.normalizeVideoProvider,
    videoBar: refs.videoBar,
    providerLabelRef: refs.providerLabel,
    isTrueMentionVideoMode: video.isTrueMentionVideoMode,
    findStoryboard: helpers.findStoryboard,
    parseShots: helpers.parseShots,
    shotVideoUrl: helpers.shotVideoUrl,
    buildShotSubmit: helpers.buildShotSubmit,
    projectRef: refs.project,
    videoSubmitPayload: video.videoSubmitPayload,
    shotStatus: refs.shotStatus,
    startPendingPoll: helpers.startPendingPoll,
    log,
  };
}

export async function runAgentUploadedPipelineFlow(agent, handlers = {}) {
  if (agent.running || agent.pipelineRunning) return;
  agent.running = true;
  const instruction = agent.pipelineSubmitVideo ? '用上传的 TXT 跑全流程并提交视频' : '用上传的 TXT 跑全流程';
  agent.messages.push({ role: 'user', content: instruction, time: new Date().toLocaleTimeString() });
  try {
    const result = await handlers.runFullPipeline({ sourceText: '$uploaded', submitVideo: agent.pipelineSubmitVideo });
    agent.messages.push({ role: 'agent', content: result.message, time: new Date().toLocaleTimeString() });
    handlers.success(result.message);
  } catch (error) {
    agent.messages.push({ role: 'agent', content: `执行失败：${error.message}`, time: new Date().toLocaleTimeString() });
    handlers.log(error.message, 'error');
    handlers.failProgress(error.message);
    handlers.error(`Agent 执行失败：${error.message}`);
  } finally {
    agent.running = false;
  }
}

export function createAgentInstructionRuntime({ api, message, helpers = {}, log } = {}) {
  return {
    attachmentSummary: helpers.attachmentSummary,
    plan: (payload) => api.post('/api/agent/plan', payload),
    stateSnapshot: helpers.stateSnapshot,
    executeAction: helpers.executeAction,
    setProgress: helpers.setProgress,
    finishProgress: helpers.finishProgress,
    failProgress: helpers.failProgress,
    clearFiles: helpers.clearFiles,
    showInfo: (value) => message.info(value),
    showSuccess: (value) => message.success(value),
    showError: (value) => message.error(value),
    log,
  };
}

export function createRunAgentInstructionRuntime({ api, message, agent, helpers = {}, log } = {}) {
  const runtime = createAgentInstructionRuntime({ api, message, helpers, log });
  return () => runAgentInstructionFlow(agent, runtime);
}

export async function runAgentInstructionFlow(agent, handlers = {}) {
  const instruction = String(agent.input || '').trim();
  const files = Array.isArray(agent.files) ? agent.files : [];
  if ((!instruction && !files.length) || agent.running) return;
  agent.running = true;
  let completed = false;
  const attachments = files.map(agentAttachmentPayload);
  const fileSummary = handlers.attachmentSummary();
  const requestInstruction = instruction || `处理这些附件：${fileSummary}`;
  const displayInstruction = instruction || '处理已附加文件';
  agent.input = '';
  const userMsg = {
    role: 'user',
    content: fileSummary ? `${displayInstruction}\n\n附件：${fileSummary}` : displayInstruction,
    time: new Date().toLocaleTimeString(),
  };
  agent.messages.push(userMsg);
  handlers.log(`收到指令：${displayInstruction}`);
  handlers.setProgress({ label: '正在理解指令', detail: '请求 Agent 规划动作', current: 0, total: 0, percentage: 5, status: '' });
  try {
    const result = await handlers.plan({
      instruction: requestInstruction,
      state: handlers.stateSnapshot(requestInstruction),
      history: agent.messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
      attachments,
    });
    if (!result.ok) throw new Error(result.error || 'Agent planning failed');
    const plan = result.plan || { reply: '', actions: [] };
    agent.lastPlan = plan;
    agent.messages.push({ role: 'agent', content: plan.reply || '我开始执行。', time: new Date().toLocaleTimeString() });
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    handlers.log(`计划执行 ${actions.length} 个动作`, 'success');
    if (!actions.length) {
      handlers.setProgress({ label: '没有需要执行的动作', detail: plan.reply || '', current: 1, total: 1, percentage: 100, status: 'success' });
    }
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const actionLabel = action?.type ? `执行 ${action.type}` : '执行动作';
      if (action?.type !== 'run_full_pipeline') {
        handlers.setProgress({
          label: actionLabel,
          detail: `${i + 1} / ${actions.length}`,
          current: i,
          total: actions.length,
          percentage: Math.round(10 + (i / actions.length) * 85),
          status: '',
        });
      }
      const actionResult = await handlers.executeAction(action);
      handlers.log(`${actionResult.ok ? '完成' : '跳过'}：${actionResult.message}`, actionResult.ok ? 'success' : 'warning');
      if (!actionResult?.ok) {
        throw new Error(actionResult?.message || `${actionLabel}失败`);
      }
      if (action?.type !== 'run_full_pipeline') {
        handlers.setProgress({
          label: actionResult.message || actionLabel,
          detail: `${i + 1} / ${actions.length}`,
          current: i + 1,
          total: actions.length,
          percentage: Math.round(10 + ((i + 1) / actions.length) * 85),
          status: actionResult.ok ? '' : 'warning',
        });
      }
    }
    if (!actions.length && plan.reply) handlers.showInfo(plan.reply);
    else handlers.showSuccess('Agent 已执行完成');
    handlers.finishProgress('Agent 执行完成');
    completed = true;
  } catch (error) {
    agent.messages.push({ role: 'agent', content: `执行失败：${error.message}`, time: new Date().toLocaleTimeString() });
    handlers.log(error.message, 'error');
    handlers.failProgress(error.message);
    handlers.showError(`Agent 执行失败：${error.message}`);
  } finally {
    if (completed && attachments.length) handlers.clearFiles({ silent: true });
    agent.running = false;
  }
}

export async function runAgentSimpleAction(action = {}, handlers = {}) {
  switch (action?.type) {
    case 'set_path': {
      const rootName = handlers.setPath(action.path, action.value);
      const persist = ['project', 'script', 'settings', 'none'].includes(action.persist)
        ? action.persist
        : ({ project: 'project', script: 'script', scriptState: 'script', cfg: 'settings', videoBar: 'settings' }[rootName] || 'none');
      if (persist === 'project') await handlers.saveProject();
      else if (persist === 'script') await handlers.saveScript();
      else if (persist === 'settings') await handlers.saveSettings();
      return { ok: true, message: `写入 ${action.path}` };
    }
    case 'delete_path': {
      const rootName = handlers.deletePath(action.path);
      if (action.persist === 'project' || rootName === 'project') await handlers.saveProject();
      else if (action.persist === 'script' || rootName === 'script') await handlers.saveScript();
      else if (action.persist === 'settings' || rootName === 'cfg' || rootName === 'videoBar') await handlers.saveSettings();
      return { ok: true, message: `已删除 ${action.path}` };
    }
    case 'api_get':
      return { ok: true, message: action.url, data: await handlers.api.get(action.url) };
    case 'api_post':
      return { ok: true, message: action.url, data: await handlers.api.post(action.url, action.body || {}) };
    case 'save_project':
      await handlers.saveProject();
      return { ok: true, message: '项目已保存' };
    case 'save_script':
      await handlers.saveScript();
      return { ok: true, message: '剧本/分镜已保存' };
    case 'save_settings':
      await handlers.saveSettings();
      return { ok: true, message: '设置已保存' };
    case 'show_message':
      handlers.showMessage?.(action.level || 'info', action.message || '');
      return { ok: true, message: action.message || '' };
    default:
      return null;
  }
}

export async function runAgentNavigationAction(action = {}, handlers = {}) {
  switch (action?.type) {
    case 'set_view': {
      const nextView = action.view || handlers.currentView?.();
      handlers.setView?.(nextView);
      return { ok: true, message: `切换到 ${nextView}` };
    }
    case 'open_project':
      await handlers.openProject?.(action.projectId);
      return { ok: true, message: `打开项目 ${action.projectId}` };
    case 'set_stage': {
      const stage = action.stage === 'storyboard' ? 'storyboard' : 'script';
      handlers.setStage?.(stage);
      return { ok: true, message: `切换阶段 ${stage}` };
    }
    case 'select_episode': {
      const episodeId = Number(action.episodeId);
      handlers.selectEpisode?.(episodeId);
      return { ok: true, message: `选中第 ${action.episodeId} 集` };
    }
    case 'select_storyboard_episode': {
      const episodeId = Number(action.episodeId);
      handlers.selectStoryboardEpisode?.(episodeId);
      return { ok: true, message: `选中第 ${action.episodeId} 集分镜` };
    }
    case 'open_elements': {
      const open = action.open !== false;
      handlers.setElementsOpen?.(open);
      return { ok: true, message: open ? '打开元素库' : '关闭元素库' };
    }
    case 'select_category':
      handlers.selectCategory?.(action.category);
      handlers.setElementsOpen?.(true);
      return { ok: true, message: `选中 ${handlers.categoryLabel?.(action.category) || action.category}` };
    case 'select_element': {
      const category = action.category || handlers.currentCategory?.();
      const found = handlers.findElement?.(category, action);
      handlers.selectElement?.(category, found.index);
      handlers.setElementsOpen?.(true);
      return { ok: true, message: `选中元素 ${found.element.name}` };
    }
    default:
      return null;
  }
}

export async function runAgentScriptAction(action = {}, handlers = {}) {
  switch (action?.type) {
    case 'add_chapter': {
      const sourceText = handlers.resolveSourceText(action);
      if (!sourceText.trim()) throw new Error('请先上传 TXT，或在动作里提供 sourceText');
      const chapter = await handlers.addChapter(action.title || action.chapterTitle, sourceText);
      return { ok: true, message: `追加章节 ${chapter.title}` };
    }
    case 'split_chapter': {
      const episodes = await handlers.splitChapter(Number(action.chapterId));
      return { ok: true, message: `分出 ${episodes.length} 集` };
    }
    case 'extract_elements_from_source': {
      if (!handlers.hasProject?.()) throw new Error('No project open');
      const sourceText = handlers.resolveSourceText(action);
      if (!sourceText.trim()) throw new Error('请先上传 TXT，或在动作里提供 sourceText');
      const chapter = action.chapterId
        ? handlers.findChapter(Number(action.chapterId))
        : await handlers.addChapter(action.chapterTitle || '导入原文', sourceText);
      if (!chapter) throw new Error('章节不存在');
      if (!chapter.sourceText && sourceText) chapter.sourceText = sourceText;
      await handlers.extractElementsForChapter(chapter);
      return { ok: true, message: '元素提取完成' };
    }
    case 'generate_all_episodes':
      await handlers.generateAllEpisodes();
      return { ok: true, message: '全部剧本已生成' };
    case 'generate_all_storyboards': {
      const episodes = (handlers.episodes?.() || []).slice().sort((a, b) => a.id - b.id);
      for (const episode of episodes) await handlers.generateStoryboard(episode.id, 'normal', action.requirement || '', true, true);
      return { ok: true, message: '全部分镜已生成' };
    }
    case 'delete_chapter':
      return await handlers.deleteChapter(action);
    case 'generate_episode':
      await handlers.generateEpisode(Number(action.episodeId), action.requirement || '');
      return { ok: true, message: `生成第 ${action.episodeId} 集剧本` };
    case 'generate_storyboard':
      await handlers.generateStoryboard(Number(action.episodeId), 'normal', action.requirement || '', false, true);
      return { ok: true, message: `生成第 ${action.episodeId} 集分镜` };
    default:
      return null;
  }
}

export async function runAgentShotAction(action = {}, handlers = {}) {
  const episodeId = action.episodeId ?? handlers.currentEpisodeId();
  switch (action?.type) {
    case 'replace_shot':
      if (await handlers.replaceShotBody(episodeId, action.shotNo, action.body) === false) {
        throw new Error(`镜头 ${action.shotNo} 未修改，请检查镜头是否锁定、内容为空或与原内容相同`);
      }
      await handlers.persistScript();
      return { ok: true, message: `改写镜头 ${action.shotNo}` };
    case 'insert_shot_after':
      await handlers.insertShotAfter(episodeId, action.afterShotNo, action.body);
      await handlers.persistScript();
      return { ok: true, message: `插入镜头 ${Number(action.afterShotNo) + 1}` };
    case 'delete_shot':
      await handlers.deleteShot(episodeId, action.shotNo);
      await handlers.persistScript();
      return { ok: true, message: `删除镜头 ${action.shotNo}` };
    case 'remove_shot_tag_bindings':
      return await handlers.removeShotTagBindings(action);
    default:
      return null;
  }
}

export async function runAgentElementAction(action = {}, handlers = {}) {
  switch (action?.type) {
    case 'add_element': {
      if (!handlers.hasProject?.()) throw new Error('No project open');
      const added = applyAgentAddElement(handlers.project(), handlers.currentCategory(), action);
      await handlers.persistProject();
      handlers.setCurrentCategory(added.category);
      handlers.setSelectedElementIndex(added.index);
      handlers.setElementsOpen(true);
      return { ok: true, message: `新增元素 ${added.messageName}` };
    }
    case 'delete_element':
      return await handlers.deleteElement(action);
    case 'clear_elements':
      return await handlers.clearElements(action);
    case 'update_element': {
      const found = applyAgentUpdateElement(handlers.project(), handlers.currentCategory(), action);
      await handlers.persistProject();
      handlers.setCurrentCategory(found.category);
      handlers.setSelectedElementIndex(found.index);
      return { ok: true, message: `更新元素 ${found.element.name}` };
    }
    case 'generate_image': {
      const category = action.category || handlers.currentCategory();
      const found = handlers.findElement(category, action);
      handlers.setCurrentCategory(category);
      await handlers.generateImage(found.element, found.index);
      return { ok: true, message: `生成元素图 ${found.element.name}` };
    }
    default:
      return null;
  }
}

export async function runAgentAttachmentAction(action = {}, handlers = {}) {
  switch (action?.type) {
    case 'upload_attachment_image':
    case 'upload_attachment_element_image':
      return await handlers.uploadElementImage(action);
    case 'upload_attachment_reference_image':
      return await handlers.uploadReferenceImage(action);
    case 'upload_attachment_variant_image':
      return await handlers.uploadVariantImage(action);
    case 'upload_attachment_outfit_image':
      return await handlers.uploadOutfitImage(action);
    case 'upload_attachment_character_audio':
      return await handlers.uploadCharacterAudio(action);
    case 'delete_reference_image':
    case 'clear_reference_image':
      return await handlers.clearCharacterReference(action);
    case 'delete_character_audio':
    case 'clear_character_audio':
      return await handlers.clearCharacterAudio(action);
    default:
      return null;
  }
}

export async function runAgentVideoAction(action = {}, handlers = {}) {
  switch (action?.type) {
    case 'run_batch_images':
      await handlers.runBatch(action.onlyMissing !== false);
      return { ok: true, message: '启动批量出图' };
    case 'generate_shot_video': {
      const shot = handlers.findShot(action.episodeId ?? handlers.currentEpisodeId(), action.shotNo);
      await handlers.generateShotVideo(shot);
      return { ok: true, message: `提交镜头 ${action.shotNo} 视频` };
    }
    case 'generate_all_shot_videos':
      if (action.episodeId != null) handlers.setCurrentEpisodeId(Number(action.episodeId));
      await handlers.generateAllShotVideos();
      return { ok: true, message: '提交整集视频' };
    case 'clear_shot_video':
      return await handlers.clearShotVideo(action);
    case 'cancel_shot_queue':
      return await handlers.cancelShotQueue(action);
    case 'clear_pending_videos':
      return await handlers.clearPendingVideos(action);
    case 'clear_video_queue':
      return handlers.clearVideoQueue();
    default:
      return null;
  }
}

export async function runAgentProjectAction(action = {}, handlers = {}) {
  switch (action?.type) {
    case 'run_full_pipeline':
      return await handlers.runFullPipeline(action);
    case 'create_project': {
      const projectId = await handlers.createProject(action.name || action.projectName);
      return { ok: true, message: `创建项目 ${projectId}` };
    }
    case 'delete_project':
      return await handlers.deleteProject(action);
    default:
      return null;
  }
}

export async function runConfiguredAgentAction(action = {}, context = {}) {
  return runAgentActionPipeline(action, [
    (nextAction) => runAgentNavigationAction(nextAction, {
      currentView: () => context.view.value,
      setView: (nextView) => { context.view.value = nextView; },
      openProject: context.openProject,
      setStage: (stage) => { context.scriptUI.stage = stage; },
      selectEpisode: (episodeId) => { context.scriptUI.selectedId = `ep:${episodeId}`; },
      selectStoryboardEpisode: (episodeId) => {
        context.sbEpisodeId.value = episodeId;
        context.scriptUI.stage = 'storyboard';
      },
      setElementsOpen: (open) => { context.elementsDrawer.value = open; },
      selectCategory: context.selectCategory,
      currentCategory: () => context.cat.value,
      findElement: context.agentFindElement,
      selectElement: (category, index) => {
        context.cat.value = category;
        context.selectedElementIndex.value = index;
      },
      categoryLabel: (category) => context.catLabel[category] || category,
    }),
    (nextAction) => runAgentScriptAction(nextAction, {
      hasProject: () => !!context.project.value,
      resolveSourceText: context.resolveAgentSourceText,
      addChapter: context.agentAddChapter,
      splitChapter: context.agentSplitChapter,
      findChapter: context.findChapter,
      extractElementsForChapter: context.agentExtractElementsForChapter,
      generateAllEpisodes: context.generateAllEpisodes,
      episodes: () => context.scriptState.episodes,
      generateStoryboard: context.generateStoryboard,
      deleteChapter: context.agentDeleteChapter,
      generateEpisode: context.generateEpisode,
    }),
    (nextAction) => runAgentShotAction(nextAction, {
      currentEpisodeId: () => context.sbEpisodeId.value,
      replaceShotBody: context.agentReplaceShotBody,
      insertShotAfter: context.agentInsertShotAfter,
      deleteShot: context.agentDeleteShot,
      removeShotTagBindings: context.agentRemoveShotTagBindings,
      persistScript: context.agentPersistScript,
    }),
    (nextAction) => runAgentElementAction(nextAction, {
      hasProject: () => !!context.project.value,
      project: () => context.project.value,
      currentCategory: () => context.cat.value,
      persistProject: context.agentPersistProject,
      setCurrentCategory: (category) => { context.cat.value = category; },
      setSelectedElementIndex: (index) => { context.selectedElementIndex.value = index; },
      setElementsOpen: (open) => { context.elementsDrawer.value = open; },
      deleteElement: context.agentDeleteElement,
      clearElements: context.agentClearElements,
      findElement: context.agentFindElement,
      generateImage: context.genImage,
    }),
    (nextAction) => runAgentAttachmentAction(nextAction, {
      uploadElementImage: context.agentUploadAttachmentImage,
      uploadReferenceImage: context.agentUploadAttachmentReferenceImage,
      uploadVariantImage: context.agentUploadAttachmentVariantImage,
      uploadOutfitImage: context.agentUploadAttachmentOutfitImage,
      uploadCharacterAudio: context.agentUploadAttachmentCharacterAudio,
      clearCharacterReference: context.agentClearCharacterReference,
      clearCharacterAudio: context.agentClearCharacterAudio,
    }),
    (nextAction) => runAgentVideoAction(nextAction, {
      runBatch: context.runBatch,
      currentEpisodeId: () => context.sbEpisodeId.value,
      setCurrentEpisodeId: (episodeId) => { context.sbEpisodeId.value = episodeId; },
      findShot: context.agentFindShot,
      generateShotVideo: context.generateShotVideo,
      generateAllShotVideos: context.generateAllShotVideos,
      clearShotVideo: context.agentClearShotVideo,
      cancelShotQueue: context.agentCancelShotQueue,
      clearPendingVideos: context.agentClearPendingVideos,
      clearVideoQueue: context.agentClearVideoQueue,
    }),
    (nextAction) => runAgentProjectAction(nextAction, {
      runFullPipeline: context.runAgentFullPipeline,
      createProject: context.agentCreateProject,
      deleteProject: context.agentDeleteProject,
    }),
    (nextAction) => runAgentSimpleAction(nextAction, {
      api: context.api,
      setPath: context.agentSetPath,
      deletePath: context.agentDeletePath,
      saveProject: context.agentPersistProject,
      saveScript: context.agentPersistScript,
      saveSettings: context.saveSettings,
      showMessage: context.showMessage,
    }),
  ]);
}

export function createAgentPanelActionsRuntime({ refs = {}, helpers = {} } = {}) {
  const executeAgentAction = (action) => runConfiguredAgentAction(action, helpers.actionContext);
  const handleAgentInputKeydown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    helpers.runInstruction();
  };
  const openAgent = () => {
    refs.agent.open = true;
  };

  return {
    executeAgentAction,
    handleAgentInputKeydown,
    openAgent,
  };
}

export function createAgentRuntime({
  api,
  refs = {},
  helpers = {},
  readers = {},
  message = {},
} = {}) {
  const {
    agentLog,
    setAgentProgress,
    finishAgentProgress,
    failAgentProgress,
    addAgentFiles,
    onAgentPickFile,
    onAgentDrop,
    removeAgentFile,
    clearAgentFiles,
    loadAgentTxtFiles,
    onAgentPickTxt,
    onAgentTxtDrop,
    clearAgentUploadedSource,
    resolveAgentSourceText,
  } = createAgentUiRuntime({
    refs: { agent: refs.agent },
    readers,
    message,
    helpers: {
      startProgressPulse: helpers.startProgressPulse,
      stopProgressPulse: helpers.stopProgressPulse,
      progressByRatio: helpers.progressByRatio,
      readTxtFiles: helpers.readTxtFiles,
      setTimeout: helpers.setTimeout,
    },
  });

  const pipelineActions = createAgentPipelineActionsRuntime({
    api,
    refs: {
      agent: refs.agent,
      project: refs.project,
      scriptState: refs.scriptState,
      scriptUi: refs.scriptUi,
      storyboardEpisodeId: refs.storyboardEpisodeId,
      config: refs.config,
      videoBar: refs.videoBar,
      providerLabel: refs.providerLabel,
      shotStatus: refs.shotStatus,
    },
    helpers: {
      loadProjects: helpers.loadProjects,
      openProject: helpers.openProject,
      chapterSig: helpers.chapterSig,
      pollExtract: helpers.pollExtract,
      generateEpisode: helpers.generateEpisode,
      generateStoryboard: helpers.generateStoryboard,
      nextTick: helpers.nextTick,
      hydrateShotVideos: helpers.hydrateShotVideos,
      loadVideoBar: helpers.loadVideoBar,
      findStoryboard: helpers.findStoryboard,
      parseShots: helpers.parseShots,
      shotVideoUrl: helpers.shotVideoUrl,
      buildShotSubmit: helpers.buildShotSubmit,
      startPendingPoll: helpers.startPendingPoll,
      resolveSourceText: resolveAgentSourceText,
      setProgress: setAgentProgress,
      runBatch: helpers.runBatch,
      finishProgress: finishAgentProgress,
      failProgress: failAgentProgress,
    },
    video: {
      normalizeVideoProvider: helpers.normalizeVideoProvider,
      isTrueMentionVideoMode: helpers.isTrueMentionVideoMode,
      videoSubmitPayload: helpers.videoSubmitPayload,
    },
    message,
    log: agentLog,
  });

  const {
    agentStateSnapshot,
    agentSetPath,
    agentDeletePath,
    agentFindElement,
    agentFindAttachment,
  } = createAgentStatePathActionsRuntime({
    refs: {
      view: refs.view,
      settingsSection: refs.settingsSection,
      category: refs.category,
      selectedElementIndex: refs.selectedElementIndex,
      elementsDrawer: refs.elementsDrawer,
      scriptUi: refs.scriptUi,
      storyboardEpisodeId: refs.storyboardEpisodeId,
      agent: refs.agent,
      project: refs.project,
      scriptState: refs.scriptState,
      config: refs.config,
      videoBar: refs.videoBar,
      currentShots: refs.currentShots,
      projects: refs.projects,
    },
    helpers: {
      shotHelpers: {
        shotVideoUrl: helpers.shotVideoUrl,
        shotVideoStatus: helpers.shotVideoStatus,
        shotElementTags: helpers.shotElementTags,
      },
      pathRoots: {
        project: refs.project,
        script: refs.scriptState,
        scriptState: refs.scriptState,
        cfg: refs.config,
        videoBar: refs.videoBar,
      },
    },
  });

  const agentClearElements = createRunAgentClearElementsRuntime({
    api,
    refs: { project: refs.project, selectedElementIndex: refs.selectedElementIndex },
    helpers: {
      hydrateImageState: helpers.hydrateImageState,
      syncCharacterImageMode: helpers.syncCharacterImageMode,
      categoryLabels: helpers.categoryLabels,
    },
  });

  const deletePersistActions = createAgentDeletePersistActionsRuntime({
    api,
    refs: {
      project: refs.project,
      view: refs.view,
      selectedElementIndex: refs.selectedElementIndex,
      inspectorVisible: refs.inspectorVisible,
      elementsDrawer: refs.elementsDrawer,
      category: refs.category,
      scriptState: refs.scriptState,
      scriptUi: refs.scriptUi,
      storyboardEpisodeId: refs.storyboardEpisodeId,
    },
    helpers: {
      loadProjects: helpers.loadProjects,
      hydrateImageState: helpers.hydrateImageState,
      hydrateScript: helpers.hydrateScript,
    },
  });

  const cleanupActions = createAgentCleanupActionsRuntime({
    api,
    refs: { project: refs.project, episodeId: refs.storyboardEpisodeId, shotStatus: refs.shotStatus },
    helpers: {
      findElement: agentFindElement,
      clearShotVideo: helpers.clearShotVideo,
      cancelShotQueue: helpers.cancelShotQueue,
      clearVideoQueue: helpers.clearVideoQueue,
    },
  });

  const attachmentActions = createAgentAttachmentActionsRuntime({
    api,
    refs: {
      agent: refs.agent,
      project: refs.project,
      category: refs.category,
      selectedElementIndex: refs.selectedElementIndex,
      elementsDrawer: refs.elementsDrawer,
    },
  });

  const shotActions = createAgentShotActionsRuntime({
    refs: {
      project: refs.project,
      scriptState: refs.scriptState,
      episodeId: refs.storyboardEpisodeId,
      currentShots: refs.currentShots,
    },
    helpers: {
      startShotEdit: helpers.startShotEdit,
      setShotEditText: helpers.setShotEditText,
      saveShotEdit: helpers.saveShotEdit,
      findStoryboard: helpers.findStoryboard,
      defaultBody: helpers.defaultBody,
      saveScript: helpers.saveScript,
      insertAfter: helpers.insertAfter,
      parseShots: helpers.parseShots,
      shotElementTags: helpers.shotElementTags,
      persistScript: deletePersistActions.agentPersistScript,
    },
  });

  const agentActionContext = {
    view: refs.view,
    scriptUI: refs.scriptUi,
    sbEpisodeId: refs.storyboardEpisodeId,
    elementsDrawer: refs.elementsDrawer,
    cat: refs.category,
    selectedElementIndex: refs.selectedElementIndex,
    catLabel: helpers.categoryLabels,
    project: refs.project,
    api,
    openProject: helpers.openProject,
    selectCategory: helpers.selectCategory,
    agentFindElement,
    resolveAgentSourceText,
    agentAddChapter: pipelineActions.agentAddChapter,
    agentSplitChapter: pipelineActions.agentSplitChapter,
    findChapter: helpers.findChapter,
    agentExtractElementsForChapter: pipelineActions.agentExtractElementsForChapter,
    generateAllEpisodes: helpers.generateAllEpisodes,
    scriptState: refs.scriptState,
    generateStoryboard: helpers.generateStoryboard,
    agentDeleteChapter: deletePersistActions.agentDeleteChapter,
    generateEpisode: helpers.generateEpisode,
    agentReplaceShotBody: shotActions.agentReplaceShotBody,
    agentInsertShotAfter: shotActions.agentInsertShotAfter,
    agentDeleteShot: shotActions.agentDeleteShot,
    agentRemoveShotTagBindings: shotActions.agentRemoveShotTagBindings,
    agentPersistScript: deletePersistActions.agentPersistScript,
    agentPersistProject: deletePersistActions.agentPersistProject,
    agentDeleteElement: deletePersistActions.agentDeleteElement,
    agentClearElements,
    genImage: helpers.genImage,
    agentUploadAttachmentImage: attachmentActions.agentUploadAttachmentImage,
    agentUploadAttachmentReferenceImage: attachmentActions.agentUploadAttachmentReferenceImage,
    agentUploadAttachmentVariantImage: attachmentActions.agentUploadAttachmentVariantImage,
    agentUploadAttachmentOutfitImage: attachmentActions.agentUploadAttachmentOutfitImage,
    agentUploadAttachmentCharacterAudio: attachmentActions.agentUploadAttachmentCharacterAudio,
    agentClearCharacterReference: cleanupActions.agentClearCharacterReference,
    agentClearCharacterAudio: cleanupActions.agentClearCharacterAudio,
    runBatch: helpers.runBatch,
    agentFindShot: shotActions.agentFindShot,
    generateShotVideo: helpers.generateShotVideo,
    generateAllShotVideos: helpers.generateAllShotVideos,
    agentClearShotVideo: cleanupActions.agentClearShotVideo,
    agentCancelShotQueue: cleanupActions.agentCancelShotQueue,
    agentClearPendingVideos: cleanupActions.agentClearPendingVideos,
    agentClearVideoQueue: cleanupActions.agentClearVideoQueue,
    runAgentFullPipeline: pipelineActions.runAgentFullPipeline,
    agentCreateProject: pipelineActions.agentCreateProject,
    agentDeleteProject: deletePersistActions.agentDeleteProject,
    agentSetPath,
    agentDeletePath,
    saveSettings: helpers.saveSettings,
    showMessage: helpers.showMessage,
  };

  let executeAgentAction = null;
  const runAgentInstruction = createRunAgentInstructionRuntime({
    api,
    message,
    agent: refs.agent,
    helpers: {
      attachmentSummary: () => agentAttachmentSummary(refs.agent.files),
      stateSnapshot: agentStateSnapshot,
      executeAction: (action) => executeAgentAction(action),
      setProgress: setAgentProgress,
      finishProgress: finishAgentProgress,
      failProgress: failAgentProgress,
      clearFiles: clearAgentFiles,
    },
    log: agentLog,
  });

  const {
    executeAgentAction: executePanelAgentAction,
    handleAgentInputKeydown,
    openAgent,
  } = createAgentPanelActionsRuntime({
    refs: { agent: refs.agent },
    helpers: { actionContext: agentActionContext, runInstruction: runAgentInstruction },
  });
  executeAgentAction = executePanelAgentAction;

  return {
    agentLog,
    setAgentProgress,
    finishAgentProgress,
    failAgentProgress,
    addAgentFiles,
    onAgentPickFile,
    onAgentDrop,
    removeAgentFile,
    clearAgentFiles,
    loadAgentTxtFiles,
    onAgentPickTxt,
    onAgentTxtDrop,
    clearAgentUploadedSource,
    resolveAgentSourceText,
    ...pipelineActions,
    agentStateSnapshot,
    agentSetPath,
    agentDeletePath,
    agentFindElement,
    agentFindAttachment,
    agentClearElements,
    ...deletePersistActions,
    ...cleanupActions,
    ...attachmentActions,
    ...shotActions,
    runAgentInstruction,
    handleAgentInputKeydown,
    openAgent,
  };
}

export function agentFindCharacterSubItem(project, action = {}, listKey = 'variants') {
  const character = agentFindElement(project, 'character', {
    index: action.charIndex,
    name: action.characterName || action.charName,
  });
  const list = character.element?.[listKey] || [];
  let index = Number.isInteger(action.index) ? action.index : Number(action[listKey === 'variants' ? 'variantIndex' : 'outfitIndex']);
  if (!Number.isInteger(index) || index < 0) {
    const name = String(action.name || action[listKey === 'variants' ? 'variantName' : 'outfitName'] || '').trim();
    index = list.findIndex((item) => String(item.name || '') === name);
  }
  if (index < 0 || !list[index]) throw new Error(`${listKey} item not found`);
  return { character: character.element, charIndex: character.index, item: list[index], index };
}

export function agentRebuildStoryboardContentFromShots(shots = [], {
  insertIndex = -1,
  insertBody = '',
  defaultBody = '',
} = {}) {
  const next = [];
  const list = Array.isArray(shots) ? shots : [];
  const insertedBody = () => String(insertBody || defaultBody || '').trim();
  for (let i = 0; i < list.length; i++) {
    if (insertIndex === i) next.push(insertedBody());
    next.push(String(list[i]?.body || '').trim());
  }
  if (insertIndex >= list.length) next.push(insertedBody());
  return next.map((body, i) => `分镜${i + 1}：\n${body}`).join('\n\n');
}

export function agentShotIndexByNo(shots = [], shotNo) {
  const list = Array.isArray(shots) ? shots : [];
  return list.findIndex((shot) => String(shot?.no) === String(shotNo));
}

export function agentFindShotByNo(shots = [], shotNo) {
  const shot = (Array.isArray(shots) ? shots : []).find((item) => String(item?.no) === String(shotNo));
  if (!shot) throw new Error(`Shot not found: ${shotNo}`);
  return shot;
}

export function createAgentFindShotRuntime({ refs = {} } = {}) {
  return (episodeId, shotNo) => {
    const previous = refs.episodeId.value;
    if (episodeId != null) refs.episodeId.value = Number(episodeId);
    try {
      return agentFindShotByNo(refs.currentShots.value, shotNo);
    } catch (error) {
      refs.episodeId.value = previous;
      throw error;
    }
  };
}

export async function insertAgentShotAfterFlow(episodeId, afterShotNo, body, handlers = {}) {
  if (episodeId != null) handlers.setEpisode(Number(episodeId));
  const storyboard = handlers.storyboard();
  if (!storyboard) throw new Error('Storyboard not found');
  const shots = handlers.currentShots();
  const index = agentShotIndexByNo(shots, afterShotNo);
  if (index < 0) throw new Error(`Shot not found: ${afterShotNo}`);
  if (body && String(body).trim()) {
    storyboard.content = agentRebuildStoryboardContentFromShots(shots, {
      insertIndex: index + 1,
      insertBody: body,
      defaultBody: handlers.defaultBody(),
    });
    handlers.saveScript();
    return;
  }
  await handlers.insertAfter(shots[index]);
}

export function createAgentInsertShotAfterRuntime({ refs = {}, helpers = {} } = {}) {
  return {
    setEpisode: (episodeId) => { refs.episodeId.value = episodeId; },
    storyboard: () => helpers.findStoryboard(refs.episodeId.value),
    currentShots: () => refs.currentShots.value,
    defaultBody: helpers.defaultBody,
    saveScript: helpers.saveScript,
    insertAfter: helpers.insertAfter,
  };
}

export function applyAgentDeleteShot(storyboard, shots = [], shotNo) {
  const list = Array.isArray(shots) ? shots : [];
  if (list.length <= 1) throw new Error('At least one shot must remain');
  const index = agentShotIndexByNo(list, shotNo);
  if (index < 0) throw new Error(`Shot not found: ${shotNo}`);
  storyboard.content = list
    .filter((_, i) => i !== index)
    .map((shot, i) => `分镜${i + 1}：\n${String(shot?.body || '').trim()}`)
    .join('\n\n');
  const key = String(shotNo);
  if (storyboard.manualTags) delete storyboard.manualTags[key];
  if (storyboard.excludedTags) delete storyboard.excludedTags[key];
  if (storyboard.shotVideos) delete storyboard.shotVideos[key];
  return { index };
}

export function agentShotTagRemovalCriteria(action = {}) {
  const needles = [
    action.name,
    action.elementName,
    action.nameIncludes,
    action.contains,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const category = ['character', 'group', 'scene', 'prop', 'effect', 'creature'].includes(action.category) ? action.category : '';
  return {
    needles,
    category,
    fuzzy: !!(action.nameIncludes || action.contains),
  };
}

export function agentShotTagMatches(tag, criteria = {}) {
  const { needles = [], category = '', fuzzy = false } = criteria;
  if (category && tag?.cat !== category) return false;
  const name = String(tag?.name || '');
  return needles.some((needle) => (
    fuzzy ? name.includes(needle) : (name === needle || name.includes(needle))
  ));
}

export function applyAgentShotTagRemoval(storyboard, shotNo, tags = []) {
  if (!storyboard || !Array.isArray(tags) || !tags.length) return { removed: 0, touched: false };
  if (!storyboard.manualTags || typeof storyboard.manualTags !== 'object') storyboard.manualTags = {};
  if (!storyboard.excludedTags || typeof storyboard.excludedTags !== 'object') storyboard.excludedTags = {};
  const key = String(shotNo);
  const manualList = Array.isArray(storyboard.manualTags[key]) ? storyboard.manualTags[key] : [];
  const excludedList = Array.isArray(storyboard.excludedTags[key]) ? storyboard.excludedTags[key] : [];
  let removed = 0;
  for (const tag of tags) {
    const before = manualList.length;
    for (let i = manualList.length - 1; i >= 0; i--) {
      if (manualList[i]?.cat === tag.cat && manualList[i]?.name === tag.name) manualList.splice(i, 1);
    }
    if (!excludedList.some((item) => item.cat === tag.cat && item.name === tag.name)) {
      excludedList.push({ cat: tag.cat, name: tag.name });
    }
    removed += Math.max(1, before - manualList.length);
  }
  storyboard.manualTags[key] = manualList;
  storyboard.excludedTags[key] = excludedList;
  return { removed, touched: true };
}

export async function removeAgentShotTagBindingsFlow(action = {}, handlers = {}) {
  if (!handlers.project()) throw new Error('No project open');
  const criteria = agentShotTagRemovalCriteria(action);
  const rawNeedles = criteria.needles;
  if (!rawNeedles.length) throw new Error('Missing name or nameIncludes');
  const episodeFilter = action.episodeId == null || action.episodeId === 'all'
    ? null
    : String(action.episodeId);
  const previousEpisodeId = handlers.currentEpisodeId();
  let removed = 0;
  let touchedShots = 0;

  for (const storyboard of handlers.storyboards() || []) {
    if (!storyboard || (episodeFilter !== null && String(storyboard.episodeId) !== episodeFilter)) continue;
    handlers.setCurrentEpisodeId(Number(storyboard.episodeId));
    const shots = handlers.parseShots(storyboard.content || '');
    for (const shot of shots) {
      const matched = handlers.shotElementTags(shot).filter((tag) => agentShotTagMatches(tag, criteria));
      if (!matched.length) continue;
      const result = applyAgentShotTagRemoval(storyboard, shot.no, matched);
      removed += result.removed;
      if (result.touched) touchedShots++;
    }
  }

  handlers.setCurrentEpisodeId(previousEpisodeId);
  if (touchedShots) await handlers.persistScript();
  return {
    ok: true,
    message: `已移除 ${touchedShots} 个分镜中的绑定元素：${rawNeedles.join('、')}`,
    data: { touchedShots, removed },
  };
}

export function createAgentRemoveShotTagBindingsRuntime({ refs = {}, helpers = {} } = {}) {
  return {
    project: () => refs.project.value,
    storyboards: () => refs.scriptState.storyboards,
    currentEpisodeId: () => refs.episodeId.value,
    setCurrentEpisodeId: (value) => { refs.episodeId.value = value; },
    parseShots: helpers.parseShots,
    shotElementTags: helpers.shotElementTags,
    persistScript: helpers.persistScript,
  };
}

export function createAgentShotActionsRuntime({ refs = {}, helpers = {} } = {}) {
  const agentFindShot = createAgentFindShotRuntime({
    refs: { episodeId: refs.episodeId, currentShots: refs.currentShots },
  });

  return {
    agentFindShot,
    agentReplaceShotBody: (episodeId, shotNo, body) => {
      const shot = agentFindShot(episodeId, shotNo);
      helpers.startShotEdit(shot);
      helpers.setShotEditText(String(body || '').trim());
      return helpers.saveShotEdit(shot);
    },
    agentInsertShotAfter: (episodeId, afterShotNo, body) => insertAgentShotAfterFlow(episodeId, afterShotNo, body, createAgentInsertShotAfterRuntime({
      refs: { episodeId: refs.episodeId, currentShots: refs.currentShots },
      helpers: {
        findStoryboard: helpers.findStoryboard,
        defaultBody: helpers.defaultBody,
        saveScript: helpers.saveScript,
        insertAfter: helpers.insertAfter,
      },
    })),
    agentDeleteShot: async (episodeId, shotNo) => {
      if (episodeId != null) refs.episodeId.value = Number(episodeId);
      const storyboard = helpers.findStoryboard(refs.episodeId.value);
      if (!storyboard) throw new Error('Storyboard not found');
      applyAgentDeleteShot(storyboard, refs.currentShots.value, shotNo);
      helpers.saveScript();
    },
    agentRemoveShotTagBindings: (action = {}) => removeAgentShotTagBindingsFlow(action, createAgentRemoveShotTagBindingsRuntime({
      refs: { project: refs.project, scriptState: refs.scriptState, episodeId: refs.episodeId },
      helpers: {
        parseShots: helpers.parseShots,
        shotElementTags: helpers.shotElementTags,
        persistScript: helpers.persistScript,
      },
    })),
  };
}
