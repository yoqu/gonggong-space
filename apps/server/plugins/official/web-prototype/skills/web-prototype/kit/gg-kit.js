// gg-kit: platform-owned screen runtime. Do not edit in an artifact.
// [data-gg-link="<screen id>"] goes to that screen (with its data-gg-transition), [data-gg-back] goes back. Inside the
// shell the shell navigates and animates; opened on its own, a screen links to its sibling file.
;(() => {
  const inShell = window.parent !== window
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('[data-gg-link],[data-gg-back]') : null
      if (!el) return
      e.preventDefault()
      const screen = el.getAttribute('data-gg-link')
      const transition = el.getAttribute('data-gg-transition')
      // From disk (file://) every file is its own opaque origin: no origin to name.
      const origin = location.protocol === 'file:' ? '*' : location.origin
      if (inShell) window.parent.postMessage({ type: 'gg:nav', screen, transition }, origin)
      else if (screen) location.href = `./${encodeURIComponent(screen)}.html`
      else history.back()
    },
    true,
  )
})()
