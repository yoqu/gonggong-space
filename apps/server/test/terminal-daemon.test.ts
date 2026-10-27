import { randomUUID } from 'node:crypto'
import { type TerminalOpen, TUNNEL_FRAME, type TunnelFrameType } from '@gonggong/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { Ctx } from '../src/context.js'
import { TerminalDaemonTransport } from '../src/modules/terminals/daemon.js'

const sessionId = randomUUID()
const machineId = randomUUID()
const botId = randomUUID()

const open: TerminalOpen = {
  action: 'create',
  sessionId,
  groupId: randomUUID(),
  botId,
  workspace: { repo: null, cdPath: null },
  cols: 80,
  rows: 24,
  after: 0,
}

type TerminalFrame = { streamId: number; type: TunnelFrameType; payload: Uint8Array }

class FakeDaemonStream {
  sent: Array<{ type: TunnelFrameType; payload: Uint8Array }> = []
  closeReasons: string[] = []
  blockSends = false
  private sendGate?: Promise<void>

  async send(type: TunnelFrameType, payload: Uint8Array = new Uint8Array()) {
    this.sent.push({ type, payload })
    if (this.blockSends) {
      this.sendGate ??= new Promise<void>(() => {})
      await this.sendGate
    }
  }

  close(reason: string) {
    this.closeReasons.push(reason)
  }
}

function fixture(onOpen?: (emit: (frame: TerminalFrame) => void) => void) {
  const streams = new Map<string, FakeDaemonStream[]>()
  const emitters = new Map<string, Array<(frame: TerminalFrame) => void>>()
  const closeHandlers = new Map<string, () => void>()
  const conns = new Map<string, object>()
  const forMachine = (id: string) => {
    const existing = conns.get(id)
    if (existing) return existing
    const conn = {
      onClose(handler: () => void) {
        closeHandlers.set(id, handler)
        return () => closeHandlers.delete(id)
      },
      terminal(_request: unknown, onFrame: (frame: TerminalFrame) => void) {
        const stream = new FakeDaemonStream()
        const machineStreams = streams.get(id) ?? []
        machineStreams.push(stream)
        streams.set(id, machineStreams)
        const machineEmitters = emitters.get(id) ?? []
        machineEmitters.push((frame) => onFrame(frame))
        emitters.set(id, machineEmitters)
        if (onOpen) queueMicrotask(() => onOpen(machineEmitters.at(-1)!))
        return stream
      },
    }
    conns.set(id, conn)
    return conn
  }
  let nextMachineId = machineId
  forMachine(machineId)
  const ctx = {
    db: {
      select: () => ({
        from: () => ({
          where: async () => [{ machineId: nextMachineId }],
        }),
      }),
    },
    tunnels: { get: (id: string) => conns.get(id) },
  } as unknown as Ctx
  const states: Array<{ status: string; reason: string | null }> = []
  const transport = new TerminalDaemonTransport(ctx, (_id, state) => states.push(state))
  return {
    transport,
    stream: () => streams.get(machineId)![0]!,
    streamFor: (id: typeof machineId) => streams.get(id)!.at(-1)!,
    latestStream: () => streams.get(machineId)!.at(-1)!,
    emitControlOnLatest(state: 'exited' | 'closed') {
      emitters.get(machineId)?.at(-1)?.({
        streamId: 1,
        type: TUNNEL_FRAME.head,
        payload: Buffer.from(
          JSON.stringify({
            op: 'state',
            sessionId,
            state,
            next: 1,
            exitCode: 0,
            reason: state === 'exited' ? 'exited' : 'user',
          }),
        ),
      })
    },
    useMachine(id: typeof machineId) {
      nextMachineId = id
      forMachine(id)
    },
    states,
    emitControl(state: 'exited' | 'closed') {
      emitters.get(machineId)?.at(-1)?.({
        streamId: 1,
        type: TUNNEL_FRAME.head,
        payload: Buffer.from(
          JSON.stringify({
            op: 'state',
            sessionId,
            state,
            next: 1,
            exitCode: 0,
            reason: state === 'exited' ? 'exited' : 'user',
          }),
        ),
      })
    },
    emitReset(reason: string) {
      emitters.get(machineId)?.at(-1)?.({
        streamId: 1,
        type: TUNNEL_FRAME.reset,
        payload: Buffer.from(JSON.stringify({ reason })),
      })
    },
    disconnect() {
      closeHandlers.get(machineId)?.()
    },
    disconnectMachine(id: string) {
      closeHandlers.get(id)?.()
    },
  }
}

describe('terminal daemon transport lifecycle', () => {
  it('keeps a detached session control stream for explicit termination', async () => {
    const { transport, stream, emitControl } = fixture()
    const attachment = await transport.attach(open)
    const current = stream()

    attachment.detach()

    expect(current.closeReasons).toEqual([])
    const terminating = transport.terminate(sessionId, 'user')
    expect(current.sent).toHaveLength(1)
    emitControl('closed')
    await terminating
    expect(current.closeReasons).toEqual(['terminal ended'])
  })

  it('buffers head, replay and a fast exit until the relay subscribes', async () => {
    const head = {
      sessionId,
      status: 'running',
      cols: 80,
      rows: 24,
      next: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      exitCode: null,
      reason: null,
    }
    const { transport } = fixture((emit) => {
      emit({ streamId: 1, type: TUNNEL_FRAME.head, payload: Buffer.from(JSON.stringify(head)) })
      emit({
        streamId: 1,
        type: TUNNEL_FRAME.data,
        payload: Buffer.from(
          JSON.stringify({ sessionId, seq: 1, data: Buffer.from('replay').toString('base64') }),
        ),
      })
      emit({
        streamId: 1,
        type: TUNNEL_FRAME.head,
        payload: Buffer.from(
          JSON.stringify({ ...head, status: 'exited', next: 1, exitCode: 0, reason: 'exited' }),
        ),
      })
    })
    const attachment = await transport.attach(open)
    const frames: unknown[] = []
    attachment.subscribe(
      (frame) => frames.push(JSON.parse(String(frame.payload))),
      () => {},
    )

    expect(frames).toHaveLength(3)
    expect(frames[0]).toMatchObject({ status: 'running' })
    expect(frames[1]).toMatchObject({ seq: 1, data: Buffer.from('replay').toString('base64') })
    expect(frames[2]).toMatchObject({ status: 'exited', exitCode: 0 })
  })

  it('rejects an unconfirmed terminate after 10 seconds and never reports closed', async () => {
    vi.useFakeTimers()
    try {
      const { transport, stream, states } = fixture()
      await transport.attach(open)
      const termination = transport.terminate(sessionId, 'user')
      const rejection = expect(termination).rejects.toThrow('终止终端超时')

      await vi.advanceTimersByTimeAsync(9_999)
      expect(states).toEqual([])
      expect(stream().closeReasons).toEqual([])
      await vi.advanceTimersByTimeAsync(1)

      await rejection
      expect(states).toEqual([])
      expect(stream().closeReasons).toEqual(['daemon disconnected'])
      await expect(transport.terminate(sessionId, 'user')).rejects.toThrow('终端不在线')
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces the daemon reset reason for a failed terminate', async () => {
    const { transport, stream, emitReset } = fixture()
    await transport.attach(open)
    const terminating = transport.terminate(sessionId, 'user')
    await vi.waitFor(() => expect(stream().sent).toHaveLength(1))
    emitReset('terminal_io: test failure')

    await expect(terminating).rejects.toThrow('terminal_io: test failure')
  })

  it('applies the 10 second timeout to a blocked daemon send', async () => {
    vi.useFakeTimers()
    try {
      const { transport, stream, states } = fixture()
      await transport.attach(open)
      stream().blockSends = true
      const termination = transport.terminate(sessionId, 'user')
      const rejection = expect(termination).rejects.toThrow('终止终端超时')

      await vi.advanceTimersByTimeAsync(10_000)

      await rejection
      expect(states).toEqual([])
      expect(stream().closeReasons).toEqual(['daemon disconnected'])
      await expect(transport.terminate(sessionId, 'user')).rejects.toThrow('终端不在线')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports closed only after daemon confirmation and cleans up on disconnect', async () => {
    const { transport, stream, states, emitControl, disconnect } = fixture()
    await transport.attach(open)
    const termination = transport.terminate(sessionId, 'user')

    await vi.waitFor(() => expect(stream().sent).toHaveLength(1))
    expect(states).toEqual([])
    emitControl('closed')
    await termination
    expect(states).toEqual([{ status: 'closed', exitCode: 0, reason: 'user' }])
    expect(stream().closeReasons).toEqual(['terminal ended'])

    disconnect()
    expect(states).toEqual([{ status: 'closed', exitCode: 0, reason: 'user' }])
  })

  it('does not let an older browser attachment delete the newer control channel', async () => {
    const { transport, stream, latestStream, emitControlOnLatest } = fixture()
    const first = await transport.attach(open)
    await transport.attach(open)
    const latest = latestStream()

    first.detach('first browser detached')
    expect(stream().closeReasons).toEqual(['daemon disconnected', 'first browser detached'])
    const terminating = transport.terminate(sessionId, 'user')

    expect(latest.sent).toHaveLength(1)
    emitControlOnLatest('closed')
    await terminating
  })

  it('only disconnects streams belonging to the machine whose tunnel closed', async () => {
    const { transport, stream, useMachine, streamFor, disconnect } = fixture()
    const otherMachineId = randomUUID()
    await transport.attach(open)
    useMachine(otherMachineId)
    const other = await transport.attach({ ...open, botId: randomUUID() })
    let disconnected = false
    other.subscribe(
      () => {},
      () => {
        disconnected = true
      },
    )
    disconnect()
    expect(stream().closeReasons).toEqual(['daemon disconnected'])
    expect(disconnected).toBe(false)
    expect(streamFor(otherMachineId).closeReasons).toEqual([])
  })
})
