import type { Transition } from 'motion/react'

/** Apple (duration, bounce) pairs; must equal `SPRINGS` in tools/gen-springs.mjs so JS springs match the CSS `--spring-*` tokens. */
export const SPRINGS = {
  snappy: [0.26, 0],
  smooth: [0.32, 0],
  bouncy: [0.32, 0.22],
  interactive: [0.18, 0],
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

/** Parses a CSS motion token (e.g. `--spring-interactive: 213ms linear(...)`) into WAAPI timing; null when 0s or unset. */
export function motionTiming(token: string): { duration: number; easing: string } | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const m = /^([\d.]+)(ms|s)\s+(.+)$/.exec(raw)
  if (!m) return null
  const duration = Number(m[1]) * (m[2] === 's' ? 1000 : 1)
  return duration > 0 ? { duration, easing: m[3]! } : null
}
