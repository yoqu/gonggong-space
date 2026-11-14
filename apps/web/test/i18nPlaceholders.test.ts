import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en'

/** Keys whose English deliberately leaves out a placeholder, with why. */
const EXEMPT: Record<string, string> = {
  // The English names the people not listed ({more}), not the total.
  '{names} 等 {n} 人': 'n',
}

function droppedPlaceholders(dict: Record<string, string>, exempt: Record<string, string> = {}) {
  return Object.entries(dict).flatMap(([key, value]) =>
    [...new Set([...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))]
      .filter((p) => !value.includes(`{${p}}`) && !exempt[key]?.split(',').includes(p))
      .map((p) => `${key} => ${value} (missing {${p}})`),
  )
}

describe('English dictionary', () => {
  it('keeps every placeholder of the Chinese source as a bare {x}', () => {
    expect(droppedPlaceholders(en, EXEMPT)).toEqual([])
  })
})
