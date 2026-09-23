import type { MessageDto } from '@aiws/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groups, type messages, runs } from '../../db/schema.js'
import { activeBots } from '../groups/service.js'
import { parseMentions } from '../messages/mentions.js'
import { hopMaxOf, publishRun, type RunRow } from './dto.js'
import { schedule } from './scheduler.js'
import { isChainStopped } from './stop.js'

type Target = Pick<
  typeof bots.$inferSelect,
  'id' | 'binding' | 'ownerId' | 'tier' | 'triggerScope' | 'triggerList'
>

/** Why `origin` may not trigger `bot` (spec §3.6), or null when allowed. The owner is always allowed. */
export function refusal(bot: Target, origin: string): string | null {
  if (bot.binding !== 'bound') return 'bot 未绑定或未确认，不能被触发'
  if (origin === bot.ownerId) return null
  const scope = bot.tier === 'full' && bot.triggerScope === 'all' ? 'list' : bot.triggerScope
  if (scope === 'all' || (scope === 'list' && bot.triggerList.includes(origin))) return null
  return scope === 'self' ? '该 bot 仅允许主人触发，未启动运行' : '该 bot 仅允许指定名单触发，未启动运行'
}

interface Trigger {
  groupId: string
  messageId: string
  botIds: string[]
  originUserId: string
  triggerUserId: string | null
  hop: number
  parentRunId: string | null
}

/** One run per bot in the group; out-of-scope bots get a `forbidden` card instead of a run (fan-out = parallel). */
async function createRuns(ctx: Ctx, t: Trigger) {
  if (!t.botIds.length) return
  const targets = await ctx.db
    .select({
      id: bots.id,
      binding: bots.binding,
      ownerId: bots.ownerId,
      tier: bots.tier,
      triggerScope: bots.triggerScope,
      triggerList: bots.triggerList,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(
      and(
        eq(groupBots.groupId, t.groupId),
        inArray(groupBots.botId, t.botIds),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
      ),
    )
  await Promise.all(
    targets.map(async (bot) => {
      const refused = refusal(bot, t.originUserId)
      const [run] = await ctx.db
        .insert(runs)
        .values({
          groupId: t.groupId,
          botId: bot.id,
          triggerMessageId: t.messageId,
          triggerUserId: t.triggerUserId,
          originUserId: t.originUserId,
          parentRunId: t.parentRunId,
          hop: t.hop,
          status: refused ? 'forbidden' : 'queued',
          step: refused ?? '',
          queuedAt: ctx.now(),
          endedAt: refused ? ctx.now() : null,
        })
        .returning()
      if (!refused) await schedule(ctx, bot.id)
      else if (run) await publishRun(ctx, run)
    }),
  )
}

/**
 * Called by the chat module right after a user message is stored. Creates one run per mentioned bot
 * (message.meta.mentions) that is in the group, then dispatches it.
 */
export async function triggerRuns(ctx: Ctx, message: typeof messages.$inferSelect): Promise<void> {
  const author = message.authorUserId
  if (!author) return
  await createRuns(ctx, {
    groupId: message.groupId,
    messageId: message.id,
    botIds: [...new Set((message.meta as { mentions?: string[] }).mentions ?? [])],
    originUserId: author,
    triggerUserId: author,
    hop: 1,
    parentRunId: null,
  })
}

/**
 * Relay (spec §4.6): bots @-mentioned in a completed run's final reply run as the next hop, authorized against the
 * chain's human initiator. Beyond the group's chainMaxHops the @ stays plain text.
 */
export async function triggerChain(ctx: Ctx, parent: RunRow, reply: MessageDto): Promise<void> {
  if (parent.status !== 'completed' || (await isChainStopped(ctx, parent))) return
  const [group] = await ctx.db
    .select({ params: groups.params })
    .from(groups)
    .where(eq(groups.id, parent.groupId))
  const hop = parent.hop + 1
  if (hop > hopMaxOf(group?.params ?? {})) return
  const mentioned = parseMentions(reply.body, await activeBots(ctx, parent.groupId))
  await createRuns(ctx, {
    groupId: parent.groupId,
    messageId: reply.id,
    botIds: mentioned.filter((id) => id !== parent.botId),
    originUserId: parent.originUserId,
    triggerUserId: null,
    hop,
    parentRunId: parent.id,
  })
}
