import { PROTOCOL_VERSION, type ServerToDaemon, type ServiceInfo } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { previews, services } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const owner = await t.seed.user()
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id })
  const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  const info = (o: Partial<ServiceInfo> = {}): ServiceInfo => ({
    id: crypto.randomUUID(),
    groupId: group.id,
    botId: bot.id,
    runId: null,
    name: 'web',
    command: 'pnpm dev',
    cwd: '',
    port: 5173,
    status: 'running',
    exitCode: null,
    ...o,
  })
  return { owner, machine, token, bot, group, info }
}

const state = (machineId: string, service: ServiceInfo) =>
  t.ctx.hub.emit('message', machineId, { t: 'service.state', service })
const row = async (id: string) => (await t.db.select().from(services).where(eq(services.id, id)))[0]

describe('hosted service registry', () => {
  it('records what the daemon reports; a preview outlives its service and follows it when restarted', async () => {
    const s = await setup()
    const sent: ServerToDaemon[] = []
    t.ctx.hub.register(s.machine.id, { send: (m) => sent.push(m), close: () => {} })
    const svc = s.info({ status: 'starting', port: 6001 })
    state(s.machine.id, svc)
    await vi.waitFor(async () => expect((await row(svc.id))?.status).toBe('starting'))
    const [preview] = await t.db
      .insert(previews)
      .values({
        slug: 'abc',
        kind: 'http',
        machineId: s.machine.id,
        groupId: s.group.id,
        botId: s.bot.id,
        serviceId: svc.id,
        port: 6001,
        title: '首页',
      })
      .returning()
    state(s.machine.id, { ...svc, status: 'exited', exitCode: 0 })
    await vi.waitFor(async () => expect((await row(svc.id))?.exitedAt).not.toBeNull())
    expect((await row(svc.id))?.exitCode).toBe(0)
    const open = async () => (await t.db.select().from(previews).where(eq(previews.id, preview!.id)))[0]
    expect((await open())?.closedAt).toBeNull()

    // Restarted under the same name (a static site comes back on another port).
    const again = s.info({ port: 6002 })
    state(s.machine.id, again)
    await vi.waitFor(async () => expect(await open()).toMatchObject({ serviceId: again.id, port: 6002 }))
    expect(sent).toContainEqual({ t: 'previews.sync', previews: [{ id: preview!.id, port: 6002 }] })
  })

  it('links a preview published by port to the service that turns out to own it', async () => {
    const s = await setup()
    const [p] = await t.db
      .insert(previews)
      .values({
        slug: 'st',
        kind: 'http',
        machineId: s.machine.id,
        groupId: s.group.id,
        botId: s.bot.id,
        port: 5173,
        title: '报告',
      })
      .returning()
    const svc = s.info({ name: 'static-dist' })
    state(s.machine.id, svc)
    await vi.waitFor(async () => {
      const [row] = await t.db.select().from(previews).where(eq(previews.id, p!.id))
      expect(row?.serviceId).toBe(svc.id)
    })
  })

  it('ignores reports about bots of another machine', async () => {
    const s = await setup()
    const other = await t.seed.machine(s.owner.id)
    const svc = s.info()
    state(other.machine.id, svc)
    state(s.machine.id, s.info({ name: 'marker' }))
    await vi.waitFor(async () => expect(await t.db.select().from(services)).toHaveLength(1))
    expect(await row(svc.id)).toBeUndefined()
  })

  it('on hello, ends the services a restarted daemon no longer hosts', async () => {
    const s = await setup()
    const kept = s.info({ name: 'kept' })
    const lost = s.info({ name: 'lost' })
    for (const svc of [kept, lost]) state(s.machine.id, svc)
    await vi.waitFor(async () => expect(await t.db.select().from(services)).toHaveLength(2))

    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token: s.token,
        daemonVersion: '0.1.0',
        machine: { name: 'm', os: 'macos', arch: 'aarch64' },
        agents: [],
        services: [kept],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    expect((await row(kept.id))?.status).toBe('running')
    expect((await row(lost.id))?.status).toBe('exited')
    ws.close()
  })

  it('sends the machine its open preview ports when it comes online', async () => {
    const s = await setup()
    const base = { kind: 'http', machineId: s.machine.id, groupId: s.group.id, botId: s.bot.id, title: 'x' }
    const [open] = await t.db
      .insert(previews)
      .values([
        { ...base, slug: 'a', port: 5173 },
        { ...base, slug: 'b', port: 3000, closedAt: new Date() },
      ])
      .returning()
    const sent: ServerToDaemon[] = []
    t.ctx.hub.register(s.machine.id, { send: (m) => sent.push(m), close: () => {} })
    await vi.waitFor(() =>
      expect(sent).toContainEqual({ t: 'previews.sync', previews: [{ id: open!.id, port: 5173 }] }),
    )
  })
})
