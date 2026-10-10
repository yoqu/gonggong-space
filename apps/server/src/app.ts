import { join } from 'node:path'
import type { Writable } from 'node:stream'
import cookie from '@fastify/cookie'
import websocket from '@fastify/websocket'
import { PROTOCOL_VERSION } from '@gonggong/protocol'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { Ctx } from './context.js'
import { daemonGateway } from './daemon/gateway.js'
import { localize, type MessageKey, t } from './i18n/index.js'
import { HttpError } from './lib/errors.js'
import { originCheck } from './lib/origin.js'
import { adminRoutes } from './modules/admin/routes.js'
import { adminTeamRoutes } from './modules/admin/teams.js'
import { agentToolRoutes } from './modules/agent-tools/routes.js'
import { approvalRoutes } from './modules/approvals/routes.js'
import { startApprovalTimer } from './modules/approvals/service.js'
import { attachmentRoutes } from './modules/attachments/routes.js'
import { feishuAuthRoutes } from './modules/auth/feishu.js'
import { authRoutes } from './modules/auth/routes.js'
import { botRoutes } from './modules/bots/routes.js'
import { Mirrors } from './modules/candidates/mirror.js'
import { candidateRoutes } from './modules/candidates/routes.js'
import { startCandidates } from './modules/candidates/service.js'
import { feishuChatRoutes } from './modules/feishu/chats.js'
import { startFeishuConfigRetry } from './modules/feishu/config.js'
import { startFeishu } from './modules/feishu/gateway.js'
import { startFeishuInbound } from './modules/feishu/inbound.js'
import { startFeishuMembers } from './modules/feishu/members.js'
import { feishuIdle, stopFeishuMirror } from './modules/feishu/mirror.js'
import { stopRegister } from './modules/feishu/register.js'
import { feishuRoutes } from './modules/feishu/routes.js'
import { gitAccountRoutes } from './modules/git-accounts/routes.js'
import { groupRoutes } from './modules/groups/routes.js'
import { groupSettingsRoutes } from './modules/groups/settings.js'
import { liveRoutes, routeLiveKitUpgrades } from './modules/live/routes.js'
import { startLiveEngine } from './modules/live/service.js'
import { machineRoutes } from './modules/machines/routes.js'
import { mcpRoutes } from './modules/mcp/routes.js'
import { messageRoutes } from './modules/messages/routes.js'
import { notificationRoutes } from './modules/notifications/routes.js'
import { startPreviewEngine } from './modules/previews/engine.js'
import { previewServerFactory, routeUpgrades, startPortListeners } from './modules/previews/gateway.js'
import { previewRoutes } from './modules/previews/routes.js'
import { startLoginWatch, startPreviewReaper } from './modules/previews/service.js'
import { shareRoutes } from './modules/previews/shares.js'
import { tunnelGateway } from './modules/previews/tunnel.js'
import { providerRoutes } from './modules/providers/routes.js'
import { questionRoutes } from './modules/questions/routes.js'
import { startQuestionTimer } from './modules/questions/service.js'
import { reactionRoutes } from './modules/reactions/routes.js'
import { releaseRoutes } from './modules/releases/routes.js'
import { repoRoutes } from './modules/repos/routes.js'
import { backfillRepos } from './modules/repos/service.js'
import { startRunEngine } from './modules/runs/engine.js'
import { startRetention } from './modules/runs/retention.js'
import { runRoutes } from './modules/runs/routes.js'
import { startOfflineExpiry } from './modules/runs/stop.js'
import { stopRoutes } from './modules/runs/stop-routes.js'
import { startScheduleEngine } from './modules/schedules/engine.js'
import { scheduleRoutes } from './modules/schedules/routes.js'
import { searchRoutes } from './modules/search/routes.js'
import { skillRoutes } from './modules/skills/routes.js'
import { startSyncEngine } from './modules/sync/engine.js'
import { syncRoutes } from './modules/sync/routes.js'
import { teamRoutes } from './modules/teams/routes.js'
import { usageRoutes } from './modules/usage/routes.js'
import { avatarRoutes } from './modules/users/avatar.js'
import { userRoutes } from './modules/users/routes.js'
import { startWorkspaceEngine } from './modules/workspaces/provision.js'
import { workspaceRoutes } from './modules/workspaces/routes.js'
import { webGateway } from './realtime/gateway.js'
import type { TlsOptions } from './tls.js'

/** `logStream`: capture the request log (tests asserting what it never contains). */
export async function buildApp(ctx: Ctx, opts: { https?: TlsOptions | null; logStream?: Writable } = {}) {
  const logger = opts.logStream
    ? { level: 'trace', stream: opts.logStream }
    : process.env.GONGGONG_LOG === '1'
  // Route plugins are typed for the default http server; the https instance exposes the same API.
  const serverFactory = previewServerFactory(ctx, opts.https ?? null)
  const app = Fastify({ logger, serverFactory }) as unknown as FastifyInstance
  localize(app)
  await app.register(cookie)
  await app.register(websocket)
  // After the websocket plugin: its onResponse hook then closes the socket of a refused upgrade.
  originCheck(app)
  app.addHook('onReady', async () => {
    routeUpgrades(ctx, app.server)
    routeLiveKitUpgrades(ctx, app.server)
  })
  app.addHook('onClose', () => ctx.livekit.close())
  app.addHook('onClose', startPortListeners(ctx, opts.https ?? null))
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError)
      return reply.status(err.status).send({ error: err.code, message: err.message })
    if (err instanceof ZodError)
      return reply
        .status(400)
        .send({ error: 'invalid', message: t((err.issues[0]?.message ?? 'invalid') as MessageKey) })
    app.log.error(err)
    return reply.status(500).send({ error: 'invalid', message: 'internal error' })
  })
  app.get('/api/health', async () => ({ ok: true, protocol: PROTOCOL_VERSION }))
  await app.register(groupRoutes(ctx))
  await app.register(groupSettingsRoutes(ctx))
  await app.register(messageRoutes(ctx))
  await app.register(reactionRoutes(ctx))
  await app.register(attachmentRoutes(ctx))
  await app.register(webGateway(ctx))
  await app.register(daemonGateway(ctx))
  await app.register(tunnelGateway(ctx))
  await app.register(previewRoutes(ctx))
  await app.register(shareRoutes(ctx))
  await app.register(liveRoutes(ctx))
  await app.register(runRoutes(ctx))
  app.addHook('onClose', startPreviewEngine(ctx))
  app.addHook('onClose', startLiveEngine(ctx))
  app.addHook('onClose', startPreviewReaper(ctx))
  app.addHook('onClose', startLoginWatch(ctx))
  const stopRunEngine = startRunEngine(ctx)
  app.addHook('onClose', stopRunEngine)
  await app.register(stopRoutes(ctx))
  app.addHook('onClose', startOfflineExpiry(ctx))
  const stopRetention = startRetention(ctx)
  app.addHook('onClose', stopRetention)
  const stopScheduleEngine = startScheduleEngine(ctx)
  app.addHook('onClose', stopScheduleEngine)
  await app.register(scheduleRoutes(ctx))
  app.addHook('onClose', startSyncEngine(ctx))
  await app.register(syncRoutes(ctx))
  const stopWorkspaceEngine = startWorkspaceEngine(ctx)
  app.addHook('onClose', stopWorkspaceEngine)
  const stopApprovalTimer = startApprovalTimer(ctx)
  app.addHook('onClose', async () => stopApprovalTimer())
  await app.register(approvalRoutes(ctx))
  const stopQuestionTimer = startQuestionTimer(ctx)
  app.addHook('onClose', async () => stopQuestionTimer())
  await app.register(questionRoutes(ctx))
  await app.register(authRoutes(ctx))
  await app.register(feishuAuthRoutes(ctx))
  await app.register(userRoutes(ctx))
  await app.register(avatarRoutes(ctx))
  await app.register(teamRoutes(ctx))
  await app.register(machineRoutes(ctx))
  await app.register(providerRoutes(ctx))
  await app.register(botRoutes(ctx))
  await app.register(notificationRoutes(ctx))
  await app.register(workspaceRoutes(ctx))
  await app.register(repoRoutes(ctx))
  await app.register(gitAccountRoutes(ctx))
  await backfillRepos(ctx)
  await app.register(usageRoutes(ctx))
  await app.register(releaseRoutes(ctx))
  await app.register(adminRoutes(ctx))
  await app.register(adminTeamRoutes(ctx))
  await app.register(feishuRoutes(ctx))
  await app.register(feishuChatRoutes(ctx))
  startFeishuInbound(ctx)
  startFeishuMembers(ctx)
  app.addHook('onClose', startFeishuConfigRetry(ctx))
  app.addHook('onClose', async () => {
    stopFeishuMirror(ctx)
    stopRegister(ctx)
    await feishuIdle(ctx)
  })
  app.addHook('onClose', await startFeishu(ctx))
  // Base-branch mirrors serve both the @ file candidates and ⌘K file search.
  const mirrors = new Mirrors(join(process.env.GONGGONG_DATA_DIR ?? '.gonggong-dev/data', 'mirrors'), ctx.now)
  await app.register(mcpRoutes(ctx))
  await app.register(skillRoutes(ctx))
  await app.register(agentToolRoutes(ctx))
  await app.register(searchRoutes(ctx, mirrors))
  await app.register(candidateRoutes(ctx, mirrors))
  app.addHook('onClose', startCandidates(ctx))
  return app
}
