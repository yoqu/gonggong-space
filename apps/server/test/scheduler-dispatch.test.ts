import type { RunStart, ServerToDaemon } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupBots, messages, runs } from '../src/db/schema.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const { machine } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({ ownerId: alice.id, name: 'Claude', machineId: machine.id, concurrency: 2 })
  const sent: ServerToDaemon[] = []
  const conn = { send: (m: ServerToDaemon) => void sent.push(m), close: () => {} }
  t.ctx.hub.register(machine.id, conn)
  const queued = async () => {
    const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: alice.id, body: '@Claude go' })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        triggerUserId: alice.id,
        originUserId: alice.id,
        status: 'queued',
      })
      .returning()
    return { group, message: m!, run: run! }
  }
  const status = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
  return { alice, bot, sent, conn, queued, status }
}

describe('dispatch', () => {
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
    // Never shown as running. Registering the machine also schedules in the background, which may publish it again.
    expect([...new Set(statuses)]).toEqual(['offline_wait'])
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
