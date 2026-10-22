## ADDED Requirements

### Requirement: Context controls SHALL explain effective limits
The personal context settings MUST allow a bounded operational input limit and output cap, and the usage interface MUST distinguish a model hard window from actual recent input usage.

#### Scenario: User configures a 1M input ceiling
- **WHEN** the user saves a 1M operational limit
- **THEN** the UI explains that the actual allowance still subtracts output and guard reserves and is limited by the chosen model.
