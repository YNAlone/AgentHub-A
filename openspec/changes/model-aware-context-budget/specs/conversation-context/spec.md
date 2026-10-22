## MODIFIED Requirements

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

## ADDED Requirements

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
