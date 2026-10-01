import type {
  AdminGroupDto,
  AdminTeamDto,
  AdminUserDto,
  AuditDto,
  BotDto,
  GroupDto,
  McpServerDto,
  MeDto,
  RunStart,
  ServerToDaemon,
  SystemParams,
  TeamGroupDto,
  TeamParamsDto,
  TimelineDto,
  UsageRowDto,
  WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvals, auditLogs, groups, messages, runs, teamMembers, teams } from '../src/db/schema.js'
import { audit } from '../src/lib/audit.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { claimAttachments } from '../src/modules/attachments/service.js'
import { effectiveParams, groupParams } from '../src/modules/groups/params.js'
import { enabledMcpServers } from '../src/modules/mcp/routes.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const mcp = (name: string, url = `https://mcp.corp/${name}`) => ({
  transport: 'http' as const,
  name,
  url,
  headers: {},
})

/** Team A: alice (owner), bob (admin), eve (member, admin of group A); team B: carol. Root is a teamless sysadmin. */
async function world() {
  const alice = await t.seed.user({ name: '爱丽丝' })
  const bob = await t.seed.user({ name: '鲍勃' })
  const eve = await t.seed.user({ name: '伊芙' })
  const carol = await t.seed.user({ name: '卡罗尔', teamId: null })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  const teamB = await t.seed.team({ ownerId: carol.id, name: '团队B' })
  const groupA = await t.seed.group({ createdBy: eve.id, name: 'A 群', memberIds: [alice.id] })
  const groupB = await t.seed.group({ createdBy: carol.id, name: 'B 群', teamId: teamB.id })
  const teamA = groupA.teamId
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, bob.id))
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  return { alice, bob, eve, carol, root, teamA, teamB: teamB.id, groupA, groupB, as }
}

describe('MCP layers (plan D8)', () => {
  it('lets team admins edit the team layer and group admins the group layer, reserving gonggong', async () => {
    const w = await world()
    const [alice, bob, eve, carol] = await Promise.all([
      w.as(w.alice),
      w.as(w.bob),
      w.as(w.eve),
      w.as(w.carol),
    ])
    const teamUrl = `/api/teams/${w.teamA}/mcp`
    const groupUrl = `/api/groups/${w.groupA.id}/mcp`

    expect((await eve.post(teamUrl, { enabled: true, config: mcp('wiki') })).status).toBe(403)
    expect((await carol.get(teamUrl)).status).toBe(404)
    const made = await bob.post<McpServerDto>(teamUrl, { enabled: true, config: mcp('wiki') })
    expect(made.status).toBe(201)
    expect((await bob.post(teamUrl, { enabled: true, config: mcp('wiki') })).status).toBe(409)
    expect((await bob.post(teamUrl, { enabled: true, config: mcp('gonggong') })).status).toBe(400)
    expect((await eve.get<McpServerDto[]>(teamUrl)).status).toBe(403)

    expect((await alice.post(groupUrl, { enabled: true, config: mcp('jira') })).status).toBe(403)
    const g = await eve.post<McpServerDto>(groupUrl, { enabled: true, config: mcp('jira') })
    expect(g.status).toBe(201)
    expect((await eve.post(groupUrl, { enabled: true, config: mcp('gonggong') })).status).toBe(400)
    expect((await eve.get<McpServerDto[]>(groupUrl)).body.map((s) => s.config.name)).toEqual(['jira'])
    expect(
      (await eve.patch(`${groupUrl}/${made.body.id}`, { enabled: false, config: mcp('x') })).status,
    ).toBe(404)
    expect(
      (await eve.patch<McpServerDto>(`${groupUrl}/${g.body.id}`, { enabled: false, config: mcp('jira') }))
        .body.enabled,
    ).toBe(false)
    expect((await eve.del(`${groupUrl}/${g.body.id}`)).status).toBe(204)
    expect((await bob.del(`${teamUrl}/${made.body.id}`)).status).toBe(204)

    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.teamId, w.teamA))
    expect(log.map((l) => l.action)).toEqual([
      'mcp.create',
      'mcp.create',
      'mcp.update',
      'mcp.delete',
      'mcp.delete',
    ])
    // Platform list stays empty: the layers do not leak into each other.
    expect((await (await w.as(w.root)).get<McpServerDto[]>('/api/admin/mcp')).body).toEqual([])
  })

  it('merges enabled servers at session creation: group over team over platform by name', async () => {
    const w = await world()
    const root = await w.as(w.root)
    await root.post('/api/admin/mcp', { enabled: true, config: mcp('wiki', 'https://platform/wiki') })
    await root.post('/api/admin/mcp', { enabled: true, config: mcp('docs', 'https://platform/docs') })
    await root.post('/api/admin/mcp', { enabled: true, config: mcp('jira', 'https://platform/jira') })
    const bob = await w.as(w.bob)
    await bob.post(`/api/teams/${w.teamA}/mcp`, { enabled: true, config: mcp('wiki', 'https://team/wiki') })
    await bob.post(`/api/teams/${w.teamA}/mcp`, { enabled: true, config: mcp('docs', 'https://team/docs') })
    await bob.post(`/api/teams/${w.teamA}/mcp`, { enabled: false, config: mcp('jira', 'https://team/jira') })
    const eve = await w.as(w.eve)
    await eve.post(`/api/groups/${w.groupA.id}/mcp`, {
      enabled: true,
      config: mcp('docs', 'https://group/docs'),
    })

    const urls = async (groupId: string) =>
      Object.fromEntries(
        (await enabledMcpServers(t.db, groupId)).map((s) => [s.name, s.transport === 'http' ? s.url : '']),
      )
    expect(await urls(w.groupA.id)).toEqual({
      docs: 'https://group/docs',
      jira: 'https://platform/jira',
      wiki: 'https://team/wiki',
    })
    expect(await urls(w.groupB.id)).toEqual({
      docs: 'https://platform/docs',
      jira: 'https://platform/jira',
      wiki: 'https://platform/wiki',
    })
  })
})

describe('params layers (plan D9)', () => {
  it('applies platform → team → group, team overrides limited to the whitelist', async () => {
    const w = await world()
    await saveSysParams(t.ctx, { chainMaxHops: 5, contextInlineMax: 30, attachmentMaxMb: 20 }, w.root.id)
    const bob = await w.as(w.bob)
    expect((await bob.patch(`/api/teams/${w.teamA}`, { params: { attachmentMaxMb: 1 } })).status).toBe(400)
    expect((await bob.patch(`/api/teams/${w.teamA}`, { params: { chainMaxHops: 99 } })).status).toBe(400)
    expect((await (await w.as(w.eve)).patch(`/api/teams/${w.teamA}`, { params: {} })).status).toBe(403)
    expect(
      (await bob.patch(`/api/teams/${w.teamA}`, { params: { chainMaxHops: 2, contextInlineMax: 8 } })).status,
    ).toBe(200)
    expect((await bob.get<TeamParamsDto>(`/api/teams/${w.teamA}/params`)).body).toMatchObject({
      overrides: { chainMaxHops: 2, contextInlineMax: 8 },
      platform: { chainMaxHops: 5, contextInlineMax: 30, approvalTimeoutMin: 30 },
    })

    const groupA = (await t.db.select().from(groups).where(eq(groups.id, w.groupA.id)))[0]!
    expect((await groupParams(t.ctx, groupA)).chainMaxHops).toBe(2)
    expect(
      (await groupParams(t.ctx, (await t.db.select().from(groups).where(eq(groups.id, w.groupB.id)))[0]!))
        .chainMaxHops,
    ).toBe(5)
    const eff = await effectiveParams(t.db, w.groupA.id)
    expect([eff.contextInlineMax, eff.attachmentMaxMb, eff.chainMaxHops]).toEqual([8, 20, 2])

    await (await w.as(w.eve)).put(`/api/groups/${w.groupA.id}/params`, {
      approvalTimeoutMin: 30,
      chainMaxHops: 1,
      offlineWaitMin: 10,
    })
    expect((await effectiveParams(t.db, w.groupA.id)).chainMaxHops).toBe(1)

    // Clearing the overrides falls back to the platform.
    await bob.patch(`/api/teams/${w.teamA}`, { params: {} })
    expect((await effectiveParams(t.db, w.groupB.id)).contextInlineMax).toBe(30)
    expect((await effectiveParams(t.db, w.groupA.id)).contextInlineMax).toBe(30)
  })

  it('enforces the team’s attachmentsPerMessage when a message claims its files', async () => {
    const w = await world()
    await (await w.as(w.bob)).patch(`/api/teams/${w.teamA}`, { params: { attachmentsPerMessage: 1 } })
    const ids = [crypto.randomUUID(), crypto.randomUUID()]
    await expect(
      t.db.transaction((tx) =>
        claimAttachments(tx, ids, {
          uploaderId: w.eve.id,
          groupId: w.groupA.id,
          messageId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow('每条消息最多 1 个附件')
  })
})

describe('team management in 团队设置', () => {
  it('lists the team’s groups and shows the team’s usage and audit to admins only', async () => {
    const w = await world()
    const [bob, eve] = await Promise.all([w.as(w.bob), w.as(w.eve)])
    expect((await eve.get(`/api/teams/${w.teamA}/groups`)).status).toBe(403)
    const list = (await bob.get<TeamGroupDto[]>(`/api/teams/${w.teamA}/groups`)).body
    expect(list.map((g) => [g.name, g.memberNames.sort(), g.joined])).toEqual([
      ['A 群', ['伊芙', '爱丽丝'].sort(), false],
    ])
    expect(
      (await (await w.as(w.alice)).get<TeamGroupDto[]>(`/api/teams/${w.teamA}/groups`)).body[0]!.joined,
    ).toBe(true)

    // Plan D19: archiving is the group admins' call, not the team admins'.
    expect((await bob.post(`/api/teams/${w.teamA}/groups/${w.groupA.id}/archive`)).status).toBe(404)
    expect((await t.db.select().from(groups).where(eq(groups.id, w.groupA.id)))[0]!.archivedAt).toBeNull()

    const bot = await t.seed.bot({ ownerId: w.eve.id, name: '伊芙的 Bot' })
    const group = await t.seed.group({ createdBy: w.eve.id, botIds: [bot.id] })
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: w.eve.id, body: 'hi' })
      .returning()
    await t.db.insert(runs).values({
      groupId: group.id,
      botId: bot.id,
      triggerMessageId: m!.id,
      originUserId: w.eve.id,
      status: 'completed',
      startedAt: new Date(),
      usage: { totalTokens: 120 },
    })
    expect((await (await w.as(w.alice)).get<UsageRowDto[]>('/api/usage?by=bot')).body).toEqual([])
    expect((await eve.get(`/api/usage?by=bot&teamId=${w.teamA}`)).status).toBe(403)
    expect((await bob.get<UsageRowDto[]>(`/api/usage?by=bot&teamId=${w.teamA}`)).body).toMatchObject([
      { name: '伊芙的 Bot', totalTokens: 120 },
    ])

    expect((await eve.get(`/api/teams/${w.teamA}/audit`)).status).toBe(403)
    const trail = (await bob.get<AuditDto[]>(`/api/teams/${w.teamA}/audit`)).body
    expect(trail).toEqual([])
  })
})

describe('team admins and groups they are not in (plan D19)', () => {
  it('lets team admins read a group of their team, never write to it', async () => {
    const w = await world()
    const [bob, carol] = await Promise.all([w.as(w.bob), w.as(w.carol)])
    const bot = await t.seed.bot({ ownerId: w.eve.id, name: '伊芙的 Bot' })
    await (await w.as(w.eve)).post(`/api/groups/${w.groupA.id}/bots`, { botId: bot.id })
    const [sent] = await t.db
      .insert(messages)
      .values({ groupId: w.groupA.id, kind: 'user', authorUserId: w.eve.id, body: '你好' })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: w.groupA.id,
        botId: bot.id,
        triggerMessageId: sent!.id,
        originUserId: w.eve.id,
        status: 'awaiting_approval',
      })
      .returning()
    const [approval] = await t.db
      .insert(approvals)
      .values({
        runId: run!.id,
        requestId: 'r1',
        title: 'rm',
        toolKind: 'execute',
        detail: 'rm -rf',
        options: [{ optionId: 'ok', name: '允许', kind: 'allow_once' }],
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()

    const info = await bob.get<GroupDto>(`/api/groups/${w.groupA.id}`)
    expect(info.status).toBe(200)
    expect(info.body).toMatchObject({ name: 'A 群', unread: 0, botIds: [bot.id] })
    expect(info.body.members.map((m) => m.name).sort()).toEqual(['伊芙', '爱丽丝'].sort())
    const tl = await bob.get<TimelineDto>(`/api/groups/${w.groupA.id}/timeline`)
    expect(tl.body.messages.map((m) => m.body)).toContain('你好')
    expect(tl.body.runs.map((r) => r.id)).toEqual([run!.id])
    // Not in their sidebar.
    expect((await bob.get<GroupDto[]>('/api/groups')).body.map((g) => g.id)).not.toContain(w.groupA.id)

    const writes = [
      bob.post(`/api/groups/${w.groupA.id}/messages`, { body: 'x', clientId: 'client-02' }),
      bob.put(`/api/messages/${sent!.id}/reactions/${encodeURIComponent('👍')}`),
      bob.post(`/api/groups/${w.groupA.id}/read`, {}),
      bob.patch(`/api/groups/${w.groupA.id}`, { name: '改名' }),
      bob.put(`/api/groups/${w.groupA.id}/prefs`, { pinned: true }),
      bob.post(`/api/groups/${w.groupA.id}/dissolve`),
      bob.post(`/api/groups/${w.groupA.id}/leave`),
    ]
    for (const res of await Promise.all(writes)) expect(res.status).toBe(404)
    expect(
      (await bob.post(`/api/runs/${run!.id}/approvals/${approval!.id}`, { optionId: 'ok' })).status,
    ).toBe(403)

    // Plain team members and other teams' admins see nothing.
    const plain = await t.seed.user({ name: '路人' })
    const others = [await w.as(plain), carol]
    for (const c of others) {
      expect((await c.get(`/api/groups/${w.groupA.id}`)).status).toBe(404)
      expect((await c.get(`/api/groups/${w.groupA.id}/timeline`)).status).toBe(404)
    }
  })

  it('never opens DMs or groups of an archived team', async () => {
    const w = await world()
    const bob = await w.as(w.bob)
    const dm = await t.seed.group({ createdBy: w.eve.id, kind: 'dm' })
    expect((await bob.get(`/api/groups/${dm.id}`)).status).toBe(404)
    expect((await bob.get(`/api/groups/${dm.id}/timeline`)).status).toBe(404)
    expect((await bob.post(`/api/teams/${w.teamA}/groups/${dm.id}/takeover`)).status).toBe(404)
    await t.db.update(teams).set({ archivedAt: new Date() }).where(eq(teams.id, w.teamA))
    expect((await bob.get(`/api/groups/${w.groupA.id}`)).status).toBe(404)
  })

  it('takes over: joins as group admin with an event, an audit row and the member events', async () => {
    const w = await world()
    const [bob, eve, alice] = await Promise.all([w.as(w.bob), w.as(w.eve), w.as(w.alice)])
    expect((await eve.post(`/api/teams/${w.teamA}/groups/${w.groupA.id}/takeover`)).status).toBe(403)
    expect((await bob.post(`/api/teams/${w.teamA}/groups/${w.groupB.id}/takeover`)).status).toBe(404)
    const events: WebEvent[] = []
    t.ctx.bus.attach(w.bob.id, (e) => events.push(e as WebEvent))

    const res = await bob.post<GroupDto>(`/api/teams/${w.teamA}/groups/${w.groupA.id}/takeover`)
    expect(res.status).toBe(200)
    expect(res.body.members.find((m) => m.userId === w.bob.id)).toMatchObject({ isAdmin: true })
    expect(events.some((e) => e.t === 'group.updated' && e.group.id === w.groupA.id)).toBe(true)
    expect((await bob.get<GroupDto[]>('/api/groups')).body.map((g) => g.id)).toContain(w.groupA.id)
    const tl = await bob.get<TimelineDto>(`/api/groups/${w.groupA.id}/timeline`)
    expect(tl.body.messages.at(-1)).toMatchObject({
      kind: 'event',
      body: '鲍勃 以团队管理员身份加入并成为群管理员',
    })
    expect((await bob.patch(`/api/groups/${w.groupA.id}`, { name: '改名' })).status).toBe(200)
    const trail = (await bob.get<AuditDto[]>(`/api/teams/${w.teamA}/audit`)).body
    expect(trail.map((a) => a.action)).toContain('group.takeover')
    const [row] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'group.takeover'))
    expect(row).toMatchObject({ teamId: w.teamA, groupId: w.groupA.id, actorUserId: w.bob.id })

    // Already a member: alice (team owner) is promoted in place.
    const promoted = await alice.post<GroupDto>(`/api/teams/${w.teamA}/groups/${w.groupA.id}/takeover`)
    expect(promoted.body.members.find((m) => m.userId === w.alice.id)).toMatchObject({ isAdmin: true })
    const last = (await alice.get<TimelineDto>(`/api/groups/${w.groupA.id}/timeline`)).body.messages.at(-1)
    expect(last?.body).toBe('爱丽丝 以团队管理员身份成为群管理员')
  })
})

describe('audit team_id', () => {
  it('derives the team from the group when not given; platform events stay teamless', async () => {
    const w = await world()
    await audit(t.ctx, { category: 'admin', actorUserId: w.eve.id, action: 'x.group', groupId: w.groupB.id })
    await audit(t.ctx, { category: 'admin', actorUserId: w.root.id, action: 'x.platform' })
    await (await w.as(w.eve)).put(`/api/groups/${w.groupA.id}/params`, {
      approvalTimeoutMin: 30,
      chainMaxHops: 1,
      offlineWaitMin: 10,
    })
    const rows = await t.db.select().from(auditLogs)
    expect(Object.fromEntries(rows.map((r) => [r.action, r.teamId]))).toEqual({
      'x.group': w.teamB,
      'x.platform': null,
      'group.params': w.teamA,
    })
  })
})

describe('archived teams (plan D15)', () => {
  it('does not dispatch the bots of an archived team', async () => {
    const w = await world()
    const { machine } = await t.seed.machine(w.eve.id)
    const bot = await t.seed.bot({ ownerId: w.eve.id, machineId: machine.id, binding: 'bound' })
    const group = await t.seed.group({ createdBy: w.eve.id, botIds: [bot.id] })
    const sent: ServerToDaemon[] = []
    t.ctx.hub.register(machine.id, { send: (m: ServerToDaemon) => void sent.push(m), close: () => {} })
    expect((await (await w.as(w.alice)).post(`/api/teams/${w.teamA}/archive`)).status).toBe(200)
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: w.eve.id, body: 'go' })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        originUserId: w.eve.id,
        status: 'queued',
      })
      .returning()

    await schedule(t.ctx, bot.id)

    expect(sent.filter((s): s is RunStart => s.t === 'run.start')).toEqual([])
    expect((await t.db.select().from(runs).where(eq(runs.id, run!.id)))[0]!.status).toBe('queued')
  })
})

describe('管理后台 · 团队', () => {
  it('lists, creates with a chosen owner, archives, restores and reassigns teams (sysadmin only)', async () => {
    const w = await world()
    const root = await w.as(w.root)
    expect((await (await w.as(w.alice)).get('/api/admin/teams')).status).toBe(403)
    const list = (await root.get<AdminTeamDto[]>('/api/admin/teams')).body
    expect(list.map((x) => [x.name, x.ownerName, x.members, x.archivedAt])).toEqual([
      ['默认团队', '爱丽丝', 3, null],
      ['团队B', '卡罗尔', 1, null],
    ])

    // Plan D11: no second live team while single-team mode is on.
    expect((await root.post('/api/admin/teams', { name: '新团队', ownerId: w.carol.id })).status).toBe(403)
    await saveSysParams(t.ctx, { singleTeamMode: false }, w.root.id)
    const made = await root.post<AdminTeamDto>('/api/admin/teams', { name: '新团队', ownerId: w.carol.id })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ name: '新团队', ownerName: '卡罗尔', members: 1 })
    expect((await (await w.as(w.carol)).get<MeDto>('/api/me')).body.teams.map((x) => x.name)).toContain(
      '新团队',
    )

    expect((await root.put(`/api/admin/teams/${made.body.id}/owner`, { userId: w.bob.id })).status).toBe(200)
    const roles = await t.db.select().from(teamMembers).where(eq(teamMembers.teamId, made.body.id))
    expect(Object.fromEntries(roles.map((r) => [r.userId, r.role]))).toEqual({
      [w.carol.id]: 'admin',
      [w.bob.id]: 'owner',
    })

    expect((await root.post(`/api/admin/teams/${made.body.id}/archive`)).status).toBe(200)
    expect((await t.db.select().from(teams).where(eq(teams.id, made.body.id)))[0]!.archivedAt).not.toBeNull()
    expect((await root.post(`/api/admin/teams/${made.body.id}/unarchive`)).status).toBe(200)
    expect((await t.db.select().from(teams).where(eq(teams.id, made.body.id)))[0]!.archivedAt).toBeNull()
    expect(
      (await t.db.select().from(auditLogs).where(eq(auditLogs.teamId, made.body.id))).map((l) => l.action),
    ).toEqual(['team.create', 'team.owner', 'team.archive', 'team.unarchive'])
  })

  it('filters groups, bots, usage and audit by team and shows each account’s teams', async () => {
    const w = await world()
    const root = await w.as(w.root)
    await t.seed.bot({ ownerId: w.carol.id, name: 'B 的 Bot', teamId: w.teamB })
    await t.seed.bot({ ownerId: w.eve.id, name: 'A 的 Bot' })
    const groupNames = async (q = '') =>
      (await root.get<AdminGroupDto[]>(`/api/admin/groups${q}`)).body
        .map((g) => `${g.teamName}/${g.name}`)
        .sort()
    expect(await groupNames()).toEqual(['团队B/B 群', '默认团队/A 群'])
    expect(await groupNames(`?teamId=${w.teamB}`)).toEqual(['团队B/B 群'])
    const botNames = async (q = '') =>
      (await root.get<BotDto[]>(`/api/admin/bots${q}`)).body.map((b) => b.name)
    expect((await botNames()).sort()).toEqual(['A 的 Bot', 'B 的 Bot'])
    expect(await botNames(`?teamId=${w.teamA}`)).toEqual(['A 的 Bot'])
    expect((await (await w.as(w.alice)).get('/api/admin/bots')).status).toBe(403)
    expect((await root.get<UsageRowDto[]>(`/api/admin/usage?by=bot&teamId=${w.teamB}`)).status).toBe(200)
    expect((await root.get(`/api/admin/usage/daily?teamId=${w.teamB}`)).status).toBe(200)

    await audit(t.ctx, { category: 'admin', actorUserId: w.root.id, action: 'in.b', teamId: w.teamB })
    await audit(t.ctx, { category: 'admin', actorUserId: w.root.id, action: 'in.a', teamId: w.teamA })
    expect(
      (await root.get<AuditDto[]>(`/api/admin/audit?teamId=${w.teamB}`)).body.map((a) => a.action),
    ).toEqual(['in.b'])

    const users = (await root.get<AdminUserDto[]>('/api/admin/users')).body
    expect(Object.fromEntries(users.map((u) => [u.name, u.teams]))).toMatchObject({
      爱丽丝: ['默认团队'],
      卡罗尔: ['团队B'],
      根: [],
    })
  })

  it('shows and saves single-team mode and team creation, refusing single-team mode unless exactly one live team exists', async () => {
    const w = await world()
    const root = await w.as(w.root)
    expect(
      (await root.put<SystemParams>('/api/admin/params', { singleTeamMode: false })).body.singleTeamMode,
    ).toBe(false)
    const refused = await root.put<{ error: string; message: string }>('/api/admin/params', {
      singleTeamMode: true,
    })
    expect(refused.status).toBe(409)
    expect(refused.body.message).toBe('仅在恰好有一个未归档团队时才能开启单团队模式（当前 2 个）')

    await (await w.as(w.carol)).post(`/api/teams/${w.teamB}/archive`)
    expect(
      (await root.put<SystemParams>('/api/admin/params', { singleTeamMode: true })).body.singleTeamMode,
    ).toBe(true)

    // Takes effect at once, without a restart.
    await saveSysParams(t.ctx, { singleTeamMode: false }, w.root.id)
    const alice = await w.as(w.alice)
    expect((await alice.get<MeDto>('/api/me')).body.canCreateTeam).toBe(false)
    await root.put('/api/admin/params', { teamCreation: 'all' })
    expect((await alice.get<MeDto>('/api/me')).body.canCreateTeam).toBe(true)
    expect((await alice.post('/api/teams', { name: '自建团队' })).status).toBe(201)
  })
})

describe('sign-up routing (T3)', () => {
  it('joins the default team in single-team mode; otherwise the new account has no team', async () => {
    await world()
    const root = (await t.db.select().from(teams))[0]!
    await t.db.update(teams).set({ archivedAt: new Date() }).where(eq(teams.name, '团队B'))
    await saveSysParams(t.ctx, { registrationOpen: true }, root.createdBy)
    const register = async (account: string) =>
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/auth/register',
          payload: { account, name: account, password: 'password123' },
        })
      ).json<MeDto>()
    expect((await register('solo')).teams.map((x) => x.name)).toEqual(['默认团队'])
    await saveSysParams(t.ctx, { singleTeamMode: false }, root.createdBy)
    expect((await register('free')).teams).toEqual([])
  })
})
