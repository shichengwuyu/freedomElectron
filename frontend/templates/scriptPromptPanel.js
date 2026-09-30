// 剧本 / 分镜 提示词选择面板的共享内容体。
// 剧本台与分镜台各用一个 stage 专属的 v-if 外层包裹它，避免整段 HTML 重复两遍。
export const scriptPromptPanelBody = /* html */ `<div class="section-title"><AppIcon name="pen-line" /><span>选择提示词</span></div>
                  <div class="custom-prompt-grid">
                    <section :class="['prompt-library-block', { 'is-custom-active': isCustomScriptPromptMode }]">
                      <div class="prompt-library-head">
                        <span>剧本提示词</span>
                        <el-tag size="small" :type="isCustomScriptPromptMode ? 'success' : 'info'">{{ scriptPromptStatusText }}</el-tag>
                      </div>
                      <div class="prompt-mode-cards">
                        <button type="button" :class="['prompt-mode-card', { active: !isCustomScriptPromptMode }]" @click="useBuiltinPrompt('script')">
                          <AppIcon name="wand-sparkles" />
                          <span>使用内置</span>
                          <small>启用冷开场、精准提纯等内置开关</small>
                        </button>
                        <button type="button" :class="['prompt-mode-card', { active: isCustomScriptPromptMode }]" :disabled="!cfg.promptLibrary.scriptPrompts.length" @click="activateCustomPrompt('script')">
                          <AppIcon name="file-text" />
                          <span>使用自定义</span>
                          <small>{{ selectedScriptCustomPrompt ? selectedScriptCustomPrompt.name : '先到提示词库新增或导入' }}</small>
                        </button>
                      </div>
                      <div class="prompt-library-tools">
                        <el-select v-model="scriptState.settings.selectedScriptPromptId" size="small" placeholder="选择剧本提示词" :disabled="!cfg.promptLibrary.scriptPrompts.length" @change="activateCustomPrompt('script', $event)">
                          <el-option v-for="item in cfg.promptLibrary.scriptPrompts" :key="item.id" :label="item.name" :value="item.id" />
                        </el-select>
                      </div>
                      <div v-if="selectedScriptCustomPrompt" :class="['prompt-library-preview', { muted: !isCustomScriptPromptMode }]">
                        <pre>{{ selectedScriptCustomPrompt.content }}</pre>
                      </div>
                      <p v-else class="muted">前往「设置 → 提示词库」添加，这里仅选择。</p>
                    </section>
                    <section :class="['prompt-library-block', { 'is-custom-active': isCustomStoryboardPromptMode }]">
                      <div class="prompt-library-head">
                        <span>分镜提示词</span>
                        <el-tag size="small" :type="isCustomStoryboardPromptMode ? 'success' : 'info'">{{ storyboardPromptStatusText }}</el-tag>
                      </div>
                      <div class="prompt-mode-cards">
                        <button type="button" :class="['prompt-mode-card', { active: !isCustomStoryboardPromptMode }]" @click="useBuiltinPrompt('storyboard')">
                          <AppIcon name="wand-sparkles" />
                          <span>使用内置</span>
                          <small>启用套装和 Q 版视觉等内置选项</small>
                        </button>
                        <button type="button" :class="['prompt-mode-card', { active: isCustomStoryboardPromptMode }]" :disabled="!cfg.promptLibrary.storyboardPrompts.length" @click="activateCustomPrompt('storyboard')">
                          <AppIcon name="file-text" />
                          <span>使用自定义</span>
                          <small>{{ selectedStoryboardCustomPrompt ? selectedStoryboardCustomPrompt.name : '先到提示词库新增或导入' }}</small>
                        </button>
                      </div>
                      <div class="prompt-library-tools">
                        <el-select v-model="scriptState.settings.selectedStoryboardPromptId" size="small" placeholder="选择分镜提示词" :disabled="!cfg.promptLibrary.storyboardPrompts.length" @change="activateCustomPrompt('storyboard', $event)">
                          <el-option v-for="item in cfg.promptLibrary.storyboardPrompts" :key="item.id" :label="item.name" :value="item.id" />
                        </el-select>
                      </div>
                      <div v-if="selectedStoryboardCustomPrompt" :class="['prompt-library-preview', { muted: !isCustomStoryboardPromptMode }]">
                        <pre>{{ selectedStoryboardCustomPrompt.content }}</pre>
                      </div>
                      <p v-else class="muted">前往「设置 → 提示词库」添加，这里仅选择。</p>
                    </section>
                  </div>`;
