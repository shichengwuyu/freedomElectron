export const coverStudioView = /* html */ `
        <template v-if="view === 'cover'">
          <section class="cover-studio">
            <header class="page-head cover-head">
              <div class="page-head-copy">
                <div class="eyebrow">Cover Studio</div>
                <h1>封面生成</h1>
                <p>从参考素材生成小说封面，可下载 PNG 原图。</p>
              </div>
            </header>
            <main class="cover-studio-workbench">
              <section class="cover-studio-preview-panel">
                <header class="cover-studio-panel-head">
                  <div><span class="cover-studio-overline">Preview</span><h2>封面预览</h2></div>
                  <span class="cover-studio-ratio-tag">{{ coverStudio.ratio }}</span>
                </header>
                <div class="cover-studio-preview-wrap">
                  <div class="cover-studio-preview-halo"></div>
                  <div :class="['cover-studio-preview', 'ratio-' + coverStudio.ratio.replace(':', '-')]">
                    <img v-if="coverStudio.generatedDataUrl" :src="coverStudio.generatedDataUrl" alt="生成的小说封面" />
                    <div v-else class="cover-studio-preview-blank">
                      <div class="cover-studio-blank-mark"><AppIcon name="image" /></div>
                      <b>等待第一张封面</b>
                      <small>设置标题或上传参考图后开始生成</small>
                    </div>
                    <span class="cover-studio-preview-badge">{{ coverStudio.ratio }}</span>
                  </div>
                </div>
                <div class="cover-studio-preview-footer">
                  <div class="cover-studio-preview-caption">
                    <span class="cover-studio-overline">Generated cover</span>
                    <h3>{{ coverStudio.title || '未命名封面' }}</h3>
                    <p>{{ coverStudio.generatedDataUrl ? '封面已生成，可下载 PNG 原图。' : '生成结果会只保存在当前独立工作区。' }}</p>
                  </div>
                  <el-button v-if="coverStudio.generatedDataUrl" plain class="cover-studio-download" @click="downloadStandaloneCover">
                    <AppIcon name="download" /><span>下载 PNG</span>
                  </el-button>
                </div>
                <div class="cover-studio-preview-stats">
                  <span><b>{{ coverStudio.ratio }}</b><small>当前画幅</small></span>
                  <span><b>{{ coverStudio.references.length }}</b><small>参考素材</small></span>
                  <span><b>PNG</b><small>导出格式</small></span>
                </div>
              </section>

              <section class="cover-studio-controls">
                <header class="cover-studio-controls-head">
                  <div><span class="cover-studio-overline">Create</span><h2>生成设置</h2></div>
                  <div class="cover-studio-controls-actions">
                    <el-button text class="cover-studio-clear-form" :disabled="coverStudio.generating" title="清空当前生成设置" @click="clearCoverGenerationForm"><AppIcon name="rotate-ccw" /><span>一键清空</span></el-button>
                    <span class="cover-studio-step-label">01 / 02</span>
                  </div>
                </header>

                <div class="cover-studio-control-section">
                  <div class="cover-studio-section-label"><span>封面信息</span></div>
                  <div class="cover-studio-title-fields">
                    <label><span>封面标题 <small>可选 · 会写入画面艺术字</small></span><el-input v-model="coverStudio.title" clearable maxlength="80" placeholder="例如：无儿无女？我的遗产你们别惦记" /></label>
                  </div>
                  <el-input v-model="coverStudio.storyIdea" type="textarea" :rows="3" maxlength="1200" show-word-limit :disabled="coverStudio.generating" placeholder="故事想法 / 小说简介（可选）：例如，退役刑警追查妹妹失踪案，每接近真相就会失去一名证人。" />
                </div>

                <div class="cover-studio-control-section cover-studio-genre-section">
                  <div class="cover-studio-section-label"><span>题材类型</span><small>选择一个最接近的方向，也可以在下方输入自定义类型</small></div>
                  <div class="cover-studio-genre-grid">
                    <button v-for="option in NOVEL_COVER_GENRE_OPTIONS" :key="option.value" type="button" :class="['cover-studio-genre-option', { active: coverStudio.genre === option.value }]" :disabled="coverStudio.generating" @click="coverStudio.genre = option.value">{{ option.label }}</button>
                  </div>
                  <el-input v-model="coverStudio.genre" clearable maxlength="80" :disabled="coverStudio.generating" placeholder="自定义题材，例如：赛博朋克悬疑、东方志怪爱情" />
                </div>

                <div class="cover-studio-control-section">
                  <div class="cover-studio-section-label"><span>画面比例</span><small>选择适合发布平台的构图</small></div>
                  <div class="cover-studio-ratio-grid">
                    <button v-for="option in NOVEL_COVER_RATIO_OPTIONS" :key="option.value" type="button" :class="['cover-studio-ratio-option', { active: coverStudio.ratio === option.value }]" :disabled="coverStudio.generating" @click="coverStudio.ratio = option.value">
                      <i :style="{ aspectRatio: option.value.replace(':', ' / ') }"></i>
                      <span>{{ option.value }}</span>
                      <small>{{ option.label.replace(option.value + ' ', '').replace('（推荐）', '') }}</small>
                    </button>
                  </div>
                </div>

                <div class="cover-studio-control-section cover-studio-reference-section">
                  <div class="cover-studio-section-label"><div><span>本地参考图</span><small>人物、场景、道具或画风 · 最多 9 张</small></div><b>{{ coverStudio.references.length }} / 9</b></div>
                  <div :class="['cover-studio-dropzone', { dragging: coverStudio.dragging }]" @dragenter.prevent="coverStudio.dragging = true" @dragover.prevent="coverStudio.dragging = true" @dragleave.prevent="coverStudio.dragging = false" @drop.prevent="onDropCoverReferences">
                    <div class="cover-studio-upload-icon"><AppIcon name="upload" /></div>
                    <div class="cover-studio-drop-copy"><b>拖入图片，或从电脑选择</b><small>PNG、JPG、WebP 等常见格式，单张不超过 15 MB</small></div>
                    <el-button plain type="primary" :loading="coverStudio.reading" :disabled="coverStudio.references.length >= 9 || coverStudio.generating" @click="$event.currentTarget.nextElementSibling.click()"><AppIcon name="plus" /><span>添加图片</span></el-button>
                    <input type="file" accept="image/*,.png,.jpg,.jpeg,.jfif,.webp,.gif,.bmp,.avif" multiple hidden @change="onPickCoverReferences" />
                  </div>
                  <div v-if="coverStudio.references.length" class="cover-studio-local-grid">
                    <article v-for="item in coverStudio.references" :key="item.id" class="cover-studio-local-item">
                      <button type="button" :aria-label="'预览 ' + item.name" @click="lightboxSrc = item.dataUrl"><img :src="item.dataUrl" :alt="item.name" /></button>
                      <div><b :title="item.name">{{ item.name }}</b><el-select v-model="item.referenceType" size="small" :disabled="coverStudio.generating" :aria-label="item.name + ' 的参考类型'"><el-option v-for="type in NOVEL_COVER_LOCAL_REFERENCE_TYPES" :key="type.value" :label="type.label" :value="type.value" /></el-select></div>
                      <el-button text circle type="danger" :disabled="coverStudio.generating" title="移除参考图" aria-label="移除参考图" @click="removeCoverReference(item.id)"><AppIcon name="x" /></el-button>
                    </article>
                  </div>
                </div>

                <footer class="cover-studio-generate-bar">
                  <div><span class="cover-studio-generate-status"><i></i>{{ coverStudio.generating ? '正在生成封面…' : '准备就绪' }}</span><small>{{ coverStudio.references.length ? '参考人物与场景会融入封面构图' : '可直接开始生成一张全新封面' }}</small></div>
                  <el-button type="primary" size="large" class="cover-studio-generate-button" :loading="coverStudio.generating" @click="generateStandaloneCover"><AppIcon name="wand-sparkles" /><span>生成封面</span></el-button>
                </footer>
              </section>
            </main>

            <section class="cover-studio-history" aria-labelledby="cover-history-title">
              <header class="cover-studio-history-head">
                <div><span class="cover-studio-overline">Archive</span><h2 id="cover-history-title">历史生成</h2><p>每次成功生成的封面都会保存在这里，可重新预览或下载。</p></div>
                <el-button v-if="coverStudio.history.length" text type="danger" :disabled="coverStudio.historyActionId" @click="clearCoverHistory"><AppIcon name="trash-2" /><span>清空历史</span></el-button>
              </header>
              <div v-if="coverStudio.historyLoading" class="cover-studio-history-empty"><AppIcon name="loader-circle" /><span>正在读取历史封面…</span></div>
              <div v-else-if="!coverStudio.history.length" class="cover-studio-history-empty"><AppIcon name="clock" /><span>还没有生成记录，完成第一次生成后会显示在这里。</span></div>
              <div v-else class="cover-studio-history-grid">
                <article v-for="item in coverStudio.history" :key="item.id" :class="['cover-studio-history-item', { active: coverStudio.selectedHistoryId === item.id }]">
                  <button type="button" class="cover-studio-history-thumb" :aria-label="'查看历史封面 ' + (item.title || '未命名封面')" @click="selectCoverHistory(item)"><img :src="item.imageUrl" :alt="item.title || '历史封面'" /><span>{{ item.ratio }}</span></button>
                  <div class="cover-studio-history-info"><b :title="item.title || '未命名封面'">{{ item.title || '未命名封面' }}</b><small>{{ formatCoverHistoryTime(item.createdAt) }} · {{ item.referencesUsed }} 张参考图</small></div>
                  <div class="cover-studio-history-actions">
                    <el-button text circle title="下载历史封面" aria-label="下载历史封面" @click="downloadCoverHistory(item)"><AppIcon name="download" /></el-button>
                    <el-button text circle type="danger" title="删除历史封面" aria-label="删除历史封面" :disabled="coverStudio.historyActionId === item.id" @click="removeCoverHistory(item.id)"><AppIcon name="trash-2" /></el-button>
                  </div>
                </article>
              </div>
            </section>
          </section>
        </template>`;
