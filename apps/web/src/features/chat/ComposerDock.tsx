import { type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FloatingChat } from '../../app/floatingChat'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Icon } from '../../ui'
import './composer-dock.css'

type Phase = 'open' | 'opening' | 'closing' | 'closed'
const KEY = 'gg.composerDock.hidden'
const ORB = 44

/** A spring token as WAAPI timing: `--spring-bouncy: 558ms linear(…)`; 0 under reduced motion. */
function spring(name: string): { duration: number; easing: string } {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^([\d.]+)(ms|s)\s+(.+)$/.exec(v)
  if (!m) return { duration: 0, easing: 'linear' }
  return { duration: Number(m[1]) * (m[2] === 's' ? 1000 : 1), easing: m[3] ?? 'linear' }
}

const stored = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The composer's place. Normally it stays in the chat column (layout-neutral); while the workbench is 全屏 it floats
 * over the workbench as a glass bar, and hides into a glass orb that grows back like a drop of liquid (⌘J both ways).
 */
export function ComposerDock({ children }: { children: ReactNode }) {
  const floating = useContext(FloatingChat)
  const [phase, setPhase] = useState<Phase>(() => (stored() ? 'closed' : 'open'))
  const [at, setAt] = useState<{ left: number; width: number; bottom: number } | null>(null)
  const shell = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const from = useRef<{ w: number; h: number } | null>(null)

  // Over the workbench: centred on it, clear of its edges.
  useLayoutEffect(() => {
    if (!floating) return
    const bench = document.querySelector<HTMLElement>('.bench')
    if (!bench) return
    const place = () => {
      const r = bench.getBoundingClientRect()
      setAt({
        left: r.left + 24,
        width: Math.max(r.width - 48, 0),
        bottom: window.innerHeight - r.bottom + 16,
      })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(bench)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [floating])

  const persist = (hidden: boolean) => {
    try {
      localStorage.setItem(KEY, hidden ? '1' : '0')
    } catch {
      // Storage unavailable: the choice lasts for this page.
    }
  }

  const toggle = () => {
    const s = shell.current
    if (phase === 'opening' || phase === 'closing' || !s) return
    if (phase === 'closed') {
      persist(false)
      return setPhase('opening')
    }
    persist(true)
    const { duration } = spring('--spring-smooth')
    if (!duration || typeof s.animate !== 'function') return setPhase('closed')
    const r = s.getBoundingClientRect()
    from.current = { w: r.width, h: r.height }
    // The focus ring would ride the shrinking drop down to the orb.
    if (s.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    setPhase('closing')
  }

  // Grow (orb → stretch up like a drop → bar) and shrink (bar → narrow drop → orb), measured before paint.
  useLayoutEffect(() => {
    const s = shell.current
    const b = body.current
    if (!s || !b) return
    if (phase === 'opening') {
      const { duration, easing } = spring('--spring-bouncy')
      const r = s.getBoundingClientRect()
      if (!duration || typeof s.animate !== 'function') return setPhase('open')
      const radius = getComputedStyle(s).borderTopLeftRadius
      const grow = s.animate(
        [
          { width: `${ORB}px`, height: `${ORB}px`, borderRadius: `${ORB / 2}px`, transform: 'translateY(0)' },
          {
            offset: 0.2,
            width: `${ORB - 6}px`,
            height: `${ORB + 18}px`,
            borderRadius: `${ORB / 2}px`,
            transform: 'translateY(-8px)',
          },
          {
            offset: 0.5,
            width: `${Math.max(r.width * 0.5, ORB)}px`,
            height: `${r.height}px`,
            borderRadius: radius,
            transform: 'translateY(-3px)',
          },
          {
            width: `${r.width}px`,
            height: `${r.height}px`,
            borderRadius: radius,
            transform: 'translateY(0)',
          },
        ],
        { duration: duration * 1.1, easing },
      )
      b.animate(
        [
          { opacity: 0, filter: 'blur(8px)', transform: 'translateY(8px) scale(0.98)' },
          { opacity: 1, filter: 'blur(0)', transform: 'none' },
        ],
        { duration: duration * 0.55, delay: duration * 0.35, easing, fill: 'backwards' },
      )
      grow.onfinish = () => {
        setPhase('open')
        b.querySelector('textarea')?.focus()
      }
      return
    }
    if (phase === 'closing' && from.current) {
      const { duration, easing } = spring('--spring-smooth')
      const { w, h } = from.current
      const radius = getComputedStyle(s).borderTopLeftRadius
      b.animate(
        [
          { opacity: 1, filter: 'blur(0)' },
          { opacity: 0, filter: 'blur(6px)' },
        ],
        {
          duration: duration * 0.3,
          easing: 'ease-out',
          fill: 'forwards',
        },
      )
      const shrink = s.animate(
        [
          { width: `${w}px`, height: `${h}px`, borderRadius: radius, transform: 'translateY(0)' },
          {
            offset: 0.45,
            width: `${Math.max(w * 0.35, ORB)}px`,
            height: `${Math.max(h * 0.8, ORB)}px`,
            borderRadius: radius,
            transform: 'translateY(0)',
          },
          {
            offset: 0.75,
            width: `${ORB - 6}px`,
            height: `${ORB + 14}px`,
            borderRadius: `${ORB / 2}px`,
            transform: 'translateY(-6px)',
          },
          { width: `${ORB}px`, height: `${ORB}px`, borderRadius: `${ORB / 2}px`, transform: 'translateY(0)' },
        ],
        { duration, easing, fill: 'forwards' },
      )
      shrink.onfinish = () => {
        setPhase('closed')
        shrink.cancel()
        for (const a of b.getAnimations()) a.cancel()
      }
    }
  }, [phase])

  // ⌘J hides and shows it while floating.
  useEffect(() => {
    if (!floating) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const closed = floating && phase === 'closed'
  return (
    <div
      className={cx('cdock', floating && 'cdock--float')}
      data-phase={floating ? phase : undefined}
      style={floating && at ? { left: at.left, width: at.width, bottom: at.bottom } : undefined}
    >
      <div ref={shell} className={cx('cdock__shell', closed && 'cdock__shell--orb')}>
        {floating && (phase === 'open' || phase === 'opening') ? (
          <button
            type="button"
            className="cdock__grip"
            aria-label={t('收起输入框')}
            title={t('收起输入框 ⌘J')}
            onClick={toggle}
          />
        ) : null}
        <div ref={body} className="cdock__body" hidden={closed} inert={closed || undefined}>
          {children}
        </div>
        {closed ? (
          <button
            type="button"
            className="cdock__orb"
            aria-label={t('展开输入框')}
            title={t('展开输入框 ⌘J')}
            onClick={toggle}
          >
            <Icon name="message" size={18} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
