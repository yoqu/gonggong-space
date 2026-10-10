import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { botShares, bots, groupBots, groups, teamMembers, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import type { SessionUser } from '../auth/session.js'
import { publishGroup } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import { stopRuns } from '../runs/stop.js'

type BotRow = typeof bots.$inferSelect

export async function isSharedWith(ctx: Ctx, botId: string, userId: string) {
  const [row] = await ctx.db
    .select({ userId: botShares.userId })
    .from(botShares)
    .where(and(eq(botShares.botId, botId), eq(botShares.userId, userId)))
  return !!row
}

/**
 * A DM someone opened with a bot shared with them: it stays out of the owner's directories and trigger rules.
 * Only a share puts a bot in a DM of someone else, and unsharing takes it out again.
 */
export async function inSharedDm(ctx: Ctx, groupId: string, botId: string) {
  const [row] = await ctx.db
    .select({ kind: groups.kind, createdBy: groups.createdBy, ownerId: bots.ownerId })
    .from(groups)
    .innerJoin(bots, eq(bots.id, botId))
    .where(eq(groups.id, groupId))
  return row?.kind === 'dm' && row.createdBy !== row.ownerId
}

/** Active members of the bot's team other than its owner. */
async function assertSharable(ctx: Ctx, bot: BotRow, ids: string[]) {
  if (ids.includes(bot.ownerId)) fail('invalid', '不能共享给 Bot 主人自己')
  const found = ids.every(isUuid)
    ? await ctx.db
        .select({ id: users.id })
        .from(users)
        .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, bot.teamId)))
        .where(and(inArray(users.id, ids), isNull(users.disabledAt)))
    : []
  if (found.length !== ids.length) fail('invalid', '共享对象包含不存在或已停用的成员')
}

/** The DMs `userIds` opened with the bot, where it is (`active`) or was taken out. */
async function dmsOf(ctx: Ctx, botId: string, userIds: string[], active: boolean) {
  if (!userIds.length) return []
  return ctx.db
    .select({ id: groups.id })
    .from(groupBots)
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(
      and(
        eq(groupBots.botId, botId),
        active ? isNull(groupBots.removedAt) : isNotNull(groupBots.removedAt),
        eq(groups.kind, 'dm'),
        inArray(groups.createdBy, userIds),
        isNull(groups.archivedAt),
      ),
    )
}

/**
 * Replaces who the bot is shared with. Those dropped keep their DMs read-only (the bot leaves, its runs stop);
 * those added are notified, and get back DMs an earlier unsharing closed.
 */
export async function setShares(ctx: Ctx, by: SessionUser, bot: BotRow, wanted: string[]) {
  const ids = [...new Set(wanted)]
  await assertSharable(ctx, bot, ids)
  const current = (
    await ctx.db.select({ userId: botShares.userId }).from(botShares).where(eq(botShares.botId, bot.id))
  ).map((r) => r.userId)
  const added = ids.filter((id) => !current.includes(id))
  const removed = current.filter((id) => !ids.includes(id))
  if (!added.length && !removed.length) return { added, removed }

  const closed = await dmsOf(ctx, bot.id, removed, true)
  const reopened = await dmsOf(ctx, bot.id, added, false)
  await ctx.db.transaction(async (tx) => {
    if (removed.length)
      await tx.delete(botShares).where(and(eq(botShares.botId, bot.id), inArray(botShares.userId, removed)))
    if (added.length)
      await tx.insert(botShares).values(added.map((userId) => ({ botId: bot.id, userId, createdBy: by.id })))
    for (const [rows, removedAt] of [
      [closed, ctx.now()],
      [reopened, null],
    ] as const)
      if (rows.length)
        await tx
          .update(groupBots)
          .set({ removedAt })
          .where(
            and(
              eq(groupBots.botId, bot.id),
              inArray(
                groupBots.groupId,
                rows.map((g) => g.id),
              ),
            ),
          )
  })

  for (const g of closed) {
    await stopRuns(ctx, { groupId: g.id, botIds: [bot.id] }, by)
    await postEvent(ctx, g.id, '{user} 取消了 {bot} 的共享 · 私聊转为只读', { user: by.name, bot: bot.name })
    await publishGroup(ctx, g.id)
  }
  for (const g of reopened) {
    await postEvent(ctx, g.id, '{user} 重新共享了 {bot}', { user: by.name, bot: bot.name })
    await publishGroup(ctx, g.id)
  }
  for (const userId of added)
    await notify(ctx, userId, 'bot_shared', { botId: bot.id, botName: bot.name, byName: by.name })
  return { added, removed }
}
