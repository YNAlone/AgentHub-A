## ADDED Requirements

### Requirement: Custom tool loop SHALL recheck complete request budget
Before every Chat Completions request, including continuations after tool calls, CustomAgentAdapter MUST check the assembled messages and tools against the effective input budget and MUST send an explicit output cap equal to the reserved amount.

#### Scenario: Tool result pushes a continuation over budget
- **WHEN** an executed tool produces a result larger than the remaining budget
- **THEN** the result remains recorded and the adapter fails visibly before another model call, without re-executing the tool.

#### Scenario: Model response reaches its output cap
- **WHEN** the provider reports a length-limited response
- **THEN** the adapter reports an incomplete response and does not treat it as a successful final answer.
