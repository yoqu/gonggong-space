import type { MessageDto } from '@gonggong/protocol'
import { create } from 'zustand'

/** `bot`: the name of the Bot a quoted reply or run card belongs to; quoting it only adds context (spec §8.6). */
/** `threadRootId`: quoted inside that thread's panel, so only its composer takes it. */
export type QuoteDraft = NonNullable<MessageDto['quote']> & {
  groupId: string
  bot?: string
  threadRootId?: string
}

/** The composer's pending quote (spec §8.6): a quote is context only; @ the Bot to trigger it. */
export const useQuote = create<{
  quote: QuoteDraft | null
  set: (q: QuoteDraft) => void
  clear: () => void
}>((set) => ({
  quote: null,
  set: (quote) => set({ quote }),
  clear: () => set({ quote: null }),
}))
