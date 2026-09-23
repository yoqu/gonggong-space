import type { MessageDto, RunStart, ServerToDaemon } from '@aiws/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  approvals,
  auditLogs,
  groupBots,
  groupRepos,
  groups,
  messages,
  notifications,
  runs,
} from '../src/db/schema.js'
import { expireOfflineRuns, isChainStopped } from '../src/modules/runs/stop.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
let clock: Date
beforeEach(async () => {
  clock = new Date('2026-09-23T10:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

const minutes = (n: number) => {
  clock = new Date(clock.getTime() + n * 60_000)
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 200; i++) {
    const v = await read()
    if (ok(v)) return v
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('condition not met')
}

type Answer = (msg: ServerToDaemon) => unknown

async function world(o: { online?: boolean } = {}) {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const outsider = await t.seed.user({ name: '路人' })
  const { machine } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex', machineId: machine.id })
  const g = await t.seed.group({
    createdBy: wang.id,
    memberIds: [li.id, zhao.id],
    botIds: [claude.id, codex.id],
  })
  await t.db.insert(groupRepos).values({ groupId: g.id, url: 'git@example.com:team/pay.git', baseBranch: 'main' })
  await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, g.id))
  const sent: ServerToDaemon[] = []
  let answer: Answer = () => undefined
  const conn = {
    send: (m: ServerToDaemon) => {
      sent.push(m)
      const reply = answer(m)
      if (reply) setImmediate(() => t.ctx.hub.emit('message', machine.id, reply as never))
    },
    close() {},
  }
  const online = () => t.ctx.hub.register(machine.id, conn)
  const offline = () => t.ctx.hub.unregister(machine.id, conn)
  if (o.online !== false) online()
  const as = {
    wang: client(t, await t.seed.cookie(wang.id)),
    li: client(t, await t.seed.cookie(li.id)),
    zhao: client(t, await t.seed.cookie(zhao.id)),
    outsider: client(t, await t.seed.cookie(outsider.id)),
  }
  let n = 0
  const say = async (c: typeof as.wang, body: string) => {
    const res = await c.post<MessageDto>(`/api/groups/${g.id}/messages`, { body, clientId: `stop-msg-${++n}` })
    clock = new Date(clock.getTime() + 1000)
    return res
  }
  const events = async () =>
    (
      await t.db
        .select({ body: messages.body })
        .from(messages)
        .where(and(eq(messages.groupId, g.id), eq(messages.kind, 'event')))
        .orderBy(asc(messages.seq))
    ).map((m) => m.body)
  const run = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
  const runsOf = (botId: string) =>
    t.db.select().from(runs).where(eq(runs.botId, botId)).orderBy(asc(runs.queuedAt))
  const done = (runId: string, extra: Record<string, unknown> = {}) =>
    t.ctx.hub.emit('message', machine.id, {
      t: 'run.done',
      runId,
      outcome: 'interrupted',
      reply: '',
      filesChanged: 2,
      usage: null,
      sessionId: 'sess-1',
      newSessionReason: null,
      error: null,
      git: { branch: 'main', ahead: 0, behind: 0, dirty: true, workspace: 'managed' },
      patch: null,
      ...extra,
    } as never)
  const starts = () => sent.filter((m): m is RunStart => m.t === 'run.start')
  return {
    wang,
    li,
    zhao,
    machine,
    claude,
    codex,
    g,
    sent,
    as,
    say,
    events,
    run,
    runsOf,
    done,
    starts,
    online,
    offline,
    onSend: (fn: Answer) => {
      answer = fn
    },
  }
}

type World = Awaited<ReturnType<typeof world>>

/** Inserts a relay hop below `parent` (what the chain module does when a bot @-s another bot). */
async function relay(w: World, parent: typeof runs.$inferSelect, botId: string, status = 'running') {
  const [m] = await t.db
    .insert(messages)
    .values({ groupId: w.g.id, kind: 'bot', authorBotId: parent.botId, body: '@接力', meta: { mentions: [botId] } })
    .returning()
  const [r] = await t.db
    .insert(runs)
    .values({
      groupId: w.g.id,
      botId,
      triggerMessageId: m!.id,
      originUserId: parent.originUserId,
      parentRunId: parent.id,
      hop: parent.hop + 1,
      status,
      startedAt: clock,
    })
    .returning()
  return r!
}

describe('/stop command', () => {
  it('@bot stops only that bot: queued → interrupted now, running → run.cancel, then pending interrupt', async () => {
    const w = await world()
    await w.say(w.as.li, '@小王的 Claude 改退款接口')
    await w.say(w.as.li, '@小王的 Claude 再补测试')
    await w.say(w.as.wang, '@老李的 Codex 看看')
    const [first, second] = await w.runsOf(w.claude.id)
    expect([first!.status, second!.status]).toEqual(['running', 'queued'])
    await t.db.insert(approvals).values({
      runId: first!.id,
      requestId: 'req-1',
      title: 'Bash',
      toolKind: 'execute',
      detail: 'go build',
      options: [],
      expiresAt: new Date(clock.getTime() + 60_000),
    })

    await w.say(w.as.zhao, '/stop @小王的 Claude')
    expect(await w.events()).toEqual(['赵敏 /stop · 停止 小王的 Claude 的 2 个轮次'])
    expect(w.sent.filter((m) => m.t === 'run.cancel')).toEqual([{ t: 'run.cancel', runId: first!.id }])
    expect(await w.run(second!.id)).toMatchObject({
      status: 'interrupted',
      stoppedBy: w.zhao.id,
      step: '赵敏 执行了 /stop',
    })
    expect(await w.run(first!.id)).toMatchObject({ status: 'running', stoppedBy: w.zhao.id })
    expect((await w.runsOf(w.codex.id))[0]!.status).toBe('running')
    const [approval] = await t.db.select().from(approvals)
    expect(approval!.status).toBe('void')
    expect(await t.db.select().from(auditLogs)).toEqual([
      expect.objectContaining({ actorUserId: w.zhao.id, action: 'command.stop', groupId: w.g.id }),
    ])

    w.done(first!.id)
    const stopped = await until(
      () => w.run(first!.id),
      (r) => r.status === 'interrupted',
    )
    expect(stopped).toMatchObject({
      interrupt: 'pending',
      step: '赵敏 执行了 /stop · 分区模式：已改的 2 个文件留在工作区，未提交',
    })
  })

  it('without @ stops every unfinished run of the group, chains included, and ends the chain', async () => {
    const w = await world()
    await w.say(w.as.li, '@小王的 Claude 开始')
    const [root] = await w.runsOf(w.claude.id)
    const hop2 = await relay(w, root!, w.codex.id)
    const other = await relay(w, { ...root!, id: root!.id }, w.codex.id, 'completed')
    expect(await isChainStopped(t.ctx, hop2)).toBe(false)

    await w.say(w.as.wang, '/stop')
    expect(await w.events()).toEqual(['王磊 /stop · 未 @ bot，停止本群全部 2 个轮次（含接力链，整条链终止）'])
    expect(w.sent.filter((m) => m.t === 'run.cancel').map((m) => (m as { runId: string }).runId).sort()).toEqual(
      [root!.id, hop2.id].sort(),
    )
    expect(await isChainStopped(t.ctx, hop2)).toBe(true)
    expect(await isChainStopped(t.ctx, other)).toBe(true)
    w.done(hop2.id, { filesChanged: 0, git: null })
    expect(
      await until(
        () => w.run(hop2.id),
        (r) => r.status === 'interrupted',
      ),
    ).toMatchObject({ step: '整条链已被 王磊 /stop 终止', interrupt: null })
  })

  it('stops offline-waiting runs at once and reports when nothing runs', async () => {
    const w = await world({ online: false })
    await w.say(w.as.li, '@小王的 Claude 改一下')
    const [r] = await w.runsOf(w.claude.id)
    expect(r!.status).toBe('offline_wait')
    await w.say(w.as.li, '/stop @老李的 Codex')
    await w.say(w.as.li, '/stop @小王的 Claude')
    await w.say(w.as.li, '/stop')
    expect(await w.events()).toEqual([
      '没有运行中的轮次',
      '李建国 /stop · 停止 小王的 Claude 的 1 个轮次',
      '没有运行中的轮次',
    ])
    expect(await w.run(r!.id)).toMatchObject({ status: 'interrupted', endedAt: expect.any(Date) })
  })

  it('a live run whose machine is gone is interrupted immediately', async () => {
    const w = await world()
    await w.say(w.as.li, '@小王的 Claude 改一下')
    const [r] = await w.runsOf(w.claude.id)
    w.offline()
    await w.say(w.as.li, '/stop')
    expect(await w.run(r!.id)).toMatchObject({ status: 'interrupted', step: '李建国 执行了 /stop' })
  })
})

describe('run stop endpoints', () => {
  it('any group member may stop a run or its whole chain; outsiders may not', async () => {
    const w = await world()
    await w.say(w.as.li, '@小王的 Claude 开始')
    const [root] = await w.runsOf(w.claude.id)
    const hop2 = await relay(w, root!, w.codex.id)
    expect((await w.as.outsider.post(`/api/runs/${root!.id}/stop`)).status).toBe(404)

    expect(await w.as.zhao.post(`/api/runs/${hop2.id}/stop-chain`)).toMatchObject({
      status: 200,
      body: { stopped: 2 },
    })
    expect((await w.run(root!.id)).stoppedBy).toBe(w.zhao.id)
    expect((await w.run(hop2.id)).stoppedBy).toBe(w.zhao.id)
    expect(await t.db.select({ action: auditLogs.action }).from(auditLogs)).toEqual([{ action: 'run.stop_chain' }])

    await w.say(w.as.li, '@老李的 Codex 另一件事')
    const single = (await w.runsOf(w.codex.id)).find((r) => r.hop === 1)
    expect(await w.as.zhao.post(`/api/runs/${single!.id}/stop`)).toMatchObject({ body: { stopped: 1 } })
    expect((await w.as.zhao.post(`/api/runs/${single!.id}/stop`)).body).toMatchObject({ stopped: 0 })
  })
})

describe('interrupt choice (keep / discard)', () => {
  async function pending(w: World) {
    await w.say(w.as.li, '@小王的 Claude 改退款接口')
    const [r] = await w.runsOf(w.claude.id)
    await w.say(w.as.zhao, '/stop @小王的 Claude')
    w.done(r!.id)
    return until(
      () => w.run(r!.id),
      (x) => x.interrupt === 'pending',
    )
  }

  it('only the trigger / origin user or the bot owner may choose; keep is final', async () => {
    const w = await world()
    const r = await pending(w)
    const url = `/api/runs/${r.id}/interrupt`
    expect((await w.as.zhao.post(url, { choice: 'keep' })).status).toBe(403)
    expect((await w.as.li.post(url, { choice: 'nope' })).status).toBe(400)
    expect((await w.as.li.post(url, { choice: 'keep' })).status).toBe(200)
    expect((await w.run(r.id)).interrupt).toBe('kept')
    expect((await w.as.wang.post(url, { choice: 'discard' })).status).toBe(409)
    expect(w.sent.some((m) => m.t === 'run.discard')).toBe(false)
  })

  it('discard asks the daemon and records the result; failures keep the choice open', async () => {
    const w = await world()
    const r = await pending(w)
    const url = `/api/runs/${r.id}/interrupt`
    w.onSend((m) =>
      m.t === 'run.discard' ? { t: 'run.discarded', runId: m.runId, ok: false, files: 0, error: '快照已失效' } : null,
    )
    expect(await w.as.wang.post(url, { choice: 'discard' })).toMatchObject({
      status: 409,
      body: { message: '丢弃本轮改动失败：快照已失效' },
    })
    expect((await w.run(r.id)).interrupt).toBe('pending')
    expect(await w.events()).toContain('丢弃本轮改动失败：快照已失效')

    w.onSend((m) =>
      m.t === 'run.discard' ? { t: 'run.discarded', runId: m.runId, ok: true, files: 2, error: null } : null,
    )
    expect((await w.as.wang.post(url, { choice: 'discard' })).status).toBe(200)
    expect((await w.run(r.id)).interrupt).toBe('discarded')
    const actions = (await t.db.select({ action: auditLogs.action }).from(auditLogs)).map((a) => a.action)
    expect(actions).toEqual(['command.stop', 'run.discard', 'run.discard'])
  })

  it('the next turn of that bot is told it was interrupted, and a pending choice settles as kept', async () => {
    const w = await world()
    const r = await pending(w)
    await w.say(w.as.li, '@小王的 Claude 继续')
    const start = w.starts().at(-1)!
    expect(start.prompt.context.at(-1)).toMatchObject({
      author: 'AIWS',
      body: '上一轮被 /stop 中断；本轮改动已保留，上一轮改动的 2 个文件仍在工作区，未提交。',
    })
    expect((await w.run(r.id)).interrupt).toBe('kept')

    // Only the turn right after the stop carries the note.
    const [, next] = await w.runsOf(w.claude.id)
    w.done(next!.id, { outcome: 'completed', filesChanged: 0 })
    await until(
      () => w.run(next!.id),
      (x) => x.status === 'completed',
    )
    await w.say(w.as.li, '@小王的 Claude 再来')
    expect(w.starts().at(-1)!.prompt.context.some((c) => c.author === 'AIWS')).toBe(false)
  })

  it('a discarded turn is reported as discarded to the next turn', async () => {
    const w = await world()
    const r = await pending(w)
    w.onSend((m) =>
      m.t === 'run.discard' ? { t: 'run.discarded', runId: m.runId, ok: true, files: 2, error: null } : null,
    )
    await w.as.li.post(`/api/runs/${r.id}/interrupt`, { choice: 'discard' })
    await w.say(w.as.li, '@小王的 Claude 继续')
    expect(w.starts().at(-1)!.prompt.context.at(-1)!.body).toBe(
      '上一轮被 /stop 中断；本轮改动已丢弃，上一轮改动的 2 个文件已还原到该轮开始前的状态。',
    )
  })
})

describe('offline expiry and chain notifications', () => {
  it('expires offline requests after the group wait and notifies the trigger user', async () => {
    const w = await world({ online: false })
    await w.say(w.as.li, '@小王的 Claude 改一下')
    await t.db
      .update(groups)
      .set({ params: { offlineWaitMin: 10 } })
      .where(eq(groups.id, w.g.id))
    const [r] = await w.runsOf(w.claude.id)
    minutes(9)
    await expireOfflineRuns(t.ctx)
    expect((await w.run(r!.id)).status).toBe('offline_wait')
    minutes(2)
    await expireOfflineRuns(t.ctx)
    expect(await w.run(r!.id)).toMatchObject({
      status: 'expired',
      step: 'bot 离线超过 10 分钟，已作废并通知 李建国',
      endedAt: clock,
    })
    const notes = await t.db.select().from(notifications)
    expect(notes).toEqual([
      expect.objectContaining({
        userId: w.li.id,
        type: 'offline_expired',
        payload: expect.objectContaining({ runId: r!.id, groupId: w.g.id, botName: '小王的 Claude' }),
      }),
    ])
    // Coming online later does not revive it.
    w.online()
    expect((await w.run(r!.id)).status).toBe('expired')
  })

  it('defaults to 30 minutes', async () => {
    const w = await world({ online: false })
    await w.say(w.as.li, '@小王的 Claude 改一下')
    minutes(29)
    await expireOfflineRuns(t.ctx)
    expect((await w.runsOf(w.claude.id))[0]!.status).toBe('offline_wait')
    minutes(1)
    await expireOfflineRuns(t.ctx)
    expect((await w.runsOf(w.claude.id))[0]!.status).toBe('expired')
  })

  it('notifies the chain initiator once when the last hop of a chain ends', async () => {
    const w = await world()
    await w.say(w.as.li, '@小王的 Claude 开始')
    const [root] = await w.runsOf(w.claude.id)
    w.done(root!.id, { outcome: 'completed' })
    await until(
      () => w.run(root!.id),
      (r) => r.status === 'completed',
    )
    expect(await t.db.select().from(notifications)).toEqual([])

    const hop2 = await relay(w, { ...root!, status: 'completed' }, w.codex.id)
    w.done(hop2.id, { outcome: 'completed' })
    await until(
      () => t.db.select().from(notifications),
      (n) => n.length > 0,
    )
    const notes = await t.db.select().from(notifications)
    expect(notes).toEqual([
      expect.objectContaining({
        userId: w.li.id,
        type: 'chain_done',
        payload: expect.objectContaining({ groupId: w.g.id, rootRunId: root!.id, hops: 2 }),
      }),
    ])
  })
})
