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

function fixture() {
  const stream = new FakeDaemonStream()
  let emitFrame: ((frame: TerminalFrame) => void) | undefined
  let closeHandler: (() => void) | undefined
  const conn = {
    onClose(handler: () => void) {
      closeHandler = handler
      return () => {
        closeHandler = undefined
      }
    },
    terminal(_request: unknown, onFrame: (frame: TerminalFrame) => void) {
      emitFrame = (frame) => onFrame(frame)
      return stream
    },
  }
  const ctx = {
    db: {
      select: () => ({
        from: () => ({
          where: async () => [{ machineId }],
        }),
      }),
    },
    tunnels: { get: (id: string) => (id === machineId ? conn : undefined) },
  } as unknown as Ctx
  const states: Array<{ status: string; reason: string | null }> = []
  const transport = new TerminalDaemonTransport(ctx, (_id, state) => states.push(state))
  return {
    transport,
    stream,
    states,
    emitControl(state: 'exited' | 'closed') {
      emitFrame?.({
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
    disconnect() {
      closeHandler?.()
    },
  }
}

describe('terminal daemon transport lifecycle', () => {
  it('removes a detached session before a subsequent terminate', async () => {
    const { transport, stream } = fixture()
    const attachment = await transport.attach(open)

    attachment.detach()

    expect(stream.closeReasons).toEqual(['browser detached'])
    await expect(transport.terminate(sessionId, 'user')).rejects.toThrow('终端不在线')
    expect(stream.sent).toHaveLength(0)
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
      expect(stream.closeReasons).toEqual([])
      await vi.advanceTimersByTimeAsync(1)

      await rejection
      expect(states).toEqual([])
      expect(stream.closeReasons).toEqual(['terminate failed'])
      await expect(transport.terminate(sessionId, 'user')).rejects.toThrow('终端不在线')
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies the 10 second timeout to a blocked daemon send', async () => {
    vi.useFakeTimers()
    try {
      const { transport, stream, states } = fixture()
      stream.blockSends = true
      await transport.attach(open)
      const termination = transport.terminate(sessionId, 'user')
      const rejection = expect(termination).rejects.toThrow('终止终端超时')

      await vi.advanceTimersByTimeAsync(10_000)

      await rejection
      expect(states).toEqual([])
      expect(stream.closeReasons).toEqual(['terminate failed'])
      await expect(transport.terminate(sessionId, 'user')).rejects.toThrow('终端不在线')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports closed only after daemon confirmation and cleans up on disconnect', async () => {
    const { transport, stream, states, emitControl, disconnect } = fixture()
    await transport.attach(open)
    const termination = transport.terminate(sessionId, 'user')

    await vi.waitFor(() => expect(stream.sent).toHaveLength(1))
    expect(states).toEqual([])
    emitControl('closed')
    await termination
    expect(states).toEqual([{ status: 'closed', exitCode: 0, reason: 'user' }])
    expect(stream.closeReasons).toEqual([])

    disconnect()
    expect(states).toEqual([{ status: 'closed', exitCode: 0, reason: 'user' }])
  })
})
