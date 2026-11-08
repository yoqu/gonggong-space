import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SPRING, SPRINGS } from '../src/lib/motion'

describe('motion springs', () => {
  it('mirror the CSS spring generator', () => {
    const src = readFileSync('../../tools/gen-springs.mjs', 'utf8')
    const gen = Object.fromEntries(
      [...src.matchAll(/^\s+(\w+): \[([\d.]+), ([\d.]+)\],$/gm)].map((m) => [
        m[1],
        [Number(m[2]), Number(m[3])],
      ]),
    )
    expect(SPRINGS).toEqual(gen)
  })

  it('map zero bounce to critical damping', () => {
    const t = SPRING.smooth as { stiffness: number; damping: number; mass: number }
    expect(t.damping).toBeCloseTo(2 * Math.sqrt(t.stiffness * t.mass))
  })
})

describe('motion and touch CSS contract', () => {
  const read = (p: string) => readFileSync(`src/${p}`, 'utf8')
  const ruleOf = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start))
  }
  const cssFiles = (dir: string): string[] =>
    readdirSync(`src/${dir}`, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? cssFiles(`${dir}/${e.name}`) : e.name.endsWith('.css') ? [`${dir}/${e.name}`] : [],
    )
  // Choreographed scenes (mascot, login stage, logo, timer ring, lightbox pan) keep hand-tuned timings.
  const CHOREOGRAPHED = [
    'ui/mascot.css',
    'ui/brand.css',
    'ui/lightbox.css',
    'features/auth/auth.css',
    'features/chat/run-graphics.css',
  ]

  it('times every transition with a motion token, so reduced motion and the rhythm stay in one place', () => {
    const raw = ['ui', 'app', 'features', 'styles']
      .flatMap(cssFiles)
      .filter((f) => !CHOREOGRAPHED.includes(f))
      .flatMap((f) =>
        [...read(f).matchAll(/transition:([^;]+);/g)]
          .filter((m) => /(^|[\s,])[\d.]+m?s\b/.test(m[1]!.replace(/var\([^)]*\)/g, '')))
          .map((m) => `${f}: ${m[1]!.trim()}`),
      )
    expect(raw).toEqual([])
  })

  it('drops the grey tap flash and double-tap delay on touch', () => {
    const base = read('styles/base.css')
    expect(ruleOf(base, 'html')).toContain('-webkit-tap-highlight-color: transparent')
    expect(base).toMatch(/button,[\s\S]*?\{\s*touch-action: manipulation;/)
  })

  it('presses buttons in with a spring, only when motion is welcome', () => {
    const css = read('ui/controls.css')
    expect(ruleOf(css, '.ui-btn')).toContain('scale var(--spring-interactive)')
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.ui-btn:active \{\s*scale: 0\.97;/,
    )
  })

  it('keeps hover lifts off touch screens, where they would stick after a tap', () => {
    expect(read('features/works/works.css')).toMatch(/@media \(hover: hover\) \{\s*\.works__card:hover \{/)
    expect(read('app/shell.css')).toMatch(
      /@media \(hover: hover\) \{\s*\.welcome__step\[data-state="todo"\]:hover,/,
    )
  })

  it('eases empty states in and balances their description', () => {
    const css = read('ui/feedback.css')
    expect(ruleOf(css, '.ui-empty')).toContain('var(--spring-smooth) ui-enter')
    expect(ruleOf(css, '.ui-empty__desc')).toContain('text-wrap: balance')
  })

  it('lifts toasts above the phone tab bar unless a composer placed them', () => {
    const css = read('ui/toast.css')
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{\s*\.ui-toasts \{\s*bottom: var\(--toast-bottom, calc\(64px \+ env\(safe-area-inset-bottom\)\)\);/,
    )
    expect(ruleOf(css, '.ui-toast__count')).toContain('ui-enter')
  })

  it('animates the sidebar: turning fold chevron, tinted drop target, breathing offline dot, roomy touch targets', () => {
    const shell = read('app/shell.css')
    expect(ruleOf(shell, '.sidebar__chev')).toContain('rotate var(--spring-interactive)')
    expect(ruleOf(shell, '.sidebar__reveal')).toContain('var(--spring-smooth) ui-enter')
    const drop = ruleOf(shell, '.sidebar__section--drop')
    expect(drop).toContain('var(--tint-blue)')
    expect(drop).not.toContain('--accent-fill')
    expect(shell).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.sidebar__foot:not\(\[data-state="open"\]\) \.sidebar__dot \{\s*animation: sidebar-pulse/,
    )
    expect(shell).toMatch(/@media \(pointer: coarse\) \{\s*\.sidebar__add \{\s*width: 32px;/)
    expect(read('ui/im/conversation.css')).toMatch(
      /@media \(pointer: coarse\) \{\s*\.pn-shortcut \{\s*height: 36px;/,
    )
    expect(read('features/search/search.css')).toMatch(
      /@media \(pointer: coarse\) \{\s*\.search__input \{\s*font-size: 16px;/,
    )
  })

  it('pops the current rail icon and unread badges with a spring', () => {
    const rail = read('ui/nav-rail.css')
    expect(ruleOf(rail, '.ui-rail__item[aria-current="page"] .ui-rail__tile > svg')).toContain(
      'var(--spring-bouncy) ui-rail-pop',
    )
    expect(ruleOf(read('ui/display.css'), '.ui-badge')).toContain('var(--spring-bouncy) ui-badge-pop')
  })
})
