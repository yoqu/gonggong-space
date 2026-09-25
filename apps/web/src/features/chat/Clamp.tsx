import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

const MAX = 360
// Only clamp when there is clearly more to hide than the toggle costs.
const SLACK = 80

/** Long bot output (logs, JSON, big diffs in prose) is folded to a readable height with 展开全文. */
export function Clamp({ children }: { children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const measure = () => setOver(el.scrollHeight > MAX + SLACK)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="clamp" data-clamped={(over && !open) || undefined}>
      <div ref={body} className="clamp__body">
        {children}
      </div>
      {over ? (
        <button type="button" className="clamp__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '收起' : '展开全文'}
        </button>
      ) : null}
    </div>
  )
}
