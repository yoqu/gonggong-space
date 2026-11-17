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

  it('leaves no CJK characters or CJK punctuation in English values', () => {
    const leaks = Object.entries(en as Record<string, string>)
      .filter(([, value]) => /[\u4e00-\u9fff「」【】、，。]/.test(value))
      .map(([key, value]) => `${key} => ${value}`)
    expect(leaks).toEqual([])
  })

  it('uses American English spelling consistently and trims values', () => {
    const AFFIX_EXEMPT = new Set(['、', '（含接力链，整条链终止）', '（{owner} 批准）'])
    const issues = Object.entries(en as Record<string, string>)
      .filter(
        ([key, value]) =>
          (!AFFIX_EXEMPT.has(key) && value !== value.trim()) ||
          /\b(colours?|favourit\w*|cancelled)\b/i.test(value),
      )
      .map(([key, value]) => `${key} => ${JSON.stringify(value)}`)
    expect(issues).toEqual([])
  })
})
