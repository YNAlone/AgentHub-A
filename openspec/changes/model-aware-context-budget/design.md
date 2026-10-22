## Context

The current registry assumes 64K for DeepSeek V4, 4096 output tokens for most models, and `text.length / 4` for all inputs. AgentRunner omits tools and attachments from its initial history budget, while the custom adapter never checks the enlarged request after tool calls. The personal edition must preserve raw history and pinned context; SDK adapters own their internal session compaction.

## Goals / Non-Goals

**Goals:** Enforce a per-request hard budget for custom models; allow verified 1M DeepSeek models; keep output reservation identical to the transmitted `max_tokens`; use a conservative no-tokenizer fallback; make input/output limits configurable; retain complete history on budget failures.

**Non-Goals:** Promise exact token counts for arbitrary compatible endpoints, override Claude/Codex SDK internals, add paid tokenizer dependencies, expose provider secrets, or make the personal app a public server.

## Decisions

1. **Model profiles:** Exact model IDs determine verified windows. Current `deepseek-flash`, `deepseek-v4-pro`, and documented `deepseek-v4-flash` alias use 1,000,000; older names retain conservative limits. The default operational input cap is 128K estimated tokens, with user-selectable 256K, 512K, or 1M, always clamped by the real model window. Default output caps remain profile-specific: DeepSeek V4 thinking reserves 64K, other custom models reserve their profile value, and explicit user limits clamp output. A 1M configuration does not change another agent's profile.
2. **Fallback counting and calibration:** Until an appropriate tokenizer is available, each UTF-8 byte of serialized textual request material counts as one cold-start estimated token. A guard of `min(max(8192, ceil(0.05 * window)), floor((window - outputCap) * 0.25))` remains in force. Numeric estimates and provider usage are recorded per model and endpoint fingerprint, split between ordinary and tool-result requests. Only after 30 samples including five requests of at least 4096 bytes in that class may a factor of `min(1, max(0.2, 1.25 * worstObservedRatio))` replace the byte count; samples expire after seven days. Multimodal requests never train text calibration. This statistical rule is not a formal bound for arbitrary provider tokenizers; image data may still be rejected conservatively.
3. **Single budget module:** A pure shared module creates `ContextBudget` from model profile and user settings, estimates Chat Completions messages and tools, and rejects requests when estimated input exceeds `min(userInputCap, window - outputCap - guard)`. AgentRunner uses it to budget history and check isolated child prompts. The custom adapter checks the actual assembled request before every call; it sends the same output cap as `max_tokens`.
4. **Compaction:** History construction keeps full source messages and fixed context. Automatic compaction aims at the hard request budget; it can start earlier when projected next-request growth approaches the limit, but must not turn an arbitrary 75% history quota into a second hard limit. Compaction batches use the auxiliary model's token budget, not only a character ceiling; failures remain visible.
5. **UI:** Settings explain the operational input ceiling, output cap, model hard window, and safety reserve. Usage display uses the active/last agent where possible and distinguishes measured API input from estimated capacity.

DeepSeek profile values come from its [model table](https://api-docs.deepseek.com/quick_start/pricing/) and [Chat Completions parameter reference](https://api-docs.deepseek.com/api/create-chat-completion/). Its [token usage guide](https://api-docs.deepseek.com/quick_start/token_usage/) identifies returned usage as the authoritative count; the fallback and calibration thresholds above are AgentHub operational policies, not provider guarantees.

## Risks / Trade-offs

- [UTF-8 fallback underutilizes a 1M model] → Make the cap explicit, show measured API usage, and relax only after separate ordinary/tool samples meet the calibration threshold.
- [Provider silently changes tokenizer behind a model ID] → Expire calibration after seven days and retain the 5% window guard; provider rejections remain visible and do not discard source history.
- [An unknown compatible model has a smaller true window] → Keep its provider fallback conservative and never infer 1M from a name substring.
- [A tool side effect precedes a budget overflow] → Record the tool result, fail visibly, and do not silently replay tools.
- [Large request counting repeats work] → Count only at model request boundaries and cache stable request segments where useful; measure end-to-end latency with representative fixtures.

## Migration Plan

Existing personal settings acquire defaults through the current Zod JSON schema. Numeric calibration rows use additional IDs in the existing `personal_settings` table, so no database schema migration is needed. Existing conversations and summaries remain untouched. A user can restore the previous operational ceiling through settings, while model hard limits remain provider-verified.

## Open Questions

Provider-specific tokenizer integration and paid-model long-context validation remain separate. Sample-based fallback relaxation is implemented but must not be presented as an exact tokenizer or guaranteed maximum request size.
