import type { Readable } from 'node:stream'
import {
  SYNC_BLOB_CONTENT_TYPE,
  SyncChangesQuery,
  type SyncChangesRes,
  type SyncConflictDto,
  SyncEnableReq,
  SyncHash,
  SyncJoinReq,
  SyncMissingReq,
  type SyncMissingRes,
  type SyncPreviewDto,
  type SyncStatusDto,
  type SyncVersionDto,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, groupBots, groups } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { groupDto, requireMember } from '../groups/service.js'
import { blobSize, openBlob, writeBlob } from './blobs.js'
import { openConflicts, syncStatus, syncVersionList } from './status.js'
import { changesSince } from './store.js'
import { disableSync, enableSync, joinReplica, syncPreview } from './switch.js'

type GroupReq = FastifyRequest<{ Params: { groupId: string; hash?: string } }>

const VersionsQuery = z.object({
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** Only a machine hosting a bot of the force group may read or write its sync data. */
async function requireReplicaMachine(ctx: Ctx, req: GroupReq) {
  const machine = await requireMachine(ctx, req)
  const groupId = idParam(req.params.groupId, '群不存在或你已不在群内')
  const [hosted] = await ctx.db
    .select({ id: bots.id })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(
      and(
        eq(groupBots.groupId, groupId),
        eq(bots.machineId, machine.id),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
        eq(groups.mode, 'force'),
        isNull(groups.archivedAt),
      ),
    )
    .limit(1)
  if (!hosted) return fail('forbidden', '该机器上没有这个强制同步群的 Bot')
  return groupId
}

const hashParam = (req: GroupReq) => {
  const r = SyncHash.safeParse(req.params.hash)
  return r.success ? r.data : fail('invalid', '哈希无效')
}

/** Force sync (docs/plan/强制同步-开发计划.md): blob store and changes for daemons (F15), status for members. */
export function syncRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    // Blobs arrive as raw (optionally gzip) bytes and are streamed to disk; writeBlob enforces the size limit.
    app.addContentTypeParser(SYNC_BLOB_CONTENT_TYPE, (_req, payload, done) => done(null, payload))

    app.put('/api/daemon/sync/:groupId/blobs/:hash', async (req: GroupReq, reply) => {
      const body = req.body as Readable
      try {
        const groupId = await requireReplicaMachine(ctx, req)
        const hash = hashParam(req)
        if ((await blobSize(groupId, hash)) === null)
          await writeBlob(groupId, hash, body, req.headers['content-encoding'] === 'gzip')
      } finally {
        body.resume()
      }
      return reply.status(204).send()
    })

    app.get('/api/daemon/sync/:groupId/blobs/:hash', async (req: GroupReq, reply) => {
      const groupId = await requireReplicaMachine(ctx, req)
      return reply
        .header('content-type', SYNC_BLOB_CONTENT_TYPE)
        .send(await openBlob(groupId, hashParam(req)))
    })

    app.post('/api/daemon/sync/:groupId/blobs/missing', async (req: GroupReq): Promise<SyncMissingRes> => {
      const groupId = await requireReplicaMachine(ctx, req)
      const { hashes } = SyncMissingReq.parse(req.body)
      const sizes = await Promise.all(hashes.map((h) => blobSize(groupId, h)))
      return { missing: hashes.filter((_, i) => sizes[i] === null) }
    })

    app.get('/api/daemon/sync/:groupId/changes', async (req: GroupReq): Promise<SyncChangesRes> => {
      const groupId = await requireReplicaMachine(ctx, req)
      return changesSince(ctx, groupId, SyncChangesQuery.parse(req.query).from)
    })

    app.get<{ Params: { id: string } }>('/api/groups/:id/sync', async (req): Promise<SyncStatusDto> => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      return syncStatus(ctx, req.params.id)
    })

    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/sync/versions',
      async (req): Promise<SyncVersionDto[]> => {
        const me = await requireUser(ctx, req)
        await requireMember(ctx, req.params.id, me.id)
        return syncVersionList(ctx, req.params.id, VersionsQuery.parse(req.query))
      },
    )

    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/sync/preview',
      async (req): Promise<SyncPreviewDto> => {
        const me = await requireUser(ctx, req)
        await requireMember(ctx, req.params.id, me.id)
        return syncPreview(ctx, req.params.id)
      },
    )

    app.post<{ Params: { id: string } }>('/api/groups/:id/sync/enable', async (req) => {
      const me = await requireUser(ctx, req)
      await enableSync(ctx, me.id, req.params.id, SyncEnableReq.parse(req.body).baseBotId)
      return groupDto(ctx, me.id, req.params.id)
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/sync/disable', async (req) => {
      const me = await requireUser(ctx, req)
      await disableSync(ctx, me.id, req.params.id)
      return groupDto(ctx, me.id, req.params.id)
    })

    app.post<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/sync/replicas/:botId/join',
      async (req): Promise<SyncStatusDto> => {
        const me = await requireUser(ctx, req)
        const { force } = SyncJoinReq.parse(req.body ?? {})
        await joinReplica(ctx, me.id, req.params.id, idParam(req.params.botId, '该 Bot 不在群内'), force)
        return syncStatus(ctx, req.params.id)
      },
    )

    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/sync/conflicts',
      async (req): Promise<SyncConflictDto[]> => {
        const me = await requireUser(ctx, req)
        await requireMember(ctx, req.params.id, me.id)
        return openConflicts(ctx, req.params.id)
      },
    )
  }
}
