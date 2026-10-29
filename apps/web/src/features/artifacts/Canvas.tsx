import type { ArtifactDevice } from '@gonggong/protocol'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Icon, IconButton, type IconName, MenuButton, Presence, Skeleton, Tooltip } from '../../ui'
import { openUrl } from '../previews/store'
import { type CanvasNode, fitView, onScreen, TITLE_ROOM, type View, ZOOM_STEP, zoomAt } from './geometry'
import {
  GENERATE_ITEMS,
  MODIFY_ITEMS,
  MORE_ITEMS,
  MORE_RELOAD,
  PREVIEW_NEW_TAB,
  previewItems,
  ZOOM_100,
  ZOOM_FIT,
  ZOOM_IN,
  ZOOM_OUT,
  ZOOM_SELECTION,
  zoomItems,
} from './menus'
import { ShortcutsDialog } from './ShortcutsDialog'

type Tool = 'select' | 'hand'

/** Pointer travel (px) after which a press pans instead of clicking. */
const DRAG = 4

export interface CanvasProps {
  nodes: CanvasNode[]
  device: ArtifactDevice
  /** The preview serving the screens; null while it opens. */
  previewId: string | null
  /** Changes when the shown version does, so frames reload. */
  versionKey: string
  undo: (() => void) | null
  redo: (() => void) | null
}

const deviceIcon = (d: ArtifactDevice): IconName => (d === 'desktop' ? 'desktop' : 'smartphone')

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

/**
 * The artifact canvas (Stitch capability list §3–§4): screens side by side on a dotted plane that pans and zooms;
 * screens are selected, never interacted with, here (their frames ignore the pointer).
 */
export function Canvas({ nodes, device, previewId, versionKey, undo, redo }: CanvasProps) {
  const root = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ x: 64, y: 64 + TITLE_ROOM, z: 1 })
  const [tool, setTool] = useState<Tool>('select')
  const [space, setSpace] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [help, setHelp] = useState(false)
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [dragging, setDragging] = useState(false)
  const press = useRef<{ id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  )
  const fitted = useRef(false)
  const panning = tool === 'hand' || space

  useEffect(() => {
    const el = plane.current
    if (!el) return
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fitTo = useCallback(
    (only?: string[]) => {
      const v = fitView(only ? nodes.filter((n) => only.includes(n.id)) : nodes, room)
      if (v) setView(v)
    },
    [nodes, room],
  )
  // Fit once the plane has a size.
  useEffect(() => {
    if (fitted.current || !room.width) return
    fitted.current = true
    fitTo()
  }, [room, fitTo])
  // Screens gone from the manifest leave the selection.
  useEffect(() => setSelected((s) => s.filter((id) => nodes.some((n) => n.id === id))), [nodes])

  // React's wheel listener is passive; zooming must keep the page from scrolling or zooming itself.
  useEffect(() => {
    const el = plane.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      // ctrlKey is also how trackpads report a pinch.
      if (e.ctrlKey || e.metaKey)
        setView((v) => zoomAt(v, v.z * Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top))
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const zoom = (value: string) => {
    const cx = room.width / 2
    const cy = room.height / 2
    if (value === ZOOM_IN) setView((v) => zoomAt(v, v.z * ZOOM_STEP, cx, cy))
    else if (value === ZOOM_OUT) setView((v) => zoomAt(v, v.z / ZOOM_STEP, cx, cy))
    else if (value === ZOOM_100) setView((v) => zoomAt(v, 1, cx, cy))
    else if (value === ZOOM_FIT) fitTo()
    else if (value === ZOOM_SELECTION && selected.length) fitTo(selected)
  }

  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed in a field, or in a dialog portalled out of the canvas, are not shortcuts.
    if (editable(e.target) || !root.current?.contains(e.target as Node)) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const run = (f: () => void) => {
      e.preventDefault()
      f()
    }
    if (mod && (key === '=' || key === '+')) run(() => zoom(ZOOM_IN))
    else if (mod && key === '-') run(() => zoom(ZOOM_OUT))
    else if (mod && key === 'a') run(() => setSelected(nodes.map((n) => n.id)))
    else if (mod && key === 'z') run(() => (e.shiftKey ? redo : undo)?.())
    else if (mod) return
    else if (e.shiftKey && e.code === 'Digit0') run(() => zoom(ZOOM_100))
    else if (e.shiftKey && e.code === 'Digit1') run(() => zoom(ZOOM_FIT))
    else if (e.shiftKey && e.code === 'Digit2') run(() => zoom(ZOOM_SELECTION))
    else if (e.key === '?') run(() => setHelp(true))
    else if (e.key === 'Escape' && selected.length) run(() => setSelected([]))
    else if (e.key === ' ') run(() => setSpace(true))
    else if (key === 'v') run(() => setTool('select'))
    else if (key === 'h') run(() => setTool('hand'))
  }

  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    root.current?.focus({ preventScroll: true })
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
  }
  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (p?.id !== e.pointerId) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.moved) {
      if (Math.hypot(dx, dy) < DRAG) return
      // Captured only once it pans, so a plain click still lands on the screen under it.
      p.moved = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setDragging(true)
    }
    setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }))
  }
  const pointerUp = () => {
    setDragging(false)
    // The click that follows a pan is not a selection.
    setTimeout(() => {
      press.current = null
    })
  }
  const panned = () => !!press.current?.moved

  const pick = (id: string, shift: boolean) => {
    if (panned() || panning) return
    setSelected((s) => (shift ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))
  }
  const clickPlane = (shift: boolean) => {
    if (panned() || panning || shift) return
    setSelected([])
  }

  const one = selected.length === 1 ? nodes.find((n) => n.id === selected[0]) : undefined
  const src = (n: CanvasNode) => (previewId ? openUrl(previewId, `/${n.file}`) : null)
  const selectionMenu = (value: string) => {
    if (value === PREVIEW_NEW_TAB && one && previewId) window.open(src(one) ?? '', '_blank', 'noopener')
    else if (value === MORE_RELOAD)
      setReloads((r) => ({ ...r, ...Object.fromEntries(selected.map((id) => [id, (r[id] ?? 0) + 1])) }))
  }

  return (
    <div
      ref={root}
      className="art-canvas"
      role="application"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so its shortcuts work
      tabIndex={0}
      aria-label={t('画布')}
      onKeyDown={keyDown}
      onKeyUp={(e) => {
        if (e.key === ' ') setSpace(false)
      }}
      onBlur={() => setSpace(false)}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer panning; the keyboard pans with the zoom menu */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc clears the selection */}
      <div
        ref={plane}
        className={cx('art-plane', panning && 'art-plane--hand', dragging && 'art-plane--dragging')}
        data-testid="art-plane"
        style={{
          backgroundPosition: `${view.x}px ${view.y}px`,
          backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('art-world'))
            clickPlane(e.shiftKey)
        }}
      >
        <div
          className="art-world"
          style={{
            transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.z})`,
          }}
        >
          {nodes.map((n) => {
            const url = src(n)
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: ⌘A and the title buttons select from the keyboard
              // biome-ignore lint/a11y/noStaticElementInteractions: a screen is picked by pointer; its title is the button
              <div
                key={n.id}
                className="art-node"
                data-testid={`art-node-${n.id}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                onClick={(e) => pick(n.id, e.shiftKey)}
              >
                {url ? (
                  <iframe
                    key={`${versionKey}:${reloads[n.id] ?? 0}`}
                    className="art-node__frame"
                    title={n.title}
                    src={url}
                    tabIndex={-1}
                  />
                ) : (
                  <Skeleton variant="block" count={1} width="100%" height="100%" />
                )}
              </div>
            )
          })}
        </div>
        <div className="art-overlay">
          {nodes.map((n) => {
            const r = onScreen(n, view)
            const on = selected.includes(n.id)
            return (
              <div key={n.id}>
                <button
                  type="button"
                  className={cx('art-title', on && 'art-title--on')}
                  style={{ left: r.left, top: r.top - 26, maxWidth: Math.max(r.width, 80) }}
                  aria-pressed={on}
                  onClick={(e) => pick(n.id, e.shiftKey)}
                >
                  <Icon name={deviceIcon(device)} size={13} />
                  <span>{n.title}</span>
                </button>
                {on ? (
                  <div
                    className="art-select"
                    data-testid={`art-select-${n.id}`}
                    style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                  >
                    <i className="art-select__handle art-select__handle--nw" />
                    <i className="art-select__handle art-select__handle--ne" />
                    <i className="art-select__handle art-select__handle--sw" />
                    <i className="art-select__handle art-select__handle--se" />
                    <span className="art-select__size">{`${n.w} × ${n.h}`}</span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {selected.length ? (
        <div className="art-float" role="toolbar" aria-label={t('所选屏幕')}>
          <FloatMenu icon="sparkle" label={t('生成')} items={GENERATE_ITEMS} onSelect={selectionMenu} />
          <FloatMenu icon="pencil" label={t('修改#modify')} items={MODIFY_ITEMS} onSelect={selectionMenu} />
          <FloatMenu
            icon="eye"
            label={t('预览')}
            items={previewItems(!!one && !!previewId)}
            onSelect={selectionMenu}
          />
          <FloatMenu icon="more" label={t('更多')} items={MORE_ITEMS} onSelect={selectionMenu} />
        </div>
      ) : null}

      <div className="art-tools" role="toolbar" aria-orientation="vertical" aria-label={t('画布工具')}>
        <ToolButton
          icon="cursor"
          label={t('选择')}
          shortcut="V"
          on={tool === 'select'}
          onClick={() => setTool('select')}
        />
        <ToolButton icon="marquee" label={t('标记#mark')} shortcut="M" />
        <ToolButton icon="pencil" label={t('直接编辑')} shortcut="E" />
        <ToolButton
          icon="hand"
          label={t('抓手')}
          shortcut="H"
          on={tool === 'hand'}
          onClick={() => setTool('hand')}
        />
        <ToolButton icon="upload" label={t('上传到画布')} />
        <hr className="art-tools__sep" />
        <ToolButton icon="palette" label="DESIGN.md" />
        <ToolButton icon="star" label={t('收藏')} />
      </div>

      <div className="art-corner">
        <IconButton size="regular" title={t('撤销#undo')} disabled={!undo} onClick={() => undo?.()}>
          {'undo' as const}
        </IconButton>
        <IconButton size="regular" title={t('重做')} disabled={!redo} onClick={() => redo?.()}>
          {'redo' as const}
        </IconButton>
        <MenuButton
          className="ui-btn ui-btn--plain art-corner__zoom"
          aria-label={t('缩放')}
          title={t('缩放')}
          items={zoomItems(selected.length > 0)}
          onSelect={zoom}
          align="end"
          placement="above"
        >
          {`${Math.round(view.z * 100)}%`}
        </MenuButton>
        <IconButton size="regular" title={t('快捷键')} onClick={() => setHelp(true)}>
          <span className="art-corner__help">?</span>
        </IconButton>
      </div>

      <Presence>{help ? <ShortcutsDialog onClose={() => setHelp(false)} /> : null}</Presence>
    </div>
  )
}

function FloatMenu({
  icon,
  label,
  items,
  onSelect,
}: {
  icon: IconName
  label: string
  items: Parameters<typeof MenuButton>[0]['items']
  onSelect: (value: string) => void
}) {
  return (
    <MenuButton
      className="ui-btn ui-btn--plain ui-btn--small art-float__btn"
      items={items}
      onSelect={onSelect}
    >
      <Icon name={icon} size={14} />
      {label}
      <Icon name="chevron-down" size={10} weight={2} />
    </MenuButton>
  )
}

/** A tool of the right-hand toolbar; tools without `onClick` are not built yet. */
function ToolButton({
  icon,
  label,
  shortcut,
  on,
  onClick,
}: {
  icon: IconName
  label: string
  shortcut?: string
  on?: boolean
  onClick?: () => void
}): ReactElement {
  return (
    <Tooltip
      content={onClick ? label : t('{name}（即将支持）', { name: label })}
      shortcut={shortcut}
      placement="top"
    >
      <button
        type="button"
        className="art-tools__btn"
        aria-label={label}
        aria-pressed={onClick ? !!on : undefined}
        disabled={!onClick}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
      </button>
    </Tooltip>
  )
}
