import { PROTOCOL_VERSION } from '@aiws/protocol'
import cookie from '@fastify/cookie'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import type { Ctx } from './context.js'
import { daemonGateway } from './daemon/gateway.js'
import { HttpError } from './lib/errors.js'
import { approvalRoutes } from './modules/approvals/routes.js'
import { startApprovalTimer } from './modules/approvals/service.js'
import { authRoutes } from './modules/auth/routes.js'
import { botRoutes } from './modules/bots/routes.js'
import { groupRoutes } from './modules/groups/routes.js'
import { machineRoutes } from './modules/machines/routes.js'
import { mcpRoutes } from './modules/mcp/routes.js'
import { messageRoutes } from './modules/messages/routes.js'
import { notificationRoutes } from './modules/notifications/routes.js'
import { startRunEngine } from './modules/runs/engine.js'
import { startRetention } from './modules/runs/retention.js'
import { runRoutes } from './modules/runs/routes.js'
import { startOfflineExpiry } from './modules/runs/stop.js'
import { stopRoutes } from './modules/runs/stop-routes.js'
import { searchRoutes } from './modules/search/routes.js'
import { usageRoutes } from './modules/usage/routes.js'
import { userRoutes } from './modules/users/routes.js'
import { startWorkspaceEngine } from './modules/workspaces/provision.js'
import { workspaceRoutes } from './modules/workspaces/routes.js'
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
  await app.register(groupRoutes(ctx))
  await app.register(messageRoutes(ctx))
  await app.register(webGateway(ctx))
  await app.register(daemonGateway(ctx))
  await app.register(runRoutes(ctx))
  const stopRunEngine = startRunEngine(ctx)
  app.addHook('onClose', stopRunEngine)
  await app.register(stopRoutes(ctx))
  app.addHook('onClose', startOfflineExpiry(ctx))
  const stopRetention = startRetention(ctx)
  app.addHook('onClose', stopRetention)
  const stopWorkspaceEngine = startWorkspaceEngine(ctx)
  app.addHook('onClose', stopWorkspaceEngine)
  const stopApprovalTimer = startApprovalTimer(ctx)
  app.addHook('onClose', async () => stopApprovalTimer())
  await app.register(approvalRoutes(ctx))
  await app.register(authRoutes(ctx))
  await app.register(userRoutes(ctx))
  await app.register(machineRoutes(ctx))
  await app.register(botRoutes(ctx))
  await app.register(notificationRoutes(ctx))
  await app.register(workspaceRoutes(ctx))
  await app.register(usageRoutes(ctx))
  await app.register(mcpRoutes(ctx))
  await app.register(searchRoutes(ctx))
  return app
}
