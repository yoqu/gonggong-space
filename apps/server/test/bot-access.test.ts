import { type BotDto, PROTOCOL_VERSION, type ServerToDaemon } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvals, type bots, messages, notifications, runs, systemParams } from '../src/db/schema.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { autoRejects, runAccess } from '../src/modules/bots/access.js'
import { stopRuns } from '../src/modules/runs/stop.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function daemon(token: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  send({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    token,
    daemonVersion: '0.1.0',
    machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
    agents: [],
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return { send, next: () => box.next<ServerToDaemon>() }
}

const OPTIONS = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
]

async function world(bot: Partial<typeof bots.$inferInsert> = {}) {
  const owner = await t.seed.user({ name: '王磊' })
  const friend = await t.seed.user({ name: '陈晨' })
  const other = await t.seed.user({ name: '张杰' })
  const { machine, token } = await t.seed.machine(owner.id)
  const b = await t.seed.bot({
    ownerId: owner.id,
    name: 'cc',
    machineId: machine.id,
    tier: 'full',
    triggerList: [friend.id],
    ...bot,
  })
  const group = await t.seed.group({
    createdBy: owner.id,
    memberIds: [friend.id, other.id],
    botIds: [b.id],
  })
  const d = await daemon(token)
  const owners = client(t, await t.seed.cookie(owner.id))
  const trigger = async (by: string, groupId = group.id) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId, kind: 'user', authorUserId: by, body: '@cc 构建', meta: { mentions: [b.id] } })
      .returning()
    await triggerRuns(t.ctx, m!)
  }
  const start = async () => {
    const m = await d.next()
    if (m.t !== 'run.start') throw new Error(`unexpected ${m.t}`)
    return m
  }
  const done = (runId: string) =>
    d.send({
      t: 'run.done',
      runId,
      outcome: 'completed',
      reply: 'ok',
      filesChanged: 0,
      usage: null,
      sessionId: null,
      newSessionReason: null,
      error: null,
      git: null,
      patch: null,
      appendsApplied: 0,
    })
  const run = async (by: string, groupId = group.id) => {
    await trigger(by, groupId)
    const s = await start()
    done(s.runId)
    await expect.poll(async () => (await runOf(s.runId)).status).toBe('completed')
    return s
  }
  const runOf = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
  return { owner, friend, other, machine, bot: b, group, d, owners, trigger, start, run, runOf }
}

describe('per-audience access', () => {
  it('runs the owner at the bot tier, the trigger list and everyone else at their own levels', async () => {
    const w = await world({ access: { trusted: 'ask', others: 'auto' } })
    const mine = await w.run(w.owner.id)
    expect([mine.bot.tier, (await w.runOf(mine.runId)).audience]).toEqual(['full', 'owner'])

    const friend = await w.run(w.friend.id)
    expect([friend.bot.tier, friend.bot.aiReview]).toEqual(['workspace', false])
    expect((await w.runOf(friend.runId)).audience).toBe('trusted')

    const other = await w.run(w.other.id)
    expect([other.bot.tier, other.bot.aiReview]).toEqual(['workspace', true])
    expect((await w.runOf(other.runId)).audience).toBe('others')
  })

  it('no longer refuses everyone else just because the owner runs at full', async () => {
    const w = await world({ triggerScope: 'all', access: { trusted: 'full', others: 'read-only' } })
    const other = await w.run(w.other.id)
    expect(other.bot.tier).toBe('read-only')
    const friend = await w.run(w.friend.id)
    expect(friend.bot.tier).toBe('full')
  })

  it('a group override caps the others but still sets the owner tier', async () => {
    const w = await world({ tier: 'workspace', access: { trusted: 'full', others: 'auto' } })
    await w.owners.put(`/api/groups/${w.group.id}/bots/${w.bot.id}/tier`, { tier: 'read-only' })
    expect((await w.run(w.friend.id)).bot.tier).toBe('read-only')
    expect((await w.run(w.other.id)).bot).toMatchObject({ tier: 'read-only', aiReview: false })
    await w.owners.put(`/api/groups/${w.group.id}/bots/${w.bot.id}/tier`, { tier: 'full' })
    expect((await w.run(w.owner.id)).bot.tier).toBe('full')
    expect((await w.run(w.other.id)).bot.tier).toBe('workspace')
  })

  it('clears aiReview whenever the resolved tier is not workspace', () => {
    const access = { trusted: 'ask', others: 'auto' } as const
    expect(runAccess({ tier: 'workspace', aiReview: false, access }, 'read-only', 'others')).toEqual({
      tier: 'read-only',
      aiReview: false,
    })
    expect(autoRejects({ tier: 'workspace', aiReview: false, access }, 'read-only', 'others')).toBe(false)
    expect(autoRejects({ tier: 'workspace', aiReview: false, access }, null, 'others')).toBe(true)
    expect(autoRejects({ tier: 'workspace', aiReview: true, access }, null, 'owner')).toBe(false)
    expect(runAccess({ tier: 'workspace', aiReview: true, access }, 'read-only', 'owner')).toEqual({
      tier: 'read-only',
      aiReview: false,
    })
    expect(runAccess({ tier: 'read-only', aiReview: true, access }, null, 'owner')).toEqual({
      tier: 'read-only',
      aiReview: false,
    })
    expect(runAccess({ tier: 'full', aiReview: true, access }, null, 'owner')).toEqual({
      tier: 'full',
      aiReview: false,
    })
  })

  it('a shared DM runs at the trusted level', async () => {
    const w = await world({
      triggerScope: 'self',
      triggerList: [],
      access: { trusted: 'ask', others: 'auto' },
    })
    const dm = await t.seed.group({ createdBy: w.other.id, kind: 'dm', name: 'dm', botIds: [w.bot.id] })
    const s = await w.run(w.other.id, dm.id)
    expect([s.bot.tier, s.bot.aiReview]).toEqual(['workspace', false])
    expect((await w.runOf(s.runId)).audience).toBe('trusted')
  })

  it('rejects what 自动审批 leaves for someone else at once instead of asking the owner', async () => {
    const w = await world({ access: { trusted: 'ask', others: 'auto' } })
    await w.trigger(w.other.id)
    const { runId } = await w.start()
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: `${runId}/1`,
      title: 'Bash',
      toolKind: 'execute',
      detail: 'sudo rm -rf /',
      options: OPTIONS,
    })
    expect(await w.d.next()).toEqual({
      t: 'approval.decision',
      runId,
      requestId: `${runId}/1`,
      optionId: 'reject',
    })
    const [a] = await t.db.select().from(approvals)
    expect([a!.status, a!.decidedBy]).toEqual(['rejected', null])
    expect((await w.runOf(runId)).status).toBe('running')
    expect(await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))).toEqual([])
  })

  it('asks the owner for a trusted member at 需要审批', async () => {
    const w = await world({ access: { trusted: 'ask', others: 'auto' } })
    await w.trigger(w.friend.id)
    const { runId } = await w.start()
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: `${runId}/1`,
      title: 'Bash',
      toolKind: 'execute',
      detail: 'go build ./...',
      options: OPTIONS,
    })
    await expect.poll(async () => (await w.runOf(runId)).status).toBe('awaiting_approval')
    const [a] = await t.db.select().from(approvals)
    expect(a!.status).toBe('pending')
  })

  it('does not auto-reject under 自动审批 when a group read-only override caps the run', async () => {
    const w = await world({ access: { trusted: 'ask', others: 'auto' } })
    await w.owners.put(`/api/groups/${w.group.id}/bots/${w.bot.id}/tier`, { tier: 'read-only' })
    await w.trigger(w.other.id)
    const { runId } = await w.start()
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: `${runId}/1`,
      title: 'Bash',
      toolKind: 'execute',
      detail: 'ls',
      options: OPTIONS,
    })
    await expect.poll(async () => (await w.runOf(runId)).status).toBe('awaiting_approval')
    const [a] = await t.db.select().from(approvals)
    expect(a!.status).toBe('pending')
    await expect
      .poll(
        async () =>
          (await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))).length,
      )
      .toBe(1)
  })

  it('raising a level to full lifts live runs of that audience only, approving their requests', async () => {
    const w = await world({ access: { trusted: 'ask', others: 'ask' } })
    await w.trigger(w.friend.id)
    const friend = await w.start()
    const g2 = await t.seed.group({ createdBy: w.owner.id, memberIds: [w.other.id], botIds: [w.bot.id] })
    await w.trigger(w.other.id, g2.id)
    const other = await w.start()
    for (const r of [friend, other])
      w.d.send({
        t: 'approval.request',
        runId: r.runId,
        requestId: `${r.runId}/1`,
        title: 'Bash',
        toolKind: 'execute',
        detail: 'go build ./...',
        options: OPTIONS,
      })
    await expect.poll(async () => (await t.db.select().from(approvals)).length).toBe(2)
    const res = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, {
      access: { trusted: 'full', others: 'ask' },
    })
    expect(res.body.access).toEqual({ trusted: 'full', others: 'ask' })
    const rows = await t.db.select().from(approvals)
    const otherApproval = rows.find((a) => a.runId === other.runId)!
    expect(otherApproval.status).toBe('pending')
    // Decide the untouched run as a FIFO sentinel: no run.tier should precede it for other.runId.
    expect(
      (await w.owners.post(`/api/runs/${other.runId}/approvals/${otherApproval.id}`, { optionId: 'reject' }))
        .status,
    ).toBe(200)
    const sent = [await w.d.next(), await w.d.next(), await w.d.next()]
    expect(sent).toContainEqual({ t: 'run.tier', runId: friend.runId, tier: 'full' })
    expect(sent).toContainEqual({
      t: 'approval.decision',
      runId: friend.runId,
      requestId: `${friend.runId}/1`,
      optionId: 'allow',
    })
    expect(sent).toContainEqual({
      t: 'approval.decision',
      runId: other.runId,
      requestId: `${other.runId}/1`,
      optionId: 'reject',
    })
    expect(sent.some((m) => m.t === 'run.tier' && m.runId === other.runId)).toBe(false)
  })

  it('changing access.trusted does not overwrite one-shot fullAccessForRun on an unaffected run', async () => {
    const w = await world({ access: { trusted: 'ask', others: 'ask' } })
    await w.trigger(w.friend.id)
    const friend = await w.start()
    const g2 = await t.seed.group({ createdBy: w.owner.id, memberIds: [w.other.id], botIds: [w.bot.id] })
    await w.trigger(w.other.id, g2.id)
    const other = await w.start()

    expect((await w.owners.post(`/api/runs/${other.runId}/full-access`, {})).status).toBe(204)
    expect(await w.d.next()).toEqual({ t: 'run.tier', runId: other.runId, tier: 'full' })

    expect(
      (await w.owners.patch(`/api/bots/${w.bot.id}`, { access: { trusted: 'full', others: 'ask' } })).status,
    ).toBe(200)
    await stopRuns(t.ctx, { groupId: g2.id, runId: other.runId }, w.owner)

    const sent = [await w.d.next(), await w.d.next()]
    expect(sent).toEqual([
      { t: 'run.tier', runId: friend.runId, tier: 'full' },
      { t: 'run.cancel', runId: other.runId },
    ])
  })

  it('only those who manage the bot change access; demo mode refuses full for anyone', async () => {
    const w = await world()
    const friends = client(t, await t.seed.cookie(w.friend.id))
    expect(
      (await friends.patch(`/api/bots/${w.bot.id}`, { access: { trusted: 'full', others: 'full' } })).status,
    ).toBe(403)
    const ok = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, {
      triggerScope: 'all',
      access: { trusted: 'full', others: 'full' },
    })
    expect(ok.body).toMatchObject({ tier: 'full', triggerScope: 'all', access: { others: 'full' } })

    await t.db.insert(systemParams).values({ key: 'demoMode', value: true })
    forgetSysParams(t.db)
    expect(
      (await w.owners.patch(`/api/bots/${w.bot.id}`, { access: { trusted: 'ask', others: 'full' } })).status,
    ).toBe(403)
    await w.trigger(w.other.id)
    expect((await w.start()).bot.tier).toBe('workspace')
  })
})
