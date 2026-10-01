import type { CSSProperties, ReactNode } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { type Glyph, renderGlyph } from '../controls'
import { Icon } from '../icon'
import './notice.css'

/** 24px round xmark used inside capsules (banner, reply quote). */
export function SmallClose({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="pn-pinned__close" aria-label={label} title={label} onClick={onClick}>
      <Icon name="xmark" weight={2.2} />
    </button>
  )
}

export function ChatNotice({
  kind = 'system',
  day,
  action,
  children,
}: {
  kind?: 'date' | 'system' | 'unread' | 'urgent' | 'recalled'
  /** Bold day label for `date`:「今天」「昨天」. */
  day?: string
  /** `recalled` only, e.g.「重新编辑」within two minutes of the own recall. */
  action?: { label: string; onClick?: () => void }
  children?: ReactNode
}) {
  if (kind === 'recalled')
    return (
      <div className="pn-notice pn-notice--system">
        <span>
          {children ?? t('你撤回了一条消息')}
          {action && (
            <button type="button" className="pn-notice__action" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </span>
      </div>
    )
  if (kind === 'unread')
    return (
      // biome-ignore lint/a11y/useSemanticElements: a labelled divider; <hr> cannot hold text
      <div className="pn-notice pn-notice--unread" role="separator">
        {children ?? t('以下为新消息')}
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
  /** Defaults to「群公告」; `null` shows none. */
  title?: ReactNode
  icon?: Glyph
  color?: string
  action?: ReactNode
  onClose?: () => void
  /** Accessible name of the close button; defaults to「关闭」. */
  closeLabel?: string
  className?: string
  style?: CSSProperties
}

export function PinnedBanner({
  text,
  title = t('群公告'),
  icon = 'megaphone',
  color,
  action,
  onClose,
  closeLabel = t('关闭#close'),
  className,
  style,
}: PinnedBannerProps) {
  return (
    <div className={cx('pn-pinned', className)} style={style} role="note">
      <span className="pn-pinned__icon" style={color ? { color } : undefined}>
        {renderGlyph(icon)}
      </span>
      {title != null && <span className="pn-pinned__title">{title}</span>}
      <span className="pn-pinned__text">{text}</span>
      {action}
      {onClose && <SmallClose label={closeLabel} onClick={onClose} />}
    </div>
  )
}
