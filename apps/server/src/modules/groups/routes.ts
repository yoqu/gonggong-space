import { randomUUID } from 'node:crypto'
import {
  CreateGroupReq,
  GroupBotReq,
  GroupMemberReq,
  MarkReadReq,
  ValidateRepoReq,
  type ValidateRepoRes,
} from '@aiws/protocol'
import { and, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupMembers, groupRepos, groups, messages, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { postEvent } from '../messages/service.js'
import {
  activeBots,
  BRANCH,
  groupDto,
  groupDtos,
  publishGroup,
  REPO_URL,
  requireAdmin,
  requireMember,
} from './service.js'

type BotRef = { name: string; machineId: string | null }

const uniq = (ids: string[]) => [...new Set(ids)]

function repoProblem(url: string, branch: string) {
  if (!REPO_URL.test(url)) return '地址格式不正确，支持 git@ / https:// / ssh://'
  if (!BRANCH.test(branch)) return '基准分支名不正确'
  return null
}

function botJoinedText(ctx: Ctx, bot: BotRef, hasRepo: boolean) {
  const note =
    !bot.machineId || !ctx.hub.isOnline(bot.machineId)
      ? 'daemon 离线，上线后创建工作区'
      : hasRepo
        ? 'daemon 将 clone 到托管工作区'
        : '已创建托管空工作区'
  return `${bot.name} 加入 · ${note}`
}

async function activeUsers(ctx: Ctx, ids: string[]) {
  if (!ids.length) return []
  if (!ids.every(isUuid)) return fail('invalid', '成员不存在')
  const rows = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.disabledAt)))
  if (rows.length !== ids.length) return fail('invalid', '成员不存在或已停用')
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

async function liveBots(ctx: Ctx, ids: string[]) {
  if (!ids.length) return []
  if (!ids.every(isUuid)) return fail('invalid', 'bot 不存在或已删除')
  const rows = await ctx.db
    .select({ id: bots.id, name: bots.name, ownerId: bots.ownerId, machineId: bots.machineId })
    .from(bots)
    .where(and(inArray(bots.id, ids), isNull(bots.deletedAt)))
  if (rows.length !== ids.length) return fail('invalid', 'bot 不存在或已删除')
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

const oneUser = async (ctx: Ctx, id: string) =>
  (await activeUsers(ctx, [id]))[0] ?? fail('invalid', '成员不存在')
const oneBot = async (ctx: Ctx, id: string) => (await liveBots(ctx, [id]))[0] ?? fail('invalid', 'bot 不存在')

const hasRepo = async (ctx: Ctx, groupId: string) =>
  (await ctx.db.select({ id: groupRepos.id }).from(groupRepos).where(eq(groupRepos.groupId, groupId)))
    .length > 0

async function isMember(ctx: Ctx, groupId: string, userId: string) {
  const [row] = await ctx.db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  return !!row
}

export function groupRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/groups', async (req) => {
      const me = await requireUser(ctx, req)
      return groupDtos(ctx, me.id)
    })

    // Format check only; reachability is verified by each daemon when it clones.
    app.post('/api/groups/validate-repo', async (req): Promise<ValidateRepoRes> => {
      await requireUser(ctx, req)
      const { url, branch } = ValidateRepoReq.parse(req.body)
      const problem = repoProblem(url.trim(), branch.trim())
      return problem
        ? { ok: false, message: problem }
        : {
            ok: true,
            message: `地址格式正确 · 基准分支 ${branch.trim()}，bot 加入时由 daemon 用本机凭据 clone`,
          }
    })

    app.post('/api/groups', async (req) => {
      const me = await requireUser(ctx, req)
      const body = CreateGroupReq.parse(req.body)
      const dm = body.kind === 'dm'
      const name = body.name.trim()
      if (!name) return fail('invalid', '填写群名')
      const repo = body.repo && { url: body.repo.url.trim(), branch: body.repo.branch.trim() }
      const problem = repo && repoProblem(repo.url, repo.branch)
      if (problem) return fail('invalid', problem)
      const invitedIds = uniq(body.memberIds).filter((id) => id !== me.id)
      if (dm && invitedIds.length) return fail('invalid', '私聊只能包含你和你的 bot')
      const picked = await liveBots(ctx, uniq(body.botIds))
      if (dm && picked.some((b) => b.ownerId !== me.id)) return fail('forbidden', '私聊只能拉入你自己的 bot')
      const invited = await activeUsers(
        ctx,
        uniq([...invitedIds, ...picked.map((b) => b.ownerId)]).filter((id) => id !== me.id),
      )

      const group = { id: randomUUID() }
      await ctx.db.transaction(async (tx) => {
        await tx.insert(groups).values({ id: group.id, name, kind: body.kind, createdBy: me.id })
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
          ? `${me.name} 创建了私聊 · 仅你和你的 bot`
          : `${me.name} 创建了群 · 成为群管理员${invited.length ? ` · 邀请 ${invited.map((u) => u.name).join('、')}` : ''}`,
      )
      await postEvent(
        ctx,
        group.id,
        repo
          ? `群绑定仓库 ${repo.url} · 基准分支 ${repo.branch} · 分区模式`
          : '未绑定仓库 · 托管空工作区，仅分区模式',
      )
      for (const b of picked) await postEvent(ctx, group.id, botJoinedText(ctx, b, !!repo))
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.get<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      return groupDto(ctx, me.id, req.params.id)
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
      const { userId } = GroupMemberReq.parse(req.body)
      const user = await oneUser(ctx, userId)
      if (!(await isMember(ctx, group.id, user.id))) {
        await ctx.db.insert(groupMembers).values({ groupId: group.id, userId: user.id })
        await postEvent(ctx, group.id, `${me.name} 邀请 ${user.name} 加入群`)
        await publishGroup(ctx, group.id)
      }
      return groupDto(ctx, me.id, group.id)
    })

    app.delete<{ Params: { id: string; userId: string } }>('/api/groups/:id/members/:userId', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const { userId } = req.params
      const members = await ctx.db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id))
      const target = members.find((m) => m.userId === userId)
      if (!target) return fail('not_found', '该用户不在群内')
      if (target.isAdmin && members.filter((m) => m.isAdmin).length === 1)
        return fail('conflict', '唯一的群管理员不能被移出，请先指定继任者')

      const theirBots = (await activeBots(ctx, group.id)).filter((b) => b.ownerId === userId)
      const [user] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, userId))
      await ctx.db.transaction(async (tx) => {
        if (theirBots.length)
          await tx
            .update(groupBots)
            .set({ removedAt: ctx.now() })
            .where(
              and(
                eq(groupBots.groupId, group.id),
                inArray(
                  groupBots.botId,
                  theirBots.map((b) => b.id),
                ),
              ),
            )
        await tx
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, userId)))
      })
      for (const b of theirBots) await postEvent(ctx, group.id, `${b.name} 被移出 · 工作区保留`)
      await postEvent(ctx, group.id, `${me.name} 将 ${user?.name ?? ''} 移出群`)
      ctx.bus.publish([userId], { t: 'group.removed', groupId: group.id })
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/bots', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const { botId } = GroupBotReq.parse(req.body)
      const bot = await oneBot(ctx, botId)
      if (group.kind === 'dm' && bot.ownerId !== group.createdBy)
        return fail('forbidden', '私聊只能拉入你自己的 bot')
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
      if (ownerJoins) {
        const [owner] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, bot.ownerId))
        await postEvent(ctx, group.id, `${owner?.name ?? ''} 作为 ${bot.name} 的主人一并加入群`)
      }
      await postEvent(ctx, group.id, botJoinedText(ctx, bot, await hasRepo(ctx, group.id)))
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.delete<{ Params: { id: string; botId: string } }>('/api/groups/:id/bots/:botId', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const bot = (await activeBots(ctx, group.id)).find((b) => b.id === req.params.botId)
      if (!bot) return fail('not_found', '该 bot 不在群内')
      await ctx.db
        .update(groupBots)
        .set({ removedAt: ctx.now() })
        .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
      await postEvent(ctx, group.id, `${bot.name} 被移出 · 工作区保留`)
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })
  }
}
