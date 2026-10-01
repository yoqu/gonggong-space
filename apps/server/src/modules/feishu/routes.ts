import { FeishuAppReq, type FeishuAppView } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { appDto, botApp, mainApp, removeApp, saveApp } from './apps.js'

type IdParams = { Params: { id: string } }

/** 飞书 app configuration: the main app in 管理后台, each bot's app in its settings (owner or sysadmin). */
export function feishuRoutes(ctx: Ctx) {
  const manageableBot = async (req: Parameters<typeof requireUser>[1], rawId: string) => {
    const user = await requireUser(ctx, req)
    const [bot] = await ctx.db
      .select()
      .from(bots)
      .where(and(eq(bots.id, idParam(rawId, 'Bot 不存在')), isNull(bots.deletedAt)))
    if (!bot) return fail('not_found', 'Bot 不存在')
    if (user.id !== bot.ownerId && user.role !== 'sysadmin')
      return fail('forbidden', '只有归属人或系统管理员可以修改该 Bot')
    return { user, bot }
  }

  return async (app: FastifyInstance) => {
    app.get('/api/admin/feishu', async (req): Promise<FeishuAppView> => {
      await requireSysadmin(ctx, req)
      return { app: appDto(await mainApp(ctx)) }
    })

    app.put('/api/admin/feishu', async (req): Promise<FeishuAppView> => {
      const actor = await requireSysadmin(ctx, req)
      return { app: await saveApp(ctx, { kind: 'main' }, FeishuAppReq.parse(req.body), actor.id) }
    })

    app.delete('/api/admin/feishu', async (req, reply) => {
      const actor = await requireSysadmin(ctx, req)
      await removeApp(ctx, await mainApp(ctx), actor.id)
      return reply.status(204).send()
    })

    app.get<IdParams>('/api/bots/:id/feishu', async (req): Promise<FeishuAppView> => {
      const { bot } = await manageableBot(req, req.params.id)
      return { app: appDto(await botApp(ctx, bot.id)) }
    })

    app.put<IdParams>('/api/bots/:id/feishu', async (req): Promise<FeishuAppView> => {
      const { user, bot } = await manageableBot(req, req.params.id)
      const owner = { kind: 'bot' as const, botId: bot.id, teamId: bot.teamId }
      return { app: await saveApp(ctx, owner, FeishuAppReq.parse(req.body), user.id) }
    })

    app.delete<IdParams>('/api/bots/:id/feishu', async (req, reply) => {
      const { user, bot } = await manageableBot(req, req.params.id)
      await removeApp(ctx, await botApp(ctx, bot.id), user.id)
      return reply.status(204).send()
    })
  }
}
