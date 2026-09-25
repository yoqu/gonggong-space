import { GroupParams, GroupPrefsReq, UpdateGroupReq } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupMembers, groups, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
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

/** Group settings drawer (spec §4.1, §10; plan D5). */
export function groupSettingsRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.patch<P>('/api/groups/:id', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const body = UpdateGroupReq.parse(req.body)
      await ctx.db.update(groups).set(body).where(eq(groups.id, group.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        action: 'group.update',
        groupId: group.id,
        detail: { before: { name: group.name, notice: group.notice }, ...body },
      })
      await postEvent(ctx, group.id, `${me.name} 修改了${group.kind === 'dm' ? '名称' : '群名称与公告'}`)
      await publishGroup(ctx, group.id)
      return groupDto(ctx, me.id, group.id)
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
      const body = GroupPrefsReq.parse(req.body)
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
        isAdmin ? `${me.name} 将 ${target.name} 设为群管理员` : `${me.name} 取消了 ${target.name} 的群管理员`,
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
      await postEvent(ctx, group.id, `${me.name} 退出了群`)
      await publishGroup(ctx, group.id)
      return { ok: true }
    })

    // Spec §9: the group is archived; messages, audit and members' workspaces stay.
    app.post<P>('/api/groups/:id/dissolve', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      await ctx.db.update(groups).set({ archivedAt: ctx.now() }).where(eq(groups.id, group.id))
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
