import type { MessageDto } from '@aiws/protocol'
import { create } from 'zustand'

export type QuoteDraft = NonNullable<MessageDto['quote']> & { groupId: string }

/** The composer's pending quote (spec §8.6): quoting a bot reply or run card = @ that bot. */
export const useQuote = create<{
  quote: QuoteDraft | null
  set: (q: QuoteDraft) => void
  clear: () => void
}>((set) => ({
  quote: null,
  set: (quote) => set({ quote }),
  clear: () => set({ quote: null }),
}))
