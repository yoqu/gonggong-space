import { Duplex } from 'node:stream'
import {
  decodeFrame,
  encodeFrame,
  TUNNEL_FRAME,
  TUNNEL_MAX_STREAMS,
  TUNNEL_STREAM_BUFFER,
  type TunnelFrameType,
  TunnelHead,
  type TunnelOpen,
  TunnelReset,
} from '@gonggong/protocol'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'

/** Each machine's preview tunnel (plan P2), next to its control connection in DaemonHub. */
export class TunnelHub {
  private conns = new Map<string, TunnelConn>()

  register(machineId: string, conn: TunnelConn) {
    this.conns.get(machineId)?.close()
    this.conns.set(machineId, conn)
  }

  unregister(machineId: string, conn: TunnelConn) {
    if (this.conns.get(machineId) === conn) this.conns.delete(machineId)
  }

  get(machineId: string) {
    return this.conns.get(machineId)
  }
}

export class TunnelConn {
  private next = 1
  private streams = new Map<number, TunnelStream>()

  constructor(private ws: WebSocket) {
    ws.on('message', (raw: Buffer, isBinary) => {
      if (isBinary) this.onFrame(raw)
    })
    ws.on('close', () => {
      for (const s of [...this.streams.values()]) s.fail('daemon 已断开')
    })
  }

  /** Starts a request (or upgrade) on the daemon; write the request body, then end(). */
  open(open: TunnelOpen) {
    if (this.streams.size >= TUNNEL_MAX_STREAMS) throw new Error('too many preview streams on this machine')
    const id = this.next
    this.next = this.next >= 0xffff_fffd ? 1 : this.next + 2
    const s = new TunnelStream(this, id)
    this.streams.set(id, s)
    void this.send(id, TUNNEL_FRAME.open, Buffer.from(JSON.stringify(open))).catch((err) =>
      s.fail(err.message),
    )
    return s
  }

  /** Resolves once the socket took the frame: writers wait on it (backpressure). */
  send(id: number, type: TunnelFrameType, payload: Uint8Array = new Uint8Array()) {
    return new Promise<void>((resolve, reject) =>
      this.ws.send(encodeFrame(id, type, payload), (err) => (err ? reject(err) : resolve())),
    )
  }

  forget(id: number) {
    this.streams.delete(id)
  }

  close() {
    this.ws.close()
  }

  private onFrame(raw: Buffer) {
    let f: ReturnType<typeof decodeFrame>
    try {
      f = decodeFrame(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
    } catch {
      return
    }
    const s = this.streams.get(f.streamId)
    if (!s) return
    const json = () => JSON.parse(Buffer.from(f.payload).toString())
    if (f.type === TUNNEL_FRAME.head) s.onHead(TunnelHead.parse(json()))
    else if (f.type === TUNNEL_FRAME.data) s.receive(Buffer.from(f.payload))
    else if (f.type === TUNNEL_FRAME.end) s.onEnd()
    else if (f.type === TUNNEL_FRAME.reset) s.fail(TunnelReset.parse(json()).reason)
  }
}

/** One request through the tunnel: writable = request body (or raw bytes after 101), readable = response body. */
export class TunnelStream extends Duplex {
  readonly head: Promise<TunnelHead>
  private settle!: { resolve: (h: TunnelHead) => void; reject: (e: Error) => void }
  private remoteEnded = false
  private localEnded = false
  private done = false

  constructor(
    private conn: TunnelConn,
    readonly id: number,
  ) {
    super()
    this.head = new Promise((resolve, reject) => {
      this.settle = { resolve, reject }
    })
    this.head.catch(() => {})
  }

  override _read() {}

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.conn.send(this.id, TUNNEL_FRAME.data, chunk).then(() => cb(), cb)
  }

  override _final(cb: (err?: Error | null) => void) {
    this.conn.send(this.id, TUNNEL_FRAME.end).then(() => {
      this.localEnded = true
      this.finish()
      cb()
    }, cb)
  }

  override _destroy(err: Error | null, cb: (err?: Error | null) => void) {
    if (!this.done) {
      this.done = true
      this.conn.forget(this.id)
      const reason = err?.message ?? '已取消'
      this.conn.send(this.id, TUNNEL_FRAME.reset, Buffer.from(JSON.stringify({ reason }))).catch(() => {})
      this.settle.reject(err ?? new Error(reason))
    }
    cb(err)
  }

  onHead(head: TunnelHead) {
    this.settle.resolve(head)
  }

  /** The daemon can't be paused per stream, so a reader that falls too far behind loses the stream instead. */
  receive(chunk: Buffer) {
    if (!this.push(chunk) && this.readableLength > TUNNEL_STREAM_BUFFER)
      this.destroy(new Error('预览接收过慢，已断开'))
  }

  onEnd() {
    this.remoteEnded = true
    this.push(null)
    this.finish()
  }

  /** The daemon reset it or went away: nothing is sent back. */
  fail(reason: string) {
    const err = new Error(reason)
    this.done = true
    this.conn.forget(this.id)
    this.settle.reject(err)
    this.destroy(err)
  }

  private finish() {
    if (!this.remoteEnded || !this.localEnded || this.done) return
    this.done = true
    this.conn.forget(this.id)
  }
}

export function tunnelGateway(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const machines = new WeakMap<FastifyRequest, string>()
    app.get(
      '/ws/daemon/tunnel',
      {
        websocket: true,
        preValidation: async (req) => {
          machines.set(req, (await requireMachine(ctx, req)).id)
        },
      },
      (ws, req) => {
        const machineId = machines.get(req)
        if (!machineId) return ws.close()
        const conn = new TunnelConn(ws)
        ctx.tunnels.register(machineId, conn)
        ws.on('close', () => ctx.tunnels.unregister(machineId, conn))
      },
    )
  }
}
