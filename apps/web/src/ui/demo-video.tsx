import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { Icon } from './icon'
import './demo-video.css'

export interface DemoVideoSource {
  src: string
  poster: string
}

type Theme = 'light' | 'dark'
const themeOf = (): Theme => (document.documentElement.dataset.theme?.endsWith('dark') ? 'dark' : 'light')

function useTheme() {
  const [theme, setTheme] = useState(themeOf)
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(themeOf()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return theme
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A silent product demo. `autoPlay` loops it while on screen; otherwise it waits for a click. The file is fetched only
 * once the video is near the viewport, follows the light/dark theme, and with reduced motion only the poster shows.
 */
export function DemoVideo({
  sources,
  label,
  autoPlay,
  className,
}: {
  sources: Record<Theme, DemoVideoSource>
  label: string
  autoPlay?: boolean
  className?: string
}) {
  const theme = useTheme()
  const { src, poster } = sources[theme]
  const ref = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [reduced] = useState(reducedMotion)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: '200px' })
    io.observe(v)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (autoPlay && visible) setLoaded(true)
  }, [autoPlay, visible])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new src (theme switch) restarts playback too
  useEffect(() => {
    const v = ref.current
    if (!v || !loaded) return
    if (autoPlay ? visible : visible && playing) void v.play().catch(() => setPlaying(false))
    else v.pause()
  }, [autoPlay, visible, playing, loaded, src])

  if (reduced)
    return (
      <span className={cx('ui-demo', className)}>
        <img className="ui-demo__media" src={poster} alt={label} />
      </span>
    )
  return (
    <span className={cx('ui-demo', className)} data-playing={playing || undefined}>
      <video
        ref={ref}
        className="ui-demo__media"
        src={loaded ? src : undefined}
        poster={poster}
        muted
        loop={!!autoPlay}
        playsInline
        preload="none"
        aria-label={label}
        onEnded={() => setPlaying(false)}
      />
      {autoPlay ? null : (
        <button
          type="button"
          className="ui-demo__toggle"
          aria-label={playing ? t('暂停演示') : t('播放演示')}
          onClick={() => {
            setLoaded(true)
            setPlaying((p) => !p)
          }}
        >
          {playing ? null : (
            <span className="ui-demo__play">
              <Icon name="play" size={22} />
            </span>
          )}
        </button>
      )}
    </span>
  )
}
