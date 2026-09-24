import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { create } from 'zustand'

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
  info: <Info size={16} color="var(--color-brand-info)" />,
  success: <CircleCheck size={16} color="var(--color-success)" />,
  warning: <TriangleAlert size={16} color="var(--color-brand-warm)" />,
  error: <CircleAlert size={16} color="var(--color-danger)" />,
}

/** Errors stay until dismissed; others auto-dismiss, paused while hovered and restarted by a repeat. */
function Toast({ t }: { t: ToastItem }) {
  const [hover, setHover] = useState(false)
  const persistent = t.type === 'error'
  // biome-ignore lint/correctness/useExhaustiveDependencies: a repeat (count) restarts the timer
  useEffect(() => {
    if (persistent || hover) return
    const timer = setTimeout(() => dismissToast(t.id), DURATION)
    return () => clearTimeout(timer)
  }, [persistent, hover, t.id, t.count])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses the auto-dismiss timer
    <div
      className="ui-toast"
      role={persistent ? 'alert' : 'status'}
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
        <X size={14} />
      </button>
    </div>
  )
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  return (
    <div className="ui-toasts">
      {items.map((t) => (
        <Toast key={t.id} t={t} />
      ))}
    </div>
  )
}
