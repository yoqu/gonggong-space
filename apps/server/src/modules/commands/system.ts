import { and, eq } from 'drizzle-orm'
import { groupBots } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { postEvent } from '../messages/service.js'
import { publishBotState } from '../workspaces/state.js'
import type { CommandHandler, CommandInput } from './registry.js'

/** Mentioned bots in mention order (mentions are already limited to the group's bots). */
export const targets = ({ command, bots }: CommandInput) =>
  command.mentions.flatMap((id) => bots.filter((b) => b.id === id))

/** /new: the mentioned bots' next turn starts a fresh session (spec §4.4). Any member may ask; it is audited. */
export const newSession: CommandHandler = async (ctx, input) => {
  const { group, user, bots } = input
  const picked = targets(input)
  if (!picked.length) {
    await postEvent(ctx, group.id, '/new 需要同时 @ 一个 Bot，如 /new @{bot}', {
      bot: bots[0]?.name ?? 'bot',
    })
    return
  }
  for (const bot of picked) {
    const [row] = await ctx.db
      .update(groupBots)
      .set({ sessionId: null, newSessionReason: 'requested', contextUsage: null })
      .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
      .returning()
    if (row) await publishBotState(ctx, row)
    await audit(ctx, {
      category: 'run',
      actorUserId: user.id,
      action: 'command.new',
      groupId: group.id,
      detail: { botId: bot.id },
    })
    await postEvent(ctx, group.id, '{bot} 下一轮将开新会话', { bot: bot.name })
  }
}

/** /hold, /release: the group lock only exists in force-sync groups (P2). */
export const forceSyncOnly: CommandHandler = (ctx, { group, command }) =>
  postEvent(ctx, group.id, '/{command} 仅在强制同步群可用', { command: command.name }).then(() => undefined)
