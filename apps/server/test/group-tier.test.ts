import { type GroupBotStateDto, PROTOCOL_VERSION, type RunDto, type ServerToDaemon } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvals, bots, messages, runs, systemParams } from '../src/db/schema.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
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

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '陈晨' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id, tier: 'workspace' })
  const g1 = await t.seed.group({ createdBy: member.id, memberIds: [owner.id], botIds: [bot.id] })
  const g2 = await t.seed.group({ createdBy: member.id, memberIds: [owner.id], botIds: [bot.id] })
  const d = await daemon(token)
  const owners = client(t, await t.seed.cookie(owner.id))
  const members = client(t, await t.seed.cookie(member.id))
  const setTier = (c: typeof owners, groupId: string, tier: string | null) =>
    c.put(`/api/groups/${groupId}/bots/${bot.id}/tier`, { tier })
  const trigger = async (groupId: string, by = owner.id) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId, kind: 'user', authorUserId: by, body: '@cc 构建', meta: { mentions: [bot.id] } })
      .returning()
    await triggerRuns(t.ctx, m!)
  }
  const start = async () => {
    const m = await d.next()
    if (m.t !== 'run.start') throw new Error(`unexpected ${m.t}`)
    return m
  }
  return { owner, member, bot, g1, g2, d, owners, members, setTier, trigger, start }
}

describe('per-group tier', () => {
  it('overrides the bot tier in one group only, and null follows the bot again', async () => {
    const w = await world()
    expect((await w.setTier(w.members, w.g1.id, 'full')).status).toBe(403)
    expect((await w.setTier(w.owners, w.g1.id, 'full')).status).toBe(204)
    const states = await w.owners.get<GroupBotStateDto[]>(`/api/groups/${w.g1.id}/bot-states`)
    expect(states.body[0]!.tier).toBe('full')

    await w.trigger(w.g1.id)
    expect((await w.start()).bot.tier).toBe('full')
    await w.trigger(w.g2.id)
    expect((await w.start()).bot.tier).toBe('workspace')

    expect((await w.setTier(w.owners, w.g1.id, null)).status).toBe(204)
    const after = await w.owners.get<GroupBotStateDto[]>(`/api/groups/${w.g1.id}/bot-states`)
    expect(after.body[0]!.tier).toBeNull()
  })

  it('demo mode refuses the full tier and runs a full bot at workspace', async () => {
    const w = await world()
    await t.db.update(bots).set({ tier: 'full' }).where(eq(bots.id, w.bot.id))
    await t.db.insert(systemParams).values({ key: 'demoMode', value: true })
    forgetSysParams(t.db)
    expect((await w.setTier(w.owners, w.g1.id, 'full')).status).toBe(403)
    expect((await w.owners.patch(`/api/bots/${w.bot.id}`, { tier: 'full' })).status).toBe(403)
    await w.trigger(w.g1.id)
    expect((await w.start()).bot.tier).toBe('workspace')
  })

  it('a full override limits triggers to the explicit list like a full bot', async () => {
    const w = await world()
    await w.setTier(w.owners, w.g1.id, 'full')
    await w.trigger(w.g1.id, w.member.id)
    const [run] = await t.db.select().from(runs).where(eq(runs.groupId, w.g1.id))
    expect(run!.status).toBe('forbidden')
  })

  it('raising a live run to full tells the daemon and approves its pending requests', async () => {
    const w = await world()
    await w.trigger(w.g1.id)
    const { runId } = await w.start()
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: `${runId}/1`,
      title: 'Bash',
      toolKind: 'execute',
      detail: 'go build ./...',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    })
    await expect.poll(async () => (await t.db.select().from(approvals)).length).toBe(1)

    await w.setTier(w.owners, w.g1.id, 'full')
    const sent = [await w.d.next(), await w.d.next()]
    expect(sent).toContainEqual({ t: 'run.tier', runId, tier: 'full' })
    expect(sent).toContainEqual({ t: 'approval.decision', runId, requestId: `${runId}/1`, optionId: 'allow' })
    const [a] = await t.db.select().from(approvals)
    expect([a!.status, a!.decidedBy]).toEqual(['approved', w.owner.id])
    const run = await w.owners.get<{ run: RunDto }>(`/api/runs/${runId}`)
    expect(run.body.run.status).toBe('running')
  })

  it('a global tier change reaches live runs in groups without an override', async () => {
    const w = await world()
    await w.setTier(w.owners, w.g2.id, 'read-only')
    await w.trigger(w.g1.id)
    const r1 = await w.start()
    await w.trigger(w.g2.id)
    await w.start()
    expect((await w.owners.patch(`/api/bots/${w.bot.id}`, { tier: 'full' })).status).toBe(200)
    expect(await w.d.next()).toEqual({ t: 'run.tier', runId: r1.runId, tier: 'full' })
  })
})
