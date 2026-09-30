# 第 6 章 AI Agent 多步推理引擎

> 对应简历亮点 5：构建多步推理引擎，支持普通模式（12 步）与全自动模式（100 步），通过 LLM 多轮对话驱动工具调用链，提升自动化创作能力。
>
> 编排基线：Agent 的多步执行跑在 **Cloudflare Workflows** 上（见 1.3.6），本章讲述推理循环本身 + Workflows 带来的持久化能力如何解决多步执行的经典难题。

## 6.1 系统全景：三层角色

```
┌─────────────────── 前端（React）───────────────────┐
│ AgentPanel：对话式 UI、执行轨迹可视化、暂停/确认干预   │
│ 确认桥：破坏性工具的人机确认（human-in-the-loop）      │
└──────────────┬─────────────────────────────────────┘
               │ POST /api/agent（SSE 订阅进度）
┌──────────────▼──────────── Workers ─────────────────┐
│ Hono 路由：鉴权、目标校验、触发 agentPipeline 实例     │
│                                                      │
│ Cloudflare Workflows：agentPipeline                  │
│   step: 推理 → step: 工具执行 → step: 记录观察 → 循环  │
│   （状态自动持久化 · step 级重试 · 断点续跑）           │
└──────────────┬─────────────────────────────────────┘
               │
   ┌───────────▼───────────┐    ┌──────────────────┐
   │ LLM 适配器（多供应商）   │    │ 工具层（第 7 章）  │
   └───────────────────────┘    └──────────────────┘
```

职责切分：**前端只负责"看和管"**（展示、确认、暂停），**推理循环与工具执行全部在服务端**——工具要直接读写 Supabase 数据和触发生成任务，放服务端才能拿到数据库凭证且不被前端伪造调用。

## 6.2 多步推理循环（ReAct）

核心循环五种角色消息，每轮迭代一轮：

```
system    你是画布创作助手，只能通过工具操作画布……（角色 + 约束 + 工具说明）
user      任务目标（如"把第 3 章拆成分镜并生成所有分镜图"）
assistant LLM 决策：要么调用一个工具（thought 隐含在 tool_call 里），要么 task_complete
tool      工具执行结果（观察）
…循环，直到 task_complete 或触顶…
```

```ts
// agentPipeline 工作流的循环骨架（Cloudflare Workflows）
export class AgentPipeline extends WorkflowEntrypoint<Env, AgentParams> {
  async run(event: WorkflowEvent<AgentParams>, env: Env) {
    const { canvasId, goal, mode } = event.payload
    const steps = mode === 'auto' ? 100 : 12        // 步数预算（见 6.4）
    let ctx = await loadContext(env, canvasId, goal) // 组装上下文（见 6.5）

    for (let i = 0; i < steps; i++) {
      // ① 推理：调 LLM，产出 tool_call 或 task_complete
      //    step.do = 引擎自动重试 + 结果持久化，崩溃后此步不重跑
      const decision = await step.do(`reason-${i}`, {
        retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' },
      }, () => callLLM(env, ctx))

      if (decision.kind === 'task_complete') {
        await step.do('finalize', () => finalize(env, canvasId, decision.summary))
        return { status: 'done', stepsUsed: i + 1 }
      }

      // ② 护栏：死循环/越权检测（见 6.6），不合法则注入纠偏消息继续
      const guard = checkGuardrails(ctx, decision)
      if (guard.blocked) { ctx = appendObjection(ctx, guard.reason); continue }

      // ③ 破坏性工具 → 挂起等人确认（见 6.6 的 human-in-the-loop）
      if (guard.requiresConfirm) {
        await step.do(`await-approval-${i}`, () =>
          waitForUserApproval(env, decision, /* timeout */ '10 minutes'))
      }

      // ④ 执行工具（可能是长任务：生图/生视频 → 内部再触发 generation 工作流）
      const observation = await step.do(`execute-${i}`, {
        retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
      }, () => executeTool(env, canvasId, decision))

      // ⑤ 观察入上下文 + 轨迹落库（agent_sessions 表，可回放）
      ctx = appendObservation(ctx, decision, observation)
      await step.do(`record-${i}`, () => recordStep(env, canvasId, i, decision, observation))
    }
    // 步数用尽：优雅收尾，汇总已完成进度
    return { status: 'step_limit', summary: summarize(ctx) }
  }
}
```

**为什么循环长这样（Workflows 视角）**：每轮的"推理/执行/记录"都是独立 step，`step.do` 的返回值会被引擎持久化——100 步任务在第 57 步因 Workers 版本发布中断，恢复后**前 56 步不重跑**（不重复烧 LLM token，这是自建任务表方案做不到的）；LLM 偶发 429/超时由 step 重试兜底，不污染 Agent 决策。

## 6.3 两种模式：12 步与 100 步

| | 普通模式 | 全自动模式 |
|---|---|---|
| 步数预算 | 12 | 100 |
| 目标场景 | "帮我把这张图换成夜景"、"给选中分组加节点"——单画布/单生成任务 | "从这部小说生成完整分镜视频素材"——跨章节长链路 |
| 破坏性操作 | 每次都确认 | 批量操作限作用域 + 抽样确认 |
| token 预算 | 单次会话上限低 | 分配总预算，按步均摊（见 6.5） |
| 前端呈现 | 直接展示每步 | 进度条 + 折叠轨迹，支持中途暂停 |

上限不是拍的：**12 ≈ 覆盖"理解目标 → 2~3 次画布查询 → 3~5 次写操作 → 1~2 次失败重试"的合理深度**，超出基本说明 Agent 在空转；100 步对应"一章 10~20 个分镜 ×（建节点+生成+检查）"的乘法。超限后不报错，而是**汇总已完成部分 + 说明剩余未做**，把"是否继续"交还用户。

## 6.4 上下文管理：让每步 token 恒定而非线性增长

```ts
async function callLLM(env: Env, ctx: AgentContext) {
  const messages = [
    { role: 'system',    content: ctx.systemPrompt },        // 常驻：角色+约束+工具说明
    { role: 'user',      content: ctx.goal },                // 常驻：任务目标
    ...ctx.digest,                                            // 摘要层：早期步骤压缩版
    ...ctx.recent,                                            // 完整层：最近 K=6 轮原文
    { role: 'system',    content: ctx.canvasDigest },         // 画布状态摘要（按需重注入）
  ]
  return env.LLM.chat({ messages, tools: exportToolSchemas() })
}

// 超过 K 轮后，把最老的一轮压缩成一行"结论"塞进 digest
function compressStep(step: ExecutedStep): string {
  return `${step.index}. ${step.toolName}(${argsDigest(step.args)}) → ${step.outcome}`
  // 例："3. createNode(type=image, x4) → 4 个图片节点已创建，id=[a1b2,c3d4,...]"
}
```

四条压缩纪律：

1. **大结果不进上下文**：生图返回 URL 而非 base64；`getNodes` 返回"节点摘要列表"（id/type/位置/状态）而非全量 data——全量数据工具层可以按 id 二次查询；
2. **滑动窗口 + 摘要层**：只有最近 6 轮保留原始消息（含完整工具结果），更早的压成一行结论；LLM 需要旧信息时用 `getNode(id)` 重新拉取（有 id 可查）；
3. **画布状态按需重注入**：每 5 步或写操作后，注入一次画布摘要（节点数、分组结构、各状态计数），防止 Agent 基于过期认知重复操作；
4. **token 预算**：`maxTokensPerStep` 超限直接触发上下文重建（更激进的压缩），而不是放任消息膨胀。

## 6.5 终止判断

1. **显式终止**：LLM 调用 `task_complete(summary)` 工具——终止是模型的一个决策，不是代码猜的；
2. **步数触顶**：`step_limit` 收尾，产出结构化进度报告；
3. **护栏强制终止**：连续 3 次同一签名工具调用（工具名 + 参数 hash）判定死循环；连续 5 次工具失败；token 总预算耗尽——三者任一触发即终止并把原因写入 summary。

## 6.6 护栏：死循环、破坏性操作与人机确认

```ts
type ToolPermission = 'read' | 'reversible-write' | 'destructive'

interface GuardrailResult {
  allowed: boolean
  requiresConfirm: boolean
  reason?: string
}

function checkGuardrails(ctx: AgentContext, decision: ToolCall): GuardrailResult {
  const tool = registry.get(decision.name)
  // ① 死循环：签名 = name + stableStringify(args) 的 hash，连续 3 次相同 → 拦截
  const sig = signature(decision)
  if (ctx.recentSignatures.filter(s => s === sig).length >= 3)
    return { allowed: false, requiresConfirm: false, reason: '重复调用相同工具与参数' }
  // ② 权限分级：只读放行；可逆写放行（可撤销）；破坏性 → 需要人确认
  if (tool.permission === 'destructive')
    return { allowed: true, requiresConfirm: true }
  return { allowed: true, requiresConfirm: false }
}
```

**human-in-the-loop 的实现（Workflows 原生优势）**：`waitForUserApproval` 是一个 step，内部轮询 approvals 表（或 `step.sleep` 等待前端 PATCH 确认接口）——工作流实例**挂起等待**，不占任何计算资源；用户 10 分钟内没确认则视为拒绝，把"用户未批准"回传 LLM 让它换方案。前端确认框走 SSE 实时弹出。

最后一道防线：所有写操作走 `commit` 通道（4.7），Agent 造成的任何变更都可以**一键撤销回滚**——"允许 AI 犯错，但保证可恢复"。

## 6.7 失败恢复矩阵

| 错误类型 | 例子 | 处理 | 谁负责 |
|---|---|---|---|
| 瞬时错误 | LLM 429、网络抖动 | step 级指数退避重试（2~3 次） | Workflows 引擎 |
| 参数错误 | LLM 给的 nodeType 拼错 | 校验失败 → 错误信息回传 LLM 下一轮自愈 | Agent 循环 |
| 资源错误 | 生图服务超时/排队 | 工具内部触发 generation 工作流并等待，长重试 | 工具层 |
| 不可恢复 | 素材损坏、配额不足 | 跳过该子任务 → 标记受影响节点 → 继续后续步骤 → 最终汇总报告 | Agent 循环 |
| 实例中断 | 发布新版本、平台抖动 | 从最后一个完成的 step 续跑 | Workflows 引擎 |

## 6.8 前端可视化与干预

- **执行轨迹**：SSE 订阅 `agent_sessions` 的 step 记录，前端渲染"第 N 步 · 调用 createNode ×4 · ✓"时间线，展开可见每步的参数与观察；
- **干预操作**：暂停（step 间检查暂停标志）、跳过当前步、终止（PATCH 接口写状态，工作流下个 step 边界感知）；
- **可回放**：`agent_sessions.steps` 存全量轨迹，出问题可精确复盘"它在第几步做了什么"——这也是调试 Agent 提示词的核心依据。

## 6.9 面试考点提炼

1. **"多步推理引擎怎么实现的？"** → 6.2 的 ReAct 循环 + 6.1 的三层职责，画循环图讲一遍；
2. **"为什么用 Workflows 跑 Agent？"** → 三个硬收益：step 结果持久化 → 断点续跑不重复烧 token；step 级重试 → LLM 429 自愈；挂起等待确认 → human-in-the-loop 零成本（6.2/6.6），这是本项目区别于"纯前端 Agent"的核心差异化；
3. **"12/100 步怎么定的？"** → 6.3：预算 = 场景深度推算 + 失控护栏双重身份，超限优雅收尾；
4. **"上下文会不会爆？"** → 6.4 的四条压缩纪律，关键句："让每步 token 恒定，而不是线性增长"；
5. **"怎么防死循环/删库？"** → 签名死循环检测 + 三级权限 + human-in-the-loop + 撤销兜底（6.6）；
6. **"工具失败 Agent 就崩了吗？"** → 6.7 的五类错误矩阵，强调"参数错误回传 LLM 自愈"是 Agent 相对固定流水线的本质优势。
