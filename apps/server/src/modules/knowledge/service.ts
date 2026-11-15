import {
  type CreateKnowledgeReq,
  KNOWLEDGE_MAX_ENTRIES,
  type KnowledgeAuthor,
  type KnowledgeDetailDto,
  type KnowledgeEntryDto,
  type KnowledgeVersionDto,
  type ProtocolKey,
  type UpdateKnowledgeReq,
} from '@gonggong/protocol'
import { and, count, desc, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupKnowledge, groupKnowledgeVersions, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { likePattern } from '../../lib/text.js'
import { memberIds, postEvent } from '../messages/service.js'

export type KnowledgeRow = typeof groupKnowledge.$inferSelect
/** A member in the app, or a bot through the kb_* tools; `name` signs the group event. */
export type Actor = { userId: string; name: string } | { botId: string; name: string }
type Content = Pick<KnowledgeRow, 'title' | 'body' | 'tags'>

const EXCERPT_MAX = 200
const live = isNull(groupKnowledge.archivedAt)

/** Title, body or tags contain `q` (a group holds at most a few hundred entries: a scan is fine). */
export const matching = (q: string) => {
  const p = likePattern(q)
  return or(
    ilike(groupKnowledge.title, p),
    ilike(groupKnowledge.body, p),
    sql`${groupKnowledge.tags}::text ilike ${p}`,
  )
}

/** Live entries matching `where` with their last editor's name, pinned first, then most recently updated. */
export function loadEntries(ctx: Ctx, where?: SQL) {
  return ctx.db
    .select({ e: groupKnowledge, user: users.name, bot: bots.name })
    .from(groupKnowledge)
    .leftJoin(users, eq(users.id, groupKnowledge.updatedByUserId))
    .leftJoin(bots, eq(bots.id, groupKnowledge.updatedByBotId))
    .where(and(live, where))
    .orderBy(desc(groupKnowledge.pinned), desc(groupKnowledge.updatedAt))
}
export type Loaded = Awaited<ReturnType<typeof loadEntries>>[number]

const author = (
  userId: string | null,
  botId: string | null,
  user: string | null,
  bot: string | null,
): KnowledgeAuthor | null =>
  userId
    ? { kind: 'user', id: userId, name: user ?? '' }
    : botId
      ? { kind: 'bot', id: botId, name: bot ?? '' }
      : null

const excerpt = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX)

const baseDto = ({ e, user, bot }: Loaded) => ({
  id: e.id,
  title: e.title,
  tags: e.tags,
  pinned: e.pinned,
  version: e.version,
  updatedBy: author(e.updatedByUserId, e.updatedByBotId, user, bot),
  updatedAt: e.updatedAt.toISOString(),
})
export const entryDto = (l: Loaded): KnowledgeEntryDto => ({ ...baseDto(l), excerpt: excerpt(l.e.body) })
export const detailDto = (l: Loaded): KnowledgeDetailDto => ({ ...baseDto(l), body: l.e.body })

export async function entryById(ctx: Ctx, id: string) {
  const [row] = isUuid(id) ? await loadEntries(ctx, eq(groupKnowledge.id, id)) : []
  return row
}

export async function requireEntry(ctx: Ctx, id: string) {
  return (await entryById(ctx, id)) ?? fail('not_found', '知识库条目不存在')
}

const by = (actor: Actor) =>
  'userId' in actor ? { userId: actor.userId, botId: null } : { userId: null, botId: actor.botId }

async function announce(
  ctx: Ctx,
  e: KnowledgeRow,
  key: ProtocolKey,
  params: Record<string, string | number>,
) {
  await postEvent(ctx, e.groupId, key, params)
  ctx.bus.publish(await memberIds(ctx, e.groupId), {
    t: 'group.knowledge',
    groupId: e.groupId,
    entryId: e.id,
  })
}

export async function createKnowledge(ctx: Ctx, groupId: string, req: CreateKnowledgeReq, actor: Actor) {
  const [n] = await ctx.db
    .select({ n: count() })
    .from(groupKnowledge)
    .where(and(live, eq(groupKnowledge.groupId, groupId)))
  if ((n?.n ?? 0) >= KNOWLEDGE_MAX_ENTRIES)
    fail('invalid', '每个群最多 {n} 条知识库条目', { n: KNOWLEDGE_MAX_ENTRIES })
  const who = by(actor)
  const now = ctx.now()
  const content = { title: req.title, body: req.body, tags: req.tags }
  const e = await ctx.db.transaction(async (tx) => {
    const [row] = (await tx
      .insert(groupKnowledge)
      .values({
        groupId,
        ...content,
        pinned: req.pinned ?? false,
        updatedByUserId: who.userId,
        updatedByBotId: who.botId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [KnowledgeRow]
    await tx.insert(groupKnowledgeVersions).values({
      entryId: row.id,
      version: 1,
      ...content,
      action: 'create',
      byUserId: who.userId,
      byBotId: who.botId,
      createdAt: now,
    })
    return row
  })
  await announce(ctx, e, '{who} 新建了知识库条目「{title}」', { who: actor.name, title: e.title })
  return e
}

const sameContent = (a: Content, b: Content) =>
  a.title === b.title && a.body === b.body && JSON.stringify(a.tags) === JSON.stringify(b.tags)

/**
 * A content change moves `e` from `baseVersion` to a new version (another change since → 409). Pinning alone is
 * admin metadata: no version, no conflict check, and the last edit stays as it was.
 */
async function write(
  ctx: Ctx,
  e: KnowledgeRow,
  baseVersion: number,
  next: Content,
  pinned: boolean,
  action: 'update' | 'rollback',
  actor: Actor,
) {
  const conflict = () => fail('conflict', '条目已被他人修改，请刷新后再改')
  const changed = !sameContent(next, e)
  if (!changed) {
    if (pinned === e.pinned) return e
    const [row] = await ctx.db
      .update(groupKnowledge)
      .set({ pinned })
      .where(and(eq(groupKnowledge.id, e.id), live))
      .returning()
    return row ?? fail('not_found', '知识库条目不存在')
  }
  if (baseVersion !== e.version) conflict()
  const who = by(actor)
  const now = ctx.now()
  const version = e.version + 1
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(groupKnowledge)
      .set({
        ...next,
        pinned,
        version,
        updatedByUserId: who.userId,
        updatedByBotId: who.botId,
        updatedAt: now,
      })
      .where(and(eq(groupKnowledge.id, e.id), eq(groupKnowledge.version, baseVersion), live))
      .returning()
    if (!row) return conflict()
    await tx.insert(groupKnowledgeVersions).values({
      entryId: e.id,
      version,
      ...next,
      action,
      byUserId: who.userId,
      byBotId: who.botId,
      createdAt: now,
    })
    return row
  })
}

/** Pinning is checked by the caller (group admins only). */
export async function updateKnowledge(ctx: Ctx, e: KnowledgeRow, req: UpdateKnowledgeReq, actor: Actor) {
  const next = { title: req.title ?? e.title, body: req.body ?? e.body, tags: req.tags ?? e.tags }
  const row = await write(ctx, e, req.baseVersion, next, req.pinned ?? e.pinned, 'update', actor)
  const params = { who: actor.name, title: row.title }
  if (row.version !== e.version) await announce(ctx, row, '{who} 更新了知识库条目「{title}」', params)
  if (row.pinned !== e.pinned)
    await announce(
      ctx,
      row,
      row.pinned ? '{who} 置顶了知识库条目「{title}」' : '{who} 取消置顶了知识库条目「{title}」',
      params,
    )
  return row
}

/** The old version's content becomes a new version. */
export async function rollbackKnowledge(ctx: Ctx, e: KnowledgeRow, version: number, actor: Actor) {
  const [old] = await ctx.db
    .select()
    .from(groupKnowledgeVersions)
    .where(and(eq(groupKnowledgeVersions.entryId, e.id), eq(groupKnowledgeVersions.version, version)))
  if (!old) return fail('not_found', '版本不存在')
  if (version === e.version) fail('invalid', '已是当前版本')
  const content = { title: old.title, body: old.body, tags: old.tags }
  const row = await write(ctx, e, e.version, content, e.pinned, 'rollback', actor)
  await announce(ctx, row, '{who} 将知识库条目「{title}」回滚到 v{version}', {
    who: actor.name,
    title: row.title,
    version,
  })
  return row
}

export async function deleteKnowledge(ctx: Ctx, e: KnowledgeRow, actor: Actor) {
  await ctx.db.update(groupKnowledge).set({ archivedAt: ctx.now() }).where(eq(groupKnowledge.id, e.id))
  await announce(ctx, e, '{who} 删除了知识库条目「{title}」', { who: actor.name, title: e.title })
}

export async function knowledgeVersions(ctx: Ctx, e: KnowledgeRow): Promise<KnowledgeVersionDto[]> {
  const rows = await ctx.db
    .select({ v: groupKnowledgeVersions, user: users.name, bot: bots.name })
    .from(groupKnowledgeVersions)
    .leftJoin(users, eq(users.id, groupKnowledgeVersions.byUserId))
    .leftJoin(bots, eq(bots.id, groupKnowledgeVersions.byBotId))
    .where(eq(groupKnowledgeVersions.entryId, e.id))
    .orderBy(desc(groupKnowledgeVersions.version))
  return rows.map(({ v, user, bot }) => ({
    version: v.version,
    title: v.title,
    body: v.body,
    tags: v.tags,
    action: v.action as KnowledgeVersionDto['action'],
    by: author(v.byUserId, v.byBotId, user, bot),
    at: v.createdAt.toISOString(),
    current: v.version === e.version,
  }))
}
