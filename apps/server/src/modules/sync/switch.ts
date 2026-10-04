import type { GitStatus, I18nText, SyncPreviewDto, SyncRole } from '@gonggong/protocol'
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupBots,
  groups,
  machines,
  runs,
  syncConflicts,
  syncReplicas,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { activeBots, publishGroup, requireAdmin, requireMember } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { resolveNotifications } from '../notifications/notify.js'
import { ACTIVE, schedule } from '../runs/scheduler.js'
import { runStep } from '../runs/step.js'
import { currentRepo, onlineMachine } from '../workspaces/provision.js'
import { publishSync } from './status.js'
import { closeConflicts, upsertReplica } from './store.js'

// Mode switch (docs/plan/强制同步-开发计划.md §3.5): partition ⇄ force, replicas joining and leaving.

type Q = Pick<Db, 'select'>

/** sync.init sent and not answered yet, per replica → the machine it went to; a reconnect sends it again. */
const inFlight = new Map<string, string>()
const key = (groupId: string, botId: string) => `${groupId}|${botId}`
const forgetGroup = (groupId: string) => {
  for (const k of inFlight.keys()) if (k.startsWith(`${groupId}|`)) inFlight.delete(k)
}
export const forgetInit = (groupId: string, botId: string) => inFlight.delete(key(groupId, botId))
export function forgetMachineInits(machineId: string) {
  for (const [k, m] of inFlight) if (m === machineId) inFlight.delete(k)
}

/** The machine is online with a daemon that cannot sync (no `sync` feature): its replicas sit out. */
export const syncOutdated = (ctx: Ctx, machineId: string | null) =>
  !!machineId && ctx.hub.isOnline(machineId) && !ctx.hub.features(machineId).includes('sync')

/** sync.init that sets a replica up (base / align, F2); 'leave' is a leave still owed to an offline machine. */
const INITS = ['base', 'align', 'force']
/** The base bot's tree must be in by then, or the switch fails back to partition. */
export const SWITCH_TIMEOUT_MS = 10 * 60_000

const SWITCH_WAIT = runStep('等待切换为强制同步')
const ALIGN_WAIT = runStep('等待同步对齐')
const DRIFT_WAIT = runStep('等待处理本地改动')
const HELD_WAIT = runStep('等待处理同步冲突')

/**
 * The bot's groups whose new turns wait, each with its run step: the group is switching or this replica's sync.init
 * is due (§3.5 step 4: a turn must not run in a tree about to be overwritten), or the replica has local edits (F12) or
 * a held conflict (F11) to be settled first. `held`: only a merge turn of that conflict may go.
 */
export async function syncHeld(db: Q, botId: string) {
  const rows = await db
    .select({ groupId: groupBots.groupId, switching: groups.syncSwitch, replica: syncReplicas })
    .from(groupBots)
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .leftJoin(
      syncReplicas,
      and(eq(syncReplicas.groupId, groupBots.groupId), eq(syncReplicas.botId, groupBots.botId)),
    )
    .where(
      and(
        eq(groupBots.botId, botId),
        isNull(groupBots.removedAt),
        eq(groups.mode, 'force'),
        or(
          isNotNull(groups.syncSwitch),
          inArray(syncReplicas.pending, INITS),
          and(isNotNull(syncReplicas.joinedAt), inArray(syncReplicas.issue, ['drift', 'held'])),
        ),
      ),
    )
  return new Map(
    rows.map((r) => {
      const step = r.switching
        ? SWITCH_WAIT
        : r.replica?.pending && INITS.includes(r.replica.pending)
          ? ALIGN_WAIT
          : r.replica?.issue === 'held'
            ? HELD_WAIT
            : DRIFT_WAIT
      return [r.groupId, { step, held: step === HELD_WAIT }]
    }),
  )
}

/**
 * Sends the bot's due sync.init (base / align) to its machine when online, its managed clone is ready and no turn of
 * it runs in that group (runs started before the switch finish in partition mode). Called after every scheduling.
 */
export async function sendDueInits(ctx: Ctx, botId: string) {
  const rows = await ctx.db
    .select({
      groupId: syncReplicas.groupId,
      pending: syncReplicas.pending,
      machineId: bots.machineId,
      state: groupBots.workspaceState,
    })
    .from(syncReplicas)
    .innerJoin(
      groupBots,
      and(eq(groupBots.groupId, syncReplicas.groupId), eq(groupBots.botId, syncReplicas.botId)),
    )
    .innerJoin(bots, eq(bots.id, syncReplicas.botId))
    .innerJoin(groups, eq(groups.id, syncReplicas.groupId))
    .where(
      and(
        eq(syncReplicas.botId, botId),
        inArray(syncReplicas.pending, INITS),
        isNull(groupBots.removedAt),
        eq(groupBots.workspaceKind, 'managed'),
        isNull(bots.deletedAt),
        eq(groups.mode, 'force'),
        isNull(groups.archivedAt),
      ),
    )
  for (const r of rows) {
    const machineId = onlineMachine(ctx, r.machineId)
    if (
      !machineId ||
      syncOutdated(ctx, machineId) ||
      r.state !== 'ready' ||
      inFlight.get(key(r.groupId, botId)) === machineId
    )
      continue
    const [busy] = await ctx.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.groupId, r.groupId), eq(runs.botId, botId), inArray(runs.status, ACTIVE)))
      .limit(1)
    if (busy) continue
    const repo = await currentRepo(ctx, r.groupId)
    const role: SyncRole = r.pending === 'base' ? 'base' : 'align'
    const msg = { t: 'sync.init', groupId: r.groupId, botId, role, force: r.pending === 'force' } as const
    if (ctx.hub.send(machineId, { ...msg, repoId: repo?.id ?? null }))
      inFlight.set(key(r.groupId, botId), machineId)
  }
}

const leaveMsg = (groupId: string, botId: string) =>
  ({ t: 'sync.init', groupId, botId, role: 'leave', force: false, repoId: null }) as const

/** Tells the machine to forget the replica's sync state; an offline one is told once it connects (sendOwedLeaves). */
async function sendLeave(ctx: Ctx, groupId: string, bot: { id: string; machineId: string | null }) {
  const machineId = onlineMachine(ctx, bot.machineId)
  if (machineId && ctx.hub.send(machineId, leaveMsg(groupId, bot.id))) return
  await upsertReplica(ctx.db, groupId, bot.id, { pending: 'leave' })
}

/** A connected machine gets the leaves it missed while offline. */
export async function sendOwedLeaves(ctx: Ctx, machineId: string) {
  const owed = await ctx.db
    .select({ groupId: syncReplicas.groupId, botId: syncReplicas.botId })
    .from(syncReplicas)
    .innerJoin(bots, eq(bots.id, syncReplicas.botId))
    .where(and(eq(bots.machineId, machineId), eq(syncReplicas.pending, 'leave')))
  for (const r of owed)
    if (ctx.hub.send(machineId, leaveMsg(r.groupId, r.botId)))
      await ctx.db
        .update(syncReplicas)
        .set({ pending: null })
        .where(
          and(
            eq(syncReplicas.groupId, r.groupId),
            eq(syncReplicas.botId, r.botId),
            eq(syncReplicas.pending, 'leave'),
          ),
        )
}

/** Closing a replica's conflicts and local edits settles what its notifications asked about. */
async function settleNotices(ctx: Ctx, groupId: string, conflictIds: string[], botIds: string[]) {
  await resolveNotifications(ctx, 'sync_conflict', 'conflictId', conflictIds)
  await resolveNotifications(ctx, 'sync_drift', 'botId', botIds, groupId)
}

const LEFT: Partial<typeof syncReplicas.$inferInsert> = {
  joinedAt: null,
  pending: null,
  issue: null,
  files: [],
  total: 0,
  reason: null,
  lastConflict: null,
}

async function rescheduleGroup(ctx: Ctx, groupId: string) {
  for (const bot of await activeBots(ctx, groupId)) await schedule(ctx, bot.id)
}

const userName = async (ctx: Ctx, id: string) =>
  (await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, id)))[0]?.name ?? ''

/** What switching to force would do to each bot of the group (the wizard's preview). */
export async function syncPreview(ctx: Ctx, groupId: string): Promise<SyncPreviewDto> {
  const rows = await ctx.db
    .select({
      botId: bots.id,
      botName: bots.name,
      machineId: bots.machineId,
      machineName: machines.name,
      machineLabel: machines.label,
      kind: groupBots.workspaceKind,
      state: groupBots.workspaceState,
      git: groupBots.gitStatus,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .leftJoin(machines, eq(machines.id, bots.machineId))
    .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt), isNull(bots.deletedAt)))
    .orderBy(groupBots.addedAt)
  return {
    bots: rows.map((r) => {
      const plan = (
        p: 'align' | 'excluded',
        reason: SyncPreviewDto['bots'][number]['reason'],
        canBase: boolean,
      ) => ({
        botId: r.botId,
        botName: r.botName,
        machineName: r.machineLabel ?? r.machineName,
        plan: p,
        reason,
        canBase,
      })
      if (r.kind === 'cd') return plan('excluded', 'cd', false)
      if (!onlineMachine(ctx, r.machineId)) return plan('align', 'offline', false)
      if (syncOutdated(ctx, r.machineId)) return plan('excluded', 'outdated', false)
      if (r.state !== 'ready') return plan('align', 'not_ready', false)
      if ((r.git as GitStatus | null)?.dirty) return plan('excluded', 'dirty', true)
      return plan('align', null, true)
    }),
  }
}

/**
 * Partition → force (§3.5): the group switches at once and holds new turns; the base bot's tree becomes the next
 * version (sync.init base), then every other managed replica aligns to it (onBaseAccepted).
 */
export async function enableSync(ctx: Ctx, userId: string, groupId: string, baseBotId: string) {
  const { group } = await requireAdmin(ctx, groupId, userId)
  if (group.mode === 'force') return fail('conflict', '群已是强制同步模式')
  if (!(await currentRepo(ctx, groupId))) return fail('invalid', '群未绑定仓库，不能切换为强制同步')
  const [base] = await ctx.db
    .select({
      name: bots.name,
      machineId: bots.machineId,
      kind: groupBots.workspaceKind,
      state: groupBots.workspaceState,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(
      and(
        eq(groupBots.groupId, groupId),
        eq(groupBots.botId, baseBotId),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
      ),
    )
  if (!base) return fail('invalid', '基准 Bot 不在群内')
  if (base.kind !== 'managed') return fail('invalid', '基准 Bot 使用本机目录，不能作为基准')
  if (base.state !== 'ready') return fail('invalid', '基准 Bot 的托管工作区尚未就绪')
  if (!onlineMachine(ctx, base.machineId)) return fail('invalid', '基准 Bot 所在机器离线')
  if (syncOutdated(ctx, base.machineId)) return fail('invalid', '基准 Bot 所在机器的 daemon 版本过旧，请升级')

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(groups)
      .set({
        mode: 'force',
        syncSwitch: { userId, botId: baseBotId, at: ctx.now().toISOString() },
        syncArchivedAt: null,
      })
      .where(eq(groups.id, groupId))
    // A previous force period's replicas start over; its versions stay as history. Owed leaves stay owed.
    await tx
      .update(syncReplicas)
      .set({ ...LEFT, version: null, rootHash: null })
      .where(
        and(
          eq(syncReplicas.groupId, groupId),
          or(isNull(syncReplicas.pending), ne(syncReplicas.pending, 'leave')),
        ),
      )
    await tx
      .update(syncConflicts)
      .set({ resolvedAt: ctx.now() })
      .where(and(eq(syncConflicts.groupId, groupId), isNull(syncConflicts.resolvedAt)))
    await upsertReplica(tx, groupId, baseBotId, { pending: 'base' })
  })
  forgetGroup(groupId)
  await audit(ctx, {
    category: 'admin',
    actorUserId: userId,
    groupId,
    action: 'group.sync.enable',
    detail: { baseBotId, name: base.name },
  })
  await publishGroup(ctx, groupId)
  await publishSync(ctx, groupId)
  await sendDueInits(ctx, baseBotId)
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Ends the switch once, with `then` in the same transaction; returns who started it with which base, null when it was
 * already over.
 */
async function endSwitch(
  ctx: Ctx,
  groupId: string,
  set: Partial<typeof groups.$inferInsert>,
  then: (tx: Tx) => Promise<unknown>,
) {
  return ctx.db.transaction(async (tx) => {
    const [g] = await tx
      .select({ syncSwitch: groups.syncSwitch })
      .from(groups)
      .where(eq(groups.id, groupId))
      .for('update')
    if (!g?.syncSwitch) return null
    await tx
      .update(groups)
      .set({ syncSwitch: null, ...set })
      .where(eq(groups.id, groupId))
    await then(tx)
    return g.syncSwitch
  })
}

/**
 * The base's tree is in: the switch is done. Every other managed replica not in yet is due to align (sent as soon as
 * it can be), and the held turns run in force mode.
 */
export async function onBaseAccepted(ctx: Ctx, groupId: string, botId: string) {
  forgetInit(groupId, botId)
  const by = await endSwitch(ctx, groupId, {}, async (tx) => {
    const others = await tx
      .select({ botId: groupBots.botId })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .where(
        and(
          eq(groupBots.groupId, groupId),
          isNull(groupBots.removedAt),
          isNull(bots.deletedAt),
          eq(groupBots.workspaceKind, 'managed'),
          sql`${groupBots.botId} <> ${botId}`,
        ),
      )
    for (const o of others) await upsertReplica(tx, groupId, o.botId, { pending: 'align' })
  })
  if (!by) return
  const [base] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, botId))
  await postEvent(ctx, groupId, '{user} 将同步模式切换为强制同步，基准 Bot：{bot}', {
    user: await userName(ctx, by.userId),
    bot: base?.name ?? '',
  })
  await publishSync(ctx, groupId)
  await rescheduleGroup(ctx, groupId)
}

/**
 * The base could not submit its tree (it reported why, left the group, or `timedOut`): the group goes back to
 * partition mode.
 */
export async function onBaseFailed(
  ctx: Ctx,
  groupId: string,
  botId: string,
  reason: string | I18nText | null,
  timedOut = false,
) {
  forgetInit(groupId, botId)
  const ended = await endSwitch(ctx, groupId, { mode: 'partition', syncArchivedAt: ctx.now() }, (tx) =>
    tx
      .update(syncReplicas)
      .set({ pending: null })
      .where(and(eq(syncReplicas.groupId, groupId), inArray(syncReplicas.pending, INITS))),
  )
  if (!ended) return
  if (timedOut) await postEvent(ctx, groupId, '基准 Bot 未能在 10 分钟内完成首版，已退回分区模式')
  else
    await postEvent(ctx, groupId, '切换为强制同步失败，仍为分区模式：{reason}', {
      reason: reason ?? { key: '未知错误' },
    })
  await publishGroup(ctx, groupId)
  await rescheduleGroup(ctx, groupId)
}

/** Switches whose base has not submitted its tree within SWITCH_TIMEOUT_MS fail back to partition (§3.5). */
export async function expireSwitches(ctx: Ctx) {
  const cutoff = new Date(ctx.now().getTime() - SWITCH_TIMEOUT_MS).toISOString()
  const due = await ctx.db
    .select({ id: groups.id, syncSwitch: groups.syncSwitch })
    .from(groups)
    .where(
      and(
        isNotNull(groups.syncSwitch),
        sql`coalesce((${groups.syncSwitch}->>'at')::timestamptz, '-infinity') < ${cutoff}::timestamptz`,
      ),
    )
  for (const g of due) if (g.syncSwitch) await onBaseFailed(ctx, g.id, g.syncSwitch.botId, null, true)
}

/** The base bot left the group or was deleted mid-switch: the switch cannot finish. */
async function baseLeft(ctx: Ctx, groupIds: string[], botIds: string[]) {
  if (!groupIds.length) return
  const hit = await ctx.db
    .select({ id: groups.id, syncSwitch: groups.syncSwitch })
    .from(groups)
    .where(and(inArray(groups.id, groupIds), inArray(sql`${groups.syncSwitch}->>'botId'`, botIds)))
  for (const g of hit)
    if (g.syncSwitch) await onBaseFailed(ctx, g.id, g.syncSwitch.botId, { key: '基准 Bot 已离开群' })
}

/** An aligning replica answered (applied or a report): its runs may go, a late joiner catches up past its version. */
export async function onAligned(ctx: Ctx, groupId: string, botId: string) {
  forgetInit(groupId, botId)
  await schedule(ctx, botId)
}

/**
 * Force → partition: syncing stops, every replica keeps its files and forgets its sync state (sync.init leave); the
 * group's sync data is archived and purged 30 days later (F16).
 */
export async function disableSync(ctx: Ctx, userId: string, groupId: string) {
  const { group } = await requireAdmin(ctx, groupId, userId)
  if (group.mode !== 'force') return fail('conflict', '群不是强制同步模式')
  const closed = await ctx.db.transaction(async (tx) => {
    await tx
      .update(groups)
      .set({ mode: 'partition', syncSwitch: null, syncArchivedAt: ctx.now() })
      .where(eq(groups.id, groupId))
    await tx
      .update(syncReplicas)
      .set({ joinedAt: null, pending: null })
      .where(eq(syncReplicas.groupId, groupId))
    return tx
      .update(syncConflicts)
      .set({ resolvedAt: ctx.now() })
      .where(and(eq(syncConflicts.groupId, groupId), isNull(syncConflicts.resolvedAt)))
      .returning({ id: syncConflicts.id })
  })
  forgetGroup(groupId)
  const hosted = await ctx.db
    .select({ id: bots.id, machineId: bots.machineId })
    .from(syncReplicas)
    .innerJoin(bots, eq(bots.id, syncReplicas.botId))
    .where(eq(syncReplicas.groupId, groupId))
  for (const bot of hosted) await sendLeave(ctx, groupId, bot)
  await settleNotices(
    ctx,
    groupId,
    closed.map((c) => c.id),
    hosted.map((b) => b.id),
  )
  await postEvent(ctx, groupId, '{user} 将同步模式切回分区模式，各 Bot 保留当前文件', {
    user: await userName(ctx, userId),
  })
  await audit(ctx, {
    category: 'admin',
    actorUserId: userId,
    groupId,
    action: 'group.sync.disable',
    detail: {},
  })
  await publishGroup(ctx, groupId)
  await rescheduleGroup(ctx, groupId)
}

/**
 * A left-out replica joins (group admin or the bot's owner): it aligns to the head; `force` discards its uncommitted
 * changes after a backup.
 */
export async function joinReplica(ctx: Ctx, userId: string, groupId: string, botId: string, force: boolean) {
  const { group, member } = await requireMember(ctx, groupId, userId)
  const [row] = await ctx.db
    .select({
      ownerId: bots.ownerId,
      kind: groupBots.workspaceKind,
      joinedAt: syncReplicas.joinedAt,
      pending: syncReplicas.pending,
    })
    .from(groupBots)
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
        isNull(bots.deletedAt),
      ),
    )
  if (!row) return fail('not_found', '该 Bot 不在群内')
  if (!member.isAdmin && row.ownerId !== userId) return fail('forbidden', '仅群管理员或 Bot 主人可操作')
  if (group.mode !== 'force') return fail('conflict', '群不是强制同步模式')
  if (group.syncSwitch) return fail('conflict', '正在切换为强制同步，请稍后再试')
  if (row.kind !== 'managed') return fail('invalid', '使用本机目录的 Bot 不参与强制同步')
  if (row.joinedAt) return fail('conflict', '该副本已参与强制同步')
  const pending = force ? 'force' : 'align'
  if (row.pending === pending) return
  await upsertReplica(ctx.db, groupId, botId, { ...LEFT, pending })
  forgetInit(groupId, botId)
  await publishSync(ctx, groupId)
  await sendDueInits(ctx, botId)
}

/**
 * A bot's managed workspace became ready in a force group (it was just added, re-cloned, or went back from /cd): a
 * replica that never joined and was not left out aligns on its own; it is sent by the scheduling that follows.
 */
export async function autoAlign(ctx: Ctx, groupId: string, botId: string) {
  const [row] = await ctx.db
    .select({ replica: syncReplicas })
    .from(groupBots)
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .leftJoin(
      syncReplicas,
      and(eq(syncReplicas.groupId, groupBots.groupId), eq(syncReplicas.botId, groupBots.botId)),
    )
    .where(
      and(
        eq(groupBots.groupId, groupId),
        eq(groupBots.botId, botId),
        eq(groupBots.workspaceKind, 'managed'),
        eq(groups.mode, 'force'),
        isNull(groups.syncSwitch),
      ),
    )
  const r = row?.replica
  if (!row || r?.joinedAt || (r?.pending && r.pending !== 'leave') || r?.issue) return
  await upsertReplica(ctx.db, groupId, botId, { pending: 'align' })
  await publishSync(ctx, groupId)
}

/** The bot left the group: its replica stops syncing and its machine forgets the sync state. */
export async function leaveReplica(ctx: Ctx, groupId: string, bot: { id: string; machineId: string | null }) {
  await baseLeft(ctx, [groupId], [bot.id])
  const left = await ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .update(syncReplicas)
      .set(LEFT)
      .where(and(eq(syncReplicas.groupId, groupId), eq(syncReplicas.botId, bot.id)))
      .returning()
    return r && closeConflicts(tx, ctx.now(), groupId, [bot.id])
  })
  if (!left) return
  forgetInit(groupId, bot.id)
  await sendLeave(ctx, groupId, bot)
  await settleNotices(ctx, groupId, left, [bot.id])
  await publishSync(ctx, groupId)
}

/** The bots were deleted: their replicas stop syncing everywhere, their open conflicts close, their machines forget. */
export async function leaveBots(ctx: Ctx, botIds: string[]) {
  if (!botIds.length) return
  const switching = await ctx.db
    .select({ groupId: syncReplicas.groupId })
    .from(syncReplicas)
    .where(and(inArray(syncReplicas.botId, botIds), eq(syncReplicas.pending, 'base')))
  await baseLeft(
    ctx,
    switching.map((r) => r.groupId),
    botIds,
  )
  const { left, closed } = await ctx.db.transaction(async (tx) => {
    const closed = await tx
      .update(syncConflicts)
      .set({ resolvedAt: ctx.now() })
      .where(and(inArray(syncConflicts.botId, botIds), isNull(syncConflicts.resolvedAt)))
      .returning({ id: syncConflicts.id })
    const left = await tx
      .update(syncReplicas)
      .set(LEFT)
      .where(inArray(syncReplicas.botId, botIds))
      .returning({ groupId: syncReplicas.groupId, botId: syncReplicas.botId })
    return { left, closed }
  })
  await resolveNotifications(
    ctx,
    'sync_conflict',
    'conflictId',
    closed.map((c) => c.id),
  )
  const machineOf = new Map(
    (
      await ctx.db
        .select({ id: bots.id, machineId: bots.machineId })
        .from(bots)
        .where(inArray(bots.id, botIds))
    ).map((b) => [b.id, b.machineId]),
  )
  for (const r of left) {
    forgetInit(r.groupId, r.botId)
    await sendLeave(ctx, r.groupId, { id: r.botId, machineId: machineOf.get(r.botId) ?? null })
    await resolveNotifications(ctx, 'sync_drift', 'botId', [r.botId], r.groupId)
  }
  for (const groupId of new Set(left.map((r) => r.groupId))) await publishSync(ctx, groupId)
}
