import { createHash } from 'node:crypto'
import {
  type RunSyncStart,
  SYNC_CHANGED_MAX,
  SYNC_FILES_MAX,
  SYNC_VERSION_MAX_BYTES,
  type SyncApplied,
  type SyncChange,
  type SyncDecision,
  type SyncEntry,
  type SyncState,
  type SyncSubmit,
  type SyncSubmitResult,
  type SyncVersionTag,
  syncRootText,
} from '@gonggong/protocol'
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupBots,
  groups,
  runs,
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

/**
 * run.start's `sync` for a bot's turn in a force group with a joined managed replica, else null (F9, F20). `lastVersion` is
 * the version the bot's previous turn in the group ended at (its run.done: accepted / unchanged), so `changed` lists
 * the paths changed in (lastVersion, head] — what others did since it last worked. `resolve`: a merge turn's decisions.
 */
export async function runSyncStart(
  db: Q,
  groupId: string,
  botId: string,
  resolve: SyncDecision[] | null = null,
): Promise<RunSyncStart | null> {
  const [row] = await db
    .select({ mode: groups.mode, kind: groupBots.workspaceKind, joinedAt: syncReplicas.joinedAt })
    .from(groupBots)
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .leftJoin(
      syncReplicas,
      and(eq(syncReplicas.groupId, groupBots.groupId), eq(syncReplicas.botId, groupBots.botId)),
    )
    .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
  if (row?.mode !== 'force' || row.kind !== 'managed' || !row.joinedAt) return null
  const head = await headVersion(db, groupId)
  const done = sql`(${runs.sync}->>'version')::int`
  const [prev] = await db
    .select({ version: sql<number>`${done}` })
    .from(runs)
    .where(and(eq(runs.groupId, groupId), eq(runs.botId, botId), sql`${done} is not null`))
    .orderBy(desc(runs.endedAt))
    .limit(1)
  const lastVersion = prev?.version ?? null
  const none = { headVersion: head, lastVersion, changed: [], changedTotal: 0, resolve }
  if (lastVersion === null || lastVersion >= head) return none
  const range = and(
    eq(syncChanges.groupId, groupId),
    gt(syncChanges.version, lastVersion),
    lte(syncChanges.version, head),
  )
  const paths = await db
    .select({ path: syncChanges.path })
    .from(syncChanges)
    .where(range)
    .groupBy(syncChanges.path)
    .orderBy(sql`${syncChanges.path} collate "C"`)
    .limit(SYNC_CHANGED_MAX)
  const [n] = await db
    .select({ n: sql<number>`count(distinct ${syncChanges.path})::int` })
    .from(syncChanges)
    .where(range)
  return { ...none, changed: paths.map((p) => p.path), changedTotal: n?.n ?? 0 }
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
 * versions once joined; until then only the answers to its sync.init (`pending`) are taken.
 */
async function replica(db: Q, machineId: string, groupId: string, botId: string) {
  const [row] = await db
    .select({
      ownerId: bots.ownerId,
      issue: syncReplicas.issue,
      joinedAt: syncReplicas.joinedAt,
      pending: syncReplicas.pending,
    })
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

/**
 * Machines to send sync.available to: those hosting a joined replica other than `exceptBotId` that takes versions
 * (one with an issue waits for it to be settled, F11, F12).
 */
export async function replicaMachines(db: Q, groupId: string, exceptBotId: string) {
  const rows = await db
    .selectDistinct({ machineId: bots.machineId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(
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
        isNotNull(syncReplicas.joinedAt),
        isNull(syncReplicas.issue),
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

/** The base's whole tree replaces the head (§3.5): every path that differs, and deletions of the rest. */
function replaceHead(head: Head, tree: SyncChange[]) {
  const next: Head = new Map(tree.flatMap((c) => (c.hash ? [[c.path, { hash: c.hash, exec: c.exec }]] : [])))
  const effective: SyncChange[] = [
    ...[...next]
      .filter(([path, e]) => head.get(path)?.hash !== e.hash || head.get(path)?.exec !== e.exec)
      .map(([path, e]) => ({ path, ...e, baseHash: head.get(path)?.hash ?? null })),
    ...[...head]
      .filter(([path]) => !next.has(path))
      .map(([path, e]) => ({ path, hash: null, exec: false, baseHash: e.hash })),
  ]
  return { conflicts: [] as string[], effective, next }
}

/**
 * Takes a replica's changes as the group's next version when none conflicts with the head (F6), atomically and
 * serialized per group. A submit that changes nothing answers the current head (an empty v1 when there is none yet).
 * Resubmitting an accepted submitId answers its version again. `version` is set when a new version was written.
 * The base of a mode switch (kind `init`) replaces the head with its tree and joins; `base` tells it did.
 */
export async function submitTx(ctx: Ctx, machineId: string, msg: SyncSubmit) {
  return ctx.db.transaction(
    async (tx): Promise<{ result: SyncSubmitResult; version?: number; base?: boolean }> => {
      await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, msg.groupId)).for('update')
      const self = await replica(tx, machineId, msg.groupId, msg.botId)
      const base = self?.pending === 'base' && msg.kind === 'init'
      if (!self || !(self.joinedAt || base))
        return { result: { outcome: 'rejected', reason: 'not_participating' } }
      const [done] = await tx
        .select({ version: syncVersions.version })
        .from(syncVersions)
        .where(and(eq(syncVersions.groupId, msg.groupId), eq(syncVersions.submitId, msg.submitId)))
      if (done) return { result: { outcome: 'accepted', version: done.version } }

      const current = await headVersion(tx, msg.groupId)
      if (msg.baseVersion > current) return { result: { outcome: 'rejected', reason: 'bad_base' } }
      const head = await loadHead(tx, msg.groupId)
      const joined = base ? { joinedAt: ctx.now(), pending: null } : {}
      const { conflicts, effective, next } = base
        ? replaceHead(head, msg.changes)
        : compareAndSwap(head, msg.changes)
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
      if (!effective.length && current > 0) {
        if (base) await upsertReplica(tx, msg.groupId, msg.botId, joined)
        return { result: { outcome: 'accepted', version: current }, base }
      }

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
      await upsertReplica(tx, msg.groupId, msg.botId, { lastConflict: null, ...joined })
      return { result: { outcome: 'accepted', version }, version, base }
    },
  )
}

export async function upsertReplica(
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

const ALIGNING = ['align', 'force']

/**
 * The replica now holds `version`: clean when its root hash matches that version's (F14), which settles its issue and
 * open conflicts, and joins a replica that was aligning (§3.5); otherwise it is flagged. Returns null when the report
 * was not the replica's to make, else whether it just joined or had its issue cleared, and the conflicts it settled.
 */
export async function recordApplied(ctx: Ctx, machineId: string, msg: z.infer<typeof SyncApplied>) {
  return ctx.db.transaction(async (tx) => {
    const self = await replica(tx, machineId, msg.groupId, msg.botId)
    const aligning = ALIGNING.includes(self?.pending ?? '')
    if (!self || !(self.joinedAt || aligning)) return null
    const expected = await rootHashOf(tx, msg.groupId, msg.version)
    const now = ctx.now()
    const base = { version: msg.version, rootHash: msg.rootHash, syncedAt: now, files: [], total: 0 }
    if (expected === msg.rootHash) {
      await upsertReplica(tx, msg.groupId, msg.botId, {
        ...base,
        issue: null,
        reason: null,
        lastConflict: null,
        ...(aligning && { joinedAt: self.joinedAt ?? now, pending: null }),
      })
      const settled = await tx
        .update(syncConflicts)
        .set({ resolvedAt: now })
        .where(
          and(
            eq(syncConflicts.groupId, msg.groupId),
            eq(syncConflicts.botId, msg.botId),
            isNull(syncConflicts.resolvedAt),
          ),
        )
        .returning({ id: syncConflicts.id })
      return { joined: aligning, cleared: !!self.issue, settled: settled.map((c) => c.id) }
    }
    await upsertReplica(tx, msg.groupId, msg.botId, {
      ...base,
      issue: 'error',
      reason: t('副本内容与 v{version} 不一致', { version: msg.version }),
      ...(aligning && { pending: null }),
    })
    return { joined: false, cleared: false, settled: [] }
  })
}

/**
 * Stores why a replica stopped taking versions; `held` opens a conflict from its last refused submit (F11), settling
 * any older one of the replica. An answer to sync.init ends it (`pending` tells which it answered): `dirty` leaves the
 * replica out. Returns whether local edits are newly reported (none known, or only flagged by a waiting turn) and the
 * conflict just opened, if any.
 */
export async function recordState(ctx: Ctx, machineId: string, msg: z.infer<typeof SyncState>) {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ lastConflict: syncReplicas.lastConflict, total: syncReplicas.total })
      .from(syncReplicas)
      .where(and(eq(syncReplicas.groupId, msg.groupId), eq(syncReplicas.botId, msg.botId)))
    const self = await replica(tx, machineId, msg.groupId, msg.botId)
    if (!self || !(self.joinedAt || self.pending)) return null
    const newDrift = msg.state === 'drift' && (self.issue !== 'drift' || !row?.total)
    await upsertReplica(tx, msg.groupId, msg.botId, {
      issue: msg.state,
      files: msg.files.slice(0, SYNC_FILES_MAX),
      total: msg.total,
      reason: msg.reason,
      ...(self.pending && { pending: null }),
      ...(msg.state === 'dirty' && { joinedAt: null }),
    })
    const last = row?.lastConflict as LastConflict | null | undefined
    const opened =
      msg.state === 'held' && last ? await openConflict(tx, ctx.now(), msg.groupId, msg.botId, last) : null
    return { pending: self.pending, newDrift, opened }
  })
}

async function openConflict(tx: Tx, now: Date, groupId: string, botId: string, last: LastConflict) {
  const [done] = await tx
    .select({ id: syncConflicts.id })
    .from(syncConflicts)
    .where(eq(syncConflicts.submitId, last.submitId))
  if (done) return null
  const open = and(
    eq(syncConflicts.groupId, groupId),
    eq(syncConflicts.botId, botId),
    isNull(syncConflicts.resolvedAt),
  )
  await tx.update(syncConflicts).set({ resolvedAt: now }).where(open)
  const [row] = await tx
    .insert(syncConflicts)
    .values({ groupId, botId, ...last })
    .returning({ id: syncConflicts.id, headVersion: syncConflicts.headVersion })
  return row ? { ...row, files: last.conflicts.length } : null
}

/**
 * A turn found the replica unsettled before it started (run.done `waiting`): the issue is recorded unless one is
 * already known, so its runs wait. Returns whether it was new.
 */
export async function raiseIssue(db: Q, groupId: string, botId: string, issue: 'drift' | 'held') {
  const rows = await db
    .update(syncReplicas)
    .set({ issue, updatedAt: new Date() })
    .where(
      and(
        eq(syncReplicas.groupId, groupId),
        eq(syncReplicas.botId, botId),
        isNotNull(syncReplicas.joinedAt),
        isNull(syncReplicas.issue),
      ),
    )
    .returning({ botId: syncReplicas.botId })
  return rows.length > 0
}
