## 1. Model profiles and budgeting

- [x] 1.1 Update verified model profiles and explicit output defaults; cover unknown-model behavior with unit tests.
- [x] 1.2 Add a pure complete-request estimator and budget calculator, including UTF-8 fallback, guard, tools, and multimodal handling; test boundary cases.

## 2. Runtime enforcement

- [x] 2.1 Apply the same budget to ordinary history and isolated child prompts before dispatch.
- [x] 2.2 Recheck every custom tool-loop request and send an explicit `max_tokens`; report output truncation and tool-result overflow without replay.
- [x] 2.3 Make automatic compaction use the hard history budget and bound auxiliary input by estimated tokens; test failures and preservation.

## 3. Controls and documentation

- [x] 3.1 Add validated operational input/output settings and describe their model-aware behavior in the context UI.
- [x] 3.2 Correct usage display semantics for multi-agent conversations and measured versus estimated input.
- [x] 3.3 Synchronize detailed specs and development change log with the final behavior.

## 4. Validation

- [x] 4.1 Run focused tests, typecheck, lint, and any relevant build checks; record evidence and remaining limitations.
