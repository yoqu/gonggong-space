import type { GitHeadCommit, GitOngoing } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../../i18n'
import { Alert, Checkbox, Dialog, RadioGroup, TextField } from '../../../ui'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { type GitTarget, runGitAction, useGitRefs } from '../api'
import { type CommitInfo, inTarget, ongoingLabel } from '../commands'
import { Choice } from './BranchDialogs'
import { badRefName, GitError, OwnerNote, RefCombo, useActionLabel, useGitRun, useRepoStatus } from './common'

interface Props {
  target: GitTarget
  onClose: () => void
}

type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep'

/** IDEA's Reset Current Branch to Here, its four modes explained. */
export function ResetDialog({ target, commit, onClose }: Props & { commit: CommitInfo }) {
  const status = useRepoStatus(target)
  const [mode, setMode] = useState<ResetMode>('mixed')
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  return (
    <Dialog
      open
      title={t('将 {branch} 重置到 {hash}', { branch: status?.branch ?? 'HEAD', hash: commit.shortHash })}
      message={commit.subject}
      width={520}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('重置')),
          variant: mode === 'hard' ? 'destructive' : 'primary',
          disabled: busy,
          onClick: () => void submit({ action: 'reset', commit: commit.hash, mode }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <RadioGroup<ResetMode>
          aria-label={t('重置方式')}
          value={mode}
          onChange={setMode}
          options={[
            {
              value: 'soft',
              label: (
                <Choice title={t('软重置（--soft）')} detail={t('之后的提交变回已暂存的改动，工作区不变')} />
              ),
            },
            {
              value: 'mixed',
              label: (
                <Choice title={t('混合（--mixed）')} detail={t('之后的提交变回未暂存的改动，工作区不变')} />
              ),
            },
            {
              value: 'hard',
              label: (
                <Choice
                  title={t('硬重置（--hard）')}
                  detail={t('丢弃之后的提交和所有未提交的改动，无法恢复')}
                  danger
                />
              ),
            },
            {
              value: 'keep',
              label: (
                <Choice
                  title={t('保留（--keep）')}
                  detail={t('丢弃之后的提交，保留未提交的改动；两者冲突时拒绝')}
                />
              ),
            },
          ]}
        />
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/** IDEA's Edit Commit Message for the last commit: an amend with nothing but the new message. */
export function RewordDialog({ target, head, onClose }: Props & { head: GitHeadCommit }) {
  const [message, setMessage] = useState(head.message.trim())
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  return (
    <Dialog
      open
      title={t('编辑提交说明')}
      message={head.shortHash}
      width={560}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('保存')),
          variant: 'primary',
          disabled: busy || !message.trim() || message.trim() === head.message.trim(),
          onClick: () =>
            void submit({
              action: 'commit',
              message: message.trim(),
              paths: [],
              amend: true,
              expectHead: head.hash,
            }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <TextField
          multiline
          rows={6}
          label={t('提交说明')}
          value={message}
          autoGrow
          onChange={(e) => setMessage(e.target.value)}
        />
        {head.pushed ? (
          <Alert variant="warning" description={t('该提交已推送，修改后需要强制推送才能更新远程')} />
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/** Finishing a merge stopped for conflicts: its commit, with the message git prepared. */
export function ContinueDialog({ target, ongoing, onClose }: Props & { ongoing: GitOngoing }) {
  const [message, setMessage] = useState(ongoing.message ?? '')
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  return (
    <Dialog
      open
      title={t('完成{op}', { op: ongoingLabel(ongoing.kind) })}
      message={ongoing.subject ?? undefined}
      width={560}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('提交')),
          variant: 'primary',
          disabled: busy,
          onClick: () =>
            void submit({ action: 'continue', ...(message.trim() && { message: message.trim() }) }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <TextField
          multiline
          rows={4}
          label={t('合并提交说明')}
          value={message}
          autoGrow
          onChange={(e) => setMessage(e.target.value)}
        />
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

export function NewTagDialog({ target, commit, onClose }: Props & { commit: CommitInfo | null }) {
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [name, setName] = useState('')
  const [at, setAt] = useState(commit?.hash ?? '')
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(false)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const n = name.trim()
  const invalid =
    badRefName(n) ?? (refs?.tags.some((tag) => tag.name === n) ? t('标签 {name} 已存在', { name: n }) : null)
  const remote = refs?.remotes.find((r) => r.name === 'origin')?.name ?? refs?.remotes[0]?.name ?? null
  return (
    <Dialog
      open
      title={t('新建标签')}
      message={commit ? `${commit.shortHash} ${commit.subject}` : t('标记当前 HEAD')}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('创建')),
          variant: 'primary',
          disabled: busy || !n || !!invalid,
          onClick: () =>
            void submit(
              {
                action: 'tag-create',
                name: n,
                ...(at.trim() && { commit: at.trim() }),
                ...(message.trim() && { message: message.trim() }),
              },
              (op) =>
                push && remote && op.status === 'succeeded'
                  ? runGitAction(
                      target.groupId,
                      target.botId,
                      inTarget(target, { action: 'tag-push', name: n, remote }),
                    )
                  : null,
            ),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <TextField
          label={t('标签名称')}
          value={name}
          autoFocus
          placeholder="v1.0.0"
          error={invalid ?? undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {commit ? null : (
          <RefCombo target={target} label={t('提交（留空为当前 HEAD）')} value={at} onChange={setAt} />
        )}
        <TextField
          multiline
          label={t('说明（填写后为附注标签）')}
          value={message}
          autoGrow
          onChange={(e) => setMessage(e.target.value)}
        />
        {remote ? (
          <Checkbox label={t('创建后推送到 {remote}', { remote })} checked={push} onChange={setPush} />
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

export function DeleteTagDialog({ target, name, onClose }: Props & { name: string }) {
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [remoteToo, setRemoteToo] = useState(false)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const remote = refs?.remotes.find((r) => r.name === 'origin')?.name ?? refs?.remotes[0]?.name ?? null
  return (
    <Dialog
      open
      title={t('删除标签 {name}', { name })}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('删除')),
          variant: 'destructive',
          disabled: busy,
          onClick: () => void submit({ action: 'tag-delete', name, ...(remoteToo && remote && { remote }) }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        {remote ? (
          <Checkbox
            label={t('同时从远程 {remote} 删除', { remote })}
            checked={remoteToo}
            onChange={setRemoteToo}
          />
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}
