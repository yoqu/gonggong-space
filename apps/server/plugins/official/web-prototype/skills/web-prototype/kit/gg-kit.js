// gg-kit: platform-owned screen runtime. Do not edit in an artifact.
// [data-gg-link="<screen id>"] goes to that screen, [data-gg-back] goes back. Inside the shell the shell navigates;
// opened on its own, a screen links to its sibling file.
;(() => {
  const inShell = window.parent !== window
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('[data-gg-link],[data-gg-back]') : null
      if (!el) return
      e.preventDefault()
      const screen = el.getAttribute('data-gg-link')
      if (inShell) window.parent.postMessage({ type: 'gg:nav', screen }, location.origin)
      else if (screen) location.href = `./${encodeURIComponent(screen)}.html`
      else history.back()
    },
    true,
  )
})()
