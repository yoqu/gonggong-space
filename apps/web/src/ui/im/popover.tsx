import { cloneElement, type ReactElement, type ReactNode, useEffect, useRef } from 'react'
import { cx } from '../../lib/cx'
import { useControlled } from '../controlled'
import './popover.css'

export type ImPopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start'

type TriggerProps = { onClick?: () => void; 'aria-expanded'?: boolean; 'aria-haspopup'?: 'dialog' }

/**
 * Anchored glass panel (Pane Popover) for the IM pickers and cards: outside click or Esc closes it and focus
 * returns to the trigger. Kept minimal until the shared ui popover lands.
 */
export function ImPopover({
  trigger,
  children,
  placement = 'bottom-start',
  open,
  defaultOpen = false,
  onOpenChange,
  width,
  className,
  'aria-label': label,
}: {
  trigger: ReactElement<TriggerProps>
  /** A function receives `close` for pickers that close on select. */
  children: ReactNode | ((close: () => void) => ReactNode)
  placement?: ImPopoverPlacement
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  width?: number
  className?: string
  'aria-label'?: string
}) {
  const [shown, setShown] = useControlled(open, defaultOpen)
  const ref = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const byUser = useRef(false)
  const set = (v: boolean) => {
    byUser.current = v
    setShown(v)
    onOpenChange?.(v)
  }
  const close = () => {
    set(false)
    ref.current?.querySelector<HTMLElement>('.pn-popover-trigger > *')?.focus()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!shown) return
    if (byUser.current) panel.current?.querySelector<HTMLElement>('input, button, [tabindex="0"]')?.focus()
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [shown])

  return (
    <span ref={ref} className={cx('pn-popover-anchor', className)}>
      <span className="pn-popover-trigger">
        {cloneElement(trigger, {
          'aria-expanded': shown,
          'aria-haspopup': 'dialog',
          onClick: () => set(!shown),
        })}
      </span>
      {shown ? (
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          className={`pn-popover pn-popover--${placement}`}
          style={width ? { width } : undefined}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </span>
  )
}
