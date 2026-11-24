import type {
  ConnectorCliView,
  ConnectorDriver,
  ConnectorDto,
  ConnectorMachineView,
  ConnectorProbe,
  ConnectorProfile,
  ConnectorSpec,
  ConnectorStatus,
} from '@gonggong/protocol'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, feishuIdentities, groupBots, machines, users } from '../../db/schema.js'
import { type Person, probesOf, profileOn, STATE_RANK, stateOf } from './state.js'

type Read = Pick<Db, 'select'>

export async function personOf(db: Read, userId: string): Promise<Person> {
  const [row] = await db
    .select({ name: users.name, feishuUserId: feishuIdentities.feishuUserId })
    .from(users)
    .leftJoin(feishuIdentities, eq(feishuIdentities.userId, users.id))
    .where(eq(users.id, userId))
  return { id: userId, name: row?.name ?? '', feishuUserId: row?.feishuUserId ?? null }
}

/**
 * The online machines `userId` could use the group's CLI connectors on (§5.4): theirs, and the ones running the group's
 * bots whose owner allows members to connect, in the order 连接 picks them. `featured`: some machine of theirs or of
 * the group's bots runs a daemon with `connectors` (else the old in-chat connect stays).
 */
export async function cliMachines(ctx: Ctx, groupId: string, userId: string) {
  const groupBotRows = await ctx.db
    .select({ id: bots.id, machineId: bots.machineId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(and(eq(groupBots.groupId, groupId), isNull(bots.deletedAt), isNotNull(bots.machineId)))
  const botMachines = [...new Set(groupBotRows.map((b) => b.machineId!))]
  const [rows, person] = await Promise.all([
    ctx.db
      .select()
      .from(machines)
      .where(
        and(
          isNull(machines.revokedAt),
          or(
            eq(machines.ownerId, userId),
            botMachines.length ? inArray(machines.id, botMachines) : undefined,
          ),
        ),
      ),
    personOf(ctx.db, userId),
  ])
  const featured = rows.filter((m) => ctx.hub.isOnline(m.id) && ctx.hub.features(m.id).includes('connectors'))
  const rank = (m: { own: boolean; botIds: string[] }) => (m.own ? (m.botIds.length ? 0 : 1) : 2)
  const usable = featured
    .filter((m) => m.ownerId === userId || m.allowMemberConnect)
    .map((m) => ({
      id: m.id,
      name: m.label ?? m.name,
      ownerId: m.ownerId,
      own: m.ownerId === userId,
      botIds: groupBotRows.filter((b) => b.machineId === m.id).map((b) => b.id),
    }))
    .sort((a, b) => rank(a) - rank(b))
  return { person, featured: featured.length > 0, usable }
}
export type CliMachines = Awaited<ReturnType<typeof cliMachines>>

/** The caller's view of one CLI connector over the machines they could use. */
export function cliView(ctx: Ctx, c: CliMachines, spec: ConnectorSpec): ConnectorCliView {
  const views = c.usable.map((m): ConnectorMachineView => {
    const probes = probesOf(ctx, m.id)
    const on = profileOn(probes, spec.connector, m.ownerId, c.person)
    const state = stateOf(probes, spec.connector, spec.driver, on.probe)
    return {
      machineId: m.id,
      machineName: m.name,
      own: m.own,
      profile: on.profile,
      state,
      account: state === 'ready' ? (on.probe?.account ?? null) : null,
      verified: on.verified,
      botIds: m.botIds,
    }
  })
  const best = views.map((v) => v.state).sort((a, b) => STATE_RANK.indexOf(a) - STATE_RANK.indexOf(b))[0]
  return {
    state: best ?? 'no_machine',
    machines: views,
    target: views[0]?.machineId ?? null,
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

/**
 * The originator's profile for each CLI connector a run gets on a daemon with `connectors` (RunStart.cliProfiles), and
 * who it is logged in as (null: not connected). Always their own: never the machine owner's login for someone else.
 */
export async function runCli(
  db: Read,
  machineId: string,
  originUserId: string,
  connected: { name: string; driver: ConnectorDriver | null }[],
  probes: ConnectorProbe[],
) {
  const out = new Map<
    string,
    { driver: ConnectorDriver; profile: ConnectorProfile; account: string | null }
  >()
  if (!connected.some((c) => c.driver)) return out
  const [[m], person] = await Promise.all([
    db.select({ ownerId: machines.ownerId }).from(machines).where(eq(machines.id, machineId)),
    personOf(db, originUserId),
  ])
  for (const c of connected) {
    if (!c.driver || !m) continue
    const on = profileOn(probes, c.name, m.ownerId, person)
    out.set(c.name, {
      driver: c.driver,
      profile: on.profile,
      account: on.probe?.state === 'ready' ? (on.probe.account ?? '') : null,
    })
  }
  return out
}
