import {
  findUiBlocks,
  type MessageDto,
  parseMentions,
  type RunDto,
  type RunStatus,
  unplacedHtmlPages,
} from '@gonggong/protocol'
import { Fragment, memo, type ReactNode, useMemo, useState } from 'react'
import { useWorkbench } from '../../app/workbench'
import { useWorkspace } from '../../app/workspace'
import { cx } from '../../lib/cx'
import { useNow } from '../../lib/now'
import { dateLocale, pad } from '../../lib/time'
import {
  Avatar,
  Button,
  ChatNotice,
  Icon,
  type IconName,
  Mascot,
  Mention,
  Message,
  type MessageAuthor,
  splitMentions,
  Tag,
  type TagTone,
} from '../../ui'
import { usePresence } from '../../ui/presence'
import { MessageAttachments, MessageQuote } from '../attachments/MessageAttachments'
import { useQuote } from '../attachments/quote'
import { BotAvatar, useBotCostume } from '../bots/avatars'
import { CreationCardView } from '../plugins/CreationCard'
import { PreviewCard } from '../previews/PreviewCard'
import { ReactionBar } from '../reactions'
import { RichMessage } from '../rich/context'
import { HtmlRender } from '../rich/HtmlRender'
import { ApprovalBlock } from '../runs/ApprovalBlock'
import { InterruptBlock } from '../runs/InterruptBlock'
import { runMascot } from '../runs/mascot'
import { stepText, toolTitle } from '../runs/mcp'
import { QuestionBlock } from '../runs/QuestionBlock'
import { OfflineNote, RunActions } from '../runs/RunActions'
import { RunSyncLine } from '../sync/RunSyncLine'
import { BotCardTrigger, UserCardTrigger } from '../users'
import { openTab } from '../workbench/open'
import { Clamp } from './Clamp'
import { citeInChat } from './cite'
import { useRunDeltas } from './deltas'
import { isRich, replyFiles } from './grouping'
import { Markdown } from './Markdown'
import { type ActionTarget, MessageMenu } from './MessageActions'
import { MessageEditor } from './MessageEditor'
import { mentionInChat } from './mention'
import {
  ClockFact,
  DelegationFacts,
  FanOut,
  FilesFact,
  HopChain,
  OfflineGlyph,
  RunStatusIcon,
  STATUS_LABEL,
  TokenFact,
} from './RunGraphics'
import { reedit, useRecalled } from './recalled'
import './recall.css'
import { t } from '../../i18n'
import { Linkified } from '../../lib/links'
import { MessageCanvasChips, RunArtifactsLine } from '../artifacts/CanvasRefs'
import { messageCanvas, runArtifacts } from '../artifacts/runContext'
import { usePins } from './PinnedMessages'

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
  resume_failed: t('会话恢复失败，已开新会话并补送最近 50 条群消息'),
  requested: t('已按要求开启新会话'),
  schedule: t('定时任务在独立的新会话中运行'),
  config_changed: t('本轮因配置变更开启新会话'),
  provider_removed: t('原供应商已删除，已开启新会话'),
}
export const newSessionNote = (reason: string | null) =>
  reason === null ? null : reason in NEW_SESSION ? NEW_SESSION[reason] : reason

const LIVE: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']
const AWAITING: RunStatus[] = ['awaiting_approval', 'awaiting_answer']

export function fmtTime(iso: string) {
  const d = new Date(iso)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

const fullTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

function Time({
  iso,
  edited,
  pin,
  feishu,
}: {
  iso: string
  edited?: string | null
  pin?: Pick<MessageDto, 'id' | 'groupId'>
  /** Came in from the bound Feishu chat. */
  feishu?: boolean
}) {
  return (
    <>
      <time className="tl-time" dateTime={iso} title={fullTime(new Date(iso))}>
        {fmtTime(iso)}
      </time>
      {edited ? (
        <span className="tl-edited" title={fullTime(new Date(edited))}>
          {t('已编辑')}
        </span>
      ) : null}
      {feishu ? <span className="tl-edited">{t('来自飞书')}</span> : null}
      {pin ? <PinMark message={pin} /> : null}
    </>
  )
}

function PinMark({ message }: { message: Pick<MessageDto, 'id' | 'groupId'> }) {
  const pinned = usePins(message.groupId).some((p) => p.messageId === message.id)
  return pinned ? (
    <span className="tl-pinned" role="img" title={t('已置顶')} aria-label={t('已置顶')}>
      <Icon name="pin" size={11} />
    </span>
  ) : null
}

/** Day separator label: 今天 / 昨天 / M月D日. */
export function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return t('今天')
  today.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return t('昨天')
  return d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })
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
  if (!total) return t('用量未上报')
  if (total >= 999_950) return `${(total / 1e6).toFixed(1)}M tokens`
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k tokens` : `${total} tokens`
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
  if (/ 切换到 | 拉取了更新| 的改动：| 推送到 /.test(body)) return 'git-branch'
  return 'info'
}

export const eventText = (m: Pick<MessageDto, 'body' | 'i18n'>) => (m.i18n ? t.text(m.i18n) : m.body)

export const EventRow = memo(function EventRow({ m }: { m: MessageDto }) {
  const text = eventText(m)
  return (
    <ChatNotice>
      <span className="tl-event" title={text}>
        <Icon name={eventIcon(m.body)} size={13} />
        <span className="tl-event__text">{text}</span>
        <Time iso={m.createdAt} />
      </span>
    </ChatNotice>
  )
})

/**
 * Consecutive system events (join, repo bound, workspace ready…) folded into one quiet row that expands in place,
 * so setup noise never pushes the conversation off screen. Opens by itself when a deep link targets an event inside.
 */
export const EventFold = memo(function EventFold({
  events,
  flash,
}: {
  events: MessageDto[]
  flash: string | null
}) {
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
          <span className="tl-event__text">
            {t('{n} 条系统事件 · {last}', { n: events.length, last: eventText(last) })}
          </span>
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
})

/** A recalled message: the Pane recalled notice in place of the content; 重新编辑 while I still hold what I recalled. */
export const RecallRow = memo(function RecallRow({ m, mine }: { m: MessageDto; mine: boolean }) {
  const held = useRecalled((s) => mine && m.id in s.drafts)
  return (
    <ChatNotice
      kind="recalled"
      action={held ? { label: t('重新编辑'), onClick: () => reedit(m.id) } : undefined}
    >
      {mine ? t('你撤回了一条消息') : t('{name} 撤回了一条消息', { name: m.authorName })}
    </ChatNotice>
  )
})

/** First line of a quoted text, without markdown emphasis (prototype quote chip). */
const quoteLine = (text: string) => (text.split('\n')[0] ?? '').replace(/[`*]/g, '')

/** Quoting a bot also @s it in the composer; deleting the @ leaves a quote that triggers nobody (spec §8.6). */
const quoteMessage = (m: MessageDto) => {
  const bot = m.kind === 'bot' ? m.authorName : undefined
  useQuote.getState().set({
    groupId: m.groupId,
    kind: 'message',
    id: m.id,
    who: m.authorName,
    text: quoteLine(m.body),
    bot,
  })
  if (bot) mentionInChat(m.groupId, bot)
}

const link = (groupId: string, query: string) => `${location.origin}/g/${groupId}?${query}`

const BOT_QUOTE = t('引用并 @ Bot')

const messageTarget = (
  m: MessageDto,
  own = false,
  onEdit?: () => void,
  startedRuns?: (messageId: string) => string[],
): ActionTarget => ({
  message: m,
  own,
  onEdit,
  startedRuns: startedRuns && (() => startedRuns(m.id)),
  link: link(m.groupId, `msg=${m.id}`),
  quoteTitle: m.kind === 'bot' ? BOT_QUOTE : undefined,
  onQuote: () => quoteMessage(m),
  copyText: m.body,
})

/** Another member: avatar and name open their user card. */
function person(m: MessageDto, avatar?: string): MessageAuthor {
  // A Feishu sender without a 共工 account has no user card.
  if (!m.authorId) return { name: m.authorName, avatar }
  const id = m.authorId
  return {
    name: m.authorName,
    avatarNode: (
      <UserCardTrigger userId={id} groupId={m.groupId} tabIndex={-1} className="user-card-trigger--block">
        <Avatar name={m.authorName} src={avatar} size={32} />
      </UserCardTrigger>
    ),
    nameNode: (
      <UserCardTrigger userId={id} groupId={m.groupId}>
        <b>{m.authorName}</b>
      </UserCardTrigger>
    ),
  }
}

/** A bot: avatar and name open its bot card. */
const botAuthor = (name: string, botId: string | null, groupId: string): MessageAuthor => ({
  name,
  bot: true,
  avatarNode: botId ? (
    <BotCardTrigger botId={botId} groupId={groupId} tabIndex={-1} className="user-card-trigger--block">
      <BotAvatar id={botId} name={name} size={32} />
    </BotCardTrigger>
  ) : (
    <BotAvatar name={name} size={32} />
  ),
  nameNode: botId ? (
    <BotCardTrigger botId={botId} groupId={groupId}>
      <b>{name}</b>
    </BotCardTrigger>
  ) : undefined,
})

function Text({ body, names, me }: { body: string; names: string[]; me?: string }) {
  return (
    <p>
      {splitMentions(body, names).map((s, i) =>
        s.mention ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <Mention key={i} name={s.text.slice(1)} me={s.text.slice(1) === me} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <Fragment key={i}>
            <Linkified text={s.text} />
          </Fragment>
        ),
      )}
    </p>
  )
}

/**
 * Bots a member's message went to without naming them (the canvas hands a plain message to the artifact's bot): the
 * bubble says so. Not in a dm, where its single bot always gets the message.
 */
function useUnnamedTargets(m: MessageDto) {
  // A string, so replacing the workspace with equal content re-renders and re-parses nothing.
  const targets = useWorkspace((s) => {
    const group = s.groups.find((g) => g.id === m.groupId)
    if (!group || group.kind === 'dm') return ''
    return JSON.stringify(
      s.bots
        .filter((b) => m.mentions.includes(b.id) && group.botIds.includes(b.id))
        .map((b) => [b.id, b.name]),
    )
  })
  return useMemo(() => {
    if (!targets) return []
    const bots = (JSON.parse(targets) as [string, string][]).map(([id, name]) => ({ id, name }))
    if (!bots.length) return []
    const named = parseMentions(m.body, bots)
    return bots.filter((b) => !named.includes(b.id))
  }, [targets, m.body])
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
  startedRuns,
}: {
  m: MessageDto
  names: string[]
  /** My name: an @ of me is highlighted. */
  me?: string
  fanOut?: string[]
  mine?: boolean
  compact?: boolean
  /** Started runs by trigger message (stable, so rows stay memoized): 撤回 stops them. */
  startedRuns?: (messageId: string) => string[]
}) {
  // Unknown card kinds fall back to the body.
  const creation = m.card?.type === 'creation' ? m.card : null
  const text = !creation && !!(m.body || m.quote)
  const [editing, setEditing] = useState(false)
  const avatar = useWorkspace(
    (s) => s.groups.find((g) => g.id === m.groupId)?.members.find((x) => x.userId === m.authorId)?.avatar,
  )
  const unnamed = useUnnamedTargets(m)
  const canvas = messageCanvas(m)
  return (
    <MessageMenu
      {...messageTarget(m, mine, mine && !creation ? () => setEditing(true) : undefined, startedRuns)}
    >
      {(bar) => (
        <Message
          author={mine ? { name: m.authorName, avatar: avatar ?? undefined } : person(m, avatar ?? undefined)}
          self={mine}
          continued={compact}
          time={<Time iso={m.createdAt} edited={m.editedAt} pin={m} feishu={m.fromFeishu} />}
          meta={
            m.scheduledBy || unnamed.length ? (
              <>
                {m.scheduledBy ? (
                  <Tag tone="gray" icon="clock">
                    {t('定时任务')}
                  </Tag>
                ) : null}
                {unnamed.map((b) => (
                  <Tag key={b.id} tone="blue" icon="at">
                    {t('发给 @{name}', { name: b.name })}
                  </Tag>
                ))}
              </>
            ) : undefined
          }
          bare={!text}
          actionBar={bar}
          footer={
            text || fanOut.length > 1 || canvas ? (
              <>
                {text ? <MessageAttachments list={m.attachments} from={m.authorName} /> : null}
                {canvas ? <MessageCanvasChips canvas={canvas} /> : null}
                {fanOut.length > 1 ? <FanOut bots={fanOut} /> : null}
              </>
            ) : null
          }
        >
          {creation ? (
            <CreationCardView m={m} card={creation} />
          ) : text ? (
            <MessageQuote quote={m.quote} />
          ) : (
            <MessageAttachments list={m.attachments} from={m.authorName} />
          )}
          {creation ? null : editing ? (
            <MessageEditor message={m} onDone={() => setEditing(false)} />
          ) : m.body ? (
            <Text body={m.body} names={names} me={me} />
          ) : null}
          <ReactionBar message={m} />
        </Message>
      )}
    </MessageMenu>
  )
})

const FILE_CHIPS = 2

/** The first files a reply names, by base name; the rest are left to the run's full diff. */
function FileChips({ runId, text }: { runId: string; text: string }) {
  const open = (file: string | null) => openTab({ kind: 'run', runId, view: 'diff', file })
  const files = useMemo(() => replyFiles(text), [text])
  if (!files.length) return null
  const rest = files.length - FILE_CHIPS
  return (
    <div className="tl-files">
      {files.slice(0, FILE_CHIPS).map((f) => (
        <button key={f} type="button" className="tl-file" title={f} onClick={() => open(f)}>
          <Icon name="doc-text" size={12} />
          {f.split('/').at(-1)}
        </button>
      ))}
      {rest > 0 ? (
        <button
          type="button"
          className="tl-file"
          aria-label={t('还有 {n} 个文件，查看完整改动', { n: rest })}
          title={t('还有 {n} 个文件，查看完整改动', { n: rest })}
          onClick={() => open(null)}
        >
          +{rest}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Bots a reply only mentions (an @ in a reply relays nothing): a member hands one the work by @-ing it from the
 * composer. Hand-off messages carry their target in `mentions` and it is already running.
 */
function HandOffChips({ m }: { m: MessageDto }) {
  const botIds = useWorkspace((s) => s.groups.find((g) => g.id === m.groupId)?.botIds)
  const all = useWorkspace((s) => s.bots)
  const bots = useMemo(() => {
    const inGroup = all.filter(
      (b) => botIds?.includes(b.id) && b.id !== m.authorId && !m.mentions.includes(b.id),
    )
    return parseMentions(m.body, inGroup).flatMap((id) => inGroup.filter((b) => b.id === id))
  }, [all, botIds, m])
  if (!bots.length) return null
  return (
    <div className="tl-files">
      {bots.map((b) => (
        <button
          key={b.id}
          type="button"
          className="tl-handoff"
          onClick={() => citeInChat(m.groupId, `@${b.name}`)}
        >
          <Icon name="at" size={12} />
          {t('让 {name} 处理', { name: b.name })}
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
  meta,
  tags,
}: {
  m: MessageDto
  /** Continues the author's group: no second avatar and name. */
  continued?: boolean
  runId?: string | null
  bar: ReactNode
  meta?: ReactNode
  /** Facts of the run the reply finished, under the body. */
  tags?: ReactNode
}) {
  return (
    <div data-testid="bot-reply">
      <Message
        className={cx((isRich(m) || !!m.htmlRender || !!m.htmlRenders?.length) && 'tl-msg--wide')}
        bare={!!m.htmlRender}
        author={botAuthor(m.authorName, m.authorId, m.groupId)}
        continued={continued}
        time={<Time iso={m.createdAt} pin={m} />}
        meta={meta}
        actionBar={bar}
        footer={
          <>
            <MessageAttachments list={m.attachments} from={m.authorName} />
            {runId ? <FileChips runId={runId} text={m.body} /> : null}
            <HandOffChips m={m} />
            {tags}
          </>
        }
      >
        {m.htmlRender ? (
          <HtmlRender page={m.htmlRender} />
        ) : m.previewId ? (
          <PreviewCard
            previewId={m.previewId}
            groupId={m.groupId}
            botId={m.authorId ?? ''}
            fallback={m.body}
          />
        ) : (
          <ReplyBody m={m} />
        )}
        <ReactionBar message={m} />
      </Message>
    </div>
  )
}

/**
 * A bot reply's Markdown. One holding UI blocks (charts, buttons…) or html_render pages takes the full bubble width
 * and is never folded under 展开全文, so its components stay usable. Pages it does not place follow its text.
 */
function ReplyBody({ m }: { m: MessageDto }) {
  const rich = useMemo(() => findUiBlocks(m.body).length > 0, [m.body])
  const rest = useMemo(() => unplacedHtmlPages(m.body, m.htmlRenders ?? []), [m.body, m.htmlRenders])
  const body = (
    <RichMessage.Provider value={m}>
      {m.body.trim() ? <Markdown text={m.body} botId={m.authorId ?? undefined} /> : null}
      {rest.map((p) => (
        <HtmlRender key={p.attachmentId} page={p} />
      ))}
    </RichMessage.Provider>
  )
  if (m.htmlRenders?.length) return <div className="rich-reply rich-reply--pages">{body}</div>
  return rich ? <div className="rich-reply">{body}</div> : <Clamp>{body}</Clamp>
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
 * One run as a bare MessageCard whose header colour follows its status; once it has settled with a final reply, the
 * card gives way to the reply bubble at the reply's place, with the run's facts as tags under it.
 */
export const RunCard = memo(function RunCard({
  run,
  reply,
  botName,
  agent,
  trigger,
  foldable = false,
  branchable = false,
}: {
  run: RunDto
  reply?: MessageDto
  botName: string
  agent: string
  trigger: string
  /** My 运行卡片默认折叠 pref (the reply stays visible); cards awaiting my decision always stay open. */
  foldable?: boolean
  /** Offers 分支到新聊天 on the reply (see branchableRuns). */
  branchable?: boolean
}) {
  /** null until the user toggles, so the fold animation never plays on first render. */
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const live = LIVE.includes(run.status)
  const now = useNow(live && !!run.startedAt)
  const selected = useWorkbench(
    (s) => s.open && !!s.groupId && s.benches[s.groupId]?.active === `run:${run.id}`,
  )
  const quote = useQuote((s) => s.set)
  const streamed = useRunDeltas((s) =>
    run.status === 'running' ? s[run.id]?.trim().split('\n').at(-1) : undefined,
  )
  const note = NOTE.includes(run.status)
  const step = note || reply ? '' : streamed || toolTitle(stepText(run))
  const working = !note && !reply && run.status === 'running'
  const mascot = runMascot(run.status, !!streamed)
  const costume = useBotCostume(run.botId)
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
    onQuote: () => {
      if (reply) return quoteMessage(reply)
      quote({
        groupId: run.groupId,
        kind: 'run',
        id: run.id,
        who: t('{name} 的运行卡片', { name: botName }),
        text: toolTitle(stepText(run)) || STATUS_LABEL[run.status],
        bot: botName,
      })
      mentionInChat(run.groupId, botName)
    },
    copyText: reply?.body,
    branchable,
  }
  const diff = () => openTab({ kind: 'run', runId: run.id, view: 'diff', file: null })
  const process = (
    <Button
      size="small"
      variant="plain"
      icon="sidebar-right"
      onClick={() => openTab({ kind: 'run', runId: run.id, view: 'process', file: null })}
    >
      {t('查看过程')}
    </Button>
  )
  const made = runArtifacts(run)
  const continued = run.continuationOf ? <Tag tone="purple">{t('后台任务完成后继续')}</Tag> : null
  const sub = t('{agent} · {name} 触发', { agent, name: trigger })
  const meta = (
    <span className="run-card__sub" title={sub}>
      {sub}
    </span>
  )
  if (reply && !live && run.interrupt !== 'pending') {
    const tags = (
      <div className="run-card__meta run-card__tags">
        {run.status === 'completed' ? null : <Tag tone={TONE[run.status]}>{STATUS_LABEL[run.status]}</Tag>}
        {continued}
        {run.hop > 1 ? <HopChain hop={run.hop} max={run.hopMax} /> : null}
        <FilesFact n={run.filesChanged} onOpen={diff} />
        {started !== null ? <ClockFact ms={elapsed} text={fmtDuration(elapsed)} live={false} /> : null}
        <TokenFact total={usageTotal(run.usage)} label={fmtUsage(run.usage)} />
        <DelegationFacts d={run.delegation} />
        <RunSyncLine run={run} />
        {made.length ? <RunArtifactsLine artifacts={made} /> : null}
        {sessionNote ? (
          <span className="run-card__session">
            <Icon name="arrow-clockwise" size={12} />
            {sessionNote}
          </span>
        ) : null}
        {process}
      </div>
    )
    return (
      <MessageMenu {...target}>
        {(bar) => (
          <div className="run-card" data-testid="run-card" data-status={run.status}>
            <ReplyMessage m={reply} runId={run.id} bar={bar} meta={meta} tags={tags} />
          </div>
        )}
      </MessageMenu>
    )
  }
  return (
    <MessageMenu {...target}>
      {(bar) => (
        <div className="run-card" data-testid="run-card" data-status={run.status}>
          <Message
            className={cx(!reply && !!run.htmlRenders?.length && 'tl-msg--wide')}
            author={botAuthor(botName, run.botId, run.groupId)}
            time={<Time iso={reply?.createdAt ?? run.queuedAt} pin={reply ?? undefined} />}
            meta={meta}
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
                {continued}
                {run.hop > 1 ? <HopChain hop={run.hop} max={run.hopMax} /> : null}
                {canFold ? (
                  <button
                    type="button"
                    className="run-card__fold"
                    aria-label={folded ? t('展开') : t('收起')}
                    aria-expanded={!folded}
                    title={folded ? t('展开') : t('收起')}
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
                      {step || working ? (
                        <div className="run-card__step">
                          {mascot ? (
                            <Mascot
                              className="run-card__mascot"
                              action={mascot.action}
                              costume={costume}
                              size={32}
                            />
                          ) : (
                            <Icon name={STEP_ICON[run.status] ?? 'info'} size={13} />
                          )}
                          <span>{step || `${mascot?.label}…`}</span>
                        </div>
                      ) : null}
                      {started !== null ? (
                        <div className="run-card__meta">
                          <FilesFact n={run.filesChanged} onOpen={diff} />
                          <ClockFact ms={elapsed} text={fmtDuration(elapsed)} live={live} />
                          <TokenFact total={usageTotal(run.usage)} label={fmtUsage(run.usage)} />
                          <DelegationFacts d={run.delegation} />
                          <RunSyncLine run={run} />
                          {made.length ? <RunArtifactsLine artifacts={made} /> : null}
                        </div>
                      ) : null}
                      {sessionNote ? (
                        <div className="run-card__session">
                          <Icon name="arrow-clockwise" size={12} />
                          {sessionNote}
                        </div>
                      ) : null}
                      {reply
                        ? null
                        : run.htmlRenders?.map((p) => <HtmlRender key={p.attachmentId} page={p} />)}
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
                              <span>{stepText(run)}</span>
                            </>
                          )}
                        </div>
                      ) : null}
                      <InterruptBlock run={run} />
                      {note ? null : (
                        <div className="pn-mcard__actions run-card__actions">
                          {reply ? null : <RunActions run={run} />}
                          {process}
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
