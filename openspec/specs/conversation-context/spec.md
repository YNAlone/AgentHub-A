# Conversation Context

> 本机个人版当前契约见 [Spec 16](../../../specs/16-local-personal.md)。本期认证、项目/记忆、SDK/任务恢复、上下文预算和 SSE 恢复覆盖旧契约；远程伴随暂停。

## Purpose

Defines cross-run history serialization, pinned message injection, and context compaction. Detailed context rules live in `specs/13-conversation-context.md`.

## Requirements

### Requirement: Custom agents SHALL receive bounded chat history

CustomAgentAdapter runs MUST receive serialized conversation history within a model-aware complete-request token budget for ordinary user turns. The budget MUST include system instructions, current input, tool schemas, attachments, pinned messages, summaries, output reservation, and an estimator guard. The transmitted output limit MUST equal the reserved output amount.

#### Scenario: Conversation has long history
- **WHEN** AgentRunner builds adapter input
- **THEN** it compacts or rejects history before the complete request exceeds the effective model input ceiling.

#### Scenario: A verified DeepSeek model supports 1M
- **WHEN** a custom agent uses an exact 1M model profile and the user selects a higher operational input limit
- **THEN** the effective limit can rise toward 1M while preserving output and estimator reserves.

#### Scenario: A child prompt is isolated
- **WHEN** an orchestrator child receives an override prompt
- **THEN** generic history is omitted and the isolated prompt still receives a complete-request budget check.

### Requirement: Fallback estimation SHALL expose its uncertainty
When no trusted tokenizer is available, AgentHub MUST estimate serialized textual request material conservatively, reserve an explicit uncertainty margin, and distinguish estimates from provider-reported token usage.

#### Scenario: Chinese or tool JSON increases request size
- **WHEN** input contains multilingual text or tool JSON
- **THEN** the budget uses the complete serialized content rather than dividing JavaScript string length by four.

#### Scenario: A model has enough usage observations
- **WHEN** the same request class has at least 30 samples including five long requests within seven days
- **THEN** AgentHub MAY use the highest observed usage-to-byte ratio with a 25% uplift while retaining the window guard; unsampled and multimodal requests remain conservatively estimated.

### Requirement: Context settings SHALL not override model limits
User input and output controls MUST be clamped by exact model capability; unknown model IDs MUST NOT inherit an unverified 1M window.

#### Scenario: User selects a 1M operational cap for a smaller model
- **WHEN** the selected model has a verified window below 1M
- **THEN** the effective request cap stays below the verified window after output and guard reserves.

### Requirement: SDK agents SHALL use session resume plus summaries

Claude Code and Codex adapters SHALL rely on SDK session continuation and may receive AgentHub context summaries prefixed to new user prompts.

#### Scenario: Codex session continues
- **WHEN** a conversation already has a cached Codex thread id
- **THEN** CodexAdapter resumes the thread instead of replaying full chat history.

### Requirement: Pinned messages SHALL be preserved in context

Pinned messages MUST remain available to context construction even when older unpinned history is summarized or trimmed.

#### Scenario: User pins a message
- **WHEN** context is built after compaction
- **THEN** the pinned message is represented separately from the summary.

### Requirement: Sub-agent prompts SHALL not duplicate global history

Orchestrator-dispatched child runs MUST use their isolated task prompt and skip generic conversation history injection.

#### Scenario: Orchestrator dispatches a child task
- **WHEN** `overridePrompt` is set
- **THEN** AgentRunner does not call `buildHistoryFor` for that child run.

### Requirement: Context compaction SHALL clear SDK sessions

Compacting conversation history MUST clear SDK session caches whose internal state no longer matches the database history.

#### Scenario: Conversation is compacted
- **WHEN** compaction writes a new summary covering old messages while retaining their source rows
- **THEN** Claude Code and Codex session ids for that conversation are cleared.
