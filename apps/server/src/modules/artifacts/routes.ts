import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  type AnnotationDto,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ArtifactCommandReq,
  type ArtifactDesignSystem,
  type ArtifactDto,
  ArtifactEditReq,
  ArtifactFavoritesReq,
  type ArtifactManifestRes,
  ArtifactPatchReq,
  type ArtifactShareDto,
  ArtifactShareReq,
  ArtifactSubmitReq,
  type ArtifactSubmitRes,
  type ArtifactUploadRes,
  type ArtifactVersionDetail,
  type ArtifactVersionSummary,
  CreateAnnotationReq,
  type MessageDto,
  SendAnnotationsReq,
  SYNC_BLOB_CONTENT_TYPE,
  SyncHash,
  SyncMissingReq,
  type SyncMissingRes,
  UpdateAnnotationReq,
} from '@gonggong/protocol'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { artifacts, artifactVersions, bots, runs } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { QuotaExceeded } from '../../lib/blob-store.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { previewOrigin } from '../previews/routes.js'
import { publishRun } from '../runs/dto.js'
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from './annotations.js'
import { artifactBlobs, artifactQuota } from './blobs.js'
import { sendAnnotations, sendCommand } from './commands.js'
import { applyEdits, uploadImage } from './edits.js'
import { exportZip } from './export.js'
import { pluginDesignSystems } from './kit.js'
import {
  type Artifact,
  artifactDetail,
  duplicateArtifact,
  findArtifact,
  listArtifacts,
  listVersions,
  refreshCard,
  renameArtifact,
  requireArtifact,
  requireVersion,
  restoreVersion,
  submitVersion,
  versionDetail,
} from './service.js'
import { openArtifactPreview, setShare, shareState } from './share.js'

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

async function readAll(body: Readable, max: number, tooLarge: () => never) {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of body) {
    n += (c as Buffer).length
    if (n > max) tooLarge()
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

/** Hosted artifacts (docs/plan/产物托管与编辑-开发计划.md S1): daemon checkout / upload, members' reads. */
export function artifactRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    // Raw (optionally gzip) bytes streamed to disk; the store enforces the size limit.
    // Images are read by the routes (uploads refuse SVG themselves).
    app.addContentTypeParser(
      [SYNC_BLOB_CONTENT_TYPE, 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
      (_req, payload, done) => done(null, payload),
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
        // The run card shows the versions it made (RunDto.artifacts); they may arrive after it ended.
        if (out.version.source === 'run') await publishRun(ctx, run)
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
          const png = await readAll(body, THUMBNAIL_MAX_BYTES, () =>
            fail('invalid', '缩略图不能超过 {mb} MB', { mb: THUMBNAIL_MAX_BYTES / 1024 / 1024 }),
          )
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

    app.get<{ Params: { id: string }; Querystring: { version?: string } }>(
      '/api/artifacts/:id/export.zip',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        const out = await exportZip(ctx, a, await requireVersion(ctx.db, a, req.query.version || null))
        return reply
          .headers({
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${out.name}"`,
            'cache-control': 'private, no-cache',
          })
          .send(out.body)
      },
    )

    app.get<{ Params: { id: string } }>(
      '/api/artifacts/:id/share',
      async (req): Promise<ArtifactShareDto> => {
        const me = await requireUser(ctx, req)
        return shareState(ctx, await requireArtifact(ctx, req.params.id, me.id), req)
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/artifacts/:id/share',
      async (req): Promise<ArtifactShareDto> => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        return setShare(ctx, me, a, ArtifactShareReq.parse(req.body).enabled, req)
      },
    )

    // ── editing (S2) ──
    app.post<{ Params: { id: string } }>('/api/artifacts/:id/edits', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const a = await requireArtifact(ctx, req.params.id, me.id)
      const body = ArtifactEditReq.parse(req.body)
      try {
        await applyEdits(ctx, a, me.id, body)
      } catch (e) {
        if (!(e instanceof QuotaExceeded)) throw e
        return quotaFull(reply)
      }
      return artifactDetail(ctx, (await findArtifact(ctx.db, a.id)) as Artifact)
    })

    app.get<{ Params: { id: string } }>(
      '/api/artifacts/:id/design-systems',
      async (req): Promise<ArtifactDesignSystem[]> => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        return pluginDesignSystems(ctx.db, a.pluginVersionId)
      },
    )

    app.post<{ Params: { id: string } }>('/api/artifacts/:id/uploads', async (req, reply) => {
      const body = req.body as Readable | undefined
      try {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        if (!body || typeof body.pipe !== 'function')
          return fail('invalid', '只能上传 PNG、JPG、WebP 或 GIF 图片')
        const bytes = await readAll(body, ARTIFACT_UPLOAD_MAX_BYTES, () =>
          fail('invalid', '图片不能超过 {mb} MB', { mb: ARTIFACT_UPLOAD_MAX_BYTES / 1024 / 1024 }),
        )
        const out: ArtifactUploadRes = await uploadImage(a, req.headers['content-type'], bytes)
        return out
      } catch (e) {
        if (!(e instanceof QuotaExceeded)) throw e
        return quotaFull(reply)
      } finally {
        body?.resume?.()
      }
    })

    app.patch<{ Params: { id: string } }>('/api/artifacts/:id', async (req): Promise<ArtifactDto> => {
      const me = await requireUser(ctx, req)
      const a = await requireArtifact(ctx, req.params.id, me.id)
      return artifactDetail(ctx, await renameArtifact(ctx, a, ArtifactPatchReq.parse(req.body).title))
    })

    app.post<{ Params: { id: string } }>(
      '/api/artifacts/:id/duplicate',
      async (req): Promise<ArtifactDto> => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        return artifactDetail(ctx, await duplicateArtifact(ctx, a, me.id))
      },
    )

    app.put<{ Params: { id: string } }>('/api/artifacts/:id/favorites', async (req): Promise<ArtifactDto> => {
      const me = await requireUser(ctx, req)
      const a = await requireArtifact(ctx, req.params.id, me.id)
      const { screenIds } = ArtifactFavoritesReq.parse(req.body)
      const [updated] = await ctx.db
        .update(artifacts)
        .set({ favorites: [...new Set(screenIds)] })
        .where(eq(artifacts.id, a.id))
        .returning()
      return artifactDetail(ctx, updated as Artifact)
    })

    app.post<{ Params: { id: string } }>('/api/artifacts/:id/archive', async (req): Promise<ArtifactDto> => {
      const me = await requireUser(ctx, req)
      const a = await requireArtifact(ctx, req.params.id, me.id)
      const [updated] = await ctx.db
        .update(artifacts)
        .set({ archivedAt: a.archivedAt ?? ctx.now() })
        .where(eq(artifacts.id, a.id))
        .returning()
      return artifactDetail(ctx, updated as Artifact)
    })

    app.post<{ Params: { id: string } }>('/api/artifacts/:id/commands', async (req): Promise<MessageDto> => {
      const me = await requireUser(ctx, req)
      const a = await requireArtifact(ctx, req.params.id, me.id)
      return sendCommand(ctx, me, a, ArtifactCommandReq.parse(req.body))
    })

    // ── annotations ──
    app.get<{ Params: { id: string }; Querystring: { version?: string } }>(
      '/api/artifacts/:id/annotations',
      async (req): Promise<AnnotationDto[]> => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        return listAnnotations(ctx, a, req.query.version || undefined)
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/artifacts/:id/annotations',
      async (req): Promise<AnnotationDto> => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        return createAnnotation(ctx, me, a, CreateAnnotationReq.parse(req.body))
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/artifacts/:id/annotations/send',
      async (req): Promise<MessageDto> => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        return sendAnnotations(ctx, me, a, SendAnnotationsReq.parse(req.body))
      },
    )

    app.patch<{ Params: { id: string } }>('/api/annotations/:id', async (req): Promise<AnnotationDto> => {
      const me = await requireUser(ctx, req)
      return updateAnnotation(ctx, me, req.params.id, UpdateAnnotationReq.parse(req.body))
    })

    app.delete<{ Params: { id: string } }>('/api/annotations/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      await deleteAnnotation(ctx, me.id, req.params.id)
      return reply.status(204).send()
    })
  }
}
