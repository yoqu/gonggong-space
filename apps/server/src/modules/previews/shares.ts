import { CreatePreviewShareReq, type PreviewShareDto, UpdatePreviewShareReq } from '@gonggong/protocol'
import { and, desc, eq, gt, isNull, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groups, previewShares, previews, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { newToken, sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { sysParams } from '../admin/params.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { previewOrigin, requireOpenPreview, requireWebPreview } from './routes.js'
import { requireManager } from './service.js'

type Preview = typeof previews.$inferSelect
const DAY = 86400_000

async function listShares(ctx: Ctx, where?: SQL): Promise<PreviewShareDto[]> {
  const creator = alias(users, 'creator')
  const rows = await ctx.db
    .select({
      s: previewShares,
      p: previews,
      groupName: groups.name,
      botName: bots.name,
      createdByName: creator.name,
    })
    .from(previewShares)
    .innerJoin(previews, eq(previews.id, previewShares.previewId))
    .innerJoin(groups, eq(groups.id, previews.groupId))
    .innerJoin(bots, eq(bots.id, previews.botId))
    .innerJoin(creator, eq(creator.id, previewShares.createdBy))
    .where(where)
    .orderBy(desc(previewShares.createdAt))
  const now = ctx.now()
  return rows.map(({ s, p, groupName, botName, createdByName }) => ({
    id: s.id,
    previewId: p.id,
    previewTitle: p.title,
    groupId: p.groupId,
    groupName,
    botName,
    createdByName,
    expiresAt: s.expiresAt.toISOString(),
    revokedAt: s.revokedAt?.toISOString() ?? null,
    visitCount: s.visitCount,
    lastVisitAt: s.lastVisitAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    active: !s.revokedAt && s.expiresAt > now && !p.closedAt,
  }))
}

const byId = async (ctx: Ctx, id: string) => (await listShares(ctx, eq(previewShares.id, id)))[0]

/** Valid links let their visitor in; checked on every request so a revoke or expiry takes effect at once. */
export async function shareAllows(ctx: Ctx, shareId: string, previewId: string) {
  const [row] = await ctx.db
    .select({ id: previewShares.id })
    .from(previewShares)
    .where(
      and(
        eq(previewShares.id, shareId),
        eq(previewShares.previewId, previewId),
        isNull(previewShares.revokedAt),
        gt(previewShares.expiresAt, ctx.now()),
      ),
    )
  return !!row
}

/** `/__gg/share/<token>` on the preview origin: counts the visit and returns the share id, or null when not valid. */
export async function redeemShare(ctx: Ctx, preview: Preview, token: string) {
  const [s] = await ctx.db
    .update(previewShares)
    .set({ visitCount: sql`${previewShares.visitCount} + 1`, lastVisitAt: ctx.now() })
    .where(
      and(
        eq(previewShares.tokenHash, sha256(token)),
        eq(previewShares.previewId, preview.id),
        isNull(previewShares.revokedAt),
        gt(previewShares.expiresAt, ctx.now()),
      ),
    )
    .returning()
  if (!s) return null
  await audit(ctx, {
    category: 'preview',
    action: 'share.visit',
    groupId: preview.groupId,
    detail: { shareId: s.id, previewId: preview.id, title: preview.title },
  })
  return s.id
}

async function requireShare(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ s: previewShares, p: previews })
    .from(previewShares)
    .innerJoin(previews, eq(previews.id, previewShares.previewId))
    .where(eq(previewShares.id, idParam(id, '公开链接不存在')))
  return row ?? fail('not_found', '公开链接不存在')
}

export function shareRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post('/api/previews/:id/shares', async (req) => {
      const user = await requireUser(ctx, req)
      const preview = await requireWebPreview(ctx, (req.params as { id: string }).id)
      await requireManager(ctx, preview.groupId, preview.botId, user.id)
      const { days } = CreatePreviewShareReq.parse(req.body ?? {})
      const { previewShareMaxDays } = await sysParams(ctx.db)
      if (days > previewShareMaxDays)
        fail('invalid', '公开链接最长有效 {days} 天', { days: previewShareMaxDays })
      const token = newToken('ps')
      const expiresAt = new Date(ctx.now().getTime() + days * DAY)
      const [{ id }] = (await ctx.db
        .insert(previewShares)
        .values({ previewId: preview.id, tokenHash: sha256(token), createdBy: user.id, expiresAt })
        .returning({ id: previewShares.id })) as [{ id: string }]
      await audit(ctx, {
        category: 'preview',
        actorUserId: user.id,
        action: 'share.create',
        groupId: preview.groupId,
        detail: { shareId: id, previewId: preview.id, title: preview.title, days },
      })
      return { share: await byId(ctx, id), url: `${previewOrigin(ctx, preview, req)}/__gg/share/${token}` }
    })

    app.get('/api/previews/:id/shares', async (req) => {
      const user = await requireUser(ctx, req)
      const preview = await requireOpenPreview(ctx, (req.params as { id: string }).id)
      await requireManager(ctx, preview.groupId, preview.botId, user.id)
      return listShares(ctx, eq(previewShares.previewId, preview.id))
    })

    app.post('/api/preview-shares/:id/revoke', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const { s, p } = await requireShare(ctx, (req.params as { id: string }).id)
      if (user.role !== 'sysadmin') await requireManager(ctx, p.groupId, p.botId, user.id)
      if (!s.revokedAt) {
        await ctx.db.update(previewShares).set({ revokedAt: ctx.now() }).where(eq(previewShares.id, s.id))
        await audit(ctx, {
          category: 'preview',
          actorUserId: user.id,
          action: 'share.revoke',
          groupId: p.groupId,
          detail: { shareId: s.id, previewId: p.id, title: p.title },
        })
      }
      return reply.status(204).send()
    })

    app.get('/api/admin/preview-shares', async (req) => {
      await requireSysadmin(ctx, req)
      return listShares(ctx)
    })

    app.patch('/api/admin/preview-shares/:id', async (req) => {
      const admin = await requireSysadmin(ctx, req)
      const { s, p } = await requireShare(ctx, (req.params as { id: string }).id)
      const expiresAt = new Date(UpdatePreviewShareReq.parse(req.body).expiresAt)
      const { previewShareMaxDays } = await sysParams(ctx.db)
      if (expiresAt.getTime() > ctx.now().getTime() + previewShareMaxDays * DAY)
        fail('invalid', '公开链接最长有效 {days} 天', { days: previewShareMaxDays })
      await ctx.db.update(previewShares).set({ expiresAt }).where(eq(previewShares.id, s.id))
      await audit(ctx, {
        category: 'preview',
        actorUserId: admin.id,
        action: 'share.extend',
        groupId: p.groupId,
        detail: { shareId: s.id, previewId: p.id, title: p.title, expiresAt: expiresAt.toISOString() },
      })
      return byId(ctx, s.id)
    })
  }
}
