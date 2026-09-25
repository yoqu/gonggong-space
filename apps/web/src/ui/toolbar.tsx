import { type HTMLAttributes, type ReactElement, type ReactNode, useCallback, useState } from 'react'
import { cx } from '../lib/cx'
import { Icon, type IconName } from './icon'
import './toolbar.css'

/** Ref callback for a sentinel at the top of a scroll container, and whether content has scrolled past it. */
export function useScrollEdge() {
  const [scrolled, setScrolled] = useState(false)
  const sentinel = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setScrolled(entry ? !entry.isIntersecting : false))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [sentinel, scrolled] as const
}

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Pane title block (bold, left); omit to lay out custom children instead. */
  title?: ReactNode
  subtitle?: ReactNode
  /** Placed before the title, e.g. a sidebar toggle. */
  leading?: ReactNode
  /** Given when the scrolling content is not below the toolbar in the same container (e.g. the chat timeline). */
  scrolled?: boolean
}

/** Unified toolbar (Pane, 52px): sticky, its glass scroll edge appears only once content is under it. */
export function Toolbar({ title, subtitle, leading, scrolled, className, children, ...rest }: ToolbarProps) {
  const [sentinel, own] = useScrollEdge()
  const external = scrolled !== undefined
  return (
    <>
      {external ? null : <div ref={sentinel} className="ui-toolbar-sentinel" aria-hidden="true" />}
      <header
        className={cx('ui-toolbar', className)}
        data-scrolled={(external ? scrolled : own) ? '' : undefined}
        {...rest}
      >
        {leading}
        {title ? (
          <div className="ui-toolbar__titles">
            <h1 className="ui-toolbar__title">{title}</h1>
            {subtitle ? <span className="ui-toolbar__subtitle">{subtitle}</span> : null}
          </div>
        ) : null}
        {children}
      </header>
    </>
  )
}

/** Glass capsule holding 2–3 related ToolbarButtons. */
export function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="ui-toolbar__group">{children}</div>
}

export interface ToolbarButtonProps {
  icon?: IconName | ReactElement
  /** Tooltip and accessible name; required even when `text` is shown. */
  label: string
  text?: ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}

export function ToolbarButton({ icon, label, text, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="ui-toolbar__btn"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {typeof icon === 'string' ? <Icon name={icon} /> : icon}
      {text}
    </button>
  )
}
