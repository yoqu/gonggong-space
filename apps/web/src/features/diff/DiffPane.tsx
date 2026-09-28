import type { DiffScope } from '@gonggong/protocol'
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { EmptyState, Icon, NoChangesArt, Spinner } from '../../ui'
import { DiffFileList, DiffLayoutToggle, DiffScopeBar, DiffView, emptyText, scopeNote } from './DiffParts'
import { findFile } from './patch'
import type { WorkspaceDiff } from './useWorkspaceDiff'

/** Below this the file list folds into a dropdown above the diff (design §4.4). */
const WIDE_PX = 900

/** Whether the element is at least `px` wide, tracked as the workbench is resized. */
export function useWide(ref: RefObject<HTMLElement | null>, px: number) {
  const [wide, setWide] = useState(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // A hidden tab (display: none) measures 0; keep its last layout rather than folding it.
    const measure = () => el.clientWidth && setWide(el.clientWidth >= px)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [ref, px])
  return wide
}

interface DiffPaneProps {
  diff: WorkspaceDiff
  scope: DiffScope
  /** Offer 本轮 (the pane belongs to a run). */
  turn: boolean
  /** The picked file; null shows the first one. */
  file: string | null
  onScope: (scope: DiffScope) => void
  onFile: (path: string) => void
  onLocate: (path: string) => void
  /** Shown instead of the files, e.g. a purged turn. */
  notice?: ReactNode
}

/** Scope bar, then the changed files beside (or, when narrow, in a dropdown above) the picked file's diff. */
export function DiffPane({ diff, scope, turn, file, onScope, onFile, onLocate, notice }: DiffPaneProps) {
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root, WIDE_PX)
  const [listOpen, setListOpen] = useState(false)
  const picked = file === null ? diff.files[0] : findFile(diff.files, file)
  const pick = (path: string) => {
    setListOpen(false)
    onFile(path)
  }
  const list = <DiffFileList files={diff.files} active={picked} onPick={pick} onLocate={onLocate} />
  return (
    <div ref={root} className="diff-pane" data-testid="diff-pane" data-layout={wide ? 'wide' : 'narrow'}>
      <div className="diff-pane__bar">
        <DiffScopeBar scope={scope} turn={turn} onChange={onScope} />
        <span className="diff-pane__branch">{scopeNote(scope, diff.branch, diff.base)}</span>
        <DiffLayoutToggle />
      </div>
      {notice ? (
        <div className="diff-pane__state">{notice}</div>
      ) : diff.loading && !diff.files.length ? (
        <div className="diff-pane__state">
          <Spinner />
        </div>
      ) : diff.error ? (
        <EmptyState compact icon="warning" title="无法读取改动" description={diff.error} />
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
                <span className="diff-pane__count">{diff.files.length} 个文件</span>
                <Icon name="chevron-down" size={12} />
              </button>
              {listOpen ? list : null}
            </div>
          )}
          {picked ? (
            <DiffView file={picked} />
          ) : (
            <div className="diff-pane__state">{file} 在这个范围内没有改动</div>
          )}
        </div>
      )}
    </div>
  )
}
