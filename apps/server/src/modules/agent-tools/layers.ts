import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { groupMembers, groups, type runs, teamMembers, teams, users } from '../../db/schema.js'
import { HttpError } from '../../lib/errors.js'
import { requireAdmin } from '../groups/service.js'
import type { Layer, Scope } from '../mcp/service.js'
import { requireTeam } from '../teams/service.js'

export type Run = typeof runs.$inferSelect

export const LAYER: Record<Scope, string> = { platform: '平台层', team: '团队层', group: '群层' }

export async function teamOf(ctx: Ctx, run: Run) {
  const [g] = await ctx.db.select({ teamId: groups.teamId }).from(groups).where(eq(groups.id, run.groupId))
  return g!.teamId
}

/** The run's group's layer `scope` (platform has neither id). */
export async function layerOf(ctx: Ctx, run: Run, scope: Scope = 'group'): Promise<Layer> {
  if (scope === 'platform') return { scope, teamId: null, groupId: null }
  const teamId = await teamOf(ctx, run)
  return { scope, teamId, groupId: scope === 'group' ? run.groupId : null }
}

/** Whether the run's originator may change the layer on the web (as `eachLayer`). */
export const canEdit = (ctx: Ctx, run: Run, l: Layer) =>
  isLayerAdmin(ctx, run.originUserId, { ...l, groupId: l.scope === 'group' ? run.groupId : l.groupId })

/** Sysadmin for platform, team owner / admin for a team, group admin for a group. */
export async function isLayerAdmin(ctx: Ctx, userId: string, l: Layer) {
  try {
    if (l.scope === 'group') await requireAdmin(ctx, l.groupId!, userId)
    else if (l.scope === 'team') await requireTeam(ctx, userId, l.teamId!, 'admin')
    else {
      const [u] = await ctx.db.select().from(users).where(eq(users.id, userId))
      return u?.role === 'sysadmin' && !u.disabledAt
    }
    return true
  } catch (e) {
    if (e instanceof HttpError) return false
    throw e
  }
}

/** Who may change each layer for the run's originator. */
export async function editable(ctx: Ctx, run: Run) {
  const team = await teamOf(ctx, run)
  return {
    platform: await canEdit(ctx, run, { scope: 'platform', teamId: null, groupId: null }),
    team: await canEdit(ctx, run, { scope: 'team', teamId: team, groupId: null }),
    group: await canEdit(ctx, run, { scope: 'group', teamId: team, groupId: run.groupId }),
  }
}

/** What the run's originator administers, as `isLayerAdmin` decides it: any layer, and the platform (sysadmin). */
export async function originAdmin(db: Pick<Db, 'select'>, run: Pick<Run, 'groupId' | 'originUserId'>) {
  const [[user], [member], [lead]] = await Promise.all([
    db
      .select({ role: users.role, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, run.originUserId)),
    db
      .select({ isAdmin: groupMembers.isAdmin })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, run.groupId), eq(groupMembers.userId, run.originUserId))),
    db
      .select({ role: teamMembers.role })
      .from(groups)
      .innerJoin(teamMembers, eq(teamMembers.teamId, groups.teamId))
      .innerJoin(teams, eq(teams.id, groups.teamId))
      .where(
        and(
          eq(groups.id, run.groupId),
          eq(teamMembers.userId, run.originUserId),
          inArray(teamMembers.role, ['owner', 'admin']),
          isNull(teams.archivedAt),
        ),
      ),
  ])
  const sysadmin = user?.role === 'sysadmin' && !user.disabledAt
  return { sysadmin, any: sysadmin || !!member?.isAdmin || !!lead }
}
