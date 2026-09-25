import { Children, type CSSProperties, Fragment, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Button, type ButtonVariant, Checkbox, type Glyph, renderGlyph } from '../controls'
import { Avatar, type AvatarProps, Tag } from '../display'
import { Icon } from '../icon'
import { Composer, type ComposerProps, DEFAULT_TOOLS } from './composer'
import type { TagSpec } from './types'
import './panels.css'

function PanelHead({
  children,
  onClose,
  closeLabel,
  onBack,
}: {
  children: ReactNode
  onClose?: () => void
  closeLabel: string
  onBack?: () => void
}) {
  return (
    <div className="pn-info__head">
      {onBack && (
        <button type="button" className="pn-info__close" aria-label="返回" title="返回" onClick={onBack}>
          <Icon name="chevron-left" weight={2} />
        </button>
      )}
      {children}
      {onClose && (
        <button type="button" className="pn-info__close" aria-label={closeLabel} onClick={onClose}>
          <Icon name="xmark" weight={2} />
        </button>
      )}
    </div>
  )
}

export interface ChatInfoRow {
  label: ReactNode
  description?: ReactNode
  value?: ReactNode
  /** Clickable rows show a chevron. */
  onClick?: () => void
  /** Right-side control such as a Switch; takes effect immediately. */
  control?: ReactNode
  /** A clickable row the viewer may not use: greyed, with a lock instead of the chevron. */
  disabled?: boolean
}

/** A titled group of rows, e.g.「群管理」with a note such as「你是群管理员」. */
export interface ChatInfoGroup {
  title?: ReactNode
  note?: ReactNode
  rows: ChatInfoRow[]
}

export interface ChatInfoDanger {
  label: string
  onClick?: () => void
  /** Shown under the row, e.g. what confirming will do. */
  note?: ReactNode
}

function InfoRow({ label, description, value, onClick, control, disabled }: ChatInfoRow) {
  const inner = (
    <>
      <span className="pn-info__rowtext">
        <span>{label}</span>
        {description && <span className="pn-info__rowdesc">{description}</span>}
      </span>
      <span className="pn-info__trail">
        {control}
        {value != null && <span className="pn-info__value">{value}</span>}
        {onClick && <Icon name={disabled ? 'lock' : 'chevron-right'} weight={1.8} />}
      </span>
    </>
  )
  return onClick ? (
    <button type="button" className="pn-info__row pn-info__row--button" disabled={disabled} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="pn-info__row">{inner}</div>
  )
}

export interface ChatInfoPanelProps {
  /** Header title, default「群设置」. */
  title?: string
  onClose?: () => void
  name: ReactNode
  /** `false` for a direct chat: round avatar. */
  group?: boolean
  avatar?: ReactNode
  description?: ReactNode
  tags?: TagSpec[]
  /** One row of four. */
  shortcuts?: { icon: Glyph; label: string; onClick?: () => void }[]
  members?: AvatarProps[]
  memberCount?: number
  maxMembers?: number
  onAddMember?: () => void
  onShowAllMembers?: () => void
  /** One group of rows, or several titled groups. */
  settings?: ChatInfoRow[] | ChatInfoGroup[]
  /** Red centred rows in their own group, e.g.「退出群」. */
  danger?: ChatInfoDanger | ChatInfoDanger[]
  /** Inserted between members and settings. */
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

const isGroups = (s: ChatInfoRow[] | ChatInfoGroup[]): s is ChatInfoGroup[] => !!s[0] && 'rows' in s[0]

function RowGroup({ rows }: { rows: ChatInfoRow[] }) {
  return (
    <div className="pn-info__group">
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and labels may be nodes
        <InfoRow key={i} {...r} />
      ))}
    </div>
  )
}

/**
 * Inspector shell shared by the info panels: 52px head (back, title, close) over a scrolling body. `label` names the
 * landmark when the visible title changes between sub-views.
 */
export function InspectorPanel({
  title,
  label,
  onBack,
  onClose,
  children,
  className,
  style,
}: {
  title: ReactNode
  label?: string
  onBack?: () => void
  onClose?: () => void
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <aside
      className={cx('pn-info', className)}
      style={style}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
    >
      <PanelHead onClose={onClose} onBack={onBack} closeLabel="关闭">
        <h2 className="pn-info__title">{title}</h2>
      </PanelHead>
      <div className="pn-info__scroll">{children}</div>
    </aside>
  )
}

/** Group info inspector (300px): identity, shortcuts, members, settings, then the destructive action. */
export function ChatInfoPanel({ title = '群设置', onClose, className, style, ...body }: ChatInfoPanelProps) {
  return (
    <InspectorPanel title={title} onClose={onClose} className={className} style={style}>
      <ChatInfoBody {...body} />
    </InspectorPanel>
  )
}

/** The ChatInfoPanel content alone, for an inspector that also hosts sub-views under the same head. */
export function ChatInfoBody({
  name,
  group = true,
  avatar,
  description,
  tags,
  shortcuts,
  members = [],
  memberCount,
  maxMembers = 9,
  onAddMember,
  onShowAllMembers,
  settings,
  danger,
  children,
}: Omit<ChatInfoPanelProps, 'title' | 'onClose' | 'className' | 'style'>) {
  const dangers = danger ? (Array.isArray(danger) ? danger : [danger]) : []
  return (
    <>
      <div className="pn-info__id">
        {avatar ?? (
          <Avatar name={typeof name === 'string' ? name : ''} size={56} shape={group ? 'square' : 'circle'} />
        )}
        <div className="pn-info__name">
          {name}
          {tags?.map((t) => (
            <Tag key={t.label} tone={t.tone}>
              {t.label}
            </Tag>
          ))}
        </div>
        {description && <div className="pn-info__desc">{description}</div>}
      </div>
      {shortcuts && shortcuts.length > 0 && (
        <div className="pn-info__shortcuts">
          {shortcuts.map((s) => (
            <button key={s.label} type="button" className="pn-info__shortcut" onClick={s.onClick}>
              <span className="pn-info__shortcut-icon">{renderGlyph(s.icon)}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
      {members.length > 0 && (
        <section className="pn-info__section" aria-label="群成员">
          <div className="pn-info__section-head">
            <span>
              群成员 <span className="pn-info__count">{memberCount ?? members.length}</span>
            </span>
            {onShowAllMembers && (
              <button type="button" className="pn-info__link" onClick={onShowAllMembers}>
                查看全部
              </button>
            )}
          </div>
          <div className="pn-info__members">
            {onAddMember && (
              <button type="button" className="pn-info__member" onClick={onAddMember}>
                <span className="pn-info__add" aria-hidden="true">
                  <Icon name="plus" weight={1.8} />
                </span>
                <span>添加</span>
              </button>
            )}
            {members.slice(0, maxMembers).map((m) => (
              <div key={m.name} className="pn-info__member">
                <Avatar size={36} {...m} />
                <span aria-hidden="true">{m.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {children}
      {settings && settings.length > 0 ? (
        isGroups(settings) ? (
          settings.map((g, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: groups are positional
            <section key={i} className="pn-info__section">
              {g.title || g.note ? (
                <div className="pn-info__section-head">
                  <span>{g.title}</span>
                  {g.note ? <span className="pn-info__count">{g.note}</span> : null}
                </div>
              ) : null}
              <RowGroup rows={g.rows} />
            </section>
          ))
        ) : (
          <RowGroup rows={settings} />
        )
      ) : null}
      {dangers.length > 0 && (
        <div className="pn-info__group pn-info__group--danger">
          {dangers.map((d) => (
            <div key={d.label} className="pn-info__danger">
              <button
                type="button"
                className="pn-info__row pn-info__row--button pn-info__row--danger"
                onClick={d.onClick}
              >
                {d.label}
              </button>
              {d.note ? <div className="pn-info__danger-note">{d.note}</div> : null}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export interface ThreadPanelProps {
  /** Header title, default「话题」. */
  title?: string
  /** The conversation the thread lives in. */
  subtitle?: ReactNode
  onClose?: () => void
  /** The original message, usually a `Message` with `actions={false}`. */
  root: ReactNode
  replyCount?: number
  /** Replies: `Message`s without `thread`. */
  children?: ReactNode
  /** `false` hides the thread composer. */
  composer?: false
  composerProps?: ComposerProps
  /** Shows「同时发送到群」beside the send button. */
  alsoSend?: boolean
  alsoSendDefault?: boolean
  onAlsoSendChange?: (checked: boolean) => void
  className?: string
  style?: CSSProperties
}

/** Thread inspector (360px): root message, reply count divider, replies, and a thread composer. */
export function ThreadPanel({
  title = '话题',
  subtitle,
  onClose,
  root,
  replyCount,
  children,
  composer,
  composerProps,
  alsoSend = true,
  alsoSendDefault = false,
  onAlsoSendChange,
  className,
  style,
}: ThreadPanelProps) {
  const replies = Children.toArray(children)
  return (
    <aside className={cx('pn-threadpanel', className)} style={style} aria-label={title}>
      <PanelHead onClose={onClose} closeLabel="关闭话题">
        <div className="pn-threadpanel__titles">
          <span>{title}</span>
          {subtitle && <span className="pn-threadpanel__sub">{subtitle}</span>}
        </div>
      </PanelHead>
      <div className="pn-threadpanel__scroll">
        <div className="pn-threadpanel__root">{root}</div>
        {/* biome-ignore lint/a11y/useSemanticElements: a labelled divider; <hr> cannot hold text */}
        <div className="pn-threadpanel__count" role="separator">
          {replyCount ?? replies.length} 条回复
        </div>
        <div className="pn-threadpanel__replies">{replies}</div>
      </div>
      {composer !== false && (
        <div className="pn-threadpanel__composer">
          <Composer
            placeholder="回复话题"
            hint={false}
            tools={DEFAULT_TOOLS.slice(0, 4)}
            accessory={
              alsoSend ? (
                <Checkbox label="同时发送到群" defaultChecked={alsoSendDefault} onChange={onAlsoSendChange} />
              ) : null
            }
            {...composerProps}
          />
        </div>
      )}
    </aside>
  )
}

export interface ProfileCardProps {
  name: string
  avatar?: string
  /** `offline` greys the status dot and shows no avatar badge. */
  status?: AvatarProps['status'] | 'offline'
  /** e.g.「会议中 · 至 11:00」. */
  statusText?: ReactNode
  title?: ReactNode
  tags?: TagSpec[]
  fields?: { label: ReactNode; value: ReactNode }[]
  /** The first is primary unless a variant is given; `text: false` shows only the icon. */
  actions?: { label: string; icon?: Glyph; variant?: ButtonVariant; text?: false; onClick?: () => void }[]
  className?: string
  style?: CSSProperties
}

/** Contact card, usually the content of a popover opened from an avatar or @mention. */
export function ProfileCard({
  name,
  avatar,
  status,
  statusText,
  title,
  tags,
  fields,
  actions,
  className,
  style,
}: ProfileCardProps) {
  return (
    <div className={cx('pn-profile', className)} style={style}>
      <div className="pn-profile__top">
        <Avatar name={name} src={avatar} size={56} status={status === 'offline' ? undefined : status} />
        <div className="pn-profile__id">
          <div className="pn-profile__name">
            {name}
            {tags?.map((t) => (
              <Tag key={t.label} tone={t.tone}>
                {t.label}
              </Tag>
            ))}
          </div>
          {statusText && (
            <div className="pn-profile__status">
              <span className={`pn-profile__dot pn-profile__dot--${status ?? 'online'}`} />
              {statusText}
            </div>
          )}
          {title && <div className="pn-profile__title">{title}</div>}
        </div>
      </div>
      {fields && fields.length > 0 && (
        <dl className="pn-profile__fields">
          {fields.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fields are positional and labels may be nodes
            <Fragment key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {actions && actions.length > 0 && (
        <div className="pn-profile__actions">
          {actions.map((a, i) => {
            const variant = a.variant ?? (i === 0 ? 'primary' : 'default')
            return a.text === false && a.icon ? (
              <Button
                key={a.label}
                variant={variant}
                icon={a.icon}
                aria-label={a.label}
                title={a.label}
                onClick={a.onClick}
              />
            ) : (
              <Button key={a.label} variant={variant} icon={a.icon} onClick={a.onClick} style={{ flex: 1 }}>
                {a.label}
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}
