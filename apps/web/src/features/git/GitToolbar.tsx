import type { GitChangesDto, GitStatus, RepoStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Icon, MenuButton, type MenuItem, PopUpButton, Spinner, Tooltip, toast } from '../../ui'
import { type GitTarget, refreshGit } from './api'
import { BranchPopup } from './BranchPopup'
import { gitCommands } from './commands'

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

/**
 * The Git tab's toolbar (IDEA's main toolbar VCS actions): repo, the branch popup with incoming / outgoing counts,
 * fetch, update, push, log, and the rest under ⋯.
 */
export function GitToolbar({
  target,
  git,
  status,
  changes,
  onRepo,
}: {
  target: GitTarget
  git: GitStatus
  status: RepoStatus
  changes: GitChangesDto | null
  onRepo: (repo: string | null) => void
}) {
  const [fetching, setFetching] = useState(false)
  const cmd = gitCommands(target)
  const repos = git.repos.length ? repoOptions(git) : []
  const head = target.repo ? (changes?.head?.shortHash ?? null) : (git.head ?? null)
  const last = changes?.head ?? null
  const fetchAll = async () => {
    setFetching(true)
    try {
      await refreshGit(target.groupId, target.botId, true)
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
      {repos.length ? (
        <PopUpButton
          size="small"
          aria-label={t('仓库')}
          value={target.repo ?? ''}
          onChange={(v) => onRepo(v || null)}
          options={repos}
        />
      ) : null}
      <BranchPopup target={target} status={status} git={git}>
        <Icon name="git-branch" size={13} />
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
      <span className="spacer" />
      <Tooltip content={t('获取远程更新')}>
        <button
          type="button"
          className="gtb-btn"
          aria-label={fetching ? t('正在获取远程更新…') : t('获取远程更新')}
          disabled={fetching}
          onClick={() => void fetchAll()}
        >
          {fetching ? <Spinner size={12} /> : <Icon name="arrow-clockwise" size={14} />}
        </button>
      </Tooltip>
      <button type="button" className="gtb-btn gtb-btn--text" onClick={cmd.pull}>
        <Icon name="arrow-down" size={14} />
        {t('更新…')}
      </button>
      <button type="button" className="gtb-btn gtb-btn--text" onClick={() => cmd.push()}>
        <Icon name="arrow-up" size={14} />
        {t('推送…')}
        {status.ahead == null && status.branch ? (
          <span className="gtb-note">{t('未发布#branch')}</span>
        ) : status.ahead ? (
          <span className="gtb-note">↑{status.ahead}</span>
        ) : null}
      </button>
      <Tooltip content={t('提交历史')}>
        <button type="button" className="gtb-btn" aria-label={t('提交历史')} onClick={() => cmd.openLog({})}>
          <Icon name="clock" size={14} />
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
