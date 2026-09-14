# Matt Pocock Skills：安装清单与 AgentHub 使用指南

日期：2026-09-13。

## 安装结果

- 源仓库：[mattpocock/skills](https://github.com/mattpocock/skills)。
- 固定提交：`3cca18b368ae95cdbdebbff572ccafa662551015`。
- 安装位置：`C:\Users\Lenovo\.codex\skills\<技能名>`。
- 已安装所有 37 个含 SKILL.md 的目录；25 个列于作者正式插件清单，4 个位于 misc，8 个位于 in-progress。deprecated 目录此次没有可安装 SKILL.md。
- 使用 Codex 自带 skill-installer 脚本按固定提交复制文件；未执行仓库技能内的 Shell 脚本、Git hooks、项目初始化或自动部署。
- 这是一次固定版本安装，不会自动追踪上游更新。没有用 skills.sh 安装，因此不要假设 `npx skills update` 会管理这批目录。
- 下一轮对话可使用这些技能。若当前 UI 列表未刷新，可以新建任务重新加载技能。

## 怎么调用

在 Codex 输入 `$技能名` 并说明任务，或明确写“使用 xxx 技能”。例如：

```text
使用 $diagnosing-bugs，依据访问边界计划定位 AgentHub 的未鉴权接口，使用占位 Key，不打印真实凭证。
使用 $tdd 实现 SES-01：先验证同一群聊的两个 Claude Agent 不共享 SDK 会话，再完成修复。
使用 $code-review 审查相对于指定 commit 的改动，同时检查 OpenSpec 与代码规范。
```

作者文档的 `/skill-name` 是其宿主示例；Codex 中优先通过技能选择器或 `$skill-name` 调用，不承诺所有 Claude slash command 原样可用。标记 `disable-model-invocation` 的技能尤其应显式调用。

技能是工作方法和参考材料，不是新的模型、常驻后台服务，也不自动赋予账号权限。Codex 的技能目录不会自动进入 AgentHub 的 Custom/Claude/Codex Adapter；AgentHub 运行时接入需要单独设计装载、权限和 prompt 注入。

## 一、工程类：18 项（正式清单）

| 技能 | 做什么 | AgentHub 中的调用示例 |
|---|---|---|
| ask-matt | 根据当前情况推荐合适技能/流程 | `$ask-matt 我准备修会话恢复，应从哪一步开始` |
| diagnosing-bugs | 分阶段定位复杂 Bug、验证假设和根因 | `$diagnosing-bugs 定位重启后上下文丢失` |
| codebase-design | 设计简单接口、封装复杂行为和可测试边界 | `$codebase-design 设计 ContextBuilder 接口` |
| domain-modeling | 统一领域术语，维护 CONTEXT.md 和 ADR | `$domain-modeling 区分 Conversation、SDK Session、Run、Memory` |
| grill-with-docs | 通过需求追问完善设计，同时记录术语和 ADR | `$grill-with-docs 讨论团队版租户边界` |
| implement | 根据已明确的规格/工单实施，并配合测试和审查 | `$implement 按 SES-01 规格实现，不扩展范围` |
| improve-codebase-architecture | 识别架构改进点，生成 HTML 报告并逐个讨论 | `$improve-codebase-architecture 检查 AgentRunner 的模块边界` |
| prototype | 用可抛弃原型验证设计问题 | `$prototype 验证记忆查看与纠错交互` |
| research | 用一手来源研究问题，委派后台研究并保存文档 | `$research 核查固定版本 SDK 的 session resume 语义` |
| resolving-merge-conflicts | 理解双方改动意图，处理 merge/rebase 冲突并验证 | `$resolving-merge-conflicts 处理当前冲突，保留两边需求` |
| setup-matt-pocock-skills | 为项目配置工单来源、分诊标签、领域文档位置 | `$setup-matt-pocock-skills 为 AgentHub 配置本地工单和文档` |
| tdd | 红→绿→重构，关注行为和真实边界 | `$tdd 验证匿名请求不能读取设置中的 Key` |
| to-spec | 将已有讨论直接综合为规格并写入配置的工单位置 | `$to-spec 把自动压缩讨论整理为规格，仅保存本地` |
| to-tickets | 把规格拆成可端到端交付的工单并声明依赖 | `$to-tickets 拆分 SEC-01，使用本地文件` |
| triage | 按状态和标签整理问题/外部 PR，形成可执行任务 | `$triage 整理本地待办并区分缺信息与可实施项` |
| wayfinder | 为跨多个会话的大工程建立决策任务地图 | `$wayfinder 规划 AgentHub 团队化改造` |
| code-review | 并行从代码规范和需求一致性两个角度审查差异 | `$code-review 审查当前分支相对 main 的改动` |
| wizard | 生成交互式 Bash 向导，指导必须由人完成的操作 | `$wizard 设计凭证轮换步骤；当前 Windows 优先用 PowerShell 可执行方案` |

`research` 和 `code-review` 内含委派工作流；安装不代表已经运行。`wizard` 的现成模板依赖 Bash；本项目要求优先 PowerShell，不能直接承诺原模板在原生 Windows 可运行。

## 二、工作方法类：7 项（正式清单）

| 技能 | 做什么 | 示例 |
|---|---|---|
| grill-me | 通过深入追问检验想法 | `$grill-me 是否值得做多租户` |
| grilling | 追问流程的底层技能，按依赖组织问题 | `使用 grilling 检查自动压缩的失败场景` |
| handoff | 将当前工作压缩为下一位 Agent 可接续的交接文档 | `$handoff 下一任务继续实现 SSE 恢复` |
| teach | 在工作区建立可跨会话继续的教学记录 | `$teach 讲清 HTTP、SSE 和 JSON-RPC 的关系` |
| to-questionnaire | 为掌握外部信息的人生成异步问卷 | `$to-questionnaire 给部署负责人整理网络暴露排查问题` |
| wait-what | 要求把上一段解释重新说清楚 | `$wait-what 用项目实例解释 SDK 会话` |
| writing-for-agents | 优化技能和 AGENTS/CLAUDE 等供 Agent 阅读的指令文档 | `$writing-for-agents 检查项目协作约定是否含糊` |

grill 系列有意进行较多提问，适合需求尚不清楚时；已有明确规格的任务直接用 implement/tdd，无需每次重新访谈。

## 三、专项工具：4 项（misc）

| 技能 | 做什么 | 使用限制/示例 |
|---|---|---|
| git-guardrails-claude-code | 为 Claude Code 配置危险 Git 命令拦截 hooks | 属于 Claude Code，不是 Codex 权限配置；此次未启用 hooks |
| migrate-to-shoehorn | 用 shoehorn 替换测试里的不安全类型断言 | 仅测试代码；引入依赖前遵守项目依赖约定 |
| scaffold-exercises | 生成作者课程体系的习题目录 | 依赖特定课程工具，AgentHub 日常开发通常不用 |
| setup-pre-commit | 设置 Husky/lint-staged 等提交前检查 | `$setup-pre-commit 为项目设计提交前检查`；安装技能不会自动修改 Git hooks |

## 四、开发中：8 项（in-progress）

| 技能 | 做什么 | 注意 |
|---|---|---|
| claude-handoff | 把工作交给新的后台 Agent 立即继续 | 偏 Claude 工作流，跨宿主先检查能力；一般先用 handoff |
| implement-spec | 根据规格实施代码 | 与正式 implement 重叠，优先正式 implement |
| loop-me | 通过追问明确工作流规格 | 开发中，明确需求时无需使用 |
| retro | 对编码会话进行回顾 | `$retro 复盘本次修复的根因、测试与流程` |
| setup-ts-deep-modules | 配置 dependency-cruiser 约束 TS 模块依赖 | 会涉及依赖和项目规则，先设计再实施 |
| writing-fragments | 收集写作原始素材 | 适合技术文章素材整理 |
| writing-beats | 将素材编成有逻辑推进的写作段落节点 | 适合架构复盘文章 |
| writing-shape | 把素材组织为逐段文章结构 | 与 fragments/beats 配合，属于开发中写作工作流 |

开发中表示上游目录标记，并非本次已验证所有功能可在 Codex/Windows 运行。

## 推荐用于这次改造的组合

```text
已有讨论 → to-spec → to-tickets → tdd + implement → code-review → handoff
出现未知根因 → diagnosing-bugs
需要核查 SDK 能力 → research
需要明确多租户边界 → grill-with-docs + domain-modeling
```

当前计划已根据既有讨论直接整理，不依赖运行 setup。首次使用需要工单配置的工程流程时，运行 setup-matt-pocock-skills；AgentHub 已有 OpenSpec，建议保留它作为契约来源，本地工单引用 OpenSpec，避免产生第二套冲突规格。

项目初始化尚未执行，原因是本次只要求安装和计划文档；setup 另涉及工单位置、标签和修改 CLAUDE.md 的选择。现有技能文件已完整安装，这不妨碍使用不依赖 tracker 的技能。

仅保存本地文档不等于授权向 GitHub/其他平台发布。调用 to-spec/to-tickets/triage 时应明确目标；对外发布仍以用户实际授权为准。

## 更新和验证

已核对 37 个技能的 100 个文本文件：安装器下载内容与固定提交的 Git 检出内容在归一化 CRLF/LF 换行后完全一致，无缺失文件。Windows Git 检出的换行与 GitHub 下载包不同，因此原始字节哈希不同；并非技能内容改变。这项检查验证文件完整性，不代表全部技能的宿主行为均已运行测试。

更新时先获取新的提交，审阅差异并备份本地定制，再按明确范围替换；自带安装器遇到同名目录会拒绝覆盖。

来源采用本地固定提交的各 SKILL.md 和 `.claude-plugin/plugin.json`。可在 `E:\Work\Codex\mattpocock-skills-review` 查阅对应版本。
