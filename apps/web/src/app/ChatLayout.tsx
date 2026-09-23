import { AtSign, ChevronLeft, Image, Paperclip, Slash } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cx } from '../lib/cx'
import { Button, IconButton } from '../ui'
import { MOBILE_MAX, RAIL_MIN, useViewportWidth } from './viewport'

/** Rail open state: defaults to open on wide screens and resets whenever the 1100px breakpoint is crossed. */
export function useRailOpen() {
  const narrow = useViewportWidth() < RAIL_MIN
  const [open, setOpen] = useState(!narrow)
  const [wasNarrow, setWasNarrow] = useState(narrow)
  if (narrow !== wasNarrow) {
    setWasNarrow(narrow)
    setOpen(!narrow)
  }
  return [open, setOpen] as const
}

export function ChatLayout({
  sidebar,
  children,
  rail,
  railOpen = false,
  mobileView,
}: {
  sidebar: ReactNode
  children: ReactNode
  rail?: ReactNode
  railOpen?: boolean
  /** Under 768px only one column is shown. */
  mobileView: 'list' | 'chat'
}) {
  const mobile = useViewportWidth() < MOBILE_MAX
  return (
    <div className="chat">
      {!mobile || mobileView === 'list' ? (
        <nav aria-label="会话列表" className="chat__sidebar">
          {sidebar}
        </nav>
      ) : null}
      {!mobile || mobileView === 'chat' ? <main className="chat__center">{children}</main> : null}
      {rail && railOpen ? (
        <aside aria-label="侧栏" className={cx('chat__rail', mobile && 'chat__rail--overlay')}>
          {rail}
        </aside>
      ) : null}
    </div>
  )
}

export function ChatHeader({
  title,
  badge,
  subtitle,
  actions,
  onBack,
}: {
  title: ReactNode
  badge?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  onBack?: () => void
}) {
  return (
    <div className="chat-header">
      {onBack ? (
        <button type="button" className="chat-header__back" aria-label="返回" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
      ) : null}
      <div className="chat-header__main">
        <div className="chat-header__line">
          <h1 className="chat-header__title">{title}</h1>
          {badge}
        </div>
        {subtitle ? <div className="chat-header__sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="chat-header__actions">{actions}</div> : null}
    </div>
  )
}

export function Timeline({ children }: { children: ReactNode }) {
  return <div className="timeline">{children}</div>
}

export function Composer({
  value,
  onChange,
  onSend,
  hint,
  above,
}: {
  value: string
  onChange: (value: string) => void
  onSend?: () => void
  hint?: ReactNode
  /** Quote / attachment strips rendered above the textarea. */
  above?: ReactNode
}) {
  const canSend = Boolean(onSend) && value.trim() !== ''
  return (
    <div className="composer">
      <div className="composer__box">
        {above}
        <textarea
          className="composer__input"
          rows={2}
          value={value}
          placeholder="输入消息，@ 触发 bot 或引用文件，/ 查看命令"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && canSend) {
              e.preventDefault()
              onSend?.()
            }
          }}
        />
        <div className="composer__bar">
          <IconButton title="@ 提及" onClick={() => onChange(`${value}@`)}>
            <AtSign size={14} />
          </IconButton>
          <IconButton title="命令" onClick={() => onChange(`${value}/`)}>
            <Slash size={14} />
          </IconButton>
          <IconButton title="附件">
            <Paperclip size={14} />
          </IconButton>
          <IconButton title="图片">
            <Image size={14} />
          </IconButton>
          <span className="composer__hint">{hint}</span>
          <Button variant="primary" size="sm" disabled={!canSend} onClick={onSend}>
            发送
          </Button>
        </div>
      </div>
    </div>
  )
}
