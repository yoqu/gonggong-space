import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import './voice-note.css'

const RATES = [1, 1.5, 2]
const STEP = 5
const MORPH_MS = 260

export const fmtClock = (s: number) => {
  const v = Math.max(0, Math.floor(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

function hash(str: string) {
  let x = 7
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0
  return (x % 2147483646) + 1
}

/** Seeded bar heights (0.12–1) under a speech-like envelope, so the same clip always draws the same wave. */
export function waveform(seed: string, n: number) {
  let s = hash(seed)
  return Array.from({ length: n }, (_, i) => {
    s = (s * 16807) % 2147483647
    const envelope = 0.4 + 0.6 * Math.sin((Math.PI * (i + 0.5)) / n)
    return Math.max(0.12, envelope * (0.3 + 0.7 * ((s % 1000) / 1000)))
  })
}

// The play triangle is two quads (left half, right half) and the pause glyph is two bars with the same point count,
// so the control morphs point by point instead of swapping icons. The halves overlap a little to hide the seam.
const PLAY = [7.6, 5.6, 12.9, 8.86, 12.9, 15.14, 7.6, 18.4, 12.6, 8.6, 18, 12, 18, 12, 12.6, 15.4]
const PAUSE = [7.4, 6.2, 10.4, 6.2, 10.4, 17.8, 7.4, 17.8, 13.6, 6.2, 16.6, 6.2, 16.6, 17.8, 13.6, 17.8]
const shape = (p: number[]) => {
  const q = (i: number) => `${p[i]?.toFixed(2)} ${p[i + 1]?.toFixed(2)}`
  return `M${q(0)}L${q(2)}L${q(4)}L${q(6)}ZM${q(8)}L${q(10)}L${q(12)}L${q(14)}Z`
}
const easeOutBack = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useMorph(playing: boolean) {
  const path = useRef<SVGPathElement>(null)
  const from = useRef(playing ? PAUSE : PLAY)
  const [initial] = useState(() => shape(from.current))
  useEffect(() => {
    const el = path.current
    const to = playing ? PAUSE : PLAY
    const start = from.current
    if (!el || start === to) return
    if (reducedMotion()) {
      from.current = to
      el.setAttribute('d', shape(to))
      return
    }
    const t0 = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / MORPH_MS)
      const e = easeOutBack(k)
      const cur = start.map((v, i) => v + ((to[i] ?? v) - v) * e)
      el.setAttribute('d', shape(cur))
      from.current = k < 1 ? cur : to
      if (k < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing])
  return { path, initial }
}

// One voice note plays at a time, like a chat thread: starting another stops the current one.
let active: { stop: () => void } | null = null

export interface VoiceNoteProps {
  /** Audio file. Without it the bar runs on a clock for `duration` (gallery and demos). */
  src?: string
  /** Seconds; replaced by the file's own length once its metadata loads. */
  duration?: number
  /** Picks the generated waveform; defaults to `src`. */
  seed?: string
  /** Accessible name of the whole bar. */
  label?: string
  size?: 'md' | 'lg'
  className?: string
  onPlayingChange?: (playing: boolean) => void
  onEnded?: () => void
  onError?: () => void
}

/**
 * A voice / audio bar: the play control morphs into pause, the waveform fills from the left, and an accent glow drifts
 * behind the bar while it plays. Drag or use the arrow keys on the waveform to seek; press the time to change speed.
 */
export function VoiceNote({
  src,
  duration: hint = 0,
  seed,
  label,
  size = 'md',
  className,
  onPlayingChange,
  onEnded,
  onError,
}: VoiceNoteProps) {
  const root = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [length, setLength] = useState(hint)
  const [playing, setPlaying] = useState(false)
  const [sec, setSec] = useState(0)
  const [rate, setRate] = useState(1)
  const [scrubbing, setScrubbing] = useState(false)
  // Clock mode: position when last (re)started and the timestamp it started at.
  const clock = useRef({ at: 0, since: 0 })
  const state = useRef({ playing, rate, length })
  state.current = { playing, rate, length }
  const { path, initial } = useMorph(playing)
  const track = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(size === 'lg' ? 56 : 32)
  const bars = waveform(seed ?? src ?? String(hint), count)

  // As many bars as fit the track at one bar per pitch, so a narrow bubble never pushes the bars over the time.
  useEffect(() => {
    const el = track.current
    if (!el) return
    const pitch = size === 'lg' ? 6 : 5
    const measure = () => {
      if (el.clientWidth > 0) setCount(Math.max(8, Math.floor((el.clientWidth + pitch / 2) / pitch)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size])

  const now = () => {
    if (audio.current) return audio.current.currentTime
    const c = clock.current
    return state.current.playing ? c.at + ((performance.now() - c.since) / 1000) * state.current.rate : c.at
  }
  const paint = (time: number) => {
    const len = state.current.length
    root.current?.style.setProperty('--voice-progress', String(len > 0 ? Math.min(1, time / len) : 0))
    setSec(Math.floor(time))
  }
  const changed = (p: boolean) => {
    if (state.current.playing === p) return
    state.current.playing = p
    setPlaying(p)
    onPlayingChange?.(p)
  }

  const self = useRef({ stop: () => {} })
  const stop = () => {
    if (audio.current) audio.current.pause()
    else if (state.current.playing) {
      clock.current.at = now()
      changed(false)
    }
  }
  self.current.stop = stop
  const start = () => {
    if (active && active !== self.current) active.stop()
    active = self.current
    if (audio.current) {
      // Load failures arrive through onError; the promise also rejects (AbortError) when paused before it starts.
      void audio.current.play().catch(() => {})
      return
    }
    if (clock.current.at >= state.current.length) clock.current.at = 0
    clock.current.since = performance.now()
    changed(true)
  }
  const finish = () => {
    if (audio.current) audio.current.currentTime = 0
    clock.current.at = 0
    paint(0)
    changed(false)
    onEnded?.()
  }

  useEffect(() => {
    const me = self.current
    return () => {
      if (active === me) active = null
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the loop reads live values through refs
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const time = now()
      if (!audio.current && time >= state.current.length) return finish()
      paint(time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const seek = (time: number) => {
    const to = Math.max(0, Math.min(state.current.length, time))
    if (audio.current) audio.current.currentTime = to
    clock.current = { at: to, since: performance.now() }
    paint(to)
  }
  const seekAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width > 0) seek(((e.clientX - box.left) / box.width) * state.current.length)
  }
  const onKey = (e: KeyboardEvent) => {
    const to = {
      ArrowRight: sec + STEP,
      ArrowUp: sec + STEP,
      ArrowLeft: sec - STEP,
      ArrowDown: sec - STEP,
      Home: 0,
    }[e.key]
    if (e.key === 'End') seek(length)
    else if (to !== undefined) seek(to)
    else return
    e.preventDefault()
  }
  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1
    if (audio.current) audio.current.playbackRate = next
    clock.current = { at: now(), since: performance.now() }
    setRate(next)
  }

  const shown = playing || sec > 0 ? sec : length
  const wave = (
    <span className="ui-voice__bars">
      {bars.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: bars are a fixed, positional list
        <i key={i} style={{ height: `${Math.round(h * 100)}%` }} />
      ))}
    </span>
  )

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would style and behave as a form part
    <div
      ref={root}
      role="group"
      aria-label={label}
      className={cx('ui-voice', `ui-voice--${size}`, className)}
      data-playing={playing}
      data-scrubbing={scrubbing || undefined}
    >
      <span className="ui-voice__glow" aria-hidden="true">
        <span>
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
      <button
        type="button"
        className="ui-voice__play"
        aria-label={playing ? t('暂停') : t('播放语音')}
        aria-pressed={playing}
        onClick={() => (playing ? stop() : start())}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path ref={path} d={initial} />
        </svg>
      </button>
      <div
        ref={track}
        className="ui-voice__track"
        role="slider"
        tabIndex={0}
        aria-label={t('播放进度')}
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={sec}
        aria-valuetext={`${fmtClock(sec)} / ${fmtClock(length)}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId)
          setScrubbing(true)
          seekAt(e)
        }}
        onPointerMove={(e) => {
          if (scrubbing) seekAt(e)
        }}
        onPointerUp={() => setScrubbing(false)}
        onPointerCancel={() => setScrubbing(false)}
      >
        {wave}
        <span className="ui-voice__fill" aria-hidden="true">
          {wave}
        </span>
      </div>
      <button
        type="button"
        className="ui-voice__time"
        aria-label={t('播放速度 {rate}×', { rate })}
        title={t('播放速度')}
        onClick={cycleRate}
      >
        {rate !== 1 && <span className="ui-voice__rate">{`${rate}×`}</span>}
        {fmtClock(shown)}
      </button>
      {src && (
        // biome-ignore lint/a11y/useMediaCaption: voice notes and uploaded audio carry no caption track
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setLength(d)
          }}
          onPlay={() => changed(true)}
          onPause={() => changed(false)}
          onEnded={finish}
          onError={onError}
        />
      )}
    </div>
  )
}
