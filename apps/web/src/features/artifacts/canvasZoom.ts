/** One wheel event zooms by at most this much in log scale: a mouse notch (|deltaY| ≈ 100) was a 2.7× jump. */
const WHEEL_ZOOM_MAX = 0.1
const LINE_PX = 16

/** The zoom factor for a ⌘/Ctrl wheel or trackpad pinch: smooth for small pinch deltas, capped for mouse notches. */
export function wheelZoomFactor(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>) {
  const dy = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY
  return Math.exp(Math.max(-WHEEL_ZOOM_MAX, Math.min(WHEEL_ZOOM_MAX, -dy * 0.01)))
}

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
