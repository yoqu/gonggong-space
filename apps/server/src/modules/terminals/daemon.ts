import {
  TerminalDaemonControl,
  TerminalHead,
  TUNNEL_FRAME,
  type TerminalEndReason,
  type TerminalOpen,
  type TerminalStatus,
  type TunnelFrameType,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { bots } from '../../db/schema.js'
import type {
  TerminalAttachment,
  TerminalDaemonDisconnect,
  TerminalDaemonFrame,
  TerminalDaemonStream,
  TerminalSessions,
} from './transport.js'

type State = {
  status: z.infer<typeof TerminalStatus>
  exitCode: number | null
  reason: z.infer<typeof TerminalEndReason> | null
}
type DaemonStream = { send(type: TunnelFrameType, payload?: Uint8Array): Promise<void>; close(reason: string): void }

class DaemonTerminal implements TerminalDaemonStream, TerminalAttachment {
  private frameListener?: (frame: TerminalDaemonFrame) => void
  private disconnectListener?: (reason: TerminalDaemonDisconnect) => void
  private paused = false
  private pending: TerminalDaemonFrame[] = []
  private ended?: { resolve: () => void; reject: (error: Error) => void }
  private closed = false
  readonly termination: Promise<void>

  constructor(
    private stream: DaemonStream,
    private sessionId: string,
    private onState: (sessionId: string, state: State) => void,
    private onClose: (sessionId: string) => void,
  ) {
    this.termination = new Promise((resolve, reject) => {
      this.ended = { resolve, reject }
    })
    this.termination.catch(() => {})
  }

  send(type: TunnelFrameType, payload?: Uint8Array) {
    return this.stream.send(type, payload)
  }

  subscribe(onFrame: (frame: TerminalDaemonFrame) => void, onDisconnect: (reason: TerminalDaemonDisconnect) => void) {
    this.frameListener = onFrame
    this.disconnectListener = onDisconnect
    return () => {
      this.frameListener = undefined
      this.disconnectListener = undefined
    }
  }

  frame(frame: TerminalDaemonFrame) {
    try {
      if (frame.type === TUNNEL_FRAME.head) {
        const value = z.union([TerminalHead, TerminalDaemonControl]).parse(JSON.parse(Buffer.from(frame.payload).toString()))
        if (value.sessionId !== this.sessionId) throw new Error('wrong terminal session')
        const status = 'status' in value ? value.status : value.state
        if (status !== 'running') {
          this.onState(this.sessionId, { status, exitCode: value.exitCode, reason: value.reason })
          this.closed = true
          this.onClose(this.sessionId)
          this.ended?.resolve()
        }
      } else if (frame.type === TUNNEL_FRAME.reset) {
        this.disconnected()
        return
      }
      if (this.paused) this.pending.push(frame)
      else this.frameListener?.(frame)
    } catch {
      this.disconnected()
    }
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
    for (const frame of this.pending.splice(0)) this.frameListener?.(frame)
  }

  close(reason: string) {
    this.stream.close(reason)
  }

  detach(reason = 'browser detached') {
    if (this.closed) return
    this.closed = true
    this.onClose(this.sessionId)
    this.stream.close(reason)
    this.ended?.reject(new Error('终端连接已断开'))
  }

  disconnected() {
    if (this.closed) return
    this.closed = true
    this.onClose(this.sessionId)
    this.disconnectListener?.('daemon_disconnected')
    this.ended?.reject(new Error('daemon 已断开'))
  }
}

export class TerminalDaemonTransport implements TerminalSessions {
  private streams = new Map<string, DaemonTerminal>()
  private watches = new Map<string, () => void>()

  constructor(
    private ctx: Ctx,
    private onState: (sessionId: string, state: State) => void,
  ) {}

  async attach(open: TerminalOpen): Promise<TerminalAttachment> {
    const [bot] = await this.ctx.db.select({ machineId: bots.machineId }).from(bots).where(eq(bots.id, open.botId))
    const machineId = bot?.machineId
    const conn = machineId ? this.ctx.tunnels.get(machineId) : undefined
    if (!conn) throw new Error('daemon 已断开')
    if (machineId && !this.watches.has(machineId)) {
      this.watches.set(
        machineId,
        conn.onClose(() => {
          for (const terminal of this.streams.values()) terminal.disconnected()
        }),
      )
    }
    let terminal!: DaemonTerminal
    const stream = conn.terminal(
      { terminal: open, method: 'TERMINAL', path: '/', headers: [], upgrade: true },
      (frame) => terminal.frame({ type: frame.type, payload: frame.payload }),
      () => terminal.disconnected(),
    )
    terminal = new DaemonTerminal(stream, open.sessionId, this.onState, (sessionId) => this.streams.delete(sessionId))
    this.streams.set(open.sessionId, terminal)
    return terminal
  }

  async terminate(sessionId: string, _reason: 'user' | 'revoked') {
    const terminal = this.streams.get(sessionId)
    if (!terminal) throw new Error('终端不在线')
    const confirmation = (async () => {
      await terminal.send(TUNNEL_FRAME.head, Buffer.from(JSON.stringify({ op: 'terminate', sessionId })))
      await terminal.termination
    })()
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        confirmation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('终止终端超时')), 10_000)
        }),
      ])
    } catch (error) {
      terminal.detach('terminate failed')
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
