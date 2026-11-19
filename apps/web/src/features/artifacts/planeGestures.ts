import {
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from 'react'
import { onPinch, pinchView, wheelZoomFactor } from './canvasZoom'
import { type View, zoomAt } from './geometry'

/**
 * Wheel, trackpad and touch gestures on the canvas plane: they pan and zoom the view (and mark it as moved by the
 * member). Returns the capture-phase pointer handlers that turn two fingers into a pinch; `onPinchStart` lets go of
 * whatever the first finger had started.
 */
export function usePlaneGestures(
  plane: RefObject<HTMLDivElement | null>,
  setView: Dispatch<SetStateAction<View>>,
  auto: RefObject<boolean>,
  onPinchStart: () => void,
) {
  /** Touch pointers down on the plane, in plane pixels: two of them pinch. */
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const move = (next: SetStateAction<View>) => {
    auto.current = false
    setView(next)
  }

  // React's wheel listener is passive; zooming must keep the page from scrolling or zooming itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the plane, the setter and the ref never change
  useEffect(() => {
    const el = plane.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      auto.current = false
      // ctrlKey is also how trackpads report a pinch.
      if (e.ctrlKey || e.metaKey)
        setView((v) => zoomAt(v, v.z * wheelZoomFactor(e), e.clientX - box.left, e.clientY - box.top))
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    const pinch = onPinch(el, (f, cx, cy) => {
      // iOS reports a two-finger touch as gesture events too; the touch pointers already zoom.
      if (touches.current.size) return
      const box = el.getBoundingClientRect()
      auto.current = false
      setView((v) => zoomAt(v, v.z * f, cx - box.left, cy - box.top))
    })
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', wheel)
      pinch()
    }
  }, [])

  const local = (e: { clientX: number; clientY: number }) => {
    const box = plane.current?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId)
  }
  // Seen in the capture phase so a node the first finger is dragging lets go.
  return {
    onPointerDownCapture: (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'touch') return
      touches.current.set(e.pointerId, local(e))
      if (touches.current.size < 2) return
      e.stopPropagation()
      onPinchStart()
    },
    onPointerMoveCapture: (e: PointerEvent<HTMLDivElement>) => {
      const t = touches.current
      if (!t.has(e.pointerId)) return
      const [a, b] = [...t.values()]
      t.set(e.pointerId, local(e))
      if (!a || !b) return
      e.stopPropagation()
      const [c, d] = [...t.values()]
      if (c && d) move((v) => pinchView(v, [a, b], [c, d]))
    },
    onPointerUpCapture: up,
    onPointerCancelCapture: up,
  }
}
