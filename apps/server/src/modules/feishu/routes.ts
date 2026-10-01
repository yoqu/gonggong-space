import {
  FeishuAppReq,
  type FeishuAppView,
  type FeishuRegisterDto,
  FeishuRegisterReq,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { appDto, botApp, mainApp, removeApp, saveApp } from './apps.js'
import type { FeishuAppRow } from './gateway.js'
import { cancelRegister, registerDto, registerSession, startRegister } from './register.js'

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

  const bound = (update: boolean, row: FeishuAppRow | undefined) =>
    update ? (row ?? fail('invalid', '尚未绑定飞书应用')) : undefined

  return async (app: FastifyInstance) => {
    // 扫码创建 / 更新权限 (plan F1): the QR link comes back at once, the outcome is polled.
    app.post('/api/admin/feishu/register', async (req): Promise<FeishuRegisterDto> => {
      const actor = await requireSysadmin(ctx, req)
      const { update } = FeishuRegisterReq.parse(req.body ?? {})
      const s = await startRegister(ctx, actor.id, { kind: 'main' }, bound(update, await mainApp(ctx)))
      return registerDto(s)
    })

    app.post<IdParams>('/api/bots/:id/feishu/register', async (req): Promise<FeishuRegisterDto> => {
      const { user, bot } = await manageableBot(req, req.params.id)
      const { update } = FeishuRegisterReq.parse(req.body ?? {})
      const target = { kind: 'bot' as const, botId: bot.id, teamId: bot.teamId, name: bot.name }
      return registerDto(await startRegister(ctx, user.id, target, bound(update, await botApp(ctx, bot.id))))
    })

    app.get<IdParams>('/api/feishu/register/:id', async (req): Promise<FeishuRegisterDto> => {
      const user = await requireUser(ctx, req)
      return registerDto(
        registerSession(ctx, user.id, req.params.id) ?? fail('not_found', '扫码会话不存在或已过期'),
      )
    })

    app.delete<IdParams>('/api/feishu/register/:id', async (req, reply) => {
      const user = await requireUser(ctx, req)
      cancelRegister(
        registerSession(ctx, user.id, req.params.id) ?? fail('not_found', '扫码会话不存在或已过期'),
      )
      return reply.status(204).send()
    })

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
