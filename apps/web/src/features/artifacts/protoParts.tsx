import { type AnimationEvent, useCallback, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Icon, type IconName, Tooltip } from '../../ui'
import type { Enter, ProtoDevice, ProtoFrame, ProtoNav } from './prototype'

// Pieces of the prototype editor's stage (PrototypeEditor.tsx): the device's chrome, hotspots, the rail's buttons,
// the screen list and the screen change's two layers.

/** A thumbnail's width in the screen list (px). */
const THUMB_W = 188

/** The screen list: each screen's screenshot, or its live page scaled down when it has none yet. */
export function ScreenThumbs({
  screens,
  current,
  thumbOf,
  src,
  size,
  onPick,
}: {
  screens: { id: string; title: string; file: string }[]
  current: string
  thumbOf: (id: string) => string | undefined
  src: ((s: { id: string; file: string }) => string | undefined) | null
  size: { w: number; h: number }
  onPick: (id: string) => void
}) {
  return (
    <ul className="proto-screens__list">
      {screens.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className="proto-thumb"
            aria-current={s.id === current ? 'page' : undefined}
            onClick={() => s.id !== current && onPick(s.id)}
          >
            <span className="proto-thumb__shot">
              {thumbOf(s.id) ? (
                <img src={thumbOf(s.id)} alt={t('{title} 缩略图', { title: s.title })} loading="lazy" />
              ) : src ? (
                <iframe
                  title={t('{title} 缩略图', { title: s.title })}
                  src={src(s)}
                  tabIndex={-1}
                  loading="lazy"
                  style={{ width: size.w, height: size.h, transform: `scale(${THUMB_W / size.w})` }}
                />
              ) : null}
            </span>
            <span className="proto-thumb__title">{s.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * The phone's status bar (and a mini program's capsule) and home indicator, drawn over the screen like the
 * web-prototype kit's shell: screens leave `--gg-status-bar` free for it. Clicks go through to the screen.
 */
export function DeviceChrome({ frame, light }: { frame: ProtoFrame; light: boolean }) {
  return (
    <div
      className={cx('proto-chrome', light && 'proto-chrome--light')}
      data-testid="proto-chrome"
      aria-hidden="true"
    >
      <div className="proto-chrome__status" style={{ height: frame.status }}>
        <span>9:41</span>
        <svg width="68" height="12" viewBox="0 0 68 12" fill="currentColor" aria-hidden="true">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="6" width="3" height="6" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
          <path d="M30 3.2a8.6 8.6 0 0 1 11.6 0l-1.3 1.4a6.7 6.7 0 0 0-9 0zm2.6 2.8a4.8 4.8 0 0 1 6.4 0l-1.3 1.4a3 3 0 0 0-3.8 0zm3.2 2.4 1.5 1.6-1.5 1.6-1.5-1.6z" />
          <rect
            x="44.5"
            y="0.5"
            width="21"
            height="11"
            rx="3.2"
            fill="none"
            stroke="currentColor"
            opacity="0.4"
          />
          <rect x="46" y="2" width="18" height="8" rx="2" />
          <rect x="66.5" y="4" width="1.5" height="4" rx="0.7" opacity="0.4" />
        </svg>
      </div>
      {frame.capsule ? (
        <div className="proto-chrome__capsule" data-testid="proto-capsule">
          <span>
            <svg width="20" height="6" viewBox="0 0 20 6" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="3" r="2.2" />
              <circle cx="10" cy="3" r="3" />
              <circle cx="17" cy="3" r="2.2" />
            </svg>
          </span>
          <i />
          <span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="7.2" />
              <circle cx="9" cy="9" r="2.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Room a hotspot tag takes above its element (prototype.css `.proto-hot__tag`: 15px line + 2px gap). */
const TAG_ROOM = 17

/**
 * A hotspot box in the screen's viewport coordinates; `tag` labels it in edit mode, outside the box so it covers none
 * of the element: above it, or below when the screen's top leaves no room.
 */
export function Hot({
  rect,
  tag,
  title,
  selected,
}: {
  rect: { x: number; y: number; w: number; h: number }
  tag: string | null
  title?: string
  selected?: boolean
}) {
  return (
    <div
      className={cx('proto-hot', selected && 'proto-hot--selected')}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      title={title}
    >
      {tag ? (
        <span className={cx('proto-hot__tag', rect.y < TAG_ROOM && 'proto-hot__tag--below')}>{tag}</span>
      ) : null}
    </div>
  )
}

export function RailButton({
  icon,
  label,
  shortcut,
  tip,
  on,
  onClick,
}: {
  icon: IconName
  label: string
  shortcut?: string
  tip: 'top' | 'left'
  on?: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip content={label} shortcut={shortcut} placement={tip}>
      <button
        type="button"
        className="art-tools__btn"
        aria-label={label}
        aria-pressed={on === undefined ? undefined : on}
        disabled={!onClick}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
      </button>
    </Tooltip>
  )
}

/** A screen on the stage: the current one, or the last one on its way out. */
export interface ScreenLayer {
  screen: string
  /** The nav step it came in on: its key, so the leaving one keeps its live page. */
  step: number
}

const stillMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Over the new screen when going back (it reveals the one under it), under it otherwise. */
const OVER: ReadonlySet<Enter> = new Set(['push-back', 'slide-down', 'fade'])

/**
 * A screen change in two layers, like a native stack: the last screen leaves while the new one comes in. The leaving
 * layer keeps its key, so it is the very page that was showing (scrolled where it was), not a reload; the new one shows
 * its screenshot until its page is ready (a frame loading is blank).
 */
export function useScreenSwap(
  nav: ProtoNav,
  screen: string,
  /** Bumped by a reload (R): the page loads again. */
  reload: number,
  scrollOf: (screen: string) => { x: number; y: number },
) {
  const [seen, setSeen] = useState({ step: nav.step, screen, depth: nav.stack.length, reload })
  const [leaving, setLeaving] = useState<(ScreenLayer & { enter: Enter }) | null>(null)
  const [loaded, setLoaded] = useState('')
  /** Each screen on the way's scroll, by its depth in the stack, kept for coming back to it. */
  const kept = useRef<Record<number, { x: number; y: number }>>({})
  /** Where the page loading now should come back to (`key`: its load), and whether it is hidden until it has. */
  const [restore, setRestore] = useState<{ key: string; at: { x: number; y: number } } | null>(null)
  const [hold, setHold] = useState<string | null>(null)
  const reveal = useCallback(() => setHold(null), [])
  const key = `${nav.step}:${reload}`
  if (seen.step === nav.step && seen.reload !== reload) {
    // A reload (R): the page comes back where it was.
    setSeen({ ...seen, reload })
    const at = scrollOf(screen)
    setRestore(at.x || at.y ? { key, at } : null)
  }
  if (seen.step !== nav.step) {
    const depth = nav.stack.length
    setSeen({ step: nav.step, screen, depth, reload })
    setLeaving(
      nav.enter === 'none' || seen.screen === screen || stillMotion()
        ? null
        : { step: seen.step, screen: seen.screen, enter: nav.enter },
    )
    if (depth > seen.depth) kept.current[seen.depth] = scrollOf(seen.screen)
    const back = depth < seen.depth ? kept.current[depth] : undefined
    setRestore(back && (back.x || back.y) ? { key, at: back } : null)
    for (const d of Object.keys(kept.current)) if (Number(d) >= depth) delete kept.current[Number(d)]
  }
  const current: ScreenLayer = { screen, step: nav.step }
  return {
    /** In paint order: the leaving screen (while it leaves), then the current one. */
    layers: leaving ? [leaving, current] : [current],
    /** The leaving layer's classes and its end. */
    leave: leaving && {
      className: cx(
        'proto-leave',
        `proto-leave--${leaving.enter}`,
        OVER.has(leaving.enter) && 'proto-leave--over',
      ),
      onAnimationEnd: (e: AnimationEvent<HTMLElement>) => {
        if (e.target === e.currentTarget && !e.pseudoElement) setLeaving(null)
      },
    },
    /** Whether the current screen's page (or its reload) has not said `ready` yet. */
    loading: loaded !== key,
    /** It comes back scrolled: its top's screenshot would show the wrong part meanwhile. */
    restoring: restore?.key === key || hold === key,
    /** Loaded, on its way back to where it was: hidden until it is there. */
    holding: hold === key,
    /** The current screen's page said `ready`: where to scroll it, coming back to it scrolled. */
    ready: () => {
      setLoaded(key)
      if (restore?.key !== key) return null
      setRestore(null)
      setHold(key)
      return restore.at
    },
    /** The page is where it was (it scrolled there, or it is time to show it anyway). */
    reveal,
  }
}

/** How long after a frame takes the focus the stage keeps its scroll against the browser bringing it into view (ms). */
const HOLD_SCROLL_MS = 600

/**
 * The zoomed stage's scroll: where it is (overlays placed in it follow), held where it was when a screen's frame takes
 * the focus (a click in it) and the browser would scroll the frame into view; the reader's own scrolling (wheel,
 * touch, scrollbar) is never held. `reveal` brings a rect of its box into view (between its paddings: clear of the
 * screen list and the panel).
 */
export function useStageScroll(stage: React.RefObject<HTMLElement | null>) {
  const [at, setAt] = useState({ x: 0, y: 0 })
  const last = useRef({ x: 0, y: 0 })
  const held = useRef<{ x: number; y: number; until: number } | null>(null)
  const release = () => {
    held.current = null
  }
  return {
    at,
    handlers: {
      onFocusCapture: (e: React.FocusEvent) => {
        if (e.target instanceof HTMLIFrameElement)
          held.current = { ...last.current, until: performance.now() + HOLD_SCROLL_MS }
      },
      onWheel: release,
      onTouchStart: release,
      onScroll: () => {
        const el = stage.current
        if (!el) return
        const h = held.current
        if (h && performance.now() < h.until && (el.scrollLeft !== h.x || el.scrollTop !== h.y)) {
          el.scrollLeft = h.x
          el.scrollTop = h.y
        }
        last.current = { x: el.scrollLeft, y: el.scrollTop }
        setAt(last.current)
      },
    },
    reveal: (
      r: { x: number; y: number; w: number; h: number },
      pad: { left: number; right: number; top: number; bottom: number },
    ) => {
      const el = stage.current
      if (!el) return
      held.current = null
      const near = (start: number, end: number, from: number, to: number) =>
        start >= from && end <= to
          ? 0
          : start < from || end - start > to - from
            ? start - from - 16
            : end - to + 16
      const dx = near(r.x, r.x + r.w, pad.left, el.clientWidth - pad.right)
      const dy = near(r.y, r.y + r.h, pad.top, el.clientHeight - pad.bottom)
      if (dx || dy) el.scrollBy({ left: dx, top: dy, behavior: stillMotion() ? 'instant' : 'smooth' })
    },
  }
}

/** 适应 (the whole device), 适应宽度 (its width; the stage scrolls), 100%. */
export type Zoom = 'fit' | 'width' | 'actual'
export const ZOOMS: Zoom[] = ['fit', 'width', 'actual']
export const ZOOM_LABEL: Record<Zoom, string> = { fit: t('适应'), width: t('适应宽度'), actual: '100%' }
/** Unmodified keys: ⌘0 / ⌘+ are the browser's own zoom. */
export const ZOOM_KEYS: Record<string, Zoom> = { '0': 'fit', '2': 'width', '1': 'actual' }
export const ZOOM_KEY_OF: Record<Zoom, string> = { fit: '0', width: '2', actual: '1' }

const ZOOM_KEY = 'gg.art.protoZoom.'
/** A desktop page fitted whole is too small to read (about 21% beside the panel): it opens fitted to its width. */
const savedZoom = (d: ProtoDevice): Zoom => {
  const z = localStorage.getItem(ZOOM_KEY + d)
  return ZOOMS.includes(z as Zoom) ? (z as Zoom) : d === 'desktop' ? 'width' : 'fit'
}
/** Each kind of device keeps the zoom it was last read at. */
export function useDeviceZoom(device: ProtoDevice) {
  const [zooms, setZooms] = useState<Partial<Record<ProtoDevice, Zoom>>>({})
  const set = useCallback(
    (z: Zoom) => {
      localStorage.setItem(ZOOM_KEY + device, z)
      setZooms((m) => ({ ...m, [device]: z }))
    },
    [device],
  )
  return [zooms[device] ?? savedZoom(device), set] as const
}

export const DEVICE_ICON: Record<ProtoDevice, IconName> = {
  mobile: 'smartphone',
  tablet: 'tablet',
  desktop: 'desktop',
}
export const DEVICE_LABEL: Record<ProtoDevice, string> = {
  mobile: t('手机'),
  tablet: t('平板'),
  desktop: t('桌面'),
}
