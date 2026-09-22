/** Hold one SDK stream per conversation/agent; queued cancellation must never start a model request. */
const globalLocks = globalThis as unknown as { __sdkLocks?: Map<string, Promise<void>> }
const locks = globalLocks.__sdkLocks ??= new Map()

export async function acquireSession(key: string, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  locks.set(key, tail)
  let onAbort: (() => void) | undefined
  try {
    await Promise.race([previous, new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('已取消'))
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })])
    signal.throwIfAborted()
  } catch (error) {
    release()
    void tail.then(() => { if (locks.get(key) === tail) locks.delete(key) })
    throw error
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
  return () => {
    release()
    if (locks.get(key) === tail) locks.delete(key)
  }
}
