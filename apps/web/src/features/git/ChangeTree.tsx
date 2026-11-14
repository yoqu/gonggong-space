import type { GitChange, GitConflict } from '@gonggong/protocol'
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { create } from 'zustand'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Checkbox, ContextMenu, FileIcon, Icon, type MenuItem } from '../../ui'
import { type DiffNode, diffTree } from '../diff/patch'
import './changes.css'

const LAYOUT_KEY = 'gg.git.treeLayout'

/** How git change trees list files: grouped by directory (IDEA's default) or flat; kept across visits. */
export const useChangeLayout = create<{ layout: 'tree' | 'list'; toggle: () => void }>((set) => ({
  layout: localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'tree',
  toggle: () =>
    set((s) => {
      const layout = s.layout === 'tree' ? 'list' : 'tree'
      localStorage.setItem(LAYOUT_KEY, layout)
      return { layout }
    }),
}))

/** A row of the tree: a change, an untracked file, or (with `conflict`) an unmerged path. */
export interface TreeChange {
  path: string
  change: GitChange['change']
  oldPath?: string | null
  untracked?: boolean
  add?: number | null
  del?: number | null
  conflict?: GitConflict
}

export interface ChangeGroup {
  key: string
  label: string
  changes: TreeChange[]
  /** Its files have commit checkboxes. */
  checkable?: boolean
}

/** What a context menu or an action is about: one file, a folder's files or a group's, or the files selected. */
export interface ChangeTarget {
  changes: TreeChange[]
  /** The file right-clicked, when it was one. */
  file: TreeChange | null
}

/** A rename is committed (or rolled back) on both sides: the old path's removal and the new one. */
export const commitPaths = (changes: TreeChange[]) =>
  changes.flatMap((c) => (c.oldPath ? [c.oldPath, c.path] : [c.path]))

/** IDEA's file status colours and letters. */
export function statusOf(c: TreeChange): { tone: string; letter: string; label: string } {
  if (c.conflict) return { tone: 'conflict', letter: 'C', label: t('冲突') }
  if (c.untracked) return { tone: 'untracked', letter: 'U', label: t('未跟踪') }
  switch (c.change) {
    case 'added':
      return { tone: 'added', letter: 'A', label: t('新增') }
    case 'deleted':
      return { tone: 'deleted', letter: 'D', label: t('删除') }
    case 'renamed':
      return { tone: 'renamed', letter: 'R', label: t('重命名#renamed') }
    default:
      return { tone: 'modified', letter: 'M', label: t('修改') }
  }
}

/** What each side of a merge did to a conflicted file (IDEA's Conflicts dialog columns). */
const CONFLICT_SIDE: Record<GitConflict['ours'], string> = {
  modified: t('修改'),
  added: t('新增'),
  deleted: t('删除'),
}

const filesOf = (n: DiffNode<TreeChange>): TreeChange[] =>
  n.kind === 'file' ? [n.file] : n.children.flatMap(filesOf)
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** Every folder path of the groups' trees, for 全部折叠. */
export function folderPaths(groups: ChangeGroup[]): string[] {
  const out: string[] = []
  const walk = (key: string, nodes: DiffNode<TreeChange>[]) => {
    for (const n of nodes)
      if (n.kind === 'dir') {
        out.push(`${key}:${n.path}`)
        walk(key, n.children)
      }
  }
  for (const g of groups) {
    out.push(`${g.key}:`)
    walk(g.key, diffTree(g.changes))
  }
  return out
}

/** A row, as rendered and as the keys walk them: a group, a folder or a file. */
interface Row {
  /** As the rendered row's `data-gt-row`. */
  key: string
  group: ChangeGroup
  depth: number
  /** The file, or every file under the folder or group. */
  files: TreeChange[]
  file?: TreeChange
  /** A file of the flat list, shown with its folder. */
  flat?: boolean
  /** A folder's node (tree layout). */
  dir?: DiffNode<TreeChange> & { kind: 'dir' }
  /** The `closed` key folding it (folders and groups). */
  fold?: string
  parent: string | null
}

const fileRowKey = (g: ChangeGroup, c: TreeChange) => `f|${g.key}:${c.path}`

/** The rows shown, top to bottom. */
function visibleRows(groups: ChangeGroup[], layout: 'tree' | 'list', closed: ReadonlySet<string>): Row[] {
  const out: Row[] = []
  const file = (group: ChangeGroup, c: TreeChange, parent: string, depth: number) =>
    out.push({
      key: fileRowKey(group, c),
      group,
      depth,
      files: [c],
      file: c,
      flat: layout === 'list',
      parent,
    })
  const walk = (group: ChangeGroup, nodes: DiffNode<TreeChange>[], parent: string, depth: number) => {
    for (const n of nodes) {
      if (n.kind === 'file') {
        file(group, n.file, parent, depth)
        continue
      }
      const fold = `${group.key}:${n.path}`
      out.push({ key: `d|${fold}`, group, depth, files: filesOf(n), dir: n, fold, parent })
      if (!closed.has(fold)) walk(group, n.children, `d|${fold}`, depth + 1)
    }
  }
  for (const g of groups) {
    if (!g.changes.length) continue
    const key = `g|${g.key}`
    out.push({ key, group: g, depth: 0, files: g.changes, fold: `${g.key}:`, parent: null })
    if (closed.has(`${g.key}:`)) continue
    if (layout === 'list') for (const c of g.changes) file(g, c, key, 1)
    else walk(g, diffTree(g.changes), key, 1)
  }
  return out
}

/** Every row is 24px high (changes.css), so a long tree renders only the rows in view. */
const ROW_HEIGHT = 24
/** Shorter trees render every row. */
const WINDOW_FROM = 200
const OVERSCAN = 30

const scrollParent = (el: HTMLElement) => {
  for (let p = el.parentElement; p; p = p.parentElement)
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
}

/**
 * The rows `[from, to)` of `count` that the list's scrolling ancestor shows, with some to spare; null renders them all
 * (a short list, or no layout to measure).
 */
function useRowWindow(list: RefObject<HTMLElement | null>, count: number) {
  const [range, setRange] = useState<[number, number] | null>(null)
  const scroller = useRef<HTMLElement | null>(null)
  const windowed = count >= WINDOW_FROM
  useLayoutEffect(() => {
    const el = list.current
    const parent = windowed && el ? scrollParent(el) : null
    scroller.current = parent
    if (!el || !parent) return setRange(null)
    const update = () => {
      const height = parent.clientHeight
      if (!height) return setRange(null)
      const top = parent.getBoundingClientRect().top - el.getBoundingClientRect().top
      const from = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN)
      const to = Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN
      setRange((r) => (r && r[0] === from && r[1] === to ? r : [from, to]))
    }
    update()
    parent.addEventListener('scroll', update, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(parent)
    return () => {
      parent.removeEventListener('scroll', update)
      resize?.disconnect()
    }
  }, [list, windowed])
  return { range: windowed ? range : null, scroller }
}

/** Every file in the order the tree lists them, folders unfolded: the order F7 and ⌥⇧→ step through. */
export const fileOrder = (groups: ChangeGroup[], layout: 'tree' | 'list') =>
  visibleRows(groups, layout, new Set()).flatMap((r) => (r.file ? [r.file] : []))

const rowEl = (tree: HTMLElement, key: string) =>
  [...tree.querySelectorAll<HTMLElement>('[data-gt-row]')].find((r) => r.dataset.gtRow === key)

/** Moves the keyboard focus to a row's button, scrolled into view. */
function focusRow(tree: HTMLElement, key: string) {
  const button = rowEl(tree, key)?.querySelector<HTMLElement>('button')
  button?.focus()
  button?.scrollIntoView?.({ block: 'nearest' })
}

/**
 * IDEA's change tree: groups (更改 / 未跟踪的文件 / 冲突) of files as `/` folders or a flat list, each file in its status
 * colour with its line counts; checkboxes pick files for a commit. A click or ↑↓ selects (with `onSelection`, ⌘ / ⇧
 * clicks, ⇧↑↓ and ⌘A select several), a double click or Enter opens, ← folds or goes up to the folder, → unfolds,
 * Space checks the selected files.
 */
export function ChangeTree({
  groups,
  layout,
  selected,
  selection,
  onSelect,
  onSelection,
  onOpen,
  checked,
  onCheck,
  closed,
  onToggleFolder,
  menu,
  onMenu,
  onKeyDown,
  label,
}: {
  groups: ChangeGroup[]
  layout: 'tree' | 'list'
  /** The file shown: the one last clicked or moved to. */
  selected: string | null
  /** Every file selected, `selected` among them. */
  selection?: ReadonlySet<string>
  onSelect: (c: TreeChange) => void
  /** Selecting several: the files now selected. */
  onSelection?: (paths: ReadonlySet<string>) => void
  /** Double click or Enter: the diff in its own tab, a conflict's merge. */
  onOpen?: (c: TreeChange) => void
  /** Checked paths (of checkable groups). */
  checked?: ReadonlySet<string>
  onCheck?: (paths: string[], on: boolean) => void
  /** Folded `group:path` keys ('group:' folds the group). */
  closed: ReadonlySet<string>
  onToggleFolder: (key: string) => void
  menu?: (target: ChangeTarget) => MenuItem[]
  onMenu?: (value: string, target: ChangeTarget) => void
  /** The view's own keys, tried first: preventing a key's default takes it. */
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
  label: string
}) {
  const [target, setTarget] = useState<ChangeTarget | null>(null)
  // Where a ⇧ range starts: the file last picked without ⇧.
  const anchor = useRef<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const shown = useMemo(() => visibleRows(groups, layout, closed), [groups, layout, closed])
  const { range, scroller } = useRowWindow(listRef, shown.length)
  // A row the keys moved to while out of view: focused once scrolled in.
  const pending = useRef<string | null>(null)
  useEffect(() => {
    const tree = listRef.current
    if (pending.current && tree && rowEl(tree, pending.current)) {
      focusRow(tree, pending.current)
      pending.current = null
    }
  })
  const listed = groups.flatMap((g) => g.changes)
  const isSelected = (path: string) => path === selected || !!selection?.has(path)
  const selectedFiles = () => listed.filter((c) => isSelected(c.path))
  const indent = (depth: number) => ({ '--depth': depth }) as CSSProperties

  /** Focuses a row, first scrolling it into the rendered window when it is out of it. */
  const reveal = (tree: HTMLElement, key: string) => {
    const at = shown.findIndex((r) => r.key === key)
    const parent = scroller.current
    const list = listRef.current
    if (rowEl(tree, key) || !parent || !list || at < 0) return focusRow(tree, key)
    pending.current = key
    const offset = list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
    parent.scrollTop = offset + at * ROW_HEIGHT - parent.clientHeight / 2
  }

  /** Selects `c` alone, adds or drops it (⌘), or every file from the anchor to it (⇧). */
  const pick = (c: TreeChange, how: 'one' | 'toggle' | 'range') => {
    const mode = onSelection ? how : 'one'
    if (mode === 'range') {
      const paths = shown.flatMap((r) => (r.file ? [r.file.path] : []))
      const from = paths.indexOf(anchor.current ?? selected ?? c.path)
      const to = paths.indexOf(c.path)
      onSelection?.(new Set(from < 0 ? [c.path] : paths.slice(Math.min(from, to), Math.max(from, to) + 1)))
      return onSelect(c)
    }
    anchor.current = c.path
    if (mode === 'one') {
      onSelection?.(new Set([c.path]))
      return onSelect(c)
    }
    const next = new Set(selectedFiles().map((x) => x.path))
    if (next.has(c.path) && next.size > 1) {
      next.delete(c.path)
      onSelection?.(next)
      const lead = listed.find((x) => x.path === [...next].at(-1))
      if (lead) onSelect(lead)
      return
    }
    next.add(c.path)
    onSelection?.(next)
    onSelect(c)
  }

  /** `name`: what the checkbox picks (a file or folder path, a group's label). */
  const check = (paths: string[], all: boolean, g: ChangeGroup, name: string) =>
    g.checkable && checked && onCheck ? (
      <Checkbox
        checked={all}
        indeterminate={!all && paths.some((p) => checked.has(p))}
        onChange={(on) => onCheck(paths, on)}
        label={<span className="git-sr">{t('选择 {path}', { path: name })}</span>}
      />
    ) : null

  const fileRow = (g: ChangeGroup, c: TreeChange, depth: number, flat: boolean): ReactNode => {
    const s = statusOf(c)
    const dir = flat ? dirOf(c.path) : ''
    return (
      <li
        key={`${g.key}:${c.path}`}
        className="gt-row"
        style={indent(depth)}
        data-gt-file={`${g.key}:${c.path}`}
        data-gt-row={fileRowKey(g, c)}
      >
        {check([c.path], !!checked?.has(c.path), g, c.path)}
        <button
          type="button"
          className={cx('gt-file', `gt-file--${s.tone}`)}
          aria-current={c.path === selected || undefined}
          data-selected={isSelected(c.path) || undefined}
          aria-label={t('{status}：{path}', { status: s.label, path: c.path })}
          title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
          onClick={(e) => {
            // The keys work from the focused row, and Safari leaves a clicked button unfocused.
            e.currentTarget.focus()
            pick(c, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'one')
          }}
          onDoubleClick={() => onOpen?.(c)}
        >
          <FileIcon name={nameOf(c.path)} size={14} />
          <span className="gt-file__name">{nameOf(c.path)}</span>
          {dir ? <span className="gt-file__dir">{dir}</span> : null}
          {c.oldPath && !flat ? <span className="gt-file__dir">← {nameOf(c.oldPath)}</span> : null}
          {c.conflict ? (
            <span className="gt-file__dir">
              {t('你的：{ours} · 他们的：{theirs}', {
                ours: CONFLICT_SIDE[c.conflict.ours],
                theirs: CONFLICT_SIDE[c.conflict.theirs],
              })}
            </span>
          ) : null}
          <span className="spacer" />
          {c.add || c.del ? (
            <span className="gt-file__stat">
              {c.add ? <span className="gt-file__add">+{c.add}</span> : null}
              {c.del ? <span className="gt-file__del">−{c.del}</span> : null}
            </span>
          ) : null}
          <span className="gt-file__mark" aria-hidden="true">
            {s.letter}
          </span>
        </button>
      </li>
    )
  }

  const folderRow = (r: Row): ReactNode => {
    const fold = r.fold ?? ''
    const open = !closed.has(fold)
    const paths = r.files.map((f) => f.path)
    const all = !!checked && paths.every((p) => checked.has(p))
    const group = !r.dir
    return (
      <li
        key={r.key}
        className={cx('gt-row', group && 'gt-row--group')}
        style={indent(r.depth)}
        data-gt-group={group ? r.group.key : undefined}
        data-gt-dir={group ? undefined : fold}
        data-gt-row={r.key}
      >
        {check(paths, all, r.group, r.dir ? r.dir.path : r.group.label)}
        <button
          type="button"
          className={cx('gt-folder', group && 'gt-folder--group')}
          aria-expanded={open}
          onClick={() => onToggleFolder(fold)}
        >
          <span className={cx('ui-disclosure', open && 'ui-disclosure--open')}>
            <Icon name="chevron-right" weight={2} size={10} />
          </span>
          {r.dir ? (
            <>
              <Icon name={open ? 'folder-open' : 'folder'} size={14} />
              <span className="gt-file__name">{r.dir.name}</span>
              <span className="gt-folder__count">{r.files.length}</span>
            </>
          ) : (
            <>
              <span className="gt-group__label">{r.group.label}</span>
              <span className="gt-folder__count">{t('{n} 个文件', { n: r.files.length })}</span>
            </>
          )}
        </button>
      </li>
    )
  }

  const targetOf = (el: HTMLElement): ChangeTarget | null => {
    const fileKey = el.closest<HTMLElement>('[data-gt-file]')?.dataset.gtFile
    if (fileKey) {
      const c = shown.find((r) => r.file && `${r.group.key}:${r.file.path}` === fileKey)?.file
      return c ? { changes: [c], file: c } : null
    }
    const dir = el.closest<HTMLElement>('[data-gt-dir]')?.dataset.gtDir
    const groupKey = el.closest<HTMLElement>('[data-gt-group]')?.dataset.gtGroup
    if (dir) {
      const [gk, ...rest] = dir.split(':')
      const prefix = rest.join(':')
      const g = groups.find((x) => x.key === gk)
      return g ? { changes: g.changes.filter((c) => c.path.startsWith(`${prefix}/`)), file: null } : null
    }
    const g = groups.find((x) => x.key === groupKey)
    return g ? { changes: g.changes, file: null } : null
  }

  const keyDown = (e: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    const tree = e.currentTarget
    // The row with the focus (its button or checkbox), else the selected file.
    const own = (e.target as HTMLElement).closest<HTMLElement>('[data-gt-row]')?.dataset.gtRow
    const at = shown.findIndex((r) => (own ? r.key === own : r.file?.path === selected))
    const row = shown[at]
    const go = (i: number) => {
      const next = shown[Math.max(0, Math.min(shown.length - 1, i))]
      if (!next) return
      if (next.file) pick(next.file, e.shiftKey ? 'range' : 'one')
      reveal(tree, next.key)
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? 0 : at - 1)
    else if (e.key === 'ArrowRight' && row?.fold) {
      if (closed.has(row.fold)) onToggleFolder(row.fold)
      else go(at + 1)
    } else if (e.key === 'ArrowLeft' && row) {
      if (row.fold && !closed.has(row.fold)) onToggleFolder(row.fold)
      else if (row.parent) reveal(tree, row.parent)
    } else if (e.key === 'Enter' && row) {
      if (row.file) onOpen?.(row.file)
      else if (row.fold) onToggleFolder(row.fold)
    } else if (e.key === ' ' && row && checked && onCheck) {
      // A folder checks its files; a file the selection it belongs to, IDEA's toggle: all on unless all are.
      const files = row.file && isSelected(row.file.path) ? selectedFiles() : row.files
      const checkable = new Set(groups.flatMap((g) => (g.checkable ? g.changes : [])))
      const paths = files.filter((c) => checkable.has(c)).map((c) => c.path)
      if (!paths.length) return
      onCheck(paths, !paths.every((p) => checked.has(p)))
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && onSelection)
      // The shown file stays selected even when folded away.
      onSelection(
        new Set([...(selected ? [selected] : []), ...shown.flatMap((r) => (r.file ? [r.file.path] : []))]),
      )
    else return
    e.preventDefault()
  }

  const from = range ? Math.min(range[0], shown.length) : 0
  const to = range ? Math.min(range[1], shown.length) : shown.length
  const body = (
    <section
      className="gt"
      aria-label={label}
      onKeyDown={keyDown}
      onContextMenuCapture={(e: MouseEvent<HTMLElement>) => {
        // A right-clicked file becomes the selected one, as in IDEA; right-clicking one of several selected keeps them.
        const tg = targetOf(e.target as HTMLElement)
        if (tg?.file && isSelected(tg.file.path) && (selection?.size ?? 0) > 1) {
          onSelect(tg.file)
          setTarget({ changes: selectedFiles(), file: tg.file })
          return
        }
        if (tg?.file) pick(tg.file, 'one')
        setTarget(tg?.file ? { changes: [tg.file], file: tg.file } : tg)
      }}
      onKeyDownCapture={(e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
        const tg = targetOf(e.target as HTMLElement)
        if (tg?.file && isSelected(tg.file.path) && (selection?.size ?? 0) > 1) {
          onSelect(tg.file)
          setTarget({ changes: selectedFiles(), file: tg.file })
          return
        }
        if (tg?.file) pick(tg.file, 'one')
        setTarget(tg?.file ? { changes: [tg.file], file: tg.file } : tg)
      }}
    >
      <ul className="gt-list" ref={listRef}>
        {from > 0 ? <li aria-hidden="true" style={{ height: from * ROW_HEIGHT }} /> : null}
        {shown
          .slice(from, to)
          .map((r) => (r.file ? fileRow(r.group, r.file, r.depth, !!r.flat) : folderRow(r)))}
        {to < shown.length ? (
          <li aria-hidden="true" style={{ height: (shown.length - to) * ROW_HEIGHT }} />
        ) : null}
      </ul>
    </section>
  )
  if (!menu) return body
  return (
    <ContextMenu items={target ? menu(target) : []} onSelect={(v) => target && onMenu?.(v, target)}>
      {body}
    </ContextMenu>
  )
}
