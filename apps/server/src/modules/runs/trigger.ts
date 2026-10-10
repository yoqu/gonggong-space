import type { ProtocolKey, RepoAccessReason } from '@gonggong/protocol'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groups, messages, runs, users } from '../../db/schema.js'
import { groupParams } from '../groups/params.js'
import { activeBots } from '../groups/service.js'
import { postEvent, postMessage } from '../messages/service.js'
import { PAUSING, reasonText } from '../workspaces/provision.js'
import { publishRun, type RunRow } from './dto.js'
import { schedule } from './scheduler.js'
import { runStep } from './step.js'
import { isChainStopped } from './stop.js'

type Target = Pick<
  typeof bots.$inferSelect,
  'id' | 'binding' | 'ownerId' | 'tier' | 'triggerScope' | 'triggerList'
>

/** Why `origin` may not trigger `bot` (spec §3.6), or null when allowed. The owner is always allowed. */
export function refusal(bot: Target, origin: string): ProtocolKey | null {
  if (bot.binding !== 'bound') return 'Bot 未绑定或未确认，不能被触发'
  if (origin === bot.ownerId) return null
  const scope = bot.tier === 'full' && bot.triggerScope === 'all' ? 'list' : bot.triggerScope
  if (scope === 'all' || (scope === 'list' && bot.triggerList.includes(origin))) return null
  return scope === 'self' ? '该 Bot 仅允许主人触发，未启动运行' : '该 Bot 仅允许指定名单触发，未启动运行'
}

interface Trigger {
  groupId: string
  messageId: string
  botIds: string[]
  originUserId: string
  triggerUserId: string | null
  hop: number
  parentRunId: string | null
  /** The origin was authorized otherwise (a sync merge turn's decider): only the binding is checked. */
  anyScope?: boolean
}

/**
 * One run per bot in the group; out-of-scope bots get a `forbidden` card instead of a run (fan-out = parallel).
 * Bots without a workspace are not run at all: their owner is reminded and the message is not replayed (plan W5).
 */
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
      name: bots.name,
      ownerName: users.name,
      workspaceState: groupBots.workspaceState,
      workspaceReason: groupBots.workspaceReason,
      groupTier: groupBots.tier,
      // A DM someone opened with a bot shared with them: the share itself allows it.
      sharedDm: sql<boolean>`${groups.kind} = 'dm' and ${groups.createdBy} <> ${bots.ownerId}`,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .innerJoin(users, eq(users.id, bots.ownerId))
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
      const refused = refusal(
        { ...bot, tier: bot.groupTier ?? bot.tier },
        t.anyScope || bot.sharedDm ? bot.ownerId : t.originUserId,
      )
      if (!refused && bot.workspaceState === 'unbound')
        return void (await postEvent(
          ctx,
          t.groupId,
          '{bot} 还没有工作区，本次未执行；{owner} 绑定工作区后重新发起即可',
          {
            bot: bot.name,
            owner: bot.ownerName,
          },
        ))
      const reason = bot.workspaceReason as RepoAccessReason | null
      if (!refused && bot.workspaceState === 'failed' && reason && PAUSING.includes(reason))
        return void (await postEvent(
          ctx,
          t.groupId,
          '{bot} 所在机器无法访问仓库（{reason}），本次未执行；{owner} 配置后点「重新检查」',
          { bot: bot.name, reason: { key: reasonText(reason) }, owner: bot.ownerName },
        ))
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
          ...(refused ? runStep(refused) : { step: '' }),
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
 * (message.meta.mentions) that is in the group, then dispatches it. `anyScope`: see Trigger.
 */
export async function triggerRuns(
  ctx: Ctx,
  message: typeof messages.$inferSelect,
  o: { anyScope?: boolean } = {},
): Promise<void> {
  const author = message.authorUserId
  if (!author) return
  await createRuns(ctx, {
    ...o,
    groupId: message.groupId,
    messageId: message.id,
    botIds: [...new Set((message.meta as { mentions?: string[] }).mentions ?? [])],
    originUserId: author,
    triggerUserId: author,
    hop: 1,
    parentRunId: null,
  })
}

/** A fresh hop-1 run of `botIds` for the (edited) user message `message` (plan F8). */
export async function rerunFor(ctx: Ctx, message: typeof messages.$inferSelect, botIds: string[]) {
  const author = message.authorUserId
  if (!author) return
  await createRuns(ctx, {
    groupId: message.groupId,
    messageId: message.id,
    botIds,
    originUserId: author,
    triggerUserId: author,
    hop: 1,
    parentRunId: null,
  })
}

/** Whether `messageId` already started a run: a repeated follow-up pass must not start it again. */
export async function hasRun(ctx: Ctx, groupId: string, messageId: string) {
  const [hit] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.groupId, groupId), eq(runs.triggerMessageId, messageId)))
    .limit(1)
  return !!hit
}

/**
 * Relay (spec §4.6): the bots a completed run handed off to (hand_off) run as the next hop, each triggered by a message
 * of the parent bot that @-s it with the task, authorized against the chain's human initiator.
 */
export async function triggerChain(ctx: Ctx, parent: RunRow): Promise<void> {
  if (parent.status !== 'completed' || !parent.handoffs.length || (await isChainStopped(ctx, parent))) return
  const [group] = await ctx.db
    .select({ params: groups.params, teamId: groups.teamId })
    .from(groups)
    .where(eq(groups.id, parent.groupId))
  const hop = parent.hop + 1
  if (!group || hop > (await groupParams(ctx, group)).chainMaxHops) return
  const names = new Map((await activeBots(ctx, parent.groupId)).map((b) => [b.id, b.name]))
  // Repeatable: a hop whose relay message or run already exists is not created again.
  for (const [i, h] of parent.handoffs.entries()) {
    const name = names.get(h.botId)
    if (!name) continue
    const relayOf = `${parent.id}:${i}`
    const [prior] = await ctx.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.groupId, parent.groupId), sql`${messages.meta}->>'relayOf' = ${relayOf}`))
    if (prior && (await hasRun(ctx, parent.groupId, prior.id))) continue
    const messageId =
      prior?.id ??
      (
        await postMessage(ctx, {
          groupId: parent.groupId,
          kind: 'bot',
          authorBotId: parent.botId,
          body: `@${name} ${h.task}`,
          meta: { mentions: [h.botId], relayOf },
        })
      ).id
    await createRuns(ctx, {
      groupId: parent.groupId,
      messageId,
      botIds: [h.botId],
      originUserId: parent.originUserId,
      triggerUserId: null,
      hop,
      parentRunId: parent.id,
    })
  }
}
