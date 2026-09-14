# AgentHub vs workAssist 深度对比分析

> 对比对象：
> - **AgentHub**：https://github.com/lizyoko9/bitdance-agenthub （本地：`F:\Front-end\Project\bitdance-agenthub`）
> - **workAssist**：https://github.com/YNAlone/workAssist （本地：`F:\Front-end\Project\workAssist\workAssist`）
>
> 用途：架构 / 实现 / 功能 / 面试亮点多维度拆解，为面试叙事做准备。

---

## 0. 一句话总览

| | AgentHub | workAssist |
|---|---|---|
| **定位** | 本地优先的通用多 Agent 协作平台，「把多 Agent 协作做成 IM 群聊」 | 飞书生态的企业级代码自动化平台，「自然语言 → 改代码 → PR → 审批 → 回执」全流程 |
| **形态** | Web 全栈应用（Next.js + SQLite，本地运行，有 Electron 桌面版） | 后端服务（Python + PostgreSQL，服务器 Orchestrator + 本机分布式 Worker） |
| **用户入口** | 自建 Web IM 界面 | 飞书群聊（卡片交互 + 长连接） |
| **技术栈** | TypeScript / Next.js 16 / React 19 / Zustand / Drizzle / SQLite / SSE | Python 3.11 / SQLAlchemy 2 / Alembic / PostgreSQL / 飞书 lark-oapi |
| **规模** | ~38,770 行 TS/TSX，233 个文件，51 个 API 路由，27 个单测 + 2 个 E2E，18 份 spec 文档 | ~8,275 行 Python，42 个文件，10 个 API 路由，2,377 行测试，6 份技术文档 |

**本质区别一句话**：AgentHub 是一个「平台型产品」（重交互体验、重协议设计、本地单用户）；workAssist 是一个「生产型系统」（重可靠性、重企业治理、分布式多 Worker）。两者都在做「多 Agent 编排」，但一个向内打磨体验，一个向外解决真实工程问题。

---

## 1. 系统架构设计对比

### 1.1 分层模型

**AgentHub：五层分层（L1–L5）**

```
L5 UI 组件（React 19 + shadcn/ui，60+ 组件）
L4 State + Transport（Zustand normalized store + SSE 单连接）
L3 Application Services（AgentRunner / ConversationService / EventBus / ToolExecutor）
L2 Agent Platform Adapters（ClaudeCode / Codex / CustomAgent / Mock）
L1 Persistence（Drizzle + SQLite + workspace 文件系统）
```

铁律：UI 不直接调 LLM SDK；Adapter 不写 DB；工具执行属 L3。

**workAssist：四层分层（Channel → Platform → Runtime → Executor）**

```
Channel 层（飞书事件 / 卡片回调 / 手动 API）
Platform 内核（Orchestra 项目经理 / Planner 拆解 / TaskBus / Registry / Store / Audit）
Agent Runtime 层（CodeAgent 封装 GitHub 流程 / DocAgent MCP 客户端）
Executor 层（GitHub Actions / GitLab CI / Local Worker 三种可插拔执行后端）
```

### 1.2 架构哲学差异（核心）

| 维度 | AgentHub | workAssist |
|---|---|---|
| **粘合机制** | `StreamEvent` 统一事件协议贯穿五层 | `Job/Task` 状态机 + 数据库作为唯一状态源 |
| **耦合方向** | 事件驱动、进程内同步调用（单机） | 状态驱动、跨进程异步回调（分布式） |
| **单点假设** | 单用户本地运行，不需要考虑并发抢任务 | 多 Worker 并发抢占，租约 + 唯一约束 + fencing |
| **扩展点** | Adapter（接入新 agent 平台） | Executor Protocol + `agents.json` 注册（接入新执行后端/新 Agent） |
| **演进方式** | Spec 驱动（18 份规格文档先行，CLAUDE.md 定协作契约） | 里程碑驱动（678 行重构设计文档，M1–M5 双轨并行，旧链路兼容） |

**分析**：
- AgentHub 的架构难点在「**协议一致性**」——所有 Adapter 产出同一种 `StreamEvent`，所有 UI 消费同一种事件流，L2–L5 靠类型系统粘合。这是典型的高内聚单体设计。
- workAssist 的架构难点在「**分布式一致性**」——飞书事件可能重复投递、Worker 可能宕机、任务不能重复执行也不能丢失。所以它把 PostgreSQL 当作唯一事实源，用唯一约束、租约、幂等表解决。这是典型的企业系统集成设计。
- 两者是**正交的两种能力**：AgentHub 解决「体验与协议」，workAssist 解决「可靠与治理」。面试时不要把它们讲成竞品，而是讲成「同一个问题的两种约束条件下的解」。

### 1.3 数据存储对比

| | AgentHub | workAssist |
|---|---|---|
| DB | SQLite（better-sqlite3，WAL 模式，本地文件） | PostgreSQL（psycopg3 + SQLAlchemy 2 + Alembic 迁移） |
| 表 | 9 张：agents / conversations / messages / artifacts / workspaces / attachments / agent_runs / context_summaries / app_settings | jobs / tasks / worker_jobs（租约队列）/ task_messages（幂等表）/ audit_logs / user_oauth / sessions |
| 结构化数据 | messages.parts 用 JSON 列存结构化 MessagePart 数组 | plan / inputs / result / payload 用 JSONB |
| 关键约束 | 外键级联删除 | 大量部分唯一约束：`(tenant_key, chat_id)` 每群一活跃任务、`(job_id, iteration)` 防重复派发、`worker_jobs.run_id` 唯一防重复抢占、`(tenant_key, event_id)` 事件幂等 |

**分析**：AgentHub 选 SQLite 是「本地优先、零部署」的产品决策；workAssist 选 PostgreSQL 是「事务性 + 并发写 + JSONB」的工程决策，且明确写了「不做 SQLite 过渡、避免二次迁移」——这是一个可以讲的选型故事。

---

## 2. 具体实现方式对比

### 2.1 流式传输（差异最大的一点）

| | AgentHub | workAssist |
|---|---|---|
| 方式 | SSE 单条全局连接（`/api/stream`），细粒度事件：`run.start` / `part.delta` / `tool.call` / `dispatch.plan` 等 | 无流式。阶段性回调：Worker 在 checkout/分析/验证/提交各阶段回调 Orchestrator，再发飞书消息 |
| 粒度 | token 级增量（`part.delta` 追加） | 阶段级通知 |
| 恢复 | 事件带稳定 ID，支持崩溃重连对账 | 靠 DB 状态机 + 心跳 + 租约兜底 |

**分析**：AgentHub 的前端体验（打字机流式、工具调用实时可视化）是 workAssist 完全没有的；但 workAssist 的场景（飞书异步任务，用户不盯屏）也确实不需要 token 级流式——这是场景决定的取舍，面试要讲清楚「为什么不需要」而不是「没做」。

### 2.2 消息模型

| | AgentHub | workAssist |
|---|---|---|
| 模型 | `message.parts` 结构化数组（text / code / thinking / tool_use / tool_result / artifact_ref / deploy_status / 附件…），通过 `callId` 关联工具调用与结果 | Markdown 字符串 + 飞书卡片（`lark_md` 渲染），对话历史存 `list[dict]` |
| 渲染 | 每个 part 类型独立 React 渲染器，支持引用/撤回/编辑重发/重新生成/收藏/Pin | 飞书卡片协议（按钮、下拉、进度） |

**分析**：AgentHub 明确禁止「把多种内容塞进一个 markdown 字符串再正则解析」，这是它 CLAUDE.md 里的铁律。workAssist 走 markdown 路线是受飞书卡片协议限制。如果 workAssist 未来做 Web 控制台，这里可以直接借鉴 AgentHub 的 parts 设计。

### 2.3 Agent 接入抽象

**AgentHub —— Adapter 层（4 个实现）**：

```typescript
interface AgentPlatformAdapter {
  readonly name: AdapterName
  stream(input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent>
}
```

- ClaudeCodeAdapter（claude-agent-sdk，Session 续接 + canUseTool 审批桥）
- CustomAgentAdapter（OpenAI 兼容，自驱 tool loop）
- CodexAdapter（codex-sdk，CODEX_HOME 环境隔离）
- MockAdapter（开发期不烧 token）
- API Key 四层解析链：agent 级 → 全局设置 → env → 凭据文件

**workAssist —— Executor Protocol + 注册表**：

- CodeAgent → GitHub Actions / GitLab CI / Local Worker 三种执行后端
- DocAgent → 飞书 MCP（fetch-doc / update-doc / create-doc / search-doc 白名单工具）
- 新 Agent 只需实现 `can_handle / dispatch / on_callback` 协议并注册 `agents.json`

**分析**：AgentHub 抽象的是「**模型/SDK 差异**」（同一台机器上怎么跑不同的 agent 平台）；workAssist 抽象的是「**执行环境差异**」（同一类任务在哪套基础设施上跑）。抽象维度不同，但手法同构：都是「协议 + 注册表 + 统一事件/回调翻译」。

### 2.4 Orchestrator / 任务编排

| | AgentHub | workAssist |
|---|---|---|
| 流程 | 三阶段：PLAN（`plan_tasks` 工具）→ EXECUTE（DAG 拓扑调度 + 并发信号量）→ AGGREGATE | Planner 拆解 → TaskBus 分发 → 多 Agent 并行 → Orchestra 汇总 |
| 拆解方式 | LLM 驱动（Orchestrator 是特殊 Agent，多了 `dispatch_to_agent` 工具） | M1 为关键词启发式（「文档/docx」→ DocAgent，「仓库/PR」→ CodeAgent），LLM 拆解在规划中 |
| 并发控制 | 同波次无依赖任务并行 + 全局并发上限 + 进程内信号量 | 分布式：Worker 通过 `/v1/worker/jobs/claim` 抢占，租约 + 心跳 + fencing |
| 质量保障 | **证据门控（Evidence Gates）**：子任务必须 `report_task_result` 显式上报语义结果、验收标准（TaskAcceptanceResult）、文件证据（TaskFileEvidence）、命令证据；同波次 `detectWaveConflicts` 检测文件写冲突 | **验证命令策略**：`verify_commands` 来自管理员策略（非 LLM 生成），失败回喂 Claude 最多修复 2 轮，仍失败进 `needs_attention` 保留分支 |
| 可视化 | `dispatch.plan` / `dispatch.start` / `dispatch.end` 事件 → 前端调度卡片 | 飞书卡片进度 + audit_logs |

**分析**：这是两者最可比的部分。AgentHub 的 LLM 驱动 DAG 拆解 + 证据门控更「聪明」；workAssist 的策略化验证命令 + 租约队列更「可靠」。workAssist 的 `needs_attention` 降级设计（不丢工作成果、转人工）是很扎实的企业思维。

### 2.5 工具系统与安全

| | AgentHub | workAssist |
|---|---|---|
| 工具定义 | ToolRegistry + JSON Schema（同时作 LLM 声明与 zod 校验），12 个内置工具 | 工具白名单（Claude Code 的 Edit/Read/Write/Bash；DocAgent 的 4 个 MCP doc 工具） |
| 沙箱 | Workspace 路径沙箱（所有 fs/bash 强制解析在 effective cwd 子树内）+ sandbox 模式配额（100MB/1000 文件） | git worktree --detach 临时只读分析区；LLM 产出走 PR 不直接进主分支 |
| 命令安全 | 双平台 bash 黑名单（POSIX/Windows 各一套，`security.ts` 单数据源）+ 高危命令用户审批 | 高风险关键词检测（delete/drop table/migration）触发审批；验证命令仅来自管理员策略 |
| 企业治理 | 无多租户概念（本地单用户） | 租户隔离（tenant_key）、仓库白名单、受保护分支、审计日志、OAuth 令牌加密存储 |

**分析**：AgentHub 的安全是「**运行时防护**」（防 LLM 干坏事）；workAssist 的安全是「**组织级治理**」（防人和流程出错：什么仓库能碰、什么分支能动、谁审批、全留痕）。层次不同，面试可以讲成互补的两层安全模型。

### 2.6 可靠性设计（workAssist 独有的重头戏）

workAssist 有三块 AgentHub 完全没有的分布式可靠性机制：

1. **租约队列**：`worker_jobs` 表 + `lease_token` + 45s 过期 + 10s 心跳；心跳 3 次失败 → 主动 terminate Claude Code 进程（fencing），防止僵尸 Worker 和双跑。
2. **飞书事件幂等**：`task_messages` 表双键（event_id / message_id）部分唯一索引去重，重复事件直接返回历史结果。
3. **演进故事**：JSON 队列文件 → PostgreSQL 队列 + 租约 → Worker fencing，三版演进，有完整的「问题 → 方案 → 结果」叙事。

AgentHub 对应的只有进程内并发信号量和 HMR-safe 单例（EventBus 挂 globalThis），因为它是单机单用户，天然不需要分布式一致性。

---

## 3. 功能对比

| 功能域 | AgentHub | workAssist |
|---|---|---|
| 会话管理 | 多会话并行、搜索、置顶、归档、未读、单聊/群聊 | 飞书群绑定会话（每群一个活跃 Job）、120min TTL、多轮澄清状态机 |
| 消息操作 | 引用回复、撤回、编辑重发、重新生成、收藏、Pin、选区引用、斜杠命令 | 卡片按钮确认/取消、文本命令（长连接模式下） |
| 多 Agent | 4 个 Adapter + 用户自建 Agent（Agent Builder） | Code Agent + Doc Agent（M2 stub），agents.json 注册 |
| 任务编排 | LLM 拆解 + DAG 并行 + 证据门控 + 冲突检测 | 关键词拆解（M1）+ Job/Task 状态机 |
| 代码执行 | 进程内 bash 工具（沙箱 + 审批） | 三执行后端：GitHub Actions / GitLab CI / 本机 Worker |
| 产物系统 | 6 种 Artifact 类型 + 版本链 + 内联预览 + 二次编辑 + 部署预览 | PR / 飞书文档（只读分析报告）/ 审计日志 |
| 上下文管理 | 跨 run 上下文序列化 + context_summaries 压缩表 | 会话 messages 历史 + pinned 上下文 |
| 附件 | 图片/文件附件 + read_attachment 工具 | — |
| 审批流 | fs_write / bash / ask_user 三类 pending 审批 | 高风险关键词审批 + PR 人工合并 |
| 多租户 | — | tenant_key 隔离 |
| 部署形态 | 本地 pnpm dev / Electron 桌面版（DMG/EXE）/ 移动端脚手架 | 服务器 + 本机 Worker 分离部署 / 同机部署 |
| Token 计量 | run.usage 事件 + 用量分析 | — |

**功能覆盖面**：AgentHub 明显更宽（IM 体验、产物预览、Agent Builder、桌面/移动端）；workAssist 更深地打通了一条垂直链路（飞书 → 拆解 → 执行 → 验证 → PR → 文档回执）。

---

## 4. 工程化与成熟度对比

| | AgentHub | workAssist |
|---|---|---|
| 测试 | 27 个单测（Vitest）+ 2 个 Playwright E2E | 13 个测试文件 2,377 行（pytest），无 E2E |
| 文档 | 18 份编号 spec + OVERVIEW.md + CLAUDE.md（AI 协作契约）+ 中英双语 README | 6 份技术文档（含 678 行平台重构设计、租约机制设计） |
| 规范 | commit 规范、命名规范、五层铁律、spec 与代码冲突以 spec 为准 | Alembic 迁移版本化、策略配置模板、env 分离模板 |
| CI/CD | — | —（两者都没有，都是手动） |
| 明显短板 | E2E 覆盖窄；CustomAgent 直调 toolRegistry 越层；bash/SDK 写入不在冲突检测内；移动端未完成 | 无流式、无 Web UI、DocAgent 未完成、无监控告警、拆解靠关键词 |

---

## 5. 面试视角：亮点与叙事

### 5.1 workAssist 的面试亮点（你的主场）

1. **分布式可靠性三件套**（最硬的技术点）
   - 租约 + 心跳 + fencing：讲清「为什么 45s 过期 / 10s 心跳 / 3 次失败」「为什么必须 terminate 进程而不是等它自然结束」（防双跑写脏数据）
   - 幂等去重：讲清「为什么用 DB 部分唯一索引而不是内存 Set」（多实例 + 重启安全）
   - 唯一约束当并发原语用：`(job_id, iteration)`、`UNIQUE(run_id)`，让数据库替你做分布式锁

2. **企业级治理**（区别于玩具项目的关键）
   - 仓库白名单 / 受保护分支 / 风险关键词审批 / audit_logs / 租户隔离 / OAuth 加密——这是一套「组织敢用」的安全模型

3. **三种可插拔执行后端**
   - 同一个 CodeAgent 能跑在 GitHub Actions、GitLab CI、本机 Worker 上，Executor 协议 + 回调对账

4. **只读分析模式**
   - `git worktree --detach` 临时区 + 不开分支不推远程 + 产出直转飞书文档，一个很优雅的场景化设计

5. **两段演进故事**（面试官最爱）
   - 单体 → 多 Agent 平台内核：678 行设计文档、5 个里程碑、双轨并行、旧 `/ai-fix` 链路长期兼容
   - Worker 可靠性：JSON 文件队列 → PG 租约队列 → fencing

6. **验证闭环**
   - verify_commands 来自策略而非 LLM（信任边界清晰）、失败回喂修复 2 轮、`needs_attention` 保留现场转人工

### 5.2 AgentHub 值得你借鉴 / 引用的点

面试中被问「市面上/开源已有类似项目，你的差异化在哪」时，可以主动引用 AgentHub 这类项目做对照：

| AgentHub 的做法 | 你的对应回答 |
|---|---|
| SSE 细粒度流式事件 | 「我的场景是飞书异步任务，用户不盯屏，阶段回调 + 状态机比 token 流更适合；如果做 Web 控制台，会引入类似 part.delta 的增量事件」 |
| MessagePart 结构化消息 | 「受飞书卡片协议限制走 markdown；自建 UI 时会采用结构化 parts + callId 关联」 |
| LLM 驱动 DAG 拆解 + 证据门控 | 「我的 M1 是关键词启发式拆解，规划中是 LLM 拆解；AgentHub 的 evidence gates（子任务显式上报验收结果）是我可以吸收的质保思路，对应我已有的 verify_commands 闭环」 |
| Adapter 四层 Key 解析链 | 「我有 per-agent 策略引用 + 全局策略文件 + env 三层，思路同构」 |
| 双平台 bash 黑名单 | 「我的信任边界在 PR + 策略层，不在 shell 层——因为我默认执行环境是 CI 或隔离 worktree」 |

### 5.3 差异化定位话术（建议背下来）

> 「AgentHub 这类项目把多 Agent 协作做成一个本地 Web 产品，重点在交互协议和前端体验；workAssist 解决的是另一个约束条件下的问题：在飞书生态里、跨分布式 Worker、对企业仓库做受治理的代码自动化。核心难点不在展示，而在可靠性（租约/幂等/fencing）和治理（白名单/审批/审计）。两者对『编排』的抽象也不同：AgentHub 抽象模型平台差异，我抽象执行环境差异——所以我的系统能把同一个 CodeAgent 调度到 GitHub Actions、GitLab CI 或本机 Worker 上执行。」

### 5.4 如果想继续增强 workAssist（吸收 AgentHub 优点，按性价比排序）

1. **LLM 驱动任务拆解**替换关键词启发式（你已规划，直接对齐 AgentHub 的 plan_tasks 模式）
2. **子任务验收上报**（evidence gates 思路，补强 verify_commands 的语义层验收）
3. **Web 控制台 + SSE 流式进度**（借鉴 StreamEvent 事件分级：job/task/step 三层事件）
4. **DAG 并行 + 写冲突检测**（多 Task 并行改同一仓库时的文件级冲突上报）

---

## 6. 总结矩阵

| 维度 | 更强的一方 | 理由 |
|---|---|---|
| 架构协议设计 | AgentHub | StreamEvent 统一协议贯穿五层，类型系统粘合 |
| 分布式可靠性 | **workAssist** | 租约 / 幂等 / fencing / DB 并发原语 |
| 前端体验 | AgentHub | SSE 流式 + 结构化渲染 + 完整 IM 操作集 |
| 企业安全治理 | **workAssist** | 白名单 / 保护分支 / 审批 / 审计 / 多租户 |
| 编排智能 | AgentHub | LLM 拆解 + DAG + 证据门控 |
| 执行链路完整度 | **workAssist** | 三执行后端 + 验证闭环 + PR + 飞书回执 |
| 工程规范 | 平手 | AgentHub 胜在 spec 体系，workAssist 胜在演进文档 |
| 规模 | AgentHub | 38k 行 vs 8k 行（但 workAssist 密度更高、故事更完整） |

**最终结论**：这不是「谁更好」的关系，而是**产品平台 vs 生产系统**、**体验协议 vs 可靠治理**的互补关系。面试的最佳策略是用 AgentHub 作为「业内参照系」反衬 workAssist 的差异化：别人在做怎么让多 Agent 好看好用，你在做怎么让多 Agent 在企业里**敢用、可靠、可审计**。
