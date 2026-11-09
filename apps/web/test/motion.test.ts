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
  it('moves the timeline: rising hover bar, drawn unread rules, springing pills, roomy touch targets', () => {
    const msg = read('ui/im/message.css')
    const bar = ruleOf(msg, '.pn-msg__actions')
    expect(bar).toContain('translate var(--spring-interactive)')
    expect(bar).toContain('translate: 0 4px')
    expect(msg).toMatch(/\.pn-msg:hover \.pn-msg__actions \{[^}]*translate: none;/)
    expect(msg).toMatch(/@media \(pointer: coarse\) \{\s*\.pn-reaction \{\s*height: 28px;/)
    expect(ruleOf(read('ui/im/notice.css'), '.pn-notice--unread::after')).toContain(
      'var(--spring-smooth) pn-rule-draw',
    )
    const tl = read('features/chat/timeline.css')
    expect(ruleOf(tl, '.chat-scroll__pill')).toContain('var(--spring-bouncy) ui-enter')
    expect(ruleOf(tl, '.chat-scroll__count')).toContain('var(--spring-bouncy) chat-count-bump')
    expect(ruleOf(tl, '.chat-scroll__bottom')).toContain('var(--spring-bouncy) ui-enter')
    expect(ruleOf(tl, '.chat-pins')).toContain('var(--spring-snappy) ui-enter')
  })
  it('moves the composer: springing send button, busy pulse, failure shake, chip pops, finger-sized touch targets', () => {
    const im = read('ui/im/composer.css')
    expect(ruleOf(im, '.pn-composer')).toContain('box-shadow var(--fade-in)')
    expect(ruleOf(im, '.pn-composer__send')).toContain('scale var(--spring-interactive)')
    expect(im).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[^@]*\.pn-composer__send\[data-state="ready"\] \{\s*animation: var\(--spring-bouncy\) pn-send-ready;[^@]*pn-send-busy/,
    )
    expect(im).toMatch(
      /@media \(pointer: coarse\) \{\s*\.pn-composer__tool,\s*\.pn-composer__send \{\s*width: 36px;/,
    )
    const chat = read('features/chat/composer.css')
    expect(chat).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.composer--shake \.pn-composer \{\s*animation: composer-shake/,
    )
    expect(chat).toMatch(
      /@media \(pointer: coarse\) \{\s*\.mention-pop \.mention-pop__item \{\s*height: 40px;/,
    )
    const att = read('features/attachments/attachments.css')
    expect(ruleOf(att, '.att-chip')).toContain('var(--spring-bouncy) att-chip-in')
    expect(ruleOf(att, '.att-chip__bar')).toContain('scale var(--motion-base)')
    expect(ruleOf(read('features/chat/edit.css'), '.msg-edit')).toContain('var(--spring-snappy) ui-enter')
  })
  it('moves runs: shimmering steps, turning fold, sliding requests, popping ticks, a ringing dock, roomy touch rows', () => {
    const motion = read('ui/motion.css')
    expect(ruleOf(motion, '.ui-shimmer')).toContain('ui-shimmer 1.6s linear infinite')
    expect(motion).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.ui-shimmer \{\s*animation: none;/)
    const tl = read('features/chat/timeline.css')
    expect(ruleOf(tl, '.run-card__steptext')).toContain('var(--spring-snappy) ui-enter')
    expect(tl).toMatch(
      /prefers-reduced-motion: reduce\) \{\s*\.run-card__steptext\.ui-shimmer \{\s*animation: var\(--fade-in\) ui-fade-in;/,
    )
    expect(ruleOf(tl, '.run-card__chevron')).toContain('transform var(--spring-interactive)')
    expect(read('features/chat/run-graphics.css')).toMatch(
      /prefers-reduced-motion: reduce\) \{\s*\.run-status__pulse,/,
    )
    const approval = read('features/runs/approval.css')
    expect(ruleOf(approval, '.approval:where([data-pending-id])')).toContain('var(--spring-smooth) ui-enter')
    expect(ruleOf(approval, '.approval')).toContain('background-color var(--motion-base)')
    const q = read('features/runs/question.css')
    expect(ruleOf(q, '.question:where([data-pending-id])')).toContain('var(--spring-smooth) ui-enter')
    expect(q).toMatch(/\.question__mark > svg,\s*\.qopt__check \{[^}]*var\(--spring-bouncy\) ui-enter/)
    expect(q).toMatch(/@media \(pointer: coarse\) \{\s*\.question__opt \{\s*min-height: 40px;/)
    const proc = read('features/runs/process.css')
    expect(proc).toMatch(
      /\.act-root\[data-live\] > \.act-item:last-child \{[^}]*var\(--spring-snappy\) ui-enter/,
    )
    expect(ruleOf(proc, '.act-filter')).toContain('scale var(--spring-interactive)')
    expect(proc).toMatch(/@media \(pointer: coarse\) \{\s*\.act-row \{\s*min-height: 36px;/)
    expect(ruleOf(read('features/runs/runs.css'), '.run-tab__follow')).toContain(
      'var(--spring-bouncy) ui-enter',
    )
    const dock = read('features/chat/task-dock.css')
    expect(ruleOf(dock, '.task-dock__chip')).toContain('var(--spring-snappy) ui-enter')
    expect(ruleOf(dock, '[data-pending-id][data-flash]')).toContain('task-dock-flash')
    expect(dock).toMatch(
      /prefers-reduced-motion: no-preference\) \{\s*\.task-dock__chip--attention \.task-dock__main::before \{\s*animation: task-dock-breathe/,
    )
    expect(dock).toMatch(/@media \(pointer: coarse\) \{\s*\.task-dock__main \{\s*height: 36px;/)
  })

  it('round 6: inbox cards rise in and leave aside, unread bars, touch-sized deletes', () => {
    const motion = read('ui/motion.css')
    expect(ruleOf(motion, '.ui-leaving')).toContain('ui-leave var(--motion-base) forwards')
    const inbox = read('features/chat/thread-inbox.css')
    expect(ruleOf(inbox, '.thread-inbox__card:not(.ui-leaving)')).toContain('ui-enter var(--spring-smooth)')
    expect(ruleOf(inbox, '.thread-inbox__card[data-unread]::before')).toContain('background: var(--accent)')
    expect(inbox).toMatch(/@media \(hover: hover\) \{\s*\.thread-inbox__card:hover/)
    const rail = read('features/chat/group-threads.css')
    expect(rail).toMatch(/@media \(hover: hover\) \{\s*\.group-threads__row:hover/)
    expect(ruleOf(rail, '.group-threads__row[data-unread]::before')).toContain('background: var(--accent)')
    const notif = read('features/notifications/notifications.css')
    expect(ruleOf(notif, '.notif__row[data-new]:not(.ui-leaving)')).toContain('ui-enter var(--spring-snappy)')
    expect(notif).toMatch(/@media \(pointer: coarse\) \{\s*\.notif__delete \{\s*min-width: 32px;/)
  })
  it('round 7: settings sections settle in, phone tabs scroll in one row, armed danger rows turn red', () => {
    const gs = read('features/groups/groups.css')
    expect(ruleOf(gs, '.gs-settings__body')).toContain('ui-enter var(--spring-snappy)')
    expect(ruleOf(gs, '.gs-settings__tab')).toContain('background-color var(--motion-fast)')
    expect(gs).toMatch(/@media \(hover: hover\) \{\s*\.gs-settings__tab:not\(\.gs-settings__tab--on\):hover/)
    expect(gs).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?\.gs-settings__nav \{[^}]*overflow-x: auto;/)
    expect(ruleOf(gs, '.join-preview')).toContain('ui-enter var(--spring-smooth)')
    expect(ruleOf(gs, '.join-preview__sent')).toContain('ui-enter var(--spring-bouncy)')
    expect(ruleOf(gs, '.browse-channels__row')).toContain('ui-fade-in var(--fade-in)')
    const panels = read('ui/im/panels.css')
    expect(panels).toMatch(/\.pn-info__row--danger\[data-armed\],[^{]*\{\s*background: var\(--tint-red\);/)
    expect(ruleOf(panels, '.pn-info__danger-note')).toContain('ui-enter var(--spring-snappy)')
  })
  it('round 8: cards rise in one after another, press in, live dots ring, guide steps slide', () => {
    const works = read('features/works/works.css')
    expect(works).toMatch(
      /\.works__card \{\s*animation:\s*ui-fade-in var\(--fade-in\) backwards,\s*ui-enter var\(--spring-smooth\) backwards;\s*animation-delay: calc\(min\(var\(--i, 0\), 12\) \* 30ms\);/,
    )
    expect(works).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.works__card:active \{\s*scale: 0\.98;/,
    )
    expect(ruleOf(works, '.ui-skeleton.works__grid')).toContain('display: grid')
    const mx = read('features/machines/machines.css')
    expect(ruleOf(mx, '.machine-card')).toContain('ui-enter var(--spring-smooth) backwards')
    expect(mx).toMatch(/@media \(hover: hover\) \{\s*\.machine-card:hover \{/)
    expect(mx).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.machine__status\[data-online="true"\]::before \{\s*animation: ui-live-ring/,
    )
    expect(read('ui/motion.css')).toContain('@keyframes ui-live-ring')
    expect(read('features/bots/bots.css')).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.bot-page__dot\[data-presence="running"\] \{\s*animation: ui-live-ring/,
    )
    const guide = read('features/onboarding/onboarding.css')
    expect(ruleOf(guide, '.guide__step')).toContain('ui-enter var(--spring-snappy)')
    expect(ruleOf(guide, '.guide__step[data-back]')).toContain('--enter-x: -16px')
  })
  it('round 9: phones respect safe areas, push one column at a time, raise dialogs as sheets, grow touch targets', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('viewport-fit=cover, interactive-widget=resizes-content')
    const shell = read('app/shell.css')
    expect(ruleOf(shell, '.app')).toContain(
      'env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)',
    )
    const overlayRail = ruleOf(shell, '.chat__rail--overlay')
    expect(overlayRail).toContain('--enter-x: 100%')
    expect(overlayRail).toContain('animation: var(--spring-smooth) ui-enter')
    expect(shell).toMatch(/\.chat--chat \.chat__center,\s*\.chat--list \.chat__sidebar \{\s*--enter-x: 32px;/)
    expect(ruleOf(shell, '.chat--list .chat__sidebar')).toContain('width: 100%')
    expect(shell).toMatch(/\.chat--list \.chat__sidebar \{\s*--enter-x: -32px;/)
    expect(read('features/chat/composer.css')).toContain('max(var(--space-12), env(safe-area-inset-bottom))')
    const overlay = read('ui/overlay.css')
    expect(overlay).toMatch(/:has\(> \.ui-dialog:not\(\.ui-dialog--bare\)\)\) \{\s*align-items: flex-end;/)
    expect(overlay).toMatch(/\.ui-dialog:where\(:not\(\.ui-dialog--bare\)\) \{\s*--enter-y: 100%;/)
    expect(read('ui/form.css')).toMatch(
      /@media \(pointer: coarse\) \{\s*\.ui-input,\s*\.ui-input--mono \{\s*font-size: 16px;/,
    )
    expect(read('ui/toolbar.css')).toMatch(
      /\.ui-toolbar__btn::after \{\s*content: "";\s*position: absolute;\s*inset: -8px 0;/,
    )
    expect(read('ui/im/panels.css')).toMatch(
      /\.pn-info__close::after \{\s*content: "";\s*position: absolute;\s*inset: -8px;/,
    )
    expect(read('ui/im/header.css')).toMatch(
      /@media \(pointer: coarse\) \{\s*\.pn-chathead__back \{\s*width: 36px;/,
    )
  })
  it('round 10: the skip link hides off screen and springs in on focus', () => {
    const shell = read('app/shell.css')
    const skip = ruleOf(shell, '.app__skip')
    expect(skip).toContain('position: fixed')
    expect(skip).toContain('translate: 0 calc(-100% - 16px)')
    expect(skip).toContain('transition: translate var(--spring-snappy)')
    expect(ruleOf(shell, '.app__skip:focus')).toContain('translate: 0 0')
  })
})
