import type {
  ConnectorCliView,
  ConnectorDriver,
  ConnectorDto,
  ConnectorMachineView,
  ConnectorProbe,
  ConnectorSpec,
  ConnectorStatus,
} from '@gonggong/protocol'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, machines } from '../../db/schema.js'
import { ownerProbe, probesOf, STATE_RANK, stateOf } from './state.js'

type Read = Pick<Db, 'select'>

/**
 * The online machines running the group's bots with `connectors` (plan 连接器-机主授权): each bot uses its machine
 * owner's login, so only the owner connects there; the caller's own machines first. `featured`: there is one (else
 * the old in-chat connect stays).
 */
export async function cliMachines(ctx: Ctx, groupId: string, userId: string) {
  const groupBotRows = await ctx.db
    .select({ id: bots.id, machineId: bots.machineId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(and(eq(groupBots.groupId, groupId), isNull(bots.deletedAt), isNotNull(bots.machineId)))
  const botMachines = [...new Set(groupBotRows.map((b) => b.machineId!))]
  const rows = botMachines.length
    ? await ctx.db
        .select()
        .from(machines)
        .where(and(isNull(machines.revokedAt), inArray(machines.id, botMachines)))
    : []
  const usable = rows
    .filter((m) => ctx.hub.isOnline(m.id) && ctx.hub.features(m.id).includes('connectors'))
    .map((m) => ({
      id: m.id,
      name: m.label ?? m.name,
      own: m.ownerId === userId,
      botIds: groupBotRows.filter((b) => b.machineId === m.id).map((b) => b.id),
    }))
    .sort((a, b) => Number(b.own) - Number(a.own))
  return { featured: usable.length > 0, usable }
}
export type CliMachines = Awaited<ReturnType<typeof cliMachines>>

/** One CLI connector over the group's bot machines: everyone sees its state, only an owner connects (`target`). */
export function cliView(ctx: Ctx, c: CliMachines, spec: ConnectorSpec): ConnectorCliView {
  const views = c.usable.map((m): ConnectorMachineView => {
    const probe = ownerProbe(probesOf(ctx, m.id), spec.connector)
    const state = stateOf(probe)
    return {
      machineId: m.id,
      machineName: m.name,
      own: m.own,
      profile: 'default',
      state,
      account: state === 'ready' ? (probe?.account ?? null) : null,
      verified: null,
      botIds: m.botIds,
    }
  })
  const best = views.map((v) => v.state).sort((a, b) => STATE_RANK.indexOf(a) - STATE_RANK.indexOf(b))[0]
  const own = views.filter((v) => v.own)
  return {
    state: best ?? 'no_machine',
    machines: views,
    target: (own.find((v) => v.state !== 'ready') ?? own[0])?.machineId ?? null,
    readyBotIds: views.filter((v) => v.state === 'ready').flatMap((v) => v.botIds),
  }
}

/** What old clients read of a CLI connector: its legacy status and account. */
export function legacyStatus(view: ConnectorCliView): Pick<ConnectorDto, 'status' | 'account'> {
  const status: ConnectorStatus =
    view.state === 'ready'
      ? 'ok'
      : view.state === 'needs_login'
        ? 'expired'
        : view.state === 'error'
          ? 'error'
          : 'unconnected'
  return { status, account: view.machines.find((m) => m.state === 'ready')?.account ?? null }
}

/** The machine owner's login for each CLI connector a run gets (RunStart.cliProfiles), whoever started it. */
export function runCli(
  connected: { name: string; driver: ConnectorDriver | null }[],
  probes: ConnectorProbe[],
) {
  const out = new Map<string, { driver: ConnectorDriver; profile: 'default'; account: string | null }>()
  for (const c of connected) {
    if (!c.driver) continue
    const probe = ownerProbe(probes, c.name)
    out.set(c.name, {
      driver: c.driver,
      profile: 'default',
      account: probe?.state === 'ready' ? (probe.account ?? '') : null,
    })
  }
  return out
}
