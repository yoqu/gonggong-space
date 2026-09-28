import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

export type InspectorView = 'group-info' | 'run'

interface InspectorState {
  view: InspectorView | null
  payload: unknown
  /** The chat page's inspector `<aside>` body, mounted while `view` is set. */
  host: HTMLElement | null
  open: (view: InspectorView, payload?: unknown) => void
  close: () => void
}

/**
 * Right-hand inspector of the chat window. Whoever opens a view renders its body with `<InspectorPortal>`.
 */
export const useInspector = create<InspectorState>()((set) => ({
  view: null,
  payload: null,
  host: null,
  open: (view, payload = null) => set({ view, payload }),
  close: () => set({ view: null, payload: null }),
}))

/** Renders `children` into the inspector while `view` is the open one. */
export function InspectorPortal({ view, children }: { view: InspectorView; children: ReactNode }) {
  const open = useInspector((s) => s.view === view)
  const host = useInspector((s) => s.host)
  return open && host ? createPortal(children, host) : null
}
