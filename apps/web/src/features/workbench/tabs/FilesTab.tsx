import {
  FILE_TREE_MAX_ENTRIES,
  type FileCandidatesDto,
  type FilesTreeDto,
  type FileTreeEntry,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { Button, Checkbox, EmptyState, Icon, PathControl, SearchField, Spinner } from '../../../ui'
import { useWide } from '../../diff/DiffPane'
import { BotFileViewer } from '../../files/FileViewer'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'

/** Below this the tree folds into a panel toggled from the bar. */
const WIDE_PX = 700
const SEARCH_DEBOUNCE_MS = 150

type Listing = { entries: FileTreeEntry[]; truncated: boolean } | { error: string }

const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
/** 'a/b' → ['a', 'a/b']. */
const chain = (dir: string) => (dir ? dir.split('/').map((_, i, all) => all.slice(0, i + 1).join('/')) : [])
const message = (e: unknown) => (e instanceof Error ? e.message : '读取失败')

const sorted = (entries: FileTreeEntry[]) =>
  [...entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))

/** One level per request, cached until 刷新 or the ignored toggle starts over. */
function useTree(base: string, ignored: boolean, dirs: string[]) {
  const [gen, setGen] = useState(0)
  const key = `${base}|${ignored}|${gen}`
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
      api
        .get<FilesTreeDto>(`${base}/tree?path=${encodeURIComponent(dir)}${ignored ? '&ignored=1' : ''}`)
        .then(
          (r) => put(dir, { entries: sorted(r.entries), truncated: r.truncated }),
          (e: unknown) => put(dir, { error: message(e) }),
        )
    }
  })
  return { listings, reload: () => setGen((n) => n + 1) }
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
  const [expanded, setExpanded] = useState(() => new Set(chain(tab.dir)))
  const { listings, reload } = useTree(`/groups/${groupId}/bots/${tab.botId}/files`, ignored, [
    '',
    ...expanded,
  ])
  const hits = useSearch(groupId, tab.botId, query)
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
          {e.uncommitted ? (
            <span className="ft__mark" title="未提交">
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
          {`已截断，仅显示前 ${FILE_TREE_MAX_ENTRIES} 项`}
        </div>,
      )
    return out
  }

  const top = listings['']
  const failed = top && 'error' in top ? top.error : null
  const crumbs = [
    { id: '', label: '工作区' },
    ...chain(tab.dir).map((id) => ({ id, label: id.split('/').pop() as string })),
  ]

  const tree =
    hits !== null ? (
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
          <div className="ft__note">没有匹配的文件</div>
        )}
      </div>
    ) : (
      <div ref={treeRef} role="tree" aria-label="文件" className="ft">
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
          aria-label="目录"
          title={showTree ? '收起目录' : '展开目录'}
          aria-pressed={showTree}
          onClick={() => (wide ? setCollapsed((c) => !c) : setTreeOpen((o) => !o))}
        />
        <PathControl className="wt-files__path" items={crumbs} onSelect={(dir) => patch(tabKey, { dir })} />
        <SearchField
          className="wt-files__search"
          placeholder="搜索文件"
          value={query}
          onChange={(q) => {
            setQuery(q)
            if (q.trim()) {
              setTreeOpen(true)
              setCollapsed(false)
            }
          }}
        />
        <Button size="small" variant="plain" icon="arrow-clockwise" aria-label="刷新" onClick={reload} />
        <Checkbox label="显示忽略的" checked={ignored} onChange={setIgnored} />
      </div>
      {failed ? (
        <EmptyState
          icon="warning"
          title="无法读取工作区文件"
          description={failed}
          action={<Button onClick={reload}>重试</Button>}
        />
      ) : (
        <div className="wt-files__main">
          {showTree ? <div className="wt-files__tree">{tree}</div> : null}
          {wide || !treeOpen ? (
            <div className="wt-files__view">
              {tab.selected ? (
                <BotFileViewer
                  key={tab.selected}
                  botId={tab.botId}
                  path={tab.selected}
                  onOpenTab={() =>
                    openTab({ kind: 'file', source: { botId: tab.botId, path: tab.selected as string } })
                  }
                />
              ) : (
                <EmptyState compact icon="doc" title="选择左侧的文件查看" />
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
  return { icon: 'folder', title: `文件 · ${name}` }
}
