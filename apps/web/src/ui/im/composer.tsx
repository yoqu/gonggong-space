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
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { type Glyph, renderGlyph } from '../controls'
import { Icon } from '../icon'
import { useEscape, useOutsidePress } from '../overlay'
import { splitMentions } from './message'
import { SmallClose } from './notice'
import { EmojiPicker, filterMembers, type MentionMember, MentionPicker } from './pickers'
import './composer.css'

/** Six lines of 19px. */
const MAX_INPUT_PX = 114

export interface ComposerTool {
  icon: Glyph
  label: string
  onClick?: () => void
  /** Shown after the icon; such tools are a capsule instead of a round icon button. */
  text?: string
  /** Accent-tinted, for a feature entry point such as 「创作」. */
  accent?: boolean
}

export const DEFAULT_TOOLS: ComposerTool[] = [
  { icon: 'smile', label: t('表情') },
  { icon: 'at', label: t('提及') },
  { icon: 'image', label: t('图片') },
  { icon: 'paperclip', label: t('文件#item') },
  { icon: 'scissors', label: t('截图') },
  { icon: 'textformat', label: t('格式') },
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
  /** Names whose `@name` is highlighted and edited as one unit; defaults to the `mentions` names. */
  mentionNames?: string[]
  /** Demo: open the @ picker for a `defaultValue` ending in `@query`. */
  defaultMentionOpen?: boolean
  /** 常用 row of the built-in emoji picker. */
  recentEmoji?: string[]
  defaultEmojiOpen?: boolean
  /** Called when the built-in emoji picker opens or closes. */
  onEmojiOpenChange?: (open: boolean) => void
  /** Called whenever the textarea caret position changes (input, click, selection, key navigation). */
  onCaretChange?: (pos: number) => void
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
  mentionNames,
  defaultMentionOpen,
  recentEmoji,
  defaultEmojiOpen = false,
  onEmojiOpenChange,
  onCaretChange,
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
  const mirrorRef = useRef<HTMLDivElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  const composing = useRef(false)
  const emojiComposing = useRef(false)
  const lastCaret = useRef(0)
  const onEmojiChange = useRef(onEmojiOpenChange)
  onEmojiChange.current = onEmojiOpenChange
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
  const hasPopover = Boolean(popover) || picking
  const sendable = !disabled && !busy && (canSend ?? text.trim() !== '')
  let offset = 0
  const segments = splitMentions(text, mentionNames ?? mentions?.map((m) => m.name) ?? []).map((seg) => {
    const start = offset
    offset += seg.text.length
    return { ...seg, start, end: offset }
  })
  const marks = segments.filter((seg) => seg.mention)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxInputHeight)}px`
    el.style.overflowY = el.scrollHeight > maxInputHeight ? 'auto' : 'hidden'
    if (mirrorRef.current) mirrorRef.current.scrollTop = el.scrollTop
  }, [text, ref, maxInputHeight])

  const setEmoji = (next: boolean) => {
    if (!next) emojiComposing.current = false
    setEmojiOpen(next)
    onEmojiChange.current?.(next)
  }
  const closeEmoji = (refocus: boolean) => {
    setEmoji(false)
    if (refocus) (emojiBtnRef.current ?? ref.current)?.focus()
  }

  // Keep the emoji picker and any external/mention candidate popover mutually exclusive.
  useEffect(() => {
    if (!hasPopover || !emojiOpen) return
    emojiComposing.current = false
    setEmojiOpen(false)
    onEmojiChange.current?.(false)
  }, [hasPopover, emojiOpen])

  // Guard EmojiPicker's search input so Esc cancels IME composition instead of closing the picker.
  useEffect(() => {
    const root = rootRef.current
    if (!emojiOpen || !root) return
    const onStart = (e: CompositionEvent) => {
      if ((e.target as Element | null)?.closest('.pn-emoji')) emojiComposing.current = true
    }
    const onEnd = (e: CompositionEvent) => {
      if ((e.target as Element | null)?.closest('.pn-emoji')) emojiComposing.current = false
    }
    root.addEventListener('compositionstart', onStart, true)
    root.addEventListener('compositionend', onEnd, true)
    return () => {
      emojiComposing.current = false
      root.removeEventListener('compositionstart', onStart, true)
      root.removeEventListener('compositionend', onEnd, true)
    }
  }, [emojiOpen])

  useEscape(() => {
    if (emojiComposing.current) return
    closeEmoji(true)
  }, emojiOpen)
  useOutsidePress([rootRef], () => closeEmoji(false), emojiOpen)

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
      if (!ref.current) return
      ref.current.focus()
      ref.current.setSelectionRange(pos, pos)
      lastCaret.current = pos
      onCaretChange?.(pos)
    })
  const insertAtCaret = (s: string) => {
    const c = ref.current?.selectionStart ?? text.length
    const next = text.slice(0, c) + s + text.slice(ref.current?.selectionEnd ?? c)
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
    if (t.onClick) {
      if (emojiOpen) setEmoji(false)
      return t.onClick()
    }
    if (t.icon === 'smile') {
      setMention(null)
      setEmoji(!emojiOpen)
    } else if (t.icon === 'at') {
      if (emojiOpen) setEmoji(false)
      if (!mentions) return set(`${text}@`)
      const c = ref.current?.selectionStart ?? text.length
      const r = insertAtCaret(c > 0 && !/\s/.test(text[c - 1] ?? '') ? ' @' : '@')
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

  /** Backspace / Delete next to a mention selects all of it, so the native edit removes it in one go (and stays undoable). */
  const selectMention = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const c = el.selectionStart
    if (c !== el.selectionEnd) return
    const m =
      e.key === 'Backspace'
        ? marks.find((r) => r.end === c)
        : e.key === 'Delete'
          ? marks.find((r) => r.start === c)
          : undefined
    if (m) el.setSelectionRange(m.start, m.end)
  }
  /** The caret never rests inside a mention: arrows step over it, clicks land on the nearer edge. */
  const snapCaret = (el: HTMLTextAreaElement) => {
    const c = el.selectionStart
    const m = c === el.selectionEnd ? marks.find((r) => r.start < c && c < r.end) : undefined
    if (m) {
      const last = lastCaret.current
      const to =
        last === m.end ? m.start : last === m.start ? m.end : c - m.start < m.end - c ? m.start : m.end
      el.setSelectionRange(to, to)
    }
    lastCaret.current = el.selectionStart
    onCaretChange?.(el.selectionStart)
  }

  const takeFiles = (files: FileList, e: { preventDefault: () => void }) => {
    if (!onFiles || !files.length) return
    e.preventDefault()
    onFiles(Array.from(files))
  }

  const {
    onSelect: onTextareaSelect,
    onClick: onTextareaClick,
    onKeyUp: onTextareaKeyUp,
    onBlur: onTextareaBlur,
    onScroll: onTextareaScroll,
    onPaste: onTextareaPaste,
    onCompositionStart: onTextareaCompositionStart,
    onCompositionEnd: onTextareaCompositionEnd,
    className: textareaClassName,
    ...restTextareaProps
  } = textareaProps ?? {}

  return (
    <div ref={rootRef} className={cx('pn-composer-wrap', className)}>
      {popover}
      {emojiOpen && (
        <EmojiPicker
          className="pn-composer__popover"
          recent={recentEmoji}
          onSelect={(e) => {
            insertAtCaret(e)
            setEmoji(false)
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
              <b>{t('回复 {name}：', { name: replyTo.author })}</b>
              {replyTo.text}
            </div>
            {onCancelReply && <SmallClose label={t('取消回复')} onClick={onCancelReply} />}
          </div>
        )}
        {above}
        <div className="pn-composer__field">
          {marks.length > 0 && (
            <div ref={mirrorRef} className="pn-composer__mirror" aria-hidden="true">
              {segments.map((seg) =>
                seg.mention ? (
                  <span key={seg.start} className="pn-mention">
                    {seg.text}
                  </span>
                ) : (
                  seg.text
                ),
              )}
            </div>
          )}
          <textarea
            aria-label={t('消息输入')}
            {...(mentions && {
              role: 'combobox',
              'aria-autocomplete': 'list' as const,
              'aria-expanded': picking,
              'aria-controls': picking ? listId : undefined,
              'aria-activedescendant': picking ? `${listId}-${active}` : undefined,
            })}
            {...restTextareaProps}
            className={cx(marks.length > 0 && 'pn-composer__input--marked', textareaClassName)}
            ref={ref}
            rows={1}
            enterKeyHint="send"
            value={text}
            placeholder={placeholder ?? t('发送给 {name}', { name: recipient ?? '…' })}
            disabled={disabled}
            onChange={(e) => {
              set(e.target.value)
              detect(e.target.value, e.target.selectionStart)
              lastCaret.current = e.target.selectionStart
              onCaretChange?.(e.target.selectionStart)
            }}
            onBlur={(e) => {
              // Mousedown on a picker row keeps focus, so a real blur means the user left the input.
              setTimeout(() => {
                if (ref.current && document.activeElement !== ref.current) setMention(null)
              }, 150)
              onTextareaBlur?.(e)
            }}
            onSelect={(e) => {
              snapCaret(e.currentTarget)
              onTextareaSelect?.(e)
            }}
            onClick={(e) => {
              snapCaret(e.currentTarget)
              onTextareaClick?.(e)
            }}
            onKeyUp={(e) => {
              snapCaret(e.currentTarget)
              onTextareaKeyUp?.(e)
            }}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
              onTextareaScroll?.(e)
            }}
            onPaste={(e) => {
              takeFiles(e.clipboardData.files, e)
              onTextareaPaste?.(e)
            }}
            onCompositionStart={(e) => {
              composing.current = true
              onTextareaCompositionStart?.(e)
            }}
            onCompositionEnd={(e) => {
              // Safari fires the committing Enter's keydown right after compositionend, with isComposing false.
              setTimeout(() => {
                composing.current = false
              })
              onTextareaCompositionEnd?.(e)
            }}
            onKeyDown={(e) => {
              if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return
              if (picking && pickerKeys(e)) return
              selectMention(e)
              onKeyDown?.(e)
              if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey) return
              e.preventDefault()
              // Ctrl/Cmd/Alt+Enter is the newline key in WeChat and Feishu; sending there surprises people.
              if (e.ctrlKey || e.metaKey || e.altKey) insertAtCaret('\n')
              else send()
            }}
          />
        </div>
        <div className="pn-composer__bar">
          {tools.map((t) => (
            <button
              key={t.label}
              ref={!t.onClick && t.icon === 'smile' ? emojiBtnRef : undefined}
              type="button"
              className={cx(
                'pn-composer__tool',
                t.text && 'pn-composer__tool--text',
                t.accent && 'pn-composer__tool--accent',
              )}
              aria-label={t.label}
              title={t.label}
              aria-pressed={!t.onClick && t.icon === 'smile' ? emojiOpen : undefined}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toolClick(t)}
            >
              {renderGlyph(t.icon)}
              {t.text ? <span>{t.text}</span> : null}
            </button>
          ))}
          {accessory && <span className="pn-composer__accessory">{accessory}</span>}
          {hint === false ? (
            !accessory && <span className="pn-composer__spacer" />
          ) : (
            <span className="pn-composer__hint">{hint ?? t('Enter 发送 · ⇧/Ctrl+Enter 换行')}</span>
          )}
          <button
            type="button"
            className="pn-composer__send"
            aria-label={t('发送')}
            title={t('发送（Enter），换行（Shift/Ctrl + Enter）')}
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
