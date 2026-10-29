import { readdir, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { SYNC_FILE_MAX_BYTES } from '@gonggong/protocol'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groups, syncChanges, syncConflicts, syncHead, syncReplicas, syncVersions } from '../../db/schema.js'
import { blobStore } from '../../lib/blob-store.js'
import { isUuid } from '../../lib/ids.js'
import { openFile } from '../../lib/seal.js'
import { dataDir } from '../attachments/service.js'

export { QuotaExceeded } from '../../lib/blob-store.js'

/** F16: content live in the head within the last 30 days is kept (merge bases); uploads get a day to be submitted. */
const KEEP_MS = 30 * 86_400_000
const UPLOAD_GRACE_MS = 86_400_000
/** Sealed bytes a group may store; an object so tests can lower it. */
export const blobQuota = { bytes: 5 * 1024 ** 3 }
/** git's heuristic: a NUL byte in the first 8000 bytes means binary. */
const SNIFF = 8000

const store = blobStore({
  root: () => join(dataDir(), 'sync'),
  quota: blobQuota,
  maxFileBytes: SYNC_FILE_MAX_BYTES,
})
const groupDir = store.groupDir
export const blobPath = store.path
export const blobSize = store.size
export const touchBlob = store.touch
export const openBlob = store.open
export const writeBlob = store.write

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
    store.forget(groupId)
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
