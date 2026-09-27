import type { GroupDto } from '@gonggong/protocol'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupMembers, groupRepos, groups, messages, runs, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { memberIds, postEvent } from '../messages/service.js'
import { stopRuns } from '../runs/stop.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

/** Non-members get not_found so group ids don't leak. */
export async function requireMember(ctx: Ctx, groupId: string, userId: string) {
  if (!isUuid(groupId)) return fail('not_found', '群不存在或你已不在群内')
  const [row] = await ctx.db
    .select({ group: groups, member: groupMembers })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(eq(groups.id, groupId), isNull(groups.archivedAt)))
  return row ?? fail('not_found', '群不存在或你已不在群内')
}

export async function requireAdmin(ctx: Ctx, groupId: string, userId: string) {
  const row = await requireMember(ctx, groupId, userId)
  return row.member.isAdmin ? row : fail('forbidden', '仅群管理员可操作')
}

/** Bots currently in the group (not removed, not deleted). */
export function activeBots(ctx: Ctx, groupId: string) {
  return ctx.db
    .select({ id: bots.id, name: bots.name, ownerId: bots.ownerId, machineId: bots.machineId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt), isNull(bots.deletedAt)))
    .orderBy(asc(groupBots.addedAt))
}

const preview = (kind: string, author: string | null, body: string) => {
  const line = body.replace(/\n[\s\S]*$/, '').slice(0, 80)
  return kind === 'event' ? line : `${author ?? ''}：${line}`
}

const recallNote = (mine: boolean, author: string | null) =>
  `${mine ? '你' : `${author ?? ''} `}撤回了一条消息`

/** Group DTOs as seen by `userId` (unread is per user). */
export async function groupDtos(ctx: Ctx, userId: string, ids?: string[]): Promise<GroupDto[]> {
  const rows = await ctx.db
    .select({ group: groups, me: groupMembers })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(isNull(groups.archivedAt), ids ? inArray(groups.id, ids) : undefined))
    .orderBy(asc(groups.createdAt))
  const gids = rows.map((r) => r.group.id)
  if (!gids.length) return []

  const [members, groupBotRows, repos, stats, lasts, live] = await Promise.all([
    ctx.db
      .select({
        groupId: groupMembers.groupId,
        userId: users.id,
        name: users.name,
        isAdmin: groupMembers.isAdmin,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(inArray(groupMembers.groupId, gids))
      .orderBy(asc(groupMembers.joinedAt)),
    ctx.db
      .select({ groupId: groupBots.groupId, botId: groupBots.botId })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .where(and(inArray(groupBots.groupId, gids), isNull(groupBots.removedAt), isNull(bots.deletedAt)))
      .orderBy(asc(groupBots.addedAt)),
    ctx.db.select().from(groupRepos).where(inArray(groupRepos.groupId, gids)),
    ctx.db
      .select({
        groupId: messages.groupId,
        lastSeq: sql<number>`max(${messages.seq})`.mapWith(Number),
        // System events and my own messages never count as unread.
        unread: sql<number>`count(*) filter (where ${messages.seq} > ${groupMembers.lastReadSeq}
          and ${messages.kind} <> 'event' and ${messages.authorUserId} is distinct from ${userId})`.mapWith(
          Number,
        ),
      })
      .from(messages)
      .innerJoin(
        groupMembers,
        and(eq(groupMembers.groupId, messages.groupId), eq(groupMembers.userId, userId)),
      )
      .where(inArray(messages.groupId, gids))
      .groupBy(messages.groupId, groupMembers.lastReadSeq),
    ctx.db
      .selectDistinctOn([messages.groupId], {
        groupId: messages.groupId,
        kind: messages.kind,
        body: messages.body,
        userName: users.name,
        botName: bots.name,
        authorUserId: messages.authorUserId,
        recalledAt: messages.recalledAt,
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.authorUserId))
      .leftJoin(bots, eq(bots.id, messages.authorBotId))
      .where(inArray(messages.groupId, gids))
      .orderBy(messages.groupId, desc(messages.seq)),
    ctx.db
      .select({ groupId: runs.groupId, id: runs.id })
      .from(runs)
      .where(and(inArray(runs.groupId, gids), inArray(runs.status, LIVE)))
      .orderBy(asc(runs.queuedAt)),
  ])

  return rows.map(({ group: g, me }) => {
    const repo = repos.find((r) => r.groupId === g.id)
    const stat = stats.find((s) => s.groupId === g.id)
    const last = lasts.find((l) => l.groupId === g.id)
    return {
      id: g.id,
      name: g.name,
      kind: g.kind as GroupDto['kind'],
      mode: g.mode as GroupDto['mode'],
      notice: g.notice,
      noticeHidden: !!g.noticeId && me.hiddenNoticeId === g.noticeId,
      repo: repo ? { url: repo.url, branch: repo.baseBranch } : null,
      members: members
        .filter((m) => m.groupId === g.id)
        .map(({ userId, name, isAdmin }) => ({ userId, name, isAdmin })),
      botIds: groupBotRows.filter((b) => b.groupId === g.id).map((b) => b.botId),
      unread: stat?.unread ?? 0,
      lastSeq: stat?.lastSeq ?? 0,
      last: !last
        ? ''
        : last.recalledAt
          ? recallNote(last.authorUserId === userId, last.userName)
          : preview(last.kind, last.userName ?? last.botName, last.body),
      pinned: me.pinned,
      muted: me.muted,
      foldRuns: me.foldRuns,
      liveRunIds: live.filter((r) => r.groupId === g.id).map((r) => r.id),
    }
  })
}

export async function groupDto(ctx: Ctx, userId: string, groupId: string) {
  const [dto] = await groupDtos(ctx, userId, [groupId])
  return dto ?? fail('not_found', '群不存在或你已不在群内')
}

type User = { id: string; name: string }

/** Takes `userId` out of the group with their bots (plan D5); those bots' unfinished runs are stopped. */
export async function removeMember(ctx: Ctx, groupId: string, userId: string, by: User) {
  const theirBots = (await activeBots(ctx, groupId)).filter((b) => b.ownerId === userId)
  const botIds = theirBots.map((b) => b.id)
  await ctx.db.transaction(async (tx) => {
    if (botIds.length)
      await tx
        .update(groupBots)
        .set({ removedAt: ctx.now() })
        .where(and(eq(groupBots.groupId, groupId), inArray(groupBots.botId, botIds)))
    await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  })
  if (botIds.length) await stopRuns(ctx, { groupId, botIds }, by)
  for (const b of theirBots) await postEvent(ctx, groupId, `${b.name} 被移出 · 工作区保留`)
  ctx.bus.publish([userId], { t: 'group.removed', groupId })
}

/** Pushes each member their own view of the group. */
export async function publishGroup(ctx: Ctx, groupId: string) {
  for (const userId of await memberIds(ctx, groupId)) {
    const [group] = await groupDtos(ctx, userId, [groupId])
    if (group) ctx.bus.publish([userId], { t: 'group.updated', group })
  }
}
