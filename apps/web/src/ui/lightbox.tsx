import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { CloseButton } from './controls'
import { Icon } from './icon'
import { useEscape, useFocusTrap } from './overlay'
import './lightbox.css'

export type LightboxItem = { src: string; alt: string }

/** A horizontal swipe longer than this (and wider than tall) pages. */
const SWIPE_PX = 50
/** Scale relative to the image fitted in the window. */
const MAX_SCALE = 8
const STEP = 1.5
/** A press that moves farther than this is a drag, not a click. */
const DRAG_PX = 4

type View = { s: number; x: number; y: number }
const FIT: View = { s: 1, x: 0, y: 0 }

type Source =
  | { src: string; alt: string; items?: undefined; index?: undefined; onIndexChange?: undefined }
  | {
      /** Several images paged with ←/→, swipes and the side buttons; no wrap-around at either end. */
      items: LightboxItem[]
      index: number
      onIndexChange: (index: number) => void
      src?: undefined
      alt?: undefined
    }

/**
 * Full-window image viewer: fits the window; zoom with the toolbar, +/-/0, the wheel or a pinch, drag to pan, click
 * the image to toggle between fit and its natural size. Escape or the scrim closes.
 */
export function Lightbox({
  onClose,
  actions,
  ...source
}: Source & {
  onClose: () => void
  /** Extra toolbar items left of the close button, e.g. 下载. */
  actions?: ReactNode
}) {
  const items = source.items ?? [{ src: source.src as string, alt: source.alt as string }]
  const index = source.index ?? 0
  const item = items[index] ?? items[0]!
  const ref = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [view, setView] = useState<View>(FIT)
  const viewRef = useRef(view)
  viewRef.current = view
  const zoomed = view.s > 1
  const [dragging, setDragging] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const moved = useRef(false)
  const touch = useRef<{ x: number; y: number } | null>(null)
  useEscape(onClose)
  useFocusTrap(ref, true)
  /** Scales to `to`, keeping the point at client (cx, cy) (default: the image centre) where it is. */
  const zoomTo = (to: number, cx?: number, cy?: number) => {
    const v = viewRef.current
    const s = Math.min(MAX_SCALE, Math.max(1, to))
    if (s === 1) return setView(FIT)
    const r = img.current?.getBoundingClientRect()
    // The image scales about its centre, so its laid-out centre is the drawn one less the pan.
    const px = cx === undefined || !r ? 0 : cx - (r.left + r.width / 2 - v.x)
    const py = cy === undefined || !r ? 0 : cy - (r.top + r.height / 2 - v.y)
    const k = s / v.s
    setView({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k })
  }
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo
  const go = (to: number) => {
    if (to < 0 || to >= items.length || to === index) return
    setView(FIT)
    source.onIndexChange?.(to)
  }
  const goRef = useRef(go)
  goRef.current = go
  const paged = items.length > 1
  useEffect(() => {
    if (!paged) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goRef.current(index - 1)
      else if (e.key === 'ArrowRight') goRef.current(index + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [paged, index])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = viewRef.current.s
      if (e.key === '+' || e.key === '=') zoomRef.current(s * STEP)
      else if (e.key === '-') zoomRef.current(s / STEP)
      else if (e.key === '0') zoomRef.current(1)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomRef.current(viewRef.current.s * Math.exp(-e.deltaY / 300), e.clientX, e.clientY)
    }
    const el = ref.current
    document.addEventListener('keydown', onKey)
    el?.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      document.removeEventListener('keydown', onKey)
      el?.removeEventListener('wheel', onWheel)
    }
  }, [])
  // Neighbours load ahead so paging shows them at once.
  useEffect(() => {
    for (const n of [items[index - 1], items[index + 1]]) if (n) new Image().src = n.src
  }, [items, index])
  const onTouchStart = (e: TouchEvent) => {
    const p = e.touches[0]
    touch.current = p && !zoomed && e.touches.length === 1 ? { x: p.clientX, y: p.clientY } : null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const from = touch.current
    const p = e.changedTouches[0]
    touch.current = null
    if (!from || !p) return
    const dx = p.clientX - from.x
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(p.clientY - from.y)) go(index + (dx < 0 ? 1 : -1))
  }
  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) moved.current = false
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent) => {
    const ps = pointers.current
    const last = ps.get(e.pointerId)
    if (!last) return
    const [a, b] = [...ps.values()]
    const before = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    if (Math.abs(dx) + Math.abs(dy) > 0) moved.current ||= ps.size > 1 || Math.hypot(dx, dy) > DRAG_PX
    if (ps.size === 2) {
      const [c, d] = [...ps.values()] as [{ x: number; y: number }, { x: number; y: number }]
      const after = Math.hypot(c.x - d.x, c.y - d.y)
      if (before > 0) zoomTo(viewRef.current.s * (after / before), (c.x + d.x) / 2, (c.y + d.y) / 2)
    } else if (zoomed) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (!pointers.current.size) setDragging(false)
  }
  const onImageClick = (e: MouseEvent) => {
    if (moved.current) return
    if (zoomed) return setView(FIT)
    const el = img.current
    const natural = el?.naturalWidth && el.clientWidth ? el.naturalWidth / el.clientWidth : 0
    zoomTo(natural > 1.05 ? natural : 2, e.clientX, e.clientY)
  }
  return createPortal(
    <div
      ref={ref}
      className="ui-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.alt}
      tabIndex={-1}
      onTouchStart={paged ? onTouchStart : undefined}
      onTouchEnd={paged ? onTouchEnd : undefined}
    >
      <div className="ui-lightbox__scrim" onClick={onClose} aria-hidden="true" />
      <div className="ui-lightbox__bar">
        <span className="ui-lightbox__title">{item.alt}</span>
        {paged ? <span className="ui-lightbox__count">{`${index + 1} / ${items.length}`}</span> : null}
        <div className="ui-lightbox__zoom">
          <button
            type="button"
            aria-label={t('缩小')}
            disabled={!zoomed}
            onClick={() => zoomTo(view.s / STEP)}
          >
            <Icon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="ui-lightbox__scale"
            aria-label={t('适应窗口')}
            title={t('适应窗口')}
            onClick={() => setView(FIT)}
          >
            {`${Math.round(view.s * 100)}%`}
          </button>
          <button
            type="button"
            aria-label={t('放大')}
            disabled={view.s >= MAX_SCALE}
            onClick={() => zoomTo(view.s * STEP)}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
        {actions}
        <CloseButton onClick={onClose} />
      </div>
      <div className="ui-lightbox__stage">
        <div className={cx('ui-lightbox__img', zoomed && 'ui-lightbox__img--zoomed')}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard zoom is the toolbar and +/-/0 */}
          <img
            ref={img}
            src={item.src}
            alt={item.alt}
            draggable={false}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
              transition: dragging ? 'none' : undefined,
            }}
            onClick={onImageClick}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      </div>
      {paged ? (
        <>
          <button
            type="button"
            className="ui-lightbox__nav ui-lightbox__nav--prev"
            aria-label={t('上一张')}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <Icon name="chevron-left" size={22} />
          </button>
          <button
            type="button"
            className="ui-lightbox__nav ui-lightbox__nav--next"
            aria-label={t('下一张')}
            disabled={index === items.length - 1}
            onClick={() => go(index + 1)}
          >
            <Icon name="chevron-right" size={22} />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  )
}
