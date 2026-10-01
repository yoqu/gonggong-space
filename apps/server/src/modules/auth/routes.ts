import {
  type AuthOptionsDto,
  ChangePasswordReq,
  LoginReq,
  RegisterReq,
  UpdateMeReq,
} from '@gonggong/protocol'
import { hash, verify } from '@node-rs/argon2'
import { and, eq, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, users, webSessions } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { Throttle } from '../../lib/throttle.js'
import { sysParams } from '../admin/params.js'
import { publishBots } from '../bots/dto.js'
import { publishGroup } from '../groups/service.js'
import { meDto } from '../teams/dto.js'
import { acceptInvite, findInvite } from '../teams/members.js'
import { joinDefaultTeam } from '../teams/service.js'
import { feishuLoginReady } from './feishu.js'
import { requireUser, SESSION_COOKIE, startSession } from './session.js'

const LOGIN_MAX_FAILURES = 5
const LOGIN_WINDOW_MS = 5 * 60_000
const BAD_CREDENTIALS = '账号或密码错误'
const REGISTER_MAX_PER_HOUR = 5

export function authRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const throttle = new Throttle(LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, ctx.now)
    // Verifying against a throwaway hash keeps response time independent of whether the account exists.
    const decoy = hash('decoy-password')
    const signups = new Throttle(REGISTER_MAX_PER_HOUR, 60 * 60_000, ctx.now)

    const signIn = (reply: FastifyReply, userId: string) => startSession(ctx, reply, userId)

    app.post('/api/auth/login', async (req, reply) => {
      const { account, password } = LoginReq.parse(req.body)
      if (throttle.blocked(account)) return fail('forbidden', '登录失败次数过多，请稍后再试')
      const [user] = await ctx.db.select().from(users).where(eq(users.account, account))
      const ok = await verify(user?.passwordHash ?? (await decoy), password)
      if (!user || !ok) {
        throttle.fail(account)
        return fail('unauthorized', BAD_CREDENTIALS)
      }
      if (user.disabledAt) return fail('forbidden', '账号已停用，请联系系统管理员')
      throttle.reset(account)
      await signIn(reply, user.id)
      return meDto(ctx, user)
    })

    app.get(
      '/api/auth/options',
      async (): Promise<AuthOptionsDto> => ({
        registrationOpen: (await sysParams(ctx.db)).registrationOpen,
        feishuLogin: await feishuLoginReady(ctx),
      }),
    )

    app.post('/api/auth/register', async (req, reply) => {
      const body = RegisterReq.parse(req.body)
      const invite = body.inviteToken ? await findInvite(ctx, body.inviteToken) : null
      if (invite && !invite.usable) return fail('code_expired', '邀请链接已失效')
      if (!invite && !(await sysParams(ctx.db)).registrationOpen)
        return fail('forbidden', '未开放注册，请联系系统管理员创建账号')
      if (signups.blocked(req.ip)) return fail('forbidden', '注册过于频繁，请稍后再试')
      const [user] = await ctx.db
        .insert(users)
        .values({
          account: body.account,
          name: body.name,
          role: 'member',
          passwordHash: await hash(body.password),
          mustChangePassword: false,
        })
        .onConflictDoNothing({ target: users.account })
        .returning()
      if (!user) return fail('conflict', '账号已存在')
      if (invite) await acceptInvite(ctx, invite, user)
      await joinDefaultTeam(ctx.db, user.id)
      signups.fail(req.ip)
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        action: 'user.register',
        detail: { userId: user.id, account: user.account },
      })
      await signIn(reply, user.id)
      return reply.status(201).send(await meDto(ctx, user))
    })

    app.post('/api/auth/logout', async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE]
      if (token)
        await ctx.db
          .update(webSessions)
          .set({ revokedAt: ctx.now() })
          .where(eq(webSessions.tokenHash, sha256(token)))
      reply.clearCookie(SESSION_COOKIE, { path: '/' })
      return reply.status(204).send()
    })

    app.get('/api/me', async (req) => meDto(ctx, await requireUser(ctx, req, { allowPending: true })))

    app.patch('/api/me', async (req) => {
      const user = await requireUser(ctx, req)
      const patch = UpdateMeReq.parse(req.body)
      if (!Object.keys(patch).length) return meDto(ctx, user)
      const [row] = await ctx.db.update(users).set(patch).where(eq(users.id, user.id)).returning()
      if (patch.name !== undefined && patch.name !== user.name) {
        const mine = await ctx.db
          .select({ id: groupMembers.groupId })
          .from(groupMembers)
          .where(eq(groupMembers.userId, user.id))
        for (const g of mine) await publishGroup(ctx, g.id)
        await publishBots(ctx, eq(bots.ownerId, user.id))
      }
      return meDto(ctx, row ?? user)
    })

    app.post('/api/auth/password', async (req) => {
      const user = await requireUser(ctx, req, { allowPending: true })
      const { oldPassword, newPassword } = ChangePasswordReq.parse(req.body)
      if (!user.passwordHash || !(await verify(user.passwordHash, oldPassword)))
        return fail('invalid', '当前密码错误')
      if (oldPassword === newPassword) return fail('invalid', '新密码不能与当前密码相同')
      await ctx.db
        .update(users)
        .set({ passwordHash: await hash(newPassword), mustChangePassword: false })
        .where(eq(users.id, user.id))
      await ctx.db
        .update(webSessions)
        .set({ revokedAt: ctx.now() })
        .where(
          and(
            eq(webSessions.userId, user.id),
            isNull(webSessions.revokedAt),
            ne(webSessions.tokenHash, sha256(req.cookies[SESSION_COOKIE] ?? '')),
          ),
        )
      return meDto(ctx, { ...user, mustChangePassword: false })
    })
  }
}
