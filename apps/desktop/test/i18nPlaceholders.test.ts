import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en'

describe('English dictionary', () => {
  it('keeps every placeholder of the Chinese source as a bare {x}', () => {
    const dropped = Object.entries(en as Record<string, string>).flatMap(([key, value]) =>
      [...new Set([...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
        .filter((p) => !value.includes(`{${p}}`))
        .map((p) => `${key} => ${value} (missing {${p}})`),
    )
    expect(dropped).toEqual([])
  })
})
