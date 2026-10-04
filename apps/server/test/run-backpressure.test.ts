import { PROTOCOL_VERSION, type RunStart, type WebEvent } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
import { MAX_PENDING_BYTES } from '../src/modules/runs/engine.js'
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

const CHUNK = 1 << 20
const SLOW = { timeout: 30_000 }

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({ ownerId: alice.id, name: 'A', machineId: machine.id, binding: 'bound' })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
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
  const [m] = await t.db
    .insert(messages)
    .values({
      groupId: group.id,
      kind: 'user',
      authorUserId: alice.id,
      body: '@A go',
      meta: { mentions: [bot.id] },
    })
    .returning()
  await triggerRuns(t.ctx, m!)
  const { runId } = await box.next<RunStart>()
  const seen: WebEvent[] = []
  t.ctx.bus.attach(alice.id, (e) => seen.push(e))
  const emit = (msg: Parameters<typeof t.ctx.hub.emit<'message'>>[2]) =>
    t.ctx.hub.emit('message', machine.id, msg)
  const text = (i: number) =>
    emit({ t: 'run.event', runId, event: { kind: 'text', delta: `#${i}#`.padEnd(CHUNK, '.') } })
  const done = () =>
    emit({
      t: 'run.done',
      runId,
      outcome: 'completed',
      reply: '好了',
      filesChanged: 0,
      usage: null,
      sessionId: 'sess-1',
      newSessionReason: null,
      error: null,
      git: null,
      patch: null,
      appendsApplied: 0,
      sync: null,
    })
  const marker = () => emit({ t: 'session.config', runId, model: 'drained', effort: null })
  const drained = () => seen.some((e) => e.t === 'run.updated' && e.run.model === 'drained')
  const streamed = () =>
    seen
      .flatMap((e) => (e.t === 'run.delta' && e.runId === runId ? [e.text] : []))
      .join('')
      .match(/#\d+#/g)
      ?.map((s) => Number(s.slice(1, -1))) ?? []
  return { runId, text, done, marker, drained, streamed }
}

/** Blocks the machine's first job by holding the run row's lock; returns the release. */
async function stall(runId: string) {
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  let locked = () => {}
  const lock = t.db.transaction(async (tx) => {
    await tx.select().from(runs).where(eq(runs.id, runId)).for('update')
    locked()
    await held
  })
  await new Promise<void>((r) => {
    locked = r
  })
  return async () => {
    release()
    await lock
  }
}

it('bounds a slow machine’s pending stream, keeps order, and still finishes the run', SLOW, async () => {
  const w = await world()
  const release = await stall(w.runId)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const total = (3 * MAX_PENDING_BYTES) / CHUNK
  for (let i = 0; i < total; i++) w.text(i)
  w.done()
  release()

  await expect
    .poll(async () => (await t.db.select().from(runs).where(eq(runs.id, w.runId)))[0]?.status, SLOW)
    .toBe('completed')
  const got = w.streamed()
  expect(got.length).toBeLessThanOrEqual(MAX_PENDING_BYTES / CHUNK + 1)
  expect(got.length).toBeGreaterThan(0)
  expect(got).toEqual(got.map((_, i) => i))
  const [reply] = await t.db.select().from(messages).where(eq(messages.runId, w.runId))
  expect(reply?.body).toBe('好了')
  expect(warn).toHaveBeenCalledTimes(1)
})

it('waits for in-flight reports when shutting down', SLOW, async () => {
  const w = await world()
  const release = await stall(w.runId)
  w.done()
  let closed = false
  const closing = t.app.close().then(() => {
    closed = true
  })
  await new Promise((r) => setTimeout(r, 300))
  expect(closed).toBe(false)
  await release()
  await closing
  const [run] = await t.db.select().from(runs).where(eq(runs.id, w.runId))
  expect(run?.status).toBe('completed')
})

it('releases the budget once the queue drains', SLOW, async () => {
  const w = await world()
  const release = await stall(w.runId)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (let i = 0; i < (2 * MAX_PENDING_BYTES) / CHUNK; i++) w.text(i)
  await release()
  w.marker()
  await expect.poll(w.drained, SLOW).toBe(true)
  const before = w.streamed().length

  w.text(1000)
  await expect.poll(() => w.streamed().length, SLOW).toBe(before + 1)
  expect(warn).toHaveBeenCalledTimes(1)
})
