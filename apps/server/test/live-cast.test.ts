import type { DaemonToServer, GroupPreviewsDto, ServerToDaemon, ServiceInfo } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages, previews, runs, services, systemParams } from '../src/db/schema.js'
import { reapWatches } from '../src/modules/live/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
let clock = Date.parse('2026-09-29T10:00:00Z')
beforeEach(async () => {
  clock = Date.parse('2026-09-29T10:00:00Z')
  t = await createTestApp({ now: () => new Date(clock) })
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const other = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id] })
  const [trigger] = await t.db
    .insert(messages)
    .values({ groupId: group.id, kind: 'user', authorUserId: wang.id, body: '跑一下计算器' })
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
  const sent: ServerToDaemon[] = []
  t.ctx.hub.register(machine.id, { send: (m) => sent.push(m), close: () => {} })
  const service: ServiceInfo = {
    id: crypto.randomUUID(),
    groupId: group.id,
    botId: bot.id,
    runId: run!.id,
    name: 'calc',
    command: 'npm start',
    cwd: '',
    port: null,
    status: 'running',
    exitCode: null,
  }
  t.ctx.hub.emit('message', machine.id, { t: 'service.state', service })
  const tool = (name: string, args: object) =>
    t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${run!.id}/tools/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
  await vi.waitFor(async () => expect(await t.db.select().from(services)).toHaveLength(1))
  return {
    wang,
    li,
    machine,
    token,
    otherMachine: other.machine,
    group,
    service,
    sent,
    tool,
    liClient: client(t, await t.seed.cookie(li.id)),
    casts: () => sent.filter((m) => m.t === 'cast.sync'),
  }
}

async function publish(w: Awaited<ReturnType<typeof world>>) {
  const res = await w.tool('preview_gui', { service: 'calc', title: '计算器' })
  expect(res.json()).toMatchObject({ isError: false })
  const [p] = await t.db.select().from(previews).where(eq(previews.kind, 'gui'))
  return p!
}

describe('desktop app previews', () => {
  it('posts a card for a live hosted service, once per service', async () => {
    const w = await world()
    const p = await publish(w)
    expect(p).toMatchObject({ kind: 'gui', serviceId: w.service.id, port: null, title: '计算器' })
    const [card] = await t.db.select().from(messages).where(eq(messages.id, p.messageId!))
    expect(card).toMatchObject({ kind: 'bot', body: '预览：计算器', meta: { preview: p.id } })

    const again = await w.tool('preview_gui', { service: 'calc', title: '计算器' })
    expect(again.json().text).toContain(p.id)
    expect(await t.db.select().from(previews)).toHaveLength(1)

    const missing = await w.tool('preview_gui', { service: 'nope', title: 'x' })
    expect(missing.json()).toMatchObject({ isError: true })
    expect(missing.json().text).toContain('service_start')
  })

  it('asks the machine to publish while someone watches, and to stop when nobody renews', async () => {
    const w = await world()
    const p = await publish(w)
    expect(w.casts()).toEqual([])

    expect((await w.liClient.post(`/api/previews/${p.id}/watch`)).status).toBe(204)
    expect(w.casts().at(-1)).toEqual({
      t: 'cast.sync',
      casts: [{ previewId: p.id, service: w.service.id, fps: 30 }],
    })
    const before = w.casts().length
    await w.liClient.post(`/api/previews/${p.id}/watch`)
    expect(w.casts()).toHaveLength(before)

    clock += 30_000
    await reapWatches(t.ctx)
    expect(w.casts()).toHaveLength(before)
    clock += 61_000
    await reapWatches(t.ctx)
    expect(w.casts().at(-1)).toEqual({ t: 'cast.sync', casts: [] })
  })

  it('publishes at the highest frame rate its viewers ask for, lowering it once they leave', async () => {
    const w = await world()
    const p = await publish(w)
    const wang = client(t, await t.seed.cookie(w.wang.id))
    const fps = () => (w.casts().at(-1) as { casts: { fps: number }[] }).casts[0]?.fps
    await w.liClient.post(`/api/previews/${p.id}/watch`, { fps: 60 })
    expect(fps()).toBe(60)
    await wang.post(`/api/previews/${p.id}/watch`, { fps: 90 })
    expect(fps()).toBe(90)
    const before = w.casts().length
    await w.liClient.post(`/api/previews/${p.id}/watch`, { fps: 30 })
    expect(w.casts()).toHaveLength(before)
    expect((await w.liClient.post(`/api/previews/${p.id}/watch`, { fps: 45 })).status).toBe(400)

    clock += 30_000
    await w.liClient.post(`/api/previews/${p.id}/watch`, { fps: 30 })
    clock += 31_000
    await reapWatches(t.ctx)
    expect(fps()).toBe(30)
  })

  it('stops publishing a closed preview, and tells a reconnected machine what to publish', async () => {
    const w = await world()
    const p = await publish(w)
    await w.liClient.post(`/api/previews/${p.id}/watch`)

    const again: ServerToDaemon[] = []
    t.ctx.hub.register(w.machine.id, { send: (m) => again.push(m), close: () => {} })
    await vi.waitFor(() =>
      expect(again).toContainEqual({
        t: 'cast.sync',
        casts: [{ previewId: p.id, service: w.service.id, fps: 30 }],
      }),
    )

    const wang = client(t, await t.seed.cookie(w.wang.id))
    expect((await wang.post(`/api/previews/${p.id}/close`)).status).toBe(204)
    expect(again.at(-1)).toEqual({ t: 'cast.sync', casts: [] })
    expect((await w.liClient.post(`/api/previews/${p.id}/watch`)).status).toBe(404)
  })

  it("shows the machine's gg-cast state on the card", async () => {
    const w = await world()
    const p = await publish(w)
    const live = async () =>
      (await w.liClient.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)).body.previews[0]?.live
    expect(await live()).toBeNull()

    t.ctx.hub.emit('message', w.otherMachine.id, {
      t: 'cast.state',
      previewId: p.id,
      state: 'live',
      error: null,
      missing: [],
    })
    t.ctx.hub.emit('message', w.machine.id, {
      t: 'cast.state',
      previewId: p.id,
      state: 'failed',
      error: '机器未授权屏幕录制，请在桌面端完成授权',
      missing: ['screen_recording', 'accessibility'],
    })
    await vi.waitFor(async () =>
      expect(await live()).toEqual({
        state: 'failed',
        error: '机器未授权屏幕录制，请在桌面端完成授权',
        missing: ['screen_recording', 'accessibility'],
      }),
    )

    t.ctx.hub.emit('message', w.machine.id, {
      t: 'cast.state',
      previewId: p.id,
      state: 'failed',
      error: '微信开发者工具未开启服务端口',
      missing: [],
      devtools: 'port',
    })
    await vi.waitFor(async () => expect((await live())?.devtools).toBe('port'))

    const at = new Date(clock + 4000).toISOString()
    const window: Extract<DaemonToServer, { t: 'cast.state' }> = {
      t: 'cast.state',
      previewId: p.id,
      state: 'failed',
      error: '应用还没有可见窗口',
      missing: [],
    }
    t.ctx.hub.emit('message', w.machine.id, { ...window, retryIn: 4 })
    await vi.waitFor(async () => expect((await live())?.retryAt).toBe(at))
    clock += 2000
    t.ctx.hub.emit('message', w.machine.id, { ...window, retryIn: 2 })
    await new Promise((r) => setTimeout(r, 50))
    expect((await live())?.retryAt, 'the same failure again keeps its time').toBe(at)
  })

  it('asks the machine to retry a watched live preview now', async () => {
    const w = await world()
    const p = await publish(w)
    expect((await w.liClient.post(`/api/previews/${p.id}/live/retry`)).status).toBe(400)
    await w.liClient.post(`/api/previews/${p.id}/watch`)
    expect((await w.liClient.post(`/api/previews/${p.id}/live/retry`)).status).toBe(204)
    expect(w.sent.at(-1)).toEqual({ t: 'cast.retry', previewId: p.id })
  })

  it("streams a watched mini program's simulator, which members may ask to control", async () => {
    const w = await world()
    const [mp] = await t.db
      .insert(previews)
      .values({
        slug: 'mp1',
        kind: 'miniprogram',
        machineId: w.machine.id,
        groupId: w.group.id,
        botId: w.service.botId,
        project: '/Users/dev/work/shop',
        path: '/pages/index/index',
        title: '商城',
      })
      .returning()
    expect((await w.liClient.post(`/api/previews/${mp!.id}/watch`)).status).toBe(204)
    expect(w.casts().at(-1)).toEqual({
      t: 'cast.sync',
      casts: [{ previewId: mp!.id, miniprogram: '/Users/dev/work/shop', fps: 30 }],
    })
    const list = (await w.liClient.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)).body
    expect(list.previews.find((p) => p.id === mp!.id)?.control).toEqual({ controller: null, requests: [] })
  })

  it('serves the published gg-cast build for the machine platform', async () => {
    const w = await world()
    const get = () =>
      t.app.inject({
        method: 'GET',
        url: '/api/daemon/cast-build',
        headers: { authorization: `Bearer ${w.token}` },
      })
    expect((await get()).statusCode).toBe(404)
    const build = { url: '/downloads/gg-cast-macos-aarch64', sha256: 'a'.repeat(64) }
    await t.db.insert(systemParams).values({
      key: 'daemonRelease',
      value: { version: '0.2.0', builds: {}, cast: { 'macos-aarch64': build } },
    })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ version: '0.2.0', ...build })
  })
})
