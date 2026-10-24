import type { GitChangesDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { GitTabView } from '../../../app/workbench'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { Button, EmptyState, Tabs } from '../../../ui'
import { useWide } from '../../diff/DiffPane'
import { GitFileDiff } from '../../diff/GitFileDiff'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { gitBase, gitUrls, refreshGitQuietly, repoStatus, useGitGet } from '../../git/api'
import { fileOrder, type TreeChange, useChangeLayout } from '../../git/ChangeTree'
import { CommitView, changeGroups, OngoingBanner } from '../../git/CommitView'
import { gitCommands } from '../../git/commands'
import { GitOperationList, useGitOps } from '../../git/GitOperations'
import { GitToolbar } from '../../git/GitToolbar'
import { Split } from '../../git/Split'
import { StashView, stashDiff } from '../../git/StashView'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'
import { openFileAt } from './DiffTab'
import '../../git/git-tool.css'

/** Below this the picked file's diff opens in its own tab instead of beside the list. */
const WIDE_PX = 720

/**
 * A bot workspace's source control, IDEA's Commit window and VCS toolbar in one: the repo, its branch popup and sync
 * actions, a merge or rebase in progress, then 提交 (the change tree to pick and commit, the picked file's diff beside
 * it), 贮藏 and 记录 (the operation log with approvals). Non-owners request instead.
 */
export function GitTab({ tab, tabKey, active }: TabProps<'git'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const patch = useWorkbench((s) => s.patch)
  const git = useWorkspace((s) => s.botStates[groupId]?.[tab.botId]?.git ?? null)
  const name = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId)?.name) ?? 'Bot'
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root, WIDE_PX)
  const stamp = useGitStamp(groupId, tab.botId)
  const pending = useGitOps(groupId).filter(
    (o) => o.botId === tab.botId && o.status === 'pending_approval',
  ).length
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
  const view: GitTabView = tab.focus ? 'ops' : (tab.view ?? 'commit')
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
  const setView = (v: GitTabView) => patch(tabKey, { view: v, focus: null })
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

  const left: ReactNode = (
    <div className="wb-git__side">
      <div className="wb-git__views">
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
            {
              value: 'stash',
              label: git.stashes && !target.repo ? t('贮藏 · {n}', { n: git.stashes }) : t('贮藏'),
            },
            { value: 'ops', label: pending ? t('记录 · 待审批 {n}', { n: pending }) : t('记录') },
          ]}
        />
      </div>
      <div className="wb-git__view">
        {view === 'commit' ? (
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
        ) : view === 'stash' ? (
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
        ) : (
          <div className="wb-git__ops">
            <GitOperationList groupId={groupId} botId={tab.botId} focus={tab.focus ?? null} />
          </div>
        )}
      </div>
    </div>
  )

  const right: ReactNode =
    view === 'stash' ? (
      stashFile ? (
        <GitFileDiff key={stashFile.url} url={stashFile.url} path={stashFile.path} />
      ) : (
        <EmptyState compact icon="archive" title={t('展开一个贮藏，选择文件查看改动')} />
      )
    ) : picked && !picked.conflict ? (
      <GitFileDiff
        key={`${target.repo ?? ''}:${picked.path}`}
        url={gitUrls.diff(base, 'HEAD', null, picked.path, target.repo)}
        path={picked.path}
        stamp={stamp}
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
            <Button
              size="small"
              variant="plain"
              icon="undo"
              onClick={() => gitCommands(target).rollback([picked])}
            >
              {t('回滚')}
            </Button>
          )
        }
      />
    ) : data && conflict ? (
      <EmptyState
        compact
        icon="git-merge"
        title={t('{n} 个文件有冲突', { n: data.conflicts.length })}
        description={t('在合并工具里逐处选择保留哪一方，或手动编辑结果')}
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
        target={target}
        git={git}
        status={shownStatus}
        changes={data}
        onRepo={(r) => patch(tabKey, { repo: r, file: null })}
      />
      <OngoingBanner target={target} data={data} />
      <div className="wb-git__main">
        {wide ? (
          <Split
            storageKey="gg.git.commit-width"
            initial={360}
            min={260}
            label={t('调整列表宽度')}
            first={left}
            second={<div className="wb-git__diff">{right}</div>}
          />
        ) : (
          left
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
