import {
  SaveDoneReq,
  type SavedListDto,
  SavedListQuery,
  type SavedStateDto,
  SaveMessageReq,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { messages, savedMessages } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { byCreated, byDone, doneBefore, openBefore, publishSaved, savedItems, savedState } from './service.js'

/** A message of a group the caller is in. */
async function requireMessage(ctx: Ctx, id: string, userId: string) {
  const [m] = await ctx.db
    .select({ id: messages.id, groupId: messages.groupId })
    .from(messages)
    .where(eq(messages.id, idParam(id, '消息不存在')))
  if (!m) return fail('not_found', '消息不存在')
  await requireMember(ctx, m.groupId, userId)
  return m
}

const mine = (userId: string, messageId: string) =>
  and(eq(savedMessages.userId, userId), eq(savedMessages.messageId, messageId))

export function savedRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.put<{ Params: { id: string } }>('/api/messages/:id/save', async (req) => {
      const me = await requireUser(ctx, req)
      const m = await requireMessage(ctx, req.params.id, me.id)
      const { remindAt } = SaveMessageReq.parse(req.body)
      const at = remindAt ? new Date(remindAt) : null
      await ctx.db
        .insert(savedMessages)
        .values({ userId: me.id, messageId: m.id, groupId: m.groupId, remindAt: at, createdAt: ctx.now() })
        .onConflictDoUpdate({
          target: [savedMessages.userId, savedMessages.messageId],
          set: { remindAt: at, remindedAt: null, doneAt: null },
        })
      publishSaved(ctx, me.id)
      return { ok: true }
    })

    app.delete<{ Params: { id: string } }>('/api/messages/:id/save', async (req) => {
      const me = await requireUser(ctx, req)
      await ctx.db.delete(savedMessages).where(mine(me.id, idParam(req.params.id, '消息不存在')))
      publishSaved(ctx, me.id)
      return { ok: true }
    })

    app.put<{ Params: { id: string } }>('/api/messages/:id/save/done', async (req) => {
      const me = await requireUser(ctx, req)
      const { done } = SaveDoneReq.parse(req.body)
      const [row] = await ctx.db
        .update(savedMessages)
        .set({ doneAt: done ? ctx.now() : null })
        .where(mine(me.id, idParam(req.params.id, '消息不存在')))
        .returning()
      if (!row) return fail('not_found', '消息不存在')
      publishSaved(ctx, me.id)
      return { ok: true }
    })

    app.get('/api/saved', async (req): Promise<SavedListDto> => {
      const me = await requireUser(ctx, req)
      const { state, before, limit } = SavedListQuery.parse(req.query)
      const items =
        state === 'done'
          ? await savedItems(ctx, me.id, doneBefore(before), byDone, limit)
          : await savedItems(ctx, me.id, openBefore(before), byCreated, limit)
      return { items }
    })

    app.get(
      '/api/saved/state',
      async (req): Promise<SavedStateDto> => savedState(ctx, (await requireUser(ctx, req)).id),
    )
  }
}
