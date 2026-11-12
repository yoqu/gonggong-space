import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BindCodeDto,
  LinkPollRes,
  LinkRequestDto,
  LinkRequestRes,
  NotificationDto,
  WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, bots, groups, machines, notifications, systemParams } from '../src/db/schema.js'
import { sha256 } from '../src/lib/crypto.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { createTestApp, type TestApp } from './support/app.js'

// 接入码过期 → 网页确认: gg asks to be linked, someone signed in allows it, gg's next poll binds the machine.

let t: TestApp
let clock: number
let owner: { id: string; name: string }
let cookie: string
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  clock = Date.parse('2026-11-12T10:00:00Z')
  t = await createTestApp({ now: () => new Date(clock) })
  owner = await t.seed.user({ account: 'wanglei', name: '王磊' })
  cookie = await t.seed.cookie(owner.id)
})
afterEach(() => t.close())

const machine = { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64', hardwareId: 'hw-1' }
const expiredCode = async () => {
  const c = (
    await t.app.inject({ method: 'POST', url: '/api/bind-codes', headers: { cookie } })
  ).json() as BindCodeDto
  clock += 31 * 60_000
  return c.code
}
const request = (o: { code?: string; createBot?: { agent: string } } = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/daemon/link-requests',
    headers: { host: 'gg.example.com' },
    payload: { machine, ...o },
  })
const requested = async (o: { code?: string; createBot?: { agent: string } } = {}) => {
  const res = await request(o)
  expect(res.statusCode).toBe(200)
  return res.json() as LinkRequestRes
}
const poll = (r: LinkRequestRes, secret = r.secret) =>
  t.app.inject({ method: 'POST', url: `/api/daemon/link-requests/${r.id}/poll`, payload: { secret } })
const decide = (id: string, action: 'approve' | 'deny', as = cookie) =>
  t.app.inject({ method: 'POST', url: `/api/link-requests/${id}/${action}`, headers: { cookie: as } })
const events = (userId: string) => {
  const got: WebEvent[] = []
  t.ctx.bus.attach(userId, (e) => got.push(e))
  return got
}

describe('接入申请', () => {
  it('asks who issued the expired code, and once allowed the next poll binds the machine to them, once', async () => {
    const got = events(owner.id)
    const r = await requested({ code: await expiredCode() })
    expect(r.userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}$/)
    expect(r.url).toBe(`http://gg.example.com/link/${r.id}`)
    expect(Date.parse(r.expiresAt) - clock).toBe(15 * 60_000)
    expect(r.intervalMs).toBeGreaterThan(0)

    const asked = got.find((e) => e.t === 'machine.linkRequested')
    expect(asked).toMatchObject({
      request: {
        id: r.id,
        machine: { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' },
        userCode: r.userCode,
      },
    })
    const [n] = await t.db.select().from(notifications).where(eq(notifications.userId, owner.id))
    expect(n).toMatchObject({
      type: 'link_request',
      payload: { requestId: r.id, machineName: 'wanglei-mbp' },
    })

    expect((await poll(r)).json()).toEqual({ status: 'pending' })
    const view = await t.app.inject({ method: 'GET', url: `/api/link-requests/${r.id}`, headers: { cookie } })
    expect(view.json()).toMatchObject({
      id: r.id,
      userCode: r.userCode,
      status: 'pending',
      agent: null,
      machine: { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' },
    } satisfies Partial<LinkRequestDto>)

    const ok = await decide(r.id, 'approve')
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as LinkRequestDto).status).toBe('approved')
    const [resolved] = await t.db.select().from(notifications).where(eq(notifications.userId, owner.id))
    expect(resolved!.resolvedAt).not.toBeNull()

    const res = (await poll(r)).json() as LinkPollRes
    if (res.status !== 'approved') throw new Error(`not approved: ${res.status}`)
    expect(res).toMatchObject({ ownerName: '王磊', restored: false })
    const [m] = await t.db.select().from(machines).where(eq(machines.id, res.machineId))
    expect(m).toMatchObject({ ownerId: owner.id, name: 'wanglei-mbp', tokenHash: sha256(res.token) })
    expect(got).toContainEqual(expect.objectContaining({ t: 'machine.updated' }))
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'machine.link.approve'))
    expect(log).toMatchObject({ actorUserId: owner.id, detail: expect.objectContaining({ requestId: r.id }) })

    expect((await poll(r)).statusCode).toBe(409)
  })

  it('gives the machine to whoever allows it, even without a code to tell whom to ask', async () => {
    const other = await t.seed.user({ account: 'lijianguo', name: '李建国' })
    const r = await requested()
    expect(await t.db.select().from(notifications)).toEqual([])
    expect((await decide(r.id, 'approve', await t.seed.cookie(other.id))).statusCode).toBe(200)
    const res = (await poll(r)).json() as LinkPollRes
    if (res.status !== 'approved') throw new Error(res.status)
    expect(res.ownerName).toBe('李建国')
    const [m] = await t.db.select().from(machines).where(eq(machines.id, res.machineId))
    expect(m!.ownerId).toBe(other.id)
  })

  it('makes the bot and the DM asked for, as gg login --create-bot does', async () => {
    const got = events(owner.id)
    const r = await requested({ code: await expiredCode(), createBot: { agent: 'claude' } })
    expect(
      (
        (
          await t.app.inject({ method: 'GET', url: `/api/link-requests/${r.id}`, headers: { cookie } })
        ).json() as LinkRequestDto
      ).agent,
    ).toBe('claude')
    await decide(r.id, 'approve')
    const res = (await poll(r)).json() as LinkPollRes
    if (res.status !== 'approved') throw new Error(res.status)
    const [bot] = await t.db.select().from(bots).where(eq(bots.id, res.bot!.id))
    expect(bot).toMatchObject({ ownerId: owner.id, machineId: res.machineId, agentKind: 'claude' })
    const [dm] = await t.db.select().from(groups).where(eq(groups.id, res.bot!.groupId))
    expect(dm).toMatchObject({ kind: 'dm' })
    expect(got).toContainEqual(expect.objectContaining({ t: 'machine.onboarded', botId: bot!.id }))
  })

  it('tells gg when it was denied, and binds nothing', async () => {
    const r = await requested({ code: await expiredCode() })
    expect((await decide(r.id, 'deny')).json()).toMatchObject({ status: 'denied' })
    expect((await poll(r)).json()).toEqual({ status: 'denied' })
    expect((await decide(r.id, 'approve')).statusCode).toBe(409)
    expect(await t.db.select().from(machines)).toEqual([])
  })

  it('expires after 15 minutes: polling says so and it can no longer be allowed', async () => {
    const r = await requested()
    clock += 15 * 60_000 + 1
    expect((await poll(r)).json()).toEqual({ status: 'expired' })
    const view = await t.app.inject({ method: 'GET', url: `/api/link-requests/${r.id}`, headers: { cookie } })
    expect((view.json() as LinkRequestDto).status).toBe('expired')
    expect((await decide(r.id, 'approve')).statusCode).toBe(410)
  })

  it('only answers the gg holding the secret, and only shows requests to someone signed in', async () => {
    const r = await requested()
    expect((await poll(r, 'lr_wrong')).statusCode).toBe(401)
    expect((await t.app.inject({ method: 'GET', url: `/api/link-requests/${r.id}` })).statusCode).toBe(401)
    expect(
      (await t.app.inject({ method: 'POST', url: `/api/link-requests/${r.id}/approve` })).statusCode,
    ).toBe(401)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(
      (await t.app.inject({ method: 'GET', url: `/api/link-requests/${missing}`, headers: { cookie } }))
        .statusCode,
    ).toBe(404)
  })

  it('keeps at most 3 pending requests per person asked', async () => {
    const code = await expiredCode()
    for (let i = 0; i < 3; i++) await requested({ code })
    const res = await request({ code })
    expect(res.statusCode).toBe(423)
    expect(res.json()).toMatchObject({ error: 'code_locked' })
    // Expired ones no longer count.
    clock += 15 * 60_000 + 1
    expect((await request({ code })).statusCode).toBe(200)
  })

  it('links to the configured public address', async () => {
    await t.db
      .insert(systemParams)
      .values({ key: 'publicUrl', value: 'https://gg.example.org' })
      .onConflictDoUpdate({ target: systemParams.key, set: { value: 'https://gg.example.org' } })
    forgetSysParams(t.ctx.db)
    const r = await requested()
    expect(r.url).toBe(`https://gg.example.org/link/${r.id}`)
  })

  it('lists the request in the notification center with a link to allow it', async () => {
    const r = await requested({ code: await expiredCode() })
    const list = await t.app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie } })
    const items = list.json() as NotificationDto[]
    expect(items.find((n) => n.type === 'link_request')?.payload).toMatchObject({ requestId: r.id })
  })
})
