import { useEffect, useRef } from 'react'

/**
 * The bridge between the canvas and the screens of an artifact preview (产物托管 plan 3.4, R2 contract): every screen
 * page carries a script that posts `{source:'gg-bridge', …}` to this window and listens for `{source:'gg-host', …}`.
 * A message counts only when it comes from the preview's exact origin and from one of the canvas's screen frames, and
 * names that frame's own file.
 */
export type BridgeMode = 'preview' | 'mark' | 'edit'

export interface BridgeRect {
  x: number
  y: number
  w: number
  h: number
}

/** A `data-gg-link` element of a screen, in document coordinates (where the canvas starts its link arrow). */
export interface LinkSpot {
  ggId: string | null
  screen: string
  rect: BridgeRect
}

export type FromScreen =
  | { type: 'ready'; file: string; width?: number; height?: number; links?: unknown }
  | { type: 'size'; file: string; width: number; height: number; links?: unknown }
  | { type: 'hover'; file: string; ggId: string | null; rect: BridgeRect | null }
  | {
      type: 'select'
      file: string
      ggId: string | null
      selector: string
      rect: BridgeRect
      tag: string
      text: string
      textOnly: boolean
      computed: Record<string, string>
      inlineStyle: string
      src: string | null
      href: string | null
      link: string | null
      /** `data-gg-transition` when valid, and the element's outer HTML (cut short); older bridges send neither. */
      transition?: string | null
      snippet?: string
    }
  | { type: 'nav'; file: string; screen: string; transition?: string }
  | { type: 'back'; file: string }

export type ToScreen =
  | { type: 'mode'; mode: BridgeMode }
  | { type: 'highlight'; ggIds: string[] }
  | { type: 'select-clear' }
  | { type: 'scroll-to'; ggId: string }
  | { type: 'reload' }

const TYPES = new Set(['ready', 'size', 'hover', 'select', 'nav', 'back'])
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The message, when `e` is a bridge message of the frame showing its file; null for anything else. */
export function acceptBridge(
  e: Pick<MessageEvent, 'data' | 'origin' | 'source'>,
  origin: string | null,
  frames: ReadonlyMap<string, HTMLIFrameElement>,
): FromScreen | null {
  if (!origin || e.origin !== origin || !e.source) return null
  const d = e.data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d.source !== 'gg-bridge' || !TYPES.has(String(d.type))) return null
  const frame = typeof d.file === 'string' ? frames.get(d.file) : undefined
  if (!frame || frame.contentWindow !== e.source) return null
  if (d.type === 'size' && !(isNum(d.width) && isNum(d.height))) return null
  if (d.type === 'nav' && typeof d.screen !== 'string') return null
  return d as unknown as FromScreen
}

const isRect = (r: unknown): r is BridgeRect => {
  const o = r as Record<string, unknown> | null
  return !!o && typeof o === 'object' && isNum(o.x) && isNum(o.y) && isNum(o.w) && isNum(o.h)
}

/** The well-formed link spots of a `ready` / `size` message; undefined when it reports none. */
export function linkSpots(links: unknown): LinkSpot[] | undefined {
  if (!Array.isArray(links)) return undefined
  return links.flatMap((l) => {
    const o = l as Record<string, unknown> | null
    if (!o || typeof o.screen !== 'string' || !isRect(o.rect)) return []
    const ggId = typeof o.ggId === 'string' && /^\d{1,9}$/.test(o.ggId) ? o.ggId : null
    return [{ ggId, screen: o.screen, rect: o.rect }]
  })
}

export function postToScreen(frame: HTMLIFrameElement | undefined, origin: string | null, msg: ToScreen) {
  if (origin) frame?.contentWindow?.postMessage({ source: 'gg-host', ...msg }, origin)
}

/** Listens for the screens' messages while mounted; `frames` maps a file to the frame showing it. */
export function useBridge(
  origin: string | null,
  frames: ReadonlyMap<string, HTMLIFrameElement>,
  onMessage: (m: FromScreen) => void,
) {
  const handler = useRef(onMessage)
  handler.current = onMessage
  useEffect(() => {
    const listen = (e: MessageEvent) => {
      const m = acceptBridge(e, origin, frames)
      if (m) handler.current(m)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [origin, frames])
}
