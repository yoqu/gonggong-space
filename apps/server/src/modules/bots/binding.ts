import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, type machines, notifications } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { publishBot, publishBots } from './dto.js'

/**
 * Called by the machines module after a daemon binds a new machine. The owner's `pending_bind` bots are bound to it
 * (spec 3.3: bound automatically to the first machine). Agent availability is reflected by presence, not by binding.
 */
export async function onMachineBound(ctx: Ctx, machine: typeof machines.$inferSelect): Promise<void> {
  const bound = await ctx.db
    .update(bots)
    .set({ machineId: machine.id, binding: 'bound' })
    .where(and(eq(bots.ownerId, machine.ownerId), eq(bots.binding, 'pending_bind'), isNull(bots.deletedAt)))
    .returning({ id: bots.id })
  if (bound.length)
    await publishBots(
      ctx,
      inArray(
        bots.id,
        bound.map((b) => b.id),
      ),
    )
}

/** The machine owner accepts a bot someone else created for them. */
export async function confirmBot(ctx: Ctx, bot: typeof bots.$inferSelect) {
  await ctx.db.update(bots).set({ binding: 'bound' }).where(eq(bots.id, bot.id))
  await ctx.db
    .update(notifications)
    .set({ readAt: ctx.now() })
    .where(
      and(
        eq(notifications.userId, bot.ownerId),
        eq(notifications.type, 'bot_confirm'),
        isNull(notifications.readAt),
        sql`${notifications.payload}->>'botId' = ${bot.id}`,
      ),
    )
  await audit(ctx, {
    category: 'admin',
    actorUserId: bot.ownerId,
    teamId: bot.teamId,
    action: 'bot.confirm',
    detail: { botId: bot.id, name: bot.name },
  })
  return publishBot(ctx, bot.id)
}
