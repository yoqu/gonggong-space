import type { GroupPreviewsDto } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { previews, services } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { issueCode } from './access.js'
import { closePreview, groupPreviews, requireManager } from './service.js'

type Preview = typeof previews.$inferSelect

/** The preview's origin as this browser should reach it. */
export function previewOrigin(ctx: Ctx, preview: Preview, req: FastifyRequest) {
  const { domain, publicUrl } = ctx.config.preview
  const proto = publicUrl ? new URL(publicUrl).protocol.slice(0, -1) : req.protocol
  if (!domain) return `${proto}://${req.hostname}:${preview.publicPort}`
  const port = req.port && req.port !== (proto === 'https' ? 443 : 80) ? `:${req.port}` : ''
  return `${proto}://${preview.slug}.${domain}${publicUrl ? '' : port}`
}

export async function requireOpenPreview(ctx: Ctx, id: string) {
  if (!isUuid(id)) return fail('not_found', '预览不存在或已关闭')
  const [row] = await ctx.db
    .select()
    .from(previews)
    .where(and(eq(previews.id, id), isNull(previews.closedAt)))
  return row ?? fail('not_found', '预览不存在或已关闭')
}

export function previewRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/groups/:id/previews', async (req): Promise<GroupPreviewsDto> => {
      const user = await requireUser(ctx, req)
      const { id } = req.params as { id: string }
      await requireMember(ctx, id, user.id)
      return groupPreviews(ctx, id, user.id)
    })

    app.post('/api/previews/:id/close', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const preview = await requireOpenPreview(ctx, (req.params as { id: string }).id)
      await requireManager(ctx, preview.groupId, preview.botId, user.id)
      await closePreview(ctx, preview)
      return reply.status(204).send()
    })

    app.post('/api/services/:id/stop', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const id = idParam((req.params as { id: string }).id, '服务')
      const [svc] = await ctx.db.select().from(services).where(eq(services.id, id))
      if (!svc) return fail('not_found', '服务不存在')
      await requireManager(ctx, svc.groupId, svc.botId, user.id)
      if (!ctx.hub.send(svc.machineId, { t: 'service.stop', serviceId: svc.id }))
        return fail('conflict', '服务所在的机器离线')
      return reply.status(204).send()
    })

    // 打开 in a card (also the iframe src): members hop to the preview origin with a one-time code.
    app.get('/api/previews/:id/open', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const { id } = req.params as { id: string }
      const { path = '/' } = z.object({ path: z.string().startsWith('/').optional() }).parse(req.query)
      const preview = await requireOpenPreview(ctx, id)
      await requireMember(ctx, preview.groupId, user.id)
      const code = issueCode(ctx, preview.id, { userId: user.id })
      const target = `${previewOrigin(ctx, preview, req)}/__gg/auth?code=${code}&return=${encodeURIComponent(path)}`
      return reply.redirect(target, 302)
    })
  }
}
