/**
 * Safari reports a trackpad pinch as gesture events (`scale` counted from the gesture's start), not as a wheel with
 * ctrlKey: they zoom the canvas by the step since the last one, never the page. Returns the cleanup.
 */
export function onPinch(el: HTMLElement, zoom: (factor: number, clientX: number, clientY: number) => void) {
  let last = 1
  const gesture = (e: Event) => {
    e.preventDefault()
    const g = e as Event & { scale: number; clientX: number; clientY: number }
    if (e.type === 'gesturestart' || !(g.scale > 0)) {
      last = 1
      return
    }
    zoom(g.scale / last, g.clientX, g.clientY)
    last = g.scale
  }
  el.addEventListener('gesturestart', gesture)
  el.addEventListener('gesturechange', gesture)
  return () => {
    el.removeEventListener('gesturestart', gesture)
    el.removeEventListener('gesturechange', gesture)
  }
}

/** Where (`x`, `y`) in a scaled screen frame's viewport is in the window; null while the frame has no layout. */
export function framePoint(frame: HTMLIFrameElement, x: number, y: number) {
  if (!frame.offsetWidth) return null
  const r = frame.getBoundingClientRect()
  const k = r.width / frame.offsetWidth
  return { x: r.left + x * k, y: r.top + y * k }
}
