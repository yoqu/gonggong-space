import {
  ArtifactTransition,
  BRIDGE_MARK_RECT_MAX,
  type BridgeFromShell,
  type BridgeLinkRect,
  type BridgeToShell,
  type Rect,
} from '@gonggong/protocol'
import { useEffect, useRef } from 'react'
/** What a screen may post. */
export type BridgeMessage = BridgeFromShell

/** What the canvas may post to a screen. */
export type HostMessage = BridgeToShell

/**
 * The bridge between the canvas and the screens of an artifact preview (产物托管 plan 3.4, R2 contract): every screen
 * page carries a script that posts `{source:'gg-bridge', …}` to this window and listens for `{source:'gg-host', …}`.
 * A message counts only when it comes from the preview's exact origin and from one of the canvas's screen frames, and
 * names that frame's own file.
 */
const TYPES = new Set(['ready', 'size', 'hover', 'select', 'nav', 'back', 'scroll', 'mark-rect'])
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The message, when `e` is a bridge message of the frame showing its file; null for anything else. */
export function acceptBridge(
  e: Pick<MessageEvent, 'data' | 'origin' | 'source'>,
  origin: string | null,
  frames: ReadonlyMap<string, HTMLIFrameElement>,
): BridgeMessage | null {
  if (!origin || e.origin !== origin || !e.source) return null
  const d = e.data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d.source !== 'gg-bridge' || !TYPES.has(String(d.type))) return null
  const frame = typeof d.file === 'string' ? frames.get(d.file) : undefined
  if (!frame || frame.contentWindow !== e.source) return null
  if (d.type === 'size' && !(isNum(d.width) && isNum(d.height))) return null
  if (d.type === 'nav' && typeof d.screen !== 'string') return null
  if (d.type === 'scroll' && !(isNum(d.scrollX) && isNum(d.scrollY))) return null
  if (d.type === 'mark-rect') {
    if (!isRect(d.rect) || !Array.isArray(d.ggIds)) return null
    const ggIds = d.ggIds.filter((id): id is string => typeof id === 'string' && /^\d{1,9}$/.test(id))
    return {
      source: 'gg-bridge',
      type: 'mark-rect',
      file: d.file as string,
      rect: d.rect,
      ggIds: ggIds.slice(0, BRIDGE_MARK_RECT_MAX),
    }
  }
  return d as unknown as BridgeFromShell
}

function isRect(r: unknown): r is Rect {
  const o = r as Record<string, unknown> | null
  return !!o && typeof o === 'object' && isNum(o.x) && isNum(o.y) && isNum(o.w) && isNum(o.h)
}

/** The well-formed link spots of a `ready` / `size` message; undefined when it reports none. */
export function linkSpots(links: unknown): BridgeLinkRect[] | undefined {
  if (!Array.isArray(links)) return undefined
  return links.flatMap((l) => {
    const o = l as Record<string, unknown> | null
    if (!o || typeof o.screen !== 'string' || !isRect(o.rect)) return []
    const ggId = typeof o.ggId === 'string' && /^\d{1,9}$/.test(o.ggId) ? o.ggId : null
    const transition = ArtifactTransition.safeParse(o.transition)
    return [
      { ggId, screen: o.screen, rect: o.rect, ...(transition.success && { transition: transition.data }) },
    ]
  })
}

/**
 * Frames that said `ready`, with the origin they said it from. Until then a frame shows about:blank (the parent's
 * origin), so posting to it would only log an origin mismatch and be dropped: messages wait in `pending` instead.
 */
const ready = new WeakMap<HTMLIFrameElement, string>()
const pending = new WeakMap<HTMLIFrameElement, Map<HostMessage['type'], HostMessage>>()

const send = (frame: HTMLIFrameElement, origin: string, msg: HostMessage) =>
  frame.contentWindow?.postMessage({ source: 'gg-host', ...msg }, origin)

/** `frame` said `ready` from `origin`: it takes messages from now on, the latest queued one of each type first. */
export function markReady(frame: HTMLIFrameElement, origin: string) {
  ready.set(frame, origin)
  const queued = pending.get(frame)
  pending.delete(frame)
  for (const msg of queued?.values() ?? []) send(frame, origin, msg)
}

/** Posts to a screen that said `ready` from `origin`; until it does, keeps the latest message of each type. */
export function postToScreen(frame: HTMLIFrameElement | undefined, origin: string | null, msg: HostMessage) {
  if (!frame || !origin) return
  if (ready.get(frame) === origin) return send(frame, origin, msg)
  const queued = pending.get(frame) ?? new Map()
  queued.set(msg.type, msg)
  pending.set(frame, queued)
}

/** Listens for the screens' messages while mounted; `frames` maps a file to the frame showing it. */
export function useBridge(
  origin: string | null,
  frames: ReadonlyMap<string, HTMLIFrameElement>,
  onMessage: (m: BridgeMessage) => void,
) {
  const handler = useRef(onMessage)
  handler.current = onMessage
  useEffect(() => {
    const listen = (e: MessageEvent) => {
      const m = acceptBridge(e, origin, frames)
      if (!m) return
      const frame = frames.get(m.file)
      if (m.type === 'ready' && frame && origin) markReady(frame, origin)
      handler.current(m)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [origin, frames])
}
