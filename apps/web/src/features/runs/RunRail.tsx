import type { RunDetailDto } from '@aiws/protocol'
import {
  Brain,
  CircleDot,
  FileCode,
  FileText,
  Globe,
  Inbox,
  MessageSquare,
  MoveRight,
  PenLine,
  Search,
  ShieldAlert,
  Terminal,
  Trash,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { realtime } from '../../lib/realtime'
import { Badge, CloseButton, EmptyState, Spinner, Tabs } from '../../ui'
import { fmtDuration, fmtUsage, RUN_STATUS, useNow } from '../chat/TimelineItems'
import { approvalText, buildSteps, type DiffFile, findFile, hhmm, parsePatch, type Step } from './process'
import { type RailTab, useRunRail } from './rail'
import './runs.css'

const TABS: { value: RailTab; label: string }[] = [
  { value: 'process', label: '过程' },
  { value: 'diff', label: '文件 diff' },
  { value: 'audit', label: '审批记录' },
]
const STEP_ICON: Record<string, typeof CircleDot> = {
  context: Inbox,
  thought: Brain,
  think: Brain,
  text: MessageSquare,
  approval: ShieldAlert,
  read: FileText,
  edit: PenLine,
  delete: Trash,
  move: MoveRight,
  search: Search,
  execute: Terminal,
  fetch: Globe,
  other: Wrench,
}
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
            last?.event.kind === 'text'
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
  const { tab, file, setTab, setFile, close } = useRunRail()
  const { detail, error } = useRunDetail(runId)
  const bots = useWorkspace((s) => s.bots)
  const groups = useWorkspace((s) => s.groups)
  const run = detail?.run
  const now = useNow(!!run && LIVE.includes(run.status) && !!run.startedAt)
  const bot = bots.find((b) => b.id === run?.botId)
  const members = groups.find((g) => g.id === run?.groupId)?.members ?? []
  const userName = (id: string | null) => members.find((m) => m.userId === id)?.name ?? '—'
  const started = run?.startedAt ? Date.parse(run.startedAt) : null
  const ended = run?.endedAt ? Date.parse(run.endedAt) : now
  return (
    <div className="run-rail" data-testid="run-rail">
      <div className="run-rail__head">
        <div className="run-rail__title">
          <span className="run-rail__bot">{bot?.name ?? 'bot'}</span>
          {run ? (
            <Badge variant={RUN_STATUS[run.status].variant}>{RUN_STATUS[run.status].label}</Badge>
          ) : null}
          <span className="spacer" />
          <CloseButton onClick={close} />
        </div>
        {run ? (
          <dl className="run-rail__facts">
            <Fact label="触发人">{userName(run.triggerUserId ?? run.originUserId)}</Fact>
            <Fact label="机器" mono>
              {bot?.machineName ?? '—'}
            </Fact>
            <Fact label="耗时 · 用量">
              {started === null ? '—' : fmtDuration(ended - started)} · {fmtUsage(run.usage)}
            </Fact>
            <Fact label="会话" mono>
              {detail.sessionId ?? '—'}
            </Fact>
          </dl>
        ) : null}
        <Tabs size="sm" items={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="run-rail__body">
        {error ? (
          <EmptyState bare title="无法加载运行过程" description={error} />
        ) : !detail ? (
          <div className="run-rail__loading">
            <Spinner />
          </div>
        ) : tab === 'process' ? (
          detail.purged ? (
            <div className="run-rail__empty">{PURGED}</div>
          ) : (
            buildSteps(detail).map((s) => <StepRow key={s.key} step={s} />)
          )
        ) : tab === 'diff' ? (
          <DiffTab detail={detail} file={file} onFile={setFile} />
        ) : (
          <AuditTab detail={detail} userName={userName} />
        )}
      </div>
    </div>
  )
}

function Fact({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="run-rail__fact">
      <dt>{label}</dt>
      <dd className={cx(mono && 'run-rail__mono')}>{children}</dd>
    </div>
  )
}

function StepRow({ step }: { step: Step }) {
  const Icon = STEP_ICON[step.kind] ?? CircleDot
  const head = (
    <>
      <Icon size={13} className="run-step__icon" />
      <span className="run-step__label">{step.label}</span>
      <span className="spacer" />
      {step.meta ? (
        <span className={cx('run-step__meta', step.failed && 'run-step__meta--failed')}>{step.meta}</span>
      ) : null}
    </>
  )
  if (step.kind === 'thought')
    return (
      <details className="run-step">
        <summary className="run-step__head">{head}</summary>
        <div className="run-step__body">{step.body}</div>
      </details>
    )
  return (
    <div className="run-step">
      <div className="run-step__head">{head}</div>
      {step.body ? <div className="run-step__body">{step.body}</div> : null}
      {step.mono ? <div className="run-step__mono">{step.mono}</div> : null}
      {step.out ? <pre className="run-step__out">{step.out}</pre> : null}
    </div>
  )
}

function DiffTab({
  detail,
  file,
  onFile,
}: {
  detail: RunDetailDto
  file: string | null
  onFile: (path: string) => void
}) {
  if (detail.purged) return <div className="run-rail__empty">{PURGED}</div>
  const files = parsePatch(detail.patch ?? '')
  const picked = file === null ? files[0] : findFile(files, file)
  return (
    <>
      {files.length ? (
        <div className="run-diff__files">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              className={cx('run-diff__file', f === picked && 'run-diff__file--active')}
              onClick={() => onFile(f.path)}
            >
              <FileCode size={12} />
              <span className="run-diff__path">{f.path}</span>
              <span className="run-diff__add">+{f.add}</span>
              <span className="run-diff__del">−{f.del}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="run-rail__empty">本轮没有文件改动</div>
      )}
      {picked ? (
        <DiffView file={picked} />
      ) : file !== null ? (
        <div className="run-rail__empty">
          <span className="run-rail__mono">{file}</span>
          <br />
          该文件本轮未改动
        </div>
      ) : null}
    </>
  )
}

const lineClass = (l: string) =>
  l.startsWith('+')
    ? 'add'
    : l.startsWith('-')
      ? 'del'
      : l.startsWith('@@')
        ? 'hunk'
        : l.startsWith(' ')
          ? ''
          : 'note'

function DiffView({ file }: { file: DiffFile }) {
  return (
    <div className="run-diff">
      <div className="run-diff__name">{file.path}</div>
      <div className="run-diff__lines">
        {file.lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and never reorder
          <div key={i} className={cx('run-diff__line', lineClass(l) && `run-diff__line--${lineClass(l)}`)}>
            {l || ' '}
          </div>
        ))}
      </div>
    </div>
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
      ? [{ at: run.endedAt, text: `${userName(run.stoppedBy)} 执行了 /stop` }]
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
