import { type RefObject, useLayoutEffect } from 'react'

/**
 * Keeps a scroller pinned to its end while it shrinks (a task bar or a banner appearing under it, the composer
 * growing): its scrollTop stays put otherwise, and the last lines slip under what came in below.
 */
export function useStickOnResize(box: RefObject<HTMLElement | null>, stick: RefObject<boolean>) {
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [box, stick])
}
