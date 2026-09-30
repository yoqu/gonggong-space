import {
  type CastTarget,
  type ControlReq,
  type DaemonToServer,
  LIVE_DEFAULT_FPS,
  LIVE_WATCH_SECONDS,
  type PreviewDto,
} from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { RoomServiceClient } from 'livekit-server-sdk'
import type { Ctx } from '../../context.js'
import { previews } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { publishPreviews } from '../previews/service.js'

type Preview = typeof previews.$inferSelect
type CastStateMsg = Extract<DaemonToServer, { t: 'cast.state' }>
type Control = NonNullable<PreviewDto['control']>
type Member = Control['requests'][number]
/** Kinds the machine publishes through gg-cast: they have a live view and can be controlled. */
export const CAST_KINDS = ['gui', 'miniprogram']
const REAP_EVERY_MS = 15_000

interface LiveState {
  /** Per watched preview: its machine, each viewer's lease end (ms) and frame rate, and the rate last sent to it. */
  watches: Map<string, { machineId: string; until: Map<string, { at: number; fps: number }>; sent: number }>
  /** The machines' gg-cast state per preview while asked to publish it. */
  casts: Map<string, NonNullable<PreviewDto['live']>>
  controls: Map<string, Control>
  /** Control changes one at a time: each awaits LiveKit before it takes effect. */
  controlling: Promise<unknown>
}
const states = new WeakMap<Ctx, LiveState>()

function live(ctx: Ctx): LiveState {
  let s = states.get(ctx)
  if (!s) {
    s = { watches: new Map(), casts: new Map(), controls: new Map(), controlling: Promise.resolve() }
    states.set(ctx, s)
  }
  return s
}

export const castState = (ctx: Ctx, previewId: string) => live(ctx).casts.get(previewId) ?? null

/** For the preview list: null for previews without a live view. */
export const controlOf = (ctx: Ctx, p: { id: string; kind: string }): Control | null =>
  CAST_KINDS.includes(p.kind) ? (live(ctx).controls.get(p.id) ?? { controller: null, requests: [] }) : null

function controlState(ctx: Ctx, previewId: string): Control {
  let c = live(ctx).controls.get(previewId)
  if (!c) {
    c = { controller: null, requests: [] }
    live(ctx).controls.set(previewId, c)
  }
  return c
}

function watchedBy(ctx: Ctx, previewId: string, userId: string) {
  return (live(ctx).watches.get(previewId)?.until.get(userId)?.at ?? 0) > ctx.now().getTime()
}

function leases(ctx: Ctx, previewId: string) {
  const now = ctx.now().getTime()
  return [...(live(ctx).watches.get(previewId)?.until.values() ?? [])].filter((l) => l.at > now)
}

const watched = (ctx: Ctx, previewId: string) => leases(ctx, previewId).length > 0
const fpsOf = (ctx: Ctx, previewId: string) => Math.max(0, ...leases(ctx, previewId).map((l) => l.fps))

/**
 * A viewer renews its lease on a live preview (plan B2): the machine publishes while any lease holds, so gg-cast and
 * the screen recording run only while someone watches. Watching is a visit (plan P11).
 */
export async function watch(ctx: Ctx, preview: Preview, userId: string, fps = LIVE_DEFAULT_FPS) {
  const entry = live(ctx).watches.get(preview.id) ?? {
    machineId: preview.machineId,
    until: new Map(),
    sent: 0,
  }
  entry.until.set(userId, { at: ctx.now().getTime() + LIVE_WATCH_SECONDS * 1000, fps })
  live(ctx).watches.set(preview.id, entry)
  await ctx.db.update(previews).set({ lastAccessAt: ctx.now() }).where(eq(previews.id, preview.id))
  if (fpsOf(ctx, preview.id) !== entry.sent) await syncCasts(ctx, preview.machineId)
}

/** The machine's open, watched live previews as cast.sync; `onConnect` skips an empty list like previews.sync. */
export async function syncCasts(ctx: Ctx, machineId: string, { onConnect = false } = {}) {
  const open = await ctx.db
    .select({ id: previews.id, serviceId: previews.serviceId, project: previews.project })
    .from(previews)
    .where(
      and(eq(previews.machineId, machineId), isNull(previews.closedAt), inArray(previews.kind, CAST_KINDS)),
    )
  const casts: CastTarget[] = []
  for (const p of open) {
    const target = p.project ? { miniprogram: p.project } : p.serviceId ? { service: p.serviceId } : null
    const entry = live(ctx).watches.get(p.id)
    if (target && entry && watched(ctx, p.id)) {
      entry.sent = fpsOf(ctx, p.id)
      casts.push({ previewId: p.id, ...target, fps: entry.sent })
    } else live(ctx).casts.delete(p.id)
  }
  if (onConnect && !casts.length) return
  ctx.hub.send(machineId, { t: 'cast.sync', casts })
}

/**
 * Drops lapsed leases: machines whose previews nobody watches any more stop publishing them, and a controller or
 * requester who stopped watching loses control or the request.
 */
export async function reapWatches(ctx: Ctx) {
  const now = ctx.now().getTime()
  const machines = new Set<string>()
  for (const [previewId, entry] of live(ctx).watches) {
    for (const [userId, lease] of entry.until) if (lease.at <= now) entry.until.delete(userId)
    if (!entry.until.size) live(ctx).watches.delete(previewId)
    if (fpsOf(ctx, previewId) !== entry.sent) machines.add(entry.machineId)
  }
  for (const machineId of machines) await syncCasts(ctx, machineId)
  for (const [previewId, c] of live(ctx).controls) {
    const requests = c.requests.filter((r) => watchedBy(ctx, previewId, r.id))
    const lapsed = c.controller && !watchedBy(ctx, previewId, c.controller.id)
    if (!lapsed && requests.length === c.requests.length) continue
    c.requests = requests
    if (lapsed) await serially(ctx, () => setController(ctx, previewId, null))
    const [p] = await ctx.db
      .select({ groupId: previews.groupId })
      .from(previews)
      .where(eq(previews.id, previewId))
    if (p) await publishPreviews(ctx, p.groupId)
  }
}

function serially<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  const s = live(ctx)
  const next = s.controlling.then(fn, fn)
  s.controlling = next.catch(() => {})
  return next
}

/** `manages`: the member is the bot owner or a group admin. */
export async function control(ctx: Ctx, preview: Preview, user: Member, req: ControlReq, manages: boolean) {
  if ((req.action === 'grant' || req.action === 'deny' || req.action === 'revoke') && !manages)
    fail('forbidden', '仅 Bot 主人或群管理员可操作')
  await serially(ctx, async () => {
    const c = controlState(ctx, preview.id)
    const mine = c.controller?.id === user.id
    switch (req.action) {
      case 'request':
        if (manages) await setController(ctx, preview.id, user)
        else if (!mine && !c.requests.some((r) => r.id === user.id)) c.requests.push(user)
        break
      case 'release':
        if (mine) await setController(ctx, preview.id, null)
        c.requests = c.requests.filter((r) => r.id !== user.id)
        break
      case 'grant': {
        const asked = c.requests.find((r) => r.id === req.userId)
        if (!asked) return fail('not_found', '没有这个控制请求')
        await setController(ctx, preview.id, asked)
        break
      }
      case 'deny':
        c.requests = c.requests.filter((r) => r.id !== req.userId)
        break
      case 'revoke':
        await setController(ctx, preview.id, null)
        break
    }
  })
  await publishPreviews(ctx, preview.groupId)
}

/** Moves control, LiveKit first: the previous controller's connections must stop being able to send input. */
async function setController(ctx: Ctx, previewId: string, next: Member | null) {
  const c = controlState(ctx, previewId)
  if (c.controller?.id === next?.id) return
  if (c.controller) await allowInput(ctx, previewId, c.controller.id, false)
  if (next) await allowInput(ctx, previewId, next.id, true)
  c.controller = next
  c.requests = c.requests.filter((r) => r.id !== next?.id)
}

/** Every connection of `userId` in the preview's room may (not) publish data (LiveKit lists none for no room). */
async function allowInput(ctx: Ctx, room: string, userId: string, allow: boolean) {
  const ep = await ctx.livekit.endpoint()
  const rooms = new RoomServiceClient(ep.api, ep.key, ep.secret)
  const participants = await rooms.listParticipants(room)
  for (const p of participants.filter((p) => p.identity.startsWith(`u:${userId}:`)))
    await rooms.updateParticipant(room, p.identity, {
      permission: { canSubscribe: true, canPublish: false, canPublishData: allow },
    })
}

/** cast.state, trusted only for the reporting machine's own previews. */
async function recordCastState(ctx: Ctx, machineId: string, msg: CastStateMsg) {
  const [p] = await ctx.db
    .select({ groupId: previews.groupId })
    .from(previews)
    .where(and(eq(previews.id, msg.previewId), eq(previews.machineId, machineId)))
  if (!p) return
  const next = { state: msg.state, error: msg.error, missing: msg.missing, devtools: msg.devtools }
  // A mini program waiting on its devtools reports the same failure every few seconds.
  if (JSON.stringify(live(ctx).casts.get(msg.previewId)) === JSON.stringify(next)) return
  live(ctx).casts.set(msg.previewId, next)
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
