// 全局快速跳转指挥舱（Ctrl/Cmd + K）
// 汇聚：视图切换、打开项目、跳转剧集/分镜、常用动作，全部键盘可达。
export function createCommandPaletteRuntime({ reactive, computed, globals, helpers }) {
  const palette = reactive({ open: false, query: '', index: 0 });

  const norm = (value) => String(value || '').toLowerCase();

  function baseCommands() {
    const commands = [
      { key: 'view:projects', icon: 'Folder', label: '项目控制台', hint: '视图', keywords: 'projects xiangmu 项目', run: () => helpers.setView('projects') },
      { key: 'view:novel', icon: 'EditPen', label: '写小说', hint: '视图', keywords: 'novel xiaoshuo 小说', run: () => helpers.setView('novel') },
      { key: 'view:cover', icon: 'Picture', label: '封面生成', hint: '视图', keywords: 'cover fengmian 封面 生图', run: () => helpers.setView('cover') },
      { key: 'view:animation', icon: 'VideoCamera', label: '动画制作台', hint: '视图', keywords: 'animation donghua 动画 分镜 时间轴', run: () => helpers.setView('animation') },
      { key: 'view:tasks', icon: 'List', label: '任务中心', hint: '视图', keywords: 'tasks renwu 任务', run: () => helpers.setView('tasks') },
      { key: 'view:settings', icon: 'Setting', label: '设置 · 模型与偏好', hint: '视图', keywords: 'settings shezhi 设置 模型', run: () => helpers.setView('settings') },
      { key: 'act:agent', icon: 'Operation', label: '打开 Agent 控制台', hint: '动作', keywords: 'agent zhineng 控制台', run: () => helpers.openAgent() },
    ];
    if (helpers.hasProject()) {
      commands.push({
        key: 'act:elements',
        icon: 'Grid',
        label: '打开元素库 / 出图',
        hint: '动作',
        keywords: 'elements yuansu 元素 出图',
        run: () => helpers.openElementsDrawer(),
      });
      commands.push({
        key: 'act:script',
        icon: 'Document',
        label: '回到剧本台',
        hint: '当前项目',
        keywords: 'script juben 剧本',
        run: () => helpers.gotoStage('script'),
      });
      commands.push({
        key: 'act:storyboard',
        icon: 'VideoCamera',
        label: '回到分镜台',
        hint: '当前项目',
        keywords: 'storyboard fenjing 分镜',
        run: () => helpers.gotoStage('storyboard'),
      });
      for (const ep of helpers.getEpisodes()) {
        commands.push({
          key: `ep:${ep.id}`,
          icon: 'Reading',
          label: `第${ep.id}集 · ${ep.title || '未命名'}`,
          hint: ep.content ? '剧集 · 已有剧本' : '剧集',
          keywords: `ep episode ${ep.id} ${ep.title || ''} 剧集`,
          run: () => helpers.gotoEpisode(ep.id),
        });
        commands.push({
          key: `sb:${ep.id}`,
          icon: 'Film',
          label: `第${ep.id}集 分镜台`,
          hint: '分镜',
          keywords: `sb storyboard ${ep.id} ${ep.title || ''} 分镜`,
          run: () => helpers.gotoStoryboard(ep.id),
        });
      }
    }
    for (const project of helpers.getProjects()) {
      commands.push({
        key: `proj:${project.id}`,
        icon: 'FolderOpened',
        label: project.name || project.id,
        hint: '打开项目',
        keywords: `project ${project.name || ''} ${project.id} 项目`,
        run: () => helpers.openProject(project.id),
      });
    }
    return commands;
  }

  const filteredCommands = computed(() => {
    if (!palette.open) return [];
    const query = norm(palette.query).trim();
    const commands = baseCommands();
    if (!query) return commands.slice(0, 14);
    const terms = query.split(/\s+/);
    return commands
      .map((cmd) => {
        const haystack = norm(`${cmd.label} ${cmd.hint} ${cmd.keywords}`);
        let score = 0;
        for (const term of terms) {
          const at = haystack.indexOf(term);
          if (at < 0) return null;
          score += at === 0 ? 3 : 1;
        }
        return { cmd, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .map((entry) => entry.cmd);
  });

  function openPalette() {
    palette.open = true;
    palette.query = '';
    palette.index = 0;
    helpers.nextTick(() => {
      const input = globals.document.querySelector('.cmdk-input');
      if (input) input.focus();
    });
  }
  function closePalette() { palette.open = false; }
  function togglePalette() { palette.open ? closePalette() : openPalette(); }

  function runCommand(cmd) {
    if (!cmd) return;
    closePalette();
    cmd.run();
  }

  function onPaletteKeydown(event) {
    const list = filteredCommands.value;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      palette.index = list.length ? (palette.index + 1) % list.length : 0;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      palette.index = list.length ? (palette.index - 1 + list.length) % list.length : 0;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runCommand(list[palette.index] || list[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    } else {
      palette.index = 0;
    }
  }

  globals.window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
      event.preventDefault();
      togglePalette();
    } else if (event.key === 'Escape' && palette.open) {
      closePalette();
    }
  });

  return { palette, filteredCommands, openPalette, closePalette, togglePalette, runCommand, onPaletteKeydown };
}
