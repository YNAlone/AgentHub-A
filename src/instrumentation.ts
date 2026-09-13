/** Recover once at server startup, before accepting requests or resuming SDK work. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { sqlite } = await import('@/db/client')
    const { recoverInterruptedRuns } = await import('@/server/recovery-service')
    recoverInterruptedRuns(sqlite)
    await import('@/server/personal-runtime')
    const { startMemoryWorker } = await import('@/server/memory-extraction')
    startMemoryWorker()
  }
}
