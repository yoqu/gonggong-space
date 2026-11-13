import type { GitActionKind, GitChangesDto, GitStatus, RepoStatus } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Icon, MenuButton, type MenuItem, Tooltip, toast, useFlash } from '../../ui'
import { type GitTarget, refreshGit } from './api'
import { BranchPopup } from './BranchPopup'
import { gitCommands } from './commands'
import { GitGlyph, type GitGlyphState } from './GitGlyph'

/** How a repo of the workspace is named: an additional directory or extra repo (absolute) by its last segment. */
export const repoLabel = (path: string | null) =>
  !path
    ? t('主仓库')
    : /^([a-z]:)?[\\/]/i.test(path)
      ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? path)
      : path

/** The repos of a workspace to pick from: the root (when it is one) first, then submodules, nested and extra ones. */
export function repoOptions(git: GitStatus) {
  const root = git.branch != null || git.head != null || !git.repos.length
  return [
    ...(root ? [{ value: '', label: t('主仓库') }] : []),
    ...git.repos.map((r) => ({
      value: r.path,
      label: r.kind === 'extra' ? `${r.path} · ${t('附加目录#one')}` : r.path,
    })),
  ]
}

/** The branch as the widget shows it: its name, or the detached commit. */
export function BranchName({ status, head }: { status: RepoStatus; head?: string | null }) {
  if (status.branch) return <span>{status.branch}</span>
  return <span>{head ? t('{hash}（游离）', { hash: head }) : t('游离')}</span>
}

/** A toolbar button's state from the bot's operations of `action` on this repo: busy while one runs, done a moment after it succeeds. */
function useActionState(target: GitTarget, action: GitActionKind): GitGlyphState {
  const ops = useWorkspace((s) => s.gitOps[target.groupId])
  const mine = ops?.filter((o) => o.botId === target.botId && o.repo === target.repo && o.action === action)
  const running = mine?.find((o) => o.status === 'running')?.id ?? null
  const [done, flash] = useFlash()
  const watched = useRef<string | null>(null)
  const settled = mine?.find((o) => o.id === watched.current)?.status
  useEffect(() => {
    if (running) watched.current = running
    else if (watched.current && settled !== 'running') {
      watched.current = null
      if (settled === 'succeeded') flash()
    }
  }, [running, settled, flash])
  return running ? 'busy' : done ? 'done' : 'idle'
}

/**
 * The Git tab's toolbar: its views, then IDEA's main toolbar VCS actions — the branch popup (which also switches the
 * repo of a multi-repo workspace) with incoming / outgoing counts, fetch, update, push, and the rest under ⋯.
 */
export function GitToolbar({
  views,
  target,
  git,
  status,
  changes,
  onRepo,
}: {
  views: ReactNode
  target: GitTarget
  git: GitStatus
  status: RepoStatus
  changes: GitChangesDto | null
  onRepo: (repo: string | null) => void
}) {
  const [fetching, setFetching] = useState(false)
  const [fetched, flashFetched] = useFlash()
  const pull = useActionState(target, 'pull')
  const push = useActionState(target, 'push')
  const cmd = gitCommands(target)
  const head = target.repo ? (changes?.head?.shortHash ?? null) : (git.head ?? null)
  const last = changes?.head ?? null
  const pushLabel = status.ahead == null && status.branch ? t('推送…（未发布）') : t('推送…')
  const fetchAll = async () => {
    setFetching(true)
    try {
      await refreshGit(target.groupId, target.botId, true)
      flashFetched()
      toast({ type: 'success', message: t('获取完成') })
    } catch (e) {
      toastError(e)
    }
    setFetching(false)
  }
  const more: MenuItem[] = [
    { value: 'branch', label: t('新建分支…'), icon: 'git-branch' },
    { value: 'revision', label: t('检出标签或修订…'), icon: 'tag' },
    { separator: true },
    { value: 'pull', label: t('拉取…'), icon: 'arrow-down' },
    { value: 'merge', label: t('合并…'), icon: 'git-merge' },
    { value: 'rebase', label: t('变基…') },
    { value: 'tag', label: t('新建标签…'), icon: 'tag' },
    { separator: true },
    { value: 'reword', label: t('编辑上一次提交说明…'), disabled: !last },
    { value: 'undo', label: t('撤销上一次提交…'), icon: 'undo', disabled: !last },
    { separator: true },
    { value: 'stash', label: t('贮藏改动…'), icon: 'archive' },
    { value: 'files', label: t('浏览此版本的文件'), icon: 'folder', disabled: !!target.repo },
  ]
  const onMore = (v: string) => {
    if (v === 'branch') cmd.newBranch()
    else if (v === 'revision') cmd.checkoutRevision()
    else if (v === 'pull') cmd.pullRemote()
    else if (v === 'merge') cmd.merge()
    else if (v === 'rebase') cmd.rebase()
    else if (v === 'tag') cmd.newTag()
    else if (v === 'reword' && last) cmd.reword(last)
    else if (v === 'undo' && last) cmd.undoCommit(last)
    else if (v === 'stash') cmd.stash()
    else if (v === 'files') cmd.browse(status.branch ?? 'HEAD')
  }
  return (
    <div className="wb-git__bar" role="toolbar" aria-label={t('Git 工具栏')}>
      {views}
      <span className="spacer" />
      <BranchPopup target={target} status={status} git={git} onRepo={onRepo}>
        <Icon name="git-branch" size={13} />
        {git.repos.length ? <span className="gb-trigger__repo">{repoLabel(target.repo)}</span> : null}
        <BranchName status={status} head={head} />
      </BranchPopup>
      {status.behind ? (
        <span
          className="gtb-count gtb-count--in"
          role="img"
          aria-label={t('落后 {n} 个提交', { n: status.behind })}
        >
          ↓{status.behind}
        </span>
      ) : null}
      {status.ahead ? (
        <span
          className="gtb-count gtb-count--out"
          role="img"
          aria-label={t('领先 {n} 个提交', { n: status.ahead })}
        >
          ↑{status.ahead}
        </span>
      ) : null}
      <span className="gtb-sep" />
      <Tooltip content={t('获取远程更新')}>
        <button
          type="button"
          className="gtb-btn"
          aria-label={fetching ? t('正在获取远程更新…') : t('获取远程更新')}
          aria-busy={fetching || undefined}
          disabled={fetching}
          onClick={() => void fetchAll()}
        >
          <GitGlyph kind="fetch" state={fetching ? 'busy' : fetched ? 'done' : 'idle'} />
        </button>
      </Tooltip>
      <Tooltip content={pull === 'busy' ? t('正在更新…') : t('更新…')}>
        <button
          type="button"
          className="gtb-btn gtb-btn--in"
          aria-label={pull === 'busy' ? t('正在更新…') : t('更新…')}
          aria-busy={pull === 'busy' || undefined}
          disabled={pull === 'busy'}
          onClick={cmd.pull}
        >
          <GitGlyph kind="pull" state={pull} />
        </button>
      </Tooltip>
      <Tooltip content={push === 'busy' ? t('正在推送…') : pushLabel}>
        <button
          type="button"
          className="gtb-btn gtb-btn--out"
          aria-label={push === 'busy' ? t('正在推送…') : pushLabel}
          aria-busy={push === 'busy' || undefined}
          disabled={push === 'busy'}
          onClick={() => cmd.push()}
        >
          <GitGlyph kind="push" state={push} />
        </button>
      </Tooltip>
      <MenuButton
        className="gtb-btn"
        aria-label={t('更多 Git 操作')}
        align="end"
        items={more}
        onSelect={onMore}
      >
        <Icon name="more" size={14} />
      </MenuButton>
    </div>
  )
}
