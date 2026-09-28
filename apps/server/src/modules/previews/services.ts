import type { ServiceInfo } from '@gonggong/protocol'
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, previews, services } from '../../db/schema.js'
import { closePortListener } from './gateway.js'

const LIVE = ['starting', 'running']

/**
 * The machine's open previews on loopback ports: the only ones its tunnel will forward to (plan P9). `onConnect`
 * skips an empty list: a fresh daemon allows nothing yet, and the server never opens streams for closed previews.
 */
export async function syncPreviews(ctx: Ctx, machineId: string, { onConnect = false } = {}) {
  const open = await ctx.db
    .select({ id: previews.id, port: previews.port })
    .from(previews)
    .where(and(eq(previews.machineId, machineId), isNull(previews.closedAt)))
  const list = open.flatMap((p) => (p.port === null ? [] : [{ id: p.id, port: p.port }]))
  if (onConnect && !list.length) return
  ctx.hub.send(machineId, { t: 'previews.sync', previews: list })
}

/** service.state: trusted only for bots bound to the reporting machine and still in that group. */
export async function recordService(ctx: Ctx, machineId: string, s: ServiceInfo) {
  const [ok] = await ctx.db
    .select({ id: bots.id })
    .from(bots)
    .innerJoin(groupBots, eq(groupBots.botId, bots.id))
    .where(and(eq(bots.id, s.botId), eq(bots.machineId, machineId), eq(groupBots.groupId, s.groupId)))
  if (!ok) return
  const ended = !LIVE.includes(s.status)
  const values = {
    status: s.status,
    exitCode: s.exitCode,
    port: s.port,
    exitedAt: ended ? ctx.now() : null,
  }
  await ctx.db
    .insert(services)
    .values({
      ...values,
      id: s.id,
      machineId,
      groupId: s.groupId,
      botId: s.botId,
      runId: s.runId,
      name: s.name,
      command: s.command,
      cwd: s.cwd,
    })
    .onConflictDoUpdate({ target: services.id, set: values })
  if (ended) return closeServicePreviews(ctx, machineId, [s.id])
  // preview_static publishes by port before this report arrives.
  if (s.port !== null)
    await ctx.db
      .update(previews)
      .set({ serviceId: s.id })
      .where(
        and(
          eq(previews.groupId, s.groupId),
          eq(previews.botId, s.botId),
          eq(previews.port, s.port),
          isNull(previews.serviceId),
          isNull(previews.closedAt),
        ),
      )
}

/** Hello: live services the daemon no longer reports died with its previous process. */
export async function reconcileServices(ctx: Ctx, machineId: string, snapshot: ServiceInfo[]) {
  const ids = snapshot.map((s) => s.id)
  const lost = await ctx.db
    .update(services)
    .set({ status: 'exited', exitedAt: ctx.now() })
    .where(
      and(
        eq(services.machineId, machineId),
        inArray(services.status, LIVE),
        ids.length ? notInArray(services.id, ids) : undefined,
      ),
    )
    .returning({ id: services.id })
  for (const s of snapshot) await recordService(ctx, machineId, s)
  if (lost.length)
    await closeServicePreviews(
      ctx,
      machineId,
      lost.map((s) => s.id),
    )
}

async function closeServicePreviews(ctx: Ctx, machineId: string, serviceIds: string[]) {
  const closed = await ctx.db
    .update(previews)
    .set({ closedAt: ctx.now() })
    .where(and(inArray(previews.serviceId, serviceIds), isNull(previews.closedAt)))
    .returning({ id: previews.id })
  for (const p of closed) await closePortListener(ctx, p.id)
  if (closed.length) await syncPreviews(ctx, machineId)
}
