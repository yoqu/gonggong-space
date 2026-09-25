import { UsageQuery, type UsageRowDto } from '@gonggong/protocol'
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groups, runs, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'

const DAY_MS = 86_400_000
const DIMENSIONS = {
  bot: [bots.id, bots.name],
  user: [users.id, users.name],
  group: [groups.id, groups.name],
} as const

/**
 * Usage totals over runs that actually started (spec §3.7), grouped by bot / chain initiator / group. Sysadmins see
 * everything; members see only their own bots' runs. No quotas.
 */
export function usageRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/usage', async (req): Promise<UsageRowDto[]> => {
      const me = await requireUser(ctx, req)
      const q = UsageQuery.parse(req.query)
      const admin = me.role === 'sysadmin'
      if (q.botId && !admin) {
        const [bot] = isUuid(q.botId)
          ? await ctx.db.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, q.botId))
          : []
        if (bot?.ownerId !== me.id) return fail('forbidden', '仅 Bot 主人或系统管理员可查看该 Bot 的用量')
      }
      const [key, name] = DIMENSIONS[q.by]
      const count = sql<number>`count(*)`.mapWith(Number)
      const tokens = sql<number>`coalesce(sum((${runs.usage}->>'totalTokens')::bigint), 0)`.mapWith(Number)
      return ctx.db
        .select({
          key,
          name,
          runs: count,
          totalTokens: tokens,
          unreported: sql<number>`count(*) filter (where ${runs.usage}->>'totalTokens' is null)`.mapWith(
            Number,
          ),
        })
        .from(runs)
        .innerJoin(bots, eq(bots.id, runs.botId))
        .innerJoin(users, eq(users.id, runs.originUserId))
        .innerJoin(groups, eq(groups.id, runs.groupId))
        .where(
          and(
            gte(runs.startedAt, new Date(ctx.now().getTime() - q.days * DAY_MS)),
            q.botId ? eq(runs.botId, q.botId) : undefined,
            admin ? undefined : eq(bots.ownerId, me.id),
          ),
        )
        .groupBy(key, name)
        .orderBy(desc(tokens), desc(count), asc(name))
    })
  }
}
