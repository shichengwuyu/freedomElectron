import { scriptPromptPanelBody } from './scriptPromptPanel.js';

export const workspaceView = /* html */ `        <template v-if="view === 'workspace' || workspaceMounted">
          <div v-if="view === 'workspace' && !project" class="empty-state">
            <AppIcon name="folder" />
            <span>未打开项目</span>
          </div>
          <template v-else-if="project && project.id">
            <section :class="['workspace-stage-shell', { 'is-parked': view !== 'workspace' }]">
              <nav class="stage-tabs">
                <div class="stage-tabs-group pipeline-flow">
                  <div class="pipeline-node is-static src-metric" :title="'原文总字数 ' + sourceLen + ' 字'">
                    <span class="pipeline-node-icon"><AppIcon name="file-text" /></span>
                    <span class="pipeline-node-info"><b>{{ sourceLen }}</b><small>原文 · 字</small></span>
                  </div>
                  <span :class="['pipeline-link', { lit: scriptState.episodes.length }]"></span>
                  <button :class="['stage-tab', 'pipeline-node', { active: scriptUI.stage === 'script' }]" @click="scriptUI.stage = 'script'">
                    <span class="stage-tab-no">1</span>
                    <span class="pipeline-node-info"><b class="stage-tab-label">剧本</b><small class="stage-tab-count">{{ scriptState.episodes.length }} 集</small></span>
                  </button>
                  <span :class="['pipeline-link', { lit: scriptState.storyboards.length }]"></span>
                  <button :class="['stage-tab', 'pipeline-node', { active: scriptUI.stage === 'storyboard' }]" @click="scriptUI.stage = 'storyboard'">
                    <span class="stage-tab-no">2</span>
                    <span class="pipeline-node-info"><b class="stage-tab-label">分镜</b><small class="stage-tab-count">{{ scriptState.storyboards.length }} 份</small></span>
                  </button>
                </div>
                <div class="stage-tabs-actions">
                  <template v-if="scriptUI.stage === 'script'">
                    <span :class="['prompt-status-chip', { 'is-custom': isCustomScriptPromptMode }]" :title="'剧本提示词：' + scriptPromptStatusText">
                      <AppIcon name="pen-line" /><span>{{ scriptPromptStatusText }}</span>
                    </span>
                    <el-button size="small" :type="scriptUI.settingsPanel ? 'primary' : ''" @click="scriptUI.settingsPanel = !scriptUI.settingsPanel"><AppIcon name="settings" /><span>生成设置</span></el-button>
                    <el-button size="small" @click="scriptUI.customPromptPanel = !scriptUI.customPromptPanel"><AppIcon name="toggle-left" /><span>提示词</span></el-button>
                  </template>
                  <el-badge :value="quality.report?.summary?.error || 0" :hidden="!(quality.report?.summary?.error)" type="danger" class="quality-trigger-badge">
                    <el-button size="small" class="quality-trigger" @click="openProjectQuality"><AppIcon name="circle-check" /><span>项目质检</span></el-button>
                  </el-badge>
                  <button class="asset-dock" @click="openElementsDrawer" title="选角与资产工坊：人物 / 场景 / 道具 / 特效的提取、出图与管理">
                    <span class="asset-dock-icon"><AppIcon name="layout-grid" /></span>
                    <span class="asset-dock-copy">
                      <b>元素库</b>
                      <small>{{ counts.character + counts.group + counts.scene + counts.prop + counts.effect + counts.creature }} 项资产 · 提取与出图</small>
                    </span>
                    <span v-if="!(counts.character + counts.group + counts.scene + counts.prop + counts.effect + counts.creature)" class="asset-dock-ping" aria-hidden="true"></span>
                    <AppIcon name="arrow-right" />
                  </button>
                </div>
              </nav>

              <section class="project-stage">
                <div v-if="scriptUI.stage === 'script' && scriptUI.settingsPanel" class="settings-panel-inline">
                  <div class="section-title"><AppIcon name="settings" /><span>剧本生成设置</span></div>
                  <div v-if="!isCustomScriptPromptMode" class="gen-settings-grid">
                    <label class="gen-field">
                      <span class="gen-field-label">改编强度</span>
                      <el-select v-model="scriptState.settings.adaptationStrength" size="small" style="width:100%" @change="onScriptSettingChange">
                        <el-option label="忠实改编｜贴原文，只做剧本化" value="faithful" />
                        <el-option label="短剧强化｜保主线，增强钩子节奏" value="enhanced" />
                        <el-option label="二创重构｜保核心，重设短剧结构" value="rewrite" />
                      </el-select>
                      <p class="adaptation-strength-hint">{{ adaptationStrengthHint }}</p>
                    </label>
                    <div class="gen-switches">
                      <el-switch v-model="scriptState.settings.useDramaReview" size="small" active-text="分段质量审稿" @change="onScriptSettingChange" />
                      <el-switch v-model="scriptState.settings.useEpisodeFinalReview" size="small" active-text="完整单集终审" @change="onScriptSettingChange" />
                      <el-switch v-model="scriptState.settings.useColdOpen" size="small" active-text="首集冷开场" @change="onScriptSettingChange" />
                      <el-switch v-model="scriptState.settings.useEpisodeHook" size="small" active-text="单集追看钩子" @change="onScriptSettingChange" />
                      <el-switch v-model="scriptState.settings.usePurification" size="small" active-text="精准提纯" @change="onScriptSettingChange" />
                      <el-switch v-model="scriptState.settings.useLongScript" size="small" active-text="长剧本" @change="onScriptSettingChange" />
                      <el-switch v-model="scriptState.settings.useContentReview" size="small" active-text="内容审核" @change="onScriptSettingChange" />
                      <p v-if="scriptSettingComboHint" class="script-setting-combo-hint">{{ scriptSettingComboHint }}</p>
                    </div>
                  </div>
                  <p v-else class="muted">当前使用自定义剧本提示词，内置创作开关、覆盖校验和质量审稿均停用；生成将完全按自定义提示词执行。可在「提示词」里切回内置。</p>
                </div>

                <div v-if="scriptUI.stage === 'script' && scriptUI.customPromptPanel" class="custom-prompt-panel">
                  ${scriptPromptPanelBody}
                </div>

                <section v-show="scriptUI.stage === 'script'" class="script-stage">
                  <div class="ep-reel-shell">
                    <div class="ep-reel-toolbar">
                      <div class="ep-reel-title">
                        <strong>剧集胶片带</strong>
                        <span class="ep-reel-count">{{ chaptersSorted().length }} 章 · {{ scriptState.episodes.length }} 集</span>
                      </div>
                      <div class="ep-reel-actions">
                        <label v-if="!scriptUI.batchGen.active" class="rail-batch-opt">
                          <el-checkbox v-model="scriptUI.batchGen.onlyUnfinished" size="small" />
                          <span>只生成未完成</span>
                        </label>
                        <el-button v-if="scriptUI.adaptingWholeNovel" size="small" type="success" loading :title="scriptUI.wholeAdaptProgress || '整本改编中…'">
                          <span>{{ scriptUI.wholeAdaptProgress || '整本改编中…' }}</span>
                        </el-button>
                        <el-button v-else size="small" type="success" plain :disabled="!scriptState.chapters.length || scriptUI.batchGen.active" @click="adaptWholeNovel">
                          <AppIcon name="wand-sparkles" /><span>整本改编</span>
                        </el-button>
                        <el-button v-if="scriptUI.batchGen.active" size="small" type="danger" @click="cancelBatchGeneration" :disabled="scriptUI.batchGen.cancel">
                          <AppIcon name="pause" /><span>{{ scriptUI.batchGen.cancel ? '停止中…' : '停止 (' + scriptUI.batchGen.done + '/' + scriptUI.batchGen.total + ')' }}</span>
                        </el-button>
                        <el-button v-else size="small" type="primary" :disabled="!scriptState.episodes.length" @click="generateAllEpisodes({ onlyUnfinished: scriptUI.batchGen.onlyUnfinished })">
                          <AppIcon name="wand-sparkles" /><span>{{ scriptUI.batchGen.onlyUnfinished ? '补齐未完成' : '全部生成' }}</span>
                        </el-button>
                        <el-button v-if="!scriptUI.batchGen.active" size="small" type="warning" plain :disabled="!scriptState.chapters.length" @click="generateAllWholeChapters({ onlyUnfinished: scriptUI.batchGen.onlyUnfinished, concurrency: 2 })" title="把每章当作一集，2 路并发跳过 AI 分集直接跑剧本">
                          <AppIcon name="wand-sparkles" /><span>{{ scriptUI.batchGen.onlyUnfinished ? '补齐未整章' : '全部整章生成' }}</span>
                        </el-button>
                        <el-button size="small" :disabled="scriptUI.addingChapter || scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" @click="startAddChapter"><AppIcon name="plus" /><span>追加章节</span></el-button>
                        <el-button size="small" :loading="scriptUI.importingNovel" :disabled="scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" @click="!scriptUI.importingNovel && $refs.novelInput.click()">
                          <AppIcon name="upload" /><span>{{ scriptUI.importingNovel ? (scriptUI.novelImportProgress || '导入中') : '导入整本 TXT' }}</span>
                        </el-button>
                        <input ref="novelInput" type="file" accept=".txt,text/plain" multiple hidden @change="onPickWholeNovelFile" />
                        <el-button size="small" :disabled="scriptUI.importingEpisode" @click="startImportEpisode"><AppIcon name="upload" /><span>导入剧本</span></el-button>
                      </div>
                    </div>

                    <div v-if="scriptUI.batchGen.active" class="script-progress batch-progress">
                      <div class="script-progress-head">
                        <span>批量生成 · {{ scriptUI.batchGen.currentTitle || '准备中' }}</span>
                        <small>已处理 {{ scriptUI.batchGen.done }} / {{ scriptUI.batchGen.total }}<template v-if="scriptUI.batchGen.failed"> · 失败 {{ scriptUI.batchGen.failed }}</template></small>
                      </div>
                      <el-progress :percentage="scriptUI.batchGen.total ? Math.round(scriptUI.batchGen.done / scriptUI.batchGen.total * 100) : 0" :status="scriptUI.batchGen.cancel ? 'warning' : (scriptUI.batchGen.failed ? 'exception' : '')" />
                    </div>

                    <div class="ep-reel" aria-label="剧集胶片带">
                      <template v-if="isWholeNovelTimeline()">
                        <div class="reel-summary">
                          <b>整本剧集规划</b>
                          <span>{{ episodesSorted().length }}集 · 原文{{ chaptersSorted().length }}章已统筹</span>
                        </div>
                        <button v-for="ep in episodesSorted()" :key="'reel:'+ep.id" type="button"
                                :class="['film-frame', { active: scriptUI.selectedId === 'ep:'+ep.id, done: !!ep.content, busy: scriptUI.genEpisode === ep.id, stale: isEpisodeStale(ep) && scriptUI.genEpisode !== ep.id }]"
                                @click="scriptUI.selectedId = 'ep:'+ep.id">
                          <span class="film-frame-holes" aria-hidden="true"></span>
                          <span class="film-frame-no">{{ ep.id }}</span>
                          <span class="film-frame-title">{{ ep.title }}</span>
                          <span class="film-frame-status">
                            <template v-if="scriptUI.genEpisode === ep.id && scriptUI.scriptProgress && scriptUI.scriptProgress.episodeId === ep.id">生成中 {{ scriptUI.scriptProgress.percentage }}%</template>
                            <template v-else-if="scriptUI.genEpisode === ep.id">生成中…</template>
                            <template v-else-if="isEpisodeStale(ep)">原文已改</template>
                            <template v-else-if="ep.content">已完成</template>
                            <template v-else>待生成</template>
                          </span>
                          <span v-if="ep.compression" class="ep-plan-tag" :title="ep.compression">统筹</span>
                          <i v-if="scriptUI.genEpisode === ep.id && scriptUI.scriptProgress && scriptUI.scriptProgress.episodeId === ep.id" class="film-frame-progress" :style="{ width: scriptUI.scriptProgress.percentage + '%' }"></i>
                          <span class="film-frame-holes" aria-hidden="true"></span>
                        </button>
                      </template>
                      <template v-else>
                        <div v-for="ch in chaptersSorted()" :key="'reelch:'+ch.id" class="reel-chapter-group">
                          <div :class="['reel-chapter-tab', { active: scriptUI.selectedId === 'ch:'+ch.id }]" @click="scriptUI.selectedId = 'ch:'+ch.id">
                            <span class="reel-ch-name">{{ ch.title }}</span>
                            <span class="reel-ch-len">{{ (ch.sourceText||'').length }} 字</span>
                            <span class="reel-ch-actions" @click.stop>
                              <el-button size="small" type="primary" text :loading="scriptUI.genWhole === ch.id" title="整章直接生成一集剧本，不分集" @click="generateWholeChapter(ch)"><AppIcon name="wand-sparkles" /></el-button>
                              <el-button size="small" text :loading="scriptUI.splitting === ch.id" :title="episodesOfChapter(ch.id).length ? '重新分集' : '智能分集'" @click="splitChapter(ch)"><AppIcon name="scissors" /></el-button>
                            </span>
                          </div>
                          <div class="reel-frames">
                            <button v-for="ep in episodesOfChapter(ch.id)" :key="'reel:'+ep.id" type="button"
                                    :class="['film-frame', { active: scriptUI.selectedId === 'ep:'+ep.id, done: !!ep.content, busy: scriptUI.genEpisode === ep.id, stale: isEpisodeStale(ep) && scriptUI.genEpisode !== ep.id }]"
                                    @click="scriptUI.selectedId = 'ep:'+ep.id">
                              <span class="film-frame-holes" aria-hidden="true"></span>
                              <span class="film-frame-no">{{ ep.id }}</span>
                              <span class="film-frame-title">{{ ep.title }}</span>
                              <span class="film-frame-status">
                                <template v-if="scriptUI.genEpisode === ep.id && scriptUI.scriptProgress && scriptUI.scriptProgress.episodeId === ep.id">生成中 {{ scriptUI.scriptProgress.percentage }}%</template>
                                <template v-else-if="scriptUI.genEpisode === ep.id">生成中…</template>
                                <template v-else-if="isEpisodeStale(ep)">原文已改</template>
                                <template v-else-if="ep.content">已完成</template>
                                <template v-else>待生成</template>
                              </span>
                              <i v-if="scriptUI.genEpisode === ep.id && scriptUI.scriptProgress && scriptUI.scriptProgress.episodeId === ep.id" class="film-frame-progress" :style="{ width: scriptUI.scriptProgress.percentage + '%' }"></i>
                              <span class="film-frame-holes" aria-hidden="true"></span>
                            </button>
                            <span v-if="!episodesOfChapter(ch.id).length" class="reel-empty-hint">未分集 · 点章节里的分集按钮</span>
                          </div>
                        </div>
                        <div v-if="!chaptersSorted().length" class="reel-empty">
                          <span>片盘是空的 —— 点「导入整本 TXT」或「追加章节」装上第一卷胶片</span>
                        </div>
                      </template>
                    </div>

                    <div v-if="scriptUI.importingEpisode" class="add-chapter-form reel-form">
                        <el-input v-model="scriptUI.importTitle" size="small" placeholder="剧本标题（例如：第1集）" />
                        <el-alert title="智能分集提示" type="info" :closable="false" style="margin:8px 0">
                          <template #default>
                            <div style="font-size:12px;line-height:1.6">
                              • 单集剧本：直接粘贴即可（不超过15000字）<br/>
                              • 多集剧本：在每集开头添加"第1集"、"第2集"等标记，系统会自动分割<br/>
                              • 例如：第1集：标题名
剧本内容...
第2集：标题名
剧本内容...
                            </div>
                          </template>
                        </el-alert>
                        <el-input v-model="scriptUI.importContent" type="textarea" :rows="10" resize="vertical" placeholder="粘贴您的剧本内容..." />
                        <div class="inline-actions">
                          <el-button type="primary" size="small" :loading="scriptUI.importing" @click="confirmImportEpisode"><AppIcon name="upload" /><span>导入</span></el-button>
                          <el-button size="small" @click="cancelImportEpisode">取消</el-button>
                        </div>
                    </div>
                    <div v-else-if="scriptUI.addingChapter" class="add-chapter-form reel-form">
                        <el-input v-model="scriptUI.draftTitle" size="small" placeholder="章节标题" />
                        <div class="dropzone mini" :class="{ over: scriptDragOver }" @dragover.prevent="scriptDragOver = true" @dragleave.prevent="scriptDragOver = false" @drop="onSourceDrop" @click="$refs.chapInput.click()">
                          <AppIcon name="upload" /><span>TXT</span>
                          <input ref="chapInput" type="file" accept=".txt" multiple hidden @change="onPickSourceFile" />
                        </div>
                        <el-input v-model="scriptUI.draftText" type="textarea" :rows="6" resize="vertical" placeholder="章节原文" />
                        <div class="inline-actions">
                          <el-button type="primary" size="small" @click="confirmAddChapter"><AppIcon name="plus" /><span>追加</span></el-button>
                          <el-button size="small" @click="cancelAddChapter">取消</el-button>
                        </div>
                    </div>
                  </div>

                  <section class="editor-deck">
                    <div v-if="selectedEpisode" :class="['editor-cockpit', { 'focus-writing': scriptUI.focusWriting }]">
                      <header class="cockpit-head">
                        <button class="cockpit-nav" :disabled="!prevEpisodeOf(selectedEpisode.id)" title="上一集" @click="gotoEpisodeId(prevEpisodeOf(selectedEpisode.id))">
                          <AppIcon name="arrow-left" />
                        </button>
                        <div class="cockpit-title">
                          <div class="eyebrow">EP {{ String(selectedEpisode.id).padStart(2, '0') }}</div>
                          <h2>{{ selectedEpisode.title }}</h2>
                        </div>
                        <button class="cockpit-nav" :disabled="!nextEpisodeOf(selectedEpisode.id)" title="下一集" @click="gotoEpisodeId(nextEpisodeOf(selectedEpisode.id))">
                          <AppIcon name="arrow-right" />
                        </button>
                        <div class="cockpit-actions">
                          <el-button size="small" :type="scriptUI.focusWriting ? 'primary' : ''" @click="scriptUI.focusWriting = !scriptUI.focusWriting" :title="scriptUI.focusWriting ? '退出专注模式' : '专注模式：隐藏原文对照，居中沉浸写剧本'">
                            <AppIcon name="eye" /><span>{{ scriptUI.focusWriting ? '退出专注' : '专注写作' }}</span>
                          </el-button>
                          <el-button size="small" :type="isEpisodeStale(selectedEpisode) ? 'warning' : 'primary'" :loading="scriptUI.genEpisode === selectedEpisode.id" @click="generateEpisode(selectedEpisode.id)"><AppIcon name="wand-sparkles" /><span>{{ selectedEpisode.content ? (isEpisodeStale(selectedEpisode) ? '原文已改·重生成' : '重生成') : '生成剧本' }}</span></el-button>
                          <el-button size="small" text :disabled="!selectedEpisode.content" @click="exportScript('script','txt',{ episodeId: selectedEpisode.id })"><AppIcon name="download" /><span>导出</span></el-button>
                          <el-button
                            size="small"
                            type="danger"
                            plain
                            :loading="scriptUI.deletingEpisode === selectedEpisode.id"
                            :disabled="!!scriptUI.deletingEpisode || scriptUI.genEpisode === selectedEpisode.id || isStoryboardGenerating(selectedEpisode.id) || scriptUI.batchGen.active || scriptUI.adaptingWholeNovel || !!scriptUI.splitting || !!scriptUI.genWhole || (sbEpisodeId === selectedEpisode.id && (videoQueue.processing || shotTimeline.busy || aiBinding.running))"
                            title="删除本集及关联分镜和视频"
                            @click="deleteEpisode(selectedEpisode)"
                          >
                            <AppIcon name="trash-2" /><span>删除本集</span>
                          </el-button>
                        </div>
                      </header>
                      <el-alert v-if="isEpisodeStale(selectedEpisode)" type="warning" :closable="false" show-icon title="本集切片原文在生成后有改动，当前剧本可能已过时，建议重新生成。" style="margin-bottom:14px" />
                      <div class="cut-editor" v-if="selectedEpisode && selectedChapter && !scriptUI.focusWriting">
                        <span class="cut-editor-title"><AppIcon name="scissors" />本集在原文中的切片范围</span>
                        <label class="cut-field">
                          <span>起始字符</span>
                          <el-input-number v-model="selectedEpisode.startOffset" size="small" :min="0" :max="(selectedChapter.sourceText || '').length" controls-position="right" />
                        </label>
                        <label class="cut-field">
                          <span>结束字符</span>
                          <el-input-number v-model="selectedEpisode.endOffset" size="small" :min="0" :max="(selectedChapter.sourceText || '').length" controls-position="right" />
                        </label>
                        <span class="cut-len">共 {{ Math.max(0, (selectedEpisode.endOffset || 0) - (selectedEpisode.startOffset || 0)) }} 字 / 全章 {{ (selectedChapter.sourceText || '').length }} 字</span>
                        <el-button size="small" type="primary" plain @click="recutEpisode(selectedEpisode, selectedEpisode.startOffset, selectedEpisode.endOffset)"><AppIcon name="check" /><span>保存切点</span></el-button>
                      </div>
                      <div v-if="scriptUI.scriptProgress && scriptUI.scriptProgress.episodeId === selectedEpisode.id" class="script-progress">
                        <div class="script-progress-head">
                          <span>{{ scriptUI.scriptProgress.text }}</span>
                          <small>{{ scriptUI.scriptProgress.percentage }}%</small>
                        </div>
                        <el-progress :percentage="scriptUI.scriptProgress.percentage" :status="scriptUI.scriptProgress.status === 'retry' ? 'warning' : ''" />
                      </div>
                      <div class="duo-grid">
                        <div class="duo-col">
                          <div class="duo-head">
                            <span>本集原文</span>
                            <small class="duo-count">{{ (selectedSlice || '').length }} 字</small>
                          </div>
                          <pre class="duo-text">{{ selectedSlice || '（无切片）' }}</pre>
                        </div>
                        <div class="duo-col duo-col-script">
                          <div class="duo-head">
                            <span>剧本</span>
                            <small class="duo-count">{{ (selectedEpisode.content || '').length }} 字</small>
                            <small v-if="scriptUI.saveState === 'saving'" class="save-state saving"><AppIcon name="loader-circle" />保存中…</small>
                            <small v-else-if="scriptUI.saveState === 'saved'" class="save-state saved"><AppIcon name="check" />已保存</small>
                          </div>
                          <el-input v-model="selectedEpisode.content" type="textarea" class="duo-editor" :autosize="{ minRows: 22 }" resize="none" placeholder="剧本正文" @input="onScriptContentChange" />
                        </div>
                      </div>
                      <footer class="cockpit-status">
                        <span>原文 <b>{{ (selectedSlice || '').length }}</b> 字</span>
                        <i class="cockpit-status-arrow" aria-hidden="true">→</i>
                        <span>剧本 <b>{{ (selectedEpisode.content || '').length }}</b> 字</span>
                        <span v-if="(selectedSlice || '').length" class="cockpit-ratio">改编密度 {{ Math.round((selectedEpisode.content || '').length / (selectedSlice || ' ').length * 100) }}%</span>
                        <span class="cockpit-status-fill"></span>
                        <span v-if="scriptUI.saveState === 'saving'" class="save-state saving">保存中…</span>
                        <span v-else-if="scriptUI.saveState === 'saved'" class="save-state saved">已保存</span>
                        <el-button size="small" text type="primary" :disabled="!selectedEpisode.content" @click="scriptUI.stage = 'storyboard'; sbEpisodeId = selectedEpisode.id" title="带着这一集直接去分镜台">
                          <span>去分镜</span><AppIcon name="arrow-right" />
                        </el-button>
                      </footer>
                    </div>
                    <div v-else-if="selectedChapter" class="editor-cockpit">
                      <header class="cockpit-head">
                        <div class="cockpit-title">
                          <div class="eyebrow">章节原文</div>
                          <h2>{{ selectedChapter.title }}</h2>
                        </div>
                        <div class="cockpit-actions">
                          <el-button size="small" :disabled="scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" @click="updateChapter(selectedChapter)">保存原文</el-button>
                          <el-button size="small" type="primary" :loading="scriptUI.genWhole === selectedChapter.id" :disabled="scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" @click="generateWholeChapter(selectedChapter)"><AppIcon name="wand-sparkles" /><span>整章直接生成</span></el-button>
                          <el-button size="small" :loading="scriptUI.splitting === selectedChapter.id" :disabled="scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" @click="splitChapter(selectedChapter)">{{ episodesOfChapter(selectedChapter.id).length ? '重新分集' : '分集' }}</el-button>
                          <el-button size="small" type="danger" plain :disabled="scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" @click="deleteChapter(selectedChapter)"><AppIcon name="trash-2" /><span>删除</span></el-button>
                        </div>
                      </header>
                      <el-input v-model="selectedChapter.title" size="small" placeholder="章节标题" class="field-gap" :disabled="scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" />
                      <el-input v-model="selectedChapter.sourceText" type="textarea" :rows="20" resize="none" class="field-gap" :disabled="scriptUI.adaptingWholeNovel || scriptUI.batchGen.active" />
                      <div v-if="scriptUI.genWhole === selectedChapter.id && scriptUI.scriptProgress" class="script-progress" style="margin-top:12px">
                        <div class="script-progress-head">
                          <span>{{ scriptUI.scriptProgress.text }}</span>
                          <small>{{ scriptUI.scriptProgress.percentage }}%</small>
                        </div>
                        <el-progress :percentage="scriptUI.scriptProgress.percentage" :status="scriptUI.scriptProgress.status === 'retry' ? 'warning' : ''" />
                      </div>
                    </div>
                    <div v-else class="empty-state">
                      <AppIcon name="book-open" />
                      <span>在上方胶片带里点一格剧集，或点章节页签编辑原文</span>
                    </div>
                  </section>
                </section>

                <section v-show="scriptUI.stage === 'storyboard'" class="storyboard-stage">
                  <!-- 导演台：集切换 + 出片环 + 两个主行动，其余全部收进开关面板 -->
                  <div class="sb-console">
                    <div v-if="videoDurationSummary" class="sb-duration-stats">
                      <span class="sb-duration-total" :title="'分镜 ' + videoDurationSummary.shots + ' 镜 · 已出片 ' + videoDurationSummary.producedShots + ' 镜 · 计划总时长 ' + formatDurationMinutes(videoDurationSummary.plannedSeconds)">
                        <AppIcon name="clock" />
                        已成片 <b>{{ formatDurationMinutes(videoDurationSummary.producedSeconds) }}</b>
                        <small>{{ videoDurationSummary.producedShots }}/{{ videoDurationSummary.shots }} 镜 · {{ videoDurationSummary.episodes }} 集</small>
                      </span>
                      <span class="sb-duration-range">
                        <span>统计范围</span>
                        <input v-model="durationStatRange.from" type="number" min="1" placeholder="起始集" aria-label="统计起始集数" />
                        <i>—</i>
                        <input v-model="durationStatRange.to" type="number" min="1" placeholder="结束集" aria-label="统计结束集数" />
                        <span>集</span>
                        <b v-if="durationStatsRange">
                          {{ formatDurationMinutes(durationStatsRange.producedSeconds) }}
                          <small>（{{ durationStatsRange.producedShots }} 镜 / 计划 {{ formatDurationMinutes(durationStatsRange.plannedSeconds) }}）</small>
                        </b>
                        <button v-if="durationStatsRange" type="button" class="sb-duration-clear" @click="durationStatRange.from = ''; durationStatRange.to = ''">清除</button>
                      </span>
                    </div>
                    <div class="sb-console-row">
                      <div class="sb-ep-pills">
                        <div v-for="ep in sbSortedEpisodes" :key="ep.id" :class="['sb-ep-item', { active: sbEpisodeId === ep.id }]">
                          <button
                            :class="['sb-ep-pill', {
                              active: sbEpisodeId === ep.id,
                              'has-sb': !!findStoryboard(ep.id),
                              'video-partial': sbVideoStatusMap[ep.id]?.state === 'partial',
                              'video-full': sbVideoStatusMap[ep.id]?.state === 'full',
                            }]"
                            :title="episodeVideoTitle(ep.id)"
                            @click="sbEpisodeId = ep.id"
                          >
                            <span class="dot"></span>
                            <span>{{ ep.id }} · {{ ep.title }}</span>
                            <i v-if="sbVideoStatusMap[ep.id]?.done" class="sb-ep-video-count">{{ sbVideoStatusMap[ep.id].done }}/{{ sbVideoStatusMap[ep.id].total }}</i>
                          </button>
                          <span v-if="sbEpisodeId === ep.id" class="sb-ep-actions" @click.stop>
                            <button type="button" class="sb-ep-action is-danger" title="删除本集及关联分镜和视频" aria-label="删除本集" :disabled="episodeActionsBusy(ep)" @click="deleteEpisode(ep)">
                              <el-icon :class="{ 'is-loading': scriptUI.deletingEpisode === ep.id }"><Loading v-if="scriptUI.deletingEpisode === ep.id" /><Delete v-else /></el-icon>
                            </button>
                          </span>
                        </div>
                        <button class="sb-ep-pill sb-ep-add" :disabled="scriptUI.creatingEpisode" title="新增集数；有空缺编号时优先补齐" @click="createEpisodeDirect">
                          <AppIcon name="loader-circle" />
                          <AppIcon name="plus" />
                          <span>新增集数</span>
                        </button>
                      </div>
                      <div class="sb-console-side">
                        <div v-if="currentShots.length" class="sb-progress-orbit" :title="'本集出片进度：' + completedShotVideoCount + ' / ' + currentShots.length">
                          <svg viewBox="0 0 44 44" aria-hidden="true">
                            <circle class="orbit-track" cx="22" cy="22" r="18" />
                            <circle class="orbit-fill" cx="22" cy="22" r="18"
                                    :stroke-dasharray="(completedShotVideoCount / currentShots.length * 113.1) + ' 113.1'" />
                          </svg>
                          <div class="sb-progress-copy">
                            <b>{{ completedShotVideoCount }}<i>/{{ currentShots.length }}</i></b>
                            <small>已出片</small>
                          </div>
                        </div>
                        <el-button v-if="selectedSbStoryboard && currentShots.length" size="small" type="primary" plain @click="openVideoOverview" title="打开本集视频总览，集中查看所有镜头视频">
                          <AppIcon name="film" /><span>视频总览 {{ completedShotVideoCount }}/{{ currentShots.length }}</span>
                        </el-button>
                        <el-button v-if="selectedSbStoryboard && currentShots.length" size="small" @click="openBindingOverview" title="集中核对本集所有分镜的元素绑定和素材图片">
                          <AppIcon name="cable" /><span>绑定总览 <template v-if="bindingOverviewSummary.issues">· {{ bindingOverviewSummary.issues }} 项待查</template></span>
                        </el-button>
                        <el-button size="small" :loading="isStoryboardGenerating(sbEpisodeId)" :disabled="!selectedSbEpisode || !selectedSbEpisode.content" @click="generateStoryboard(sbEpisodeId, 'normal')"><AppIcon name="video" /><span>{{ selectedSbStoryboard ? '重生成分镜' : '生成分镜' }}</span></el-button>
                        <el-button v-if="selectedSbStoryboard" type="primary" size="small" :loading="batchVideoRunning" @click="generateAllShotVideos">
                          <AppIcon name="film" /><span>一键生成本集视频</span>
                        </el-button>
                        <el-button size="small" type="success" plain :disabled="batchAll.running" :loading="batchAll.running" @click="openBatchAllDialog" title="从章节顺序的第一集开始，逐集自动生成分镜；可选择同时逐镜首尾帧串联生成视频，直到最后一集">
                          <AppIcon name="play" /><span>一键全集串行</span>
                        </el-button>
                        <span class="sb-export-range">
                          <el-button size="small" plain :loading="videoExporting" @click="exportVideoRange" title="把已完成的分镜视频复制到「下载/Freedom成片/项目名/」；填了起止集数就只导出该范围，两端留空=全部集">
                            <AppIcon name="download" /><span>导出成片</span>
                          </el-button>
                          <input v-model="videoExportRange.from" type="number" min="1" placeholder="起始集" aria-label="导出起始集数" />
                          <i>—</i>
                          <input v-model="videoExportRange.to" type="number" min="1" placeholder="结束集" aria-label="导出结束集数" />
                        </span>
                        <el-button size="small" plain @click="openSceneGapDialog" title="扫描分镜里的场景标记，找出元素库缺失的场景并一键补建（名字与分镜逐字一致）">
                          <AppIcon name="search" /><span>场景补漏</span>
                        </el-button>
                        <el-button v-if="selectedSbStoryboard" size="small" plain :disabled="batchVideoRunning || sequentialRunning" @click="openVideoRangeDialog" title="只提交指定镜号范围内的视频任务，已生成或已提交的镜头会自动跳过">
                          <AppIcon name="film" /><span>自定义范围</span>
                        </el-button>
                        <el-button
                          v-if="selectedSbStoryboard"
                          size="small"
                          plain
                          :loading="episodeVideoAction === 'refetch'"
                          :disabled="!!episodeVideoAction"
                          @click="refetchAllShotVideos"
                          title="重新查询本集所有已提交、生成中或失败的视频任务，并把已出片结果拉回本地"
                        >
                          <AppIcon name="refresh-cw" /><span>一键重新抓取</span>
                        </el-button>
                        <el-button
                          v-if="selectedSbStoryboard"
                          size="small"
                          type="danger"
                          plain
                          :loading="episodeVideoAction === 'remove'"
                          :disabled="!!episodeVideoAction"
                          @click="forceRemoveAllShotTracking"
                          title="强制移除本集所有视频的本地排队与结果追踪；平台已接收的任务可能仍会继续生成"
                        >
                          <AppIcon name="x" /><span>一键强制移除</span>
                        </el-button>
                        <el-button v-if="pendingShotVideoCount" type="danger" plain size="small" @click="clearAllPending" title="只取消尚未发送到平台的本地排队；已发送任务继续自动抓取">
                          <AppIcon name="trash-2" /><span>取消未发送（{{ pendingShotVideoCount }}）</span>
                        </el-button>
                      </div>
                    </div>
                    <div class="sb-console-row sb-console-foot">
                      <div class="atelier-toggles">
                        <button :class="['atelier-toggle', { on: scriptUI.sbPanel === 'brief' }]" @click="scriptUI.sbPanel = scriptUI.sbPanel === 'brief' ? '' : 'brief'"><AppIcon name="settings" /><span>分镜设置</span></button>
                        <button :class="['atelier-toggle', { on: shotTimeline.visible }]" @click="shotTimeline.visible = !shotTimeline.visible" title="打开或收起镜头排序、筛选和批量管理面板"><AppIcon name="list" /><span>镜头管理</span></button>
                        <button :class="['atelier-toggle', { on: scriptUI.sbPanel === 'engine' }]" @click="scriptUI.sbPanel = scriptUI.sbPanel === 'engine' ? '' : 'engine'"><AppIcon name="video" /><span>视频引擎</span><small class="sb-toggle-mark">{{ currentVideoProviderLabel }}</small></button>
                        <button :class="['atelier-toggle', { on: scriptUI.customPromptPanel }]" @click="scriptUI.customPromptPanel = !scriptUI.customPromptPanel"><AppIcon name="toggle-left" /><span>提示词</span></button>
                        <button :class="['atelier-toggle', { on: scriptUI.importingStoryboard }]" @click="scriptUI.importingStoryboard ? cancelImportStoryboard() : startImportStoryboard()"><AppIcon name="upload" /><span>导入分镜</span></button>
                        <button :class="['atelier-toggle', { on: scriptUI.sbPanel === 'tools' }]" @click="scriptUI.sbPanel = scriptUI.sbPanel === 'tools' ? '' : 'tools'"><AppIcon name="folder-open" /><span>导出与工具</span></button>
                      </div>
                      <div v-if="selectedSbStoryboard" class="sb-console-batch">
                        <el-button size="small" :loading="aiBinding.running && aiBinding.scope === 'all'" :disabled="aiBinding.running && aiBinding.scope !== 'all'" @click="runAiElementBinding({ scope: 'all' })" title="让AI重新推理本集全部分镜应绑定的人物、场景、道具和特效">
                          <AppIcon name="wand-sparkles" /><span>{{ aiBinding.running && aiBinding.scope === 'all' ? 'AI绑定中…' : 'AI绑定全部' }}</span>
                        </el-button>
                        <el-button size="small" :disabled="aiBinding.running" @click="openAiBindRangeDialog" title="只对指定镜号范围重新推理元素绑定">
                          <AppIcon name="wand-sparkles" /><span>范围绑定</span>
                        </el-button>
                        <el-button size="small" @click="openBatchCharacterLookDialog" title="只在当前集批量指定一段分镜的人物造型">
                          <AppIcon name="user-round" /><span>批量造型</span>
                        </el-button>
                        <el-button v-if="!sequentialRunning" size="small" :loading="batchVideoRunning && !sequentialRunning" :disabled="batchVideoRunning" @click="generateAllShotVideosSequential" title="按顺序逐镜生成：上一镜出片后自动截取尾帧作为下一镜开场参考图，画面更连贯（较慢）">
                          <AppIcon name="film" /><span>一键首尾帧</span>
                        </el-button>
                        <el-button v-else size="small" type="warning" @click="stopSequentialGeneration">
                          <AppIcon name="pause" /><span>停止首尾帧</span>
                        </el-button>
                        <el-button size="small" :disabled="batchVideoRunning && !sequentialRunning" @click="openRangeSequentialDialog()" title="只对指定镜号范围做尾帧衔接顺序生成；当前正在生成时可继续追加范围">
                          <AppIcon name="film" /><span>{{ sequentialRunning ? ('追加首尾帧' + (sequentialPendingCount ? '（待' + sequentialPendingCount + '）' : '')) : '范围首尾帧' }}</span>
                        </el-button>
                      </div>
                    </div>
                  </div>

                  <el-button size="small" plain @click="reconcileUpstreamVideos" title="扫描上游（rolldek）任务，把提交成功但本地缺失的视频拉回落盘">
                <AppIcon name="download" /><span>从上游找回视频</span>
              </el-button>
              <!-- 一键全集串行：运行状态条（内嵌不锁界面） -->
                  <div v-if="batchAll.running" class="batch-all-strip">
                    <AppIcon name="loader-circle" />
                    <span class="batch-all-copy">
                      <b>全集串行</b>
                      <span>{{ batchPhaseLabel }}</span>
                      <span class="batch-all-ep">当前：第{{ batchAll.episodeId }}集「{{ batchAll.episodeTitle }}」</span>
                      <span v-if="batchAll.stage === 'video' && batchAll.useBudget" style="color:var(--gold,#d4a960)">产出 {{ batchAll.shotsGenerated }}/{{ shotBudget }} 镜</span>
                    </span>
                    <el-progress :percentage="batchAllPercent" :stroke-width="8" style="flex:1;min-width:120px" />
                    <el-button size="small" type="danger" plain @click="stopBatchAll" title="完成当前任务后不再继续">
                      <AppIcon name="pause" /><span>停止</span>
                    </el-button>
                  </div>

                  <!-- 一键全自动生成：运行状态条（内嵌不锁界面） -->
                  <div v-if="autoPipeline.running" class="batch-all-strip">
                    <AppIcon name="loader-circle" />
                    <span class="batch-all-copy">
                      <b>⚡ 一键生成</b>
                      <span>{{ autoPipelinePhaseLabel }}</span>
                    </span>
                    <el-progress :percentage="autoPipelineStagePercent" :stroke-width="8" style="flex:1;min-width:120px" />
                    <el-button size="small" type="danger" plain @click="stopAutoPipeline" title="完成当前任务后不再继续">
                      <AppIcon name="pause" /><span>停止</span>
                    </el-button>
                  </div>

                  <!-- 面板：分镜生成设置 -->
                  <div v-if="scriptUI.sbPanel === 'brief'" class="atelier-panel">
                    <div class="atelier-params">
                      <label v-if="!isCustomStoryboardPromptMode" class="atelier-param">
                        <span>提示词套装</span>
                        <el-select v-model="storyboardPromptTemplateId" size="small" style="width:200px">
                          <el-option v-for="tpl in storyboardPromptTemplates" :key="tpl.id" :label="tpl.name" :value="tpl.id" />
                        </el-select>
                      </label>
                      <label v-if="!isCustomStoryboardPromptMode" class="atelier-param">
                        <span>Q版视觉</span>
                        <el-switch
                          v-model="scriptState.settings.useQVersion"
                          size="small"
                          active-text="开"
                          inactive-text="关"
                          @change="onScriptSettingChange"
                        />
                      </label>
                      <label class="atelier-param">
                        <span>隐藏提示词</span>
                        <el-switch
                          v-model="scriptState.settings.hideStoryboardPrompts"
                          size="small"
                          active-text="隐藏"
                          inactive-text="显示"
                          @change="clearShotPromptReveals(); onScriptSettingChange()"
                        />
                      </label>
                      <div class="atelier-param storyboard-prefix-manager">
                        <div class="storyboard-prefix-head">
                          <span>视频提示词前缀</span>
                          <small v-if="appliedShotHeaderPrefix" :title="appliedShotHeaderPrefix">本集已应用 · {{ appliedShotHeaderPrefix.length }} 字</small>
                          <small v-else>本集未应用</small>
                        </div>
                        <el-input
                          v-model="shotHeaderPrefix"
                          type="textarea"
                          :autosize="{ minRows: 2, maxRows: 8 }"
                          resize="vertical"
                          maxlength="4000"
                          show-word-limit
                          placeholder="输入需要放在每个分镜开头的长提示词"
                          @input="saveSettingsDebounced"
                        />
                        <div class="storyboard-prefix-actions">
                          <el-button size="small" type="primary" :disabled="!String(shotHeaderPrefix || '').trim()" @click="addShotHeaderPrefixToAll">
                            <AppIcon name="plus" /><span>添加到全部</span>
                          </el-button>
                          <el-button size="small" type="primary" plain :disabled="!String(shotHeaderPrefix || '').trim()" @click="addShotHeaderPrefixToAllEpisodes">
                            <AppIcon name="files" /><span>应用到所有章节</span>
                          </el-button>
                          <el-button size="small" :disabled="!appliedShotHeaderPrefix || !String(shotHeaderPrefix || '').trim()" @click="replaceShotHeaderPrefixForAll">
                            <AppIcon name="refresh-cw" /><span>替换全部</span>
                          </el-button>
                          <el-button size="small" type="danger" plain :disabled="!appliedShotHeaderPrefix" @click="clearShotHeaderPrefix">
                            <AppIcon name="trash-2" /><span>删除全部</span>
                          </el-button>
                        </div>
                      </div>
                      <div class="atelier-param">
                        <span>当前提示词</span>
                        <div class="prompt-status-strip">
                          <span :class="['prompt-status-chip', { 'is-custom': isCustomScriptPromptMode }]">
                            <AppIcon name="pen-line" /><span>剧本：{{ scriptPromptStatusText }}</span>
                          </span>
                          <span :class="['prompt-status-chip', { 'is-custom': isCustomStoryboardPromptMode }]">
                            <AppIcon name="video" /><span>分镜：{{ storyboardPromptStatusText }}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 面板：视频引擎 -->
                  <div v-if="scriptUI.sbPanel === 'engine' && selectedSbStoryboard" class="atelier-panel">
                    <div class="atelier-params">
                      <label class="atelier-param">
                        <span>视频引擎</span>
                        <el-radio-group v-model="videoBar.provider" size="small" @change="rememberVideoProvider">
                          <el-radio-button v-for="item in videoProviderOptions" :key="item.value" :label="item.value">{{ item.label }}</el-radio-button>
                        </el-radio-group>
                      </label>
                      <label v-if="videoBar.provider === 'xiaoyunque'" class="atelier-param">
                        <span>线路</span>
                        <el-select v-model="videoBar.xiaoyunqueAccountId" size="small" placeholder="自动选择线路" clearable style="width:180px" @change="rememberVideoSettings">
                          <el-option label="自动选择线路" value="" />
                          <el-option v-for="a in cfg.video.xiaoyunqueAccounts" :key="a.id" :label="a.name || a.id" :value="a.id" />
                        </el-select>
                      </label>
                      <label v-if="videoBar.provider === 'dreamina-agent'" class="atelier-param">
                        <span>出片账号</span>
                        <el-select v-model="videoBar.dreaminaAgentAccountId" size="small" placeholder="选择即梦账号" style="width:180px" @change="rememberVideoSettings">
                          <el-option v-for="account in cfg.video.dreaminaAgentAccounts" :key="account.id" :label="account.name || account.id" :value="account.id" />
                        </el-select>
                      </label>
                      <label v-if="videoBar.provider === 'neowow'" class="atelier-param">
                        <span>出片账号</span>
                        <el-select v-model="videoBar.neowowAccountId" size="small" placeholder="自动分配" style="width:280px" @change="rememberVideoSettings">
                          <el-option :label="neowowAutoAccountLabel()" value="" />
                          <el-option
                            v-for="account in cfg.video.neowowAccounts"
                            :key="account.id"
                            :label="neowowAccountOptionLabel(account)"
                            :value="account.id"
                            :disabled="!account.hasToken || account.enabled === false || ['expired', 'logged_out', 'invalid', 'logging_in'].includes(account.status) || (account.points != null && Number(account.points) <= 0)"
                          />
                        </el-select>
                      </label>
                      <label v-if="videoBar.provider !== 'dreamina-agent'" class="atelier-param">
                        <span>{{ videoBar.provider === 'comfyui' ? '工作流' : '模型' }}</span>
                        <el-select v-if="videoBar.provider === 'xiaoyunque'" v-model="videoBar.xiaoyunqueModel" size="small" placeholder="模型" style="width:210px" @change="rememberVideoSettings">
                          <el-option v-for="m in xiaoyunqueModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                        <el-select v-else-if="videoBar.provider === 'updream'" v-model="videoBar.updreamModel" size="small" placeholder="模型" style="width:190px" @change="rememberVideoSettings">
                          <el-option v-for="m in updreamModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                        <el-select v-else-if="videoBar.provider === 'neowow'" v-model="videoBar.neowowModel" size="small" placeholder="模型" style="width:210px" @change="rememberVideoSettings">
                          <el-option v-for="m in neowowModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                        <el-select v-else-if="videoBar.provider === 'libtv-cli'" v-model="videoBar.libtvModel" size="small" placeholder="选择模型" style="width:210px" @change="rememberVideoSettings">
                          <el-option v-for="m in libtvModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                        <el-select v-else-if="videoBar.provider === 'comfyui'" v-model="videoBar.comfyuiWorkflowPreset" size="small" placeholder="选择工作流" style="width:230px" @change="rememberVideoSettings">
                          <el-option v-for="item in comfyUiWorkflowOptions" :key="item.value" :label="item.label" :value="item.value" />
                        </el-select>
                        <el-select v-else-if="videoBar.provider === 'video-api'" v-model="videoBar.apiModel" filterable allow-create default-first-option size="small" placeholder="选择或输入模型" style="width:180px" @change="rememberVideoSettings">
                          <el-option v-for="m in videoBarApiModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                        <el-select v-else v-model="videoBar.dreaminaModel" size="small" placeholder="模型" style="width:190px" @change="rememberVideoSettings">
                          <el-option v-for="m in dreaminaModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                      </label>
                      <div v-else class="atelier-param">
                        <span>固定规格</span>
                        <span class="vs-credit"><span>{{ videoBar.dreaminaAgentPromptPreset === 'fast' ? 'Seedance 2.0fast · 非VIP非2.0 · 15秒 · 16:9' : 'Seedance 2.0 · 非VIP非fast · 15秒 · 16:9' }} · 间隔 {{ videoBar.dreaminaAgentShotIntervalSeconds || 80 }}秒</span></span>
                      </div>
                      <label v-if="videoBar.provider !== 'dreamina-agent'" class="atelier-param">
                        <span>画幅</span>
                        <el-select v-model="videoBar.aspectRatio" size="small" style="width:96px" @change="rememberVideoSettings">
                          <el-option v-for="r in ['16:9','9:16','4:3','3:4','1:1','21:9']" :key="r" :label="r" :value="r" />
                        </el-select>
                      </label>
                      <label v-if="videoBar.provider !== 'dreamina-agent'" class="atelier-param">
                        <span>清晰度</span>
                        <el-select v-model="videoBar.resolution" size="small" style="width:96px" @change="rememberVideoSettings">
                          <el-option v-for="r in videoBarResolutionOptions" :key="r.value" :label="r.label" :value="r.value" />
                        </el-select>
                      </label>
                      <label v-if="videoBar.provider !== 'dreamina-agent'" class="atelier-param">
                        <span>素材图</span>
                        <el-select v-model="videoBar.videoMode" size="small" style="width:110px" @change="rememberVideoSettings">
                          <el-option label="原图" value="mention" />
                          <el-option label="红字图" value="label" />
                        </el-select>
                      </label>
                      <div v-else class="atelier-param">
                        <span>素材引用</span>
                        <span class="vs-credit"><span>官网 @ 主体实体</span></span>
                      </div>
                      <div class="atelier-param">
                        <span>账号状态</span>
                        <span class="vs-credit"><AppIcon name="key-round" /><span>{{ currentVideoAccountSummary }}</span></span>
                      </div>
                      <div class="atelier-param atelier-param-danger">
                        <span>本集设置</span>
                        <div class="inline-actions">
                          <el-button size="small" @click="saveVideoBar">应用到本集</el-button>
                          <el-button size="small" text type="info" @click="resetVideoBar" title="清空本集视频设置，恢复全局默认">重置</el-button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 面板：导出与工具 -->
                  <div v-if="scriptUI.sbPanel === 'tools'" class="atelier-panel">
                    <div class="atelier-params">
                      <div class="atelier-param">
                        <span>导出</span>
                        <div class="inline-actions">
                          <el-button size="small" :disabled="!selectedSbStoryboard" @click="exportScript('storyboard','txt',{ episodeId: sbEpisodeId })"><AppIcon name="download" /><span>导出本集分镜 TXT</span></el-button>
                          <el-button size="small" @click="exportScript('storyboard','txt',{ fromEpisodeId: videoExportRange.from, toEpisodeId: videoExportRange.to, merged: true })" title="把所选范围内的分镜合并成一个 TXT。集数范围用工具栏上的「起始集 — 结束集」，两端留空=导出全部集。"><AppIcon name="download" /><span>导出范围分镜 TXT（合并）</span></el-button>
                          <el-button size="small" :loading="exportingShots" :disabled="!selectedSbStoryboard" @click="exportShotCards"><AppIcon name="folder-open" /><span>导出卡片分镜</span></el-button>
                          <el-button size="small" @click="exportToJianying"><AppIcon name="upload" /><span>导出到剪映</span></el-button>
                        </div>
                      </div>
                      <div class="atelier-param">
                        <span>文件</span>
                        <div class="inline-actions">
                          <el-button size="small" @click="openVideoFolder"><AppIcon name="folder" /><span>视频文件夹</span></el-button>
                        </div>
                      </div>
                      <div class="atelier-param atelier-param-danger">
                        <span>危险操作</span>
                        <div class="inline-actions">
                          <el-button size="small" type="danger" text @click="clearAllPending" title="取消本集所有未完成的视频排队；已提交官网的任务可能仍会继续生成"><AppIcon name="trash-2" /><span>取消本集排队</span></el-button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="scriptUI.stage === 'storyboard' && scriptUI.customPromptPanel" class="custom-prompt-panel">
                  ${scriptPromptPanelBody}
                  </div>

                  <div v-if="scriptUI.importingStoryboard" class="atelier-panel">
                    <div class="section-title"><AppIcon name="upload" /><span>导入分镜</span></div>
                    <el-alert type="info" :closable="false" style="margin-bottom:8px">
                      <template #default>
                        <div style="font-size:12px;line-height:1.6">
                          • 可直接<strong>拖入</strong>或<strong>选择 .txt 文件</strong>，也可把文本<strong>粘贴</strong>到下面的输入框<br/>
                          • 系统会自动识别切割标记（如 <strong>生成段落1：…</strong> 会切成多个镜头），识别不到时再手动填<br/>
                          • 标记可自定义（如 <strong>分镜</strong>、<strong>镜头</strong>、<strong>场景</strong>），序号后的 ：、. 、空格都兼容<br/>
                          • 导入后按出现顺序统一编号，原文编号重复或乱序也会自动变为 <strong>分镜1、分镜2、分镜3…</strong><br/>
                          • 选中某集就导入到该集（覆盖原分镜）；没选中集时自动新建一集承载
                        </div>
                      </template>
                    </el-alert>
                    <div
                      class="dropzone"
                      :class="{ 'is-dragover': scriptUI.sbImportDragOver }"
                      style="margin-bottom:8px;padding:14px;border:1px dashed var(--line);border-radius:8px;text-align:center;cursor:pointer"
                      @click="$refs.sbImportFileInput.click()"
                      @dragover.prevent="scriptUI.sbImportDragOver = true"
                      @dragleave.prevent="scriptUI.sbImportDragOver = false"
                      @drop="onStoryboardImportDrop"
                    >
                      <AppIcon name="upload" />
                      <span style="font-size:12px;margin-left:6px">拖入或点击选择 .txt 分镜文件</span>
                      <input ref="sbImportFileInput" type="file" accept=".txt,text/plain" multiple style="display:none" @change="onPickStoryboardImportFile" />
                    </div>
                    <div class="vs-controls" style="margin-bottom:8px">
                      <span style="font-weight:600;color:var(--ink);min-width:80px">切割标记</span>
                      <el-input v-model="scriptUI.sbImportMarker" size="small" placeholder="自动识别 / 分镜" style="width:160px" @input="scriptUI.sbMarkerTouched = true" />
                      <span style="font-weight:600;color:var(--ink);min-width:80px;margin-left:12px">新建集标题</span>
                      <el-input v-model="scriptUI.sbImportTitle" size="small" placeholder="（选填，没选中集时用）" style="width:220px" />
                    </div>
                    <el-input v-model="scriptUI.sbImportContent" type="textarea" :rows="10" resize="vertical" placeholder="拖入 .txt 文件，或把分镜文本粘贴到这里，例如：&#10;生成段落1：…&#10;生成段落2：…" @input="onStoryboardImportInput" />
                    <div class="inline-actions" style="margin-top:8px">
                      <el-button type="primary" size="small" :loading="scriptUI.importingSb" @click="confirmImportStoryboard"><AppIcon name="upload" /><span>导入</span></el-button>
                      <el-button size="small" @click="cancelImportStoryboard">取消</el-button>
                    </div>
                  </div>

                  <!-- 实时状态：视频进度 / 提交槽位 / 待提交队列 -->
                  <div v-if="selectedSbStoryboard && (videoProgress.active || (batchVideoRunning && batchVideoProgress))" class="atelier-strip">
                    <div class="script-progress-head">
                      <span>{{ videoProgress.label || '视频生成' }} · {{ currentVideoProviderLabel }}</span>
                      <small v-if="videoProgress.total">{{ videoProgress.current }} / {{ videoProgress.total }}</small>
                      <small v-else>{{ videoProgress.percentage }}%</small>
                    </div>
                    <el-progress class="theme-running-progress" :style="{ '--runner-progress': (videoProgress.percentage || 0) + '%' }" :percentage="videoProgress.percentage" :status="videoProgress.status || ''" :indeterminate="videoProgress.indeterminate" />
                    <p v-if="videoProgress.detail || batchVideoProgress" class="atelier-strip-detail">{{ videoProgress.detail || batchVideoProgress }}</p>
                  </div>
                  <div v-if="selectedSbStoryboard && schedulerSlots.length > 0" class="scheduler-slots">
                    <div class="slot-header">提交槽位</div>
                    <div class="slot-list">
                      <div v-for="slot in schedulerSlots" :key="slot.accountId" class="slot-item" :class="'slot-' + slot.state">
                        <span class="slot-label">{{ slot.modelLabel || slot.model || slot.accountName || slot.accountId }}</span>
                        <span class="slot-status">
                          <template v-if="slot.state === 'submitting'">提交 #{{ slot.shotNo }}</template>
                          <template v-else-if="slot.state === 'waiting'">等待 #{{ slot.shotNo }}</template>
                          <template v-else-if="slot.state === 'idle'">空闲</template>
                          <template v-else>{{ slot.error || slot.state }}</template>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div v-if="selectedSbStoryboard && videoQueue.items.length > 0" class="vs-queue-status">
                    <div class="queue-info">
                      <AppIcon name="list" />
                      <span>待提交：</span>
                      <strong>{{ videoQueue.processing ? '提交中' : '待发车' }}</strong>
                      <span class="queue-count" style="cursor:pointer;text-decoration:underline" @click="videoQueueDialog = true">
                        （{{ videoQueue.items.length }} 个镜头，点击查看详情）
                      </span>
                    </div>
                    <div class="queue-actions">
                      <el-button v-if="videoQueue.processing" size="small" @click="pauseVideoQueue">
                        <AppIcon name="pause" /><span>暂停提交</span>
                      </el-button>
                      <el-button v-else size="small" type="primary" @click="processVideoQueue">
                        <AppIcon name="play" /><span>继续提交</span>
                      </el-button>
                      <el-button size="small" text type="danger" @click="clearVideoQueue">
                        <AppIcon name="trash-2" /><span>清空待提交</span>
                      </el-button>
                    </div>
                  </div>

                  <div v-if="scriptUI.storyboardProgress && scriptUI.storyboardProgress.episodeId === sbEpisodeId" class="script-progress">
                    <div class="script-progress-head">
                      <span>{{ scriptUI.storyboardProgress.text }}</span>
                      <small>{{ scriptUI.storyboardProgress.percentage }}%</small>
                    </div>
                    <el-progress :percentage="scriptUI.storyboardProgress.percentage" />
                  </div>

                  <div v-if="currentShots.length" class="shot-quick-filter-bar">
                    <div class="shot-quick-filter-copy">
                      <AppIcon name="list" />
                      <strong>分镜列表</strong>
                      <span>快速查看未生成或待处理镜头</span>
                    </div>
                    <div class="shot-attention-filter" role="group" aria-label="分镜快捷列表">
                      <button
                        type="button"
                        :class="{ active: shotTimeline.attentionFilter === 'all' }"
                        :aria-pressed="shotTimeline.attentionFilter === 'all'"
                        @click="setShotTimelineAttentionFilter('all')"
                      >全部 {{ currentShots.length }}</button>
                      <button
                        type="button"
                        :class="{ active: shotTimeline.attentionFilter === 'missing-video' }"
                        :aria-pressed="shotTimeline.attentionFilter === 'missing-video'"
                        @click="setShotTimelineAttentionFilter('missing-video')"
                      ><AppIcon name="pause" /><span>未生成 {{ shotTimelineMissingVideoCount }}</span></button>
                      <button
                        type="button"
                        :class="{ active: shotTimeline.attentionFilter === 'attention' }"
                        :aria-pressed="shotTimeline.attentionFilter === 'attention'"
                        @click="setShotTimelineAttentionFilter('attention')"
                      ><AppIcon name="circle-alert" /><span>待处理 {{ shotTimelineAttentionCount }}</span></button>
                    </div>
                    <div class="shot-custom-attention-group" title="输入多个镜号，一次加入待处理列表">
                      <span class="shot-timeline-tool-label">按镜号加入</span>
                      <el-input
                        v-model="shotTimeline.attentionInput"
                        size="small"
                        class="shot-custom-attention-input"
                        placeholder="如 13,19,18"
                        aria-label="按镜号加入待处理列表"
                        :disabled="shotTimeline.busy"
                        @keyup.enter="markShotAttentionFromInput"
                      />
                      <el-button size="small" type="warning" plain :disabled="shotTimeline.busy || !shotTimeline.attentionInput.trim()" @click="markShotAttentionFromInput">
                        <AppIcon name="circle-alert" /><span>加入待处理</span>
                      </el-button>
                    </div>
                    <el-button v-if="shotTimeline.visible" size="small" text @click="shotTimeline.visible = false">
                      <AppIcon name="x" /><span>收起管理</span>
                    </el-button>
                    <el-button v-else size="small" text @click="shotTimeline.visible = true">
                      <AppIcon name="settings" /><span>高级管理</span>
                    </el-button>
                  </div>
                  <div v-if="!shotTimeline.visible && shotTimelineAttentionCount && shotTimeline.attentionFilter !== 'missing-video'" class="shot-quick-attention-list">
                    <div class="shot-quick-attention-head">
                      <span><AppIcon name="circle-alert" /><strong>待处理分镜</strong><small>{{ shotTimelineAttentionCount }} 个</small></span>
                      <div>
                        <button type="button" title="上一条待处理分镜" aria-label="上一条待处理分镜" @click="previousShotAttention"><AppIcon name="arrow-left" /></button>
                        <button type="button" title="下一条待处理分镜" aria-label="下一条待处理分镜" @click="nextShotAttention"><AppIcon name="arrow-right" /></button>
                      </div>
                    </div>
                    <div class="shot-quick-attention-items">
                      <button
                        v-for="sh in shotTimelineAttentionShots"
                        :key="'quick-attention:' + sbEpisodeId + ':' + sh.no"
                        type="button"
                        :class="{ active: String(shotTimeline.activeAttentionNo) === String(sh.no) }"
                        :aria-current="String(shotTimeline.activeAttentionNo) === String(sh.no) ? 'true' : null"
                        :title="'跳转到镜头 ' + sh.no"
                        @click="setShotTimelineAttentionFilter('attention'); focusShotAttention(sh)"
                      ><b>#{{ sh.no }}</b><span>{{ sh.title || ('镜头 ' + sh.no) }}</span></button>
                    </div>
                  </div>

                  <!-- 横向可视化时间线按需展开：视频检查和待处理筛选可直接从上方快捷列表进入。 -->
                  <section v-if="shotTimeline.visible && currentShots.length" class="shot-timeline-panel" tabindex="0" @keydown="onShotTimelineKeydown">
                    <header class="shot-timeline-head">
                      <div>
                        <div class="eyebrow">Visual Timeline</div>
                        <h3>可视化镜头时间线</h3>
                        <p>拖拽调整顺序；Ctrl/⌘ 多选，Shift 连选，Alt+方向键移动，L 锁定</p>
                      </div>
                      <div class="shot-timeline-summary">
                        <span><b>{{ currentShots.length }}</b> 镜头</span>
                        <span><b>{{ shotTimelineTotalDuration }}</b> 秒</span>
                        <span><b>{{ shotTimelineSelectedCount }}</b> 已选</span>
                      </div>
                    </header>

                    <div class="shot-timeline-toolbar">
                      <div class="shot-attention-filter" role="group" aria-label="视频审核筛选">
                        <button
                          type="button"
                          :class="{ active: shotTimeline.attentionFilter === 'all' }"
                          :aria-pressed="shotTimeline.attentionFilter === 'all'"
                          @click="setShotTimelineAttentionFilter('all')"
                        >全部 {{ currentShots.length }}</button>
                        <button
                          type="button"
                          :class="{ active: shotTimeline.attentionFilter === 'missing-video' }"
                          :aria-pressed="shotTimeline.attentionFilter === 'missing-video'"
                          @click="setShotTimelineAttentionFilter('missing-video')"
                        ><AppIcon name="pause" /><span>未生成 {{ shotTimelineMissingVideoCount }}</span></button>
                        <button
                          type="button"
                          :class="{ active: shotTimeline.attentionFilter === 'attention' }"
                          :aria-pressed="shotTimeline.attentionFilter === 'attention'"
                          @click="setShotTimelineAttentionFilter('attention')"
                        ><AppIcon name="circle-alert" /><span>待处理 {{ shotTimelineAttentionCount }}</span></button>
                      </div>
                      <div class="shot-timeline-tool-group">
                        <el-button size="small" :disabled="shotTimeline.busy" @click="selectAllShotsInTimeline">全选</el-button>
                        <el-button size="small" :disabled="!currentShots.length" @click="focusShotFromTimeline(shotTimelineSelectedShots[0] || currentShots[0])"><AppIcon name="arrow-down-to-line" /><span>查看分镜卡片</span></el-button>
                      </div>
                      <div class="shot-timeline-tool-group shot-jump-group">
                        <span class="shot-timeline-tool-label">跳到镜号</span>
                        <el-input
                          v-model="shotTimeline.jumpNo"
                          size="small"
                          class="shot-jump-input"
                          placeholder="如 27"
                          :disabled="!currentShots.length"
                          aria-label="跳转到指定镜号"
                          @keyup.enter="jumpToShotNoInput"
                        />
                        <el-button size="small" :disabled="!currentShots.length" @click="jumpToShotNoInput"><AppIcon name="crosshair" /><span>跳转</span></el-button>
                      </div>
                      <div class="shot-timeline-tool-group shot-timeline-view-tools">
                        <span class="shot-timeline-tool-label">卡片</span>
                        <el-segmented
                          size="small"
                          :model-value="shotTimeline.cardDensity"
                          :options="shotCardDensityOptions"
                          :disabled="shotTimeline.busy"
                          aria-label="分镜卡片密度"
                          @update:model-value="setShotCardDensity($event)"
                        />
                        <el-switch v-model="shotTimeline.groupByScene" size="small" :disabled="shotTimeline.busy" active-text="按场景分组" />
                        <span class="shot-timeline-tool-label">缩放</span>
                        <el-slider v-model="shotTimeline.zoom" :disabled="shotTimeline.busy" :min="0.65" :max="1.8" :step="0.05" :show-tooltip="false" />
                      </div>
                    </div>

                    <div v-if="shotTimelineAttentionCount" class="shot-attention-queue">
                      <div class="shot-attention-queue-head">
                        <span><AppIcon name="circle-alert" /><strong>待处理视频</strong><small>{{ shotTimelineAttentionCount }} 条</small></span>
                        <div>
                          <button type="button" title="上一条待处理视频" aria-label="上一条待处理视频" @click="previousShotAttention"><AppIcon name="arrow-left" /></button>
                          <button type="button" title="下一条待处理视频" aria-label="下一条待处理视频" @click="nextShotAttention"><AppIcon name="arrow-right" /></button>
                        </div>
                      </div>
                      <div class="shot-attention-queue-list">
                        <button
                          v-for="sh in shotTimelineAttentionShots"
                          :key="'attention:' + sbEpisodeId + ':' + sh.no"
                          type="button"
                          :class="{ active: String(shotTimeline.activeAttentionNo) === String(sh.no) }"
                          :aria-current="String(shotTimeline.activeAttentionNo) === String(sh.no) ? 'true' : null"
                          :title="'跳转到镜头 ' + sh.no"
                          @click="focusShotAttention(sh)"
                        ><b>#{{ sh.no }}</b><span>{{ sh.title || ('镜头 ' + sh.no) }}</span></button>
                      </div>
                    </div>

                    <div v-if="shotTimelineSelectedCount" class="shot-timeline-selectbar">
                      <span class="shot-timeline-selectbar-label"><AppIcon name="check" />已选 {{ shotTimelineSelectedCount }} 个镜头</span>
                      <div class="shot-timeline-tool-group">
                        <el-button size="small" :disabled="shotTimeline.busy" @click="moveSelectedTimelineShots(-1)"><AppIcon name="arrow-left" /><span>前移</span></el-button>
                        <el-button size="small" :disabled="shotTimeline.busy" @click="moveSelectedTimelineShots(1)"><span>后移</span><AppIcon name="arrow-right" /></el-button>
                      </div>
                      <div class="shot-timeline-tool-group">
                        <el-select v-model="shotTimeline.reviewStatus" size="small" :disabled="shotTimeline.busy" class="shot-timeline-review-select" placeholder="审核状态">
                          <el-option v-for="item in shotTimelineReviewOptions" :key="item.value" :label="item.label" :value="item.value" />
                        </el-select>
                        <el-button size="small" :disabled="shotTimeline.busy" @click="applyShotTimelineReviewStatus"><AppIcon name="check" /><span>标记</span></el-button>
                        <el-button size="small" :disabled="shotTimeline.busy" title="锁定镜头和当前选择的元素" @click="lockSelectedTimelineShots"><AppIcon name="lock" /><span>锁定</span></el-button>
                        <el-button size="small" :disabled="shotTimeline.busy" @click="unlockSelectedTimelineShots"><AppIcon name="lock-open" /><span>解锁</span></el-button>
                      </div>
                      <div class="shot-timeline-tool-group shot-timeline-transfer">
                        <el-select v-model="shotTimeline.targetEpisodeId" size="small" :disabled="shotTimeline.busy" clearable placeholder="目标剧集">
                          <el-option v-for="episode in shotTimelineTargetEpisodes" :key="episode.id" :label="'第 ' + episode.id + ' 集 · ' + episode.title" :value="episode.id" />
                        </el-select>
                        <el-button size="small" :disabled="shotTimeline.targetEpisodeId === '' || shotTimeline.busy" @click="copySelectedShotsToEpisode"><AppIcon name="copy" /><span>复制到</span></el-button>
                        <el-button size="small" type="warning" plain :disabled="shotTimeline.targetEpisodeId === '' || shotTimeline.busy" @click="moveSelectedShotsToEpisode"><AppIcon name="toggle-left" /><span>移动到</span></el-button>
                      </div>
                      <el-button class="shot-timeline-selectbar-clear" size="small" text :disabled="shotTimeline.busy" @click="clearShotTimelineSelection"><AppIcon name="x" /><span>清除选择</span></el-button>
                    </div>

                    <div class="shot-timeline-scroll" aria-label="镜头时间线" @wheel="onShotTimelineWheel">
                      <div class="shot-timeline-lane">
                        <section v-for="group in shotTimelineGroups" :key="group.key" class="shot-timeline-scene-group">
                          <div v-if="shotTimeline.groupByScene" class="shot-timeline-scene-label" :title="group.label">
                            <AppIcon name="map-pin" /><span>{{ group.label }}</span><b>{{ group.shots.length }}</b>
                          </div>
                          <div class="shot-timeline-scene-shots">
                            <article
                              v-for="sh in group.shots"
                              :key="'timeline:' + sbEpisodeId + ':' + sh.no"
                              :class="['shot-timeline-item', 'status-' + shotTimelineVideoStatus(sh), {
                                selected: isShotTimelineSelected(sh),
                                locked: isShotLocked(sh),
                                'needs-attention': isShotAttentionMarked(sh),
                                dragging: shotTimeline.dragNo === String(sh.no),
                                'drop-before': shotTimeline.dropNo === String(sh.no) && !shotTimeline.dropAfter,
                                'drop-after': shotTimeline.dropNo === String(sh.no) && shotTimeline.dropAfter
                              }]"
                              :style="shotTimelineStyle(sh)"
                              :draggable="!isShotLocked(sh)"
                              :aria-selected="isShotTimelineSelected(sh)"
                              @click="selectShotInTimeline(sh, $event)"
                              @dblclick="focusShotFromTimeline(sh)"
                              @dragstart="startShotTimelineDrag(sh, $event)"
                              @dragover.prevent="dragOverShotTimeline(sh, $event)"
                              @drop.prevent="dropShotTimeline(sh, $event)"
                              @dragend="endShotTimelineDrag"
                            >
                              <div class="shot-timeline-thumb">
                                <div v-if="shotTimelineElementPreview(sh).length" class="shot-timeline-asset-preview">
                                  <button
                                    v-for="tag in shotTimelineElementPreview(sh)"
                                    :key="tag.cat + ':' + tag.name"
                                    type="button"
                                    class="shot-timeline-asset-thumb"
                                    :title="'放大查看 ' + (tag.displayName || tag.name)"
                                    :aria-label="'放大查看 ' + (tag.displayName || tag.name)"
                                    @click.stop="lightboxSrc = tag.labeledUrl || tag.url"
                                    @dblclick.stop="lightboxSrc = tag.labeledUrl || tag.url"
                                  >
                                    <img :src="tag.url" :alt="tag.displayName || tag.name" loading="lazy" decoding="async" />
                                  </button>
                                </div>
                                <div v-else :class="['shot-timeline-thumb-empty', { 'is-video-ready': shotTimelineVideoUrl(sh) }]">
                                  <AppIcon name="video" />
                                </div>
                                <button
                                  v-if="shotTimelineVideoUrl(sh)"
                                  type="button"
                                  class="shot-timeline-play"
                                  :title="'播放并放大镜头 ' + sh.no"
                                  :aria-label="'播放并放大镜头 ' + sh.no"
                                  @click.stop="openShotTimelineVideo(sh, $event)"
                                  @dblclick.stop="openShotTimelineVideo(sh, $event)"
                                >
                                  <AppIcon name="play" /><span>播放</span>
                                </button>
                                <span class="shot-timeline-select-mark"><AppIcon name="check" /></span>
                                <span :class="['shot-timeline-status', 'is-' + shotTimelineVideoStatus(sh)]">{{ shotTimelineVideoStatusLabel(sh) }}</span>
                              </div>
                              <div class="shot-timeline-item-body">
                                <div class="shot-timeline-item-title">
                                  <b>#{{ sh.no }}</b>
                                  <span :title="sh.title">{{ sh.title || ('镜头 ' + sh.no) }}</span>
                                  <button
                                    type="button"
                                    :class="['shot-timeline-attention-btn', { active: isShotAttentionMarked(sh) }]"
                                    :title="isShotAttentionMarked(sh) ? '移出待处理' : '标注为待处理'"
                                    :aria-label="isShotAttentionMarked(sh) ? '移出待处理' : '标注为待处理'"
                                    :disabled="shotTimeline.busy"
                                    @click.stop="toggleShotAttention(sh)"
                                  ><AppIcon name="circle-alert" /></button>
                                  <AppIcon name="lock" />
                                </div>
                                <div class="shot-timeline-item-meta">
                                  <span><AppIcon name="clock" />{{ shotTimelineDuration(sh) }}s</span>
                                  <el-tag size="small" effect="plain" :type="shotReviewType(sh)">{{ shotReviewLabel(sh) }}</el-tag>
                                </div>
                                <div v-if="shotTimelineElementPreview(sh).length || shotTimelineAudioCount(sh)" class="shot-timeline-tracks">
                                  <span v-for="tag in shotTimelineElementPreview(sh)" :key="'track:' + tag.cat + ':' + tag.name" class="shot-timeline-track-dot" :class="tag.cat" :title="tag.displayName || tag.name"></span>
                                  <span v-if="shotTimelineAudioCount(sh)" class="shot-timeline-audio-wave" :title="shotTimelineAudioCount(sh) + ' 个音频素材'">
                                    <i></i><i></i><i></i><i></i><i></i>
                                  </span>
                                </div>
                              </div>
                            </article>
                          </div>
                        </section>
                      </div>
                    </div>
                  </section>

                  <div v-if="!currentShots.length" class="empty-state">
                    <AppIcon name="video" />
                    <span>这一集还没有分镜，点右上角「生成分镜」，或导入你自己的分镜</span>
                    <div class="inline-actions">
                      <el-button type="primary" :loading="isStoryboardGenerating(sbEpisodeId)" :disabled="!selectedSbEpisode || !selectedSbEpisode.content" @click="generateStoryboard(sbEpisodeId, 'normal')"><AppIcon name="video" /><span>生成分镜</span></el-button>
                      <el-button @click="startImportStoryboard"><AppIcon name="upload" /><span>导入分镜</span></el-button>
                    </div>
                  </div>
                  <div v-else-if="!shotTimelineVisibleShots.length" class="empty-state shot-attention-empty">
                    <AppIcon name="circle-check" />
                    <span>当前没有待处理视频</span>
                    <el-button @click="setShotTimelineAttentionFilter('all')">查看全部视频</el-button>
                  </div>
                  <div v-else :class="['shot-list', shotCardDensityClass]">
                    <!-- 片头：项目级共用的开场片段。刻意不是「镜头0」——它不进分镜编号、不参与承接连续性。 -->
                    <div class="shot-intro-card" :class="{ 'is-empty': !introClip, 'is-disabled': introClip && !introEnabled }">
                      <div class="shot-intro-head">
                        <span class="shot-intro-badge">片头</span>
                        <span class="shot-intro-title">{{ introClip ? introClip.name : '未导入' }}</span>
                        <span v-if="introDurationText" class="shot-intro-duration">{{ introDurationText }}</span>
                        <span class="shot-intro-scope">全项目共用</span>
                        <span class="shot-intro-actions" @click.stop>
                          <el-switch
                            v-if="introClip"
                            :model-value="introEnabled"
                            size="small"
                            :disabled="introBusy"
                            active-text="启用"
                            @change="setIntroEnabled"
                          />
                          <el-button size="small" :loading="introBusy" @click="$event.currentTarget.querySelector('input').click()">
                            <AppIcon name="upload" /><span>{{ introClip ? '替换片头' : '导入片头' }}</span>
                            <input type="file" accept="video/*" hidden @change="onPickIntroClip" />
                          </el-button>
                          <el-button v-if="introClip" size="small" text :disabled="introBusy" @click="removeIntro">清除</el-button>
                        </span>
                      </div>
                      <div class="shot-intro-body">
                        <video v-if="introUrl" class="shot-intro-video" :src="introUrl" controls preload="metadata"></video>
                        <p v-else class="shot-intro-hint">导入一段开场片段（比如魔性跳舞）。导出成片 / 剪映草稿时会排在镜头1之前，不参与分镜编号，也不参与承接与定帧连续性。</p>
                        <p v-if="introError" class="shot-intro-error">{{ introError }}</p>
                      </div>
                    </div>
                    <template v-for="shot in shotTimelineRenderedShots" :key="sbEpisodeId + ':' + shot.no">
                      <div
                        :id="shotTimelineCardDomId(shot)"
                        class="shot-stack-item"
                        :style="shotCardWindowStyle(shot)"
                        v-viewport-render="shotCardWindowBinding(shot)"
                      >
                      <template v-if="isShotCardWindowActive(shot)">
                      <article :class="['shot-card', 'video-' + (shotVideoUrl(shot.no) ? 'done' : shotVideoStatus(shot.no) || 'none'), { 'is-locked': isShotLocked(shot), 'needs-attention': isShotAttentionMarked(shot), 'is-editing': isShotEditing(shot) }]">
                        <div class="shot-slate" aria-hidden="true">
                          <span v-for="h in 5" :key="h" class="slate-hole"></span>
                        </div>
                        <div class="shot-left">
                          <div class="shot-head">
                            <span class="shot-no">{{ shot.no }}</span>
                            <span class="shot-title">{{ scriptState.settings.hideStoryboardPrompts && !isShotPromptRevealed(shot) && !isShotEditing(shot) ? ('镜头 ' + shot.no) : (shot.title || ('镜头 ' + shot.no)) }}</span>
                            <span class="shot-duration-control" @click.stop>
                              <el-input-number
                                :model-value="shotTimelineDuration(shot)"
                                :min="5"
                                :max="shotVideoDurationRange(shot).max"
                                :step="1"
                                step-strictly
                                controls-position="right"
                                size="small"
                                :disabled="isShotLocked(shot) || shotTimeline.busy"
                                :aria-label="'镜头 ' + shot.no + ' 时长（秒）'"
                                @change="setShotTimelineDuration(shot, $event)"
                              />
                              <span aria-hidden="true">s</span>
                            </span>
                            <span
                              v-if="shotDurationWarning(shot)"
                              class="shot-duration-warning"
                              :title="'正文时间码共 ' + shotDurationWarning(shot).textSeconds + ' 秒，本次会按 ' + shotDurationWarning(shot).submitSeconds + ' 秒提交（全局默认时长是上限）；建议先用下方「拆成两个 ' + Math.ceil(shotDurationWarning(shot).textSeconds / 2) + 's」'"
                            >⚠️ 会被截成 {{ shotDurationWarning(shot).submitSeconds }}s（正文 {{ shotDurationWarning(shot).textSeconds }}s）</span>
                            <el-tag size="small" effect="plain" :type="shotReviewType(shot)">{{ shotReviewLabel(shot) }}</el-tag>
                            <AppIcon name="lock" />
                            <span class="shot-head-acts" @click.stop>
                              <button
                                :class="['shot-iconbtn', 'shot-attention-toggle', { active: isShotAttentionMarked(shot) }]"
                                :title="isShotAttentionMarked(shot) ? '移出待处理' : '标注为待处理'"
                                :aria-label="isShotAttentionMarked(shot) ? '移出待处理' : '标注为待处理'"
                                :disabled="shotTimeline.busy"
                                @click="toggleShotAttention(shot)"
                              ><AppIcon name="circle-alert" /></button>
                              <button
                                class="shot-iconbtn"
                                :title="isShotLocked(shot) ? '解锁本镜头' : '锁定本镜头和当前元素'"
                                :aria-label="isShotLocked(shot) ? '解锁本镜头' : '锁定本镜头'"
                                :disabled="shotTimeline.busy"
                                @click="toggleShotLocked(shot)"
                              ><el-icon><Unlock v-if="isShotLocked(shot)" /><Lock v-else /></el-icon></button>
                              <button
                                v-if="scriptState.settings.hideStoryboardPrompts"
                                class="shot-iconbtn"
                                :title="isShotPromptRevealed(shot) ? '隐藏本镜提示词' : '显示本镜提示词'"
                                @click="toggleShotPromptReveal(shot)"
                              >
                                <el-icon><Hide v-if="isShotPromptRevealed(shot)" /><View v-else /></el-icon>
                              </button>
                              <button v-if="!scriptState.settings.hideStoryboardPrompts || isShotPromptRevealed(shot) || isShotEditing(shot)" class="shot-iconbtn" title="复制分镜文本" @click="copyShot(shot)"><AppIcon name="copy" /></button>
                              <button :class="['shot-iconbtn', { 'is-busy': aiBinding.running && aiBinding.activeShotNo === String(shot.no) }]" title="AI 重新推理本镜元素绑定" :disabled="aiBinding.running || isShotLocked(shot) || isShotEditing(shot)" @click="runAiElementBinding({ shot, scope: 'single' })"><AppIcon name="wand-sparkles" /></button>
                              <button v-if="prevShotNo(shot.no) != null" class="shot-iconbtn" :title="'截取上一镜（镜头 ' + prevShotNo(shot.no) + '）的尾帧画面，作为本镜开场参考图'" @click="capturePrevTailFrame(shot.no)"><AppIcon name="camera" /></button>
                              <button v-if="prevShotNo(shot.no) != null" class="shot-iconbtn" :title="'打开上一镜（镜头 ' + prevShotNo(shot.no) + '）视频，手动选择一帧作为本镜开场参考图'" @click="openTailFramePicker(shot.no)"><AppIcon name="film" /></button>
                              <button class="shot-iconbtn is-danger" title="删除本镜" :disabled="isShotLocked(shot) || isShotEditing(shot)" @click="deleteShot(shot)"><AppIcon name="trash-2" /></button>
                            </span>
                          </div>
                          <button
                            v-if="scriptState.settings.hideStoryboardPrompts && !isShotPromptRevealed(shot) && !isShotEditing(shot)"
                            type="button"
                            class="shot-body-hidden"
                            :title="isShotLocked(shot) ? '显示本镜提示词' : '显示并编辑分镜内容'"
                            @click="isShotLocked(shot) ? toggleShotPromptReveal(shot) : startShotEdit(shot)"
                          >
                            <AppIcon name="eye" />
                            <span>分镜提示词已隐藏</span>
                          </button>
                          <pre
                            v-else
                            class="shot-body"
                            :class="{ 'is-readonly': isShotLocked(shot) }"
                            :contenteditable="isShotLocked(shot) ? 'false' : 'plaintext-only'"
                            :data-shot-edit-key="shotEditKey(shot)"
                            :title="isShotLocked(shot) ? '镜头已锁定' : null"
                            :aria-label="'分镜 ' + shot.no + ' 正文'"
                            aria-multiline="true"
                            spellcheck="false"
                            @focus="startShotEdit(shot, $event.currentTarget)"
                            @input="updateShotEditText($event)"
                            @blur="finishShotEdit(shot, $event)"
                            @keydown.esc.stop.prevent="cancelShotEdit($event.currentTarget)"
                            v-html="shotBodyHtml(shot)"
                          ></pre>
                          <div class="shot-tags">
                            <span v-if="shotOpenerFrame(shot.no)" class="el-tag-chip opener-frame-chip" :title="shotOpenerFrameName(shot.no) + '，点击查看大图'"
                                  @click="lightboxSrc = shotOpenerFrame(shot.no).url">
                              <img class="thumb" :src="shotOpenerFrame(shot.no).url" loading="lazy" decoding="async" />
                              <span class="cat-dot opener"></span>
                              <span>{{ shotOpenerFrameName(shot.no) }}</span>
                              <AppIcon name="pen-line" />
                              <AppIcon name="x" />
                            </span>
                            <span v-for="tag in shotElementTags(shot)" :key="tag.cat + ':' + tag.name"
                                  :class="['el-tag-chip', { missing: !tag.hasImage, manual: tag.manual }]" :title="tag.hasImage ? (tag.displayName || tag.name) + '：已出图，点击查看带名称标注的大图' : (tag.displayName || tag.name) + '：未出图，点击去生成'"
                                  @click="tag.hasImage ? lightboxSrc = tag.labeledUrl : focusElement(tag)">
                              <img v-if="tag.hasImage" class="thumb" :src="tag.url" loading="lazy" decoding="async" />
                              <span v-else class="thumb-ph"><AppIcon name="image" /></span>
                              <span class="cat-dot" :class="tag.cat"></span>
                              <span>{{ tag.displayName || tag.name }}</span>
                              <button
                                v-if="tag.hasImage"
                                type="button"
                                class="tag-regenerate"
                                :class="{ 'is-busy': tag.generating }"
                                :disabled="tag.generating || isShotLocked(shot)"
                                :title="isShotLocked(shot) ? '镜头已锁定，请先解锁' : (tag.generating ? '图片生成中' : '重新生成图片')"
                                :aria-label="isShotLocked(shot) ? '镜头已锁定，请先解锁' : '重新生成图片'"
                                @click.stop="regenerateShotElementImage(tag, shot)"
                              ><AppIcon name="refresh-cw" /></button>
                              <AppIcon name="pen-line" />
                               <AppIcon name="x" />
                            </span>
                            <span v-for="au in shotAudioTags(shot)" :key="'audio:' + au.name" class="el-tag-chip audio-chip" :title="au.name + ' 的配音参考音频'">
                              <span class="cat-dot audio"></span>
                              <AppIcon name="mic" />
                              <span>{{ au.name }}音频</span>
                              <audio class="shot-audio-mini" :src="au.url" controls preload="none"></audio>
                              <AppIcon name="x" />
                            </span>
                            <el-popover :visible="isShotPickerVisible(shot, 'audio')" @update:visible="setShotPickerVisible(shot, 'audio', $event)" placement="top-start" :fallback-placements="['bottom-start','left','right']" :width="320" trigger="click" :persistent="false" :popper-options="shotPickerPopperOptions" popper-class="shot-picker-popper shot-audio-popper" @show="openShotAudioPicker(shot)">
                              <template #reference>
                                <button type="button" class="el-tag-chip add-tag-chip audio-add-chip" :disabled="isShotLocked(shot)" :title="isShotLocked(shot) ? '镜头已锁定，请先解锁' : '手动添加人物音频到本镜'"><AppIcon name="mic" /><span>补人物音频</span></button>
                              </template>
                              <div class="shot-audio-pop">
                                <div class="add-tag-header">
                                  <el-input v-model="addTagPanel.audioSearchQuery" size="small" placeholder="搜索人物音频" clearable>
                                    <template #prefix><AppIcon name="search" /></template>
                                  </el-input>
                                </div>
                                <div class="shot-audio-options">
                                  <button
                                    v-for="audio in filteredShotAudioOptions"
                                    :key="'audio-option:' + audio.name"
                                    type="button"
                                    :class="['shot-audio-option', { on: isShotAudioBound(shot.no, audio.name) }]"
                                    @click="toggleShotAudio(shot.no, audio.name)"
                                  >
                                    <span class="shot-audio-option-icon"><AppIcon name="mic" /></span>
                                    <span><b>{{ audio.displayName || audio.name }}</b><small>{{ audio.voiceName || '配音参考音频' }}</small></span>
                                    <AppIcon name="check" />
                                  </button>
                                  <p v-if="!filteredShotAudioOptions.length" class="muted"><AppIcon name="search" /> 没有可用的人物音频</p>
                                </div>
                              </div>
                            </el-popover>
                            <button
                              v-if="previousShotForReuse(shot)"
                              type="button"
                              class="shot-elements-reuse-btn"
                              :disabled="isShotLocked(shot) || !previousShotReuseSummary(shot)"
                              :title="isShotLocked(shot) ? '镜头和当前元素已锁定，请先解锁' : (previousShotReuseSummary(shot) ? ('完全复用上一镜（镜头 ' + previousShotForReuse(shot).no + '）的' + previousShotReuseSummary(shot) + '；元素会替换本镜现有匹配，首帧会同步绑定到本镜') : ('上一镜（镜头 ' + previousShotForReuse(shot).no + '）还没有匹配元素或首帧'))"
                              @click="reusePreviousShotElements(shot)"
                            >
                              <AppIcon name="copy" />
                              <span>完全复用上镜元素</span>
                            </button>
                            <button
                              v-if="previousShotForReuse(shot)"
                              type="button"
                              class="shot-elements-reuse-btn"
                              :disabled="isShotLocked(shot) || isShotEditing(shot) || !previousShotSetupFieldCount(shot)"
                              :title="isShotLocked(shot) ? '镜头已锁定，请先解锁' : (isShotEditing(shot) ? '请先保存或取消当前编辑' : (previousShotSetupFieldCount(shot) ? ('用上一镜（镜头 ' + previousShotForReuse(shot).no + '）的' + previousShotSetupSummary(shot) + '覆盖本镜对应字段，并保留本镜画面、台词和运镜') : ('上一镜（镜头 ' + previousShotForReuse(shot).no + '）没有可复用的场景、人物、站位或道具字段')))"
                              @click="reusePreviousShotSetup(shot)"
                            >
                              <AppIcon name="chart-column" />
                              <span>复用上镜场景与站位</span>
                            </button>
                            <el-popover :visible="isShotPickerVisible(shot, 'elements')" @update:visible="setShotPickerVisible(shot, 'elements', $event)" placement="top-start" :fallback-placements="['bottom-start','left','right']" :width="360" trigger="click" :persistent="false" :popper-options="shotPickerPopperOptions" popper-class="shot-picker-popper add-tag-popper" @show="openAddTag(shot)">
                              <template #reference>
                              <button type="button" class="el-tag-chip add-tag-chip" :disabled="isShotLocked(shot)" :title="isShotLocked(shot) ? '镜头已锁定人物与元素，请先解锁' : '手动补一个元素到本镜'"><AppIcon name="plus" /><span>补元素</span></button>
                              </template>
                              <div class="add-tag-pop">
                                <div class="add-tag-header">
                                  <el-input v-model="addTagPanel.searchQuery" size="small" placeholder="搜索元素..." clearable>
                                    <template #prefix><AppIcon name="search" /></template>
                                  </el-input>
                                  <el-select v-model="addTagPanel.selectedCategory" size="small" style="width:100px;margin-left:8px">
                                    <el-option label="全部" value="all" />
                                    <el-option label="人物" value="character" />
                                    <el-option label="场景" value="scene" />
                                    <el-option label="道具" value="prop" />
                                    <el-option label="特效" value="effect" />
                                    <el-option label="妖兽" value="creature" />
                                  </el-select>
                                </div>
                                <div class="add-tag-cats">
                                  <div v-for="c in ['character','group','scene','prop','effect','creature']" :key="c" class="add-tag-cat-group" v-show="(filteredAddTagElements[c]||[]).length">
                                    <div class="add-tag-cat-label"><span class="cat-dot" :class="c"></span>{{ catLabel[c] }}</div>
                                    <span v-for="el in filteredAddTagElements[c]" :key="c+':'+el.name"
                                          :class="['add-tag-item', { on: isManualTagged(shot.no, c, el.name) }]"
                                          @click="toggleManualTag(c, el.name)">{{ el.name }}</span>
                                  </div>
                                  <p v-if="!counts.character && !counts.group && !counts.scene && !counts.prop && !counts.effect && !counts.creature" class="muted">元素库为空，请先提取或在元素库新增</p>
                                  <p v-else-if="!Object.values(filteredAddTagElements).some(arr => arr.length)" class="muted">
                                    <AppIcon name="search" /> 未找到匹配的元素
                                  </p>
                                </div>
                              </div>
                            </el-popover>
                            <el-popover :visible="isShotPickerVisible(shot, 'character-look')" @update:visible="setShotPickerVisible(shot, 'character-look', $event)" placement="top-start" :fallback-placements="['bottom-start','left','right']" :width="680" popper-class="shot-picker-popper character-look-popper" trigger="click" :persistent="false" :popper-options="shotPickerPopperOptions">
                              <template #reference>
                                <button type="button" class="shot-character-look-btn" :disabled="isShotLocked(shot)" :title="isShotLocked(shot) ? '镜头已锁定人物与元素，请先解锁' : '为本镜单独指定人物造型'" @click="openCharacterLookPicker(shot)">
                                  <AppIcon name="user-round" />
                                  <span>人物造型</span>
                                </button>
                              </template>
                              <div class="character-look-pop">
                                <div class="character-look-header">
                                  <strong>选择本镜人物造型</strong>
                                  <el-input v-model="addTagPanel.lookSearchQuery" size="small" placeholder="搜索人物或造型" clearable>
                                    <template #prefix><AppIcon name="search" /></template>
                                  </el-input>
                                </div>
                                <div v-if="characterLookGroups.length" class="character-look-browser">
                                  <aside class="character-look-owners" aria-label="人物列表">
                                    <button
                                      v-for="group in characterLookGroups"
                                      :key="group.name"
                                      type="button"
                                      :class="['character-look-owner-button', { active: activeCharacterLookGroup?.name === group.name }]"
                                      @click="selectCharacterLookOwner(group.name)"
                                    >
                                      <span class="character-look-owner-avatar">
                                        <img v-if="group.looks[0]?.hasImage" :src="characterLookImageUrl(group.looks[0])" loading="lazy" decoding="async" />
                                        <AppIcon name="user-round" />
                                      </span>
                                      <span class="character-look-owner-copy">
                                        <b>{{ group.displayName }}</b>
                                        <small>{{ group.looks.length }} 个造型</small>
                                      </span>
                                      <AppIcon name="check" />
                                    </button>
                                  </aside>
                                  <section v-if="activeCharacterLookGroup" class="character-look-stage">
                                    <div class="character-look-stage-head">
                                      <strong>{{ activeCharacterLookGroup.displayName }}</strong>
                                      <small v-if="selectedCharacterLook(shot.no, activeCharacterLookGroup.name)">本镜已指定</small>
                                    </div>
                                    <div class="character-look-options">
                                      <button
                                        v-for="look in activeCharacterLookGroup.looks"
                                        :key="look.name"
                                        type="button"
                                        :disabled="!look.hasImage"
                                        :class="['character-look-option', { selected: selectedCharacterLook(shot.no, activeCharacterLookGroup.name) === look.name, missing: !look.hasImage }]"
                                        :title="look.hasImage ? ('本镜使用' + look.displayName) : (look.displayName + '尚未出图')"
                                        @click="selectCharacterLook(look)"
                                      >
                                        <img v-if="look.hasImage" :src="characterLookImageUrl(look)" loading="lazy" decoding="async" />
                                        <span v-else class="character-look-placeholder"><AppIcon name="image" /></span>
                                        <span class="character-look-copy">
                                          <b>{{ look.assetKind === 'main' ? '主形态' : (look.lookLabel || look.matchName || look.displayName) }}</b>
                                          <small>{{ look.assetLabel || '人物' }}{{ look.hasImage ? '' : ' · 未出图' }}</small>
                                        </span>
                                        <AppIcon name="check" />
                                      </button>
                                    </div>
                                  </section>
                                </div>
                                <p v-else class="character-look-empty muted"><AppIcon name="search" /> 未找到已添加造型的人物</p>
                                <p class="character-look-foot">再次点击已选造型可恢复本镜自动匹配</p>
                              </div>
                            </el-popover>
                            <el-popover :visible="isShotPickerVisible(shot, 'scene-area')" @update:visible="setShotPickerVisible(shot, 'scene-area', $event)" placement="top-start" :fallback-placements="['bottom-start','left','right']" :width="420" trigger="click" :persistent="false" :popper-options="shotPickerPopperOptions" popper-class="shot-picker-popper scene-area-popper" @show="openSceneAreaPicker(shot)">
                              <template #reference>
                                <button type="button" class="shot-scene-area-btn" :disabled="isShotLocked(shot)" :title="isShotLocked(shot) ? '镜头已锁定人物与元素，请先解锁' : '为本镜单独指定主场景或子区域图片'">
                                  <AppIcon name="map-pin" />
                                  <span>场景区域</span>
                                </button>
                              </template>
                              <div class="character-look-pop scene-area-pop">
                                <div class="character-look-header">
                                  <strong>选择本镜场景区域</strong>
                                  <el-input v-model="addTagPanel.sceneSearchQuery" size="small" placeholder="搜索场景或子区域" clearable>
                                    <template #prefix><AppIcon name="search" /></template>
                                  </el-input>
                                </div>
                                <div class="character-look-groups">
                                  <section v-for="group in sceneAreaGroups" :key="group.name" class="character-look-group">
                                    <div class="character-look-owner scene-area-owner">
                                      <span>{{ group.displayName }}</span>
                                      <small v-if="selectedSceneArea(shot.no, group.name)">本镜已指定</small>
                                    </div>
                                    <button
                                      v-for="area in group.areas"
                                      :key="area.name"
                                      type="button"
                                      :disabled="!area.hasImage"
                                      :class="['character-look-option', 'scene-area-option', { selected: selectedSceneArea(shot.no, group.name) === area.name, missing: !area.hasImage }]"
                                      :title="area.hasImage ? ('本镜使用' + area.displayName) : (area.displayName + '尚未出图')"
                                      @click="selectSceneArea(area)"
                                    >
                                      <img v-if="area.hasImage" :src="storyboardSceneImageUrl(area)" loading="lazy" decoding="async" />
                                      <span v-else class="character-look-placeholder"><AppIcon name="image" /></span>
                                      <span class="character-look-copy">
                                        <b>{{ area.assetKind === 'main' ? '主场景' : (area.lookLabel || area.matchName || area.displayName) }}</b>
                                        <small>{{ area.assetLabel || '场景' }}{{ area.hasImage ? '' : ' · 未出图' }}</small>
                                      </span>
                                      <AppIcon name="check" />
                                    </button>
                                  </section>
                                  <p v-if="!sceneAreaGroups.length" class="muted"><AppIcon name="search" /> 未找到已添加子区域的场景</p>
                                </div>
                                <p class="character-look-foot">再次点击已选区域可恢复本镜自动匹配</p>
                              </div>
                            </el-popover>
                            <span v-if="!shotElementTags(shot).length" class="shot-tags-empty">未匹配到元素 · 点「补元素」手动关联，或去元素库补充</span>
                          </div>
                        </div>
                        <div class="shot-video">
                           <div class="shot-video-sticky">
                           <div
                             v-if="videoGuard.active && String(videoGuard.episodeId) === String(sbEpisodeId) && videoGuard.shotNos.includes(String(shot.no))"
                             class="video-guard-card-status"
                             role="status"
                             aria-live="polite"
                           >
                             <div class="video-guard-card-copy">
                               <strong>视频生成等待中</strong>
                               <span>确认本镜分镜、提示词和参考素材</span>
                             </div>
                             <b>{{ videoGuard.remaining }}s</b>
                             <div class="video-guard-card-progress" aria-hidden="true">
                               <span :style="{ width: (videoGuard.total ? ((videoGuard.total - videoGuard.remaining) / videoGuard.total * 100) : 0) + '%' }"></span>
                             </div>
                             <el-button class="video-guard-card-cancel" type="danger" text @click="cancelVideoGuard">
                               <AppIcon name="x" /><span>取消</span>
                             </el-button>
                           </div>
                           <div :class="['shot-video-settings', { 'has-account-and-model': effectiveShotVideoProvider(shot) === 'neowow' }]" @click.stop>
                            <label class="shot-video-setting">
                              <span>渠道</span>
                              <el-select :model-value="shotVideoProvider(shot)" size="small" :title="shotVideoSettingsSummary(shot)" @change="setShotVideoProvider(shot, $event)">
                                <el-option :label="'跟随本集（' + currentVideoProviderLabel + '）'" value="" />
                                <el-option v-for="item in videoProviderOptions" :key="item.value" :label="item.label" :value="item.value" />
                              </el-select>
                            </label>
                            <label v-if="['dreamina-agent', 'neowow'].includes(effectiveShotVideoProvider(shot))" class="shot-video-setting">
                              <span>账号</span>
                              <el-select :model-value="shotVideoAccountId(shot)" size="small" :title="shotVideoSettingsSummary(shot)" @change="setShotVideoAccountId(shot, $event)">
                                <template v-if="effectiveShotVideoProvider(shot) === 'dreamina-agent'">
                                  <el-option label="跟随本集账号" value="" />
                                  <el-option v-for="account in cfg.video.dreaminaAgentAccounts" :key="account.id" :label="account.name || account.id" :value="account.id" />
                                </template>
                                <template v-else>
                                  <el-option :label="'跟随本集（' + neowowEpisodeAccountLabel() + '）'" value="" />
                                  <el-option
                                    v-for="account in cfg.video.neowowAccounts"
                                    :key="account.id"
                                    :label="neowowAccountOptionLabel(account)"
                                    :value="account.id"
                                    :disabled="!account.hasToken || account.enabled === false || ['expired', 'logged_out', 'invalid', 'logging_in'].includes(account.status) || (account.points != null && Number(account.points) <= 0)"
                                  />
                                </template>
                              </el-select>
                            </label>
                            <label v-if="effectiveShotVideoProvider(shot) !== 'dreamina-agent'" class="shot-video-setting">
                              <span>模型（可搜索）</span>
                              <el-select
                                :model-value="shotVideoModel(shot)"
                                size="small"
                                filterable
                                clearable
                                :allow-create="shotVideoAllowCreateModel(shot)"
                                default-first-option
                                :title="shotVideoSettingsSummary(shot)"
                                @change="setShotVideoModel(shot, $event)"
                              >
                                <el-option :label="shotVideoDefaultModelLabel(shot)" value="" />
                                <el-option v-for="m in shotVideoModelOptions(shot)" :key="m.value" :label="m.label" :value="m.value" />
                              </el-select>
                            </label>
                            <el-button v-if="hasShotVideoSettings(shot)" size="small" text type="info" title="恢复跟随本集视频设置" @click="resetShotVideoSettings(shot)">
                              <AppIcon name="rotate-ccw" />
                            </el-button>
                          </div>
                          <div class="video-canvas">
                            <template v-if="shotVideoUrl(shot.no, undefined, true)">
                              <img
                                v-if="shotTimelineElementPreview(shot)[0]"
                                class="video-lazy-poster"
                                :src="shotTimelineElementPreview(shot)[0].url"
                                :alt="shotTimelineElementPreview(shot)[0].displayName || shotTimelineElementPreview(shot)[0].name"
                                loading="lazy"
                                decoding="async"
                              />
                              <video
                                v-lazy-video="shotVideoUrl(shot.no, undefined, true)"
                                class="lazy-shot-video"
                                controls
                                playsinline
                                preload="metadata"
                                draggable="true"
                                :title="'拖拽到剪映等外部软件导入：' + (shot.title || ('镜头 ' + shot.no))"
                                @dragstart="startVideoFileDrag($event, shotVideoUrl(shot.no, undefined, true))"
                                @loadeddata="markShotVideoLoaded(shot.no)"
                                @error="markShotVideoLoadFailed(shot.no)"
                              ></video>
                              <div class="video-lazy-status" aria-hidden="true">
                                <AppIcon name="loader-circle" />
                                <span class="video-lazy-status-loading">正在载入视频</span>
                                <span class="video-lazy-status-error">视频加载失败</span>
                              </div>
                              <div
                                v-if="subtitleRemovalState(shot.no).open"
                                class="subtitle-removal-mask"
                                :class="{ 'is-processing': subtitleRemovalState(shot.no).busy, 'is-dragging': subtitleRemovalState(shot.no).dragging }"
                                :style="subtitleMaskStyle(shot.no)"
                                aria-hidden="true"
                                @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'move')"
                              >
                                <span class="subtitle-removal-mask-label">字幕修复区</span>
                                <i class="subtitle-resize-handle handle-nw" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'nw')"></i>
                                <i class="subtitle-resize-handle handle-n" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'n')"></i>
                                <i class="subtitle-resize-handle handle-ne" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'ne')"></i>
                                <i class="subtitle-resize-handle handle-e" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'e')"></i>
                                <i class="subtitle-resize-handle handle-se" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'se')"></i>
                                <i class="subtitle-resize-handle handle-s" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 's')"></i>
                                <i class="subtitle-resize-handle handle-sw" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'sw')"></i>
                                <i class="subtitle-resize-handle handle-w" @pointerdown.stop.prevent="startSubtitleMaskInteraction($event, shot.no, 'w')"></i>
                              </div>
                              <!-- 任务进行中：进度浮层"盖在"播放器之上，而不是销毁播放器。
                                   旧代码用 v-if/v-else 整块切换，任务状态一抖播放器就重建、视频从头加载，表现为画面黑闪。 -->
                              <div v-if="shotVideoStatus(shot.no)" class="video-task-layer" :class="{ 'is-failed': shotVideoStatus(shot.no) === 'failed' }">
                                <AppIcon name="circle-alert" />
                                <AppIcon name="loader-circle" />
                                <span>{{ shotVideoStatus(shot.no) === 'failed' ? '视频生成失败' : (shotVideoStatus(shot.no) === 'queued' ? '已提交' : '生成中') }}</span>
                                <div v-if="shotVideoStatus(shot.no) !== 'failed'" class="shot-video-progress-wrap">
                                  <el-progress class="shot-video-progress theme-running-progress" :style="{ '--runner-progress': shotVideoProgress(shot) + '%' }" :percentage="shotVideoProgress(shot)" :show-text="false" />
                                  <small class="shot-video-progress-text">{{ shotVideoProgressText(shot) }}</small>
                                </div>
                                <small v-if="shotVideoStatus(shot.no) === 'failed'" class="shot-video-failure-reason" :title="shotVideoFailureReason(shot)"><strong>失败原因：</strong>{{ shotVideoFailureReason(shot) }}</small>
                                <small v-else>{{ shotVideoStatus(shot.no) === 'queued' ? '正在等待出片并自动拉回（生成可能较久）' : '已分配到' + shotVideoSettingsSummary(shot) + '，生成完成后自动拉回' }}</small>
                              </div>
                            </template>
                            <div v-else-if="shotVideoStatus(shot.no) === 'generating'" class="video-ph">
                              <AppIcon name="loader-circle" />
                              <span>生成中</span>
                              <div class="shot-video-progress-wrap">
                                <el-progress class="shot-video-progress theme-running-progress" :style="{ '--runner-progress': shotVideoProgress(shot) + '%' }" :percentage="shotVideoProgress(shot)" :show-text="false" />
                                <small class="shot-video-progress-text">{{ shotVideoProgressText(shot) }}</small>
                              </div>
                              <small>已分配到{{ shotVideoSettingsSummary(shot) }}，生成完成后自动拉回</small>
                            </div>
                            <div v-else-if="shotVideoStatus(shot.no) === 'queued'" class="video-ph">
                              <AppIcon name="loader-circle" />
                              <span>已提交</span>
                              <div class="shot-video-progress-wrap">
                                <el-progress class="shot-video-progress theme-running-progress" :style="{ '--runner-progress': shotVideoProgress(shot) + '%' }" :percentage="shotVideoProgress(shot)" :show-text="false" />
                                <small class="shot-video-progress-text">{{ shotVideoProgressText(shot) }}</small>
                              </div>
                              <small>已提交{{ shotVideoSettingsSummary(shot) }}，正在等待出片并自动拉回<br/>(生成可能较久，可去忙别的)</small>
                            </div>
                            <div v-else-if="shotVideoStatus(shot.no) === 'failed'" class="video-ph is-failed">
                              <AppIcon name="circle-alert" />
                              <span>视频生成失败</span>
                              <small class="shot-video-failure-reason" :title="shotVideoFailureReason(shot)"><strong>失败原因：</strong>{{ shotVideoFailureReason(shot) }}</small>
                              <small>任务漏抓可点「重新抓取」；提示词有问题可先「重新生成文本」再重试</small>
                            </div>
                            <div v-else class="video-ph">
                              <AppIcon name="play" />
                              <span>视频区</span>
                              <small>把左侧匹配到的元素图作参考图，<br/>连同分镜提示词发给{{ shotVideoSettingsSummary(shot) }}生成</small>
                            </div>
                          </div>
                          <div class="video-actions">
                            <el-button
                              size="small"
                              plain
                              :class="['video-attention-button', { active: isShotAttentionMarked(shot) }]"
                              :title="isShotAttentionMarked(shot) ? '移出待处理' : '标注为待处理'"
                              :aria-label="isShotAttentionMarked(shot) ? '移出待处理' : '标注为待处理'"
                              :disabled="shotTimeline.busy"
                              @click="toggleShotAttention(shot)"
                            >
                              <AppIcon name="circle-alert" />
                              <span>{{ isShotAttentionMarked(shot) ? '已标注待处理' : '标注待处理' }}</span>
                            </el-button>
                            <el-button size="small" @click="$event.currentTarget.querySelector('input').click()">
                              <AppIcon name="upload" /><span>导入本地预览</span>
                              <input type="file" accept="video/*" hidden @change="onPickShotVideo($event, shot.no)" />
                            </el-button>
                            <el-button size="small" @click="$event.currentTarget.querySelector('input').click()" title="把一段参考视频挂到本镜：生成时会作为「视频参考」一起提交给支持它的模型（即梦 / Seedance / LibTV 等），用于复刻动作、运镜与节奏">
                              <AppIcon name="link" /><span>{{ shot.refVideoPath ? '换参考视频' : '参考视频' }}</span>
                              <input type="file" accept="video/*" hidden @change="onPickShotRefVideo($event, shot.no)" />
                            </el-button>
                            <el-tag v-if="shot.refVideoPath" size="small" type="warning" effect="plain" :title="shot.refVideoName" closable @close="clearShotRefVideo(shot.no)">
                              参考：{{ shot.refVideoName || '已挂载' }}<template v-if="shot.refVideoDuration">（{{ shot.refVideoDuration }}s）</template>
                            </el-tag>
                            <el-button v-if="shotVideoUrl(shot.no)" size="small" text @click="clearShotVideo(shot.no)">清除</el-button>
                            <el-button v-if="shotVideoUrl(shot.no)" size="small" text title="查看该镜头的历史生成版本，可恢复到任意一版" @click="openVideoHistory(project.id, sbEpisodeId, shot.no, '镜头 ' + shot.no + (shot.title ? '：' + shot.title : ''))"><AppIcon name="chart-column" /><span>历史版本</span></el-button>
                            <el-button v-if="shotVideoStatus(shot.no) === 'queued' || shotVideoStatus(shot.no) === 'failed' || shotVideoStatus(shot.no) === 'generating'" size="small" text @click="refetchShotVideo(shot.no)" title="强制重新拉取一次，防漏抓"><AppIcon name="refresh-cw" /><span>重新抓取</span></el-button>
                            <el-button
                              v-if="shotVideoStatus(shot.no) === 'failed'"
                              size="small"
                              text
                              type="warning"
                              :loading="isShotTextRegenerating(shot)"
                              :disabled="shotTimeline.busy || isShotEditing(shot)"
                              @click="regenerateShotText(shot)"
                              title="保留本镜头的剧情、人物和镜头节奏，改写可能触发审核的文本"
                            ><AppIcon name="wand-sparkles" /><span>{{ isShotTextRegenerating(shot) ? '文本生成中' : '重新生成文本' }}</span></el-button>
                            <el-button
                              v-if="shotVideoStatus(shot.no) === 'queued' || shotVideoStatus(shot.no) === 'generating'"
                              size="small"
                              text
                              type="danger"
                              @click="cancelShotQueue(shot.no)"
                              title="强制移除该镜头的本地排队与结果追踪；平台已接收的生成可能仍会继续，但软件不再自动抓取"
                            ><AppIcon name="x" /><span>强制移除</span></el-button>
                            <el-button size="small" @click="openRangeSequentialDialog(shot.no)" title="从当前镜头开始，选择一段范围做首尾帧连续生成；已有任务时会自动排队">
                              <AppIcon name="film" /><span>{{ sequentialRunning ? '追加首尾帧' : '首尾帧连续生成' }}</span>
                            </el-button>
                            <el-button size="small" type="primary" :disabled="shotVideoStatus(shot.no) === 'queued' || shotVideoStatus(shot.no) === 'generating'" :loading="shotVideoStatus(shot.no) === 'generating'" @click="generateShotVideo(shot)"><AppIcon name="video" /><span>{{ shotVideoStatus(shot.no) === 'generating' ? '提交中' : (shotVideoStatus(shot.no) === 'queued' ? '等待出片' : (shotVideoStatus(shot.no) === 'failed' || shotVideoUrl(shot.no) ? '重新生成视频' : '生成视频')) }}</span></el-button>
                          </div>
                          <section v-if="shotVideoUrl(shot.no)" class="subtitle-removal" :class="{ 'is-open': subtitleRemovalState(shot.no).open, 'is-busy': subtitleRemovalState(shot.no).busy }">
                            <button
                              type="button"
                              class="subtitle-removal-toggle"
                              :aria-expanded="subtitleRemovalState(shot.no).open ? 'true' : 'false'"
                              @click="toggleSubtitleRemoval(shot.no)"
                            >
                              <span class="subtitle-removal-title">
                                <AppIcon name="wand-sparkles" />
                                <strong>智能去字幕</strong>
                                <small v-if="subtitleRemovalState(shot.no).resultType === 'success'" class="is-result"><AppIcon name="circle-check" />处理完成</small>
                                <small v-else-if="subtitleRemovalState(shot.no).hasBackup"><AppIcon name="circle-check" />原片已备份</small>
                              </span>
                              <AppIcon name="arrow-down" />
                            </button>
                            <div v-show="subtitleRemovalState(shot.no).open" class="subtitle-removal-body">
                              <div class="subtitle-removal-presets">
                                <span>字幕类型</span>
                                <el-segmented
                                  size="small"
                                  :model-value="subtitleRemovalState(shot.no).preset"
                                  :options="subtitlePresetOptions"
                                  :disabled="subtitleRemovalState(shot.no).busy"
                                  @update:model-value="applySubtitlePreset(shot.no, $event)"
                                />
                              </div>
                              <label class="subtitle-removal-control">
                                <span>垂直范围 <b>{{ subtitleRemovalState(shot.no).range[0] }}% - {{ subtitleRemovalState(shot.no).range[1] }}%</b></span>
                                <el-slider
                                  range
                                  :min="1"
                                  :max="99"
                                  :step="1"
                                  :show-tooltip="false"
                                  :model-value="subtitleRemovalState(shot.no).range"
                                  :disabled="subtitleRemovalState(shot.no).busy"
                                  @update:model-value="setSubtitleRange(shot.no, $event)"
                                />
                              </label>
                              <label class="subtitle-removal-control">
                                <span>修复宽度 <b>{{ subtitleRemovalState(shot.no).width }}%</b></span>
                                <el-slider
                                  :min="6"
                                  :max="98"
                                  :step="1"
                                  :show-tooltip="false"
                                  :model-value="subtitleRemovalState(shot.no).width"
                                  :disabled="subtitleRemovalState(shot.no).busy"
                                  @update:model-value="setSubtitleWidth(shot.no, $event)"
                                />
                              </label>
                              <div class="subtitle-removal-footer">
                                <span class="subtitle-removal-modes">
                                  <label>
                                    <span>修复算法</span>
                                    <el-segmented
                                      size="small"
                                      :model-value="subtitleRemovalState(shot.no).method"
                                      :options="subtitleMethodOptions"
                                      :disabled="subtitleRemovalState(shot.no).busy"
                                      @update:model-value="setSubtitleMethod(shot.no, $event)"
                                    />
                                  </label>
                                  <label>
                                    <span>输出质量</span>
                                    <el-segmented
                                      size="small"
                                      :model-value="subtitleRemovalState(shot.no).quality"
                                      :options="subtitleQualityOptions"
                                      :disabled="subtitleRemovalState(shot.no).busy"
                                      @update:model-value="setSubtitleQuality(shot.no, $event)"
                                    />
                                  </label>
                                </span>
                                <span class="subtitle-removal-actions">
                                  <el-button
                                    v-if="subtitleRemovalState(shot.no).hasBackup"
                                    size="small"
                                    :loading="subtitleRemovalState(shot.no).busy && subtitleRemovalState(shot.no).phase === 'restore'"
                                    :disabled="subtitleRemovalState(shot.no).busy"
                                    @click="restoreShotBeforeSubtitleRemoval(shot.no)"
                                  ><AppIcon name="rotate-ccw" /><span>还原原片</span></el-button>
                                  <el-button
                                    size="small"
                                    type="primary"
                                    :loading="subtitleRemovalState(shot.no).busy && subtitleRemovalState(shot.no).phase === 'remove'"
                                    :disabled="subtitleRemovalState(shot.no).busy"
                                    @click="removeShotSubtitles(shot.no)"
                                  ><AppIcon name="wand-sparkles" /><span>{{ subtitleRemovalState(shot.no).busy ? (subtitleRemovalState(shot.no).phase === 'restore' ? '还原中' : '逐帧修复中') : '开始去字幕' }}</span></el-button>
                                </span>
                              </div>
                              <div
                                v-if="subtitleRemovalState(shot.no).busy || subtitleRemovalState(shot.no).resultText"
                                class="subtitle-removal-result"
                                :class="{
                                  'is-running': subtitleRemovalState(shot.no).busy,
                                  'is-success': !subtitleRemovalState(shot.no).busy && subtitleRemovalState(shot.no).resultType === 'success',
                                  'is-error': !subtitleRemovalState(shot.no).busy && subtitleRemovalState(shot.no).resultType === 'error'
                                }"
                              >
                                <AppIcon name="loader-circle" />
                                <AppIcon name="circle-check" />
                                <AppIcon name="circle-alert" />
                                <span>{{ subtitleRemovalState(shot.no).busy ? (subtitleRemovalState(shot.no).phase === 'restore' ? '正在还原原片' : ('正在逐帧修复字幕区域 ' + subtitleRemovalState(shot.no).progress + '%')) : subtitleRemovalState(shot.no).resultText }}</span>
                                <el-button v-if="!subtitleRemovalState(shot.no).busy" text circle size="small" title="关闭状态" @click="clearSubtitleResult(shot.no)"><AppIcon name="x" /></el-button>
                                <div v-if="subtitleRemovalState(shot.no).busy && subtitleRemovalState(shot.no).phase === 'remove'" class="subtitle-removal-progress">
                                  <el-progress :percentage="subtitleRemovalState(shot.no).progress" :stroke-width="7" :show-text="false" />
                                  <small v-if="subtitleRemovalState(shot.no).progressTotalFrames">{{ subtitleRemovalState(shot.no).progressFrame }} / {{ subtitleRemovalState(shot.no).progressTotalFrames }} 帧</small>
                                </div>
                              </div>
                            </div>
                          </section>
                          </div>
                        </div>
                      </article>
                      <div class="shot-insert-row">
                        <button class="shot-insert-btn" @click="insertShotAfter(shot)" title="在当前分镜后添加一个空白分镜">
                          <AppIcon name="plus" /><span>在镜头 {{ shot.no }} 后添加分镜</span>
                        </button>
                        <button
                          v-if="canSplitShot(shot)"
                          class="shot-insert-btn"
                          title="按时间码把本镜头拆成两段等长镜头，便于改用只支持较短时长的模型"
                          @click="splitShotIntoTwoHalves(shot)"
                        >
                          <AppIcon name="scissors" />
                          <span>拆成两个 {{ shotSplitTarget(shot) }}s</span>
                        </button>
                        <button
                          v-else-if="canSplitShotByParagraph(shot)"
                          class="shot-insert-btn"
                          title="本镜头没有时间码，无法按时间拆分。这里按正文的段落边界（台词/音效/画面行）均分拆成两段内容，两段时长沿用原设置，不会重标时间码。"
                          @click="splitShotIntoTwoHalves(shot)"
                        >
                          <AppIcon name="scissors" />
                          <span>按段落拆两段</span>
                        </button>
                      </div>
                      </template>
                      <div
                        v-else
                        :class="['shot-card', 'shot-card-placeholder', 'video-' + (shotVideoUrl(shot.no) ? 'done' : shotVideoStatus(shot.no) || 'none'), { 'is-locked': isShotLocked(shot), 'needs-attention': isShotAttentionMarked(shot) }]"
                        aria-hidden="true"
                      ></div>
                      </div>
                    </template>
                    <div
                      v-if="shotTimelineHasMoreRenderedShots"
                      v-progressive-render="loadMoreShotCards"
                      class="progressive-render-sentinel"
                      aria-hidden="true"
                    ></div>
                  </div>
                </section>
              </section>

              <!-- 分镜卡片跳转舵轮：放在 workspace-stage-shell 外面，避免被 is-parked 的 visibility:hidden 影响 -->
              <nav v-if="view === 'workspace' && shotTimelineVisibleShots.length > 1" :class="['shot-jump-dock', { 'is-jumping': shotTimeline.dockJumpOpen }]" aria-label="分镜卡片快速跳转">
                <button
                  type="button"
                  class="shot-jump-dock-look"
                  title="批量设置当前集人物造型"
                  aria-label="批量造型"
                  @click="openBatchCharacterLookDialog"
                >
                  <AppIcon name="user-round" />
                </button>
                <button
                  v-if="selectedSbStoryboard && currentShots.length"
                  type="button"
                  class="shot-jump-dock-binding"
                  title="打开本集元素绑定总览（无需返回顶部）"
                  aria-label="绑定总览"
                  @click="openBindingOverview"
                >
                  <AppIcon name="cable" />
                </button>
                <button
                  v-if="selectedSbStoryboard && currentShots.length"
                  type="button"
                  class="shot-jump-dock-video"
                  title="打开本集视频总览（无需返回顶部）"
                  aria-label="视频总览"
                  @click="openVideoOverview"
                >
                  <AppIcon name="film" />
                </button>
                <button type="button" title="回到页面顶部（Home）" aria-label="回到页面顶部" @click="scrollShotListToTop">
                  <AppIcon name="arrow-up-to-line" />
                </button>
                <button type="button" title="上一个分镜卡片（PageUp）" aria-label="上一个分镜卡片" @click="previousShotCard">
                  <AppIcon name="arrow-up" />
                </button>
                <input
                  v-if="shotTimeline.dockJumpOpen"
                  v-model="shotTimeline.dockJumpNo"
                  class="shot-jump-dock-input"
                  type="text"
                  inputmode="numeric"
                  placeholder="镜号"
                  aria-label="输入要跳转的镜号"
                  @vue:mounted="$event.el.focus()"
                  @keyup.enter="dockJumpApply"
                  @keyup.esc="closeDockJump"
                  @blur="closeDockJump"
                />
                <button
                  v-else
                  type="button"
                  class="shot-jump-dock-count"
                  :title="'共 ' + shotTimelineVisibleShots.length + ' 个分镜，点击按镜号跳转'"
                  aria-label="按镜号跳转"
                  @click="toggleDockJump"
                >{{ shotTimelineVisibleShots.length }}</button>
                <button type="button" title="下一个分镜卡片（PageDown）" aria-label="下一个分镜卡片" @click="nextShotCard">
                  <AppIcon name="arrow-down" />
                </button>
                <button type="button" title="跳到最后一个分镜卡片（End）" aria-label="跳到最后一个分镜卡片" @click="scrollShotListToBottom">
                  <AppIcon name="arrow-down-to-line" />
                </button>
              </nav>
            </section>

            <!-- 本集绑定总览：把分镜正文和真实元素绑定并排展示，便于快速人工复核。 -->
            <el-dialog
              v-model="bindingOverviewDialog.visible"
              :title="'元素绑定总览 · 第 ' + sbEpisodeId + ' 集'"
              width="min(1240px, calc(100vw - 48px))"
              destroy-on-close
              class="storyboard-binding-overview-dialog"
              @opened="scrollBindingOverviewToAnchor"
            >
              <div class="binding-overview-shell">
                <header class="binding-overview-head">
                  <div class="binding-overview-summary">
                    <strong>本集 {{ bindingOverviewSummary.total }} 个镜头</strong>
                    <span class="is-ready">素材齐全 {{ bindingOverviewSummary.ready }}</span>
                    <span v-if="bindingOverviewSummary.unbound" class="is-danger">未绑定 {{ bindingOverviewSummary.unbound }}</span>
                    <span v-if="bindingOverviewSummary.missing" class="is-warning">有缺图 {{ bindingOverviewSummary.missing }}</span>
                  </div>
                  <el-input v-model="bindingOverviewDialog.query" clearable size="small" placeholder="搜索镜号、分镜内容或元素名" aria-label="搜索元素绑定">
                    <template #prefix><AppIcon name="search" /></template>
                  </el-input>
                </header>
                <div class="binding-overview-filterbar">
                  <el-radio-group v-model="bindingOverviewDialog.filter" size="small" aria-label="元素绑定筛选">
                    <el-radio-button label="all">全部 {{ bindingOverviewSummary.total }}</el-radio-button>
                    <el-radio-button label="issues">待检查 {{ bindingOverviewSummary.issues }}</el-radio-button>
                    <el-radio-button label="unbound">未绑定 {{ bindingOverviewSummary.unbound }}</el-radio-button>
                    <el-radio-button label="missing">有缺图 {{ bindingOverviewSummary.missing }}</el-radio-button>
                    <el-radio-button label="ready">素材齐全 {{ bindingOverviewSummary.ready }}</el-radio-button>
                  </el-radio-group>
                  <span>自动与手动绑定均按镜头卡片当前结果显示</span>
                </div>
                <div class="binding-overview-actionsbar">
                  <span>先补齐绑定，再批量提交视频；已出片、已提交和生成中的镜头会自动跳过。</span>
                  <div>
                    <el-button
                      size="small"
                      :loading="aiBinding.running && aiBinding.scope === 'all'"
                      :disabled="aiBinding.running || !bindingOverviewSummary.issues"
                      @click="runAiElementBinding({ scope: 'all' })"
                      title="让 AI 重新判断本集全部分镜的人物、场景、道具和特效绑定"
                    >
                      <AppIcon name="wand-sparkles" /><span>AI补全/修正 {{ bindingOverviewSummary.issues }}</span>
                    </el-button>
                    <el-button
                      size="small"
                      type="primary"
                      plain
                      :loading="batchVideoRunning"
                      :disabled="batchVideoRunning || !videoOverviewMissingCount"
                      @click="generateAllShotVideos"
                      title="只提交当前集还没有视频的镜头，已生成或已提交的镜头自动跳过"
                    >
                      <AppIcon name="film" /><span>生成未出片视频 {{ videoOverviewMissingCount }}</span>
                    </el-button>
                  </div>
                </div>

                <div v-if="!bindingOverviewFilteredEntries.length" class="binding-overview-empty">
                  <AppIcon name="search" />
                  <strong>没有匹配的分镜</strong>
                  <span>更换筛选条件或清空搜索词。</span>
                </div>
                <div v-else class="binding-overview-grid">
                  <article
                    v-for="entry in bindingOverviewFilteredEntries"
                    :key="'binding-overview:' + sbEpisodeId + ':' + entry.shot.no"
                    :class="['binding-overview-item', 'is-' + entry.status, { 'is-open-anchor': String(bindingOverviewDialog.anchorShotNo) === String(entry.shot.no) }]"
                    :data-binding-overview-shot-no="String(entry.shot.no)"
                  >
                    <div class="binding-overview-shot">
                      <div class="binding-overview-shot-head">
                        <b>镜头 {{ entry.shot.no }}</b>
                        <span :title="entry.shot.title || ('镜头 ' + entry.shot.no)">{{ entry.shot.title || '未命名镜头' }}</span>
                        <el-tag size="small" effect="plain" :type="entry.status === 'ready' ? 'success' : (entry.status === 'missing' ? 'warning' : 'danger')">
                          {{ bindingOverviewStatusLabel(entry) }}
                        </el-tag>
                      </div>
                      <p class="binding-overview-shot-body">{{ entry.shot.body || '本镜暂无分镜正文' }}</p>
                      <div class="binding-overview-description">
                        <div v-for="field in entry.descriptionFields" :key="field.key" class="binding-overview-description-row">
                          <span class="binding-overview-description-label"><i class="cat-dot" :class="field.key"></i>{{ field.label }}</span>
                          <p>{{ field.value }}</p>
                        </div>
                        <span v-if="!entry.descriptionFields.length" class="binding-overview-description-empty">分镜描述词中暂未识别出场景、人物或道具字段</span>
                      </div>
                    </div>
                    <div class="binding-overview-assets">
                      <div
                        v-for="tag in entry.tags"
                        :key="entry.shot.no + ':' + tag.cat + ':' + tag.name"
                        :class="['binding-overview-asset', { 'is-missing': !tag.hasImage }]"
                      >
                        <button
                          type="button"
                          class="binding-overview-asset-main"
                          :title="tag.hasImage ? '查看 ' + (tag.displayName || tag.name) + ' 大图' : (tag.displayName || tag.name) + ' 尚未出图，点击定位元素'"
                          @click="inspectBindingOverviewTag(tag)"
                        >
                          <img v-if="tag.hasImage" :src="tag.url" alt="" loading="lazy" decoding="async" />
                          <span v-else class="binding-overview-asset-placeholder"><AppIcon name="image" /></span>
                          <span class="binding-overview-asset-copy">
                            <b>{{ tag.displayName || tag.name }}</b>
                            <small><i class="cat-dot" :class="tag.cat"></i>{{ catLabel[tag.cat] || tag.cat }} · {{ bindingOverviewSourceLabel(tag) }}</small>
                          </span>
                          <AppIcon name="circle-alert" />
                        </button>
                        <span class="binding-overview-asset-actions">
                          <button
                            type="button"
                            class="binding-overview-asset-action"
                            :disabled="isShotLocked(entry.shot)"
                            :title="isShotLocked(entry.shot) ? '镜头已锁定，请先解锁' : '替换此素材'"
                            @click.stop="openBindingOverviewPicker(entry, tag)"
                          ><AppIcon name="pen-line" /></button>
                          <button
                            type="button"
                            class="binding-overview-asset-action is-danger"
                            :disabled="isShotLocked(entry.shot)"
                            :title="isShotLocked(entry.shot) ? '镜头已锁定，请先解锁' : '从本镜删除此素材'"
                            @click.stop="removeBindingOverviewTag(entry, tag)"
                          ><AppIcon name="x" /></button>
                        </span>
                      </div>
                      <div v-if="!entry.tags.length" class="binding-overview-unbound">
                        <AppIcon name="circle-alert" />
                        <span><b>本镜未绑定任何元素</b><small>可以在下方直接添加素材，或先让 AI 复核。</small></span>
                      </div>
                    </div>
                    <div class="binding-overview-audios">
                      <span class="binding-overview-audios-label"><AppIcon name="mic" />人物音频</span>
                      <span v-if="!entry.audios.length" class="binding-overview-audios-empty">未绑定</span>
                      <span v-for="audio in entry.audios" :key="'overview-audio:' + entry.shot.no + ':' + audio.name" class="binding-overview-audio-chip">
                        <span>{{ audio.displayName || audio.name }}</span>
                        <audio :src="audio.url" controls preload="none"></audio>
                        <button type="button" class="binding-overview-audio-remove" :disabled="isShotLocked(entry.shot)" :title="isShotLocked(entry.shot) ? '镜头已锁定，请先解锁' : '移除本镜人物音频'" @click="!isShotLocked(entry.shot) && removeShotAudioTag(entry.shot.no, audio.name)"><AppIcon name="x" /></button>
                      </span>
                    </div>
                    <footer class="binding-overview-actions">
                      <span v-if="entry.tags.length">
                        {{ entry.tags.length }} 项元素 · 自动 {{ entry.automaticCount }}<template v-if="entry.aiCount"> · AI {{ entry.aiCount }}</template><template v-if="entry.manualCount"> · 手动 {{ entry.manualCount }}</template>
                      </span>
                      <span v-else>需要检查人物、场景、道具或特效</span>
                      <el-popover
                        :visible="isBindingOverviewAudioPickerVisible(entry)"
                        @update:visible="setBindingOverviewAudioPickerVisible(entry, $event)"
                        placement="top-end"
                        :fallback-placements="['bottom-end','left','right']"
                        :width="320"
                        trigger="click"
                        :persistent="false"
                        popper-class="shot-picker-popper shot-audio-popper"
                        @show="openBindingOverviewAudioPicker(entry)"
                      >
                        <template #reference>
                          <el-button size="small" plain :disabled="isShotLocked(entry.shot)" title="添加人物音频">
                            <AppIcon name="mic" /><span>人物音频</span>
                          </el-button>
                        </template>
                        <div class="shot-audio-pop">
                          <div class="add-tag-header">
                            <el-input v-model="addTagPanel.audioSearchQuery" size="small" placeholder="搜索人物音频" clearable>
                              <template #prefix><AppIcon name="search" /></template>
                            </el-input>
                          </div>
                          <div class="shot-audio-options">
                            <button
                              v-for="audio in filteredShotAudioOptions"
                              :key="'overview-audio-option:' + audio.name"
                              type="button"
                              :class="['shot-audio-option', { on: isShotAudioBound(entry.shot.no, audio.name) }]"
                              @click="toggleBindingOverviewAudio(entry, audio.name)"
                            >
                              <span class="shot-audio-option-icon"><AppIcon name="mic" /></span>
                              <span><b>{{ audio.displayName || audio.name }}</b><small>{{ audio.voiceName || '配音参考音频' }}</small></span>
                              <AppIcon name="check" />
                            </button>
                            <p v-if="!filteredShotAudioOptions.length" class="muted"><AppIcon name="search" /> 没有可用的人物音频</p>
                          </div>
                        </div>
                      </el-popover>
                      <el-popover
                        :visible="isBindingOverviewPickerVisible(entry)"
                        @update:visible="setBindingOverviewPickerVisible(entry, $event)"
                        placement="top-end"
                        :fallback-placements="['bottom-end','left','right']"
                        :width="380"
                        trigger="click"
                        :persistent="false"
                        popper-class="shot-picker-popper add-tag-popper binding-overview-picker"
                        @show="openBindingOverviewPicker(entry)"
                      >
                        <template #reference>
                          <el-button size="small" plain :disabled="isShotLocked(entry.shot)" title="给本镜添加素材">
                            <AppIcon name="plus" /><span>添加素材</span>
                          </el-button>
                        </template>
                        <div class="add-tag-pop binding-overview-add-pop">
                          <div class="binding-overview-add-title">
                            <strong v-if="bindingOverviewDialog.replaceTarget">替换素材：{{ bindingOverviewDialog.replaceTarget.name }}</strong>
                            <strong v-else>添加素材到镜头 {{ entry.shot.no }}</strong>
                            <small v-if="bindingOverviewDialog.replaceTarget">请选择新的场景、人物、道具或特效</small>
                          </div>
                          <div class="add-tag-header">
                            <el-input v-model="addTagPanel.searchQuery" size="small" placeholder="搜索人物、场景、道具或特效" clearable>
                              <template #prefix><AppIcon name="search" /></template>
                            </el-input>
                            <el-select v-model="addTagPanel.selectedCategory" size="small" style="width:100px;margin-left:8px">
                              <el-option label="全部" value="all" />
                              <el-option label="人物" value="character" />
                              <el-option label="群像" value="group" />
                              <el-option label="场景" value="scene" />
                              <el-option label="道具" value="prop" />
                              <el-option label="特效" value="effect" />
                              <el-option label="妖兽" value="creature" />
                            </el-select>
                          </div>
                          <div class="add-tag-cats">
                            <div v-for="c in ['character','group','scene','prop','effect','creature']" :key="'overview-' + c" class="add-tag-cat-group" v-show="(filteredAddTagElements[c] || []).length">
                              <div class="add-tag-cat-label"><span class="cat-dot" :class="c"></span>{{ catLabel[c] }}</div>
                              <span
                                v-for="el in filteredAddTagElements[c]"
                                :key="'overview:' + c + ':' + el.name"
                                :class="['add-tag-item', { on: isBindingOverviewTagManual(entry, c, el.name), bound: isBindingOverviewTagBound(entry, c, el.name) }]"
                                @click="addBindingOverviewTag(entry, c, el.name)"
                              >{{ el.name }}<AppIcon name="check" /></span>
                            </div>
                            <p v-if="!Object.values(filteredAddTagElements).some(arr => arr.length)" class="muted"><AppIcon name="search" /> 元素库中暂无匹配素材</p>
                          </div>
                        </div>
                      </el-popover>
                      <el-button size="small" text :loading="aiBinding.running && aiBinding.activeShotNo === String(entry.shot.no)" :disabled="aiBinding.running || isShotLocked(entry.shot)" @click="runAiElementBinding({ shot: entry.shot, scope: 'single' })">
                        <AppIcon name="wand-sparkles" /><span>AI 复核</span>
                      </el-button>
                      <el-button size="small" type="primary" plain @click="focusShotFromBindingOverview(entry)">
                        <AppIcon name="crosshair" /><span>定位修改</span>
                      </el-button>
                    </footer>
                  </article>
                </div>
              </div>
              <template #footer>
                <el-button @click="closeBindingOverview">关闭</el-button>
              </template>
            </el-dialog>

            <!-- 本集视频总览：集中查看已出片视频，避免在长分镜列表中逐个寻找。 -->
            <el-dialog
              v-model="videoOverviewDialog.visible"
              :title="'视频总览 · 第 ' + sbEpisodeId + ' 集'"
              width="min(1180px, calc(100vw - 48px))"
              destroy-on-close
              class="storyboard-video-overview-dialog"
              @opened="scrollVideoOverviewToAnchor"
            >
              <div class="video-overview-shell">
                <header class="video-overview-head">
                  <div class="video-overview-summary">
                    <strong>本集视频</strong>
                    <span>已出片 {{ videoOverviewDoneCount }} / {{ currentShots.length }}</span>
                    <span v-if="videoOverviewPendingCount">生成中 {{ videoOverviewPendingCount }}</span>
                    <span v-if="videoOverviewMissingCount">未生成 {{ videoOverviewMissingCount }}</span>
                  </div>
                  <div class="video-overview-head-actions">
                    <el-button
                      size="small"
                      type="primary"
                      plain
                      :loading="batchVideoRunning"
                      :disabled="batchVideoRunning || !videoOverviewMissingCount"
                      @click="generateAllShotVideos"
                      title="只提交当前集还没有视频的镜头，已生成或已提交的镜头自动跳过"
                    >
                      <AppIcon name="film" /><span>生成未生成视频 {{ videoOverviewMissingCount }}</span>
                    </el-button>
                    <el-radio-group v-model="videoOverviewDialog.filter" size="small" aria-label="视频总览筛选">
                      <el-radio-button label="all">全部 {{ currentShots.length }}</el-radio-button>
                      <el-radio-button label="recent" :disabled="!videoOverviewRecentCount">刚刚生成 {{ videoOverviewRecentCount }}</el-radio-button>
                      <el-radio-button label="done">已出片 {{ videoOverviewDoneCount }}</el-radio-button>
                      <el-radio-button label="pending">生成中 {{ videoOverviewPendingCount }}</el-radio-button>
                      <el-radio-button label="missing">未生成 {{ videoOverviewMissingCount }}</el-radio-button>
                      <el-radio-button label="attention" :disabled="!videoOverviewAttentionCount && videoOverviewDialog.filter !== 'attention'">待处理 {{ videoOverviewAttentionCount }}</el-radio-button>
                    </el-radio-group>
                  </div>
                </header>

                <div v-if="!videoOverviewShots.length" class="video-overview-empty">
                  <AppIcon name="play" />
                  <strong>当前筛选下没有视频</strong>
                  <span>切换筛选条件，或先提交本集视频生成任务。</span>
                </div>
                <div v-else class="video-overview-grid">
                  <article
                    v-for="shot in videoOverviewRenderedShots"
                    :key="'overview:' + sbEpisodeId + ':' + shot.no"
                    :class="['video-overview-item', { 'needs-attention': isShotAttentionMarked(shot), 'is-open-anchor': String(videoOverviewDialog.anchorShotNo) === String(shot.no) }]"
                    :data-video-overview-shot-no="String(shot.no)"
                  >
                    <div class="video-overview-media">
                      <video
                        v-if="shotVideoUrl(shot.no)"
                        v-lazy-video="shotVideoUrl(shot.no)"
                        controls
                        playsinline
                        draggable="true"
                        :title="'拖拽到剪映等外部软件导入：镜头 ' + shot.no"
                        @dragstart="startVideoFileDrag($event, shotVideoUrl(shot.no))"
                        :aria-label="'镜头 ' + shot.no + ' 视频预览'"
                        @click.stop
                      ></video>
                      <div v-else class="video-overview-placeholder">
                        <AppIcon name="video" />
                        <span>{{ videoOverviewStatusLabel(shot) }}</span>
                      </div>
                      <span class="video-overview-index">#{{ shot.no }}</span>
                      <span :class="['video-overview-status', 'is-' + (['queued', 'generating', 'failed'].includes(shotVideoStatus(shot.no)) ? shotVideoStatus(shot.no) : (shotVideoUrl(shot.no) ? 'done' : 'idle'))]">
                        {{ videoOverviewStatusLabel(shot) }}
                      </span>
                    </div>
                    <div class="video-overview-item-body">
                      <div class="video-overview-item-title" :title="shot.title || ('镜头 ' + shot.no)">
                        <b>镜头 {{ shot.no }}</b>
                        <span>{{ shot.title || '未命名镜头' }}</span>
                      </div>
                      <div class="video-overview-item-meta">
                        <span><AppIcon name="clock" />{{ shotTimelineDuration(shot) }}s</span>
                      </div>
                      <div class="video-overview-item-actions">
                        <el-button size="small" text @click="focusShotFromVideoOverview(shot)">
                          <AppIcon name="crosshair" /><span>定位分镜</span>
                        </el-button>
                        <el-button
                          size="small"
                          text
                          :class="['video-overview-attention-button', { active: isShotAttentionMarked(shot) }]"
                          :title="isShotAttentionMarked(shot) ? '移出待处理' : '标注为待处理'"
                          :aria-label="isShotAttentionMarked(shot) ? '移出待处理' : '标注为待处理'"
                          :disabled="shotTimeline.busy"
                          @click="toggleShotAttention(shot)"
                        >
                          <AppIcon name="circle-alert" /><span>{{ isShotAttentionMarked(shot) ? '移出待处理' : '标注待处理' }}</span>
                        </el-button>
                        <el-button
                          size="small"
                          type="primary"
                          plain
                          :loading="shotVideoStatus(shot.no) === 'generating'"
                          :disabled="['queued', 'generating'].includes(shotVideoStatus(shot.no))"
                          @click="generateShotVideo(shot)"
                        >
                          <AppIcon name="rotate-cw" />
                          <AppIcon name="play" />
                          <span>{{ videoOverviewActionLabel(shot) }}</span>
                        </el-button>
                      </div>
                    </div>
                  </article>
                  <div
                    v-if="videoOverviewHasMore"
                    v-progressive-render="loadMoreVideoOverviewShots"
                    class="video-overview-load-more"
                    aria-hidden="true"
                  >
                    <AppIcon name="loader-circle" />
                  </div>
                </div>
              </div>
              <template #footer>
                <el-button @click="closeVideoOverview">关闭</el-button>
              </template>
            </el-dialog>

            <!-- 视频历史记录对话框 -->
            <el-dialog
              v-model="historyDialog.visible"
              :title="'历史版本 · ' + historyDialog.shotTitle"
              width="720px"
              :close-on-click-modal="!historyDialog.restoring"
              :close-on-press-escape="!historyDialog.restoring"
              destroy-on-close
              class="video-history-dialog"
            >
              <div v-loading="historyDialog.loading || historyDialog.restoring" element-loading-text="处理中…">
                <p v-if="historyDialog.stats && historyDialog.stats.count" class="video-history-stats">
                  已保存 <b>{{ historyDialog.stats.count }}</b> / {{ historyDialog.stats.maxCount }} 个版本
                  <span class="video-history-stats-size">（共 {{ historyDialog.stats.totalSizeFormatted }}）</span>
                </p>
                <div v-if="!historyDialog.loading && !historyDialog.versions.length" class="video-history-empty">
                  <AppIcon name="play" />
                  <span>暂无历史版本</span>
                  <small>每次重新生成视频时，旧版本会自动保存在这里</small>
                </div>
                <ul v-else class="video-history-list">
                  <li v-for="(ver, idx) in historyDialog.versions" :key="ver.timestamp" class="video-history-item">
                    <video
                      class="video-history-preview"
                      :src="historyVideoUrl(ver)"
                      preload="metadata"
                      controls
                      muted
                      playsinline
                      :aria-label="'历史版本 ' + (historyDialog.versions.length - idx) + ' 视频预览'"
                      @loadedmetadata="prepareHistoryPreview"
                      @click.stop
                    ></video>
                    <span class="video-history-details">
                      <span class="video-history-index">版本 {{ historyDialog.versions.length - idx }}</span>
                      <span class="video-history-meta">
                        <span class="video-history-time" :title="ver.createdAt">{{ formatDateTime(ver.createdAt) }}</span>
                        <span class="video-history-size">{{ ver.sizeFormatted }}</span>
                      </span>
                    </span>
                    <span class="video-history-actions">
                      <el-button size="small" type="primary" :disabled="historyDialog.restoring" @click="restoreHistoryVersion(ver)">恢复</el-button>
                      <el-button size="small" text type="danger" :disabled="historyDialog.restoring" @click="deleteHistoryVersion(ver)"><AppIcon name="trash-2" /></el-button>
                    </span>
                  </li>
                </ul>
              </div>
              <template #footer>
                <el-button v-if="historyDialog.versions.length" text type="danger" :disabled="historyDialog.loading || historyDialog.restoring" @click="clearAllHistory">清空全部</el-button>
                <el-button :disabled="historyDialog.restoring" @click="closeVideoHistory">关闭</el-button>
              </template>
            </el-dialog>

          </template>
        </template>`;
