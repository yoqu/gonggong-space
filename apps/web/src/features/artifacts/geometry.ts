import type { ArtifactDevice, GgArtifactManifest } from '@gonggong/protocol'

/** Screen sizes per device (the web-prototype kit's DEVICES). */
export const DEVICE_SIZE: Record<ArtifactDevice, { w: number; h: number }> = {
  miniprogram: { w: 375, h: 812 },
  mobile: { w: 390, h: 844 },
  desktop: { w: 1440, h: 900 },
}
/** The preview menu's frame sizes (Stitch capability list §3). */
export const FRAME_PRESETS = {
  mobile: { w: 390, h: 884 },
  tablet: { w: 768, h: 1024 },
  desktop: { w: 1280, h: 1024 },
} as const
export type FramePreset = keyof typeof FRAME_PRESETS
export const NODE_GAP = 120
/** Room above a node for its title, in canvas units at 100%. */
export const TITLE_ROOM = 32
const PAD = 64
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 4
export const ZOOM_STEP = 1.25
export const SYSTEM_ID = '@system'
export const PROTOTYPE_ID = '@prototype'
export const SYSTEM_WIDTH = 720
/** Until the design-system card is measured. */
export const SYSTEM_HEIGHT = 640

export type NodeKind = 'system' | 'screen' | 'prototype'

export interface CanvasNode {
  id: string
  kind: NodeKind
  title: string
  /** The screen's HTML file; empty for other kinds. */
  file: string
  x: number
  y: number
  w: number
  h: number
}

/** How a screen is framed: its width and device height, or its whole content (Stitch's Full Height). */
export interface ScreenFrame {
  w: number
  h: number
  full: boolean
}

export interface View {
  x: number
  y: number
  z: number
}

export interface Box {
  width: number
  height: number
}

export interface LayoutInput {
  title: string
  manifest: GgArtifactManifest | null | undefined
  /** Height of the design-system card; null when the version has no tokens.css. */
  system: number | null
  frames: Record<string, ScreenFrame>
  /** Content heights the screens reported, by file. */
  content: Record<string, number>
}

export const defaultFrame = (device: ArtifactDevice): ScreenFrame => ({ ...DEVICE_SIZE[device], full: true })

/**
 * Nodes left to right, tops aligned (Stitch capability list §3): the design system, the screens in manifest order,
 * then the prototype. An L0 artifact (no manifest) is one desktop page.
 */
export function layoutNodes({ title, manifest, system, frames, content }: LayoutInput): {
  device: ArtifactDevice
  nodes: CanvasNode[]
} {
  const device = manifest?.device ?? 'desktop'
  const screens = manifest?.screens ?? [{ id: 'index', title, file: 'index.html' }]
  const nodes: CanvasNode[] = []
  let x = 0
  const add = (n: Omit<CanvasNode, 'x' | 'y'>) => {
    nodes.push({ ...n, x, y: 0 })
    x += n.w + NODE_GAP
  }
  if (system !== null) add({ id: SYSTEM_ID, kind: 'system', title: '', file: '', w: SYSTEM_WIDTH, h: system })
  for (const s of screens) {
    const f = frames[s.id] ?? defaultFrame(device)
    const h = f.full ? Math.max(1, Math.round(content[s.file] ?? f.h)) : f.h
    add({ id: s.id, kind: 'screen', title: s.title, file: s.file, w: f.w, h })
  }
  if (manifest) {
    const { w, h } = DEVICE_SIZE[device]
    add({ id: PROTOTYPE_ID, kind: 'prototype', title: manifest.title, file: '', w, h })
  }
  return { device, nodes }
}

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/** Zooms to `z` keeping the canvas point under (cx, cy) in place. */
export function zoomAt(view: View, z: number, cx: number, cy: number): View {
  const next = clampZoom(z)
  return {
    x: cx - ((cx - view.x) * next) / view.z,
    y: cy - ((cy - view.y) * next) / view.z,
    z: next,
  }
}

/** The view showing every node in `nodes` centred, at most 100%. */
export function fitView(nodes: CanvasNode[], box: Box): View | null {
  if (!nodes.length || box.width <= 0 || box.height <= 0) return null
  const left = Math.min(...nodes.map((n) => n.x))
  const top = Math.min(...nodes.map((n) => n.y)) - TITLE_ROOM
  const right = Math.max(...nodes.map((n) => n.x + n.w))
  const bottom = Math.max(...nodes.map((n) => n.y + n.h))
  const z = clampZoom(
    Math.min(1, (box.width - PAD * 2) / (right - left), (box.height - PAD * 2) / (bottom - top)),
  )
  return {
    x: (box.width - (right - left) * z) / 2 - left * z,
    y: (box.height - (bottom - top) * z) / 2 - top * z,
    z,
  }
}

/** A node's rectangle in viewport pixels. */
export const onScreen = (n: CanvasNode, v: View) => ({
  left: v.x + n.x * v.z,
  top: v.y + n.y * v.z,
  width: n.w * v.z,
  height: n.h * v.z,
})

export type Direction = 'left' | 'right' | 'up' | 'down'

/** The nearest node of `nodes` from `from` in a direction (⌘← ⌘→ ⌘↑ ⌘↓), by centre. */
export function neighbour(nodes: CanvasNode[], from: CanvasNode, dir: Direction): CanvasNode | undefined {
  const c = (n: CanvasNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })
  const o = c(from)
  const ahead = (n: CanvasNode) => {
    const p = c(n)
    if (dir === 'right') return p.x > o.x
    if (dir === 'left') return p.x < o.x
    if (dir === 'down') return p.y > o.y
    return p.y < o.y
  }
  const along = dir === 'left' || dir === 'right'
  return nodes
    .filter((n) => n.id !== from.id && ahead(n))
    .sort((a, b) => {
      const pa = c(a)
      const pb = c(b)
      const da = along
        ? Math.abs(pa.x - o.x) + 4 * Math.abs(pa.y - o.y)
        : Math.abs(pa.y - o.y) + 4 * Math.abs(pa.x - o.x)
      const db = along
        ? Math.abs(pb.x - o.x) + 4 * Math.abs(pb.y - o.y)
        : Math.abs(pb.y - o.y) + 4 * Math.abs(pb.x - o.x)
      return da - db
    })[0]
}

/** Where a screen dragged by its title to canvas x `dropX` goes among the screens (manifest `reorder` index). */
export function dropIndex(screens: CanvasNode[], id: string, dropX: number): number {
  const others = screens.filter((s) => s.id !== id)
  return others.filter((s) => s.x + s.w / 2 < dropX).length
}
