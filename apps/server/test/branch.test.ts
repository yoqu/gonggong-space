import type { ServerToDaemon } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { botShares, groupBots, groups, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '赵敏' })
  const { machine } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const g = await t.seed.group({ createdBy: wang.id, name: '支付', memberIds: [li.id], botIds: [bot.id] })
  await t.db
    .update(groupBots)
    .set({ cdPath: '/code/app', extraDirs: ['/code/lib'], sessionId: 'sess-live' })
    .where(eq(groupBots.groupId, g.id))

  let at = Date.now() - 10 * 60_000
  const say = async (o: { body: string; botId?: string; runId?: string; recalled?: boolean }) => {
    at += 1000
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: g.id,
        kind: o.botId ? 'bot' : 'user',
        authorUserId: o.botId ? null : wang.id,
        authorBotId: o.botId ?? null,
        body: o.body,
        runId: o.runId ?? null,
        createdAt: new Date(at),
        recalledAt: o.recalled ? new Date() : null,
      })
      .returning()
    return m!
  }
  const run = async (status: string, sessionAfter: string | null) => {
    const trigger = await say({ body: '触发' })
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: bot.id,
        triggerMessageId: trigger.id,
        originUserId: wang.id,
        status,
        startedAt: trigger.createdAt,
        sessionAfter,
      })
      .returning()
    return r!
  }

  const firstRun = await run('completed', 'sess-1')
  await say({ body: '第一问：怎么退款' })
  const first = await say({ body: '第一答：走退款接口', botId: bot.id, runId: firstRun.id })
  const secondRun = await run('completed', 'sess-2')
  await say({ body: '第二问：加个重试' })
  const second = await say({ body: '第二答：已加重试', botId: bot.id, runId: secondRun.id })
  const interruptedRun = await run('interrupted', 'sess-3')
  const cut = await say({ body: '中断的回复', botId: bot.id, runId: interruptedRun.id })
  const hidden = await say({ body: '已撤回', botId: bot.id, runId: secondRun.id, recalled: true })

  const sent: ServerToDaemon[] = []
  const forks: { sessionId: string; cwd?: string }[] = []
  const machineId = machine.id
  t.ctx.hub.isOnline = (id) => id === machineId
  t.ctx.hub.features = () => ['sessionFork']
  t.ctx.hub.send = (_id, msg) => {
    sent.push(msg)
    return true
  }
  let forkReply: { sessionId: string | null; error: string | null } = { sessionId: 'sess-fork', error: null }
  t.ctx.hub.request = (async (_id: string, msg: ServerToDaemon) => {
    if (msg.t !== 'session.fork') return undefined
    forks.push({ sessionId: msg.sessionId })
    return { t: 'session.fork.result', requestId: msg.requestId, ...forkReply }
  }) as typeof t.ctx.hub.request
  return {
    wang,
    li,
    outsider,
    bot,
    g,
    first,
    second,
    cut,
    hidden,
    sent,
    forks,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asOutsider: client(t, await t.seed.cookie(outsider.id)),
    setFork: (r: typeof forkReply) => {
      forkReply = r
    },
    setOnline: (online: boolean) => {
      t.ctx.hub.isOnline = (id) => online && id === machineId
    },
  }
}

const dmsOf = (ownerId: string) =>
  t.db
    .select({ id: groups.id, kind: groups.kind, createdBy: groups.createdBy })
    .from(groups)
    .where(and(eq(groups.kind, 'dm'), eq(groups.createdBy, ownerId)))

describe('POST /api/messages/:id/branch', () => {
  it('opens a DM with the bot on the forked session, copies the binding and writes the summary first', async () => {
    const w = await world()
    const res = await w.asWang.post<{ groupId: string }>(`/api/messages/${w.second.id}/branch`)
    expect(res.status).toBe(200)

    const [dm] = await dmsOf(w.wang.id)
    expect(dm!.id).toBe(res.body.groupId)
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, dm!.id), eq(groupBots.botId, w.bot.id)))
    expect(gb!.sessionId).toBe('sess-fork')

    expect(w.forks).toEqual([{ sessionId: 'sess-2' }])
    expect(w.sent).toContainEqual(
      expect.objectContaining({ t: 'workspace.cd', groupId: dm!.id, botId: w.bot.id, path: '/code/app' }),
    )

    const events = await t.db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.groupId, dm!.id), eq(messages.kind, 'event')))
      .orderBy(messages.seq)
    const summary = events.map((e) => e.body).find((b) => b.includes('第一问'))
    expect(summary).toBeDefined()
    expect(summary).toContain('第二问')
    expect(summary).not.toContain('第二答')
    expect(summary).not.toContain('已撤回')
  })

  it('refuses a reply from an earlier round, since its session has moved on', async () => {
    const w = await world()
    expect((await w.asWang.post(`/api/messages/${w.first.id}/branch`)).status).toBe(400)
    expect(w.forks).toEqual([])
    expect(await dmsOf(w.wang.id)).toEqual([])
  })

  it('refuses a member message, an interrupted reply, a recalled reply and a non-member', async () => {
    const w = await world()
    const user = await t.db.select().from(messages).where(eq(messages.body, '第一问：怎么退款'))
    expect((await w.asWang.post(`/api/messages/${user[0]!.id}/branch`)).status).toBe(400)
    expect((await w.asWang.post(`/api/messages/${w.cut.id}/branch`)).status).toBe(400)
    expect((await w.asWang.post(`/api/messages/${w.hidden.id}/branch`)).status).toBe(400)
    expect((await w.asOutsider.post(`/api/messages/${w.first.id}/branch`)).status).toBe(404)
    expect((await w.asWang.post('/api/messages/00000000-0000-0000-0000-000000000000/branch')).status).toBe(
      404,
    )
    expect((await w.asWang.post('/api/messages/not-a-uuid/branch')).status).toBe(404)
    expect(w.forks).toEqual([])
    expect(await dmsOf(w.wang.id)).toEqual([])
  })

  it('refuses a shared bot even when it is shared with the member, before forking', async () => {
    const w = await world()
    expect((await w.asLi.post(`/api/messages/${w.second.id}/branch`)).status).toBe(403)
    await t.db.insert(botShares).values({ botId: w.bot.id, userId: w.li.id, createdBy: w.wang.id })
    expect((await w.asLi.post(`/api/messages/${w.second.id}/branch`)).status).toBe(403)
    expect(w.forks).toEqual([])
    expect(await t.db.select().from(groups).where(eq(groups.createdBy, w.li.id))).toEqual([])
  })

  it('creates no DM when the bot is offline or the adapter cannot fork', async () => {
    const w = await world()
    w.setOnline(false)
    expect((await w.asWang.post(`/api/messages/${w.second.id}/branch`)).status).toBe(409)
    w.setOnline(true)
    w.setFork({ sessionId: null, error: '适配器不支持分支会话' })
    const failed = await w.asWang.post<{ message?: string }>(`/api/messages/${w.second.id}/branch`)
    expect(failed.status).toBe(409)
    expect(failed.body.message).toContain('适配器不支持分支会话')
    expect(await dmsOf(w.wang.id)).toEqual([])
  })

  it('refuses when the reply carries no session to fork', async () => {
    const w = await world()
    await t.db.update(runs).set({ sessionAfter: null }).where(eq(runs.botId, w.bot.id))
    expect((await w.asWang.post(`/api/messages/${w.second.id}/branch`)).status).toBe(400)
    expect(w.forks).toEqual([])
  })
})
