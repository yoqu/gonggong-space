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

async function daemon(token: string) {
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

  da.ws.send(JSON.stringify({ t: 'run.event', runId: runA, event: { kind: 'text', delta: 'A' } }))
  db.ws.send(JSON.stringify({ t: 'run.event', runId: runB, event: { kind: 'text', delta: 'B' } }))
  await expect.poll(() => delta(runB)).toBe(true)
  expect(delta(runA)).toBe(false)

  release()
  await lock
  await expect.poll(() => delta(runA)).toBe(true)
})
