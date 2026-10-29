import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough, type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { fail } from './errors.js'
import { FILE_OVERHEAD, openFile, sealStream } from './seal.js'

export class QuotaExceeded extends Error {}
class TooLarge extends Error {}

/**
 * Sealed, content-addressed blobs under `<root>/<groupId>/<sha256>`, with a per-group quota (an object so tests can
 * lower it). Force sync and hosted artifacts each keep their own root, quota and usage.
 */
export function blobStore(o: { root: () => string; quota: { bytes: number }; maxFileBytes: number }) {
  const groupDir = (groupId: string) => join(o.root(), groupId)
  const path = (groupId: string, hash: string) => join(groupDir(groupId), hash)

  /** Sealed bytes stored per group, counted once from disk, then kept up to date by uploads (and `forget`). */
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

  /** Plaintext size, or null when the group lacks it. */
  async function size(groupId: string, hash: string) {
    try {
      return (await stat(path(groupId, hash))).size - FILE_OVERHEAD
    } catch {
      return null
    }
  }

  return {
    groupDir,
    path,
    size,
    forget: (groupId: string) => usage.delete(groupId),
    /** Like `size`; an existing blob counts as freshly uploaded (a sweep's upload grace must not drop it first). */
    async touch(groupId: string, hash: string) {
      const n = await size(groupId, hash)
      if (n !== null) {
        const now = new Date()
        await utimes(path(groupId, hash), now, now).catch(() => {})
      }
      return n
    },
    open: (groupId: string, hash: string) =>
      openFile(path(groupId, hash)).catch(() => fail('not_found', '文件内容不存在')),
    /** Seals `body` (gzip when told) under its hash once its sha256 proves it; nothing is kept otherwise. */
    async write(groupId: string, hash: string, body: Readable, gzip: boolean) {
      await mkdir(groupDir(groupId), { recursive: true })
      const tmp = path(groupId, `.${hash}.${randomUUID()}`)
      const digest = createHash('sha256')
      const room = o.quota.bytes - (await groupUsage(groupId)) - FILE_OVERHEAD
      let n = 0
      const check = new Transform({
        transform(chunk: Buffer, _enc, done) {
          n += chunk.length
          if (n > o.maxFileBytes) return done(new TooLarge())
          if (n > room) return done(new QuotaExceeded())
          digest.update(chunk)
          done(null, chunk)
        },
      })
      try {
        // Piped, not pipelined: a failure must not destroy the request, whose rest the route drains before answering.
        const src = body.pipe(new PassThrough())
        await pipeline([src, ...(gzip ? [createGunzip()] : []), check, sealStream(), createWriteStream(tmp)])
        if (digest.digest('hex') !== hash) fail('invalid', '文件内容与哈希不符')
        await rename(tmp, path(groupId, hash))
        usage.set(groupId, (await groupUsage(groupId)) + n + FILE_OVERHEAD)
      } catch (e) {
        await unlink(tmp).catch(() => {})
        if (e instanceof TooLarge)
          fail('invalid', '单个文件不能超过 {mb} MB', { mb: o.maxFileBytes / 1024 / 1024 })
        throw e
      }
    },
  }
}
export type BlobStore = ReturnType<typeof blobStore>
