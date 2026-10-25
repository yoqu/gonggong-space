import type { GitCommit } from '@gonggong/protocol'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../../i18n'
import { copyWithToast } from '../../../lib/clipboard'
import { fullTime } from '../../../lib/time'
import { Button, ContextMenu, EmptyState, type MenuItem, Spinner } from '../../../ui'
import { GraphCell } from '../GraphCell'
import { layoutGraph } from '../graph'
import { parseRefs } from '../refs'
import { commitDate } from './query'
import { RefLabels, refLabels } from './RefLabels'

/** How a click picks: ⌘/Ctrl adds or drops one commit, ⇧ the range from the last one clicked. */
export interface PickHow {
  add: boolean
  range: boolean
}

/** Columns of the table besides the subject, each of which can be hidden (IDEA's View Options). */
export type LogColumn = 'author' | 'date' | 'hash'

/** The nearest listed commit above `hash` that has it as a parent. */
export function childOf(commits: readonly GitCommit[], hash: string): GitCommit | null {
  const at = commits.findIndex((c) => c.hash === hash)
  for (let i = at - 1; i >= 0; i--) {
    const c = commits[i]
    if (c?.parents.includes(hash)) return c
  }
  return null
}

/**
 * IDEA's commit table: the graph and subject with its ref labels, author, date and short hash; merges dimmed. The keyboard
 * only moves the selection: ↑↓ rows, ← the parent, → the child (`onGo`; without it the table keeps its own), ⇧↑↓ widen
 * the picks (with `menu`); Enter opens (`onOpen`), ⌘C copies the hashes, ⌘F asks to go to a commit (`onFind`). The next
 * page loads as the end scrolls into view. With `menu`, a right click opens the actions of the commits `onMenuTarget`
 * returns. `reveal` scrolls its commit to the middle once listed.
 */
export function CommitTable({
  commits,
  remotes,
  partial,
  selected,
  picked,
  onPick,
  onGo,
  onOpen,
  onFind,
  reveal,
  hidden,
  mine,
  menu,
  onMenuTarget,
  onMenu,
  hasMore,
  loading,
  error,
  onMore,
  onRetry,
  empty,
  label,
}: {
  commits: GitCommit[]
  remotes: readonly string[]
  /** The list is part of the history (a filtered log): the graph only joins the commits listed. */
  partial: boolean
  selected: string | null
  picked: ReadonlySet<string>
  onPick: (hash: string, how: PickHow) => void
  onGo?: (hash: string) => void
  onOpen?: (hash: string) => void
  onFind?: () => void
  reveal?: { hash: string } | null
  hidden?: readonly LogColumn[]
  /** Commits made by the user, drawn bold. */
  mine?: (c: GitCommit) => boolean
  menu?: (hashes: string[]) => MenuItem[]
  onMenuTarget?: (hash: string) => string[]
  onMenu?: (value: string, hashes: string[]) => void
  hasMore: boolean
  loading: boolean
  error: string | null
  onMore: () => void
  onRetry: () => void
  empty: string
  label: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [menuFor, setMenuFor] = useState<string[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  // Without onGo the selection is the table's own: moving it never opens anything.
  const current = onGo ? selected : (cursor ?? selected)
  const rows = useMemo(() => {
    if (!partial) return layoutGraph(commits)
    const listed = new Set(commits.map((c) => c.hash))
    return layoutGraph(
      commits.map((c) => ({ hash: c.hash, parents: c.parents.filter((p) => listed.has(p)) })),
    )
  }, [commits, partial])

  useEffect(() => {
    if (!current) return
    const el = box.current?.querySelector<HTMLElement>(`[data-hash="${current}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
    if (box.current?.contains(document.activeElement)) el?.focus({ preventScroll: true })
  }, [current])

  // A commit gone to (⌘F, a branch) may only be listed once more pages load.
  const revealed = useRef<object | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a longer list may now hold the commit
  useEffect(() => {
    if (!reveal || revealed.current === reveal) return
    const el = box.current?.querySelector<HTMLElement>(`[data-hash="${reveal.hash}"]`)
    if (!el) return
    revealed.current = reveal
    el.scrollIntoView?.({ block: 'center' })
    el.focus({ preventScroll: true })
  }, [reveal, commits])

  const more = useRef(onMore)
  more.current = onMore
  // biome-ignore lint/correctness/useExhaustiveDependencies: a longer list re-observes the end, which may still show
  useEffect(() => {
    const el = end.current
    if (!el || !hasMore || loading || error) return
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && more.current(),
      {
        root: box.current,
        rootMargin: '0px 0px 320px 0px',
      },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, error, commits.length])

  const go = onGo ?? setCursor
  const pick = (hash: string) => onPick(hash, { add: false, range: false })
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset.hash
    let at = commits.findIndex((c) => c.hash === current)
    if (at < 0) at = commits.findIndex((c) => c.hash === focused)
    const cur = commits[at]
    const mod = e.metaKey || e.ctrlKey
    const to = (hash: string | undefined) => {
      if (!hash) return
      e.preventDefault()
      if (e.shiftKey && menu) onPick(hash, { add: false, range: true })
      else go(hash)
    }
    if (mod && e.key.toLowerCase() === 'f' && onFind) {
      e.preventDefault()
      onFind()
    } else if (mod && e.key.toLowerCase() === 'c') {
      const hashes = commits.filter((c) => picked.has(c.hash)).map((c) => c.hash)
      const copied = hashes.length ? hashes : cur ? [cur.hash] : []
      if (!copied.length) return
      e.preventDefault()
      void copyWithToast(copied.join(' '), t('已复制'))
    } else if (e.key === 'Enter' && cur) {
      e.preventDefault()
      ;(onOpen ?? pick)(cur.hash)
    } else if (e.key === 'ArrowDown') to(commits[Math.min(commits.length - 1, at + 1)]?.hash)
    else if (e.key === 'ArrowUp') to(commits[Math.max(0, at - 1)]?.hash)
    else if (e.key === 'Home') to(commits[0]?.hash)
    else if (e.key === 'End') to(commits.at(-1)?.hash)
    else if (e.key === 'ArrowLeft' && cur) to(cur.parents[0])
    else if (e.key === 'ArrowRight' && cur) to(childOf(commits, cur.hash)?.hash)
  }

  const isPicked = (hash: string) => picked.has(hash) || (!onGo && hash === cursor)
  const focusable = current && isPicked(current) ? current : commits[0]?.hash
  const shows = (col: LogColumn) => !hidden?.includes(col)
  const list = (
    <div
      role="listbox"
      tabIndex={-1}
      aria-label={label}
      aria-multiselectable={menu ? true : undefined}
      className="glog-list"
      onKeyDown={keyDown}
      onContextMenuCapture={(e) => {
        const hash = (e.target as HTMLElement).closest<HTMLElement>('[data-hash]')?.dataset.hash
        setMenuFor(hash && onMenuTarget ? onMenuTarget(hash) : null)
      }}
    >
      {commits.map((c, i) => {
        const row = rows[i]
        const merge = c.parents.length > 1
        return (
          <button
            key={c.hash}
            type="button"
            role="option"
            aria-selected={isPicked(c.hash)}
            tabIndex={c.hash === focusable ? 0 : -1}
            data-hash={c.hash}
            data-primary={c.hash === current || undefined}
            data-merge={merge || undefined}
            data-mine={mine?.(c) || undefined}
            className="glog-row"
            onClick={(e) => {
              if (!onGo) setCursor(c.hash)
              onPick(c.hash, { add: e.metaKey || e.ctrlKey, range: e.shiftKey })
            }}
          >
            <span className="glog-row__subject">
              {row ? (
                <span className="glog-row__graph">
                  <GraphCell row={row} merge={merge} />
                </span>
              ) : null}
              <span className="glog-row__text">{c.subject}</span>
              <RefLabels labels={refLabels(parseRefs(c.refs, remotes), remotes)} />
            </span>
            {shows('author') ? <span className="glog-row__author">{c.author}</span> : null}
            {shows('date') ? (
              <span className="glog-row__date" title={fullTime(c.at)}>
                {commitDate(c.at)}
              </span>
            ) : null}
            {shows('hash') ? <span className="glog-row__hash">{c.shortHash}</span> : null}
          </button>
        )
      })}
    </div>
  )
  return (
    <div ref={box} className="glog-table">
      {menu && onMenu ? (
        <ContextMenu items={menuFor ? menu(menuFor) : []} onSelect={(v) => menuFor && onMenu(v, menuFor)}>
          {list}
        </ContextMenu>
      ) : (
        list
      )}
      <div ref={end} className="glog-more">
        {error ? (
          <EmptyState
            compact
            icon="warning"
            title={t('无法读取提交历史')}
            description={error}
            action={
              <Button size="small" onClick={onRetry}>
                {t('重试')}
              </Button>
            }
          />
        ) : loading ? (
          <Spinner size={14} />
        ) : hasMore ? (
          <Button size="small" variant="plain" onClick={onMore}>
            {t('加载更多')}
          </Button>
        ) : !commits.length ? (
          <EmptyState compact icon="clock" title={empty} />
        ) : null}
      </div>
    </div>
  )
}
