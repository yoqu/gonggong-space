import {
  AddTeamMemberReq,
  AuditQuery,
  type CreatedTeamInviteDto,
  CreateTeamInviteReq,
  CreateTeamReq,
  type InvitePreviewDto,
  TEAM_PARAM_KEYS,
  type TeamGroupDto,
  type TeamMemberDto,
  type TeamParamsDto,
  TransferTeamReq,
  UpdateTeamMemberReq,
  UpdateTeamReq,
} from '@gonggong/protocol'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupMembers, groups, teamInvites, teamMembers, teams, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { newToken, sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { listAudit } from '../admin/audit.js'
import { adminGroupDtos } from '../admin/groups.js'
import { assertNotDemo, sysParams } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { forgetTeamParams, teamOverrides } from '../groups/params.js'
import { groupDto, publishGroup } from '../groups/service.js'
import { forgetMembers, postEvent } from '../messages/service.js'
import { inviteDto, memberDtos, myTeam, myTeams, publishMember, publishTeam } from './dto.js'
import { acceptInvite, archiveTeam, findInvite, removeFromTeam } from './members.js'
import { createTeam, requireTeam } from './service.js'

type P = { Params: { id: string } }
type PU = { Params: { id: string; userId: string } }
type PI = { Params: { id: string; inviteId: string } }
type PT = { Params: { token: string } }
type PG = { Params: { id: string; groupId: string } }

const DAY_MS = 86_400_000

export function teamRoutes(ctx: Ctx) {
  const auditTeam = (actorUserId: string, teamId: string, action: string, detail: Record<string, unknown>) =>
    audit(ctx, { category: 'admin', actorUserId, teamId, action, detail })

  /** The member row of `userId`, not_found when they are not in the team. */
  const memberOf = async (teamId: string, userId: string) =>
    (await memberDtos(ctx, teamId, userId))[0] ?? fail('not_found', '该用户不在团队内')

  const owners = async (teamId: string) =>
    (await memberDtos(ctx, teamId)).filter((m) => m.role === 'owner').length

  return async (app: FastifyInstance) => {
    app.get('/api/teams', async (req) => myTeams(ctx, (await requireUser(ctx, req)).id))

    app.post('/api/teams', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const params = await sysParams(ctx.db)
      if (params.singleTeamMode) return fail('forbidden', '单团队模式下不能新建团队')
      if (params.teamCreation === 'sysadmin' && me.role !== 'sysadmin')
        return fail('forbidden', '仅系统管理员可新建团队')
      const { name } = CreateTeamReq.parse(req.body)
      const team = await ctx.db.transaction((tx) => createTeam(tx, name, me.id))
      await auditTeam(me.id, team.id, 'team.create', { name })
      return reply.status(201).send(await myTeam(ctx, me.id, team.id))
    })

    app.patch<P>('/api/teams/:id', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const patch = UpdateTeamReq.parse(req.body)
      if (!Object.keys(patch).length) return myTeam(ctx, me.id, team.id)
      await ctx.db
        .update(teams)
        .set({ ...patch, avatar: patch.avatar === undefined ? undefined : patch.avatar || null })
        .where(eq(teams.id, team.id))
      forgetTeamParams(ctx.db, team.id)
      await auditTeam(me.id, team.id, 'team.update', patch)
      await publishTeam(ctx, team.id)
      return myTeam(ctx, me.id, team.id)
    })

    app.get<P>('/api/teams/:id/params', async (req): Promise<TeamParamsDto> => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const platform = await sysParams(ctx.db)
      return {
        overrides: teamOverrides(team.params),
        platform: Object.fromEntries(
          TEAM_PARAM_KEYS.map((k) => [k, platform[k]]),
        ) as TeamParamsDto['platform'],
      }
    })

    app.get<P>('/api/teams/:id/groups', async (req): Promise<TeamGroupDto[]> => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const list = await adminGroupDtos(ctx, and(eq(groups.teamId, team.id), eq(groups.kind, 'group')))
      const names = list.length
        ? await ctx.db
            .select({ groupId: groupMembers.groupId, userId: groupMembers.userId, name: users.name })
            .from(groupMembers)
            .innerJoin(users, eq(users.id, groupMembers.userId))
            .where(
              inArray(
                groupMembers.groupId,
                list.map((g) => g.id),
              ),
            )
            .orderBy(asc(groupMembers.joinedAt))
        : []
      return list.map((g) => ({
        ...g,
        memberNames: names.filter((n) => n.groupId === g.id).map((n) => n.name),
        joined: names.some((n) => n.groupId === g.id && n.userId === me.id),
      }))
    })

    // Plan D19: only group admins manage a group; a team admin joins as one first.
    app.post<PG>('/api/teams/:id/groups/:groupId/takeover', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const [row] = await ctx.db
        .select({ group: groups, member: groupMembers })
        .from(groups)
        .leftJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, me.id)))
        .where(
          and(
            eq(groups.id, idParam(req.params.groupId, '群不存在')),
            eq(groups.teamId, team.id),
            eq(groups.kind, 'group'),
            isNull(groups.archivedAt),
          ),
        )
      if (!row) return fail('not_found', '群不存在')
      const { group, member } = row
      if (member?.isAdmin) return groupDto(ctx, me.id, group.id)
      await ctx.db
        .insert(groupMembers)
        .values({ groupId: group.id, userId: me.id, isAdmin: true })
        .onConflictDoUpdate({ target: [groupMembers.groupId, groupMembers.userId], set: { isAdmin: true } })
      forgetMembers(group.id)
      await postEvent(
        ctx,
        group.id,
        member ? '{user} 以团队管理员身份成为群管理员' : '{user} 以团队管理员身份加入并成为群管理员',
        { user: me.name },
      )
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        teamId: team.id,
        groupId: group.id,
        action: 'group.takeover',
        detail: { name: group.name, joined: !member },
      })
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.get<P>('/api/teams/:id/audit', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      return listAudit(ctx, { ...AuditQuery.parse(req.query), teamId: team.id })
    })

    // Plan D15: the team and its groups go read-only (requireTeam / requireMember refuse archived teams).
    app.post<P>('/api/teams/:id/archive', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'owner')
      await assertNotDemo(ctx, me)
      await archiveTeam(ctx, team, me)
      return { ok: true }
    })

    app.get<P>('/api/teams/:id/members', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id)
      return memberDtos(ctx, team.id)
    })

    app.post<P>('/api/teams/:id/members', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const { team, role: myRole } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const body = AddTeamMemberReq.parse(req.body)
      if (body.role === 'owner' && myRole !== 'owner') return fail('forbidden', '仅团队所有者可操作')
      const [user] = await ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.account, body.account), isNull(users.disabledAt)))
      if (!user) return fail('not_found', '账号不存在')
      const [added] = await ctx.db
        .insert(teamMembers)
        .values({ teamId: team.id, userId: user.id, role: body.role })
        .onConflictDoNothing()
        .returning()
      if (!added) return fail('conflict', '该账号已在团队内')
      await auditTeam(me.id, team.id, 'team.member.add', {
        userId: user.id,
        name: user.name,
        role: body.role,
      })
      await publishMember(ctx, team.id, user.id)
      return reply.status(201).send(await memberOf(team.id, user.id))
    })

    app.patch<PU>('/api/teams/:id/members/:userId', async (req): Promise<TeamMemberDto> => {
      const me = await requireUser(ctx, req)
      const { team, role: myRole } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const { role } = UpdateTeamMemberReq.parse(req.body)
      const target = await memberOf(team.id, idParam(req.params.userId, '该用户不在团队内'))
      if ((role === 'owner' || target.role === 'owner') && myRole !== 'owner')
        return fail('forbidden', '仅团队所有者可操作')
      if (target.role === role) return target
      if (target.role === 'owner' && (await owners(team.id)) === 1)
        return fail('conflict', '团队至少需要一名所有者，请先转让')
      await ctx.db
        .update(teamMembers)
        .set({ role })
        .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, target.userId)))
      await auditTeam(me.id, team.id, 'team.member.role', { userId: target.userId, name: target.name, role })
      await publishMember(ctx, team.id, target.userId)
      return memberOf(team.id, target.userId)
    })

    // An admin removes someone; anyone may remove themselves (leave).
    app.delete<PU>('/api/teams/:id/members/:userId', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const self = req.params.userId === me.id
      const { team, role: myRole } = await requireTeam(ctx, me.id, req.params.id, self ? 'member' : 'admin')
      if (!self) await assertNotDemo(ctx, me)
      const target = await memberOf(team.id, idParam(req.params.userId, '该用户不在团队内'))
      if (target.role === 'owner') {
        if (myRole !== 'owner') return fail('forbidden', '仅团队所有者可操作')
        if ((await owners(team.id)) === 1) return fail('conflict', '团队至少需要一名所有者，请先转让')
      }
      await removeFromTeam(ctx, team.id, { id: target.userId, name: target.name }, me)
      return reply.status(204).send()
    })

    app.post<P>('/api/teams/:id/transfer', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'owner')
      const { userId } = TransferTeamReq.parse(req.body)
      const target = await memberOf(team.id, idParam(userId, '该用户不在团队内'))
      if (target.userId === me.id) return fail('invalid', '不能转让给自己')
      await ctx.db.transaction(async (tx) => {
        for (const [userId, role] of [
          [target.userId, 'owner'],
          [me.id, 'admin'],
        ] as const)
          await tx
            .update(teamMembers)
            .set({ role })
            .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)))
      })
      await auditTeam(me.id, team.id, 'team.transfer', { userId: target.userId, name: target.name })
      await publishMember(ctx, team.id, target.userId)
      await publishMember(ctx, team.id, me.id)
      return memberDtos(ctx, team.id)
    })

    app.get<P>('/api/teams/:id/invites', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const rows = await ctx.db
        .select()
        .from(teamInvites)
        .where(and(eq(teamInvites.teamId, team.id), isNull(teamInvites.revokedAt)))
        .orderBy(desc(teamInvites.createdAt))
      return rows.map(inviteDto)
    })

    app.post<P>('/api/teams/:id/invites', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const body = CreateTeamInviteReq.parse(req.body)
      const token = newToken('ggi')
      const [row] = (await ctx.db
        .insert(teamInvites)
        .values({
          teamId: team.id,
          tokenHash: sha256(token),
          role: body.role,
          maxUses: body.maxUses,
          expiresAt: new Date(ctx.now().getTime() + body.expiresInDays * DAY_MS),
          createdBy: me.id,
        })
        .returning()) as [typeof teamInvites.$inferSelect]
      await auditTeam(me.id, team.id, 'team.invite.create', { inviteId: row.id, ...body })
      const created: CreatedTeamInviteDto = { invite: inviteDto(row), token }
      return reply.status(201).send(created)
    })

    app.delete<PI>('/api/teams/:id/invites/:inviteId', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id, 'admin')
      const [row] = await ctx.db
        .update(teamInvites)
        .set({ revokedAt: ctx.now() })
        .where(
          and(
            eq(teamInvites.id, idParam(req.params.inviteId, '邀请链接无效')),
            eq(teamInvites.teamId, team.id),
            isNull(teamInvites.revokedAt),
          ),
        )
        .returning({ id: teamInvites.id })
      if (!row) return fail('not_found', '邀请链接无效')
      await auditTeam(me.id, team.id, 'team.invite.revoke', { inviteId: row.id })
      return reply.status(204).send()
    })

    app.get<PT>('/api/invites/:token', async (req): Promise<InvitePreviewDto> => {
      const found = await findInvite(ctx, req.params.token)
      return { teamName: found.team.name, inviterName: found.inviterName, valid: found.usable }
    })

    app.post<PT>('/api/invites/:token/accept', async (req) => {
      const me = await requireUser(ctx, req)
      const found = await findInvite(ctx, req.params.token)
      await acceptInvite(ctx, found, me)
      return myTeam(ctx, me.id, found.team.id)
    })
  }
}
