import type {
  ArtifactEditOp,
  ArtifactTransition,
  BridgeBackRect,
  BridgeLinkRect,
  Rect,
} from '@gonggong/protocol'

// The prototype editor (Stitch capability list §7): playing the screens' links with transitions, and editing them.

/** How a screen comes in: a link's transition, or `slide-down` going back from a `slide-up`. */
export type Enter = ArtifactTransition | 'slide-down'

export interface ProtoNav {
  /** The screens walked through, the current one last, each with the transition that brought it. */
  stack: { screen: string; via: ArtifactTransition }[]
  enter: Enter
  /** Bumped on every move, so the screen's enter animation replays. */
  step: number
}

export type NavAction =
  | { type: 'go'; screen: string; transition?: ArtifactTransition }
  | { type: 'back' }
  /** Picked from the screen list: starts over there. */
  | { type: 'jump'; screen: string }

export const startNav = (screen: string): ProtoNav => ({
  stack: [{ screen, via: 'none' }],
  enter: 'none',
  step: 0,
})

const REVERSE: Record<ArtifactTransition, Enter> = {
  none: 'none',
  push: 'push-back',
  'push-back': 'push',
  'slide-up': 'slide-down',
  fade: 'fade',
}

/** Links without `data-gg-transition` push (the web-prototype kit's default). */
export function navReducer(s: ProtoNav, a: NavAction): ProtoNav {
  if (a.type === 'go') {
    const via = a.transition ?? 'push'
    return { stack: [...s.stack, { screen: a.screen, via }], enter: via, step: s.step + 1 }
  }
  if (a.type === 'jump') return { ...startNav(a.screen), step: s.step + 1 }
  const last = s.stack[s.stack.length - 1]
  if (s.stack.length < 2 || !last) return s
  return { stack: s.stack.slice(0, -1), enter: REVERSE[last.via], step: s.step + 1 }
}

export const currentScreen = (s: ProtoNav) => s.stack[s.stack.length - 1]?.screen ?? ''

/** The class that animates the screen in; none for an instant change. */
export const enterClass = (e: Enter) => (e === 'none' ? '' : `proto-enter--${e}`)

/** Device frames of the editor's device switch (Stitch's Mobile / Tablet / Desktop). */
export const PROTO_DEVICES = {
  mobile: { w: 390, h: 844 },
  tablet: { w: 768, h: 1024 },
  desktop: { w: 1280, h: 800 },
} as const
export type ProtoDevice = keyof typeof PROTO_DEVICES

/** Connect Element's Apply Connection: the element opens `to` with `transition`. */
export const connectOps = (
  el: { file: string; ggId: string },
  to: string,
  transition: ArtifactTransition,
): ArtifactEditOp[] => [
  { kind: 'attr', file: el.file, ggId: el.ggId, name: 'data-gg-link', value: to },
  { kind: 'attr', file: el.file, ggId: el.ggId, name: 'data-gg-transition', value: transition },
]

/** Disconnect: the link goes, and its transition with it when it has one. */
export const disconnectOps = (el: {
  file: string
  ggId: string
  transition?: string | null
}): ArtifactEditOp[] => [
  { kind: 'attr', file: el.file, ggId: el.ggId, name: 'data-gg-link', value: null },
  ...(el.transition
    ? [
        {
          kind: 'attr' as const,
          file: el.file,
          ggId: el.ggId,
          name: 'data-gg-transition' as const,
          value: null,
        },
      ]
    : []),
]

/** The `data-gg-back` elements of a `ready` / `size` message. */
export function backRects(back: unknown): BridgeBackRect[] {
  if (!Array.isArray(back)) return []
  return back.flatMap((b) => {
    const o = b as Record<string, unknown> | null
    const r = o?.rect as Record<string, unknown> | undefined
    if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return []
    const ggId = typeof o?.ggId === 'string' && /^\d{1,9}$/.test(o.ggId) ? o.ggId : null
    return [{ ggId, rect: r as unknown as Rect }]
  })
}

/**
 * The connected element a click inside it landed in (Stitch selects the link, not the text in it): the smallest
 * `data-gg-link` with a source id that holds the picked rect. Rects in document coordinates.
 */
export function linkHost(spots: BridgeLinkRect[], r: Rect): BridgeLinkRect | null {
  const holds = (q: Rect) =>
    r.x >= q.x - 0.5 && r.y >= q.y - 0.5 && r.x + r.w <= q.x + q.w + 0.5 && r.y + r.h <= q.y + q.h + 0.5
  let best: BridgeLinkRect | null = null
  for (const s of spots)
    if (s.ggId && holds(s.rect) && (!best || s.rect.w * s.rect.h < best.rect.w * best.rect.h)) best = s
  return best
}

const POP_GAP = 8

/**
 * Where the element menu goes on the stage: under the element, above it when the room below is short (a tab bar at
 * the device's bottom), else as low as fits; horizontally inside `edges` (the screen list and the rail).
 */
export function menuPlace(
  anchor: Rect,
  pop: { w: number; h: number },
  room: { width: number; height: number },
  edges: { left: number; right: number },
) {
  const left = Math.max(edges.left, Math.min(anchor.x, room.width - edges.right - pop.w))
  const below = anchor.y + anchor.h + POP_GAP
  const above = anchor.y - POP_GAP - pop.h
  const top =
    below + pop.h <= room.height - POP_GAP
      ? below
      : above >= POP_GAP
        ? above
        : Math.max(POP_GAP, room.height - POP_GAP - pop.h)
  return { left, top }
}

export const GUIDE_KEY = 'gg.art.protoGuide'
