import { readFile } from 'node:fs/promises'
import { ClosePreviewReq, type GroupPreviewsDto } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { previews, services } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { issueCode } from './access.js'
import {
  groupPreviews,
  machinePreviews,
  requireManager,
  snapshotFile,
  startPreview,
  stopPreview,
  stopService,
  takeSnapshot,
} from './service.js'

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

/** An open preview with a web address (not a mini program's simulator). */
export async function requireWebPreview(ctx: Ctx, id: string) {
  const preview = await requireOpenPreview(ctx, id)
  if (preview.kind === 'miniprogram') fail('invalid', '小程序预览没有网页地址')
  return preview
}

const SnapshotReq = z.object({ path: z.string().regex(/^\//).max(500).optional() })

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
      await stopPreview(ctx, preview, !!ClosePreviewReq.parse(req.body ?? {}).stopService)
      return reply.status(204).send()
    })

    app.get('/api/previews/:id/snapshot', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const preview = await requireOpenPreview(ctx, (req.params as { id: string }).id)
      // A login code logs its scanner in to the machine's devtools: the bot owner or a group admin decides.
      if (preview.awaiting === 'login') await requireManager(ctx, preview.groupId, preview.botId, user.id)
      else await requireMember(ctx, preview.groupId, user.id)
      if (!preview.snapshotAt) return fail('not_found', '还没有截图')
      const image = await readFile(snapshotFile(preview.id))
      // Versioned by ?v=snapshotAt in the card. Mini program simulators come as JPEG.
      reply.headers({
        'content-type': image[0] === 0xff ? 'image/jpeg' : 'image/png',
        'cache-control': 'private, max-age=31536000, immutable',
      })
      return reply.send(image)
    })

    app.post('/api/previews/:id/snapshot', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const preview = await requireOpenPreview(ctx, (req.params as { id: string }).id)
      await requireManager(ctx, preview.groupId, preview.botId, user.id)
      const { path } = SnapshotReq.parse(req.body ?? {})
      if (path && preview.kind !== 'miniprogram') fail('invalid', '只有小程序预览可以切换页面')
      // A member refreshing or switching the page is a visit (plan P11).
      const [fresh] = await ctx.db
        .update(previews)
        .set({ lastAccessAt: ctx.now(), ...(path ? { path } : {}) })
        .where(eq(previews.id, preview.id))
        .returning()
      await takeSnapshot(ctx, fresh ?? preview)
      return reply.status(204).send()
    })

    app.post('/api/previews/:id/start', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const id = idParam((req.params as { id: string }).id, '预览')
      const [preview] = await ctx.db.select().from(previews).where(eq(previews.id, id))
      if (!preview) return fail('not_found', '预览不存在')
      await requireManager(ctx, preview.groupId, preview.botId, user.id)
      await startPreview(ctx, preview)
      return reply.status(204).send()
    })

    app.post('/api/services/:id/stop', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const id = idParam((req.params as { id: string }).id, '服务')
      const [svc] = await ctx.db.select().from(services).where(eq(services.id, id))
      if (!svc) return fail('not_found', '服务不存在')
      await requireManager(ctx, svc.groupId, svc.botId, user.id)
      stopService(ctx, svc)
      return reply.status(204).send()
    })

    // ── daemon (machine token): the desktop app manages this machine's own tunnels and services ──
    app.get('/api/daemon/previews', async (req): Promise<GroupPreviewsDto> => {
      const machine = await requireMachine(ctx, req)
      return machinePreviews(ctx, machine.id)
    })

    app.post('/api/daemon/previews/:id/close', async (req, reply) => {
      const machine = await requireMachine(ctx, req)
      const preview = await requireOpenPreview(ctx, (req.params as { id: string }).id)
      if (preview.machineId !== machine.id) return fail('not_found', '预览不存在或已关闭')
      await stopPreview(ctx, preview, !!ClosePreviewReq.parse(req.body ?? {}).stopService)
      return reply.status(204).send()
    })

    app.post('/api/daemon/services/:id/stop', async (req, reply) => {
      const machine = await requireMachine(ctx, req)
      const id = idParam((req.params as { id: string }).id, '服务')
      const [svc] = await ctx.db
        .select()
        .from(services)
        .where(and(eq(services.id, id), eq(services.machineId, machine.id)))
      if (!svc) return fail('not_found', '服务不存在')
      stopService(ctx, svc)
      return reply.status(204).send()
    })

    // 打开 in a card (also the iframe src): members hop to the preview origin with a one-time code.
    app.get('/api/previews/:id/open', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const { id } = req.params as { id: string }
      const { path = '/' } = z.object({ path: z.string().startsWith('/').optional() }).parse(req.query)
      const preview = await requireWebPreview(ctx, id)
      await requireMember(ctx, preview.groupId, user.id)
      const code = issueCode(ctx, preview.id, { userId: user.id })
      const target = `${previewOrigin(ctx, preview, req)}/__gg/auth?code=${code}&return=${encodeURIComponent(path)}`
      return reply.redirect(target, 302)
    })
  }
}
