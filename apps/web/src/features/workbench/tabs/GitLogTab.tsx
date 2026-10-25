import type { GitCommit, GitCompareDto, GitShowDto } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useSession } from '../../../app/session'
import { tabKey as keyOf, useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { api } from '../../../lib/api'
import { toastError } from '../../../lib/errors'
import { Button, EmptyState, Spinner, toast } from '../../../ui'
import { useWide } from '../../diff/DiffPane'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import {
  type GitTarget,
  gitBase,
  gitUrls,
  refreshGitQuietly,
  repoStatus,
  shortRev,
  useGitGet,
  useGitRefs,
} from '../../git/api'
import { gitCommands } from '../../git/commands'
import { repoOptions } from '../../git/GitToolbar'
import { BranchesPane, PaneBack } from '../../git/log/BranchesPane'
import { defaultChange } from '../../git/log/ChangesPane'
import { CommitDetails } from '../../git/log/CommitDetails'
import { CommitTable, type PickHow } from '../../git/log/CommitTable'
import { commitMenu, isHead, runCommitAction, unpushed } from '../../git/log/commitMenu'
import { type LogControl, LogFilters } from '../../git/log/LogFilters'
import {
  baseName,
  cleanFilter,
  graphOptions,
  type LogTab,
  type LogView,
  loadLogBranch,
  loadLogView,
  logQuery,
  narrowed,
  partialLog,
  saveLogBranch,
  saveLogView,
  withBranch,
} from '../../git/log/query'
import { pickedRange, RangeDetails } from '../../git/log/RangeDetails'
import { useLog } from '../../git/log/useLog'
import { parseRefs } from '../../git/refs'
import { Split } from '../../git/Split'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'
import '../../git/log.css'

/** From this width the branches pane shows by default; below `ROOMY_PX` (phones) one view takes the tab at a time. */
const WIDE_PX = 960
const ROOMY_PX = 640
/** Until the refs arrive, `origin/…` decorations read as remote branches. */
const DEFAULT_REMOTES = ['origin']

/** The user's identities: the bot's git email and the signed-in user's; as an author filter one per line (git ORs them). */
function useMe(botId: string) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === botId))
  const own = useSession((s) => s.user?.email)
  const emails = [
    ...new Set([bot?.gitEmail ?? bot?.gitDefaultEmail, own].flatMap((e) => (e ? [e.toLowerCase()] : []))),
  ]
  return { emails, pattern: emails.length ? emails.map((e) => `<${e}>`).join('\n') : null }
}

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
  // The branch filter as shown: a tab opened without one has the last one picked here, else all branches.
  const view = withBranch(tab, loadLogBranch(tab.botId, repo))
  const query = logQuery(view)
  const log = useLog(base, repo, query.all || view.ref === 'HEAD' ? null : view.ref, query, stamp)
  const { refs, error: refsError } = useGitRefs(groupId, tab.botId, repo, stamp)
  const remotes = refs ? refs.remotes.map((r) => r.name) : DEFAULT_REMOTES
  const me = useMe(tab.botId)
  const [look, setLook] = useState<LogView>(() => loadLogView(tab.botId))
  const setView = (next: LogView) => {
    setLook(next)
    saveLogView(tab.botId, next)
  }
  const [finding, setFinding] = useState(false)
  const [seek, setSeek] = useState<{ hash: string; rev: string } | null>(null)
  const [reveal, setReveal] = useState<{ hash: string } | null>(null)
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
  /** The full hash `rev` names: a listed commit's (by hash or a ref on it), else as the repo resolves it. */
  const resolve = async (rev: string) => {
    const listed = log.commits.find(
      (c) =>
        (/^[0-9a-f]{4,40}$/i.test(rev) && c.hash.startsWith(rev.toLowerCase())) ||
        (rev === 'HEAD' ? isHead(c, remotes) : parseRefs(c.refs, remotes).some((r) => r.name === rev)),
    )
    if (listed) return listed.hash
    try {
      return (await api.get<GitShowDto>(gitUrls.show(base, rev, repo))).commit.hash
    } catch (e) {
      toastError(e)
      return null
    }
  }
  const control: LogControl = {
    setFilter: (fields) => patch(tabKey, { filter: cleanFilter({ ...now().filter, ...fields }) }),
    setRef: (ref, all) => {
      saveLogBranch(tab.botId, repo, all ? 'all' : (ref ?? 'HEAD'))
      patch(tabKey, {
        ref: all ? null : (ref ?? 'HEAD'),
        filter: cleanFilter({ ...now().filter, all: all || undefined }),
        file: null,
      })
    },
    setPath: (path) => patch(tabKey, { path, commit: null, file: null }),
    setRepo: (r) => patch(tabKey, { repo: r, ref: null, path: null, commit: null, file: null }),
    goTo: async (rev) => {
      const hash = await resolve(rev)
      if (!hash) return false
      if (now().filter?.text) patch(tabKey, { filter: cleanFilter({ ...now().filter, text: undefined }) })
      setSeek({ hash, rev })
      return true
    },
    clear: () => {
      saveLogBranch(tab.botId, repo, 'all')
      patch(tabKey, { ref: null, path: null, filter: graphOptions(now().filter), commit: null, file: null })
    },
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
    const from = list.indexOf(anchor.current ?? tab.commit ?? '')
    const to = list.indexOf(hash)
    if (how.range && from >= 0 && to >= 0) {
      // A commit opened with the tab anchors the range like a click on it.
      anchor.current = list[from] ?? null
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

  // Pages load until the commit gone to is listed; then it is picked and scrolled to the middle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new page looks again
  useEffect(() => {
    if (!seek || log.loading) return
    if (log.commits.some((c) => c.hash === seek.hash)) {
      pickOne(seek.hash)
      setReveal({ hash: seek.hash })
      setSeek(null)
    } else if (log.hasMore) log.more()
    else {
      toast({ type: 'error', message: t('提交历史里没有 {rev}', { rev: shortRev(seek.rev) }) })
      setSeek(null)
    }
  }, [seek, log.commits, log.loading, log.hasMore])

  // An amended or reworded HEAD leaves its old hash: the new HEAD is picked in its place.
  const lastHead = useRef<string | undefined>(undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new list
  useEffect(() => {
    const head = log.commits.find((c) => isHead(c, remotes))?.hash
    const was = lastHead.current
    if (head) lastHead.current = head
    const at = now().commit
    if (head && at && at === was && head !== was && !log.commits.some((c) => c.hash === at)) pickOne(head)
  }, [log.commits])

  /** IDEA's Enter: the first file's diff of the picked commits (one, or several in a row). */
  const openDiff = async (hash: string) => {
    const range = pickedRange(picked.length > 1 ? listed(picked) : listed([hash]))
    if (!range) return
    try {
      const { changes } = await api.get<GitCompareDto>(gitUrls.compare(base, range.from, range.to, repo))
      const first = changes.length ? defaultChange(changes, tab.path ?? null) : undefined
      if (first) openTab({ kind: 'git-compare', botId: tab.botId, repo, ...range, file: first.path })
    } catch (e) {
      toastError(e)
    }
  }
  const branch = refs?.branches.find((b) => b.kind === 'local' && b.current) ?? null
  const ahead = (all: readonly GitCommit[]) => (branch ? unpushed(all, remotes, branch.upstream) : undefined)

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
      selected={{ all: !!view.filter?.all, ref: view.ref }}
      onFilter={filterRef}
      onLocate={(ref) => {
        void control.goTo(ref)
        setPaneOnPhone(false)
      }}
      header={header}
    />
  )
  const bar = (
    <LogFilters
      tab={view}
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
      me={me.pattern}
      view={look}
      onView={setView}
      finding={finding}
      onFinding={setFinding}
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
      // A phone shows the details in the list's place: the keyboard moves the table's own selection, Enter opens it.
      onGo={layout === 'narrow' ? undefined : pickOne}
      onOpen={layout === 'narrow' ? pickOne : (hash) => void openDiff(hash)}
      onFind={() => setFinding(true)}
      reveal={reveal}
      hidden={look.hidden}
      mine={look.mine && me.emails.length ? (c) => me.emails.includes(c.email.toLowerCase()) : undefined}
      menu={(hashes) =>
        commitMenu(listed(hashes), log.commits, {
          remotes,
          rootRepo: !repo,
          unpushed: ahead(log.commits),
          interactiveRebase: true,
        })
      }
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
          branch: branch?.name ?? null,
        })
      }
      hasMore={log.hasMore}
      loading={log.loading}
      error={log.error}
      onMore={log.more}
      onRetry={log.retry}
      empty={narrowed(view) ? t('没有符合筛选条件的提交') : t('还没有提交')}
      label={t('提交#commits')}
    />
  )
  const back = () => patch(tabKey, { commit: null, file: null })
  const several = layout === 'narrow' ? [] : listed(picked)
  const details =
    several.length > 1 ? (
      <RangeDetails
        key={several.map((c) => c.hash).join()}
        target={target}
        picked={several}
        historyPath={tab.path ?? null}
      />
    ) : commit ? (
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
