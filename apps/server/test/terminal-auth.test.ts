import cookiePlugin from '@fastify/cookie'
import { TERMINAL_FEATURE, type TerminalCreateReq } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bots, groupBots, groupMembers, groupRepos, machines, users } from '../src/db/schema.js'
import { terminalRoutes } from '../src/modules/terminals/routes.js'
import {
  TerminalService,
  type TerminalAttachment,
  type TerminalTransport,
} from '../src/modules/terminals/sessions.js'
import { createTestApp, type TestApp } from './support/app.js'

class FakeTransport implements TerminalTransport {
  opens: unknown[] = []
  attachments = 0
  ended: string[] = []
  terminated: string[] = []

  async attach(open: Parameters<TerminalTransport['attach']>[0]): Promise<TerminalAttachment> {
    this.opens.push(open)
    this.attachments += 1
    return { detach: () => {} }
  }

  async terminate(sessionId: string, reason: 'user' | 'revoked') {
    this.terminated.push(sessionId)
    if (reason === 'user') this.ended.push(sessionId)
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
    await expect(service.attach(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects attach and end after the bot moves without requiring a list first', async () => {
    const created = await session()
    const { machine: otherMachine } = await t.seed.machine(owner.id)
    await t.db.update(bots).set({ machineId: otherMachine.id }).where(eq(bots.id, bot.id))
    await expect(service.attach(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'conflict' })
    await expect(service.end(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'conflict' })
    expect(transport.terminated).toEqual([created.sessionId])
  })

  it('resolves the current repo and /cd binding at attach time, never from client cwd', async () => {
    await t.db.insert(groupRepos).values({ groupId: group.id, url: 'git@host:team/repo.git', baseBranch: 'main' })
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
    expect(await service.owner(owner.id, created.sessionId)).toMatchObject({ userId: owner.id, machineId: machine.id })
  })
})

describe('terminal capabilities and session lifecycle', () => {
  it('requires terminal-v1 and a macOS or Linux daemon', async () => {
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
    transport.terminate = async (sessionId) => {
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
    expect((await service.list(owner.id, group.id, bot.id)).find((s) => s.sessionId === next.sessionId)).toMatchObject({
      status: 'running',
    })
  })

  it('marks all sessions daemon_restart on disconnect and never reattaches them', async () => {
    const created = await session()
    await service.attach(owner.id, created.sessionId)
    const unwatch = service.watchDisconnects()
    t.ctx.hub.unregister(machine.id, daemonConnection)
    await Promise.resolve()
    await Promise.resolve()
    unwatch()
    expect((await service.list(owner.id, group.id, bot.id))[0]).toMatchObject({
      status: 'daemon_restart',
      reason: 'daemon_restart',
    })
    await expect(service.attach(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'conflict' })
    await expect(service.end(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'conflict' })
    expect(transport.terminated).toEqual([])
  })

  it('revokes every session when the machine or its owner is disabled and rejects new connections', async () => {
    const created = await session()
    await t.db.update(machines).set({ revokedAt: now }).where(eq(machines.id, machine.id))
    await expect(service.attach(owner.id, created.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(service.create(owner.id, group.id, bot.id, create)).rejects.toMatchObject({ code: 'forbidden' })
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
    expect(transport.ended).toEqual([created.json().sessionId])
  })
})
