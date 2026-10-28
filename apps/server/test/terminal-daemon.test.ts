import { randomUUID } from 'node:crypto'
import { type TerminalOpen, TUNNEL_FRAME, type TunnelFrameType } from '@gonggong/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { Ctx } from '../src/context.js'
import { TerminalDaemonTransport } from '../src/modules/terminals/daemon.js'

const sessionId = randomUUID()
const machineId = randomUUID()
const groupId = randomUUID()
const botId = randomUUID()
const now = new Date().toISOString()

const open: TerminalOpen = {
  action: 'attach',
  sessionId,
  groupId,
  botId,
  workspace: { repo: null, cdPath: null },
  cols: 80,
  rows: 24,
  after: 0,
}
const head = {
  sessionId,
  status: 'running',
  cols: 80,
  rows: 24,
  next: 1,
  createdAt: now,
  lastActiveAt: now,
  exitCode: null,
  reason: null,
}

type Frame = { streamId: number; type: TunnelFrameType; payload: Uint8Array }

class FakeStream {
  sent: Array<{ type: TunnelFrameType; payload: Uint8Array }> = []
  closeReasons: string[] = []
  constructor(
    readonly request: { terminal: TerminalOpen },
    readonly emit: (frame: Frame) => void,
    readonly drop: () => void,
  ) {}

  async send(type: TunnelFrameType, payload: Uint8Array = new Uint8Array()) {
    this.sent.push({ type, payload })
  }

  close(reason: string) {
    this.closeReasons.push(reason)
  }

  json(type: TunnelFrameType, value: unknown) {
    this.emit({ streamId: 1, type, payload: Buffer.from(JSON.stringify(value)) })
  }
}

function fixture(onOpen?: (stream: FakeStream) => void) {
  const streams: FakeStream[] = []
  const machines = new Map<string, unknown>()
  machines.set(machineId, {
    terminal(request: { terminal: TerminalOpen }, onFrame: (frame: Frame) => void, onClose: () => void) {
      const stream = new FakeStream(request, onFrame, onClose)
      streams.push(stream)
      if (onOpen) queueMicrotask(() => onOpen(stream))
      return stream
    },
  })
  const ctx = { tunnels: { get: (id: string) => machines.get(id) } } as unknown as Ctx
  const states: Array<{ sessionId: string; status: string; exitCode: number | null; reason: string | null }> =
    []
  const transport = new TerminalDaemonTransport(ctx, (id, state) => states.push({ sessionId: id, ...state }))
  return { transport, streams, states, latest: () => streams.at(-1)! }
}

const target = { sessionId, groupId, botId, machineId }

describe('terminal daemon transport', () => {
  it('buffers head, replay and a fast exit until the relay subscribes', async () => {
    const { transport, states } = fixture((stream) => {
      stream.json(TUNNEL_FRAME.head, head)
      stream.json(TUNNEL_FRAME.data, { sessionId, seq: 1, data: Buffer.from('replay').toString('base64') })
      stream.json(TUNNEL_FRAME.head, { ...head, status: 'exited', next: 2, exitCode: 0, reason: 'exited' })
    })
    const attachment = await transport.attach(open, machineId)
    await Promise.resolve()
    const frames: unknown[] = []
    attachment.subscribe(
      (frame) => frames.push(JSON.parse(String(frame.payload))),
      () => {},
    )

    expect(frames).toEqual([
      head,
      { sessionId, seq: 1, data: Buffer.from('replay').toString('base64') },
      expect.objectContaining({ status: 'exited', exitCode: 0 }),
    ])
    expect(states).toEqual([{ sessionId, status: 'exited', exitCode: 0, reason: 'exited' }])
  })

  it('opens the stream on the session machine and reports a tunnel loss to the relay', async () => {
    const { transport, latest } = fixture()
    const attachment = await transport.attach(open, machineId)
    expect(latest().request.terminal).toEqual(open)
    const lost = vi.fn()
    attachment.subscribe(() => {}, lost)
    latest().drop()
    expect(lost).toHaveBeenCalledWith('daemon_disconnected')
    await expect(transport.attach(open, randomUUID())).rejects.toThrow('daemon 已断开')
  })

  it('marks a shell the daemon no longer has as daemon_restart', async () => {
    const { transport, latest, states } = fixture()
    await transport.attach(open, machineId)
    latest().json(TUNNEL_FRAME.reset, { reason: 'terminal_not_found' })
    expect(states).toEqual([
      { sessionId, status: 'daemon_restart', exitCode: null, reason: 'daemon_restart' },
    ])
  })

  it('marks a failed create closed but leaves a concurrent create alone', async () => {
    const { transport, latest, states } = fixture()
    await transport.attach({ ...open, action: 'create' }, machineId)
    latest().json(TUNNEL_FRAME.reset, { reason: 'terminal_exists' })
    expect(states).toEqual([])
    await transport.attach({ ...open, action: 'create' }, machineId)
    latest().json(TUNNEL_FRAME.reset, { reason: 'workspace_not_found' })
    expect(states).toEqual([{ sessionId, status: 'closed', exitCode: null, reason: 'error' }])
  })

  it('leaves the session running when a live viewer is reset', async () => {
    const { transport, latest, states } = fixture()
    await transport.attach(open, machineId)
    latest().json(TUNNEL_FRAME.head, head)
    latest().json(TUNNEL_FRAME.reset, { reason: 'terminal_input_backlog' })
    expect(states).toEqual([])
  })

  it('terminates through its own stream without any viewer attached', async () => {
    const { transport, latest } = fixture((stream) => {
      stream.json(TUNNEL_FRAME.head, {
        op: 'exit',
        sessionId,
        state: 'closed',
        next: 1,
        exitCode: null,
        reason: 'user',
      })
      stream.emit({ streamId: 1, type: TUNNEL_FRAME.end, payload: new Uint8Array() })
    })
    await transport.terminate(target)
    expect(latest().request.terminal).toMatchObject({ action: 'terminate', sessionId, groupId, botId })
  })

  it('surfaces the daemon reset reason for a failed terminate', async () => {
    const { transport } = fixture((stream) =>
      stream.json(TUNNEL_FRAME.reset, { reason: 'terminal_io: boom' }),
    )
    await expect(transport.terminate(target)).rejects.toThrow('terminal_io: boom')
  })

  it('rejects terminate when the machine is offline or the daemon never answers', async () => {
    const { transport, latest } = fixture()
    await expect(transport.terminate({ ...target, machineId: randomUUID() })).rejects.toThrow('daemon 已断开')
    vi.useFakeTimers()
    try {
      const terminating = transport.terminate(target)
      const rejection = expect(terminating).rejects.toThrow('终止终端超时')
      await vi.advanceTimersByTimeAsync(10_000)
      await rejection
      expect(latest().closeReasons).toEqual(['terminate timeout'])
    } finally {
      vi.useRealTimers()
    }
  })
})
