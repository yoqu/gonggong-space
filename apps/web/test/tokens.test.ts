import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const THEMES = ['light', 'dark', 'hc-light', 'hc-dark'] as const
type Theme = (typeof THEMES)[number]
type Themed = Record<Theme, string>
type Token<V> = { name: string; value: V }

const pane = JSON.parse(readFileSync('../../docs/design/pane/tokens.json', 'utf8')) as {
  color: { tokens: Token<Themed>[] }
  shadow: { tokens: Token<Themed>[] }
  spacing: { tokens: Token<string>[] }
  radius: { tokens: Token<string>[] }
  material: { tokens: Token<string>[] }
  size: { tokens: Token<string>[] }
}
const css = readFileSync('src/styles/tokens.css', 'utf8')

const block = (selector: string, from = 0): Record<string, string> => {
  const start = css.indexOf(`${selector} {`, from)
  expect(start, `missing ${selector} block`).toBeGreaterThanOrEqual(0)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, k, v]) => [k, v?.trim()]),
  )
}

const light = block('[data-theme="light"]')
const blocks: Record<Theme, Record<string, string>> = {
  light,
  dark: block('[data-theme="dark"]'),
  'hc-light': block('[data-theme="hc-light"]'),
  'hc-dark': block('[data-theme="hc-dark"]'),
}
const contrast = css.indexOf('@media (prefers-contrast: more)')
const themed = [...pane.color.tokens, ...pane.shadow.tokens]

describe('Pane tokens.css', () => {
  it('defines every themed token with the exact value in all four themes', () => {
    for (const theme of THEMES)
      for (const { name, value } of themed)
        expect(blocks[theme][`--${name}`], `${theme} ${name}`).toBe(value[theme])
  })

  it('gives every theme the same themed key set', () => {
    const keys = themed.map((t) => `--${t.name}`).sort()
    for (const theme of THEMES.slice(1)) expect(Object.keys(blocks[theme]).sort(), theme).toEqual(keys)
    expect(Object.keys(light)).toEqual(expect.arrayContaining(keys))
  })

  it('includes the v2 tokens', () => {
    for (const name of ['row-alt', 'selection-inactive', 'scrim', 'control-outline', 'shadow-outline'])
      expect(light[`--${name}`], name).toBeDefined()
    expect(light['--shadow-outline']).toBe('none')
  })

  it('swaps light and dark for their high-contrast values when the OS asks for more contrast', () => {
    expect(contrast).toBeGreaterThan(0)
    const hcLight = block('  [data-theme="light"]', contrast)
    const hcDark = block('  [data-theme="dark"]', contrast)
    expect(css.slice(contrast, css.indexOf('[data-theme="light"]', contrast))).toContain(':root,')
    expect(hcLight).toEqual(blocks['hc-light'])
    expect(hcDark).toEqual(blocks['hc-dark'])
  })

  it('uses Pane systemBlue as the accent', () => {
    expect(light['--accent']).toBe('#0088ff')
    expect(blocks.dark['--accent']).toBe('#0091ff')
    expect(light['--accent-fill']).toBe('#0071e3')
  })

  it('defines spacing, radius, material and size tokens verbatim', () => {
    for (const { name, value } of [
      ...pane.spacing.tokens,
      ...pane.radius.tokens,
      ...pane.material.tokens,
      ...pane.size.tokens,
    ])
      expect(light[`--${name}`], name).toBe(value)
  })

  it('defines the body text style at 13px/16px', () => {
    expect(light['--text-body-size']).toBe('13px')
    expect(light['--text-body-line']).toBe('16px')
  })
})
