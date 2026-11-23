import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import {
  ArtifactSubmitReq,
  type ArtifactSubmitRes,
  type PreviewHostRes,
  SiteOpenReq,
  type SiteOpenRes,
  SYNC_BLOB_CONTENT_TYPE,
  SyncHash,
  SyncMissingReq,
  type SyncMissingRes,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { artifacts, bots, groups, messages, services } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { QuotaExceeded } from '../../lib/blob-store.js'
import { fail, HttpError } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { activeBots } from '../groups/service.js'
import {
  type MessageMeta,
  type MessageRow,
  messageDto,
  postEvent,
  publishMessage,
} from '../messages/service.js'
import { requireOpenPreview } from '../previews/routes.js'
import { requireManager } from '../previews/service.js'
import { machineRun } from '../runs/machine-run.js'
import { triggerRuns } from '../runs/trigger.js'
import { artifactBlobs, artifactQuota } from './blobs.js'
import { type Artifact, cardOf, findArtifact, newArtifactDir, submitVersion } from './service.js'

// Hosted sites (托管网页): a static build on a bot's machine kept as an L0 artifact, so 作品 serves it from the
// server's blobs while that machine is offline. The same (group, bot, dir) hosted again adds a version.

/** The daemon walks, hashes and uploads up to 200 MB before it answers site.host. */
const HOST_TIMEOUT_MS = 5 * 60_000
/** Prefix of a static service's command (daemon `start_static`); its `cwd` is the dir it serves. */
const STATIC_COMMAND = '静态站点 '

/** The site artifact of `botId`'s `siteDir` in the group, made (with its card) on first use. */
export async function openSite(
  ctx: Ctx,
  s: { groupId: string; botId: string; siteDir: string; title: string; userId: string | null },
) {
  // A static service keeps its dir as given (`./dist/`); preview_host sends it resolved (`dist`).
  const siteDir = s.siteDir
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
    .replace(/^\.$/, '')
  const [found] = await ctx.db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.groupId, s.groupId),
        eq(artifacts.botId, s.botId),
        eq(artifacts.siteDir, siteDir),
        isNull(artifacts.archivedAt),
      ),
    )
    .limit(1)
  if (found) return found
  const [group] = await ctx.db.select({ kind: groups.kind }).from(groups).where(eq(groups.id, s.groupId))
  const [made] = (await ctx.db
    .insert(artifacts)
    .values({
      groupId: s.groupId,
      title: s.title,
      dir: newArtifactDir('site'),
      botId: s.botId,
      siteDir,
      kind: 'site',
      visibility: group?.kind === 'dm' ? 'private' : 'group',
      createdBy: s.userId,
    })
    .returning()) as [Artifact]
  const posted = await postEvent(
    ctx,
    s.groupId,
    '托管网页「{title}」',
    { title: made.title },
    { card: await cardOf(ctx.db, made) },
  )
  await ctx.db.update(artifacts).set({ messageId: posted.id }).where(eq(artifacts.id, made.id))
  return { ...made, messageId: posted.id }
}

/** A live site artifact whose bot runs on the requesting machine. */
async function requireSite(ctx: Ctx, req: FastifyRequest<{ Params: { id: string } }>) {
  const machine = await requireMachine(ctx, req)
  const a = await findArtifact(ctx.db, req.params.id)
  if (!a || a.siteDir === null || a.archivedAt || !a.botId) return fail('not_found', '产物不存在')
  const [own] = await ctx.db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.id, a.botId), eq(bots.machineId, machine.id)))
  return own ? a : fail('forbidden', '这台电脑不能上传这个网页')
}

/** 托管到服务器 of a dynamic preview: asks its bot, as the member, to build a static site and host it. */
async function askBot(
  ctx: Ctx,
  me: { id: string; name: string },
  groupId: string,
  botId: string,
  title: string,
) {
  const bot = (await activeBots(ctx, groupId)).find((b) => b.id === botId) ?? fail('invalid', 'Bot 不在本群')
  const meta: MessageMeta = { mentions: [bot.id], clientId: randomUUID() }
  const body = `@${bot.name} ${t('请把「{title}」构建成静态网页，并用 preview_host 托管到服务器', { title })}`
  const [row] = (await ctx.db
    .insert(messages)
    .values({ groupId, kind: 'user', authorUserId: me.id, body, meta })
    .returning()) as [MessageRow]
  await publishMessage(ctx, messageDto(row, me.name))
  await triggerRuns(ctx, row)
}

export function siteRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.addContentTypeParser(SYNC_BLOB_CONTENT_TYPE, (_req, payload, done) => done(null, payload))

    app.post<{ Params: { runId: string } }>(
      '/api/daemon/runs/:runId/sites',
      async (req): Promise<SiteOpenRes> => {
        const run = await machineRun(ctx, req, { live: true })
        const { dir, title } = SiteOpenReq.parse(req.body)
        const a = await openSite(ctx, {
          groupId: run.groupId,
          botId: run.botId,
          siteDir: dir,
          title,
          userId: run.triggerUserId,
        })
        return { artifactId: a.id }
      },
    )

    app.put<{ Params: { id: string; hash: string } }>(
      '/api/daemon/artifacts/:id/blobs/:hash',
      async (req, reply) => {
        const body = req.body as Readable
        try {
          const a = await requireSite(ctx, req)
          const hash = SyncHash.safeParse(req.params.hash)
          if (!hash.success) return fail('invalid', '哈希无效')
          if ((await artifactBlobs.touch(a.groupId, hash.data)) === null)
            await artifactBlobs.write(a.groupId, hash.data, body, req.headers['content-encoding'] === 'gzip')
        } catch (e) {
          if (!(e instanceof QuotaExceeded)) throw e
          return reply.status(413).send({
            error: 'invalid',
            message: t('群的产物存储已超过 {gb} GB 上限', { gb: artifactQuota.bytes / 1024 ** 3 }),
          })
        } finally {
          body.resume()
        }
        return reply.status(204).send()
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/daemon/artifacts/:id/blobs/missing',
      async (req): Promise<SyncMissingRes> => {
        const a = await requireSite(ctx, req)
        const { hashes } = SyncMissingReq.parse(req.body)
        const sizes = await Promise.all(hashes.map((h) => artifactBlobs.touch(a.groupId, h)))
        return { missing: hashes.filter((_, i) => sizes[i] === null) }
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/daemon/artifacts/:id/versions',
      async (req): Promise<ArtifactSubmitRes> => {
        const a = await requireSite(ctx, req)
        const body = ArtifactSubmitReq.parse(req.body)
        if (body.source !== 'host') return fail('invalid', '只能上传托管网页')
        // A snapshot of the build: it replaces whatever the head is now.
        const out = await submitVersion(ctx, a, {
          parent: a.headVersionId,
          submitKey: body.submitKey,
          files: body.files,
          source: 'host',
          runId: null,
          userId: null,
        })
        return { versionId: out.version.id, n: out.version.n, head: out.head, stale: out.stale }
      },
    )

    app.post<{ Params: { id: string } }>('/api/previews/:id/host', async (req): Promise<PreviewHostRes> => {
      const me = await requireUser(ctx, req)
      const p = await requireOpenPreview(ctx, req.params.id)
      await requireManager(ctx, p.groupId, p.botId, me.id)
      if (p.kind !== 'http') return fail('invalid', '只有网页预览可以托管')
      const [service] = p.serviceId
        ? await ctx.db.select().from(services).where(eq(services.id, p.serviceId))
        : []
      if (!service?.command.startsWith(STATIC_COMMAND)) {
        await askBot(ctx, me, p.groupId, p.botId, p.title)
        return { asked: true }
      }
      if (!ctx.hub.features(p.machineId).includes('siteHost'))
        return fail('conflict', 'Bot 所在电脑的客户端版本过旧，请升级后再托管')
      const a = await openSite(ctx, {
        groupId: p.groupId,
        botId: p.botId,
        siteDir: service.cwd,
        title: p.title,
        userId: me.id,
      })
      const ask = {
        t: 'site.host',
        requestId: randomUUID(),
        serviceId: service.id,
        artifactId: a.id,
      } as const
      const res =
        (await ctx.hub.request(p.machineId, ask, 'site.host.result', HOST_TIMEOUT_MS)) ??
        fail('conflict', 'Bot 所在电脑未响应，请确认它在线后重试')
      if (res.error) throw new HttpError('invalid', res.error)
      return { artifactId: a.id }
    })
  }
}
