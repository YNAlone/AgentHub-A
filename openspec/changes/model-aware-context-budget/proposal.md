## Why

AgentHub estimates every four characters as one token, reserves a fixed 4096 output tokens and 512 safety tokens, and budgets only the first custom-agent request. Chinese text, tool schemas, attachments, and later tool results can therefore exceed the provider's real window, while current DeepSeek model entries hide its documented 1M window.

## What Changes

- Record verified model windows and explicit output limits, including supported DeepSeek 1M models; keep unknown model limits conservative.
- Budget each complete custom-agent request, including history, system instructions, tools, attachments, and every tool-loop continuation. Send an output cap that matches the reserved amount.
- Use a conservative UTF-8 fallback where a tokenizer is unavailable, with a documented reserve and measured usage for future calibration. Preserve SDK-owned context management for Claude Code and Codex.
- Trigger compaction from projected request size and make large compaction batches token-bounded. Surface failures instead of silently dropping pinned context or tool evidence.
- Show effective per-agent context information and expose reasonable input/output controls with validation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conversation-context`: Complete-request budgeting, verified model windows, explicit output reserve, fallback estimation, and proactive compaction.
- `adapters`: Custom Chat Completions requests enforce the budget and output limit on every tool turn.
- `frontend`: Context settings and usage displays reflect effective model limits and actual request measurements.

## Impact

The model registry, conversation context builder, compaction service, custom adapter, AgentRunner, personal settings, usage UI, related tests, and detailed context specs change. No new package or database table is required; existing JSON personal settings can carry user limits.
