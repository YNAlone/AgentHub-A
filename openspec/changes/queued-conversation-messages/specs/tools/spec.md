## ADDED Requirements
### Requirement: Messages SHALL queue while a conversation is busy
The server MUST persist new messages in FIFO order and MUST NOT dispatch them while an earlier conversation run is queued, running, compacting, paused or interrupted. The composer MUST remain editable and allow enqueueing. Queued messages MUST NOT enter model history until dispatched. Claims and recovery run IDs MUST be atomic; retries with the same client message ID MUST NOT create duplicate messages or runs.
#### Scenario: Send during a response
- **WHEN** a user sends another message while an Agent is responding
- **THEN** it appears as queued and starts after the prior work terminates
#### Scenario: Restart or paused run
- **WHEN** a conversation has a paused/interrupted run or the service restarts
- **THEN** queued messages remain stored and await recovery/cancellation of prior work
