import {
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useEscape } from '../../ui'

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const isCoarsePointer = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

/**
 * Hover/focus card state: opens `openDelay` ms after the pointer (or focus) arrives and closes `closeDelay` ms after
 * it leaves both trigger and card, so the pointer can travel between them; Escape closes at once and returns focus
 * to the trigger. On touch devices (`pointer: coarse`), tapping toggles the card instead of relying on focus (iOS
 * Safari does not focus buttons on tap).
 */
export function useHoverCard({ openDelay = 300, closeDelay = 200 } = {}) {
  const [open, setOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const skipFocus = useRef(false)
  const h = useMemo(() => {
    const cancel = () => clearTimeout(timer.current)
    const later = (next: boolean, ms: number) => {
      cancel()
      timer.current = setTimeout(() => setOpen(next), ms)
    }
    const show = () => later(true, openDelay)
    const hide = () => later(false, closeDelay)
    const close = () => {
      cancel()
      setOpen(false)
    }
    const contains = (node: Node | null) =>
      !!node && (!!anchorRef.current?.contains(node) || !!panelRef.current?.contains(node))
    const onBlur = (e: FocusEvent) => {
      if (!contains(e.relatedTarget as Node | null)) hide()
    }
    return {
      cancel,
      close,
      onEscape: () => {
        close()
        const el = anchorRef.current
        if (!el || document.activeElement === el) return
        skipFocus.current = true
        el.focus()
        skipFocus.current = false
      },
      triggerProps: {
        onMouseEnter: () => {
          if (!isCoarsePointer()) show()
        },
        onMouseLeave: () => {
          if (!isCoarsePointer()) hide()
        },
        onFocus: () => {
          if (skipFocus.current) return
          if (!isCoarsePointer()) show()
        },
        onBlur,
        onKeyDown: (e: ReactKeyboardEvent) => {
          if (e.key !== 'Tab' || e.shiftKey || !openRef.current) return
          const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
          if (!first) return
          e.preventDefault()
          first.focus()
        },
        onClick: () => {
          if (isCoarsePointer()) {
            cancel()
            setOpen((v) => !v)
          }
        },
      },
      cardProps: {
        onMouseEnter: cancel,
        onMouseLeave: hide,
        onFocus: cancel,
        onBlur,
        onKeyDown: (e: ReactKeyboardEvent) => {
          if (e.key !== 'Tab' || !e.shiftKey) return
          const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
          if (document.activeElement !== first && document.activeElement !== panelRef.current) return
          e.preventDefault()
          anchorRef.current?.focus()
        },
      },
    }
  }, [openDelay, closeDelay])
  useEffect(() => h.cancel, [h])
  useEscape(h.onEscape, open)
  return {
    open,
    close: h.close,
    anchorRef,
    panelRef,
    triggerProps: h.triggerProps,
    cardProps: h.cardProps,
  }
}
