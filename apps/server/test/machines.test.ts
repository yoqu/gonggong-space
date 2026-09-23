import { PROTOCOL_VERSION, type WebEvent } from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditLogs, bindCodes, machines } from '../src/db/schema.js'
import { onMachineBound } from '../src/modules/bots/binding.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

vi.mock('../src/modules/bots/binding.js', () => ({ onMachineBound: vi.fn(async () => {}) }))

let t: TestApp
let clock: number
let owner: { id: string; name: string }
let cookie: string
beforeEach(async () => {
  clock = Date.parse('2026-09-23T10:00:00Z')
  t = await createTestApp({ now: () => new Date(clock) })
  owner = await t.seed.user({ account: 'wanglei', name: '王磊' })
  cookie = await t.seed.cookie(owner.id)
  vi.mocked(onMachineBound).mockClear()
})
afterEach(() => t.close())

const machineInfo = { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' }
const newCode = async (c = cookie) =>
  (await t.app.inject({ method: 'POST', url: '/api/bind-codes', headers: { cookie: c } })).json() as {
    code: string
    expiresAt: string
  }
const daemonLogin = (code: string, ip = '10.0.0.1') =>
  t.app.inject({
    method: 'POST',
    url: '/api/daemon/login',
    remoteAddress: ip,
    payload: { code, machine: machineInfo },
  })
const events = (userId: string) => {
  const got: WebEvent[] = []
  t.ctx.bus.attach(userId, (e) => got.push(e))
  return got
}

describe('bind codes', () => {
  it('issues a one-time XXXX-XXXX code valid for 10 minutes', async () => {
    const { code, expiresAt } = await newCode()
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(Date.parse(expiresAt)).toBe(clock + 10 * 60_000)
    const res = await t.app.inject({ method: 'POST', url: '/api/bind-codes' })
    expect(res.statusCode).toBe(401)
  })
})

describe('daemon login', () => {
  it('exchanges a code for a machine token owned by the code issuer', async () => {
    const got = events(owner.id)
    const { code } = await newCode()
    const res = await daemonLogin(code.toLowerCase())
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ ownerName: '王磊', token: expect.stringMatching(/^mt_/) })

    const [m] = await t.db.select().from(machines).where(eq(machines.id, body.machineId))
    expect(m).toMatchObject({ ownerId: owner.id, name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' })
    const [c] = await t.db.select().from(bindCodes)
    expect(c?.usedAt).not.toBeNull()
    expect(onMachineBound).toHaveBeenCalledWith(t.ctx, expect.objectContaining({ id: body.machineId }))
    expect(got).toEqual([
      {
        t: 'machine.updated',
        machine: expect.objectContaining({
          id: body.machineId,
          name: 'wanglei-mbp',
          online: false,
          agents: [],
        }),
      },
    ])

    // The token authenticates the daemon socket; going online is pushed to the owner with the reported agents.
    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    const online = new Promise((r) => t.ctx.hub.once('online', r))
    const agents = [{ kind: 'claude', available: true, version: '2.1.4', path: '/bin/claude' }]
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token: body.token,
        daemonVersion: '0.1.0',
        machine: machineInfo,
        agents,
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome', machineId: body.machineId })
    await online
    await vi.waitFor(() =>
      expect(got.at(-1)).toMatchObject({ t: 'machine.updated', machine: { online: true, agents } }),
    )
    ws.close()
    await vi.waitFor(() => expect(got.at(-1)).toMatchObject({ machine: { online: false } }))
  })

  it('rejects reused, expired, unknown and malformed codes', async () => {
    const { code } = await newCode()
    expect((await daemonLogin(code)).statusCode).toBe(200)
    const reused = await daemonLogin(code)
    expect(reused.statusCode).toBe(410)
    expect(reused.json().error).toBe('code_expired')

    const second = await newCode()
    clock += 10 * 60_000 + 1
    const expired = await daemonLogin(second.code)
    expect(expired.statusCode).toBe(410)
    expect(expired.json().error).toBe('code_expired')

    expect((await daemonLogin('ZZZZ-ZZZZ')).json().error).toBe('unauthorized')
    expect((await daemonLogin('nope')).json().error).toBe('invalid')
  })

  it('locks a code after 5 failed attempts against it', async () => {
    const { code } = await newCode()
    clock += 11 * 60_000
    for (let i = 0; i < 5; i++) expect((await daemonLogin(code, `10.0.1.${i}`)).statusCode).toBe(410)
    const locked = await daemonLogin(code, '10.0.2.1')
    expect(locked.json().error).toBe('code_locked')
  })

  it('throttles a client IP after 10 failures in 10 minutes', async () => {
    for (let i = 0; i < 10; i++) expect((await daemonLogin('AAAA-AAAA', '10.9.9.9')).statusCode).toBe(401)
    const { code } = await newCode()
    const res = await daemonLogin(code, '10.9.9.9')
    expect(res.statusCode).toBe(423)
    expect(res.json().error).toBe('code_locked')
    expect((await daemonLogin(code, '10.9.9.10')).statusCode).toBe(200)
    clock += 10 * 60_000 + 1
    expect((await daemonLogin('AAAA-AAAA', '10.9.9.9')).statusCode).toBe(401)
  })
})

describe('machines', () => {
  it('lists my machines; sysadmins may list all', async () => {
    const other = await t.seed.user()
    const mine = await t.seed.machine(owner.id, { name: 'mine' })
    await t.seed.machine(owner.id, { name: 'old', revokedAt: new Date() })
    await t.seed.machine(other.id, { name: 'theirs' })
    t.ctx.hub.register(mine.machine.id, { send() {}, close() {} })

    const res = await t.app.inject({ method: 'GET', url: '/api/machines', headers: { cookie } })
    expect(res.json()).toEqual([
      expect.objectContaining({ id: mine.machine.id, name: 'mine', online: true, ownerId: owner.id }),
    ])
    const denied = await t.app.inject({ method: 'GET', url: '/api/machines?all=1', headers: { cookie } })
    expect(denied.statusCode).toBe(403)

    const admin = await t.seed.user({ role: 'sysadmin' })
    const all = await t.app.inject({
      method: 'GET',
      url: '/api/machines?all=1',
      headers: { cookie: await t.seed.cookie(admin.id) },
    })
    expect((all.json() as { name: string }[]).map((m) => m.name).sort()).toEqual(['mine', 'theirs'])
  })

  it('revokes a machine: kicks the daemon, audits, and blocks reconnects', async () => {
    const { machine, token } = await t.seed.machine(owner.id)
    const kicked: [number, string][] = []
    t.ctx.hub.register(machine.id, { send() {}, close: (c, r) => kicked.push([c, r]) })

    const other = await t.seed.user()
    const foreign = await t.app.inject({
      method: 'DELETE',
      url: `/api/machines/${machine.id}`,
      headers: { cookie: await t.seed.cookie(other.id) },
    })
    expect(foreign.statusCode).toBe(403)

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/machines/${machine.id}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(204)
    expect(kicked).toEqual([[4003, 'revoked']])
    const [row] = await t.db.select().from(machines).where(eq(machines.id, machine.id))
    expect(row?.revokedAt).not.toBeNull()
    const [log] = await t.db.select().from(auditLogs)
    expect(log).toMatchObject({ category: 'admin', action: 'machine.revoke', actorUserId: owner.id })
    const list = await t.app.inject({ method: 'GET', url: '/api/machines', headers: { cookie } })
    expect(list.json()).toEqual([])

    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token,
        daemonVersion: '0.1.0',
        machine: machineInfo,
        agents: [],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'reject', reason: 'revoked' })
  })

  it('sysadmin can revoke any machine; unknown id is 404', async () => {
    const { machine } = await t.seed.machine(owner.id)
    const admin = await t.seed.user({ role: 'sysadmin' })
    const ac = await t.seed.cookie(admin.id)
    const del = (id: string) =>
      t.app.inject({ method: 'DELETE', url: `/api/machines/${id}`, headers: { cookie: ac } })
    expect((await del(machine.id)).statusCode).toBe(204)
    expect((await del('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404)
  })
})
