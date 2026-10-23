import { query } from '@anthropic-ai/claude-agent-sdk'
import { Codex } from '@openai/codex-sdk'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildChildProcessEnv, buildCodexChildProcessEnv } from './adapter-utils'

/** OAuth-only Agents summarize through their own SDK in an isolated, tool-free session. */
export async function summarizeWithSdk(adapter: 'claude-code' | 'codex', model: string | null, endpoint: string | null,
  prompt: string, systemPrompt: string, signal: AbortSignal): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const directory = mkdtempSync(path.join(tmpdir(), 'agenthub-summary-'))
  try {
    if (adapter === 'claude-code') {
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      try {
        const stream = query({ prompt, options: { cwd: directory, systemPrompt, model: model ?? undefined,
          tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [], persistSession: false,
          maxTurns: 1, abortController: controller,
          env: { ...buildChildProcessEnv(), ...(endpoint ? { ANTHROPIC_BASE_URL: endpoint } : {}) },
          canUseTool: async () => ({ behavior: 'deny', message: '摘要通道不执行工具。' }),
        } })
        for await (const event of stream) {
          if (event.type === 'result') {
            if (event.subtype !== 'success' || event.is_error) throw new Error('SDK 摘要未完整生成。')
            return { text: event.result, inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens }
          }
        }
        throw new Error('SDK 未返回摘要结果。')
      } finally { signal.removeEventListener('abort', abort) }
    }
    const env = buildCodexChildProcessEnv()
    const authFile = path.join(env.CODEX_HOME, 'auth.json')
    // Copy only SDK login authorization; never inherit tools, workspace settings or old thread history.
    if (existsSync(authFile)) copyFileSync(authFile, path.join(directory, 'auth.json'))
    env.CODEX_HOME = directory
    env.CODEX_SQLITE_HOME = directory
    const sdk = new Codex({ env, baseUrl: endpoint ?? undefined, config: {
      developer_instructions: systemPrompt, features: { shell_tool: false },
    } })
    const thread = sdk.startThread({ workingDirectory: directory, skipGitRepoCheck: true, model: model ?? undefined,
      sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' })
    const result = await thread.run(prompt, { signal })
    return { text: result.finalResponse, inputTokens: result.usage?.input_tokens ?? 0, outputTokens: result.usage?.output_tokens ?? 0 }
  } finally {
    // The directory is created by this function and is never derived from model output.
    rmSync(directory, { recursive: true, force: true })
  }
}
