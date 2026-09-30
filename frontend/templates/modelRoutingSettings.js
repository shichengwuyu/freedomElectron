export const modelRoutingSettings = /* html */ `
              <template v-if="settingsSection === 'text' && settingsTextTab === 'routing'">
                <p class="muted">为不同创作任务指定主模型和备用模型。主模型遇到限流、网络错误或服务端故障时，可按顺序自动重试并降级。</p>
                <div class="routing-switches">
                  <section class="system-setting-card">
                    <div><strong>启用多模型路由</strong><p>关闭时继续使用“文本模型”页的单一模型配置。</p></div>
                    <el-switch v-model="cfg.modelRouting.enabled" @change="syncModelRoutes" />
                  </section>
                  <section class="system-setting-card">
                    <div><strong>自动降级</strong><p>主模型失败后按备用顺序切换；流式正文已开始输出后不会切换。</p></div>
                    <el-switch v-model="cfg.modelRouting.autoFallback" :disabled="!cfg.modelRouting.enabled" />
                  </section>
                  <section class="system-setting-card routing-retry-card">
                    <div><strong>单模型重试次数</strong><p>对网络错误、429、408 和 5xx 使用指数退避。</p></div>
                    <el-input-number v-model="cfg.modelRouting.retryCount" :min="0" :max="3" :step="1" :disabled="!cfg.modelRouting.enabled" />
                  </section>
                </div>

                <div class="model-profile-list">
                  <article v-for="(profile, index) in cfg.modelRouting.profiles" :key="profile.id" class="model-profile-card">
                    <header class="model-profile-head">
                      <div class="model-profile-title">
                        <span class="model-profile-index">{{ index + 1 }}</span>
                        <div><strong>{{ profile.name || profile.model || '未命名模型' }}</strong><small>{{ profile.id }}</small></div>
                      </div>
                      <div class="model-profile-actions">
                        <el-switch v-model="profile.enabled" active-text="启用" @change="onModelProfileToggle(profile)" />
                        <el-button size="small" :loading="modelProfileDiscovering[profile.id]" @click="fetchModelProfileModels(profile, index)"><AppIcon name="refresh-cw" /><span>拉取模型</span></el-button>
                        <el-button size="small" :loading="modelProfileTesting[profile.id]" @click="testModelProfile(profile)"><AppIcon name="cable" /><span>测试</span></el-button>
                        <el-button size="small" @click="duplicateModelProfile(profile)"><AppIcon name="copy" /><span>复制</span></el-button>
                        <el-button size="small" type="danger" plain :disabled="cfg.modelRouting.profiles.length <= 1" @click="deleteModelProfile(profile)"><AppIcon name="trash-2" /><span>删除</span></el-button>
                      </div>
                    </header>
                    <div class="model-profile-grid">
                      <el-form-item label="Profile 名称"><el-input v-model="profile.name" placeholder="例如：主力 GPT / 备用 Claude" /></el-form-item>
                      <el-form-item label="模型名"><el-select v-model="profile.model" filterable allow-create default-first-option placeholder="选择或输入模型标识" style="width:100%" @change="syncTextModelFromPrimaryProfile(profile, index)"><el-option v-for="item in modelProfileModels(profile)" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
                      <el-form-item class="profile-base-url" label="Base URL"><el-input v-model="profile.baseUrl" placeholder="https://.../v1" @input="syncTextModelFromPrimaryProfile(profile, index)" /></el-form-item>
                      <el-form-item class="profile-api-key" label="API Key"><el-input v-model="profile.apiKey" type="password" show-password placeholder="sk-...；已保存密钥会脱敏显示" @input="syncTextModelFromPrimaryProfile(profile, index)" /></el-form-item>
                      <el-form-item label="Temperature"><el-input-number v-model="profile.temperature" :min="0" :max="2" :step="0.1" :precision="1" @change="syncTextModelFromPrimaryProfile(profile, index)" /></el-form-item>
                      <el-form-item label="最大输出 tokens"><el-input-number v-model="profile.maxTokens" :min="1" :max="1000000" :step="1000" @change="syncTextModelFromPrimaryProfile(profile, index)" /></el-form-item>
                      <el-form-item label="输入价格 / 百万 tokens"><el-input-number v-model="profile.inputPricePerMillion" :min="0" :step="0.1" :precision="4" /></el-form-item>
                      <el-form-item label="输出价格 / 百万 tokens"><el-input-number v-model="profile.outputPricePerMillion" :min="0" :step="0.1" :precision="4" /></el-form-item>
                    </div>
                    <el-alert
                      v-if="modelProfileTestResult[profile.id]"
                      :title="modelProfileTestResult[profile.id].message"
                      :type="modelProfileTestResult[profile.id].ok ? 'success' : 'error'"
                      :closable="false"
                      show-icon
                    />
                  </article>
                </div>

                <section class="routing-matrix" :class="{ 'is-disabled': !cfg.modelRouting.enabled }">
                  <div class="settings-head"><div><div class="eyebrow">Task Matrix</div><h3>任务路由矩阵</h3></div></div>
                  <div class="routing-table-head"><span>任务</span><span>主模型</span><span>备用模型顺序</span></div>
                  <article v-for="task in modelRoutingTasks" :key="task.key" class="routing-row">
                    <div class="routing-task"><strong>{{ task.label }}</strong><small>{{ task.hint }}</small></div>
                    <el-select v-model="cfg.modelRouting.routes[task.key]" :disabled="!cfg.modelRouting.enabled" @change="onModelRouteChange(task.key)">
                      <el-option v-for="profile in enabledModelProfiles" :key="profile.id" :label="profile.name + ' · ' + profile.model" :value="profile.id" />
                    </el-select>
                    <el-select v-model="cfg.modelRouting.fallbacks[task.key]" multiple collapse-tags collapse-tags-tooltip :disabled="!cfg.modelRouting.enabled || !cfg.modelRouting.autoFallback" placeholder="无备用模型">
                      <el-option v-for="profile in availableFallbackProfiles(task.key)" :key="profile.id" :label="profile.name + ' · ' + profile.model" :value="profile.id" />
                    </el-select>
                  </article>
                </section>
              </template>`;

export const costCenterSettings = /* html */ `
              <template v-if="settingsSection === 'cost'">
                <div class="settings-head cost-center-head">
                  <div><div class="eyebrow">Cost Center</div><h2>成本中心</h2></div>
                  <div class="inline-actions">
                    <el-button :loading="usage.loading" @click="loadCostCenter"><AppIcon name="refresh-cw" /><span>刷新</span></el-button>
                    <el-button type="danger" plain :loading="usage.clearing" @click="clearCostRecords"><AppIcon name="trash-2" /><span>清空记录</span></el-button>
                  </div>
                </div>
                <div class="cost-toolbar">
                  <el-radio-group v-model="usage.scope" size="small" @change="loadCostCenter">
                    <el-radio-button value="all">全部项目</el-radio-button>
                    <el-radio-button value="project" :disabled="!project">当前项目</el-radio-button>
                  </el-radio-group>
                  <el-select v-model="usage.days" size="small" style="width:130px" @change="loadCostCenter">
                    <el-option label="最近 7 天" :value="7" />
                    <el-option label="最近 30 天" :value="30" />
                    <el-option label="最近 90 天" :value="90" />
                    <el-option label="最近 365 天" :value="365" />
                  </el-select>
                  <span class="muted">文本成本按实际或估算 token 计费；图片按张、视频按秒计费。</span>
                </div>

                <div class="cost-kpi-grid" v-loading="usage.loading">
                  <section class="cost-kpi-card is-cost"><span>估算总成本</span><strong>{{ formatCost(usage.summary?.total?.cost) }}</strong><small>{{ usage.summary?.total?.records || 0 }} 次调用</small></section>
                  <section class="cost-kpi-card"><span>文本 Tokens</span><strong>{{ formatTokenCount((usage.summary?.total?.inputTokens || 0) + (usage.summary?.total?.outputTokens || 0)) }}</strong><small>输入 {{ formatTokenCount(usage.summary?.total?.inputTokens) }} · 输出 {{ formatTokenCount(usage.summary?.total?.outputTokens) }}</small></section>
                  <section class="cost-kpi-card"><span>图片生成</span><strong>{{ usage.summary?.total?.images || 0 }} 张</strong><small>按设置页单张价格估算</small></section>
                  <section class="cost-kpi-card"><span>视频生成</span><strong>{{ Number(usage.summary?.total?.videoSeconds || 0).toFixed(1) }} 秒</strong><small>按视频模型每秒价格估算</small></section>
                  <section class="cost-kpi-card is-failed"><span>失败调用</span><strong>{{ usage.summary?.total?.failed || 0 }}</strong><small>网络、限流和上游错误</small></section>
                </div>

                <section class="budget-card">
                  <div class="budget-card-head">
                    <div><div class="eyebrow">Monthly Budget</div><h3>月度预算</h3></div>
                    <div class="budget-fields">
                      <el-select v-model="cfg.costTracking.currency" style="width:110px"><el-option label="CNY" value="CNY" /><el-option label="USD" value="USD" /></el-select>
                      <el-input-number v-model="cfg.costTracking.monthlyBudget" :min="0" :step="100" :precision="2" style="width:190px" />
                    </div>
                  </div>
                  <template v-if="monthlyBudget > 0">
                    <div class="budget-copy"><span>当前统计周期已用 {{ formatCost(usage.summary?.total?.cost) }}</span><strong>{{ budgetUsageRate.toFixed(1) }}%</strong></div>
                    <el-progress :percentage="Math.min(100, budgetUsageRate)" :status="budgetProgressStatus" />
                    <el-alert v-if="budgetUsageRate >= 80" :title="budgetUsageRate >= 100 ? '预算已超支，请检查高成本模型和视频任务。' : '预算使用已超过 80%，请留意后续生成任务。'" :type="budgetUsageRate >= 100 ? 'error' : 'warning'" :closable="false" show-icon />
                  </template>
                  <p v-else class="muted">预算为 0 表示不设上限。成本中心只做统计和提醒，不会自动中止生成任务。</p>
                </section>

                <section class="cost-table-card">
                  <div class="settings-head"><div><div class="eyebrow">Breakdown</div><h3>按模型与任务汇总</h3></div></div>
                  <el-table :data="usage.summary?.groups || []" size="small" max-height="360" empty-text="暂无成本记录">
                    <el-table-column label="类型" width="78"><template #default="scope"><el-tag size="small" effect="plain">{{ usageKindLabel(scope.row.kind) }}</el-tag></template></el-table-column>
                    <el-table-column label="任务" min-width="110"><template #default="scope">{{ usageTaskLabel(scope.row.task) }}</template></el-table-column>
                    <el-table-column prop="model" label="模型" min-width="170" show-overflow-tooltip />
                    <el-table-column prop="requests" label="调用" width="72" />
                    <el-table-column label="输入 / 输出 Token" min-width="150"><template #default="scope">{{ formatTokenCount(scope.row.inputTokens) }} / {{ formatTokenCount(scope.row.outputTokens) }}</template></el-table-column>
                    <el-table-column label="成本" width="130" align="right"><template #default="scope"><strong>{{ formatCost(scope.row.cost) }}</strong></template></el-table-column>
                    <el-table-column prop="failed" label="失败" width="72" />
                  </el-table>
                </section>

                <section class="cost-table-card">
                  <div class="settings-head"><div><div class="eyebrow">Recent Calls</div><h3>最近调用记录</h3></div></div>
                  <el-table :data="usage.records" size="small" max-height="420" empty-text="暂无调用记录">
                    <el-table-column label="时间" width="170"><template #default="scope">{{ formatUsageTime(scope.row.createdAt) }}</template></el-table-column>
                    <el-table-column label="类型" width="78"><template #default="scope"><el-tag size="small" :type="scope.row.status === 'success' ? 'success' : 'danger'">{{ usageKindLabel(scope.row.kind) }}</el-tag></template></el-table-column>
                    <el-table-column label="任务" width="110"><template #default="scope">{{ usageTaskLabel(scope.row.task) }}</template></el-table-column>
                    <el-table-column label="模型" min-width="150" show-overflow-tooltip><template #default="scope">{{ scope.row.model || scope.row.profileName || scope.row.provider || '-' }}</template></el-table-column>
                    <el-table-column label="用量" min-width="150"><template #default="scope"><span v-if="scope.row.kind === 'text'">{{ formatTokenCount(scope.row.inputTokens) }} + {{ formatTokenCount(scope.row.outputTokens) }} tokens</span><span v-else-if="scope.row.kind === 'image'">{{ scope.row.units }} 张</span><span v-else>{{ Number(scope.row.seconds || 0).toFixed(1) }} 秒</span></template></el-table-column>
                    <el-table-column label="成本" width="130" align="right"><template #default="scope">{{ formatCost(scope.row.cost) }}</template></el-table-column>
                  </el-table>
                </section>
              </template>`;
