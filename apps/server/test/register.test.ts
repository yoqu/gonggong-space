import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
let admin: string
beforeEach(async () => {
  t = await createTestApp()
  admin = await t.seed.cookie((await t.seed.user({ account: 'chenchen', role: 'sysadmin' })).id)
})
afterEach(() => t.close())

const body = { account: 'wanglei', name: '王磊', password: 'wanglei-pass' }
const register = (payload: object = body) =>
  t.app.inject({ method: 'POST', url: '/api/auth/register', payload })
const options = async () => (await t.app.inject({ method: 'GET', url: '/api/auth/options' })).json()
const open = (registrationOpen: boolean) =>
  t.app.inject({
    method: 'PUT',
    url: '/api/admin/params',
    headers: { cookie: admin },
    payload: { registrationOpen },
  })

describe('self sign-up', () => {
  it('is closed by default, and the login page can tell without a session', async () => {
    expect(await options()).toEqual({ registrationOpen: false })
    const res = await register()
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toBe('未开放注册，请联系系统管理员创建账号')
  })

  it('once the sysadmin opens it, creates a member who is signed in at once, and audits it', async () => {
    expect((await open(true)).json()).toMatchObject({ registrationOpen: true })
    expect(await options()).toEqual({ registrationOpen: true })
    const res = await register()
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      account: 'wanglei',
      name: '王磊',
      role: 'member',
      mustChangePassword: false,
    })
    const cookie = res.cookies.find((c) => c.name === 'gonggong_session')
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `gonggong_session=${cookie?.value}` },
    })
    expect(me.json()).toMatchObject({ account: 'wanglei' })
    const logs = await t.db.select().from(auditLogs)
    expect(logs.find((l) => l.action === 'user.register')?.detail).toMatchObject({ account: 'wanglei' })
    expect(logs.find((l) => l.action === 'params.update')?.detail).toMatchObject({
      changes: { registrationOpen: [false, true] },
    })
  })

  it('rejects taken accounts, bad account names and short passwords', async () => {
    await open(true)
    expect((await register({ ...body, account: 'chenchen' })).json().message).toBe('账号已存在')
    expect((await register({ ...body, account: 'Wang Lei' })).statusCode).toBe(400)
    expect((await register({ ...body, password: 'short' })).statusCode).toBe(400)
    expect((await register({ ...body, name: ' ' })).statusCode).toBe(400)
  })

  it('stops accepting sign-ups as soon as it is closed again', async () => {
    await open(true)
    await open(false)
    expect((await register()).statusCode).toBe(403)
  })
})
