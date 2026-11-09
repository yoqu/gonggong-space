import type { FileTreeEntry } from '@gonggong/protocol'

/** Paging through the files of one folder (Quick Look's ←/→); no wrap-around at either end. */
export interface FileNav {
  prev: string | null
  next: string | null
  /** 0-based place among `total`. */
  index: number
  total: number
  go: (path: string) => void
}

export const sortEntries = (entries: FileTreeEntry[]) =>
  [...entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))

/** The files of a listing of `dir`, in the tree's order. */
export const filesOf = (dir: string, entries: FileTreeEntry[]) =>
  sortEntries(entries)
    .filter((e) => !e.dir)
    .map((e) => (dir ? `${dir}/${e.name}` : e.name))

// The viewer of the file paged to is mounted anew, so the direction it slides in from is handed over here.
let entering: { path: string; dir: 'prev' | 'next' } | null = null

/** `path`'s neighbours in `order`; null when it stands alone. */
export function fileNav(order: string[], path: string, open: (path: string) => void): FileNav | null {
  const at = order.indexOf(path)
  if (at < 0 || order.length < 2) return null
  return {
    prev: order[at - 1] ?? null,
    next: order[at + 1] ?? null,
    index: at,
    total: order.length,
    go: (to) => {
      entering = { path: to, dir: order.indexOf(to) < at ? 'prev' : 'next' }
      open(to)
    },
  }
}

/** The direction `path` was paged to from; read on mounting, then cleared, so opening it otherwise does not slide. */
export const enteringOf = (path: string) => (entering?.path === path ? entering.dir : undefined)
export const clearEntering = () => {
  entering = null
}

/** Elements that use the arrow keys themselves. */
const OWN_ARROWS = [
  'input',
  'textarea',
  'select',
  'video',
  'audio',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="tree"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="dialog"]',
].join(',')
/** Content the arrow keys scroll sideways, once clicked, when it is wider than the panel. */
const SCROLLERS = '.pv-lines, .fv-sheet__grid, .fv__media'

/** The sideways scroller a press on `target` gives the arrow keys to, as the browser does. */
export const scrollerAt = (target: EventTarget | null) =>
  target instanceof Element ? target.closest(SCROLLERS) : null

/**
 * Whether ←/→ pressed on `target` may page the viewer at `root`, rather than serve what has focus or `held`, the
 * scroller last pressed in it.
 */
export function arrowsFree(root: HTMLElement, target: EventTarget | null, held: Element | null) {
  if (root.closest('[hidden]') || !(target instanceof Element)) return false
  if (target !== document.body && !root.contains(target)) return false
  if (target.closest(OWN_ARROWS)) return false
  const sel = document.getSelection()
  if (sel && !sel.isCollapsed && root.contains(sel.anchorNode)) return false
  return !(held && root.contains(held) && held.scrollWidth > held.clientWidth + 1)
}
