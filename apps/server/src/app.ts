import { PROTOCOL_VERSION } from '@aiws/protocol'
import cookie from '@fastify/cookie'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import type { Ctx } from './context.js'
import { daemonGateway } from './daemon/gateway.js'
import { HttpError } from './lib/errors.js'
import { botRoutes } from './modules/bots/routes.js'
import { notificationRoutes } from './modules/notifications/routes.js'
import { userRoutes } from './modules/users/routes.js'
import { webGateway } from './realtime/gateway.js'

export async function buildApp(ctx: Ctx) {
  const app = Fastify({ logger: process.env.AIWS_LOG === '1' })
  await app.register(cookie)
  await app.register(websocket)
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError)
      return reply.status(err.status).send({ error: err.code, message: err.message })
    if (err instanceof ZodError)
      return reply.status(400).send({ error: 'invalid', message: err.issues[0]?.message ?? 'invalid' })
    app.log.error(err)
    return reply.status(500).send({ error: 'invalid', message: 'internal error' })
  })
  app.get('/api/health', async () => ({ ok: true, protocol: PROTOCOL_VERSION }))
  await app.register(webGateway(ctx))
  await app.register(daemonGateway(ctx))
  await app.register(userRoutes(ctx))
  await app.register(botRoutes(ctx))
  await app.register(notificationRoutes(ctx))
  return app
}
