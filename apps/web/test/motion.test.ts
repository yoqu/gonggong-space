import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SPRING, SPRINGS } from '../src/lib/motion'

describe('motion springs', () => {
  it('mirror the CSS spring generator', () => {
    const src = readFileSync('../../tools/gen-springs.mjs', 'utf8')
    const gen = Object.fromEntries(
      [...src.matchAll(/^\s+(\w+): \[([\d.]+), ([\d.]+)\],$/gm)].map((m) => [
        m[1],
        [Number(m[2]), Number(m[3])],
      ]),
    )
    expect(SPRINGS).toEqual(gen)
  })

  it('map zero bounce to critical damping', () => {
    const t = SPRING.smooth as { stiffness: number; damping: number; mass: number }
    expect(t.damping).toBeCloseTo(2 * Math.sqrt(t.stiffness * t.mass))
  })
})
