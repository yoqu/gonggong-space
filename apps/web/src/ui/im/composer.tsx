import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../../lib/cx'
import { CloseButton, type Glyph, renderGlyph } from '../controls'
import { Icon } from '../icon'
import './composer.css'

/** Six lines of 19px. */
const MAX_INPUT_PX = 114

export interface ComposerTool {
  icon: Glyph
  label: string
  onClick?: () => void
}

const DEFAULT_TOOLS: ComposerTool[] = [
  { icon: 'smile', label: '表情' },
  { icon: 'at', label: '提及' },
  { icon: 'image', label: '图片' },
  { icon: 'paperclip', label: '文件' },
  { icon: 'scissors', label: '截图' },
  { icon: 'textformat', label: '格式' },
]

export interface ComposerProps {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** Receives the trimmed text; uncontrolled composers clear themselves afterwards. */
  onSend?: (text: string) => void
  placeholder?: string
  /** Placeholder becomes「发送给 {recipient}」. */
  recipient?: string
  replyTo?: { author: string; text: ReactNode }
  onCancelReply?: () => void
  tools?: ComposerTool[]
  hint?: ReactNode | false
  disabled?: boolean
  /** Overrides the non-empty check, e.g. attachments make an empty text sendable or an upload blocks sending. */
  canSend?: boolean
  /** Chips (attachments, append banner) inside the box above the text. */
  above?: ReactNode
  /** Floating candidate list anchored above the box. */
  popover?: ReactNode
  /** Runs before Enter-to-send, never during IME composition; preventDefault() suppresses the send. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** Pasted or dropped files; the box highlights while files are dragged over it. */
  onFiles?: (files: File[]) => void
  /** Growth cap of the input in px (default six lines); it scrolls beyond. */
  maxInputHeight?: number
  /** A send is in flight: the send button shows it and stays disabled. */
  busy?: boolean
  /** Successful sends so far; each one replays the send icon's fly-out. */
  sent?: number
  /** Extra textarea attributes (combobox ARIA). */
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange' | 'onKeyDown' | 'placeholder' | 'disabled'
  >
  className?: string
}

export function Composer({
  value,
  defaultValue = '',
  onChange,
  onSend,
  placeholder,
  recipient,
  replyTo,
  onCancelReply,
  tools = DEFAULT_TOOLS,
  hint,
  disabled,
  canSend,
  above,
  popover,
  onKeyDown,
  inputRef,
  onFiles,
  maxInputHeight = MAX_INPUT_PX,
  busy,
  sent = 0,
  textareaProps,
  className,
}: ComposerProps) {
  const [own, setOwn] = useState(defaultValue)
  const text = value ?? own
  const localRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? localRef
  const composing = useRef(false)
  const [dropping, setDropping] = useState(false)
  const sendable = !disabled && !busy && (canSend ?? text.trim() !== '')

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxInputHeight)}px`
    el.style.overflowY = el.scrollHeight > maxInputHeight ? 'auto' : 'hidden'
  }, [text, ref, maxInputHeight])

  const set = (v: string) => {
    if (value === undefined) setOwn(v)
    onChange?.(v)
  }
  const send = () => {
    if (!sendable) return
    onSend?.(text.trim())
    if (value === undefined) setOwn('')
  }

  const takeFiles = (files: FileList, e: { preventDefault: () => void }) => {
    if (!onFiles || !files.length) return
    e.preventDefault()
    onFiles(Array.from(files))
  }

  return (
    <div className={cx('pn-composer-wrap', className)}>
      {popover}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a file drop target; pickers and paste are the keyboard path */}
      <div
        className={cx('pn-composer', dropping && 'pn-composer--drop')}
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
        {replyTo && (
          <div className="pn-composer__reply">
            <div className="pn-quote">
              <b>回复 {replyTo.author}：</b>
              {replyTo.text}
            </div>
            {onCancelReply && <CloseButton title="取消回复" onClick={onCancelReply} />}
          </div>
        )}
        {above}
        <textarea
          aria-label="消息输入"
          {...textareaProps}
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder ?? `发送给 ${recipient ?? '…'}`}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
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
            if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey) return
            e.preventDefault()
            send()
          }}
        />
        <div className="pn-composer__bar">
          {tools.map((t) => (
            <button
              key={t.label}
              type="button"
              className="pn-composer__tool"
              aria-label={t.label}
              title={t.label}
              disabled={disabled}
              onClick={t.onClick ?? (t.icon === 'at' ? () => set(`${text}@`) : undefined)}
            >
              {renderGlyph(t.icon)}
            </button>
          ))}
          {hint === false ? (
            <span className="pn-composer__spacer" />
          ) : (
            <span className="pn-composer__hint">{hint ?? 'Enter 发送 · ⇧Enter 换行'}</span>
          )}
          <button
            type="button"
            className="pn-composer__send"
            aria-label="发送"
            title="发送（Enter），换行（Shift + Enter）"
            data-state={busy ? 'busy' : sendable ? 'ready' : 'idle'}
            data-sent={sent}
            disabled={!sendable}
            onClick={send}
          >
            <span key={sent} className={cx('pn-composer__send-icon', sent > 0 && 'pn-composer__send-icon--sent')}>
              <Icon name="send" weight={2.2} />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
