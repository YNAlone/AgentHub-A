## Context
Custom lacks search; SDK native tool behavior differs.
## Decisions
Use Tavily Search and Extract APIs at a fixed HTTPS origin. All real adapters receive shared tools including planning and aggregation. Browser settings store a separate credential record in existing personal_settings; GET returns only configured/source flags. Empty preserves, null removes stored key; TAVILY_API_KEY is fallback. Never include provider response/error bodies or keys in tool errors. Model-supplied URLs must be public HTTP(S), with no credentials or nonstandard ports; reject private/special addresses and DNS results before provider extraction. AgentHub never directly connects to those targets. Provider handles HTML extraction; this is not a browser or authenticated crawler. Results are bounded untrusted evidence, with URLs and retrieval timestamps.
## Risks
Search/extraction use third-party metered APIs; users must provide a key. Provider-side redirects are handled by Tavily; this does not grant local-network access. Native SDK tools remain separate; guidance prefers shared tools.
## Validation
Mock provider HTTP, verify error redaction, cancellation, bounded results, URL policy, credentials and all adapter surfaces. No paid live calls without user-provided credentials.
