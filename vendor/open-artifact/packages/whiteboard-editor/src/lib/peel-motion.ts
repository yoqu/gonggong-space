/**
 * The sticker peel's motion: how a sticker dragged off the picker peels
 * away from its sheet as it follows the pointer, and how it lays down.
 *
 * {@link StickerPeelMotion} is a spring model stepped at a fixed 60 Hz:
 * once the sticker has moved a couple of pixels it picks the corner that
 * trails the motion and starts to peel from it (`depth`), lifting (`raised`,
 * `scale`) and leaning into the motion (`lean`); the peel's direction
 * swings gently as the motion turns. The fold itself is drawn with a fixed
 * direction (bottom-right, {@link PEEL_FOLD_DIR}); see {@link peelFoldGeometry}.
 *
 * Pure: unit-tested. `ui/sticker-peel.ts` draws it.
 */

/** How deep the peel goes: from the first value at rest to the sum at full speed. */
export const PEEL_TILT_RANGE = [0.05, 0.3] as const;
/** How much a lifted sticker shrinks with height (a perspective cue). */
export const PEEL_PERSPECTIVE = 0.26;
/** The lift a peeling sticker always has. */
export const PEEL_LIFT_BASE = 0.27;
/** The peel's direction before the motion picks one (toward the bottom-right corner), radians. */
export const PEEL_DEFAULT_DIR = Math.PI / 4;
/** The sheen's resting direction, radians. */
export const PEEL_SHEEN_DIR = Math.PI / 4;
/** The direction a drawn fold always takes (bottom-right), radians. */
export const PEEL_FOLD_DIR = PEEL_DEFAULT_DIR;
/** How long a peeled sticker takes to lay down where it was dropped, ms. */
export const PEEL_LAY_DOWN_MS = 220;
/** How long a sticker dragged back to the picker takes to fly home, ms. */
export const STICKER_FLY_BACK_MS = 200;
/** One step of the model, ms (60 Hz). */
const STEP_MS = 1000 / 60;

/** `value` limited to ±`limit`. */
export function clampMagnitude(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** The shortest turn from `reference` to `angle` (radians), for a symmetry of `period` turns per circle. */
export function wrappedAngleDelta(angle: number, reference: number, period = 1): number {
  return Math.atan2(Math.sin(period * (angle - reference)), Math.cos(period * (angle - reference))) / period;
}

/** The peel's spring model; see the module comment. Fields are read after each {@link step}. */
export class StickerPeelMotion {
  /** The last time stepped (ms). */
  last: number;
  /** The sticker's scale (lifted stickers grow, then shrink a little with height). */
  scale: number;
  /** How far the peel has folded, 0..~0.35. */
  depth = 0;
  /** The peel's direction, radians. */
  dir = PEEL_DEFAULT_DIR;
  /** The sticker's smoothed speed, px per step. */
  speed = 0;
  /** Tilt into the motion, each axis. */
  tiltX = 0;
  tiltY = 0;
  /** Height above the sheet. */
  height = 0;
  /** How lifted (0..1). */
  raised = 0;
  /** Lean into the motion, degrees. */
  lean = 0;
  /** Sheen strength and direction. */
  sheen = 0;
  sheenDir = PEEL_SHEEN_DIR;
  /** Where the light falls, each axis. */
  lightX = 0;
  lightY = 0;
  private aimed = false;
  private drift: [number, number] = [0, 0];
  private swing = 0;
  private soft = 0;
  private rising = 0;
  private runs = 0;
  private owed = 0;
  private gone: [number, number, number, number] = [0, 0, 0, 0];

  /** A model starting at `time` (ms) with the sticker at `scale`. */
  constructor(time: number, scale: number) {
    this.last = time;
    this.scale = scale;
  }

  /**
   * Advances to `time` (ms): the sticker moved by (`dx`, `dy`) px and its
   * target by (`tdx`, `tdy`) since the last call. Runs as many fixed steps
   * as are due (sharing the motion out); returns whether any ran.
   */
  step(time: number, dx: number, dy: number, tdx: number, tdy: number): boolean {
    this.owed = Math.max(0, Math.min(this.owed + time - this.last, 100));
    this.last = time;
    this.gone = [this.gone[0] + dx, this.gone[1] + dy, this.gone[2] + tdx, this.gone[3] + tdy];
    const steps = Math.floor(this.owed / STEP_MS);
    if (steps === 0) return false;
    this.owed -= steps * STEP_MS;
    const [sx, sy, tx, ty] = this.gone.map((value) => value / steps) as [number, number, number, number];
    this.gone = [0, 0, 0, 0];
    for (let index = 0; index < steps; index += 1) this.once(sx, sy, tx, ty);
    return true;
  }

  /** One fixed step: the sticker moved (`dx`, `dy`), its target (`tdx`, `tdy`). */
  private once(dx: number, dy: number, tdx: number, tdy: number): void {
    const moved = Math.hypot(dx, dy);
    const aimedBy = Math.hypot(tdx, tdy);
    this.speed += (moved - this.speed) * 0.18;
    if (!this.aimed) {
      this.drift = [this.drift[0] + tdx, this.drift[1] + tdy];
      this.aimed = Math.hypot(...this.drift) >= 2;
      if (this.aimed) this.dir = Math.atan2(-this.drift[1], -this.drift[0]);
    } else if (aimedBy > 0.4) this.swing += (wrappedAngleDelta(Math.atan2(-tdy, -tdx), this.dir) * Math.min(1, aimedBy / 2.5) * 0.12 - this.swing) * 0.25;
    else this.swing *= 0.8;
    this.dir += this.swing;
    const [tiltMin, tiltMax] = PEEL_TILT_RANGE;
    const goal = this.aimed ? tiltMin + tiltMax * (1 - Math.exp(-this.speed * 0.12)) : 0;
    this.soft += (goal - this.soft) * (goal > this.soft ? 0.3 : 0.17);
    this.depth += (this.soft - this.depth) * (this.soft > this.depth ? 0.3 : 0.17);
    this.tiltX += (clampMagnitude(-dx * 0.0072, 0.3) - this.tiltX) * 0.09;
    this.tiltY += (clampMagnitude(-dy * 0.0072, 0.3) - this.tiltY) * 0.09;
    this.height += (0.25 + Math.min(1, this.speed / 15) * 0.375 - this.height) * 0.1;
    this.sheen += (Math.min(1, moved / 5) * 0.5 - this.sheen) * 0.09;
    if (moved > 0.4) this.runs += wrappedAngleDelta(Math.atan2(dy, dx), this.runs, 2) * 0.1;
    this.sheenDir = PEEL_SHEEN_DIR + wrappedAngleDelta(this.runs, PEEL_SHEEN_DIR, 2) * 0.22;
    this.lightX += (clampMagnitude(-dx * 0.06, 0.8) - this.lightX) * 0.1;
    this.lightY += (clampMagnitude(-dy * 0.06, 0.8) - this.lightY) * 0.1;
    if (this.aimed) this.rising += (1 - this.rising) * 0.13;
    this.raised += (this.rising - this.raised) * 0.13;
    this.scale += ((1 + 0.3 * this.raised) * (1 - (this.height + PEEL_LIFT_BASE) * this.raised * PEEL_PERSPECTIVE) - this.scale) * 0.14;
    this.lean += (clampMagnitude(dx * 0.55 - 8, 21.6) - this.lean) * 0.08;
  }
}

/** A length in px for CSS, to a hundredth. */
function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** The drop shadow of a sticker lifted by `lift` (0..1), on a dark board or not; `''` for none. */
export function peelDropShadowFilter(lift: number, dark: boolean): string {
  const strength = 0.6 * lift;
  if (strength <= 0.001) return '';
  const glow = dark ? `drop-shadow(0 0 ${px(10 + 16 * strength)} rgba(255,232,214,${0.2 * strength})) ` : '';
  return `${glow}drop-shadow(0 ${px(4 + 12 * strength)} ${px(8 + 18 * strength)} rgba(0,0,0,${(dark ? 0.7 : 0.3) * Math.min(1, strength * 1.5)}))`;
}

/** The lay-down's easing at `progress` (0..1): the cubic Bézier (0.3, 0.45, 0.55, 1), solved for x. */
export function easePeelLayDown(progress: number): number {
  let curve = progress;
  for (let iteration = 0; iteration < 6; iteration += 1)
    curve -=
      (3 * (1 - curve) ** 2 * curve * 0.3 + 3 * (1 - curve) * curve * curve * 0.45 + curve ** 3 - progress) /
      Math.max(0.0001, 3 * (1 - curve) ** 2 * 0.3 + 6 * (1 - curve) * curve * 0.15 + 3 * curve * curve * 0.55);
  curve = Math.max(0, Math.min(1, curve));
  return 3 * (1 - curve) * curve * curve + curve ** 3;
}

/** How a fold is drawn on art `side` px square, in the art's px. */
export interface PeelFoldGeometry {
  /** The region folded over (beyond the fold line, toward the corner): clips the turned flap. */
  cut: Array<[number, number]>;
  /** The region left flat (before the fold line): clips the art. */
  keep: Array<[number, number]>;
  /** The reflection across the fold line, as an SVG `matrix(a b c d e f)`. */
  matrix: [number, number, number, number, number, number];
  /** The flap's shade runs from the fold line (`x1`, `y1`) to its tip (`x2`, `y2`). */
  shade: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * The reach of round art `side` px square along the fold direction: how
 * far its farthest point lies (its corner-most edge).
 */
export function peelFoldReach(side: number): number {
  const cos = Math.cos(PEEL_FOLD_DIR);
  const sin = Math.sin(PEEL_FOLD_DIR);
  return (side / 2) * (cos + sin) + side / 2;
}

/** The fold of art `side` px square folded `depth` deep (0..1 of half its side), from its `reach`. */
export function peelFoldGeometry(depth: number, side: number, reach: number = peelFoldReach(side)): PeelFoldGeometry {
  const cos = Math.cos(PEEL_FOLD_DIR);
  const sin = Math.sin(PEEL_FOLD_DIR);
  const folded = (depth * side) / 2;
  const far = side * 5;
  const fx = cos * (reach - folded);
  const fy = sin * (reach - folded);
  const region = (toward: number): Array<[number, number]> => [
    [fx - sin * far, fy + cos * far],
    [fx + sin * far, fy - cos * far],
    [fx + sin * far + toward * cos * far, fy - cos * far + toward * sin * far],
    [fx - sin * far + toward * cos * far, fy + cos * far + toward * sin * far],
  ];
  return {
    cut: region(1),
    keep: region(-1),
    matrix: [1 - 2 * cos * cos, -2 * cos * sin, -2 * cos * sin, 1 - 2 * sin * sin, 2 * (reach - folded) * cos, 2 * (reach - folded) * sin],
    shade: { x1: fx, y1: fy, x2: fx + cos * folded, y2: fy + sin * folded },
  };
}
