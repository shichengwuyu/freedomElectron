import { costCenterSettings, modelRoutingSettings } from './modelRoutingSettings.js';

export const settingsView = /* html */ `        <template v-if="view === 'settings'">
          <section class="settings-layout">
            <aside class="settings-nav" aria-label="设置分区">
              <div class="settings-nav-head">
                <div class="eyebrow">Settings</div>
                <h2>系统配置</h2>
              </div>
              <div class="settings-nav-group">
                <span class="settings-nav-label">界面</span>
                <button :class="{active: settingsSection === 'appearance'}" @click="settingsSection = 'appearance'"><AppIcon name="brush" /><span>主题外观</span></button>
              </div>
              <div class="settings-nav-group">
                <span class="settings-nav-label">模型接入</span>
                <button :class="{active: settingsSection === 'text'}" @click="settingsSection = 'text'"><AppIcon name="message-circle" /><span>文本模型与路由</span></button>
                <button :class="{active: settingsSection === 'image'}" @click="settingsSection = 'image'"><AppIcon name="image" /><span>图片模型</span></button>
                <button :class="{active: settingsSection === 'imageHosting'}" @click="settingsSection = 'imageHosting'"><AppIcon name="upload" /><span>图床</span></button>
                <button :class="{active: settingsSection === 'video'}" @click="settingsSection = 'video'"><AppIcon name="video" /><span>视频模型</span></button>
                <button :class="{active: settingsSection === 'gateway'}" @click="settingsSection = 'gateway'"><AppIcon name="key-round" /><span>模型网关 &amp; 卡密</span></button>
                <button :class="{active: settingsSection === 'cost'}" @click="settingsSection = 'cost'"><AppIcon name="chart-column" /><span>成本中心</span></button>
              </div>
              <div class="settings-nav-group">
                <span class="settings-nav-label">创作偏好</span>
                <button :class="{active: settingsSection === 'generationSafety'}" @click="settingsSection = 'generationSafety'"><AppIcon name="circle-alert" /><span>生成防误发</span></button>
                <button :class="{active: settingsSection === 'prompt'}" @click="settingsSection = 'prompt'"><AppIcon name="wand-sparkles" /><span>提示词设置</span></button>
                <button :class="{active: settingsSection === 'promptLibrary'}" @click="settingsSection = 'promptLibrary'"><AppIcon name="pen-line" /><span>提示词库</span></button>
                <button :class="{active: settingsSection === 'extract'}" @click="settingsSection = 'extract'"><AppIcon name="settings" /><span>提取设置</span></button>
              </div>
              <div class="settings-nav-group">
                <span class="settings-nav-label">运行环境</span>
                <button :class="{active: settingsSection === 'system'}" @click="settingsSection = 'system'"><AppIcon name="monitor" /><span>系统与诊断</span></button>
              </div>
            </aside>
            <section class="settings-detail">
              <div class="panel settings-panel">
              <div class="panel-body">
              <template v-if="settingsSection === 'appearance'">
                <div class="settings-head"><div><div class="eyebrow">Appearance</div><h2>主题外观</h2></div></div>
                <div class="theme-gallery" role="radiogroup" aria-label="界面主题">
                  <button
                    v-for="item in themeOptions"
                    :key="item.value"
                    type="button"
                    :class="['theme-option', 'is-' + item.value, { 'is-active': themePreference === item.value }]"
                    :aria-pressed="themePreference === item.value"
                    @click="setThemePreference(item.value)"
                  >
                    <span class="theme-option-preview" aria-hidden="true">
                      <i class="theme-preview-rail"></i>
                      <i class="theme-preview-panel"></i>
                      <i class="theme-preview-accent"></i>
                    </span>
                    <span class="theme-option-copy">
                      <el-icon><Monitor v-if="item.icon === 'Monitor'" /><Moon v-else-if="item.icon === 'Moon'" /><Sunny v-else-if="item.icon === 'Sunny'" /><ColdDrink v-else-if="item.icon === 'ColdDrink'" /><Cherry v-else-if="item.icon === 'Cherry'" /><Ship v-else-if="item.icon === 'Ship'" /><Sugar v-else-if="item.icon === 'Sugar'" /><Brush v-else-if="item.icon === 'Brush'" /><UserFilled v-else-if="item.icon === 'Female' || item.icon === 'Male' || item.icon === 'User'" /><View v-else-if="item.icon === 'View'" /><MagicStick v-else /></el-icon>
                      <strong>{{ item.label }}</strong>
                    </span>
                    <AppIcon name="circle-check" />
                  </button>
                </div>
                <section class="appearance-scale-panel">
                  <div class="appearance-scale-copy">
                    <div><strong>界面缩放</strong><span>字体与控件</span></div>
                    <b>{{ uiScalePercent }}%</b>
                  </div>
                  <div class="appearance-scale-control">
                    <span>85%</span>
                    <el-slider v-model="uiScale" :min="0.85" :max="1.5" :step="0.05" :show-tooltip="false" />
                    <span>150%</span>
                    <el-button size="small" plain @click="setUiScale(1)">恢复 100%</el-button>
                  </div>
                </section>
              </template>
              <template v-if="settingsSection === 'generationSafety'">
                <div class="settings-head"><div><div class="eyebrow">Generation Safety</div><h2>生成防误发</h2></div></div>
                <section class="generation-safety-panel">
                  <div class="generation-safety-copy">
                    <div class="generation-safety-icon"><AppIcon name="circle-alert" /></div>
                    <div>
                      <strong>视频生成前等待确认</strong>
                      <p>点击“生成视频”后先倒计时，倒计时结束才会发送请求。发现分镜或参数有误时，可以取消后修改。</p>
                    </div>
                    <el-switch v-model="cfg.generationSafety.videoGuardEnabled" />
                  </div>
                  <div class="generation-safety-control">
                    <el-form-item label="等待秒数">
                      <el-input-number
                        v-model="cfg.generationSafety.videoGuardSeconds"
                        :min="1"
                        :max="120"
                        :step="1"
                        step-strictly
                        controls-position="right"
                        style="width: 180px"
                      />
                      <span class="field-hint">默认 10 秒，可设置 1–120 秒</span>
                    </el-form-item>
                  </div>
                </section>
              </template>
              <template v-if="settingsSection === 'text'">
                <div class="settings-head settings-merge-head">
                  <div><div class="eyebrow">Text &amp; Routing</div><h2>文本模型与路由</h2></div>
                  <div class="settings-head-actions">
                    <el-radio-group v-model="settingsTextTab" size="small">
                      <el-radio-button value="text">文本模型</el-radio-button>
                      <el-radio-button value="routing">模型路由</el-radio-button>
                    </el-radio-group>
                    <el-button v-if="settingsTextTab === 'routing'" type="primary" @click="addModelProfile"><AppIcon name="plus" /><span>新增 Profile</span></el-button>
                  </div>
                </div>
                <template v-if="settingsTextTab === 'text'">
                <el-form label-position="top">
                  <el-form-item label="Base URL">
                    <div class="api-base-url-control">
                      <el-select v-model="textBaseUrlChoice" style="width:100%" @change="onTextBaseUrlChoiceChange($event); syncPrimaryModelProfileFromText()">
                        <el-option v-for="item in textBaseUrlOptions" :key="item.value" :label="item.label + ' · ' + item.value" :value="item.value">
                          <div class="api-base-url-option"><span>{{ item.label }} · {{ item.value }}</span><button type="button" title="打开此服务官网" :aria-label="'打开 ' + item.label + ' 官网'" @mousedown.stop @click.stop="openApiBaseUrl(item.value, $event)"><AppIcon name="link" /></button></div>
                        </el-option>
                        <el-option label="自定义" value="custom" />
                      </el-select>
                      <el-button circle :disabled="!apiBaseUrlLink(cfg.text.baseUrl)" title="打开当前文本 API 对应网站" aria-label="打开当前文本 API 对应网站" @click="openApiBaseUrl(cfg.text.baseUrl, $event)"><AppIcon name="link" /></el-button>
                    </div>
                    <el-input v-if="textBaseUrlChoice === 'custom'" v-model="cfg.text.baseUrl" placeholder="Base URL" class="field-gap" @input="syncPrimaryModelProfileFromText" />
                  </el-form-item>
                  <el-form-item label="API Key"><el-input v-model="cfg.text.apiKey" type="password" show-password placeholder="sk-..." @input="syncPrimaryModelProfileFromText" /></el-form-item>
                  <el-form-item label="模型">
                    <el-select v-model="cfg.text.model" filterable allow-create default-first-option placeholder="选择或输入文本模型" style="width:100%" @change="syncPrimaryModelProfileFromText">
                      <el-option v-for="item in textModelChoices" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="创造性 temperature">
                    <el-input-number v-model="cfg.text.temperature" :min="0" :max="2" :step="0.1" :precision="1" style="width:200px" @change="syncPrimaryModelProfileFromText" />
                  </el-form-item>
                  <el-form-item label="最大输出 tokens">
                    <el-input-number v-model="cfg.text.maxTokens" :min="1" :max="1000000" :step="1000" :precision="0" style="width:200px" @change="syncPrimaryModelProfileFromText" />
                  </el-form-item>
                  <el-collapse class="text-endpoints-collapse">
                    <el-collapse-item name="text-endpoints" title="备用端点（多 Base URL / API Key）">
                      <el-form-item label="主端点失败时切换">
                        <el-switch v-model="cfg.text.rotationStrategy" active-value="failover" inactive-value="off" />
                        <span class="field-hint">关闭：只用主端点。开启：主端点失败时按列表顺序顺延备用端点。</span>
                      </el-form-item>
                      <div v-if="!cfg.text.endpoints.length" class="muted small text-endpoints-empty">还没有备用端点，点击下方按钮添加。</div>
                      <article v-for="(endpoint, index) in cfg.text.endpoints" :key="index" class="text-endpoint-card">
                        <header class="text-endpoint-head">
                          <strong>{{ endpoint.name || ('备用端点 ' + (index + 1)) }}</strong>
                          <el-button size="small" type="danger" plain @click="cfg.text.endpoints.splice(index, 1)">
                            <AppIcon name="trash-2" /><span>删除</span>
                          </el-button>
                        </header>
                        <el-form-item label="名称"><el-input v-model="endpoint.name" placeholder="例如：备用 OpenRouter" /></el-form-item>
                        <el-form-item label="Base URL"><el-input v-model="endpoint.baseUrl" placeholder="https://.../v1" /></el-form-item>
                        <el-form-item label="API Key"><el-input v-model="endpoint.apiKey" type="password" show-password placeholder="sk-..." /></el-form-item>
                        <el-form-item label="模型（留空用主模型）"><el-input v-model="endpoint.model" placeholder="可选" /></el-form-item>
                      </article>
                      <el-button size="small" @click="cfg.text.endpoints.push({ name: '', baseUrl: '', apiKey: '', model: '' })">
                        <AppIcon name="plus" /><span>添加备用端点</span>
                      </el-button>
                    </el-collapse-item>
                  </el-collapse>
                </el-form>
                <div class="inline-actions"><el-button :loading="testing.textModels" @click="fetchTextModelsAndSync"><AppIcon name="refresh-cw" /><span>拉取模型</span></el-button><el-button :loading="testing.text" @click="testConn('text')">测试连接</el-button><span v-if="testResult.text" :class="testResult.text.ok ? 'ok-text' : 'err-text'">{{ testResult.text.msg }}</span></div>
                </template>
              </template>

              ${modelRoutingSettings}
              ${costCenterSettings}

              <template v-if="settingsSection === 'image'">
                <div class="settings-head channel-settings-head">
                  <div><div class="eyebrow">Image</div><h2>生图模型渠道</h2></div>
                    <el-radio-group v-model="cfg.image.provider" aria-label="默认生图渠道" @change="onImageProviderChange">
                      <el-radio-button value="libtv-cli">LibTV CLI</el-radio-button>
                      <el-radio-button value="dreamina-cli">即梦 CLI</el-radio-button>
                      <el-radio-button value="updream">UpDream</el-radio-button>
                      <el-radio-button value="neowow">Neo</el-radio-button>
                    <el-radio-button value="api">通用 API</el-radio-button>
                  </el-radio-group>
                </div>
                <template v-if="cfg.image.provider === 'api'">
                  <div class="settings-head channel-settings-head">
                    <div><div class="eyebrow">Compatible</div><h3>通用图片 API</h3></div>
                    <el-button type="primary" @click="addImageChannel"><AppIcon name="plus" /><span>添加渠道</span></el-button>
                  </div>
                  <div class="channel-routing-bar">
                    <el-form-item label="主渠道">
                      <el-select v-model="cfg.image.activeChannelId" @change="syncImageChannelFallbacks" style="width:220px">
                        <el-option v-for="item in cfg.image.channels.filter(item => item.enabled)" :key="item.id" :label="item.name" :value="item.id" />
                      </el-select>
                    </el-form-item>
                    <section class="channel-routing-switch"><div><strong>自动切换备用渠道</strong><small>网络、限流或上游错误时继续下一条</small></div><el-switch v-model="cfg.image.autoFallback" /></section>
                    <el-form-item label="单渠道重试"><el-input-number v-model="cfg.image.retryCount" :min="0" :max="3" /></el-form-item>
                  </div>
                  <div class="channel-list">
                    <article
                      v-for="(channel, index) in cfg.image.channels"
                      :key="channel.id"
                      :class="['channel-list-row', { 'is-primary': channel.id === cfg.image.activeChannelId, 'is-off': channel.enabled === false }]"
                      @click="openImageChannelDrawer(channel)"
                    >
                      <span class="channel-list-index">{{ index + 1 }}</span>
                      <div class="channel-list-main">
                        <strong>{{ channel.name || ('生图渠道 ' + (index + 1)) }}</strong>
                        <small>{{ channel.model || '未设置模型' }} · {{ channel.baseUrl || '未设置地址' }}</small>
                      </div>
                      <div class="channel-list-tags">
                        <el-tag v-if="channel.id === cfg.image.activeChannelId" size="small" type="success" effect="plain">主渠道</el-tag>
                        <el-tag v-if="channel.enabled === false" size="small" type="info" effect="plain">已停用</el-tag>
                        <el-tag v-else-if="channel.apiKey" size="small" effect="plain">已配置</el-tag>
                        <el-tag v-else size="small" type="warning" effect="plain">缺 Key</el-tag>
                      </div>
                      <div class="channel-list-actions" @click.stop>
                        <el-button size="small" @click="openImageChannelDrawer(channel)"><AppIcon name="pencil" /><span>编辑</span></el-button>
                        <el-switch v-model="channel.enabled" size="small" @change="syncImageChannelFallbacks" />
                        <el-button size="small" type="danger" plain :disabled="cfg.image.channels.length <= 1" @click="deleteImageChannel(channel)"><AppIcon name="trash-2" /></el-button>
                      </div>
                    </article>
                  </div>
                  <el-drawer
                    :model-value="!!imageChannelDrawerId"
                    :title="imageChannelDrawerChannel ? (imageChannelDrawerChannel.name || '生图渠道') : '生图渠道'"
                    size="560px"
                    append-to-body
                    @update:model-value="closeImageChannelDrawer"
                  >
                    <div v-if="imageChannelDrawerChannel" class="channel-drawer-body">
                      <div class="channel-drawer-actions">
                        <el-button size="small" type="primary" :disabled="imageChannelDrawerChannel.id === cfg.image.activeChannelId" @click="cfg.image.activeChannelId = imageChannelDrawerChannel.id; syncImageChannelFallbacks()"><AppIcon name="check" /><span>设为主渠道</span></el-button>
                        <el-button size="small" :loading="testing.imageModels === imageChannelDrawerChannel.id" :disabled="!!testing.imageModels && testing.imageModels !== imageChannelDrawerChannel.id" @click="fetchImageModels(imageChannelDrawerChannel)"><AppIcon name="refresh-cw" /><span>拉取模型</span></el-button>
                        <el-button size="small" :loading="testing.image" @click="testImageChannel(imageChannelDrawerChannel)"><AppIcon name="cable" /><span>测试</span></el-button>
                        <el-button size="small" type="danger" plain :disabled="cfg.image.channels.length <= 1" @click="deleteImageChannel(imageChannelDrawerChannel); closeImageChannelDrawer()"><AppIcon name="trash-2" /><span>删除</span></el-button>
                      </div>
                      <el-form label-position="top" class="channel-profile-grid">
                        <el-form-item label="渠道名称"><el-input v-model="imageChannelDrawerChannel.name" placeholder="例如：主力云雾 / 备用中转" /></el-form-item>
                        <el-form-item label="模型">
                          <el-select :model-value="imageChannelModelPresetSelection(imageChannelDrawerChannel)" clearable placeholder="选择内置/已拉取模型（可选）" style="width:100%" @change="(v) => onImageChannelModelPresetSelect(imageChannelDrawerChannel, v)">
                            <el-option v-for="item in imageModelOptionsForChannel(imageChannelDrawerChannel)" :key="item.value" :label="item.label" :value="item.value" />
                          </el-select>
                          <el-input v-model="imageChannelDrawerChannel.model" placeholder="自定义模型：直接输入任意模型名称，例如 gpt-image-2-pro / dall-e-3" clearable class="field-gap" @input="onImageChannelModelChange(imageChannelDrawerChannel)" />
                        </el-form-item>
                        <el-form-item class="channel-wide" label="Base URL">
                          <div class="api-base-url-control">
                            <el-select v-model="imageChannelBaseUrlChoice[imageChannelDrawerChannel.id]" placeholder="选择内置地址或自定义" style="width:100%" @change="(v) => onImageChannelBaseUrlChoiceSelect(imageChannelDrawerChannel, v)">
                              <el-option v-for="item in imageBaseUrlOptions" :key="item.value" :label="item.label + ' · ' + item.value" :value="item.value">
                                <div class="api-base-url-option"><span>{{ item.label }} · {{ item.value }}</span><button type="button" title="打开此服务官网" :aria-label="'打开 ' + item.label + ' 官网'" @mousedown.stop @click.stop="openApiBaseUrl(item.value, $event)"><AppIcon name="link" /></button></div>
                              </el-option>
                              <el-option label="自定义" value="custom" />
                            </el-select>
                            <el-button circle :disabled="!apiBaseUrlLink(imageChannelDrawerChannel.baseUrl)" title="打开当前图片 API 对应网站" aria-label="打开当前图片 API 对应网站" @click="openApiBaseUrl(imageChannelDrawerChannel.baseUrl, $event)"><AppIcon name="link" /></el-button>
                          </div>
                          <el-input v-if="imageChannelBaseUrlChoice[imageChannelDrawerChannel.id] === 'custom'" v-model="imageChannelDrawerChannel.baseUrl" placeholder="自定义 Base URL：直接输入任意地址，例如 https://your-image-api.example.com/v1" clearable class="field-gap" @input="onImageChannelBaseUrlChange(imageChannelDrawerChannel)" />
                        </el-form-item>
                        <el-form-item class="channel-wide" label="API Key"><el-input v-model="imageChannelDrawerChannel.apiKey" type="password" show-password placeholder="每条渠道独立保存；已保存密钥会脱敏显示" /></el-form-item>
                        <el-form-item v-if="imageResolutionOptionsForChannel(imageChannelDrawerChannel).length" label="清晰度"><el-select v-model="imageChannelDrawerChannel.resolution" style="width:100%" @change="onImageChannelResolutionChange(imageChannelDrawerChannel)"><el-option v-for="item in imageResolutionOptionsForChannel(imageChannelDrawerChannel)" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                        <el-form-item label="单张估算价格"><el-input-number v-model="imageChannelDrawerChannel.pricePerImage" :min="0" :step="0.1" :precision="4" /></el-form-item>
                      </el-form>
                    </div>
                  </el-drawer>
                </template>
                <section v-else-if="cfg.image.provider === 'libtv-cli'" class="video-provider-panel">
                  <div class="video-provider-panel-head">
                    <div><strong>LibTV 图片生成</strong><span>{{ libtvCliStatus.authenticated ? (libtvCliStatus.accountName || '本机账号已登录') : (libtvCliStatus.installed ? '等待登录' : '等待安装') }}</span></div>
                    <div class="inline-actions">
                      <el-button size="small" :loading="testing.libtvImageModels" :disabled="!libtvCliStatus.authenticated" @click="fetchLibtvImageModels()"><AppIcon name="refresh-cw" /><span>加载模型</span></el-button>
                      <el-button size="small" :loading="libtvCliLoading" @click="refreshLibtvCliStatus"><AppIcon name="search" /><span>检测</span></el-button>
                      <el-button v-if="libtvCliStatus.installed && !libtvCliStatus.authenticated" size="small" type="primary" :loading="libtvCliLoading" @click="loginLibtvCli"><AppIcon name="user" /><span>登录</span></el-button>
                      <el-button v-else-if="!libtvCliStatus.installed" size="small" type="primary" :loading="libtvCliLoading" @click="installLibtvCli"><AppIcon name="download" /><span>安装</span></el-button>
                    </div>
                  </div>
                  <div class="channel-profile-grid">
                    <el-form-item class="channel-wide" label="画布 UUID"><el-input v-model="cfg.image.libtvProjectUuid" :placeholder="cfg.video.libtvProjectUuid || '填写用于生成图片的 LibTV 画布 UUID'" /></el-form-item>
                    <el-form-item label="图片模型"><el-select v-model="cfg.image.libtvModel" filterable allow-create default-first-option style="width:100%"><el-option v-for="item in libtvImageModelOptions" :key="item.value" :label="item.label" :value="item.value"><span>{{ item.label }}</span><small v-if="item.description" style="float:right;color:var(--muted)">{{ item.description }}</small></el-option></el-select></el-form-item>
                    <el-form-item label="清晰度"><el-select v-model="cfg.image.libtvResolution" style="width:100%"><el-option label="1K" value="1K" /><el-option label="2K" value="2K" /><el-option label="4K" value="4K" /></el-select></el-form-item>
                    <el-form-item label="画质"><el-select v-model="cfg.image.libtvQuality" style="width:100%"><el-option label="低" value="low" /><el-option label="标准" value="medium" /><el-option label="高" value="high" /></el-select></el-form-item>
                  </div>
                </section>
                <section v-else-if="cfg.image.provider === 'dreamina-cli'" class="video-provider-panel">
                  <div class="video-provider-panel-head">
                    <div><strong>即梦 CLI 图片生成</strong><span>{{ dreaminaCliStatus.message || '复用即梦 CLI 本机登录态' }}</span></div>
                    <div class="inline-actions">
                      <el-button size="small" :loading="dreaminaCliLoading" @click="installDreaminaCli"><AppIcon name="download" /><span>安装 CLI</span></el-button>
                      <el-button size="small" type="primary" :loading="dreaminaCliLoading" @click="loginDreaminaCli"><AppIcon name="user" /><span>登录</span></el-button>
                      <el-button size="small" :loading="dreaminaCliLoading" @click="refreshDreaminaCliStatus"><AppIcon name="search" /><span>检测</span></el-button>
                      <el-button size="small" type="danger" plain :disabled="!dreaminaCliStatus.authenticated" :loading="dreaminaCliLoading" @click="logoutDreaminaCli"><AppIcon name="power" /><span>退出</span></el-button>
                    </div>
                  </div>
                  <div class="channel-profile-grid">
                    <el-form-item label="图片模型"><el-select v-model="cfg.image.dreaminaModel" filterable style="width:100%" @change="onDreaminaImageModelChange"><el-option v-for="item in dreaminaImageModelOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                    <el-form-item label="清晰度"><el-select v-model="cfg.image.dreaminaResolution" style="width:100%"><el-option v-for="item in dreaminaImageResolutionOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                    <el-form-item label="Session"><el-input v-model="cfg.image.dreaminaSession" placeholder="0" /></el-form-item>
                    <el-form-item class="channel-wide"><span class="settings-help">3.0 / 3.1 仅支持文生图；带参考图时请使用 4.0 及以上模型。</span></el-form-item>
                  </div>
                </section>
                <section v-else-if="cfg.image.provider === 'updream'" class="video-provider-panel">
                  <div class="video-provider-panel-head">
                    <div><strong>UpDream 图片生成</strong><span>{{ testResult.updream?.ok ? (testResult.updream.accountName || '账号可用') : '使用 UpDream 账号任务通道' }}</span></div>
                    <div class="inline-actions">
                      <el-button size="small" :loading="testing.updreamImageModels" @click="fetchUpdreamImageModels()"><AppIcon name="refresh-cw" /><span>加载模型</span></el-button>
                      <el-button size="small" :loading="testing.updream" @click="testUpdreamConnection"><AppIcon name="cable" /><span>验证账号</span></el-button>
                    </div>
                  </div>
                  <div class="channel-profile-grid">
                    <el-form-item class="channel-wide" label="API 地址"><el-input v-model="cfg.video.updreamBaseUrl" placeholder="https://www.updream.cn/api" /></el-form-item>
                    <el-form-item label="图片模型"><el-select v-model="cfg.image.updreamModel" filterable style="width:100%" placeholder="请选择图片模型" @change="onUpdreamImageModelChange"><el-option v-for="item in updreamImageModelOptions" :key="item.value" :label="item.label" :value="item.value"><span>{{ item.label }}</span><small v-if="item.minTier" style="float:right;color:var(--muted)">{{ item.minTier }}</small></el-option></el-select></el-form-item>
                    <el-form-item v-if="updreamImageResolutionOptions.length" label="清晰度"><el-select v-model="cfg.image.updreamResolution" style="width:100%"><el-option v-for="item in updreamImageResolutionOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                    <el-form-item v-if="updreamImageQualityOptions.length" label="画质"><el-select v-model="cfg.image.updreamQuality" style="width:100%"><el-option v-for="item in updreamImageQualityOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                    <el-form-item label="Access Token"><el-input v-model="cfg.video.updreamAccessToken" type="password" show-password autocomplete="off" /></el-form-item>
                    <el-form-item class="channel-wide" label="Refresh Token"><el-input v-model="cfg.video.updreamRefreshToken" type="password" show-password autocomplete="off" /></el-form-item>
                  </div>
                </section>
                <section v-else-if="cfg.image.provider === 'neowow'" class="video-provider-panel">
                  <div class="video-provider-panel-head">
                    <div><strong>Neo 图片生成</strong><span>生成结果会在 Neo 图片画布中按 6 列自动整齐排列</span></div>
                    <div class="inline-actions">
                      <el-button size="small" :loading="testing.neowowImageModels" :disabled="!cfg.image.neowowAccountId" @click="fetchNeowowImageModels()"><AppIcon name="refresh-cw" /><span>加载模型</span></el-button>
                      <el-button size="small" :loading="testing.neowow" :disabled="!cfg.image.neowowAccountId" @click="testNeowowConnection(cfg.image.neowowAccountId)"><AppIcon name="cable" /><span>验证账号</span></el-button>
                    </div>
                  </div>
                  <div class="channel-profile-grid">
                    <el-form-item label="生图账号">
                      <el-select v-model="cfg.image.neowowAccountId" style="width:100%" placeholder="请先在视频设置中添加 Neo 账号">
                        <el-option v-for="account in cfg.video.neowowAccounts.filter(item => item.hasToken && item.enabled !== false)" :key="account.id" :label="account.name" :value="account.id"><span>{{ account.name }}</span><small style="float:right;color:var(--muted)">{{ account.points == null ? '' : (account.points + ' 积分') }}</small></el-option>
                      </el-select>
                    </el-form-item>
                    <el-form-item label="图片模型"><el-select v-model="cfg.image.neowowModel" filterable style="width:100%" @change="onNeowowImageModelChange"><el-option v-for="item in neowowImageModelOptions" :key="item.value" :label="item.label" :value="item.value" :disabled="item.maintenance"><span>{{ item.label }}</span><small v-if="item.membershipRequired" style="float:right;color:#c58a13">会员</small><small v-else-if="item.discountRate != null && item.discountRate < 1" style="float:right;color:#c58a13">{{ Number((item.discountRate * 10).toFixed(1)) }}折</small></el-option></el-select></el-form-item>
                    <el-form-item label="清晰度"><el-select v-model="cfg.image.neowowResolution" style="width:100%"><el-option v-for="item in neowowImageResolutionOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                    <el-form-item v-if="neowowImageQualityOptions.length" label="画质"><el-select v-model="cfg.image.neowowQuality" style="width:100%"><el-option v-for="item in neowowImageQualityOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                    <el-form-item class="channel-wide" label="API 地址"><el-input v-model="cfg.video.neowowBaseUrl" placeholder="https://neowow.cn" /></el-form-item>
                  </div>
                </section>
                <div class="channel-common-settings">
                  <div class="settings-head"><div><div class="eyebrow">Common</div><h3>生图公共参数</h3></div></div>
                  <el-form label-position="top">
                    <el-form-item label="图片比例"><el-select v-model="cfg.image.ratio" style="width:220px"><template v-if="cfg.image.provider === 'neowow'"><el-option v-for="item in neowowImageRatioOptions" :key="item.value" :label="item.label" :value="item.value" /></template><template v-else><el-option label="16:9 横版" value="16:9" /><el-option label="4:3 横版" value="4:3" /><el-option label="1:1 方图" value="1:1" /><el-option label="3:4 竖版" value="3:4" /><el-option label="9:16 竖版" value="9:16" /></template></el-select></el-form-item>
                    <el-form-item label="批量出图并发"><el-input-number v-model="cfg.image.concurrency" :min="1" :max="cfg.image.provider === 'updream' ? 3 : (cfg.image.provider === 'neowow' ? 15 : (['libtv-cli', 'dreamina-cli'].includes(cfg.image.provider) ? 10 : 50))" :step="1" style="width:160px" /></el-form-item>
                    <el-form-item label="出图风格"><el-radio-group v-model="styleChoice" @change="onStyleChoiceChange"><el-radio-button v-for="item in styleOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button></el-radio-group></el-form-item>
                  </el-form>
                </div>
              </template>

              <template v-if="settingsSection === 'imageHosting'">
                <div class="settings-head channel-settings-head">
                  <div><div class="eyebrow">Image Hosting</div><h2>图床</h2></div>
                  <div class="inline-actions">
                    <el-tag v-if="testResult.imageUpload" size="small" :type="testResult.imageUpload.ok ? 'success' : 'danger'">
                      {{ testResult.imageUpload.ok ? ('可用 · ' + (testResult.imageUpload.host || '直链正常')) : (testResult.imageUpload.error || '测试失败') }}
                    </el-tag>
                    <el-button :loading="testing.imageUpload" :disabled="cfg.video.imageUpload.provider === 'none'" @click="testImageUpload">
                      <AppIcon name="cable" /><span>测试上传</span>
                    </el-button>
                  </div>
                </div>
                <el-form label-position="top" class="image-hosting-settings">
                  <el-form-item label="图床类型">
                    <el-radio-group v-model="cfg.video.imageUpload.provider" class="image-hosting-provider-switch" aria-label="图床类型">
                      <el-radio-button value="none">关闭</el-radio-button>
                      <el-radio-button value="free">免费图床</el-radio-button>
                      <el-radio-button value="custom">自定义</el-radio-button>
                      <el-radio-button value="aliyun-oss">阿里云 OSS</el-radio-button>
                      <el-radio-button value="tencent-cos">腾讯云 COS</el-radio-button>
                      <el-radio-button value="cloudflare-r2">Cloudflare R2</el-radio-button>
                      <el-radio-button value="aws-s3">AWS S3</el-radio-button>
                    </el-radio-group>
                  </el-form-item>

                  <section v-if="cfg.video.imageUpload.provider === 'none'" class="image-hosting-state">
                    <AppIcon name="circle-x" />
                    <div><strong>图片中转已关闭</strong><span>内置网关(New API)与飞拓跨界通道只接受公网图片链接，关闭后本地参考图会被上游拒绝（报 image_urls must be a public http(s) URL）。没有自己的图床时，选「免费图床」即可。</span></div>
                  </section>

                  <template v-else-if="cfg.video.imageUpload.provider === 'free'">
                    <div class="image-hosting-grid">
                      <el-form-item class="field-wide" label="免费图床">
                        <el-radio-group v-model="cfg.video.imageUpload.freeProvider" class="image-hosting-provider-switch" aria-label="免费图床">
                          <el-radio-button value="auto">自动选择</el-radio-button>
                          <el-radio-button value="litterbox">Litterbox</el-radio-button>
                          <el-radio-button value="uguu">Uguu（3 小时）</el-radio-button>
                          <el-radio-button value="imgbb">ImgBB</el-radio-button>
                        </el-radio-group>
                      </el-form-item>
                      <el-form-item v-if="cfg.video.imageUpload.freeProvider === 'litterbox'" label="图片有效期">
                        <el-select v-model="cfg.video.imageUpload.freeExpiry" style="width:100%">
                          <el-option label="1 小时" value="1h" />
                          <el-option label="12 小时" value="12h" />
                          <el-option label="24 小时" value="24h" />
                          <el-option label="72 小时" value="72h" />
                        </el-select>
                      </el-form-item>
                      <el-form-item v-if="cfg.video.imageUpload.freeProvider === 'imgbb'" class="field-wide" label="ImgBB API Key（免费申请）">
                        <el-input v-model="cfg.video.imageUpload.imgbbApiKey" type="password" show-password autocomplete="off" placeholder="填写 ImgBB API Key 后点击测试上传" />
                      </el-form-item>
                    </div>
                    <section class="image-hosting-state is-warning">
                      <AppIcon name="circle-alert" />
                      <div><strong>免费公共图床</strong><span>本地参考图会上传到所选第三方服务，请勿用于私密或敏感素材。</span></div>
                    </section>
                  </template>

                  <div v-else-if="cfg.video.imageUpload.provider === 'custom'" class="image-hosting-grid">
                    <el-form-item class="field-wide" label="上传地址">
                      <el-input v-model="cfg.video.imageUpload.endpoint" placeholder="https://example.com/api/upload" />
                    </el-form-item>
                    <el-form-item label="文件字段名">
                      <el-input v-model="cfg.video.imageUpload.customFileField" placeholder="file" />
                    </el-form-item>
                    <el-form-item label="返回 URL 路径">
                      <el-input v-model="cfg.video.imageUpload.customUrlPath" placeholder="data.url（留空时自动识别）" />
                    </el-form-item>
                    <el-form-item label="鉴权 Header">
                      <el-input v-model="cfg.video.imageUpload.customAuthHeader" placeholder="Authorization" />
                    </el-form-item>
                    <el-form-item label="鉴权前缀">
                      <el-input v-model="cfg.video.imageUpload.customAuthScheme" placeholder="Bearer" />
                    </el-form-item>
                    <el-form-item class="field-wide" label="Token（可选）">
                      <el-input v-model="cfg.video.imageUpload.customToken" type="password" show-password autocomplete="off" placeholder="已保存的 Token 会脱敏显示" />
                    </el-form-item>
                  </div>

                  <div v-else class="image-hosting-grid">
                    <el-form-item v-if="cfg.video.imageUpload.provider === 'cloudflare-r2'" label="Account ID">
                      <el-input v-model="cfg.video.imageUpload.accountId" placeholder="Cloudflare Account ID" />
                    </el-form-item>
                    <el-form-item label="Bucket">
                      <el-input v-model="cfg.video.imageUpload.bucket" :placeholder="cfg.video.imageUpload.provider === 'tencent-cos' ? 'bucket-appid' : '存储桶名称'" />
                    </el-form-item>
                    <el-form-item v-if="cfg.video.imageUpload.provider !== 'cloudflare-r2'" label="Region">
                      <el-input v-model="cfg.video.imageUpload.region" :placeholder="cfg.video.imageUpload.provider === 'aliyun-oss' ? 'cn-hangzhou' : (cfg.video.imageUpload.provider === 'tencent-cos' ? 'ap-guangzhou' : 'us-east-1')" />
                    </el-form-item>
                    <el-form-item label="Access Key ID">
                      <el-input v-model="cfg.video.imageUpload.accessKeyId" type="password" show-password autocomplete="off" />
                    </el-form-item>
                    <el-form-item label="Secret Access Key">
                      <el-input v-model="cfg.video.imageUpload.secretAccessKey" type="password" show-password autocomplete="off" />
                    </el-form-item>
                    <el-form-item class="field-wide" label="Session Token（可选）">
                      <el-input v-model="cfg.video.imageUpload.sessionToken" type="password" show-password autocomplete="off" />
                    </el-form-item>
                    <el-form-item class="field-wide" label="公开访问域名（可选）">
                      <el-input v-model="cfg.video.imageUpload.publicBaseUrl" placeholder="https://cdn.example.com；留空时使用限时签名 URL" />
                    </el-form-item>
                    <el-form-item label="存储路径">
                      <el-input v-model="cfg.video.imageUpload.pathPrefix" placeholder="video-api" />
                    </el-form-item>
                    <el-form-item label="签名有效期（小时）">
                      <el-input-number v-model="cfg.video.imageUpload.signedUrlTtlHours" :min="1" :max="168" :step="1" />
                    </el-form-item>
                  </div>
                </el-form>
              </template>

              <template v-if="settingsSection === 'prompt'">
                <div class="settings-head"><div><div class="eyebrow">Prompt</div><h2>提示词设置</h2></div></div>
                <p class="muted">分别填写仿真人、2D、3D 的画风描述。填写后会完整替代对应风格的「整体风格/画风风格」内容；留空时使用内置默认。</p>
                <el-form label-position="top">
                  <el-form-item v-for="field in stylePromptFields" :key="field.key" :label="field.label">
                    <el-input v-model="cfg.stylePrompts[field.key]" type="textarea" :rows="4" resize="vertical" :placeholder="field.placeholder" />
                  </el-form-item>
                </el-form>
                <el-divider content-position="left">元素提示词</el-divider>
                <p class="muted">留空时使用内置提示词；填写后保留元素的具体设定，并改用该分类的自定义提示词。</p>
                <el-form v-if="cfg.stylePrompts.elements" class="element-prompt-grid" label-position="top">
                  <el-form-item v-for="field in elementPromptFields" :key="field.key" :label="field.label">
                    <el-input v-model="cfg.stylePrompts.elements[field.key]" type="textarea" :rows="6" resize="vertical" clearable :placeholder="field.placeholder" />
                  </el-form-item>
                </el-form>
              </template>

              <template v-if="settingsSection === 'extract'">
                <div class="settings-head"><div><div class="eyebrow">Extract</div><h2>提取设置</h2></div></div>
                <el-form label-position="top">
                  <el-form-item label="元素提取逻辑">
                    <el-radio-group v-model="cfg.promptTemplate.selectedId">
                      <el-radio-button value="custom">第一套</el-radio-button>
                      <el-radio-button v-if="secondPromptSetUnlocked" value="second">第二套</el-radio-button>
                    </el-radio-group>
                    <p v-if="cfg.promptTemplate.selectedId === 'second'" class="muted field-gap">保留小说题材、时代与世界体系，重新设计人物长相、比例和具体服装；固定使用高颜值骨相、严格9头身与题材内完整高定造型。</p>
                  </el-form-item>
                  <el-form-item label="分块大小">
                    <el-input-number v-model="cfg.chunkSize" :min="1000" :max="60000" :step="1000" style="width:220px" />
                  </el-form-item>
                  <el-form-item label="元素提取并发数">
                    <el-input-number v-model="cfg.extractConcurrency" :min="1" :max="4" :step="1" style="width:220px" />
                  </el-form-item>
                </el-form>
              </template>

              <template v-if="settingsSection === 'system'">
                <div class="settings-head"><div><div class="eyebrow">System</div><h2>系统与诊断</h2></div></div>
                <section class="software-update-panel" :class="'is-' + softwareUpdate.status">
                  <div class="software-update-main">
                    <span class="software-update-icon"><AppIcon name="download" /></span>
                    <div class="software-update-copy">
                      <div class="software-update-title">
                        <strong>软件更新</strong>
                        <el-tag size="small" :type="softwareUpdateStatusType" effect="plain">{{ softwareUpdateStatusText }}</el-tag>
                      </div>
                      <p>当前版本 v{{ softwareUpdate.currentVersion || '-' }}</p>
                    </div>
                    <div class="software-update-actions">
                      <el-button
                        :loading="softwareUpdate.status === 'checking'"
                        :disabled="!softwareUpdate.enabled || softwareUpdateBusy || softwareUpdateCanInstall"
                        @click="checkSoftwareUpdate"
                      ><AppIcon name="refresh-cw" /><span>检查更新</span></el-button>
                      <el-button v-if="softwareUpdateCanDownload" type="primary" @click="downloadSoftwareUpdate">
                        <AppIcon name="download" /><span>下载 v{{ softwareUpdate.targetVersion }}</span>
                      </el-button>
                      <el-button v-if="softwareUpdateCanInstall" type="primary" @click="installSoftwareUpdate">
                        <AppIcon name="rotate-cw" /><span>重启并更新</span>
                      </el-button>
                    </div>
                  </div>
                  <div v-if="softwareUpdate.status === 'downloading'" class="software-update-progress" aria-live="polite">
                    <el-progress :percentage="Math.round(softwareUpdate.percent || 0)" :stroke-width="8" />
                    <span>{{ softwareUpdateProgressText }}</span>
                  </div>
                  <p v-if="softwareUpdate.error" class="software-update-error">{{ softwareUpdate.error }}</p>
                  <p v-else-if="softwareUpdate.releaseNotes && ['available', 'downloaded'].includes(softwareUpdate.status)" class="software-update-notes">{{ softwareUpdate.releaseNotes }}</p>
                </section>
                <section class="storage-setting-panel">
                  <div class="storage-setting-head">
                    <div>
                      <strong>数据存储位置</strong>
                      <p>项目、图片、视频、配置、日志、任务状态和缓存都将保存在此目录。</p>
                    </div>
                    <el-tag
                      :type="cfg.storage.isDefault ? 'success' : 'warning'"
                      effect="plain"
                      class="storage-status-tag"
                      title="仅用于展示当前存储状态，点击查看说明"
                      @click="showStorageStatusInfo"
                    >
                      {{ cfg.storage.isDefault ? '跟随软件位置' : '自定义目录' }}
                    </el-tag>
                  </div>
                  <el-input v-model="cfg.storage.rootPath" class="storage-path-input" placeholder="请选择数据存储目录">
                    <template #append>
                      <el-button :loading="choosingStorageDirectory" @click="chooseStorageDirectory"><AppIcon name="folder-open" /><span>选择目录</span></el-button>
                    </template>
                  </el-input>
                  <div class="storage-setting-actions">
                    <el-button size="small" @click="openStorageDirectory"><AppIcon name="folder-open" /><span>打开当前目录</span></el-button>
                    <el-button size="small" :disabled="cfg.storage.rootPath === cfg.storage.defaultRootPath" @click="resetStorageDirectory">恢复默认位置</el-button>
                  </div>
                  <div class="storage-path-meta">
                    <span>软件位置：{{ cfg.storage.installDir || '-' }}</span>
                    <span>默认数据目录：{{ cfg.storage.defaultRootPath || '-' }}</span>
                  </div>
                  <el-alert
                    title="更改后点击保存，软件会复制数据并自动重启；旧存储目录会保留为恢复副本。"
                    type="info"
                    :closable="false"
                    show-icon
                  />
                </section>
                <div class="system-settings-grid">
                  <section class="system-setting-card">
                    <div>
                      <strong>硬件加速</strong>
                      <p>启用 GPU 渲染可提升界面流畅度。若检测到上次渲染进程启动崩溃，下次会自动进入安全模式。</p>
                    </div>
                    <el-switch v-model="cfg.performance.hardwareAcceleration" aria-label="启用硬件加速" />
                  </section>
                  <section class="system-setting-card">
                    <div>
                      <strong>减少动画</strong>
                      <p>降低过渡、悬浮和加载动画，适合对动态效果敏感或希望减少资源占用的用户。</p>
                    </div>
                    <el-switch v-model="cfg.performance.reduceMotion" aria-label="减少界面动画" />
                  </section>
                  <section class="system-setting-card">
                    <div>
                      <strong>低配流畅模式</strong>
                      <p>关闭毛玻璃、卡片投影与过渡动画等重特效，大幅降低低配电脑的渲染负担。未设置时按机器配置自动开启。</p>
                    </div>
                    <el-switch v-model="liteModeEnabled" aria-label="低配流畅模式" />
                  </section>
                </div>
                <el-alert
                  title="硬件加速设置保存后需重启应用生效；安全模式会临时覆盖该设置。"
                  type="info"
                  :closable="false"
                  show-icon
                />

                <div class="settings-head diagnostics-heading"><div><div class="eyebrow">Diagnostics</div><h3>运行诊断</h3></div></div>
                <div class="diagnostics-toolbar">
                  <el-button :loading="diagnostics.loading" @click="loadDiagnostics"><AppIcon name="refresh-cw" /><span>刷新状态</span></el-button>
                  <el-button type="primary" :loading="diagnostics.exporting" @click="exportDiagnostics"><AppIcon name="download" /><span>导出脱敏诊断包</span></el-button>
                </div>
                <p class="muted diagnostics-note">诊断包只包含系统信息、脱敏配置摘要、任务摘要和最近日志，不包含项目正文、图片、视频、API Key 或登录会话。</p>
                <div v-if="diagnostics.status" class="diagnostics-grid" aria-live="polite">
                  <div><span>应用版本</span><strong>{{ diagnostics.status.app?.version || '-' }}</strong></div>
                  <div><span>启动模式</span><strong>{{ diagnostics.status.app?.safeMode ? '安全模式' : '正常模式' }}</strong></div>
                  <div><span>系统</span><strong>{{ diagnostics.status.system?.platform }} / {{ diagnostics.status.system?.arch }}</strong></div>
                  <div><span>运行时间</span><strong>{{ diagnostics.status.app?.uptimeSeconds || 0 }} 秒</strong></div>
                  <div><span>当前可用运行内存</span><strong>{{ ((diagnostics.status.system?.freeMemoryMb || 0) / 1024).toFixed(1) }} GB / {{ ((diagnostics.status.system?.totalMemoryMb || 0) / 1024).toFixed(1) }} GB</strong></div>
                  <div><span>持久化任务</span><strong>{{ diagnostics.status.tasks?.total || 0 }}</strong></div>
                  <div><span>硬件加速配置</span><strong>{{ diagnostics.status.config?.performance?.hardwareAcceleration ? '启用' : '禁用' }}</strong></div>
                  <div><span>日志文件</span><strong>{{ diagnostics.status.logs?.files?.length || 0 }}</strong></div>
                </div>
              </template>

              <template v-if="settingsSection === 'video'">
                <div class="settings-head"><div><div class="eyebrow">Video</div><h2>视频模型</h2></div></div>
                <el-form label-position="top">
                  <el-form-item label="默认视频渠道">
                    <el-radio-group v-model="cfg.video.provider" class="video-provider-switch" aria-label="默认视频渠道" @change="rememberDefaultVideoProvider">
                      <el-radio-button value="xiaoyunque">小云雀</el-radio-button>
                      <el-radio-button value="dreamina-cli">即梦 CLI</el-radio-button>
                      <el-radio-button value="dreamina-agent">即梦 Agent</el-radio-button>
                      <el-radio-button value="libtv-cli">LibTV CLI</el-radio-button>
                      <el-radio-button value="updream">UpDream</el-radio-button>
                      <el-radio-button value="neowow">Neowow</el-radio-button>
                      <el-radio-button value="comfyui">ComfyUI H3</el-radio-button>
                      <el-radio-button value="video-api">视频 API</el-radio-button>
                    </el-radio-group>
                  </el-form-item>

                  <div :key="cfg.video.provider" class="video-provider-panel" aria-live="polite">
                    <template v-if="cfg.video.provider === 'xiaoyunque'">
                      <div class="video-provider-panel-head">
                        <div><strong>小云雀配置</strong><span>当前生成会使用小云雀线路</span></div>
                        <el-tag size="small" type="success">当前渠道</el-tag>
                      </div>
                      <el-form-item label="小云雀默认模型">
                        <el-select v-model="cfg.video.xiaoyunqueModel" style="width:240px">
                          <el-option v-for="m in xiaoyunqueModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                      </el-form-item>
                    </template>

                    <template v-else-if="cfg.video.provider === 'dreamina-cli'">
                      <div class="video-provider-panel-head">
                        <div><strong>即梦 CLI 配置</strong><span>当前生成会使用本机即梦 CLI</span></div>
                        <el-tag size="small" type="success">当前渠道</el-tag>
                      </div>
                      <el-form-item label="即梦 CLI 默认模型">
                        <el-select v-model="cfg.video.dreaminaModel" style="width:240px">
                          <el-option v-for="m in dreaminaModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="即梦 CLI Session">
                        <el-input v-model="cfg.video.dreaminaSession" placeholder="默认 0，多开可填 1/2/3…" style="width:240px" />
                      </el-form-item>
                    </template>

                    <template v-else-if="cfg.video.provider === 'dreamina-agent'">
                      <div class="video-provider-panel-head">
                        <div><strong>即梦 Agent 官网渠道</strong><span>通过专用 Edge 网页登录态提交，完成后自动下载并写回分镜</span></div>
                        <el-tag size="small" type="success">当前渠道</el-tag>
                      </div>
                      <el-form-item label="固定开头">
                        <el-radio-group v-model="cfg.video.dreaminaAgentPromptPreset">
                          <el-radio-button value="standard">标准（非fast）</el-radio-button>
                          <el-radio-button value="fast">Fast（非2.0）</el-radio-button>
                        </el-radio-group>
                      </el-form-item>
                      <el-form-item label="分镜发送间隔">
                        <el-input-number v-model="cfg.video.dreaminaAgentShotIntervalSeconds" :min="10" :max="3600" :step="10" controls-position="right" style="width:160px" />
                        <span class="muted" style="margin-left:8px">秒</span>
                      </el-form-item>
                      <div class="inline-actions">
                        <el-tag size="small" effect="plain">{{ cfg.video.dreaminaAgentPromptPreset === 'fast' ? 'Seedance 2.0fast' : 'Seedance 2.0' }}</el-tag>
                        <el-tag size="small" effect="plain">非 VIP</el-tag>
                        <el-tag size="small" effect="plain">{{ cfg.video.dreaminaAgentPromptPreset === 'fast' ? '非 2.0' : '非 Fast' }}</el-tag>
                        <el-tag size="small" effect="plain">15 秒</el-tag>
                        <el-tag size="small" effect="plain">16:9</el-tag>
                        <el-tag size="small" effect="plain">官网 @ 主体</el-tag>
                        <el-tag size="small" effect="plain">队列不限量</el-tag>
                        <el-tag size="small" effect="plain">{{ cfg.video.dreaminaAgentShotIntervalSeconds || 80 }} 秒间隔</el-tag>
                      </div>
                    </template>

                    <template v-else-if="cfg.video.provider === 'libtv-cli'">
                      <div class="video-provider-panel-head">
                        <div><strong>LibTV CLI 配置</strong><span>素材会上传为 LibTV 画布节点后生成视频</span></div>
                        <el-tag size="small" type="success">当前渠道</el-tag>
                      </div>
                      <el-form-item label="LibTV 默认模型">
                        <div class="inline-actions">
                          <el-select v-model="cfg.video.libtvModel" placeholder="选择模型" style="width:280px">
                            <el-option v-for="m in libtvModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                          </el-select>
                          <el-button :loading="libtvModelsLoading" @click="refreshLibtvModels"><AppIcon name="refresh-cw" /><span>刷新模型</span></el-button>
                        </div>
                      </el-form-item>
                      <el-form-item label="LibTV 画布 UUID">
                        <el-input v-model="cfg.video.libtvProjectUuid" placeholder="填写用于生成视频的 LibTV 画布 UUID" style="width:min(100%,520px)" />
                        <small class="hint">参考素材会先放入这张画布，再通过画布节点引用生成视频。</small>
                      </el-form-item>
                      <el-form-item label="批量并发">
                        <el-input-number v-model="cfg.video.libtvConcurrency" :min="1" :max="10" :step="1" style="width:180px" />
                        <small class="hint">同时生成的视频数量，默认 3。</small>
                      </el-form-item>
                    </template>

                    <template v-else-if="cfg.video.provider === 'updream'">
                      <div class="video-provider-panel-head">
                        <div><strong>UpDream 配置</strong><span>使用 UpDream 账号生成并自动拉回视频</span></div>
                        <el-tag size="small" type="success">当前渠道</el-tag>
                      </div>
                      <div class="channel-profile-grid">
                        <el-form-item label="默认模型">
                          <el-select v-model="cfg.video.updreamModel" style="width:100%">
                            <el-option v-for="m in updreamModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                          </el-select>
                        </el-form-item>
                        <el-form-item label="生成并发上限">
                          <el-input-number v-model="cfg.video.updreamConcurrency" :min="1" :step="1" step-strictly style="width:100%" />
                          <small class="hint">最多同时在 UpDream 生成的视频数，超出的分镜会自动排队补位。</small>
                        </el-form-item>
                        <el-form-item class="channel-wide" label="Access Token">
                          <el-input v-model="cfg.video.updreamAccessToken" type="password" show-password autocomplete="off" placeholder="UpDream Access Token" />
                        </el-form-item>
                        <el-form-item class="channel-wide" label="Refresh Token">
                          <el-input v-model="cfg.video.updreamRefreshToken" type="password" show-password autocomplete="off" placeholder="UpDream Refresh Token" />
                        </el-form-item>
                      </div>
                      <div class="inline-actions">
                        <el-button :loading="testing.updream" @click="testUpdreamConnection"><AppIcon name="search" /><span>验证账号</span></el-button>
                        <el-tag v-if="testResult.updream" size="small" :type="testResult.updream.ok ? 'success' : 'danger'">
                          {{ testResult.updream.ok ? (testResult.updream.accountName || '连接成功') : (testResult.updream.error || '连接失败') }}
                        </el-tag>
                      </div>
                     </template>

                    <template v-else-if="cfg.video.provider === 'comfyui'">
                      <div class="video-provider-panel-head">
                        <div><strong>ComfyUI 云端 · MiniMax H3</strong><span>连接云端工作流后生成视频，引用素材会按上传节点逐项绑定</span></div>
                        <el-tag size="small" type="success">当前渠道</el-tag>
                      </div>
                      <div class="channel-profile-grid comfyui-settings-grid">
                        <el-form-item class="channel-wide" label="云端 ComfyUI 地址">
                          <el-input v-model="cfg.video.comfyuiBaseUrl" placeholder="https://你的云端地址:8443" clearable />
                          <small class="hint">例如 https://u1120083-7863c8bb30ce.westd.seetacloud.com:8443</small>
                        </el-form-item>
                        <el-form-item label="H3 工作流">
                          <el-select v-model="cfg.video.comfyuiWorkflowPreset" style="width:100%" @change="onComfyUiWorkflowChange">
                            <el-option v-for="item in comfyUiWorkflowOptions" :key="item.value" :label="item.label" :value="item.value" />
                          </el-select>
                        </el-form-item>
                        <el-form-item label="云端生成并发">
                          <el-input-number v-model="cfg.video.comfyuiConcurrency" :min="1" :max="3" :step="1" controls-position="right" style="width:160px" />
                        </el-form-item>
                      </div>
                      <div class="inline-actions comfyui-test-actions">
                        <el-button type="primary" :loading="testing.comfyui" @click="testComfyUiConnection"><AppIcon name="cable" /><span>测试连接并读取槽位</span></el-button>
                        <el-tag v-if="testResult.comfyui" size="small" :type="testResult.comfyui.ok ? 'success' : 'danger'">
                          {{ testResult.comfyui.ok ? ('已连接 ' + (testResult.comfyui.version || 'ComfyUI') + (testResult.comfyui.device ? ' · ' + testResult.comfyui.device : '')) : (testResult.comfyui.error || '连接失败') }}
                        </el-tag>
                      </div>
                      <div v-if="testResult.comfyui && testResult.comfyui.ok" class="comfyui-capability-grid">
                        <div><span>图片槽位</span><strong>{{ testResult.comfyui.capabilities?.capacity?.image || 0 }}</strong></div>
                        <div><span>视频槽位</span><strong>{{ testResult.comfyui.capabilities?.capacity?.video || 0 }}</strong></div>
                        <div><span>音频槽位</span><strong>{{ testResult.comfyui.capabilities?.capacity?.audio || 0 }}</strong></div>
                        <div><span>工作流节点</span><strong>{{ testResult.comfyui.workflowNodeCount || 0 }}</strong></div>
                      </div>
                      <small class="hint comfyui-binding-hint">MiniMax H3 引用必须与独立上传节点一一对应；视频引用的画面与伴随音频必须来自同一个视频文件。U07 会根据图片数量自动切换文生、单图或多图分支。</small>
                    </template>

                    <template v-else-if="cfg.video.provider === 'neowow'">
                      <div class="video-provider-panel-head">
                        <div><strong>Neowow 多账号</strong><span>每个任务固定使用原提交账号生成、轮询和拉回</span></div>
                        <el-tag size="small" type="success">当前渠道</el-tag>
                      </div>
                      <div class="channel-profile-grid">
                        <el-form-item label="默认模型">
                          <el-select v-model="cfg.video.neowowModel" style="width:100%">
                            <el-option v-for="m in neowowModelOptions" :key="m.value" :label="m.label" :value="m.value" />
                          </el-select>
                        </el-form-item>
                        <el-form-item label="生成并发上限">
                          <el-input-number v-model="cfg.video.neowowConcurrency" :min="1" :step="1" step-strictly style="width:100%" />
                          <small class="hint">每个可用账号最多同时生成的视频数，超出的分镜会按账号排队补位。</small>
                        </el-form-item>
                        <el-form-item label="API 地址">
                          <el-input v-model="cfg.video.neowowBaseUrl" placeholder="https://neowow.cn" />
                        </el-form-item>
                        <el-form-item class="channel-wide" label="活动视频素材">
                          <el-switch
                            v-model="cfg.video.neowowAttachActivityVideo"
                            inline-prompt
                            active-text="开启"
                            inactive-text="关闭"
                          />
                        </el-form-item>
                        <el-form-item class="channel-wide" label="添加账号">
                          <div class="neowow-account-add-shell">
                            <el-radio-group v-model="neowowAccountAddMode" size="small" @change="onNeowowAccountAddModeChange">
                              <el-radio-button value="browser">网页登录</el-radio-button>
                              <el-radio-button value="token">Token 导入</el-radio-button>
                            </el-radio-group>
                            <div :class="['neowow-account-add', { 'is-token': neowowAccountAddMode === 'token' }]">
                              <el-input v-model="neowowAccountName" maxlength="60" clearable autocomplete="off" placeholder="账号备注名（可选）" @keyup.enter="neowowAccountAddMode === 'token' ? saveNeowowTokenAccount() : loginNeowow()" />
                              <template v-if="neowowAccountAddMode === 'token'">
                                <el-input v-model="neowowAccountToken" type="password" show-password clearable autocomplete="off" placeholder="粘贴完整 Neowow Token" @keyup.enter="saveNeowowTokenAccount()" />
                                <el-button type="primary" :loading="testing.neowow" :disabled="!String(neowowAccountToken || '').trim()" @click="saveNeowowTokenAccount()">
                                  <AppIcon name="key-round" /><span>{{ neowowTokenAccountId ? '更新 Token' : '添加 Token 账号' }}</span>
                                </el-button>
                              </template>
                              <el-button v-else type="primary" :loading="testing.neowow" @click="loginNeowow()">
                                <AppIcon name="user" /><span>添加网页登录账号</span>
                              </el-button>
                            </div>
                          </div>
                        </el-form-item>
                      </div>
                      <el-table :data="cfg.video.neowowAccounts" size="small" class="neowow-account-table" empty-text="还没有 Neowow 账号">
                        <el-table-column label="账号" min-width="150">
                          <template #default="{ row }">
                            <div class="neowow-account-name">
                              <strong>{{ row.name || 'Neowow 账号' }}</strong>
                              <el-tag v-if="row.id === cfg.video.neowowAccountId" size="small" type="success">默认</el-tag>
                              <el-tag size="small" effect="plain" type="info">{{ row.authMethod === 'token' ? 'Token' : '网页' }}</el-tag>
                            </div>
                          </template>
                        </el-table-column>
                        <el-table-column label="用户 ID" min-width="145">
                          <template #default="{ row }"><span class="neowow-user-id">{{ row.userId || '--' }}</span></template>
                        </el-table-column>
                        <el-table-column label="积分" width="100" align="right">
                          <template #default="{ row }"><strong>{{ row.points == null ? '--' : Number(row.points).toLocaleString('zh-CN') }}</strong></template>
                        </el-table-column>
                        <el-table-column label="状态" width="105">
                          <template #default="{ row }">
                            <el-tag size="small" :type="row.status === 'ready' ? 'success' : (row.status === 'logging_in' ? 'warning' : (row.status === 'error' || row.status === 'expired' ? 'danger' : 'info'))">
                              {{ row.status === 'ready' ? '可用' : (row.status === 'logging_in' ? '登录中' : (row.status === 'expired' ? '已失效' : (row.status === 'error' ? '异常' : '未登录'))) }}
                            </el-tag>
                          </template>
                        </el-table-column>
                        <el-table-column label="积分刷新" min-width="150">
                          <template #default="{ row }">{{ row.pointsUpdatedAt ? row.pointsUpdatedAt.replace('T', ' ').slice(0, 19) : '--' }}</template>
                        </el-table-column>
                        <el-table-column label="自动分配" width="90" align="center">
                          <template #default="{ row }"><el-switch v-model="row.enabled" :disabled="testing.neowow" @change="toggleNeowowAccount(row)" /></template>
                        </el-table-column>
                        <el-table-column label="操作" width="380" fixed="right">
                          <template #default="{ row }">
                            <div class="neowow-account-actions">
                              <el-button size="small" :title="row.id === cfg.video.neowowAccountId ? '当前默认账号' : '设为默认账号'" :disabled="testing.neowow || row.id === cfg.video.neowowAccountId" @click="selectNeowowAccount(row.id)"><AppIcon name="check" /><span>默认</span></el-button>
                              <el-button size="small" title="刷新积分" :disabled="testing.neowow || !row.hasToken" @click="refreshNeowowAccount(row.id)"><AppIcon name="refresh-cw" /><span>刷新</span></el-button>
                              <el-button v-if="row.authMethod === 'token'" size="small" title="更新 Token" :disabled="testing.neowow" @click="editNeowowTokenAccount(row)"><AppIcon name="key-round" /><span>更新 Token</span></el-button>
                              <el-button v-else size="small" :title="row.hasToken ? '重新登录账号' : '登录账号'" :disabled="testing.neowow" @click="loginNeowow(row.id)"><AppIcon name="user" /><span>{{ row.hasToken ? '重新登录' : '登录' }}</span></el-button>
                              <el-button size="small" type="danger" plain :title="row.authMethod === 'token' ? '停用 Token' : '退出账号'" :disabled="testing.neowow || !row.hasToken" @click="logoutNeowow(row.id)"><AppIcon name="power" /><span>{{ row.authMethod === 'token' ? '停用' : '退出' }}</span></el-button>
                              <el-button size="small" text type="danger" :disabled="testing.neowow" title="移除账号；有未完成视频时会被阻止" @click="deleteNeowowAccount(row.id)"><AppIcon name="trash-2" /></el-button>
                            </div>
                          </template>
                        </el-table-column>
                      </el-table>
                      <div class="inline-actions neowow-capabilities">
                        <el-tag v-if="testResult.neowow && !testResult.neowow.ok" size="small" type="danger">{{ testResult.neowow.error || '操作失败' }}</el-tag>
                        <el-tag size="small" effect="plain">4-15 秒</el-tag><el-tag size="small" effect="plain">图片 9</el-tag><el-tag size="small" effect="plain">视频 3</el-tag><el-tag size="small" effect="plain">音频 3</el-tag>
                      </div>
                    </template>

                    <template v-else>
                      <div class="video-provider-panel-head">
                        <div><strong>视频 API 多渠道</strong><span>各渠道独立保存 Key，提交失败时按顺序自动切换</span></div>
                        <div class="inline-actions">
                          <el-button size="small" type="primary" @click="addVideoApiChannel"><AppIcon name="plus" /><span>添加渠道</span></el-button>
                        </div>
                      </div>
                      <div class="channel-routing-bar compact">
                        <el-form-item label="主渠道"><el-select v-model="cfg.video.apiActiveChannelId" @change="syncVideoApiChannelFallbacks" style="width:220px"><el-option v-for="item in cfg.video.apiChannels.filter(item => item.enabled)" :key="item.id" :label="isBuiltInVideoApiChannel(item) ? (isSecondBuiltInVideoApiChannel(item) ? '内置视频渠道2' : '内置视频渠道1') : item.name" :value="item.id" /></el-select></el-form-item>
                        <section class="channel-routing-switch"><div><strong>自动切换</strong><small>失败后切到第二、第三渠道</small></div><el-switch v-model="cfg.video.apiAutoFallback" /></section>
                        <el-form-item label="单渠道重试"><el-input-number v-model="cfg.video.apiRetryCount" :min="0" :max="3" /></el-form-item>
                      </div>
                      <div class="channel-list">
                        <article
                          v-for="(channel, index) in cfg.video.apiChannels"
                          :key="channel.id"
                          :class="['channel-list-row', { 'is-primary': channel.id === cfg.video.apiActiveChannelId, 'is-off': channel.enabled === false }]"
                          @click="openVideoApiChannelDrawer(channel)"
                        >
                          <span class="channel-list-index">{{ index + 1 }}</span>
                          <div class="channel-list-main">
                            <strong>{{ isBuiltInVideoApiChannel(channel) ? (isSecondBuiltInVideoApiChannel(channel) ? '内置视频渠道2' : '内置视频渠道1') : (channel.name || ('视频 API 渠道 ' + (index + 1))) }}</strong>
                            <small>{{ channel.apiModel || '未设置模型' }} · {{ channel.apiBaseUrl || '未设置地址' }}</small>
                          </div>
                          <div class="channel-list-tags">
                            <el-tag v-if="channel.id === cfg.video.apiActiveChannelId" size="small" type="success" effect="plain">主渠道</el-tag>
                            <el-tag v-if="channel.enabled === false" size="small" type="info" effect="plain">已停用</el-tag>
                            <el-tag v-else-if="channel.apiKey" size="small" effect="plain">已配置</el-tag>
                            <el-tag v-else size="small" type="warning" effect="plain">缺 Key</el-tag>
                          </div>
                          <div class="channel-list-actions" @click.stop>
                            <el-button size="small" @click="openVideoApiChannelDrawer(channel)"><AppIcon name="pencil" /><span>编辑</span></el-button>
                            <el-switch v-model="channel.enabled" size="small" @change="syncVideoApiChannelFallbacks" />
                            <el-button size="small" type="danger" plain :disabled="cfg.video.apiChannels.length <= 1" @click="deleteVideoApiChannel(channel)"><AppIcon name="trash-2" /></el-button>
                          </div>
                        </article>
                      </div>
                      <el-drawer
                        :model-value="!!videoApiChannelDrawerId"
                        :title="videoApiChannelDrawerChannel ? (isBuiltInVideoApiChannel(videoApiChannelDrawerChannel) ? (isSecondBuiltInVideoApiChannel(videoApiChannelDrawerChannel) ? '内置视频渠道2' : '内置视频渠道1') : (videoApiChannelDrawerChannel.name || '视频 API 渠道')) : '视频 API 渠道'"
                        size="560px"
                        append-to-body
                        @update:model-value="closeVideoApiChannelDrawer"
                      >
                        <div v-if="videoApiChannelDrawerChannel" class="channel-drawer-body">
                          <div class="channel-drawer-actions">
                            <el-button size="small" type="primary" :disabled="videoApiChannelDrawerChannel.id === cfg.video.apiActiveChannelId" @click="cfg.video.apiActiveChannelId = videoApiChannelDrawerChannel.id; syncVideoApiChannelFallbacks()"><AppIcon name="check" /><span>设为主渠道</span></el-button>
                            <el-button size="small" :loading="testing.videoApi === videoApiChannelDrawerChannel.id" :disabled="!!testing.videoApi && testing.videoApi !== videoApiChannelDrawerChannel.id" @click="fetchVideoApiModels(videoApiChannelDrawerChannel)"><AppIcon name="refresh-cw" /><span>拉取模型</span></el-button>
                            <el-button size="small" type="danger" plain :disabled="cfg.video.apiChannels.length <= 1" @click="deleteVideoApiChannel(videoApiChannelDrawerChannel); closeVideoApiChannelDrawer()"><AppIcon name="trash-2" /><span>删除</span></el-button>
                          </div>
                          <el-form label-position="top" class="channel-profile-grid">
                            <el-form-item label="渠道名称"><el-input v-if="isBuiltInVideoApiChannel(videoApiChannelDrawerChannel)" :model-value="isSecondBuiltInVideoApiChannel(videoApiChannelDrawerChannel) ? '内置视频渠道2' : '内置视频渠道1'" disabled /><el-input v-else v-model="videoApiChannelDrawerChannel.name" /></el-form-item>
                            <el-form-item label="接口协议">
                              <el-select v-model="videoApiChannelDrawerChannel.apiProtocol" style="width:100%" @change="onVideoApiProtocolChange(videoApiChannelDrawerChannel)">
                                <el-option label="New API · /video/generations" value="newapi" />
                                <el-option label="飞拓跨界 · open/v1/video" value="feituo" />
                                <el-option label="OpenAI 兼容 · /videos" value="openai" />
                              </el-select>
                            </el-form-item>
                            <el-form-item label="当前模型"><el-select v-model="videoApiChannelDrawerChannel.apiModel" filterable allow-create default-first-option placeholder="选择或输入模型名称" style="width:100%" @change="onVideoApiModelChange(videoApiChannelDrawerChannel)"><el-option v-for="m in videoApiModelsForChannel(videoApiChannelDrawerChannel)" :key="m.value" :label="m.label" :value="m.value" /></el-select></el-form-item>
                            <el-form-item class="channel-wide" label="Base URL"><el-input v-model="videoApiChannelDrawerChannel.apiBaseUrl" :placeholder="videoApiChannelDrawerChannel.apiProtocol === 'newapi' ? 'https://你的服务地址/v1' : 'https://.../v1'" @input="onVideoApiBaseUrlInput(videoApiChannelDrawerChannel)" /></el-form-item>
                            <el-form-item class="channel-wide" label="模型库">
                              <el-select v-model="videoApiChannelDrawerChannel.apiModels" multiple filterable allow-create default-first-option placeholder="输入模型名称后按回车，可添加多个" style="width:100%" @change="onVideoApiModelsChange(videoApiChannelDrawerChannel)">
                                <el-option v-for="name in videoApiChannelDrawerChannel.apiModels" :key="name" :label="name" :value="name" />
                              </el-select>
                              <small class="hint">模型库仅属于当前渠道；可自动拉取，也可手动输入模型名称。</small>
                            </el-form-item>
                            <el-form-item class="channel-wide" label="API Key"><el-input v-model="videoApiChannelDrawerChannel.apiKey" type="password" show-password placeholder="每条渠道独立保存；已保存密钥会脱敏显示" /></el-form-item>
                            <el-form-item label="估算价格 / 秒"><el-input-number v-model="videoApiChannelDrawerChannel.pricePerSecond" :min="0" :step="0.1" :precision="4" /></el-form-item>
                          </el-form>
                        </div>
                      </el-drawer>
                    </template>
                  </div>

                  <div class="video-common-settings">
                    <el-form-item v-if="cfg.video.provider !== 'dreamina-agent'" label="默认比例">
                      <el-select v-model="cfg.video.aspectRatio" style="width:160px">
                        <el-option label="16:9" value="16:9" />
                        <el-option label="9:16" value="9:16" />
                        <el-option label="4:3" value="4:3" />
                        <el-option label="3:4" value="3:4" />
                        <el-option label="1:1" value="1:1" />
                      </el-select>
                    </el-form-item>
                    <el-form-item v-if="cfg.video.provider !== 'dreamina-agent'" label="默认清晰度">
                      <el-select v-model="cfg.video.resolution" style="width:160px">
                        <el-option v-for="r in settingsVideoResolutionOptions" :key="r.value" :label="r.label" :value="r.value" />
                      </el-select>
                    </el-form-item>
                    <el-form-item v-if="cfg.video.provider !== 'dreamina-agent'" label="默认时长（秒）">
                      <el-input-number v-model="cfg.video.duration" :min="5" :max="500" :step="1" style="width:160px" @change="normalizeVideoDurationSettings" />
                      <small class="hint">默认 15 秒；可自定义 5-500 秒，并用于识别分镜时间范围。</small>
                    </el-form-item>
                    <el-form-item label="视频估算价格 / 秒">
                      <el-input-number v-model="cfg.video.pricePerSecond" :min="0" :step="0.1" :precision="4" style="width:200px" />
                      <small class="hint">用于成本中心按生成视频秒数估算费用。</small>
                    </el-form-item>
                    <el-form-item label="上游访问令牌（rolldek，用于视频对账找回）">
                      <el-input v-model="cfg.video.upstreamAccessToken" :placeholder="cfg.video.upstreamAccessToken === '__SET__' ? '已配置（输入新值可更换）' : '个人设置 → 访问令牌'" style="width:340px" show-password clearable />
                    </el-form-item>
                    <el-form-item label="上游用户 ID">
                      <el-input v-model="cfg.video.upstreamUserId" placeholder="new-api-user，如 821" style="width:200px" clearable />
                    </el-form-item>
                    <el-form-item label="飞拓会话 Cookie（用于账单对账）">
                      <el-input v-model="cfg.video.feituoLedgerCookie" :placeholder="cfg.video.feituoLedgerCookie === '__SET__' ? '已配置（输入新值可更换）' : '浏览器登录 feituokuajing.com 后 F12 → 网络 → 复制 Cookie'" style="width:340px" show-password clearable />
                      <small class="hint">仅用于拉取消费账本做对账；任务状态查询走 API Key，不需要这个。会话过期需重新复制。</small>
                    </el-form-item>
                    <el-form-item v-if="cfg.video.provider === 'video-api'" label="肖像保护绕过">
                      <el-switch v-model="cfg.video.portraitBypass" />
                      <small class="hint">提交前把参考图左右镜像拼接成对称图，破坏人脸识别匹配，绕过 Dreamina 等「只支持生成包含您自己的视频」审核；仅写实画风生效，肉眼基本无感。默认关。</small>
                    </el-form-item>
                  </div>
                </el-form>

                <template v-if="cfg.video.provider === 'xiaoyunque'">
                  <div class="settings-head video-provider-service-head"><div><div class="eyebrow">Accounts</div><h3>小云雀线路</h3></div></div>
                  <div class="inline-actions" style="margin-bottom:10px">
                    <el-button :loading="xiaoyunqueAccountLoading" @click="installXiaoyunqueCli"><AppIcon name="download" /><span>安装 CLI</span></el-button>
                    <el-button :loading="xiaoyunqueAccountLoading" @click="refreshXiaoyunqueCliStatus"><AppIcon name="search" /><span>检测 CLI</span></el-button>
                    <el-tag size="small" :type="xiaoyunqueCliStatus.installed ? 'success' : 'warning'">{{ xiaoyunqueCliStatus.message || '未检测' }}</el-tag>
                    <el-button @click="xiaoyunqueManualVisible = !xiaoyunqueManualVisible"><AppIcon name="key-round" /><span>粘贴 access key</span></el-button>
                    <el-button :loading="xiaoyunqueAccountLoading" @click="refreshXiaoyunqueAccounts"><AppIcon name="refresh-cw" /><span>刷新列表</span></el-button>
                  </div>
                  <div v-if="xiaoyunqueManualVisible" style="margin-bottom:12px">
                    <el-input v-model="xiaoyunqueManualText" type="textarea" :rows="4" resize="vertical"
                      placeholder="一行一个：可直接粘贴 access key，或 XYQ_ACCESS_KEY=xxx / access_key=xxx" />
                    <div class="inline-actions" style="margin-top:8px">
                      <el-button type="primary" size="small" :loading="xiaoyunqueAccountLoading" @click="addXiaoyunqueAccounts">导入</el-button>
                      <el-button size="small" text @click="xiaoyunqueManualVisible = false">取消</el-button>
                    </div>
                  </div>
                  <el-table :data="cfg.video.xiaoyunqueAccounts" size="small" style="width:100%">
                    <el-table-column prop="name" label="名称" />
                    <el-table-column prop="accessKeyMask" label="Access Key" width="170" />
                    <el-table-column prop="status" label="状态" width="90" />
                    <el-table-column label="操作" width="90">
                      <template #default="scope">
                        <el-button size="small" text type="danger" @click="deleteXiaoyunqueAccount(scope.row.id)">删除</el-button>
                      </template>
                    </el-table-column>
                    <template #empty>暂无线路，点上方按钮导入 access key</template>
                  </el-table>
                </template>

                <template v-else-if="cfg.video.provider === 'dreamina-cli'">
                  <div class="settings-head video-provider-service-head"><div><div class="eyebrow">CLI</div><h3>即梦 CLI 本机登录态</h3></div></div>
                  <div class="inline-actions" style="margin-bottom:10px">
                    <el-button :loading="dreaminaCliLoading" @click="installDreaminaCli"><AppIcon name="download" /><span>安装 CLI</span></el-button>
                    <el-button :loading="dreaminaCliLoading" @click="loginDreaminaCli"><AppIcon name="plus" /><span>登录 CLI</span></el-button>
                    <el-button :loading="dreaminaCliLoading" :disabled="!dreaminaCliStatus.authenticated" type="danger" plain @click="logoutDreaminaCli"><AppIcon name="power" /><span>退出账号</span></el-button>
                    <el-button :loading="dreaminaCliLoading" @click="refreshDreaminaCliStatus"><AppIcon name="search" /><span>检测 CLI</span></el-button>
                    <el-tag size="small" :type="dreaminaCliStatus.installed && dreaminaCliStatus.authenticated ? 'success' : 'warning'">{{ dreaminaCliStatus.message || '未检测' }}</el-tag>
                    <el-tag v-if="dreaminaCliStatus.authenticated && dreaminaCliStatus.creditBalance !== null" class="dreamina-credit-tag" size="small" type="warning" effect="plain">
                      <span><AppIcon name="wallet" />剩余积分 {{ dreaminaCliStatus.creditBalance }}</span>
                    </el-tag>
                  </div>
                </template>

                <template v-else-if="cfg.video.provider === 'dreamina-agent'">
                  <div class="settings-head video-provider-service-head"><div><div class="eyebrow">Agent</div><h3>即梦官网账号</h3></div></div>
                  <section class="agent-browser-mode">
                    <div>
                      <strong>后台无窗口运行</strong>
                      <small>开启后生成、排队和自动下载不会显示 Edge 窗口；手动登录时仍会临时打开官网。</small>
                    </div>
                    <el-switch v-model="cfg.video.dreaminaAgentHeadless" aria-label="即梦 Agent 后台无窗口运行" />
                  </section>
                  <div class="agent-session-control">
                    <label for="dreamina-agent-account-name">添加账号</label>
                    <div class="inline-actions">
                      <el-input
                        id="dreamina-agent-account-name"
                        v-model="cfg.video.dreaminaAgentAccountName"
                        autocomplete="off"
                        placeholder="账号名称（可选）"
                        style="width:180px"
                      />
                      <el-input
                        id="dreamina-agent-session-id"
                        v-model="cfg.video.dreaminaAgentSessionId"
                        type="password"
                        show-password
                        autocomplete="off"
                        placeholder="粘贴即梦官网 sessionid"
                        style="width:min(360px, 100%)"
                      />
                      <el-button type="primary" :loading="dreaminaAgentLoading" :disabled="!String(cfg.video.dreaminaAgentSessionId || '').trim()" @click="addDreaminaAgentSessionAccount">
                        <AppIcon name="plus" /><span>添加 SID 账号</span>
                      </el-button>
                      <el-button :loading="dreaminaAgentLoading" @click="addDreaminaAgentBrowserAccount">
                        <AppIcon name="plus" /><span>添加网页登录账号</span>
                      </el-button>
                    </div>
                  </div>
                  <el-table :data="cfg.video.dreaminaAgentAccounts" size="small" class="dreamina-agent-account-table" style="width:100%">
                    <el-table-column label="账号" min-width="150">
                      <template #default="{ row }">
                        <div class="dreamina-agent-account-name">
                          <strong>{{ row.name || row.id }}</strong>
                          <el-tag v-if="row.id === cfg.video.dreaminaAgentAccountId" size="small" type="success">当前</el-tag>
                        </div>
                      </template>
                    </el-table-column>
                    <el-table-column label="Session ID" min-width="140">
                      <template #default="{ row }">{{ row.sessionIdMask || (row.hasSessionId ? '已保存' : '网页登录') }}</template>
                    </el-table-column>
                    <el-table-column label="状态" min-width="180">
                      <template #default="{ row }">
                        <el-tag v-if="dreaminaAgentStatus.accountId === row.id" size="small" :type="dreaminaAgentStatus.authenticated ? 'success' : 'warning'">
                          {{ dreaminaAgentStatus.message || '未检测' }}
                        </el-tag>
                        <span v-else class="muted">{{ row.authenticated ? '已登录' : '未检测' }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="操作" min-width="270" align="right">
                      <template #default="{ row }">
                        <div class="inline-actions dreamina-agent-account-actions">
                          <el-button size="small" :type="row.id === cfg.video.dreaminaAgentAccountId ? 'primary' : 'default'" :disabled="row.id === cfg.video.dreaminaAgentAccountId" @click="selectDreaminaAgentAccount(row.id)">
                            <AppIcon name="check" /><span>选用</span>
                          </el-button>
                          <el-button size="small" :loading="dreaminaAgentLoading" @click="loginDreaminaAgent(row.id)"><AppIcon name="link" /><span>网页登录</span></el-button>
                          <el-button size="small" :loading="dreaminaAgentLoading" @click="refreshDreaminaAgentStatus(row.id)"><AppIcon name="search" /><span>检测</span></el-button>
                          <el-button size="small" type="danger" plain :disabled="cfg.video.dreaminaAgentAccounts.length <= 1" @click="deleteDreaminaAgentAccount(row.id)"><AppIcon name="trash-2" /><span>移除</span></el-button>
                        </div>
                      </template>
                    </el-table-column>
                  </el-table>
                  <div class="inline-actions" style="margin-top:10px">
                    <el-button :loading="dreaminaAgentLoading" :disabled="!String(cfg.video.dreaminaAgentSessionId || '').trim() || !cfg.video.dreaminaAgentAccountId" @click="applyDreaminaAgentSession(cfg.video.dreaminaAgentAccountId)">
                      <AppIcon name="key-round" /><span>用上方 SID 替换当前账号</span>
                    </el-button>
                    <el-tag v-if="dreaminaAgentStatus.accountId" size="small" :type="dreaminaAgentStatus.authenticated ? 'success' : 'warning'">{{ dreaminaAgentStatus.message || '未检测' }}</el-tag>
                  </div>
                </template>

                <template v-else-if="cfg.video.provider === 'libtv-cli'">
                  <div class="settings-head video-provider-service-head"><div><div class="eyebrow">CLI</div><h3>LibTV CLI 本机登录态</h3></div></div>
                  <div class="inline-actions" style="margin-bottom:10px">
                    <el-button :loading="libtvCliLoading" @click="installLibtvCli"><AppIcon name="download" /><span>安装 / 更新</span></el-button>
                    <el-button :loading="libtvCliLoading" @click="loginLibtvCli"><AppIcon name="plus" /><span>登录 CLI</span></el-button>
                    <el-button :loading="libtvCliLoading" :disabled="!libtvCliStatus.authenticated" type="danger" plain @click="logoutLibtvCli"><AppIcon name="power" /><span>退出账号</span></el-button>
                    <el-button :loading="libtvCliLoading" @click="refreshLibtvCliStatus"><AppIcon name="search" /><span>检测 CLI</span></el-button>
                    <el-button :loading="libtvCliLoading" @click="checkLibtvCliUpdate"><AppIcon name="refresh-cw" /><span>检查更新</span></el-button>
                    <el-tag size="small" :type="libtvCliStatus.installed && libtvCliStatus.authenticated ? 'success' : 'warning'">{{ libtvCliStatus.message || '未检测' }}</el-tag>
                  </div>
                </template>

                <div class="settings-head" style="margin-top:32px"><div><div class="eyebrow">Jianying</div><h3>剪映草稿目录</h3></div></div>
                <el-form label-position="top">
                  <el-form-item label="草稿目录路径">
                    <div style="display:flex;gap:8px;align-items:center">
                      <el-input v-model="cfg.jianying.draftDir" placeholder="留空则自动检测" style="flex:1" />
                      <el-button @click="detectJianyingDir" :loading="detectingJianyingDir"><AppIcon name="search" /><span>自动检测</span></el-button>
                    </div>
                    <div style="font-size:12px;color:var(--muted);margin-top:6px">
                      检测路径：%LOCALAPPDATA%剪映专业版User DataProjectscom.lveditor.draft
                    </div>
                  </el-form-item>
                </el-form>
              </template>

              <template v-if="settingsSection === 'promptLibrary'">
                <div class="plib-hero">
                  <div>
                    <div class="eyebrow">Prompt Library</div>
                    <h2>提示词库</h2>
                    <p>管理全局提示词。新增或导入后，把条目设为当前项目使用，生成时才会走自定义提示词。</p>
                  </div>
                  <div class="plib-current">
                    <span :class="['prompt-status-chip', { 'is-custom': isCustomScriptPromptMode }]">
                      <AppIcon name="pen-line" />
                      <span>
                        <b>剧本</b>
                        <em>{{ scriptPromptStatusText }}</em>
                      </span>
                    </span>
                    <span :class="['prompt-status-chip', { 'is-custom': isCustomStoryboardPromptMode }]">
                      <AppIcon name="video" />
                      <span>
                        <b>分镜</b>
                        <em>{{ storyboardPromptStatusText }}</em>
                      </span>
                    </span>
                  </div>
                </div>
                <div class="plib">
                  <aside class="plib-aside">
                    <div class="plib-aside-head">
                      <strong>类型</strong>
                      <span v-if="settingsPromptList.length">{{ settingsPromptList.length }} 条</span>
                    </div>
                    <div class="plib-kind-switch">
                      <el-radio-group v-model="settingsPromptKind" size="small" @change="onSettingsPromptKindChange">
                        <el-radio-button label="script">剧本</el-radio-button>
                        <el-radio-button label="storyboard">分镜</el-radio-button>
                      </el-radio-group>
                    </div>
                    <div class="plib-actions">
                      <el-button size="small" type="primary" @click="addCustomPrompt(settingsPromptKind)"><AppIcon name="plus" /><span>新增</span></el-button>
                      <el-button size="small" @click="$refs.settingsPromptImportInput.click()"><AppIcon name="upload" /><span>导入</span></el-button>
                      <input ref="settingsPromptImportInput" type="file" accept=".txt,text/plain" multiple hidden @change="importCustomPromptFiles(settingsPromptKind, $event)" />
                    </div>
                    <div class="plib-list">
                      <div
                        v-for="item in settingsPromptList"
                        :key="item.id"
                        class="plib-item"
                        :class="{
                          'is-active': item.id === settingsSelectedPromptId,
                          'is-used': settingsPromptKind === 'script'
                            ? (scriptState.settings.scriptPromptMode === 'custom' && scriptState.settings.selectedScriptPromptId === item.id)
                            : (scriptState.settings.storyboardPromptMode === 'custom' && scriptState.settings.selectedStoryboardPromptId === item.id)
                        }"
                        @click="selectSettingsPrompt(item.id)"
                      >
                        <AppIcon name="file-text" />
                        <span class="plib-item-name">{{ item.name || '未命名' }}</span>
                        <small v-if="settingsPromptKind === 'script'
                            ? (scriptState.settings.scriptPromptMode === 'custom' && scriptState.settings.selectedScriptPromptId === item.id)
                            : (scriptState.settings.storyboardPromptMode === 'custom' && scriptState.settings.selectedStoryboardPromptId === item.id)">使用中</small>
                      </div>
                      <div v-if="!settingsPromptList.length" class="plib-empty plib-empty-list">
                        <AppIcon name="file-plus" />
                        <strong>暂无提示词</strong>
                        <p>新建空白提示词，或导入已有 TXT 文件。</p>
                        <div class="plib-empty-actions">
                          <el-button size="small" type="primary" @click="addCustomPrompt(settingsPromptKind)"><AppIcon name="plus" /><span>新增</span></el-button>
                          <el-button size="small" @click="$refs.settingsPromptImportInput.click()"><AppIcon name="upload" /><span>导入</span></el-button>
                        </div>
                      </div>
                    </div>
                  </aside>
                  <div class="plib-main">
                    <template v-if="settingsSelectedPrompt">
                      <div class="plib-editor-head">
                        <div>
                          <div class="eyebrow">{{ settingsPromptKind === 'script' ? 'Script Prompt' : 'Storyboard Prompt' }}</div>
                          <h3>{{ settingsSelectedPrompt.name || '未命名提示词' }}</h3>
                        </div>
                        <el-button size="small" type="danger" plain @click="deleteCustomPrompt(settingsPromptKind)"><AppIcon name="trash-2" /><span>删除</span></el-button>
                      </div>
                      <div class="plib-editor-grid">
                        <el-form label-position="top">
                          <el-form-item label="名称">
                            <el-input v-model="settingsSelectedPrompt.name" placeholder="提示词名称" @input="onSettingsPromptEdit" />
                          </el-form-item>
                        </el-form>
                        <div :class="['plib-usage', { 'is-active': settingsSelectedPromptActive }]">
                          <div>
                            <strong>{{ settingsSelectedPromptActive ? '当前使用中' : '未用于当前项目' }}</strong>
                            <span>{{ settingsPromptUsageText }}</span>
                          </div>
                          <div class="inline-actions">
                            <el-button
                              v-if="project"
                              size="small"
                              type="primary"
                              :disabled="settingsSelectedPromptActive"
                              @click="activateCustomPrompt(settingsPromptKind, settingsSelectedPrompt.id)"
                            ><AppIcon name="check" /><span>设为当前使用</span></el-button>
                            <el-button
                              v-if="project && settingsSelectedPromptActive"
                              size="small"
                              @click="useBuiltinPrompt(settingsPromptKind)"
                            ><AppIcon name="wand-sparkles" /><span>切回内置</span></el-button>
                          </div>
                        </div>
                      </div>
                      <el-input
                        class="plib-editor-textarea"
                        v-model="settingsSelectedPrompt.content"
                        type="textarea"
                        :autosize="{ minRows: 14, maxRows: 28 }"
                        placeholder="在此填写提示词内容"
                        @input="onSettingsPromptEdit"
                      />
                    </template>
                    <div v-else class="plib-empty">
                      <AppIcon name="ticket" />
                      <strong>选择提示词开始编辑</strong>
                      <p>也可以直接新建一条 {{ settingsPromptKind === 'script' ? '剧本' : '分镜' }} 提示词。</p>
                      <el-button type="primary" @click="addCustomPrompt(settingsPromptKind)"><AppIcon name="plus" /><span>新增提示词</span></el-button>
                    </div>
                  </div>
                </div>
              </template>
              <template v-if="settingsSection === 'gateway'">
                <div class="settings-head"><div><div class="eyebrow">Gateway</div><h2>模型网关 &amp; 卡密</h2></div></div>
                <p class="settings-hint">文本 / 图片 / 视频默认经此网关（new-api，OpenAI 兼容）提供，开箱即用；内置渠道的 Base URL 与 API Key 已经指向这里。</p>
                <section class="settings-card">
                  <h3>模型网关（new-api）</h3>
                  <el-form label-width="120px">
                    <el-form-item label="网关地址">
                      <el-input v-model="cfg.gateway.baseUrl" placeholder="https://api.xiaoyxiao.xyz" clearable />
                    </el-form-item>
                  </el-form>
                </section>
                <section class="settings-card">
                  <h3>卡密购买 &amp; 兑换</h3>
                  <p class="settings-hint">购买卡密后打开网关站并登录，在控制台的「充值 / 兑换」页粘贴卡密即可到账。内置渠道消耗的就是这个账户的余额，应用内无需填写任何令牌。</p>
                  <p class="settings-hint">
                    <a href="https://wzyp.cn/shop/35TCHF9A" target="_blank" rel="noopener">① 购买卡密 →</a>
                    &nbsp;&nbsp;&nbsp;
                    <a :href="cfg.gateway.baseUrl || 'https://api.xiaoyxiao.xyz'" target="_blank" rel="noopener">② 打开网关充值页 →</a>
                  </p>
                </section>
              </template>
              </div>
              </div>
              <div class="settings-save"><el-button type="primary" :loading="saving || settingsAutosave.saving" @click="onSaveSettingsClick"><AppIcon name="check" /><span>保存设置</span></el-button><span :class="['settings-autosave-status', { 'is-error': settingsAutosave.error }]">{{ autosaveStatusText }}</span></div>
            </section>
          </section>
        </template>`;
