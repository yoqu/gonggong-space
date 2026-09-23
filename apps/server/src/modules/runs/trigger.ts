import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, type messages, runs } from '../../db/schema.js'
import { publishRun } from './dto.js'
import { schedule } from './scheduler.js'

/**
 * Called by the chat module right after a user message is stored. Creates one run per mentioned bot
 * (message.meta.mentions) that is in the group, then dispatches it.
 */
export async function triggerRuns(ctx: Ctx, message: typeof messages.$inferSelect): Promise<void> {
  const mentions = [...new Set((message.meta as { mentions?: string[] }).mentions ?? [])]
  const author = message.authorUserId
  if (!mentions.length || !author) return
  const targets = await ctx.db
    .select({ id: bots.id, binding: bots.binding })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(
      and(
        eq(groupBots.groupId, message.groupId),
        inArray(groupBots.botId, mentions),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
      ),
    )
  await Promise.all(
    targets.map(async (bot) => {
      const bound = bot.binding === 'bound'
      const created = await ctx.db
        .insert(runs)
        .values({
          groupId: message.groupId,
          botId: bot.id,
          triggerMessageId: message.id,
          triggerUserId: author,
          originUserId: author,
          status: bound ? 'queued' : 'forbidden',
          step: bound ? '' : 'bot 未绑定或未确认，不能被触发',
          queuedAt: ctx.now(),
          endedAt: bound ? null : ctx.now(),
        })
        .returning()
      if (bound) await schedule(ctx, bot.id)
      else for (const run of created) await publishRun(ctx, run)
    }),
  )
}
