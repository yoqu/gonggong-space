import {
  agentConfigLabel,
  type DiffScope,
  type RunDetailDto,
  type RunDto,
  type RunSessionDto,
  type TaskStopRes,
} from '@gonggong/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { api } from '../../../lib/api'
import { copyWithToast } from '../../../lib/clipboard'
import { cx } from '../../../lib/cx'
import { useNow } from '../../../lib/now'
import { realtime } from '../../../lib/realtime'
import { hm } from '../../../lib/time'
import {
  EmptyState,
  FailedArt,
  GroupBox,
  GroupRow,
  Icon,
  IconButton,
  Spinner,
  Tabs,
  Tag,
  Toolbar,
  toast,
} from '../../../ui'
import { BotAvatar, useBotCostume } from '../../bots/avatars'
import { fmtDuration, fmtUsage, RUN_STATUS } from '../../chat/TimelineItems'
import { DiffPane } from '../../diff/DiffPane'
import type { DiffSource } from '../../diff/store'
import { useWorkspaceDiff, type WorkspaceDiff } from '../../diff/useWorkspaceDiff'
import { ActivityDock } from '../../runs/ActivityDock'
import { ProcessView } from '../../runs/ProcessView'
import { approvalText, buildSteps } from '../../runs/process'
import type { Step } from '../../runs/steps'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'
import { locateFile } from './DiffTab'
import '../../runs/runs.css'

type RunView = TabProps<'run'>['tab']['view']

const VIEWS: { value: RunView; label: string }[] = [
  { value: 'process', label: t('过程') },
  { value: 'diff', label: t('改动') },
  { value: 'audit', label: t('审批记录') },
]
const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']
const FAILED = ['forbidden', 'interrupted', 'expired']
const PURGED = t('运行过程已过期，仅保留摘要')
/** Coalesces bursts of run.updated / run.progress into one refetch. */
const REFETCH_MS = 300
/** How long streamed text is gathered before it is shown. */
const DELTA_FLUSH_MS = 100

/** Text streamed since the last stored event, not yet in the refetched process. */
type Tail = { at: string; text: string }

/** What the open run tabs learned about their runs, for the tab bar's title and mark. */
const useRunInfo = create<{ runs: Record<string, RunDto>; rounds: Record<string, number> }>(() => ({
  runs: {},
  rounds: {},
}))

/**
 * GET /api/runs/:id, kept live while shown: card updates refetch the process from its last stored event on, streamed
 * text is kept as a tail after it. A hidden tab only keeps the card current and catches up once shown again.
 */
function useRunDetail(runId: string, active: boolean) {
  const [detail, setDetail] = useState<RunDetailDto | null>(null)
  const [tail, setTail] = useState<Tail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(detail)
  current.current = detail
  const shown = useRef(active)
  shown.current = active
  const catchUp = useRef<(() => void) | null>(null)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // Only the newest request may write: it was sent last, so it saw the newest server state.
    let seq = 0
    let pending = ''
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    current.current = null
    setTail(null)
    const flush = () => {
      flushTimer = undefined
      const text = pending
      pending = ''
      setTail((t) => ({ at: t?.at ?? new Date().toISOString(), text: (t?.text ?? '') + text }))
    }
    const load = () => {
      const mine = ++seq
      const since = current.current?.events.at(-1)?.id
      api.get<RunDetailDto>(`/runs/${runId}${since ? `?since=${since}` : ''}`).then(
        (d) => {
          if (!alive || mine !== seq) return
          // The stored events now hold what was streamed so far.
          pending = ''
          clearTimeout(flushTimer)
          flushTimer = undefined
          setTail(null)
          setDetail((prev) =>
            since && prev ? { ...d, events: [...prev.events.filter((e) => e.id < since), ...d.events] } : d,
          )
        },
        (e: Error) => alive && mine === seq && setError(e.message),
      )
    }
    load()
    const off = realtime.subscribe((e) => {
      const moved =
        (e.t === 'run.updated' && e.run.id === runId) || (e.t === 'run.progress' && e.runId === runId)
      if (moved) {
        if (e.t === 'run.updated') setDetail((d) => d && { ...d, run: e.run })
        clearTimeout(timer)
        if (shown.current) timer = setTimeout(load, REFETCH_MS)
        else catchUp.current = load
      } else if (e.t === 'run.delta' && e.runId === runId) {
        if (!shown.current) catchUp.current = load
        else {
          pending += e.text
          flushTimer ??= setTimeout(flush, DELTA_FLUSH_MS)
        }
      }
    })
    // Refill anything missed while the socket was down.
    let wasOpen = realtime.getStatus() === 'open'
    const offStatus = realtime.onStatus((st) => {
      if (st === 'open' && wasOpen) {
        if (shown.current) load()
        else catchUp.current = load
      }
      if (st === 'open') wasOpen = true
    })
    return () => {
      alive = false
      off()
      offStatus()
      clearTimeout(timer)
      clearTimeout(flushTimer)
      catchUp.current = null
    }
  }, [runId])
  useEffect(() => {
    if (!active || !catchUp.current) return
    catchUp.current()
    catchUp.current = null
  }, [active])
  return { detail, tail, error }
}

/** The streamed tail continues the last stored reply, or follows the stored steps as the reply being written. */
function withTail(steps: Step[], d: RunDetailDto, tail: Tail | null, live: boolean): Step[] {
  if (!tail) return steps
  const last = d.events.at(-1)
  if (last?.event.kind === 'text' && !last.event.agentId) {
    const key = `e${last.id}`
    return steps.map((s) => (s.key === key ? { ...s, body: (s.body ?? '') + tail.text } : s))
  }
  // Only the last text or thought counts as the current step.
  const prev = steps.at(-1)
  const head =
    prev?.running && (prev.kind === 'text' || prev.kind === 'thought')
      ? [...steps.slice(0, -1), { ...prev, running: false }]
      : steps
  return [
    ...head,
    { key: 'tail', kind: 'text', label: t('回复'), body: tail.text, at: tail.at, running: live },
  ]
}

/** One run in the workbench (design §4.3): header facts, then 过程 / 改动 / 审批记录. */
export function RunTab({ tab, tabKey, active }: TabProps<'run'>) {
  const { runId, view, file } = tab
  const patch = useWorkbench((s) => s.patch)
  const { detail, tail, error } = useRunDetail(runId, active)
  const bots = useWorkspace((s) => s.bots)
  const groups = useWorkspace((s) => s.groups)
  const run = detail?.run
  useEffect(() => {
    if (run) useRunInfo.setState((s) => ({ runs: { ...s.runs, [run.id]: run } }))
  }, [run])
  const now = useNow(!!run && LIVE.includes(run.status) && !!run.startedAt)
  const bot = bots.find((b) => b.id === run?.botId)
  const costume = useBotCostume(bot?.id)
  const members = groups.find((g) => g.id === run?.groupId)?.members ?? []
  const root = useWorkspace((s) => (run ? s.botStates[run.groupId]?.[run.botId]?.path : null)) ?? null
  const userName = (id: string | null) => members.find((m) => m.userId === id)?.name ?? '—'
  const live = !!run && LIVE.includes(run.status)
  const [groupId, botId, id] = [run?.groupId, run?.botId, run?.id]
  const source = useMemo(
    () => (groupId && botId && id ? { groupId, botId, runId: id } : null),
    [groupId, botId, id],
  )
  // This turn's changes: stored once it ended, read from the bot's machine while it runs (process counts use it too).
  const turn = useWorkspaceDiff(
    active ? source : null,
    'turn',
    live ? undefined : (detail?.patch ?? null),
    detail?.patchRepos,
  )
  // The clock re-renders every second; the process only changes with the detail or the live patch.
  const stored = useMemo(
    () => detail && buildSteps(live && turn.patch !== null ? { ...detail, patch: turn.patch } : detail),
    [detail, live, turn.patch],
  )
  const steps = useMemo(
    () => stored && detail && withTail(stored, detail, tail, detail.run.status === 'running'),
    [stored, detail, tail],
  )
  // Machine and session id are rarely needed; hidden behind ⓘ so the process gets the height.
  const [more, setMore] = useState(false)
  // A dock row leads back to its process row, switching to the process view first.
  const tabRef = useRef<HTMLDivElement>(null)
  const [locate, setLocate] = useState<string | null>(null)
  useEffect(() => {
    if (!locate || view !== 'process') return
    tabRef.current?.querySelector(`[data-step="${CSS.escape(locate)}"]`)?.scrollIntoView({ block: 'center' })
    setLocate(null)
  }, [locate, view])
  const started = run?.startedAt ? Date.parse(run.startedAt) : null
  const ended = run?.endedAt ? Date.parse(run.endedAt) : now
  return (
    <div className="run-tab" data-testid="run-tab" ref={tabRef}>
      <Toolbar
        className="run-tab__bar"
        scrolled={false}
        leading={<BotAvatar id={bot?.id} name={bot?.name ?? 'bot'} size={24} />}
        title={bot?.name ?? 'bot'}
        subtitle={
          run ? t('{name} 触发', { name: userName(run.triggerUserId ?? run.originUserId) }) : undefined
        }
      >
        {run ? <Tag tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Tag> : null}
        <IconButton title={t('机器与会话')} aria-pressed={more} onClick={() => setMore(!more)}>
          <Icon name="info" />
        </IconButton>
      </Toolbar>
      <div className="run-tab__head">
        {run ? (
          <div className="run-tab__facts">
            <span className="run-tab__fact" title={t('模型')}>
              <Icon name="cpu" size={14} />
              <span className="run-tab__val">
                {run.model || run.effort
                  ? agentConfigLabel(
                      bot?.catalog ?? null,
                      run.model ?? bot?.catalog?.current ?? null,
                      run.effort,
                    )
                  : t('默认')}
              </span>
            </span>
            <span className="run-tab__fact" title={t('耗时')}>
              <Icon name="clock" size={14} />
              {started === null ? '—' : fmtDuration(ended - started)}
            </span>
            <span className="run-tab__fact" title={t('用量')}>
              <Icon name="chart-bar" size={14} />
              <span className="run-tab__val">{fmtUsage(run.usage)}</span>
            </span>
          </div>
        ) : null}
        {run && more ? (
          <GroupBox>
            <GroupRow label={t('机器')}>
              <span className="run-tab__val run-tab__mono">{bot?.machineName ?? '—'}</span>
            </GroupRow>
            <GroupRow label={t('会话')}>
              <span className="run-tab__val run-tab__mono">
                {detail.sessionId ? <SessionId id={detail.sessionId} /> : '—'}
              </span>
            </GroupRow>
          </GroupBox>
        ) : null}
        <Tabs size="sm" items={VIEWS} value={view} onChange={(v) => patch(tabKey, { view: v })} />
      </div>
      <div className={cx('run-tab__body', view === 'diff' && 'run-tab__body--fill')}>
        {error ? (
          <EmptyState bare illustration={<FailedArt />} title={t('无法加载运行过程')} description={error} />
        ) : !detail ? (
          <div className="run-tab__loading">
            <Spinner />
          </div>
        ) : !source ? null : view === 'process' ? (
          <div className="run-tab__column">
            <EarlierRounds key={runId} runId={runId} root={root} />
            {detail.purged ? (
              <div className="run-tab__empty">{PURGED}</div>
            ) : (
              <ProcessView
                key={runId}
                steps={steps ?? []}
                root={root}
                live={live}
                startedAt={run?.startedAt ?? null}
                workedMs={workedMs(run)}
                onOpenDiff={(path) => patch(tabKey, { view: 'diff', file: path })}
                onStopTask={(taskId) => stopTask(runId, taskId)}
                costume={costume}
              />
            )}
          </div>
        ) : view === 'diff' ? (
          <Changes
            purged={detail.purged}
            source={source}
            active={active}
            turn={turn}
            file={file}
            onFile={(f) => patch(tabKey, { file: f })}
          />
        ) : (
          <div className="run-tab__column">
            <Audit detail={detail} userName={userName} />
          </div>
        )}
      </div>
      {steps && !detail?.purged ? (
        <ActivityDock
          steps={steps}
          onStopTask={(taskId) => stopTask(runId, taskId)}
          onLocate={(key) => {
            patch(tabKey, { view: 'process' })
            setLocate(key)
          }}
        />
      ) : null}
    </div>
  )
}

export function useRunTabMeta(tab: TabProps<'run'>['tab']): TabMeta {
  const run = useRunInfo((s) => s.runs[tab.runId])
  const round = useRunInfo((s) => s.rounds[tab.runId])
  const name = useWorkspace((s) => s.bots.find((b) => b.id === run?.botId)?.name) ?? 'Bot'
  return {
    icon: 'square-terminal',
    title: round ? t('{name} · 第 {round} 轮', { name, round }) : t('{name} · 运行', { name }),
    status: !run
      ? undefined
      : run.status === 'completed'
        ? 'done'
        : FAILED.includes(run.status)
          ? 'failed'
          : 'running',
  }
}

const workedMs = (run?: RunDto) =>
  run?.startedAt && run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null

/** Earlier rounds of this run's agent session, revealed one per click above it so the conversation reads on. */
function EarlierRounds({ runId, root }: { runId: string; root: string | null }) {
  const [rounds, setRounds] = useState<RunSessionDto['rounds']>([])
  const [shown, setShown] = useState(0)
  useEffect(() => {
    api.get<RunSessionDto>(`/runs/${runId}/session`).then(
      (d) => {
        setRounds(d.rounds)
        useRunInfo.setState((s) => ({ rounds: { ...s.rounds, [runId]: d.rounds.length + 1 } }))
      },
      (e: Error) => toast({ type: 'error', message: t('无法加载上一轮：{error}', { error: e.message }) }),
    )
  }, [runId])
  const left = rounds.length - shown
  return (
    <>
      {left > 0 ? (
        <button type="button" className="run-rounds__more" onClick={() => setShown(shown + 1)}>
          <Icon name="chevron-up" size={14} />
          {t('查看上一轮（还有 {n} 轮）', { n: left })}
        </button>
      ) : null}
      {rounds.slice(left).map((r) => (
        <PastRound key={r.run.id} run={r.run} prompt={r.prompt} root={root} />
      ))}
      {shown > 0 ? <div className="run-rounds__divider">{t('本轮')}</div> : null}
    </>
  )
}

function PastRound({ run, prompt, root }: { run: RunDto; prompt: string; root: string | null }) {
  const [open, setOpen] = useState(true)
  const { detail, error } = useRunDetail(run.id, true)
  const worked = workedMs(run)
  return (
    <section className="run-round">
      <button type="button" className="run-round__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron-right" size={12} className="run-round__chevron" />
        <span className="run-round__prompt">{prompt || '—'}</span>
        <span className="run-round__meta">
          {run.startedAt ? hm(run.startedAt) : ''}
          {worked === null ? '' : ` · ${fmtDuration(worked)}`}
        </span>
        <Tag tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Tag>
      </button>
      {!open ? null : error ? (
        <div className="run-tab__empty">{error}</div>
      ) : !detail ? (
        <Spinner />
      ) : detail.purged ? (
        <div className="run-tab__empty">{PURGED}</div>
      ) : (
        <ProcessView
          steps={buildSteps(detail)}
          root={root}
          live={LIVE.includes(run.status)}
          startedAt={run.startedAt}
          workedMs={worked}
          onOpenDiff={(path) => openTab({ kind: 'run', runId: run.id, view: 'diff', file: path })}
          onStopTask={(taskId) => stopTask(run.id, taskId)}
        />
      )}
    </section>
  )
}

async function stopTask(runId: string, taskId: string) {
  try {
    const { sent } = await api.post<TaskStopRes>(`/runs/${runId}/tasks/${encodeURIComponent(taskId)}/stop`)
    if (!sent) throw new Error(t('Bot 所在机器离线'))
  } catch (e) {
    toast({ type: 'error', message: t('停止失败：{error}', { error: (e as Error).message }) })
    throw e
  }
}

function SessionId({ id }: { id: string }) {
  const copy = () => void copyWithToast(id, t('已复制会话 ID'))
  return (
    <span className="run-tab__session">
      <span className="run-tab__session-id" title={id}>
        {id}
      </span>
      <button
        type="button"
        className="run-tab__copy"
        aria-label={t('复制会话 ID')}
        title={t('复制会话 ID')}
        onClick={() => void copy()}
      >
        <Icon name="copy" size={12} />
      </button>
    </span>
  )
}

/** 改动: this turn (live while it runs), the workspace's uncommitted work, or the branch against main. */
function Changes({
  purged,
  source,
  active,
  turn,
  file,
  onFile,
}: {
  purged: boolean
  source: DiffSource
  active: boolean
  turn: WorkspaceDiff
  file: string | null
  onFile: (file: string | null) => void
}) {
  const [scope, setScope] = useState<DiffScope>('turn')
  const other = useWorkspaceDiff(scope === 'turn' || !active ? null : source, scope)
  return (
    <DiffPane
      diff={scope === 'turn' ? turn : other}
      scope={scope}
      turn
      file={file}
      onScope={(s) => {
        setScope(s)
        onFile(null)
      }}
      onFile={onFile}
      onLocate={(path) => locateFile(source.botId, path)}
      notice={scope === 'turn' && purged ? PURGED : undefined}
    />
  )
}

function Audit({ detail, userName }: { detail: RunDetailDto; userName: (id: string | null) => string }) {
  const { run } = detail
  const rows = [
    {
      at: run.queuedAt,
      text:
        run.hop > 1
          ? t('接力第 {hop} 跳 · 发起人 {name}', { hop: run.hop, name: userName(run.originUserId) })
          : t('{name} 触发运行', { name: userName(run.triggerUserId) }),
    },
    ...run.approvals.map((a) => ({
      at: a.createdAt,
      text: t('权限请求：{detail} · {status}', { detail: a.detail, status: approvalText(a) }),
    })),
    ...(run.stoppedBy && run.endedAt
      ? [{ at: run.endedAt, text: t('{name} 停止了运行', { name: userName(run.stoppedBy) }) }]
      : []),
  ]
  return (
    <>
      {rows.map((r) => (
        <div key={`${r.at}${r.text}`} className="run-audit">
          <span className="run-audit__time">{hm(r.at)}</span>
          <span className="run-audit__text">{r.text}</span>
        </div>
      ))}
      <div className="run-audit__note">
        {t('审批与提问记录永久保存；完整运行过程保留 {n} 天，过期后卡片只保留摘要。', {
          n: detail.retentionDays,
        })}
      </div>
    </>
  )
}
