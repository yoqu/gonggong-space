import type { DaemonToServer, SyncSubmit } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groups } from '../../db/schema.js'
import { publishSync } from './status.js'
import { headVersion, recordApplied, recordState, replicaMachines, submitTx } from './store.js'

/** Answers sync.submit; on a new version tells the other replicas' machines (F8) and the members. */
export async function handleSubmit(ctx: Ctx, machineId: string, msg: SyncSubmit) {
  const { result, version } = await submitTx(ctx, machineId, msg)
  ctx.hub.send(machineId, {
    t: 'sync.result',
    groupId: msg.groupId,
    botId: msg.botId,
    submitId: msg.submitId,
    result,
  })
  if (version === undefined) return
  for (const m of await replicaMachines(ctx.db, msg.groupId, msg.botId))
    ctx.hub.send(m, { t: 'sync.available', groupId: msg.groupId, version })
  await publishSync(ctx, msg.groupId)
}

/** Force groups with a bot on `machineId`: their replicas' online state changed. */
async function machineGroups(ctx: Ctx, machineId: string) {
  const rows = await ctx.db
    .selectDistinct({ groupId: groupBots.groupId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(and(eq(bots.machineId, machineId), isNull(groupBots.removedAt), eq(groups.mode, 'force')))
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
    else if (msg.t === 'sync.applied')
      enqueue(
        msg.groupId,
        async () => (await recordApplied(ctx, machineId, msg)) && publishSync(ctx, msg.groupId),
      )
    else if (msg.t === 'sync.state')
      enqueue(
        msg.groupId,
        async () => (await recordState(ctx, machineId, msg)) && publishSync(ctx, msg.groupId),
      )
  }
  const onPresence = (machineId: string) =>
    enqueue(machineId, async () => {
      for (const id of await machineGroups(ctx, machineId)) await publishSync(ctx, id)
    })
  // A reconnected daemon catches its replicas up to the head it missed while away (F9).
  const onOnline = (machineId: string) =>
    enqueue(machineId, async () => {
      for (const groupId of await machineGroups(ctx, machineId)) {
        const version = await headVersion(ctx.db, groupId)
        if (version > 0) ctx.hub.send(machineId, { t: 'sync.available', groupId, version })
        await publishSync(ctx, groupId)
      }
    })
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', onOnline)
  ctx.hub.on('offline', onPresence)
  return async () => {
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', onOnline)
    ctx.hub.off('offline', onPresence)
    await Promise.all(chains.values())
  }
}
