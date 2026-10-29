import { readFileSync } from 'node:fs'
import { BridgeFromShell } from '@gonggong/protocol'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { injectBridge } from '../src/modules/artifacts/html.js'

const SRC = readFileSync(new URL('../src/modules/artifacts/bridge.js', import.meta.url), 'utf8')
const MAIN = 'https://gg.test'

const PAGE = `<!doctype html><html><head></head><body>
<section data-section="hero"><h1 id="t" style="color: var(--c)">报名</h1>
<a data-gg-link="done" href="other.html">去报名</a><button data-gg-back>返回</button>
<form action="/x"><button id="go">提交</button></form></section>
</body></html>`

/** A screen as a member's preview serves it, framed by a main-site window that records what it is sent. */
function screen(html = PAGE, parent = MAIN) {
  const top = new JSDOM('<!doctype html><body></body>', { url: `${MAIN}/` })
  const posts: { data: Record<string, unknown>; target: string }[] = []
  Object.defineProperty(top.window, 'postMessage', {
    value: (data: Record<string, unknown>, target: string) => posts.push({ data, target }),
  })
  const served = injectBridge(html, parent).replace(
    '<script src="/__gg/bridge.js"',
    `<script data-src="/__gg/bridge.js"`,
  )
  const dom = new JSDOM(
    served.replace('></script>', () => `>${SRC}</script>`),
    {
      url: 'https://p1.preview.test/screens/home.html',
      runScripts: 'dangerously',
      beforeParse(win) {
        Object.defineProperty(win, 'parent', { value: top.window, configurable: true })
      },
    },
  )
  const w = dom.window
  const send = (data: unknown, o: { origin?: string; source?: unknown } = {}) =>
    w.dispatchEvent(
      new w.MessageEvent('message', {
        data,
        origin: o.origin ?? MAIN,
        source: ('source' in o ? o.source : top.window) as never,
      }),
    )
  const $ = (sel: string) => w.document.querySelector(sel) as HTMLElement
  const click = (sel: string) =>
    $(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
  const last = () => posts.at(-1)?.data
  return { w, posts, send, $, click, last }
}

describe('gg-bridge', () => {
  it('announces the screen to the exact main-site origin', () => {
    const s = screen()
    expect(s.posts).toHaveLength(1)
    expect(s.posts[0]?.target).toBe(MAIN)
    expect(BridgeFromShell.parse(s.posts[0]?.data)).toMatchObject({
      source: 'gg-bridge',
      type: 'ready',
      file: 'screens/home.html',
    })
  })

  it('reports where its links and back buttons are, in document coordinates', () => {
    const s = screen()
    const ready = BridgeFromShell.parse(s.posts[0]?.data)
    const a = s.$('[data-gg-link]').getAttribute('data-gg-id')
    const back = s.$('[data-gg-back]').getAttribute('data-gg-id')
    const zero = { x: 0, y: 0, w: 0, h: 0 }
    expect(ready).toMatchObject({
      links: [{ ggId: a, screen: 'done', rect: zero }],
      back: [{ ggId: back, rect: zero }],
    })
    // jsdom has no layout: a scrolled document shifts viewport rects back to document ones.
    Object.defineProperty(s.w, 'scrollY', { value: 300 })
    s.$('[data-gg-link]').getBoundingClientRect = () =>
      ({ left: 10, top: -200, width: 80, height: 20 }) as DOMRect
    s.w.dispatchEvent(new s.w.Event('load'))
    expect(BridgeFromShell.parse(s.last())).toMatchObject({
      type: 'size',
      links: [{ ggId: a, screen: 'done', rect: { x: 10, y: 100, w: 80, h: 20 } }],
    })
    // Nothing moved: no new report.
    const n = s.posts.length
    s.w.dispatchEvent(new s.w.Event('load'))
    expect(s.posts).toHaveLength(n)
  })

  it('sends the transition of a link with nav', () => {
    const s = screen(
      PAGE.replace('<a data-gg-link="done"', '<a data-gg-link="done" data-gg-transition="push-back"'),
    )
    s.click('[data-gg-link]')
    expect(BridgeFromShell.parse(s.last())).toMatchObject({
      type: 'nav',
      screen: 'done',
      transition: 'push-back',
    })
    const bad = screen(
      PAGE.replace('<a data-gg-link="done"', '<a data-gg-link="done" data-gg-transition="spin"'),
    )
    bad.click('[data-gg-link]')
    expect(bad.last()).toEqual({
      source: 'gg-bridge',
      file: 'screens/home.html',
      type: 'nav',
      screen: 'done',
    })
  })

  it('stays silent without a parent origin', () => {
    expect(screen(PAGE, '').posts).toEqual([])
  })

  it('posts nav and back for links in preview mode, before the page navigates', () => {
    const s = screen()
    let pageSaw = 0
    s.w.document.addEventListener('click', () => pageSaw++, true)
    expect(s.click('[data-gg-link]')).toBe(false)
    expect(s.last()).toEqual({ source: 'gg-bridge', file: 'screens/home.html', type: 'nav', screen: 'done' })
    expect(s.click('[data-gg-back]')).toBe(false)
    expect(s.last()).toEqual({ source: 'gg-bridge', file: 'screens/home.html', type: 'back' })
    expect(pageSaw).toBe(0)
    // Other clicks are the page's own.
    s.click('h1')
    expect(pageSaw).toBe(1)
  })

  it('selects in mark and edit mode without following links or submitting forms', () => {
    const s = screen()
    s.send({ type: 'mode', mode: 'edit' })
    let pageSaw = 0
    s.w.document.addEventListener('click', () => pageSaw++, true)
    expect(s.click('[data-gg-link]')).toBe(false)
    const select = BridgeFromShell.parse(s.last())
    expect(select).toMatchObject({
      type: 'select',
      file: 'screens/home.html',
      ggId: s.$('[data-gg-link]').getAttribute('data-gg-id'),
      tag: 'a',
      text: '去报名',
      textOnly: true,
      href: 'other.html',
      link: 'done',
      src: null,
    })
    expect(Object.keys(select.type === 'select' ? select.computed : {})).toEqual([
      'color',
      'background-color',
      'font-size',
      'font-weight',
      'line-height',
      'padding',
      'margin',
      'border-radius',
      'width',
      'height',
    ])
    expect(s.$('[data-gg-link]').hasAttribute('data-gg-selected')).toBe(true)
    s.click('h1')
    expect(s.last()).toMatchObject({ type: 'select', selector: '[id="t"]', inlineStyle: 'color: var(--c)' })
    expect(s.$('[data-gg-link]').hasAttribute('data-gg-selected')).toBe(false)
    expect(s.$('section').hasAttribute('data-gg-id')).toBe(true)
    expect(s.last()).toMatchObject({ textOnly: true, ggId: s.$('h1').getAttribute('data-gg-id') })
    expect(pageSaw).toBe(0)
    const submit = new s.w.Event('submit', { bubbles: true, cancelable: true })
    expect(s.$('form').dispatchEvent(submit)).toBe(false)

    s.send({ type: 'select-clear' })
    expect(s.$('h1').hasAttribute('data-gg-selected')).toBe(false)
    s.send({ type: 'mode', mode: 'preview' })
    s.click('[data-gg-link]')
    expect(s.last()).toMatchObject({ type: 'nav' })
  })

  it('reports hovered elements with outlines that leave the layout alone', () => {
    const s = screen()
    s.send({ type: 'mode', mode: 'mark' })
    s.$('h1').dispatchEvent(new s.w.MouseEvent('mouseover', { bubbles: true }))
    expect(s.last()).toMatchObject({ type: 'hover', ggId: s.$('h1').getAttribute('data-gg-id') })
    expect(s.$('h1').hasAttribute('data-gg-hover')).toBe(true)
    const css = [...s.w.document.querySelectorAll('style')].map((x) => x.textContent).join('')
    expect(css).toContain('[data-gg-hover]{outline:')
    expect(css).not.toMatch(/border|margin|padding/)
  })

  it('outlines highlighted elements and replaces them on the next highlight', () => {
    const s = screen()
    const h1 = s.$('h1').getAttribute('data-gg-id')
    const a = s.$('a').getAttribute('data-gg-id')
    s.send({ type: 'highlight', ggIds: [h1, a, '"]x'] })
    expect([...s.w.document.querySelectorAll('[data-gg-mark]')].map((e) => e.tagName)).toEqual(['H1', 'A'])
    s.send({ type: 'highlight', ggIds: [] })
    expect(s.w.document.querySelectorAll('[data-gg-mark]')).toHaveLength(0)
  })

  it('takes orders only from the exact main-site origin through its parent', () => {
    for (const from of [
      { origin: 'https://gg.test.evil.com' },
      { origin: 'https://p1.preview.test' },
      { origin: 'http://gg.test' },
      { source: null },
      { source: 'self' },
    ]) {
      const s = screen()
      s.send({ type: 'mode', mode: 'mark' }, from.source === 'self' ? { source: s.w } : from)
      s.click('[data-gg-link]')
      expect(s.last()).toMatchObject({ type: 'nav' })
    }
  })
})
