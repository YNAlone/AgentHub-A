# Conversation Context

## Purpose

Defines complete-request capacity, non-destructive compaction and same-run continuation. Detailed contracts: specs/16-local-personal.md §4 and specs/13-conversation-context.md.

## Requirements

### Requirement: Capacity SHALL be scoped to effective model identity
Capacity SHALL be keyed by adapter, provider, normalized effective endpoint and model ID. Explicit overrides take precedence over built-in profiles. Output reservation and a 2% safety margin SHALL be deducted from total capacity. Legacy input caps SHALL remain migration metadata, not execution gates.

#### Scenario: Confirmed 1M model
- **WHEN** the confirmed DeepSeek V4 Flash identity is selected
- **THEN** its total window is 1,000,000 tokens and unrelated endpoints/models do not inherit the override.

### Requirement: Estimates SHALL trigger compaction instead of failure
At 60% usable input by default, the application SHALL compact toward 35% or less. Estimates SHALL distinguish multilingual text and JSON structure, use recent provider usage plus new content when available, and be labelled estimates.

#### Scenario: Five large search results follow one request
- **WHEN** completed tool results exceed the trigger threshold
- **THEN** the next model request uses a summary without replaying searches or discarding original results.

### Requirement: Compaction SHALL preserve constraints and protocol integrity
System instructions, the latest request, pinned messages and pending tool-call structure SHALL be retained. Source history and tool results SHALL remain durable. Large inputs SHALL be chunked and hierarchically summarized within the summary model capacity. Empty, incomplete or non-shrinking summaries SHALL NOT replace context.

#### Scenario: A small number of messages contains large evidence
- **WHEN** fewer than six messages exceed the threshold
- **THEN** completed evidence remains eligible for compaction; no six-message floor applies.

### Requirement: Exhausted summary retries SHALL pause durably
The initial attempt SHALL be followed by two retries after 2 and 5 seconds. Exhaustion SHALL persist a paused run with versioned context and workflow checkpoints. Resume SHALL retain the original run ID and be idempotent. Unknown side effects SHALL require verification, never blind replay.

#### Scenario: Restart and resume
- **WHEN** a paused task is resumed after application restart
- **THEN** completed stages and tools are reused and dependent tasks remain blocked until their prerequisites complete.

### Requirement: Provider overflow SHALL receive bounded recovery
Explicit context overflow SHALL force compaction and retry the model request at most twice. Authentication and rate-limit errors SHALL retain their original semantics. Persistent overflow or uncompressible protected content SHALL pause with an actionable reason.

### Requirement: SDK context SHALL match application summaries
Claude and Codex SHALL use native compaction and observable safe boundaries. Application compaction SHALL invalidate old handles before rebuilding with retained context and completed-operation records. Tools SHALL NOT be interrupted to compact. OAuth-only summary requests SHALL use the same SDK rather than an unrelated provider.

#### Scenario: Compaction after a completed SDK turn fails
- **WHEN** the user resumes after fixing summary access
- **THEN** only compaction is retried; the completed SDK turn is not executed again.

### Requirement: Child runs SHALL retain isolated prompts
Orchestrator child runs SHALL not receive duplicated generic conversation history. Stage prompts, outputs and tool evidence SHALL remain stable across pause/resume.
