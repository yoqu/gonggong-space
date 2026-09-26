import { PROTOCOL_VERSION } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { machines } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp({ heartbeatSec: 0.1 })
})
afterEach(() => t.close())

const hello = (token: string, protocol = PROTOCOL_VERSION) => ({
  t: 'hello',
  protocol,
  token,
  daemonVersion: '0.1.0',
  machine: { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' },
  agents: [
    {
      kind: 'claude',
      available: true,
      version: '2.1.280',
      path: '/bin/claude',
      minVersion: '2.0.0',
      catalog: null,
    },
  ],
})

async function connect(msg: unknown) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(JSON.stringify(msg))
  return { ws, box }
}

describe('daemon gateway', () => {
  it('health endpoint reports protocol version', async () => {
    const res = await t.app.inject('/api/health')
    expect(res.json()).toEqual({ ok: true, protocol: PROTOCOL_VERSION })
  })

  it('welcomes a known machine, persists its report and marks it online', async () => {
    const u = await t.seed.user()
    const { machine, token } = await t.seed.machine(u.id)
    const { box } = await connect(hello(token))
    expect(await box.next()).toMatchObject({ t: 'welcome', machineId: machine.id })
    expect(t.ctx.hub.isOnline(machine.id)).toBe(true)
    const [row] = await t.db.select().from(machines).where(eq(machines.id, machine.id))
    expect(row?.agents).toEqual(hello(token).agents)
    expect(row?.daemonVersion).toBe('0.1.0')
  })

  it('rejects an outdated protocol', async () => {
    const { box } = await connect(hello('x', PROTOCOL_VERSION - 1))
    expect(await box.next()).toMatchObject({ t: 'reject', reason: 'protocol', minProtocol: PROTOCOL_VERSION })
    expect(await box.closed).toBe(4001)
  })

  it('rejects unknown tokens and malformed hellos', async () => {
    const a = await connect(hello('mt_nope'))
    expect(await a.box.next()).toMatchObject({ t: 'reject', reason: 'unauthorized' })
    const b = await connect({ t: 'nope' })
    expect(await b.box.next()).toMatchObject({ t: 'reject', reason: 'unauthorized' })
    expect(await b.box.closed).toBe(4000)
  })

  it('rejects revoked machines and machines of disabled owners', async () => {
    const u = await t.seed.user()
    const revoked = await t.seed.machine(u.id, { revokedAt: new Date() })
    const a = await connect(hello(revoked.token))
    expect(await a.box.next()).toMatchObject({ t: 'reject', reason: 'revoked' })
    expect(await a.box.closed).toBe(4003)

    const gone = await t.seed.user({ disabledAt: new Date() })
    const m = await t.seed.machine(gone.id)
    const b = await connect(hello(m.token))
    expect(await b.box.next()).toMatchObject({ t: 'reject', reason: 'revoked' })
  })

  it('drops the machine after 3 missed heartbeats', async () => {
    const u = await t.seed.user()
    const { machine, token } = await t.seed.machine(u.id)
    const offline = new Promise((r) => t.ctx.hub.once('offline', r))
    const { box } = await connect(hello(token))
    await box.next()
    expect(await box.closed).toBe(4004)
    expect(await offline).toBe(machine.id)
    expect(t.ctx.hub.isOnline(machine.id)).toBe(false)
  })

  it('stays online while heartbeats keep coming', async () => {
    const u = await t.seed.user()
    const { machine, token } = await t.seed.machine(u.id)
    const { ws, box } = await connect(hello(token))
    await box.next()
    for (let i = 0; i < 6; i++) {
      ws.send(JSON.stringify({ t: 'heartbeat' }))
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(t.ctx.hub.isOnline(machine.id)).toBe(true)
  })

  it('a newer connection replaces the older one', async () => {
    const u = await t.seed.user()
    const { machine, token } = await t.seed.machine(u.id)
    const first = await connect(hello(token))
    await first.box.next()
    const second = await connect(hello(token))
    await second.box.next()
    expect(await first.box.closed).toBe(4002)
    expect(t.ctx.hub.isOnline(machine.id)).toBe(true)
  })

  it('forwards run messages to hub listeners', async () => {
    const u = await t.seed.user()
    const { machine, token } = await t.seed.machine(u.id)
    const { ws, box } = await connect(hello(token))
    await box.next()
    const got = new Promise((r) => t.ctx.hub.once('message', (id, msg) => r({ id, msg })))
    ws.send(JSON.stringify({ t: 'run.event', runId: 'r1', event: { kind: 'text', delta: 'hi' } }))
    expect(await got).toEqual({
      id: machine.id,
      msg: { t: 'run.event', runId: 'r1', event: { kind: 'text', delta: 'hi' } },
    })
  })
})
