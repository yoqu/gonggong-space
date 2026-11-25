import type { ConnectorCliState, ConnectorProbe } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import type { DaemonHub } from '../../daemon/hub.js'

/**
 * What each online machine's daemon last reported of its CLI connectors (plan 连接器-体验升级方案 §5.4: memory only,
 * rebuilt from the next connectors.update after hello), and the connectors.sync it was last sent.
 */
type MachineState = { probes: ConnectorProbe[]; synced?: string }
const all = new WeakMap<DaemonHub, Map<string, MachineState>>()

function machines(ctx: Pick<Ctx, 'hub'>) {
  const m = all.get(ctx.hub) ?? new Map<string, MachineState>()
  all.set(ctx.hub, m)
  return m
}
function machine(ctx: Pick<Ctx, 'hub'>, machineId: string) {
  const ms = machines(ctx)
  const s = ms.get(machineId) ?? { probes: [] }
  ms.set(machineId, s)
  return s
}

export const probesOf = (ctx: Pick<Ctx, 'hub'>, machineId: string) =>
  machines(ctx).get(machineId)?.probes ?? []

export const dropMachine = (ctx: Pick<Ctx, 'hub'>, machineId: string) => machines(ctx).delete(machineId)

/** Replaces the machine's probes (connectors.update); returns the ones it had. */
export function setProbes(ctx: Pick<Ctx, 'hub'>, machineId: string, probes: ConnectorProbe[]) {
  const s = machine(ctx, machineId)
  const before = s.probes
  s.probes = probes
  return before
}

/** One profile's probe after an action (connectors.result); returns the one it replaced. */
export function putProbe(ctx: Pick<Ctx, 'hub'>, machineId: string, probe: ConnectorProbe) {
  const s = machine(ctx, machineId)
  const same = (p: ConnectorProbe) => p.connector === probe.connector && p.profile === probe.profile
  const before = s.probes.find(same)
  s.probes = [...s.probes.filter((p) => !same(p)), probe]
  return before
}

/** Whether `json` differs from the connectors.sync last sent to the machine (and remembers it). */
export function syncChanged(ctx: Pick<Ctx, 'hub'>, machineId: string, json: string) {
  const s = machine(ctx, machineId)
  if (s.synced === json) return false
  s.synced = json
  return true
}

/**
 * The machine's CLI login for `connector`: always the owner's own (`default`) profile. Whoever @s a bot on the machine
 * uses it; nobody else logs in there (plan 连接器-机主授权).
 */
export const ownerProbe = (probes: ConnectorProbe[], connector: string) =>
  probes.find((x) => x.connector === connector && x.profile === 'default')

/** A login the daemon has not reported reads as not installed yet. */
export const stateOf = (probe: ConnectorProbe | undefined): ConnectorCliState =>
  probe?.state ?? 'not_installed'

/** Best first: ready on any machine wins. */
export const STATE_RANK: ConnectorCliState[] = [
  'ready',
  'needs_login',
  'needs_init',
  'not_installed',
  'error',
]
