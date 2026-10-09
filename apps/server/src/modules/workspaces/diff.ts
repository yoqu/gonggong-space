import { randomUUID } from 'node:crypto'
import { DiffScope, type WorkspaceDiffDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupBots, runs } from '../../db/schema.js'
import { fail, HttpError } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { open } from '../../lib/seal.js'
import { requireUser } from '../auth/session.js'
import { activeBots, requireMember } from '../groups/service.js'
import { redact } from '../runs/redact.js'
import { currentRepo, onlineMachine } from './provision.js'

/** Large repos take a while to write a tree and diff it. */
const DIFF_TIMEOUT_MS = 10_000
const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']
const OFFLINE = 'Bot 离线，无法读取工作区改动'

const Query = z.object({ scope: DiffScope, runId: z.string().optional() })

/** GET /api/groups/:id/bots/:botId/diff — a bot workspace's changes, from its daemon (or a finished run's patch). */
export function workspaceDiffRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string; botId: string }; Querystring: unknown }>(
      '/api/groups/:id/bots/:botId/diff',
      async (req): Promise<WorkspaceDiffDto> => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const { scope, runId } = Query.parse(req.query)
        const botId = idParam(req.params.botId, 'Bot 不存在')
        const bot = (await activeBots(ctx, group.id)).find((b) => b.id === botId)
        if (!bot) return fail('not_found', '该 Bot 不在群内')
        if (scope === 'turn') {
          if (!runId) return fail('invalid', '缺少运行 ID')
          const [run] = await ctx.db
            .select({ status: runs.status, patch: runs.patch, patchRepos: runs.patchRepos })
            .from(runs)
            .where(
              and(
                eq(runs.id, idParam(runId, '运行不存在')),
                eq(runs.groupId, group.id),
                eq(runs.botId, bot.id),
              ),
            )
          if (!run) return fail('not_found', '运行不存在')
          // A finished turn's patch was stored with run.done; the daemon only knows the live one.
          if (!LIVE.includes(run.status))
            return {
              scope,
              patch: run.patch && open(run.patch),
              base: null,
              branch: null,
              repos: run.patchRepos,
            }
        }
        const machineId = onlineMachine(ctx, bot.machineId)
        if (!machineId) return fail('conflict', OFFLINE)
        const [gb] = await ctx.db
          .select({ cdPath: groupBots.cdPath })
          .from(groupBots)
          .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
        const repo = await currentRepo(ctx, group.id)
        const ask = {
          t: 'workspace.diff',
          requestId: randomUUID(),
          groupId: group.id,
          botId: bot.id,
          workspace: { repo, cdPath: gb?.cdPath ?? null },
          scope,
          runId: runId ?? null,
        } as const
        const res =
          (await ctx.hub.request(machineId, ask, 'workspace.diff.result', DIFF_TIMEOUT_MS)) ??
          fail('conflict', OFFLINE)
        if (res.error) throw new HttpError('conflict', res.error)
        return {
          scope,
          patch: res.patch && redact(res.patch),
          base: res.base,
          branch: res.branch,
          repos: res.repos,
        }
      },
    )
  }
}
