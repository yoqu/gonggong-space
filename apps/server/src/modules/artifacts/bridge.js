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
  // STYLE_PROPS in the contract: what the element panel edits.
  const STYLE_PROPS = new Set([
    'color',
    'background',
    'background-color',
    'border-color',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'text-align',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'gap',
    'border',
    'border-width',
    'border-style',
    'border-radius',
    'width',
    'height',
    'opacity',
  ])
  // What the server and this script add to the stored source.
  const INJECTED = / data-gg-(?:id|selected|hover|mark)(?:="[^"]*")?/g
  let mode = 'preview'
  let hovered = null
  let selected = null
  let marked = []
  // The element under a style preview and its own `style` attribute (null: it had none).
  let previewing = null

  const restorePreview = () => {
    if (!previewing) return
    const { el, own } = previewing
    if (own === null) el.removeAttribute('style')
    else el.setAttribute('style', own)
    previewing = null
  }
  const previewStyle = (id, props) => {
    restorePreview()
    const el = byGgId(id)
    if (!el || !props || typeof props !== 'object') return
    previewing = { el, own: el.getAttribute('style') }
    for (const [k, v] of Object.entries(props)) {
      if (!STYLE_PROPS.has(k) || typeof v !== 'string') continue
      if (v === '') el.style.removeProperty(k)
      else el.style.setProperty(k, v)
    }
  }

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
    '[data-gg-selected]{outline:2px solid #4f7cff !important;outline-offset:-2px}' +
    '#gg-mark-rect{position:absolute;z-index:2147483647;pointer-events:none;' +
    'outline:2px dashed #4f7cff;outline-offset:-2px;background:rgba(79,124,255,.08)}'
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

  // Mirrors the server's text edit: no child elements, or one text run beside children that show no text (icons).
  const textEditable = (el) => {
    if (el.children.length === 0) return true
    const runs = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim() !== '')
    return runs.length === 1 && [...el.children].every((c) => (c.textContent || '').trim() === '')
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
      textOnly: textEditable(el),
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

  // Mark mode: dragging draws a region and posts it (in the viewport, like `select`) with the outermost elements fully
  // inside it; a press without dragging stays a click that selects.
  const DRAG = 4
  let press = null
  let dragged = false
  let box = null
  const clearBox = () => {
    box?.remove()
    box = null
  }
  const regionOf = (e) => {
    const x = e.clientX + window.scrollX
    const y = e.clientY + window.scrollY
    return {
      x: Math.min(x, press.x),
      y: Math.min(y, press.y),
      w: Math.abs(x - press.x),
      h: Math.abs(y - press.y),
    }
  }
  const inside = (r) => {
    const out = []
    for (const el of document.querySelectorAll('[data-gg-id]')) {
      if (out.length >= 200) break
      if (out.some((o) => o.contains(el))) continue
      const d = docRect(el)
      if (d.w > 0 && d.h > 0 && d.x >= r.x && d.y >= r.y && d.x + d.w <= r.x + r.w && d.y + d.h <= r.y + r.h)
        out.push(el)
    }
    return out.map(ggIdOf).filter(Boolean)
  }
  window.addEventListener(
    'mousedown',
    (e) => {
      if (mode !== 'mark' || e.button !== 0) return
      // No text selection or native image drag while marking.
      e.preventDefault()
      clearBox()
      press = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY }
      dragged = false
    },
    true,
  )
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!press) return
      const r = regionOf(e)
      if (!dragged && r.w < DRAG && r.h < DRAG) return
      dragged = true
      if (!box) {
        box = document.createElement('div')
        box.id = 'gg-mark-rect'
        document.body.appendChild(box)
      }
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
    },
    true,
  )
  window.addEventListener(
    'mouseup',
    (e) => {
      if (!press) return
      if (dragged) {
        const r = regionOf(e)
        setSelected(null)
        post({
          type: 'mark-rect',
          rect: { x: r.x - window.scrollX, y: r.y - window.scrollY, w: r.w, h: r.h },
          ggIds: inside(r),
        })
      }
      press = null
    },
    true,
  )

  // Capture on window runs before the page's own listeners (gg-kit's navigation included).
  window.addEventListener(
    'click',
    (e) => {
      const el = target(e)
      if (!el) return
      if (dragged) {
        // The click ending a drawn region selects nothing.
        dragged = false
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
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
        if (mode !== 'mark') clearBox()
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
        clearBox()
        return
      case 'scroll-to':
        byGgId(m.ggId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      case 'preview-style':
        previewStyle(m.ggId, m.props)
        return
      case 'reload':
        location.reload()
        return
    }
  })

  // Links and back buttons in document coordinates, for the canvas's arrows (viewport = document - scroll).
  const docRect = (el) => {
    const r = rectOf(el)
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.w, h: r.h }
  }
  const layout = () => {
    const d = document.documentElement
    return {
      width: d.scrollWidth,
      height: d.scrollHeight,
      links: [...document.querySelectorAll('[data-gg-link]')].slice(0, 500).map((el) => {
        const transition = el.getAttribute('data-gg-transition')
        return {
          ggId: ggIdOf(el),
          screen: el.getAttribute('data-gg-link'),
          rect: docRect(el),
          ...(TRANSITIONS.includes(transition) && { transition }),
        }
      }),
      back: [...document.querySelectorAll('[data-gg-back]')]
        .slice(0, 500)
        .map((el) => ({ ggId: ggIdOf(el), rect: docRect(el) })),
    }
  }
  // Throttled to one post per 100 ms, the last position always sent: the main site moves its overlays with it.
  let scrollTimer = null
  let scrolled = false
  const postScroll = () => post({ type: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY })
  const scrollTick = () => {
    scrollTimer = scrolled ? setTimeout(scrollTick, 100) : null
    if (scrolled) postScroll()
    scrolled = false
  }
  window.addEventListener(
    'scroll',
    () => {
      if (scrollTimer) {
        scrolled = true
        return
      }
      postScroll()
      scrollTimer = setTimeout(scrollTick, 100)
    },
    { passive: true },
  )

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
