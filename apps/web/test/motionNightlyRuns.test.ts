import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(`src/${p}`, 'utf8')
const ruleOf = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('nightly motion 2026-11-26: runs, notifications, connectors', () => {
  it('approval card: one soft gear flash on a token, the guide fades out crisply, the outcome fades in', () => {
    const css = read('features/runs/approval.css')
    const pill = ruleOf(css, '.approval__mode--highlight')
    expect(pill).toContain('animation: approval-gear-pulse var(--flash);')
    expect(pill).not.toMatch(/\d+(\.\d+)?m?s/)
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\) \{\s*\.approval__mode--highlight \{\s*animation: none;/,
    )
    const leaving = ruleOf(css, '.approval__guide[data-state="closed"]')
    expect(leaving).toContain('pointer-events: none')
    expect(leaving).toContain('animation: ui-fade-out var(--fade-out) forwards')
    expect(leaving).not.toContain('ui-exit')
    expect(ruleOf(css, '.approval__done')).toContain('animation: ui-fade-in var(--fade-in)')
    const tsx = read('features/runs/ApprovalBlock.tsx')
    expect(tsx).toContain('usePresence(guideVisible)')
    expect(tsx).toContain('data-state={guide.state}')
  })

  it('process panel: an approval row swaps 等待审批 for its outcome with a fade', () => {
    expect(ruleOf(read('features/runs/process.css'), '.act-approval__state')).toContain(
      'animation: ui-fade-in var(--fade-in)',
    )
    expect(read('features/runs/ProcessView.tsx')).toContain(
      '<div key={s.body} className="act-approval__state">',
    )
  })

  it('notifications: the unread dot fades and shrinks away, the hover delete fades in', () => {
    const css = read('features/notifications/notifications.css')
    const dot = ruleOf(css, '.notif__item::before')
    expect(dot).toContain('opacity: 0')
    expect(dot).toContain('opacity var(--fade-out)')
    expect(dot).toContain('scale var(--spring-snappy)')
    const unread = ruleOf(css, '.notif__item--unread::before')
    expect(unread).toContain('opacity: 1')
    expect(unread).toContain('scale: 1')
    const del = ruleOf(css, '.notif__delete')
    expect(del).toContain('opacity var(--fade-fast)')
    // Keeps the shared button's press spring and hover fill.
    expect(del).toContain('scale var(--spring-interactive)')
    expect(del).toContain('background var(--fade-fast)')
  })

  it('connectors: hover fills, status colors and steps ease, progress and hints ease in, try rows press', () => {
    const css = read('features/connectors/connectors.css')
    expect(ruleOf(css, '.cn-row')).toContain('background-color var(--fade-fast)')
    expect(ruleOf(css, '.cn-row__main')).toContain('opacity var(--fade-in)')
    expect(ruleOf(css, '.cn-menu__manage')).toContain('color var(--fade-fast)')
    const status = ruleOf(css, '.cn-status')
    expect(status).toContain('color var(--fade-fast)')
    const dot = ruleOf(css, '.cn-status__dot')
    expect(dot).toContain('background-color var(--fade-fast)')
    expect(dot).toContain('box-shadow var(--fade-fast)')
    expect(ruleOf(css, '.cn-steps li')).toContain('color var(--fade-fast)')
    expect(ruleOf(css, '.cn-machines__state')).toContain('color var(--fade-fast)')
    const tryRow = ruleOf(css, '.cn-try')
    expect(tryRow).toContain('background-color var(--fade-fast)')
    expect(tryRow).toContain('scale var(--spring-interactive)')
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.cn-try:active \{\s*scale: var\(--press-card\);/,
    )
    expect(css).toMatch(
      /\.cn-run,\s*\.cn-auth \{[^}]*ui-fade-in var\(--fade-in\),\s*ui-enter var\(--spring-snappy\)/,
    )
    const hint = ruleOf(css, '.cn-hint')
    expect(hint).toContain('ui-enter var(--spring-snappy)')
    expect(hint).toContain('--enter-y: 4px')
  })
})
