import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../context.js'
import { resolveSession, SESSION_COOKIE } from '../modules/auth/session.js'

/** Past this much unsent data the client is not keeping up: it is dropped and refills after reconnecting. */
const MAX_BUFFERED_BYTES = 8 << 20

export function webGateway(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/ws/web', { websocket: true }, async (ws, req) => {
      let detach: (() => void) | undefined
      let closed = false
      ws.on('close', () => {
        closed = true
        detach?.()
      })
      const user = await resolveSession(ctx, req.cookies[SESSION_COOKIE])
      if (closed) return
      if (!user) return ws.close(4401, 'unauthorized')
      detach = ctx.bus.attach(
        user.id,
        (_, json) => {
          if (ws.bufferedAmount > MAX_BUFFERED_BYTES) ws.terminate()
          else ws.send(json())
        },
        () => ws.close(4401, 'unauthorized'),
      )
    })
  }
}
