import { create } from 'zustand'
import type { QuoteDraft } from '../attachments/quote'

/** How long 重新编辑 is offered after my own recall. */
export const REEDIT_WINDOW_MS = 5 * 60_000

export interface RecalledDraft {
  groupId: string
  /** Recalled inside that thread: its composer takes it back, not the main one. */
  threadRootId?: string
  body: string
  quote: QuoteDraft | null
  /** The attachments' content: their uploads stay bound to the recalled message, so they are uploaded anew. */
  files: File[]
}

/**
 * The content of messages I recalled in this tab, for 重新编辑. The server erased it for good; it lives only in memory
 * here, so a reload or the window running out drops it. `pending` hands one over to its group's composer.
 */
export const useRecalled = create<{ drafts: Record<string, RecalledDraft>; pending: RecalledDraft | null }>(
  () => ({ drafts: {}, pending: null }),
)

const drop = (messageId: string) =>
  useRecalled.setState((s) => {
    const { [messageId]: _, ...drafts } = s.drafts
    return { drafts }
  })

export function keepRecalled(messageId: string, draft: RecalledDraft) {
  useRecalled.setState((s) => ({ drafts: { ...s.drafts, [messageId]: draft } }))
  setTimeout(() => drop(messageId), REEDIT_WINDOW_MS)
}

export function reedit(messageId: string) {
  const draft = useRecalled.getState().drafts[messageId]
  if (!draft) return
  drop(messageId)
  useRecalled.setState({ pending: draft })
}
