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

export type DiffViewMode = 'unified' | 'split'
/** IDEA's Ignore modes: none, trim (`-b`), ignore (`-w`), ignore-blank (`-w --ignore-blank-lines`). */
export type DiffWhitespace = 'none' | 'trim' | 'ignore' | 'ignore-blank'
/** IDEA's Highlighting modes: changed words or characters, only the lines, or not even those. */
export type DiffHighlight = 'words' | 'chars' | 'lines' | 'none'

export interface DiffSettings {
  view: DiffViewMode
  /** What git diffs are read without. */
  whitespace: DiffWhitespace
  highlight: DiffHighlight
  /** Git diffs are read with the whole file as context. */
  fullContext: boolean
}

const VIEW_KEY = 'gonggong.diffView'
const WHITESPACE_KEY = 'gonggong.diffWhitespace'
/** Before the modes, ignoring whitespace was a flag. */
const OLD_WHITESPACE_KEY = 'gonggong.diffIgnoreWhitespace'
const HIGHLIGHT_KEY = 'gonggong.diffHighlight'
const FULL_KEY = 'gonggong.diffFullContext'

const WHITESPACES: DiffWhitespace[] = ['none', 'trim', 'ignore', 'ignore-blank']
const HIGHLIGHTS: DiffHighlight[] = ['words', 'chars', 'lines', 'none']
const stored = <T extends string>(key: string, all: T[], fallback: T) => {
  const v = localStorage.getItem(key) as T | null
  return v && all.includes(v) ? v : fallback
}

/** How diffs are shown and read, shared by every diff and kept across visits. */
export const useDiffSettings = create<DiffSettings & { set: (patch: Partial<DiffSettings>) => void }>(
  (setState) => ({
    view: localStorage.getItem(VIEW_KEY) === 'split' ? 'split' : 'unified',
    whitespace: stored(
      WHITESPACE_KEY,
      WHITESPACES,
      localStorage.getItem(OLD_WHITESPACE_KEY) === '1' ? 'ignore' : 'none',
    ),
    highlight: stored(HIGHLIGHT_KEY, HIGHLIGHTS, 'words'),
    fullContext: localStorage.getItem(FULL_KEY) === '1',
    set: (patch) =>
      setState((s) => {
        const next = { ...s, ...patch }
        localStorage.setItem(VIEW_KEY, next.view)
        localStorage.setItem(WHITESPACE_KEY, next.whitespace)
        localStorage.setItem(HIGHLIGHT_KEY, next.highlight)
        localStorage.setItem(FULL_KEY, next.fullContext ? '1' : '0')
        return patch
      }),
  }),
)
