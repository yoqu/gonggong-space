import type { UserBriefDto } from '@aiws/protocol'
import { asc, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { users } from '../../db/schema.js'
import { requireUser } from '../auth/session.js'

export function userRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/users', async (req): Promise<UserBriefDto[]> => {
      await requireUser(ctx, req)
      return ctx.db
        .select({ id: users.id, name: users.name, account: users.account })
        .from(users)
        .where(isNull(users.disabledAt))
        .orderBy(asc(users.createdAt))
    })
  }
}
