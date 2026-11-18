import { describe, expect, it } from 'vitest'
import { wheelZoomFactor } from '../src/features/artifacts/canvasZoom'

describe('wheelZoomFactor', () => {
  it('follows small trackpad pinch deltas finely', () => {
    expect(wheelZoomFactor({ deltaY: -4, deltaMode: 0 })).toBeCloseTo(Math.exp(4 / 300))
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.01))
  })

  it('caps a mouse wheel notch to a ~3% step instead of a 2.7× jump', () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeCloseTo(Math.exp(0.1 / 3))
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.1 / 3))
    // Line-mode wheels (Firefox) report 3 lines per notch.
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(Math.exp(-0.1 / 3))
  })
})
