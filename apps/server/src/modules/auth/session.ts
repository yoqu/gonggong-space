import { and, eq, gt, isNull } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { users, webSessions } from '../../db/schema.js'
import { newToken, sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'

export const SESSION_COOKIE = 'gonggong_session'
const SESSION_DAYS = 30

export type SessionUser = typeof users.$inferSelect

export async function createSession(ctx: Ctx, userId: string) {
  const token = newToken('ws')
  const expiresAt = new Date(ctx.now().getTime() + SESSION_DAYS * 86_400_000)
  await ctx.db.insert(webSessions).values({ tokenHash: sha256(token), userId, expiresAt })
  return { token, expiresAt }
}

/** Signs the browser in as `userId` (session cookie). */
export async function startSession(ctx: Ctx, reply: FastifyReply, userId: string) {
  const session = await createSession(ctx, userId)
  reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    path: '/',
    expires: session.expiresAt,
  })
}

export async function resolveSession(ctx: Ctx, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  const [row] = await ctx.db
    .select({ user: users })
    .from(webSessions)
    .innerJoin(users, eq(users.id, webSessions.userId))
    .where(
      and(
        eq(webSessions.tokenHash, sha256(token)),
        isNull(webSessions.revokedAt),
        gt(webSessions.expiresAt, ctx.now()),
        isNull(users.disabledAt),
      ),
    )
  return row?.user ?? null
}

/** Guards an API route. Users who must change their password may only reach `allowPending` routes. */
export async function requireUser(ctx: Ctx, req: FastifyRequest, { allowPending = false } = {}) {
  const user = await resolveSession(ctx, req.cookies[SESSION_COOKIE])
  if (!user) return fail('unauthorized', '请先登录')
  if (user.mustChangePassword && !allowPending) return fail('must_change_password', '首次登录需修改密码')
  return user
}

export async function requireSysadmin(ctx: Ctx, req: FastifyRequest) {
  const user = await requireUser(ctx, req)
  if (user.role !== 'sysadmin') return fail('forbidden', '仅系统管理员可操作')
  return user
}
