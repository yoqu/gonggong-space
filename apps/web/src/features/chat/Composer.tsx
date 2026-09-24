import { AtSign, Image, Paperclip, SendHorizontal, Slash } from 'lucide-react'
import {
  AnimatePresence,
  type AnimationPlaybackControls,
  animate,
  motion,
  useReducedMotionConfig,
} from 'motion/react'
import { type KeyboardEvent, type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../../lib/cx'
import { SPRING } from '../../lib/motion'
import { IconButton } from '../../ui'
import './composer.css'

/** The input grows with its content up to this height (and 40% of the window), then scrolls. */
export const MAX_INPUT_PX = 240

/** Bare `@` / `/` only open the candidate list; they are not a message. */
const hasText = (value: string) => !['', '@', '/'].includes(value.trim())

/** Feishu-style input block: chips above the text, tool row and send button inside its bottom edge. */
export function Composer({
  value,
  onChange,
  onSend,
  sent = 0,
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
  /** Successful sends so far; each one replays the send button's fly-out. */
  sent?: number
  hint?: ReactNode
  /** Append banner / quote / attachment chips, inside the block above the text. */
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
  const growth = useRef<AnimationPlaybackControls | null>(null)
  const reduced = useReducedMotionConfig()
  const [dropping, setDropping] = useState(false)
  const canSend = Boolean(onSend) && (hasText(value) || attachments > 0) && !busy && !uploading

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    growth.current?.stop()
    const from = el.offsetHeight
    el.style.height = 'auto'
    const cap = Math.min(MAX_INPUT_PX, window.innerHeight * 0.4)
    const to = Math.min(el.scrollHeight, cap)
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden'
    // Not laid out yet (first paint, hidden tab): jump straight to the size.
    if (!from || from === to || reduced) el.style.height = `${to}px`
    else {
      el.style.height = `${from}px`
      growth.current = animate(el, { height: `${to}px` }, SPRING.smooth)
    }
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
        <div className="composer__chips" data-testid="composer-chips">
          {above}
        </div>
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
            <AtSign size={16} />
          </IconButton>
          <IconButton title="命令" onClick={() => onChange(`${value}/`)}>
            <Slash size={16} />
          </IconButton>
          <IconButton title="附件" onClick={onAttach}>
            <Paperclip size={16} />
          </IconButton>
          <IconButton title="图片" onClick={onImage}>
            <Image size={16} />
          </IconButton>
          <span className="composer__hint">{hint}</span>
          <motion.button
            type="button"
            className="composer__send"
            aria-label="发送"
            title="发送（Enter），换行（Shift + Enter）"
            data-state={busy ? 'busy' : canSend ? 'ready' : 'idle'}
            data-sent={sent}
            disabled={!canSend}
            onClick={onSend}
            whileTap={canSend ? { scale: 0.86 } : undefined}
            transition={SPRING.bouncy}
          >
            <AnimatePresence initial={false}>
              <motion.span
                key={sent}
                className="composer__send-icon"
                initial={{ x: -10, y: 10, opacity: 0 }}
                animate={{ x: 0, y: 0, opacity: 1 }}
                exit={{ x: 12, y: -12, opacity: 0 }}
                transition={SPRING.bouncy}
              >
                <SendHorizontal size={16} strokeWidth={1.75} />
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
      </div>
    </div>
  )
}
