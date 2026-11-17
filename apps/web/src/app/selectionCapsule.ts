import { useLayoutEffect, useRef } from 'react'

/**
 * Positions the selection capsule under the current conversation so it slides between rows.
 * `at` is the current row's place in the list: rows reordering around it move it without resizing anything.
 */
export function useSelectionCapsule(pathname: string, at: number) {
  const scroll = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the route or the current row's place changes
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el) return
    const measure = () => {
      const item = el.querySelector<HTMLElement>('.pn-conv[aria-current="page"]')
      // On-screen offset, not offsetTop: rows sit in wrappers (the context menu) that would become their offsetParent.
      const box = item?.getBoundingClientRect()
      const y = box ? box.top - el.getBoundingClientRect().top + el.scrollTop : 0
      el.style.setProperty('--capsule-y', `${y}px`)
      el.style.setProperty('--capsule-h', `${box?.height ?? 0}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // The content box resizes whenever rows above the current one appear or go (setup guide, filter, 已完成 fold).
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    // An unfolded section's rows ease in from above; measured mid-way, the capsule would stay offset.
    el.addEventListener('animationend', measure)
    return () => {
      ro.disconnect()
      el.removeEventListener('animationend', measure)
    }
  }, [pathname, at])
  return scroll
}
