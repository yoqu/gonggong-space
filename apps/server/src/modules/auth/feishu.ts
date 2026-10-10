import { FeishuBindReq, type FeishuIdentityView, type FeishuTicketDto } from '@gonggong/protocol'
import { verify } from '@node-rs/argon2'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { feishuIdentities, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { newToken } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { seal } from '../../lib/seal.js'
import { Throttle } from '../../lib/throttle.js'
import { sysParams } from '../admin/params.js'
import { mainApp } from '../feishu/apps.js'
import { FeishuError, type FeishuTokens, type FeishuUser } from '../feishu/client.js'
import { credsOf } from '../feishu/gateway.js'
import { publicUrl } from '../feishu/identity.js'
import { joinBoundChats } from '../feishu/members.js'
import { meDto } from '../teams/dto.js'
import { findInvite, onboardUser } from '../teams/members.js'
import { requireUser, resolveSession, SESSION_COOKIE, startSession } from './session.js'

const TTL_MS = 10 * 60_000
const CALLBACK = '/api/auth/feishu/callback'
const INVITE_NEXT = /^\/join\/([^/?#]+)$/

/** 飞书登录 needs both the main app and 对外地址 (the OAuth redirect base). */
export async function feishuLoginReady(ctx: Ctx) {
  return !!(await mainApp(ctx)) && !!(await publicUrl(ctx))
}

/** Same-origin paths only, never another site. */
const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/')

interface State {
  next: string
  /** Set when a signed-in user links their account (个人设置). */
  linkUserId?: string
  /** Started inside the Feishu client (网页应用): an unlinked user is matched by email or signed up, no choose page. */
  silent?: boolean
  expiresAt: number
}
interface Ticket {
  user: FeishuUser
  tokens: FeishuTokens
  next: string
  expiresAt: number
}

/** Stores the Feishu identity (and its tokens) for `userId`; one identity per account and per Feishu user.
 * A first link fills the account's empty email and avatar from Feishu. */
async function link(ctx: Ctx, userId: string, user: FeishuUser, tokens: FeishuTokens) {
  const values = {
    unionId: user.unionId,
    feishuUserId: user.userId,
    openId: user.openId,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    accessToken: seal(tokens.accessToken),
    refreshToken: tokens.refreshToken ? seal(tokens.refreshToken) : null,
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
    updatedAt: ctx.now(),
  }
  const taken = await ctx.db
    .select({ userId: feishuIdentities.userId, unionId: feishuIdentities.unionId })
    .from(feishuIdentities)
    .where(or(eq(feishuIdentities.userId, userId), eq(feishuIdentities.unionId, user.unionId)))
  if (taken.some((r) => r.userId !== userId || r.unionId !== user.unionId))
    return fail('conflict', '该账号或飞书身份已绑定其他身份')
  if (taken.length) {
    await ctx.db.update(feishuIdentities).set(values).where(eq(feishuIdentities.userId, userId))
    return
  }
  await ctx.db.insert(feishuIdentities).values({ userId, ...values })
  await ctx.db
    .update(users)
    .set({
      email: sql`coalesce(${users.email}, ${user.email?.toLowerCase() ?? null})`,
      avatar: sql`coalesce(${users.avatar}, ${user.avatar})`,
    })
    .where(eq(users.id, userId))
  await joinBoundChats(ctx, userId, user.unionId)
}

/** Account stem: the email prefix, else the user_id, fitted to the account rule; else `feishu`. */
function accountStem(user: FeishuUser) {
  const clean = (s: string | null | undefined) =>
    (s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 28)
  return [clean(user.email?.split('@')[0]), clean(user.userId)].find((s) => s.length >= 2) ?? 'feishu'
}

/** The team invite a login started from (`next` = /join/:token), when still usable. */
async function inviteOf(ctx: Ctx, next: string) {
  const token = INVITE_NEXT.exec(next)?.[1]
  if (!token) return null
  try {
    const found = await findInvite(ctx, decodeURIComponent(token))
    return found.usable ? found : null
  } catch {
    return null
  }
}

/** A password-less account named after the Feishu user, linked and onboarded. */
async function createAccount(
  ctx: Ctx,
  feishuUser: FeishuUser,
  tokens: FeishuTokens,
  invite: Awaited<ReturnType<typeof inviteOf>>,
) {
  const stem = accountStem(feishuUser)
  let user: typeof users.$inferSelect | undefined
  // A numeric suffix skips taken accounts; the conflict check also covers concurrent sign-ups.
  for (let i = 1; !user; i++) {
    ;[user] = await ctx.db
      .insert(users)
      .values({
        account: i === 1 ? stem : `${stem}${i}`,
        name: feishuUser.name.slice(0, 40),
        role: 'member',
        passwordHash: null,
        mustChangePassword: false,
      })
      .onConflictDoNothing({ target: users.account })
      .returning()
  }
  await link(ctx, user.id, feishuUser, tokens)
  await onboardUser(ctx, user, invite)
  await audit(ctx, {
    category: 'admin',
    actorUserId: user.id,
    action: 'user.register',
    detail: { userId: user.id, account: user.account, via: 'feishu' },
  })
  const [fresh] = await ctx.db.select().from(users).where(eq(users.id, user.id))
  return fresh ?? user
}

/** The single account with the Feishu user's email and no Feishu identity yet; ambiguous matches count as none. */
async function accountByEmail(ctx: Ctx, email: string | null) {
  if (!email) return null
  const found = await ctx.db
    .select({ user: users })
    .from(users)
    .leftJoin(feishuIdentities, eq(feishuIdentities.userId, users.id))
    .where(and(eq(sql`lower(${users.email})`, email.toLowerCase()), isNull(feishuIdentities.userId)))
    .limit(2)
  return found.length === 1 ? found[0]!.user : null
}

export function feishuAuthRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    // One server holds the Feishu connections, so pending logins live in memory; a restart only voids them.
    const states = new Map<string, State>()
    const tickets = new Map<string, Ticket>()
    const throttle = new Throttle(5, 5 * 60_000, ctx.now)

    const take = <T extends { expiresAt: number }>(map: Map<string, T>, key: string, keep = false) => {
      const hit = map.get(key)
      if (!keep || (hit && hit.expiresAt <= ctx.now().getTime())) map.delete(key)
      return hit && hit.expiresAt > ctx.now().getTime() ? hit : null
    }
    const ticketOf = (key: string, keep = false) =>
      take(tickets, key, keep) ?? fail('code_expired', '飞书登录已过期，请重新登录')

    app.get('/api/auth/feishu/start', async (req, reply) => {
      const q = req.query as { next?: string; mode?: string }
      const main = await mainApp(ctx)
      const base = await publicUrl(ctx)
      if (!main || !base) return reply.redirect('/login?feishu=unavailable')
      let linkUserId: string | undefined
      if (q.mode === 'link') {
        const user = await resolveSession(ctx, req.cookies[SESSION_COOKIE])
        if (!user) return reply.redirect('/login')
        linkUserId = user.id
      }
      const state = newToken('fs')
      states.set(state, {
        next: safeNext(q.next),
        linkUserId,
        silent: q.mode === 'silent',
        expiresAt: ctx.now().getTime() + TTL_MS,
      })
      return reply.redirect(ctx.feishu.api.authorizeUrl(main.appId, `${base}${CALLBACK}`, state))
    })

    app.get(CALLBACK, async (req, reply) => {
      const q = req.query as { code?: string; state?: string; error?: string }
      const state = q.state ? take(states, q.state) : null
      const back = (reason: string) =>
        reply.redirect(state?.linkUserId ? `${state.next}?feishu=${reason}` : `/login?feishu=${reason}`)
      if (!state) return reply.redirect('/login?feishu=expired')
      if (q.error || !q.code) return back('denied')
      const main = await mainApp(ctx)
      const base = await publicUrl(ctx)
      if (!main || !base) return back('unavailable')
      let tokens: FeishuTokens
      let user: FeishuUser
      try {
        tokens = await ctx.feishu.api.exchangeCode(credsOf(main), q.code, `${base}${CALLBACK}`)
        user = await ctx.feishu.api.userInfo(credsOf(main), tokens.accessToken)
      } catch (err) {
        if (!(err instanceof FeishuError)) throw err
        req.log.warn({ err }, 'feishu login failed')
        return back('failed')
      }

      if (state.linkUserId) {
        try {
          await link(ctx, state.linkUserId, user, tokens)
        } catch {
          return back('taken')
        }
        await audit(ctx, {
          category: 'admin',
          actorUserId: state.linkUserId,
          action: 'user.feishu.link',
          detail: { userId: state.linkUserId, feishu: user.name },
        })
        return back('linked')
      }

      const [linked] = await ctx.db
        .select({ user: users })
        .from(feishuIdentities)
        .innerJoin(users, eq(users.id, feishuIdentities.userId))
        .where(eq(feishuIdentities.unionId, user.unionId))
      if (linked) {
        if (linked.user.disabledAt) return back('disabled')
        await link(ctx, linked.user.id, user, tokens)
        await startSession(ctx, reply, linked.user.id)
        return reply.redirect(state.next)
      }
      if (state.silent) {
        const matched = await accountByEmail(ctx, user.email)
        if (matched?.disabledAt) return back('disabled')
        if (matched) {
          await link(ctx, matched.id, user, tokens)
          await audit(ctx, {
            category: 'admin',
            actorUserId: matched.id,
            action: 'user.feishu.link',
            detail: { userId: matched.id, feishu: user.name },
          })
          await startSession(ctx, reply, matched.id)
          return reply.redirect(state.next)
        }
        const invite = await inviteOf(ctx, state.next)
        if ((await sysParams(ctx.db)).feishuAutoSignup || invite) {
          const created = await createAccount(ctx, user, tokens, invite)
          await startSession(ctx, reply, created.id)
          return reply.redirect(state.next)
        }
      }
      const ticket = newToken('ft')
      tickets.set(ticket, { user, tokens, next: state.next, expiresAt: ctx.now().getTime() + TTL_MS })
      return reply.redirect(`/feishu/choose?ticket=${encodeURIComponent(ticket)}`)
    })

    app.get('/api/auth/feishu/ticket/:ticket', async (req): Promise<FeishuTicketDto> => {
      const { user, next } = ticketOf((req.params as { ticket: string }).ticket, true)
      return {
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        canCreate: (await sysParams(ctx.db)).feishuAutoSignup || !!(await inviteOf(ctx, next)),
        next,
      }
    })

    app.post('/api/auth/feishu/ticket/:ticket/bind', async (req, reply) => {
      const key = (req.params as { ticket: string }).ticket
      const ticket = ticketOf(key, true)
      const { account, password } = FeishuBindReq.parse(req.body)
      if (throttle.blocked(account)) return fail('forbidden', '登录失败次数过多，请稍后再试')
      const [user] = await ctx.db.select().from(users).where(eq(users.account, account))
      if (!user?.passwordHash || !(await verify(user.passwordHash, password))) {
        throttle.fail(account)
        return fail('unauthorized', '账号或密码错误')
      }
      if (user.disabledAt) return fail('forbidden', '账号已停用，请联系系统管理员')
      throttle.reset(account)
      await link(ctx, user.id, ticket.user, ticket.tokens)
      tickets.delete(key)
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        action: 'user.feishu.link',
        detail: { userId: user.id, feishu: ticket.user.name },
      })
      await startSession(ctx, reply, user.id)
      const [fresh] = await ctx.db.select().from(users).where(eq(users.id, user.id))
      return meDto(ctx, fresh ?? user)
    })

    app.post('/api/auth/feishu/ticket/:ticket/create', async (req, reply) => {
      const key = (req.params as { ticket: string }).ticket
      const ticket = ticketOf(key, true)
      const invite = await inviteOf(ctx, ticket.next)
      if (!(await sysParams(ctx.db)).feishuAutoSignup && !invite)
        return fail('forbidden', '未开启飞书自动开户，请绑定已有账号或联系系统管理员')
      tickets.delete(key)
      const user = await createAccount(ctx, ticket.user, ticket.tokens, invite)
      await startSession(ctx, reply, user.id)
      return reply.status(201).send(await meDto(ctx, user))
    })

    app.get('/api/me/feishu', async (req): Promise<FeishuIdentityView> => {
      const user = await requireUser(ctx, req)
      const [row] = await ctx.db.select().from(feishuIdentities).where(eq(feishuIdentities.userId, user.id))
      return {
        identity: row
          ? { name: row.name, avatar: row.avatar, email: row.email, boundAt: row.createdAt.toISOString() }
          : null,
      }
    })

    app.delete('/api/me/feishu', async (req, reply) => {
      const user = await requireUser(ctx, req)
      if (!user.passwordHash) return fail('invalid', '账号未设置密码，解绑后将无法登录')
      await ctx.db.delete(feishuIdentities).where(eq(feishuIdentities.userId, user.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        action: 'user.feishu.unlink',
        detail: { userId: user.id },
      })
      return reply.status(204).send()
    })
  }
}
