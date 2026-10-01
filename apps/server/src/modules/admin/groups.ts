import type { AdminGroupDto } from '@gonggong/protocol'
import { and, count, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupBots, groupMembers, groupRepos, groups, teams, users } from '../../db/schema.js'
import { groupTitle } from '../groups/title.js'

/** Rows of 管理后台 · 群 and 团队设置 · 群 matching `where`, archived ones included, newest first. */
export async function adminGroupDtos(ctx: Ctx, where?: SQL): Promise<AdminGroupDto[]> {
  const rows = await ctx.db
    .select({ g: groups, title: groupTitle, owner: users.name, teamName: teams.name })
    .from(groups)
    .innerJoin(teams, eq(teams.id, groups.teamId))
    .leftJoin(users, eq(users.id, groups.createdBy))
    .where(where)
    .orderBy(desc(groups.createdAt))
  if (!rows.length) return []
  const ids = rows.map((r) => r.g.id)
  const [repos, members, bots] = await Promise.all([
    ctx.db
      .select({ groupId: groupRepos.groupId, url: groupRepos.url })
      .from(groupRepos)
      .where(inArray(groupRepos.groupId, ids)),
    ctx.db
      .select({ groupId: groupMembers.groupId, n: count() })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, ids))
      .groupBy(groupMembers.groupId),
    ctx.db
      .select({ groupId: groupBots.groupId, n: count() })
      .from(groupBots)
      .where(and(inArray(groupBots.groupId, ids), isNull(groupBots.removedAt)))
      .groupBy(groupBots.groupId),
  ])
  const n = (list: { groupId: string; n: number }[], id: string) => list.find((x) => x.groupId === id)?.n ?? 0
  return rows.map(({ g, title, owner, teamName }) => ({
    id: g.id,
    name: title,
    ownerName: owner,
    kind: g.kind as AdminGroupDto['kind'],
    mode: g.mode as AdminGroupDto['mode'],
    repo: repos.find((r) => r.groupId === g.id)?.url ?? null,
    members: n(members, g.id),
    bots: n(bots, g.id),
    archivedAt: g.archivedAt?.toISOString() ?? null,
    teamId: g.teamId,
    teamName,
  }))
}
