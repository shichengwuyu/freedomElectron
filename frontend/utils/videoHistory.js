// 视频历史记录管理
export function createVideoHistoryRuntime({ api, message, messageBox, reactive, onRestored } = {}) {
  const historyDialog = reactive({
    visible: false,
    loading: false,
    restoring: false,
    projectId: '',
    episodeId: '',
    shotNo: '',
    shotTitle: '',
    versions: [],
    stats: null,
  });

  // 打开历史记录对话框
  const openVideoHistory = async (projectId, episodeId, shotNo, shotTitle = '') => {
    historyDialog.projectId = projectId;
    historyDialog.episodeId = String(episodeId);
    historyDialog.shotNo = String(shotNo);
    historyDialog.shotTitle = shotTitle || `镜头 ${shotNo}`;
    historyDialog.versions = [];
    historyDialog.stats = null;
    historyDialog.visible = true;
    historyDialog.loading = true;

    try {
      const result = await api.get(
        `/api/video/history/list?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(String(episodeId))}&shotNo=${encodeURIComponent(String(shotNo))}`
      );
      if (result.ok) {
        historyDialog.versions = result.versions || [];
        historyDialog.stats = result.stats || null;
      } else {
        throw new Error(result.error || '获取历史记录失败');
      }
    } catch (error) {
      message.error('获取历史记录失败：' + (error.message || error));
      historyDialog.visible = false;
    } finally {
      historyDialog.loading = false;
    }
  };

  // 关闭对话框
  const closeVideoHistory = () => {
    historyDialog.visible = false;
  };

  const historyVideoUrl = (version) => {
    if (version?.videoUrl) return version.videoUrl;
    const { projectId, episodeId, shotNo } = historyDialog;
    return `/video-history/${encodeURIComponent(projectId)}/${encodeURIComponent(episodeId)}/${encodeURIComponent(shotNo)}/${encodeURIComponent(String(version?.timestamp || ''))}.mp4?t=${encodeURIComponent(String(version?.timestamp || ''))}`;
  };

  const prepareHistoryPreview = (event) => {
    const video = event?.currentTarget;
    if (!video || video.currentTime > 0 || !Number.isFinite(video.duration) || video.duration <= 0) return;
    try {
      video.currentTime = Math.min(0.1, video.duration / 2);
    } catch {
      // 部分编码不支持精确定位，浏览器仍会显示首个可解码帧。
    }
  };

  // 恢复历史版本，返回 true 表示恢复成功（调用方可据此刷新视频）
  const restoreHistoryVersion = async (version, callback = onRestored) => {
    const { projectId, episodeId, shotNo } = historyDialog;
    try {
      await messageBox.confirm(
        `确定要恢复到 ${formatDateTime(version.createdAt)} 的版本吗？当前视频会被自动保存到历史记录中。`,
        '恢复历史版本',
        { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' }
      );
    } catch {
      return false;
    }

    historyDialog.restoring = true;
    try {
      const result = await api.post('/api/video/history/restore', {
        projectId,
        episodeId,
        shotNo,
        timestamp: version.timestamp,
      });
      if (!result.ok) throw new Error(result.error || '恢复失败');
      if (typeof callback === 'function') await callback(result, { projectId, episodeId, shotNo });
      historyDialog.visible = false;
      message.success('已恢复历史版本');
      return true;
    } catch (error) {
      message.error('恢复失败：' + (error.message || error));
      return false;
    } finally {
      historyDialog.restoring = false;
    }
  };

  // 删除历史版本
  const deleteHistoryVersion = async (version) => {
    const { projectId, episodeId, shotNo } = historyDialog;
    try {
      await messageBox.confirm(
        `确定要删除 ${formatDateTime(version.createdAt)} 的历史版本吗？此操作无法撤销。`,
        '删除历史版本',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      );
    } catch {
      return false;
    }

    historyDialog.loading = true;
    try {
      const result = await api.post('/api/video/history/delete', {
        projectId, episodeId, shotNo, timestamp: version.timestamp,
      });
      if (!result.ok) throw new Error(result.error || '删除失败');
      message.success('已删除历史版本');
      await openVideoHistory(projectId, episodeId, shotNo, historyDialog.shotTitle);
      return true;
    } catch (error) {
      message.error('删除失败：' + (error.message || error));
      return false;
    } finally {
      historyDialog.loading = false;
    }
  };

  // 清空所有历史记录
  const clearAllHistory = async () => {
    const { projectId, episodeId, shotNo } = historyDialog;
    try {
      await messageBox.confirm(
        `确定要清空镜头 ${shotNo} 的全部历史记录吗？此操作无法撤销。`,
        '清空历史记录',
        { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
      );
    } catch {
      return false;
    }

    historyDialog.loading = true;
    try {
      const result = await api.post('/api/video/history/clear', { projectId, episodeId, shotNo });
      if (!result.ok) throw new Error(result.error || '清空失败');
      message.success(`已清空 ${result.deleted} 个历史版本`);
      historyDialog.visible = false;
      return true;
    } catch (error) {
      message.error('清空失败：' + (error.message || error));
      return false;
    } finally {
      historyDialog.loading = false;
    }
  };

  // 格式化成"X分钟前"形式
  const formatDateTime = (isoString) => {
    if (!isoString) return '';
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  };

  return {
    historyDialog,
    openVideoHistory,
    closeVideoHistory,
    historyVideoUrl,
    prepareHistoryPreview,
    restoreHistoryVersion,
    deleteHistoryVersion,
    clearAllHistory,
    formatDateTime,
  };
}
