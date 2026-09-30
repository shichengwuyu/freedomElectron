export const tasksView = /* html */ `        <template v-if="view === 'tasks'">
          <section class="page page--tasks">
            <div class="page-head">
              <div class="task-hero-pulse" aria-hidden="true">
                <span :class="['pulse-ring', { live: taskCenter.summary.running > 0 }]"></span>
                <strong>{{ taskCenter.summary.running }}</strong>
                <small>{{ taskCenter.summary.running > 0 ? '任务执行中' : '当前空闲' }}</small>
              </div>
              <div class="task-toolbar-actions">
                <el-button :loading="taskCenter.clearing" @click="clearFinishedTasks">
                  <AppIcon name="trash-2" /><span>清理已结束</span>
                </el-button>
                <el-button :loading="taskCenter.loading" @click="loadTaskCenter">
                  <AppIcon name="refresh-cw" /><span>刷新</span>
                </el-button>
              </div>
            </div>

            <div class="page-body task-board">
              <aside class="panel task-side">
              <div class="panel-body">
              <div class="task-status-rail" aria-label="任务状态筛选">
                <button :class="['task-status-item', 'is-all', { on: taskCenter.filter === 'all' }]" @click="setTaskFilter('all')">
                  <strong>{{ taskCenter.summary.total }}</strong><span>全部</span>
                </button>
                <button :class="['task-status-item', 'is-running', { on: taskCenter.filter === 'running' }]" @click="setTaskFilter('running')">
                  <strong>{{ taskCenter.summary.running }}</strong><span>执行中</span>
                </button>
                <button :class="['task-status-item', 'is-queued', { on: taskCenter.filter === 'queued' }]" @click="setTaskFilter('queued')">
                  <strong>{{ taskCenter.summary.queued }}</strong><span>等待中</span>
                </button>
                <button :class="['task-status-item', 'is-paused', { on: taskCenter.filter === 'paused' }]" @click="setTaskFilter('paused')">
                  <strong>{{ taskCenter.summary.paused }}</strong><span>已暂停</span>
                </button>
                <button :class="['task-status-item', 'is-failed', { on: taskCenter.filter === 'failed' }]" @click="setTaskFilter('failed')">
                  <strong>{{ taskCenter.summary.failed }}</strong><span>失败</span>
                </button>
                <button :class="['task-status-item', 'is-cancelled', { on: taskCenter.filter === 'cancelled' }]" @click="setTaskFilter('cancelled')">
                  <strong>{{ taskCenter.summary.cancelled }}</strong><span>已取消</span>
                </button>
                <button :class="['task-status-item', 'is-done', { on: taskCenter.filter === 'done' }]" @click="setTaskFilter('done')">
                  <strong>{{ taskCenter.summary.done }}</strong><span>已完成</span>
                </button>
              </div>
              </div>
              </aside>

              <section class="panel task-feed-panel">
              <div class="panel-head">
                <div class="page-head-copy"><p>任务持久保存；应用重启后，未完成任务进入暂停状态，可随时重试。</p></div>
              </div>
              <div class="panel-body">
              <section class="task-feed" aria-live="polite">
                <div v-if="taskCenter.loading && !taskCenter.tasks.length" class="empty-state">
                  <AppIcon name="loader-circle" /><span>正在加载任务…</span>
                </div>
                <div v-else-if="!filteredTasks().length" class="empty-state">
                  <AppIcon name="list" />
                  <span>{{ taskCenter.filter === 'all' ? '暂无任务，生成剧本 / 出图 / 视频时会在这里排队' : '该状态下暂无任务' }}</span>
                </div>
                <template v-else>
                  <article v-for="task in filteredTasks()" :key="task.id" :class="['task-row', 'status-' + task.status]">
                    <span class="task-status-bar" aria-hidden="true"></span>
                    <div class="task-main">
                      <div class="task-title-row">
                        <strong>{{ task.title }}</strong>
                        <el-tag size="small" :type="taskStatusType(task.status)">{{ taskStatusLabel(task.status) }}</el-tag>
                        <small class="task-time">{{ formatTaskTime(task.updatedAt || task.createdAt) }}</small>
                      </div>
                      <p>{{ task.message || task.error || task.submitId || '暂无详情' }}</p>
                      <div v-if="task.progressTotal" class="task-progress">
                        <div class="script-progress-head">
                          <span>{{ task.progressLabel || '任务进度' }} {{ task.progressCurrent }} / {{ task.progressTotal }}</span>
                          <small>{{ task.progressPercentage }}%</small>
                        </div>
                        <el-progress :percentage="task.progressPercentage" :stroke-width="8" :show-text="false" />
                      </div>
                      <div class="task-meta">
                        <span>{{ task.source }}</span>
                        <span v-if="task.providerLabel">{{ task.providerLabel }}</span>
                        <span v-if="task.projectName || task.projectId">项目 {{ task.projectName || task.projectId }}</span>
                        <span v-if="task.episodeId !== ''">第 {{ task.episodeId }} 集</span>
                        <span v-if="task.shotNo !== ''">镜头 {{ task.shotNo }}</span>
                        <span v-if="task.total !== '' && !task.progressTotal" class="task-meta-progress">进度 {{ task.processed || task.submitted || 0 }} / {{ task.total }}</span>
                      </div>
                    </div>
                    <div class="task-actions">
                      <el-button
                        v-if="canLocateTask(task)"
                        class="task-locate-action"
                        size="small"
                        type="primary"
                        plain
                        :loading="locatingTaskId === task.id"
                        :disabled="!!locatingTaskId && locatingTaskId !== task.id"
                        :aria-label="taskLocationLabel(task) + '：' + task.title"
                        @click="locateTask(task)"
                      ><AppIcon name="map-pin" /><span>{{ taskLocationLabel(task) }}</span></el-button>
                      <el-button
                        v-if="task.canCancel"
                        size="small"
                        type="warning"
                        plain
                        :loading="taskActionLoading(task, 'cancel')"
                        :aria-label="'取消任务：' + task.title"
                        @click="performTaskAction(task, 'cancel')"
                      ><AppIcon name="x" /><span>取消</span></el-button>
                      <el-button
                        v-if="task.canRetry"
                        size="small"
                        type="primary"
                        plain
                        :loading="taskActionLoading(task, 'retry')"
                        :aria-label="'重试任务：' + task.title"
                        @click="performTaskAction(task, 'retry')"
                      ><AppIcon name="rotate-cw" /><span>重试</span></el-button>
                      <el-button
                        v-if="task.canRemove"
                        size="small"
                        type="danger"
                        plain
                        :loading="taskActionLoading(task, 'remove')"
                        :aria-label="'移除任务：' + task.title"
                        @click="performTaskAction(task, 'remove')"
                      ><AppIcon name="trash-2" /><span>移除</span></el-button>
                    </div>
                  </article>
                </template>
              </section>
              </div>
              </section>
            </div>
          </section>
        </template>`;
