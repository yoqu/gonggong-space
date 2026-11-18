// gg-bridge: injected by the server into the screens of a member's artifact preview (docs/archive/2026-11/产物托管与编辑-开发计划.md
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
  // ArtifactAnchor in the contract.
  const ANCHOR = /^[a-z0-9]+(-[a-z0-9]+)*$/
  // data-gg-set (parseStateSet in the contract); null when absent or malformed.
  const stateSet = (text) => {
    const pairs = (text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => /^([a-z0-9]+(?:-[a-z0-9]+)*)=([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(p))
    return pairs.length && pairs.every(Boolean) ? Object.fromEntries(pairs.map((m) => [m[1], m[2]])) : null
  }
  const anchorOf = (el) => {
    const a = el.getAttribute('data-gg-anchor')
    return a && a.length <= 40 && ANCHOR.test(a) ? a : null
  }
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
  const INJECTED = / data-gg-(?:id|selected|hover|mark|pick|editing|off)(?:="[^"]*")?/g
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
    // A page rule's element, like its mark in the 标注 mode: a box over it (settled solid with a light fill, pending
    // dashed orange), so its own outline, shadow and an image's pixels stay as they are.
    '[data-gg-mark="settled"],[data-gg-mark="pending"]{outline:none !important}' +
    '.gg-mark-box{position:absolute;z-index:2147483646;pointer-events:none}' +
    '.gg-mark-box[data-tone="settled"]{outline:2px solid #0088ff;outline-offset:-1px;background:rgba(0,136,255,.12)}' +
    '.gg-mark-box[data-tone="pending"]{outline:2px dashed #ff8d28;outline-offset:-1px;background:rgba(255,141,40,.12)}' +
    '[data-gg-hover]{outline:2px solid rgba(79,124,255,.6) !important;outline-offset:-2px;cursor:pointer}' +
    '[data-gg-selected]{outline:2px solid #4f7cff !important;outline-offset:-2px}' +
    '[data-gg-pick]{outline:2px solid rgba(79,124,255,.7) !important;outline-offset:1px;cursor:text;' +
    'background:rgba(79,124,255,.06)}' +
    '[data-gg-pick][data-gg-hover]{outline-color:#4f7cff !important;background:rgba(79,124,255,.14)}' +
    '[data-gg-editing]{outline:2px solid #4f7cff !important;outline-offset:2px;cursor:text;' +
    'background:rgba(79,124,255,.06);caret-color:#4f7cff}' +
    '#gg-mark-rect{position:absolute;z-index:2147483647;pointer-events:none;' +
    'outline:2px dashed #4f7cff;outline-offset:-2px;background:rgba(79,124,255,.08)}'
  document.head.appendChild(style)

  // Pinned to the viewport: the element or a box holding it is fixed (or sticky, where it sticks).
  const pinnedBy = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const p = getComputedStyle(n).position
      if (p === 'fixed' || p === 'sticky') return p
    }
    return null
  }
  // The element's rect in the viewport as far as the boxes clipping it let it show; null when none of it does.
  const CLIPS = /auto|scroll|hidden|clip/
  const viewRect = (el) => {
    let r = rectOf(el)
    let clipped = false
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (!CLIPS.test(cs.overflowX + cs.overflowY)) continue
      const c = rectOf(p)
      const x = Math.max(r.x, c.x)
      const y = Math.max(r.y, c.y)
      r = { x, y, w: Math.min(r.x + r.w, c.x + c.w) - x, h: Math.min(r.y + r.h, c.y + c.h) - y }
      clipped = true
    }
    return clipped && (r.w <= 0 || r.h <= 0) ? null : r
  }
  // The toned highlight's boxes: over each element where it shows.
  let markTone = ''
  let markWidth = 2
  let markBoxes = []
  const drawMarkBoxes = () => {
    for (const b of markBoxes) b.remove()
    markBoxes = []
    if (!markTone) return
    for (const el of marked) {
      // Not displayed: nothing to outline. Under a pinned layer (a fixed head): only what shows of it.
      let r = shown(el) ? viewRect(el) : null
      if (r && !pinnedBy(el)) r = uncovered(r)
      if (!r || r.w <= 0 || r.h <= 0) continue
      // Fixed in viewport coordinates, drawn again every frame the page or a box in it scrolls; on the root, which a
      // positioned or transformed body would not move.
      const b = document.createElement('div')
      b.className = 'gg-mark-box'
      b.dataset.tone = markTone
      Object.assign(b.style, {
        position: 'fixed',
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.w}px`,
        height: `${r.h}px`,
        outlineWidth: `${markWidth}px`,
      })
      document.documentElement.appendChild(b)
      markBoxes.push(b)
    }
  }
  // Brings the element into view the least it takes (nothing when it shows already), in each box that scrolls it and
  // then in the page, by setting their scroll: scrollIntoView would also scroll the main site's boxes holding this
  // frame. One pinned to the viewport shows wherever the page is.
  const SCROLLS = /auto|scroll/
  const MARGIN = 8
  const nearest = (start, end, from, to) =>
    start >= from && end <= to
      ? 0
      : start < from || end - start > to - from
        ? start - from - MARGIN
        : end - to + MARGIN
  const statusBar = () =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gg-status-bar')) || 0
  const bringIntoView = (el, behavior) => {
    if (pinnedBy(el) === 'fixed') return
    const r = el.getBoundingClientRect()
    let x = r.left
    let y = r.top
    for (
      let p = el.parentElement;
      p && p !== document.body && p !== document.documentElement;
      p = p.parentElement
    ) {
      const cs = getComputedStyle(p)
      const sideways = SCROLLS.test(cs.overflowX) && p.scrollWidth > p.clientWidth
      const down = SCROLLS.test(cs.overflowY) && p.scrollHeight > p.clientHeight
      if (!sideways && !down) continue
      const c = p.getBoundingClientRect()
      const dx = sideways ? nearest(x, x + r.width, c.left, c.left + p.clientWidth) : 0
      const dy = down ? nearest(y, y + r.height, c.top, c.top + p.clientHeight) : 0
      if (!dx && !dy) continue
      p.scrollTo({ left: p.scrollLeft + dx, top: p.scrollTop + dy, behavior })
      x -= dx
      y -= dy
    }
    const dx = nearest(x, x + r.width, 0, window.innerWidth)
    const dy = nearest(y, y + r.height, statusBar(), window.innerHeight)
    if (dx || dy) window.scrollTo({ left: window.scrollX + dx, top: window.scrollY + dy, behavior })
  }
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
      anchor: anchorOf(el),
      when: el.closest('[data-gg-when]')?.getAttribute('data-gg-when').slice(0, 200) ?? null,
      snippet: el.outerHTML.replace(INJECTED, '').slice(0, 300),
    }
  }

  // In-place text editing (Stitch's Edit Text): `choices` are the outlined texts to pick from, `editing` the one being
  // edited — its element, or a span wrapped round its text run for the moment when it has icons beside the text.
  const LOCKED = new Set(['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'template'])
  const textTarget = (el) =>
    !!ggIdOf(el) &&
    !LOCKED.has(el.tagName.toLowerCase()) &&
    textEditable(el) &&
    (el.textContent || '').trim() !== ''
  const targetsIn = (root) => [...root.querySelectorAll('[data-gg-id]')].filter(textTarget).slice(0, 500)
  let choices = []
  let editing = null
  const textPost = (state, ggId = null, text = null) => post({ type: 'text-edit', state, ggId, text })
  const stopChoosing = () => {
    if (!choices.length) return false
    for (const el of choices) flag(el, 'data-gg-pick', false)
    choices = []
    return true
  }
  const choose = (els) => {
    stopChoosing()
    if (els.length === 0) return textPost('done')
    if (els.length === 1) return startEdit(els[0])
    setSelected(null)
    choices = els
    for (const el of els) flag(el, 'data-gg-pick', true)
    textPost('picking')
  }
  const startEdit = (el) => {
    stopChoosing()
    endEdit(true)
    setSelected(null)
    let host = el
    let wrap = null
    if (el.children.length) {
      const run = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim() !== '')
      wrap = document.createElement('span')
      run.replaceWith(wrap)
      wrap.appendChild(run)
      host = wrap
    }
    editing = { ggId: ggIdOf(el), host, wrap, before: host.textContent }
    host.setAttribute('contenteditable', 'plaintext-only')
    flag(host, 'data-gg-editing', true)
    const mine = editing
    host.addEventListener('blur', () => editing === mine && endEdit(true), { once: true })
    host.focus()
    const range = document.createRange()
    range.selectNodeContents(host)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    textPost('editing', editing.ggId)
  }
  // Enter or leaving keeps the text, Escape puts it back. The text stays shown while the main site saves it.
  const endEdit = (keep) => {
    if (!editing) return
    const { ggId, host, wrap, before } = editing
    editing = null
    const text = (host.textContent || '')
      .replace(/\s*\n\s*/g, ' ')
      .trim()
      .slice(0, 5000)
    if (keep) host.textContent = text
    else host.textContent = before
    host.removeAttribute('contenteditable')
    flag(host, 'data-gg-editing', false)
    if (wrap) wrap.replaceWith(...wrap.childNodes)
    window.getSelection()?.removeAllRanges()
    textPost('done', ggId, keep && text !== before.replace(/\s+/g, ' ').trim() ? text : null)
  }
  const editText = (el) => {
    if (textEditable(el) && !LOCKED.has(el.tagName.toLowerCase())) return startEdit(el)
    const inside = targetsIn(el)
    choose(inside.length === 1 ? inside : targetsIn(document.body))
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
      if (editing?.host.contains(el)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      const pick = choices.find((c) => c.contains(el))
      if (pick) {
        e.preventDefault()
        e.stopImmediatePropagation()
        startEdit(pick)
        return
      }
      // A click beside the outlined texts ends picking and selects as usual.
      if (stopChoosing()) textPost('done')
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
      if (!link) {
        // A state switch (data-gg-set) is the screen runtime's own.
        if (mode === 'preview' && !el.closest('input,textarea,select,label,[data-gg-set]'))
          post({ type: 'miss' })
        return
      }
      e.preventDefault()
      e.stopImmediatePropagation()
      const screen = link.getAttribute('data-gg-link')
      const transition = link.getAttribute('data-gg-transition')
      const set = stateSet(link.getAttribute('data-gg-set'))
      post(
        screen === null
          ? { type: 'back' }
          : {
              type: 'nav',
              screen,
              ...(TRANSITIONS.includes(transition) && { transition }),
              ...(set && { set }),
            },
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
      if (!picking()) return
      const el = target(e)
      setHover(choices.length ? (choices.find((c) => el && c.contains(el)) ?? null) : el)
    },
    true,
  )
  // Edit mode: a double click edits the text under the pointer at once, no menu.
  window.addEventListener(
    'dblclick',
    (e) => {
      if (mode !== 'edit' || editing) return
      for (let n = target(e); n && n !== document.body; n = n.parentElement)
        if (textTarget(n)) {
          e.preventDefault()
          startEdit(n)
          return
        }
    },
    true,
  )
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing) return
      if (editing && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        endEdit(e.key === 'Enter')
      } else if (e.key === 'Escape' && stopChoosing()) textPost('done')
    },
    true,
  )
  // Preview: the main site's shortcuts (标注 N, ←/→, Esc, R, H…) work with the focus in the screen.
  const SHORTCUT_KEYS = new Set(['Escape', 'ArrowLeft', 'ArrowRight'])
  // A box scrolling sideways around the focus takes ←/→ itself.
  const sidewaysBox = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (SCROLLS.test(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth) return true
    }
    return false
  }
  const KEYED = [
    'input',
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
    ...[
      'slider',
      'spinbutton',
      'listbox',
      'menu',
      'menubar',
      'tablist',
      'grid',
      'combobox',
      'textbox',
      'radiogroup',
      'tree',
    ].map((r) => `[role="${r}"]`),
  ].join(',')
  window.addEventListener('keydown', (e) => {
    if (mode !== 'preview' || e.isComposing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey)
      return
    if (e.key.length !== 1 && (!SHORTCUT_KEYS.has(e.key) || e.shiftKey)) return
    // Not from a control that takes keys itself.
    if (target(e)?.closest(KEYED)) return
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sidewaysBox(target(e))) return
    post({ type: 'key', key: e.key, repeat: e.repeat })
  })
  // Zoom gestures over a framed screen would zoom the whole main-site page: the main site zooms its own view instead.
  const zoom = (factor, x, y) => post({ type: 'zoom', factor, x, y })
  window.addEventListener(
    'wheel',
    (e) => {
      // A trackpad pinch is a wheel with ctrlKey.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    },
    { passive: false },
  )
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey && !e.ctrlKey) return
    const factor = e.key === '=' || e.key === '+' ? 1.25 : e.key === '-' ? 0.8 : 0
    if (!factor) return
    e.preventDefault()
    zoom(factor, window.innerWidth / 2, window.innerHeight / 2)
  })
  // Safari reports a pinch as gesture events, `scale` counted from the gesture's start.
  let pinch = 1
  window.addEventListener('gesturestart', (e) => {
    e.preventDefault()
    pinch = 1
  })
  window.addEventListener('gesturechange', (e) => {
    e.preventDefault()
    if (!(e.scale > 0)) return
    zoom(e.scale / pinch, e.clientX, e.clientY)
    pinch = e.scale
  })
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
        if (stopChoosing()) textPost('done')
        endEdit(true)
        if (mode !== 'mark') clearBox()
        if (!picking()) {
          setHover(null)
          setSelected(null)
        }
        return
      case 'highlight':
        for (const el of marked) flag(el, 'data-gg-mark', false)
        marked = (Array.isArray(m.ggIds) ? m.ggIds : []).map(byGgId).filter(Boolean)
        markTone = m.tone === 'settled' || m.tone === 'pending' ? m.tone : ''
        // The main site's zoom undone: the outline is 2px on its screen.
        markWidth = Number.isFinite(m.unscale) ? Math.min(Math.max(m.unscale, 1), 10) * 2 : 2
        for (const el of marked) el.setAttribute('data-gg-mark', markTone)
        drawMarkBoxes()
        return
      case 'select-clear':
        if (stopChoosing()) textPost('done')
        endEdit(true)
        setSelected(null)
        clearBox()
        return
      case 'edit-text': {
        const el = mode === 'edit' ? byGgId(m.ggId) : null
        if (el) editText(el)
        return
      }
      case 'scroll-to': {
        const el = byGgId(m.ggId)
        if (el) bringIntoView(el, m.behavior === 'instant' ? 'instant' : 'smooth')
        return
      }
      case 'scroll-position':
        if (Number.isFinite(m.x) && Number.isFinite(m.y))
          window.scrollTo({ left: m.x, top: m.y, behavior: 'instant' })
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
  // A hotspot inside scrolling or clipping boxes (a horizontal card row) shows only where they let it: its document rect
  // cut to each of them, null when nothing of it shows.
  const hotRect = (el) => {
    const r = viewRect(el)
    return r && { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.w, h: r.h }
  }
  const hots = (sel, entry) =>
    [...document.querySelectorAll(sel)].slice(0, 500).flatMap((el) => {
      // Not in the screen's current state (gg-kit's data-gg-when).
      if (el.closest('[data-gg-off]')) return []
      const rect = hotRect(el)
      return rect ? [{ ggId: ggIdOf(el), ...entry(el), rect }] : []
    })
  // Every anchored element, the ones not showing too (not displayed, or out of a scrolling box) marked `hidden`.
  const shown = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden') return false
    }
    return true
  }
  let sticky = false
  const anchors = () => {
    const out = liveAnchors()
    // A script shows these later (a dialog cloned from a template): there, hidden until it does.
    const seen = new Set(out.map((a) => a.anchor))
    for (const t of document.querySelectorAll('template'))
      for (const el of t.content.querySelectorAll('[data-gg-anchor]')) {
        const anchor = anchorOf(el)
        if (!anchor || seen.has(anchor) || out.length >= 500) continue
        seen.add(anchor)
        out.push({ anchor, ggId: ggIdOf(el), rect: { x: 0, y: 0, w: 0, h: 0 }, hidden: true })
      }
    return out
  }
  const liveAnchors = () =>
    [...document.querySelectorAll('[data-gg-anchor]')].slice(0, 500).flatMap((el) => {
      const anchor = anchorOf(el)
      if (!anchor) return []
      // Pinned to the viewport: where it shows there, whatever the page's scroll (sticky ones are reported again
      // as the page scrolls).
      const pin = pinnedBy(el)
      if (pin === 'sticky') sticky = true
      const view = shown(el) ? viewRect(el) : null
      const rect =
        view &&
        (pin ? view : { x: view.x + window.scrollX, y: view.y + window.scrollY, w: view.w, h: view.h })
      return [
        {
          anchor,
          ggId: ggIdOf(el),
          rect: rect ?? docRect(el),
          ...(!rect && { hidden: true }),
          ...(rect && pin && { fixed: true }),
        },
      ]
    })
  const layout = () => {
    const d = document.documentElement
    return {
      width: d.scrollWidth,
      height: d.scrollHeight,
      links: hots('[data-gg-link]', (el) => {
        const transition = el.getAttribute('data-gg-transition')
        return {
          screen: el.getAttribute('data-gg-link'),
          ...(TRANSITIONS.includes(transition) && { transition }),
        }
      }),
      back: hots('[data-gg-back]', () => ({})),
      anchors: anchors(),
      covers: covers(),
    }
  }
  // The layers pinned over the page (fixed, or sticky), outermost only, in viewport coordinates: what they cover of the
  // page does not show. A sticky one moves as the page scrolls: reported again then.
  // Which elements those are is looked up as the page loads or resizes; a scrolling frame only measures them again.
  let pinnedEls = null
  const findPinned = () => {
    pinnedEls = []
    for (const el of [...document.body.querySelectorAll('*')].slice(0, 3000)) {
      const p = getComputedStyle(el).position
      if (p !== 'fixed' && p !== 'sticky') continue
      if (el.parentElement && pinnedBy(el.parentElement)) continue
      if (p === 'sticky') sticky = true
      pinnedEls.push(el)
    }
  }
  // Not what does not show or lets the pointer through (a transparent, hidden or decorative layer).
  const covering = (el) => {
    const cs = getComputedStyle(el)
    return shown(el) && Number(cs.opacity) > 0 && cs.pointerEvents !== 'none'
  }
  // A rect less the pinned layers covering its top or bottom; null when they cover all of it.
  const uncovered = (r) => {
    let from = r.y
    let to = r.y + r.h
    for (const c of covers()) {
      if (c.x >= r.x + r.w || c.x + c.w <= r.x) continue
      if (c.y <= from && c.y + c.h > from) from = c.y + c.h
      if (c.y < to && c.y + c.h >= to) to = c.y
    }
    return to > from ? { ...r, y: from, h: to - from } : null
  }
  const covers = () => {
    if (!pinnedEls) findPinned()
    const out = []
    for (const el of pinnedEls) {
      if (!el.isConnected || !covering(el)) continue
      const r = rectOf(el)
      if (r.w > 0 && r.h > 0) out.push(r)
      if (out.length === 20) break
    }
    return out
  }
  // One post per animation frame, with the position at that frame: the main site moves its overlays with it.
  let scrollFrame = 0
  const postScroll = () => post({ type: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY })
  window.addEventListener(
    'scroll',
    () => {
      if (scrollFrame) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        postScroll()
        if (sticky) report()
        drawMarkBoxes()
      })
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
  post({ type: 'ready', ...first, scrollX: window.scrollX, scrollY: window.scrollY })
  window.addEventListener('load', report)
  if (window.ResizeObserver)
    new ResizeObserver(() => {
      pinnedEls = null
      report()
      drawMarkBoxes()
    }).observe(document.documentElement)
  // What scripts add or show (a dialog opening, a tab switching) moves anchors and links without resizing the page.
  let domFrame = 0
  new MutationObserver(() => {
    if (domFrame) return
    domFrame = requestAnimationFrame(() => {
      domFrame = 0
      pinnedEls = null
      report()
    })
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'hidden', 'class', 'style', 'data-gg-off'],
  })
  // A box scrolling inside the page (the document's own scroll is `scroll` above) moves the hotspots in it.
  // Every frame it scrolls: the outline, and the layout (its anchors and links move with it).
  let boxFrame = 0
  document.addEventListener(
    'scroll',
    (e) => {
      if (!(e.target instanceof Element) || boxFrame) return
      boxFrame = requestAnimationFrame(() => {
        boxFrame = 0
        report()
        drawMarkBoxes()
      })
    },
    { capture: true, passive: true },
  )
})()
