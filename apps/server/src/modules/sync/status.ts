import type {
  SyncChange,
  SyncConflictDto,
  SyncEntry,
  SyncReplicaIssue,
  SyncReplicaState,
  SyncStatusDto,
  SyncVersionDto,
  SyncVersionTag,
} from '@gonggong/protocol'
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupBots,
  groups,
  machines,
  syncConflicts,
  syncReplicas,
  syncVersions,
  users,
} from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { memberIds } from '../messages/service.js'
import { isBinary } from './blobs.js'
import { syncOutdated } from './switch.js'

/** A replica behind a head this fresh is still catching up (sync.available just went out); older, it lags. */
export const SYNCING_MS = 60_000

/**
 * F14, in order: not managed or on a daemon that cannot sync → excluded; not joined → syncing / offline while its sync.init is due, else excluded;
 * machine offline → offline; held → conflict; error (limits, root hash mismatch) → error; drift → drift; at head →
 * consistent; else syncing while the head is fresh, behind after.
 */
function replicaState(
  o: {
    managed: boolean
    outdated: boolean
    joined: boolean
    pending: boolean
    online: boolean
    issue: string | null
    version: number | null
  },
  head: { version: number; fresh: boolean },
): SyncReplicaState {
  if (!o.managed || o.outdated) return 'excluded'
  if (!o.joined) return o.pending ? (o.online ? 'syncing' : 'offline') : 'excluded'
  if (!o.online) return 'offline'
  if (o.issue === 'held') return 'conflict'
  if (o.issue === 'error') return 'error'
  if (o.issue) return 'drift'
  if (o.version === head.version) return 'consistent'
  return head.fresh ? 'syncing' : 'behind'
}

export async function syncStatus(ctx: Ctx, groupId: string): Promise<SyncStatusDto> {
  return (await statusOf(ctx, groupId)).dto
}

/** The status, and when the head stops being fresh while a replica shows syncing (it may turn behind then). */
async function statusOf(ctx: Ctx, groupId: string) {
  const [rows, [head], [group]] = await Promise.all([
    ctx.db
      .select({
        botId: bots.id,
        botName: bots.name,
        ownerId: bots.ownerId,
        machineId: bots.machineId,
        machineName: machines.name,
        machineLabel: machines.label,
        workspaceKind: groupBots.workspaceKind,
        replica: syncReplicas,
      })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .leftJoin(machines, eq(machines.id, bots.machineId))
      .leftJoin(
        syncReplicas,
        and(eq(syncReplicas.groupId, groupBots.groupId), eq(syncReplicas.botId, groupBots.botId)),
      )
      .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt), isNull(bots.deletedAt)))
      .orderBy(asc(groupBots.addedAt)),
    ctx.db
      .select({ version: syncVersions.version, createdAt: syncVersions.createdAt })
      .from(syncVersions)
      .where(eq(syncVersions.groupId, groupId))
      .orderBy(desc(syncVersions.version))
      .limit(1),
    ctx.db.select({ syncSwitch: groups.syncSwitch }).from(groups).where(eq(groups.id, groupId)),
  ])
  const h = {
    version: head?.version ?? 0,
    fresh: !!head && ctx.now().getTime() - head.createdAt.getTime() < SYNCING_MS,
  }
  const replicas = rows.map((r) => {
    const issue = r.replica?.issue ?? null
    const managed = r.workspaceKind === 'managed'
    const outdated = managed && syncOutdated(ctx, r.machineId)
    return {
      botId: r.botId,
      botName: r.botName,
      ownerId: r.ownerId,
      machineName: r.machineLabel ?? r.machineName,
      workspace: managed ? ('managed' as const) : ('cd' as const),
      version: r.replica?.version ?? null,
      state: replicaState(
        {
          managed,
          outdated,
          joined: !!r.replica?.joinedAt,
          pending: !!r.replica?.pending && r.replica.pending !== 'leave',
          online: !!r.machineId && ctx.hub.isOnline(r.machineId),
          issue,
          version: r.replica?.version ?? null,
        },
        h,
      ),
      updatedAt: r.replica?.syncedAt?.toISOString() ?? null,
      issue: managed ? ((issue as SyncReplicaIssue | null) ?? null) : null,
      files: issue ? (r.replica?.files ?? []) : [],
      reason: outdated ? t('daemon 版本过旧，请升级') : issue ? (r.replica?.reason ?? null) : null,
      reasonI18n: outdated
        ? { key: 'daemon 版本过旧，请升级' }
        : issue
          ? (r.replica?.reasonI18n ?? null)
          : null,
    }
  })
  const dto: SyncStatusDto = {
    groupId,
    headVersion: h.version,
    consistent: replicas.filter((r) => r.state === 'consistent').length,
    total: replicas.filter((r) => r.state !== 'excluded').length,
    switching: !!group?.syncSwitch,
    replicas,
  }
  const turns = head && h.fresh && replicas.some((r) => r.state === 'syncing')
  return { dto, behindAt: turns ? head.createdAt.getTime() + SYNCING_MS : null }
}

/** Per group: the push due when the head stops being fresh (F14: a lagging replica turns behind, nothing else tells). */
const behindTimers = new Map<string, NodeJS.Timeout>()
export function stopSyncTimers() {
  for (const timer of behindTimers.values()) clearTimeout(timer)
  behindTimers.clear()
}

/** Pushes `group.sync` to the members of a force group. */
export async function publishSync(ctx: Ctx, groupId: string) {
  clearTimeout(behindTimers.get(groupId))
  behindTimers.delete(groupId)
  const [g] = await ctx.db.select({ mode: groups.mode }).from(groups).where(eq(groups.id, groupId))
  if (g?.mode !== 'force') return
  const { dto, behindAt } = await statusOf(ctx, groupId)
  ctx.bus.publish(await memberIds(ctx, groupId), { t: 'group.sync', ...dto })
  if (behindAt === null) return
  const timer = setTimeout(
    () => {
      behindTimers.delete(groupId)
      publishSync(ctx, groupId).catch((err) => console.error('sync status:', err))
    },
    Math.max(0, behindAt - ctx.now().getTime()) + 50,
  )
  timer.unref()
  behindTimers.set(groupId, timer)
}

export async function syncVersionList(ctx: Ctx, groupId: string, o: { before?: number; limit: number }) {
  const rows = await ctx.db
    .select({ v: syncVersions, botName: bots.name, userName: users.name })
    .from(syncVersions)
    .leftJoin(bots, eq(bots.id, syncVersions.authorId))
    .leftJoin(users, eq(users.id, syncVersions.authorId))
    .where(
      and(
        eq(syncVersions.groupId, groupId),
        o.before === undefined ? undefined : lt(syncVersions.version, o.before),
      ),
    )
    .orderBy(desc(syncVersions.version))
    .limit(o.limit)
  return rows.map(
    ({ v, botName, userName }): SyncVersionDto => ({
      version: v.version,
      author: {
        kind: v.authorKind as 'bot' | 'user',
        id: v.authorId,
        name: (v.authorKind === 'bot' ? botName : userName) ?? '',
      },
      runId: v.runId,
      tags: v.tags as SyncVersionTag[],
      files: v.files,
      createdAt: v.createdAt.toISOString(),
    }),
  )
}

type ConflictRow = typeof syncConflicts.$inferSelect

/** Each conflicting file of a held change: the replica's, the head's and the base's content. */
export async function conflictFiles(c: ConflictRow): Promise<SyncConflictDto['files']> {
  const mine = new Map((c.changes as SyncChange[]).map((ch) => [ch.path, ch]))
  return Promise.all(
    (c.conflicts as SyncEntry[]).map(async (theirs) => {
      const m = mine.get(theirs.path)
      const mineHash = m?.hash ?? null
      return {
        path: theirs.path,
        binary: (await isBinary(c.groupId, mineHash)) || (await isBinary(c.groupId, theirs.hash)),
        mineHash,
        theirsHash: theirs.hash,
        baseHash: m?.baseHash ?? null,
      }
    }),
  )
}

export async function openConflicts(ctx: Ctx, groupId: string): Promise<SyncConflictDto[]> {
  const rows = await ctx.db
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.groupId, groupId), isNull(syncConflicts.resolvedAt)))
    .orderBy(asc(syncConflicts.createdAt))
  return Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      botId: c.botId,
      versionBase: c.baseVersion,
      headVersion: c.headVersion,
      files: await conflictFiles(c),
      createdAt: c.createdAt.toISOString(),
    })),
  )
}
