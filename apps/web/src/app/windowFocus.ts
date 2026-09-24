/** Mirrors window focus to `<html data-window-inactive>` so the shell dims like an inactive macOS window. */
export function trackWindowFocus() {
  const root = document.documentElement
  const onFocus = () => delete root.dataset.windowInactive
  const onBlur = () => {
    root.dataset.windowInactive = ''
  }
  if (!document.hasFocus()) onBlur()
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    onFocus()
  }
}
