import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
let admin: string
let adminId: string
beforeEach(async () => {
  t = await createTestApp()
  const a = await t.seed.user({ account: 'chenchen', name: '陈晨', role: 'sysadmin' })
  adminId = a.id
  admin = await t.seed.cookie(a.id)
})
afterEach(() => t.close())

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, payload })

describe('admin accounts', () => {
  it('is sysadmin only', async () => {
    const m = await t.seed.user()
    const cookie = await t.seed.cookie(m.id)
    for (const [method, url] of [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'],
      ['PATCH', `/api/admin/users/${m.id}`],
    ] as const) {
      const res = await req(method, url, cookie, {})
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    }
  })

  it('creates an account that must change its password, and audits it', async () => {
    const res = await req('POST', '/api/admin/users', admin, {
      account: 'wanglei',
      name: '王磊',
      role: 'member',
      password: 'wanglei-init',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      account: 'wanglei',
      name: '王磊',
      role: 'member',
      mustChangePassword: true,
    })
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: 'wanglei', password: 'wanglei-init' },
    })
    expect(login.statusCode).toBe(200)
    const [log] = await t.db.select().from(auditLogs)
    expect(log).toMatchObject({ category: 'admin', actorUserId: adminId, action: 'user.create' })
    expect(log?.detail).toMatchObject({ account: 'wanglei' })
  })

  it('rejects duplicate accounts and invalid bodies', async () => {
    const body = { account: 'wanglei', name: '王磊', role: 'member', password: 'wanglei-init' }
    await req('POST', '/api/admin/users', admin, body)
    const dup = await req('POST', '/api/admin/users', admin, body)
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe('conflict')
    expect((await req('POST', '/api/admin/users', admin, { ...body, account: 'Bad Name' })).statusCode).toBe(
      400,
    )
    expect((await req('POST', '/api/admin/users', admin, { ...body, password: 'short' })).statusCode).toBe(
      400,
    )
  })

  it('lists users with machine count and online state', async () => {
    const m = await t.seed.user({ account: 'wanglei', name: '王磊' })
    const { machine } = await t.seed.machine(m.id)
    await t.seed.machine(m.id, { revokedAt: new Date() })
    t.ctx.hub.register(machine.id, { send() {}, close() {} })
    const res = await req('GET', '/api/admin/users', admin)
    expect(res.statusCode).toBe(200)
    const rows = res.json() as { account: string; machineCount: number; online: boolean }[]
    expect(rows.find((r) => r.account === 'wanglei')).toMatchObject({ machineCount: 1, online: true })
    expect(rows.find((r) => r.account === 'chenchen')).toMatchObject({ machineCount: 0, online: false })
    expect(JSON.stringify(rows)).not.toContain('passwordHash')
  })

  it('updates name and role, audits it, and refuses changing own role', async () => {
    const m = await t.seed.user({ account: 'wanglei' })
    const res = await req('PATCH', `/api/admin/users/${m.id}`, admin, { name: '王磊磊', role: 'sysadmin' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: '王磊磊', role: 'sysadmin' })
    const logs = await t.db.select().from(auditLogs)
    expect(logs.map((l) => l.action)).toContain('user.update')
    expect((await req('PATCH', `/api/admin/users/${adminId}`, admin, { role: 'member' })).statusCode).toBe(
      400,
    )
    expect(
      (await req('PATCH', '/api/admin/users/00000000-0000-0000-0000-000000000000', admin, { name: 'x' }))
        .statusCode,
    ).toBe(404)
  })
})

describe('admin password reset', () => {
  it('sets a temporary password, forces a change, signs the member out everywhere, and audits it', async () => {
    const m = await t.seed.user({ account: 'wanglei' })
    const member = await t.seed.cookie(m.id)
    const res = await req('POST', `/api/admin/users/${m.id}/password`, admin, { password: 'temp-pass-9' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ account: 'wanglei', mustChangePassword: true })
    expect((await req('GET', '/api/me', member)).statusCode).toBe(401)
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: 'wanglei', password: 'temp-pass-9' },
    })
    expect(login.json()).toMatchObject({ mustChangePassword: true })
    const logs = await t.db.select().from(auditLogs)
    const log = logs.find((l) => l.action === 'user.password.reset')
    expect(log).toMatchObject({ actorUserId: adminId })
    expect(JSON.stringify(log?.detail)).not.toContain('temp-pass-9')
  })

  it('refuses short passwords, own account, unknown accounts and non-admins', async () => {
    const m = await t.seed.user()
    const url = `/api/admin/users/${m.id}/password`
    expect((await req('POST', url, admin, { password: 'short' })).statusCode).toBe(400)
    expect(
      (await req('POST', `/api/admin/users/${adminId}/password`, admin, { password: 'long-enough' }))
        .statusCode,
    ).toBe(400)
    expect(
      (
        await req('POST', '/api/admin/users/00000000-0000-0000-0000-000000000000/password', admin, {
          password: 'long-enough',
        })
      ).statusCode,
    ).toBe(404)
    expect((await req('POST', url, await t.seed.cookie(m.id), { password: 'long-enough' })).statusCode).toBe(
      403,
    )
  })
})

describe('user picker', () => {
  it('lists active users for any logged-in user', async () => {
    const m = await t.seed.user({ account: 'wanglei', name: '王磊' })
    await t.seed.user({ account: 'gone', disabledAt: new Date() })
    const res = await req('GET', '/api/users', await t.seed.cookie(m.id))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      { id: adminId, account: 'chenchen', name: '陈晨' },
      { id: m.id, account: 'wanglei', name: '王磊' },
    ])
    expect((await req('GET', '/api/users', '')).statusCode).toBe(401)
  })
})
