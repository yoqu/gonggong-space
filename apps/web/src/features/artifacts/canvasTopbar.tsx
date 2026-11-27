import { type ReactNode, useState } from 'react'
import { t } from '../../i18n'
import { IconButton, MenuButton, type MenuItem } from '../../ui'
import { ToolButton } from './canvasControls'
import type { CanvasNode, View } from './geometry'

export type Tool = 'select' | 'hand' | 'mark' | 'edit' | 'play' | 'hotspot'

/** An on/off setting kept in localStorage: [value, toggle, set (for now, not kept)]. */
export function useStoredFlag(key: string, initial: boolean) {
  const [on, setOn] = useState(() => {
    const v = localStorage.getItem(key)
    return v === null ? initial : v === 'on'
  })
  const toggle = () => {
    localStorage.setItem(key, on ? 'off' : 'on')
    setOn(!on)
  }
  return [on, toggle, setOn] as const
}

type ToolPanel = 'design' | 'favourites' | 'annotations'

/** The tools of the top bar, then the panels it opens. */
export function CanvasTools({
  tool,
  onTool,
  noEdit,
  uploading,
  onUpload,
  onLink,
  onRefresh,
  panel,
  onPanel,
  notes,
  badges,
  onBadges,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  /** Why the canvas cannot be edited now, if it cannot. */
  noEdit: string | undefined
  uploading: boolean
  onUpload: () => void
  onLink: () => void
  onRefresh: () => void
  panel: string | null
  onPanel: (panel: ToolPanel) => void
  notes: number
  badges: boolean
  onBadges: () => void
}) {
  // 直接编辑 is the select tool for who may edit (a block is edited where it is pointed at); the hand is space-drag.
  const tools: { id: Tool; icon: 'cursor' | 'marquee' | 'play'; label: string; key: string }[] = [
    { id: 'select', icon: 'cursor', label: t('选择'), key: 'V' },
    { id: 'mark', icon: 'marquee', label: t('标记#mark'), key: 'M' },
    { id: 'play', icon: 'play', label: t('交互'), key: 'P' },
  ]
  return (
    <>
      {tools.map((it) => (
        <ToolButton
          key={it.id}
          icon={it.icon}
          label={it.label}
          shortcut={it.key}
          on={tool === it.id || (it.id === 'select' && tool === 'edit')}
          onClick={() => onTool(it.id)}
        />
      ))}
      <ToolButton
        icon="upload"
        label={t('上传到画布')}
        off={noEdit ?? (uploading ? t('正在上传…') : undefined)}
        onClick={onUpload}
      />
      <ToolButton
        icon="target"
        label={t('热区')}
        on={tool === 'hotspot'}
        off={noEdit}
        onClick={() => onTool(tool === 'hotspot' ? 'select' : 'hotspot')}
      />
      <ToolButton icon="link" label={t('添加链接')} off={noEdit} onClick={onLink} />
      <ToolButton icon="arrow-clockwise" label={t('刷新')} onClick={onRefresh} />
      <hr className="art-tools__sep" />
      <ToolButton
        icon="palette"
        label={t('设计系统')}
        on={panel === 'design'}
        onClick={() => onPanel('design')}
      />
      <ToolButton
        icon="star"
        label={t('收藏')}
        on={panel === 'favourites'}
        onClick={() => onPanel('favourites')}
      />
      <ToolButton
        icon="bubble"
        label={t('批注')}
        badge={notes}
        on={panel === 'annotations'}
        onClick={() => onPanel('annotations')}
      />
      <ToolButton icon="tag" label={t('显示角标')} on={badges} onClick={onBadges} />
    </>
  )
}

/** The bounds of these nodes, in canvas units; null for none. */
export function spanOf(nodes: CanvasNode[]) {
  if (!nodes.length) return null
  const x = Math.min(...nodes.map((n) => n.x))
  const y = Math.min(...nodes.map((n) => n.y))
  return {
    x,
    y,
    w: Math.max(...nodes.map((n) => n.x + n.w)) - x,
    h: Math.max(...nodes.map((n) => n.y + n.h)) - y,
  }
}

/**
 * The canvas's top bar (墨刀's 顶栏): undo / redo at the left, the tools in the middle, the zoom and the panels at the
 * right. The tools are the canvas's own `ToolButton`s, passed in.
 */
export function CanvasTopbar({
  undo,
  redo,
  zoom,
  zoomItems,
  onZoom,
  onHelp,
  inspector,
  onInspector,
  children,
}: {
  undo: (() => void) | null
  redo: (() => void) | null
  zoom: number
  zoomItems: MenuItem[]
  onZoom: (value: string) => void
  onHelp: () => void
  inspector: boolean
  onInspector: () => void
  children: ReactNode
}) {
  return (
    <div className="art-topbar" data-testid="art-topbar">
      <div className="art-topbar__side">
        <IconButton size="regular" title={t('撤销#undo')} disabled={!undo} onClick={() => undo?.()}>
          {'undo' as const}
        </IconButton>
        <IconButton size="regular" title={t('重做')} disabled={!redo} onClick={() => redo?.()}>
          {'redo' as const}
        </IconButton>
      </div>
      <div className="art-tools" role="toolbar" aria-label={t('画布工具')}>
        {children}
      </div>
      <div className="art-topbar__side art-topbar__side--end">
        <MenuButton
          className="ui-btn ui-btn--plain art-corner__zoom"
          aria-label={t('缩放')}
          title={t('缩放')}
          items={zoomItems}
          onSelect={onZoom}
          align="end"
        >
          {`${Math.round(zoom * 100)}%`}
        </MenuButton>
        <IconButton size="regular" title={t('快捷键')} onClick={onHelp}>
          <span className="art-corner__help">?</span>
        </IconButton>
        <IconButton
          size="regular"
          title={inspector ? t('收起属性面板') : t('展开属性面板')}
          aria-pressed={inspector}
          onClick={onInspector}
        >
          {'sidebar-right' as const}
        </IconButton>
      </div>
    </div>
  )
}

const RULER = 18
/** World units between labelled ticks: 1, 2 or 5 × 10ⁿ, at least this many pixels apart on screen. */
const TICK_PX = 64

export function rulerStep(zoom: number): number {
  const raw = TICK_PX / zoom
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p
}

/** The ticks of one ruler: world positions labelled, at their screen offset, within `length` pixels. */
export function rulerTicks(offset: number, zoom: number, length: number) {
  const step = rulerStep(zoom)
  const from = Math.ceil(-offset / zoom / step) * step
  const ticks: { at: number; label: number }[] = []
  for (let w = from; w * zoom + offset <= length; w += step) ticks.push({ at: w * zoom + offset, label: w })
  return ticks
}

/** 墨刀's rulers along the top and left of the canvas, in canvas units; the selection's extent shaded on them. */
export function Rulers({
  view,
  room,
  span,
}: {
  view: View
  room: { width: number; height: number }
  /** The selection's bounds in canvas units, shaded. */
  span: { x: number; y: number; w: number; h: number } | null
}) {
  const top = rulerTicks(view.x, view.z, room.width)
  const left = rulerTicks(view.y, view.z, room.height)
  return (
    <div className="art-rulers" aria-hidden="true" data-testid="art-rulers">
      <svg className="art-rulers__top" width={room.width} height={RULER} aria-hidden="true">
        {span ? (
          <rect
            className="art-rulers__span"
            x={span.x * view.z + view.x}
            y={0}
            width={span.w * view.z}
            height={RULER}
          />
        ) : null}
        {top.map((k) => (
          <g key={k.label}>
            <line x1={k.at} x2={k.at} y1={RULER - 6} y2={RULER} />
            <text x={k.at + 3} y={10}>
              {k.label}
            </text>
          </g>
        ))}
      </svg>
      <svg className="art-rulers__left" width={RULER} height={room.height} aria-hidden="true">
        {span ? (
          <rect
            className="art-rulers__span"
            x={0}
            y={span.y * view.z + view.y}
            width={RULER}
            height={span.h * view.z}
          />
        ) : null}
        {left.map((k) => (
          <g key={k.label}>
            <line x1={RULER - 6} x2={RULER} y1={k.at} y2={k.at} />
            <text x={10} y={k.at + 3} transform={`rotate(-90 10 ${k.at + 3})`}>
              {k.label}
            </text>
          </g>
        ))}
      </svg>
      <i className="art-rulers__corner" />
    </div>
  )
}
