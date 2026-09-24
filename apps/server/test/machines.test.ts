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
const daemonLogin = (code: string, ip = '10.0.0.1', machine: object = machineInfo) =>
  t.app.inject({
    method: 'POST',
    url: '/api/daemon/login',
    remoteAddress: ip,
    payload: { code, machine },
  })
const system = {
  osVersion: 'macOS 15.2 Sequoia',
  kernel: '24.2.0',
  cpuModel: 'Apple M3 Pro',
  cpuCores: 12,
  memoryBytes: 38654705664,
  macAddress: 'a4:83:e7:12:34:56',
}
const host = { ...machineInfo, hardwareId: 'hw-1', system }
const hello = async (token: string, machine: object = host) => {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.1.0',
      machine,
      agents: [],
    }),
  )
  const reply = (await box.next()) as { t: string; reason?: string }
  ws.close()
  return reply
}
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
    expect(body).toMatchObject({ ownerName: '王磊', token: expect.stringMatching(/^mt_/), restored: false })

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

  it('refuses to revoke a machine that still has bots, then notifies the owner once revoked', async () => {
    const { machine } = await t.seed.machine(owner.id)
    const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id })
    const del = () =>
      t.app.inject({ method: 'DELETE', url: `/api/machines/${machine.id}`, headers: { cookie } })
    const blocked = await del()
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().message).toContain('1 个 bot')

    await t.app.inject({ method: 'DELETE', url: `/api/bots/${bot.id}`, headers: { cookie } })
    const got = events(owner.id)
    expect((await del()).statusCode).toBe(204)
    expect(got).toContainEqual({ t: 'machine.removed', machineId: machine.id })
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

describe('machine identity', () => {
  it('restores the machine of a host that logs in again, voiding its old token', async () => {
    const first = (await daemonLogin((await newCode()).code, '10.0.0.1', host)).json()
    await t.db.update(machines).set({ revokedAt: new Date() }).where(eq(machines.id, first.machineId))
    const moved = { ...host, name: 'wanglei-mbp-2', system: { ...system, macAddress: 'a4:83:e7:00:00:01' } }
    clock += 60_000
    const res = await daemonLogin((await newCode()).code, '10.0.0.1', moved)
    expect(res.json()).toMatchObject({ machineId: first.machineId, restored: true })
    expect(onMachineBound).toHaveBeenCalledTimes(2)

    const rows = await t.db.select().from(machines)
    expect(rows).toEqual([
      expect.objectContaining({
        id: first.machineId,
        name: 'wanglei-mbp-2',
        revokedAt: null,
        system: moved.system,
      }),
    ])
    const [dto] = (await t.app.inject({ method: 'GET', url: '/api/machines', headers: { cookie } })).json()
    expect(Date.parse(dto.boundAt) - Date.parse(dto.createdAt)).toBe(60_000)
    expect(await hello(first.token)).toMatchObject({ t: 'reject', reason: 'unauthorized' })
    expect(await hello(res.json().token)).toMatchObject({ t: 'welcome', machineId: first.machineId })
  })

  it('transfers a host to the next user who binds it, unless bots still run on it', async () => {
    const first = (await daemonLogin((await newCode()).code, '10.0.0.1', host)).json()
    const bot = await t.seed.bot({ ownerId: owner.id, machineId: first.machineId })
    const other = await t.seed.user({ name: '李娜' })
    const otherCookie = await t.seed.cookie(other.id)
    const { code } = await newCode(otherCookie)

    const blocked = await daemonLogin(code, '10.0.0.1', host)
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().message).toContain('王磊')

    await t.app.inject({ method: 'DELETE', url: `/api/bots/${bot.id}`, headers: { cookie } })
    const mine = events(owner.id)
    const theirs = events(other.id)
    const res = await daemonLogin(code, '10.0.0.1', host)
    expect(res.json()).toMatchObject({ machineId: first.machineId, ownerName: '李娜', restored: false })
    const [row] = await t.db.select().from(machines)
    expect(row).toMatchObject({ ownerId: other.id, label: null })
    expect(mine).toContainEqual({ t: 'machine.removed', machineId: first.machineId })
    expect(theirs).toContainEqual(expect.objectContaining({ t: 'machine.updated' }))
    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'machine.transfer'))
    expect(logs).toHaveLength(1)
  })

  it('adds a machine per login for daemons that report no hardware id', async () => {
    await daemonLogin((await newCode()).code)
    await daemonLogin((await newCode()).code)
    expect(await t.db.select().from(machines)).toHaveLength(2)
  })

  it('hello refreshes system info and adopts the hardware id of a machine bound before it existed', async () => {
    const { machine, token } = await t.seed.machine(owner.id)
    expect(await hello(token)).toMatchObject({ t: 'welcome' })
    const [row] = await t.db.select().from(machines)
    expect(row).toMatchObject({ id: machine.id, hardwareId: 'hw-1', system })

    const again = await daemonLogin((await newCode()).code, '10.0.0.1', host)
    expect(again.json()).toMatchObject({ machineId: machine.id, restored: true })
  })

  it('logout voids the token but keeps the machine', async () => {
    const { machine, token } = await t.seed.machine(owner.id)
    const kicked: number[] = []
    t.ctx.hub.register(machine.id, { send() {}, close: (c) => kicked.push(c) })
    const logout = (tk: string) =>
      t.app.inject({ method: 'POST', url: '/api/daemon/logout', headers: { authorization: `Bearer ${tk}` } })
    expect((await logout(token)).statusCode).toBe(204)
    expect(kicked).toEqual([4002])
    expect((await logout(token)).statusCode).toBe(401)
    const list = await t.app.inject({ method: 'GET', url: '/api/machines', headers: { cookie } })
    expect(list.json()).toEqual([expect.objectContaining({ id: machine.id })])
  })

  it('renames a machine; the label survives hellos and clears back to the hostname', async () => {
    const { machine, token } = await t.seed.machine(owner.id, { name: 'wanglei-mbp' })
    const rename = (name: string, c = cookie) =>
      t.app.inject({
        method: 'PATCH',
        url: `/api/machines/${machine.id}`,
        headers: { cookie: c },
        payload: { name },
      })
    const other = await t.seed.user()
    expect((await rename('x', await t.seed.cookie(other.id))).statusCode).toBe(403)

    const got = events(owner.id)
    const res = await rename(' 办公室 Mac ')
    expect(res.json()).toMatchObject({ name: '办公室 Mac', hostname: 'wanglei-mbp' })
    expect(got).toContainEqual({
      t: 'machine.updated',
      machine: expect.objectContaining({ name: '办公室 Mac' }),
    })
    await hello(token)
    const list = await t.app.inject({ method: 'GET', url: '/api/machines', headers: { cookie } })
    expect(list.json()).toEqual([expect.objectContaining({ name: '办公室 Mac', system })])
    expect((await rename('')).json()).toMatchObject({ name: 'wanglei-mbp' })
  })
})
