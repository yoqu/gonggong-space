import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icon'
import { CloseButton, type IconLike, renderIcon } from './primitives'
import './notice.css'

export function ChatNotice({
  kind = 'system',
  day,
  children,
}: {
  kind?: 'date' | 'system' | 'unread' | 'urgent'
  /** Bold day label for `date`:「今天」「昨天」. */
  day?: string
  children?: ReactNode
}) {
  if (kind === 'unread')
    return (
      // biome-ignore lint/a11y/useSemanticElements: a labelled divider; <hr> cannot hold text
      <div className="pn-notice pn-notice--unread" role="separator">
        {children ?? '以下为新消息'}
      </div>
    )
  if (kind === 'urgent')
    return (
      <div className="pn-notice pn-notice--urgent">
        <span>
          <Icon name="bolt" />
          {children}
        </span>
      </div>
    )
  if (kind === 'date')
    return (
      // biome-ignore lint/a11y/useSemanticElements: a labelled divider; <hr> cannot hold text
      <div className="pn-notice pn-notice--date" role="separator">
        <span>
          {day && <b>{day}</b>}
          {children}
        </span>
      </div>
    )
  return (
    <div className="pn-notice pn-notice--system">
      <span>{children}</span>
    </div>
  )
}

export interface PinnedBannerProps {
  text: ReactNode
  /** Defaults to「群公告」. */
  title?: ReactNode
  icon?: IconLike
  color?: string
  action?: ReactNode
  onClose?: () => void
  className?: string
  style?: CSSProperties
}

export function PinnedBanner({
  text,
  title = '群公告',
  icon = 'megaphone',
  color,
  action,
  onClose,
  className,
  style,
}: PinnedBannerProps) {
  return (
    <div className={cx('pn-pinned', className)} style={style} role="note">
      <span className="pn-pinned__icon" style={color ? { color } : undefined}>
        {renderIcon(icon)}
      </span>
      <span className="pn-pinned__title">{title}</span>
      <span className="pn-pinned__text">{text}</span>
      {action}
      {onClose && <CloseButton label="关闭" onClick={onClose} />}
    </div>
  )
}
