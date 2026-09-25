import { ChevronLeft } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, type ReactNode, useState } from 'react'
import { cx } from '../lib/cx'
import { Toolbar } from '../ui'
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

export type RailKind = 'run' | 'preview'

const RAIL_DEFAULT: Record<RailKind, number> = { run: 320, preview: 440 }
const RAIL_MIN_WIDTH = 280
const RAIL_MAX_SHARE = 0.6
const RAIL_STEP = 16
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

export function ChatLayout({
  sidebar,
  children,
  rail,
  railOpen = false,
  railKind = 'run',
  mobileView,
}: {
  sidebar: ReactNode
  children: ReactNode
  rail?: ReactNode
  railOpen?: boolean
  railKind?: RailKind
  /** Under 768px only one column is shown. */
  mobileView: 'list' | 'chat'
}) {
  const mobile = useViewportWidth() < MOBILE_MAX
  const resize = useRailWidth(railKind)
  return (
    <div className="chat">
      {!mobile || mobileView === 'list' ? (
        <nav aria-label="会话列表" className="chat__sidebar">
          {sidebar}
        </nav>
      ) : null}
      {!mobile || mobileView === 'chat' ? <main className="chat__center">{children}</main> : null}
      {rail && railOpen ? (
        <aside
          aria-label="侧栏"
          className={cx('chat__rail', mobile && 'chat__rail--overlay')}
          style={mobile ? undefined : { width: resize.width }}
        >
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
        </aside>
      ) : null}
    </div>
  )
}

export function ChatHeader({
  title,
  badge,
  subtitle,
  subtitleTitle,
  actions,
  onBack,
  scrolled,
}: {
  title: ReactNode
  badge?: ReactNode
  subtitle?: ReactNode
  /** Full text behind a shortened subtitle (e.g. the repo URL). */
  subtitleTitle?: string
  actions?: ReactNode
  onBack?: () => void
  /** The timeline has scrolled under the header. */
  scrolled: boolean
}) {
  return (
    <Toolbar className="chat-header" scrolled={scrolled}>
      {onBack ? (
        <button type="button" className="chat-header__back" aria-label="返回" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
      ) : null}
      <div className="chat-header__main">
        <div className="chat-header__line">
          <h1 className="chat-header__title">{title}</h1>
          {badge}
        </div>
        {subtitle ? (
          <div className="chat-header__sub" title={subtitleTitle}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions ? <div className="chat-header__actions">{actions}</div> : null}
    </Toolbar>
  )
}

export function Timeline({ children }: { children: ReactNode }) {
  return <div className="timeline">{children}</div>
}
