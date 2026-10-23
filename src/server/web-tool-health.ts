import { getWebToolKey, webToolStatus } from './web-tool-settings'
import { runWebTool } from './web-tools-service'

/** Re-read credentials for every probe so historical failures cannot become permanent state. */
export async function probeWebTool(tool: 'web_search' | 'web_fetch', signal: AbortSignal) {
  signal.throwIfAborted()
  const key = getWebToolKey()
  const checkedAt = new Date().toISOString()
  if (!key) return { tool, available: false, checkedAt, reason: 'missing_configuration', message: '当前未配置 Tavily API Key。' }
  try {
    signal.throwIfAborted()
    await runWebTool(tool === 'web_search' ? 'search' : 'fetch', tool === 'web_search'
      ? { query: 'Tavily', maxResults: 1 } : { url: 'https://example.com/' }, key, signal)
    return { tool, available: true, checkedAt, reason: 'verified', message: '本次真实请求成功。请直接执行用户任务，不要沿用历史不可用结论。' }
  } catch (error) {
    signal.throwIfAborted()
    const status = error instanceof Error ? /^Web provider returned HTTP (\d+);/.exec(error.message)?.[1] : undefined
    return { tool, available: false, checkedAt, reason: status ? `http_${status}` : 'network_or_response_error',
      message: status ? `当前已配置 Key，但真实请求返回 HTTP ${status}。不能称为未配置。` : '当前已配置 Key，但真实请求网络、超时或响应异常。不能称为未配置。' }
  }
}

/** Configuration is cheap to refresh; connectivity is established only by an actual tool request. */
export function webToolRuntimeGuidance() {
  return '## 当前联网工具状态（运行时读取，覆盖历史配置结论）\n'
    + JSON.stringify(webToolStatus())
    + '\nconfigured 仅代表配置存在，不代表联网成功。历史中的未配置、超时、失败不能代表现在。'
    + '认为工具不可用时，必须先调用 web_tool_status 或直接重试只读 web_search/web_fetch；成功则直接继续任务，不再询问是否继续。'
    + '只有本次实际失败才可报告当前不可用，并区分配置、认证、限流和网络错误。其他工具也须检查当前权限或安全的只读状态，禁止为健康检查重复执行写入、部署、命令等副作用。'
}

/** Guard explicit web-availability questions without intercepting unrelated product choices. */
export function questionsClaimWebUnavailable(questions: unknown) {
  const text = JSON.stringify(questions)
  return /Tavily|web_search|web_fetch|联网|网络搜索|web tool/i.test(text)
    && /未配置|不可用|无法|不能|受限|配好|配置.*key|unavailable|not configured|cannot|configure.*key/i.test(text)
}

/** Old tool failures trigger a server-side probe even if the model never asks for one. */
export async function recheckHistoricalWebFailure(history: unknown, signal: AbortSignal) {
  if (!questionsClaimWebUnavailable(history)) return ''
  const status = await probeWebTool(webCapabilityForClaim(history), signal)
  return '\n## 历史联网故障已由服务端重新校验\n' + JSON.stringify(status)
    + '\n此结果覆盖旧的不可用结论；available=true 时立即实际搜索完成任务，不要再次向用户确认是否联网。'
}

/** A successful search does not prove extraction works, so probe the named capability. */
export function webCapabilityForClaim(value: unknown): 'web_search' | 'web_fetch' {
  const text = JSON.stringify(value)
  return /web_fetch|网页提取|网页读取/i.test(text) && !/web_search/i.test(text) ? 'web_fetch' : 'web_search'
}
