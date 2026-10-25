import type { GitBranch, GitRefsDto } from '@gonggong/protocol'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { cx } from '../../../lib/cx'
import { toastError } from '../../../lib/errors'
import { Button, ContextMenu, Icon, SearchField, Spinner } from '../../../ui'
import { type GitTarget, refreshGit } from '../api'
import { actionItems, type PickedRef, refActions, runAction } from '../branchActions'
import { gitCommands } from '../commands'
import { type BranchNode, branchTree, loadFavorites, remoteGroups, saveFavorites } from '../refs'
import { Tool } from './Tool'
import '../branches.css'

type PaneRow =
  | { kind: 'all'; key: string }
  | { kind: 'head'; key: string }
  | { kind: 'node'; key: string; label: string; depth: number; open: boolean; section: boolean }
  | { kind: 'ref'; key: string; ref: PickedRef; label: string; depth: number }

/** More tags than this start folded. */
const TAGS_OPEN_MAX = 20

/**
 * The pane's rows: all branches and HEAD, then 本地 / 远程 (a node per remote) / 标签; the current branch and starred
 * ones lead their list, the rest sit in `/` folders (folded until opened) unless searching. `nodes` lists every
 * foldable node, for 全部展开 / 全部折叠.
 */
function paneRows(
  refs: GitRefsDto,
  o: {
    q: string
    favorites: ReadonlySet<string>
    current: string | null
    tags: boolean
    isOpen: (key: string, byDefault: boolean) => boolean
  },
) {
  const rows: PaneRow[] = []
  const nodes: string[] = []
  const match = (name: string) => !o.q || name.toLowerCase().includes(o.q)
  /** Adds a foldable node (a row when `shown`); returns whether its children show. */
  const node = (
    key: string,
    label: string,
    depth: number,
    byDefault: boolean,
    section: boolean,
    shown: boolean,
  ) => {
    nodes.push(key)
    const open = !!o.q || o.isOpen(key, byDefault)
    if (shown) rows.push({ kind: 'node', key, label, depth, open, section })
    return shown && open
  }
  const branches = (
    list: GitBranch[],
    kind: 'local' | 'remote',
    strip: string,
    depth: number,
    shown: boolean,
  ) => {
    const prefix = kind === 'local' ? 'l:' : 'r:'
    const ref = (b: GitBranch): PickedRef => ({ kind, name: b.name, branch: b })
    const isCurrent = (b: GitBranch) => kind === 'local' && b.name === o.current
    const top = list
      .filter((b) => isCurrent(b) || o.favorites.has(b.name))
      .sort((a, b) => +isCurrent(b) - +isCurrent(a))
    const rest = list.filter((b) => !top.includes(b))
    const flat = (b: GitBranch, key: string) =>
      rows.push({ kind: 'ref', key, ref: ref(b), label: b.name.slice(strip.length), depth })
    if (shown) for (const b of top) flat(b, `${prefix}*${b.name}`)
    if (o.q) {
      if (shown) for (const b of rest) flat(b, `${prefix}${b.name}`)
      return
    }
    const walk = (level: BranchNode[], d: number, visible: boolean) => {
      for (const n of level) {
        if (n.kind === 'folder')
          walk(n.children, d + 1, node(`${prefix}${n.path}`, n.name, d, false, false, visible))
        else if (visible)
          rows.push({ kind: 'ref', key: `${prefix}${n.name}`, ref: ref(n.branch), label: n.label, depth: d })
      }
    }
    walk(branchTree(rest, strip), depth, shown)
  }

  if (!o.q) rows.push({ kind: 'all', key: 'all' }, { kind: 'head', key: 'head' })
  const locals = refs.branches.filter((b) => b.kind === 'local' && match(b.name))
  if (locals.length) branches(locals, 'local', '', 1, node('sec:local', t('本地'), 0, true, true, true))
  const groups = remoteGroups(refs)
    .map((g) => ({ ...g, branches: g.branches.filter((b) => match(b.name)) }))
    .filter((g) => g.branches.length)
  if (groups.length) {
    const shown = node('sec:remote', t('远程'), 0, true, true, true)
    for (const g of groups)
      branches(
        g.branches,
        'remote',
        `${g.remote}/`,
        2,
        node(`remote:${g.remote}`, g.remote, 1, true, false, shown),
      )
  }
  const tags = o.tags ? refs.tags.filter((tag) => match(tag.name)) : []
  if (tags.length && node('sec:tags', t('标签'), 0, tags.length <= TAGS_OPEN_MAX, true, true))
    for (const tag of tags)
      rows.push({
        kind: 'ref',
        key: `t:${tag.name}`,
        ref: { kind: 'tag', name: tag.name, tag },
        label: tag.name,
        depth: 1,
      })
  return { rows, nodes }
}

const move = (e: KeyboardEvent<HTMLDivElement>) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.glb-row')]
  const at = rows.indexOf(document.activeElement as HTMLElement)
  const next = rows[at + (e.key === 'ArrowDown' ? 1 : -1)]
  if (!next) return
  e.preventDefault()
  next.focus()
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

/**
 * IDEA's Branches pane of the Git log: all branches, HEAD, local (starred first, `/` folders, ahead/behind), remote
 * and tags. A click filters the log to the ref (`onFilter`), a double click checks it out, a right click lists its
 * actions. `picker`: the pane inside the branch filter, picking only.
 */
export function BranchesPane({
  target,
  refs,
  error,
  selected,
  onFilter,
  picker,
  header,
}: {
  target: GitTarget
  refs: GitRefsDto | null
  error: string | null
  /** The log's ref filter: every branch, or a ref (null = HEAD). */
  selected: { all: boolean; ref: string | null }
  onFilter: (ref: string | null, all: boolean) => void
  picker?: boolean
  /** Above the search, e.g. a way back on a phone. */
  header?: ReactNode
}) {
  const base = useWorkspace((s) => s.groups.find((g) => g.id === target.groupId)?.repo?.branch ?? null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(
    () => loadFavorites(target.botId) ?? new Set(base ? [base, `origin/${base}`] : []),
  )
  const [tags, setTags] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [menuFor, setMenuFor] = useState<PickedRef | null>(null)
  const cmd = gitCommands(target)
  const current = refs?.branches.find((b) => b.kind === 'local' && b.current)?.name ?? null
  const remote = refs?.remotes.find((r) => r.name === 'origin')?.name ?? refs?.remotes[0]?.name ?? null
  const q = query.trim().toLowerCase()
  const { rows, nodes } = refs
    ? paneRows(refs, {
        q,
        favorites,
        current,
        tags: picker || tags,
        isOpen: (key, byDefault) => open.get(key) ?? byDefault,
      })
    : { rows: [], nodes: [] }
  const refsByKey = new Map(rows.flatMap((r) => (r.kind === 'ref' ? [[r.key, r.ref] as const] : [])))

  const toggle = (key: string, now: boolean) => setOpen((m) => new Map(m).set(key, !now))
  const toggleStar = (name: string) => {
    const next = new Set(favorites)
    if (!next.delete(name)) next.add(name)
    setFavorites(next)
    saveFavorites(target.botId, next)
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

  const row = (r: PaneRow) => {
    const pad = { paddingLeft: 8 + ('depth' in r ? r.depth : 0) * 14 }
    if (r.kind === 'all' || r.kind === 'head') {
      const on = r.kind === 'all' ? selected.all : !selected.all && !selected.ref
      return (
        <button
          key={r.key}
          type="button"
          className="glb-row"
          style={pad}
          aria-current={on || undefined}
          onClick={() => onFilter(null, r.kind === 'all')}
        >
          <span className="glb-row__icon">
            <Icon name={r.kind === 'all' ? 'git-fork' : 'git-commit'} size={13} />
          </span>
          <span className="glb-row__name">
            {r.kind === 'all' ? (
              t('全部分支')
            ) : (
              <>
                HEAD <span className="glb-row__note">{refs ? (current ?? t('游离')) : ''}</span>
              </>
            )}
          </span>
        </button>
      )
    }
    if (r.kind === 'node')
      return (
        <button
          key={r.key}
          type="button"
          className={cx('glb-row', r.section && 'glb-row--section')}
          style={pad}
          aria-expanded={r.open}
          onClick={() => toggle(r.key, r.open)}
        >
          <span className={cx('glb-row__icon ui-disclosure', r.open && 'ui-disclosure--open')}>
            <Icon name="chevron-right" size={10} weight={2} />
          </span>
          <span className="glb-row__name">{r.label}</span>
        </button>
      )
    const ref = r.ref
    const isCurrent = ref.kind === 'local' && ref.name === current
    const star = favorites.has(ref.name)
    const b = ref.kind === 'local' ? ref.branch : null
    const title = [
      ref.name,
      b?.upstream && t('跟踪 {upstream}', { upstream: b.upstream }),
      b?.ahead && t('领先 {n} 个提交', { n: b.ahead }),
      b?.behind && t('落后 {n} 个提交', { n: b.behind }),
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <div key={r.key} className="glb-item" data-key={r.key} data-current={isCurrent || undefined}>
        <button
          type="button"
          className="glb-row"
          style={pad}
          aria-label={ref.name}
          aria-current={(!selected.all && selected.ref === ref.name) || undefined}
          title={title}
          onClick={() => onFilter(ref.name, false)}
          onDoubleClick={() => !picker && !isCurrent && cmd.checkout(ref.name, ref.kind === 'tag')}
        >
          <span className="glb-row__icon" data-star={(star && !isCurrent) || undefined}>
            <Icon
              name={ref.kind === 'tag' ? 'tag' : isCurrent ? 'check' : star ? 'star' : 'git-branch'}
              size={13}
              weight={isCurrent ? 2 : undefined}
            />
          </span>
          <span className="glb-row__name">
            <Highlight text={r.label} q={q} />
          </span>
          {b?.upstream && (b.ahead || b.behind) ? (
            <span className="gb__track">
              {b.behind ? <span className="gb__in">↓{b.behind}</span> : null}
              {b.ahead ? <span className="gb__out">↑{b.ahead}</span> : null}
            </span>
          ) : null}
        </button>
        {ref.kind === 'tag' ? null : (
          <button
            type="button"
            className="gb__star"
            data-on={star || undefined}
            aria-label={
              star ? t('取消收藏 {name}', { name: ref.name }) : t('收藏 {name}', { name: ref.name })
            }
            aria-pressed={star}
            onClick={() => toggleStar(ref.name)}
          >
            <Icon name="star" size={11} />
          </button>
        )}
      </div>
    )
  }

  const list = (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rows' buttons
    <div
      className="glb__list"
      onKeyDown={move}
      onContextMenuCapture={(e) => {
        const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key
        const ref = key ? refsByKey.get(key) : undefined
        // Only refs have actions; elsewhere the browser's own menu shows.
        if (!ref) e.stopPropagation()
        setMenuFor(ref ?? null)
      }}
    >
      {rows.map(row)}
      {error ? <div className="glog-note glog-note--error">{error}</div> : null}
      {!refs && !error ? (
        <div className="glog-note">
          <Spinner size={14} />
        </div>
      ) : null}
      {refs && q && !rows.length ? <div className="glog-note">{t('没有匹配的分支或标签')}</div> : null}
    </div>
  )
  const actions = menuFor ? refActions(cmd, menuFor, { current, remote, branches: refs?.branches ?? [] }) : []
  return (
    <section className="glb" aria-label={t('分支#pane')} data-picker={picker || undefined}>
      {header}
      <div className="glb__head">
        <SearchField
          className="glb__search"
          placeholder={t('搜索分支和标签')}
          aria-label={t('搜索分支和标签')}
          value={query}
          onChange={setQuery}
        />
      </div>
      {picker ? null : (
        <div className="glb__tools" role="toolbar" aria-label={t('分支操作')}>
          <Tool icon="git-branch" label={t('新建分支…')} onClick={() => cmd.newBranch(selected.ref)} />
          <Tool
            icon="arrow-clockwise"
            label={fetching ? t('正在获取远程更新…') : t('获取远程更新')}
            busy={fetching}
            onClick={() => void fetchAll()}
          />
          <Tool icon="tag" label={t('显示标签')} pressed={tags} onClick={() => setTags(!tags)} />
          <span className="spacer" />
          <Tool
            icon="plus"
            label={t('全部展开')}
            onClick={() => setOpen(new Map(nodes.map((k) => [k, true])))}
          />
          <Tool
            icon="minus"
            label={t('全部折叠')}
            onClick={() => setOpen(new Map(nodes.map((k) => [k, false])))}
          />
        </div>
      )}
      {picker ? (
        list
      ) : (
        <ContextMenu
          className="glb__menu"
          items={actionItems(actions)}
          onSelect={(v) => runAction(actions, v)}
        >
          {list}
        </ContextMenu>
      )}
    </section>
  )
}

/** A way back to the log on a phone, where the pane takes the whole tab. */
export function PaneBack({ onBack }: { onBack: () => void }) {
  return (
    <div className="glb__back">
      <Button size="small" variant="plain" icon="chevron-left" onClick={onBack}>
        {t('全部提交')}
      </Button>
    </div>
  )
}
