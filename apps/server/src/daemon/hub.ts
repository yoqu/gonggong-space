import { EventEmitter } from 'node:events'
import type { DaemonToServer, ServerToDaemon } from '@gonggong/protocol'

export interface DaemonConn {
  send(msg: ServerToDaemon): void
  close(code: number, reason: string): void
}

interface HubEvents {
  online: [machineId: string]
  offline: [machineId: string]
  message: [machineId: string, msg: Reply]
}

type Reply = Exclude<DaemonToServer, { t: 'hello' | 'heartbeat' }>
interface Waiter {
  machineId: string
  reply: Reply['t']
  resolve: (msg: Reply | undefined) => void
}

/** Registry of connected daemons. Offline = socket closed or 3 missed heartbeats. */
export class DaemonHub extends EventEmitter<HubEvents> {
  private conns = new Map<string, DaemonConn>()
  /** hello.features of each connected daemon. */
  private caps = new Map<string, string[]>()
  private waiters = new Map<string, Waiter>()

  constructor() {
    super()
    // Every domain module subscribes once to `message`; the default cap of 10 would flag that as a leak.
    this.setMaxListeners(50)
    this.on('message', (machineId, msg) => {
      const w = 'requestId' in msg && msg.requestId ? this.waiters.get(msg.requestId) : undefined
      if (w?.machineId === machineId && w.reply === msg.t) w.resolve(msg)
    })
    this.on('offline', (machineId) => {
      for (const w of [...this.waiters.values()]) if (w.machineId === machineId) w.resolve(undefined)
    })
  }

  register(machineId: string, conn: DaemonConn, features: string[] = []) {
    this.conns.get(machineId)?.close(4002, 'replaced by a newer connection')
    this.conns.set(machineId, conn)
    this.caps.set(machineId, features)
    this.emit('online', machineId)
  }

  unregister(machineId: string, conn: DaemonConn) {
    if (this.conns.get(machineId) !== conn) return
    this.conns.delete(machineId)
    this.caps.delete(machineId)
    this.emit('offline', machineId)
  }

  /** What the connected daemon supports (DaemonFeature); empty while offline. */
  features(machineId: string): string[] {
    return this.caps.get(machineId) ?? []
  }

  /**
   * Sends `msg` and resolves with the daemon's `reply` message carrying the same requestId; undefined when the
   * machine is offline, disconnects or stays silent past `timeoutMs`.
   */
  request<T extends Reply['t']>(
    machineId: string,
    msg: Extract<ServerToDaemon, { requestId: string }>,
    reply: T,
    timeoutMs: number,
  ): Promise<Extract<Reply, { t: T }> | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(undefined), timeoutMs)
      timer.unref()
      const settle = (res: Reply | undefined) => {
        clearTimeout(timer)
        this.waiters.delete(msg.requestId)
        resolve(res as Extract<Reply, { t: T }> | undefined)
      }
      this.waiters.set(msg.requestId, { machineId, reply, resolve: settle })
      if (!this.send(machineId, msg)) settle(undefined)
    })
  }

  isOnline(machineId: string) {
    return this.conns.has(machineId)
  }

  /** Returns false when the machine is offline; callers decide whether to queue. */
  send(machineId: string, msg: ServerToDaemon) {
    const conn = this.conns.get(machineId)
    conn?.send(msg)
    return !!conn
  }

  kick(machineId: string, code: number, reason: string) {
    this.conns.get(machineId)?.close(code, reason)
  }
}
