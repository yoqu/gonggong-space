import { PROTOCOL_VERSION } from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvals, messages, questionSets, runs } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(wang.id)
  const { machine: other } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: wang.id, name: 'Codex', machineId: machine.id, concurrency: 4 })
  const elsewhere = await t.seed.bot({ ownerId: wang.id, name: '别处', machineId: other.id })
  const g = await t.seed.group({ createdBy: wang.id, botIds: [claude.id, codex.id, elsewhere.id] })
  const run = async (botId: string, status: string) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: g.id, kind: 'user', authorUserId: wang.id, body: `@bot ${status}` })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId,
        triggerMessageId: m!.id,
        triggerUserId: wang.id,
        originUserId: wang.id,
        status,
        startedAt: status === 'queued' ? null : new Date(),
      })
      .returning()
    return r!
  }
  return { token, claude, codex, elsewhere, run }
}

const hello = (token: string, activeRuns: string[]) => ({
  t: 'hello',
  protocol: PROTOCOL_VERSION,
  token,
  daemonVersion: '0.1.0',
  machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
  agents: [],
  activeRuns,
})

async function connect(msg: unknown) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(JSON.stringify(msg))
  return box
}

const status = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!

describe('hello reconciliation (daemon restart)', () => {
  it('interrupts live runs the daemon no longer has, keeps the ones it reports, and reschedules', async () => {
    const w = await world()
    const kept = await w.run(w.codex.id, 'running')
    const lost = await w.run(w.claude.id, 'running')
    const approving = await w.run(w.codex.id, 'awaiting_approval')
    const answering = await w.run(w.codex.id, 'awaiting_answer')
    const foreign = await w.run(w.elsewhere.id, 'running')
    const done = await w.run(w.claude.id, 'completed')
    const next = await w.run(w.claude.id, 'queued')
    await t.db.insert(approvals).values({
      runId: approving.id,
      requestId: 'q1',
      title: 'Bash',
      toolKind: 'execute',
      detail: 'rm -rf dist',
      options: [],
      expiresAt: new Date(Date.now() + 60_000),
    })
    await t.db.insert(questionSets).values({
      runId: answering.id,
      requestId: 'a1',
      questions: [],
      expiresAt: new Date(Date.now() + 60_000),
    })

    const box = await connect(hello(w.token, [kept.id]))
    expect(await box.next()).toMatchObject({ t: 'welcome' })

    for (const r of [lost, approving, answering]) {
      const row = await status(r.id)
      expect(row.status).toBe('interrupted')
      expect(row.step).toBe('daemon 重启，本轮已中断')
      expect(row.endedAt).not.toBeNull()
    }
    expect((await status(kept.id)).status).toBe('running')
    expect((await status(foreign.id)).status).toBe('running')
    expect((await status(done.id)).status).toBe('completed')
    const [a] = await t.db.select().from(approvals).where(eq(approvals.runId, approving.id))
    expect(a).toMatchObject({ status: 'void', voidReason: 'ended' })
    const [q] = await t.db.select().from(questionSets).where(eq(questionSets.runId, answering.id))
    expect(q?.status).toBe('void')

    // The bot's slot is free again: its queued turn is dispatched to the reconnected daemon.
    expect(await box.next()).toMatchObject({ t: 'run.start', runId: next.id })
    await expect.poll(async () => (await status(next.id)).status).toBe('running')
  })

  it('keeps every live run when the daemon reports them all (server restart)', async () => {
    const w = await world()
    const a = await w.run(w.claude.id, 'running')
    const b = await w.run(w.codex.id, 'awaiting_approval')
    const box = await connect(hello(w.token, [a.id, b.id]))
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    expect((await status(a.id)).status).toBe('running')
    expect((await status(b.id)).status).toBe('awaiting_approval')
  })
})
