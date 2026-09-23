import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: number
  type: ToastType
  title?: ReactNode
  message: ReactNode
}

const DURATION = 4000
let nextId = 1

export const useToasts = create<{ items: ToastItem[] }>()(() => ({ items: [] }))

export function dismissToast(id: number) {
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }))
}

export function toast(t: Omit<ToastItem, 'id' | 'type'> & { type?: ToastType }) {
  const id = nextId++
  useToasts.setState((s) => ({ items: [...s.items, { type: 'info', ...t, id }] }))
  setTimeout(() => dismissToast(id), DURATION)
  return id
}

const ICON = {
  info: <Info size={16} color="#409CFF" />,
  success: <CircleCheck size={16} color="#32D74B" />,
  warning: <TriangleAlert size={16} color="#FF9F0A" />,
  error: <CircleAlert size={16} color="#FF453A" />,
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  return (
    <div className="ui-toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="ui-toast">
          <span className="ui-toast__icon">{ICON[t.type]}</span>
          <div className="ui-toast__body">
            {t.title ? <div className="ui-toast__title">{t.title}</div> : null}
            <div className="ui-toast__message">{t.message}</div>
          </div>
          <button
            type="button"
            className="ui-toast__close"
            aria-label="关闭"
            onClick={() => dismissToast(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
