import {
  TERMINAL_DIR_FEATURE,
  TERMINAL_FEATURE,
  type TerminalDto,
  type TerminalOpen,
  type TerminalSpaceDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, machines, terminalSpaces } from '../src/db/schema.js'
import {
  type TerminalAttachment,
  TerminalService,
  type TerminalTransport,
} from '../src/modules/terminals/sessions.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

class FakeTransport implements TerminalTransport {
  opens: TerminalOpen[] = []
  terminated: string[] = []

  async attach(open: TerminalOpen): Promise<TerminalAttachment> {
    this.opens.push(open)
    return { close: () => {}, send: async () => {}, subscribe: () => {} }
  }

  async terminate(target: Parameters<TerminalTransport['terminate']>[0]) {
    this.terminated.push(target.sessionId)
  }
}

let t: TestApp
let owner: { id: string }
let machine: { id: string }
const size = { cols: 120, rows: 32 }
const conn = { send: () => {}, close: () => {} }

beforeEach(async () => {
  t = await createTestApp()
  owner = await t.seed.user({ name: '王磊' })
  ;({ machine } = await t.seed.machine(owner.id, { name: 'wanglei-mbp' }))
  t.ctx.hub.register(machine.id, conn, [TERMINAL_FEATURE, TERMINAL_DIR_FEATURE])
})

afterEach(async () => {
  await t.close()
})

async function as(userId: string) {
  return client(t, await t.seed.cookie(userId))
}

describe('machine terminals (terminal spaces)', () => {
  it('lets only the machine owner create, list, rename, open and delete one', async () => {
    const me = await as(owner.id)
    const created = await me.post<TerminalSpaceDto>('/api/terminal-spaces', {
      machineId: machine.id,
      cwd: '/Users/wang/code/scripts',
      name: '脚本',
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      machineName: 'wanglei-mbp',
      name: '脚本',
      cwd: '/Users/wang/code/scripts',
    })
    const id = created.body.id

    const other = await t.seed.user()
    const them = await as(other.id)
    expect(
      (await them.post('/api/terminal-spaces', { machineId: machine.id, cwd: '/tmp', name: 'x' })).status,
    ).toBe(403)
    expect((await them.get<TerminalSpaceDto[]>('/api/terminal-spaces')).body).toEqual([])
    expect((await them.post(`/api/terminal-spaces/${id}/session`, size)).status).toBe(404)
    expect(
      (await me.post('/api/terminal-spaces', { machineId: machine.id, cwd: 'relative', name: 'x' })).status,
    ).toBe(400)

    expect((await me.patch<TerminalSpaceDto>(`/api/terminal-spaces/${id}`, { name: '运维' })).body.name).toBe(
      '运维',
    )

    const opened = await me.post<TerminalDto>(`/api/terminal-spaces/${id}/session`, size)
    expect(opened.body).toMatchObject({ groupId: id, botId: id, status: 'running' })
    // Opening again returns the same running shell.
    expect((await me.post<TerminalDto>(`/api/terminal-spaces/${id}/session`, size)).body.sessionId).toBe(
      opened.body.sessionId,
    )
    const [audit] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'session.create'))
    expect(audit).toMatchObject({ groupId: null, detail: { spaceId: id, machineId: machine.id } })

    expect((await me.get<TerminalSpaceDto[]>('/api/terminal-spaces')).body.map((s) => s.name)).toEqual([
      '运维',
    ])
    await t.db.update(machines).set({ revokedAt: new Date() }).where(eq(machines.id, machine.id))
    expect((await me.get<TerminalSpaceDto[]>('/api/terminal-spaces')).body).toEqual([])
    await t.db.update(machines).set({ revokedAt: null }).where(eq(machines.id, machine.id))

    expect((await me.del(`/api/terminal-spaces/${id}`)).status).toBe(204)
    expect(await t.db.select().from(terminalSpaces)).toEqual([])
  })

  it('refuses daemons that cannot open a directory', async () => {
    t.ctx.hub.register(machine.id, conn, [TERMINAL_FEATURE])
    const me = await as(owner.id)
    const { body } = await me.post<TerminalSpaceDto>('/api/terminal-spaces', {
      machineId: machine.id,
      cwd: '/srv',
      name: 'srv',
    })
    expect((await me.post(`/api/terminal-spaces/${body.id}/session`, size)).status).toBe(409)
  })

  it('opens the shell in the space directory and adopts it back by space after a server restart', async () => {
    const [space] = await t.db
      .insert(terminalSpaces)
      .values({ ownerId: owner.id, machineId: machine.id, name: 'srv', cwd: '/srv/app' })
      .returning()
    const transport = new FakeTransport()
    const service = new TerminalService(t.ctx, transport)
    const session = await service.openSpace(owner.id, space!.id, size)
    await service.attach(owner.id, session.sessionId)
    expect(transport.opens[0]).toMatchObject({
      action: 'create',
      groupId: space!.id,
      botId: space!.id,
      cwd: '/srv/app',
      workspace: { repo: null, cdPath: null },
    })

    const restarted = new TerminalService(t.ctx, new FakeTransport())
    await restarted.reconcile(machine.id, [
      {
        sessionId: session.sessionId,
        groupId: space!.id,
        botId: space!.id,
        cols: 120,
        rows: 32,
        createdAt: '',
      },
    ])
    expect((await restarted.openSpace(owner.id, space!.id, size)).sessionId).toBe(session.sessionId)

    await restarted.closeSpace(owner.id, space!.id)
    expect((await restarted.openSpace(owner.id, space!.id, size)).sessionId).not.toBe(session.sessionId)
  })
})
