import {
  type ArtifactThreadAnchor,
  type ArtifactThreadDto,
  type ArtifactThreadMessageReq,
  type ArtifactThreadStatus,
  BRIDGE_SNIPPET_MAX,
  type CreateArtifactThreadReq,
  type EditArtifactThreadMessageReq,
  type ReactArtifactThreadMessageReq,
  type UpdateArtifactThreadReq,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactThreadMessages, artifactThreads, bots, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { readBlob } from './blobs.js'
import { publishArtifactThreads } from './events.js'
import { elementsOf } from './html.js'
import { type Artifact, requireArtifact, requireVersion, type Version } from './service.js'

type Me = { id: string; name: string }
type ThreadRow = typeof artifactThreads.$inferSelect

type StoredAnchor = ArtifactThreadAnchor | { raw: string }
const toStoredAnchor = (anchor: ArtifactThreadAnchor): StoredAnchor =>
  typeof anchor === 'string' ? { raw: anchor } : anchor
const fromStoredAnchor = (stored: StoredAnchor): ArtifactThreadAnchor =>
  typeof stored === 'object' && stored !== null && 'raw' in stored && typeof stored.raw === 'string'
    ? stored.raw
    : (stored as ArtifactThreadAnchor)

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
      ...threads.flatMap((th) => (th.resolvedBy ? [th.resolvedBy] : [])),
      ...msgs.filter((m) => m.authorKind === 'user').map((m) => m.authorId),
      ...msgs.flatMap((m) => m.reactions.flatMap((r) => r.userIds)),
    ]),
  ]
  const botIds = [...new Set(msgs.filter((m) => m.authorKind === 'bot').map((m) => m.authorId))]
  const named = await Promise.all([
    userIds.length
      ? ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [],
    botIds.length
      ? ctx.db.select({ id: bots.id, name: bots.name }).from(bots).where(inArray(bots.id, botIds))
      : [],
  ])
  const names = new Map(named.flat().map((r) => [r.id, r.name]))
  return threads.map((th) => ({
    id: th.id,
    artifactId: th.artifactId,
    versionId: th.versionId,
    anchor: fromStoredAnchor(th.anchor as StoredAnchor),
    label: th.label,
    detail: th.detail,
    location: th.location,
    status: th.status as ArtifactThreadStatus,
    resolvedBy: th.resolvedBy,
    resolvedByName: th.resolvedBy ? (names.get(th.resolvedBy) ?? null) : null,
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
        reactions: m.reactions.map((r) => ({
          emoji: r.emoji,
          userIds: r.userIds,
          authors: r.userIds.map((uid) => ({ id: uid, name: names.get(uid) ?? '' })),
        })),
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

/** The anchor as stored: raw strings are kept verbatim (open-artifact editors); structured anchors match the kind. */
async function placed(a: Artifact, v: Version, anchor: ArtifactThreadAnchor): Promise<ArtifactThreadAnchor> {
  if (typeof anchor === 'string') return anchor
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
  const v = await requireVersion(ctx.db, a, r.versionId ?? null)
  const anchor = await placed(a, v, r.anchor)
  const label =
    r.label ||
    (typeof anchor === 'string'
      ? ''
      : anchor.kind === 'prototype'
        ? anchor.selector || anchor.file
        : anchor.kind === 'site'
          ? anchor.path
          : '')
  const id = await ctx.db.transaction(async (tx) => {
    const [th] = (await tx
      .insert(artifactThreads)
      .values({
        artifactId: a.id,
        versionId: v.id,
        anchor: toStoredAnchor(anchor) as ArtifactThreadAnchor,
        label,
        detail: r.detail ?? null,
        location: r.location ?? {},
        createdBy: me.id,
      })
      .returning()) as [ThreadRow]
    await tx
      .insert(artifactThreadMessages)
      .values({ threadId: th.id, authorKind: 'user', authorId: me.id, text: r.text, to: r.to })
    return th.id
  })
  const created = await one(ctx, id)
  await publishArtifactThreads(ctx, a)
  return created
}

/** A thread of an artifact `userId` may change. */
async function requireThread(ctx: Ctx, id: string, userId: string) {
  const [th] = isUuid(id) ? await ctx.db.select().from(artifactThreads).where(eq(artifactThreads.id, id)) : []
  if (!th) return fail('not_found', '批注不存在')
  return { th, a: await requireArtifact(ctx, th.artifactId, userId) }
}

/** PATCH /api/artifact-threads/:id — any member resolves, reopens or moves it; only its author relabels it. */
export async function updateThread(ctx: Ctx, me: Me, id: string, r: UpdateArtifactThreadReq) {
  const { th, a } = await requireThread(ctx, id, me.id)
  if ((r.label !== undefined || r.detail !== undefined) && th.createdBy !== me.id)
    fail('forbidden', '只能修改自己的批注')
  const anchor = r.anchor && (await placed(a, await requireVersion(ctx.db, a, th.versionId), r.anchor))
  const patch: Partial<typeof artifactThreads.$inferInsert> = {}
  if (anchor !== undefined) patch.anchor = toStoredAnchor(anchor) as ArtifactThreadAnchor
  if (r.label !== undefined) patch.label = r.label
  if (r.detail !== undefined) patch.detail = r.detail
  if (r.location !== undefined) patch.location = r.location
  if (r.status !== undefined) {
    patch.status = r.status
    patch.resolvedBy = r.status === 'resolved' ? me.id : null
  }
  if (Object.keys(patch).length) {
    await ctx.db.update(artifactThreads).set(patch).where(eq(artifactThreads.id, th.id))
    await publishArtifactThreads(ctx, a)
  }
  return one(ctx, th.id)
}

/** DELETE /api/artifact-threads/:id — its author only. */
export async function deleteThread(ctx: Ctx, userId: string, id: string) {
  const { th, a } = await requireThread(ctx, id, userId)
  if (th.createdBy !== userId) fail('forbidden', '只能修改自己的批注')
  await ctx.db.delete(artifactThreads).where(eq(artifactThreads.id, th.id))
  await publishArtifactThreads(ctx, a)
}

/** POST /api/artifact-threads/:id/messages */
export async function replyThread(ctx: Ctx, me: Me, id: string, r: ArtifactThreadMessageReq) {
  const { th, a } = await requireThread(ctx, id, me.id)
  await ctx.db
    .insert(artifactThreadMessages)
    .values({ threadId: th.id, authorKind: 'user', authorId: me.id, text: r.text, to: r.to })
  const updated = await one(ctx, th.id)
  await publishArtifactThreads(ctx, a)
  return updated
}

/** One of the thread's messages that `userId` wrote. */
async function ownMessage(ctx: Ctx, userId: string, id: string, messageId: string) {
  const { th, a } = await requireThread(ctx, id, userId)
  const msgs = await ctx.db
    .select()
    .from(artifactThreadMessages)
    .where(eq(artifactThreadMessages.threadId, th.id))
    .orderBy(asc(artifactThreadMessages.at), asc(artifactThreadMessages.id))
  const m = msgs.find((x) => x.id === messageId) ?? fail('not_found', '批注不存在')
  if (m.authorKind !== 'user' || m.authorId !== userId) fail('forbidden', '只能修改自己的批注')
  return { th, a, m, first: msgs[0]?.id === m.id }
}

/** PATCH /api/artifact-threads/:id/messages/:messageId */
export async function editThreadMessage(
  ctx: Ctx,
  userId: string,
  id: string,
  messageId: string,
  r: EditArtifactThreadMessageReq,
) {
  const { th, a, m } = await ownMessage(ctx, userId, id, messageId)
  await ctx.db
    .update(artifactThreadMessages)
    .set({ text: r.text, ...(r.to && { to: r.to }), editedAt: ctx.now() })
    .where(eq(artifactThreadMessages.id, m.id))
  const updated = await one(ctx, th.id)
  await publishArtifactThreads(ctx, a)
  return updated
}

/** DELETE /api/artifact-threads/:id/messages/:messageId — the first takes the thread with it (null). */
export async function deleteThreadMessage(ctx: Ctx, userId: string, id: string, messageId: string) {
  const { th, a, m, first } = await ownMessage(ctx, userId, id, messageId)
  if (first) {
    await ctx.db.delete(artifactThreads).where(eq(artifactThreads.id, th.id))
    await publishArtifactThreads(ctx, a)
    return null
  }
  await ctx.db.delete(artifactThreadMessages).where(eq(artifactThreadMessages.id, m.id))
  const updated = await one(ctx, th.id)
  await publishArtifactThreads(ctx, a)
  return updated
}

/** POST /api/artifact-threads/:id/messages/:messageId/reactions — toggles `userId`'s reaction on a message. */
export async function reactThreadMessage(
  ctx: Ctx,
  userId: string,
  id: string,
  messageId: string,
  r: ReactArtifactThreadMessageReq,
) {
  const { th, a } = await requireThread(ctx, id, userId)
  const [m] = isUuid(messageId)
    ? await ctx.db
        .select()
        .from(artifactThreadMessages)
        .where(and(eq(artifactThreadMessages.id, messageId), eq(artifactThreadMessages.threadId, th.id)))
    : []
  if (!m) return fail('not_found', '批注不存在')
  const next: { emoji: string; userIds: string[] }[] = []
  let found = false
  for (const item of m.reactions) {
    if (item.emoji !== r.emoji) {
      next.push(item)
      continue
    }
    found = true
    const ids = r.on
      ? item.userIds.includes(userId)
        ? item.userIds
        : [...item.userIds, userId]
      : item.userIds.filter((u) => u !== userId)
    if (ids.length) next.push({ emoji: item.emoji, userIds: ids })
  }
  if (!found && r.on) next.push({ emoji: r.emoji, userIds: [userId] })
  await ctx.db
    .update(artifactThreadMessages)
    .set({ reactions: next })
    .where(eq(artifactThreadMessages.id, m.id))
  const updated = await one(ctx, th.id)
  await publishArtifactThreads(ctx, a)
  return updated
}
