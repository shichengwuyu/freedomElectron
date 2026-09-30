import { agentDrawer } from './templates/agentDrawer.js';
import { chatView } from './templates/chatView.js';
import { canvasView } from './templates/canvasView.js';
import { characterLibraryDialog } from './templates/characterLibraryDialog.js';
import { coverStudioView } from './templates/coverStudioView.js';
import { videoSplitView } from './templates/videoSplitView.js';
import { dialogsAndOverlays } from './templates/dialogsAndOverlays.js';
import { elementsDrawer } from './templates/elementsDrawer.js';
import { legalAgreement } from './templates/legalAgreement.js';
import { novelView } from './templates/novelView.js';
import { projectsView } from './templates/projectsView.js';
import { qualityCenterDialog } from './templates/qualityCenterDialog.js';
import { referenceStudioDialog } from './templates/referenceStudioDialog.js';
import { settingsView } from './templates/settingsView.js';
import { tasksView } from './templates/tasksView.js';
import { workspaceView } from './templates/workspaceView.js';

export const template = /* html */ `
<el-config-provider>
  <div class="desktop-titlebar" aria-label="Freedom 窗口标题栏">
    <span class="desktop-titlebar-mark"><AppIcon name="tv" /></span>
    <span>Freedom</span>
  </div>
${legalAgreement}

  <main v-else-if="view === 'loading'" class="boot-screen">
    <section class="boot-panel">
      <div class="brand-mark"><AppIcon name="tv" /></div>
      <div>
        <div class="eyebrow">Freedom · Molten Gold</div>
        <h1>Freedom 创作工作台</h1>
        <p class="muted">正在点亮暗房：载入项目、元素库与模型配置…</p>
      </div>
      <el-progress :percentage="60" :indeterminate="true" />
    </section>
  </main>

  <section v-else :class="['studio-shell', { 'is-workspace': view === 'workspace', 'is-chat': view === 'chat', 'is-canvas': view === 'canvas', 'is-cover': view === 'cover', 'is-split': view === 'split', 'is-page-locked': view === 'projects' || view === 'tasks' || view === 'cover' || view === 'split' || view === 'settings' || (view === 'canvas' && canvasLibrary.screen === 'library') }]">
    <aside class="side-rail" aria-label="主要导航">
      <div class="rail-brand" role="button" tabindex="0" aria-label="回到项目控制台" @click="view = 'projects'" @keydown.enter="view = 'projects'">
        <div class="brand-mark"><AppIcon name="tv" /></div>
        <span>Freedom</span>
      </div>
      <nav class="rail-nav" aria-label="视图切换">
        <div class="rail-group">
          <div class="rail-group-title">创作</div>
          <button :class="['rail-item', { active: view === 'projects' || view === 'workspace' }]" @click="openProjectArea">
            <span class="rail-item-icon"><AppIcon name="folder" /></span>
            <span class="rail-item-label">项目</span>
          </button>
          <button :class="['rail-item', { active: view === 'novel' }]" @mousedown.capture.prevent="rememberWorkspacePosition" @click="leaveWorkspace('novel')">
            <span class="rail-item-icon"><AppIcon name="pen-line" /></span>
            <span class="rail-item-label">写小说</span>
          </button>
          <button :class="['rail-item', { active: view === 'canvas' }]" @mousedown.capture.prevent="rememberWorkspacePosition" @click="leaveWorkspace('canvas')">
            <span class="rail-item-icon"><AppIcon name="layout-dashboard" /></span>
            <span class="rail-item-label">画布</span>
          </button>
        </div>

        <div class="rail-group">
          <div class="rail-group-title">工具</div>
          <button :class="['rail-item', { active: view === 'cover' }]" @click="openCoverStudio">
            <span class="rail-item-icon"><AppIcon name="image" /></span>
            <span class="rail-item-label">封面生成</span>
          </button>
          <button :class="['rail-item', { active: view === 'split' }]" @click="openVideoSplitStudio">
            <span class="rail-item-icon"><AppIcon name="scissors" /></span>
            <span class="rail-item-label">一键切割</span>
          </button>
        </div>

        <div class="rail-group">
          <div class="rail-group-title">系统</div>
          <button :class="['rail-item', { active: view === 'tasks' }]" @mousedown.capture.prevent="rememberWorkspacePosition" @click="leaveWorkspace('tasks')">
            <span class="rail-item-icon">
              <AppIcon name="list" />
              <i v-if="taskCenter.summary.running > 0" class="rail-live-dot" :title="taskCenter.summary.running + ' 个任务执行中'"></i>
            </span>
            <span class="rail-item-label">任务中心</span>
          </button>
          <button :class="['rail-item', { active: view === 'settings' }]" @mousedown.capture.prevent="rememberWorkspacePosition" @click="leaveWorkspace('settings')">
            <span class="rail-item-icon"><AppIcon name="settings" /></span>
            <span class="rail-item-label">设置</span>
          </button>
        </div>

        <div class="rail-group rail-group-plain">
          <button :class="['rail-item', { active: view === 'chat' }]" @mousedown.capture.prevent="rememberWorkspacePosition" @click="leaveWorkspace('chat')">
            <span class="rail-item-icon"><AppIcon name="message-circle" /></span>
            <span class="rail-item-label">聊天</span>
          </button>
        </div>
      </nav>
      <div class="rail-foot">
        <el-dropdown class="rail-theme-menu" placement="right-end" trigger="click" @command="setThemePreference">
          <button class="rail-item" :title="'界面主题：' + themePreferenceLabel" aria-label="切换界面主题">
            <span class="rail-item-icon">
              <el-icon><Monitor v-if="themeIcon === 'Monitor'" /><Moon v-else-if="themeIcon === 'Moon'" /><Sunny v-else-if="themeIcon === 'Sunny'" /><ColdDrink v-else-if="themeIcon === 'ColdDrink'" /><Cherry v-else-if="themeIcon === 'Cherry'" /><Ship v-else-if="themeIcon === 'Ship'" /><Sugar v-else-if="themeIcon === 'Sugar'" /><Brush v-else-if="themeIcon === 'Brush'" /><UserFilled v-else-if="themeIcon === 'Female' || themeIcon === 'Male' || themeIcon === 'User'" /><View v-else-if="themeIcon === 'View'" /><MagicStick v-else /></el-icon>
            </span>
            <span class="rail-item-label">主题</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu class="theme-dropdown">
              <el-dropdown-item v-for="item in themeOptions" :key="item.value" :command="item.value" :class="{ 'is-selected': themePreference === item.value }">
                <span class="theme-dropdown-swatches"><i v-for="color in item.swatches" :key="color" :style="{ backgroundColor: color }"></i></span>
                <span>{{ item.label }}</span>
                <AppIcon name="check" />
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button :class="['rail-item', 'rail-agent', { active: agent.open }]" @click="openAgent" title="Agent 全权控制台">
          <span class="rail-item-icon"><AppIcon name="sliders-horizontal" /></span>
          <span class="rail-item-label">Agent</span>
        </button>
      </div>
    </aside>

    <section class="studio-main">
      <header v-if="view !== 'chat' && view !== 'canvas' && view !== 'cover' && view !== 'split'" class="studio-topbar">
        <div class="topbar-title">
          <el-button v-if="view === 'workspace'" class="topbar-back" @click="backToProjects">
            <AppIcon name="arrow-left" /><span>项目</span>
          </el-button>
          <div class="title-stack">
            <div class="eyebrow">{{ view === 'workspace' ? 'Workspace' : 'Freedom' }}</div>
            <h1 v-if="view === 'projects'">项目控制台</h1>
            <h1 v-else-if="view === 'tasks'">任务中心</h1>
            <h1 v-else-if="view === 'settings'">模型与偏好</h1>
            <h1 v-else-if="view === 'novel'">写小说</h1>
            <h1 v-else>{{ project ? project.name : '创作工作台' }}</h1>
          </div>
        </div>

        <div class="topbar-right">
          <button class="cmdk-trigger" @click="openPalette" title="快速跳转 (Ctrl+K)">
            <AppIcon name="search" />
            <span>快速跳转</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div v-if="view === 'workspace' && project" class="topbar-context">
            <span><b>{{ scriptState.episodes.length }}</b>剧集</span>
            <span><b>{{ counts.character }}</b>人物</span>
            <span><b>{{ counts.group + counts.scene + counts.prop + counts.effect }}</b>资产</span>
          </div>
        </div>
      </header>

      <main id="main-content" class="content-stage" tabindex="-1">
${chatView}

${canvasView}

${projectsView}

${coverStudioView}

${videoSplitView}

${tasksView}

${novelView}

${workspaceView}

${settingsView}
      </main>
    </section>
  </section>

${elementsDrawer}
${characterLibraryDialog}

${agentDrawer}

${dialogsAndOverlays}
${qualityCenterDialog}
${referenceStudioDialog}
</el-config-provider>
`;
