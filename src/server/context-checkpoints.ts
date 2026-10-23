import { createHash } from 'node:crypto'
import { sqlite } from '@/db/client'
import type { WorkingMessage, ContextProgress } from './working-context'

export interface ContextCheckpoint {
  messages: WorkingMessage[]; currentUserIndex: number; turn: number; providerRecoveries: number;
  usage: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; lastInputTokens: number };
  pendingTool?: string; sdkSessionId?: string; completed?: boolean; progress?: ContextProgress;
  phase?: 'planning' | 'execution' | 'aggregation';
  source?: { conversationId: string; triggerMessageId: string; runId: string };
  protectedMessageKeys?: string[];
  sdkTurnInProgress?: boolean;
}

export function contextStage(prompt: string, systemPrompt: string, tools: string[]): string {
  return createHash('sha256').update(JSON.stringify([prompt, systemPrompt, tools])).digest('hex')
}
export function readCheckpoint(runId: string, stage: string): { revision: number; checkpoint: ContextCheckpoint } | null {
  const row = sqlite.prepare('SELECT revision,value FROM run_context_checkpoints WHERE run_id=? AND stage=?').get(runId, stage) as { revision: number; value: string } | undefined
  return row ? { revision: row.revision, checkpoint: JSON.parse(row.value) } : null
}
export function writeCheckpoint(runId: string, stage: string, revision: number, checkpoint: ContextCheckpoint): number {
  if (revision === 0) {
    const result = sqlite.prepare('INSERT OR IGNORE INTO run_context_checkpoints(run_id,stage,revision,value,updated_at) VALUES (?,?,1,?,?)').run(runId, stage, JSON.stringify(checkpoint), Date.now())
    if (result.changes) return 1
  } else {
    const result = sqlite.prepare('UPDATE run_context_checkpoints SET value=?,revision=revision+1,updated_at=? WHERE run_id=? AND stage=? AND revision=?').run(JSON.stringify(checkpoint), Date.now(), runId, stage, revision)
    if (result.changes) return revision + 1
  }
  throw new Error('上下文检查点版本已改变，请重新加载。')
}
export function readJournal<T>(runId: string, step: string): T | null {
  const row = sqlite.prepare('SELECT value FROM run_workflow_journal WHERE run_id=? AND step=?').get(runId, step) as { value: string } | undefined
  return row ? JSON.parse(row.value) as T : null
}
export function writeJournal(runId: string, step: string, value: unknown): void {
  sqlite.prepare('INSERT INTO run_workflow_journal(run_id,step,value) VALUES (?,?,?) ON CONFLICT(run_id,step) DO UPDATE SET value=excluded.value').run(runId, step, JSON.stringify(value))
}
