import type { GitBranch, GitRefsDto, GitStatus, GitTag, RepoStatus } from '@gonggong/protocol'
import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { ago } from '../../lib/time'
import { Icon, type IconName, Menu, Popover, SearchField, Spinner, useEscape } from '../../ui'
import { useGitStamp } from '../diff/useWorkspaceDiff'
import { openTab } from '../workbench/open'
import { type GitTarget, refreshGit, refreshGitQuietly, repoStatus, useGitRefs } from './api'
import { actionItems, type PickedRef, refActions, runAction } from './branchActions'
import { gitCommands } from './commands'
import { repoLabel } from './GitToolbar'
import { type BranchNode, branchTree, loadFavorites, remoteGroups, saveFavorites } from './refs'
import './branches.css'

/**
 * IDEA's branch popup (the VCS widget): search, the top actions, a multi-repo workspace's repos, then recent, local,
 * remote branches and tags, `/` folders and starred favourites first. The keyboard stays in the search: ↑↓ move the
 * current row, Enter runs it or opens a branch's actions, → and ← (or Esc) go in and out of them. With room beside the
 * popup a branch's actions and a repo's branches open on the right (actions on hover too), else they take the list's
 * place, so several repos can be looked through without leaving the list.
 */
export function BranchPopup({
  target,
  status,
  git,
  onRepo,
  children,
}: {
  target: GitTarget
  status: RepoStatus
  git: GitStatus
  /** Switches the Git tab to another repo of the workspace. */
  onRepo?: (repo: string | null) => void
  /** The trigger's content. */
  children: ReactNode
}) {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === target.botId)?.name) ?? 'Bot'
  return (
    <Popover
      portal
      placement="bottom-start"
      width={400}
      aria-label={t('{name} 的分支', { name })}
      onOpenChange={(open) => open && refreshGitQuietly(target.groupId, target.botId)}
      trigger={
        <button type="button" className="gb-trigger" aria-label={t('切换 {name} 的分支', { name })}>
          {children}
          <Icon name="chevron-down" size={10} />
        </button>
      }
    >
      {(close) => <BranchPanel target={target} status={status} git={git} onRepo={onRepo} close={close} />}
    </Popover>
  )
}

/** The popup's levels: the workspace's list, with one of its repos beside it or in its place. */
export function BranchPanel({
  target,
  status,
  git,
  onRepo,
  close,
}: {
  target: GitTarget
  status: RepoStatus
  git: GitStatus
  onRepo?: (repo: string | null) => void
  close: () => void
}) {
  const [repo, setRepo] = useState<RepoStatus | null>(null)
  const [side, setSide] = useState<({ repo: RepoStatus } & Beside) | null>(null)
  // Back from a repo, its row is the current one again.
  const [left, setLeft] = useState<string | null>(null)
  const leave = () => {
    if (!repo) return
    setLeft(repoKey(repo))
    setRepo(null)
  }
  const shut = () => setSide(null)
  useEscape(leave, !!repo)
  useEscape(shut, !!side)
  const repoPanel = (r: RepoStatus, back: () => void, closing: boolean, fly = true) => {
    const label = repoLabel(r.path)
    return (
      <RefsPanel
        key={r.path}
        target={{ ...target, repo: r.path || null }}
        status={r}
        close={close}
        focus
        fly={fly}
        header={<Drill title={label} meta={<RepoNote repo={r} />} onBack={back} closing={closing} />}
        onBack={back}
        use={
          onRepo && (target.repo ?? '') !== r.path
            ? { label: t('在 Git 面板中切换到 {repo}', { repo: label }), run: () => onRepo(r.path || null) }
            : undefined
        }
        diff={{
          label: t('查看 {repo} 的改动', { repo: label }),
          // Uncommitted work first; a clean repo shows what its branch holds against main.
          run: () =>
            openTab({
              kind: 'diff',
              botId: target.botId,
              scope: r.dirty ? 'uncommitted' : 'base',
              file: null,
              ...(r.path && { repo: r.path }),
            }),
        }}
      />
    )
  }
  if (repo) return repoPanel(repo, leave, false)
  return (
    <>
      <RefsPanel
        target={target}
        status={status}
        close={close}
        focus={left !== null}
        start={left}
        fly={!side}
        repos={
          git.repos.length
            ? {
                list: workspaceRepos(git),
                dirtyCount: git.dirtyCount ?? null,
                beside: side?.repo.path ?? null,
                onOpen: (r, at) => (at ? setSide({ repo: r, ...at }) : setRepo(r)),
              }
            : undefined
        }
      />
      {side ? (
        <div className="gb-side" data-left={side.left || undefined} style={{ width: side.width }}>
          {/* On the left, its actions would fly out over the popup. */}
          {repoPanel(side.repo, shut, true, !side.left)}
        </div>
      ) : null}
    </>
  )
}

/** The root (when it is a repo) first, then the submodules, nested and extra repos. */
const workspaceRepos = (git: GitStatus): RepoStatus[] => {
  const root = repoStatus(git, null)
  return [...(root ? [root] : []), ...git.repos]
}
const repoKey = (r: RepoStatus) => `repo:${r.path}`

type Row =
  | {
      kind: 'action'
      key: string
      icon: IconName
      label: string
      run: () => void
      busy?: boolean
      aria?: string
    }
  | { kind: 'head'; key: string; label: string }
  | { kind: 'repo'; key: string; repo: RepoStatus; changes: number | null; current: boolean }
  | { kind: 'folder'; key: string; path: string; name: string; depth: number; open: boolean }
  | { kind: 'ref'; key: string; ref: PickedRef; label: string; depth: number }
type Item = Exclude<Row, { kind: 'head' }>
type RefRow = Extract<Row, { kind: 'ref' }>

/** A branch's actions: beside the list (`fly`, at `top` with `room` to the right) or in its place. */
interface Opened {
  key: string
  ref: PickedRef
  fly: boolean
  top: number
  room: number
  /** item: the first action (keyboard), menu: the menu itself (pointer), null: none (hover). */
  focus: 'item' | 'menu' | null
}

/** How long the pointer rests on a row before its actions fly out, so crossing rows on the way there does not. */
const HOVER_MS = 200
/** The least room beside the popup for a branch's actions to fly out, and the most they take. */
const FLY_MIN = 240
const FLY_MAX = 360
/** The same for a repo's branches beside the workspace's list, on the right or else on the left. */
const SIDE_MIN = 300
const SIDE_MAX = 400
interface Beside {
  width: number
  left: boolean
}

const coarsePointer = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

/** One level of the popup: a repo's top actions and branches, and on the workspace's level its repos. */
function RefsPanel({
  target,
  status,
  close,
  focus = false,
  start = null,
  fly: canFly = true,
  header,
  onBack,
  use,
  diff,
  repos,
}: {
  target: GitTarget
  status: RepoStatus
  close: () => void
  /** Focus the search on mount: a level reached inside the popup (opening focuses the first one). */
  focus?: boolean
  /** The row to start on. */
  start?: string | null
  /** Whether a branch's actions may fly out beside the popup, else they take the list's place. */
  fly?: boolean
  /** A repo's level: its title with the way back (← in an empty search too), and its changes. */
  header?: ReactNode
  onBack?: () => void
  /** A repo's level: switching the Git tab to it. */
  use?: { label: string; run: () => void }
  diff?: { label: string; run: () => void }
  /** The workspace's level when it has several repos: a row each, opening it beside the popup (`beside`) or in its place (null). */
  repos?: {
    list: RepoStatus[]
    dirtyCount: number | null
    beside: string | null
    onOpen: (r: RepoStatus, at: Beside | null) => void
  }
}) {
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs, error } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const base = useWorkspace((s) => s.groups.find((g) => g.id === target.groupId)?.repo?.branch ?? null)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)
  const fly = useRef<HTMLDivElement>(null)
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scroll = useRef(false)
  const refocus = useRef(focus)
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState(start)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [folders, setFolders] = useState<ReadonlySet<string>>(new Set())
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(
    () => loadFavorites(target.botId) ?? new Set(base ? [base, `origin/${base}`] : []),
  )
  const [fetching, setFetching] = useState(false)
  const cmd = gitCommands(target)
  const remote = refs?.remotes.find((r) => r.name === 'origin')?.name ?? refs?.remotes[0]?.name ?? null
  const search = () => root.current?.querySelector<HTMLInputElement>('.gb__search input')
  const rowId = (key: string) => `${listId}${encodeURIComponent(key)}`

  const then = (run: () => void) => () => {
    close()
    run()
  }
  const fetchAll = async () => {
    setFetching(true)
    try {
      await refreshGit(target.groupId, target.botId, true)
    } catch (e) {
      toastError(e)
    }
    setFetching(false)
  }
  const toggleStar = (name: string) => {
    const next = new Set(favorites)
    if (!next.delete(name)) next.add(name)
    setFavorites(next)
    saveFavorites(target.botId, next)
  }
  const toggle = (path: string) =>
    setFolders((s) => {
      const next = new Set(s)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const q = query.trim().toLowerCase()
  const top: Row[] = q
    ? []
    : [
        ...(use
          ? [
              {
                kind: 'action' as const,
                key: 'use',
                icon: 'folder-git' as const,
                label: t('切换到此仓库'),
                aria: use.label,
                run: then(use.run),
              },
            ]
          : []),
        ...(diff
          ? [
              {
                kind: 'action' as const,
                key: 'diff',
                icon: 'doc-text' as const,
                label: t('查看改动'),
                aria: diff.label,
                run: then(diff.run),
              },
            ]
          : []),
        { kind: 'action', key: 'pull', icon: 'arrow-down', label: t('更新…'), run: then(cmd.pull) },
        { kind: 'action', key: 'push', icon: 'arrow-up', label: t('推送…'), run: then(() => cmd.push()) },
        { kind: 'action', key: 'new', icon: 'plus', label: t('新建分支…'), run: then(() => cmd.newBranch()) },
        {
          kind: 'action',
          key: 'revision',
          icon: 'tag',
          label: t('检出标签或修订…'),
          run: then(cmd.checkoutRevision),
        },
        {
          kind: 'action',
          key: 'fetch',
          icon: 'arrow-clockwise',
          label: fetching ? t('正在获取远程更新…') : t('获取远程更新'),
          run: () => void fetchAll(),
          busy: fetching,
        },
        { kind: 'head', key: 'sep', label: '' },
      ]
  const repoRows: Row[] = (repos?.list ?? [])
    .filter((r) => !q || repoLabel(r.path).toLowerCase().includes(q))
    .map((r) => ({
      kind: 'repo',
      key: repoKey(r),
      repo: r,
      changes: r.kind === 'root' ? (repos?.dirtyCount ?? null) : null,
      current: (target.repo ?? '') === r.path,
    }))
  const branchRows = refs ? buildRows(refs, { q, favorites, open: folders, current: status.branch }) : []
  const rows: Row[] = [
    ...top,
    ...(repoRows.length
      ? [{ kind: 'head' as const, key: 'h-repos', label: t('仓库#group') }, ...repoRows]
      : []),
    ...branchRows,
  ]
  const items = rows.filter((r): r is Item => r.kind !== 'head')
  const active = items.find((r) => r.key === activeKey) ?? items[0]

  // A move inside the popup leaves the focus in its search (on touch it would bring up the keyboard).
  useLayoutEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    if (!coarsePointer()) search()?.focus()
  })
  useLayoutEffect(() => {
    if (!scroll.current || !active) return
    scroll.current = false
    document.getElementById(rowId(active.key))?.scrollIntoView?.({ block: 'nearest' })
  })
  // Actions flown out low on the screen move up into it.
  useLayoutEffect(() => {
    const el = fly.current
    if (!el || !opened?.fly) return
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
    if (over > 0) el.style.top = `${opened.top - over}px`
  }, [opened])
  useLayoutEffect(() => () => clearTimeout(hover.current), [])
  // Back from the repo beside, the keys are on this list again.
  const sideOpen = repos?.beside != null
  const hadSide = useRef(sideOpen)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the repo beside closes
  useLayoutEffect(() => {
    if (hadSide.current && !sideOpen && !coarsePointer()) search()?.focus()
    hadSide.current = sideOpen
  }, [sideOpen])
  useEscape(() => back(), !!opened)

  /** The popup's own panel, which what opens beside it is placed against, and the room to its right. */
  const beside = () => {
    const gb = root.current
    if (!gb) return null
    const panel = ((gb.offsetParent as HTMLElement | null) ?? gb).getBoundingClientRect()
    return { panel, room: document.documentElement.clientWidth - panel.right - 12 }
  }
  /** Where a row's actions fly out, or null without room for them beside the popup. */
  const place = (key: string) => {
    const at = canFly ? beside() : null
    if (!at) return null
    const { panel, room } = at
    if (room < FLY_MIN) return null
    const row = document.getElementById(rowId(key))?.getBoundingClientRect().top ?? panel.top
    return { top: row - panel.top - 5, room }
  }
  const openRef = (r: RefRow, how: Opened['focus']) => {
    clearTimeout(hover.current)
    setActiveKey(r.key)
    const at = place(r.key)
    setOpened({ key: r.key, ref: r.ref, fly: !!at, top: at?.top ?? 0, room: at?.room ?? 0, focus: how })
  }
  function back() {
    setOpened(null)
    refocus.current = true
  }
  const openRepo = (r: RepoStatus) => {
    clearTimeout(hover.current)
    setOpened(null)
    setActiveKey(repoKey(r))
    const at = beside()
    const right = at?.room ?? 0
    const left = (at?.panel.left ?? 0) - 12
    repos?.onOpen(
      r,
      right >= SIDE_MIN
        ? { width: Math.min(right, SIDE_MAX), left: false }
        : left >= SIDE_MIN
          ? { width: Math.min(left, SIDE_MAX), left: true }
          : null,
    )
  }
  const pick = (r: Item, how: Opened['focus']) => {
    if (r.kind === 'action') {
      if (!r.busy) r.run()
    } else if (r.kind === 'folder') toggle(r.path)
    else if (r.kind === 'repo') openRepo(r.repo)
    else openRef(r, how)
  }
  const onHover = (r: Item) => {
    setActiveKey(r.key)
    clearTimeout(hover.current)
    // Back on the list from the actions: typing searches again.
    if (fly.current?.contains(document.activeElement)) search()?.focus()
    hover.current = setTimeout(() => {
      if (r.kind !== 'ref') return setOpened((o) => (o?.fly ? null : o))
      const at = place(r.key)
      if (at)
        setOpened((o) =>
          o?.key === r.key
            ? o
            : { key: r.key, ref: r.ref, fly: true, top: at.top, room: at.room, focus: null },
        )
    }, HOVER_MS)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement
    const input = el instanceof HTMLInputElement ? el : null
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229 || !active) return
    // The actions and the stars take their own keys.
    if (!input && !el.classList.contains('gb__row')) return
    // ← and → move the caret unless it is at that end of the text.
    const caretAt = (end: boolean) =>
      !input ||
      (input.selectionStart === input.selectionEnd && input.selectionStart === (end ? input.value.length : 0))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const at = items.indexOf(active)
      const next = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
      clearTimeout(hover.current)
      setOpened(null)
      if (next) setActiveKey(next.key)
      scroll.current = true
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(active, 'item')
    } else if (e.key === 'ArrowRight' && caretAt(true)) {
      if (active.kind === 'ref' || active.kind === 'repo' || (active.kind === 'folder' && !active.open)) {
        e.preventDefault()
        pick(active, 'item')
      }
    } else if (e.key === 'ArrowLeft' && caretAt(false)) {
      if (active.kind === 'folder' && active.open) {
        e.preventDefault()
        toggle(active.path)
      } else if (onBack && !query) {
        e.preventDefault()
        onBack()
      }
    }
  }

  const menu = (o: Opened) => {
    const actions = refActions(cmd, o.ref, {
      current: status.branch,
      remote,
      branches: refs?.branches ?? [],
    })
    return (
      <Menu
        key={`${o.key}:${o.focus}`}
        ref={fly}
        aria-label={o.ref.name}
        className={o.fly ? 'gb__fly' : 'gb__drill-menu'}
        style={o.fly ? { top: o.top, maxWidth: Math.min(o.room, FLY_MAX) } : undefined}
        items={actionItems(actions)}
        isSubmenu
        autoFocus={!!o.focus}
        focusMenu={o.focus === 'menu'}
        onMouseEnter={() => {
          // Rows crossed on the way here do not take over.
          clearTimeout(hover.current)
          setActiveKey(o.key)
        }}
        onClose={back}
        onSelect={(v) => {
          close()
          runAction(actions, v)
        }}
      />
    )
  }

  if (opened && !opened.fly)
    return (
      <div ref={root} className="gb">
        <Drill title={opened.ref.name} meta={<RefMeta refItem={opened.ref} />} onBack={back} />
        {menu(opened)}
      </div>
    )

  const row = (r: Row) => {
    if (r.kind === 'head')
      return r.label ? (
        <div key={r.key} className="gb__head">
          {r.label}
        </div>
      ) : (
        <div key={r.key} className="gb__sep" />
      )
    const on = r === active
    const own = {
      id: rowId(r.key),
      tabIndex: -1,
      'data-active': on || undefined,
    }
    const hovering = {
      onMouseEnter: () => onHover(r),
      onMouseLeave: () => clearTimeout(hover.current),
    }
    if (r.kind === 'action')
      return (
        <button
          key={r.key}
          {...own}
          {...hovering}
          type="button"
          className="gb__row gb__row--action"
          aria-label={r.aria}
          disabled={r.busy}
          onClick={r.run}
        >
          <span className="gb__icon">
            {r.busy ? <Spinner size={11} /> : <Icon name={r.icon} size={13} />}
          </span>
          <span className="gb__name">{r.label}</span>
        </button>
      )
    if (r.kind === 'repo')
      return (
        <button
          key={r.key}
          {...own}
          {...hovering}
          type="button"
          className="gb__row gb__row--repo"
          title={r.repo.path || undefined}
          data-repo={r.repo.path}
          data-current={r.current || undefined}
          data-open={repos?.beside === r.repo.path || undefined}
          onClick={() => openRepo(r.repo)}
        >
          <span className="gb__icon">
            <Icon name={r.current ? 'check' : 'folder-git'} size={13} weight={r.current ? 2 : undefined} />
          </span>
          <span className="gb__name gb__repo-path">{repoLabel(r.repo.path)}</span>
          <RepoNote repo={r.repo} changes={r.changes} />
          <Icon name="chevron-right" size={10} className="gb__more" />
        </button>
      )
    if (r.kind === 'folder')
      return (
        <button
          key={r.key}
          {...own}
          {...hovering}
          type="button"
          className="gb__row gb__row--folder"
          style={{ paddingLeft: 10 + r.depth * 16 }}
          aria-expanded={r.open}
          onClick={() => {
            toggle(r.path)
            refocus.current = true
          }}
        >
          <span className={cx('gb__icon ui-disclosure', r.open && 'ui-disclosure--open')}>
            <Icon name="chevron-right" size={11} weight={2} />
          </span>
          <span className="gb__name">{r.name}</span>
        </button>
      )
    const current = r.ref.kind === 'local' && r.ref.name === status.branch
    const star = favorites.has(r.ref.name)
    return (
      <div
        key={r.key}
        {...hovering}
        className="gb__item"
        data-active={on || opened?.key === r.key || undefined}
        data-current={current || undefined}
      >
        <button
          {...own}
          type="button"
          className="gb__row"
          style={{ paddingLeft: 10 + r.depth * 16 }}
          title={r.ref.name}
          onClick={() => openRef(r, 'menu')}
        >
          <span className="gb__icon" data-star={(star && !current) || undefined}>
            <Icon
              name={r.ref.kind === 'tag' ? 'tag' : current ? 'check' : star ? 'star' : 'git-branch'}
              size={13}
              weight={current ? 2 : undefined}
            />
          </span>
          <span className="gb__name">
            <Highlight text={r.label} q={q} />
          </span>
          {r.ref.kind === 'local' ? <Track b={r.ref.branch} /> : null}
          <Icon name="chevron-right" size={10} className="gb__more" />
        </button>
        {r.ref.kind === 'tag' ? null : (
          <button
            type="button"
            className="gb__star"
            // Tab reaches the current row's star only: the arrows move between rows.
            tabIndex={on ? 0 : -1}
            data-on={star || undefined}
            aria-label={
              star ? t('取消收藏 {name}', { name: r.ref.name }) : t('收藏 {name}', { name: r.ref.name })
            }
            aria-pressed={star}
            onClick={() => toggleStar(r.ref.name)}
          >
            <Icon name="star" size={11} />
          </button>
        )}
      </div>
    )
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys of the search field and the rows
    <div ref={root} className="gb" onKeyDown={onKeyDown}>
      {header}
      <SearchField
        className="gb__search"
        placeholder={t('搜索分支和标签')}
        aria-label={t('搜索分支和标签')}
        aria-controls={listId}
        aria-activedescendant={active ? rowId(active.key) : undefined}
        value={query}
        onChange={(v) => {
          setQuery(v)
          setActiveKey(null)
          setOpened(null)
        }}
      />
      {/* Scrolling would leave flown-out actions beside another row. */}
      <div id={listId} className="gb__list" onWheel={() => opened && setOpened(null)}>
        {rows.map(row)}
        {error ? <div className="git-refs__note git-refs__note--error">{error}</div> : null}
        {!refs && !error ? (
          <div className="git-refs__note">
            <Spinner size={14} />
          </div>
        ) : null}
        {refs && q && !branchRows.length ? (
          <div className="git-refs__note">{t('没有匹配的分支或标签')}</div>
        ) : null}
      </div>
      {opened ? menu(opened) : null}
    </div>
  )
}

/** A level's title above it, with the way back (or, beside the popup, closing it). */
function Drill({
  title,
  meta,
  onBack,
  closing = false,
}: {
  title: string
  meta: ReactNode
  onBack: () => void
  closing?: boolean
}) {
  return (
    <div className="gb__drill">
      <button
        type="button"
        className="gb__back"
        aria-label={closing ? t('收起') : t('返回')}
        onClick={onBack}
      >
        <Icon name={closing ? 'xmark' : 'chevron-left'} size={12} weight={2} />
      </button>
      <div className="gb__drill-title">
        <span className="gb__drill-name">{title}</span>
        <span className="gb__drill-meta">{meta}</span>
      </div>
    </div>
  )
}

function RefMeta({ refItem }: { refItem: PickedRef }) {
  const tip = refItem.kind === 'tag' ? refItem.tag : refItem.branch
  const upstream = refItem.kind === 'local' ? refItem.branch.upstream : null
  return (
    <>
      {tip.subject ? `${tip.subject} · ${ago(tip.at)}` : null}
      {upstream ? ` · ${t('跟踪 {upstream}', { upstream })}` : null}
    </>
  )
}

/** A repo's branch, its changes (counted when the status says how many) and how far it is from its upstream. */
function RepoNote({ repo, changes = null }: { repo: RepoStatus; changes?: number | null }) {
  return (
    <>
      {repo.kind === 'extra' ? <span className="gb__note">{t('附加目录#one')}</span> : null}
      <span className="gb__note gb__repo-branch">{repo.branch ?? t('游离')}</span>
      {repo.dirty ? (
        <span className="gb__note gb__note--dirty">
          {changes ? t('{n} 个改动', { n: changes }) : t('未提交')}
        </span>
      ) : null}
      <Counts ahead={repo.ahead} behind={repo.behind} />
    </>
  )
}

/** ↓ incoming (blue), ↑ outgoing (green), as in IDEA. */
function Counts({ ahead, behind }: { ahead: number | null; behind: number | null }) {
  return (
    <>
      {behind ? (
        <span className="gb__in" role="img" aria-label={t('落后 {n} 个提交', { n: behind })}>
          ↓{behind}
        </span>
      ) : null}
      {ahead ? (
        <span className="gb__out" role="img" aria-label={t('领先 {n} 个提交', { n: ahead })}>
          ↑{ahead}
        </span>
      ) : null}
    </>
  )
}

/** The upstream a local branch tracks, in grey, and how far apart they are. */
function Track({ b }: { b: GitBranch }) {
  if (!b.upstream) return null
  return (
    <span className="gb__track">
      <span className="gb__upstream">{b.upstream}</span>
      <Counts ahead={b.ahead} behind={b.behind} />
    </span>
  )
}

function Highlight({ text, q }: { text: string; q: string }) {
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="gb__mark">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

/** Branches of a section up to which its `/` folders start unfolded. */
const UNFOLDED = 10

/** The popup's branch rows: sections of refs, favourites first, `/` folders unless searching. */
export function buildRows(
  refs: GitRefsDto,
  o: { q: string; favorites: ReadonlySet<string>; open: ReadonlySet<string>; current: string | null },
): Row[] {
  const match = (name: string) => !o.q || name.toLowerCase().includes(o.q)
  const fav = (a: { name: string }, b: { name: string }) =>
    +o.favorites.has(b.name) - +o.favorites.has(a.name)
  const locals = refs.branches.filter((b) => b.kind === 'local' && match(b.name))
  const rows: Row[] = []
  const branchRows = (
    list: GitBranch[],
    kind: 'local' | 'remote',
    strip: string,
    keyPrefix: string,
    depth: number,
  ) => {
    const ref = (b: GitBranch): PickedRef => ({ kind, name: b.name, branch: b })
    const stars = list.filter((b) => o.favorites.has(b.name) || b.name === o.current)
    const rest = list.filter((b) => !stars.includes(b))
    for (const b of stars.sort(fav))
      rows.push({
        kind: 'ref',
        key: `${keyPrefix}*${b.name}`,
        ref: ref(b),
        label: b.name.slice(strip.length),
        depth,
      })
    if (o.q) {
      for (const b of rest)
        rows.push({
          kind: 'ref',
          key: `${keyPrefix}${b.name}`,
          ref: ref(b),
          label: b.name.slice(strip.length),
          depth,
        })
      return
    }
    // A few branches show unfolded; many start folded. Toggling flips the default either way.
    const unfolded = rest.length <= UNFOLDED
    const walk = (nodes: BranchNode[], d: number) => {
      for (const n of nodes) {
        if (n.kind === 'branch') {
          rows.push({
            kind: 'ref',
            key: `${keyPrefix}${n.name}`,
            ref: ref(n.branch),
            label: n.label,
            depth: d,
          })
          continue
        }
        const isOpen = unfolded !== o.open.has(`${keyPrefix}${n.path}`)
        rows.push({
          kind: 'folder',
          key: `${keyPrefix}${n.path}/`,
          path: `${keyPrefix}${n.path}`,
          name: n.name,
          depth: d,
          open: isOpen,
        })
        if (isOpen) walk(n.children, d + 1)
      }
    }
    walk(branchTree(rest, strip), depth)
  }
  const recent = refs.recent
    .map((name) => refs.branches.find((b) => b.kind === 'local' && b.name === name))
    .filter((b): b is GitBranch => !!b && match(b.name))
  if (recent.length && !o.q) {
    rows.push({ kind: 'head', key: 'h-recent', label: t('最近') })
    for (const b of recent)
      rows.push({
        kind: 'ref',
        key: `recent:${b.name}`,
        ref: { kind: 'local', name: b.name, branch: b },
        label: b.name,
        depth: 0,
      })
  }
  if (locals.length) {
    rows.push({ kind: 'head', key: 'h-local', label: t('本地') })
    branchRows(locals, 'local', '', 'l:', 0)
  }
  const groups = remoteGroups(refs)
    .map((g) => ({ ...g, branches: g.branches.filter((b) => match(b.name)) }))
    .filter((g) => g.branches.length)
  const [only] = groups
  if (groups.length === 1 && only) {
    rows.push({ kind: 'head', key: 'h-remote', label: t('远程 · {remote}', { remote: only.remote }) })
    branchRows(only.branches, 'remote', `${only.remote}/`, `r:${only.remote}/`, 0)
  } else if (groups.length) {
    rows.push({ kind: 'head', key: 'h-remote', label: t('远程') })
    for (const g of groups) {
      const path = `r:${g.remote}`
      const isOpen = !!o.q || o.open.has(path)
      rows.push({ kind: 'folder', key: `${path}/`, path, name: g.remote, depth: 0, open: isOpen })
      if (isOpen) branchRows(g.branches, 'remote', `${g.remote}/`, `r:${g.remote}/`, 1)
    }
  }
  const tags = refs.tags.filter((tag: GitTag) => match(tag.name))
  if (tags.length) {
    rows.push({ kind: 'head', key: 'h-tags', label: t('标签') })
    const path = 'tags'
    const shown = o.q || tags.length <= 8 || o.open.has(path)
    for (const tag of shown ? tags : tags.slice(0, 8))
      rows.push({
        kind: 'ref',
        key: `t:${tag.name}`,
        ref: { kind: 'tag', name: tag.name, tag },
        label: tag.name,
        depth: 0,
      })
    if (!shown)
      rows.push({
        kind: 'folder',
        key: 'tags/',
        path,
        name: t('更多 {n} 个标签', { n: tags.length - 8 }),
        depth: 0,
        open: false,
      })
  }
  return rows
}
