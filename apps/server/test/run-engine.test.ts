import { PROTOCOL_VERSION, type RunStart, type WebEvent } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { messages, runEvents, runs } from '../src/db/schema.js'
import { stopRuns } from '../src/modules/runs/stop.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function daemon(token: string, activeRuns: string[] = []) {
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
      activeRuns,
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  return { ws, box, send }
}

/** One bot on one machine running one turn; `deltas` are the pushed run.delta texts. */
async function oneRun() {
  const alice = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({ ownerId: alice.id, name: 'A', machineId: machine.id, binding: 'bound' })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
  const d = await daemon(token)
  const deltas: string[] = []
  let running = false
  t.ctx.bus.attach(alice.id, (e) => {
    if (e.t === 'run.delta') deltas.push(e.text)
    if (e.t === 'run.updated' && e.run.status === 'running') running = true
  })
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
  const runId = (await d.box.next<RunStart>()).runId
  // The running card is pushed after the start went out; let it land so tests only see their own pushes.
  await expect.poll(() => running).toBe(true)
  const text = (delta: string) => d.send({ t: 'run.event', runId, event: { kind: 'text', delta } })
  const tool = (title: string, to = d) =>
    to.send({
      t: 'run.event',
      runId,
      event: { kind: 'tool', toolCallId: 'c1', title, toolKind: 'execute', status: 'pending' },
    })
  // A background task is accepted after the turn ended too: once it is stored, earlier reports were handled.
  const task = async (taskId: string, to = d) => {
    to.send({
      t: 'run.event',
      runId,
      event: { kind: 'task', taskId, name: 'x', taskType: 'shell', state: 'running' },
    })
    await expect
      .poll(async () =>
        (await t.db.select().from(runEvents).where(eq(runEvents.runId, runId))).some(
          (e) => (e.payload as { taskId?: string }).taskId === taskId,
        ),
      )
      .toBe(true)
  }
  const stored = async () =>
    (
      await t.db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), eq(runEvents.kind, 'text')))
    ).map((e) => e.payload)
  const step = async () =>
    (await t.db.select({ step: runs.step }).from(runs).where(eq(runs.id, runId)))[0]?.step
  const tools = async () =>
    (
      await t.db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), eq(runEvents.kind, 'tool')))
    ).map((e) => (e.payload as { title: string }).title)
  return { alice, machine, token, group, d, runId, deltas, text, tool, task, stored, step, tools }
}

/** SQL the app sends from now on. */
function recordQueries() {
  const sent: string[] = []
  t.db.$client.options.debug = (_conn, query) => sent.push(query)
  return sent
}

it('handles one machine’s reports while another machine’s are stuck', async () => {
  const alice = await t.seed.user({ name: '王磊' })
  const a = await t.seed.machine(alice.id)
  const b = await t.seed.machine(alice.id, { name: 'linux' })
  const botA = await t.seed.bot({ ownerId: alice.id, name: 'A', machineId: a.machine.id, binding: 'bound' })
  const botB = await t.seed.bot({ ownerId: alice.id, name: 'B', machineId: b.machine.id, binding: 'bound' })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [botA.id, botB.id] })
  const da = await daemon(a.token)
  const db = await daemon(b.token)
  const seen: WebEvent[] = []
  t.ctx.bus.attach(alice.id, (e) => seen.push(e))

  const [m] = await t.db
    .insert(messages)
    .values({
      groupId: group.id,
      kind: 'user',
      authorUserId: alice.id,
      body: '@A @B go',
      meta: { mentions: [botA.id, botB.id] },
    })
    .returning()
  await triggerRuns(t.ctx, m!)
  const runA = (await da.box.next<RunStart>()).runId
  const runB = (await db.box.next<RunStart>()).runId
  const delta = (runId: string) => seen.some((e) => e.t === 'run.delta' && e.runId === runId)

  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  let locked = () => {}
  const lock = t.db.transaction(async (tx) => {
    await tx.select().from(runs).where(eq(runs.id, runA)).for('update')
    locked()
    await held
  })
  await new Promise<void>((r) => {
    locked = r
  })

  da.ws.send(JSON.stringify({ t: 'run.event', runId: runA, event: { kind: 'text', delta: 'A ' } }))
  db.ws.send(JSON.stringify({ t: 'run.event', runId: runB, event: { kind: 'text', delta: 'B ' } }))
  await expect.poll(() => delta(runB)).toBe(true)
  expect(delta(runA)).toBe(false)

  release()
  await lock
  await expect.poll(() => delta(runA)).toBe(true)
})

it('streams later chunks of a checked run without waiting on its row', async () => {
  const { runId, deltas, text } = await oneRun()
  text('a ')
  await expect.poll(() => deltas.join('')).toBe('a ')

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
  try {
    text('b ')
    await expect.poll(() => deltas.join('')).toBe('a b ')
  } finally {
    release()
    await lock
  }
})

it('checks a run against its row once, not on every tool report or stream after it', async () => {
  const { deltas, text, tool, step, tools } = await oneRun()
  text('a ')
  await expect.poll(() => deltas.join('')).toBe('a ')
  const sent = recordQueries()
  tool('ls')
  tool('ls')
  text('b ')
  await expect.poll(() => deltas.join('')).toBe('a b ')
  tool('cat')
  await expect.poll(step).toBe('cat')
  const engine = [...sent]
  expect(await tools()).toEqual(['ls', 'ls', 'cat'])
  expect(engine.filter((q) => /for share/i.test(q))).toEqual([])
  // The stream after a tool starts a new row; the tool row is not read back for it.
  expect(engine.filter((q) => /^select/i.test(q) && q.includes('"run_events"'))).toEqual([])
})

it('pushes a new step without loading the rest of the card; a status change still pushes the card', async () => {
  const { alice, d, runId, tool, step } = await oneRun()
  const seen: WebEvent[] = []
  t.ctx.bus.attach(alice.id, (e) => seen.push(e))
  const sent = recordQueries()
  tool('ls')
  await expect.poll(() => seen.find((e) => e.t === 'run.step')).toMatchObject({ runId, step: 'ls' })
  expect(await step()).toBe('ls')
  const card = (q: string) => /"(approvals|question_sets)"/.test(q)
  expect(sent.filter(card)).toEqual([])
  expect(seen.filter((e) => e.t === 'run.updated')).toEqual([])

  d.send({
    t: 'run.done',
    runId,
    outcome: 'completed',
    reply: '',
    filesChanged: 0,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: null,
    git: null,
    patch: null,
    appendsApplied: 0,
  })
  await expect
    .poll(() => seen.find((e) => e.t === 'run.updated'))
    .toMatchObject({ run: { id: runId, status: 'completed' } })
  expect(sent.filter(card).length).toBeGreaterThan(0)
})

it('drops reports that arrive after the run ended', async () => {
  const { d, runId, tool, task, step, tools } = await oneRun()
  tool('ls')
  await expect.poll(step).toBe('ls')
  d.send({
    t: 'run.done',
    runId,
    outcome: 'completed',
    reply: '',
    filesChanged: 0,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: null,
    git: null,
    patch: null,
    appendsApplied: 0,
  })
  tool('late')
  await task('t1')
  expect(await tools()).toEqual(['ls'])
  expect(await step()).toBe('')
})

it('drops reports of a run stopped while its machine was away', async () => {
  const { alice, token, group, runId, tool, task, d, machine, step, tools } = await oneRun()
  tool('ls')
  await expect.poll(step).toBe('ls')
  d.ws.close()
  await expect.poll(() => t.ctx.hub.isOnline(machine.id)).toBe(false)
  const [stopped] = await stopRuns(t.ctx, { groupId: group.id }, alice)
  expect(stopped).toMatchObject({ status: 'interrupted' })

  const back = await daemon(token, [runId])
  tool('late', back)
  await task('t1', back)
  expect(await tools()).toEqual(['ls'])
  expect(await step()).toBe(stopped?.step)
})

it('drops chunks that arrive after the run ended', async () => {
  const { runId, deltas, text, task, stored, d } = await oneRun()
  text('a ')
  await expect.poll(() => deltas.join('')).toBe('a ')
  d.send({
    t: 'run.done',
    runId,
    outcome: 'completed',
    reply: '',
    filesChanged: 0,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: null,
    git: null,
    patch: null,
    appendsApplied: 0,
  })
  text('late ')
  await task('t1')
  expect(deltas.join('')).toBe('a ')
  expect(await stored()).toMatchObject([{ kind: 'text' }])
})

it('drops chunks of a run stopped while its machine was away', async () => {
  const { alice, token, group, runId, deltas, text, task, d, machine } = await oneRun()
  text('a ')
  await expect.poll(() => deltas.join('')).toBe('a ')
  d.ws.close()
  await expect.poll(() => t.ctx.hub.isOnline(machine.id)).toBe(false)
  expect(await stopRuns(t.ctx, { groupId: group.id }, alice)).toMatchObject([{ status: 'interrupted' }])

  const back = await daemon(token, [runId])
  back.send({ t: 'run.event', runId, event: { kind: 'text', delta: 'late ' } })
  await task('t1', back)
  expect(deltas.join('')).toBe('a ')
})

it("scopes a run's streamed text and progress to its group; card updates reach every connection", async () => {
  const { alice, group, deltas, text, tool, task, step } = await oneRun()
  const seen: [WebEvent['t'], string | undefined][] = []
  t.ctx.bus.attach(alice.id, (e, _, scope) => seen.push([e.t, scope]))
  text('hi ')
  await expect.poll(() => deltas.join('')).toBe('hi ')
  tool('ls')
  await expect.poll(step).toBe('ls')
  tool('ls')
  await task('t1')
  expect(seen).toContainEqual(['run.delta', group.id])
  expect(seen).toContainEqual(['run.progress', group.id])
  expect(seen).toContainEqual(['run.step', undefined])
  await expect.poll(() => seen).toContainEqual(['run.updated', undefined])
  for (const [e, scope] of seen)
    expect([e, scope === group.id]).toEqual([e, e === 'run.delta' || e === 'run.progress'])
})
