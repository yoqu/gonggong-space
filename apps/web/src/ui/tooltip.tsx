import { cloneElement, type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import './tooltip.css'

export interface TooltipProps {
  /** A short phrase without a full stop. */
  content: ReactNode
  shortcut?: string
  placement?: 'top' | 'bottom'
  /** Hover delay in ms. */
  delay?: number
  defaultOpen?: boolean
  /** One focusable element (usually an icon button, which keeps its own aria-label). */
  children: ReactElement<{ 'aria-describedby'?: string }>
}

/**
 * Pane Tooltip (help tag): shown after resting the pointer ~0.6s or at once on keyboard focus;
 * hidden on leave, blur or Escape. Linked to its trigger with aria-describedby.
 */
export function Tooltip({
  content,
  shortcut,
  placement = 'top',
  delay = 600,
  defaultOpen = false,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (wait: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), wait)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only drive the passive tip
    <span
      className="ui-tip-anchor"
      onMouseEnter={() => show(delay)}
      onMouseLeave={hide}
      onFocus={() => {
        clearTimeout(timer.current)
        setOpen(true)
      }}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className={cx('ui-tip', `ui-tip--${placement}`)}
        data-open={open ? '' : undefined}
      >
        {content}
        {shortcut ? <span className="ui-tip__kbd">{shortcut}</span> : null}
      </span>
    </span>
  )
}
