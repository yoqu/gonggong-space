import { type View, zoomAt } from './geometry'

/** Log-scale zoom per wheel pixel: 1/300 felt sluggish; 0.01 made a mouse notch (|deltaY| ≈ 100) a 2.7× jump. */
const WHEEL_ZOOM_DIVISOR = 150
/** One wheel event zooms by at most this much in log scale: about 7% per mouse notch. */
const WHEEL_ZOOM_MAX = 0.2 / 3
/** Safari's pinch scale followed 1:1 felt as slow as the old wheel rate; zoom twice as far in log scale. */
const PINCH_SPEED = 2
const LINE_PX = 16

/** The zoom factor for a ⌘/Ctrl wheel or trackpad pinch: smooth for small pinch deltas, capped for mouse notches. */
export function wheelZoomFactor(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>) {
  const dy = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY
  return Math.exp(Math.max(-WHEEL_ZOOM_MAX, Math.min(WHEEL_ZOOM_MAX, -dy / WHEEL_ZOOM_DIVISOR)))
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
    zoom((g.scale / last) ** PINCH_SPEED, g.clientX, g.clientY)
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

type Point = { x: number; y: number }

/** Two fingers moved from `from` to `to` (plane pixels): the view pans with their midpoint and zooms about it. */
export function pinchView(view: View, from: [Point, Point], to: [Point, Point]): View {
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y)
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y)
  if (!d0 || !d1) return view
  const mx0 = (from[0].x + from[1].x) / 2
  const my0 = (from[0].y + from[1].y) / 2
  const mx1 = (to[0].x + to[1].x) / 2
  const my1 = (to[0].y + to[1].y) / 2
  const panned = { ...view, x: view.x + mx1 - mx0, y: view.y + my1 - my0 }
  return zoomAt(panned, view.z * (d1 / d0), mx1, my1)
}
