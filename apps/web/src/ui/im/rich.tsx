import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'
import { cx } from '../../lib/cx'
import { langFor, Tokens, useHighlight } from '../highlight'
import { Icon } from '../icon'
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
        <span>{filename ?? language ?? '代码'}</span>
        <button
          type="button"
          className="pn-code__copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code)
              setCopied(true)
            } catch {
              onCopyError?.()
            }
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? '已复制' : '复制'}
        </button>
        <span className="pn-code__live" role="status">
          {copied ? '已复制' : ''}
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

const duration = (s: number) => {
  const t = Math.max(0, Math.round(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function hash(str: string) {
  let x = 0
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0
  return x % 9973
}

/** Deterministic waveform: 12–36 bars growing with the length, seeded so a message always looks the same. */
function bars(secs: number, seed: string) {
  const n = Math.max(12, Math.min(36, Math.round(10 + secs * 0.9)))
  let s = hash(seed) + 7
  return Array.from({ length: n }, (_, i) => {
    s = (s * 16807) % 2147483647
    return { id: `bar${i}`, height: Math.round((0.25 + ((s % 1000) / 1000) * 0.75) * 20), on: i / n }
  })
}

export interface VoiceMessageProps {
  /** Seconds. */
  duration: number
  played?: boolean
  playing?: boolean
  /** 0–1 of the waveform tinted as played. */
  progress?: number
  transcript?: ReactNode
  seed?: string
  onPlay?: (playing: boolean) => void
  className?: string
}

/** Voice note inside a bubble: play button, waveform, length, red dot until played; playback itself is the caller's. */
export function VoiceMessage({
  duration: secs,
  played: playedInit = false,
  playing: playingInit = false,
  progress,
  transcript,
  seed,
  onPlay,
  className,
}: VoiceMessageProps) {
  const [playing, setPlaying] = useState(playingInit)
  const [played, setPlayed] = useState(playedInit)
  const wave = bars(secs, seed ?? String(secs))
  const prog = progress ?? (playing ? 0.35 : 0)
  return (
    <div className={cx('pn-voice', className)}>
      <div className="pn-voice__row">
        <button
          type="button"
          className="pn-voice__play"
          aria-label={playing ? '暂停' : '播放语音'}
          aria-pressed={playing}
          onClick={() => {
            setPlaying(!playing)
            setPlayed(true)
            onPlay?.(!playing)
          }}
        >
          <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor" aria-hidden="true">
            {playing ? (
              <>
                <rect x={3.5} y={2.5} width={3} height={11} rx={1} />
                <rect x={9.5} y={2.5} width={3} height={11} rx={1} />
              </>
            ) : (
              <path d="M4.5 2.8v10.4c0 .6.6.9 1.1.6l8.2-5.2c.5-.3.5-1 0-1.3L5.6 2.2c-.5-.3-1.1 0-1.1.6z" />
            )}
          </svg>
        </button>
        <span className="pn-voice__wave" aria-hidden="true">
          {wave.map((b) => (
            <i key={b.id} style={{ height: b.height }} className={b.on < prog ? 'on' : undefined} />
          ))}
        </span>
        <span className="pn-voice__dur">{duration(secs)}</span>
        {!played && <span className="pn-voice__unread" role="img" aria-label="未听" />}
      </div>
      {transcript && <div className="pn-voice__text">{transcript}</div>}
    </div>
  )
}

const typingWho = (name: string | string[]) =>
  Array.isArray(name)
    ? name.length > 2
      ? `${name.slice(0, 2).join('、')} 等 ${name.length} 人`
      : name.join('、')
    : name

/** 「正在输入」: three bouncing dots in a bubble at the list end, or text only (`bubble={false}`) as a header subtitle. */
export function TypingIndicator({
  name,
  bubble = true,
  action = '正在输入',
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
