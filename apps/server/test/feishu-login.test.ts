import type { AuthOptionsDto, FeishuIdentityView, FeishuTicketDto, MeDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, feishuIdentities, teamInvites, teamMembers, users } from '../src/db/schema.js'
import { sha256 } from '../src/lib/crypto.js'
import { userToken } from '../src/modules/feishu/identity.js'
import { createTestApp, type TestApp } from './support/app.js'
import type { FakeUser } from './support/feishu.js'
import { client } from './support/http.js'

let t: TestApp
let clock: number
beforeEach(async () => {
  clock = Date.parse('2026-10-01T10:00:00Z')
  t = await createTestApp({ now: () => new Date(clock) })
})
afterEach(() => t.close())

const PUBLIC = 'https://gg.example.com'

async function configure({ publicUrl = PUBLIC, autoSignup = true } = {}) {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const http = client(t, await t.seed.cookie(admin.id))
  await http.put('/api/admin/feishu', { appId: 'cli_main01', appSecret: 's' })
  await http.put('/api/admin/params', { publicUrl, feishuAutoSignup: autoSignup })
  return admin
}

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === 'gonggong_session')
  return c ? `gonggong_session=${c.value}` : ''
}

/** Runs /start → (consent) → /callback in one browser; returns the final redirect and any session cookie. */
async function feishuLogin(user: FakeUser, o: { next?: string; cookie?: string; mode?: 'link' } = {}) {
  const qs = new URLSearchParams({ ...(o.next && { next: o.next }), ...(o.mode && { mode: o.mode }) })
  const start = await t.app.inject({
    method: 'GET',
    url: `/api/auth/feishu/start?${qs}`,
    headers: o.cookie ? { cookie: o.cookie } : {},
  })
  expect(start.statusCode).toBe(302)
  const auth = new URL(start.headers.location as string)
  expect(auth.searchParams.get('redirect_uri')).toBe(`${PUBLIC}/api/auth/feishu/callback`)
  const state = auth.searchParams.get('state') as string
  const code = t.feishu.authorize(user)
  const cb = await t.app.inject({
    method: 'GET',
    url: `/api/auth/feishu/callback?${new URLSearchParams({ code, state })}`,
  })
  expect(cb.statusCode).toBe(302)
  return { location: cb.headers.location as string, cookie: cookieOf(cb), state }
}

const ticketOf = (location: string) => new URL(location, PUBLIC).searchParams.get('ticket') as string
const anon = () => client(t, '')

describe('options', () => {
  it('offers 飞书登录 only with the main app and 对外地址 both set', async () => {
    expect((await anon().get<AuthOptionsDto>('/api/auth/options')).body.feishuLogin).toBe(false)
    await configure({ publicUrl: '' })
    expect((await anon().get<AuthOptionsDto>('/api/auth/options')).body.feishuLogin).toBe(false)
    const admin = (await t.db.select().from(users))[0]!
    await client(t, await t.seed.cookie(admin.id)).put('/api/admin/params', { publicUrl: PUBLIC })
    expect((await anon().get<AuthOptionsDto>('/api/auth/options')).body.feishuLogin).toBe(true)
  })

  it('refuses to start while 飞书登录 is unavailable', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/feishu/start' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/login?feishu=unavailable')
  })
})

describe('linked identity', () => {
  it('signs in and returns to `next`, refreshing the stored tokens', async () => {
    await configure()
    const fu = t.feishu.user()
    const { location: first } = await feishuLogin(fu)
    const me = await t.seed.user({ account: 'wang', password: 'password123' })
    const bind = await anon().post<MeDto>(`/api/auth/feishu/ticket/${ticketOf(first)}/bind`, {
      account: 'wang',
      password: 'password123',
    })
    expect(bind.status).toBe(200)

    const { location, cookie } = await feishuLogin(fu, { next: '/g/abc' })
    expect(location).toBe('/g/abc')
    expect((await client(t, cookie).get<MeDto>('/api/me')).body.id).toBe(me.id)
    expect(await userToken(t.ctx, me.id)).toMatch(/^u_/)
  })

  it('only follows same-origin `next` paths', async () => {
    await configure()
    const fu = t.feishu.user()
    const me = await t.seed.user()
    await t.db
      .insert(feishuIdentities)
      .values({ userId: me.id, unionId: fu.unionId, openId: fu.openId, name: fu.name })
    expect((await feishuLogin(fu, { next: '//evil.com' })).location).toBe('/')
    expect((await feishuLogin(fu, { next: 'https://evil.com' })).location).toBe('/')
  })

  it('refuses a disabled account like password login', async () => {
    await configure()
    const fu = t.feishu.user()
    const me = await t.seed.user({ disabledAt: new Date() })
    await t.db
      .insert(feishuIdentities)
      .values({ userId: me.id, unionId: fu.unionId, openId: fu.openId, name: fu.name })
    const res = await feishuLogin(fu)
    expect(res.location).toBe('/login?feishu=disabled')
    expect(res.cookie).toBe('')
  })

  it('rejects a reused or expired state', async () => {
    await configure()
    const fu = t.feishu.user()
    const { state } = await feishuLogin(fu)
    const again = await t.app.inject({
      method: 'GET',
      url: `/api/auth/feishu/callback?${new URLSearchParams({ code: t.feishu.authorize(fu), state })}`,
    })
    expect(again.headers.location).toBe('/login?feishu=expired')

    const start = await t.app.inject({ method: 'GET', url: '/api/auth/feishu/start' })
    const late = new URL(start.headers.location as string).searchParams.get('state') as string
    clock += 11 * 60_000
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/auth/feishu/callback?${new URLSearchParams({ code: t.feishu.authorize(fu), state: late })}`,
    })
    expect(res.headers.location).toBe('/login?feishu=expired')
  })

  it('returns to the login page when the user declines', async () => {
    await configure()
    const start = await t.app.inject({ method: 'GET', url: '/api/auth/feishu/start' })
    const state = new URL(start.headers.location as string).searchParams.get('state') as string
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/auth/feishu/callback?${new URLSearchParams({ error: 'access_denied', state })}`,
    })
    expect(res.headers.location).toBe('/login?feishu=denied')
  })
})

describe('first 飞书登录 (ticket)', () => {
  it('redirects to the choose page with a ticket describing the Feishu user', async () => {
    await configure()
    const fu = t.feishu.user({ name: '王磊', email: 'wanglei@corp.com' })
    const { location, cookie } = await feishuLogin(fu)
    expect(location).toMatch(/^\/feishu\/choose\?ticket=/)
    expect(cookie).toBe('')
    const ticket = await anon().get<FeishuTicketDto>(`/api/auth/feishu/ticket/${ticketOf(location)}`)
    expect(ticket.body).toEqual({
      name: '王磊',
      email: 'wanglei@corp.com',
      avatar: null,
      canCreate: true,
      next: '/',
    })
  })

  it('binds an existing account after the password checks out', async () => {
    await configure()
    const me = await t.seed.user({ account: 'wang', password: 'password123' })
    const fu = t.feishu.user()
    const { location } = await feishuLogin(fu)
    const ticket = ticketOf(location)
    const bad = await anon().post(`/api/auth/feishu/ticket/${ticket}/bind`, {
      account: 'wang',
      password: 'nope',
    })
    expect(bad.status).toBe(401)
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/auth/feishu/ticket/${ticket}/bind`,
      payload: { account: 'wang', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    expect(cookieOf(res)).not.toBe('')
    const [row] = await t.db.select().from(feishuIdentities)
    expect(row).toMatchObject({ userId: me.id, unionId: fu.unionId, name: fu.name })
    expect((await anon().post(`/api/auth/feishu/ticket/${ticket}/bind`, {})).status).toBe(410)
  })

  it('refuses binding an account that already has another Feishu identity', async () => {
    await configure()
    const me = await t.seed.user({ account: 'wang', password: 'password123' })
    const other = t.feishu.user()
    await t.db
      .insert(feishuIdentities)
      .values({ userId: me.id, unionId: other.unionId, openId: other.openId, name: other.name })
    const { location } = await feishuLogin(t.feishu.user())
    const res = await anon().post(`/api/auth/feishu/ticket/${ticketOf(location)}/bind`, {
      account: 'wang',
      password: 'password123',
    })
    expect(res.status).toBe(409)
  })

  it('creates a password-less account named after the Feishu user, de-duplicating the account', async () => {
    await configure()
    await t.seed.user({ account: 'wanglei' })
    const avatar = 'https://s1-imfile.feishucdn.com/static-resource/v1/wang~'
    const fu = t.feishu.user({ name: '王磊', email: 'WangLei@corp.com', avatar })
    const { location } = await feishuLogin(fu)
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/auth/feishu/ticket/${ticketOf(location)}/create`,
    })
    expect(res.statusCode).toBe(201)
    const me = res.json() as MeDto
    expect(me).toMatchObject({ name: '王磊', account: 'wanglei2', email: 'wanglei@corp.com', avatar })
    const [row] = await t.db.select().from(users).where(eq(users.id, me.id))
    expect(row!.passwordHash).toBeNull()
    expect(row!.mustChangePassword).toBe(false)
    expect(await t.db.select().from(teamMembers).where(eq(teamMembers.userId, me.id))).toHaveLength(1)
    expect(await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'user.register'))).toHaveLength(1)
    // Next time the same Feishu user goes straight in.
    expect((await feishuLogin(fu)).location).toBe('/')
    // And password login can never match a missing hash.
    const pw = await anon().post('/api/auth/login', { account: 'wanglei2', password: '' })
    expect(pw.status).toBe(401)
  })

  it('falls back to a generic account when the email gives nothing usable', async () => {
    await configure()
    const { location } = await feishuLogin(t.feishu.user({ email: null }))
    const res = await anon().post<MeDto>(`/api/auth/feishu/ticket/${ticketOf(location)}/create`)
    expect(res.body.account).toMatch(/^feishu/)
  })

  it('offers no 新建账号 while 飞书自动开户 is off, unless the login started from an invite', async () => {
    const admin = await configure({ autoSignup: false })
    const { location } = await feishuLogin(t.feishu.user())
    expect(
      (await anon().get<FeishuTicketDto>(`/api/auth/feishu/ticket/${ticketOf(location)}`)).body.canCreate,
    ).toBe(false)
    expect((await anon().post(`/api/auth/feishu/ticket/${ticketOf(location)}/create`)).status).toBe(403)

    const team = await t.seed.team({ ownerId: admin.id, name: '支付组' })
    await t.db.insert(teamInvites).values({
      teamId: team.id,
      tokenHash: sha256('inv-token'),
      expiresAt: new Date(clock + 86400_000),
      createdBy: admin.id,
    })
    const invited = await feishuLogin(t.feishu.user(), { next: '/join/inv-token' })
    const ticket = ticketOf(invited.location)
    expect((await anon().get<FeishuTicketDto>(`/api/auth/feishu/ticket/${ticket}`)).body.canCreate).toBe(true)
    const res = await anon().post<MeDto>(`/api/auth/feishu/ticket/${ticket}/create`)
    expect(res.status).toBe(201)
    const joined = await t.db.select().from(teamMembers).where(eq(teamMembers.userId, res.body.id))
    expect(joined.map((m) => m.teamId)).toContain(team.id)
  })

  it('expires the ticket after 10 minutes', async () => {
    await configure()
    const { location } = await feishuLogin(t.feishu.user())
    clock += 11 * 60_000
    expect((await anon().get(`/api/auth/feishu/ticket/${ticketOf(location)}`)).status).toBe(410)
  })
})

describe('个人设置 · 飞书', () => {
  it('links the signed-in account and shows it; another account cannot take the same identity', async () => {
    await configure()
    const me = await t.seed.user()
    const cookie = await t.seed.cookie(me.id)
    const http = client(t, cookie)
    expect((await http.get<FeishuIdentityView>('/api/me/feishu')).body).toEqual({ identity: null })

    const avatar = 'https://s1-imfile.feishucdn.com/static-resource/v1/wang~'
    const fu = t.feishu.user({ name: '王磊', email: 'wang@corp.com', avatar })
    const { location } = await feishuLogin(fu, { cookie, mode: 'link', next: '/g/x' })
    expect(location).toBe('/g/x?feishu=linked')
    // Linking fills only what the account lacks.
    expect((await http.get<MeDto>('/api/me')).body).toMatchObject({ email: 'wang@corp.com', avatar })
    expect((await http.get<FeishuIdentityView>('/api/me/feishu')).body.identity).toMatchObject({
      name: '王磊',
    })

    const other = await t.seed.user()
    const taken = await feishuLogin(fu, { cookie: await t.seed.cookie(other.id), mode: 'link' })
    expect(taken.location).toBe('/?feishu=taken')
  })

  it('requires a session to link', async () => {
    await configure()
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/feishu/start?mode=link' })
    expect(res.headers.location).toBe('/login')
  })

  it('unlinks, but not for an account without a password', async () => {
    await configure()
    const me = await t.seed.user()
    const fu = t.feishu.user()
    await t.db
      .insert(feishuIdentities)
      .values({ userId: me.id, unionId: fu.unionId, openId: fu.openId, name: fu.name })
    const http = client(t, await t.seed.cookie(me.id))
    expect((await http.del('/api/me/feishu')).status).toBe(204)
    expect(await t.db.select().from(feishuIdentities)).toHaveLength(0)

    const { location } = await feishuLogin(t.feishu.user())
    const created = await t.app.inject({
      method: 'POST',
      url: `/api/auth/feishu/ticket/${ticketOf(location)}/create`,
    })
    const res = await client(t, cookieOf(created)).del('/api/me/feishu')
    expect(res.status).toBe(400)
    expect(await t.db.select().from(feishuIdentities)).toHaveLength(1)
  })
})
