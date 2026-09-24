import type { Transition } from 'motion/react'

/** Apple (duration, bounce) pairs; must equal `SPRINGS` in tools/gen-springs.mjs so JS springs match the CSS `--spring-*` tokens. */
export const SPRINGS = {
  snappy: [0.35, 0],
  smooth: [0.45, 0],
  bouncy: [0.4, 0.15],
  interactive: [0.2, 0],
} as const

type Name = keyof typeof SPRINGS

/** Same mass/stiffness/damping mapping as gen-springs.mjs (WWDC23 "Animate with springs"). */
const spring = ([d, b]: readonly [number, number]): Transition => ({
  type: 'spring',
  mass: 1,
  stiffness: ((2 * Math.PI) / d) ** 2,
  damping: b >= 0 ? (4 * Math.PI * (1 - b)) / d : (4 * Math.PI) / ((1 + b) * d),
})

export const SPRING = Object.fromEntries(Object.entries(SPRINGS).map(([k, v]) => [k, spring(v)])) as Record<
  Name,
  Transition
>
