export const ORB = 44
/** `.cdock--float` gap between the HUD and the orb. */
const GAP = 8
/** Dock inset from the bench top and bottom (`at` in ComposerDock). */
const INSET = 16
/** An orb closer than this to the bench top would put the HUD over the bench bar. */
const TOP_CLEAR = 56

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/**
 * Shift of the HUD from its natural spot (centred above a bottom-centre orb) so it follows the snapped orb:
 * aligned to the orb's snapped side, below the orb near the bench top, never past the dock's sides.
 * `width`/`height` are the dock area (bench minus insets); `orb` is the orb's offset from bottom-centre.
 */
export function hudOffset({
  edge,
  orb,
  width,
  height,
  hud,
}: {
  edge: 'bottom' | 'left' | 'right'
  orb: { x: number; y: number }
  width: number
  height: number
  hud: { w: number; h: number }
}): { x: number; y: number } {
  const side = (hud.w - ORB) / 2
  const x = edge === 'left' ? orb.x + side : edge === 'right' ? orb.x - side : orb.x
  const room = Math.max((width - hud.w) / 2, 0)
  const orbTop = height + INSET - ORB + orb.y
  const y = orbTop < TOP_CLEAR ? orb.y + ORB + 2 * GAP + hud.h : orb.y
  return { x: Math.round(clamp(x, -room, room)) + 0, y: Math.round(y) }
}
