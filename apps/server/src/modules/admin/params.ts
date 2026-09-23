import { DEFAULT_OFFLINE_WAIT_MIN, MAX_ATTACHMENTS, MAX_QUESTIONS, SystemParams } from '@aiws/protocol'
import { inArray, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { systemParams } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'

/** Spec §10 defaults. */
export const PARAM_DEFAULTS: SystemParams = {
  approvalTimeoutMin: 30,
  chainMaxHops: 3,
  offlineWaitMin: DEFAULT_OFFLINE_WAIT_MIN,
  writerDisconnectReleaseSec: null,
  forceSyncMaxLatencyMs: 120,
  forceSyncMinBandwidthMbps: 10,
  sessionReplayCount: 50,
  runRetentionDays: 30,
  attachmentMaxMb: 50,
  attachmentsPerMessage: MAX_ATTACHMENTS,
  questionsPerCard: MAX_QUESTIONS,
  heartbeatSec: 15,
  offlineMisses: 3,
  botConcurrencyDefault: 2,
  backupRetentionDays: 7,
  archiveRetentionDays: 30,
}

const KEYS = Object.keys(PARAM_DEFAULTS) as (keyof SystemParams)[]

/**
 * Each param is one `system_params` row keyed by its name, read on use so every module sees a change at once.
 * A stored value that no longer validates falls back to its default.
 */
export async function sysParams(db: Pick<Db, 'select'>): Promise<SystemParams> {
  const rows = await db.select().from(systemParams).where(inArray(systemParams.key, KEYS))
  const out: Record<string, unknown> = { ...PARAM_DEFAULTS }
  for (const r of rows) {
    const key = r.key as keyof SystemParams
    if (SystemParams.shape[key].safeParse(r.value).success) out[key] = r.value
  }
  return out as SystemParams
}

/** Saves the changed params and audits them as `{ key: [old, new] }`. */
export async function saveSysParams(ctx: Ctx, patch: Partial<SystemParams>, actorUserId: string) {
  const current = await sysParams(ctx.db)
  const next = SystemParams.parse({ ...current, ...patch })
  const changes = Object.fromEntries(
    KEYS.filter((k) => k in patch && next[k] !== current[k]).map((k) => [k, [current[k], next[k]]]),
  )
  if (!Object.keys(changes).length) return current
  await ctx.db.transaction(async (tx) => {
    for (const key of Object.keys(changes) as (keyof SystemParams)[]) {
      // Drizzle drops a plain null for jsonb; 待定 must be stored as JSON null.
      const value = sql`${JSON.stringify(next[key])}::jsonb`
      await tx
        .insert(systemParams)
        .values({ key, value })
        .onConflictDoUpdate({ target: systemParams.key, set: { value } })
    }
  })
  await audit(ctx, { category: 'admin', actorUserId, action: 'params.update', detail: { changes } })
  return next
}
