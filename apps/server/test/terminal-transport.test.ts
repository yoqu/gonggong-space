import {
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
  TerminalRelay,
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
  private frameListener?: (frame: { type: TunnelFrameType; payload: Uint8Array }) => void
  private disconnectListener?: (reason: TerminalDaemonDisconnect) => void

  get attached() {
    return !!this.frameListener
  }

  async send(type: TunnelFrameType, payload: Uint8Array = new Uint8Array()) {
    this.sent.push({ type, payload: Buffer.from(payload) })
  }

  subscribe(
    onFrame: (frame: { type: TunnelFrameType; payload: Uint8Array }) => void,
    onDisconnect: (reason: TerminalDaemonDisconnect) => void,
  ) {
    this.frameListener = onFrame
    this.disconnectListener = onDisconnect
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

describe('terminal relay', () => {
  let server: WebSocketServer
  let url: string
  const sockets = new Set<WebSocket>()

  beforeEach(async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || !address) throw new Error('missing test address')
    url = `ws://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    for (const ws of sockets) ws.terminate()
    sockets.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function connect(daemon: FakeDaemon, options: { after?: number; maxBufferedBytes?: number } = {}) {
    const serverSocket = new Promise<WebSocket>((resolve) =>
      server.once('connection', (ws) => {
        new TerminalRelay(ws, daemon, sessionId, options.after ?? 0, options.maxBufferedBytes)
        resolve(ws)
      }),
    )
    const ws = new WebSocket(url)
    sockets.add(ws)
    const messages = inbox(ws)
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    await new Promise<void>((resolve) => ws.once('open', resolve))
    await vi.waitFor(() => expect(daemon.attached).toBe(true))
    return { ws, messages, closed, serverSocket: await serverSocket }
  }

  it('relays output after the cursor and binary input and controls in order', async () => {
    const daemon = new FakeDaemon()
    const { ws, messages } = await connect(daemon, { after: 4 })

    daemon.emitHead({ next: 5 })
    expect(await messages.json()).toEqual(head({ next: 5 }))
    daemon.emitData(4, 'already seen')
    daemon.emitData(5, 'a')
    daemon.emitData(6, 'b')
    expect(await messages.bytes()).toEqual({ seq: 5, data: Buffer.from('a') })
    expect(await messages.bytes()).toEqual({ seq: 6, data: Buffer.from('b') })

    ws.send(Buffer.from([0, 4, 255]))
    ws.send(JSON.stringify({ op: 'resize', sessionId, cols: 120, rows: 32 }))
    ws.send(Buffer.from('cd'))
    ws.send(JSON.stringify({ op: 'terminate', sessionId }))
    await vi.waitFor(() => expect(daemon.sent).toHaveLength(4))
    expect(daemon.sent[0]).toEqual({ type: TUNNEL_FRAME.data, payload: Buffer.from([0, 4, 255]) })
    expect(daemon.sent[1]?.type).toBe(TUNNEL_FRAME.head)
    expect(JSON.parse(String(daemon.sent[1]!.payload))).toEqual({
      op: 'resize',
      sessionId,
      cols: 120,
      rows: 32,
    })
    expect(daemon.sent[2]).toEqual({ type: TUNNEL_FRAME.data, payload: Buffer.from('cd') })
    expect(JSON.parse(String(daemon.sent[3]!.payload))).toEqual({ op: 'terminate', sessionId })
  })

  it('passes a gap in a stale cursor through so the browser can redraw from retained output', async () => {
    const daemon = new FakeDaemon()
    const { messages } = await connect(daemon, { after: 4 })
    daemon.emitHead({ next: 40 })
    await messages.json()
    daemon.emitData(30, 'oldest retained')
    expect(await messages.bytes()).toEqual({ seq: 30, data: Buffer.from('oldest retained') })
  })

  it('resets a browser that stops reading instead of buffering its output', async () => {
    const daemon = new FakeDaemon()
    const { messages, closed, serverSocket } = await connect(daemon, { maxBufferedBytes: 64 })
    daemon.emitHead()
    await messages.json()
    Object.defineProperty(serverSocket, 'bufferedAmount', { get: () => 128 })

    daemon.emitData(1, 'lost to a slow browser')
    expect(await messages.json()).toMatchObject({ op: 'reset', code: 'slow_client' })
    expect(await closed).toBe(1013)
    expect(daemon.closeReasons).toEqual(['slow_client'])
  })

  it.each([
    ['not json', 'not json'],
    ['wrong session', JSON.stringify({ op: 'terminate', sessionId: otherSessionId })],
    ['unknown control', JSON.stringify({ op: 'execute', sessionId, command: 'whoami' })],
  ])('rejects invalid browser control: %s', async (_name, control) => {
    const daemon = new FakeDaemon()
    const { ws, messages, closed } = await connect(daemon)
    ws.send(control)
    expect((await messages.json()).code).toBe('invalid_control')
    expect(await closed).toBe(1008)
    expect(daemon.sent).toHaveLength(0)
    expect(daemon.closeReasons).toHaveLength(1)
  })

  it('rejects oversized input and malformed daemon frames explicitly', async () => {
    const daemon = new FakeDaemon()
    const first = await connect(daemon)
    first.ws.send(Buffer.alloc(64 * 1024 + 1))
    expect((await first.messages.json()).code).toBe('message_too_big')
    expect(await first.closed).toBe(1009)

    const secondDaemon = new FakeDaemon()
    const second = await connect(secondDaemon)
    secondDaemon.emit(TUNNEL_FRAME.head, '{bad json')
    expect((await second.messages.json()).code).toBe('protocol_error')
    expect(await second.closed).toBe(1008)
  })

  it('flushes output before reporting shell exit and closes normally', async () => {
    const daemon = new FakeDaemon()
    const { messages, closed } = await connect(daemon)
    daemon.emitHead()
    await messages.json()
    daemon.emitData(1, 'bye')
    daemon.emitControl({ op: 'exit', sessionId, state: 'exited', next: 2, exitCode: 0, reason: 'exited' })
    expect(await messages.bytes()).toEqual({ seq: 1, data: Buffer.from('bye') })
    expect(await messages.json()).toMatchObject({ op: 'exit', state: 'exited', exitCode: 0 })
    expect(await closed).toBe(1000)
    expect(daemon.closeReasons).toEqual(['terminal ended'])
  })

  it('reports an already ended session from its head', async () => {
    const daemon = new FakeDaemon()
    const { messages, closed } = await connect(daemon)
    daemon.emitHead({ status: 'closed', reason: 'user' })
    expect(await messages.json()).toMatchObject({ status: 'closed', reason: 'user' })
    expect(await closed).toBe(1000)
  })

  it.each([
    ['tunnel loss', (d: FakeDaemon) => d.disconnect('daemon_disconnected'), 'daemon_disconnected', 1013],
    [
      'viewer dropped by the daemon',
      (d: FakeDaemon) => d.emit(TUNNEL_FRAME.end, ''),
      'daemon_detached',
      1013,
    ],
    [
      'daemon reset',
      (d: FakeDaemon) => d.emit(TUNNEL_FRAME.reset, { reason: 'terminal_input_backlog' }),
      'daemon_reset',
      1011,
    ],
  ])('asks the browser to reconnect after %s', async (_name, trigger, code, closeCode) => {
    const daemon = new FakeDaemon()
    const { messages, closed } = await connect(daemon)
    daemon.emitHead()
    await messages.json()
    trigger(daemon)
    expect(await messages.json()).toMatchObject({ op: 'reset', code, status: 'running' })
    expect(await closed).toBe(closeCode)
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
})
