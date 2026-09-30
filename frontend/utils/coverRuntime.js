import {
  NOVEL_GENRE_PRESETS,
  NOVEL_COVER_LOCAL_REFERENCE_TYPES,
  NOVEL_COVER_RATIO_OPTIONS,
  NOVEL_COVER_REFERENCE_MAX_BYTES,
  NOVEL_COVER_REFERENCE_TOTAL_MAX_BYTES,
} from './novelRuntime.js';

const NOVEL_COVER_GENRE_OPTIONS = [...new Set([
  ...(NOVEL_GENRE_PRESETS.male || []).map((item) => item.name),
  ...(NOVEL_GENRE_PRESETS.female || []).map((item) => item.name),
  '科幻未来',
  '东方幻想',
  '青春校园',
  '末日灾变',
])].map((name) => ({ label: name, value: name }));

function fileKey(file) {
  return [file?.name, file?.size, file?.lastModified].join(':');
}

function imageBytes(image) {
  return Math.floor((String(image?.imageB64 || '').length * 3) / 4);
}

function formatCoverHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function createAppCoverRuntime({ api, message, messageBox, reactive, readers = {}, globals = {} } = {}) {
  const coverStudio = reactive({
    ratio: '3:4',
    title: '',
    genre: '都市逆袭',
    storyIdea: '',
    references: [],
    dragging: false,
    reading: false,
    generating: false,
    generatedDataUrl: '',
    generatedPrompt: '',
    generatedAt: '',
    selectedHistoryId: '',
    history: [],
    historyLoading: false,
    historyActionId: '',
  });

  function resetCoverStudio() {
    coverStudio.ratio = '3:4';
    coverStudio.title = '';
    coverStudio.genre = '都市逆袭';
    coverStudio.storyIdea = '';
    coverStudio.references = [];
    coverStudio.dragging = false;
    coverStudio.reading = false;
    coverStudio.generating = false;
    coverStudio.generatedDataUrl = '';
    coverStudio.generatedPrompt = '';
    coverStudio.generatedAt = '';
    coverStudio.selectedHistoryId = '';
  }

  async function loadCoverHistory() {
    if (coverStudio.historyLoading) return;
    coverStudio.historyLoading = true;
    try {
      const result = await api.get('/api/cover/history');
      coverStudio.history = Array.isArray(result.records) ? result.records : [];
    } catch (error) {
      message.error(`历史封面加载失败：${error.message}`);
    } finally {
      coverStudio.historyLoading = false;
    }
  }

  function localReferenceBytes() {
    return coverStudio.references.reduce((sum, item) => sum + imageBytes(item), 0);
  }

  async function addCoverReferenceFiles(fileList) {
    if (coverStudio.reading || coverStudio.generating) return;
    const files = [...(fileList || [])];
    if (!files.length) return;
    coverStudio.reading = true;
    const existing = new Set(coverStudio.references.map((item) => item.fileKey));
    let totalBytes = localReferenceBytes();
    const skipped = [];
    let added = 0;
    try {
      for (const file of files) {
        if (coverStudio.references.length >= 9) {
          skipped.push('最多添加 9 张参考图');
          break;
        }
        if (!String(file?.type || '').startsWith('image/') && !/\.(?:png|jpe?g|jfif|webp|gif|bmp|avif)$/i.test(String(file?.name || ''))) {
          skipped.push(`${file?.name || '文件'}不是图片`);
          continue;
        }
        if (Number(file?.size) > NOVEL_COVER_REFERENCE_MAX_BYTES) {
          skipped.push(`${file.name}超过 15 MB`);
          continue;
        }
        const key = fileKey(file);
        if (existing.has(key)) continue;
        const imageB64 = await readers.readImageAsPngB64(file);
        const bytes = Math.floor((String(imageB64 || '').length * 3) / 4);
        if (!imageB64 || bytes > NOVEL_COVER_REFERENCE_MAX_BYTES) {
          skipped.push(`${file.name}转换后超过 15 MB`);
          continue;
        }
        if (totalBytes + bytes > NOVEL_COVER_REFERENCE_TOTAL_MAX_BYTES) {
          skipped.push('图片总大小超过 48 MB');
          break;
        }
        coverStudio.references.push({
          id: `cover_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          fileKey: key,
          name: String(file.name || `参考图${coverStudio.references.length + 1}`).slice(0, 80),
          referenceType: 'character',
          imageB64,
          dataUrl: `data:image/png;base64,${imageB64}`,
        });
        existing.add(key);
        totalBytes += bytes;
        added++;
      }
      if (!added && skipped.length) message.warning(skipped[0]);
      else if (skipped.length) message.warning(`已添加 ${added} 张，${skipped[0]}`);
    } catch (error) {
      message.error(`读取参考图失败：${error.message}`);
    } finally {
      coverStudio.reading = false;
      coverStudio.dragging = false;
    }
  }

  async function onPickCoverReferences(event) {
    await addCoverReferenceFiles(event?.target?.files);
    if (event?.target) event.target.value = '';
  }

  function onDropCoverReferences(event) {
    coverStudio.dragging = false;
    return addCoverReferenceFiles(event?.dataTransfer?.files);
  }

  function removeCoverReference(id) {
    if (coverStudio.generating) return;
    coverStudio.references = coverStudio.references.filter((item) => item.id !== id);
  }

  function clearCoverReferences() {
    if (coverStudio.generating) return;
    coverStudio.references = [];
  }

  function clearCoverGenerationForm() {
    if (coverStudio.generating) return;
    coverStudio.title = '';
    coverStudio.genre = '都市逆袭';
    coverStudio.storyIdea = '';
    message.success('生成设置已清空');
  }

  async function generateStandaloneCover() {
    if (coverStudio.generating) return;
    coverStudio.generating = true;
    try {
      const result = await api.post('/api/cover/generate', {
        ratio: coverStudio.ratio,
        title: coverStudio.title,
        genre: coverStudio.genre,
        storyIdea: coverStudio.storyIdea,
        referenceImages: coverStudio.references.map((item) => ({
          name: item.name,
          referenceType: item.referenceType,
          imageB64: item.imageB64,
        })),
      }, { timeoutMs: 6 * 60 * 1000 });
      coverStudio.generatedDataUrl = result.imageDataUrl || '';
      coverStudio.generatedPrompt = result.prompt || '';
      coverStudio.generatedAt = new Date().toISOString();
      coverStudio.selectedHistoryId = result.history?.id || '';
      if (result.history?.id) {
        coverStudio.history = [result.history, ...coverStudio.history.filter((item) => item.id !== result.history.id)];
      }
      if (coverStudio.generatedDataUrl) message.success('封面已生成');
      else message.warning('生成完成，但没有返回图片');
    } catch (error) {
      message.error(`封面生成失败：${error.message}`);
    } finally {
      coverStudio.generating = false;
    }
  }

  function selectCoverHistory(record) {
    if (!record?.imageUrl) return;
    coverStudio.selectedHistoryId = record.id || '';
    coverStudio.generatedDataUrl = record.imageUrl;
    coverStudio.generatedPrompt = record.prompt || '';
    coverStudio.generatedAt = record.createdAt || '';
    coverStudio.title = record.title || '';
    coverStudio.genre = record.genre || '都市逆袭';
    coverStudio.storyIdea = record.storyIdea || '';
    coverStudio.ratio = record.ratio || '3:4';
  }

  async function downloadCoverHistory(record) {
    if (!record?.imageUrl) return;
    const doc = globals.document;
    if (!doc) return message.error('当前环境不支持下载');
    const title = String(record.title || 'AI封面').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    const link = doc.createElement('a');
    link.href = record.imageUrl;
    link.download = `${title}-${String(record.ratio || '3:4').replace(':', 'x')}.png`;
    doc.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function removeCoverHistory(id) {
    if (!id || coverStudio.historyActionId) return;
    coverStudio.historyActionId = id;
    try {
      const result = await api.post('/api/cover/history/delete', { id });
      if (!result.ok) throw new Error(result.error || '删除失败');
      coverStudio.history = coverStudio.history.filter((item) => item.id !== id);
      if (coverStudio.selectedHistoryId === id) {
        coverStudio.selectedHistoryId = '';
        coverStudio.generatedDataUrl = '';
        coverStudio.generatedPrompt = '';
        coverStudio.generatedAt = '';
      }
      message.success('历史封面已删除');
    } catch (error) {
      message.error(`删除历史封面失败：${error.message}`);
    } finally {
      coverStudio.historyActionId = '';
    }
  }

  async function clearCoverHistory() {
    if (!coverStudio.history.length || coverStudio.historyActionId) return;
    try {
      await messageBox?.confirm('确定清空全部历史封面吗？此操作无法撤销。', '清空历史封面', {
        type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消',
      });
    } catch {
      return;
    }
    coverStudio.historyActionId = 'clear';
    try {
      const result = await api.post('/api/cover/history/clear');
      if (!result.ok) throw new Error(result.error || '清空失败');
      coverStudio.history = [];
      coverStudio.selectedHistoryId = '';
      message.success('历史封面已清空');
    } catch (error) {
      message.error(`清空历史封面失败：${error.message}`);
    } finally {
      coverStudio.historyActionId = '';
    }
  }

  function downloadStandaloneCover() {
    if (!coverStudio.generatedDataUrl) return message.warning('请先生成封面');
    const doc = globals.document;
    if (!doc) return message.error('当前环境不支持下载');
    const title = String(coverStudio.title || 'AI封面').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    const link = doc.createElement('a');
    link.href = coverStudio.generatedDataUrl;
    link.download = `${title}-${coverStudio.ratio.replace(':', 'x')}.png`;
    doc.body.appendChild(link);
    link.click();
    link.remove();
    message.success('开始下载封面');
  }

  return {
    coverStudio,
    NOVEL_COVER_GENRE_OPTIONS,
    NOVEL_COVER_LOCAL_REFERENCE_TYPES,
    NOVEL_COVER_RATIO_OPTIONS,
    resetCoverStudio,
    loadCoverHistory,
    addCoverReferenceFiles,
    onPickCoverReferences,
    onDropCoverReferences,
    removeCoverReference,
    clearCoverReferences,
    clearCoverGenerationForm,
    generateStandaloneCover,
    selectCoverHistory,
    downloadCoverHistory,
    removeCoverHistory,
    clearCoverHistory,
    formatCoverHistoryTime,
    downloadStandaloneCover,
  };
}
