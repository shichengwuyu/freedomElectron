import { discoveredModelOptions, normalizeDiscoveredModelNames } from './modelDiscovery.js';

export const MODEL_ROUTING_TASK_OPTIONS = Object.freeze([
  { key: 'default', label: '默认任务', hint: '未单独指定的文本生成请求' },
  { key: 'novel', label: '小说创作', hint: '小说续写、改写和大纲生成' },
  { key: 'extraction', label: '元素提取', hint: '人物、场景、道具与特效提取' },
  { key: 'adaptation', label: '改编规划', hint: '整本规划、章节拆集与结构设计' },
  { key: 'script', label: '剧本生成', hint: '单集剧本生成、修订与审稿' },
  { key: 'storyboard', label: '分镜生成', hint: '镜头设计与视频提示词生成' },
  { key: 'reference', label: '参考反推', hint: '参考视频/图片反推提示词与 15 秒拉片；需要能读图/读视频的模型' },
  { key: 'editing', label: 'AI 剪辑导演', hint: '剧本理解、节奏重组、转场与混音决策' },
  { key: 'binding', label: '元素绑定', hint: '分镜与人物、场景、道具绑定' },
  { key: 'agent', label: 'Agent', hint: 'Agent 规划与自动执行' },
  { key: 'review', label: '内容审查', hint: '质量复核、覆盖校验与内容审稿' },
  { key: 'qa', label: '质检任务', hint: 'AI 辅助质检与修复建议' },
]);

function profileId() {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function ensureModelRoutingConfig(cfg = {}) {
  cfg.modelRouting = cfg.modelRouting && typeof cfg.modelRouting === 'object'
    ? cfg.modelRouting
    : {};
  const routing = cfg.modelRouting;
  routing.enabled = routing.enabled === true;
  routing.autoFallback = routing.autoFallback !== false;
  routing.retryCount = Math.max(0, Math.min(3, Math.floor(finite(routing.retryCount, 1))));
  if (!Array.isArray(routing.profiles)) routing.profiles = [];
  if (!routing.profiles.length) {
    routing.profiles.push({
      id: 'primary',
      name: '主文本模型',
      enabled: true,
      baseUrl: cfg.text?.baseUrl || '',
      apiKey: cfg.text?.apiKey || '',
      model: cfg.text?.model || '',
      models: normalizeDiscoveredModelNames(cfg.text?.models),
      temperature: finite(cfg.text?.temperature, 0.7),
      maxTokens: finite(cfg.text?.maxTokens, 256000),
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });
  }
  routing.profiles.forEach((profile, index) => {
    profile.id = String(profile.id || (index === 0 ? 'primary' : profileId()));
    profile.name = String(profile.name || `文本模型 ${index + 1}`);
    profile.enabled = profile.enabled !== false;
    profile.baseUrl = String(profile.baseUrl || '');
    profile.apiKey = String(profile.apiKey || '');
    profile.model = String(profile.model || '');
    profile.models = normalizeDiscoveredModelNames(profile.models);
    profile.temperature = finite(profile.temperature, 0.7);
    profile.maxTokens = Math.max(1, Math.round(finite(profile.maxTokens, 256000)));
    profile.inputPricePerMillion = Math.max(0, finite(profile.inputPricePerMillion));
    profile.outputPricePerMillion = Math.max(0, finite(profile.outputPricePerMillion));
  });
  if (!routing.routes || typeof routing.routes !== 'object') routing.routes = {};
  if (!routing.fallbacks || typeof routing.fallbacks !== 'object') routing.fallbacks = {};
  const enabled = routing.profiles.filter((profile) => profile.enabled);
  const defaultProfile = enabled[0] || routing.profiles[0];
  const ids = new Set(routing.profiles.map((profile) => profile.id));
  const enabledIds = new Set(enabled.map((profile) => profile.id));
  for (const task of MODEL_ROUTING_TASK_OPTIONS) {
    if (!enabledIds.has(routing.routes[task.key])) routing.routes[task.key] = defaultProfile.id;
    if (!Array.isArray(routing.fallbacks[task.key])) routing.fallbacks[task.key] = [];
    routing.fallbacks[task.key] = [...new Set(routing.fallbacks[task.key])]
      .filter((id) => ids.has(id) && id !== routing.routes[task.key]);
  }
  return routing;
}

export function createModelRoutingRuntime({ api, message, messageBox, refs = {}, reactive, computed } = {}) {
  const modelProfileTesting = reactive({});
  const modelProfileDiscovering = reactive({});
  const modelProfileTestResult = reactive({});
  const usage = reactive({
    loading: false,
    clearing: false,
    days: 30,
    scope: 'all',
    summary: null,
    records: [],
  });

  const routing = () => refs.config.modelRouting || ensureModelRoutingConfig(refs.config);
  const enabledModelProfiles = computed(() => routing().profiles.filter((profile) => profile.enabled));
  const modelRoutingTasks = MODEL_ROUTING_TASK_OPTIONS;
  const currentUsageProjectId = () => usage.scope === 'project' ? String(refs.project?.value?.id || '') : '';

  const syncModelRoutes = () => ensureModelRoutingConfig(refs.config);
  const syncPrimaryModelProfileFromText = () => {
    const primary = ensureModelRoutingConfig(refs.config).profiles[0];
    const text = refs.config.text || {};
    Object.assign(primary, {
      baseUrl: String(text.baseUrl || ''),
      apiKey: String(text.apiKey || ''),
      model: String(text.model || ''),
      models: normalizeDiscoveredModelNames(text.models),
      temperature: finite(text.temperature, 0.7),
      maxTokens: Math.max(1, Math.round(finite(text.maxTokens, 256000))),
    });
    routing().syncPrimaryFromText = true;
  };
  const syncTextModelFromPrimaryProfile = (profile, index) => {
    if (index !== 0 || !profile) return;
    refs.config.text = refs.config.text && typeof refs.config.text === 'object' ? refs.config.text : {};
    Object.assign(refs.config.text, {
      baseUrl: String(profile.baseUrl || ''),
      apiKey: String(profile.apiKey || ''),
      model: String(profile.model || ''),
      models: normalizeDiscoveredModelNames(profile.models),
      temperature: finite(profile.temperature, 0.7),
      maxTokens: Math.max(1, Math.round(finite(profile.maxTokens, 256000))),
    });
    routing().syncPrimaryFromText = true;
  };
  const addModelProfile = () => {
    const source = routing().profiles[0] || refs.config.text || {};
    routing().profiles.push({
      id: profileId(),
      name: `文本模型 ${routing().profiles.length + 1}`,
      enabled: true,
      baseUrl: source.baseUrl || refs.config.text?.baseUrl || '',
      apiKey: '',
      model: source.model || refs.config.text?.model || '',
      models: normalizeDiscoveredModelNames(source.models || refs.config.text?.models),
      temperature: finite(source.temperature, 0.7),
      maxTokens: finite(source.maxTokens, 256000),
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });
    syncModelRoutes();
  };
  const duplicateModelProfile = (source) => {
    routing().profiles.push({
      ...source,
      id: profileId(),
      name: `${source.name || '文本模型'} 副本`,
      apiKey: '',
    });
    syncModelRoutes();
  };
  const deleteModelProfile = async (profile) => {
    if (routing().profiles.length <= 1) return message.warning('至少保留一个文本模型 Profile');
    try {
      await messageBox?.confirm?.(`删除“${profile.name || profile.model || '该模型'}”？相关任务会自动切换到其他可用模型。`, '删除模型 Profile', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
    const index = routing().profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) routing().profiles.splice(index, 1);
    delete modelProfileTestResult[profile.id];
    syncModelRoutes();
  };
  const onModelProfileToggle = (profile) => {
    if (!routing().profiles.some((item) => item.enabled)) profile.enabled = true;
    syncModelRoutes();
  };
  const availableFallbackProfiles = (taskKey) => routing().profiles.filter((profile) => (
    profile.enabled && profile.id !== routing().routes[taskKey]
  ));
  const onModelRouteChange = (taskKey) => {
    routing().fallbacks[taskKey] = (routing().fallbacks[taskKey] || [])
      .filter((id) => id !== routing().routes[taskKey]);
  };

  const testModelProfile = async (profile) => {
    if (modelProfileTesting[profile.id]) return;
    modelProfileTesting[profile.id] = true;
    modelProfileTestResult[profile.id] = null;
    try {
      const result = await api.post('/api/test/text', {
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
      });
      modelProfileTestResult[profile.id] = result.ok
        ? { ok: true, message: `连接成功：${result.sample || '模型已响应'}` }
        : { ok: false, message: result.error || '连接失败' };
    } catch (error) {
      modelProfileTestResult[profile.id] = { ok: false, message: error.message || String(error) };
    } finally {
      modelProfileTesting[profile.id] = false;
    }
  };
  const modelProfileModels = (profile) => discoveredModelOptions(profile.models, [profile.model]);
  const fetchModelProfileModels = async (profile, index) => {
    if (modelProfileDiscovering[profile.id]) return;
    if (!String(profile.baseUrl || '').trim()) return message.warning('请先填写文本模型 Base URL');
    if (!String(profile.apiKey || '').trim()) return message.warning('请先填写文本模型 API Key');
    modelProfileDiscovering[profile.id] = true;
    try {
      const result = await api.post('/api/models/discover', {
        kind: 'text',
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
      });
      if (!result.ok) return message.error(`${profile.name}：${result.error || '拉取模型失败'}`);
      profile.models = normalizeDiscoveredModelNames(result.models);
      if (!profile.model && profile.models.length) profile.model = profile.models[0];
      syncTextModelFromPrimaryProfile(profile, index);
      message.success(`${profile.name}：已拉取 ${profile.models.length} 个文本模型`);
    } catch (error) {
      message.error(`${profile.name}：${error.message || error}`);
    } finally {
      modelProfileDiscovering[profile.id] = false;
    }
  };

  const loadCostCenter = async () => {
    usage.loading = true;
    try {
      const projectId = currentUsageProjectId();
      const query = new URLSearchParams({ days: String(usage.days) });
      if (projectId) query.set('projectId', projectId);
      const [summaryResult, recordsResult] = await Promise.all([
        api.get(`/api/usage/summary?${query}`),
        api.get(`/api/usage/records?${query}&limit=100`),
      ]);
      usage.summary = summaryResult.summary || null;
      usage.records = Array.isArray(recordsResult.records) ? recordsResult.records : [];
    } catch (error) {
      message.error(`成本数据加载失败：${error.message || error}`);
    } finally {
      usage.loading = false;
    }
  };
  const clearCostRecords = async () => {
    try {
      await messageBox?.confirm?.(
        usage.scope === 'project' ? '清空当前项目的成本记录？此操作不可撤销。' : '清空全部模型成本记录？此操作不可撤销。',
        '清空成本记录',
        { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
    usage.clearing = true;
    try {
      const result = await api.post('/api/usage/clear', { projectId: currentUsageProjectId() });
      message.success(`已清空 ${result.count || 0} 条成本记录`);
      await loadCostCenter();
    } catch (error) {
      message.error(`清空失败：${error.message || error}`);
    } finally {
      usage.clearing = false;
    }
  };

  const monthlyBudget = computed(() => Math.max(0, finite(refs.config.costTracking?.monthlyBudget)));
  const budgetUsageRate = computed(() => {
    if (!monthlyBudget.value) return 0;
    return Math.min(999, (finite(usage.summary?.total?.cost) / monthlyBudget.value) * 100);
  });
  const budgetProgressStatus = computed(() => (
    budgetUsageRate.value >= 100 ? 'exception' : (budgetUsageRate.value >= 80 ? 'warning' : 'success')
  ));
  const formatCost = (value) => `${refs.config.costTracking?.currency || 'CNY'} ${finite(value).toFixed(finite(value) >= 100 ? 2 : 4)}`;
  const formatTokenCount = (value) => new Intl.NumberFormat('zh-CN', { notation: finite(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(finite(value));
  const formatUsageTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
  };
  const usageKindLabel = (kind) => ({ text: '文本', image: '图片', video: '视频' }[kind] || kind || '未知');
  const usageTaskLabel = (task) => modelRoutingTasks.find((item) => item.key === task)?.label || task || '默认任务';

  return {
    modelRoutingTasks,
    modelProfileTesting,
    modelProfileDiscovering,
    modelProfileTestResult,
    enabledModelProfiles,
    usage,
    monthlyBudget,
    budgetUsageRate,
    budgetProgressStatus,
    syncModelRoutes,
    syncPrimaryModelProfileFromText,
    syncTextModelFromPrimaryProfile,
    addModelProfile,
    duplicateModelProfile,
    deleteModelProfile,
    onModelProfileToggle,
    availableFallbackProfiles,
    onModelRouteChange,
    testModelProfile,
    modelProfileModels,
    fetchModelProfileModels,
    loadCostCenter,
    clearCostRecords,
    formatCost,
    formatTokenCount,
    formatUsageTime,
    usageKindLabel,
    usageTaskLabel,
  };
}
