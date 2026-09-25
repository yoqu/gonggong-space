import { type ReactNode, useEffect, useState } from 'react'
import { create } from 'zustand'
import { Icon } from './icon'
import { usePresence } from './presence'
import './toast.css'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: number
  type: ToastType
  title?: ReactNode
  message: ReactNode
  /** Identical toasts raised while this one is shown fold into it. */
  count: number
}

const DURATION = 4000
let nextId = 1

export const useToasts = create<{ items: ToastItem[] }>()(() => ({ items: [] }))

export function dismissToast(id: number) {
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }))
}

export function toast({
  type = 'info',
  title,
  message,
}: Omit<ToastItem, 'id' | 'type' | 'count'> & { type?: ToastType }) {
  const { items } = useToasts.getState()
  const same = items.find((t) => t.type === type && t.title === title && t.message === message)
  if (same) {
    useToasts.setState({ items: items.map((t) => (t === same ? { ...t, count: t.count + 1 } : t)) })
    return same.id
  }
  const id = nextId++
  useToasts.setState({ items: [...items, { id, type, title, message, count: 1 }] })
  return id
}

const ICON = {
  info: <Icon name="info" color="var(--system-blue)" />,
  success: <Icon name="checkmark-circle" color="var(--system-green)" />,
  warning: <Icon name="warning" color="var(--system-orange)" />,
  error: <Icon name="exclamation-circle" color="var(--system-red)" />,
}

/** Errors stay until dismissed; others auto-dismiss, paused while hovered and restarted by a repeat. */
function Toast({ t, open, onExited }: { t: ToastItem; open: boolean; onExited: () => void }) {
  const [hover, setHover] = useState(false)
  const presence = usePresence(open)
  // biome-ignore lint/correctness/useExhaustiveDependencies: onExited is recreated every render
  useEffect(() => {
    if (!presence.mounted) onExited()
  }, [presence.mounted])
  const persistent = t.type === 'error'
  // biome-ignore lint/correctness/useExhaustiveDependencies: a repeat (count) restarts the timer
  useEffect(() => {
    if (persistent || hover || !open) return
    const timer = setTimeout(() => dismissToast(t.id), DURATION)
    return () => clearTimeout(timer)
  }, [persistent, hover, open, t.id, t.count])
  if (!presence.mounted) return null
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses the auto-dismiss timer
    <div
      className="ui-toast"
      data-state={presence.state}
      role={persistent ? 'alert' : 'status'}
      onAnimationEnd={presence.onAnimationEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="ui-toast__icon">{ICON[t.type]}</span>
      <div className="ui-toast__body">
        {t.title ? <div className="ui-toast__title">{t.title}</div> : null}
        <div className="ui-toast__message">{t.message}</div>
      </div>
      {t.count > 1 ? <span className="ui-toast__count">×{t.count}</span> : null}
      <button type="button" className="ui-toast__close" aria-label="关闭" onClick={() => dismissToast(t.id)}>
        <Icon name="xmark" size={12} weight={1.8} />
      </button>
    </div>
  )
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  const [prev, setPrev] = useState(items)
  // Dismissed toasts stay rendered until their exit animation ends.
  const [leaving, setLeaving] = useState<ToastItem[]>([])
  if (prev !== items) {
    setPrev(items)
    const gone = prev.filter((p) => !items.some((t) => t.id === p.id))
    if (gone.length) setLeaving((l) => [...l, ...gone])
  }
  return (
    <div className="ui-toasts">
      {[...items, ...leaving]
        .sort((a, b) => a.id - b.id)
        .map((t) => (
          <Toast
            key={t.id}
            t={t}
            open={!leaving.includes(t)}
            onExited={() => setLeaving((l) => l.filter((x) => x !== t))}
          />
        ))}
    </div>
  )
}
