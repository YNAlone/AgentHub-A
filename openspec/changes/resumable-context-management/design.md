# Design
Capacity identity includes adapter/provider/endpoint/model. User override wins over registry; old input cap becomes migration metadata. Output reserve defaults to 8192, safety to 2%. Estimates use language-aware counting and observed usage deltas, never raw bytes as token counts.

Application-owned context sessions persist messages at safe request boundaries, revision, stage identity, retry state and usage. Summaries are hierarchical, bounded, preserve latest user/system constraints and source references. Completed tool groups may be replaced together; unfinished groups cannot be summarized. Compaction failure pauses with an abortable wait; durable checkpoints allow restart. Never replay uncertain side effects.

Adapters call application callbacks, never write checkpoints directly. SDK session rebuild must invalidate the old resume ID and carry public evidence. SDK internal boundaries may differ from Custom per-request boundaries and require real verification before deployment.
