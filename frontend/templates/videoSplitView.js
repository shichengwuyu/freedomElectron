export const videoSplitView = /* html */ `
        <template v-if="view === 'split'">
          <section class="video-split-studio">
            <header class="video-split-head">
              <div>
                <span class="video-split-overline">LOCAL VIDEO TOOL</span>
                <h1>一键切割</h1>
                <p>按自定义节奏拆分长视频，所有片段连续覆盖原视频内容。</p>
              </div>
              <div class="video-split-head-status" :class="{ active: splitStudio.splitting }">
                <i></i><span>{{ splitStudio.splitting ? '正在处理' : splitStudio.segments.length ? '切割完成' : '准备就绪' }}</span>
              </div>
            </header>

            <main class="video-split-layout">
              <section class="video-split-source-panel">
                <div class="video-split-section-title"><span>视频来源</span><small>本地文件</small></div>
                <button type="button" class="video-split-dropzone" :disabled="splitStudio.splitting" @click="chooseSplitVideo">
                  <span class="video-split-file-icon"><AppIcon name="video" /></span>
                  <span class="video-split-file-copy">
                    <b>{{ splitStudio.sourceName || '选择要切割的视频' }}</b>
                    <small>{{ splitStudio.sourceFiles.length ? '点击可重新选择多个视频部分' : '支持一次选择多个 MP4、MOV、MKV、AVI、WebM 文件' }}</small>
                  </span>
                  <AppIcon name="folder-open" />
                </button>
                <div v-if="splitStudio.probing" class="video-split-probe"><AppIcon name="loader-circle" /><span>正在读取视频时长…</span></div>
                <div v-else-if="splitStudio.sourceFiles.length" class="video-split-source-meta">
                  <span><b>{{ formatSplitDuration(splitStudio.duration) }}</b><small>合拍后总时长</small></span>
                  <span><b>{{ splitStudio.sourceFiles.length }} 个部分</b><small>按下方顺序合拍</small></span>
                </div>
                <div v-else class="video-split-empty-source"><AppIcon name="info" /><span>先选择一个视频文件</span></div>
                <div v-if="splitStudio.sourceFiles.length" class="video-split-source-files">
                  <div class="video-split-source-files-head"><span>合拍顺序</span><div><small>先合拍，再切集</small><el-button text type="danger" :disabled="splitStudio.splitting" @click="clearSplitFiles">清空</el-button></div></div>
                  <div v-for="(file, index) in splitStudio.sourceFiles" :key="file.id" class="video-split-source-file">
                    <span class="video-split-file-order">{{ index + 1 }}</span><div><b :title="file.name">{{ file.name }}</b><small>{{ formatSplitDuration(file.duration) }}</small></div>
                    <el-button text circle title="上移" aria-label="上移" :disabled="splitStudio.splitting || index === 0" @click="moveSplitFile(index, -1)"><AppIcon name="arrow-up" /></el-button>
                    <el-button text circle title="下移" aria-label="下移" :disabled="splitStudio.splitting || index === splitStudio.sourceFiles.length - 1" @click="moveSplitFile(index, 1)"><AppIcon name="arrow-down" /></el-button>
                    <el-button text circle type="danger" title="移除视频部分" aria-label="移除视频部分" :disabled="splitStudio.splitting" @click="removeSplitFile(index)"><AppIcon name="x" /></el-button>
                  </div>
                </div>

                <div v-if="splitStudio.segments.length" class="video-split-result-summary">
                  <div class="video-split-section-title"><span>本次结果</span><small>{{ splitStudio.segments.length }} 集<span v-if="splitStudio.naturalAdjustments"> · 自然调整 {{ splitStudio.naturalAdjustments }} 处</span></small></div>
                  <div class="video-split-result-path" :title="splitStudio.outputDirectory"><AppIcon name="folder-open" /><span>{{ splitStudio.outputDirectory }}</span></div>
                  <div class="video-split-segment-list">
                    <div v-for="item in splitStudio.segments" :key="item.index" class="video-split-segment-row">
                      <span class="video-split-episode-no">{{ item.index }}</span>
                      <div><b>{{ item.name }}</b><small>{{ formatSplitDuration(item.duration) }} · {{ formatSplitTime(item.start) }} - {{ formatSplitTime(item.end) }}</small></div>
                      <AppIcon name="circle-check" />
                    </div>
                  </div>
                </div>
              </section>

              <section class="video-split-controls-panel">
                <div class="video-split-rule-head"><div class="video-split-section-title"><span>切割规则</span><small>未覆盖的集数默认 40 秒</small></div><el-button text type="primary" :disabled="splitStudio.splitting" @click="addSplitRule"><AppIcon name="plus" /><span>增加范围</span></el-button></div>
                <div class="video-split-rule-list">
                    <div v-for="(rule, index) in splitStudio.rules" :key="rule.id" class="video-split-rule-row">
                    <div class="video-split-rule-range"><span>第</span><el-input-number v-model="rule.startEpisode" :min="1" :max="999999" :precision="0" :disabled="splitStudio.splitting" controls-position="right" @change="normalizeSplitRules" /><span>集</span><span class="video-split-range-separator">至</span><el-input-number v-model="rule.endEpisode" :min="0" :max="999999" :precision="0" :disabled="splitStudio.splitting" controls-position="right" @change="normalizeSplitRules" /><span>{{ rule.endEpisode ? '集' : '集及以后' }}</span></div>
                    <div class="video-split-rule-duration"><el-input-number v-model="rule.duration" :min="1" :max="86400" :precision="rule.unit === 'minute' ? 2 : 0" :step="rule.unit === 'minute' ? 1 : 5" :disabled="splitStudio.splitting" controls-position="right" /><el-select v-model="rule.unit" :disabled="splitStudio.splitting" aria-label="时长单位"><el-option label="分钟" value="minute" /><el-option label="秒" value="second" /></el-select></div>
                    <el-button text circle type="danger" title="删除此范围" aria-label="删除此范围" :disabled="splitStudio.splitting || splitStudio.rules.length <= 1" @click="removeSplitRule(index)"><AppIcon name="trash-2" /></el-button>
                  </div>
                </div>
                <div class="video-split-minimum-field"><label><span>最低时长</span><div class="video-split-number"><el-input-number v-model="splitStudio.minimumSeconds" :min="1" :max="86400" :precision="0" :step="5" :disabled="splitStudio.splitting" controls-position="right" /><em>秒</em></div></label></div>
                <div class="video-split-rule-note"><AppIcon name="info" /><span>结尾不足最低时长时，会并入上一集；不会跳过任何内容。</span></div>
                <div class="video-split-natural-row">
                  <div class="video-split-natural-copy"><b>自然切割</b><small>目标时间仍在说话时，自动寻找后方停顿再切</small></div>
                  <div class="video-split-natural-options"><el-switch v-model="splitStudio.naturalCut" :disabled="splitStudio.splitting" @change="saveSplitSettings" /><span>最多顺延</span><el-input-number v-model="splitStudio.naturalWindowSeconds" :min="0" :max="120" :precision="0" :step="1" :disabled="splitStudio.splitting || !splitStudio.naturalCut" controls-position="right" @change="saveSplitSettings" /><em>秒</em></div>
                </div>

                <div class="video-split-section-title video-split-output-title"><span>输出设置</span><small>文件会直接写入本地文件夹</small></div>
                <label class="video-split-prefix-field"><span>文件名前缀</span><el-input v-model="splitStudio.prefix" maxlength="80" clearable :disabled="splitStudio.splitting" placeholder="例如：噩梦苏醒" /></label>
                <div class="video-split-naming-preview"><span>命名预览</span><b>{{ splitStudio.prefix || '视频' }}-第X集.mp4</b></div>
                <div class="video-split-output-picker">
                  <div><span>输出文件夹</span><small>{{ splitStudio.outputDirectory || '尚未选择' }}</small></div>
                  <el-button plain :disabled="splitStudio.splitting" @click="chooseSplitOutput"><AppIcon name="folder-open" /><span>选择文件夹</span></el-button>
                </div>

                <footer class="video-split-action-bar">
                  <div><span><i></i>{{ splitStudio.splitting ? '正在合拍并切割，请稍候…' : '合拍与切割将在本机完成' }}</span><small>{{ splitStudio.sourceFiles.length ? '原视频不会被修改' : '请选择视频后开始' }}</small></div>
                  <el-button type="primary" size="large" :loading="splitStudio.splitting" :disabled="!splitStudio.sourceFiles.length || !splitStudio.outputDirectory || splitStudio.probing" @click="startVideoSplit"><AppIcon name="scissors" /><span>开始切割</span></el-button>
                </footer>
              </section>
            </main>
          </section>
        </template>`;
