import type { TeamRole } from '@gonggong/protocol'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groups, teamMembers, teams, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'

/** Picks the team of list and create endpoints (plan D7); everything else derives it from the resource. */
export const TEAM_HEADER = 'x-gg-team'

const RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 }
const NOT_MEMBER = '团队不存在或你不是该团队成员'

/** `userId`'s membership of a live team; sysadmins are not implicitly members (plan D3). */
export async function requireTeam(ctx: Ctx, userId: string, teamId: string, minRole: TeamRole = 'member') {
  if (!isUuid(teamId)) return fail('not_found', NOT_MEMBER)
  const [row] = await ctx.db
    .select({ team: teams, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId), isNull(teams.archivedAt)))
  if (!row) return fail('not_found', NOT_MEMBER)
  if (RANK[row.role as TeamRole] < RANK[minRole])
    return fail('forbidden', minRole === 'owner' ? '仅团队所有者可操作' : '仅团队管理员可操作')
  return row
}

/** The `X-GG-Team` team, else the caller's earliest-joined live team. */
export async function currentTeam(ctx: Ctx, req: FastifyRequest, userId: string) {
  const picked = req.headers[TEAM_HEADER]
  if (typeof picked === 'string' && picked) return (await requireTeam(ctx, userId, picked)).team.id
  const [row] = await ctx.db
    .select({ id: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), isNull(teams.archivedAt)))
    .orderBy(asc(teamMembers.joinedAt), asc(teamMembers.teamId))
    .limit(1)
  return row?.id ?? fail('forbidden', '你还没有加入任何团队')
}

export async function teamOfGroup(ctx: Ctx, groupId: string) {
  const [row] = await ctx.db.select({ teamId: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  return row?.teamId ?? fail('not_found', '群不存在')
}

export async function teamOfBot(ctx: Ctx, botId: string) {
  const [row] = await ctx.db.select({ teamId: bots.teamId }).from(bots).where(eq(bots.id, botId))
  return row?.teamId ?? fail('not_found', 'Bot 不存在')
}

/** Enabled accounts in the team. */
export async function teamUserIds(ctx: Ctx, teamId: string) {
  const rows = await ctx.db
    .select({ id: users.id })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), isNull(users.disabledAt)))
  return rows.map((r) => r.id)
}

export async function createTeam(db: Pick<Db, 'insert'>, name: string, ownerId: string) {
  const [team] = (await db.insert(teams).values({ name, createdBy: ownerId }).returning()) as [
    typeof teams.$inferSelect,
  ]
  await db.insert(teamMembers).values({ teamId: team.id, userId: ownerId, role: 'owner' })
  return team
}
