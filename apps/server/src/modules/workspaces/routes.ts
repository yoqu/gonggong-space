import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { listBotStates } from './state.js'

export function workspaceRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>('/api/groups/:id/bot-states', async (req) => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      return listBotStates(ctx, req.params.id)
    })
  }
}
