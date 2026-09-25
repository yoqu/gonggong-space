import { type CSSProperties, type ReactNode, useState } from 'react'
import { cx } from '../../lib/cx'
import { Button, type ButtonVariant, type Glyph, renderGlyph } from '../controls'
import { AvatarGroup, type AvatarProps, ProgressIndicator, Tag, type TagTone } from '../display'
import { Icon, type IconName } from '../icon'
import { SegmentedControl } from '../segmented'
import './cards.css'

type Tint = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray'

const tint = (t: Tint): CSSProperties => ({ background: `var(--tint-${t})`, color: `var(--tint-${t}-text)` })

const FILE_KINDS: Record<string, [Tint, string]> = {
  pdf: ['red', 'PDF'],
  doc: ['blue', 'DOC'],
  docx: ['blue', 'DOC'],
  pages: ['orange', 'PAGES'],
  xls: ['green', 'XLS'],
  xlsx: ['green', 'XLS'],
  csv: ['green', 'CSV'],
  numbers: ['green', 'NUM'],
  ppt: ['orange', 'PPT'],
  pptx: ['orange', 'PPT'],
  key: ['blue', 'KEY'],
  zip: ['gray', 'ZIP'],
  rar: ['gray', 'RAR'],
  png: ['purple', 'PNG'],
  jpg: ['purple', 'JPG'],
  mp4: ['purple', 'MP4'],
  txt: ['gray', 'TXT'],
}

export interface FileAttachmentProps {
  /** With extension; the extension picks the colour block. */
  name: string
  size?: string
  meta?: string
  ext?: string
  /** 0–100 shows an upload bar. */
  progress?: number
  /** `false` hides the download button. */
  onDownload?: (() => void) | false
  /** Makes the whole card a button (e.g. open a preview); it then has no download button. */
  onOpen?: () => void
  className?: string
}

export function FileAttachment({
  name,
  size,
  meta,
  ext,
  progress,
  onDownload,
  onOpen,
  className,
}: FileAttachmentProps) {
  const e = (ext ?? name.split('.').pop() ?? '').toLowerCase()
  const [tone, label] = FILE_KINDS[e] ?? ['gray', e.toUpperCase().slice(0, 4) || 'FILE']
  const Root = onOpen ? 'button' : 'div'
  return (
    <Root
      type={onOpen ? 'button' : undefined}
      className={cx('pn-card', 'pn-file', onOpen && 'pn-file--open', className)}
      onClick={onOpen}
    >
      <span className="pn-filetile" style={tint(tone)}>
        <Icon name="doc" />
        {label}
      </span>
      <span className="pn-file__body">
        <span className="pn-file__name">{name}</span>
        {progress != null && <ProgressIndicator value={progress} aria-label="上传进度" />}
        <span className="pn-file__meta">{[size, meta].filter(Boolean).join(' · ')}</span>
      </span>
      {onDownload !== false && !onOpen && (
        <Button variant="glass" icon="download" aria-label="下载" title="下载" onClick={onDownload} />
      )}
    </Root>
  )
}

export function ImageAttachment({
  src,
  alt = '',
  width,
  height,
  className,
}: {
  src: string
  alt?: string
  width?: number
  height?: number
  className?: string
}) {
  return (
    <figure className={cx('pn-image', className)} style={{ width }}>
      <img src={src} alt={alt} width={width} height={height} />
    </figure>
  )
}

export type DocKind = 'doc' | 'sheet' | 'base' | 'slides' | 'wiki' | 'mindnote'

const DOC_KINDS: Record<DocKind, [Tint, IconName, string]> = {
  doc: ['blue', 'doc', '文档'],
  sheet: ['green', 'sheet', '表格'],
  base: ['purple', 'grid', '多维表格'],
  slides: ['orange', 'slides', '幻灯片'],
  wiki: ['blue', 'folder', '知识库'],
  mindnote: ['purple', 'share', '思维笔记'],
}

export interface DocLinkProps {
  title: ReactNode
  kind?: DocKind
  owner?: string
  updated?: string
  permission?: ReactNode
  action?: ReactNode
  className?: string
}

export function DocLink({
  title,
  kind = 'doc',
  owner,
  updated,
  permission,
  action,
  className,
}: DocLinkProps) {
  const [tone, icon, label] = DOC_KINDS[kind]
  return (
    <div className={cx('pn-card', 'pn-doc', className)}>
      <div className="pn-doc__top">
        <span className="pn-filetile" style={{ ...tint(tone), height: 36 }}>
          <Icon name={icon} />
        </span>
        <div className="pn-doc__main">
          <div className="pn-doc__title">{title}</div>
          <div className="pn-doc__meta">{[label, owner, updated].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {(permission || action) && (
        <div className="pn-doc__foot">
          {permission ? (
            <span>
              <Icon name="lock" />
              {permission}
            </span>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
    </div>
  )
}

export interface MessageCardAction {
  label: ReactNode
  variant?: ButtonVariant
  onClick?: () => void
  disabled?: boolean
}

export interface MessageCardProps {
  title: ReactNode
  /** blue notice, green success, orange pending, red alert, gray finished. */
  template?: Tint
  icon?: Glyph
  /** Status tag at the right of the header. */
  status?: { label: string; tone: TagTone }
  fields?: { label: ReactNode; value: ReactNode; short?: boolean }[]
  children?: ReactNode
  actions?: MessageCardAction[]
  note?: ReactNode
  className?: string
  style?: CSSProperties
}

export function MessageCard({
  title,
  template = 'blue',
  icon,
  status,
  fields,
  children,
  actions,
  note,
  className,
  style,
}: MessageCardProps) {
  return (
    <div className={cx('pn-card', 'pn-mcard', `pn-mcard--${template}`, className)} style={style}>
      <div className="pn-mcard__head">
        {icon != null && renderGlyph(icon)}
        <span className="pn-mcard__title">{title}</span>
        {status && <Tag tone={status.tone}>{status.label}</Tag>}
      </div>
      <div className="pn-mcard__body">
        {fields && fields.length > 0 && (
          <div className="pn-mcard__fields">
            {fields.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fields are positional and labels may be nodes
              <div key={i} className={cx('pn-mcard__field', f.short && 'pn-mcard__field--short')}>
                <span className="pn-mcard__label">{f.label}</span>
                <span className="pn-mcard__value">{f.value}</span>
              </div>
            ))}
          </div>
        )}
        {children}
        {actions && actions.length > 0 && (
          <div className="pn-mcard__actions">
            {actions.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: actions are positional and labels may be nodes
              <Button key={i} variant={a.variant} onClick={a.onClick} disabled={a.disabled}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
        {note && <div className="pn-mcard__note">{note}</div>}
      </div>
    </div>
  )
}

export interface MeetingCardProps {
  title: ReactNode
  time?: ReactNode
  status?: 'scheduled' | 'live' | 'ended'
  /** Replaces「即将开始」, e.g.「5 分钟后开始」. */
  startsIn?: string
  meetingId?: string
  host?: string
  /** Shown once ended. */
  duration?: string
  participants?: AvatarProps[]
  /** People in the meeting now. */
  joined?: number
  onJoin?: () => void
  onReplay?: () => void
  className?: string
  style?: CSSProperties
}

const MEETING_TAG = {
  live: ['green', '进行中'],
  ended: ['gray', '已结束'],
  scheduled: ['blue', '即将开始'],
} as const

export function MeetingCard({
  title,
  time,
  status = 'scheduled',
  startsIn,
  meetingId,
  host,
  duration,
  participants = [],
  joined,
  onJoin,
  onReplay,
  className,
  style,
}: MeetingCardProps) {
  const [tone, label] = MEETING_TAG[status]
  const people =
    status === 'live'
      ? `${joined ?? participants.length} 人在会中`
      : `${participants.length} 人${status === 'ended' ? '参加' : '受邀'}`
  const ended = status === 'ended'
  return (
    <div className={cx('pn-card', 'pn-meet', `pn-meet--${status}`, className)} style={style}>
      <div className="pn-meet__top">
        <span className="pn-meet__icon">
          <Icon name="video" />
        </span>
        <div className="pn-meet__titles">
          <div className="pn-meet__title">{title}</div>
          {time && <div className="pn-meet__time">{time}</div>}
        </div>
        <Tag tone={tone}>
          {status === 'live' && <span className="pn-meet__live" />}
          {status === 'scheduled' ? (startsIn ?? label) : label}
        </Tag>
      </div>
      {(meetingId || host || (ended && duration)) && (
        <dl className="pn-meet__meta">
          {meetingId && (
            <>
              <dt>会议号</dt>
              <dd className="pn-meet__id">{meetingId}</dd>
            </>
          )}
          {host && (
            <>
              <dt>发起人</dt>
              <dd>{host}</dd>
            </>
          )}
          {ended && duration && (
            <>
              <dt>时长</dt>
              <dd>{duration}</dd>
            </>
          )}
        </dl>
      )}
      <div className="pn-meet__foot">
        {participants.length ? (
          <span className="pn-meet__ppl">
            <AvatarGroup people={participants} size={20} max={4} />
            <span>{people}</span>
          </span>
        ) : (
          <span />
        )}
        {!ended ? (
          <Button variant="primary" onClick={onJoin}>
            加入会议
          </Button>
        ) : onReplay ? (
          <Button icon="play" onClick={onReplay}>
            查看回放
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export type Rsvp = 'accepted' | 'tentative' | 'declined'

export interface EventCardProps {
  title: ReactNode
  month: string
  day: number | string
  weekday?: string
  /** Multi-day events spell out both dates here. */
  time: ReactNode
  location?: ReactNode
  organizer?: string
  attendees?: number
  /** `false` removes the reply bar. */
  rsvp?: Rsvp | null | false
  defaultRsvp?: Rsvp
  onRsvp?: (value: Rsvp) => void
  className?: string
  style?: CSSProperties
}

const RSVP_TEXT: Record<Rsvp, string> = {
  accepted: '你已接受',
  tentative: '你已回复待定',
  declined: '你已拒绝',
}
const RSVP_ITEMS: { value: Rsvp; label: string }[] = [
  { value: 'accepted', label: '接受' },
  { value: 'tentative', label: '待定' },
  { value: 'declined', label: '拒绝' },
]

export function EventCard({
  title,
  month,
  day,
  weekday,
  time,
  location,
  organizer,
  attendees,
  rsvp,
  defaultRsvp,
  onRsvp,
  className,
  style,
}: EventCardProps) {
  const [own, setOwn] = useState<Rsvp | null>(defaultRsvp ?? null)
  const current = rsvp === undefined ? own : rsvp || null
  return (
    <div className={cx('pn-card', 'pn-event', className)} style={style}>
      <div className="pn-event__top">
        <div className="pn-event__date" role="img" aria-label={`${month}${day}日 ${weekday ?? ''}`.trim()}>
          <span className="pn-event__month">{weekday ?? month}</span>
          <span className="pn-event__day">{day}</span>
        </div>
        <div className="pn-event__body">
          <div className="pn-event__title">{title}</div>
          <div className="pn-event__line">
            <Icon name="clock" />
            {time}
          </div>
          {location && (
            <div className="pn-event__line">
              <Icon name="pin" />
              {location}
            </div>
          )}
          {organizer && (
            <div className="pn-event__line">
              <Icon name="person" />
              {`${organizer} 组织${attendees ? ` · ${attendees} 人` : ''}`}
            </div>
          )}
        </div>
      </div>
      {rsvp !== false && (
        <div className="pn-event__foot">
          <span>{current ? RSVP_TEXT[current] : '是否参加？'}</span>
          <SegmentedControl<Rsvp | ''>
            size="small"
            aria-label="回复日程"
            value={current ?? ''}
            items={RSVP_ITEMS}
            onChange={(v) => {
              if (!v) return
              setOwn(v)
              onRsvp?.(v)
            }}
          />
        </div>
      )}
    </div>
  )
}
