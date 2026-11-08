import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

export type InspectorView = 'group-info' | 'run' | 'thread' | 'threads'

interface InspectorState {
  view: InspectorView | null
  payload: unknown
  /** The view this one was opened from and can return to. */
  back: InspectorView | null
  /** The stable node `<InspectorPortal>` renders into, once an `<InspectorSlot>` has mounted. */
  host: HTMLElement | null
  open: (view: InspectorView, payload?: unknown, back?: InspectorView) => void
  close: () => void
}

/**
 * Right-hand inspector of the chat window. Whoever opens a view renders its body with `<InspectorPortal>`.
 */
export const useInspector = create<InspectorState>()((set) => ({
  view: null,
  payload: null,
  back: null,
  host: null,
  open: (view, payload = null, back) => set({ view, payload, back: back ?? null }),
  close: () => set({ view: null, payload: null, back: null }),
}))

/** Created once: the same node is re-parented when the rail moves, so the portalled body is never remounted. */
const hostEl = document.createElement('div')
hostEl.className = 'chat__inspector'

const attachHost = (slot: HTMLElement | null) => {
  if (!slot) return
  slot.appendChild(hostEl)
  if (useInspector.getState().host !== hostEl) useInspector.setState({ host: hostEl })
}

/** The rail's body: wherever the layout renders it, it holds the one stable inspector host. */
export function InspectorSlot() {
  return <div ref={attachHost} className="chat__inspector-slot" />
}

/** Renders `children` into the inspector while `view` is the open one. */
export function InspectorPortal({ view, children }: { view: InspectorView; children: ReactNode }) {
  const open = useInspector((s) => s.view === view)
  const host = useInspector((s) => s.host)
  return open && host ? createPortal(children, host) : null
}
