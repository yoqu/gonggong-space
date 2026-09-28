import {
  agentConfigLabel,
  type DiffScope,
  type RunDetailDto,
  type RunDto,
  type RunSessionDto,
  type TaskStopRes,
} from '@gonggong/protocol'
import { useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { useNow } from '../../lib/now'
import { realtime } from '../../lib/realtime'
import {
  CloseButton,
  EmptyState,
  FailedArt,
  GroupBox,
  GroupRow,
  Icon,
  IconButton,
  NoChangesArt,
  Spinner,
  Tabs,
  Tag,
  Toolbar,
  toast,
  useEscape,
} from '../../ui'
import { BotAvatar, useBotCostume } from '../bots/avatars'
import { fmtDuration, fmtUsage, RUN_STATUS } from '../chat/TimelineItems'
import { DiffFileList, DiffLayoutToggle, DiffScopeBar, emptyText, scopeNote } from '../diff/DiffParts'
import { type DiffSource, useDiffWindow } from '../diff/store'
import { useWorkspaceDiff, type WorkspaceDiff } from '../diff/useWorkspaceDiff'
import { ProcessView } from './ProcessView'
import { approvalText, buildSteps, hhmm } from './process'
import { type RailTab, useRunRail } from './rail'
import './rail.css'
import './runs.css'

const TABS: { value: RailTab; label: string }[] = [
  { value: 'process', label: '过程' },
  { value: 'diff', label: '改动' },
  { value: 'audit', label: '审批记录' },
]
const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']
const PURGED = '运行过程已过期，仅保留摘要'
/** Coalesces bursts of run.updated into one refetch. */
const REFETCH_MS = 300

/** GET /api/runs/:id, kept live: card updates refetch the process, streamed text is appended in place. */
function useRunDetail(runId: string) {
  const [detail, setDetail] = useState<RunDetailDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      api.get<RunDetailDto>(`/runs/${runId}`).then(
        (d) => alive && setDetail(d),
        (e: Error) => alive && setError(e.message),
      )
    void load()
    const off = realtime.subscribe((e) => {
      if (e.t === 'run.updated' && e.run.id === runId) {
        setDetail((d) => d && { ...d, run: e.run })
        clearTimeout(timer)
        timer = setTimeout(load, REFETCH_MS)
      } else if (e.t === 'run.delta' && e.runId === runId)
        setDetail((d) => {
          if (!d) return d
          const last = d.events.at(-1)
          const events =
            last?.event.kind === 'text' && !last.event.agentId
              ? [
                  ...d.events.slice(0, -1),
                  { ...last, event: { kind: 'text' as const, delta: last.event.delta + e.text } },
                ]
              : [
                  ...d.events,
                  {
                    id: -Date.now(),
                    at: new Date().toISOString(),
                    event: { kind: 'text' as const, delta: e.text },
                  },
                ]
          return { ...d, events }
        })
    })
    return () => {
      alive = false
      off()
      clearTimeout(timer)
    }
  }, [runId])
  return { detail, error }
}

/** Right rail for one run (spec §8.2): header facts, then 过程 / 文件 diff / 审批记录. */
export function RunRail({ runId }: { runId: string }) {
  const { tab, setTab, close } = useRunRail()
  const { detail, error } = useRunDetail(runId)
  useEscape(close)
  const bots = useWorkspace((s) => s.bots)
  const groups = useWorkspace((s) => s.groups)
  const run = detail?.run
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
  const turn = useWorkspaceDiff(source, 'turn', live ? undefined : (detail?.patch ?? null))
  const openDiff = useDiffWindow((s) => s.open)
  // Machine and session id are rarely needed; hidden behind ⓘ so the process gets the height.
  const [more, setMore] = useState(false)
  const started = run?.startedAt ? Date.parse(run.startedAt) : null
  const ended = run?.endedAt ? Date.parse(run.endedAt) : now
  return (
    <div className="run-rail" data-testid="run-rail">
      <Toolbar
        className="rail-bar"
        scrolled={false}
        leading={<BotAvatar id={bot?.id} name={bot?.name ?? 'bot'} size={24} />}
        title={bot?.name ?? 'bot'}
        subtitle={run ? `${userName(run.triggerUserId ?? run.originUserId)} 触发` : undefined}
      >
        {run ? <Tag tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Tag> : null}
        <IconButton title="机器与会话" aria-pressed={more} onClick={() => setMore(!more)}>
          <Icon name="info" />
        </IconButton>
        <CloseButton onClick={close} />
      </Toolbar>
      <div className="run-rail__head">
        {run ? (
          <div className="run-rail__facts">
            <span className="run-rail__fact" title="模型">
              <Icon name="cpu" size={14} />
              <span className="run-rail__val">
                {run.model || run.effort
                  ? agentConfigLabel(
                      bot?.catalog ?? null,
                      run.model ?? bot?.catalog?.current ?? null,
                      run.effort,
                    )
                  : '默认'}
              </span>
            </span>
            <span className="run-rail__fact" title="耗时">
              <Icon name="clock" size={14} />
              {started === null ? '—' : fmtDuration(ended - started)}
            </span>
            <span className="run-rail__fact" title="用量">
              <Icon name="chart-bar" size={14} />
              <span className="run-rail__val">{fmtUsage(run.usage)}</span>
            </span>
          </div>
        ) : null}
        {run && more ? (
          <GroupBox>
            <GroupRow label="机器">
              <span className="run-rail__val run-rail__mono">{bot?.machineName ?? '—'}</span>
            </GroupRow>
            <GroupRow label="会话">
              <span className="run-rail__val run-rail__mono">
                {detail.sessionId ? <SessionId id={detail.sessionId} /> : '—'}
              </span>
            </GroupRow>
          </GroupBox>
        ) : null}
        <Tabs size="sm" items={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="run-rail__body">
        {error ? (
          <EmptyState bare illustration={<FailedArt />} title="无法加载运行过程" description={error} />
        ) : !detail ? (
          <div className="run-rail__loading">
            <Spinner />
          </div>
        ) : !source ? null : tab === 'process' ? (
          <>
            <EarlierRounds key={runId} runId={runId} root={root} />
            {detail.purged ? (
              <div className="run-rail__empty">{PURGED}</div>
            ) : (
              <ProcessView
                key={runId}
                steps={buildSteps(live && turn.patch !== null ? { ...detail, patch: turn.patch } : detail)}
                root={root}
                live={live}
                startedAt={run?.startedAt ?? null}
                workedMs={workedMs(run)}
                onOpenDiff={(path) => openDiff(source, 'turn', path)}
                onStopTask={(taskId) => stopTask(runId, taskId)}
                costume={costume}
              />
            )}
          </>
        ) : tab === 'diff' ? (
          <ChangesTab detail={detail} source={source} turn={turn} />
        ) : (
          <AuditTab detail={detail} userName={userName} />
        )}
      </div>
    </div>
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
      (d) => setRounds(d.rounds),
      (e: Error) => toast({ type: 'error', message: `无法加载上一轮：${e.message}` }),
    )
  }, [runId])
  const left = rounds.length - shown
  return (
    <>
      {left > 0 ? (
        <button type="button" className="run-rounds__more" onClick={() => setShown(shown + 1)}>
          <Icon name="chevron-up" size={14} />
          查看上一轮（还有 {left} 轮）
        </button>
      ) : null}
      {rounds.slice(left).map((r) => (
        <PastRound key={r.run.id} run={r.run} prompt={r.prompt} root={root} />
      ))}
      {shown > 0 ? <div className="run-rounds__divider">本轮</div> : null}
    </>
  )
}

function PastRound({ run, prompt, root }: { run: RunDto; prompt: string; root: string | null }) {
  const [open, setOpen] = useState(true)
  const { detail, error } = useRunDetail(run.id)
  const openDiff = useDiffWindow((s) => s.open)
  const worked = workedMs(run)
  return (
    <section className="run-round">
      <button type="button" className="run-round__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron-right" size={12} className="run-round__chevron" />
        <span className="run-round__prompt">{prompt || '—'}</span>
        <span className="run-round__meta">
          {run.startedAt ? hhmm(run.startedAt) : ''}
          {worked === null ? '' : ` · ${fmtDuration(worked)}`}
        </span>
        <Tag tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Tag>
      </button>
      {!open ? null : error ? (
        <div className="run-rail__empty">{error}</div>
      ) : !detail ? (
        <Spinner />
      ) : detail.purged ? (
        <div className="run-rail__empty">{PURGED}</div>
      ) : (
        <ProcessView
          steps={buildSteps(detail)}
          root={root}
          live={LIVE.includes(run.status)}
          startedAt={run.startedAt}
          workedMs={worked}
          onOpenDiff={(path) =>
            openDiff({ groupId: run.groupId, botId: run.botId, runId: run.id }, 'turn', path)
          }
          onStopTask={(taskId) => stopTask(run.id, taskId)}
        />
      )}
    </section>
  )
}

async function stopTask(runId: string, taskId: string) {
  try {
    const { sent } = await api.post<TaskStopRes>(`/runs/${runId}/tasks/${encodeURIComponent(taskId)}/stop`)
    if (!sent) throw new Error('Bot 所在机器离线')
  } catch (e) {
    toast({ type: 'error', message: `停止失败：${(e as Error).message}` })
    throw e
  }
}

function SessionId({ id }: { id: string }) {
  // navigator.clipboard is missing outside secure contexts, so the call itself may throw.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      toast({ type: 'success', message: '已复制会话 ID' })
    } catch {
      toast({ type: 'error', message: '复制失败' })
    }
  }
  return (
    <span className="run-rail__session">
      <span className="run-rail__session-id" title={id}>
        {id}
      </span>
      <button
        type="button"
        className="run-rail__copy"
        aria-label="复制会话 ID"
        title="复制会话 ID"
        onClick={() => void copy()}
      >
        <Icon name="copy" size={12} />
      </button>
    </span>
  )
}

/** 改动: this turn (live while it runs), the workspace's uncommitted work, or the branch against main. */
function ChangesTab({
  detail,
  source,
  turn,
}: {
  detail: RunDetailDto
  source: DiffSource
  turn: WorkspaceDiff
}) {
  const [scope, setScope] = useState<DiffScope>('turn')
  const openDiff = useDiffWindow((s) => s.open)
  const other = useWorkspaceDiff(scope === 'turn' ? null : source, scope)
  const diff = scope === 'turn' ? turn : other
  const { file } = useRunRail()
  // A file asked for from a reply or a notification opens straight in the diff window.
  useEffect(() => {
    if (!file) return
    openDiff(source, 'turn', file)
    useRunRail.setState({ file: null })
  }, [file, source, openDiff])
  return (
    <>
      <div className="run-changes__bar">
        <DiffScopeBar scope={scope} turn onChange={setScope} />
        <span className="run-changes__branch">{scopeNote(scope, diff.branch, diff.base)}</span>
        <DiffLayoutToggle />
      </div>
      {scope === 'turn' && detail.purged ? (
        <div className="run-rail__empty">{PURGED}</div>
      ) : diff.loading && !diff.files.length ? (
        <div className="run-rail__loading">
          <Spinner />
        </div>
      ) : diff.error ? (
        <EmptyState compact icon="warning" title="无法读取改动" description={diff.error} />
      ) : diff.files.length ? (
        <DiffFileList files={diff.files} onPick={(path) => openDiff(source, scope, path)} />
      ) : (
        <EmptyState
          compact
          illustration={<NoChangesArt />}
          title={emptyText(scope, diff.branch, diff.base)}
        />
      )}
    </>
  )
}

function AuditTab({ detail, userName }: { detail: RunDetailDto; userName: (id: string | null) => string }) {
  const { run } = detail
  const rows = [
    {
      at: run.queuedAt,
      text:
        run.hop > 1
          ? `接力第 ${run.hop} 跳 · 发起人 ${userName(run.originUserId)}`
          : `${userName(run.triggerUserId)} 触发运行`,
    },
    ...run.approvals.map((a) => ({ at: a.createdAt, text: `权限请求：${a.detail} · ${approvalText(a)}` })),
    ...(run.stoppedBy && run.endedAt
      ? [{ at: run.endedAt, text: `${userName(run.stoppedBy)} 停止了运行` }]
      : []),
  ]
  return (
    <>
      {rows.map((r) => (
        <div key={`${r.at}${r.text}`} className="run-audit">
          <span className="run-audit__time">{hhmm(r.at)}</span>
          <span className="run-audit__text">{r.text}</span>
        </div>
      ))}
      <div className="run-audit__note">
        审批与提问记录永久保存；完整运行过程保留 {detail.retentionDays} 天，过期后卡片只保留摘要。
      </div>
    </>
  )
}
