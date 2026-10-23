## ADDED Requirements
### Requirement: Context overflow SHALL compact and resume
Runs SHALL compact at 60% of usable input capacity toward 35%, retaining originals. Summary failure SHALL retry twice then pause durably.
#### Scenario: Large search results in one run
- **WHEN** completed tool results exceed the trigger
- **THEN** compact before the next model request and continue without rerunning tools.
### Requirement: Paused runs SHALL resume idempotently
Resume SHALL retain run identity and completed operations across restart.
#### Scenario: Repeated resume clicks
- **WHEN** a paused run is resumed twice
- **THEN** only one continuation executes.
