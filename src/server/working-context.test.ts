import { describe, expect, it, vi } from 'vitest'
import { compactWorkingContext, hierarchicalSummary, isContextOverflow, ContextPausedError, workingMessageKey, type WorkingMessage } from './working-context'
import { estimateRequestTokens } from './context-budget'

const budget = { contextWindow: 20_000, maxInputTokens: 15_000, maxOutputTokens: 4000, safetyTokens: 1000, plainFactor: 1, toolFactor: 1 }
const signal = new AbortController().signal
const messages: WorkingMessage[] = [
  { role: 'system', content: '保留文件，不要删除。' }, { role: 'user', content: '检索新闻' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'search', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'search', content: '新闻内容'.repeat(8000) + ' https://example.com/source' },
]
const options = { messages, currentUserIndex: 1, tools: [], budget, signal, retryDelays: [0, 0] }

describe('resumable working context', () => {
  it('compacts one large completed result with fewer than six messages, preserving originals and current request', async () => {
    const original = JSON.stringify(messages)
    const result = await compactWorkingContext({ ...options, summarize: async () => '已检索，来源 https://example.com/source；待答复。' })
    expect(estimateRequestTokens(result.messages)).toBeLessThan(budget.maxInputTokens * 0.35)
    expect(result.messages[result.currentUserIndex]).toEqual(messages[1])
    expect(result.messages[0]).toEqual(messages[0])
    expect(JSON.stringify(result.messages)).toContain('https://example.com/source')
    expect(JSON.stringify(messages)).toBe(original)
  })
  it('retries twice and pauses without altering the checkpoint when summaries fail', async () => {
    const summarize = vi.fn(async () => { throw new Error('unavailable') })
    const progress = vi.fn()
    await expect(compactWorkingContext({ ...options, summarize, progress })).rejects.toBeInstanceOf(ContextPausedError)
    expect(summarize).toHaveBeenCalledTimes(3)
    expect(progress.mock.calls.map(([value]) => value.attempt)).toEqual([0, 1, 2])
    expect(messages[3].content?.length).toBeGreaterThan(30_000)
  })
  it('rejects empty and non-shrinking summaries, and never clips oversized protected content', async () => {
    for (const summarize of [async () => '', async (text: string) => text]) {
      await expect(compactWorkingContext({ ...options, summarize })).rejects.toBeInstanceOf(ContextPausedError)
    }
    const summarize = vi.fn(async () => 'summary')
    await expect(compactWorkingContext({ ...options, messages: [{ role: 'user', content: '中'.repeat(30_000) }], currentUserIndex: 0, summarize })).rejects.toThrow('当前输入')
    expect(summarize).not.toHaveBeenCalled()
  })
  it('does not compact below 60% and never summarizes pending tools', async () => {
    const summarize = vi.fn(async () => 'summary')
    const small: WorkingMessage[] = [{ role: 'user', content: 'hello' }]
    expect((await compactWorkingContext({ ...options, messages: small, currentUserIndex: 0, summarize })).messages).toBe(small)
    await expect(compactWorkingContext({ ...options, messages: messages.slice(0, 3), summarize, force: true })).rejects.toThrow('尚未完成')
    expect(summarize).not.toHaveBeenCalled()
  })
  it('preserves explicitly pinned constraints verbatim through compaction', async () => {
    const pinned: WorkingMessage = { role: 'user', content: '必须保留用户文件，不得删除。' }
    const result = await compactWorkingContext({ ...options, messages: [...messages, pinned], protectedMessageKeys: [workingMessageKey(pinned)], summarize: async () => '已检索，待回答。' })
    expect(result.messages).toContainEqual(pinned)
    expect(result.messages[result.currentUserIndex]).toEqual(messages[1])
  })
  it('cancels without retrying or converting cancellation into pause', async () => {
    const controller = new AbortController()
    const summarize = vi.fn(async () => { controller.abort(); throw new Error('cancelled') })
    await expect(compactWorkingContext({ ...options, signal: controller.signal, summarize })).rejects.not.toBeInstanceOf(ContextPausedError)
    expect(summarize).toHaveBeenCalledTimes(1)
  })
  it('includes the tail of oversized input and bounds each hierarchical request', async () => {
    const sources: string[] = []
    await hierarchicalSummary('a'.repeat(6000) + 'TAIL', async (text) => { sources.push(text); return text.includes('TAIL') ? 'TAIL summary' : 'part summary' }, signal)
    expect(sources.some((text) => text.includes('TAIL'))).toBe(true)
    expect(Math.max(...sources.map((text) => estimateRequestTokens([{ role: 'user', content: text }])))).toBeLessThan(12000)
  })
  it('recovers explicit provider/SDK overflow only, leaving authentication and rate errors unchanged', () => {
    expect(isContextOverflow({ status: 400, code: 'context_length_exceeded' })).toBe(true)
    expect(isContextOverflow(new Error('maximum context length exceeded'))).toBe(true)
    expect(isContextOverflow({ status: 401, message: 'context window exceeded' })).toBe(false)
    expect(isContextOverflow({ status: 429, message: 'too many tokens' })).toBe(false)
    expect(isContextOverflow(new Error('Unable to retrieve context window configuration'))).toBe(false)
  })
})
