export const agentDrawer = /* html */ `  <el-drawer v-model="agent.open" direction="rtl" size="min(1120px, 100vw)" class="agent-drawer">
    <template #header>
      <div class="agent-drawer-head">
        <div class="agent-drawer-title">
          <div class="eyebrow">Agent Console</div>
          <strong>全权控制</strong>
        </div>
        <div class="agent-drawer-head-actions">
          <span class="agent-head-note">说一句中文，它翻译成一串动作后执行</span>
          <el-tag size="small" :type="agent.running || agent.pipelineRunning ? 'warning' : (agent.pendingPlan ? 'info' : 'success')">
            {{ agent.running || agent.pipelineRunning ? '执行中' : (agent.pendingPlan ? '待确认' : '待命') }}
          </el-tag>
        </div>
      </div>
    </template>

    <div class="agent-shell">
      <section class="agent-status">
        <div class="agent-status-main">
          <div class="eyebrow">当前项目</div>
          <strong>{{ project ? project.name : '未打开项目' }}</strong>
          <span>{{ project ? '它可以直接改写这个项目的剧本、分镜、元素与设置' : '先在「项目」里打开一个项目，Agent 才能动手' }}</span>
        </div>
      </section>

      <section v-if="agent.progress.active" class="agent-progress">
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
            <el-button v-if="agent.messages.length" size="small" text @click="agent.messages.splice(0)">清空</el-button>
          </div>
          <div class="agent-chat">
            <div v-if="!agent.messages.length" class="agent-intro">
              <p class="agent-intro-lead">它能替你做的事：</p>
              <div class="agent-cap-grid">
                <div v-for="cap in AGENT_CAPABILITIES" :key="cap.title" class="agent-cap">
                  <span class="agent-cap-icon"><AppIcon :name="cap.icon" /></span>
                  <div>
                    <b>{{ cap.title }}</b>
                    <small>{{ cap.items }}</small>
                  </div>
                </div>
              </div>
              <p class="agent-intro-lead">试试这么说：</p>
              <div class="agent-examples">
                <button v-for="(example, i) in AGENT_EXAMPLES" :key="i" type="button" class="agent-example" @click="useAgentExample(example)">
                  <AppIcon name="chevron-right" />
                  <span>{{ example }}</span>
                </button>
              </div>
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
              <div class="section-title"><AppIcon name="file-text" /><span>小说原文 → 全流程</span></div>
            </div>
            <div class="agent-source-main">
              <p v-if="agent.uploadedSourceText">{{ agent.uploadedSourceName || '已上传 TXT' }}</p>
              <p v-else class="muted">未载入 TXT</p>
              <span v-if="agent.uploadedSourceText">{{ agent.uploadedSourceText.length }} 字</span>
              <small class="agent-source-hint">传一整本小说，让它从零跑完：分集 → 提取元素 → 出图 → 剧本 → 分镜。</small>
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
            <p v-if="agent.pipelineSubmitVideo" class="agent-warn">
              <AppIcon name="circle-alert" /><span>「提交视频」会真实创建生成任务并消耗额度。</span>
            </p>
            <p v-else class="agent-source-hint">不勾「提交视频」时只跑到分镜为止。</p>
          </section>

          <section class="agent-context">
            <div class="agent-panel-head">
              <div class="section-title"><AppIcon name="files" /><span>项目上下文</span></div>
            </div>
            <div class="agent-context-grid">
              <span><b>{{ scriptState.episodes.length }}</b>剧集</span>
              <span><b>{{ currentShots.length }}</b>本集镜头</span>
              <span><b>{{ counts.character }}</b>人物</span>
              <span><b>{{ counts.group + counts.scene + counts.prop + counts.effect }}</b>资产</span>
            </div>
          </section>

          <section class="agent-log">
            <div class="agent-panel-head">
              <div class="section-title"><AppIcon name="list" /><span>动作日志</span></div>
              <span v-if="agent.logs.length" class="agent-panel-count">{{ agent.logs.length }}</span>
            </div>
            <div class="agent-log-list">
              <div v-if="!agent.logs.length" class="muted agent-log-empty">它每执行一步都会记在这里。</div>
              <div v-for="(item, i) in agent.logs" :key="i" :class="['agent-log-item', item.level]">
                <span>{{ item.time }}</span>
                <p>{{ item.message }}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section v-if="agent.pendingPlan" class="agent-plan">
        <div class="agent-plan-head">
          <div class="section-title">
            <AppIcon name="list" />
            <span>这次会执行 {{ agent.pendingPlan.actions.length }} 个动作</span>
          </div>
          <div class="agent-plan-actions">
            <el-button size="small" @click="cancelAgentPendingPlan">取消</el-button>
            <el-button size="small" type="primary" :loading="agent.running" @click="runAgentPendingPlan">
              <AppIcon name="check" /><span>确认执行</span>
            </el-button>
          </div>
        </div>
        <div class="agent-plan-list">
          <div
            v-for="(action, i) in agent.pendingPlan.actions"
            :key="i"
            :class="['agent-plan-item', { 'is-risky': isRiskyAgentAction(action.type) }]"
          >
            <span class="agent-plan-no">{{ i + 1 }}</span>
            <b>{{ agentActionLabel(action.type) }}</b>
            <small>{{ action.type }}</small>
            <el-tag v-if="isRiskyAgentAction(action.type)" size="small" type="warning" effect="plain">改写数据 / 消耗额度</el-tag>
          </div>
        </div>
      </section>

      <section :class="['agent-input', { 'drag-over': agent.dragOver }]" @dragenter.prevent="agent.dragOver = true" @dragover.prevent="agent.dragOver = true" @dragleave.prevent="agent.dragOver = false" @drop.prevent="onAgentDrop">
        <div class="agent-composer-main">
          <el-input
            v-model="agent.input"
            type="textarea"
            :rows="3"
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
            <span class="agent-hint">图片附件可被直接写进元素图 / 参考图 / 角色造型 / 服装 / 角色语音</span>
          </div>
        </div>
        <div class="agent-composer-side">
          <el-button type="primary" :loading="agent.running" :disabled="(!agent.input.trim() && !agent.files.length) || !!agent.pendingPlan" @click="runAgentInstruction">
            <AppIcon name="send" /><span>生成计划</span>
          </el-button>
          <span>{{ agent.pendingPlan ? '先确认上面的计划' : '先出计划，确认后才动手' }}</span>
        </div>
      </section>
    </div>
  </el-drawer>`;
