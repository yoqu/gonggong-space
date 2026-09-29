import { type CastTarget, type DaemonToServer, LIVE_WATCH_SECONDS, type PreviewDto } from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { previews } from '../../db/schema.js'
import { publishPreviews } from '../previews/service.js'

type Preview = typeof previews.$inferSelect
type CastStateMsg = Extract<DaemonToServer, { t: 'cast.state' }>
/** Kinds the machine publishes through gg-cast. */
const CAST_KINDS = ['gui']
const REAP_EVERY_MS = 15_000

interface LiveState {
  /** Per watched preview: its machine and each viewer's lease end (ms). */
  watches: Map<string, { machineId: string; until: Map<string, number> }>
  /** The machines' gg-cast state per preview while asked to publish it. */
  casts: Map<string, NonNullable<PreviewDto['live']>>
}
const states = new WeakMap<Ctx, LiveState>()

function live(ctx: Ctx): LiveState {
  let s = states.get(ctx)
  if (!s) {
    s = { watches: new Map(), casts: new Map() }
    states.set(ctx, s)
  }
  return s
}

export const castState = (ctx: Ctx, previewId: string) => live(ctx).casts.get(previewId) ?? null

function watched(ctx: Ctx, previewId: string) {
  const now = ctx.now().getTime()
  return [...(live(ctx).watches.get(previewId)?.until.values() ?? [])].some((t) => t > now)
}

/**
 * A viewer renews its lease on a live preview (plan B2): the machine publishes while any lease holds, so gg-cast and
 * the screen recording run only while someone watches. Watching is a visit (plan P11).
 */
export async function watch(ctx: Ctx, preview: Preview, userId: string) {
  const fresh = !watched(ctx, preview.id)
  const entry = live(ctx).watches.get(preview.id) ?? { machineId: preview.machineId, until: new Map() }
  entry.until.set(userId, ctx.now().getTime() + LIVE_WATCH_SECONDS * 1000)
  live(ctx).watches.set(preview.id, entry)
  await ctx.db.update(previews).set({ lastAccessAt: ctx.now() }).where(eq(previews.id, preview.id))
  if (fresh) await syncCasts(ctx, preview.machineId)
}

/** The machine's open, watched live previews as cast.sync; `onConnect` skips an empty list like previews.sync. */
export async function syncCasts(ctx: Ctx, machineId: string, { onConnect = false } = {}) {
  const open = await ctx.db
    .select({ id: previews.id, serviceId: previews.serviceId })
    .from(previews)
    .where(
      and(eq(previews.machineId, machineId), isNull(previews.closedAt), inArray(previews.kind, CAST_KINDS)),
    )
  const casts: CastTarget[] = []
  for (const p of open) {
    if (p.serviceId && watched(ctx, p.id)) casts.push({ previewId: p.id, service: p.serviceId })
    else live(ctx).casts.delete(p.id)
  }
  if (onConnect && !casts.length) return
  ctx.hub.send(machineId, { t: 'cast.sync', casts })
}

/** Drops lapsed leases; machines whose previews nobody watches any more stop publishing them. */
export async function reapWatches(ctx: Ctx) {
  const now = ctx.now().getTime()
  const machines = new Set<string>()
  for (const [previewId, entry] of live(ctx).watches) {
    for (const [userId, until] of entry.until) if (until <= now) entry.until.delete(userId)
    if (entry.until.size) continue
    live(ctx).watches.delete(previewId)
    machines.add(entry.machineId)
  }
  for (const machineId of machines) await syncCasts(ctx, machineId)
}

/** cast.state, trusted only for the reporting machine's own previews. */
async function recordCastState(ctx: Ctx, machineId: string, msg: CastStateMsg) {
  const [p] = await ctx.db
    .select({ groupId: previews.groupId })
    .from(previews)
    .where(and(eq(previews.id, msg.previewId), eq(previews.machineId, machineId)))
  if (!p) return
  live(ctx).casts.set(msg.previewId, { state: msg.state, error: msg.error })
  await publishPreviews(ctx, p.groupId)
}

export function startLiveEngine(ctx: Ctx) {
  let chain = Promise.resolve()
  const onMessage = (machineId: string, msg: DaemonToServer) => {
    if (msg.t !== 'cast.state') return
    chain = chain
      .then(() => recordCastState(ctx, machineId, msg))
      .catch((err) => console.error('cast.state:', err))
  }
  const onOnline = (machineId: string) => {
    void syncCasts(ctx, machineId, { onConnect: true }).catch((err) => console.error('cast.sync:', err))
  }
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', onOnline)
  const timer = setInterval(
    () => void reapWatches(ctx).catch((err) => console.error('live watches:', err)),
    REAP_EVERY_MS,
  )
  return async () => {
    clearInterval(timer)
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', onOnline)
    await chain
  }
}
