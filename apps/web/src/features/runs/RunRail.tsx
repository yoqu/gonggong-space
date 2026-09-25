import type { RunDetailDto } from '@gonggong/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { SPRING } from '../../lib/motion'
import { realtime } from '../../lib/realtime'
import {
  Avatar,
  CloseButton,
  EmptyState,
  FailedArt,
  GroupBox,
  GroupRow,
  Icon,
  type IconName,
  Spinner,
  Tabs,
  Tag,
  Toolbar,
  toast,
  useEscape,
} from '../../ui'
import { Markdown } from '../chat/Markdown'
import { fmtDuration, fmtUsage, RUN_STATUS, useNow } from '../chat/TimelineItems'
import {
  approvalText,
  buildSteps,
  type DiffFile,
  diffCells,
  findFile,
  hhmm,
  parsePatch,
  type Step,
} from './process'
import { type RailTab, useRunRail } from './rail'
import './rail.css'
import './runs.css'

const TABS: { value: RailTab; label: string }[] = [
  { value: 'process', label: '过程' },
  { value: 'diff', label: '文件 diff' },
  { value: 'audit', label: '审批记录' },
]
/** Timeline node per step kind; unknown ACP tool kinds fall back to `other`. */
export const STEP_ICON: Record<string, IconName> = {
  context: 'tray',
  thought: 'more',
  think: 'more',
  text: 'bubble',
  status: 'activity',
  approval: 'shield-warning',
  read: 'doc-text',
  edit: 'textformat',
  delete: 'trash',
  move: 'arrow-turn-down-right',
  search: 'search',
  execute: 'terminal',
  fetch: 'cloud',
  other: 'gear',
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
  useEscape(close)
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
      <Toolbar
        className="rail-bar"
        scrolled={false}
        leading={<Avatar name={bot?.name ?? 'bot'} size={24} shape="square" />}
        title={bot?.name ?? 'bot'}
        subtitle={run ? `${userName(run.triggerUserId ?? run.originUserId)} 触发` : undefined}
      >
        {run ? <Tag tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Tag> : null}
        <CloseButton onClick={close} />
      </Toolbar>
      <div className="run-rail__head">
        {run ? (
          <GroupBox>
            <GroupRow label="机器">
              <span className="run-rail__val run-rail__mono">{bot?.machineName ?? '—'}</span>
            </GroupRow>
            <GroupRow label="耗时 · 用量">
              <span className="run-rail__val">
                {started === null ? '—' : fmtDuration(ended - started)} · {fmtUsage(run.usage)}
              </span>
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
        ) : tab === 'process' ? (
          detail.purged ? (
            <div className="run-rail__empty">{PURGED}</div>
          ) : (
            <ol className="run-steps" aria-label="运行过程">
              {/* Steps already there when the rail opens stay put; only new ones slide in. */}
              <AnimatePresence initial={false}>
                {buildSteps(detail).map((s) => (
                  <StepRow key={s.key} step={s} />
                ))}
              </AnimatePresence>
            </ol>
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

function StepRow({ step }: { step: Step }) {
  const state = step.failed ? 'failed' : step.running ? 'running' : 'done'
  const node = `${step.label}${state === 'failed' ? ' · 失败' : state === 'running' ? ' · 进行中' : ''}`
  const head = (
    <>
      <span className="run-step__label">{step.label}</span>
      <span className="spacer" />
      {step.diff ? <DiffBar {...step.diff} /> : null}
      {step.meta ? (
        <span className={cx('run-step__meta', step.failed && 'run-step__meta--failed')}>{step.meta}</span>
      ) : null}
    </>
  )
  return (
    <motion.li
      className="run-step"
      data-state={state}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.snappy}
    >
      <span className="run-step__node" role="img" aria-label={node} title={node}>
        <Icon name={STEP_ICON[step.kind] ?? 'gear'} size={13} />
      </span>
      <div className="run-step__main">
        {step.kind === 'thought' ? (
          <details>
            <summary className="run-step__head">{head}</summary>
            <div className="run-step__body">{step.body}</div>
          </details>
        ) : (
          <>
            <div className="run-step__head">{head}</div>
            {step.body ? (
              step.kind === 'text' ? (
                <div className="run-step__md">
                  <Markdown text={step.body} />
                </div>
              ) : (
                <div className="run-step__body">{step.body}</div>
              )
            ) : null}
            {step.mono ? <div className="run-step__mono">{step.mono}</div> : null}
            {step.out ? <pre className="run-step__out">{step.out}</pre> : null}
          </>
        )}
      </div>
    </motion.li>
  )
}

/** Five cells split between added and deleted lines (GitHub style); the numbers stay as text beside it. */
function DiffBar({ add, del }: { add: number; del: number }) {
  const label = `新增 ${add} 行，删除 ${del} 行`
  return (
    <span className="diff-bar" role="img" aria-label={label} title={label}>
      {diffCells(add, del).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the five cells are positional
        <span key={i} className="diff-bar__cell" data-cell={c} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
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
              <Icon name="doc-code" size={13} />
              <span className="run-diff__path">{f.path}</span>
              <span className="run-diff__add">+{f.add}</span>
              <span className="run-diff__del">−{f.del}</span>
              {f.binary ? null : <DiffBar add={f.add} del={f.del} />}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState compact icon="doc-code" title="本轮没有文件改动" />
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
