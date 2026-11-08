import { and, eq } from 'drizzle-orm'
import { groupBots, threadSessions } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { postEvent } from '../messages/service.js'
import { publishBotState, RESET_SESSION } from '../workspaces/state.js'
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
  // Asked in a thread, /new starts over the thread's session only (plan 话题).
  const thread = input.message.threadRootId
  for (const bot of picked) {
    if (thread)
      await ctx.db
        .insert(threadSessions)
        .values({ rootMessageId: thread, botId: bot.id, newSessionReason: 'requested' })
        .onConflictDoUpdate({
          target: [threadSessions.rootMessageId, threadSessions.botId],
          set: { sessionId: null, newSessionReason: 'requested' },
        })
    else {
      const [row] = await ctx.db
        .update(groupBots)
        .set({ ...RESET_SESSION, newSessionReason: 'requested' })
        .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
        .returning()
      if (row) await publishBotState(ctx, row)
    }
    await audit(ctx, {
      category: 'run',
      actorUserId: user.id,
      action: 'command.new',
      groupId: group.id,
      detail: { botId: bot.id },
    })
    await postEvent(ctx, group.id, '{bot} 下一轮将开新会话', { bot: bot.name }, {}, thread)
  }
}
