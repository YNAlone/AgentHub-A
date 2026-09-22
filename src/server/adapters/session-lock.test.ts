import { expect, it } from 'vitest'
import { acquireSession } from './session-lock'

it('serializes the same SDK key and never starts a cancelled queued request', async () => {
  const first = await acquireSession('same', new AbortController().signal)
  const cancelled = new AbortController()
  const waiting = acquireSession('same', cancelled.signal)
  cancelled.abort(new Error('cancelled'))
  await expect(waiting).rejects.toThrow('cancelled')
  const releaseOther = await acquireSession('other', new AbortController().signal)
  releaseOther()
  first()
  const next = await acquireSession('same', new AbortController().signal)
  next()
})
