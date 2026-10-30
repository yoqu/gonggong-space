import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  type AnnotationDto,
  ArtifactCommandReq,
  type ArtifactDesignSystem,
  type ArtifactDto,
  ArtifactEditReq,
  ArtifactFavoritesReq,
  type ArtifactManifestRes,
  ArtifactPatchReq,
  ArtifactScreenId,
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
import { applyEdits, UPLOAD_READ_MAX, uploadFile } from './edits.js'
import { exportZip } from './export.js'
import { pluginDesignSystems } from './kit.js'
import {
  type Artifact,
  artifactDetail,
  duplicateArtifact,
  findArtifact,
  listArtifacts,
  listVersions,
  manifestOf,
  refreshCard,
  renameArtifact,
  requireArtifact,
  requireVersion,
  restoreVersion,
  submitVersion,
  versionDetail,
} from './service.js'
import { openArtifactPreview, setShare, shareState } from './share.js'
import { snapshotPending } from './snapshots.js'

const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

type RunArtifactReq = FastifyRequest<{
  Params: { runId: string; id: string; hash?: string; vid?: string; screenId?: string }
}>

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

/** The artifact's bot runs on this machine, or a run of a bot on it was sent the artifact. */
async function requireMachineArtifact(ctx: Ctx, req: FastifyRequest<{ Params: { id: string } }>) {
  const machine = await requireMachine(ctx, req)
  const a = (await findArtifact(ctx.db, req.params.id)) ?? fail('not_found', '产物不存在')
  const [own] = a.botId
    ? await ctx.db
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.id, a.botId), eq(bots.machineId, machine.id)))
    : []
  if (own) return a
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
  return sent ? a : fail('forbidden', '本轮没有下发这个产物')
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

/** A daemon's screenshot into the group's artifact store; its hash. */
async function storePng(a: Artifact, body: Readable) {
  const png = await readAll(body, THUMBNAIL_MAX_BYTES, () =>
    fail('invalid', '缩略图不能超过 {mb} MB', { mb: THUMBNAIL_MAX_BYTES / 1024 / 1024 }),
  )
  const hash = createHash('sha256').update(png).digest('hex')
  if ((await artifactBlobs.touch(a.groupId, hash)) === null)
    await artifactBlobs.write(a.groupId, hash, Readable.from([png]), false)
  return hash
}

const PNG_HEADERS = {
  'content-type': 'image/png',
  'x-content-type-options': 'nosniff',
  'cache-control': 'private, no-cache',
}

const PreviewReq = z.object({ versionId: z.string().nullable().optional() })

/** Hosted artifacts (docs/plan/产物托管与编辑-开发计划.md S1): daemon checkout / upload, members' reads. */
export function artifactRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    // Raw (optionally gzip) bytes streamed to disk; the store enforces the size limit.
    // Uploads are read by the routes (they refuse SVG themselves). Text uploads too: none of these routes takes
    // text/plain otherwise (this plugin's scope only).
    app.removeContentTypeParser('text/plain')
    app.addContentTypeParser(
      [
        SYNC_BLOB_CONTENT_TYPE,
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'image/svg+xml',
        'application/pdf',
        'text/plain',
        'text/markdown',
      ],
      (_req, payload, done) => done(null, payload),
    )

    const pending = new Set<Promise<unknown>>()
    const onMachine = (machineId: string) => {
      const p = snapshotPending(ctx, eq(bots.machineId, machineId))
        .catch((err) => app.log.error(err))
        .finally(() => pending.delete(p))
      pending.add(p)
    }
    ctx.hub.on('online', onMachine)
    app.addHook('onClose', async () => {
      ctx.hub.off('online', onMachine)
      await Promise.all(pending)
    })

    // ── daemon (machine token) ──
    app.get<{ Params: { id: string; vid: string } }>(
      '/api/daemon/artifacts/:id/versions/:vid',
      async (req): Promise<ArtifactManifestRes> => {
        const a = await requireMachineArtifact(ctx, req)
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

    const sendBlob = async (a: Artifact, hash: string | undefined, reply: FastifyReply) => {
      const h = hashParam(hash)
      if (!(await referenced(ctx, a, h))) return fail('not_found', '文件内容不存在')
      return reply.header('content-type', SYNC_BLOB_CONTENT_TYPE).send(await artifactBlobs.open(a.groupId, h))
    }
    app.get('/api/daemon/runs/:runId/artifacts/:id/blobs/:hash', async (req: RunArtifactReq, reply) =>
      sendBlob((await requireRunArtifact(ctx, req)).a, req.params.hash, reply),
    )
    // artifact.snapshot: the machine fetches a version it did not make, outside any run.
    app.get<{ Params: { id: string; hash: string } }>(
      '/api/daemon/artifacts/:id/blobs/:hash',
      async (req, reply) => sendBlob(await requireMachineArtifact(ctx, req), req.params.hash, reply),
    )

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

    type ShotReq = FastifyRequest<{
      Params: { runId?: string; id: string; vid: string; screenId?: string }
    }>
    /** Stores a screenshot PUT by `auth`'s machine (a run's or the artifact's bot's). */
    const shot =
      (
        auth: (req: ShotReq) => Promise<Artifact>,
        save: (a: Artifact, req: ShotReq, png: Readable) => Promise<void>,
      ) =>
      async (req: ShotReq, reply: FastifyReply) => {
        const body = req.body as Readable
        try {
          await save(await auth(req), req, body)
        } catch (e) {
          if (!(e instanceof QuotaExceeded)) throw e
          return quotaFull(reply)
        } finally {
          body.resume()
        }
        return reply.status(204).send()
      }
    // One PNG per screen of the version's manifest (the canvas's 复制为 PNG); a retake replaces the screen's.
    const saveScreen = async (a: Artifact, req: ShotReq, body: Readable) => {
      const v = await requireVersion(ctx.db, a, req.params.vid)
      const screenId = ArtifactScreenId.safeParse(req.params.screenId)
      const manifest = await manifestOf(a, v)
      if (!screenId.success || !manifest?.screens.some((s) => s.id === screenId.data))
        return fail('not_found', '屏幕不存在')
      const hash = await storePng(a, body)
      const thumbs = [
        ...v.screenThumbs.filter((x) => x.screenId !== screenId.data),
        { screenId: screenId.data, hash },
      ]
      await ctx.db.update(artifactVersions).set({ screenThumbs: thumbs }).where(eq(artifactVersions.id, v.id))
    }
    const saveThumbnail = async (a: Artifact, req: ShotReq, body: Readable) => {
      const v = await requireVersion(ctx.db, a, req.params.vid)
      const hash = await storePng(a, body)
      await ctx.db.update(artifactVersions).set({ thumbnailHash: hash }).where(eq(artifactVersions.id, v.id))
      if (v.id === a.headVersionId) await refreshCard(ctx, a.id)
    }
    const byRun = async (req: ShotReq) => (await requireRunArtifact(ctx, req as RunArtifactReq)).a
    const byMachine = (req: ShotReq) => requireMachineArtifact(ctx, req)
    const runBase = '/api/daemon/runs/:runId/artifacts/:id/versions/:vid'
    const machineBase = '/api/daemon/artifacts/:id/versions/:vid'
    app.put(`${runBase}/screens/:screenId/thumbnail`, shot(byRun, saveScreen))
    app.put(`${runBase}/thumbnail`, shot(byRun, saveThumbnail))
    app.put(`${machineBase}/screens/:screenId/thumbnail`, shot(byMachine, saveScreen))
    app.put(`${machineBase}/thumbnail`, shot(byMachine, saveThumbnail))

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
        return reply.headers(PNG_HEADERS).send(await artifactBlobs.open(a.groupId, v.thumbnailHash))
      },
    )

    app.get<{ Params: { id: string; vid: string; screenId: string } }>(
      '/api/artifacts/:id/versions/:vid/screens/:screenId/thumbnail',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const a = await requireArtifact(ctx, req.params.id, me.id)
        const v = await requireVersion(ctx.db, a, req.params.vid)
        const shot =
          v.screenThumbs.find((x) => x.screenId === req.params.screenId) ?? fail('not_found', '还没有截图')
        return reply.headers(PNG_HEADERS).send(await artifactBlobs.open(a.groupId, shot.hash))
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
          return fail('invalid', '只能上传图片（PNG、JPG、WebP、GIF）、PDF 或文本文件')
        const bytes = await readAll(body, UPLOAD_READ_MAX, () =>
          fail('invalid', '文件不能超过 {mb} MB', { mb: UPLOAD_READ_MAX / 1024 / 1024 }),
        )
        const out: ArtifactUploadRes = await uploadFile(a, req.headers['content-type'], bytes)
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
