import { createHash } from 'node:crypto'
import {
  SYNC_FILES_MAX,
  SYNC_VERSION_MAX_BYTES,
  type SyncApplied,
  type SyncChange,
  type SyncEntry,
  type SyncState,
  type SyncSubmit,
  type SyncSubmitResult,
  type SyncVersionTag,
  syncRootText,
} from '@gonggong/protocol'
import { and, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupBots,
  groups,
  syncChanges,
  syncConflicts,
  syncHead,
  syncReplicas,
  syncVersions,
} from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { blobSize } from './blobs.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Q = Db | Tx
type Head = Map<string, { hash: string; exec: boolean }>
/** What a refused submit leaves on its replica, for a later sync.state `held` (sync_replicas.lastConflict). */
interface LastConflict {
  submitId: string
  baseVersion: number
  headVersion: number
  changes: SyncChange[]
  conflicts: SyncEntry[]
}

const TAG: Record<SyncSubmit['kind'], SyncVersionTag | null> = {
  init: 'init',
  run: null,
  local: 'local',
  interrupted: 'interrupted',
  merge: 'merge',
}
/** Rows per insert, well under PostgreSQL's 65535 bind parameters. */
const CHUNK = 5000

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const chunks = <T>(xs: T[]) =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

export async function headVersion(db: Q, groupId: string) {
  const [row] = await db
    .select({ version: syncVersions.version })
    .from(syncVersions)
    .where(eq(syncVersions.groupId, groupId))
    .orderBy(desc(syncVersions.version))
    .limit(1)
  return row?.version ?? 0
}

/** Root hash of `version`; version 0 is the empty tree. */
async function rootHashOf(db: Q, groupId: string, version: number) {
  if (version === 0) return sha256('')
  const [row] = await db
    .select({ rootHash: syncVersions.rootHash })
    .from(syncVersions)
    .where(and(eq(syncVersions.groupId, groupId), eq(syncVersions.version, version)))
  return row?.rootHash
}

/**
 * The replica (group × bot) if `machineId` hosts it in a force group with a managed workspace (F2). It takes part in
 * versions unless reported dirty at the mode switch; reports (applied, state) are taken either way.
 */
async function replica(db: Q, machineId: string, groupId: string, botId: string) {
  const [row] = await db
    .select({ ownerId: bots.ownerId, issue: syncReplicas.issue })
    .from(groupBots)
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .leftJoin(
      syncReplicas,
      and(eq(syncReplicas.groupId, groupBots.groupId), eq(syncReplicas.botId, groupBots.botId)),
    )
    .where(
      and(
        eq(groupBots.groupId, groupId),
        eq(groupBots.botId, botId),
        isNull(groupBots.removedAt),
        eq(groupBots.workspaceKind, 'managed'),
        eq(groups.mode, 'force'),
        isNull(groups.archivedAt),
        eq(bots.machineId, machineId),
        isNull(bots.deletedAt),
      ),
    )
  return row
}

/** Machines to send sync.available to: those hosting a participating replica other than `exceptBotId`. */
export async function replicaMachines(db: Q, groupId: string, exceptBotId: string) {
  const rows = await db
    .selectDistinct({ machineId: bots.machineId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .leftJoin(
      syncReplicas,
      and(eq(syncReplicas.groupId, groupBots.groupId), eq(syncReplicas.botId, groupBots.botId)),
    )
    .where(
      and(
        eq(groupBots.groupId, groupId),
        isNull(groupBots.removedAt),
        eq(groupBots.workspaceKind, 'managed'),
        isNull(bots.deletedAt),
        sql`${bots.id} <> ${exceptBotId}`,
        sql`${syncReplicas.issue} is distinct from 'dirty'`,
      ),
    )
  return rows.flatMap((r) => (r.machineId ? [r.machineId] : []))
}

async function loadHead(db: Q, groupId: string): Promise<Head> {
  const rows = await db.select().from(syncHead).where(eq(syncHead.groupId, groupId))
  return new Map(rows.map((r) => [r.path, { hash: r.hash, exec: r.exec }]))
}

const ancestors = (path: string) =>
  path
    .split('/')
    .slice(0, -1)
    .map((_, i, a) => a.slice(0, i + 1).join('/'))

/**
 * §3.2, per path: an add / modify passes when the head still holds its base (null = absent) or already holds the new
 * content; a delete when the head holds its base or lacks the path. A file must not sit where the resulting tree has a
 * directory or the other way round. Returns the conflicting paths and the changes that alter the head.
 */
function compareAndSwap(head: Head, changes: SyncChange[]) {
  const conflicts: string[] = []
  const effective: SyncChange[] = []
  for (const c of changes) {
    const cur = head.get(c.path)
    const curHash = cur?.hash ?? null
    if (c.hash === null) {
      if (curHash !== null && curHash !== c.baseHash) conflicts.push(c.path)
      else if (cur) effective.push(c)
    } else if (curHash !== c.baseHash && curHash !== c.hash) conflicts.push(c.path)
    else if (curHash !== c.hash || cur?.exec !== c.exec) effective.push(c)
  }
  if (conflicts.length) return { conflicts, effective }
  const next = applyTo(head, effective)
  const dirs = new Set([...next.keys()].flatMap(ancestors))
  for (const c of effective)
    if (
      c.hash !== null &&
      !head.has(c.path) &&
      (dirs.has(c.path) || ancestors(c.path).some((a) => next.has(a)))
    )
      conflicts.push(c.path)
  return { conflicts, effective, next }
}

function applyTo(head: Head, changes: SyncChange[]): Head {
  const next = new Map(head)
  for (const c of changes)
    if (c.hash === null) next.delete(c.path)
    else next.set(c.path, { hash: c.hash, exec: c.exec })
  return next
}

const entries = (head: Head): SyncEntry[] => [...head].map(([path, e]) => ({ path, ...e }))

export async function submitSync(ctx: Ctx, machineId: string, msg: SyncSubmit): Promise<SyncSubmitResult> {
  return (await submitTx(ctx, machineId, msg)).result
}

/**
 * Takes a replica's changes as the group's next version when none conflicts with the head (F6), atomically and
 * serialized per group. A submit that changes nothing answers the current head (an empty v1 when there is none yet).
 * Resubmitting an accepted submitId answers its version again. `version` is set when a new version was written.
 */
export async function submitTx(ctx: Ctx, machineId: string, msg: SyncSubmit) {
  return ctx.db.transaction(async (tx): Promise<{ result: SyncSubmitResult; version?: number }> => {
    await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, msg.groupId)).for('update')
    const self = await replica(tx, machineId, msg.groupId, msg.botId)
    if (!self || self.issue === 'dirty')
      return { result: { outcome: 'rejected', reason: 'not_participating' } }
    const [done] = await tx
      .select({ version: syncVersions.version })
      .from(syncVersions)
      .where(and(eq(syncVersions.groupId, msg.groupId), eq(syncVersions.submitId, msg.submitId)))
    if (done) return { result: { outcome: 'accepted', version: done.version } }

    const current = await headVersion(tx, msg.groupId)
    const head = await loadHead(tx, msg.groupId)
    const { conflicts, effective, next } = compareAndSwap(head, msg.changes)
    if (conflicts.length || !next) {
      const result = {
        outcome: 'conflict' as const,
        headVersion: current,
        conflicts: conflicts.map((path) => ({
          path,
          hash: head.get(path)?.hash ?? null,
          exec: head.get(path)?.exec ?? false,
        })),
      }
      const lastConflict: LastConflict = {
        submitId: msg.submitId,
        baseVersion: msg.baseVersion,
        headVersion: current,
        changes: msg.changes,
        conflicts: result.conflicts,
      }
      await upsertReplica(tx, msg.groupId, msg.botId, { lastConflict })
      return { result }
    }
    if (!effective.length && current > 0) return { result: { outcome: 'accepted', version: current } }

    let bytes = 0
    for (const hash of new Set(effective.flatMap((c) => (c.hash ? [c.hash] : [])))) {
      const size = await blobSize(msg.groupId, hash)
      if (size === null) return { result: { outcome: 'rejected', reason: 'blobs_missing' } }
      bytes += size
    }
    if (bytes > SYNC_VERSION_MAX_BYTES) return { result: { outcome: 'rejected', reason: 'too_large' } }

    const version = current + 1
    const tag = TAG[msg.kind]
    await tx.insert(syncVersions).values({
      groupId: msg.groupId,
      version,
      submitId: msg.submitId,
      authorKind: msg.kind === 'local' ? 'user' : 'bot',
      authorId: msg.kind === 'local' ? self.ownerId : msg.botId,
      runId: msg.runId,
      tags: [...(tag ? [tag] : []), ...(msg.merged ? (['auto_merge'] as const) : [])],
      files: effective.length,
      rootHash: sha256(syncRootText(entries(next))),
    })
    for (const part of chunks(effective))
      await tx
        .insert(syncChanges)
        .values(
          part.map((c) => ({ groupId: msg.groupId, version, path: c.path, hash: c.hash, exec: c.exec })),
        )
    const gone = effective.filter((c) => c.hash === null).map((c) => c.path)
    for (const part of chunks(gone))
      await tx.delete(syncHead).where(and(eq(syncHead.groupId, msg.groupId), inArray(syncHead.path, part)))
    const live = effective.flatMap((c) =>
      c.hash ? [{ groupId: msg.groupId, path: c.path, hash: c.hash, exec: c.exec }] : [],
    )
    for (const part of chunks(live))
      await tx
        .insert(syncHead)
        .values(part)
        .onConflictDoUpdate({
          target: [syncHead.groupId, syncHead.path],
          set: { hash: sql`excluded.hash`, exec: sql`excluded.exec` },
        })
    await upsertReplica(tx, msg.groupId, msg.botId, { lastConflict: null })
    return { result: { outcome: 'accepted', version }, version }
  })
}

async function upsertReplica(
  db: Q,
  groupId: string,
  botId: string,
  set: Partial<typeof syncReplicas.$inferInsert>,
) {
  const values = { ...set, updatedAt: new Date() }
  await db
    .insert(syncReplicas)
    .values({ groupId, botId, ...values })
    .onConflictDoUpdate({ target: [syncReplicas.groupId, syncReplicas.botId], set: values })
}

/** The latest entry of each path changed in (from, head]; from = 0 lists the live head. */
export async function changesSince(ctx: Ctx, groupId: string, from: number) {
  return ctx.db.transaction(
    async (tx) => {
      const head = await headVersion(tx, groupId)
      if (from === 0) {
        const rows = await tx
          .select({ path: syncHead.path, hash: syncHead.hash, exec: syncHead.exec })
          .from(syncHead)
          .where(eq(syncHead.groupId, groupId))
          .orderBy(sql`${syncHead.path} collate "C"`)
        return { headVersion: head, entries: rows as SyncEntry[] }
      }
      const rows = await tx
        .selectDistinctOn([syncChanges.path], {
          path: syncChanges.path,
          hash: syncChanges.hash,
          exec: syncChanges.exec,
        })
        .from(syncChanges)
        .where(
          and(
            eq(syncChanges.groupId, groupId),
            gt(syncChanges.version, from),
            lte(syncChanges.version, head),
          ),
        )
        .orderBy(syncChanges.path, desc(syncChanges.version))
      const bytes = (p: string) => Buffer.from(p)
      rows.sort((a, b) => Buffer.compare(bytes(a.path), bytes(b.path)))
      return { headVersion: head, entries: rows }
    },
    { isolationLevel: 'repeatable read' },
  )
}

/**
 * The replica now holds `version`: clean when its root hash matches that version's (F14), which settles its issue and
 * open conflicts; otherwise it is flagged. Returns false when the report was not the replica's to make.
 */
export async function recordApplied(ctx: Ctx, machineId: string, msg: z.infer<typeof SyncApplied>) {
  return ctx.db.transaction(async (tx) => {
    if (!(await replica(tx, machineId, msg.groupId, msg.botId))) return false
    const expected = await rootHashOf(tx, msg.groupId, msg.version)
    const now = new Date()
    const base = { version: msg.version, rootHash: msg.rootHash, syncedAt: now, files: [], total: 0 }
    if (expected === msg.rootHash) {
      await upsertReplica(tx, msg.groupId, msg.botId, {
        ...base,
        issue: null,
        reason: null,
        lastConflict: null,
      })
      await tx
        .update(syncConflicts)
        .set({ resolvedAt: now })
        .where(
          and(
            eq(syncConflicts.groupId, msg.groupId),
            eq(syncConflicts.botId, msg.botId),
            isNull(syncConflicts.resolvedAt),
          ),
        )
    } else
      await upsertReplica(tx, msg.groupId, msg.botId, {
        ...base,
        issue: 'error',
        reason: t('副本内容与 v{version} 不一致', { version: msg.version }),
      })
    return true
  })
}

/** Stores why a replica stopped taking versions; `held` opens a conflict from its last refused submit (F11). */
export async function recordState(ctx: Ctx, machineId: string, msg: z.infer<typeof SyncState>) {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ lastConflict: syncReplicas.lastConflict })
      .from(syncReplicas)
      .where(and(eq(syncReplicas.groupId, msg.groupId), eq(syncReplicas.botId, msg.botId)))
    if (!(await replica(tx, machineId, msg.groupId, msg.botId))) return false
    await upsertReplica(tx, msg.groupId, msg.botId, {
      issue: msg.state,
      files: msg.files.slice(0, SYNC_FILES_MAX),
      total: msg.total,
      reason: msg.reason,
    })
    const last = row?.lastConflict as LastConflict | null | undefined
    if (msg.state === 'held' && last)
      await tx
        .insert(syncConflicts)
        .values({ groupId: msg.groupId, botId: msg.botId, ...last })
        .onConflictDoNothing({ target: syncConflicts.submitId })
    return true
  })
}
