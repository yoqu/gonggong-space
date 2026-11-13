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
  useLayoutEffect,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
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
  also?: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose)
  close.current = onClose
  useEscape(() => close.current(true), open)
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !also?.current?.contains(t)) close.current(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open, root, also])
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

/**
 * Places a portalled `.ui-float--fixed` panel in viewport coordinates next to `anchor`: below unless there is
 * more room above. `list` caps it to that room (the list scrolls) and widens it to the anchor. A fixed panel
 * would drift from its anchor, so a scroll that moved the anchor, or a width change, calls `onDrift`. Scroll events
 * land a frame late, so the one from scrolling the trigger into view (before it was clicked) must not dismiss.
 * A height-only resize is the phone's on-screen keyboard opening for a field in the panel: re-place instead.
 */
export function useFixedPosition(
  enabled: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  placement: Placement,
  gap: number,
  onDrift: () => void,
  list = false,
) {
  const drift = useRef(onDrift)
  drift.current = onDrift
  const placed = useRef({ top: 0, left: 0, width: 0 })
  const place = () => {
    const el = panel.current
    if (!enabled || !el || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    placed.current = { top: r.top, left: r.left, width: window.innerWidth }
    // Clearing the cap clamps a scrolled list to the top; restore it after re-capping.
    const scrolled = el.scrollTop
    if (list) {
      el.style.minWidth = `${r.width}px`
      el.style.maxHeight = ''
    }
    // Layout size: the enter animation scales the panel, which would under-measure it.
    const { offsetWidth: w, offsetHeight: h } = el
    const room = { below: window.innerHeight - r.bottom - 2 * gap, above: r.top - 2 * gap }
    const below = h <= room.below || room.below >= room.above
    const height = list ? Math.min(h, below ? room.below : room.above) : h
    if (list) {
      el.style.maxHeight = `${height}px`
      el.scrollTop = scrolled
    }
    el.style.top = `${below ? r.bottom + gap : Math.max(gap, r.top - gap - height)}px`
    el.style.left = `${Math.max(gap, Math.min(placement.endsWith('end') ? r.right - w : r.left, window.innerWidth - gap - w))}px`
  }
  const replace = useRef(place)
  replace.current = place
  // Every render: filtering a list changes its height, and a list placed above must move with it.
  useLayoutEffect(place)
  useEffect(() => {
    if (!enabled) return
    const scrolled = (e: Event) => {
      const r = anchor.current?.getBoundingClientRect()
      const moved = !r || r.top !== placed.current.top || r.left !== placed.current.left
      if (moved && !panel.current?.contains(e.target as Node)) drift.current()
    }
    const resized = () => (window.innerWidth === placed.current.width ? replace.current() : drift.current())
    document.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', resized)
    return () => {
      document.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', resized)
    }
  }, [enabled, anchor, panel])
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
  /** Fix the panel in document.body so a scrolling ancestor (a Dialog body) cannot clip it; flips above when short of room below. */
  portal?: boolean
  'aria-label'?: string
}

const GAP = 8

const coarsePointer = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

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
  portal,
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
  useDismiss(shown, root, close, panel)

  useFixedPosition(portal === true && shown, root, panel, placement, GAP, () => close(false))

  // Only a user-opened panel takes focus; a demo shown on mount leaves it where it is. On touch the panel itself
  // takes it: a focused field would pop up the keyboard the user did not ask for.
  useEffect(() => {
    if (shown === opened.current) return
    opened.current = shown
    const el = panel.current
    if (shown && el) ((!coarsePointer() && el.querySelector<HTMLElement>(FOCUSABLE)) || el).focus()
  }, [shown])

  const float = (
    <Float
      ref={panel}
      open={shown}
      placement={placement}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cx('ui-popover', arrow && 'ui-popover--arrow', portal && 'ui-float--fixed')}
      style={{ width }}
    >
      {typeof children === 'function' ? children(() => close()) : children}
    </Float>
  )

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
      {portal ? createPortal(float, document.body) : float}
    </span>
  )
}
