import { type CSSProperties, type ReactNode, useState } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icon'
import { Avatar, Badge, type Presence, type TagSpec, Tags } from './primitives'
import './conversation.css'

export interface Conversation {
  id: string
  name: string
  avatar?: string
  avatarNode?: ReactNode
  /** Groups and bots get the rounded-square avatar. */
  group?: boolean
  status?: Presence
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
}

const flagOf = (it: Conversation) =>
  it.urgent ? '[加急] ' : it.mention ? '[有人@我] ' : it.draft ? '[草稿] ' : null

export function ConversationItem({
  item: it,
  selected,
  onClick,
}: {
  item: Conversation
  selected?: boolean
  onClick?: () => void
}) {
  const flag = flagOf(it)
  return (
    <button type="button" className="pn-conv" aria-current={selected ? 'true' : undefined} onClick={onClick}>
      {it.avatarNode ?? (
        <Avatar
          name={it.name}
          src={it.avatar}
          size={40}
          status={it.status}
          shape={it.group ? 'square' : 'circle'}
        />
      )}
      <span className="pn-conv__body">
        <span className="pn-conv__line">
          <span className="pn-conv__name">{it.name}</span>
          <Tags items={it.tags} />
          <span className="pn-conv__time">
            {it.pinned && <Icon name="pin" label="已置顶" />}
            {it.time}
          </span>
        </span>
        <span className="pn-conv__line">
          <span className="pn-conv__preview">
            {flag && <span className="pn-conv__flag">{flag}</span>}
            {it.draft || it.preview}
          </span>
          {it.muted && <Icon name="bell-slash" className="pn-conv__muted" label="免打扰" />}
          {it.unread ? (
            it.muted && it.unreadDot ? (
              <span className="pn-conv__dot" role="img" aria-label="有未读" />
            ) : (
              <Badge count={it.unread} muted={it.muted} />
            )
          ) : null}
        </span>
      </span>
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
  'aria-label': label = '会话',
}: ConversationListProps) {
  const [own, setOwn] = useState(defaultSelected)
  const current = selected ?? own
  return (
    <div className={cx('pn-convlist', className)} style={style}>
      {header && <div className="pn-convlist__header">{header}</div>}
      <nav className="pn-convlist__items" aria-label={label}>
        {items.map((it) => (
          <ConversationItem
            key={it.id}
            item={it}
            selected={current === it.id}
            onClick={() => {
              setOwn(it.id)
              onSelect?.(it.id)
            }}
          />
        ))}
      </nav>
    </div>
  )
}
