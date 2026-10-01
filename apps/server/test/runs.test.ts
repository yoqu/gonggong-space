import { PROTOCOL_VERSION, type RunStart, type WebEvent } from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, messages, runEvents, runs, systemParams } from '../src/db/schema.js'
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
  return { send: (m: unknown) => ws.send(JSON.stringify(m)), next: () => box.next<RunStart>(), ws }
}

/** Collects WebEvents published to one user; `until` resolves with the first match (past or future). */
function watch(userId: string) {
  const seen: WebEvent[] = []
  const waiters: { pred: (e: WebEvent) => boolean; resolve: (e: WebEvent) => void }[] = []
  t.ctx.bus.attach(userId, (e) => {
    seen.push(e)
    for (const w of [...waiters])
      if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(e)
      }
  })
  return {
    seen,
    until: <E extends WebEvent>(pred: (e: WebEvent) => boolean) =>
      new Promise<E>((resolve) => {
        const hit = seen.find(pred)
        if (hit) return resolve(hit as E)
        waiters.push({ pred, resolve: resolve as (e: WebEvent) => void })
      }),
  }
}

const runUpdated =
  (status: string, runId?: string) =>
  (e: WebEvent): boolean =>
    e.t === 'run.updated' && e.run.status === status && (!runId || e.run.id === runId)

async function world(o: { concurrency?: number; binding?: string } = {}) {
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const { machine, token } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({
    ownerId: alice.id,
    name: '小王的 Claude',
    machineId: machine.id,
    systemPrompt: '只改 server/',
    concurrency: o.concurrency ?? 2,
    binding: o.binding ?? 'bound',
  })
  const other = await t.seed.bot({ ownerId: bob.id, name: '陈晨的 Codex', agentKind: 'codex' })
  const group = await t.seed.group({ createdBy: alice.id, memberIds: [bob.id], botIds: [bot.id, other.id] })
  const say = async (
    body: string,
    author: { userId?: string; botId?: string },
    mentions: string[] = [],
    groupId = group.id,
  ) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId,
        kind: author.botId ? 'bot' : 'user',
        authorUserId: author.userId ?? null,
        authorBotId: author.botId ?? null,
        body,
        meta: { mentions },
      })
      .returning()
    return m!
  }
  /** `inGroup` → mention from another group the bot is in (to exercise bot-level concurrency). */
  const mention = async (body: string, inGroup = group.id) => {
    const m = await say(body, { userId: alice.id }, [bot.id], inGroup)
    await triggerRuns(t.ctx, m)
    return m
  }
  const anotherGroup = async () => (await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })).id
  const runsOf = () => t.db.select().from(runs).where(eq(runs.botId, bot.id)).orderBy(asc(runs.queuedAt))
  return { alice, bob, machine, token, bot, other, group, say, mention, anotherGroup, runsOf }
}

const done = (runId: string, o: Record<string, unknown> = {}) => ({
  t: 'run.done',
  runId,
  outcome: 'completed',
  reply: '已完成',
  filesChanged: 1,
  usage: { totalTokens: 1500 },
  sessionId: 'sess-1',
  newSessionReason: 'first',
  error: null,
  git: null,
  patch: null,
  appendsApplied: 0,
  ...o,
})

describe('run engine', () => {
  it('dispatches a mention with context since the last @ and fallback context when resuming', async () => {
    const w = await world()
    const web = watch(w.bob.id)
    const d = await daemon(w.token)
    const early = await w.say('早', { userId: w.alice.id })
    await t.db
      .update(groupBots)
      .set({ contextSeq: early.seq, sessionId: 'sess-0' })
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    await w.say('退款 v1 下周一下线', { userId: w.bob.id })
    await w.say('我上次的回复', { botId: w.bot.id })
    await w.say('接口已改好', { botId: w.other.id })
    const trigger = await w.mention('@小王的 Claude 写个脚本')

    const start = await d.next()
    expect(start).toMatchObject({
      t: 'run.start',
      groupId: w.group.id,
      bot: {
        id: w.bot.id,
        name: '小王的 Claude',
        agentKind: 'claude',
        systemPrompt: '只改 server/',
        tier: 'workspace',
      },
      workspace: { repo: null, cdPath: null },
      resumeSessionId: 'sess-0',
      prompt: { text: '@小王的 Claude 写个脚本', triggeredBy: '王磊' },
    })
    expect(start.prompt.context.map((c) => [c.author, c.kind, c.body])).toEqual([
      ['陈晨', 'user', '退款 v1 下周一下线'],
      ['陈晨的 Codex', 'bot', '接口已改好'],
    ])
    expect(start.prompt.fallbackContext.map((c) => c.body)).toEqual([
      '早',
      '退款 v1 下周一下线',
      '我上次的回复',
      '接口已改好',
    ])

    const [run] = await w.runsOf()
    expect(run).toMatchObject({ id: start.runId, status: 'running', originUserId: w.alice.id, hop: 1 })
    expect(run?.startedAt).toBeInstanceOf(Date)
    const [gb] = await t.db.select().from(groupBots).where(eq(groupBots.botId, w.bot.id))
    expect(gb?.contextSeq).toBe(trigger.seq)
    await web.until(runUpdated('running', start.runId))
  })

  it('sends no fallback context without a session to resume', async () => {
    const w = await world()
    const d = await daemon(w.token)
    await w.say('早', { userId: w.alice.id })
    await w.mention('@小王的 Claude hi')
    const start = await d.next()
    expect(start.resumeSessionId).toBeNull()
    expect(start.prompt.context.map((c) => c.body)).toEqual(['早'])
    expect(start.prompt.fallbackContext).toEqual([])
    expect(start.prompt.omitted).toBe(0)
  })

  it('inlines only the latest contextInlineMax messages and counts the rest for the gonggong tools', async () => {
    const w = await world()
    const d = await daemon(w.token)
    await t.db.insert(systemParams).values({ key: 'contextInlineMax', value: 2 })
    await t.db.update(groupBots).set({ sessionId: 'sess-0' }).where(eq(groupBots.botId, w.bot.id))
    for (const body of ['一', '二', '三', '四']) await w.say(body, { userId: w.bob.id })
    const trigger = await w.mention('@小王的 Claude hi')
    const start = await d.next()
    expect(start.prompt.context.map((c) => c.body)).toEqual(['三', '四'])
    expect(start.prompt.omitted).toBe(2)
    expect(start.prompt.fallbackContext.map((c) => c.body)).toEqual(['三', '四'])
    const [gb] = await t.db.select().from(groupBots).where(eq(groupBots.botId, w.bot.id))
    expect(gb?.contextSeq).toBe(trigger.seq)
  })

  it('waits while the machine is offline and dispatches when it connects', async () => {
    const w = await world()
    const web = watch(w.alice.id)
    await w.mention('@小王的 Claude hi')
    const waiting = await web.until<Extract<WebEvent, { t: 'run.updated' }>>(runUpdated('offline_wait'))
    expect(waiting.run.step).toBe('Bot 离线，等待上线')
    expect(waiting.run.stepI18n).toEqual({ key: 'Bot 离线，等待上线' })

    const d = await daemon(w.token)
    const start = await d.next()
    expect(start.runId).toBe(waiting.run.id)
    await web.until(runUpdated('running', start.runId))
  })

  it('queues beyond the bot concurrency and dequeues in order', async () => {
    const w = await world({ concurrency: 1 })
    const web = watch(w.alice.id)
    const d = await daemon(w.token)
    await w.mention('one')
    await w.mention('two', await w.anotherGroup())
    await w.mention('three', await w.anotherGroup())
    const first = await d.next()
    expect(first.prompt.text).toBe('one')
    const [, r2, r3] = await w.runsOf()
    expect(r2).toMatchObject({ status: 'queued', step: '该 Bot 忙，排第 1' })
    expect(r3).toMatchObject({ status: 'queued', step: '该 Bot 忙，排第 2' })

    d.send(done(first.runId))
    const second = await d.next()
    expect(second.prompt.text).toBe('two')
    await web.until((e) => e.t === 'run.updated' && e.run.id === r3?.id && e.run.step === '该 Bot 忙，排第 1')
  })

  it('runs at most one turn per (group, bot) even with free concurrency slots', async () => {
    const w = await world({ concurrency: 2 })
    const d = await daemon(w.token)
    await w.mention('one')
    await w.mention('two')
    const first = await d.next()
    const [, r2] = await w.runsOf()
    expect(r2).toMatchObject({ status: 'queued', step: '本群上一轮未结束，排第 1' })
    d.send(done(first.runId))
    const second = await d.next()
    expect(second.prompt.text).toBe('two')
    expect(second.resumeSessionId).toBe('sess-1')
  })

  it('persists run events and the final reply, and publishes them', async () => {
    const w = await world()
    const web = watch(w.bob.id)
    const d = await daemon(w.token)
    await w.mention('@小王的 Claude 写个文件')
    const { runId } = await d.next()
    d.send({ t: 'run.event', runId, event: { kind: 'text', delta: '好的' } })
    d.send({ t: 'run.event', runId, event: { kind: 'thought', delta: '想一想' } })
    d.send({
      t: 'run.event',
      runId,
      event: {
        kind: 'tool',
        toolCallId: 'c1',
        title: 'Write hello.txt',
        toolKind: 'edit',
        status: 'in_progress',
      },
    })
    d.send({ t: 'run.event', runId, event: { kind: 'usage', usage: { totalTokens: 900 } } })
    d.send(done(runId, { reply: '已完成。' }))

    const delta = await web.until((e) => e.t === 'run.delta')
    expect(delta).toEqual({ t: 'run.delta', runId, text: '好的' })
    await web.until((e) => e.t === 'run.updated' && e.run.step === 'Write hello.txt')
    const msg = await web.until<Extract<WebEvent, { t: 'message.new' }>>((e) => e.t === 'message.new')
    expect(msg.message).toMatchObject({
      kind: 'bot',
      authorId: w.bot.id,
      authorName: '小王的 Claude',
      body: '已完成。',
      runId,
    })
    const final = await web.until<Extract<WebEvent, { t: 'run.updated' }>>(runUpdated('completed', runId))
    expect(final.run).toMatchObject({
      filesChanged: 1,
      usage: { totalTokens: 1500 },
      newSessionReason: 'first',
    })
    expect(final.run.endedAt).not.toBeNull()

    const events = await t.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
    expect(events.map((e) => e.kind)).toEqual(['text', 'thought', 'tool', 'usage'])
    const [gb] = await t.db.select().from(groupBots).where(eq(groupBots.botId, w.bot.id))
    expect(gb?.sessionId).toBe('sess-1')
  })

  it('stores and publishes the workspace git status reported with run.done', async () => {
    const w = await world()
    // Provisioned already, so connecting publishes no workspace state of its own.
    await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, w.group.id))
    const web = watch(w.bob.id)
    const d = await daemon(w.token)
    await w.mention('hi')
    const first = await d.next()
    d.send(done(first.runId))
    await web.until(runUpdated('completed', first.runId))
    expect(web.seen.some((e) => e.t === 'group.botState')).toBe(false)

    await w.mention('again')
    const { runId } = await d.next()
    const git = { branch: 'feat/x', ahead: 1, behind: 0, dirty: true, workspace: 'managed' as const }
    d.send(done(runId, { git }))
    const pushed = await web.until<Extract<WebEvent, { t: 'group.botState' }>>(
      (e) => e.t === 'group.botState',
    )
    expect(pushed).toEqual({
      t: 'group.botState',
      groupId: w.group.id,
      state: {
        botId: w.bot.id,
        workspace: 'managed',
        state: 'ready',
        path: null,
        git,
        error: null,
        reason: null,
        tier: null,
        model: null,
        effort: null,
        context: null,
      },
    })
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    expect(gb?.gitStatus).toEqual(git)
  })

  it('stores and publishes the context occupancy reported by usage events', async () => {
    const w = await world()
    const web = watch(w.bob.id)
    const d = await daemon(w.token)
    await w.mention('hi')
    const { runId } = await d.next()
    const context = { used: 124000, size: 200000 }
    d.send({ t: 'run.event', runId, event: { kind: 'usage', usage: { totalTokens: 124000 }, context } })
    const pushed = await web.until<Extract<WebEvent, { t: 'group.botState' }>>(
      (e) => e.t === 'group.botState' && e.state.context !== null,
    )
    expect(pushed.state).toMatchObject({ botId: w.bot.id, context })
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    expect(gb?.contextUsage).toEqual(context)
  })

  it('marks a failed agent run as interrupted with the error', async () => {
    const w = await world()
    const web = watch(w.alice.id)
    const d = await daemon(w.token)
    await w.mention('hi')
    const { runId } = await d.next()
    d.send(
      done(runId, { outcome: 'failed', reply: '', error: 'adapter exited', usage: null, sessionId: null }),
    )
    const final = await web.until<Extract<WebEvent, { t: 'run.updated' }>>(runUpdated('interrupted', runId))
    expect(final.run.step).toBe('agent 异常：adapter exited')
    const replies = await t.db.select().from(messages).where(eq(messages.runId, runId))
    expect(replies).toEqual([])
  })

  it('ignores a duplicate run.done and reports from other machines', async () => {
    const w = await world()
    const web = watch(w.alice.id)
    const d = await daemon(w.token)
    const stranger = await t.seed.machine(w.bob.id)
    const s = await daemon(stranger.token)
    await w.mention('hi')
    const { runId } = await d.next()
    s.send(done(runId, { reply: '冒充' }))
    d.send(done(runId))
    d.send(done(runId, { reply: '重复' }))
    await web.until(runUpdated('completed', runId))
    // A later run proves the queue behind the duplicate has drained.
    await w.mention('again')
    const next = await d.next()
    d.send(done(next.runId))
    await web.until(runUpdated('completed', next.runId))
    const replies = await t.db.select().from(messages).where(eq(messages.runId, runId))
    expect(replies.map((m) => m.body)).toEqual(['已完成'])
  })

  it('forbids unbound bots and ignores bots outside the group', async () => {
    const w = await world({ binding: 'pending_confirm' })
    const web = watch(w.alice.id)
    const stray = await t.seed.bot({ ownerId: w.alice.id, machineId: w.machine.id })
    const m = await w.say('@x', { userId: w.alice.id }, [w.bot.id, stray.id])
    await triggerRuns(t.ctx, m)
    const all = await t.db.select().from(runs)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      botId: w.bot.id,
      status: 'forbidden',
      step: 'Bot 未绑定或未确认，不能被触发',
    })
    await web.until(runUpdated('forbidden'))
  })

  it('serves run detail with events to group members only', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const web = watch(w.alice.id)
    await w.mention('hi')
    const { runId } = await d.next()
    d.send({ t: 'run.event', runId, event: { kind: 'text', delta: '好' } })
    d.send(done(runId))
    await web.until(runUpdated('completed', runId))

    const res = await t.app.inject({
      url: `/api/runs/${runId}`,
      headers: { cookie: await t.seed.cookie(w.bob.id) },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.run).toMatchObject({ id: runId, status: 'completed', triggerUserId: w.alice.id })
    expect(body.events).toMatchObject([{ event: { kind: 'text', delta: '好' } }])

    const outsider = await t.seed.user()
    const denied = await t.app.inject({
      url: `/api/runs/${runId}`,
      headers: { cookie: await t.seed.cookie(outsider.id) },
    })
    expect(denied.statusCode).toBe(404)
  })
})
