import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../context.js'
import { resolveSession, SESSION_COOKIE } from '../modules/auth/session.js'

export function webGateway(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/ws/web', { websocket: true }, async (ws, req) => {
      const user = await resolveSession(ctx, req.cookies[SESSION_COOKIE])
      if (!user) return ws.close(4401, 'unauthorized')
      const detach = ctx.bus.attach(
        user.id,
        (event) => ws.send(JSON.stringify(event)),
        () => ws.close(4401, 'unauthorized'),
      )
      ws.on('close', detach)
    })
  }
}
