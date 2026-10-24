# 开发变更记录

## 2026-09-13 — 范围确认与开发启动

- 用户已确认本机个人版：访问安全、项目/会话恢复、自动压缩、SSE、长期记忆全部交付。
- Q11–Q13：项目迁移先建议后确认；保留 Electron/本机浏览器；显式偏好和已确认决策可自动生效，推断记忆待确认。
- 基线 a1a18c8，与 origin/main 同步。保留原工作区已有修改，不推送远程。
- 在 E:/Work/Codex/agenthub-dev 开发副本验证；真实数据库不用于测试。
- 已记录批准的 HTTP、服务层、上下文、事件和记忆测试边界。
- 依赖按现有 pnpm-lock.yaml 安装，不新增依赖。

| 工作包 | 状态 | 验证 |
|---|---|---|
| SEC-01 本机认证与凭证 DTO | 已实现 | HTTP、浏览器、认证与 DTO 测试通过 |
| PRJ-01 项目与迁移建议 | 已实现 | 归属事务、项目管理与筛选验证通过 |
| SES-01 会话隔离与中断恢复 | 已实现 | 持久键、串行取消、生产重启与显式继续验证通过 |
| CTX-01 自动压缩与预算 | 已实现 | 超限拒绝、失败保留、同毫秒覆盖和来源变更测试通过 |
| EVT-01 SSE 恢复 | 已实现 | 游标重放、快照替换、删除校准与重启恢复通过 |
| MEM-01 长期记忆 | 已实现 | 范围、来源、删除防再生、替代及提取失败测试通过 |

## 2026-09-13 — 本机个人版实现与验收

### 修改内容及原因

- SEC-01：增加统一请求边界、本机配对及凭证响应白名单；保护业务 API、SSE 和私有预览，关闭旧移动端入口。Electron 绑定 loopback 并由主进程设置 Cookie；浏览器配对有效期 24 小时。Key 编辑区不再回显真实 Key，留空保留、显式清空删除。
- PRJ-01：增加 Project 和独立会话归属表，创建会话支持项目；已有绑定路径只生成建议。项目筛选同时覆盖活动和归档会话，保留 Windows 根路径语义。
- SES-01：SDK handle 持久化到 SQLite，Claude/Codex 统一为会话+Agent 粒度；同键串行、取消排队、配置/项目/摘要/记忆改变时失效。新 SDK 会话注入公开历史。启动把运行中任务标为中断；用户点击继续前旧审批不复活，重复请求拒绝。界面选择和文件 tab 保存至服务端，跨临时端口恢复。
- CTX-01：默认自动压缩，系统/当前输入/记忆、Pin、摘要均纳入预算；取消空历史兜底。摘要覆盖使用 rowid，事务保存前核验原文没有变化，失败保留原文。显式选择不可用辅助 Agent 时报错，不暗中切换服务商。
- EVT-01：事件先持久化再广播，递增游标、有界重放、全量快照校准及客户端去重；调度状态另行持久化，旧审批仅作历史。增加慢消费者断开和已撤销 Cookie 心跳检查。
- MEM-01：个人偏好与项目记忆分域；后台有界增量提取，校验来源引用，显式内容生效、推断待确认。支持查看来源、编辑、停用、删除防再生及替代旧事实。生成与使用独立开关，辅助模型用量和失败作业可查看。清空、撤回和重生成历史时重置提取游标，避免 SQLite rowid 重用导致漏读。
- 数据：新增能力采用幂等增量启动迁移；Drizzle 声明同步，开发工具可指定隔离数据目录并排除 FTS 管理表。
- 文档：新增 Spec 16 和 OpenSpec change，旧能力规格添加优先级说明；更新开发计划、CLAUDE 及中英文 README，提供本机操作说明。
- 验证环境：Vitest、Playwright 使用隔离数据目录，E2E 明确区分已配对和匿名浏览器。补充可选环境变量类型声明以兼容工作区已有内置 Agent 修改；未改动这些已有业务逻辑。

### 验证记录

| 检查 | 结果与范围 |
|---|---|
| `pnpm test` | 41 个测试文件通过；220 项通过，1 项既有跳过 |
| `pnpm typecheck` | 通过 |
| `pnpm exec tsc -p electron/tsconfig.json --noEmit` | 通过 |
| `pnpm lint` | 通过，无警告 |
| `pnpm build` | Next 生产构建通过，使用 Electron ABI |
| Playwright | 完整回归 7 项全部通过：原有聊天/会话流程和新增本机安全/项目流程 |
| 真实本机 HTTP | 未配对 401、跨站 403、移动端 403、配置响应不含测试 Key、SSE 快照脱敏通过 |
| standalone + Edge | 按打包顺序复制静态资源后启动；跨进程/端口恢复历史、文件 tab、中断任务，显式继续及重复继续 409 通过 |
| SDK 持久关联 | 独立进程核验 SQLite 中假 SDK handle 保留；未调用收费服务商 SDK |
| 旧库启动迁移 | 新建旧结构副本，保留原会话/消息；升级后新表存在、SQLite integrity_check=ok |
| `drizzle-kit push --force` | 在另一个隔离旧库失败：`index idx_conv_updated already exists`。工具尝试重建旧表后重复创建索引，未对真实数据运行 |

生产页面首次验收时，测试服务早于静态资源复制启动，出现 404；按 `build → electron:prebuild → standalone` 顺序重启后复测通过。该问题没有通过放宽认证绕过。

### 使用与升级

1. 关闭旧进程，备份完整应用数据目录；源码运行默认 `.agenthub-data`，Electron 使用应用 userData，可由 `AGENTHUB_DATA_DIR` 指定。备份应包含数据库、WAL 与 SDK/工作区文件。
2. 安装现有锁文件依赖，运行 `pnpm dev`；应用启动自动增量升级。不要对真实旧库使用本次已发现不兼容的 `db:push`。
3. 浏览器打开本机地址，在同一数据目录下运行 `pnpm local:pair`，输入显示的配对码。24 小时到期后重新配对；Electron 重启时重新授权。需要撤销已配对浏览器时运行 `pnpm local:pair -- --rotate`。
4. 进入“项目与记忆”建立项目，确认旧会话归属；配置现有模型后使用默认自动压缩和后台记忆。可独立关闭记忆使用或生成。
5. 中断任务点击继续后先检查已完成步骤；任何不能确定的外部副作用应再次确认，旧审批不会自动获批。

### 尚未验证与限制

- 未撤销用户之前被盗的服务商 Key；这必须在对应服务商后台完成，应用补丁不能代替撤销。
- 未验证真实付费模型的摘要质量、OAuth-only 辅助模型调用或真实 SDK 内部磁盘会话恢复；无可用 API 凭证的辅助 Agent 会明确报错。
- 已验证 Next/Electron 类型、生产产物及浏览器流程，未生成和安装 NSIS 安装包，也未声称完成真实 Electron GUI 安装验收。
- SSE 首期采用全量快照；超大历史规模仍需分页优化。任务续接核对证据不能提供任意命令外部副作用的 exactly-once 保证。
- `db:push` 旧库兼容性问题独立保留，运行时增量迁移已验证。回退使用备份和对应旧代码，不在新库上直接继续使用旧版本。
- 已将 108 个本任务文件同步到原仓库，逐文件 SHA-256 核验一致；原工作区 `.env.example`、内置 Agent 及既有测试的哈希与开发前一致，其他既有未提交文件保留。真实应用数据未用于测试，不推送远程。

### 本地提交索引

| 提交 | 工作内容 |
|---|---|
| `77695cf` | 批准规格、决策和既有规格优先级 |
| `e65ae21` | 新能力持久化表、迁移及测试环境 |
| `fac7785` | 本机认证与凭据边界 |
| `465085a` | 项目与会话归属 |
| `0f620d0` | SDK 关联与中断续接 |
| `3b1a3f1` | 自动压缩与硬预算 |
| `3800ff0` | 持久事件与快照恢复 |
| `59021b6` | 长期记忆与管理入口 |
| `bd37e42` | 浏览器验收、使用说明及变更记录 |

提交后已再次 fetch origin：这 9 个本地功能/验收提交对应远端新增 0 个提交；本索引另作记录提交。最终生产构建通过，提交差异通过 `git diff --check`。以上验证针对完整工作区版本，中间工作包提交存在跨包依赖，应以最终提交整体运行。

## 2026-09-13 — 项目与记忆管理页视觉改版

- 用户反馈原页面缺少设计层次，要求参考 Codex 风格；基线为 `a0de22e`。
- `src/components/personal-panel.tsx`：将长表单拆成项目、长期记忆、上下文三个设置入口；增加项目卡片、会话搜索、记忆范围筛选和完整空状态。设置改为左侧名称/说明、右侧控件，复用原 API 和保存逻辑；任务状态改为中文显示，记忆状态增加标记。
- `src/components/personal-panel.module.css`：新增局部灰阶主题、固定导航、独立内容滚动、统一字号/留白/细分隔线、单色按钮和开关。补齐深色模式、390px 窄窗口、键盘焦点和减少动画偏好；不改变聊天界面全局主题。
- `e2e/local-reliability.spec.ts`：将原有管理页验收适配到三个新导航入口；原业务断言保留。
- `specs/16-local-personal.md`：同步管理页导航、筛选、滚动和主题契约。
- 验证：TypeScript、页面与用例 lint 通过；完整 Playwright 7 项通过。使用隔离数据在 Edge 实屏检查项目/记忆/上下文、深色主题与 390px 窄窗口，底部设置可滚动访问、无水平溢出、无浏览器运行错误。生产构建通过（Next 编译、类型检查及静态页面生成完成）。
- 本次只调整管理页及对应文档/用例，无新增依赖，不触碰真实数据及用户已有未提交修改。


## 2026-09-13 — 全应用灰阶工作空间

- 用户授权将项目与记忆页的视觉风格扩展到本机应用全部页面；基线为 `d77390d`，规格见 Spec 17。
- 统一浅深色主题、字体、按钮、输入、菜单、标签、弹窗、焦点、边框和间距，保留审批/失败/成功状态的语义色。修正字体变量自引用。
- 新增主工作空间布局：对话、Agent 库、产物库与用量分析在主区域切换；侧栏保留导航、会话入口、设置和主题切换。
- 重排 Agent 卡片、产物行、用量卡片及空状态；优化聊天欢迎页、消息、输入器、工具/审批/引用和文件/产物预览宿主界面。
- 设置改为侧向分类导航，统一创建 Agent、创建会话、搜索及其他公共弹窗；配对页使用一致的卡片、状态提示与提交控件。
- 修复跨页面全局搜索返回会话；回归发现新数据库没有搜索索引，将既有 FTS 迁移接入 bootstrap，首次建立时回填历史，后续启动避免重复全量回填。该修复单独提交。
- 验证：41 个测试文件通过，220 项通过、1 项跳过；Playwright 9 项全部通过（包含跨页面搜索与主导航），TypeScript 与全项目 lint 通过。生产构建通过（Next 编译、TypeScript、25 个静态页面生成与优化均完成）。
- 实屏覆盖对话、Agent 库、创建 Agent、产物库/文档预览、分析、设置、新会话、搜索及配对，另检查深色与 390px 窄窗口；窄窗口无水平溢出，捕获过程中无浏览器运行错误。文件侧栏检查了宿主与加载状态，未将其截图作为文件内容加载成功的证据。
- 使用隔离测试数据；未调用真实付费模型，未进行 Electron 安装包/真实 GUI 安装验收。遗留独立手机应用仍停用，用户生成的产物内容不重绘。无新增依赖。
- 下列为本次源代码与规格变更清单（含本记录），原工作区已有改动不纳入本次提交：

- `docs/development-change-log.md`
- `e2e/local-reliability.spec.ts`
- `openspec/specs/frontend/spec.md`
- `specs/09-frontend-architecture.md`
- `specs/17-workspace-visual-system.md`
- `src/app/globals.css`
- `src/app/page.tsx`
- `src/app/pair/page.tsx`
- `src/app/workspace.css`
- `src/components/agent-avatar.tsx`
- `src/components/agent-library.tsx`
- `src/components/artifact-library.tsx`
- `src/components/artifact-preview-panel.tsx`
- `src/components/ask-user-question-dialog.tsx`
- `src/components/chat-panel.tsx`
- `src/components/dispatch-plan-card.tsx`
- `src/components/file-explorer-panel.tsx`
- `src/components/global-search.tsx`
- `src/components/message-input.tsx`
- `src/components/message-list.tsx`
- `src/components/message-parts.tsx`
- `src/components/pending-bash-commands-panel.tsx`
- `src/components/pending-write-diff-tab.tsx`
- `src/components/pending-writes-panel.tsx`
- `src/components/selection-popover.tsx`
- `src/components/settings-dialog.tsx`
- `src/components/sidebar.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/usage-dashboard.tsx`
- `src/components/workspace-shell.tsx`
- `src/db/bootstrap.ts`
- `src/db/message-search-schema.ts`
- `src/db/migrate-add-message-search.ts`

## 2026-09-23 — 模型感知的上下文预算

- 已核实的 DeepSeek Flash、V4 Pro 与 V4 Flash 别名登记为 1M 上下文，默认思考输出预留 64K；未知模型与非官方兼容端点继续使用较小的保守上限。
- 新增完整请求预算：默认输入运行上限 128K，可选至 1M；输出上限在模型能力内配置，Custom adapter 实际传入相同的 `max_tokens`。无 tokenizer 时按请求 JSON 的 UTF-8 字节数估算，预留按模型窗口与小窗口容量共同限制；用户输入、工具定义、附件、历史、摘要和置顶消息均参与检查。
- 普通轮次、隔离子任务和每一轮 Custom 工具回灌均检查预算。工具结果导致超限时保留已有事件并停止，输出被模型截断时报告不完整。自动压缩最多 16 批；辅助模型输入按其窗口和 128K 估算上限分批，不截断单条来源。
- 设置页增加输入、输出运行上限并修复保存按钮未提交表单的问题；用量面板对照最近一次实际运行的 Agent 模型窗口。E2E 开发服务使用独立 `.next-e2e` 目录，可与已有本机开发服务并行。
- 对每个模型与端点指纹只保存数字校准统计。普通/工具请求各自须达到 30 次样本且含 5 次长请求，方可按最高实际 usage 比例上浮 25% 放宽估算；样本 7 天过期，多模态请求不参与。没有足够真实模型样本时仍按 UTF-8 字节估算。
- 验证：全量 Vitest 44 文件、226 项通过、1 项跳过；TypeScript、lint 与 Next 生产编译通过。设置保存的 Playwright 用例断言通过；Playwright 进程在 Windows 清理阶段挂起，已中止清理。`pnpm build` 的 Electron SQLite ABI 重建受文件占用及头文件下载权限影响，故使用直接 Next 构建验证 Web 生产编译。未使用真实付费模型，不宣称精确填满 1M。

## 2026-10-22 — 服务器分支整合与冲突解决

- 将服务器 feat/dir-picker-new-folder 分支合入本地 codex/resolve-server-integration，保留本地模型上下文预算改动及服务器已有的新建目录能力。
- 问答交互保留非模态可折叠面板，计划审批保留任务编辑、校验与 SSE 同步；两处统一使用主分支主题变量。
- 内置 Agent 配置文件完全采用 origin/main，保留环境变量覆盖机制，不保留服务器固定智谱模型配置或硬编码凭据。
- 同步前端、编排与 StreamEvent 规格，明确待审批计划更新不会自动批准或执行。
- 验证：pnpm typecheck、pnpm lint 通过；全量单元测试 45 文件，246 项通过、2 项跳过；local-reliability 浏览器回归 4 项通过。测试期间 Google Fonts 下载失败并使用回退字体。
- 未部署或重启服务器；本次合并在本地整合分支完成。

## 2026-10-22 — SSH 隧道开发页面交互修复

- 将 127.0.0.1 加入 allowedDevOrigins，允许浏览器通过本机 SSH 转发端口连接远程 Next.js 开发资源；不使用通配来源。
- 服务器原配置仅允许公网地址，日志记录回环来源的 HMR 请求被拦截；修改配置触发开发服务器重启后，客户端初始化和按钮交互恢复。
- 通过真实 SSH 隧道验证 Agents 面板、创建 Agent 弹窗、新建对话弹窗均可打开，未捕获 pageerror；没有创建或修改业务数据。

## 2026-10-23 — Universal web tools

Implemented web_search/web_fetch via Tavily Search/Extract with shared defaults for Custom, Claude and Codex, including planning and aggregation. Added authenticated masked settings UI/API, environment fallback, cancellation, bounded responses and public-URL checks; no dependencies or schema migration. Synced web-tools capability and detailed tools/adapter/credential specs.

Validation: typecheck and lint passed; unit suite 274 passed, 2 skipped; e2e/web-tools.spec.ts passed (settings save/preserve/clear, masked DTO, anonymous denial). Provider calls mocked; no real Tavily credential or paid live search used. Not deployed to the server.

## 2026-10-23 — Web credential validation

Added explicit saved-configuration validation via one bounded Tavily search request. UI blocks validation for unsaved edits, shows loading/success/failure and quota disclosure; server redacts provider/transport errors and preserves credentials. Typecheck, targeted settings tests (10) and browser settings/authentication flow passed; paid provider response is mocked in automated tests. Live validation remains user-triggered.

## 2026-10-23 — Tavily nullable search fields

Server reproduction found a successful provider response rejected because raw_content was null. Accept nullable optional result fields while retaining required URL validation and existing output fallbacks. A regression fixture reproduced the ZodError before the fix; 33 web service/settings tests pass after the fix.

## 2026-10-23 — Resumable context management

- Replaced local estimated-input rejection with mandatory 60%/35% working-context compaction. Model identity overrides include adapter/provider/effective endpoint/model; legacy input caps are migration metadata. Default output reserve 8192 with known model capability constraints, safety 2%.
- Preserved source messages, pinned constraints, source URLs and completed tool evidence. Added bounded hierarchical summaries, retries after 2s/5s, durable paused runs, per-stage CAS checkpoints and same-run idempotent resume/cancel. Stable orchestration prompts, results and side-effect evidence survive restarts.
- Integrated Custom request boundaries and Claude/Codex native compaction/safe boundaries, invalidating stale handles on rebuild. Added tool-free SDK summaries for OAuth-only access. UI includes capacity controls, pause/retry/cancel states, compression receipts and summary token usage; monetary charges remain provider-reported.
- Fixed capacity/summary identity to match existing DeepSeek routing: saved Agent URL can differ from the effective api.deepseek.com/v1 endpoint; routing itself was not changed.
- Validation: 301 unit/integration assertions passed, 4 skipped (2 existing plus 2 opt-in live tests); typecheck and lint passed. Browser coverage: settings/authentication, chat, web tools, capacity saving, persisted pause, original-run resume and cancellation (10 distinct scenarios; recovery selector corrected and rerun). pnpm build passed; pnpm db:push passed against a disposable database. Migration on a copy of server data returned integrity_check=ok and retained all 33 source messages.
- Real Custom/DeepSeek test passed with five large retained search results, both at 1M without compaction and at a smaller forced-compaction window. Real Claude SDK session creation and post-compaction handle rebuild passed using the user's newly configured Anthropic-compatible endpoint. Codex real test encountered local TLS failure and server timeout; the user explicitly waived it for this release. SDK mocked checkpoint/rebuild/no-replay tests passed; no claim of successful live Codex validation.
- Fixed first-snapshot UI recovery overwriting a conversation selected during hydration. Recovery and local reliability browser suite passed all 6 scenarios after the fix; the search shortcut test now waits for client hydration.
- Deployed branch `codex/resumable-context-management` at `548f6db` to dsh-server, retaining loopback port 13000 and the existing SSH tunnel. GitHub fetch stalled, so the already-pushed commits were transferred as a Git bundle and verified before switching.
- Backup: `/home/ubuntu/backups/agenthub-context-20261023T142014Z`, including the complete data directory, environment files and original commit `e0122ba`. After startup, SQLite integrity_check=ok; 4 conversations, 33 messages, 5 agents and 5 artifacts retained. Settings/Agent records and environment files matched their pre-deployment hashes/content; both checkpoint tables exist.
- Real Edge browser through `ssh dsh-agenthub` at `http://127.0.0.1:13000/`: pairing, capacity/settings navigation, composer typing/clearing and Agents navigation passed without page errors or sending a message. All 5 deployed model profiles report 1,000,000 total tokens with 8,192 output reserve; the UI reports the 60% trigger. An initial verification selector matched two identically titled conversations; selecting the first matching conversation completed the check.

## 2026-10-23 — Current web-tool availability evidence

Added per-run configuration guidance, server-side probes for historical outage claims, and web_tool_status across Custom/Claude/Codex. Explicit web-unavailable ask_user questions are checked before creating a pending question; success feeds corrective evidence back to the model to continue the original task. Search and extraction probes are separate; credentials are reread, errors redacted, cancellation respected, and side-effecting tools are never replayed as probes. Runtime instructions are refreshed when restoring checkpoints.

Validation: 310 unit/integration assertions passed (5 opt-in/existing skips); typecheck and targeted lint passed. Real DeepSeek + Tavily regression on an isolated server checkout passed: stale missing-key tool history followed by “continue” resulted in actual web_search and a sourced answer without ask_user. This test did not create production messages. Claude/Codex exposure and planning permissions covered by automated tests; no new live SDK acceptance claimed.

Deployment: a7ff0f1 installed on dsh-server after confirming no active runs; backup /home/ubuntu/backups/agenthub-web-health-20261023T143755Z. Before/after counts matched (4 conversations, 32 messages, 5 agents, 5 artifacts); settings/Agent digest and environment files unchanged, SQLite integrity_check=ok. Existing SSH tunnel served HTTP 200 and web settings reported configured=true.

## 2026-10-23 — Conversation message queue

Enabled typing and enqueueing during an active response; send and stop are separate controls. Persisted per-conversation FIFO records, atomic placeholder runs/recovery journals and idempotent client message IDs prevent concurrent/retried sends from starting duplicate work. Paused/interrupted runs hold the queue; other conversations proceed. Queued messages are excluded from model/pinned history, survive reloads and can be withdrawn without deleting the preceding response. Failed sends retain input/attachments and display an inline error, including expired pairing.

Validation: full unit suite 314 passed / 5 skipped; an additional atomic-claim/recovery case and all 5 queue tests passed afterward. Typecheck and targeted lint passed; typecheck was rerun after E2E stopped writing Next generated route types. All 5 browser scenarios passed (3 existing chat scenarios, running-input/FIFO/reload, and 401 draft preservation). db:push passed on a fresh disposable directory; production uses additive bootstrap migration only. No model credentials or user messages were used for tests.
