import type { GroupDto, I18nText } from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupBots,
  groupMembers,
  groupRepos,
  groups,
  messages,
  runs,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { zhText } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { forgetMembers, type MessageMeta, memberIds, postEvent } from '../messages/service.js'
import { stopRuns } from '../runs/stop.js'
import { avatarUrl } from '../users/dto.js'
import { groupTitle } from './title.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

/** Non-members (of the group or of its live team) get not_found so group ids don't leak. */
export async function requireMember(ctx: Ctx, groupId: string, userId: string) {
  if (!isUuid(groupId)) return fail('not_found', '群不存在或你已不在群内')
  const [row] = await ctx.db
    .select({ group: groups, member: groupMembers })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, groups.teamId), eq(teamMembers.userId, userId)))
    .innerJoin(teams, eq(teams.id, groups.teamId))
    .where(and(eq(groups.id, groupId), isNull(groups.archivedAt), isNull(teams.archivedAt)))
  return row ?? fail('not_found', '群不存在或你已不在群内')
}

/**
 * Read access (plan D19): members, plus admins of the group's live team viewing one of its groups (never a DM).
 * `member` is null for the latter; every write endpoint keeps requireMember / requireAdmin.
 */
export async function requireReader(ctx: Ctx, groupId: string, userId: string) {
  if (!isUuid(groupId)) return fail('not_found', '群不存在或你已不在群内')
  const [row] = await ctx.db
    .select({ group: groups, member: groupMembers, role: teamMembers.role })
    .from(groups)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, groups.teamId), eq(teamMembers.userId, userId)))
    .innerJoin(teams, eq(teams.id, groups.teamId))
    .leftJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(eq(groups.id, groupId), isNull(groups.archivedAt), isNull(teams.archivedAt)))
  if (row && (row.member || (row.group.kind === 'group' && row.role !== 'member'))) return row
  return fail('not_found', '群不存在或你已不在群内')
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

const recallNote = (mine: boolean, author: string | null): I18nText =>
  mine ? { key: '你撤回了一条消息' } : { key: '{user} 撤回了一条消息', params: { user: author ?? '' } }

/** Group DTOs matching `where` as seen by `userId` (unread is per user). */
export async function groupDtos(ctx: Ctx, userId: string, where?: SQL): Promise<GroupDto[]> {
  return (await groupViews(ctx, [userId], where)).map((v) => v.group)
}

/**
 * A group's messages after seq `after`, spelled as row comparisons so that only the (group_id, seq) index serves them:
 * given `group_id = …` the planner may walk the global seq index instead, past every other group's messages.
 */
const inGroupAfter = (after: string) =>
  `(m.group_id, m.seq) > ("groups"."id", ${after}) and (m.group_id, m.seq) < ("groups"."id", ${Number.MAX_SAFE_INTEGER})`
const latest = (col: string) =>
  sql.raw(
    `(select m.${col} from messages m where ${inGroupAfter('0')} order by m.group_id desc, m.seq desc limit 1)`,
  )
const lastSeq = sql<number | null>`${latest('seq')}`
const lastId = sql<string | null>`${latest('id')}`
// System events and the viewer's own messages never count as unread.
const unread =
  sql<number>`${sql.raw(`(select count(*) from messages m where ${inGroupAfter('"group_members"."last_read_seq"')}
  and m.kind <> 'event' and m.author_user_id is distinct from "group_members"."user_id")`)}`.mapWith(Number)

/** `userId`'s unread messages per team, over the live groups they are in. */
export async function unreadByTeam(ctx: Ctx, userId: string) {
  const rows = await ctx.db
    .select({ teamId: groups.teamId, unread })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(isNull(groups.archivedAt))
  const byTeam = new Map<string, number>()
  for (const r of rows) byTeam.set(r.teamId, (byTeam.get(r.teamId) ?? 0) + r.unread)
  return byTeam
}

/**
 * Each of `userIds`' views of their groups matching `where` (all when omitted): what the groups are is loaded once;
 * unread, the last line's wording and their own settings differ per viewer.
 */
async function groupViews(ctx: Ctx, userIds: string[], where?: SQL) {
  if (!userIds.length) return []
  const rows = await ctx.db
    .select({ group: groups, title: groupTitle, me: groupMembers, lastSeq, lastId, unread })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), inArray(groupMembers.userId, userIds)))
    .where(and(isNull(groups.archivedAt), where))
    .orderBy(asc(groups.createdAt))
  const gids = [...new Set(rows.map((r) => r.group.id))]
  if (!gids.length) return []
  const lastIds = [...new Set(rows.flatMap((r) => (r.lastId ? [r.lastId] : [])))]

  const [members, groupBotRows, repos, lasts, live] = await Promise.all([
    ctx.db
      .select({
        groupId: groupMembers.groupId,
        userId: users.id,
        name: users.name,
        avatar: users.avatar,
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
    lastIds.length
      ? ctx.db
          .select({
            groupId: messages.groupId,
            kind: messages.kind,
            body: messages.body,
            userName: users.name,
            botName: bots.name,
            authorUserId: messages.authorUserId,
            recalledAt: messages.recalledAt,
            meta: messages.meta,
          })
          .from(messages)
          .leftJoin(users, eq(users.id, messages.authorUserId))
          .leftJoin(bots, eq(bots.id, messages.authorBotId))
          .where(inArray(messages.id, lastIds))
      : [],
    ctx.db
      .select({ groupId: runs.groupId, id: runs.id })
      .from(runs)
      .where(and(inArray(runs.groupId, gids), inArray(runs.status, LIVE)))
      .orderBy(asc(runs.queuedAt)),
  ])

  return rows.map(({ group: g, title, me, lastSeq, unread }) => {
    const repo = repos.find((r) => r.groupId === g.id)
    const last = lasts.find((l) => l.groupId === g.id)
    const lastI18n = last?.recalledAt
      ? recallNote(last.authorUserId === me.userId, last.userName)
      : last?.kind === 'event'
        ? (last.meta as MessageMeta).i18n
        : undefined
    const group: GroupDto = {
      id: g.id,
      teamId: g.teamId,
      name: title,
      kind: g.kind as GroupDto['kind'],
      mode: g.mode as GroupDto['mode'],
      notice: g.notice,
      noticeHidden: !!g.noticeId && me.hiddenNoticeId === g.noticeId,
      repo: repo ? { url: repo.url, branch: repo.baseBranch } : null,
      members: members
        .filter((m) => m.groupId === g.id)
        .map(({ userId, name, avatar, isAdmin }) => ({ userId, name, avatar: avatarUrl(avatar), isAdmin })),
      botIds: groupBotRows.filter((b) => b.groupId === g.id).map((b) => b.botId),
      unread,
      lastSeq: Number(lastSeq ?? 0),
      last: !last
        ? ''
        : last.recalledAt && lastI18n
          ? zhText(lastI18n)
          : preview(last.kind, last.userName ?? last.botName, last.body),
      ...(lastI18n && { lastI18n }),
      pinned: me.pinned,
      muted: me.muted,
      foldRuns: me.foldRuns,
      liveRunIds: live.filter((r) => r.groupId === g.id).map((r) => r.id),
    }
    return { userId: me.userId, group }
  })
}

export async function groupDto(ctx: Ctx, userId: string, groupId: string) {
  const [dto] = await groupDtos(ctx, userId, eq(groups.id, groupId))
  return dto ?? fail('not_found', '群不存在或你已不在群内')
}

/** The group as `userId` may read it: their own view, else a member's view without anything personal (plan D19). */
export async function readerGroupDto(ctx: Ctx, userId: string, groupId: string): Promise<GroupDto> {
  const [own] = await groupDtos(ctx, userId, eq(groups.id, groupId))
  if (own) return own
  const [view] = await groupViews(ctx, (await memberIds(ctx, groupId)).slice(0, 1), eq(groups.id, groupId))
  if (!view) return fail('not_found', '群不存在或你已不在群内')
  const { lastI18n: _, ...group } = view.group
  return { ...group, last: '', unread: 0, noticeHidden: false, pinned: false, muted: false, foldRuns: false }
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
  forgetMembers(groupId)
  if (botIds.length) await stopRuns(ctx, { groupId, botIds }, by)
  for (const b of theirBots) await postEvent(ctx, groupId, '{bot} 被移出 · 工作区保留', { bot: b.name })
  ctx.bus.publish([userId], { t: 'group.removed', groupId })
}

/** Pushes each member their own view of the group. */
export async function publishGroup(ctx: Ctx, groupId: string) {
  for (const { userId, group } of await groupViews(
    ctx,
    await memberIds(ctx, groupId),
    eq(groups.id, groupId),
  ))
    ctx.bus.publish([userId], { t: 'group.updated', group })
}

/** DMs are titled by their Bot, so renaming or deleting it retitles them. */
export async function publishDmsOf(ctx: Ctx, botId: string) {
  const rows = await ctx.db
    .selectDistinct({ id: groups.id })
    .from(groupBots)
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(and(eq(groupBots.botId, botId), eq(groups.kind, 'dm'), isNull(groups.archivedAt)))
  for (const g of rows) await publishGroup(ctx, g.id)
}
