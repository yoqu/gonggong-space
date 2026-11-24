import { useLayoutEffect, useRef } from 'react'
import { motionTiming } from '../lib/motion'
import { reducedMotion } from '../ui/presence'

/** While `held` (the pointer is over the list) rows keep their places so a click lands where it aimed; newcomers go last. */
export function useHeldOrder<R extends { id: string }>(list: R[], held: boolean) {
  const shown = useRef<string[]>([])
  if (!held) {
    shown.current = list.map((g) => g.id)
    return list
  }
  const at = new Map(shown.current.map((id, i) => [id, i]))
  const place = (r: R) => at.get(r.id) ?? at.size
  return [...list].sort((a, b) => place(a) - place(b))
}

const ROW = '.pn-conv[data-id]'
const GLIDE = 'reorder-glide'
/** Each conversation row's top within `root`, so scrolling between two reads doesn't count as moving. */
const rowTops = (root: HTMLElement): Map<string | undefined, number> => {
  const top = root.getBoundingClientRect().top
  return new Map(
    [...root.querySelectorAll<HTMLElement>(ROW)].map((el) => [
      el.dataset.id,
      el.getBoundingClientRect().top - top,
    ]),
  )
}

/**
 * Rows a new message re-sorted glide from where they were (FLIP): their places are read while the old order is still
 * on screen, then each one whose old or new place is in view slides over with the smooth spring. Reduced motion: none.
 */
export function useReorderGlide(order: string) {
  const list = useRef<HTMLElement>(null)
  const seen = useRef(order)
  const before = useRef<Map<string | undefined, number> | null>(null)
  if (seen.current !== order) {
    seen.current = order
    before.current = list.current ? rowTops(list.current) : null
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per new order, after it commits
  useLayoutEffect(() => {
    const was = before.current
    before.current = null
    const root = list.current
    if (!was || !root || reducedMotion()) return
    const timing = motionTiming('--spring-smooth')
    if (!timing) return
    const rows = [...root.querySelectorAll<HTMLElement>(ROW)]
    // The old places were read mid-glide (where rows showed); the new ones must be read without it, then glide on.
    for (const el of rows) for (const a of el.getAnimations?.() ?? []) if (a.id === GLIDE) a.cancel()
    const view = root.closest('.sidebar__scroll')?.getBoundingClientRect()
    const top = root.getBoundingClientRect().top
    for (const el of rows) {
      const from = was.get(el.dataset.id)
      const r = el.getBoundingClientRect()
      const dy = from === undefined ? 0 : from - (r.top - top)
      if (!dy || !el.animate) continue
      const shown = (y: number) => !view || (y + r.height > view.top && y < view.bottom)
      if (shown(r.top) || shown(r.top + dy))
        el.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { ...timing, id: GLIDE })
    }
  }, [order])
  return list
}
