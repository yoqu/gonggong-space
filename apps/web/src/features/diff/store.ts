import type { DiffScope } from '@gonggong/protocol'
import { create } from 'zustand'

/** Whose changes: a bot's workspace in a group; `runId` adds the 本轮 scope for that turn. */
export interface DiffSource {
  groupId: string
  botId: string
  runId: string | null
}

interface DiffWindowState {
  source: DiffSource | null
  scope: DiffScope
  file: string | null
  open: (source: DiffSource, scope: DiffScope, file?: string | null) => void
  setScope: (scope: DiffScope) => void
  setFile: (file: string) => void
  close: () => void
}

/** The diff window (one per page): every entry point — process rows, the 改动 tab, reply file chips — opens it. */
export const useDiffWindow = create<DiffWindowState>((set) => ({
  source: null,
  scope: 'turn',
  file: null,
  open: (source, scope, file = null) => set({ source, scope, file }),
  setScope: (scope) => set({ scope, file: null }),
  setFile: (file) => set({ file }),
  close: () => set({ source: null, file: null }),
}))
