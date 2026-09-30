# Project Pipeline Chain Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复项目生产链路中状态回灌、失败传播、上游失效和旧媒体复用问题，让一键生成与续跑只使用当前有效产物。

**Architecture:** 保持现有前端编排和后端路由不变，新增一个可注入依赖的后端输出失效服务、一个前端流水线响应校验模块，以及前端本地输出状态清理函数。每个边界先做结果校验，再由现有编排决定中止、重试或继续；脚本输入变化在后端统一清理当前集下游产物，前端同步清理响应式分镜/视频缓存。

**Tech Stack:** Node.js 18+ ES modules、浏览器端原生 ES modules、现有 `.workbuddy/tests/*.mjs` Node 直跑 mock 测试。

**Spec:** `docs/superpowers/specs/2026-09-12-pipeline-chain-consistency.md`

## Global Constraints

- 不改变现有 HTTP 路径、请求字段和供应商接口。
- 历史视频版本不删除；只清理当前集的分镜、视频、尾帧和 pending 任务。
- 每个行为修改先写能复现原问题的失败测试，再写最小实现。
- 现有 `flow-test.mjs` 必须继续通过。

---

### Task 1: 流水线边界响应校验

**Files:**
- Create: `frontend/utils/pipelineGuards.js`
- Modify: `frontend/utils/autoPipeline.js:282-304,433-505`
- Modify: `frontend/utils/video/autoBatchShared.js:180-315`
- Test: `.workbuddy/tests/pipeline-chain-test.mjs`

**Interfaces:**
- Produces `requireOkResponse(response, fallbackMessage)`, `requireGeneratedEpisode(response, episodeId)`, `requireGeneratedStoryboard(storyboard, episodeId)`, and `requireCompletedImageBatch(response, category)` for frontend pipeline callers.
- `requireOkResponse` returns the original response when `response.ok === true`; otherwise throws an `Error` using `response.error`, `response.message`, or the fallback.
- `requireGeneratedEpisode` returns the original SSE payload only when `response.episode.content` is non-empty; otherwise throws an `Error` naming the episode.

- [x] **Step 1: Write the failing tests**

Add tests that call the real exported guards and assert that `{ ok: false, error: '绑定失败' }` throws, a successful response is returned unchanged, an empty episode SSE result throws, and a non-empty episode result passes.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs`

Expected: FAIL because `frontend/utils/pipelineGuards.js` does not exist.

- [x] **Step 3: Implement the minimal guards**

Implement the two functions with no UI or API dependencies. Use the guards in:

- `autoPipeline.js` after every script SSE call and after every storyboard helper call by checking `helpers.findStoryboard(epId)?.content`.
- `autoPipeline.js` after the final image retry payload; a non-empty `failed` list or missing retry `jobId` throws.
- `autoPipeline.js` for the main AI binding request.
- `autoBatchShared.js` for both image-degrade and prompt-degrade AI binding requests.

After the parallel script stage, call `helpers.openProject(projectId)` once and only then calculate storyboard work. Treat an empty/missing storyboard as a failed item so the existing retry path handles it.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs`

Expected: PASS for all guard and final-image-failure cases.

---

### Task 2: 上游变更统一清理当前集输出

**Files:**
- Create: `backend/services/scriptOutputInvalidation.js`
- Modify: `backend/routes/scriptRoutes.js:150-170,692-820,858-880,891-904,1450-1475`
- Modify: `frontend/utils/scriptUtils.js, frontend/utils/scriptRuntime.js, frontend/templates/workspaceView.js`
- Test: `.workbuddy/tests/pipeline-chain-test.mjs`

**Interfaces:**
- Produces `invalidateEpisodeOutputs(project, episodeId, options)` and `invalidateEpisodesOutputs(project, episodeIds, options)`.
- The service removes matching storyboards, optionally clears the episode script and continuity review fields, calls injected/default pending cleanup and media cleanup, and returns cleanup counts.

- [x] **Step 1: Write the failing tests**

Use a project object with string and numeric episode IDs, injected cleanup spies, an existing storyboard, and episode content. Assert that one invalidation removes the matching storyboard, clears content when requested, calls both cleanup functions with the project/episode IDs, and leaves another episode untouched. Assert that a list invalidation de-duplicates IDs.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs`

Expected: FAIL because the invalidation service does not exist.

- [x] **Step 3: Implement and wire the service**

Wire it into these routes:

- Chapter source update: when `sourceText` actually changes, invalidate every episode referencing the chapter with script clearing enabled before saving.
- Chapter delete: invalidate removed episode IDs before saving the chapter/episode removal.
- Chapter split: after the new split plan is fully validated but before removing old episodes, invalidate old episode IDs; this prevents reused IDs from seeing old files. Keep the current ID reuse behavior.
- Episode recut: calculate snapped offsets first; reject invalid ranges without mutating the episode. If offsets changed, invalidate that episode with script clearing enabled.
- Episode script SSE final save: reload the latest project, invalidate the target episode’s storyboard/media/pending output, then save the newly generated script and continuity review.
- Manual script-editor changes: persist-side comparison invalidates the episode’s downstream outputs; the editor also immediately removes local storyboard/video cache so the UI cannot continue showing stale output.
- The whole-chapter batch script SSE path now rejects empty completion results and synchronizes local downstream cleanup after a successful regeneration.

Clear `continuityStateBefore`, `continuityStateAfter`, and `finalReview` when clearing an old script. Do not delete video history directories.

- [x] **Step 4: Run the focused test and syntax checks**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs` and `node --check backend/services/scriptOutputInvalidation.js`.

Expected: PASS and exit code 0.

---

### Task 3: 增量提取按真实选择处理

**Files:**
- Modify: `frontend/utils/extractFlow.js:35-50,500-558`
- Test: `.workbuddy/tests/pipeline-chain-test.mjs`

**Interfaces:**
- Produces a normalized category selection where `[]`, `undefined`, and `'all'` all mean no category filter.

- [x] **Step 1: Write the failing test**

Exercise `startExtractFromSourceFlow(false, handlers)` with `extractCategory: () => []`, two chapters, and one pending chapter. Assert the submitted text contains only the pending chapter and no `categories` field is sent; assert extracted signatures are not assigned until a successful job result is returned.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs`

Expected: FAIL because the current `[] !== 'all'` branch submits every chapter and stamps signatures before polling.

- [x] **Step 3: Implement normalized selection**

Compute `categories = extractionCategories(selectedExtractionCategory(handlers))` once per request. Use `categories?.length > 0` for category-only behavior. Keep the signature map pending until `pollExtract` returns a done status; only then assign it for an unfiltered extraction.

- [x] **Step 4: Run the focused test**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs`

Expected: PASS for empty-selection incremental extraction and error paths.

---

### Task 4: 导出只复制当前有效视频

**Files:**
- Modify: `backend/routes/videoRoutes.js:813-835`
- Create: `backend/services/videoExportSelection.js`
- Test: `.workbuddy/tests/pipeline-chain-test.mjs`

**Interfaces:**
- The export route continues returning `{ ok, dir, count, files }`, but emits at most one file per episode/shot and resolves the source through the unified playback path.

- [x] **Step 1: Write the failing test**

Add a pure selection assertion for a shot directory containing `1.mp4`, `1.version-older.mp4`, and `1.version-newer.mp4`: the selected list contains one shot and prefers the active version according to the existing version ordering. Include a second shot to prove distinct shots remain.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs`

Expected: FAIL because the active-file selection helper is absent and current export copies every `.mp4` entry.

- [x] **Step 3: Implement deduplicated export**

Enumerate shot numbers from canonical episode directories and legacy root files, deduplicate version suffixes, resolve each source through the unified playback path, skip missing files, and copy one source per shot. Preserve existing destination names and response shape.

- [x] **Step 4: Run the focused test and syntax check**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs` and `node --check backend/routes/videoRoutes.js`.

Expected: PASS and exit code 0.

---

### Task 5: 全量回归验证

**Files:**
- Test: `.workbuddy/tests/flow-test.mjs`
- Test: `.workbuddy/tests/pipeline-chain-test.mjs`

- [x] **Step 1: Run focused chain tests**

Run: `node .workbuddy/tests/pipeline-chain-test.mjs`.

Expected: every new assertion passes.

- [x] **Step 2: Run the existing serial video flow tests**

Run: `node .workbuddy/tests/flow-test.mjs`.

Expected: existing summary remains `通过 9/9`.

- [x] **Step 3: Run syntax checks for every changed JavaScript file**

Run: `node --check` once for each changed `.js` file.

Expected: every command exits 0 with no syntax error.

- [x] **Step 4: Review the diff and report exact verification evidence**

Run: `Get-ChildItem -LiteralPath 'docs\superpowers\specs','docs\superpowers\plans'` and inspect the changed files. Because the workspace is not a Git repository, do not create a commit; report that limitation separately.

Verification evidence:

- `node .workbuddy/tests/pipeline-chain-test.mjs` — 12/12 assertions passed.
- `node .workbuddy/tests/flow-test.mjs` — existing serial video flow passed 9/9.
- `node --check` — all changed JavaScript files passed.
- The workspace has no `.git` directory, so no commit was created.
