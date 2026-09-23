import { TERMINAL_RUN_STATUS } from '@aiws/protocol'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { groupBots, runs } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { postEvent } from '../messages/service.js'
import type { CommandHandler, CommandInput } from './registry.js'

/** Mentioned bots in mention order (mentions are already limited to the group's bots). */
export const targets = ({ command, bots }: CommandInput) =>
  command.mentions.flatMap((id) => bots.filter((b) => b.id === id))

/** /new: the mentioned bots' next turn starts a fresh session (spec §4.4). Any member may ask; it is audited. */
export const newSession: CommandHandler = async (ctx, input) => {
  const { group, user, bots } = input
  const picked = targets(input)
  if (!picked.length) {
    await postEvent(ctx, group.id, `/new 需要同时 @ 一个 bot，如 /new @${bots[0]?.name ?? 'bot'}`)
    return
  }
  for (const bot of picked) {
    await ctx.db
      .update(groupBots)
      .set({ sessionId: null, newSessionReason: 'requested' })
      .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
    await audit(ctx, {
      category: 'run',
      actorUserId: user.id,
      action: 'command.new',
      groupId: group.id,
      detail: { botId: bot.id },
    })
    await postEvent(ctx, group.id, `${bot.name} 下一轮将开新会话`)
  }
}

/** /hold, /release: the group lock only exists in force-sync groups (P2). */
export const forceSyncOnly: CommandHandler = (ctx, { group, command }) =>
  postEvent(ctx, group.id, `/${command.name} 仅在强制同步群可用`).then(() => undefined)

/** /stop when nothing matches; stopping live runs is registered over this by the interrupt module (M3). */
export const stopIdle: CommandHandler = async (ctx, { group, command }) => {
  const [active] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.groupId, group.id),
        notInArray(runs.status, [...TERMINAL_RUN_STATUS]),
        command.mentions.length ? inArray(runs.botId, command.mentions) : undefined,
      ),
    )
    .limit(1)
  if (!active) await postEvent(ctx, group.id, '没有运行中的轮次')
}
