/**
 * The area-style rubber band (see `area-marquee.ts`), for an SVG layer in
 * board units. It takes the viewer's own color unless given another.
 */

import type { Box } from '@open-artifact/whiteboard-core';
import { useOwnColor } from '../collab/colors.ts';
import { AREA_FILL_OPACITY, AREA_STROKE_PX, areaMarqueeGeometry } from './area-marquee.ts';

/** Draws a drag box as an area frame at the given zoom. */
export function AreaMarquee({ box, zoom, color, className }: { box: Box; zoom: number; color?: string; className?: string }) {
  const own = useOwnColor((state) => state.color);
  const paint = color ?? own;
  const { fill, edge } = areaMarqueeGeometry(box, zoom);
  return (
    <g className={className} aria-hidden="true" pointerEvents="none">
      <rect x={fill.x} y={fill.y} width={fill.w} height={fill.h} rx={fill.r} fill={paint} fillOpacity={AREA_FILL_OPACITY} stroke="none" />
      {edge.w > 0 && edge.h > 0 ? (
        <rect x={edge.x} y={edge.y} width={edge.w} height={edge.h} rx={edge.r} fill="none" stroke={paint} strokeWidth={AREA_STROKE_PX} vectorEffect="non-scaling-stroke" />
      ) : null}
    </g>
  );
}
