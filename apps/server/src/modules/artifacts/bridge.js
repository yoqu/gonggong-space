// gg-bridge: injected by the server into the screens of a member's artifact preview (docs/plan/产物托管与编辑-开发计划.md
// §3.4, contract BridgeToShell / BridgeFromShell in packages/protocol/src/artifacts.ts). Talks only to the main site
// origin in its own `data-gg-parent`, and only takes messages from that origin and from `parent`.
;(() => {
  const script = document.currentScript
  const PARENT = script?.getAttribute('data-gg-parent')
  if (!PARENT || window.parent === window) return
  const FILE = decodeURIComponent(location.pathname).replace(/^\/+/, '')
  const COMPUTED = [
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
  ]
  const TRANSITIONS = ['none', 'push', 'push-back', 'slide-up', 'fade']
  // What the server and this script add to the stored source.
  const INJECTED = / data-gg-(?:id|selected|hover|mark)(?:="[^"]*")?/g
  let mode = 'preview'
  let hovered = null
  let selected = null
  let marked = []

  const post = (msg) => window.parent.postMessage({ source: 'gg-bridge', file: FILE, ...msg }, PARENT)
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }
  const ggIdOf = (el) => {
    const id = el.getAttribute('data-gg-id')
    return id && /^\d{1,9}$/.test(id) ? id : null
  }
  const byGgId = (id) => (/^\d+$/.test(String(id)) ? document.querySelector(`[data-gg-id="${id}"]`) : null)

  const style = document.createElement('style')
  style.textContent =
    '[data-gg-mark]{outline:2px dashed #f5a524 !important;outline-offset:-2px}' +
    '[data-gg-hover]{outline:2px solid rgba(79,124,255,.6) !important;outline-offset:-2px;cursor:pointer}' +
    '[data-gg-selected]{outline:2px solid #4f7cff !important;outline-offset:-2px}'
  document.head.appendChild(style)

  const flag = (el, name, on) => {
    if (!el) return
    if (on) el.setAttribute(name, '')
    else el.removeAttribute(name)
  }
  const setHover = (el) => {
    if (el === hovered) return
    flag(hovered, 'data-gg-hover', false)
    hovered = el
    flag(el, 'data-gg-hover', true)
    post({ type: 'hover', ggId: el ? ggIdOf(el) : null, rect: el ? rectOf(el) : null })
  }
  const setSelected = (el) => {
    flag(selected, 'data-gg-selected', false)
    selected = el
    flag(el, 'data-gg-selected', true)
  }

  const selectorOf = (el) => {
    const parts = []
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id) {
        parts.unshift(`[id="${n.id.replace(/["\\]/g, '\\$&')}"]`)
        break
      }
      const tag = n.tagName.toLowerCase()
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag)
    }
    return parts.join(' > ')
  }

  const describe = (el) => {
    const cs = getComputedStyle(el)
    const transition = el.getAttribute('data-gg-transition')
    const computed = {}
    for (const p of COMPUTED) computed[p] = cs.getPropertyValue(p)
    return {
      type: 'select',
      ggId: ggIdOf(el),
      selector: selectorOf(el),
      rect: rectOf(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      textOnly: el.children.length === 0,
      computed,
      inlineStyle: el.getAttribute('style') || '',
      src: el.getAttribute('src'),
      href: el.getAttribute('href'),
      link: el.getAttribute('data-gg-link'),
      transition: TRANSITIONS.includes(transition) ? transition : null,
      snippet: el.outerHTML.replace(INJECTED, '').slice(0, 300),
    }
  }

  const target = (e) => (e.target instanceof Element ? e.target : null)
  const picking = () => mode === 'mark' || mode === 'edit'

  // Capture on window runs before the page's own listeners (gg-kit's navigation included).
  window.addEventListener(
    'click',
    (e) => {
      const el = target(e)
      if (!el) return
      if (picking()) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setSelected(el)
        post(describe(el))
        return
      }
      const link = el.closest('[data-gg-link],[data-gg-back]')
      if (!link) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const screen = link.getAttribute('data-gg-link')
      const transition = link.getAttribute('data-gg-transition')
      post(
        screen === null
          ? { type: 'back' }
          : { type: 'nav', screen, ...(TRANSITIONS.includes(transition) && { transition }) },
      )
    },
    true,
  )
  window.addEventListener(
    'submit',
    (e) => {
      if (!picking()) return
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true,
  )
  window.addEventListener(
    'mouseover',
    (e) => {
      if (picking()) setHover(target(e))
    },
    true,
  )
  document.documentElement.addEventListener('mouseleave', () => {
    if (picking()) setHover(null)
  })

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT || e.source !== window.parent) return
    const m = e.data
    if (!m || typeof m !== 'object') return
    switch (m.type) {
      case 'mode':
        if (!['preview', 'mark', 'edit'].includes(m.mode)) return
        mode = m.mode
        if (!picking()) {
          setHover(null)
          setSelected(null)
        }
        return
      case 'highlight':
        for (const el of marked) flag(el, 'data-gg-mark', false)
        marked = (Array.isArray(m.ggIds) ? m.ggIds : []).map(byGgId).filter(Boolean)
        for (const el of marked) flag(el, 'data-gg-mark', true)
        return
      case 'select-clear':
        setSelected(null)
        return
      case 'scroll-to':
        byGgId(m.ggId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      case 'reload':
        location.reload()
        return
    }
  })

  // Links and back buttons in document coordinates, for the canvas's arrows.
  const docRect = (el) => {
    const r = rectOf(el)
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.w, h: r.h }
  }
  const layout = () => {
    const d = document.documentElement
    return {
      width: d.scrollWidth,
      height: d.scrollHeight,
      links: [...document.querySelectorAll('[data-gg-link]')].slice(0, 500).map((el) => ({
        ggId: ggIdOf(el),
        screen: el.getAttribute('data-gg-link'),
        rect: docRect(el),
      })),
      back: [...document.querySelectorAll('[data-gg-back]')]
        .slice(0, 500)
        .map((el) => ({ ggId: ggIdOf(el), rect: docRect(el) })),
    }
  }
  let last = ''
  const report = () => {
    const l = layout()
    const key = JSON.stringify(l)
    if (key === last) return
    last = key
    post({ type: 'size', ...l })
  }
  const first = layout()
  last = JSON.stringify(first)
  post({ type: 'ready', ...first })
  window.addEventListener('load', report)
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement)
})()
