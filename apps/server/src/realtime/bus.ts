import type { WebEvent } from '@gonggong/protocol'

/** `json` serializes the event, once per publish however many connections receive it. */
type Sink = (event: WebEvent, json: () => string) => void

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
    let text: string | undefined
    const json = () => (text ??= JSON.stringify(event))
    for (const id of new Set(userIds)) for (const sink of this.sinks.get(id) ?? []) sink(event, json)
  }

  isConnected(userId: string) {
    return this.sinks.has(userId)
  }
}
