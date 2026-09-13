# Local personal reliability — approved 2026-09-13

This change supersedes prior LAN companion and raw credential response behavior.

## Accepted scope

- Local personal use only; bind loopback. Electron authenticates through a controlled bootstrap; browsers pair using a local secret. Deny anonymous business APIs, streams and private deployments. Disable mobile routes this release.
- Never expose provider credentials in response DTOs. Empty edits preserve existing secrets; explicit clearing remains available.
- Projects own multiple conversations and project memories. Existing bound directories produce suggestions requiring confirmation; no automatic file movement.
- Persist per-conversation, per-agent SDK associations. Restore context after restart; interrupted runs require explicit continuation and side-effect verification. Pending approvals never become approved after restart.
- Enable automatic context compaction; preserve original history, explicit constraints, remaining goals and recent turns. Failed compaction does not advance coverage. Budget includes pinned content and summaries.
- Reconnect SSE with snapshot reconciliation, monotonic event cursors and deduplication. Expired cursors fall back to snapshots.
- Memories have personal/project scope, sources and active/pending/expired/deleted state. Only explicit preferences and confirmed decisions may automatically activate; inferred material requires confirmation. Deletion prevents regeneration from the same source and invalidates future SDK context.
- Background memory generation is incremental, bounded, cancellable and configurable. Use existing model configuration with usage accounting.

## Accepted test boundaries

HTTP authentication/response DTOs, project/session services, context construction/compaction, event reconnection, memory CRUD/retrieval. Use temporary SQLite and fake model responses, never real credentials.

## Delivery

All changes, migrations, evidence and checks are recorded in docs/development-change-log.md. One scoped implementation commit per work package, with separate spec commits. Preserve existing user edits.
