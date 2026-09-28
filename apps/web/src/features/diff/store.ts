import { create } from 'zustand'

/** Whose changes: a bot's workspace in a group; `runId` adds the 本轮 scope for that turn. */
export interface DiffSource {
  groupId: string
  botId: string
  runId: string | null
}

export type DiffLayout = 'list' | 'tree'

const LAYOUT_KEY = 'gonggong.diffLayout'

/** How changed files are listed (flat or as a folder tree), shared by the run and diff tabs and kept across visits. */
export const useDiffLayout = create<{ layout: DiffLayout; toggle: () => void }>((set) => ({
  layout: localStorage.getItem(LAYOUT_KEY) === 'tree' ? 'tree' : 'list',
  toggle: () =>
    set((s) => {
      const layout = s.layout === 'tree' ? 'list' : 'tree'
      localStorage.setItem(LAYOUT_KEY, layout)
      return { layout }
    }),
}))
