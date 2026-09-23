import type { RunDetailDto, RunEvent } from '@aiws/protocol'
import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupBots, groupMembers, runEvents, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { runDtoLoader } from './dto.js'
import { runRetentionDays } from './retention.js'

export function runRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/runs/:id', async (req): Promise<RunDetailDto> => {
      const user = await requireUser(ctx, req)
      const { id } = z.object({ id: z.uuid() }).parse(req.params)
      const [row] = await ctx.db
        .select({ run: runs })
        .from(runs)
        .innerJoin(
          groupMembers,
          and(eq(groupMembers.groupId, runs.groupId), eq(groupMembers.userId, user.id)),
        )
        .where(eq(runs.id, id))
      if (!row) return fail('not_found', '运行不存在')
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
        patch: row.run.patch,
        purged: row.run.purgedAt !== null,
        sessionId: gb?.sessionId ?? null,
        retentionDays: await runRetentionDays(ctx),
        events: events.map((e) => ({
          id: e.id,
          at: e.createdAt.toISOString(),
          event: e.payload as RunEvent,
        })),
      }
    })
  }
}
