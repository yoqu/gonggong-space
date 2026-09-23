import type { WebEvent } from '@aiws/protocol'

type Sink = (event: WebEvent) => void

/** Fan-out of realtime events to connected browser sessions, keyed by user. */
export class Bus {
  private sinks = new Map<string, Set<Sink>>()
  private closers = new Map<Sink, () => void>()

  /** `close` ends the underlying connection when the user is disconnected (account disabled). */
  attach(userId: string, sink: Sink, close?: () => void) {
    const set = this.sinks.get(userId) ?? new Set()
    set.add(sink)
    this.sinks.set(userId, set)
    if (close) this.closers.set(sink, close)
    return () => {
      set.delete(sink)
      this.closers.delete(sink)
      if (!set.size) this.sinks.delete(userId)
    }
  }

  disconnect(userId: string) {
    for (const sink of [...(this.sinks.get(userId) ?? [])]) this.closers.get(sink)?.()
  }

  publish(userIds: Iterable<string>, event: WebEvent) {
    for (const id of new Set(userIds)) for (const sink of this.sinks.get(id) ?? []) sink(event)
  }

  isConnected(userId: string) {
    return this.sinks.has(userId)
  }
}
