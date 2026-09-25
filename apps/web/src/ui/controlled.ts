import { useState } from 'react'

/** Value from `value` when controlled, otherwise internal state seeded by `defaultValue`. */
export function useControlled<T>(value: T | undefined, defaultValue: T) {
  const [own, setOwn] = useState(defaultValue)
  const controlled = value !== undefined
  return [controlled ? value : own, (next: T) => !controlled && setOwn(next)] as const
}

/** Index of the next enabled item from `from` in direction `step`, wrapping around. */
export function nextEnabled(items: { disabled?: boolean }[], from: number, step: 1 | -1) {
  for (let i = 1; i <= items.length; i++) {
    const j = (((from + step * i) % items.length) + items.length) % items.length
    if (!items[j]?.disabled) return j
  }
  return from
}
