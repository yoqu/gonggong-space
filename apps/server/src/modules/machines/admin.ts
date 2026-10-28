import { randomUUID } from 'node:crypto'
import { LogLevelName, type MachineWorkspace } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { audit } from '../../lib/audit.js'
import { fail, HttpError } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { OFFLINE, ownMachine, requireFeature } from './relay.js'

const LOGS_TIMEOUT_MS = 10_000
/** Sizes are walked over every workspace on the machine. */
const WORKSPACES_TIMEOUT_MS = 60_000

const LogsQuery = z.object({
  level: LogLevelName.default('info'),
  limit: z.coerce.number().int().min(1).max(2000).default(300),
})
const DeleteReq = z.object({ groupId: z.string(), botId: z.string(), path: z.string().min(1) })

/** 我的机器管理: a machine's daemon logs and its workspaces, for its owner only, live through its daemon. */
export function machineAdminRoutes(ctx: Ctx) {
  /** The daemon's answer; offline, silent or its own error (in its words) fails the request. */
  const answered = <R extends { error: string | null }>(machineId: string, res: R | undefined) => {
    if (!res) return fail('conflict', ctx.hub.isOnline(machineId) ? '机器未响应，请稍后重试' : OFFLINE)
    if (res.error) throw new HttpError('invalid', res.error)
    return res
  }
  const owned = async (userId: string, id: string) => {
    const m = await ownMachine(ctx, userId, id, '只有机器主人可以管理这台机器')
    requireFeature(ctx, m.id, 'machineAdmin')
    return m
  }

  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>('/api/machines/:id/logs', async (req) => {
      const me = await requireUser(ctx, req)
      const m = await owned(me.id, req.params.id)
      const { level, limit } = LogsQuery.parse(req.query)
      const msg = { t: 'logs.get', requestId: randomUUID(), level, limit } as const
      return { lines: answered(m.id, await ctx.hub.request(m.id, msg, 'logs.result', LOGS_TIMEOUT_MS)).lines }
    })

    app.get<{ Params: { id: string } }>(
      '/api/machines/:id/workspaces',
      async (req): Promise<{ entries: MachineWorkspace[] }> => {
        const me = await requireUser(ctx, req)
        const m = await owned(me.id, req.params.id)
        const msg = { t: 'workspaces.list', requestId: randomUUID() } as const
        const res = await ctx.hub.request(m.id, msg, 'workspaces.result', WORKSPACES_TIMEOUT_MS)
        return { entries: answered(m.id, res).entries }
      },
    )

    app.post<{ Params: { id: string } }>('/api/machines/:id/workspaces/delete', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const m = await owned(me.id, req.params.id)
      const target = DeleteReq.parse(req.body)
      const msg = { t: 'workspace.delete', requestId: randomUUID(), ...target } as const
      answered(m.id, await ctx.hub.request(m.id, msg, 'workspace.delete.result', WORKSPACES_TIMEOUT_MS))
      await audit(ctx, {
        category: 'machine',
        actorUserId: me.id,
        groupId: null,
        action: 'workspace.delete',
        detail: { machineId: m.id, ...target },
      })
      return reply.status(204).send()
    })
  }
}
