import { type HTMLAttributes, useCallback, useState } from 'react'
import { cx } from '../lib/cx'

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

export interface ToolbarProps extends HTMLAttributes<HTMLElement> {
  /** Given when the scrolling content is not below the toolbar in the same container (e.g. the chat timeline). */
  scrolled?: boolean
}

/** Unified top toolbar (macOS 27): sticky, its glass scroll edge appears only once content is under it. */
export function Toolbar({ scrolled, className, ...rest }: ToolbarProps) {
  const [sentinel, own] = useScrollEdge()
  const external = scrolled !== undefined
  return (
    <>
      {external ? null : <div ref={sentinel} className="ui-toolbar-sentinel" aria-hidden="true" />}
      <header
        className={cx('ui-toolbar', className)}
        data-scrolled={(external ? scrolled : own) ? '' : undefined}
        {...rest}
      />
    </>
  )
}
