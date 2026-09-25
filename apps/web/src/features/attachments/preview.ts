import type { Attachment } from '@gonggong/protocol'
import { create } from 'zustand'
import { useRunRail } from '../runs/rail'

export interface PreviewTarget {
  attachment: Attachment
  /** Who sent it: the message author. */
  from: string
}

/** The attachment shown in the chat's right rail; a run opened there takes precedence. */
export const usePreview = create<{
  open: PreviewTarget | null
  show: (t: PreviewTarget) => void
  close: () => void
}>((set) => ({
  open: null,
  show: (open) => {
    useRunRail.getState().close()
    set({ open })
  },
  close: () => set({ open: null }),
}))
