import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { useEscape, useOutsidePress } from './overlay'
import { usePresence } from './presence'
import './popover.css'

export interface PopoverProps {
  /** Toggles the panel on click; an element gets `aria-haspopup` / `aria-expanded`. */
  trigger: ReactNode
  children?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start'
  width?: number | string
  /** Small pointer toward the trigger. */
  arrow?: boolean
  className?: string
  'aria-label'?: string
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

/**
 * Pane Popover: glass panel anchored beside its trigger for light content (profile card, filters, pickers).
 * Opening moves focus into it; Escape closes and refocuses the trigger; an outside press closes it.
 */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom-start',
  width,
  arrow,
  className,
  'aria-label': label,
}: PopoverProps) {
  const [shown, setShown] = useControlled(open, defaultOpen)
  const root = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const opened = useRef(defaultOpen)
  const id = useId()
  const presence = usePresence(shown)
  const set = (next: boolean) => {
    setShown(next)
    onOpenChange?.(next)
  }
  const triggerEl = () => root.current?.querySelector<HTMLElement>('.ui-popover__trigger > *')
  useEscape(() => {
    set(false)
    triggerEl()?.focus()
  }, shown)
  useOutsidePress([root], () => set(false), shown)

  // Only a user-opened panel takes focus; a demo shown on mount leaves it where it is.
  useEffect(() => {
    if (shown === opened.current) return
    opened.current = shown
    const el = panel.current
    if (shown && el) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus()
  }, [shown])

  return (
    <span ref={root} className={cx('ui-popover-anchor', className)}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the trigger is itself a button */}
      <span className="ui-popover__trigger" onClick={() => set(!shown)}>
        {isValidElement(trigger)
          ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
              'aria-haspopup': 'dialog',
              'aria-expanded': shown,
              'aria-controls': shown ? id : undefined,
            })
          : trigger}
      </span>
      {presence.mounted ? (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cx('ui-popover', `ui-popover--${placement}`, arrow && 'ui-popover--arrow')}
          style={{ width }}
          data-state={presence.state}
          onAnimationEnd={presence.onAnimationEnd}
        >
          {children}
        </div>
      ) : null}
    </span>
  )
}
