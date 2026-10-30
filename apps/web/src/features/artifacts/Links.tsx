import type { BridgeLinkRect } from '@gonggong/protocol'
import { useId } from 'react'
import type { CanvasNode, View } from './geometry'
import type { ArtifactLink } from './store'

export interface LinkPath {
  key: string
  from: string
  to: string
  text: string
  d: string
  /** Where the label sits: the curve's midpoint, moved down off the labels before it. */
  mid: { x: number; y: number }
  /** A link into the selection from elsewhere: drawn faint, without a label (the selection's own links lead). */
  faded: boolean
}

/** A label's footprint (px) when spreading them: labels closer than this push the later one down. */
const LABEL_W = 96
const LABEL_H = 20
/** Links back swing below the screens, each a step lower than the last, so they do not run in one bundle. */
const BACK_STEP = 28

/** Moves labels down until none sits on another (in the order given). */
function spreadLabels(paths: LinkPath[]) {
  const placed: { x: number; y: number }[] = []
  for (const p of paths) {
    if (p.faded || !p.text) continue
    let y = p.mid.y
    while (placed.some((q) => Math.abs(q.x - p.mid.x) < LABEL_W && Math.abs(q.y - y) < LABEL_H)) y += LABEL_H
    p.mid = { x: p.mid.x, y }
    placed.push(p.mid)
  }
}

/**
 * Connections between screens in viewport pixels (Stitch's Show Connections; curves from the web-prototype kit's
 * canvas): forward links arc across, links back swing below the screens in between, each a little lower. One per
 * screen pair. A link starts at its element when the screen reported where it is (`spots`, by file), else at a
 * staggered point. With `focus` (the selected screens) only their own links are labelled; links into them from other
 * screens fade. Labels never sit on one another.
 */
export function linkPaths(
  nodes: CanvasNode[],
  links: ArtifactLink[],
  v: View,
  spots: Record<string, BridgeLinkRect[]> = {},
  focus?: string[],
): LinkPath[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const bottom = Math.max(0, ...nodes.map((n) => n.y + n.h))
  const seen = new Set<string>()
  const outgoing = new Map<string, number>()
  let back = 0
  const out: LinkPath[] = []
  for (const l of links) {
    const f = byId.get(l.from)
    const to = byId.get(l.to)
    const key = `${l.from}>${l.to}`
    if (!f || !to || f === to || seen.has(key)) continue
    seen.add(key)
    const k = outgoing.get(f.id) ?? 0
    outgoing.set(f.id, k + 1)
    const forward = to.x > f.x
    const fileSpots = spots[f.file] ?? []
    const spot = fileSpots.find((s) => s.ggId === l.ggId) ?? fileSpots.find((s) => s.screen === l.to)
    const sx = spot ? f.x + spot.rect.x + (forward ? spot.rect.w : 0) : forward ? f.x + f.w : f.x
    const sy = spot
      ? f.y + Math.min(spot.rect.y + spot.rect.h / 2, Math.max(8, f.h - 8))
      : f.y + Math.min(96 + k * 48, Math.max(24, f.h - 24))
    const tx = forward ? to.x : to.x + to.w
    const ty = to.y + Math.min(64, to.h / 2)
    const bend = Math.max(60, Math.abs(tx - sx) / 2)
    const low = bottom + 160 + (forward ? 0 : back++ * BACK_STEP)
    const c1 = forward ? { x: sx + bend, y: sy } : { x: sx - 80, y: low }
    const c2 = forward ? { x: tx - bend, y: ty } : { x: tx + 80, y: low }
    const p = (x: number, y: number) => ({ x: v.x + x * v.z, y: v.y + y * v.z })
    const [a, b, c, d] = [p(sx, sy), p(c1.x, c1.y), p(c2.x, c2.y), p(tx, ty)]
    out.push({
      key,
      from: l.from,
      to: l.to,
      text: l.text,
      d: `M${a.x} ${a.y} C${b.x} ${b.y} ${c.x} ${c.y} ${d.x} ${d.y}`,
      mid: { x: (a.x + 3 * b.x + 3 * c.x + d.x) / 8, y: (a.y + 3 * b.y + 3 * c.y + d.y) / 8 },
      faded: !!focus && !focus.includes(l.from),
    })
  }
  spreadLabels(out)
  return out
}

export function Links({ paths }: { paths: LinkPath[] }) {
  const marker = `art-arrow${useId().replace(/[^a-z0-9]/gi, '')}`
  if (!paths.length) return null
  return (
    <>
      <svg className="art-links" width="1" height="1" aria-hidden="true">
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 10 5 0 10z" />
          </marker>
        </defs>
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            className={p.faded ? 'art-links__in' : undefined}
            data-testid={`art-path-${p.key}`}
            markerEnd={`url(#${marker})`}
          />
        ))}
      </svg>
      {paths.map((p) =>
        p.faded ? null : p.text ? (
          <span
            key={p.key}
            className="art-link-label"
            data-testid={`art-link-${p.key}`}
            style={{ left: p.mid.x, top: p.mid.y }}
          >
            {p.text}
          </span>
        ) : (
          <span
            key={p.key}
            className="art-link-label art-link-label--dot"
            data-testid={`art-link-${p.key}`}
            style={{ left: p.mid.x, top: p.mid.y }}
          />
        ),
      )}
    </>
  )
}
