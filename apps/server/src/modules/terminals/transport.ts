import {
  TERMINAL_MAX_BUFFERED_BYTES,
  TerminalClientControl,
  TerminalDaemonControl,
  TerminalHead,
  type TerminalOpen,
  type TerminalStatus as TerminalStatusSchema,
  TUNNEL_FRAME,
  type TunnelFrameType,
  TunnelReset,
} from '@gonggong/protocol'
import type { WebSocket } from 'ws'
import { z } from 'zod'

export const TERMINAL_MAX_DATA_BYTES = 64 * 1024
export const TERMINAL_MAX_CONTROL_BYTES = 4 * 1024

const DAEMON_FRAME_BYTES = 96 * 1024
type TerminalStatus = z.infer<typeof TerminalStatusSchema>
const DaemonData = z.object({
  sessionId: z.string().uuid(),
  seq: z.number().int().positive(),
  data: z.string(),
})
const DaemonHead = z.union([TerminalHead, TerminalDaemonControl])

export type TerminalAttachment = TerminalDaemonStream
export type TerminalTarget = { sessionId: string; groupId: string; botId: string; machineId: string }

export interface TerminalSessions {
  attach(open: TerminalOpen, machineId: string): Promise<TerminalAttachment>
  terminate(target: TerminalTarget): Promise<void>
}

export type TerminalDaemonDisconnect = 'daemon_disconnected'
export type TerminalDaemonFrame = { type: TunnelFrameType; payload: Uint8Array }

/** One viewer's stream on the machine tunnel; frames arriving before subscribe() are held for it. */
export interface TerminalDaemonStream {
  send(type: TunnelFrameType, payload?: Uint8Array): Promise<void>
  subscribe(
    onFrame: (frame: TerminalDaemonFrame) => void,
    onDisconnect: (reason: TerminalDaemonDisconnect) => void,
  ): void
  close(reason: string): void
}

const json = (value: unknown) => JSON.stringify(value)
const bytes = (value: Uint8Array) => Buffer.from(value.buffer, value.byteOffset, value.byteLength)

function decodeBase64(value: string) {
  if (value.length > Math.ceil(TERMINAL_MAX_DATA_BYTES / 3) * 4) throw new Error('terminal data too big')
  const data = Buffer.from(value, 'base64')
  if (data.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new Error('terminal data is not base64')
  }
  if (data.byteLength > TERMINAL_MAX_DATA_BYTES) throw new Error('terminal data too big')
  return data
}

/**
 * Pipes one browser socket to one daemon stream. It never buffers: a browser that falls behind is reset and
 * reattaches with its last seq, which the daemon replays from its retained output.
 */
export class TerminalRelay {
  private status: TerminalStatus = 'running'
  private last: number
  private closed = false

  constructor(
    private ws: WebSocket,
    private daemon: TerminalDaemonStream,
    private sessionId: string,
    after: number,
    private maxBuffered = TERMINAL_MAX_BUFFERED_BYTES,
  ) {
    this.last = after
    ws.on('message', (raw, isBinary) => this.onBrowserMessage(raw, isBinary))
    ws.on('close', () => this.close('browser detached'))
    ws.on('error', () => this.close('browser detached'))
    daemon.subscribe(
      (frame) => this.onDaemonFrame(frame),
      (reason) => this.reset(reason, 1013),
    )
  }

  private close(reason: string) {
    if (this.closed) return
    this.closed = true
    this.daemon.close(reason)
  }

  private onBrowserMessage(raw: unknown, isBinary: boolean) {
    if (this.closed) return
    const data = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw as ArrayBuffer)
    if (data.byteLength > (isBinary ? TERMINAL_MAX_DATA_BYTES : TERMINAL_MAX_CONTROL_BYTES)) {
      this.reset('message_too_big', 1009)
      return
    }
    if (isBinary) {
      this.toDaemon(TUNNEL_FRAME.data, data)
      return
    }
    let control: TerminalClientControl
    try {
      control = TerminalClientControl.parse(JSON.parse(data.toString()))
      if (control.sessionId !== this.sessionId) throw new Error('wrong terminal session')
    } catch {
      this.reset('invalid_control', 1008)
      return
    }
    this.toDaemon(TUNNEL_FRAME.head, Buffer.from(json(control)))
  }

  private toDaemon(type: TunnelFrameType, payload: Buffer) {
    this.daemon.send(type, payload).catch(() => this.reset('daemon_write', 1011))
  }

  private onDaemonFrame(frame: TerminalDaemonFrame) {
    if (this.closed) return
    try {
      if (frame.payload.byteLength > DAEMON_FRAME_BYTES) throw new Error('daemon frame too big')
      if (frame.type === TUNNEL_FRAME.data) {
        const data = DaemonData.parse(JSON.parse(bytes(frame.payload).toString()))
        if (data.sessionId !== this.sessionId) throw new Error('wrong terminal session')
        this.onData(data.seq, decodeBase64(data.data))
      } else if (frame.type === TUNNEL_FRAME.head) {
        const control = DaemonHead.parse(JSON.parse(bytes(frame.payload).toString()))
        if (control.sessionId !== this.sessionId) throw new Error('wrong terminal session')
        this.onHead(control)
      } else if (frame.type === TUNNEL_FRAME.end) {
        this.reset('daemon_detached', 1013)
      } else if (frame.type === TUNNEL_FRAME.reset) {
        this.reset(
          'daemon_reset',
          1011,
          TunnelReset.parse(JSON.parse(bytes(frame.payload).toString())).reason,
        )
      } else {
        throw new Error('unexpected terminal frame')
      }
    } catch {
      this.reset('protocol_error', 1008)
    }
  }

  private onData(seq: number, data: Buffer) {
    if (seq <= this.last) return
    if (this.ws.bufferedAmount > this.maxBuffered) {
      this.reset('slow_client', 1013)
      return
    }
    this.last = seq
    const packet = Buffer.allocUnsafe(data.byteLength + 4)
    packet.writeUInt32BE(seq, 0)
    data.copy(packet, 4)
    this.ws.send(packet, { binary: true })
  }

  private onHead(control: z.infer<typeof DaemonHead>) {
    this.status = 'status' in control ? control.status : control.state
    if (this.status === 'running') {
      this.ws.send(json(control), { binary: false })
      return
    }
    this.close('terminal ended')
    this.ws.send(json(control), { binary: false }, () => this.ws.close(1000, this.status))
  }

  private reset(code: string, closeCode: number, reason?: string) {
    if (this.closed) return
    this.close(code)
    const message = { op: 'reset', code, status: this.status, ...(reason ? { reason } : {}) }
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(json(message), { binary: false }, () => this.ws.close(closeCode, code.slice(0, 120)))
    }
  }
}
