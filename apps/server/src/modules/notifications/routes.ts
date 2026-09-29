import { type NotificationDto, PushSubscriptionReq } from '@gonggong/protocol'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { notifications, pushSubscriptions } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { notificationDto, withGroupTitles } from './notify.js'
import { vapidKeys } from './push.js'

const LIMIT = 100

export function notificationRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/notifications', async (req) => {
      const user = await requireUser(ctx, req)
      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(LIMIT)
      const payloads = await withGroupTitles(
        ctx,
        rows.map((r) => r.payload as NotificationDto['payload']),
      )
      return rows.map((r, i) => notificationDto({ ...r, payload: payloads[i] }))
    })

    app.post<{ Params: { id: string } }>('/api/notifications/:id/read', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const id = idParam(req.params.id, '通知')
      const [row] = await ctx.db
        .update(notifications)
        .set({ readAt: ctx.now() })
        .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
        .returning({ id: notifications.id })
      if (!row) fail('not_found', '通知不存在')
      return reply.status(204).send()
    })

    app.post('/api/notifications/read-all', async (req, reply) => {
      const user = await requireUser(ctx, req)
      await ctx.db
        .update(notifications)
        .set({ readAt: ctx.now() })
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
      return reply.status(204).send()
    })

    app.delete('/api/notifications/read', async (req, reply) => {
      const user = await requireUser(ctx, req)
      await ctx.db
        .delete(notifications)
        .where(and(eq(notifications.userId, user.id), isNotNull(notifications.readAt)))
      return reply.status(204).send()
    })

    app.delete<{ Params: { id: string } }>('/api/notifications/:id', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const id = idParam(req.params.id, '通知')
      const [row] = await ctx.db
        .delete(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
        .returning({ id: notifications.id })
      if (!row) fail('not_found', '通知不存在')
      return reply.status(204).send()
    })

    app.get('/api/push/key', async (req) => {
      await requireUser(ctx, req)
      return { publicKey: (await vapidKeys(ctx)).publicKey }
    })

    /** One row per browser endpoint: a browser re-subscribing under another account moves over to it. */
    app.post('/api/push/subscriptions', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const { endpoint, keys } = PushSubscriptionReq.parse(req.body)
      await ctx.db
        .insert(pushSubscriptions)
        .values({ userId: user.id, endpoint, keys })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, keys } })
      return reply.status(204).send()
    })

    app.delete<{ Querystring: { endpoint?: string } }>('/api/push/subscriptions', async (req, reply) => {
      const user = await requireUser(ctx, req)
      await ctx.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, user.id),
            eq(pushSubscriptions.endpoint, req.query.endpoint ?? ''),
          ),
        )
      return reply.status(204).send()
    })
  }
}
