import fs from 'fs';
import path from 'path';

export const COMFYUI_DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
export const COMFYUI_WORKFLOW_PRESETS = Object.freeze([
  {
    id: 'u09',
    name: 'U09 · MiniMax H3 二采重绘',
    path: 'workflows/U视频-MINIMAX-H3/U09-Minimax-H3二采重绘-秒变清晰-超高一致性-效率起飞wuwukasi.json',
    maxImages: 9,
    maxVideos: 1,
    maxAudios: 3,
  },
  {
    id: 'u07',
    name: 'U07 · MiniMax H3 全能参考',
    path: 'workflows/U视频-MINIMAX-H3/U07-MiniMax-H3全能参考工作流Work-Fisher.json',
    maxImages: 3,
    maxVideos: 0,
    maxAudios: 0,
  },
]);

const COMFY_TIMEOUT_MS = 30 * 1000;
const COMFY_QUEUE_TIMEOUT_MS = 60 * 60 * 1000;
const H3_NODE_TYPES = new Set([
  'MiniMaxH3ReferenceToVideo',
  'MiniMaxH3AudioConditioningT8',
  'MiniMaxH3ImageToVideo',
  'MiniMaxH3StillConditioningT8',
  'easy MiniMaxH3ReferenceToVideoBridge',
  'easy minimaxH3ToVideo',
]);
const MEDIA_INPUT_PREFIXES = Object.freeze({
  image: ['ref_images.ref_image_', 'first_frame', 'last_frame'],
  video: ['ref_videos.ref_video_'],
  audio: ['ref_audios.ref_audio_', 'drive_audio', 'final_audio'],
});
const VIDEO_AUDIO_INPUT_PREFIX = 'ref_video_audios.ref_video_audio_';
const LOADER_TYPES = Object.freeze({
  image: new Set(['LoadImage']),
  video: new Set(['VHS_LoadVideo', 'LoadVideo', 'LoadVideoPath']),
  audio: new Set(['LoadAudio']),
});

function cleanUrl(value, fallback = '') {
  const raw = String(value || fallback || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('ComfyUI 地址必须是有效的 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('ComfyUI 地址必须使用 HTTP 或 HTTPS');
  return parsed.toString().replace(/\/$/, '');
}

export function normalizeComfyUiBaseUrl(value, fallback = COMFYUI_DEFAULT_BASE_URL) {
  return cleanUrl(value, fallback);
}

export function normalizeComfyUiWorkflowPath(value, fallback = COMFYUI_WORKFLOW_PRESETS[0].path) {
  const raw = String(value || fallback || '').trim().replace(/^\/+/, '');
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) throw new Error('工作流必须是 ComfyUI 工作流文件路径，而不是外部网址');
  if (!raw.toLowerCase().endsWith('.json')) throw new Error('工作流文件必须是 JSON');
  return raw;
}

function comfyUrl(baseUrl, endpoint) {
  return `${cleanUrl(baseUrl)}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = COMFY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`ComfyUI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, context) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || data?.raw || `HTTP ${response.status}`;
    throw new Error(`${context}失败：${String(detail).slice(0, 500)}`);
  }
  return data;
}

async function getJson(baseUrl, endpoint, context, timeoutMs = COMFY_TIMEOUT_MS) {
  return readJson(await fetchWithTimeout(comfyUrl(baseUrl, endpoint), { headers: { Accept: 'application/json' } }, timeoutMs), context);
}

export async function getComfyUiObjectInfo(baseUrl) {
  return getJson(baseUrl, '/object_info', '读取 ComfyUI 节点信息', 60 * 1000);
}

export async function listComfyUiWorkflows(baseUrl) {
  const data = await getJson(baseUrl, '/userdata?dir=workflows&recurse=true&split=false&full_info=true', '读取 ComfyUI 工作流列表', 60 * 1000);
  return (Array.isArray(data) ? data : []).map((item) => ({
    path: String(item?.path || '').trim(),
    size: Number(item?.size) || 0,
    modified: Number(item?.modified) || 0,
  })).filter((item) => item.path.toLowerCase().endsWith('.json'));
}

export async function loadComfyUiWorkflow(baseUrl, workflowPath) {
  const normalizedPath = normalizeComfyUiWorkflowPath(workflowPath);
  const endpoint = `/userdata/${encodeURIComponent(normalizedPath)}`;
  const data = await getJson(baseUrl, endpoint, `读取工作流 ${path.basename(normalizedPath)}`, 60 * 1000);
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('工作流不是有效的 ComfyUI 图工作流');
  return data;
}

export async function testComfyUiConnection({ baseUrl, workflowPath } = {}) {
  const normalizedBaseUrl = normalizeComfyUiBaseUrl(baseUrl, '');
  if (!normalizedBaseUrl) throw new Error('请先填写 ComfyUI 云端地址');
  const system = await getJson(normalizedBaseUrl, '/system_stats', '测试 ComfyUI 连接');
  const objectInfo = await getComfyUiObjectInfo(normalizedBaseUrl);
  const workflows = await listComfyUiWorkflows(normalizedBaseUrl);
  let workflow = null;
  if (workflowPath) workflow = await loadComfyUiWorkflow(normalizedBaseUrl, workflowPath);
  const nodeTypes = Object.keys(objectInfo || {});
  const h3Nodes = nodeTypes.filter((name) => H3_NODE_TYPES.has(name));
  if (!h3Nodes.length) throw new Error('连接成功，但云端没有 MiniMax H3 节点');
  const capabilities = workflow ? describeComfyUiWorkflowCapabilities(workflow) : null;
  return {
    ok: true,
    baseUrl: normalizedBaseUrl,
    version: String(system?.system?.comfyui_version || ''),
    device: String(system?.devices?.[0]?.name || ''),
    workflowCount: workflows.length,
    workflowPath: workflow ? normalizeComfyUiWorkflowPath(workflowPath) : '',
    workflowNodeCount: workflow?.nodes?.length || 0,
    h3Nodes,
    capabilities,
    workflows,
  };
}

function linkMap(workflow) {
  return new Map((workflow?.links || []).map((link) => [String(link?.[0]), link]));
}

function nodeMap(workflow) {
  return new Map((workflow?.nodes || []).map((node) => [String(node?.id), node]));
}

function nodeInputs(node) {
  if (Array.isArray(node?.inputs)) return node.inputs;
  if (node?.inputs && typeof node.inputs === 'object') return [node.inputs];
  return [];
}

function nodeOutputs(node) {
  if (Array.isArray(node?.outputs)) return node.outputs;
  if (node?.outputs && typeof node.outputs === 'object') return [node.outputs];
  return [];
}

function nodeWidgetKey(node) {
  const widgets = node?.widgets_values;
  if (Array.isArray(widgets)) return String(widgets[0] || '').trim();
  if (widgets && typeof widgets === 'object') return String(widgets.name || widgets.key || '').trim();
  return String(widgets || '').trim();
}

function pairedSetNode(workflow, getNode) {
  if (getNode?.type !== 'GetNode') return null;
  const key = nodeWidgetKey(getNode);
  if (!key) return null;
  return (workflow?.nodes || []).find((node) => node?.type === 'SetNode' && nodeWidgetKey(node) === key) || null;
}

function apiWidgetNames(node, objectInfo = {}) {
  const definition = objectInfo?.[node?.type] || {};
  const declaredOrder = [
    ...(definition?.input_order?.required || []),
    ...(definition?.input_order?.optional || []),
  ];
  const inputs = { ...(definition?.input?.required || {}), ...(definition?.input?.optional || {}) };
  const order = declaredOrder.length ? declaredOrder : Object.keys(inputs);
  return order.filter((name) => {
    const spec = inputs[name];
    if (!spec) return false;
    const type = spec[0];
    if (typeof type !== 'string') return Array.isArray(type);
    return ['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'COMBO', 'COMFY_DYNAMICCOMBO_V3', 'COMFY_DYNAMICCOMBO'].includes(type);
  });
}

function widgetInputs(node, objectInfo = {}) {
  const names = apiWidgetNames(node, objectInfo);
  const widgets = node?.widgets_values;
  const inputs = {};
  if (widgets && !Array.isArray(widgets) && typeof widgets === 'object') {
    for (const [key, value] of Object.entries(widgets)) {
      if (['videopreview', 'upload', 'audioUI'].includes(key)) continue;
      if (names.length && !names.includes(key)) continue;
      inputs[key] = value;
    }
    return inputs;
  }
  if (Array.isArray(widgets)) {
    for (const [index, name] of names.entries()) {
      if (widgets[index] !== undefined) inputs[name] = widgets[index];
    }
    return inputs;
  }
  if (widgets !== undefined && widgets !== null && names[0]) inputs[names[0]] = widgets;
  return inputs;
}

function materializeGetNodeLinks(workflow) {
  const nodes = nodeMap(workflow);
  const links = linkMap(workflow);
  const resolveSource = (nodeId, outputIndex = 0, linkType = '', seen = new Set()) => {
    const id = String(nodeId || '');
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const node = nodes.get(id);
    if (!node) return null;
    if (node.type === 'GetNode') {
      const setter = pairedSetNode(workflow, node);
      const setterInput = nodeInputs(setter).find((input) => input.link != null);
      const setterLink = setterInput ? links.get(String(setterInput.link)) : null;
      if (!setterLink) return null;
      return resolveSource(setterLink[1], setterLink[2], setterLink[5], seen);
    }
    if (Number(node.mode) === 4) {
      const output = nodeOutputs(node)[Number(outputIndex) || 0];
      const expectedType = String(output?.type || linkType || '');
      const linkedInputs = nodeInputs(node).filter((input) => input.link != null);
      const sourceInput = linkedInputs.find((input, index) => index === (Number(outputIndex) || 0) && (!expectedType || input.type === expectedType))
        || linkedInputs.find((input) => !expectedType || input.type === expectedType || input.type === '*')
        || (linkedInputs.length === 1 ? linkedInputs[0] : null);
      const sourceLink = sourceInput ? links.get(String(sourceInput.link)) : null;
      if (!sourceLink) return null;
      return resolveSource(sourceLink[1], sourceLink[2], sourceLink[5], seen);
    }
    return { nodeId: id, outputIndex: Number(outputIndex) || 0 };
  };
  for (const link of workflow?.links || []) {
    const source = resolveSource(link?.[1], link?.[2], link?.[5]);
    if (!source) continue;
    link[1] = Number.isFinite(Number(source.nodeId)) ? Number(source.nodeId) : source.nodeId;
    link[2] = Number(source.outputIndex) || 0;
  }
  return workflow;
}

function graphToApiPrompt(workflow, objectInfo = {}) {
  const nodes = nodeMap(workflow);
  const links = linkMap(workflow);
  const output = {};
  for (const node of workflow.nodes || []) {
    if (!node?.id || !node?.type || !objectInfo?.[node.type] || Number(node.mode) === 4 || Number(node.mode) === 2) continue;
    const inputs = widgetInputs(node, objectInfo);
    for (const input of nodeInputs(node)) {
      const link = links.get(String(input.link));
      if (!link) continue;
      const originId = String(link[1]);
      if (!nodes.has(originId) || !objectInfo?.[nodes.get(originId)?.type] || Number(nodes.get(originId)?.mode) === 4 || Number(nodes.get(originId)?.mode) === 2) continue;
      inputs[input.name] = [originId, Number(link[2]) || 0];
    }
    output[String(node.id)] = { inputs, class_type: node.type, _meta: { title: String(node.title || node.type) } };
  }
  const roots = Object.keys(output).filter((id) => objectInfo?.[output[id].class_type]?.output_node === true);
  if (!roots.length) throw new Error('工作流没有可执行的输出节点');
  const retained = new Set();
  const visit = (id) => {
    if (!output[id] || retained.has(id)) return;
    retained.add(id);
    for (const value of Object.values(output[id].inputs || {})) {
      if (Array.isArray(value) && value.length === 2) visit(String(value[0]));
    }
  };
  roots.forEach(visit);
  for (const id of Object.keys(output)) {
    if (!retained.has(id)) delete output[id];
  }
  return output;
}

function upstreamNodeIds(workflow, startNodeId, seen = new Set()) {
  const nodes = nodeMap(workflow);
  const links = linkMap(workflow);
  const id = String(startNodeId || '');
  if (!id || seen.has(id)) return seen;
  seen.add(id);
  const node = nodes.get(id);
  if (!node) return seen;
  if (node.type === 'GetNode') {
    const setter = pairedSetNode(workflow, node);
    if (setter) upstreamNodeIds(workflow, setter.id, seen);
  }
  for (const input of nodeInputs(node)) {
    const link = links.get(String(input.link));
    if (link) upstreamNodeIds(workflow, link[1], seen);
  }
  return seen;
}

function h3Nodes(workflow) {
  return (workflow?.nodes || []).filter((node) => H3_NODE_TYPES.has(node?.type));
}

function mediaInputMatches(kind, inputName) {
  return (MEDIA_INPUT_PREFIXES[kind] || []).some((prefix) => inputName === prefix || inputName.startsWith(prefix));
}

function loaderIdsForInput(workflow, input, kind) {
  if (input?.link == null) return [];
  const link = linkMap(workflow).get(String(input.link));
  if (!link) return [];
  const nodes = nodeMap(workflow);
  return [...upstreamNodeIds(workflow, link[1])]
    .filter((id) => LOADER_TYPES[kind]?.has(nodes.get(String(id))?.type));
}

function slotsForH3Node(workflow, node) {
  const slots = [];
  for (const input of nodeInputs(node)) {
    for (const kind of ['image', 'video', 'audio']) {
      if (!mediaInputMatches(kind, input.name)) continue;
      const loaderNodeIds = loaderIdsForInput(workflow, input, kind);
      if (!loaderNodeIds.length) continue;
      slots.push({
        nodeId: String(node.id),
        nodeType: node.type,
        inputName: input.name,
        kind,
        link: Number(input.link),
        loaderNodeIds,
      });
    }
  }
  return slots;
}

export function describeComfyUiReferenceSlots(workflow) {
  return h3Nodes(workflow).flatMap((node) => slotsForH3Node(workflow, node));
}

function branchLabel(capacity) {
  if (capacity.image === 0 && capacity.video === 0 && capacity.audio === 0) return '文生视频';
  if (capacity.image === 1 && capacity.video === 0 && capacity.audio === 0) return '单图参考';
  if (capacity.image > 1 && capacity.video === 0 && capacity.audio === 0) return '多图参考';
  return '全能参考';
}

export function describeComfyUiWorkflowCapabilities(workflow) {
  const branches = h3Nodes(workflow).map((node) => {
    const slots = slotsForH3Node(workflow, node);
    const capacity = Object.fromEntries(['image', 'video', 'audio'].map((kind) => [kind, slots.filter((slot) => slot.kind === kind).length]));
    return {
      nodeId: String(node.id),
      nodeType: node.type,
      mode: Number(node.mode) || 0,
      label: branchLabel(capacity),
      capacity,
    };
  });
  const capacity = Object.fromEntries(['image', 'video', 'audio'].map((kind) => [
    kind,
    Math.max(0, ...branches.map((branch) => branch.capacity[kind] || 0)),
  ]));
  return { capacity, branches };
}

function setNodeWidget(node, key, value) {
  if (!node) return false;
  const widgets = node.widgets_values;
  if (widgets && !Array.isArray(widgets) && typeof widgets === 'object') {
    widgets[key] = value;
    if (key === 'video' && widgets.videopreview?.params) {
      widgets.videopreview.params.filename = value;
      widgets.videopreview.params.type = 'input';
    }
  } else if (Array.isArray(widgets)) {
    const widgetNames = nodeInputs(node).filter((input) => input?.widget?.name && !['upload', 'audioUI'].includes(input.widget.name)).map((input) => input.widget.name);
    const index = Math.max(0, widgetNames.indexOf(key));
    widgets[index] = value;
  } else {
    node.widgets_values = value;
  }
  return true;
}

function setLoaderFilename(node, kind, filename) {
  if (!node || !LOADER_TYPES[kind]?.has(node.type)) return false;
  return setNodeWidget(node, kind === 'image' ? 'image' : (kind === 'video' ? 'video' : 'audio'), filename);
}

function disconnectInput(node, inputName) {
  const input = (node?.inputs || []).find((item) => item.name === inputName);
  if (input) input.link = null;
}

function cloneWorkflow(workflow) {
  return JSON.parse(JSON.stringify(workflow));
}

function graphComponentNodeIds(workflow, startNodeId) {
  const adjacency = new Map();
  for (const link of workflow?.links || []) {
    const from = String(link?.[1]);
    const to = String(link?.[3]);
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  }
  const found = new Set();
  const queue = [String(startNodeId)];
  while (queue.length) {
    const id = queue.shift();
    if (!id || found.has(id)) continue;
    found.add(id);
    for (const next of adjacency.get(id) || []) queue.push(next);
  }
  return found;
}

function selectReferenceBranch(workflow, refs) {
  const nodes = h3Nodes(workflow);
  if (!nodes.length) throw new Error('工作流中没有 MiniMax H3 节点');
  const requested = { image: refs.images.length, video: refs.videos.length, audio: refs.audios.length };
  const candidates = nodes.map((node) => {
    const slots = slotsForH3Node(workflow, node);
    const capacity = Object.fromEntries(['image', 'video', 'audio'].map((kind) => [kind, slots.filter((slot) => slot.kind === kind).length]));
    const spare = Object.keys(requested).reduce((sum, kind) => sum + Math.max(0, capacity[kind] - requested[kind]), 0);
    return { node, slots, capacity, spare };
  }).filter((candidate) => Object.keys(requested).every((kind) => requested[kind] <= candidate.capacity[kind]));
  if (!candidates.length) {
    const max = describeComfyUiWorkflowCapabilities(workflow).capacity;
    throw new Error(`MiniMax H3 引用不匹配：需要图片 ${requested.image}、视频 ${requested.video}、音频 ${requested.audio}；工作流最多支持图片 ${max.image}、视频 ${max.video}、音频 ${max.audio}`);
  }
  candidates.sort((a, b) => a.spare - b.spare || (Number(a.node.mode) === 0 ? -1 : 1));
  const selected = candidates[0];
  if (nodes.length > 1) {
    const selectedIds = graphComponentNodeIds(workflow, selected.node.id);
    const disabledIds = new Set(nodes.filter((node) => node !== selected.node).flatMap((node) => [...graphComponentNodeIds(workflow, node.id)]));
    for (const node of workflow.nodes || []) {
      const id = String(node.id);
      if (selectedIds.has(id)) node.mode = 0;
      else if (disabledIds.has(id)) node.mode = 4;
    }
  }
  return selected;
}

function activateInputChain(workflow, input) {
  if (input?.link == null) return;
  const link = linkMap(workflow).get(String(input.link));
  const nodes = nodeMap(workflow);
  if (!link) return;
  for (const id of upstreamNodeIds(workflow, link[1])) {
    const node = nodes.get(String(id));
    if (node) node.mode = 0;
  }
}

function inputIndex(inputName) {
  const match = String(inputName || '').match(/_(\d+)$/);
  return match ? Number(match[1]) : -1;
}

function associatedVideoAudioInput(node, videoInputName) {
  const index = inputIndex(videoInputName);
  return index >= 0
    ? nodeInputs(node).find((input) => input.name === `${VIDEO_AUDIO_INPUT_PREFIX}${index}`) || null
    : null;
}

function setPromptForBranch(workflow, h3Node, prompt) {
  const promptInput = nodeInputs(h3Node).find((input) => input.name === 'prompt');
  if (!promptInput || promptInput.link == null) throw new Error(`MiniMax H3 节点 ${h3Node.id} 没有可写入的提示词节点`);
  const link = linkMap(workflow).get(String(promptInput.link));
  const nodes = nodeMap(workflow);
  const sourceIds = link ? [...upstreamNodeIds(workflow, link[1])] : [];
  const source = sourceIds.map((id) => nodes.get(String(id))).find((node) => node?.type === 'PrimitiveStringMultiline');
  if (!source) throw new Error(`MiniMax H3 节点 ${h3Node.id} 无法定位提示词输入`);
  setNodeWidget(source, 'value', String(prompt || '').trim());
  source.mode = 0;
  activateInputChain(workflow, promptInput);
  return String(source.id);
}

function applyDuration(workflow, duration) {
  const seconds = Number(duration);
  if (!Number.isFinite(seconds)) return;
  for (const node of workflow?.nodes || []) {
    if (Number(node.mode) === 4 || node.type !== 'PrimitiveFloat' || !/duration/i.test(String(node.title || ''))) continue;
    setNodeWidget(node, 'value', Math.max(5, Math.min(15, seconds)));
  }
}

export function bindComfyUiReferences(workflow, refs = {}, { prompt = '', duration = null } = {}) {
  const next = cloneWorkflow(workflow);
  const normalized = {
    images: Array.isArray(refs.images) ? refs.images.filter(Boolean) : [],
    videos: Array.isArray(refs.videos) ? refs.videos.filter(Boolean) : [],
    audios: Array.isArray(refs.audios) ? refs.audios.filter(Boolean) : [],
  };
  const selected = selectReferenceBranch(next, normalized);
  const selectedNode = nodeMap(next).get(String(selected.node.id));
  const slots = slotsForH3Node(next, selectedNode);
  const byKind = new Map(['image', 'video', 'audio'].map((kind) => [kind, slots.filter((slot) => slot.kind === kind)]));
  const nodes = nodeMap(next);
  const assignedLoaderNodes = new Set();
  const binding = [];
  for (const kind of ['image', 'video', 'audio']) {
    const items = normalized[`${kind}s`];
    const kindSlots = byKind.get(kind) || [];
    for (let index = 0; index < items.length; index += 1) {
      const slot = kindSlots[index];
      if (!slot) throw new Error(`MiniMax H3 ${kind} 引用第 ${index + 1} 项没有对应槽位`);
      if (slot.loaderNodeIds.length !== 1) throw new Error(`MiniMax H3 引用槽位 ${slot.nodeId}.${slot.inputName} 对应 ${slot.loaderNodeIds.length} 个上传节点，无法保证一一对应`);
      const loaderId = String(slot.loaderNodeIds[0]);
      if (assignedLoaderNodes.has(loaderId)) throw new Error(`MiniMax H3 引用槽位复用了上传节点 ${loaderId}，已阻止提交`);
      const loader = nodes.get(loaderId);
      if (!setLoaderFilename(loader, kind, items[index])) throw new Error(`无法写入 ${kind} 上传节点 ${loaderId}`);
      const slotInput = nodeInputs(selectedNode).find((input) => input.name === slot.inputName);
      activateInputChain(next, slotInput);
      const associatedInputs = [];
      if (kind === 'video') {
        const audioInput = associatedVideoAudioInput(selectedNode, slot.inputName);
        if (audioInput?.link != null) {
          const associatedLoaders = loaderIdsForInput(next, audioInput, 'video').map(String);
          if (!associatedLoaders.includes(loaderId)) throw new Error(`视频引用 ${index + 1} 的画面与伴随音频没有指向同一上传节点`);
          activateInputChain(next, audioInput);
          associatedInputs.push(audioInput.name);
        }
      }
      assignedLoaderNodes.add(loaderId);
      binding.push({
        index: index + 1,
        kind,
        nodeId: slot.nodeId,
        inputName: slot.inputName,
        associatedInputs,
        loaderNodeId: loaderId,
        loaderNodeType: loader.type,
        filename: items[index],
      });
    }
    for (let index = items.length; index < kindSlots.length; index += 1) {
      const slot = kindSlots[index];
      disconnectInput(selectedNode, slot.inputName);
      if (kind === 'video') {
        const audioInput = associatedVideoAudioInput(selectedNode, slot.inputName);
        if (audioInput) audioInput.link = null;
      }
    }
  }
  const promptNodeId = setPromptForBranch(next, selectedNode, prompt);
  applyDuration(next, duration);
  return {
    workflow: next,
    binding,
    branch: {
      nodeId: String(selectedNode.id),
      nodeType: selectedNode.type,
      label: branchLabel(selected.capacity),
      capacity: selected.capacity,
      promptNodeId,
    },
  };
}

async function uploadComfyUiMedia(baseUrl, filePath, { type = 'input', subfolder = '' } = {}) {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`素材不存在：${filePath}`);
  const bytes = await fs.promises.readFile(filePath);
  const name = path.basename(filePath);
  const form = new FormData();
  form.append('image', new Blob([bytes]), name);
  form.append('type', type);
  form.append('subfolder', subfolder);
  form.append('overwrite', 'true');
  const response = await fetchWithTimeout(comfyUrl(baseUrl, '/upload/image'), { method: 'POST', body: form }, 5 * 60 * 1000);
  const data = await readJson(response, `上传素材 ${name}`);
  const uploaded = String(data?.name || name).trim();
  const folder = String(data?.subfolder || subfolder || '').trim();
  return folder ? `${folder}/${uploaded}` : uploaded;
}

async function uploadComfyUiFile(baseUrl, filePath, kind, uploadScope) {
  return uploadComfyUiMedia(baseUrl, filePath, { type: 'input', subfolder: `hepai/${uploadScope}/${kind}` });
}

function apiPromptDependsOn(apiPrompt, startNodeId, targetNodeId, seen = new Set()) {
  const start = String(startNodeId || '');
  const target = String(targetNodeId || '');
  if (!start || !target || seen.has(start)) return false;
  if (start === target) return true;
  seen.add(start);
  const node = apiPrompt[start];
  if (!node) return false;
  return Object.values(node.inputs || {}).some((value) => (
    Array.isArray(value)
    && value.length === 2
    && apiPromptDependsOn(apiPrompt, value[0], target, seen)
  ));
}

function verifyApiReferenceBinding(apiPrompt, binding = []) {
  for (const item of binding) {
    const h3 = apiPrompt[String(item.nodeId)];
    const loader = apiPrompt[String(item.loaderNodeId)];
    const linked = h3?.inputs?.[item.inputName];
    if (!h3 || !loader || !Array.isArray(linked) || linked.length !== 2 || !apiPromptDependsOn(apiPrompt, linked[0], item.loaderNodeId)) {
      throw new Error(`MiniMax H3 引用 ${item.kind} ${item.index} 未形成有效结构化绑定，已阻止提交`);
    }
    for (const inputName of item.associatedInputs || []) {
      const associated = h3.inputs?.[inputName];
      if (!Array.isArray(associated) || associated.length !== 2 || !apiPromptDependsOn(apiPrompt, associated[0], item.loaderNodeId)) {
        throw new Error(`MiniMax H3 视频引用 ${item.index} 的伴随音频未绑定，已阻止提交`);
      }
    }
  }
}

export function prepareComfyUiPrompt({ workflow, prompt, refs = {}, objectInfo = null, duration = null } = {}) {
  if (!workflow) throw new Error('没有加载 ComfyUI 工作流');
  if (!objectInfo || typeof objectInfo !== 'object') throw new Error('缺少 ComfyUI 节点信息，无法安全转换工作流');
  const bound = bindComfyUiReferences(workflow, refs, { prompt, duration });
  materializeGetNodeLinks(bound.workflow);
  const apiPrompt = graphToApiPrompt(bound.workflow, objectInfo);
  verifyApiReferenceBinding(apiPrompt, bound.binding);
  const promptNode = apiPrompt[String(bound.branch.promptNodeId)];
  if (!promptNode || String(promptNode.inputs?.value || '') !== String(prompt || '').trim()) {
    throw new Error('MiniMax H3 提示词没有写入当前工作流分支，已阻止提交');
  }
  return { ...bound, apiPrompt };
}

export async function submitComfyUiPrompt({ baseUrl, workflow, prompt, refs = {}, objectInfo = null, workflowPath = '', duration = null } = {}) {
  const normalizedBaseUrl = normalizeComfyUiBaseUrl(baseUrl, '');
  if (!normalizedBaseUrl) throw new Error('请先填写 ComfyUI 云端地址');
  if (!workflow) throw new Error('没有加载 ComfyUI 工作流');
  const uploadScope = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const uploaded = { images: [], videos: [], audios: [] };
  for (const [kind, items] of Object.entries({ images: refs.images || [], videos: refs.videos || [], audios: refs.audios || [] })) {
    for (const item of items) uploaded[kind].push(await uploadComfyUiFile(normalizedBaseUrl, item, kind, uploadScope));
  }
  const prepared = prepareComfyUiPrompt({ workflow, prompt, refs: uploaded, objectInfo, duration });
  const response = await fetchWithTimeout(comfyUrl(normalizedBaseUrl, '/prompt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: prepared.apiPrompt,
      extra_data: {
        extra_pnginfo: {
          workflow: prepared.workflow,
          workflow_path: workflowPath,
          hepai_reference_binding: prepared.binding,
          hepai_h3_branch: prepared.branch,
        },
      },
    }),
  }, COMFY_TIMEOUT_MS);
  const data = await readJson(response, '提交 ComfyUI 工作流');
  if (!data?.prompt_id) throw new Error('ComfyUI 未返回 prompt_id');
  return {
    promptId: String(data.prompt_id),
    binding: prepared.binding,
    branch: prepared.branch,
    workflow: prepared.workflow,
  };
}

export async function getComfyUiHistory(baseUrl, promptId) {
  return getJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, '查询 ComfyUI 任务', COMFY_QUEUE_TIMEOUT_MS);
}

function collectComfyUiOutputs(history, baseUrl) {
  const record = history?.[Object.keys(history || {})[0]] || history || {};
  const outputs = record?.outputs || {};
  const urls = [];
  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== 'object') return;
    if (value.filename && (value.type === 'output' || value.subfolder !== undefined)) {
      const params = new URLSearchParams({ filename: String(value.filename), subfolder: String(value.subfolder || ''), type: String(value.type || 'output') });
      urls.push(comfyUrl(baseUrl, `/view?${params.toString()}`));
    }
    Object.values(value).forEach(walk);
  };
  walk(outputs);
  return [...new Set(urls)];
}

export function comfyUiResultVideoUrls(history, baseUrl) {
  return collectComfyUiOutputs(history, baseUrl).filter((url) => /(?:mp4|webm|mov|m4v|video|gifs?)/i.test(url));
}

export function comfyUiHistoryStatus(history) {
  const record = history?.[Object.keys(history || {})[0]] || history || {};
  const status = record?.status || {};
  const completed = status.completed === true || status.status_str === 'success';
  const failed = status.status_str === 'error' || status.status_str === 'failed' || Boolean(status?.messages?.some?.((item) => /error|exception/i.test(JSON.stringify(item))));
  return { completed, failed, status: String(status.status_str || ''), error: failed ? JSON.stringify(status.messages || '').slice(0, 800) : '' };
}

export function comfyUiWorkflowPreset(id) {
  return COMFYUI_WORKFLOW_PRESETS.find((item) => item.id === String(id || '').trim()) || COMFYUI_WORKFLOW_PRESETS[0];
}
