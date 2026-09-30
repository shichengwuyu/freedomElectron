# 第 7 章 Tool Calling：23 种画布操作工具

> 对应简历亮点 6：定义 23 种画布操作工具，覆盖画布读取、节点 CRUD、连线管理、分组编排、媒体生成等全生命周期操作，增强系统可编程性与灵活性。

## 7.1 工具系统的定位

工具层是 Agent（第 6 章）与画布（第 2~4 章）之间的**唯一通道**：

- Agent 不直接摸 store——所有画布操作都翻译成一次工具调用；
- 工具层同时服务两个调用方：**LLM**（通过 tool_call 协议）和**前端 UI**（部分工具直接映射菜单/快捷键动作，如"按类型选择节点"）——一套实现两处复用，保证人和 AI 的行为一致；
- 工具是系统的"可编程 API 面"，第 10 章的自动化测试也直接调它。

## 7.2 工具定义契约

```ts
import { z } from 'zod'

interface ToolDefinition<S extends z.ZodTypeAny, R> {
  name: string                          // snake_case，LLM 调用时的唯一标识
  description: string                   // ★ 写给 LLM 看的说明书（见 7.6）
  category: ToolCategory                // 能力域分组
  permission: 'read' | 'reversible-write' | 'destructive'   // 三级权限（6.6）
  inputSchema: S                        // Zod：运行时校验 + 导出 JSON Schema 双职责
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult<R>>
}

// 执行上下文：注入依赖而不是工具自己 import（可测试性的关键）
interface ToolContext {
  canvasId: string                      // 作用域：Agent 只能操作当前画布
  store: CanvasStoreApi                 // 读写画布（走 commit 通道，4.7）
  services: GenerationService           // 媒体生成（触发 generation 工作流）
  userId: string                        // 审计与配额归属
}

// 统一返回信封：成功/失败都结构化，LLM 永远拿到可解析的结果
type ToolResult<R> =
  | { status: 'ok'; data: R; summary: string }           // summary 给 LLM 看的浓缩版
  | { status: 'invalid_params'; error: string; hint: string }
  | { status: 'failed'; error: string; retryable: boolean }
  | { status: 'rejected'; reason: string }               // 被护栏/用户拒绝
```

## 7.3 23 种工具全量清单

**① 画布读取类（5 种，permission: read）**

| 工具 | 参数 | 返回摘要策略 |
|---|---|---|
| `get_canvas_overview` | 无 | 节点数/分组结构/各状态计数，常驻上下文的画布摘要就用它 |
| `get_nodes` | `filter?: {type?, status?, groupId?}, limit?` | 返回节点摘要（id/type/位置/状态），**不返回全量 data** |
| `get_node_detail` | `nodeId` | 单节点全量数据——摘要层需要细节时二次拉取 |
| `get_edges` | `nodeId?` | 连线列表（默认只看某节点的出入边） |
| `find_text` | `query` | 在文本节点内容里搜索，返回命中节点 + 上下文片段 |

**② 节点 CRUD 类（6 种，reversible-write）**

| 工具 | 参数 | 说明 |
|---|---|---|
| `create_node` | `type, position{相对锚点}, data?, count?` | 支持相对定位（`rightOf: nodeId`）避免 LLM 算坐标；count 批量建 |
| `update_node_data` | `nodeId, patch` | 深合并 patch，Zod 按 type 收窄校验 |
| `move_nodes` | `nodeIds, delta | anchor` | 相对移动或对齐锚点 |
| `delete_nodes` | `nodeIds, {cascade: true}` | 级联删边；>10 个触发 destructive 升级 |
| `set_node_status` | `nodeId, status` | 少见的受控写：仅限 error→idle 重置 |
| `copy_nodes` | `nodeIds, offset` | 复制并偏移，返回新 id 映射 |

**③ 连线管理类（4 种，reversible-write）**

| 工具 | 参数 | 说明 |
|---|---|---|
| `connect_ports` | `source{nodeId,portId}, target{...}` | 复用 2.3 规则矩阵 + 3.6 环检测，返回 ConnectError 细节 |
| `connect_by_type` | `fromNodeId, toNodeId` | 自动匹配两节点间唯一合理端口对——LLM 不用知道端口 id |
| `disconnect` | `edgeId` 或 `{nodeId}` | 删单条/删节点全部出入边 |
| `reroute_edges` | `nodeId` | 换端口重排该节点的连线（布局优化用） |

**④ 分组编排类（3 种，reversible-write）**

| 工具 | 参数 | 说明 |
|---|---|---|
| `create_group` | `title?, nodeIds?, color?` | 建组并可同时收纳节点 |
| `add_to_group / remove_from_group` | `nodeIds, groupId` | 收纳/移出 |
| `ungroup` | `groupId, {deleteChildren: false}` | 解散分组，默认保留子节点 |

**⑤ 媒体生成类（4 种，reversible-write 但触发长任务）**

| 工具 | 参数 | 说明 |
|---|---|---|
| `generate_image` | `nodeId 或 {prompt, refAssetIds}` | 触发 generation 工作流，立即返回 taskId（不阻塞推理循环） |
| `generate_video` | `nodeId（需首帧连线）, prompt, durationSec` | 同上 |
| `generate_audio` | `nodeId, text, voiceId` | TTS |
| `batch_generate` | `nodeIds, kind` | 批量触发生成，返回任务 id 数组——100 步模式跑全章分镜的主力 |

**⑥ 终止类（1 种）**

| 工具 | 参数 | 说明 |
|---|---|---|
| `task_complete` | `summary, blockers?` | 显式终止 + 结构化总结；blockers 列出未完成项 |

合计 **5+6+4+3+4+1 = 23**。

## 7.4 注册中心与分发

```ts
// registry.ts —— 所有工具在此登记，唯一的工具事实源
const registry = new Map<string, AnyTool>()
export function registerTool(t: AnyTool) { registry.set(t.name, freeze(t)) }

// 启动时批量注册（分组文件各自 export，此处集中挂载）
readTools.forEach(registerTool)
nodeTools.forEach(registerTool)
edgeTools.forEach(registerTool)
groupTools.forEach(registerTool)
mediaTools.forEach(registerTool)
registry.set('task_complete.name', taskCompleteTool)

// 导出给 LLM 的 tools 数组：Zod → JSON Schema 只需转换一次并缓存
export const toolSchemasForLLM = lazy(() =>
  [...registry.values()].map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.inputSchema),
    },
  })))

// 分发：Agent 循环的唯一入口
export async function dispatchToolCall(call: ToolCall, ctx: ToolContext) {
  const tool = registry.get(call.name)
  if (!tool) return { status: 'failed', error: `未知工具 ${call.name}`, retryable: false }
  const parsed = tool.inputSchema.safeParse(call.arguments)
  if (!parsed.success)
    return { status: 'invalid_params',
             error: parsed.error.message,
             hint: describeExpected(tool.inputSchema) }   // 告诉 LLM 正确格式
  return tool.handler(parsed.data, ctx)
}
```

新增一个工具的完整改动面：**写一个 ToolDefinition + 在分组数组里加一行**——推理引擎、前端 UI、JSON Schema 导出全部自动生效。

## 7.5 参数校验与"自愈回路"

- `invalid_params` 不是错误终点而是反馈：`error`（哪里坏了）+ `hint`（正确长什么样）一起回传 LLM，下一轮自愈——实测大部分参数错误一轮修正；
- **hint 的生成**是工程细节：Zod error 是英文技术描述，对 LLM 不友好，所以 `describeExpected` 用 schema 推导出人话模板（如"position 需要 {x,y} 或提供 rightOf: 节点id"）；
- **硬上限不参与自愈**：如 `count ≤ 20`、`delete_nodes > 10 触发确认`——校验区分"可自愈的格式错误"与"不可协商的边界"，后者直接 `rejected` 并在 hint 里说明原因，防止 LLM 换着姿势绕过。

## 7.6 描述工程：description 决定调用准确率

工具描述是给 LLM 的 API 文档，模板三段式：

```
用途：什么时候该用我（以及什么时候不该用）
参数：每个字段的语义、单位、约束（人话，不重复 schema 的机械描述）
返回：拿到结果后下一步该做什么（引导调用链）
```

实测有效的两条经验：

1. **负面示例比正面描述更防呆**："不要用 get_node_detail 遍历所有节点（用 get_nodes 的 filter）"——比任何正面话术都管用；
2. **参数越少越好**：`connect_by_type` 就是为了把"端口 id"从 LLM 的认知负担里去掉而发明的——**把领域知识做进工具签名，而不是写进描述**。

## 7.7 代表性工具实现细节

**`generate_image`**——长任务工具的范式：

```ts
handler: async (args, ctx) => {
  // ① 定位目标节点（给了 nodeId 用之，否则先建节点）
  const node = args.nodeId ? getNode(args.nodeId) : createImageNode(args, ctx)
  // ② 本地状态置 queued（UI 立即有反馈）
  ctx.store.commit(d => { d.nodes[node.id].data.status = 'queued' }, 'agent:generate')
  // ③ 触发服务端 generation 工作流（1.3.6），立即返回不等待
  const { taskId } = await ctx.services.enqueueImage({ nodeId: node.id, ...args })
  // ④ summary 告诉 LLM：任务已提交，结果稍后可查
  return { status: 'ok', data: { nodeId: node.id, taskId },
           summary: `已提交生图任务（节点 ${node.id}），可用 get_node_detail 轮询状态` }
}
```

关键设计：**生成类工具永远异步返回 taskId**，Agent 推理循环不被分钟级生成阻塞；后续轮次用 `get_node_detail` 观察状态——"提交-轮询"模式让 100 步流水线可以先把 20 个分镜节点全部建完再统一 batch_generate，吞吐最大化。

**`create_node`** 的相对定位：LLM 对画布坐标系的数字感很差，直接给 `{x: 387, y: -122}` 经常摆出重叠布局。签名提供 `rightOf / belowOf / insideGroup` 锚点，由工具层基于现有节点包围盒计算绝对坐标（网格步长 320px + 自动避让）——**把几何常识从 LLM 卸载到代码**。

## 7.8 安全与防护（承接 6.6，从工具视角）

1. **作用域强制**：`ctx.canvasId` 由服务端注入，schema 里根本没有 canvasId 参数——工具**想越权都没有入口**，这比"校验参数里的 canvasId"安全一档；
2. **权限三级**在 7.3 清单里逐工具标注，destructive 仅 `delete_nodes`（批量）与 `ungroup(deleteChildren)` 两处；
3. **写操作全走 commit**：自动获得撤销栈 + 持久化 + 轨迹记录（4.7），Agent 删错的任何东西一键恢复；
4. **配额与限流**：媒体生成工具按 userId 计入配额（Workers 侧检查），防止 Agent 循环失控烧穿生图预算。

## 7.9 测试策略

- **单元测试**：每个工具的 handler 用 mock ctx 直测（这正是 `ToolContext` 注入依赖的动机）——规则矩阵、环检测、批量上限、级联删除都是纯逻辑，覆盖率容易拉满；
- **调用准确率评测（eval）**：准备 N 条自然语言任务 → 期望工具调用序列的金标集，每次改 description 或模型版本就跑一遍，统计"工具选对率 / 参数一次通过率"——**把提示词工程变成有回归指标的工程**；
- **端到端冒烟**：真 LLM 跑 5 条典型任务（建 4 节点 3 连线 1 分组），断言最终画布快照 diff。

## 7.10 面试考点提炼

1. **"23 种工具怎么设计的？"** → 六大能力域 + 7.3 清单结构；能报出 5/6/4/3/4/1 的分组构成显得真做过；
2. **"schema 怎么同时给校验和 LLM？"** → Zod 双职责 + `zodToJsonSchema` 一次转换缓存（7.4）；
3. **"LLM 参数错了怎么办？"** → 自愈回路：error + hint 回传下一轮修正；硬边界不可协商（7.5）；
4. **"怎么提升调用准确率？"** → 7.6 描述工程：三段式模板、负面示例、把领域知识做进工具签名（connect_by_type / 相对定位）——这题最能拉开档次；
5. **"生成类工具会不会阻塞推理？"** → 提交-轮询模式（7.7），与 generation 工作流解耦；
6. **"怎么保证 Agent 不越权？"** → 7.8：canvasId 服务端注入 + 三级权限 + commit 可撤销 + 配额限流。
