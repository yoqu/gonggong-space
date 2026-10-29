import {
  type AnnotationDto,
  type AnnotationStatus,
  BRIDGE_SNIPPET_MAX,
  type CreateAnnotationReq,
  type UpdateAnnotationReq,
} from '@gonggong/protocol'
import { and, asc, eq, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactAnnotations, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { readBlob } from './blobs.js'
import { elementsOf } from './html.js'
import { type Artifact, requireArtifact, requireVersion } from './service.js'

type Row = typeof artifactAnnotations.$inferSelect

const dto = (n: Row, authorName: string): AnnotationDto => ({
  id: n.id,
  artifactId: n.artifactId,
  versionId: n.versionId,
  file: n.file as AnnotationDto['file'],
  ggId: n.ggId,
  selector: n.selector,
  rect: n.rect,
  snippet: n.snippet,
  note: n.note,
  authorId: n.authorId,
  authorName,
  status: n.status as AnnotationStatus,
  createdAt: n.createdAt.toISOString(),
})

const rows = (ctx: Ctx, where: SQL | undefined) =>
  ctx.db
    .select({ n: artifactAnnotations, name: users.name })
    .from(artifactAnnotations)
    .innerJoin(users, eq(users.id, artifactAnnotations.authorId))
    .where(where)
    .orderBy(asc(artifactAnnotations.createdAt))

export async function listAnnotations(ctx: Ctx, a: Artifact, versionId: string | undefined) {
  const v = versionId ? await requireVersion(ctx.db, a, versionId) : null
  const list = await rows(
    ctx,
    and(eq(artifactAnnotations.artifactId, a.id), v ? eq(artifactAnnotations.versionId, v.id) : undefined),
  )
  return list.map((r) => dto(r.n, r.name))
}

export async function createAnnotation(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  r: CreateAnnotationReq,
) {
  const v = await requireVersion(ctx.db, a, r.versionId)
  const file =
    v.files.find((f) => f.path === r.file) ?? fail('invalid', '文件不存在：{path}', { path: r.file })
  const snippet =
    r.snippet ??
    (r.ggId ? sourceSnippet((await readBlob(a.groupId, file.hash)).toString('utf8'), r.ggId) : '')
  const [n] = await ctx.db
    .insert(artifactAnnotations)
    .values({ ...r, snippet, versionId: v.id, artifactId: a.id, authorId: me.id })
    .returning()
  return dto(n as Row, me.name)
}

/** The element's source as written, cut like the bridge's snippet; empty when the source has no such element. */
function sourceSnippet(html: string, ggId: string) {
  const loc = elementsOf(html).get(Number(ggId))?.sourceCodeLocation
  return loc ? html.slice(loc.startOffset, loc.endOffset).slice(0, BRIDGE_SNIPPET_MAX) : ''
}

/** An annotation of an artifact `userId` can read. */
async function requireAnnotation(ctx: Ctx, id: string, userId: string) {
  const [n] = isUuid(id)
    ? await ctx.db.select().from(artifactAnnotations).where(eq(artifactAnnotations.id, id))
    : []
  if (!n) return fail('not_found', '批注不存在')
  await requireArtifact(ctx, n.artifactId, userId)
  return n
}

/** Any member may resolve or reopen one; only its author rewrites or deletes it. */
export async function updateAnnotation(
  ctx: Ctx,
  me: { id: string; name: string },
  id: string,
  r: UpdateAnnotationReq,
) {
  const n = await requireAnnotation(ctx, id, me.id)
  if (r.note !== undefined && n.authorId !== me.id) fail('forbidden', '只能修改自己的批注')
  await ctx.db
    .update(artifactAnnotations)
    .set({ ...(r.note !== undefined && { note: r.note }), ...(r.status && { status: r.status }) })
    .where(eq(artifactAnnotations.id, n.id))
  const [row] = await rows(ctx, eq(artifactAnnotations.id, n.id))
  return dto((row as { n: Row }).n, (row as { name: string }).name)
}

export async function deleteAnnotation(ctx: Ctx, userId: string, id: string) {
  const n = await requireAnnotation(ctx, id, userId)
  if (n.authorId !== userId) fail('forbidden', '只能修改自己的批注')
  await ctx.db.delete(artifactAnnotations).where(eq(artifactAnnotations.id, n.id))
}
