import {
  type AdminUserDto,
  CreateUserReq,
  ResetPasswordReq,
  UpdateUserReq,
  type UserBriefDto,
} from '@gonggong/protocol'
import { hash } from '@node-rs/argon2'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { machines, teamMembers, teams, users, webSessions } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { onboardUser } from '../teams/members.js'
import { currentTeam } from '../teams/service.js'
import { userCard } from './card.js'
import { disableUser, enableUser } from './disable.js'
import { toUserDto } from './dto.js'

export function userRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/admin/users', async (req): Promise<AdminUserDto[]> => {
      await requireSysadmin(ctx, req)
      const [rows, live, memberships] = await Promise.all([
        ctx.db.select().from(users).orderBy(asc(users.createdAt)),
        ctx.db
          .select({ id: machines.id, ownerId: machines.ownerId })
          .from(machines)
          .where(isNull(machines.revokedAt)),
        ctx.db
          .select({ userId: teamMembers.userId, name: teams.name })
          .from(teamMembers)
          .innerJoin(teams, eq(teams.id, teamMembers.teamId))
          .where(isNull(teams.archivedAt))
          .orderBy(asc(teamMembers.joinedAt)),
      ])
      return rows.map((u) => {
        const own = live.filter((m) => m.ownerId === u.id)
        return {
          ...toUserDto(u),
          machineCount: own.length,
          online: own.some((m) => ctx.hub.isOnline(m.id)),
          teams: memberships.filter((m) => m.userId === u.id).map((m) => m.name),
        }
      })
    })

    app.post('/api/admin/users', async (req, reply) => {
      const actor = await requireSysadmin(ctx, req)
      const body = CreateUserReq.parse(req.body)
      const [user] = await ctx.db
        .insert(users)
        .values({
          account: body.account,
          name: body.name,
          role: body.role,
          passwordHash: await hash(body.password),
          mustChangePassword: true,
        })
        .onConflictDoNothing({ target: users.account })
        .returning()
      if (!user) return fail('conflict', '账号已存在')
      await onboardUser(ctx, user, null)
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        action: 'user.create',
        detail: { userId: user.id, account: body.account, role: body.role },
      })
      return reply.status(201).send(toUserDto(user))
    })

    app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const id = idParam(req.params.id, '账号不存在')
      const patch = UpdateUserReq.parse(req.body)
      if (!Object.keys(patch).length) return fail('invalid', '没有要修改的字段')
      if (id === actor.id && patch.role && patch.role !== actor.role)
        return fail('invalid', '不能修改自己的角色')
      const [user] = await ctx.db.update(users).set(patch).where(eq(users.id, id)).returning()
      if (!user) return fail('not_found', '账号不存在')
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        action: 'user.update',
        detail: { userId: id, ...patch },
      })
      return toUserDto(user)
    })

    app.post<{ Params: { id: string } }>('/api/admin/users/:id/password', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const id = idParam(req.params.id, '账号不存在')
      const { password } = ResetPasswordReq.parse(req.body)
      if (id === actor.id) return fail('invalid', '修改自己的密码请在账户菜单中操作')
      const passwordHash = await hash(password)
      const user = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set({ passwordHash, mustChangePassword: true })
          .where(eq(users.id, id))
          .returning()
        if (row)
          await tx
            .update(webSessions)
            .set({ revokedAt: ctx.now() })
            .where(and(eq(webSessions.userId, id), isNull(webSessions.revokedAt)))
        return row
      })
      if (!user) return fail('not_found', '账号不存在')
      ctx.bus.disconnect(id)
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        action: 'user.password.reset',
        detail: { userId: id, account: user.account },
      })
      return toUserDto(user)
    })

    app.post<{ Params: { id: string } }>('/api/admin/users/:id/disable', async (req) =>
      disableUser(ctx, idParam(req.params.id, '账号不存在'), await requireSysadmin(ctx, req)),
    )

    app.post<{ Params: { id: string } }>('/api/admin/users/:id/enable', async (req) =>
      enableUser(ctx, idParam(req.params.id, '账号不存在'), await requireSysadmin(ctx, req)),
    )

    app.get('/api/users', async (req): Promise<UserBriefDto[]> => {
      const me = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, me.id)
      return ctx.db
        .select({ id: users.id, name: users.name, account: users.account })
        .from(users)
        .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, teamId)))
        .where(isNull(users.disabledAt))
        .orderBy(asc(users.createdAt))
    })

    app.get<{ Params: { id: string }; Querystring: { groupId?: string } }>(
      '/api/users/:id/card',
      async (req) => {
        const viewer = await requireUser(ctx, req)
        const { groupId } = req.query
        return userCard(
          ctx,
          viewer,
          idParam(req.params.id, '账号不存在'),
          groupId && idParam(groupId, '群不存在'),
        )
      },
    )
  }
}
