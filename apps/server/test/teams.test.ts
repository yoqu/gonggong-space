import type {
  BotDto,
  GroupDto,
  NotificationDto,
  RepoDto,
  SearchResultDto,
  ToolCallRes,
  UsageRowDto,
  UserBriefDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bots,
  groupBots,
  groups,
  messages,
  notifications,
  repos,
  runs,
  teamMembers,
  teams,
} from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { notify } from '../src/modules/notifications/notify.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

/** Team A (alice, bob, eve) and team B (carol, eve); eve belongs to both. */
async function world() {
  const alice = await t.seed.user({ name: '爱丽丝' })
  const bob = await t.seed.user({ name: '鲍勃' })
  const eve = await t.seed.user({ name: '伊芙' })
  const carol = await t.seed.user({ name: '卡罗尔', teamId: null })
  const b = await t.seed.team({ ownerId: carol.id, name: '团队B', memberIds: [eve.id] })
  const aliceBot = await t.seed.bot({ ownerId: alice.id, name: 'A 的 Claude' })
  const eveBotA = await t.seed.bot({ ownerId: eve.id, name: '伊芙 A' })
  const eveBotB = await t.seed.bot({ ownerId: eve.id, name: '伊芙 B', teamId: b.id })
  const carolBot = await t.seed.bot({ ownerId: carol.id, name: 'B 的 Codex', teamId: b.id })
  const groupA = await t.seed.group({ createdBy: alice.id, name: 'A 群', memberIds: [bob.id, eve.id] })
  const groupB = await t.seed.group({ createdBy: carol.id, name: 'B 群', memberIds: [eve.id], teamId: b.id })
  const teamA = groupA.teamId
  const as = async (u: { id: string }, teamId?: string) => client(t, await t.seed.cookie(u.id), teamId)
  return {
    alice,
    bob,
    eve,
    carol,
    teamA,
    teamB: b.id,
    aliceBot,
    eveBotA,
    eveBotB,
    carolBot,
    groupA,
    groupB,
    as,
  }
}

describe('team context', () => {
  it('uses X-GG-Team when given, else the earliest-joined team; refuses teams the caller is not in', async () => {
    const w = await world()
    const names = async (c: Awaited<ReturnType<typeof w.as>>) =>
      (await c.get<UserBriefDto[]>('/api/users')).body.map((u) => u.name).sort()
    expect(await names(await w.as(w.alice))).toEqual(['伊芙', '爱丽丝', '鲍勃'].sort())
    expect(await names(await w.as(w.carol))).toEqual(['伊芙', '卡罗尔'].sort())
    expect(await names(await w.as(w.eve))).toEqual(['伊芙', '爱丽丝', '鲍勃'].sort())
    expect(await names(await w.as(w.eve, w.teamB))).toEqual(['伊芙', '卡罗尔'].sort())

    const foreign = await (await w.as(w.alice, w.teamB)).get('/api/users')
    expect(foreign.status).toBe(404)
    expect((await (await w.as(w.alice, 'not-a-uuid')).get('/api/groups')).status).toBe(404)

    const loner = await t.seed.user({ teamId: null })
    expect((await (await w.as(loner)).get('/api/groups')).status).toBe(403)
  })

  it('does not treat sysadmins as members of other teams', async () => {
    const w = await world()
    const root = await t.seed.user({ role: 'sysadmin' })
    expect((await (await w.as(root, w.teamB)).get('/api/bots')).status).toBe(404)
  })
})

describe('single-team mode', () => {
  it('puts new accounts into the only live team, and nowhere once there are several or the mode is off', async () => {
    const root = await t.seed.user({ role: 'sysadmin' })
    const admin = client(t, await t.seed.cookie(root.id))
    await saveSysParams(t.ctx, { registrationOpen: true }, root.id)
    const create = (account: string) =>
      admin.post<{ id: string }>('/api/admin/users', {
        account,
        name: account,
        role: 'member',
        password: 'password123',
      })
    const register = async (account: string) =>
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/auth/register',
          payload: { account, name: account, password: 'password123' },
        })
      ).json<{ id: string }>()
    const teamsOf = async (userId: string) =>
      (await t.db.select().from(teamMembers).where(eq(teamMembers.userId, userId))).map((m) => [
        m.teamId,
        m.role,
      ])
    const [only] = await t.db.select().from(teams)

    expect(await teamsOf((await create('made')).body.id)).toEqual([[only!.id, 'member']])
    expect(await teamsOf((await register('signed')).id)).toEqual([[only!.id, 'member']])

    await saveSysParams(t.ctx, { singleTeamMode: false }, root.id)
    expect(await teamsOf((await create('free')).body.id)).toEqual([])
    await saveSysParams(t.ctx, { singleTeamMode: true }, root.id)
    await t.seed.team({ ownerId: root.id })
    expect(await teamsOf((await register('two')).id)).toEqual([])
  })
})

describe('isolation between teams', () => {
  it('lists only the current team’s groups and bots', async () => {
    const w = await world()
    const groupNames = async (c: Awaited<ReturnType<typeof w.as>>) =>
      (await c.get<GroupDto[]>('/api/groups')).body.map((g) => g.name)
    expect(await groupNames(await w.as(w.eve, w.teamA))).toEqual(['A 群'])
    expect(await groupNames(await w.as(w.eve, w.teamB))).toEqual(['B 群'])

    const botNames = async (c: Awaited<ReturnType<typeof w.as>>) =>
      (await c.get<BotDto[]>('/api/bots')).body.map((b) => b.name).sort()
    expect(await botNames(await w.as(w.alice))).toEqual(['A 的 Claude', '伊芙 A'].sort())
    expect(await botNames(await w.as(w.carol))).toEqual(['B 的 Codex', '伊芙 B'].sort())
    expect((await (await w.as(w.alice)).get(`/api/bots/${w.carolBot.id}`)).status).toBe(404)
    expect((await (await w.as(w.alice)).get(`/api/groups/${w.groupB.id}`)).status).toBe(404)
  })

  it('creates groups and bots in the current team, only with its members and bots', async () => {
    const w = await world()
    const eveB = await w.as(w.eve, w.teamB)
    const made = await eveB.post<GroupDto>('/api/groups', {
      name: '新群',
      kind: 'group',
      memberIds: [w.carol.id],
    })
    expect(made.status).toBe(200)
    const [row] = await t.db.select().from(groups).where(eq(groups.id, made.body.id))
    expect(row?.teamId).toBe(w.teamB)

    expect(
      (await eveB.post('/api/groups', { name: 'x', kind: 'group', memberIds: [w.alice.id] })).status,
    ).toBe(400)
    expect(
      (await eveB.post('/api/groups', { name: 'x', kind: 'group', botIds: [w.aliceBot.id] })).status,
    ).toBe(400)
    // A private chat with her own bot, but from the other team.
    expect((await eveB.post('/api/groups', { name: 'dm', kind: 'dm', botIds: [w.eveBotA.id] })).status).toBe(
      400,
    )
    expect((await eveB.post('/api/groups', { name: 'dm', kind: 'dm', botIds: [w.eveBotB.id] })).status).toBe(
      200,
    )

    const created = await eveB.post<BotDto>('/api/bots', {
      name: '伊芙新 Bot',
      ownerId: w.eve.id,
      agentKind: 'claude',
      machineId: null,
    })
    expect(created.status).toBe(200)
    const [bot] = await t.db.select().from(bots).where(eq(bots.id, created.body.id))
    expect(bot?.teamId).toBe(w.teamB)
    const aliceEvents = events(t, w.alice.id)
    await eveB.patch(`/api/bots/${bot!.id}`, { systemPrompt: 'hi' })
    expect(aliceEvents.filter((e) => e.t === 'bot.updated')).toEqual([])

    const root = await t.seed.user({ role: 'sysadmin', teamId: w.teamB })
    const rootB = await w.as(root, w.teamB)
    expect(
      (
        await rootB.post('/api/bots', {
          name: '替 A',
          ownerId: w.alice.id,
          agentKind: 'claude',
          machineId: null,
        })
      ).status,
    ).toBe(400)
  })

  it('refuses foreign bots and members in existing groups', async () => {
    const w = await world()
    const alice = await w.as(w.alice)
    expect((await alice.post(`/api/groups/${w.groupA.id}/bots`, { botId: w.carolBot.id })).status).toBe(400)
    expect((await alice.post(`/api/groups/${w.groupA.id}/members`, { userIds: [w.carol.id] })).status).toBe(
      400,
    )
    expect((await alice.post(`/api/groups/${w.groupA.id}/bots`, { botId: w.eveBotA.id })).status).toBe(200)
    expect(
      (await alice.patch(`/api/bots/${w.aliceBot.id}`, { triggerScope: 'list', triggerList: [w.carol.id] }))
        .status,
    ).toBe(400)
  })

  it('keeps repo history per team', async () => {
    const w = await world()
    const url = 'git@git.corp:team/refund.git'
    await (await w.as(w.alice)).post('/api/groups', {
      name: 'r',
      kind: 'group',
      repo: { url, branch: 'main' },
    })
    await (await w.as(w.carol)).post('/api/groups', {
      name: 'r',
      kind: 'group',
      repo: { url, branch: 'dev' },
    })
    const rows = await t.db.select().from(repos)
    expect(rows.map((r) => [r.teamId, r.lastBranch]).sort()).toEqual(
      [
        [w.teamA, 'main'],
        [w.teamB, 'dev'],
      ].sort(),
    )
    const listed = (await (await w.as(w.eve, w.teamB)).get<RepoDto[]>('/api/repos')).body
    expect(listed.map((r) => r.lastBranch)).toEqual(['dev'])
    expect(listed[0]?.groups).toBe(1)
  })

  it('searches only the current team’s groups', async () => {
    const w = await world()
    for (const g of [w.groupA, w.groupB])
      await t.db
        .insert(messages)
        .values({ groupId: g.id, kind: 'user', authorUserId: w.eve.id, body: `退款 ${g.name}` })
    const titles = async (teamId: string) =>
      (await (await w.as(w.eve, teamId)).get<SearchResultDto[]>('/api/search?q=退款&tab=msg')).body.map(
        (r) => r.groupId,
      )
    expect(await titles(w.teamA)).toEqual([w.groupA.id])
    expect(await titles(w.teamB)).toEqual([w.groupB.id])
  })

  it('lists only the current team’s notifications', async () => {
    const w = await world()
    await notify(t.ctx, w.eve.id, 'chain_done', { groupId: w.groupA.id })
    await notify(t.ctx, w.eve.id, 'chain_done', { groupId: w.groupB.id })
    await notify(t.ctx, w.eve.id, 'bot_confirm', { botId: w.eveBotB.id })
    const rows = await t.db.select().from(notifications)
    expect(rows.map((r) => r.teamId).sort()).toEqual([w.teamA, w.teamB, w.teamB].sort())
    const list = async (teamId: string) =>
      (await (await w.as(w.eve, teamId)).get<NotificationDto[]>('/api/notifications')).body
        .map((n) => n.type)
        .sort()
    expect(await list(w.teamA)).toEqual(['chain_done'])
    expect(await list(w.teamB)).toEqual(['bot_confirm', 'chain_done'])
  })

  it('counts usage of the current team only', async () => {
    const w = await world()
    for (const [g, botId] of [
      [w.groupA, w.eveBotA.id],
      [w.groupB, w.eveBotB.id],
    ] as const) {
      const [m] = await t.db
        .insert(messages)
        .values({ groupId: g.id, kind: 'user', authorUserId: w.eve.id, body: '@' })
        .returning()
      await t.db.insert(runs).values({
        groupId: g.id,
        botId,
        triggerMessageId: m!.id,
        originUserId: w.eve.id,
        status: 'completed',
        startedAt: new Date(),
      })
    }
    const usage = await (await w.as(w.eve, w.teamB)).get<UsageRowDto[]>('/api/usage?by=bot')
    expect(usage.body.map((r) => r.name)).toEqual(['伊芙 B'])
  })

  it('limits the built-in MCP cross-group reads to the bot’s team', async () => {
    const w = await world()
    const { machine, token } = await t.seed.machine(w.alice.id)
    await t.db.update(bots).set({ machineId: machine.id, binding: 'bound' }).where(eq(bots.id, w.aliceBot.id))
    await t.db.insert(groupBots).values([
      { groupId: w.groupA.id, botId: w.aliceBot.id },
      // Inconsistent data must still not leak: the bot is somehow in another team's group.
      { groupId: w.groupB.id, botId: w.aliceBot.id },
    ])
    const say = async (groupId: string, body: string) =>
      (
        await t.db
          .insert(messages)
          .values({ groupId, kind: 'user', authorUserId: w.alice.id, body })
          .returning()
      )[0]!
    await say(w.groupB.id, 'B 群的退款')
    const trigger = await say(w.groupA.id, 'A 群的退款')
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: w.groupA.id,
        botId: w.aliceBot.id,
        triggerMessageId: trigger.id,
        originUserId: w.alice.id,
        status: 'running',
      })
      .returning()
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${run!.id}/tools/search_messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: { query: '退款', group: 'all' } },
    })
    const text = res.json<ToolCallRes>().text
    expect(text).toContain('A 群的退款')
    expect(text).not.toContain('B 群的退款')
  })
})
