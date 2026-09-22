import type { AdapterInput } from './types'

export interface AdapterSessionStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): boolean
  keys(): IterableIterator<string>
  clear(): void
}

let durableStore: ((namespace: string) => AdapterSessionStore) | undefined
let prepare: ((namespace: string, input: AdapterInput) => void) | undefined

export function installSessionPreparation(callback: (namespace: string, input: AdapterInput) => void): void { prepare = callback }
export function prepareSession(namespace: string, input: AdapterInput): void { prepare?.(namespace, input) }

/** The application service installs durable storage before the first run. */
export function installSessionStorage(factory: (namespace: string) => AdapterSessionStore): void {
  durableStore = factory
}

export function createAdapterSessionStore(namespace: string): AdapterSessionStore {
  const globalStore = globalThis as unknown as {
    __agenthubAdapterSessions?: Record<string, Map<string, string>>
  }
  globalStore.__agenthubAdapterSessions ??= {}
  globalStore.__agenthubAdapterSessions[namespace] ??= new Map()
  const memory = globalStore.__agenthubAdapterSessions[namespace]
  return {
    get: (key) => (durableStore?.(namespace) ?? memory).get(key),
    set: (key, value) => { (durableStore?.(namespace) ?? memory).set(key, value) },
    delete: (key) => (durableStore?.(namespace) ?? memory).delete(key),
    keys: () => (durableStore?.(namespace) ?? memory).keys(),
    clear: () => (durableStore?.(namespace) ?? memory).clear(),
  }
}

export function adapterSessionKey(conversationId: string, agentId: string): string {
  return `${conversationId}:${agentId}`
}

export const claudeCodeSessions = createAdapterSessionStore('claude-code')
export const codexSessions = createAdapterSessionStore('codex')

export function clearClaudeCodeSession(conversationId: string): void {
  for (const key of claudeCodeSessions.keys()) {
    if (key === conversationId || key.startsWith(`${conversationId}:`)) claudeCodeSessions.delete(key)
  }
}

export function clearCodexSession(conversationId: string): void {
  for (const key of codexSessions.keys()) {
    if (key.startsWith(`${conversationId}:`)) codexSessions.delete(key)
  }
}
