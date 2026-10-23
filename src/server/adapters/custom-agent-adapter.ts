import { withWebTools } from '@/shared/web-tools'
import { readFileSync } from 'node:fs'

import OpenAI from 'openai'

import { newMessageId } from '@/server/ids'
import { createContextBudget, estimateRequestTokens, toApiTool } from '@/server/context-budget'
import { compactWorkingContext, ContextPausedError, isContextOverflow, pendingContextCalls } from '@/server/working-context'
import { toolRegistry } from '@/server/tools/registry'
import type { ToolContext } from '@/server/tools/types'
import { getModelLimits } from '@/shared/model-registry'
import type { DeployStatusRecord, ModelProvider, StreamEvent } from '@/shared/types'

import { resolveCustomProviderClientConfig } from './custom-provider-client'
import type { AdapterAttachment, AdapterInput, AgentPlatformAdapter } from './types'

/**
 * CustomAgentAdapter —— 自配置 Agent 的适配器。
 *
 * 通过 openai SDK 调用底层模型（OpenAI Chat Completions 兼容协议），
 * 自己实现 tool loop：流式拉模型输出 → 解析 tool_calls → 调用 ToolExecutor →
 * 把结果回灌到 messages → 续写下一轮，直到模型不再调工具。
 *
 * 详细规格见 specs/05-adapter-interface.md。
 */

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

interface AccumulatingToolCall {
  id: string
  name: string
  argsBuffer: string
}

/** 防止单条 user message 塞太多图片（token 爆炸 + provider 通常有上限） */
const MAX_IMAGES_PER_MESSAGE = 5

export class CustomAgentAdapter implements AgentPlatformAdapter {
  readonly name = 'custom' as const

  async *stream(input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
    if (!input.customConfig) {
      throw new Error('CustomAgentAdapter requires customConfig')
    }
    if (!input.modelId) {
      throw new Error('CustomAgentAdapter requires modelId')
    }
    const { modelProvider, supportsVision } = input.customConfig
    const modelId = input.modelId
    const systemPrompt = input.systemPrompt
    const apiKey = input.apiKey

    const client = buildClient(modelProvider, apiKey, input.apiBaseUrl)

    const toolDefs = toolRegistry.resolve(withWebTools(input.toolNames))
    const apiTools = toolDefs.map(toApiTool)
    const contextBudget = input.contextBudget ?? createContextBudget(getModelLimits(modelProvider, modelId, input.apiBaseUrl))

    const ctx: ToolContext = {
      conversationId: input.conversationId,
      workspacePath: input.workspacePath,
      agentId: input.agentId,
      runId: input.runId,
      abortSignal: signal,
    }

    // 构造 user message content：若 agent 声明 vision + 实际有图片，走 multimodal blocks
    const imageAttachments =
      input.attachments?.filter((a) => a.kind === 'image').slice(0, MAX_IMAGES_PER_MESSAGE) ?? []
    const useMultimodal = !!supportsVision && imageAttachments.length > 0

    const userContent: ChatMessage['content'] = useMultimodal
      ? buildMultimodalUserContent(input.prompt, imageAttachments)
      : input.prompt

    let messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      // 跨 run 历史：spec 13 序列化的对话上下文。空数组时行为与旧版一致（向后兼容）。
      ...(input.history ?? []),
      { role: 'user', content: userContent },
    ]
    let currentUserIndex = messages.length - 1

    const MAX_TURNS = 8
    let turn = 0
    // 跨 turn 累加 token 用量；run 结束前 yield run.usage 给 AgentRunner 落库
    let runUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      lastInputTokens: 0,
    }
    let providerRecoveries = 0
    let forceCompaction = false
    let previousMeasured: { tokens: number; estimate: number } | null = null
    const restored = input.contextControl?.restored
    if (restored) {
      if (restored.completed) return
      if (restored.pendingTool || pendingContextCalls(restored.messages).length) throw new ContextPausedError('工具执行结果未确认，已保留现场；请先核对副作用，不能自动重跑。')
      messages = restored.messages
      // Fresh runtime health evidence must supersede a checkpoint's stale configuration claims.
      messages = messages.map((message, index) => index === 0 && message.role === 'system' ? { role: 'system', content: systemPrompt } : message)
      currentUserIndex = restored.currentUserIndex
      turn = restored.turn
      providerRecoveries = restored.progress?.state === 'paused' ? 0 : restored.providerRecoveries
      runUsage = restored.usage
      forceCompaction = restored.progress?.state === 'paused'
    }
    const checkpoint = (pendingTool?: string, completed = false) => input.contextControl?.save({ messages, currentUserIndex, turn, providerRecoveries, usage: runUsage, pendingTool, completed })

    while (turn < MAX_TURNS) {
      if (signal.aborted) return
      // Snapshot before any summary attempt, so failures resume after completed tool operations.
      checkpoint()
      let rawEstimate = estimateRequestTokens(messages, apiTools)
      const estimate = previousMeasured ? Math.max(0, previousMeasured.tokens + rawEstimate - previousMeasured.estimate) : rawEstimate
      const hasToolResult = messages.some((message) => message.role === 'tool')
      if (input.contextControl) {
        const compacted = await compactWorkingContext({ messages, tools: apiTools, budget: contextBudget, currentUserIndex,
          summarize: input.contextControl.summarize, summaryChunkTokens: input.contextControl.summaryChunkTokens, signal, force: forceCompaction, estimate,
          progress: input.contextControl.progress, protectedMessageKeys: input.contextControl.protectedMessageKeys }).catch((error) => {
            if (error instanceof ContextPausedError) input.contextControl?.progress({ state: 'paused', message: error.message })
            throw error
          })
        if (compacted.messages !== messages) previousMeasured = null
        messages = compacted.messages
        currentUserIndex = compacted.currentUserIndex
        forceCompaction = false
        checkpoint()
        rawEstimate = estimateRequestTokens(messages, apiTools)
      }
      turn++

      const messageId = newMessageId()
      yield baseEvent(input, {
        type: 'message.start',
        messageId,
        agentId: input.agentId,
        runId: input.runId,
      })

      let textPartIndex = -1
      let textBuffer = ''
      let thinkingPartIndex = -1
      let reasoningBuffer = ''
      let nextPartIndex = 0
      const toolCallBuffer = new Map<number, AccumulatingToolCall>()

      let stream: Awaited<ReturnType<typeof client.chat.completions.create>>
      try {
        stream = await client.chat.completions.create(
          {
            model: modelId,
            messages,
            tools: apiTools.length > 0 ? apiTools : undefined,
            max_tokens: contextBudget.maxOutputTokens,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal },
        )
      } catch (err) {
        yield baseEvent(input, { type: 'message.end', messageId })
        if (input.contextControl && isContextOverflow(err)) {
          turn--
          if (providerRecoveries++ >= 2) {
            checkpoint()
            const message = '服务商仍拒绝上下文，已暂停；请检查模型窗口配置后继续。'
            input.contextControl.progress({ state: 'paused', message })
            throw new ContextPausedError(message)
          }
          forceCompaction = true
          checkpoint()
          continue
        }
        throw err
      }

      let finishReason: string | null = null
      let usageRecorded = false
      // 本 turn 单条 message 的 usage（per-message）；与 runUsage 同时维护
      const msgUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

      for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (signal.aborted) return
        // Final usage chunk (stream_options.include_usage)：choices 通常空，只携 usage。
        // DeepSeek 还附带 prompt_cache_hit_tokens / prompt_cache_miss_tokens。
        const usage = (chunk as { usage?: Record<string, number> | null }).usage
        if (usage) {
          const inp = usage.prompt_tokens ?? 0
          const out = usage.completion_tokens ?? 0
          const cached = usage.prompt_cache_hit_tokens ?? usage.cached_tokens ?? 0
          msgUsage.inputTokens += inp
          msgUsage.outputTokens += out
          msgUsage.cacheReadTokens += cached
          runUsage.inputTokens += inp
          runUsage.outputTokens += out
          runUsage.cacheReadTokens += cached
          runUsage.lastInputTokens = inp
          if (inp > 0) previousMeasured = { tokens: inp, estimate: rawEstimate }
          // Multimodal payloads lack a stable byte-to-token relation and never train text calibration.
          if (inp > 0 && !usageRecorded && !useMultimodal) {
            input.onContextUsage?.(rawEstimate, inp, hasToolResult)
            usageRecorded = true
          }
        }
        const choice = chunk.choices[0]
        if (!choice) continue
        // DeepSeek V4/R1 等 thinking-mode 模型在 delta 上加了 reasoning_content
        // 字段，OpenAI SDK 的官方类型不含，这里宽放成扩展形态。
        const delta = choice.delta as OpenAI.Chat.Completions.ChatCompletionChunk['choices'][number]['delta'] & {
          reasoning_content?: string
        }

        // —— reasoning_content (thinking mode) —— 先 yield 出来让 UI 渲染 thinking part
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          if (thinkingPartIndex < 0) {
            thinkingPartIndex = nextPartIndex++
            yield baseEvent(input, {
              type: 'part.start',
              messageId,
              partIndex: thinkingPartIndex,
              part: { type: 'thinking', content: '' },
            })
          }
          reasoningBuffer += delta.reasoning_content
          yield baseEvent(input, {
            type: 'part.delta',
            messageId,
            partIndex: thinkingPartIndex,
            delta: { type: 'thinking.append', text: delta.reasoning_content },
          })
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          if (textPartIndex < 0) {
            textPartIndex = nextPartIndex++
            yield baseEvent(input, {
              type: 'part.start',
              messageId,
              partIndex: textPartIndex,
              part: { type: 'text', content: '' },
            })
          }
          textBuffer += delta.content
          yield baseEvent(input, {
            type: 'part.delta',
            messageId,
            partIndex: textPartIndex,
            delta: { type: 'text.append', text: delta.content },
          })
        }

        if (delta.tool_calls) {
          for (const tcd of delta.tool_calls) {
            const idx = tcd.index
            let entry = toolCallBuffer.get(idx)
            if (!entry) {
              entry = { id: '', name: '', argsBuffer: '' }
              toolCallBuffer.set(idx, entry)
            }
            if (tcd.id) entry.id = tcd.id
            if (tcd.function?.name) entry.name = tcd.function.name
            if (tcd.function?.arguments) entry.argsBuffer += tcd.function.arguments
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason
      }

      if (thinkingPartIndex >= 0) {
        yield baseEvent(input, { type: 'part.end', messageId, partIndex: thinkingPartIndex })
      }
      if (textPartIndex >= 0) {
        yield baseEvent(input, { type: 'part.end', messageId, partIndex: textPartIndex })
      }

      const toolCalls = Array.from(toolCallBuffer.values()).filter((tc) => tc.id && tc.name)

      // 写回 assistant message
      // DeepSeek thinking-mode 模型要求把 reasoning_content 一起回传到下一轮，
      // 否则 API 返回 "The reasoning_content in the thinking mode must be passed back".
      // OpenAI SDK 类型不识 reasoning_content，用扩展 cast。
      const assistantMsg = {
        role: 'assistant' as const,
        content: textBuffer || null,
        tool_calls:
          toolCalls.length > 0
            ? toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.argsBuffer || '{}' },
              }))
            : undefined,
        ...(reasoningBuffer ? { reasoning_content: reasoningBuffer } : {}),
      }
      messages.push(assistantMsg as ChatMessage)

      if (finishReason === 'length') {
        if (msgUsage.inputTokens > 0 || msgUsage.outputTokens > 0) {
          yield baseEvent(input, { type: 'message.usage', messageId, usage: msgUsage })
        }
        yield baseEvent(input, { type: 'message.end', messageId })
        yield baseEvent(input, { type: 'run.usage', runId: input.runId, usage: { ...runUsage, model: modelId } })
        throw new Error('模型输出达到 max_tokens 或上下文上限，回答不完整；请调整输出上限或缩短输入后重试。')
      }

      if (toolCalls.length === 0 || finishReason === 'stop') {
        checkpoint(undefined, true)
        if (msgUsage.inputTokens > 0 || msgUsage.outputTokens > 0) {
          yield baseEvent(input, { type: 'message.usage', messageId, usage: msgUsage })
        }
        yield baseEvent(input, { type: 'message.end', messageId })
        yield baseEvent(input, {
          type: 'run.usage',
          runId: input.runId,
          usage: { ...runUsage, model: modelId },
        })
        return
      }

      // 执行工具
      for (const tc of toolCalls) {
        let args: unknown
        try {
          args = tc.argsBuffer ? JSON.parse(tc.argsBuffer) : {}
        } catch {
          args = {}
        }

        yield baseEvent(input, {
          type: 'tool.call',
          messageId,
          callId: tc.id,
          toolName: tc.name,
          args,
        })

        // An unfinished side-effect marker prevents blind replay after a process crash.
        checkpoint(tc.id)
        const result = await toolRegistry.execute(tc.name, args, ctx)
        const value = result.ok ? result.value : { error: result.error }

        yield baseEvent(input, {
          type: 'tool.result',
          messageId,
          callId: tc.id,
          result: value,
          isError: !result.ok,
        })

        // 工具结果含 artifactId 视为「创建了产物」的约定，统一由 adapter 发布
        // artifact.create 事件，让上层 AgentRunner 注入 artifact_ref part。
        if (tc.name === 'write_artifact' && result.ok && hasArtifactId(value)) {
          const artifactId = (value as { artifactId: string }).artifactId
          const { db, schema } = await import('@/db/client')
          const { eq } = await import('drizzle-orm')
          const artifact = await db.query.artifacts.findFirst({
            where: eq(schema.artifacts.id, artifactId),
          })
          if (artifact) {
            yield baseEvent(input, {
              type: 'artifact.create',
              artifact: {
                id: artifact.id,
                conversationId: artifact.conversationId,
                type: artifact.type,
                title: artifact.title,
                content: artifact.content,
                version: artifact.version,
                parentArtifactId: artifact.parentArtifactId ?? undefined,
                createdByAgentId: artifact.createdByAgentId,
                createdAt: artifact.createdAt,
              },
            })
          }
        }

        if (
          (tc.name === 'deploy_artifact' || tc.name === 'deploy_workspace') &&
          result.ok &&
          isDeployStatusRecord(value)
        ) {
          yield baseEvent(input, {
            type: 'deploy.status',
            messageId,
            deployment: value,
          })
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(value),
        })
        checkpoint()
      }

      if (msgUsage.inputTokens > 0 || msgUsage.outputTokens > 0) {
        yield baseEvent(input, { type: 'message.usage', messageId, usage: msgUsage })
      }
      yield baseEvent(input, { type: 'message.end', messageId })
      // 继续下一轮
    }
    // 到达 MAX_TURNS 兜底：把累计 usage emit 一下（正常路径在 line 232 已 emit 过 + return）
    yield baseEvent(input, {
      type: 'run.usage',
      runId: input.runId,
      usage: { ...runUsage, model: modelId },
    })
  }
}

// ─── 辅助 ────────────────────────────────────────────────

/**
 * OpenAI SDK 默认 maxRetries=2，对 408 / 429 / >= 500 / APIConnectionError 自动指数退避重试。
 * 这里显式声明同样的 2 次重试，让 spec 05 §「错误处理」承诺的「网络/速率限制重试」在代码层
 * 可见且可调（未来按 provider 调整时只动这一个常量）。
 *
 * 注意：重试只对「初始连接」生效；stream 一旦开始 emit chunks 就不会再重试。
 */
const MAX_API_RETRIES = 2

function buildClient(
  provider: ModelProvider,
  overrideKey?: string | null,
  apiBaseUrl?: string | null,
): OpenAI {
  return new OpenAI({
    ...resolveCustomProviderClientConfig(provider, overrideKey, apiBaseUrl),
    maxRetries: MAX_API_RETRIES,
  })
}

function hasArtifactId(value: unknown): value is { artifactId: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'artifactId' in value &&
    typeof (value as { artifactId: unknown }).artifactId === 'string'
  )
}

function isDeployStatusRecord(value: unknown): value is DeployStatusRecord {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof (value as { id: unknown }).id === 'string' &&
    'artifactId' in value &&
    typeof (value as { artifactId: unknown }).artifactId === 'string' &&
    'previewPath' in value &&
    typeof (value as { previewPath: unknown }).previewPath === 'string' &&
    'status' in value &&
    ((value as { status: unknown }).status === 'ready' ||
      (value as { status: unknown }).status === 'failed') &&
    'createdAt' in value &&
    typeof (value as { createdAt: unknown }).createdAt === 'number'
  )
}

/**
 * 构造 OpenAI 风格的多模态 user message content：
 *   [{ type: 'text', text: ... }, { type: 'image_url', image_url: { url: 'data:...' } }, ...]
 *
 * DeepSeek 兼容 OpenAI schema；Anthropic 的 image block 形态不同，目前 CustomAgentAdapter
 * 走 openai SDK + OpenAI-compatible endpoint，先只支持这一套。
 */
function buildMultimodalUserContent(
  prompt: string,
  images: AdapterAttachment[],
): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const blocks: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: prompt },
  ]
  for (const img of images) {
    try {
      const data = readFileSync(img.absPath).toString('base64')
      blocks.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType};base64,${data}`,
        },
      })
    } catch (err) {
      console.warn('[CustomAgentAdapter] failed to read image', img.absPath, err)
    }
  }
  return blocks
}

function baseEvent<T extends Omit<StreamEvent, 'conversationId' | 'timestamp'>>(
  input: AdapterInput,
  body: T,
): StreamEvent {
  return {
    ...body,
    conversationId: input.conversationId,
    timestamp: Date.now(),
  } as StreamEvent
}
