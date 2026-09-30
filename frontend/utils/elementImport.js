const elementImportCategoryAliases = {
  character: ['人物', '角色', '人设', '人物描述', '角色描述', 'characters', 'character'],
  group: ['群像', '群体', '群像人物', 'groups', 'group'],
  scene: ['场景', '地点', '环境', '场景描述', 'scenes', 'scene'],
  prop: ['道具', '物品', '资产', '器物', 'props', 'prop'],
  effect: ['特效', '法术', '效果', '异象', 'effects', 'effect'],
  creature: ['妖兽', '怪物', '异兽', '灵兽', '凶兽', '魔兽', '妖怪', '生物', 'creatures', 'creature', 'monster', 'monsters'],
};

export function normalizeImportCategory(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[：:]/g, '');
  if (!raw) return '';
  for (const [key, aliases] of Object.entries(elementImportCategoryAliases)) {
    if (aliases.some((alias) => raw === alias.toLowerCase())) return key;
  }
  return '';
}

export function parseImportHeading(line) {
  const text = String(line || '').trim();
  const match = text.match(/^(?:#{1,4}\s*)?(?:\[|【)?\s*([^【】\[\]：:]+?)\s*(?:\]|】)?\s*[：:]?$/);
  if (!match) return '';
  return normalizeImportCategory(match[1]);
}

export function splitImportItemBlock(block) {
  return String(block || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)、]|[（(]?\d+[）)])\s*/, '').trim())
    .filter(Boolean);
}

export function splitElementNameAndDesc(text, fallbackIndex) {
  const clean = String(text || '').trim();
  const named = clean.match(/^(.{1,36}?)[：:\-—|]\s*(.+)$/);
  if (named) return { name: named[1].trim(), prompt: named[2].trim() };
  const short = clean.replace(/[，,。；;].*$/, '').trim();
  const name = short && short.length <= 16 ? short : `元素${fallbackIndex}`;
  return { name, prompt: clean };
}

export function parseElementImportText(text, defaultCategory = 'character') {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];
  const items = [];
  let currentCategory = defaultCategory;
  let fallbackIndex = 1;
  let currentItem = null;
  const pushItem = () => {
    if (currentItem?.prompt) items.push(currentItem);
    currentItem = null;
  };
  const isNewItemLine = (line) =>
    /^\s*(?:[-*•·]|\d+[.)、]|[（(]?\d+[）)])\s*/.test(line) ||
    /^(.{1,36}?)[：:\-—|]\s*(.+)$/.test(line) ||
    /^(人物|角色|人设|群像|群体|场景|地点|环境|道具|物品|特效|法术|效果)\s*[：:]\s*(.+)$/i.test(line);

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      pushItem();
      continue;
    }
    const heading = parseImportHeading(line);
    if (heading) {
      pushItem();
      currentCategory = heading;
      continue;
    }
    const cleaned = splitImportItemBlock(line)[0] || line;
    const inlineMatch = cleaned.match(/^(人物|角色|人设|群像|群体|场景|地点|环境|道具|物品|特效|法术|效果)\s*[：:]\s*(.+)$/i);
    const itemCategory = inlineMatch ? normalizeImportCategory(inlineMatch[1]) || currentCategory : currentCategory;
    const itemText = inlineMatch ? inlineMatch[2].trim() : cleaned;
    if (!currentItem || isNewItemLine(line)) {
      pushItem();
      const parsed = splitElementNameAndDesc(itemText, fallbackIndex++);
      if (!parsed.prompt) continue;
      currentItem = { category: itemCategory, name: parsed.name, prompt: parsed.prompt };
    } else {
      currentItem.prompt = `${currentItem.prompt}\n${line}`;
    }
  }
  pushItem();
  return items.filter((item) => ['character', 'group', 'scene', 'prop', 'effect', 'creature'].includes(item.category));
}

const elementImageExtRe = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function isElementImageFile(file) {
  const name = String(file?.name || '');
  if (!name) return false;
  if (elementImageExtRe.test(name)) return true;
  return file?.type?.startsWith('image/') && !/svg/i.test(file.type);
}

export function importCategoryFromPathSegment(segment) {
  const clean = String(segment || '')
    .replace(/\.[^.]+$/, '')
    .trim();
  const normalized = normalizeImportCategory(clean);
  if (normalized) return normalized;
  const compact = clean.toLowerCase().replace(/[\s_-]+/g, '');
  if (['人物', '角色', '人设', 'character', 'characters'].includes(compact)) return 'character';
  if (['群像', '群体', 'group', 'groups'].includes(compact)) return 'group';
  if (['场景', '地点', '环境', 'scene', 'scenes'].includes(compact)) return 'scene';
  if (['道具', '物品', '器物', 'prop', 'props'].includes(compact)) return 'prop';
  if (['特效', '效果', '法术', 'effect', 'effects'].includes(compact)) return 'effect';
  if (['妖兽', '怪物', '异兽', '灵兽', '凶兽', '魔兽', '妖怪', 'creature', 'creatures', 'monster', 'monsters'].includes(compact)) return 'creature';
  return '';
}

export function elementImageCategoryFromFile(file) {
  const relPath = String(file?.webkitRelativePath || file?.name || '');
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < Math.max(0, parts.length - 1); i++) {
    const category = importCategoryFromPathSegment(parts[i]);
    if (category) return category;
  }
  return '';
}

export function elementNameFromImageFile(file) {
  return String(file?.name || '')
    .replace(/\.[^.]+$/, '')
    .trim()
    .slice(0, 80);
}

export function mergeImageImportSummary(target, result = {}) {
  target.added += Number(result.added) || 0;
  target.updated += Number(result.updated) || 0;
  target.imported += Number(result.imported) || 0;
  target.skipped += Number(result.skipped) || 0;
}

export function createElementImportContext(handlers = {}) {
  return {
    ...handlers.message,
    isImporting: () => handlers.importingRef.value,
    project: handlers.project,
    text: () => handlers.textRef.value,
    category: () => handlers.categoryRef.value,
    rememberExtractCounts: handlers.rememberExtractCounts,
    setImporting: (value) => { handlers.importingRef.value = value; },
    setProgress: (message) => { handlers.progressRef.value = message; },
    nextTick: handlers.nextTick,
    importElements: (payload) => handlers.api.post('/api/project/elements/import', payload),
    clearText: () => { handlers.textRef.value = ''; },
    refreshProject: (projectId) => refreshElementImportProject(projectId, handlers),
    focusFirstFilledCategory: handlers.focusFirstFilledCategory,
  };
}

export function createElementImageImportContext(handlers = {}) {
  return {
    ...handlers.message,
    isBusy: () => handlers.imageImportingRef.value || handlers.importingRef.value,
    hasProject: () => !!handlers.project(),
    defaultCategory: () => handlers.category(),
    rememberExtractCounts: handlers.rememberExtractCounts,
    setImporting: (value) => { handlers.imageImportingRef.value = value; },
    setProgress: (message) => { handlers.progressRef.value = message; },
    nextTick: handlers.nextTick,
    readImageAsPngB64: handlers.readImageAsPngB64,
    uploadBatch: (items) => handlers.api.post('/api/project/elements/image-import', {
      projectId: handlers.project().id,
      items,
    }),
    refreshProject: () => refreshElementImportProject(handlers.project().id, handlers),
    focusFirstFilledCategory: handlers.focusFirstFilledCategory,
  };
}

export function createElementImportBaseRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    api,
    message,
    project: () => refs.project.value,
    category: () => refs.category?.value || 'character',
    setProject: (nextProject) => { refs.project.value = nextProject; },
    hydrateImageState: helpers.hydrateImageState,
    syncCharacterImageMode: helpers.syncCharacterImageMode,
    rememberExtractCounts: helpers.rememberExtractCounts,
    focusFirstFilledCategory: helpers.focusFirstFilledCategory,
    nextTick: helpers.nextTick,
  };
}

export function createImportElementsFromTextRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return () => importElementsFromTextFlow(createElementImportContext({
    ...createElementImportBaseRuntimeContext({ api, message, refs, helpers }),
    importingRef: refs.importing,
    progressRef: refs.progress,
    textRef: refs.text,
    categoryRef: refs.category,
  }));
}

export function createImportElementImagesFromFolderRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  return (event) => importElementImagesFromFolderFlow(event, createElementImageImportContext({
    ...createElementImportBaseRuntimeContext({ api, message, refs, helpers }),
    importingRef: refs.importing,
    imageImportingRef: refs.imageImporting,
    progressRef: refs.progress,
    readImageAsPngB64: helpers.readImageAsPngB64,
  }));
}

async function refreshElementImportProject(projectId, handlers = {}) {
  const fresh = await handlers.api.get(`/api/project?id=${encodeURIComponent(projectId)}`);
  if (fresh.project) {
    handlers.setProject(handlers.hydrateImageState(fresh.project));
    handlers.syncCharacterImageMode();
  }
}

export async function importElementsFromTextFlow(handlers = {}) {
  if (handlers.isImporting()) return;
  const project = handlers.project();
  if (!project) return handlers.warning('请先选择项目');
  const text = handlers.text().trim();
  if (!text) return handlers.warning('请先导入 TXT 或粘贴元素描述');
  const items = parseElementImportText(text, handlers.category());
  if (!items.length) return handlers.warning('没有识别到可导入的元素描述');
  handlers.rememberExtractCounts();
  handlers.setImporting(true);
  handlers.setProgress('正在创建元素…');
  await handlers.nextTick();
  try {
    const result = await handlers.importElements({ projectId: project.id, items });
    if (!result.ok) return handlers.error(result.error || '导入失败');
    handlers.clearText();
    await handlers.refreshProject(project.id);
    handlers.focusFirstFilledCategory();
    const skipped = result.skipped ? `，跳过 ${result.skipped} 个重名` : '';
    handlers.success(`已导入 ${result.added || 0} 个元素${skipped}`);
  } catch (error) {
    handlers.error(error.message || '导入失败');
  } finally {
    handlers.setImporting(false);
    handlers.setProgress('');
  }
}

export async function readElementTxtFilesFlow(fileList, handlers = {}) {
  if (handlers.isImporting()) return handlers.warning('正在导入中，完成后再导入新的描述 TXT');
  try {
    const result = await handlers.readPlainTxtFiles(fileList);
    if (!result) return handlers.warning('请拖入 .txt 文本文件');
    const current = String(handlers.text() || '');
    const nextText = current ? `${current.trimEnd()}\n\n${result.text}` : result.text;
    handlers.setText(nextText);
    if (result.failed) handlers.warning(`已导入 ${result.okCount} 个描述文件，${result.failed} 个读取失败`);
    else handlers.success(`已导入 ${result.okCount} 个描述文件，开始创建元素`);
    await handlers.nextTick();
    handlers.importElements();
  } catch (error) {
    handlers.error(error.message || '读取 TXT 失败');
  }
}

export function createReadElementTxtFilesRuntime({ message, refs = {}, readers = {}, helpers = {} } = {}) {
  return (fileList) => readElementTxtFilesFlow(fileList, {
    ...message,
    isImporting: () => refs.importing.value,
    readPlainTxtFiles: readers.readPlainTxtFiles,
    text: () => refs.text.value,
    setText: (text) => { refs.text.value = text; },
    nextTick: helpers.nextTick,
    importElements: helpers.importElements,
  });
}

export function createElementTextFileHandlersRuntime({ refs = {}, readers = {} } = {}) {
  const onSourceExtractDrop = (event) => {
    event.preventDefault();
    refs.sourceExtractDragOver.value = false;
    if (event.dataTransfer?.files?.length) readers.readSourceTxtFiles(event.dataTransfer.files);
  };

  const onPickSourceExtractFile = (event) => {
    if (event.target.files?.length) readers.readSourceTxtFiles(event.target.files);
    event.target.value = '';
  };

  const onDrop = (event) => {
    event.preventDefault();
    refs.dragOver.value = false;
    if (event.dataTransfer?.files?.length) readers.readElementTxtFiles(event.dataTransfer.files);
  };

  const onPickFile = (event) => {
    if (event.target.files?.length) readers.readElementTxtFiles(event.target.files);
    event.target.value = '';
  };

  return {
    onSourceExtractDrop,
    onPickSourceExtractFile,
    onDrop,
    onPickFile,
  };
}

export async function importElementImagesFromFolderFlow(event, handlers = {}) {
  if (handlers.isBusy()) return handlers.warning('正在导入中，完成后再导入');
  if (!handlers.hasProject()) return handlers.warning('请先选择项目');
  const files = [...(event?.target?.files || [])];
  if (event?.target) event.target.value = '';
  const imageFiles = files.filter(isElementImageFile);
  if (!imageFiles.length) return handlers.warning('没有识别到可导入的图片文件');

  handlers.rememberExtractCounts();
  handlers.setImporting(true);
  handlers.setProgress('正在读取图片...');
  await handlers.nextTick();

  const summary = {
    added: 0,
    updated: 0,
    imported: 0,
    skipped: files.length - imageFiles.length,
    skippedByReason: { unsupported: files.length - imageFiles.length, missingCategory: 0, readFailed: 0, tooLarge: 0, backendRejected: 0 },
    failureSamples: [],
  };
  let batch = [];
  let batchBytes = 0;
  const maxBatchBytes = 24 * 1024 * 1024;
  const maxSingleBytes = 50 * 1024 * 1024;
  const maxBatchItems = 6;

  const submitBatch = async () => {
    if (!batch.length) return;
    handlers.setProgress(`正在上传 ${summary.imported + 1} - ${summary.imported + batch.length}`);
    const result = await handlers.uploadBatch(batch);
    if (!result.ok) throw new Error(result.error || '导入图片失败');
    mergeImageImportSummary(summary, result);
    summary.skippedByReason.backendRejected += Number(result.skipped) || 0;
    batch = [];
    batchBytes = 0;
  };

  try {
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const category = elementImageCategoryFromFile(file) || normalizeImportCategory(handlers.defaultCategory?.());
      const name = elementNameFromImageFile(file);
      if (!category || !name) {
        summary.skipped++;
        summary.skippedByReason.missingCategory++;
        if (summary.failureSamples.length < 3) summary.failureSamples.push(`${file.name}：无法确定分类`);
        continue;
      }
      handlers.setProgress(`正在读取 ${i + 1} / ${imageFiles.length}`);
      let imageB64 = '';
      try {
        imageB64 = await handlers.readImageAsPngB64(file);
      } catch (error) {
        summary.skipped++;
        summary.skippedByReason.readFailed++;
        if (summary.failureSamples.length < 3) summary.failureSamples.push(`${file.name}：${error?.message || '读取失败'}`);
        continue;
      }
      const itemBytes = imageB64.length + name.length + 256;
      if (itemBytes > maxSingleBytes) {
        summary.skipped++;
        summary.skippedByReason.tooLarge++;
        if (summary.failureSamples.length < 3) summary.failureSamples.push(`${file.name}：转换后超过 50 MB`);
        continue;
      }
      if (batch.length && (batch.length >= maxBatchItems || batchBytes + itemBytes > maxBatchBytes)) {
        await submitBatch();
      }
      batch.push({ category, name, imageB64 });
      batchBytes += itemBytes;
    }
    await submitBatch();

    await handlers.refreshProject();
    handlers.focusFirstFilledCategory();
    const skippedText = summary.skipped ? `，跳过 ${summary.skipped} 个文件` : '';
    const reasonText = summary.failureSamples.length ? `（${summary.failureSamples.join('；')}）` : '';
    const message = `已导入 ${summary.imported} 张图片，新建 ${summary.added} 个元素，更新 ${summary.updated} 个元素${skippedText}${reasonText}`;
    if (!summary.imported && summary.skipped) handlers.warning(message);
    else handlers.success(message);
  } catch (err) {
    handlers.error(err.message || '导入图片失败');
  } finally {
    handlers.setImporting(false);
    handlers.setProgress('');
  }
}
