import {
  CreateWebhookReq,
  type GroupWebhooksDto,
  UpdateWebhookReq,
  WEBHOOK_PATH,
  WEBHOOK_RATE_PER_MIN,
  type WebhookCallDto,
  WebhookCallReq,
  type WebhookDto,
  type WebhookTokenDto,
} from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { Throttle } from '../../lib/throttle.js'
import { requireUser } from '../auth/session.js'
import { requireAdmin, requireMember } from '../groups/service.js'
import { handleWebhookCall } from './inbound.js'
import {
  createWebhook,
  deleteWebhook,
  groupWebhooks,
  requireManageWebhook,
  rotateWebhook,
  updateWebhook,
  webhookById,
  webhookDto,
} from './service.js'

async function found(ctx: Ctx, id: string) {
  return (await webhookById(ctx, idParam(id, 'Webhook 不存在'))) ?? fail('not_found', 'Webhook 不存在')
}

function bearerToken(header: string | undefined) {
  const m = header && /^Bearer\s+(\S+)$/i.exec(header.trim())
  return m?.[1] ?? ''
}

/** 群 Webhook (plan 群Webhook): members list; admins create; owners & admins edit/rotate/delete; token posts. */
export function webhookRoutes(ctx: Ctx) {
  const throttle = new Throttle(WEBHOOK_RATE_PER_MIN, 60_000, ctx.now)
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/webhooks',
      async (req): Promise<GroupWebhooksDto> => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        return groupWebhooks(ctx, group.id, me.id)
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/groups/:id/webhooks',
      async (req): Promise<WebhookTokenDto> => {
        const me = await requireUser(ctx, req)
        const { group } = await requireAdmin(ctx, req.params.id, me.id)
        const { row, token } = await createWebhook(ctx, group.id, CreateWebhookReq.parse(req.body), me.id, {
          userId: me.id,
        })
        if (!token) return fail('invalid', 'Webhook 不存在')
        return {
          webhook: webhookDto(await found(ctx, row.id), true),
          token,
          path: `${WEBHOOK_PATH}/${token}`,
        }
      },
    )

    app.patch<{ Params: { id: string } }>('/api/webhooks/:id', async (req): Promise<WebhookDto> => {
      const me = await requireUser(ctx, req)
      const { w } = await found(ctx, req.params.id)
      await requireManageWebhook(ctx, w, me.id)
      await updateWebhook(ctx, w, UpdateWebhookReq.parse(req.body), { userId: me.id })
      return webhookDto(await found(ctx, w.id), true)
    })

    app.post<{ Params: { id: string } }>(
      '/api/webhooks/:id/rotate',
      async (req): Promise<WebhookTokenDto> => {
        const me = await requireUser(ctx, req)
        const { w } = await found(ctx, req.params.id)
        await requireManageWebhook(ctx, w, me.id)
        return rotateWebhook(ctx, w, { userId: me.id })
      },
    )

    app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const { w } = await found(ctx, req.params.id)
      await requireManageWebhook(ctx, w, me.id)
      await deleteWebhook(ctx, w, { userId: me.id })
      return reply.status(204).send()
    })

    app.post<{ Params: { token: string } }>(
      `${WEBHOOK_PATH}/:token`,
      async (req): Promise<WebhookCallDto> => {
        const body = WebhookCallReq.parse(req.body)
        return handleWebhookCall(ctx, req.params.token, body, throttle)
      },
    )

    app.post(WEBHOOK_PATH, async (req): Promise<WebhookCallDto> => {
      const token = bearerToken(req.headers.authorization)
      if (!token) return fail('unauthorized', 'Webhook 无效或已停用')
      const body = WebhookCallReq.parse(req.body)
      return handleWebhookCall(ctx, token, body, throttle)
    })
  }
}
