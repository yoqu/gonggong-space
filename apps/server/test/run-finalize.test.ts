import { PROTOCOL_VERSION, type RunStart } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => {
  vi.restoreAllMocks()
  return t.close()
})

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(alice.id)
  const a = await t.seed.bot({ ownerId: alice.id, name: 'A', machineId: machine.id, binding: 'bound' })
  const b = await t.seed.bot({ ownerId: alice.id, name: 'B', machineId: machine.id, binding: 'bound' })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [a.id, b.id] })
  const connect = async () => {
    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token,
        daemonVersion: '0.1.0',
        machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
        agents: [],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    return { ws, box }
  }
  const say = async (body: string, meta: Record<string, unknown>) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: alice.id, body, meta })
      .returning()
    return m!
  }
  const done = (ws: { send: (s: string) => void }, runId: string, reply = '好了') =>
    ws.send(
      JSON.stringify({
        t: 'run.done',
        runId,
        outcome: 'completed',
        reply,
        filesChanged: 0,
        usage: null,
        sessionId: 'sess-1',
        newSessionReason: null,
        error: null,
        git: null,
        patch: null,
        appendsApplied: 0,
      }),
    )
  const run = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
  const allRuns = () => t.db.select().from(runs)
  const replies = (runId: string) =>
    t.db
      .select()
      .from(messages)
      .where(and(eq(messages.runId, runId), eq(messages.kind, 'bot')))
  /** Fails the publish of run `runId` completing, as a crash between the terminal commit and its side effects. */
  const breakPublish = (runId: string) => {
    let broken = true
    const publish = t.ctx.bus.publish.bind(t.ctx.bus)
    vi.spyOn(t.ctx.bus, 'publish').mockImplementation((ids, e) => {
      if (broken && e.t === 'run.updated' && e.run.id === runId && e.run.status === 'completed')
        throw new Error('injected failure')
      return publish(ids, e)
    })
    return () => {
      broken = false
    }
  }
  return { alice, a, b, group, connect, say, done, run, allRuns, replies, breakPublish }
}

/** A run of bot A that handed off to B and has one 打断并追加 message the agent never applied. */
async function pendingWork(w: Awaited<ReturnType<typeof world>>, box: { next: <T>() => Promise<T> }) {
  const m = await w.say('@A go', { mentions: [w.a.id] })
  await triggerRuns(t.ctx, m)
  const { runId } = await box.next<RunStart>()
  await t.db
    .update(runs)
    .set({ handoffs: [{ botId: w.b.id, task: '接着做' }] })
    .where(eq(runs.id, runId))
  await w.say('补一句', { mentions: [], appendTo: runId })
  return runId
}

it('keeps the terminal state and the final reply together, and never posts the reply twice', async () => {
  const w = await world()
  const d = await w.connect()
  const m = await w.say('@A go', { mentions: [w.a.id] })
  await triggerRuns(t.ctx, m)
  const { runId } = await d.box.next<RunStart>()

  // A reply Postgres rejects fails the reply insert, which must roll the terminal update back with it.
  w.done(d.ws, runId, 'a\u0000b')
  await new Promise((r) => setTimeout(r, 200))
  expect((await w.run(runId)).status).toBe('running')
  expect(await w.replies(runId)).toEqual([])

  w.done(d.ws, runId)
  await expect.poll(async () => (await w.run(runId)).status).toBe('completed')
  expect(await w.replies(runId)).toHaveLength(1)
  w.done(d.ws, runId)
  await new Promise((r) => setTimeout(r, 200))
  expect(await w.replies(runId)).toHaveLength(1)
})

it('finishes the side effects of a run whose run.done is delivered again, exactly once', async () => {
  const w = await world()
  const d = await w.connect()
  const runId = await pendingWork(w, d.box)
  const repair = w.breakPublish(runId)

  w.done(d.ws, runId)
  await expect.poll(async () => (await w.run(runId)).finalizing).toBe(true)
  // Committed together: the terminal state and the reply; nothing after the failed step happened yet.
  expect((await w.run(runId)).status).toBe('completed')
  expect(await w.replies(runId)).toHaveLength(1)
  expect(await w.allRuns()).toHaveLength(1)

  repair()
  w.done(d.ws, runId)
  await expect.poll(async () => (await w.run(runId)).finalizing).toBe(false)
  await expect.poll(async () => (await w.allRuns()).length).toBe(3)
  const rows = await w.allRuns()
  expect(rows.filter((r) => r.parentRunId === runId).map((r) => r.botId)).toEqual([w.b.id])
  expect(rows.filter((r) => r.botId === w.a.id && r.id !== runId)).toHaveLength(1)
  expect(await w.replies(runId)).toHaveLength(1)

  // A third delivery finds the run finished and changes nothing.
  w.done(d.ws, runId)
  await new Promise((r) => setTimeout(r, 200))
  expect(await w.allRuns()).toHaveLength(3)
  const relayed = await t.db.select().from(messages).where(eq(messages.body, '@B 接着做'))
  expect(relayed).toHaveLength(1)
})

it('finishes the side effects when the machine reconnects, without a repeated run.done', async () => {
  const w = await world()
  const d = await w.connect()
  const runId = await pendingWork(w, d.box)
  const repair = w.breakPublish(runId)

  w.done(d.ws, runId)
  await expect.poll(async () => (await w.run(runId)).finalizing).toBe(true)

  repair()
  d.ws.close()
  await expect.poll(() => t.ctx.hub.isOnline(w.a.machineId as string)).toBe(false)
  const again = await w.connect()
  await expect.poll(async () => (await w.run(runId)).finalizing).toBe(false)
  await expect.poll(async () => (await w.allRuns()).length).toBe(3)
  expect(await again.box.next()).toMatchObject({ t: 'run.start' })
  expect(await w.replies(runId)).toHaveLength(1)
})
