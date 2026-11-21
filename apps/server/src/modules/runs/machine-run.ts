import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, runs } from '../../db/schema.js'
import type { MessageKey } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { LIVE } from './dto.js'

/** The `:runId` run of a bot on the calling machine; `live` also requires it to be still running. */
export async function machineRun(
  ctx: Ctx,
  req: FastifyRequest<{ Params: { runId: string } }>,
  { live = false, missing = '运行不存在' }: { live?: boolean; missing?: MessageKey } = {},
) {
  const machine = await requireMachine(ctx, req)
  const runId = idParam(req.params.runId, '运行不存在')
  const [row] = await ctx.db
    .select({ run: runs })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(
      and(eq(runs.id, runId), eq(bots.machineId, machine.id), live ? inArray(runs.status, LIVE) : undefined),
    )
  return row?.run ?? fail('not_found', missing)
}
