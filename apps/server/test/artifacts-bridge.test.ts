import { readFileSync } from 'node:fs'
import { BridgeFromShell, STYLE_PROPS } from '@gonggong/protocol'
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

  it('reports scrolling at most every 100 ms, ending with the last position', async () => {
    const s = screen()
    const scrollTo = (y: number) => {
      Object.defineProperty(s.w, 'scrollY', { value: y, configurable: true })
      s.w.dispatchEvent(new s.w.Event('scroll'))
    }
    const scrolls = () => s.posts.map((p) => p.data).filter((d) => d.type === 'scroll')
    scrollTo(10)
    scrollTo(20)
    scrollTo(30)
    expect(scrolls()).toEqual([
      { source: 'gg-bridge', file: 'screens/home.html', type: 'scroll', scrollX: 0, scrollY: 10 },
    ])
    expect(BridgeFromShell.parse(scrolls()[0])).toMatchObject({ type: 'scroll', scrollY: 10 })
    await new Promise((r) => setTimeout(r, 150))
    expect(scrolls().map((d) => d.scrollY)).toEqual([10, 30])
    await new Promise((r) => setTimeout(r, 150))
    scrollTo(40)
    expect(scrolls().map((d) => d.scrollY)).toEqual([10, 30, 40])
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

  it('in mark mode, dragging posts the region (viewport) and the outermost elements wholly inside it; a click still selects', () => {
    const s = screen()
    s.send({ type: 'mode', mode: 'mark' })
    // jsdom has no layout: place the elements by hand (viewport = document, no scroll).
    const at = (sel: string, left: number, top: number, width: number, height: number) => {
      s.$(sel).getBoundingClientRect = () => ({ left, top, width, height }) as DOMRect
    }
    at('section', 0, 0, 390, 300)
    at('h1', 10, 10, 200, 40)
    at('[data-gg-link]', 10, 60, 80, 20)
    at('[data-gg-back]', 10, 260, 80, 20)
    const mouse = (type: string, x: number, y: number, sel = 'h1') =>
      s
        .$(sel)
        .dispatchEvent(new s.w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    const before = s.posts.length
    expect(mouse('mousedown', 220, 90)).toBe(false)
    mouse('mousemove', 100, 50)
    mouse('mousemove', 5, 5)
    expect(s.w.document.getElementById('gg-mark-rect')).not.toBeNull()
    mouse('mouseup', 5, 5)
    expect(s.click('h1')).toBe(false)
    expect(s.posts.slice(before).map((p) => p.data.type)).toEqual(['mark-rect'])
    expect(BridgeFromShell.parse(s.last())).toEqual({
      source: 'gg-bridge',
      file: 'screens/home.html',
      type: 'mark-rect',
      rect: { x: 5, y: 5, w: 215, h: 85 },
      ggIds: [s.$('h1').getAttribute('data-gg-id'), s.$('[data-gg-link]').getAttribute('data-gg-id')],
    })
    expect(s.$('h1').hasAttribute('data-gg-selected')).toBe(false)

    // A press without dragging is a click: it selects, and the region box goes.
    mouse('mousedown', 20, 20)
    mouse('mousemove', 21, 21)
    mouse('mouseup', 21, 21)
    expect(s.w.document.getElementById('gg-mark-rect')).toBeNull()
    s.click('h1')
    expect(s.last()).toMatchObject({ type: 'select', ggId: s.$('h1').getAttribute('data-gg-id') })

    // The outermost element covers what is inside it; edit mode draws nothing.
    mouse('mousedown', 0, 0)
    mouse('mousemove', 400, 400)
    mouse('mouseup', 400, 400)
    expect(s.last()).toMatchObject({ type: 'mark-rect', ggIds: [s.$('section').getAttribute('data-gg-id')] })
    s.send({ type: 'select-clear' })
    expect(s.w.document.getElementById('gg-mark-rect')).toBeNull()

    // Scrolled: the region is posted in the viewport, while elements are matched in the document.
    Object.defineProperty(s.w, 'scrollY', { value: 100, configurable: true })
    at('h1', 10, -90, 200, 40)
    at('[data-gg-link]', 10, -40, 80, 20)
    mouse('mousedown', 5, -95)
    mouse('mousemove', 220, -10)
    mouse('mouseup', 220, -10)
    expect(s.last()).toMatchObject({
      type: 'mark-rect',
      rect: { x: 5, y: -95, w: 215, h: 85 },
      ggIds: [s.$('h1').getAttribute('data-gg-id'), s.$('[data-gg-link]').getAttribute('data-gg-id')],
    })
    s.send({ type: 'mode', mode: 'edit' })
    const n = s.posts.length
    mouse('mousedown', 0, 0)
    mouse('mousemove', 300, 300)
    mouse('mouseup', 300, 300)
    expect(s.posts.length).toBe(n)
  })

  it('reports the transition and a clean, truncated snippet of the selected element', () => {
    const long = '很长的文字'.repeat(100)
    const s = screen(
      PAGE.replace('<a data-gg-link="done"', '<a data-gg-link="done" data-gg-transition="slide-up"').replace(
        '<button id="go">提交</button>',
        `<button id="go">提交</button><p id="long">${long}</p>`,
      ),
    )
    s.send({ type: 'mode', mode: 'mark' })
    s.send({ type: 'highlight', ggIds: [s.$('a').getAttribute('data-gg-id')] })
    s.$('a').dispatchEvent(new s.w.MouseEvent('mouseover', { bubbles: true }))
    s.click('a')
    expect(BridgeFromShell.parse(s.last())).toMatchObject({
      type: 'select',
      transition: 'slide-up',
      snippet: '<a data-gg-link="done" data-gg-transition="slide-up" href="other.html">去报名</a>',
    })
    s.click('h1')
    expect(s.last()).toMatchObject({
      transition: null,
      snippet: '<h1 id="t" style="color: var(--c)">报名</h1>',
    })
    s.click('section')
    const section = BridgeFromShell.parse(s.last())
    const snippet = section.type === 'select' ? section.snippet : ''
    expect(snippet).toHaveLength(300)
    expect(snippet.startsWith('<section data-section="hero"><h1 id="t"')).toBe(true)
    expect(snippet).not.toContain('data-gg-id')
    expect(snippet).not.toMatch(/data-gg-(selected|hover|mark)/)

    const bad = screen(
      PAGE.replace('<a data-gg-link="done"', '<a data-gg-link="done" data-gg-transition="spin"'),
    )
    bad.send({ type: 'mode', mode: 'edit' })
    bad.click('a')
    expect(bad.last()).toMatchObject({ type: 'select', transition: null })
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

  it('previews style on one element at a time and puts its own style back', () => {
    const s = screen()
    const h1 = s.$('h1')
    const a = s.$('a')
    const own = h1.getAttribute('style')
    s.send({ type: 'preview-style', ggId: h1.getAttribute('data-gg-id'), props: { 'font-size': '20px' } })
    expect(h1.style.getPropertyValue('font-size')).toBe('20px')
    expect(h1.style.getPropertyValue('color')).toBe('var(--c)')
    // Each message is the whole preview: earlier values go, an empty value removes the element's own property.
    s.send({
      type: 'preview-style',
      ggId: h1.getAttribute('data-gg-id'),
      props: { color: '', width: '10px' },
    })
    expect(h1.style.getPropertyValue('font-size')).toBe('')
    expect(h1.style.getPropertyValue('color')).toBe('')
    expect(h1.style.getPropertyValue('width')).toBe('10px')
    // Another element: the previous one gets its own style back first.
    s.send({ type: 'preview-style', ggId: a.getAttribute('data-gg-id'), props: { opacity: '0.5' } })
    expect(h1.getAttribute('style')).toBe(own)
    expect(a.style.getPropertyValue('opacity')).toBe('0.5')
    s.send({ type: 'preview-style', ggId: a.getAttribute('data-gg-id'), props: null })
    expect(a.hasAttribute('style')).toBe(false)
    // Unknown elements and properties outside the editable set change nothing.
    s.send({ type: 'preview-style', ggId: '"]x', props: { color: 'var(--c)' } })
    s.send({ type: 'preview-style', ggId: h1.getAttribute('data-gg-id'), props: { position: 'fixed' } })
    expect(h1.getAttribute('style')).toBe(own)
    // Every property the element panel edits can be previewed.
    for (const p of STYLE_PROPS) {
      s.send({ type: 'preview-style', ggId: h1.getAttribute('data-gg-id'), props: { [p]: 'inherit' } })
      expect(h1.style.getPropertyValue(p), p).toBe('inherit')
    }
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
