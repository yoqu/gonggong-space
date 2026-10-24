import { type GitActionInput, type GitLogDto, type GitOperationDto, isGitRefName } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../../i18n'
import { Alert, Checkbox, Dialog, Spinner, TextField } from '../../../ui'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { type GitTarget, gitBase, gitUrls, shortRev, useGitGet, useGitRefs } from '../api'
import { gitCommands } from '../commands'
import { trackDeleted } from '../notify'
import { splitRemote } from '../refs'
import {
  badRefName,
  CommitList,
  GitError,
  OwnerNote,
  RefCombo,
  useActionLabel,
  useGitRun,
  useRepoStatus,
} from './common'

interface Props {
  target: GitTarget
  onClose: () => void
}

/** A detached checkout (what that means said first), or anyone's but the owner's: a request, changes kept. */
export function CheckoutDialog({ target, rev, detach, onClose }: Props & { rev: string; detach: boolean }) {
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  return (
    <Dialog
      open
      title={t('检出 {ref}', { ref: rev })}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('检出')),
          variant: 'primary',
          disabled: busy,
          onClick: () => void submit({ action: 'checkout', branch: rev, detach }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        {detach ? (
          <Alert description={t('将处于游离 HEAD 状态：新的提交不属于任何分支，切走前记得新建分支保存')} />
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/** The checkout `op` asked for again, `more` deciding what stopped it. */
function retry(
  op: GitOperationDto,
  more: Partial<Extract<GitActionInput, { action: 'checkout' }>>,
): GitActionInput {
  const mode = op.args?.mode
  return {
    action: 'checkout',
    branch: op.branch ?? '',
    ...(op.args?.detach && { detach: true }),
    ...((mode === 'smart' || mode === 'force') && { mode }),
    ...(op.args?.localCommits && { localCommits: op.args.localCommits }),
    ...more,
  }
}

/**
 * IDEA's Git Checkout Problem: local changes the checkout would overwrite, listed; a smart checkout keeps them (stash,
 * switch, restore), a force one loses them, asked twice.
 */
export function CheckoutProblemDialog({ target, op, onClose }: Props & { op: GitOperationDto }) {
  const [sure, setSure] = useState(false)
  const { busy, error, submit } = useGitRun(target, onClose)
  const checkout = (mode: 'smart' | 'force') => void submit(retry(op, { mode }))
  return (
    <Dialog
      open
      title={t('Git 检出问题')}
      message={t('检出 {branch} 会覆盖以下文件的本地改动', { branch: shortRev(op.branch ?? '') })}
      width={520}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('不检出'), onClick: onClose },
        {
          label: sure ? t('确认强制检出') : t('强制检出'),
          variant: 'destructive',
          disabled: busy,
          onClick: () => (sure ? checkout('force') : setSure(true)),
        },
        { label: t('智能检出'), variant: 'primary', disabled: busy, onClick: () => checkout('smart') },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <ul className="git-paths" aria-label={t('会被覆盖的文件')}>
          {(op.detail?.paths ?? []).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Choice title={t('智能检出')} detail={t('先贮藏改动，切换后再恢复；恢复有冲突时留给你解决')} />
        <Choice title={t('强制检出')} detail={t('丢弃未提交的改动，无法恢复')} danger />
        {sure ? <Alert variant="warning" description={t('这些文件的本地改动会丢失，无法恢复')} /> : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/**
 * A remote branch checked out whose local one has commits of its own: rebased onto the remote one, or dropped (asked
 * twice).
 */
export function DivergedDialog({ target, op, onClose }: Props & { op: GitOperationDto }) {
  const [sure, setSure] = useState(false)
  const { busy, error, submit } = useGitRun(target, onClose)
  const remote = op.branch ?? ''
  const local = remote.slice(remote.indexOf('/') + 1)
  const ahead = op.detail?.ahead ?? 0
  const checkout = (localCommits: 'rebase' | 'drop') => void submit(retry(op, { localCommits }))
  return (
    <Dialog
      open
      title={t('本地分支 {local} 与 {remote} 已分叉', { local, remote })}
      message={t('本地独有 {ahead} 个提交，远程独有 {behind} 个提交', {
        ahead,
        behind: op.detail?.behind ?? 0,
      })}
      width={520}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: sure ? t('确认丢弃本地提交') : t('丢弃本地提交'),
          variant: 'destructive',
          disabled: busy,
          onClick: () => (sure ? checkout('drop') : setSure(true)),
        },
        { label: t('变基到远程'), variant: 'primary', disabled: busy, onClick: () => checkout('rebase') },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <Choice
          title={t('变基到远程')}
          detail={t('把 {local} 独有的提交重放到 {remote} 之后', { local, remote })}
        />
        <Choice
          title={t('丢弃本地提交')}
          detail={t('把 {local} 重置为 {remote}', { local, remote })}
          danger
        />
        {sure ? (
          <Alert
            variant="warning"
            description={t('{local} 独有的 {n} 个提交会被丢弃，只能从引用日志找回', { local, n: ahead })}
          />
        ) : null}
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

/** An option, a radio's or a dialog button's: a title and its explanation. */
export function Choice({ title, detail, danger }: { title: string; detail: string; danger?: boolean }) {
  return (
    <span className="git-choice">
      <span className="git-choice__title" data-danger={danger || undefined}>
        {title}
      </span>
      <span className="git-choice__detail">{detail}</span>
    </span>
  )
}

/** IDEA's Checkout Tag or Revision: anything not a local or remote branch is checked out detached. */
export function RevisionDialog({ target, onClose }: Props) {
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [rev, setRev] = useState('')
  const ref = rev.trim()
  const branch = refs?.branches.some((b) => b.name === ref)
  return (
    <Dialog
      open
      title={t('检出标签或修订')}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('检出'),
          variant: 'primary',
          disabled: !ref,
          onClick: () => {
            onClose()
            gitCommands(target).checkout(ref, !branch)
          },
        },
      ]}
    >
      <div className="git-form">
        <RefCombo target={target} label={t('标签、分支或提交哈希')} value={rev} onChange={setRev} />
      </div>
    </Dialog>
  )
}

/**
 * IDEA's Create New Branch: a remote branch's name offered without its remote; names checked as typed — git's rules, a
 * clash with a branch folder (`feat` vs `feat/x`) — and an existing branch replaced only when ticked, never the current
 * one.
 */
export function NewBranchDialog({ target, from, onClose }: Props & { from: string | null }) {
  const status = useRepoStatus(target)
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const [typed, setTyped] = useState<string | null>(null)
  const [start, setStart] = useState(from ?? '')
  const [checkout, setCheckout] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const s = start.trim()
  const remotes = refs?.remotes.map((r) => r.name) ?? []
  const fromRemote = refs?.branches.some((b) => b.kind === 'remote' && b.name === s)
  const name = typed ?? (fromRemote ? (splitRemote(s, remotes)?.branch ?? '') : '')
  const n = name.trim()
  const locals = refs?.branches.filter((b) => b.kind === 'local') ?? []
  const existing = locals.find((b) => b.name === n)
  const clash = locals.find((b) => b.name.startsWith(`${n}/`) || n.startsWith(`${b.name}/`))
  const invalid = !n
    ? null
    : !isGitRefName(n)
      ? t('无效的分支名')
      : clash
        ? t('与已有分支 {name} 冲突', { name: clash.name })
        : existing && (existing.current || existing.name === status?.branch)
          ? t('{name} 是当前分支，不能覆盖', { name: n })
          : null
  return (
    <Dialog
      open
      title={t('新建分支')}
      message={from ? t('从 {ref} 新建', { ref: from }) : t('从当前 HEAD 新建')}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('创建')),
          variant: 'primary',
          disabled: busy || !n || !!invalid || (!!existing && !overwrite),
          onClick: () =>
            void submit({
              action: 'branch-create',
              name: n,
              checkout,
              ...(s && { from: s }),
              ...(existing && { overwrite: true }),
            }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <TextField
          label={t('新分支名称')}
          value={name}
          autoFocus
          error={invalid ?? undefined}
          hint={existing ? t('分支 {name} 已存在', { name: n }) : undefined}
          placeholder="feature/…"
          onChange={(e) => setTyped(e.target.value)}
        />
        {existing && !invalid ? (
          <Checkbox label={t('覆盖已存在的分支')} checked={overwrite} onChange={setOverwrite} />
        ) : null}
        <RefCombo target={target} label={t('起点（留空为当前 HEAD）')} value={start} onChange={setStart} />
        <Checkbox label={t('创建后检出')} checked={checkout} onChange={setCheckout} />
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

export function RenameBranchDialog({ target, branch, onClose }: Props & { branch: string }) {
  const [name, setName] = useState(branch)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const n = name.trim()
  const invalid = badRefName(n)
  return (
    <Dialog
      open
      title={t('重命名分支 {branch}', { branch })}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(t('重命名')),
          variant: 'primary',
          disabled: busy || !n || n === branch || !!invalid,
          onClick: () => void submit({ action: 'branch-rename', branch, name: n }),
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <TextField
          label={t('新名称')}
          value={name}
          autoFocus
          error={invalid ?? undefined}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="git-form__hint">{t('只重命名本地分支；远程分支保持原名，下次推送时以新名称创建')}</p>
        <GitError error={error} />
      </div>
    </Dialog>
  )
}

const UNMERGED = /not fully merged|未完全合并/i
/** Unmerged commits listed at most, as IDEA. */
const LISTED = 20

/**
 * IDEA's Delete Branch: a local branch's commits not merged yet (into its upstream, else HEAD) are listed first and
 * deleting it anyway forces it; a remote-tracking one is deleted on its remote.
 */
export function DeleteBranchDialog({ target, branch, onClose }: Props & { branch: string }) {
  const status = useRepoStatus(target)
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs, error: refsError } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const ref = refs?.branches.find((b) => b.name === branch)
  const at = ref?.kind === 'remote' ? splitRemote(branch, refs?.remotes.map((r) => r.name) ?? []) : null
  const upstream = ref?.kind === 'local' ? ref.upstream : null
  const log = useGitGet<GitLogDto>(
    ref?.kind === 'local'
      ? gitUrls.log(gitBase(target.groupId, target.botId), `${upstream ?? 'HEAD'}..${branch}`, 0, target.repo)
      : null,
    stamp,
  )
  const commits = log.data?.commits ?? []
  // A log that can't be read leaves it to git, which refuses to delete unmerged commits.
  const unmerged = commits.length > 0 || (!!error && UNMERGED.test(error))
  const reading = (!refs && !refsError) || log.loading
  const tracked = refs?.branches.some((b) => b.kind === 'remote' && b.name === upstream) ? upstream : null
  return (
    <Dialog
      open
      title={t('删除分支 {branch}', { branch })}
      width={520}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: label(unmerged ? t('仍然删除') : t('删除')),
          variant: 'destructive',
          disabled: busy || reading,
          onClick: () => {
            trackDeleted(target, branch, tracked)
            void submit({ action: 'branch-delete', branch, force: unmerged })
          },
        },
      ]}
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <p className="git-form__summary">
          {at
            ? t('在远程 {remote} 上删除分支 {branch}，其他人将无法再拉取它', at)
            : t('删除本地分支 {branch}', { branch })}
        </p>
        {log.loading ? (
          <div className="git-refs__note">
            <Spinner size={14} />
          </div>
        ) : null}
        {commits.length ? (
          <>
            <Alert
              variant="warning"
              description={t('{n} 个提交未合并到 {target}', {
                n: log.data?.hasMore ? `${commits.length}+` : commits.length,
                target: upstream ?? status?.branch ?? 'HEAD',
              })}
            />
            <section className="git-push__commits" aria-label={t('未合并的提交')}>
              <CommitList
                commits={commits.slice(0, LISTED)}
                more={commits.length > LISTED || !!log.data?.hasMore}
              />
            </section>
          </>
        ) : null}
        {unmerged && !commits.length ? (
          <Alert
            variant="warning"
            description={t('{branch} 有尚未合并的提交，删除后这些提交只能从引用日志找回', { branch })}
          />
        ) : (
          <GitError error={error} />
        )}
      </div>
    </Dialog>
  )
}
