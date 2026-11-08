import {
  type DirectoryGroupDto,
  GroupTeamSectionReq,
  SidebarSectionOrderReq,
  SidebarSectionReq,
  type TeamSectionsDto,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, isNotNull, isNull, max, notExists, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupJoinRequests, groupMembers, groups, teamMembers, teamSections, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { groupDto, publishGroup, requireMember } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { currentTeam, requireTeam } from '../teams/service.js'
import { avatarUrl } from '../users/dto.js'
import { cancelJoinRequests } from './join-requests.js'

type Params = { Params: { id: string } }

const isTeamAdmin = (role: string) => role !== 'member'

async function sectionsOf(ctx: Ctx, teamId: string) {
  return ctx.db
    .select({ id: teamSections.id, name: teamSections.name })
    .from(teamSections)
    .where(eq(teamSections.teamId, teamId))
    .orderBy(asc(teamSections.position), asc(teamSections.createdAt))
}

async function requireTeamSection(ctx: Ctx, teamId: string, id: string) {
  const [row] = isUuid(id)
    ? await ctx.db
        .select()
        .from(teamSections)
        .where(and(eq(teamSections.id, id), eq(teamSections.teamId, teamId)))
    : []
  return row ?? fail('not_found', '团队分区不存在')
}

/** Everyone in the team sees the directory change. */
export async function publishDirectory(ctx: Ctx, teamId: string) {
  const rows = await ctx.db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
  ctx.bus.publish(
    rows.map((r) => r.userId),
    { t: 'directory.changed' },
  )
}

/** Groups filed under a 团队分区 of `teamId` that `userId` is not in, or just `groupId`. */
export async function directory(ctx: Ctx, userId: string, teamId: string, groupId?: string) {
  const mine = ctx.db
    .select({ one: sql`1` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
  const rows = await ctx.db
    .select({
      id: groups.id,
      name: groups.name,
      avatar: groups.avatar,
      notice: groups.notice,
      visibility: groups.visibility,
      teamSectionId: groups.teamSectionId,
      memberCount: sql<number>`(select count(*)::int from ${groupMembers} where ${groupMembers.groupId} = ${groups.id})`,
    })
    .from(groups)
    .where(
      and(
        eq(groups.teamId, teamId),
        eq(groups.kind, 'group'),
        isNull(groups.archivedAt),
        isNotNull(groups.teamSectionId),
        notExists(mine),
        groupId ? eq(groups.id, groupId) : undefined,
      ),
    )
    .orderBy(asc(groups.name))
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const admins = await ctx.db
    .select({ groupId: groupMembers.groupId, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(inArray(groupMembers.groupId, ids), eq(groupMembers.isAdmin, true)))
  const requests = await ctx.db
    .select({ id: groupJoinRequests.id, groupId: groupJoinRequests.groupId })
    .from(groupJoinRequests)
    .where(
      and(
        inArray(groupJoinRequests.groupId, ids),
        eq(groupJoinRequests.userId, userId),
        eq(groupJoinRequests.status, 'pending'),
      ),
    )
  return rows.map(
    (r): DirectoryGroupDto => ({
      ...r,
      avatar: avatarUrl(r.avatar),
      visibility: r.visibility as DirectoryGroupDto['visibility'],
      teamSectionId: r.teamSectionId as string,
      admins: admins.filter((a) => a.groupId === r.id).map((a) => a.name),
      requestId: requests.find((q) => q.groupId === r.id)?.id ?? null,
    }),
  )
}

/** 团队分区: team admins set them; group admins (and team admins) file their groups under them. */
export function teamSectionRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/team-sections', async (req): Promise<TeamSectionsDto> => {
      const me = await requireUser(ctx, req)
      const { team, role } = await requireTeam(ctx, me.id, await currentTeam(ctx, req, me.id))
      return { sections: await sectionsOf(ctx, team.id), canManage: isTeamAdmin(role) }
    })

    app.post('/api/team-sections', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, await currentTeam(ctx, req, me.id), 'admin')
      const { name } = SidebarSectionReq.parse(req.body)
      const [last] = await ctx.db
        .select({ position: max(teamSections.position) })
        .from(teamSections)
        .where(eq(teamSections.teamId, team.id))
      const [row] = await ctx.db
        .insert(teamSections)
        .values({ teamId: team.id, name, position: (last?.position ?? -1) + 1, createdBy: me.id })
        .returning({ id: teamSections.id, name: teamSections.name })
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        teamId: team.id,
        action: 'team.section.create',
        detail: { name },
      })
      await publishDirectory(ctx, team.id)
      return row!
    })

    app.patch<Params>('/api/team-sections/:id', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, await currentTeam(ctx, req, me.id), 'admin')
      const sec = await requireTeamSection(ctx, team.id, req.params.id)
      const { name } = SidebarSectionReq.parse(req.body)
      await ctx.db.update(teamSections).set({ name }).where(eq(teamSections.id, sec.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        teamId: team.id,
        action: 'team.section.rename',
        detail: { before: sec.name, name },
      })
      await publishDirectory(ctx, team.id)
      return { id: sec.id, name }
    })

    app.put('/api/team-sections/order', async (req) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, await currentTeam(ctx, req, me.id), 'admin')
      const { ids } = SidebarSectionOrderReq.parse(req.body)
      const all = await sectionsOf(ctx, team.id)
      if (ids.length !== all.length || !all.every((s) => ids.includes(s.id)))
        return fail('conflict', '分区已变化，请刷新后重试')
      await ctx.db.transaction(async (tx) => {
        for (const [position, id] of ids.entries())
          await tx.update(teamSections).set({ position }).where(eq(teamSections.id, id))
      })
      await publishDirectory(ctx, team.id)
      return sectionsOf(ctx, team.id)
    })

    app.delete<Params>('/api/team-sections/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, await currentTeam(ctx, req, me.id), 'admin')
      const sec = await requireTeamSection(ctx, team.id, req.params.id)
      const filed = await ctx.db
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.teamSectionId, sec.id))
      await ctx.db.delete(teamSections).where(eq(teamSections.id, sec.id))
      for (const g of filed) await cancelJoinRequests(ctx, g.id)
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        teamId: team.id,
        action: 'team.section.delete',
        detail: { name: sec.name },
      })
      for (const g of filed) await publishGroup(ctx, g.id)
      await publishDirectory(ctx, team.id)
      return reply.status(204).send()
    })

    app.put<Params>('/api/groups/:id/team-section', async (req) => {
      const me = await requireUser(ctx, req)
      const { group, member } = await requireMember(ctx, req.params.id, me.id)
      const { role } = await requireTeam(ctx, me.id, group.teamId)
      if (!member.isAdmin && !isTeamAdmin(role)) return fail('forbidden', '仅群管理员或团队管理员可操作')
      if (group.kind === 'dm') return fail('invalid', '私聊不能归入团队分区')
      const { teamSectionId } = GroupTeamSectionReq.parse(req.body)
      const sec = teamSectionId ? await requireTeamSection(ctx, group.teamId, teamSectionId) : null
      if ((sec?.id ?? null) === group.teamSectionId) return groupDto(ctx, me.id, group.id)
      await ctx.db
        .update(groups)
        .set({ teamSectionId: sec?.id ?? null })
        .where(eq(groups.id, group.id))
      if (!sec) await cancelJoinRequests(ctx, group.id)
      await postEvent(
        ctx,
        group.id,
        sec ? '{user} 将本群归入团队分区「{section}」' : '{user} 将本群移出团队分区',
        sec ? { user: me.name, section: sec.name } : { user: me.name },
      )
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        groupId: group.id,
        action: 'group.team_section',
        detail: { name: group.name, section: sec?.name ?? null },
      })
      await publishGroup(ctx, group.id)
      await publishDirectory(ctx, group.teamId)
      return groupDto(ctx, me.id, group.id)
    })

    app.get('/api/team-directory', async (req) => {
      const me = await requireUser(ctx, req)
      return directory(ctx, me.id, await currentTeam(ctx, req, me.id))
    })

    /** What someone outside the group sees when they open it from a 团队分区. */
    app.get<Params>('/api/groups/:id/preview', async (req): Promise<DirectoryGroupDto> => {
      const me = await requireUser(ctx, req)
      const [g] = isUuid(req.params.id)
        ? await ctx.db.select({ teamId: groups.teamId }).from(groups).where(eq(groups.id, req.params.id))
        : []
      if (!g) return fail('not_found', '群不存在或未归入团队分区')
      await requireTeam(ctx, me.id, g.teamId)
      const [dto] = await directory(ctx, me.id, g.teamId, req.params.id)
      return dto ?? fail('not_found', '群不存在或未归入团队分区')
    })
  }
}
