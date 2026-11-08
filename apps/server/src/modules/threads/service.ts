import type { ThreadStateDto, ThreadSummary } from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { messages, threadFollows } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { type MessageRow, memberIds } from '../messages/service.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
const PARTICIPANTS = 3

/** The root a reply in `groupId` may hang under: a user or bot message of the group that is not a reply itself. */
export async function threadRoot(ctx: Ctx, groupId: string, rootId: string) {
  const [root] = isUuid(rootId)
    ? await ctx.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, rootId), eq(messages.groupId, groupId)))
    : []
  if (!root) return fail('not_found', '消息不存在')
  if (root.threadRootId || root.kind === 'event') return fail('invalid', '只能在群里的普通消息下回复话题')
  return root
}

/** Reply summaries of the roots among `rootIds` that have replies. */
export async function threadSummaries(
  ctx: Ctx,
  rootIds: string[],
  /** Adds this user's unread and @ to each summary. */
  viewerId?: string,
): Promise<Map<string, ThreadSummary>> {
  const out = new Map<string, ThreadSummary>()
  if (!rootIds.length) return out
  const author = sql<string>`coalesce(${messages.authorUserId}, ${messages.authorBotId})`
  const inThreads = and(
    inArray(messages.threadRootId, rootIds),
    isNull(messages.recalledAt),
    ne(messages.kind, 'event'),
  )
  const [totals, authors] = await Promise.all([
    ctx.db
      .select({
        rootId: messages.threadRootId,
        n: sql<number>`count(*)`.mapWith(Number),
        last: sql<Date>`max(${messages.createdAt})`.mapWith((v: string | Date) => new Date(v)),
      })
      .from(messages)
      .where(inThreads)
      .groupBy(messages.threadRootId),
    ctx.db
      .select({ rootId: messages.threadRootId, author, first: sql<number>`min(${messages.seq})` })
      .from(messages)
      .where(and(inThreads, sql`${author} is not null`))
      .groupBy(messages.threadRootId, author)
      .orderBy(sql`min(${messages.seq})`),
  ])
  const states = viewerId ? await threadStates(ctx, rootIds, viewerId) : new Map<string, ThreadStateDto>()
  for (const t of totals)
    if (t.rootId) {
      const mine = states.get(t.rootId)
      out.set(t.rootId, {
        replyCount: t.n,
        lastReplyAt: t.last.toISOString(),
        participants: [],
        ...(viewerId && { unread: mine?.unread ?? 0, mentioned: mine?.mentioned ?? false }),
      })
    }
  for (const a of authors) {
    const s = a.rootId ? out.get(a.rootId) : undefined
    if (s && s.participants.length < PARTICIPANTS) s.participants.push(a.author)
  }
  return out
}

/** `userId`'s state of each of the threads `rootIds`; threads they never followed are absent. */
export async function threadStates(ctx: Ctx, rootIds: string[], userId: string) {
  const out = new Map<string, ThreadStateDto>()
  if (!rootIds.length) return out
  const rows = await ctx.db
    .select(stateColumns)
    .from(threadFollows)
    .where(and(inArray(threadFollows.rootMessageId, rootIds), eq(threadFollows.userId, userId)))
  for (const r of rows) out.set(r.rootId, stateDto(r))
  return out
}

/**
 * After a reply: its author and the members it @s follow the thread (again), the root's author unless they opted
 * out; the author has read up to it.
 */
export async function followOnReply(tx: Tx, root: MessageRow, reply: MessageRow, mentioned: string[]) {
  const values = (userIds: string[]) =>
    userIds.map((userId) => ({ rootMessageId: root.id, userId, groupId: root.groupId }))
  if (root.authorUserId)
    await tx
      .insert(threadFollows)
      .values(values([root.authorUserId]))
      .onConflictDoNothing()
  const joining = [...new Set([...(reply.authorUserId ? [reply.authorUserId] : []), ...mentioned])]
  if (joining.length)
    await tx
      .insert(threadFollows)
      .values(values(joining))
      .onConflictDoUpdate({
        target: [threadFollows.rootMessageId, threadFollows.userId],
        set: { following: true },
      })
  if (reply.authorUserId) await readThread(tx, root.id, reply.authorUserId, reply.seq)
}

export async function readThread(db: Tx | Db, rootId: string, userId: string, seq: number) {
  await db
    .update(threadFollows)
    .set({ lastReadSeq: sql`greatest(${threadFollows.lastReadSeq}, ${seq})` })
    .where(and(eq(threadFollows.rootMessageId, rootId), eq(threadFollows.userId, userId)))
}

// Replies by others after the follower's read mark; an unfollowed thread counts nothing. A bot's reply to a run the
// follower started counts as an @ to them.
const unreadSql =
  sql<number>`(select count(*) from messages m where m.thread_root_id = ${threadFollows.rootMessageId}
  and m.seq > ${threadFollows.lastReadSeq} and m.author_user_id is distinct from ${threadFollows.userId}
  and m.recalled_at is null and m.kind <> 'event')`.mapWith(Number)
const mentionedSql = sql<boolean>`coalesce((select true from messages m where m.thread_root_id = ${threadFollows.rootMessageId}
  and m.seq > ${threadFollows.lastReadSeq} and m.author_user_id is distinct from ${threadFollows.userId}
  and m.recalled_at is null and (m.meta->'userMentions' @> jsonb_build_array(${threadFollows.userId})
    or exists (select 1 from runs r where r.id = m.run_id and r.trigger_user_id = ${threadFollows.userId})) limit 1), false)`

export const stateColumns = {
  rootId: threadFollows.rootMessageId,
  groupId: threadFollows.groupId,
  following: threadFollows.following,
  lastReadSeq: threadFollows.lastReadSeq,
  unread: unreadSql,
  mentioned: mentionedSql,
}

export const stateDto = (r: {
  rootId: string
  groupId: string
  following: boolean
  lastReadSeq: number
  unread: number
  mentioned: boolean
}): ThreadStateDto => ({
  rootId: r.rootId,
  groupId: r.groupId,
  following: r.following,
  lastReadSeq: r.lastReadSeq,
  unread: r.following ? r.unread : 0,
  mentioned: r.following && r.mentioned,
})

/** `userId`'s state of the thread; not following it when they never did. */
export async function threadState(ctx: Ctx, root: Pick<MessageRow, 'id' | 'groupId'>, userId: string) {
  const [row] = await ctx.db
    .select(stateColumns)
    .from(threadFollows)
    .where(and(eq(threadFollows.rootMessageId, root.id), eq(threadFollows.userId, userId)))
  return row
    ? stateDto(row)
    : {
        rootId: root.id,
        groupId: root.groupId,
        following: false,
        lastReadSeq: 0,
        unread: 0,
        mentioned: false,
      }
}

/** After a reply came or went: the root's summary to every member, each follower's own state to them. */
export async function publishThread(ctx: Ctx, root: Pick<MessageRow, 'id' | 'groupId'>) {
  const [summary, followers] = await Promise.all([
    threadSummaries(ctx, [root.id]),
    ctx.db
      .select({ ...stateColumns, userId: threadFollows.userId })
      .from(threadFollows)
      .where(and(eq(threadFollows.rootMessageId, root.id), eq(threadFollows.following, true)))
      .orderBy(asc(threadFollows.createdAt)),
  ])
  ctx.bus.publish(await memberIds(ctx, root.groupId), {
    t: 'thread.updated',
    groupId: root.groupId,
    rootId: root.id,
    thread: summary.get(root.id) ?? null,
  })
  for (const f of followers) ctx.bus.publish([f.userId], { t: 'thread.state', ...stateDto(f) })
}

/** Thread replies not also sent to the group live in their thread only. */
export const inMainTimeline = sql`(${messages.threadRootId} is null or ${messages.meta}->>'alsoSent' is not null)`
