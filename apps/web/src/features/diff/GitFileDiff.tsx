import type { GitDiffDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { EmptyState, NoChangesArt, Spinner, toast } from '../../ui'
import { type GitTarget, runGitAction } from '../git/api'
import { inTarget } from '../git/commands'
import { DiffView } from './DiffParts'
import { DiffToolbar, type FileSteps } from './DiffToolbar'
import { undoPatch } from './hunk'
import { type DiffFile, parsePatch } from './patch'
import { useDiffSettings } from './store'

interface GitDiff {
  url: string
  files: DiffFile[]
  truncated: boolean
  error: string | null
}

/**
 * A `…/git/diff` read (null `url`: none), parsed; null while loading. A new `stamp` reads again, keeping the old diff
 * meanwhile.
 */
export function useGitDiff(url: string | null, stamp = '') {
  const [state, setState] = useState<GitDiff | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stamp only marks the work tree as changed
  useEffect(() => {
    if (!url) return
    let live = true
    api.get<GitDiffDto>(url).then(
      (r) => live && setState({ url, files: parsePatch(r.patch ?? ''), truncated: r.truncated, error: null }),
      (e: unknown) => live && setState({ url, files: [], truncated: false, error: errorText(e) }),
    )
    return () => {
      live = false
    }
  }, [url, stamp])
  return url !== null && state?.url === url ? state : null
}

/**
 * IDEA's revert arrow: takes one change (`patch`, see changePatch) of a work tree file back to HEAD — run by the bot's
 * owner, requested by anyone else — then offers to undo it.
 */
export function revertChange(target: GitTarget, path: string, patch: string) {
  const discard = (p: string, done: () => void) =>
    runGitAction(
      target.groupId,
      target.botId,
      inTarget(target, { action: 'discard', paths: [path], patch: p }),
      done,
    )
  return discard(patch, () =>
    toast({
      type: 'success',
      message: t('已回滚 1 处改动'),
      action: {
        label: t('撤销#undo'),
        onClick: () =>
          void discard(undoPatch(patch), () => toast({ type: 'success', message: t('已撤销回滚') })),
      },
    }),
  )
}

/** Whole-file context: more lines than any file the viewer would show. */
const FULL_CONTEXT = 100_000

const withQuery = (url: string, query: string) => `${url}${url.includes('?') ? '&' : '?'}${query}`

/**
 * One file's diff read from `url` (gitUrls.diff with its path) under a DiffToolbar (`toolbar={false}` leaves it
 * out), read again as its whitespace setting changes; `stamp` re-reads a work tree diff. A diff of the work tree
 * against HEAD of the repo `revert` rolls back change by change. `actions` go at the toolbar's right end; `name` is
 * shown for the file (default: `path`); `files`, `start` and `onOpenLine` as in DiffToolbar.
 */
export function GitFileDiff({
  url,
  path,
  name,
  stamp,
  revert,
  toolbar = true,
  actions,
  files,
  start,
  onOpenLine,
}: {
  url: string
  path: string
  name?: string
  stamp?: string
  revert?: GitTarget
  toolbar?: boolean
  actions?: ReactNode
  files?: FileSteps
  start?: 1 | -1
  onOpenLine?: (line: number) => void
}) {
  const whitespace = useDiffSettings((s) => s.whitespace)
  const fullContext = useDiffSettings((s) => s.fullContext)
  const read = whitespace === 'none' ? url : withQuery(url, `whitespace=${whitespace}`)
  // The whole file comes as context and the view folds what is unchanged; one too big to come whole is read with
  // git's own context instead, unless the whole file is asked for.
  const whole = useGitDiff(withQuery(read, `context=${FULL_CONTEXT}`), stamp)
  const cut = !!whole?.truncated && !fullContext
  const plain = useGitDiff(cut ? read : null, stamp)
  const diff = cut ? plain : whole
  const file = diff?.files.find((f) => f.path === path) ?? diff?.files[0]
  const root = useRef<HTMLDivElement>(null)
  const body = () => {
    if (!diff)
      return (
        <div className="diff-pane__state">
          <Spinner />
        </div>
      )
    if (diff.error)
      return <EmptyState compact icon="warning" title={t('无法读取差异')} description={diff.error} />
    // A patch cut before its first hunk has nothing to show but the note.
    if (!file)
      return diff.truncated ? null : (
        <EmptyState
          compact
          illustration={<NoChangesArt />}
          title={whitespace === 'none' ? t('没有差异') : t('忽略空白后没有差异')}
        />
      )
    if (file.binary)
      return <EmptyState compact icon="doc" title={t('二进制文件，无法显示差异')} description={file.path} />
    // git applies a change back only as it is: not from a diff without whitespace, cut short, or of a file HEAD lacks.
    const revertable = revert && whitespace === 'none' && !diff.truncated && file.status === 'modified'
    return (
      <DiffView
        file={file}
        name={name}
        fold={!fullContext}
        onOpenLine={onOpenLine}
        onRevert={revertable ? (patch) => void revertChange(revert, path, patch) : undefined}
      />
    )
  }
  return (
    <div ref={root} className="git-diff" data-testid="git-diff">
      {toolbar ? (
        <DiffToolbar
          target={root}
          actions={actions}
          files={files}
          onOpenLine={onOpenLine}
          start={start}
          content={file}
        />
      ) : null}
      {diff?.truncated ? (
        <div className="git-diff__note" role="status">
          {t('差异过大，已截断')}
        </div>
      ) : null}
      {body()}
    </div>
  )
}
