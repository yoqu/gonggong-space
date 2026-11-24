import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'
import { Menu, type MenuItem } from './menu'
import { useEscape, useOutsidePress } from './overlay'
import { usePresence } from './presence'

export interface ContextMenuProps {
  items: MenuItem[]
  onSelect?: (value: string) => void
  /** The content that is right-clicked. */
  children?: ReactNode
  /** Open on mount at this point relative to the content (demo only). */
  defaultPosition?: { x: number; y: number }
  activeValue?: string
  onOpen?: () => void
  /** A touch long-press keeps the platform behaviour (text selection) instead of opening the menu. */
  nativeTouch?: boolean
  className?: string
  style?: CSSProperties
}

interface Position {
  x: number
  y: number
  keyboard: boolean
  /** Demo placement: absolute inside the content instead of fixed at the pointer. */
  local?: boolean
}

const EDGE = 8

/**
 * Pane ContextMenu: right-click (or ⇧F10 / the menu key while focus is inside) opens a Menu at the pointer,
 * kept inside the viewport. Closes on select, Escape (refocusing where focus was), an outside press or window blur.
 */
export function ContextMenu({
  items,
  onSelect,
  children,
  defaultPosition,
  activeValue,
  onOpen,
  nativeTouch,
  className,
  style,
}: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const touch = useRef(false)
  const restore = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState<Position | null>(
    defaultPosition ? { ...defaultPosition, keyboard: false, local: true } : null,
  )
  const [openKey, setOpenKey] = useState(0)
  const presence = usePresence(pos !== null)
  const lastPos = useRef<Position | null>(pos)
  if (pos) lastPos.current = pos
  const activePos = pos ?? lastPos.current

  const show = (x: number, y: number, keyboard: boolean) => {
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpenKey((k) => k + 1)
    setPos({ x, y, keyboard })
    onOpen?.()
  }
  const close = (refocus: boolean) => {
    setPos(null)
    if (refocus) restore.current?.focus()
  }
  useEscape(() => close(true), pos !== null)
  useOutsidePress([menu], () => close(false), pos !== null)

  useLayoutEffect(() => {
    const el = menu.current
    if (!el || !pos || pos.local) return
    const { width, height } = el.getBoundingClientRect()
    const flipX = pos.x + width > window.innerWidth - EDGE
    const flipY = pos.y + height > window.innerHeight - EDGE
    if (flipX) el.style.left = `${Math.max(EDGE, pos.x - width)}px`
    if (flipY) el.style.top = `${Math.max(EDGE, window.innerHeight - EDGE - height)}px`
    el.style.transformOrigin = `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`
    // Pointer-opened menus take focus without highlighting a row, as on macOS; ↓ then starts at the top.
    if (!pos.keyboard) el.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
  }, [pos])

  // A fixed menu would drift from its content when anything scrolls, so scrolling closes it like a blur.
  useEffect(() => {
    if (!pos || pos.local) return
    const dismiss = () => close(false)
    window.addEventListener('blur', dismiss)
    document.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('scroll', dismiss, true)
    }
  })

  const menuAt =
    presence.mounted && activePos ? (
      <Menu
        key={openKey}
        ref={menu}
        items={items}
        activeValue={activeValue}
        autoFocus={activePos.keyboard}
        className={cx('ui-menu--context', activePos.local && 'ui-menu--local')}
        style={{ left: activePos.x, top: activePos.y }}
        data-state={presence.state}
        aria-hidden={presence.state === 'closed' || undefined}
        inert={presence.state === 'closed' || undefined}
        onAnimationEnd={presence.onAnimationEnd}
        onSelect={(v) => {
          close(true)
          onSelect?.(v)
        }}
      />
    ) : null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards the platform context-menu gestures of its content
    <div
      className={cx('ui-ctx', className)}
      style={style}
      onPointerDown={(e) => {
        touch.current = e.pointerType === 'touch'
      }}
      onContextMenu={(e) => {
        if (nativeTouch && touch.current) return
        e.preventDefault()
        show(e.clientX, e.clientY, false)
      }}
      onKeyDown={(e) => {
        // A touch laptop: after a finger tap the keyboard's contextmenu must not be left to the platform.
        touch.current = false
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
        e.preventDefault()
        const r = (e.target as HTMLElement).getBoundingClientRect()
        show(r.left + 16, r.top + 16, true)
      }}
    >
      {children}
      {menuAt ? (activePos?.local ? menuAt : createPortal(menuAt, document.body)) : null}
    </div>
  )
}
