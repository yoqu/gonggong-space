import { TerminalCreateReq, type TerminalDto } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { HttpError } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import type { TerminalService } from './sessions.js'
import { TerminalRelay } from './transport.js'

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
        if (!Number.isSafeInteger(after) || after < 0) return ws.close(1008, 'invalid terminal cursor')
        try {
          const { attachment, terminal } = await terminals.attach(userId, req.params.sessionId, after)
          if (attachment) return void new TerminalRelay(ws, attachment, terminal.sessionId, after)
          const { sessionId, status: state, exitCode, reason } = terminal
          ws.send(JSON.stringify({ op: 'exit', sessionId, state, exitCode, reason }), () =>
            ws.close(1000, state),
          )
        } catch (error) {
          const forbidden = error instanceof HttpError && error.code === 'forbidden'
          const code = error instanceof HttpError ? error.code : 'unavailable'
          ws.send(JSON.stringify({ op: 'reset', code, status: 'running' }), () =>
            ws.close(forbidden ? 1008 : 1011, 'terminal unavailable'),
          )
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
