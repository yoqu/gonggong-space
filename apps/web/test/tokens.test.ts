import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Themed = { light: string; dark: string }
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

const block = (selector: string): Record<string, string> => {
  const start = css.indexOf(`${selector} {`)
  expect(start, `missing ${selector} block`).toBeGreaterThanOrEqual(0)
  const body = css.slice(start, css.indexOf('\n}', start))
  return Object.fromEntries(
    [...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, k, v]) => [k, v?.trim()]),
  )
}

const light = block(':root')
const dark = block('[data-theme="dark"]')
const themed = [...pane.color.tokens, ...pane.shadow.tokens]

describe('Pane tokens.css', () => {
  it('defines every themed token with the exact light and dark values', () => {
    for (const { name, value } of themed) {
      expect(light[`--${name}`], name).toBe(value.light)
      expect(dark[`--${name}`], name).toBe(value.dark)
    }
  })

  it('gives both themes the same themed key set', () => {
    const darkKeys = Object.keys(dark).sort()
    expect(darkKeys).toEqual(themed.map((t) => `--${t.name}`).sort())
    expect(Object.keys(light)).toEqual(expect.arrayContaining(darkKeys))
  })

  it('uses Pane systemBlue as the accent', () => {
    expect(light['--accent']).toBe('#0088ff')
    expect(dark['--accent']).toBe('#0091ff')
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
