import type {
  AuditDto,
  CreatedTeamInviteDto,
  GroupDto,
  InvitePreviewDto,
  MeDto,
  TeamDto,
  TeamInviteDto,
  TeamMemberDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, bots, groupBots, groupMembers, messages, teamInvites } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { notify } from '../src/modules/notifications/notify.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const as = async (u: { id: string }, teamId?: string) => client(t, await t.seed.cookie(u.id), teamId)

/** Team A: owner alice, admin bob, member eve. Team B: owner carol, member eve. */
async function world() {
  const alice = await t.seed.user({ name: '爱丽丝', account: 'alice' })
  const bob = await t.seed.user({ name: '鲍勃', account: 'bob' })
  const eve = await t.seed.user({ name: '伊芙', account: 'eve' })
  const carol = await t.seed.user({ name: '卡罗尔', account: 'carol', teamId: null })
  const teamB = await t.seed.team({ ownerId: carol.id, name: '团队B', memberIds: [eve.id] })
  const groupA = await t.seed.group({ createdBy: alice.id, name: 'A 群', memberIds: [bob.id, eve.id] })
  const teamA = groupA.teamId
  await (await as(alice)).patch(`/api/teams/${teamA}/members/${bob.id}`, { role: 'admin' })
  return { alice, bob, eve, carol, teamA, teamB: teamB.id, groupA }
}

describe('teams', () => {
  it('lists my live teams in /api/me and /api/teams with my role and unread counts', async () => {
    const w = await world()
    const eve = await as(w.eve)
    const me = (await eve.get<MeDto>('/api/me')).body
    expect(me.teams.map((x) => [x.name, x.role])).toEqual([
      ['默认团队', 'member'],
      ['团队B', 'member'],
    ])
    expect(me.singleTeamMode).toBe(true)
    expect(me.canCreateTeam).toBe(false)

    const groupB = await t.seed.group({ createdBy: w.carol.id, memberIds: [w.eve.id], teamId: w.teamB })
    await t.db
      .insert(messages)
      .values({ groupId: groupB.id, kind: 'user', authorUserId: w.carol.id, body: '在吗' })
    await notify(t.ctx, w.eve.id, 'chain_done', { groupId: groupB.id })
    const list = (await eve.get<TeamDto[]>('/api/teams')).body
    expect(list.find((x) => x.id === w.teamB)?.unread).toBe(2)
    expect(list.find((x) => x.id === w.teamA)?.unread).toBe(0)

    // 全部已读 in team A leaves team B's notifications alone.
    expect((await eve.post('/api/notifications/read-all')).status).toBe(204)
    const after = (await eve.get<TeamDto[]>('/api/teams')).body
    expect(after.find((x) => x.id === w.teamB)?.unread).toBe(2)
  })

  it('creates teams per teamCreation and refuses in single-team mode', async () => {
    const w = await world()
    const root = await t.seed.user({ role: 'sysadmin', teamId: null })
    const alice = await as(w.alice)
    expect((await alice.post('/api/teams', { name: '新团队' })).status).toBe(403)

    await saveSysParams(t.ctx, { singleTeamMode: false }, root.id)
    expect((await alice.post('/api/teams', { name: '新团队' })).status).toBe(403)
    const made = await (await as(root)).post<TeamDto>('/api/teams', { name: '平台团队' })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ name: '平台团队', role: 'owner' })

    await saveSysParams(t.ctx, { teamCreation: 'all' }, root.id)
    expect((await alice.get<MeDto>('/api/me')).body.canCreateTeam).toBe(true)
    const mine = await alice.post<TeamDto>('/api/teams', { name: '爱丽丝的团队' })
    expect(mine.status).toBe(201)
    expect((await alice.get<TeamDto[]>('/api/teams')).body.map((x) => x.name)).toContain('爱丽丝的团队')
  })

  it('lets admins rename, owners archive; members only read', async () => {
    const w = await world()
    const eve = await as(w.eve)
    expect((await eve.patch(`/api/teams/${w.teamA}`, { name: '改名' })).status).toBe(403)
    const seen = events(t, w.eve.id)
    const renamed = await (await as(w.bob)).patch<TeamDto>(`/api/teams/${w.teamA}`, {
      name: '改名',
      avatar: '🚀',
    })
    expect(renamed.body).toMatchObject({ name: '改名', avatar: '🚀', role: 'admin' })
    expect(seen).toContainEqual({
      t: 'team.updated',
      team: expect.objectContaining({ name: '改名', role: 'member' }),
    })
    expect((await eve.get<TeamMemberDto[]>(`/api/teams/${w.teamA}/members`)).body).toHaveLength(3)

    expect((await (await as(w.bob)).post(`/api/teams/${w.teamA}/archive`)).status).toBe(403)
    expect((await (await as(w.alice)).post(`/api/teams/${w.teamA}/archive`)).status).toBe(200)
    expect(seen).toContainEqual({ t: 'team.removed', teamId: w.teamA })
    expect((await eve.get<TeamDto[]>('/api/teams')).body.map((x) => x.id)).toEqual([w.teamB])
    expect((await eve.get(`/api/groups/${w.groupA.id}`)).status).toBe(404)
    const [row] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'team.archive'))
    expect(row?.teamId).toBe(w.teamA)
    const root = await t.seed.user({ role: 'sysadmin', teamId: null })
    const summaries = (await (await as(root)).get<AuditDto[]>('/api/admin/audit')).body.map((a) => a.summary)
    expect(summaries).toEqual(
      expect.arrayContaining(['归档团队 改名', '修改团队名称与头像', '将 鲍勃 的团队角色改为管理员']),
    )
  })
})

describe('team members', () => {
  it('adds an account directly; only owners grant owner', async () => {
    const w = await world()
    const zed = await t.seed.user({ name: '泽德', account: 'zed', teamId: null })
    const bob = await as(w.bob)
    const seen = events(t, w.eve.id)
    const joined = events(t, zed.id)
    expect((await bob.post(`/api/teams/${w.teamA}/members`, { account: 'zed', role: 'owner' })).status).toBe(
      403,
    )
    expect((await bob.post(`/api/teams/${w.teamA}/members`, { account: 'nobody' })).status).toBe(404)
    const added = await bob.post<TeamMemberDto>(`/api/teams/${w.teamA}/members`, { account: 'zed' })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({ userId: zed.id, role: 'member' })
    expect((await bob.post(`/api/teams/${w.teamA}/members`, { account: 'zed' })).status).toBe(409)
    expect(seen).toContainEqual({
      t: 'team.member_updated',
      teamId: w.teamA,
      member: expect.objectContaining({ userId: zed.id }),
    })
    expect(joined).toContainEqual({
      t: 'team.updated',
      team: expect.objectContaining({ id: w.teamA, role: 'member' }),
    })
    expect((await (await as(w.eve)).post(`/api/teams/${w.teamA}/members`, { account: 'carol' })).status).toBe(
      403,
    )
  })

  it('keeps at least one owner; only owners touch owners', async () => {
    const w = await world()
    const alice = await as(w.alice)
    const bob = await as(w.bob)
    expect((await bob.patch(`/api/teams/${w.teamA}/members/${w.eve.id}`, { role: 'owner' })).status).toBe(403)
    expect((await bob.patch(`/api/teams/${w.teamA}/members/${w.alice.id}`, { role: 'member' })).status).toBe(
      403,
    )
    expect((await bob.del(`/api/teams/${w.teamA}/members/${w.alice.id}`)).status).toBe(403)
    expect((await alice.patch(`/api/teams/${w.teamA}/members/${w.alice.id}`, { role: 'admin' })).status).toBe(
      409,
    )
    expect((await alice.del(`/api/teams/${w.teamA}/members/${w.alice.id}`)).status).toBe(409)

    const promoted = await alice.patch<TeamMemberDto>(`/api/teams/${w.teamA}/members/${w.eve.id}`, {
      role: 'owner',
    })
    expect(promoted.body.role).toBe('owner')
    expect(
      (await alice.patch(`/api/teams/${w.teamA}/members/${w.alice.id}`, { role: 'member' })).status,
    ).toBe(200)
  })

  it('transfers ownership: the target becomes owner, the owner an admin', async () => {
    const w = await world()
    expect(
      (await (await as(w.bob)).post(`/api/teams/${w.teamA}/transfer`, { userId: w.eve.id })).status,
    ).toBe(403)
    expect(
      (await (await as(w.alice)).post(`/api/teams/${w.teamA}/transfer`, { userId: w.carol.id })).status,
    ).toBe(404)
    const res = await (await as(w.alice)).post<TeamMemberDto[]>(`/api/teams/${w.teamA}/transfer`, {
      userId: w.eve.id,
    })
    expect(res.status).toBe(200)
    const roles = Object.fromEntries(res.body.map((m) => [m.name, m.role]))
    expect(roles).toEqual({ 爱丽丝: 'admin', 鲍勃: 'admin', 伊芙: 'owner' })
    expect((await (await as(w.alice)).del(`/api/teams/${w.teamA}/members/${w.alice.id}`)).status).toBe(204)
  })

  it('removing a member deletes their team bots, takes them out of team groups, leaves other teams intact', async () => {
    const w = await world()
    const eveBotA = await t.seed.bot({ ownerId: w.eve.id, name: '伊芙 A' })
    const eveBotB = await t.seed.bot({ ownerId: w.eve.id, name: '伊芙 B', teamId: w.teamB })
    await t.db.insert(groupBots).values({ groupId: w.groupA.id, botId: eveBotA.id })
    const groupB = await t.seed.group({
      createdBy: w.carol.id,
      memberIds: [w.eve.id],
      botIds: [eveBotB.id],
      teamId: w.teamB,
    })
    // eve is the only group admin of her own group in team A
    const eveGroup = await t.seed.group({ createdBy: w.eve.id, memberIds: [w.bob.id] })
    const eveSeen = events(t, w.eve.id)
    const bobSeen = events(t, w.bob.id)

    expect((await (await as(w.bob)).del(`/api/teams/${w.teamA}/members/${w.eve.id}`)).status).toBe(204)

    const [a] = await t.db.select().from(bots).where(eq(bots.id, eveBotA.id))
    expect(a?.deletedAt).not.toBeNull()
    const [gb] = await t.db.select().from(groupBots).where(eq(groupBots.botId, eveBotA.id))
    expect(gb?.removedAt).not.toBeNull()
    const memberships = await t.db.select().from(groupMembers).where(eq(groupMembers.userId, w.eve.id))
    expect(memberships.map((m) => m.groupId)).toEqual([groupB.id])
    const [b] = await t.db.select().from(bots).where(eq(bots.id, eveBotB.id))
    expect(b?.deletedAt).toBeNull()

    const [heir] = await t.db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, eveGroup.id), eq(groupMembers.userId, w.bob.id)))
    expect(heir?.isAdmin).toBe(true)
    const lines = (await t.db.select().from(messages).where(eq(messages.groupId, w.groupA.id))).map(
      (m) => m.body,
    )
    expect(lines).toContain('伊芙 A 被移出 · 工作区保留')
    expect(lines).toContain('伊芙 被移出团队')

    expect(eveSeen).toContainEqual({ t: 'team.removed', teamId: w.teamA })
    expect(eveSeen).toContainEqual({ t: 'group.removed', groupId: w.groupA.id })
    expect(bobSeen).toContainEqual({ t: 'team.member_removed', teamId: w.teamA, userId: w.eve.id })
    expect(bobSeen).toContainEqual({ t: 'bot.removed', botId: eveBotA.id })
    expect((await (await as(w.eve)).get<MeDto>('/api/me')).body.teams.map((x) => x.id)).toEqual([w.teamB])
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'team.member.remove'))
    expect(log?.teamId).toBe(w.teamA)
  })

  it('lets a member leave; the sole owner must transfer first', async () => {
    const w = await world()
    expect((await (await as(w.eve)).del(`/api/teams/${w.teamA}/members/${w.eve.id}`)).status).toBe(204)
    const groups = (await (await as(w.alice)).get<GroupDto[]>('/api/groups')).body
    expect(groups[0]?.members.map((m) => m.name)).toEqual(['爱丽丝', '鲍勃'])
    expect((await (await as(w.eve)).del(`/api/teams/${w.teamA}/members/${w.bob.id}`)).status).toBe(404)
    const sole = await (await as(w.carol)).del(`/api/teams/${w.teamB}/members/${w.carol.id}`)
    expect(sole.status).toBe(409)
  })
})

describe('team invites', () => {
  it('creates, previews, accepts, and stores only the token hash', async () => {
    const w = await world()
    const zed = await t.seed.user({ name: '泽德', account: 'zed', teamId: null })
    expect(
      (await (await as(w.eve)).post(`/api/teams/${w.teamA}/invites`, { expiresInDays: 7, maxUses: null }))
        .status,
    ).toBe(403)
    const made = await (await as(w.bob)).post<CreatedTeamInviteDto>(`/api/teams/${w.teamA}/invites`, {
      role: 'admin',
      expiresInDays: 7,
      maxUses: 2,
    })
    expect(made.status).toBe(201)
    const { token, invite } = made.body
    const [row] = await t.db.select().from(teamInvites).where(eq(teamInvites.id, invite.id))
    expect(row?.tokenHash).not.toContain(token)
    expect(JSON.stringify(row)).not.toContain(token)

    const preview = await t.app.inject({ method: 'GET', url: `/api/invites/${token}` })
    expect(preview.json<InvitePreviewDto>()).toEqual({
      teamName: '默认团队',
      inviterName: '鲍勃',
      valid: true,
    })
    expect((await t.app.inject({ method: 'GET', url: '/api/invites/nope' })).statusCode).toBe(404)

    const accepted = await (await as(zed)).post<TeamDto>(`/api/invites/${token}/accept`)
    expect(accepted.body).toMatchObject({ id: w.teamA, role: 'admin' })
    const again = await (await as(zed)).post<TeamDto>(`/api/invites/${token}/accept`)
    expect(again.status).toBe(200)
    const list = (await (await as(w.alice)).get<TeamInviteDto[]>(`/api/teams/${w.teamA}/invites`)).body
    expect(list[0]?.uses).toBe(1)
  })

  it('refuses expired, used-up and revoked invites', async () => {
    let now = new Date('2026-03-01T00:00:00Z')
    await t.close()
    t = await createTestApp({ now: () => now })
    const w = await world()
    const x1 = await t.seed.user({ account: 'x1', teamId: null })
    const x2 = await t.seed.user({ account: 'x2', teamId: null })
    const x3 = await t.seed.user({ account: 'x3', teamId: null })
    const alice = await as(w.alice)
    const once = (
      await alice.post<CreatedTeamInviteDto>(`/api/teams/${w.teamA}/invites`, {
        expiresInDays: 1,
        maxUses: 1,
      })
    ).body
    expect((await (await as(x1)).post(`/api/invites/${once.token}/accept`)).status).toBe(200)
    expect((await (await as(x2)).post(`/api/invites/${once.token}/accept`)).status).toBe(410)

    const timed = (
      await alice.post<CreatedTeamInviteDto>(`/api/teams/${w.teamA}/invites`, {
        expiresInDays: 1,
        maxUses: null,
      })
    ).body
    now = new Date('2026-03-02T00:00:01Z')
    expect((await (await as(x2)).post(`/api/invites/${timed.token}/accept`)).status).toBe(410)
    const preview = await t.app.inject({ method: 'GET', url: `/api/invites/${timed.token}` })
    expect(preview.json<InvitePreviewDto>().valid).toBe(false)

    const revoked = (
      await alice.post<CreatedTeamInviteDto>(`/api/teams/${w.teamA}/invites`, {
        expiresInDays: 7,
        maxUses: null,
      })
    ).body
    expect((await alice.del(`/api/teams/${w.teamA}/invites/${revoked.invite.id}`)).status).toBe(204)
    expect((await (await as(x3)).post(`/api/invites/${revoked.token}/accept`)).status).toBe(410)
  })

  it('allows signing up with a valid invite while registration is closed', async () => {
    const w = await world()
    const { token } = (
      await (
        await as(w.alice)
      ).post<CreatedTeamInviteDto>(`/api/teams/${w.teamA}/invites`, {
        expiresInDays: 7,
        maxUses: null,
      })
    ).body
    const signUp = (account: string, inviteToken?: string) =>
      t.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { account, name: account, password: 'password123', inviteToken },
      })
    expect((await signUp('closed')).statusCode).toBe(403)
    expect((await signUp('bad', 'ggi_nope')).statusCode).toBe(404)
    const res = await signUp('invited', token)
    expect(res.statusCode).toBe(201)
    expect(res.json<MeDto>().teams.map((x) => x.id)).toEqual([w.teamA])
  })
})
