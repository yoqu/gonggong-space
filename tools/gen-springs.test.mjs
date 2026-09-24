import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { cssTokens, SPRINGS, sampleSpring } from './gen-springs.mjs'

test('every spring starts at 0 and ends at 1', () => {
  for (const [duration, bounce] of Object.values(SPRINGS)) {
    const { ms, points } = sampleSpring(duration, bounce)
    assert.equal(points[0], 0)
    assert.equal(points.at(-1), 1)
    assert.ok(points.length >= 20 && points.length <= 40)
    assert.ok(ms >= duration * 1000)
  }
})

test('bounce 0 never overshoots and never goes back', () => {
  for (const [duration, bounce] of Object.values(SPRINGS).filter(([, b]) => b === 0)) {
    const v = sampleSpring(duration, bounce).points
    for (let i = 1; i < v.length; i++) assert.ok(v[i] >= v[i - 1] && v[i] <= 1)
  }
})

test('positive bounce overshoots 1', () => {
  assert.ok(Math.max(...sampleSpring(0.4, 0.15).points) > 1)
})

test('negative bounce is overdamped and still settles', () => {
  const v = sampleSpring(0.4, -0.3).points
  assert.equal(v.at(-1), 1)
  assert.ok(Math.max(...v) <= 1)
})

test('motion.css carries the current generated tokens', () => {
  const css = readFileSync(new URL('../apps/web/src/styles/motion.css', import.meta.url), 'utf8')
  for (const line of cssTokens()) assert.ok(css.includes(line), `motion.css is stale: ${line}`)
})
