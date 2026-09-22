import { getPersonalSettings, recordAuxiliaryUsage } from './personal-settings'
import Anthropic from '@anthropic-ai/sdk'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import OpenAI from 'openai'

import { db, schema } from '@/db/client'
import type {
  AgentRow,
  ArtifactRow,
  ContextSummaryInsert,
  ContextSummaryRow,
  MessageInsert,
  MessageRow,
} from '@/db/schema'
import { clearClaudeCodeSession, clearCodexSession } from '@/server/adapters/session-store'
import { newContextSummaryId, newMessageId } from '@/server/ids'
import {
  getEffectiveAnthropicBaseUrl,
  getEffectiveApiKey,
} from '@/server/settings-service'
import { estimateTokens } from '@/shared/model-registry'
import type { DeployStatusRecord, MessagePart, ModelProvider } from '@/shared/types'

const RECENT_MESSAGES_TO_KEEP = 6
const MAX_COMPACTION_INPUT_CHARS = 60000
const SUMMARY_MAX_TOKENS = 1600

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_VOLCANO_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5'

export interface CompactConversationResult {
  summary: ContextSummaryRow
  message: MessageRow
}

interface SummaryModelChoice {
  provider: ModelProvider | null
  modelId: string | null
  summarize(prompt: string, signal?: AbortSignal, systemPrompt?: string): Promise<string>
}

interface RenderedCompactionInput {
  text: string
  includedMessages: MessageRow[]
}

export async function getLatestContextSummary(
  conversationId: string,
): Promise<ContextSummaryRow | null> {
  const row = await db.query.contextSummaries.findFirst({
    where: eq(schema.contextSummaries.conversationId, conversationId),
    orderBy: [desc(sql`rowid`)],
  })
  return row ?? null
}

export async function prefixPromptWithContextSummary(
  conversationId: string,
  prompt: string,
): Promise<string> {
  const latest = await getLatestContextSummary(conversationId)
  if (!latest) return prompt
  return [
    renderConversationSummaryBlock(latest),
    '',
    prompt,
  ].join('\n')
}

export function renderConversationSummaryBlock(summary: ContextSummaryRow): string {
  return [
    `<conversation_summary covered_until_message_id="${escapeAttr(summary.coveredUntilMessageId)}">`,
    summary.summary,
    '</conversation_summary>',
  ].join('\n')
}

async function compactConversationUnlocked(
  conversationId: string,
  signal?: AbortSignal,
): Promise<CompactConversationResult> {
  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversationId),
  })
  if (!conv) throw new Error(`Conversation not found: ${conversationId}`)

  const latest = await getLatestContextSummary(conversationId)
  const messages = await loadCompactableMessages(conversationId, latest)
  const pinnedIds = new Set(conv.pinnedMessageIds ?? [])
  const compactable = messages.filter((m) => !pinnedIds.has(m.id) && m.role !== 'system')
  const keepRecent = RECENT_MESSAGES_TO_KEEP
  const source = compactable.slice(
    0,
    Math.max(0, compactable.length - keepRecent),
  )

  if (source.length === 0) {
    throw new Error('No compactable history yet')
  }

  const rendered = await renderMessagesForCompaction(source, conv.agentIds)
  if (!rendered.text.trim() || rendered.includedMessages.length === 0) {
    throw new Error('No compactable text in selected history')
  }

  const coveredUntil = rendered.includedMessages[rendered.includedMessages.length - 1]
  const prompt = buildCompactionPrompt(latest, rendered.text)
  const choice = await chooseSummaryModel(conv.agentIds)
  const summaryText = normalizeSummary(await choice.summarize(prompt, signal))
  signal?.throwIfAborted()
  const now = Date.now()

  const summaryInsert: ContextSummaryInsert = {
    id: newContextSummaryId(),
    conversationId,
    summary: summaryText,
    coveredUntilMessageId: coveredUntil.id,
    coveredUntilCreatedAt: coveredUntil.createdAt,
    sourceMessageCount: rendered.includedMessages.length,
    tokenEstimate: estimateTokens(summaryText),
    modelProvider: choice.provider,
    modelId: choice.modelId,
    createdAt: now,
  }

  const systemMessageInsert: MessageInsert = {
    id: newMessageId(),
    conversationId,
    role: 'system',
    agentId: null,
    parts: [
      {
        type: 'text',
        content: `已压缩早期上下文，覆盖 ${rendered.includedMessages.length} 条消息。`,
      },
    ],
    status: 'complete',
    parentMessageId: null,
    mentionedAgentIds: [],
    runId: null,
    usage: null,
    createdAt: now,
  }
  // Coverage, its visible notice and session invalidation either all commit or all roll back.
  db.transaction((tx) => {
    const currentSummary = tx.select().from(schema.contextSummaries).where(eq(schema.contextSummaries.conversationId, conversationId)).orderBy(desc(sql`rowid`)).get()
    if ((currentSummary?.id ?? null) !== (latest?.id ?? null)) throw new Error('摘要来源版本已改变，请重试。')
    for (const sourceMessage of rendered.includedMessages) {
      const current = tx.select().from(schema.messages).where(eq(schema.messages.id, sourceMessage.id)).get()
      if (!current || current.status !== 'complete' || JSON.stringify(current.parts) !== JSON.stringify(sourceMessage.parts)) throw new Error('摘要来源已改变，结果未保存。')
    }
    tx.insert(schema.contextSummaries).values(summaryInsert).run()
    tx.insert(schema.messages).values(systemMessageInsert).run()
    tx.update(schema.conversations).set({ updatedAt: now }).where(eq(schema.conversations.id, conversationId)).run()
    clearClaudeCodeSession(conversationId)
    clearCodexSession(conversationId)
  })

  return {
    summary: summaryInsert as ContextSummaryRow,
    message: systemMessageInsert as MessageRow,
  }
}

async function loadCompactableMessages(
  conversationId: string,
  latest: ContextSummaryRow | null,
): Promise<MessageRow[]> {
  const where = latest
    ? and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.status, 'complete'),
        sql`messages.rowid > (SELECT rowid FROM messages WHERE id = ${latest.coveredUntilMessageId})`,
      )
    : and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.status, 'complete'),
      )
  return db
    .select()
    .from(schema.messages)
    .where(where)
    .orderBy(sql`messages.rowid`)
}

async function renderMessagesForCompaction(
  messages: MessageRow[],
  conversationAgentIds: string[],
): Promise<RenderedCompactionInput> {
  const agentIds = new Set<string>()
  for (const m of messages) {
    if (m.agentId) agentIds.add(m.agentId)
  }
  for (const id of conversationAgentIds) agentIds.add(id)

  const agents = agentIds.size
    ? await db.query.agents.findMany({
        where: inArray(schema.agents.id, [...agentIds]),
      })
    : []
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]))

  const artifactIds = collectArtifactIds(messages)
  const artifactTitles = await loadArtifactTitles(artifactIds)

  const chunks: string[] = []
  const includedMessages: MessageRow[] = []
  let totalChars = 0
  for (const m of messages) {
    const rendered = renderMessageForCompaction(m, agentNameById, artifactTitles)
    if (!rendered) continue
    const next = rendered // Never advance coverage past text omitted from the model input.
    if (totalChars + next.length > MAX_COMPACTION_INPUT_CHARS) break
    chunks.push(next)
    includedMessages.push(m)
    totalChars += next.length
  }
  return {
    text: chunks.join('\n\n'),
    includedMessages,
  }
}

function renderMessageForCompaction(
  message: MessageRow,
  agentNameById: Map<string, string>,
  artifactTitles: Map<string, string>,
): string | null {
  const from =
    message.role === 'user'
      ? 'user'
      : message.agentId
        ? (agentNameById.get(message.agentId) ?? message.agentId)
        : message.role
  const content = renderPublicParts(message.parts, artifactTitles)
  if (!content.trim()) return null
  return [
    `<message id="${escapeAttr(message.id)}" from="${escapeAttr(from)}" created_at="${message.createdAt}">`,
    content,
    '</message>',
  ].join('\n')
}

function renderPublicParts(
  parts: MessagePart[],
  artifactTitles: Map<string, string>,
): string {
  const out: string[] = []
  for (const part of parts) {
    switch (part.type) {
      case 'text':
        if (part.content) out.push(part.content)
        break
      case 'code':
        if (part.content) {
          out.push(['```' + part.language, part.content, '```'].join('\n'))
        }
        break
      case 'artifact_ref': {
        const title = artifactTitles.get(part.artifactId)
        out.push(
          title
            ? `[artifact: ${title} (id=${part.artifactId})]`
            : `[artifact id=${part.artifactId}]`,
        )
        break
      }
      case 'deploy_status':
        if (part.deployment.status === 'ready') {
          out.push(
            `[deployment: ${part.deployment.title} ${formatDeploymentSourceLabel(part.deployment)} (${part.deployment.previewPath})]`,
          )
        } else {
          out.push(`[deployment failed: ${part.deployment.title} (${part.deployment.error ?? 'unknown error'})]`)
        }
        break
      case 'image_attachment':
        out.push(`[image attachment: ${part.fileName}, id=${part.attachmentId}]`)
        break
      case 'file_attachment':
        out.push(`[file attachment: ${part.fileName}, id=${part.attachmentId}]`)
        break
      case 'tool_use':
        out.push(`[历史工具调用 ${part.callId}: ${part.toolName} ${JSON.stringify(part.args)}]`)
        break
      case 'tool_result':
        out.push(`[历史工具结果 ${part.callId}, error=${!!part.isError}: ${JSON.stringify(part.result)}]`)
        break
      default:
        break
    }
  }
  return out.join('\n').trim()
}

function formatDeploymentSourceLabel(deployment: DeployStatusRecord): string {
  if (deployment.sourceType === 'workspace') {
    return `workspace=${deployment.workspacePath ?? 'unknown'}`
  }
  return `v${deployment.version}`
}

function collectArtifactIds(messages: MessageRow[]): string[] {
  const ids = new Set<string>()
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type === 'artifact_ref') ids.add(part.artifactId)
    }
  }
  return [...ids]
}

async function loadArtifactTitles(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const rows = await db
    .select({ id: schema.artifacts.id, title: schema.artifacts.title })
    .from(schema.artifacts)
    .where(inArray(schema.artifacts.id, ids))
  for (const row of rows as Pick<ArtifactRow, 'id' | 'title'>[]) {
    out.set(row.id, row.title)
  }
  return out
}

function buildCompactionPrompt(latest: ContextSummaryRow | null, renderedMessages: string): string {
  return [
    latest
      ? [
          '<previous_summary>',
          latest.summary,
          '</previous_summary>',
          '',
        ].join('\n')
      : '',
    '<messages_to_compact>',
    renderedMessages,
    '</messages_to_compact>',
  ].join('\n')
}

async function chooseSummaryModel(agentIds: string[]): Promise<SummaryModelChoice> {
  const selected = getPersonalSettings().auxiliaryAgentId
  if (selected) agentIds = [selected]
  const agents =
    agentIds.length > 0
      ? await db.query.agents.findMany({ where: inArray(schema.agents.id, agentIds) })
      : []

  for (const agent of agents) {
    const choice = await choiceFromCustomAgent(agent)
    if (choice) return choice
  }

  if (selected) throw new Error('所选辅助 Agent 没有可用的模型凭证；请调整配置后重试。')
  const anthropicKey = await getEffectiveApiKey('anthropic')
  if (anthropicKey) {
    const claudeAgent = agents.find((a) => a.adapterName === 'claude-code')
    return buildAnthropicChoice(
      anthropicKey,
      await getEffectiveAnthropicBaseUrl(),
      claudeAgent?.modelId ?? DEFAULT_CLAUDE_MODEL,
    )
  }

  throw new Error('没有可用的摘要模型；保留全部历史，请配置摘要模型后重试。')
}

async function choiceFromCustomAgent(agent: AgentRow): Promise<SummaryModelChoice | null> {
  if (agent.adapterName === 'claude-code') {
    const key = agent.apiKey ?? await getEffectiveApiKey('anthropic')
    return key ? buildAnthropicChoice(key, agent.apiBaseUrl ?? await getEffectiveAnthropicBaseUrl(), agent.modelId ?? DEFAULT_CLAUDE_MODEL) : null
  }
  if (agent.adapterName === 'codex') {
    const key = agent.apiKey ?? await getEffectiveApiKey('openai')
    if (!key) return null
    const model = agent.modelId ?? 'gpt-5-codex'
    const client = new OpenAI({ apiKey: key, baseURL: agent.apiBaseUrl ?? undefined, maxRetries: 1 })
    return { provider: 'openai', modelId: model, summarize: async (prompt, signal, systemPrompt = COMPACTION_SYSTEM_PROMPT) => {
      // Codex-compatible endpoints use Responses rather than Chat Completions.
      const result = await client.responses.create({ model, instructions: systemPrompt, input: prompt, max_output_tokens: SUMMARY_MAX_TOKENS }, { signal })
      recordAuxiliaryUsage(model, result.usage?.input_tokens ?? 0, result.usage?.output_tokens ?? 0)
      if (result.status !== 'completed') throw new Error('辅助模型未完成，原始历史保持不变。')
      return result.output_text
    } }
  }
  if (agent.adapterName !== 'custom' || !agent.modelProvider || !agent.modelId) return null
  if (agent.modelProvider === 'anthropic') {
    const key = agent.apiKey ?? (await getEffectiveApiKey('anthropic'))
    if (!key) return null
    return buildAnthropicChoice(
      key,
      agent.apiBaseUrl ?? (await getEffectiveAnthropicBaseUrl()),
      agent.modelId,
    )
  }
  if (agent.modelProvider === 'openai-compatible') {
    if (!agent.apiKey || !agent.apiBaseUrl) return null
    return buildOpenAICompatibleChoice(
      agent.modelProvider,
      agent.modelId,
      agent.apiKey,
      agent.apiBaseUrl,
    )
  }

  const key =
    agent.apiKey ??
    (await getEffectiveApiKey(agent.modelProvider === 'volcano-ark' ? 'ark' : agent.modelProvider))
  if (!key) return null

  return buildOpenAICompatibleChoice(
    agent.modelProvider,
    agent.modelId,
    key,
    agent.apiBaseUrl,
  )
}

function buildOpenAICompatibleChoice(
  provider: Exclude<ModelProvider, 'anthropic'>,
  modelId: string,
  apiKey: string,
  apiBaseUrl: string | null,
): SummaryModelChoice {
  const baseURL =
    apiBaseUrl ??
    (provider === 'deepseek'
      ? DEFAULT_DEEPSEEK_BASE_URL
      : provider === 'volcano-ark'
        ? DEFAULT_VOLCANO_ARK_BASE_URL
        : undefined)
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 2 })
  return {
    provider,
    modelId,
    summarize: async (prompt, signal, systemPrompt = COMPACTION_SYSTEM_PROMPT) => {
      const result = await client.chat.completions.create(
        {
          model: modelId,
          temperature: 0.2,
          max_tokens: SUMMARY_MAX_TOKENS,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        },
        { signal },
      )
      recordAuxiliaryUsage(modelId, result.usage?.prompt_tokens ?? 0, result.usage?.completion_tokens ?? 0)
      if (result.choices[0]?.finish_reason === 'length') throw new Error('辅助模型输出超过限制，未保存不完整结果。')
      return result.choices[0]?.message.content ?? ''
    },
  }
}

function buildAnthropicChoice(
  apiKey: string,
  apiBaseUrl: string | null,
  modelId: string,
): SummaryModelChoice {
  const client = new Anthropic(
    apiBaseUrl
      ? { apiKey: null, authToken: apiKey, baseURL: apiBaseUrl, maxRetries: 2 }
      : { apiKey, maxRetries: 2 },
  )
  return {
    provider: 'anthropic',
    modelId,
    summarize: async (prompt, signal, systemPrompt = COMPACTION_SYSTEM_PROMPT) => {
      const result = await client.messages.create(
        {
          model: modelId,
          max_tokens: SUMMARY_MAX_TOKENS,
          temperature: 0.2,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal },
      )
      recordAuxiliaryUsage(modelId, result.usage.input_tokens, result.usage.output_tokens)
      if (result.stop_reason === 'max_tokens') throw new Error('辅助模型输出超过限制，未保存不完整结果。')
      return result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    },
  }
}

function normalizeSummary(summary: string): string {
  const trimmed = summary.trim()
  if (!trimmed) throw new Error('Compaction model returned an empty summary')
  return trimmed
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const COMPACTION_SYSTEM_PROMPT = [
  '你是 AgentHub 的上下文压缩器。你的任务是把较早的会话历史压缩成一份可继续工作的摘要。',
  '',
  '输出要求：',
  '- 使用中文，除非历史内容主要是英文。',
  '- 保留用户目标、已经确认的决策、关键约束、未完成问题、重要文件/模块/命令、artifact id、agent 分工和结论。',
  '- 保留会影响后续执行的错误、回滚、测试结果、环境信息。',
  '- 删除寒暄、重复内容、详细工具日志、长代码正文；如果代码很重要，只记录文件、函数、意图和关键差异。',
  '- 不要虚构没有出现过的事实。',
  '- 用简洁分节或项目符号输出，适合直接放进下一轮 LLM 上下文。',
].join('\n')

const compactions = new Map<string, Promise<CompactConversationResult>>()

/** Serialize compaction per conversation so coverage never forks under parallel agents. */
export function compactConversation(conversationId: string, signal?: AbortSignal): Promise<CompactConversationResult> {
  const pending = compactions.get(conversationId)
  if (pending) return pending
  const task = compactConversationUnlocked(conversationId, signal).finally(() => compactions.delete(conversationId))
  compactions.set(conversationId, task)
  return task
}

/** Both background extraction and compaction share configured credentials and usage accounting. */
export async function generateAuxiliaryText(agentIds: string[], prompt: string, systemPrompt: string, signal?: AbortSignal): Promise<string> {
  const choice = await chooseSummaryModel(agentIds)
  return choice.summarize(prompt, signal, systemPrompt)
}
