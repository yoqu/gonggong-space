import {
  type GroupThreadsDto,
  GroupThreadsQuery,
  type MessageDto,
  type ThreadDto,
  ThreadFollowReq,
  type ThreadInboxDto,
  ThreadInboxQuery,
  ThreadReadReq,
  type ThreadUnreadDto,
  TimelineQuery,
} from '@gonggong/protocol'
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  ne,
  notInArray,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupMembers,
  groups,
  messageHides,
  messages,
  runs,
  threadFollows,
  users,
} from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireReader } from '../groups/service.js'
import { notHiddenBy } from '../messages/recall.js'
import { messageDto, userAuthorName } from '../messages/service.js'
import { readThreadMentions } from '../notifications/notify.js'
import { reactionsFor } from '../reactions/service.js'
import { cardColumns, runDtoLoader } from '../runs/dto.js'
import { readThread, stateColumns, stateDto, threadState, threadStates, threadSummaries } from './service.js'

const INBOX_LATEST = 2
const BOT_AT_WORK = ['queued', 'offline_wait', 'running', 'awaiting_approval', 'awaiting_answer']

/**
 * Messages matching `where` as `userId` sees them, newest first, with reactions and thread summaries. `keepHidden`
 * (thread roots) returns what the viewer deleted as blanked placeholders instead of dropping it.
 */
export async function loadMessages(
  ctx: Ctx,
  userId: string,
  where: SQL | undefined,
  limit: number,
  keepHidden = false,
) {
  const rows = await ctx.db
    .select({ m: messages, userName: userAuthorName, botName: bots.name })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(and(where, keepHidden ? undefined : notHiddenBy(ctx, userId)))
    .orderBy(desc(messages.seq))
    .limit(limit)
  const ids = rows.map((r) => r.m.id)
  const [reactions, threads, hidden] = await Promise.all([
    reactionsFor(ctx, ids, userId),
    threadSummaries(
      ctx,
      rows.filter((r) => !r.m.threadRootId).map((r) => r.m.id),
      userId,
    ),
    keepHidden && ids.length
      ? ctx.db
          .select({ id: messageHides.messageId })
          .from(messageHides)
          .where(and(eq(messageHides.userId, userId), inArray(messageHides.messageId, ids)))
      : [],
  ])
  const gone = new Set(hidden.map((h) => h.id))
  return rows.map((r): MessageDto => {
    if (gone.has(r.m.id)) {
      const blank = messageDto({ ...r.m, body: '', meta: {} }, r.userName ?? r.botName ?? '')
      const thread = threads.get(r.m.id)
      return { ...blank, hidden: true, ...(thread && { thread }) }
    }
    const dto = messageDto(r.m, r.userName ?? r.botName ?? '', reactions.get(r.m.id))
    const thread = threads.get(r.m.id)
    return thread ? { ...dto, thread } : dto
  })
}

async function requireRoot(ctx: Ctx, rootId: string, userId: string) {
  const [root] = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.id, idParam(rootId, '消息不存在')))
  if (!root) return fail('not_found', '消息不存在')
  await requireReader(ctx, root.groupId, userId)
  if (root.threadRootId) return fail('invalid', '该消息是话题回复')
  return root
}

/** Followed threads of live groups the viewer is still in. */
const followedBy = (userId: string) =>
  and(eq(threadFollows.userId, userId), eq(threadFollows.following, true), isNull(groups.archivedAt))

export function threadRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>('/api/messages/:id/thread', async (req): Promise<ThreadDto> => {
      const me = await requireUser(ctx, req)
      const root = await requireRoot(ctx, req.params.id, me.id)
      const { before, limit } = TimelineQuery.parse(req.query)
      const [[rootDto], replies, runRows, state] = await Promise.all([
        loadMessages(ctx, me.id, eq(messages.id, root.id), 1, true),
        loadMessages(
          ctx,
          me.id,
          and(eq(messages.threadRootId, root.id), before ? lt(messages.seq, before) : undefined),
          limit,
        ),
        ctx.db.select(cardColumns).from(runs).where(eq(runs.threadRootId, root.id)).orderBy(runs.queuedAt),
        threadState(ctx, root, me.id),
      ])
      if (!rootDto) return fail('not_found', '消息不存在')
      const toDto = await runDtoLoader(ctx, runRows)
      return { root: rootDto, replies: replies.reverse(), runs: runRows.map(toDto), state }
    })

    app.put<{ Params: { id: string } }>('/api/messages/:id/thread/read', async (req) => {
      const me = await requireUser(ctx, req)
      const root = await requireRoot(ctx, req.params.id, me.id)
      const { seq } = ThreadReadReq.parse(req.body ?? {})
      const [last] = await ctx.db
        .select({ seq: max(messages.seq) })
        .from(messages)
        .where(eq(messages.threadRootId, root.id))
      const target = Math.min(seq ?? Number.MAX_SAFE_INTEGER, last?.seq ?? 0)
      await readThread(ctx.db, root.id, me.id, target)
      await readThreadMentions(ctx, me.id, root.id, target)
      const state = await threadState(ctx, root, me.id)
      ctx.bus.publish([me.id], { t: 'thread.state', ...state })
      return state
    })

    app.put<{ Params: { id: string } }>('/api/messages/:id/thread/follow', async (req) => {
      const me = await requireUser(ctx, req)
      const root = await requireRoot(ctx, req.params.id, me.id)
      const { following } = ThreadFollowReq.parse(req.body)
      const [last] = await ctx.db
        .select({ seq: max(messages.seq) })
        .from(messages)
        .where(eq(messages.threadRootId, root.id))
      // Following from here on: what came before counts as read.
      await ctx.db
        .insert(threadFollows)
        .values({
          rootMessageId: root.id,
          userId: me.id,
          groupId: root.groupId,
          following,
          lastReadSeq: last?.seq ?? 0,
        })
        .onConflictDoUpdate({
          target: [threadFollows.rootMessageId, threadFollows.userId],
          set: { following },
        })
      const state = await threadState(ctx, root, me.id)
      ctx.bus.publish([me.id], { t: 'thread.state', ...state })
      return state
    })

    app.get<{ Params: { id: string } }>('/api/groups/:id/threads', async (req): Promise<GroupThreadsDto> => {
      const me = await requireUser(ctx, req)
      const groupId = req.params.id
      await requireReader(ctx, groupId, me.id)
      const { cursor, limit } = GroupThreadsQuery.parse(req.query)
      // Both start from the few thread rows (runs_thread / messages_thread), not from every root of the group.
      const live = await ctx.db
        .select({ id: sql<string>`${runs.threadRootId}` })
        .from(runs)
        .where(
          and(eq(runs.groupId, groupId), isNotNull(runs.threadRootId), inArray(runs.status, BOT_AT_WORK)),
        )
        .groupBy(runs.threadRootId)
        .orderBy(desc(max(runs.queuedAt)))
        .limit(200)
      const lastSeq = max(messages.seq)
      // Bots at work come with the first page, whatever its size; the pages after it hold the quiet threads.
      const quiet = await ctx.db
        .select({ id: sql<string>`${messages.threadRootId}`, lastSeq })
        .from(messages)
        .where(
          and(
            eq(messages.groupId, groupId),
            isNotNull(messages.threadRootId),
            isNull(messages.recalledAt),
            ne(messages.kind, 'event'),
            live.length
              ? notInArray(
                  messages.threadRootId,
                  live.map((r) => r.id),
                )
              : undefined,
          ),
        )
        .groupBy(messages.threadRootId)
        .having(cursor ? lt(lastSeq, cursor) : undefined)
        .orderBy(desc(lastSeq))
        .limit(limit)
      const atWork = cursor ? [] : live
      const ids = [...atWork, ...quiet].map((r) => r.id)
      if (!ids.length) return { threads: [], next: null }
      const [loaded, states] = await Promise.all([
        loadMessages(
          ctx,
          me.id,
          and(inArray(messages.id, ids), ne(messages.kind, 'event')),
          ids.length,
          true,
        ),
        threadStates(ctx, ids, me.id),
      ])
      const liveIds = new Set(atWork.map((r) => r.id))
      return {
        threads: ids.flatMap((id) => {
          const root = loaded.find((m) => m.id === id)
          if (!root) return []
          const state = states.get(id) ?? {
            rootId: id,
            groupId,
            following: false,
            lastReadSeq: 0,
            unread: 0,
            mentioned: false,
          }
          return [{ root, state, live: liveIds.has(id) }]
        }),
        next: quiet.length === limit ? (quiet.at(-1)?.lastSeq ?? null) : null,
      }
    })

    app.get('/api/threads', async (req): Promise<ThreadInboxDto> => {
      const me = await requireUser(ctx, req)
      const { before, limit } = ThreadInboxQuery.parse(req.query)
      const lastSeq = sql<number>`(select max(m.seq) from messages m where m.thread_root_id = ${threadFollows.rootMessageId})`
      const rows = await ctx.db
        .select({ ...stateColumns, lastSeq, groupName: groups.name })
        .from(threadFollows)
        .innerJoin(
          groupMembers,
          and(eq(groupMembers.groupId, threadFollows.groupId), eq(groupMembers.userId, threadFollows.userId)),
        )
        .innerJoin(groups, eq(groups.id, threadFollows.groupId))
        .where(
          and(
            followedBy(me.id),
            sql`${lastSeq} is not null`,
            before ? sql`${lastSeq} < ${before}` : undefined,
          ),
        )
        .orderBy(desc(lastSeq))
        .limit(limit)
      const rootIds = rows.map((r) => r.rootId)
      if (!rootIds.length) return { threads: [] }
      const [roots, latest] = await Promise.all([
        loadMessages(ctx, me.id, inArray(messages.id, rootIds), rootIds.length, true),
        loadMessages(
          ctx,
          me.id,
          sql`${messages.id} in (select id from (select m.id, row_number() over (partition by m.thread_root_id order by m.seq desc) n
            from messages m where m.thread_root_id in ${rootIds}) x where x.n <= ${INBOX_LATEST})`,
          rootIds.length * INBOX_LATEST,
        ),
      ])
      return {
        threads: rows.flatMap((r) => {
          const root = roots.find((m) => m.id === r.rootId)
          if (!root) return []
          return [
            {
              groupId: r.groupId,
              groupName: r.groupName,
              root,
              latest: latest.filter((m) => m.threadRootId === r.rootId).reverse(),
              state: stateDto(r),
            },
          ]
        }),
      }
    })

    app.get('/api/threads/unread', async (req): Promise<ThreadUnreadDto> => {
      const me = await requireUser(ctx, req)
      const rows = await ctx.db
        .select({ unread: stateColumns.unread, mentioned: stateColumns.mentioned })
        .from(threadFollows)
        .innerJoin(
          groupMembers,
          and(eq(groupMembers.groupId, threadFollows.groupId), eq(groupMembers.userId, threadFollows.userId)),
        )
        .innerJoin(groups, eq(groups.id, threadFollows.groupId))
        .where(followedBy(me.id))
      return {
        unread: rows.filter((r) => r.unread > 0).length,
        mentioned: rows.filter((r) => r.mentioned).length,
      }
    })
  }
}
