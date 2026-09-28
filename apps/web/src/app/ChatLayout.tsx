import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useState } from 'react'
import { cx } from '../lib/cx'
import { AppFrame } from '../ui'
import { useEscape } from '../ui/overlay'
import { MOBILE_MAX, RAIL_MIN, useViewportWidth } from './viewport'
import { useWorkbench, type WorkbenchMode } from './workbench'

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

export type RailKind = 'run' | 'info'

const RAIL_DEFAULT: Record<RailKind, number> = { run: 320, info: 320 }
const RAIL_MIN_WIDTH = 280
const RAIL_MAX_SHARE = 0.6
const CHAT_DEFAULT = 380
const CHAT_MIN = 320
const CHAT_MAX = 560
const STEP = 16
const TOAST_GAP = 12

const storedWidth = (key: string, fallback: number) => {
  try {
    return Number(localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}

/**
 * A column width dragged or arrowed on its splitter and kept in this browser under `key`.
 * `grow` is the pointer direction that widens it: -1 for a right-hand rail, 1 for a column left of the splitter.
 */
function useSplitWidth(key: string, fallback: number, min: number, max: number, grow: 1 | -1) {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, min), max))
  const width = clamp(widths[key] ?? storedWidth(key, fallback))
  const show = (w: number) => {
    const next = clamp(w)
    setWidths((all) => ({ ...all, [key]: next }))
    return next
  }
  const store = (w: number) => {
    try {
      localStorage.setItem(key, String(w))
    } catch {
      // storage unavailable (private mode): the width lasts for this page only
    }
  }
  const set = (w: number) => store(show(w))
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    e.preventDefault()
    // Keeps the move events coming while the pointer crosses the workbench's iframes.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const from = e.clientX
    const start = width
    let latest = width
    let frame = 0
    document.documentElement.dataset.resizing = ''
    // Pointer events can fire far faster than frames; re-laying out the chat once per frame keeps the edge on the pointer.
    const move = (ev: globalThis.PointerEvent) => {
      latest = clamp(start + grow * (ev.clientX - from))
      frame ||= requestAnimationFrame(() => {
        frame = 0
        show(latest)
      })
    }
    const up = () => {
      cancelAnimationFrame(frame)
      delete document.documentElement.dataset.resizing
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      store(show(latest))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    set(width + grow * dir * STEP)
  }
  return { width, min, onPointerDown, onKeyDown }
}

/** The workbench mode as laid out: 分栏 has no room for the full list under 1100px. */
export function useBenchMode(): WorkbenchMode {
  const mode = useWorkbench((s) => s.mode)
  const narrow = useViewportWidth() < RAIL_MIN
  return mode === 'split' && narrow ? 'focus' : mode
}

function Splitter({
  label,
  resize,
  className,
}: {
  label: string
  resize: ReturnType<typeof useSplitWidth>
  className: string
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused and dragged; this is the ARIA window splitter pattern
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={resize.width}
      aria-valuemin={resize.min}
      tabIndex={0}
      className={className}
      onPointerDown={resize.onPointerDown}
      onKeyDown={resize.onKeyDown}
    />
  )
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
  strip,
  children,
  chatStrip,
  nav,
  rail,
  railOpen = false,
  railKind = 'run',
  workbench,
  mobileView,
}: {
  sidebar: ReactNode
  /** The conversation list folded to icons, shown in the workbench's 专注 mode. */
  strip?: ReactNode
  children: ReactNode
  /** Contents of the 40px bar the chat collapses to in the workbench's 全屏 mode. */
  chatStrip?: ReactNode
  /** App NavRail: a left column on wide windows, a bottom tab bar under the conversation list on phones. */
  nav?: (orientation: 'vertical' | 'horizontal') => ReactNode
  rail?: ReactNode
  railOpen?: boolean
  railKind?: RailKind
  /** The workbench column right of the chat; on phones a full-screen page over the chat. */
  workbench?: ReactNode
  /** Under 768px only one column is shown. */
  mobileView: 'list' | 'chat'
}) {
  const mobile = useViewportWidth() < MOBILE_MAX
  const resize = useSplitWidth(
    `gonggong.railWidth.${railKind}`,
    RAIL_DEFAULT[railKind],
    RAIL_MIN_WIDTH,
    window.innerWidth * RAIL_MAX_SHARE,
    -1,
  )
  const [main, setMain] = useState<HTMLElement | null>(null)
  const bench = !mobile && !!workbench
  const phoneBench = mobile && mobileView === 'chat' && !!workbench
  useToastAboveComposer(phoneBench ? null : main)
  const mode = useBenchMode()
  const full = bench && mode === 'full'
  const chat = useSplitWidth(
    `gonggong.chatWidth.${mode === 'split' ? 'split' : 'focus'}`,
    CHAT_DEFAULT,
    CHAT_MIN,
    CHAT_MAX,
    1,
  )
  const [over, setOver] = useState(false)
  if (over && !full) setOver(false)
  useEscape(() => {
    const wb = useWorkbench.getState()
    if (over) setOver(false)
    else wb.setMode(wb.previous)
  }, full)
  const railBody = rail && railOpen ? rail : null
  const list = (
    <nav aria-label="会话列表" className="chat__sidebar">
      {sidebar}
    </nav>
  )
  return (
    <AppFrame
      className={cx('chat', mobile && `chat--${mobileView}`, bench && `chat--bench chat--${mode}`)}
      rail={mobile ? undefined : nav?.('vertical')}
      sidebar={
        bench ? (
          { split: list, focus: strip, full: undefined }[mode]
        ) : !mobile || mobileView === 'list' ? (
          <>
            {list}
            {mobile ? nav?.('horizontal') : null}
          </>
        ) : undefined
      }
      inspector={
        railBody && !bench ? (
          <>
            {mobile ? null : <Splitter label="调整侧栏宽度" resize={resize} className="chat__rail-handle" />}
            {railBody}
          </>
        ) : undefined
      }
      inspectorProps={{
        'aria-label': '侧栏',
        className: cx('chat__rail', mobile && 'chat__rail--overlay'),
        style: mobile ? undefined : { width: resize.width },
      }}
    >
      {full ? (
        <button
          type="button"
          className="chat__strip"
          aria-label={over ? '收起聊天' : '展开聊天'}
          aria-expanded={over}
          onClick={() => setOver(!over)}
        >
          {over ? null : chatStrip}
        </button>
      ) : null}
      {!mobile || mobileView === 'chat' ? (
        <main
          ref={setMain}
          className={cx('chat__center', bench && 'chat__center--narrow', over && 'chat__center--over')}
          style={bench ? { width: chat.width } : undefined}
          // Kept mounted under the phone workbench so the draft and scroll survive 返回聊天.
          hidden={(full && !over) || phoneBench}
        >
          {children}
        </main>
      ) : null}
      {bench && !full ? <Splitter label="调整聊天栏宽度" resize={chat} className="chat__split" /> : null}
      {bench || phoneBench ? workbench : null}
      {/* Over the workbench rather than beside it, so its frames never remount when the inspector toggles. */}
      {bench && railBody ? (
        <aside aria-label="侧栏" className="chat__drawer" style={{ width: resize.width }}>
          {railBody}
        </aside>
      ) : null}
    </AppFrame>
  )
}
