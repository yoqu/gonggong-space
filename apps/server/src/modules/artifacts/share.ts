import { type ArtifactShareDto, PREVIEW_SHARE_DEFAULT_DAYS } from '@gonggong/protocol'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { artifacts, bots, previewShares, previews } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { newToken, sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { openPortListener } from '../previews/gateway.js'
import { previewOrigin } from '../previews/routes.js'
import { newSlug, requireManager } from '../previews/service.js'
import { type Artifact, findArtifact, requireVersion } from './service.js'

const DAY = 86400_000
const OFF: ArtifactShareDto = { enabled: false, url: null, expiresAt: null }

/** Opens the artifact's preview (one following the head, one per pinned version), reusing an open one. */
export async function openArtifactPreview(ctx: Ctx, a: Artifact, versionId: string | null) {
  const v = versionId ? await requireVersion(ctx.db, a, versionId) : null
  const pinned = v ? eq(previews.artifactVersionId, v.id) : isNull(previews.artifactVersionId)
  const [open] = await ctx.db
    .select()
    .from(previews)
    .where(and(eq(previews.artifactId, a.id), pinned, isNull(previews.closedAt)))
    .limit(1)
  if (open) return open
  const [bot] = a.botId ? await ctx.db.select().from(bots).where(eq(bots.id, a.botId)) : []
  if (!bot?.machineId) return fail('conflict', '产物所属的 Bot 没有绑定机器')
  const [p] = await ctx.db
    .insert(previews)
    .values({
      slug: newSlug(),
      kind: 'artifact',
      machineId: bot.machineId,
      groupId: a.groupId,
      botId: bot.id,
      title: v ? `${a.title} v${v.n}` : a.title,
      artifactId: a.id,
      artifactVersionId: v?.id ?? null,
    })
    .returning()
  const preview = p as typeof previews.$inferSelect
  if (ctx.config.preview.domain) return preview
  return { ...preview, publicPort: await openPortListener(ctx, preview.id) }
}

/** The artifact's own share: the one its `shareToken` opens, while valid and its preview is open. */
async function liveShare(ctx: Ctx, a: Artifact) {
  if (!a.shareToken) return null
  const [row] = await ctx.db
    .select({ s: previewShares, p: previews })
    .from(previewShares)
    .innerJoin(previews, eq(previews.id, previewShares.previewId))
    .where(
      and(
        eq(previewShares.tokenHash, sha256(a.shareToken)),
        eq(previews.artifactId, a.id),
        isNull(previewShares.revokedAt),
        gt(previewShares.expiresAt, ctx.now()),
        isNull(previews.closedAt),
      ),
    )
  return row ?? null
}

/** GET /api/artifacts/:id/share. */
export async function shareState(ctx: Ctx, a: Artifact, req: FastifyRequest): Promise<ArtifactShareDto> {
  const live = await liveShare(ctx, a)
  if (!live || (await sysParams(ctx.db)).demoMode) return OFF
  return {
    enabled: true,
    url: `${previewOrigin(ctx, live.p, req)}/__gg/share/${a.shareToken}`,
    expiresAt: live.s.expiresAt.toISOString(),
  }
}

/**
 * POST /api/artifacts/:id/share (managers of the artifact's bot, like preview shares): on reuses the live link or
 * makes one to the head preview for the default days (capped by the system limit); off revokes it.
 */
export async function setShare(
  ctx: Ctx,
  me: { id: string },
  a: Artifact,
  enabled: boolean,
  req: FastifyRequest,
): Promise<ArtifactShareDto> {
  if (!enabled) {
    if (a.botId) await requireManager(ctx, a.groupId, a.botId, me.id)
    const live = await liveShare(ctx, a)
    if (live) {
      await ctx.db.update(previewShares).set({ revokedAt: ctx.now() }).where(eq(previewShares.id, live.s.id))
      await audit(ctx, {
        category: 'preview',
        actorUserId: me.id,
        action: 'share.revoke',
        groupId: a.groupId,
        detail: { shareId: live.s.id, previewId: live.p.id, title: live.p.title },
      })
    }
    await ctx.db.update(artifacts).set({ shareToken: null }).where(eq(artifacts.id, a.id))
    return OFF
  }
  const { previewShareMaxDays, demoMode } = await sysParams(ctx.db)
  if (demoMode) fail('forbidden', '演示模式下不能创建公开链接')
  const preview = await openArtifactPreview(ctx, a, null)
  await requireManager(ctx, preview.groupId, preview.botId, me.id)
  if (await liveShare(ctx, a)) return shareState(ctx, a, req)
  const days = Math.min(PREVIEW_SHARE_DEFAULT_DAYS, previewShareMaxDays)
  const token = newToken('ps')
  const [s] = await ctx.db
    .insert(previewShares)
    .values({
      previewId: preview.id,
      tokenHash: sha256(token),
      createdBy: me.id,
      expiresAt: new Date(ctx.now().getTime() + days * DAY),
    })
    .returning({ id: previewShares.id })
  await ctx.db.update(artifacts).set({ shareToken: token }).where(eq(artifacts.id, a.id))
  await audit(ctx, {
    category: 'preview',
    actorUserId: me.id,
    action: 'share.create',
    groupId: a.groupId,
    detail: { shareId: s?.id, previewId: preview.id, title: preview.title, days },
  })
  return shareState(ctx, (await findArtifact(ctx.db, a.id)) as Artifact, req)
}
