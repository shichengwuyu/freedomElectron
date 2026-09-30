export const dialogsAndOverlays = /* html */ `  <el-dialog
    v-model="shotTimeline.videoPreview.visible"
    :title="shotTimeline.videoPreview.title || '镜头视频预览'"
    width="min(1120px, 94vw)"
    class="shot-timeline-video-dialog"
    destroy-on-close
    append-to-body
    @closed="closeShotTimelineVideo"
  >
    <div class="shot-timeline-video-player">
      <video
        v-if="shotTimeline.videoPreview.url"
        :src="shotTimeline.videoPreview.url"
        controls
        autoplay
        playsinline
        preload="metadata"
      ></video>
    </div>
    <template #footer>
      <div class="shot-timeline-video-footer">
        <span>镜头 {{ shotTimeline.videoPreview.shotNo }} · 可使用播放器控制条调节进度和音量</span>
        <div>
          <el-button @click="closeShotTimelineVideo">关闭</el-button>
          <el-button type="primary" @click="fullscreenShotTimelineVideo"><AppIcon name="maximize" /><span>全屏播放</span></el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="aiBindRangeDialog.visible" title="范围AI绑定元素" width="min(420px, 92vw)" destroy-on-close>
    <div style="font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:12px">
      AI会重新判断指定镜号范围内的人物、场景、道具、特效绑定；当前关键词误匹配但AI不认可的元素会被排除，用户手动补的绑定会保留。
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="min-width:48px">从第</span>
      <el-input-number v-model="aiBindRangeDialog.fromNo" :min="1" controls-position="right" style="width:120px" />
      <span>镜 到第</span>
      <el-input-number v-model="aiBindRangeDialog.toNo" :min="1" controls-position="right" style="width:120px" />
      <span>镜</span>
    </div>
    <template #footer>
      <el-button @click="aiBindRangeDialog.visible = false">取消</el-button>
      <el-button type="primary" :loading="aiBinding.running && aiBinding.scope === 'range'" @click="confirmAiBindRange"><AppIcon name="wand-sparkles" /><span>开始绑定</span></el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="batchCharacterLookDialog.visible"
    title="批量人物造型"
    width="680px"
    class="batch-character-look-dialog"
    destroy-on-close
    append-to-body
  >
    <div class="batch-character-look-body">
      <div class="batch-character-look-scope">
        <AppIcon name="info" />
        <span>仅应用于当前集</span>
        <strong>{{ selectedSbEpisode?.title || ('第 ' + sbEpisodeId + ' 集') }}</strong>
      </div>
      <div class="batch-character-look-form">
        <label class="batch-character-look-field has-preview">
          <span>人物</span>
          <span class="batch-character-look-selected-thumb">
            <img
              v-if="activeBatchCharacterLookGroup && batchCharacterLookOwnerImageUrl(activeBatchCharacterLookGroup)"
              :src="batchCharacterLookOwnerImageUrl(activeBatchCharacterLookGroup)"
              alt=""
            />
            <AppIcon name="user-round" />
          </span>
          <el-select
            v-model="batchCharacterLookDialog.ownerName"
            aria-label="选择人物"
            placeholder="选择人物"
            popper-class="batch-character-owner-select-popper"
            @change="changeBatchCharacterLookOwner"
          >
            <el-option
              v-for="group in batchCharacterLookGroups"
              :key="group.name"
              :label="group.displayName"
              :value="group.name"
            >
              <div class="batch-character-look-option">
                <span class="batch-character-look-option-thumb">
                  <img v-if="batchCharacterLookOwnerImageUrl(group)" :src="batchCharacterLookOwnerImageUrl(group)" alt="" loading="lazy" decoding="async" />
                  <AppIcon name="user-round" />
                </span>
                <span class="batch-character-look-option-copy">
                  <b>{{ group.displayName }}</b>
                  <small>{{ group.looks.length }} 个造型</small>
                </span>
              </div>
            </el-option>
          </el-select>
        </label>
        <label class="batch-character-look-field has-preview">
          <span>造型</span>
          <span class="batch-character-look-selected-thumb">
            <img v-if="activeBatchCharacterLook?.hasImage" :src="characterLookImageUrl(activeBatchCharacterLook)" alt="" />
            <AppIcon name="refresh-cw" />
            <AppIcon name="image" />
          </span>
          <el-select v-model="batchCharacterLookDialog.lookName" aria-label="选择造型" placeholder="选择造型" popper-class="batch-character-look-select-popper">
            <el-option label="恢复自动匹配" value="__auto__">
              <div class="batch-character-look-option visual">
                <span class="batch-character-look-option-thumb automatic"><AppIcon name="refresh-cw" /></span>
                <span class="batch-character-look-option-copy">
                  <b>恢复自动匹配</b>
                  <small>移除这段范围的手动造型</small>
                </span>
              </div>
            </el-option>
            <el-option
              v-for="look in activeBatchCharacterLookGroup?.looks || []"
              :key="look.name"
              :label="look.assetKind === 'main' ? '主形态' : (look.lookLabel || look.matchName || look.displayName)"
              :value="look.name"
              :disabled="!look.hasImage"
            >
              <div class="batch-character-look-option visual">
                <span class="batch-character-look-option-thumb">
                  <img v-if="look.hasImage" :src="characterLookImageUrl(look)" alt="" loading="lazy" decoding="async" />
                  <AppIcon name="image" />
                </span>
                <span class="batch-character-look-option-copy">
                  <b>{{ look.assetKind === 'main' ? '主形态' : (look.lookLabel || look.matchName || look.displayName) }}</b>
                  <small>{{ look.hasImage ? (look.assetLabel || '人物') : '未出图' }}</small>
                </span>
              </div>
            </el-option>
          </el-select>
        </label>
        <div class="batch-character-look-field">
          <span>镜号范围</span>
          <div class="batch-character-look-range">
            <el-input-number v-model="batchCharacterLookDialog.fromNo" :min="1" controls-position="right" aria-label="起始镜号" />
            <span>至</span>
            <el-input-number v-model="batchCharacterLookDialog.toNo" :min="1" controls-position="right" aria-label="结束镜号" />
          </div>
        </div>
      </div>
      <div class="batch-character-look-summary">
        <AppIcon name="crosshair" />
        <span>将影响当前集 <strong>{{ batchCharacterLookAffectedCount }}</strong> 个镜头；范围外及其他集保持不变。</span>
      </div>
    </div>
    <template #footer>
      <el-button @click="batchCharacterLookDialog.visible = false">取消</el-button>
      <el-button type="primary" :disabled="!batchCharacterLookAffectedCount" @click="confirmBatchCharacterLook">
        <AppIcon name="check" /><span>应用到 {{ batchCharacterLookAffectedCount }} 镜</span>
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="rangeSeqDialog.visible" title="范围首尾帧连续生成" width="min(440px, 92vw)" destroy-on-close>
    <div style="font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:12px">
      按镜号依次出片，每镜完成后自动取尾帧作为下一镜的开场帧。区间前一镜若已出片，首镜也会自动衔接；范围内已有视频的镜头会跳过。
    </div>
    <div v-if="sequentialRunning" style="font-size:12px;color:var(--gold);line-height:1.6;margin:-4px 0 12px">
      当前首尾帧任务会继续运行，新范围将加入等待队列，前一段完成后自动开始。
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="min-width:48px">从第</span>
      <el-input-number v-model="rangeSeqDialog.fromNo" :min="1" controls-position="right" style="width:120px" />
      <span>镜 到第</span>
      <el-input-number v-model="rangeSeqDialog.toNo" :min="1" controls-position="right" style="width:120px" />
      <span>镜</span>
    </div>
    <template #footer>
      <el-button @click="rangeSeqDialog.visible = false">取消</el-button>
      <el-button type="primary" @click="confirmRangeSequential"><AppIcon name="film" /><span>{{ sequentialRunning ? '加入队列' : '开始生成' }}</span></el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="videoRangeDialog.visible" title="自定义范围生成视频" width="min(440px, 92vw)" destroy-on-close>
    <div style="font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:12px">
      只提交指定镜号范围内的视频任务；已经生成或正在生成的镜头会自动跳过，不会重复扣费。
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="min-width:48px">从第</span>
      <el-input-number v-model="videoRangeDialog.fromNo" :min="1" :step="1" step-strictly controls-position="right" style="width:120px" aria-label="起始镜号" />
      <span>镜 到第</span>
      <el-input-number v-model="videoRangeDialog.toNo" :min="1" :step="1" step-strictly controls-position="right" style="width:120px" aria-label="结束镜号" />
      <span>镜</span>
    </div>
    <template #footer>
      <el-button @click="videoRangeDialog.visible = false">取消</el-button>
      <el-button type="primary" :disabled="batchVideoRunning || sequentialRunning" @click="confirmVideoRange"><AppIcon name="film" /><span>开始生成</span></el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="batchAll.visible" title="一键全集串行生成" width="min(560px, 94vw)" :close-on-click-modal="false" destroy-on-close>
    <template v-if="!batchAll.finished">
      <div style="font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:12px">
        分两个阶段自动执行：<b>阶段1</b> 按章节顺序<b>并行</b>补全缺失分镜（不影响其他操作）；<b>阶段2</b> 若勾选"同时生成视频"，逐集按镜号<b>首尾帧串联</b>出片（上一镜尾帧作下一镜开场帧，已有视频的镜头自动跳过），直到最后一集。已有分镜的集只跑视频；失败的分集/镜头<b>最多自动重试一次</b>。
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:13px">起始集</span>
          <el-select v-model="batchAll.startEpisodeId" filterable style="width:260px">
            <el-option
              v-for="ep in sbSortedEpisodes.filter(ep => (ep.content || '').trim())"
              :key="ep.id"
              :label="'第' + ep.id + '集' + (ep.title ? ' ' + ep.title : '')"
              :value="String(ep.id)"
            />
          </el-select>
          <span style="font-size:12px;color:var(--muted)">从这一集（含）开始往后跑</span>
        </div>
        <el-checkbox v-model="batchAll.withVideo">
          同时生成视频
        </el-checkbox>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:13px">分镜并行数</span>
          <el-input-number v-model="batchAll.concurrency" :min="1" :max="5" :step="1" step-strictly controls-position="right" style="width:110px" />
          <span style="font-size:12px;color:var(--muted)">同时生成几集分镜（1-5，默认 2 最稳）；过高可能触发文本模型限流</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <el-tag type="info" effect="plain" size="small">视频串行模式（首尾帧衔接）</el-tag>
          <span style="font-size:12px;color:var(--muted)">逐镜头按首尾帧串联生成，已有视频的镜头自动跳过；并行模式已停用</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <el-checkbox v-model="batchAll.useBudget" :disabled="!batchAll.withVideo">
            产出时长预算
          </el-checkbox>
          <el-input-number v-model="batchAll.budgetMinutes" :min="5" :max="100000" :step="10" step-strictly controls-position="right" style="width:130px" :disabled="!batchAll.useBudget || !batchAll.withVideo" />
          <span style="font-size:13px">分钟</span>
        </div>
        <div v-if="batchAll.useBudget && batchAll.withVideo" style="font-size:12px;color:var(--muted)">
          按当前单镜 {{ shotSeconds }} 秒计算：{{ batchAll.budgetMinutes }} 分钟 ≈ <b>{{ shotBudget }}</b> 个新镜头。新生成镜头数达到上限后自动停止（已出片的镜头跳过、不占预算）。
        </div>
        <div style="font-size:12px;color:var(--muted)">
          当前共 <b>{{ sbSortedEpisodes.filter(ep => (ep.content || '').trim()).length }}</b> 集有剧本，其中 <b>{{ pendingStoryboardCount }}</b> 集还没有分镜。运行期间可以继续使用其他功能，进度显示在分镜页顶部状态条。
        </div>
      </div>
      <el-alert v-if="batchAll.failures.length" type="warning" :closable="false" show-icon title="上一次执行存在失败项">
        <div style="max-height:160px;overflow:auto;font-size:12px;line-height:1.7;margin-top:6px">
          <div v-for="(fail, i) in batchAll.failures" :key="i">· 第{{ fail.episodeId }}集「{{ fail.title }}」{{ fail.phase }}失败：{{ fail.error }}</div>
        </div>
      </el-alert>
    </template>
    <template v-else>
      <el-result
        :icon="batchAll.failures.length ? 'warning' : 'success'"
        :title="batchAll.failures.length ? ('完成，' + batchAll.failures.length + ' 项失败') : '全部完成'"
        :sub-title="'共处理 ' + batchAll.total + ' 集有剧本的内容'"
      >
        <template #extra>
          <div v-if="batchAll.failures.length" style="max-height:220px;overflow:auto;font-size:12px;line-height:1.8;text-align:left;min-width:380px">
            <div v-for="(fail, i) in batchAll.failures" :key="i">· 第{{ fail.episodeId }}集「{{ fail.title }}」{{ fail.phase }}失败：{{ fail.error }}</div>
          </div>
        </template>
      </el-result>
    </template>
    <template #footer>
      <template v-if="!batchAll.finished">
        <el-button @click="batchAll.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmBatchAll"><AppIcon name="play" /><span>开始全集串行</span></el-button>
      </template>
      <el-button v-else type="primary" @click="batchAll.visible = false; batchAll.finished = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="sceneGap.visible" title="场景补漏" width="min(640px, 94vw)" :close-on-click-modal="false" destroy-on-close>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <el-radio-group v-model="sceneGap.scope" size="small" @change="onSceneGapScopeChange">
        <el-radio-button value="all">全部集</el-radio-button>
        <el-radio-button value="current">当前集</el-radio-button>
      </el-radio-group>
      <span style="font-size:12px;color:var(--muted)">共 {{ sceneGap.items.length }} 个场景标记，缺失 <b style="color:var(--el-color-warning)">{{ missingCount }}</b> 个</span>
      <el-button size="small" text type="primary" :disabled="!missingCount" @click="toggleSceneGapSelectAll(true)">全选缺失</el-button>
      <el-button size="small" text :disabled="!missingCount" @click="toggleSceneGapSelectAll(false)">取消全选</el-button>
    </div>
    <div style="max-height:320px;overflow:auto;border:1px solid var(--el-border-color-lighter);border-radius:8px">
      <div v-for="item in sceneGap.items" :key="item.name" style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid var(--el-border-color-extra-light);font-size:13px">
        <el-checkbox v-if="item.missing" v-model="item.selected" />
        <span v-else style="width:18px"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="item.name">{{ item.name }}</span>
        <span style="font-size:12px;color:var(--muted)">{{ item.count }} 次</span>
        <el-tag v-if="item.missing" size="small" type="warning" effect="plain">缺失</el-tag>
        <el-tag v-else size="small" type="success" effect="plain">{{ item.matchedName }}</el-tag>
      </div>
      <div v-if="!sceneGap.items.length" style="padding:24px;text-align:center;font-size:12px;color:var(--muted)">没有找到场景标记</div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:10px">
      补建的场景会以分镜原文命名加入元素库（场景分类），之后到「元素库 → 场景」里出图即可；与库名互相包含的视为已覆盖。
    </div>
    <template #footer>
      <el-button @click="sceneGap.visible = false">关闭</el-button>
      <el-button type="primary" :loading="sceneGap.creating" :disabled="!selectedMissingCount" @click="createMissingScenes">
        <AppIcon name="plus" /><span>补建所选（{{ selectedMissingCount }}）</span>
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="tailFramePicker.visible" title="手选上一镜尾帧" width="min(860px, 94vw)" destroy-on-close>
    <div class="tail-frame-picker">
      <video
        ref="tailFramePickerVideo"
        class="tail-frame-video"
        :src="tailFramePicker.videoUrl"
        controls
        preload="auto"
        @loadedmetadata="onTailFramePickerLoaded"
        @timeupdate="onTailFramePickerTimeUpdate"
        @seeked="onTailFramePickerTimeUpdate"
      ></video>
      <div class="tail-frame-name-row">
        <span>帧名称</span>
        <el-input v-model="tailFramePicker.frameName" maxlength="40" show-word-limit placeholder="例如：人物站位 / 初始画面 / 开场参考图" />
      </div>
      <div class="tail-frame-controls">
        <span>镜头 {{ tailFramePicker.fromShotNo }} → 镜头 {{ tailFramePicker.targetShotNo }}</span>
        <el-slider
          v-model="tailFramePicker.currentTime"
          :min="0"
          :max="Math.max(tailFramePicker.duration || 0, 0.1)"
          :step="0.04"
          :show-tooltip="false"
          @input="seekTailFramePicker"
        />
        <span>{{ formatTailFrameTime(tailFramePicker.currentTime) }} / {{ formatTailFrameTime(tailFramePicker.duration) }}</span>
      </div>
      <p class="tail-frame-hint">拖动视频进度或滑块到想要的画面，确认后会把当前画面保存为本镜开场参考图。</p>
    </div>
    <template #footer>
      <el-button @click="tailFramePicker.visible = false">取消</el-button>
      <el-button type="primary" :loading="tailFramePicker.saving" @click="saveTailFramePicker"><AppIcon name="check" /><span>设为开场帧</span></el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="promptDialog.visible" :title="promptDialog.title" class="prompt-dialog" width="min(900px, 92vw)" destroy-on-close>
    <div class="prompt-dialog-body">
      <div class="el-prompt-label">完整提示词</div>
      <el-input v-model="promptDialog.draftPrompt" type="textarea" :rows="20" resize="vertical" />
    </div>
    <template #footer>
      <div class="prompt-dialog-footer">
        <el-button @click="closePromptDialog">取消</el-button>
        <el-button type="primary" :loading="promptDialog.saving" @click="savePromptDialog">保存提示词</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="videoQueueDialog" title="待提交镜头" width="min(700px, 92vw)" destroy-on-close>
    <div class="queue-dialog-body">
      <div v-if="videoQueue.items.length === 0" class="empty-state" style="padding:40px 20px">
        <AppIcon name="list" />
        <span>没有待提交镜头</span>
      </div>
      <div v-else class="queue-list">
        <div v-for="(shot, index) in videoQueue.items" :key="shotVideoKey(shot.no)" class="queue-item">
          <div class="queue-item-info">
            <div class="queue-item-no">
              <AppIcon name="video" />
              <span>镜头 {{ shot.no }}</span>
            </div>
            <div class="queue-item-title">{{ shot.title || '无标题' }}</div>
            <div class="queue-item-status">
              <el-tag v-if="shotVideoStatus(shot.no) === 'generating'" type="success" size="small">提交中</el-tag>
              <el-tag v-else-if="shotVideoStatus(shot.no) === 'failed'" type="danger" size="small">失败</el-tag>
              <el-tag v-else type="info" size="small">待提交 ({{ index + 1 }})</el-tag>
            </div>
          </div>
          <div class="queue-item-actions">
            <el-button size="small" text type="danger" @click="removeFromQueue(index)">
              <AppIcon name="trash-2" /><span>移除</span>
            </el-button>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--muted);font-size:13px">共 {{ videoQueue.items.length }} 个待提交</span>
        <div>
          <el-button @click="videoQueueDialog = false">关闭</el-button>
          <el-button type="danger" @click="clearVideoQueue(); videoQueueDialog = false">清空待提交</el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <teleport to="body">
    <div v-if="lightboxSrc" class="lightbox" role="dialog" aria-modal="true" aria-label="图片预览" @click.self="lightboxSrc=''" @keydown.esc.stop.prevent="lightboxSrc=''">
      <button type="button" class="lightbox-close" title="关闭预览" aria-label="关闭图片预览" autofocus @click.stop="lightboxSrc=''">
        <AppIcon name="x" />
      </button>
      <img :src="lightboxSrc" alt="图片预览" @click.stop />
    </div>
  </teleport>

  <!-- 全局快速跳转（Ctrl/Cmd + K） -->
  <div v-if="palette.open" class="cmdk-overlay" @click.self="closePalette">
    <section class="cmdk-panel" role="dialog" aria-label="快速跳转">
      <div class="cmdk-head">
        <AppIcon name="search" />
        <input
          class="cmdk-input"
          v-model="palette.query"
          placeholder="跳到项目 / 剧集 / 分镜，或执行动作…"
          @keydown="onPaletteKeydown"
        />
        <kbd class="cmdk-kbd">ESC</kbd>
      </div>
      <div class="cmdk-list">
        <div v-if="!filteredCommands.length" class="cmdk-empty">没有匹配的结果</div>
        <button
          v-for="(cmd, i) in filteredCommands"
          :key="cmd.key"
          :class="['cmdk-item', { on: i === palette.index }]"
          @mouseenter="palette.index = i"
          @click="runCommand(cmd)"
        >
          <span class="cmdk-item-icon"><el-icon><component :is="cmd.icon" /></el-icon></span>
          <span class="cmdk-item-label">{{ cmd.label }}</span>
          <span class="cmdk-item-hint">{{ cmd.hint }}</span>
        </button>
      </div>
      <div class="cmdk-foot">
        <span><kbd>↑↓</kbd> 选择</span>
        <span><kbd>Enter</kbd> 跳转</span>
        <span><kbd>Ctrl K</kbd> 随时唤起</span>
      </div>
    </section>
  </div>
`;
