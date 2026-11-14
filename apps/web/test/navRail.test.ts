import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom has no layout: assert the CSS contract that keeps every tab and the avatar on a 360px phone.
describe('NavRail bottom bar fits narrow phones', () => {
  const css = readFileSync('src/ui/nav-rail.css', 'utf8')
  const ruleOf = (selector: string) => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start)).replace(/\s+/g, ' ')
  }

  it('bar items share the width and may shrink', () => {
    const item = ruleOf('.ui-rail--bar .ui-rail__item')
    expect(item).toContain('flex: 1 1 0;')
    expect(item).toContain('min-width: 0;')
    expect(item).toContain('width: auto;')
  })

  it('bar labels stay on one line with an ellipsis', () => {
    const label = ruleOf('.ui-rail--bar .ui-rail__label')
    expect(label).toContain('white-space: nowrap;')
    expect(label).toContain('overflow: hidden;')
    expect(label).toContain('text-overflow: ellipsis;')
    expect(label).toContain('max-width: 100%;')
  })

  it('bar trailing is a fixed narrow slot that does not shrink', () => {
    const trailing = ruleOf('.ui-rail--bar .ui-rail__trailing')
    expect(trailing).toContain('flex: none;')
    expect(trailing).toContain('width: 44px;')
  })

  it('vertical rail items keep their fixed width', () => {
    expect(ruleOf('.ui-rail__item')).toContain('width: 64px;')
  })
})
