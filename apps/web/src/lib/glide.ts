import { reducedMotion } from '../ui/presence'

/** Longest a glide is taken to last; afterwards the view is judged where it stands. */
const GLIDE_MS = 800
const NAV_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '])

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * Scrolls `el` to its end: glides the last two screens, a longer way jumps to two screens away first so it never
 * drags; reduced motion jumps. True while it glides; `onStop` runs once it is over (at once for a jump), or as soon as
 * the user scrolls on their own (wheel, touch, paging keys), so their gesture is never swallowed.
 */
export function glideToEnd(el: HTMLElement, onStop: () => void) {
  const end = el.scrollHeight - el.clientHeight
  if (reducedMotion() || !el.scrollTo) {
    el.scrollTop = el.scrollHeight
    onStop()
    return false
  }
  if (end - el.scrollTop > el.clientHeight * 2) el.scrollTop = end - el.clientHeight * 2
  el.scrollTo({ top: end, behavior: 'smooth' })
  const win = el.ownerDocument.defaultView ?? window
  const key = (e: KeyboardEvent) => NAV_KEYS.has(e.key) && !editable(e.target) && interrupt()
  const timer = setTimeout(() => stop(), GLIDE_MS)
  // Pinning where it stands cancels the browser's smooth scroll, so the user's own gesture moves from there.
  function interrupt() {
    el.scrollTo({ top: el.scrollTop, behavior: 'instant' })
    stop()
  }
  function stop() {
    clearTimeout(timer)
    el.removeEventListener('wheel', interrupt)
    el.removeEventListener('touchstart', interrupt)
    win.removeEventListener('keydown', key)
    onStop()
  }
  el.addEventListener('wheel', interrupt, { passive: true })
  el.addEventListener('touchstart', interrupt, { passive: true })
  win.addEventListener('keydown', key)
  return true
}
