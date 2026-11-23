import {
  type ArtifactThreadAnchor,
  type ArtifactThreadDto,
  type ArtifactThreadMessageReq,
  type ArtifactThreadStatus,
  BRIDGE_SNIPPET_MAX,
  type CreateArtifactThreadReq,
  type EditArtifactThreadMessageReq,
  type UpdateArtifactThreadReq,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactThreadMessages, artifactThreads, bots, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { readBlob } from './blobs.js'
import { elementsOf } from './html.js'
import { type Artifact, requireArtifact, requireVersion, type Version } from './service.js'

type Me = { id: string; name: string }
type ThreadRow = typeof artifactThreads.$inferSelect

/** The threads `where` picks, oldest first, each with its messages and the names of who wrote them. */
export async function loadThreads(ctx: Ctx, where: SQL | undefined): Promise<ArtifactThreadDto[]> {
  const threads = await ctx.db
    .select()
    .from(artifactThreads)
    .where(where)
    .orderBy(asc(artifactThreads.createdAt))
  if (!threads.length) return []
  const msgs = await ctx.db
    .select()
    .from(artifactThreadMessages)
    .where(
      inArray(
        artifactThreadMessages.threadId,
        threads.map((th) => th.id),
      ),
    )
    .orderBy(asc(artifactThreadMessages.at), asc(artifactThreadMessages.id))
  const userIds = [
    ...new Set([
      ...threads.map((th) => th.createdBy),
      ...msgs.filter((m) => m.authorKind === 'user').map((m) => m.authorId),
    ]),
  ]
  const botIds = [...new Set(msgs.filter((m) => m.authorKind === 'bot').map((m) => m.authorId))]
  const named = await Promise.all([
    ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)),
    botIds.length
      ? ctx.db.select({ id: bots.id, name: bots.name }).from(bots).where(inArray(bots.id, botIds))
      : [],
  ])
  const names = new Map(named.flat().map((r) => [r.id, r.name]))
  return threads.map((th) => ({
    id: th.id,
    artifactId: th.artifactId,
    versionId: th.versionId,
    anchor: th.anchor,
    status: th.status as ArtifactThreadStatus,
    sentMessageId: th.sentMessageId,
    createdBy: th.createdBy,
    createdByName: names.get(th.createdBy) ?? '',
    createdAt: th.createdAt.toISOString(),
    messages: msgs
      .filter((m) => m.threadId === th.id)
      .map((m) => ({
        id: m.id,
        authorKind: m.authorKind as 'user' | 'bot',
        authorId: m.authorId,
        authorName: names.get(m.authorId) ?? '',
        text: m.text,
        to: m.to,
        reactions: m.reactions,
        at: m.at.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
      })),
  }))
}

const one = async (ctx: Ctx, id: string) =>
  (await loadThreads(ctx, eq(artifactThreads.id, id)))[0] as ArtifactThreadDto

/** GET /api/artifacts/:id/threads — all of them, or those made on one version. */
export async function listThreads(ctx: Ctx, a: Artifact, versionId: string | undefined) {
  const v = versionId ? await requireVersion(ctx.db, a, versionId) : null
  return loadThreads(
    ctx,
    and(eq(artifactThreads.artifactId, a.id), v ? eq(artifactThreads.versionId, v.id) : undefined),
  )
}

/** The anchor as stored: of the artifact's kind; a prototype's names a file of the version and gets its snippet. */
async function placed(a: Artifact, v: Version, anchor: ArtifactThreadAnchor): Promise<ArtifactThreadAnchor> {
  if (anchor.kind !== a.kind) fail('invalid', '批注位置与产物类型不符')
  if (anchor.kind !== 'prototype') return anchor
  const file =
    v.files.find((f) => f.path === anchor.file) ??
    fail('invalid', '文件不存在：{path}', { path: anchor.file })
  const snippet =
    anchor.snippet ??
    (anchor.ggId ? sourceSnippet((await readBlob(a.groupId, file.hash)).toString('utf8'), anchor.ggId) : '')
  return { ...anchor, snippet }
}

/** The element's source as written, cut like the bridge's snippet; empty when the source has no such element. */
function sourceSnippet(html: string, ggId: string) {
  const loc = elementsOf(html).get(Number(ggId))?.sourceCodeLocation
  return loc ? html.slice(loc.startOffset, loc.endOffset).slice(0, BRIDGE_SNIPPET_MAX) : ''
}

/** POST /api/artifacts/:id/threads */
export async function createThread(ctx: Ctx, me: Me, a: Artifact, r: CreateArtifactThreadReq) {
  const v = await requireVersion(ctx.db, a, r.versionId)
  const anchor = await placed(a, v, r.anchor)
  const id = await ctx.db.transaction(async (tx) => {
    const [th] = (await tx
      .insert(artifactThreads)
      .values({ artifactId: a.id, versionId: v.id, anchor, createdBy: me.id })
      .returning()) as [ThreadRow]
    await tx
      .insert(artifactThreadMessages)
      .values({ threadId: th.id, authorKind: 'user', authorId: me.id, text: r.text, to: r.to })
    return th.id
  })
  return one(ctx, id)
}

/** A thread of an artifact `userId` may change. */
async function requireThread(ctx: Ctx, id: string, userId: string) {
  const [th] = isUuid(id) ? await ctx.db.select().from(artifactThreads).where(eq(artifactThreads.id, id)) : []
  if (!th) return fail('not_found', '批注不存在')
  return { th, a: await requireArtifact(ctx, th.artifactId, userId) }
}

/** PATCH /api/artifact-threads/:id — any member resolves, reopens or moves it. */
export async function updateThread(ctx: Ctx, me: Me, id: string, r: UpdateArtifactThreadReq) {
  const { th, a } = await requireThread(ctx, id, me.id)
  const anchor = r.anchor && (await placed(a, await requireVersion(ctx.db, a, th.versionId), r.anchor))
  if (anchor || r.status)
    await ctx.db
      .update(artifactThreads)
      .set({ ...(anchor && { anchor }), ...(r.status && { status: r.status }) })
      .where(eq(artifactThreads.id, th.id))
  return one(ctx, th.id)
}

/** DELETE /api/artifact-threads/:id — its author only. */
export async function deleteThread(ctx: Ctx, userId: string, id: string) {
  const { th } = await requireThread(ctx, id, userId)
  if (th.createdBy !== userId) fail('forbidden', '只能修改自己的批注')
  await ctx.db.delete(artifactThreads).where(eq(artifactThreads.id, th.id))
}

/** POST /api/artifact-threads/:id/messages */
export async function replyThread(ctx: Ctx, me: Me, id: string, r: ArtifactThreadMessageReq) {
  const { th } = await requireThread(ctx, id, me.id)
  await ctx.db
    .insert(artifactThreadMessages)
    .values({ threadId: th.id, authorKind: 'user', authorId: me.id, text: r.text, to: r.to })
  return one(ctx, th.id)
}

/** One of the thread's messages that `userId` wrote. */
async function ownMessage(ctx: Ctx, userId: string, id: string, messageId: string) {
  const { th } = await requireThread(ctx, id, userId)
  const msgs = await ctx.db
    .select()
    .from(artifactThreadMessages)
    .where(eq(artifactThreadMessages.threadId, th.id))
    .orderBy(asc(artifactThreadMessages.at), asc(artifactThreadMessages.id))
  const m = msgs.find((x) => x.id === messageId) ?? fail('not_found', '批注不存在')
  if (m.authorKind !== 'user' || m.authorId !== userId) fail('forbidden', '只能修改自己的批注')
  return { th, m, first: msgs[0]?.id === m.id }
}

/** PATCH /api/artifact-threads/:id/messages/:messageId */
export async function editThreadMessage(
  ctx: Ctx,
  userId: string,
  id: string,
  messageId: string,
  r: EditArtifactThreadMessageReq,
) {
  const { th, m } = await ownMessage(ctx, userId, id, messageId)
  await ctx.db
    .update(artifactThreadMessages)
    .set({ text: r.text, ...(r.to && { to: r.to }), editedAt: ctx.now() })
    .where(eq(artifactThreadMessages.id, m.id))
  return one(ctx, th.id)
}

/** DELETE /api/artifact-threads/:id/messages/:messageId — the first takes the thread with it (null). */
export async function deleteThreadMessage(ctx: Ctx, userId: string, id: string, messageId: string) {
  const { th, m, first } = await ownMessage(ctx, userId, id, messageId)
  if (first) {
    await ctx.db.delete(artifactThreads).where(eq(artifactThreads.id, th.id))
    return null
  }
  await ctx.db.delete(artifactThreadMessages).where(eq(artifactThreadMessages.id, m.id))
  return one(ctx, th.id)
}
