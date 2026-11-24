import {
  type ConnectorCliState,
  type ConnectorDriver,
  type ConnectorProbe,
  type ConnectorProfile,
  memberProfile,
} from '@gonggong/protocol'
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

export type Person = { id: string; name: string; feishuUserId: string | null }

/** Whether the probe's account is the person, by Feishu user_id; null when either side lacks one. */
const accountIs = (probe: ConnectorProbe, p: Person) =>
  probe.feishuUserId && p.feishuUserId ? probe.feishuUserId === p.feishuUserId : null

export type ProfileOn = {
  profile: ConnectorProfile
  probe: ConnectorProbe | undefined
  verified: boolean | null
}

/**
 * The profile `p` uses for `connector` on a machine `ownerId` owns (§5.3 机主复用): the owner keeps to `default` unless
 * it is logged in as someone else (by Feishu user_id, else by name, unverified); everyone else to their `gg-<userId>`.
 */
export function profileOn(
  probes: ConnectorProbe[],
  connector: string,
  ownerId: string,
  p: Person,
): ProfileOn {
  if (ownerId === p.id) {
    const d = probes.find((x) => x.connector === connector && x.profile === 'default')
    if (d?.state !== 'ready') return { profile: 'default', probe: d, verified: null }
    const verified = accountIs(d, p)
    if (verified === true || (verified === null && d.account === p.name))
      return { profile: 'default', probe: d, verified }
  }
  const profile = memberProfile(p.id)
  const probe = probes.find((x) => x.connector === connector && x.profile === profile)
  return { profile, probe, verified: probe?.state === 'ready' ? accountIs(probe, p) : null }
}

/** A profile the daemon has not reported reads as its CLI would: not installed, or still to set up. */
export function stateOf(
  probes: ConnectorProbe[],
  connector: string,
  driver: ConnectorDriver,
  probe: ConnectorProbe | undefined,
): ConnectorCliState {
  if (probe) return probe.state
  const d = probes.find((x) => x.connector === connector && x.profile === 'default')
  if (!d || d.state === 'not_installed') return 'not_installed'
  return driver === 'lark-cli' ? 'needs_init' : 'needs_login'
}

/** Best first: ready on any machine wins. */
export const STATE_RANK: ConnectorCliState[] = [
  'ready',
  'needs_login',
  'needs_init',
  'not_installed',
  'error',
]
