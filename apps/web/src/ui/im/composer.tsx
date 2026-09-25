import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../../lib/cx'
import { type Glyph, renderGlyph } from '../controls'
import { Icon } from '../icon'
import { SmallClose } from './notice'
import { EmojiPicker, filterMembers, type MentionMember, MentionPicker } from './pickers'
import './composer.css'

/** Six lines of 19px. */
const MAX_INPUT_PX = 114

export interface ComposerTool {
  icon: Glyph
  label: string
  onClick?: () => void
}

export const DEFAULT_TOOLS: ComposerTool[] = [
  { icon: 'smile', label: '表情' },
  { icon: 'at', label: '提及' },
  { icon: 'image', label: '图片' },
  { icon: 'paperclip', label: '文件' },
  { icon: 'scissors', label: '截图' },
  { icon: 'textformat', label: '格式' },
]

/** `@query` right before the caret, the @ not glued to a word. */
const MENTION_AT = /(^|[^A-Za-z0-9_])@([^\s@]{0,20})$/

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
  /** Small control left of the hint/send button, e.g. 「同时发送到群」. */
  accessory?: ReactNode
  disabled?: boolean
  /** Members for the built-in @ picker: typing「@」or the @ tool opens it. */
  mentions?: MentionMember[]
  /** `false` drops the「所有人」row. */
  mentionAll?: boolean
  onMention?: (member: MentionMember) => void
  /** Demo: open the @ picker for a `defaultValue` ending in `@query`. */
  defaultMentionOpen?: boolean
  /** 常用 row of the built-in emoji picker. */
  recentEmoji?: string[]
  defaultEmojiOpen?: boolean
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
  accessory,
  disabled,
  mentions,
  mentionAll = true,
  onMention,
  defaultMentionOpen,
  recentEmoji,
  defaultEmojiOpen = false,
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
  const rootRef = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const [dropping, setDropping] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(() => {
    const m = defaultMentionOpen && mentions ? MENTION_AT.exec(defaultValue) : null
    return m ? { start: m.index + (m[1] ?? '').length, query: m[2] ?? '' } : null
  })
  const [active, setActive] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(defaultEmojiOpen)
  const listId = useId()
  const candidates = mention && mentions ? filterMembers(mentions, mention.query, mentionAll) : []
  const picking = candidates.length > 0
  const sendable = !disabled && !busy && (canSend ?? text.trim() !== '')

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxInputHeight)}px`
    el.style.overflowY = el.scrollHeight > maxInputHeight ? 'auto' : 'hidden'
  }, [text, ref, maxInputHeight])

  useEffect(() => {
    if (!emojiOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setEmojiOpen(false)
    }
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setEmojiOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [emojiOpen])

  const set = (v: string) => {
    if (value === undefined) setOwn(v)
    onChange?.(v)
  }
  const send = () => {
    if (!sendable) return
    onSend?.(text.trim())
    if (value === undefined) setOwn('')
    setMention(null)
  }
  const detect = (v: string, caret: number) => {
    if (!mentions) return
    const m = MENTION_AT.exec(v.slice(0, caret))
    setMention(m ? { start: m.index + (m[1] ?? '').length, query: m[2] ?? '' } : null)
    setActive(0)
  }
  const caretTo = (pos: number) =>
    setTimeout(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
    })
  const insertAtCaret = (s: string) => {
    const c = ref.current?.selectionStart ?? text.length
    const next = text.slice(0, c) + s + text.slice(c)
    set(next)
    caretTo(c + s.length)
    return { next, caret: c + s.length }
  }
  const pick = (m: MentionMember) => {
    if (!mention) return
    const el = ref.current
    const c = el && document.activeElement === el ? el.selectionStart : text.length
    const ins = `@${m.name} `
    set(text.slice(0, mention.start) + ins + text.slice(c))
    setMention(null)
    caretTo(mention.start + ins.length)
    onMention?.(m)
  }
  const toolClick = (t: ComposerTool) => {
    if (t.onClick) return t.onClick()
    if (t.icon === 'smile') {
      setMention(null)
      setEmojiOpen(!emojiOpen)
    } else if (t.icon === 'at') {
      if (!mentions) return set(`${text}@`)
      const r = insertAtCaret('@')
      detect(r.next, r.caret)
    }
  }
  const pickerKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const n = candidates.length
    if (e.key === 'ArrowDown') setActive((active + 1) % n)
    else if (e.key === 'ArrowUp') setActive((active - 1 + n) % n)
    else if (e.key === 'Enter' || e.key === 'Tab') pick(candidates[Math.min(active, n - 1)] as MentionMember)
    else if (e.key === 'Escape') setMention(null)
    else return false
    e.preventDefault()
    return true
  }

  const takeFiles = (files: FileList, e: { preventDefault: () => void }) => {
    if (!onFiles || !files.length) return
    e.preventDefault()
    onFiles(Array.from(files))
  }

  return (
    <div ref={rootRef} className={cx('pn-composer-wrap', className)}>
      {popover}
      {emojiOpen && (
        <EmojiPicker
          className="pn-composer__popover"
          recent={recentEmoji}
          onSelect={(e) => {
            insertAtCaret(e)
            setEmojiOpen(false)
          }}
        />
      )}
      {picking && (
        <MentionPicker
          id={listId}
          className="pn-composer__popover"
          items={candidates}
          query={mention?.query}
          activeIndex={active}
          onActiveChange={setActive}
          onSelect={pick}
        />
      )}
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
            {onCancelReply && <SmallClose label="取消回复" onClick={onCancelReply} />}
          </div>
        )}
        {above}
        <textarea
          aria-label="消息输入"
          {...(mentions && {
            role: 'combobox',
            'aria-autocomplete': 'list' as const,
            'aria-expanded': picking,
            'aria-controls': picking ? listId : undefined,
            'aria-activedescendant': picking ? `${listId}-${active}` : undefined,
          })}
          {...textareaProps}
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder ?? `发送给 ${recipient ?? '…'}`}
          disabled={disabled}
          onChange={(e) => {
            set(e.target.value)
            detect(e.target.value, e.target.selectionStart)
          }}
          onBlur={() => {
            // Mousedown on a picker row keeps focus, so a real blur means the user left the input.
            setTimeout(() => {
              if (ref.current && document.activeElement !== ref.current) setMention(null)
            }, 150)
          }}
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
            if (picking && pickerKeys(e)) return
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
              aria-pressed={!t.onClick && t.icon === 'smile' ? emojiOpen : undefined}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toolClick(t)}
            >
              {renderGlyph(t.icon)}
            </button>
          ))}
          {accessory && <span className="pn-composer__accessory">{accessory}</span>}
          {hint === false ? (
            !accessory && <span className="pn-composer__spacer" />
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
            <span
              key={sent}
              className={cx('pn-composer__send-icon', sent > 0 && 'pn-composer__send-icon--sent')}
            >
              <Icon name="send" weight={2.2} />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
