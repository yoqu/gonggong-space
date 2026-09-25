import { InterruptChoiceReq, type StopRes } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupMembers, runs } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { chooseInterrupt, stopRuns } from './stop.js'

const Params = z.object({ id: z.uuid() })

/** Card actions of plan D7: /stop and 终止整条链 (any group member), and the keep / discard choice. */
export function stopRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const stop =
      (chain: boolean) =>
      async (req: FastifyRequest): Promise<StopRes> => {
        const user = await requireUser(ctx, req)
        const { id } = Params.parse(req.params)
        const [row] = await ctx.db
          .select({ groupId: runs.groupId })
          .from(runs)
          .innerJoin(
            groupMembers,
            and(eq(groupMembers.groupId, runs.groupId), eq(groupMembers.userId, user.id)),
          )
          .where(eq(runs.id, id))
        if (!row) return fail('not_found', '运行不存在')
        const stopped = await stopRuns(ctx, { groupId: row.groupId, runId: id, chain }, user)
        if (stopped.length)
          await audit(ctx, {
            category: 'run',
            actorUserId: user.id,
            action: chain ? 'run.stop_chain' : 'run.stop',
            groupId: row.groupId,
            detail: { runId: id, runIds: stopped.map((r) => r.id) },
          })
        return { stopped: stopped.length }
      }
    app.post('/api/runs/:id/stop', stop(false))
    app.post('/api/runs/:id/stop-chain', stop(true))
    app.post('/api/runs/:id/interrupt', async (req) => {
      const user = await requireUser(ctx, req)
      const { id } = Params.parse(req.params)
      const { choice } = InterruptChoiceReq.parse(req.body)
      await chooseInterrupt(ctx, id, choice, user)
      return { ok: true }
    })
  }
}
