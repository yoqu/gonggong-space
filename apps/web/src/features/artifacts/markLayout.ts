import type { Rect } from '@gonggong/protocol'

// Where the prototype preview's 标注 marks and their bubble go over a screen, in its viewport (screen px). `unit` is a
// mark's px in screen px (marks keep about their size on screen while the device zooms): their room scales with it.

/** A mark's room from the screen's edges, its radius, how far it may stray from its element (mark px). */
const EDGE = 10
const R = 9
const REACH = 12
/** A mark inside an element smaller than this (mark px) is drawn small, at COMPACT of its size (14px). */
const DENSE = 48
const COMPACT = 14 / 18
/** Marks this far apart, centre to centre, as they step along their element (mark px). */
const GAP = 20
/** Less of an element than this shows (mark px), or not all of a smaller one: out of view, no mark. */
const MIN_SHOWN = 24
/** An element lower than this gets its mark outside, above it: on it, the mark would cover its text (mark px). */
const SMALL = 20
/** The bubble's width and the height it wants above its element (px on screen). */
export const BUBBLE_W = 248
const BUBBLE_ROOM = 140
const BUBBLE_GAP = 6

export interface MarkFrame {
  w: number
  h: number
  /** The status bar's height, drawn over the screen's top. */
  status: number
  /** A mini program's capsule, drawn over the screen's top right. */
  capsule: Rect | null
  /** The page's layers pinned over it (a sticky head, a fixed tab bar): what they cover does not show. */
  covers: Rect[]
}

/** The mini program capsule the editor draws (prototype.css `.proto-chrome__capsule`: 48 down, 7 in, 87 × 32). */
export const capsuleOf = (w: number): Rect => ({ x: w - 7 - 87, y: 48, w: 87, h: 32 })

export interface PlacedMark {
  /** The rules (by index, in order) it stands for: more than one only for one element, or elements inside it. */
  ids: number[]
  left: number
  top: number
  /** Scrolled out of view: under the status bar or a pinned layer, or below the screen. */
  out: boolean
  /** Drawn small (14px): inside a small element, it covers less of its text. */
  compact?: boolean
}

/** A mark's label: its number, a group's first number and how many more (`5+2`: a range would read `5·9` as 5 to 9). */
export const markLabel = (ids: number[]) =>
  ids.length > 1 ? `${(ids[0] ?? 0) + 1}+${ids.length - 1}` : `${(ids[0] ?? 0) + 1}`

/** Half a mark's width (mark px): 18px for one digit; a group's about 7px a character plus its 5px padding and border. */
const halfWidth = (ids: number[]) => Math.max(18, markLabel(ids).length * 7 + (ids.length > 1 ? 14 : 10)) / 2

const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const reach = (p: { left: number; top: number }, r: Rect) =>
  Math.hypot(Math.max(r.x - p.left, 0, p.left - r.x - r.w), Math.max(r.y - p.top, 0, p.top - r.y - r.h))
const holds = (a: Rect, b: Rect) =>
  b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1
/** One element, or one inside the other: their rules may share a mark. */
const nested = (a: Rect, b: Rect) => holds(a, b) || holds(b, a)

/**
 * Each element's mark by its element, never off it by more than REACH and never on another element: a large one's on
 * its top right corner (inside it, when the corner would reach a neighbour), a small one's just above its right end
 * (inside, when a neighbour is there). Kept inside the screen and off the status bar, the capsule and the page's
 * pinned layers. Rules of one element (or of nested elements whose marks meet) share one mark (`5+2`) first; marks of
 * different elements step aside along their element's edges.
 */
export function placeMarks(
  items: { i: number; rect: Rect; pinned?: boolean }[],
  frame: MarkFrame,
  unit: number,
): PlacedMark[] {
  const u = (n: number) => n * unit
  const placed: (PlacedMark & { el: Rect })[] = []
  const boxOf = (p: { left: number; top: number; ids: number[]; compact?: boolean }) => {
    const k = p.compact ? COMPACT : 1
    const hw = u(halfWidth(p.ids)) * k
    return { x: p.left - hw, y: p.top - u(R) * k, w: hw * 2, h: u(R) * 2 * k }
  }
  /** A mark's place kept inside the screen, below the status bar. */
  const within = (m: { left: number; top: number; ids: number[]; compact?: boolean }) => {
    const k = m.compact ? COMPACT : 1
    const hw = u(halfWidth(m.ids)) * k
    const r = u(R) * k
    return {
      left: Math.min(Math.max(m.left, hw), frame.w - hw),
      top: Math.min(Math.max(m.top, frame.status + r), frame.h - r),
    }
  }
  const inScreen = (p: { left: number; top: number; compact?: boolean }) => {
    const b = boxOf({ ...p, ids: [] })
    return b.x >= 0 && b.x + b.w <= frame.w && b.y >= frame.status && b.y + b.h <= frame.h
  }
  const cap = frame.capsule && { ...frame.capsule, x: frame.capsule.x - u(2), w: frame.capsule.w + u(4) }
  const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  for (const { i, rect: v, pinned } of items) {
    // One element's rules: one mark, whatever else.
    const twin = placed.find((m) => same(m.el, v))
    if (twin) {
      twin.ids = [...twin.ids, i].sort((a, b) => a - b)
      continue
    }
    const covers = pinned ? [] : frame.covers
    // What shows of it: below the status bar and the pinned layers over its top, above those over its bottom.
    let from = Math.max(v.y, frame.status)
    let to = Math.min(v.y + v.h, frame.h)
    for (const c of covers) {
      if (c.x >= v.x + v.w || c.x + c.w <= v.x) continue
      if (c.y <= from && c.y + c.h > from) from = c.y + c.h
      if (c.y < to && c.y + c.h >= to) to = c.y
    }
    if (to - from < Math.min(u(MIN_SHOWN), v.h) || v.x + v.w <= 0 || v.x >= frame.w) {
      placed.push({ ids: [i], left: v.x + v.w, top: v.y, out: true, el: v })
      continue
    }
    // The other elements with marks: a mark never sits on one.
    const others = items.filter((o) => !same(o.rect, v) && !nested(o.rect, v)).map((o) => o.rect)
    const fits = (p: { left: number; top: number }) => {
      const b = boxOf({ ...p, ids: [i] })
      return (
        b.x >= u(EDGE) / 2 &&
        b.x + b.w <= frame.w - u(EDGE) / 2 &&
        b.y >= frame.status &&
        b.y + b.h <= frame.h &&
        reach(p, v) <= u(REACH) &&
        !(cap && meets(b, cap)) &&
        !covers.some((c) => meets(b, c)) &&
        !others.some((o) => meets(b, o))
      )
    }
    const right = Math.min(v.x + v.w, frame.w - u(EDGE) - u(R))
    const top = Math.max(v.y, (from > v.y ? from : frame.status) + u(R) + u(2))
    // Inside its top right corner, small when the element is (a grid cell): it covers less of its text.
    const small = v.h < u(DENSE) || v.w < u(DENSE)
    const ir = u(R) * (small ? COMPACT : 1)
    const inside = {
      left: Math.min(v.x + v.w, frame.w - u(EDGE)) - ir - u(1),
      top: Math.max(from, v.y) + ir + u(1),
      compact: small,
    }
    const above = { left: right - u(R), top: v.y - u(R) - u(2) }
    const below = { left: right - u(R), top: v.y + v.h + u(R) + u(2) }
    const corners =
      v.h < u(SMALL)
        ? [above, inside, below, { left: v.x + u(R), top: above.top }]
        : [{ left: right, top }, inside, above, below, { left: Math.max(v.x, u(EDGE) + u(R)), top }]
    const base = corners.find(fits) ?? inside
    const g = u(GAP)
    const clear = (p: { left: number; top: number; compact?: boolean }) =>
      !placed.some((m) => !m.out && meets(boxOf({ ...p, ids: [i] }), boxOf(m)))
    const free = (p: { left: number; top: number; compact?: boolean }) => fits(p) && clear(p)
    // A nested element's mark where this one's goes: one mark for both.
    const host = free(base)
      ? null
      : placed.find((m) => !m.out && nested(m.el, v) && meets(boxOf({ ...base, ids: [i] }), boxOf(m)))
    if (host) {
      host.ids = [...host.ids, i].sort((a, b) => a - b)
      continue
    }
    // Another element's mark in the way: along this element's top edge, then down its right edge.
    const along: { left: number; top: number; compact?: boolean }[] = [base]
    for (let x = base.left - g / 2; x >= v.x - u(REACH); x -= g / 2) along.push({ ...base, left: x })
    for (let y = base.top + g / 2; y <= v.y + v.h + u(REACH); y += g / 2) along.push({ ...base, top: y })
    // Still crowded: a step down and in, inside the element (further from its corner, never on another mark).
    for (let k = 1; k <= 6; k++)
      along.push({ ...inside, left: inside.left - (k * g) / 2, top: Math.min(inside.top + k * g, to - ir) })
    const at = along.find(free) ?? along.find((p) => inScreen(p) && clear(p))
    if (at) {
      placed.push({ ids: [i], ...at, out: false, el: v })
      continue
    }
    // Nowhere free: one mark with the one in its way (its bubble lists them all).
    const near = placed.find((m) => !m.out && meets(boxOf({ ...base, ids: [i] }), boxOf(m)))
    if (near) near.ids = [...near.ids, i].sort((a, b) => a - b)
    else placed.push({ ids: [i], ...base, out: false, el: v })
  }
  // A group is wider than one number: off the elements to its right (along its own), then every mark inside the
  // screen whole; marks that still meet become one.
  const shown = placed.filter((m) => !m.out)
  for (const m of shown) {
    const hit = items.filter((o) => !same(o.rect, m.el) && !nested(o.rect, m.el) && meets(boxOf(m), o.rect))
    if (!hit.length) continue
    const left = Math.min(...hit.map((o) => o.rect.x)) - u(halfWidth(m.ids)) - u(1)
    if (reach({ left, top: m.top }, m.el) <= u(REACH)) m.left = left
  }
  for (const m of shown) Object.assign(m, within(m))
  for (let k = 0; k < shown.length; k++) {
    const m = shown[k] as (typeof shown)[number]
    for (const o of shown.slice(0, k)) {
      if (!o.ids.length || !m.ids.length || !meets(boxOf(m), boxOf(o))) continue
      o.ids = [...o.ids, ...m.ids].sort((a, b) => a - b)
      m.ids = []
      Object.assign(o, within(o))
    }
  }
  return placed.filter((m) => m.ids.length).map(({ el: _, ...m }) => m)
}

/**
 * The rule bubble beside a mark: right-aligned to it, above the element when there is room, below it otherwise, so it
 * never covers the element. `bottom` is from the screen's bottom. `unscale`: screen px per px on screen.
 */
export function bubbleAt(
  mark: { left: number; top: number },
  el: Rect,
  frame: MarkFrame,
  unscale: number,
): { left: number; top?: number; bottom?: number } {
  const edge = EDGE * unscale
  const w = BUBBLE_W * unscale
  const room = BUBBLE_ROOM * unscale
  const left = Math.min(Math.max(mark.left - w, edge), frame.w - w - edge)
  const gap = BUBBLE_GAP * unscale
  if (el.y - frame.status > room) return { left, bottom: frame.h - (el.y - gap) }
  if (el.y + el.h + gap + room <= frame.h) return { left, top: el.y + el.h + gap }
  // A tall element: inside it, under its mark, kept on the screen.
  return { left, top: Math.min(Math.max(mark.top + R * unscale + gap, frame.status), frame.h - room) }
}
