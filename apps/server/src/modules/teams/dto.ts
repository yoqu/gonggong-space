import type { MeDto, TeamDto, TeamInviteDto, TeamMemberDto, TeamRole } from '@gonggong/protocol'
import { and, asc, count, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { notifications, type teamInvites, teamMembers, teams, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { unreadByTeam } from '../groups/service.js'
import { knownNotification } from '../notifications/notify.js'
import { toUserDto } from '../users/dto.js'
import { teamUserIds } from './service.js'

const teamDto = (team: typeof teams.$inferSelect, role: string, unread: number): TeamDto => ({
  id: team.id,
  name: team.name,
  avatar: team.avatar,
  role: role as TeamRole,
  archivedAt: team.archivedAt?.toISOString() ?? null,
  createdAt: team.createdAt.toISOString(),
  unread,
})

/** `userId`'s live teams matching `where`, earliest joined first (the order `currentTeam` falls back on). */
export async function myTeams(ctx: Ctx, userId: string, where?: SQL): Promise<TeamDto[]> {
  const [rows, messages, notes] = await Promise.all([
    ctx.db
      .select({ team: teams, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.userId, userId), isNull(teams.archivedAt), where))
      .orderBy(asc(teamMembers.joinedAt), asc(teamMembers.teamId)),
    unreadByTeam(ctx, userId),
    ctx.db
      .select({ teamId: notifications.teamId, n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          isNotNull(notifications.teamId),
          knownNotification,
        ),
      )
      .groupBy(notifications.teamId),
  ])
  return rows.map(({ team, role }) =>
    teamDto(team, role, (messages.get(team.id) ?? 0) + (notes.find((n) => n.teamId === team.id)?.n ?? 0)),
  )
}

export async function myTeam(ctx: Ctx, userId: string, teamId: string) {
  const [team] = await myTeams(ctx, userId, eq(teams.id, teamId))
  return team ?? fail('not_found', '团队不存在或你不是该团队成员')
}

export async function meDto(ctx: Ctx, user: typeof users.$inferSelect): Promise<MeDto> {
  const params = await sysParams(ctx.db)
  return {
    ...toUserDto(user),
    teams: await myTeams(ctx, user.id),
    singleTeamMode: params.singleTeamMode,
    canCreateTeam: !params.singleTeamMode && (params.teamCreation === 'all' || user.role === 'sysadmin'),
    demoMode: params.demoMode,
  }
}

/** Enabled members, earliest joined first; `userId` narrows to one. */
export async function memberDtos(ctx: Ctx, teamId: string, userId?: string): Promise<TeamMemberDto[]> {
  const rows = await ctx.db
    .select({ member: teamMembers, name: users.name, account: users.account })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        isNull(users.disabledAt),
        userId ? eq(teamMembers.userId, userId) : undefined,
      ),
    )
    .orderBy(asc(teamMembers.joinedAt), asc(teamMembers.userId))
  return rows.map(({ member, name, account }) => ({
    userId: member.userId,
    name,
    account,
    role: member.role as TeamRole,
    joinedAt: member.joinedAt.toISOString(),
  }))
}

export const inviteDto = (i: typeof teamInvites.$inferSelect): TeamInviteDto => ({
  id: i.id,
  teamId: i.teamId,
  role: i.role as TeamRole,
  maxUses: i.maxUses,
  uses: i.uses,
  expiresAt: i.expiresAt.toISOString(),
  createdBy: i.createdBy,
  revokedAt: i.revokedAt?.toISOString() ?? null,
  createdAt: i.createdAt.toISOString(),
})

/** Pushes each of `userIds` (default: every member) their own view of the team. */
export async function publishTeam(ctx: Ctx, teamId: string, userIds?: string[]) {
  for (const userId of userIds ?? (await teamUserIds(ctx, teamId)))
    ctx.bus.publish([userId], { t: 'team.updated', team: await myTeam(ctx, userId, teamId) })
}

/** Someone joined or changed role: members refresh the row, the member their team. */
export async function publishMember(ctx: Ctx, teamId: string, userId: string) {
  const [member] = await memberDtos(ctx, teamId, userId)
  if (member) ctx.bus.publish(await teamUserIds(ctx, teamId), { t: 'team.member_updated', teamId, member })
  await publishTeam(ctx, teamId, [userId])
}
