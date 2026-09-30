export const referenceStudioDialog = /* html */ `
  <el-dialog v-model="referenceStudio.visible" width="min(1000px, 95vw)" class="reference-studio-dialog" destroy-on-close align-center>
    <template #header>
      <div class="reference-studio-title">
        <div class="reference-studio-icon"><AppIcon name="wand-sparkles" /></div>
        <div>
          <div class="eyebrow">Reference → Prompt → Continuity</div>
          <h2>参考反推 / 衔接合成</h2>
          <p>{{ project?.name || '' }} · 参考视频抽帧反推提示词，再自动补上承接定帧与转场</p>
        </div>
      </div>
    </template>

    <div class="reference-studio-body">
      <section class="rs-block">
        <header class="rs-block-head">
          <span class="rs-step">1</span>
          <div class="rs-block-copy">
            <strong>参考反推</strong>
            <small>反推出文字型提示词。适合抄"静态风格"（构图、光影、色调、服装）——动作与节奏请看下方说明</small>
          </div>
        </header>

        <p class="rs-note">
          <b>跳舞 / 打斗这类靠动作与节奏的参考，不要用反推</b>：静态帧里没有时间信息，反推出来的动作是模型猜的。
          这种直接用镜头卡上的「<b>参考视频</b>」把整段视频挂给生成模型（Seedance / 万相 / 可灵等），让模型自己看。
          反推真正的用处是：想照抄某个构图/色调/服装，或想把参考写成能进分镜的文字。
        </p>

        <div class="rs-form">
          <span class="rs-field">
            <span>分析模式</span>
            <el-radio-group v-model="referenceStudio.mode" size="small">
              <el-radio-button value="shot">分镜提示词</el-radio-button>
              <el-radio-button value="breakdown">15秒拉片笔记</el-radio-button>
            </el-radio-group>
          </span>
          <span class="rs-field">
            <span>输入方式</span>
            <el-radio-group v-model="referenceStudio.inputMode" size="small">
              <el-radio-button value="auto">自动</el-radio-button>
              <el-radio-button value="video">视频直读</el-radio-button>
              <el-radio-button value="frames">抽帧</el-radio-button>
            </el-radio-group>
          </span>
        </div>

        <div class="rs-form">
          <span class="rs-field-inline" title="视频抽帧数：帧越多动作判断越准，读图成本也越高">
            <span>帧数</span>
            <el-input-number v-model="referenceStudio.frameCount" size="small" :min="1" :max="24" :step="1" controls-position="right" />
          </span>
          <el-button size="small" :loading="referenceStudio.reverseBusy" @click="$event.currentTarget.querySelector('input').click()">
            <AppIcon name="video" /><span>选择参考文件</span>
            <input type="file" accept="video/*,image/*" hidden @change="onPickReferenceFile($event, { count: referenceStudio.frameCount })" />
          </el-button>
        </div>

        <el-input
          v-model="referenceStudio.hint"
          size="small"
          resize="none"
          placeholder="补充说明（可选）：例如「只借动作与色调，场景改成大学校园/宿舍」"
        />

        <div v-if="referenceStudio.inputUsed" class="rs-media">
          <span class="rs-chip">{{ referenceStudio.inputUsed === 'video' ? '本次：视频直读' : (referenceStudio.inputUsed === 'image' ? '本次：图片' : '本次：抽帧') }}</span>
          <span v-if="referenceStudio.videoFallbackReason" class="rs-chip is-warn" :title="referenceStudio.videoFallbackReason">视频直读失败，已自动退回抽帧</span>
        </div>
        <div v-if="referenceStudio.reverseError" class="rs-error">{{ referenceStudio.reverseError }}</div>
        <div v-if="referenceStudio.reverseMedia" class="rs-media">
          <span v-if="referenceStudio.reverseMedia.duration">{{ referenceStudio.reverseMedia.duration }}s</span>
          <span v-else>图片</span>
          <span v-if="referenceStudio.reverseMedia.width">{{ referenceStudio.reverseMedia.width }}×{{ referenceStudio.reverseMedia.height }}</span>
          <span v-if="referenceStudio.reverseMedia.fps">{{ referenceStudio.reverseMedia.fps }}fps</span>
          <span>抽了 {{ referenceStudio.reverseFrames }} 帧</span>
        </div>
        <el-input
          v-model="referenceStudio.reverseText"
          type="textarea"
          :rows="9"
          resize="vertical"
          placeholder="选择参考文件后，这里会给出【参考拆解】与【分镜提示词】两段；可直接编辑。"
        />
        <div class="rs-row-end">
          <el-button size="small" type="primary" plain :disabled="!referenceStudio.reverseText" @click="useReverseForCompose">
            <AppIcon name="pen-line" /><span>拿去合成衔接镜头</span>
          </el-button>
        </div>
      </section>

      <section class="rs-block">
        <header class="rs-block-head">
          <span class="rs-step">2</span>
          <div class="rs-block-copy">
            <strong>衔接合成</strong>
            <small>把提示词变成带承接定帧与转场、可直接插入的镜头</small>
          </div>
        </header>

        <div class="rs-form">
          <span class="rs-field">
            <span>目标集</span>
            <b>第 {{ referenceStudioEpisodeId }} 集</b>
          </span>
          <span class="rs-field">
            <span>基准镜头</span>
            <el-select v-model="referenceStudio.anchorShotNo" size="small" filterable style="width: 150px">
              <el-option v-for="s in referenceStudioShots" :key="'rs-shot:' + s.no" :label="'镜头 ' + s.no + (s.title ? ' · ' + s.title : '')" :value="s.no" />
            </el-select>
          </span>
          <span class="rs-field">
            <span>插入位置</span>
            <el-radio-group v-model="referenceStudio.position" size="small">
              <el-radio-button value="before">之前</el-radio-button>
              <el-radio-button value="after">之后</el-radio-button>
            </el-radio-group>
          </span>
        </div>

        <el-input
          v-model="referenceStudio.description"
          type="textarea"
          :rows="7"
          resize="vertical"
          placeholder="写清这个镜头要什么。也可以点上面的「拿去合成衔接镜头」，直接带入反推结果。"
        />
        <div v-if="referenceStudio.composeError" class="rs-error">{{ referenceStudio.composeError }}</div>
        <div class="rs-row-end">
          <el-button size="small" type="primary" :loading="referenceStudio.composeBusy" :disabled="!referenceStudio.description" @click="composeShot">
            <AppIcon name="wand-sparkles" /><span>生成衔接镜头</span>
          </el-button>
        </div>

        <template v-if="referenceStudio.result">
          <div class="rs-result-head">
            <span>预览（可编辑）</span>
            <span v-if="referenceStudio.insertAtNo" class="rs-chip">将插为镜头 {{ referenceStudio.insertAtNo }}</span>
            <span v-if="referenceStudio.result.transition?.type" class="rs-chip">{{ referenceStudio.result.transition.type }}</span>
            <span v-if="referenceStudio.result.nextShotPatch?.needPatch" class="rs-chip is-warn">会改写后一镜的承接定帧</span>
          </div>
          <el-input v-model="referenceStudio.resultEdited" type="textarea" :rows="12" resize="vertical" />
          <p v-if="referenceStudio.result.transition?.note" class="rs-note">{{ referenceStudio.result.transition.note }}</p>
          <p v-if="referenceStudio.result.nextShotPatch?.needPatch" class="rs-note">
            后一镜承接改写原因：{{ referenceStudio.result.nextShotPatch.reason || '前序镜头发生变化' }}
          </p>
          <div class="rs-row-end">
            <el-button size="small" type="warning" :loading="referenceStudio.inserting" @click="insertComposedShot">
              <AppIcon name="upload" /><span>插入分镜</span>
            </el-button>
          </div>
        </template>
      </section>
    </div>
  </el-dialog>
`;
