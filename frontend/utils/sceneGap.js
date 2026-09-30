// 场景补漏：扫描分镜文本里的场景标记，对比元素库 scene，列出缺失场景并支持一键补建。
// 场景标记兼容多种写法：
//   [场景：裴家窝棚门前荒地，月光...] / 【场景：xxx】 / 【场景】xxx / 场景名称：xxx
// 场景名截断到第一个标点（逗号/分号等）或方括号注记（[外][夜]）之前。
import { applyAddedElement } from './elementCrud.js';

export function extractSceneMarksFromStoryboard(content) {
  const text = String(content || '');
  if (!text.trim()) return [];
  const counter = new Map();
  const add = (rawName) => {
    let name = String(rawName || '').trim();
    name = name.split(/[【\[]/)[0]; // 去掉「[外][夜]」等括号注记
    name = name.split(/[，,；;。！？\n：:]/)[0]; // 去掉场景名后的画面描述
    name = name.replace(/^[\s·、.-]+|[\s·、.-]+$/g, '').trim();
    if (!name || name.length < 2 || name.length > 40) return;
    // 过滤明显的非场景词
    if (/^(?:无|同上|略|同前一镜)$/.test(name)) return;
    counter.set(name, (counter.get(name) || 0) + 1);
  };
  for (const m of text.matchAll(/[【\[（(]\s*场景\s*[:：]\s*([^\】\]）)]+)/g)) add(m[1]);
  for (const m of text.matchAll(/【场景】\s*([^\n]+)/g)) add(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*场景名称\s*[:：]\s*([^\n]+)/g)) add(m[1]);
  return [...counter.entries()].map(([name, count]) => ({ name, count }));
}

// 双向包含即视为已覆盖：分镜名更具体（裴家窝棚门前 ⊃ 库名裴家窝棚）或库名更具体都算
export function matchSceneToLibrary(name, scenes = []) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  for (const scene of scenes) {
    for (const candidate of [String(scene?.name || '').trim(), String(scene?.alias || '').trim()]) {
      const c = candidate.toLowerCase();
      if (!c) continue;
      if (c.includes(target) || target.includes(c)) return scene;
    }
  }
  return null;
}

export function createSceneGapRuntime({ api, message, reactive, computed, refs = {}, helpers = {} } = {}) {
  const sceneGap = reactive({
    visible: false,
    scope: 'all', // all | current
    loading: false,
    creating: false,
    items: [], // { name, count, missing, matchedName, selected }
  });

  const missingCount = computed(() => sceneGap.items.filter((item) => item.missing).length);
  const selectedMissingCount = computed(() => sceneGap.items.filter((item) => item.missing && item.selected).length);

  const storyboardsForScope = () => {
    const list = refs.scriptState?.storyboards || [];
    if (sceneGap.scope === 'current') {
      const current = helpers.findStoryboard?.(refs.sbEpisodeId?.value);
      return current ? [current] : [];
    }
    return list;
  };

  const analyze = () => {
    const scenes = refs.project?.value?.elements?.scene || [];
    const counter = new Map();
    for (const sb of storyboardsForScope()) {
      for (const mark of extractSceneMarksFromStoryboard(sb?.content)) {
        counter.set(mark.name, (counter.get(mark.name) || 0) + mark.count);
      }
    }
    sceneGap.items = [...counter.entries()]
      .map(([name, count]) => {
        const matched = matchSceneToLibrary(name, scenes);
        return {
          name,
          count,
          missing: !matched,
          matchedName: matched ? String(matched.alias || matched.name || '').trim() : '',
          selected: !matched,
        };
      })
      .sort((a, b) => (b.missing - a.missing) || (b.count - a.count));
  };

  const openSceneGapDialog = () => {
    if (!refs.project?.value) return message.warning('请先打开项目');
    sceneGap.scope = 'all';
    analyze();
    if (!sceneGap.items.length) return message.warning('分镜里没有找到场景标记，请先生成分镜');
    sceneGap.visible = true;
  };

  const onSceneGapScopeChange = () => analyze();

  const toggleSceneGapSelectAll = (value) => {
    for (const item of sceneGap.items) {
      if (item.missing) item.selected = value !== false;
    }
  };

  const createMissingScenes = async () => {
    const targets = sceneGap.items.filter((item) => item.missing && item.selected);
    if (!targets.length) return message.warning('请先勾选要补建的场景');
    const project = refs.project.value;
    if (!project) return;
    sceneGap.creating = true;
    let ok = 0;
    try {
      for (const target of targets) {
        const result = await api.post('/api/project/element/add', { projectId: project.id, category: 'scene', name: target.name });
        if (!result.ok) {
          message.error(`「${target.name}」创建失败：${result.error || '未知错误'}`);
          continue;
        }
        ok += 1;
        if (result.element) applyAddedElement(project, 'scene', result.element, result.index);
      }
      message.success(`已补建 ${ok}/${targets.length} 个场景元素，可到元素库-场景 出图`);
      analyze(); // 重新匹配，缺失项应转为已覆盖
    } catch (error) {
      message.error(`创建失败：${error?.message || error}`);
    } finally {
      sceneGap.creating = false;
    }
  };

  return {
    sceneGap,
    missingCount,
    selectedMissingCount,
    openSceneGapDialog,
    onSceneGapScopeChange,
    toggleSceneGapSelectAll,
    createMissingScenes,
  };
}
