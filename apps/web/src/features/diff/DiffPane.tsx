import type { DiffScope } from '@gonggong/protocol'
import { type ReactNode, useRef, useState } from 'react'
import { t } from '../../i18n'
import { EmptyState, Icon, NoChangesArt, Spinner } from '../../ui'
import type { GitTarget } from '../git/api'
import { DiffFileList, DiffLayoutToggle, DiffScopeBar, DiffView, emptyText, scopeNote } from './DiffParts'
import { DiffToolbar, type FileSteps } from './DiffToolbar'
import { GitFileDiff } from './GitFileDiff'
import { type DiffFile, findFile, groupByRepo, isMultiRepo, listOrder, repoOf, repoPrefix } from './patch'
import { useDiffLayout, useDiffSettings } from './store'
import { useWide } from './useWide'
import type { WorkspaceDiff } from './useWorkspaceDiff'

export { useWide }

/** Below this the file list folds into a dropdown above the diff (design §4.4). */
const WIDE_PX = 900

interface DiffPaneProps {
  diff: WorkspaceDiff
  scope: DiffScope
  /** Offer 本轮 (the pane belongs to a run). */
  turn: boolean
  /** The picked file; null shows the first one (of `repo` when given). */
  file: string | null
  /** Repo path to open on ('' = root). */
  repo?: string | null
  onScope: (scope: DiffScope) => void
  onFile: (path: string) => void
  onLocate: (path: string) => void
  /** Shown instead of the files, e.g. a purged turn. */
  notice?: ReactNode
  /**
   * Where git reads a file's diff again, so the toolbar's whitespace and whole-file settings apply: the url for `path`
   * inside the repo at `repo` ('' = the root), or null to show the patch at hand.
   */
  read?: (repo: string, path: string) => string | null
  /** The work tree against HEAD, read again: each change rolls back in the repo at `repo` ('' = the root). */
  revert?: (repo: string) => GitTarget
  /** 跳到源文件: a file at a line of its new version. */
  onOpenLine?: (path: string, line: number) => void
}

/** Scope bar, then the changed files beside (or, when narrow, in a dropdown above) the picked file's diff. */
export function DiffPane({
  diff,
  scope,
  turn,
  file,
  repo,
  onScope,
  onFile,
  onLocate,
  notice,
  read,
  revert,
  onOpenLine,
}: DiffPaneProps) {
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root, WIDE_PX)
  const tree = useDiffLayout((s) => s.layout === 'tree')
  const [listOpen, setListOpen] = useState(false)
  // A file reached by stepping (F7, ⌥⇧→…) lands on its first (1) or last (-1) change.
  const [start, setStart] = useState<1 | -1>()
  const multi = isMultiRepo(diff.repos)
  const first = () =>
    (repo != null && groupByRepo(diff.files, diff.repos).find((g) => g.repo.path === repo)?.files[0]) ||
    diff.files[0]
  const picked = file === null ? first() : findFile(diff.files, file)
  const pick = (path: string) => {
    setListOpen(false)
    setStart(undefined)
    onFile(path)
  }
  const order = listOrder(diff.files, diff.repos, tree)
  const at = picked ? order.indexOf(picked) : -1
  const stepTo = (f: DiffFile | undefined) =>
    f &&
    ((land: 1 | -1) => {
      setStart(land)
      onFile(f.path)
    })
  const files: FileSteps | undefined =
    order.length > 1 ? { prev: stepTo(order[at - 1]), next: stepTo(order[at + 1]) } : undefined
  const viewer = (f: DiffFile) => {
    const inRepo = repoOf(f.path, diff.repos)?.path ?? ''
    const path = f.path.slice(repoPrefix(inRepo).length)
    const url = read?.(inRepo, path)
    const open = onOpenLine && f.status !== 'deleted' ? (line: number) => onOpenLine(f.path, line) : undefined
    // A new patch for the file is what reads it again.
    return url ? (
      <GitFileDiff
        key={f.path}
        url={url}
        path={path}
        name={f.path}
        stamp={f.lines.join('\n')}
        revert={revert?.(inRepo)}
        files={files}
        start={start}
        onOpenLine={open}
      />
    ) : (
      <PatchDiff key={f.path} file={f} files={files} start={start} onOpenLine={open} />
    )
  }
  const list = (
    <DiffFileList files={diff.files} repos={diff.repos} active={picked} onPick={pick} onLocate={onLocate} />
  )
  return (
    <div ref={root} className="diff-pane" data-testid="diff-pane" data-layout={wide ? 'wide' : 'narrow'}>
      <div className="diff-pane__bar">
        <DiffScopeBar scope={scope} turn={turn} onChange={onScope} />
        <span className="diff-pane__branch">
          {multi ? t('{n} 个仓库', { n: diff.repos.length }) : scopeNote(scope, diff.branch, diff.base)}
        </span>
        <DiffLayoutToggle />
      </div>
      {notice ? (
        <div className="diff-pane__state">{notice}</div>
      ) : diff.loading && !diff.files.length ? (
        <div className="diff-pane__state">
          <Spinner />
        </div>
      ) : diff.error ? (
        <EmptyState compact icon="warning" title={t('无法读取改动')} description={diff.error} />
      ) : !diff.files.length ? (
        <EmptyState
          compact
          illustration={<NoChangesArt />}
          title={emptyText(scope, diff.branch, diff.base)}
        />
      ) : (
        <div className="diff-pane__main">
          {wide ? (
            list
          ) : (
            <div className="diff-pane__picker">
              <button
                type="button"
                className="diff-pane__pick"
                aria-expanded={listOpen}
                onClick={() => setListOpen(!listOpen)}
              >
                <Icon name="doc-code" size={13} />
                <span className="diff-pane__pick-path">{picked?.path ?? file}</span>
                <span className="diff-pane__count">{t('{n} 个文件', { n: diff.files.length })}</span>
                <Icon name="chevron-down" size={12} />
              </button>
              {listOpen ? list : null}
            </div>
          )}
          {picked ? (
            <div className="diff-pane__view">{viewer(picked)}</div>
          ) : (
            <div className="diff-pane__state">{t('{file} 在这个范围内没有改动', { file: file ?? '' })}</div>
          )}
        </div>
      )}
    </div>
  )
}

/** A file of the patch at hand under the toolbar; git isn't asked again, so the read settings aren't offered. */
function PatchDiff({
  file,
  files,
  start,
  onOpenLine,
}: {
  file: DiffFile
  files?: FileSteps
  start?: 1 | -1
  onOpenLine?: (line: number) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const fullContext = useDiffSettings((s) => s.fullContext)
  return (
    <div ref={root} className="git-diff">
      <DiffToolbar
        target={root}
        reread={false}
        files={files}
        onOpenLine={onOpenLine}
        start={start}
        content={file}
      />
      <DiffView file={file} fold={!fullContext} onOpenLine={onOpenLine} />
    </div>
  )
}
