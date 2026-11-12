import { randomInt } from 'node:crypto'
import {
  LinkPollReq,
  type LinkPollRes,
  type LinkRequestDto,
  LinkRequestReq,
  type LinkRequestRes,
} from '@gonggong/protocol'
import { and, count, eq, gt } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { bindCodes, linkRequests } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { newToken, sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import type { Throttle } from '../../lib/throttle.js'
import { requireUser } from '../auth/session.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { afterBind, bindMachine, CODE_ALPHABET, CODE_FORMAT } from './bind.js'
import { serverUrl } from './onboard.js'

// 接入码过期 → 网页确认: gg asks to be linked, someone signed in allows it on /link/:id, gg's next poll binds it.

const LINK_TTL_MS = 15 * 60_000
const POLL_INTERVAL_MS = 3000
/** Pending requests one person can be asked about at a time, so nobody can flood them. */
const MAX_PENDING = 3

type Row = typeof linkRequests.$inferSelect

const userCode = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
const statusOf = (r: Row, now: Date) => (r.status === 'pending' && r.expiresAt <= now ? 'expired' : r.status)

const linkDto = (r: Row, now: Date): LinkRequestDto => ({
  id: r.id,
  machine: { name: r.machine.name, os: r.machine.os, arch: r.machine.arch },
  agent: r.createBotAgent ?? null,
  ip: r.ip,
  userCode: r.userCode,
  status: statusOf(r, now) as LinkRequestDto['status'],
  expiresAt: r.expiresAt.toISOString(),
})

export function linkRoutes(ctx: Ctx, app: FastifyInstance, ipThrottle: Throttle) {
  app.post('/api/daemon/link-requests', async (req): Promise<LinkRequestRes> => {
    if (ipThrottle.blocked(req.ip)) return fail('code_locked', '接入链接尝试次数过多，请 10 分钟后再试')
    const body = LinkRequestReq.parse(req.body)
    const now = ctx.now()
    const code = body.code?.trim().toUpperCase()
    const [issued] =
      code && CODE_FORMAT.test(code)
        ? await ctx.db.select({ userId: bindCodes.userId }).from(bindCodes).where(eq(bindCodes.code, code))
        : []
    const hint = issued?.userId ?? null
    if (hint) {
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: count() })
        .from(linkRequests)
        .where(
          and(
            eq(linkRequests.hintUserId, hint),
            eq(linkRequests.status, 'pending'),
            gt(linkRequests.expiresAt, now),
          ),
        )
      if (n >= MAX_PENDING) return fail('code_locked', '待确认的接入申请过多，请先在网页处理或稍后再试')
    }
    // Every request counts toward the client's limit, like a failed code: nobody can flood people with them.
    ipThrottle.fail(req.ip)
    const secret = newToken('lr')
    const [row] = (await ctx.db
      .insert(linkRequests)
      .values({
        secretHash: sha256(secret),
        userCode: userCode(),
        machine: body.machine,
        createBotAgent: body.createBot?.agent ?? null,
        hintUserId: hint,
        ip: req.ip,
        expiresAt: new Date(now.getTime() + LINK_TTL_MS),
        createdAt: now,
      })
      .returning()) as [Row]
    if (hint) {
      ctx.bus.publish([hint], { t: 'machine.linkRequested', request: linkDto(row, now) })
      await notify(ctx, hint, 'link_request', { requestId: row.id, machineName: row.machine.name }, null)
    }
    return {
      id: row.id,
      secret,
      userCode: row.userCode,
      url: `${await serverUrl(ctx, req)}/link/${row.id}`,
      expiresAt: row.expiresAt.toISOString(),
      intervalMs: POLL_INTERVAL_MS,
    }
  })

  app.post<{ Params: { id: string } }>(
    '/api/daemon/link-requests/:id/poll',
    async (req): Promise<LinkPollRes> => {
      const id = idParam(req.params.id, '接入申请不存在')
      const { secret } = LinkPollReq.parse(req.body)
      const [row] = await ctx.db.select().from(linkRequests).where(eq(linkRequests.id, id))
      if (!row || row.secretHash !== sha256(secret))
        return fail('unauthorized', '接入申请无效，请重新运行接入命令')
      const now = ctx.now()
      const status = statusOf(row, now)
      if (status === 'pending' || status === 'denied' || status === 'expired') return { status }
      // Allowed: bind now, once, so the token is never stored.
      const token = newToken('mt')
      const bound = await ctx.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(linkRequests)
          .set({ status: 'consumed' })
          .where(and(eq(linkRequests.id, id), eq(linkRequests.status, 'approved')))
          .returning()
        return claimed?.approvedBy ? bindMachine(tx, claimed.approvedBy, row.machine, token, now) : null
      })
      if (!bound) return fail('conflict', '接入申请已使用，请重新运行接入命令')
      return {
        status: 'approved',
        ...(await afterBind(ctx, req.log, bound, token, row.createBotAgent ?? undefined)),
      }
    },
  )

  const load = async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const user = await requireUser(ctx, req)
    const id = idParam(req.params.id, '接入申请不存在')
    const [row] = await ctx.db.select().from(linkRequests).where(eq(linkRequests.id, id))
    return row ? { user, row } : fail('not_found', '接入申请不存在')
  }

  app.get<{ Params: { id: string } }>(
    '/api/link-requests/:id',
    async (req): Promise<LinkRequestDto> => linkDto((await load(req)).row, ctx.now()),
  )

  // Anyone signed in who has the link may allow it, and the machine is theirs (device authorization).
  const decide = (to: 'approved' | 'denied') => async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const { user, row } = await load(req)
    const now = ctx.now()
    const status = statusOf(row, now)
    if (status === 'expired') return fail('code_expired', '接入申请已过期，请在终端重新运行接入命令')
    if (status !== 'pending') return fail('conflict', '接入申请已处理')
    const [done] = await ctx.db
      .update(linkRequests)
      .set({ status: to, approvedBy: to === 'approved' ? user.id : null })
      .where(
        and(eq(linkRequests.id, row.id), eq(linkRequests.status, 'pending'), gt(linkRequests.expiresAt, now)),
      )
      .returning()
    if (!done) return fail('conflict', '接入申请已处理')
    await resolveNotifications(ctx, 'link_request', 'requestId', [row.id])
    if (to === 'approved')
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        action: 'machine.link.approve',
        detail: { requestId: row.id, name: row.machine.name, ip: row.ip },
      })
    return linkDto(done, now)
  }
  app.post<{ Params: { id: string } }>('/api/link-requests/:id/approve', decide('approved'))
  app.post<{ Params: { id: string } }>('/api/link-requests/:id/deny', decide('denied'))
}
