import { describe, expect, it } from 'vitest'
import { pinchView, wheelZoomFactor } from '../src/features/artifacts/canvasZoom'

describe('wheelZoomFactor', () => {
  it('follows small trackpad pinch deltas finely', () => {
    expect(wheelZoomFactor({ deltaY: -4, deltaMode: 0 })).toBeCloseTo(Math.exp(4 / 75))
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.04))
  })

  it('caps a mouse wheel notch to a ~14% step instead of a 2.7× jump', () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeCloseTo(Math.exp(0.4 / 3))
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.4 / 3))
    // Line-mode wheels (Firefox) report 3 lines per notch.
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(Math.exp(-0.4 / 3))
  })
})

describe('pinchView', () => {
  const v = { x: 0, y: 0, z: 1 }

  it('zooms about the fingers’ midpoint by the change in their distance', () => {
    const next = pinchView(
      v,
      [
        { x: 90, y: 100 },
        { x: 110, y: 100 },
      ],
      [
        { x: 80, y: 100 },
        { x: 120, y: 100 },
      ],
    )
    expect(next.z).toBeCloseTo(2)
    // The plane point under the midpoint stays under it.
    expect((100 - next.x) / next.z).toBeCloseTo(100)
    expect((100 - next.y) / next.z).toBeCloseTo(100)
  })

  it('pans with the midpoint when both fingers move together', () => {
    const next = pinchView(
      v,
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      [
        { x: 30, y: 10 },
        { x: 50, y: 10 },
      ],
    )
    expect(next).toEqual({ x: 30, y: 10, z: 1 })
  })

  it('ignores fingers on the same spot', () => {
    const p = { x: 5, y: 5 }
    expect(pinchView(v, [p, p], [p, { x: 9, y: 9 }])).toBe(v)
  })
})
