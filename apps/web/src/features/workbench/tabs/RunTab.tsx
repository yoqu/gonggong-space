import {
  agentConfigLabel,
  type DiffScope,
  type RunDetailDto,
  type RunDto,
  type RunEventsDto,
  type RunSessionDto,
  type TaskStopRes,
  TERMINAL_RUN_STATUS,
  withRunStep,
} from '@gonggong/protocol'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useSession } from '../../../app/session'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { api } from '../../../lib/api'
import { copyWithToast } from '../../../lib/clipboard'
import { cx } from '../../../lib/cx'
import { attempt } from '../../../lib/errors'
import { Elapsed } from '../../../lib/now'
import { realtime } from '../../../lib/realtime'
import { hm, hms, stamp } from '../../../lib/time'
import {
  Button,
  EmptyState,
  FailedArt,
  GroupBox,
  GroupRow,
  Icon,
  IconButton,
  MenuButton,
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
import { fieldLabel, tokensLabel } from '../../machines/agentSettings'
import { OFFICIAL_NAME } from '../../machines/providers'
import { ActivityDock } from '../../runs/ActivityDock'
import { ApprovalCard } from '../../runs/ApprovalBlock'
import { processMarkdown, processText } from '../../runs/activity'
import { IssueBanner } from '../../runs/IssueBanner'
import { runIssue } from '../../runs/issue'
import { ProcessView } from '../../runs/ProcessView'
import { approvalText, buildSteps, questionText } from '../../runs/process'
import { QuestionCard } from '../../runs/QuestionBlock'
import type { Step } from '../../runs/steps'
import { SOURCE_LABEL } from '../../secrets/api'
import { openTab } from '../open'
import type { TabMeta, TabProps } from '../types'
import { locateFile, openFileAt } from './DiffTab'
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
/** Coalesces bursts of run.updated / run.progress / run.step into one refetch. */
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
 * GET /api/runs/:id, kept live while shown: realtime events refetch the process from its last stored event on,
 * streamed text is kept as a tail after it. The card itself comes with the events, so a refetch reads the whole
 * detail again only while the run has not ended (its patch is stored at the end), else just the process. A hidden
 * tab only keeps the card current and catches up once shown again.
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
    // Loads read the whole detail from request `wholeFrom` on until one of those was applied (`wholeGot`).
    let wholeFrom = 1
    let wholeGot = 0
    /** Seen ended: beyond the card (realtime) only the process changes any more. */
    let ended = false
    const wantWhole = () => {
      if (!ended) wholeFrom = seq + 1
    }
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
      const query = since ? `?since=${since}` : ''
      const request: Promise<RunDetailDto | RunEventsDto> =
        wholeGot < wholeFrom
          ? api.get<RunDetailDto>(`/runs/${runId}${query}`)
          : api.get<RunEventsDto>(`/runs/${runId}/events${query}`)
      request.then(
        (d) => {
          if (!alive || mine !== seq) return
          if ('run' in d) {
            wholeGot = mine
            ended ||= TERMINAL_RUN_STATUS.includes(d.run.status)
          }
          // The stored events now hold what was streamed so far.
          pending = ''
          clearTimeout(flushTimer)
          flushTimer = undefined
          setTail(null)
          setDetail((prev) => {
            const events =
              since && prev ? [...prev.events.filter((e) => e.id < since), ...d.events] : d.events
            return 'run' in d ? { ...d, events } : prev && { ...prev, purged: d.purged, events }
          })
        },
        (e: Error) => alive && mine === seq && setError(e.message),
      )
    }
    load()
    const off = realtime.subscribe((e) => {
      const moved =
        e.t === 'run.updated' ? e.run.id : e.t === 'run.progress' || e.t === 'run.step' ? e.runId : null
      if (moved === runId) {
        if (e.t === 'run.updated') {
          wantWhole()
          ended ||= TERMINAL_RUN_STATUS.includes(e.run.status)
          setDetail((d) => d && { ...d, run: e.run })
        } else if (e.t === 'run.step') setDetail((d) => d && { ...d, run: withRunStep(d.run, e) })
        // Throttled, not debounced: a steady stream of events would otherwise postpone the refetch until it stops.
        if (shown.current)
          timer ??= setTimeout(() => {
            timer = undefined
            load()
          }, REFETCH_MS)
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
    const offReconnect = realtime.onReconnect(() => {
      wantWhole()
      if (shown.current) load()
      else catchUp.current = load
    })
    return () => {
      alive = false
      off()
      offReconnect()
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
  const run = detail?.run
  useEffect(() => {
    if (run) useRunInfo.setState((s) => ({ runs: { ...s.runs, [run.id]: run } }))
  }, [run])
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run?.botId))
  const costume = useBotCostume(bot?.id)
  const members = useWorkspace((s) => s.groups.find((g) => g.id === run?.groupId)?.members) ?? []
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
  const [locate, setLocate] = useState<{ view: RunView; key: string } | null>(null)
  useEffect(() => {
    if (!locate || view !== locate.view) return
    tabRef.current
      ?.querySelector(`[data-step="${CSS.escape(locate.key)}"]`)
      ?.scrollIntoView({ block: 'center' })
    setLocate(null)
  }, [locate, view])
  const goTo = (to: RunView, key: string) => {
    patch(tabKey, { view: to })
    setLocate({ view: to, key })
  }
  const body = useRef<HTMLDivElement>(null)
  const away = useFollow(body, live && view === 'process', steps)
  const started = run?.startedAt ? Date.parse(run.startedAt) : null
  const issue = run ? runIssue(run) : null
  const me = useSession((s) => s.user?.id)
  // The server allows the same: an unfinished hop-1 run (stopped ones too), by its trigger user or the bot owner.
  const canRetry =
    !!run &&
    run.hop === 1 &&
    (run.status === 'interrupted' || run.status === 'expired') &&
    !!me &&
    (me === run.originUserId || me === bot?.ownerId)
  const retry = async () => {
    const ok = await attempt(() => api.post(`/runs/${runId}/retry`))
    if (ok) toast({ type: 'success', message: t('已重新运行，新的运行卡片会出现在群里') })
    return ok
  }
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
        {steps && !detail?.purged ? (
          <MenuButton
            className="ui-btn ui-btn--plain ui-btn--large ui-btn--icon ui-icon-btn"
            title={t('复制过程')}
            aria-label={t('复制过程')}
            align="end"
            items={[
              { label: t('复制为纯文本'), value: 'text' },
              { label: t('复制为 Markdown'), value: 'markdown' },
            ]}
            onSelect={(v) =>
              void copyWithToast(
                (v === 'markdown' ? processMarkdown : processText)(steps, root),
                t('已复制过程'),
              )
            }
          >
            <Icon name="copy" />
          </MenuButton>
        ) : null}
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
              {started === null ? (
                '—'
              ) : (
                <Elapsed
                  from={started}
                  to={run.endedAt ? Date.parse(run.endedAt) : null}
                  ticking={live && active}
                  format={fmtDuration}
                />
              )}
            </span>
            {run.startedAt ? (
              <span className="run-tab__fact" title={t('开始 – 结束')}>
                <Icon name="calendar" size={14} />
                <span className="run-tab__val run-tab__mono">
                  {`${stamp(run.startedAt, null)} – ${run.endedAt ? stamp(run.endedAt, run.startedAt) : t('进行中')}`}
                </span>
              </span>
            ) : null}
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
            {run.secrets?.length ? (
              <GroupRow label={t('本次注入的密钥')}>
                <span className="run-tab__val run-tab__mono">
                  {run.secrets
                    .map((s) => t('{name}（{source}）', { name: s.name, source: SOURCE_LABEL[s.source] }))
                    .join(t('、'))}
                </span>
              </GroupRow>
            ) : null}
          </GroupBox>
        ) : null}
        {more && detail?.settings ? <RunSettings settings={detail.settings} /> : null}
        {issue ? <IssueBanner issue={issue} onRetry={canRetry ? retry : undefined} /> : null}
        <Tabs size="sm" items={VIEWS} value={view} onChange={(v) => patch(tabKey, { view: v })} />
      </div>
      <div
        ref={body}
        className={cx('run-tab__body', view === 'diff' && 'run-tab__body--fill')}
        onScroll={away.onScroll}
      >
        {error ? (
          <EmptyState bare illustration={<FailedArt />} title={t('无法加载运行过程')} description={error} />
        ) : !detail ? (
          <div className="run-tab__loading">
            <Spinner />
          </div>
        ) : !source ? null : view === 'process' ? (
          <div className="run-tab__column">
            <Pending run={detail.run} />
            <EarlierRounds key={`${runId}:earlier`} runId={runId} root={root} />
            {detail.purged ? (
              <>
                <div className="run-tab__empty">{PURGED}</div>
                <ProcessView
                  steps={(stored ?? []).filter((s) => s.kind === 'approval' || s.kind === 'question')}
                  root={root}
                  live={false}
                  startedAt={run?.startedAt ?? null}
                  workedMs={null}
                  renderAsk={(s) => decidedAsk(detail.run, s, (key) => goTo('audit', key))}
                />
              </>
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
                active={active}
                renderAsk={(s) => decidedAsk(detail.run, s, (key) => goTo('audit', key))}
                filterable
              />
            )}
            {away.shown ? (
              <Button size="small" icon="arrow-down" className="run-tab__follow" onClick={away.back}>
                {t('回到最新')}
              </Button>
            ) : null}
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
            <Audit detail={detail} userName={userName} onLocate={(key) => goTo('process', key)} />
          </div>
        )}
      </div>
      {steps && !detail?.purged ? (
        <ActivityDock
          steps={steps}
          onStopTask={(taskId) => stopTask(runId, taskId)}
          onLocate={(key) => goTo('process', key)}
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
    badge: run && waiting(run) ? t('待处理') : undefined,
    status: !run
      ? undefined
      : run.status === 'completed'
        ? 'done'
        : FAILED.includes(run.status)
          ? 'failed'
          : 'running',
  }
}

/** Pixels from the end a pane may be and still count as following. */
const FOLLOW_SLACK = 40

/**
 * While `on` (a live run's process), new steps keep the pane at its end, as long as the user has not scrolled up;
 * then 回到最新 brings them back.
 */
function useFollow(ref: RefObject<HTMLDivElement | null>, on: boolean, steps: unknown) {
  const [up, setUp] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow every new step
  useEffect(() => {
    const el = ref.current
    if (on && !up && el) el.scrollTop = el.scrollHeight
  }, [on, up, steps, ref])
  return {
    shown: on && up,
    onScroll: () => {
      const el = ref.current
      if (el) setUp(el.scrollHeight - el.scrollTop - el.clientHeight > FOLLOW_SLACK)
    },
    back: () => {
      const el = ref.current
      if (el) el.scrollTop = el.scrollHeight
      setUp(false)
    },
  }
}

const waiting = (run: RunDto) =>
  run.approvals.some((a) => a.status === 'pending') || run.questions.some((q) => q.status === 'pending')

/** Requests the run waits on, on top of its process: whoever may decide does it here. */
function Pending({ run }: { run: RunDto }) {
  const approvals = run.approvals.filter((a) => a.status === 'pending')
  const questions = run.questions.filter((q) => q.status === 'pending')
  if (!approvals.length && !questions.length) return null
  return (
    <section className="run-pending" aria-label={t('待处理')}>
      {approvals.map((a) => (
        <div key={a.id} data-step={`a${a.id}`}>
          <ApprovalCard run={run} approval={a} />
        </div>
      ))}
      {questions.map((q) => (
        <div key={q.id} data-step={`q${q.id}`}>
          <QuestionCard run={run} set={q} />
        </div>
      ))}
    </section>
  )
}

/** A decided request as its card where it happened; pending ones keep their row, their card is pinned above. */
function decidedAsk(run: RunDto, step: Step, onAudit: (key: string) => void) {
  if (step.running) return null
  const approval = run.approvals.find((a) => `a${a.id}` === step.key)
  const set = approval ? undefined : run.questions.find((q) => `q${q.id}` === step.key)
  if (!approval && !set) return null
  return (
    <>
      {approval ? <ApprovalCard run={run} approval={approval} /> : null}
      {set ? <QuestionCard run={run} set={set} /> : null}
      <button type="button" className="run-ask__audit" onClick={() => onAudit(step.key)}>
        {t('在审批记录中查看')}
      </button>
    </>
  )
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
  const steps = useMemo(() => (detail ? buildSteps(detail) : []), [detail])
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
          steps={steps}
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

/** What the run's agent settings came from (session.config). */
function RunSettings({ settings: s }: { settings: NonNullable<RunDetailDto['settings']> }) {
  const names = (ids: string[]) => ids.map(fieldLabel).join(t('、'))
  const rows = [
    [t('供应商'), s.provider ?? OFFICIAL_NAME],
    [t('上下文窗口'), s.contextWindow ? tokensLabel(s.contextWindow) : t('默认')],
    [t('自动压缩窗口'), s.autoCompactWindow ? tokensLabel(s.autoCompactWindow) : t('默认')],
    [t('继承本机 CLI 配置'), s.inheritCli ? t('是') : t('否')],
    ...(s.fromCli.length ? [[t('来自本机 CLI'), names(s.fromCli)]] : []),
    ...(s.fromBot.length ? [[t('Bot 覆盖'), names(s.fromBot)]] : []),
  ]
  return (
    <section aria-label={t('Agent 设置')}>
      <GroupBox>
        {rows.map(([label, value]) => (
          <GroupRow key={label} label={label}>
            <span className="run-tab__val">{value}</span>
          </GroupRow>
        ))}
      </GroupBox>
    </section>
  )
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
      onOpenLine={(path, line) => openFileAt(source.botId, path, line)}
      notice={scope === 'turn' && purged ? PURGED : undefined}
    />
  )
}

function Audit({
  detail,
  userName,
  onLocate,
}: {
  detail: RunDetailDto
  userName: (id: string | null) => string
  /** Leads a request to its place in the process. */
  onLocate: (key: string) => void
}) {
  const { run } = detail
  const rows: { at: string; text: string; key?: string }[] = [
    {
      at: run.queuedAt,
      text:
        run.hop > 1
          ? t('接力第 {hop} 跳 · 发起人 {name}', { hop: run.hop, name: userName(run.originUserId) })
          : t('{name} 触发运行', { name: userName(run.triggerUserId) }),
    },
    ...run.approvals.map((a) => ({
      at: a.createdAt,
      key: `a${a.id}`,
      text: t('权限请求：{detail} · {status}', { detail: a.detail, status: approvalText(a) }),
    })),
    ...run.questions.map((q) => ({
      at: q.createdAt,
      key: `q${q.id}`,
      text: t('提问：{title} · {status}', {
        title: q.questions.map((x) => x.title).join(' / '),
        status: questionText(q),
      }),
    })),
    ...(run.stoppedBy && run.endedAt
      ? [{ at: run.endedAt, text: t('{name} 停止了运行', { name: userName(run.stoppedBy) }) }]
      : []),
  ].sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
  return (
    <>
      {rows.map((r) =>
        r.key ? (
          <button
            key={r.key}
            type="button"
            className="run-audit run-audit--link"
            data-step={r.key}
            title={t('在过程中查看')}
            onClick={() => r.key && onLocate(r.key)}
          >
            <span className="run-audit__time">{hms(r.at)}</span>
            <span className="run-audit__text">{r.text}</span>
          </button>
        ) : (
          <div key={`${r.at}${r.text}`} className="run-audit">
            <span className="run-audit__time">{hms(r.at)}</span>
            <span className="run-audit__text">{r.text}</span>
          </div>
        ),
      )}
      <div className="run-audit__note">
        {t('审批与提问记录永久保存；完整运行过程保留 {n} 天，过期后卡片只保留摘要。', {
          n: detail.retentionDays,
        })}
      </div>
    </>
  )
}
