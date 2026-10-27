import { TerminalCreateReq, type TerminalDto } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireUser } from '../auth/session.js'
import type { TerminalService } from './sessions.js'
import { TerminalTransport } from './transport.js'

type PairParams = { Params: { groupId: string; botId: string } }

export function terminalRoutes({ ctx, terminals }: { ctx: Ctx; terminals: TerminalService }) {
  return async (app: FastifyInstance) => {
    const users = new WeakMap<object, string>()
    app.get<{ Params: { sessionId: string }; Querystring: { after?: string } }>(
      '/ws/terminals/:sessionId',
      {
        websocket: true,
        preValidation: async (req) => {
          users.set(req, (await requireUser(ctx, req)).id)
        },
      },
      async (ws, req) => {
        const userId = users.get(req)
        if (!userId) return ws.close(1008, 'unauthorized')
        const after = Number(req.query.after ?? 0)
        try {
          const { attachment } = await terminals.attach(userId, req.params.sessionId, after)
          const relay = new TerminalTransport({ owner: async () => {}, attach: async () => attachment })
          await relay.attach(ws, req.params.sessionId, after)
        } catch {
          ws.close(1011, 'terminal unavailable')
        }
      },
    )
    app.post<PairParams>(
      '/api/groups/:groupId/bots/:botId/terminals',
      async (req, reply): Promise<TerminalDto> => {
        const user = await requireUser(ctx, req)
        const input = TerminalCreateReq.parse(req.body)
        const terminal = await terminals.create(user.id, req.params.groupId, req.params.botId, input)
        return reply.status(201).send(terminal)
      },
    )

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
