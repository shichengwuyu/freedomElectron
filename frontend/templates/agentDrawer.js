export const agentDrawer = /* html */ `  <el-drawer v-model="agent.open" direction="rtl" size="min(1180px, 100vw)" class="agent-drawer">
    <template #header>
      <div class="agent-drawer-head">
        <div>
          <div class="eyebrow">Agent Console</div>
          <strong>全权控制</strong>
        </div>
        <div class="agent-drawer-head-actions">
          <el-tag :type="agent.running || agent.pipelineRunning ? 'warning' : 'success'" size="small">
            {{ agent.running || agent.pipelineRunning ? '执行中' : '待命' }}
          </el-tag>
        </div>
      </div>
    </template>
    <div class="agent-shell">
      <section class="agent-status">
        <div class="agent-status-main">
          <div class="eyebrow">Current Project</div>
          <strong>{{ project ? project.name : '未打开项目' }}</strong>
          <span>{{ project ? '可编辑项目数据、分镜、素材与提示词配置' : '打开项目后可执行完整控制动作' }}</span>
        </div>
        <div class="agent-status-metrics">
          <span><b>{{ agent.messages.length }}</b> 对话</span>
          <span><b>{{ agent.files.length }}</b> 附件</span>
          <span><b>{{ agent.logs.length }}</b> 日志</span>
        </div>
      </section>

      <section v-if="agent.progress.active || agent.running || agent.pipelineRunning" class="agent-progress">
        <div class="agent-progress-head">
          <strong>{{ agent.progress.label || '正在执行' }}</strong>
          <span v-if="agent.progress.total">{{ agent.progress.current }} / {{ agent.progress.total }}</span>
        </div>
        <el-progress :percentage="agent.progress.percentage" :status="agent.progress.status || ''" />
        <p v-if="agent.progress.detail">{{ agent.progress.detail }}</p>
      </section>

      <div class="agent-main">
        <section class="agent-chat-panel">
          <div class="agent-panel-head">
            <div class="section-title"><AppIcon name="sliders-horizontal" /><span>指令对话</span></div>
          </div>
          <div class="agent-chat">
            <div v-if="!agent.messages.length" class="agent-empty">
              <AppIcon name="sliders-horizontal" />
              <span>等待指令</span>
            </div>
            <div v-for="(msg, i) in agent.messages" :key="i" :class="['agent-msg', msg.role]">
              <small>{{ msg.role === 'user' ? '你' : 'Agent' }} · {{ msg.time }}</small>
              <p>{{ msg.content }}</p>
            </div>
          </div>
        </section>

        <aside class="agent-rail">
          <section class="agent-source" @dragover.prevent @drop="onAgentTxtDrop">
            <div class="agent-panel-head">
              <div class="section-title"><AppIcon name="file-text" /><span>小说原文</span></div>
            </div>
            <div class="agent-source-main">
              <p v-if="agent.uploadedSourceText">{{ agent.uploadedSourceName || '已上传 TXT' }}</p>
              <p v-else class="muted">未载入 TXT</p>
              <span v-if="agent.uploadedSourceText">{{ agent.uploadedSourceText.length }} 字</span>
            </div>
            <div class="agent-source-actions">
              <el-button size="small" @click="$event.currentTarget.nextElementSibling.click()">
                <AppIcon name="upload" /><span>TXT</span>
              </el-button>
              <input type="file" accept=".txt,text/plain" multiple hidden @change="onAgentPickTxt" />
              <el-checkbox v-model="agent.pipelineOnlyMissingImages" size="small">只补缺图</el-checkbox>
              <el-checkbox v-model="agent.pipelineSubmitVideo" size="small">提交视频</el-checkbox>
              <el-button size="small" type="primary" :loading="agent.pipelineRunning" :disabled="!agent.uploadedSourceText.trim()" @click="runAgentUploadedPipeline">
                <AppIcon name="wand-sparkles" /><span>全流程</span>
              </el-button>
              <el-button v-if="agent.uploadedSourceText" size="small" text @click="clearAgentUploadedSource">清空</el-button>
            </div>
          </section>

          <section class="agent-context">
            <div class="agent-panel-head">
              <div class="section-title"><AppIcon name="files" /><span>项目上下文</span></div>
            </div>
            <div class="agent-context-grid">
              <span><b>{{ scriptState.episodes.length }}</b>剧集</span>
              <span><b>{{ currentShots.length }}</b>镜头</span>
              <span><b>{{ counts.character }}</b>人物</span>
              <span><b>{{ counts.group + counts.scene + counts.prop + counts.effect }}</b>资产</span>
            </div>
          </section>

          <section class="agent-log">
            <div class="agent-panel-head">
              <div class="section-title"><AppIcon name="list" /><span>动作日志</span></div>
            </div>
            <div class="agent-log-list">
              <div v-if="!agent.logs.length" class="muted">暂无动作。</div>
              <div v-for="(item, i) in agent.logs" :key="i" :class="['agent-log-item', item.level]">
                <span>{{ item.time }}</span>
                <p>{{ item.message }}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section :class="['agent-input', { 'drag-over': agent.dragOver }]" @dragenter.prevent="agent.dragOver = true" @dragover.prevent="agent.dragOver = true" @dragleave.prevent="agent.dragOver = false" @drop.prevent="onAgentDrop">
        <div class="agent-composer-main">
          <el-input
            v-model="agent.input"
            type="textarea"
            :rows="4"
            resize="none"
            placeholder="例如：把第 5 个分镜改成俯拍，人物站在门口，氛围更压抑；然后保存。"
            @keydown="handleAgentInputKeydown"
          />
          <div v-if="agent.files.length" class="agent-attachments">
            <div v-for="file in agent.files" :key="file.id" class="agent-attachment">
              <img v-if="file.kind === 'image'" :src="file.previewUrl" alt="" />
              <span v-else class="agent-attachment-badge">{{ agentAttachmentLabel(file.kind) }}</span>
              <div class="agent-attachment-meta">
                <b>{{ file.name }}</b>
                <small>{{ agentAttachmentLabel(file.kind) }} · {{ formatAgentFileSize(file.size) }}</small>
              </div>
              <button type="button" @click="removeAgentFile(file.id)">×</button>
            </div>
          </div>
          <div class="agent-file-actions">
            <el-button size="small" @click="$event.currentTarget.nextElementSibling.click()">
              <AppIcon name="upload" /><span>附件</span>
            </el-button>
            <input type="file" accept="image/*,audio/*,video/*,.txt,.md,.json,.csv,.srt,.xml,.html,.css,.js,.ts,.log" multiple hidden @change="onAgentPickFile" />
            <el-button v-if="agent.files.length" size="small" text @click="clearAgentFiles">清空附件</el-button>
          </div>
        </div>
        <div class="agent-composer-side">
          <el-button type="primary" :loading="agent.running" :disabled="!agent.input.trim() && !agent.files.length" @click="runAgentInstruction">
            <AppIcon name="send" /><span>执行</span>
          </el-button>
          <span>{{ agent.files.length ? agent.files.length + ' 个附件' : '可拖拽文件' }}</span>
        </div>
      </section>
    </div>
  </el-drawer>`;
