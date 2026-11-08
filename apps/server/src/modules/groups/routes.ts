import {
  type ChannelDto,
  CreateGroupReq,
  GroupBotReq,
  GroupMemberReq,
  type GroupVisibility,
  MarkReadReq,
  MarkUnreadReq,
  publicRepoUrl,
  RepoReq,
  repoKey,
} from '@gonggong/protocol'
import { and, asc, eq, ilike, inArray, isNull, max, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupBots, groupMembers, groupRepos, groups, messages, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { assertNotDemo } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { isSharedWith } from '../bots/shares.js'
import { pullBotIntoChat } from '../feishu/chats.js'
import { pullIntoChat } from '../feishu/members.js'
import { forgetMembers, postEvent } from '../messages/service.js'
import { readMentions } from '../notifications/notify.js'
import { recordRepo } from '../repos/service.js'
import { leaveReplica } from '../sync/switch.js'
import { cancelJoinRequests } from '../team-sections/join-requests.js'
import { currentTeam } from '../teams/service.js'
import { avatarUrl } from '../users/dto.js'
import { joinWorkspace } from '../workspaces/provision.js'
import { RESET_SESSION } from '../workspaces/state.js'
import { activeUsers, assertBindable, createGroup, liveBots, uniq } from './create.js'
import {
  activeBots,
  groupDto,
  groupDtos,
  publishGroup,
  readerGroupDto,
  removeMember,
  requireAdmin,
  requireMember,
  requireReader,
} from './service.js'

const oneBot = async (ctx: Ctx, teamId: string, id: string) =>
  (await liveBots(ctx, teamId, [id]))[0] ?? fail('invalid', 'Bot 不存在')

async function isMember(ctx: Ctx, groupId: string, userId: string) {
  const [row] = await ctx.db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  return !!row
}

export function groupRoutes(ctx: Ctx) {
  const auditAdmin = (
    actorUserId: string,
    groupId: string,
    action: string,
    detail: Record<string, unknown>,
  ) => audit(ctx, { category: 'admin', actorUserId, groupId, action, detail })

  return async (app: FastifyInstance) => {
    app.get('/api/groups', async (req) => {
      const me = await requireUser(ctx, req)
      return groupDtos(ctx, me.id, eq(groups.teamId, await currentTeam(ctx, req, me.id)))
    })

    app.post('/api/groups', async (req) => {
      const me = await requireUser(ctx, req)
      const id = await createGroup(
        ctx,
        me,
        await currentTeam(ctx, req, me.id),
        CreateGroupReq.parse(req.body),
      )
      return groupDto(ctx, me.id, id)
    })

    app.get<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
      const me = await requireUser(ctx, req)
      await requireReader(ctx, req.params.id, me.id)
      return readerGroupDto(ctx, me.id, req.params.id)
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/read', async (req) => {
      const me = await requireUser(ctx, req)
      const { member } = await requireMember(ctx, req.params.id, me.id)
      const { seq } = MarkReadReq.parse(req.body ?? {})
      const [row] = await ctx.db
        .select({ lastSeq: max(messages.seq) })
        .from(messages)
        .where(eq(messages.groupId, req.params.id))
      const target = Math.min(seq ?? Number.MAX_SAFE_INTEGER, row?.lastSeq ?? 0)
      if (target > member.lastReadSeq) {
        await ctx.db
          .update(groupMembers)
          .set({ lastReadSeq: sql`greatest(${groupMembers.lastReadSeq}, ${target})` })
          .where(and(eq(groupMembers.groupId, req.params.id), eq(groupMembers.userId, me.id)))
        await readMentions(ctx, me.id, req.params.id, target)
      }
      const group = await groupDto(ctx, me.id, req.params.id)
      if (target > member.lastReadSeq) ctx.bus.publish([me.id], { t: 'group.updated', group })
      return group
    })

    // 从这里标为未读: unlike reading, the cursor may move back.
    app.put<{ Params: { id: string } }>('/api/groups/:id/unread', async (req) => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      const { seq } = MarkUnreadReq.parse(req.body)
      const [row] = await ctx.db
        .select({ lastSeq: max(messages.seq) })
        .from(messages)
        .where(eq(messages.groupId, req.params.id))
      if (seq > (row?.lastSeq ?? 0)) return fail('invalid', '消息不存在')
      await ctx.db
        .update(groupMembers)
        .set({ lastReadSeq: seq - 1 })
        .where(and(eq(groupMembers.groupId, req.params.id), eq(groupMembers.userId, me.id)))
      const group = await groupDto(ctx, me.id, req.params.id)
      ctx.bus.publish([me.id], { t: 'group.updated', group })
      return group
    })

    // 全部已读 (Shift+Esc): every live group of the caller in the current team.
    app.post('/api/groups/read-all', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, me.id)
      const rows = await ctx.db
        .select({
          groupId: groupMembers.groupId,
          lastReadSeq: groupMembers.lastReadSeq,
          lastSeq: sql<
            number | null
          >`(select max(m.seq) from messages m where m.group_id = ${groups.id})`.mapWith(Number),
        })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(and(eq(groupMembers.userId, me.id), eq(groups.teamId, teamId), isNull(groups.archivedAt)))
      const behind = rows.filter((r) => r.lastSeq && r.lastSeq > r.lastReadSeq)
      for (const r of behind) {
        const seq = r.lastSeq as number
        await ctx.db
          .update(groupMembers)
          .set({ lastReadSeq: sql`greatest(${groupMembers.lastReadSeq}, ${seq})` })
          .where(and(eq(groupMembers.groupId, r.groupId), eq(groupMembers.userId, me.id)))
        await readMentions(ctx, me.id, r.groupId, seq)
      }
      if (behind.length)
        for (const group of await groupDtos(
          ctx,
          me.id,
          inArray(
            groups.id,
            behind.map((r) => r.groupId),
          ),
        ))
          ctx.bus.publish([me.id], { t: 'group.updated', group })
      return reply.code(204).send()
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/members', async (req) => {
      const me = await requireUser(ctx, req)
      const { group, member: mine } = await requireMember(ctx, req.params.id, me.id)
      if (group.kind === 'dm') return fail('invalid', '私聊不能添加成员')
      if (group.adminOnlyInvite && !mine.isAdmin) return fail('forbidden', '本群仅群管理员可拉人')
      const { userIds } = GroupMemberReq.parse(req.body)
      const wanted = await activeUsers(ctx, group.teamId, uniq(userIds))
      const current = await ctx.db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, group.id))
      const added = wanted.filter((u) => !current.some((m) => m.userId === u.id))
      if (added.length) {
        await ctx.db.insert(groupMembers).values(added.map((u) => ({ groupId: group.id, userId: u.id })))
        forgetMembers(group.id)
        await cancelJoinRequests(
          ctx,
          group.id,
          added.map((u) => u.id),
        )
        const member = added.map((u) => u.name).join('、')
        await postEvent(ctx, group.id, '{user} 邀请 {member} 加入群', { user: me.name, member })
        for (const u of added)
          await auditAdmin(me.id, group.id, 'group.member.add', { userId: u.id, name: u.name })
        await publishGroup(ctx, group.id)
        for (const u of added) await pullIntoChat(ctx, group.id, u)
      }
      return groupDto(ctx, me.id, group.id)
    })

    app.get<{ Querystring: { q?: string } }>('/api/channels', async (req): Promise<ChannelDto[]> => {
      const me = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, me.id)
      const q = req.query.q?.trim()
      const rows = await ctx.db
        .select({
          id: groups.id,
          name: groups.name,
          avatar: groups.avatar,
          notice: groups.notice,
          memberCount: sql<number>`count(${groupMembers.userId})::int`,
          joined: sql<boolean>`bool_or(${groupMembers.userId} = ${me.id})`,
          visibility: groups.visibility,
          createdByName: sql<string>`(select ${users.name} from ${users} where ${users.id} = ${groups.createdBy})`,
          lastActivityAt: sql<Date | null>`(select m.created_at from messages m where m.group_id = ${groups.id} order by m.seq desc limit 1)`,
        })
        .from(groups)
        .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
        .where(
          and(
            eq(groups.teamId, teamId),
            eq(groups.kind, 'group'),
            isNull(groups.archivedAt),
            q ? ilike(groups.name, `%${q.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
          ),
        )
        .groupBy(groups.id)
        // Private groups only for their members.
        .having(sql`${groups.visibility} = 'public' or bool_or(${groupMembers.userId} = ${me.id})`)
        .orderBy(asc(groups.name))
      return rows.map((r) => ({
        ...r,
        visibility: r.visibility as GroupVisibility,
        avatar: avatarUrl(r.avatar),
        lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
      }))
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/join', async (req) => {
      const me = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, me.id)
      const [group] = isUuid(req.params.id)
        ? await ctx.db
            .select()
            .from(groups)
            .where(
              and(
                eq(groups.id, req.params.id),
                eq(groups.teamId, teamId),
                eq(groups.kind, 'group'),
                eq(groups.visibility, 'public'),
                isNull(groups.archivedAt),
              ),
            )
        : []
      if (!group) return fail('not_found', '频道不存在或不是公开频道')
      if (!(await isMember(ctx, group.id, me.id))) {
        await ctx.db.insert(groupMembers).values({ groupId: group.id, userId: me.id }).onConflictDoNothing()
        forgetMembers(group.id)
        await postEvent(ctx, group.id, '{user} 加入了频道', { user: me.name })
        await auditAdmin(me.id, group.id, 'group.member.join', { userId: me.id, name: me.name })
        await publishGroup(ctx, group.id)
        await pullIntoChat(ctx, group.id, me)
      }
      return groupDto(ctx, me.id, group.id)
    })

    app.delete<{ Params: { id: string; userId: string } }>('/api/groups/:id/members/:userId', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      await assertNotDemo(ctx, me)
      const { userId } = req.params
      const members = await ctx.db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id))
      const target = members.find((m) => m.userId === userId)
      if (!target) return fail('not_found', '该用户不在群内')
      if (target.isAdmin && members.filter((m) => m.isAdmin).length === 1)
        return fail('conflict', '唯一的群管理员不能被移出，请先指定继任者')

      const [user] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, userId))
      await removeMember(ctx, group.id, userId, me)
      await postEvent(ctx, group.id, '{user} 将 {member} 移出群', { user: me.name, member: user?.name ?? '' })
      await auditAdmin(me.id, group.id, 'group.member.remove', { userId, name: user?.name ?? null })
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/bots', async (req) => {
      const me = await requireUser(ctx, req)
      const { group, member: mine } = await requireMember(ctx, req.params.id, me.id)
      const { botId } = GroupBotReq.parse(req.body)
      const bot = await oneBot(ctx, group.teamId, botId)
      if (!mine.isAdmin && bot.ownerId !== me.id) return fail('forbidden', '只能拉入你自己的 Bot')
      const dm = group.kind === 'dm'
      if (dm && bot.ownerId !== group.createdBy && !(await isSharedWith(ctx, bot.id, group.createdBy)))
        return fail('forbidden', '私聊只能拉入你自己或共享给你的 Bot')
      if ((await activeBots(ctx, group.id)).some((b) => b.id === bot.id))
        return groupDto(ctx, me.id, group.id)

      const ownerJoins = !dm && !(await isMember(ctx, group.id, bot.ownerId))
      await ctx.db.transaction(async (tx) => {
        await tx
          .insert(groupBots)
          .values({ groupId: group.id, botId: bot.id })
          .onConflictDoUpdate({
            target: [groupBots.groupId, groupBots.botId],
            set: { removedAt: null, addedAt: ctx.now() },
          })
        if (ownerJoins) await tx.insert(groupMembers).values({ groupId: group.id, userId: bot.ownerId })
      })
      if (ownerJoins) forgetMembers(group.id)
      if (ownerJoins) {
        const [owner] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, bot.ownerId))
        await postEvent(ctx, group.id, '{owner} 作为 {bot} 的主人一并加入群', {
          owner: owner?.name ?? '',
          bot: bot.name,
        })
      }
      await joinWorkspace(ctx, group.id, bot, { joined: true })
      await auditAdmin(me.id, group.id, 'group.bot.add', { botId: bot.id, name: bot.name })
      await publishGroup(ctx, group.id)
      if (!dm) await pullBotIntoChat(ctx, group.id, bot.id)
      return groupDto(ctx, me.id, group.id)
    })

    // The main repo. Old workspaces belong to the previous repo: every bot re-clones (extra repos stay as they are).
    app.patch<{ Params: { id: string } }>('/api/groups/:id/repo', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const body = RepoReq.parse(req.body)
      const url = body.url.trim()
      const branch = body.branch.trim()
      const all = await ctx.db.select().from(groupRepos).where(eq(groupRepos.groupId, group.id))
      const old = all.find((r) => r.isPrimary)
      const primary = and(eq(groupRepos.groupId, group.id), eq(groupRepos.isPrimary, true))
      if (!url) {
        if (!old) return groupDto(ctx, me.id, group.id)
        if (group.mode === 'force') return fail('conflict', '强制同步群不能解绑仓库，请先切回分区模式')
        if (all.length > 1) return fail('conflict', '请先移除附加仓库')
        // /cd directories stay; managed clones stay on disk, their bots move to a default directory or wait.
        const moved = await ctx.db.transaction(async (tx) => {
          await tx.delete(groupRepos).where(primary)
          return tx
            .update(groupBots)
            .set({
              workspaceState: 'pending',
              workspacePath: null,
              workspaceError: null,
              workspaceReason: null,
              gitStatus: null,
              ...RESET_SESSION,
            })
            .where(and(eq(groupBots.groupId, group.id), ne(groupBots.workspaceKind, 'cd')))
            .returning({ botId: groupBots.botId })
        })
        await postEvent(ctx, group.id, '群解绑仓库 · 各 Bot 改用默认工作区或本机目录，自动克隆保留在本机')
        await auditAdmin(me.id, group.id, 'group.repo.unbind', {
          previous: { url: publicRepoUrl(old.url), branch: old.baseBranch },
        })
        const ids = new Set(moved.map((m) => m.botId))
        for (const bot of await activeBots(ctx, group.id))
          if (ids.has(bot.id)) await joinWorkspace(ctx, group.id, bot, { joined: false })
        await publishGroup(ctx, group.id)
        return groupDto(ctx, me.id, group.id)
      }
      assertBindable(ctx, url, branch)
      if (old?.url === url && old.baseBranch === branch) return groupDto(ctx, me.id, group.id)
      if (group.mode === 'force') return fail('conflict', '强制同步群不能更换仓库，请先切回分区模式')
      if (all.some((r) => !r.isPrimary && repoKey(r.url) === repoKey(url)))
        return fail('conflict', '该仓库已是本群的附加仓库')

      await ctx.db.transaction(async (tx) => {
        await tx.delete(groupRepos).where(primary)
        await tx.insert(groupRepos).values({ groupId: group.id, url, baseBranch: branch })
        // Old clones, /cd bindings and sessions belong to the previous repo.
        await tx
          .update(groupBots)
          .set({
            workspaceKind: 'managed',
            cdPath: null,
            workspaceState: 'pending',
            workspacePath: null,
            workspaceError: null,
            workspaceReason: null,
            gitStatus: null,
            ...RESET_SESSION,
          })
          .where(eq(groupBots.groupId, group.id))
      })
      await postEvent(
        ctx,
        group.id,
        old
          ? '群更换仓库 {url} · 基准分支 {branch} · 各 Bot 重建托管工作区'
          : '群绑定仓库 {url} · 基准分支 {branch} · 分区模式',
        { url: publicRepoUrl(url), branch },
      )
      await auditAdmin(me.id, group.id, 'group.repo.change', {
        url: publicRepoUrl(url),
        branch,
        previous: old ? { url: publicRepoUrl(old.url), branch: old.baseBranch } : null,
      })
      await recordRepo(ctx, { url, branch, teamId: group.teamId, userId: me.id })
      for (const bot of await activeBots(ctx, group.id))
        await joinWorkspace(ctx, group.id, bot, { joined: false })
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.delete<{ Params: { id: string; botId: string } }>('/api/groups/:id/bots/:botId', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const bot = (await activeBots(ctx, group.id)).find((b) => b.id === req.params.botId)
      if (!bot) return fail('not_found', '该 Bot 不在群内')
      await ctx.db
        .update(groupBots)
        .set({ removedAt: ctx.now() })
        .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
      await leaveReplica(ctx, group.id, bot)
      await postEvent(ctx, group.id, '{bot} 被移出 · 工作区保留', { bot: bot.name })
      await auditAdmin(me.id, group.id, 'group.bot.remove', { botId: bot.id, name: bot.name })
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })
  }
}
