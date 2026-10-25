import {
  FILE_TREE_MAX_ENTRIES,
  type FileCandidatesDto,
  type FilesTreeDto,
  type FileTreeEntry,
  type GitChange,
  type GitCompareDto,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { api, errorText } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import {
  Button,
  Checkbox,
  EmptyState,
  Icon,
  PathControl,
  Popover,
  SearchField,
  SegmentedControl,
  Spinner,
} from '../../../ui'
import { useWide } from '../../diff/DiffPane'
import { GitFileDiff } from '../../diff/GitFileDiff'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { BotFileViewer } from '../../files/FileViewer'
import { gitBase, gitUrls, shortRev, useGitRefs } from '../../git/api'
import { ChangeList, ChangeMark } from '../../git/changes'
import { RefList } from '../../git/RefList'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'
import { OpenWith } from './OpenWith'

/** Below this the tree folds into a panel toggled from the bar. */
const WIDE_PX = 700
const SEARCH_DEBOUNCE_MS = 150

type Listing = { entries: FileTreeEntry[]; truncated: boolean } | { error: string }

const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
/** 'a/b' → ['a', 'a/b']. */
const chain = (dir: string) => (dir ? dir.split('/').map((_, i, all) => all.slice(0, i + 1).join('/')) : [])
const message = (e: unknown) => (e instanceof Error ? e.message : t('读取失败'))

const sorted = (entries: FileTreeEntry[]) =>
  [...entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))

/** One level per request (`url` of a directory), cached until 刷新 or another `source` starts over. */
function useTree(source: string, url: (dir: string) => string, dirs: string[]) {
  const [gen, setGen] = useState(0)
  const key = `${source}|${gen}`
  const [state, setState] = useState<{ key: string; listings: Record<string, Listing> }>({
    key,
    listings: {},
  })
  const live = useRef(key)
  live.current = key
  const asked = useRef(new Set<string>())
  const listings = state.key === key ? state.listings : {}

  useEffect(() => {
    const put = (dir: string, l: Listing) => {
      if (live.current !== key) return
      setState((s) => ({ key, listings: { ...(s.key === key ? s.listings : {}), [dir]: l } }))
    }
    for (const dir of dirs) {
      const id = `${key}\n${dir}`
      if (asked.current.has(id)) continue
      asked.current.add(id)
      api.get<FilesTreeDto>(url(dir)).then(
        (r) => put(dir, { entries: sorted(r.entries), truncated: r.truncated }),
        (e: unknown) => put(dir, { error: message(e) }),
      )
    }
  })
  return { listings, reload: () => setGen((n) => n + 1) }
}

interface Compare {
  url: string
  changes: GitChange[]
  byPath: Map<string, GitChange>
  /** Directories holding a change. */
  dirs: Set<string>
  error: string | null
}

/** Changes of the browsed version against the compare base; null while off or loading. */
function useCompare(url: string | null) {
  const [state, setState] = useState<Compare | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    const done = (changes: GitChange[], error: string | null) =>
      live &&
      setState({
        url,
        changes,
        error,
        byPath: new Map(changes.map((c) => [c.path, c])),
        dirs: new Set(changes.flatMap((c) => chain(parentOf(c.path)))),
      })
    api.get<GitCompareDto>(url).then(
      (r) => done(r.changes, null),
      (e: unknown) => done([], errorText(e)),
    )
    return () => {
      live = false
    }
  }, [url])
  return url && state?.url === url ? state : null
}

function RefPickerList({
  groupId,
  botId,
  value,
  top,
  onPick,
}: {
  groupId: string
  botId: string
  value: string | null
  top: ReactNode
  onPick: (rev: string) => void
}) {
  const { refs, error } = useGitRefs(groupId, botId)
  return (
    <RefList
      refs={refs}
      error={error}
      selected={value}
      commits
      top={top}
      onPick={(_, name) => onPick(name)}
    />
  )
}

/** Picks a branch or a typed commit; `workTree` offers 工作区 first, `clear` ends the mode. */
function RefPicker({
  label,
  value,
  groupId,
  botId,
  workTree,
  clear,
  onPick,
}: {
  label: string
  value: string | null
  groupId: string
  botId: string
  workTree?: boolean
  clear?: string
  onPick: (rev: string | null) => void
}) {
  const text = workTree
    ? t('版本：{rev}', { rev: value ? shortRev(value) : t('工作区') })
    : value
      ? t('对比 {rev}', { rev: shortRev(value) })
      : label
  return (
    <Popover
      portal
      placement="bottom-start"
      width={300}
      aria-label={label}
      trigger={
        <Button
          size="small"
          variant="plain"
          icon={workTree ? 'git-branch' : 'git-fork'}
          aria-label={label}
          title={text}
        >
          <span className="wt-files__rev">{text}</span>
        </Button>
      }
    >
      {(close) => (
        <RefPickerList
          groupId={groupId}
          botId={botId}
          value={value}
          top={
            workTree || (clear && value) ? (
              <button
                type="button"
                className="git-refs__item"
                onClick={() => {
                  close()
                  onPick(null)
                }}
              >
                <span className="git-refs__check">
                  {!value ? <Icon name="check" size={12} weight={2} /> : null}
                </span>
                {workTree ? t('工作区') : clear}
              </button>
            ) : null
          }
          onPick={(rev) => {
            close()
            onPick(rev)
          }}
        />
      )}
    </Popover>
  )
}

/** Fuzzy workspace search: the composer's @ file candidates, scoped to this bot. */
function useSearch(groupId: string, botId: string, query: string) {
  const [hits, setHits] = useState<{ q: string; entries: FileCandidatesDto['entries'] } | null>(null)
  const q = query.trim()
  useEffect(() => {
    if (!q) return
    let live = true
    const timer = setTimeout(() => {
      api
        .get<FileCandidatesDto>(
          `/groups/${groupId}/candidates/files?q=${encodeURIComponent(q)}&botId=${botId}`,
        )
        .then(
          (r) => live && setHits({ q, entries: r.entries }),
          () => live && setHits({ q, entries: [] }),
        )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [groupId, botId, q])
  return q && hits?.q === q ? hits.entries : null
}

function CompareMark({ compare, path, dir }: { compare: Compare; path: string; dir: boolean }) {
  const change = compare.byPath.get(path)
  if (dir)
    return compare.dirs.has(path) ? (
      <span className="git-mark git-mark--dot" title={t('有变化')}>
        •
      </span>
    ) : null
  return change ? <ChangeMark change={change.change} /> : null
}

/** A bot workspace, read-only (design §4.5): lazy tree left, the picked file right. */
export function FilesTab({ tab, tabKey }: TabProps<'files'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const patch = useWorkbench((s) => s.patch)
  const root = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const wide = useWide(root, WIDE_PX)
  // Narrow: the tree replaces the file while open. Wide: it sits beside the file unless collapsed.
  const [treeOpen, setTreeOpen] = useState(!tab.selected)
  const [collapsed, setCollapsed] = useState(false)
  const [ignored, setIgnored] = useState(false)
  const [query, setQuery] = useState('')
  // Compare mode shows a changed file as its diff; 文件 switches to its content.
  const [showDiff, setShowDiff] = useState(true)
  const stamp = useGitStamp(groupId, tab.botId)
  const [expanded, setExpanded] = useState(() => new Set(chain(tab.dir)))
  // Versions and compare need the group repo (partition mode), like the bar's git status.
  const versioned = useWorkspace((s) => {
    const g = s.groups.find((x) => x.id === groupId)
    return g?.mode === 'partition' && !!g.repo
  })
  const rev = tab.rev ?? null
  const repo = gitBase(groupId, tab.botId)
  const files = `/groups/${groupId}/bots/${tab.botId}/files`
  const { listings, reload } = useTree(
    rev ? `${repo}@${rev}` : `${files}|${ignored}`,
    (dir) =>
      rev
        ? gitUrls.tree(repo, rev, dir)
        : `${files}/tree?path=${encodeURIComponent(dir)}${ignored ? '&ignored=1' : ''}`,
    ['', ...expanded],
  )
  const compare = useCompare(tab.base ? gitUrls.compare(repo, tab.base, rev) : null)
  const hits = useSearch(groupId, tab.botId, rev ? '' : query)
  const showTree = wide ? !collapsed : treeOpen

  // Navigating to a folder (breadcrumbs, 在文件浏览器中定位) reveals it.
  useEffect(() => {
    setExpanded((s) => {
      const add = chain(tab.dir).filter((d) => !s.has(d))
      return add.length ? new Set([...s, ...add]) : s
    })
  }, [tab.dir])

  const shownSelection = tab.selected && parentOf(tab.selected) in listings ? tab.selected : null
  useEffect(() => {
    if (shownSelection)
      treeRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [shownSelection])

  const toggleDir = (path: string) => {
    const open = expanded.has(path)
    setExpanded((s) => {
      const next = new Set(s)
      if (open) next.delete(path)
      else next.add(path)
      return next
    })
    patch(tabKey, { dir: open ? parentOf(path) : path })
  }
  const pickFile = (path: string) => {
    patch(tabKey, { dir: parentOf(path), selected: path })
    if (!wide) setTreeOpen(false)
  }
  const pickHit = (path: string, dir: boolean) => {
    setQuery('')
    if (dir) patch(tabKey, { dir: path })
    else pickFile(path)
  }

  const rows = (dir: string, depth: number): ReactNode[] => {
    const l = listings[dir]
    const pad = { paddingLeft: `${8 + depth * 14}px` }
    if (!l)
      return [
        <div key={`${dir}\n…`} className="ft__note" style={pad}>
          <Spinner size={12} />
        </div>,
      ]
    if ('error' in l)
      return [
        <div key={`${dir}\n!`} className="ft__note ft__note--error" style={pad}>
          {l.error}
        </div>,
      ]
    const out = l.entries.flatMap((e) => {
      const path = join(dir, e.name)
      const open = e.dir && expanded.has(path)
      const row = (
        <button
          key={path}
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={e.dir ? open : undefined}
          aria-selected={e.dir ? undefined : path === tab.selected}
          data-name={e.name}
          data-ignored={e.ignored || undefined}
          className={cx('ft__row', e.ignored && 'ft__row--ignored')}
          style={pad}
          title={path}
          onClick={() => (e.dir ? toggleDir(path) : pickFile(path))}
        >
          <span className="ft__chevron">
            {e.dir ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} weight={2} /> : null}
          </span>
          <Icon name={e.dir ? (open ? 'folder-open' : 'folder') : 'doc'} size={14} />
          <span className="ft__name">{e.name}</span>
          {compare ? (
            <CompareMark compare={compare} path={path} dir={e.dir} />
          ) : e.uncommitted && !rev ? (
            <span className="ft__mark" title={t('未提交')}>
              M
            </span>
          ) : null}
        </button>
      )
      return open ? [row, ...rows(path, depth + 1)] : [row]
    })
    if (l.truncated)
      out.push(
        <div key={`${dir}\n+`} className="ft__note" style={pad}>
          {t('已截断，仅显示前 {n} 项', { n: FILE_TREE_MAX_ENTRIES })}
        </div>,
      )
    return out
  }

  const change = tab.selected && tab.base ? compare?.byPath.get(tab.selected) : undefined
  // A file deleted since the base only exists there.
  const viewRev = change?.change === 'deleted' ? tab.base : rev
  const viewer = (path: string) => (
    <BotFileViewer
      key={`${path}@${viewRev ?? ''}`}
      botId={tab.botId}
      path={path}
      rev={viewRev}
      onOpenTab={() =>
        openTab({ kind: 'file', source: { botId: tab.botId, path, ...(viewRev ? { rev: viewRev } : {}) } })
      }
    />
  )
  const top = listings['']
  const failed = top && 'error' in top ? top.error : null
  const crumbs = [
    { id: '', label: rev ? shortRev(rev) : t('工作区') },
    ...chain(tab.dir).map((id) => ({ id, label: id.split('/').pop() as string })),
  ]

  const tree =
    compare && tab.changedOnly ? (
      <div className="ft">
        {compare.error ? (
          <div className="ft__note ft__note--error">{compare.error}</div>
        ) : compare.changes.length ? (
          <ChangeList changes={compare.changes} selected={tab.selected} onPick={(c) => pickFile(c.path)} />
        ) : (
          <div className="ft__note">{t('没有文件变化')}</div>
        )}
      </div>
    ) : hits !== null ? (
      <div className="ft">
        {hits.length ? (
          hits.map((h) => (
            <button
              key={h.path}
              type="button"
              className="ft__row ft__row--hit"
              title={h.path}
              onClick={() => pickHit(h.path, h.dir)}
            >
              <Icon name={h.dir ? 'folder' : 'doc'} size={14} />
              <span className="ft__name">{h.path}</span>
              {h.uncommitted ? <span className="ft__mark">M</span> : null}
            </button>
          ))
        ) : (
          <div className="ft__note">{t('没有匹配的文件')}</div>
        )}
      </div>
    ) : (
      <div ref={treeRef} role="tree" aria-label={t('文件')} className="ft">
        {rows('', 0)}
      </div>
    )

  return (
    <div ref={root} className="wt-files" data-layout={wide ? 'wide' : 'narrow'}>
      <div className="wt-files__bar">
        <Button
          size="small"
          variant="plain"
          icon="sidebar"
          aria-label={t('目录')}
          title={showTree ? t('收起目录') : t('展开目录')}
          aria-pressed={showTree}
          onClick={() => (wide ? setCollapsed((c) => !c) : setTreeOpen((o) => !o))}
        />
        <PathControl className="wt-files__path" items={crumbs} onSelect={(dir) => patch(tabKey, { dir })} />
        {rev ? null : (
          <SearchField
            className="wt-files__search"
            placeholder={t('搜索文件')}
            value={query}
            onChange={(q) => {
              setQuery(q)
              if (q.trim()) {
                setTreeOpen(true)
                setCollapsed(false)
              }
            }}
          />
        )}
        <Button size="small" variant="plain" icon="arrow-clockwise" aria-label={t('刷新')} onClick={reload} />
        {versioned ? (
          <>
            <RefPicker
              label={t('版本')}
              value={rev}
              groupId={groupId}
              botId={tab.botId}
              workTree
              onPick={(r) => patch(tabKey, { rev: r })}
            />
            <RefPicker
              label={t('对比')}
              value={tab.base ?? null}
              groupId={groupId}
              botId={tab.botId}
              clear={t('关闭对比')}
              onPick={(b) => patch(tabKey, { base: b })}
            />
          </>
        ) : null}
        {tab.base ? (
          <Checkbox
            label={t('只看有变化的')}
            checked={!!tab.changedOnly}
            onChange={(on) => patch(tabKey, { changedOnly: on })}
          />
        ) : null}
        {rev ? null : <Checkbox label={t('显示忽略的')} checked={ignored} onChange={setIgnored} />}
        <OpenWith groupId={groupId} botId={tab.botId} />
      </div>
      {failed ? (
        <EmptyState
          icon="warning"
          title={t('无法读取工作区文件')}
          description={failed}
          action={<Button onClick={reload}>{t('重试')}</Button>}
        />
      ) : (
        <div className="wt-files__main">
          {showTree ? <div className="wt-files__tree">{tree}</div> : null}
          {wide || !treeOpen ? (
            <div className="wt-files__view">
              {tab.selected && change && tab.base ? (
                <div className="wt-files__compare">
                  <div className="wt-files__compare-bar">
                    <SegmentedControl
                      size="small"
                      aria-label={t('显示方式')}
                      items={[
                        { value: 'diff' as const, label: t('差异') },
                        { value: 'file' as const, label: t('文件#view') },
                      ]}
                      value={showDiff ? 'diff' : 'file'}
                      onChange={(v) => setShowDiff(v === 'diff')}
                    />
                    <span className="wt-files__compare-note">
                      {`${shortRev(tab.base)} → ${rev ? shortRev(rev) : t('工作区')}`}
                    </span>
                  </div>
                  {showDiff ? (
                    <GitFileDiff
                      key={tab.selected}
                      url={gitUrls.diff(repo, tab.base, rev, tab.selected, null, change.oldPath)}
                      path={tab.selected}
                      stamp={rev ? '' : stamp}
                    />
                  ) : (
                    viewer(tab.selected)
                  )}
                </div>
              ) : tab.selected ? (
                viewer(tab.selected)
              ) : (
                <EmptyState compact icon="doc" title={t('选择左侧的文件查看')} />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function useFilesTabMeta(tab: TabProps<'files'>['tab']): TabMeta {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId)?.name) ?? 'Bot'
  return { icon: 'folder', title: t('文件 · {name}', { name }) }
}
