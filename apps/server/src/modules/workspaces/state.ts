import type { GitStatus, GroupBotStateDto, RepoAccessReason, Tier } from '@gonggong/protocol'
import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupBots, groupRepos } from '../../db/schema.js'
import { memberIds } from '../messages/service.js'

type Row = typeof groupBots.$inferSelect

export const botStateDto = (r: Row): GroupBotStateDto => ({
  botId: r.botId,
  workspace: r.workspaceKind === 'cd' ? 'cd' : 'managed',
  state: r.workspaceState as GroupBotStateDto['state'],
  path: r.workspacePath,
  git: (r.gitStatus as GitStatus | null) ?? null,
  error: r.workspaceError,
  reason: r.workspaceState === 'failed' ? (r.workspaceReason as RepoAccessReason | null) : null,
  tier: r.tier as Tier | null,
  model: r.model,
  effort: r.effort,
})

export async function listBotStates(ctx: Ctx, groupId: string) {
  const rows = await ctx.db
    .select()
    .from(groupBots)
    .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt)))
  return rows.map(botStateDto)
}

/** Single write path for a (group, bot) workspace's state; pushes `group.botState` to the group's members. */
export async function updateBotState(
  ctx: Ctx,
  groupId: string,
  botId: string,
  patch: Partial<
    Pick<
      Row,
      | 'workspaceKind'
      | 'cdPath'
      | 'workspaceState'
      | 'workspacePath'
      | 'workspaceError'
      | 'workspaceReason'
      | 'gitStatus'
      | 'tier'
      | 'model'
      | 'effort'
    >
  >,
) {
  const [row] = await ctx.db
    .update(groupBots)
    .set(patch)
    .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
    .returning()
  if (!row) return null
  return publishBotState(ctx, row)
}

export async function publishBotState(ctx: Ctx, row: Row) {
  const state = botStateDto(row)
  ctx.bus.publish(await memberIds(ctx, row.groupId), { t: 'group.botState', groupId: row.groupId, state })
  return state
}

/**
 * Groups where the bot's clone or directory binding is not ready yet; the scheduler holds their runs back.
 * Repo-less managed workspaces need no daemon round trip and never wait.
 */
export async function unreadyGroups(db: Pick<Ctx['db'], 'selectDistinct'>, botId: string) {
  const rows = await db
    .selectDistinct({ groupId: groupBots.groupId })
    .from(groupBots)
    .leftJoin(groupRepos, eq(groupRepos.groupId, groupBots.groupId))
    .where(
      and(
        eq(groupBots.botId, botId),
        ne(groupBots.workspaceState, 'ready'),
        or(isNotNull(groupRepos.id), eq(groupBots.workspaceKind, 'cd')),
      ),
    )
  return new Set(rows.map((r) => r.groupId))
}
