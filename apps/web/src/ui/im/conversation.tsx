import { type CSSProperties, type ReactNode, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { dateLocale, pad } from '../../lib/time'
import { Avatar, type AvatarProps, Badge, Tag, type TagTone } from '../display'
import { Icon, type IconName } from '../icon'
import { Mascot, type MascotAction, type MascotCostume } from '../mascot'
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
  /** The count badge; group rows pass their @ count, DMs their unread (plan 未读与通知). */
  unread?: number
  /** Something unread: the name and preview stand out without a number. */
  bold?: boolean
  /** Muted rows may show a grey dot instead of a count. */
  unreadDot?: boolean
  muted?: boolean
  pinned?: boolean
  mention?: boolean
  urgent?: boolean
  draft?: string
  /** Agents at work here: a tag beside the name with their figures, most urgent first; only that one moves. */
  activity?: ConversationActivity
  /** Something waits on the viewer: it leads the preview, e.g.「[待审批] codex：rm -rf build」. */
  alert?: { flag: string; text: string }
  /** 标记: a flag beside the name. */
  flagged?: boolean
  /** A mark before the name, e.g. a channel's public / private glyph. */
  kind?: { icon: IconName; label: string }
}

export interface ConversationActivity {
  tone: TagTone
  label: string
  /** The full state, e.g.「待审批 · 2 个运行中」; defaults to `label`. */
  title?: string
  /** A bot's costume, or 共字君 itself without one. */
  actors: { key: string; action: MascotAction; costume?: MascotCostume }[]
  /** Runs beyond the figures shown. */
  more?: number
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
  it.urgent
    ? t('[加急] ')
    : it.alert
      ? it.alert.flag
      : it.mention
        ? t('[有人@我] ')
        : it.draft
          ? t('[草稿] ')
          : null

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
          {it.kind && <Icon name={it.kind.icon} size={12} label={it.kind.label} className="pn-conv__kind" />}
          <span className={cx('pn-conv__name', it.bold && 'pn-conv__name--bold')}>{it.name}</span>
          {it.flagged && <Icon name="flag" size={12} label={t('已标记')} className="pn-conv__flagged" />}
          {it.tags?.map((t) => (
            <Tag key={t.label} tone={t.tone}>
              {t.label}
            </Tag>
          ))}
          {it.activity && <ActivityTag activity={it.activity} />}
          <span className="pn-conv__time">
            {it.pinned && <Icon name="pin" label={t('已置顶')} />}
            {it.time}
          </span>
        </span>
        <span className="pn-conv__line">
          <span className={cx('pn-conv__preview', it.bold && 'pn-conv__preview--bold')}>
            {flag && <span className="pn-conv__flag">{flag}</span>}
            {it.alert ? it.alert.text : it.draft || it.preview}
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

function ActivityTag({ activity: a }: { activity: ConversationActivity }) {
  return (
    <Tag tone={a.tone} className="pn-conv__live">
      <span className="pn-conv__actors">
        {a.actors.map((x, i) => (
          <Mascot key={x.key} action={x.action} costume={x.costume} size={22} still={i > 0} />
        ))}
      </span>
      {a.more ? <span className="pn-conv__more">+{a.more}</span> : null}
      <span className="pn-conv__live-label" title={a.title ?? a.label}>
        {a.label}
      </span>
    </Tag>
  )
}

/**
 * A compact sidebar shortcut (话题, 全部未读, 稍后处理): icon and label on one line, a count only when something
 * waits on the viewer, otherwise a bold label and a dot. `detail` is kept for screen readers and the tooltip.
 */
export function ShortcutContent({
  icon,
  label,
  detail,
  count,
  bold,
}: {
  icon: IconName
  label: string
  detail: string
  count?: number
  bold?: boolean
}) {
  return (
    <>
      <Icon name={icon} size={14} className="pn-shortcut__icon" />
      <span className={cx('pn-shortcut__label', bold && 'pn-shortcut__label--bold')}>{label}</span>
      <span className="pn-shortcut__detail">{detail}</span>
      {count ? (
        <Badge count={count} />
      ) : bold ? (
        <span className="pn-shortcut__dot" aria-hidden="true" />
      ) : null}
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
