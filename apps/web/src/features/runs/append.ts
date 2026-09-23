import { create } from 'zustand'

export interface AppendTarget {
  runId: string
  groupId: string
  botName: string
}

/** 打断并追加 (spec §8.9): the running run the composer's next message goes into. */
export const useAppend = create<{
  target: AppendTarget | null
  start: (target: AppendTarget) => void
  clear: () => void
}>((set) => ({
  target: null,
  start: (target) => set({ target }),
  clear: () => set({ target: null }),
}))
