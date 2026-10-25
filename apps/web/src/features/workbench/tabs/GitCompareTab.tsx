import type { GitCompareDto, GitShowDto } from '@gonggong/protocol'
import { useRef, useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { Button, EmptyState, type MenuItem, SegmentedControl, Spinner } from '../../../ui'
import { useWide } from '../../diff/DiffPane'
import { GitFileDiff } from '../../diff/GitFileDiff'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { type GitTarget, gitBase, gitUrls, repoStatus, useGitGet, useGitRefs } from '../../git/api'
import type { TreeChange } from '../../git/ChangeTree'
import { type GitCommands, gitCommands } from '../../git/commands'
import { ChangesPane } from '../../git/log/ChangesPane'
import { CommitDetails } from '../../git/log/CommitDetails'
import { CommitTable } from '../../git/log/CommitTable'
import { commitMenu, runCommitAction } from '../../git/log/commitMenu'
import { revLabel } from '../../git/log/query'
import { useLog } from '../../git/log/useLog'
import { Split } from '../../git/Split'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'
import '../../git/log.css'

/** Below this one pane takes the tab at a time. */
const WIDE_PX = 640
const NO_FILTER = {}
const NO_PICKS: ReadonlySet<string> = new Set()

type View = 'commits' | 'files'

/** The commits `range` (`a..b`) lists, picked to show their details, with the log's commit menu. */
function CommitsOnly({
  target,
  cmd,
  title,
  range,
  remotes,
  stamp,
  selected,
  shown,
  pickOnMenu,
  onSelect,
}: {
  target: GitTarget
  cmd: GitCommands
  title: string
  range: string
  remotes: readonly string[]
  stamp: string
  selected: string | null
  shown: GitShowDto | null
  pickOnMenu: boolean
  onSelect: (hash: string) => void
}) {
  const log = useLog(gitBase(target.groupId, target.botId), target.repo, range, NO_FILTER, stamp)
  const listed = (hashes: string[]) => log.commits.filter((c) => hashes.includes(c.hash))
  return (
    <section className="gcmp__column" aria-label={title}>
      <div className="gcmp__head">
        <span className="gcmp__title">{title}</span>
        {log.commits.length ? (
          <span className="gcmp__count">
            {log.commits.length}
            {log.hasMore ? '+' : ''}
          </span>
        ) : null}
      </div>
      <CommitTable
        commits={log.commits}
        remotes={remotes}
        partial
        selected={selected}
        picked={selected ? new Set([selected]) : NO_PICKS}
        onPick={onSelect}
        onGo={onSelect}
        menu={(hashes) =>
          commitMenu(listed(hashes), log.commits, {
            remotes,
            rootRepo: !target.repo,
            interactiveRebase: true,
          })
        }
        onMenuTarget={(hash) => {
          // On a phone the details would take the list, menu and all.
          if (pickOnMenu) onSelect(hash)
          return [hash]
        }}
        onMenu={(value, hashes) =>
          void runCommitAction(value, listed(hashes), {
            target,
            cmd,
            remotes,
            all: log.commits,
            shown,
            select: onSelect,
            branch: currentBranch(target),
          })
        }
        hasMore={log.hasMore}
        loading={log.loading}
        error={log.error}
        onMore={log.more}
        onRetry={log.retry}
        empty={t('没有独有的提交')}
        label={t('提交#commits')}
      />
    </section>
  )
}

/** The files `from` and `to` (null = the work tree) differ in, and the picked one's diff. */
function FilesDiffer({
  target,
  from,
  to,
  file,
  stamp,
  wide,
  onFile,
}: {
  target: GitTarget
  from: string
  to: string | null
  file: string | null
  stamp: string
  wide: boolean
  onFile: (path: string | null) => void
}) {
  const base = gitBase(target.groupId, target.botId)
  const inWorkspace = (path: string) => (target.repo ? `${target.repo}/${path}` : path)
  // The work tree changes under the bot; versions don't.
  const live = to ? '' : stamp
  const compare = useGitGet<GitCompareDto>(gitUrls.compare(base, from, to, target.repo), live)
  const list = compare.data?.changes ?? null
  const picked = list?.find((c) => c.path === file) ?? (wide ? list?.[0] : undefined)
  const openVersion = (c: TreeChange) =>
    openTab({
      kind: 'file',
      source: to
        ? { botId: target.botId, path: inWorkspace(c.path), rev: c.change === 'deleted' ? from : to }
        : { botId: target.botId, path: inWorkspace(c.path) },
    })
  const fileItems = (c: TreeChange): MenuItem[] => [
    {
      value: 'open',
      label: to ? t('打开此版本') : t('打开文件'),
      icon: 'doc',
      disabled: !to && c.change === 'deleted',
    },
  ]
  const files = (
    <ChangesPane
      target={target}
      changes={list}
      error={compare.error}
      selected={picked?.path ?? null}
      onSelect={(c) => onFile(c.path)}
      fileItems={fileItems}
      onFileItem={(v, c) => v === 'open' && openVersion(c)}
      group={t('更改')}
    />
  )
  const diff = picked ? (
    <GitFileDiff
      key={`${from}:${to ?? ''}:${picked.path}`}
      url={gitUrls.diff(base, from, to, picked.path, target.repo, picked.oldPath)}
      path={picked.path}
      stamp={live}
    />
  ) : (
    <EmptyState
      compact
      icon="doc-text"
      title={list && !list.length ? t('没有差异') : t('选择一个文件查看改动')}
    />
  )
  if (!wide)
    return file ? (
      <div className="glog-page">
        <div className="glog-page__bar">
          <Button
            size="small"
            variant="plain"
            icon="chevron-left"
            aria-label={t('返回文件列表')}
            onClick={() => onFile(null)}
          >
            {t('文件')}
          </Button>
          <span className="glog-page__title" title={file}>
            {file}
          </span>
        </div>
        <div className="glog-diff">{diff}</div>
      </div>
    ) : (
      <div className="gcmp__files">{files}</div>
    )
  return (
    <Split
      storageKey="gg.git.compare.files"
      initial={320}
      min={220}
      label={t('调整列表宽度')}
      first={<div className="gcmp__files">{files}</div>}
      second={<div className="glog-diff">{diff}</div>}
    />
  )
}

/**
 * IDEA's Compare with Current / Show Diff with Working Tree: `from ↔ to` (swappable), the commits only on either
 * side (提交) and the files that differ (文件); against the work tree (`to` null) files only.
 */
export function GitCompareTab({ tab, tabKey }: TabProps<'git-compare'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const patch = useWorkbench((s) => s.patch)
  const replace = useWorkbench((s) => s.replace)
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root, WIDE_PX)
  const stamp = useGitStamp(groupId, tab.botId)
  const target: GitTarget = { groupId, botId: tab.botId, repo: tab.repo ?? null }
  const { refs } = useGitRefs(groupId, tab.botId, target.repo, stamp)
  const remotes = refs ? refs.remotes.map((r) => r.name) : ['origin']
  const [view, setView] = useState<View>(tab.to && !tab.file ? 'commits' : 'files')
  const [detailFile, setDetailFile] = useState<string | null>(null)
  const shown: View = tab.to ? view : 'files'
  const cmd = gitCommands(target)
  const show = useGitGet<GitShowDto>(
    tab.to && tab.commit ? gitUrls.show(gitBase(groupId, tab.botId), tab.commit, target.repo) : null,
  )
  const select = (hash: string | null) => {
    if (hash === (tab.commit ?? null)) return
    setDetailFile(null)
    patch(tabKey, { commit: hash })
  }
  const commit = show.data && show.data.commit.hash === tab.commit ? show.data.commit : null
  const details = !tab.commit ? null : commit ? (
    <CommitDetails
      key={commit.hash}
      target={target}
      commit={commit}
      show={show}
      remotes={remotes}
      file={detailFile}
      historyPath={null}
      narrow={!wide}
      onFile={setDetailFile}
      onJump={select}
      onBack={() => select(null)}
    />
  ) : show.error ? (
    <EmptyState compact icon="warning" title={t('无法读取提交')} description={show.error} />
  ) : (
    <div className="glog-note">
      <Spinner />
    </div>
  )
  const columns = (to: string) => (
    <div className="gcmp__commits">
      <CommitsOnly
        target={target}
        cmd={cmd}
        title={t('仅在 {ref} 中', { ref: revLabel(to) })}
        range={`${tab.from}..${to}`}
        remotes={remotes}
        stamp={stamp}
        selected={tab.commit ?? null}
        shown={show.data}
        pickOnMenu={wide}
        onSelect={select}
      />
      <CommitsOnly
        target={target}
        cmd={cmd}
        title={t('仅在 {ref} 中', { ref: revLabel(tab.from) })}
        range={`${to}..${tab.from}`}
        remotes={remotes}
        stamp={stamp}
        selected={tab.commit ?? null}
        shown={show.data}
        pickOnMenu={wide}
        onSelect={select}
      />
    </div>
  )
  // As in the log, the picked commit's details fill the room below its list; on a phone they take the tab.
  const commits = (to: string) =>
    !wide ? (
      (details ?? columns(to))
    ) : (
      <Split
        dir="column"
        storageKey="gg.git.compare.commits"
        initial={240}
        min={120}
        label={t('调整提交列表高度')}
        first={columns(to)}
        second={
          <div className="glog__details">
            {details ?? <EmptyState compact icon="git-commit" title={t('选择一个提交查看变更')} />}
          </div>
        }
      />
    )
  return (
    <div ref={root} className="gcmp" data-layout={wide ? 'wide' : 'narrow'}>
      <div className="gcmp__bar">
        <span className="gcmp__rev" title={tab.from}>
          {revLabel(tab.from)}
        </span>
        {tab.to ? (
          <button
            type="button"
            className="gcmp__swap"
            aria-label={t('交换两侧')}
            title={t('交换两侧')}
            onClick={() =>
              replace(tabKey, { ...tab, from: tab.to ?? tab.from, to: tab.from, file: null, commit: null })
            }
          >
            ⇄
          </button>
        ) : (
          <span className="gcmp__arrow" aria-hidden="true">
            ↔
          </span>
        )}
        <span className="gcmp__rev" title={tab.to ?? undefined}>
          {tab.to ? revLabel(tab.to) : t('工作区')}
        </span>
        <span className="spacer" />
        {tab.to ? (
          <SegmentedControl<View>
            size="small"
            aria-label={t('比较内容')}
            items={[
              { value: 'commits', label: t('提交#commits') },
              { value: 'files', label: t('文件') },
            ]}
            value={shown}
            onChange={setView}
          />
        ) : null}
      </div>
      <div className="gcmp__main">
        {shown === 'commits' && tab.to ? (
          commits(tab.to)
        ) : (
          <FilesDiffer
            target={target}
            from={tab.from}
            to={tab.to}
            file={tab.file ?? null}
            stamp={stamp}
            wide={wide}
            onFile={(file) => patch(tabKey, { file })}
          />
        )}
      </div>
    </div>
  )
}

export function useGitCompareTabMeta(tab: TabProps<'git-compare'>['tab']): TabMeta {
  return {
    icon: 'git-compare',
    title: t('比较 · {from} ↔ {to}', {
      from: revLabel(tab.from),
      to: tab.to ? revLabel(tab.to) : t('工作区'),
    }),
  }
}

/** The repo's current branch as last reported; null when detached or unknown. */
function currentBranch(target: GitTarget) {
  const git = useWorkspace.getState().botStates[target.groupId]?.[target.botId]?.git
  return (git && repoStatus(git, target.repo)?.branch) || null
}
