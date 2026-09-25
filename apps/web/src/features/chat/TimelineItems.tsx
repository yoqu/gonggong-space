import type { MessageDto, RunDto, RunStatus } from '@gonggong/protocol'
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
  Layers,
  Loader,
  MessageCircleQuestion,
  RefreshCw,
  ShieldAlert,
  Square,
  Undo2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react'
import { cx } from '../../lib/cx'
import type { BadgeVariant } from '../../ui'
import { usePresence } from '../../ui/presence'
import { MessageAttachments, MessageQuote } from '../attachments/MessageAttachments'
import { useQuote } from '../attachments/quote'
import { ReactionBar } from '../reactions'
import { ApprovalBlock } from '../runs/ApprovalBlock'
import { InterruptBlock } from '../runs/InterruptBlock'
import { filePaths } from '../runs/paths'
import { QuestionBlock } from '../runs/QuestionBlock'
import { OfflineNote, RunActions } from '../runs/RunActions'
import { useRunRail } from '../runs/rail'
import { UserCardTrigger } from '../users'
import { Clamp } from './Clamp'
import { isRich } from './grouping'
import { Markdown } from './Markdown'
import { MessageActions } from './MessageActions'
import {
  ClockFact,
  FanOut,
  FilesFact,
  HopChain,
  OfflineGlyph,
  RunStatusIcon,
  STATUS_LABEL,
  TokenFact,
} from './RunGraphics'
import './recall.css'

const VARIANT: Record<RunStatus, BadgeVariant> = {
  queued: 'secondary',
  offline_wait: 'outline',
  forbidden: 'outline',
  running: 'info',
  awaiting_approval: 'warning',
  awaiting_answer: 'warning',
  completed: 'success',
  interrupted: 'destructive',
  expired: 'outline',
}

/** Status label + badge variant (the run rail still shows badges). */
export const RUN_STATUS = Object.fromEntries(
  Object.entries(VARIANT).map(([k, variant]) => [k, { label: STATUS_LABEL[k as RunStatus], variant }]),
) as Record<RunStatus, { label: string; variant: BadgeVariant }>

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

const fullTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

function Time({ iso }: { iso: string }) {
  return (
    <time className="tl-time" dateTime={iso} title={fullTime(new Date(iso))}>
      {fmtTime(iso)}
    </time>
  )
}

/** Day separator label: 今天 / 昨天 / M月D日. */
export function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return '今天'
  today.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

const usageTotal = (u: RunDto['usage']) => u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)

export function fmtUsage(u: RunDto['usage']) {
  const total = usageTotal(u)
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
  if (/\/cd|绑定到|绑定工作区|托管工作区|默认工作区/.test(body)) return FolderInput
  if (body === '没有运行中的轮次' || body.includes(' /stop · ')) return Square
  return Info
}

export const EventRow = memo(function EventRow({ m }: { m: MessageDto }) {
  const Icon = eventIcon(m.body)
  return (
    <div className="tl-event" title={m.body}>
      <Icon size={13} className="tl-event__icon" />
      <span className="tl-event__text">{m.body}</span>
      <Time iso={m.createdAt} />
    </div>
  )
})

/**
 * Consecutive system events (join, repo bound, workspace ready…) folded into one quiet row that expands in place,
 * so setup noise never pushes the conversation off screen. Opens by itself when a deep link targets an event inside.
 */
export function EventFold({ events, flash }: { events: MessageDto[]; flash: string | null }) {
  const holdsFlash = !!flash && events.some((e) => e.id === flash)
  const [open, setOpen] = useState(holdsFlash)
  if (holdsFlash && !open) setOpen(true)
  const last = events.at(-1) as MessageDto
  return (
    <div className="tl-fold" data-open={open || undefined}>
      <button
        type="button"
        className="tl-event tl-fold__head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Layers size={13} className="tl-event__icon" />
        <span className="tl-event__text">{`${events.length} 条系统事件 · ${last.body}`}</span>
        <Time iso={last.createdAt} />
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open ? (
        <div className="tl-fold__list">
          {events.map((e) => (
            <div key={e.id} data-msg-id={e.id} className={cx('tl-item', flash === e.id && 'tl-item--flash')}>
              <EventRow m={e} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A recalled message: a centered notice in place of the content (Feishu). */
export const RecallRow = memo(function RecallRow({ m, mine }: { m: MessageDto; mine: boolean }) {
  return (
    <div className="tl-event tl-event--recall">
      <Undo2 size={13} className="tl-event__icon" />
      <span className="tl-event__text">{mine ? '你' : `${m.authorName} `}撤回了一条消息</span>
      <Time iso={m.createdAt} />
    </div>
  )
})

/** First line of a quoted text, without markdown emphasis (prototype quote chip). */
const quoteLine = (text: string) => (text.split('\n')[0] ?? '').replace(/[`*]/g, '')

const quoteMessage = (m: MessageDto) =>
  useQuote.getState().set({
    groupId: m.groupId,
    kind: 'message',
    id: m.id,
    who: m.authorName,
    text: quoteLine(m.body),
  })

const link = (groupId: string, query: string) => `${location.origin}/g/${groupId}?${query}`

/** Quoting a bot = @ that bot (spec §8.6). */
const BOT_QUOTE = '引用回复等同 @ 该 Bot'

function MessageBar({ m, own = false }: { m: MessageDto; own?: boolean }) {
  return (
    <MessageActions
      message={m}
      own={own}
      link={link(m.groupId, `msg=${m.id}`)}
      quoteTitle={m.kind === 'bot' ? BOT_QUOTE : undefined}
      onQuote={() => quoteMessage(m)}
      copyText={m.body}
    />
  )
}

/** One author row: avatar + name on the first message of a group; `compact` rows continue the group (C1). */
function Row({
  m,
  mine = false,
  compact = false,
  avatar,
  children,
  testId,
}: {
  m: MessageDto
  mine?: boolean
  compact?: boolean
  avatar: ReactNode
  children: ReactNode
  testId?: string
}) {
  const person = m.kind === 'user' && !mine ? m.authorId : null
  const who = <span className="tl-msg__who">{m.authorName}</span>
  return (
    <div className={cx('tl-msg', mine && 'tl-msg--mine', compact && 'tl-msg--compact')} data-testid={testId}>
      {mine ? null : compact ? (
        <Time iso={m.createdAt} />
      ) : person ? (
        <UserCardTrigger
          userId={person}
          groupId={m.groupId}
          tabIndex={-1}
          className="user-card-trigger--block"
        >
          {avatar}
        </UserCardTrigger>
      ) : (
        avatar
      )}
      <div className="tl-msg__main">
        {compact ? null : (
          <div className="tl-msg__head">
            {mine ? null : person ? (
              <UserCardTrigger userId={person} groupId={m.groupId}>
                {who}
              </UserCardTrigger>
            ) : (
              who
            )}
            <Time iso={m.createdAt} />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/** `fanOut`: names of the bots this message triggered; two or more draw the fan-out (spec §8.6). */
export const UserMessage = memo(function UserMessage({
  m,
  names,
  fanOut = [],
  mine = false,
  compact = false,
}: {
  m: MessageDto
  names: string[]
  fanOut?: string[]
  mine?: boolean
  compact?: boolean
}) {
  return (
    <Row
      m={m}
      mine={mine}
      compact={compact}
      avatar={<div className="tl-avatar">{Array.from(m.authorName)[0]}</div>}
    >
      <div className="tl-bubble-host">
        {m.body || m.quote ? (
          <div className="tl-bubble">
            <MessageQuote quote={m.quote} />
            {m.body ? (
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
            ) : null}
          </div>
        ) : null}
        <MessageAttachments list={m.attachments} from={m.authorName} />
        <ReactionBar message={m} />
        <MessageBar m={m} own={mine} />
      </div>
      {fanOut.length > 1 ? <FanOut bots={fanOut} /> : null}
    </Row>
  )
})

function FileChips({ runId, text }: { runId: string; text: string }) {
  const open = useRunRail((s) => s.open)
  const files = useMemo(() => filePaths(text), [text])
  if (!files.length) return null
  return (
    <div className="tl-files">
      {files.map((f) => (
        <button key={f} type="button" className="tl-file" onClick={() => open(runId, 'diff', f)}>
          <FileText size={11} />
          {f}
        </button>
      ))}
    </div>
  )
}

/** A bot message outside a loaded run card (relay notes, or a reply whose run is not in the page). */
export const BotReply = memo(function BotReply({ m, compact = false }: { m: MessageDto; compact?: boolean }) {
  return (
    <Row
      m={m}
      compact={compact}
      testId="bot-reply"
      avatar={<div className="tl-avatar tl-avatar--bot">{Array.from(m.authorName)[0]}</div>}
    >
      <div className="tl-bubble-host">
        <div className={cx('tl-bubble', isRich(m) && 'tl-bubble--wide')}>
          <Clamp>
            <Markdown text={m.body} />
          </Clamp>
        </div>
        <MessageAttachments list={m.attachments} from={m.authorName} />
        {m.runId ? <FileChips runId={m.runId} text={m.body} /> : null}
        <ReactionBar message={m} />
        <MessageBar m={m} />
      </div>
    </Row>
  )
})

const STEP_ICON: Partial<Record<RunStatus, typeof CircleDot>> = {
  running: Loader,
  queued: Hourglass,
  offline_wait: Hourglass,
  awaiting_approval: ShieldAlert,
  awaiting_answer: MessageCircleQuestion,
}

/** Runs that never started show their reason as a note instead of a step, without actions (prototype r4 / r5). */
const NOTE: RunStatus[] = ['forbidden', 'offline_wait']

/**
 * One run; once its final reply exists the card also carries the reply and sits at the reply's place.
 * Plain-text replies read as a bubble; code, tables, files and attachments keep the wide card (C2).
 */
export const RunCard = memo(function RunCard({
  run,
  delta,
  reply,
  botName,
  agent,
  trigger,
  foldable = false,
}: {
  run: RunDto
  delta?: string
  reply?: MessageDto
  botName: string
  agent: string
  trigger: string
  /** My 运行卡片默认折叠 pref (the reply stays visible); cards awaiting my decision always stay open. */
  foldable?: boolean
}) {
  /** null until the user toggles, so the fold animation never plays on first render. */
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const live = LIVE.includes(run.status)
  const now = useNow(live && !!run.startedAt)
  const selected = useRunRail((s) => s.runId === run.id)
  const openRail = useRunRail((s) => s.open)
  const quote = useQuote((s) => s.set)
  const streamed = run.status === 'running' ? delta?.trim().split('\n').at(-1) : undefined
  const note = NOTE.includes(run.status)
  const step = note || reply ? '' : streamed || run.step
  const StepIcon = STEP_ICON[run.status] ?? CircleDot
  const started = run.startedAt ? Date.parse(run.startedAt) : null
  const elapsed = started === null ? 0 : (run.endedAt ? Date.parse(run.endedAt) : now) - started
  const sessionNote = newSessionNote(run.newSessionReason)
  const canFold = foldable && !AWAITING.includes(run.status) && run.interrupt !== 'pending'
  const folded = canFold && !expanded
  const body = usePresence(!folded, { timeout: 700 })
  const bar = (
    <MessageActions
      message={reply ?? null}
      link={link(run.groupId, reply ? `msg=${reply.id}` : `run=${run.id}`)}
      quoteTitle={BOT_QUOTE}
      onQuote={() =>
        reply
          ? quoteMessage(reply)
          : quote({
              groupId: run.groupId,
              kind: 'run',
              id: run.id,
              who: `${botName} 的运行卡片`,
              text: run.step || STATUS_LABEL[run.status],
            })
      }
      copyText={reply?.body}
      onProcess={note ? undefined : () => openRail(run.id)}
    />
  )
  return (
    <div
      className={cx(
        'run-card',
        reply && !isRich(reply) && 'run-card--bubble',
        selected && 'run-card--selected',
      )}
      data-testid="run-card"
      data-status={run.status}
    >
      <div className="run-card__head">
        <div className="run-card__init" data-agent={agent}>
          {Array.from(botName)[0]}
        </div>
        <span className="run-card__bot">{botName}</span>
        <span className="run-card__sub">
          {agent} · {trigger} 触发
        </span>
        {reply ? <Time iso={reply.createdAt} /> : null}
        {run.hop > 1 ? <HopChain hop={run.hop} max={run.hopMax} /> : null}
        <span className="spacer" />
        <RunStatusIcon status={run.status} />
        {canFold ? (
          <button
            type="button"
            className="run-card__fold"
            aria-label={folded ? '展开' : '收起'}
            aria-expanded={!folded}
            title={folded ? '展开' : '收起'}
            onClick={() => setExpanded(folded)}
          >
            {folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : null}
      </div>
      {body.mounted ? (
        <div
          className="run-card__body"
          data-state={expanded === null ? undefined : body.state}
          inert={folded}
          onAnimationEnd={body.onAnimationEnd}
        >
          <div>
            {step ? (
              <div className="run-card__step">
                <StepIcon size={12} className={run.status === 'running' ? 'run-card__spin' : undefined} />
                <span>{step}</span>
              </div>
            ) : null}
            {started !== null ? (
              <div className="run-card__meta">
                <FilesFact n={run.filesChanged} />
                <ClockFact ms={elapsed} text={fmtDuration(elapsed)} live={live} />
                <TokenFact total={usageTotal(run.usage)} label={fmtUsage(run.usage)} />
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
            {note ? (
              <div className="run-card__note">
                {run.status === 'offline_wait' ? (
                  <>
                    <OfflineGlyph />
                    <OfflineNote run={run} />
                  </>
                ) : (
                  <>
                    <Ban size={12} />
                    <span>{run.step}</span>
                  </>
                )}
              </div>
            ) : null}
            {/* Slice 4 (/stop leftovers) */}
            <InterruptBlock run={run} />
            {note || reply ? null : (
              <div className="run-card__actions">
                <RunActions run={run} />
              </div>
            )}
          </div>
        </div>
      ) : null}
      {reply ? (
        <div className="run-card__reply" data-testid="bot-reply">
          <Clamp>
            <Markdown text={reply.body} />
          </Clamp>
          <MessageAttachments list={reply.attachments} from={reply.authorName} />
          <FileChips runId={run.id} text={reply.body} />
          <ReactionBar message={reply} />
          {bar}
        </div>
      ) : (
        bar
      )}
    </div>
  )
})
