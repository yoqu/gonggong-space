import { memo, useId } from 'react';
import {
  cylinderCapPathData, handDrawnShapeOutline, polygonCornerRadius, roundedPolygonPathData, shapeEdgeOverlay,
  shapeFillPaint, shapeOutlineColor, shapePathData, shapeStrokePaint, type ColorScheme, type ShapeElement,
} from '@open-artifact/whiteboard-core';
import { SHAPE_EDGE_WIDTH } from '../export/look.ts';

/** The same ink outline, cylinder cap and inset edge used in the board export. */
export const ShapeFace = memo(function ShapeFace({ element, scheme }: { element: ShapeElement; scheme: ColorScheme }) {
  const clip = useId();
  const { kind, w, h } = element;
  const fill = shapeFillPaint(element);
  const ink = shapeStrokePaint(element, scheme);
  const soft = ink === 'none' && !element.hollow;
  const cap = soft ? cylinderCapPathData(kind, w, h) : undefined;
  const edge = soft ? roundedPolygonPathData(kind, w, h, true) : undefined;
  return (
    <svg className="wb-shape-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={shapePathData(kind, w, h)} fill={fill} stroke={ink === 'none' ? fill : 'none'} strokeWidth={ink === 'none' ? polygonCornerRadius(kind) : 1.8} />
      {cap && <path d={cap} fill={shapeOutlineColor(element)} />}
      {ink !== 'none' && <path d={handDrawnShapeOutline(kind, w, h, element.id)} fill={ink} pointerEvents="none" />}
      {edge && <>
        <clipPath id={clip}><path d={edge} /></clipPath>
        <path d={edge} fill="none" stroke={shapeEdgeOverlay(fill)} strokeWidth={2 * SHAPE_EDGE_WIDTH} clipPath={`url(#${clip})`} pointerEvents="none" />
      </>}
    </svg>
  );
});
