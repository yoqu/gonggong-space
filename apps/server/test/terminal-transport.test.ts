import {
  TERMINAL_MAX_BUFFERED_BYTES,
  type TerminalDaemonControl,
  type TerminalHead,
  TUNNEL_FRAME,
  type TunnelFrameType,
} from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { type RawData, WebSocketServer } from 'ws'
import {
  type TerminalDaemonDisconnect,
  type TerminalDaemonStream,
  type TerminalRelay,
  TerminalTransport,
} from '../src/modules/terminals/transport.js'

const sessionId = '7ca45f50-93a2-4f7f-b0c1-ff1dd24ef731'
const otherSessionId = '2d067591-12a2-4f53-9c07-c8f40f2ceccb'
const now = new Date().toISOString()

const head = (override: Partial<TerminalHead> = {}): TerminalHead => ({
  sessionId,
  status: 'running',
  cols: 80,
  rows: 24,
  next: 1,
  createdAt: now,
  lastActiveAt: now,
  exitCode: null,
  reason: null,
  ...override,
})

type Sent = { type: TunnelFrameType; payload: Uint8Array }

class FakeDaemon implements TerminalDaemonStream {
  readonly sent: Sent[] = []
  readonly closeReasons: string[] = []
  pauseCount = 0
  resumeCount = 0
  blockSends = false
  sendCompleted = true
  private frameListener?: (frame: { type: TunnelFrameType; payload: Uint8Array }) => void
  private disconnectListener?: (reason: TerminalDaemonDisconnect) => void
  private sendGates: Array<() => void> = []

  get attached() {
    return !!this.frameListener
  }

  async send(type: TunnelFrameType, payload: Uint8Array = new Uint8Array()) {
    this.sent.push({ type, payload: Buffer.from(payload) })
    this.sendCompleted = false
    if (this.blockSends) await new Promise<void>((resolve) => this.sendGates.push(resolve))
    this.sendCompleted = true
  }

  detach(reason = 'browser detached') {
    this.close(reason)
  }

  releaseOne() {
    this.sendGates.shift()?.()
  }

  subscribe(
    onFrame: (frame: { type: TunnelFrameType; payload: Uint8Array }) => void,
    onDisconnect: (reason: TerminalDaemonDisconnect) => void,
  ) {
    this.frameListener = onFrame
    this.disconnectListener = onDisconnect
    return () => {
      this.frameListener = undefined
      this.disconnectListener = undefined
    }
  }

  pause() {
    this.pauseCount++
  }

  resume() {
    this.resumeCount++
  }

  close(reason: string) {
    this.closeReasons.push(reason)
  }

  emit(type: TunnelFrameType, value: unknown) {
    this.frameListener?.({
      type,
      payload: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
    })
  }

  emitHead(value: Partial<TerminalHead> = {}) {
    this.emit(TUNNEL_FRAME.head, head(value))
  }

  emitData(seq: number, data: string) {
    this.emit(TUNNEL_FRAME.data, { sessionId, seq, data: Buffer.from(data).toString('base64') })
  }

  emitControl(value: TerminalDaemonControl) {
    this.emit(TUNNEL_FRAME.head, value)
  }

  disconnect(reason: TerminalDaemonDisconnect) {
    this.disconnectListener?.(reason)
  }
}

function inbox(ws: WebSocket) {
  const messages: Array<{ data: RawData; binary: boolean }> = []
  const waiting: Array<() => void> = []
  ws.on('message', (data, binary) => {
    messages.push({ data, binary })
    waiting.shift()?.()
  })
  return {
    messages,
    async next() {
      if (!messages.length) await new Promise<void>((resolve) => waiting.push(resolve))
      return messages.shift()!
    },
    async json() {
      const msg = await this.next()
      expect(msg.binary).toBe(false)
      return JSON.parse(String(msg.data))
    },
    async bytes() {
      const msg = await this.next()
      expect(msg.binary).toBe(true)
      const bytes = Buffer.from(msg.data as Buffer)
      return { seq: bytes.readUInt32BE(0), data: bytes.subarray(4) }
    },
  }
}

describe('terminal transport', () => {
  let server: WebSocketServer
  let url: string
  let transport: TerminalTransport
  let relay: TerminalRelay | undefined
  const sockets = new Set<WebSocket>()

  beforeEach(async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || !address) throw new Error('missing test address')
    url = `ws://127.0.0.1:${address.port}`
    server.on('connection', (ws, req) => {
      const params = new URL(req.url!, url).searchParams
      void transport
        .attach(ws, sessionId, Number(params.get('after') ?? 0))
        .then((r) => {
          relay = r
        })
        .catch(() => ws.close(1011, 'attach failed'))
    })
  })

  afterEach(async () => {
    relay?.detach('shutdown')
    for (const ws of sockets) ws.terminate()
    sockets.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function connect(
    daemon: FakeDaemon,
    options: { after?: number; maxBufferedBytes?: number; maxQueueBytes?: number } = {},
  ) {
    const owner = vi.fn(async () => {})
    const attach = vi.fn(async () => daemon)
    transport = new TerminalTransport(
      { owner, attach },
      {
        maxBufferedBytes: options.maxBufferedBytes ?? 1024,
        maxQueueBytes: options.maxQueueBytes ?? 1024,
        drainIntervalMs: 2,
      },
    )
    const ws = new WebSocket(`${url}/?after=${options.after ?? 0}`)
    sockets.add(ws)
    const messages = inbox(ws)
    const serverSocket = new Promise<WebSocket>((resolve) => server.once('connection', resolve))
    await new Promise<void>((resolve) => ws.once('open', resolve))
    await vi.waitFor(() => expect(daemon.attached).toBe(true))
    return { ws, messages, owner, attach, serverSocket: await serverSocket }
  }

  it('attaches with after, orders replayed data, and relays binary input and controls', async () => {
    const daemon = new FakeDaemon()
    const { ws, messages, owner, attach } = await connect(daemon, { after: 4 })
    expect(owner).toHaveBeenCalledWith(sessionId)
    expect(attach).toHaveBeenCalledWith({ sessionId, after: 4 })

    daemon.emitHead({ next: 5 })
    expect(await messages.json()).toEqual(head({ next: 5 }))
    daemon.emitData(6, 'b')
    daemon.emitData(5, 'a')
    expect(await messages.bytes()).toEqual({ seq: 5, data: Buffer.from('a') })
    expect(await messages.bytes()).toEqual({ seq: 6, data: Buffer.from('b') })
    daemon.emitData(5, 'duplicate')
    daemon.emitData(8, 'd')
    daemon.emitData(7, 'c')
    expect(await messages.bytes()).toEqual({ seq: 7, data: Buffer.from('c') })
    expect(await messages.bytes()).toEqual({ seq: 8, data: Buffer.from('d') })

    ws.send(Buffer.from([0, 4, 255]))
    ws.send(JSON.stringify({ op: 'resize', sessionId, cols: 120, rows: 32 }))
    ws.send(JSON.stringify({ op: 'terminate', sessionId }))
    await vi.waitFor(() => expect(daemon.sent).toHaveLength(3))
    expect(daemon.sent[0]).toEqual({ type: TUNNEL_FRAME.data, payload: Buffer.from([0, 4, 255]) })
    expect(JSON.parse(String(daemon.sent[1]!.payload))).toEqual({
      op: 'resize',
      sessionId,
      cols: 120,
      rows: 32,
    })
    expect(JSON.parse(String(daemon.sent[2]!.payload))).toEqual({ op: 'terminate', sessionId })
  })

  it('bounds and serializes daemon writes while applying backpressure to the browser', async () => {
    const daemon = new FakeDaemon()
    daemon.blockSends = true
    const { ws, serverSocket } = await connect(daemon, { maxQueueBytes: 64 })
    daemon.emitHead()
    const chunks = [
      Buffer.from('a'.repeat(16)),
      Buffer.from('b'.repeat(16)),
      Buffer.from('c'.repeat(16)),
      Buffer.from('d'.repeat(16)),
    ]
    ws.send(chunks[0]!)
    await vi.waitFor(() => expect(daemon.sent).toHaveLength(1))
    for (const chunk of chunks.slice(1)) ws.send(chunk)

    await vi.waitFor(() => expect(serverSocket.isPaused).toBe(true))
    expect(daemon.sent).toHaveLength(1)
    for (let i = 1; i < chunks.length; i++) {
      daemon.releaseOne()
      await vi.waitFor(() => expect(daemon.sent).toHaveLength(i + 1))
    }
    daemon.releaseOne()
    await vi.waitFor(() => expect(serverSocket.isPaused).toBe(false))
    expect(daemon.sent.map((f) => Buffer.from(f.payload).toString())).toEqual(chunks.map((c) => c.toString()))
    expect(daemon.sent.every((f) => f.type === TUNNEL_FRAME.data)).toBe(true)
  })

  it('holds replay data until its head establishes the after cursor', async () => {
    const daemon = new FakeDaemon()
    const { messages } = await connect(daemon, { after: 8 })
    daemon.emitData(10, 'b')
    daemon.emitData(9, 'a')
    expect(messages.messages).toHaveLength(0)
    daemon.emitHead({ next: 9 })
    expect(await messages.json()).toMatchObject({ next: 9 })
    expect(await messages.bytes()).toEqual({ seq: 9, data: Buffer.from('a') })
    expect(await messages.bytes()).toEqual({ seq: 10, data: Buffer.from('b') })
  })

  it('reports replay_expired when the daemon cannot resume at after', async () => {
    const daemon = new FakeDaemon()
    const { ws, messages } = await connect(daemon, { after: 20 })
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    daemon.emitHead({ next: 5 })
    expect((await messages.json()).code).toBe('replay_expired')
    expect(await closed).toBe(1013)
    expect(daemon.sent).toHaveLength(0)
  })

  it('preserves interleaved keyboard data and small head controls', async () => {
    const daemon = new FakeDaemon()
    const { ws } = await connect(daemon, { maxQueueBytes: 8 })
    ws.send(Buffer.from('ab'))
    ws.send(JSON.stringify({ op: 'resize', sessionId, cols: 100, rows: 30 }))
    ws.send(Buffer.from('cd'))
    await vi.waitFor(() => expect(daemon.sent).toHaveLength(3))
    expect(daemon.sent[0]).toEqual({ type: TUNNEL_FRAME.data, payload: Buffer.from('ab') })
    expect(daemon.sent[1]?.type).toBe(TUNNEL_FRAME.head)
    expect(daemon.sent[2]).toEqual({ type: TUNNEL_FRAME.data, payload: Buffer.from('cd') })
  })

  it('pauses daemon output while the browser is above budget and resumes without losing bytes', async () => {
    const daemon = new FakeDaemon()
    const { messages, serverSocket } = await connect(daemon, { maxBufferedBytes: 64, maxQueueBytes: 1024 })
    daemon.emitHead()
    await messages.json()
    let buffered = 0
    Object.defineProperty(serverSocket, 'bufferedAmount', { get: () => buffered })

    buffered = 128
    await vi.waitFor(() => expect(serverSocket.bufferedAmount).toBe(128))
    daemon.emitData(1, 'first')
    expect(await messages.bytes()).toEqual({ seq: 1, data: Buffer.from('first') })
    await vi.waitFor(() => expect(daemon.pauseCount).toBe(1))
    daemon.emitData(2, 'second')
    expect(messages.messages).toHaveLength(0)

    buffered = 0
    expect(await messages.bytes()).toEqual({ seq: 2, data: Buffer.from('second') })
    await vi.waitFor(() => expect(daemon.resumeCount).toBe(1))
    expect(relay?.status).toBe('running')
  })

  it.each([
    ['not json', 'not json'],
    ['wrong session', JSON.stringify({ op: 'terminate', sessionId: otherSessionId })],
    ['unknown control', JSON.stringify({ op: 'execute', sessionId, command: 'whoami' })],
  ])('rejects invalid browser control: %s', async (_name, control) => {
    const daemon = new FakeDaemon()
    const { ws, messages } = await connect(daemon)
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    ws.send(control)
    expect((await messages.json()).code).toBe('invalid_control')
    expect(await closed).toBe(1008)
    expect(daemon.sent).toHaveLength(0)
    expect(daemon.closeReasons).toHaveLength(1)
  })

  it('rejects oversized input and malformed daemon controls explicitly', async () => {
    const daemon = new FakeDaemon()
    const first = await connect(daemon, { maxQueueBytes: 1024 })
    const firstClosed = new Promise<number>((resolve) => first.ws.once('close', resolve))
    first.ws.send(Buffer.alloc(64 * 1024 + 1))
    expect((await first.messages.json()).code).toBe('message_too_big')
    expect(await firstClosed).toBe(1009)

    const secondDaemon = new FakeDaemon()
    const second = await connect(secondDaemon)
    const secondClosed = new Promise<number>((resolve) => second.ws.once('close', resolve))
    secondDaemon.emit(TUNNEL_FRAME.head, '{bad json')
    expect((await second.messages.json()).code).toBe('protocol_error')
    expect(await secondClosed).toBe(1008)
  })

  it('flushes ordered output before reporting shell exit', async () => {
    const daemon = new FakeDaemon()
    const { ws, messages } = await connect(daemon)
    daemon.emitHead()
    await messages.json()
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    daemon.emitData(2, 'b')
    daemon.emitControl({
      op: 'exit',
      sessionId,
      state: 'exited',
      next: 3,
      exitCode: 0,
      reason: 'exited',
    })
    daemon.emitData(1, 'a')
    expect(await messages.bytes()).toEqual({ seq: 1, data: Buffer.from('a') })
    expect(await messages.bytes()).toEqual({ seq: 2, data: Buffer.from('b') })
    expect(await messages.json()).toMatchObject({ op: 'exit', state: 'exited', exitCode: 0 })
    expect(await closed).toBe(1000)
    expect(relay?.status).toBe('exited')
  })

  it('distinguishes a daemon replacement from shell termination', async () => {
    const daemon = new FakeDaemon()
    const { ws, messages } = await connect(daemon)
    daemon.emitHead()
    await messages.json()
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    daemon.disconnect('daemon_changed')
    expect(await messages.json()).toMatchObject({ op: 'reset', code: 'daemon_changed', status: 'running' })
    expect(await closed).toBe(1013)
    expect(daemon.sent.some((f) => f.type === TUNNEL_FRAME.head)).toBe(false)
  })

  it('detaches the daemon stream without terminating the shell when the browser closes', async () => {
    const daemon = new FakeDaemon()
    const { ws } = await connect(daemon)
    daemon.emitHead()
    ws.close()
    await vi.waitFor(() => expect(daemon.closeReasons).toEqual(['browser detached']))
    expect(daemon.sent).toHaveLength(0)
  })

  it('uses the configured terminal byte budget by default', () => {
    const daemon = new FakeDaemon()
    transport = new TerminalTransport({ owner: async () => {}, attach: async () => daemon })
    expect(TERMINAL_MAX_BUFFERED_BYTES).toBe(4 * 1024 * 1024)
  })
})
