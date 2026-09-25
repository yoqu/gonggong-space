/* Internal: anchored floating panels for the Vb1 inputs. Not exported from ui/index; fold into ui/popover.tsx once Popover lands. */
import { type HTMLAttributes, type Ref, type RefObject, useEffect, useRef } from 'react'
import { cx } from '../lib/cx'
import { useEscape } from './overlay'
import { usePresence } from './presence'
import './anchor.css'

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
