import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifacts, artifactVersions, previews } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { findMember, requireMember } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { artifactBlobs } from './blobs.js'
import { type Artifact, cardOf, isArtifactManager, runners } from './service.js'

/** Every blob the artifact's versions list or show (files, thumbnails, screen PNGs). */
async function blobsOf(ctx: Ctx, a: Artifact) {
  const vs = await ctx.db
    .select({
      files: artifactVersions.files,
      thumb: artifactVersions.thumbnailHash,
      screens: artifactVersions.screenThumbs,
    })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, a.id))
  const out = new Set<string>()
  for (const v of vs) {
    for (const f of v.files) out.add(f.hash)
    if (v.thumb) out.add(v.thumb)
    for (const s of v.screens) out.add(s.hash)
  }
  return out
}

/**
 * POST /api/artifacts/:id/move — the artifact, its versions, previews (and so its share link) go to `groupId`; its
 * blobs are copied into that group's store (the target's quota applies; the source's copies stay, other artifacts may
 * list them). Its bot stays: artifact previews hang off it and are served from blobs, never through its machine.
 */
export async function moveArtifact(ctx: Ctx, a: Artifact, userId: string, groupId: string) {
  const from = await requireMember(ctx, a.groupId, userId)
  if (!(await isArtifactManager(ctx, a, userId, from.member.isAdmin)))
    return fail('forbidden', '只有产物创建人、Bot 主人或群管理员能移动产物')
  const to = (await findMember(ctx, groupId, userId)) ?? fail('not_found', '群不存在或你已不在群内')
  if (groupId === a.groupId) return fail('conflict', '产物已在这个群')
  if (a.archivedAt) return fail('conflict', '已删除的产物不能移动')
  const [taken] = await ctx.db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.groupId, groupId), eq(artifacts.dir, a.dir)))
  if (taken) return fail('conflict', '目标群已有同一目录的产物：{dir}', { dir: a.dir })
  if ((await runners(ctx.db, a.groupId)).has(a.id))
    return fail('conflict', 'Bot 正在修改这个产物，等本轮结束后再移动')

  for (const hash of await blobsOf(ctx, a))
    if ((await artifactBlobs.touch(groupId, hash)) === null)
      await artifactBlobs.write(groupId, hash, await artifactBlobs.open(a.groupId, hash), false)

  const moved = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(artifacts)
      .set({ groupId, checkoutBotIds: [], updatedAt: ctx.now() })
      .where(and(eq(artifacts.id, a.id), eq(artifacts.groupId, a.groupId)))
      .returning()
    if (!row) return fail('conflict', '产物已在这个群')
    await tx.update(previews).set({ groupId }).where(eq(previews.artifactId, a.id))
    return row
  })
  const params = { title: moved.title }
  await postEvent(ctx, a.groupId, '产物「{title}」已移到群「{group}」', { ...params, group: to.group.name })
  const posted = await postEvent(
    ctx,
    groupId,
    '产物「{title}」从群「{group}」移入',
    { ...params, group: from.group.name },
    { card: await cardOf(ctx.db, moved) },
  )
  const [withCard] = await ctx.db
    .update(artifacts)
    .set({ messageId: posted.id })
    .where(eq(artifacts.id, a.id))
    .returning()
  return withCard as Artifact
}
