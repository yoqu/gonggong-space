import type { GitCompareDto, GitStash, GitStashesDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { ago, fullTime } from '../../lib/time'
import { Alert, Button, ContextMenu, EmptyState, Icon, Spinner } from '../../ui'
import { type GitTarget, gitBase, gitUrls, useGitGet } from './api'
import { type ChangeGroup, ChangeTree, type TreeChange, useChangeLayout } from './ChangeTree'
import { gitCommands } from './commands'

/** What a compare from the empty tree is made against: a stash's untracked files have no parent tree. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** A stash file's diff: tracked ones against the stash's base, untracked ones from nothing. */
export const stashDiff = (target: GitTarget, stash: GitStash, c: TreeChange) => {
  const base = gitBase(target.groupId, target.botId)
  return c.untracked
    ? gitUrls.diff(base, EMPTY_TREE, `${stash.hash}^3`, c.path, target.repo)
    : gitUrls.diff(base, `${stash.hash}^1`, stash.hash, c.path, target.repo, c.oldPath)
}

/**
 * IDEA's stashes (Unstash dialog as a pane): newest first, each opening the files it holds; apply, pop, as a new
 * branch, drop, or clear them all. `onPick` shows a file's diff.
 */
export function StashView({
  target,
  stamp,
  selected,
  onPick,
}: {
  target: GitTarget
  stamp: string
  selected: { stash: string; path: string } | null
  onPick: (stash: GitStash, c: TreeChange) => void
}) {
  const base = gitBase(target.groupId, target.botId)
  const { data, error } = useGitGet<GitStashesDto>(gitUrls.stashes(base, target.repo), stamp)
  const [openHash, setOpenHash] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<GitStash | null>(null)
  const cmd = gitCommands(target)
  if (error) return <Alert variant="error" description={error} />
  if (!data)
    return (
      <div className="git-refs__note">
        <Spinner size={14} />
      </div>
    )
  const stashes = data.stashes
  return (
    <div className="gs">
      <div className="gc-bar">
        <Button size="small" variant="plain" icon="archive" onClick={() => cmd.stash()}>
          {t('贮藏改动…')}
        </Button>
        <span className="spacer" />
        {stashes.length ? (
          <Button size="small" variant="plain" onClick={() => cmd.clearStashes(stashes.length)}>
            {t('清空')}
          </Button>
        ) : null}
      </div>
      {stashes.length ? (
        <ContextMenu
          items={
            menuFor
              ? [
                  { value: 'apply', label: t('恢复…'), icon: 'arrow-down' },
                  { value: 'apply-only', label: t('应用'), icon: 'arrow-down' },
                  { value: 'pop', label: t('弹出'), icon: 'arrow-up' },
                  { value: 'drop', label: t('删除…'), icon: 'trash', destructive: true },
                  { separator: true },
                  { value: 'copy', label: t('复制哈希'), icon: 'copy' },
                ]
              : []
          }
          onSelect={(v) => {
            if (!menuFor) return
            if (v === 'apply') cmd.unstash(menuFor)
            else if (v === 'apply-only') cmd.unstash(menuFor, false)
            else if (v === 'pop') cmd.unstash(menuFor, true)
            else if (v === 'drop') cmd.dropStash(menuFor)
            else if (v === 'copy') cmd.copy(menuFor.hash)
          }}
        >
          <ul className="gs-list">
            {stashes.map((s) => {
              const open = openHash === s.hash
              return (
                <li key={s.hash} className="gs-item" data-open={open || undefined}>
                  <div className="gs-row">
                    <button
                      type="button"
                      className="gs-row__main"
                      aria-expanded={open}
                      onClick={() => setOpenHash(open ? null : s.hash)}
                      onContextMenu={() => setMenuFor(s)}
                    >
                      <span className={open ? 'ui-disclosure ui-disclosure--open' : 'ui-disclosure'}>
                        <Icon name="chevron-right" size={10} weight={2} />
                      </span>
                      <span className="gs-row__text">
                        <span className="gs-row__message">{s.message}</span>
                        <span className="gs-row__meta" title={fullTime(s.at)}>
                          {`stash@{${s.index}}`}
                          {s.branch ? ` · ${s.branch}` : ''} · {ago(s.at)}
                        </span>
                      </span>
                    </button>
                    <Button size="small" variant="plain" onClick={() => cmd.unstash(s)}>
                      {t('恢复…')}
                    </Button>
                    <button
                      type="button"
                      className="gc-tool"
                      aria-label={t('删除 {ref}', { ref: `stash@{${s.index}}` })}
                      title={t('删除…')}
                      onClick={() => cmd.dropStash(s)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                  {open ? (
                    <StashFiles
                      target={target}
                      stash={s}
                      selected={selected?.stash === s.hash ? selected.path : null}
                      onPick={(c) => onPick(s, c)}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        </ContextMenu>
      ) : (
        <EmptyState
          compact
          icon="archive"
          title={t('没有贮藏')}
          description={t('贮藏会把未提交的改动暂时收起，工作区回到上次提交，之后可以随时恢复')}
        />
      )}
    </div>
  )
}

function StashFiles({
  target,
  stash,
  selected,
  onPick,
}: {
  target: GitTarget
  stash: GitStash
  selected: string | null
  onPick: (c: TreeChange) => void
}) {
  const base = gitBase(target.groupId, target.botId)
  const layout = useChangeLayout((s) => s.layout)
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const tracked = useGitGet<GitCompareDto>(gitUrls.compare(base, `${stash.hash}^1`, stash.hash, target.repo))
  const untracked = useGitGet<GitCompareDto>(
    stash.untracked ? gitUrls.compare(base, EMPTY_TREE, `${stash.hash}^3`, target.repo) : null,
  )
  if (tracked.error) return <Alert variant="error" description={tracked.error} />
  if (!tracked.data || (stash.untracked && !untracked.data && !untracked.error))
    return (
      <div className="git-refs__note">
        <Spinner size={14} />
      </div>
    )
  const groups: ChangeGroup[] = [
    { key: 'changes', label: t('更改'), changes: tracked.data.changes },
    {
      key: 'untracked',
      label: t('未跟踪的文件'),
      changes: (untracked.data?.changes ?? []).map((c) => ({ ...c, untracked: true })),
    },
  ]
  return (
    <div className="gs-files">
      <ChangeTree
        groups={groups}
        layout={layout}
        selected={selected}
        onSelect={onPick}
        closed={closed}
        onToggleFolder={(key) =>
          setClosed((s) => {
            const next = new Set(s)
            if (!next.delete(key)) next.add(key)
            return next
          })
        }
        label={t('贮藏的文件')}
      />
    </div>
  )
}
