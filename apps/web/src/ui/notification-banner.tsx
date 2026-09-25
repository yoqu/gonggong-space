import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { Avatar, type AvatarProps } from './display'
import { Icon } from './icon'
import './notification-banner.css'

export interface NotificationBannerProps {
  /** Usually the sender. */
  title: ReactNode
  /** At most two lines; 「你收到一条新消息」 when previews are hidden. */
  body: ReactNode
  /** E.g. the group it was sent in. */
  subtitle?: ReactNode
  time?: string
  app?: { name: string; icon?: ReactNode }
  avatar?: AvatarProps
  /** At most two, e.g. 「回复」「标为已读」. */
  actions?: { label: string; onClick?: () => void }[]
  /** Further notifications folded under this one. */
  stacked?: number
  onClose?: () => void
  className?: string
  style?: CSSProperties
}

const AppIcon = () => (
  <span className="ui-notif__appicon">
    <Icon name="bubble" weight={1.8} />
  </span>
)

/** Pane NotificationBanner: macOS-style 18px glass notification card; the close button shows on hover or focus. */
export function NotificationBanner({
  title,
  body,
  subtitle,
  time = '现在',
  app = { name: '消息' },
  avatar,
  actions,
  stacked,
  onClose,
  className,
  style,
}: NotificationBannerProps) {
  const appIcon = app.icon ?? <AppIcon />
  return (
    <div
      className={cx('ui-notif', !!stacked && 'ui-notif--stacked', className)}
      style={style}
      role="alert"
      aria-label={`${app.name}：${typeof title === 'string' ? title : ''}`}
    >
      {stacked ? <span className="ui-notif__layer" aria-hidden="true" /> : null}
      <div className="ui-notif__card">
        {onClose ? (
          <button type="button" className="ui-notif__close" aria-label="关闭通知" onClick={onClose}>
            <Icon name="xmark" size={8} weight={2.2} />
          </button>
        ) : null}
        <div className="ui-notif__main">
          <span className="ui-notif__lead">
            {avatar ? (
              <>
                <Avatar size={38} {...avatar} />
                <span className="ui-notif__badge">{appIcon}</span>
              </>
            ) : (
              appIcon
            )}
          </span>
          <div className="ui-notif__text">
            <div className="ui-notif__top">
              <span className="ui-notif__title">{title}</span>
              <span className="ui-notif__time">{time}</span>
            </div>
            {subtitle ? <div className="ui-notif__subtitle">{subtitle}</div> : null}
            <div className="ui-notif__body">{body}</div>
            {stacked ? <div className="ui-notif__more">{`另外 ${stacked} 条通知`}</div> : null}
          </div>
        </div>
        {actions?.length ? (
          <div className="ui-notif__actions">
            {actions.map((a) => (
              <button key={a.label} type="button" className="ui-notif__action" onClick={a.onClick}>
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
