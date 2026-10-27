import { TerminalCreateReq, type TerminalDto } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireUser } from '../auth/session.js'
import type { TerminalService } from './sessions.js'

type PairParams = { Params: { groupId: string; botId: string } }

export function terminalRoutes({ ctx, terminals }: { ctx: Ctx; terminals: TerminalService }) {
  return async (app: FastifyInstance) => {
    app.post<PairParams>('/api/groups/:groupId/bots/:botId/terminals', async (req, reply): Promise<TerminalDto> => {
      const user = await requireUser(ctx, req)
      const input = TerminalCreateReq.parse(req.body)
      const terminal = await terminals.create(user.id, req.params.groupId, req.params.botId, input)
      return reply.status(201).send(terminal)
    })

    app.get<PairParams>('/api/groups/:groupId/bots/:botId/terminals', async (req): Promise<TerminalDto[]> => {
      const user = await requireUser(ctx, req)
      return terminals.list(user.id, req.params.groupId, req.params.botId)
    })

    app.delete<{ Params: { sessionId: string } }>('/api/terminals/:sessionId', async (req, reply) => {
      const user = await requireUser(ctx, req)
      await terminals.end(user.id, z.uuid().parse(req.params.sessionId))
      return reply.status(204).send()
    })
  }
}
