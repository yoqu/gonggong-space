import {
  PROTOCOL_VERSION,
  type RunDetailDto,
  type RunEvent,
  type RunSessionDto,
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
  const mention = async (body = '@bot go') => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: alice.id,
        body,
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
  const session = async (runId: string, userId = bob.id) =>
    t.app.inject({ url: `/api/runs/${runId}/session`, headers: { cookie: await t.seed.cookie(userId) } })
  return { alice, bob, bot, group, mention, send, done, ended, detail, session, seen, box }
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

  it('persists long streamed text in bounded segments without splitting secrets, served as one event', async () => {
    const w = await world()
    const runId = await w.mention()
    const filler = `${'x'.repeat(99)}\n`.repeat(100)
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n'
    const chunks = [
      filler,
      `token ${GH.slice(0, 12)}`,
      `${GH.slice(12)}\n`,
      filler,
      pem.slice(0, 40),
      pem.slice(40),
    ]
    for (let i = 0; i < 40; i++) chunks.push(filler)
    for (const delta of chunks) w.send(runId, { kind: 'text', delta })
    w.done(runId)
    await w.ended(runId)

    const rows = await t.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
    const texts = rows.map((r) => (openEvent(r.payload as RunEvent) as { delta: string }).delta)
    expect(texts.length).toBeGreaterThan(1)
    for (const s of texts) expect(s.length).toBeLessThanOrEqual(32 * 1024)
    expect(texts.join('')).not.toContain('ghp_')
    expect(texts.join('')).not.toContain('MIIEpAIBAAKCAQEA')

    const full = chunks.join('').replace(GH, MASK).replace(pem.slice(0, -1), MASK)
    expect((await w.detail(runId)).events.map((e) => e.event)).toEqual([{ kind: 'text', delta: full }])
  })

  describe('live stream redaction', () => {
    const SK = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
    const pushed = (w: Awaited<ReturnType<typeof world>>, runId: string) =>
      w.seen
        .filter((e) => e.t === 'run.delta' && e.runId === runId)
        .map((e) => (e.t === 'run.delta' ? e.text : ''))
        .join('')
    const stored = async (runId: string) => {
      const rows = await t.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, runId))
        .orderBy(asc(runEvents.id))
      return rows.map((r) => (openEvent(r.payload as RunEvent) as { delta: string }).delta).join('')
    }

    it('never pushes a secret split across two chunks, and matches what is stored', async () => {
      const w = await world()
      const runId = await w.mention()
      w.send(runId, { kind: 'text', delta: `key ${SK.slice(0, 10)}` })
      w.send(runId, { kind: 'text', delta: `${SK.slice(10)} ok` })
      w.done(runId)
      await w.ended(runId)

      expect(pushed(w, runId)).toBe(`key ${MASK} ok`)
      expect(await stored(runId)).toBe(`key ${MASK} ok`)
    })

    it('holds back every chunk of a secret split many ways, labels and quotes included', async () => {
      const w = await world()
      const runId = await w.mention()
      const chunks = [
        `token ${SK.slice(0, 7)}`,
        SK.slice(7, 20),
        SK.slice(20, 33),
        `${SK.slice(33)}\n`,
        'Authorization: Bearer ',
        'abcdefghij',
        'klmnopqrstuvwxyz\n',
        'password="hun',
        'ter 2 x"\n',
        '-----BEGIN RSA PRIV',
        'ATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n',
        'done',
      ]
      for (const delta of chunks) w.send(runId, { kind: 'text', delta })
      w.done(runId)
      await w.ended(runId)

      const out = pushed(w, runId)
      for (const secret of ['sk-ant', 'abcdefghij', 'hunter', 'hun', 'MIIE', 'PRIV'])
        expect(out).not.toContain(secret)
      expect(out).toBe(await stored(runId))
      expect(out).toContain(MASK)
    })

    it('keeps secrets split across an 8KB segment rollover out of the live stream', async () => {
      const w = await world()
      const runId = await w.mention()
      const filler = `${'x'.repeat(99)}\n`.repeat(100)
      const chunks = [
        filler,
        `token ${SK.slice(0, 12)}`,
        SK.slice(12, 30),
        `${SK.slice(30)}\n`,
        filler,
        'end',
      ]
      for (const delta of chunks) w.send(runId, { kind: 'text', delta })
      w.done(runId)
      await w.ended(runId)

      const out = pushed(w, runId)
      expect(out).not.toContain('sk-ant')
      expect(out).toBe(await stored(runId))
      expect(out).toBe(chunks.join('').replace(SK, MASK))
    })

    it('streams ordinary text unchanged, without waiting for CJK text to end', async () => {
      const w = await world()
      const runId = await w.mention()
      w.send(runId, { kind: 'text', delta: 'Hello wor' })
      w.send(runId, { kind: 'text', delta: 'ld 你好，世界' })
      await expect.poll(() => pushed(w, runId)).toBe('Hello world 你好，世界')
      w.send(runId, { kind: 'text', delta: ' tail' })
      w.done(runId)
      await w.ended(runId)

      expect(pushed(w, runId)).toBe('Hello world 你好，世界 tail')
      expect(await stored(runId)).toBe('Hello world 你好，世界 tail')
    })

    it('flushes the held token when the stream is closed by another event', async () => {
      const w = await world()
      const runId = await w.mention()
      w.send(runId, { kind: 'text', delta: 'reading file' })
      w.send(runId, { kind: 'tool', toolCallId: 'c1', title: 'ls', toolKind: 'execute', status: 'completed' })
      await expect.poll(() => pushed(w, runId)).toBe('reading file')
      w.send(runId, { kind: 'text', delta: 'more' })
      w.send(runId, { kind: 'thought', delta: 'hm' })
      await expect.poll(() => pushed(w, runId)).toBe('reading filemore')
    })
  })

  it('serves the process from a known event on, that event included since streamed text may have grown', async () => {
    const w = await world()
    const runId = await w.mention()
    const status = { kind: 'status', status: 'running', step: '读取' }
    w.send(runId, status)
    w.send(runId, { kind: 'text', delta: '第一' })
    const tool = { kind: 'tool', toolCallId: 'c1', title: 'ls', toolKind: 'execute', status: 'completed' }
    await expect.poll(async () => (await w.detail(runId)).events.length).toBe(2)
    const [, text] = (await w.detail(runId)).events
    w.send(runId, { kind: 'text', delta: '段' })
    w.send(runId, tool)
    await expect.poll(async () => (await w.detail(runId)).events.length).toBe(3)

    const res = await t.app.inject({
      url: `/api/runs/${runId}?since=${text!.id}`,
      headers: { cookie: await t.seed.cookie(w.bob.id) },
    })
    expect(res.json<RunDetailDto>().events.map((e) => e.event)).toEqual([
      { kind: 'text', delta: '第一段' },
      tool,
    ])
  })

  it('redacts and seals MCP call arguments and results; server and tool stay plain', async () => {
    const w = await world()
    const runId = await w.mention()
    const call = {
      kind: 'tool',
      toolCallId: 'm1',
      title: 'mcp__gonggong__search_messages',
      toolKind: 'other',
    }
    const mcp = { server: 'gonggong', tool: 'search_messages' }
    w.send(runId, { ...call, status: 'pending', mcp: { ...mcp, input: `{"query":"${GH}"}` } })
    w.send(runId, {
      ...call,
      status: 'completed',
      mcp: { ...mcp, input: '{"query":"退款"}', output: '#3 王磊: 私密群聊' },
    })
    w.done(runId, { reply: '好' })
    await w.ended(runId)

    const rows = await t.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
    const raw = JSON.stringify(rows)
    expect(raw).not.toContain('ghp_')
    expect(raw).not.toContain('私密群聊')
    expect(raw).not.toContain('退款')
    expect(raw).toContain('search_messages')
    expect(rows.map((r) => openEvent(r.payload as RunEvent))).toEqual([
      { ...call, status: 'pending', mcp: { ...mcp, input: `{"query":"${MASK}"}` } },
      {
        ...call,
        status: 'completed',
        mcp: { ...mcp, input: '{"query":"退款"}', output: '#3 王磊: 私密群聊' },
      },
    ])
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

  it('pushes the card only when it changed; other process events only say the process moved', async () => {
    const w = await world()
    const runId = await w.mention()
    const tool = { kind: 'tool', toolCallId: 'c1', title: 'ls', toolKind: 'execute' }
    const before = w.seen.length
    w.send(runId, { ...tool, status: 'pending' })
    w.send(runId, { ...tool, status: 'in_progress' })
    w.send(runId, { ...tool, status: 'completed' })
    const seen = () => w.seen.slice(before).filter((e) => e.t === 'run.updated' || e.t === 'run.progress')
    await expect.poll(() => seen().length).toBe(3)
    expect(seen()).toEqual([
      expect.objectContaining({ t: 'run.updated', run: expect.objectContaining({ id: runId, step: 'ls' }) }),
      { t: 'run.progress', runId, groupId: w.group.id, botId: w.bot.id },
      { t: 'run.progress', runId, groupId: w.group.id, botId: w.bot.id },
    ])
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

  it("lists the earlier rounds of the run's agent session, oldest first, cut at the last new session", async () => {
    const w = await world()
    const rounds = async (runId: string) =>
      (await w.session(runId)).json<RunSessionDto>().rounds.map((r) => [r.run.id, r.prompt])
    const turn = async (body: string, o: Record<string, unknown> = { newSessionReason: null }) => {
      const runId = await w.mention(body)
      w.done(runId, o)
      await w.ended(runId)
      return runId
    }
    const r1 = await turn('@bot 第一轮', { newSessionReason: 'first' })
    const r2 = await turn('@bot 第二轮')
    const r3 = await w.mention('@bot 第三轮')
    expect(await rounds(r3)).toEqual([
      [r1, '@bot 第一轮'],
      [r2, '@bot 第二轮'],
    ])
    expect(await rounds(r2)).toEqual([[r1, '@bot 第一轮']])
    expect(await rounds(r1)).toEqual([])
    w.done(r3, { newSessionReason: null })
    await w.ended(r3)

    // /new: the fresh session is known at dispatch, so its live round already stands alone.
    await t.db.update(groupBots).set({ sessionId: null, newSessionReason: 'requested' })
    const r4 = await w.mention('@bot 新会话')
    expect(await rounds(r4)).toEqual([])
    w.done(r4, { newSessionReason: null })
    await w.ended(r4)
    expect((await w.detail(r4)).run.newSessionReason).toBe('requested')
    const r5 = await turn('@bot 接着')
    expect(await rounds(r5)).toEqual([[r4, '@bot 新会话']])

    const outsider = await t.seed.user({ name: '外人' })
    expect((await w.session(r5, outsider.id)).statusCode).toBe(404)
  })
})
