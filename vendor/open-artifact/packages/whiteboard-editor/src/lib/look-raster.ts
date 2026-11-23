/**
 * Painting the textured drawing looks (marker, watercolor, paper) from a
 * drawing's paint plan onto a 2D canvas. Runs in the look worker (or on
 * the page when workers are missing); the outline helpers are pure.
 *
 * - marker: fills laid in with broad, translucent felt-tip passes that
 *   darken where they overlap, each pass streaked; ink lines in the same
 *   felt tip.
 * - watercolor: paper with grain; each fill a few uneven washes with a
 *   little bleed past the outline and pigment pooling at the edges; ink
 *   lines light.
 * - paper: each fill a sheet of cut paper with a slightly rough edge, a
 *   soft drop shadow and fibres.
 */

import {
  DRAWING_LOOK_TONES,
  hatchFillLines,
  hatchSpacingForWidth,
  mixHexColors,
  seededLookRandom,
  type ColorScheme,
  type DrawingPaintPart,
  type DrawingPaintPlan,
  type SvgPolyline,
} from '@open-artifact/whiteboard-core';
import type { RasterLook } from './drawing-looks.ts';

/** A 2D context the looks paint on (a page canvas or an offscreen one). */
export type LookContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A point. */
type Point = [number, number];

/** The points of a flat polyline. */
export function polylinePoints(polyline: SvgPolyline): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < polyline.length; index += 2) points.push([polyline[index]!, polyline[index + 1]!]);
  return points;
}

/**
 * A rough copy of a closed outline: resampled about every `step` units and
 * each point moved up to `amount` along its normal, smoothly (neighbouring
 * points move alike), so an edge looks torn or soaked rather than jagged.
 */
export function roughOutline(points: readonly Point[], amount: number, step: number, random: () => number): Point[] {
  if (points.length < 3) return [...points];
  const resampled: Point[] = [];
  for (let index = 0; index < points.length; index++) {
    const [from, to] = [points[index]!, points[(index + 1) % points.length]!];
    const count = Math.max(1, Math.min(64, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step)));
    for (let k = 0; k < count; k++) resampled.push([from[0] + ((to[0] - from[0]) * k) / count, from[1] + ((to[1] - from[1]) * k) / count]);
  }
  const offsets = resampled.map(() => (random() - 0.5) * 2 * amount);
  const smooth = offsets.map((offset, index) => (offsets[(index + offsets.length - 1) % offsets.length]! + 2 * offset + offsets[(index + 1) % offsets.length]!) / 4);
  return resampled.map((point, index) => {
    const [previous, next] = [resampled[(index + resampled.length - 1) % resampled.length]!, resampled[(index + 1) % resampled.length]!];
    const length = Math.hypot(next[0] - previous[0], next[1] - previous[1]) || 1;
    const [nx, ny] = [-(next[1] - previous[1]) / length, (next[0] - previous[0]) / length];
    return [point[0] + nx * smooth[index]!, point[1] + ny * smooth[index]!];
  });
}

/** A closed outline grown (or shrunk, for a negative `by`) about its centre by `by` units. */
export function grownOutline(points: readonly Point[], by: number): Point[] {
  if (points.length === 0) return [];
  const [cx, cy] = points.reduce(([x, y], point) => [x + point[0] / points.length, y + point[1] / points.length], [0, 0]);
  const radius = Math.max(1, ...points.map((point) => Math.hypot(point[0] - cx, point[1] - cy)));
  const factor = Math.max(0, (radius + by) / radius);
  return points.map(([x, y]): Point => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

/** True when a point lies inside a closed outline (even-odd). */
export function pointInOutline(point: Point, outline: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const [a, b] = [outline[index]!, outline[previous]!];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Area of a closed outline (absolute). */
export function outlineArea(points: readonly Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const [a, b] = [points[index]!, points[(index + 1) % points.length]!];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

/** A path through points (closed when asked). */
function tracePath(ctx: LookContext, points: readonly Point[], closed: boolean): void {
  ctx.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  if (closed) ctx.closePath();
}

/** A tiling grain of grey noise, `size` pixels square, as a pattern. */
function grainPattern(ctx: LookContext, size: number, low: number, high: number, random: () => number): CanvasPattern | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const tile = new OffscreenCanvas(size, size);
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return null;
  const image = tileCtx.createImageData(size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.round(low + (high - low) * random());
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  tileCtx.putImageData(image, 0, 0);
  return ctx.createPattern(tile, 'repeat');
}

/** Lays grain over what is painted, in pixel units so it stays fine at any scale. */
function layGrain(ctx: LookContext, width: number, height: number, scheme: ColorScheme, strength: number, random: () => number): void {
  const pattern = grainPattern(ctx, 96, scheme === 'light' ? 170 : 0, scheme === 'light' ? 255 : 90, random);
  if (pattern === null) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = scheme === 'light' ? 'multiply' : 'screen';
  ctx.globalAlpha = strength;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Resolves a part's color (`currentColor` is the look's ink). */
function partColor(color: string, ink: string): string {
  return color === 'currentColor' ? ink : color;
}

/** Sets a dash pattern scaled to the line width (or none). */
function setDash(ctx: LookContext, dashed: boolean, width: number): void {
  ctx.setLineDash(dashed ? [width * 3, width * 2.4] : []);
}

/* -------------------------------------------------------------------------- */
/* Marker                                                                     */
/* -------------------------------------------------------------------------- */

/** One felt-tip stroke along points: a translucent body and a few streaks inside it. */
function markerStroke(ctx: LookContext, points: readonly Point[], color: string, width: number, alpha: number, scheme: ColorScheme, random: () => number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  tracePath(ctx, points, false);
  ctx.stroke();
  // Streaks: the tip lays ink unevenly across its width.
  const streak = scheme === 'light' ? mixHexColors(color, '#000000', 0.25) : mixHexColors(color, '#ffffff', 0.25);
  ctx.strokeStyle = streak;
  for (let k = 0; k < 3; k++) {
    const offset = (random() - 0.5) * width * 0.7;
    ctx.lineWidth = width * (0.08 + 0.1 * random());
    ctx.globalAlpha = alpha * (0.18 + 0.2 * random());
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      const [previous, next] = [points[Math.max(0, index - 1)]!, points[Math.min(points.length - 1, index + 1)]!];
      const length = Math.hypot(next[0] - previous[0], next[1] - previous[1]) || 1;
      const [nx, ny] = [-(next[1] - previous[1]) / length, (next[0] - previous[0]) / length];
      if (index === 0) ctx.moveTo(x + nx * offset, y + ny * offset);
      else ctx.lineTo(x + nx * offset, y + ny * offset);
    });
    ctx.stroke();
  }
}

function paintMarker(ctx: LookContext, plan: DrawingPaintPlan, scheme: ColorScheme, random: () => number): void {
  const ink = DRAWING_LOOK_TONES.marker[scheme].ink;
  const budget = { passes: 1200, looks: 150000 };
  ctx.globalCompositeOperation = scheme === 'light' ? 'multiply' : 'source-over';
  for (const part of plan.parts) {
    if (part.fill !== undefined) {
      const color = partColor(part.fill.color, ink);
      const alpha = Math.min(0.78, 0.66 * Math.max(0.35, part.fill.alpha));
      for (const contour of part.contours) {
        const hatch = part.contours.length === 1 ? hatchFillLines(contour, hatchSpacingForWidth(plan.width), [plan.width, plan.height], part.fill.alpha < 1, budget, random) : undefined;
        if (hatch !== undefined && hatch !== 'too many') {
          for (const line of hatch.lines) markerStroke(ctx, polylinePoints(line), color, hatch.width * 0.95, alpha, scheme, random);
          continue;
        }
        // Too small or too intricate for passes: a flat coat, edged by the tip.
        const points = polylinePoints(contour);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        tracePath(ctx, points, true);
        ctx.fill();
        markerStroke(ctx, [...points, points[0]!], color, Math.max(1.5, plan.width / 260), alpha * 0.6, scheme, random);
      }
    }
    if (part.stroke !== undefined) {
      const color = partColor(part.stroke.color, ink);
      setDash(ctx, part.stroke.dashed, part.stroke.width);
      for (const contour of part.contours) {
        const points = polylinePoints(contour);
        markerStroke(ctx, part.closed && points.length > 2 ? [...points, points[0]!] : points, color, part.stroke.width * 1.15, Math.min(0.92, part.stroke.alpha * 0.9), scheme, random);
      }
      setDash(ctx, false, 0);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Watercolor                                                                 */
/* -------------------------------------------------------------------------- */

function paintWatercolor(ctx: LookContext, plan: DrawingPaintPlan, scheme: ColorScheme, pixelWidth: number, pixelHeight: number, random: () => number): void {
  const tone = DRAWING_LOOK_TONES.watercolor[scheme];
  const unit = Math.max(plan.width, plan.height) / 400;
  const pixelsPerUnit = pixelWidth / plan.width;
  // The sheet, its edge a little deckled.
  ctx.fillStyle = tone.paper ?? '#ffffff';
  const inset = unit * 2;
  tracePath(ctx, roughOutline([[inset, inset], [plan.width - inset, inset], [plan.width - inset, plan.height - inset], [inset, plan.height - inset]], unit * 0.9, unit * 6, random), true);
  ctx.fill();
  ctx.globalCompositeOperation = scheme === 'light' ? 'multiply' : 'source-over';
  for (const part of plan.parts) {
    if (part.fill !== undefined) {
      const base = partColor(part.fill.color, tone.ink);
      const color = scheme === 'light' ? base : mixHexColors(base, '#ffffff', 0.12);
      const pooled = scheme === 'light' ? mixHexColors(base, '#000000', 0.3) : mixHexColors(base, '#ffffff', 0.3);
      const alpha = Math.min(1, part.fill.alpha * 1.1);
      for (const contour of part.contours) {
        const points = polylinePoints(contour);
        const area = outlineArea(points);
        const size = Math.sqrt(area);
        if (points.length < 3 || size < unit * 0.5) continue;
        const reach = Math.min(unit * 3, size * 0.06);
        ctx.fillStyle = color;
        // Bleed: a faint wash a little past the outline.
        ctx.globalAlpha = 0.12 * alpha;
        tracePath(ctx, roughOutline(grownOutline(points, reach), reach * 0.8, unit * 5, random), true);
        ctx.fill();
        // Uneven pigment: a few washes, each a little off.
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = (0.2 + 0.08 * random()) * alpha;
          tracePath(ctx, roughOutline(grownOutline(points, -reach * random()), reach * 0.7, unit * 4, random), true);
          ctx.fill();
        }
        // Blooms where pigment settled.
        const blooms = Math.min(6, Math.floor(area / (unit * unit * 900)));
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        for (let k = 0; k < blooms; k++) {
          const spot: Point = [Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + random() * (Math.max(...ys) - Math.min(...ys))];
          if (!pointInOutline(spot, points)) continue;
          ctx.globalAlpha = 0.1 * alpha;
          ctx.fillStyle = random() < 0.5 ? pooled : color;
          ctx.beginPath();
          ctx.arc(spot[0], spot[1], size * (0.08 + 0.12 * random()), 0, Math.PI * 2);
          ctx.fill();
        }
        // Pigment pooling at the edges.
        ctx.save();
        ctx.filter = `blur(${String(Math.max(0.5, unit * 0.6 * pixelsPerUnit))}px)`;
        ctx.strokeStyle = pooled;
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(unit * 1.4, Math.min(unit * 3, size * 0.02));
        ctx.globalAlpha = 0.32 * alpha;
        tracePath(ctx, roughOutline(points, reach * 0.5, unit * 4, random), true);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (part.stroke !== undefined) {
      // Ink lines stay light: a pencil line under the washes, or a fine brush line in color.
      const ink = part.stroke.color === 'currentColor';
      ctx.strokeStyle = partColor(part.stroke.color, tone.ink);
      ctx.lineWidth = part.stroke.width * (ink ? 0.55 : 0.8);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = part.stroke.alpha * (ink ? 0.42 : 0.6);
      setDash(ctx, part.stroke.dashed, part.stroke.width);
      for (const contour of part.contours) {
        const points = polylinePoints(contour);
        tracePath(ctx, part.closed ? roughOutline(points, unit * 0.4, unit * 8, random) : points, part.closed);
        ctx.stroke();
      }
      setDash(ctx, false, 0);
    }
  }
  ctx.globalAlpha = 1;
  layGrain(ctx, pixelWidth, pixelHeight, scheme, scheme === 'light' ? 0.35 : 0.12, random);
}

/* -------------------------------------------------------------------------- */
/* Cut paper                                                                  */
/* -------------------------------------------------------------------------- */

function paintPaper(ctx: LookContext, plan: DrawingPaintPlan, scheme: ColorScheme, pixelWidth: number, random: () => number): void {
  const tone = DRAWING_LOOK_TONES.paper[scheme];
  const unit = Math.max(plan.width, plan.height) / 400;
  const pixelsPerUnit = pixelWidth / plan.width;
  const shadow = scheme === 'light' ? 'rgba(40,30,20,0.3)' : 'rgba(0,0,0,0.6)';
  const sheet = (points: Point[], color: string, alpha: number, fibres: boolean): void => {
    ctx.save();
    ctx.shadowColor = shadow;
    ctx.shadowBlur = unit * 4 * pixelsPerUnit;
    ctx.shadowOffsetX = unit * 0.8 * pixelsPerUnit;
    ctx.shadowOffsetY = unit * 2 * pixelsPerUnit;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    tracePath(ctx, points, true);
    ctx.fill();
    ctx.restore();
    if (!fibres) return;
    // Fibres and a lighter cut edge.
    ctx.save();
    tracePath(ctx, points, true);
    ctx.clip();
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const count = Math.min(160, Math.floor(((maxX - minX) * (maxY - minY)) / (unit * unit * 60)));
    ctx.lineWidth = unit * 0.35;
    ctx.lineCap = 'round';
    for (let k = 0; k < count; k++) {
      const [x, y] = [minX + random() * (maxX - minX), minY + random() * (maxY - minY)];
      const [angle, length] = [random() * Math.PI, unit * (2 + 5 * random())];
      ctx.strokeStyle = random() < 0.5 ? '#ffffff' : '#000000';
      ctx.globalAlpha = 0.06 + 0.06 * random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(angle + 0.6) * length * 0.5, y + Math.sin(angle + 0.6) * length * 0.5, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    }
    ctx.strokeStyle = mixHexColors(color, '#ffffff', 0.45);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = unit * 0.7;
    tracePath(ctx, points, true);
    ctx.stroke();
    ctx.restore();
  };
  for (const part of plan.parts) {
    if (part.fill !== undefined) {
      const color = partColor(part.fill.color, tone.ink);
      // Paper is opaque; a see-through fill becomes a thinner sheet.
      const alpha = part.fill.alpha >= 0.5 ? 1 : Math.min(1, part.fill.alpha + 0.35);
      for (const contour of part.contours) {
        const points = polylinePoints(contour);
        if (points.length < 3) continue;
        sheet(roughOutline(points, unit * 0.45, unit * 3, random), color, alpha, outlineArea(points) > unit * unit * 30);
      }
    }
    if (part.stroke !== undefined) {
      // Lines are thin strips of paper.
      ctx.save();
      ctx.shadowColor = shadow;
      ctx.shadowBlur = unit * 2 * pixelsPerUnit;
      ctx.shadowOffsetY = unit * pixelsPerUnit;
      ctx.strokeStyle = partColor(part.stroke.color, tone.ink);
      ctx.globalAlpha = Math.min(1, part.stroke.alpha + 0.2);
      ctx.lineWidth = Math.max(unit, part.stroke.width);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      setDash(ctx, part.stroke.dashed, part.stroke.width);
      for (const contour of part.contours) {
        const points = polylinePoints(contour);
        tracePath(ctx, points, part.closed);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

/** Paints a look of a drawing filling a `pixelWidth` × `pixelHeight` canvas (cleared first). */
export function paintDrawingLook(ctx: LookContext, plan: DrawingPaintPlan, look: RasterLook, scheme: ColorScheme, pixelWidth: number, pixelHeight: number, seed: string): void {
  const random = seededLookRandom(`${look}|${seed}`);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  ctx.setTransform(pixelWidth / plan.width, 0, 0, pixelHeight / plan.height, 0, 0);
  if (look === 'marker') paintMarker(ctx, plan, scheme, random);
  else if (look === 'watercolor') paintWatercolor(ctx, plan, scheme, pixelWidth, pixelHeight, random);
  else paintPaper(ctx, plan, scheme, pixelWidth, random);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** True when a plan has something to paint. */
export function planPaintsAnything(plan: DrawingPaintPlan): boolean {
  return plan.parts.some((part: DrawingPaintPart) => part.contours.length > 0);
}
