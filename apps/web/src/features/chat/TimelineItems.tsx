import type { MessageDto, RunDto, RunStatus } from '@gonggong/protocol'
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react'
import { cx } from '../../lib/cx'
import {
  Avatar,
  ChatNotice,
  Icon,
  type IconName,
  Mention,
  Message,
  type MessageAuthor,
  ProgressIndicator,
  type TagTone,
} from '../../ui'
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
import { type ActionTarget, MessageMenu } from './MessageActions'
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

const TONE: Record<RunStatus, TagTone> = {
  queued: 'gray',
  offline_wait: 'gray',
  forbidden: 'red',
  running: 'blue',
  awaiting_approval: 'orange',
  awaiting_answer: 'orange',
  completed: 'green',
  interrupted: 'red',
  expired: 'gray',
}

/** Status label + tag tone (the run rail shows it as a Tag; the card header takes the same colour). */
export const RUN_STATUS = Object.fromEntries(
  Object.entries(TONE).map(([k, tone]) => [k, { label: STATUS_LABEL[k as RunStatus], tone }]),
) as Record<RunStatus, { label: string; tone: TagTone }>

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
  const h = Math.floor(s / 3600)
  const mmss = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return h ? `${h}:${mmss}` : mmss
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

function eventIcon(body: string): IconName {
  if (body.includes('创建了私聊')) return 'person-add'
  if (body.includes('创建了群')) return 'person-2'
  if (body.startsWith('群绑定仓库') || body.startsWith('群更换仓库')) return 'git-branch'
  if (body.startsWith('未绑定仓库')) return 'folder'
  if (body.includes('移出')) return 'person'
  if (body.includes(' 加入') || /已 clone 到托管工作区|工作区创建失败/.test(body)) return 'bot'
  if (body.includes('下一轮将开新会话')) return 'arrow-clockwise'
  if (/\/cd|绑定到|绑定工作区|托管工作区|默认工作区/.test(body)) return 'folder-open'
  if (body === '没有运行中的轮次' || body.includes(' /stop · ')) return 'stop'
  return 'info'
}

export const EventRow = memo(function EventRow({ m }: { m: MessageDto }) {
  return (
    <ChatNotice>
      <span className="tl-event" title={m.body}>
        <Icon name={eventIcon(m.body)} size={13} />
        <span className="tl-event__text">{m.body}</span>
        <Time iso={m.createdAt} />
      </span>
    </ChatNotice>
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
      <ChatNotice>
        <button
          type="button"
          className="tl-event tl-fold__head"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="list" size={13} />
          <span className="tl-event__text">{`${events.length} 条系统事件 · ${last.body}`}</span>
          <Time iso={last.createdAt} />
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
      </ChatNotice>
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

/** A recalled message: the Pane recalled notice in place of the content (no 重新编辑: the body is gone). */
export const RecallRow = memo(function RecallRow({ m, mine }: { m: MessageDto; mine: boolean }) {
  return (
    <ChatNotice kind="recalled">{mine ? '你撤回了一条消息' : `${m.authorName} 撤回了一条消息`}</ChatNotice>
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

const messageTarget = (m: MessageDto, own = false): ActionTarget => ({
  message: m,
  own,
  link: link(m.groupId, `msg=${m.id}`),
  quoteTitle: m.kind === 'bot' ? BOT_QUOTE : undefined,
  onQuote: () => quoteMessage(m),
  copyText: m.body,
})

/** Another member: avatar and name open their user card. */
function person(m: MessageDto): MessageAuthor {
  const id = m.authorId ?? ''
  return {
    name: m.authorName,
    avatarNode: (
      <UserCardTrigger userId={id} groupId={m.groupId} tabIndex={-1} className="user-card-trigger--block">
        <Avatar name={m.authorName} size={32} />
      </UserCardTrigger>
    ),
    nameNode: (
      <UserCardTrigger userId={id} groupId={m.groupId}>
        <b>{m.authorName}</b>
      </UserCardTrigger>
    ),
  }
}

const botAuthor = (name: string): MessageAuthor => ({ name, bot: true })

function Text({ body, names, me }: { body: string; names: string[]; me?: string }) {
  return (
    <p>
      {splitMentions(body, names).map((s, i) =>
        s.mention ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <Mention key={i} name={s.text.slice(1)} me={s.text.slice(1) === me} />
        ) : (
          s.text
        ),
      )}
    </p>
  )
}

/**
 * A member's message: text in a bubble (mine on the right), attachments as bare cards; `compact` rows continue the
 * author's group (C1). `fanOut`: names of the bots it triggered; two or more draw the fan-out (spec §8.6).
 */
export const UserMessage = memo(function UserMessage({
  m,
  names,
  me,
  fanOut = [],
  mine = false,
  compact = false,
}: {
  m: MessageDto
  names: string[]
  /** My name: an @ of me is highlighted. */
  me?: string
  fanOut?: string[]
  mine?: boolean
  compact?: boolean
}) {
  const text = !!(m.body || m.quote)
  return (
    <MessageMenu {...messageTarget(m, mine)}>
      {(bar) => (
        <Message
          author={mine ? { name: m.authorName } : person(m)}
          self={mine}
          continued={compact}
          time={<Time iso={m.createdAt} />}
          bare={!text}
          actionBar={bar}
          footer={
            text || fanOut.length > 1 ? (
              <>
                {text ? <MessageAttachments list={m.attachments} from={m.authorName} /> : null}
                {fanOut.length > 1 ? <FanOut bots={fanOut} /> : null}
              </>
            ) : null
          }
        >
          {text ? (
            <MessageQuote quote={m.quote} />
          ) : (
            <MessageAttachments list={m.attachments} from={m.authorName} />
          )}
          {m.body ? <Text body={m.body} names={names} me={me} /> : null}
          <ReactionBar message={m} />
        </Message>
      )}
    </MessageMenu>
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
          <Icon name="doc-text" size={12} />
          {f}
        </button>
      ))}
    </div>
  )
}

/** A bot's text reply as a bubble (Markdown inside); attachments and changed files follow as bare content. */
function ReplyMessage({
  m,
  continued,
  runId,
  bar,
}: {
  m: MessageDto
  /** Continues the author's group, or sits right under its run card: no second avatar and name. */
  continued?: boolean
  runId?: string | null
  bar: ReactNode
}) {
  return (
    <div data-testid="bot-reply">
      <Message
        className={cx(isRich(m) && 'tl-msg--wide')}
        author={botAuthor(m.authorName)}
        continued={continued}
        time={<Time iso={m.createdAt} />}
        actionBar={bar}
        footer={
          <>
            <MessageAttachments list={m.attachments} from={m.authorName} />
            {runId ? <FileChips runId={runId} text={m.body} /> : null}
          </>
        }
      >
        <Clamp>
          <Markdown text={m.body} />
        </Clamp>
        <ReactionBar message={m} />
      </Message>
    </div>
  )
}

/** A bot message outside a loaded run card (relay notes, or a reply whose run is not in the page). */
export const BotReply = memo(function BotReply({ m, compact = false }: { m: MessageDto; compact?: boolean }) {
  return (
    <MessageMenu {...messageTarget(m)}>
      {(bar) => <ReplyMessage m={m} continued={compact} runId={m.runId} bar={bar} />}
    </MessageMenu>
  )
})

const STEP_ICON: Partial<Record<RunStatus, IconName>> = {
  queued: 'clock',
  offline_wait: 'clock',
  awaiting_approval: 'shield-warning',
  awaiting_answer: 'bubble-question',
}

/** Runs that never started show their reason as a note instead of a step, without actions (prototype r4 / r5). */
const NOTE: RunStatus[] = ['forbidden', 'offline_wait']

/**
 * One run as a bare MessageCard whose header colour follows its status; once the final reply exists it follows the
 * card as a bubble and both sit at the reply's place.
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
  const started = run.startedAt ? Date.parse(run.startedAt) : null
  const elapsed = started === null ? 0 : (run.endedAt ? Date.parse(run.endedAt) : now) - started
  const sessionNote = newSessionNote(run.newSessionReason)
  const canFold = foldable && !AWAITING.includes(run.status) && run.interrupt !== 'pending'
  const folded = canFold && !expanded
  const body = usePresence(!folded, { timeout: 700 })
  const target: ActionTarget = {
    message: reply ?? null,
    link: link(run.groupId, reply ? `msg=${reply.id}` : `run=${run.id}`),
    quoteTitle: BOT_QUOTE,
    onQuote: () =>
      reply
        ? quoteMessage(reply)
        : quote({
            groupId: run.groupId,
            kind: 'run',
            id: run.id,
            who: `${botName} 的运行卡片`,
            text: run.step || STATUS_LABEL[run.status],
          }),
    copyText: reply?.body,
    onProcess: note ? undefined : () => openRail(run.id),
  }
  return (
    <MessageMenu {...target}>
      {(bar) => (
        <div className="run-card" data-testid="run-card" data-status={run.status}>
          <Message
            author={botAuthor(botName)}
            time={<Time iso={reply?.createdAt ?? run.queuedAt} />}
            meta={<span className="run-card__sub">{`${agent} · ${trigger} 触发`}</span>}
            bare
            actions={false}
            actionBar={reply ? undefined : bar}
          >
            <div
              className={cx(
                'pn-card pn-mcard run-mcard',
                `pn-mcard--${TONE[run.status]}`,
                selected && 'run-mcard--selected',
              )}
            >
              <div className="pn-mcard__head">
                <RunStatusIcon status={run.status} spelled />
                <span className="pn-mcard__title" />
                {run.hop > 1 ? <HopChain hop={run.hop} max={run.hopMax} /> : null}
                {canFold ? (
                  <button
                    type="button"
                    className="run-card__fold"
                    aria-label={folded ? '展开' : '收起'}
                    aria-expanded={!folded}
                    title={folded ? '展开' : '收起'}
                    onClick={() => setExpanded(folded)}
                  >
                    <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={14} />
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
                    <div className="pn-mcard__body">
                      {step ? (
                        <div className="run-card__step">
                          {run.status === 'running' ? (
                            <ProgressIndicator variant="spinner" aria-label="运行中" />
                          ) : (
                            <Icon name={STEP_ICON[run.status] ?? 'info'} size={13} />
                          )}
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
                          <Icon name="arrow-clockwise" size={12} />
                          {sessionNote}
                        </div>
                      ) : null}
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
                              <Icon name="octagon-xmark" size={13} />
                              <span>{run.step}</span>
                            </>
                          )}
                        </div>
                      ) : null}
                      <InterruptBlock run={run} />
                      {note || reply ? null : (
                        <div className="pn-mcard__actions run-card__actions">
                          <RunActions run={run} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </Message>
          {reply ? <ReplyMessage m={reply} continued runId={run.id} bar={bar} /> : null}
        </div>
      )}
    </MessageMenu>
  )
})
