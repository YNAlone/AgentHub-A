import type { NextRequest } from 'next/server'

import { streamSnapshot } from '@/server/stream-snapshot'
import { localAuth } from '@/server/local-auth'
import { eventBus } from '@/server/event-bus'

/**
 * GET /api/stream
 *
 * 全局 SSE 端点。所有会话的事件都从这一条流推出，事件携带 conversationId，
 * 前端按 id 分发到对应桶。详见 specs/02-stream-events.md。
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let overflow = false
      let cleanup = () => {}

      const send = (data: unknown, id?: number) => {
        if (closed) return
        if ((controller.desiredSize ?? 0) < 0) { overflow = true; cleanup(); return }
        try {
          controller.enqueue(encoder.encode(`${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // 控制器已关闭，忽略
        }
      }

      // Subscribe before synchronous calibration; live delivery cannot slip between cursor and snapshot.
      const unsubscribe = eventBus.subscribe((event, id) => send(event, id))
      const rawCursor = req.headers.get('last-event-id')
      if (rawCursor) {
        const replay = eventBus.journal.after(Number(rawCursor)) ?? []
        // Large gaps go straight to a snapshot instead of filling a slow client's queue.
        if (replay.length <= 64) for (const item of replay) send(item.event, item.id)
      }
      const snapshot = streamSnapshot()
      send(snapshot, snapshot.cursor)

      // 15s 心跳防止中间代理 / 浏览器空闲断连
      const heartbeat = setInterval(() => {
        if (!localAuth().authorize(req)) { close(); return }
        send({ type: 'heartbeat', timestamp: Date.now() })
      }, 15000)

      const close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // 已关闭
        }
      }
      cleanup = close
      if (overflow) close()

      req.signal.addEventListener('abort', close, { once: true })
      if (req.signal.aborted) close()
    },
  }, { highWaterMark: 512 * 1024, size: (chunk) => chunk.byteLength })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
