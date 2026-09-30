import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeFrame,
  encodeFrame,
  type GroupPreviewsDto,
  TUNNEL_FRAME,
  type TunnelHead,
  type TunnelOpen,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages, previews, runs } from '../src/db/schema.js'
import { reapIdlePreviews, retakeAwaitingLogin } from '../src/modules/previews/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  machine.loggedIn = true
  machine.fails = undefined
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
  t = await createTestApp()
  t.ctx.config.preview = { domain: null, ports: [0, 0], publicUrl: 'https://gg.example.com' }
})
afterEach(() => t.close())

const JPEG = '\xff\xd8\xff\xe0JPEG'

const QR = '\xff\xd8\xff\xe0LOGIN-QR'
/** What the machine's devtools answer a snapshot with: the simulator, or (202) their login code. */
const machine: { loggedIn: boolean; fails?: string } = { loggedIn: true }

/** The machine's tunnel end: answers every snapshot as `machine` says and keeps the opens it got. */
async function tunnel(machineId: string, token: string) {
  const ws = t.ws('/ws/daemon/tunnel', { authorization: `Bearer ${token}` })
  const opens: TunnelOpen[] = []
  ws.on('message', (raw: Buffer) => {
    const f = decodeFrame(new Uint8Array(raw))
    if (f.type !== TUNNEL_FRAME.open) return
    opens.push(JSON.parse(Buffer.from(f.payload).toString()))
    if (machine.fails) {
      const reason = Buffer.from(JSON.stringify({ reason: machine.fails }))
      ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.reset, reason))
      return
    }
    const head: TunnelHead = {
      status: machine.loggedIn ? 200 : 202,
      headers: [['content-type', 'image/jpeg']],
    }
    ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.head, Buffer.from(JSON.stringify(head))))
    ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.data, Buffer.from(machine.loggedIn ? JPEG : QR, 'latin1')))
    ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.end, new Uint8Array()))
  })
  await vi.waitFor(() => expect(t.ctx.tunnels.get(machineId)).toBeDefined())
  return opens
}

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id] })
  const [trigger] = await t.db
    .insert(messages)
    .values({ groupId: group.id, kind: 'user', authorUserId: wang.id, body: '看看商城小程序' })
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
  t.ctx.hub.register(machine.id, { send: () => {}, close: () => {} })
  const opens = await tunnel(machine.id, token)
  const expose = (args: object) =>
    t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${run!.id}/tools/preview_expose`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
  const liCookie = await t.seed.cookie(li.id)
  const wangCookie = await t.seed.cookie(wang.id)
  return {
    wang: client(t, wangCookie),
    li: client(t, liCookie),
    wangCookie,
    liCookie,
    group,
    opens,
    expose,
  }
}

const shop = { miniprogram: '/Users/dev/work/shop', title: '商城', path: '/pages/goods/detail?id=42' }

describe('mini program previews', () => {
  it('posts a card with the simulator screenshot, without any port or public link', async () => {
    const w = await world()
    const res = await w.expose(shop)
    expect(res.json()).toMatchObject({ isError: false })
    expect(res.json().text).toContain('已发布预览「商城」')

    const [p] = await t.db.select().from(previews)
    expect(p).toMatchObject({
      kind: 'miniprogram',
      project: '/Users/dev/work/shop',
      port: null,
      publicPort: null,
      path: '/pages/goods/detail?id=42',
    })
    const [card] = await t.db.select().from(messages).where(eq(messages.id, p!.messageId!))
    expect(card).toMatchObject({ kind: 'bot', body: '预览：商城', meta: { preview: p!.id } })

    await vi.waitFor(() => expect(w.opens).toHaveLength(1))
    expect(w.opens[0]).toMatchObject({
      snapshot: { previewId: p!.id, miniprogram: '/Users/dev/work/shop' },
      path: '/pages/goods/detail?id=42',
    })
    const list = (await w.li.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)).body
    await vi.waitFor(async () => {
      const [fresh] = await t.db.select().from(previews)
      expect(fresh!.snapshotAt).not.toBeNull()
    })
    expect(list.previews[0]).toMatchObject({ kind: 'miniprogram', status: 'online', port: null })
    const shot = await t.app.inject({
      method: 'GET',
      url: `/api/previews/${p!.id}/snapshot`,
      headers: { cookie: w.liCookie },
    })
    expect(shot.headers['content-type']).toBe('image/jpeg')
    expect(shot.rawPayload.toString('latin1')).toBe(JPEG)

    expect((await w.wang.get(`/api/previews/${p!.id}/open`)).status).toBe(400)
    expect((await w.wang.post(`/api/previews/${p!.id}/shares`, { days: 1 })).status).toBe(400)
  })

  it('publishing the same project again moves its card to the new page', async () => {
    const w = await world()
    await w.expose(shop)
    const res = await w.expose({ ...shop, title: '我的页', path: '/pages/me/me' })
    expect(res.json().text).toContain('已切换到 /pages/me/me')

    const all = await t.db.select().from(previews)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ title: '我的页', path: '/pages/me/me' })
    await vi.waitFor(() => expect(w.opens.at(-1)?.path).toBe('/pages/me/me'))
  })

  it('managers switch the page from the workbench; the screenshot counts as a visit', async () => {
    const w = await world()
    await w.expose(shop)
    const [p] = await t.db.select().from(previews)
    await vi.waitFor(() => expect(w.opens).toHaveLength(1))

    expect((await w.li.post(`/api/previews/${p!.id}/snapshot`, { path: '/pages/me/me' })).status).toBe(403)
    expect((await w.wang.post(`/api/previews/${p!.id}/snapshot`, { path: 'pages/me' })).status).toBe(400)
    const later = new Date(Date.now() + 3600_000)
    t.ctx.now = () => later
    expect((await w.wang.post(`/api/previews/${p!.id}/snapshot`, { path: '/pages/me/me' })).status).toBe(204)
    expect(w.opens.at(-1)?.path).toBe('/pages/me/me')
    const [fresh] = await t.db.select().from(previews)
    expect(fresh).toMatchObject({ path: '/pages/me/me', lastAccessAt: later })

    t.ctx.now = () => new Date(later.getTime() + 1000)
    await reapIdlePreviews(t.ctx)
    expect((await t.db.select().from(previews))[0]!.closedAt).toBeNull()
  })

  it('a closed card reopens on the same page', async () => {
    const w = await world()
    await w.expose(shop)
    const [p] = await t.db.select().from(previews)
    expect((await w.wang.post(`/api/previews/${p!.id}/close`)).status).toBe(204)
    expect((await w.wang.post(`/api/previews/${p!.id}/start`)).status).toBe(204)
    const [fresh] = await t.db.select().from(previews)
    expect(fresh).toMatchObject({ closedAt: null, publicPort: null, path: '/pages/goods/detail?id=42' })
    await vi.waitFor(() => expect(w.opens.length).toBeGreaterThanOrEqual(2))
  })

  it('shows the devtools login code to managers until someone scans it, then the simulator', async () => {
    machine.loggedIn = false
    const w = await world()
    await w.expose(shop)
    const [p] = await t.db.select().from(previews)
    await vi.waitFor(async () => expect((await t.db.select().from(previews))[0]!.awaiting).toBe('login'))
    const shot = (cookie: string) =>
      t.app.inject({ method: 'GET', url: `/api/previews/${p!.id}/snapshot`, headers: { cookie } })
    expect((await shot(w.wangCookie)).rawPayload.toString('latin1')).toBe(QR)
    expect((await shot(w.liCookie)).statusCode).toBe(403)
    const seen = (await w.li.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)).body.previews[0]
    expect(seen).toMatchObject({ awaiting: 'login', status: 'online' })

    // Nobody scanned yet: asking again changes nothing, and never starts devtools the owner has quit.
    await retakeAwaitingLogin(t.ctx)
    expect((await t.db.select().from(previews))[0]!.awaiting).toBe('login')
    expect(w.opens.at(-1)).toMatchObject({ snapshot: { miniprogram: shop.miniprogram, launch: false } })
    expect(w.opens[0]).not.toHaveProperty('snapshot.launch')

    machine.loggedIn = true
    await retakeAwaitingLogin(t.ctx)
    const [fresh] = await t.db.select().from(previews)
    expect(fresh!.awaiting).toBeNull()
    expect((await shot(w.liCookie)).rawPayload.toString('latin1')).toBe(JPEG)
    const opensBefore = w.opens.length
    await retakeAwaitingLogin(t.ctx)
    expect(w.opens).toHaveLength(opensBefore)
  })

  it('says on the card why the simulator could not be captured, until a capture works', async () => {
    machine.fails = '本机的微信开发者工具未运行'
    const w = await world()
    await w.expose(shop)
    const [p] = await t.db.select().from(previews)
    await vi.waitFor(async () =>
      expect((await t.db.select().from(previews))[0]!.snapshotError).toBe('本机的微信开发者工具未运行'),
    )
    const seen = (await w.li.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)).body.previews[0]
    expect(seen).toMatchObject({ snapshotError: '本机的微信开发者工具未运行', snapshotAt: null })

    machine.fails = undefined
    expect((await w.wang.post(`/api/previews/${p!.id}/snapshot`)).status).toBe(204)
    expect((await t.db.select().from(previews))[0]).toMatchObject({ snapshotError: null })
  })
})
