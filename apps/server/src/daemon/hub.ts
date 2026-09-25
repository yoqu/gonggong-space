import { EventEmitter } from 'node:events'
import type { DaemonToServer, ServerToDaemon } from '@gonggong/protocol'

export interface DaemonConn {
  send(msg: ServerToDaemon): void
  close(code: number, reason: string): void
}

interface HubEvents {
  online: [machineId: string]
  offline: [machineId: string]
  message: [machineId: string, msg: Exclude<DaemonToServer, { t: 'hello' | 'heartbeat' }>]
}

/** Registry of connected daemons. Offline = socket closed or 3 missed heartbeats. */
export class DaemonHub extends EventEmitter<HubEvents> {
  private conns = new Map<string, DaemonConn>()

  register(machineId: string, conn: DaemonConn) {
    this.conns.get(machineId)?.close(4002, 'replaced by a newer connection')
    this.conns.set(machineId, conn)
    this.emit('online', machineId)
  }

  unregister(machineId: string, conn: DaemonConn) {
    if (this.conns.get(machineId) !== conn) return
    this.conns.delete(machineId)
    this.emit('offline', machineId)
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
