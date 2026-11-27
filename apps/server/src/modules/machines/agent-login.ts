import { randomUUID } from 'node:crypto'
import {
  AgentKind,
  AgentLoginCancelReq,
  type AgentLoginStartedDto,
  AgentLoginStartReq,
  type DaemonToServer,
} from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { t } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { ownMachine } from './relay.js'

const LOGIN_OP_TTL_MS = 10 * 60_000

interface ActiveOp {
  opId: string
  machineId: string
  kind: AgentKind
  userId: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

const stores = new WeakMap<Ctx, Map<string, ActiveOp>>()

function opsOf(ctx: Ctx) {
  let ops = stores.get(ctx)
  if (!ops) {
    ops = new Map()
    stores.set(ctx, ops)
  }
  return ops
}

function removeOp(ops: Map<string, ActiveOp>, opId: string) {
  const op = ops.get(opId)
  if (!op) return undefined
  clearTimeout(op.timer)
  ops.delete(opId)
  return op
}

/** Relays daemon `agent.login.*` events privately to the machine owner and aborts active ops on offline. */
export function startAgentLoginRelay(ctx: Ctx) {
  const ops = opsOf(ctx)

  const onMessage = (machineId: string, msg: DaemonToServer) => {
    if (
      msg.t !== 'agent.login.methods' &&
      msg.t !== 'agent.login.auth' &&
      msg.t !== 'agent.login.progress' &&
      msg.t !== 'agent.login.result'
    )
      return
    const op = ops.get(msg.opId)
    if (!op || op.machineId !== machineId) return
    if (op.expiresAt <= ctx.now().getTime()) {
      removeOp(ops, op.opId)
      return
    }
    if (msg.t === 'agent.login.methods')
      ctx.bus.publish([op.userId], { ...msg, t: 'machine.agentLogin.methods', machineId })
    else if (msg.t === 'agent.login.auth')
      ctx.bus.publish([op.userId], { ...msg, t: 'machine.agentLogin.auth', machineId })
    else if (msg.t === 'agent.login.progress')
      ctx.bus.publish([op.userId], { ...msg, t: 'machine.agentLogin.progress', machineId })
    else {
      removeOp(ops, op.opId)
      ctx.bus.publish([op.userId], { ...msg, t: 'machine.agentLogin.result', machineId })
    }
  }

  const onOffline = (machineId: string) => {
    const nowMs = ctx.now().getTime()
    for (const op of [...ops.values()]) {
      if (op.machineId !== machineId) continue
      removeOp(ops, op.opId)
      if (op.expiresAt <= nowMs) continue
      ctx.bus.publish([op.userId], {
        t: 'machine.agentLogin.result',
        machineId,
        opId: op.opId,
        kind: op.kind,
        ok: false,
        error: t('电脑已离线，登录已中断'),
      })
    }
  }

  ctx.hub.on('message', onMessage)
  ctx.hub.on('offline', onOffline)
  return async () => {
    ctx.hub.off('message', onMessage)
    ctx.hub.off('offline', onOffline)
    for (const op of ops.values()) clearTimeout(op.timer)
    ops.clear()
  }
}

/** Owner-only HTTP routes to start and cancel daemon-driven interactive agent login sessions. */
export function agentLoginRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const ops = opsOf(ctx)

    app.post<{ Params: { id: string; kind: string } }>(
      '/api/machines/:id/agents/:kind/login',
      async (req): Promise<AgentLoginStartedDto> => {
        const user = await requireUser(ctx, req)
        const machine = await ownMachine(ctx, user.id, req.params.id, '只有电脑主人可以登录该电脑上的 Agent')
        const kind = AgentKind.parse(req.params.kind)
        const body = AgentLoginStartReq.parse(req.body ?? {})
        if (!ctx.hub.isOnline(machine.id)) return fail('invalid', '电脑当前离线，请先保持共工客户端在线')
        if (!ctx.hub.features(machine.id).includes('agent_login'))
          return fail('invalid', '当前电脑的共工客户端版本较旧，请升级客户端后重试，或在电脑终端手动登录')

        const nowMs = ctx.now().getTime()
        for (const existing of [...ops.values()]) {
          if (existing.machineId !== machine.id || existing.kind !== kind) continue
          removeOp(ops, existing.opId)
          if (existing.expiresAt > nowMs)
            ctx.hub.send(machine.id, {
              t: 'agent.login',
              op: 'cancel',
              opId: existing.opId,
              kind: existing.kind,
            })
        }

        const opId = randomUUID()
        const timer = setTimeout(() => {
          ops.delete(opId)
        }, LOGIN_OP_TTL_MS)
        timer.unref()
        ops.set(opId, {
          opId,
          machineId: machine.id,
          kind,
          userId: user.id,
          expiresAt: nowMs + LOGIN_OP_TTL_MS,
          timer,
        })

        ctx.hub.send(machine.id, {
          t: 'agent.login',
          op: 'start',
          opId,
          kind,
          ...(body.methodId && { methodId: body.methodId }),
          openBrowser: body.openBrowser ?? false,
        })
        return { opId, machineId: machine.id, kind }
      },
    )

    app.post<{ Params: { id: string; kind: string } }>(
      '/api/machines/:id/agents/:kind/login/cancel',
      async (req, reply) => {
        const user = await requireUser(ctx, req)
        const machine = await ownMachine(ctx, user.id, req.params.id, '只有电脑主人可以登录该电脑上的 Agent')
        const kind = AgentKind.parse(req.params.kind)
        const { opId } = AgentLoginCancelReq.parse(req.body)
        const op = ops.get(opId)
        if (op && op.machineId === machine.id && op.userId === user.id && op.kind === kind) {
          removeOp(ops, opId)
          ctx.hub.send(machine.id, { t: 'agent.login', op: 'cancel', opId, kind })
        }
        return reply.status(204).send()
      },
    )
  }
}
