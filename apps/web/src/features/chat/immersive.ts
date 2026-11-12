import { type RefObject, useCallback, useEffect, useState } from 'react'

const SWIPE_PX = 24
const BOTTOM_PX = 48

const typing = () => {
  const el = document.activeElement
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    !!(el as HTMLElement)?.isContentEditable
  )
}

/**
 * Phone reading mode: a finger moving the list hides what sits around the composer, so the messages get the screen.
 * Touch only, so streaming's own scrolling never triggers it; back once the finger leaves the list at its bottom.
 */
export function useImmersive(box: RefObject<HTMLElement | null>, enabled: boolean): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const exit = useCallback(() => setOn(false), [])

  useEffect(() => {
    const el = box.current
    if (!enabled || !el) return setOn(false)
    let startY: number | null = null
    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_PX
    const start = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? null
    }
    const move = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (startY === null || y === undefined || Math.abs(y - startY) < SWIPE_PX) return
      if (el.scrollHeight > el.clientHeight && !typing()) setOn(true)
    }
    const end = () => {
      startY = null
      if (atBottom()) setOn(false)
    }
    // Momentum carries the list on after the finger is up.
    const scroll = () => {
      if (startY === null && atBottom()) setOn(false)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    el.addEventListener('scroll', scroll, { passive: true })
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      el.removeEventListener('scroll', scroll)
    }
  }, [box, enabled])

  return [on, exit]
}
