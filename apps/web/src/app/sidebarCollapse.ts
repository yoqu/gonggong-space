import { useEffect } from 'react'
import { create } from 'zustand'

const STORE_KEY = 'gonggong.sidebarCollapsed'

const load = () => {
  try {
    return localStorage.getItem(STORE_KEY) === '1'
  } catch {
    return false
  }
}

const save = (collapsed: boolean) => {
  try {
    localStorage.setItem(STORE_KEY, collapsed ? '1' : '0')
  } catch {
    // storage unavailable (private mode): state lasts for this page only
  }
}

interface SidebarCollapseState {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggle: () => void
}

/** Desktop conversation sidebar collapse preference, toggled by clicking 消息 on the NavRail or pressing ⌘\. */
export const useSidebarCollapse = create<SidebarCollapseState>()((set, get) => ({
  collapsed: load(),
  setCollapsed: (collapsed) => {
    set({ collapsed })
    save(collapsed)
  },
  toggle: () => {
    const next = !get().collapsed
    set({ collapsed: next })
    save(next)
  },
}))

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
    !!target.closest('[contenteditable]:not([contenteditable="false"])'))

/** ⌘\ / Ctrl+\ toggles the conversation sidebar when the workbench is not handling the shortcut. */
export function useSidebarShortcut(active: boolean) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'Backslash') {
        e.preventDefault()
        useSidebarCollapse.getState().toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
