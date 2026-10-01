import { verify } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { teamMembers, teams, users } from '../src/db/schema.js'
import { ensureBootstrapAdmin } from '../src/modules/auth/bootstrap.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
let clock: number
beforeEach(async () => {
  clock = Date.parse('2026-09-23T10:00:00Z')
  t = await createTestApp({ now: () => new Date(clock) })
})
afterEach(() => t.close())

const login = (account: string, password: string) =>
  t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { account, password } })
const sessionCookie = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === 'gonggong_session')
  return c ? `gonggong_session=${c.value}` : ''
}
const get = (url: string, cookie: string) => t.app.inject({ method: 'GET', url, headers: { cookie } })
const changePassword = (cookie: string, oldPassword: string, newPassword: string) =>
  t.app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie },
    payload: { oldPassword, newPassword },
  })

describe('bootstrap admin', () => {
  it('creates the sysadmin once when the database has no users', async () => {
    await ensureBootstrapAdmin(t.ctx, 'admin-init-pass')
    await ensureBootstrapAdmin(t.ctx, 'other-pass')
    const rows = await t.db.select().from(users)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      account: 'admin',
      name: '系统管理员',
      role: 'sysadmin',
      mustChangePassword: true,
    })
    expect(await verify(rows[0]!.passwordHash!, 'admin-init-pass')).toBe(true)
    const [team] = await t.db.select().from(teams)
    expect(team).toMatchObject({ name: '默认团队', createdBy: rows[0]!.id })
    expect(await t.db.select().from(teamMembers)).toMatchObject([
      { teamId: team!.id, userId: rows[0]!.id, role: 'owner' },
    ])
  })

  it('does nothing without a password or when users exist', async () => {
    await ensureBootstrapAdmin(t.ctx, undefined)
    expect(await t.db.select().from(users)).toHaveLength(0)
    await t.seed.user()
    await ensureBootstrapAdmin(t.ctx, 'admin-init-pass')
    expect(await t.db.select().from(users).where(eq(users.account, 'admin'))).toHaveLength(0)
  })
})

describe('login / logout / me', () => {
  it('sets an httpOnly lax session cookie and returns the user', async () => {
    const u = await t.seed.user({ account: 'wanglei', name: '王磊' })
    const res = await login('wanglei', 'password123')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      id: u.id,
      account: 'wanglei',
      name: '王磊',
      role: 'member',
      mustChangePassword: false,
      disabled: false,
      gitProtocol: 'auto',
      teams: [expect.objectContaining({ name: '默认团队', role: 'owner' })],
      singleTeamMode: true,
      canCreateTeam: false,
    })
    const c = res.cookies.find((x) => x.name === 'gonggong_session')
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    expect(c?.secure).toBeFalsy()
    const me = await get('/api/me', sessionCookie(res))
    expect(me.json()).toMatchObject({ id: u.id, name: '王磊' })
  })

  it('rejects wrong passwords and unknown accounts with the same generic error', async () => {
    await t.seed.user({ account: 'wanglei' })
    for (const res of [await login('wanglei', 'nope-nope'), await login('ghost', 'password123')]) {
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized', message: '账号或密码错误' })
    }
  })

  it('rejects disabled users', async () => {
    await t.seed.user({ account: 'gone', disabledAt: new Date() })
    const res = await login('gone', 'password123')
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('forbidden')
  })

  it('throttles an account after 5 failures within 5 minutes', async () => {
    await t.seed.user({ account: 'wanglei' })
    for (let i = 0; i < 5; i++) expect((await login('wanglei', 'wrong-pass')).statusCode).toBe(401)
    const blocked = await login('wanglei', 'password123')
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().message).toContain('稍后')
    clock += 5 * 60_000 + 1
    expect((await login('wanglei', 'password123')).statusCode).toBe(200)
  })

  it('logout revokes the session', async () => {
    await t.seed.user({ account: 'wanglei' })
    const cookie = sessionCookie(await login('wanglei', 'password123'))
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(out.statusCode).toBe(204)
    expect((await get('/api/me', cookie)).statusCode).toBe(401)
  })

  it('/api/me is 401 without a session', async () => {
    expect((await get('/api/me', '')).json()).toMatchObject({ error: 'unauthorized' })
  })
})

describe('password change', () => {
  it('pending users can only reach /me and the password route until they change it', async () => {
    await t.seed.user({ account: 'newbie', password: 'init-pass-1', mustChangePassword: true })
    const cookie = sessionCookie(await login('newbie', 'init-pass-1'))
    expect((await get('/api/me', cookie)).json().mustChangePassword).toBe(true)
    const blocked = await get('/api/users', cookie)
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error).toBe('must_change_password')

    const res = await changePassword(cookie, 'init-pass-1', 'new-pass-22')
    expect(res.statusCode).toBe(200)
    expect(res.json().mustChangePassword).toBe(false)
    expect((await get('/api/users', cookie)).statusCode).toBe(200)
    expect((await login('newbie', 'new-pass-22')).statusCode).toBe(200)
  })

  it('revokes the other sessions of the user but keeps the current one', async () => {
    await t.seed.user({ account: 'wanglei' })
    const a = sessionCookie(await login('wanglei', 'password123'))
    const b = sessionCookie(await login('wanglei', 'password123'))
    expect((await changePassword(a, 'password123', 'another-pass')).statusCode).toBe(200)
    expect((await get('/api/me', a)).statusCode).toBe(200)
    expect((await get('/api/me', b)).statusCode).toBe(401)
  })

  it('rejects a wrong current password, a short or unchanged new password', async () => {
    await t.seed.user({ account: 'wanglei' })
    const cookie = sessionCookie(await login('wanglei', 'password123'))
    const wrong = await changePassword(cookie, 'nope-nope', 'another-pass')
    expect(wrong.statusCode).toBe(400)
    expect(wrong.json().message).toBe('当前密码错误')
    expect((await changePassword(cookie, 'password123', 'short')).statusCode).toBe(400)
    expect((await changePassword(cookie, 'password123', 'password123')).statusCode).toBe(400)
  })
})
