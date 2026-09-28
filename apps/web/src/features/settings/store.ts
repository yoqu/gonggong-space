import { create } from 'zustand'

export type SettingsPage = 'appearance' | 'git' | 'account'

/** The personal settings window; opened from the account menu or deep-linked (the repo picker's 「连接账号…」). */
export const useSettings = create<{
  page: SettingsPage | null
  open: (page?: SettingsPage) => void
  close: () => void
}>()((set) => ({
  page: null,
  open: (page = 'appearance') => set({ page }),
  close: () => set({ page: null }),
}))
