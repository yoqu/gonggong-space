import type { Attachment, DiffScope } from '@gonggong/protocol'
import { create } from 'zustand'

/** Right-hand workbench of the chat page (docs/plan/预览工作台-设计.md): tabs per group, three space modes. */
/** 1-based inclusive line range of a file. */
export interface LineRange {
  from: number
  to: number
}

export type WorkbenchTab =
  | { kind: 'web'; previewId: string; path: string }
  | { kind: 'miniprogram'; previewId: string }
  | { kind: 'live'; previewId: string }
  | { kind: 'run'; runId: string; view: 'process' | 'diff' | 'audit'; file: string | null }
  | { kind: 'diff'; botId: string; scope: DiffScope; file: string | null; repo?: string | null }
  | {
      kind: 'files'
      botId: string
      dir: string
      selected: string | null
      /** Version browsed: a branch or commit; absent/null = the work tree. */
      rev?: string | null
      /** Compare mode: the branch or commit changes are marked against. */
      base?: string | null
      changedOnly?: boolean
    }
  | {
      kind: 'file'
      /** `annotate` shows who changed each line (IDEA's Annotate), anew each time it changes. */
      source:
        | { botId: string; path: string; line?: LineRange; rev?: string; annotate?: number }
        | { attachment: Attachment; from: string }
    }
  /**
   * A bot workspace's commit history (IDEA's Git Log): `ref` null = HEAD, `commit` the one opened, `file` its file shown
   * (null = first); `repo` a sub-repo; `path` a file's or folder's history; `filter` the log filters set. `scope` is the
   * repo and path it was opened on (see logScope), fixed while its filters change: each scope is a tab of its own.
   */
  | {
      kind: 'git-log'
      botId: string
      scope?: string | null
      ref: string | null
      commit: string | null
      file?: string | null
      repo?: string | null
      path?: string | null
      filter?: GitLogTabFilter | null
    }
  /**
   * A bot workspace's source control (IDEA's Commit window and Git Log in one): `view` the pane shown, `file` the change
   * shown, `log` the log's state; `repo` a sub-repo.
   */
  | {
      kind: 'git'
      botId: string
      file?: string | null
      repo?: string | null
      view?: GitTabView | null
      log?: GitLogState | null
    }
  /** Two versions of a bot's repo side by side: commits on either side and the files that differ; `to` null = the work tree. */
  | {
      kind: 'git-compare'
      botId: string
      repo?: string | null
      from: string
      to: string | null
      file?: string | null
      /** The commit whose details are shown under the commits. */
      commit?: string | null
    }
  /** The three-way merge of one conflicted file. */
  | { kind: 'git-merge'; botId: string; repo?: string | null; path: string }
  /** A third-party page pinned in the group's tab bar (群标签栏). */
  | { kind: 'link'; url: string; title: string }
  | { kind: 'knowledge'; knowledgeId: string; title: string }
  /** A hosted artifact's canvas (docs/plan/原型编辑器-Stitch对标-开发计划.md); `title` until its details load. */
  | { kind: 'artifact'; artifactId: string; title: string }
  /** A daemon-owned shell; closing this tab only detaches its browser socket. */
  | { kind: 'terminal'; botId: string; sessionId?: string }

/** The scope a log tab is opened on: none for a bot's root log, else its repo and path. */
export const logScope = (repo: string | null | undefined, path: string | null | undefined) =>
  repo || path ? `${repo ?? ''}:${path ?? ''}` : null

export type GitTabView = 'commit' | 'log' | 'stash'

/** The Git tab's log: as a log tab's fields, its repo the tab's. */
export type GitLogState = Pick<
  Extract<WorkbenchTab, { kind: 'git-log' }>,
  'ref' | 'commit' | 'file' | 'path' | 'filter'
>

/** What the Git Log tab filters by (all combined); dates are ISO days. */
export interface GitLogTabFilter {
  all?: boolean
  author?: string
  text?: string
  regexp?: boolean
  matchCase?: boolean
  since?: string
  until?: string
  firstParent?: boolean
  noMerges?: boolean
  order?: 'date' | 'topo'
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
  /** Puts `tab` in the place of the tab at `key`, e.g. a change of what makes its key; a tab it now equals goes. */
  replace: (key: string, tab: WorkbenchTab, groupId?: string) => void
  closeTab: (key: string) => void
  closeOthers: (key: string) => void
  closeAll: () => void
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
    case 'miniprogram':
      return `mp:${t.previewId}`
    case 'live':
      return `live:${t.previewId}`
    case 'run':
      return `run:${t.runId}`
    case 'diff':
      return `diff:${t.botId}`
    case 'files':
      return `files:${t.botId}`
    case 'file':
      return 'attachment' in t.source
        ? `att:${t.source.attachment.id}`
        : `file:${t.source.botId}:${t.source.path}${t.source.rev ? `@${t.source.rev}` : ''}`
    case 'git-log':
      return t.scope ? `git-log:${t.botId}:${t.scope}` : `git-log:${t.botId}`
    case 'git':
      return `git:${t.botId}`
    case 'git-compare':
      return `git-compare:${t.botId}:${t.repo ?? ''}:${t.from}:${t.to ?? ''}`
    case 'git-merge':
      return `git-merge:${t.botId}:${t.repo ?? ''}:${t.path}`
    case 'link':
      return `link:${t.url}`
    case 'knowledge':
      return `kb:${t.knowledgeId}`
    case 'artifact':
      return `artifact:${t.artifactId}`
    case 'terminal':
      return `terminal:${t.botId}`
  }
}

/** Tabs showing a page in an iframe: only the most recently used stay mounted. */
export const isFrameKey = (key: string) => key.startsWith('web:') || key.startsWith('link:')

const empty = (): Bench => ({ tabs: [], active: null, used: {} })

type Saved = Pick<WorkbenchState, 'open' | 'mode' | 'benches'>

const load = (): Partial<Saved> => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Partial<Saved>
  } catch {
    return {}
  }
}

const save = (s: Saved) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ open: s.open, mode: s.mode, benches: s.benches }))
  } catch {
    // storage unavailable (private mode): tabs last for this page only
  }
}

/** Keys of the web tabs whose iframe stays mounted: the `LIVE_FRAMES` most recently used. */
export function liveFrames(bench: Bench): Set<string> {
  const web = bench.tabs.map(tabKey).filter(isFrameKey)
  web.sort((a, b) => (bench.used[b] ?? 0) - (bench.used[a] ?? 0))
  return new Set(web.slice(0, LIVE_FRAMES))
}

const saved = load()

export const useWorkbench = create<WorkbenchState>()((set, get) => {
  const update = (fn: (b: Bench) => Bench, extra: Partial<WorkbenchState> = {}, target?: string) => {
    const { groupId: current, benches } = get()
    const groupId = target ?? current
    if (!groupId) return
    const next = { ...benches, [groupId]: fn(benches[groupId] ?? empty()) }
    set({ benches: next, ...extra })
    save({ ...get(), benches: next })
  }
  return {
    groupId: null,
    open: saved.open === true,
    mode: saved.mode === 'focus' || saved.mode === 'split' ? saved.mode : 'split',
    previous: 'split',
    benches: saved.benches ?? {},
    setGroup: (groupId) => {
      const bench = groupId ? get().benches[groupId] : undefined
      set({ groupId, open: groupId ? !!bench?.tabs.length && get().open : get().open })
    },
    show: (tab) => {
      const key = tabKey(tab)
      const { open, mode, groupId, benches } = get()
      const tabs = (groupId && benches[groupId]?.tabs) || []
      if (!groupId || (tabs.length >= WORKBENCH_MAX_TABS && !tabs.some((t) => tabKey(t) === key)))
        return false
      // A web page or a canvas needs the room: it folds the conversation list (design §10.1).
      const page = tab.kind === 'web' || tab.kind === 'link' || tab.kind === 'artifact'
      const nextMode = page && mode === 'split' ? 'focus' : mode
      update(
        (b) => {
          const at = b.tabs.findIndex((t) => tabKey(t) === key)
          const tabs = at >= 0 ? b.tabs.map((t, i) => (i === at ? tab : t)) : [...b.tabs, tab]
          return { tabs, active: key, used: { ...b.used, [key]: Date.now() } }
        },
        { open: true, mode: open ? nextMode : page ? 'focus' : nextMode },
      )
      return true
    },
    activate: (key) => update((b) => ({ ...b, active: key, used: { ...b.used, [key]: Date.now() } })),
    patch: (key, fields) =>
      update((b) => ({
        ...b,
        tabs: b.tabs.map((t) => (tabKey(t) === key ? ({ ...t, ...fields } as WorkbenchTab) : t)),
      })),
    replace: (key, tab, groupId) =>
      update(
        (b) => {
          const next = tabKey(tab)
          const tabs = b.tabs.flatMap((t) => {
            const k = tabKey(t)
            return k === key ? [tab] : k === next ? [] : [t]
          })
          const { [key]: at, ...used } = b.used
          return {
            tabs,
            active: b.active === key ? next : b.active,
            used: { ...used, [next]: at ?? Date.now() },
          }
        },
        {},
        groupId,
      ),
    closeTab: (key) => {
      update((b) => {
        const at = b.tabs.findIndex((t) => tabKey(t) === key)
        const tabs = b.tabs.filter((t) => tabKey(t) !== key)
        const { [key]: _, ...used } = b.used
        const neighbour = tabs[Math.min(at, tabs.length - 1)]
        const active = b.active === key ? (neighbour ? tabKey(neighbour) : null) : b.active
        return { tabs, active, used }
      })
      const { groupId, benches } = get()
      // Closing the last tab hides the workbench; an empty one is only shown when asked for (to add a tab).
      if (groupId && !benches[groupId]?.tabs.length) {
        set({ open: false })
        save(get())
      }
    },
    closeAll: () => update(empty, { open: false }),
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
    setOpen: (open) => {
      set({ open })
      save(get())
    },
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
