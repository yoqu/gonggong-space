import type { GitChangesDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { GitLogState, GitTabView } from '../../../app/workbench'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { Button, EmptyState, Tabs } from '../../../ui'
import { useWide } from '../../diff/DiffPane'
import { GitFileDiff } from '../../diff/GitFileDiff'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { gitBase, gitUrls, refreshGitQuietly, repoStatus, useGitGet } from '../../git/api'
import { fileOrder, type TreeChange, useChangeLayout } from '../../git/ChangeTree'
import { CommitView, changeGroups, OngoingBanner, ToolIcon } from '../../git/CommitView'
import { gitCommands } from '../../git/commands'
import { PendingOps, useGitOps } from '../../git/GitOperations'
import { GitToolbar } from '../../git/GitToolbar'
import type { LogTab } from '../../git/log/query'
import { Split } from '../../git/Split'
import { StashView, stashDiff } from '../../git/StashView'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'
import { openFileAt } from './DiffTab'
import { GitLog } from './GitLogTab'
import '../../git/git-tool.css'

/** Below this the picked file's diff opens in its own tab instead of beside the list. */
const WIDE_PX = 720

/**
 * A bot workspace's source control, IDEA's Commit window, Git Log and VCS toolbar in one: the views, the repo, its
 * branch popup and sync actions, requests awaiting approval, a merge or rebase in progress, then 提交 (the change tree
 * to pick and commit, the picked file's diff beside it), 日志 or 贮藏. Non-owners request instead.
 */
export function GitTab({ tab, tabKey, active }: TabProps<'git'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const patch = useWorkbench((s) => s.patch)
  const git = useWorkspace((s) => s.botStates[groupId]?.[tab.botId]?.git ?? null)
  const name = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId)?.name) ?? 'Bot'
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root, WIDE_PX)
  const stamp = useGitStamp(groupId, tab.botId)
  const repo = git && tab.repo && git.repos.some((r) => r.path === tab.repo) ? tab.repo : null
  const status = git ? repoStatus(git, repo) : null
  // A workspace whose root is no repo opens on its first sub-repo.
  const fallback = git && !status && !repo ? (git.repos[0]?.path ?? null) : null
  const target = { groupId, botId: tab.botId, repo: repo ?? fallback }
  const shownStatus = git ? repoStatus(git, target.repo) : null
  const base = gitBase(groupId, tab.botId)
  const changes = useGitGet<GitChangesDto>(
    active && shownStatus ? gitUrls.changes(base, target.repo) : null,
    stamp,
  )
  // Views since removed (记录, 控制台) reopen on 提交.
  const view: GitTabView = tab.view === 'log' || tab.view === 'stash' ? tab.view : 'commit'
  const [stashFile, setStashFile] = useState<{ stash: string; path: string; url: string } | null>(null)
  const layout = useChangeLayout((s) => s.layout)
  // A file reached by stepping (F7, ⌥⇧→…) lands on its first (1) or last (-1) change.
  const [start, setStart] = useState<1 | -1>()

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh once each time the tab is shown
  useEffect(() => {
    if (active && git) refreshGitQuietly(groupId, tab.botId)
  }, [active, groupId, tab.botId])

  if (!git || !shownStatus)
    return (
      <div className="wb-git">
        <EmptyState compact icon="git-branch" title={t('{name} 的工作区还没有 Git 仓库', { name })} />
      </div>
    )

  const data = changes.data
  const all: TreeChange[] = data
    ? [
        ...data.changes,
        ...data.conflicts.map((c) => ({ path: c.path, change: 'modified' as const, conflict: c })),
      ]
    : []
  const picked = all.find((c) => c.path === tab.file) ?? (wide ? all.find((c) => !c.conflict) : undefined)
  const setView = (v: GitTabView) => patch(tabKey, { view: v })
  // Selecting only shows a change (beside the list when wide); opening it is the commit view's double click or Enter.
  const select = (c: TreeChange) => {
    setStart(undefined)
    patch(tabKey, { file: c.path })
  }
  const order = data ? fileOrder(changeGroups(data), layout).filter((c) => !c.conflict) : []
  const at = picked ? order.findIndex((c) => c.path === picked.path) : -1
  const stepTo = (c: TreeChange | undefined) =>
    c &&
    ((land: 1 | -1) => {
      setStart(land)
      patch(tabKey, { file: c.path })
    })
  const inWorkspace = (path: string) => (target.repo ? `${target.repo}/${path}` : path)
  const conflict = picked?.conflict ? picked.path : data?.conflicts[0]?.path

  const views = (
    <Tabs<GitTabView>
      size="sm"
      aria-label={t('Git 视图')}
      value={view}
      onChange={setView}
      items={[
        {
          value: 'commit',
          label: data?.changes.length ? t('提交 · {n}', { n: data.changes.length }) : t('提交'),
        },
        { value: 'log', label: t('日志#git') },
        {
          value: 'stash',
          label: git.stashes && !target.repo ? t('贮藏 · {n}', { n: git.stashes }) : t('贮藏'),
        },
      ]}
    />
  )

  const left: ReactNode =
    view === 'commit' ? (
      <CommitView
        target={target}
        data={data}
        error={changes.error}
        selected={picked?.path ?? null}
        onSelect={select}
        onReload={() => {
          changes.reload()
          refreshGitQuietly(groupId, tab.botId)
        }}
      />
    ) : (
      <StashView
        target={target}
        stamp={stamp}
        selected={stashFile}
        onPick={(s, c) => {
          const url = stashDiff(target, s, c)
          if (wide) setStashFile({ stash: s.hash, path: c.path, url })
          else
            openTab({
              kind: 'git-compare',
              botId: tab.botId,
              repo: target.repo,
              from: `${s.hash}^1`,
              to: s.hash,
              file: c.path,
            })
        }}
      />
    )

  const log: LogTab = {
    kind: 'git-log',
    botId: tab.botId,
    repo: target.repo,
    ref: null,
    commit: null,
    ...tab.log,
  }
  /** The log as stored now: filters set from a timer must not overwrite a newer change. */
  const currentLog = (): LogTab => {
    const now = useWorkbench
      .getState()
      .benches[groupId]?.tabs.find((x) => x.kind === 'git' && x.botId === tab.botId)
    return now?.kind === 'git' ? { ...log, repo: now.repo ?? null, ...now.log } : log
  }
  const updateLog = ({ repo: r, ...fields }: Partial<LogTab>) => {
    const { kind: _k, botId: _b, scope: _s, repo: _r, ...was } = currentLog()
    const next: GitLogState = { ...was, ...fields }
    patch(tabKey, { log: next, ...(r !== undefined ? { repo: r, file: null } : {}) })
  }

  const right: ReactNode =
    view === 'stash' ? (
      stashFile ? (
        <GitFileDiff key={stashFile.url} url={stashFile.url} path={stashFile.path} />
      ) : (
        <EmptyState compact icon="archive" title={t('选择一个文件查看改动')} />
      )
    ) : picked && !picked.conflict ? (
      <GitFileDiff
        key={`${target.repo ?? ''}:${picked.path}`}
        url={gitUrls.diff(base, 'HEAD', null, picked.path, target.repo, picked.oldPath)}
        path={picked.path}
        stamp={stamp}
        revert={target}
        files={order.length > 1 ? { prev: stepTo(order[at - 1]), next: stepTo(order[at + 1]) } : undefined}
        start={start}
        onOpenLine={
          picked.change === 'deleted'
            ? undefined
            : (line) => openFileAt(tab.botId, inWorkspace(picked.path), line)
        }
        actions={
          // An untracked file has nothing to roll back to.
          picked.untracked ? undefined : (
            <ToolIcon icon="undo" label={t('回滚')} onClick={() => gitCommands(target).rollback([picked])} />
          )
        }
      />
    ) : data && conflict ? (
      <EmptyState
        compact
        icon="git-merge"
        title={t('{n} 个文件有冲突', { n: data.conflicts.length })}
        action={
          <Button variant="primary" onClick={() => gitCommands(target).openMerge(conflict)}>
            {t('解决冲突')}
          </Button>
        }
      />
    ) : (
      <EmptyState compact icon="doc-text" title={t('选择一个文件查看改动')} />
    )

  return (
    <div ref={root} className="wb-git" data-layout={wide ? 'wide' : 'narrow'} data-testid="git-tab">
      <GitToolbar
        views={views}
        target={target}
        git={git}
        status={shownStatus}
        changes={data}
        onRepo={(r) => patch(tabKey, { repo: r, file: null })}
      />
      <PendingOps groupId={groupId} botId={tab.botId} />
      <OngoingBanner target={target} data={data} />
      <div className="wb-git__main">
        {view === 'log' ? (
          <GitLog tab={log} current={currentLog} update={updateLog} active={active} />
        ) : wide ? (
          <Split
            storageKey="gg.git.commit-width"
            initial={360}
            min={260}
            label={t('调整列表宽度')}
            first={<div className="wb-git__side">{left}</div>}
            second={<div className="wb-git__diff">{right}</div>}
          />
        ) : (
          <div className="wb-git__side">{left}</div>
        )}
      </div>
    </div>
  )
}

export function useGitTabMeta(tab: TabProps<'git'>['tab']): TabMeta {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const name = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId)?.name) ?? 'Bot'
  const conflicts = useWorkspace((s) => s.botStates[groupId]?.[tab.botId]?.git?.conflicts ?? 0)
  const pending = useGitOps(groupId).filter(
    (o) => o.botId === tab.botId && o.status === 'pending_approval',
  ).length
  return {
    icon: 'git-branch',
    title: t('Git · {name}', { name }),
    badge: pending
      ? t('待审批 {n}', { n: pending })
      : conflicts
        ? t('冲突 {n}', { n: conflicts })
        : undefined,
  }
}
