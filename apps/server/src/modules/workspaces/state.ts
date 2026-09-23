import type { GitStatus, GroupBotStateDto } from '@aiws/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupBots } from '../../db/schema.js'
import { memberIds } from '../messages/service.js'

type Row = typeof groupBots.$inferSelect

export const botStateDto = (r: Row): GroupBotStateDto => ({
  botId: r.botId,
  workspace: r.workspaceKind === 'cd' ? 'cd' : 'managed',
  state: r.workspaceState as GroupBotStateDto['state'],
  git: (r.gitStatus as GitStatus | null) ?? null,
  error: r.workspaceError,
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
      'workspaceKind' | 'cdPath' | 'workspaceState' | 'workspacePath' | 'workspaceError' | 'gitStatus'
    >
  >,
) {
  const [row] = await ctx.db
    .update(groupBots)
    .set(patch)
    .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
    .returning()
  if (!row) return null
  const state = botStateDto(row)
  ctx.bus.publish(await memberIds(ctx, groupId), { t: 'group.botState', groupId, state })
  return state
}
