import { AtSign, ChevronLeft, Image, Paperclip, Slash } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'
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
  railClass,
  mobileView,
}: {
  sidebar: ReactNode
  children: ReactNode
  rail?: ReactNode
  railOpen?: boolean
  railClass?: string
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
        <aside aria-label="侧栏" className={cx('chat__rail', railClass, mobile && 'chat__rail--overlay')}>
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

/** Bare `@` / `/` only open the candidate list; they are not a message. */
const hasText = (value: string) => !['', '@', '/'].includes(value.trim())

export function Composer({
  value,
  onChange,
  onSend,
  hint,
  above,
  popover,
  inputRef,
  onKeyDown,
  onFiles,
  combobox,
  busy,
  attachments = 0,
  uploading = false,
  onAttach,
  onImage,
}: {
  value: string
  onChange: (value: string) => void
  onSend?: () => void
  hint?: ReactNode
  /** Quote / attachment strips rendered above the textarea. */
  above?: ReactNode
  /** Floating candidate list anchored above the composer. */
  popover?: ReactNode
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** Runs first; call preventDefault() to suppress Enter-to-send. Never called during IME composition. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  /** Pasted or dropped files. */
  onFiles?: (files: File[]) => void
  /** ARIA combobox state of the candidate list. */
  combobox?: { controls: string; expanded: boolean; active?: string }
  /** A send is in flight. */
  busy?: boolean
  /** Attached files make an empty text sendable; sending waits for their uploads. */
  attachments?: number
  uploading?: boolean
  onAttach?: () => void
  onImage?: () => void
}) {
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? own
  const composing = useRef(false)
  const [dropping, setDropping] = useState(false)
  const canSend = Boolean(onSend) && (hasText(value) || attachments > 0) && !busy && !uploading

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, ref])

  const takeFiles = (files: FileList, e: { preventDefault: () => void }) => {
    if (!onFiles || !files.length) return
    e.preventDefault()
    onFiles(Array.from(files))
  }

  return (
    <div className="composer">
      {popover}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a file drop target; pickers and paste are the keyboard path */}
      <div
        className={cx('composer__box', dropping && 'composer__box--drop')}
        onDragOver={(e) => {
          if (!onFiles || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={(e) => {
          setDropping(false)
          takeFiles(e.dataTransfer.files, e)
        }}
      >
        {above}
        <textarea
          ref={ref}
          className="composer__input"
          rows={2}
          value={value}
          placeholder="输入消息，@ 触发 bot 或引用文件，/ 查看命令"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={combobox?.expanded ?? false}
          aria-controls={combobox?.controls}
          aria-activedescendant={combobox?.active}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => takeFiles(e.clipboardData.files, e)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            // Safari fires the committing Enter's keydown right after compositionend, with isComposing false.
            setTimeout(() => {
              composing.current = false
            })
          }}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return
            onKeyDown?.(e)
            if (e.defaultPrevented) return
            if (e.key === 'Enter' && !e.shiftKey && onSend) {
              e.preventDefault()
              if (canSend) onSend()
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
          <IconButton title="附件" onClick={onAttach}>
            <Paperclip size={14} />
          </IconButton>
          <IconButton title="图片" onClick={onImage}>
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
