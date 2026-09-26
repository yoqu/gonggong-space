import type { RunDetailDto, RunEvent, RunSessionDto } from '@gonggong/protocol'
import { and, asc, desc, eq, gte, isNotNull, lt, lte, max } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupBots, groupMembers, messages, runEvents, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { open } from '../../lib/seal.js'
import { requireUser } from '../auth/session.js'
import { runDtoLoader } from './dto.js'
import { runRetentionDays } from './retention.js'
import { openEvent } from './sealed.js'

/** Most rounds the session list returns; older ones are rarely worth scrolling back to. */
const SESSION_ROUNDS = 50

export function runRoutes(ctx: Ctx) {
  const visibleRun = async (req: FastifyRequest) => {
    const user = await requireUser(ctx, req)
    const { id } = z.object({ id: z.uuid() }).parse(req.params)
    const [row] = await ctx.db
      .select({ run: runs })
      .from(runs)
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, runs.groupId), eq(groupMembers.userId, user.id)))
      .where(eq(runs.id, id))
    return row ?? fail('not_found', '运行不存在')
  }
  return async (app: FastifyInstance) => {
    app.get('/api/runs/:id', async (req): Promise<RunDetailDto> => {
      const row = await visibleRun(req)
      const events = await ctx.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, row.run.id))
        .orderBy(asc(runEvents.id))
      const [gb] = await ctx.db
        .select({ sessionId: groupBots.sessionId })
        .from(groupBots)
        .where(and(eq(groupBots.groupId, row.run.groupId), eq(groupBots.botId, row.run.botId)))
      const toDto = await runDtoLoader(ctx, [row.run])
      return {
        run: toDto(row.run),
        patch: row.run.patch && open(row.run.patch),
        purged: row.run.purgedAt !== null,
        sessionId: gb?.sessionId ?? null,
        retentionDays: await runRetentionDays(ctx),
        events: events.map((e) => ({
          id: e.id,
          at: e.createdAt.toISOString(),
          event: openEvent(e.payload as RunEvent),
        })),
      }
    })

    // A session starts at the latest round that opened a new one (every fresh session reports its reason).
    app.get('/api/runs/:id/session', async (req): Promise<RunSessionDto> => {
      const { run } = await visibleRun(req)
      const until = run.startedAt ?? ctx.now()
      const same = and(eq(runs.groupId, run.groupId), eq(runs.botId, run.botId))
      const [first] = await ctx.db
        .select({ at: max(runs.startedAt) })
        .from(runs)
        .where(and(same, isNotNull(runs.newSessionReason), lte(runs.startedAt, until)))
      const rows = await ctx.db
        .select({ run: runs, prompt: messages.body })
        .from(runs)
        .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
        .where(and(same, lt(runs.startedAt, until), first?.at ? gte(runs.startedAt, first.at) : undefined))
        .orderBy(desc(runs.startedAt))
        .limit(SESSION_ROUNDS)
      const toDto = await runDtoLoader(
        ctx,
        rows.map((r) => r.run),
      )
      return { rounds: rows.reverse().map((r) => ({ run: toDto(r.run), prompt: r.prompt })) }
    })
  }
}
