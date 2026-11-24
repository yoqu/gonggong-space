import { randomUUID } from 'node:crypto'
import {
  ConnectorCliReq,
  type ConnectorCliStarted,
  type ConnectorProbe,
  type DaemonToServer,
  type MachineDto,
  MachineMemberConnectReq,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { machines } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { machineDto } from '../bots/dto.js'
import { requireMember } from '../groups/service.js'
import { OFFLINE, ownMachine, relay, requireFeature } from '../machines/relay.js'
import { connectorDtos } from '../plugins/connectors.js'
import { groupPluginList, requirePluginsOn } from '../plugins/service.js'
import { remindExpiring, resolveCards } from './requests.js'
import { dropMachine, putProbe, setProbes } from './state.js'
import { cliSpec, syncConnectors } from './sync.js'
import { cliMachines, cliView } from './view.js'

/** Installing Node and the CLI, then waiting up to 10 minutes for the person to approve. */
const CONNECT_TIMEOUT_MS = 20 * 60_000
const ACTION_TIMEOUT_MS = 60_000

type Op = {
  userId: string
  machineId: string
  groupId: string
  teamId: string
  pluginId: string
  connector: string
}

/** Ready logins that were not ready in `before`: someone just connected. */
const newlyReady = (before: ConnectorProbe[], after: ConnectorProbe[]) =>
  after.some(
    (p) =>
      p.state === 'ready' &&
      !before.some((b) => b.connector === p.connector && b.profile === p.profile && b.state === 'ready'),
  )

/** CLI connectors run by the daemon (plan 连接器-体验升级方案 §5.4, §6). */
export function connectorCliRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    /** Running connects: their progress, links and end go to the person who started them only. */
    const ops = new Map<string, Op & { domains: string[]; done: Promise<unknown> }>()
    const pending = new Set<Promise<unknown>>()
    const track = (p: Promise<unknown>) => {
      const q = p.catch((err) => app.log.error(err)).finally(() => pending.delete(q))
      pending.add(q)
    }
    const onOnline = (machineId: string) => track(syncConnectors(ctx, machineId))
    const onOffline = (machineId: string) => void dropMachine(ctx, machineId)
    const onMessage = (machineId: string, msg: DaemonToServer) => {
      if (msg.t === 'connectors.update') {
        const before = setProbes(ctx, machineId, msg.probes)
        track(remindExpiring(ctx, machineId, msg.probes))
        if (newlyReady(before, msg.probes)) track(resolveCards(ctx, machineId))
        return
      }
      if (msg.t === 'connectors.result' && msg.probe) putProbe(ctx, machineId, msg.probe)
      if (msg.t !== 'connectors.progress' && msg.t !== 'connectors.auth') return
      const op = ops.get(msg.requestId)
      if (op?.machineId !== machineId) return
      ctx.bus.publish(
        [op.userId],
        msg.t === 'connectors.progress'
          ? { ...msg, t: 'connector.cli.progress' }
          : { ...msg, t: 'connector.cli.auth' },
      )
    }
    ctx.hub.on('online', onOnline)
    ctx.hub.on('offline', onOffline)
    ctx.hub.on('message', onMessage)
    app.addHook('onClose', async () => {
      ctx.hub.off('online', onOnline)
      ctx.hub.off('offline', onOffline)
      ctx.hub.off('message', onMessage)
      await Promise.all(pending)
    })

    const dtoOf = async (o: Pick<Op, 'groupId' | 'teamId' | 'userId' | 'pluginId'>) =>
      (await connectorDtos(ctx, o.groupId, o.teamId, o.userId)).find((c) => c.id === o.pluginId) ?? null

    const connect = (op: Op, requestId: string, msg: Parameters<typeof relay>[2], domains: string[]) => {
      const done = ctx.hub
        .request(op.machineId, msg, 'connectors.result', CONNECT_TIMEOUT_MS)
        .then(async (res) => {
          ops.delete(requestId)
          if (res?.ok)
            await resolveCards(ctx, op.machineId, { userId: op.userId, connector: op.connector, domains })
          const connector = await dtoOf(op)
          if (connector)
            ctx.bus.publish([op.userId], {
              t: 'connector.cli.result',
              requestId,
              ok: res?.ok ?? false,
              error: res ? res.error : t(ctx.hub.isOnline(op.machineId) ? '连接超时，请重试' : OFFLINE),
              probe: res?.probe ?? null,
              connector,
            })
        })
      ops.set(requestId, { ...op, domains, done })
      track(done)
    }

    app.post<{ Params: { id: string; pluginId: string } }>(
      '/api/groups/:id/connectors/:pluginId/cli',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        await requirePluginsOn(ctx.db)
        const body = ConnectorCliReq.parse(req.body)
        const found = (await groupPluginList(ctx.db, group.id)).find(
          (r) => r.plugin.id === req.params.pluginId,
        )
        const spec = found && cliSpec(found.plugin.name, found.version.manifest)
        if (!found || !spec) return fail('not_found', '连接器不存在')
        const view = cliView(ctx, await cliMachines(ctx, group.id, me.id), spec)
        const machineId = body.machineId ?? view.target
        const on = view.machines.find((m) => m.machineId === machineId)
        if (!on)
          return fail(
            'conflict',
            machineId
              ? '这台电脑不能用来连接'
              : '需要一台在线电脑：安装桌面端，或请 Bot 所在电脑的主人开启「允许群成员在本机连接」',
          )
        requireFeature(ctx, on.machineId, 'connectors')
        const op: Op = {
          userId: me.id,
          machineId: on.machineId,
          groupId: group.id,
          teamId: group.teamId,
          pluginId: found.plugin.id,
          connector: spec.connector,
        }
        const cmd = (action: 'detect' | 'connect' | 'cancel' | 'logout', requestId: string = randomUUID()) =>
          ({
            t: 'connectors.cmd',
            requestId,
            action,
            spec,
            profile: on.profile,
            domains: body.domains,
          }) as const
        if (body.action === 'connect') {
          const msg = cmd('connect')
          connect(op, msg.requestId, msg, body.domains)
          return reply
            .status(202)
            .send({ requestId: msg.requestId, machineId: on.machineId } satisfies ConnectorCliStarted)
        }
        if (body.action === 'cancel') {
          const running = [...ops.entries()].find(
            ([, o]) => o.userId === me.id && o.machineId === on.machineId && o.connector === spec.connector,
          )
          if (running) {
            ctx.hub.send(on.machineId, cmd('cancel', running[0]))
            await Promise.race([
              running[1].done,
              new Promise((r) => setTimeout(r, ACTION_TIMEOUT_MS).unref()),
            ])
          }
        } else await relay(ctx, on.machineId, cmd(body.action), 'connectors.result', ACTION_TIMEOUT_MS)
        return dtoOf(op)
      },
    )

    app.put<{ Params: { id: string } }>(
      '/api/machines/:id/member-connect',
      async (req): Promise<MachineDto> => {
        const me = await requireUser(ctx, req)
        const m = await ownMachine(ctx, me.id, req.params.id, '只有电脑主人可以设置')
        const { allow } = MachineMemberConnectReq.parse(req.body)
        const [row] = await ctx.db
          .update(machines)
          .set({ allowMemberConnect: allow })
          .where(eq(machines.id, m.id))
          .returning()
        const dto = machineDto(ctx, row!)
        ctx.bus.publish([m.ownerId], { t: 'machine.updated', machine: dto })
        await audit(ctx, {
          category: 'admin',
          actorUserId: me.id,
          action: 'machine.member_connect',
          detail: { machineId: m.id, allow },
        })
        return dto
      },
    )
  }
}
