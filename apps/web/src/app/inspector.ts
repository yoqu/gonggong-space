import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { usePreview } from '../features/attachments/preview'
import { useRunRail } from '../features/runs/rail'

export type InspectorView = 'group-info' | 'run' | 'preview'

interface InspectorState {
  view: InspectorView | null
  payload: unknown
  /** The chat page's inspector `<aside>` body, mounted while `view` is set. */
  host: HTMLElement | null
  open: (view: InspectorView, payload?: unknown) => void
  close: () => void
}

/**
 * Right-hand inspector of the chat window. Whoever opens a view renders its body with `<InspectorPortal>`;
 * the legacy run rail and attachment preview stores still work and give way to an explicitly opened view.
 */
export const useInspector = create<InspectorState>()((set) => ({
  view: null,
  payload: null,
  host: null,
  open: (view, payload = null) => {
    useRunRail.getState().close()
    usePreview.getState().close()
    set({ view, payload })
  },
  close: () => set({ view: null, payload: null }),
}))

/** Renders `children` into the inspector while `view` is the open one. */
export function InspectorPortal({ view, children }: { view: InspectorView; children: ReactNode }) {
  const open = useInspector((s) => s.view === view)
  const host = useInspector((s) => s.host)
  return open && host ? createPortal(children, host) : null
}

/** Closes an explicit view once a legacy rail (run or preview) opens, so the newest panel wins. */
export function useLegacyRailWins(legacyOpen: boolean) {
  useEffect(() => {
    if (legacyOpen) useInspector.getState().close()
  }, [legacyOpen])
}
