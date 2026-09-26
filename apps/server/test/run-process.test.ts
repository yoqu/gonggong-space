import {
  PROTOCOL_VERSION,
  type RunDetailDto,
  type RunEvent,
  type RunStart,
  type TimelineDto,
  type WebEvent,
} from '@gonggong/protocol'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvals, groupBots, groups, messages, runEvents, runs } from '../src/db/schema.js'
import { open } from '../src/lib/seal.js'
import { MASK } from '../src/modules/runs/redact.js'
import { openEvent } from '../src/modules/runs/sealed.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

const GH = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const { machine, token } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({
    ownerId: alice.id,
    name: '小王的 Claude',
    machineId: machine.id,
    binding: 'bound',
  })
  const group = await t.seed.group({ createdBy: alice.id, memberIds: [bob.id], botIds: [bot.id] })

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

  const seen: WebEvent[] = []
  t.ctx.bus.attach(bob.id, (e) => seen.push(e))
  const mention = async () => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: alice.id,
        body: '@bot go',
        meta: { mentions: [bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    return (await box.next<RunStart>()).runId
  }
  const send = (runId: string, event: unknown) => ws.send(JSON.stringify({ t: 'run.event', runId, event }))
  const done = (runId: string, o: Record<string, unknown> = {}) =>
    ws.send(
      JSON.stringify({
        t: 'run.done',
        runId,
        outcome: 'completed',
        reply: '好了',
        filesChanged: 1,
        usage: null,
        sessionId: 'sess-42',
        newSessionReason: 'first',
        error: null,
        git: null,
        patch: null,
        appendsApplied: 0,
        ...o,
      }),
    )
  const ended = (runId: string) =>
    expect
      .poll(() => seen.some((e) => e.t === 'run.updated' && e.run.id === runId && e.run.endedAt))
      .toBe(true)
  const detail = async (runId: string, userId = bob.id) =>
    (
      await t.app.inject({ url: `/api/runs/${runId}`, headers: { cookie: await t.seed.cookie(userId) } })
    ).json<RunDetailDto>()
  return { alice, bob, bot, group, mention, send, done, ended, detail, seen, box }
}

describe('run process', () => {
  it('redacts events, the patch and the reply before persisting, merging streamed text; seals the process', async () => {
    const w = await world()
    const runId = await w.mention()
    w.send(runId, { kind: 'status', status: 'running', step: 'git fetch 完成，当前分支 main' })
    w.send(runId, { kind: 'thought', delta: '先看看' })
    w.send(runId, { kind: 'thought', delta: '配置' })
    w.send(runId, { kind: 'text', delta: `token ${GH.slice(0, 12)}` })
    w.send(runId, { kind: 'text', delta: `${GH.slice(12)} 已读取` })
    const tool = { kind: 'tool', toolCallId: 'c1', title: `echo ${GH}`, toolKind: 'execute' }
    w.send(runId, { ...tool, status: 'in_progress', detail: `$ echo ${GH}` })
    w.send(runId, { ...tool, status: 'completed', detail: `$ echo ${GH}\n${GH}` })
    w.send(runId, { kind: 'status', status: 'running', step: 'mysql password=hunter2' })
    const patch = 'diff --git a/.env b/.env\n+AWS_KEY=AKIAIOSFODNN7EXAMPLE\n'
    w.done(runId, { reply: `输出：${GH}`, patch })
    await w.ended(runId)

    const rows = await t.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
    const raw = JSON.stringify(rows)
    expect(raw).not.toContain('ghp_')
    expect(raw).not.toContain('hunter2')
    // Free text is encrypted at rest; kind, status, tool titles and steps stay plain for search.
    expect(raw).not.toContain('先看看')
    expect(raw).not.toContain('已读取')
    expect(raw).not.toContain('$ echo')
    expect(rows.map((r) => openEvent(r.payload as RunEvent))).toEqual([
      { kind: 'status', status: 'running', step: 'git fetch 完成，当前分支 main' },
      { kind: 'thought', delta: '先看看配置' },
      { kind: 'text', delta: `token ${MASK} 已读取` },
      { ...tool, title: `echo ${MASK}`, status: 'in_progress', detail: `$ echo ${MASK}` },
      { ...tool, title: `echo ${MASK}`, status: 'completed', detail: `$ echo ${MASK}\n${MASK}` },
      { kind: 'status', status: 'running', step: `mysql password=${MASK}` },
    ])
    const [run] = await t.db.select().from(runs).where(eq(runs.id, runId))
    expect(run!.patch).toMatch(/^v1:/)
    const plainPatch = `diff --git a/.env b/.env\n+AWS_KEY=${MASK}\n`
    expect(open(run!.patch!)).toBe(plainPatch)
    const [reply] = await t.db.select().from(messages).where(eq(messages.runId, runId))
    expect(reply!.body).toBe(`输出：${MASK}`)
    // The card step never carries the raw token either.
    expect(JSON.stringify(w.seen.filter((e) => e.t === 'run.updated'))).not.toContain('ghp_')

    const d = await w.detail(runId)
    expect(d).toMatchObject({ patch: plainPatch, purged: false, sessionId: 'sess-42', retentionDays: 30 })
    expect(d.events.map((e) => e.event)).toEqual(rows.map((r) => openEvent(r.payload as RunEvent)))
  })

  it('keeps subagent streams apart, seals their free text and records background tasks after run.done', async () => {
    const w = await world()
    const runId = await w.mention()
    const sub = { kind: 'subagent', agentId: 'a1', name: 'Explore', task: '找调用方' }
    w.send(runId, { ...sub, state: 'running' })
    w.send(runId, { kind: 'text', delta: '子', agentId: 'a1' })
    w.send(runId, { kind: 'text', delta: '报告', agentId: 'a1' })
    w.send(runId, { kind: 'text', delta: '主回复' })
    const task = { kind: 'task', taskId: 'bg1', agentId: 'a1', name: 'pnpm dev', taskType: 'shell' }
    w.send(runId, { ...task, state: 'running' })
    const card = () => w.seen.filter((e) => e.t === 'run.updated').at(-1)
    await expect
      .poll(() => card()?.t === 'run.updated' && card()!.run.delegation)
      .toEqual({ subagents: 1, subagentsRunning: 1, tasksRunning: 1 })
    w.send(runId, { ...sub, state: 'completed' })
    w.done(runId)
    await w.ended(runId)
    const updates = w.seen.filter((e) => e.t === 'run.updated').length
    w.send(runId, { ...task, state: 'completed', summary: 'exit 0' })
    await expect.poll(() => w.seen.filter((e) => e.t === 'run.updated').length).toBe(updates + 1)

    expect(w.seen.filter((e) => e.t === 'run.delta').map((e) => e.t === 'run.delta' && e.text)).toEqual([
      '主回复',
    ])
    expect((await w.detail(runId)).run.delegation).toEqual({
      subagents: 1,
      subagentsRunning: 0,
      tasksRunning: 0,
    })
    const rows = await t.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
    const raw = JSON.stringify(rows)
    expect(raw).not.toContain('找调用方')
    expect(raw).not.toContain('exit 0')
    expect((await w.detail(runId)).events.map((e) => e.event)).toEqual([
      { ...sub, state: 'running' },
      { kind: 'text', delta: '子报告', agentId: 'a1' },
      { kind: 'text', delta: '主回复' },
      { ...task, state: 'running' },
      { ...sub, state: 'completed' },
      { ...task, state: 'completed', summary: 'exit 0' },
    ])
  })

  it('lets group members stop a background task through its machine', async () => {
    const w = await world()
    const runId = await w.mention()
    const stop = async (userId: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/runs/${runId}/tasks/bg1/stop`,
        headers: { cookie: await t.seed.cookie(userId) },
      })
    expect((await stop(w.bob.id)).json()).toEqual({ sent: true })
    expect(await w.box.next()).toEqual({ t: 'task.stop', runId, taskId: 'bg1' })
    const outsider = await t.seed.user({ name: '外人' })
    expect((await stop(outsider.id)).statusCode).toBe(404)
  })

  it('serves approvals and the group hop limit on detail, timeline and realtime cards', async () => {
    const w = await world()
    await t.db
      .update(groups)
      .set({ params: { chainMaxHops: 5 } })
      .where(eq(groups.id, w.group.id))
    const runId = await w.mention()
    const at = new Date('2026-09-23T02:21:00Z')
    await t.db.insert(approvals).values([
      {
        runId,
        requestId: 'q1',
        title: 'Bash',
        toolKind: 'execute',
        detail: 'echo hello-approval',
        options: [{ optionId: 'ok', name: '允许', kind: 'allow_once' }],
        status: 'approved',
        voidReason: null,
        decidedBy: w.alice.id,
        decidedAt: at,
        expiresAt: at,
        createdAt: at,
      },
      {
        runId,
        requestId: 'q2',
        title: 'Bash',
        toolKind: 'execute',
        detail: 'rm -rf build',
        options: [],
        status: 'pending',
        expiresAt: at,
        createdAt: new Date(at.getTime() + 1000),
      },
    ])
    w.send(runId, { kind: 'tool', toolCallId: 'c1', title: 'Read a', toolKind: 'read', status: 'completed' })
    await expect
      .poll(() => w.seen.find((e) => e.t === 'run.updated' && e.run.step === 'Read a'))
      .toMatchObject({
        run: { hopMax: 5, approvals: [{ detail: 'echo hello-approval' }, { status: 'pending' }] },
      })

    const d = await w.detail(runId)
    expect(d.run.hopMax).toBe(5)
    expect(d.run.offlineWaitMin).toBe(30)
    expect(d.run.approvals).toEqual([
      {
        id: expect.any(String),
        runId,
        title: 'Bash',
        toolKind: 'execute',
        detail: 'echo hello-approval',
        options: [{ optionId: 'ok', name: '允许', kind: 'allow_once' }],
        status: 'approved',
        voidReason: null,
        decidedBy: w.alice.id,
        decidedByName: '王磊',
        decidedAt: at.toISOString(),
        expiresAt: at.toISOString(),
        createdAt: at.toISOString(),
      },
      expect.objectContaining({ detail: 'rm -rf build', status: 'pending', decidedByName: null }),
    ])
    expect(d.sessionId).toBeNull()

    const tl = (
      await t.app.inject({
        url: `/api/groups/${w.group.id}/timeline`,
        headers: { cookie: await t.seed.cookie(w.bob.id) },
      })
    ).json<TimelineDto>()
    expect(tl.runs[0]).toMatchObject({
      id: runId,
      hopMax: 5,
      approvals: [{ status: 'approved' }, { status: 'pending' }],
    })
    await t.db.update(groupBots).set({ sessionId: 's-9' }).where(eq(groupBots.groupId, w.group.id))
    expect((await w.detail(runId)).sessionId).toBe('s-9')
  })
})
