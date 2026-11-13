import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'
import { locale, t } from '../../i18n'
import { copyText } from '../../lib/clipboard'
import { cx } from '../../lib/cx'
import { langFor, Tokens, useHighlight } from '../highlight'
import { Icon } from '../icon'
import { VoiceNote } from '../voice-note'
import './rich.css'

const COPIED_MS = 1500

/** Multi-line code in a message: language/filename header, 复制 button, mono text scrolling sideways, 240px tall at most. No syntax colouring (Pane). */
export function CodeBlock({
  code,
  language,
  filename,
  onCopyError,
  className,
  style,
}: {
  code: string
  language?: string
  filename?: string
  /** The clipboard refused (insecure context, denied permission). */
  onCopyError?: () => void
  className?: string
  style?: CSSProperties
}) {
  const [copied, setCopied] = useState(false)
  const lines = useHighlight(code, langFor(language))
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <div className={cx('pn-code', className)} style={style}>
      <div className="pn-code__head">
        <span>{filename ?? language ?? t('代码')}</span>
        <button
          type="button"
          className="pn-code__copy"
          onClick={async () => {
            try {
              await copyText(code)
              setCopied(true)
            } catch {
              onCopyError?.()
            }
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? t('已复制') : t('复制')}
        </button>
        <span className="pn-code__live" role="status">
          {copied ? t('已复制') : ''}
        </span>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard */}
      <pre className="pn-code__pre" tabIndex={0}>
        <code>
          {lines
            ? lines.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
                <span key={i}>
                  {i ? '\n' : null}
                  <Tokens tokens={l} />
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  )
}

/** Unfurled link: site, title and summary (two lines each), optional image; opens in a new tab. */
export function LinkPreview({
  url,
  title,
  site,
  description,
  image,
  className,
  style,
}: {
  url: string
  title: ReactNode
  site?: string
  description?: ReactNode
  image?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <a
      className={cx('pn-link', className)}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
    >
      {image && (
        <span className="pn-link__img">
          <img src={image} alt="" />
        </span>
      )}
      <span className="pn-link__body">
        <span className="pn-link__site">
          <Icon name="globe" />
          {site ?? url.replace(/^https?:\/\//, '').split('/')[0]}
        </span>
        <span className="pn-link__title">{title}</span>
        {description && <span className="pn-link__desc">{description}</span>}
      </span>
    </a>
  )
}

export interface VoiceMessageProps {
  /** Seconds; the file's own length wins once it loads. */
  duration: number
  src?: string
  played?: boolean
  transcript?: ReactNode
  seed?: string
  onPlay?: (playing: boolean) => void
  className?: string
}

/** Voice note inside a bubble: the VoiceNote bar, a red dot until first played, and an optional transcript. */
export function VoiceMessage({
  duration,
  src,
  played: playedInit = false,
  transcript,
  seed,
  onPlay,
  className,
}: VoiceMessageProps) {
  const [played, setPlayed] = useState(playedInit)
  return (
    <div className={cx('pn-voice', className)}>
      <div className="pn-voice__row">
        <VoiceNote
          className="pn-voice__note"
          src={src}
          duration={duration}
          seed={seed}
          onPlayingChange={(p) => {
            if (p) setPlayed(true)
            onPlay?.(p)
          }}
        />
        {!played && <span className="pn-voice__unread" role="img" aria-label={t('未听')} />}
      </div>
      {transcript && <div className="pn-voice__text">{transcript}</div>}
    </div>
  )
}

const SEP = locale === 'en' ? ', ' : '、'
const typingWho = (name: string | string[]) =>
  Array.isArray(name)
    ? name.length > 2
      ? t('{names} 等 {n} 人', { names: name.slice(0, 2).join(SEP), n: name.length, more: name.length - 2 })
      : name.join(SEP)
    : name

/** 「正在输入」: three bouncing dots in a bubble at the list end, or text only (`bubble={false}`) as a header subtitle. */
export function TypingIndicator({
  name,
  bubble = true,
  action = t('正在输入'),
  className,
}: {
  name?: string | string[]
  /** false hides the bubble; a node replaces the three dots (e.g. the mascot at work). */
  bubble?: boolean | ReactNode
  /** The verb after the names, e.g.「正在处理」for a working Bot. */
  action?: string
  className?: string
}) {
  return (
    <div className={cx('pn-typing', className)} role="status" aria-live="polite">
      {bubble === true ? (
        <span className="pn-typing__bubble" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : bubble ? (
        <span className="pn-typing__bubble pn-typing__bubble--art" aria-hidden="true">
          {bubble}
        </span>
      ) : null}
      {name && (
        <span className="pn-typing__text">
          {typingWho(name)} {action}…
        </span>
      )}
    </div>
  )
}
