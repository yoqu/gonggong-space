import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react'
import { motionTiming } from '../../lib/motion'

/** A layout change this soon after the stage resized is the window's: the device follows at once, no glide (ms). */
const GLIDE_MS = 700
/** A stage resize within this long of a glide's start is the panel change that glide animates (ms). */
const GLIDE_SETTLE_MS = 100

/**
 * A panel, the list, the mode or the device changing (`layoutKey`) moves the device: it glides from where it showed
 * (FLIP on transform, the layout itself changes at once). Measured every commit, so a later change starts from the
 * place it last had. Call the returned `stageResized` from the stage's ResizeObserver (not on its first run):
 * the window resizing follows at once, and a glide under way stops where the layout is.
 */
export function useDeviceGlide(deviceBox: RefObject<HTMLElement | null>, layoutKey: string) {
  const resized = useRef(0)
  const glidedAt = useRef(-Infinity)
  const lastBox = useRef<{ key: string; x: number; y: number; w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = deviceBox.current
    if (!el) return
    const box = { key: layoutKey, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
    const prev = lastBox.current
    lastBox.current = box
    if (!prev || prev.key === layoutKey || !box.w || !box.h || typeof el.animate !== 'function') return
    if (performance.now() - resized.current < GLIDE_MS) return
    const timing = motionTiming('--spring-smooth')
    if (!timing) return
    // Starts from what shows now, a glide still under way included.
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    const sx = (prev.w * m.a) / box.w
    const sy = (prev.h * m.d) / box.h
    for (const a of el.getAnimations()) a.cancel()
    glidedAt.current = performance.now()
    // Another device's shape would stretch on the way: it fades in where it lands instead.
    if (Math.abs(sx / sy - 1) > 0.02) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], motionTiming('--fade-in') ?? timing)
      return
    }
    const from = `translate(${prev.x + m.e - box.x}px, ${prev.y + m.f - box.y}px) scale(${sx})`
    el.animate([{ transform: from }, { transform: 'none' }], timing)
  })
  return useCallback(() => {
    resized.current = performance.now()
    if (resized.current - glidedAt.current > GLIDE_SETTLE_MS)
      for (const a of deviceBox.current?.getAnimations?.() ?? []) a.cancel()
  }, [deviceBox])
}
