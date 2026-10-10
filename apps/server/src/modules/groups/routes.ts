import { randomUUID } from 'node:crypto'
import {
  CreateGroupReq,
  GroupBotReq,
  GroupMemberReq,
  MarkReadReq,
  publicRepoUrl,
  RepoReq,
} from '@gonggong/protocol'
import { and, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupBots,
  groupMembers,
  groupRepos,
  groups,
  messages,
  teamMembers,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { assertNotDemo } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { pullIntoChat } from '../feishu/members.js'
import { forgetMembers, postEvent } from '../messages/service.js'
import { branchKnownMissing } from '../repos/probe.js'
import { recordRepo } from '../repos/service.js'
import { leaveReplica } from '../sync/switch.js'
import { currentTeam } from '../teams/service.js'
import { joinWorkspace } from '../workspaces/provision.js'
import { repoProblem } from './repo.js'
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

const uniq = (ids: string[]) => [...new Set(ids)]

/** Enabled accounts of the team; anyone else reads as not existing. */
async function activeUsers(ctx: Ctx, teamId: string, ids: string[]) {
  if (!ids.length) return []
  if (!ids.every(isUuid)) return fail('invalid', '成员不存在')
  const rows = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, teamId)))
    .where(and(inArray(users.id, ids), isNull(users.disabledAt)))
  if (rows.length !== ids.length) return fail('invalid', '成员不存在或已停用')
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

/** Live bots of the team (plan D5). */
async function liveBots(ctx: Ctx, teamId: string, ids: string[]) {
  if (!ids.length) return []
  if (!ids.every(isUuid)) return fail('invalid', 'Bot 不存在或已删除')
  const rows = await ctx.db
    .select({ id: bots.id, name: bots.name, ownerId: bots.ownerId, machineId: bots.machineId })
    .from(bots)
    .where(and(inArray(bots.id, ids), eq(bots.teamId, teamId), isNull(bots.deletedAt)))
  if (rows.length !== ids.length) return fail('invalid', 'Bot 不存在或已删除')
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

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
  /** Bots that cannot reach the repo don't block binding (they pause); a branch the repo lacks does. */
  const assertBindable = (url: string, branch: string) => {
    const problem = repoProblem(url, branch)
    if (problem) fail('invalid', problem)
    if (branchKnownMissing(url, branch, ctx.now()))
      fail('invalid', '分支 {branch} 不存在，换一个基准分支', { branch })
  }

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
      const teamId = await currentTeam(ctx, req, me.id)
      const body = CreateGroupReq.parse(req.body)
      const dm = body.kind === 'dm'
      const name = body.name.trim()
      if (!name) return fail('invalid', '填写群名')
      const repo = body.repo && { url: body.repo.url.trim(), branch: body.repo.branch.trim() }
      if (repo) assertBindable(repo.url, repo.branch)
      const invitedIds = uniq(body.memberIds).filter((id) => id !== me.id)
      if (dm && invitedIds.length) return fail('invalid', '私聊只能包含你和你的 Bot')
      const picked = await liveBots(ctx, teamId, uniq(body.botIds))
      if (dm && picked.some((b) => b.ownerId !== me.id)) return fail('forbidden', '私聊只能拉入你自己的 Bot')
      const invited = await activeUsers(
        ctx,
        teamId,
        uniq([...invitedIds, ...picked.map((b) => b.ownerId)]).filter((id) => id !== me.id),
      )

      const group = { id: randomUUID() }
      await ctx.db.transaction(async (tx) => {
        await tx.insert(groups).values({ id: group.id, teamId, name, kind: body.kind, createdBy: me.id })
        await tx
          .insert(groupMembers)
          .values([
            { groupId: group.id, userId: me.id, isAdmin: true },
            ...invited.map((u) => ({ groupId: group.id, userId: u.id })),
          ])
        if (picked.length)
          await tx.insert(groupBots).values(picked.map((b) => ({ groupId: group.id, botId: b.id })))
        if (repo)
          await tx.insert(groupRepos).values({ groupId: group.id, url: repo.url, baseBranch: repo.branch })
      })

      await postEvent(
        ctx,
        group.id,
        dm
          ? '{user} 创建了私聊 · 仅你和你的 Bot'
          : invited.length
            ? '{user} 创建了群 · 成为群管理员 · 邀请 {invited}'
            : '{user} 创建了群 · 成为群管理员',
        { user: me.name, invited: invited.map((u) => u.name).join('、') },
      )
      await postEvent(
        ctx,
        group.id,
        repo
          ? '群绑定仓库 {url} · 基准分支 {branch} · 分区模式'
          : '未绑定仓库 · 各 Bot 使用主人绑定的目录，仅分区模式',
        repo ? { url: publicRepoUrl(repo.url), branch: repo.branch } : undefined,
      )
      if (repo) await recordRepo(ctx, { ...repo, teamId, userId: me.id })
      for (const b of picked) await joinWorkspace(ctx, group.id, b, { joined: true })
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
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
      }
      const group = await groupDto(ctx, me.id, req.params.id)
      if (target > member.lastReadSeq) ctx.bus.publish([me.id], { t: 'group.updated', group })
      return group
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/members', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      if (group.kind === 'dm') return fail('invalid', '私聊不能添加成员')
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
        const member = added.map((u) => u.name).join('、')
        await postEvent(ctx, group.id, '{user} 邀请 {member} 加入群', { user: me.name, member })
        for (const u of added)
          await auditAdmin(me.id, group.id, 'group.member.add', { userId: u.id, name: u.name })
        await publishGroup(ctx, group.id)
        for (const u of added) await pullIntoChat(ctx, group.id, u)
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
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const { botId } = GroupBotReq.parse(req.body)
      const bot = await oneBot(ctx, group.teamId, botId)
      if (group.kind === 'dm' && bot.ownerId !== group.createdBy)
        return fail('forbidden', '私聊只能拉入你自己的 Bot')
      if ((await activeBots(ctx, group.id)).some((b) => b.id === bot.id))
        return groupDto(ctx, me.id, group.id)

      const ownerJoins = !(await isMember(ctx, group.id, bot.ownerId))
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
      return groupDto(ctx, me.id, group.id)
    })

    // P1: exactly one repo per group, never unbound. Old workspaces belong to the previous repo: every bot re-clones.
    app.patch<{ Params: { id: string } }>('/api/groups/:id/repo', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const body = RepoReq.parse(req.body)
      const url = body.url.trim()
      const branch = body.branch.trim()
      if (!url) return fail('invalid', '一期不支持解绑仓库')
      assertBindable(url, branch)
      const [old] = await ctx.db.select().from(groupRepos).where(eq(groupRepos.groupId, group.id))
      if (old?.url === url && old.baseBranch === branch) return groupDto(ctx, me.id, group.id)
      if (group.mode === 'force') return fail('conflict', '强制同步群不能更换仓库，请先切回分区模式')

      await ctx.db.transaction(async (tx) => {
        await tx.delete(groupRepos).where(eq(groupRepos.groupId, group.id))
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
            sessionId: null,
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
