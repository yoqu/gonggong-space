// gg-kit: platform-owned screen runtime. Do not edit in an artifact.
// [data-gg-link="<screen id>"] goes to that screen (with its data-gg-transition), [data-gg-back] goes back. Inside the
// shell the shell navigates and animates; opened on its own, a screen links to its sibling file.
// States (SKILL.md「Screen states」): the page's query names them (?order=paid&role=guest), a dim it leaves out takes
// its first value from ../gg-artifact.json. [data-gg-when="order=unpaid|paid role=member"] shows only then (space: and,
// |: or); [data-gg-set="order=paid"] switches state, or with data-gg-link sets it on the screen it goes to.
;(() => {
  const inShell = window.parent !== window
  // From disk (file://) every file is its own opaque origin: no origin to name.
  const origin = location.protocol === 'file:' ? '*' : location.origin
  const PAIR = /^([a-z0-9]+(?:-[a-z0-9]+)*)=([a-z0-9]+(?:-[a-z0-9]+)*(?:\|[a-z0-9]+(?:-[a-z0-9]+)*)*)$/
  const parse = (text) => {
    const parts = (text || '').trim().split(/\s+/).filter(Boolean)
    const out = parts.map((p) => PAIR.exec(p)).map((m) => m && [m[1], m[2].split('|')])
    return out.length && out.every(Boolean) ? out : null
  }
  const state = Object.fromEntries(new URLSearchParams(location.search))
  let defaults = null
  // Read once, only when a condition names a dim the query does not (a screenshot, a screen opened on its own).
  const fallback = (dim) => {
    if (!defaults) {
      defaults = {}
      // From disk there is no manifest to read: the shell passes the whole state.
      if (/^https?:$/.test(location.protocol)) try {
        const x = new XMLHttpRequest()
        x.open('GET', '../gg-artifact.json', false)
        x.send()
        const m = JSON.parse(x.responseText)
        const id = decodeURIComponent(location.pathname.split('/').pop() || '').replace(/\.html$/, '')
        const s = m.screens.find((x) => x.id === id)
        const dims = [...(m.dims || []).filter((d) => s?.uses?.includes(d.id)), ...(s?.dims || [])]
        for (const d of dims) defaults[d.id] = d.values[0]?.id
      } catch {}
    }
    return defaults[dim]
  }
  // An attribute of its own rather than `hidden`: never mistaken for the page's, and the bridge strips it.
  const style = document.createElement('style')
  style.textContent = '[data-gg-off]{display:none !important}'
  document.head.append(style)
  // A malformed condition shows its element (the platform's lint names it).
  const apply = () => {
    for (const el of document.querySelectorAll('[data-gg-when]')) {
      const when = parse(el.getAttribute('data-gg-when'))
      const on = !when || when.every(([dim, values]) => values.includes(dim in state ? state[dim] : fallback(dim)))
      el.toggleAttribute('data-gg-off', !on)
    }
  }
  apply()
  const setOf = (el) => Object.fromEntries((parse(el.getAttribute('data-gg-set')) || []).map(([k, v]) => [k, v[0]]))

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('[data-gg-link],[data-gg-back],[data-gg-set]') : null
      if (!el) return
      e.preventDefault()
      const set = setOf(el)
      if (!el.hasAttribute('data-gg-link') && !el.hasAttribute('data-gg-back')) {
        Object.assign(state, set)
        apply()
        history.replaceState(null, '', `?${new URLSearchParams(state)}${location.hash}`)
        if (inShell) window.parent.postMessage({ type: 'gg:state', state: set }, origin)
        return
      }
      const screen = el.getAttribute('data-gg-link')
      const transition = el.getAttribute('data-gg-transition')
      if (inShell) window.parent.postMessage({ type: 'gg:nav', screen, transition, set }, origin)
      else if (screen) location.href = `./${encodeURIComponent(screen)}.html?${new URLSearchParams({ ...state, ...set })}`
      else history.back()
    },
    true,
  )
})()
