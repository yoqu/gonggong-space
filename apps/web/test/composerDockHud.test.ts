import { describe, expect, it } from 'vitest'
import { hudOffset } from '../src/features/chat/composerDockHud'

// Dock area 976 x 736 (bench 1024 x 768 minus insets); orb travel 932 x 692; HUD 300 x 30.
const base = { width: 976, height: 736, hud: { w: 300, h: 30 } }

describe('hudOffset', () => {
  it('centres on a bottom orb, sitting above it', () => {
    expect(hudOffset({ ...base, edge: 'bottom', orb: { x: 100, y: 0 } })).toEqual({ x: 100, y: 0 })
  })

  it('left-aligns with an orb snapped left', () => {
    // Orb left = 976/2 - 22 - 300 = 166; HUD natural left = 488 - 150 = 338.
    expect(hudOffset({ ...base, edge: 'left', orb: { x: -300, y: -300 } })).toEqual({ x: -172, y: -300 })
  })

  it('right-aligns with an orb snapped right', () => {
    expect(hudOffset({ ...base, edge: 'right', orb: { x: 300, y: -300 } })).toEqual({ x: 172, y: -300 })
  })

  it('stays inside the dock when the orb hugs the left or right edge', () => {
    expect(hudOffset({ ...base, edge: 'left', orb: { x: -466, y: -300 } }).x).toBe(-338)
    expect(hudOffset({ ...base, edge: 'right', orb: { x: 466, y: -300 } }).x).toBe(338)
    expect(hudOffset({ ...base, edge: 'bottom', orb: { x: 466, y: 0 } }).x).toBe(338)
  })

  it('drops below the orb near the top so it clears the bench bar', () => {
    // Orb top 16px under the bench top: HUD goes 8px below the orb instead of above.
    const top = hudOffset({ ...base, edge: 'right', orb: { x: 466, y: -692 } })
    expect(top).toEqual({ x: 338, y: -692 + 44 + 16 + 30 })
    // Orb top 56px under the bench top: room above, stays above.
    expect(hudOffset({ ...base, edge: 'left', orb: { x: -466, y: -652 } }).y).toBe(-652)
  })

  it('never wider than the dock', () => {
    expect(hudOffset({ ...base, hud: { w: 1200, h: 30 }, edge: 'right', orb: { x: 466, y: -300 } }).x).toBe(0)
  })
})
