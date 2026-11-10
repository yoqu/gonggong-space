import type { RunStart, ServerToDaemon } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupBots, messages, runs, teamMembers, users } from '../src/db/schema.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world(agentKind = 'claude') {
  const alice = await t.seed.user({ name: '王磊' })
  const { machine } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({
    ownerId: alice.id,
    name: 'Claude',
    machineId: machine.id,
    concurrency: 2,
    agentKind,
  })
  const sent: ServerToDaemon[] = []
  const conn = { send: (m: ServerToDaemon) => void sent.push(m), close: () => {} }
  // Online without hub.register: its 'online' event schedules in the background, racing each test's own schedule().
  vi.spyOn(t.ctx.hub, 'isOnline').mockImplementation((id) => id === machine.id)
  vi.spyOn(t.ctx.hub, 'send').mockImplementation((id, m) => id === machine.id && (conn.send(m), true))
  const queued = async (origin = alice.id) => {
    const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id], memberIds: [origin] })
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: origin, body: '@Claude go' })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        triggerUserId: origin,
        originUserId: origin,
        status: 'queued',
      })
      .returning()
    return { group, message: m!, run: run! }
  }
  const status = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
  return { alice, bot, sent, conn, queued, status }
}

describe('dispatch', () => {
  it('holds a Gemini CLI run until its machine runs a client that knows Gemini', async () => {
    const w = await world('gemini')
    const a = await w.queued()
    const features = vi.spyOn(t.ctx.hub, 'features').mockReturnValue(['tools'])

    await schedule(t.ctx, w.bot.id)

    expect(w.sent).toEqual([])
    expect(await w.status(a.run.id)).toMatchObject({
      status: 'offline_wait',
      step: '执行机器的共工客户端版本过低，升级后才能运行 Gemini CLI Bot',
    })

    features.mockReturnValue(['tools', 'gemini'])
    await schedule(t.ctx, w.bot.id)
    expect(w.sent).toMatchObject([{ t: 'run.start', runId: a.run.id, bot: { agentKind: 'gemini' } }])
  })

  it('sends run.start only after the transaction committed', async () => {
    const w = await world()
    const a = await w.queued()
    const seen: Promise<string>[] = []
    w.conn.send = (m) => {
      w.sent.push(m)
      // Another connection only sees the running status once the dispatch transaction is committed.
      seen.push(
        t.db
          .select()
          .from(runs)
          .where(eq(runs.id, a.run.id))
          .then(([r]) => r!.status),
      )
    }

    await schedule(t.ctx, w.bot.id)

    expect(w.sent).toMatchObject([{ t: 'run.start', runId: a.run.id }])
    expect(await Promise.all(seen)).toEqual(['running'])
  })

  it('sends nothing when the dispatch transaction fails, and leaves every run queued', async () => {
    const w = await world()
    const a = await w.queued()
    const b = await w.queued()
    // The second run's start cannot be built, which aborts the whole transaction after the first was prepared.
    await t.db.delete(groupBots).where(eq(groupBots.groupId, b.group.id))

    await expect(schedule(t.ctx, w.bot.id)).rejects.toThrow('lost its trigger message or group membership')

    expect(w.sent).toEqual([])
    expect((await w.status(a.run.id)).status).toBe('queued')
    expect((await w.status(b.run.id)).status).toBe('queued')
  })

  it('puts a run back to offline_wait, without consuming its context, when the machine dropped before the send', async () => {
    const w = await world()
    const a = await w.queued()
    const statuses: string[] = []
    t.ctx.bus.attach(w.alice.id, (e) => {
      if (e.t === 'run.updated') statuses.push(e.run.status)
    })
    vi.spyOn(t.ctx.hub, 'send').mockReturnValue(false)

    await schedule(t.ctx, w.bot.id)

    expect(await w.status(a.run.id)).toMatchObject({ status: 'offline_wait', startedAt: null })
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, a.group.id), eq(groupBots.botId, w.bot.id)))
    expect(gb?.contextSeq).toBe(0)
    // Never shown as running.
    expect(statuses).toEqual(['offline_wait'])
  })

  it('advances the context cursor once the start was sent', async () => {
    const w = await world()
    const a = await w.queued()

    await schedule(t.ctx, w.bot.id)

    const [start] = w.sent as RunStart[]
    expect(start).toMatchObject({ t: 'run.start', runId: a.run.id })
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, a.group.id), eq(groupBots.botId, w.bot.id)))
    expect(gb?.contextSeq).toBe(a.message.seq)
  })
})

describe('management tools', () => {
  const WRITES = ['mcp_create', 'mcp_update', 'mcp_toggle', 'mcp_delete', 'skill_create', 'skill_update']
  const RELEASE = ['client_release_publish', 'client_release_notes']

  async function startFor(w: Awaited<ReturnType<typeof world>>, origin: string) {
    const a = await w.queued(origin)
    await schedule(t.ctx, w.bot.id)
    await t.db.update(runs).set({ status: 'succeeded' }).where(eq(runs.id, a.run.id))
    return (w.sent as RunStart[]).find((m) => m.runId === a.run.id)!
  }

  it('hides layer and release writes from a turn whose originator administers nothing', async () => {
    const w = await world()
    const bob = await t.seed.user({ name: '赵敏' })
    const start = await startFor(w, bob.id)
    expect(start.hiddenTools).toEqual(expect.arrayContaining([...WRITES, ...RELEASE]))
    expect(start.hiddenTools).not.toContain('mcp_list')
    expect(start.hiddenTools).not.toContain('skill_list')
  })

  it('gives a group or team admin the layer writes, and only a sysadmin the release tools', async () => {
    const w = await world()
    const groupAdmin = await startFor(w, w.alice.id)
    expect(groupAdmin.hiddenTools).not.toContain('mcp_create')
    expect(groupAdmin.hiddenTools).toEqual(expect.arrayContaining(RELEASE))

    const lead = await t.seed.user({ name: '周芷若' })
    await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, lead.id))
    expect((await startFor(w, lead.id)).hiddenTools).not.toContain('skill_create')

    await t.db.update(users).set({ role: 'sysadmin' }).where(eq(users.id, w.alice.id))
    expect((await startFor(w, w.alice.id)).hiddenTools).not.toContain('client_release_publish')
  })
})
