export function createCharacterLibraryRuntime({ api, message, messageBox, refs = {}, helpers = {}, reactive, computed } = {}) {
  const library = reactive({
    visible: false,
    loading: false,
    applyingId: '',
    adding: false,
    addingId: '',
    removing: false,
    removingId: '',
    matching: false,
    items: [],
    selectedIds: [],
    categories: [],
    projects: [],
    query: '',
    category: '',
    projectId: '',
    pickerMode: false,
    targetCategory: '',
    targetCategoryLabel: '',
    targetIndex: -1,
    targetElementName: '',
  });

  const filteredLibraryCharacters = computed(() => {
    const query = library.query.trim().toLocaleLowerCase();
    return library.items.filter((item) => {
      if (library.category && item.category !== library.category) return false;
      if (library.projectId && item.sourceProjectId !== library.projectId) return false;
      if (library.pickerMode && library.targetCategory && item.sourceCategory !== library.targetCategory) return false;
      if (!query) return true;
      return [
        item.name,
        item.elementName,
        item.characterName,
        item.assetName,
        item.alias,
        item.aliasesText,
        item.prompt,
        item.sourceProjectName,
        ...(item.tags || []),
      ].join(' ').toLocaleLowerCase().includes(query);
    });
  });

  const selectedLibraryCount = computed(() => library.selectedIds.length);
  const libraryAllFilteredSelected = computed(() => {
    const visibleIds = filteredLibraryCharacters.value.map((item) => item.id);
    return visibleIds.length > 0 && visibleIds.every((id) => library.selectedIds.includes(id));
  });
  const librarySomeFilteredSelected = computed(() => {
    const visibleIds = filteredLibraryCharacters.value.map((item) => item.id);
    return visibleIds.some((id) => library.selectedIds.includes(id)) && !libraryAllFilteredSelected.value;
  });

  async function loadCharacterLibrary() {
    library.loading = true;
    try {
      const result = await api.get('/api/character-library');
      library.items = result.items || [];
      library.categories = result.categories || [];
      library.projects = result.projects || [];
      const availableIds = new Set(library.items.map((item) => item.id));
      library.selectedIds = library.selectedIds.filter((id) => availableIds.has(id));
    } catch (error) {
      message.error(`素材图库加载失败：${error.message}`);
    } finally {
      library.loading = false;
    }
  }

  async function openCharacterLibrary() {
    library.pickerMode = false;
    library.targetCategory = '';
    library.targetCategoryLabel = '';
    library.targetIndex = -1;
    library.targetElementName = '';
    library.selectedIds = [];
    library.visible = true;
    await loadCharacterLibrary();
  }

  async function openCharacterLibraryPicker(element, index) {
    if (!refs.project.value || !element) return;
    const category = refs.category.value;
    const labels = { character: '人物', group: '群像', scene: '场景', prop: '道具', effect: '特效', creature: '妖兽' };
    library.pickerMode = true;
    library.targetCategory = category;
    library.targetCategoryLabel = labels[category] || '元素';
    library.targetIndex = Number(index);
    library.targetElementName = String(element.name || '当前元素');
    library.query = '';
    library.category = '';
    library.projectId = '';
    library.selectedIds = [];
    library.visible = true;
    await loadCharacterLibrary();
  }

  async function applyLibraryImage(item) {
    const project = refs.project.value;
    if (!project || library.targetIndex < 0 || library.applyingId) return;
    library.applyingId = item.id;
    try {
      const result = await api.post('/api/character-library/apply', {
        id: item.id,
        projectId: project.id,
        category: library.targetCategory,
        index: library.targetIndex,
      });
      const target = project.elements?.[result.category]?.[result.index];
      if (!target) throw new Error('当前元素状态已变化，请重新打开图库');
      target.hasImage = true;
      target.imageUpdatedAt = result.element.imageUpdatedAt;
      target.libraryImageSource = result.element.libraryImageSource;
      target._imgBroken = false;
      target._imgReload = 0;
      target._v = (target._v || 0) + 1;
      refs.category.value = result.category;
      refs.selectedElementIndex.value = result.index;
      library.visible = false;
      message.success(`已将“${item.name}”的图片用于“${result.element.name}”`);
    } catch (error) {
      message.error(`使用图库图片失败：${error.message}`);
    } finally {
      library.applyingId = '';
    }
  }

  async function autoMatchLibraryImages() {
    const project = refs.project.value;
    if (!project || library.matching) return;
    library.matching = true;
    try {
      const preview = await api.post('/api/character-library/match-preview', { projectId: project.id });
      if (!preview.matched) {
        const detail = preview.skippedExisting
          ? `已有图片 ${preview.skippedExisting} 个，剩余元素没有找到同类型同名图片`
          : '全局素材图库中没有找到同类型同名图片';
        message.warning(detail);
        return;
      }
      const sourceNames = (preview.sourceProjects || []).slice(0, 3).map((item) => `“${item.name}”`).join('、');
      const details = [
        `找到 ${preview.matched} 个可匹配元素`,
        preview.skippedExisting ? `已有图片 ${preview.skippedExisting} 个不会被覆盖` : '',
        preview.unmatchedCount ? `另有 ${preview.unmatchedCount} 个元素未匹配` : '',
        preview.conflicts ? `${preview.conflicts} 个元素存在多个同名来源，将使用最近更新的图片` : '',
        sourceNames ? `图片来源：${sourceNames}${preview.sourceProjects.length > 3 ? '等项目' : ''}` : '',
      ].filter(Boolean).join('；');
      try {
        await messageBox?.confirm?.(details, '一键匹配图片', {
          type: 'info',
          confirmButtonText: `匹配 ${preview.matched} 张图片`,
          cancelButtonText: '取消',
        });
      } catch {
        return;
      }
      const result = await api.post('/api/character-library/match-apply', { projectId: project.id });
      if (!result.applied) {
        message.warning(result.failed ? `${result.failed} 张匹配图片复制失败，请稍后重试` : '元素状态已变化，没有需要补齐的图片');
        return;
      }
      const refreshed = await api.get(`/api/project?id=${encodeURIComponent(project.id)}`);
      if (refreshed.project) refs.project.value = helpers.hydrateImageState ? helpers.hydrateImageState(refreshed.project) : refreshed.project;
      if (result.failed) message.warning(`已匹配 ${result.applied} 张图片，另有 ${result.failed} 张复制失败；现有图片均已保留`);
      else message.success(`已匹配 ${result.applied} 张图片，现有图片均已保留`);
    } catch (error) {
      message.error(`一键匹配图片失败：${error.message}`);
    } finally {
      library.matching = false;
    }
  }

  function isLibraryItemSelected(item) {
    return library.selectedIds.includes(item?.id);
  }

  function toggleLibraryItemSelection(item, selected) {
    if (library.pickerMode || !item?.id) return;
    const next = new Set(library.selectedIds);
    const shouldSelect = selected === undefined ? !next.has(item.id) : !!selected;
    if (shouldSelect) next.add(item.id);
    else next.delete(item.id);
    library.selectedIds = [...next];
  }

  function toggleAllFilteredLibraryItems() {
    if (library.pickerMode) return;
    const visibleIds = filteredLibraryCharacters.value.map((item) => item.id);
    const next = new Set(library.selectedIds);
    if (libraryAllFilteredSelected.value) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    library.selectedIds = [...next];
  }

  async function addLibraryItemsToProject(ids = library.selectedIds) {
    const project = refs.project.value;
    const selected = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
    if (!project || !selected.length || library.adding) return;
    library.adding = true;
    library.addingId = selected.length === 1 ? selected[0] : '';
    try {
      const result = await api.post('/api/character-library/batch-add', { projectId: project.id, ids: selected });
      if (result.added) {
        const refreshed = await api.get(`/api/project?id=${encodeURIComponent(project.id)}`);
        if (refreshed.project) refs.project.value = helpers.hydrateImageState ? helpers.hydrateImageState(refreshed.project) : refreshed.project;
      }
      library.selectedIds = library.selectedIds.filter((id) => !selected.includes(id));
      if (result.added) {
        message.success(result.skipped
          ? `已添加 ${result.added} 张素材，跳过 ${result.skipped} 张重复或无效素材`
          : `已添加 ${result.added} 张素材到当前项目`);
      } else {
        message.warning('所选素材已在当前项目中，无需重复添加');
      }
    } catch (error) {
      message.error(`添加图库素材失败：${error.message}`);
    } finally {
      library.adding = false;
      library.addingId = '';
    }
  }

  async function removeLibraryItems(items) {
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
    const ids = [...new Set(list.map((item) => typeof item === 'string' ? item : item.id).filter(Boolean))];
    if (!ids.length || library.removing) return;
    const singleItem = ids.length === 1 ? library.items.find((item) => item.id === ids[0]) : null;
    try {
      await messageBox?.confirm?.(
        singleItem ? `从全局素材图库移除“${singleItem.name}”？源项目中的图片会保留。` : `从全局素材图库移除选中的 ${ids.length} 张图片？源项目中的图片会保留。`,
        singleItem ? '移除图片' : '批量移除',
        { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
    library.removing = true;
    library.removingId = singleItem?.id || '';
    try {
      const result = await api.post('/api/character-library/remove', { ids });
      await loadCharacterLibrary();
      message.success(`已从图库移除 ${result.removed || 0} 张图片`);
    } catch (error) {
      message.error(`移除图库图片失败：${error.message}`);
    } finally {
      library.removing = false;
      library.removingId = '';
    }
  }

  function removeSelectedLibraryItems() {
    return removeLibraryItems(library.selectedIds);
  }

  function resetCharacterLibraryFilters() {
    library.query = '';
    library.category = '';
    library.projectId = '';
  }

  return {
    library,
    filteredLibraryCharacters,
    selectedLibraryCount,
    libraryAllFilteredSelected,
    librarySomeFilteredSelected,
    loadCharacterLibrary,
    openCharacterLibrary,
    openCharacterLibraryPicker,
    applyLibraryImage,
    autoMatchLibraryImages,
    isLibraryItemSelected,
    toggleLibraryItemSelection,
    toggleAllFilteredLibraryItems,
    addLibraryItemsToProject,
    removeLibraryItems,
    removeSelectedLibraryItems,
    resetCharacterLibraryFilters,
  };
}
