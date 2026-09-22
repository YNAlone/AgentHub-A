import { db, schema, sqlite } from '@/db/client'
import { eq } from 'drizzle-orm'
import type { StreamSnapshot } from '@/shared/stream-snapshot'
import type { StreamEvent } from '@/shared/types'
import { eventBus } from './event-bus'
import { publicAgent } from './public-credentials'
import { pendingWrites } from './pending-writes'
import { pendingBashCommands } from './pending-bash-commands'
import { pendingQuestions } from './pending-questions'
import { pendingDispatchPlans } from './pending-dispatch-plans'
import { PersonalUiState } from '@/shared/personal-ui-state'
import './personal-settings'

/** Synchronous snapshot and cursor acquisition cannot interleave with event publication. */
export function streamSnapshot(): StreamSnapshot {
  return sqlite.transaction(() => {
    const uiRow = sqlite.prepare("SELECT value FROM personal_settings WHERE id = 'ui'").get() as { value: string } | undefined
    const uiState = PersonalUiState.safeParse(uiRow ? JSON.parse(uiRow.value) : null)
    const rows = db.select({ conversation: schema.conversations, workspace: schema.workspaces }).from(schema.conversations)
      .leftJoin(schema.workspaces, eq(schema.conversations.id, schema.workspaces.conversationId)).all()
    const conversations = rows.map(({ conversation, workspace }) => ({ ...conversation, workspaceMode: workspace?.mode ?? 'sandbox' as const, workspaceBoundPath: workspace?.boundPath ?? null }))
    return {
      type: 'snapshot' as const, cursor: eventBus.journal.cursor(), conversations,
      uiState: uiState.success ? uiState.data : undefined,
      dispatchEvents: (sqlite.prepare('SELECT event FROM dispatch_events ORDER BY id').all() as { event: string }[]).map((row) => JSON.parse(row.event) as StreamEvent),
      agents: db.select().from(schema.agents).all().map(publicAgent),
      messages: db.select().from(schema.messages).all(),
      artifacts: db.select().from(schema.artifacts).all(),
      runs: db.select().from(schema.agentRuns).all(),
      pendingWrites: Object.fromEntries(conversations.map((c) => [c.id, pendingWrites.listByConversation(c.id)])),
      pendingBashCommands: Object.fromEntries(conversations.map((c) => [c.id, pendingBashCommands.listByConversation(c.id)])),
      pendingQuestions: Object.fromEntries(conversations.map((c) => [c.id, pendingQuestions.listByConversation(c.id)])),
      pendingPlans: Object.fromEntries(conversations.map((c) => [c.id, pendingDispatchPlans.listByConversation(c.id)])),
    }
  })()
}
