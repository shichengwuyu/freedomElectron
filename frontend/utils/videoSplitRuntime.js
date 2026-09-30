const SPLIT_SETTINGS_KEY = 'yanzhi-video-split-settings';

function normalizeNaturalWindow(value, fallback = 10) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(120, Math.max(0, number)) : fallback;
}

function readSavedSettings(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SPLIT_SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSettings(storage, state) {
  try {
    storage?.setItem(SPLIT_SETTINGS_KEY, JSON.stringify({
      minimumSeconds: Number(state.minimumSeconds) || 40,
      naturalCut: state.naturalCut !== false,
      naturalWindowSeconds: normalizeNaturalWindow(state.naturalWindowSeconds),
      rules: (state.rules || []).map((rule) => ({
        startEpisode: Number(rule.startEpisode) || 1,
        endEpisode: Number(rule.endEpisode) || 0,
        duration: Number(rule.duration) || 40,
        unit: rule.unit === 'minute' ? 'minute' : 'second',
      })),
      prefix: String(state.prefix || '').slice(0, 80),
      outputDirectory: String(state.outputDirectory || ''),
    }));
  } catch { /* localStorage may be unavailable in a restricted webview */ }
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = Math.floor(value % 60);
  if (hours) return `${hours}小时${String(minutes).padStart(2, '0')}分`;
  return `${minutes}分${String(remainder).padStart(2, '0')}秒`;
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function makeRule(startEpisode, endEpisode, duration, unit) {
  return {
    id: `split_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startEpisode,
    endEpisode,
    duration,
    unit,
  };
}

function makeSourceFile(filePath, duration = 0) {
  const name = String(filePath || '').split(/[\\/]/).pop() || String(filePath || '');
  return {
    id: `split_source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    path: filePath,
    name,
    duration: Number(duration) || 0,
  };
}

function loadRules(saved) {
  if (Array.isArray(saved.rules) && saved.rules.length) {
    const legacyDefault = saved.rules.length === 3
      && Number(saved.rules[0]?.startEpisode) === 1 && Number(saved.rules[0]?.endEpisode) === 1
      && Number(saved.rules[0]?.duration) === 5 && saved.rules[0]?.unit === 'minute'
      && Number(saved.rules[1]?.startEpisode) === 2 && Number(saved.rules[1]?.endEpisode) === 2
      && Number(saved.rules[1]?.duration) === 3 && saved.rules[1]?.unit === 'minute'
      && Number(saved.rules[2]?.startEpisode) === 3 && Number(saved.rules[2]?.endEpisode) === 0
      && Number(saved.rules[2]?.duration) === 40 && saved.rules[2]?.unit === 'second';
    const sourceRules = legacyDefault ? saved.rules.slice(0, 2) : saved.rules;
    return sourceRules.map((rule, index) => makeRule(
      Math.max(1, Number(rule.startEpisode) || index + 1),
      Math.max(0, Number(rule.endEpisode) || 0),
      Math.max(1, Number(rule.duration) || 40),
      rule.unit === 'minute' ? 'minute' : 'second',
    ));
  }
  return [
    makeRule(1, 1, 5, 'minute'),
    makeRule(2, 2, 3, 'minute'),
  ];
}

export function createAppVideoSplitRuntime({ api, message, reactive, globals = {} } = {}) {
  const storage = globals.window?.localStorage;
  const saved = readSavedSettings(storage);
  const splitStudio = reactive({
    sourcePath: '',
    sourceName: '',
    sourceFiles: [],
    duration: 0,
    probing: false,
    splitting: false,
    minimumSeconds: Number(saved.minimumSeconds) > 0 ? Number(saved.minimumSeconds) : 40,
    naturalCut: saved.naturalCut !== false,
    naturalWindowSeconds: normalizeNaturalWindow(saved.naturalWindowSeconds),
    rules: loadRules(saved),
    prefix: String(saved.prefix || ''),
    outputDirectory: String(saved.outputDirectory || ''),
    segments: [],
    naturalAdjustments: 0,
  });

  async function chooseSplitVideo() {
    if (splitStudio.splitting) return;
    const chooser = globals.window?.desktopPetHost?.chooseVideoFile;
    if (!chooser) return message.error('当前环境不支持选择本地视频');
    try {
      const result = await chooser();
      const selectedPaths = (Array.isArray(result?.paths) && result.paths.length ? result.paths : [result?.path]).filter(Boolean);
      const paths = [...new Set([...splitStudio.sourceFiles.map((file) => file.path), ...selectedPaths])];
      if (result?.canceled || !paths.length) return;
      splitStudio.sourceFiles = paths.map((filePath) => makeSourceFile(filePath));
      splitStudio.sourcePath = paths[0];
      splitStudio.sourceName = paths.length === 1
        ? splitStudio.sourceFiles[0].name
        : `${splitStudio.sourceFiles[0].name} 等 ${paths.length} 个部分`;
      splitStudio.segments = [];
      splitStudio.naturalAdjustments = 0;
      if (!splitStudio.prefix) {
        splitStudio.prefix = splitStudio.sourceFiles[0].name.replace(/\.[^.]+$/, '');
      }
      await probeSplitVideo();
      saveSettings(storage, splitStudio);
    } catch (error) {
      message.error(`选择视频失败：${error.message}`);
    }
  }

  async function probeSplitVideo() {
    if (!splitStudio.sourcePath) return;
    splitStudio.probing = true;
    try {
      const result = await api.post('/api/video-split/probe', {
        sourcePaths: splitStudio.sourceFiles.map((file) => file.path),
      }, { timeoutMs: 2 * 60 * 1000 });
      splitStudio.duration = Number(result.duration) || 0;
      splitStudio.sourceName = splitStudio.sourceFiles.length === 1
        ? (result.sourceName || splitStudio.sourceFiles[0]?.name || '')
        : `${result.sourceName || splitStudio.sourceFiles[0]?.name || ''} 等 ${splitStudio.sourceFiles.length} 个部分`;
      const durations = Array.isArray(result.durations) ? result.durations : [];
      splitStudio.sourceFiles.forEach((file, index) => { file.duration = Number(durations[index]) || 0; });
    } catch (error) {
      splitStudio.duration = 0;
      message.error(`读取视频时长失败：${error.message}`);
    } finally {
      splitStudio.probing = false;
    }
  }

  function syncSourcePath() {
    splitStudio.sourcePath = splitStudio.sourceFiles[0]?.path || '';
    splitStudio.sourceName = splitStudio.sourceFiles.length === 1
      ? (splitStudio.sourceFiles[0]?.name || '')
      : splitStudio.sourceFiles.length
        ? `${splitStudio.sourceFiles[0].name} 等 ${splitStudio.sourceFiles.length} 个部分`
        : '';
  }

  function removeSplitFile(index) {
    if (splitStudio.splitting) return;
    splitStudio.sourceFiles.splice(index, 1);
    syncSourcePath();
    splitStudio.duration = splitStudio.sourceFiles.reduce((sum, file) => sum + (Number(file.duration) || 0), 0);
    splitStudio.segments = [];
    splitStudio.naturalAdjustments = 0;
  }

  function clearSplitFiles() {
    if (splitStudio.splitting) return;
    splitStudio.sourceFiles = [];
    splitStudio.sourcePath = '';
    splitStudio.sourceName = '';
    splitStudio.duration = 0;
    splitStudio.segments = [];
    splitStudio.naturalAdjustments = 0;
  }

  function moveSplitFile(index, delta) {
    if (splitStudio.splitting) return;
    const target = index + delta;
    if (index < 0 || target < 0 || target >= splitStudio.sourceFiles.length) return;
    const [file] = splitStudio.sourceFiles.splice(index, 1);
    splitStudio.sourceFiles.splice(target, 0, file);
    syncSourcePath();
    splitStudio.segments = [];
  }

  async function chooseSplitOutput() {
    if (splitStudio.splitting) return;
    const chooser = globals.window?.desktopPetHost?.chooseVideoOutputDirectory
      || globals.window?.desktopPetHost?.chooseDirectory;
    if (!chooser) return message.error('当前环境不支持选择输出文件夹');
    try {
      const result = await chooser(splitStudio.outputDirectory || undefined);
      if (result?.canceled || !result?.path) return;
      splitStudio.outputDirectory = result.path;
      saveSettings(storage, splitStudio);
    } catch (error) {
      message.error(`选择输出文件夹失败：${error.message}`);
    }
  }

  function addSplitRule() {
    if (splitStudio.splitting) return;
    const openRuleIndex = splitStudio.rules.findIndex((rule) => !Number(rule.endEpisode));
    if (openRuleIndex >= 0) {
      const openRule = splitStudio.rules[openRuleIndex];
      const startEpisode = Math.max(1, Number(openRule.startEpisode) || 1);
      const endEpisode = startEpisode + 9;
      const nextRule = makeRule(endEpisode + 1, 0, openRule.duration, openRule.unit);
      openRule.startEpisode = nextRule.startEpisode;
      splitStudio.rules.splice(openRuleIndex, 0, makeRule(startEpisode, endEpisode, openRule.duration, openRule.unit));
      return;
    }
    const lastEnd = splitStudio.rules.reduce((max, rule) => Math.max(max, Number(rule.endEpisode) || Number(rule.startEpisode) || 0), 0);
    const startEpisode = Math.max(1, lastEnd + 1);
    splitStudio.rules.push(makeRule(startEpisode, 0, 40, 'second'));
  }

  function normalizeSplitRules() {
    if (splitStudio.splitting) return;
    splitStudio.rules.sort((a, b) => Number(a.startEpisode) - Number(b.startEpisode));
    for (let index = 1; index < splitStudio.rules.length; index += 1) {
      const previous = splitStudio.rules[index - 1];
      const current = splitStudio.rules[index];
      if (!Number(previous.endEpisode)) continue;
      if (Number(current.startEpisode) <= Number(previous.endEpisode)) {
        current.startEpisode = Number(previous.endEpisode) + 1;
      }
    }
  }

  function removeSplitRule(index) {
    if (splitStudio.splitting || splitStudio.rules.length <= 1) return;
    splitStudio.rules.splice(index, 1);
  }

  function saveSplitSettings() {
    saveSettings(storage, splitStudio);
  }

  async function startVideoSplit() {
    if (splitStudio.splitting) return;
    if (!splitStudio.sourceFiles.length) return message.warning('请先选择视频');
    if (!splitStudio.outputDirectory) return message.warning('请选择输出文件夹');
    if (!splitStudio.rules.length) return message.warning('请至少保留一条切割规则');
    normalizeSplitRules();
    splitStudio.splitting = true;
    splitStudio.segments = [];
    saveSettings(storage, splitStudio);
    try {
      const result = await api.post('/api/video-split/start', {
        sourcePaths: splitStudio.sourceFiles.map((file) => file.path),
        outputDirectory: splitStudio.outputDirectory,
        prefix: splitStudio.prefix,
        rules: splitStudio.rules.map((rule) => ({
          startEpisode: Number(rule.startEpisode),
          endEpisode: Number(rule.endEpisode),
          duration: Number(rule.duration),
          unit: rule.unit,
        })),
        minimumDuration: Number(splitStudio.minimumSeconds),
        naturalCut: splitStudio.naturalCut !== false,
        naturalWindowSeconds: normalizeNaturalWindow(splitStudio.naturalWindowSeconds),
      }, { timeoutMs: 2 * 60 * 60 * 1000 });
      splitStudio.duration = Number(result.duration) || splitStudio.duration;
      splitStudio.prefix = result.prefix || splitStudio.prefix;
      splitStudio.outputDirectory = result.outputDirectory || splitStudio.outputDirectory;
      splitStudio.segments = Array.isArray(result.segments) ? result.segments : [];
      splitStudio.naturalAdjustments = Number(result.naturalAdjustments) || 0;
      message.success(`切割完成，共 ${splitStudio.segments.length} 集${splitStudio.naturalAdjustments ? `，自然调整 ${splitStudio.naturalAdjustments} 处` : ''}`);
    } catch (error) {
      message.error(`视频切割失败：${error.message}`);
    } finally {
      splitStudio.splitting = false;
    }
  }

  return {
    splitStudio,
    chooseSplitVideo,
    probeSplitVideo,
    chooseSplitOutput,
    removeSplitFile,
    clearSplitFiles,
    moveSplitFile,
    addSplitRule,
    normalizeSplitRules,
    removeSplitRule,
    saveSplitSettings,
    startVideoSplit,
    formatSplitDuration: formatDuration,
    formatSplitTime: formatTime,
  };
}
