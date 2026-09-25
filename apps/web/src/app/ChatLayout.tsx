import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useState } from 'react'
import { cx } from '../lib/cx'
import { AppFrame } from '../ui'
import { MOBILE_MAX, RAIL_MIN, useViewportWidth } from './viewport'

/** Rail open state: defaults to open on wide screens and resets whenever the 1100px breakpoint is crossed. */
export function useRailOpen() {
  const narrow = useViewportWidth() < RAIL_MIN
  const [open, setOpen] = useState(!narrow)
  const [wasNarrow, setWasNarrow] = useState(narrow)
  if (narrow !== wasNarrow) {
    setWasNarrow(narrow)
    setOpen(!narrow)
  }
  return [open, setOpen] as const
}

export type RailKind = 'run' | 'preview' | 'info'

const RAIL_DEFAULT: Record<RailKind, number> = { run: 320, preview: 440, info: 320 }
const RAIL_MIN_WIDTH = 280
const RAIL_MAX_SHARE = 0.6
const RAIL_STEP = 16
const TOAST_GAP = 12
const railKey = (kind: RailKind) => `gonggong.railWidth.${kind}`

const storedWidth = (kind: RailKind) => {
  try {
    return Number(localStorage.getItem(railKey(kind))) || RAIL_DEFAULT[kind]
  } catch {
    return RAIL_DEFAULT[kind]
  }
}

/** Rail width per kind, dragged or arrowed on its left edge and kept in this browser. */
function useRailWidth(kind: RailKind) {
  const [widths, setWidths] = useState<Partial<Record<RailKind, number>>>({})
  const clamp = (w: number) =>
    Math.round(Math.min(Math.max(w, RAIL_MIN_WIDTH), window.innerWidth * RAIL_MAX_SHARE))
  const width = clamp(widths[kind] ?? storedWidth(kind))
  const set = (w: number) => {
    const next = clamp(w)
    setWidths((all) => ({ ...all, [kind]: next }))
    try {
      localStorage.setItem(railKey(kind), String(next))
    } catch {
      // storage unavailable (private mode): the width lasts for this page only
    }
  }
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    const from = e.clientX
    const start = width
    document.documentElement.dataset.resizing = ''
    const move = (ev: globalThis.PointerEvent) => set(start + from - ev.clientX)
    const up = () => {
      delete document.documentElement.dataset.resizing
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowLeft' ? RAIL_STEP : e.key === 'ArrowRight' ? -RAIL_STEP : 0
    if (!delta) return
    e.preventDefault()
    set(width + delta)
  }
  return { width, onPointerDown, onKeyDown }
}

/** Keeps toasts centred on the chat column and just above its composer so they never cover what is being typed. */
function useToastAboveComposer(main: HTMLElement | null) {
  useEffect(() => {
    if (!main) return
    const root = document.documentElement.style
    let composer: Element | null = null
    const place = () => {
      const box = main.getBoundingClientRect()
      const top = composer?.getBoundingClientRect().top ?? box.bottom - TOAST_GAP
      root.setProperty('--toast-bottom', `${Math.round(window.innerHeight - top + TOAST_GAP)}px`)
      root.setProperty('--toast-x', `${Math.round(box.left + box.width / 2)}px`)
    }
    const ro = new ResizeObserver(place)
    ro.observe(main)
    const find = () => {
      const next = main.querySelector('.pn-composer-wrap')
      if (next === composer) return
      if (composer) ro.unobserve(composer)
      composer = next
      if (next) ro.observe(next)
      place()
    }
    const mo = new MutationObserver(find)
    mo.observe(main, { childList: true, subtree: true })
    find()
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', place)
      root.removeProperty('--toast-bottom')
      root.removeProperty('--toast-x')
    }
  }, [main])
}

export function ChatLayout({
  sidebar,
  children,
  nav,
  rail,
  railOpen = false,
  railKind = 'run',
  mobileView,
}: {
  sidebar: ReactNode
  children: ReactNode
  /** App NavRail: a left column on wide windows, a bottom tab bar under the conversation list on phones. */
  nav?: (orientation: 'vertical' | 'horizontal') => ReactNode
  rail?: ReactNode
  railOpen?: boolean
  railKind?: RailKind
  /** Under 768px only one column is shown. */
  mobileView: 'list' | 'chat'
}) {
  const mobile = useViewportWidth() < MOBILE_MAX
  const resize = useRailWidth(railKind)
  const [main, setMain] = useState<HTMLElement | null>(null)
  useToastAboveComposer(main)
  const list = !mobile || mobileView === 'list'
  return (
    <AppFrame
      className={cx('chat', mobile && `chat--${mobileView}`)}
      rail={mobile ? undefined : nav?.('vertical')}
      sidebar={
        list ? (
          <>
            <nav aria-label="会话列表" className="chat__sidebar">
              {sidebar}
            </nav>
            {mobile ? nav?.('horizontal') : null}
          </>
        ) : undefined
      }
      inspector={
        rail && railOpen ? (
          <>
            {mobile ? null : (
              // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused and dragged; this is the ARIA window splitter pattern
              <div
                role="separator"
                aria-label="调整侧栏宽度"
                aria-orientation="vertical"
                aria-valuenow={resize.width}
                aria-valuemin={RAIL_MIN_WIDTH}
                tabIndex={0}
                className="chat__rail-handle"
                onPointerDown={resize.onPointerDown}
                onKeyDown={resize.onKeyDown}
              />
            )}
            {rail}
          </>
        ) : undefined
      }
      inspectorProps={{
        'aria-label': '侧栏',
        className: cx('chat__rail', mobile && 'chat__rail--overlay'),
        style: mobile ? undefined : { width: resize.width },
      }}
    >
      {!mobile || mobileView === 'chat' ? (
        <main ref={setMain} className="chat__center">
          {children}
        </main>
      ) : null}
    </AppFrame>
  )
}
