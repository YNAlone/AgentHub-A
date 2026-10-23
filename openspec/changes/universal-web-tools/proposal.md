## Why
Search availability currently depends on the adapter. Users authorized shared web search and page reading for every Agent.
## What Changes
Add default web_search/web_fetch tools backed by Tavily, shared settings with masked credentials, SDK MCP exposure and guarded public URLs. No new dependencies.
## Capabilities
### New Capabilities
- `web-tools`: shared search, extraction and credential configuration.
## Impact
Tool registry, runner, SDK bridges, settings UI and tests. No existing Agent records are rewritten.
