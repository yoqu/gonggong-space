import { InterruptChoiceReq, type StopRes, type TaskStopRes } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, runs } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { chooseInterrupt, stopRuns } from './stop.js'

const Params = z.object({ id: z.uuid() })
const TaskParams = Params.extend({ taskId: z.string().min(1).max(200) })

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
    // Background tasks may outlive their run: any member can stop one, like the run itself.
    app.post('/api/runs/:id/tasks/:taskId/stop', async (req): Promise<TaskStopRes> => {
      const user = await requireUser(ctx, req)
      const { id, taskId } = TaskParams.parse(req.params)
      const [row] = await ctx.db
        .select({ groupId: runs.groupId, machineId: bots.machineId })
        .from(runs)
        .innerJoin(bots, eq(bots.id, runs.botId))
        .innerJoin(
          groupMembers,
          and(eq(groupMembers.groupId, runs.groupId), eq(groupMembers.userId, user.id)),
        )
        .where(eq(runs.id, id))
      if (!row) return fail('not_found', '运行不存在')
      const sent = !!row.machineId && ctx.hub.send(row.machineId, { t: 'task.stop', runId: id, taskId })
      await audit(ctx, {
        category: 'run',
        actorUserId: user.id,
        action: 'run.task_stop',
        groupId: row.groupId,
        detail: { runId: id, taskId },
      })
      return { sent }
    })
    app.post('/api/runs/:id/interrupt', async (req) => {
      const user = await requireUser(ctx, req)
      const { id } = Params.parse(req.params)
      const { choice } = InterruptChoiceReq.parse(req.body)
      await chooseInterrupt(ctx, id, choice, user)
      return { ok: true }
    })
  }
}
