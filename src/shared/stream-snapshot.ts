import type { AgentRow, AgentRunRow, ArtifactRow, ConversationWithMeta, MessageRow } from '@/db/schema'
import type { PendingBashCommand, PendingDispatchPlan, PendingQuestion, PendingWrite, StreamEvent } from './types'
import type { PersonalUiStateValue } from './personal-ui-state'

/** Snapshot replaces entity maps at a single event cursor rather than appending partial state. */
export interface StreamSnapshot {
  type: 'snapshot'
  cursor: number
  uiState?: PersonalUiStateValue
  dispatchEvents?: StreamEvent[]
  conversations: ConversationWithMeta[]
  agents: AgentRow[]
  messages: MessageRow[]
  artifacts: ArtifactRow[]
  runs: AgentRunRow[]
  pendingWrites: Record<string, PendingWrite[]>
  pendingBashCommands: Record<string, PendingBashCommand[]>
  pendingQuestions: Record<string, PendingQuestion[]>
  pendingPlans: Record<string, PendingDispatchPlan[]>
}
