export const elementsDrawer = /* html */ `  <el-drawer v-model="elementsDrawer" :title="'选角与资产工坊' + (project ? ' · ' + project.name : '')" direction="rtl" size="min(1500px, 98vw)" class="elements-drawer" destroy-on-close>
    <div v-if="project" class="atelier">
      <!-- 顶部：分类大页签 + 搜索 + 新增 -->
      <header class="atelier-bar">
        <nav class="atelier-cats" aria-label="元素分类">
          <button v-for="c in ['character','group','scene','prop','effect','creature']" :key="c"
                  :class="['atelier-cat', { active: cat === c, updated: categoryJustUpdated(c) }]"
                  @click="selectCategory(c)">
            <span class="cat-dot" :class="c"></span>
            <b>{{ catLabel[c] }}</b>
            <i>{{ counts[c] }}</i>
          </button>
        </nav>
        <div class="atelier-bar-side">
          <el-input v-model="elementSearchQuery" class="element-search" placeholder="搜索元素名 / 别名 / 造型名" clearable>
            <template #prefix><AppIcon name="search" /></template>
          </el-input>
          <el-button @click="openCharacterLibrary"><AppIcon name="library" /><span>素材图库</span></el-button>
          <el-button :loading="library.matching" title="按元素类型和名称，从全局素材图库补齐缺失图片" @click="autoMatchLibraryImages"><AppIcon name="cable" /><span>一键匹配</span></el-button>
          <el-button type="primary" plain :loading="addingElement" @click="addElement"><AppIcon name="plus" /><span>新增{{ catLabel[cat] }}</span></el-button>
        </div>
      </header>

      <!-- 工具带：主提取动作 + 面板开关 + 批量出图 -->
      <div class="atelier-workrow">
        <div class="atelier-workrow-group">
          <el-button type="primary" :loading="extracting" :disabled="!sourceLen" @click="startExtractFromSource(false)">
            <AppIcon name="wand-sparkles" />
            <span>{{ extracting ? extractProgress : ((Array.isArray(extractCategory) && extractCategory.length) ? '提取' + extractCategory.map((c) => catLabel[c] || c).join('+') : (pendingExtractChapters.length ? '提取新增章节 (' + pendingExtractChapters.length + ')' : '从原文提取')) }}</span>
          </el-button>
          <span class="chip">原文 {{ sourceLen }} 字</span>
          <el-button size="small" text :loading="extracting" :disabled="!sourceLen" @click="startExtractFromSource(true)" title="忽略增量记录，按当前提取范围重提全部章节"><AppIcon name="rotate-cw" /><span>重提全部</span></el-button>
          <label class="extract-scope-control">
            <span>提取范围</span>
            <el-select v-model="extractCategory" size="small" :disabled="extracting" multiple collapse-tags collapse-tags-tooltip clearable placeholder="全部" aria-label="提取范围">
              <el-option v-for="item in extractionCategoryOptions.filter((o) => o.value !== 'all')" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
        </div>
        <div class="atelier-workrow-group atelier-toggles">
          <button :class="['atelier-toggle', { on: atelierPanel === 'paste' }]" @click="toggleAtelierPanel('paste')"><AppIcon name="file-text" /><span>粘贴提取</span></button>
          <button :class="['atelier-toggle', { on: atelierPanel === 'import' }]" @click="toggleAtelierPanel('import')"><AppIcon name="upload" /><span>批量导入</span></button>
          <button :class="['atelier-toggle', { on: atelierPanel === 'params' }]" @click="toggleAtelierPanel('params')"><AppIcon name="settings" /><span>出图参数</span></button>
          <button v-if="cat === 'character'" :class="['atelier-toggle', { on: atelierPanel === 'style' }]" @click="toggleAtelierPanel('style')"><AppIcon name="image" /><span>风格图</span></button>
        </div>
        <div class="atelier-workrow-group atelier-workrow-right">
          <el-button type="primary" :loading="batch.running" @click="runBatch(false)"><AppIcon name="wand-sparkles" /><span>批量生成</span></el-button>
          <el-button :loading="batch.running" @click="runBatch(true)"><AppIcon name="image" /><span>仅缺图</span></el-button>
          <el-button :type="selectionMode ? 'success' : ''" @click="toggleSelectionMode"><AppIcon name="check" /><span>{{ selectionMode ? '退出选择' : '选择' }}</span></el-button>
          <el-dropdown class="export-dropdown" trigger="click" @command="exportToFolder">
            <el-button :loading="exporting" title="导出图片到文件夹（可选分类）"><AppIcon name="folder-open" /><span>导出</span><AppIcon name="arrow-down" /></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="">全部分类</el-dropdown-item>
                <el-dropdown-item :command="cat" divided>当前分类 · {{ catLabel[cat] }}</el-dropdown-item>
                <el-dropdown-item v-for="c in ['character','group','scene','prop','effect','creature'].filter(c => c !== cat)" :key="'exp-' + c" :command="c">{{ catLabel[c] }}<template v-if="counts[c]"> ({{ counts[c] }})</template></el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button @click="openFolder" title="打开图片文件夹"><AppIcon name="folder" /></el-button>
          <el-dropdown class="export-dropdown" trigger="click" @command="exportZip">
            <el-button title="打包 ZIP 下载（可选分类）"><AppIcon name="download" /><span>ZIP</span><AppIcon name="arrow-down" /></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="">全部分类</el-dropdown-item>
                <el-dropdown-item :command="cat" divided>当前分类 · {{ catLabel[cat] }}</el-dropdown-item>
                <el-dropdown-item v-for="c in ['character','group','scene','prop','effect','creature'].filter(c => c !== cat)" :key="'zip-' + c" :command="c">{{ catLabel[c] }}<template v-if="counts[c]"> ({{ counts[c] }})</template></el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- 展开面板：粘贴提取 -->
      <section v-if="atelierPanel === 'paste'" class="atelier-panel" :class="{ extracting }">
        <div class="atelier-panel-grid">
          <div class="dropzone" :class="{ over: sourceExtractDragOver }" @dragover.prevent="sourceExtractDragOver = true" @dragleave.prevent="sourceExtractDragOver = false" @drop="onSourceExtractDrop" @click="$refs.sourceExtractInput.click()">
            <AppIcon name="upload" /><span>{{ extracting ? extractProgress : '拖入或点击选择原文 TXT' }}</span>
            <input ref="sourceExtractInput" type="file" accept=".txt,text/plain" multiple hidden @change="onPickSourceExtractFile" />
          </div>
          <div class="atelier-panel-main">
            <el-input v-model="sourceExtractText" type="textarea" :rows="5" resize="vertical" placeholder="粘贴小说/剧本文本，按上方提取范围分析人物、场景、道具或特效" />
            <div class="inline-actions">
              <el-button type="primary" :loading="extracting" :disabled="!sourceExtractText.trim()" @click="startExtract"><AppIcon name="wand-sparkles" /><span>{{ extracting ? '提取中' : '提取元素' }}</span></el-button>
              <el-button text :disabled="!sourceExtractText || extracting" @click="sourceExtractText = ''">清空</el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 展开面板：批量导入 -->
      <section v-if="atelierPanel === 'import'" class="atelier-panel" :class="{ extracting: elementImporting || elementImageImporting }">
        <div class="atelier-panel-grid">
          <div class="atelier-panel-side">
            <div class="dropzone mini" :class="{ over: dragOver }" @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false" @drop="onDrop" @click="$refs.quickExtractInput.click()">
              <AppIcon name="upload" /><span>{{ elementImporting ? elementImportProgress : '导入描述 TXT' }}</span>
              <input ref="quickExtractInput" type="file" accept=".txt,text/plain" multiple hidden @change="onPickFile" />
            </div>
            <el-button :loading="elementImageImporting" :disabled="elementImporting || elementImageImporting" @click="$refs.elementImageFolderInput.click()">
              <AppIcon name="folder-open" /><span>{{ elementImageImporting ? elementImageImportProgress : '导入图片文件夹' }}</span>
            </el-button>
            <input ref="elementImageFolderInput" type="file" accept="image/*" webkitdirectory directory multiple hidden @change="importElementImagesFromFolder" />
          </div>
          <div class="atelier-panel-main">
            <el-input v-model="novelText" type="textarea" :rows="5" resize="vertical" placeholder="可粘贴：林晚：黑长直、黑色礼服、清冷气质。也可用 [人物] [场景] [道具] 分段" />
            <div class="inline-actions">
              <el-button type="primary" :loading="elementImporting" :disabled="!novelText.trim()" @click="importElementsFromText"><AppIcon name="plus" /><span>{{ elementImporting ? '导入中' : '批量建卡' }}</span></el-button>
              <el-button text :disabled="!novelText || elementImporting" @click="novelText = ''">清空</el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 展开面板：出图参数 -->
      <section v-if="atelierPanel === 'params'" class="atelier-panel">
        <div class="atelier-params">
          <label class="atelier-param">
            <span>出图风格</span>
            <el-select v-model="projectStyle" size="small" @change="onProjectStyleChange">
              <el-option v-for="item in styleOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <label class="atelier-param">
            <span>图片比例</span>
            <el-select v-model="imageRatio" size="small">
              <el-option v-for="item in imageRatioOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <label v-if="imageRatio === 'custom'" class="atelier-param">
            <span>自定义比例</span>
            <el-input v-model="customImageRatio" size="small" placeholder="1:1" />
          </label>
          <label class="atelier-param">
            <span>人物出图模式</span>
            <el-select v-model="characterImageMode" size="small" @change="onCharacterImageModeChange">
              <el-option v-for="item in characterImageModeOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <label class="atelier-param">
            <span>批量范围</span>
            <el-select v-model="batchCategory" size="small" :disabled="batch.running">
              <el-option v-for="item in batchCategoryOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <div class="atelier-param atelier-param-danger">
            <span>危险操作</span>
            <div class="inline-actions">
              <el-button size="small" text type="danger" :disabled="!curList.length" @click="clearElements(cat)"><AppIcon name="trash-2" /><span>清空{{ catLabel[cat] }}</span></el-button>
              <el-button size="small" text type="danger" @click="clearElements(null)"><AppIcon name="trash-2" /><span>清空全部</span></el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 展开面板：全局风格图 -->
      <section v-if="atelierPanel === 'style' && cat === 'character'" class="atelier-panel">
        <div class="atelier-panel-grid">
          <div class="reference-preview uploadable-image atelier-style-preview" @dragover.prevent @drop="onGlobalReferenceDrop">
            <img v-if="project.hasGlobalReferenceImage && !project._globalRefBroken" :src="globalReferenceImgUrl()" @click="lightboxSrc = globalReferenceImgUrl()" />
            <div v-else class="image-placeholder"><AppIcon name="image" /><span>全局风格图</span></div>
          </div>
          <div class="atelier-panel-main">
            <p class="muted">上传一张风格参考图，出人物图时统一画风与质感。</p>
            <div class="inline-actions">
              <el-button size="small" @click="$event.currentTarget.nextElementSibling.click()" :loading="project._globalRefUploading"><AppIcon name="upload" /><span>上传</span></el-button>
              <input type="file" accept="image/*" hidden @change="onPickGlobalReference" />
              <el-button v-if="project.hasGlobalReferenceImage" size="small" type="danger" plain :loading="project._globalRefDeleting" @click="deleteGlobalReferenceImage"><AppIcon name="trash-2" /><span>删除</span></el-button>
              <el-switch v-model="project.useGlobalReferenceImage" :disabled="!project.hasGlobalReferenceImage" active-text="默认使用" />
            </div>
          </div>
        </div>
      </section>

      <!-- 状态条：提取进度 / 错误 / 批量进度 / 选择模式 -->
      <div v-if="extractProgressState.active || extracting" class="atelier-strip">
        <div class="script-progress-head">
          <span>{{ extractProgressState.detail || extractProgress || '正在提取元素…' }}</span>
          <small v-if="extractProgressState.total">{{ extractProgressState.current }} / {{ extractProgressState.total }}</small>
          <small v-else>{{ extractProgressState.percentage }}%</small>
        </div>
        <el-progress :percentage="extractProgressState.percentage" :status="extractProgressState.status || ''" :indeterminate="extractProgressState.indeterminate" />
      </div>
      <p v-else-if="pendingExtractChapters.length && !extracting" class="atelier-hint muted">将提取：{{ pendingExtractChapters.map(c=>c.title).join('、') }}</p>
      <el-alert v-if="extractErrors.length" type="warning" :closable="false" title="部分片段提取失败">
        <div v-for="(e,i) in extractErrors" :key="i">{{ e }}</div>
      </el-alert>
      <div v-if="batch.running || batch.total" class="atelier-strip">
        <div class="script-progress-head">
          <span>批量出图</span>
          <small>{{ batch.done }} / {{ batch.total }}<template v-if="batch.failed.length"> · 失败 {{ batch.failed.length }}</template><template v-if="batch.estimatedTime && batch.running"> · 剩余{{ batch.estimatedTime }}</template></small>
        </div>
        <el-progress :percentage="batchProgressPercentage" :status="batch.running ? '' : 'success'" :indeterminate="batchProgressIndeterminate" />
      </div>
      <div v-if="selectionMode" class="atelier-selectbar">
        <span class="atelier-selectbar-label"><AppIcon name="check" />选择模式 · 已选 {{ selectedCount }}</span>
        <el-button size="small" @click="selectAllInCategory(cat)"><AppIcon name="circle-check" /><span>全选本类</span></el-button>
        <el-button size="small" @click="deselectAll"><AppIcon name="circle-x" /><span>取消全选</span></el-button>
        <el-button size="small" type="primary" :loading="batch.running" :disabled="selectedCount === 0" @click="runBatchForSelected">
          <AppIcon name="wand-sparkles" /><span>生成选中 ({{ selectedInCurrentCategory }})</span>
        </el-button>
        <el-button
          size="small"
          type="danger"
          plain
          :loading="deletingSelectedElements"
          :disabled="selectedCount === 0 || batch.running || selectedElementsBusy"
          @click="deleteSelectedElements"
        >
          <AppIcon name="trash-2" /><span>删除选中 ({{ selectedCount }})</span>
        </el-button>
      </div>

      <!-- 画廊 -->
      <div class="atelier-gallery-head">
        <span class="atelier-gallery-count">{{ catLabel[cat] }}画廊 · {{ filteredCount }} / {{ curList.length }}</span>
        <div v-if="curList.length > 0" class="element-filters">
          <div class="filter-group">
            <span class="filter-label">图片</span>
            <el-select v-model="elementFilter.hasImage" size="small" style="width:100px">
              <el-option v-for="opt in elementFilterOptions.hasImage" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
          <div class="filter-group">
            <span class="filter-label">编辑</span>
            <el-select v-model="elementFilter.isEdited" size="small" style="width:100px">
              <el-option v-for="opt in elementFilterOptions.isEdited" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
          <div class="filter-group">
            <span class="filter-label">排序</span>
            <el-select v-model="elementFilter.sortBy" size="small" style="width:110px">
              <el-option v-for="opt in elementFilterOptions.sortBy" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
          <el-button v-if="hasActiveFilter" size="small" text @click="resetElementFilter(); elementSearchQuery = ''">
            <AppIcon name="rotate-ccw" /><span>重置</span>
          </el-button>
        </div>
      </div>

      <div v-if="!curList.length" class="empty-state">
        <AppIcon name="image" />
        <span>暂无{{ catLabel[cat] }} —— 点上方「从原文提取」自动建卡，或「新增」手动添加</span>
      </div>
      <div v-else-if="!filteredCurList.length" class="empty-state">
        <AppIcon name="search" />
        <span>没有匹配的元素</span>
      </div>
      <div v-else class="atelier-gallery">
        <article v-for="{ el, index } in filteredCurList" :key="elementKey(el, index)" :class="['cast-card', { selected: selectedElementIndex === index, 'element-selected': isElementSelected(cat, index) }]" @click="selectedElementIndex = index">
          <div class="cast-figure uploadable-image" @dragover.prevent @drop="onElementImageDrop($event, el, index)">
            <div v-if="selectionMode" class="element-checkbox" @click.stop="toggleElementSelection(cat, index)">
              <el-checkbox :model-value="isElementSelected(cat, index)" />
            </div>
            <img v-if="el.hasImage && !el._imgBroken" :src="imgUrl(el)" loading="lazy" decoding="async" @load="markImageLoaded(el)" @error="markImageFailed(el, { category: cat, index })" @click="lightboxSrc = imgUrl(el)" />
            <div v-else class="cast-figure-empty">
              <AppIcon name="image" />
              <span>{{ el.hasPendingImage ? '待同步 · 中转站已出图' : (el.hasImage ? '加载中' : '未生成 · 可拖图替换') }}</span>
            </div>
            <div v-if="el._gen || el._switchingPrimary" class="image-busy-overlay"><AppIcon name="loader-circle" /><span>{{ el._switchingPrimary ? '主形态切换中' : (el.hasImage ? '重新生成中' : '生成中') }}</span></div>
            <span v-if="cat === 'character'" :class="['cast-primary-badge', { 'with-selection': selectionMode }]"><AppIcon name="star" />主形态</span>
            <span class="cast-plate" :title="el.name">{{ el.name || '未命名' }}</span>
            <div class="cast-acts" @click.stop>
              <button class="cast-act is-primary" :title="el.hasImage ? '重新生成' : '生成图片'" :disabled="el._gen || el._switchingPrimary" @click="genImage(el, index)"><AppIcon name="wand-sparkles" /></button>
              <button class="cast-act" title="选择已生成图片" :disabled="el._uploading || el._switchingPrimary" @click="openCharacterLibraryPicker(el, index)"><AppIcon name="library" /></button>
              <button class="cast-act" title="从本地上传" :disabled="el._uploading || el._switchingPrimary" @click="$event.currentTarget.nextElementSibling.click()"><AppIcon name="upload" /></button>
              <input type="file" accept="image/*" hidden @change="onPickElementImage($event, el, index)" />
              <button v-if="el.hasPendingImage" class="cast-act is-sync" title="同步中转站图片" :disabled="el._syncing || el._switchingPrimary" @click="syncImageSlot(el, { category: cat, index })"><AppIcon name="refresh-cw" /></button>
              <button class="cast-act" title="编辑完整提示词" @click="openElementPromptDialog(el, index)"><AppIcon name="pen-line" /></button>
              <button class="cast-act" :title="cat === 'character' ? '导出人物图片' : '导出图片'" :disabled="!el.hasImage" @click="exportElement(el, index)"><AppIcon name="download" /></button>
              <button class="cast-act is-danger" title="删除元素" :disabled="el._switchingPrimary" @click="deleteElement(el, index)"><AppIcon name="trash-2" /></button>
            </div>
          </div>
          <div class="cast-body">
            <div class="cast-fields">
              <el-input v-model="el.name" placeholder="元素名" @input="scheduleElementSave(el, index)" />
              <el-input v-model="el.alias" size="small" placeholder="绑定/引用名（可选，用于分镜标签和视频@名称）" @input="scheduleElementSave(el, index)" />
              <el-input v-if="cat === 'character'" v-model="el.aliasesText" size="small" placeholder="人物代称，仅用于AI识别归并" @input="scheduleElementSave(el, index)" />
              <el-button class="cast-save" size="small" @click="saveElement(el, index)"><AppIcon name="check" /><span>保存</span></el-button>
            </div>
            <div v-if="cat === 'character'" class="character-asset-toolbar" @click.stop>
              <div class="character-asset-toolbar-copy">
                <AppIcon name="user-round" />
                <span>人物造型</span>
                <small>{{ (el.variants?.length || 0) + (el.outfits?.length || 0) }} 个造型</small>
              </div>
              <div class="character-asset-toolbar-actions">
                <el-button size="small" type="primary" plain @click="openWardrobeManager(el, index)"><AppIcon name="brush" /><span>管理造型</span></el-button>
              </div>
            </div>
            <div v-if="cat === 'scene'" class="character-asset-toolbar" @click.stop>
              <div class="character-asset-toolbar-copy">
                <AppIcon name="image" />
                <span>扩展子区域</span>
                <small>主视图内外相连的走廊、门外、卧室、后院等，以主场景图保持空间连续</small>
              </div>
              <div class="character-asset-toolbar-actions">
                <el-button size="small" type="primary" plain :loading="el._addingArea" @click="addSceneArea(el, index)"><AppIcon name="plus" /><span>添加子区域</span></el-button>
              </div>
            </div>
            <el-collapse v-if="cat === 'scene' && el.areas && el.areas.length" v-model="el._assetPanels" class="cast-extras">
              <el-collapse-item name="areas">
                <template #title><AppIcon name="image" /><span>子区域</span><small class="cast-extras-mark">{{ el.areas.length }}</small></template>
                <p v-if="!el.hasImage" class="warn-text">需要场景主图</p>
                <div class="outfit-grid">
                  <div v-for="(a, ai) in el.areas" :key="sceneAreaImageKey(el, a) + ':' + ai" class="sub-card">
                    <div class="sub-thumb uploadable-image" @dragover.prevent @drop="onSceneAreaImageDrop($event, el, index, a, ai)">
                      <img v-if="a.hasImage && !a._imgBroken" :src="sceneAreaImgUrl(el, a)" loading="lazy" decoding="async" @load="markImageLoaded(a)" @error="markImageFailed(a, { kind: 'sceneArea', sceneIndex: index, areaIndex: ai })" @click="lightboxSrc = sceneAreaImgUrl(el, a)" />
                      <div v-else class="image-placeholder mini"><AppIcon name="image" /><small v-if="a.hasPendingImage">待同步</small></div>
                      <div v-if="a._gen" class="image-busy-overlay mini"><AppIcon name="loader-circle" /></div>
                    </div>
                    <div class="sub-main">
                      <el-input v-model="a.name" size="small" placeholder="子区域名" />
                      <el-input v-model="a.desc" type="textarea" :rows="2" resize="vertical" placeholder="该区域的空间结构、陈设与视角重点" />
                      <div class="inline-actions wrap">
                        <el-button size="small" @click="saveSceneArea(el, index, a, ai)">保存</el-button>
                        <el-button size="small" text @click="$event.currentTarget.nextElementSibling.click()" :loading="a._uploading">上传</el-button>
                        <input type="file" accept="image/*" hidden @change="onPickSceneAreaImage($event, el, index, a, ai)" />
                        <el-button v-if="a.hasPendingImage" size="small" :loading="a._syncing" @click="syncImageSlot(a, { kind: 'sceneArea', sceneIndex: index, areaIndex: ai })">同步</el-button>
                        <el-button size="small" type="primary" :loading="a._gen" :disabled="!el.hasImage" @click="genSceneArea(el, index, a, ai)">{{ a.hasImage ? '重生成' : '生成' }}</el-button>
                        <el-button size="small" type="danger" plain :loading="a._deleting" :disabled="el._deletingAsset || a._gen || a._uploading || a._syncing" @click="deleteSceneArea(el, index, a, ai)"><AppIcon name="trash-2" /><span>删除</span></el-button>
                      </div>
                    </div>
                  </div>
                </div>
              </el-collapse-item>
            </el-collapse>
            <el-collapse v-if="cat === 'character'" v-model="el._assetPanels" class="cast-extras">
              <el-collapse-item name="ref">
                <template #title><AppIcon name="image" /><span>参考图与声音</span><small v-if="el.hasReferenceImage || el.hasVoiceAudio" class="cast-extras-mark">已配置</small></template>
                <div class="cast-extra-grid">
                  <div class="cast-extra-col">
                    <div class="reference-preview uploadable-image" @dragover.prevent @drop="onCharacterReferenceDrop($event, el, index)">
                      <img v-if="el.hasReferenceImage && !el._refImgBroken" :src="characterReferenceImgUrl(el)" loading="lazy" decoding="async" @click="lightboxSrc = characterReferenceImgUrl(el)" />
                      <div v-else class="image-placeholder"><AppIcon name="image" /><span>单人参考</span></div>
                    </div>
                    <div class="inline-actions wrap">
                      <el-button size="small" @click="$event.currentTarget.nextElementSibling.click()" :loading="el._refUploading"><AppIcon name="upload" /><span>上传</span></el-button>
                      <input type="file" accept="image/*" hidden @change="onPickCharacterReference($event, el, index)" />
                      <el-button v-if="el.hasReferenceImage" size="small" type="danger" plain :loading="el._refDeleting" @click="deleteCharacterReference(el, index)"><AppIcon name="trash-2" /><span>删除</span></el-button>
                    </div>
                    <el-radio-group v-model="el.referenceMode" class="reference-mode-group" @change="saveElement(el, index)">
                      <el-radio-button value="global" :disabled="!project.hasGlobalReferenceImage">全局</el-radio-button>
                      <el-radio-button value="character" :disabled="!el.hasReferenceImage">单人</el-radio-button>
                      <el-radio-button value="none">关闭</el-radio-button>
                    </el-radio-group>
                  </div>
                  <div class="cast-extra-col">
                    <div class="voice-reference uploadable-file" @dragover.prevent @drop="onCharacterVoiceDrop($event, el, index)">
                      <audio v-if="el.hasVoiceAudio" :key="characterVoiceAudioUrl(el)" :src="characterVoiceAudioUrl(el)" controls preload="metadata"></audio>
                      <div v-else class="voice-empty"><AppIcon name="mic" /><span>配音参考 · 未上传</span></div>
                    </div>
                    <div class="inline-actions wrap">
                      <el-button size="small" @click="$event.currentTarget.nextElementSibling.click()" :loading="el._voiceUploading"><AppIcon name="upload" /><span>{{ el.hasVoiceAudio ? '替换音频' : '上传音频' }}</span></el-button>
                      <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac" hidden @change="onPickCharacterVoice($event, el, index)" />
                      <el-button v-if="el.hasVoiceAudio" size="small" type="danger" plain :loading="el._voiceDeleting" @click="deleteCharacterVoiceAudio(el, index)"><AppIcon name="trash-2" /><span>删除</span></el-button>
                      <span class="voice-note">保留原始音频完整时长</span>
                    </div>
                  </div>
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
        </article>
      </div>
    </div>
  </el-drawer>

  <el-dialog
    v-model="wardrobeManager.visible"
    :title="'造型管理 · ' + (wardrobeCharacter?.name || '人物')"
    width="min(1080px, 96vw)"
    top="5vh"
    class="wardrobe-dialog"
    append-to-body
    destroy-on-close
    @closed="resetWardrobeManager"
  >
    <div v-if="wardrobeCharacter" class="wardrobe-layout">
      <aside class="wardrobe-browser">
        <div class="wardrobe-browser-head">
          <div><strong>造型</strong><span>{{ wardrobeLooks.length }} 个</span></div>
          <div class="wardrobe-add-actions">
            <el-button size="small" type="primary" plain :loading="wardrobeCharacter._addingVariant" @click="addCharacterLook()">
              <AppIcon name="plus" /><span>添加造型</span>
            </el-button>
          </div>
        </div>
        <el-input v-model="wardrobeManager.query" size="small" placeholder="搜索造型" clearable>
          <template #prefix><AppIcon name="search" /></template>
        </el-input>
        <div class="wardrobe-items">
          <button
            v-for="entry in wardrobeFilteredLooks"
            :key="entry.type + ':' + characterLookImageKey(entry) + ':' + entry.assetIndex"
            :class="['wardrobe-item', { active: wardrobeManager.selectedIndex === entry.index }]"
            type="button"
            @click="selectWardrobeLook(entry.index)"
          >
            <span class="wardrobe-item-thumb">
              <img v-if="entry.asset.hasImage && !entry.asset._imgBroken" :src="characterLookImgUrl(entry)" loading="lazy" decoding="async" @load="markImageLoaded(entry.asset)" @error="markImageFailed(entry.asset, characterLookImageSlot(entry))" />
              <span v-else class="image-placeholder mini"><AppIcon name="image" /></span>
              <span v-if="entry.asset._gen || entry.asset._switchingPrimary" class="image-busy-overlay mini"><AppIcon name="loader-circle" /></span>
            </span>
            <span class="wardrobe-item-copy">
              <strong>{{ entry.asset.name || '未命名造型' }}</strong>
              <small v-if="isCharacterAssetPrimary(wardrobeCharacter, entry.asset, entry.type)">当前主形态</small>
              <small v-else-if="entry.asset._gen">生成中</small>
              <small v-else-if="entry.asset.hasPendingImage">待同步</small>
              <small v-else>{{ entry.asset.hasImage ? '已有图片' : '尚未生成' }}</small>
            </span>
            <AppIcon name="circle-check" />
          </button>
          <div v-if="!wardrobeFilteredLooks.length" class="wardrobe-no-results">{{ wardrobeLooks.length ? '没有找到匹配的造型' : '暂无造型' }}</div>
        </div>
      </aside>

      <section v-if="wardrobeSelectedLook && wardrobeSelectedAsset" class="wardrobe-editor">
        <header class="wardrobe-editor-head">
          <div>
            <small>第 {{ wardrobeManager.selectedIndex + 1 }} 个</small>
            <strong>{{ wardrobeSelectedAsset.name || '未命名造型' }}</strong>
          </div>
          <span :class="['wardrobe-status', { ready: wardrobeSelectedAsset.hasImage }]">
            {{ wardrobeSelectedAsset._gen ? '生成中' : (wardrobeSelectedAsset.hasPendingImage ? '待同步' : (wardrobeSelectedAsset.hasImage ? '图片已就绪' : '尚未生成')) }}
          </span>
        </header>
        <div class="wardrobe-editor-main">
          <div class="wardrobe-preview uploadable-image" @dragover.prevent @drop="onCharacterLookImageDrop($event, wardrobeSelectedLook)">
            <img v-if="wardrobeSelectedAsset.hasImage && !wardrobeSelectedAsset._imgBroken" :src="characterLookImgUrl(wardrobeSelectedLook)" decoding="async" @load="markImageLoaded(wardrobeSelectedAsset)" @error="markImageFailed(wardrobeSelectedAsset, characterLookImageSlot(wardrobeSelectedLook))" @click="lightboxSrc = characterLookImgUrl(wardrobeSelectedLook)" />
            <div v-else class="image-placeholder">
              <AppIcon name="image" />
              <span>{{ wardrobeSelectedAsset.hasPendingImage ? '图片等待同步' : '尚未生成造型图' }}</span>
            </div>
            <div v-if="wardrobeSelectedAsset._gen || wardrobeSelectedAsset._switchingPrimary" class="image-busy-overlay">
              <AppIcon name="loader-circle" />
              <span>{{ wardrobeSelectedAsset._switchingPrimary ? '主形态切换中' : '生成中' }}</span>
            </div>
          </div>
          <div v-if="wardrobeSelectedLook.type === 'variant'" class="wardrobe-reference-strip">
            <div class="wardrobe-reference-strip-head"><strong>当前服饰参考</strong><small>衣服和 Logo 可同时使用</small></div>
            <div class="wardrobe-reference-strip-grid">
              <div class="wardrobe-reference-strip-item">
                <div class="wardrobe-reference-strip-thumb">
                  <img v-if="wardrobeSelectedAsset.hasClothingReferenceImage" :src="variantClothingReferenceImgUrl(wardrobeCharacter, wardrobeSelectedAsset)" alt="服饰参考" />
                  <span v-else><AppIcon name="image" /></span>
                </div>
                <span>服饰</span>
              </div>
              <div class="wardrobe-reference-strip-item">
                <div class="wardrobe-reference-strip-thumb">
                  <img v-if="wardrobeSelectedAsset.hasLogoReferenceImage" :src="variantLogoReferenceImgUrl(wardrobeCharacter, wardrobeSelectedAsset)" alt="Logo参考" />
                  <span v-else><AppIcon name="image" /></span>
                </div>
                <span>衣服图案 / Logo</span>
              </div>
            </div>
          </div>
          <div class="wardrobe-fields">
            <label><span>造型名称</span><el-input v-model="wardrobeSelectedAsset.name" placeholder="造型名" /></label>
            <label><span>造型描述</span><el-input v-model="wardrobeSelectedAsset.desc" type="textarea" :rows="5" resize="vertical" placeholder="描述整体外观、服装、妆发或状态" /></label>
            <div v-if="wardrobeSelectedLook.type === 'variant'" class="wardrobe-reference-panel">
              <div class="wardrobe-reference-panel-head">
                <div>
                  <strong>服饰与 Logo 参考</strong>
                  <small>可分别上传，生成时会同时参考；不上传则按文字描述生成。</small>
                </div>
              </div>
              <label class="wardrobe-reference-field">
                <span>参考服饰 <small>可选</small></span>
                <el-select v-model="wardrobeSelectedAsset.clothingReferenceOutfitName" clearable placeholder="不指定，按文字描述生成" style="width:100%">
                  <el-option v-for="outfit in wardrobeAvailableOutfits" :key="outfit.name" :label="outfit.name" :value="outfit.name" />
                </el-select>
              </label>
              <div class="wardrobe-reference-grid">
                <div class="wardrobe-reference-card">
                  <div class="wardrobe-reference-card-title"><span>上传服饰图片</span><small>整套版型 / 材质 / 配色</small></div>
                  <div class="wardrobe-reference-preview uploadable-image" @dragover.prevent @drop="onVariantClothingReferenceDrop($event, wardrobeCharacter, wardrobeManager.charIndex, wardrobeSelectedAsset, wardrobeSelectedLook.assetIndex, 'outfit')">
                    <img v-if="wardrobeSelectedAsset.hasClothingReferenceImage" :src="variantClothingReferenceImgUrl(wardrobeCharacter, wardrobeSelectedAsset)" alt="服饰参考图" loading="lazy" decoding="async" />
                    <div v-else class="image-placeholder mini"><AppIcon name="image" /><span>未上传</span></div>
                  </div>
                  <div class="inline-actions wrap">
                    <el-button size="small" @click="$event.currentTarget.nextElementSibling.click()" :loading="wardrobeSelectedAsset._clothingReferenceUploading"><AppIcon name="upload" /><span>{{ wardrobeSelectedAsset.hasClothingReferenceImage ? '替换服饰图' : '上传服饰图' }}</span></el-button>
                    <input type="file" accept="image/*" hidden @change="onPickVariantClothingReference($event, wardrobeCharacter, wardrobeManager.charIndex, wardrobeSelectedAsset, wardrobeSelectedLook.assetIndex, 'outfit')" />
                    <el-button v-if="wardrobeSelectedAsset.hasClothingReferenceImage" size="small" type="danger" text :loading="wardrobeSelectedAsset._clothingReferenceDeleting" @click="deleteVariantClothingReference(wardrobeSelectedAsset, wardrobeManager.charIndex, wardrobeSelectedLook.assetIndex, 'outfit')"><AppIcon name="trash-2" /><span>移除</span></el-button>
                  </div>
                </div>
                <div class="wardrobe-reference-card">
                  <div class="wardrobe-reference-card-title"><span>上传衣服图案 / Logo</span><small>只应用到衣服表面</small></div>
                  <div class="wardrobe-reference-preview uploadable-image" @dragover.prevent @drop="onVariantClothingReferenceDrop($event, wardrobeCharacter, wardrobeManager.charIndex, wardrobeSelectedAsset, wardrobeSelectedLook.assetIndex, 'pattern')">
                    <img v-if="wardrobeSelectedAsset.hasLogoReferenceImage" :src="variantLogoReferenceImgUrl(wardrobeCharacter, wardrobeSelectedAsset)" alt="Logo参考图" loading="lazy" decoding="async" />
                    <div v-else class="image-placeholder mini"><AppIcon name="image" /><span>未上传</span></div>
                  </div>
                  <div class="inline-actions wrap">
                    <el-button size="small" @click="$event.currentTarget.nextElementSibling.click()" :loading="wardrobeSelectedAsset._logoReferenceUploading"><AppIcon name="upload" /><span>{{ wardrobeSelectedAsset.hasLogoReferenceImage ? '替换 Logo 图' : '上传 Logo 图' }}</span></el-button>
                    <input type="file" accept="image/*" hidden @change="onPickVariantClothingReference($event, wardrobeCharacter, wardrobeManager.charIndex, wardrobeSelectedAsset, wardrobeSelectedLook.assetIndex, 'pattern')" />
                    <el-button v-if="wardrobeSelectedAsset.hasLogoReferenceImage" size="small" type="danger" text :loading="wardrobeSelectedAsset._logoReferenceDeleting" @click="deleteVariantClothingReference(wardrobeSelectedAsset, wardrobeManager.charIndex, wardrobeSelectedLook.assetIndex, 'pattern')"><AppIcon name="trash-2" /><span>移除</span></el-button>
                  </div>
                </div>
              </div>
            </div>
            <el-collapse v-if="wardrobeSelectedLook.type === 'variant'" class="wardrobe-detail-collapse">
              <el-collapse-item name="details" title="详细造型设定">
                <div class="wardrobe-detail-fields">
                  <label><span>外貌</span><el-input v-model="wardrobeSelectedAsset.appearance" type="textarea" :rows="2" resize="vertical" /></label>
                  <label><span>身材体态</span><el-input v-model="wardrobeSelectedAsset.body" type="textarea" :rows="2" resize="vertical" /></label>
                  <label><span>发型发色</span><el-input v-model="wardrobeSelectedAsset.hair" type="textarea" :rows="2" resize="vertical" /></label>
                  <label><span>服装造型</span><el-input v-model="wardrobeSelectedAsset.clothing" type="textarea" :rows="2" resize="vertical" /></label>
                  <label><span>妆容配饰</span><el-input v-model="wardrobeSelectedAsset.makeupAccessories" type="textarea" :rows="2" resize="vertical" /></label>
                </div>
              </el-collapse-item>
            </el-collapse>
            <div v-if="wardrobeSelectedLook.type === 'outfit'" class="wardrobe-outfit-note">
              这是旧版独立服饰素材，仅用于被形态引用。新增需要上传服饰和 Logo 的内容，请使用上方“添加造型”。
            </div>
          </div>
        </div>
        <footer class="wardrobe-actions">
          <div class="wardrobe-actions-primary">
            <el-button type="primary" :loading="wardrobeSelectedAsset._gen" :disabled="!wardrobeCharacter.hasImage || wardrobeSelectedAsset._switchingPrimary" @click="generateCharacterLook()"><AppIcon name="wand-sparkles" /><span>{{ wardrobeSelectedAsset.hasImage ? '重新生成' : '生成图片' }}</span></el-button>
            <el-button :disabled="wardrobeSelectedAsset._switchingPrimary" @click="saveCharacterLook()"><AppIcon name="check" /><span>保存</span></el-button>
            <el-button :disabled="wardrobeSelectedAsset._switchingPrimary" @click="openCharacterLookPrompt()"><AppIcon name="pen-line" /><span>提示词</span></el-button>
            <el-button :loading="wardrobeSelectedAsset._uploading" :disabled="wardrobeSelectedAsset._switchingPrimary" @click="$event.currentTarget.nextElementSibling.click()"><AppIcon name="upload" /><span>上传</span></el-button>
            <input type="file" accept="image/*" hidden @change="onPickCharacterLookImage($event, wardrobeSelectedLook)" />
            <el-button v-if="wardrobeSelectedAsset.hasPendingImage" :loading="wardrobeSelectedAsset._syncing" :disabled="wardrobeSelectedAsset._switchingPrimary" @click="syncImageSlot(wardrobeSelectedAsset, characterLookImageSlot(wardrobeSelectedLook))"><AppIcon name="refresh-cw" /><span>同步</span></el-button>
          </div>
          <div class="wardrobe-actions-secondary">
            <el-button type="success" plain :loading="wardrobeSelectedAsset._switchingPrimary" :disabled="!canSwapCharacterAssetPrimary(wardrobeCharacter, wardrobeSelectedAsset) || wardrobeCharacter._switchingPrimary || wardrobeSelectedAsset._gen || wardrobeSelectedAsset._uploading || wardrobeSelectedAsset._syncing || wardrobeSelectedAsset._deleting" :title="characterAssetPrimarySwapHint(wardrobeCharacter, wardrobeSelectedAsset, '造型', wardrobeSelectedLook.type)" @click="swapCharacterLookPrimary()"><AppIcon name="toggle-left" /><span>{{ wardrobeSelectedIsPrimary ? '恢复默认主形态' : '设为主形态' }}</span></el-button>
            <el-button type="danger" plain :loading="wardrobeSelectedAsset._deleting" :disabled="wardrobeCharacter._deletingAsset || wardrobeCharacter._switchingPrimary || wardrobeSelectedAsset._gen || wardrobeSelectedAsset._uploading || wardrobeSelectedAsset._syncing" @click="deleteCharacterLook()"><AppIcon name="trash-2" /><span>删除</span></el-button>
          </div>
        </footer>
      </section>
      <section v-else class="wardrobe-editor wardrobe-editor-empty">
        <el-empty description="暂无造型">
          <el-button type="primary" :loading="wardrobeCharacter._addingVariant" @click="addCharacterLook()"><AppIcon name="plus" /><span>添加造型</span></el-button>
        </el-empty>
      </section>
    </div>
  </el-dialog>`;
