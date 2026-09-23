import { ChangePasswordReq, LoginReq } from '@aiws/protocol'
import { hash, verify } from '@node-rs/argon2'
import { and, eq, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { users, webSessions } from '../../db/schema.js'
import { sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { Throttle } from '../../lib/throttle.js'
import { toUserDto } from '../users/dto.js'
import { createSession, requireUser, SESSION_COOKIE } from './session.js'

const LOGIN_MAX_FAILURES = 5
const LOGIN_WINDOW_MS = 5 * 60_000
const BAD_CREDENTIALS = '账号或密码错误'

export function authRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const throttle = new Throttle(LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, ctx.now)
    // Verifying against a throwaway hash keeps response time independent of whether the account exists.
    const decoy = hash('decoy-password')

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
      const session = await createSession(ctx, user.id)
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.config.secureCookies,
        path: '/',
        expires: session.expiresAt,
      })
      return toUserDto(user)
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

    app.get('/api/me', async (req) => toUserDto(await requireUser(ctx, req, { allowPending: true })))

    app.post('/api/auth/password', async (req) => {
      const user = await requireUser(ctx, req, { allowPending: true })
      const { oldPassword, newPassword } = ChangePasswordReq.parse(req.body)
      if (!(await verify(user.passwordHash, oldPassword))) return fail('invalid', '当前密码错误')
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
      return toUserDto({ ...user, mustChangePassword: false })
    })
  }
}
