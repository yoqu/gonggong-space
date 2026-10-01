import { type CSSProperties, type ReactNode, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { dateLocale, pad } from '../../lib/time'
import { Avatar, type AvatarProps, Badge, Tag } from '../display'
import { Icon } from '../icon'
import { Mascot } from '../mascot'
import { keyNav } from './keynav'
import type { TagSpec } from './types'
import './conversation.css'

export interface Conversation {
  id: string
  name: string
  avatar?: string
  avatarNode?: ReactNode
  /** Groups and bots get the rounded-square avatar. */
  group?: boolean
  status?: AvatarProps['status']
  tags?: TagSpec[]
  time?: string
  preview?: ReactNode
  unread?: number
  /** Muted rows may show a grey dot instead of a count. */
  unreadDot?: boolean
  muted?: boolean
  pinned?: boolean
  mention?: boolean
  urgent?: boolean
  draft?: string
  /** An agent is at work here: 共字君 runs in a tag beside the name. */
  live?: boolean
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** List time (Pane IM): today「10:42」, yesterday「昨天」, within a week「星期二」, earlier「9月20日」. */
export function listTime(iso: string, now = new Date()) {
  const d = new Date(iso)
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000)
  if (days <= 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (days === 1) return t('昨天')
  if (days < 7) return d.toLocaleDateString(dateLocale, { weekday: 'long' })
  const year = d.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  return d.toLocaleDateString(dateLocale, { year, month: 'short', day: 'numeric' })
}

const flagOf = (it: Conversation) =>
  it.urgent ? t('[加急] ') : it.mention ? t('[有人@我] ') : it.draft ? t('[草稿] ') : null

/** Avatar and the two text lines of a row; ConversationItem wraps it in a button, routed lists in a link with class `pn-conv`. */
export function ConversationContent({ item: it }: { item: Conversation }) {
  const flag = flagOf(it)
  return (
    <>
      <span className="pn-conv__avatar" aria-hidden="true">
        {it.avatarNode ?? (
          <Avatar
            name={it.name}
            src={it.avatar}
            size={40}
            status={it.status}
            shape={it.group ? 'square' : 'circle'}
          />
        )}
      </span>
      <span className="pn-conv__body">
        <span className="pn-conv__line">
          <span className="pn-conv__name">{it.name}</span>
          {it.tags?.map((t) => (
            <Tag key={t.label} tone={t.tone}>
              {t.label}
            </Tag>
          ))}
          {it.live && (
            <Tag tone="blue" className="pn-conv__live">
              <Mascot action="run" size={22} />
              {t('运行中')}
            </Tag>
          )}
          <span className="pn-conv__time">
            {it.pinned && <Icon name="pin" label={t('已置顶')} />}
            {it.time}
          </span>
        </span>
        <span className="pn-conv__line">
          <span className="pn-conv__preview">
            {flag && <span className="pn-conv__flag">{flag}</span>}
            {it.draft || it.preview}
          </span>
          {it.muted && <Icon name="bell-slash" className="pn-conv__muted" label={t('免打扰')} />}
          {it.unread ? (
            it.muted && it.unreadDot ? (
              <span className="pn-conv__dot" role="img" aria-label={t('有未读')} />
            ) : (
              <Badge count={it.unread} muted={it.muted} />
            )
          ) : null}
        </span>
      </span>
    </>
  )
}

export function ConversationItem({
  item,
  selected,
  onClick,
  tabIndex,
}: {
  item: Conversation
  selected?: boolean
  onClick?: () => void
  /** Roving tab stop inside ConversationList. */
  tabIndex?: number
}) {
  return (
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: Pane rows are buttons in a role="list" with one roving tab stop
    // biome-ignore lint/a11y/useSemanticElements: same reason
    <button
      type="button"
      role="listitem"
      className="pn-conv"
      aria-current={selected ? 'true' : undefined}
      tabIndex={tabIndex}
      onClick={onClick}
    >
      <ConversationContent item={item} />
    </button>
  )
}

export interface ConversationListProps {
  items: Conversation[]
  selected?: string
  defaultSelected?: string
  onSelect?: (id: string) => void
  /** Search field / filter segmented control above the rows. */
  header?: ReactNode
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export function ConversationList({
  items,
  selected,
  defaultSelected,
  onSelect,
  header,
  className,
  style,
  'aria-label': label = t('会话#list'),
}: ConversationListProps) {
  const [own, setOwn] = useState(defaultSelected)
  const current = selected ?? own
  const ref = useRef<HTMLDivElement>(null)
  const anySelected = items.some((it) => it.id === current)
  return (
    <div className={cx('pn-convlist', className)} style={style}>
      {header && <div className="pn-convlist__header">{header}</div>}
      {/* biome-ignore lint/a11y/useSemanticElements: rows are buttons, which <ul> cannot hold directly */}
      <div
        ref={ref}
        className="pn-convlist__items"
        role="list"
        aria-label={label}
        onKeyDown={(e) => keyNav(e, ref.current, '.pn-conv', { select: true })}
      >
        {items.map((it, i) => (
          <ConversationItem
            key={it.id}
            item={it}
            selected={current === it.id}
            tabIndex={current === it.id || (!anySelected && i === 0) ? 0 : -1}
            onClick={() => {
              setOwn(it.id)
              onSelect?.(it.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}
