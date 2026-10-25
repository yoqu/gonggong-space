import type { GitCommit, GitCompareDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../../i18n'
import { EmptyState, type MenuItem, Spinner } from '../../../ui'
import { GitFileDiff } from '../../diff/GitFileDiff'
import { openTab } from '../../workbench/open'
import { type GitTarget, gitBase, gitUrls, useGitGet } from '../api'
import type { TreeChange } from '../ChangeTree'
import { Split } from '../Split'
import { EMPTY_TREE } from '../StashView'
import { ChangesPane, defaultChange } from './ChangesPane'

/**
 * The versions the picked commits (list order, newest first) span when they run on as one first-parent line:
 * `oldest^..newest`; null when they don't.
 */
export function pickedRange(picked: readonly GitCommit[]): { from: string; to: string } | null {
  const newest = picked[0]
  const oldest = picked.at(-1)
  if (!newest || !oldest) return null
  for (let i = 0; i + 1 < picked.length; i++) if (picked[i]?.parents[0] !== picked[i + 1]?.hash) return null
  return { from: oldest.parents[0] ?? EMPTY_TREE, to: newest.hash }
}

/**
 * IDEA's details for several commits picked: their changes together when they run on (`pickedRange`), the files
 * beside the picked one's diff; else a note that only commits in a row combine.
 */
export function RangeDetails({
  target,
  picked,
  historyPath,
}: {
  target: GitTarget
  picked: readonly GitCommit[]
  historyPath: string | null
}) {
  const base = gitBase(target.groupId, target.botId)
  const range = pickedRange(picked)
  const [file, setFile] = useState<string | null>(null)
  const compare = useGitGet<GitCompareDto>(
    range ? gitUrls.compare(base, range.from, range.to, target.repo) : null,
  )
  const n = picked.length
  if (!range)
    return (
      <EmptyState
        compact
        icon="git-commit"
        title={t('选中的 {n} 个提交不相连', { n })}
        description={t('选择相连的提交可查看它们合起来的改动')}
      />
    )
  const list = compare.data?.changes ?? null
  const shown = list?.find((c) => c.path === file) ?? (list ? defaultChange(list, historyPath) : undefined)
  const showDiff = (c: TreeChange) =>
    openTab({ kind: 'git-compare', botId: target.botId, repo: target.repo, ...range, file: c.path })
  const fileItems = (): MenuItem[] => [{ value: 'diff', label: t('显示差异'), icon: 'doc-text' }]
  return (
    <Split
      storageKey="gg.git.log.files"
      initial={340}
      min={240}
      label={t('调整列表宽度')}
      first={
        <div className="glog-detail" data-testid="range-details">
          <ChangesPane
            target={target}
            changes={list}
            error={compare.error}
            selected={shown?.path ?? null}
            onSelect={(c) => setFile(c.path)}
            onOpen={showDiff}
            fileItems={fileItems}
            onFileItem={(v, c) => v === 'diff' && showDiff(c)}
            group={t('{n} 个提交', { n })}
          />
        </div>
      }
      second={
        <div className="glog-diff">
          {shown ? (
            <GitFileDiff
              key={`${range.from}:${shown.path}`}
              url={gitUrls.diff(base, range.from, range.to, shown.path, target.repo, shown.oldPath)}
              path={shown.path}
            />
          ) : list ? (
            <EmptyState compact icon="doc-text" title={t('没有文件变化')} />
          ) : (
            <div className="glog-note">
              <Spinner />
            </div>
          )}
        </div>
      }
    />
  )
}
