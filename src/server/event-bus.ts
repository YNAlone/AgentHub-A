import { EventEmitter } from 'node:events'
import { sqlite } from '@/db/client'
import { EventJournal } from './event-journal'

import type { StreamEvent } from '@/shared/types'

/**
 * 进程内事件总线。所有 Adapter 产生的 StreamEvent 经由此分发到 SSE 订阅者。
 *
 * 设计要点：
 *  - 单例：跨 Next.js HMR 用 globalThis 保活
 *  - emitter.setMaxListeners(0)：本地单进程预计同时 ≤ 几十个订阅者，但
 *    /api/stream 长连接 + 偶发重连可能短期内堆积，关闭限制避免误警告
 */
class EventBus {
  private emitter = new EventEmitter()
  readonly journal = new EventJournal(sqlite)

  constructor() {
    this.emitter.setMaxListeners(0)
  }

  publish(event: StreamEvent): void {
    const id = this.journal.append(event)
    this.emitter.emit('event', event, id)
  }

  subscribe(listener: (event: StreamEvent, id: number) => void): () => void {
    this.emitter.on('event', listener)
    return () => {
      this.emitter.off('event', listener)
    }
  }
}

const globalForBus = globalThis as unknown as {
  __agenthubEventBus?: EventBus
}

export const eventBus = globalForBus.__agenthubEventBus ?? new EventBus()

if (!globalForBus.__agenthubEventBus) {
  globalForBus.__agenthubEventBus = eventBus
}
