import { expect, it } from 'vitest'
import { useAppStore } from './app-store'

it('replaces stale state and pending approvals when calibrating after reconnect', () => {
  useAppStore.getState().applyEvent({ type: 'run.start', conversationId: 'deleted', runId: 'old-run', agentId: 'agent', triggerMessageId: 'trigger', timestamp: 1 })
  useAppStore.getState().applySnapshot({ type: 'snapshot', cursor: 100, conversations: [], agents: [], messages: [], artifacts: [], runs: [], pendingWrites: {}, pendingBashCommands: {}, pendingQuestions: {}, pendingPlans: {} })
  expect(useAppStore.getState().runsByConv).toEqual({})
  expect(useAppStore.getState().messages).toEqual({})
  expect(useAppStore.getState().pendingWritesByConv).toEqual({})
})
