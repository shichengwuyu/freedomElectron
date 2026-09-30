export async function detectJianyingDirFlow(handlers = {}) {
  if (handlers.isDetecting()) return;
  handlers.setDetecting(true);
  try {
    const result = await handlers.detectDir();
    if (result.ok && result.dir) {
      handlers.setDraftDir(result.dir);
      handlers.success('检测成功：' + result.dir);
    } else {
      handlers.warning('未找到剪映草稿目录，请手动输入或确保已安装剪映专业版');
    }
  } catch (error) {
    handlers.error('检测失败：' + error.message);
  } finally {
    handlers.setDetecting(false);
  }
}

export function createDetectJianyingDirRuntime({ api, message, refs = {} } = {}) {
  const context = {
    ...message,
    isDetecting: () => refs.detecting.value,
    setDetecting: (value) => { refs.detecting.value = value; },
    detectDir: () => api.post('/api/video/detect-jianying-dir'),
    setDraftDir: (dir) => { refs.config.jianying.draftDir = dir; },
  };
  return () => detectJianyingDirFlow(context);
}

export function createExportToJianyingContext(handlers = {}) {
  return {
    ...handlers.message,
    project: () => handlers.projectRef.value,
    episodeId: () => handlers.episodeIdRef.value,
    confirmExport: (episodeId) => handlers.messageBox.confirm(
      `确定将第${episodeId}集的所有视频导出到剪映草稿吗？`,
      '导出到剪映',
      {
        confirmButtonText: '确定导出',
        cancelButtonText: '取消',
        type: 'info',
      },
    ).then(() => true).catch(() => false),
    exportDraft: (payload) => handlers.api.post('/api/video/export-to-jianying', payload),
  };
}

export async function exportToJianyingFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const episodeId = handlers.episodeId();
  if (!episodeId) {
    handlers.warning('请先选择要导出的集');
    return;
  }
  const confirmed = await handlers.confirmExport(episodeId);
  if (!confirmed) return;
  const loading = handlers.info({ message: '正在导出到剪映草稿...', duration: 0 });
  try {
    const result = await handlers.exportDraft({ projectId: project.id, episodeId });
    loading.close();
    if (result.ok) {
      handlers.success(`成功导出 ${result.videoCount} 个视频到剪映草稿`);
    } else {
      handlers.error(result.error || '导出失败');
    }
  } catch (error) {
    loading.close();
    handlers.error('导出失败：' + error.message);
  }
}

export function createExportToJianyingRuntime({ api, message, messageBox, refs = {} } = {}) {
  const context = createExportToJianyingContext({
    api,
    message,
    messageBox,
    projectRef: refs.project,
    episodeIdRef: refs.episodeId,
  });
  return () => exportToJianyingFlow(context);
}
