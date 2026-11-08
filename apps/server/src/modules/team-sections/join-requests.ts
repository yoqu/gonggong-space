import { type JoinRequestDto, JoinRequestReq } from '@gonggong/protocol'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupJoinRequests, groupMembers, groups, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { pullIntoChat } from '../feishu/members.js'
import { groupDto, publishGroup, requireAdmin } from '../groups/service.js'
import { forgetMembers, postEvent } from '../messages/service.js'
import { mirrorShareDecision } from '../notifications/feishu.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { requireTeam } from '../teams/service.js'

type Params = { Params: { id: string } }
type Decider = { id: string; name: string }

/** The group left its 团队分区 (or `userIds` got in another way): their pending requests are void. */
export async function cancelJoinRequests(ctx: Ctx, groupId: string, userIds?: string[]) {
  const rows = await ctx.db
    .update(groupJoinRequests)
    .set({ status: 'cancelled', decidedAt: ctx.now() })
    .where(
      and(
        eq(groupJoinRequests.groupId, groupId),
        eq(groupJoinRequests.status, 'pending'),
        userIds ? inArray(groupJoinRequests.userId, userIds) : undefined,
      ),
    )
    .returning({ id: groupJoinRequests.id })
  await resolveNotifications(
    ctx,
    'join_request',
    'requestId',
    rows.map((r) => r.id),
  )
}

/** A pending request of a group the decider administers. */
async function pending(ctx: Ctx, user: Decider, rawId: string) {
  const [row] = await ctx.db
    .select({ req: groupJoinRequests, userName: users.name })
    .from(groupJoinRequests)
    .innerJoin(users, eq(users.id, groupJoinRequests.userId))
    .where(
      and(eq(groupJoinRequests.id, idParam(rawId, '申请不存在')), eq(groupJoinRequests.status, 'pending')),
    )
  if (!row) return fail('not_found', '申请不存在或已处理')
  const { group } = await requireAdmin(ctx, row.req.groupId, user.id)
  return { ...row, group }
}

async function settle(ctx: Ctx, user: Decider, id: string, status: 'approved' | 'rejected') {
  await ctx.db
    .update(groupJoinRequests)
    .set({ status, decidedBy: user.id, decidedAt: ctx.now() })
    .where(eq(groupJoinRequests.id, id))
  await resolveNotifications(ctx, 'join_request', 'requestId', [id])
}

/** 同意, on the web or an admin's Feishu card: the requester joins the group. */
export async function approveJoinRequest(ctx: Ctx, user: Decider, id: string) {
  const { req: r, userName, group } = await pending(ctx, user, id)
  await ctx.db.insert(groupMembers).values({ groupId: group.id, userId: r.userId }).onConflictDoNothing()
  forgetMembers(group.id)
  await settle(ctx, user, r.id, 'approved')
  await postEvent(ctx, group.id, '{admin} 同意 {user} 加入群', { admin: user.name, user: userName })
  await audit(ctx, {
    category: 'admin',
    actorUserId: user.id,
    groupId: group.id,
    action: 'group.join_request.approve',
    detail: { userId: r.userId, name: userName },
  })
  await notify(ctx, r.userId, 'join_decided', { groupId: group.id, byName: user.name, approved: true })
  await publishGroup(ctx, group.id)
  ctx.bus.publish([r.userId], { t: 'directory.changed' })
  await pullIntoChat(ctx, group.id, { id: r.userId, name: userName })
}

/** 拒绝, on the web or an admin's Feishu card. */
export async function rejectJoinRequest(ctx: Ctx, user: Decider, id: string) {
  const { req: r, group } = await pending(ctx, user, id)
  await settle(ctx, user, r.id, 'rejected')
  await notify(ctx, r.userId, 'join_decided', { groupId: group.id, byName: user.name, approved: false })
  ctx.bus.publish([r.userId], { t: 'directory.changed' })
}

/** 申请入群: private groups filed under a 团队分区 take requests; any group admin decides. */
export function joinRequestRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post<Params>('/api/groups/:id/join-requests', async (req): Promise<JoinRequestDto> => {
      const me = await requireUser(ctx, req)
      const [group] = isUuid(req.params.id)
        ? await ctx.db.select().from(groups).where(eq(groups.id, req.params.id))
        : []
      if (!group || group.archivedAt || group.kind !== 'group' || !group.teamSectionId)
        return fail('not_found', '群不存在或未归入团队分区')
      await requireTeam(ctx, me.id, group.teamId)
      if (group.visibility === 'public') return fail('invalid', '公开群可直接加入')
      const [member] = await ctx.db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, me.id)))
      if (member) return fail('invalid', '你已在群内')
      const { note } = JoinRequestReq.parse(req.body ?? {})
      const [row] = await ctx.db
        .insert(groupJoinRequests)
        .values({ groupId: group.id, userId: me.id, note })
        .onConflictDoNothing()
        .returning()
      if (!row) return fail('conflict', '已申请，等待群管理员处理')
      const admins = await ctx.db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.isAdmin, true)))
      for (const a of admins)
        await notify(ctx, a.userId, 'join_request', {
          requestId: row.id,
          groupId: group.id,
          byName: me.name,
          note,
        })
      ctx.bus.publish([me.id], { t: 'directory.changed' })
      return {
        id: row.id,
        groupId: group.id,
        userId: me.id,
        userName: me.name,
        note,
        createdAt: row.createdAt.toISOString(),
      }
    })

    app.delete<Params>('/api/join-requests/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const [row] = await ctx.db
        .update(groupJoinRequests)
        .set({ status: 'cancelled', decidedAt: ctx.now() })
        .where(
          and(
            eq(groupJoinRequests.id, idParam(req.params.id, '申请不存在')),
            eq(groupJoinRequests.userId, me.id),
            eq(groupJoinRequests.status, 'pending'),
          ),
        )
        .returning({ id: groupJoinRequests.id })
      if (!row) return fail('not_found', '申请不存在或已处理')
      await resolveNotifications(ctx, 'join_request', 'requestId', [row.id])
      ctx.bus.publish([me.id], { t: 'directory.changed' })
      return reply.status(204).send()
    })

    app.get<Params>('/api/groups/:id/join-requests', async (req): Promise<JoinRequestDto[]> => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const rows = await ctx.db
        .select({ req: groupJoinRequests, userName: users.name })
        .from(groupJoinRequests)
        .innerJoin(users, eq(users.id, groupJoinRequests.userId))
        .where(and(eq(groupJoinRequests.groupId, group.id), eq(groupJoinRequests.status, 'pending')))
        .orderBy(asc(groupJoinRequests.createdAt))
      return rows.map(({ req: r, userName }) => ({
        id: r.id,
        groupId: r.groupId,
        userId: r.userId,
        userName,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      }))
    })

    // The Feishu card answers its own click; a web decision updates it here.
    app.post<Params>('/api/join-requests/:id/approve', async (req) => {
      const me = await requireUser(ctx, req)
      await approveJoinRequest(ctx, me, req.params.id)
      await mirrorShareDecision(ctx, req.params.id, { approved: true, by: me.name }, 'join')
      const [r] = await ctx.db
        .select({ groupId: groupJoinRequests.groupId })
        .from(groupJoinRequests)
        .where(eq(groupJoinRequests.id, req.params.id))
      return groupDto(ctx, me.id, r!.groupId)
    })

    app.post<Params>('/api/join-requests/:id/reject', async (req, reply) => {
      const me = await requireUser(ctx, req)
      await rejectJoinRequest(ctx, me, req.params.id)
      await mirrorShareDecision(ctx, req.params.id, { approved: false, by: me.name }, 'join')
      return reply.status(204).send()
    })
  }
}
