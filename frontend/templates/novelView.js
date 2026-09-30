export const novelView = /* html */ `        <template v-if="view === 'novel' || novelMounted">
          <section :class="['novel-page', { 'is-parked': view !== 'novel' }]">

            <!-- ============ 书城书架 ============ -->
            <template v-if="novelUi.screen === 'library'">
              <section class="novel-hall">
                <div class="novel-hall-head">
                  <div>
                    <div class="eyebrow">Hongguo Story Engine</div>
                    <h2>小说工坊</h2>
                    <p class="muted">想法进，成书出：AI 起名、写简介、画封面、黄金三章开局、伏笔全程记账，一路写到大结局。</p>
                  </div>
                  <div class="novel-hall-side">
                    <el-input v-model="novelUi.filter" size="small" clearable placeholder="搜索书名/题材" class="novel-hall-filter" />
                    <el-button type="primary" size="large" class="novel-create-cta" @click="openNovelCreationChat">
                      <AppIcon name="wand-sparkles" /><span>创作新作品</span>
                    </el-button>
                  </div>
                </div>

                <div v-if="filteredNovelWorks.length" class="novel-bookwall">
                  <article v-for="work in filteredNovelWorks" :key="work.id" class="book-card" tabindex="0"
                           :aria-label="'打开作品：' + work.title"
                           @click="openNovelWork(work.id)" @keydown.enter="openNovelWork(work.id)">
                    <div class="book-cover">
                      <img v-if="work.coverUrl" :src="work.coverUrl" :alt="work.title + ' 封面'" loading="lazy" />
                      <div v-else class="book-cover-blank">
                        <span class="book-cover-title">{{ work.title }}</span>
                        <span class="book-cover-genre">{{ work.genre || '未定题材' }}</span>
                      </div>
                      <span class="book-badge" :class="work.channel">{{ work.channel === 'female' ? '女频' : '男频' }}</span>
                      <div class="book-progress" v-if="work.chaptersTotal">
                        <i :style="{ width: Math.min(100, Math.round((work.chaptersDone / work.chaptersTotal) * 100)) + '%' }"></i>
                      </div>
                    </div>
                    <div class="book-meta">
                      <b>{{ work.title }}</b>
                      <small>{{ work.genre || '未定题材' }} · 目标{{ work.wordTargetWan }}万字</small>
                      <em v-if="work.wordsWritten">{{ work.chaptersDone }}/{{ work.chaptersTotal }}章 · 已写{{ (work.wordsWritten / 10000).toFixed(1) }}万字</em>
                      <em v-else-if="work.setup?.complete">蓝图就绪 · 等待开写</em>
                      <em v-else>建书中 · {{ work.setup?.completed || 0 }}/{{ work.setup?.total || 7 }}</em>
                    </div>
                    <div class="book-actions" @click.stop>
                      <el-button text size="small" title="导出 TXT" @click="exportNovelTxt(work)"><AppIcon name="download" /></el-button>
                      <el-button text type="danger" size="small" :title="'删除作品：' + work.title" :loading="novelGenerating.deletingId === work.id" @click="deleteNovelWork(work.id)"><AppIcon name="trash-2" /></el-button>
                    </div>
                  </article>
                </div>
                <div v-else class="novel-hall-empty">
                  <AppIcon name="book-open" />
                  <p>{{ novelUi.filter ? '没有匹配的作品' : '书架还空着 —— 点「创作新作品」，一个想法就能开一本书' }}</p>
                </div>
              </section>
            </template>

            <!-- ============ 写作台 ============ -->
            <template v-else-if="novelUi.screen === 'desk' && activeNovel">
              <section class="novel-deskbar">
                <el-button class="desk-back" @click="backToNovelLibrary"><AppIcon name="arrow-left" /><span>书架</span></el-button>
                <div class="deskbar-title">
                  <b>{{ activeNovel.title }}</b>
                  <small v-if="novelSetup.complete">{{ [activeNovel.genre, activeNovel.channel === 'female' ? '女频' : '男频', '目标' + activeNovel.wordTargetWan + '万字'].filter(Boolean).join(' · ') }}</small>
                  <small v-else>建书中 · 下一项 {{ novelSetup.nextLabel }} · {{ novelSetup.completed }}/{{ novelSetup.total }}</small>
                </div>
                <div class="deskbar-stats">
                  <span><b>{{ deskStats.done }}</b>/{{ deskStats.total }}章</span>
                  <span><b>{{ deskStats.wan }}</b>万字</span>
                  <div class="deskbar-ring" :title="'完成度 ' + deskStats.pct + '%'">
                    <el-progress type="circle" :percentage="deskStats.pct" :width="38" :stroke-width="4" :show-text="false" />
                    <i>{{ deskStats.pct }}%</i>
                  </div>
                </div>
                <div class="deskbar-actions">
                  <div class="novel-workspace-switch" role="tablist" aria-label="小说工作区">
                    <button type="button" role="tab" :aria-selected="novelUi.workspaceMode === 'chat'" :class="{ active: novelUi.workspaceMode === 'chat' }" @click="switchNovelWorkspace('chat')"><AppIcon name="message-circle" /><span>对话</span></button>
                    <button type="button" role="tab" :disabled="!novelSetup.complete" :aria-selected="novelUi.workspaceMode === 'editor'" :class="{ active: novelUi.workspaceMode === 'editor' }" @click="switchNovelWorkspace('editor')"><AppIcon name="pen-line" /><span>正文</span></button>
                  </div>
                  <el-button size="small" @click="openNovelSkillCenter"><AppIcon name="library" /><span>Skill</span></el-button>
                  <el-button size="small" @click="openNovelMarket"><AppIcon name="trending-up" /><span>市场</span></el-button>
                  <el-button size="small" circle title="创作设置" aria-label="创作设置" @click="openNovelCreationSettings"><AppIcon name="settings" /></el-button>
                  <el-button size="small" title="复制全文" aria-label="复制全文" @click="copyNovelText()"><AppIcon name="copy" /><span>复制全文</span></el-button>
                  <el-button size="small" title="导出 TXT" aria-label="导出 TXT" @click="exportNovelTxt()"><AppIcon name="download" /><span>导出 TXT</span></el-button>
                  <el-button type="primary" plain size="small" :disabled="!novelSetup.complete" :loading="novelGenerating.cover" title="生成封面" aria-label="生成封面" @click="openNovelCoverGenerator"><AppIcon name="wand-sparkles" /><span>生成封面</span></el-button>
                </div>
              </section>

              <div v-if="novelProgress.active" class="atelier-strip">
                <div class="script-progress-head">
                  <span>{{ novelProgress.text }}</span>
                  <small>{{ novelProgress.percentage }}%</small>
                </div>
                <el-progress :percentage="novelProgress.percentage" :indeterminate="novelProgress.percentage < 8" />
              </div>

              <section class="novel-desk">
                <!-- 左：会话与消息队列 -->
                <aside class="novel-session-rail" aria-label="创作会话">
                  <header class="novel-session-head">
                    <div><b>创作会话</b><small>{{ novelChat.sessions.length }} 个</small></div>
                    <el-button text circle title="新建会话" aria-label="新建创作会话" :disabled="novelChat.sending" @click="createNovelChatSession"><AppIcon name="plus" /></el-button>
                  </header>
                  <div class="novel-session-list">
                    <button v-for="session in novelChat.sessions" :key="session.id" type="button"
                            :class="['novel-session-item', { active: session.id === novelChat.activeSessionId }]"
                            :aria-label="'切换到会话：' + session.title" @click="switchNovelChatSession(session.id)">
                      <span class="novel-session-icon"><AppIcon name="message-square" /></span>
                      <span><b>{{ session.title }}</b><small>{{ session.kind === 'setup' ? '建书主线' : session.messageCount + ' 条消息' }}</small></span>
                      <span class="novel-session-tools" @click.stop>
                        <el-button text circle size="small" :title="'重命名 ' + session.title" @click="renameNovelChatSession(session)"><AppIcon name="pen-line" /></el-button>
                        <el-button v-if="session.kind !== 'setup' && novelChat.sessions.length > 1" text circle size="small" type="danger" :title="'删除 ' + session.title" @click="deleteNovelChatSession(session)"><AppIcon name="trash-2" /></el-button>
                      </span>
                    </button>
                  </div>
                  <section class="novel-queue" :class="{ empty: !novelChat.queue.length }">
                    <header><span><AppIcon name="clock" />消息队列</span><b v-if="novelChat.queue.length">{{ novelChat.queue.length }}</b></header>
                    <div v-if="novelChat.queue.length" class="novel-queue-list">
                      <article v-for="item in novelChat.queue" :key="item.id" :class="item.status">
                        <span>{{ item.status === 'running' ? '执行中' : '等待' }}</span>
                        <p>{{ item.instruction }}</p>
                        <el-button v-if="item.status !== 'running'" text circle size="small" title="取消排队指令" @click="cancelNovelQueuedMessage(item)"><AppIcon name="x" /></el-button>
                      </article>
                    </div>
                    <p v-else>当前没有排队指令</p>
                  </section>
                  <div class="novel-rail-capabilities">
                    <button type="button" @click="openNovelSkillCenter"><AppIcon name="library" /><span><b>Skill 路由</b><small>{{ selectedNovelSkills.length ? selectedNovelSkills.length + ' 个启用' : '安全注入' }}</small></span></button>
                    <button type="button" @click="openNovelCreationSettings"><AppIcon name="user-round" /><span><b>多写手</b><small>{{ activeNovel.features.multiWriter.enabled ? activeNovel.features.multiWriter.variants + ' 稿竞选' : '默认关闭' }}</small></span></button>
                  </div>
                </aside>

                <!-- 右：作品知识资产 -->
                <aside class="desk-side">
                  <header class="desk-side-head">
                    <span><AppIcon name="ticket" /></span>
                    <div><b>作品资料</b><small>{{ activeNovel.genre || '设定与章节' }}</small></div>
                  </header>
                  <div class="desk-cover">
                    <div class="desk-cover-art">
                      <img v-if="activeNovel.coverUrl" :src="activeNovel.coverUrl" :alt="activeNovel.title + ' 封面'" />
                      <div v-else class="desk-cover-blank"><AppIcon name="image" /><span>还没有封面</span></div>
                      <el-button v-if="activeNovel.coverUrl" class="desk-cover-download" circle title="下载封面" aria-label="下载封面" @click="downloadNovelCover()">
                        <AppIcon name="download" />
                      </el-button>
                    </div>
                    <el-button class="desk-cover-btn" size="small" :disabled="!novelSetup.complete" :loading="novelGenerating.cover" @click="openNovelCoverGenerator">
                      <AppIcon name="wand-sparkles" /><span>{{ activeNovel.coverUrl ? '重绘封面' : 'AI 生成封面' }}</span>
                    </el-button>
                  </div>
                  <div class="desk-intro">
                    <div class="desk-intro-tags" v-if="activeNovel.sellingPoints.length">
                      <el-tag v-for="pt in activeNovel.sellingPoints.slice(0, 3)" :key="pt" size="small" effect="plain">{{ pt }}</el-tag>
                    </div>
                    <p>{{ activeNovel.intro || 'AI 简介会在创建时自动生成' }}</p>
                  </div>

                  <div class="desk-panel-tabs">
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'chapters' }]" @click="novelUi.deskPanel = 'chapters'">目录</button>
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'blueprint' }]" @click="novelUi.deskPanel = 'blueprint'">蓝图</button>
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'characters' }]" @click="novelUi.deskPanel = 'characters'">人物</button>
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'memory' }]" @click="novelUi.deskPanel = 'memory'">记忆</button>
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'ledger' }]" @click="novelUi.deskPanel = 'ledger'">
                      伏笔<i v-if="openLedger.length" class="ledger-count">{{ openLedger.length }}</i>
                    </button>
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'radar' }]" @click="novelUi.deskPanel = 'radar'">Radar</button>
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'quality' }]" @click="openNovelQuality">质检</button>
                    <button :class="['desk-panel-tab', { active: novelUi.deskPanel === 'trace' }]" @click="novelUi.deskPanel = 'trace'">轨迹</button>
                  </div>

                  <!-- 目录 -->
                  <div v-if="novelUi.deskPanel === 'chapters'" class="desk-chapters">
                    <template v-for="volume in deskVolumes" :key="volume.index">
                      <div class="desk-volume-head" :title="volume.goal">
                        <b>{{ volume.title }}</b>
                        <small v-if="volume.goal">{{ volume.goal }}</small>
                      </div>
                      <button v-for="chapter in volume.chapters" :key="chapter.id" type="button"
                              :class="['desk-chapter', { active: activeChapterId === chapter.id, done: chapter.hasContent, live: novelGenerating.liveOrder === chapter.order }]"
                              @click="openNovelChapterInEditor(chapter.id)">
                        <span class="desk-chapter-no">{{ chapter.order }}</span>
                        <span class="desk-chapter-main">
                          <b>{{ chapter.title }}</b>
                          <small>{{ chapter.hasContent ? chapter.wordCount + '字 · ' + novelPipelineStatusLabel(chapter.pipeline?.status) : novelPipelineStatusLabel(chapter.pipeline?.status) }}</small>
                        </span>
                        <AppIcon name="check" />
                      </button>
                    </template>
                    <div v-if="!activeNovel.chapters.length" class="desk-chapters-empty muted">章节卡会在开写时按卷自动规划</div>
                  </div>

                  <!-- 蓝图 -->
                  <div v-else-if="novelUi.deskPanel === 'blueprint'" class="desk-blueprint">
                    <div class="desk-panel-tools">
                      <el-button text size="small" @click="openBlueprintEditor"><AppIcon name="pen-line" /><span>编辑蓝图</span></el-button>
                      <el-button text size="small" @click="openCharactersEditor"><AppIcon name="user" /><span>人物档案</span></el-button>
                    </div>
                    <template v-if="blueprintView">
                      <div class="bp-item" v-if="blueprintView.premise"><b>高概念</b><p>{{ blueprintView.premise }}</p></div>
                      <div class="bp-item" v-if="blueprintView.openingAnchor"><b>开局锚点</b><p>{{ blueprintView.openingAnchor }}</p></div>
                      <div class="bp-item ending" v-if="blueprintView.endingAnchor"><b>结局锚点</b><p>{{ blueprintView.endingAnchor }}</p></div>
                      <div class="bp-item" v-if="blueprintView.acts.length">
                        <b>幕结构</b>
                        <div class="bp-act" v-for="act in blueprintView.acts" :key="act.index">
                          <span>第{{ act.index }}幕 · {{ act.title }} <i>{{ act.startShare }}%-{{ act.endShare }}%</i></span>
                          <p>{{ act.goal }}<template v-if="act.climax"> → 高潮：{{ act.climax }}</template></p>
                        </div>
                      </div>
                      <div class="bp-item" v-if="blueprintView.characters.length">
                        <b>核心人物</b>
                        <div class="bp-char" v-for="c in blueprintView.characters" :key="c.name">
                          <span>{{ c.name }} <i>{{ c.role }}</i></span>
                          <p>欲望：{{ c.desire }}<template v-if="c.arc">；弧光：{{ c.arc }}</template></p>
                        </div>
                      </div>
                      <div class="bp-item" v-if="blueprintView.emotionCurve"><b>情绪曲线</b><p>{{ blueprintView.emotionCurve }}</p></div>
                    </template>
                    <div v-else class="desk-chapters-empty muted">创建作品时会自动生成故事蓝图</div>
                  </div>

                  <!-- 人物矩阵 -->
                  <div v-else-if="novelUi.deskPanel === 'characters'" class="desk-characters">
                    <div class="desk-panel-tools"><el-button text size="small" @click="openCharactersEditor"><AppIcon name="pen-line" /><span>编辑人物</span></el-button></div>
                    <article v-for="character in (blueprintView?.characters || [])" :key="character.name" class="novel-character-card">
                      <header><span>{{ character.name?.slice(0, 1) }}</span><div><b>{{ character.name }}</b><small>{{ character.role || '身份待定' }}</small></div></header>
                      <p v-if="character.desire">欲望 · {{ character.desire }}</p>
                      <p v-if="character.arc">弧光 · {{ character.arc }}</p>
                      <small v-if="activeNovel.characterStates.find(item => item.name === character.name)">
                        当前 · {{ activeNovel.characterStates.find(item => item.name === character.name)?.status || '状态稳定' }}
                      </small>
                    </article>
                    <div v-if="!blueprintView?.characters?.length" class="desk-chapters-empty muted">蓝图完成后生成人物矩阵</div>
                  </div>

                  <!-- 连续性记忆 -->
                  <div v-else-if="novelUi.deskPanel === 'memory'" class="desk-memory">
                    <div v-if="activeNovel.memoryDirtyFrom" class="novel-memory-alert">
                      <AppIcon name="triangle-alert" /><span>第 {{ activeNovel.memoryDirtyFrom }} 章起需要重建</span>
                      <el-button size="small" type="warning" :loading="novelQuality.rebuilding" @click="rebuildNovelMemory">重建</el-button>
                    </div>
                    <article v-if="activeNovel.rollingSummary" class="novel-memory-block"><b>长期摘要</b><p>{{ activeNovel.rollingSummary }}</p></article>
                    <article v-if="activeNovel.continuityState?.summary" class="novel-memory-block"><b>接续锚点</b><p>{{ activeNovel.continuityState.summary }}</p></article>
                    <div v-if="activeNovel.characterStates.length" class="novel-state-list">
                      <article v-for="state in activeNovel.characterStates" :key="state.name"><b>{{ state.name }}</b><span>{{ state.location || '位置未知' }}</span><p>{{ state.goal || state.status || state.note }}</p></article>
                    </div>
                    <div v-if="!activeNovel.rollingSummary && !activeNovel.continuityState?.summary && !activeNovel.characterStates.length" class="desk-chapters-empty muted">完成章节后自动沉淀连续性记忆</div>
                  </div>

                  <!-- 伏笔账本 -->
                  <div v-else-if="novelUi.deskPanel === 'ledger'" class="desk-ledger">
                    <div class="desk-panel-tools"><el-button text size="small" @click="openLedgerEditor"><AppIcon name="pen-line" /><span>编辑伏笔</span></el-button></div>
                    <div class="ledger-section" v-if="openLedger.length">
                      <b class="ledger-title open">待回收 · {{ openLedger.length }}</b>
                      <div class="ledger-item" v-for="entry in openLedger" :key="entry.id">
                        <span class="ledger-dot"></span>
                        <p>{{ entry.content }}<i>埋于第{{ entry.plantedChapter }}章</i></p>
                      </div>
                    </div>
                    <div class="ledger-section" v-if="resolvedLedger.length">
                      <b class="ledger-title resolved">已回收 · {{ resolvedLedger.length }}</b>
                      <div class="ledger-item resolved" v-for="entry in resolvedLedger" :key="entry.id">
                        <span class="ledger-dot"></span>
                        <p>{{ entry.content }}<i>第{{ entry.plantedChapter }}章 → 第{{ entry.resolvedChapter }}章</i></p>
                      </div>
                    </div>
                    <div v-if="!openLedger.length && !resolvedLedger.length" class="desk-chapters-empty muted">伏笔会在写作过程中自动记账、到期回收</div>
                  </div>

                  <!-- 五章 Radar -->
                  <div v-else-if="novelUi.deskPanel === 'radar'" class="desk-radar">
                    <article v-for="report in activeNovel.radarReports.slice().reverse()" :key="report.chapter + ':' + report.createdAt" class="novel-radar-card">
                      <header><span>第 {{ report.chapter }} 章</span><b>{{ report.score ?? '--' }}</b></header>
                      <p>{{ report.summary || '本轮未记录摘要' }}</p>
                      <div v-if="report.dimensions"><span v-for="(score, name) in report.dimensions" :key="name">{{ name }} {{ score }}</span></div>
                    </article>
                    <div v-if="!activeNovel.radarReports.length" class="desk-chapters-empty muted">每完成 5 章生成一次全局 Radar</div>
                  </div>

                  <!-- 可审计生成轨迹 -->
                  <div v-else-if="novelUi.deskPanel === 'trace'" class="desk-trace">
                    <header><b>{{ activeChapter ? '第 ' + activeChapter.order + ' 章' : '等待章节' }}</b><small>阶段路由与执行状态</small></header>
                    <div class="novel-stage-timeline">
                      <span v-for="stage in novelPipelineStages" :key="stage.key" :class="stage.state"><i><el-icon><Select v-if="stage.state === 'done'" /><Warning v-else-if="stage.state === 'error'" /><Clock v-else /></el-icon></i><b>{{ stage.label }}</b></span>
                    </div>
                    <article v-if="latestGenerationTrace" class="novel-trace-summary">
                      <div><span>写作模式</span><b>{{ latestGenerationTrace.mode === 'multi-writer' ? latestGenerationTrace.variantCount + ' 稿竞选' : '单写手' }}</b></div>
                      <div><span>入选稿</span><b>{{ latestGenerationTrace.selectedVariant || 1 }}</b></div>
                      <div><span>Skill</span><b>{{ latestGenerationTrace.appliedSkills?.length || 0 }}</b></div>
                      <p v-if="latestGenerationTrace.appliedSkills?.length">{{ latestGenerationTrace.appliedSkills.map(item => item.name + '@' + (item.commit || item.version || 'local').slice(0, 8)).join(' · ') }}</p>
                    </article>
                    <div v-if="!activeChapter" class="desk-chapters-empty muted">选择章节后查看完整轨迹</div>
                  </div>

                  <div v-else-if="novelUi.deskPanel === 'quality'" class="desk-quality" v-loading="novelQuality.loading">
                    <div v-if="latestNovelRadar" class="novel-radar-summary">
                      <span><AppIcon name="chart-column" />Radar · 第{{ latestNovelRadar.chapter }}章</span>
                      <b>{{ latestNovelRadar.score ?? '--' }}</b>
                      <p>{{ latestNovelRadar.summary }}</p>
                    </div>
                    <div class="quality-score" v-if="novelQuality.report">
                      <strong>{{ novelQuality.report.score }}</strong><span>质量分</span>
                    </div>
                    <div class="desk-panel-tools">
                      <el-button text size="small" @click="loadNovelQuality"><AppIcon name="refresh-cw" /><span>重新检查</span></el-button>
                      <el-button v-if="activeNovel.memoryDirtyFrom" type="warning" size="small" :loading="novelQuality.rebuilding" @click="rebuildNovelMemory">重建记忆</el-button>
                    </div>
                    <div v-if="novelQuality.report?.issues?.length" class="novel-quality-issues">
                      <button v-for="issue in novelQuality.report.issues" :key="issue.code + ':' + issue.chapterOrder + ':' + issue.title"
                              :class="['novel-quality-issue', issue.severity]"
                              @click="issue.chapterOrder && selectNovelChapter(activeNovel.chapters.find(c => c.order === issue.chapterOrder)?.id)">
                        <b>{{ issue.title }}</b><small>{{ issue.message }}</small>
                      </button>
                    </div>
                    <div v-else-if="novelQuality.report" class="desk-chapters-empty muted">当前没有发现结构或连续性问题</div>
                  </div>
                </aside>

                <!-- 右：聊天控制台 -->
                <section v-if="novelUi.workspaceMode === 'chat'" class="novel-chat-workspace" aria-label="小说创作对话">
                  <header class="novel-chat-head">
                    <div>
                      <span class="novel-chat-mark"><AppIcon name="message-circle" /></span>
                      <div>
                        <b>{{ novelSetup.complete ? '主创作台' : '建书导航' }}</b>
                        <small>{{ novelSetup.complete ? '章节、记忆与 Skill 协同' : (novelSetup.coreComplete ? '创作简报待确认' : '自由描述 · 主编实时梳理') }}</small>
                      </div>
                    </div>
                    <div class="novel-chat-head-actions">
                      <el-tag v-if="activeNovel.features.multiWriter.enabled" type="success" effect="plain">多写手 · {{ activeNovel.features.multiWriter.variants }}稿</el-tag>
                      <el-tag v-if="selectedNovelSkills.length" type="info" effect="plain">{{ selectedNovelSkills.length }} 个 Skill</el-tag>
                      <el-button text circle title="清空对话" aria-label="清空对话" :disabled="novelChat.sending" @click="clearNovelConversation"><AppIcon name="trash-2" /></el-button>
                    </div>
                  </header>

                  <div v-if="!novelSetup.complete" class="novel-setup-progress" aria-label="建书进度">
                    <div><span>建书进度 · 强设定 {{ novelSetup.strongCount || 0 }}</span><b>{{ novelSetup.completed }}/{{ novelSetup.total }}</b></div>
                    <div class="novel-setup-track"><i :style="{ width: Math.round((novelSetup.completed / novelSetup.total) * 100) + '%' }"></i></div>
                    <div class="novel-setup-slots">
                      <span v-for="slot in novelSetup.slots" :key="slot.key" :title="[slot.insight, ...(slot.gaps || [])].filter(Boolean).join(' · ')" :class="{ done: slot.filled, strong: slot.quality === 'strong', weak: slot.quality === 'weak', current: slot.key === novelSetup.nextKey }">
                        <el-icon><Select v-if="slot.filled" /><Clock v-else /></el-icon>{{ slot.label }}
                      </span>
                    </div>
                  </div>

                  <div class="novel-chat-messages" v-loading="novelChat.loading">
                    <article v-for="item in novelChat.messages" :key="item.id" :class="['novel-chat-message', item.role, item.status]">
                      <div class="novel-chat-avatar"><AppIcon name="wand-sparkles" /><AppIcon name="user" /></div>
                      <div class="novel-chat-bubble">
                        <div class="novel-chat-meta"><b>{{ item.role === 'assistant' ? '创作助手' : '你' }}</b><span v-if="item.webSearch"><AppIcon name="cable" />联网</span><time>{{ formatNovelChatTime(item.createdAt) }}</time></div>
                        <p>{{ item.content }}</p>
                        <div v-if="item.role === 'assistant' && item.webSources?.length" class="novel-chat-web-sources">
                          <span><AppIcon name="cable" />联网来源</span>
                          <a v-for="(source, sourceIndex) in item.webSources" :key="source.url" :href="source.url" target="_blank" rel="noreferrer noopener" :title="source.snippet || source.url">{{ sourceIndex + 1 }} · {{ source.title }}</a>
                        </div>
                        <div v-if="item.extracted?.length" class="novel-chat-extracted">
                          <span class="novel-chat-section-label"><AppIcon name="file-check" />本轮提取</span>
                          <div><span v-for="field in item.extracted" :key="field.key"><b>{{ field.label }}</b>{{ field.value }}</span></div>
                        </div>
                        <div v-if="item.diagnostics?.length" class="novel-chat-diagnostics">
                          <span class="novel-chat-section-label"><AppIcon name="chart-column" />创作诊断</span>
                          <article v-for="diagnostic in item.diagnostics" :key="diagnostic.level + ':' + diagnostic.title" :class="diagnostic.level">
                            <b>{{ diagnostic.title }}</b><p>{{ diagnostic.detail }}</p>
                          </article>
                        </div>
                        <div v-if="item.brief" class="novel-chat-brief">
                          <header><span><AppIcon name="ticket" />创作简报</span><b :class="{ confirmed: novelSetup.complete }">{{ novelSetup.complete ? '已确认' : '待确认' }}</b></header>
                          <dl>
                            <template v-if="item.brief.corePromise"><dt>核心承诺</dt><dd>{{ item.brief.corePromise }}</dd></template>
                            <template v-if="item.brief.centralConflict"><dt>中央冲突</dt><dd>{{ item.brief.centralConflict }}</dd></template>
                            <template v-if="item.brief.audiencePromise"><dt>读者体验</dt><dd>{{ item.brief.audiencePromise }}</dd></template>
                            <template v-if="item.brief.differentiator"><dt>差异化</dt><dd>{{ item.brief.differentiator }}</dd></template>
                          </dl>
                          <p v-if="item.brief.risks?.length">风险 · {{ item.brief.risks.join('；') }}</p>
                        </div>
                        <div v-if="item.choices?.length" class="novel-chat-choices">
                          <button v-for="choice in item.choices" :key="choice.value" type="button" :disabled="novelChat.sending" @click="useNovelChatChoice(choice)">
                            <b>{{ choice.label }}</b><small v-if="choice.hint">{{ choice.hint }}</small>
                          </button>
                        </div>
                        <div v-if="item.actions?.length" class="novel-chat-actions">
                          <span v-for="(action, actionIndex) in item.actions" :key="action.type + ':' + actionIndex"><AppIcon name="sliders-horizontal" />{{ novelChatActionLabel(action) }}</span>
                        </div>
                        <div v-if="item.actionResults?.length" class="novel-chat-results">
                          <small v-for="result in item.actionResults" :key="result.type + result.label" :class="{ error: result.ok === false }">
                            <el-icon><CircleCheck v-if="result.ok !== false" /><Warning v-else /></el-icon>
                            {{ result.ok === false ? (result.error || result.label) : result.label }}
                          </small>
                        </div>
                        <div v-if="item.status === 'running'" class="novel-chat-running"><i></i><i></i><i></i></div>
                      </div>
                    </article>
                    <div v-if="novelChat.sending && !novelChat.messages.some(item => item.status === 'running')" class="novel-chat-thinking"><i></i><i></i><i></i><span>{{ novelChat.messages[novelChat.messages.length - 1]?.webSearch ? '正在联网检索' : '正在判断下一步' }}</span></div>
                  </div>

                  <footer class="novel-chat-composer">
                    <div v-if="novelSetup.complete" class="novel-chat-quick">
                      <button v-for="prompt in novelChat.quickPrompts" :key="prompt" type="button" :disabled="novelChat.sending" @click="useNovelChatPrompt(prompt)">{{ prompt }}</button>
                    </div>
                    <div class="novel-chat-compose-bar">
                      <div class="novel-chat-compose-tools">
                        <button type="button" :class="{ active: novelChat.webSearchEnabled }" :aria-pressed="novelChat.webSearchEnabled" :title="novelChat.webSearchEnabled ? '关闭联网搜索' : '开启联网搜索'" aria-label="小说联网搜索" @click="toggleNovelWebSearch"><AppIcon name="cable" /><span>联网</span></button>
                      </div>
                      <div class="novel-composer-status"><span>{{ novelChat.sending ? '生成中，继续发送会自动排队' : 'Enter 发送' }}</span><b v-if="selectedNovelSkills.length">{{ selectedNovelSkills.length }} Skill 已路由</b></div>
                    </div>
                    <div class="novel-chat-input">
                      <el-input v-model="novelChat.input" type="textarea" :rows="3" resize="none" aria-label="小说创作指令" :placeholder="novelSetup.complete ? '告诉我接下来要写、改、查什么…' : (novelSetup.coreComplete ? '确认简报，或指出要调整的地方…' : '想到什么就说什么，不必按顺序…')" @keydown.enter.exact.prevent="sendNovelChat" />
                      <el-button type="primary" circle size="large" :title="novelChat.sending ? '加入消息队列' : '发送'" :aria-label="novelChat.sending ? '加入消息队列' : '发送创作指令'" :disabled="!novelChat.input.trim()" @click="sendNovelChat"><el-icon><Clock v-if="novelChat.sending" /><Promotion v-else /></el-icon></el-button>
                    </div>
                  </footer>
                </section>

                <!-- 右：写作区 -->
                <section v-else class="desk-write">
                  <div class="desk-write-bar">
                    <div class="desk-write-chapter" v-if="activeChapter">
                      <b>第{{ activeChapter.order }}章 · {{ activeChapter.title }}</b>
                      <small v-if="activeChapter.summary">{{ activeChapter.summary }}</small>
                    </div>
                    <div class="desk-write-chapter" v-else>
                      <b>准备就绪</b>
                      <small>点「继续写」开始黄金第一章</small>
                    </div>
                    <div class="desk-write-actions">
                      <el-tag v-if="activeChapter?.generationTrace?.mode === 'multi-writer'" size="small" type="success" effect="plain">{{ activeChapter.generationTrace.variantCount }}稿合并</el-tag>
                      <el-tag v-if="activeChapter?.pipeline?.status" size="small" effect="plain">{{ novelPipelineStatusLabel(activeChapter.pipeline.status) }}</el-tag>
                      <span :class="['novel-save-state', novelSaveState.status]">{{ novelSaveState.status === 'saving' ? '保存中' : novelSaveState.status === 'dirty' ? '未保存' : novelSaveState.status === 'error' ? '保存失败' : '已保存' }}</span>
                      <span class="desk-wordcount" v-if="novelEditorText">{{ editorWordCount }} 字</span>
                      <el-button size="small" :disabled="!activeChapter || novelGenerating.writing" @click="openChapterCardEditor()"><AppIcon name="ticket" /><span>章节卡</span></el-button>
                      <el-button size="small" :disabled="!activeChapter || !novelEditorText || novelGenerating.writing" @click="openPartialRewrite"><AppIcon name="pen-line" /><span>局部改稿</span></el-button>
                      <el-button size="small" :disabled="!activeChapter || novelGenerating.writing" :loading="novelGenerating.saving" @click="saveActiveChapter"><AppIcon name="check" /><span>保存</span></el-button>
                      <el-button size="small" :disabled="!activeChapter || novelGenerating.writing" @click="rewriteActiveChapter"><AppIcon name="rotate-cw" /><span>重写本章</span></el-button>
                    </div>
                  </div>

                  <el-input v-model="novelEditorText" type="textarea" class="novel-editor" :rows="24" resize="vertical"
                            aria-label="章节正文"
                            placeholder="正文会实时流式写在这里：初稿完成后 AI 还会自动质检修正一遍，再归档连续性与伏笔" />

                  <div class="desk-write-footer">
                    <div class="write-count">
                      <span>连写</span>
                      <el-input-number v-model="novelUi.writeCount" :min="1" :max="50" size="small" :disabled="novelGenerating.writing" />
                      <span>章</span>
                    </div>
                    <el-button v-if="!novelGenerating.writing" type="primary" size="large" class="write-cta" @click="writeNextChapters">
                      <AppIcon name="wand-sparkles" /><span>继续写</span>
                    </el-button>
                    <el-button v-else type="danger" size="large" class="write-cta" @click="stopNovelWriting">
                      <AppIcon name="pause" /><span>停笔（保留已完成章节）</span>
                    </el-button>
                  </div>
                </section>
              </section>
            </template>

            <!-- ============ 空书启动 ============ -->
            <el-dialog v-model="novelCreation.visible" class="novel-launch-dialog" width="680px" :close-on-click-modal="false" align-center append-to-body>
              <template #header>
                <div class="novel-launch-head">
                  <span><AppIcon name="pen-line" /></span>
                  <div><h3>开启新作品</h3><small>先定创作策略，内容进入工作区后逐项确认</small></div>
                </div>
              </template>
              <div class="novel-launch-body">
                <section class="novel-launch-section">
                  <header><span>01</span><div><b>创作用途</b><small>决定后续结构与审计侧重点</small></div></header>
                  <div class="novel-launch-options two">
                    <button type="button" :class="{ active: novelCreation.writingPurpose === 'serial' }" @click="novelCreation.writingPurpose = 'serial'">
                      <AppIcon name="book-open" /><span><b>连载小说</b><small>追读、节奏、断章</small></span><i><AppIcon name="check" /></i>
                    </button>
                    <button type="button" :class="{ active: novelCreation.writingPurpose === 'adaptation' }" @click="novelCreation.writingPurpose = 'adaptation'">
                      <AppIcon name="video" /><span><b>视听化原创</b><small>场景、动作、可视化资产</small></span><i><AppIcon name="check" /></i>
                    </button>
                  </div>
                </section>
                <section class="novel-launch-section">
                  <header><span>02</span><div><b>支线策略</b><small>可在蓝图完成后继续调整</small></div></header>
                  <div class="novel-launch-options four">
                    <button v-for="option in [
                      { value: 'auto', label: '智能规划', hint: '按主线自动配比' },
                      { value: 'none', label: '单线推进', hint: '聚焦核心冲突' },
                      { value: 'light', label: '轻量支线', hint: '一主一辅' },
                      { value: 'multi', label: '多线并行', hint: '群像与复杂叙事' }
                    ]" :key="option.value" type="button" :class="{ active: novelCreation.subplotPolicy === option.value }" @click="novelCreation.subplotPolicy = option.value">
                      <span><b>{{ option.label }}</b><small>{{ option.hint }}</small></span><i><AppIcon name="check" /></i>
                    </button>
                  </div>
                </section>
                <section class="novel-launch-section compact">
                  <header><span>03</span><div><b>首发平台</b><small>可选，多平台可同时启用</small></div></header>
                  <el-checkbox-group v-model="novelCreation.targetPlatforms" class="novel-platform-options">
                    <el-checkbox-button label="番茄">番茄</el-checkbox-button>
                    <el-checkbox-button label="起点">起点</el-checkbox-button>
                    <el-checkbox-button label="晋江">晋江</el-checkbox-button>
                    <el-checkbox-button label="短剧">短剧</el-checkbox-button>
                    <el-checkbox-button label="动画">动画</el-checkbox-button>
                  </el-checkbox-group>
                </section>
                <div class="novel-launch-notice"><AppIcon name="lock" /><span>多写手竞稿保持关闭；进入作品后可手动开启</span></div>
              </div>
              <template #footer>
                <el-button @click="novelCreation.visible = false">取消</el-button>
                <el-button type="primary" size="large" :loading="novelCreation.bootstrapping" @click="startNovelCreation"><AppIcon name="arrow-right" /><span>创建空白作品</span></el-button>
              </template>
            </el-dialog>

            <el-dialog v-model="novelCreationSettings.visible" title="创作设置" width="520px" class="novel-edit-dialog novel-creation-settings-dialog" append-to-body>
              <div class="novel-setting-list">
                <div class="novel-setting-row">
                  <div class="novel-setting-label">
                    <span class="novel-setting-icon teal"><AppIcon name="user-round" /></span>
                    <div><b>多写手竞争</b><small>默认关闭</small></div>
                  </div>
                  <el-switch v-model="novelCreationSettings.multiWriterEnabled" aria-label="多写手竞争" />
                </div>
                <div v-if="novelCreationSettings.multiWriterEnabled" class="novel-setting-row compact">
                  <div class="novel-setting-label"><span class="novel-setting-icon coral"><AppIcon name="files" /></span><div><b>候选稿数</b><small>总编评分合并</small></div></div>
                  <el-input-number v-model="novelCreationSettings.multiWriterVariants" :min="2" :max="5" aria-label="多写手候选稿数" />
                </div>
              </div>
              <template #footer><el-button @click="novelCreationSettings.visible = false">取消</el-button><el-button type="primary" :loading="novelCreationSettings.saving" @click="saveNovelCreationSettings">保存</el-button></template>
            </el-dialog>

            <el-dialog v-model="novelMarket.visible" title="市场雷达与拆书实验室" width="1120px" class="novel-market-dialog" append-to-body>
              <div class="novel-market-shell">
                <el-tabs v-model="novelMarket.tab" class="novel-market-tabs">
                  <el-tab-pane label="实时市场" name="ranking">
                    <section class="novel-market-ranking">
                      <header class="novel-market-toolbar">
                        <el-select v-model="novelMarket.source" size="small" class="novel-market-source-select" popper-class="novel-market-source-popper" aria-label="榜单来源" @change="onNovelMarketSourceChange">
                          <el-option-group v-for="group in novelMarketSourceGroups" :key="group.id" :label="group.label">
                            <el-option v-for="source in group.sources" :key="source.id" :value="source.id" :label="source.label" />
                          </el-option-group>
                        </el-select>
                        <div class="novel-market-status" :class="{ stale: novelMarket.ranking?.stale }" v-if="novelMarket.ranking">
                          <span><i></i>{{ novelMarket.ranking.listLabel }}</span>
                          <small>{{ formatNovelMarketTime(novelMarket.ranking.fetchedAt) }}{{ novelMarket.ranking.stale ? ' · 旧快照' : (novelMarket.ranking.cached ? ' · 15分钟缓存' : ' · 实时校验') }}</small>
                          <a :href="novelMarket.ranking.sourceUrl" target="_blank" rel="noreferrer">官方来源</a>
                        </div>
                        <el-button circle title="刷新公开榜单" aria-label="刷新公开榜单" :loading="novelMarket.refreshing" @click="loadNovelMarketRankings({ refresh: true })"><AppIcon name="refresh-cw" /></el-button>
                      </header>
                      <div class="novel-market-list" v-loading="novelMarket.loading">
                        <article v-for="item in (novelMarket.ranking?.items || [])" :key="item.source + ':' + item.id" :class="{ selected: isNovelMarketItemSelected(item) }">
                          <span class="novel-market-rank">{{ String(item.rank).padStart(2, '0') }}</span>
                          <div class="novel-market-item-main">
                            <header><b>{{ item.title }}</b><small>{{ [item.author, item.metric || (item.episodeCount ? '全' + item.episodeCount + '集' : (item.wordCount ? Math.round(item.wordCount / 10000) + '万字' : ''))].filter(Boolean).join(' · ') || '官方公开条目' }}</small></header>
                            <p>{{ item.intro || '该条目暂未公开简介，可作为标题与标签样本。' }}</p>
                            <div><span v-for="tag in item.tags" :key="tag">{{ tag }}</span><a :href="item.detailUrl" target="_blank" rel="noreferrer">查看原页</a></div>
                          </div>
                          <el-checkbox :model-value="isNovelMarketItemSelected(item)" :aria-label="'选择拆书样本：' + item.title" @change="value => setNovelMarketItemSelected(item, value)" />
                        </article>
                        <div v-if="!novelMarket.loading && !novelMarket.ranking?.items?.length" class="novel-market-empty">公开来源暂时没有返回可验证数据</div>
                      </div>
                      <footer class="novel-market-selection">
                        <span>已选 {{ selectedNovelMarketItems.length }} 个样本</span>
                        <small>只学习结构规律，不复制标题、专名或情节组合</small>
                        <el-button type="primary" :disabled="!selectedNovelMarketItems.length" @click="novelMarket.tab = 'study'">开始拆书<AppIcon name="arrow-right" /></el-button>
                      </footer>
                    </section>
                  </el-tab-pane>

                  <el-tab-pane label="拆书学习" name="study">
                    <section class="novel-study-workspace">
                      <div class="novel-study-inputs">
                        <header><b>参考样本</b><span>{{ selectedNovelMarketItems.length }} 个榜单条目</span></header>
                        <div class="novel-study-selected">
                          <span v-for="item in selectedNovelMarketItems" :key="item.source + ':' + item.id"><b>{{ novelMarketSourceLabel(item.source) }}</b>{{ item.title }}</span>
                          <p v-if="!selectedNovelMarketItems.length">可返回实时市场选择样本，也可以只粘贴自己的合法文本。</p>
                        </div>
                        <label><span>深度拆书样本 <small>可选，建议粘贴开篇或你有权分析的内容</small></span><el-input v-model="novelMarket.sampleText" type="textarea" :rows="9" resize="vertical" maxlength="30000" show-word-limit placeholder="粘贴文本后会分析开篇钩子、信息释放、人物驱动力和节奏，不会保存为仿写语料…" /></label>
                        <label><span>研究重点</span><el-input v-model="novelMarket.instruction" clearable placeholder="例如：重点研究女频悬疑的标题与前三章节奏" /></label>
                        <el-button type="primary" size="large" :loading="novelMarket.studying" :disabled="!selectedNovelMarketItems.length && !novelMarket.sampleText.trim()" @click="runNovelMarketStudy"><AppIcon name="chart-column" /><span>生成拆书报告并注入作品</span></el-button>
                      </div>
                      <div class="novel-study-report">
                        <template v-if="novelMarket.activeStudy?.analysis">
                          <header><div><b>可迁移规律</b><small>{{ formatNovelMarketTime(novelMarket.activeStudy.createdAt) }}</small></div><el-tag type="success" effect="plain">已注入</el-tag></header>
                          <p class="novel-study-summary">{{ novelMarket.activeStudy.analysis.summary }}</p>
                          <section v-if="novelMarket.activeStudy.analysis.opportunities?.length"><b>差异化机会</b><ul><li v-for="item in novelMarket.activeStudy.analysis.opportunities" :key="item">{{ item }}</li></ul></section>
                          <section v-if="novelMarket.activeStudy.analysis.titlePatterns"><b>标题规律</b><ul><li v-for="item in novelMarket.activeStudy.analysis.titlePatterns.effective" :key="item">{{ item }}</li></ul></section>
                          <section v-if="novelMarket.activeStudy.analysis.structureRules?.length"><b>结构规律</b><ul><li v-for="item in novelMarket.activeStudy.analysis.structureRules" :key="item">{{ item }}</li></ul></section>
                          <section class="danger" v-if="novelMarket.activeStudy.analysis.doNotCopy?.length"><b>禁止复刻</b><ul><li v-for="item in novelMarket.activeStudy.analysis.doNotCopy" :key="item">{{ item }}</li></ul></section>
                        </template>
                        <div v-else class="novel-market-empty">完成一次拆书后，这里会显示可迁移规律、风险和禁止复刻项</div>
                      </div>
                    </section>
                  </el-tab-pane>

                  <el-tab-pane label="标题与简介" name="package">
                    <section class="novel-package-lab">
                      <header>
                        <div><b>双阶段包装评审</b><small>12 个标题 + 4 个简介 → 独立总编终选</small></div>
                        <el-button type="primary" :loading="novelMarket.packaging" @click="generateNovelPackagingLab"><AppIcon name="wand-sparkles" /><span>{{ activeNovel?.packagingLab ? '重新生成并评审' : '生成并评审' }}</span></el-button>
                      </header>
                      <div v-if="activeNovel?.packagingLab" class="novel-package-columns">
                        <section>
                          <header><b>标题终选</b><small>AI 风险越低越自然</small></header>
                          <button v-for="title in (activeNovel?.packagingLab?.titles || [])" :key="title.id" type="button" :class="['novel-package-option', { active: novelMarket.selectedTitleId === title.id }]" role="radio" :aria-checked="novelMarket.selectedTitleId === title.id" @click="novelMarket.selectedTitleId = title.id">
                            <span>{{ title.title }}</span><small>{{ title.strategy }} · {{ title.score }}分 · AI风险 {{ title.aiRisk }}</small><p>{{ title.reason }}</p>
                          </button>
                        </section>
                        <section>
                          <header><b>简介终选</b><small>开场、信息密度与追看动力</small></header>
                          <button v-for="intro in (activeNovel?.packagingLab?.intros || [])" :key="intro.id" type="button" :class="['novel-package-option intro', { active: novelMarket.selectedIntroId === intro.id }]" role="radio" :aria-checked="novelMarket.selectedIntroId === intro.id" @click="novelMarket.selectedIntroId = intro.id">
                            <span>{{ intro.strategy }} · {{ intro.score }}分</span><p>{{ intro.text }}</p><small>{{ intro.reason }}</small>
                          </button>
                        </section>
                      </div>
                      <div v-else class="novel-market-empty large">先完成梗概和主角设定，再生成经过独立评审的标题与简介</div>
                      <footer v-if="activeNovel?.packagingLab"><p>{{ activeNovel.packagingLab.auditSummary }}</p><el-button type="primary" :loading="novelMarket.applying" :disabled="!novelMarket.selectedTitleId && !novelMarket.selectedIntroId" @click="applyNovelPackagingSelection">应用选中包装</el-button></footer>
                    </section>
                  </el-tab-pane>
                </el-tabs>
              </div>
              <template #footer><el-button @click="novelMarket.visible = false">关闭</el-button></template>
            </el-dialog>

            <el-dialog v-model="novelSkills.visible" title="Skill 中心" width="860px" class="novel-edit-dialog novel-skill-dialog" append-to-body>
              <div class="novel-skill-center">
                <section class="novel-skill-installed">
                  <header><b>当前作品</b><el-tag size="small" effect="plain">{{ selectedNovelSkills.length }} 已启用</el-tag></header>
                  <div v-if="novelSkills.items.length" class="novel-skill-list" v-loading="novelSkills.loading">
                    <div v-for="skill in novelSkills.items" :key="skill.id" class="novel-skill-row">
                      <span class="novel-skill-source"><AppIcon name="library" /></span>
                      <div class="novel-skill-main">
                        <b>{{ skill.name }}</b>
                        <small>{{ skill.source.owner }}/{{ skill.source.repo }} · {{ skill.source.commit.slice(0, 12) }}</small>
                        <div><el-tag v-for="stage in skill.stages.slice(0, 4)" :key="stage" size="small" effect="plain">{{ stage }}</el-tag></div>
                      </div>
                      <el-switch :model-value="isNovelSkillSelected(skill.id)" :disabled="!skill.enabled" :aria-label="'为当前作品启用 ' + skill.name" @change="value => setNovelSkillSelected(skill.id, value)" />
                      <el-button text type="danger" circle :title="'移除 ' + skill.name" :aria-label="'移除 ' + skill.name" @click="removeInstalledNovelSkill(skill)"><AppIcon name="trash-2" /></el-button>
                    </div>
                  </div>
                  <div v-else class="novel-skill-empty">尚未安装 Skill</div>
                </section>

                <section class="novel-skill-github">
                  <header><b>GitHub</b><el-tag size="small" type="info" effect="plain">只读分析</el-tag></header>
                  <div class="novel-skill-url">
                    <el-input v-model="novelSkills.url" clearable aria-label="GitHub Skill 仓库地址" placeholder="https://github.com/owner/repository" @keydown.enter.prevent="analyzeNovelGitHubSkill"><template #prefix><AppIcon name="link" /></template></el-input>
                    <el-button type="primary" :loading="novelSkills.analyzing" @click="analyzeNovelGitHubSkill"><AppIcon name="search" /><span>分析</span></el-button>
                  </div>

                  <div v-if="novelSkills.analysis" class="novel-skill-analysis">
                    <div class="novel-repo-summary">
                      <div><b>{{ novelSkills.analysis.repository.owner }}/{{ novelSkills.analysis.repository.repo }}</b><small>{{ novelSkills.analysis.repository.commitShort }}</small></div>
                      <span><AppIcon name="star" />{{ novelSkills.analysis.repository.stars }}</span>
                      <span>{{ novelSkills.analysis.repository.license || '未声明许可' }}</span>
                      <span v-if="novelSkills.analysis.repository.scriptCount" class="warning">{{ novelSkills.analysis.repository.scriptCount }} 个脚本（不会执行）</span>
                    </div>
                    <p v-if="novelSkills.analysis.ai?.summary" class="novel-skill-ai-summary">{{ novelSkills.analysis.ai.summary }}</p>
                    <div v-if="novelSkills.analysis.candidates.length" class="novel-skill-candidates">
                      <div v-for="candidate in novelSkills.analysis.candidates" :key="candidate.skillFile" class="novel-skill-candidate">
                        <div>
                          <b>{{ candidate.name }}</b>
                          <small>{{ candidate.path || '仓库根目录' }}</small>
                          <p>{{ candidate.description }}</p>
                          <span class="novel-skill-score">匹配度 {{ candidate.compatibilityScore }}</span>
                          <el-tag v-for="tag in candidate.tags.slice(0, 5)" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
                        </div>
                        <el-button type="primary" plain :loading="novelSkills.installingPath === (candidate.path || candidate.skillFile || 'root')" @click="installNovelGitHubSkill(candidate)"><AppIcon name="download" /><span>安装并启用</span></el-button>
                      </div>
                    </div>
                    <div v-else class="novel-skill-empty">{{ novelSkills.analysis.summary }}</div>
                  </div>
                </section>
              </div>
              <template #footer><el-button @click="novelSkills.visible = false">关闭</el-button></template>
            </el-dialog>

            <el-dialog v-model="novelCover.visible" title="生成小说封面" width="940px" class="novel-edit-dialog novel-cover-dialog" append-to-body :close-on-click-modal="false" :close-on-press-escape="!novelGenerating.cover" :show-close="!novelGenerating.cover">
              <section class="novel-cover-reference-shell">
                <header class="novel-cover-reference-head">
                  <div>
                    <b>参考素材</b>
                    <span>已选 {{ novelCoverSelectedCount }} / {{ novelCover.referenceLimit }}</span>
                  </div>
                  <div class="novel-cover-head-actions">
                    <label class="novel-cover-ratio-control">
                      <span>画面比例</span>
                      <el-select v-model="novelCover.ratio" size="small" :disabled="novelGenerating.cover" aria-label="封面画面比例">
                        <el-option v-for="option in NOVEL_COVER_RATIO_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
                      </el-select>
                    </label>
                    <el-button v-if="novelCoverSelectedCount" text type="danger" :disabled="novelGenerating.cover" @click="clearNovelCoverReferences"><AppIcon name="trash-2" /><span>清空</span></el-button>
                  </div>
                </header>

                <el-tabs v-model="novelCover.source" class="novel-cover-source-tabs" @tab-change="onNovelCoverSourceChange">
                  <el-tab-pane label="本地图片" name="local">
                    <div :class="['novel-cover-dropzone', { dragging: novelCover.dragging }]"
                         @dragenter.prevent="novelCover.dragging = true" @dragover.prevent="novelCover.dragging = true"
                         @dragleave.prevent="novelCover.dragging = false" @drop.prevent="onDropNovelCoverReferences">
                      <AppIcon name="upload" />
                      <b>选择或拖入本地图片</b>
                      <small>PNG、JPG、WebP 等常见格式，单张不超过 15 MB</small>
                      <el-button type="primary" plain :loading="novelCover.reading" :disabled="novelCoverSelectedCount >= novelCover.referenceLimit || novelGenerating.cover" @click="$event.currentTarget.nextElementSibling.click()">
                        <AppIcon name="plus" /><span>添加图片</span>
                      </el-button>
                      <input type="file" accept="image/*,.png,.jpg,.jpeg,.jfif,.webp,.gif,.bmp,.avif" multiple hidden @change="onPickNovelCoverReferences" />
                    </div>

                    <div v-if="novelCover.localImages.length" class="novel-cover-local-grid">
                      <article v-for="item in novelCover.localImages" :key="item.id" class="novel-cover-local-item">
                        <button type="button" :aria-label="'预览 ' + item.name" @click="lightboxSrc = item.dataUrl"><img :src="item.dataUrl" :alt="item.name" /></button>
                        <span :title="item.name">{{ item.name }}</span>
                        <el-select v-model="item.referenceType" size="small" :disabled="novelGenerating.cover" :aria-label="item.name + ' 的参考类型'">
                          <el-option v-for="type in NOVEL_COVER_LOCAL_REFERENCE_TYPES" :key="type.value" :label="type.label" :value="type.value" />
                        </el-select>
                        <el-button text circle type="danger" :disabled="novelGenerating.cover" :title="'移除 ' + item.name" @click="removeNovelCoverLocalImage(item.id)"><AppIcon name="x" /></el-button>
                      </article>
                    </div>
                  </el-tab-pane>

                  <el-tab-pane label="全局素材图库" name="library">
                    <div class="novel-cover-library-toolbar">
                      <el-input v-model="novelCover.query" clearable placeholder="搜索素材" aria-label="搜索封面参考素材"><template #prefix><AppIcon name="search" /></template></el-input>
                      <el-select v-model="novelCover.projectId" clearable placeholder="全部项目" aria-label="筛选来源项目"><el-option v-for="item in novelCover.libraryProjects" :key="item.id" :label="item.name" :value="item.id" /></el-select>
                      <el-select v-model="novelCover.category" clearable placeholder="全部类型" aria-label="筛选素材类型"><el-option v-for="item in novelCover.libraryCategories" :key="item" :label="item" :value="item" /></el-select>
                      <el-button circle :loading="novelCover.libraryLoading" title="刷新素材图库" @click="loadNovelCoverLibrary"><AppIcon name="refresh-cw" /></el-button>
                    </div>
                    <div v-loading="novelCover.libraryLoading" class="novel-cover-library-body">
                      <div v-if="filteredNovelCoverLibraryItems.length" class="novel-cover-library-grid">
                        <button v-for="item in visibleNovelCoverLibraryItems" :key="item.id" type="button"
                                :class="['novel-cover-library-item', { selected: isNovelCoverLibraryItemSelected(item) }]"
                                :aria-pressed="isNovelCoverLibraryItemSelected(item)" :disabled="novelGenerating.cover"
                                @click="toggleNovelCoverLibraryItem(item)">
                          <span class="novel-cover-library-image"><img :src="item.coverUrl" :alt="item.name" loading="lazy" /><i><AppIcon name="check" /></i></span>
                          <span class="novel-cover-library-copy"><b>{{ item.name }}</b><small>{{ item.assetTypeLabel }} · {{ item.sourceProjectName }}</small></span>
                        </button>
                      </div>
                      <div v-if="visibleNovelCoverLibraryItems.length < filteredNovelCoverLibraryItems.length" class="novel-cover-library-more">
                        <el-button plain @click="showMoreNovelCoverLibraryItems">继续加载（{{ visibleNovelCoverLibraryItems.length }} / {{ filteredNovelCoverLibraryItems.length }}）</el-button>
                      </div>
                      <div v-if="!novelCover.libraryLoading && !filteredNovelCoverLibraryItems.length" class="novel-cover-library-empty"><AppIcon name="image" /><span>没有匹配的图库素材</span></div>
                    </div>
                  </el-tab-pane>
                </el-tabs>

                <div v-if="selectedNovelCoverLibraryItems.length || novelCover.localImages.length" class="novel-cover-selected-strip">
                  <span v-for="item in selectedNovelCoverLibraryItems" :key="item.id"><AppIcon name="library" />{{ item.name }}</span>
                  <span v-for="item in novelCover.localImages" :key="item.id"><AppIcon name="image" />{{ item.name }}</span>
                </div>
              </section>
              <template #footer>
                <el-button :disabled="novelGenerating.cover" @click="novelCover.visible = false">取消</el-button>
                <el-button type="primary" :loading="novelGenerating.cover" @click="submitNovelCoverGeneration">
                  <AppIcon name="wand-sparkles" /><span>{{ novelCoverSelectedCount ? '使用 ' + novelCoverSelectedCount + ' 项素材生成' : '直接生成' }}</span>
                </el-button>
              </template>
            </el-dialog>

            <el-dialog v-model="novelBlueprintEdit.visible" title="编辑故事蓝图" width="720px" class="novel-edit-dialog" append-to-body>
              <el-form label-position="top" class="novel-structure-form">
                <el-form-item label="高概念"><el-input v-model="novelBlueprintEdit.data.premise" /></el-form-item>
                <div class="wizard-row">
                  <el-form-item label="开局锚点"><el-input v-model="novelBlueprintEdit.data.openingAnchor" type="textarea" :rows="4" /></el-form-item>
                  <el-form-item label="结局锚点"><el-input v-model="novelBlueprintEdit.data.endingAnchor" type="textarea" :rows="4" /></el-form-item>
                </div>
                <el-form-item label="世界观规则（每行一条）"><el-input v-model="novelBlueprintEdit.data.worldRulesText" type="textarea" :rows="5" /></el-form-item>
                <el-form-item label="幕结构">
                  <div class="novel-edit-list blueprint-act-list">
                    <div v-for="(act, index) in novelBlueprintEdit.data.acts" :key="index" class="novel-edit-row blueprint-act-edit-row">
                      <el-input-number v-model="act.index" :min="1" controls-position="right" aria-label="幕序号" />
                      <el-input v-model="act.title" placeholder="幕名" />
                      <el-input v-model="act.goal" placeholder="本幕目标" />
                      <el-input v-model="act.climax" placeholder="幕末高潮" />
                      <el-input-number v-model="act.startShare" :min="0" :max="100" controls-position="right" aria-label="开始进度" />
                      <el-input-number v-model="act.endShare" :min="0" :max="100" controls-position="right" aria-label="结束进度" />
                      <el-button text type="danger" title="删除幕" @click="novelBlueprintEdit.data.acts.splice(index, 1)"><AppIcon name="trash-2" /></el-button>
                    </div>
                    <el-button plain @click="addBlueprintAct"><AppIcon name="plus" /><span>添加一幕</span></el-button>
                  </div>
                </el-form-item>
                <el-form-item label="情绪曲线"><el-input v-model="novelBlueprintEdit.data.emotionCurve" type="textarea" :rows="3" /></el-form-item>
                <el-form-item label="节奏提醒"><el-input v-model="novelBlueprintEdit.data.pacingNotes" type="textarea" :rows="3" /></el-form-item>
              </el-form>
              <template #footer><el-button @click="novelBlueprintEdit.visible = false">取消</el-button><el-button type="primary" :loading="novelBlueprintEdit.saving" @click="saveBlueprintEditor">保存蓝图</el-button></template>
            </el-dialog>

            <el-dialog v-model="novelCharactersEdit.visible" title="人物档案" width="820px" class="novel-edit-dialog" append-to-body>
              <div class="novel-edit-list">
                <div v-for="(item, index) in novelCharactersEdit.items" :key="index" class="novel-edit-row character-row">
                  <el-input v-model="item.name" placeholder="姓名" />
                  <el-input v-model="item.role" placeholder="身份 / 阵营" />
                  <el-input v-model="item.desire" placeholder="核心欲望" />
                  <el-input v-model="item.secret" placeholder="秘密 / 弱点" />
                  <el-input v-model="item.arc" placeholder="人物弧光" />
                  <el-button text type="danger" title="删除人物" @click="novelCharactersEdit.items.splice(index, 1)"><AppIcon name="trash-2" /></el-button>
                </div>
                <el-button plain @click="addNovelCharacter"><AppIcon name="plus" /><span>添加人物</span></el-button>
              </div>
              <template #footer><el-button @click="novelCharactersEdit.visible = false">取消</el-button><el-button type="primary" :loading="novelCharactersEdit.saving" @click="saveCharactersEditor">保存人物</el-button></template>
            </el-dialog>

            <el-dialog v-model="novelChapterCardEdit.visible" title="编辑章节卡" width="680px" class="novel-edit-dialog" append-to-body>
              <el-form label-position="top" class="novel-structure-form">
                <el-form-item label="章节标题"><el-input v-model="novelChapterCardEdit.data.title" /></el-form-item>
                <el-form-item label="剧情任务"><el-input v-model="novelChapterCardEdit.data.summary" type="textarea" :rows="4" /></el-form-item>
                <div class="wizard-row">
                  <el-form-item label="开头钩子"><el-input v-model="novelChapterCardEdit.data.hook" type="textarea" :rows="3" /></el-form-item>
                  <el-form-item label="结尾悬念"><el-input v-model="novelChapterCardEdit.data.endingHook" type="textarea" :rows="3" /></el-form-item>
                </div>
                <div class="wizard-row">
                  <el-form-item label="本章埋设伏笔（每行一条）"><el-input v-model="novelChapterCardEdit.data.plantText" type="textarea" :rows="3" /></el-form-item>
                  <el-form-item label="本章回收伏笔（每行一条）"><el-input v-model="novelChapterCardEdit.data.resolveText" type="textarea" :rows="3" /></el-form-item>
                </div>
              </el-form>
              <template #footer><el-button @click="novelChapterCardEdit.visible = false">取消</el-button><el-button type="primary" :loading="novelChapterCardEdit.saving" @click="saveChapterCardEditor">保存章节卡</el-button></template>
            </el-dialog>

            <el-dialog v-model="novelLedgerEdit.visible" title="编辑伏笔账本" width="820px" class="novel-edit-dialog" append-to-body>
              <div class="novel-edit-list">
                <div v-for="(item, index) in novelLedgerEdit.items" :key="item.id || index" class="novel-edit-row ledger-edit-row">
                  <el-input v-model="item.content" placeholder="伏笔内容" />
                  <el-input-number v-model="item.plantedChapter" :min="0" controls-position="right" title="埋设章节" />
                  <el-input-number v-model="item.dueChapter" :min="0" controls-position="right" title="计划回收章节" />
                  <el-select v-model="item.status" aria-label="伏笔状态"><el-option label="待回收" value="open" /><el-option label="已回收" value="resolved" /></el-select>
                  <el-button text type="danger" title="删除伏笔" @click="novelLedgerEdit.items.splice(index, 1)"><AppIcon name="trash-2" /></el-button>
                </div>
                <el-button plain @click="addLedgerEntry"><AppIcon name="plus" /><span>添加伏笔</span></el-button>
              </div>
              <template #footer><el-button @click="novelLedgerEdit.visible = false">取消</el-button><el-button type="primary" :loading="novelLedgerEdit.saving" @click="saveLedgerEditor">保存账本</el-button></template>
            </el-dialog>

            <el-dialog v-model="novelRewrite.visible" title="局部 AI 改稿" width="760px" class="novel-edit-dialog" append-to-body :close-on-click-modal="false">
              <div class="novel-rewrite-controls">
                <el-segmented v-model="novelRewrite.mode" :options="[
                  { label: '润色', value: 'polish' }, { label: '扩写', value: 'expand' }, { label: '压缩', value: 'condense' },
                  { label: '增强冲突', value: 'conflict' }, { label: '强化对白', value: 'dialogue' }, { label: '自定义', value: 'custom' }
                ]" />
                <el-input v-model="novelRewrite.instruction" placeholder="补充要求（可选）" clearable />
              </div>
              <div class="novel-rewrite-compare">
                <section><b>原片段</b><div>{{ novelRewrite.original }}</div></section>
                <section><b>改写结果</b><div v-if="novelRewrite.result">{{ novelRewrite.result }}</div><div v-else class="muted">生成后在这里对比结果</div></section>
              </div>
              <template #footer>
                <el-button @click="novelRewrite.visible = false">取消</el-button>
                <el-button :loading="novelRewrite.generating" @click="generatePartialRewrite">{{ novelRewrite.result ? '重新生成' : '生成改稿' }}</el-button>
                <el-button type="primary" :disabled="!novelRewrite.result || novelRewrite.generating" @click="applyPartialRewrite">应用替换</el-button>
              </template>
            </el-dialog>
          </section>
        </template>`;
