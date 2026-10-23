import { expect, it } from 'vitest'
import { withWebTools, WEB_TOOL_NAMES } from '@/shared/web-tools'
import { toolRegistry } from '@/server/tools/registry'
import { filterAgentHubMcpToolsForRun } from './claude-code-adapter'
import { getCodexAllowedTools } from './codex-adapter'
import type { AdapterInput } from './types'

it('adds registered web tools to legacy and empty Agent lists without duplicates', () => {
  const names = withWebTools(['fs_read', 'web_search'])
  expect(names.filter((name) => name === 'web_search')).toHaveLength(1)
  expect(toolRegistry.resolve(withWebTools([])).map((tool) => tool.name)).toEqual([...WEB_TOOL_NAMES])
})
it('keeps shared web tools in Claude planning and normal MCP sets', () => {
  const tools = [{ name: 'web_search' }, { name: 'web_fetch' }, { name: 'write_artifact' }]
  expect(filterAgentHubMcpToolsForRun(['plan_tasks'], tools)).toEqual(tools.slice(0, 2))
  expect(filterAgentHubMcpToolsForRun([], tools)).toEqual(tools)
})
it('includes web tools in Codex planning restrictions without opening its sandbox network', () => {
  const input: AdapterInput = { conversationId: 'c', agentId: 'a', runId: 'r', prompt: '', systemPrompt: '', workspacePath: '.', toolNames: ['plan_tasks'], apiKey: null, apiBaseUrl: null, modelId: null }
  expect(getCodexAllowedTools(input)?.split(',')).toEqual(expect.arrayContaining([...WEB_TOOL_NAMES, 'plan_tasks']))
  expect(getCodexAllowedTools({ ...input, toolNames: [] })).toBeUndefined()
})
