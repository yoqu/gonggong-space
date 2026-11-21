import { ReactionEmoji, type ReactionsDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { messageReactions } from '../../db/schema.js'
import { requireUser } from '../auth/session.js'
import { memberIds, requireMessage } from '../messages/service.js'
import { reactionsOf } from './service.js'

type Params = { Params: { id: string; emoji: string } }

export function reactionRoutes(ctx: Ctx) {
  /** Idempotent toggle; members are told only when the set actually changed. */
  const react = async (userId: string, params: Params['Params'], on: boolean): Promise<ReactionsDto> => {
    const emoji = ReactionEmoji.parse(params.emoji)
    const m = await requireMessage(ctx, params.id, userId)
    const messageId = m.id
    const changed = on
      ? await ctx.db
          .insert(messageReactions)
          .values({ messageId, userId, emoji })
          .onConflictDoNothing()
          .returning()
      : await ctx.db
          .delete(messageReactions)
          .where(
            and(
              eq(messageReactions.messageId, messageId),
              eq(messageReactions.userId, userId),
              eq(messageReactions.emoji, emoji),
            ),
          )
          .returning()
    const members = changed.length ? await memberIds(ctx, m.groupId) : []
    const view = await reactionsOf(ctx, messageId)
    for (const id of members)
      ctx.bus.publish([id], {
        t: 'message.reactions',
        groupId: m.groupId,
        messageId,
        reactions: view(id),
      })
    return { groupId: m.groupId, messageId, reactions: view(userId) }
  }

  return async (app: FastifyInstance) => {
    app.put<Params>('/api/messages/:id/reactions/:emoji', async (req) =>
      react((await requireUser(ctx, req)).id, req.params, true),
    )
    app.delete<Params>('/api/messages/:id/reactions/:emoji', async (req) =>
      react((await requireUser(ctx, req)).id, req.params, false),
    )
  }
}
