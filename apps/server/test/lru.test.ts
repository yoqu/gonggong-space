import { expect, it } from 'vitest'
import { remember } from '../src/lib/lru.js'

it('keeps at most `max` entries, dropping the least recently set', () => {
  const map = new Map<string, number>()
  for (let i = 0; i < 5; i++) remember(map, `k${i}`, i, 3)
  expect([...map.keys()]).toEqual(['k2', 'k3', 'k4'])
  remember(map, 'k2', 20, 3)
  remember(map, 'k5', 5, 3)
  expect([...map.entries()]).toEqual([
    ['k4', 4],
    ['k2', 20],
    ['k5', 5],
  ])
})
