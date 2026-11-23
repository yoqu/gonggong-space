import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  ARTIFACT_FILE_MAX_BYTES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  type ArtifactAssetRes,
  type ArtifactFile,
  ArtifactFiles,
  type ArtifactHistoryAuthor,
  type ArtifactHistoryDiffRes,
  type ArtifactHistoryFileChange,
  type ArtifactHistoryListRes,
  type ArtifactPublishConflict,
  type ArtifactPublishReq,
  type ArtifactPublishRes,
  type ArtifactRestoreFilesRes,
  artifactDigestText,
} from '@gonggong/protocol'
import { and, desc, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  artifacts,
  artifactThreads,
  artifactVersions,
  bots,
  previewShares,
  previews,
  runs,
  users,
} from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { dataDir } from '../attachments/service.js'
import { artifactBlobs, readBlob } from './blobs.js'
import { diffFileLists, publishArtifactFiles } from './events.js'
import { readableImage } from './images.js'
import { pluginKit } from './kit.js'
import { lintVersion } from './lint.js'
import { type Artifact, findArtifact, refreshCard, requireVersion, runners, type Version } from './service.js'
import { snapshotPending } from './snapshots.js'

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** Maximum bytes for a single file diff returned by `history.diff`. */
const DIFF_MAX_BYTES = 512 * 1024
/** Same-member consecutive `source='edit'` publishes coalesce within 30s idle and 5m total burst. */
const BURST_IDLE_MS = 30_000
const BURST_TOTAL_MS = 5 * 60_000

const BLOB_REF_RE = /\/_blob\/([0-9a-f]{32})/g
const VALID_PATH_RE = ArtifactFiles.element.shape.path

type Burst = { versionId: string; userId: string; lastAt: number }
/** artifactId → latest coalescable edit burst in this server process. */
const bursts = new Map<string, Burst>()

export function clearBurst(artifactId: string) {
  bursts.delete(artifactId)
}

/** Raised by `publishFiles` when any `ifMatch` fails; routes answer 409 with `paths`. */
export class PublishConflictError extends Error {
  constructor(readonly paths: ArtifactPublishConflict[]) {
    super('conflict')
  }
}

// ── Media assets (`assets.upload`, images + MP4/WebM/MOV videos, 32-hex id) ────────────────────────────────────

export const ASSET_TYPES: Record<string, { ext: string; video: boolean }> = {
  'image/png': { ext: 'png', video: false },
  'image/jpeg': { ext: 'jpg', video: false },
  'image/webp': { ext: 'webp', video: false },
  'image/gif': { ext: 'gif', video: false },
  'video/mp4': { ext: 'mp4', video: true },
  'video/webm': { ext: 'webm', video: true },
  'video/quicktime': { ext: 'mov', video: true },
}

export const ASSET_UPLOAD_MAX_BYTES = ARTIFACT_FILE_MAX_BYTES

function magicMatches(ext: string, b: Buffer): boolean {
  switch (ext) {
    case 'png':
      return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'jpg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case 'gif':
      return /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))
    case 'webp':
      return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
    case 'mp4':
    case 'mov':
      return b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp'
    case 'webm':
      return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
    default:
      return false
  }
}

/** Sniffs a stored `/_blob/<32hex>` buffer's MIME type from its magic bytes (safe with `nosniff`). */
export function sniffMediaMime(b: Buffer): string {
  if (magicMatches('png', b)) return 'image/png'
  if (magicMatches('jpg', b)) return 'image/jpeg'
  if (magicMatches('gif', b)) return 'image/gif'
  if (magicMatches('webp', b)) return 'image/webp'
  if (magicMatches('webm', b)) return 'video/webm'
  if (magicMatches('mp4', b)) {
    const brand = b.subarray(8, 12).toString('ascii')
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  return 'application/octet-stream'
}

type StagedRecord = { hash: string; size: number; contentType: string }

const stagedPath = (groupId: string, artifactId: string, id32: string) =>
  join(dataDir(), 'artifacts', groupId, '_staged', artifactId, `${id32}.json`)

export async function readStagedBlob(
  groupId: string,
  artifactId: string,
  id32: string,
): Promise<StagedRecord | null> {
  if (!/^[0-9a-f]{32}$/.test(id32)) return null
  try {
    return JSON.parse(await readFile(stagedPath(groupId, artifactId, id32), 'utf8')) as StagedRecord
  } catch {
    return null
  }
}

/** POST /api/artifacts/:id/assets — stores an image or video blob keyed by its 32-hex sha256 prefix. */
export async function uploadArtifactAsset(
  a: Artifact,
  rawType: string | undefined,
  body: Buffer,
): Promise<ArtifactAssetRes> {
  const mime = (rawType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  const spec = ASSET_TYPES[mime]
  if (!spec) return fail('invalid', '只能上传图片（PNG、JPG、WebP、GIF）或视频（MP4、WebM、MOV）')
  const max = spec.video ? ASSET_UPLOAD_MAX_BYTES : ARTIFACT_UPLOAD_MAX_BYTES
  if (body.length > max) return fail('invalid', '文件不能超过 {mb} MB', { mb: max / 1024 / 1024 })
  if (!magicMatches(spec.ext, body)) return fail('invalid', '文件内容与类型不符')
  if (!spec.video && !readableImage(spec.ext, body)) return fail('invalid', '图片无法读取，文件可能已损坏')
  const hash = sha256(body)
  if ((await artifactBlobs.touch(a.groupId, hash)) === null)
    await artifactBlobs.write(a.groupId, hash, Readable.from([body]), false)
  const id = hash.slice(0, 32)
  const dir = join(dataDir(), 'artifacts', a.groupId, '_staged', a.id)
  await mkdir(dir, { recursive: true })
  const rec: StagedRecord = { hash, size: body.length, contentType: mime }
  await writeFile(stagedPath(a.groupId, a.id, id), JSON.stringify(rec))
  return { id, url: `/_blob/${id}`, sizeBytes: body.length, contentType: mime }
}

// ── Atomic per-file ifMatch publish + burst coalescing ─────────────────────────────────────────────────────────

const digestOf = (files: ArtifactFile[]) =>
  createHash('sha256').update(artifactDigestText(files)).digest('hex')

/** POST /api/artifacts/:id/publish — open-artifact `artifact.publish(batch)`. */
export async function publishFiles(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  req: ArtifactPublishReq,
): Promise<ArtifactPublishRes> {
  const entries = Object.entries(req.batch)
  const decoded = new Map<string, { buf: Buffer; hash: string; ifMatch?: string | null } | null>()
  const blobRefs = new Set<string>()
  for (const [path, file] of entries) {
    if (!VALID_PATH_RE.safeParse(path).success) fail('invalid', '路径无效')
    if (file === null) {
      decoded.set(path, null)
      continue
    }
    const buf = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')
    if (buf.length > ARTIFACT_FILE_MAX_BYTES)
      fail('invalid', '文件不能超过 {mb} MB', { mb: ARTIFACT_FILE_MAX_BYTES / 1024 / 1024 })
    if (file.encoding !== 'base64') {
      for (const m of file.content.matchAll(BLOB_REF_RE)) if (m[1]) blobRefs.add(m[1])
    }
    decoded.set(path, { buf, hash: sha256(buf), ifMatch: file.ifMatch })
  }

  // Resolve any referenced `/_blob/<32hex>` uploads so they are promoted into version files.
  const promoted = new Map<string, ArtifactFile>()
  for (const id32 of blobRefs) {
    const staged = await readStagedBlob(a.groupId, a.id, id32)
    if (staged && (await artifactBlobs.size(a.groupId, staged.hash)) === staged.size)
      promoted.set(`_blob/${id32}`, { path: `_blob/${id32}`, hash: staged.hash, size: staged.size })
  }

  const kit = await pluginKit(ctx.db, a.pluginVersionId)
  const lint = async (list: ArtifactFile[]) =>
    a.kind === 'prototype' ? lintVersion(list, (f) => readBlob(a.groupId, f.hash), kit) : []

  const result = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(artifacts).where(eq(artifacts.id, a.id)).for('update')
    if (!locked) return fail('not_found', '产物不存在')
    const [head] = locked.headVersionId
      ? await tx.select().from(artifactVersions).where(eq(artifactVersions.id, locked.headVersionId))
      : []
    const current = new Map<string, ArtifactFile>((head?.files ?? []).map((f) => [f.path, f]))

    // Per-file optimistic concurrency check (`ifMatch`).
    const conflicts: ArtifactPublishConflict[] = []
    for (const [path, item] of decoded) {
      if (!item || item.ifMatch === undefined) continue
      const actual = current.get(path)?.hash ?? null
      if (item.ifMatch !== actual) conflicts.push({ path, expected: item.ifMatch, actual })
    }
    if (conflicts.length) throw new PublishConflictError(conflicts)

    // Write blobs only after every `ifMatch` passed.
    const hashes: Record<string, string | null> = {}
    const next = new Map(current)
    for (const [path, item] of decoded) {
      if (!item) {
        next.delete(path)
        hashes[path] = null
        continue
      }
      if ((await artifactBlobs.touch(a.groupId, item.hash)) === null)
        await artifactBlobs.write(a.groupId, item.hash, Readable.from([item.buf]), false)
      next.set(path, { path, hash: item.hash, size: item.buf.length })
      hashes[path] = item.hash
    }
    for (const [path, file] of promoted) if (!next.has(path)) next.set(path, file)

    const sorted = [...next.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
    const checked = ArtifactFiles.safeParse(sorted)
    if (!checked.success) fail('invalid', (checked.error.issues[0]?.message ?? '超出单版大小上限') as never)

    const issues = await lint(sorted)
    const digest = digestOf(sorted)
    const now = ctx.now()
    const nowMs = now.getTime()
    const changes = diffFileLists(head?.files ?? [], sorted)

    // Coalesce consecutive edits by the same member within the burst window when nothing pins/branches `head`.
    let canCoalesce = false
    const burst = bursts.get(a.id)
    if (
      head &&
      !head.stale &&
      head.source === 'edit' &&
      head.userId === me.id &&
      burst?.versionId === head.id &&
      burst.userId === me.id &&
      nowMs - burst.lastAt <= BURST_IDLE_MS &&
      nowMs - head.createdAt.getTime() <= BURST_TOTAL_MS
    ) {
      // A live run checked out `head`: rewriting it in place would make its submit fast-forward over these edits.
      const [[child], [th], [pinPv], [pinShare], live] = await Promise.all([
        tx
          .select({ id: artifactVersions.id })
          .from(artifactVersions)
          .where(and(eq(artifactVersions.artifactId, a.id), eq(artifactVersions.parentVersionId, head.id)))
          .limit(1),
        tx
          .select({ id: artifactThreads.id })
          .from(artifactThreads)
          .where(eq(artifactThreads.versionId, head.id))
          .limit(1),
        tx.select({ id: previews.id }).from(previews).where(eq(previews.artifactVersionId, head.id)).limit(1),
        tx
          .select({ id: previewShares.id })
          .from(previewShares)
          .where(eq(previewShares.artifactVersionId, head.id))
          .limit(1),
        runners(tx, a.groupId),
      ])
      canCoalesce = !child && !th && !pinPv && !pinShare && !live.has(a.id)
    }

    if (canCoalesce && head) {
      await tx
        .update(artifactVersions)
        .set({ files: sorted, digest, issues, thumbnailHash: null, screenThumbs: [] })
        .where(eq(artifactVersions.id, head.id))
      await tx.update(artifacts).set({ updatedAt: now }).where(eq(artifacts.id, a.id))
      bursts.set(a.id, { versionId: head.id, userId: me.id, lastAt: nowMs })
      return { versionId: head.id, n: head.n, hashes, coalesced: true, changes }
    }

    const [last] = await tx
      .select({ n: artifactVersions.n })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, a.id))
      .orderBy(desc(artifactVersions.n))
      .limit(1)
    const [made] = (await tx
      .insert(artifactVersions)
      .values({
        artifactId: a.id,
        n: (last?.n ?? 0) + 1,
        parentVersionId: head?.id ?? null,
        source: 'edit',
        runId: null,
        userId: me.id,
        submitKey: null,
        files: sorted,
        digest,
        stale: false,
        issues,
      })
      .returning()) as [Version]
    await tx.update(artifacts).set({ headVersionId: made.id, updatedAt: now }).where(eq(artifacts.id, a.id))
    bursts.set(a.id, { versionId: made.id, userId: me.id, lastAt: nowMs })
    return { versionId: made.id, n: made.n, hashes, coalesced: false, changes }
  })

  await refreshCard(ctx, a.id)
  await publishArtifactFiles(ctx, a, {
    versionId: result.versionId,
    n: result.n,
    changes: result.changes,
    author: me.name,
    clientId: req.clientId,
  })
  return {
    versionId: result.versionId,
    n: result.n,
    hashes: result.hashes,
    ...(result.coalesced && { coalesced: true }),
  }
}

// ── History capability endpoints (list, files, diff, partial-path restore) ─────────────────────────────────────

function fileOps(
  parentFiles: readonly ArtifactFile[],
  files: readonly ArtifactFile[],
): ArtifactHistoryFileChange[] {
  const prev = new Map(parentFiles.map((f) => [f.path, f.hash]))
  const next = new Map(files.map((f) => [f.path, f.hash]))
  const out: ArtifactHistoryFileChange[] = []
  for (const [path, hash] of next) {
    const old = prev.get(path)
    if (old === undefined) out.push({ path, op: 'added' })
    else if (old !== hash) out.push({ path, op: 'edited' })
  }
  for (const path of prev.keys()) if (!next.has(path)) out.push({ path, op: 'deleted' })
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function versionAuthor(r: {
  v: Version
  userId: string | null
  userName: string | null
  botId: string | null
  botName: string | null
}): ArtifactHistoryAuthor {
  if (r.v.source === 'run')
    return { kind: 'agent', id: r.botId ?? r.v.runId ?? 'agent', name: r.botName ?? 'AI' }
  if (r.userId) return { kind: 'person', id: r.userId, name: r.userName ?? '' }
  return { kind: 'system', id: 'system', name: 'System' }
}

/** GET /api/artifacts/:id/versions/history */
export async function listHistoryVersions(
  ctx: Ctx,
  a: Artifact,
  canRestore: boolean,
): Promise<ArtifactHistoryListRes> {
  const rows = await ctx.db
    .select({
      v: artifactVersions,
      userId: artifactVersions.userId,
      userName: users.name,
      botId: runs.botId,
      botName: bots.name,
    })
    .from(artifactVersions)
    .leftJoin(users, eq(users.id, artifactVersions.userId))
    .leftJoin(runs, eq(runs.id, artifactVersions.runId))
    .leftJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(artifactVersions.artifactId, a.id), eq(artifactVersions.stale, false)))
    .orderBy(desc(artifactVersions.n))
  const byId = new Map(rows.map((r) => [r.v.id, r.v]))
  const burst = bursts.get(a.id)
  return {
    versions: rows.map((r) => {
      const parent = r.v.parentVersionId ? byId.get(r.v.parentVersionId) : undefined
      const first = r.v.createdAt.toISOString()
      const at =
        burst?.versionId === r.v.id
          ? new Date(Math.max(burst.lastAt, r.v.createdAt.getTime())).toISOString()
          : first
      return {
        id: r.v.id,
        n: r.v.n,
        first,
        at,
        author: versionAuthor(r),
        files: fileOps(parent?.files ?? [], r.v.files),
        ...(r.v.id === a.headVersionId && { current: true as const }),
      }
    }),
    notices: [],
    canRestore,
  }
}

/** GET /api/artifacts/:id/versions/by-number/:n/files */
export async function versionFilesByNumber(ctx: Ctx, a: Artifact, n: number) {
  if (!Number.isInteger(n) || n < 1) return fail('not_found', '版本不存在')
  const [v] = await ctx.db
    .select()
    .from(artifactVersions)
    .where(and(eq(artifactVersions.artifactId, a.id), eq(artifactVersions.n, n)))
    .limit(1)
  if (!v) return fail('not_found', '版本不存在')
  const out: Record<string, { sha256: string; size: number }> = {}
  for (const f of v.files) out[f.path] = { sha256: f.hash, size: f.size }
  return out
}

function decodeUtf8(buf: Buffer): string | null {
  if (buf.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

/** GET /api/artifacts/:id/versions/:vid/diff?path=… */
export async function diffVersionFile(
  ctx: Ctx,
  a: Artifact,
  versionId: string,
  path: string,
): Promise<ArtifactHistoryDiffRes> {
  if (!path) return fail('invalid', '路径无效')
  const v = await requireVersion(ctx.db, a, versionId)
  const [parent] = v.parentVersionId
    ? await ctx.db.select().from(artifactVersions).where(eq(artifactVersions.id, v.parentVersionId))
    : []
  const prevFile = parent?.files.find((f) => f.path === path)
  const nextFile = v.files.find((f) => f.path === path)
  if (!prevFile && !nextFile) return fail('not_found', '文件不存在')
  const op: ArtifactHistoryDiffRes['op'] = !prevFile ? 'added' : !nextFile ? 'deleted' : 'edited'
  if ((prevFile?.size ?? 0) > DIFF_MAX_BYTES || (nextFile?.size ?? 0) > DIFF_MAX_BYTES)
    return { path, n: v.n, op, before: null, after: null, tooLarge: true }
  const [prevBuf, nextBuf] = await Promise.all([
    prevFile ? readBlob(a.groupId, prevFile.hash) : Promise.resolve(null),
    nextFile ? readBlob(a.groupId, nextFile.hash) : Promise.resolve(null),
  ])
  const before = prevBuf ? decodeUtf8(prevBuf) : null
  const after = nextBuf ? decodeUtf8(nextBuf) : null
  if ((prevBuf && before === null) || (nextBuf && after === null))
    return { path, n: v.n, op, before: null, after: null, binary: true }
  return { path, n: v.n, op, before, after }
}

/** POST /api/artifacts/:id/versions/:vid/restore-files — restores selected (or all) paths as a new version. */
export async function restoreVersionFiles(
  ctx: Ctx,
  a: Artifact,
  me: { id: string; name: string },
  versionId: string,
  paths?: string[],
  clientId?: string,
): Promise<ArtifactRestoreFilesRes> {
  const target = await requireVersion(ctx.db, a, versionId)
  const kit = await pluginKit(ctx.db, a.pluginVersionId)
  const lint = async (list: ArtifactFile[]) =>
    a.kind === 'prototype' ? lintVersion(list, (f) => readBlob(a.groupId, f.hash), kit) : []

  const out = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(artifacts).where(eq(artifacts.id, a.id)).for('update')
    if (!locked) return fail('not_found', '产物不存在')
    const [head] = locked.headVersionId
      ? await tx.select().from(artifactVersions).where(eq(artifactVersions.id, locked.headVersionId))
      : []
    const headMap = new Map<string, ArtifactFile>((head?.files ?? []).map((f) => [f.path, f]))
    const targetMap = new Map<string, ArtifactFile>(target.files.map((f) => [f.path, f]))
    const next = new Map(headMap)
    const pick = paths?.length ? [...new Set(paths)] : [...new Set([...headMap.keys(), ...targetMap.keys()])]
    const changed: string[] = []
    for (const p of pick) {
      const tf = targetMap.get(p)
      const hf = headMap.get(p)
      if (tf?.hash === hf?.hash) continue
      changed.push(p)
      if (tf) next.set(p, tf)
      else next.delete(p)
    }
    if (!changed.length)
      return { version: null as number | null, versionId: null as string | null, changed, changes: {} }
    const sorted = [...next.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
    const [last] = await tx
      .select({ n: artifactVersions.n })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, a.id))
      .orderBy(desc(artifactVersions.n))
      .limit(1)
    const [made] = (await tx
      .insert(artifactVersions)
      .values({
        artifactId: a.id,
        n: (last?.n ?? 0) + 1,
        parentVersionId: head?.id ?? null,
        source: 'edit',
        runId: null,
        userId: me.id,
        submitKey: null,
        files: sorted,
        digest: digestOf(sorted),
        stale: false,
        issues: await lint(sorted),
      })
      .returning()) as [Version]
    await tx
      .update(artifacts)
      .set({ headVersionId: made.id, updatedAt: ctx.now() })
      .where(eq(artifacts.id, a.id))
    clearBurst(a.id)
    return {
      version: made.n,
      versionId: made.id,
      changed: changed.sort(),
      changes: diffFileLists(head?.files ?? [], sorted),
    }
  })

  if (out.version !== null && out.versionId) {
    const fresh = (await findArtifact(ctx.db, a.id)) ?? a
    await refreshCard(ctx, a.id)
    await publishArtifactFiles(ctx, fresh, {
      versionId: out.versionId,
      n: out.version,
      changes: out.changes,
      author: me.name,
      clientId,
    })
    await snapshotPending(ctx, eq(artifacts.id, a.id))
  }
  return { version: out.version, changed: out.changed }
}
