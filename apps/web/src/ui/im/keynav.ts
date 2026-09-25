import type { KeyboardEvent } from 'react'

/** Roving focus among `selector` items: ↑↓ (a `cols` grid adds ←→), Home/End; `select` also clicks the new item. */
export function keyNav(
  e: KeyboardEvent,
  root: HTMLElement | null,
  selector: string,
  opts: { cols?: number; select?: boolean } = {},
) {
  const step = opts.cols ?? 1
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', ...(opts.cols ? ['ArrowLeft', 'ArrowRight'] : [])]
  if (!root || !keys.includes(e.key)) return
  const els = [...root.querySelectorAll<HTMLButtonElement>(selector)].filter((x) => !x.disabled)
  const i = els.indexOf(document.activeElement as HTMLButtonElement)
  const n =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? els.length - 1
        : e.key === 'ArrowDown'
          ? i + step
          : e.key === 'ArrowUp'
            ? i - step
            : e.key === 'ArrowRight'
              ? i + 1
              : i - 1
  const next = els[Math.max(0, Math.min(els.length - 1, n))]
  if (!next) return
  e.preventDefault()
  next.focus()
  if (opts.select) next.click()
}
