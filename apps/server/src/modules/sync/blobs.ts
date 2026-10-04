import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough, type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { SYNC_FILE_MAX_BYTES } from '@gonggong/protocol'
import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { syncChanges, syncConflicts, syncHead, syncVersions } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { FILE_OVERHEAD, openFile, sealStream } from '../../lib/seal.js'
import { dataDir } from '../attachments/service.js'

/** F16: blobs referenced by versions of the last 30 days are kept (merge bases); uploads get a day to be submitted. */
const KEEP_MS = 30 * 86_400_000
const UPLOAD_GRACE_MS = 86_400_000
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

export const openBlob = (groupId: string, hash: string) =>
  openFile(blobPath(groupId, hash)).catch(() => fail('not_found', '文件内容不存在'))

/** Seals `body` (gzip when told) under its hash once its sha256 proves it; nothing is kept otherwise. */
export async function writeBlob(groupId: string, hash: string, body: Readable, gzip: boolean) {
  await mkdir(groupDir(groupId), { recursive: true })
  const tmp = blobPath(groupId, `.${hash}.${randomUUID()}`)
  const digest = createHash('sha256')
  let size = 0
  const check = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      if (size > SYNC_FILE_MAX_BYTES) return done(new TooLarge())
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

/** F16: deletes blobs neither the head, a recent version, an open conflict nor a fresh upload needs. */
export async function purgeSyncBlobs(ctx: Ctx) {
  const root = join(dataDir(), 'sync')
  const groupIds = await readdir(root).catch(() => [] as string[])
  const now = ctx.now().getTime()
  for (const groupId of groupIds) {
    const [live, recent, open] = await Promise.all([
      ctx.db.select({ hash: syncHead.hash }).from(syncHead).where(eq(syncHead.groupId, groupId)),
      ctx.db
        .select({ hash: syncChanges.hash })
        .from(syncChanges)
        .innerJoin(
          syncVersions,
          and(eq(syncVersions.groupId, syncChanges.groupId), eq(syncVersions.version, syncChanges.version)),
        )
        .where(
          and(
            eq(syncChanges.groupId, groupId),
            isNotNull(syncChanges.hash),
            gte(syncVersions.createdAt, new Date(now - KEEP_MS)),
          ),
        ),
      ctx.db
        .select({ changes: syncConflicts.changes })
        .from(syncConflicts)
        .where(and(eq(syncConflicts.groupId, groupId), isNull(syncConflicts.resolvedAt))),
    ])
    const keep = new Set<string | null>([...live, ...recent].map((r) => r.hash))
    for (const c of open)
      for (const ch of c.changes as { hash: string | null; baseHash: string | null }[]) {
        keep.add(ch.hash)
        keep.add(ch.baseHash)
      }
    for (const name of await readdir(groupDir(groupId))) {
      if (keep.has(name)) continue
      const path = join(groupDir(groupId), name)
      const { mtimeMs } = await stat(path)
      if (now - mtimeMs > UPLOAD_GRACE_MS) await unlink(path)
    }
  }
}
