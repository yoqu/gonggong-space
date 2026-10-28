import {
  TerminalDaemonControl,
  type TerminalEndReason,
  TerminalHead,
  type TerminalOpen,
  type TerminalStatus,
  TUNNEL_FRAME,
  type TunnelFrameType,
  TunnelReset,
} from '@gonggong/protocol'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import type {
  TerminalAttachment,
  TerminalDaemonDisconnect,
  TerminalDaemonFrame,
  TerminalSessions,
  TerminalTarget,
} from './transport.js'

type State = {
  status: z.infer<typeof TerminalStatus>
  exitCode: number | null
  reason: z.infer<typeof TerminalEndReason> | null
}
type Stream = {
  send(type: TunnelFrameType, payload?: Uint8Array): Promise<void>
  close(reason: string): void
}
type Listener = {
  onFrame: (frame: TerminalDaemonFrame) => void
  onDisconnect: (reason: TerminalDaemonDisconnect) => void
}

const TERMINATE_TIMEOUT_MS = 10_000
const DaemonHead = z.union([TerminalHead, TerminalDaemonControl])
const parse = <T>(schema: z.ZodType<T>, payload: Uint8Array) =>
  schema.parse(JSON.parse(Buffer.from(payload).toString()))
const stateOf = (head: z.infer<typeof DaemonHead>): State => ({
  status: 'status' in head ? head.status : head.state,
  exitCode: head.exitCode,
  reason: head.reason,
})

class DaemonTerminal implements TerminalAttachment {
  stream!: Stream
  private listener?: Listener
  private early: TerminalDaemonFrame[] = []
  private lost = false
  private started = false

  constructor(
    private open: TerminalOpen,
    private onState: (sessionId: string, state: State) => void,
  ) {}

  send(type: TunnelFrameType, payload?: Uint8Array) {
    return this.stream.send(type, payload)
  }

  subscribe(onFrame: Listener['onFrame'], onDisconnect: Listener['onDisconnect']) {
    this.listener = { onFrame, onDisconnect }
    for (const frame of this.early.splice(0)) onFrame(frame)
    if (this.lost) onDisconnect('daemon_disconnected')
  }

  close(reason: string) {
    this.listener = undefined
    this.stream.close(reason)
  }

  frame(frame: TerminalDaemonFrame) {
    this.track(frame)
    if (this.listener) this.listener.onFrame(frame)
    else this.early.push(frame)
  }

  disconnected() {
    this.lost = true
    this.listener?.onDisconnect('daemon_disconnected')
  }

  /** The service learns how a shell ended from the frames its viewers see; contents stay in the relay. */
  private track(frame: TerminalDaemonFrame) {
    try {
      if (frame.type === TUNNEL_FRAME.head) {
        this.started = true
        const state = stateOf(parse(DaemonHead, frame.payload))
        if (state.status !== 'running') this.onState(this.open.sessionId, state)
      } else if (frame.type === TUNNEL_FRAME.reset && !this.started) {
        const { reason } = parse(TunnelReset, frame.payload)
        if (reason === 'terminal_not_found')
          this.onState(this.open.sessionId, {
            status: 'daemon_restart',
            exitCode: null,
            reason: 'daemon_restart',
          })
        else if (this.open.action === 'create' && reason !== 'terminal_exists')
          this.onState(this.open.sessionId, { status: 'closed', exitCode: null, reason: 'error' })
      }
    } catch {
      // The relay rejects malformed frames itself.
    }
  }
}

export class TerminalDaemonTransport implements TerminalSessions {
  constructor(
    private ctx: Pick<Ctx, 'tunnels'>,
    private onState: (sessionId: string, state: State) => void,
  ) {}

  private stream(
    machineId: string,
    open: TerminalOpen,
    onFrame: (frame: TerminalDaemonFrame) => void,
    onClose: () => void,
  ): Stream {
    const conn = this.ctx.tunnels.get(machineId)
    if (!conn) throw new Error('daemon 已断开')
    return conn.terminal(
      { terminal: open, method: 'TERMINAL', path: '/', headers: [], upgrade: true },
      (frame) => onFrame({ type: frame.type, payload: frame.payload }),
      onClose,
    )
  }

  async attach(open: TerminalOpen, machineId: string): Promise<TerminalAttachment> {
    const terminal = new DaemonTerminal(open, this.onState)
    terminal.stream = this.stream(
      machineId,
      open,
      (frame) => terminal.frame(frame),
      () => terminal.disconnected(),
    )
    return terminal
  }

  /** Ends the shell on a stream of its own, so it works with no viewer attached; resolves on the daemon's exit head. */
  terminate({ sessionId, groupId, botId, machineId }: TerminalTarget) {
    return new Promise<void>((resolve, reject) => {
      const open: TerminalOpen = {
        action: 'terminate',
        sessionId,
        groupId,
        botId,
        workspace: { repo: null, cdPath: null },
        cols: 80,
        rows: 24,
        after: 0,
      }
      let timer: NodeJS.Timeout | undefined
      const settle = (error?: Error) => {
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      try {
        const stream = this.stream(
          machineId,
          open,
          (frame) => {
            try {
              if (frame.type === TUNNEL_FRAME.head) settle()
              else if (frame.type === TUNNEL_FRAME.reset)
                settle(new Error(parse(TunnelReset, frame.payload).reason))
            } catch (error) {
              settle(error as Error)
            }
          },
          () => settle(new Error('daemon 已断开')),
        )
        timer = setTimeout(() => {
          stream.close('terminate timeout')
          settle(new Error('终止终端超时'))
        }, TERMINATE_TIMEOUT_MS)
      } catch (error) {
        settle(error as Error)
      }
    })
  }
}
