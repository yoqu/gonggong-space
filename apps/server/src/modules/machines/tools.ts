import { randomUUID } from 'node:crypto'
import {
  type DaemonToServer,
  InstallToolReq,
  ToolKind,
  type ToolOpDto,
  type ToolsResult,
  ToolsSettings,
  type ToolsStateDto,
} from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { t } from '../../i18n/index.js'
import { audit } from '../../lib/audit.js'
import { requireUser } from '../auth/session.js'
import { OFFLINE, ownMachine, quietErrors, relay, requireFeature } from './relay.js'

/** The latest-version checks behind a status may each wait on a slow mirror. */
const STATUS_TIMEOUT_MS = 90_000
const OP_TIMEOUT_MS = 30 * 60_000

const ToolOp = z.object({ kind: ToolKind, op: z.enum(['install', 'upgrade']) })
const state = ({ tools, settings }: ToolsResult): ToolsStateDto => ({ tools, settings })

/** Node / Claude Code / Codex on a machine (design §4.1), driven live through its daemon. */
export function toolRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    quietErrors(app)
    // Install / upgrade output goes to the machine owner as it comes.
    const ops = new Map<string, { machineId: string; ownerId: string }>()
    const onMessage = (machineId: string, msg: DaemonToServer) => {
      if (msg.t !== 'tools.progress') return
      const op = ops.get(msg.requestId)
      if (op?.machineId === machineId)
        ctx.bus.publish([op.ownerId], {
          t: 'machine.tools.progress',
          machineId,
          opId: msg.requestId,
          line: msg.line,
        })
    }
    ctx.hub.on('message', onMessage)
    app.addHook('onClose', async () => void ctx.hub.off('message', onMessage))

    app.get<{ Params: { id: string } }>('/api/machines/:id/tools', async (req): Promise<ToolsStateDto> => {
      const me = await requireUser(ctx, req)
      const m = await ownMachine(ctx, me.id, req.params.id)
      requireFeature(ctx, m.id, 'tools')
      const msg = { t: 'tools.cmd', requestId: randomUUID(), action: 'status' } as const
      return state(await relay(ctx, m.id, msg, 'tools.result', STATUS_TIMEOUT_MS))
    })

    app.put<{ Params: { id: string } }>(
      '/api/machines/:id/tools/settings',
      async (req): Promise<ToolsStateDto> => {
        const me = await requireUser(ctx, req)
        const m = await ownMachine(ctx, me.id, req.params.id)
        const { mirror } = ToolsSettings.parse(req.body)
        requireFeature(ctx, m.id, 'tools')
        const msg = { t: 'tools.cmd', requestId: randomUUID(), action: 'settings', mirror } as const
        const res = await relay(ctx, m.id, msg, 'tools.result', STATUS_TIMEOUT_MS)
        await audit(ctx, {
          category: 'admin',
          actorUserId: me.id,
          action: 'machine.tools.settings',
          detail: { machineId: m.id },
        })
        return state(res)
      },
    )

    app.post<{ Params: { id: string; kind: string; op: string } }>(
      '/api/machines/:id/tools/:kind/:op',
      async (req): Promise<ToolOpDto> => {
        const me = await requireUser(ctx, req)
        const m = await ownMachine(ctx, me.id, req.params.id)
        const { kind, op } = ToolOp.parse(req.params)
        const { version } = op === 'install' ? InstallToolReq.parse(req.body ?? {}) : { version: undefined }
        requireFeature(ctx, m.id, 'tools')
        const opId = randomUUID()
        ops.set(opId, { machineId: m.id, ownerId: m.ownerId })
        const msg = {
          t: 'tools.cmd',
          requestId: opId,
          action: op,
          kind,
          ...(version && { version }),
        } as const
        void ctx.hub
          .request(m.id, msg, 'tools.result', OP_TIMEOUT_MS)
          .then(async (res) => {
            ops.delete(opId)
            const error = res ? res.error : t(ctx.hub.isOnline(m.id) ? '操作超时，请稍后查看状态' : OFFLINE)
            ctx.bus.publish([m.ownerId], {
              t: 'machine.tools.result',
              machineId: m.id,
              opId,
              ok: res?.ok ?? false,
              error,
              state: res ? state(res) : null,
            })
            if (res?.ok)
              await audit(ctx, {
                category: 'admin',
                actorUserId: me.id,
                action: `machine.tools.${op}`,
                detail: { machineId: m.id, kind },
              })
          })
          .catch((err) => app.log.error(err))
        return { opId }
      },
    )
  }
}
