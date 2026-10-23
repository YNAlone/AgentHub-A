import { it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Opt-in live verification uses a disposable database and never changes configured Agents or conversations.
async function main() {
  if (process.env.AGENTHUB_LIVE_CONTEXT_TEST !== '1') throw new Error('Set AGENTHUB_LIVE_CONTEXT_TEST=1 to authorize live model requests.')
  process.env.AGENTHUB_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'agenthub-context-live-'))
  const { CodexAdapter } = await import('@/server/adapters/codex-adapter')
  const { ClaudeCodeAdapter } = await import('@/server/adapters/claude-code-adapter')
  const { sdkWorkingContext } = await import('@/server/adapters/sdk-working-context')
  const { summarizeWithSdk } = await import('@/server/adapters/sdk-summary')
  const { codexSessions, claudeCodeSessions } = await import('@/server/adapters/session-store')
  const { db, schema } = await import('@/db/client')
  const { createConversation } = await import('@/server/conversation-service')
  const { eq } = await import('drizzle-orm')
  const adapterName = process.env.AGENTHUB_LIVE_ADAPTER === 'claude-code' ? 'claude-code' : 'codex'
  const model = process.env.AGENTHUB_LIVE_MODEL ?? (adapterName === 'codex' ? 'gpt-5.4' : 'claude-sonnet-4-6')
  const endpoint = adapterName === 'codex' ? process.env.OPENAI_BASE_URL ?? null : process.env.ANTHROPIC_BASE_URL ?? null
  const agent = db.select().from(schema.agents).all()[0]
  db.update(schema.agents).set({ adapterName, isOrchestrator: false }).where(eq(schema.agents.id, agent.id)).run()
  const conversation = await createConversation({ mode: 'single', agentIds: [agent.id] })
  const workspace = db.select().from(schema.workspaces).where(eq(schema.workspaces.conversationId, conversation.id)).get()!
  const adapter = adapterName === 'codex' ? new CodexAdapter() : new ClaudeCodeAdapter()
  const sessions = adapterName === 'codex' ? codexSessions : claudeCodeSessions
  const key = `${conversation.id}:${agent.id}`
  const input: import('@/server/adapters/types').AdapterInput = {
    agentId: agent.id, conversationId: conversation.id, runId: 'live-smoke', prompt: 'Reply READY only. Do not use any tools.',
    systemPrompt: 'This is an integration test. Never use tools, read files, or change files. Reply briefly.',
    workspacePath: workspace.rootPath, apiKey: adapterName === 'codex' ? process.env.OPENAI_API_KEY ?? null : process.env.ANTHROPIC_API_KEY ?? null,
    apiBaseUrl: endpoint, modelId: model, toolNames: [],
  }
  const signal = AbortSignal.timeout(180_000)
  let text = ''
  for await (const event of adapter.stream(input, signal)) {
    if (event.type === 'part.delta' && event.delta.type === 'text.append') text += event.delta.text
    if (event.type === 'part.start' && event.part.type === 'text') text += event.part.content
  }
  const oldSession = sessions.get(key)
  if (!oldSession || !text.trim()) throw new Error('Initial real SDK session produced no response or handle.')
  console.log(JSON.stringify({ adapter: adapterName, stage: 'initial-session', ok: true }))
  let checkpoint: import('@/server/context-checkpoints').ContextCheckpoint | null = null
  let summaries = 0
  const OpenAI = (await import('openai')).default
  const compactInput = { ...input, runId: 'live-compaction', prompt: 'What source URL was retained? Reply briefly. Do not use tools.',
    history: [{ role: 'user' as const, content: ('Completed research. Source https://example.com/evidence . No pending tools.\n').repeat(160) }],
    contextBudget: { contextWindow: 64000, maxInputTokens: 3000, maxOutputTokens: 1024, safetyTokens: 1280, plainFactor: 1, toolFactor: 1 },
    contextControl: { restored: null, save: (value: import('@/server/context-checkpoints').ContextCheckpoint) => { checkpoint = structuredClone(value) },
      progress: (value: import('@/server/working-context').ContextProgress) => console.log(JSON.stringify({ adapter: adapterName, ...value })),
      summarize: async (source: string, summarySignal: AbortSignal) => {
        summaries++
        if (adapterName === 'codex') {
          const client = new OpenAI({ apiKey: input.apiKey!, baseURL: endpoint ?? undefined, maxRetries: 0 })
          const result = await client.responses.create({ model, instructions: 'Summarize in under 60 words, retaining source URLs and completed actions.', input: source }, { signal: summarySignal })
          if (result.status !== 'completed') throw new Error('Incomplete summary')
          return result.output_text
        }
        if (input.apiKey) {
          const Anthropic = (await import('@anthropic-ai/sdk')).default
          const client = new Anthropic({ apiKey: endpoint ? null : input.apiKey, authToken: endpoint ? input.apiKey : undefined, baseURL: endpoint ?? undefined, maxRetries: 0 })
          const result = await client.messages.create({ model, max_tokens: 1600, system: 'Summarize in under 60 words, retaining source URLs and completed actions.', messages: [{ role: 'user', content: source }] }, { signal: summarySignal })
          if (result.stop_reason === 'max_tokens') throw new Error('Incomplete summary')
          return result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
        }
        return (await summarizeWithSdk(adapterName, model, endpoint, source, 'Summarize in under 60 words, retaining source URLs and completed actions. Do not use tools.', summarySignal)).text
      },
    },
  }
  for await (const event of sdkWorkingContext(adapter, compactInput, signal)) void event
  if (summaries < 1 || !checkpoint || sessions.get(key) === oldSession) throw new Error('SDK did not rebuild its old session after compaction.')
  console.log(JSON.stringify({ adapter: adapterName, stage: 'compaction-rebuild', summaries, ok: true }))
}

it.skipIf(process.env.AGENTHUB_LIVE_CONTEXT_TEST !== '1')('rebuilds a real SDK session after context compaction', main, 240_000)
