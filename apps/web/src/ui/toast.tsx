import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { type Glyph, renderGlyph } from './controls'
import { Icon } from './icon'
import { usePresence } from './presence'
import './toast.css'

const CLOSE_LABEL = t('关闭#close')

export interface ToastProps {
  message: ReactNode
  icon?: Glyph
  iconColor?: string
  /** E.g. 「撤销」; give such toasts a duration of at least 5000. */
  action?: { label: string; onClick?: () => void }
  /** Renders nothing when false. */
  open?: boolean
  /** Calls `onClose` after this many ms. */
  duration?: number
  onClose?: () => void
  className?: string
  style?: CSSProperties
}

/** Pane Toast: glass capsule confirming a finished action, announced politely without taking focus. */
export function Toast({
  message,
  icon,
  iconColor,
  action,
  open,
  duration,
  onClose,
  className,
  style,
}: ToastProps) {
  useEffect(() => {
    if (open === false || !duration || !onClose) return
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [open, duration, onClose])
  if (open === false) return null
  return (
    <div className={cx('ui-toast', className)} style={style} role="status" aria-live="polite">
      {icon ? (
        <span className="ui-toast__icon" style={{ color: iconColor }}>
          {renderGlyph(icon)}
        </span>
      ) : null}
      <span className="ui-toast__message">{message}</span>
      {action ? (
        <button type="button" className="ui-toast__action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

/** Pane HUD: square glass panel mid-screen, like the system volume / 「已保存」 HUD; `level` (0–1) fills 16 steps. */
export function HUD({
  icon = 'check',
  title,
  level,
  open,
  style,
}: {
  icon?: Glyph
  title?: ReactNode
  level?: number
  open?: boolean
  style?: CSSProperties
}) {
  if (open === false) return null
  const on = level == null ? 0 : Math.round(level * 16)
  return (
    <div className="ui-hud" style={style} role="status" aria-live="polite">
      <span className="ui-hud__icon">{typeof icon === 'string' ? <Icon name={icon} size={64} /> : icon}</span>
      {title ? <span className="ui-hud__title">{title}</span> : null}
      {level != null ? (
        <span className="ui-hud__level" aria-hidden="true">
          {Array.from({ length: 16 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed meter cells
            <i key={i} data-on={i < on ? '' : undefined} />
          ))}
        </span>
      ) : null}
    </div>
  )
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  type: ToastType
  title?: ReactNode
  message: ReactNode
  /** E.g. 「编辑说明」, or several: clicking one dismisses the toast, which stays longer to give time for it. */
  action?: ToastAction | ToastAction[]
  /** Identical toasts raised while this one is shown fold into it. */
  count: number
}

const DURATION = 4000
const ACTION_DURATION = 8000
/** Hovering or focusing holds a toast this long at most, so one left under a resting pointer still goes. */
const HOLD_DURATION = 10_000
/** An upward swipe this far dismisses a toast on touch screens. */
const SWIPE_DISMISS = 24
let nextId = 1

/** At most one toast: a new one replaces it (an identical one folds into it); `items` keeps the array for callers. */
export const useToasts = create<{ items: ToastItem[] }>()(() => ({ items: [] }))

function dismissToast(id: number) {
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }))
}

export function toast({
  type = 'info',
  title,
  message,
  action,
}: Omit<ToastItem, 'id' | 'type' | 'count'> & { type?: ToastType }) {
  const [shown] = useToasts.getState().items
  if (shown && shown.type === type && shown.title === title && shown.message === message) {
    // The newest action wins: undoing a repeat acts on the latest occurrence.
    useToasts.setState({ items: [{ ...shown, action: action ?? shown.action, count: shown.count + 1 }] })
    return shown.id
  }
  const id = nextId++
  useToasts.setState({ items: [{ id, type, title, message, action, count: 1 }] })
  return id
}

const ICON = {
  info: <Icon name="info" />,
  success: <Icon name="check" />,
  warning: <Icon name="warning" color="var(--system-orange)" />,
  error: <Icon name="exclamation-circle" color="var(--system-red)" />,
}

/** Errors stay until dismissed; others auto-dismiss, held (up to HOLD_DURATION) while hovered or focused. */
function ToastRow({
  t,
  open,
  replaced,
  onExited,
}: {
  t: ToastItem
  open: boolean
  replaced: boolean
  onExited: () => void
}) {
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const swipeY = useRef<number>(undefined)
  const presence = usePresence(open)
  // biome-ignore lint/correctness/useExhaustiveDependencies: onExited is recreated every render
  useEffect(() => {
    if (!presence.mounted) onExited()
  }, [presence.mounted])
  const persistent = t.type === 'error'
  const actions = [t.action ?? []].flat()
  const held = hover || focused
  // biome-ignore lint/correctness/useExhaustiveDependencies: a repeat (count) restarts the timer
  useEffect(() => {
    if (persistent || !open) return
    const ms = held ? HOLD_DURATION : actions.length ? ACTION_DURATION : DURATION
    const timer = setTimeout(() => dismissToast(t.id), ms)
    return () => clearTimeout(timer)
  }, [persistent, held, open, t.id, t.count, actions.length])
  if (!presence.mounted) return null
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and swipe only hold or dismiss the toast
    <div
      className={cx('ui-toast', t.title != null && 'ui-toast--card')}
      data-state={presence.state}
      data-replaced={replaced || undefined}
      data-persistent={persistent || undefined}
      role={persistent ? 'alert' : 'status'}
      onAnimationEnd={presence.onAnimationEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      onPointerDown={(e) => {
        swipeY.current = e.clientY
      }}
      onPointerUp={(e) => {
        if (swipeY.current != null && e.clientY - swipeY.current < -SWIPE_DISMISS) dismissToast(t.id)
        swipeY.current = undefined
      }}
      onPointerCancel={() => {
        swipeY.current = undefined
      }}
    >
      <span className="ui-toast__icon">{ICON[t.type]}</span>
      <div className="ui-toast__body">
        {t.title ? <div className="ui-toast__title">{t.title}</div> : null}
        <div className="ui-toast__message">{t.message}</div>
      </div>
      {t.count > 1 ? (
        <span key={t.count} className="ui-toast__count">
          ×{t.count}
        </span>
      ) : null}
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          className="ui-toast__action"
          onClick={() => {
            dismissToast(t.id)
            a.onClick()
          }}
        >
          {a.label}
        </button>
      ))}
      <button
        type="button"
        className="ui-toast__close"
        aria-label={CLOSE_LABEL}
        onClick={() => dismissToast(t.id)}
      >
        <Icon name="xmark" size={12} weight={1.8} />
      </button>
    </div>
  )
}

/** Slot for `toast()`: one Pane capsule at the top center of the window; a replaced toast fades out under the new one. */
export function Toaster() {
  const items = useToasts((s) => s.items)
  const [prev, setPrev] = useState(items)
  // Dismissed toasts stay rendered until their exit animation ends.
  const [leaving, setLeaving] = useState<{ item: ToastItem; replaced: boolean }[]>([])
  if (prev !== items) {
    setPrev(items)
    const gone = prev.filter((p) => !items.some((t) => t.id === p.id))
    const replaced = items.length > 0
    if (gone.length) setLeaving((l) => [...l, ...gone.map((item) => ({ item, replaced }))])
  }
  const rows = [
    ...items.map((item) => ({ item, open: true, replaced: false })),
    ...leaving.map(({ item, replaced }) => ({ item, open: false, replaced })),
  ].sort((a, b) => a.item.id - b.item.id)
  return (
    <div className="ui-toasts">
      {rows.map((r) => (
        <ToastRow
          key={r.item.id}
          t={r.item}
          open={r.open}
          replaced={r.replaced}
          onExited={() => setLeaving((l) => l.filter((x) => x.item !== r.item))}
        />
      ))}
    </div>
  )
}
