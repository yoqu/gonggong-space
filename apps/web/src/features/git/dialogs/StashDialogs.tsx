import type { GitStash } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../../i18n'
import { ago } from '../../../lib/time'
import { Alert, Checkbox, Dialog, TextField } from '../../../ui'
import type { GitTarget } from '../api'
import type { GitConfirm } from '../commands'
import { badRefName, GitError, OwnerNote, useActionLabel, useGitRun } from './common'

interface Props {
  target: GitTarget
  onClose: () => void
}

/** IDEA's Stash Changes: a message, untracked files too, or only the files picked. */
export function StashDialog({ target, paths, onClose }: Props & { paths: string[] | null }) {
  const [message, setMessage] = useState('')
  const [untracked, setUntracked] = useState(true)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  return (
    <Dialog
      open
      title={t('贮藏改动')}
      message={
        paths ? t('只贮藏选中的 {n} 个文件', { n: paths.length }) : t('贮藏全部未提交的改动，工作区回到 HEAD')
      }
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('贮藏')),
          variant: 'primary',
          disabled: busy,
          onClick: () =>
            void submit({
              action: 'stash',
              untracked,
              ...(message.trim() && { message: message.trim() }),
              ...(paths && { paths }),
            }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <TextField
          label={t('说明（可选）')}
          value={message}
          autoFocus
          onChange={(e) => setMessage(e.target.value)}
        />
        <Checkbox label={t('包含未跟踪的文件')} checked={untracked} onChange={setUntracked} />
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/** IDEA's Unstash: apply, pop, reinstate the index, or restore as a new branch. */
export function UnstashDialog({
  target,
  stash,
  initialPop = true,
  onClose,
}: Props & { stash: GitStash; initialPop?: boolean }) {
  const [pop, setPop] = useState(initialPop)
  const [index, setIndex] = useState(false)
  const [branch, setBranch] = useState('')
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const b = branch.trim()
  const invalid = badRefName(b)
  return (
    <Dialog
      open
      title={t('恢复贮藏 {ref}', { ref: `stash@{${stash.index}}` })}
      message={`${stash.message} · ${ago(stash.at)}`}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(b ? t('恢复为新分支') : pop ? t('弹出') : t('应用')),
          variant: 'primary',
          disabled: busy || !!invalid,
          onClick: () =>
            void submit(
              // `expect`: refused if the list moved since and stash@{n} is another one by then.
              b
                ? { action: 'unstash', stash: stash.index, expect: stash.hash, branch: b }
                : { action: 'unstash', stash: stash.index, expect: stash.hash, pop, index },
            ),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <Checkbox label={t('恢复后删除这个贮藏')} checked={pop && !b} disabled={!!b} onChange={setPop} />
        <Checkbox
          label={t('同时恢复暂存区（--index）')}
          checked={index && !b}
          disabled={!!b}
          onChange={setIndex}
        />
        <TextField
          label={t('恢复为新分支（可选）')}
          value={branch}
          placeholder={t('在贮藏时的提交上新建分支并恢复')}
          error={invalid ?? undefined}
          onChange={(e) => setBranch(e.target.value)}
        />
        {stash.branch ? (
          <p className="git-form__hint">{t('贮藏于分支 {branch}', { branch: stash.branch })}</p>
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/** A confirmation before an action (cherry-pick, revert, rollback, drop…), listing what it changes. */
export function ConfirmDialog({ target, confirm, onClose }: Props & { confirm: GitConfirm }) {
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  return (
    <Dialog
      open
      title={confirm.title}
      message={confirm.message}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose, autoFocus: confirm.destructive },
        {
          label: label(confirm.label),
          variant: confirm.destructive ? 'destructive' : 'primary',
          disabled: busy,
          onClick: () => void submit(confirm.req),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        {confirm.consequences?.length ? (
          <Alert variant={confirm.destructive ? 'warning' : 'info'}>
            <ul className="git-form__list">
              {confirm.consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}
