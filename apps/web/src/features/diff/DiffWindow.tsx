import { useWorkspace } from '../../app/workspace'
import { Dialog, EmptyState, Spinner } from '../../ui'
import { DiffFileList, DiffLayoutToggle, DiffScopeBar, DiffView, emptyText, scopeNote } from './DiffParts'
import { findFile } from './patch'
import { type DiffSource, useDiffWindow } from './store'
import { useWorkspaceDiff } from './useWorkspaceDiff'

/** 改动 window: a bot workspace's changed files on the left, the picked file's unified diff on the right. */
export function DiffWindow() {
  const source = useDiffWindow((s) => s.source)
  const close = useDiffWindow((s) => s.close)
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === source?.botId))
  return (
    <Dialog open={!!source} onClose={close} width={1080} title={`改动 · ${bot?.name ?? 'Bot'}`}>
      {source ? <DiffBody source={source} /> : null}
    </Dialog>
  )
}

function DiffBody({ source }: { source: DiffSource }) {
  const { scope, file, setScope, setFile } = useDiffWindow()
  const diff = useWorkspaceDiff(source, scope)
  const picked = file === null ? diff.files[0] : findFile(diff.files, file)
  return (
    <div className="diff-window">
      <div className="diff-window__bar">
        <DiffScopeBar scope={scope} turn={!!source.runId} onChange={setScope} />
        <span className="diff-window__branch">{scopeNote(scope, diff.branch, diff.base)}</span>
        <DiffLayoutToggle />
      </div>
      {diff.loading && !diff.files.length ? (
        <div className="diff-window__state">
          <Spinner />
        </div>
      ) : diff.error ? (
        <EmptyState compact icon="warning" title="无法读取改动" description={diff.error} />
      ) : !diff.files.length ? (
        <EmptyState compact icon="doc-code" title={emptyText(scope, diff.branch, diff.base)} />
      ) : (
        <div className="diff-window__main">
          <DiffFileList files={diff.files} active={picked} onPick={setFile} />
          {picked ? (
            <DiffView file={picked} />
          ) : (
            <div className="diff-window__state">{file} 在这个范围内没有改动</div>
          )}
        </div>
      )}
    </div>
  )
}
