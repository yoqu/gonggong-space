import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(`src/${p}`, 'utf8')
const ruleOf = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('nightly motion: chat threads and composer', () => {
  it('rail thread rows rise in like the inbox cards and press like a card', () => {
    const rail = read('features/chat/group-threads.css')
    const row = ruleOf(rail, '.group-threads__row')
    expect(row).toContain('ui-fade-in var(--fade-in)')
    expect(row).toContain('ui-enter var(--spring-smooth)')
    expect(row).toContain('--enter-y: 6px')
    expect(row).toContain('background-color var(--fade-fast)')
    expect(row).toContain('scale var(--spring-interactive)')
    expect(ruleOf(rail, '.group-threads__row:active')).toContain('scale: var(--press-card)')
    const inbox = ruleOf(read('features/chat/thread-inbox.css'), '.thread-inbox__card:not(.ui-leaving)')
    expect(inbox).toContain('ui-enter var(--spring-smooth)')
    expect(inbox).toContain('--enter-y: 6px')
  })

  it('reply strip eases its hover fill and new-reply outline, presses like a card, arrow glides on a spring', () => {
    const css = read('ui/im/message.css')
    const strip = ruleOf(css, '.pn-thread')
    expect(strip).toContain('background-color var(--fade-fast)')
    expect(strip).toContain('box-shadow var(--fade-in)')
    expect(strip).toContain('scale var(--spring-interactive)')
    expect(ruleOf(css, '.pn-thread:active')).toContain('scale: var(--press-card)')
    expect(ruleOf(css, '.pn-thread__go')).toContain('transform var(--spring-interactive)')
  })

  it('the run end note fades in where the stop button was', () => {
    expect(ruleOf(read('features/chat/timeline.css'), '.run-card__note')).toContain(
      'ui-fade-in var(--fade-in)',
    )
  })

  it('unread badges stay mounted so they animate out when a thread is read', () => {
    for (const f of ['features/chat/GroupThreads.tsx', 'features/chat/ThreadInbox.tsx']) {
      const src = read(f)
      expect(src).toContain('<Badge count={state.unread} />')
      expect(src).not.toMatch(/state\.unread \? <Badge/)
    }
  })

  it('live thread replies enter like main-timeline arrivals', () => {
    const src = read('features/chat/ThreadView.tsx')
    expect(src).toContain('useThreadItem(group, tl.messages, tl.runs, readOnly, tl.arrived)')
    expect(src).toContain("arrived?.has(m.id) && 'tl-item--enter'")
  })

  it('composer chips use the shared enter keyframes so the fade survives reduced motion', () => {
    const css = read('features/chat/composer.css')
    const chips = ruleOf(css, '.composer__chips > *')
    expect(chips).toContain('ui-fade-in var(--fade-in)')
    expect(chips).toContain('ui-enter var(--spring-snappy)')
    expect(css).not.toContain('composer-chip-in')
  })

  it('floating composer dock: fast hover colors, pressed controls, faded-in status swaps', () => {
    const dock = read('features/chat/composer-dock.css')
    expect(ruleOf(dock, '.cdock__grip::before')).toContain('background-color var(--fade-fast)')
    const hide = ruleOf(dock, '.cdock__hide')
    expect(hide).toContain('background-color var(--fade-fast)')
    expect(hide).toContain('scale var(--spring-interactive)')
    expect(ruleOf(dock, '.cdock__hide:active')).toContain('scale: var(--press-button)')
    const hud = ruleOf(dock, '.cdock__hud')
    expect(hud).toContain('box-shadow var(--fade-fast)')
    expect(hud).toContain('scale var(--spring-interactive)')
    expect(ruleOf(dock, '.cdock__hud:active')).toContain('scale: var(--press-button)')
    expect(ruleOf(dock, '.cdock__hud-action')).toContain('color var(--fade-fast)')
    expect(dock).toMatch(/\.cdock__hud-wave,\s*\.cdock__hud-dot \{\s*animation: ui-fade-in var\(--fade-in\);/)
    expect(ruleOf(dock, '.cdock__orb')).toContain('background-color var(--fade-fast)')
    const badge = ruleOf(dock, '.cdock__orb-badge')
    expect(badge).toContain('animation: ui-fade-in var(--fade-in)')
    expect(badge).toContain('background-color var(--fade-in)')
    // Keyed so a tone swap remounts the indicator and replays its fade.
    const tsx = read('features/chat/ComposerDock.tsx')
    expect(tsx).toContain('key="wave"')
    expect(tsx).toContain('key="dot"')
  })

  it('dock loops still stop under reduced motion', () => {
    const dock = read('features/chat/composer-dock.css')
    const reduced = dock.slice(dock.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.cdock__hud-wave > i \{\s*animation: none;/)
    expect(reduced).toContain('.cdock__orb-badge[data-tone="attention"]::after')
  })
})
