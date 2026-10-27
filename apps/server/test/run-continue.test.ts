import { PROTOCOL_VERSION, type RunStart, type WebEvent } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const done = (runId: string, reply = '') => ({
  t: 'run.done',
  runId,
  outcome: 'completed',
  reply,
  filesChanged: 0,
  usage: null,
  sessionId: 's1',
  newSessionReason: null,
  error: null,
  git: null,
  patch: null,
  appendsApplied: 0,
})

/** A bot whose turn r1 already ended; `say` posts a message @-ing it. */
async function ended() {
  const alice = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({ ownerId: alice.id, name: 'A', machineId: machine.id, binding: 'bound' })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
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
    activeRuns: [],
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  const seen: WebEvent[] = []
  t.ctx.bus.attach(alice.id, (e) => seen.push(e))
  const say = async (body: string) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: alice.id, body, meta: { mentions: [bot.id] } })
      .returning()
    await triggerRuns(t.ctx, m!)
    return m!
  }
  const trigger = await say('@A 跑测试，跑完告诉我')
  const first = (await box.next<RunStart>()).runId
  send(done(first, '等测试跑完我再继续'))
  await expect
    .poll(async () => (await t.db.select().from(runs).where(eq(runs.id, first)))[0]?.status)
    .toBe('completed')
  return { alice, bot, group, box, send, seen, say, trigger, first }
}

const row = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]

it('opens a running run for what the agent did after its turn, attributed like that turn', async () => {
  const { alice, box, send, seen, trigger, first } = await ended()
  send({ t: 'run.continue', requestId: `${first}/c1`, runId: first })
  const answer = await box.next<{ t: string; requestId: string; runId: string | null }>()
  expect(answer).toMatchObject({ t: 'run.continued', requestId: `${first}/c1` })
  const id = answer.runId as string
  expect(await row(id)).toMatchObject({
    status: 'running',
    continuationOf: first,
    triggerMessageId: trigger.id,
    triggerUserId: alice.id,
    originUserId: alice.id,
    hop: 1,
    parentRunId: null,
  })
  expect((await row(id))?.startedAt).not.toBeNull()
  await expect
    .poll(() => seen.find((e) => e.t === 'run.updated' && e.run.id === id))
    .toMatchObject({ run: { continuationOf: first } })

  send({ t: 'run.event', runId: id, event: { kind: 'text', delta: '测试全过了' } })
  send(done(id, '测试全过了'))
  await expect.poll(async () => (await row(id))?.status).toBe('completed')
  const [reply] = await t.db.select().from(messages).where(eq(messages.runId, id))
  expect(reply?.body).toBe('测试全过了')
})

it('refuses to continue a run that is not this machine’s', async () => {
  const { box, send } = await ended()
  send({ t: 'run.continue', requestId: 'x/c1', runId: '00000000-0000-0000-0000-000000000000' })
  expect(await box.next()).toEqual({ t: 'run.continued', requestId: 'x/c1', runId: null })
})

it('a continuation does not hold back the group’s next turn', async () => {
  const { box, send, say, first } = await ended()
  send({ t: 'run.continue', requestId: `${first}/c1`, runId: first })
  const { runId: id } = await box.next<{ runId: string }>()
  await say('@A 再看看')
  const next = await box.next<RunStart>()
  expect(next).toMatchObject({ t: 'run.start' })
  expect(next.runId).not.toBe(id)
})
