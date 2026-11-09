import { type BotDto, PROTOCOL_VERSION, type ServerToDaemon } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, messages } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const owners = client(t, await t.seed.cookie(owner.id))
  const admins = client(t, await t.seed.cookie(admin.id))
  return { owner, admin, machine, token, bot, owners, admins }
}

describe('bot approval settings', () => {
  it('defaults to 帮我审批: AI review on, nothing allowed always', async () => {
    const w = await world()
    const res = await w.owners.get<BotDto>(`/api/bots/${w.bot.id}`)
    expect(res.body).toMatchObject({
      tier: 'workspace',
      aiReview: true,
      approval: 'ask',
      allowlist: [],
      alwaysAllow: [],
    })
  })

  it('the owner edits alwaysAllow, normalized, and the change is audited', async () => {
    const w = await world()
    const res = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, {
      alwaysAllow: [' npm   test', 'tool:Fetch', 'npm test'],
    })
    expect(res.status).toBe(200)
    expect(res.body.alwaysAllow).toEqual(['npm test', 'tool:Fetch'])
    const rows = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'bot.approval'))
    expect(rows[0]?.detail).toMatchObject({
      from: { alwaysAllow: [] },
      to: { alwaysAllow: ['npm test', 'tool:Fetch'] },
    })
  })

  it('the retired approval modes and allowlist are not settable any more', async () => {
    const w = await world()
    const res = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, { approval: 'all', allowlist: ['ls'] })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ approval: 'ask', allowlist: [] })
    expect(await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'bot.approval'))).toEqual([])
  })

  it('audits the owner switching to 每次问我: it decides what runs unattended on their machine', async () => {
    const w = await world()
    const res = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, { aiReview: false })
    expect(res.body.aiReview).toBe(false)
    await w.owners.patch(`/api/bots/${w.bot.id}`, { systemPrompt: 'x' })
    const rows = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'bot.approval'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorUserId: w.owner.id,
      detail: {
        botId: w.bot.id,
        name: 'cc',
        from: { alwaysAllow: [], aiReview: true },
        to: { alwaysAllow: [], aiReview: false },
      },
    })
  })

  it('rejects empty entries', async () => {
    const w = await world()
    const res = await w.owners.patch(`/api/bots/${w.bot.id}`, { alwaysAllow: ['go build', '   '] })
    expect(res.status).toBe(400)
  })

  it('a sysadmin cannot change the approval settings of another bot, but can change the rest', async () => {
    const w = await world()
    for (const body of [{ alwaysAllow: ['ls'] }, { aiReview: false }]) {
      const res = await w.admins.patch(`/api/bots/${w.bot.id}`, body)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('forbidden')
    }
    const ok = await w.admins.patch<BotDto>(`/api/bots/${w.bot.id}`, { concurrency: 3 })
    expect(ok.body).toMatchObject({ concurrency: 3, aiReview: true })
  })

  it('bots created by a sysadmin for someone else start at 帮我审批 even if approval is sent', async () => {
    const w = await world()
    const res = await w.admins.post<BotDto>('/api/bots', {
      name: '代建',
      ownerId: w.owner.id,
      agentKind: 'claude',
      machineId: w.machine.id,
      approval: 'all',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ approval: 'ask', allowlist: [], aiReview: true })
  })

  it('run.start carries the bot alwaysAllow and AI review, approval always ask', async () => {
    const w = await world()
    await w.owners.patch(`/api/bots/${w.bot.id}`, { alwaysAllow: ['npm test'], aiReview: false })

    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token: w.token,
        daemonVersion: '0.1.0',
        machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
        agents: [],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    const g = await t.seed.group({ createdBy: w.owner.id, botIds: [w.bot.id] })
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: g.id,
        kind: 'user',
        authorUserId: w.owner.id,
        body: '@cc 构建',
        meta: { mentions: [w.bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const start = await box.next<ServerToDaemon>()
    if (start.t !== 'run.start') throw new Error(`unexpected ${start.t}`)
    expect(start.bot).toMatchObject({
      approval: 'ask',
      allowlist: [],
      alwaysAllow: ['npm test'],
      aiReview: false,
    })
    ws.close()
  })
})
