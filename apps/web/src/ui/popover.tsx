import {
  cloneElement,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { useEscape } from './overlay'
import { usePresence } from './presence'
import './popover.css'

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start'

/** While `open`: Escape calls `onClose(true)` (refocus the trigger), a press outside `root` calls `onClose(false)`. */
export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  onClose: (refocus: boolean) => void,
) {
  const close = useRef(onClose)
  close.current = onClose
  useEscape(() => close.current(true), open)
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close.current(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open, root])
}

export interface FloatProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean
  placement?: Placement
  /** `menu`: 4px from the trigger, menu padding. `popover`: 8px, 12px padding, window radius. */
  kind?: 'menu' | 'popover'
  ref?: Ref<HTMLDivElement>
}

/** Glass panel positioned against its nearest positioned ancestor; scales in, fades out. */
export function Float({
  open,
  placement = 'bottom-start',
  kind = 'popover',
  className,
  ...rest
}: FloatProps) {
  const presence = usePresence(open)
  if (!presence.mounted) return null
  return (
    <div
      className={cx('ui-float', `ui-float--${kind}`, `ui-float--${placement}`, className)}
      data-state={presence.state}
      onAnimationEnd={presence.onAnimationEnd}
      {...rest}
    />
  )
}

export interface PopoverProps {
  /** Toggles the panel on click; an element gets `aria-haspopup` / `aria-expanded`. */
  trigger: ReactNode
  /** A function receives `close`, for pickers that close on select. */
  children?: ReactNode | ((close: () => void) => ReactNode)
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: Placement
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
  const set = (next: boolean) => {
    setShown(next)
    onOpenChange?.(next)
  }
  const close = (refocus = true) => {
    set(false)
    if (refocus) root.current?.querySelector<HTMLElement>('.ui-popover__trigger > *')?.focus()
  }
  useDismiss(shown, root, close)

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
      <Float
        ref={panel}
        open={shown}
        placement={placement}
        id={id}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={cx('ui-popover', arrow && 'ui-popover--arrow')}
        style={{ width }}
      >
        {typeof children === 'function' ? children(() => close()) : children}
      </Float>
    </span>
  )
}
