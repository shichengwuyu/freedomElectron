export const chatView = /* html */ `
      <section v-if="chatMounted" :class="['chat-workspace', 'chat-v2', { 'is-parked': view !== 'chat' }]">
        <aside :class="['chat-history', { collapsed: !chat.sidebarOpen }]">
          <div class="chat-history-head">
            <button class="chat-brand-button" type="button" @click="chat.sidebarOpen = !chat.sidebarOpen">
              <span class="chat-brand-orb"><AppIcon name="tv" /></span>
              <span v-if="chat.sidebarOpen"><b>Freedom Chat</b><small>LOCAL INTELLIGENCE</small></span>
            </button>
            <div v-if="chat.sidebarOpen" class="chat-new-row">
              <button class="chat-new-button" type="button" @click="createChatConversation()"><AppIcon name="plus" /><span>新建对话</span><kbd>Ctrl N</kbd></button>
              <button class="chat-temp-button" type="button" @click="createChatConversation({ temporary: true })" title="临时聊天，关闭应用后自动删除"><AppIcon name="timer" /></button>
            </div>
          </div>

          <template v-if="chat.sidebarOpen">
            <form class="chat-search" @submit.prevent="performGlobalChatSearch">
              <AppIcon name="search" /><input v-model="chat.searchQuery" class="chat-global-search-input" placeholder="搜索所有对话和消息" /><button type="submit">↵</button>
            </form>
            <div class="chat-status-tabs">
              <button :class="{ active: chat.status === 'active' }" @click="setChatStatus('active')">对话</button>
              <button :class="{ active: chat.status === 'archived' }" @click="setChatStatus('archived')">归档</button>
              <button :class="{ active: chat.status === 'trash' }" @click="setChatStatus('trash')">回收站</button>
            </div>
            <div v-if="chatFolders().length" class="chat-folder-filter">
              <button :class="{ active: !chat.folderFilter }" @click="chat.folderFilter = ''">全部</button>
              <button v-for="folder in chatFolders()" :key="folder" :class="{ active: chat.folderFilter === folder }" @click="chat.folderFilter = folder">{{ folder }}</button>
            </div>
            <div class="chat-history-label"><span>{{ chat.status === 'active' ? '最近对话' : chat.status === 'archived' ? '已归档' : '已删除' }}</span><b>{{ filteredChatConversations().length }}</b></div>
            <div class="chat-thread-list">
              <div v-if="chat.loading" class="chat-list-empty"><span class="chat-loading-dot"></span>正在打开本地数据库</div>
              <div v-else-if="!filteredChatConversations().length" class="chat-list-empty">这里还没有对话</div>
              <div v-for="thread in filteredChatConversations()" :key="thread.id" :class="['chat-thread-item', { active: thread.id === chat.activeId }]" role="button" tabindex="0" @click="selectChatConversation(thread.id)" @keydown.enter="selectChatConversation(thread.id)">
                <span class="chat-thread-icon"><AppIcon name="message-circle" /></span>
                <span class="chat-thread-copy">
                  <input v-if="chat.renameId === thread.id" v-model="chat.renameText" class="chat-rename-input" @click.stop @keydown.enter.prevent="commitRenameChat" @keydown.esc="chat.renameId = ''" @blur="commitRenameChat" />
                  <b v-else>{{ thread.title }}</b>
                  <small><span v-if="thread.temporary">临时 · </span>{{ thread.folder || chatThreadTime(thread.updatedAt) }}</small>
                </span>
                <span class="chat-thread-actions" @click.stop>
                  <i v-if="thread.pinned" class="chat-pin-mark"></i>
                  <template v-if="chat.status === 'active'">
                    <span @click="toggleChatPin(thread)" title="置顶">⌁</span><span @click="beginRenameChat(thread)" title="重命名">✎</span><span @click="archiveChatConversation(thread)" title="归档">□</span><span @click="trashChatConversation(thread)" title="删除">×</span>
                  </template>
                  <template v-else-if="chat.status === 'archived'">
                    <span @click="restoreChatConversation(thread)" title="恢复">↩</span><span @click="trashChatConversation(thread)" title="删除">×</span>
                  </template>
                  <template v-else><span @click="restoreChatConversation(thread)" title="恢复">↩</span><span @click="purgeChatConversation(thread)" title="永久删除">×</span></template>
                </span>
              </div>
            </div>
            <div class="chat-history-foot"><div class="chat-database-state"><span><AppIcon name="circle-dollar-sign" /></span><div><b>本地 SQLite</b><small>对话已自动保存到本机</small></div><i></i></div></div>
          </template>
        </aside>

        <main class="chat-stage">
          <header class="chat-topbar">
            <div class="chat-topbar-left">
              <button v-if="!chat.sidebarOpen" class="chat-icon-button" type="button" @click="chat.sidebarOpen = true"><AppIcon name="expand" /></button>
              <div class="chat-title-block"><div><span class="chat-live-dot"></span><small>{{ chat.sending ? (chat.compareRunning ? '正在生成对比回答' : 'AI 正在回答') : chat.imageGeneratingCount ? ('正在并发生成 ' + chat.imageGeneratingCount + ' 张图片') : currentChatConversation()?.temporary ? '临时聊天' : '已保存到本地' }}</small></div><h2>{{ currentChatConversation()?.title || 'Freedom Chat' }}</h2></div>
            </div>
            <div class="chat-topbar-tools">
              <div class="chat-model-select"><span class="chat-model-spark">✦</span><el-select :model-value="currentChatConversation()?.modelProfileId || 'auto'" @change="patchCurrentConversation({ modelProfileId: $event })"><el-option v-for="item in chatModelOptions()" :key="item.value" :label="item.label" :value="item.value"><div class="chat-model-option"><b>{{ item.label }}</b><small>{{ item.model }}</small></div></el-option></el-select></div>
              <button class="chat-context-chip" type="button" @click="chat.settingsOpen = true"><span class="chat-context-ring" :style="{ '--context-pct': chatContextPercent() + '%' }"><i></i></span><span><b>{{ chatContextPercent() }}%</b><small>上下文</small></span></button>
              <button class="chat-icon-button" type="button" @click="chat.searchOpen = true" title="搜索"><AppIcon name="search" /></button>
              <button class="chat-icon-button" type="button" @click="chat.settingsOpen = !chat.settingsOpen" title="对话设置"><AppIcon name="settings" /></button>
            </div>
          </header>

          <div v-if="chat.conversationSearch" class="chat-inline-search"><AppIcon name="search" /><input v-model="chat.conversationSearch" placeholder="搜索当前对话" /><span>{{ currentConversationMatches().length ? chat.searchMatchIndex + 1 : 0 }} / {{ currentConversationMatches().length }}</span><button @click="jumpToChatSearchMatch(-1)">↑</button><button @click="jumpToChatSearchMatch(1)">↓</button><button @click="chat.conversationSearch = ''">×</button></div>

          <div class="chat-conversation" id="gg-chat-scroll" @scroll="onChatScroll" @click="onChatMarkdownClick">
            <div v-if="!currentChatConversation()" class="chat-welcome"><div class="chat-hero-orb"><div class="chat-orb-core"><AppIcon name="tv" /></div><i class="orbit orbit-a"></i><i class="orbit orbit-b"></i><i class="orbit orbit-c"></i></div><div class="chat-welcome-copy"><span class="chat-kicker">PRIVATE · LOCAL · YOURS</span><h1>开始一段新的对话</h1><p>所有对话、提示词、分支和记忆都保存在你的本机 SQLite 数据库中。</p></div><button class="chat-welcome-new" @click="createChatConversation()"><AppIcon name="plus" />新建对话</button></div>
            <div v-else-if="!chat.messages.length" class="chat-welcome">
              <div class="chat-hero-orb"><div class="chat-orb-core"><AppIcon name="tv" /></div><i class="orbit orbit-a"></i><i class="orbit orbit-b"></i><i class="orbit orbit-c"></i></div>
              <div class="chat-welcome-copy"><span class="chat-kicker">{{ currentPrompt()?.name || 'Freedom CHAT' }} · READY</span><h1>有什么想聊的？</h1><p>可以直接提问、深入讨论、读取附件，或者切换图片模式生成画面。</p></div>
              <div class="chat-starter-grid">
                <button @click="applyChatStarter('帮我深入分析这个问题，从不同角度给出结论。')"><span class="starter-icon gold"><AppIcon name="chart-column" /></span><span><b>深度分析</b><small>拆解复杂问题与不同观点</small></span><i>↗</i></button>
                <button @click="applyChatStarter('请帮我把下面这段内容改写得更清晰、更有说服力：')"><span class="starter-icon violet"><AppIcon name="pen-line" /></span><span><b>写作改进</b><small>润色、重写与结构优化</small></span><i>↗</i></button>
                <button @click="applyChatStarter('请用通俗易懂的方式解释这个概念，并给出例子。')"><span class="starter-icon cyan"><AppIcon name="book-open" /></span><span><b>解释概念</b><small>从原理到实例逐层说明</small></span><i>↗</i></button>
                <button @click="applyChatStarter('电影感画面，精致构图，氛围光影，细节丰富', 'image')"><span class="starter-icon rose"><AppIcon name="image" /></span><span><b>生成图片</b><small>输入描述并选择画面比例</small></span><i>↗</i></button>
              </div>
              <div class="chat-capability-line"><span><i></i>本地数据库</span><span><i></i>长期记忆</span><span><i></i>回答分支</span><span><i></i>图片生成</span></div>
            </div>

            <div v-else class="chat-message-stream">
              <article v-for="msg in chat.messages" :key="msg.id" :data-message-id="msg.id" :class="['chat-message', msg.role, msg.status, { starred: msg.starred, comparing: msg.metadata?.comparisonSlot }]">
                <div class="chat-message-avatar"><span v-if="msg.role === 'assistant'" class="assistant-avatar"><AppIcon name="tv" /></span><span v-else class="user-avatar">你</span></div>
                <div class="chat-message-body">
                  <div class="chat-message-meta"><b>{{ msg.role === 'assistant' ? 'Freedom' : '你' }}</b><span>{{ chatMessageTime(msg.createdAt) }}</span><em v-if="msg.model && msg.role === 'assistant'">{{ msg.model }}</em><em v-if="msg.metadata?.comparisonSlot" class="compare-slot">模型 {{ msg.metadata.comparisonSlot }}</em><em v-if="msg.metadata?.automaticContinuationCount" class="continuation-slot">自动续写 {{ msg.metadata.automaticContinuationCount }} 次</em><i v-if="msg.starred">★</i></div>
                  <div v-if="msg.metadata?.quotedMessageId" class="chat-quoted-source">引用了一条历史消息</div>
                  <template v-if="chat.editingMessageId === msg.id">
                    <textarea v-model="chat.editingText" :data-edit-message="msg.id" class="chat-message-editor" @keydown.ctrl.enter="submitEditChatMessage(msg)" @keydown.esc="cancelEditChatMessage"></textarea>
                    <div class="chat-edit-actions"><button @click="cancelEditChatMessage">取消</button><button class="primary" @click="submitEditChatMessage(msg)">保存并重新发送</button></div>
                  </template>
                  <div v-else-if="msg.role === 'assistant'" class="chat-message-markdown" v-html="renderMessageMarkdown(msg.content)"></div>
                  <div v-else class="chat-message-text">{{ msg.content }}</div>
                  <figure v-if="msg.metadata?.imageUrl" class="chat-generated-image"><img :src="msg.metadata.imageUrl" :alt="msg.content" loading="lazy" decoding="async" /><figcaption><span>{{ msg.metadata.ratio }}<template v-if="msg.metadata.width && msg.metadata.height"> · {{ msg.metadata.width }}×{{ msg.metadata.height }}</template> · AI Generated</span><a :href="msg.metadata.imageUrl" download>下载原图</a></figcaption></figure>
                  <div v-if="msg.metadata?.attachments?.length" class="chat-message-files"><span v-for="file in msg.metadata.attachments" :key="file.name"><AppIcon name="file-text" />{{ file.name }}</span></div>
                  <div v-if="msg.role === 'assistant' && msg.metadata?.webSources?.length" class="chat-web-sources">
                    <span><AppIcon name="cable" />联网来源</span>
                    <a v-for="(source, sourceIndex) in msg.metadata.webSources" :key="source.url" :href="source.url" target="_blank" rel="noreferrer noopener" :title="source.snippet || source.url">{{ sourceIndex + 1 }} · {{ source.title }}</a>
                  </div>
                  <div v-if="msg.status === 'generating'" class="chat-generating-state"><span class="chat-typing-caret"></span>{{ msg.metadata?.webSearch && msg.metadata?.webSearchStatus !== 'done' ? '正在联网搜索' : '正在生成' }}</div>
                  <div v-if="msg.status === 'error'" class="chat-message-error">{{ msg.error || '生成失败' }}</div>
                  <div v-if="msg.role === 'assistant' && msg.metadata?.durationMs" class="chat-response-stats">{{ (msg.metadata.durationMs / 1000).toFixed(1) }} 秒 · {{ Math.ceil(msg.content.length / 2.2).toLocaleString() }} tokens</div>
                  <div v-if="msg.versionIndex > 1 || chat.versions[msg.id]?.length > 1" class="chat-version-row"><button @click="loadChatMessageVersions(msg)"><AppIcon name="clock" />回答版本 {{ msg.versionIndex }}</button></div>
                  <div v-if="chat.versionPickerMessageId === msg.id" class="chat-version-picker"><button v-for="version in chat.versions[msg.id]" :key="version.id" :class="{ active: version.activeVersion }" @click="activateChatMessageVersion(msg, version)">版本 {{ version.versionIndex }}<small>{{ chatMessageTime(version.updatedAt) }}</small></button></div>
                  <div v-if="msg.status !== 'generating' && chat.editingMessageId !== msg.id" class="chat-message-actions">
                    <button @click="copyChatMessage(msg.content)"><AppIcon name="copy" />复制</button>
                    <button @click="quoteChatMessage(msg)"><AppIcon name="message-square" />引用</button>
                    <button @click="toggleStarChatMessage(msg)"><AppIcon name="star" />{{ msg.starred ? '取消收藏' : '收藏' }}</button>
                    <button v-if="msg.role === 'user'" @click="startEditChatMessage(msg)"><AppIcon name="pencil" />编辑</button>
                    <button v-if="msg.role === 'assistant'" @click="regenerateChatMessage(msg)"><AppIcon name="refresh-cw" />重新生成</button>
                    <button v-if="msg.role === 'assistant' && (msg.status === 'stopped' || msg.content.length > 500)" @click="continueChatMessage(msg)"><AppIcon name="chevron-right" />继续</button>
                    <button v-if="msg.role === 'assistant'" :class="{ selected: msg.metadata?.rating === 'up' }" @click="rateChatMessage(msg, msg.metadata?.rating === 'up' ? '' : 'up')">👍</button>
                    <button v-if="msg.role === 'assistant'" :class="{ selected: msg.metadata?.rating === 'down' }" @click="rateChatMessage(msg, msg.metadata?.rating === 'down' ? '' : 'down')">👎</button>
                    <button @click="branchFromChatMessage(msg)"><AppIcon name="share-2" />创建分支</button>
                    <button class="danger" @click="deleteChatMessage(msg)"><AppIcon name="trash-2" />删除</button>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <button v-if="!chat.atBottom" class="chat-scroll-bottom" @click="scrollChatToBottom()"><AppIcon name="arrow-down" /><b v-if="chat.unreadCount">{{ chat.unreadCount }}</b></button>

          <footer class="chat-composer-zone">
            <section :class="['chat-composer', { focused: chat.input, dragging: chat.dragOver }]" @dragenter.prevent="chat.dragOver = true" @dragover.prevent="chat.dragOver = true" @dragleave.prevent="chat.dragOver = false" @drop="onChatDrop">
              <div v-if="chat.quotedMessage" class="chat-quote-preview"><span><AppIcon name="message-square" />引用 {{ chat.quotedMessage.role === 'user' ? '你的消息' : 'Freedom 的回答' }}</span><p>{{ chat.quotedMessage.content.slice(0, 120) }}</p><button @click="chat.quotedMessage = null">×</button></div>
              <div v-if="activeChatSkills().length || chat.skillImporting" class="chat-skill-strip">
                <div v-for="skill in activeChatSkills()" :key="skill.id" class="chat-skill-chip" :title="skill.description || skill.name"><span><AppIcon name="wand-sparkles" /></span><b>{{ skill.name }}</b><small>Skill</small><button type="button" title="停用" aria-label="停用 Skill" @click="setChatSkillEnabled(skill, false)">×</button></div>
                <div v-if="chat.skillImporting" class="chat-skill-chip importing"><span><AppIcon name="loader-circle" /></span><b>正在导入</b><small>Skill</small></div>
              </div>
              <div v-if="chat.files.length" class="chat-upload-strip"><div v-for="file in chat.files" :key="file.id" :class="['chat-upload-item', { retained: chat.mode === 'image' && file.kind === 'image' }]" :title="chat.mode === 'image' && file.kind === 'image' ? '后续生图会继续引用，点击右侧可移除' : file.name"><img v-if="file.kind === 'image'" :src="file.dataUrl" alt="" /><span v-else><AppIcon name="file-text" /></span><span class="chat-upload-copy"><b>{{ file.name }}</b><small v-if="chat.mode === 'image' && file.kind === 'image'"><AppIcon name="link" />连续引用</small></span><button @click="removeChatFile(file.id)">×</button></div></div>
              <textarea v-model="chat.input" :placeholder="chat.mode === 'image' ? '描述你想生成的图片…' : '输入消息，或使用 /完整 /简洁 /详细 等快捷指令…'" rows="1" @input="scheduleDraftSave" @keydown="handleChatInputKeydown"></textarea>
              <div class="chat-composer-toolbar">
                <div class="chat-compose-left">
                  <button class="chat-attach" title="添加附件或 Skill 包" aria-label="添加附件或 Skill 包" @click="$event.currentTarget.nextElementSibling.click()"><AppIcon name="paperclip" /></button><input type="file" accept="image/*,.txt,.md,.json,.csv,.srt,.js,.ts,.zip,.skill,application/zip" multiple hidden @change="onChatPickFile" />
                  <div class="chat-mode-switch"><button :class="{ active: chat.mode === 'chat' }" @click="chat.mode = 'chat'"><AppIcon name="message-circle" /><span>聊天</span></button><button :class="{ active: chat.mode === 'image' }" @click="chat.mode = 'image'"><AppIcon name="image" /><span>图片</span></button></div>
                  <button v-if="chat.mode === 'chat'" type="button" :class="['chat-web-search-toggle', { active: chat.webSearchEnabled }]" :aria-pressed="chat.webSearchEnabled" :title="chat.webSearchEnabled ? '关闭联网搜索' : '开启联网搜索'" aria-label="联网搜索" @click="toggleChatWebSearch"><AppIcon name="cable" /><span>联网</span></button>
                  <el-select v-if="chat.mode === 'image'" v-model="imageRatio" class="chat-ratio-select"><el-option v-for="item in imageRatioOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
                  <el-input v-if="chat.mode === 'image' && imageRatio === 'custom'" v-model="customImageRatio" class="chat-custom-ratio" placeholder="1:1" />
                  <span v-if="chat.input" class="chat-input-count">约 {{ Math.ceil(chat.input.length / 2.2) }} tokens</span>
                </div>
                <button v-if="chat.sending" class="chat-send stop" type="button" aria-label="停止生成" @click="stopChatGeneration"><span></span></button><button v-else class="chat-send" type="button" aria-label="发送消息" :title="chat.mode === 'image' && chat.imageGeneratingCount ? ('图片生成中 ' + chat.imageGeneratingCount + '/' + chatImageConcurrencyLimit()) : '发送消息'" :disabled="!canSendChatMessage()" @click="sendChatMessage()"><AppIcon name="send" /><small v-if="chat.mode === 'image' && chat.imageGeneratingCount">{{ chat.imageGeneratingCount }}</small></button>
              </div>
            </section>
            <p>Enter 发送 · Shift + Enter 换行 · Ctrl K 聚焦输入 · 数据仅保存在本机</p>
          </footer>
        </main>

        <aside :class="['chat-settings-panel', { open: chat.settingsOpen }]">
          <header><div><span>CHAT SETTINGS</span><b>对话设置</b></div><button @click="chat.settingsOpen = false">×</button></header>
          <div class="chat-settings-scroll" v-if="currentChatConversation()">
            <section class="chat-setting-card">
              <div class="chat-setting-title"><span><AppIcon name="wand-sparkles" /></span><div><b>提示词预设</b><small>每轮聊天自动使用</small></div><button class="mini-add" @click="beginCreatePrompt">＋</button></div>
              <el-select class="chat-setting-select" :model-value="currentChatConversation().promptId" @change="patchCurrentConversation({ promptId: $event })"><el-option v-for="prompt in chat.prompts" :key="prompt.id" :label="prompt.name" :value="prompt.id" /></el-select>
              <div v-if="currentPrompt()" class="chat-prompt-preview"><p>{{ currentPrompt().content }}</p><div><button @click="beginEditPrompt(currentPrompt())">编辑</button><button v-if="currentPrompt().id !== 'prompt_default'" @click="deleteChatPrompt(currentPrompt())">删除</button></div></div>
            </section>
            <section class="chat-setting-card chat-skill-settings">
              <div class="chat-setting-title"><span><AppIcon name="library" /></span><div><b>本地 Skill</b><small>{{ activeChatSkills().length }} 个已在本对话启用</small></div></div>
              <div class="chat-skill-import-actions">
                <button type="button" :disabled="chat.skillImporting" @click="$event.currentTarget.nextElementSibling.click()"><AppIcon name="upload" /><span>技能包</span></button><input type="file" accept=".zip,.skill,application/zip" hidden @change="onChatPickFile" />
                <button type="button" :disabled="chat.skillImporting" @click="$event.currentTarget.nextElementSibling.click()"><AppIcon name="folder-plus" /><span>文件夹</span></button><input type="file" webkitdirectory directory multiple hidden @change="onChatPickSkillFolder" />
              </div>
              <div v-if="chat.skills.length" class="chat-skill-list">
                <div v-for="skill in chat.skills" :key="skill.id" class="chat-skill-row">
                  <span class="chat-skill-row-icon"><AppIcon name="wand-sparkles" /></span>
                  <div><b>{{ skill.name }}</b><small>{{ skill.description || (skill.fileCount + ' 个文件') }}</small><em>v{{ skill.version }} · 只读</em></div>
                  <el-switch :model-value="currentChatConversation().skillIds?.includes(skill.id)" @change="setChatSkillEnabled(skill, $event)" />
                  <button type="button" title="删除 Skill" aria-label="删除 Skill" @click="deleteChatSkill(skill)"><AppIcon name="trash-2" /></button>
                </div>
              </div>
              <div v-else class="chat-skill-empty">暂无本地 Skill</div>
            </section>
            <section class="chat-setting-card">
              <div class="chat-setting-title"><span><AppIcon name="cpu" /></span><div><b>模型与回答</b><small>当前对话独立配置</small></div></div>
              <label class="chat-field-label">主模型</label><el-select class="chat-setting-select" :model-value="currentChatConversation().modelProfileId" @change="patchCurrentConversation({ modelProfileId: $event })"><el-option v-for="item in chatModelOptions()" :key="item.value" :label="item.label" :value="item.value" /></el-select>
              <label class="chat-setting-row"><span><b>双模型对比</b><small>同一问题生成两份回答</small></span><el-switch :model-value="currentChatConversation().compareEnabled" @change="patchCurrentConversation({ compareEnabled: $event })" /></label>
              <el-select v-if="currentChatConversation().compareEnabled" class="chat-setting-select" :model-value="currentChatConversation().compareModelProfileId" placeholder="选择第二个模型" @change="patchCurrentConversation({ compareModelProfileId: $event })"><el-option v-for="item in chatModelOptions().filter(i => i.value !== currentChatConversation().modelProfileId)" :key="item.value" :label="item.label" :value="item.value" /></el-select>
              <div class="chat-completion-guard"><div><b>完整执行保护</b><small>逐项满足要求，不因篇幅或工作量擅自精简</small></div><span>始终开启</span></div>
              <label class="chat-field-label">回答方式</label><div class="chat-style-switch four"><button v-for="item in [{v:'complete',l:'完整'},{v:'concise',l:'简洁'},{v:'balanced',l:'平衡'},{v:'detailed',l:'详细'}]" :key="item.v" :class="{ active: currentChatConversation().responseStyle === item.v }" @click="patchCurrentConversation({ responseStyle: item.v })">{{ item.l }}</button></div>
              <label class="chat-range-label"><span>创造力</span><b>{{ Math.round(currentChatConversation().temperature * 100) }}%</b></label><el-slider :model-value="currentChatConversation().temperature" :min="0" :max="1.2" :step="0.05" @change="patchCurrentConversation({ temperature: $event })" />
            </section>
            <section class="chat-setting-card context-card">
              <div class="chat-setting-title"><span><AppIcon name="cable" /></span><div><b>上下文记忆</b><small>只整理较早历史，不压缩当前回答</small></div><el-switch :model-value="currentChatConversation().memoryEnabled" @change="patchCurrentConversation({ memoryEnabled: $event })" /></div>
              <div class="chat-memory-meter"><div><i :style="{ width: chatContextPercent() + '%' }"></i></div><span>{{ chatContextTokens().toLocaleString() }} / 32,000 tokens</span></div>
              <div class="chat-memory-stats"><span><b>{{ chat.messages.length }}</b>消息</span><span><b>{{ currentChatConversation().compressedCount }}</b>已压缩</span></div>
              <label class="chat-setting-row"><span><b>自动压缩</b><small>较早消息整理为长期摘要</small></span><el-switch :model-value="currentChatConversation().autoCompress" @change="patchCurrentConversation({ autoCompress: $event })" /></label>
              <div class="chat-setting-buttons"><button @click="compressChatContext"><AppIcon name="box" />立即压缩</button><button @click="clearChatMemory">清除记忆</button></div>
            </section>
            <section class="chat-setting-card">
              <div class="chat-setting-title"><span><AppIcon name="folder" /></span><div><b>整理与数据</b><small>文件夹、导出和导入</small></div></div>
              <label class="chat-field-label">对话文件夹</label><el-input :model-value="currentChatConversation().folder" placeholder="例如：工作、学习" @change="patchCurrentConversation({ folder: $event }, { reload: true })" />
              <label class="chat-field-label">标签（用逗号分隔）</label><el-input :model-value="currentChatConversation().tags.join(', ')" placeholder="重要, 待整理" @change="patchCurrentConversation({ tags: $event.split(',').map(v => v.trim()).filter(Boolean) })" />
              <div class="chat-setting-buttons"><button @click="exportCurrentChat('markdown')">导出 Markdown</button><button @click="exportCurrentChat('txt')">导出 TXT</button><button @click="exportCurrentChat('json')">导出 JSON</button><button @click="printCurrentChat">打印 / PDF</button></div>
              <button class="chat-import-button" @click="$event.currentTarget.nextElementSibling.click()"><AppIcon name="upload" />导入对话 JSON</button><input type="file" accept=".json,application/json" hidden @change="importChatFile" />
              <div class="chat-setting-danger"><button @click="archiveChatConversation()">归档对话</button><button @click="trashChatConversation()">移入回收站</button></div>
            </section>
          </div>
        </aside>

        <div v-if="chat.searchOpen" class="chat-search-overlay" @click.self="chat.searchOpen = false">
          <section class="chat-search-dialog"><header><AppIcon name="search" /><input v-model="chat.searchQuery" placeholder="搜索全部对话内容" @keydown.enter="performGlobalChatSearch" autofocus /><button @click="chat.searchOpen = false">×</button></header><div class="chat-search-dialog-tabs"><button class="active">全部结果</button><button @click="chat.conversationSearch = chat.searchQuery; chat.searchOpen = false">当前对话</button></div><div class="chat-search-results"><div v-if="!chat.searchResults.length" class="chat-search-empty">输入关键词并按 Enter 搜索</div><button v-for="result in chat.searchResults" :key="result.messageId" @click="openChatSearchResult(result)"><span>{{ result.title }}</span><p>{{ result.content }}</p><small>{{ result.role === 'user' ? '你' : 'Freedom' }} · {{ chatThreadTime(result.createdAt) }}</small></button></div></section>
        </div>

        <el-dialog v-model="chat.promptEditorOpen" width="min(600px, 92vw)" class="chat-prompt-dialog" :title="chat.promptEditingId ? '编辑提示词预设' : '新建提示词预设'">
          <label>名称</label><el-input v-model="chat.promptName" placeholder="例如：翻译助手" />
          <label>固定指令</label><el-input v-model="chat.promptContent" type="textarea" :rows="10" placeholder="这段指令会在每轮对话中自动使用" />
          <template #footer><el-button @click="chat.promptEditorOpen = false">取消</el-button><el-button type="primary" @click="saveChatPrompt">保存预设</el-button></template>
        </el-dialog>
      </section>
`;
