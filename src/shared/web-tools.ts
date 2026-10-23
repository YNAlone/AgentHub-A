export const WEB_TOOL_NAMES = ['web_search', 'web_fetch'] as const

/** Runtime defaults also cover existing Agents whose saved lists predate web tools. */
export function withWebTools(names: readonly string[]): string[] {
  return [...new Set([...names, ...WEB_TOOL_NAMES])]
}
