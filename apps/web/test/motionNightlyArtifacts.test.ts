import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('motion nightly: artifacts canvas and works', () => {
  const read = (p: string) => readFileSync(`src/${p}`, 'utf8')
  const ruleOf = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start))
  }

  it('glides the prototype device on a transform (FLIP), never on padding or size, and flashes hotspots on --flash', () => {
    const css = read('features/artifacts/prototype.css')
    expect(css).not.toContain('proto-stage--glide')
    expect(css).not.toMatch(/transition:[^;]*\b(padding|width|height) var\(/)
    expect(ruleOf(css, '.proto-device-box')).toContain('transform-origin: 0 0')
    expect(ruleOf(css, '.proto-hots--flash .proto-hot')).toContain('proto-hots-flash var(--flash) both')
    expect(read('features/artifacts/deviceGlide.ts')).toContain("motionTiming('--spring-smooth')")
    expect(read('features/artifacts/PrototypeEditor.tsx')).toContain('const FLASH_MS = 1400')
    expect(read('styles/motion.css')).toContain('--flash: 1.4s ease-out')
  })

  it('pops new canvas page chips in, keeps sent ones still, and fades chip hovers', () => {
    const css = read('features/artifacts/chips.css')
    const chip = ruleOf(css, '.art-chips:not(.art-chips--sent) > .art-chip')
    expect(chip).toContain('--enter-scale: 0.96')
    expect(chip).toContain('var(--spring-snappy) ui-enter')
    expect(chip).toContain('var(--fade-in) ui-fade-in')
    expect(ruleOf(css, '.art-chip__x')).toContain('background-color var(--fade-fast)')
    expect(ruleOf(css, '.art-var')).toContain('background-color var(--fade-fast)')
    expect(css).toMatch(/\.art-chips__ds \{[^}]*background-color var\(--fade-fast\)/)
  })

  it('slides the narrow rail drawer in and out, eases a re-shown wide rail, turns one folder chevron', () => {
    const css = read('features/artifacts/rail.css')
    const drawer = ruleOf(css, '.art-main--narrow .art-rail')
    expect(drawer).toContain('--enter-x: -100%')
    expect(drawer).toContain('var(--spring-smooth) ui-enter')
    expect(ruleOf(css, '.art-rail__backdrop')).toContain('var(--fade-in) ui-fade-in')
    expect(css).toMatch(
      /\.art-main\[data-drawer="closed"\] \.art-rail,\s*\.art-main\[data-drawer="closed"\] \.art-rail__backdrop \{[^}]*var\(--fade-out\) ui-exit forwards/,
    )
    const wide = ruleOf(css, '.art-main[data-rail-toggled]:not(.art-main--narrow) .art-rail')
    expect(wide).toContain('--enter-x: -8px')
    expect(ruleOf(css, '.art-rail__twisty > svg')).toContain('rotate var(--spring-interactive)')
    expect(ruleOf(css, '.art-rail__twisty[aria-expanded="true"] > svg')).toContain('rotate: 90deg')
    expect(ruleOf(css, '.art-rail__row')).toContain('background-color var(--fade-fast)')
    const tab = read('features/artifacts/ArtifactTab.tsx')
    expect(tab).toContain('usePresence(rail.open && rail.narrow')
    expect(tab).toContain('data-drawer=')
    expect(read('features/artifacts/PageRail.tsx')).not.toContain("'chevron-down'")
  })

  it('cross-fades an empty work into its first version', () => {
    const css = read('features/artifacts/rail.css')
    expect(ruleOf(css, '.art-page-empty[data-state="closed"]')).toContain(
      'var(--fade-out) ui-fade-out forwards',
    )
    const first = ruleOf(css, '.art-stage[data-first-version] .art-node')
    expect(first).toContain('--enter-scale: 0.98')
    expect(first).toContain('var(--spring-smooth) ui-enter')
    expect(read('features/artifacts/ArtifactTab.tsx')).toContain('data-first-version={firstIn || undefined}')
    expect(read('features/artifacts/PageRail.tsx')).toContain(
      '<Presence>{first ? <PageEmpty first /> : null}</Presence>',
    )
  })

  it('swaps the rail AI chat and command log like other tab panels', () => {
    expect(read('features/artifacts/CanvasChat.tsx')).toContain('art-rail__scroll art-chat ui-panel-swap')
    expect(read('features/artifacts/PageRail.tsx')).toContain('art-rail__scroll ui-panel-swap')
  })
})
