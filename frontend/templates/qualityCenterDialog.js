export const qualityCenterDialog = /* html */ `
  <el-dialog v-model="quality.visible" width="min(1120px, 95vw)" class="quality-dialog" destroy-on-close align-center>
    <template #header>
      <div class="quality-dialog-title">
        <div class="quality-dialog-icon"><AppIcon name="circle-check" /></div>
        <div><div class="eyebrow">Project Quality Center</div><h2>项目质检中心</h2><p>{{ project?.name || '' }} · 确定性检查，不额外消耗模型额度</p></div>
      </div>
    </template>

    <div class="quality-dialog-body" v-loading="quality.loading">
      <div class="quality-summary-grid">
        <section class="quality-summary-card is-total"><span>全部问题</span><strong>{{ quality.report?.summary?.total || 0 }}</strong><small>检查于 {{ formatQualityTime(quality.report?.generatedAt) }}</small></section>
        <section class="quality-summary-card is-error"><span>错误</span><strong>{{ quality.report?.summary?.error || 0 }}</strong><small>会阻断或破坏后续流程</small></section>
        <section class="quality-summary-card is-warning"><span>警告</span><strong>{{ quality.report?.summary?.warning || 0 }}</strong><small>建议在出片前处理</small></section>
        <section class="quality-summary-card is-info"><span>提示</span><strong>{{ quality.report?.summary?.info || 0 }}</strong><small>可继续完善的项目项</small></section>
      </div>

      <section class="quality-storage-card">
        <div class="quality-storage-main">
          <span :class="['quality-storage-dot', { ok: qualityStorageStatus?.consistent }]"></span>
          <div>
            <strong>{{ qualityStorageStatus?.consistent ? '数据存储一致' : '数据存储需要修复' }}</strong>
            <p>Schema V{{ qualityStorageStatus?.schemaVersion || 1 }} · Revision {{ qualityStorageStatus?.revision || 0 }} · {{ qualityStorageStatus?.legacy ? '旧版项目' : '事务化存储' }}</p>
          </div>
        </div>
        <div class="quality-auto-fixes">
          <el-button v-for="action in qualityFixActions" :key="action" size="small" :type="action === 'repair-storage' ? 'danger' : 'primary'" plain :loading="quality.fixing === action" :disabled="!!quality.fixing" @click="fixQualityIssue(action)">{{ qualityActionLabel(action) }}</el-button>
        </div>
      </section>

      <div class="quality-toolbar">
        <div class="quality-filter-group">
          <el-radio-group v-model="quality.severity" size="small">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="error">错误 {{ quality.report?.summary?.error || 0 }}</el-radio-button>
            <el-radio-button value="warning">警告 {{ quality.report?.summary?.warning || 0 }}</el-radio-button>
            <el-radio-button value="info">提示 {{ quality.report?.summary?.info || 0 }}</el-radio-button>
          </el-radio-group>
          <el-select v-model="quality.category" size="small" style="width:150px">
            <el-option label="全部模块" value="all" />
            <el-option v-for="item in qualityCategories" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>
        <el-button size="small" :loading="quality.loading" @click="loadQualityReport"><AppIcon name="refresh-cw" /><span>重新质检</span></el-button>
      </div>

      <div v-if="pagedQualityIssues.length" class="quality-issue-list">
        <article v-for="issue in pagedQualityIssues" :key="issue.id" :class="['quality-issue', 'is-' + issue.severity]">
          <div class="quality-issue-mark"><el-icon><CircleCloseFilled v-if="issue.severity === 'error'" /><WarningFilled v-else-if="issue.severity === 'warning'" /><InfoFilled v-else /></el-icon></div>
          <div class="quality-issue-copy">
            <div class="quality-issue-title"><strong>{{ qualityIssueTitle(issue) }}</strong><el-tag size="small" effect="plain" :type="qualitySeverityType(issue.severity)">{{ qualitySeverityLabel(issue.severity) }}</el-tag><el-tag size="small" effect="plain">{{ qualityCategoryLabel(issue.category) }}</el-tag></div>
            <p>{{ qualityIssueDetail(issue) || '请检查对应模块。' }}</p>
            <small>{{ issue.code }}</small>
          </div>
          <el-button v-if="issue.action" size="small" :type="issue.severity === 'error' ? 'danger' : 'primary'" plain :loading="quality.fixing === issue.action" :disabled="!!quality.fixing && quality.fixing !== issue.action" @click="navigateQualityIssue(issue)">{{ qualityActionLabel(issue.action) }}</el-button>
        </article>
      </div>
      <div v-else-if="quality.report" class="quality-perfect-state">
        <AppIcon name="circle-check" />
        <strong>{{ filteredQualityIssues.length ? '当前页没有问题' : '当前筛选下没有问题' }}</strong>
        <p v-if="quality.report.summary?.total === 0">项目已通过全部确定性检查。</p>
        <el-button v-else @click="quality.severity = 'all'; quality.category = 'all'">查看全部问题</el-button>
      </div>

      <div v-if="filteredQualityIssues.length > quality.pageSize" class="quality-pagination">
        <el-pagination v-model:current-page="quality.page" v-model:page-size="quality.pageSize" :page-sizes="[20, 30, 50]" :total="filteredQualityIssues.length" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>
    <template #footer>
      <div class="quality-dialog-footer"><span>剧本 {{ quality.report?.summary?.episodes || 0 }} 集 · 分镜 {{ quality.report?.summary?.storyboards || 0 }} 份 · 元素 {{ quality.report?.summary?.assets || 0 }} 项</span><el-button @click="quality.visible = false">关闭</el-button></div>
    </template>
  </el-dialog>`;
