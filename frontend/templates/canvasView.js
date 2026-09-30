export const canvasView = /* html */ `
        <template v-if="view === 'canvas' || canvasMounted">
          <section v-if="canvasLibrary.screen === 'library'" :class="['page page--canvas-library', 'canvas-library-view', { 'is-parked': view !== 'canvas' }]">
            <header class="page-head canvas-library-head">
              <div class="page-head-copy">
                <div class="eyebrow">Freedom · Creative Space</div>
                <h1>画布</h1>
                <p>{{ canvasLibrary.projects.length }} 个独立创作空间 · 没有预设结构，从空白画布开始自由组织灵感、文本与视觉。</p>
              </div>
              <div class="page-head-actions">
                <el-input v-model="canvasLibrary.newName" size="large" maxlength="40" placeholder="给新画布起个名字……" @keyup.enter="canvasCreateProject">
                  <template #prefix><AppIcon name="pen-line" /></template>
                </el-input>
                <el-button size="large" type="primary" @click="canvasCreateProject"><AppIcon name="plus" /><span>新建空白画布</span></el-button>
              </div>
            </header>

            <div class="page-body">
            <section class="panel canvas-library-panel">
              <div class="panel-head">
                <div class="page-head-copy"><h2>画布项目</h2><p>{{ canvasLibrary.projects.length }} 个独立创作空间</p></div>
                <el-input v-model="canvasLibrary.search" clearable placeholder="搜索画布项目" class="canvas-library-search"><template #prefix><AppIcon name="search" /></template></el-input>
              </div>
              <div class="panel-body panel-body--pad">
            <div v-if="canvasFilteredProjects.length" class="canvas-project-grid">
              <article v-for="(item, index) in canvasFilteredProjects" :key="item.id" class="canvas-project-card" tabindex="0" @click="canvasOpenProject(item.id)" @keydown.enter="canvasOpenProject(item.id)">
                <div class="canvas-card-preview">
                  <div class="canvas-card-grid"></div>
                  <template v-if="item.nodes.length">
                    <i v-for="node in item.nodes.slice(0, 7)" :key="node.id" :class="['canvas-card-node', 'tone-' + node.color]" :style="{ left: (16 + ((Math.abs(node.x) + index) % 68)) + '%', top: (18 + ((Math.abs(node.y) + index * 9) % 54)) + '%' }"></i>
                  </template>
                  <div v-else class="canvas-card-empty"><b>∞</b><span>空白画布</span></div>
                  <span class="canvas-card-index">{{ String(index + 1).padStart(2, '0') }}</span>
                </div>
                <div class="canvas-card-body">
                  <div class="canvas-card-title"><div><h3>{{ item.name }}</h3><p>{{ item.description }}</p></div><AppIcon name="arrow-right" /></div>
                  <div class="canvas-card-meta canvas-card-resource-meta">
                    <span><b>{{ canvasProjectNodeSummary(item).total }}</b> 节点</span>
                    <span><b>{{ canvasProjectMediaCount(item) }}</b> 素材</span>
                    <span><b>{{ formatCanvasBytes(item.storageBytes) }}</b> 存储</span>
                    <span>{{ formatCanvasTime(item.updatedAt) }} 更新</span>
                  </div>
                </div>
                <div class="canvas-card-actions" @click.stop>
                  <button title="打开画布素材文件夹" @click="canvasOpenMediaFolder(item)"><AppIcon name="folder-open" /></button>
                  <button title="复制画布" @click="canvasDuplicateProject(item)"><AppIcon name="copy" /></button>
                  <button class="danger" title="删除画布" @click="canvasDeleteProject(item)"><AppIcon name="trash-2" /></button>
                </div>
              </article>
            </div>
            <div v-else class="canvas-library-empty">
              <span>∞</span><h3>{{ canvasLibrary.search ? '没有匹配的画布' : '还没有画布项目' }}</h3>
              <p>{{ canvasLibrary.search ? '换一个关键词试试' : '输入名称，新建你的第一张空白画布。' }}</p>
              <el-button v-if="!canvasLibrary.search" type="primary" @click="canvasCreateProject"><AppIcon name="plus" /><span>新建空白画布</span></el-button>
            </div>
              </div>
            </section>
            </div>
          </section>

          <section v-else :class="['canvas-editor-view', { 'is-parked': view !== 'canvas' }]">
            <header class="canvas-project-bar canvas-ui">
              <div class="canvas-project-bar-left">
                <button class="canvas-back-button" title="返回画布项目" @click="canvasBackToLibrary"><AppIcon name="arrow-left" /></button>
                <div class="canvas-project-symbol">∞</div>
                <div class="canvas-project-name">
                  <span>FREEDOM</span>
                  <input v-if="canvasActiveProject" v-model="canvasActiveProject.name" maxlength="40" @change="canvasRenameProject" />
                </div>
              </div>
              <div class="canvas-project-bar-center">
                <span><i></i>已自动保存</span>
                <b>{{ canvasNodes.length }} 节点</b>
                <b>{{ canvasEdges.length }} 连接</b>
              </div>
              <div class="canvas-project-bar-actions">
                <button class="canvas-agent-launch" title="打开Freedom画布 Agent" @click="canvasOpenAgent"><span class="canvas-agent-launch-mark"><AppIcon name="tv" /></span><span>Agent</span><i></i></button>
                <button title="打开画布素材文件夹" @click="canvasOpenMediaFolder(canvasActiveProject)"><AppIcon name="folder-open" /></button>
                <button title="适应全部内容" @click="canvasFitView"><AppIcon name="maximize" /></button>
                <button title="清空当前画布" @click="canvasClearProject"><AppIcon name="trash-2" /></button>
                <button class="canvas-back-text" @click="canvasBackToLibrary">所有画布</button>
              </div>
            </header>

            <div
              ref="canvasViewportRef"
              class="story-canvas-viewport is-standalone"
              :class="{ 'is-panning': canvasState.interaction?.type === 'pan', 'is-space-pan': canvasState.spacePressed, 'is-dragging-node': canvasState.interaction?.type === 'node', 'is-connecting': canvasState.connectingFrom, 'is-drop-active': canvasState.dropActive, 'has-dock-panel': canvasDock.panel }"
              :style="canvasViewportStyle"
              tabindex="0"
              aria-label="空白画布，可拖动、缩放并自由创作"
              @pointerdown="canvasPointerDown"
              @pointermove="canvasPointerMove"
              @pointerup="canvasPointerUp"
              @pointercancel="canvasPointerUp"
              @wheel.prevent="canvasWheel"
              @dblclick="canvasDoubleClick"
              @contextmenu.prevent="canvasOpenContextMenu"
              @keydown="canvasKeydown"
              @keyup="canvasKeyup"
              @blur="canvasBlur"
              @dragenter.prevent="canvasDragEnter"
              @dragover.prevent="canvasDragOver"
              @dragleave.prevent="canvasDragLeave"
              @drop.prevent="canvasDropMedia"
            >
              <div class="canvas-aurora canvas-aurora-a" aria-hidden="true"></div>
              <div class="canvas-aurora canvas-aurora-b" aria-hidden="true"></div>
              <div class="canvas-vignette" aria-hidden="true"></div>
              <div v-if="canvasState.dropActive" class="canvas-drop-overlay canvas-ui"><AppIcon name="upload" /><span>松开以上传媒体</span></div>

              <div class="canvas-up-dock canvas-ui" role="toolbar" aria-label="画布工作区">
                <button :class="{ active: canvasDock.panel === 'assets' }" title="素材库" aria-label="素材库" @click.stop="canvasToggleDockPanel('assets')"><AppIcon name="folder" /></button>
                <button :class="{ active: canvasDock.panel === 'timeline' }" title="时间轴" aria-label="时间轴" @click.stop="canvasToggleDockPanel('timeline')"><AppIcon name="film" /></button>
                <button :class="{ active: canvasDock.panel === 'history' }" title="历史记录" aria-label="历史记录" @click.stop="canvasToggleDockPanel('history')"><AppIcon name="clock" /></button>
              </div>

              <aside v-if="canvasDock.panel === 'assets'" class="canvas-dock-panel canvas-asset-panel canvas-ui" @pointerdown.stop>
                <header><div><small>MEDIA WORKSPACE</small><h2>素材库</h2></div><button title="关闭" @click="canvasToggleDockPanel('assets')"><AppIcon name="x" /></button></header>
                <div class="canvas-asset-scope" role="tablist" aria-label="素材范围">
                  <button :class="{ active: canvasDock.assetScope === 'current' }" @click="canvasDock.assetScope = 'current'">本画布</button>
                  <button :class="{ active: canvasDock.assetScope === 'all' }" @click="canvasDock.assetScope = 'all'">全部画布</button>
                </div>
                <div class="canvas-asset-search"><AppIcon name="search" /><input v-model="canvasDock.assetSearch" placeholder="搜索素材" /><button title="上传图片、视频或音频" @click="canvasOpenMixedMediaUpload"><AppIcon name="upload" /></button><button title="添加创作节点" @click="canvasToggleNodePalette"><AppIcon name="plus" /></button></div>
                <div class="canvas-asset-filters" aria-label="素材类型">
                  <button v-for="filter in [{key:'all',label:'全部'},{key:'image',label:'图片'},{key:'video',label:'视频'},{key:'audio',label:'音频'}]" :key="filter.key" :class="{ active: canvasDock.assetFilter === filter.key }" @click="canvasDock.assetFilter = filter.key">{{ filter.label }}</button>
                </div>
                <div v-if="canvasAssetItems.length" class="canvas-asset-grid">
                  <article v-for="asset in canvasAssetItems" :key="asset.id" draggable="true" @dragstart="canvasAssetDragStart($event, asset)" @dragend="canvasDragEnd">
                    <div class="canvas-asset-thumb">
                      <img v-if="asset.type === 'image'" :src="asset.mediaUrl" alt="" draggable="false" loading="lazy" decoding="async" />
                      <video v-else-if="asset.type === 'video'" :src="asset.mediaUrl" muted preload="metadata"></video>
                      <span v-else><AppIcon name="headphones" /></span>
                      <i>{{ asset.type === 'image' ? '图片' : asset.type === 'video' ? '视频' : '音频' }}</i>
                    </div>
                    <div class="canvas-asset-meta"><b :title="asset.title">{{ asset.title }}</b><small>{{ asset.projectName }}</small></div>
                    <div class="canvas-asset-actions">
                      <button title="下载媒体" @click.stop="canvasDownloadMedia(asset)"><AppIcon name="download" /></button>
                      <button title="打开素材文件夹" @click.stop="canvasOpenMediaFolder(asset)"><AppIcon name="folder-open" /></button>
                    </div>
                    <button class="canvas-asset-add" title="加入当前画布" @click.stop="canvasAddAssetToCanvas(asset)"><AppIcon name="plus" /></button>
                  </article>
                </div>
                <div v-else class="canvas-dock-empty"><AppIcon name="folder-open" /><b>暂无可用素材</b><span>上传媒体后可重复拖回画布使用</span><button @click="canvasOpenMixedMediaUpload"><AppIcon name="upload" />上传素材</button></div>
              </aside>

              <aside v-if="canvasDock.panel === 'history'" class="canvas-dock-panel canvas-history-panel canvas-ui" @pointerdown.stop>
                <header><div><small>CANVAS VERSIONS</small><h2>历史记录</h2></div><button title="关闭" @click="canvasToggleDockPanel('history')"><AppIcon name="x" /></button></header>
                <div class="canvas-history-actions"><button :disabled="!canvasCanUndo" @click="canvasUndo"><AppIcon name="rotate-ccw" /><span>撤销</span></button><button :disabled="!canvasCanRedo" @click="canvasRedo"><AppIcon name="rotate-cw" /><span>重做</span></button></div>
                <div v-if="canvasHistoryEntries.length" class="canvas-history-list">
                  <button v-for="entry in canvasHistoryEntries" :key="entry.id" @click="canvasRestoreHistory(entry)"><i><AppIcon name="clock" /></i><span><b>{{ entry.label }}</b><small>{{ formatCanvasTime(entry.time) }} · {{ entry.nodeCount }} 个节点</small></span><AppIcon name="rotate-ccw" /></button>
                </div>
                <div v-else class="canvas-dock-empty"><AppIcon name="clock" /><b>还没有历史版本</b><span>添加、编辑或移动节点后会自动记录</span></div>
              </aside>

              <aside v-if="canvasDock.panel === 'timeline'" class="canvas-dock-panel canvas-timeline-panel canvas-ui" @pointerdown.stop>
                <header><div><small>SEQUENCE</small><h2>时间轴</h2></div><button title="关闭" @click="canvasToggleDockPanel('timeline')"><AppIcon name="x" /></button></header>
                <div class="canvas-timeline-transport"><button :disabled="!canvasTimelineItems.length" :title="canvasDock.timelinePlaying ? '暂停' : '播放'" @click="canvasToggleTimelinePlayback"><el-icon><VideoPause v-if="canvasDock.timelinePlaying" /><VideoPlay v-else /></el-icon></button><span>{{ canvasFormatTimelineTime(canvasDock.timelinePlayhead) }} / {{ canvasFormatTimelineTime(canvasTimelineDuration) }}</span></div>
                <div v-if="canvasTimelineItems.length" class="canvas-timeline-body">
                  <input type="range" min="0" :max="canvasTimelineDuration || 0" step="0.01" :value="canvasDock.timelinePlayhead" aria-label="时间轴播放位置" @input="canvasSeekTimeline($event.target.value)" />
                  <div class="canvas-timeline-ruler"><span v-for="tick in Math.max(2, Math.ceil(canvasTimelineDuration / 5) + 1)" :key="tick">{{ canvasFormatTimelineTime((tick - 1) * 5) }}</span></div>
                  <div class="canvas-timeline-track">
                    <button v-for="item in canvasTimelineItems" :key="item.id" :class="['type-' + item.type, { active: canvasState.selectedId === item.id }]" :style="{ flexGrow: item.timelineDuration }" @click="canvasFocusNode(item.id)"><span><el-icon><Picture v-if="item.type === 'image'" /><VideoCamera v-else-if="item.type === 'video'" /><Headset v-else /></el-icon></span><b>{{ item.title }}</b><small>{{ item.timelineDuration }}s</small></button>
                  </div>
                </div>
                <div v-else class="canvas-timeline-empty"><span>当前画布没有媒体节点</span><button @click="canvasOpenMixedMediaUpload"><AppIcon name="upload" />上传素材</button></div>
              </aside>

              <div class="canvas-zoom-tools canvas-ui">
                <button title="缩小" @click="canvasZoomBy(-.1)"><AppIcon name="minus" /></button>
                <span>{{ Math.round(canvasState.zoom * 100) }}%</span>
                <button title="放大" @click="canvasZoomBy(.1)"><AppIcon name="zoom-in" /></button>
                <button title="回到中心" @click="canvasResetView"><AppIcon name="crosshair" /></button>
                <button :title="canvasState.showMinimap ? '隐藏小地图' : '显示小地图'" :class="{ active: canvasState.showMinimap }" @click="canvasState.showMinimap = !canvasState.showMinimap"><AppIcon name="map-pin" /></button>
              </div>


              <div v-if="canvasState.contextMenu.open" class="canvas-context-menu canvas-ui" :style="{ left: canvasState.contextMenu.x + 'px', top: canvasState.contextMenu.y + 'px' }" @pointerdown.stop>
                <div class="canvas-context-head"><span>在这里创建</span><kbd>RIGHT CLICK</kbd></div>
                <button @click="canvasCreateFromMenu('note')"><i class="tone-gold"><AppIcon name="wand-sparkles" /></i><span><b>灵感便签</b><small>快速记录想法与素材</small></span></button>
                <button @click="canvasCreateFromMenu('infer')"><i class="tone-cyan"><AppIcon name="cpu" /></i><span><b>AI 推理卡</b><small>调用文本模型分析与创作</small></span></button>
                <button @click="canvasCreateFromMenu('image')"><i class="tone-violet"><AppIcon name="image" /></i><span><b>生图卡片</b><small>提示词直接生成图片</small></span></button>
                <button @click="canvasCreateFromMenu('video')"><i class="tone-rose"><AppIcon name="video" /></i><span><b>视频卡片</b><small>文生视频 / 图生视频</small></span></button>
                <button @click="canvasCreateFromMenu('audio')"><i class="tone-gold"><AppIcon name="headphones" /></i><span><b>音频素材</b><small>导入配音、音乐与环境音</small></span></button>
                <button @click="canvasCreateFromMenu('section')"><i class="tone-gold"><AppIcon name="crop" /></i><span><b>创作分区</b><small>整理相关节点与流程</small></span></button>
              </div>

              <div v-if="canvasState.nodePaletteOpen" class="canvas-node-palette canvas-ui" @pointerdown.stop>
                <div class="canvas-node-palette-head"><div><span>Freedom NODE LIBRARY</span><b>添加创作节点</b></div><button @click="canvasState.nodePaletteOpen = false"><AppIcon name="x" /></button></div>
                <div class="canvas-node-palette-grid">
                  <button class="tone-gold" @click="canvasAddNode('note')"><i><AppIcon name="wand-sparkles" /></i><span><b>灵感便签</b><small>文本、想法、提示词</small></span><kbd>N</kbd></button>
                  <button class="tone-cyan" @click="canvasAddNode('infer')"><i><AppIcon name="cpu" /></i><span><b>AI 推理</b><small>分析、扩写与推演</small></span><kbd>T</kbd></button>
                  <button class="tone-violet" @click="canvasAddNode('image')"><i><AppIcon name="image" /></i><span><b>图片生成</b><small>文本或参考图生图</small></span><kbd>I</kbd></button>
                  <button class="tone-rose" @click="canvasAddNode('video')"><i><AppIcon name="video" /></i><span><b>视频生成</b><small>多图与文本转视频</small></span><kbd>V</kbd></button>
                  <button class="tone-gold" @click="canvasAddNode('audio')"><i><AppIcon name="headphones" /></i><span><b>音频素材</b><small>配音、音乐、音效</small></span><kbd>A</kbd></button>
                  <button class="tone-gold" @click="canvasAddNode('section')"><i><AppIcon name="crop" /></i><span><b>创作分区</b><small>组织流程与素材区域</small></span></button>
                </div>
              </div>

              <div v-if="canvasState.quickConnectMenu.open" class="canvas-quick-connect-menu canvas-ui" :style="{ left: canvasState.quickConnectMenu.x + 'px', top: canvasState.quickConnectMenu.y + 'px' }" @pointerdown.stop>
                <div class="canvas-quick-connect-head"><span>连接并创建</span><button @click="canvasState.quickConnectMenu.open = false"><AppIcon name="x" /></button></div><p>新节点将自动排列到右侧并完成连线</p>
                <div class="canvas-quick-connect-grid"><button @click="canvasQuickCreate('note')"><AppIcon name="wand-sparkles" /><span>便签</span></button><button @click="canvasQuickCreate('infer')"><AppIcon name="cpu" /><span>推理</span></button><button @click="canvasQuickCreate('image')"><AppIcon name="image" /><span>图片</span></button><button @click="canvasQuickCreate('video')"><AppIcon name="video" /><span>视频</span></button><button @click="canvasQuickCreate('audio')"><AppIcon name="headphones" /><span>音频</span></button></div>
                <small><i></i>也可以拖动卡片右侧圆点，连接已有节点</small>
              </div>

              <div class="canvas-world" :style="canvasWorldStyle">
                <svg class="canvas-links" width="1" height="1" aria-label="节点连线">
                  <defs><filter id="canvas-edge-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
                  <g v-for="edge in canvasEdges" :key="edge.id" :class="['canvas-edge', 'tone-' + edge.tone, 'active']">
                    <path class="canvas-edge-shadow" :d="canvasEdgePath(edge)" />
                    <path class="canvas-edge-line" :d="canvasEdgePath(edge)" />
                    <circle class="canvas-edge-orb" r="3.5"><animateMotion :path="canvasEdgePath(edge)" dur="4.5s" repeatCount="indefinite" /></circle>
                    <g
                      class="canvas-edge-disconnect"
                      :transform="'translate(' + canvasEdgeMidpoint(edge).x + ' ' + canvasEdgeMidpoint(edge).y + ')'"
                      role="button"
                      tabindex="0"
                      aria-label="断开这条连接"
                      @pointerdown.stop
                      @click.stop="canvasDisconnectEdge(edge.id)"
                      @keydown.enter.stop.prevent="canvasDisconnectEdge(edge.id)"
                      @keydown.space.stop.prevent="canvasDisconnectEdge(edge.id)"
                    >
                      <title>点击断开连接</title>
                      <circle class="canvas-edge-disconnect-hit" r="14" />
                      <circle class="canvas-edge-disconnect-core" r="4.5" />
                      <path class="canvas-edge-disconnect-cross" d="M -2.4 -2.4 L 2.4 2.4 M 2.4 -2.4 L -2.4 2.4" />
                    </g>
                  </g>
                  <path v-if="canvasDraftEdgePath" class="canvas-edge-draft" :d="canvasDraftEdgePath" />
                </svg>

                <article
                  v-for="node in canvasNodes"
                  :key="node.id"
                  :data-node-id="node.id"
                  :class="['story-canvas-node', 'node-' + node.type, 'tone-' + node.color, { selected: canvasState.selectedId === node.id, 'is-connect-source': canvasState.connectingFrom === node.id, 'is-connect-target': canvasState.connectionTargetId === node.id, 'is-generating': node.status === 'running' || node.status === 'queued' }]"
                  :style="canvasNodeStyle(node)"
                  @pointerdown="canvasNodePointerDown($event, node)"
                >
                  <button class="canvas-port canvas-port-in" :data-node-id="node.id" :aria-label="'连接到' + node.title" title="将连线拖到这张卡片的任意位置" @pointerdown.stop></button>
                  <button class="canvas-port canvas-port-out" :aria-label="'从' + node.title + '拖出连线'" title="拖拽到另一张卡片进行连接" @pointerdown.stop.prevent="canvasStartConnection($event, node)"></button>
                  <div class="canvas-node-link-rail" @pointerdown.stop>
                    <i></i><button :aria-label="'从' + node.title + '创建下一个节点'" title="创建并自动连接下一个节点" @click.stop="canvasOpenQuickConnect($event, node)"><AppIcon name="plus" /></button>
                  </div>
                  <div class="canvas-node-topline">
                    <span class="canvas-node-icon">
                      <AppIcon name="wand-sparkles" />
                      <AppIcon name="cpu" />
                      <AppIcon name="image" />
                      <AppIcon name="video" />
                      <AppIcon name="headphones" />
                      <AppIcon name="crop" />
                    </span>
                    <span class="canvas-node-kicker">{{ node.type === 'note' ? 'IDEA' : node.type === 'infer' ? 'AI INFERENCE' : node.type === 'image' ? 'IMAGE GEN' : node.type === 'video' ? 'VIDEO GEN' : node.type === 'audio' ? 'AUDIO ASSET' : 'SECTION' }}</span>
                    <span :class="['canvas-node-status', 'is-' + node.status]">{{ node.status === 'running' ? 'RUN' : node.status === 'queued' ? 'QUEUE' : node.status === 'done' ? 'DONE' : node.status === 'error' ? 'ERROR' : 'READY' }}</span>
                    <button v-if="['image','video','audio'].includes(node.type) && node.mediaUrl" class="canvas-node-media-action" :aria-label="'下载' + node.title" title="下载媒体" @pointerdown.stop @click.stop="canvasDownloadMedia(node)"><AppIcon name="download" /></button>
                    <button v-if="['image','video','audio'].includes(node.type) && node.mediaUrl" class="canvas-node-media-action" :aria-label="'打开' + node.title + '素材文件夹'" title="打开素材文件夹" @pointerdown.stop @click.stop="canvasOpenMediaFolder(node)"><AppIcon name="folder-open" /></button>
                    <button class="canvas-node-delete" :aria-label="'删除' + node.title" title="删除这张卡片" @pointerdown.stop @click.stop="canvasDeleteNode(node.id)"><AppIcon name="trash-2" /></button>
                  </div>
                  <h3>{{ node.title }}</h3>
                  <div v-if="['infer','image','video'].includes(node.type) && canvasNodeInputSummary(node).total" class="canvas-node-inputs"><span v-if="canvasNodeInputSummary(node).imageCount"><AppIcon name="image" />{{ canvasNodeInputSummary(node).imageCount }} 图</span><span v-if="canvasNodeInputSummary(node).videoCount"><AppIcon name="video" />{{ canvasNodeInputSummary(node).videoCount }} 视频</span><span v-if="canvasNodeInputSummary(node).audioCount"><AppIcon name="headphones" />{{ canvasNodeInputSummary(node).audioCount }} 音频</span><span v-if="canvasNodeInputSummary(node).textCount"><AppIcon name="file-text" />{{ canvasNodeInputSummary(node).textCount }} 文本</span></div>
                  <p v-if="node.type === 'note' || node.type === 'section'">{{ node.content || '点击卡片，在下方开始记录' }}</p>
                  <div v-else-if="node.type === 'infer'" class="canvas-ai-result">
                    <p v-if="node.result">{{ node.result }}</p>
                    <span v-else><AppIcon name="cpu" />{{ node.content || '等待输入提示词' }}</span>
                  </div>
                  <div v-else-if="node.type === 'image'" class="canvas-media-window">
                    <img v-if="node.mediaUrl && !node.mediaError" :src="node.mediaUrl" alt="生成图片" draggable="false" @contextmenu.stop.prevent="canvasDownloadMedia(node)" @load="canvasHandleMediaLoad(node)" @error="canvasHandleMediaError(node, 'image')" />
                    <div v-else :class="{ 'canvas-media-broken': node.mediaError }"><el-icon><WarningFilled v-if="node.mediaError" /><Picture v-else /></el-icon><b>{{ node.mediaError ? '图片加载失败' : 'IMAGE' }}</b><small>{{ node.mediaError ? '媒体文件已损坏或不存在，请重新上传' : (node.content || '图片生成或本地上传') }}</small><button class="canvas-media-node-upload" @pointerdown.stop @click.stop="canvasImportMedia(node, 'image')"><AppIcon name="upload" /><span>{{ node.mediaError ? '重新上传' : '上传图片' }}</span></button></div>
                  </div>
                  <div v-else-if="node.type === 'video'" class="canvas-media-window is-video">
                    <video v-if="node.mediaUrl && !node.mediaError" :src="node.mediaUrl" controls playsinline preload="metadata" @loadedmetadata="canvasHandleMediaLoad(node)" @error="canvasHandleMediaError(node, 'video')"></video>
                    <div v-else :class="{ 'canvas-media-broken': node.mediaError }"><el-icon><WarningFilled v-if="node.mediaError" /><VideoCamera v-else /></el-icon><b>{{ node.mediaError ? '视频加载失败' : 'VIDEO' }}</b><small>{{ node.mediaError ? '媒体文件不可用，请重新上传' : (canvasNodeInputSummary(node).imageCount ? ('已连接 ' + canvasNodeInputSummary(node).imageCount + ' 张图片，' + canvasNodeInputSummary(node).readyImageCount + ' 张可用') : '视频生成或本地上传') }}</small><button class="canvas-media-node-upload" @pointerdown.stop @click.stop="canvasImportMedia(node, 'video')"><AppIcon name="upload" /><span>{{ node.mediaError ? '重新上传' : '上传视频' }}</span></button></div>
                  </div>
                  <div v-else-if="node.type === 'audio'" class="canvas-audio-card">
                    <div class="canvas-audio-orbit"><i></i><i></i></div>
                    <div class="canvas-audio-waveform"><i v-for="(bar, barIndex) in canvasAudioWaveform(node)" :key="barIndex" :style="{ height: bar + '%' }"></i></div>
                    <audio v-if="node.mediaUrl && !node.mediaError" :src="node.mediaUrl" controls preload="metadata" @pointerdown.stop @loadedmetadata="canvasHandleMediaLoad(node)" @error="canvasHandleMediaError(node, 'audio')"></audio>
                    <div v-else class="canvas-audio-empty"><b>AUDIO TRACK</b><span>{{ node.content }}</span></div>
                    <button class="canvas-audio-import" @pointerdown.stop @click.stop="canvasImportAudio(node)"><AppIcon name="upload" /><span>{{ node.mediaUrl ? '替换音频' : '导入音频' }}</span></button>
                  </div>
                  <div v-if="['image','video'].includes(node.type) && node.mediaUrl" class="canvas-node-media-actions" @pointerdown.stop @click.stop>
                    <button class="is-download" :aria-label="'下载' + node.title" title="下载媒体；也可在图片上右键下载" @click.stop="canvasDownloadMedia(node)"><AppIcon name="download" /></button>
                    <button :aria-label="'打开' + node.title + '素材文件夹'" title="打开素材文件夹" @click.stop="canvasOpenMediaFolder(node)"><AppIcon name="folder-open" /></button>
                  </div>
                  <div v-if="node.status === 'running' || node.status === 'queued'" class="canvas-generation-overlay">
                    <div class="canvas-generation-panel">
                      <div class="canvas-generation-panel-head"><span>{{ node.status === 'queued' ? 'WAITING' : 'GENERATING' }}</span><strong>{{ Math.round(node.progress || 0) }}%</strong></div>
                      <div class="canvas-generation-track"><i :style="{ width: Math.max(4, node.progress || 4) + '%' }"></i></div>
                      <p>{{ node.message || '模型正在生成…' }}</p>
                    </div>
                  </div>
                  <div v-if="node.status === 'error'" class="canvas-generation-error"><AppIcon name="circle-alert" /><span>{{ node.error || '生成失败' }}</span></div>
                  <div v-if="canvasState.selectedId === node.id" :class="['canvas-node-composer', 'canvas-ui', { 'is-media-composer': ['image','video'].includes(node.type) }]" @pointerdown.stop @click.stop>
                    <div v-if="node.type === 'video'" class="canvas-media-composer-tabs">
                      <button :class="{ active: node.composerMode === 'text' }" @click.stop="canvasSetComposerMode(node, 'text')">文生视频</button>
                      <button :class="{ active: node.composerMode === 'image' }" @click.stop="canvasSetComposerMode(node, 'image')">图生视频</button>
                      <button :class="{ active: node.composerMode === 'reference' }" @click.stop="canvasSetComposerMode(node, 'reference')">全能参考</button>
                      <button class="canvas-media-composer-close" title="收起" @click.stop="canvasState.selectedId = ''"><AppIcon name="x" /></button>
                    </div>
                    <div v-else-if="node.type === 'image'" class="canvas-media-composer-tabs">
                      <button class="active">图片生成</button>
                      <button @click.stop="canvasImportMedia(node, 'image')">上传图片</button>
                      <button class="canvas-media-composer-close" title="收起" @click.stop="canvasState.selectedId = ''"><AppIcon name="x" /></button>
                    </div>
                    <div v-else class="canvas-node-composer-head">
                      <div><span>{{ canvasNodeTypeLabel(node.type) }}</span><b>编辑卡片</b></div>
                      <button title="收起" @click.stop="canvasState.selectedId = ''"><AppIcon name="x" /></button>
                    </div>
                    <input v-if="!['image','video'].includes(node.type)" v-model="node.title" class="canvas-node-composer-title" maxlength="48" aria-label="卡片标题" @change="canvasUpdateNode" />
                    <div v-else class="canvas-media-composer-strip">
                      <input v-model="node.title" maxlength="48" :aria-label="node.type === 'video' ? '视频标题' : '图片标题'" @change="canvasUpdateNode" />
                      <button @click.stop="canvasImportMedia(node, node.type)"><AppIcon name="upload" /><span>{{ node.mediaUrl ? '替换素材' : '上传素材' }}</span></button>
                    </div>
                    <div v-if="node.type === 'video'" class="canvas-media-reference-grid">
                      <button @click.stop="canvasImportReference(node, 'image')"><AppIcon name="image" /><span>图片参考</span></button>
                      <button @click.stop="canvasImportReference(node, 'video')"><AppIcon name="video" /><span>视频素材</span></button>
                      <button @click.stop="canvasImportReference(node, 'audio')"><AppIcon name="headphones" /><span>音频素材</span></button>
                    </div>
                    <div class="canvas-composer-prompt">
                      <div v-if="node.mentions?.length" class="canvas-prompt-mentions" aria-label="已引用素材">
                        <button v-for="mention in node.mentions" :key="mention.id" :class="'kind-' + mention.kind" :title="'移除引用：' + mention.label" @click.stop="canvasRemoveMention(node, mention.id)">
                          <img v-if="mention.kind === 'image' && mention.mediaUrl" :src="mention.mediaUrl" alt="" loading="lazy" decoding="async" />
                          <span v-else><el-icon><Picture v-if="mention.kind === 'image'" /><VideoCamera v-else-if="mention.kind === 'video'" /><Headset v-else-if="mention.kind === 'audio'" /><Document v-else /></el-icon></span>
                          <b>{{ mention.label }}</b><AppIcon name="x" />
                        </button>
                      </div>
                      <div class="canvas-prompt-editor">
                        <textarea v-model="node.content" class="canvas-node-composer-input" rows="4" :data-canvas-prompt-id="node.id" :maxlength="['image','video'].includes(node.type) ? 10000 : 60000" :placeholder="node.type === 'video' ? '描述画面，输入 @ 引用人物或素材…' : node.type === 'image' ? '描述图片，输入 @ 引用人物或素材…' : '输入 @ 引用画布内容或项目素材…'" aria-label="卡片内容" @input="canvasMentionInput($event, node)" @click="canvasMentionCaretChanged($event, node)" @keydown="canvasMentionKeydown($event, node)" @blur="canvasMentionBlur(node)" @change="canvasUpdateNode"></textarea>
                        <button class="canvas-mention-trigger" title="引用素材" aria-label="引用素材" @mousedown.prevent @click.stop="canvasOpenMentionMenu($event, node)">@</button>
                        <span v-if="['image','video'].includes(node.type)">{{ node.content.length }}/10000</span>
                      </div>
                      <div v-if="canvasMention.open && canvasMention.nodeId === node.id" class="canvas-mention-menu" @mousedown.prevent>
                        <header><div><small>REFERENCE</small><b>引用参考</b></div><button title="关闭" @click.stop="canvasCloseMention(node.id)"><AppIcon name="x" /></button></header>
                        <div v-if="canvasMentionCandidates.length" class="canvas-mention-list">
                          <button v-for="(candidate, candidateIndex) in canvasMentionCandidates" :key="candidate.id" :class="{ active: candidateIndex === canvasMention.activeIndex, selected: canvasMentionIsSelected(node, candidate) }" @mouseenter="canvasMention.activeIndex = candidateIndex" @mousedown.prevent="canvasSelectMention(node, candidate)">
                            <span class="canvas-mention-thumb">
                              <img v-if="candidate.kind === 'image' && candidate.mediaUrl" :src="candidate.mediaUrl" alt="" loading="lazy" decoding="async" />
                              <video v-else-if="candidate.kind === 'video' && candidate.mediaUrl" :src="candidate.mediaUrl" muted preload="metadata"></video>
                              <el-icon v-else><Picture v-if="candidate.kind === 'image'" /><VideoCamera v-else-if="candidate.kind === 'video'" /><Headset v-else-if="candidate.kind === 'audio'" /><Document v-else /></el-icon>
                            </span>
                            <span><b>{{ candidate.label }}</b><small>{{ candidate.category }} · {{ canvasMentionKindLabel(candidate.kind) }}</small></span>
                            <AppIcon name="check" />
                          </button>
                        </div>
                        <div v-else class="canvas-mention-empty">没有匹配的引用素材</div>
                      </div>
                    </div>
                    <div v-if="['infer','image','video'].includes(node.type) && canvasNodeInputSummary(node).total" class="canvas-node-composer-inputs">
                      <strong>上游输入</strong><span>{{ canvasNodeInputSummary(node).total }} 个节点</span><span v-if="canvasNodeInputSummary(node).imageCount">{{ canvasNodeInputSummary(node).imageCount }} 张图片</span><span v-if="canvasNodeInputSummary(node).videoCount">{{ canvasNodeInputSummary(node).videoCount }} 个视频</span><span v-if="canvasNodeInputSummary(node).audioCount">{{ canvasNodeInputSummary(node).audioCount }} 条音频</span><span v-if="canvasNodeInputSummary(node).textCount">{{ canvasNodeInputSummary(node).textCount }} 条文本</span>
                    </div>
                    <div v-if="node.type === 'image'" class="canvas-node-composer-settings is-model-grid is-image-settings">
                      <label><span>生图渠道</span><select :value="canvasImageChannelValue(node)" @change="canvasImageChannelChanged(node, $event.target.value)"><option v-for="channel in canvasImageChannelOptions" :key="channel.value" :value="channel.value">{{ channel.label }}</option></select></label>
                      <label><span>图片模型</span><select v-model="node.model" @change="canvasImageModelChanged(node)"><option v-for="modelOption in canvasImageModelOptions(node)" :key="modelOption.value" :value="modelOption.value">{{ modelOption.label }}</option></select></label>
                      <label><span>画面比例</span><select v-model="node.ratio" @change="canvasUpdateNode"><option v-for="ratioOption in canvasImageRatioOptions(node)" :key="ratioOption.value" :value="ratioOption.value">{{ ratioOption.label }}</option></select></label>
                      <label v-if="['libtv-cli', 'dreamina-cli', 'updream', 'neowow'].includes(node.provider)"><span>清晰度</span><select v-model="node.resolution" @change="canvasUpdateNode"><option v-for="resolutionOption in canvasImageResolutionOptions(node)" :key="resolutionOption.value || 'default'" :value="resolutionOption.value">{{ resolutionOption.label }}</option></select></label>
                      <label v-if="node.provider === 'neowow' && canvasImageQualityOptions(node).length"><span>画质</span><select v-model="node.quality" @change="canvasUpdateNode"><option v-for="qualityOption in canvasImageQualityOptions(node)" :key="qualityOption.value" :value="qualityOption.value">{{ qualityOption.label }}</option></select></label>
                    </div>
                    <div v-if="node.type === 'video'" class="canvas-node-composer-settings is-model-grid">
                      <label><span>视频渠道</span><select v-model="node.provider" @change="canvasVideoProviderChanged(node)"><option v-for="providerOption in canvasVideoProviderOptions" :key="providerOption.value" :value="providerOption.value">{{ providerOption.label }}</option></select></label>
                      <label><span>视频模型</span><select v-model="node.model" @change="canvasVideoModelChanged(node)"><option v-for="modelOption in canvasVideoModelOptions(node)" :key="modelOption.value" :value="modelOption.value">{{ modelOption.label }}</option></select></label>
                      <label><span>画面比例</span><select v-model="node.ratio" @change="canvasUpdateNode"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option></select></label>
                      <label><span>视频时长</span><select v-model.number="node.duration" @change="canvasUpdateNode"><option v-for="seconds in canvasVideoDurationOptions(node)" :key="seconds" :value="seconds">{{ seconds }} 秒</option></select></label>
                      <label><span>清晰度</span><select v-model="node.resolution" @change="canvasUpdateNode"><option v-for="resolutionOption in canvasVideoResolutionOptions(node)" :key="resolutionOption.value" :value="resolutionOption.value">{{ resolutionOption.label }}</option></select></label>
                    </div>
                    <div v-if="node.type === 'video'" :class="['canvas-node-composer-reference', { active: canvasNodeInputSummary(node).imageCount }]">
                      <AppIcon name="image" /><span>{{ canvasNodeInputSummary(node).imageCount ? ('已连接 ' + canvasNodeInputSummary(node).imageCount + ' 张图片，其中 ' + canvasNodeInputSummary(node).readyImageCount + ' 张可用') : '可将多张图片卡连接到此视频卡' }}</span>
                    </div>
                    <div class="canvas-node-composer-actions">
                      <button class="is-subtle" title="切换颜色" @click.stop="canvasCycleNodeColor"><AppIcon name="wand-sparkles" /></button>
                      <button v-if="node.type === 'audio'" class="is-audio" @click.stop="canvasImportAudio(node)"><AppIcon name="upload" /><span>{{ node.mediaUrl ? '替换音频' : '导入音频' }}</span></button>
                      <button v-if="node.type === 'video' && node.status === 'done' && node.mediaUrl" class="is-frame" title="截取视频尾帧" @click.stop="canvasCaptureTailFrame(node)"><AppIcon name="camera" /></button>
                      <button v-if="node.type === 'video' && node.status === 'done' && node.mediaUrl" class="is-frame" title="自定义选择视频画面" @click.stop="canvasOpenFramePicker(node)"><AppIcon name="film" /></button>
                      <button class="is-delete" title="删除卡片" @click.stop="canvasDeleteNode(node.id)"><AppIcon name="trash-2" /></button>
                      <button v-if="['infer','image','video'].includes(node.type)" class="is-run" :disabled="node.status === 'running' || node.status === 'queued'" @click.stop="canvasRunNode(node)"><span>{{ node.status === 'running' || node.status === 'queued' ? (node.message || '生成中…') : node.status === 'done' ? '再次生成' : '开始生成' }}</span><AppIcon name="play" /></button>
                    </div>
                  </div>
                  <span v-if="node.type === 'note'" class="canvas-note-fold" aria-hidden="true"></span>
                  <span v-if="node.type === 'section'" class="canvas-section-label">DROP AREA</span>
                </article>
              </div>

              <aside v-if="canvasAgent.open" class="canvas-agent-panel canvas-ui" @pointerdown.stop>
                <header class="canvas-agent-head"><div class="canvas-agent-avatar"><AppIcon name="tv" /><i></i></div><div><span>Freedom CANVAS AGENT</span><h2>画布智能控制台</h2><p><i></i>{{ canvasAgent.running ? '正在执行画布任务' : '已连接当前画布' }}</p></div><button @click="canvasCloseAgent"><AppIcon name="x" /></button></header>
                <div class="canvas-agent-scope"><span><AppIcon name="cable" />{{ canvasNodes.length }} 节点</span><span><AppIcon name="share-2" />{{ canvasEdges.length }} 连线</span><b>{{ canvasActiveProject?.name }}</b></div>
                <div class="canvas-agent-messages"><article v-for="(msg, msgIndex) in canvasAgent.messages" :key="msgIndex" :class="['canvas-agent-message', msg.role, { error: msg.error }]"><small>{{ msg.role === 'user' ? '你' : 'Freedom Agent' }} · {{ msg.time }}</small><p>{{ msg.text }}</p><div v-if="msg.actions?.length" class="canvas-agent-action-list"><span v-for="(action, actionIndex) in msg.actions" :key="actionIndex" :class="{ failed: !action.ok }"><el-icon><CircleCheck v-if="action.ok" /><WarningFilled v-else /></el-icon>{{ canvasAgentActionLabel(action) }}</span></div></article><div v-if="canvasAgent.running" class="canvas-agent-thinking"><i></i><i></i><i></i><span>Freedom Agent 正在理解画布并编排操作…</span></div></div>
                <div v-if="canvasAgent.messages.length <= 1" class="canvas-agent-starters"><span>试试这样指挥画布</span><button @click="canvasAgentSend('创建角色设定、生图卡和视频卡，自动连线并整理布局')">搭建角色到视频工作流</button><button @click="canvasAgentSend('创建剧本推理卡、三张分镜图片卡和一个视频卡，自动连线')">搭建分镜视频链路</button><button @click="canvasAgentSend('分析当前画布，补齐缺少的剧本、图片、视频或音频节点')">检查并补齐创作链路</button></div>
                <div class="canvas-agent-composer"><textarea v-model="canvasAgent.input" rows="3" maxlength="12000" placeholder="告诉Freedom Agent 要如何操作这张画布…" @keydown.ctrl.enter.prevent="canvasAgentSend()"></textarea><div><span>Ctrl + Enter 发送</span><button :disabled="canvasAgent.running || !canvasAgent.input.trim()" @click="canvasAgentSend()"><AppIcon name="send" /><span>{{ canvasAgent.running ? '执行中' : '发送并执行' }}</span></button></div></div>
              </aside>
              <div v-if="!canvasNodes.length" class="canvas-blank-welcome canvas-ui">
                <div class="canvas-blank-orbit"><span><AppIcon name="upload" /></span><i></i><i></i></div>
                <div class="eyebrow">CREATE ON CANVAS</div>
                <h2>上传素材，或开始生成</h2>
                <div class="canvas-blank-actions">
                  <button @click="canvasOpenMediaUpload('image')"><AppIcon name="image" /><span>图片</span></button>
                  <button @click="canvasOpenMediaUpload('video')"><AppIcon name="video" /><span>视频</span></button>
                  <button @click="canvasOpenMediaUpload('audio')"><AppIcon name="headphones" /><span>音频</span></button>
                  <button @click="canvasAddNode('video')"><AppIcon name="play" /><span>视频生成</span></button>
                </div>
                <small>支持拖放图片、视频和音频到画布</small>
              </div>

              <div v-if="canvasState.showMinimap && canvasNodes.length" class="canvas-minimap canvas-ui">
                <div class="canvas-minimap-head"><span>CANVAS MAP</span><button @click="canvasState.showMinimap = false"><AppIcon name="x" /></button></div>
                <div
                  class="canvas-minimap-field"
                  :class="{ 'is-dragging-viewport': canvasState.interaction?.type === 'minimap' }"
                  role="application"
                  aria-label="画布导航图，点击可跳转，拖动视野框可移动画布"
                  @pointerdown.stop.prevent="canvasMinimapPointerDown"
                  @pointermove.stop.prevent="canvasMinimapPointerMove"
                  @pointerup.stop.prevent="canvasMinimapPointerUp"
                  @pointercancel.stop.prevent="canvasMinimapPointerUp"
                ><i v-for="node in canvasNodes" :key="node.id" :class="['mini-node', 'tone-' + node.color, { active: node.id === canvasState.selectedId }]" :style="canvasMiniStyle(node)"></i><span class="mini-viewport" :style="canvasMiniViewportStyle" title="拖动以移动画布"></span></div>
              </div>

              <div class="canvas-statusbar canvas-ui">
                <span><i class="status-online"></i>{{ canvasActiveProject?.name }}</span>
                <span>空格/中键平移</span><span>触控板平移 · Ctrl+滚轮缩放</span><span>双击创建灵感</span>
                <b>{{ canvasNodes.length }} NODES · {{ canvasEdges.length }} LINKS</b>
              </div>
            </div>
          </section>
          <el-dialog v-model="canvasFramePicker.visible" title="自定义选择视频画面" width="min(860px, 94vw)" destroy-on-close class="canvas-frame-dialog">
            <div class="canvas-frame-picker">
              <video ref="canvasFramePickerVideo" :src="canvasFramePicker.videoUrl" controls playsinline preload="metadata" @loadedmetadata="canvasFramePickerLoaded" @timeupdate="canvasFramePickerTimeUpdate" @seeked="canvasFramePickerTimeUpdate"></video>
              <div class="canvas-frame-controls">
                <span>{{ formatCanvasFrameTime(canvasFramePicker.currentTime) }}</span>
                <el-slider :model-value="canvasFramePicker.currentTime" :min="0" :max="canvasFramePicker.duration || 0" :step="0.01" :show-tooltip="false" @input="canvasSeekFramePicker" />
                <span>{{ formatCanvasFrameTime(canvasFramePicker.duration) }}</span>
              </div>
            </div>
            <template #footer>
              <el-button @click="canvasFramePicker.visible = false">取消</el-button>
              <el-button type="primary" :loading="canvasFramePicker.saving" @click="canvasSaveSelectedFrame"><AppIcon name="camera" /><span>创建图片节点</span></el-button>
            </template>
          </el-dialog>
        </template>
`;
