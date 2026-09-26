import { type BotDto, PROTOCOL_VERSION, type WebEvent } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import { auditLogs, groupBots, machines, messages, notifications, runs } from '../src/db/schema.js'
import { onMachineBound } from '../src/modules/bots/binding.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const CLAUDE = [
  {
    kind: 'claude',
    available: true,
    version: '2.1.4',
    path: '/bin/claude',
    minVersion: '2.0.0',
    catalog: null,
  },
]

async function actor(o: Parameters<TestApp['seed']['user']>[0] = {}) {
  const user = await t.seed.user(o)
  const cookie = await t.seed.cookie(user.id)
  const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url, payload, headers: { cookie } })
  return { user, req }
}

function events(userId: string) {
  const list: WebEvent[] = []
  t.ctx.bus.attach(userId, (e) => list.push(e))
  return list
}

const botEvents = (list: WebEvent[]) =>
  list.flatMap((e) => (e.t === 'bot.updated' ? [e.bot] : [])) as BotDto[]

const fakeConn: DaemonConn = { send() {}, close() {} }

describe('POST /api/bots', () => {
  it('binds a bot the member creates for herself on her own machine', async () => {
    const wang = await actor({ name: '王磊' })
    const { machine } = await t.seed.machine(wang.user.id, { name: 'wanglei-mbp', agents: CLAUDE })
    const seen = events(wang.user.id)
    const res = await wang.req('POST', '/api/bots', {
      name: '小王的 Claude',
      ownerId: wang.user.id,
      agentKind: 'claude',
      machineId: machine.id,
      systemPrompt: '后端接口开发',
      avatar: 'bot-visor',
    })
    expect(res.statusCode).toBe(200)
    const bot = res.json<BotDto>()
    expect(bot).toMatchObject({
      name: '小王的 Claude',
      ownerName: '王磊',
      machineName: 'wanglei-mbp',
      binding: 'bound',
      presence: 'offline',
      systemPrompt: '后端接口开发',
      avatar: 'bot-visor',
      agentVersion: '2.1.4',
      agentMinVersion: '2.0.0',
      groupCount: 0,
      createdBy: wang.user.id,
    })
    expect(botEvents(seen).map((b) => b.id)).toContain(bot.id)
    expect(await t.db.select().from(notifications)).toEqual([])
  })

  it('forbids members from creating bots for others', async () => {
    const wang = await actor()
    const li = await t.seed.user()
    const res = await wang.req('POST', '/api/bots', {
      name: 'x',
      ownerId: li.id,
      agentKind: 'claude',
      machineId: null,
    })
    expect(res.statusCode).toBe(403)
  })

  it('asks the owner to confirm when a sysadmin creates for someone else', async () => {
    const admin = await actor({ role: 'sysadmin', name: '陈晨' })
    const wang = await t.seed.user({ name: '王磊' })
    const { machine } = await t.seed.machine(wang.id, { name: 'wanglei-mbp' })
    const seen = events(wang.id)
    const res = await admin.req('POST', '/api/bots', {
      name: '小王的 Codex',
      ownerId: wang.id,
      agentKind: 'codex',
      machineId: machine.id,
    })
    const bot = res.json<BotDto>()
    expect(bot).toMatchObject({ binding: 'pending_confirm', presence: 'pending_confirm', agentVersion: null })
    const [n] = await t.db.select().from(notifications).where(eq(notifications.userId, wang.id))
    expect(n).toMatchObject({ type: 'bot_confirm', payload: { botId: bot.id, byName: '陈晨' } })
    expect(seen.some((e) => e.t === 'notification.new')).toBe(true)
    const [a] = await t.db.select().from(auditLogs)
    expect(a).toMatchObject({ category: 'admin', actorUserId: admin.user.id, action: 'bot.create' })
  })

  it('rejects machines of another user and revoked machines', async () => {
    const wang = await actor()
    const li = await t.seed.user()
    const other = await t.seed.machine(li.id)
    const revoked = await t.seed.machine(wang.user.id, { revokedAt: new Date() })
    for (const m of [other.machine, revoked.machine]) {
      const res = await wang.req('POST', '/api/bots', {
        name: 'b',
        ownerId: wang.user.id,
        agentKind: 'claude',
        machineId: m.id,
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('creates pending_bind only when the owner has no machine', async () => {
    const wang = await actor()
    const res = await wang.req('POST', '/api/bots', {
      name: 'b1',
      ownerId: wang.user.id,
      agentKind: 'claude',
      machineId: null,
    })
    expect(res.json()).toMatchObject({ binding: 'pending_bind', presence: 'pending_bind', machineId: null })
    await t.seed.machine(wang.user.id)
    const again = await wang.req('POST', '/api/bots', {
      name: 'b2',
      ownerId: wang.user.id,
      agentKind: 'claude',
      machineId: null,
    })
    expect(again.statusCode).toBe(400)
  })

  it('keeps names unique among live bots', async () => {
    const wang = await actor()
    const body = { name: '同名', ownerId: wang.user.id, agentKind: 'claude', machineId: null }
    const first = (await wang.req('POST', '/api/bots', body)).json<BotDto>()
    expect((await wang.req('POST', '/api/bots', { ...body, name: ' 同名 ' })).statusCode).toBe(409)
    await wang.req('DELETE', `/api/bots/${first.id}`)
    expect((await wang.req('POST', '/api/bots', body)).statusCode).toBe(200)
  })
})

describe('GET /api/bots', () => {
  it('derives presence from binding, machine connection, agents and runs', async () => {
    const wang = await actor()
    const { machine } = await t.seed.machine(wang.user.id, { agents: CLAUDE })
    const idle = await t.seed.bot({ ownerId: wang.user.id, machineId: machine.id, name: 'idle' })
    const busy = await t.seed.bot({ ownerId: wang.user.id, machineId: machine.id, name: 'busy' })
    const codex = await t.seed.bot({
      ownerId: wang.user.id,
      machineId: machine.id,
      name: 'codex',
      agentKind: 'codex',
    })
    await t.seed.bot({ ownerId: wang.user.id, name: 'gone', deletedAt: new Date() })
    const g = await t.seed.group({ createdBy: wang.user.id, botIds: [busy.id] })
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: g.id, kind: 'user', authorUserId: wang.user.id, body: '@busy' })
      .returning()
    await t.db.insert(runs).values({
      groupId: g.id,
      botId: busy.id,
      triggerMessageId: m!.id,
      originUserId: wang.user.id,
      status: 'running',
    })
    const presence = async () =>
      Object.fromEntries(
        (await wang.req('GET', '/api/bots')).json<BotDto[]>().map((b) => [b.name, b.presence]),
      )

    expect(await presence()).toEqual({ idle: 'offline', busy: 'offline', codex: 'agent_missing' })
    t.ctx.hub.register(machine.id, fakeConn)
    expect(await presence()).toEqual({ idle: 'online', busy: 'running', codex: 'agent_missing' })
    const one = await wang.req('GET', `/api/bots/${busy.id}`)
    expect(one.json()).toMatchObject({ id: busy.id, groupCount: 1 })
    expect((await wang.req('GET', `/api/bots/${idle.id}x`)).statusCode).toBe(404)
    expect(codex.id).toBeTruthy()
  })

  it('pushes presence changes when the machine goes online and offline', async () => {
    const wang = await actor()
    const { machine } = await t.seed.machine(wang.user.id, { agents: CLAUDE })
    const bot = await t.seed.bot({ ownerId: wang.user.id, machineId: machine.id })
    const viewer = await t.seed.user()
    const seen = events(viewer.id)
    const presences = () => botEvents(seen).map((b) => [b.id, b.presence])
    t.ctx.hub.register(machine.id, fakeConn)
    await vi.waitFor(() => expect(presences()).toEqual([[bot.id, 'online']]))
    t.ctx.hub.unregister(machine.id, fakeConn)
    await vi.waitFor(() =>
      expect(presences()).toEqual([
        [bot.id, 'online'],
        [bot.id, 'offline'],
      ]),
    )
  })
})

describe('PATCH /api/bots/:id', () => {
  it('lets the owner and sysadmins edit, and enforces the full-tier trigger list', async () => {
    const wang = await actor()
    const li = await actor()
    const admin = await actor({ role: 'sysadmin' })
    const bot = await t.seed.bot({ ownerId: wang.user.id })
    const url = `/api/bots/${bot.id}`

    expect((await li.req('PATCH', url, { systemPrompt: 'x' })).statusCode).toBe(403)
    expect((await wang.req('PATCH', url, { tier: 'full', triggerScope: 'all' })).statusCode).toBe(400)
    expect((await wang.req('PATCH', url, { triggerScope: 'list', triggerList: ['nope'] })).statusCode).toBe(
      400,
    )

    const full = await wang.req('PATCH', url, { tier: 'full', triggerList: [li.user.id] })
    expect(full.json()).toMatchObject({ tier: 'full', triggerScope: 'list', triggerList: [li.user.id] })
    expect((await wang.req('PATCH', url, { triggerScope: 'all' })).statusCode).toBe(400)

    const byAdmin = await admin.req('PATCH', url, { systemPrompt: '只读分析', tier: 'read-only' })
    expect(byAdmin.json()).toMatchObject({ systemPrompt: '只读分析', tier: 'read-only' })
  })

  it('sets, validates and clears the avatar', async () => {
    const wang = await actor()
    const bot = await t.seed.bot({ ownerId: wang.user.id })
    const url = `/api/bots/${bot.id}`
    expect((await wang.req('GET', url)).json()).toMatchObject({ avatar: null })
    expect((await wang.req('PATCH', url, { avatar: 'agent-orbit' })).json()).toMatchObject({
      avatar: 'agent-orbit',
    })
    expect((await wang.req('PATCH', url, { avatar: 'nope' })).statusCode).toBe(400)
    expect((await wang.req('PATCH', url, { avatar: null })).json()).toMatchObject({ avatar: null })
  })
})

describe('confirm', () => {
  async function pending() {
    const admin = await actor({ role: 'sysadmin' })
    const wang = await actor()
    const { machine, token } = await t.seed.machine(wang.user.id)
    const bot = (
      await admin.req('POST', '/api/bots', {
        name: '小王的 Codex',
        ownerId: wang.user.id,
        agentKind: 'codex',
        machineId: machine.id,
      })
    ).json<BotDto>()
    return { admin, wang, bot, token, machine }
  }

  it('only the owner can confirm on the web; the notification is marked read', async () => {
    const { admin, wang, bot } = await pending()
    expect((await admin.req('POST', `/api/bots/${bot.id}/confirm`)).statusCode).toBe(403)
    const res = await wang.req('POST', `/api/bots/${bot.id}/confirm`)
    expect(res.json()).toMatchObject({ binding: 'bound' })
    expect((await wang.req('POST', `/api/bots/${bot.id}/confirm`)).statusCode).toBe(409)
    const [n] = await t.db.select().from(notifications)
    expect(n?.readAt).not.toBeNull()
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'bot.confirm'))
    expect(audits).toHaveLength(1)
  })

  it('the daemon only lists its bots; the machine token cannot confirm or change them', async () => {
    const { bot, token, wang } = await pending()
    const auth = { authorization: `Bearer ${token}` }
    expect((await t.app.inject({ url: '/api/daemon/bots' })).statusCode).toBe(401)
    const list = await t.app.inject({ url: '/api/daemon/bots', headers: auth })
    expect(list.json<BotDto[]>().map((b) => [b.name, b.binding])).toEqual([
      ['小王的 Codex', 'pending_confirm'],
    ])
    const confirm = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/bots/${bot.id}/confirm`,
      headers: auth,
    })
    expect(confirm.statusCode).toBe(404)
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/daemon/bots/${bot.id}`,
      payload: { concurrency: 4 },
      headers: auth,
    })
    expect(patch.statusCode).toBe(404)
    expect((await wang.req('GET', `/api/bots/${bot.id}`)).json<BotDto>()).toMatchObject({
      binding: 'pending_confirm',
      concurrency: bot.concurrency,
    })

    const revoked = await t.seed.machine(wang.user.id, { revokedAt: new Date() })
    const denied = await t.app.inject({
      url: '/api/daemon/bots',
      headers: { authorization: `Bearer ${revoked.token}` },
    })
    expect(denied.statusCode).toBe(401)
  })
})

describe('agents.update', () => {
  it('replaces the machine agents and republishes the machine and its bots', async () => {
    const wang = await actor()
    const { machine, token } = await t.seed.machine(wang.user.id, { agents: CLAUDE })
    const bot = await t.seed.bot({ ownerId: wang.user.id, machineId: machine.id, agentKind: 'codex' })
    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    const hello = { protocol: PROTOCOL_VERSION, token, daemonVersion: '0.1.0', agents: CLAUDE }
    ws.send(JSON.stringify({ t: 'hello', machine: { name: 'm', os: 'macos', arch: 'aarch64' }, ...hello }))
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    await vi.waitFor(() => expect(t.ctx.hub.isOnline(machine.id)).toBe(true))
    const presence = async () => (await wang.req('GET', `/api/bots/${bot.id}`)).json<BotDto>().presence
    expect(await presence()).toBe('agent_missing')

    const seen = events(wang.user.id)
    const codex = {
      kind: 'codex',
      available: true,
      version: '0.48.0',
      path: '/x/codex',
      minVersion: '0.40.0',
      catalog: null,
    }
    ws.send(JSON.stringify({ t: 'agents.update', agents: [...CLAUDE, codex] }))
    await vi.waitFor(() => expect(botEvents(seen).at(-1)).toMatchObject({ id: bot.id, presence: 'online' }))
    expect(seen).toContainEqual({
      t: 'machine.updated',
      machine: expect.objectContaining({ id: machine.id, agents: [...CLAUDE, codex] }),
    })
    const [row] = await t.db.select().from(machines).where(eq(machines.id, machine.id))
    expect(row?.agents).toEqual([...CLAUDE, codex])
    expect(await presence()).toBe('online')
    ws.close()
  })
})

describe('DELETE /api/bots/:id', () => {
  it('soft-deletes, removes the bot from groups and hides it', async () => {
    const wang = await actor()
    const li = await actor()
    const bot = await t.seed.bot({ ownerId: wang.user.id })
    const g = await t.seed.group({ createdBy: wang.user.id, botIds: [bot.id] })
    const seen = events(li.user.id)
    expect((await li.req('DELETE', `/api/bots/${bot.id}`)).statusCode).toBe(403)
    expect((await wang.req('DELETE', `/api/bots/${bot.id}`)).statusCode).toBe(204)
    expect((await wang.req('GET', '/api/bots')).json()).toEqual([])
    expect((await wang.req('GET', `/api/bots/${bot.id}`)).statusCode).toBe(404)
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, g.id), eq(groupBots.botId, bot.id)))
    expect(gb?.removedAt).not.toBeNull()
    expect(seen).toContainEqual({ t: 'bot.removed', botId: bot.id })
  })
})

describe('onMachineBound', () => {
  it("binds the owner's pending_bind bots to the first machine", async () => {
    const wang = await actor()
    const li = await t.seed.user()
    const mine = await t.seed.bot({ ownerId: wang.user.id })
    const theirs = await t.seed.bot({ ownerId: li.id })
    const { machine } = await t.seed.machine(wang.user.id)
    const seen = events(wang.user.id)
    await onMachineBound(t.ctx, machine)
    const list = (await wang.req('GET', '/api/bots')).json<BotDto[]>()
    expect(list.find((b) => b.id === mine.id)).toMatchObject({ binding: 'bound', machineId: machine.id })
    expect(list.find((b) => b.id === theirs.id)).toMatchObject({ binding: 'pending_bind', machineId: null })
    expect(botEvents(seen).map((b) => b.id)).toEqual([mine.id])
  })
})

describe('owners, users and notifications', () => {
  it('lists owners the caller may create bots for', async () => {
    const wang = await actor({ name: '王磊' })
    const admin = await actor({ role: 'sysadmin', name: '陈晨' })
    await t.seed.machine(wang.user.id, { name: 'wanglei-mbp' })
    await t.seed.machine(wang.user.id, { name: 'old', revokedAt: new Date() })
    const mine = (await wang.req('GET', '/api/bots/owners')).json()
    expect(mine).toEqual([
      expect.objectContaining({
        id: wang.user.id,
        machines: [expect.objectContaining({ name: 'wanglei-mbp' })],
      }),
    ])
    const all = (await admin.req('GET', '/api/bots/owners')).json<{ name: string }[]>()
    expect(all.map((o) => o.name).sort()).toEqual(['王磊', '陈晨'].sort())
  })

  it('lists active users for pickers', async () => {
    const wang = await actor({ name: '王磊', account: 'wanglei' })
    await t.seed.user({ disabledAt: new Date() })
    expect((await wang.req('GET', '/api/users')).json()).toEqual([
      { id: wang.user.id, name: '王磊', account: 'wanglei' },
    ])
    expect((await t.app.inject('/api/users')).statusCode).toBe(401)
  })

  it('lists my notifications newest first and marks them read', async () => {
    const wang = await actor()
    const li = await actor()
    await t.db.insert(notifications).values([
      { userId: wang.user.id, type: 'bot_confirm', payload: { n: 1 }, createdAt: new Date(1000) },
      { userId: wang.user.id, type: 'bot_confirm', payload: { n: 2 }, createdAt: new Date(2000) },
      { userId: li.user.id, type: 'bot_confirm', payload: { n: 3 } },
    ])
    const list = (await wang.req('GET', '/api/notifications')).json<{ id: string; payload: object }[]>()
    expect(list.map((n) => n.payload)).toEqual([{ n: 2 }, { n: 1 }])
    expect((await li.req('POST', `/api/notifications/${list[0]!.id}/read`)).statusCode).toBe(404)
    expect((await wang.req('POST', `/api/notifications/${list[0]!.id}/read`)).statusCode).toBe(204)
    const after = (await wang.req('GET', '/api/notifications')).json<{ readAt: string | null }[]>()
    expect(after[0]!.readAt).not.toBeNull()
  })
})
