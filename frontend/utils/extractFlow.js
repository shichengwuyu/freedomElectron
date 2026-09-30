import {
  createElementTextFileHandlersRuntime,
  createImportElementImagesFromFolderRuntime,
  createImportElementsFromTextRuntime,
  createReadElementTxtFilesRuntime,
} from './elementImport.js';
import { pollJobUntilDone } from './pollJob.js';

export function createExtractImportStateRuntime({ reactive, ref } = {}) {
  return {
    sourceExtractText: ref(''),
    novelText: ref(''),
    extracting: ref(false),
    extractProgress: ref(''),
    extractProgressState: reactive({
      active: false,
      percentage: 0,
      current: 0,
      total: 0,
      label: '元素提取',
      detail: '',
      status: '',
      indeterminate: false,
    }),
    extractErrors: ref([]),
    elementImporting: ref(false),
    elementImportProgress: ref(''),
    elementImageImporting: ref(false),
    elementImageImportProgress: ref(''),
    sourceExtractDragOver: ref(false),
    dragOver: ref(false),
  };
}

function extractionCategories(value) {
  // 接受数组（多选）或旧版的单值字符串（向后兼容）；空数组 / undefined / 'all' 视为全选。
  if (Array.isArray(value)) {
    const cleaned = value.filter((item) => item && item !== 'all');
    return cleaned.length ? cleaned : undefined;
  }
  const category = String(value || '').trim();
  return category && category !== 'all' ? [category] : undefined;
}

function selectedExtractionCategory(handlers) {
  if (typeof handlers.extractCategory !== 'function') return [];
  return handlers.extractCategory();
}

export function createExtractImportActionsRuntime({ api, message, refs = {}, readers = {}, helpers = {} } = {}) {
  const {
    startProgress: startExtractProgress,
    updateProgress: updateExtractProgress,
    finishProgress: finishExtractProgress,
    failProgress: failExtractProgress,
  } = createExtractProgressRuntimeContext({
    refs: { progressState: refs.extractProgressState, progressText: refs.extractProgress },
    helpers: {
      stopProgressPulse: helpers.stopProgressPulse,
      setProgressState: helpers.setProgressState,
      startProgressPulse: helpers.startProgressPulse,
      progressByRatio: helpers.progressByRatio,
      hideProgressAfter: helpers.hideProgressAfter,
    },
  });
  const {
    readSourceTxtFiles,
    startExtract,
    pollExtract,
  } = createExtractRuntime({
    api,
    message,
    refs: {
      extracting: refs.extracting,
      project: refs.project,
      sourceText: refs.sourceExtractText,
      extractCategory: refs.extractCategory,
      extractErrors: refs.extractErrors,
      extractProgress: refs.extractProgress,
    },
    helpers: {
      readPlainTxtFiles: readers.readPlainTxtFiles,
      rememberExtractCounts: helpers.rememberExtractCounts,
      startProgress: startExtractProgress,
      updateProgress: updateExtractProgress,
      nextTick: helpers.nextTick,
      failProgress: failExtractProgress,
      loadProjects: helpers.loadProjects,
      refreshElements: helpers.refreshElements,
      focusFirstFilledCategory: helpers.focusFirstFilledCategory,
      extractedCountsSummary: helpers.extractedCountsSummary,
      finishProgress: finishExtractProgress,
    },
  });
  let importElementsFromText = null;
  const readElementTxtFiles = createReadElementTxtFilesRuntime({
    message,
    refs: { importing: refs.elementImporting, text: refs.novelText },
    readers: { readPlainTxtFiles: readers.readPlainTxtFiles },
    helpers: { nextTick: helpers.nextTick, importElements: () => importElementsFromText() },
  });
  const fileHandlers = createElementTextFileHandlersRuntime({
    refs: { sourceExtractDragOver: refs.sourceExtractDragOver, dragOver: refs.dragOver },
    readers: { readSourceTxtFiles, readElementTxtFiles },
  });
  importElementsFromText = createImportElementsFromTextRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      importing: refs.elementImporting,
      progress: refs.elementImportProgress,
      text: refs.novelText,
      category: refs.category,
    },
    helpers: {
      hydrateImageState: helpers.hydrateImageState,
      syncCharacterImageMode: helpers.syncCharacterImageMode,
      rememberExtractCounts: helpers.rememberExtractCounts,
      focusFirstFilledCategory: helpers.focusFirstFilledCategory,
      nextTick: helpers.nextTick,
    },
  });
  const importElementImagesFromFolder = createImportElementImagesFromFolderRuntime({
    api,
    message,
    refs: {
      project: refs.project,
      importing: refs.elementImporting,
      imageImporting: refs.elementImageImporting,
      progress: refs.elementImageImportProgress,
    },
    helpers: {
      hydrateImageState: helpers.hydrateImageState,
      syncCharacterImageMode: helpers.syncCharacterImageMode,
      rememberExtractCounts: helpers.rememberExtractCounts,
      focusFirstFilledCategory: helpers.focusFirstFilledCategory,
      nextTick: helpers.nextTick,
      readImageAsPngB64: readers.readImageAsPngB64,
    },
  });
  return {
    startExtractProgress,
    updateExtractProgress,
    finishExtractProgress,
    failExtractProgress,
    readSourceTxtFiles,
    startExtract,
    pollExtract,
    readElementTxtFiles,
    ...fileHandlers,
    importElementsFromText,
    importElementImagesFromFolder,
  };
}

export function createAppExtractImportRuntime({
  api,
  message,
  refs = {},
  readers = {},
  helpers = {},
  reactive,
  ref,
} = {}) {
  const state = createExtractImportStateRuntime({ reactive, ref });
  const actions = createExtractImportActionsRuntime({
    api,
    message,
    refs: {
      extracting: state.extracting,
      project: refs.project,
      sourceExtractText: state.sourceExtractText,
      extractProgress: state.extractProgress,
      extractProgressState: state.extractProgressState,
      extractErrors: state.extractErrors,
      elementImporting: state.elementImporting,
      elementImportProgress: state.elementImportProgress,
      elementImageImporting: state.elementImageImporting,
      elementImageImportProgress: state.elementImageImportProgress,
      sourceExtractDragOver: state.sourceExtractDragOver,
      dragOver: state.dragOver,
      novelText: state.novelText,
      category: refs.category,
      extractCategory: refs.extractCategory,
    },
    readers,
    helpers,
  });
  return {
    ...state,
    ...actions,
  };
}

export function updateExtractProgressFlow(st = {}, handlers = {}) {
  const total = Math.max(0, Number(st.chunkTotal) || 0);
  const rawIndex = Math.max(0, Number(st.chunkIndex) || 0);
  const isComposing = st.phase === 'compose';
  const hasCompleted = st.completed !== undefined && Number.isFinite(Number(st.completed));
  const completedForRatio = total
    ? Math.min(total, isComposing ? total : (hasCompleted ? Number(st.completed) : rawIndex))
    : 0;
  const active = Math.max(0, Number(st.active) || 0);
  const batchStart = Math.max(0, Number(st.batchStart) || rawIndex);
  const batchSize = Math.max(0, Number(st.batchSize) || 0);
  const elapsedMs = Math.max(0, Number(st.elapsedMs) || 0);
  const progressStatus = String(st.progressStatus || '');
  const elapsedLabel = elapsedMs >= 60 * 1000
    ? `${Math.floor(elapsedMs / 60000)} 分钟`
    : `${Math.max(1, Math.floor(elapsedMs / 1000))} 秒`;
  const waiting = !isComposing && total > 0 && active > 0;
  const batchEnd = Math.min(total, batchStart + Math.max(1, batchSize));
  const message = isComposing
    ? '正在生成出图提示词…'
    : waiting
      ? `正在并行分析第 ${batchStart + 1}-${batchEnd} 段，已完成 ${completedForRatio} / ${total} 段（等待模型返回 ${elapsedLabel}）`
      : progressStatus === 'chunk_done'
        ? `已完成分析 ${completedForRatio} / ${total} 段，正在整理结果…`
        : progressStatus === 'batch_done'
          ? `已完成分析 ${completedForRatio} / ${total} 段，准备继续…`
        : `正在分析第 ${rawIndex + 1} / ${total || '?'} 段…`;
  handlers.setExtractProgress(message);
  handlers.stopProgressPulse?.('extract');
  const percentage = isComposing
    ? Math.max(handlers.progressState.percentage, 90)
    : handlers.progressByRatio(completedForRatio, total, { floor: 6, ceiling: 88 });
  handlers.setProgressState(handlers.progressState, {
    active: true,
    percentage,
    current: completedForRatio,
    total,
    detail: message,
    status: '',
    indeterminate: !total || waiting,
  });
}

export function createExtractProgressRuntimeContext({ refs = {}, helpers = {} } = {}) {
  const pulseKey = 'extract';
  const progressState = refs.progressState;
  return {
    startProgress(message = '正在提交…') {
      helpers.stopProgressPulse(pulseKey);
      helpers.setProgressState(progressState, {
        active: true,
        percentage: 3,
        current: 0,
        total: 0,
        label: '元素提取',
        detail: message,
        status: '',
        indeterminate: true,
      });
      helpers.startProgressPulse(pulseKey, progressState, { ceiling: 88 });
    },
    updateProgress(st = {}) {
      updateExtractProgressFlow(st, {
        progressState,
        progressByRatio: helpers.progressByRatio,
        stopProgressPulse: helpers.stopProgressPulse,
        setProgressState: helpers.setProgressState,
        setExtractProgress: (message) => { refs.progressText.value = message; },
      });
    },
    finishProgress(message = '分析完成') {
      helpers.stopProgressPulse(pulseKey);
      helpers.setProgressState(progressState, {
        active: true,
        percentage: 100,
        current: progressState.total || progressState.current,
        total: progressState.total,
        detail: message,
        status: 'success',
        indeterminate: false,
      });
      helpers.hideProgressAfter(progressState, 'success');
    },
    failProgress(message = '提取失败') {
      helpers.stopProgressPulse(pulseKey);
      helpers.setProgressState(progressState, {
        active: true,
        detail: message,
        status: 'exception',
        indeterminate: false,
      });
      helpers.hideProgressAfter(progressState, 'exception', 2200);
    },
  };
}

function createBaseExtractContext(handlers = {}) {
  return {
    ...handlers.message,
    isExtracting: () => handlers.extractingRef.value,
    project: () => handlers.projectRef.value,
    rememberExtractCounts: handlers.rememberExtractCounts,
    setExtracting: (value) => { handlers.extractingRef.value = value; },
    setErrors: (errors) => { handlers.extractErrorsRef.value = errors; },
    setProgress: (message) => { handlers.extractProgressRef.value = message; },
    startProgress: handlers.startProgress,
    nextTick: handlers.nextTick,
    submitExtract: (payload) => handlers.api.post('/api/extract', payload),
    pollExtract: handlers.pollExtract,
    failProgress: handlers.failProgress,
  };
}

export function createStartExtractContext(handlers = {}) {
  return {
    ...createBaseExtractContext(handlers),
    sourceText: () => handlers.sourceTextRef.value,
    extractCategory: () => handlers.extractCategoryRef?.value || 'all',
  };
}

export function createStartExtractFromSourceContext(handlers = {}) {
  return {
    ...createBaseExtractContext(handlers),
    chaptersSorted: handlers.chaptersSorted,
    pendingChapters: () => handlers.pendingChaptersRef.value,
    chapterSig: handlers.chapterSig,
    assignExtractedSigs: (chapterSigs) => Object.assign(handlers.scriptState.extractedSigs, chapterSigs),
    extractCategory: () => handlers.extractCategoryRef?.value || 'all',
  };
}

function createBaseExtractRuntimeHandlers({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    api,
    message,
    extractingRef: refs.extracting,
    projectRef: refs.project,
    extractCategoryRef: refs.extractCategory,
    rememberExtractCounts: helpers.rememberExtractCounts,
    extractErrorsRef: refs.extractErrors,
    extractProgressRef: refs.extractProgress,
    startProgress: helpers.startProgress,
    nextTick: helpers.nextTick,
    pollExtract: helpers.pollExtract,
    failProgress: helpers.failProgress,
  };
}

export function createReadSourceTxtFilesContext({ message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    isExtracting: () => refs.extracting.value,
    readPlainTxtFiles: helpers.readPlainTxtFiles,
    sourceText: () => refs.sourceText.value,
    setSourceText: (text) => { refs.sourceText.value = text; },
    nextTick: helpers.nextTick,
    startExtract: helpers.startExtract,
  };
}

export function createStartExtractRuntimeContext(runtime = {}) {
  return createStartExtractContext({
    ...createBaseExtractRuntimeHandlers(runtime),
    sourceTextRef: runtime.refs?.sourceText,
    extractCategoryRef: runtime.refs?.extractCategory,
  });
}

export function createStartExtractFromSourceRuntimeContext(runtime = {}) {
  const { refs = {}, helpers = {} } = runtime;
  return createStartExtractFromSourceContext({
    ...createBaseExtractRuntimeHandlers(runtime),
    chaptersSorted: helpers.chaptersSorted,
    pendingChaptersRef: refs.pendingChapters,
    chapterSig: helpers.chapterSig,
    scriptState: refs.scriptState,
    extractCategoryRef: refs.extractCategory,
  });
}

export function createStartExtractFromSourceRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return (force = false) => startExtractFromSourceFlow(force, createStartExtractFromSourceRuntimeContext({
    api,
    message,
    refs,
    helpers,
  }));
}

export function createPollExtractContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    getStatus: (id) => api.get(`/api/extract/status?jobId=${id}`),
    setExtracting: (value) => { refs.extracting.value = value; },
    failProgress: helpers.failProgress,
    updateProgress: helpers.updateProgress,
    clearSourceText: () => { refs.sourceText.value = ''; },
    setErrors: (errors) => { refs.extractErrors.value = errors; },
    loadProjects: helpers.loadProjects,
    refreshElements: helpers.refreshElements,
    focusFirstFilledCategory: helpers.focusFirstFilledCategory,
    extractedCountsSummary: helpers.extractedCountsSummary,
    finishProgress: helpers.finishProgress,
  };
}

export function createExtractRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const pollExtract = (jobId) => pollExtractFlow(jobId, createPollExtractContext({
    api,
    message,
    refs,
    helpers,
  }));
  const startExtract = (options = {}) => startExtractFlow(options, createStartExtractRuntimeContext({
    api,
    message,
    refs,
    helpers: { ...helpers, pollExtract },
  }));
  const readSourceTxtFiles = (fileList) => readSourceTxtFilesFlow(fileList, createReadSourceTxtFilesContext({
    message,
    refs,
    helpers: { ...helpers, startExtract },
  }));
  return { readSourceTxtFiles, startExtract, pollExtract };
}

export async function readSourceTxtFilesFlow(fileList, handlers = {}) {
  if (handlers.isExtracting()) return handlers.warning('正在提取中，完成后再导入新的原文 TXT');
  try {
    const result = await handlers.readPlainTxtFiles(fileList);
    if (!result) return handlers.warning('请拖入 .txt 文本文件');
    const current = String(handlers.sourceText() || '');
    const nextText = current ? `${current.trimEnd()}\n\n${result.text}` : result.text;
    handlers.setSourceText(nextText);
    if (result.failed) handlers.warning(`已导入 ${result.okCount} 个原文文件，${result.failed} 个读取失败`);
    else handlers.success(`已导入 ${result.okCount} 个原文文件，开始提取元素`);
    await handlers.nextTick();
    handlers.startExtract({ fromImport: true, text: nextText });
  } catch (error) {
    handlers.error(error.message || '读取 TXT 失败');
  }
}

export async function pollExtractFlow(jobId, handlers = {}, options = {}) {
  const intervalMs = Number(options.intervalMs) || 1200;
  let status;
  try {
    status = await pollJobUntilDone({
      fetchStatus: () => handlers.getStatus(jobId),
      isDone: (s) => s.status === 'done',
      isError: (s) => ['error', 'failed', 'cancelled', 'paused'].includes(s.status),
      getProgress: (s) => `${s.chunkIndex || 0}/${s.chunkTotal || 0}`,
      onStatus: (s) => handlers.updateProgress(s),
      intervalMs,
      stallMs: 0,
    });
  } catch (error) {
    handlers.setExtracting(false);
    const message = error.message || '提取状态获取失败';
    handlers.failProgress(message);
    handlers.error(message);
    return { status: 'error', error: message };
  }

  if (status.status === 'done') {
    handlers.setExtracting(false);
    handlers.clearSourceText();
    if (status.errors && status.errors.length) handlers.setErrors(status.errors);
    await handlers.loadProjects();
    await handlers.refreshElements(status.projectId);
    handlers.focusFirstFilledCategory();
    const summary = handlers.extractedCountsSummary();
    const message = summary ? `分析完成：${summary}` : '分析完成';
    handlers.success(message);
    handlers.finishProgress(message);
  } else if (status.status === 'error' || status.status === 'failed') {
    handlers.setExtracting(false);
    handlers.error(`提取失败：${status.error}`);
    handlers.failProgress(status.error || '提取失败');
  } else if (status.status === 'cancelled' || status.status === 'paused') {
    handlers.setExtracting(false);
    const message = status.message || (status.status === 'cancelled' ? '元素提取已取消' : '元素提取已暂停');
    handlers.warning?.(message);
    handlers.failProgress(message);
  }
  return status;
}

export async function startExtractFlow(options = {}, handlers = {}) {
  const fromImport = options?.fromImport === true;
  if (handlers.isExtracting()) return;
  if (!handlers.project()) return handlers.warning('请先选择项目');
  const text = String(options?.text || handlers.sourceText() || '').trim();
  if (!text) return handlers.warning('请先导入原文 TXT 或粘贴小说文本');
  handlers.rememberExtractCounts();
  handlers.setExtracting(true);
  handlers.setErrors([]);
  const progressMessage = fromImport ? '正在分析 TXT…' : '正在提交…';
  handlers.setProgress(progressMessage);
  handlers.startProgress(progressMessage);
  await handlers.nextTick();
  try {
    const categories = extractionCategories(selectedExtractionCategory(handlers));
    const response = await handlers.submitExtract({
      text,
      projectId: handlers.project().id,
      ...(categories ? { categories } : {}),
    });
    if (response.error) {
      handlers.error(response.error);
      handlers.setExtracting(false);
      handlers.failProgress(response.error);
      return;
    }
    await handlers.pollExtract(response.jobId);
  } catch (error) {
    const message = error.message;
    handlers.error(message);
    handlers.setExtracting(false);
    handlers.failProgress(message);
  }
}

export async function startExtractFromSourceFlow(force = false, handlers = {}) {
  if (handlers.isExtracting()) return;
  const project = handlers.project();
  if (!project) return handlers.warning('请先选择项目');
  const all = handlers.chaptersSorted().filter((chapter) => (chapter.sourceText || '').trim());
  if (!all.length) return handlers.warning('请先在剧本步骤追加章节并导入原文');
  const categories = extractionCategories(selectedExtractionCategory(handlers));
  const categoryOnly = categories?.length > 0;
  const targets = force === true || categoryOnly ? all : handlers.pendingChapters();
  if (!targets.length) return handlers.info('没有新增或改动的章节，元素已是最新');
  const fullText = targets.map((chapter) => chapter.sourceText || '').join('\n\n').trim();
  const chapterSigs = {};
  for (const chapter of targets) chapterSigs[chapter.id] = handlers.chapterSig(chapter.sourceText);
  handlers.rememberExtractCounts();
  handlers.setExtracting(true);
  handlers.setErrors([]);
  handlers.setProgress('正在提交…');
  handlers.startProgress('正在提交…');
  await handlers.nextTick();
  try {
    const response = await handlers.submitExtract({
      text: fullText,
      projectId: project.id,
      chapterSigs,
      ...(categories ? { categories } : {}),
    });
    if (response.error) {
      handlers.error(response.error);
      handlers.setExtracting(false);
      handlers.failProgress(response.error);
      return;
    }
    const status = await handlers.pollExtract(response.jobId);
    if (!categories && status?.status === 'done') handlers.assignExtractedSigs(chapterSigs);
  } catch (error) {
    const message = error.message || error;
    handlers.error(message);
    handlers.setExtracting(false);
    handlers.failProgress(message);
  }
}
