import { type BotShareRequestDto, BotShareRequestReq, type ShareApprovedDto } from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { botShareRequests, botShares, bots, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser, type SessionUser } from '../auth/session.js'
import { createGroup } from '../groups/create.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { requireTeam } from '../teams/service.js'
import { publishBot } from './dto.js'
import { dmsOf, isSharedWith, setShares } from './shares.js'

type IdParams = { Params: { id: string } }

async function liveBot(ctx: Ctx, rawId: string) {
  const [bot] = await ctx.db
    .select()
    .from(bots)
    .where(eq(bots.id, idParam(rawId, 'Bot 不存在')))
  return bot && !bot.deletedAt ? bot : fail('not_found', 'Bot 不存在')
}

const canDecide = (user: SessionUser, ownerId: string) => user.id === ownerId || user.role === 'sysadmin'

/** A pending request the caller may decide, with its bot. */
async function pending(ctx: Ctx, user: SessionUser, rawId: string) {
  const [row] = await ctx.db
    .select({ req: botShareRequests, bot: bots })
    .from(botShareRequests)
    .innerJoin(bots, eq(bots.id, botShareRequests.botId))
    .where(and(eq(botShareRequests.id, idParam(rawId, '申请不存在')), eq(botShareRequests.status, 'pending')))
  if (!row) return fail('not_found', '申请不存在或已处理')
  if (!canDecide(user, row.bot.ownerId)) return fail('forbidden', '只有 Bot 主人或系统管理员可以处理共享申请')
  return row
}

async function decide(ctx: Ctx, user: SessionUser, id: string, status: 'approved' | 'rejected') {
  await ctx.db
    .update(botShareRequests)
    .set({ status, decidedBy: user.id, decidedAt: ctx.now() })
    .where(eq(botShareRequests.id, id))
  await resolveNotifications(ctx, 'bot_share_request', 'requestId', [id])
}

/** 同意, on the web or the owner's Feishu card: shares the bot and opens the requester's DM with it. */
export async function approveShareRequest(
  ctx: Ctx,
  user: SessionUser,
  id: string,
): Promise<ShareApprovedDto> {
  const { req: r, bot } = await pending(ctx, user, id)
  const shared = (
    await ctx.db.select({ userId: botShares.userId }).from(botShares).where(eq(botShares.botId, bot.id))
  ).map((s) => s.userId)
  await setShares(ctx, user, bot, [...shared, r.userId], { quiet: true })
  await decide(ctx, user, r.id, 'approved')
  const [requester] = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, r.userId))
  // An earlier DM came back with the share; otherwise one is opened for them.
  const [dm] = await dmsOf(ctx, bot.id, [r.userId], true)
  const groupId =
    dm?.id ??
    (await createGroup(ctx, requester ?? { id: r.userId, name: '' }, bot.teamId, {
      name: bot.name,
      kind: 'dm',
      memberIds: [],
      botIds: [bot.id],
      repo: null,
    }))
  await notify(ctx, r.userId, 'bot_share_decided', {
    botId: bot.id,
    botName: bot.name,
    byName: user.name,
    approved: true,
    groupId,
  })
  await audit(ctx, {
    category: 'admin',
    actorUserId: user.id,
    teamId: bot.teamId,
    action: 'bot.share_request.approve',
    detail: { botId: bot.id, name: bot.name, userId: r.userId },
  })
  await publishBot(ctx, bot.id)
  return { groupId }
}

/** 拒绝, on the web or the owner's Feishu card. */
export async function rejectShareRequest(ctx: Ctx, user: SessionUser, id: string) {
  const { req: r, bot } = await pending(ctx, user, id)
  await decide(ctx, user, r.id, 'rejected')
  await notify(ctx, r.userId, 'bot_share_decided', {
    botId: bot.id,
    botName: bot.name,
    byName: user.name,
    approved: false,
  })
}

/**
 * 申请共享: a teammate asks for someone's bot; the owner (or a sysadmin) approves, which shares it and opens the
 * requester's DM with it, or declines. Either way the requester is told.
 */
export function shareRequestRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post<IdParams>('/api/bots/:id/share-requests', async (req): Promise<BotShareRequestDto> => {
      const user = await requireUser(ctx, req)
      const bot = await liveBot(ctx, req.params.id)
      await requireTeam(ctx, user.id, bot.teamId)
      const { reason } = BotShareRequestReq.parse(req.body ?? {})
      if (bot.ownerId === user.id) return fail('invalid', '这是你自己的 Bot')
      if (await isSharedWith(ctx, bot.id, user.id)) return fail('invalid', '该 Bot 已共享给你')
      const [row] = await ctx.db
        .insert(botShareRequests)
        .values({ botId: bot.id, userId: user.id, reason })
        .onConflictDoNothing()
        .returning()
      if (!row) return fail('conflict', '已申请，等待 Bot 主人处理')
      await notify(ctx, bot.ownerId, 'bot_share_request', {
        requestId: row.id,
        botId: bot.id,
        botName: bot.name,
        byName: user.name,
        reason,
      })
      return {
        id: row.id,
        botId: bot.id,
        userId: user.id,
        userName: user.name,
        reason,
        createdAt: row.createdAt.toISOString(),
      }
    })

    // The owner (or a sysadmin) sees every pending request; anyone else only their own.
    app.get<IdParams>('/api/bots/:id/share-requests', async (req): Promise<BotShareRequestDto[]> => {
      const user = await requireUser(ctx, req)
      const bot = await liveBot(ctx, req.params.id)
      await requireTeam(ctx, user.id, bot.teamId)
      const rows = await ctx.db
        .select({ req: botShareRequests, userName: users.name })
        .from(botShareRequests)
        .innerJoin(users, eq(users.id, botShareRequests.userId))
        .where(
          and(
            eq(botShareRequests.botId, bot.id),
            eq(botShareRequests.status, 'pending'),
            canDecide(user, bot.ownerId) ? undefined : eq(botShareRequests.userId, user.id),
          ),
        )
        .orderBy(asc(botShareRequests.createdAt))
      return rows.map(({ req: r, userName }) => ({
        id: r.id,
        botId: r.botId,
        userId: r.userId,
        userName,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }))
    })

    app.post<IdParams>(
      '/api/share-requests/:id/approve',
      async (req): Promise<ShareApprovedDto> =>
        approveShareRequest(ctx, await requireUser(ctx, req), req.params.id),
    )

    app.post<IdParams>('/api/share-requests/:id/reject', async (req, reply) => {
      await rejectShareRequest(ctx, await requireUser(ctx, req), req.params.id)
      return reply.status(204).send()
    })
  }
}
