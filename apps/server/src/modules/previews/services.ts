import { randomUUID } from 'node:crypto'
import type { DaemonToServer, ServiceInfo } from '@gonggong/protocol'
import { and, eq, inArray, isNull, ne, notInArray, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, previews, services } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'

const LIVE = ['starting', 'running']
/** The daemon waits up to 60 s for the port before it answers. */
const RESTART_TIMEOUT_MS = 75_000

type RestartResult = Extract<DaemonToServer, { t: 'service.restart.result' }>
const restarts = new Map<string, { machineId: string; resolve: (r: RestartResult | null) => void }>()

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
  if (!ended) await follow(ctx, machineId, s)
}

/**
 * A service keeps its previews through restarts (plan: a card must not die with the process): open previews of the
 * (group, bot) on its port, or of an earlier service under its name, now point to it; a static site may come back
 * on another port, which the tunnel then allows instead.
 */
async function follow(ctx: Ctx, machineId: string, s: ServiceInfo) {
  const sameName = ctx.db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.groupId, s.groupId), eq(services.botId, s.botId), eq(services.name, s.name)))
  const moved = await ctx.db
    .update(previews)
    .set({ serviceId: s.id, ...(s.port === null ? {} : { port: s.port }) })
    .where(
      and(
        eq(previews.groupId, s.groupId),
        eq(previews.botId, s.botId),
        isNull(previews.closedAt),
        or(s.port === null ? undefined : eq(previews.port, s.port), inArray(previews.serviceId, sameName)),
        or(
          isNull(previews.serviceId),
          ne(previews.serviceId, s.id),
          s.port === null ? undefined : ne(previews.port, s.port),
        ),
      ),
    )
    .returning({ id: previews.id })
  if (moved.length) await syncPreviews(ctx, machineId)
}

/** Hello: live services the daemon no longer reports died with its previous process. */
export async function reconcileServices(ctx: Ctx, machineId: string, snapshot: ServiceInfo[]) {
  const ids = snapshot.map((s) => s.id)
  await ctx.db
    .update(services)
    .set({ status: 'exited', exitedAt: ctx.now() })
    .where(
      and(
        eq(services.machineId, machineId),
        inArray(services.status, LIVE),
        ids.length ? notInArray(services.id, ids) : undefined,
      ),
    )
  for (const s of snapshot) await recordService(ctx, machineId, s)
}

/** Starts a hosted service again as it was started; fails with the machine's reason. */
export async function restartService(ctx: Ctx, svc: { id: string; machineId: string }) {
  const requestId = randomUUID()
  const answer = new Promise<RestartResult | null>((resolve) => {
    restarts.set(requestId, { machineId: svc.machineId, resolve })
    setTimeout(() => settle(requestId, null), RESTART_TIMEOUT_MS).unref()
  })
  if (!ctx.hub.send(svc.machineId, { t: 'service.restart', requestId, serviceId: svc.id }))
    settle(requestId, null)
  const res = await answer
  if (!res) return fail('conflict', '服务所在的机器离线或没有响应')
  if (res.error) return fail('conflict', res.error)
}

/** service.restart.result, in order after the service.state reports that came before it. */
export function settleRestart(machineId: string, msg: RestartResult) {
  if (restarts.get(msg.requestId)?.machineId === machineId) settle(msg.requestId, msg)
}

function settle(requestId: string, res: RestartResult | null) {
  const w = restarts.get(requestId)
  restarts.delete(requestId)
  w?.resolve(res)
}
