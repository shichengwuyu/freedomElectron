// 项目管理相关的 Composition API
const PROJECT_RENDER_BATCH_SIZE = 24;

export function useProject(api, reactive, ref, computed, ElMessage, ElMessageBox, nextTick, watch) {
  const projects = ref([]);
  const deletedProjects = ref([]);
  const loadingProjects = ref(false);
  const loadingTrash = ref(false);
  const creating = ref(false);
  const backupImporting = ref(false);
  const projectPackageImporting = ref(false);
  const projectSelectionMode = ref(false);
  const selectedProjectIds = ref([]);
  const newProjectName = ref('');
  const projectSearch = ref('');
  const projectSort = ref('updated');
  const projectSection = ref('active');
  const projectRenderLimit = ref(PROJECT_RENDER_BATCH_SIZE);
  const recentAccess = ref(loadRecentAccess());
  const snapshots = reactive({ visible: false, loading: false, projectId: '', projectName: '', items: [] });

  function loadRecentAccess() {
    try { return JSON.parse(localStorage.getItem('gg-studio-recent-projects') || '{}') || {}; }
    catch { return {}; }
  }

  function rememberProjectOpened(projectId) {
    if (!projectId) return;
    const next = { ...recentAccess.value, [projectId]: new Date().toISOString() };
    recentAccess.value = next;
    try { localStorage.setItem('gg-studio-recent-projects', JSON.stringify(next)); } catch { /* ignore */ }
  }

  function recentAt(projectId) {
    return recentAccess.value[projectId] || '';
  }

  const activeProjects = computed(() => projects.value.filter((project) => !project.archivedAt));
  const archivedProjects = computed(() => projects.value.filter((project) => project.archivedAt));
  const overviewProjects = computed(() => activeProjects.value);

  const projectOverviewStats = computed(() => projects.value.reduce((stats, project) => {
    const counts = project.counts || {};
    stats.character += Number(counts.character) || 0;
    stats.assets += (Number(counts.group) || 0)
      + (Number(counts.scene) || 0)
      + (Number(counts.prop) || 0)
      + (Number(counts.effect) || 0)
      + (Number(counts.creature) || 0);
    return stats;
  }, { character: 0, assets: 0 }));

  const activeProjectOverviewStats = computed(() => overviewProjects.value.reduce((stats, project) => {
    const counts = project.counts || {};
    stats.character += Number(counts.character) || 0;
    stats.scene += Number(counts.scene) || 0;
    stats.episodes += Number(counts.episodes) || 0;
    stats.storyboards += Number(counts.storyboards) || 0;
    return stats;
  }, { character: 0, scene: 0, episodes: 0, storyboards: 0 }));

  const filteredProjects = computed(() => {
    const query = projectSearch.value.trim().toLocaleLowerCase();
    const source = projectSection.value === 'archived' ? archivedProjects.value : activeProjects.value;
    const list = source.filter((project) => {
      if (!query) return true;
      return [project.name, project.id, project.description]
        .some((value) => String(value || '').toLocaleLowerCase().includes(query));
    });
    const sorter = projectSort.value;
    return [...list].sort((a, b) => {
      if (sorter === 'name') return String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN');
      if (sorter === 'created') return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      if (sorter === 'recent') {
        return String(recentAt(b.id) || b.updatedAt || '').localeCompare(String(recentAt(a.id) || a.updatedAt || ''));
      }
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });
  });

  const renderedProjects = computed(() => filteredProjects.value.slice(0, projectRenderLimit.value));
  const hasMoreRenderedProjects = computed(() => renderedProjects.value.length < filteredProjects.value.length);
  const selectedProjectCount = computed(() => selectedProjectIds.value.length);
  const allFilteredProjectsSelected = computed(() => (
    filteredProjects.value.length > 0
    && filteredProjects.value.every((project) => selectedProjectIds.value.includes(String(project.id)))
  ));
  const loadMoreProjects = () => {
    if (!hasMoreRenderedProjects.value) return false;
    projectRenderLimit.value += PROJECT_RENDER_BATCH_SIZE;
    hydrateRenderedProjectSizes();
    return true;
  };
  const resetRenderedProjects = () => {
    projectRenderLimit.value = PROJECT_RENDER_BATCH_SIZE;
  };

  if (typeof watch === 'function') {
    watch([projectSearch, projectSort, projectSection], () => {
      resetRenderedProjects();
      hydrateRenderedProjectSizes();
    });
  }

  async function loadProjects() {
    loadingProjects.value = true;
    try {
      const response = await api.get('/api/projects');
      projects.value = response.projects || [];
      const availableIds = new Set(projects.value.map((project) => String(project.id)));
      selectedProjectIds.value = selectedProjectIds.value.filter((id) => availableIds.has(id));
      resetRenderedProjects();
      projectListRevision += 1;
      pendingProjectSizeIds.clear();
      hydrateRenderedProjectSizes();
    } catch (error) {
      ElMessage.error(`项目列表加载失败：${error.message}`);
    } finally {
      loadingProjects.value = false;
    }
  }

  let projectListRevision = 0;
  const pendingProjectSizeIds = new Set();

  function hydrateRenderedProjectSizes() {
    const revision = projectListRevision;
    const run = () => void hydrateProjectSizes(revision);
    if (typeof nextTick === 'function') nextTick(run);
    else run();
  }

  async function hydrateProjectSizes(revision) {
    const ids = renderedProjects.value
      .filter((project) => (
        (project.sizeBytes == null || !Number.isFinite(Number(project.sizeBytes)))
        && !pendingProjectSizeIds.has(String(project.id))
      ))
      .map((project) => String(project.id));
    if (!ids.length) return;
    ids.forEach((id) => pendingProjectSizeIds.add(id));
    try {
      const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
      const response = await api.get(`/api/projects/sizes?${query}`);
      if (revision !== projectListRevision || !Array.isArray(response?.projects)) return;
      const sizes = new Map(response.projects.map((item) => [String(item.id), item.sizeBytes]));
      projects.value = projects.value.map((project) => (
        sizes.has(String(project.id)) ? { ...project, sizeBytes: sizes.get(String(project.id)) } : project
      ));
    } catch {
      // Storage usage is supplementary metadata. Keep the project board responsive if it cannot be read.
    } finally {
      ids.forEach((id) => pendingProjectSizeIds.delete(id));
    }
  }

  async function loadDeletedProjects() {
    loadingTrash.value = true;
    try {
      const response = await api.get('/api/projects/deleted');
      deletedProjects.value = response.projects || [];
    } catch (error) {
      ElMessage.error(`回收站加载失败：${error.message}`);
    } finally {
      loadingTrash.value = false;
    }
  }

  async function selectProjectSection(section) {
    projectSection.value = section;
    selectedProjectIds.value = [];
    projectSelectionMode.value = false;
    if (section === 'trash') await loadDeletedProjects();
  }

  async function createProject() {
    if (creating.value) return;
    const name = newProjectName.value.trim();
    if (!name) return ElMessage.warning('请填写项目名称');
    creating.value = true;
    try {
      await nextTick();
      const response = await api.post('/api/project/create', { name });
      newProjectName.value = '';
      ElMessage.success('项目已创建');
      await loadProjects();
      return response.projectId;
    } catch (error) {
      ElMessage.error(error.message || '创建失败');
    } finally {
      creating.value = false;
    }
  }

  async function delProject(id, ev) {
    ev?.stopPropagation?.();
    try {
      await ElMessageBox.confirm(`将项目「${id}」移入回收站？之后仍可恢复。`, '移入回收站', {
        type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消',
      });
      await api.post('/api/project/delete', { projectId: id });
      ElMessage.success('项目已移入回收站');
      await loadProjects();
      if (projectSection.value === 'trash') await loadDeletedProjects();
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      if (error?.message) ElMessage.error(error.message);
    }
  }

  async function renameProject(project, ev) {
    ev?.stopPropagation?.();
    try {
      const { value } = await ElMessageBox.prompt('请输入新的项目名称', '重命名项目', {
        inputValue: project.name || project.id,
        inputPattern: /\S+/,
        inputErrorMessage: '项目名称不能为空',
        confirmButtonText: '重命名',
        cancelButtonText: '取消',
      });
      const response = await api.post('/api/project/rename', { projectId: project.id, name: value.trim() });
      const nextProjectId = response.projectId || value.trim();
      if (recentAccess.value[project.id]) {
        const next = { ...recentAccess.value, [nextProjectId]: recentAccess.value[project.id] };
        delete next[project.id];
        recentAccess.value = next;
        try { localStorage.setItem('gg-studio-recent-projects', JSON.stringify(next)); } catch { /* ignore */ }
      }
      ElMessage.success('项目已重命名');
      await loadProjects();
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      if (error?.message) ElMessage.error(error.message);
    }
  }

  async function duplicateProject(project, ev) {
    ev?.stopPropagation?.();
    try {
      const { value } = await ElMessageBox.prompt('请输入副本名称', '复制项目', {
        inputValue: `${project.name || project.id} 副本`,
        inputPattern: /\S+/,
        inputErrorMessage: '项目名称不能为空',
        confirmButtonText: '复制',
        cancelButtonText: '取消',
      });
      await api.post('/api/project/duplicate', { projectId: project.id, name: value.trim() });
      ElMessage.success('项目副本已创建');
      await loadProjects();
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      if (error?.message) ElMessage.error(error.message);
    }
  }

  async function toggleProjectArchive(project, archived, ev) {
    ev?.stopPropagation?.();
    try {
      await api.post('/api/project/archive', { projectId: project.id, archived });
      ElMessage.success(archived ? '项目已归档' : '项目已取消归档');
      await loadProjects();
    } catch (error) {
      ElMessage.error(error.message || '归档操作失败');
    }
  }

  async function restoreDeletedProject(item) {
    try {
      await api.post('/api/project/restore', { trashId: item.trashId });
      ElMessage.success('项目已恢复');
      await Promise.all([loadProjects(), loadDeletedProjects()]);
    } catch (error) {
      ElMessage.error(error.message || '恢复失败');
    }
  }

  async function purgeDeletedProject(item) {
    try {
      await ElMessageBox.confirm(`永久删除「${item.name || item.projectId}」？该操作不可恢复。`, '永久删除', {
        type: 'error', confirmButtonText: '永久删除', cancelButtonText: '取消',
      });
      await api.post('/api/project/trash/purge', { trashId: item.trashId });
      ElMessage.success('项目已永久删除');
      await loadDeletedProjects();
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      if (error?.message) ElMessage.error(error.message);
    }
  }

  async function emptyProjectTrash() {
    if (!deletedProjects.value.length) return;
    try {
      await ElMessageBox.confirm('永久清空回收站？其中所有项目都将无法恢复。', '清空回收站', {
        type: 'error', confirmButtonText: '永久清空', cancelButtonText: '取消',
      });
      const response = await api.post('/api/project/trash/empty', {});
      ElMessage.success(`已永久删除 ${response.count || 0} 个项目`);
      await loadDeletedProjects();
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      if (error?.message) ElMessage.error(error.message);
    }
  }

  async function showProjectSnapshots(project, ev) {
    ev?.stopPropagation?.();
    snapshots.visible = true;
    snapshots.loading = true;
    snapshots.projectId = project.id;
    snapshots.projectName = project.name || project.id;
    snapshots.items = [];
    try {
      const response = await api.get(`/api/project/snapshots?projectId=${encodeURIComponent(project.id)}`);
      snapshots.items = response.snapshots || [];
    } catch (error) {
      ElMessage.error(error.message || '版本历史加载失败');
    } finally {
      snapshots.loading = false;
    }
  }

  async function restoreProjectSnapshot(item) {
    try {
      await ElMessageBox.confirm(`恢复到 ${formatProjectTime(item.createdAt)} 的版本？当前版本会自动保留快照。`, '恢复历史版本', {
        type: 'warning', confirmButtonText: '恢复此版本', cancelButtonText: '取消',
      });
      await api.post('/api/project/snapshot/restore', { projectId: snapshots.projectId, snapshotId: item.id });
      ElMessage.success('历史版本已恢复');
      snapshots.visible = false;
      await loadProjects();
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      if (error?.message) ElMessage.error(error.message);
    }
  }

  function exportBackup() {
    const link = document.createElement('a');
    link.href = `/api/backups/export?t=${Date.now()}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function importBackup(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;
    backupImporting.value = true;
    try {
      const response = await api.upload('/api/backups/import', file, { contentType: 'application/zip' });
      ElMessage.success(`备份导入完成：恢复 ${response.restored?.length || 0} 项，跳过 ${response.skipped?.length || 0} 项`);
      await Promise.all([loadProjects(), loadDeletedProjects()]);
    } catch (error) {
      ElMessage.error(`备份导入失败：${error.message}`);
    } finally {
      backupImporting.value = false;
      if (input) input.value = '';
    }
  }

  function isProjectSelected(projectId) {
    return selectedProjectIds.value.includes(String(projectId));
  }

  function setProjectSelected(projectId, selected) {
    const id = String(projectId);
    const next = new Set(selectedProjectIds.value);
    if (selected) next.add(id);
    else next.delete(id);
    selectedProjectIds.value = [...next];
  }

  function toggleProjectSelection(projectId) {
    setProjectSelected(projectId, !isProjectSelected(projectId));
  }

  function toggleProjectSelectionMode() {
    projectSelectionMode.value = !projectSelectionMode.value;
    if (!projectSelectionMode.value) selectedProjectIds.value = [];
  }

  function selectAllFilteredProjects() {
    const visibleIds = filteredProjects.value.map((project) => String(project.id));
    const next = new Set(selectedProjectIds.value);
    if (visibleIds.length && visibleIds.every((id) => next.has(id))) {
      visibleIds.forEach((id) => next.delete(id));
    } else {
      visibleIds.forEach((id) => next.add(id));
    }
    selectedProjectIds.value = [...next];
  }

  function startProjectPackageDownload(projectIds) {
    const ids = [...new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) {
      ElMessage.warning('请先选择要导出的项目');
      return false;
    }
    const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
    const link = document.createElement('a');
    link.href = `/api/projects/export?${query}&t=${Date.now()}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }

  function exportProjectPackage(project, event) {
    event?.stopPropagation?.();
    startProjectPackageDownload([project?.id]);
  }

  function exportSelectedProjects() {
    if (!startProjectPackageDownload(selectedProjectIds.value)) return;
    projectSelectionMode.value = false;
    selectedProjectIds.value = [];
  }

  async function importProjectPackages(event) {
    const input = event?.target;
    const files = [...(input?.files || [])];
    if (!files.length) return;
    projectPackageImporting.value = true;
    const imported = [];
    const failed = [];
    try {
      for (const file of files) {
        try {
          const response = await api.upload('/api/projects/import', file, {
            contentType: 'application/zip',
            timeoutMs: 30 * 60 * 1000,
          });
          imported.push(...(response.imported || []));
        } catch (error) {
          failed.push({ name: file.name, message: error.message || '导入失败' });
        }
      }
      if (imported.length) await loadProjects();
      if (failed.length) {
        const detail = failed.slice(0, 2).map((item) => `${item.name}：${item.message}`).join('；');
        ElMessage.warning(`已导入 ${imported.length} 个项目，${failed.length} 个文件失败。${detail}`);
      } else {
        const renamed = imported.filter((item) => item.renamed).length;
        ElMessage.success(`已导入 ${imported.length} 个项目${renamed ? `，其中 ${renamed} 个因同名自动重命名` : ''}`);
      }
    } finally {
      projectPackageImporting.value = false;
      if (input) input.value = '';
    }
  }

  function openProjectFromKeyboard(event, projectId, openProject) {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    openProject(projectId);
  }

  function formatProjectTime(value) {
    if (!value) return '暂无';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function formatProjectSize(bytes) {
    if (bytes == null || bytes === '' || !Number.isFinite(Number(bytes))) return '统计中';
    const size = Math.max(0, Number(bytes) || 0);
    if (size < 1024) return `${Math.round(size)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)) - 1, units.length - 1);
    const value = size / (1024 ** (unitIndex + 1));
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  }

  return {
    projects,
    deletedProjects,
    activeProjects,
    archivedProjects,
    overviewProjects,
    projectOverviewStats,
    activeProjectOverviewStats,
    filteredProjects,
    renderedProjects,
    hasMoreRenderedProjects,
    loadingProjects,
    loadingTrash,
    creating,
    backupImporting,
    projectPackageImporting,
    projectSelectionMode,
    selectedProjectIds,
    selectedProjectCount,
    allFilteredProjectsSelected,
    newProjectName,
    projectSearch,
    projectSort,
    projectSection,
    snapshots,
    loadProjects,
    loadMoreProjects,
    loadDeletedProjects,
    selectProjectSection,
    createProject,
    delProject,
    renameProject,
    duplicateProject,
    toggleProjectArchive,
    restoreDeletedProject,
    purgeDeletedProject,
    emptyProjectTrash,
    showProjectSnapshots,
    restoreProjectSnapshot,
    exportBackup,
    importBackup,
    isProjectSelected,
    setProjectSelected,
    toggleProjectSelection,
    toggleProjectSelectionMode,
    selectAllFilteredProjects,
    exportProjectPackage,
    exportSelectedProjects,
    importProjectPackages,
    rememberProjectOpened,
    recentAt,
    openProjectFromKeyboard,
    formatProjectTime,
    formatProjectSize,
  };
}

