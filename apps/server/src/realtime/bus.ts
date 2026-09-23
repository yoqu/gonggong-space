import type { WebEvent } from '@aiws/protocol'

type Sink = (event: WebEvent) => void

/** Fan-out of realtime events to connected browser sessions, keyed by user. */
export class Bus {
  private sinks = new Map<string, Set<Sink>>()

  attach(userId: string, sink: Sink) {
    const set = this.sinks.get(userId) ?? new Set()
    set.add(sink)
    this.sinks.set(userId, set)
    return () => {
      set.delete(sink)
      if (!set.size) this.sinks.delete(userId)
    }
  }

  publish(userIds: Iterable<string>, event: WebEvent) {
    for (const id of new Set(userIds)) for (const sink of this.sinks.get(id) ?? []) sink(event)
  }

  isConnected(userId: string) {
    return this.sinks.has(userId)
  }
}
