import type { DiffRepo, DiffScope } from '@gonggong/protocol'
import { type CSSProperties, Fragment, type ReactNode, useState } from 'react'
import { cx } from '../../lib/cx'
import { Icon, IconButton, langOf, SegmentedControl, Tokens, useHighlight } from '../../ui'
import {
  type DiffFile,
  type DiffNode,
  diffCells,
  diffTree,
  groupByRepo,
  isMultiRepo,
  type RepoGroup,
  repoPrefix,
} from './patch'
import { useDiffLayout } from './store'
import './diff.css'
import { t } from '../../i18n'

/** Five cells split between added and deleted lines (GitHub style); the numbers stay as text beside it. */
export function DiffBar({ add, del }: { add: number; del: number }) {
  const label = t('新增 {add} 行，删除 {del} 行', { add, del })
  return (
    <span className="diff-bar" role="img" aria-label={label} title={label}>
      {diffCells(add, del).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the five cells are positional
        <span key={i} className="diff-bar__cell" data-cell={c} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  )
}

interface FileListProps {
  files: DiffFile[]
  /** Repos the files span; more than the root lists them per repo. */
  repos?: DiffRepo[]
  active?: DiffFile
  onPick: (path: string) => void
  /** Offers 「在文件浏览器中定位」 on each file. */
  onLocate?: (path: string) => void
}

/** Changed files, flat or as a folder tree per the shared layout switch; grouped under a header per repo. */
export function DiffFileList({ repos = [], ...props }: FileListProps) {
  return (
    <div className="diff__files">
      {isMultiRepo(repos) ? (
        groupByRepo(props.files, repos)
          .filter((g) => g.files.length || g.repo.truncated)
          .map((g) => <RepoFiles key={g.repo.path} group={g} {...props} />)
      ) : (
        <Files {...props} prefix="" />
      )}
    </div>
  )
}

function Files(props: Omit<FileListProps, 'repos'> & { prefix: string }) {
  const layout = useDiffLayout((s) => s.layout)
  if (layout === 'tree') return <DiffTree {...props} />
  return props.files.map((f) => (
    <DiffFileRow
      key={f.path}
      file={f}
      prefix={props.prefix}
      active={f === props.active}
      onPick={props.onPick}
      onLocate={props.onLocate}
    />
  ))
}

function RepoFiles({ group, ...props }: Omit<FileListProps, 'repos'> & { group: RepoGroup }) {
  const [open, setOpen] = useState(true)
  const { repo } = group
  return (
    <>
      <button
        type="button"
        className="diff__file diff__repo"
        title={repo.path || undefined}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={cx('ui-disclosure', open && 'ui-disclosure--open')}>
          <Icon name="chevron-right" weight={2} />
        </span>
        <span className="diff__repo-name">{repo.path || t('根仓库')}</span>
        <span className="diff__repo-branch">
          {repo.base ? `${repo.branch ?? 'HEAD'} → ${repo.base}` : repo.branch}
        </span>
        <span className="diff__repo-count">{t('{n} 个文件', { n: group.files.length })}</span>
        <span className="diff__add">+{group.add}</span>
        <span className="diff__del">−{group.del}</span>
        {repo.truncated ? <span className="diff__repo-cut">{t('已截断')}</span> : null}
      </button>
      {open ? <Files {...props} files={group.files} prefix={repoPrefix(repo.path)} /> : null}
    </>
  )
}

export function DiffLayoutToggle() {
  const { layout, toggle } = useDiffLayout()
  return (
    <IconButton
      size="small"
      className="diff-layout-toggle"
      title={layout === 'tree' ? t('以列表显示') : t('以目录树显示')}
      onClick={toggle}
    >
      {layout === 'tree' ? ('list' as const) : ('folder' as const)}
    </IconButton>
  )
}

function DiffTree({
  files,
  prefix,
  active,
  onPick,
  onLocate,
}: Omit<FileListProps, 'repos'> & { prefix: string }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (path: string) =>
    setClosed((s) => {
      const next = new Set(s)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const rows = (nodes: DiffNode[], depth: number): ReactNode[] =>
    nodes.map((n) => {
      if (n.kind === 'file')
        return (
          <DiffFileRow
            key={n.file.path}
            file={n.file}
            name={n.name}
            depth={depth}
            active={n.file === active}
            onPick={onPick}
            onLocate={onLocate}
          />
        )
      const open = !closed.has(n.path)
      return (
        <Fragment key={n.path}>
          <button
            type="button"
            className="diff__file diff__folder"
            style={indent(depth)}
            title={n.path}
            aria-expanded={open}
            onClick={() => toggle(n.path)}
          >
            <span className={cx('ui-disclosure', open && 'ui-disclosure--open')}>
              <Icon name="chevron-right" weight={2} />
            </span>
            <Icon name={open ? 'folder-open' : 'folder'} size={13} />
            <span className="diff__path">{n.name}</span>
          </button>
          {open ? rows(n.children, depth + 1) : null}
        </Fragment>
      )
    })
  return <>{rows(diffTree(files, prefix), 0)}</>
}

const indent = (depth: number) => ({ '--depth': depth }) as CSSProperties

function DiffFileRow({
  file,
  prefix = '',
  name,
  depth,
  active,
  onPick,
  onLocate,
}: {
  file: DiffFile
  /** Shown paths drop it: the repo the row is grouped under. */
  prefix?: string
  /** Tree rows show the bare name; list rows show the name plus its folder. */
  name?: string
  depth?: number
  active: boolean
  onPick: (path: string) => void
  onLocate?: (path: string) => void
}) {
  const parts = file.path.slice(prefix.length).split('/')
  const row = (
    <button
      type="button"
      className={cx(
        'diff__file',
        depth !== undefined && 'diff__file--nested',
        active && 'diff__file--active',
      )}
      style={depth === undefined ? undefined : indent(depth)}
      title={file.path}
      onClick={() => onPick(file.path)}
    >
      <Icon name="doc-code" size={13} />
      <span className="diff__path">
        <span className="diff__base">{name ?? parts.at(-1)}</span>
        {name ? null : <span className="diff__dir">{parts.slice(0, -1).join('/')}</span>}
      </span>
      <span className="diff__add">+{file.add}</span>
      <span className="diff__del">−{file.del}</span>
      {file.binary ? null : <DiffBar add={file.add} del={file.del} />}
    </button>
  )
  if (!onLocate) return row
  return (
    <div className="diff__row">
      {row}
      <IconButton
        size="small"
        className="diff__locate"
        title={t('在文件浏览器中定位')}
        onClick={() => onLocate(file.path)}
      >
        {'folder-open' as const}
      </IconButton>
    </div>
  )
}

const lineClass = (l: string) =>
  l.startsWith('+')
    ? 'add'
    : l.startsWith('-')
      ? 'del'
      : l.startsWith('@@')
        ? 'hunk'
        : l.startsWith(' ')
          ? ''
          : 'note'

const isCode = (l: string) => /^[+\- ]/.test(l)

export function DiffView({ file }: { file: DiffFile }) {
  // Code lines of all hunks tokenized as one text: the n-th code line maps to the n-th token line.
  const code = file.lines.filter(isCode)
  const tokens = useHighlight(code.map((l) => l.slice(1)).join('\n'), langOf(file.path))
  let n = 0
  return (
    <div className="diff">
      <div className="diff__name">{file.path}</div>
      <div className="diff__lines">
        {file.lines.map((l, i) => {
          const t = isCode(l) ? tokens?.[n++] : undefined
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and never reorder
            <div key={i} className={cx('diff__line', lineClass(l) && `diff__line--${lineClass(l)}`)}>
              {t?.length ? (
                <>
                  {l[0]}
                  <Tokens tokens={t} />
                </>
              ) : (
                l || ' '
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DiffScopeBar({
  scope,
  turn,
  onChange,
}: {
  scope: DiffScope
  /** Offer 本轮 (the view belongs to a run). */
  turn: boolean
  onChange: (scope: DiffScope) => void
}) {
  const items: { value: DiffScope; label: string }[] = [
    ...(turn ? [{ value: 'turn' as const, label: t('本轮') }] : []),
    { value: 'uncommitted', label: t('未提交') },
    { value: 'base', label: t('对比主分支') },
  ]
  return (
    <SegmentedControl
      size="small"
      aria-label={t('改动范围')}
      items={items}
      value={scope}
      onChange={onChange}
    />
  )
}

/** What the scope compares, e.g. feat/x → main. */
export function scopeNote(scope: DiffScope, branch: string | null, base: string | null) {
  if (scope === 'base' && base) return `${branch ?? 'HEAD'} → ${base}`
  return branch
}

/** Why a scope is empty, in the user's terms. */
export function emptyText(scope: DiffScope, branch: string | null, base: string | null) {
  if (scope === 'turn') return t('本轮没有文件改动')
  if (scope === 'uncommitted') return t('没有未提交的改动')
  return base
    ? t('{branch} 相对 {base} 没有改动', { branch: branch ?? t('当前分支'), base })
    : t('当前就在主分支，没有可对比的改动')
}
