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

/** Standard Apple/macOS deceleration curves matching CSS `--ease-standard` and `--fade-*`. */
export const EASE = {
  standard: [0.2, 0, 0, 1] as const,
  out: [0, 0, 0.2, 1] as const,
} as const

/** Canonical motion durations (seconds) aligned with `styles/motion.css`. */
export const DURATION = {
  instant: 0.09,
  fast: 0.15,
  out: 0.11,
  data: 0.24,
} as const

/** Unified Motion transitions; use `data` / `interactive` / `snappy` / `smooth` (never `bouncy`) for analytics. */
export const TRANSITION = {
  fadeFast: { duration: DURATION.instant, ease: EASE.out } as Transition,
  fadeIn: { duration: DURATION.fast, ease: EASE.out } as Transition,
  fadeOut: { duration: DURATION.out, ease: EASE.out } as Transition,
  data: { duration: DURATION.data, ease: EASE.standard } as Transition,
  interactive: SPRING.interactive,
  snappy: SPRING.snappy,
  smooth: SPRING.smooth,
} as const

/** Capped reveal stagger (max 6 items -> <=120ms) matching CSS `--stagger-step`. */
export const STAGGER = {
  step: 0.02,
  maxItems: 6,
  delay: (index: number) => Math.min(Math.max(0, index), 6) * 0.02,
} as const

/** Canonical reduced-motion check shared across UI primitives and features. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Parses a CSS motion token (e.g. `--spring-interactive: 213ms linear(...)`) into WAAPI timing; null when 0s or unset. */
export function motionTiming(token: string): { duration: number; easing: string } | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const m = /^([\d.]+)(ms|s)\s+(.+)$/.exec(raw)
  if (!m) return null
  const duration = Number(m[1]) * (m[2] === 's' ? 1000 : 1)
  return duration > 0 ? { duration, easing: m[3]! } : null
}
