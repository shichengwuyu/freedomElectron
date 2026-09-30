export const projectsView = /* html */ `        <template v-if="view === 'projects'">
          <section class="page page--projects">
            <div class="page-head projects-head">
              <div class="create-box">
                <el-input v-model="newProjectName" size="large" placeholder="给新项目起个名字…" clearable @keyup.enter="createProject" />
                <el-button type="primary" size="large" :loading="creating" @click="createProject">
                  <AppIcon name="plus" /><span>开拍</span>
                </el-button>
                <el-button type="warning" size="large" plain @click="openAutoPipelineDialog">
                  <AppIcon name="wand-sparkles" /><span>一键生成</span>
                </el-button>
              </div>
              <div class="backup-actions">
                <el-button size="small" text :loading="projectPackageImporting" @click="$refs.projectPackageInput.click()">
                  <AppIcon name="upload" /><span>导入项目包</span>
                </el-button>
                <input
                  ref="projectPackageInput"
                  class="visually-hidden-file-input"
                  type="file"
                  accept=".zip,application/zip,application/vnd.yanzhi.project+zip"
                  multiple
                  aria-label="选择Freedom项目包"
                  @change="importProjectPackages"
                />
                <el-button size="small" text @click="exportBackup"><AppIcon name="download" /><span>整库备份</span></el-button>
                <el-button size="small" text :loading="backupImporting" @click="$refs.projectBackupInput.click()">
                  <AppIcon name="upload" /><span>恢复整库</span>
                </el-button>
                <input
                  ref="projectBackupInput"
                  class="visually-hidden-file-input"
                  type="file"
                  accept=".zip,application/zip"
                  aria-label="选择Freedom备份 ZIP"
                  @change="importBackup"
                />
              </div>
            </div>

            <div class="stat-strip" aria-label="活跃项目统计">
              <div class="stat-tile is-accent"><strong>{{ overviewProjects.length }}</strong><span>活跃项目</span></div>
              <div class="stat-tile"><strong>{{ activeProjectOverviewStats.character }}</strong><span>人物</span></div>
              <div class="stat-tile"><strong>{{ activeProjectOverviewStats.scene }}</strong><span>场景</span></div>
              <div class="stat-tile"><strong>{{ activeProjectOverviewStats.episodes }}</strong><span>剧集</span></div>
              <div class="stat-tile"><strong>{{ activeProjectOverviewStats.storyboards }}</strong><span>分镜</span></div>
            </div>

            <div class="page-body">
              <section class="panel projects-panel">
                <div class="panel-head">
                  <div class="project-library-tabs" role="tablist" aria-label="项目分区">
                    <button
                      role="tab"
                      :aria-selected="projectSection === 'active'"
                      :class="{ active: projectSection === 'active' }"
                      @click="selectProjectSection('active')"
                    ><AppIcon name="folder-open" /><span>活跃</span></button>
                    <button
                      role="tab"
                      :aria-selected="projectSection === 'archived'"
                      :class="{ active: projectSection === 'archived' }"
                      @click="selectProjectSection('archived')"
                    ><AppIcon name="box" /><span>已归档</span></button>
                    <button
                      role="tab"
                      :aria-selected="projectSection === 'trash'"
                      :class="{ active: projectSection === 'trash' }"
                      @click="selectProjectSection('trash')"
                    ><AppIcon name="trash-2" /><span>回收站</span></button>
                  </div>

                  <div class="library-tools toolbar">
                    <el-input
                      v-if="projectSection !== 'trash'"
                      v-model="projectSearch"
                      clearable
                      placeholder="搜索名称 / ID / 描述"
                      aria-label="搜索项目"
                      class="library-search"
                    ><template #prefix><AppIcon name="search" /></template></el-input>
                    <el-select v-if="projectSection !== 'trash'" v-model="projectSort" aria-label="项目排序" class="library-sort">
                      <el-option label="最近更新" value="updated" />
                      <el-option label="最近打开" value="recent" />
                      <el-option label="名称" value="name" />
                      <el-option label="创建时间" value="created" />
                    </el-select>
                    <el-button
                      v-if="projectSection !== 'trash'"
                      :type="projectSelectionMode ? 'primary' : ''"
                      plain
                      @click="toggleProjectSelectionMode"
                    ><AppIcon name="check" /><span>{{ projectSelectionMode ? '退出批量选择' : '批量导出' }}</span></el-button>
                    <el-button
                      v-if="projectSection === 'trash'"
                      type="danger"
                      plain
                      :disabled="!deletedProjects.length"
                      @click="emptyProjectTrash"
                    ><AppIcon name="trash-2" /><span>清空回收站</span></el-button>
                    <el-button
                      circle
                      :loading="projectSection === 'trash' ? loadingTrash : loadingProjects"
                      aria-label="刷新当前项目列表"
                      @click="projectSection === 'trash' ? loadDeletedProjects() : loadProjects()"
                    ><AppIcon name="refresh-cw" /></el-button>
                  </div>
                </div>

            <div v-if="projectSelectionMode && projectSection !== 'trash'" class="project-batch-bar" aria-live="polite">
              <span><AppIcon name="check" /><b>已选 {{ selectedProjectCount }} 个项目</b></span>
              <div>
                <el-button size="small" @click="selectAllFilteredProjects">
                  {{ allFilteredProjectsSelected ? '取消全选' : '全选当前列表' }}
                </el-button>
                <el-button size="small" type="primary" :disabled="!selectedProjectCount" @click="exportSelectedProjects">
                  <AppIcon name="download" /><span>导出所选项目</span>
                </el-button>
              </div>
            </div>

            <div class="panel-body panel-body--pad">
            <template v-if="projectSection !== 'trash'">
              <div v-if="loadingProjects" class="poster-grid" aria-live="polite" aria-busy="true">
                <div v-for="i in 4" :key="'sk'+i" class="poster-card is-skeleton">
                  <div class="poster-cover"></div>
                  <div class="poster-body"><i></i><i></i></div>
                </div>
              </div>
              <div v-else-if="!filteredProjects.length" class="empty-state">
                <AppIcon name="folder" />
                <span>{{ projectSearch ? '没有匹配的项目' : (projectSection === 'archived' ? '暂无归档项目' : '片场还空着，写下第一个项目名，开拍') }}</span>
              </div>
              <template v-else>
              <div class="poster-grid">
                <article
                  v-for="p in renderedProjects"
                  :key="p.id"
                  :class="['poster-card', { 'is-selecting': projectSelectionMode, 'is-selected': isProjectSelected(p.id) }]"
                  :role="projectSelectionMode ? 'checkbox' : 'button'"
                  :aria-checked="projectSelectionMode ? isProjectSelected(p.id) : undefined"
                  tabindex="0"
                  :aria-label="(projectSelectionMode ? '选择项目：' : '打开项目：') + (p.name || p.id)"
                  @click="projectSelectionMode ? toggleProjectSelection(p.id) : openProject(p.id)"
                  @keydown="openProjectFromKeyboard($event, p.id, projectSelectionMode ? toggleProjectSelection : openProject)"
                >
                  <div :class="['poster-cover', { 'has-image': p.cover }]">
                    <label v-if="projectSelectionMode" class="poster-selector" @click.stop>
                      <el-checkbox
                        :model-value="isProjectSelected(p.id)"
                        :aria-label="'选择项目：' + (p.name || p.id)"
                        @change="setProjectSelected(p.id, $event)"
                      />
                    </label>
                    <img v-if="p.cover" class="poster-cover-img" :src="p.cover" alt="" loading="lazy" decoding="async" fetchpriority="low" />
                    <span v-if="!p.cover" class="poster-monogram" aria-hidden="true">{{ (p.name || p.id || '?').trim().charAt(0).toUpperCase() }}</span>
                    <span v-else class="poster-monogram poster-monogram-badge" aria-hidden="true">{{ (p.name || p.id || '?').trim().charAt(0).toUpperCase() }}</span>
                    <span class="poster-beam" aria-hidden="true"></span>
                    <el-tag v-if="p.archivedAt" size="small" type="info" class="poster-flag">已归档</el-tag>
                    <div v-if="!projectSelectionMode" class="poster-quick" @click.stop>
                      <button class="poster-quick-btn" title="重命名" @click="renameProject(p, $event)"><AppIcon name="pen-line" /></button>
                      <button class="poster-quick-btn" title="复制项目" @click="duplicateProject(p, $event)"><AppIcon name="copy" /></button>
                      <button class="poster-quick-btn" title="导出项目包" @click="exportProjectPackage(p, $event)"><AppIcon name="download" /></button>
                      <button class="poster-quick-btn" title="版本历史" @click="showProjectSnapshots(p, $event)"><AppIcon name="clock" /></button>
                      <button class="poster-quick-btn" :title="p.archivedAt ? '取消归档' : '归档'" @click="toggleProjectArchive(p, !p.archivedAt, $event)"><AppIcon name="box" /></button>
                      <button class="poster-quick-btn is-danger" title="移入回收站" @click="delProject(p.id, $event)"><AppIcon name="trash-2" /></button>
                    </div>
                    <div v-if="!projectSelectionMode" class="poster-open-hint"><AppIcon name="folder-open" /><span>进入片场</span></div>
                  </div>
                  <div class="poster-body">
                    <div class="poster-heading">
                      <h3>{{ p.name || p.id }}</h3>
                      <p v-if="p.description" class="poster-desc">{{ p.description }}</p>
                      <p v-else class="poster-desc poster-desc-id">{{ p.id }}</p>
                    </div>
                    <div class="poster-stats">
                      <span :class="{ 'is-zero': !(p.counts?.episodes) }"><b>{{ p.counts?.episodes || 0 }}</b>剧集</span>
                      <span :class="{ 'is-zero': !(p.counts?.storyboards) }"><b>{{ p.counts?.storyboards || 0 }}</b>分镜</span>
                      <span :class="{ 'is-zero': !(p.counts?.character) }"><b>{{ p.counts?.character || 0 }}</b>人物</span>
                      <span :class="{ 'is-zero': !((p.counts?.scene || 0) + (p.counts?.prop || 0) + (p.counts?.effect || 0)) }"><b>{{ (p.counts?.scene || 0) + (p.counts?.prop || 0) + (p.counts?.effect || 0) }}</b>资产</span>
                    </div>
                    <div class="poster-foot">
                      <span class="poster-foot-time">更新 {{ formatProjectTime(p.updatedAt || p.createdAt) }}</span>
                      <span class="poster-storage">占用 {{ formatProjectSize(p.sizeBytes) }}</span>
                      <span v-if="recentAt(p.id)" class="poster-foot-recent">打开 {{ formatProjectTime(recentAt(p.id)) }}</span>
                    </div>
                  </div>
                </article>
              </div>
              <div
                v-if="hasMoreRenderedProjects"
                v-progressive-render="loadMoreProjects"
                class="progressive-render-sentinel"
                aria-hidden="true"
              ></div>
              </template>
            </template>

            <template v-else>
              <div v-if="loadingTrash" class="empty-state" aria-live="polite">
                <AppIcon name="loader-circle" /><span>正在加载回收站…</span>
              </div>
              <div v-else-if="!deletedProjects.length" class="empty-state">
                <AppIcon name="trash-2" /><span>回收站为空</span>
              </div>
              <div v-else class="trash-project-list">
                <article v-for="item in deletedProjects" :key="item.trashId" class="trash-project-row">
                  <div class="trash-project-main">
                    <div class="project-icon small"><AppIcon name="folder" /></div>
                    <div>
                      <strong>{{ item.name || item.projectId }}</strong>
                      <p>{{ item.projectId }} · 删除于 {{ formatProjectTime(item.deletedAt) }}</p>
                      <small>人物 {{ item.counts?.character || 0 }} · 群像 {{ item.counts?.group || 0 }} · 场景 {{ item.counts?.scene || 0 }} · 道具 {{ item.counts?.prop || 0 }} · 特效 {{ item.counts?.effect || 0 }} · 妖兽 {{ item.counts?.creature || 0 }}</small>
                      <small class="trash-project-size">占用空间 {{ formatProjectSize(item.sizeBytes) }}</small>
                    </div>
                  </div>
                  <div class="trash-project-actions">
                    <el-button type="primary" plain @click="restoreDeletedProject(item)"><AppIcon name="rotate-ccw" /><span>恢复</span></el-button>
                    <el-button type="danger" plain @click="purgeDeletedProject(item)"><AppIcon name="trash-2" /><span>永久删除</span></el-button>
                  </div>
                </article>
              </div>
            </template>
                </div>
              </section>
            </div>
          </section>

          <el-dialog v-model="snapshots.visible" :title="'版本历史 · ' + snapshots.projectName" width="min(760px, 92vw)" append-to-body>
            <div v-loading="snapshots.loading" class="snapshot-list">
              <div v-if="!snapshots.loading && !snapshots.items.length" class="empty-state small">暂无可恢复的历史版本</div>
              <article v-for="item in snapshots.items" :key="item.id" class="snapshot-row">
                <div>
                  <strong>{{ formatProjectTime(item.createdAt) }}</strong>
                  <p>人物 {{ item.counts?.character || 0 }} · 场景 {{ item.counts?.scene || 0 }} · 剧集 {{ item.counts?.episodes || 0 }} · 分镜 {{ item.counts?.storyboards || 0 }}</p>
                  <small>{{ Math.max(1, Math.round((item.bytes || 0) / 1024)) }} KB · {{ item.id }}</small>
                </div>
                <el-button type="primary" plain @click="restoreProjectSnapshot(item)"><AppIcon name="rotate-ccw" /><span>恢复此版本</span></el-button>
              </article>
            </div>
          </el-dialog>

          <!-- 一键全自动生成：配置 -->
          <el-dialog v-model="autoPipeline.visible" title="⚡ 一键全自动生成" width="min(640px, 94vw)" append-to-body :close-on-click-modal="!autoPipeline.running">
            <template v-if="!autoPipeline.running && !autoPipeline.finished">
              <el-form label-position="top">
                <el-form-item label="创建方式">
                  <el-radio-group v-model="autoPipeline.mode">
                    <el-radio-button value="new">新建项目</el-radio-button>
                    <el-radio-button value="resume">续跑已有项目</el-radio-button>
                  </el-radio-group>
                </el-form-item>
                <el-form-item v-if="autoPipeline.mode === 'resume'" label="选择要续跑的项目">
                  <el-select v-model="autoPipeline.resumeProjectId" filterable placeholder="选择项目（已有产出会自动跳过）">
                    <el-option v-for="p in autoPipeline.projectOptions" :key="p.id" :label="p.name" :value="p.id" />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="autoPipeline.mode === 'new'" label="项目名称">
                  <el-input v-model="autoPipeline.form.name" placeholder="给新项目起个名字（重名会自动加后缀）" clearable />
                </el-form-item>
                <el-form-item label="剧本文本（粘贴原文或上传 .txt 小说文件，至少 50 字）">
                  <div style="width:100%; display:flex; gap:8px; align-items:center; margin-bottom:6px;">
                    <el-button size="small" plain @click="$refs.autoPipelineScriptInput.click()">
                      <AppIcon name="upload" /><span>上传小说 .txt</span>
                    </el-button>
                    <input
                      ref="autoPipelineScriptInput"
                      class="visually-hidden-file-input"
                      type="file"
                      accept=".txt,text/plain"
                      aria-label="选择小说txt文件"
                      @change="handleScriptFile($event.target.files); $event.target.value = ''"
                    />
                    <span v-if="autoPipeline.form.scriptText" class="muted">已填入 {{ autoPipeline.form.scriptText.length }} 字</span>
                  </div>
                  <el-input v-model="autoPipeline.form.scriptText" type="textarea" :rows="8" placeholder="把小说或剧本文本整段粘贴到这里，或点击上方按钮上传 txt 文件…" />
                </el-form-item>
                <el-form-item label="全局画风">
                  <el-radio-group v-model="autoPipeline.form.style">
                    <el-radio-button v-for="item in autoPipeline.styleOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
                  </el-radio-group>
                </el-form-item>
                <el-form-item label="每集目标时长（分钟，AI 分集后逐集按此估算镜头数）">
                  <el-input-number v-model="autoPipeline.form.episodeMinutes" :min="1" :max="30" /> <span class="muted">≈ 每集 {{ autoPipelineTargetShots }} 个镜头（单镜 {{ shotSeconds }}s）<template v-if="autoPipelineCostEstimate"> · 预估视频成本 {{ autoPipelineCostEstimate }}</template><template v-else> · 在视频设置填「单价/秒」后显示成本预估</template></span>
                </el-form-item>
                <el-form-item label="剧本/分镜并行数（1-5，默认 2 最稳；过高可能触发文本模型限流）">
                  <el-input-number v-model="autoPipeline.form.storyboardConcurrency" :min="1" :max="5" :step="1" step-strictly controls-position="right" style="width:130px" />
                </el-form-item>
                <el-form-item label="出图元素类型">
                  <el-checkbox-group v-model="autoPipeline.form.categories">
                    <el-checkbox v-for="item in autoPipeline.categoryOptions" :key="item.key" :label="item.key">{{ item.label }}</el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
                <p class="muted">流程：创建项目 → AI 智能分集（自动识别章节）→ 元素提取 → 批量出图 → 逐集剧本/分镜 → 串行视频（自动拉回）→ 导出成片到「下载/Freedom成片/&lt;项目名&gt;/」。视频或单集失败自动跳过继续，环节失败保留断点。</p>
              </el-form>
            </template>

            <!-- 运行中 / 完成 -->
            <template v-else>
              <el-progress :percentage="autoPipeline.percent" :status="autoPipeline.finished ? (autoPipeline.failures.length ? 'warning' : 'success') : undefined" />
              <p class="muted">{{ autoPipeline.running ? ('当前阶段：' + (autoPipeline.stageLabel || '准备中')) : (autoPipeline.finished ? '流水线已结束' : '') }}</p>
              <div class="auto-pipeline-stages">
                <el-tag
                  v-for="(stage, i) in autoPipelineStages"
                  :key="stage.key"
                  :type="i < autoPipeline.stageIndex || autoPipeline.finished ? (autoPipeline.failures.some(f => f.stage === stage.label) ? 'danger' : 'success') : (i === autoPipeline.stageIndex ? 'warning' : 'info')"
                  size="small"
                  style="margin: 0 6px 6px 0"
                >{{ stage.label }}</el-tag>
              </div>
              <div class="auto-pipeline-logs">
                <p v-for="(line, i) in autoPipeline.logs.slice(-200)" :key="i" :class="['auto-pipeline-log', 'is-' + line.kind]">
                  <small>{{ line.time }}</small> {{ line.text }}
                </p>
              </div>
              <div v-if="autoPipeline.failures.length" class="auto-pipeline-failures">
                <p v-for="(f, i) in autoPipeline.failures" :key="i"><b>〔{{ f.stage }}〕</b>{{ f.error }}</p>
              </div>
              <div v-if="autoPipeline.finished && autoPipeline.result.exportDir" class="auto-pipeline-export">
                <AppIcon name="folder-open" />
                <span>成片已导出（{{ autoPipeline.result.exported }} 个）：{{ autoPipeline.result.exportDir }}</span>
              </div>
            </template>

            <template #footer>
              <template v-if="!autoPipeline.running && !autoPipeline.finished">
                <el-button @click="autoPipeline.visible = false">取消</el-button>
                <el-button type="primary" @click="runAutoPipeline"><AppIcon name="wand-sparkles" /><span>开始全自动生成</span></el-button>
              </template>
              <template v-else>
                <el-button v-if="autoPipeline.running" type="danger" plain @click="stopAutoPipeline">停止</el-button>
                <el-button v-if="autoPipeline.running" @click="autoPipeline.visible = false">后台运行</el-button>
                <el-button v-if="!autoPipeline.running && autoPipeline.result.exportDir" @click="openExportDir"><AppIcon name="folder-open" /><span>打开成片文件夹</span></el-button>
                <el-button v-if="!autoPipeline.running" type="primary" @click="autoPipeline.visible = false">完成</el-button>
              </template>
            </template>
          </el-dialog>
        </template>`;
