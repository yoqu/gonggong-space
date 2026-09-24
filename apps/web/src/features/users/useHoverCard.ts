import { useEffect, useMemo, useRef, useState } from 'react'
import { useEscape } from '../../ui'

/**
 * Hover/focus card state: opens `openDelay` ms after the pointer (or focus) arrives and closes `closeDelay` ms after
 * it leaves both trigger and card, so the pointer can travel between them; Escape closes at once.
 */
export function useHoverCard({ openDelay = 300, closeDelay = 200 } = {}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const h = useMemo(() => {
    const cancel = () => clearTimeout(timer.current)
    const later = (next: boolean, ms: number) => {
      cancel()
      timer.current = setTimeout(() => setOpen(next), ms)
    }
    const show = () => later(true, openDelay)
    const hide = () => later(false, closeDelay)
    return {
      cancel,
      close: () => {
        cancel()
        setOpen(false)
      },
      triggerProps: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide },
      cardProps: { onMouseEnter: cancel, onMouseLeave: hide },
    }
  }, [openDelay, closeDelay])
  useEffect(() => h.cancel, [h])
  useEscape(h.close, open)
  return { open, close: h.close, triggerProps: h.triggerProps, cardProps: h.cardProps }
}
