import type Database from 'better-sqlite3'

/** Called once by server instrumentation, never by HMR or a browser reconnection. */
export function recoverInterruptedRuns(sqlite: Database.Database): number {
  return sqlite.transaction(() => {
    const result = sqlite.prepare(`UPDATE agent_runs SET status = 'interrupted', error = ?, finished_at = ? WHERE status IN ('queued', 'running')`).run('服务已重启。继续前请核对已完成步骤；旧审批已失效。', Date.now())
    sqlite.prepare("UPDATE messages SET status = 'aborted' WHERE status = 'streaming'").run()
    return result.changes
  })()
}
