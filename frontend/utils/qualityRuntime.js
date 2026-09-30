const ISSUE_TITLES = Object.freeze({
  'storage-inconsistent': '项目存储事务不一致',
  'storage-version-old': '项目存储版本需要升级',
  'no-chapters': '尚未导入原文章节',
  'chapter-empty': '原文章节内容为空',
  'chapter-uncovered': '原文章节未被任何剧集覆盖',
  'no-episodes': '尚未创建剧集计划',
  'episode-script-missing': '剧集缺少剧本内容',
  'storyboard-missing': '剧集缺少分镜',
  'shot-parse-empty': '分镜内容无法解析出镜头',
  'shot-duration-abnormal': '镜头时长异常',
  'shot-video-missing': '镜头视频缺失',
  'video-metadata-stale': '视频元数据指向不存在的文件',
  'bound-asset-image-missing': '分镜引用的元素尚未出图',
  'asset-name-empty': '元素名称为空',
  'asset-name-duplicate': '元素名称重复',
  'asset-prompt-empty': '元素提示词为空',
  'asset-image-missing': '元素尚未出图',
});

const CATEGORY_LABELS = Object.freeze({
  storage: '数据存储',
  script: '剧本',
  storyboard: '分镜',
  video: '镜头视频',
  asset: '元素资产',
  project: '项目',
});

const ACTION_LABELS = Object.freeze({
  'sync-shot-videos': '修复视频元数据',
  'upgrade-storage': '升级存储版本',
  'repair-storage': '修复存储事务',
  'open-script': '前往剧本',
  'open-storyboard': '前往分镜',
  'open-shot': '定位镜头',
  'open-element': '前往元素库',
});

const FIX_ACTIONS = new Set(['sync-shot-videos', 'upgrade-storage', 'repair-storage']);

export function createQualityRuntime({ api, message, messageBox, refs = {}, helpers = {}, reactive, computed, watch } = {}) {
  const quality = reactive({
    visible: false,
    loading: false,
    fixing: '',
    severity: 'all',
    category: 'all',
    page: 1,
    pageSize: 30,
    report: null,
  });

  const qualityCategories = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
  const filteredQualityIssues = computed(() => (quality.report?.issues || []).filter((issue) => (
    (quality.severity === 'all' || issue.severity === quality.severity)
    && (quality.category === 'all' || issue.category === quality.category)
  )));
  const pagedQualityIssues = computed(() => {
    const start = (quality.page - 1) * quality.pageSize;
    return filteredQualityIssues.value.slice(start, start + quality.pageSize);
  });
  const qualityStorageStatus = computed(() => quality.report?.storage || null);
  const qualityFixActions = computed(() => [...new Set((quality.report?.issues || []).map((issue) => issue.action).filter((action) => FIX_ACTIONS.has(action)))]);

  const loadQualityReport = async () => {
    const projectId = refs.project.value?.id;
    if (!projectId) return;
    quality.loading = true;
    try {
      const result = await api.get(`/api/quality/report?projectId=${encodeURIComponent(projectId)}`);
      quality.report = result.report || null;
      const maxPage = Math.max(1, Math.ceil(filteredQualityIssues.value.length / quality.pageSize));
      if (quality.page > maxPage) quality.page = maxPage;
    } catch (error) {
      message.error(`项目质检失败：${error.message || error}`);
    } finally {
      quality.loading = false;
    }
  };

  const openProjectQuality = async () => {
    if (!refs.project.value?.id) return message.warning('请先打开一个项目');
    quality.visible = true;
    await loadQualityReport();
  };

  const fixQualityIssue = async (action) => {
    if (!FIX_ACTIONS.has(action) || quality.fixing) return;
    if (action === 'repair-storage') {
      try {
        await messageBox?.confirm?.('将通过事务化保存重新生成项目清单和文件哈希。继续修复？', '修复项目存储', {
          type: 'warning',
          confirmButtonText: '修复',
          cancelButtonText: '取消',
        });
      } catch {
        return;
      }
    }
    quality.fixing = action;
    try {
      const result = await api.post('/api/quality/fix', { projectId: refs.project.value.id, action });
      quality.report = result.report || quality.report;
      message.success(`${ACTION_LABELS[action] || '自动修复'}完成`);
    } catch (error) {
      message.error(`自动修复失败：${error.message || error}`);
    } finally {
      quality.fixing = '';
    }
  };

  const resolveEpisodeId = (value) => refs.scriptState.episodes.find((episode) => String(episode.id) === String(value))?.id ?? value;
  const closeQualityAndRun = async (callback) => {
    quality.visible = false;
    await helpers.nextTick?.();
    await callback();
  };

  const navigateQualityIssue = async (issue) => {
    if (!issue?.action) return;
    if (FIX_ACTIONS.has(issue.action)) return fixQualityIssue(issue.action);
    const episodeId = resolveEpisodeId(issue.episodeId);
    if (issue.action === 'open-script') {
      return closeQualityAndRun(async () => {
        refs.scriptUi.stage = 'script';
        refs.scriptUi.selectedId = `ep:${episodeId}`;
      });
    }
    if (issue.action === 'open-storyboard' || issue.action === 'open-shot') {
      return closeQualityAndRun(async () => {
        refs.scriptUi.stage = 'storyboard';
        refs.storyboardEpisodeId.value = episodeId;
        await helpers.nextTick?.();
        if (issue.action === 'open-shot') {
          const storyboard = helpers.findStoryboard?.(episodeId);
          const shot = helpers.parseShots?.(storyboard?.content || '').find((item) => String(item.no) === String(issue.shotNo));
          if (shot) helpers.setTimeout?.(() => helpers.focusShot?.(shot), 80);
        }
      });
    }
    if (issue.action === 'open-element') {
      return closeQualityAndRun(async () => {
        if (issue.elementCategory) refs.category.value = issue.elementCategory;
        refs.elementSearchQuery.value = issue.elementName || '';
        helpers.openElementsDrawer?.();
      });
    }
  };

  const qualityIssueTitle = (issue) => ISSUE_TITLES[issue?.code] || issue?.title || '项目问题';
  const qualityIssueDetail = (issue) => {
    if (!issue) return '';
    if (issue.episodeId !== '' && issue.shotNo !== '') return `第 ${issue.episodeId} 集 · 镜头 ${issue.shotNo}${issue.elementName ? ` · ${issue.elementName}` : ''}`;
    if (issue.episodeId !== '') return `第 ${issue.episodeId} 集${issue.message ? ` · ${issue.message}` : ''}`;
    if (issue.elementName) return `${issue.elementName}${issue.message && issue.message !== issue.elementName ? ` · ${issue.message}` : ''}`;
    return issue.message || '';
  };
  const qualitySeverityLabel = (severity) => ({ error: '错误', warning: '警告', info: '提示' }[severity] || severity);
  const qualitySeverityType = (severity) => ({ error: 'danger', warning: 'warning', info: 'info' }[severity] || 'info');
  const qualityCategoryLabel = (category) => CATEGORY_LABELS[category] || category || '项目';
  const qualityActionLabel = (action) => ACTION_LABELS[action] || '查看';
  const formatQualityTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
  };

  if (typeof watch === 'function') {
    watch(() => [quality.severity, quality.category, quality.pageSize], () => { quality.page = 1; });
    watch(() => refs.project.value?.id, () => {
      quality.visible = false;
      quality.report = null;
      quality.page = 1;
    });
  }

  return {
    quality,
    qualityCategories,
    filteredQualityIssues,
    pagedQualityIssues,
    qualityStorageStatus,
    qualityFixActions,
    openProjectQuality,
    loadQualityReport,
    fixQualityIssue,
    navigateQualityIssue,
    qualityIssueTitle,
    qualityIssueDetail,
    qualitySeverityLabel,
    qualitySeverityType,
    qualityCategoryLabel,
    qualityActionLabel,
    formatQualityTime,
  };
}
