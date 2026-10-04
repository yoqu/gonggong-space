import type { DaemonToServer, SyncSubmit } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groups } from '../../db/schema.js'
import { resolveNotifications } from '../notifications/notify.js'
import { schedule } from '../runs/scheduler.js'
import { announceConflict, notifyDrift } from './resolve.js'
import { publishSync, stopSyncTimers } from './status.js'
import { headVersion, recordApplied, recordState, replicaMachines, submitTx } from './store.js'
import {
  expireSwitches,
  forgetInit,
  forgetMachineInits,
  onAligned,
  onBaseAccepted,
  onBaseFailed,
  sendOwedLeaves,
  syncOutdated,
} from './switch.js'

/** How often stuck mode switches are looked for (SWITCH_TIMEOUT_MS). */
const SWITCH_CHECK_MS = 30_000

/** Answers sync.submit; on a new version tells the other replicas' machines (F8) and the members. */
export async function handleSubmit(ctx: Ctx, machineId: string, msg: SyncSubmit) {
  const { result, version, base } = await submitTx(ctx, machineId, msg)
  ctx.hub.send(machineId, {
    t: 'sync.result',
    groupId: msg.groupId,
    botId: msg.botId,
    submitId: msg.submitId,
    result,
  })
  if (base && result.outcome === 'accepted') await onBaseAccepted(ctx, msg.groupId, msg.botId)
  if (version === undefined) return
  for (const m of await replicaMachines(ctx.db, msg.groupId, msg.botId))
    if (!syncOutdated(ctx, m)) ctx.hub.send(m, { t: 'sync.available', groupId: msg.groupId, version })
  await publishSync(ctx, msg.groupId)
}

async function onApplied(ctx: Ctx, machineId: string, msg: Extract<DaemonToServer, { t: 'sync.applied' }>) {
  const r = await recordApplied(ctx, machineId, msg)
  if (!r) return
  await publishSync(ctx, msg.groupId)
  await resolveNotifications(ctx, 'sync_conflict', 'conflictId', r.settled)
  if (r.cleared) await resolveNotifications(ctx, 'sync_drift', 'botId', [msg.botId], msg.groupId)
  // An align answered with a mismatching tree: the replica is flagged and sits out, its turns go unsynced.
  if (!r.joined && !r.cleared) return r.aligning ? onAligned(ctx, msg.groupId, msg.botId) : undefined
  // A version that came out while it aligned or was paused (F11, F12).
  const head = await headVersion(ctx.db, msg.groupId)
  if (head > msg.version)
    ctx.hub.send(machineId, { t: 'sync.available', groupId: msg.groupId, version: head })
  if (r.joined) await onAligned(ctx, msg.groupId, msg.botId)
  // Its waiting turns go.
  else await schedule(ctx, msg.botId)
}

async function onState(ctx: Ctx, machineId: string, msg: Extract<DaemonToServer, { t: 'sync.state' }>) {
  const r = await recordState(ctx, machineId, msg)
  if (!r) return
  await publishSync(ctx, msg.groupId)
  await resolveNotifications(ctx, 'sync_conflict', 'conflictId', r.closed)
  if (r.lost) {
    // Starts over: aligned again by the scheduling that follows, its turns wait meanwhile.
    forgetInit(msg.groupId, msg.botId)
    await resolveNotifications(ctx, 'sync_drift', 'botId', [msg.botId], msg.groupId)
    return schedule(ctx, msg.botId)
  }
  if (r.pending === 'base') return onBaseFailed(ctx, msg.groupId, msg.botId, msg.reason)
  if (r.pending) return onAligned(ctx, msg.groupId, msg.botId)
  if (r.newDrift) await notifyDrift(ctx, msg.groupId, msg.botId, msg.total)
  if (r.opened) await announceConflict(ctx, msg.groupId, msg.botId, r.opened)
  // Its queued turns show why they wait.
  if (msg.state === 'drift' || msg.state === 'held') await schedule(ctx, msg.botId)
}

/** Live force groups with a bot on `machineId`: their replicas' online state changed. */
async function machineGroups(ctx: Ctx, machineId: string) {
  const rows = await ctx.db
    .selectDistinct({ groupId: groupBots.groupId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(
      and(
        eq(bots.machineId, machineId),
        isNull(groupBots.removedAt),
        eq(groups.mode, 'force'),
        isNull(groups.archivedAt),
      ),
    )
  return rows.map((r) => r.groupId)
}

export function startSyncEngine(ctx: Ctx) {
  // Per group (machine for presence) in arrival order: an applied must not overtake the submit it follows.
  const chains = new Map<string, Promise<void>>()
  const enqueue = (groupId: string, job: () => Promise<unknown>) => {
    const next = (chains.get(groupId) ?? Promise.resolve()).then(job).then(
      () => {},
      (err) => console.error('sync:', err),
    )
    chains.set(groupId, next)
    next.then(() => chains.get(groupId) === next && chains.delete(groupId))
  }
  const onMessage = (machineId: string, msg: DaemonToServer) => {
    if (msg.t === 'sync.submit') enqueue(msg.groupId, () => handleSubmit(ctx, machineId, msg))
    else if (msg.t === 'sync.applied') enqueue(msg.groupId, () => onApplied(ctx, machineId, msg))
    else if (msg.t === 'sync.state') enqueue(msg.groupId, () => onState(ctx, machineId, msg))
  }
  const onPresence = (machineId: string) =>
    enqueue(machineId, async () => {
      forgetMachineInits(machineId)
      for (const id of await machineGroups(ctx, machineId)) await publishSync(ctx, id)
    })
  // A reconnected daemon forgets the replicas it left while away and catches the others up to the head (F9).
  const onOnline = (machineId: string) =>
    enqueue(machineId, async () => {
      if (!syncOutdated(ctx, machineId)) await sendOwedLeaves(ctx, machineId)
      for (const groupId of await machineGroups(ctx, machineId)) {
        const version = await headVersion(ctx.db, groupId)
        if (version > 0 && !syncOutdated(ctx, machineId))
          ctx.hub.send(machineId, { t: 'sync.available', groupId, version })
        await publishSync(ctx, groupId)
      }
    })
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', onOnline)
  ctx.hub.on('offline', onPresence)
  const switches = setInterval(() => enqueue('switch-expiry', () => expireSwitches(ctx)), SWITCH_CHECK_MS)
  switches.unref()
  return async () => {
    clearInterval(switches)
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', onOnline)
    ctx.hub.off('offline', onPresence)
    await Promise.all(chains.values())
    stopSyncTimers()
  }
}
