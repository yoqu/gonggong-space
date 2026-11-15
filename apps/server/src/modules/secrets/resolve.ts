import { type RunSecret, SECRET_MIN_LENGTH, type SecretSource } from '@gonggong/protocol'
import { and, eq, inArray, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groups, machines, personalSecrets, runs, secrets } from '../../db/schema.js'
import { remember } from '../../lib/lru.js'
import { open } from '../../lib/seal.js'
import { maskKnown, redact, redactWith } from '../runs/redact.js'

export type SecretRow = typeof secrets.$inferSelect
type PersonalRow = typeof personalSecrets.$inferSelect
type Read = Pick<Db, 'select'>

export const RANK: Record<string, number> = { platform: 0, team: 1, group: 2 }

/** Definitions applying to the group, in any state: platform, its team and itself. */
export function visibleSecrets(db: Read, groupId: string) {
  const team = db.select({ id: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  return db
    .select()
    .from(secrets)
    .where(
      or(
        eq(secrets.scope, 'platform'),
        and(eq(secrets.scope, 'team'), inArray(secrets.teamId, team)),
        and(eq(secrets.scope, 'group'), eq(secrets.groupId, groupId)),
      ),
    )
}

/** Why a definition is not injected for the bot now; null when it may be. */
export function blocked(r: SecretRow, botId: string, now: Date) {
  if (!r.enabled) return '已停用'
  if (r.expiresAt && r.expiresAt <= now) return '已过期'
  if (r.botIds && !r.botIds.includes(botId)) return '未授权给本 Bot'
  return null
}

/** One per name among the applying definitions: a lower layer replaces a same-named one above it. */
function winners(rows: SecretRow[], botId: string, now: Date) {
  const won = new Map<string, SecretRow>()
  for (const r of [...rows].sort((a, b) => (RANK[a.scope] ?? 0) - (RANK[b.scope] ?? 0)))
    if (!blocked(r, botId, now)) won.set(r.name, r)
  return won
}

export type SecretState = {
  def: SecretRow
  /** The originator's own value of the name in the group's team. */
  mine: PersonalRow | null
  /** Whether `mine` may go to this bot's machine. */
  mineUsable: boolean
  value: string | null
  source: SecretSource | null
}

type RunRef = { groupId: string; botId: string; originUserId: string }

/**
 * What a run of the bot gets (plan 团队密钥-方案 §3): the originator's own value where the mode allows it and the
 * bot runs on their machine (or they allowed others' machines), else the definition's shared value.
 */
export async function resolveSecrets(db: Read, run: RunRef, now: Date) {
  const [rows, [where]] = await Promise.all([
    visibleSecrets(db, run.groupId),
    db
      .select({ teamId: groups.teamId, machineOwner: machines.ownerId })
      .from(groups)
      .leftJoin(bots, eq(bots.id, run.botId))
      .leftJoin(machines, eq(machines.id, bots.machineId))
      .where(eq(groups.id, run.groupId)),
  ])
  const won = winners(rows, run.botId, now)
  const names = [...won.keys()]
  const mine =
    where && names.length
      ? await db
          .select()
          .from(personalSecrets)
          .where(
            and(
              eq(personalSecrets.userId, run.originUserId),
              eq(personalSecrets.teamId, where.teamId),
              inArray(personalSecrets.name, names),
            ),
          )
      : []
  const ownMachine = where?.machineOwner === run.originUserId
  const states: SecretState[] = [...won.values()].map((def) => {
    const p = def.mode === 'shared' ? null : (mine.find((m) => m.name === def.name) ?? null)
    const mineUsable = !!p && (ownMachine || p.allowForeignMachines)
    if (p && mineUsable) return { def, mine: p, mineUsable, value: open(p.value), source: 'personal' }
    if (def.mode !== 'personal' && def.value)
      return { def, mine: p, mineUsable, value: open(def.value), source: def.scope as SecretSource }
    return { def, mine: p, mineUsable, value: null, source: null }
  })
  const injected = states.filter((s) => s.value !== null).sort((a, b) => (a.def.name < b.def.name ? -1 : 1))
  return {
    rows,
    states,
    env: Object.fromEntries(injected.map((s) => [s.def.name, s.value as string])),
    secrets: injected.map((s): RunSecret => ({ name: s.def.name, source: s.source as SecretSource })),
  }
}

/** Shorter values would mask common words. */
const maskable = (values: string[]) => values.filter((v) => v.length >= SECRET_MIN_LENGTH)

/** Every shared value the group can see, in any state. */
async function groupValues(db: Read, groupId: string) {
  return (await visibleSecrets(db, groupId)).flatMap((r) => (r.value ? [open(r.value)] : []))
}

/** Known values of a run: what it was injected plus every shared value its group can see (plan §6). */
async function runValues(db: Read, runId: string) {
  const [run] = await db
    .select({
      groupId: runs.groupId,
      originUserId: runs.originUserId,
      secrets: runs.secrets,
      teamId: groups.teamId,
    })
    .from(runs)
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(eq(runs.id, runId))
  if (!run) return []
  const own = run.secrets.filter((s) => s.source === 'personal').map((s) => s.name)
  const personal = own.length
    ? await db
        .select({ value: personalSecrets.value })
        .from(personalSecrets)
        .where(
          and(
            eq(personalSecrets.userId, run.originUserId),
            eq(personalSecrets.teamId, run.teamId),
            inArray(personalSecrets.name, own),
          ),
        )
    : []
  return maskable([...(await groupValues(db, run.groupId)), ...personal.map((p) => open(p.value))])
}

type Redactors = { redact: (text: string) => string; mask: (text: string) => string }
const cache = new Map<string, Promise<Redactors>>()
const CACHE_MAX = 1000

/**
 * The run's redactors, cached while it streams: `redact` for its output (known values and token formats), `mask`
 * for what its agent writes through tools (known values only).
 */
export function runRedactors(ctx: Ctx, runId: string): Promise<Redactors> {
  let r = cache.get(runId)
  if (!r) {
    r = runValues(ctx.db, runId).then((values) => ({ redact: redactWith(values), mask: maskKnown(values) }))
    remember(cache, runId, r, CACHE_MAX)
    r.catch(() => cache.get(runId) === r && cache.delete(runId))
  }
  return r
}

/** Output of the group not tied to a run (uploads, a live workspace diff). */
export async function groupRedactor(ctx: Ctx, groupId: string) {
  const values = maskable(await groupValues(ctx.db, groupId))
  return values.length ? redactWith(values) : redact
}

/** A run ended, or a value changed (no arg): cached redactors are rebuilt on next use. */
export function forgetRedactors(runId?: string) {
  if (runId) cache.delete(runId)
  else cache.clear()
}
