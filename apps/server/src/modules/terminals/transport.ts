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

export interface TerminalAttachment extends TerminalDaemonStream {}

export interface TerminalSessions {
  attach(open: TerminalOpen): Promise<TerminalAttachment>
  terminate(sessionId: string, reason: 'user' | 'revoked'): Promise<void>
}

export type TerminalDaemonDisconnect = 'daemon_disconnected' | 'daemon_changed'
export type TerminalDaemonFrame = { type: TunnelFrameType; payload: Uint8Array }

/** A terminal stream opened by TerminalService on the existing machine tunnel. */
export interface TerminalDaemonStream {
  send(type: TunnelFrameType, payload?: Uint8Array): Promise<void>
  subscribe(
    onFrame: (frame: TerminalDaemonFrame) => void,
    onDisconnect: (reason: TerminalDaemonDisconnect) => void,
  ): () => void
  pause(): void
  resume(): void
  close(reason: string): void
  detach(reason?: string): void
}

export type TerminalTransportOptions = {
  maxBufferedBytes?: number
  maxQueueBytes?: number
  drainIntervalMs?: number
}

type Attach = {
  owner(sessionId: string): Promise<void>
  attach(target: { sessionId: string; after: number }): Promise<TerminalDaemonStream>
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

export class TerminalTransport {
  constructor(
    private service: Attach,
    private options: TerminalTransportOptions = {},
  ) {}

  /** The route authenticates the browser cookie first; owner() repeats the ownership check at attach time. */
  async attach(ws: WebSocket, sessionId: string, after = 0) {
    if (!z.string().uuid().safeParse(sessionId).success || !Number.isSafeInteger(after) || after < 0) {
      ws.close(1008, 'invalid terminal attach')
      throw new Error('invalid terminal attach')
    }
    await this.service.owner(sessionId)
    const daemon = await this.service.attach({ sessionId, after })
    return new TerminalRelay(ws, daemon, sessionId, after, this.options)
  }
}

export class TerminalRelay {
  status: TerminalStatus = 'running'
  private nextSeq: number
  private after: number
  private pending = new Map<number, Buffer>()
  private pendingBytes = 0
  private input: Array<{ data: Buffer; type: TunnelFrameType }> = []
  private inputBytes = 0
  private inputWriting = false
  private inputPaused = false
  private daemonPaused = false
  private unsubscribe: () => void
  private drainTimer?: NodeJS.Timeout
  private drainWaiters = new Set<() => void>()
  private detached = false
  private ready = false
  private ending?: { control: unknown; next: number; status: TerminalStatus; notify?: () => void }
  private output = Promise.resolve()

  constructor(
    private ws: WebSocket,
    private daemon: TerminalDaemonStream,
    private sessionId: string,
    after: number,
    private options: TerminalTransportOptions,
  ) {
    this.nextSeq = after + 1
    this.after = after
    this.unsubscribe = daemon.subscribe(
      (frame) => this.onDaemonFrame(frame),
      (reason) => this.onDaemonDisconnect(reason),
    )
    ws.on('message', (raw, isBinary) => this.onBrowserMessage(raw, isBinary))
    ws.on('close', () => this.detach('browser detached'))
    ws.on('error', () => this.detach('browser detached'))
  }

  private get maxBuffered() {
    return this.options.maxBufferedBytes ?? TERMINAL_MAX_BUFFERED_BYTES
  }

  private get maxQueue() {
    return this.options.maxQueueBytes ?? TERMINAL_MAX_BUFFERED_BYTES
  }

  detach(reason = 'browser detached') {
    if (this.detached) return
    this.detached = true
    this.unsubscribe()
    this.daemon.detach(reason)
    if (this.drainTimer) clearInterval(this.drainTimer)
    this.drainTimer = undefined
    for (const release of this.drainWaiters) release()
    this.drainWaiters.clear()
  }

  private onBrowserMessage(raw: unknown, isBinary: boolean) {
    if (this.detached || this.ending) return
    const data = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw as ArrayBuffer)
    if (isBinary) {
      if (data.byteLength > TERMINAL_MAX_DATA_BYTES) {
        this.fail('message_too_big', 1009)
        return
      }
      this.input.push({ data, type: TUNNEL_FRAME.data })
      this.inputBytes += data.byteLength
      if (this.inputBytes >= this.maxQueue) {
        this.inputPaused = true
        this.ws.pause()
      }
      void this.flushInput()
      return
    }
    if (data.byteLength > TERMINAL_MAX_CONTROL_BYTES) {
      this.fail('message_too_big', 1009)
      return
    }
    try {
      const control = TerminalClientControl.parse(JSON.parse(data.toString()))
      if (control.sessionId !== this.sessionId) throw new Error('wrong terminal session')
      this.input.push({ data: Buffer.from(json(control)), type: TUNNEL_FRAME.head })
      this.inputBytes += data.byteLength
      if (this.inputBytes >= this.maxQueue) {
        this.inputPaused = true
        this.ws.pause()
      }
      void this.flushInput()
    } catch {
      this.fail('invalid_control', 1008)
    }
  }

  private async flushInput() {
    if (this.inputWriting || this.detached) return
    this.inputWriting = true
    try {
      while (this.input.length && !this.detached) {
        const next = this.input.shift()
        if (!next) break
        const { data, type } = next
        await this.daemon.send(type, data)
        this.inputBytes -= data.byteLength
      }
      if (this.inputPaused && this.inputBytes < this.maxQueue / 2 && !this.detached) {
        this.inputPaused = false
        this.ws.resume()
      }
    } catch {
      this.fail('daemon_write', 1011)
    } finally {
      this.inputWriting = false
      if (this.input.length && !this.detached) void this.flushInput()
    }
  }

  private onDaemonFrame(frame: TerminalDaemonFrame) {
    if (this.detached) return
    try {
      if (frame.payload.byteLength > DAEMON_FRAME_BYTES) throw new Error('daemon frame too big')
      if (frame.type === TUNNEL_FRAME.data) {
        const data = DaemonData.parse(JSON.parse(bytes(frame.payload).toString()))
        if (data.sessionId !== this.sessionId) throw new Error('wrong terminal session')
        this.onData(data.seq, decodeBase64(data.data))
      } else if (frame.type === TUNNEL_FRAME.head) {
        if (this.ending) return
        this.onHead(DaemonHead.parse(JSON.parse(bytes(frame.payload).toString())))
      } else if (frame.type === TUNNEL_FRAME.end) {
        this.reset('daemon_detached', 1013)
      } else if (frame.type === TUNNEL_FRAME.reset) {
        const reset = TunnelReset.parse(JSON.parse(bytes(frame.payload).toString()))
        this.reset('daemon_reset', 1011, reset.reason)
      } else {
        throw new Error('unexpected terminal frame')
      }
    } catch {
      this.fail('protocol_error', 1008)
    }
  }

  private onHead(control: z.infer<typeof DaemonHead>) {
    if (control.sessionId !== this.sessionId) throw new Error('wrong terminal session')
    if ('status' in control) {
      if (control.next < this.nextSeq - 1) {
        this.reset('replay_expired', 1013)
        return
      }
      this.nextSeq = this.after + 1
      if (control.status !== 'running') {
        this.onExit(control, Math.max(control.next, this.nextSeq), control.status)
        return
      }
      this.queueOutput(async () => {
        this.status = control.status
        await this.sendBrowser(Buffer.from(json(control)), false)
        this.ready = true
        await this.flushPending()
      })
      return
    }
    if (control.state !== 'running') {
      this.onExit(control, control.next, control.state)
      return
    }
    this.queueOutput(async () => {
      await this.flushPending()
      await this.waitForDrain()
      await this.sendBrowser(Buffer.from(json(control)), false)
    })
  }

  private onExit(control: z.infer<typeof DaemonHead>, next: number, status: TerminalStatus) {
    this.ending = { control, next, status }
    this.queueOutput(async () => {
      if (this.nextSeq < next || this.pending.size) {
        await new Promise<void>((resolve) => {
          if (this.ending) this.ending.notify = resolve
        })
      }
      await this.flushPending()
      await this.waitForDrain()
      this.status = status
      this.detach('terminal ended')
      await this.sendBrowser(Buffer.from(json(control)), false)
      this.ws.close(1000, status)
    })
  }

  private onData(seq: number, data: Buffer) {
    if (seq < this.nextSeq || this.pending.has(seq)) return
    if (this.ending && seq >= this.ending.next) return
    this.pending.set(seq, data)
    this.pendingBytes += data.byteLength
    if (this.pendingBytes >= this.maxQueue) this.pauseDaemon()
    if (this.ending) {
      if (this.nextSeq >= this.ending.next && !this.pending.size) this.ending.notify?.()
    } else if (this.ready) {
      this.queueOutput(() => this.flushPending())
    }
  }

  private queueOutput(write: () => Promise<void>) {
    this.output = this.output.then(async () => {
      if (this.detached) return
      try {
        await write()
      } catch {
        this.fail('browser_write', 1011)
      }
    })
  }

  private async flushPending() {
    while (!this.detached) {
      const data = this.pending.get(this.nextSeq)
      if (!data) break
      this.pending.delete(this.nextSeq)
      this.pendingBytes -= data.byteLength
      const packet = Buffer.allocUnsafe(data.byteLength + 4)
      packet.writeUInt32BE(this.nextSeq, 0)
      data.copy(packet, 4)
      await this.sendBrowser(packet, true)
      this.nextSeq++
      if (this.ws.bufferedAmount > this.maxBuffered) await this.waitForDrain()
    }
    if (this.pendingBytes < this.maxQueue / 2 && this.ws.bufferedAmount <= this.maxBuffered / 2) {
      this.resumeDaemon()
    }
    if (this.ending && this.nextSeq >= this.ending.next && !this.pending.size) this.ending.notify?.()
  }

  private sendBrowser(data: Buffer, binary: boolean) {
    return new Promise<void>((resolve, reject) => {
      if (this.ws.readyState !== this.ws.OPEN) {
        reject(new Error('browser is not open'))
        return
      }
      this.ws.send(data, { binary }, (error) => (error ? reject(error) : resolve()))
    })
  }

  private pauseDaemon() {
    if (this.daemonPaused || this.detached) return
    this.daemonPaused = true
    this.daemon.pause()
    this.watchDrain()
  }

  private resumeDaemon() {
    if (!this.daemonPaused || this.detached) return
    this.daemonPaused = false
    if (this.drainTimer) clearInterval(this.drainTimer)
    this.drainTimer = undefined
    this.daemon.resume()
    for (const release of this.drainWaiters) release()
    this.drainWaiters.clear()
  }

  private waitForDrain() {
    if (this.ws.bufferedAmount <= this.maxBuffered / 2 || this.detached) return Promise.resolve()
    this.pauseDaemon()
    return new Promise<void>((resolve) => this.drainWaiters.add(resolve))
  }

  private watchDrain() {
    if (this.drainTimer || this.detached) return
    this.drainTimer = setInterval(() => {
      if (this.detached) return
      if (this.ws.bufferedAmount <= this.maxBuffered / 2) this.resumeDaemon()
    }, this.options.drainIntervalMs ?? 10)
    this.drainTimer.unref()
  }

  private onDaemonDisconnect(reason: TerminalDaemonDisconnect) {
    this.reset(reason, 1013)
  }

  private fail(code: string, closeCode: number) {
    this.reset(code, closeCode)
  }

  private reset(code: string, closeCode: number, reason?: string) {
    if (this.detached) return
    this.detach(reason ?? code)
    const message = { op: 'reset', code, status: this.status, ...(reason ? { reason } : {}) }
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(json(message), { binary: false }, () => this.ws.close(closeCode, code.slice(0, 120)))
    }
  }
}
