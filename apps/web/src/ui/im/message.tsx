import { Children, type CSSProperties, type ReactNode, useEffect, useRef } from 'react'
import { cx } from '../../lib/cx'
import type { Glyph } from '../controls'
import { Avatar, AvatarGroup, type AvatarProps, ProgressIndicator, Tag } from '../display'
import { Icon } from '../icon'
import { EmojiPicker } from './pickers'
import { ImPopover } from './popover'
import type { TagSpec } from './types'
import './message.css'

export function Mention({ name, me }: { name: string; me?: boolean }) {
  return <span className={cx('pn-mention', me && 'pn-mention--me')}>@{name}</span>
}

export interface Reaction {
  emoji: string
  users: string[]
  mine?: boolean
  label?: string
}

const who = (users: string[]) =>
  users.slice(0, 3).join('，') + (users.length > 3 ? ` 等 ${users.length} 人` : '')

export function Reactions({
  items,
  onToggle,
  onAdd,
  addable,
  defaultPickerOpen,
  compact,
}: {
  items: Reaction[]
  onToggle?: (emoji: string) => void
  /** A bare「+」button; the caller shows its own picker. */
  onAdd?: () => void
  /** 「+」opens the built-in EmojiPicker; a pick calls `onToggle`. */
  addable?: boolean
  defaultPickerOpen?: boolean
  /** Show counts instead of names. */
  compact?: boolean
}) {
  const add = (
    <button type="button" className="pn-reaction pn-reaction--add" aria-label="添加表情回复" onClick={onAdd}>
      <Icon name="smile" />
    </button>
  )
  return (
    <div className="pn-reactions">
      {items.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={cx('pn-reaction', r.mine && 'pn-reaction--mine')}
          aria-pressed={!!r.mine}
          aria-label={`${r.label ?? r.emoji}：${who(r.users)}`}
          onClick={() => onToggle?.(r.emoji)}
        >
          <span className="pn-reaction__emoji" aria-hidden>
            {r.emoji}
          </span>
          <span>{compact ? r.users.length : who(r.users)}</span>
        </button>
      ))}
      {addable ? (
        <ImPopover
          trigger={add}
          placement="top-start"
          defaultOpen={defaultPickerOpen}
          className="pn-reaction__picker"
          aria-label="添加表情回复"
        >
          {(close) => (
            <EmojiPicker
              onSelect={(e) => {
                onToggle?.(e)
                close()
              }}
            />
          )}
        </ImPopover>
      ) : (
        onAdd && add
      )}
    </div>
  )
}

/** Shape carries the state (hollow / pie / check), not colour alone. */
export function ReadReceipt({ read, total = 1 }: { read: number; total?: number }) {
  const state = read <= 0 ? 'none' : read >= total ? 'all' : 'partial'
  const label =
    state === 'all'
      ? total > 1
        ? '全部已读'
        : '已读'
      : total > 1
        ? `${total - Math.max(read, 0)} 人未读`
        : '未读'
  return (
    <span
      className={`pn-receipt pn-receipt--${state}`}
      role="img"
      aria-label={label}
      title={label}
      style={
        state === 'partial'
          ? ({ '--pn-read': `${Math.round((read / total) * 360)}deg` } as CSSProperties)
          : undefined
      }
    >
      {state === 'all' && <Icon name="check" weight={2.6} />}
    </span>
  )
}

export interface ThreadSummaryProps {
  count: number
  people?: AvatarProps[]
  lastTime?: string
  onClick?: () => void
}

export function ThreadSummary({ count, people = [], lastTime, onClick }: ThreadSummaryProps) {
  return (
    <button type="button" className="pn-thread" onClick={onClick}>
      <AvatarGroup people={people} size={20} max={3} />
      <span className="pn-thread__count">{count} 条回复</span>
      {lastTime && <span className="pn-thread__last">最后回复 {lastTime}</span>}
    </button>
  )
}

export interface MessageAction {
  icon: Glyph
  label: string
  onClick?: () => void
}

const DEFAULT_ACTIONS: MessageAction[] = [
  { icon: 'smile', label: '表情回复' },
  { icon: 'reply', label: '回复' },
  { icon: 'thread', label: '回复话题' },
  { icon: 'forward', label: '转发' },
  { icon: 'more', label: '更多' },
]

/** Glass hover bar; `children` append custom controls such as a menu trigger. */
export function MessageActions({
  items = DEFAULT_ACTIONS,
  onAction,
  children,
}: {
  items?: MessageAction[]
  onAction?: (label: string) => void
  children?: ReactNode
}) {
  return (
    <div className="pn-msgactions" role="toolbar" aria-label="消息操作">
      {items.map((a) => (
        <button
          key={a.label}
          type="button"
          aria-label={a.label}
          title={a.label}
          onClick={() => (a.onClick ? a.onClick() : onAction?.(a.label))}
        >
          {typeof a.icon === 'string' ? (
            <Icon name={a.icon} weight={a.icon === 'more' ? 2.6 : 1.5} />
          ) : (
            a.icon
          )}
        </button>
      ))}
      {children}
    </div>
  )
}

export interface MessageAuthor {
  name: string
  avatar?: string
  /** Replaces the default avatar (e.g. wrapped in a user-card trigger). */
  avatarNode?: ReactNode
  /** Replaces the bold name in the meta line. */
  nameNode?: ReactNode
  status?: AvatarProps['status']
  tags?: TagSpec[]
  /** Bots get a rounded-square avatar and the blue「Bot」tag. */
  bot?: boolean
}

export interface MessageProps {
  author: MessageAuthor
  time?: ReactNode
  /** Own message: right-aligned, bubble-out. */
  self?: boolean
  /** Same author as the previous row: no avatar or meta line. */
  continued?: boolean
  /** Cards, files and images: no bubble. */
  bare?: boolean
  /** A string becomes a paragraph; any node (markdown, cards) renders as is. */
  children?: ReactNode
  reply?: { author: string; text: ReactNode }
  reactions?: Reaction[]
  onReact?: (emoji: string) => void
  onAddReaction?: () => void
  thread?: ThreadSummaryProps
  receipt?: { read: number; total?: number }
  status?: 'sending' | 'sent' | 'failed'
  onRetry?: () => void
  urgent?: boolean
  edited?: boolean
  /** Hover bar items; `false` disables the bar. */
  actions?: MessageAction[] | false
  onAction?: (label: string) => void
  /** Extra controls appended to the hover bar. */
  actionsExtra?: ReactNode
  /** A ready-made hover bar replacing the default one (`actions` is then ignored). */
  actionBar?: ReactNode
  showActions?: boolean
  showAvatar?: boolean
  /** Extra inline content in the name/time line. */
  meta?: ReactNode
  /** Content below the bubble row (after the thread summary). */
  footer?: ReactNode
  className?: string
  style?: CSSProperties
}

function sideStatus({ status, receipt, onRetry }: Pick<MessageProps, 'status' | 'receipt' | 'onRetry'>) {
  if (status === 'sending') return <ProgressIndicator variant="spinner" aria-label="正在发送" />
  if (status === 'failed')
    return (
      <button
        type="button"
        className="pn-msg__retry"
        aria-label="发送失败，重新发送"
        title="发送失败，点按重新发送"
        onClick={onRetry}
      >
        !
      </button>
    )
  return receipt ? <ReadReceipt {...receipt} /> : null
}

export function Message({
  author,
  time,
  self,
  continued,
  bare,
  children,
  reply,
  reactions,
  onReact,
  onAddReaction,
  thread,
  receipt,
  status,
  onRetry,
  urgent,
  edited,
  actions,
  onAction,
  actionsExtra,
  actionBar,
  showActions,
  showAvatar = true,
  meta,
  footer,
  className,
  style,
}: MessageProps) {
  const head = !continued
  const content = typeof children === 'string' ? <p>{children}</p> : children
  const quote = reply && (
    <div className="pn-quote">
      <b>回复 {reply.author}：</b>
      {reply.text}
    </div>
  )
  const reacts = reactions && reactions.length > 0 && (
    <Reactions items={reactions} onToggle={onReact} onAdd={onAddReaction} />
  )
  const side = self && sideStatus({ status, receipt, onRetry })
  return (
    <div
      className={cx(
        'pn-msg',
        self && 'pn-msg--self',
        continued && 'pn-msg--cont',
        showActions && 'pn-msg--show-actions',
        className,
      )}
      style={style}
    >
      {head && showAvatar ? (
        (author.avatarNode ?? (
          <Avatar
            name={author.name}
            src={author.avatar}
            status={author.status}
            size={32}
            shape={author.bot ? 'square' : 'circle'}
          />
        ))
      ) : (
        <span className="pn-msg__gutter" />
      )}
      <div className="pn-msg__col">
        {head && (
          <div className="pn-msg__meta">
            {!self && (author.nameNode ?? <b>{author.name}</b>)}
            {author.bot && <Tag tone="blue">Bot</Tag>}
            {author.tags?.map((t) => (
              <Tag key={t.label} tone={t.tone}>
                {t.label}
              </Tag>
            ))}
            {urgent && (
              <Tag tone="solid-red" icon="bolt">
                加急
              </Tag>
            )}
            {time && <span className="pn-msg__time">{time}</span>}
            {meta}
          </div>
        )}
        <div className="pn-msg__row">
          {bare ? (
            <div className="pn-msg__bare">
              {quote}
              {content}
              {reacts}
            </div>
          ) : (
            <div className={cx('pn-bubble', urgent && 'pn-bubble--urgent')}>
              {quote}
              {content}
              {edited && <span className="pn-msg__edited">（已编辑）</span>}
              {reacts}
            </div>
          )}
          {side && <span className="pn-msg__side">{side}</span>}
        </div>
        {thread && <ThreadSummary {...thread} />}
        {footer}
        {actionBar ? (
          <div className="pn-msg__actions">{actionBar}</div>
        ) : (
          actions !== false && (
            <div className="pn-msg__actions">
              <MessageActions items={actions} onAction={onAction}>
                {actionsExtra}
              </MessageActions>
            </div>
          )
        )}
      </div>
    </div>
  )
}

function scrollerOf(el: HTMLElement | null) {
  for (let sc = el?.parentElement; sc && sc !== document.body; sc = sc.parentElement)
    if (sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY)) return sc
  return null
}

export function MessageList({
  children,
  stickToBottom,
  className,
  style,
  'aria-label': label = '消息',
}: {
  children?: ReactNode
  /** On mount and whenever the message count changes, scroll the nearest scroller to the bottom. */
  stickToBottom?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const count = Children.count(children)
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the message count, not identity
  useEffect(() => {
    if (!stickToBottom) return
    const sc = scrollerOf(ref.current)
    if (sc) sc.scrollTop = sc.scrollHeight
  }, [count, stickToBottom])
  return (
    <div ref={ref} className={cx('pn-msglist', className)} style={style} role="log" aria-label={label}>
      {children}
    </div>
  )
}
