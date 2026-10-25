import type { GitShowDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { tabKey as keyOf, useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { api } from '../../../lib/api'
import { toastError } from '../../../lib/errors'
import { Button, EmptyState, Spinner } from '../../../ui'
import { useWide } from '../../diff/DiffPane'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import {
  type GitTarget,
  gitBase,
  gitUrls,
  refreshGitQuietly,
  repoStatus,
  useGitGet,
  useGitRefs,
} from '../../git/api'
import { gitCommands } from '../../git/commands'
import { repoOptions } from '../../git/GitToolbar'
import { BranchesPane, PaneBack } from '../../git/log/BranchesPane'
import { CommitDetails } from '../../git/log/CommitDetails'
import { CommitTable, type PickHow } from '../../git/log/CommitTable'
import { commitMenu, runCommitAction } from '../../git/log/commitMenu'
import { type LogControl, LogFilters } from '../../git/log/LogFilters'
import {
  baseName,
  cleanFilter,
  graphOptions,
  type LogTab,
  logQuery,
  narrowed,
  partialLog,
} from '../../git/log/query'
import { useLog } from '../../git/log/useLog'
import { Split } from '../../git/Split'
import type { TabMeta, TabProps } from '../types'
import '../../git/log.css'

/** From this width the branches pane shows by default; below `ROOMY_PX` (phones) one view takes the tab at a time. */
const WIDE_PX = 960
const ROOMY_PX = 640
/** Until the refs arrive, `origin/…` decorations read as remote branches. */
const DEFAULT_REMOTES = ['origin']

/**
 * A bot workspace's commit history, IDEA's Git Log: the branches pane, the filter bar, the commit table with its
 * graph, and the picked commit's details, changed files and diff. With `path` it is that file's (or folder's)
 * history.
 */
export function GitLogTab({ tab, tabKey, active }: TabProps<'git-log'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const patch = useWorkbench((s) => s.patch)
  const git = useWorkspace((s) => s.botStates[groupId]?.[tab.botId]?.git ?? null)
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root, WIDE_PX)
  const roomy = useWide(root, ROOMY_PX)
  const stamp = useGitStamp(groupId, tab.botId)
  // A workspace whose root is no repo opens on its first sub-repo.
  const repo = tab.repo ?? (git && !repoStatus(git, null) ? (git.repos[0]?.path ?? null) : null)
  const target: GitTarget = { groupId, botId: tab.botId, repo }
  const base = gitBase(groupId, tab.botId)
  const query = logQuery(tab)
  const log = useLog(base, repo, query.all ? null : tab.ref, query, stamp)
  const { refs, error: refsError } = useGitRefs(groupId, tab.botId, repo, stamp)
  const remotes = refs ? refs.remotes.map((r) => r.name) : DEFAULT_REMOTES
  const show = useGitGet<GitShowDto>(tab.commit ? gitUrls.show(base, tab.commit, repo) : null)
  const commit = log.commits.find((c) => c.hash === tab.commit) ?? show.data?.commit ?? null
  const [pane, setPane] = useState<boolean | null>(null)
  const [paneOnPhone, setPaneOnPhone] = useState(false)
  const [picks, setPicks] = useState<string[]>([])
  const anchor = useRef<string | null>(null)
  const authorOf = useRef(new Map<string, string>())
  for (const c of log.commits) authorOf.current.set(c.hash, c.author)

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh once each time the tab is shown
  useEffect(() => {
    if (active && git) refreshGitQuietly(groupId, tab.botId)
  }, [active, groupId, tab.botId])

  /** The tab as stored now: filters set from a timer must not overwrite a newer change. */
  const now = () =>
    (useWorkbench.getState().benches[groupId]?.tabs.find((x) => keyOf(x) === tabKey) as LogTab | undefined) ??
    tab
  const select = (hash: string) => {
    if (now().commit !== hash) patch(tabKey, { commit: hash, file: null })
  }
  const control: LogControl = {
    setFilter: (fields) => patch(tabKey, { filter: cleanFilter({ ...now().filter, ...fields }) }),
    setRef: (ref, all) =>
      patch(tabKey, {
        ref,
        filter: cleanFilter({ ...now().filter, all: all || undefined }),
        commit: null,
        file: null,
      }),
    setPath: (path) => patch(tabKey, { path, commit: null, file: null }),
    setRepo: (r) => patch(tabKey, { repo: r, ref: null, path: null, commit: null, file: null }),
    goTo: (rev) =>
      api.get<GitShowDto>(gitUrls.show(base, rev, repo)).then(
        (d) => {
          patch(tabKey, {
            filter: cleanFilter({ ...now().filter, text: undefined }),
            commit: d.commit.hash,
            file: null,
          })
          return true
        },
        (e: unknown) => {
          toastError(e)
          return false
        },
      ),
    clear: () =>
      patch(tabKey, { ref: null, path: null, filter: graphOptions(now().filter), commit: null, file: null }),
    refresh: () => {
      log.reload()
      refreshGitQuietly(groupId, tab.botId)
    },
  }

  // Picked commits: ⌘/⇧ add to the one shown in the details.
  const picked = tab.commit && picks.includes(tab.commit) ? picks : tab.commit ? [tab.commit] : []
  const pickOne = (hash: string) => {
    anchor.current = hash
    setPicks([hash])
    select(hash)
  }
  const onPick = (hash: string, how: PickHow) => {
    const list = log.commits.map((c) => c.hash)
    const from = anchor.current ? list.indexOf(anchor.current) : -1
    const to = list.indexOf(hash)
    if (how.range && from >= 0 && to >= 0) {
      setPicks(list.slice(Math.min(from, to), Math.max(from, to) + 1))
      return select(hash)
    }
    if (!how.add) return pickOne(hash)
    anchor.current = hash
    const next = picked.includes(hash) ? picked.filter((h) => h !== hash) : [...picked, hash]
    if (!next.length) return
    setPicks(next)
    select(next.includes(hash) ? hash : (next[next.length - 1] ?? hash))
  }
  const listed = (hashes: string[]) => log.commits.filter((c) => hashes.includes(c.hash))

  const layout = wide ? 'wide' : roomy ? 'medium' : 'narrow'
  // As in IDEA, the first commit is picked once the log arrives, so its details fill the room below the table.
  const first = log.commits[0]?.hash
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new first commit or layout picks again
  useEffect(() => {
    if (active && first && layout !== 'narrow' && !now().commit) select(first)
  }, [active, first, layout])
  const paneShown = layout === 'narrow' ? paneOnPhone : (pane ?? layout === 'wide')
  const filterRef = (ref: string | null, all: boolean) => {
    control.setRef(ref, all)
    setPaneOnPhone(false)
  }
  const branches = (header?: ReactNode) => (
    <BranchesPane
      target={target}
      refs={refs}
      error={refsError}
      selected={{ all: !!tab.filter?.all, ref: tab.ref }}
      onFilter={filterRef}
      header={header}
    />
  )
  const bar = (
    <LogFilters
      tab={tab}
      target={target}
      refs={refs}
      refsError={refsError}
      authors={() => {
        const counts = new Map<string, number>()
        for (const a of authorOf.current.values()) counts.set(a, (counts.get(a) ?? 0) + 1)
        return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a)
      }}
      repos={git?.repos.length ? repoOptions(git) : []}
      pane={paneShown}
      onPane={() => (layout === 'narrow' ? setPaneOnPhone(!paneOnPhone) : setPane(!paneShown))}
      control={control}
    />
  )
  const table = (
    <CommitTable
      commits={log.commits}
      remotes={remotes}
      partial={partialLog(query)}
      selected={tab.commit}
      picked={new Set(picked)}
      onPick={onPick}
      onGo={pickOne}
      menu={(hashes) => commitMenu(listed(hashes), log.commits, { remotes, rootRepo: !repo })}
      onMenuTarget={(hash) => {
        if (picked.includes(hash)) return picked
        pickOne(hash)
        return [hash]
      }}
      onMenu={(value, hashes) =>
        void runCommitAction(value, listed(hashes), {
          target,
          cmd: gitCommands(target),
          remotes,
          all: log.commits,
          shown: show.data,
          select: pickOne,
        })
      }
      hasMore={log.hasMore}
      loading={log.loading}
      error={log.error}
      onMore={log.more}
      onRetry={log.retry}
      empty={narrowed(tab) ? t('没有符合筛选条件的提交') : t('还没有提交')}
      label={t('提交#commits')}
    />
  )
  const back = () => patch(tabKey, { commit: null, file: null })
  const details = commit ? (
    <CommitDetails
      key={commit.hash}
      target={target}
      commit={commit}
      show={show}
      remotes={remotes}
      file={tab.file ?? null}
      historyPath={tab.path ?? null}
      narrow={layout === 'narrow'}
      onFile={(file) => patch(tabKey, { file })}
      onJump={pickOne}
      onBack={back}
    />
  ) : tab.commit && show.error ? (
    <EmptyState compact icon="warning" title={t('无法读取提交')} description={show.error} />
  ) : tab.commit ? (
    <div className="glog-note">
      <Spinner />
    </div>
  ) : (
    <EmptyState compact icon="git-commit" title={t('选择一个提交查看变更')} />
  )

  let body: ReactNode
  if (layout === 'narrow')
    body = paneOnPhone ? (
      branches(<PaneBack onBack={() => setPaneOnPhone(false)} />)
    ) : tab.commit && !commit ? (
      <div className="glog-page">
        <div className="glog-page__bar">
          <Button size="small" variant="plain" icon="chevron-left" onClick={back}>
            {t('全部提交')}
          </Button>
        </div>
        {details}
      </div>
    ) : tab.commit ? (
      details
    ) : (
      <>
        {bar}
        {table}
      </>
    )
  else {
    const center = (
      <div className="glog__center">
        {bar}
        <Split
          dir="column"
          storageKey="gg.git.log.table"
          initial={260}
          min={120}
          label={t('调整提交列表高度')}
          first={table}
          second={<div className="glog__details">{details}</div>}
        />
      </div>
    )
    body = paneShown ? (
      <Split
        storageKey="gg.git.log.branches"
        initial={240}
        min={180}
        label={t('调整分支面板宽度')}
        first={branches()}
        second={center}
      />
    ) : (
      center
    )
  }
  return (
    <div ref={root} className="glog" data-layout={layout}>
      {body}
    </div>
  )
}

export function useGitLogTabMeta(tab: TabProps<'git-log'>['tab']): TabMeta {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId)?.name) ?? 'Bot'
  return {
    icon: 'clock',
    title: tab.path
      ? t('历史 · {name}', { name: baseName(tab.path) })
      : t('提交历史 · {name}', { name: tab.repo ? `${name} · ${baseName(tab.repo)}` : name }),
  }
}
