import type { MessageDto, RunDto, RunStatus } from '@aiws/protocol'
import {
  Ban,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileText,
  Folder,
  FolderInput,
  GitBranch,
  Hourglass,
  Info,
  Link2,
  Loader,
  MessageCircleQuestion,
  PanelRightOpen,
  Quote,
  RefreshCw,
  ShieldAlert,
  Square,
  UserMinus,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cx } from '../../lib/cx'
import { Badge, type BadgeVariant } from '../../ui'
import { MessageAttachments, MessageQuote } from '../attachments/MessageAttachments'
import { useQuote } from '../attachments/quote'
import { ApprovalBlock } from '../runs/ApprovalBlock'
import { InterruptBlock } from '../runs/InterruptBlock'
import { filePaths } from '../runs/paths'
import { QuestionBlock } from '../runs/QuestionBlock'
import { OfflineNote, RunActions } from '../runs/RunActions'
import { useRunRail } from '../runs/rail'
import { Markdown } from './Markdown'

export const RUN_STATUS: Record<RunStatus, { label: string; variant: BadgeVariant }> = {
  queued: { label: '排队中', variant: 'secondary' },
  offline_wait: { label: '离线等待', variant: 'outline' },
  forbidden: { label: '无权触发', variant: 'outline' },
  running: { label: '运行中', variant: 'info' },
  awaiting_approval: { label: '等待审批', variant: 'warning' },
  awaiting_answer: { label: '等待回答', variant: 'warning' },
  completed: { label: '已完成', variant: 'success' },
  interrupted: { label: '已中断', variant: 'destructive' },
  expired: { label: '已作废', variant: 'outline' },
}

/** Daemon reason codes; the first session of a (group, bot) pair needs no note. */
const NEW_SESSION: Record<string, string | null> = {
  first: null,
  resume_failed: '会话恢复失败，已开新会话并补送最近 50 条群消息',
  requested: '已按要求开启新会话',
  config_changed: '本轮因配置变更开启新会话',
}
export const newSessionNote = (reason: string | null) =>
  reason === null ? null : reason in NEW_SESSION ? NEW_SESSION[reason] : reason

const LIVE: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']
const AWAITING: RunStatus[] = ['awaiting_approval', 'awaiting_answer']

const pad = (n: number) => String(n).padStart(2, '0')

export function fmtTime(iso: string) {
  const d = new Date(iso)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

export function fmtUsage(u: RunDto['usage']) {
  const total = u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)
  if (!total) return '用量未上报'
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k tokens` : `${total} tokens`
}

export function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])
  return now
}

/** Splits text into plain and `@name` segments; the longest known name wins. */
export function splitMentions(text: string, names: string[]) {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)
  const out: { text: string; mention: boolean }[] = []
  let plain = ''
  for (let i = 0; i < text.length; i++) {
    const name = text[i] === '@' ? sorted.find((n) => text.startsWith(n, i + 1)) : undefined
    if (!name) {
      plain += text[i]
      continue
    }
    if (plain) out.push({ text: plain, mention: false })
    out.push({ text: `@${name}`, mention: true })
    plain = ''
    i += name.length
  }
  if (plain) out.push({ text: plain, mention: false })
  return out
}

function eventIcon(body: string) {
  if (body.includes('创建了私聊')) return UserPlus
  if (body.includes('创建了群')) return Users
  if (body.startsWith('群绑定仓库') || body.startsWith('群更换仓库')) return GitBranch
  if (body.startsWith('未绑定仓库')) return Folder
  if (body.includes('移出')) return UserMinus
  if (body.includes(' 加入') || /已 clone 到托管工作区|工作区创建失败/.test(body)) return Bot
  if (body.includes('下一轮将开新会话')) return RefreshCw
  if (/\/cd|绑定到|恢复托管工作区/.test(body)) return FolderInput
  if (body === '没有运行中的轮次' || body.includes(' /stop · ')) return Square
  return Info
}

export function EventRow({ m }: { m: MessageDto }) {
  const Icon = eventIcon(m.body)
  return (
    <div className="tl-event">
      <Icon size={12} />
      <span className="tl-event__text">{m.body}</span>
      <span className="tl-time">{fmtTime(m.createdAt)}</span>
    </div>
  )
}

/** `fanOut`: how many bots this message triggered; ≥ 2 shows the fan-out note (spec §8.6). */
export function UserMessage({ m, names, fanOut = 0 }: { m: MessageDto; names: string[]; fanOut?: number }) {
  return (
    <div className="tl-msg">
      <div className="tl-avatar">{Array.from(m.authorName)[0]}</div>
      <div className="tl-msg__main">
        <div className="tl-msg__head">
          <span className="tl-msg__who">{m.authorName}</span>
          <span className="tl-time">{fmtTime(m.createdAt)}</span>
          {fanOut > 1 ? <span className="tl-fan">· 扇出 · {fanOut} 个 bot 并行</span> : null}
        </div>
        <MessageQuote quote={m.quote} />
        <div className="tl-msg__text">
          {splitMentions(m.body, names).map((s, i) =>
            s.mention ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
              <span key={i} className="tl-mention">
                {s.text}
              </span>
            ) : (
              s.text
            ),
          )}
        </div>
        <MessageAttachments list={m.attachments} from={m.authorName} />
      </div>
    </div>
  )
}

/** First line of a quoted text, without markdown emphasis (prototype quote chip). */
const quoteLine = (text: string) => (text.split('\n')[0] ?? '').replace(/[`*]/g, '')

export function BotReply({ m }: { m: MessageDto }) {
  const open = useRunRail((s) => s.open)
  const runId = m.runId
  const files = useMemo(() => (runId ? filePaths(m.body) : []), [runId, m.body])
  const quote = useQuote((s) => s.set)
  return (
    <div className="tl-msg" data-testid="bot-reply">
      <div className="tl-avatar tl-avatar--bot">{Array.from(m.authorName)[0]}</div>
      <div className="tl-msg__main">
        <div className="tl-msg__head">
          <span className="tl-msg__who">{m.authorName}</span>
          <span className="tl-reply-tag">最终回复</span>
          <span className="tl-time">{fmtTime(m.createdAt)}</span>
          <button
            type="button"
            className="tl-quote-btn"
            title="引用回复等同 @ 该 bot"
            onClick={() =>
              quote({
                groupId: m.groupId,
                kind: 'message',
                id: m.id,
                who: m.authorName,
                text: quoteLine(m.body),
              })
            }
          >
            <Quote size={11} />
            引用回复
          </button>
        </div>
        <Markdown text={m.body} />
        <MessageAttachments list={m.attachments} from={m.authorName} />
        {runId && files.length ? (
          <div className="tl-files">
            {files.map((f) => (
              <button key={f} type="button" className="tl-file" onClick={() => open(runId, 'diff', f)}>
                <FileText size={11} />
                {f}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const STEP_ICON: Partial<Record<RunStatus, typeof CircleDot>> = {
  running: Loader,
  queued: Hourglass,
  offline_wait: Hourglass,
  awaiting_approval: ShieldAlert,
  awaiting_answer: MessageCircleQuestion,
}

/** Runs that never started show their reason as a note instead of a step, without actions (prototype r4 / r5). */
const NOTE_ICON: Partial<Record<RunStatus, typeof CircleDot>> = { forbidden: Ban, offline_wait: WifiOff }

export function RunCard({
  run,
  delta,
  botName,
  agent,
  trigger,
  foldable = false,
}: {
  run: RunDto
  delta?: string
  botName: string
  agent: string
  trigger: string
  /** My 运行卡片默认折叠 pref; cards awaiting my decision always stay open. */
  foldable?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const live = LIVE.includes(run.status)
  const now = useNow(live && !!run.startedAt)
  const selected = useRunRail((s) => s.runId === run.id)
  const openRail = useRunRail((s) => s.open)
  const quote = useQuote((s) => s.set)
  const status = RUN_STATUS[run.status]
  const streamed = run.status === 'running' ? delta?.trim().split('\n').at(-1) : undefined
  const NoteIcon = NOTE_ICON[run.status]
  const step = NoteIcon ? '' : streamed || run.step
  const StepIcon = STEP_ICON[run.status] ?? CircleDot
  const started = run.startedAt ? Date.parse(run.startedAt) : null
  const sessionNote = newSessionNote(run.newSessionReason)
  const canFold = foldable && !AWAITING.includes(run.status) && run.interrupt !== 'pending'
  const folded = canFold && !expanded
  return (
    <div
      className={cx('run-card', selected && 'run-card--selected')}
      data-testid="run-card"
      data-status={run.status}
    >
      <div className="run-card__head">
        <div className="run-card__init">{Array.from(botName)[0]}</div>
        <span className="run-card__bot">{botName}</span>
        <span className="run-card__sub">
          {agent} · {trigger} 触发
        </span>
        {run.hop > 1 ? (
          <span className="run-card__hop">
            <Link2 size={10} />
            接力 {run.hop}/{run.hopMax}
          </span>
        ) : null}
        <span className="spacer" />
        <Badge variant={status.variant}>{status.label}</Badge>
        {canFold ? (
          <button
            type="button"
            className="run-card__fold"
            aria-label={folded ? '展开' : '收起'}
            title={folded ? '展开' : '收起'}
            onClick={() => setExpanded(folded)}
          >
            {folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : null}
      </div>
      {folded ? null : (
        <>
          {step ? (
            <div className="run-card__step">
              <StepIcon size={12} className={run.status === 'running' ? 'run-card__spin' : undefined} />
              <span>{step}</span>
            </div>
          ) : null}
          {started !== null ? (
            <div className="run-card__meta">
              <span>改动 {run.filesChanged} 个文件</span>
              <span>·</span>
              <span>{fmtDuration((run.endedAt ? Date.parse(run.endedAt) : now) - started)}</span>
              <span>·</span>
              <span>{fmtUsage(run.usage)}</span>
            </div>
          ) : null}
          {sessionNote ? (
            <div className="run-card__session">
              <RefreshCw size={11} />
              {sessionNote}
            </div>
          ) : null}
          {/* Slice 2 (approvals) */}
          <ApprovalBlock run={run} />
          <QuestionBlock run={run} />
          {NoteIcon ? (
            <div className="run-card__note">
              <NoteIcon size={12} />
              {run.status === 'offline_wait' ? <OfflineNote run={run} /> : <span>{run.step}</span>}
            </div>
          ) : null}
          {/* Slice 4 (/stop leftovers) */}
          <InterruptBlock run={run} />
          {NoteIcon ? null : (
            <div className="run-card__actions">
              <button type="button" className="run-card__action" onClick={() => openRail(run.id)}>
                <PanelRightOpen size={12} />
                查看过程
              </button>
              <button
                type="button"
                className="run-card__action"
                onClick={() =>
                  quote({
                    groupId: run.groupId,
                    kind: 'run',
                    id: run.id,
                    who: `${botName} 的运行卡片`,
                    text: run.step || status.label,
                  })
                }
              >
                <Quote size={11} />
                引用
              </button>
              {/* Slice 4 (打断并追加 / stop) */}
              <RunActions run={run} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
