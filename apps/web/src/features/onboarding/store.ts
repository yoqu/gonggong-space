import { create } from 'zustand'

/** 新手指引: opened on a 使用者's first visit, or again from the account menu. */
export const useGuide = create<{ open: boolean; show: () => void; hide: () => void }>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
