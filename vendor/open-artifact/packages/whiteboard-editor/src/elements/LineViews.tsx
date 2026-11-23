/**
 * Views of line elements: freehand sketches and arrows.
 *
 * Both draw in SVG with board coordinates in their `viewBox`, so the math
 * stays in the core helpers. Each line has a wide, invisible hit path
 * (`.wb-hit`, its width kept on screen at any zoom) that tools pick up by
 * its `data-wb-id`; the visible ink never takes pointer events.
 */

import { memo, useEffect, useId } from 'react';
import {
  ARROW_CIRCLE_RADIUS,
  ARROW_LABEL_LINE_HEIGHT,
  ARROW_STROKE,
  TEXT_PROFILES,
  arrowCircleCenter,
  arrowEndBoxes,
  arrowHeads,
  arrowLineBounds,
  arrowTextKnockouts,
  cachedStrokePath,
  getTextMetricsEpoch,
  layoutBoxResolver,
  measureLabelWordWidth,
  measureLabelWords,
  measuredArrowGeometry,
  placeArrowLabel,
  strokeBounds,
  subscribeTextMetrics,
  type ArrowElement,
  type ArrowGeometry,
  type ArrowHeadKind,
  type Box,
  type PlacedArrowLabel,
  type StrokeElement,
} from '@open-artifact/whiteboard-core';
import { arrowEndNeighbor, arrowPathData, elementInkColor } from '../export/look.ts';
import { reportMeasure } from '../state/measures.ts';
import { useColorScheme } from '../state/theme.ts';
import { editTextActionLabel } from './describe.ts';
import { useBoardDerived } from './hooks.ts';
import { useItemProps } from './item.tsx';
import { rotationStyle, type ViewStyle } from './style.ts';
import { TextEditor, useEditing, writeArrowLabel } from './TextEditor.tsx';

/** Room around a line's bounds for heads, halos and the hit path, in board pixels. */
const LINE_PAD = 12;

/** Width of a line's hit path on screen, in pixels. */
const HIT_WIDTH = 'calc(14px / var(--wb-zoom, 1))';

/* ------------------------------------------------------------------------ */
/* Sketch                                                                   */
/* ------------------------------------------------------------------------ */

/** A freehand sketch: one smoothed path. */
export const StrokeView = memo(function StrokeView({ element }: { element: StrokeElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const bounds = strokeBounds(element);
  const d = cachedStrokePath(element.points);
  const style: ViewStyle = { left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h, transformOrigin: '50% 50%', ...rotationStyle(element) };
  return (
    <svg {...item} className="wb-el wb-stroke" style={style} viewBox={`${bounds.x - element.x} ${bounds.y - element.y} ${bounds.w} ${bounds.h}`}>
      <path className="wb-stroke-ink" d={d} stroke={elementInkColor(element, scheme)} strokeWidth={element.width} />
      <path className="wb-hit" d={d} data-wb-id={element.id} style={{ strokeWidth: `max(${element.width}px, ${HIT_WIDTH})` }} />
    </svg>
  );
});

/* ------------------------------------------------------------------------ */
/* Arrow                                                                    */
/* ------------------------------------------------------------------------ */

/** Everything an arrow view draws, derived from the board and measures. */
interface ArrowDrawing {
  line: ArrowGeometry;
  heads: readonly [ArrowHeadKind, ArrowHeadKind];
  knockouts: readonly Box[];
  label: PlacedArrowLabel | undefined;
}

/** Measure of the hint shown while an empty label is being edited. */
const EMPTY_LABEL_MEASURE = measureLabelWords('Label');

/** The drawing of an arrow, or `undefined` when its ends cannot be resolved. */
function arrowDrawing(arrow: ArrowElement, editing: boolean, byId: Parameters<typeof measuredArrowGeometry>[1], measures: Parameters<typeof measuredArrowGeometry>[2]): ArrowDrawing | undefined {
  const line = measuredArrowGeometry(arrow, byId, measures);
  if (!line) return undefined;
  const heads = arrowHeads(arrow);
  const measure = arrow.label ? measures?.get(arrow.id)?.label : editing ? EMPTY_LABEL_MEASURE : undefined;
  const label = measure ? placeArrowLabel(line, heads, measure, arrowEndBoxes(arrow, byId, layoutBoxResolver(measures))) : undefined;
  return { line, heads, knockouts: arrowTextKnockouts(arrow, line, byId, measures), label };
}

/** Whether two drawings look the same. */
function sameDrawing(a: ArrowDrawing | undefined, b: ArrowDrawing | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
}

/** The open chevron of an arrow head at `tip`, pointing away from `from`. */
export function arrowHeadPath(tip: { x: number; y: number }, from: { x: number; y: number }): string {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / length;
  const uy = (tip.y - from.y) / length;
  const back = { x: tip.x - ux * ARROW_STROKE.head, y: tip.y - uy * ARROW_STROKE.head };
  const wing = ARROW_STROKE.head * ARROW_STROKE.wing;
  return `M ${back.x - uy * wing} ${back.y + ux * wing} L ${tip.x} ${tip.y} L ${back.x + uy * wing} ${back.y - ux * wing}`;
}

/** The head at one end of an arrow. */
function ArrowHead({ kind, line, end, color }: { kind: ArrowHeadKind; line: ArrowGeometry; end: 'from' | 'to'; color: string }) {
  if (kind === 'none') return null;
  const tip = end === 'from' ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 };
  const from = arrowEndNeighbor(line, end);
  if (kind === 'circle') {
    const center = arrowCircleCenter(tip.x, tip.y, from.x, from.y);
    return <circle cx={center.x} cy={center.y} r={ARROW_CIRCLE_RADIUS} fill="var(--wb-paper)" stroke={color} strokeWidth={ARROW_STROKE.width} />;
  }
  return <path d={arrowHeadPath(tip, from)} fill="none" stroke={color} strokeWidth={ARROW_STROKE.width} strokeLinecap="round" strokeLinejoin="round" />;
}

/** Keeps an arrow's label measure in the measures store (and re-measures when fonts load). */
function useArrowLabelMeasure(arrow: ArrowElement): void {
  const { id, label } = arrow;
  useEffect(() => {
    const report = () => reportMeasure(id, { label: label ? measureLabelWords(label, (word) => measureLabelWordWidth(word, getTextMetricsEpoch())) : undefined });
    report();
    return subscribeTextMetrics(report);
  }, [id, label]);
}

/**
 * An arrow: its line (straight or routed), heads, and label. Where the line
 * passes under text it is masked out so the text stays readable.
 */
export const ArrowView = memo(function ArrowView({ element }: { element: ArrowElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const editing = useEditing(element.id, 'arrow-label');
  const maskId = `wb-mask-${useId().replace(/:/g, '')}`;
  useArrowLabelMeasure(element);
  const drawing = useBoardDerived((state, measures) => {
    const arrow = state.byId.get(element.id);
    return arrow?.type === 'arrow' ? arrowDrawing(arrow, editing !== null, state.byId, measures) : undefined;
  }, `${element.id}|${editing !== null}`, sameDrawing);
  if (!drawing) return null;
  const { line, heads, knockouts, label } = drawing;
  const color = elementInkColor(element, scheme);
  const bounds = arrowLineBounds(line);
  const x0 = Math.min(bounds.x0, label?.x ?? Infinity) - LINE_PAD;
  const y0 = Math.min(bounds.y0, label?.y ?? Infinity) - LINE_PAD;
  const x1 = Math.max(bounds.x1, label ? label.x + label.w : -Infinity) + LINE_PAD;
  const y1 = Math.max(bounds.y1, label ? label.y + label.h : -Infinity) + LINE_PAD;
  const d = arrowPathData(line, heads);
  const style: ViewStyle = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  return (
    <>
      <svg {...item} className="wb-el wb-arrow" style={style} viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}>
        {knockouts.length > 0 ? (
          <mask id={maskId} maskUnits="userSpaceOnUse" x={x0} y={y0} width={x1 - x0} height={y1 - y0}>
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="white" />
            {knockouts.map((box, index) => (
              <rect key={index} x={box.x} y={box.y} width={box.w} height={box.h} fill="black" />
            ))}
          </mask>
        ) : null}
        <g mask={knockouts.length > 0 ? `url(#${maskId})` : undefined}>
          <path d={d} fill="none" stroke={color} strokeWidth={ARROW_STROKE.width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={element.dash ? ARROW_STROKE.dash.join(' ') : undefined} />
          <ArrowHead kind={heads[0]} line={line} end="from" color={color} />
          <ArrowHead kind={heads[1]} line={line} end="to" color={color} />
        </g>
        <path className="wb-hit" d={d} data-wb-id={element.id} style={{ strokeWidth: HIT_WIDTH }} />
        {label && element.label && !editing ? (
          <text className="wb-arrow-label" fill={color} textAnchor="middle" data-wb-id={element.id} data-wb-label="">
            {label.lines.map((text, index) => (
              <tspan key={index} x={label.x + label.w / 2} y={label.y + (index + 0.5) * ARROW_LABEL_LINE_HEIGHT} dominantBaseline="central">
                {text}
              </tspan>
            ))}
          </text>
        ) : null}
      </svg>
      {editing && label ? (
        <div className="wb-el wb-arrow-edit" style={{ left: label.x + label.w / 2, top: label.y + label.h / 2, '--wb-ink': color } as ViewStyle}>
          <TextEditor
            target={editing}
            value={element.label ?? ''}
            onChange={(text) => writeArrowLabel(element.id, text)}
            onEnd={(text) => writeArrowLabel(element.id, text, true)}
            profile={TEXT_PROFILES.label}
            label={editTextActionLabel(element)}
            hint="Label"
          />
        </div>
      ) : null}
    </>
  );
});
