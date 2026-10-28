import type { GroupBotStateDto, GroupDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { loadBotStates, loadGitOperations, useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { copyWithToast } from '../../lib/clipboard'
import { realtime } from '../../lib/realtime'
import { Icon, type IconName } from '../../ui'
import { refreshGitQuietly } from '../git/api'
import { ongoingLabel } from '../git/commands'
import { BranchLabel, WorkspaceMenu } from '../git/GitControls'
import { PendingBadge } from '../git/GitOperations'
import { openTab } from '../workbench/open'
import { ContextMeter } from './ContextMeter'
import { contextGauge } from './ContextRing'

const WORKSPACE_LABEL = { managed: t('托管目录'), cd: t('本机目录') }
const FOCUS_REFRESH_MS = 30_000
const POLL_REFRESH_MS = 30_000
const NO_STATES: Record<string, GroupBotStateDto> = {}

function Commits({ icon, name, n }: { icon: IconName; name: string; n: number }) {
  return (
    <span className="git-bar__ab" role="img" aria-label={name} title={name}>
      <Icon name={icon} size={12} />
      {n}
    </span>
  )
}

/** 执行位置 at the head of a bot's menu: where it works in this group, to tell which code it is changing (郑晓佳 #1488). */
function Where({
  s,
  repo,
  machine,
}: {
  s: GroupBotStateDto
  repo: GroupDto['repo']
  machine: string | null
}) {
  const current = s.git?.branch ?? null
  return (
    <dl className="git-loc">
      <dt>{t('机器')}</dt>
      <dd>{machine ?? t('未绑定机器')}</dd>
      <dt>{t('目录#one')}</dt>
      <dd className="git-loc__dir">
        <span className="git-loc__mono">
          {s.path ?? '—'}
          <span className="git-loc__kind">{WORKSPACE_LABEL[s.workspace]}</span>
        </span>
        {s.path ? (
          <button
            type="button"
            className="git-bar__act"
            aria-label={t('复制目录')}
            onClick={() => void copyWithToast(s.path ?? '', t('已复制目录'))}
          >
            <Icon name="copy" size={13} />
          </button>
        ) : null}
      </dd>
      <dt>{t('仓库')}</dt>
      {repo ? <dd className="git-loc__mono">{repo.url}</dd> : <dd>{t('未绑定仓库')}</dd>}
      {repo ? (
        <>
          <dt>{t('基准')}</dt>
          <dd>
            <span className="git-loc__mono">{repo.branch}</span>
            {current && current !== repo.branch ? (
              <span className="git-loc__warn">{t('当前在 {branch}', { branch: current })}</span>
            ) : null}
          </dd>
        </>
      ) : null}
      {s.extraDirs.length ? (
        <>
          <dt>{t('附加目录')}</dt>
          <dd>
            {s.extraDirs.map((d) => (
              <div key={d} className="git-loc__mono">
                {d}
              </div>
            ))}
          </dd>
        </>
      ) : null}
    </dl>
  )
}

function Item({
  group,
  name,
  s,
  showGit,
  machine,
}: {
  group: GroupDto
  name: string
  s: GroupBotStateDto
  /** Partition groups with a repo, where the bar shows each bot's git status. */
  showGit: boolean
  machine: string | null
}) {
  const groupId = group.id
  const git = s.git
  const hint =
    s.state === 'unbound' ? (
      <span className="git-bar__hint">{t('待绑定')}</span>
    ) : s.state === 'confirm' ? (
      <span className="git-bar__hint">{t('待主人确认')}</span>
    ) : s.state === 'pending' && !git ? (
      <span className="git-bar__hint">{t('待创建')}</span>
    ) : s.state === 'cloning' ? (
      <span className="git-bar__hint">{t('clone 中…')}</span>
    ) : s.state === 'failed' ? (
      <span className="git-bar__error" title={s.error ?? undefined}>
        {t('工作区创建失败')}
      </span>
    ) : null
  // Uncommitted work first; a clean feature branch shows what it holds against main.
  const diff = git
    ? () => openTab({ kind: 'diff', botId: s.botId, scope: git.dirty ? 'uncommitted' : 'base', file: null })
    : undefined
  const files =
    git || s.state === 'ready'
      ? () => openTab({ kind: 'files', botId: s.botId, dir: '', selected: null })
      : undefined
  return (
    <div className="git-bar__item" data-testid={`git-${s.botId}`}>
      <span className="git-bar__name">{name}</span>
      {showGit ? (
        <>
          {hint ?? (
            <>
              {git ? (
                <button
                  type="button"
                  className="git-bar__branch git-bar__branch-btn"
                  aria-label={t('打开 {name} 的 Git', { name })}
                  title={t('Git 面板')}
                  onClick={() => openTab({ kind: 'git', botId: s.botId })}
                >
                  <BranchLabel git={git} />
                </button>
              ) : (
                <span className="git-bar__branch">—</span>
              )}
              {git?.behind ? (
                <Commits icon="arrow-down" name={t('落后 {n} 个提交', { n: git.behind })} n={git.behind} />
              ) : null}
              {git?.ahead ? (
                <Commits icon="arrow-up" name={t('领先 {n} 个提交', { n: git.ahead })} n={git.ahead} />
              ) : null}
              {git?.dirty ? <span className="git-bar__dirty">{t('未提交')}</span> : null}
              {git?.additions ? (
                <span className="git-bar__add" title={t('新增 {n} 行', { n: git.additions })}>
                  +{Math.min(git.additions, 99)}
                  {git.additions > 99 ? '+' : ''}
                </span>
              ) : null}
              {git?.deletions ? (
                <span className="git-bar__del" title={t('删除 {n} 行', { n: git.deletions })}>
                  -{Math.min(git.deletions, 99)}
                  {git.deletions > 99 ? '+' : ''}
                </span>
              ) : null}
              {git?.ongoing || git?.conflicts ? (
                <button
                  type="button"
                  className="git-bar__ongoing"
                  onClick={() => openTab({ kind: 'git', botId: s.botId, view: 'commit' })}
                >
                  {git.ongoing ? t('{op}中', { op: ongoingLabel(git.ongoing) }) : null}
                  {git.ongoing && git.conflicts ? ' · ' : null}
                  {git.conflicts ? t('{n} 个冲突', { n: git.conflicts }) : null}
                </button>
              ) : null}
            </>
          )}
          <PendingBadge groupId={groupId} botId={s.botId} />
        </>
      ) : null}
      {s.context && contextGauge(s.context).level !== 'normal' ? (
        <ContextMeter groupId={groupId} bot={name} context={s.context} />
      ) : null}
      <span className="git-bar__actions">
        <WorkspaceMenu
          botId={s.botId}
          name={name}
          git={showGit && !hint ? git : null}
          head={<Where s={s} repo={group.repo} machine={machine} />}
          showDiff={showGit}
          onDiff={hint ? undefined : diff}
          onFiles={files}
        />
      </span>
    </div>
  )
}

function hasIssue(s: GroupBotStateDto, pendingApproval: boolean) {
  const git = s.git
  return (
    ['failed', 'unbound', 'confirm'].includes(s.state) ||
    pendingApproval ||
    !!git?.dirty ||
    !!git?.behind ||
    !!git?.conflicts ||
    !!git?.ongoing ||
    !!git?.repos.some((r) => !!r.dirty) ||
    !!git?.repos.some((r) => !!r.behind)
  )
}

/**
 * Bot bar under the header: every bot's 执行位置, its context occupancy and detected Git status.
 */
export function GitBar({ group }: { group: GroupDto }) {
  const showGit = group.mode === 'partition'
  const states = useWorkspace((s) => s.botStates[group.id]) ?? NO_STATES
  const bots = useWorkspace((s) => s.bots)
  const me = useSession((s) => s.user?.id)
  const botKey = group.botIds.join()
  const gitOps = useWorkspace((s) => s.gitOps[group.id])
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const showOthers = expandedGroupId === group.id

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the group's bots change
  useEffect(() => {
    const load = () => {
      loadBotStates(group.id).catch(() => {})
      if (showGit) loadGitOperations(group.id).catch(() => {})
    }
    load()
    // Updates pushed while the socket was down are lost: catch up on reconnect.
    return realtime.onReconnect(load)
  }, [group.id, botKey, showGit])

  // The status is only taken after each turn: re-read it when the user comes back, as files may have changed since.
  const focusedAt = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-bind when the group's bots change
  useEffect(() => {
    if (!showGit) return
    const onFocus = () => {
      const now = Date.now()
      if (now - focusedAt.current < FOCUS_REFRESH_MS) return
      focusedAt.current = now
      const shown = useWorkspace.getState().botStates[group.id] ?? {}
      for (const id of group.botIds) if (shown[id]?.git) refreshGitQuietly(group.id, id)
    }
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(onFocus, POLL_REFRESH_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [group.id, botKey, showGit])

  if (!group.botIds.length) return null
  const stateOf = (id: string) =>
    states[id] ?? {
      botId: id,
      workspace: 'managed',
      state: 'pending',
      path: null,
      git: null,
      error: null,
      reason: null,
      tier: null,
      model: null,
      effort: null,
      context: null,
      extraDirs: [],
    }
  const operationsFor = (id: string) => gitOps?.filter((op) => op.botId === id) ?? []
  const needsApproval = (id: string) => operationsFor(id).some((op) => op.status === 'pending_approval')
  const owned = group.botIds.filter((id) => bots.find((b) => b.id === id)?.ownerId === me)
  const issues = group.botIds.filter((id) => !owned.includes(id) && hasIssue(stateOf(id), needsApproval(id)))
  const anchor = owned.length ? null : (group.botIds.find((id) => !issues.includes(id)) ?? null)
  const visible = [...owned, ...(anchor ? [anchor] : []), ...issues]
  const others = group.botIds.filter((id) => !visible.includes(id))

  const item = (id: string) => {
    const bot = bots.find((b) => b.id === id)
    return (
      <Item
        key={id}
        group={group}
        showGit={showGit && (!!group.repo || !!stateOf(id).git)}
        machine={bot?.machineName ?? null}
        name={bot?.name ?? 'bot'}
        s={stateOf(id)}
      />
    )
  }

  return (
    <div className="git-bar" data-testid="git-bar">
      <div className="git-bar__items" data-testid="git-bar-items">
        {visible.map(item)}
      </div>
      {others.length ? (
        <>
          <button
            type="button"
            className="git-bar__more"
            data-testid="git-bar-more"
            aria-expanded={showOthers}
            aria-label={
              showOthers ? t('收起更多工作区') : t('展开其余 {n} 个 Bot 的工作区', { n: others.length })
            }
            onClick={() => setExpandedGroupId(showOthers ? null : group.id)}
          >
            {showOthers ? t('收起') : t('更多工作区')}
            <span className="git-bar__more-count">{others.length}</span>
            <Icon name={showOthers ? 'chevron-up' : 'chevron-down'} size={11} weight={1.8} />
          </button>
          {showOthers ? (
            <div className="git-bar__others" data-testid="git-bar-others">
              {others.map(item)}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
