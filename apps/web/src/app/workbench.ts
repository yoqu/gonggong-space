import type { Attachment, DiffScope } from '@gonggong/protocol'
import { create } from 'zustand'

/** Right-hand workbench of the chat page (docs/plan/预览工作台-设计.md): tabs per group, three space modes. */
export type WorkbenchTab =
  | { kind: 'web'; previewId: string; path: string }
  | { kind: 'run'; runId: string; view: 'process' | 'diff' | 'audit'; file: string | null }
  | { kind: 'diff'; botId: string; scope: DiffScope; file: string | null }
  | { kind: 'files'; botId: string; dir: string; selected: string | null }
  | {
      kind: 'file'
      source: { botId: string; path: string } | { attachment: Attachment; from: string }
    }

export type WorkbenchMode = 'split' | 'focus' | 'full'

interface Bench {
  tabs: WorkbenchTab[]
  active: string | null
  /** Last activation time per tab key: the least recently used web tabs sleep (their iframe unmounts). */
  used: Record<string, number>
}

interface WorkbenchState {
  groupId: string | null
  open: boolean
  mode: WorkbenchMode
  /** The mode left by 全屏, for Esc. */
  previous: WorkbenchMode
  benches: Record<string, Bench>
  setGroup: (groupId: string | null) => void
  /** Opens or focuses `tab` (deduped by `tabKey`) in the current group and shows the workbench; false when full. */
  show: (tab: WorkbenchTab) => boolean
  activate: (key: string) => void
  /** Merges fields into an open tab (same kind), e.g. the picked file or the entered path. */
  patch: (key: string, fields: Partial<WorkbenchTab>) => void
  closeTab: (key: string) => void
  closeOthers: (key: string) => void
  reorder: (from: number, to: number) => void
  setOpen: (open: boolean) => void
  setMode: (mode: WorkbenchMode) => void
}

export const WORKBENCH_MAX_TABS = 12
export const LIVE_FRAMES = 4
const STORE_KEY = 'gonggong.workbench'

export function tabKey(t: WorkbenchTab): string {
  switch (t.kind) {
    case 'web':
      return `web:${t.previewId}`
    case 'run':
      return `run:${t.runId}`
    case 'diff':
      return `diff:${t.botId}`
    case 'files':
      return `files:${t.botId}`
    case 'file':
      return 'attachment' in t.source
        ? `att:${t.source.attachment.id}`
        : `file:${t.source.botId}:${t.source.path}`
  }
}

const empty = (): Bench => ({ tabs: [], active: null, used: {} })

type Saved = Pick<WorkbenchState, 'mode' | 'benches'>

const load = (): Partial<Saved> => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Partial<Saved>
  } catch {
    return {}
  }
}

const save = (s: Saved) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ mode: s.mode, benches: s.benches }))
  } catch {
    // storage unavailable (private mode): tabs last for this page only
  }
}

/** Keys of the web tabs whose iframe stays mounted: the `LIVE_FRAMES` most recently used. */
export function liveFrames(bench: Bench): Set<string> {
  const web = bench.tabs.map(tabKey).filter((k) => k.startsWith('web:'))
  web.sort((a, b) => (bench.used[b] ?? 0) - (bench.used[a] ?? 0))
  return new Set(web.slice(0, LIVE_FRAMES))
}

const saved = load()

export const useWorkbench = create<WorkbenchState>()((set, get) => {
  const update = (fn: (b: Bench) => Bench, extra: Partial<WorkbenchState> = {}) => {
    const { groupId, benches } = get()
    if (!groupId) return
    const next = { ...benches, [groupId]: fn(benches[groupId] ?? empty()) }
    set({ benches: next, ...extra })
    save({ ...get(), benches: next })
  }
  return {
    groupId: null,
    open: false,
    mode: saved.mode === 'focus' || saved.mode === 'split' ? saved.mode : 'split',
    previous: 'split',
    benches: saved.benches ?? {},
    setGroup: (groupId) => {
      const bench = groupId ? get().benches[groupId] : undefined
      set({ groupId, open: !!bench?.tabs.length && get().open })
    },
    show: (tab) => {
      const key = tabKey(tab)
      const { open, mode, groupId, benches } = get()
      const tabs = (groupId && benches[groupId]?.tabs) || []
      if (!groupId || (tabs.length >= WORKBENCH_MAX_TABS && !tabs.some((t) => tabKey(t) === key)))
        return false
      // A web page needs the room: it folds the conversation list (design §10.1).
      const nextMode = tab.kind === 'web' && mode === 'split' ? 'focus' : mode
      update(
        (b) => {
          const at = b.tabs.findIndex((t) => tabKey(t) === key)
          const tabs = at >= 0 ? b.tabs.map((t, i) => (i === at ? tab : t)) : [...b.tabs, tab]
          return { tabs, active: key, used: { ...b.used, [key]: Date.now() } }
        },
        { open: true, mode: open ? nextMode : tab.kind === 'web' ? 'focus' : nextMode },
      )
      return true
    },
    activate: (key) => update((b) => ({ ...b, active: key, used: { ...b.used, [key]: Date.now() } })),
    patch: (key, fields) =>
      update((b) => ({
        ...b,
        tabs: b.tabs.map((t) => (tabKey(t) === key ? ({ ...t, ...fields } as WorkbenchTab) : t)),
      })),
    closeTab: (key) =>
      update((b) => {
        const at = b.tabs.findIndex((t) => tabKey(t) === key)
        const tabs = b.tabs.filter((t) => tabKey(t) !== key)
        const { [key]: _, ...used } = b.used
        const neighbour = tabs[Math.min(at, tabs.length - 1)]
        const active = b.active === key ? (neighbour ? tabKey(neighbour) : null) : b.active
        return { tabs, active, used }
      }),
    closeOthers: (key) =>
      update((b) => ({
        tabs: b.tabs.filter((t) => tabKey(t) === key),
        active: key,
        used: { [key]: b.used[key] ?? Date.now() },
      })),
    reorder: (from, to) =>
      update((b) => {
        const tabs = [...b.tabs]
        const [moved] = tabs.splice(from, 1)
        if (moved) tabs.splice(to, 0, moved)
        return { ...b, tabs }
      }),
    setOpen: (open) => set({ open }),
    setMode: (mode) => {
      const { mode: current } = get()
      set({ mode, previous: mode === 'full' ? current : get().previous })
      save(get())
    },
  }
})

/** The current group's tabs, active key and live frames. */
export function useBench() {
  const bench = useWorkbench((s) => (s.groupId ? s.benches[s.groupId] : undefined))
  return bench ?? empty()
}
