import type { FileTextDto } from '@gonggong/protocol'
import { type ReactNode, useCallback, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { EmptyState, FileIcon, Icon } from '../../ui'
import { fmtSize } from '../attachments/api'
import { baseName, FileViewer, viewKind } from '../files/FileViewer'

interface Node {
  name: string
  path: string
  /** Set for a file. */
  size?: number
  children: Node[]
}

/** Folders first, then files, each by name — as the files panel lists a workspace. */
function buildTree(files: { path: string; size: number }[]) {
  const root: Node = { name: '', path: '', children: [] }
  for (const f of files) {
    let at = root
    const parts = f.path.split('/')
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const last = i === parts.length - 1
      let next = at.children.find((c) => c.name === name && (c.size === undefined) !== last)
      if (!next) {
        next = { name, path, children: [], ...(last ? { size: f.size } : {}) }
        at.children.push(next)
      }
      at = next
    })
  }
  const sort = (n: Node) => {
    n.children.sort(
      (a, b) => Number(a.size !== undefined) - Number(b.size !== undefined) || a.name.localeCompare(b.name),
    )
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

const dirsOf = (n: Node): string[] =>
  n.children.flatMap((c) => (c.size === undefined ? [c.path, ...dirsOf(c)] : []))

/** 文件 of a listing: the files panel's tree on the left, the picked file opened beside it, read-only. */
export function ListingFiles({
  listingId,
  versionId,
  files,
}: {
  listingId: string
  versionId?: string
  files: { path: string; size: number }[]
}) {
  const root = buildTree(files)
  // A small listing opens fully; a large one (a plugin with templates) starts folded to its top level.
  const [expanded, setExpanded] = useState(() => new Set(files.length <= 30 ? dirsOf(root) : []))
  const [selected, setSelected] = useState<string | null>(null)
  const query = (path: string) =>
    `?path=${encodeURIComponent(path)}${versionId ? `&versionId=${encodeURIComponent(versionId)}` : ''}`
  const base = `/market/${listingId}/files`
  const textUrl = selected ? `${base}/text${query(selected)}` : null
  const read = useCallback(() => api.get<FileTextDto>(textUrl ?? ''), [textUrl])

  const toggle = (path: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const rows = (n: Node, depth: number): ReactNode[] =>
    n.children.flatMap((c) => {
      const dir = c.size === undefined
      const open = dir && expanded.has(c.path)
      const row = (
        <button
          key={c.path}
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={dir ? open : undefined}
          aria-selected={dir ? undefined : c.path === selected}
          className="ft__row"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          title={c.path}
          onClick={() => (dir ? toggle(c.path) : setSelected(c.path))}
        >
          <span className="ft__chevron">
            {dir ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} weight={2} /> : null}
          </span>
          {dir ? (
            <Icon name={open ? 'folder-open' : 'folder'} size={14} />
          ) : (
            <FileIcon name={c.name} size={14} />
          )}
          <span className="ft__name">{c.name}</span>
          {dir ? null : <span className="mkt-files__size">{fmtSize(c.size ?? 0)}</span>}
        </button>
      )
      return open ? [row, ...rows(c, depth + 1)] : [row]
    })

  return (
    <div className="wt-files mkt-files">
      <div className="wt-files__main">
        <div className="wt-files__tree">
          <div role="tree" aria-label={t('文件')} className="ft">
            {rows(root, 0)}
          </div>
        </div>
        <div className="wt-files__view">
          {selected ? (
            <FileViewer
              key={`${selected}@${versionId ?? ''}`}
              name={baseName(selected)}
              path={selected}
              url={`/api${base}/raw${query(selected)}`}
              kind={viewKind(selected)}
              read={read}
              size={files.find((f) => f.path === selected)?.size}
            />
          ) : (
            <EmptyState compact icon="doc" title={t('选择左侧的文件查看')} />
          )}
        </div>
      </div>
    </div>
  )
}
