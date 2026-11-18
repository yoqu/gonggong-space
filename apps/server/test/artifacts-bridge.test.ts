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
      pretendToBeVisual: true,
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

  it('reports links in a scrolling row as clipped to it, leaves out hidden ones and reports again as it scrolls', async () => {
    const s = screen(`<!doctype html><html><head></head><body>
<div id="row" style="overflow-x: auto"><a id="a" data-gg-link="a">A</a><a id="b" data-gg-link="b">B</a><a id="c" data-gg-link="c">C</a></div>
<button data-gg-back>返回</button></body></html>`)
    const at = (sel: string, left: number, top: number, width: number, height: number) => {
      s.$(sel).getBoundingClientRect = () => ({ left, top, width, height }) as DOMRect
    }
    const sizes = () => s.posts.map((p) => p.data).filter((d) => d.type === 'size')
    // A 375-wide row of 150-wide cards: the second shows in part, the third not at all.
    at('#row', 0, 400, 375, 200)
    at('#a', 13, 400, 150, 200)
    at('#b', 300, 400, 150, 200)
    at('#c', 460, 400, 150, 200)
    Object.defineProperty(s.w, 'scrollY', { value: 100, configurable: true })
    s.w.dispatchEvent(new s.w.Event('load'))
    expect(BridgeFromShell.parse(sizes().at(-1))).toMatchObject({
      links: [
        { screen: 'a', rect: { x: 13, y: 500, w: 150, h: 200 } },
        { screen: 'b', rect: { x: 300, y: 500, w: 75, h: 200 } },
      ],
      back: [{ rect: { x: 0, y: 100, w: 0, h: 0 } }],
    })
    expect(sizes().at(-1)?.links).toHaveLength(2)

    // Scrolled 300 to the left: the first goes, the third comes in; reported once the scrolling settles.
    at('#a', -287, 400, 150, 200)
    at('#b', 0, 400, 150, 200)
    at('#c', 160, 400, 150, 200)
    const n = sizes().length
    s.$('#row').dispatchEvent(new s.w.Event('scroll'))
    s.$('#row').dispatchEvent(new s.w.Event('scroll'))
    await new Promise((r) => setTimeout(r, 150))
    expect(sizes()).toHaveLength(n + 1)
    expect(sizes().at(-1)?.links).toEqual([
      { ggId: s.$('#b').getAttribute('data-gg-id'), screen: 'b', rect: { x: 0, y: 500, w: 150, h: 200 } },
      { ggId: s.$('#c').getAttribute('data-gg-id'), screen: 'c', rect: { x: 160, y: 500, w: 150, h: 200 } },
    ])
  })

  it('reports a link’s valid transition with it', () => {
    const s = screen(
      '<!doctype html><html><head></head><body><a data-gg-link="a" data-gg-transition="fade">A</a><a data-gg-link="b" data-gg-transition="spin">B</a></body></html>',
    )
    const ready = BridgeFromShell.parse(s.posts[0]?.data)
    expect(ready.type === 'ready' && ready.links?.map((l) => [l.screen, l.transition])).toEqual([
      ['a', 'fade'],
      ['b', undefined],
    ])
  })

  it('reports valid rule anchors in document coordinates, and the selected element’s anchor', () => {
    const s = screen(
      '<!doctype html><html><head></head><body><button id="pay" data-gg-anchor="pay-btn">付款</button><p data-gg-anchor="Bad Anchor">x</p><p id="plain">y</p></body></html>',
    )
    const ready = BridgeFromShell.parse(s.posts[0]?.data)
    const pay = s.$('#pay').getAttribute('data-gg-id')
    expect(ready.type === 'ready' && ready.anchors).toEqual([
      { anchor: 'pay-btn', ggId: pay, rect: { x: 0, y: 0, w: 0, h: 0 } },
    ])
    Object.defineProperty(s.w, 'scrollY', { value: 50 })
    s.$('#pay').getBoundingClientRect = () => ({ left: 5, top: 10, width: 60, height: 30 }) as DOMRect
    s.w.dispatchEvent(new s.w.Event('load'))
    expect(BridgeFromShell.parse(s.last())).toMatchObject({
      type: 'size',
      anchors: [{ anchor: 'pay-btn', rect: { x: 5, y: 60, w: 60, h: 30 } }],
    })
    s.send({ type: 'mode', mode: 'edit' })
    s.click('#pay')
    expect(BridgeFromShell.parse(s.last())).toMatchObject({
      type: 'select',
      anchor: 'pay-btn',
      snippet: '<button id="pay" data-gg-anchor="pay-btn">付款</button>',
    })
    s.click('#plain')
    expect(s.last()).toMatchObject({ type: 'select', anchor: null })
  })

  it('reports scrolling once per animation frame, with the position at that frame', async () => {
    const s = screen()
    const scrollTo = (y: number) => {
      Object.defineProperty(s.w, 'scrollY', { value: y, configurable: true })
      s.w.dispatchEvent(new s.w.Event('scroll'))
    }
    const scrolls = () => s.posts.map((p) => p.data).filter((d) => d.type === 'scroll')
    const frame = () => new Promise((r) => s.w.requestAnimationFrame(() => r(null)))
    scrollTo(10)
    scrollTo(20)
    scrollTo(30)
    expect(scrolls()).toEqual([])
    await frame()
    expect(scrolls()).toEqual([
      { source: 'gg-bridge', file: 'screens/home.html', type: 'scroll', scrollX: 0, scrollY: 30 },
    ])
    expect(BridgeFromShell.parse(scrolls()[0])).toMatchObject({ type: 'scroll', scrollY: 30 })
    scrollTo(40)
    await frame()
    expect(scrolls().map((d) => d.scrollY)).toEqual([30, 40])
  })

  it('says where it starts scrolled with ready', () => {
    const s = screen()
    expect(BridgeFromShell.parse(s.posts[0]?.data)).toMatchObject({ type: 'ready', scrollX: 0, scrollY: 0 })
  })

  it('reports anchors that do not show as hidden: in a scrolled-away row, or not displayed', () => {
    const s = screen(`<!doctype html><html><head></head><body>
<div id="row" style="overflow-x: auto"><b id="a" data-gg-anchor="a">A</b><b id="c" data-gg-anchor="c">C</b></div>
<p id="gone" style="display: none" data-gg-anchor="gone">x</p><p id="in" data-gg-anchor="in">y</p></body></html>`)
    const at = (sel: string, left: number, width: number) => {
      s.$(sel).getBoundingClientRect = () => ({ left, top: 400, width, height: 50 }) as DOMRect
    }
    at('#row', 0, 375)
    at('#a', 13, 150)
    at('#c', 460, 150)
    at('#in', 0, 100)
    s.w.dispatchEvent(new s.w.Event('load'))
    const anchors = BridgeFromShell.parse(s.last()).type === 'size' ? (s.last()?.anchors as unknown[]) : []
    expect(anchors.map((a) => [(a as { anchor: string }).anchor, (a as { hidden?: true }).hidden])).toEqual([
      ['a', undefined],
      ['c', true],
      ['gone', true],
      ['in', undefined],
    ])
  })

  it('reports anchors a script shows later (a dialog from a template): hidden in the template, shown once inserted', async () => {
    const s = screen(`<!doctype html><html><head></head><body><dialog id="d"></dialog>
<template id="tpl"><section data-gg-anchor="occupancy">占用</section></template></body></html>`)
    const frame = () => new Promise((r) => s.w.requestAnimationFrame(() => r(null)))
    const anchors = () => {
      const d = s.posts
        .map((p) => p.data)
        .filter((m) => m.type === 'ready' || m.type === 'size')
        .at(-1)
      return (
        BridgeFromShell.parse(d) as { anchors: { anchor: string; ggId: string | null; hidden?: true }[] }
      ).anchors
    }
    const inTemplate = (s.$('#tpl') as HTMLTemplateElement).content.querySelector('section')
    expect(anchors()).toEqual([
      {
        anchor: 'occupancy',
        ggId: inTemplate?.getAttribute('data-gg-id'),
        rect: { x: 0, y: 0, w: 0, h: 0 },
        hidden: true,
      },
    ])
    const shown = (s.$('#tpl') as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment
    const section = shown.querySelector('section') as HTMLElement
    section.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 80 }) as DOMRect
    s.$('#d').setAttribute('open', '')
    s.$('#d').append(shown)
    await frame()
    await frame()
    expect(anchors()).toEqual([
      {
        anchor: 'occupancy',
        ggId: inTemplate?.getAttribute('data-gg-id'),
        rect: { x: 10, y: 20, w: 300, h: 80 },
      },
    ])
  })

  it('brings an element into view by scrolling its own boxes and the page only, the least it takes', () => {
    const s = screen(`<!doctype html><html><head></head><body>
<div id="row" style="overflow-x: auto"><b id="c" data-gg-anchor="c">C</b><b id="d">D</b></div>
<nav id="tab" style="position: fixed; bottom: 0"><b id="t" data-gg-anchor="t">T</b></nav></body></html>`)
    const viaIntoView: unknown[] = []
    s.w.HTMLElement.prototype.scrollIntoView = (o: unknown) => {
      viaIntoView.push(o)
    }
    const calls: { who: string; o: unknown }[] = []
    s.w.HTMLElement.prototype.scrollTo = function (this: HTMLElement, o: unknown) {
      calls.push({ who: this.id, o })
    } as never
    s.w.scrollTo = ((o: unknown) => calls.push({ who: 'window', o })) as never
    const box = (sel: string, left: number, top: number, width: number, height: number) => {
      s.$(sel).getBoundingClientRect = () => ({ left, top, width, height }) as DOMRect
    }
    Object.defineProperty(s.w, 'innerWidth', { value: 375, configurable: true })
    Object.defineProperty(s.w, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(s.w, 'scrollY', { value: 100, configurable: true })
    // The row: 375 wide at y 1000 (viewport), scrolling sideways; the card at x 600 in it, the second at 100.
    box('#row', 0, 1000, 375, 100)
    box('#c', 600, 1000, 150, 100)
    box('#d', 100, 1000, 150, 100)
    Object.defineProperty(s.$('#row'), 'scrollWidth', { value: 900 })
    Object.defineProperty(s.$('#row'), 'clientWidth', { value: 375 })
    Object.defineProperty(s.$('#row'), 'clientHeight', { value: 100 })
    const id = (sel: string) => s.$(sel).getAttribute('data-gg-id')
    s.send({ type: 'scroll-to', ggId: id('#c') })
    expect(viaIntoView).toEqual([])
    // Nearest: the row brings the card's right edge in (750 - 375 + 8), the page the row's bottom (1100 - 800 + 8).
    expect(calls).toEqual([
      { who: 'row', o: { left: 383, top: 0, behavior: 'smooth' } },
      { who: 'window', o: { left: 0, top: 408, behavior: 'smooth' } },
    ])
    calls.length = 0
    s.send({ type: 'scroll-to', ggId: id('#c'), behavior: 'instant' })
    expect(calls.map((c) => (c.o as { behavior: string }).behavior)).toEqual(['instant', 'instant'])
    // In view already: nothing scrolls.
    calls.length = 0
    box('#row', 0, 300, 375, 100)
    box('#d', 100, 300, 150, 100)
    s.send({ type: 'scroll-to', ggId: id('#d') })
    expect(calls).toEqual([])
    // Pinned to the viewport (a fixed tab bar): scrolling would not bring it anywhere.
    box('#t', 0, 900, 375, 56)
    s.send({ type: 'scroll-to', ggId: id('#t') })
    expect(calls).toEqual([])
  })

  it('reports an anchor pinned to the viewport (fixed) in viewport coordinates, and outlines it with a fixed box', () => {
    const s = screen(`<!doctype html><html><head></head><body>
<nav id="tab" style="position: fixed; bottom: 0"><b id="t" data-gg-anchor="t">T</b></nav><p id="p" data-gg-anchor="p">P</p></body></html>`)
    Object.defineProperty(s.w, 'scrollY', { value: 300, configurable: true })
    s.$('#t').getBoundingClientRect = () => ({ left: 0, top: 744, width: 375, height: 56 }) as DOMRect
    s.$('#p').getBoundingClientRect = () => ({ left: 0, top: 10, width: 100, height: 20 }) as DOMRect
    s.w.dispatchEvent(new s.w.Event('load'))
    const size = BridgeFromShell.parse(s.last())
    expect(size.type === 'size' && size.anchors).toEqual([
      {
        anchor: 't',
        ggId: s.$('#t').getAttribute('data-gg-id'),
        rect: { x: 0, y: 744, w: 375, h: 56 },
        fixed: true,
      },
      { anchor: 'p', ggId: s.$('#p').getAttribute('data-gg-id'), rect: { x: 0, y: 310, w: 100, h: 20 } },
    ])
    s.send({ type: 'highlight', ggIds: [s.$('#t').getAttribute('data-gg-id')], tone: 'settled' })
    const b = s.w.document.querySelector('.gg-mark-box') as HTMLElement
    expect([b.style.position, b.style.top]).toEqual(['fixed', '744px'])
  })

  it('draws the outline only where a scrolling box lets its element show', () => {
    const s = screen(`<!doctype html><html><head></head><body>
<div id="row" style="overflow-x: auto"><b id="c" data-gg-anchor="c">C</b></div></body></html>`)
    s.$('#row').getBoundingClientRect = () => ({ left: 0, top: 100, width: 375, height: 100 }) as DOMRect
    s.$('#c').getBoundingClientRect = () => ({ left: 300, top: 100, width: 150, height: 100 }) as DOMRect
    s.send({ type: 'highlight', ggIds: [s.$('#c').getAttribute('data-gg-id')], tone: 'pending' })
    const b = s.w.document.querySelector('.gg-mark-box') as HTMLElement
    expect([b.style.left, b.style.width]).toEqual(['300px', '75px'])
  })

  it('draws no outline for an element not displayed, and none over a pinned layer covering it', () => {
    const s = screen(`<!doctype html><html><head></head><body>
<div id="head" style="position: fixed; top: 0">筛选</div><p id="gone" style="display: none">x</p><p id="p">P</p></body></html>`)
    s.$('#head').getBoundingClientRect = () => ({ left: 0, top: 0, width: 375, height: 60 }) as DOMRect
    s.$('#p').getBoundingClientRect = () => ({ left: 0, top: 40, width: 375, height: 60 }) as DOMRect
    s.w.dispatchEvent(new s.w.Event('load'))
    const boxes = () => [...s.w.document.querySelectorAll('.gg-mark-box')] as HTMLElement[]
    s.send({ type: 'highlight', ggIds: [s.$('#gone').getAttribute('data-gg-id')], tone: 'settled' })
    expect(boxes()).toEqual([])
    // Under the fixed head down to 60: only what shows below it is outlined.
    s.send({ type: 'highlight', ggIds: [s.$('#p').getAttribute('data-gg-id')], tone: 'settled' })
    expect(boxes().map((b) => [b.style.top, b.style.height])).toEqual([['60px', '40px']])
  })

  it('follows a scrolling box frame by frame: the outline and the anchors', async () => {
    const s = screen(`<!doctype html><html><head></head><body>
<div id="row" style="overflow-x: auto"><b id="c" data-gg-anchor="c">C</b></div></body></html>`)
    s.$('#row').getBoundingClientRect = () => ({ left: 0, top: 100, width: 375, height: 100 }) as DOMRect
    let x = 200
    s.$('#c').getBoundingClientRect = () => ({ left: x, top: 100, width: 100, height: 100 }) as DOMRect
    s.send({ type: 'highlight', ggIds: [s.$('#c').getAttribute('data-gg-id')], tone: 'settled' })
    const frame = () => new Promise((r) => s.w.requestAnimationFrame(() => r(null)))
    const anchorX = () => {
      const d = s.posts
        .map((p) => p.data)
        .filter((m) => m.type === 'size')
        .at(-1) as { anchors: { rect: { x: number } }[] }
      return d?.anchors[0]?.rect.x
    }
    for (const at of [150, 120, 90]) {
      x = at
      s.$('#row').dispatchEvent(new s.w.Event('scroll'))
      await frame()
      await frame()
      expect((s.w.document.querySelector('.gg-mark-box') as HTMLElement).style.left).toBe(`${at}px`)
      expect(anchorX()).toBe(at)
    }
  })

  it('reports the layers pinned over the page (a sticky head, a fixed tab bar) as covers, in viewport coordinates', () => {
    const s = screen(`<!doctype html><html><head></head><body>
<div id="head" style="position: sticky; top: 0">筛选</div><p>正文</p>
<div style="position: fixed; top: 0; opacity: 0">透明</div><div style="position: fixed; top: 0; visibility: hidden">隐藏</div>
<div style="position: fixed; inset: 0; pointer-events: none">点不到的装饰</div>
<nav id="tab" style="position: fixed; bottom: 0"><b data-gg-anchor="t">T</b></nav></body></html>`)
    for (const el of s.w.document.querySelectorAll('div')) {
      if (el.id) continue
      ;(el as HTMLElement).getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 375, height: 800 }) as DOMRect
    }
    s.$('#head').getBoundingClientRect = () => ({ left: 0, top: 0, width: 375, height: 40 }) as DOMRect
    s.$('#tab').getBoundingClientRect = () => ({ left: 0, top: 756, width: 375, height: 56 }) as DOMRect
    s.w.dispatchEvent(new s.w.Event('load'))
    const size = BridgeFromShell.parse(s.last())
    expect(size.type === 'size' && size.covers).toEqual([
      { x: 0, y: 0, w: 375, h: 40 },
      { x: 0, y: 756, w: 375, h: 56 },
    ])
  })

  it('scrolls the page to a position at once (coming back to a screen)', () => {
    const s = screen()
    const calls: unknown[] = []
    s.w.scrollTo = ((o: unknown) => calls.push(o)) as never
    s.send({ type: 'scroll-position', x: 0, y: 420 })
    expect(calls).toEqual([{ left: 0, top: 420, behavior: 'instant' }])
  })

  it('hands zoom gestures to the main site instead of letting the browser zoom the whole page', () => {
    const s = screen()
    const zooms = () => s.posts.map((p) => p.data).filter((d) => d.type === 'zoom')
    const wheel = (o: Record<string, unknown>) => {
      const e = new s.w.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 40,
        ...o,
      })
      s.w.document.body.dispatchEvent(e)
      return e.defaultPrevented
    }
    // A pinch on a trackpad is a wheel with ctrlKey.
    expect(wheel({ deltaY: 100, ctrlKey: true })).toBe(true)
    expect(wheel({ deltaY: -50, metaKey: true })).toBe(true)
    // Plain scrolling stays the page's.
    expect(wheel({ deltaY: 100 })).toBe(false)
    const key = (k: string) => {
      const e = new s.w.KeyboardEvent('keydown', { key: k, metaKey: true, bubbles: true, cancelable: true })
      s.w.document.body.dispatchEvent(e)
      return e.defaultPrevented
    }
    Object.defineProperty(s.w, 'innerWidth', { value: 400 })
    Object.defineProperty(s.w, 'innerHeight', { value: 800 })
    expect(key('=')).toBe(true)
    expect(key('-')).toBe(true)
    expect(key('c')).toBe(false)
    // Safari reports a pinch as gesture events.
    const gesture = (type: string, scale: number) => {
      const e = Object.assign(new s.w.Event(type, { bubbles: true, cancelable: true }), {
        scale,
        clientX: 5,
        clientY: 6,
      })
      s.w.document.body.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(gesture('gesturestart', 1)).toBe(true)
    expect(gesture('gesturechange', 2)).toBe(true)
    expect(zooms().map((d) => BridgeFromShell.parse(d))).toEqual([
      { source: 'gg-bridge', type: 'zoom', file: 'screens/home.html', factor: Math.exp(-1), x: 30, y: 40 },
      { source: 'gg-bridge', type: 'zoom', file: 'screens/home.html', factor: Math.exp(0.5), x: 30, y: 40 },
      { source: 'gg-bridge', type: 'zoom', file: 'screens/home.html', factor: 1.25, x: 200, y: 400 },
      { source: 'gg-bridge', type: 'zoom', file: 'screens/home.html', factor: 0.8, x: 200, y: 400 },
      { source: 'gg-bridge', type: 'zoom', file: 'screens/home.html', factor: 2, x: 5, y: 6 },
    ])
  })

  it('passes unmodified keys to the main site in preview mode, not from fields, nor in edit mode', () => {
    const s = screen(`${PAGE.replace('</section>', '<input id="name"></section>')}`)
    const keys = () => s.posts.map((p) => p.data).filter((d) => d.type === 'key')
    const press = (el: EventTarget, key: string, o: Record<string, boolean> = {}) =>
      el.dispatchEvent(new s.w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o }))
    press(s.w.document.body, 'n')
    press(s.w.document.body, 'ArrowLeft', { repeat: true })
    press(s.w.document.body, 'n', { metaKey: true })
    press(s.w.document.body, 'Tab')
    // Shift+← selects; it is not ←.
    press(s.w.document.body, 'ArrowLeft', { shiftKey: true })
    press(s.$('#name'), 'n')
    // The page's own keys: taken already, or on a control that uses them.
    s.$('#t').addEventListener('keydown', (e) => e.preventDefault())
    press(s.$('#t'), 'ArrowRight')
    s.$('[data-gg-back]').setAttribute('role', 'slider')
    press(s.$('[data-gg-back]'), 'ArrowLeft')
    // Home stays the page's (never passed on); arrows inside a sideways-scrolling box are that box's.
    press(s.w.document.body, 'Home')
    const row = s.w.document.createElement('div')
    row.style.overflowX = 'auto'
    Object.defineProperty(row, 'scrollWidth', { value: 900 })
    Object.defineProperty(row, 'clientWidth', { value: 375 })
    const cell = s.w.document.createElement('span')
    row.appendChild(cell)
    s.w.document.body.appendChild(row)
    press(cell, 'ArrowRight')
    expect(keys().map((d) => BridgeFromShell.parse(d))).toMatchObject([
      { type: 'key', key: 'n', repeat: false },
      { type: 'key', key: 'ArrowLeft', repeat: true },
    ])
    s.send({ type: 'mode', mode: 'edit' })
    press(s.w.document.body, 'n')
    expect(keys()).toHaveLength(2)
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
    // Other clicks are the page's own; the canvas hears of the miss to show where the hotspots are.
    s.click('h1')
    expect(pageSaw).toBe(1)
    expect(BridgeFromShell.parse(s.last())).toEqual({
      source: 'gg-bridge',
      file: 'screens/home.html',
      type: 'miss',
    })
  })

  it('lets the text beside icon-only children be edited, not text spread over children', () => {
    const s = screen(`<!doctype html><html><body>
<div id="f"><svg class="i"><use href="#i-shower"/></svg>热水淋浴</div><p id="m">说明 <b>重点</b></p>
</body></html>`)
    s.send({ type: 'mode', mode: 'edit' })
    s.click('#f')
    expect(s.last()).toMatchObject({ type: 'select', text: '热水淋浴', textOnly: true })
    s.click('#m')
    expect(s.last()).toMatchObject({ type: 'select', text: '说明 重点', textOnly: false })
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
    expect(s.posts.some((p) => p.data.type === 'miss')).toBe(false)
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
    // A page rule's element in its mark's tone: a box drawn over it (its own shadow and an image stay as they are).
    Object.defineProperty(s.w, 'scrollY', { value: 50, configurable: true })
    s.$('h1').getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 30 }) as DOMRect
    s.send({ type: 'highlight', ggIds: [h1], tone: 'pending' })
    expect(s.$('h1').getAttribute('data-gg-mark')).toBe('pending')
    const boxes = () => [...s.w.document.querySelectorAll('.gg-mark-box')] as HTMLElement[]
    // Fixed, in viewport coordinates, on the root (a positioned or transformed body would move it off).
    expect(
      boxes().map((b) => [
        b.dataset.tone,
        b.style.position,
        b.style.left,
        b.style.top,
        b.style.width,
        b.style.height,
      ]),
    ).toEqual([['pending', 'fixed', '10px', '20px', '100px', '30px']])
    expect(boxes()[0]?.parentElement).toBe(s.w.document.documentElement)
    s.send({ type: 'highlight', ggIds: [h1], tone: 'settled' })
    expect(boxes().map((b) => b.dataset.tone)).toEqual(['settled'])
    // Drawn 2px wide on the main site's screen whatever the device's zoom (×2.5 at 0.4).
    s.send({ type: 'highlight', ggIds: [h1], tone: 'settled', unscale: 2.5 })
    expect(boxes()[0]?.style.outlineWidth).toBe('5px')
    const css = s.w.document.head.querySelector('style')?.textContent ?? ''
    expect(css).toContain('.gg-mark-box[data-tone="settled"]{outline:2px solid')
    expect(css).toContain('.gg-mark-box[data-tone="pending"]{outline:2px dashed')
    expect(css).not.toContain('box-shadow:inset 0 0 0 100vmax')
    s.send({ type: 'highlight', ggIds: [] })
    expect(boxes()).toEqual([])
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

describe('gg-bridge in-place text editing', () => {
  const PAGE2 = `<!doctype html><html><body>
<h1 id="h">本周共读</h1>
<a id="btn" data-gg-link="join"><svg class="i"><use href="#i-book"/></svg>加入本周共读</a>
<section id="card"><h2 id="t">悉达多</h2><p id="m">说明 <b id="b">重点</b></p></section>
<div id="solo"><span id="only">唯一</span><i class="icon"></i></div>
</body></html>`
  const edit = () => {
    const s = screen(PAGE2)
    s.send({ type: 'mode', mode: 'edit' })
    const id = (sel: string) => s.$(sel).getAttribute('data-gg-id') as string
    const key = (key: string) =>
      s.w.document.activeElement?.dispatchEvent(
        new s.w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      ) ?? s.w.dispatchEvent(new s.w.KeyboardEvent('keydown', { key, cancelable: true }))
    const textEdits = () =>
      s.posts
        .map((p) => p.data)
        .filter((d) => d.type === 'text-edit')
        .map((d) => BridgeFromShell.parse(d))
    return { ...s, id, key, textEdits }
  }
  const type = (el: HTMLElement, text: string) => {
    el.textContent = text
  }

  it('makes a text element editable with all its text selected; Enter keeps the new text and posts it', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#h') })
    const h = s.$('#h')
    expect(h.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(h.hasAttribute('data-gg-editing')).toBe(true)
    expect(s.w.getSelection()?.toString()).toBe('本周共读')
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'editing', ggId: s.id('#h'), text: null })
    type(h, '  本月\n共读 ')
    expect(h.textContent).toContain('\n')
    s.key('Enter')
    expect(h.hasAttribute('contenteditable')).toBe(false)
    expect(h.hasAttribute('data-gg-editing')).toBe(false)
    expect(h.textContent).toBe('本月 共读')
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', ggId: s.id('#h'), text: '本月 共读' })
  })

  it('Escape puts the text back; an unchanged text posts no text', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#h') })
    type(s.$('#h'), '改了')
    s.key('Escape')
    expect(s.$('#h').textContent).toBe('本周共读')
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', text: null })
    s.send({ type: 'edit-text', ggId: s.id('#h') })
    s.key('Enter')
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', ggId: s.id('#h'), text: null })
  })

  it('edits only the text beside an icon, leaving the icon in place', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#btn') })
    const host = s.$('[data-gg-editing]')
    expect(host.tagName).toBe('SPAN')
    expect(host.textContent).toBe('加入本周共读')
    type(host, '立即加入')
    s.key('Enter')
    expect(s.$('#btn').querySelector('svg')).toBeTruthy()
    expect(s.$('#btn').querySelector('span')).toBeNull()
    expect(s.$('#btn').textContent).toBe('立即加入')
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', ggId: s.id('#btn'), text: '立即加入' })
  })

  it('outlines every editable text on the screen for picking; a click on one edits it', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#card') })
    const outlined = [...s.w.document.querySelectorAll('[data-gg-pick]')].map((e) => e.id)
    expect(outlined).toEqual(['h', 'btn', 't', 'b', 'only'])
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'picking', ggId: null })
    const selects = s.posts.filter((p) => p.data.type === 'select').length
    s.click('#b')
    expect(s.posts.filter((p) => p.data.type === 'select')).toHaveLength(selects)
    expect(s.w.document.querySelectorAll('[data-gg-pick]')).toHaveLength(0)
    expect(s.$('#b').getAttribute('contenteditable')).toBe('plaintext-only')
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'editing', ggId: s.id('#b') })
    // Clicks inside the text being edited move the caret, nothing else.
    s.click('#b')
    expect(s.posts.filter((p) => p.data.type === 'select')).toHaveLength(selects)
  })

  it('edits the only text inside at once, and picks over the whole screen otherwise', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#solo') })
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'editing', ggId: s.id('#only') })
    s.key('Escape')
    s.$('#card').insertAdjacentHTML('beforeend', '<div id="empty" data-gg-id="999"><i></i><i></i></div>')
    s.send({ type: 'edit-text', ggId: '999' })
    expect([...s.w.document.querySelectorAll('[data-gg-pick]')].map((e) => e.id)).toEqual([
      'h',
      'btn',
      't',
      'b',
      'only',
    ])
  })

  it('a click beside the outlined texts, Escape or select-clear ends picking', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#card') })
    s.click('#m')
    expect(s.w.document.querySelectorAll('[data-gg-pick]')).toHaveLength(0)
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', ggId: null, text: null })
    expect(s.last()).toMatchObject({ type: 'select', ggId: s.id('#m') })
    s.send({ type: 'edit-text', ggId: s.id('#card') })
    s.key('Escape')
    expect(s.w.document.querySelectorAll('[data-gg-pick]')).toHaveLength(0)
    s.send({ type: 'edit-text', ggId: s.id('#card') })
    s.send({ type: 'select-clear' })
    expect(s.w.document.querySelectorAll('[data-gg-pick]')).toHaveLength(0)
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', ggId: null })
  })

  it('select-clear and leaving edit mode keep the text being edited', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#t') })
    type(s.$('#t'), '流浪者之歌')
    s.send({ type: 'select-clear' })
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', ggId: s.id('#t'), text: '流浪者之歌' })
    s.send({ type: 'edit-text', ggId: s.id('#h') })
    type(s.$('#h'), '新标题')
    s.send({ type: 'mode', mode: 'preview' })
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'done', ggId: s.id('#h'), text: '新标题' })
    expect(s.$('#h').hasAttribute('contenteditable')).toBe(false)
    // Only edit mode edits.
    s.send({ type: 'edit-text', ggId: s.id('#h') })
    expect(s.$('#h').hasAttribute('contenteditable')).toBe(false)
  })

  it('a double click in edit mode edits the text under the pointer, an icon’s too', () => {
    const s = edit()
    s.$('#btn svg').dispatchEvent(new s.w.MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(s.textEdits().at(-1)).toMatchObject({ state: 'editing', ggId: s.id('#btn') })
    s.key('Escape')
    s.send({ type: 'mode', mode: 'mark' })
    s.$('#h').dispatchEvent(new s.w.MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(s.$('#h').hasAttribute('contenteditable')).toBe(false)
  })

  it('leaves the editing marks out of the snippet', () => {
    const s = edit()
    s.send({ type: 'edit-text', ggId: s.id('#card') })
    s.send({ type: 'select-clear' })
    s.click('#card')
    expect(BridgeFromShell.parse(s.last())).toMatchObject({ type: 'select' })
    expect(String(s.last()?.snippet)).not.toMatch(/data-gg-(pick|editing)|contenteditable/)
  })
})
