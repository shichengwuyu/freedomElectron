export function createTaskCenter({ api, reactive, ElMessage }) {
  const emptySummary = () => ({ total: 0, running: 0, queued: 0, paused: 0, failed: 0, cancelled: 0, done: 0 });
  const taskCenter = reactive({
    loading: false,
    actionKey: '',
    clearing: false,
    filter: 'all',
    tasks: [],
    summary: emptySummary(),
    loadedAt: 0,
  });

  function setTaskFilter(status) {
    taskCenter.filter = taskCenter.filter === status ? 'all' : status;
  }

  function filteredTasks() {
    if (taskCenter.filter === 'all') return taskCenter.tasks;
    return taskCenter.tasks.filter((task) => task.status === taskCenter.filter);
  }

  // 整个应用是单个 Vue 组件：替换 tasks/summary 会触发全应用重渲染。
  // 轮询拿回的数据没变时保持原引用，4 秒一拍的刷新就不再引起任何重绘。
  let lastAppliedSignature = '';
  function applyTaskCenterResponse(response) {
    const tasks = response.tasks || [];
    const summary = { ...emptySummary(), ...(response.summary || {}) };
    taskCenter.loadedAt = Date.now();
    const signature = JSON.stringify({ tasks, summary });
    if (signature === lastAppliedSignature) return;
    lastAppliedSignature = signature;
    taskCenter.tasks = tasks;
    taskCenter.summary = summary;
  }

  async function loadTaskCenter() {
    taskCenter.loading = true;
    try {
      const response = await api.get('/api/tasks');
      applyTaskCenterResponse(response);
    } catch (error) {
      ElMessage.error(`任务中心刷新失败：${error.message}`);
    } finally {
      taskCenter.loading = false;
    }
  }

  // 任务页停留期间自动刷新：有活跃任务时 4s 一拍，全部静止后停
  let refreshTimer = null;
  async function refreshTaskCenterSilently() {
    try {
      const response = await api.get('/api/tasks');
      applyTaskCenterResponse(response);
    } catch { /* 静默轮询失败不打扰 */ }
  }
  function startTaskAutoRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(async () => {
      await refreshTaskCenterSilently();
      const active = taskCenter.summary.running + taskCenter.summary.queued;
      if (!active) stopTaskAutoRefresh();
    }, 4000);
  }
  function stopTaskAutoRefresh() {
    if (!refreshTimer) return;
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  // 主窗口最小化/失焦时仍需获知后台任务状态以触发完成通知；使用独立静默轮询，避免打扰用户。
  let desktopMonitorTimer = null;
  function startBackgroundTaskMonitor() {
    if (desktopMonitorTimer) return;
    refreshTaskCenterSilently();
    desktopMonitorTimer = setInterval(refreshTaskCenterSilently, 5000);
  }
  function stopBackgroundTaskMonitor() {
    if (!desktopMonitorTimer) return;
    clearInterval(desktopMonitorTimer);
    desktopMonitorTimer = null;
  }

  function taskActionPayload(task, action) {
    const payload = { source: task.source || 'job', action };
    if (payload.source === 'job') payload.taskId = task.rawId || task.id;
    if (payload.source === 'pending-video') payload.submitId = task.submitId;
    if (payload.source === 'pending-image') {
      payload.projectId = task.projectId;
      payload.category = task.category;
      payload.imageName = task.imageName;
    }
    return payload;
  }

  async function performTaskAction(task, action) {
    const actionKey = `${task.id}:${action}`;
    if (taskCenter.actionKey) return;
    taskCenter.actionKey = actionKey;
    try {
      await api.post('/api/tasks/action', taskActionPayload(task, action));
      const labels = { cancel: '任务已取消', retry: '任务已重新排队', remove: '任务已移除' };
      ElMessage.success(labels[action] || '操作完成');
      await loadTaskCenter();
    } catch (error) {
      ElMessage.error(`任务操作失败：${error.message}`);
    } finally {
      taskCenter.actionKey = '';
    }
  }

  async function clearFinishedTasks() {
    if (taskCenter.clearing) return;
    taskCenter.clearing = true;
    try {
      const response = await api.post('/api/tasks/clear-finished', {});
      ElMessage.success(`已清理 ${response.count || 0} 个已结束任务`);
      await loadTaskCenter();
    } catch (error) {
      ElMessage.error(`清理失败：${error.message}`);
    } finally {
      taskCenter.clearing = false;
    }
  }

  function taskActionLoading(task, action) {
    return taskCenter.actionKey === `${task.id}:${action}`;
  }

  function taskStatusType(status) {
    if (status === 'done') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'running') return 'warning';
    if (status === 'cancelled') return 'info';
    if (status === 'paused') return 'warning';
    return 'info';
  }

  function taskStatusLabel(status) {
    if (status === 'done') return '已完成';
    if (status === 'failed') return '失败';
    if (status === 'running') return '执行中';
    if (status === 'queued') return '等待中';
    if (status === 'paused') return '已暂停';
    if (status === 'cancelled') return '已取消';
    return status || '未知';
  }

  function formatTaskTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  return {
    taskCenter,
    loadTaskCenter,
    startTaskAutoRefresh,
    stopTaskAutoRefresh,
    startBackgroundTaskMonitor,
    stopBackgroundTaskMonitor,
    setTaskFilter,
    filteredTasks,
    performTaskAction,
    clearFinishedTasks,
    taskActionLoading,
    taskStatusType,
    taskStatusLabel,
    formatTaskTime,
  };
}
