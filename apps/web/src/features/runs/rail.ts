import { create } from 'zustand'

export type RailTab = 'process' | 'diff' | 'audit'

interface RunRailState {
  runId: string | null
  tab: RailTab
  /** File asked for from a reply; the diff tab shows it (or that this turn did not touch it). */
  file: string | null
  open: (runId: string, tab?: RailTab, file?: string | null) => void
  setTab: (tab: RailTab) => void
  setFile: (file: string) => void
  close: () => void
}

/** The run shown in the chat's right rail (spec §8.2). */
export const useRunRail = create<RunRailState>((set) => ({
  runId: null,
  tab: 'process',
  file: null,
  open: (runId, tab = 'process', file = null) => set({ runId, tab, file }),
  setTab: (tab) => set({ tab }),
  setFile: (file) => set({ file }),
  close: () => set({ runId: null, file: null }),
}))
