import { useState } from 'react'
import { t } from '../../../i18n'
import { Button, Checkbox, Dialog, PopUpButton, RadioGroup, TextField } from '../../../ui'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { type GitTarget, useGitRefs } from '../api'
import { gitCommands } from '../commands'
import { Choice } from './BranchDialogs'
import { GitError, OwnerNote, RefCombo, useActionLabel, useGitRun, useRepoStatus } from './common'

interface Props {
  target: GitTarget
  onClose: () => void
}

type PullMode = 'ff-only' | 'merge' | 'rebase'
const PULL_MODE = 'gg.git.pull-mode'
const savedPullMode = (): PullMode => {
  const v = localStorage.getItem(PULL_MODE)
  return v === 'ff-only' || v === 'rebase' ? v : 'merge'
}

/** How the Update and Pull dialogs bring commits in; the choice is remembered for both. */
function usePullMode() {
  const [mode, setMode] = useState<PullMode>(savedPullMode)
  const pick = (m: PullMode) => {
    setMode(m)
    try {
      localStorage.setItem(PULL_MODE, m)
    } catch {
      // the choice lasts for this dialog only
    }
  }
  return [mode, pick] as const
}

function PullModes({
  label,
  value,
  onChange,
}: {
  label: string
  value: PullMode
  onChange: (m: PullMode) => void
}) {
  return (
    <RadioGroup<PullMode>
      aria-label={label}
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'merge',
          label: <Choice title={t('合并')} detail={t('把上游的提交合并进来，分叉时生成合并提交')} />,
        },
        {
          value: 'rebase',
          label: <Choice title={t('变基')} detail={t('把本地提交重放到上游之后，历史保持一条直线')} />,
        },
        {
          value: 'ff-only',
          label: <Choice title={t('仅快进')} detail={t('只在没有分叉时更新，分叉时拒绝')} />,
        },
      ]}
    />
  )
}

/**
 * IDEA's Update Project: the upstream's commits merged (its default), rebased onto or fast-forwarded, local changes
 * stashed around it in any case. Without an upstream the Pull dialog picks a branch instead.
 */
export function UpdateDialog({ target, onClose }: Props) {
  const status = useRepoStatus(target)
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [mode, pick] = usePullMode()
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const branch = status?.branch ?? null
  const upstream = refs?.branches.find((b) => b.kind === 'local' && b.current)?.upstream ?? null
  return (
    <Dialog
      open
      title={branch ? t('更新 {branch}', { branch }) : t('更新')}
      message={
        upstream
          ? t('从 {upstream} 获取{n}', {
              upstream,
              n: status?.behind ? t('（落后 {n} 个提交）', { n: status.behind }) : '',
            })
          : refs
            ? t('当前分支没有上游分支')
            : undefined
      }
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('更新')),
          variant: 'primary',
          disabled: busy || !branch || (!!refs && !upstream),
          onClick: () => void submit({ action: 'pull', mode }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        {refs && !upstream && branch ? (
          <Button
            size="small"
            variant="plain"
            className="git-form__link"
            onClick={() => {
              onClose()
              gitCommands(target).pullRemote()
            }}
          >
            {t('从远程分支拉取…')}
          </Button>
        ) : null}
        <PullModes label={t('更新方式')} value={mode} onChange={pick} />
        <p className="git-form__hint">{t('本地改动会先贮藏，更新后自动恢复')}</p>
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/**
 * IDEA's Pull: a branch of a remote (default the current branch's upstream; one must be picked without it) merged,
 * rebased onto or fast-forwarded into the current branch; any other than the upstream is sent as `from`.
 */
export function PullDialog({ target, onClose }: Props) {
  const status = useRepoStatus(target)
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [mode, pick] = usePullMode()
  const [remote, setRemote] = useState<string | null>(null)
  // undefined: the upstream's, until a branch of this remote is picked.
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const branch = status?.branch ?? null
  const upstream = refs?.branches.find((b) => b.kind === 'local' && b.current)?.upstream ?? null
  const remotes = refs?.remotes ?? []
  const upstreamRemote = upstream ? remotes.find((r) => upstream.startsWith(`${r.name}/`))?.name : null
  const at =
    remote ?? upstreamRemote ?? remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? null
  const options = (refs?.branches ?? [])
    .filter((b) => b.kind === 'remote' && !!at && b.name.startsWith(`${at}/`) && !b.name.endsWith('/HEAD'))
    .map((b) => b.name.slice((at?.length ?? 0) + 1))
  const fallback = upstream && at && upstreamRemote === at ? upstream.slice(at.length + 1) : null
  const picked = chosen ?? fallback
  const from = at && picked ? `${at}/${picked}` : null
  return (
    <Dialog
      open
      title={t('拉取到 {branch}', { branch: branch ?? 'HEAD' })}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('拉取')),
          variant: 'primary',
          disabled: busy || !branch || !from,
          onClick: () => void submit({ action: 'pull', mode, ...(from && from !== upstream && { from }) }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <div className="git-form__row git-pull__refs">
          <PopUpButton
            aria-label={t('远程')}
            value={at}
            placeholder={t('远程')}
            onChange={(v) => {
              setRemote(v)
              setChosen(undefined)
            }}
            options={remotes.map((r) => ({ value: r.name, label: r.name }))}
          />
          <PopUpButton
            aria-label={t('分支')}
            value={picked}
            placeholder={t('选择分支')}
            onChange={setChosen}
            options={options.map((b) => ({ value: b, label: b }))}
          />
        </div>
        {refs && !upstream ? (
          <p className="git-form__hint">{t('当前分支没有上游分支，选择要拉取的远程分支')}</p>
        ) : null}
        <PullModes label={t('拉取方式')} value={mode} onChange={pick} />
        <p className="git-form__hint">{t('本地改动会先贮藏，拉取后自动恢复')}</p>
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

type MergeMode = 'default' | 'no-ff' | 'ff-only' | 'squash'

export function MergeDialog({ target, branch: start, onClose }: Props & { branch: string | null }) {
  const status = useRepoStatus(target)
  const [branch, setBranch] = useState(start ?? '')
  const [mode, setMode] = useState<MergeMode>('default')
  const [noCommit, setNoCommit] = useState(false)
  const [message, setMessage] = useState('')
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const current = status?.branch ?? 'HEAD'
  const ref = branch.trim()
  return (
    <Dialog
      open
      title={t('合并到 {branch}', { branch: current })}
      width={520}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('合并')),
          variant: 'primary',
          disabled: busy || !ref || ref === current,
          onClick: () =>
            void submit({
              action: 'merge',
              branch: ref,
              mode,
              noCommit,
              ...(message.trim() && { message: message.trim() }),
            }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <RefCombo target={target} label={t('要合并的分支或提交')} value={branch} onChange={setBranch} />
        <RadioGroup<MergeMode>
          aria-label={t('合并方式')}
          value={mode}
          onChange={setMode}
          options={[
            {
              value: 'default',
              label: <Choice title={t('默认')} detail={t('能快进就快进，否则生成合并提交')} />,
            },
            { value: 'no-ff', label: <Choice title={t('总是生成合并提交')} detail="--no-ff" /> },
            { value: 'ff-only', label: <Choice title={t('仅快进')} detail="--ff-only" /> },
            {
              value: 'squash',
              label: <Choice title={t('压缩为一次改动')} detail={t('--squash：改动留在工作区，由你提交')} />,
            },
          ]}
        />
        {mode !== 'squash' && mode !== 'ff-only' ? (
          <>
            <Checkbox label={t('合并后先不提交（--no-commit）')} checked={noCommit} onChange={setNoCommit} />
            <TextField
              multiline
              label={t('合并提交说明（可选）')}
              value={message}
              autoGrow
              onChange={(e) => setMessage(e.target.value)}
            />
          </>
        ) : null}
        {status?.dirty ? (
          <p className="git-form__hint">{t('工作区有未提交的改动，与合并冲突时 git 会拒绝')}</p>
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

export function RebaseDialog({
  target,
  onto: start,
  branch,
  onClose,
}: Props & { onto: string | null; branch: string | null }) {
  const status = useRepoStatus(target)
  const [onto, setOnto] = useState(start ?? '')
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const moved = branch ?? status?.branch ?? 'HEAD'
  const ref = onto.trim()
  return (
    <Dialog
      open
      title={t('将 {branch} 变基', { branch: moved })}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('变基')),
          variant: 'primary',
          disabled: busy || !ref || ref === moved,
          onClick: () => void submit({ action: 'rebase', onto: ref, ...(branch && { branch }) }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <RefCombo target={target} label={t('变基到')} value={onto} onChange={setOnto} />
        <p className="git-form__hint">
          {t('{branch} 上独有的提交会逐个重放到 {onto} 之后；已推送的提交变基后需要强制推送', {
            branch: moved,
            onto: ref || '…',
          })}
        </p>
        {branch && branch !== status?.branch ? (
          <p className="git-form__hint">{t('会先检出 {branch}', { branch })}</p>
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}
