import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  type ArtifactDto,
  type ArtifactManifestRes,
  ArtifactSubmitReq,
  type ArtifactSubmitRes,
  type ArtifactVersionDetail,
  type ArtifactVersionSummary,
  SYNC_BLOB_CONTENT_TYPE,
  SyncHash,
  SyncMissingReq,
  type SyncMissingRes,
} from '@gonggong/protocol'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { artifactVersions, bots, previews, runs } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { QuotaExceeded } from '../../lib/blob-store.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { openPortListener } from '../previews/gateway.js'
import { previewOrigin } from '../previews/routes.js'
import { newSlug } from '../previews/service.js'
import { artifactBlobs, artifactQuota } from './blobs.js'
import {
  type Artifact,
  artifactDetail,
  findArtifact,
  listArtifacts,
  listVersions,
  refreshCard,
  requireArtifact,
  requireVersion,
  restoreVersion,
  submitVersion,
  versionDetail,
} from './service.js'

const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

type RunArtifactReq = FastifyRequest<{ Params: { runId: string; id: string; hash?: string; vid?: string } }>

/** The run is of a bot on this machine and its run.start sent the artifact. */
async function requireRunArtifact(ctx: Ctx, req: RunArtifactReq) {
  const machine = await requireMachine(ctx, req)
  const runId = idParam(req.params.runId, '运行不存在')
  const [row] = await ctx.db
    .select({ run: runs })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(runs.id, runId), eq(bots.machineId, machine.id)))
  if (!row) return fail('not_found', '运行不存在')
  const a = await findArtifact(ctx.db, req.params.id)
  if (!a || a.groupId !== row.run.groupId || !row.run.artifacts.includes(a.id))
    return fail('forbidden', '本轮没有下发这个产物')
  return { run: row.run, a }
}

const hashParam = (hash: string | undefined) => {
  const r = SyncHash.safeParse(hash)
  return r.success ? r.data : fail('invalid', '哈希无效')
}

/** Content some version of the artifact lists (or shows as its thumbnail). */
async function referenced(ctx: Ctx, a: Artifact, hash: string) {
  const [hit] = await ctx.db
    .select({ id: artifactVersions.id })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, a.id),
        sql`(${artifactVersions.files} @> ${JSON.stringify([{ hash }])}::jsonb or ${artifactVersions.thumbnailHash} = ${hash})`,
      ),
    )
    .limit(1)
  return !!hit
}

async function readAll(body: Readable, max: number) {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of body) {
    n += (c as Buffer).length
    if (n > max) fail('invalid', '缩略图不能超过 {mb} MB', { mb: max / 1024 / 1024 })
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}

const quotaFull = (reply: FastifyReply) =>
  reply.status(413).send({
    error: 'invalid',
    message: t('群的产物存储已超过 {gb} GB 上限', { gb: artifactQuota.bytes / 1024 ** 3 }),
  })

const PreviewReq = z.object({ versionId: z.string().nullable().optional() })

/** Opens the artifact's preview (one following the head, one per pinned version), reusing an open one. */
async function openArtifactPreview(ctx: Ctx, a: Artifact, versionId: string | null) {
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

/** Hosted artifacts (docs/plan/产物托管与编辑-开发计划.md S1): daemon checkout / upload, members' reads. */
export function artifactRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    // Raw (optionally gzip) bytes streamed to disk; the store enforces the size limit.
    app.addContentTypeParser([SYNC_BLOB_CONTENT_TYPE, 'image/png'], (_req, payload, done) =>
      done(null, payload),
    )

    // ── daemon (machine token) ──
    app.get<{ Params: { id: string; vid: string } }>(
      '/api/daemon/artifacts/:id/versions/:vid',
      async (req): Promise<ArtifactManifestRes> => {
        const machine = await requireMachine(ctx, req)
        const a = (await findArtifact(ctx.db, req.params.id)) ?? fail('not_found', '产物不存在')
        const [sent] = await ctx.db
          .select({ id: runs.id })
          .from(runs)
          .innerJoin(bots, eq(bots.id, runs.botId))
          .where(
            and(
              eq(bots.machineId, machine.id),
              eq(runs.groupId, a.groupId),
              sql`${runs.artifacts} @> ${JSON.stringify([a.id])}::jsonb`,
            ),
          )
          .limit(1)
        if (!sent) return fail('forbidden', '本轮没有下发这个产物')
        const v = await requireVersion(ctx.db, a, req.params.vid)
        return { versionId: v.id, files: v.files }
      },
    )

    app.put('/api/daemon/runs/:runId/artifacts/:id/blobs/:hash', async (req: RunArtifactReq, reply) => {
      const body = req.body as Readable
      try {
        const { a } = await requireRunArtifact(ctx, req)
        const hash = hashParam(req.params.hash)
        if ((await artifactBlobs.touch(a.groupId, hash)) === null)
          await artifactBlobs.write(a.groupId, hash, body, req.headers['content-encoding'] === 'gzip')
      } catch (e) {
        if (!(e instanceof QuotaExceeded)) throw e
        return quotaFull(reply)
      } finally {
        body.resume()
      }
      return reply.status(204).send()
    })

    app.get('/api/daemon/runs/:runId/artifacts/:id/blobs/:hash', async (req: RunArtifactReq, reply) => {
      const { a } = await requireRunArtifact(ctx, req)
      const hash = hashParam(req.params.hash)
      if (!(await referenced(ctx, a, hash))) return fail('not_found', '文件内容不存在')
      return reply
        .header('content-type', SYNC_BLOB_CONTENT_TYPE)
        .send(await artifactBlobs.open(a.groupId, hash))
    })

    app.post(
      '/api/daemon/runs/:runId/artifacts/:id/blobs/missing',
      async (req: RunArtifactReq): Promise<SyncMissingRes> => {
        const { a } = await requireRunArtifact(ctx, req)
        const { hashes } = SyncMissingReq.parse(req.body)
        const sizes = await Promise.all(hashes.map((h) => artifactBlobs.touch(a.groupId, h)))
        return { missing: hashes.filter((_, i) => sizes[i] === null) }
      },
    )

    app.post(
      '/api/daemon/runs/:runId/artifacts/:id/versions',
      async (req: RunArtifactReq): Promise<ArtifactSubmitRes> => {
        const { run, a } = await requireRunArtifact(ctx, req)
        const body = ArtifactSubmitReq.parse(req.body)
        const out = await submitVersion(ctx, a, {
          parent: body.parentVersionId,
          submitKey: body.submitKey,
          files: body.files,
          source: body.source,
          runId: run.id,
          userId: null,
        })
        return { versionId: out.version.id, n: out.version.n, head: out.head, stale: out.stale }
      },
    )

    app.put(
      '/api/daemon/runs/:runId/artifacts/:id/versions/:vid/thumbnail',
      async (req: RunArtifactReq, reply) => {
        const body = req.body as Readable
        try {
          const { a } = await requireRunArtifact(ctx, req)
          const v = await requireVersion(ctx.db, a, req.params.vid)
          const png = await readAll(body, THUMBNAIL_MAX_BYTES)
          const hash = createHash('sha256').update(png).digest('hex')
          if ((await artifactBlobs.touch(a.groupId, hash)) === null)
            await artifactBlobs.write(a.groupId, hash, Readable.from([png]), false)
          await ctx.db
            .update(artifactVersions)
            .set({ thumbnailHash: hash })
            .where(eq(artifactVersions.id, v.id))
          if (v.id === a.headVersionId) await refreshCard(ctx, a.id)
        } catch (e) {
          if (!(e instanceof QuotaExceeded)) throw e
          return quotaFull(reply)
        } finally {
          body.resume()
        }
        return reply.status(204).send()
      },
    )

    // ── members ──
    app.get<{ Params: { id: string } }>('/api/groups/:id/artifacts', async (req): Promise<ArtifactDto[]> => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      return listArtifacts(ctx, req.params.id)
    })

    app.get<{ Params: { id: string } }>('/api/artifacts/:id', async (req): Promise<ArtifactDto> => {
      const me = await requireUser(ctx, req)
      return artifactDetail(ctx, await requireArtifact(ctx, req.params.id, me.id))
    })

    app.get<{ Params: { id: string } }>(
      '/api/artifacts/:id/versions',
      async (req): Promise<ArtifactVersionSummary[]> => {
        const me = await requireUser(ctx, req)
        return listVersions(ctx, await requireArtifact(ctx, req.params.id, me.id))
      },
    )

    app.get<{ Params: { id: string; vid: string } }>(
      '/api/artifacts/:id/versions/:vid',
      async (req): Promise<ArtifactVersionDetail> => {
        const me = await requireUser(ctx, req)
        return versionDetail(ctx, await requireArtifact(ctx, req.params.id, me.id), req.params.vid)
      },
    )

    app.post<{ Params: { id: string; vid: string } }>(
      '/api/artifacts/:id/versions/:vid/restore',
      async (req): Promise<ArtifactDto> => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        await restoreVersion(ctx, a, req.params.vid)
        return artifactDetail(ctx, (await findArtifact(ctx.db, a.id)) as Artifact)
      },
    )

    app.get<{ Params: { id: string; vid: string } }>(
      '/api/artifacts/:id/versions/:vid/thumbnail',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        const v = await requireVersion(ctx.db, a, req.params.vid)
        if (!v.thumbnailHash) return fail('not_found', '还没有截图')
        return reply
          .headers({
            'content-type': 'image/png',
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, no-cache',
          })
          .send(await artifactBlobs.open(a.groupId, v.thumbnailHash))
      },
    )

    // Source for the code view: always plain text, never rendered on the main site.
    app.get<{ Params: { id: string; '*': string }; Querystring: { version?: string } }>(
      '/api/artifacts/:id/files/*',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        const v = await requireVersion(ctx.db, a, req.query.version)
        const file = v.files.find((f) => f.path === req.params['*']) ?? fail('not_found', '文件不存在')
        return reply
          .headers({
            'content-type': 'text/plain; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
            'cache-control': 'private, no-cache',
          })
          .send(await artifactBlobs.open(a.groupId, file.hash))
      },
    )

    app.post<{ Params: { id: string } }>('/api/artifacts/:id/preview', async (req) => {
      const me = await requireUser(ctx, req)
      const a = await requireArtifact(ctx, req.params.id, me.id)
      const { versionId = null } = PreviewReq.parse(req.body ?? {})
      const p = await openArtifactPreview(ctx, a, versionId)
      return { previewId: p.id, origin: previewOrigin(ctx, p, req), url: `/api/previews/${p.id}/open` }
    })
  }
}
