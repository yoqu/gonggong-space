import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, unlink, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough, type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { SYNC_FILE_MAX_BYTES } from '@gonggong/protocol'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groups, syncChanges, syncConflicts, syncHead, syncReplicas, syncVersions } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { FILE_OVERHEAD, openFile, sealStream } from '../../lib/seal.js'
import { dataDir } from '../attachments/service.js'

/** F16: content live in the head within the last 30 days is kept (merge bases); uploads get a day to be submitted. */
const KEEP_MS = 30 * 86_400_000
const UPLOAD_GRACE_MS = 86_400_000
/** Sealed bytes a group may store; an object so tests can lower it. */
export const blobQuota = { bytes: 5 * 1024 ** 3 }
/** git's heuristic: a NUL byte in the first 8000 bytes means binary. */
const SNIFF = 8000

const groupDir = (groupId: string) => join(dataDir(), 'sync', groupId)
export const blobPath = (groupId: string, hash: string) => join(groupDir(groupId), hash)

/** Plaintext size, or null when the group lacks it. */
export async function blobSize(groupId: string, hash: string) {
  try {
    return (await stat(blobPath(groupId, hash))).size - FILE_OVERHEAD
  } catch {
    return null
  }
}

/**
 * Plaintext size like blobSize; an existing blob counts as freshly uploaded (a deduplicated upload or missing check
 * is about to reference it, so the sweep's upload grace must not drop it first).
 */
export async function touchBlob(groupId: string, hash: string) {
  const size = await blobSize(groupId, hash)
  if (size !== null) {
    const now = new Date()
    await utimes(blobPath(groupId, hash), now, now).catch(() => {})
  }
  return size
}

/** Sealed bytes stored per group, counted once from disk, then kept up to date by uploads and sweeps. */
const usage = new Map<string, number>()
async function groupUsage(groupId: string) {
  const known = usage.get(groupId)
  if (known !== undefined) return known
  let n = 0
  for (const name of await readdir(groupDir(groupId)).catch(() => [] as string[]))
    n += (await stat(join(groupDir(groupId), name)).catch(() => null))?.size ?? 0
  usage.set(groupId, n)
  return n
}

export class QuotaExceeded extends Error {}

export const openBlob = (groupId: string, hash: string) =>
  openFile(blobPath(groupId, hash)).catch(() => fail('not_found', '文件内容不存在'))

/** Seals `body` (gzip when told) under its hash once its sha256 proves it; nothing is kept otherwise. */
export async function writeBlob(groupId: string, hash: string, body: Readable, gzip: boolean) {
  await mkdir(groupDir(groupId), { recursive: true })
  const tmp = blobPath(groupId, `.${hash}.${randomUUID()}`)
  const digest = createHash('sha256')
  const room = blobQuota.bytes - (await groupUsage(groupId)) - FILE_OVERHEAD
  let size = 0
  const check = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      if (size > SYNC_FILE_MAX_BYTES) return done(new TooLarge())
      if (size > room) return done(new QuotaExceeded())
      digest.update(chunk)
      done(null, chunk)
    },
  })
  try {
    // Piped, not pipelined: a failure must not destroy the request, whose rest the route drains before answering.
    const src = body.pipe(new PassThrough())
    await pipeline([src, ...(gzip ? [createGunzip()] : []), check, sealStream(), createWriteStream(tmp)])
    if (digest.digest('hex') !== hash) fail('invalid', '文件内容与哈希不符')
    await rename(tmp, blobPath(groupId, hash))
    usage.set(groupId, (await groupUsage(groupId)) + size + FILE_OVERHEAD)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    if (e instanceof TooLarge)
      fail('invalid', '单个文件不能超过 {mb} MB', { mb: SYNC_FILE_MAX_BYTES / 1024 / 1024 })
    throw e
  }
}

class TooLarge extends Error {}

export async function isBinary(groupId: string, hash: string | null) {
  if (!hash) return false
  const chunks: Buffer[] = []
  let n = 0
  try {
    for await (const chunk of await openFile(blobPath(groupId, hash))) {
      chunks.push(chunk as Buffer)
      n += (chunk as Buffer).length
      if (n >= SNIFF) break
    }
  } catch {
    return false
  }
  return Buffer.concat(chunks).subarray(0, SNIFF).includes(0)
}

/** Switched back to partition, or dissolved, more than 30 days ago: the archive goes (§3.5, spec §9). */
async function archiveExpired(ctx: Ctx, groupId: string, cutoff: Date) {
  const [g] = await ctx.db
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.id, groupId),
        or(
          and(eq(groups.mode, 'partition'), lt(groups.syncArchivedAt, cutoff)),
          lt(groups.archivedAt, cutoff),
        ),
      ),
    )
  return !!g
}

async function purgeGroup(ctx: Ctx, groupId: string) {
  await ctx.db.transaction(async (tx) => {
    for (const table of [syncConflicts, syncReplicas, syncChanges, syncHead, syncVersions])
      await tx.delete(table).where(eq(table.groupId, groupId))
    await tx.update(groups).set({ syncArchivedAt: null }).where(eq(groups.id, groupId))
  })
  await rm(groupDir(groupId), { recursive: true, force: true })
}

/**
 * Hashes the group still needs (F16): the head, content a version of the last 30 days overwrote (it was live then,
 * a replica may still merge against it), and every side of a refused submit or an open conflict.
 */
async function neededHashes(ctx: Ctx, groupId: string, cutoff: Date) {
  const [live, overwritten, refused, open] = await Promise.all([
    ctx.db.select({ hash: syncHead.hash }).from(syncHead).where(eq(syncHead.groupId, groupId)),
    ctx.db.execute<{ hash: string }>(sql`
      select distinct x.hash from (
        select ${syncChanges.hash} as hash,
          lead(${syncChanges.version}) over (partition by ${syncChanges.path} order by ${syncChanges.version}) as next
        from ${syncChanges} where ${syncChanges.groupId} = ${groupId}
      ) x
      join ${syncVersions} v on v.group_id = ${groupId} and v.version = x.next
      where x.hash is not null and v.created_at >= ${cutoff.toISOString()}::timestamptz`),
    ctx.db
      .select({ last: syncReplicas.lastConflict })
      .from(syncReplicas)
      .where(eq(syncReplicas.groupId, groupId)),
    ctx.db
      .select({ changes: syncConflicts.changes, conflicts: syncConflicts.conflicts })
      .from(syncConflicts)
      .where(and(eq(syncConflicts.groupId, groupId), isNull(syncConflicts.resolvedAt))),
  ])
  type Sides = {
    changes?: { hash: string | null; baseHash: string | null }[]
    conflicts?: { hash: string | null }[]
  }
  const sides = [...refused.map((r) => r.last as Sides | null), ...(open as Sides[])]
  return new Set<string | null>([
    ...live.map((r) => r.hash),
    ...overwritten.map((r) => r.hash),
    ...sides.flatMap((c) => [
      ...(c?.changes ?? []).flatMap((ch) => [ch.hash, ch.baseHash]),
      ...(c?.conflicts ?? []).map((e) => e.hash),
    ]),
  ])
}

/** F16: deletes blobs the group no longer needs once past the upload grace, and whole archives past their 30 days. */
export async function purgeSyncBlobs(ctx: Ctx) {
  const root = join(dataDir(), 'sync')
  const groupIds = await readdir(root).catch(() => [] as string[])
  const now = ctx.now().getTime()
  for (const groupId of groupIds) {
    if (!isUuid(groupId)) continue
    usage.delete(groupId)
    if (await archiveExpired(ctx, groupId, new Date(now - KEEP_MS))) {
      await purgeGroup(ctx, groupId)
      continue
    }
    const keep = await neededHashes(ctx, groupId, new Date(now - KEEP_MS))
    for (const name of await readdir(groupDir(groupId))) {
      if (keep.has(name)) continue
      const path = join(groupDir(groupId), name)
      try {
        if (now - (await stat(path)).mtimeMs > UPLOAD_GRACE_MS) await unlink(path)
      } catch (err) {
        console.error('sync blob purge:', err)
      }
    }
  }
}
