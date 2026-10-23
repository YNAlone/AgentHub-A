## ADDED Requirements
### Requirement: All Agents SHALL receive shared web tools
Real adapters SHALL expose web_search and web_fetch in ordinary, planning and aggregation runs without rewriting saved tool lists.
#### Scenario: Existing Custom agent has no tools
- **WHEN** it runs
- **THEN** both shared web tools are included.
### Requirement: Web tools SHALL return bounded public evidence
Tools SHALL validate input, reject private extraction URLs, support cancellation, bound provider response size and mark returned text untrusted.
#### Scenario: Missing credential
- **WHEN** no stored or environment key exists
- **THEN** tools return a configuration error without pretending to search.
### Requirement: Settings SHALL protect credentials
Settings SHALL expose only configuration status and support save, preserve and clear.
#### Scenario: Browser reads settings
- **WHEN** settings are requested
- **THEN** no API key is returned.

