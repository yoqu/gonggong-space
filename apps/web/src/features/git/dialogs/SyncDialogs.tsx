import type { GitLogDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { Alert, Checkbox, Dialog, PopUpButton, RadioGroup, Spinner, TextField } from '../../../ui'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { type GitTarget, gitBase, gitUrls, useGitGet, useGitRefs } from '../api'
import type { CommitInfo } from '../commands'
import { Choice } from './BranchDialogs'
import { CommitList, GitError, OwnerNote, RefCombo, useActionLabel, useGitRun, useRepoStatus } from './common'

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

/**
 * IDEA's Update Project: the upstream's commits merged (its default), rebased onto or fast-forwarded, local changes
 * stashed around it in any case; the choice is remembered.
 */
export function PullDialog({ target, onClose }: Props) {
  const status = useRepoStatus(target)
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [mode, setMode] = useState<PullMode>(savedPullMode)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const branch = status?.branch ?? null
  const upstream = refs?.branches.find((b) => b.kind === 'local' && b.current)?.upstream ?? null
  const pick = (m: PullMode) => {
    setMode(m)
    try {
      localStorage.setItem(PULL_MODE, m)
    } catch {
      // the choice lasts for this dialog only
    }
  }
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
        <RadioGroup<PullMode>
          aria-label={t('更新方式')}
          value={mode}
          onChange={pick}
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
        <p className="git-form__hint">{t('本地改动会先贮藏，更新后自动恢复')}</p>
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/** git's words for a push the remote refused because it moved on. */
const REJECTED = /rejected|non-fast-forward|fetch first|stale info/i

/**
 * IDEA's Push dialog: the commits going out, the remote, pushing tags too, and a force push (with lease) for history
 * rewritten by an amend or rebase; never for the protected base branch.
 */
export function PushDialog({
  target,
  branch: start,
  onClose,
}: Props & { branch: string | null; upTo?: CommitInfo }) {
  const status = useRepoStatus(target)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === target.groupId))
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [remote, setRemote] = useState<string | null>(null)
  const [branch, setBranch] = useState(start ?? status?.branch ?? '')
  const [tags, setTags] = useState(false)
  const [force, setForce] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const base = group?.protectBase ? (group.repo?.branch ?? null) : null
  const remotes = refs?.remotes ?? []
  const name = branch.trim()
  const local = refs?.branches.find((b) => b.kind === 'local' && b.name === name)
  const upstreamRemote = local?.upstream
    ? remotes.find((r) => local.upstream?.startsWith(`${r.name}/`))?.name
    : null
  const picked =
    remote ?? upstreamRemote ?? remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? 'origin'
  // As IDEA (and the daemon): a branch goes to its upstream when that is on the remote picked, else to its own name.
  const onto = upstreamRemote === picked && local?.upstream ? local.upstream.slice(picked.length + 1) : name
  const dest = `${picked}/${onto}`
  const published = !!refs?.branches.some((b) => b.kind === 'remote' && b.name === dest)
  const range = !name ? null : published ? `${dest}..${name}` : base ? `${picked}/${base}..${name}` : null
  const log = useGitGet<GitLogDto>(
    range ? gitUrls.log(gitBase(target.groupId, target.botId), range, 0, target.repo) : null,
    stamp,
  )
  const toBase = !!base && onto === base
  const rejected = !!error && REJECTED.test(error)
  const commits = log.data?.commits ?? []
  return (
    <Dialog
      open
      title={t('推送')}
      message={name ? t('{branch} → {dest}', { branch: name, dest }) : undefined}
      width={560}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(force ? t('强制推送') : t('推送')),
          variant: force || toBase ? 'destructive' : 'primary',
          disabled: busy || !name || (toBase && !confirmed),
          onClick: () =>
            void submit({
              action: 'push',
              remote: picked,
              branch: name,
              ...(onto !== name && { target: onto }),
              confirmBase: toBase,
              force,
              tags,
            }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <section className="git-push__commits" aria-label={t('待推送的提交')}>
          {!refs || log.loading ? (
            <div className="git-refs__note">
              <Spinner size={14} />
            </div>
          ) : !published && !commits.length ? (
            <p className="git-push__empty">
              {t('首次推送，会在远程创建 {branch} 并设为上游', { branch: name })}
            </p>
          ) : commits.length ? (
            <CommitList commits={commits} more={!!log.data?.hasMore} />
          ) : (
            <p className="git-push__empty">{t('{dest} 已包含全部提交，没有新的提交可推送', { dest })}</p>
          )}
        </section>
        <div className="git-form__row">
          <span className="git-form__label">{t('远程')}</span>
          {remotes.length > 1 ? (
            <PopUpButton
              aria-label={t('远程')}
              value={picked}
              onChange={setRemote}
              options={remotes.map((r) => ({ value: r.name, label: r.name }))}
            />
          ) : (
            <span className="git-refs__name">{picked}</span>
          )}
        </div>
        <TextField label={t('分支')} value={branch} onChange={(e) => setBranch(e.target.value)} />
        <Checkbox label={t('同时推送标签')} checked={tags} onChange={setTags} />
        {toBase ? (
          <Alert
            variant="warning"
            description={t('{branch} 是受保护的基准分支，推送会直接改动它', { branch: onto })}
          >
            <Checkbox label={t('我确认推送到基准分支')} checked={confirmed} onChange={setConfirmed} />
          </Alert>
        ) : (
          <Checkbox
            label={t('强制推送（--force-with-lease）')}
            checked={force}
            onChange={(on) => {
              setForce(on)
              setConfirmed(false)
            }}
          />
        )}
        {force ? (
          <Alert
            variant="warning"
            description={t('远程分支会被改成本地的历史，别人已推送但你还没获取的提交会让推送被拒绝')}
          />
        ) : null}
        {rejected && !force ? (
          <Alert variant="warning" description={t('远程有新的提交：先更新再推送，或改写过历史时强制推送')} />
        ) : (
          <GitError error={error} />
        )}
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
