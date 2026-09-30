export const characterLibraryDialog = /* html */ `
  <el-dialog v-model="library.visible" width="min(1280px, 96vw)" class="character-library-dialog" destroy-on-close align-center>
    <template #header>
      <div class="character-library-title">
        <span class="character-library-title-icon"><AppIcon name="image" /></span>
        <div>
          <div class="eyebrow">Generated Asset Gallery</div>
          <h2>全局素材图库</h2>
          <p v-if="library.pickerMode">为“{{ library.targetElementName }}”选择一张已经生成好的{{ library.targetCategoryLabel }}图片</p>
          <p v-else>自动汇总所有项目已经生成的人物、场景、道具和特效图片</p>
        </div>
      </div>
    </template>

    <section class="character-library-main" v-loading="library.loading">
      <div class="character-library-toolbar">
        <el-input v-model="library.query" clearable placeholder="搜索素材名、别名或图片名称" aria-label="搜索全局素材"><template #prefix><AppIcon name="search" /></template></el-input>
        <el-select v-model="library.projectId" clearable placeholder="全部项目" aria-label="筛选来源项目"><el-option v-for="projectItem in library.projects" :key="projectItem.id" :label="projectItem.name" :value="projectItem.id" /></el-select>
        <el-select v-model="library.category" clearable placeholder="全部类型" aria-label="筛选素材类型"><el-option v-for="category in library.categories" :key="category" :label="category" :value="category" /></el-select>
        <el-button circle :loading="library.loading" title="重新扫描已生成图片" @click="loadCharacterLibrary"><AppIcon name="refresh-cw" /></el-button>
      </div>
      <div class="character-library-summary">
        <span>{{ filteredLibraryCharacters.length }} / {{ library.items.length }} 张图片</span>
        <span v-if="library.pickerMode" class="character-library-target"><AppIcon name="crosshair" />目标{{ library.targetCategoryLabel }}：{{ library.targetElementName }}</span>
        <el-button v-if="library.query || library.category || library.projectId" text @click="resetCharacterLibraryFilters">清除筛选</el-button>
      </div>

      <div v-if="!library.pickerMode && filteredLibraryCharacters.length" class="character-library-selection-bar">
        <div class="character-library-selection-state">
          <el-checkbox
            :model-value="libraryAllFilteredSelected"
            :indeterminate="librarySomeFilteredSelected"
            aria-label="全选当前筛选结果"
            @change="toggleAllFilteredLibraryItems"
          >全选当前结果</el-checkbox>
          <span v-if="selectedLibraryCount">已选 {{ selectedLibraryCount }} 张</span>
        </div>
        <div class="character-library-selection-actions">
          <el-button type="danger" plain :disabled="!selectedLibraryCount || library.adding || library.removing" :loading="library.removing && !library.removingId" @click="removeSelectedLibraryItems">
            <AppIcon name="trash-2" /><span>批量移除</span>
          </el-button>
          <el-button type="primary" :disabled="!selectedLibraryCount || library.removing" :loading="library.adding && !library.addingId" @click="addLibraryItemsToProject()">
            <AppIcon name="plus" /><span>添加到当前项目</span>
          </el-button>
        </div>
      </div>

      <div v-if="filteredLibraryCharacters.length" class="character-library-grid">
        <article v-for="item in filteredLibraryCharacters" :key="item.id" :class="['character-library-card', { selected: isLibraryItemSelected(item) }]">
          <button class="character-library-cover" :aria-label="'预览图片：' + item.name" @click="lightboxSrc = item.coverUrl">
            <img :src="item.coverUrl" :alt="item.name" loading="lazy" />
            <el-tag size="small" effect="dark">{{ item.assetTypeLabel }}</el-tag>
            <span class="character-library-preview"><AppIcon name="zoom-in" /></span>
          </button>
          <div v-if="!library.pickerMode" class="character-library-check" @click.stop>
            <el-checkbox :model-value="isLibraryItemSelected(item)" :aria-label="'选择素材：' + item.name" @change="toggleLibraryItemSelection(item, $event)" />
          </div>
          <div class="character-library-card-body">
            <div class="character-library-card-heading"><h3>{{ item.name }}</h3><p>{{ item.sourceProjectName }}</p></div>
            <div class="character-library-tags"><span>{{ item.elementName }}</span><span v-if="item.alias">{{ item.alias }}</span></div>
            <el-button v-if="library.pickerMode" type="primary" plain :loading="library.applyingId === item.id" :disabled="!!library.applyingId" @click="applyLibraryImage(item)"><AppIcon name="check" /><span>选用此图片</span></el-button>
            <div v-else class="character-library-card-actions">
              <el-button type="primary" plain :loading="library.addingId === item.id" :disabled="library.adding || library.removing" @click="addLibraryItemsToProject([item.id])"><AppIcon name="plus" /><span>添加到项目</span></el-button>
              <el-button type="danger" plain circle :loading="library.removingId === item.id" :disabled="library.adding || library.removing" :title="'从图库移除：' + item.name" :aria-label="'从图库移除：' + item.name" @click="removeLibraryItems(item)"><AppIcon name="trash-2" /></el-button>
            </div>
          </div>
        </article>
      </div>
      <div v-else class="character-library-empty">
        <AppIcon name="image" />
        <strong>{{ library.items.length ? '没有匹配的图片' : '还没有生成好的素材图片' }}</strong>
        <span>{{ library.items.length ? '调整搜索、项目或图片类型筛选' : '在任意项目生成素材图后，它会自动出现在这里' }}</span>
      </div>
    </section>
  </el-dialog>`;
