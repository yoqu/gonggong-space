import { randomUUID } from 'node:crypto'
import cookiePlugin from '@fastify/cookie'
import {
  PROTOCOL_VERSION,
  TERMINAL_FEATURE,
  type TerminalCreateReq,
  type TerminalLive,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bots, groupBots, groupMembers, groupRepos, machines, users } from '../src/db/schema.js'
import { terminalRoutes } from '../src/modules/terminals/routes.js'
import {
  type TerminalAttachment,
  TerminalService,
  type TerminalTransport,
} from '../src/modules/terminals/sessions.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

class FakeTransport implements TerminalTransport {
  opens: unknown[] = []
  machines: string[] = []
  attachments = 0
  terminated: string[] = []

  async attach(
    open: Parameters<TerminalTransport['attach']>[0],
    machineId: string,
  ): Promise<TerminalAttachment> {
    this.opens.push(open)
    this.machines.push(machineId)
    this.attachments += 1
    return { close: () => {}, send: async () => {}, subscribe: () => {} }
  }

  async terminate(target: Parameters<TerminalTransport['terminate']>[0]) {
    this.terminated.push(target.sessionId)
  }
}

let t: TestApp
let now: Date
let service: TerminalService
let transport: FakeTransport
let daemonConnection: { send: () => void; close: () => void }
let owner: { id: string }
let machine: { id: string }
let bot: { id: string }
let group: { id: string }
let restApp: FastifyInstance | undefined
const create: TerminalCreateReq = { cols: 100, rows: 30 }

beforeEach(async () => {
  now = new Date('2026-10-27T08:00:00Z')
  t = await createTestApp({ now: () => now })
  owner = await t.seed.user({ name: '机器主人' })
  ;({ machine } = await t.seed.machine(owner.id))
  bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id })
  group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  transport = new FakeTransport()
  service = new TerminalService(t.ctx, transport)
  daemonConnection = { send: () => {}, close: () => {} }
  t.ctx.hub.register(machine.id, daemonConnection, [TERMINAL_FEATURE])
})

afterEach(async () => {
  await restApp?.close()
  restApp = undefined
  await t.close()
})

async function session() {
  return service.create(owner.id, group.id, bot.id, create)
}

async function makeWorldWithOtherOwner() {
  const other = await t.seed.user()
  const { machine: otherMachine } = await t.seed.machine(other.id)
  const otherBot = await t.seed.bot({ ownerId: other.id, machineId: otherMachine.id })
  await t.db.insert(groupBots).values({ groupId: group.id, botId: otherBot.id })
  return { other, otherMachine, otherBot }
}

describe('terminal ownership and target resolution', () => {
  it('allows only the exact machine owner, including for sysadmins and group admins', async () => {
    const { other } = await makeWorldWithOtherOwner()
    await t.db.update(users).set({ role: 'sysadmin' }).where(eq(users.id, other.id))
    const sysadmin = { id: other.id, role: 'sysadmin' }
    await expect(service.create(sysadmin.id, group.id, bot.id, create)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(service.create(other.id, group.id, bot.id, create)).rejects.toMatchObject({
      code: 'forbidden',
    })
    const created = await session()
    expect(created).toMatchObject({ groupId: group.id, botId: bot.id, status: 'running' })
    expect(created.sessionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects a bot from another machine or one removed from the group', async () => {
    const { otherBot } = await makeWorldWithOtherOwner()
    await expect(service.create(owner.id, group.id, otherBot.id, create)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await t.db
      .update(groupBots)
      .set({ removedAt: now })
      .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
    await expect(service.create(owner.id, group.id, bot.id, create)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('cleans a session if its bot moves to a different machine', async () => {
    const created = await session()
    const { machine: otherMachine } = await t.seed.machine(owner.id)
    await t.db.update(bots).set({ machineId: otherMachine.id }).where(eq(bots.id, bot.id))
    expect((await service.list(owner.id, group.id, bot.id))[0]).toMatchObject({
      status: 'closed',
      reason: 'revoked',
    })
    expect(transport.terminated).toEqual([created.sessionId])
    expect(await service.attach(owner.id, created.sessionId)).not.toHaveProperty('attachment')
  })

  it('rejects attach and end after the bot moves without requiring a list first', async () => {
    const created = await session()
    const { machine: otherMachine } = await t.seed.machine(owner.id)
    await t.db.update(bots).set({ machineId: otherMachine.id }).where(eq(bots.id, bot.id))
    expect(await service.attach(owner.id, created.sessionId)).toMatchObject({
      terminal: { status: 'closed', reason: 'revoked' },
    })
    await expect(service.end(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'conflict' })
    expect(transport.terminated).toEqual([created.sessionId])
  })

  it('resolves the current repo and /cd binding at attach time, never from client cwd', async () => {
    await t.db
      .insert(groupRepos)
      .values({ groupId: group.id, url: 'git@host:team/repo.git', baseBranch: 'main' })
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/owner/current-workspace' })
      .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
    const created = await session()
    await t.db
      .update(groupBots)
      .set({ cdPath: '/owner/new-current-workspace' })
      .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
    const attached = await service.attach(owner.id, created.sessionId, 12)
    expect(attached.open).toMatchObject({
      action: 'create',
      sessionId: created.sessionId,
      groupId: group.id,
      botId: bot.id,
      cols: 100,
      rows: 30,
      after: 12,
      workspace: {
        repo: { url: 'git@host:team/repo.git', branch: 'main' },
        cdPath: '/owner/new-current-workspace',
      },
    })
    expect(attached.open).not.toHaveProperty('cwd')
    expect(created).not.toHaveProperty('workspace')
  })

  it('lets an owner list and attach but not another group member', async () => {
    const member = await t.seed.user()
    await t.db.insert(groupMembers).values({
      groupId: group.id,
      userId: member.id,
    })
    const created = await session()
    expect(await service.list(owner.id, group.id, bot.id)).toEqual([created])
    await expect(service.attach(member.id, created.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(service.list(member.id, group.id, bot.id)).rejects.toMatchObject({ code: 'forbidden' })
    await service.attach(owner.id, created.sessionId)
    await service.attach(owner.id, created.sessionId)
    expect(transport.opens.map((open) => (open as { action: string }).action)).toEqual(['create', 'attach'])
    expect(transport.machines).toEqual([machine.id, machine.id])
  })
})

describe('terminal capabilities and session lifecycle', () => {
  it('requires terminal-v2 and a macOS or Linux daemon', async () => {
    await expect(session()).resolves.toMatchObject({ status: 'running' })
    const otherMachine = await t.seed.machine(owner.id, { os: 'windows' })
    const windowsBot = await t.seed.bot({ ownerId: owner.id, machineId: otherMachine.machine.id })
    await t.db.insert(groupBots).values({ groupId: group.id, botId: windowsBot.id })
    await expect(service.create(owner.id, group.id, windowsBot.id, create)).rejects.toMatchObject({
      code: 'conflict',
    })
    const withoutFeature = new TerminalService(t.ctx, transport)
    t.ctx.hub.register(machine.id, { send: () => {}, close: () => {} }, [])
    await expect(withoutFeature.create(owner.id, group.id, bot.id, create)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('allows at most four running sessions per user without deleting old ones on attach', async () => {
    const sessions = await Promise.all(Array.from({ length: 4 }, () => session()))
    expect(new Set(sessions.map((s) => s.sessionId)).size).toBe(4)
    await expect(session()).rejects.toMatchObject({ code: 'conflict' })
    await Promise.all(sessions.map((s) => service.attach(owner.id, s.sessionId)))
    expect(transport.attachments).toBe(4)
    expect(await service.list(owner.id, group.id, bot.id)).toHaveLength(4)
    await service.end(owner.id, sessions[0]!.sessionId)
    expect((await service.list(owner.id, group.id, bot.id))[0]).toMatchObject({
      status: 'closed',
      reason: 'user',
    })
    await expect(session()).resolves.toMatchObject({ status: 'running' })
  })

  it('only marks a session closed after daemon termination is confirmed', async () => {
    const created = await session()
    let confirm!: () => void
    let requested!: () => void
    const terminationRequested = new Promise<void>((resolve) => (requested = resolve))
    transport.terminate = async ({ sessionId }) => {
      transport.terminated.push(sessionId)
      requested()
      await new Promise<void>((resolve) => (confirm = resolve))
    }
    let settled = false
    const ending = service.end(owner.id, created.sessionId).finally(() => (settled = true))
    await terminationRequested
    expect(transport.terminated).toEqual([created.sessionId])
    expect(settled).toBe(false)
    confirm()
    await ending
    expect((await service.list(owner.id, group.id, bot.id))[0]!.status).toBe('closed')
    const next = await session()
    transport.terminate = async () => {
      throw new Error('daemon did not confirm termination')
    }
    await expect(service.end(owner.id, next.sessionId)).rejects.toThrow('daemon did not confirm')
    expect(
      (await service.list(owner.id, group.id, bot.id)).find((s) => s.sessionId === next.sessionId),
    ).toMatchObject({
      status: 'running',
    })
  })

  it('keeps sessions while the daemon is offline and reconciles them with its hello', async () => {
    const kept = await session()
    const lost = await session()
    const fresh = await session()
    await service.attach(owner.id, kept.sessionId)
    await service.attach(owner.id, lost.sessionId)
    t.ctx.hub.unregister(machine.id, daemonConnection)
    expect((await service.list(owner.id, group.id, bot.id)).map((s) => s.status)).toEqual([
      'running',
      'running',
      'running',
    ])

    const adopted = {
      sessionId: randomUUID(),
      groupId: group.id,
      botId: bot.id,
      cols: 90,
      rows: 20,
      createdAt: now.toISOString(),
    }
    await service.reconcile(machine.id, [
      {
        sessionId: kept.sessionId,
        groupId: group.id,
        botId: bot.id,
        cols: 100,
        rows: 30,
        createdAt: kept.createdAt,
      },
      adopted,
    ])
    const listed = await service.list(owner.id, group.id, bot.id)
    expect(listed.find((s) => s.sessionId === kept.sessionId)).toMatchObject({ status: 'running' })
    expect(listed.find((s) => s.sessionId === lost.sessionId)).toMatchObject({
      status: 'daemon_restart',
      reason: 'daemon_restart',
    })
    expect(listed.find((s) => s.sessionId === adopted.sessionId)).toMatchObject({ status: 'running' })
    expect(listed.find((s) => s.sessionId === fresh.sessionId)).toMatchObject({ status: 'running' })
    t.ctx.hub.register(machine.id, daemonConnection, [TERMINAL_FEATURE])
    await service.attach(owner.id, adopted.sessionId, 7)
    expect(transport.opens.at(-1)).toMatchObject({ action: 'attach', sessionId: adopted.sessionId, after: 7 })
    expect(await service.attach(owner.id, lost.sessionId)).toMatchObject({
      terminal: { status: 'daemon_restart' },
    })
    await expect(service.end(owner.id, lost.sessionId)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('revokes every session when the machine or its owner is disabled and rejects new connections', async () => {
    const created = await session()
    await t.db.update(machines).set({ revokedAt: now }).where(eq(machines.id, machine.id))
    await expect(service.attach(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(service.create(owner.id, group.id, bot.id, create)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect((await service.list(owner.id, group.id, bot.id))[0]).toMatchObject({
      status: 'closed',
      reason: 'revoked',
    })
    expect(transport.terminated).toEqual([created.sessionId])
    await t.db.update(machines).set({ revokedAt: null }).where(eq(machines.id, machine.id))
    const next = await session()
    await t.db.update(users).set({ disabledAt: now }).where(eq(users.id, owner.id))
    await expect(service.attach(owner.id, next.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
    expect(transport.terminated).toContain(next.sessionId)
  })

  it('revokes locally even when the daemon cannot confirm the termination', async () => {
    const created = await session()
    transport.terminate = async (target) => {
      transport.terminated.push(target.sessionId)
      throw new Error('daemon 已断开')
    }
    await t.db.update(machines).set({ revokedAt: now }).where(eq(machines.id, machine.id))
    await expect(service.attach(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
    expect((await service.list(owner.id, group.id, bot.id))[0]).toMatchObject({
      status: 'closed',
      reason: 'revoked',
    })
    expect(transport.terminated).toEqual([created.sessionId])
  })
})

describe('terminal REST routes without app integration', () => {
  it('authenticates the cookie and exposes only create/list/delete metadata', async () => {
    restApp = Fastify()
    await restApp.register(cookiePlugin)
    await restApp.register(terminalRoutes({ ctx: t.ctx, terminals: service }))
    await restApp.ready()
    const app = restApp
    const cookie = await t.seed.cookie(owner.id)
    const path = `/api/groups/${group.id}/bots/${bot.id}/terminals`
    const unauthorized = await app.inject({ method: 'POST', url: path, payload: create })
    expect(unauthorized.statusCode).toBe(401)
    const created = await app.inject({ method: 'POST', url: path, headers: { cookie }, payload: create })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ groupId: group.id, botId: bot.id, status: 'running' })
    const listed = await app.inject({ method: 'GET', url: path, headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual([created.json()])
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/terminals/${created.json().sessionId}`,
      headers: { cookie },
    })
    expect(removed.statusCode).toBe(204)
    expect(transport.terminated).toEqual([created.json().sessionId])
  })
})

describe('terminal sessions across daemon reconnects', () => {
  it('adopts the shells a daemon reports, ends those it later lost, and tells a reattaching browser', async () => {
    const { machine: m, token } = await t.seed.machine(owner.id)
    const b = await t.seed.bot({ ownerId: owner.id, machineId: m.id })
    const g = await t.seed.group({ createdBy: owner.id, botIds: [b.id] })
    const cookie = await t.seed.cookie(owner.id)
    const hello = async (terminals: TerminalLive[]) => {
      const ws = t.ws('/ws/daemon')
      const box = inbox(ws)
      await box.opened
      ws.send(
        JSON.stringify({
          t: 'hello',
          protocol: PROTOCOL_VERSION,
          token,
          daemonVersion: '0.1.0',
          machine: { name: 'm', os: 'macos', arch: 'aarch64' },
          agents: [],
          features: [TERMINAL_FEATURE],
          terminals,
        }),
      )
      expect(await box.next()).toMatchObject({ t: 'welcome' })
      return ws
    }
    const created = {
      sessionId: randomUUID(),
      groupId: g.id,
      botId: b.id,
      cols: 80,
      rows: 24,
      createdAt: now.toISOString(),
    }
    const path = t.url(`/api/groups/${g.id}/bots/${b.id}/terminals`)
    const first = await hello([created])
    await vi.waitFor(async () =>
      expect(await fetch(path, { headers: { cookie } }).then((r) => r.json())).toMatchObject([
        { sessionId: created.sessionId, status: 'running' },
      ]),
    )
    first.close()

    const second = await hello([])
    await vi.waitFor(async () =>
      expect(await fetch(path, { headers: { cookie } }).then((r) => r.json())).toMatchObject([
        { sessionId: created.sessionId, status: 'daemon_restart' },
      ]),
    )
    const browser = t.ws(`/ws/terminals/${created.sessionId}`, { cookie })
    const box = inbox(browser)
    expect(await box.next()).toMatchObject({
      op: 'exit',
      sessionId: created.sessionId,
      state: 'daemon_restart',
    })
    expect(await box.closed).toBe(1000)
    second.close()
  })
})
