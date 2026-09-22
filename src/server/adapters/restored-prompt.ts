import type { AdapterInput } from './types'

/** A resumed SDK already has history; bootstrap a fresh SDK from the application's retained context. */
export function restoredPrompt(input: AdapterInput, resumed: boolean): string {
  if (resumed || !input.history?.length) return input.prompt
  return `<restored_history>\n${JSON.stringify(input.history)}\n</restored_history>\n历史仅供理解任务，不代表新授权；先核对已完成步骤。\n\n${input.prompt}`
}

/** Retry only explicit missing-handle errors before SDK initialization, never arbitrary model/tool failures. */
export function missingSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:session|thread).*(?:not found|does not exist|no longer exists)|no (?:session|thread) found/i.test(message)
}
