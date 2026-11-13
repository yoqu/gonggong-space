import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import './video-player.css'

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SEEK = 5
const JUMP = 10
const IDLE_MS = 2500
const STORE = 'gg.video'

const GLYPH = {
  play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z',
  pause:
    'M7 5h3.2a.8.8 0 0 1 .8.8v12.4a.8.8 0 0 1-.8.8H7a.8.8 0 0 1-.8-.8V5.8A.8.8 0 0 1 7 5Zm6.8 0H17a.8.8 0 0 1 .8.8v12.4a.8.8 0 0 1-.8.8h-3.2a.8.8 0 0 1-.8-.8V5.8a.8.8 0 0 1 .8-.8Z',
  replay:
    'M12 5V2.5a.5.5 0 0 0-.85-.35L7.7 5.6a.5.5 0 0 0 0 .7l3.45 3.45A.5.5 0 0 0 12 9.4V7a5.5 5.5 0 1 1-5.5 5.5 1 1 0 1 0-2 0A7.5 7.5 0 1 0 12 5Z',
  volume:
    'M4 9.5h3.2L11.4 5.7a.6.6 0 0 1 1 .45v11.7a.6.6 0 0 1-1 .45L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm11.1-1.9a1 1 0 0 1 1.4 0 6.3 6.3 0 0 1 0 8.8 1 1 0 0 1-1.4-1.4 4.3 4.3 0 0 0 0-6 1 1 0 0 1 0-1.4Zm2.8-2.8a1 1 0 0 1 1.4 0 10.3 10.3 0 0 1 0 14.4 1 1 0 0 1-1.4-1.4 8.3 8.3 0 0 0 0-11.6 1 1 0 0 1 0-1.4Z',
  low: 'M4 9.5h3.2L11.4 5.7a.6.6 0 0 1 1 .45v11.7a.6.6 0 0 1-1 .45L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm11.1-1.9a1 1 0 0 1 1.4 0 6.3 6.3 0 0 1 0 8.8 1 1 0 0 1-1.4-1.4 4.3 4.3 0 0 0 0-6 1 1 0 0 1 0-1.4Z',
  muted:
    'M4 9.5h3.2L11.4 5.7a.6.6 0 0 1 1 .45v11.7a.6.6 0 0 1-1 .45L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm11.3-.2a1 1 0 0 1 1.4 0l1.8 1.8 1.8-1.8a1 1 0 1 1 1.4 1.4L19.9 12.5l1.8 1.8a1 1 0 0 1-1.4 1.4l-1.8-1.8-1.8 1.8a1 1 0 0 1-1.4-1.4l1.8-1.8-1.8-1.8a1 1 0 0 1 0-1.4Z',
  enter:
    'M4 9V5a1 1 0 0 1 1-1h4a1 1 0 0 1 0 2H6v3a1 1 0 0 1-2 0Zm11-5h4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V6h-3a1 1 0 1 1 0-2ZM5 14a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm14 0a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 1 1 0-2h3v-3a1 1 0 0 1 1-1Z',
  exit: 'M9 4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1 0-2h3V5a1 1 0 0 1 1-1Zm6 0a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM4 15a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-3H5a1 1 0 0 1-1-1Zm10 0a1 1 0 0 1 1-1h4a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-4Z',
  pip: 'M4 5h16a2 2 0 0 1 2 2v4a1 1 0 1 1-2 0V7H4v10h6a1 1 0 1 1 0 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm10 8h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z',
  back: 'M12 5V2.5a.5.5 0 0 0-.85-.35L7.7 5.6a.5.5 0 0 0 0 .7l3.45 3.45A.5.5 0 0 0 12 9.4V7a5.5 5.5 0 1 1-5.5 5.5 1 1 0 1 0-2 0A7.5 7.5 0 1 0 12 5Z',
  forward:
    'M12 5V2.5a.5.5 0 0 1 .85-.35l3.45 3.45a.5.5 0 0 1 0 .7l-3.45 3.45A.5.5 0 0 1 12 9.4V7a5.5 5.5 0 1 0 5.5 5.5 1 1 0 1 1 2 0A7.5 7.5 0 1 1 12 5Z',
} as const

function Glyph({ d, size = 20 }: { d: keyof typeof GLYPH; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d={GLYPH[d]} />
    </svg>
  )
}

/** `m:ss`, or `h:mm:ss` once the video runs an hour. */
export const fmtVideoTime = (s: number, long = s >= 3600) => {
  const v = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0))
  const ss = String(v % 60).padStart(2, '0')
  if (!long) return `${Math.floor(v / 60)}:${ss}`
  return `${Math.floor(v / 3600)}:${String(Math.floor(v / 60) % 60).padStart(2, '0')}:${ss}`
}

interface Prefs {
  volume: number
  muted: boolean
}
const readPrefs = (): Prefs => {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Prefs>
    return {
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 1,
      muted: p.muted === true,
    }
  } catch {
    return { volume: 1, muted: false }
  }
}

type FullscreenTarget = HTMLElement & { webkitRequestFullscreen?: () => void }
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

// One video plays at a time across the page: starting another pauses the current one.
let active: HTMLVideoElement | null = null

export interface VideoPlayerProps {
  src: string
  /** The file name: names the player and its big play button. */
  label?: string
  autoPlay?: boolean
  /** Shown over the first frame until the first play (a chat thumbnail's caption); the control bar waits until then. */
  cover?: ReactNode
  /** How the first frame fills the box before playing; the playing picture is always letterboxed. */
  fit?: 'contain' | 'cover'
  /** Extra buttons in the top-right corner; they fade with the controls. */
  actions?: ReactNode
  className?: string
  onStart?: () => void
  onLoadedMetadata?: (video: HTMLVideoElement) => void
  onError?: () => void
}

/**
 * A video player in the design system's own controls: a big play button, a scrubbable progress bar with buffered
 * range and hover time, volume, speed, picture-in-picture and fullscreen. Controls hide while it plays and the
 * pointer rests; YouTube-style keys work while it has focus (Space/K, ←/→, J/L, ↑/↓, M, F, 0–9, Shift+</>).
 */
export function VideoPlayer({
  src,
  label,
  autoPlay,
  cover,
  fit = 'contain',
  actions,
  className,
  onStart,
  onLoadedMetadata,
  onError,
}: VideoPlayerProps) {
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [duration, setDuration] = useState(0)
  const [sec, setSec] = useState(0)
  const [prefs, setPrefs] = useState(readPrefs)
  const [rate, setRate] = useState(1)
  const [menu, setMenu] = useState(false)
  const [full, setFull] = useState(false)
  const [pip, setPip] = useState(false)
  const [idle, setIdle] = useState(false)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [flash, setFlash] = useState<{ text: string; n: number } | null>(null)
  const idleTimer = useRef(0)
  const lastPointer = useRef('mouse')
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled === true

  useLayoutEffect(() => {
    const v = video.current
    if (!v) return
    v.volume = prefs.volume
    v.muted = prefs.muted
  }, [prefs])

  const paint = () => {
    const v = video.current
    const el = root.current
    if (!v || !el) return
    const len = Number.isFinite(v.duration) ? v.duration : 0
    el.style.setProperty('--video-progress', String(len > 0 ? Math.min(1, v.currentTime / len) : 0))
    const b = v.buffered
    let end = 0
    for (let i = 0; i < (b?.length ?? 0); i++)
      if (b.start(i) <= v.currentTime + 0.5) end = Math.max(end, b.end(i))
    el.style.setProperty('--video-buffered', String(len > 0 ? Math.min(1, end / len) : 0))
    setSec(Math.floor(v.currentTime))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the loop reads the element, not render state
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      paint()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  useEffect(() => {
    if (!menu) return
    const close = (e: globalThis.PointerEvent) => {
      if (!(e.target as Element).closest?.('.ui-video__rate')) setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    const v = video.current
    const onPip = () => setPip(document.pictureInPictureElement === v)
    v?.addEventListener('enterpictureinpicture', onPip)
    v?.addEventListener('leavepictureinpicture', onPip)
    return () => {
      v?.removeEventListener('enterpictureinpicture', onPip)
      v?.removeEventListener('leavepictureinpicture', onPip)
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
      if (active === v) active = null
      window.clearTimeout(idleTimer.current)
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new source autoplays again
  useEffect(() => {
    if (autoPlay) void video.current?.play()?.catch(() => {})
  }, [src])

  const wake = () => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
  }

  const toggle = () => {
    const v = video.current
    if (!v) return
    // Within the gesture itself: iOS only lets a tap start playback with sound.
    if (v.paused || v.ended) void v.play()?.catch(() => {})
    else v.pause()
  }
  const seek = (to: number) => {
    const v = video.current
    if (!v) return
    const len = Number.isFinite(v.duration) ? v.duration : 0
    v.currentTime = Math.max(0, len > 0 ? Math.min(len, to) : to)
    paint()
  }
  const show = (text: string) => setFlash((f) => ({ text, n: (f?.n ?? 0) + 1 }))
  const setVolume = (volume: number, muted = volume === 0) => {
    const next = { volume: Math.round(Math.min(1, Math.max(0, volume)) * 100) / 100, muted }
    setPrefs(next)
    try {
      localStorage.setItem(STORE, JSON.stringify(next))
    } catch {}
    return next
  }
  const toggleMute = () =>
    setVolume(prefs.muted || prefs.volume === 0 ? prefs.volume || 1 : prefs.volume, !prefs.muted)
  const pickRate = (r: number) => {
    if (video.current) video.current.playbackRate = r
    setRate(r)
    setMenu(false)
  }
  const fullscreen = () => {
    const el = root.current as FullscreenTarget | null
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => {})
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
    // iPhone only lets the video element itself go fullscreen.
    else (video.current as IosVideo | null)?.webkitEnterFullscreen?.()
  }
  const togglePip = () => {
    const v = video.current
    if (!v) return
    if (document.pictureInPictureElement === v) void document.exitPictureInPicture()
    else void v.requestPictureInPicture?.().catch(() => {})
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const v = video.current
    if (!v) return
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' && e.key.startsWith('Arrow')) return
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const len = Number.isFinite(v.duration) ? v.duration : 0
    if (k === ' ' || k === 'k') toggle()
    else if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'l' || k === 'j') {
      const step = (k === 'l' || k === 'j' ? JUMP : SEEK) * (k === 'ArrowRight' || k === 'l' ? 1 : -1)
      seek(v.currentTime + step)
      show(step > 0 ? t('快进 {n} 秒', { n: step }) : t('快退 {n} 秒', { n: -step }))
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      const next = setVolume(prefs.volume + (k === 'ArrowUp' ? 0.1 : -0.1))
      show(t('音量 {n}%', { n: Math.round(next.volume * 100) }))
    } else if (k === 'm') toggleMute()
    else if (k === 'f') fullscreen()
    else if (k === 'Home') seek(0)
    else if (k === 'End') seek(len)
    else if (/^[0-9]$/.test(k)) seek((len * Number(k)) / 10)
    else if (k === '>' || k === '<') {
      const i = RATES.indexOf(rate) + (k === '>' ? 1 : -1)
      const next = RATES[Math.min(RATES.length - 1, Math.max(0, i))] ?? 1
      pickRate(next)
      show(`${next}×`)
    } else if (k === 'Escape' && menu) setMenu(false)
    else return
    e.preventDefault()
    wake()
  }

  const timeAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return null
    const k = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    return { x: k * box.width, time: k * duration }
  }

  const long = duration >= 3600
  const shownVolume = prefs.muted ? 0 : prefs.volume
  const bigLabel = ended ? t('重新播放') : label ? t('播放 {name}', { name: label }) : t('播放')
  const showBar = !cover || started

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would style and behave as a form part
    <div
      ref={root}
      role="group"
      aria-label={label ?? t('视频播放器')}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the player takes keyboard shortcuts while focused
      tabIndex={0}
      className={cx('ui-video', className)}
      data-fit={started ? 'contain' : fit}
      data-playing={playing}
      data-started={started || undefined}
      data-idle={(playing && idle && !menu && !scrubbing) || undefined}
      data-fullscreen={full || undefined}
      onKeyDown={onKey}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') wake()
      }}
      onPointerLeave={() => playing && setIdle(true)}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: workspace and uploaded videos carry no caption track */}
      <video
        ref={video}
        src={src}
        preload="metadata"
        playsInline
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType
        }}
        onClick={() => {
          // A tap on hidden controls brings them back instead of pausing.
          if (lastPointer.current === 'touch' && idle && playing) wake()
          else toggle()
        }}
        onDoubleClick={fullscreen}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          setDuration(Number.isFinite(v.duration) ? v.duration : 0)
          v.playbackRate = rate
          paint()
          onLoadedMetadata?.(v)
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d)) setDuration(d)
        }}
        onPlay={(e) => {
          const v = e.currentTarget
          if (active && active !== v) active.pause()
          active = v
          setPlaying(true)
          setEnded(false)
          if (!started) {
            setStarted(true)
            onStart?.()
          }
          wake()
        }}
        onPause={() => {
          setPlaying(false)
          setIdle(false)
        }}
        onEnded={() => {
          setPlaying(false)
          setEnded(true)
          setIdle(false)
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={paint}
        onProgress={paint}
        onSeeked={paint}
        onError={onError}
      />

      {waiting && playing && <span className="ui-video__spinner" aria-hidden="true" />}

      {flash && (
        <span key={flash.n} className="ui-video__flash" aria-live="polite">
          {flash.text}
        </span>
      )}

      {(!started || ended) && (
        <button
          type="button"
          className="ui-video__big"
          aria-label={bigLabel}
          title={bigLabel}
          onClick={toggle}
        >
          <Glyph d={ended ? 'replay' : 'play'} size={ended ? 26 : 28} />
        </button>
      )}

      {!started && cover}

      {actions && <div className="ui-video__actions">{actions}</div>}

      {showBar && (
        <div className="ui-video__chrome">
          <div
            className="ui-video__progress"
            role="slider"
            tabIndex={0}
            aria-label={t('播放进度')}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.floor(sec)}
            aria-valuetext={`${fmtVideoTime(sec, long)} / ${fmtVideoTime(duration, long)}`}
            data-scrubbing={scrubbing || undefined}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setScrubbing(true)
              const at = timeAt(e)
              if (at) seek(at.time)
            }}
            onPointerMove={(e) => {
              const at = timeAt(e)
              setHover(at)
              if (scrubbing && at) seek(at.time)
            }}
            onPointerUp={() => setScrubbing(false)}
            onPointerCancel={() => setScrubbing(false)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="ui-video__rail" aria-hidden="true">
              <span className="ui-video__buffered" />
              <span className="ui-video__played" />
              <span className="ui-video__thumb" />
            </span>
            {hover && duration > 0 && (
              <span className="ui-video__tip" style={{ left: hover.x }} aria-hidden="true">
                {fmtVideoTime(hover.time, long)}
              </span>
            )}
          </div>

          <div className="ui-video__bar">
            <button
              type="button"
              className="ui-video__btn"
              aria-label={playing ? t('暂停') : t('播放')}
              title={playing ? t('暂停 (K)') : t('播放 (K)')}
              onClick={toggle}
            >
              <Glyph d={playing ? 'pause' : 'play'} />
            </button>
            <button
              type="button"
              className="ui-video__btn ui-video__btn--skip"
              aria-label={t('快退 {n} 秒', { n: JUMP })}
              title={t('快退 {n} 秒', { n: JUMP })}
              onClick={() => seek((video.current?.currentTime ?? 0) - JUMP)}
            >
              <Glyph d="back" />
              <b>{JUMP}</b>
            </button>
            <button
              type="button"
              className="ui-video__btn ui-video__btn--skip"
              aria-label={t('快进 {n} 秒', { n: JUMP })}
              title={t('快进 {n} 秒', { n: JUMP })}
              onClick={() => seek((video.current?.currentTime ?? 0) + JUMP)}
            >
              <Glyph d="forward" />
              <b>{JUMP}</b>
            </button>

            <div className="ui-video__volume">
              <button
                type="button"
                className="ui-video__btn"
                aria-label={shownVolume === 0 ? t('取消静音') : t('静音')}
                title={shownVolume === 0 ? t('取消静音 (M)') : t('静音 (M)')}
                onClick={toggleMute}
              >
                <Glyph d={shownVolume === 0 ? 'muted' : shownVolume < 0.5 ? 'low' : 'volume'} />
              </button>
              <input
                type="range"
                className="ui-video__slider"
                aria-label={t('音量')}
                min={0}
                max={1}
                step={0.05}
                value={shownVolume}
                style={{ '--video-volume': shownVolume } as CSSProperties}
                onChange={(e) => setVolume(Number(e.currentTarget.value))}
              />
            </div>

            <span className="ui-video__time">
              <span>{fmtVideoTime(sec, long)}</span>
              <span className="ui-video__sep">/</span>
              <span>{fmtVideoTime(duration, long)}</span>
            </span>

            <span className="ui-video__spacer" />

            <div className="ui-video__rate">
              <button
                type="button"
                className="ui-video__btn ui-video__btn--text"
                aria-label={t('播放速度')}
                aria-haspopup="menu"
                aria-expanded={menu}
                title={t('播放速度')}
                onClick={() => setMenu((m) => !m)}
              >
                {rate === 1 ? t('倍速') : `${rate}×`}
              </button>
              {menu && (
                <div className="ui-video__menu" role="menu" aria-label={t('播放速度')}>
                  {RATES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="menuitemradio"
                      aria-checked={r === rate}
                      className="ui-video__item"
                      onClick={() => pickRate(r)}
                    >
                      {`${r}×`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {pipSupported && (
              <button
                type="button"
                className="ui-video__btn ui-video__pip"
                aria-label={pip ? t('退出画中画') : t('画中画')}
                aria-pressed={pip}
                title={pip ? t('退出画中画') : t('画中画')}
                onClick={togglePip}
              >
                <Glyph d="pip" />
              </button>
            )}
            <button
              type="button"
              className="ui-video__btn"
              aria-label={full ? t('退出全屏') : t('全屏')}
              title={full ? t('退出全屏 (F)') : t('全屏 (F)')}
              onClick={fullscreen}
            >
              <Glyph d={full ? 'exit' : 'enter'} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
