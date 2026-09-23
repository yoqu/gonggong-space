import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { notifications } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { notificationDto } from './notify.js'

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
      return rows.map(notificationDto)
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
  }
}
