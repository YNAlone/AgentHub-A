# 本机个人版：访问、项目、恢复与长期记忆

状态：用户已批准，本期实现及自动化验收已完成；真实付费模型与安装包验收范围见变更记录。批准范围来自 2026-09-13 的 Q1–Q13；本规格替代旧规格中的远程伴随、凭据原样返回和内存 SDK 关联约定。验证结果以 `docs/development-change-log.md` 为准。

## 1. 范围与访问边界

本期保留 Electron 和本机浏览器，服务绑定 `127.0.0.1`。手机、局域网、团队、多租户及通用 OS 执行沙箱属于后续范围。

所有页面、业务 API、SSE 和私有部署入口由 `src/proxy.ts` 统一保护。静态构建资源可公开；配对页和配对提交只允许合法本机 Host/Origin。内部 AgentHub MCP 路由另验运行时工具 token，不能使用浏览器配对身份代替。Host/Origin 校验处理 Next 的 localhost 规范化，仍要求请求 Host 为本机且端口一致；有 Origin 时必须与实际 Host 同源。

浏览器通过本机配对码换取有效期 24 小时的 HttpOnly、SameSite=Strict 签名 Cookie。Electron 主进程从自己的应用数据目录读取签名材料完成受控授权。`pnpm local:pair` 显示配对码；`pnpm local:pair -- --rotate` 轮换本机签名材料。HTTP 接口不提供配对码、签名密钥或服务商原始 Key。轮换后的 SSE 在下一次心跳时关闭。

Agent 与设置响应使用显式字段白名单，配置过的 Key 返回非秘密标记 `__AGENTHUB_CONFIGURED__`，未配置返回 null。空串和标记不覆盖已有 Key；显式 null 清空。界面把这些行为表现为“已配置 / 输入替换 / 清空”，不显示标记值。旧移动端入口返回 403，设置仅接受 companionMode=off。

这修复应用 HTTP 边界，不代表已经撤销被盗服务商 Key，也不代表本机任意进程受到 OS 级隔离。被盗 Key 仍需在服务商后台撤销。

## 2. 项目与迁移

新增 Project：`id、name、createdAt`。`project_conversations` 表把一个 Conversation 归属到零或一个 Project；一个 Project 可包含多段 Conversation。Workspace 的路径和归属分离，改变项目不移动文件。

`GET /api/projects` 返回 projects、memberships 和根据规范化本地目录分组的 suggestions。`POST` 的 action=create 创建项目；action=assign 进行明确归属，projectId=null 解除归属。`POST /api/conversations` 可带 projectId，在同一事务中创建会话与归属。已有临时会话保持未归属；迁移建议需用户选择项目确认。

侧栏按项目过滤，选定具体项目时创建的会话直接归属该项目；`/personal` 提供项目和多会话管理。

管理页采用独立设置侧栏，分为“项目”“长期记忆”“上下文”三个入口。项目页提供项目卡片、会话标题搜索和归属筛选；记忆页提供项目范围筛选、来源和状态操作；上下文页以说明与控件对齐的设置行组织开关、模型、输入上限和并发。使用局部灰阶主题，支持深色及窄窗口；主内容区域独立滚动，所有原有业务操作和保存语义保持一致。

## 3. SDK 关联、任务和界面恢复

`sdk_sessions` 以 `(adapter namespace, conversationId:agentId)` 为主键保存 SDK handle。Claude 与 Codex 使用一致粒度。服务层提供持久化能力，Adapter 仅使用关联注册表接口；SDK 自身的磁盘运行数据仍由 SDK 管理。

同一 SDK 键串行执行，排队取消不启动 SDK。模型、endpoint、凭据指纹、workspace、系统指令、可用工具、项目或摘要版本变化会重建关联。排队期间上下文改变时，旧输入会被拒绝，提示使用最新上下文重发。

正常恢复优先使用原 handle。新 SDK 会话注入应用保存的公开历史、近期消息、Pin 和摘要；已有 handle 不重复回灌历史。只有明确的 missing session/thread 错误，且 SDK 尚未初始化，才允许本轮受控重建；其他失败不自动重放可能产生副作用的操作。

启动 instrumentation 把 queued/running/compacting 的 AgentRun 标为 interrupted，paused 保持可恢复状态，把 streaming 消息标为 aborted，保留已有 parts。审批 Promise 不跨进程复活，旧审批没有执行能力。待审批事项随中断提示失效，用户继续后需重新申请。已完成写入等证据随消息保留。

旧版无检查点任务的 `POST /api/runs/:id/continue` 要求 `{confirm:true}`；通过条件更新抢占一次续接，重复点击返回 409。新请求包含旧 run 标识和有限的执行证据，要求先核对文件、命令和部署结果再继续；不宣称命令外部副作用有 exactly-once 保证。无法确定是否执行的步骤必须重新向用户确认。

`PUT /api/personal/ui-state` 保存活动会话、文件面板、打开的文件 tab 和产物预览。重启通过 SSE 快照恢复；已删除实体和失效审批 diff tab 会过滤。服务端保存可跨 Electron 临时端口变化恢复。

## 4. 上下文与自动压缩

模型总窗口、输出预留、压缩触发阈值分别配置。可用输入容量 = 总窗口 − 输出预留 − 2% 安全余量（小窗口余量最多为剩余容量的 25%）；默认输出预留 8192，受已知模型输出能力约束，已有明确输出设置优先。旧 contextInputLimitTokens 仅保留为迁移记录，不再拦截运行。

容量覆盖按适配器、供应商、规范化实际端点、模型 ID 隔离，用户设置优先于模型表。GET/PATCH /api/settings/context-capacity 读取实际 Agent 容量和保存覆盖。自定义 deepseek-v4-flash 与已确认 open.bigmodel.cn 的组合为 1,000,000；当前 DeepSeek provider 实际固定请求 api.deepseek.com/v1，容量、摘要和校准均使用实际端点，不改变原有路由。未知模型不继承这个窗口。

自动压缩不可关闭，默认达到可用输入的 60% 触发，目标 35% 以下。冷启动按中文、英文和 JSON 结构估算，不以 UTF-8 字节冒充 tokens；取得 usage 后采用最近实际输入加新增内容估算，模型和端点及工具请求分别校准。估算只驱动压缩，不判定任务失败。明确的供应商上下文超限触发强制压缩并重发，最多两次；认证、限流、网络错误不当作超限。

Custom 在每次模型请求前检查，包括规划、执行、汇总及工具返回后。系统指令、置顶约束和最新请求保留，已完成工具结果与旧历史按体积选择，不保留固定六条下限。大输入分块并逐层合并，摘要通道容量独立计算。摘要保留目标、约束、决定、来源 URL、文件引用、执行结果和待办；为空、截断或未缩小均不替换原上下文。完整原文、工具结果和文件始终独立保留。

首次摘要失败后等待 2 秒、5 秒各重试一次，仍失败将原 run 标为 paused 并保存现场。固定内容无法容纳时明确暂停，不裁剪用户要求。摘要默认使用当前 Agent，指定辅助 Agent 时使用该 Agent；OAuth-only Claude/Codex 通过各自无工具 SDK 摘要会话，不静默转向无关供应商。摘要用量单独记录并显示回执；实际金额以供应商账单为准，不编造未知网关价格。

Claude/Codex 的精确控制点受 SDK 限制：配置原生压缩作为兜底，监听公开用量、工具和压缩事件，在可观测安全边界检查并按需重建会话。工具执行途中不强制重启。应用压缩成功后必须废弃旧 handle，并以摘要、必要内容、完成操作记录建立新会话；已完成的 SDK turn 若仅摘要失败，恢复只重试摘要，不重跑 turn。不承诺 SDK 内部每个请求都精确在 60% 触发。

run_context_checkpoints 以 (run_id, stage) 隔离，通过 revision CAS 保存工作上下文、阶段、原文引用、工具状态、SDK handle、用量和重试记录；run_workflow_journal 保存任务参数、完成阶段、子任务结果、文件/命令证据及摘要用量。凭据不写入检查点。POST /api/runs/:id/resume 原子抢占 paused/interrupted，复用原 run ID，多次点击共享运行。重启保留 paused；运行中的任务改为 interrupted。恢复不自动重放完成的工具，未确认副作用的调用保持暂停并请求核对。暂停的依赖任务不启动下游。

界面显示 compacting、摘要重试次数、paused 与“重试并继续”“取消任务”。压缩成功保留前后估算与摘要用量通知。手动会话摘要仍以 rowid + messageId 覆盖游标保存，并原子校验来源、写入摘要和废弃旧 SDK 会话；其原文亦不删除。
## 5. SSE

业务事件写入 SQLite `stream_events` 后广播，SSE `id` 为单调 AUTOINCREMENT 游标。短重放窗口保留最近 10000 个事件；Last-Event-ID 有效时有序补发，随后以同一当前水位发送完整 snapshot 校准；过期或非法游标直接走 snapshot。

snapshot 包含脱敏 Agent、会话、消息、产物、run、当前有效审批、持久化调度事件与界面状态。客户端替换实体映射，清理离线期间已删除的实体，按游标拒绝重复 delta。调度计划及执行状态独立保留，不依赖短重放窗口；重启后 pending/running 子任务显示已中止。历史审批事件不恢复为可执行授权。

初期快照为本机数据库全量实体，规模增长后的分页/增量快照需另行优化。心跳 15 秒，断开后移除监听器；过慢消费者须断流重连校准，不能无限堆积内存。

## 6. 长期记忆

Memory 字段：`id、scope(personal/project)、projectId、content、sourceConversationId、sourceMessageIds、evidence、status(active/pending/expired/deleted)、createdAt、updatedAt、supersedesId`。

- 个人偏好可跨项目；项目事实、决策和经验仅在所属项目召回。未归属会话不生成项目记忆。
- 用户原文中明确表达的偏好和已确认决策可以自动 active；推断结果 pending。模型需提供连续原文引用，服务端核对消息与引用。Key、密码和执行授权不进入记忆。
- 同范围相同已生效内容去重；明确确认的替代事实通过 supersedesId 使旧事实 expired。推断替代需用户确认。用户可修改、确认、停用和删除。
- 删除清除记忆正文与引用，保留来源 tombstone，阻止从同一来源再生。相关 SDK 关联失效；源对话原文仍独立保留。原消息已删除时，来源界面明确说明缺失。
- 召回采用 SQLite 范围过滤、关键词与更新时间排序，记忆注入有独立 2000-token 上限，并纳入总上下文预算。个人偏好优先，具体项目内容只能从匹配项目取。记忆是参考数据，不构成新执行授权。

后台每 15 秒检查新增完整消息，按持久游标增量提取，默认输入上限 12000 字符、并发 1，配置最多 60000 字符和并发 2，单作业超时 60 秒。失败保留来源和游标，记录可查看的状态，退避 5 分钟或由保存设置触发重试。超长单条来源明确失败，需提高上限或人工整理。模型调用期间来源或项目归属改变时放弃结果。

`GET/PATCH /api/memories` 提供列表和编辑状态；`GET /api/memories?source=:id` 返回来源消息及缺失列表。`GET/PATCH /api/personal/settings` 管理压缩阈值（自动压缩不可关闭）、记忆使用、后台生成、辅助模型、输入上限和并发，同时返回用量及作业状态。关闭生成会中止后台请求，关闭使用停止未来注入；已有记忆保留供查看和修改。

## 7. 数据升级与验收

新增表由启动迁移幂等创建，保留原会话、消息和文件，不自动迁移项目归属。`schema.ts` 与启动 DDL 同步。上线前停止旧进程并备份整个应用数据目录（包含 SQLite WAL 和 SDK 目录）；迁移先在副本验证。回退应恢复备份和对应代码，不能只切旧代码后继续写已迁移数据。

验收使用临时 SQLite、假模型及 mock Adapter；覆盖认证/DTO、归属、SDK 键隔离、预算边界、失败压缩、游标恢复、记忆来源/范围/删除/替代。实际 HTTP 与浏览器检查配对、侧栏/管理页、继续任务和 SSE；执行 TypeScript、lint、相关测试与构建。真实服务商模型质量和实际安装包仍需区别记录验证范围。

## 联网工具凭据

GET/PATCH /api/settings/web-tools 复用本机配对认证与同源写保护。凭据存 personal_settings 的 web-tools 行，优先于 TAVILY_API_KEY。读取只返回 provider/configured/source/stored；写入 apiKey 空串或省略保留，null 清除保存值但环境变量仍生效。它与模型供应商 Key 独立，全 Agent 共用；详情见 specs/07-tools.md「共享联网工具」。
