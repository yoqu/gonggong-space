import type { ConversationOpsDto, ConversationOverviewDto, ConversationStatsRowDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groups, messages, runs, teamMembers } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const DAY = 86_400_000

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin', teamId: null })
  const carol = await t.seed.user({ name: '卡罗', teamId: null })
  const teamB = await t.seed.team({ ownerId: carol.id, name: 'B 团队' })
  const claude = await t.seed.bot({ ownerId: alice.id, name: '小王的 Claude' })
  const carolBot = await t.seed.bot({ ownerId: carol.id, name: '卡罗的 Bot', teamId: teamB.id })
  const g1 = await t.seed.group({ createdBy: alice.id, name: '支付服务重构', memberIds: [bob.id] })
  const dm = await t.seed.group({ createdBy: alice.id, name: '小王的 Claude', kind: 'dm' })
  const g3 = await t.seed.group({ createdBy: carol.id, name: 'B 群', teamId: teamB.id })
  const old = await t.seed.group({ createdBy: alice.id, name: '旧群' })
  const now = Date.now()
  const ago = (days: number, ms = 0) => new Date(now - days * DAY + ms)
  await t.db
    .update(groups)
    .set({ createdAt: ago(40), archivedAt: ago(1) })
    .where(eq(groups.id, old.id))

  const say = async (
    groupId: string,
    kind: 'user' | 'bot' | 'event',
    author: string | null,
    daysAgo: number,
  ) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId,
        kind,
        authorUserId: kind === 'user' ? author : null,
        authorBotId: kind === 'bot' ? author : null,
        body: 'x',
        createdAt: ago(daysAgo),
      })
      .returning()
    return m!
  }
  const m1 = await say(g1.id, 'user', alice.id, 0)
  await say(g1.id, 'user', bob.id, 1)
  await say(g1.id, 'bot', claude.id, 0)
  await say(g1.id, 'event', null, 0)
  await say(g1.id, 'user', alice.id, 40)
  const m2 = await say(dm.id, 'user', alice.id, 2)
  await say(dm.id, 'bot', claude.id, 2)
  const m3 = await say(g3.id, 'user', carol.id, 0)
  await say(g3.id, 'bot', carolBot.id, 0)
  const m4 = await say(old.id, 'user', alice.id, 45)

  const run = (o: {
    msg: typeof m1
    bot: string
    origin: string
    status: string
    daysAgo: number
    secs?: number
  }) => ({
    groupId: o.msg.groupId,
    botId: o.bot,
    triggerMessageId: o.msg.id,
    originUserId: o.origin,
    status: o.status,
    queuedAt: ago(o.daysAgo),
    startedAt: o.status === 'forbidden' ? null : ago(o.daysAgo),
    endedAt: o.secs ? ago(o.daysAgo, o.secs * 1000) : null,
  })
  await t.db
    .insert(runs)
    .values([
      run({ msg: m1, bot: claude.id, origin: alice.id, status: 'completed', daysAgo: 0, secs: 60 }),
      run({ msg: m1, bot: claude.id, origin: bob.id, status: 'interrupted', daysAgo: 1, secs: 5 }),
      run({ msg: m1, bot: claude.id, origin: bob.id, status: 'forbidden', daysAgo: 0 }),
      run({ msg: m2, bot: claude.id, origin: alice.id, status: 'completed', daysAgo: 2, secs: 120 }),
      run({ msg: m3, bot: carolBot.id, origin: carol.id, status: 'running', daysAgo: 0 }),
      run({ msg: m4, bot: claude.id, origin: alice.id, status: 'completed', daysAgo: 45, secs: 30 }),
    ])
  return { alice, bob, admin, carol, teamA: g1.teamId, teamB, claude, carolBot, g1, dm, g3 }
}

const as = async (userId: string) => client(t, await t.seed.cookie(userId))
const byName = (rows: ConversationStatsRowDto[]) => Object.fromEntries(rows.map((r) => [r.name, r]))

describe('conversation stats', () => {
  it('summarises every team for sysadmins, against the previous period', async () => {
    const w = await world()
    const res = await (await as(w.admin.id)).get<ConversationOverviewDto>(
      '/api/admin/conversation-stats/overview?days=30&tz=UTC',
    )
    expect(res.status).toBe(200)
    const o = res.body
    expect([o.groups, o.dms]).toEqual([2, 1])
    expect(o.current).toEqual({
      activeConversations: 3,
      newConversations: 3,
      userMessages: 4,
      botMessages: 3,
      activeUsers: 3,
      runs: 5,
      endedRuns: 4,
      completedRuns: 2,
      avgRunMs: 90_000,
    })
    expect(o.previous).toEqual({
      activeConversations: 2,
      newConversations: 1,
      userMessages: 2,
      botMessages: 0,
      activeUsers: 1,
      runs: 1,
      endedRuns: 1,
      completedRuns: 1,
      avgRunMs: 30_000,
    })
    expect(o.statuses).toEqual([
      { status: 'completed', count: 2 },
      { status: 'forbidden', count: 1 },
      { status: 'interrupted', count: 1 },
      { status: 'running', count: 1 },
    ])
    expect(o.daily).toHaveLength(30)
    expect(o.daily.at(-1)).toMatchObject({
      day: new Date().toISOString().slice(0, 10),
      activeConversations: 2,
      userMessages: 2,
      botMessages: 2,
      activeUsers: 2,
      runs: 3,
    })
    expect(o.daily.at(-2)).toMatchObject({ activeConversations: 1, userMessages: 1, botMessages: 0, runs: 1 })

    const b = (
      await (
        await as(w.admin.id)
      ).get<ConversationOverviewDto>(`/api/admin/conversation-stats/overview?teamId=${w.teamB.id}`)
    ).body
    expect([b.groups, b.dms, b.current.userMessages, b.current.runs, b.current.avgRunMs]).toEqual([
      1,
      0,
      1,
      1,
      null,
    ])
  })

  it('breaks activity down by conversation, member, bot and team', async () => {
    const w = await world()
    const admin = await as(w.admin.id)
    const rows = async (q: string) =>
      byName((await admin.get<ConversationStatsRowDto[]>(`/api/admin/conversation-stats?${q}`)).body)

    const conv = await rows('by=conversation')
    expect(Object.keys(conv).sort()).toEqual(['B 群', '小王的 Claude', '支付服务重构'].sort())
    expect(conv['支付服务重构']).toMatchObject({
      key: w.g1.id,
      kind: 'group',
      teamName: '默认团队',
      ownerName: '王磊',
      userMessages: 2,
      botMessages: 1,
      activeUsers: 2,
      runs: 3,
      endedRuns: 3,
      completedRuns: 1,
    })
    expect(conv['支付服务重构']?.lastActiveAt).toEqual(expect.any(String))
    expect(conv['小王的 Claude']).toMatchObject({ kind: 'dm', userMessages: 1, botMessages: 1, runs: 1 })
    expect(conv['B 群']).toMatchObject({ teamName: 'B 团队', runs: 1, endedRuns: 0 })

    const people = await rows('by=user')
    expect(people['王磊']).toMatchObject({ userMessages: 2, conversations: 2, runs: 2, completedRuns: 2 })
    expect(people['陈晨']).toMatchObject({
      userMessages: 1,
      conversations: 1,
      runs: 2,
      endedRuns: 2,
      completedRuns: 0,
    })
    expect(people['卡罗']).toMatchObject({ userMessages: 1, runs: 1 })

    const bots = await rows('by=bot')
    expect(bots['小王的 Claude']).toMatchObject({
      ownerName: '王磊',
      teamName: '默认团队',
      botMessages: 2,
      conversations: 2,
      activeUsers: 2,
      runs: 4,
      completedRuns: 2,
    })

    const teams = await rows('by=team')
    expect(teams['默认团队']).toMatchObject({
      conversations: 2,
      userMessages: 3,
      botMessages: 2,
      activeUsers: 2,
      runs: 4,
    })
    expect(teams['B 团队']).toMatchObject({ conversations: 1, userMessages: 1, runs: 1 })

    expect(Object.keys(await rows(`by=team&teamId=${w.teamB.id}`))).toEqual(['B 团队'])
  })

  it('shows a team its own numbers, to its admins only', async () => {
    const w = await world()
    const alice = await as(w.alice.id)
    const o = (await alice.get<ConversationOverviewDto>(`/api/teams/${w.teamA}/conversation-stats/overview`))
      .body
    expect([o.groups, o.dms, o.current.userMessages, o.current.runs]).toEqual([1, 1, 3, 4])
    const conv = (
      await alice.get<ConversationStatsRowDto[]>(`/api/teams/${w.teamA}/conversation-stats?by=conversation`)
    ).body
    expect(conv.map((r) => r.name).sort()).toEqual(['小王的 Claude', '支付服务重构'].sort())

    expect((await (await as(w.bob.id)).get(`/api/teams/${w.teamA}/conversation-stats/overview`)).status).toBe(
      403,
    )
    expect((await alice.get(`/api/teams/${w.teamB.id}/conversation-stats?by=user`)).status).toBe(404)
    expect((await alice.get('/api/admin/conversation-stats/overview')).status).toBe(403)
  })
})

describe('conversation stats · 运营', () => {
  const HOUR = 3_600_000
  const at = (days: number, hours = 0) => new Date(Date.now() - days * DAY + hours * HOUR)
  const post = async (groupId: string, userId: string, daysAgo: number, kind: 'user' | 'bot' = 'user') => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId,
        kind,
        authorUserId: kind === 'user' ? userId : null,
        body: 'x',
        createdAt: at(daysAgo),
      })
      .returning()
    return m!
  }
  /** A run of `botId` in `groupId`, queued at `queuedAt`; terminal statuses end an hour later unless told. */
  const addRun = async (o: {
    groupId: string
    botId: string
    origin: string
    queuedAt: Date
    status?: string
    step?: string
    endedAt?: Date | null
    stoppedBy?: string
  }) => {
    const trigger = await post(o.groupId, o.origin, 0)
    const status = o.status ?? 'completed'
    await t.db.insert(runs).values({
      groupId: o.groupId,
      botId: o.botId,
      triggerMessageId: trigger.id,
      originUserId: o.origin,
      status,
      step: o.step ?? '',
      queuedAt: o.queuedAt,
      endedAt: o.endedAt === undefined ? new Date(o.queuedAt.getTime() + HOUR) : o.endedAt,
      stoppedBy: o.stoppedBy ?? null,
    })
  }
  const joined = (teamId: string, userId: string, when: Date) =>
    t.db
      .update(teamMembers)
      .set({ joinedAt: when })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))

  /** Team A (默认团队) owned by alice, team B owned by carol, a sysadmin outside both. */
  async function teams() {
    const alice = await t.seed.user({ name: '王磊' })
    const admin = await t.seed.user({ name: '管理员', role: 'sysadmin', teamId: null })
    const carol = await t.seed.user({ name: '卡罗', teamId: null })
    const teamB = await t.seed.team({ ownerId: carol.id, name: 'B 团队' })
    const bot = await t.seed.bot({ ownerId: alice.id })
    const botB = await t.seed.bot({ ownerId: carol.id, teamId: teamB.id })
    const gA = await t.seed.group({ createdBy: alice.id })
    const gB = await t.seed.group({ createdBy: carol.id, teamId: teamB.id })
    await t.db.update(teamMembers).set({ joinedAt: at(30) })
    return { alice, admin, carol, teamA: gA.teamId, teamB: teamB.id, bot, botB, gA, gB }
  }
  const ops = async (userId: string, url: string) => {
    const res = await (await as(userId)).get<ConversationOpsDto>(url)
    expect(res.status).toBe(200)
    return res.body
  }

  it('counts who came back from the previous period, per scope and to admins only', async () => {
    const w = await teams()
    const bob = await t.seed.user({ name: '陈晨' })
    const erin = await t.seed.user({ name: '艾琳' })
    await post(w.gA.id, w.alice.id, 10)
    await post(w.gA.id, w.alice.id, 1)
    await post(w.gA.id, erin.id, 9)
    await post(w.gA.id, bob.id, 2)
    await post(w.gB.id, w.carol.id, 8)
    await post(w.gB.id, w.carol.id, 0)
    await post(w.gB.id, w.carol.id, 20)

    const all = await ops(w.admin.id, '/api/admin/conversation-stats/ops?days=7')
    expect(all.retention).toEqual({ previous: 3, retained: 2 })
    const b = await ops(w.admin.id, `/api/admin/conversation-stats/ops?days=7&teamId=${w.teamB}`)
    expect(b.retention).toEqual({ previous: 1, retained: 1 })
    const a = await ops(w.alice.id, `/api/teams/${w.teamA}/conversation-stats/ops?days=7`)
    expect(a.retention).toEqual({ previous: 2, retained: 1 })

    expect((await (await as(bob.id)).get(`/api/teams/${w.teamA}/conversation-stats/ops`)).status).toBe(403)
    const alice = await as(w.alice.id)
    expect((await alice.get(`/api/teams/${w.teamB}/conversation-stats/ops`)).status).toBe(404)
    expect((await alice.get('/api/admin/conversation-stats/ops')).status).toBe(403)
  })

  it('tracks members who joined in the window to their first run there', async () => {
    const w = await teams()
    const bob = await t.seed.user({ name: '陈晨' })
    const dan = await t.seed.user({ name: '丹' })
    const gina = await t.seed.user({ name: '吉娜' })
    const hank = await t.seed.user({ name: '汉克' })
    const kim = await t.seed.user({ name: '金', teamId: w.teamB })
    await joined(w.teamA, bob.id, at(3))
    await joined(w.teamA, dan.id, at(2))
    await joined(w.teamA, gina.id, at(5))
    await joined(w.teamA, hank.id, at(4))
    await joined(w.teamB, kim.id, at(1))
    const run = (origin: string, queuedAt: Date, b = false) =>
      addRun({ groupId: b ? w.gB.id : w.gA.id, botId: b ? w.botB.id : w.bot.id, origin, queuedAt })
    await run(bob.id, at(3, 2))
    await run(bob.id, at(1))
    await run(gina.id, at(5, 6))
    await run(hank.id, at(6))
    await run(dan.id, at(0), true)
    await run(kim.id, at(1, 1), true)
    await run(w.alice.id, at(0))

    const a = await ops(w.alice.id, `/api/teams/${w.teamA}/conversation-stats/ops?days=7`)
    expect(a.activation).toEqual({ joined: 4, activated: 2, medianHours: 4 })
    const all = await ops(w.admin.id, '/api/admin/conversation-stats/ops?days=7')
    expect(all.activation).toEqual({ joined: 5, activated: 3, medianHours: 2 })
    const none = await ops(w.admin.id, `/api/admin/conversation-stats/ops?days=7&teamId=${w.teamB}`)
    expect(none.activation).toEqual({ joined: 1, activated: 1, medianHours: 1 })
  })

  it('ranks why runs failed, leaving out runs people stopped', async () => {
    const w = await teams()
    const fail = (
      status: string,
      step: string,
      endedDaysAgo: number,
      o: { b?: boolean; stoppedBy?: string } = {},
    ) =>
      addRun({
        groupId: o.b ? w.gB.id : w.gA.id,
        botId: o.b ? w.botB.id : w.bot.id,
        origin: w.alice.id,
        status,
        step,
        queuedAt: at(endedDaysAgo, -1),
        endedAt: at(endedDaysAgo),
        stoppedBy: o.stoppedBy,
      })
    await fail('interrupted', '机器离线', 1)
    await fail('interrupted', '机器离线', 2)
    await fail('interrupted', '已停止', 1, { stoppedBy: w.alice.id })
    await fail('expired', '等待超时', 3)
    await fail('forbidden', '无权限', 0)
    await fail('completed', '', 1)
    await fail('interrupted', '机器离线', 10)
    await fail('expired', '等待超时', 0, { b: true })
    await addRun({
      groupId: w.gA.id,
      botId: w.bot.id,
      origin: w.alice.id,
      queuedAt: at(0),
      status: 'running',
      endedAt: null,
    })

    const a = await ops(w.alice.id, `/api/teams/${w.teamA}/conversation-stats/ops?days=7`)
    expect(a.failures).toEqual({
      endedRuns: 6,
      failedRuns: 4,
      reasons: [
        { status: 'interrupted', step: '机器离线', count: 2 },
        { status: 'expired', step: '等待超时', count: 1 },
        { status: 'forbidden', step: '无权限', count: 1 },
      ],
    })
    const all = await ops(w.admin.id, '/api/admin/conversation-stats/ops?days=7')
    expect(all.failures).toEqual({
      endedRuns: 7,
      failedRuns: 5,
      reasons: [
        { status: 'expired', step: '等待超时', count: 2 },
        { status: 'interrupted', step: '机器离线', count: 2 },
        { status: 'forbidden', step: '无权限', count: 1 },
      ],
    })
  })

  it('splits runs between builders and 使用者', async () => {
    const w = await teams()
    const bob = await t.seed.user({ name: '陈晨' })
    const frank = await t.seed.user({ name: '弗兰克' })
    const ivy = await t.seed.user({ name: '艾薇' })
    const jay = await t.seed.user({ name: '杰' })
    const kay = await t.seed.user({ name: '凯' })
    const lee = await t.seed.user({ name: '李' })
    const mia = await t.seed.user({ name: '米娅', teamId: w.teamB })
    await t.seed.machine(frank.id)
    await t.seed.bot({ ownerId: ivy.id })
    await t.seed.group({ createdBy: jay.id })
    await t.seed.group({ createdBy: kay.id, kind: 'dm' })
    await t.db
      .update(teamMembers)
      .set({ role: 'admin' })
      .where(and(eq(teamMembers.teamId, w.teamA), eq(teamMembers.userId, lee.id)))
    const run = (origin: string, daysAgo = 1, b = false) =>
      addRun({
        groupId: b ? w.gB.id : w.gA.id,
        botId: b ? w.botB.id : w.bot.id,
        origin,
        queuedAt: at(daysAgo),
      })
    for (const u of [w.alice, bob, bob, frank, ivy, jay, kay, lee, w.admin]) await run(u.id)
    await run(bob.id, 10)
    await run(w.carol.id, 1, true)
    await run(mia.id, 1, true)

    const a = await ops(w.alice.id, `/api/teams/${w.teamA}/conversation-stats/ops?days=7`)
    expect(a.audience).toEqual({ userRuns: 3, builderRuns: 6, users: 2, builders: 6 })
    const b = await ops(w.admin.id, `/api/admin/conversation-stats/ops?days=7&teamId=${w.teamB}`)
    expect(b.audience).toEqual({ userRuns: 1, builderRuns: 1, users: 1, builders: 1 })
    const all = await ops(w.admin.id, '/api/admin/conversation-stats/ops?days=7')
    expect(all.audience).toEqual({ userRuns: 4, builderRuns: 7, users: 3, builders: 7 })
  })
})
