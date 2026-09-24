#!/usr/bin/env node
// Solves Apple-style (duration, bounce) springs and prints CSS `linear()` tokens for apps/web/src/styles/motion.css.
// Parameter mapping per WWDC23 "Animate with springs": mass 1, stiffness (2π/d)², damping 4π(1−b)/d (b ≥ 0)
// or 4π/((1+b)·d) (b < 0), which makes the damping ratio ζ = 1 − b, resp. 1/(1 + b).
import { pathToFileURL } from 'node:url'

export const SPRINGS = {
  snappy: [0.35, 0],
  smooth: [0.45, 0],
  bouncy: [0.4, 0.15],
  interactive: [0.2, 0],
}

const SEGMENTS = 30
const EPSILON = 0.001

function position(duration, bounce) {
  const w0 = (2 * Math.PI) / duration
  const zeta = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce)
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    return (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
  }
  if (zeta === 1) return (t) => 1 - (1 + w0 * t) * Math.exp(-w0 * t)
  const root = Math.sqrt(zeta * zeta - 1)
  const r1 = -w0 * (zeta - root)
  const r2 = -w0 * (zeta + root)
  const a = r2 / (r1 - r2)
  return (t) => 1 + a * Math.exp(r1 * t) + (-1 - a) * Math.exp(r2 * t)
}

/** Samples the spring from rest until it stays within EPSILON of the target. */
export function sampleSpring(duration, bounce) {
  const x = position(duration, bounce)
  let settled = 0
  for (let ms = 0; ms <= duration * 10_000; ms++) if (Math.abs(x(ms / 1000) - 1) >= EPSILON) settled = ms + 1
  const points = Array.from({ length: SEGMENTS + 1 }, (_, i) =>
    i === SEGMENTS ? 1 : Math.round(x(((i / SEGMENTS) * settled) / 1000) * 1000) / 1000 + 0,
  )
  return { ms: settled, points }
}

export function cssTokens() {
  return Object.entries(SPRINGS).map(([name, [duration, bounce]]) => {
    const { ms, points } = sampleSpring(duration, bounce)
    return `--spring-${name}: ${ms}ms linear(${points.join(', ')})`
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const line of cssTokens()) console.log(`  ${line};`)
}
