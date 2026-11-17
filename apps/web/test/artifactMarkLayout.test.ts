import type { Rect } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import {
  bubbleAt,
  capsuleOf,
  markLabel,
  type PlacedMark,
  placeMarks,
} from '../src/features/artifacts/markLayout'

// Where the prototype preview's 标注 marks go over a screen (its viewport, in screen px; marks at 1:1).
const phone = { w: 390, h: 844, status: 47, capsule: null, covers: [] }
const mini = { w: 375, h: 812, status: 44, capsule: capsuleOf(375), covers: [] }
const at = (x: number, y: number, w = 80, h = 40) => ({ x, y, w, h })
/** From a mark's centre to its element's box (0 inside it). */
const reach = (m: PlacedMark, r: Rect) =>
  Math.hypot(Math.max(r.x - m.left, 0, m.left - r.x - r.w), Math.max(r.y - m.top, 0, m.top - r.y - r.h))
/** A mark's box on screen: 18px tall, as wide as its number(s). */
const boxOf = (m: PlacedMark, unit = 1) => {
  const k = m.compact ? 14 / 18 : 1
  const w = Math.max(18, markLabel(m.ids).length * 7 + (m.ids.length > 1 ? 14 : 10)) * k * unit
  return { x: m.left - w / 2, y: m.top - 9 * k * unit, w, h: 18 * k * unit }
}
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('placeMarks', () => {
  it('puts a mark on a large element’s top right corner', () => {
    expect(placeMarks([{ i: 0, rect: at(20, 100) }], phone, 1)).toEqual([
      { ids: [0], left: 100, top: 100, out: false },
    ])
  })

  it('puts a small element’s mark outside it, above its right end, clear of its text', () => {
    const chip = at(20, 100, 40, 18)
    const [m] = placeMarks([{ i: 0, rect: chip }], phone, 1)
    expect(m && reach(m, chip)).toBeLessThanOrEqual(12)
    expect(m && overlap(boxOf(m), chip)).toBe(false)
    // A row of chips: each mark by its own chip, none on another's text.
    const chips = [at(20, 100, 40, 18), at(64, 100, 40, 18), at(108, 100, 40, 18)]
    const marks = placeMarks(
      chips.map((rect, i) => ({ i, rect })),
      phone,
      1,
    )
    for (const [k, mk] of marks.entries()) {
      expect(reach(mk, chips[k] as Rect)).toBeLessThanOrEqual(12)
      for (const c of chips) expect(overlap(boxOf(mk), c)).toBe(false)
    }
  })

  it('takes an element showing less than 24px (under the status bar, or below the screen) as out of view', () => {
    const [under, below, part] = placeMarks(
      [
        { i: 0, rect: at(20, 30, 80, 40) },
        { i: 1, rect: at(20, 830, 80, 40) },
        { i: 2, rect: at(20, 20, 80, 60) },
      ],
      phone,
      1,
    )
    expect(under?.out).toBe(true)
    expect(below?.out).toBe(true)
    expect(part?.out).toBe(false)
    // Partly under the bar: its mark where it shows, still on it.
    expect(part && part.top >= 47 + 9).toBe(true)
    expect(part && reach(part, at(20, 20, 80, 60))).toBe(0)
  })

  it('moves a mark the capsule would cover just outside its element (above or below), not over its text', () => {
    const cap = capsuleOf(375)
    const bar = at(0, 60, 375, 40)
    const [m] = placeMarks([{ i: 0, rect: bar }], mini, 1)
    expect(m && overlap(boxOf(m), cap)).toBe(false)
    expect(m && reach(m, bar)).toBeLessThanOrEqual(12)
    expect(m && (m.top < bar.y || m.top > bar.y + bar.h)).toBe(true)
  })

  it('takes what pinned layers cover (a sticky head, a tab bar) as not showing; their own marks stay', () => {
    const head = at(0, 47, 390, 40)
    const tab = at(0, 788, 390, 56)
    const frame = { ...phone, covers: [head, tab] }
    const [under, part, own] = placeMarks(
      [
        { i: 0, rect: at(20, 60, 80, 30) },
        { i: 1, rect: at(20, 70, 80, 60) },
        { i: 2, rect: tab, pinned: true },
      ],
      frame,
      1,
    )
    expect(under?.out).toBe(true)
    // Partly under the head: its mark below the head, on what shows of it.
    expect(part?.out).toBe(false)
    expect(part && boxOf(part).y >= head.y + head.h).toBe(true)
    expect(own?.out).toBe(false)
    expect(own?.ids).toEqual([2])
  })

  it('groups only rules of one element (or of elements inside one another), never neighbours', () => {
    // A dense grid: 6 × 6 cells of 52 × 36, 4 apart, one rule each.
    const cells = Array.from({ length: 36 }, (_, i) => ({
      i,
      rect: at(16 + (i % 6) * 56, 120 + Math.floor(i / 6) * 40, 52, 36),
    }))
    const marks = placeMarks(cells, phone, 1)
    for (const m of marks) expect(m.ids).toHaveLength(1)
    // Each mark on its own cell (or touching it), on no other cell — at 1:1 and on a device zoomed out to 0.78.
    for (const unit of [1, 1 / 0.78])
      for (const m of placeMarks(cells, phone, unit)) {
        const own = cells[m.ids[0] as number]?.rect as Rect
        const b = { ...boxOf(m), x: m.left - 9 * unit, y: m.top - 9 * unit, w: 18 * unit, h: 18 * unit }
        expect(reach(m, own)).toBeLessThanOrEqual(9 * unit)
        for (const c of cells) if (c.rect !== own) expect(overlap(b, c.rect)).toBe(false)
      }
    // A row and the link inside it may share a mark.
    const row = at(0, 300, 390, 41)
    const link = at(330, 310, 40, 20)
    const nested = placeMarks(
      [0, 1, 2, 3].map((i) => ({ i, rect: row })).concat([{ i: 4, rect: link }]),
      phone,
      1,
    )
    for (const m of nested) expect(m.ids.length === 1 || m.ids.every((i) => i <= 4)).toBe(true)
  })

  it('never lets marks overlap or leave the screen, however crowded (one corner for two elements, the left edge)', () => {
    const inScreen = (m: PlacedMark, f = phone, unit = 1) => {
      const b = boxOf(m, unit)
      return b.x >= 0 && b.x + b.w <= f.w && b.y >= f.status && b.y + b.h <= f.h
    }
    const noOverlap = (marks: PlacedMark[], unit = 1) => {
      for (const [k, a] of marks.entries())
        for (const b of marks.slice(k + 1)) expect(overlap(boxOf(a, unit), boxOf(b, unit))).toBe(false)
    }
    // Two elements, neither inside the other, sharing their top right corner; a third crowding them.
    const shared = placeMarks(
      [
        { i: 0, rect: at(100, 300, 80, 40) },
        { i: 1, rect: at(140, 300, 40, 80) },
        { i: 2, rect: at(160, 290, 20, 20) },
      ],
      phone,
      1,
    )
    noOverlap(shared.filter((m) => !m.out))
    for (const m of shared) expect(inScreen(m)).toBe(true)
    // Elements against the screen's left edge, small and tall.
    const left = placeMarks(
      [
        { i: 0, rect: at(0, 200, 6, 30) },
        { i: 1, rect: at(0, 236, 6, 30) },
        { i: 2, rect: at(0, 272, 6, 30) },
        { i: 3, rect: at(0, 60, 390, 784) },
      ],
      phone,
      1,
    )
    noOverlap(left.filter((m) => !m.out))
    for (const m of left) expect(inScreen(m)).toBe(true)
    // A desktop page at 0.4: a sidebar and a toolbar whose corners meet, each mark apart.
    const desk = { w: 1440, h: 900, status: 0, capsule: null, covers: [] }
    const marks = placeMarks(
      [
        { i: 1, rect: at(0, 0, 220, 900) },
        { i: 2, rect: at(220, 0, 1220, 52) },
        { i: 3, rect: at(240, 8, 200, 36) },
      ],
      desk,
      1 / 0.4,
    )
    noOverlap(marks, 1 / 0.4)
    for (const m of marks) expect(inScreen(m, desk, 1 / 0.4)).toBe(true)
  })

  it('shrinks a mark inside a small element (a grid cell) to keep its text clear', () => {
    const cells = Array.from({ length: 6 }, (_, i) => ({ i, rect: at(16 + i * 46, 120, 42, 28) }))
    const marks = placeMarks(cells, phone, 1 / 0.78)
    expect(marks.some((m) => m.compact)).toBe(true)
  })

  it('labels a group by its first number and how many more', () => {
    expect(markLabel([4])).toBe('5')
    expect(markLabel([4, 8, 9])).toBe('5+2')
  })

  it('keeps a grid cell’s group (wider than one number) off the next cell', () => {
    const cells = Array.from({ length: 6 }, (_, i) => at(16 + i * 46, 120, 42, 28))
    const marks = placeMarks(
      [0, 1, 2, 3, 4]
        .map((i) => ({ i, rect: cells[0] as Rect }))
        .concat(cells.slice(1).map((rect, k) => ({ i: 5 + k, rect }))),
      phone,
      1 / 0.78,
    )
    const group = marks.find((m) => m.ids.length > 1) as PlacedMark
    const b = {
      ...boxOf(group),
      x: group.left - boxOf(group).w / 0.78 / 2,
      w: boxOf(group).w / 0.78,
      y: group.top - 9 / 0.78,
      h: 18 / 0.78,
    }
    expect(overlap(b, cells[1] as Rect)).toBe(false)
  })

  it('gives one element’s rules one mark at once (first number +N), in order', () => {
    const el = at(100, 300)
    const marks = placeMarks(
      [4, 0, 1, 2, 3].map((i) => ({ i, rect: el })),
      phone,
      1,
    )
    expect(marks.map((m) => m.ids)).toEqual([[0, 1, 2, 3, 4]])
    expect(markLabel(marks[0]?.ids ?? [])).toBe('1+4')
    expect(reach(marks[0] as PlacedMark, el)).toBeLessThanOrEqual(12)
  })

  it('steps aside only for another element’s mark', () => {
    const a = at(100, 300)
    const b = at(110, 290)
    const marks = placeMarks(
      [
        { i: 0, rect: a },
        { i: 1, rect: b },
      ],
      phone,
      1,
    )
    expect(marks.map((m) => m.ids)).toEqual([[0], [1]])
    expect(overlap(boxOf(marks[0] as PlacedMark), boxOf(marks[1] as PlacedMark))).toBe(false)
  })

  it('keeps a group whole inside the screen at its right edge', () => {
    const el = at(300, 300, 90, 40)
    expect(placeMarks([{ i: 0, rect: el }], phone, 1)).toHaveLength(1)
    const marks = placeMarks(
      [0, 1, 2, 3, 4, 5].map((i) => ({ i, rect: el })),
      phone,
      1,
    )
    for (const m of marks) {
      const b = boxOf(m)
      expect(b.x + b.w).toBeLessThanOrEqual(390)
      expect(reach(m, el)).toBeLessThanOrEqual(12)
    }
  })
})

describe('bubbleAt', () => {
  it('puts a tall element’s bubble inside it by the mark when neither above nor below has room', () => {
    const tall = at(20, 60, 300, 760)
    const b = bubbleAt({ left: 320, top: 70 }, tall, phone, 1)
    expect(b.top !== undefined && b.top >= 47 && b.top <= 844 - 140).toBe(true)
  })

  it('opens above the element when there is room, below it otherwise, never over it', () => {
    const above = bubbleAt({ left: 300, top: 400 }, at(220, 400, 80, 20), phone, 1)
    expect(above).toMatchObject({ bottom: 844 - 394 })
    const below = bubbleAt({ left: 300, top: 70 }, at(220, 70, 80, 20), phone, 1)
    expect(below).toMatchObject({ top: 96 })
    expect(above.left + 248).toBeLessThanOrEqual(390 - 10)
  })
})
