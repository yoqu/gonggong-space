import { create } from 'zustand'
import type { AccessFocus } from './accessScope'
import type { BotTab } from './BotSettings'

export interface BotDialogTarget {
  botId: string
  tab?: BotTab
  /** Group context of the caller (approval card or group settings), used to surface per-group overrides. */
  groupId?: string
  /** Permission row to highlight when opening the 权限 tab from an approval request. */
  focus?: AccessFocus
}

/** Global Bot settings modal trigger, so any approval card or notification opens BotDialog in place. */
export const useBotDialog = create<{
  target: BotDialogTarget | null
  open: (target: BotDialogTarget) => void
  close: () => void
}>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
