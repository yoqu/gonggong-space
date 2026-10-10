import { GroupParams, GroupPrefsReq, UpdateGroupReq } from '@gonggong/protocol'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupMembers, groupNotices, groups, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { assertNotDemo } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { unbindChat } from '../feishu/mirror.js'
import { memberIds, postEvent } from '../messages/service.js'
import { stopRuns } from '../runs/stop.js'
import { groupParams } from './params.js'
import { groupDto, publishGroup, removeMember, requireAdmin, requireMember } from './service.js'

type P = { Params: { id: string } }
type PU = { Params: { id: string; userId: string } }

const ONLY_ADMIN = '你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。'

async function members(ctx: Ctx, groupId: string) {
  return ctx.db
    .select({ userId: groupMembers.userId, isAdmin: groupMembers.isAdmin, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
}

/** Replaces the current notice: the old one is marked removed, a non-empty one starts a new history entry. */
async function setNotice(ctx: Ctx, groupId: string, notice: string, by: string) {
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(groupNotices)
      .set({ removedAt: ctx.now() })
      .where(and(eq(groupNotices.groupId, groupId), isNull(groupNotices.removedAt)))
    const [row] = notice
      ? await tx.insert(groupNotices).values({ groupId, body: notice, createdBy: by }).returning()
      : []
    await tx
      .update(groups)
      .set({ notice, noticeId: row?.id ?? null })
      .where(eq(groups.id, groupId))
  })
}

/** Group settings drawer (spec §4.1, §10; plan D5). */
export function groupSettingsRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.patch<P>('/api/groups/:id', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const { notice, adminOnlyInvite, ...body } = UpdateGroupReq.parse(req.body)
      if (body.name)
        await ctx.db
          .update(groups)
          .set({ ...body, renamed: group.kind === 'dm' })
          .where(eq(groups.id, group.id))
      if (notice !== undefined && notice !== group.notice) await setNotice(ctx, group.id, notice, me.id)
      const inviteChanged = adminOnlyInvite !== undefined && adminOnlyInvite !== group.adminOnlyInvite
      if (inviteChanged) await ctx.db.update(groups).set({ adminOnlyInvite }).where(eq(groups.id, group.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        action: 'group.update',
        groupId: group.id,
        detail: {
          before: { name: group.name, notice: group.notice, adminOnlyInvite: group.adminOnlyInvite },
          ...body,
          notice,
          adminOnlyInvite,
        },
      })
      if (body.name !== undefined || notice !== undefined)
        await postEvent(
          ctx,
          group.id,
          group.kind === 'dm' ? '{user} 修改了名称' : '{user} 修改了群名称与公告',
          {
            user: me.name,
          },
        )
      if (inviteChanged)
        await postEvent(
          ctx,
          group.id,
          adminOnlyInvite ? '{user} 开启了「仅群管理员可拉人」' : '{user} 关闭了「仅群管理员可拉人」',
          { user: me.name },
        )
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.delete<P>('/api/groups/:id/notice', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      if (group.notice) {
        await setNotice(ctx, group.id, '', me.id)
        await audit(ctx, {
          category: 'admin',
          actorUserId: me.id,
          action: 'group.notice.remove',
          groupId: group.id,
          detail: { name: group.name, notice: group.notice },
        })
        await postEvent(ctx, group.id, '{user} 移除了群公告', { user: me.name })
        await publishGroup(ctx, group.id)
      }
      return groupDto(ctx, me.id, group.id)
    })

    app.get<P>('/api/groups/:id/notices', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      const rows = await ctx.db
        .select({
          id: groupNotices.id,
          body: groupNotices.body,
          authorName: users.name,
          createdAt: groupNotices.createdAt,
          removedAt: groupNotices.removedAt,
        })
        .from(groupNotices)
        .innerJoin(users, eq(users.id, groupNotices.createdBy))
        .where(eq(groupNotices.groupId, group.id))
        .orderBy(desc(groupNotices.createdAt))
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        removedAt: r.removedAt?.toISOString() ?? null,
      }))
    })

    app.get<P>('/api/groups/:id/params', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      return groupParams(ctx, group)
    })

    app.put<P>('/api/groups/:id/params', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const body = GroupParams.parse(req.body)
      await ctx.db
        .update(groups)
        .set({ params: { ...(group.params as object), ...body } })
        .where(eq(groups.id, group.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        action: 'group.params',
        groupId: group.id,
        detail: { name: group.name, ...body },
      })
      return body
    })

    app.put<P>('/api/groups/:id/prefs', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      const { noticeHidden, ...prefs } = GroupPrefsReq.parse(req.body)
      const body =
        noticeHidden === undefined
          ? prefs
          : { ...prefs, hiddenNoticeId: noticeHidden ? group.noticeId : null }
      if (Object.keys(body).length)
        await ctx.db
          .update(groupMembers)
          .set(body)
          .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, me.id)))
      const dto = await groupDto(ctx, me.id, group.id)
      ctx.bus.publish([me.id], { t: 'group.updated', group: dto })
      return dto
    })

    const setAdmin = (isAdmin: boolean) => async (req: FastifyRequest<PU>) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const list = await members(ctx, group.id)
      const target = list.find((m) => m.userId === req.params.userId) ?? fail('not_found', '该用户不在群内')
      if (target.isAdmin === isAdmin) return groupDto(ctx, me.id, group.id)
      if (!isAdmin && list.filter((m) => m.isAdmin).length === 1)
        return fail('conflict', '唯一的群管理员不能取消，请先指定继任者')
      await ctx.db
        .update(groupMembers)
        .set({ isAdmin })
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, target.userId)))
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        action: isAdmin ? 'group.admin.grant' : 'group.admin.revoke',
        groupId: group.id,
        detail: { name: group.name, userId: target.userId, userName: target.name },
      })
      await postEvent(
        ctx,
        group.id,
        isAdmin ? '{user} 将 {member} 设为群管理员' : '{user} 取消了 {member} 的群管理员',
        { user: me.name, member: target.name },
      )
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
    }
    app.post<PU>('/api/groups/:id/admins/:userId', setAdmin(true))
    app.delete<PU>('/api/groups/:id/admins/:userId', setAdmin(false))

    app.post<P>('/api/groups/:id/leave', async (req) => {
      const me = await requireUser(ctx, req)
      const { group, member } = await requireMember(ctx, req.params.id, me.id)
      if (group.kind === 'dm') return fail('invalid', '私聊不能退出，可删除私聊')
      const list = await members(ctx, group.id)
      if (member.isAdmin && list.filter((m) => m.isAdmin).length === 1)
        return fail('conflict', list.length > 1 ? ONLY_ADMIN : '群里只剩你一人，请直接解散群')
      await removeMember(ctx, group.id, me.id, me)
      await postEvent(ctx, group.id, '{user} 退出了群', { user: me.name })
      await publishGroup(ctx, group.id)
      return { ok: true }
    })

    // Spec §9: the group is archived; messages, audit and members' workspaces stay.
    app.post<P>('/api/groups/:id/dissolve', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      await assertNotDemo(ctx, me)
      await ctx.db.update(groups).set({ archivedAt: ctx.now() }).where(eq(groups.id, group.id))
      await unbindChat(ctx, group.id)
      await stopRuns(ctx, { groupId: group.id }, me)
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        action: 'group.dissolve',
        groupId: group.id,
        detail: { name: group.name, kind: group.kind },
      })
      ctx.bus.publish(await memberIds(ctx, group.id), { t: 'group.removed', groupId: group.id })
      return { ok: true }
    })
  }
}
