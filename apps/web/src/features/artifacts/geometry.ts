import type { ArtifactDevice, ArtifactDto } from '@gonggong/protocol'

/** Screen sizes per device (the web-prototype kit's DEVICES); full-height screens come later. */
export const DEVICE_SIZE: Record<ArtifactDevice, { w: number; h: number }> = {
  miniprogram: { w: 375, h: 812 },
  mobile: { w: 390, h: 844 },
  desktop: { w: 1440, h: 900 },
}
export const NODE_GAP = 120
/** Room above a node for its title, in canvas units at 100%. */
export const TITLE_ROOM = 32
const PAD = 64
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 4
export const ZOOM_STEP = 1.25

export interface CanvasNode {
  id: string
  title: string
  file: string
  x: number
  y: number
  w: number
  h: number
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

/** Screen nodes in manifest order, side by side; an L0 artifact (no manifest) is one desktop page. */
export function layoutNodes(artifact: Pick<ArtifactDto, 'title' | 'manifest'>): {
  device: ArtifactDevice
  nodes: CanvasNode[]
} {
  const m = artifact.manifest
  const device = m?.device ?? 'desktop'
  const { w, h } = DEVICE_SIZE[device]
  const screens = m?.screens ?? [{ id: 'index', title: artifact.title, file: 'index.html' }]
  return {
    device,
    nodes: screens.map((s, i) => ({
      id: s.id,
      title: s.title,
      file: s.file,
      x: i * (w + NODE_GAP),
      y: 0,
      w,
      h,
    })),
  }
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
