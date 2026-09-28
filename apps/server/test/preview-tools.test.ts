import type { GroupPreviewsDto, ServerToDaemon, ToolCallRes, WebEvent } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupMembers, messages, previews, runs, services } from '../src/db/schema.js'
import { reapIdlePreviews } from '../src/modules/previews/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
const now = new Date('2026-09-27T10:00:00Z')
beforeEach(async () => {
  t = await createTestApp({ now: () => now })
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: 'https://gg.example.com' }
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id] })
  const other = await t.seed.group({ createdBy: wang.id, botIds: [bot.id] })
  const [trigger] = await t.db
    .insert(messages)
    .values({
      groupId: group.id,
      kind: 'user',
      authorUserId: wang.id,
      body: '@小王的 Claude 起个 dev server',
    })
    .returning()
  const [run] = await t.db
    .insert(runs)
    .values({
      groupId: group.id,
      botId: bot.id,
      triggerMessageId: trigger!.id,
      originUserId: wang.id,
      status: 'running',
    })
    .returning()
  const [web] = await t.db
    .insert(services)
    .values({
      id: crypto.randomUUID(),
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      name: 'web',
      command: 'pnpm dev',
      cwd: '',
      port: 5173,
      status: 'running',
    })
    .returning()
  const sent: ServerToDaemon[] = []
  t.ctx.hub.register(machine.id, { send: (m) => sent.push(m), close: () => {} })
  const seen: WebEvent[] = []
  t.ctx.bus.attach(li.id, (e) => seen.push(e))
  const call = async (name: string, args: unknown, runId = run!.id) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${runId}/tools/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
    expect(res.statusCode).toBe(200)
    return res.json<ToolCallRes>()
  }
  return { wang, li, machine, token, bot, group, other, run: run!, web: web!, sent, seen, call }
}

const openRows = async () => (await t.db.select().from(previews)).filter((p) => !p.closedAt)

describe('preview_expose / preview_close', () => {
  it('publishes a service as a preview card and opens the tunnel for its port', async () => {
    const w = await world()
    const res = await w.call('preview_expose', { service: 'web', title: '登录页', path: '/login' })
    expect(res.isError).toBe(false)
    const [p] = await openRows()
    expect(p).toMatchObject({
      kind: 'http',
      port: 5173,
      serviceId: w.web.id,
      path: '/login',
      title: '登录页',
      createdByRunId: w.run.id,
    })
    expect(p!.slug).toMatch(/^[a-z2-7]{16}$/)
    expect(res.text).toContain(`https://${p!.slug}.preview.test/login`)
    expect(res.text).toContain(p!.id)

    expect(w.sent).toContainEqual({ t: 'previews.sync', previews: [{ id: p!.id, port: 5173 }] })
    const card = w.seen.find(
      (e): e is Extract<WebEvent, { t: 'message.new' }> => e.t === 'message.new',
    )!.message
    expect(card).toMatchObject({ kind: 'bot', authorId: w.bot.id, runId: null, previewId: p!.id })
    const update = w.seen.find((e) => e.t === 'group.previews') as Extract<WebEvent, { t: 'group.previews' }>
    expect(update.previews.map((x) => x.id)).toEqual([p!.id])
  })

  it('reuses an open preview of the same port instead of posting another card', async () => {
    const w = await world()
    await w.call('preview_expose', { port: 5173, title: '首页' })
    const again = await w.call('preview_expose', { service: 'web', title: '首页' })
    expect(again.isError).toBe(false)
    expect(again.text).toContain('已发布过')
    expect(await openRows()).toHaveLength(1)
    const cards = await t.db.select().from(messages).where(eq(messages.kind, 'bot'))
    expect(cards).toHaveLength(1)
  })

  it('refuses services that are not running and previews of other conversations', async () => {
    const w = await world()
    await t.db.update(services).set({ status: 'exited' }).where(eq(services.id, w.web.id))
    expect((await w.call('preview_expose', { service: 'web', title: 'x' })).isError).toBe(true)
    expect((await w.call('preview_expose', { service: 'nope', title: 'x' })).isError).toBe(true)
    const [foreign] = await t.db
      .insert(previews)
      .values({
        slug: 'zzzz',
        kind: 'http',
        machineId: w.machine.id,
        groupId: w.other.id,
        botId: w.bot.id,
        port: 1,
        title: 'x',
      })
      .returning()
    expect((await w.call('preview_close', { preview: foreign!.id })).isError).toBe(true)
  })

  it('closes a preview and withdraws its port from the tunnel', async () => {
    const w = await world()
    await w.call('preview_expose', { port: 5173, title: '首页' })
    const [p] = await openRows()
    w.sent.length = 0
    expect((await w.call('preview_close', { preview: p!.id })).isError).toBe(false)
    expect(await openRows()).toEqual([])
    expect(w.sent).toContainEqual({ t: 'previews.sync', previews: [] })
  })

  it('gives each preview its own port in port mode', async () => {
    t.ctx.config.preview.domain = null
    const w = await world()
    const res = await w.call('preview_expose', { port: 5173, title: '首页' })
    const [p] = await openRows()
    expect(p!.publicPort).toBeGreaterThan(0)
    expect(res.text).toContain(`https://gg.example.com:${p!.publicPort}/`)
  })
})

describe('previews in the group', () => {
  it('lists open previews and live services to members, with who may manage them', async () => {
    const w = await world()
    await w.call('preview_expose', { service: 'web', title: '登录页' })
    const li = client(t, await t.seed.cookie(w.li.id))
    const { status, body } = await li.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)
    expect(status).toBe(200)
    expect(body.previews).toMatchObject([
      { title: '登录页', botName: '小王的 Claude', serviceName: 'web', status: 'offline' },
    ])
    expect(body.services).toMatchObject([{ name: 'web', port: 5173, status: 'running' }])
    const outsider = client(t, await t.seed.cookie((await t.seed.user()).id))
    expect((await outsider.get(`/api/groups/${w.group.id}/previews`)).status).toBe(404)
  })

  it('lets the bot owner or a group admin close previews and stop services', async () => {
    const w = await world()
    await w.call('preview_expose', { service: 'web', title: '登录页' })
    const [p] = await openRows()
    const li = client(t, await t.seed.cookie(w.li.id))
    expect((await li.post(`/api/previews/${p!.id}/close`)).status).toBe(403)
    expect((await li.post(`/api/services/${w.web.id}/stop`)).status).toBe(403)
    await t.db.update(groupMembers).set({ isAdmin: true }).where(eq(groupMembers.userId, w.li.id))
    expect((await li.post(`/api/previews/${p!.id}/close`)).status).toBe(204)
    const wang = client(t, await t.seed.cookie(w.wang.id))
    expect((await wang.post(`/api/services/${w.web.id}/stop`)).status).toBe(204)
    expect(w.sent).toContainEqual({ t: 'service.stop', serviceId: w.web.id })
  })

  it('stops the tunnel together with the service behind it, and says so when that machine is offline', async () => {
    const w = await world()
    await w.call('preview_expose', { service: 'web', title: '登录页' })
    const [p] = await openRows()
    const li = client(t, await t.seed.cookie(w.li.id))
    expect((await li.post(`/api/previews/${p!.id}/close`, { stopService: true })).status).toBe(403)
    const wang = client(t, await t.seed.cookie(w.wang.id))
    const conn = { send: (m: ServerToDaemon) => w.sent.push(m), close: () => {} }
    t.ctx.hub.register(w.machine.id, conn)
    t.ctx.hub.unregister(w.machine.id, conn)
    expect((await wang.post(`/api/previews/${p!.id}/close`, { stopService: true })).status).toBe(409)
    expect(await openRows()).toHaveLength(1)
    t.ctx.hub.register(w.machine.id, conn)
    expect((await wang.post(`/api/previews/${p!.id}/close`, { stopService: true })).status).toBe(204)
    expect(w.sent).toContainEqual({ t: 'service.stop', serviceId: w.web.id })
    expect(await openRows()).toHaveLength(0)
  })
})

describe('a stopped or closed preview comes back without asking the bot', () => {
  /** The machine answers service.restart with `error` and reports the new service like the real daemon. */
  function answering(w: Awaited<ReturnType<typeof world>>, error: string | null) {
    t.ctx.hub.register(w.machine.id, {
      send: (m) => {
        w.sent.push(m)
        if (m.t !== 'service.restart') return
        setTimeout(() => {
          if (!error)
            t.ctx.hub.emit('message', w.machine.id, {
              t: 'service.state',
              service: {
                id: crypto.randomUUID(),
                groupId: w.group.id,
                botId: w.bot.id,
                runId: w.run.id,
                name: 'web',
                command: 'pnpm dev',
                cwd: '',
                port: 5173,
                status: 'running',
                exitCode: null,
              },
            })
          t.ctx.hub.emit('message', w.machine.id, {
            t: 'service.restart.result',
            requestId: m.requestId,
            error,
          })
        }, 10)
      },
      close: () => {},
    })
  }

  it('shows 服务已停止 while its service is down, and 启动 restarts it as it was started', async () => {
    const w = await world()
    await w.call('preview_expose', { service: 'web', title: '登录页' })
    const [p] = await openRows()
    await t.db.update(services).set({ status: 'exited' }).where(eq(services.id, w.web.id))
    t.ctx.tunnels.register(w.machine.id, { close: () => {} } as never)
    const li = client(t, await t.seed.cookie(w.li.id))
    const listed = await li.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)
    expect(listed.body.previews[0]?.status).toBe('stopped')
    expect(listed.body.manageableBotIds).toEqual([])
    expect((await li.post(`/api/previews/${p!.id}/start`)).status).toBe(403)

    const wang = client(t, await t.seed.cookie(w.wang.id))
    expect(
      (await wang.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)).body.manageableBotIds,
    ).toEqual([w.bot.id])
    answering(w, null)
    expect((await wang.post(`/api/previews/${p!.id}/start`)).status).toBe(204)
    expect(w.sent).toContainEqual(expect.objectContaining({ t: 'service.restart', serviceId: w.web.id }))
    const [row] = await openRows()
    expect(row?.serviceId).not.toBe(w.web.id)
  })

  it("reopens a closed preview, restarting its service; the machine's reason when it cannot", async () => {
    const w = await world()
    await w.call('preview_expose', { service: 'web', title: '登录页' })
    const [p] = await openRows()
    const wang = client(t, await t.seed.cookie(w.wang.id))
    await wang.post(`/api/previews/${p!.id}/close`, { stopService: true })
    await t.db.update(services).set({ status: 'exited' }).where(eq(services.id, w.web.id))

    answering(w, '本机没有这个服务的启动记录（机器重启过），请让 Bot 重新启动')
    const failed = await wang.post(`/api/previews/${p!.id}/start`)
    expect(failed).toMatchObject({
      status: 409,
      body: { message: expect.stringContaining('请让 Bot 重新启动') },
    })
    expect(await openRows()).toHaveLength(0)

    answering(w, null)
    w.seen.length = 0
    expect((await wang.post(`/api/previews/${p!.id}/start`)).status).toBe(204)
    expect((await openRows()).map((r) => r.id)).toEqual([p!.id])
    expect(w.seen).toContainEqual(
      expect.objectContaining({ t: 'group.previews', previews: [expect.objectContaining({ id: p!.id })] }),
    )
  })
})

describe('the machine manages its own tunnels (desktop app)', () => {
  it("lists this machine's previews and services and stops them, which members see at once", async () => {
    const w = await world()
    await w.call('preview_expose', { service: 'web', title: '登录页' })
    const [p] = await openRows()
    const daemon = (method: 'GET' | 'POST', url: string, token = w.token, payload?: object) =>
      t.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload })
    const list = await daemon('GET', '/api/daemon/previews')
    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({
      previews: [
        { id: p!.id, title: '登录页', groupName: w.group.name, botName: '小王的 Claude', port: 5173 },
      ],
      services: [{ id: w.web.id, name: 'web', groupName: w.group.name, port: 5173, status: 'running' }],
    })

    const stranger = await t.seed.machine(w.li.id)
    expect((await daemon('POST', `/api/daemon/previews/${p!.id}/close`, stranger.token, {})).statusCode).toBe(
      404,
    )
    expect((await daemon('POST', `/api/daemon/services/${w.web.id}/stop`, stranger.token)).statusCode).toBe(
      404,
    )
    expect((await daemon('GET', '/api/daemon/previews', stranger.token)).json()).toEqual({
      previews: [],
      services: [],
      manageableBotIds: [],
    })

    w.seen.length = 0
    const closed = await daemon('POST', `/api/daemon/previews/${p!.id}/close`, w.token, { stopService: true })
    expect(closed.statusCode).toBe(204)
    expect(w.sent).toContainEqual({ t: 'service.stop', serviceId: w.web.id })
    expect(await openRows()).toHaveLength(0)
    expect(w.seen).toContainEqual(expect.objectContaining({ t: 'group.previews', previews: [] }))
    expect((await daemon('POST', `/api/daemon/services/${w.web.id}/stop`)).statusCode).toBe(204)
  })
})

describe('idle previews', () => {
  it('closes previews nobody opened for previewIdleHours and stops services left without one', async () => {
    const w = await world()
    await w.call('preview_expose', { service: 'web', title: '登录页' })
    await w.call('preview_expose', { port: 3000, title: '接口' })
    const rows = await openRows()
    const [web, api] = ['登录页', '接口'].map((title) => rows.find((p) => p.title === title))
    const old = new Date(now.getTime() - 25 * 3600_000)
    await t.db.update(previews).set({ createdAt: old }).where(eq(previews.id, web!.id))
    await t.db
      .update(previews)
      .set({ createdAt: old, lastAccessAt: new Date(now.getTime() - 3600_000) })
      .where(eq(previews.id, api!.id))
    await reapIdlePreviews(t.ctx)
    expect((await openRows()).map((p) => p.id)).toEqual([api!.id])
    expect(w.sent).toContainEqual({ t: 'service.stop', serviceId: w.web.id })
  })
})
