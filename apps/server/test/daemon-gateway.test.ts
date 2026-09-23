import { PROTOCOL_VERSION } from '@aiws/protocol'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app.js'

let app: FastifyInstance
let url: string

beforeAll(async () => {
  app = await buildApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address() as { port: number }
  url = `ws://127.0.0.1:${addr.port}/ws/daemon`
})
afterAll(() => app.close())

const hello = (protocol: number) => ({
  t: 'hello',
  protocol,
  daemonVersion: '0.1.0',
  machine: { name: 'm', os: 'macos', arch: 'aarch64' },
  agents: [],
})

function exchange(msg: unknown): Promise<{ reply: Record<string, unknown>; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)))
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.once('message', (data) => resolve({ reply: JSON.parse(String(data)), closed }))
    ws.on('error', reject)
  })
}

describe('daemon gateway', () => {
  it('health endpoint reports protocol version', async () => {
    const res = await app.inject('/api/health')
    expect(res.json()).toEqual({ ok: true, protocol: PROTOCOL_VERSION })
  })

  it('welcomes a daemon speaking the current protocol', async () => {
    const { reply } = await exchange(hello(PROTOCOL_VERSION))
    expect(reply).toMatchObject({ t: 'welcome', heartbeatSec: 15 })
  })

  it('rejects an outdated protocol and closes the socket', async () => {
    const { reply, closed } = await exchange(hello(PROTOCOL_VERSION - 1))
    expect(reply).toMatchObject({ t: 'reject', reason: 'protocol', minProtocol: PROTOCOL_VERSION })
    expect(await closed).toBe(4001)
  })

  it('closes on malformed first message', async () => {
    const { reply, closed } = await exchange({ t: 'nope' })
    expect(reply).toMatchObject({ t: 'reject', reason: 'unauthorized' })
    expect(await closed).toBe(4000)
  })
})
