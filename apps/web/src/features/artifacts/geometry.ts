import type { ArtifactDevice, ArtifactRefKind, GgArtifactManifest, GgArtifactRef } from '@gonggong/protocol'

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
/** A preview preset's size on `device`: a mini program's phone is its own 375 wide. */
export const framePreset = (p: FramePreset, device: ArtifactDevice) =>
  p === 'mobile' && device === 'miniprogram'
    ? { ...FRAME_PRESETS.mobile, w: DEVICE_SIZE.miniprogram.w }
    : FRAME_PRESETS[p]
export const NODE_GAP = 120
/** Room above a node for its title, in canvas units at 100%. */
export const TITLE_ROOM = 32
const PAD = 64
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 4
export const ZOOM_STEP = 1.25
export const SYSTEM_ID = '@system'
export const DOC_ID = '@design-md'
export const PROTOTYPE_ID = '@prototype'
export const SYSTEM_WIDTH = 720
/** Until the design-system card is measured. */
export const SYSTEM_HEIGHT = 640
export const DOC_WIDTH = 560
/** Until the DESIGN.md card is measured. */
export const DOC_HEIGHT = 640

/** A reference node's id: the ref's own id under this prefix, apart from screen ids. */
export const REF_PREFIX = '@ref:'
export const refNodeId = (id: string) => `${REF_PREFIX}${id}`
/** Reference cards: an image as wide as this and as tall as its ratio makes it (measured), files a fixed card. */
export const REF_SIZE: Record<ArtifactRefKind, { w: number; h: number }> = {
  image: { w: 360, h: 240 },
  pdf: { w: 240, h: 300 },
  text: { w: 320, h: 240 },
}

export type NodeKind = 'system' | 'doc' | 'screen' | 'prototype' | 'ref'

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
  /** Height of the DESIGN.md card; null (or absent) when the version has no DESIGN.md. */
  doc?: number | null
  frames: Record<string, ScreenFrame>
  /** Content heights the screens reported, by file. */
  content: Record<string, number>
  /** Files uploaded to the canvas. */
  refs?: GgArtifactRef[]
  /** Measured heights of image references, by ref id. */
  refHeights?: Record<string, number>
}

export const defaultFrame = (device: ArtifactDevice): ScreenFrame => ({ ...DEVICE_SIZE[device], full: true })

/** How wide a row of screens may get before the next one wraps, in canvas units at 100%. */
export const ROW_SPAN = 3400

/** Screens a row holds on `device`: about six phones, two desktops. */
export const perRow = (device: ArtifactDevice) =>
  Math.max(1, Math.floor(ROW_SPAN / (DEVICE_SIZE[device].w + NODE_GAP)))

/**
 * The design system on the left; right of it the screens in manifest order, then the prototype, in rows of
 * `perRow(device)` (Stitch capability list §3), each row below the tallest node of the one above. An L0 artifact (no
 * manifest) is one desktop page.
 */
export function layoutNodes({
  title,
  manifest,
  system,
  doc = null,
  frames,
  content,
  refs = [],
  refHeights = {},
}: LayoutInput): {
  device: ArtifactDevice
  nodes: CanvasNode[]
} {
  const device = manifest?.device ?? 'desktop'
  const screens = manifest?.screens ?? [{ id: 'index', title, file: 'index.html' }]
  const nodes: CanvasNode[] = []
  let left = 0
  if (system !== null) {
    nodes.push({ id: SYSTEM_ID, kind: 'system', title: '', file: '', x: 0, y: 0, w: SYSTEM_WIDTH, h: system })
    left += SYSTEM_WIDTH + NODE_GAP
  }
  // DESIGN.md sits beside the design system it describes.
  if (doc !== null) {
    nodes.push({
      id: DOC_ID,
      kind: 'doc',
      title: 'DESIGN.md',
      file: 'DESIGN.md',
      x: left,
      y: 0,
      w: DOC_WIDTH,
      h: doc,
    })
    left += DOC_WIDTH + NODE_GAP
  }
  const cells: Omit<CanvasNode, 'x' | 'y'>[] = screens.map((s) => {
    const f = frames[s.id] ?? defaultFrame(device)
    const h = f.full ? Math.max(1, Math.round(content[s.file] ?? f.h)) : f.h
    return { id: s.id, kind: 'screen', title: s.title, file: s.file, w: f.w, h }
  })
  if (manifest) {
    const { w, h } = DEVICE_SIZE[device]
    cells.push({ id: PROTOTYPE_ID, kind: 'prototype', title: manifest.title, file: '', w, h })
  }
  const row = perRow(device)
  let y = 0
  for (let i = 0; i < cells.length; i += row) {
    let x = left
    let tallest = 0
    for (const c of cells.slice(i, i + row)) {
      nodes.push({ ...c, x, y })
      x += c.w + NODE_GAP
      tallest = Math.max(tallest, c.h)
    }
    y += tallest + NODE_GAP + TITLE_ROOM
  }
  // References the member has not placed go in a row below everything else (G04).
  let refX = 0
  const refY = nodes.length ? Math.max(...nodes.map((n) => n.y + n.h)) + NODE_GAP + TITLE_ROOM : 0
  for (const r of refs) {
    const size = REF_SIZE[r.kind] ?? REF_SIZE.text
    const h = r.kind === 'image' ? (refHeights[r.id] ?? size.h) : size.h
    const placed = r.x !== undefined && r.y !== undefined
    nodes.push({
      id: refNodeId(r.id),
      kind: 'ref',
      title: r.title,
      file: r.file,
      x: placed ? (r.x as number) : refX,
      y: placed ? (r.y as number) : refY,
      w: size.w,
      h,
    })
    if (!placed) refX += size.w + NODE_GAP
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

/**
 * The view showing every node in `nodes` centred, at most 100%. `right`: what the tools and an open panel take of the
 * box's right edge; the nodes go in the rest.
 */
export function fitView(nodes: CanvasNode[], box: Box, right = 0): View | null {
  const width = box.width - right
  if (!nodes.length || width <= 0 || box.height <= 0) return null
  const left = Math.min(...nodes.map((n) => n.x))
  const top = Math.min(...nodes.map((n) => n.y)) - TITLE_ROOM
  const r = Math.max(...nodes.map((n) => n.x + n.w))
  const bottom = Math.max(...nodes.map((n) => n.y + n.h))
  const z = clampZoom(Math.min(1, (width - PAD * 2) / (r - left), (box.height - PAD * 2) / (bottom - top)))
  return {
    x: (width - (r - left) * z) / 2 - left * z,
    y: (box.height - (bottom - top) * z) / 2 - top * z,
    z,
  }
}

/** The nodes' bounding box as a key: it changes when the layout grows, moves or settles. */
export const boundsKey = (nodes: CanvasNode[]) =>
  nodes.length
    ? [
        Math.min(...nodes.map((n) => n.x)),
        Math.min(...nodes.map((n) => n.y)),
        Math.max(...nodes.map((n) => n.x + n.w)),
        Math.max(...nodes.map((n) => n.y + n.h)),
      ].join(',')
    : ''

/** A node's rectangle in viewport pixels. */
export const onScreen = (n: CanvasNode, v: View) => ({
  left: v.x + n.x * v.z,
  top: v.y + n.y * v.z,
  width: n.w * v.z,
  height: n.h * v.z,
})

/** Space kept between what is being edited and the panel's edge (px). */
const PANEL_GAP = 24

/**
 * How far (px) to pan the view left so that `box` (viewport pixels: what is being edited) clears a side panel taking
 * `side` px at the right of a `width` wide canvas; 0 when it already does. A box too wide for the room left keeps
 * its left edge in view.
 */
export function clearOfPanel(box: { left: number; width: number }, width: number, side: number) {
  if (!side) return 0
  const over = box.left + box.width - (width - side - PANEL_GAP)
  if (over <= 0) return 0
  return Math.max(0, Math.min(over, box.left - PANEL_GAP))
}

/**
 * The auto-fit (the layout settling) with a side panel open: never zooms out for the panel's sake, only a member's
 * fit does (the canvas would shrink each time a version arrives while the design-system panel is open).
 */
export const keepZoomBeside = (fitted: View, current: View, side: number) =>
  side > 0 && fitted.z < current.z ? null : fitted

/**
 * The view panned (not zoomed) to bring `n`'s title into `room`, or null when it is already there. A node wider than
 * the room starts at its left padding; otherwise it is centred across.
 */
export function revealView(n: CanvasNode, v: View, room: { width: number; height: number }): View | null {
  const r = onScreen(n, v)
  const title = r.top - TITLE_ROOM
  const across = r.left >= 0 && r.left + Math.min(r.width, 120) <= room.width
  const down = title >= 0 && r.top < room.height
  if (across && down) return null
  return {
    z: v.z,
    x: across
      ? v.x
      : r.width <= room.width - 2 * PAD
        ? room.width / 2 - (n.x + n.w / 2) * v.z
        : PAD - n.x * v.z,
    y: down ? v.y : PAD + TITLE_ROOM - n.y * v.z,
  }
}

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

/**
 * Where a screen dragged by its title to canvas point (`dropX`, `dropY`) goes among the screens (manifest `reorder`
 * index): after every screen of the rows above the drop's row, and after those of its row left of it.
 */
export function dropIndex(screens: CanvasNode[], id: string, dropX: number, dropY = 0): number {
  const others = screens.filter((s) => s.id !== id)
  const tops = [...new Set(others.map((s) => s.y))].sort((a, b) => a - b)
  const rowTop = tops.filter((y) => y <= dropY).at(-1) ?? tops[0] ?? 0
  return others.filter((s) => s.y < rowTop || (s.y === rowTop && s.x + s.w / 2 < dropX)).length
}

/** A rectangle in canvas units (a marquee). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The rectangle spanned by two points, whichever way it was dragged. */
export const rectOf = (ax: number, ay: number, bx: number, by: number): Rect => ({
  x: Math.min(ax, bx),
  y: Math.min(ay, by),
  w: Math.abs(bx - ax),
  h: Math.abs(by - ay),
})

/** The nodes a marquee touches (Stitch / Figma select what the box intersects). */
export const nodesInRect = (nodes: CanvasNode[], r: Rect) =>
  nodes.filter((n) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y)
