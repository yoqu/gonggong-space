import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { auditTerminal } from '../src/modules/terminals/audit.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(() => t.close())

describe('terminal audit', () => {
  it('records actor, machine, workspace, session and lifecycle without terminal content', async () => {
    const actor = await t.seed.user()
    const { machine } = await t.seed.machine(actor.id)
    const bot = await t.seed.bot({ ownerId: actor.id, machineId: machine.id })
    const group = await t.seed.group({ createdBy: actor.id, botIds: [bot.id] })
    const event = {
      actorUserId: actor.id,
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      sessionId: crypto.randomUUID(),
      action: 'create',
      workspace: { repo: 'git@example.test:team/repo.git', cdPath: '/work/team/repo' },
      status: 'running',
      reason: null,
      command: 'printf must-not-be-audited',
      input: '\u0003',
      output: 'must-not-be-audited',
    } as const

    await auditTerminal(t.ctx, event)

    const [row] = await t.db.select().from(auditLogs)
    expect(row).toMatchObject({
      category: 'terminal',
      actorUserId: actor.id,
      groupId: group.id,
      action: 'session.create',
      detail: {
        machineId: machine.id,
        botId: bot.id,
        sessionId: event.sessionId,
        workspace: event.workspace,
        lifecycle: { status: 'running', reason: null },
      },
    })
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain('must-not-be-audited')
    expect(serialized).not.toContain('command')
    expect(serialized).not.toContain('input')
    expect(serialized).not.toContain('output')
  })

  it('records daemon-originated lifecycle separately from the machine owner', async () => {
    const actor = await t.seed.user()
    const { machine } = await t.seed.machine(actor.id)
    const bot = await t.seed.bot({ ownerId: actor.id, machineId: machine.id })
    const group = await t.seed.group({ createdBy: actor.id, botIds: [bot.id] })
    await auditTerminal(t.ctx, {
      actorUserId: null,
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      sessionId: crypto.randomUUID(),
      action: 'exit',
      workspace: { repo: null, cdPath: null },
      status: 'exited',
      reason: 'exited',
    })

    const [row] = await t.db.select().from(auditLogs)
    expect(row).toMatchObject({ actorUserId: null, action: 'session.exit' })
    expect(row?.detail).toMatchObject({ lifecycle: { status: 'exited', reason: 'exited' } })
  })
})
